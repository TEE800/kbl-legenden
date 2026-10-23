// KBL Legenden · Online-Tippdienst fuer den MVP-Tipp (Cloudflare Worker, kostenloser Tarif).
// Nimmt die verdeckten Tipps an, solange der Spieltag nicht angepfiffen ist, und zeigt sie erst danach.
// Managerliste, Spielerliste und Regel-Vorlagen liest er von der Online-Seite (data/mvp-tipps*.json),
// Anstosszeiten von OpenLigaDB. Kickbase braucht er nicht. Die Auswertung macht weiter die App (GitHub-Export holt /export).
// Einstellungen im Cloudflare-Dashboard: KV-Bindung TIPPS, Variable SITE_URL, Geheimnis ADMIN_CODE. Anleitung: ANLEITUNG.md.
const SEASON_URL = 'https://api.openligadb.de/getmatchdata/bl1/2026';
const json = (body, status = 200, cors = {}) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...cors } });
const enc = new TextEncoder();
const hex = buf => [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');

async function hashCode(code, salt) {
  const key = await crypto.subtle.importKey('raw', enc.encode(String(code)), 'PBKDF2', false, ['deriveBits']);
  return hex(await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: enc.encode(salt), iterations: 100000 }, key, 256));
}
function sameText(a, b) { if (a.length !== b.length) return false; let d = 0; for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i); return d === 0; }

// Kleiner Zwischenspeicher je Worker-Instanz, damit nicht jede Anfrage die Quellen neu laedt.
const memo = new Map();
async function cached(key, ms, load) {
  const c = memo.get(key);
  if (c && Date.now() - c.at < ms) return c.value;
  const value = await load();
  memo.set(key, { at: Date.now(), value });
  return value;
}
async function siteJson(env, file) {
  const base = String(env.SITE_URL || '').replace(/\/+$/, '');
  if (!base) throw new Error('SITE_URL fehlt in den Einstellungen.');
  return cached('site:' + file, 10 * 60e3, async () => {
    const r = await fetch(`${base}/data/${file}`, { cf: { cacheTtl: 300 } });
    if (!r.ok) throw new Error(`Online-Seite: ${file} nicht abrufbar (HTTP ${r.status}).`);
    return r.json();
  });
}
// Spieltage wie in server.js (loadMatchdays): upcoming, live, finished; erster Anstoss je Spieltag.
async function matchdays() {
  return cached('md', 2 * 60e3, async () => {
    const r = await fetch(SEASON_URL, { headers: { Accept: 'application/json' } });
    if (!r.ok) throw new Error(`OpenLigaDB HTTP ${r.status}`);
    const groups = new Map();
    for (const m of await r.json()) {
      const day = Number(m.group?.groupOrderID);
      if (!Number.isInteger(day) || day < 1 || day > 34) continue;
      if (!groups.has(day)) groups.set(day, []);
      groups.get(day).push(m);
    }
    const now = Date.now();
    return [...groups.entries()].sort((a, b) => a[0] - b[0]).map(([day, games]) => {
      const times = games.map(g => ({ g, t: Date.parse(g.matchDateTimeUTC || g.matchDateTime) })).filter(x => Number.isFinite(x.t)).sort((a, b) => a.t - b.t);
      const complete = games.length === 9 && games.every(g => g.matchIsFinished === true);
      const first = times[0];
      return { day, status: complete ? 'finished' : times.some(x => x.t <= now) ? 'live' : 'upcoming',
        firstKickoffUTC: first ? new Date(first.t).toISOString() : null,
        firstMatch: first ? `${first.g.team1?.teamName || 'Team 1'} – ${first.g.team2?.teamName || 'Team 2'}` : null };
    });
  });
}
function dayState(days, day) {
  const d = days.find(x => x.day === day), next = days.find(x => x.status === 'upcoming')?.day || null;
  const kickoff = d?.firstKickoffUTC ? Date.parse(d.firstKickoffUTC) : NaN;
  const locked = !d || d.status !== 'upcoming' || !Number.isFinite(kickoff) || Date.now() >= kickoff;
  return { status: d?.status || 'unknown', deadline: d?.firstKickoffUTC || null, firstMatch: d?.firstMatch || null, locked, open: !locked && day === next, next };
}
async function listTips(env, day) {
  const out = {};
  let cursor;
  do {
    const page = await env.TIPPS.list({ prefix: `tip:${day}:`, cursor });
    await Promise.all(page.keys.map(async k => { const v = await env.TIPPS.get(k.name, 'json'); if (v) out[k.name.split(':')[2]] = v; }));
    cursor = page.list_complete ? null : page.cursor;
  } while (cursor);
  return out;
}
async function codeIds(env) {
  const ids = new Set(); let cursor;
  do { const page = await env.TIPPS.list({ prefix: 'code:', cursor }); for (const k of page.keys) ids.add(k.name.slice(5)); cursor = page.list_complete ? null : page.cursor; } while (cursor);
  return ids;
}
// Code pruefen; ohne gespeicherten Code wird er bei set=true festgelegt. Hoechstens 5 Fehlversuche in 15 Minuten.
async function checkCode(env, id, code, set) {
  if (!/^\d{4,8}$/.test(String(code || ''))) return { error: 'Bitte einen Code aus 4 bis 8 Ziffern eingeben.', status: 400 };
  const fails = (await env.TIPPS.get(`fail:${id}`, 'json')) || [];
  const recent = fails.filter(t => Date.now() - t < 15 * 60e3);
  if (recent.length >= 5) return { error: 'Zu viele falsche Codes. Bitte in 15 Minuten erneut versuchen.', status: 429 };
  const rec = await env.TIPPS.get(`code:${id}`, 'json');
  if (!rec) {
    if (!set) return { error: 'Für diesen Namen gibt es noch keinen Code. Er wird beim ersten Tipp festgelegt.', status: 404 };
    const salt = hex(crypto.getRandomValues(new Uint8Array(16)));
    await env.TIPPS.put(`code:${id}`, JSON.stringify({ salt, hash: await hashCode(code, salt), createdAt: new Date().toISOString() }));
    return { ok: true, created: true };
  }
  if (!sameText(rec.hash, await hashCode(code, rec.salt))) {
    recent.push(Date.now());
    await env.TIPPS.put(`fail:${id}`, JSON.stringify(recent), { expirationTtl: 15 * 60 + 60 });
    return { error: 'Falscher Code.', status: 403 };
  }
  if (recent.length) await env.TIPPS.delete(`fail:${id}`);
  return { ok: true };
}
function isAdmin(env, given) { return !!env.ADMIN_CODE && typeof given === 'string' && sameText(given, String(env.ADMIN_CODE)); }

