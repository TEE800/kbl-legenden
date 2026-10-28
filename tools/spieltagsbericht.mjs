// Spieltagsbericht (Kevin-Wunsch): Nach jedem vollständig abgerechneten Spieltag schreibt Claude (Anthropic-API) einen
// provokanten Bericht mit Sticheleien, gestützt auf Statistiken, die hier fest ausgerechnet werden.
// Grundsatz „nie raten“: Claude bekommt nur geprüfte Zahlen (FAKTEN) und darf keine eigenen ausrechnen oder erfinden.
//
// Läuft auf GitHub nach dem Export (seite.yml), liest site/data/. Der Bericht ist zuerst ein Entwurf im Tippdienst und wird erst
// nach Kevins Freigabe in der App veröffentlicht (kbl-berichte.json, site/data/berichte.json für public/bericht.js).
// Ohne Geheimnis ANTHROPIC_API_KEY wird nichts erzeugt, nur die gespeicherten Berichte veröffentlicht.
// Je Spieltag genau ein Aufruf (ca. 5 bis 10 Cent). Neu schreiben lassen: KBL_BERICHT_NEU=<Spieltag> (Workflow „Run workflow“).
// Nur ausrechnen und anzeigen, ohne API: node tools/spieltagsbericht.mjs --fakten <Spieltag>
import fs from 'node:fs';
import path from 'node:path';

const LEAGUE = '6422780';
const EXCLUDED_IDS = new Set(['3783040']); // T1000 zählt nirgends
const DATA = path.join(process.cwd(), 'site', 'data');
const STORE = path.join(process.cwd(), 'kbl-berichte.json');
const MODEL = process.env.KBL_BERICHT_MODEL || 'claude-sonnet-5-5';
// Falls ein Modellname nicht (mehr) existiert (Fehler 404), nacheinander diese versuchen.
const MODEL_FALLBACK = ['claude-sonnet-5-5', 'claude-sonnet-5', 'claude-sonnet-4-5'];
// Bei Änderungen an SYSTEM oder den Fakten hochzählen: der Bericht des neuesten Spieltags wird dann einmal neu geschrieben.
const VORGABEN = 3;
const RULE_NAMES = { BD: 'Besoffener Davies', DD: 'Dämonische Drehtür', MM: 'Magic Miyoshi', AH: 'Angeschossener Höler', RK: 'Räudiger Kohr', BN: 'Blinder Niklas', UM: 'Upamaguire', EZ: 'Einzelfallentscheidung', TL: 'Teamlimit' };

const read = f => { try { return JSON.parse(fs.readFileSync(path.join(DATA, f), 'utf8')); } catch { return null; } };
const readStore = () => { try { return JSON.parse(fs.readFileSync(STORE, 'utf8')); } catch { return { berichte: {} }; } };
const round = (x, n = 0) => Math.round(x * 10 ** n) / 10 ** n;
const mean = a => a.length ? a.reduce((s, x) => s + x, 0) / a.length : null;
const sd = a => { const m = mean(a); return a.length ? Math.sqrt(mean(a.map(x => (x - m) ** 2))) : null; };

function publish(store) {
  const list = Object.values(store.berichte || {}).sort((a, b) => b.day - a.day);
  fs.mkdirSync(DATA, { recursive: true });
  fs.writeFileSync(path.join(DATA, 'berichte.json'), JSON.stringify({ berichte: list }));
}

