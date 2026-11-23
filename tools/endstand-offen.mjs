// Montagslaeufe (Kevin 23.11.): Die BumsParade beginnt meist Montag 19 Uhr, dann stehen auch die endgueltigen Kickbase-Punkte fest
// (manchmal ein paar Minuten spaeter). Ohne eigenen Lauf zeigte die Seite bis Dienstagfrueh den vorlaeufigen Stand.
// Darum gibt es Montagabend ein paar kurze Laeufe. Dieses Skript entscheidet, ob einer davon wirklich etwas abrufen muss:
// nur solange der zuletzt gespielte Spieltag online noch nicht endgueltig ist (Ranking il, MVP-Tipp nicht ausgewertet,
// Abrechnung nicht fertig oder mit pendingCorrections) und gerade kein Spiel laeuft (keine Livepunkte, Kevin 7.11.).
// Schreibt offen=true/false nach GITHUB_OUTPUT. Ohne OpenLigaDB wird der neueste Spieltag aus site/data genommen.
import fs from 'node:fs';
const read = f => { try { return JSON.parse(fs.readFileSync('site/data/' + f, 'utf8')); } catch { return null; } };
let day = null, laeuft = false;
try {
  const r = await fetch('https://api.openligadb.de/getmatchdata/bl1/2026', { signal: AbortSignal.timeout(15000) });
  const matches = await r.json();
  const now = Date.now(), kick = m => Date.parse(m.matchDateTimeUTC || m.matchDateTime);
  const started = matches.filter(m => Number.isFinite(kick(m)) && kick(m) <= now).sort((a, b) => kick(b) - kick(a));
  day = started[0]?.group?.groupOrderID || null;
  laeuft = started.some(m => kick(m) >= now - 2.5 * 3600e3);
} catch (e) { console.log('Spielplan nicht abrufbar:', e.message); }
if (!day) day = Math.max(0, ...fs.readdirSync('site/data').map(f => +(/^rule-accounting_(\d+)\.json$/.exec(f)?.[1] || 0)));
const rk = read(`ranking_6422780_dayNumber_${day}.json`), mt = read(`mvp-tipps_${day}.json`), ac = read(`rule-accounting_${day}.json`);
const gruende = [
  (!rk || rk.il === true) && 'Kickbase hat den Spieltag noch nicht abgeschlossen',
  (!mt || mt.status !== 'finished') && 'MVP-Tipp noch nicht ausgewertet',
  (!ac || ac.ready === false) && 'Abrechnung noch nicht fertig',
  ac?.pendingCorrections && 'Abrechnung noch mit unkorrigierten Punkten',
].filter(Boolean);
let offen = gruende.length > 0;
if (laeuft) { offen = false; console.log('Gerade laeuft ein Spiel: Lauf ausgelassen.'); }
else if (offen) console.log(`Spieltag ${day} noch nicht endgueltig (${gruende.join(', ')}): Daten werden abgerufen.`);
else console.log(`Spieltag ${day} ist online schon endgueltig: Lauf ausgelassen.`);
if (process.env.GITHUB_OUTPUT) fs.appendFileSync(process.env.GITHUB_OUTPUT, `offen=${offen}\n`);
