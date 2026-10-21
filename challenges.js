// Challenge-Wertung der Legenden (nur lesend gegenueber Kickbase).
// Welche Challenges: nur Rush-Challenges mit einem Spieltag (cht/t = 2) seit Saisonstart, egal welche Liga (Vorgabe Kevin).
// 1. Die von T800 gespielten aus /v4/challenges/lobby/archive (Name chn, Typ cht, Wettbewerb cpi, Spieltag day, Punkte p),
//    Enddatum aus /v4/challenges/archive.
// 2. Die uebrigen durch Durchprobieren der Nummern seit Saisonstart (/v4/challenges/{ch}/ranking: chn, t;
//    Wettbewerb aus /lineup/overview cpi). Spieltag = der einer bekannten Challenge desselben Wettbewerbs mit naher
//    Nummer (Rush-Challenges einer Woche haben aufeinanderfolgende Nummern). Datum geschaetzt.
// Aufstellung je Manager: /v4/challenges/{ch}/table/{userId} (404 oder leer = nicht gespielt). ACHTUNG: die Punkte darin
// sind die des AKTUELLEN Spieltags, nicht des Challenge-Spieltags (an 1147 geprueft, auch ?dayNumber hilft nicht).
// Darum: Punkte je Spieler aus /v4/competitions/{cpi}/players/{pi}/performance fuer den Challenge-Spieltag,
// Kapitaen (ictp) doppelt. Gegenprobe: T800-Punkte gegen p aus dem Lobby-Archiv; Abweichung = Challenge nicht gewertet.
// Gefundene Challenges eines Wettbewerbs zaehlen nur, wenn dessen Gegenproben alle stimmen.
// Liga-eigene Challenges (cht 3) und Perfect Matchday (cht 5) zaehlen nicht.
// Abgeschlossene Challenges und gepruefte Nummern werden in kbl-challenge-cache.json gespeichert.
// Rush: /v4/challenges/{ch}/favorites liefert fuer die Favoriten (alle Legenden) Gesamtplatz pl, Punkte p, Top-Prozent top
// und das Bild der aktuellen Rush-Division dvim (nur bei den juengsten Challenges, aeltere ohne p). Rush-Punkte je
// Challenge = Kickbase-Skala Top-Prozent -> Punkte, abgelesen aus T800s Lobby-Archiv (top, skp). T800 selbst: echte skp.
// Division: dvim -> /v4/challenges/lobby/divisionLadder (dvn, bod = Untergrenze). Gesamt-Rushpunkte anderer liefert
// Gesamt-Rushpunkte skp und Division aller gefolgten Manager: /v4/challenges/socialhub (shfl[]: ui, skp, dvim).
// Favoriten (Platz, Top-%) gibt es nur kurz, darum laedt der Server regelmaessig (Dienst-Login) und sichert sie.
import fs from 'node:fs';

const CACHE_FILE = 'kbl-challenge-cache.json';
const SEASON_START = '2026-08-01T00:00:00Z';
const LEAGUE = '6422780';
const MAX_SCAN = 1500; // Sicherheitsgrenze fuer die Zahl gepruefter Nummern pro Lauf

function readCache() {
  try { const c = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8')); c.challenges ||= {}; c.checked ||= {}; return c; }
  catch { return { challenges: {}, checked: {} }; }
}
function writeCache(c) {
  const tmp = CACHE_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(c, null, 1));
  fs.renameSync(tmp, CACHE_FILE);
}

// Spieltagspunkte eines Spielers aus "performance": neueste Saison mit Eintraegen fuer den Tag; mehrere Spiele am Tag
// (z. B. MLS-Doppelspieltag) werden addiert. Kein Eintrag = 0 (nicht im Kader/eingesetzt).
function dayPoints(perf, day) {
  const seasons = Array.isArray(perf?.it) ? perf.it : [];
  for (const s of [...seasons].reverse()) {
    const recs = [...new Map((s.ph || []).filter(x => Number(x.day) === day).map(x => [JSON.stringify(x), x])).values()];
    if (recs.length) return recs.reduce((sum, r) => sum + (Number(r.p) || 0), 0);
  }
  return 0;
}

