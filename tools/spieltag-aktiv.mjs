// Prueft fuer den 5-Minuten-Lauf, ob gerade Bundesliga gespielt wird.
// Aktiv = ein Spiel hat vor hoechstens 3 Stunden angefangen oder beginnt in den naechsten 10 Minuten.
// Danach (bis 12 Stunden nach dem letzten Anstoss) weiter aktiv, solange die Online-Daten des Spieltags noch auf dem Live-Stand sind
// (Kickbase-Ranking il = true oder MVP-Tipp noch nicht ausgewertet). Sonst fehlen MVP und Bumsungen bis zum Voll-Lauf um 6:07.
// Schreibt aktiv=true/false nach GITHUB_OUTPUT. Ist OpenLigaDB nicht erreichbar, wird sicherheitshalber abgerufen.
import fs from 'node:fs';
let aktiv = true;
const read = f => { try { return JSON.parse(fs.readFileSync('site/data/' + f, 'utf8')); } catch { return null; } };
try {
  const r = await fetch('https://api.openligadb.de/getmatchdata/bl1/2026', { signal: AbortSignal.timeout(15000) });
  const matches = await r.json();
  const now = Date.now(), kick = m => Date.parse(m.matchDateTimeUTC || m.matchDateTime);
  aktiv = matches.some(m => { const t = kick(m); return Number.isFinite(t) && t <= now + 10 * 60 * 1000 && t >= now - 3 * 3600 * 1000; });
  if (!aktiv) {
    const started = matches.filter(m => Number.isFinite(kick(m)) && kick(m) <= now).sort((a, b) => kick(b) - kick(a));
    const last = started[0], day = last?.group?.groupOrderID;
    if (last && day && now - kick(last) <= 12 * 3600 * 1000) {
      const rk = read(`ranking_6422780_dayNumber_${day}.json`), mt = read(`mvp-tipps_${day}.json`);
      const offen = [rk?.il === true && 'Ranking noch live', mt && mt.status !== 'finished' && 'MVP-Tipp noch nicht ausgewertet'].filter(Boolean);
      if (offen.length) { aktiv = true; console.log(`Spieltag ${day} vorbei, Online-Daten noch nicht endgültig (${offen.join(', ')}).`); }
    }
  }
} catch (e) { console.log('Spielplan nicht abrufbar, Lauf findet statt:', e.message); }
console.log(aktiv ? 'Daten werden abgerufen.' : 'Kein Spiel in diesem Zeitfenster: Lauf wird übersprungen.');
if (process.env.GITHUB_OUTPUT) fs.appendFileSync(process.env.GITHUB_OUTPUT, `aktiv=${aktiv}\n`);
