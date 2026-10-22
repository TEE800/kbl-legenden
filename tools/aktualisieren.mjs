// Holt beim Start (start.bat) den neuesten Programmstand von GitHub (TEE800/kbl-legenden, Branch main) in den App-Ordner.
// Nur Programmdateien (Liste wie beim Veröffentlichen), nie Daten (kbl-*.json), Zugangsdaten oder .bat-Dateien.
// Eine Datei, die seit dem letzten Abgleich auf dem PC geändert wurde, wird NICHT überschrieben (erst veröffentlichen).
// Ohne Internet oder bei Fehlern startet die App einfach mit dem vorhandenen Stand.
// Ende mit Code 2, wenn sich package.json oder package-lock.json geändert haben (start.bat ruft dann npm install).
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const REPO = 'TEE800/kbl-legenden', BRANCH = 'main';
const ROOT = process.cwd(), STATE = path.join(ROOT, '.kbl-aktualisieren.json');
const CODE = ['server.js', 'challenges.js', 'event-types-de.js', 'package.json', 'package-lock.json', 'CLAUDE.md', 'README.md', '.gitignore', '.github/workflows/seite.yml'];
const isCode = p => CODE.includes(p) || p.startsWith('public/') || p.startsWith('tools/');
// Git-Kennung einer Datei (wie GitHub sie im Verzeichnisbaum angibt).
const blobSha = buf => crypto.createHash('sha1').update(`blob ${buf.length}\0`).update(buf).digest('hex');

async function get(url, type) {
  const r = await fetch(url, { headers: { 'User-Agent': 'kbl-legenden-app' }, signal: AbortSignal.timeout(15000) });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return type === 'json' ? r.json() : Buffer.from(await r.arrayBuffer());
}

try {
  const tree = await get(`https://api.github.com/repos/${REPO}/git/trees/${BRANCH}?recursive=1`, 'json');
  let state = {};
  try { state = JSON.parse(fs.readFileSync(STATE, 'utf8')); } catch {}
  const updated = [], skipped = [];
  for (const item of tree.tree || []) {
    if (item.type !== 'blob' || !isCode(item.path)) continue;
    const file = path.join(ROOT, ...item.path.split('/'));
    const local = fs.existsSync(file) ? blobSha(fs.readFileSync(file)) : null;
    if (local === item.sha) { state[item.path] = item.sha; continue; }
    // Lokal geändert seit dem letzten Abgleich: nicht anfassen.
    if (local && state[item.path] && local !== state[item.path]) { skipped.push(item.path); continue; }
    const buf = await get(`https://raw.githubusercontent.com/${REPO}/${BRANCH}/${item.path}`);
    if (blobSha(buf) !== item.sha) throw new Error(`${item.path}: Download unvollständig`);
    // Beim ersten Abgleich eine abweichende Datei vorher sichern.
    if (local && !state[item.path]) {
      const backup = path.join(ROOT, '_sicherungen', 'sicherung-vor-aktualisierung', ...item.path.split('/'));
      fs.mkdirSync(path.dirname(backup), { recursive: true });
      fs.copyFileSync(file, backup);
    }
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, buf);
    state[item.path] = item.sha;
    updated.push(item.path);
  }
  fs.writeFileSync(STATE, JSON.stringify(state, null, 2));
  if (updated.length) console.log(`Aktualisiert von GitHub: ${updated.join(', ')}`);
  else console.log('Programm ist auf dem neuesten Stand.');
  if (skipped.length) console.log(`Nicht aktualisiert, weil auf diesem PC geändert (bitte erst veröffentlichen): ${skipped.join(', ')}`);
  if (updated.some(p => p === 'package.json' || p === 'package-lock.json')) process.exitCode = 2;
} catch (e) {
  console.log(`Aktualisieren übersprungen (${e.message}). Die App startet mit dem vorhandenen Stand.`);
}