async function handle(req, env, cors) {
  const url = new URL(req.url), parts = url.pathname.replace(/^\/+|\/+$/g, '').split('/');
  const body = req.method === 'GET' || req.method === 'DELETE' ? {} : await req.json().catch(() => ({}));
  if (parts[0] === '' || parts[0] === 'status') return json({ ok: true, dienst: 'KBL Legenden MVP-Tipp' }, 200, cors);

  // Alle Regeln und die aufgedeckten Tipps (nur angepfiffene Spieltage) fuer den GitHub-Export.
  if (parts[0] === 'export' && req.method === 'GET') {
    const days = await matchdays(), out = {};
    let cursor;
    const ruleDays = new Set();
    do { const page = await env.TIPPS.list({ prefix: 'rule:', cursor }); for (const k of page.keys) ruleDays.add(Number(k.name.slice(5))); cursor = page.list_complete ? null : page.cursor; } while (cursor);
    for (const d of days) {
      const st = dayState(days, d.day), rule = ruleDays.has(d.day) ? await env.TIPPS.get(`rule:${d.day}`, 'json') : null;
      const reveal = st.locked && st.status !== 'upcoming';
      const tips = reveal ? await listTips(env, d.day) : {};
      if (rule || Object.keys(tips).length) out[d.day] = { ...(rule ? { rule } : {}), ...(reveal ? { tips } : {}) };
    }
    return json({ exportedAt: new Date().toISOString(), days: out }, 200, cors);
  }

  if (parts[0] === 'codes' && parts[1] && req.method === 'DELETE') {
    if (!isAdmin(env, req.headers.get('X-Admin-Code'))) return json({ error: 'Falscher Admin-Code.' }, 403, cors);
    if (!/^\d{1,15}$/.test(parts[1])) return json({ error: 'Ungültiger Manager.' }, 400, cors);
    await env.TIPPS.delete(`code:${parts[1]}`); await env.TIPPS.delete(`fail:${parts[1]}`);
    return json({ ok: true }, 200, cors);
  }

  if (parts[0] !== 'tipps' || !/^\d{1,2}$/.test(parts[1] || '')) return json({ error: 'Nicht gefunden.' }, 404, cors);
  const day = Number(parts[1]);
  if (day < 1 || day > 34) return json({ error: 'Ungültiger Spieltag.' }, 400, cors);
  const [days, info] = await Promise.all([matchdays(), siteJson(env, 'mvp-tipps.json')]);
  const managers = (info.managers || []).filter(m => /^\d{1,15}$/.test(String(m.id)) && String(m.id) !== '3783040');
  if (!managers.length) return json({ error: 'Managerliste fehlt auf der Online-Seite.' }, 503, cors);
  const st = dayState(days, day);

  if (parts[2] === 'rule' && req.method === 'PUT') {
    if (!isAdmin(env, body.adminCode)) return json({ error: 'Falscher Admin-Code.' }, 403, cors);
    if (st.locked) return json({ error: 'Der Spieltag ist angepfiffen, die Tippregel steht fest.' }, 409, cors);
    const id = String(body.ruleId || ''), text = String(body.text || '').trim(), base = (info.rules || []).find(r => r.id === id);
    if (!base && !(id === 'eigene' && text && text.length <= 500)) return json({ error: 'Bitte eine Tippregel wählen oder eine eigene eintragen.' }, 400, cors);
    // Wer die Regel an diesem Spieltag bestimmt hat (wechselt jeden Spieltag), optional.
    const by = managers.find(m => String(m.id) === String(body.byId || ''));
    if (body.byId && !by) return json({ error: 'Unbekannter Manager.' }, 400, cors);
    const wertung = body.wertung ? String(body.wertung) : '';
    if (wertung && !(info.wertungen || []).some(w => w.id === wertung)) return json({ error: 'Unbekannte Wertung.' }, 400, cors);
    const rule = { ...(base ? { id: base.id, title: base.title, text: base.text } : { id: 'eigene', title: 'Eigene Regel', text }), ...(by ? { by: { id: String(by.id), name: by.name } } : {}), ...(wertung ? { wertung } : {}) };
    await env.TIPPS.put(`rule:${day}`, JSON.stringify(rule));
    return json({ ok: true, rule }, 200, cors);
  }
  if (parts[2] === 'mine' && req.method === 'POST') {
    const id = String(body.managerId || '');
    if (!managers.some(m => String(m.id) === id)) return json({ error: 'Bitte deinen Namen aus der Liste wählen.' }, 400, cors);
    const c = await checkCode(env, id, body.code, false); if (!c.ok) return json({ error: c.error }, c.status, cors);
    return json({ ok: true, tip: await env.TIPPS.get(`tip:${day}:${id}`, 'json') }, 200, cors);
  }
  if (!parts[2] && req.method === 'PUT') {
    if (!st.open) return json({ error: st.locked ? 'Der Spieltag ist angepfiffen, Tipps sind gesperrt.' : 'Getippt wird nur auf den nächsten Spieltag.' }, 409, cors);
    const me = managers.find(m => String(m.id) === String(body.managerId || ''));
    if (!me) return json({ error: 'Bitte deinen Namen aus der Liste wählen.' }, 400, cors);
    const playerId = String(body.playerId || ''), points = Number(body.points);
    if (!/^\d{1,10}$/.test(playerId) || !Number.isInteger(points) || points < -1000 || points > 2000) return json({ error: 'Bitte einen Spieler aus der Liste und eine ganze Punktzahl angeben.' }, 400, cors);
    const player = ((await siteJson(env, 'mvp-tipps_players.json')).players || []).find(p => String(p.id) === playerId);
    if (!player) return json({ error: 'Spieler nicht gefunden.' }, 400, cors);
    const c = await checkCode(env, String(me.id), body.code, true); if (!c.ok) return json({ error: c.error }, c.status, cors);
    const tip = { name: me.name, playerId, player: player.name, team: player.team, points, updatedAt: new Date().toISOString() };
    await env.TIPPS.put(`tip:${day}:${me.id}`, JSON.stringify(tip));
    return json({ ok: true, codeCreated: !!c.created, tip }, 200, cors);
  }
  // Wertung der Tippregel (nur Admin), auch nach dem Anpfiff. Danach richten sich "fuehrend" und der Gewinner-Vorschlag.
  if (parts[2] === 'wertung' && req.method === 'PUT') {
    if (!isAdmin(env, body.adminCode)) return json({ error: 'Falscher Admin-Code.' }, 403, cors);
    // Leer = automatisch aus dem Regeltext (erkennt die App).
    const wertung = String(body.wertung || '');
    if (wertung && !(info.wertungen || []).some(w => w.id === wertung)) return json({ error: 'Unbekannte Wertung.' }, 400, cors);
    const rule = await env.TIPPS.get(`rule:${day}`, 'json');
    if (!rule) return json({ error: 'Bitte zuerst die Tippregel eintragen.' }, 409, cors);
    const { wertung: _old, ...base } = rule;
    const next = { ...base, ...(wertung ? { wertung } : {}) };
    await env.TIPPS.put(`rule:${day}`, JSON.stringify(next));
    return json({ ok: true, rule: next }, 200, cors);
  }
  // Tipp nachtragen (nur Admin, erst nach dem Anpfiff). Ein eigener Tipp wird nie ueberschrieben, ein nachgetragener darf korrigiert werden.
  if (parts[2] === 'nachtrag' && req.method === 'PUT') {
    if (!isAdmin(env, body.adminCode)) return json({ error: 'Falscher Admin-Code.' }, 403, cors);
    if (!st.locked || st.status === 'upcoming') return json({ error: 'Nachtragen geht erst nach dem Anpfiff. Bis dahin tippt jeder selbst.' }, 409, cors);
    const me = managers.find(m => String(m.id) === String(body.managerId || ''));
    if (!me) return json({ error: 'Bitte einen Manager aus der Liste wählen.' }, 400, cors);
    const playerId = String(body.playerId || ''), points = Number(body.points);
    if (!/^\d{1,10}$/.test(playerId) || !Number.isInteger(points) || points < -1000 || points > 2000) return json({ error: 'Bitte einen Spieler aus der Liste und eine ganze Punktzahl angeben.' }, 400, cors);
    const old = await env.TIPPS.get(`tip:${day}:${me.id}`, 'json');
    if (old && !old.late) return json({ error: `${me.name} hat selbst getippt. Ein eigener Tipp wird nicht überschrieben.` }, 409, cors);
    const player = ((await siteJson(env, 'mvp-tipps_players.json')).players || []).find(p => String(p.id) === playerId);
    if (!player) return json({ error: 'Spieler nicht gefunden.' }, 400, cors);
    const tip = { name: me.name, playerId, player: player.name, team: player.team, points, late: true, updatedAt: new Date().toISOString() };
    await env.TIPPS.put(`tip:${day}:${me.id}`, JSON.stringify(tip));
    return json({ ok: true, tip }, 200, cors);
  }
  if (!parts[2] && req.method === 'GET') {
    const [tips, codes, rule] = await Promise.all([listTips(env, day), codeIds(env), env.TIPPS.get(`rule:${day}`, 'json')]);
    const reveal = st.locked && st.status !== 'upcoming';
    return json({ day, ...st, reveal, rule: rule || null, rules: info.rules || [], wertungen: info.wertungen || [], managers: managers.map(m => {
      const t = tips[m.id];
      return { id: String(m.id), name: m.name, tipped: !!t, hasCode: codes.has(String(m.id)), ...(t && reveal ? { tip: { playerId: t.playerId, player: t.player, team: t.team, points: t.points, updatedAt: t.updatedAt, ...(t.late ? { late: true } : {}) } } : {}) };
    }), me: null, admin: false, result: null, online: true }, 200, cors);
  }
  return json({ error: 'Nicht gefunden.' }, 404, cors);
}

export default {
  async fetch(req, env) {
    // Nur die eigene Online-Seite darf aus dem Browser zugreifen (ALLOWED_ORIGIN, Standard: Herkunft von SITE_URL).
    const allowed = String(env.ALLOWED_ORIGIN || (env.SITE_URL ? new URL(env.SITE_URL).origin : '')).replace(/\/+$/, '');
    const origin = req.headers.get('Origin') || '';
    const cors = origin && (origin === allowed || /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) ? { 'Access-Control-Allow-Origin': origin, 'Vary': 'Origin' } : {};
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: { ...cors, 'Access-Control-Allow-Methods': 'GET, PUT, POST, DELETE', 'Access-Control-Allow-Headers': 'Content-Type, X-Admin-Code', 'Access-Control-Max-Age': '86400' } });
    if (!env.TIPPS) return json({ error: 'KV-Speicher TIPPS ist nicht verbunden.' }, 500, cors);
    try { return await handle(req, env, cors); }
    catch (e) { return json({ error: e.message || 'Fehler im Tippdienst.' }, 502, cors); }
  }
};
