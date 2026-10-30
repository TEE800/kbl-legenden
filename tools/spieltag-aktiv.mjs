// Prueft fuer den 5-Minuten-Lauf, ob gerade Bundesliga gespielt wird.
// Aktiv = ein Spiel hat vor hoechstens 3 Stunden angefangen oder beginnt in den naechsten 10 Minuten.
// Danach (bis 30 Stunden nach dem letzten Anstoss) weiter aktiv, solange die Online-Daten des Spieltags noch auf dem Live-Stand sind
// (Kickbase-Ranking il = true, Kickbase schliesst den Spieltag erst am Abend nach dem letzten Spiel ab, oder MVP-Tipp noch nicht
// ausgewertet, oder die Abrechnung hat noch pendingCorrections oder offene Aufgaben bis 3 Std. nach der Verkaufsfrist: ST 7 schloss Kickbase um 18 Uhr, die Abrechnung stand online
// sonst bis 6:07 auf dem unkorrigierten Stand). Solange bleiben die LIVE-Anzeigen stehen (Kevin-Wunsch). In dieser Zeit nur jede Viertelstunde (Kickbase schonen).
// Schreibt aktiv=true/false nach GITHUB_OUTPUT. Ist OpenLigaDB nicht erreichbar, wird sicherheitshalber abgerufen.
// Dazu weiter=true/false: Soll sich der Lauf in 5 Min. selbst wieder starten? GitHub startet den 5-Minuten-Zeitplan in Wirklichkeit
// nur etwa alle 45 bis 60 Minuten (30.10., ST 8: 18:45 und 19:32), darum stoesst sich der Lauf selbst an, solange ein Spiel laeuft,
// eines in den naechsten 75 Min. anfaengt (damit der stuendliche Zeitplan den Anpfiff sicher erwischt) oder Online-Daten noch offen sind.
import fs from 'node:fs';
let aktiv = true, weiter = false;
const read = f => { try { return JSON.parse(fs.readFileSync('site/data/' + f, 'utf8')); } catch { return null; } };
try {
  const r = await fetch('https://api.openligadb.de/getmatchdata/bl1/2026', { signal: AbortSignal.timeout(15000) });
  const matches = await r.json();
  const now = Date.now(), kick = m => Date.parse(m.matchDateTimeUTC || m.matchDateTime);
  aktiv = matches.some(m => { const t = kick(m); return Number.isFinite(t) && t <= now + 10 * 60 * 1000 && t >= now - 3 * 3600 * 1000; });
  weiter = matches.some(m => { const t = kick(m); return Number.isFinite(t) && t <= now + 75 * 60 * 1000 && t >= now - 3 * 3600 * 1000; });
  if (!aktiv) {
    const started = matches.filter(m => Number.isFinite(kick(m)) && kick(m) <= now).sort((a, b) => kick(b) - kick(a));
    const last = started[0], day = last?.group?.groupOrderID;
    const ac = day && read(`rule-accounting_${day}.json`);
    // Verkaeufe und Empfaenger der BumsParade erkennt die Abrechnung aus dem Transfer-Verlauf. Bis 3 Std. nach der Verkaufsfrist
    // (22 Uhr am Tag nach dem Spieltag) weiter abrufen, solange Aufgaben offen sind, sonst sah man sie online erst am naechsten Morgen.
    const bumsOffen = ac?.ready && (ac.todos || []).some(t => ['open', 'progress'].includes(t.check?.state)) && now <= Date.parse(ac.saleDeadline) + 3 * 3600 * 1000;
    if (last && day && (now - kick(last) <= 30 * 3600 * 1000 || bumsOffen)) {
      const rk = read(`ranking_6422780_dayNumber_${day}.json`), mt = read(`mvp-tipps_${day}.json`);
      const offen = [rk?.il === true && 'Ranking noch live', mt && mt.status !== 'finished' && 'MVP-Tipp noch nicht ausgewertet', ac?.pendingCorrections && 'Abrechnung noch mit unkorrigierten Punkten', bumsOffen && 'BumsParade-Aufgaben noch offen'].filter(Boolean);
      if (offen.length) { weiter = true; aktiv = !(now - Date.parse(read('_meta.json')?.exportedAt) < 14 * 60 * 1000); console.log(`Spieltag ${day} vorbei, Online-Daten noch nicht endgültig (${offen.join(', ')}).`); }
    }
  }
} catch (e) { console.log('Spielplan nicht abrufbar, Lauf findet statt:', e.message); }
console.log(aktiv ? 'Daten werden abgerufen.' : 'Kein Spiel in diesem Zeitfenster: Lauf wird übersprungen.');
if (weiter) console.log('Naechster Lauf wird in 5 Minuten selbst angestossen.');
if (process.env.GITHUB_OUTPUT) fs.appendFileSync(process.env.GITHUB_OUTPUT, `aktiv=${aktiv}\nweiter=${weiter}\n`);
