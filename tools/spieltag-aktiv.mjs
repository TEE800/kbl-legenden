// Prueft fuer den 10-Minuten-Lauf, ob gerade Bundesliga gespielt wird.
// Aktiv = ein Spiel hat vor hoechstens 3 Stunden angefangen oder beginnt in den naechsten 10 Minuten.
// Schreibt aktiv=true/false nach GITHUB_OUTPUT. Ist OpenLigaDB nicht erreichbar, wird sicherheitshalber abgerufen.
import fs from 'node:fs';
let aktiv = true;
try {
  const r = await fetch('https://api.openligadb.de/getmatchdata/bl1/2026', { signal: AbortSignal.timeout(15000) });
  const matches = await r.json();
  const now = Date.now();
  aktiv = matches.some(m => {
    const t = Date.parse(m.matchDateTimeUTC || m.matchDateTime);
    return Number.isFinite(t) && t <= now + 10 * 60 * 1000 && t >= now - 3 * 3600 * 1000;
  });
} catch (e) { console.log('Spielplan nicht abrufbar, Lauf findet statt:', e.message); }
console.log(aktiv ? 'Spieltag läuft: Daten werden abgerufen.' : 'Kein Spiel in diesem Zeitfenster: Lauf wird übersprungen.');
if (process.env.GITHUB_OUTPUT) fs.appendFileSync(process.env.GITHUB_OUTPUT, `aktiv=${aktiv}\n`);