// ---- Bumsungen eines Spieltags: gleiche Rechnung wie bumsCounts/bumsStaticDerive in public/app.js (bei Änderungen beide anpassen) ----
const unclearKey = u => `${u.rule}:${u.managerId}:${u.playerId}`;
const PICK_TO_RULES = ['RK', 'BN', 'AH', 'TL', 'UM'];
const recvVerb = r => r === 'AH' ? 'kauft' : 'bekommt';
function todoPlayer(t) { const x = t.text || '', m = /bietet den MVP (.+) zum Verkauf an/.exec(x) || /gibt (.+) an einen Mitmanager ab/.exec(x) || /verkauft (.+?) \(/.exec(x) || /^verkauft (.+?) an den Markt/.exec(x) || /^gibt (.+?) an /.exec(x); return m ? m[1] : (t.to || [])[0]?.playerName || null; }
function todoPick(t) { if (t.rule === 'MM') return 'mm'; if (t.rule === 'DD') return t.options?.length ? 'dd' : null; if (PICK_TO_RULES.includes(t.rule)) return 'to'; return null; }
const eligibleName = n => String(n || '').trim().toLowerCase() !== 't1000';
function bumsCounts(d, checks) {
  const out = {}, idOf = new Map((d.plausibility || []).map(p => [p.manager, String(p.managerId)]));
  const blank = name => ({ name, count: 0, rules: {}, moves: [] });
  for (const p of (d.plausibility || [])) if (eligibleName(p.manager)) out[String(p.managerId)] = blank(p.manager);
  const add = (mid, name, rule, dir, text) => { mid = mid != null && mid !== '' ? String(mid) : idOf.get(name); if (!mid || !/^\d+$/.test(mid) || !name || !eligibleName(name)) return;
    const e = out[mid] || (out[mid] = blank(name)); e.count++; e.rules[rule] = (e.rules[rule] || 0) + 1; e.moves.push({ regel: rule, richtung: dir === 'i' ? 'bekommen' : 'abgegeben', text: String(text || '').slice(0, 200) }); };
  for (const t of (d.todos || [])) {
    if (checks?.[t.key]?.removed) continue;
    const tgt = checks?.[t.key]?.target || null, pk = todoPick(t), pl = todoPlayer(t);
    let to = (t.to || []).map(r => ({ ...r, playerName: pk === 'dd' && tgt ? tgt : r.playerName }));
    if (pk === 'to' && tgt) to = tgt === 'Markt' ? [] : [{ managerId: null, manager: tgt, playerName: pl }];
    const to0 = to[0], moved = to0?.playerName && ['DD', 'AH', 'RK', 'BN', 'TL', 'UM'].includes(t.rule) ? `${t.rule === 'AH' || t.rule === 'TL' ? 'verkauft' : 'gibt'} ${to0.playerName} an ${to.map(r => r.manager).join(', ')}` : pk === 'to' && tgt === 'Markt' ? `verkauft ${pl || 'den Spieler'} an den Markt` : null;
    const mmTo = t.rule === 'MM' ? tgt : null;
    add(t.managerId, t.manager, t.rule, 'o', t.rule === 'MM' ? (mmTo ? `verteilt MM an ${mmTo}` : 'verteilt MM') : (moved || t.text));
    if (t.rule !== 'TL') for (const r of to) add(r.managerId, r.manager, t.rule, 'i', `${recvVerb(t.rule)} ${r.playerName || 'einen Spieler'} von ${t.manager}`);
    if (mmTo) add(null, mmTo, 'MM', 'i', `bekommt MM von ${t.manager}: einen Spieler weniger aufstellen`);
  }
  for (const u of (d.autoEvents?.error ? [] : (d.autoEvents?.unclear || []))) {
    const g = checks?.[unclearKey(u)]?.target, pn = u.playerName || 'den Spieler';
    if (g === 'Entfällt') continue;
    if (!g) { add(u.managerId, u.manager, u.rule, 'o', `unklar: ${u.reason || ''}`); continue; }
    add(u.managerId, u.manager, u.rule, 'o', g === 'Markt' ? `verkauft ${pn} an den Markt` : `gibt ${pn} an ${g}`); if (g !== 'Markt') add(null, g, u.rule, 'i', `${recvVerb(u.rule)} ${pn} von ${u.manager}`);
  }
  return out;
}
// Abgerechnet = wie in der BumsParade „✓ abgerechnet“: Abrechnung fertig, keine offenen Korrekturen, alle Aufgaben erledigt, nichts unklar.
// Online gesetzte Haken liegen im Tippdienst und werden wie in public/static-mode.js dazugemischt (neuerer Zeitstempel gewinnt).
const HAKEN = {};
const mergeChecks = (base, over) => { const out = { ...(base || {}) }; for (const [k, v] of Object.entries(over || {})) { const b = out[k]; if (b?.at && v?.at && b.at >= v.at) continue; if (v?.done) { const { done, target, removed, at } = v; out[k] = { done, at, ...(target ? { target } : {}), ...(removed ? { removed: true } : {}) }; } else delete out[k]; } return out; };
async function loadHaken(upTo) {
  const api = String(process.env.KBL_TIPP_DIENST || '').replace(/\/+$/, ''); if (!api) return;
  await Promise.all(Array.from({ length: upTo }, (_, k) => k + 1).map(async d => { try { const r = await fetch(`${api}/haken/${d}`, { signal: AbortSignal.timeout(15000) }); if (r.ok) HAKEN[d] = (await r.json()).checks || {}; } catch {} }));
}
function settlement(day) {
  const d = read(`rule-accounting_${day}.json`), c = read(`todo-checks_${day}.json`);
  if (!d?.ready || !d?.complete || d?.pendingCorrections) return null;
  const checks = mergeChecks(c?.checks, HAKEN[day]), todos = (d.todos || []).filter(t => !checks[t.key]?.removed);
  const done = todos.filter(t => t.check?.state === 'done' || checks[t.key]?.done).length;
  const unclear = (d.autoEvents?.error ? [] : (d.autoEvents?.unclear || [])).filter(u => !checks[unclearKey(u)]?.target).length;
  return { acc: d, checks, settled: done >= todos.length && !unclear, bums: bumsCounts(d, checks) };
}
function bumsSeason(upTo) {
  // Saison-Stand je Manager: abgeleitete Spieltage, sonst (von Hand nachgetragen) die gespeicherte BumsTabelle.
  const stored = read('bumsungen.json')?.days || {}, tot = {}, from = upTo <= 17 ? 1 : 18;
  for (let day = from; day <= upTo; day++) {
    const s = stored[day]?.manual ? null : settlement(day);
    const m = s ? s.bums : (stored[day]?.managers || {});
    for (const [id, v] of Object.entries(m)) { if (EXCLUDED_IDS.has(id)) continue; (tot[id] ||= { name: v.name, bumsungen: 0 }).bumsungen += v.count || 0; }
  }
  return tot;
}

// ---- Fakten für den Bericht ----
function facts(day) {
  const R = {}; for (let d = 1; d <= day; d++) R[d] = read(`ranking_${LEAGUE}_dayNumber_${d}.json`);
  if (!R[day]?.us?.length) throw Error(`Ranking von Spieltag ${day} fehlt`);
  const ids = R[day].us.map(u => String(u.i)).filter(i => !EXCLUDED_IDS.has(i));
  const u = (d, i) => R[d]?.us?.find(x => String(x.i) === i);
  // Tagespunkte = Differenz der kumulierten Gesamtpunkte (CLAUDE.md). mdp von Spieltag 1 ist bei Kickbase teils falsch (−1100).
  const dayPts = (i, d) => { const a = u(d, i)?.sp, b = d > 1 ? u(d - 1, i)?.sp : 0; return Number.isFinite(a) && Number.isFinite(b) ? a - b : null; };
  const name = i => u(day, i).n;
  const days = Array.from({ length: day }, (_, k) => k + 1);
  const leagueAvg = d => round(mean(ids.map(i => dayPts(i, d)).filter(Number.isFinite)));
  const ligaSchnitt = days.map(d => ({ spieltag: d, schnitt: leagueAvg(d) }));
  const sorted = ids.map(i => ({ i, p: dayPts(i, day) })).sort((a, b) => b.p - a.p);
  const totalRank = (d) => { const arr = ids.map(i => ({ i, sp: u(d, i)?.sp ?? -Infinity })).sort((a, b) => b.sp - a.sp); return new Map(arr.map((x, k) => [x.i, k + 1])); };
  const ranks = Object.fromEntries(days.map(d => [d, totalRank(d)]));
  const dayRankMap = d => { const arr = ids.map(i => ({ i, p: dayPts(i, d) })).sort((a, b) => b.p - a.p); return new Map(arr.map((x, k) => [x.i, k + 1])); };
  const dayRanks = Object.fromEntries(days.map(d => [d, dayRankMap(d)]));

  // Spielerpunkte des Spieltags (alle Bundesliga-Spieler aus der AH-Prüfung) + Startelfen aus dem Ranking (lp).
  const S = settlement(day), acc = S?.acc || read(`rule-accounting_${day}.json`) || {};
  const allPts = new Map((acc.ah?.mvp?.all || []).map(p => [String(p.id), p]));
  const names = Object.assign({}, ...(read(`lineup-snapshots_${day}.json`)?.snapshots || []).map(s => s.playerNames || {}));
  const plaus = new Map((acc.plausibility || []).map(p => [String(p.managerId), p]));

  // Auflagen aus der Abrechnung des Vorspieltags (z. B. Magic Miyoshi: mit einem Spieler weniger antreten). Eine dadurch leere
  // Position ist eine Strafe, kein eigener Fehler (Kevin, ST 7: Stammler9 hatte MM von Cello).
  const prevBums = day > 1 ? (settlement(day - 1)?.bums || read('bumsungen.json')?.days?.[day - 1]?.managers || {}) : {};
  const auflagen = id => (prevBums[id]?.moves || []).filter(m => (m.richtung || (m.d === 'i' ? 'bekommen' : '')) === 'bekommen').map(m => ({ regel: RULE_NAMES[m.regel || m.r] || m.regel || m.r, text: m.text || m.t }));
  const manager = ids.map(i => {
    const pts = days.map(d => dayPts(i, d)), last = pts[day - 1];
    const own = pts.filter(Number.isFinite);
    const lp = (u(day, i).lp || []).filter(Boolean).map(String);
    const players = lp.map(pid => { const p = allPts.get(pid); return { name: p?.name || names[pid] || pid, verein: p?.team || null, punkte: p ? p.points : 0 }; }).sort((a, b) => b.punkte - a.punkte);
    const pl = plaus.get(i), empty = pl?.emptySlots ?? (11 - lp.length);
    const sumOk = players.reduce((s, p) => s + p.punkte, 0) - 100 * empty === last;
    const top = players[0];
    const ohneLeere = last + 100 * empty;
    let streak = 0; for (let d = day; d >= 1; d--) { if (dayPts(i, d) < leagueAvg(d)) streak++; else break; }
    let streakUp = 0; for (let d = day; d >= 1; d--) { if (dayPts(i, d) > leagueAvg(d)) streakUp++; else break; }
    const r = ranks[day].get(i), prevR = day > 1 ? ranks[day - 1].get(i) : null;
    const aboveSp = ids.map(j => u(day, j).sp).filter(x => x > u(day, i).sp).sort((a, b) => a - b)[0];
    const belowSp = ids.map(j => u(day, j).sp).filter(x => x < u(day, i).sp).sort((a, b) => b - a)[0];
    return {
      name: name(i), id: i, admin: i === '699062' ? 'Admin der Liga und Erbauer dieser App' : undefined,
      spieltagPunkte: last, spieltagPlatz: dayRanks[day].get(i), gesamtPunkte: u(day, i).sp, gesamtPlatz: r, gesamtPlatzVorher: prevR,
      platzVerlauf: days.map(d => ranks[d].get(i)), punkteJeSpieltag: pts, spieltagPlatzJeSpieltag: days.map(d => dayRanks[d].get(i)),
      saisonSchnitt: round(mean(own)), streuung: round(sd(own)), besterSpieltag: Math.max(...own), schlechtesterSpieltag: Math.min(...own),
      schnittLetzte3: own.length >= 3 ? round(mean(own.slice(-3))) : null, schnittDie3Davor: own.length >= 6 ? round(mean(own.slice(-6, -3))) : null,
      spieltagssiege: days.filter(d => dayRanks[d].get(i) === 1).length, spieltagsletzter: days.filter(d => dayRanks[d].get(i) === ids.length).length,
      unterLigaschnittInFolge: streak, ueberLigaschnittInFolge: streakUp,
      abstandZumVordermann: aboveSp != null ? aboveSp - u(day, i).sp : null, vorsprungAufHintermann: belowSp != null ? u(day, i).sp - belowSp : null,
      leerePositionen: empty, strafeLeerePositionen: 100 * empty,
      auflagenVomVorspieltag: auflagen(i),
      ...(empty ? { leerePositionGrund: auflagen(i).some(x => x.regel === 'Magic Miyoshi') ? `erzwungen durch Magic Miyoshi (${auflagen(i).find(x => x.regel === 'Magic Miyoshi').text}), kein eigener Fehler` : 'keine Auflage bekannt, also selbst verschuldet' } : {}),
      spieltagPlatzOhneLeerePositionen: empty ? 1 + ids.filter(j => j !== i && dayPts(j, day) > ohneLeere).length : undefined,
      ...(sumOk && top ? {
        topSpieler: { ...top, anteilProzent: last > 0 ? round(100 * top.punkte / last) : null, spieltagPunkteOhneIhn: last - top.punkte, spieltagPlatzOhneIhn: 1 + ids.filter(j => j !== i && dayPts(j, day) > last - top.punkte).length },
        flopSpieler: players[players.length - 1], minusSpieler: players.filter(p => p.punkte < 0),
      } : { spielerpunkte: 'nicht sicher, darum weggelassen' }),
    };
  });

  // MVP und MVP-Tipp
  const mt = read(`mvp-tipps_${day}.json`);
  const mvpTipp = mt && mt.status === 'finished' ? (() => {
    const pool = mt.result?.pool, top = mt.tracking?.top10?.players || [], mvp = mt.result?.mvp;
    const tips = (mt.managers || []).filter(m => m.tip && !EXCLUDED_IDS.has(String(m.id))).map(m => {
      const pid = String(m.tip.playerId), act = mt.tracking?.players?.[pid]?.points ?? top.find(p => String(p.id) === pid)?.points ?? null;
      return { manager: m.name, tippSpieler: m.tip.player, tippVerein: m.tip.team, tippZahl: m.tip.points, spielerPunkte: act, nachAnpfiffNachgetragen: !!m.tip.late };
    });
    const winners = (mt.result?.winners || []).map(w => w.name || w.manager || w);
    const missBy = mvp?.points != null ? tips.filter(t => t.spielerPunkte != null).map(t => ({ ...t, fehlenZumMvp: mvp.points - t.spielerPunkte })).filter(t => t.fehlenZumMvp > 0).sort((a, b) => a.fehlenZumMvp - b.fehlenZumMvp) : [];
    return {
      regel: mt.rule?.text || mt.rule?.title || null, regelVon: mt.rule?.by?.name || null, erlaubteVereine: pool || null,
      mvpNachRegel: mvp ? { spieler: (mvp.players || []).map(p => `${p.name} (${p.team})`), punkte: mvp.points } : null,
      top10NachRegel: top.map(p => `${p.name} (${p.team}) ${p.points}`), gewinner: winners, treffer: winners.length,
      tipps: tips, knappsteFehlschuesse: missBy.slice(0, 4),
      bisherigeTippspiele: days.filter(d => read(`mvp-tipps_${d}.json`)?.rule).length,
    };
  })() : null;

  // Sonderregeln und Bumsungen
  const bumsDay = S ? Object.values(S.bums).filter(v => v.count).sort((a, b) => b.count - a.count).map(v => ({ manager: v.name, bumsungen: v.count, regeln: v.rules, vorgaenge: v.moves })) : null;
  const ohneBumsung = S ? Object.values(S.bums).filter(v => !v.count).map(v => v.name) : null;
  const season = bumsSeason(day);
  const bumsSaison = Object.values(season).sort((a, b) => b.bumsungen - a.bumsungen);
  const ah = acc.ah?.mvp ? { mvpDesSpieltags: (acc.ah.mvp.players || []).map(p => `${p.name} (${p.team}) ${p.points}`), top5: (acc.ah.mvp.top || []).map(p => `${p.name} (${p.team}) ${p.points}`), betroffen: (acc.ah.affected || []).map(a => `${a.manager} hatte ${a.playerName} (${a.points}) aufgestellt`) } : null;
  const mm = acc.mm?.values ? acc.mm.values.filter(v => v.negativeSum < 0 && eligibleName(v.manager)).sort((a, b) => a.negativeSum - b.negativeSum).map(v => ({ manager: v.manager, minuspunkte: v.negativeSum, spieler: (v.negatives || []).map(n => `${n.playerName} ${n.points}`) })) : null;
  const bench = read(`bench-points_${day}.json`)?.managers?.filter(m => m.points && !EXCLUDED_IDS.has(String(m.id))).map(m => ({ manager: m.name, bankpunkte: m.points, bank: m.bench.map(b => `${b.name} ${b.points}`) })) || null;

  // Transfermarkt der laufenden Halbserie
  const tr = read('transfers.json')?.seasons?.find(s => s.current);
  const transfers = tr ? tr.managers.filter(m => !EXCLUDED_IDS.has(String(m.id))).map(m => ({
    manager: m.name, kaeufe: m.buys, verkaeufe: m.sells, gewinnVerlustVerkauftMio: round(m.realized / 1e6, 1), wertaenderungKaderMio: round(m.unrealized / 1e6, 1),
    deals_mitGewinn: m.wins, deals_mitVerlust: m.losses, besterDeal: m.best ? `${m.best.name} ${round(m.best.diff / 1e6, 1)} Mio` : null, schlechtesterDeal: m.worst ? `${m.worst.name} ${round(m.worst.diff / 1e6, 1)} Mio` : null,
  })).sort((a, b) => (b.gewinnVerlustVerkauftMio + b.wertaenderungKaderMio) - (a.gewinnVerlustVerkauftMio + a.wertaenderungKaderMio)) : null;

  const pts = sorted.map(x => x.p), allDays = days.flatMap(d => ids.map(i => ({ d, i, p: dayPts(i, d) })));
  const rec = allDays.filter(x => Number.isFinite(x.p)).sort((a, b) => b.p - a.p)[0];
  return {
    spieltag: day, liga: 'KBL Legenden', manageranzahl: ids.length,
    spieltag_kurz: {
      sieger: `${name(sorted[0].i)} ${sorted[0].p}`, letzter: `${name(sorted.at(-1).i)} ${sorted.at(-1).p}`,
      ligaSchnittDiesmal: leagueAvg(day), ligaSchnittJeSpieltag: ligaSchnitt,
      niedrigsterSchnittSeitSpieltag: (() => { for (let d = day - 1; d >= 1; d--) if (leagueAvg(d) <= leagueAvg(day)) return d; return null; })(),
      ueber900: pts.filter(p => p >= 900).length, ueber1000: pts.filter(p => p >= 1000).length,
      saisonRekordSpieltag: rec ? `${name(rec.i)} ${rec.p} an Spieltag ${rec.d}` : null,
      fuehrungswechsel: day > 1 && [...ranks[day]].find(([, r]) => r === 1)?.[0] !== [...ranks[day - 1]].find(([, r]) => r === 1)?.[0],
    },
    manager, mvpTipp, sonderregeln: { abgerechnet: !!S?.settled, angeschossenerHoeler: ah, magicMiyoshiMinuspunkte: mm, drehtuer: acc.dd || null },
    bumsungenSpieltag: bumsDay, ohneBumsungAmSpieltag: ohneBumsung, bumsTabelleHalbserie: bumsSaison, bankpunkte: bench, transfermarktHalbserie: transfers,
    regelnamen: RULE_NAMES,
  };
}

// ---- Claude ----
const SYSTEM = `Du bist der Stadionsprecher und Chef-Analyst der Kickbase-Liga „KBL Legenden“ (Fantasy-Fußball, Bundesliga, Freunde unter sich).
Du schreibst nach jedem abgerechneten Spieltag den Spieltagsbericht für die Liga-App. Ton: provokant, frech, voller Sticheleien und Trash-Talk, aber mit echter Analyse. Trash-Talk ist in der Liga ausdrücklich erwünscht.

Grenzen (Liga-Regel „Beckenbauer“): Nur über das Spiel sticheln (Aufstellungen, Punkte, Transfers, Tipps, Bumsungen). Nie über Aussehen, Herkunft, Familie, Beruf, Gesundheit oder echtes Privatleben. Keine Schimpfwörter unter der Gürtellinie.

Harte Regeln für Zahlen:
- Verwende ausschließlich Zahlen und Fakten aus dem JSON. Erfinde nichts, schätze nichts, rechne nichts Neues aus (keine eigenen Summen, Differenzen oder Prozentwerte). Alles, was du brauchst, steht fertig im JSON.
- Fehlt etwas, lass es weg. Wenn ein Feld „nicht sicher“ sagt, nicht verwenden.
- Spielerpunkte, Platzierungen und Namen exakt wie im JSON schreiben.
- Behaupte keine Platzierung, keinen Sieg und keine Serie, die nicht ausdrücklich als Feld im JSON steht (z. B. wer an welchem Spieltag Sieger war: nur aus spieltagPlatzJeSpieltag, Platz 1 = Sieger). Keine Folgerungen wie „hätte“, „wäre“, außer das Feld steht so im JSON.
- Leere Positionen: Steht bei leerePositionGrund „erzwungen durch Magic Miyoshi“, war es eine Strafe, kein Fehler des Managers. Dann stichelst du gegen den, der sie verhängt hat, oder über das Pech, nie über „vergessen“. Auflagen aus dem Vorspieltag (auflagenVomVorspieltag) erklären oft schwache Spieltage, nutze sie.
- Überschriften müssen zum Inhalt passen (z. B. nicht „Treffer“ schreiben, wenn es 0 Treffer gab).
- Schreibe NIE Feldnamen oder JSON-Schreibweise in den Text (nicht „schnittLetzte3“, „platzVerlauf“, „[1,1,3]“ usw.), sondern formuliere sie in normalem Deutsch („im Schnitt der letzten drei Spieltage“, „sechsmal in Folge Erster“).
- Der Bericht muss vollständig sein: Lieber kürzer als mitten im Satz aufhören.

Inhalt: Analysiere statt aufzuzählen. Suche die echten Geschichten in den Zahlen: Formkurven (schnittLetzte3 gegen schnittDie3Davor, platzVerlauf), Serien unter/über dem Ligaschnitt, Abhängigkeit von einem Spieler (topSpieler.anteilProzent, spieltagPlatzOhneIhn), selbst verschuldete Strafen (leerePositionen), knappe Abstände in der Tabelle, Führungswechsel, Konstanz (streuung), Transferbilanz, MVP-Tipp (knappsteFehlschuesse, Regelerfinder), Bumsungen des Spieltags (wer gab was an wen, Ketten über Teamlimit) und die BumsTabelle der Halbserie. Verknüpfe die Themen (z. B. wer den MVP abgeben musste und an wen er ging). Der Admin T800 wird auch nicht geschont.
Liga-Vokabular: Bumsung = von einer Sonderregel betroffen, BumsParade = Abrechnung, BumsTabelle = Zählung der Halbserie. Regelnamen stehen im JSON.

Form: Deutsch. Erste Zeile: „# “ plus eine knackige Schlagzeile (ohne Spieltagsnummer). Dann 6 bis 9 Abschnitte, jeder mit „## “ und einem Emoji. Fließtext mit **fett** für Namen und Schlüsselzahlen, Listen nur wenn sinnvoll. Etwa 600 bis 900 Wörter. Kein Fazit über dich selbst, keine Erklärung, dass du eine KI bist, keine Rückfragen.`;

async function askClaude(f) {
  const key = process.env.ANTHROPIC_API_KEY;
  const models = [MODEL, ...MODEL_FALLBACK.filter(m => m !== MODEL)];
  let last;
  for (const model of models) {
    const body = { model, max_tokens: 10000, system: SYSTEM, messages: [{ role: 'user', content: `Schreibe den Spieltagsbericht für Spieltag ${f.spieltag}. Hier alle geprüften Fakten als JSON:\n\n${JSON.stringify(f)}` }] };
    for (let attempt = 1; attempt <= 3; attempt++) {
      let r, d;
      try { r = await fetch('https://api.anthropic.com/v1/messages', { method: 'POST', headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(180000) }); d = await r.json().catch(() => ({})); }
      catch (e) { last = Error(`Verbindung: ${e.message}`); await new Promise(res => setTimeout(res, 10000 * attempt)); continue; }
      if (r.ok) {
        const text = (d.content || []).filter(c => c.type === 'text').map(c => c.text).join('').trim();
        const leak = /\b(schnitt(Letzte3|Die3Davor)|platzVerlauf|spieltagPlatz\w*|ueberLigaschnitt\w*|unterLigaschnitt\w*|spieltagPunkteOhneIhn|anteilProzent|topSpieler|flopSpieler)\b/.exec(text);
        if (d.stop_reason === 'max_tokens') { last = Error('Antwort abgeschnitten'); continue; }
        if (leak) { last = Error(`Feldname im Text: ${leak[0]}`); continue; }
        if (text.length >= 400) return { text, usage: d.usage || null, model: d.model || model };
        last = Error('Antwort zu kurz'); continue;
      }
      last = Error(`API ${r.status} (${model}): ${d?.error?.message || 'Fehler'}`);
      if (r.status === 429 || r.status >= 500) { await new Promise(res => setTimeout(res, 15000 * attempt)); continue; }
      if (r.status === 404 || (r.status === 400 && /model/i.test(d?.error?.message || ''))) break; // nächstes Modell
      throw last; // z. B. 401 Schlüssel falsch, 402/400 kein Guthaben: Modellwechsel hilft nicht
    }
  }
  throw last;
}

// ---- Ablauf ----
// Freigabe (Kevin-Wunsch 28.10.): Claude schreibt nur einen ENTWURF. Der liegt privat im Tippdienst (KV bericht:<day>, nur mit
// Admin-Code lesbar), Kevin liest, ändert und gibt ihn in der App frei. Veröffentlicht (kbl-berichte.json, site/data/berichte.json)
// wird nur, was im Tippdienst den Status „frei“ hat. Braucht Repository-Variable KBL_TIPP_DIENST und Geheimnis KBL_ADMIN_CODE.
const API = String(process.env.KBL_TIPP_DIENST || '').replace(/\/+$/, ''), CODE = process.env.KBL_ADMIN_CODE || '';
const post = async (p, body) => { const r = await fetch(API + p, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...body, adminCode: CODE }), signal: AbortSignal.timeout(20000) }); const d = await r.json().catch(() => ({})); if (!r.ok) throw Error(`Tippdienst ${r.status}: ${d.error || 'Fehler'}`); return d; };
const store = readStore(); store.berichte ||= {}; store.entwuerfe ||= {};
const arg = process.argv.indexOf('--fakten');
await loadHaken(Math.max(1, ...((read('matchday-status.json')?.days || []).filter(d => d.status === 'finished').map(d => d.day))));
if (arg > 0) { console.log(JSON.stringify(facts(Number(process.argv[arg + 1])), null, 1)); process.exit(0); }
let stand = '';
const say = m => { stand = m; console.log(m); };
try {
  // 1) Alte, nie freigegebene Berichte (vor der Freigabe-Regel) als Entwurf in den Tippdienst verschieben.
  for (const [d, b] of Object.entries(store.berichte)) {
    if (b.status === 'frei') continue;
    if (API && CODE && (b.vorgaben || 1) >= VORGABEN) { try { await post(`/bericht/${d}/entwurf`, b); store.entwuerfe[d] = { vorgaben: b.vorgaben, createdAt: b.createdAt }; } catch (e) { console.log('Entwurf verschieben:', e.message); } }
    delete store.berichte[d];
  }
  // 2) Freigegebene Berichte vom Tippdienst holen (öffentlich lesbar).
  let dienstOk = false;
  if (API) { try { const r = await fetch(`${API}/bericht`, { signal: AbortSignal.timeout(20000) }); if (r.ok) { dienstOk = true; const list = (await r.json()).berichte || []; store.berichte = Object.fromEntries(list.filter(b => b.status === 'frei').map(b => [b.day, b])); } } catch (e) { console.log('Freigegebene Berichte nicht abrufbar:', e.message); } }
  // 3) Neuen Entwurf schreiben lassen, wenn nötig.
  const status = read('matchday-status.json');
  const finished = (status?.days || []).filter(d => d.status === 'finished').map(d => d.day);
  const neu = Number(process.env.KBL_BERICHT_NEU) || null;
  // Nur der neueste abgeschlossene Spieltag (kein Nachholen alter Spieltage), außer ausdrücklich neu angefordert.
  const day = neu || Math.max(0, ...finished);
  const rk = day ? read(`ranking_${LEAGUE}_dayNumber_${day}.json`) : null, mt = day ? read(`mvp-tipps_${day}.json`) : null;
  const S = day ? settlement(day) : null;
  const ready = day && rk && rk.il === false && S?.settled && (!mt || mt.status === 'finished');
  const hasDraft = (store.entwuerfe[day]?.vorgaben || 0) >= VORGABEN;
  if (!day) say('Spieltagsbericht: noch kein Spieltag abgeschlossen.');
  else if (store.berichte[day] && neu !== day) say(`Spieltagsbericht ${day} ist freigegeben.`);
  else if (hasDraft && neu !== day) say(`Spieltagsbericht ${day}: Entwurf liegt vor und wartet auf Freigabe in der App.`);
  else if (!ready) say(`Spieltagsbericht ${day}: wartet, bis der Spieltag abgerechnet ist (Ranking ${rk?.il === false ? 'fertig' : 'noch live'}, BumsParade ${S?.settled ? 'abgerechnet' : 'offen'}, MVP-Tipp ${!mt || mt.status === 'finished' ? 'fertig' : 'offen'}).`);
  else if (API && CODE && dienstOk && fs.existsSync(path.join(process.cwd(), 'tools', 'bericht-vorlagen', `${day}.md`))) {
    // Von Kevin im Chat abgesegneter Text (Vorlage) wird als Entwurf übernommen, ohne Claude-Aufruf. Danach Datei löschen.
    const text = fs.readFileSync(path.join(process.cwd(), 'tools', 'bericht-vorlagen', `${day}.md`), 'utf8');
    const title = (/^#\s+(.+)$/m.exec(text)?.[1] || `Spieltag ${day}`).trim(), createdAt = new Date().toISOString();
    await post(`/bericht/${day}/entwurf`, { title, text, model: 'Vorlage (im Chat abgesegnet)', vorgaben: VORGABEN, createdAt });
    store.entwuerfe[day] = { vorgaben: VORGABEN, createdAt, vorlage: true };
    say(`Spieltagsbericht ${day}: Vorlage als Entwurf übernommen, wartet auf Freigabe.`);
  }
  else if (!process.env.ANTHROPIC_API_KEY) say(`Spieltagsbericht ${day}: kein ANTHROPIC_API_KEY hinterlegt, wird übersprungen.`);
  else if (API && CODE && !dienstOk) say(`Spieltagsbericht ${day}: Tippdienst kennt /bericht noch nicht (worker.js bei Cloudflare aktualisieren) oder ist nicht erreichbar. Kein Claude-Aufruf.`);
  else if (!API || !CODE) say(`Spieltagsbericht ${day}: ${!API ? 'Tippdienst (KBL_TIPP_DIENST)' : 'Geheimnis KBL_ADMIN_CODE'} fehlt, der Entwurf hätte keinen privaten Platz. Wird übersprungen.`);
  else {
    const f = facts(day);
    const { text, usage, model } = await askClaude(f);
    const title = (/^#\s+(.+)$/m.exec(text)?.[1] || `Spieltag ${day}`).trim();
    const createdAt = new Date().toISOString();
    const r = await post(`/bericht/${day}/entwurf`, { title, text, model, vorgaben: VORGABEN, createdAt });
    store.entwuerfe[day] = { vorgaben: VORGABEN, createdAt };
    say(r.skipped ? `Spieltagsbericht ${day}: schon freigegeben, neuer Entwurf verworfen.` : `Spieltagsbericht ${day}: Entwurf geschrieben, wartet auf Freigabe (${model}${usage ? `, ${usage.input_tokens} rein, ${usage.output_tokens} raus` : ''}).`);
  }
} catch (e) { say(`Spieltagsbericht fehlgeschlagen: ${e.message}`); }
// Letzter Stand in der Datei (wird mit committet), damit man ohne Zugriff auf die Actions-Protokolle sieht, was los ist.
store.stand = stand || store.stand;
const next = JSON.stringify(store, null, 1);
let prev = ''; try { prev = fs.readFileSync(STORE, 'utf8'); } catch {}
if (next !== prev) fs.writeFileSync(STORE, next);
publish(store);
