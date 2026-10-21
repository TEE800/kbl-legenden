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
    if (f === 'index.html') t = t.replace('<script src="app.js"', '<script>window.KBL_STATIC=true</script><script src="static-mode.js"></script><script src="app.js"');
    buf = Buffer.from(t);
  }
  fs.writeFileSync(path.join(SITE, f), buf);
}
fs.writeFileSync(path.join(SITE, '.nojekyll'), '');

// 2. Server starten
const server = spawn(process.execPath, ['server.js'], { env: { ...process.env, PORT: String(PORT), KBL_VORSCHAU: '' }, stdio: ['ignore', 'inherit', 'inherit'] });
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

  fs.writeFileSync(path.join(DATA, key('/api/vorschau')), JSON.stringify({ preview: false, admin: false, loggedIn: true }));
  for (const u of ['/api/leagues', `/api/ranking/${LEAGUE}`, '/api/points-overview', '/api/points-season', '/api/bumsungen', '/api/challenges']) await save(u);
  const ranking = JSON.parse(fs.readFileSync(path.join(DATA, key(`/api/ranking/${LEAGUE}`)), 'utf8'));
  for (const m of ranking.us || []) await save(`/api/manager-squad-v4/${LEAGUE}/${m.i}`);

  // Spieltage: im Live-Modus nur der laufende, der letzte und fehlende; im Voll-Modus alle (Kickbase korrigiert nachtraeglich).
  const recent = new Set([live, Math.max(...days.filter(d => d !== live), 0)].filter(Boolean));
  for (const d of days) {
    const urls = [`/api/ranking/${LEAGUE}?dayNumber=${d}`, `/api/rule-accounting/${d}`, `/api/points-overview/${d}`, `/api/todo-checks/${d}`,
      `/api/lineup-snapshots/${d}`, `/api/lineup-coverage/${d}`, `/api/npc-jokers/${d}`];
    for (const u of urls) if (MODE === 'full' || recent.has(d) || !have(u)) await save(u);
  }
  fs.writeFileSync(path.join(DATA, '_meta.json'), JSON.stringify({ exportedAt: new Date().toISOString(), mode: MODE, liveDay: live || null }));
  console.log(`Fertig (${MODE}): ${saved.length} gespeichert, ${failed.length} mit Fehler.`);
  if (failed.length) console.log('Fehler:\n  ' + failed.join('\n  '));
} catch (e) {
  console.error('Export abgebrochen:', e.message);
  process.exitCode = 1;
} finally { server.kill(); }
