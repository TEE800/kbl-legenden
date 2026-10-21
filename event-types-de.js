// Deutsche Namen fuer die Kickbase-Ereignisarten (Stammliste /v4/live/eventtypes, Titel dort auf Englisch).
// Uebersetzt wird der Grundtitel; Zusaetze wie (GK) oder "PlusOne" werden angehaengt.
const BASE = {
  '2nd Yellow': 'Gelb-Rot', '6 Sec violation': '6-Sekunden-Regel verletzt', 'Accurate Keeper-Sweeper': 'Erfolgreich herausgelaufen',
  'Accurate Throw': 'Genauer Abwurf', 'Accurate long Ball': 'Genauer langer Ball', 'Aerial lost': 'Kopfballduell verloren',
  'Aerial won': 'Kopfballduell gewonnen', 'Assist': 'Vorlage', 'Back Pass Foul': 'Rückpass aufgenommen',
  'Ball covered challenged': 'Ball unter Druck gesichert', 'Ball covered unchallenged': 'Ball ohne Druck gesichert',
  'Ball intercepted': 'Ball abgefangen', 'Big Chance Created': 'Großchance vorbereitet', 'Big Chance missed': 'Großchance vergeben',
  'Big Chance saved': 'Großchance pariert', 'Bonus: Last Man Tackle': 'Bonus: Rettung als letzter Mann',
  'Bonus: long range': 'Bonus: Distanzschuss', 'Challenge lost': 'Zweikampf verloren', 'Clean Sheet': 'Weiße Weste',
  'Cleared': 'Ball geklärt', 'Cleared off the Line': 'Auf der Linie geklärt', 'Cleared on the Line': 'Auf der Linie geklärt',
  'Contest won': 'Dribbling gewonnen', 'Corner won': 'Ecke herausgeholt', 'Cross': 'Flanke', 'Cross Intercepted': 'Flanke abgefangen',
  'Cross blocked': 'Flanke geblockt', 'Cross blocked and Possession': 'Flanke geblockt und Ball behalten',
  'Cross not claimed': 'Flanke verpasst', 'Dangerous play': 'Gefährliches Spiel', 'Deadly Pass': 'Tödlicher Pass',
  'Deflected Assist': 'Abgefälschte Vorlage', 'Distance Shot saved': 'Distanzschuss pariert', 'Dive Catch': 'Ball im Hechtsprung gefangen',
  'Dive Save': 'Parade im Hechtsprung', 'Forward zone pass': 'Pass in die gegnerische Hälfte', 'Foul': 'Foul begangen',
  "Fouled in the opponent's half": 'In der gegnerischen Hälfte gefoult', 'Fouled last third': 'Im letzten Drittel gefoult',
  'Game Lost': 'Spiel verloren', 'Game Won': 'Spiel gewonnen', 'Goal': 'Tor', 'Goal Set up': 'Tor vorbereitet',
  'Goal behind "The Line"': 'Tor von hinter „The Line“', 'Goal conceded': 'Gegentor', 'Hand Ball': 'Handspiel', 'Handball': 'Handspiel',
  'Incorrect Play-In': 'Falsches Einspiel', 'Incorrect Throw-In': 'Falscher Einwurf', 'Intentional Assist': 'Gewollte Vorlage',
  'Interception': 'Ball abgefangen', 'Interception in Box': 'Ball im Strafraum abgefangen', 'Left Post': 'Linker Pfosten',
  'Mistake before Goal': 'Fehler vor Gegentor', 'Mistake before Shot': 'Fehler vor Torschuss', 'Offside': 'Abseits',
  'One-on-One': 'Eins gegen Eins (Torwart)', 'Overrun': 'Überlaufen worden', 'Own Goal forced': 'Eigentor erzwungen',
  'Own goal': 'Eigentor', 'own goal': 'Eigentor', 'Pass': 'Pass', 'Pass final Third': 'Pass ins letzte Drittel',
  'Penalty conceded': 'Elfmeter verursacht', 'Penalty missed': 'Elfmeter verschossen', 'Penalty saved': 'Elfmeter gehalten',
  'Penalty scored': 'Elfmeter verwandelt', 'Penalty won': 'Elfmeter herausgeholt', 'Played Minutes Bonus': 'Bonus für Spielminuten',
  'Possession lost': 'Ballverlust', 'Post': 'Pfosten', 'Punched Ball': 'Ball weggefaustet', 'Rebound Assist': 'Abpraller-Vorlage',
  'Red Card': 'Rote Karte', 'Red card': 'Rote Karte', 'Right Post': 'Rechter Pfosten', 'Secondary Assist': 'Vorvorlage',
  'Shot Assist': 'Torschuss vorbereitet', 'Shot blocked': 'Schuss geblockt', 'Shot on Goal': 'Torschuss', 'Shot on goal': 'Torschuss',
  'Shot on Target': 'Torschuss', 'Shot on target': 'Schuss aufs Tor', 'Shot saved': 'Schuss pariert',
  'Standing saved': 'Parade im Stehen', 'Starting 11': 'In der Startelf', 'Starting 6': 'In der Start-Sechs',
  'Tackle won': 'Tackling gewonnen', 'Team Goal': 'Tor der eigenen Mannschaft', 'Team goal': 'Tor der eigenen Mannschaft',
  'Time penalty': 'Zeitstrafe', 'Woodwork Assist': 'Vorlage über Pfosten/Latte', 'Yellow Card': 'Gelbe Karte', 'subbed on': 'Eingewechselt'
};
const EXTRA = {
  'GK': 'Torwart', 'Defender': 'Abwehr', 'Midfielder': 'Mittelfeld', 'Striker': 'Sturm', 'Substitute': 'Joker', 'FP': 'Feldspieler',
  'Field player': 'Feldspieler', 'field player': 'Feldspieler', 'narrow miss': 'knapp vorbei', 'far away': 'weit vorbei', 'blocked': 'geblockt',
  'in the box': 'im Strafraum', 'outside the box': 'außerhalb des Strafraums', 'penalty shoot-out': 'Elfmeterschießen'
};
export function germanEventTitle(title) {
  let t = String(title || '').replace(/\s+/g, ' ').trim();
  if (!t) return null;
  let mode = '';
  const m = t.match(/\s*"(PlusOne|Plus One|3 Play|1-ON-1|1-on-1|Fairplay)"\s*/);
  if (m) { mode = m[1]; t = t.replace(m[0], ' ').trim(); }
  const extras = [];
  t = t.replace(/\s*\(([^)]*)\)/g, (_, x) => { extras.push(EXTRA[x] || x); return ''; }).trim();
  const base = BASE[t];
  if (!base) return null;
  const parts = [...extras]; if (mode) parts.push('Spielmodus ' + mode.replace('Plus One', 'PlusOne'));
  return parts.length ? `${base} (${parts.join(', ')})` : base;
}
