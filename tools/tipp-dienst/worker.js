// KBL Legenden · Online-Tippdienst fuer den MVP-Tipp (Cloudflare Worker, kostenloser Tarif).
// Nimmt die verdeckten Tipps an, solange der Spieltag nicht angepfiffen ist, und zeigt sie erst danach.
// Managerliste, Spielerliste und Regel-Vorlagen liest er von der Online-Seite (data/mvp-tipps*.json),
// Anstosszeiten von OpenLigaDB. Kickbase braucht er nicht. Die Auswertung macht weiter die App (GitHub-Export holt /export).
// Einstellungen im Cloudflare-Dashboard: KV-Bindung TIPPS, Variable SITE_URL, Geheimnis ADMIN_CODE, Cron-Trigger */5 * * * * (Push),
// D1-Bindung NUTZUNG (Nutzung der Seite zaehlen, freiwillig). Anleitung: ANLEITUNG.md.
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
// KV list() ist im kostenlosen Tarif auf 1000 Aufrufe am Tag begrenzt (am 31.10. erreicht: "KV list() limit exceeded").
// Darum nie mehr list() fuer Tipps, Codes, Regeln, Haken und Berichte: Die Schluessel sind bekannt (Manager-IDs, Spieltage),
// einzelne get() sind mit 100.000 am Tag reichlich. Reaktionen und Push-Abos liegen in D1 (unten).
const mgrIds = info => (info.managers || []).map(m => String(m.id)).filter(id => /^\d{1,15}$/.test(id) && id !== '3783040');
async function listTips(env, day, ids) {
  const out = {};
  await Promise.all(ids.map(async id => { const v = await env.TIPPS.get(`tip:${day}:${id}`, 'json'); if (v) out[id] = v; }));
  return out;
}
// Tipp-Codes gelten je Spieltag (Kevin-Vorgabe 30.10.): KV code:<day>:<id>. Alte Eintraege code:<id> nur noch fuer schon abgegebene Tipps (Uebergang).
async function codeIds(env, day, ids, tips) {
  const has = new Set();
  await Promise.all(ids.map(async id => {
    if (await env.TIPPS.get(`code:${day}:${id}`)) has.add(id);
    else if (tips[id] && await env.TIPPS.get(`code:${id}`)) has.add(id);
  }));
  return has;
}
// Tipps und Codes eines Spieltags. Nach dem Anpfiff aendert sich nur noch per Nachtrag etwas: dann ein einziger Schluessel
// tipsnap:<day> statt 32 Abrufen (erst ab 3 Min. nach dem Anpfiff, damit ein Tipp kurz vor Schluss sicher ueberall angekommen ist).
// Vorher kurz je Worker-Instanz zwischengespeichert, eigene Aenderungen loeschen den Zwischenstand.
async function dayTips(env, day, st, ids) {
  const reveal = st.locked && st.status !== 'upcoming', kick = Date.parse(st.deadline || '');
  if (reveal) {
    const snap = await env.TIPPS.get(`tipsnap:${day}`, 'json');
    if (snap?.tips) return { tips: snap.tips, codes: new Set(snap.codes || []) };
  }
  return cached(`tips:${day}`, reveal ? 60e3 : 15e3, async () => {
    const tips = await listTips(env, day, ids), codes = await codeIds(env, day, ids, tips);
    if (reveal && Number.isFinite(kick) && Date.now() - kick > 3 * 60e3)
      await env.TIPPS.put(`tipsnap:${day}`, JSON.stringify({ tips, codes: [...codes], at: new Date().toISOString() }));
    return { tips, codes };
  });
}
// Nach Nachtrag oder Code-Loeschung den gespeicherten Stand nachziehen (nur der Admin schreibt, also kein Wettlauf).
async function snapUpdate(env, day, fn) {
  memo.delete(`tips:${day}`);
  const snap = await env.TIPPS.get(`tipsnap:${day}`, 'json');
  if (!snap?.tips) return;
  fn(snap); snap.at = new Date().toISOString();
  await env.TIPPS.put(`tipsnap:${day}`, JSON.stringify(snap));
}
// Hoechster Spieltag, fuer den es schon Regeln, Haken oder Berichte geben kann (naechster offener plus einer).
const lastDay = days => Math.min(34, (days.find(d => d.status === 'upcoming')?.day || 34) + 1);
// Code pruefen; ohne gespeicherten Code wird er bei set=true festgelegt. Hoechstens 5 Fehlversuche in 15 Minuten.
async function checkCode(env, day, id, code, set) {
  if (!/^\d{4,8}$/.test(String(code || ''))) return { error: 'Bitte einen Code aus 4 bis 8 Ziffern eingeben.', status: 400 };
  const fails = (await env.TIPPS.get(`fail:${id}`, 'json')) || [];
  const recent = fails.filter(t => Date.now() - t < 15 * 60e3);
  if (recent.length >= 5) return { error: 'Zu viele falsche Codes. Bitte in 15 Minuten erneut versuchen.', status: 429 };
  let rec = await env.TIPPS.get(`code:${day}:${id}`, 'json');
  // Uebergang: Wer an diesem Spieltag schon mit dem alten, festen Code getippt hat, behaelt ihn fuer diesen Spieltag.
  if (!rec && await env.TIPPS.get(`tip:${day}:${id}`)) { rec = await env.TIPPS.get(`code:${id}`, 'json'); if (rec) await env.TIPPS.put(`code:${day}:${id}`, JSON.stringify(rec)); }
  if (!rec) {
    if (!set) return { error: 'Für diesen Namen gibt es an diesem Spieltag noch keinen Code. Er wird beim ersten Tipp des Spieltags festgelegt.', status: 404 };
    const salt = hex(crypto.getRandomValues(new Uint8Array(16)));
    await env.TIPPS.put(`code:${day}:${id}`, JSON.stringify({ salt, hash: await hashCode(code, salt), createdAt: new Date().toISOString() }));
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

// ===== Push-Nachrichten (Web Push, Kevin-Wunsch) =====
// Jeder schaltet auf der Online-Seite (🔔 oben) selbst ein und waehlt seinen Manager. Abos liegen in KV unter sub:<hash>
// (Daten in den Metadaten, damit eine einzige Liste reicht). Schluessel (VAPID) erzeugt der Dienst beim ersten Mal selbst
// und legt sie in KV ab (push:vapid). Der Zeitplan (Cron alle 5 Min.) liest die Online-Seite und schickt:
//  bums: "gebumst" (BD, RK, BN, UM) erst nach Spielende, je Spieler hoechstens einmal, je Manager gebuendelt,
//        erst wenn der Treffer 8 Min. lang stabil ist; nach der Abrechnung des Spieltags einmal alle Aufgaben (DD, AH, MM ...).
//  tipp: Tippschluss in einer Stunde, nur an Manager ohne Tipp.   mvp: getippter Spieler hat sein Spiel beendet.
const b64u = buf => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const unb64u = s => Uint8Array.from(atob(String(s).replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((String(s).length + 3) % 4)), c => c.charCodeAt(0));
const cat = (...a) => { const out = new Uint8Array(a.reduce((n, x) => n + x.length, 0)); let o = 0; for (const x of a) { out.set(x, o); o += x.length; } return out; };
async function hmac(key, data) { const k = await crypto.subtle.importKey('raw', key, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']); return new Uint8Array(await crypto.subtle.sign('HMAC', k, data)); }
const PUSH_HOSTS = /^(fcm\.googleapis\.com|android\.googleapis\.com|updates\.push\.services\.mozilla\.com|push\.services\.mozilla\.com|web\.push\.apple\.com|[a-z0-9.-]+\.notify\.windows\.com|[a-z0-9.-]+\.push\.apple\.com)$/;
const PUSH_PREFS = ['bums', 'tipp', 'mvp', 'spieltag', 'arena', 'l_bl1', 'l_bl2', 'l_laliga', 'l_fbl', 'l_mls'];
const BERLIN = { timeZone: 'Europe/Berlin' };

async function vapid(env) {
  const v = await env.TIPPS.get('push:vapid', 'json');
  if (v) return v;
  const kp = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  const nv = { publicKey: b64u(await crypto.subtle.exportKey('raw', kp.publicKey)), privateJwk: await crypto.subtle.exportKey('jwk', kp.privateKey), createdAt: new Date().toISOString() };
  await env.TIPPS.put('push:vapid', JSON.stringify(nv));
  return nv;
}
// Verschluesselung nach RFC 8291 (aes128gcm), Anmeldung beim Push-Dienst nach RFC 8292 (VAPID).
async function encryptPayload(sub, text) {
  const ua = unb64u(sub.p), auth = unb64u(sub.a);
  const kp = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const as = new Uint8Array(await crypto.subtle.exportKey('raw', kp.publicKey));
  const uaKey = await crypto.subtle.importKey('raw', ua, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const shared = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: uaKey }, kp.privateKey, 256));
  const ikm = await hmac(await hmac(auth, shared), cat(enc.encode('WebPush: info\0'), ua, as, new Uint8Array([1])));
  const salt = crypto.getRandomValues(new Uint8Array(16)), prk = await hmac(salt, ikm);
  const cek = (await hmac(prk, cat(enc.encode('Content-Encoding: aes128gcm\0'), new Uint8Array([1])))).slice(0, 16);
  const nonce = (await hmac(prk, cat(enc.encode('Content-Encoding: nonce\0'), new Uint8Array([1])))).slice(0, 12);
  const key = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['encrypt']);
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, key, cat(enc.encode(text), new Uint8Array([2]))));
  return cat(salt, new Uint8Array([0, 0, 16, 0]), new Uint8Array([as.length]), as, ct);
}
const jwtMemo = new Map();
async function vapidHeader(env, keys, endpoint) {
  const aud = new URL(endpoint).origin, c = jwtMemo.get(aud);
  if (c && c.exp - Date.now() > 3600e3) return c.value;
  const exp = Date.now() + 12 * 3600e3;
  const head = b64u(enc.encode(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
  const body = b64u(enc.encode(JSON.stringify({ aud, exp: Math.floor(exp / 1000), sub: env.VAPID_SUBJECT || String(env.SITE_URL || 'https://tee800.github.io/kbl-legenden') })));
  const pk = await crypto.subtle.importKey('jwk', keys.privateJwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, pk, enc.encode(`${head}.${body}`));
  const value = `vapid t=${head}.${body}.${b64u(sig)}, k=${keys.publicKey}`;
  jwtMemo.set(aud, { exp, value });
  return value;
}
// Eine Nachricht an ein Abo. Antwortet der Push-Dienst mit 404/410, ist das Abo erloschen und wird geloescht.
async function sendPush(env, keys, sub, msg) {
  const body = await encryptPayload(sub, JSON.stringify(msg));
  const r = await fetch(sub.e, { method: 'POST', body, headers: { Authorization: await vapidHeader(env, keys, sub.e), 'Content-Encoding': 'aes128gcm', 'Content-Type': 'application/octet-stream', TTL: String(msg.ttl || 6 * 3600), Urgency: 'normal', ...(msg.tag ? { Topic: String(msg.tag).replace(/[^A-Za-z0-9_-]/g, '').slice(0, 32) } : {}) } });
  if (r.status === 404 || r.status === 410) { await subDrop(env, sub.key); return 'gone'; }
  return r.ok ? 'ok' : `HTTP ${r.status}`;
}
async function subKey(endpoint) { return 'sub:' + hex(await crypto.subtle.digest('SHA-256', enc.encode(endpoint))).slice(0, 40); }
async function kvSubs(env) {
  const out = []; let cursor;
  do {
    const page = await env.TIPPS.list({ prefix: 'sub:', cursor });
    for (const k of page.keys) { const m = k.metadata || await env.TIPPS.get(k.name, 'json'); if (m?.e) out.push({ ...m, key: k.name }); }
    cursor = page.list_complete ? null : page.cursor;
  } while (cursor);
  return out;
}
// Abos stehen weiter einzeln in KV (sub:<hash>), die Liste fuer den Versand kommt aber aus D1 (kein KV list(), siehe oben).
// Beim ersten Mal werden die vorhandenen KV-Abos einmalig nach D1 uebernommen.
async function listSubs(env) {
  const db = await d1(env);
  if (!db) return kvSubs(env);
  await d1Import(env, db, 'subs', async () => kvSubs(env).then(list => list.map(m => db.prepare('INSERT OR IGNORE INTO subs (key, meta) VALUES (?, ?)').bind(m.key, JSON.stringify(m)))));
  const rows = (await db.prepare('SELECT key, meta FROM subs').all()).results || [];
  return rows.map(r => { try { return { ...JSON.parse(r.meta), key: r.key }; } catch { return null; } }).filter(m => m?.e);
}
async function subSave(env, key, meta) { const db = await d1(env); if (db) await db.prepare('INSERT OR REPLACE INTO subs (key, meta) VALUES (?, ?)').bind(key, JSON.stringify(meta)).run(); }
async function subDrop(env, key) { await env.TIPPS.delete(key); const db = await d1(env); if (db) await db.prepare('DELETE FROM subs WHERE key = ?').bind(key).run(); }
async function freshSite(env, file) {
  const base = String(env.SITE_URL || '').replace(/\/+$/, '');
  const r = await fetch(`${base}/data/${file}?t=${Math.floor(Date.now() / 60e3)}`, { cf: { cacheTtl: 0 } });
  if (r.status === 404) return null;
  if (!r.ok) throw new Error(`${file}: HTTP ${r.status}`);
  const d = await r.json();
  return d && d.__status ? null : d;
}
const fmtTime = ms => new Date(ms).toLocaleTimeString('de-DE', { ...BERLIN, hour: '2-digit', minute: '2-digit' });
const fmtDay = ms => new Date(ms).toLocaleDateString('de-DE', { ...BERLIN, weekday: 'short' }) + ' ' + fmtTime(ms);
const berlinHour = () => Number(new Intl.DateTimeFormat('en-GB', { ...BERLIN, hour: '2-digit', hourCycle: 'h23' }).format(new Date()));
// Waehrend des Spieltags nur melden, was passiert ist, keine Aufforderung (Kevin-Vorgabe: verkauft wird erst nach der Abrechnung).
const BUMS_LIVE = { BD: 1, RK: 1, BN: 1, UM: 1 };
function liveLine(it) {
  if (it.rule === 'BD') return `🍺 ${it.playerName} ist besoffen!${Number.isFinite(it.points) ? ` (${it.points} Punkte)` : ''}`;
  if (it.rule === 'UM') return `UM · ${it.playerName}: Foul-Elfmeter verursacht`;
  return `${it.rule} · ${it.playerName}${it.reason ? `: ${it.reason}` : ''}`;
}

// Zeitplan: alle 5 Minuten. Schreibt in KV nur, wenn sich etwas tut (kostenloser Tarif: 1000 Schreibvorgaenge am Tag).
async function pushTick(env) {
  const now = Date.now(), days = await matchdays(), outbox = [];
  const stateKey = d => `push:st:${d}`;
  // 1. Tippschluss in einer Stunde (nur wer noch nicht getippt hat).
  const next = days.find(d => d.status === 'upcoming'), kick = next?.firstKickoffUTC ? Date.parse(next.firstKickoffUTC) : NaN;
  if (Number.isFinite(kick) && kick - now > 0 && kick - now <= 61 * 60e3 && !(await env.TIPPS.get(`push:done:tipp:${next.day}`))) {
    const [tips, rule] = await Promise.all([siteJson(env, 'mvp-tipps.json').then(info => listTips(env, next.day, mgrIds(info))), env.TIPPS.get(`rule:${next.day}`, 'json')]);
    const mins = Math.max(1, Math.round((kick - now) / 60e3));
    outbox.push({ pref: 'tipp', skip: id => !!tips[id], done: async () => env.TIPPS.put(`push:done:tipp:${next.day}`, '1', { expirationTtl: 14 * 86400 }),
      msg: () => ({ title: `⏰ Tippschluss in ${mins} Minuten`, body: `Du hast für Spieltag ${next.day} noch keinen MVP-Tipp. Anstoß ${fmtTime(kick)} Uhr: ${next.firstMatch || ''}${rule?.text ? `\nTippregel: ${rule.text}` : ''}`.trim(), url: './#mvp', tag: `tipp${next.day}`, ttl: Math.max(60, Math.round((kick - now) / 1000)) }) });
  }
  // 1b. Ligenuebersicht (Kevin-Wunsch): 1 Std. vor dem ersten Anstoss eines Spieltags je Liga (Anlass l_<liga>).
  // Anstosszeiten aus data/ligen.json (Export aus Kickbase), nur wenn noch kein Spiel des Spieltags begonnen hat.
  const ligen = await siteJson(env, 'ligen.json').catch(() => null);
  for (const l of (ligen?.leagues || [])) for (const d of (l.days || [])) {
    const t = Date.parse(d.first || ''), doneKey = `push:done:liga:${l.key}:${d.day}`;
    if (!Number.isFinite(t) || t - now <= 0 || t - now > 61 * 60e3 || (d.matches || []).some(m => m.state !== 'open')) continue;
    if (await env.TIPPS.get(doneKey)) continue;
    const mins = Math.max(1, Math.round((t - now) / 60e3)), team = id => l.teams?.[id]?.n || l.teams?.[id]?.sy || '?';
    const first = (d.matches || []).filter(m => Date.parse(m.dt) === t).map(m => `${team(m.t1)} – ${team(m.t2)}`);
    const rest = (d.matches || []).length - first.length;
    outbox.push({ pref: 'l_' + l.key, done: async () => env.TIPPS.put(doneKey, '1', { expirationTtl: 14 * 86400 }),
      msg: () => ({ title: `⚽ ${l.name}: ${d.label || `Spieltag ${d.day}`} beginnt in ${mins} Minuten`, body: `Anstoß ${fmtTime(t)} Uhr: ${first.slice(0, 3).join(', ')}${first.length > 3 ? ` und ${first.length - 3} weitere` : ''}${rest > 0 ? `\nDanach noch ${rest} ${rest === 1 ? 'Spiel' : 'Spiele'}.` : ''}`, url: './#ligen', tag: `liga-${l.key}-${d.day}`, ttl: Math.max(60, Math.round((t - now) / 1000)) }) });
  }
  // 2. Laufende und gerade beendete Spieltage.
  const active = days.filter(d => d.status === 'live' || (d.status === 'finished' && d.firstKickoffUTC && now - Date.parse(d.firstKickoffUTC) < 5 * 86400e3));
  const states = new Map();
  for (const d of active) {
    const st = (await env.TIPPS.get(stateKey(d.day), 'json')) || { seen: {}, sent: {}, end: false };
    if (d.status === 'finished' && st.end) continue;
    states.set(d.day, { st, dirty: false });
    const S = states.get(d.day), stable = k => { if (!S.st.seen[k]) { S.st.seen[k] = now; S.dirty = true; return false; } return now - S.st.seen[k] >= 8 * 60e3; };
    if (d.status === 'live') {
      const live = await freshSite(env, `rule-live_${d.day}.json`).catch(() => null);
      const per = new Map();
      for (const it of (live?.live ? live.items || [] : [])) {
        if (!BUMS_LIVE[it.rule] || it.unclear || it.state !== 'done' || !it.playerId) continue;
        const k = `${it.rule}:${it.managerId}:${it.playerId}`;
        if (S.st.sent[k] || !stable(k)) continue;
        if (!per.has(it.managerId)) per.set(it.managerId, []);
        per.get(it.managerId).push({ k, line: liveLine(it), pid: it.playerId, name: it.playerName });
        // UM: Der Besitzer des gefoulten Spielers bekaeme ihn (Kevin-Wunsch: "Du bekommst einen Spieler").
        if (it.rule === 'UM') for (const name of (it.to || [])) {
          const r = (live.standings || []).find(x => x.manager === name), rk = r && `UMR:${r.managerId}:${it.playerId}`;
          if (!r || S.st.sent[rk]) continue;
          if (!per.has(r.managerId)) per.set(r.managerId, []);
          per.get(r.managerId).push({ k: rk, get: 1, line: `🎁 UM · ${it.playerName} (${it.manager}) hat deinen Spieler gefoult und ginge an dich` });
        }
      }
      // Entwarnung (Kevin-Wunsch): Wurde "besoffen" gemeldet und ist die Schnapszahl durch eine Korrektur weg, einmal "wieder nuechtern".
      const schnaps = n => Math.abs(n) >= 11 && /^(\d)\1+$/.test(String(Math.abs(n)));
      for (const k of Object.keys(S.st.sent)) {
        const [r, mid, pid] = k.split(':'), pts = live?.donePoints?.[pid], nk = `NUE:${mid}:${pid}`;
        if (r !== 'BD' || !live?.live || !Number.isFinite(pts) || schnaps(pts) || S.st.sent[nk] || !stable(nk)) continue;
        const name = (live.items || []).find(x => x.playerId === pid)?.playerName || S.st.names?.[pid] || 'Dein Spieler';
        if (!per.has(mid)) per.set(mid, []);
        per.get(mid).push({ k: nk, calm: 1, line: `☕ ${name} ist wieder nüchtern (jetzt ${pts} Punkte)` });
      }
      for (const [mid, list] of per) outbox.push({ pref: 'bums', only: mid, done: () => { for (const x of list) { S.st.sent[x.k] = now; if (x.pid) (S.st.names ||= {})[x.pid] = x.name; } S.dirty = true; },
        msg: () => ({ title: list.every(x => x.calm) ? '☕ Entwarnung' : list.every(x => x.get) ? '🎁 Du bekommst vielleicht einen Spieler' : list.length > 1 ? `💥 Du wurdest ${list.length}× gebumst!` : '💥 Du wurdest gebumst!', body: list.map(x => x.line).join('\n') + (list.every(x => x.calm) ? '' : '\nVorläufig, abgerechnet wird zur BumsParade.'), url: './#accounting', tag: `bums${d.day}` }) });
      // MVP-Tipp: getippter Spieler hat sein Spiel beendet.
      const mt = await freshSite(env, `mvp-tipps_${d.day}.json`).catch(() => null), tr = mt?.tracking;
      const lead = tr?.mvp?.players?.length ? `${tr.mvp.players.map(p => p.name).join(', ')} (${tr.mvp.points} Punkte)` : '';
      for (const m of (mt?.managers || [])) {
        const t = m.tip, p = t && tr?.players?.[t.playerId], k = `MVP:${m.id}`;
        if (!p || p.state !== 'done' || !Number.isFinite(p.points) || S.st.sent[k] || !stable(k)) continue;
        outbox.push({ pref: 'mvp', only: String(m.id), done: () => { S.st.sent[k] = now; S.dirty = true; },
          msg: () => ({ title: `🎯 ${t.player} ist fertig: ${p.points} Punkte`, body: `Dein MVP-Tipp für Spieltag ${d.day}: getippt ${t.points}, geholt ${p.points}.${lead ? `\nGerade vorn laut Tippregel: ${lead}` : ''}`, url: './#mvp', tag: `mvp${d.day}` }) });
      }
    } else if (berlinHour() >= 8) {
      // Spieltag beendet (laut Online-Seite). Nachts (vor 8 Uhr) wird gewartet. Jeder Teil einmal, je Manager eine Nachricht;
      // ein Teil gilt erst als erledigt, wenn alle seine Nachrichten raus sind (SEC:…), danach ist der Spieltag fertig (end).
      const status = await freshSite(env, 'matchday-status.json').catch(() => null);
      if (status?.days?.find(x => x.day === d.day)?.status !== 'finished') continue;
      const SECS = ['acc', 'sum', 'mvp', 'arena'], secDone = sec => () => { S.st.sent['SEC:' + sec] = now; if (SECS.every(x => S.st.sent['SEC:' + x])) S.st.end = true; S.dirty = true; };
      const perMsg = (sec, pref, per, make) => {
        for (const [mid, data] of per) { const k = `${sec.toUpperCase()}:${mid}`; if (S.st.sent[k]) continue;
          outbox.push({ pref, only: mid, done: () => { S.st.sent[k] = now; S.dirty = true; }, msg: () => make(mid, data) }); }
        outbox.push({ pref: null, done: secDone(sec) });
      };
      const open = sec => !S.st.sent['SEC:' + sec];
      // a) BumsParade: eigene Aufgaben und was man bekommt (DD: Letzter sucht aus, UM: Empfaenger), ohne Erledigtes und schon Gemeldetes.
      if (open('acc')) {
        const acc = await freshSite(env, `rule-accounting_${d.day}.json`).catch(() => null);
        if (acc?.ready && acc.complete && !acc.pendingCorrections) {
          const per = new Map(), add = (mid, line) => { mid = String(mid); if (!per.has(mid)) per.set(mid, { give: [], get: [] }); per.get(mid)[line.get ? 'get' : 'give'].push(line.text); };
          const todo = new Map((acc.todos || []).map(t => [t.key, t]));
          for (const t of (acc.todos || [])) if (t.managerId && t.text && !t.check?.removed && t.check?.state !== 'done' && !S.st.sent[t.key]) add(t.managerId, { text: `${t.rule} · ${t.text}` });
          for (const w of (acc.dd?.winners || [])) {
            const t = todo.get(`DD:${w.managerId}`); if (!t || t.check?.removed || t.check?.state === 'done') continue;
            for (const l of (acc.dd?.lastPlace || [])) add(l.managerId, { get: 1, text: `DD · Du darfst dir einen Spieler von ${w.manager} aussuchen${(w.candidates || []).length ? ': ' + w.candidates.map(c => c.playerName).join(', ') : ''}` });
          }
          for (const a of (acc.autoEvents?.actions || [])) {
            const t = todo.get(`UM:${a.managerId}:${a.playerId}`);
            if (a.rule === 'UM' && a.recipientId && t && !t.check?.removed && t.check?.state !== 'done') add(a.recipientId, { get: 1, text: `UM · Du bekommst ${a.playerName} von ${a.manager}` });
          }
          const dl = acc.saleDeadline ? Date.parse(acc.saleDeadline) : NaN;
          perMsg('acc', 'bums', per, (mid, x) => ({ title: x.give.length ? `💥 BumsParade Spieltag ${d.day}` : `🎁 BumsParade Spieltag ${d.day}: du bekommst was`,
            body: [...x.give, ...x.get].join('\n') + (Number.isFinite(dl) ? `\nFrist: ${fmtDay(dl)} Uhr` : ''), url: './#accounting', tag: `abr${d.day}`, ttl: 24 * 3600 }));
        }
      }
      // b) Spieltag vorbei: Sieger, Letzter, eigener Platz (ohne T1000).
      if (open('sum')) {
        const rk = await freshSite(env, `ranking_6422780_dayNumber_${d.day}.json`).catch(() => null);
        const us = (rk?.us || []).filter(u => String(u.i) !== '3783040' && String(u.n || '').toLowerCase() !== 't1000' && Number.isFinite(u.mdp));
        if (us.length && !rk.il && us.some(u => u.mdp)) {
          const day = [...us].sort((a, b) => b.mdp - a.mdp), all = [...us].sort((a, b) => (b.sp || 0) - (a.sp || 0));
          const top = day.filter(u => u.mdp === day[0].mdp), low = day.filter(u => u.mdp === day[day.length - 1].mdp);
          const place = (list, u, f) => 1 + list.filter(x => f(x) > f(u)).length;
          const per = new Map(us.map(u => [String(u.i), u]));
          perMsg('sum', 'spieltag', per, (mid, u) => {
            const p = place(day, u, x => x.mdp), win = top.some(x => x === u), last = low.some(x => x === u);
            return { title: win ? `🥇 Du hast Spieltag ${d.day} gewonnen!` : last ? `🪦 Letzter an Spieltag ${d.day}` : `📊 Spieltag ${d.day} ist vorbei`,
              body: `Sieger: ${top.map(x => `${x.n} (${x.mdp})`).join(', ')}\nLetzter: ${low.map(x => `${x.n} (${x.mdp})`).join(', ')}\nDu: Platz ${p} mit ${u.mdp} Punkten, gesamt Platz ${place(all, u, x => x.sp || 0)}`, url: './#table', tag: `sum${d.day}` };
          });
        }
      }
      // c) MVP-Tipp-Ergebnis. Ohne Tippregel gibt es nichts zu melden.
      if (open('mvp')) {
        const mt = await freshSite(env, `mvp-tipps_${d.day}.json`).catch(() => null), r = mt?.result;
        if (mt && !mt.rule) secDone('mvp')();
        else if (r && ['ok', 'unsure', 'manual'].includes(r.status)) {
          const names = new Map((mt.managers || []).map(m => [String(m.id), m])), win = (r.winners || []).map(String);
          const mvp = r.mvp?.players?.length ? `${r.mvp.players.map(p => p.name).join(', ')} (${r.mvp.points} Punkte)` : '';
          const per = new Map((mt.managers || []).map(m => [String(m.id), m]));
          perMsg('mvp', 'mvp', per, (mid, m) => {
            const row = (r.rows || []).find(x => String(x.managerId) === mid), t = m.tip;
            const winTxt = win.length ? `Gewonnen: ${win.map(id => { const w = names.get(id); return w ? `${w.name}${w.tip ? ` (${w.tip.player}, ${w.tip.points})` : ''}` : id; }).join(', ')}` : r.status === 'manual' ? 'Den Gewinner bestimmt ihr selbst.' : 'Diesmal hat keiner gewonnen.';
            return { title: win.includes(mid) ? `🏆 Du hast den MVP-Tipp gewonnen!` : `🎯 MVP-Tipp Spieltag ${d.day}: Ergebnis`,
              body: [mvp && `MVP laut Tippregel: ${mvp}`, winTxt, t ? `Dein Tipp: ${t.player}, ${t.points}${Number.isFinite(row?.actual) && row.actual !== r.mvp?.points ? ` (geholt ${row.actual})` : ''}` : '', r.status === 'unsure' ? 'Noch vorläufig.' : ''].filter(Boolean).join('\n'), url: './#mvp', tag: `mvpr${d.day}` };
          });
        }
      }
      // d) Arena-Duell (zweite Liga, gleiche Manager-IDs).
      if (open('arena')) {
        const ar = await freshSite(env, `arena_${d.day}.json`).catch(() => null);
        if (ar && !(ar.duels || []).length) secDone('arena')();
        else if (ar?.status === 'finished' && ar.duels.every(x => x.final)) {
          const per = new Map(), tab = ar.tableDay === d.day ? ar.table || [] : [];
          for (const x of ar.duels) for (const [me, op] of [[x.a, x.b], [x.b, x.a]]) if (me?.id && !me.cpu) per.set(String(me.id), { me, op, w: x.winner });
          perMsg('arena', 'arena', per, (mid, x) => {
            const res = !x.w ? 'Unentschieden' : String(x.w) === mid ? 'Sieg' : 'Niederlage', row = tab.find(t => String(t.id) === mid);
            return { title: `⚔️ Arena: ${res}${res === 'Sieg' ? '!' : ''}`, body: `Spieltag ${d.day}: ${x.me.points} : ${x.op.points} gegen ${x.op.name}${row ? `\nArena-Tabelle: Platz ${row.hhpl} (${row.hhsp} Punkte)` : ''}`, url: './#arena', tag: `arena${d.day}` };
          });
        }
      }
    }
  }
  // 3. Verschicken (hoechstens 40 Nachrichten je Lauf; der Rest kommt beim naechsten Lauf).
  if (outbox.some(o => o.pref)) {
    const [keys, subs] = await Promise.all([vapid(env), listSubs(env)]);
    let budget = 40;
    for (const o of outbox) {
      if (!o.pref) { if (budget > 0) await o.done(); continue; }
      const to = subs.filter(s => s.pr?.[o.pref] && s.k === keys.publicKey && (!o.only || String(s.m) === o.only) && !(o.skip && o.skip(String(s.m))));
      if (to.length > budget) { budget = 0; continue; }
      const msg = o.msg();
      for (const s of to) { budget--; try { await sendPush(env, keys, s, msg); } catch {} }
      if (o.done) await o.done();
    }
  }
  for (const [day, S] of states) if (S.dirty) await env.TIPPS.put(stateKey(day), JSON.stringify(S.st), { expirationTtl: 30 * 86400 });
}

async function handlePush(req, env, cors, parts, body) {
  if (parts[1] === 'info' && req.method === 'GET') {
    const [keys, info] = await Promise.all([vapid(env), siteJson(env, 'mvp-tipps.json')]);
    const managers = (info.managers || []).filter(m => /^\d{1,15}$/.test(String(m.id)) && String(m.id) !== '3783040').map(m => ({ id: String(m.id), name: m.name }));
    return json({ publicKey: keys.publicKey, managers, prefs: PUSH_PREFS }, 200, cors);
  }
  const s = body.subscription || {}, endpoint = String(s.endpoint || body.endpoint || '');
  let host = ''; try { const u = new URL(endpoint); host = u.protocol === 'https:' ? u.hostname : ''; } catch {}
  if (!PUSH_HOSTS.test(host) || endpoint.length > 600) return json({ error: 'Unbekannter Push-Dienst.' }, 400, cors);
  const key = await subKey(endpoint);
  if (parts[1] === 'subscribe' && req.method === 'POST') {
    const p = String(s.keys?.p256dh || ''), a = String(s.keys?.auth || '');
    if (!/^[A-Za-z0-9_-]{80,100}$/.test(p) || !/^[A-Za-z0-9_-]{16,30}$/.test(a)) return json({ error: 'Ungültiges Abo.' }, 400, cors);
    const info = await siteJson(env, 'mvp-tipps.json'), m = String(body.managerId || '');
    if (!(info.managers || []).some(x => String(x.id) === m) || m === '3783040') return json({ error: 'Bitte deinen Namen aus der Liste wählen.' }, 400, cors);
    const keys = await vapid(env), pr = {};
    for (const k of PUSH_PREFS) if (body.prefs?.[k]) pr[k] = 1;
    const meta = { e: endpoint, p, a, m, pr, k: keys.publicKey, at: new Date().toISOString() };
    await env.TIPPS.put(key, JSON.stringify(meta), { metadata: meta, expirationTtl: 400 * 86400 });
    await subSave(env, key, meta);
    return json({ ok: true }, 200, cors);
  }
  if (parts[1] === 'unsubscribe' && req.method === 'POST') { await subDrop(env, key); return json({ ok: true }, 200, cors); }
  if (parts[1] === 'test' && req.method === 'POST') {
    const sub = await env.TIPPS.get(key, 'json');
    if (!sub) return json({ error: 'Dieses Gerät ist nicht angemeldet.' }, 404, cors);
    const last = memo.get('test:' + key);
    if (last && Date.now() - last.at < 30e3) return json({ error: 'Bitte kurz warten.' }, 429, cors);
    memo.set('test:' + key, { at: Date.now() });
    const r = await sendPush(env, await vapid(env), { ...sub, key }, { title: '🔔 KBL Legenden', body: 'Push-Nachrichten funktionieren. Bis zur nächsten Bumsung!', url: './', tag: 'test' });
    return r === 'ok' ? json({ ok: true }, 200, cors) : json({ error: `Push-Dienst antwortet: ${r}` }, 502, cors);
  }
  return json({ error: 'Nicht gefunden.' }, 404, cors);
}

// ===== Nutzung der Online-Seite (Kevin-Wunsch, nur fuer den Admin) =====
// Die Seite meldet je Besuch und je geoeffnetem Reiter einen kleinen Eintrag (public/nutzung.js). Gespeichert in der
// D1-Datenbank NUTZUNG (kostenlos: 100.000 Schreibvorgaenge am Tag; KV haette nur 1000). Keine IP, kein Name im Klartext:
// Besucher = Zufallsnummer des Geraets, Manager nur, wenn auf dem Geraet einer gewaehlt ist (🔔 oder MVP-Tipp).
// Die Zahlen gibt es nur mit dem Admin-Code (POST /nutzung/zahlen), hoechstens 5 Fehlversuche in 15 Minuten.
const NZ_VIEWS = /^[a-z]{2,20}$/;
const berlinDate = ms => new Intl.DateTimeFormat('en-CA', { ...BERLIN, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(ms));
const berlinH = ms => Number(new Intl.DateTimeFormat('en-GB', { ...BERLIN, hour: '2-digit', hourCycle: 'h23' }).format(new Date(ms)));
async function nzDb(env) {
  if (!env.NUTZUNG) return null;
  if (!memo.get('nz:init')) {
    await env.NUTZUNG.batch([
      env.NUTZUNG.prepare('CREATE TABLE IF NOT EXISTS hits (ts INTEGER NOT NULL, d TEXT NOT NULL, h INTEGER, vid TEXT NOT NULL, mid TEXT, kind TEXT NOT NULL, view TEXT, dev TEXT, app INTEGER)'),
      env.NUTZUNG.prepare('CREATE INDEX IF NOT EXISTS hits_d ON hits (d)'),
      env.NUTZUNG.prepare('CREATE INDEX IF NOT EXISTS hits_ts ON hits (ts)')
    ]);
    memo.set('nz:init', { at: Date.now(), value: 1 });
  }
  return env.NUTZUNG;
}
// Weitere Tabellen in derselben D1-Datenbank: Reaktionen und Push-Abos (D1 kann zaehlen und auflisten ohne Tageslimit wie KV list()).
async function d1(env) {
  const db = await nzDb(env);
  if (!db || memo.get('d1:init')) return db;
  await db.batch([
    db.prepare('CREATE TABLE IF NOT EXISTS reakt (day INTEGER NOT NULL, vid TEXT NOT NULL, r TEXT NOT NULL, PRIMARY KEY (day, vid))'),
    db.prepare('CREATE TABLE IF NOT EXISTS subs (key TEXT PRIMARY KEY, meta TEXT NOT NULL)'),
    db.prepare('CREATE TABLE IF NOT EXISTS kv_import (name TEXT PRIMARY KEY, at INTEGER)')
  ]);
  memo.set('d1:init', { at: Date.now(), value: 1 });
  return db;
}
// Alte KV-Eintraege einmalig nach D1 uebernehmen (ein einziges list() je Bereich, danach nie wieder).
async function d1Import(env, db, name, load) {
  if (memo.get('imp:' + name)) return;
  const f = memo.get('impfail:' + name); if (f && Date.now() - f.at < 10 * 60e3) return; // KV list() gerade gesperrt: spaeter erneut
  if (!await db.prepare('SELECT 1 FROM kv_import WHERE name = ?').bind(name).first()) {
    let stmts; try { stmts = await load(); } catch (e) { console.log('Import', name, e.message); memo.set('impfail:' + name, { at: Date.now(), value: 1 }); return; }
    for (let i = 0; i < stmts.length; i += 50) await db.batch(stmts.slice(i, i + 50));
    await db.prepare('INSERT OR IGNORE INTO kv_import (name, at) VALUES (?, ?)').bind(name, Date.now()).run();
  }
  memo.set('imp:' + name, { at: Date.now(), value: 1 });
}
async function handleNutzung(req, env, cors, parts, body) {
  if (parts[1] === 'melden' && req.method === 'POST') {
    const db = await nzDb(env);
    if (!db) return json({ ok: false }, 200, cors);
    const vid = String(body.vid || ''), kind = body.kind === 'open' ? 'open' : 'view', view = String(body.view || '');
    if (!/^[a-z0-9]{8,32}$/.test(vid) || !NZ_VIEWS.test(view)) return json({ error: 'Ungültig.' }, 400, cors);
    // Schutz gegen Dauerfeuer: je Geraet hoechstens 200 Meldungen pro Stunde (je Worker-Instanz).
    const k = 'nzr:' + vid, r = memo.get(k), now = Date.now();
    const n = r && now - r.at < 3600e3 ? r.value + 1 : 1;
    memo.set(k, { at: n === 1 ? now : r.at, value: n });
    if (n > 200) return json({ ok: false }, 429, cors);
    const mid = /^\d{1,15}$/.test(String(body.mid || '')) && String(body.mid) !== '3783040' ? String(body.mid) : null;
    const dev = ['handy', 'tablet', 'pc'].includes(body.dev) ? body.dev : null;
    await db.prepare('INSERT INTO hits (ts, d, h, vid, mid, kind, view, dev, app) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .bind(now, berlinDate(now), berlinH(now), vid, mid, kind, view, dev, body.app ? 1 : 0).run();
    return json({ ok: true }, 200, cors);
  }
  if (parts[1] === 'zahlen' && req.method === 'POST') {
    const fails = ((await env.TIPPS.get('fail:nutzung', 'json')) || []).filter(t => Date.now() - t < 15 * 60e3);
    if (fails.length >= 5) return json({ error: 'Zu viele falsche Codes. Bitte in 15 Minuten erneut versuchen.' }, 429, cors);
    if (!isAdmin(env, body.adminCode)) {
      fails.push(Date.now());
      await env.TIPPS.put('fail:nutzung', JSON.stringify(fails), { expirationTtl: 16 * 60 });
      return json({ error: 'Falscher Code.' }, 403, cors);
    }
    const db = await nzDb(env);
    if (!db) return json({ error: 'Die Datenbank NUTZUNG ist im Tippdienst noch nicht verbunden (Anleitung: Nutzung zählen).' }, 503, cors);
    const tage = [7, 30, 90, 365].includes(Number(body.tage)) ? Number(body.tage) : 30;
    // Tage als Kalenderdaten zaehlen (nicht in Millisekunden), sonst verrutscht es bei der Zeitumstellung.
    const now = Date.now(), today = berlinDate(now), day = n => new Date(Date.parse(today + 'T12:00:00Z') - n * 864e5).toISOString().slice(0, 10);
    const from = day(tage - 1);
    // Alte Eintraege nach gut einem Jahr loeschen.
    await db.prepare('DELETE FROM hits WHERE ts < ?').bind(now - 400 * 864e5).run();
    const q = (sql, ...a) => db.prepare(sql).bind(...a);
    const sum = d => q("SELECT SUM(kind = 'open') AS visits, COUNT(DISTINCT vid) AS visitors, COUNT(DISTINCT mid) AS managers FROM hits WHERE d >= ?", d);
    const res = await db.batch([
      sum(today), sum(day(6)), sum(day(29)),
      q("SELECT SUM(kind = 'open') AS visits, COUNT(DISTINCT vid) AS visitors, MIN(d) AS since FROM hits"),
      q("SELECT d, SUM(kind = 'open') AS visits, COUNT(DISTINCT vid) AS visitors FROM hits WHERE d >= ? GROUP BY d ORDER BY d", from),
      q('SELECT view, COUNT(*) AS n, COUNT(DISTINCT vid) AS visitors FROM hits WHERE d >= ? GROUP BY view ORDER BY n DESC', from),
      q("SELECT mid, SUM(kind = 'open') AS visits, COUNT(*) AS views, COUNT(DISTINCT vid) AS devices, MAX(ts) AS last FROM hits WHERE d >= ? AND mid IS NOT NULL GROUP BY mid ORDER BY visits DESC", from),
      q('SELECT COUNT(DISTINCT vid) AS n FROM hits WHERE d >= ? AND vid NOT IN (SELECT DISTINCT vid FROM hits WHERE mid IS NOT NULL)', from),
      q("SELECT COALESCE(dev, '?') AS dev, app, COUNT(DISTINCT vid) AS visitors, SUM(kind = 'open') AS visits FROM hits WHERE d >= ? GROUP BY dev, app ORDER BY visits DESC", from),
      q("SELECT h, SUM(kind = 'open') AS visits FROM hits WHERE d >= ? GROUP BY h", from)
    ]);
    const rows = i => res[i].results || [], one = i => rows(i)[0] || {};
    const tile = r => ({ visits: r.visits || 0, visitors: r.visitors || 0, managers: r.managers || 0 });
    let names = {};
    try { for (const m of (await siteJson(env, 'mvp-tipps.json')).managers || []) names[String(m.id)] = m.name; } catch {}
    const hours = Array(24).fill(0); for (const r of rows(9)) if (r.h >= 0 && r.h < 24) hours[r.h] = r.visits || 0;
    const dayMap = new Map(rows(4).map(r => [r.d, r]));
    const daily = []; for (let i = tage - 1; i >= 0; i--) { const d = day(i), r = dayMap.get(d); daily.push({ d, visits: r?.visits || 0, visitors: r?.visitors || 0 }); }
    return json({ tage, today: tile(one(0)), d7: tile(one(1)), d30: tile(one(2)), all: { ...tile(one(3)), since: one(3).since || null },
      daily, views: rows(5), managers: rows(6).map(r => ({ ...r, name: names[r.mid] || `Manager ${r.mid}` })),
      unknown: one(7).n || 0, devices: rows(8), hours, at: new Date(now).toISOString() }, 200, cors);
  }
  return json({ error: 'Nicht gefunden.' }, 404, cors);
}

// BumsParade-Haken von der Online-Seite (Kevin-Wunsch): nur mit Admin-Code. KV haken:<day> = { key: {done, target?, removed?, at} },
// done:false bleibt als Eintrag stehen (zaehlt gegen einen aelteren Haken vom PC). Der GitHub-Export mischt alles nach "at" in
// kbl-todo-checks.json, die Online-Seite mischt es beim Anzeigen sofort dazu.
const HAKEN_KEY = /^[A-Z]{2,3}:\d{1,15}(:\d{1,12})?$/;
async function adminTry(env, code) {
  const fails = ((await env.TIPPS.get('fail:haken', 'json')) || []).filter(t => Date.now() - t < 15 * 60e3);
  if (fails.length >= 5) return { ok: false, status: 429, error: 'Zu viele falsche Codes. Bitte in 15 Minuten erneut versuchen.' };
  if (isAdmin(env, code)) return { ok: true };
  fails.push(Date.now());
  await env.TIPPS.put('fail:haken', JSON.stringify(fails), { expirationTtl: 16 * 60 });
  return { ok: false, status: 403, error: 'Falscher Admin-Code.' };
}
async function handleHaken(req, env, cors, parts, body) {
  if (!parts[1] && req.method === 'GET') {
    const out = {}, upTo = lastDay(await matchdays());
    await Promise.all(Array.from({ length: upTo }, (_, i) => i + 1).map(async d => { const v = await env.TIPPS.get(`haken:${d}`, 'json'); if (v) out[d] = v; }));
    return json({ days: out }, 200, cors);
  }
  if (parts[1] === 'login' && req.method === 'POST') {
    const a = await adminTry(env, body.adminCode);
    return a.ok ? json({ ok: true }, 200, cors) : json({ error: a.error }, a.status, cors);
  }
  if (!/^\d{1,2}$/.test(parts[1] || '') || Number(parts[1]) < 1 || Number(parts[1]) > 34) return json({ error: 'Ungültiger Spieltag.' }, 400, cors);
  const day = Number(parts[1]);
  if (req.method === 'GET') return json({ day, checks: (await env.TIPPS.get(`haken:${day}`, 'json')) || {} }, 200, cors);
  if (req.method === 'POST') {
    const { key, done, target, removed } = body;
    if (!HAKEN_KEY.test(String(key || '')) || typeof done !== 'boolean' || (removed != null && typeof removed !== 'boolean')) return json({ error: 'Ungültige Angabe.' }, 400, cors);
    if (target != null && (typeof target !== 'string' || !target.trim() || target.length > 60)) return json({ error: 'Ungültiger Manager.' }, 400, cors);
    const a = await adminTry(env, body.adminCode); if (!a.ok) return json({ error: a.error }, a.status, cors);
    const all = (await env.TIPPS.get(`haken:${day}`, 'json')) || {};
    all[key] = { done, at: new Date().toISOString(), ...(done && target ? { target: target.trim() } : {}), ...(done && removed ? { removed: true } : {}) };
    await env.TIPPS.put(`haken:${day}`, JSON.stringify(all));
    return json({ ok: true, day, checks: all }, 200, cors);
  }
  return json({ error: 'Nicht gefunden.' }, 404, cors);
}

// Spieltagsbericht (Kevin-Wunsch 28.10.): Claude schreibt auf GitHub einen Entwurf (mit Admin-Code, Geheimnis KBL_ADMIN_CODE),
// der Admin liest, ändert und gibt ihn in der App frei. KV bericht:<day> = {day, title, text, model, vorgaben, createdAt, status: entwurf|frei, editedAt?, approvedAt?}.
// Öffentlich (GET /bericht) gibt es nur freigegebene Berichte; Entwürfe nur mit Admin-Code (POST /bericht/admin).
async function berichtList(env, onlyFree) {
  const upTo = lastDay(await matchdays());
  const all = await cached('berichte', onlyFree ? 60e3 : 0, async () => (await Promise.all(Array.from({ length: upTo }, (_, i) => env.TIPPS.get(`bericht:${i + 1}`, 'json')))).filter(Boolean));
  return all.filter(b => !onlyFree || b.status === 'frei').sort((a, b) => b.day - a.day);
}
async function handleBericht(req, env, cors, parts, body) {
  if (!parts[1] && req.method === 'GET') return json({ berichte: await berichtList(env, true) }, 200, cors);
  const a = await adminTry(env, body.adminCode); if (!a.ok) return json({ error: a.error }, a.status, cors);
  if (parts[1] === 'admin' && req.method === 'POST') return json({ berichte: await berichtList(env, false) }, 200, cors);
  if (!/^\d{1,2}$/.test(parts[1] || '') || Number(parts[1]) < 1 || Number(parts[1]) > 34 || req.method !== 'POST') return json({ error: 'Ungültiger Spieltag.' }, 400, cors);
  const day = Number(parts[1]), key = `bericht:${day}`, old = await env.TIPPS.get(key, 'json');
  const text = typeof body.text === 'string' ? body.text.slice(0, 30000) : null, title = typeof body.title === 'string' ? body.title.trim().slice(0, 200) : null;
  const now = new Date().toISOString();
  if (parts[2] === 'entwurf') { // von GitHub: neuer Entwurf, ein freigegebener Bericht wird nie überschrieben
    if (old?.status === 'frei') return json({ ok: true, skipped: 'schon freigegeben', bericht: old }, 200, cors);
    if (!text) return json({ error: 'Text fehlt.' }, 400, cors);
    const b = { day, title: title || `Spieltag ${day}`, text, model: String(body.model || '').slice(0, 60), vorgaben: Number(body.vorgaben) || 1, createdAt: body.createdAt || now, status: 'entwurf' };
    await env.TIPPS.put(key, JSON.stringify(b)); memo.delete('berichte'); return json({ ok: true, bericht: b }, 200, cors);
  }
  if (!old) return json({ error: 'Kein Bericht zu diesem Spieltag.' }, 404, cors);
  const action = String(body.action || 'speichern');
  const b = { ...old, ...(text != null ? { text } : {}), ...(title ? { title } : {}) };
  if (text != null || title) b.editedAt = now;
  if (action === 'freigeben') { b.status = 'frei'; b.approvedAt = now; }
  else if (action === 'zurueckziehen') { b.status = 'entwurf'; delete b.approvedAt; }
  else if (action !== 'speichern') return json({ error: 'Unbekannte Aktion.' }, 400, cors);
  await env.TIPPS.put(key, JSON.stringify(b)); memo.delete('berichte'); return json({ ok: true, bericht: b }, 200, cors);
}

// Reaktionen auf den Spieltagsbericht (Kevin-Wunsch 28.10.): Jeder Besucher kann unter jedem Absatz (durchgezählt ab 0,
// Überschriften zählen nicht) mit Emojis reagieren, je Emoji und Absatz einmal pro Gerät (Gerätenummer kbl-vid wie bei
// der Nutzung, keine Anmeldung). KV reakt:<day>:<vid>, die Auswahl steht in den Metadaten ({r: {Abschnitt: "Emoji-Nummern"}}),
// darum reicht zum Zählen ein list() ohne einzelne Abrufe. Nur für freigegebene Berichte.
const REAKT_EMOJI = ['😂', '🔥', '👏', '🤡', '😱', '🍺', '💀', '🤮', '👎', '👀', '⛺', '💦', '🍆', '😮', '🤯']; // nur hinten anhängen, die Nummern stehen in KV (je Emoji ein Zeichen, Basis 36)
const REAKT_VID = /^[a-z0-9]{8,32}$/;
// Seit 31.10. in D1 (Tabelle reakt), weil das Zaehlen per KV list() das Tageslimit aufgebraucht hat. Alte KV-Eintraege
// werden je Spieltag einmalig uebernommen. Ohne D1 bleibt es bei KV.
async function kvReakt(env, day) {
  const out = []; let cursor;
  do {
    const page = await env.TIPPS.list({ prefix: `reakt:${day}:`, cursor });
    for (const k of page.keys) if (k.metadata?.r) out.push({ vid: k.name.slice(`reakt:${day}:`.length), r: k.metadata.r });
    cursor = page.list_complete ? null : page.cursor;
  } while (cursor);
  return out;
}
async function reaktRows(env, day) {
  const db = await d1(env);
  if (!db) return cached(`reakt:${day}`, 30e3, () => kvReakt(env, day));
  await d1Import(env, db, `reakt:${day}`, async () => (await kvReakt(env, day)).map(x => db.prepare('INSERT OR IGNORE INTO reakt (day, vid, r) VALUES (?, ?, ?)').bind(day, x.vid, JSON.stringify(x.r))));
  return ((await db.prepare('SELECT vid, r FROM reakt WHERE day = ?').bind(day).all()).results || []).map(x => { try { return { vid: x.vid, r: JSON.parse(x.r) }; } catch { return null; } }).filter(Boolean);
}
async function reaktState(env, day, vid, own) {
  const counts = {}; let mine = {};
  const add = r => { for (const [sec, ix] of Object.entries(r || {})) for (const c of String(ix)) { const e = REAKT_EMOJI[parseInt(c, 36)]; if (e) { counts[sec] ??= {}; counts[sec][e] = (counts[sec][e] || 0) + 1; } } };
  for (const x of await reaktRows(env, day)) { if (x.vid === vid) { if (!own) mine = x.r || {}; continue; } add(x.r); }
  if (own) mine = own; // die eigene, gerade gespeicherte Auswahl direkt nehmen
  add(mine);
  const out = {}; for (const [sec, ix] of Object.entries(mine)) out[sec] = [...String(ix)].map(c => REAKT_EMOJI[parseInt(c, 36)]).filter(Boolean);
  return { day, emojis: REAKT_EMOJI, counts, mine: out };
}
async function handleReaktion(req, env, cors, parts, body, url) {
  if (!/^\d{1,2}$/.test(parts[1] || '') || Number(parts[1]) < 1 || Number(parts[1]) > 34) return json({ error: 'Ungültiger Spieltag.' }, 400, cors);
  const day = Number(parts[1]);
  if (req.method === 'GET') { const vid = url.searchParams.get('vid') || ''; return json(await reaktState(env, day, REAKT_VID.test(vid) ? vid : '', null), 200, cors); }
  if (req.method !== 'POST') return json({ error: 'Nicht gefunden.' }, 404, cors);
  const vid = String(body.vid || ''), sec = String(Number(body.sec)), ix = REAKT_EMOJI.indexOf(String(body.emoji || ''));
  if (!REAKT_VID.test(vid) || !/^\d{1,2}$/.test(sec) || Number(sec) > 99 || body.sec == null || ix < 0) return json({ error: 'Ungültige Angabe.' }, 400, cors);
  if ((await env.TIPPS.get(`bericht:${day}`, 'json'))?.status !== 'frei') return json({ error: 'Dieser Bericht ist nicht veröffentlicht.' }, 409, cors);
  const db = await d1(env), key = `reakt:${day}:${vid}`;
  if (db) await reaktRows(env, day); // alte KV-Eintraege zuerst uebernehmen
  const old = db ? JSON.parse((await db.prepare('SELECT r FROM reakt WHERE day = ? AND vid = ?').bind(day, vid).first())?.r || '{}') : (await env.TIPPS.getWithMetadata(key)).metadata?.r || {};
  const r = { ...old }, cur = String(r[sec] || ''), c = ix.toString(36);
  r[sec] = cur.includes(c) ? cur.replace(c, '') : [...cur + c].sort((a, b) => parseInt(a, 36) - parseInt(b, 36)).join('');
  if (!r[sec]) delete r[sec];
  if (db) {
    if (Object.keys(r).length) await db.prepare('INSERT OR REPLACE INTO reakt (day, vid, r) VALUES (?, ?, ?)').bind(day, vid, JSON.stringify(r)).run();
    else await db.prepare('DELETE FROM reakt WHERE day = ? AND vid = ?').bind(day, vid).run();
  } else if (Object.keys(r).length) await env.TIPPS.put(key, '1', { metadata: { r }, expirationTtl: 400 * 86400 });
  else await env.TIPPS.delete(key);
  return json({ ok: true, ...(await reaktState(env, day, vid, r)) }, 200, cors);
}

async function handle(req, env, cors) {
  const url = new URL(req.url), parts = url.pathname.replace(/^\/+|\/+$/g, '').split('/');
  const body = req.method === 'GET' || req.method === 'DELETE' ? {} : await req.json().catch(() => ({}));
  if (parts[0] === '' || parts[0] === 'status') return json({ ok: true, dienst: 'KBL Legenden MVP-Tipp' }, 200, cors);
  if (parts[0] === 'push') return handlePush(req, env, cors, parts, body);
  if (parts[0] === 'nutzung') return handleNutzung(req, env, cors, parts, body);
  if (parts[0] === 'haken') return handleHaken(req, env, cors, parts, body);
  if (parts[0] === 'bericht') return handleBericht(req, env, cors, parts, body);
  if (parts[0] === 'reaktion') return handleReaktion(req, env, cors, parts, body, url);

  // Alle Regeln und die aufgedeckten Tipps (nur angepfiffene Spieltage) fuer den GitHub-Export.
  if (parts[0] === 'export' && req.method === 'GET') {
    const [days, info] = await Promise.all([matchdays(), siteJson(env, 'mvp-tipps.json')]), out = {}, ids = mgrIds(info), upTo = lastDay(days);
    for (const d of days) {
      if (d.day > upTo) continue;
      const st = dayState(days, d.day), rule = await env.TIPPS.get(`rule:${d.day}`, 'json');
      const reveal = st.locked && st.status !== 'upcoming';
      const tips = reveal ? (await dayTips(env, d.day, st, ids)).tips : {};
      if (rule || Object.keys(tips).length) out[d.day] = { ...(rule ? { rule } : {}), ...(reveal ? { tips } : {}) };
    }
    return json({ exportedAt: new Date().toISOString(), days: out }, 200, cors);
  }

  if (parts[0] === 'codes' && parts[1] && req.method === 'DELETE') {
    if (!isAdmin(env, req.headers.get('X-Admin-Code'))) return json({ error: 'Falscher Admin-Code.' }, 403, cors);
    const cday = Number(url.searchParams.get('day'));
    if (!/^\d{1,15}$/.test(parts[1]) || !Number.isInteger(cday) || cday < 1 || cday > 34) return json({ error: 'Ungültiger Manager oder Spieltag.' }, 400, cors);
    await env.TIPPS.delete(`code:${cday}:${parts[1]}`); await env.TIPPS.delete(`code:${parts[1]}`); await env.TIPPS.delete(`fail:${parts[1]}`);
    await snapUpdate(env, cday, s => { s.codes = (s.codes || []).filter(x => x !== parts[1]); });
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
    const c = await checkCode(env, day, id, body.code, false); if (!c.ok) return json({ error: c.error }, c.status, cors);
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
    const c = await checkCode(env, day, String(me.id), body.code, true); if (!c.ok) return json({ error: c.error }, c.status, cors);
    const tip = { name: me.name, playerId, player: player.name, team: player.team, points, updatedAt: new Date().toISOString() };
    await env.TIPPS.put(`tip:${day}:${me.id}`, JSON.stringify(tip)); memo.delete(`tips:${day}`);
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
    await snapUpdate(env, day, s => { s.tips[String(me.id)] = tip; });
    return json({ ok: true, tip }, 200, cors);
  }
  if (!parts[2] && req.method === 'GET') {
    const [{ tips, codes }, rule] = await Promise.all([dayTips(env, day, st, managers.map(m => String(m.id))), env.TIPPS.get(`rule:${day}`, 'json')]);
    const reveal = st.locked && st.status !== 'upcoming';
    return json({ day, ...st, reveal, rule: rule || null, rules: info.rules || [], wertungen: info.wertungen || [], managers: managers.map(m => {
      const t = tips[m.id];
      return { id: String(m.id), name: m.name, tipped: !!t, hasCode: codes.has(String(m.id)), ...(t && reveal ? { tip: { playerId: t.playerId, player: t.player, team: t.team, points: t.points, updatedAt: t.updatedAt, ...(t.late ? { late: true } : {}) } } : {}) };
    }), me: null, admin: false, result: null, online: true }, 200, cors);
  }
  return json({ error: 'Nicht gefunden.' }, 404, cors);
}

export default {
  // Zeitplan (Cron-Trigger alle 5 Minuten, wrangler.toml bzw. Cloudflare-Dashboard): Push-Nachrichten.
  async scheduled(event, env, ctx) { if (env.TIPPS) ctx.waitUntil(pushTick(env).catch(e => console.log('Push:', e.message))); },
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
