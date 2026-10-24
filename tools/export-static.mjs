// Baut die Online-Ansicht (Ordner site/) aus der laufenden App.
// Startet server.js, meldet sich mit dem Dienst-Login an, ruft alle Anzeige-Daten ab und speichert sie als Dateien.
// Aufruf: KBL_AUTO_EMAIL=… KBL_AUTO_PASSWORD=… node tools/export-static.mjs [live|full]
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const MODE = process.argv[2] === 'full' ? 'full' : 'live';
const PORT = 3456, BASE = `http://127.0.0.1:${PORT}`, LEAGUE = '6422780';
const ROOT = process.cwd(), SITE = path.join(ROOT, 'site'), DATA = path.join(SITE, 'data');
const email = process.env.KBL_AUTO_EMAIL, password = process.env.KBL_AUTO_PASSWORD;
if (!email || !password) { console.error('KBL_AUTO_EMAIL und KBL_AUTO_PASSWORD fehlen.'); process.exit(1); }

// Online-Tippdienst (Cloudflare Worker, tools/tipp-dienst): Adresse aus der Repository-Variablen KBL_TIPP_DIENST.
const TIPP_DIENST = String(process.env.KBL_TIPP_DIENST || '').trim().replace(/\/+$/, '');
const key = u => u.replace(/^\/api\//, '').replace(/[^A-Za-z0-9._-]+/g, '_') + '.json';
const sleep = ms => new Promise(r => setTimeout(r, ms));

// 1. Seiten-Dateien kopieren; absolute Pfade relativ machen, damit die Seite auch unter /kbl-legenden/ laeuft.
fs.mkdirSync(DATA, { recursive: true });
for (const f of fs.readdirSync(path.join(ROOT, 'public'))) {
  const src = path.join(ROOT, 'public', f);
  if (fs.statSync(src).isDirectory()) { fs.cpSync(src, path.join(SITE, f), { recursive: true }); continue; }
  let buf = fs.readFileSync(src);
  if (/\.(html|js|css)$/.test(f)) {
    let t = buf.toString('utf8').replace(/(["'`(])\/([a-z][a-z0-9_-]*\.(svg|png|css|js))/g, '$1$2');
    if (f === 'index.html') t = t.replace('<script src="app.js"', `<script>window.KBL_STATIC=true${TIPP_DIENST ? `;window.KBL_TIPP_API=${JSON.stringify(TIPP_DIENST)}` : ''}</script><script src="static-mode.js"></script><script src="app.js"`);
    buf = Buffer.from(t);
  }
  fs.writeFileSync(path.join(SITE, f), buf);
}
fs.writeFileSync(path.join(SITE, '.nojekyll'), '');

// 2. Server starten
const server = spawn(process.execPath, ['--import', './tools/kickbase-bremse.mjs', 'server.js'], { env: { ...process.env, PORT: String(PORT), KBL_VORSCHAU: '', KBL_EXPORT: '1', KBL_CHALLENGES_SOFORT: MODE === 'full' ? '1' : '' }, stdio: ['ignore', 'inherit', 'inherit'] });
let cookie = '';
async function call(url, opts = {}) {
  const r = await fetch(BASE + url, { ...opts, headers: { ...(opts.headers || {}), cookie, 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(10 * 60 * 1000) });
  const text = await r.text();
  let body; try { body = JSON.parse(text); } catch { body = { raw: text }; }
  return { status: r.status, body, headers: r.headers };
}
const saved = [], failed = [];
async function save(url) {
  try {
    const { status, body } = await call(url);
    const out = status === 200 ? body : { __status: status, ...(body && typeof body === 'object' ? body : {}) };
    fs.writeFileSync(path.join(DATA, key(url)), JSON.stringify(out));
    (status === 200 ? saved : failed).push(`${url} (${status})`);
    return status === 200 ? body : null;
  } catch (e) { failed.push(`${url} (${e.message})`); return null; }
}
const have = url => fs.existsSync(path.join(DATA, key(url)));

try {
  for (let i = 0; ; i++) { try { await fetch(BASE + '/api/vorschau'); break; } catch { if (i > 60) throw new Error('Server startet nicht'); await sleep(500); } }
  const login = await call('/api/login', { method: 'POST', body: JSON.stringify({ email, password }) });
  if (login.status !== 200) throw new Error(`Kickbase-Login fehlgeschlagen (HTTP ${login.status}): ${JSON.stringify(login.body).slice(0, 300)}`);
  cookie = (login.headers.get('set-cookie') || '').split(';')[0];

  const status = await save('/api/matchday-status');
  const days = (status?.days || []).filter(d => d.status === 'live' || d.status === 'finished').map(d => d.day);
  const live = (status?.days || []).find(d => d.status === 'live')?.day;

  // Startelfen einfrieren, solange ein Spieltag laeuft (wird nie ueberschrieben).
  if (live) { const r = await call('/api/lineup-snapshots/capture-frozen', { method: 'POST', body: JSON.stringify({ day: live }) }); console.log('Startelfen Spieltag', live, r.status, JSON.stringify(r.body).slice(0, 200)); }
  // Live-Zwischenstand aller Manager (das Liga-Ranking zeigt bis Spieltagsende 0 Punkte).
  if (live) await save(`/api/live-points/${live}`);

  fs.writeFileSync(path.join(DATA, key('/api/vorschau')), JSON.stringify({ preview: false, admin: false, loggedIn: true }));
  for (const u of ['/api/leagues', `/api/ranking/${LEAGUE}`, '/api/points-overview', '/api/points-season', '/api/bumsungen']) await save(u);
  const ranking = JSON.parse(fs.readFileSync(path.join(DATA, key(`/api/ranking/${LEAGUE}`)), 'utf8'));
  for (const m of ranking.us || []) await save(`/api/manager-squad-v4/${LEAGUE}/${m.i}`);

  // Spieltage: im Live-Modus nur der laufende und was fehlt oder noch nicht fertig abgerechnet ist;
  // im Voll-Modus (taeglich) alle, weil Kickbase Punkte nachtraeglich korrigiert.
  const unfinished = u => { try { return JSON.parse(fs.readFileSync(path.join(DATA, key(u)), 'utf8')).ready === false; } catch { return true; } };
  // Bankpunkte aus dem Live-Lauf einmal nach Spieltagsende endgueltig nachladen.
  const benchLive = u => { try { return JSON.parse(fs.readFileSync(path.join(DATA, key(u)), 'utf8')).status !== 'finished'; } catch { return true; } };
  for (const d of days) {
    const urls = [`/api/ranking/${LEAGUE}?dayNumber=${d}`, `/api/rule-accounting/${d}`, `/api/points-overview/${d}`, `/api/todo-checks/${d}`,
      `/api/lineup-snapshots/${d}`, `/api/lineup-coverage/${d}`, `/api/npc-jokers/${d}`, `/api/bench-points/${d}`];
    for (const u of urls) {
      const needed = MODE === 'full' || d === live || !have(u) || (u.includes('/rule-accounting/') && unfinished(u)) || (u.includes('/bench-points/') && benchLive(u));
      if (needed) await save(u);
    }
  }
  // MVP-Tipp: Regeln und aufgedeckte Tipps (nur angepfiffene Spieltage) vom Online-Tippdienst in kbl-mvp-tipps.json uebernehmen,
  // damit die App sie anzeigt und nach dem Spieltag auswertet. Verdeckte Tipps kommen hier nie an.
  if (TIPP_DIENST) {
    try {
      const r = await fetch(TIPP_DIENST + '/export', { signal: AbortSignal.timeout(30000) });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const remote = (await r.json()).days || {};
      const file = path.join(ROOT, 'kbl-mvp-tipps.json');
      let local = {}; try { local = JSON.parse(fs.readFileSync(file, 'utf8')); } catch {}
      for (const [d, v] of Object.entries(remote)) {
        const rec = local[d] || (local[d] = {});
        if (v.rule) rec.rule = v.rule;
        if (v.tips) rec.tips = { ...(rec.tips || {}), ...v.tips };
      }
      fs.writeFileSync(file, JSON.stringify(local, null, 2));
      console.log('Tippdienst:', Object.keys(remote).length, 'Spieltage uebernommen');
    } catch (e) { failed.push(`Tippdienst /export (${e.message})`); }
  }
  if (MODE === 'full' || !have('/api/mvp-tipps/players')) await save('/api/mvp-tipps/players');
  // MVP-Tipp: Uebersicht, naechster Spieltag (nur wer getippt hat) und alle angepfiffenen Spieltage.
  const tipps = await save('/api/mvp-tipps');
  for (const d of (tipps?.days || []).map(x => x.day)) {
    const u = `/api/mvp-tipps/${d}`;
    if (MODE === 'full' || d === live || d === tipps.next || !have(u)) await save(u);
  }
  // Arena (Head-to-Head-Liga): Paarungen und Aufstellungen aus kbl-arena.json (vom PC, GitHub ist kein Arena-Mitglied),
  // Live-Punkte der Spieler rechnet der Server selbst. Live-Lauf: laufender und naechster Spieltag und Fehlendes.
  const arena = await save('/api/arena');
  for (const d of (arena?.days || []).map(x => x.day)) {
    const u = `/api/arena/${d}`;
    if (MODE === 'full' || d === live || d === arena.next || !have(u)) await save(u);
  }
  // Wackelkoepfe fuer das MVP-Rennen: Kopf aus dem Kickbase-Foto, auf dem Server ausgeschnitten (nur fehlende, CDN statt Kickbase-API).
  // Neue Version des Zuschnitts (HEAD_VERSION in server.js und mvp-tipp.js) = neuer Ordner, alte Ordner werden geloescht.
  try {
    const HV = 2, HEADS = path.join(SITE, 'heads'), dir = path.join(HEADS, 'v' + HV);
    fs.mkdirSync(dir, { recursive: true });
    for (const f of fs.readdirSync(HEADS)) if (/^v\d+$/.test(f) && f !== 'v' + HV) fs.rmSync(path.join(HEADS, f), { recursive: true, force: true });
    const failFile = path.join(dir, '_fehlt.json');
    let fehlt = {}; try { fehlt = JSON.parse(fs.readFileSync(failFile, 'utf8')); } catch {}
    const pl = JSON.parse(fs.readFileSync(path.join(DATA, key('/api/mvp-tipps/players')), 'utf8')).players || [];
    const get = async (u) => { const r = await fetch(BASE + u, { headers: { cookie }, signal: AbortSignal.timeout(30000) }); return r.ok ? Buffer.from(await r.arrayBuffer()) : (r.status === 404 ? null : Promise.reject(new Error('HTTP ' + r.status))); };
    let neu = 0, ohne = 0;
    for (const p of pl) {
      if (!p.img) continue;
      const f = path.join(dir, p.id + '.png');
      if (!fs.existsSync(f) && fehlt[p.id] !== p.img) {
        try { const b = await get('/api/mvp-tipps/head/' + p.id); if (b) { fs.writeFileSync(f, b); neu++; delete fehlt[p.id]; } else { fehlt[p.id] = p.img; ohne++; } } catch {}
      }
    }
    fs.writeFileSync(failFile, JSON.stringify(fehlt));
    console.log(`Koepfe: ${neu} neu, ${ohne} ohne erkennbaren Kopf`);
  } catch (e) { failed.push(`Koepfe (${e.message})`); }
  // Challenges: im Voll-Lauf laedt der Server sie gleich beim Start nach (Konto aus KBL_CHALLENGE_*, siehe server.js); darauf warten.
  for (let i = 0; MODE === 'full' && i < 120; i++) { const c = await call('/api/challenges'); if (c.status !== 200 || !c.body.running) break; await sleep(5000); }
  await save('/api/challenges');
  fs.writeFileSync(path.join(DATA, '_meta.json'), JSON.stringify({ exportedAt: new Date().toISOString(), mode: MODE, liveDay: live || null }));
  console.log(`Fertig (${MODE}): ${saved.length} gespeichert, ${failed.length} mit Fehler.`);
  if (failed.length) console.log('Fehler:\n  ' + failed.join('\n  '));
} catch (e) {
  console.error('Export abgebrochen:', e.message);
  process.exitCode = 1;
} finally { if (server.exitCode === null) { const done = new Promise(r => server.once('exit', r)); server.kill('SIGTERM'); await Promise.race([done, sleep(10000)]); } }