// Fehlendes Datum: von der naechstkleineren Nummer mit bekanntem Datum (Nummern steigen mit der Zeit).
function fillDates(challenges) {
  const known = Object.values(challenges).filter(c => c.end && !c.endApprox).sort((a, b) => a.ch - b.ch);
  for (const c of Object.values(challenges)) {
    if (c.end && !c.endApprox) continue;
    const lower = known.filter(k => Number(k.ch) < Number(c.ch)).at(-1), higher = known.find(k => Number(k.ch) > Number(c.ch));
    c.end = (lower || higher)?.end || null;
    c.endApprox = true;
  }
}

export function registerChallenges(app, { kbFetch, getToken, validManager, autoToken }) {
  let progress = null; // { phase, done, total } waehrend eines Ladelaufs
  let lastResult = null;

  // Liefert die gespeicherte Wertung. Laedt nichts bei Kickbase (Gaeste duerfen das ansehen).
  app.get('/api/challenges', (req, res) => {
    const { checked, ...c } = readCache();
    // Gewertet wird: Gegenprobe stimmt; gefundene nur, wenn alle Gegenproben ihres Wettbewerbs stimmen.
    const byCpi = {};
    for (const x of Object.values(c.challenges)) if (x.check) (byCpi[x.cpi] ||= []).push(x.check.ok);
    for (const x of Object.values(c.challenges)) {
      x.counted = x.check ? x.check.ok : x.found ? !!byCpi[x.cpi]?.length && byCpi[x.cpi].every(Boolean) : true;
      if (!x.cpi || !x.day) x.counted = false;
    }
    res.set('Cache-Control', 'no-store').json({ ...c, running: progress, lastResult, seasonStart: SEASON_START });
  });

  // Neue abgeschlossene Challenges bei Kickbase nachladen. Laeuft im Hintergrund; Stand ueber GET /api/challenges.
  // POST = im Vorschaumodus nur fuer den Admin.
  app.post('/api/challenges/refresh', (req, res) => {
    const token = getToken(req);
    if (!token) return res.status(401).json({ error: 'Nicht angemeldet.' });
    if (!start(token)) return res.status(409).json({ error: 'Wird schon geladen. Bitte kurz warten.' });
    res.status(202).json({ started: true });
  });
  function start(token) {
    if (progress) return false;
    progress = { phase: 'Start', done: 0, total: 0 };
    lastResult = null;
    run(token).then(r => { lastResult = r; }, err => { lastResult = { error: 'Challenges konnten nicht geladen werden: ' + err.message }; })
      .finally(() => { progress = null; });
    return true;
  }
  // Automatisch alle 3 Stunden (Dienst-Login oder angemeldeter Admin), damit die Favoriten-Daten (Rush) gesichert
  // werden, solange Kickbase sie liefert.
  if (autoToken) {
    const tick = async () => { try { const t = await autoToken(); if (t) start(t); } catch (e) { console.log('Challenges automatisch laden fehlgeschlagen:', e.message); } };
    setInterval(tick, 3 * 3600 * 1000).unref();
    setTimeout(tick, 5 * 60 * 1000).unref();
  }

  async function run(token) {
    const cache = readCache();
    const now = Date.now(), seasonStart = Date.parse(SEASON_START);
    const [archive, lobby, overview, ranking] = await Promise.all([
      kbFetch('/v4/challenges/archive', { token }),
      kbFetch('/v4/challenges/lobby/archive', { token }),
      kbFetch('/v4/challenges/lobby/overview', { token }).catch(() => ({ my: [] })),
      kbFetch(`/v4/leagues/${LEAGUE}/ranking`, { token })
    ]);
    const managers = (ranking.us || []).filter(u => validManager(String(u.i)) && String(u.n || '').toLowerCase() !== 't1000')
      .map(u => ({ id: String(u.i), name: String(u.n || u.i) }));
    const ends = new Map((archive.it || []).map(a => [String(a.ch), a.lie]));
    const open = new Set((overview.my || []).map(x => String(x.ch)));

    for (const [ch, why] of Object.entries(cache.checked)) if (why === 'Spieltag unbekannt') delete cache.checked[ch];
    // Aufraeumen: frueher gespeicherte "leere" Teilnahmen (ohne Aufstellung) entfernen.
    for (const c of Object.values(cache.challenges)) for (const [id, r] of Object.entries(c.results || {})) if (!r.players) delete c.results[id];

    // 1. Von T800 gespielte Rush-Challenges. Nur Saisons (sid), die laut Archiv nach Saisonstart enden; sonst
    // rutschen Vorjahres-Challenges ohne Datum hinein (gesehen: "Bundesliga Matchday Challenge #31").
    const seasons = new Set((archive.it || []).filter(a => a.lie && Date.parse(a.lie) >= seasonStart).map(a => String(a.sid)));
    const candidates = new Map(), ownRush = new Map(), weekOf = new Map();
    // Erste Nummer der Saison: hoechste Nummer, die vor Saisonstart endete, plus eins.
    let first = 1;
    for (const [ch, lie] of ends) if (lie && Date.parse(lie) < seasonStart) first = Math.max(first, Number(ch) + 1);
    for (const w of lobby.it || []) for (const x of w.it || []) {
      const ch = String(x.ch);
      if (!/^\d{1,12}$/.test(ch)) continue;
      if (w.wn != null) weekOf.set(ch, Number(w.wn));
      if (Number(x.cht) === 2 && x.top != null && x.skp != null) ownRush.set(ch, { top: Number(x.top), skp: Number(x.skp) });
      // Wettbewerbe mit eigener Saison-ID (z. B. 2. Bundesliga, sid 43) fehlen in seasons; Nummern ab Saisonbeginn zaehlen trotzdem.
      if (!seasons.has(String(x.sid)) && Number(ch) < first) continue;
      const end = ends.get(ch) || null;
      if (end && (Date.parse(end) < seasonStart || Date.parse(end) > now)) continue;
      candidates.set(ch, { name: x.chn, cht: Number(x.cht), end, slots: x.clpc ?? null, cpi: x.cpi != null ? String(x.cpi) : null, day: Number(x.day) || null, expected: Number.isFinite(Number(x.p)) && x.p != null ? Number(x.p) : null });
    }
    // Gespeicherte, die nicht mehr passen (falsche Saison) oder deren Gegenprobe nicht stimmte, neu bewerten.
    for (const c of Object.values(cache.challenges)) {
      // Challenges mit abweichender Gegenprobe bleiben gespeichert (nur fuer Challenge-Punkte relevant, die nicht mehr
      // angezeigt werden); frueher wurden sie bei jedem Laden neu berechnet und meldeten jedes Mal dieselbe Abweichung.
      if (!c.found && !candidates.has(c.ch)) delete cache.challenges[c.ch];
    }
    const highestKnown = Math.max(0, ...[...ends.keys(), ...open].map(Number).filter(Number.isFinite));

    // 2. Uebrige Nummern durchprobieren (nur einmal je Nummer; offene Challenges spaeter erneut).
    const toScan = [];
    for (let n = first; n <= highestKnown && toScan.length < MAX_SCAN; n++) {
      const ch = String(n);
      if (candidates.has(ch) || cache.challenges[ch] || cache.checked[ch] || open.has(ch)) continue;
      toScan.push(ch);
    }
    progress = { phase: 'Challenge-Nummern prüfen', done: 0, total: toScan.length };
    for (const ch of toScan) {
      try {
        const r = await kbFetch(`/v4/challenges/${ch}/ranking`, { token });
        if (Number(r.t) === 2) {
          const ov = await kbFetch(`/v4/challenges/${ch}/lineup/overview`, { token }).catch(() => ({}));
          candidates.set(ch, { name: r.chn, cht: 2, end: null, slots: r.clpc ?? null, found: true, cpi: ov.cpi != null ? String(ov.cpi) : null, day: null });
        }
        else cache.checked[ch] = 'andere';
      } catch (e) {
        if (e.status === 404) cache.checked[ch] = 'keine';
      }
      progress.done++;
    }

    // Spieltag fuer gefundene Challenges: von der naechsten bekannten Challenge desselben Wettbewerbs (Nummernabstand <= 15).
    const knownDays = [...candidates].filter(([, m]) => m.day && m.cpi).map(([ch, m]) => ({ ch: Number(ch), cpi: m.cpi, day: m.day }));
    for (const c of Object.values(cache.challenges)) if (c.day && c.cpi) knownDays.push({ ch: Number(c.ch), cpi: c.cpi, day: c.day });
    for (const [ch, m] of candidates) if (!m.day && m.cpi) {
      const near = knownDays.filter(k => k.cpi === m.cpi && Math.abs(k.ch - Number(ch)) <= 15).sort((a, b) => Math.abs(a.ch - ch) - Math.abs(b.ch - ch))[0];
      if (near) m.day = near.day;
    }

    // 3. Aufstellungen aller Legenden laden und Punkte des Challenge-Spieltags berechnen.
    const added = [], skipped = [], failed = [];
    const perfCache = new Map();
    const perf = async (cpi, pi) => {
      const key = cpi + ':' + pi;
      if (!perfCache.has(key)) perfCache.set(key, kbFetch(`/v4/competitions/${cpi}/players/${pi}/performance`, { token }));
      return perfCache.get(key);
    };
    const todo = [...candidates].filter(([ch]) => !cache.challenges[ch]);
    progress = { phase: 'Aufstellungen und Punkte laden', done: 0, total: todo.length };
    for (const [ch, meta] of todo) {
      progress.done++;
      if (meta.cht !== 2) { skipped.push({ ch, name: meta.name || null, cht: meta.cht }); continue; }
      if (!meta.cpi || !meta.day) {
        // Challenge-Punkte nicht berechenbar, Rush-Platzierungen (Favoriten) gibt es trotzdem.
        cache.challenges[ch] = { ch, name: meta.name || `Challenge ${ch}`, end: meta.end, found: !!meta.found, cpi: meta.cpi, day: meta.day, slots: meta.slots, check: null, results: {}, rushOnly: true };
        skipped.push({ ch, name: meta.name || null, grund: 'Wettbewerb oder Spieltag unbekannt (nur Rush)' }); continue;
      }
      const results = {};
      let errors = 0;
      for (const m of managers) {
        try {
          const t = await kbFetch(`/v4/challenges/${ch}/table/${m.id}`, { token });
          // MLS-Doppelspieltage: ein Spieler steht je Spiel einmal in lp. Er wird einmal gezaehlt, dafuer werden unten alle Spiele des Tages addiert.
          const lp = [...new Map((t.lp || []).map(p => [String(p.i), p])).values()];
          if (!lp.length) continue; // angemeldet, aber keine Aufstellung = nicht gespielt
          let total = 0, captain = null;
          const lineup = [];
          for (const p of lp) {
            const pts = dayPoints(await perf(meta.cpi, String(p.i)), meta.day);
            total += pts;
            if (p.ictp) { total += pts; captain = { id: String(p.i), points: pts }; }
            lineup.push({ i: String(p.i), p: pts, pos: p.pos, c: !!p.ictp });
          }
          results[m.id] = { points: total, captain, players: lp.length, lineup };
        } catch (e) {
          if (e.status !== 404) errors++;
        }
      }
      if (errors) { failed.push({ ch, name: meta.name || ch, errors }); continue; }
      const own = results['699062']?.points;
      // Kleine Abweichungen (bis 5 Punkte) zulassen: Nachholspiele/Punktekorrekturen nach Challenge-Ende (z. B. LaLiga #07: 1301 statt 1299, Vorgabe Kevin).
      const check = meta.expected != null && own != null ? { expected: meta.expected, computed: own, ok: Math.abs(own - meta.expected) <= 5 } : null;
      cache.challenges[ch] = { ch, name: meta.name || `Challenge ${ch}`, end: meta.end, found: !!meta.found, cpi: meta.cpi, day: meta.day, slots: meta.slots, check, results };
      added.push(cache.challenges[ch].name);
    }
    // 4. Rush: Skala Top-Prozent -> Rush-Punkte aus T800s Archiv; widerspruechliche Stufen werden nicht verwendet.
    // Feste Skala laut Kickbase (Tabelle von Kevin, gilt fuer alle Rush-Challenges ausser Perfect Matchday: dort 20 je
    // richtigem Tipp). T800s Archiv dient als Gegenprobe.
    const scale = { 1: 200, 5: 140, 10: 100, 15: 80, 20: 60, 25: 40, 30: 30, 40: 20, 50: 10, 60: -10, 70: -20, 80: -30, 100: -40 };
    const [ladder, profile, social] = await Promise.all([
      kbFetch('/v4/challenges/lobby/divisionLadder', { token }).catch(() => null),
      kbFetch('/v4/challenges/lobby/profile', { token }).catch(() => null),
      kbFetch('/v4/challenges/socialhub?start=0&max=200', { token }).catch(() => null)
    ]);
    const divs = (ladder?.dvs || []).map(d => ({ dvi: String(d.dvi), dvn: d.dvn, dvim: d.dvim, bod: Number(d.bod), uc: Number(d.uc) || 0 }));
    const byImg = new Map(divs.map(d => [d.dvim, d]));
    const ids = new Set(managers.map(m => m.id));
    // Erneut fragen, solange Legenden mit Aufstellung in der Favoriten-Antwort fehlen und Kickbase die Daten noch liefert.
    const missing = c => (c.rushOnly ? [] : Object.keys(c.results || {})).filter(id => !c.fav?.[id]);
    const fresh = c => !c.end || Date.now() - Date.parse(c.end) < 3 * 86400 * 1000;
    const favTodo = Object.values(cache.challenges).filter(c => !c.favDone || (fresh(c) && missing(c).length)).sort((a, b) => Number(b.ch) - Number(a.ch));
    // Juengste (auch laufende) Challenge zuerst: deren Favoriten liefern die aktuelle Division aller Legenden.
    const newest = [...open].sort((a, b) => b - a).slice(0, 3);
    progress = { phase: 'Rush-Daten laden', done: 0, total: favTodo.length + newest.length };
    const current = {}, totals = {};
    for (const f of [social?.shme, ...(social?.shfl || [])].filter(Boolean)) {
      const id = String(f.ui);
      if (!ids.has(id)) continue;
      if (Number.isFinite(Number(f.skp))) totals[id] = Number(f.skp);
      if (byImg.has(f.dvim)) current[id] = { ch: Infinity, dvi: byImg.get(f.dvim).dvi };
    }
    const takeDiv = (it, ch) => { for (const f of it) { const id = String(f.ui); if (!ids.has(id) || !byImg.has(f.dvim)) continue; if (!current[id] || Number(ch) > current[id].ch) current[id] = { ch: Number(ch), dvi: byImg.get(f.dvim).dvi }; } };
    for (const ch of newest) { try { takeDiv((await kbFetch(`/v4/challenges/${ch}/favorites`, { token })).it || [], ch); } catch {} progress.done++; }
    let favErrors = 0;
    for (const c of favTodo) {
      progress.done++;
      try {
        const it = (await kbFetch(`/v4/challenges/${c.ch}/favorites`, { token })).it || [];
        takeDiv(it, c.ch);
        const fav = {};
        const take = f => { const id = String(f.ui); if (ids.has(id) && f.p != null && f.top != null) fav[id] = { pl: Number(f.pl) || null, p: Number(f.p), top: Number(f.top) }; };
        it.forEach(take);
        // Legenden, die nicht in Kevins Kickbase-Favoriten stehen (z. B. diminator): ueber die Favoriten-Suche nach Namen.
        for (const id of c.rushOnly ? managers.map(m => m.id) : Object.keys(c.results || {})) {
          if (fav[id] || !cache.managers?.[id] && !managers.find(m => m.id === id)) continue;
          const name = managers.find(m => m.id === id)?.name || cache.managers[id];
          try {
            const f = (await kbFetch(`/v4/challenges/${c.ch}/favorites/search?query=${encodeURIComponent(name)}&start=0&max=20`, { token })).it?.find(f => String(f.ui) === id);
            if (f && f.top != null) take(f);
            else if (f && f.p != null && Number(f.pl) > 0) fav[id] = { pl: Number(f.pl), p: Number(f.p), top: null };
          } catch {}
        }
        // Suche liefert nur den Platz, kein Top-%. Die Teilnehmerzahl n ergibt sich aus den Favoriten derselben Challenge:
        // Top T % heisst Platz/n <= T % und > vorherige Stufe. Daraus ein Bereich fuer n; nur wenn die Stufe des Gesuchten
        // fuer den ganzen Bereich gleich ist, wird sie verwendet (sonst bleibt er ohne Wert).
        if (Object.values(fav).some(x => x.top == null)) {
          const steps = [1, 5, 10, 15, 20, 25, 30, 40, 50, 60, 70, 80, 100];
          let lo = 0, hi = Infinity;
          for (const x of Object.values(fav)) {
            if (x.top == null || !x.pl) continue;
            const k = steps.indexOf(x.top); if (k < 0) continue;
            lo = Math.max(lo, x.pl * 100 / x.top);
            if (k > 0) hi = Math.min(hi, x.pl * 100 / steps[k - 1]);
          }
          const bucket = (pl, n) => steps.find(b => pl / n * 100 <= b) ?? 100;
          for (const [id, x] of Object.entries(fav)) if (x.top == null) {
            const a = lo > 0 && Number.isFinite(hi) && lo < hi ? bucket(x.pl, lo) : null, b = a != null ? bucket(x.pl, hi - 1e-6) : null;
            if (a != null && a === b) { x.top = a; x.calc = true; } else delete fav[id];
          }
        }
        if (Object.keys(fav).length) { c.fav = fav; c.favDone = true; }
        // Aelter als 3 Tage und ohne Punkte: Kickbase liefert dafuer nichts mehr, nicht erneut fragen.
        else if (c.end && Date.now() - Date.parse(c.end) > 3 * 86400 * 1000) c.favDone = true;
      } catch (e) { if (e.status === 404) c.favDone = true; else favErrors++; }
    }
    // Kickbase-Woche (wn aus dem Lobby-Archiv); nicht von T800 gespielte: Woche der naechsten bekannten Nummer (<= 15 entfernt).
    const knownWeeks = [...weekOf].map(([ch, wn]) => [Number(ch), wn]);
    for (const c of Object.values(cache.challenges)) {
      if (weekOf.has(c.ch)) { c.wn = weekOf.get(c.ch); continue; }
      const near = knownWeeks.filter(([n]) => Math.abs(n - Number(c.ch)) <= 15).sort((a, b) => Math.abs(a[0] - c.ch) - Math.abs(b[0] - c.ch))[0];
      if (near) c.wn = near[1];
    }
    // Rush-Punkte je Challenge: T800 echt aus dem Archiv, die anderen ueber die Skala (fehlt die Stufe: null = unbekannt).
    let checkOk = 0; const checkBad = [];
    for (const c of Object.values(cache.challenges)) {
      const rush = {};
      for (const [id, f] of Object.entries(c.fav || {})) rush[id] = { ...f, skp: scale[f.top] ?? null };
      const own = ownRush.get(c.ch);
      if (own) {
        if (rush['699062'] && rush['699062'].skp != null) { if (rush['699062'].skp === own.skp) checkOk++; else checkBad.push(c.name); }
        rush['699062'] = { ...(rush['699062'] || {}), top: own.top, skp: own.skp, exact: true };
      }
      if (Object.keys(rush).length) c.rush = rush; else delete c.rush;
    }
    const now2 = new Date().toISOString();
    cache.rushHistory ||= {};
    for (const [id, d] of Object.entries(current)) {
      const h = (cache.rushHistory[id] ||= []);
      if (h.at(-1)?.dvi !== d.dvi) h.push({ at: now2, dvi: d.dvi });
    }
    // Verlauf der Gesamt-Rushpunkte (nur bei Aenderung ein neuer Eintrag).
    cache.rushTotals ||= {};
    // Zeitpunkte der Ladelaeufe: zeigen, dass zwischen zwei Wochen ein Stand gesichert wurde (exakte Wochenpunkte).
    cache.rushRuns = [...(cache.rushRuns || []), now2].slice(-2000);
    for (const [id, skp] of Object.entries(totals)) {
      const h = (cache.rushTotals[id] ||= []);
      if (h.at(-1)?.skp !== skp) h.push({ at: now2, skp });
    }
    cache.rush = { divisions: divs.map(({ dvim, ...d }) => d), current: Object.fromEntries(Object.entries(current).map(([id, d]) => [id, d.dvi])), totals, scale,
      ownTotal: Number.isFinite(Number(profile?.skp)) ? Number(profile.skp) : null, cycle: profile ? { name: profile.n, from: profile.sd, to: profile.ed } : null,
      check: { ok: checkOk, bad: checkBad }, updatedAt: now2 };
    fillDates(cache.challenges);
    // Gefundene Challenges, deren (geschaetztes) Datum vor Saisonstart liegt, wieder entfernen.
    for (const c of Object.values(cache.challenges)) if (c.endApprox && c.end && Date.parse(c.end) < seasonStart) { cache.checked[c.ch] = 'vor Saisonstart'; delete cache.challenges[c.ch]; }
    cache.managers = Object.fromEntries(managers.map(m => [m.id, m.name]));
    cache.updatedAt = new Date().toISOString();
    writeCache(cache);
    return { added, skipped, failed, favErrors, scanned: toScan.length, mismatched: Object.values(cache.challenges).filter(c => added.includes(c.name) && c.check && !c.check.ok).map(c => `${c.name} (${c.check.computed} statt ${c.check.expected})`) };
  }
}
