import express from 'express';
import crypto from 'crypto';
import os from 'os';
import fs from 'node:fs';
import path from 'node:path';
import { pngDecode, pngEncode } from './tools/png.mjs';
import { registerChallenges } from './challenges.js';
import { germanEventTitle } from './event-types-de.js';

const app = express();
const PORT = process.env.PORT || 3000;
const KICKBASE_API = 'https://api.kickbase.com';
const sessions = new Map();

app.use(express.json({ limit: '32kb' }));
// no-cache: Browser fragt bei jedem Laden nach (ETag), damit nach einem Update nie ein altes styles.css zu neuem app.js passt.
app.use(express.static('public', { setHeaders: res => res.set('Cache-Control', 'no-cache') }));

// Vorschaumodus (KBL_VORSCHAU=1, gestartet ueber vorschau.bat mit Tunnel): Gaeste duerfen nur ansehen.
// Speichern, Abhaken, Loeschen und die Werkzeuge (Scans) nur fuer den Admin (Manager-ID KBL_ADMIN_ID, Standard T800).
const PREVIEW = process.env.KBL_VORSCHAU === '1';
const ADMIN_ID = String(process.env.KBL_ADMIN_ID || '699062');
const ADMIN_ONLY_GET = /^\/api\/(competition-probe|player-probe|challenge-probe|playercenter-scan|event-finder|event-code-scan|event-types|auto-capture-status|arena-probe)\b/;
function currentSession(req) {
  const sid = parseCookies(req).kblsid;
  const s = sid ? sessions.get(sid) : null;
  return sessionValid(s) ? s : null;
}
const isAdmin = req => !PREVIEW || !!currentSession(req)?.admin;
const loginTries = new Map();
app.get('/api/vorschau', (req, res) => res.set('Cache-Control', 'no-store').json({ preview: PREVIEW, admin: isAdmin(req), loggedIn: !!currentSession(req) }));
app.use('/api', (req, res, next) => {
  if (!PREVIEW) return next();
  if (req.path === '/login') {
    // Hoechstens 10 Anmeldeversuche je Adresse in 15 Minuten.
    const ip = String(req.headers['cf-connecting-ip'] || req.socket.remoteAddress || '');
    const now = Date.now(), t = (loginTries.get(ip) || []).filter(x => now - x < 15 * 60 * 1000);
    if (t.length >= 10) return res.status(429).json({ error: 'Zu viele Anmeldeversuche. Bitte in 15 Minuten erneut versuchen.' });
    t.push(now); loginTries.set(ip, t);
    return next();
  }
  if (req.path === '/logout') return next();
  // MVP-Tipp: jeder angemeldete Manager darf seinen eigenen Tipp abgeben (Pruefung im Handler).
  if (req.method === 'PUT' && /^\/mvp-tipps\/\d{1,2}$/.test(req.path)) return next();
  if (req.method === 'POST' && /^\/mvp-tipps\/\d{1,2}\/mine$/.test(req.path)) return next();
  const write = req.method !== 'GET' && req.method !== 'HEAD';
  if ((write || ADMIN_ONLY_GET.test(req.originalUrl)) && !isAdmin(req)) {
    return res.status(403).json({ error: 'Vorschau: Hier kannst du nur ansehen. Ändern kann nur der Liga-Admin.' });
  }
  next();
});

function parseCookies(req) {
  const raw = req.headers.cookie || '';
  const decode = v => { try { return decodeURIComponent(v); } catch { return v; } };
  return Object.fromEntries(raw.split(';').filter(part => part.includes('=')).map(part => {
    const i = part.indexOf('=');
    return [decode(part.slice(0, i).trim()), decode(part.slice(i + 1).trim())];
  }));
}

// Sitzungen gelten so lange wie das Cookie (6 Stunden) und werden danach aus dem Speicher entfernt.
const SESSION_MAX_AGE_MS = 6 * 3600 * 1000;
const sessionValid = s => !!s && Date.now() - s.createdAt < SESSION_MAX_AGE_MS;
function getToken(req) {
  const sid = parseCookies(req).kblsid;
  const session = sid ? sessions.get(sid) : null;
  if (sessionValid(session)) return session.token;
  // Vorschau: Gaeste melden sich nicht an (Kevin-Vorgabe), sie sehen alles ueber den Dienst-Login.
  return PREVIEW ? (serviceToken && Date.now() - serviceTokenAt < 3 * 3600 * 1000 ? serviceToken : newestToken()) : null;
}
setInterval(() => { for (const [sid, s] of sessions) if (!sessionValid(s)) sessions.delete(sid); }, 30 * 60 * 1000).unref();

async function kbFetch(path, { method = 'GET', token, body } = {}) {
  // Immer Deutsch/Deutschland mitschicken. Ohne diese Angabe (und mit Logins von GitHub-Servern in den USA)
  // kann Kickbase das Konto auf Englisch bzw. eine andere Region umstellen (Push-Sprache, Ligen-Auswahl).
  const headers = { Accept: 'application/json', 'Accept-Language': 'de-DE,de;q=0.9' };
  if (body) headers['Content-Type'] = 'application/json';
  if (token) headers.Authorization = `Bearer ${token}`;

  const res = await fetch(`${KICKBASE_API}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(20000)
  });

  const text = await res.text();
  let data;
  try { data = text ? JSON.parse(text) : {}; } catch { data = { raw: text }; }

  if (!res.ok) {
    const err = new Error(`Kickbase antwortet mit HTTP ${res.status}`);
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data;
}

app.post('/api/login', async (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) return res.status(400).json({ error: 'E-Mail und Passwort fehlen.' });

  try {
    const login = await kbFetch('/v4/user/login', {
      method: 'POST',
      body: { em: email, loy: false, pass: password, rep: {} }
    });
    if (!login.tkn) return res.status(502).json({ error: 'Login erfolgreich, aber kein Token in der Antwort gefunden.' });

    const sid = crypto.randomUUID();
    const userId = String(login.u?.id ?? login.u?.i ?? '');
    const admin = userId === ADMIN_ID || (!!process.env.KBL_AUTO_EMAIL && String(email).trim().toLowerCase() === process.env.KBL_AUTO_EMAIL.trim().toLowerCase());
    // Vorschau: Anmelden darf nur der Liga-Admin, alle anderen sehen die App ohne Anmeldung.
    if (PREVIEW && !admin) return res.status(403).json({ error: 'In der Vorschau ist keine Anmeldung nötig. Anmelden kann sich nur der Liga-Admin.' });
    sessions.set(sid, { token: login.tkn, createdAt: Date.now(), admin, userId });
    if (PREVIEW) console.log('Vorschau: Anmeldung als Admin (darf ändern)');
    const secure = req.headers['x-forwarded-proto'] === 'https' ? '; Secure' : '';
    res.setHeader('Set-Cookie', `kblsid=${encodeURIComponent(sid)}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${SESSION_MAX_AGE_MS / 1000}${secure}`);
    res.json({ ok: true });
  } catch (err) {
    res.status(err.status === 401 ? 401 : 502).json({
      error: err.status === 401 ? 'Kickbase-Login fehlgeschlagen.' : 'Kickbase konnte nicht erreicht werden.',
      detail: err.data || err.message
    });
  }
});

app.post('/api/logout', (req, res) => {
  const sid = parseCookies(req).kblsid;
  if (sid) sessions.delete(sid);
  res.setHeader('Set-Cookie', 'kblsid=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0');
  res.json({ ok: true });
});

app.get('/api/leagues', async (req, res) => {
  const token = getToken(req);
  if (!token) return res.status(401).json({ error: 'Nicht angemeldet.' });
  try {
    const data = await kbFetch('/v4/leagues', { token });
    res.json(data);
  } catch (err) {
    res.status(err.status || 502).json({ error: 'Ligen konnten nicht geladen werden.', detail: err.data || err.message });
  }
});

app.get('/api/ranking/:leagueId', async (req, res) => {
  const token = getToken(req);
  if (!token) return res.status(401).json({ error: 'Nicht angemeldet.' });
  const leagueId = encodeURIComponent(req.params.leagueId);
  const day = req.query.dayNumber;
  const qs = day ? `?dayNumber=${encodeURIComponent(day)}` : '';
  try {
    const data = await kbFetch(`/v4/leagues/${leagueId}/ranking${qs}`, { token });
    res.json(data);
  } catch (err) {
    res.status(err.status || 502).json({ error: 'Ranking konnte nicht geladen werden.', detail: err.data || err.message });
  }
});


// KBL 4.5: Einzelspieler-Leistungsdaten testen (nur lesend).
// Test: /api/player-performance/11959?day=5
app.get('/api/player-performance/:playerId', async (req, res) => {
  const token = getToken(req);
  if (!token) return res.status(401).json({ error: 'Nicht angemeldet.' });
  const playerId = String(req.params.playerId);
  if (!/^\d{1,12}$/.test(playerId)) return res.status(400).json({ error: 'Ungültige Spieler-ID.' });
  const day = req.query.day === undefined ? null : Number(req.query.day);
  if (day !== null && (!Number.isInteger(day) || day < 1 || day > 34)) {
    return res.status(400).json({ error: 'Spieltag muss zwischen 1 und 34 liegen.' });
  }
  const path = `/v4/competitions/1/players/${playerId}/performance`;
  try {
    const data = await kbFetch(path, { token });
    // Rohdaten beibehalten, bis die tatsaechliche Struktur verifiziert ist.
    res.set('Cache-Control', 'no-store').json({ playerId, requestedDay: day, data });
  } catch (err) {
    res.status(err.status || 502).json({ error: 'Spieler-Leistungsdaten konnten nicht geladen werden.', detail: err.data || err.message });
  }
});



// KBL 4.5: Dokumentierter Manager-Kader-Endpunkt (nur lesend).
// Quelle: Kickbase-v4-Dokumentation, /leagues/{leagueId}/managers/{managerId}/squad.
app.get('/api/manager-squad-v4/:leagueId/:managerId', async (req, res) => {
  const token = getToken(req);
  if (!token) return res.status(401).json({ error: 'Nicht angemeldet.' });
  if (req.params.leagueId !== '6422780') return res.status(403).json({ error: 'Nur KBL Legenden erlaubt.' });
  const managerId = String(req.params.managerId);
  if (!/^\d{1,15}$/.test(managerId)) return res.status(400).json({ error: 'Ungültige Manager-ID.' });
  if (managerId === '3783040') return res.status(403).json({ error: 'T1000 ist ausgeschlossen.' });
  try {
    const data = await kbFetch(`/v4/leagues/6422780/managers/${managerId}/squad`, { token });
    res.set('Cache-Control', 'no-store').json({ managerId, data });
  } catch (err) {
    res.status(err.status || 502).json({ error: 'Manager-Kader konnte nicht geladen werden.', status: err.status || 502, detail: err.data || err.message });
  }
});

// Bundesliga-Spieltagstatus über OpenLigaDB (Saison 2026/27).
// Fehlende/unvollständige Daten werden niemals als abgeschlossen gewertet.
// Gemeinsame Funktion: wird von der Route und von der automatischen Startelf-Speicherung genutzt.
async function loadMatchdays() {
  const response = await fetch('https://api.openligadb.de/getmatchdata/bl1/2026', {
    headers: { Accept: 'application/json' },
    signal: AbortSignal.timeout(12000)
  });
  if (!response.ok) throw new Error(`OpenLigaDB HTTP ${response.status}`);
  const matches = await response.json();
  if (!Array.isArray(matches) || !matches.length) throw new Error('Keine Spielplandaten vorhanden');
  const groups = new Map();
  for (const match of matches) {
    const day = Number(match.group?.groupOrderID);
    if (!Number.isInteger(day) || day < 1 || day > 34) continue;
    if (!groups.has(day)) groups.set(day, []);
    groups.get(day).push(match);
  }
  const now = Date.now();
  const days = [...groups.entries()].sort((a,b)=>a[0]-b[0]).map(([day, games]) => {
    const dates = games.map(g => Date.parse(g.matchDateTimeUTC || g.matchDateTime)).filter(Number.isFinite);
    const started = dates.some(t => t <= now);
    const complete = games.length === 9 && games.every(g => g.matchIsFinished === true);
    const unfinished = games.filter(g => g.matchIsFinished !== true).map(g => ({
      match: `${g.team1?.teamName || 'Team 1'} – ${g.team2?.teamName || 'Team 2'}`,
      kickoffUTC: g.matchDateTimeUTC || null,
      markedFinished: g.matchIsFinished === true,
      resultAvailable: Array.isArray(g.matchResults) && g.matchResults.length > 0
    }));
    // Erstes Spiel des Spieltags (Anstoss) fuer den Countdown der Spieltagsvorschau.
    const first = games.map(g => ({ g, t: Date.parse(g.matchDateTimeUTC || g.matchDateTime) })).filter(x => Number.isFinite(x.t)).sort((a, b) => a.t - b.t)[0];
    return {
      day, status: complete ? 'finished' : started ? 'live' : 'upcoming',
      matches: games.length, finishedMatches: games.length - unfinished.length,
      ...(first ? { firstKickoffUTC: new Date(first.t).toISOString(), firstMatch: `${first.g.team1?.teamName || 'Team 1'} – ${first.g.team2?.teamName || 'Team 2'}` } : {}),
      ...(day <= 8 && !complete ? { unfinished } : {})
    };
  });
  let lastFinishedDay = 0;
  for (const d of days) { if (d.day !== lastFinishedDay + 1 || d.status !== 'finished') break; lastFinishedDay = d.day; }
  return { season: '2026/27', source: 'OpenLigaDB', days, lastFinishedDay };
}
// Zeitfenster eines Spieltags fuer den Transfer-Verlauf: letzter Anstoss des Spieltags bis erster Anstoss des naechsten.
let dayTimesCache=null;
async function dayWindow(day){
  if(!dayTimesCache||Date.now()-dayTimesCache.at>30*60e3){
    const r=await fetch('https://api.openligadb.de/getmatchdata/bl1/2026',{headers:{Accept:'application/json'},signal:AbortSignal.timeout(12000)});
    if(!r.ok)throw new Error(`OpenLigaDB HTTP ${r.status}`);
    const by=new Map();
    for(const g of (await r.json())){const d=Number(g.group?.groupOrderID),t=Date.parse(g.matchDateTimeUTC||g.matchDateTime);if(!Number.isInteger(d)||!Number.isFinite(t))continue;const e=by.get(d)||{first:Infinity,last:-Infinity};e.first=Math.min(e.first,t);e.last=Math.max(e.last,t);by.set(d,e);}
    dayTimesCache={at:Date.now(),by};
  }
  const cur=dayTimesCache.by.get(day),next=dayTimesCache.by.get(day+1);
  if(!cur)return null;
  return {first:cur.first,end:cur.last,next:next?next.first:cur.last+7*864e5};
}
app.get('/api/matchday-status', async (req, res) => {
  try {
    res.set('Cache-Control', 'no-store').json(await loadMatchdays());
  } catch (err) {
    res.status(503).json({ error: 'Spieltagsstatus derzeit nicht zuverlässig verfügbar.', detail: err.message });
  }
});


// KBL 4.7: Persistente Aufstellungs-Snapshots. Nur bestaetigte Aufstellungen
// duerfen spaeter fuer Sonderregeln als Startelf verwendet werden.
const SNAPSHOT_FILE = path.join(process.cwd(), 'kbl-lineup-snapshots.json');
function readSnapshots() {
  try { return JSON.parse(fs.readFileSync(SNAPSHOT_FILE, 'utf8')); }
  catch (err) { if (err.code === 'ENOENT') return {}; throw err; }
}
function saveSnapshots(data) {
  const temp = SNAPSHOT_FILE + '.tmp';
  fs.writeFileSync(temp, JSON.stringify(data, null, 2), { mode: 0o600 });
  fs.renameSync(temp, SNAPSHOT_FILE);
}
function validDay(v) { const n = Number(v); return Number.isInteger(n) && n >= 1 && n <= 34 ? n : null; }
function validManager(v) { return /^\d{1,15}$/.test(String(v)) && String(v) !== '3783040'; }
function parsePlayerIds(value) {
  if (!Array.isArray(value) || value.length < 1 || value.length > 11) return null;
  const ids = value.map(p => String(typeof p === 'object' && p ? (p.pi ?? p.i ?? p.id ?? '') : p));
  return ids.every(id => /^\d{1,12}$/.test(id)) && new Set(ids).size === ids.length ? ids : null;
}
function extractLineup(data) {
  for (const list of [data?.it, data?.lp, data?.players, data?.data?.it]) {
    const ids = parsePlayerIds(list);
    if (ids) return ids;
  }
  return null;
}
// --- Startelf aus Kickbase-Kaderdaten (Feld "lo" = Platz in der Aufstellung, 0 bis 10) ---
// Beobachtet an zwei Managern: Wer "lo" hat, steht in der Startelf; Bankspieler haben kein "lo".
// Die Aufstellung wird bei Kickbase zum Anpfiff des ersten Spiels eingefroren, daher
// wird sie nur waehrend eines laufenden Spieltags gespeichert (nie vorher, nie danach).
const FROZEN_SOURCE = 'kickbase-lo-frozen';
const CONFIRMED_SOURCES = new Set(['manual-confirmation', FROZEN_SOURCE]);
function extractFrozenLineup(squad) {
  const players = Array.isArray(squad?.it) ? squad.it : [];
  const withSlot = players.filter(p => p && p.lo !== undefined && p.lo !== null);
  if (!withSlot.length || withSlot.length > 11) return null;
  // Unerwartete Werte (nicht ganzzahlig, ausserhalb 0 bis 10, doppelt): nichts raten.
  const slots = withSlot.map(p => p.lo);
  if (!slots.every(s => Number.isInteger(s) && s >= 0 && s <= 10) || new Set(slots).size !== slots.length) return null;
  const sorted = [...withSlot].sort((a, b) => a.lo - b.lo);
  const playerIds = parsePlayerIds(sorted.map(p => String(p.pi ?? '')));
  if (!playerIds) return null;
  const playerNames = Object.fromEntries(sorted.map(p => [String(p.pi), String(p.pn || p.n || '')]));
  return { playerIds, playerNames, bench: players.length - withSlot.length };
}
let capturing = false;
async function captureFrozenLineups(token, day) {
  if (capturing) return { busy: true, saved: [], existing: [], failed: [] };
  capturing = true;
  try {
    const ranking = await kbFetch('/v4/leagues/6422780/ranking', { token });
    const managers = (ranking.us || []).filter(u => validManager(String(u.i)) && String(u.n || '').toLowerCase() !== 't1000');
    const snapshots = readSnapshots();
    const saved = [], existing = [], failed = [], added = {};
    // Nacheinander abfragen, um die Kickbase-API zu schonen.
    for (const m of managers) {
      const id = String(m.i), key = `${day}:${id}`, name = String(m.n || id);
      if (snapshots[key]) { existing.push({ managerId: id, name }); continue; }
      try {
        const squad = await kbFetch(`/v4/leagues/6422780/managers/${id}/squad`, { token });
        const lineup = extractFrozenLineup(squad);
        if (!lineup) { failed.push({ managerId: id, name, reason: 'Keine eindeutig lesbare Startelf in den Kaderdaten' }); continue; }
        // Ganzer Kader zum Spieltag (auch Bank): noetig fuer UM, damit der Besitzer des gefoulten Spielers
        // vom Spieltag zaehlt und nicht der von heute (Spieler koennen inzwischen weitergereicht sein).
        const squadIds = (Array.isArray(squad?.it) ? squad.it : []).map(p => String(p?.pi ?? '')).filter(x => /^\d{1,12}$/.test(x));
        added[key] = { day, managerId: id, playerIds: lineup.playerIds, playerNames: lineup.playerNames, squadIds,
          source: FROZEN_SOURCE, verified: false, capturedAt: new Date().toISOString(),
          note: 'Automatisch aus Kickbase-Kaderfeld lo gelesen, während der Spieltag lief (Aufstellung eingefroren).' };
        saved.push({ managerId: id, name, players: lineup.playerIds.length, bench: lineup.bench });
      } catch (err) {
        failed.push({ managerId: id, name, reason: `HTTP ${err.status || 502}` });
      }
    }
    if (saved.length) {
      // Die Abfrage dauert eine Weile: Datei frisch lesen und nur fehlende Eintraege ergaenzen, nie ueberschreiben.
      const latest = readSnapshots();
      for (const [key, record] of Object.entries(added)) if (!latest[key]) latest[key] = record;
      saveSnapshots(latest);
    }
    return { saved, existing, failed, expected: managers.length };
  } finally { capturing = false; }
}
// Alle Manager auf einmal: nur waehrend dieser Spieltag laeuft.
app.post('/api/lineup-snapshots/capture-frozen', async (req, res) => {
  const token = getToken(req);
  if (!token) return res.status(401).json({ error: 'Nicht angemeldet.' });
  const day = validDay(req.body?.day);
  if (!day) return res.status(400).json({ error: 'Ungültiger Spieltag.' });
  try {
    const info = (await loadMatchdays()).days.find(d => d.day === day);
    if (info?.status !== 'live') {
      return res.status(409).json({ error: info?.status === 'finished'
        ? `Spieltag ${day} ist bereits beendet. Die Aufstellung kann inzwischen für den nächsten Spieltag geändert sein; es wird nichts gespeichert.`
        : `Spieltag ${day} hat noch nicht begonnen. Die Aufstellung ist erst nach dem ersten Anpfiff eingefroren.` });
    }
    const result = await captureFrozenLineups(token, day);
    if (result.busy) return res.status(409).json({ error: 'Eine Speicherung läuft bereits. Bitte kurz warten.' });
    res.set('Cache-Control', 'no-store').json({ day, ...result });
  } catch (err) { res.status(err.status || 502).json({ error: 'Speichern der Startelfen fehlgeschlagen.', detail: err.message }); }
});
// Automatik: alle 2 Minuten pruefen, wenn genau EIN Spieltag laeuft. Tage, die komplett erfasst sind, werden nicht erneut abgefragt.
// Token: entweder ein angemeldeter Nutzer oder (empfohlen) ein Dienst-Login ueber die Umgebungsvariablen
// KBL_AUTO_EMAIL und KBL_AUTO_PASSWORD. Dann laeuft die Speicherung auch, wenn niemand eingeloggt ist.
// Das Passwort steht nur in der Umgebung des Servers, nie im Code und nie in einer Datei.
const autoDone = new Set();
const autoState = { lastRun: null, lastResult: null, lastError: null, tokenSource: null };
let serviceToken = null, serviceTokenAt = 0;
async function getServiceToken(force = false) {
  const email = process.env.KBL_AUTO_EMAIL, pass = process.env.KBL_AUTO_PASSWORD;
  if (!email || !pass) return null;
  if (!force && serviceToken && Date.now() - serviceTokenAt < 3 * 3600 * 1000) return serviceToken;
  const login = await kbFetch('/v4/user/login', { method: 'POST', body: { em: email, loy: false, pass, rep: {} } });
  if (!login.tkn) throw new Error('Dienst-Login ohne Token');
  serviceToken = login.tkn; serviceTokenAt = Date.now();
  return serviceToken;
}
// Optional eigenes Konto nur fuer die Challenges (KBL_CHALLENGE_EMAIL/KBL_CHALLENGE_PASSWORD), weil die Challenge-Wertung
// die selbst gespielten Challenges des Kontos braucht. Ohne diese Angaben wird der Dienst-Login genommen.
let challengeToken = null, challengeTokenAt = 0;
// Auf GitHub (Server in den USA) nie mit T800 anmelden: jede Anmeldung von dort stellt Kevins Kickbase-App auf den
// US-Markt um (Ligen fehlen, Push englisch), auch mit Accept-Language de. Challenges und Fotos kommen dort aus den Dateien vom PC.
const ON_GITHUB = !!process.env.GITHUB_ACTIONS;
async function getChallengeToken() {
  if (ON_GITHUB) return null;
  const email = process.env.KBL_CHALLENGE_EMAIL, pass = process.env.KBL_CHALLENGE_PASSWORD;
  if (!email || !pass) return getServiceToken();
  if (challengeToken && Date.now() - challengeTokenAt < 3 * 3600 * 1000) return challengeToken;
  const login = await kbFetch('/v4/user/login', { method: 'POST', body: { em: email, loy: false, pass, rep: {} } });
  if (!login.tkn) throw new Error('Challenge-Login ohne Token');
  challengeToken = login.tkn; challengeTokenAt = Date.now();
  return challengeToken;
}
// Vorschau: Dienst-Login frisch halten, damit Gaeste ohne Anmeldung alles sehen.
if (PREVIEW) { const keep = () => getServiceToken().catch(e => console.log('Vorschau: Dienst-Login fehlgeschlagen:', e.message)); keep(); setInterval(keep, 30 * 60 * 1000).unref(); }
function newestToken() {
  let best = null;
  for (const s of sessions.values()) if (sessionValid(s) && s.token && (!PREVIEW || s.admin) && (!best || s.createdAt > best.createdAt)) best = s;
  return best?.token || null;
}
async function autoCapture() {
  autoState.lastRun = new Date().toISOString();
  try {
    const live = (await loadMatchdays()).days.filter(d => d.status === 'live');
    if (live.length !== 1 || autoDone.has(live[0].day)) { autoState.lastResult = live.length === 1 ? `Spieltag ${live[0].day}: bereits vollständig erfasst` : 'kein Spieltag läuft'; return; }
    let token = null;
    try { token = await getServiceToken(); if (token) autoState.tokenSource = 'dienst-login'; } catch (e) { autoState.lastError = 'Dienst-Login fehlgeschlagen: ' + e.message; }
    if (!token) { token = newestToken(); if (token) autoState.tokenSource = 'angemeldeter nutzer'; }
    if (!token) { autoState.tokenSource = null; autoState.lastResult = 'Spieltag läuft, aber kein Zugang (weder Dienst-Login noch angemeldeter Nutzer)'; return; }
    let r;
    try { r = await captureFrozenLineups(token, live[0].day); }
    catch (e) { if (e.status === 401 && autoState.tokenSource === 'dienst-login') { token = await getServiceToken(true); r = await captureFrozenLineups(token, live[0].day); } else throw e; }
    if (r.busy) return;
    autoState.lastError = null;
    autoState.lastResult = `Spieltag ${live[0].day}: ${r.saved.length} neu gespeichert, ${r.existing.length} vorhanden, ${r.failed.length} fehlgeschlagen`;
    if (r.saved.length) console.log(`Startelfen Spieltag ${live[0].day}: ${r.saved.length} automatisch gespeichert, ${r.failed.length} fehlgeschlagen.`);
    if (r.expected && !r.failed.length) autoDone.add(live[0].day);
  } catch (err) { autoState.lastError = err.message; console.log('Automatische Startelf-Speicherung fehlgeschlagen:', err.message); }
}
setInterval(autoCapture, 2 * 60 * 1000).unref();
setTimeout(autoCapture, 20 * 1000).unref();
app.post('/api/auto-capture-test-login', async (req, res) => {
  if (!getToken(req)) return res.status(401).json({ error: 'Nicht angemeldet.' });
  if (!(process.env.KBL_AUTO_EMAIL && process.env.KBL_AUTO_PASSWORD)) return res.status(409).json({ error: 'Kein Dienst-Login eingerichtet (E-Mail und Passwort fehlen beim Start).' });
  try {
    await getServiceToken(true);
    autoState.lastError = null;
    res.json({ ok: true, message: 'Dienst-Login funktioniert.' });
  } catch (err) {
    res.status(502).json({ error: err.status === 401 ? 'Kickbase lehnt E-Mail oder Passwort ab. Bitte Angaben in start.bat prüfen (Sonderzeichen beachten).' : 'Kickbase konnte nicht erreicht werden.' });
  }
});
app.get('/api/auto-capture-status', (req, res) => {
  if (!getToken(req)) return res.status(401).json({ error: 'Nicht angemeldet.' });
  res.set('Cache-Control', 'no-store').json({ serviceLogin: !!(process.env.KBL_AUTO_EMAIL && process.env.KBL_AUTO_PASSWORD), ...autoState });
});
// Einmaliger Abruf des eigenen aktuellen Teams: keine historische Rekonstruktion.
app.post('/api/lineup-snapshots/own', async (req, res) => {
  const token = getToken(req);
  if (!token) return res.status(401).json({ error: 'Nicht angemeldet.' });
  const day = validDay(req.body?.day);
  const managerId = String(req.body?.managerId ?? '');
  if (!day || !validManager(managerId)) return res.status(400).json({ error: 'Gültiger Spieltag und eigene Manager-ID erforderlich.' });
  try {
    const ranking = await kbFetch('/v4/leagues/6422780/ranking', { token });
    if (!ranking.us?.some(u => String(u.i) === managerId)) return res.status(400).json({ error: 'Manager nicht in der Liga.' });
    const lineup = await kbFetch('/v4/leagues/6422780/lineup', { token });
    const playerIds = extractLineup(lineup);
    if (!playerIds) return res.status(422).json({ error: 'Kickbase-Aufstellung enthält keine eindeutig lesbaren elf Spieler.' });
    const snapshots = readSnapshots();
    const key = `${day}:${managerId}`;
    if (snapshots[key]) return res.status(409).json({ error: 'Snapshot existiert bereits; wird nicht überschrieben.', snapshot: snapshots[key] });
    const record = { day, managerId, playerIds, source: 'kickbase-own-lineup', verified: false,
      capturedAt: new Date().toISOString(), note: 'Nur für den eingeloggten Manager; Manager-ID muss vom Nutzer kontrolliert werden.' };
    snapshots[key] = record; saveSnapshots(snapshots);
    res.status(201).json(record);
  } catch (err) { res.status(err.status || 502).json({ error: 'Snapshot fehlgeschlagen.', detail: err.message }); }
});
// Von einem Manager bestaetigte elf Spieler; nicht als API-verifiziert ausgeben.
app.post('/api/lineup-snapshots/confirmed', async (req, res) => {
  if (!getToken(req)) return res.status(401).json({ error: 'Nicht angemeldet.' });
  const day = validDay(req.body?.day);
  const managerId = String(req.body?.managerId ?? '');
  const playerIds = parsePlayerIds(req.body?.playerIds);
  if (!day || !validManager(managerId) || !playerIds) return res.status(400).json({ error: 'Spieltag, Manager-ID und elf eindeutige Spieler-IDs erforderlich.' });
  try {
    const ranking = await kbFetch('/v4/leagues/6422780/ranking', { token: getToken(req) });
    if (!ranking.us?.some(u => String(u.i) === managerId)) return res.status(400).json({ error: 'Manager nicht in der Liga.' });
    const squad = await kbFetch(`/v4/leagues/6422780/managers/${managerId}/squad`, { token: getToken(req) });
    const squadIds = new Set((squad.it || []).map(p => String(p.pi ?? p.i)));
    const missing = playerIds.filter(id => !squadIds.has(id));
    if (missing.length) return res.status(422).json({ error: 'Spieler nicht im aktuell abrufbaren Kader.', missing });
    const snapshots = readSnapshots();
    const key = `${day}:${managerId}`;
    if (snapshots[key]) return res.status(409).json({ error: 'Snapshot existiert bereits; wird nicht überschrieben.' });
    const playerNames = Object.fromEntries((squad.it || []).filter(p=>playerIds.includes(String(p.pi??p.i))).map(p=>[String(p.pi??p.i),String(p.pn||p.n||'')]));
    const record = { day, managerId, playerIds, playerNames, source: 'manual-confirmation', verified: false,
      capturedAt: new Date().toISOString(), note: 'Kaderzugehörigkeit geprüft, tatsächliche Aufstellung nicht durch Kickbase bestätigt.' };
    snapshots[key] = record; saveSnapshots(snapshots);
    res.status(201).json(record);
  } catch (err) { res.status(err.status || 502).json({ error: 'Speichern fehlgeschlagen.', detail: err.message }); }
});
// Bewusste Korrektur einer Fehleingabe; nur mit expliziter Bestätigung.
app.delete('/api/lineup-snapshots/:day/:managerId', (req, res) => {
  if (!getToken(req)) return res.status(401).json({ error: 'Nicht angemeldet.' });
  const day = validDay(req.params.day);
  const managerId = String(req.params.managerId);
  if (!day || !validManager(managerId)) return res.status(400).json({ error: 'Ungültiger Spieltag oder Manager.' });
  if (req.body?.confirm !== 'DELETE_SNAPSHOT') return res.status(400).json({ error: 'Bestätigung fehlt.' });
  try {
    const snapshots = readSnapshots();
    const key = `${day}:${managerId}`;
    if (!snapshots[key]) return res.status(404).json({ error: 'Aufstellung nicht vorhanden.' });
    delete snapshots[key];
    saveSnapshots(snapshots);
    res.set('Cache-Control', 'no-store').json({ ok: true, day, managerId });
  } catch (err) { res.status(500).json({ error: 'Löschen fehlgeschlagen.', detail: err.message }); }
});

app.get('/api/lineup-snapshots/:day', (req, res) => {
  if (!getToken(req)) return res.status(401).json({ error: 'Nicht angemeldet.' });
  const day = validDay(req.params.day);
  if (!day) return res.status(400).json({ error: 'Ungültiger Spieltag.' });
  try {
    const snapshots = Object.values(readSnapshots()).filter(r => r.day === day);
    res.set('Cache-Control', 'no-store').json({ day, count: snapshots.length, snapshots,
      warning: 'Keine fremde Startelf wird automatisch behauptet. Nur dokumentierte Snapshots.' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Spieltagspunkte der gespeicherten Startelfen (Anzeige "auf dem Rasen" im Reiter Aufstellungen).
// Live hoechstens alle 5 Min., beendete Spieltage stuendlich neu (Kickbase korrigiert nachtraeglich).
const lineupPointsCache = new Map();
app.get('/api/lineup-points/:day', async (req, res) => {
  const token = getToken(req) || newestToken();
  if (!token) return res.status(401).json({ error: 'Nicht angemeldet.' });
  const day = validDay(req.params.day);
  if (!day) return res.status(400).json({ error: 'Ungültiger Spieltag.' });
  try {
    const st = (await loadMatchdays()).days.find(d => d.day === day)?.status;
    if (st !== 'live' && st !== 'finished') return res.json({ day, status: st || 'unknown', points: {} });
    const c = lineupPointsCache.get(day);
    if (c && c.status === st && Date.now() - c.at < (st === 'live' ? 5 : 60) * 60e3) return res.set('Cache-Control', 'no-store').json(c.value);
    const ids = [...new Set(Object.values(readSnapshots()).filter(r => r.day === day).flatMap(r => (r.playerIds || []).map(String)))];
    const points = {};
    for (let i = 0; i < ids.length; i += 5) await Promise.all(ids.slice(i, i + 5).map(async id => {
      try { const r = await dayPlayerPoints(token, id, day, st === 'finished'); points[id] = { points: r.points, state: r.state }; } catch { points[id] = { points: null, state: 'error' }; }
    }));
    const value = { day, status: st, updatedAt: new Date().toISOString(), points };
    lineupPointsCache.set(day, { at: Date.now(), status: st, value });
    res.set('Cache-Control', 'no-store').json(value);
  } catch (err) { res.status(502).json({ error: 'Punkte nicht abrufbar.', detail: err.message }); }
});

// KBL 4.9.5: Aufstellungs-Vollstaendigkeit ist auch vor Spieltagsende abrufbar.
app.get('/api/lineup-coverage/:day', async (req,res) => {
 const token=getToken(req),day=validDay(req.params.day);
 if(!token)return res.status(401).json({error:'Nicht angemeldet.'});
 if(!day)return res.status(400).json({error:'Ungültiger Spieltag.'});
 try {
  const ranking=await kbFetch('/v4/leagues/6422780/ranking',{token});
  const managers=(ranking.us||[]).filter(u=>validManager(String(u.i))&&String(u.n||'').toLowerCase()!=='t1000');
  const snapshots=readSnapshots();
  const entries=managers.map(m=>{
   const snapshot=snapshots[`${day}:${m.i}`];
   const ids=snapshot?parsePlayerIds(snapshot.playerIds):null;
   const status=!snapshot?'missing':!ids?'invalid':!CONFIRMED_SOURCES.has(snapshot.source)?'unconfirmed':'confirmed';
   return {managerId:String(m.i),name:String(m.n||m.i),status,count:ids?.length||0,capturedAt:snapshot?.capturedAt||null};
  });
  res.set('Cache-Control','no-store').json({day,expected:entries.length,confirmed:entries.filter(x=>x.status==='confirmed').length,entries});
 }catch(e){res.status(e.status||502).json({error:'Aufstellungsstatus nicht abrufbar.',detail:e.message});}
});

// KBL 4.9: Lesende, vorlaeufige Regelabrechnung. Keine Transfers.
// Voraussetzung: 1 bis 11 manuell bestaetigte Spieler pro Manager und beendeter Spieltag.
// Spieltagseintrag eines Spielers aus der Leistungsantwort (nur Saison 2026/27).
function findDayRecord(data, day) {
  const seasons = Array.isArray(data?.it) ? data.it : Array.isArray(data?.data?.it) ? data.data.it : [];
  const season = seasons.find(x => ['2026/2027','2026-2027','2026/27'].includes(String(x.ti)));
  return Array.isArray(season?.ph) ? season.ph.find(x => Number(x.day) === day) || null : null;
}
function pointFromPerformance(data, day, dayFinished = false) {
  // Nur explizite Spieltagspunkte aus der richtigen Saison akzeptieren.
  // Ein fehlender Eintrag ist KEINE Null und darf keine Regel ausloesen.
  const record = findDayRecord(data, day);
  if (!record) return null;
  if (record.p !== null && record.p !== undefined && record.p !== '' && Number.isFinite(Number(record.p))) return Number(record.p);
  // Spiel beendet (mdst 2), aber kein Punktefeld: Spieler wurde nicht eingesetzt = 0 Punkte.
  // Annahme aus den echten Daten (mdst 2 + mp "0'"); noch an einem Beispiel pruefen.
  // Beendetes Spiel ohne Punkte = nicht eingesetzt. "cur" markiert nur den aktuellen Spieltag; ist der ganze Spieltag laut Spielplan beendet, zaehlt das trotzdem.
  if (record.mdst === 2 && (record.cur !== true || dayFinished)) return 0;
  // Spiel noch nicht gespielt oder laeuft: bleibt offen.
  return null;
}
function isSchnapszahl(value) {
  return Number.isInteger(value) && Math.abs(value) >= 11 && /^([1-9])\1+$/.test(String(Math.abs(value)));
}
// Gemeinsame, reine Regelberechnung fuer echte Daten und Simulation.
// Ranglisten-Antworten tolerant lesen: Eintraege koennen ueber ID oder Namen erkennbar sein (das Frontend nutzt Namen).
function rankingLookup(d) {
  const arr = [d?.it, d?.us, d?.ranking, d?.users, d?.tom, d?.rnks, d].find(Array.isArray) || [];
  const byId = new Map(), byName = new Map();
  for (const x of arr) {
    const id = x?.i ?? x?.id ?? x?.u?.i;
    const name = x?.n ?? x?.unm ?? x?.userName ?? x?.name ?? x?.u?.n ?? x?.u?.name;
    const pts = [x?.p, x?.pts, x?.points, x?.v, x?.sp, x?.tp, x?.u?.p].find(v => v !== undefined && v !== null);
    if (pts === undefined) continue;
    if (id !== undefined && id !== null) byId.set(String(id), pts);
    if (name) byName.set(String(name).trim().toLowerCase(), pts);
  }
  const key = n => String(n ?? '').trim().toLowerCase();
  return {
    has: (id, name) => byId.has(String(id)) || byName.has(key(name)),
    get: (id, name) => byId.has(String(id)) ? byId.get(String(id)) : byName.get(key(name))
  };
}

// Angeschossener Hoeler: MVP des Spieltags = Bundesliga-Spieler mit den meisten Spieltagspunkten (Annahme, an Spieltag 6 gegenpruefen).
// Gleichstand an der Spitze: alle zaehlen. Fehlen Spieler (Abruf fehlgeschlagen), gilt das Ergebnis als unsicher.
const mvpCache = new Map();
async function loadMatchdayMvp(token, day, { live = false } = {}) {
  // live: Zwischenstand waehrend des Spieltags, nie aus dem Zwischenspeicher und nie hinein.
  const cached = live ? null : mvpCache.get(day);
  if (cached && Date.now() - cached.at < 60 * 60 * 1000) return cached.value;
  const all = await loadAllPlayers(token);
  const ids = [...all.players.keys()];
  const scored = []; let failed = 0;
  for (let i = 0; i < ids.length; i += 5) {
    await Promise.all(ids.slice(i, i + 5).map(async id => {
      try {
        let pt;
        if (live) pt = (await dayPlayerPoints(token, id, day)).points;
        else {
          const data = await kbFetch(`/v4/competitions/1/players/${id}/performance`, { token });
          const rec = findDayRecord(data, day);
          pt = rec && rec.p !== undefined && rec.p !== null && rec.p !== '' && Number.isFinite(Number(rec.p)) ? Number(rec.p) : null;
        }
        if (pt !== null) scored.push({ id, name: all.players.get(id).name, team: all.players.get(id).team, points: pt });
      } catch { failed++; }
    }));
  }
  scored.sort((a, b) => b.points - a.points);
  const top = scored.length ? scored[0].points : null;
  const value = {
    day, playersChecked: ids.length, failedPlayers: failed, failedTeams: all.failedTeams,
    reliable: failed === 0 && all.failedTeams.length === 0 && scored.length > 0,
    players: top === null ? [] : scored.filter(x => x.points === top),
    top: scored.slice(0, 5),
    all: scored
  };
  if (value.reliable && !live) mvpCache.set(day, { at: Date.now(), value });
  return value;
}
// Draemonische Drehtuer: die drei besten Spieler der Startelf nach Spieltagspunkten.
// Gleichstand auf Platz 3: alle mit gleicher Punktzahl zaehlen. Spieler, die von einer anderen Regel
// betroffen sind (excludedMap: playerId -> Regelkuerzel), fallen heraus und die naechstbesten ruecken nach.
function ddCandidates(players, excludedMap) {
  const sorted=[...players].sort((a,b)=>b.points-a.points);
  const eligible=sorted.filter(p=>!excludedMap.has(String(p.playerId)));
  if(!eligible.length) return {candidates:[],excluded:[],cutoff:null};
  const cutoff=eligible.length>=3?eligible[2].points:eligible[eligible.length-1].points;
  return {cutoff,
    candidates:eligible.filter(p=>p.points>=cutoff),
    excluded:sorted.filter(p=>excludedMap.has(String(p.playerId))&&p.points>=cutoff).map(p=>({...p,reason:excludedMap.get(String(p.playerId)).join(', ')}))};
}
function calculateBdDd(roster) {
  // BD erst nach Spielende (Kevin-Vorgabe): waehrend des Spiels aendern sich die Punkte staendig.
  const bd=roster.flatMap(m=>m.players.filter(p=>p.state==='done'&&isSchnapszahl(p.points)).map(p=>({managerId:m.managerId,manager:m.name,...p})));
  const top=Math.max(...roster.map(m=>m.dayPoints)), low=Math.min(...roster.map(m=>m.dayPoints));
  const winners=roster.filter(m=>m.dayPoints===top), last=roster.filter(m=>m.dayPoints===low);
  const excluded=new Map(bd.map(p=>[String(p.playerId),['BD']]));
  const dd=winners.map(m=>({managerId:m.managerId,manager:m.name,dayPoints:m.dayPoints,
    candidates:ddCandidates(m.players,excluded).candidates}));
  return {bd,dd:{winners:dd,lastPlace:last.map(m=>({managerId:m.managerId,manager:m.name,dayPoints:m.dayPoints})),tie:winners.length!==1||last.length!==1}};
}
// Reine Berechnung: Magic Miyoshi zaehlt die Summe ausschliesslich negativer Einzelpunkte.
function calculateMm(roster) {
  const values=roster.map(m=>({managerId:m.managerId,manager:m.name,negativeSum:m.players.reduce((sum,p)=>sum+Math.min(0,p.points),0),
    negatives:m.players.filter(p=>p.points<0).sort((a,b)=>a.points-b.points).map(p=>({playerId:p.playerId,points:p.points}))}));
  const worst=Math.min(...values.map(x=>x.negativeSum));
  return {values,affected:worst<0?values.filter(x=>x.negativeSum===worst):[],tie:values.filter(x=>x.negativeSum===worst).length>1};
}
// AH benoetigt den tatsaechlichen offiziellen Spieltags-MVP; ohne Quelle keine echte Strafe.
function calculateAh(roster,mvpPlayerId) {
  if (!mvpPlayerId) return {status:'unverified',message:'Offizieller Spieltags-MVP nicht verifiziert.',affected:[]};
  return {status:'provisional',affected:roster.flatMap(m=>m.players.filter(p=>String(p.playerId)===String(mvpPlayerId)).map(p=>({managerId:m.managerId,manager:m.name,...p})))};
}
// Ereigniscodes entdecken: sammelt die Codes aus "k" (Spieltagseintraege) aller Spieler in den Ligakaedern.
// Bedeutungen (alle an echten Faellen von der Liga bestaetigt): 1 Tor, 2 Eigentor, 3 Vorlage, 4 Gelbe Karte,
// 5 Gelb-Rote Karte, 6 Rote Karte, 7 Elfmeter gehalten, 8 Einwechslung, 9 Auswechslung, 25 Weisse Weste.
// Alle anderen Codes bleiben "unbekannt", bis ein echter Fall sie belegt.
const EVENT_CODE_LABELS = {
  1: 'Tor', 2: 'Eigentor', 3: 'Vorlage', 4: 'Gelbe Karte', 5: 'Gelb-Rote Karte', 6: 'Rote Karte',
  7: 'Elfmeter gehalten', 8: 'Einwechslung', 9: 'Auswechslung', 25: 'Weiße Weste'
};
const CURRENT_SEASON = ['2026/2027', '2026-2027', '2026/27'];
const PREVIOUS_SEASON = ['2025/2026', '2025-2026', '2025/26'];
function seasonEntries(data, labels) {
  const seasons = Array.isArray(data?.it) ? data.it : Array.isArray(data?.data?.it) ? data.data.it : [];
  const season = seasons.find(x => labels.includes(String(x.ti)));
  return Array.isArray(season?.ph) ? season.ph : [];
}

// Alle Bundesliga-Spieler (nicht nur Kader der Liga): Tabelle -> Vereine -> Spieler je Verein.
// Die genaue Antwortform ist nicht verifiziert, deshalb wird tolerant gesucht und gemeldet, welche Felder genutzt wurden.
function findObjectArrays(node, out = []) {
  if (Array.isArray(node)) {
    if (node.length && node.every(x => x && typeof x === 'object' && !Array.isArray(x))) out.push(node);
    node.forEach(x => findObjectArrays(x, out));
  } else if (node && typeof node === 'object') Object.values(node).forEach(x => findObjectArrays(x, out));
  return out;
}
function extractEntities(json, idKeys, nameKeys) {
  let best = null;
  for (const arr of findObjectArrays(json)) {
    for (const key of idKeys) {
      const ids = arr.map(o => o[key]).filter(v => v !== undefined && /^\d{1,12}$/.test(String(v)));
      if (ids.length < Math.max(2, Math.floor(arr.length * 0.8))) continue;
      if (new Set(ids.map(String)).size !== ids.length) continue; // IDs muessen eindeutig sein
      if (!best || ids.length > best.items.length) {
        const nameKey = nameKeys.find(k => arr.some(o => typeof o[k] === 'string'));
        best = { idKey: key, nameKey: nameKey || null,
          items: arr.filter(o => o[key] !== undefined).map(o => ({ id: String(o[key]), name: nameKey ? String(o[nameKey] ?? '') : '' })) };
      }
    }
  }
  return best;
}
// Einzelnes Feld (z. B. pos: 1 Torwart, 2 Abwehr, 3 Mittelfeld, 4 Sturm) je ID aus beliebig verschachtelten Kickbase-Antworten.
function valuesById(root, idKey, field) {
  const out = new Map(), seen = new Set();
  const walk = o => {
    if (!o || typeof o !== 'object' || seen.has(o)) return; seen.add(o);
    if (Array.isArray(o)) { o.forEach(walk); return; }
    if (o[idKey] !== undefined && o[field] !== undefined && !out.has(String(o[idKey]))) out.set(String(o[idKey]), o[field]);
    Object.values(o).forEach(walk);
  };
  walk(root);
  return out;
}
// Bildpfade (z. B. pim, tim: "content/file/....png") je ID aus beliebig verschachtelten Kickbase-Antworten.
function imagesById(root, idKey) {
  const out = new Map(), seen = new Set();
  const walk = o => {
    if (!o || typeof o !== 'object' || seen.has(o)) return; seen.add(o);
    if (Array.isArray(o)) { o.forEach(walk); return; }
    if (o[idKey] !== undefined && !out.has(String(o[idKey]))) {
      const k = Object.keys(o).find(k => typeof o[k] === 'string' && /\.(png|jpe?g|webp|svg)$/i.test(o[k]));
      if (k) out.set(String(o[idKey]), o[k]);
    }
    Object.values(o).forEach(walk);
  };
  walk(root);
  return out;
}
let allPlayersCache = null;
async function loadAllPlayers(token) {
  if (allPlayersCache && Date.now() - allPlayersCache.at < 10 * 60 * 1000) return allPlayersCache.value;
  const value = await loadAllPlayersUncached(token);
  if (!value.failedTeams.length) allPlayersCache = { at: Date.now(), value };
  return value;
}
async function loadAllPlayersUncached(token) {
  const table = await kbFetch('/v4/competitions/1/table', { token });
  const teams = extractEntities(table, ['ti', 'tid', 'i', 'id'], ['tn', 'n', 'name']);
  if (!teams || teams.items.length < 10) throw new Error('Vereinsliste in der Tabelle nicht erkannt. Bitte /api/competition-probe prüfen.');
  const players = new Map();
  const failedTeams = [];
  const teamImgs = imagesById(table, teams.idKey);
  for (const t of teams.items) {
    try {
      const prof = await kbFetch(`/v4/competitions/1/teams/${t.id}/teamprofile`, { token });
      const pl = extractEntities(prof, ['pi', 'i', 'id'], ['pn', 'n', 'ln', 'name']);
      if (!pl || !pl.items.length) { failedTeams.push(t.name || t.id); continue; }
      const imgs = imagesById(prof, pl.idKey), pos = valuesById(prof, pl.idKey, 'pos');
      for (const p of pl.items) if (!players.has(p.id)) players.set(p.id, { name: p.name || p.id, team: t.name || t.id, teamId: t.id, img: imgs.get(p.id) || null, teamImg: teamImgs.get(t.id) || null, pos: Number(pos.get(p.id)) || null });
    } catch { failedTeams.push(t.name || t.id); }
  }
  return { players, teamCount: teams.items.length, failedTeams, teamKey: teams.idKey };
}

// Testabfrage: zeigt die Rohform von Tabelle und einem Vereinsprofil, damit die Erkennung geprueft werden kann (nur lesend).
app.get('/api/competition-probe', async (req, res) => {
  const token = getToken(req);
  if (!token) return res.status(401).json({ error: 'Nicht angemeldet.' });
  try {
    const table = await kbFetch('/v4/competitions/1/table', { token });
    const teams = extractEntities(table, ['ti', 'tid', 'i', 'id'], ['tn', 'n', 'name']);
    let profile = null, players = null;
    if (teams?.items[0]) {
      profile = await kbFetch(`/v4/competitions/1/teams/${teams.items[0].id}/teamprofile`, { token });
      players = extractEntities(profile, ['pi', 'i', 'id'], ['pn', 'n', 'ln', 'name']);
    }
    const cut = x => JSON.stringify(x)?.slice(0, 3000);
    res.set('Cache-Control', 'no-store').json({
      teamsFound: teams ? { idKey: teams.idKey, nameKey: teams.nameKey, count: teams.items.length, first: teams.items.slice(0, 3) } : null,
      playersFound: players ? { idKey: players.idKey, nameKey: players.nameKey, count: players.items.length, first: players.items.slice(0, 3) } : null,
      tableRawStart: cut(table), profileRawStart: cut(profile)
    });
  } catch (err) { res.status(err.status || 502).json({ error: 'Probeabfrage fehlgeschlagen.', detail: err.message }); }
});


// Testabfrage (nur lesend): Gibt es bei Kickbase Aufstellungen vergangener Spieltage und einen Transfer-Verlauf?
// Beispiel: /api/history-probe?day=3&user=1403991 . Ergebnis auch in _probe/history-probe.json.
app.get('/api/history-probe', async (req, res) => {
  const token = getToken(req);
  if (!token) return res.status(401).json({ error: 'Nicht angemeldet.' });
  const day = validDay(req.query.day) || 3, user = /^\d{1,12}$/.test(String(req.query.user || '')) ? String(req.query.user) : '1403991';
  const L = '/v4/leagues/6422780';
  const cands = [`${L}/teamcenter/${user}?dayNumber=${day}`, `${L}/users/${user}/teamcenter?dayNumber=${day}`, `${L}/managers/${user}/teamcenter?dayNumber=${day}`,
    `${L}/managers/${user}/lineup?dayNumber=${day}`, `${L}/lineup?dayNumber=${day}`, `${L}/managers/${user}/performance`, `${L}/managers/${user}/dashboard`,
    `${L}/managers/${user}/transfer`, `${L}/activitiesFeed?max=25`, `${L}/activitiesFeed?start=0&max=25`, `${L}/transfers?max=25`, `${L}/ranking?dayNumber=${day}`];
  const out = { day, user };
  // Mit ?compare=1: Startelf laut ranking?dayNumber (Feld lp) gegen die gespeicherten Aufstellungen.
  if (req.query.compare === '1') {
    const snaps = readSnapshots(), cmp = {};
    for (const d of [5, 6]) {
      try {
        const r = await kbFetch(`${L}/ranking?dayNumber=${d}`, { token });
        for (const u of (r.us || [])) {
          const sn = snaps[`${d}:${u.i}`]; if (!sn) continue;
          const a = (u.lp || []).filter(x => x != null).map(String).sort(), b = (sn.playerIds || []).map(String).sort();
          cmp[`${d}:${u.n}`] = { gleich: JSON.stringify(a) === JSON.stringify(b), lp: a, gespeichert: b, quelle: sn.source };
        }
      } catch (e) { cmp[`fehler ${d}`] = e.message; }
    }
    out.compare = cmp;
    try { fs.mkdirSync(path.join(process.cwd(), '_probe'), { recursive: true }); fs.writeFileSync(path.join(process.cwd(), '_probe', 'lineup-compare.json'), JSON.stringify(out, null, 2)); } catch {}
    return res.set('Cache-Control', 'no-store').json(out);
  }
  for (const p of cands) {
    try { out[p] = JSON.stringify(await kbFetch(p, { token })).slice(0, 6000); }
    catch (e) { out[p] = { error: e.message, status: e.status || null }; }
  }
  try { fs.mkdirSync(path.join(process.cwd(), '_probe'), { recursive: true }); fs.writeFileSync(path.join(process.cwd(), '_probe', 'history-probe.json'), JSON.stringify(out, null, 2)); } catch {}
  res.set('Cache-Control', 'no-store').json(out);
});

// Arena-Untersuchung (einmalig, nur Admin): findet die zweite Liga (Arena, Head-to-Head) im Konto des angemeldeten Nutzers
// und probiert moegliche Kickbase-Pfade fuer Duelle/Paarungen. Ergebnis zusaetzlich in _probe/arena-probe.json.
app.get('/api/arena-probe', async (req, res) => {
  const token = getToken(req);
  if (!token) return res.status(401).json({ error: 'Bitte zuerst in der App anmelden.' });
  const out = { at: new Date().toISOString() };
  const get = async p => { try { return { ok: true, data: await kbFetch(p, { token }) }; } catch (e) { return { ok: false, status: e.status || null, error: String(e.data ? JSON.stringify(e.data) : e.message).slice(0, 300) }; } };
  const short = r => r.ok ? JSON.stringify(r.data).slice(0, 8000) : r;
  const sel = await get('/v4/leagues/selection'); out.selection = short(sel);
  const all = await get('/v4/leagues'); out.leagues = short(all);
  // Nur echte Ligen (Liste it[] mit Namen), die mit "Arena" im Namen zuerst.
  const found = [];
  for (const r of [sel, all]) if (r.ok) for (const x of (r.data.it || r.data.lis || [])) { const i = String(x.i ?? x.id ?? ''); if (/^\d+$/.test(i) && !found.some(f => f.id === i)) found.push({ id: i, name: String(x.n ?? x.name ?? '') }); }
  out.found = found;
  const ids = new Set(found.filter(f => /arena/i.test(f.name)).map(f => f.id));
  if (!ids.size) for (const f of found) ids.add(f.id);
  ids.delete('6422780');
  if (req.query.id && /^\d{1,12}$/.test(String(req.query.id))) { ids.clear(); ids.add(String(req.query.id)); }
  let day = null; try { const md = await loadMatchdays(); day = (md.days.find(d => d.status === 'live') || [...md.days].reverse().find(d => d.status === 'finished'))?.day || null; } catch {}
  out.day = day; out.arena = {};
  for (const id of [...ids].slice(0, 3)) {
    const L = `/v4/leagues/${id}`, r = {};
    const paths = ['overview', 'me', 'settings', 'settings/managers', 'ranking', `ranking?dayNumber=${day}`, `ranking?dayNumber=${day - 1}`, 'lineup', 'teamcenter/myeleven', 'activitiesFeed?max=10',
      'h2h', 'h2h/matchups', `h2h/matchups?dayNumber=${day}`, 'h2h/ranking', 'h2h/schedule', 'matchups', `matchups?dayNumber=${day}`, `matchups/${day}`, 'duels', 'battles', 'fixtures', 'schedule', 'headtohead', 'head2head', 'arena', 'arena/lineup', 'arena/ranking', 'table', 'standings',
      `ranking?dayNumber=${day + 1}`, 'ranking/h2h', `h2h/${day}`, `h2h?dayNumber=${day}`, 'h2h/matchday', `matchday/${day}`, `matchdays/${day}`, 'matchup', `matchup?dayNumber=${day}`, 'versus', 'opponents', 'pairings', 'headToHead', `headToHead?dayNumber=${day}`, 'h2hmatchups', `h2hmatchups?dayNumber=${day}`, 'duel', `duel?dayNumber=${day}`];
    for (const p of paths) r[p] = short(await get(`${L}/${p}`));
    const uid = currentSession(req)?.userId;
    if (uid) for (const p of [`managers/${uid}/dashboard`, `managers/${uid}/squad`, `users/${uid}/teamcenter?dayNumber=${day}`, `teamcenter/${uid}?dayNumber=${day}`, `managers/${uid}/lineup?dayNumber=${day}`]) r[p] = short(await get(`${L}/${p}`));
    // Aufstellung jedes Managers (Arena: jeden Spieltag neu, Kapitaen ictp) und Head-to-Head-Daten je Manager.
    try {
      const ov = await get(`${L}/overview`), mids = ov.ok ? (ov.data.mid || []).map(String) : [];
      for (const m of mids.slice(0, 20)) for (const p of [`users/${m}/teamcenter?dayNumber=${day}`, `users/${m}/teamcenter?dayNumber=${day - 1}`, `managers/${m}/dashboard`, `managers/${m}/h2h`, `users/${m}/h2h`, `managers/${m}/performance`]) r[p] = short(await get(`${L}/${p}`));
    } catch {}
    out.arena[id] = r;
  }
  try { fs.mkdirSync(path.join(process.cwd(), '_probe'), { recursive: true }); fs.writeFileSync(path.join(process.cwd(), '_probe', 'arena-probe.json'), JSON.stringify(out, null, 2)); } catch {}
  res.set('Cache-Control', 'no-store').json({ ok: true, gespeichert: '_probe/arena-probe.json', ligen: [...ids], tag: day });
});

// Live-Zwischenstand aller Manager waehrend des Spieltags. Das Liga-Ranking zeigt bis Spieltagsende 0 Punkte (mdp),
// darum: Startelf aus ranking?dayNumber (lp, null = leerer Platz) und je Spieler die Punkte aus dayPlayerPoints.
// Leere Plaetze kosten 100 Punkte. Hoechstens alle 5 Minuten neu (ca. 170 bis 340 Kickbase-Abrufe).
const livePointsCache=new Map();
app.get('/api/live-points/:day', async (req, res) => {
  const token = getToken(req) || newestToken();
  if (!token) return res.status(401).json({ error: 'Nicht angemeldet.' });
  const day = validDay(req.params.day);
  if (!day) return res.status(400).json({ error: 'Ungültiger Spieltag.' });
  try {
    const md = await loadMatchdays(), st = md.days.find(d => d.day === day)?.status;
    if (st !== 'live' && st !== 'finished') return res.json({ day, status: st || 'unknown', managers: [], message: 'Spieltag hat noch nicht begonnen.' });
    const c = livePointsCache.get(day);
    if (c && Date.now() - c.at < 5 * 60e3) return res.set('Cache-Control', 'no-store').json(c.value);
    const ranking = await kbFetch(`/v4/leagues/6422780/ranking?dayNumber=${day}`, { token });
    const users = (ranking.us || []).filter(u => validManager(u.i) && String(u.n || '').toLowerCase() !== 't1000');
    const ids = [...new Set(users.flatMap(u => (u.lp || []).filter(x => x != null).map(String)))];
    const pts = {}, all = await loadAllPlayers(token).catch(() => null);
    for (let i = 0; i < ids.length; i += 5) await Promise.all(ids.slice(i, i + 5).map(async id => {
      try { pts[id] = await dayPlayerPoints(token, id, day, st === 'finished'); } catch { pts[id] = { points: null, state: 'error' }; }
    }));
    const managers = users.map(u => {
      const lp = Array.isArray(u.lp) ? u.lp : [], empty = lp.length ? 11 - lp.filter(x => x != null).length : null;
      const players = lp.filter(x => x != null).map(String).map(id => ({ id, name: all?.players.get(id)?.name || null, team: all?.players.get(id)?.team || null, ...pts[id] }))
        .sort((a, b) => (b.points ?? -1e9) - (a.points ?? -1e9));
      const points = empty === null ? null : players.reduce((s, p) => s + (p.points || 0), 0) - 100 * empty;
      return { id: String(u.i), name: u.n, points, empty, open: players.filter(p => p.state === 'open').length, errors: players.filter(p => p.state === 'error').length, players };
    }).sort((a, b) => (b.points ?? -1e9) - (a.points ?? -1e9));
    const value = { day, status: st, updatedAt: new Date().toISOString(), rankingLive: !!ranking.il, managers };
    livePointsCache.set(day, { at: Date.now(), value });
    res.set('Cache-Control', 'no-store').json(value);
  } catch (err) { res.status(err.status || 502).json({ error: 'Live-Punkte konnten nicht geladen werden.', detail: err.message }); }
});

// Vollpfosten des Spieltags (Kevin-Vorgabe): wer die meisten Punkte auf der Bank gelassen hat.
// Bank = beim Einfrieren gespeicherter Gesamtkader (squadIds) ohne die Startelf (playerIds). Summe der Spieltagspunkte der Bankspieler
// (auch negative). Ohne gespeicherten Kader wird nichts berechnet (nie raten). Waehrend des Spieltags vorlaeufig (Live-Punkte).
const benchCache=new Map();
app.get('/api/bench-points/:day', async (req, res) => {
  const token = getToken(req) || newestToken();
  if (!token) return res.status(401).json({ error: 'Nicht angemeldet.' });
  const day = validDay(req.params.day);
  if (!day) return res.status(400).json({ error: 'Ungültiger Spieltag.' });
  try {
    const md = await loadMatchdays(), st = md.days.find(d => d.day === day)?.status;
    if (st !== 'live' && st !== 'finished') return res.json({ day, status: st || 'unknown', managers: [], message: 'Spieltag hat noch nicht begonnen.' });
    const c = benchCache.get(day);
    if (c && c.status === st && Date.now() - c.at < (st === 'live' ? 5 : 60) * 60e3) return res.set('Cache-Control', 'no-store').json(c.value);
    const ranking = await kbFetch(`/v4/leagues/6422780/ranking?dayNumber=${day}`, { token });
    const users = (ranking.us || []).filter(u => validManager(u.i) && String(u.n || '').toLowerCase() !== 't1000');
    const snaps = readSnapshots(), missing = users.filter(u => !Array.isArray(snaps[`${day}:${u.i}`]?.squadIds)).map(u => u.n);
    if (missing.length) {
      const value = { day, status: st, managers: [], message: `Das fehlt: Für Spieltag ${day} ist der Kader beim Anpfiff nicht gespeichert (${missing.length === users.length ? 'alle Manager' : missing.join(', ')}). Darum keine Bankpunkte.` };
      return res.set('Cache-Control', 'no-store').json(value);
    }
    const all = await loadAllPlayers(token).catch(() => null), pts = {};
    const benchOf = u => { const s = snaps[`${day}:${u.i}`], xi = new Set((s.playerIds || []).map(String)); return s.squadIds.map(String).filter(id => !xi.has(id)); };
    const ids = [...new Set(users.flatMap(benchOf))];
    for (let i = 0; i < ids.length; i += 5) await Promise.all(ids.slice(i, i + 5).map(async id => {
      try { pts[id] = await dayPlayerPoints(token, id, day, st === 'finished'); } catch { pts[id] = { points: null, state: 'error' }; }
    }));
    const managers = users.map(u => {
      const bench = benchOf(u).map(id => ({ id, name: all?.players.get(id)?.name || snaps[`${day}:${u.i}`]?.playerNames?.[id] || null, team: all?.players.get(id)?.team || null, ...pts[id] }))
        .sort((a, b) => (b.points ?? -1e9) - (a.points ?? -1e9));
      return { id: String(u.i), name: u.n, points: bench.reduce((s, p) => s + (p.points || 0), 0), open: bench.filter(p => p.points == null).length, bench };
    }).sort((a, b) => b.points - a.points);
    const value = { day, status: st, updatedAt: new Date().toISOString(), managers };
    benchCache.set(day, { at: Date.now(), status: st, value });
    res.set('Cache-Control', 'no-store').json(value);
  } catch (err) { res.status(err.status || 502).json({ error: 'Bankpunkte konnten nicht geladen werden.', detail: err.message }); }
});

// Testabfrage (nur lesend): Welche Kickbase-Quelle liefert waehrend des Spieltags Live-Punkte?
// Beispiel: /api/live-probe?day=7&user=1165589&pid=8247 . Vergleicht Teamcenter, Ranking, performance und playercenter.
app.get('/api/live-probe', async (req, res) => {
  const token = getToken(req);
  if (!token) return res.status(401).json({ error: 'Nicht angemeldet.' });
  const day = validDay(req.query.day), user = String(req.query.user || ''), pid = String(req.query.pid || '');
  if (!day || !/^\d{1,12}$/.test(user) || !/^\d{1,12}$/.test(pid)) return res.status(400).json({ error: 'Bitte ?day=..&user=..&pid=.. angeben.' });
  const L = '/v4/leagues/6422780', out = { day, user, pid, at: new Date().toISOString() };
  const cands = [`${L}/teamcenter/myeleven`, `${L}/users/${user}/teamcenter?dayNumber=${day}`, `${L}/managers/${user}/teamcenter?dayNumber=${day}`,
    `${L}/teamcenter/${user}?dayNumber=${day}`, `${L}/live`, `${L}/ranking`, `/v4/competitions/1/playercenter/${pid}?dayNumber=${day}`];
  for (const p of cands) {
    try { out[p] = JSON.stringify(await kbFetch(p, { token })).slice(0, 4000); }
    catch (e) { out[p] = { error: e.message, status: e.status || null }; }
  }
  try { out.performanceRecord = findDayRecord(await kbFetch(`/v4/competitions/1/players/${pid}/performance`, { token }), day) || null; }
  catch (e) { out.performanceError = e.message; }
  res.set('Cache-Control', 'no-store').json(out);
});

// Testabfrage nach Spielername: findet die Spieler-ID selbst und zeigt Rohdaten aus "performance" und "playercenter" (nur lesend).
// Beispiel: /api/player-probe?name=Kane&day=6
app.get('/api/player-probe', async (req, res) => {
  const token = getToken(req);
  if (!token) return res.status(401).json({ error: 'Nicht angemeldet.' });
  const name = String(req.query.name || '').trim().toLowerCase();
  const day = validDay(req.query.day);
  const id = String(req.query.id || '');
  if (/^\d{1,12}$/.test(id) && day) {
    const out = { id, day };
    try { const perf = await kbFetch(`/v4/competitions/1/players/${id}/performance`, { token }); out.performanceRecord = findDayRecord(perf, day) || null; }
    catch (e) { out.performanceError = e.message; }
    try { out.playercenter = await kbFetch(`/v4/competitions/1/playercenter/${id}?dayNumber=${day}`, { token }); }
    catch (e) { out.playercenterError = e.message; }
    return res.set('Cache-Control', 'no-store').json(out);
  }
  if (name.length < 2) return res.status(400).json({ error: 'Bitte ?name=... angeben (mindestens 2 Buchstaben).' });
  if (!day) return res.status(400).json({ error: 'Bitte ?day=... angeben (1 bis 34).' });
  try {
    const all = await loadAllPlayers(token);
    const hits = [...all.players.entries()].filter(([, p]) => p.name.toLowerCase().includes(name)).map(([id, p]) => ({ id, name: p.name, team: p.team }));
    if (!hits.length) return res.json({ error: 'Kein Spieler mit diesem Namen gefunden.', hits });
    if (hits.length > 1) return res.json({ hint: 'Mehrere Treffer. Namen genauer angeben oder die id unten verwenden: /api/player-probe?id=...&day=' + day, hits });
    res.redirect(`/api/player-probe?id=${hits[0].id}&day=${day}`);
  } catch (err) { res.status(err.status || 502).json({ error: 'Suche fehlgeschlagen.', detail: err.message }); }
});


// Challenge-Wertung der Legenden (Ansicht "Challenges"), siehe challenges.js.
registerChallenges(app, { kbFetch, getToken, validManager, autoToken: async () => ON_GITHUB ? null : (await getChallengeToken().catch(() => null)) || newestToken() });

// Testabfrage Challenges (nur lesend, nur GET): zeigt die Rohform der Kickbase-Challenge-Daten.
// Ohne id: Uebersicht, aktuelle Auswahl, Archiv, Lobby. Mit ?id=...: Profil, Tabelle, Ranking, Top 10, Aufstellung.
// Mit ?id=...&user=...: Tabelle eines anderen Managers in dieser Challenge; mit ?id=...&liga=1 fuer alle Legenden-Manager. Optional &day=N.
app.get('/api/challenge-probe', async (req, res) => {
  const token = getToken(req);
  if (!token) return res.status(401).json({ error: 'Nicht angemeldet.' });
  const id = String(req.query.id || ''), user = String(req.query.user || ''), day = validDay(req.query.day);
  if (id && !/^\d{1,12}$/.test(id)) return res.status(400).json({ error: 'Ungültige Challenge-ID.' });
  if (user && !/^\d{1,12}$/.test(user)) return res.status(400).json({ error: 'Ungültige Manager-ID.' });
  // Mit ?rush=1: Rush-Daten (Division, Rush-Punkte, Rangliste der Division).
  if (req.query.rush === '1') {
    const out = {};
    for (const p of ['/v4/challenges/lobby/profile', '/v4/challenges/lobby/divisionLadder', '/v4/challenges/lobby/skillPoints/summary', '/v4/challenges/lobby/overview/live', '/v4/challenges/1150/favorites', '/v4/challenges/1165/favorites']) {
      try { out[p] = JSON.stringify(await kbFetch(p, { token })).slice(0, 5000); }
      catch (e) { out[p] = { error: e.message, detail: JSON.stringify(e.data || '').slice(0, 300) }; }
    }
    return res.set('Cache-Control', 'no-store').json(out);
  }
  // Mit ?rush=2: Suche nach der Favoriten-Liste mit Rush-Gesamtpunkten (Kandidaten-Pfade, kurze Rohform).
  if (req.query.rush === '2') {
    const u = '1403991', old = /^\d{1,12}$/.test(String(req.query.ch || '')) ? String(req.query.ch) : '1100';
    const cands = req.query.v === '4' ? [`/v4/challenges/${old}/favorites`, `/v4/challenges/${old}/favorites?scope=0`, `/v4/challenges/${old}/favorites?scope=1`, `/v4/challenges/${old}/favorites?scope=2`,
      `/v4/challenges/${old}/favorites/search?query=${encodeURIComponent(String(req.query.q || 'Cello').slice(0, 40))}&start=0&max=10`, `/v4/challenges/${old}/top10?scope=0&max=50`, `/v4/challenges/${old}/top10?scope=1&max=50`, `/v4/challenges/${old}/top10?scope=2&max=50`,
      `/v4/challenges/${old}/ranking`, `/v4/challenges/${old}/profile`, `/v4/challenges/${old}/table/${req.query.u && /^\d{1,12}$/.test(req.query.u) ? req.query.u : u}`] : req.query.v === '3' ? ['/v4/challenges/socialhub?start=0&max=50', '/v4/challenges/socialhub', '/v4/challenges/lobby/skillPoints'] : ['/v4/challenges/lobby/favorites', '/v4/challenges/favorites', '/v4/challenges/lobby/friends', '/v4/challenges/lobby/ranking',
      '/v4/challenges/lobby/leaderboard', '/v4/challenges/lobby/favorites/ranking', '/v4/challenges/lobby/skillPoints/ranking', '/v4/challenges/lobby/skillPoints/favorites',
      '/v4/challenges/lobby/divisionLadder/favorites', '/v4/challenges/lobby/division/41', '/v4/challenges/lobby/divisions/41', '/v4/challenges/lobby/divisionLadder/41',
      `/v4/challenges/lobby/profile/${u}`, `/v4/challenges/lobby/users/${u}`, `/v4/challenges/lobby/user/${u}/profile`, `/v4/challenges/users/${u}/profile`,
      `/v4/challenges/profile/${u}`, '/v4/user/favorites', '/v4/users/favorites', '/v4/challenges/lobby/favoriteusers', '/v4/challenges/lobby/favorites/overview'];
    const out = {};
    await Promise.all(cands.map(async p => {
      try { out[p] = JSON.stringify(await kbFetch(p, { token })).slice(0, req.query.v === '3' || req.query.v === '4' ? 4000 : 1500); }
      catch (e) { out[p] = 'Fehler ' + (e.status || e.message); }
    }));
    return res.set('Cache-Control', 'no-store').json(out);
  }
  const paths = !id
    ? ['/v4/challenges/overview', '/v4/challenges/selection', '/v4/challenges/recommended', '/v4/challenges/archive', '/v4/challenges/lobby/overview', '/v4/challenges/lobby/archive']
    : user
      ? [`/v4/challenges/${id}/table/${user}`, `/v4/challenges/${id}/table/${user}${day ? '?dayNumber=' + day : ''}`]
      : [`/v4/challenges/${id}/favorites`, `/v4/challenges/${id}/favorites?scope=1`, `/v4/challenges/${id}/table`, `/v4/challenges/${id}/ranking${day ? '?dayNumber=' + day : ''}`, `/v4/challenges/${id}/top10`, `/v4/challenges/${id}/lineup/overview`, `/v4/challenges/${id}/performance${day ? '?dayNumber=' + day : ''}`];
  const out = {};
  // Mit &liga=1: Tabelle jedes Legenden-Managers in dieser Challenge (zeigt, wer mitspielt und ob Kickbase das herausgibt).
  if (id && req.query.liga === '1') {
    try {
      const ranking = await kbFetch('/v4/leagues/6422780/ranking', { token });
      for (const m of (ranking.us || []).filter(u => validManager(String(u.i)))) {
        const p = `/v4/challenges/${id}/table/${m.i}`;
        try { out[`${m.n} (${m.i})`] = JSON.stringify(await kbFetch(p, { token })).slice(0, 1500); }
        catch (e) { out[`${m.n} (${m.i})`] = { error: e.message, detail: JSON.stringify(e.data || '').slice(0, 200) }; }
      }
    } catch (e) { out.ligaFehler = e.message; }
    return res.set('Cache-Control', 'no-store').json(out);
  }
  for (const p of paths) {
    try { out[p] = JSON.stringify(await kbFetch(p, { token })).slice(0, 4000); }
    catch (e) { out[p] = { error: e.message, detail: JSON.stringify(e.data || '').slice(0, 300) }; }
  }
  res.set('Cache-Control', 'no-store').json(out);
});


// Einzelereignisse (playercenter): sammelt pro Ereignisnummer (eti) Vorkommen, Punktewerte und Beispiele fuer alle Bundesliga-Spieler eines Spieltags.
// Bestaetigt: 4051 = Elfmeter verschossen (Futkeu, ST 6, 97. Minute, -60 Punkte; von der Liga bestaetigt).
// 4177 = Elfmeter herausgeholt (+30, 96. Minute, selber Spieler, von der Liga bestaetigt).
// 4171 = Elfmeter verursacht (-45, Brackelmann ST 6, 96. Min.; von der Liga bestaetigt). Wird auch bei Handspiel vergeben.
const EVENT_ETI_LABELS = { 4051: 'Elfmeter verschossen', 4171: 'Elfmeter verursacht (Foul oder Handspiel)', 4177: 'Elfmeter herausgeholt (nur Foul)' };
// Kickbase-Stammliste aller Ereignisarten (/v4/live/eventtypes: it[].i Nummer, it[].ti Titel auf Englisch).
// Wird beim Scan geladen (hoechstens alle 12 Std.) und in kbl-event-types.json gespeichert; unbekannte Nummern zeigen dann den Kickbase-Titel.
const EVENT_TYPES_FILE = path.join(process.cwd(), 'kbl-event-types.json');
let eventTypesCache = null;
async function loadEventTypes(token) {
  if (!eventTypesCache) try { eventTypesCache = JSON.parse(fs.readFileSync(EVENT_TYPES_FILE, 'utf8')); } catch {}
  const age = eventTypesCache?.fetchedAt ? Date.now() - Date.parse(eventTypesCache.fetchedAt) : Infinity;
  if (age > 12 * 3600 * 1000 && token) {
    try {
      const data = await kbFetch('/v4/live/eventtypes', { token });
      const types = {};
      for (const t of (Array.isArray(data?.it) ? data.it : [])) if (Number.isFinite(Number(t.i))) types[Number(t.i)] = String(t.ti ?? '');
      if (Object.keys(types).length) {
        // Bekannte Titel bleiben: Kickbase liefert sie je nach Konto/Sprache englisch oder deutsch, Statistik und
        // Saison-Bestenliste ordnen aber über den Titel zu (STAT_CATS, englisch). Neue Nummern kommen dazu.
        eventTypesCache = { fetchedAt: new Date().toISOString(), lcud: data.lcud ?? null, types: { ...types, ...(eventTypesCache?.types || {}) }, raw: data };
        const tmp = EVENT_TYPES_FILE + '.tmp'; fs.writeFileSync(tmp, JSON.stringify(eventTypesCache, null, 2)); fs.renameSync(tmp, EVENT_TYPES_FILE);
      }
    } catch (err) { console.warn('Ereignisarten nicht ladbar:', err.message); }
  }
  return eventTypesCache?.types || {};
}
app.get('/api/event-types', async (req, res) => {
  const token = getToken(req);
  if (!token) return res.status(401).json({ error: 'Nicht angemeldet.' });
  if (req.query.neu) eventTypesCache = { ...(eventTypesCache || {}), fetchedAt: null };
  const types = await loadEventTypes(token);
  res.set('Cache-Control', 'no-store').json({ count: Object.keys(types).length, known: EVENT_ETI_LABELS, types });
});
// Gespeicherte Titel auf die festen (englischen) Titel aus kbl-event-types.json umstellen, falls ein Sammeln deutsche bekam.
function canonEventTitles(rec) {
  if (!eventTypesCache) try { eventTypesCache = JSON.parse(fs.readFileSync(EVENT_TYPES_FILE, 'utf8')); } catch {}
  const kb = eventTypesCache?.types || {};
  for (const t of rec?.types || []) {
    const en = kb[t.eti];
    if (!en || en === t.kickbaseTitle) continue;
    t.kickbaseTitle = en;
    if (t.labelSource === 'kickbase') t.label = germanEventTitle(en) || en;
  }
  return rec;
}
// Punkteuebersicht: jedes Sammeln wird je Spieltag in kbl-points-overview.json gespeichert (ueberschreibt den alten Stand dieses Spieltags).
// Kickbase kann Punkte nachtraeglich korrigieren; der Stand gilt zum Zeitpunkt savedAt.
const POINTS_OVERVIEW_FILE = path.join(process.cwd(), 'kbl-points-overview.json');
function loadPointsOverview() { try { return JSON.parse(fs.readFileSync(POINTS_OVERVIEW_FILE, 'utf8')); } catch { return {}; } }
function savePointsOverview(data) { const tmp = POINTS_OVERVIEW_FILE + '.tmp'; fs.writeFileSync(tmp, JSON.stringify(data)); fs.renameSync(tmp, POINTS_OVERVIEW_FILE); }
app.get('/api/points-overview', (req, res) => {
  if (!getToken(req)) return res.status(401).json({ error: 'Nicht angemeldet.' });
  const store = loadPointsOverview();
  res.set('Cache-Control', 'no-store').json({ days: Object.values(store).map(x => ({ day: x.day, savedAt: x.savedAt })).sort((a, b) => a.day - b.day) });
});
app.get('/api/points-overview/:day', (req, res) => {
  if (!getToken(req)) return res.status(401).json({ error: 'Nicht angemeldet.' });
  const day = validDay(req.params.day);
  if (!day) return res.status(400).json({ error: 'Ungültiger Spieltag.' });
  const saved = canonEventTitles(loadPointsOverview()[day]);
  res.set('Cache-Control', 'no-store').json(saved ? { saved: true, ...saved } : { saved: false, day });
});
// Saison-Bestenliste: alle gespeicherten Spieltage je Kickbase-Titel zusammengezaehlt.
// Spieltage ohne allPlayers (vor dieser Version gesammelt) liefern nur ihre Top 10 und gelten als unvollstaendig.
app.get('/api/points-season', (req, res) => {
  if (!getToken(req)) return res.status(401).json({ error: 'Nicht angemeldet.' });
  const days = Object.values(loadPointsOverview()).map(canonEventTitles).sort((a, b) => a.day - b.day);
  const players = {}, titles = {};
  days.forEach((d, k) => {
    for (const t of d.types || []) {
      if (t.eti < 4000 || !t.kickbaseTitle) continue;
      const title = String(t.kickbaseTitle).replace(/\s+/g, ' ').trim();
      let rows = t.allPlayers || (t.topPlayers || []).map(x => [x.playerId, x.count, x.points]);
      // Vor signCount gesammelt: Gegenbuchungen wurden mitgezaehlt. Hat das Ereignis nur einen Betrag (z. B. Gelb immer ±10),
      // ergibt sich die richtige Anzahl aus den Punkten.
      const mags = new Set((t.points || []).map(x => Math.abs(x.points)));
      if (!t.signCount && mags.size === 1 && !mags.has(0) && !mags.has(null)) {
        const v = (t.points || []).filter(x => x.points).sort((a, b) => b.count - a.count)[0].points;
        rows = rows.map(([id, c, p]) => [id, Math.max(0, Math.round(p / v)), p]);
      }
      if (!t.allPlayers) for (const x of t.topPlayers || []) players[x.playerId] ||= [x.name || null, x.team || null];
      const map = titles[title] ||= new Map();
      for (const [id, c, p] of rows) {
        const r = map.get(id) || { c: 0, p: 0, d: new Array(days.length).fill(0) };
        r.c += c; r.p += p; r.d[k] += c; map.set(id, r);
      }
    }
    for (const [id, v] of Object.entries(d.players || {})) players[id] = v;
  });
  const out = {};
  for (const [title, map] of Object.entries(titles)) out[title] = [...map.entries()].map(([id, r]) => [id, r.c, r.p, r.d]);
  res.set('Cache-Control', 'no-store').json({
    days: days.map(d => ({ day: d.day, savedAt: d.savedAt, full: (d.types || []).some(t => t.allPlayers) })),
    players, titles: out
  });
});
app.get('/api/playercenter-scan/:day', async (req, res) => {
  const token = getToken(req), day = validDay(req.params.day);
  if (!token) return res.status(401).json({ error: 'Nicht angemeldet.' });
  if (!day) return res.status(400).json({ error: 'Ungültiger Spieltag.' });
  try {
    const all = await loadAllPlayers(token);
    const ids = [...all.players.keys()];
    const types = new Map(); // eti -> { occurrences, points: Map(p->count), examples: [], ke: Set }
    let withEvents = 0, failed = 0;
    for (let i = 0; i < ids.length; i += 5) {
      await Promise.all(ids.slice(i, i + 5).map(async id => {
        try {
          const data = await kbFetch(`/v4/competitions/1/playercenter/${id}?dayNumber=${day}`, { token });
          const events = Array.isArray(data?.events) ? data.events : [];
          if (!events.length) return;
          withEvents++;
          const info = all.players.get(id);
          for (const e of events) {
            if (!Number.isFinite(Number(e.eti))) continue;
            // 4048 und 4054 (laut Kickbase-Liste ebenfalls „Penalty missed“) werden mit 4051 als ein Eintrag „Elfmeter verschossen“ gezeigt.
            const key = ETI_PEN_MISSED_SET.has(Number(e.eti)) ? 4051 : Number(e.eti);
            if (!types.has(key)) types.set(key, { occurrences: 0, points: new Map(), examples: [], ke: new Set(), byPlayer: new Map() });
            const t = types.get(key);
            t.occurrences++;
            const pt = Number.isFinite(Number(e.p)) ? Number(e.p) : null;
            // Je Spieler nach Vorzeichen mitzaehlen (fuer die Statistik). Kickbase nimmt Ereignisse mit einem
            // Gegenbuchungs-Eintrag zurueck (z. B. Gelb -10 und spaeter +10), oft in einer anderen Minute.
            if (!t.byPlayer.has(id)) t.byPlayer.set(id, { pos: 0, neg: 0, zero: 0, net: 0 });
            const bp = t.byPlayer.get(id); if (pt > 0) bp.pos++; else if (pt < 0) bp.neg++; else bp.zero++; bp.net += pt || 0;
            t.points.set(pt, (t.points.get(pt) || 0) + 1);
            if (e.ke !== undefined) t.ke.add(e.ke);
            if (t.examples.length < 6 && !t.examples.some(x => x.playerId === id))
              t.examples.push({ playerId: id, name: info.name, team: info.team, minute: e.mt ?? null, points: pt });
          }
        } catch { failed++; }
      }));
    }
    // Spieler nach Anzahl, dazu ihre Punkte aus diesem Ereignis. Das uebliche Vorzeichen des Ereignisses
    // (haeufigster Punktwert) zaehlt, jede Gegenbuchung hebt ein Ereignis auf.
    const rankPlayers = t => {
      const main = [...t.points.entries()].filter(([p]) => p).sort((a, b) => b[1] - a[1])[0]?.[0] ?? 0;
      return [...t.byPlayer.entries()].map(([id, b]) => {
        const count = Math.max(0, (main < 0 ? b.neg - b.pos : b.pos - b.neg) + b.zero);
        const info = all.players.get(id) || {};
        return { playerId: id, name: info.name, team: info.team, count, points: b.net };
      }).filter(x => x.count > 0).sort((a, b) => b.count - a.count || b.points - a.points);
    };
    const seasonIds = new Set();
    const list = [...types.entries()].sort((a, b) => a[0] - b[0]).map(([eti, t]) => {
      const ranked = rankPlayers(t);
      // Alle Spieler kompakt [id, Anzahl, Punkte] fuer die Saison-Bestenliste (nur echte Aktionen ab 4000).
      const allPlayers = eti >= 4000 ? ranked.map(x => (seasonIds.add(x.playerId), [x.playerId, x.count, x.points])) : null;
      return {
        eti, occurrences: t.occurrences, label: EVENT_ETI_LABELS[eti] || null,
        points: [...t.points.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6).map(([p, n]) => ({ points: p, count: n })),
        ke: [...t.ke], examples: t.examples, signCount: true,
        topPlayers: ranked.slice(0, 10),
        ...(allPlayers ? { allPlayers } : {})
      };
    });
    const kbTypes = await loadEventTypes(token);
    for (const t of list) {
      t.kickbaseTitle = kbTypes[t.eti] || null;
      if (!t.label && t.kickbaseTitle) { t.label = germanEventTitle(t.kickbaseTitle) || t.kickbaseTitle; t.labelSource = 'kickbase'; }
    }
    const result = { day, savedAt: new Date().toISOString(), ...(req.query.final ? { final: true } : {}), playersScanned: ids.length, playersWithEvents: withEvents, failedPlayers: failed, failedTeams: all.failedTeams, types: list,
      players: Object.fromEntries([...seasonIds].map(id => { const i = all.players.get(id) || {}; return [id, [i.name || null, i.team || null]]; })) };
    try { const store = loadPointsOverview(); store[day] = result; savePointsOverview(store); } catch (err) { console.warn('Punkteübersicht nicht gespeichert:', err.message); }
    res.set('Cache-Control', 'no-store').json(result);
  } catch (err) { res.status(err.status || 502).json({ error: 'Einzelereignisse konnten nicht gesammelt werden.', detail: err.message }); }
});


// Ereignis-Finder: wer hatte an einem Spieltag eine bestimmte Ereignisnummer (mit Minute)? Optional nur ein Verein (nur lesend).
// Beispiel: /api/event-finder?eti=4177&day=6&team=Elversberg
app.get('/api/event-finder', async (req, res) => {
  const token = getToken(req);
  if (!token) return res.status(401).json({ error: 'Nicht angemeldet.' });
  const day = validDay(req.query.day), eti = Number(req.query.eti);
  const team = String(req.query.team || '').trim().toLowerCase();
  if (!day || !Number.isInteger(eti)) return res.status(400).json({ error: 'Bitte ?eti=...&day=... angeben (optional &team=Vereinsname).' });
  try {
    const all = await loadAllPlayers(token);
    const ids = [...all.players.entries()].filter(([, p]) => !team || String(p.team).toLowerCase().includes(team)).map(([id]) => id);
    const found = []; let failed = 0;
    for (let i = 0; i < ids.length; i += 5) {
      await Promise.all(ids.slice(i, i + 5).map(async id => {
        try {
          const data = await kbFetch(`/v4/competitions/1/playercenter/${id}?dayNumber=${day}`, { token });
          for (const e of (Array.isArray(data?.events) ? data.events : []))
            if (Number(e.eti) === eti || (eti === 4051 && ETI_PEN_MISSED_SET.has(Number(e.eti)))) found.push({ player: all.players.get(id).name, team: all.players.get(id).team, minute: e.mt ?? null, points: e.p ?? null });
        } catch { failed++; }
      }));
    }
    found.sort((a, b) => (a.team + a.minute).localeCompare(b.team + b.minute, 'de', { numeric: true }));
    res.set('Cache-Control', 'no-store').json({ eti, day, team: team || null, label: EVENT_ETI_LABELS[eti] || null, playersChecked: ids.length, failedPlayers: failed, count: found.length, events: found });
  } catch (err) { res.status(err.status || 502).json({ error: 'Suche fehlgeschlagen.', detail: err.message }); }
});

// scope: day = nur gewaehlter Spieltag, season = ganze Saison 2026/27, all = Saison 2026/27 und Vorsaison 2025/26
app.get('/api/event-code-scan/:day', async (req, res) => {
  const token = getToken(req), day = validDay(req.params.day);
  const scope = ['day', 'season', 'all'].includes(req.query.scope) ? req.query.scope : 'day';
  if (!token) return res.status(401).json({ error: 'Nicht angemeldet.' });
  if (!day) return res.status(400).json({ error: 'Ungültiger Spieltag.' });
  try {
    const allMode = req.query.players === 'all';
    const players = new Map(); // playerId -> { name, managers: Set }
    let failedSquads = 0, managers = [], failedTeams = [];
    if (allMode) {
      const all = await loadAllPlayers(token);
      failedTeams = all.failedTeams;
      for (const [id, p] of all.players) players.set(id, { name: p.name, managers: new Set([p.team]) });
    } else {
      const ranking = await kbFetch('/v4/leagues/6422780/ranking', { token });
      managers = (ranking.us || []).filter(u => validManager(String(u.i)) && String(u.n || '').toLowerCase() !== 't1000');
      for (const m of managers) {
        try {
          const squad = await kbFetch(`/v4/leagues/6422780/managers/${m.i}/squad`, { token });
          for (const p of squad.it || []) {
            const id = String(p.pi ?? '');
            if (!/^\d{1,12}$/.test(id)) continue;
            if (!players.has(id)) players.set(id, { name: String(p.pn || p.n || id), managers: new Set() });
            players.get(id).managers.add(String(m.n || m.i));
          }
        } catch { failedSquads++; }
      }
    }
    const ids = [...players.keys()];
    const codes = new Map(); // code -> { occurrences, players: Map }
    let withEvents = 0, failedPlayers = 0;
    for (let i = 0; i < ids.length; i += 5) {
      await Promise.all(ids.slice(i, i + 5).map(async id => {
        try {
          const data = await kbFetch(`/v4/competitions/1/players/${id}/performance`, { token });
          let records = [];
          if (scope === 'day') { const r = findDayRecord(data, day); records = r ? [{ season: '2026/27', rec: r }] : []; }
          else {
            records = seasonEntries(data, CURRENT_SEASON).map(rec => ({ season: '2026/27', rec }));
            if (scope === 'all') records = records.concat(seasonEntries(data, PREVIOUS_SEASON).map(rec => ({ season: '2025/26', rec })));
          }
          let any = false;
          for (const { season, rec } of records) {
            if (!Array.isArray(rec.k) || !rec.k.length) continue;
            any = true;
            for (const code of rec.k) {
              if (!Number.isInteger(code)) continue;
              if (!codes.has(code)) codes.set(code, { occurrences: 0, players: new Map() });
              const entry = codes.get(code);
              entry.occurrences++;
              const info = players.get(id);
              if (!entry.players.has(id)) entry.players.set(id, { playerId: id, name: info.name, managers: [...info.managers], times: 0, entries: [] });
              const pl = entry.players.get(id);
              pl.times++;
              if (!pl.entries.some(e => e.day === rec.day && e.season === season))
                pl.entries.push({ season, day: rec.day ?? null, points: Number.isFinite(Number(rec.p)) ? Number(rec.p) : null, minutes: rec.mp ?? null });
            }
          }
          if (any) withEvents++;
        } catch { failedPlayers++; }
      }));
    }
    const list = [...codes.entries()].sort((a, b) => a[0] - b[0]).map(([code, v]) => ({
      code, occurrences: v.occurrences,
      label: EVENT_CODE_LABELS[code] || null, certainty: EVENT_CODE_LABELS[code] ? 'bestätigt' : 'unbekannt',
      players: [...v.players.values()].sort((a, b) => a.name.localeCompare(b.name, 'de'))
    }));
    res.set('Cache-Control', 'no-store').json({ day, scope, allPlayers: allMode, managers: managers.length, failedSquads, failedTeams, playersScanned: ids.length,
      playersWithEvents: withEvents, failedPlayers, codes: list,
      note: allMode ? 'Alle Spieler der Bundesliga-Vereine (Angaben unter "Manager" sind hier die Vereine).' : 'Nur Spieler aus den aktuellen Kadern der Liga; Spieler, die inzwischen niemand besitzt, fehlen.' });
  } catch (err) { res.status(err.status || 502).json({ error: 'Ereigniscodes konnten nicht gesammelt werden.', detail: err.message }); }
});
// NPC Goes MVP: wechselnde Tippregel; Gewinner werden ausschliesslich manuell bestimmt.
const NPC_FILE=path.join(process.cwd(),'kbl-npc-jokers.json');
function readNpc(){try{return JSON.parse(fs.readFileSync(NPC_FILE,'utf8'));}catch(e){if(e.code==='ENOENT')return {};throw e;}}
function saveNpc(data){const tmp=NPC_FILE+'.tmp';fs.writeFileSync(tmp,JSON.stringify(data,null,2),{mode:0o600});fs.renameSync(tmp,NPC_FILE);}
function npcRecord(rule,winners){return {rule:String(rule||'').trim(),winners:[...new Set(winners.map(String))],evaluation:'manual',joker:true};}
// Leere NPC-Regel: Tippregel aus dem MVP-Tipp vorschlagen.
function npcWithTippRule(rec,day){const r=rec||{rule:'',winners:[],evaluation:'manual'};if(r.rule)return r;const t=readTipps()[day]?.rule;return t?{...r,rule:`${t.title}: ${t.text}`}:r;}
app.get('/api/npc-jokers/:day',async(req,res)=>{
 const token=getToken(req),day=validDay(req.params.day);
 if(!token)return res.status(401).json({error:'Nicht angemeldet.'});
 if(!day)return res.status(400).json({error:'Ungültiger Spieltag.'});
 try{const ranking=await kbFetch('/v4/leagues/6422780/ranking',{token});const managers=(ranking.us||[]).filter(m=>validManager(m.i)&&String(m.n||'').toLowerCase()!=='t1000').map(m=>({id:String(m.i),name:String(m.n||m.i)}));
 res.set('Cache-Control','no-store').json({day,managers,record:npcWithTippRule(readNpc()[day],day)});
 }catch(e){res.status(502).json({error:e.message});}
});
app.put('/api/npc-jokers/:day',async(req,res)=>{
 const token=getToken(req),day=validDay(req.params.day);
 if(!token)return res.status(401).json({error:'Nicht angemeldet.'});
 if(!day)return res.status(400).json({error:'Ungültiger Spieltag.'});
 const rule=req.body?.rule,winners=req.body?.winners;
 if(typeof rule!=='string'||rule.length>500||!Array.isArray(winners)||winners.length>16||!winners.every(validManager))return res.status(400).json({error:'Ungültige Tippregel oder Gewinnerliste.'});
 if(winners.length&&!rule.trim())return res.status(400).json({error:'Bitte zuerst die Tippregel eintragen.'});
 try{const ranking=await kbFetch('/v4/leagues/6422780/ranking',{token});const valid=new Set((ranking.us||[]).filter(m=>validManager(m.i)&&String(m.n||'').toLowerCase()!=='t1000').map(m=>String(m.i)));
 if(winners.some(id=>!valid.has(String(id))))return res.status(400).json({error:'Unbekannter Manager.'});
 const all=readNpc();all[day]={...npcRecord(rule,winners),updatedAt:new Date().toISOString()};saveNpc(all);
 res.set('Cache-Control','no-store').json({ok:true,record:all[day]});
 }catch(e){res.status(502).json({error:e.message});}
});
// MVP-Tipp (Teil von NPC Goes MVP): Jeder Manager tippt verdeckt einen Spieler und dessen Punktzahl.
// Bis zum ersten Anstoss des Spieltags beliebig oft aenderbar. Vorher sieht niemand fremde Tipps (auch der Admin nicht), danach alle.
// Die Tippregel legt der Admin je Spieltag bis zum Anstoss fest (Vorlage aus TIPP_RULES oder eigener Text); ohne Eintrag steht sie noch nicht fest.
// Die Auswertung ist nur ein Vorschlag; Joker-Gewinner traegt weiter der Admin ein (NPC, kbl-npc-jokers.json).
const TIPP_FILE=path.join(process.cwd(),'kbl-mvp-tipps.json');
const TIPP_RULES=[
 {id:'volltreffer',title:'Volltreffer',text:'Richtiger MVP. Haben mehrere den richtigen Spieler, gewinnt, wer der Punktzahl am nächsten ist.'},
 {id:'zahl',title:'Nur die Zahl',text:'Der Spieler ist egal. Wer der Punktzahl des MVP am nächsten kommt, gewinnt.'},
 {id:'name',title:'Name reicht',text:'Alle, die den MVP richtig tippen, gewinnen. Die Punktzahl zählt nicht.'},
 {id:'drunter',title:'Nicht drüber',text:'Richtiger MVP und die Punktzahl am nächsten dran, aber nicht darüber. Wer zu hoch tippt, ist raus.'},
 {id:'korridor',title:'Im Korridor',text:'Richtiger MVP und höchstens 25 Punkte daneben. Alle, die das schaffen, gewinnen.'},
 {id:'prognose',title:'Punkte-Prognose',text:'Der Spieler muss nicht MVP werden. Wer die Punkte seines getippten Spielers am genauesten vorhersagt, gewinnt.'}
];
const TIPP_KORRIDOR=25;
// Wertung zur frei geschriebenen Tippregel: Der Admin waehlt, wie gewertet wird (die App liest den Regeltext nicht).
// Danach richten sich "fuehrend" waehrend des Spieltags und der Gewinner-Vorschlag. Aendern geht auch nach dem Anpfiff.
const TIPP_WERTUNG=[
 {id:'spieler',title:'Meiste Punkte des getippten Spielers, dann Abstand zur Zahl'},
 {id:'volltreffer',title:'Richtiger MVP, dann nächste Punktzahl'},
 {id:'zahl',title:'Spieler egal, am nächsten an der MVP-Punktzahl'},
 {id:'name',title:'Richtiger MVP, Punktzahl egal'},
 {id:'drunter',title:'Richtiger MVP, nächste Punktzahl, aber nicht drüber'},
 {id:'korridor',title:'Richtiger MVP, höchstens 25 Punkte daneben'},
 {id:'prognose',title:'Punkte des eigenen Spielers am genauesten'},
 {id:'keine',title:'Keine automatische Wertung'}
];
const TIPP_MVP_KINDS=new Set(['volltreffer','zahl','name','drunter','korridor']);
// Ohne eingestellte Wertung erkennt die App sie aus dem Regeltext (Stichwoerter, gleiche Funktion in public/mvp-tipp.js). Nicht erkannt = keine Wertung.
function detectWertung(text){
 const t=String(text||'').toLowerCase().replace(/ä/g,'ae').replace(/ö/g,'oe').replace(/ü/g,'ue').replace(/ß/g,'ss').replace(/\s+/g,' ');
 if(!t.trim())return null;
 const pts=/punkt|zahl/.test(t);
 if(/mvp/.test(t)){
  if(/korridor/.test(t))return 'korridor';
  if(/(nicht|ohne|kein) *(drueber|darueber|ueber)|drunter|darunter|ueberbiet/.test(t))return 'drunter';
  if(pts&&/(spieler|name) *(ist|sind)? *egal|egal,? welche|nur die (punkt)?zahl/.test(t))return 'zahl';
  if(/punkt\w* *(zaehl\w*|ist|sind) *(nicht|egal)|ohne punkt/.test(t))return 'name';
  if(/(punktzahl|punkte\w*) des mvp|mvp-punkt/.test(t)&&!/richtig\w* *(mvp|spieler)|mvp richtig/.test(t))return 'zahl';
  return pts?'volltreffer':'name';
 }
 // "Punktbester Spieler (der Aufsteiger)": wer den Besten tippt; nennt die Regel Vereine, zaehlen nur deren Spieler (ruleTeams).
 if(/punktbest|beste\w* (feld)?spieler|meiste\w* punkte|hoechste\w* punkt/.test(t))return 'volltreffer';
 if(/(eigen|getippt|seine|ihre)\w* *spieler/.test(t)&&/genau|naechst|nah/.test(t))return 'prognose';
 return null;
}
// Vereine, die der Regeltext nennt (z. B. "von den Aufsteigern Schalke, Elversberg und Paderborn"). Leer = alle Spieler zaehlen.
function ruleTeams(text,teams){
 const n=v=>String(v||'').toLowerCase().replace(/ä/g,'ae').replace(/ö/g,'oe').replace(/ü/g,'ue').replace(/ß/g,'ss').replace(/\s+/g,' ');
 const t=n(text);
 return [...new Set(teams)].filter(x=>{const k=n(x);return [k,...k.split(/['\s]/).filter(w=>w.length>=5)].some(w=>w.length>=4&&new RegExp(`(^|[^a-z0-9])${w.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')}([^a-z0-9]|$)`).test(t));});
}
const tippPool=async(token,rule)=>rule?.text?ruleTeams(rule.text,[...(await loadAllPlayers(token)).players.values()].map(p=>p.team)):[];
// MVP innerhalb der genannten Vereine (pool), sonst der ganzen Bundesliga.
function poolMvp(m,pool){
 if(!pool.length)return m.players;
 const sc=(m.all||[]).filter(p=>pool.includes(p.team));
 return sc.length?sc.filter(p=>p.points===sc[0].points):[];
}
// Bedingungen an den Spieler aus dem Regeltext (Kevin, ST 8: "Der beste Feldspieler ohne direkte Torbeteiligung (ohne Tor,
// Eigentor erzwungen, Vorlage, absichtliche Vorlage, abgefälschte Vorlage, Tor eingeleitet und Eigentor)"). Gleiche Erkennung in public/mvp-tipp.js.
// field = kein Torwart, noGoal = keine direkte Torbeteiligung am Spieltag.
function ruleConds(text){
 const t=String(text||'').toLowerCase().replace(/ä/g,'ae').replace(/ö/g,'oe').replace(/ü/g,'ue').replace(/ß/g,'ss').replace(/\s+/g,' '),c=[];
 if(/feldspieler|(kein|ohne)\w* *(torwart|torhueter)/.test(t))c.push('field');
 if(/(ohne|kein)\w* *(direkte\w* *)?torbeteiligung/.test(t))c.push('noGoal');
 return c;
}
const tippConds=rule=>ruleConds(rule?.text);
// Direkte Torbeteiligung nach den festen (englischen) Kickbase-Titeln: Tor, Eigentor, Eigentor erzwungen, Torvorlage
// (auch absichtlich und abgefälscht) und Tor eingeleitet ("Secondary Assist"/"Goal Set up"). Nicht: Gegentor, Torschussvorlage, Abpraller-Vorlage.
const GOAL_INVOLVED=/^(goal(?! conceded| kick)|own goal|assist\b|intentional assist|deflected assist|secondary assist)/i;
// Prueft je Spieler die Bedingungen (ein playercenter-Abruf je Spieler). ok: true/false, null = nicht pruefbar (nie raten).
function condChecker(token,day,conds){
 if(!conds.length)return null;
 const memo=new Map();
 return id=>{id=String(id);if(!memo.has(id))memo.set(id,(async()=>{
  let pc=null;try{pc=await kbFetch(`/v4/competitions/1/playercenter/${id}?dayNumber=${day}`,{token});}catch{}
  const types=await loadEventTypes(token),ev=Array.isArray(pc?.events)?pc.events:[];
  // Pro (eti, Minute) mit Summe 0 bei mehreren Eintraegen = zurueckgenommen (VAR).
  const g=new Map();for(const e of ev){const k=e.eti+'|'+e.mt,x=g.get(k)||{eti:e.eti,n:0,p:0};x.n++;x.p+=Number(e.p)||0;g.set(k,x);}
  const titles=[...g.values()].filter(x=>!(x.n>1&&x.p===0)).map(x=>String(types[x.eti]||''));
  if(conds.includes('field')){
   const pos=(await loadAllPlayers(token)).players.get(id)?.pos;
   // Ohne Position aus dem Vereinsprofil: Torwart-Ereignisse "(GK)" verraten den Torwart.
   const gk=pos?pos===1:titles.some(t=>/\(GK\)/.test(t));
   if(gk)return {ok:false,why:'Torwart'};
  }
  if(conds.includes('noGoal')){
   if(!pc)return {ok:null,why:'Ereignisse nicht abrufbar'};
   const k=Array.isArray(pc.k)?pc.k.map(Number):[];
   if(titles.some(t=>GOAL_INVOLVED.test(t))||k.some(x=>x===1||x===2||x===3))return {ok:false,why:'direkte Torbeteiligung'};
  }
  return {ok:true};
 })());return memo.get(id);};
}
// Beste Spieler einer Liste, die die Tippregel erlaubt (Vereine und Bedingungen); n = Anzahl, Gleichstand am Ende = alle.
async function condTop(list,pool,chk,n){
 const sc=(list||[]).filter(p=>!pool.length||pool.includes(p.team)).sort((a,b)=>b.points-a.points),out=[];let unsure=false;
 for(const p of sc){
  if(out.length>=n&&p.points<out[out.length-1].points)break;
  if(chk){const r=await chk(p.id);if(r.ok===null)unsure=true;if(!r.ok)continue;}
  out.push(p);
 }
 return {list:out,unsure};
}
const tippKind=rule=>rule?.wertung||(TIPP_RULES.some(r=>r.id===rule?.id)?rule.id:detectWertung(rule?.text));
// Export fuer die Online-Seite: nie den eigenen Tipp des Dienst-Kontos vor dem Anstoss mitschreiben, keine Admin-Knoepfe.
const TIPP_EXPORT=process.env.KBL_EXPORT==='1';
function readTipps(){try{return JSON.parse(fs.readFileSync(TIPP_FILE,'utf8'));}catch(e){if(e.code==='ENOENT')return {};throw e;}}
function saveTipps(data){const tmp=TIPP_FILE+'.tmp';fs.writeFileSync(tmp,JSON.stringify(data,null,2),{mode:0o600});fs.renameSync(tmp,TIPP_FILE);}
const tippRule=rec=>rec?.rule||null;
// Tipp-Code: Wer nicht angemeldet ist, waehlt seinen Namen und tippt mit einem eigenen Code (4-8 Ziffern), den er beim ersten Tipp selbst festlegt.
// Gespeichert nur als Salt+scrypt in mvp-tipp-codes.json (bewusst kein kbl-*-Name: wird nie committet/veroeffentlicht, siehe .gitignore).
// Hoechstens 5 Fehlversuche je Manager in 15 Minuten. Der Admin kann einen Code zuruecksetzen.
const TIPP_CODE_FILE=path.join(process.cwd(),'mvp-tipp-codes.json');
function readTippCodes(){try{return JSON.parse(fs.readFileSync(TIPP_CODE_FILE,'utf8'));}catch(e){if(e.code==='ENOENT')return {};throw e;}}
function saveTippCodes(d){const tmp=TIPP_CODE_FILE+'.tmp';fs.writeFileSync(tmp,JSON.stringify(d,null,2),{mode:0o600});fs.renameSync(tmp,TIPP_CODE_FILE);}
const tippHash=(code,salt)=>crypto.scryptSync(String(code),salt,32).toString('hex');
const tippCodeFails=new Map();
// Prueft den Code; ohne gespeicherten Code wird er (nur wenn set=true) neu festgelegt.
function checkTippCode(managerId,code,set){
 if(!/^\d{4,8}$/.test(String(code||'')))return {error:'Bitte einen Code aus 4 bis 8 Ziffern eingeben.',status:400};
 const now=Date.now(),f=(tippCodeFails.get(managerId)||[]).filter(t=>now-t<15*60e3);
 if(f.length>=5)return {error:'Zu viele falsche Codes. Bitte in 15 Minuten erneut versuchen.',status:429};
 const all=readTippCodes(),rec=all[managerId];
 if(!rec){if(!set)return {error:'Für diesen Namen gibt es noch keinen Code. Er wird beim ersten Tipp festgelegt.',status:404};
  const salt=crypto.randomBytes(16).toString('hex');all[managerId]={salt,hash:tippHash(code,salt),createdAt:new Date().toISOString()};saveTippCodes(all);return {ok:true,created:true};}
 const a=Buffer.from(rec.hash,'hex'),b=Buffer.from(tippHash(code,rec.salt),'hex');
 if(a.length!==b.length||!crypto.timingSafeEqual(a,b)){f.push(now);tippCodeFails.set(managerId,f);return {error:'Falscher Code.',status:403};}
 tippCodeFails.delete(managerId);return {ok:true};
}
// Ansehen geht auch ohne Anmeldung: dann mit Dienst-Login (oder dem neuesten Admin-Login) bei Kickbase lesen.
async function tippToken(req){
 const own=getToken(req);if(own)return own;
 try{const t=await getServiceToken();if(t)return t;}catch{}
 return newestToken();
}
let tippDaysCache=null;
async function tippMatchdays(){
 if(!tippDaysCache||Date.now()-tippDaysCache.at>2*60e3)tippDaysCache={at:Date.now(),value:await loadMatchdays()};
 return tippDaysCache.value;
}
let tippManagersCache=null;
async function tippManagers(token){
 if(!tippManagersCache||Date.now()-tippManagersCache.at>10*60e3){
  const ranking=await kbFetch('/v4/leagues/6422780/ranking',{token});
  tippManagersCache={at:Date.now(),value:(ranking.us||[]).filter(m=>validManager(m.i)&&String(m.n||'').toLowerCase()!=='t1000').map(m=>({id:String(m.i),name:String(m.n||m.i)}))};
 }
 return tippManagersCache.value;
}
// Tippbar ist nur der naechste Spieltag, der noch nicht angepfiffen ist.
function tippState(md,day){
 const d=md.days.find(x=>x.day===day);
 const next=md.days.find(x=>x.status==='upcoming')?.day||null;
 const kickoff=d?.firstKickoffUTC?Date.parse(d.firstKickoffUTC):NaN;
 const locked=!d||d.status!=='upcoming'||!Number.isFinite(kickoff)||Date.now()>=kickoff;
 return {status:d?.status||'unknown',deadline:d?.firstKickoffUTC||null,firstMatch:d?.firstMatch||null,locked,open:!locked&&day===next,next};
}
async function tippPlayerPoints(token,playerId,day){
 try{const rec=findDayRecord(await kbFetch(`/v4/competitions/1/players/${playerId}/performance`,{token}),day);
  return rec&&rec.p!==undefined&&rec.p!==null&&rec.p!==''&&Number.isFinite(Number(rec.p))?Number(rec.p):null;}catch{return null;}
}
// Spieltagspunkte eines Spielers, auch waehrend des Spiels. "performance" hat Punkte erst nach Spielende;
// laeuft das Spiel (mdst 1), stehen die Live-Punkte nur in "playercenter" (an ST 7 geprueft: Hendriks 25 Punkte in der 36. Minute).
// state: done = Spiel beendet, live = Spiel laeuft, open = noch nicht angepfiffen oder keine Daten (points null).
async function dayPlayerPoints(token,id,day,finished=false,get=p=>kbFetch(p,{token})){
 const data=await get(`/v4/competitions/1/players/${id}/performance`),rec=findDayRecord(data,day),points=pointFromPerformance(data,day,finished);
 if(points!==null&&finished)return {points,state:'done'};
 // Laeuft der Spieltag noch, zaehlt nach dem Anstoss playercenter zuerst: direkt nach Abpfiff steht in performance
 // schon mdst 2 mit 0 Punkten, die echten Punkte kommen erst spaeter (ST 7, Stuttgart-Gladbach: alle auf 0 gefallen).
 if(points!==null){
  const k=Date.parse(rec?.md||'');
  if(!(Number.isFinite(k)&&k<=Date.now()))return {points,state:Number(rec?.mdst)===2?'done':'live',kick:rec?.md||null};
  const pc=await get(`/v4/competitions/1/playercenter/${id}?dayNumber=${day}`).catch(()=>null);
  const q=pc&&pc.p!==undefined&&pc.p!==null&&pc.p!==''&&Number.isFinite(Number(pc.p))?Number(pc.p):null;
  return {points:q??points,state:Number(rec?.mdst)===2?'done':'live',kick:rec?.md||null,...(q!==null&&q!==points?{perf:points}:{})};
 }
 // Nicht am Status (mdst) festmachen: der wechselt waehrend des Spiels (z. B. Halbzeit) und dann fehlten die Punkte.
 // Massgeblich ist die Anstosszeit md: ist sie vorbei und fehlen die Punkte in performance, gilt playercenter.
 // Fehlt der Eintrag in performance oder dessen Anstosszeit (z. B. Pejcinovic an ST 7), entscheidet playercenter selbst (eigene Anstosszeit md).
 const kick=Date.parse(rec?.md||'');
 if(Number.isFinite(kick)&&kick>Date.now())return {points:null,state:'open'};
 const pc=await get(`/v4/competitions/1/playercenter/${id}?dayNumber=${day}`);
 const pcKick=Date.parse(pc?.md||'');
 if(!Number.isFinite(kick)&&!(Number.isFinite(pcKick)&&pcKick<=Date.now()))return {points:null,state:'open',why:rec?'keine Anstosszeit':'kein Eintrag in performance'};
 const p=pc&&pc.p!==undefined&&pc.p!==null&&pc.p!==''&&Number.isFinite(Number(pc.p))?Number(pc.p):null;
 return {points:p,state:p===null?'open':'live',kick:pc?.md||rec?.md||null,mdst:rec?.mdst??null,mst:pc?.mst??null,...(rec?{}:{why:'nur playercenter'})};
}
// Der MVP-Zwischenstand ist bis zu 30 Min. alt, die getippten Spieler sind frischer (alle 5 Min.). Liegt einer von ihnen
// (bei genannten Vereinen nur aus diesen) inzwischen vorne, gilt er als Bester (Kevin: Krone stand bei 21, ein getippter Schalker hatte 59).
function freshBest(lm,tips,players,pool,bad=new Set()){
 if(!lm)return lm;
 const info=new Map(Object.values(tips).map(t=>[String(t.playerId),t]));
 const cand=new Map((lm.points===null?[]:lm.players||[]).map(p=>[String(p.id),{...p,points:lm.points}]));
 for(const [id,r] of Object.entries(players)){
  const t=info.get(id);if(!t||bad.has(id)||r.points===null||r.points===undefined||(pool.length&&!pool.includes(t.team)))continue;
  cand.set(id,{id,name:cand.get(id)?.name||t.player,team:cand.get(id)?.team||t.team,points:r.points});
 }
 if(!cand.size)return lm;
 const top=Math.max(...[...cand.values()].map(p=>p.points)),best=[...cand.values()].filter(p=>p.points===top);
 if(top===lm.points&&best.length===(lm.players||[]).length)return lm;
 return {...lm,points:top,players:best.map(({id,name,team})=>({id,name,team})),tipped:true};
}
// Top 10 des Spieltags unter allen Spielern, die die Tippregel erlaubt (Kevin-Wunsch); Gleichstand auf Platz 10 = alle.
function poolTop(list,pool,n=10){
 const sc=(list||[]).filter(p=>!pool.length||pool.includes(p.team)).sort((a,b)=>b.points-a.points);
 const cut=sc.length>=n?sc[n-1].points:null;
 return (cut===null?sc:sc.filter(p=>p.points>=cut)).map(p=>({id:String(p.id),name:p.name,team:p.team,points:p.points}));
}
// Wie freshBest: getippte Spieler haben frischere Punkte als der Zwischenstand (alle 30 Min.).
function freshTop(top,tips,players,pool,bad=new Set()){
 if(!top)return top;
 const m=new Map(top.map(p=>[p.id,{...p}]));
 for(const t of Object.values(tips)){const id=String(t.playerId),r=players[id];
  if(!r||bad.has(id)||r.points===null||r.points===undefined||(pool.length&&!pool.includes(t.team)))continue;
  m.set(id,{id,name:m.get(id)?.name||t.player,team:m.get(id)?.team||t.team,points:r.points});}
 return poolTop([...m.values()],[]);
}
// Live-Stand nach dem Anpfiff: Spieltagspunkte aller getippten Spieler (wie BD/AH aus "performance").
// state: done = Spiel beendet, live = Punkte da, Spiel laeuft noch, open = noch keine Punkte. Fehlt etwas, bleibt points null.
const tippTrackCache=new Map();
async function tippTracking(token,day,tips,finished,kind,pool=[],conds=[]){
 const ids=[...new Set(Object.values(tips).map(t=>String(t.playerId)))].sort(),key=ids.join(',')+'|'+kind+'|'+pool.join(',')+'|'+conds.join(','),c=tippTrackCache.get(day);
 if(c&&c.key===key&&Date.now()-c.at<2*60e3)return c.value;
 const players={};
 await Promise.all(ids.map(async id=>{
  try{players[id]=await dayPlayerPoints(token,id,day,finished);}
  catch{players[id]={points:null,state:'error'};}
 }));
 const value={updatedAt:new Date().toISOString(),players,...(pool.length?{pool}:{}),...(conds.length?{conds}:{})};
 // Getippte Spieler, die die Bedingungen der Tippregel nicht erfuellen (z. B. Torwart, Tor oder Vorlage): out = {Spieler-ID: Grund}.
 const chk=condChecker(token,day,conds),bad=new Set();
 if(chk){value.out={};for(const id of ids){const r=await chk(id);if(!r.ok){value.out[id]=r.why;if(r.ok===false)bad.add(id);}}}
 // Wertungen mit MVP brauchen den MVP-Zwischenstand aller Bundesliga-Spieler: teuer, darum hoechstens alle 30 Minuten (gespeichert in kbl-mvp-tipps.json).
 // Die Top 10 (Kevin-Wunsch) brauchen ihn bei jeder Wertung.
 if(!finished){
  let lm=readTipps()[day]?.liveMvp;
  if(!lm||!lm.top10||Date.now()-Date.parse(lm.at)>30*60e3||String(lm.pool||[])!==String(pool)||String(lm.conds||[])!==String(conds)){
   const m=await loadMatchdayMvp(token,day,{live:true}),ct=chk?await condTop(m.all,pool,chk,10):null,best=ct?ct.list.filter(p=>p.points===ct.list[0].points):poolMvp(m,pool);
   lm={at:new Date().toISOString(),points:best.length?best[0].points:null,players:best.map(p=>({id:String(p.id),name:p.name,team:p.team})),top10:ct?poolTop(ct.list,[]):poolTop(m.all,pool),checked:m.playersChecked,failed:m.failedPlayers,reliable:m.reliable&&!ct?.unsure,...(pool.length?{pool}:{}),...(conds.length?{conds}:{})};
   const all=readTipps();(all[day]||(all[day]={tips:{}})).liveMvp=lm;saveTipps(all);
  }
  if(TIPP_MVP_KINDS.has(kind))value.mvp=freshBest(lm,tips,players,pool,bad);
  value.top10={at:lm.at,reliable:lm.reliable,players:freshTop(lm.top10,tips,players,pool,bad)};
 }else{
  try{const m=await loadMatchdayMvp(token,day),ct=chk?await condTop(m.all,pool,chk,10):null;value.top10={reliable:m.reliable&&!ct?.unsure,players:ct?poolTop(ct.list,[]):poolTop(m.all,pool)};}catch{}
 }
 tippTrackCache.set(day,{at:Date.now(),key,value});
 return value;
}
// Zeitraffer im MVP-Tipp (Kevin-Wunsch): jeder neue Stand der getippten Spieler wird je Spieltag in kbl-mvp-verlauf.json angehaengt
// (nur bei Aenderung, auch nach Spielende, so sieht man spaetere Kickbase-Korrekturen). Gehoert GitHub (Export alle 5 Min.), nie vom PC hochladen.
// Bild je Stand: p = {Spieler-ID: [Punkte, Status d/l/o]}, mvp = Bester nach der Tippregel, fin = Wert nach Spieltagsende (Leistungsdaten).
const VERLAUF_FILE=path.join(process.cwd(),'kbl-mvp-verlauf.json');
function readVerlauf(){try{return JSON.parse(fs.readFileSync(VERLAUF_FILE,'utf8'));}catch{return {};}}
function recordVerlauf(day,tracking,result,finished){
 if(!tracking?.players)return;
 const p={};for(const [id,x] of Object.entries(tracking.players))if(x&&x.points!==null&&x.points!==undefined)p[id]=[x.points,(x.state||'?')[0]];
 if(!Object.keys(p).length)return;
 const m=finished?result?.mvp:tracking.mvp;
 // t = Top 10 laut Tippregel ohne die getippten Spieler (Kevin: der spaetere MVP soll im Zeitraffer von Anfang an mitlaufen).
 const t={};for(const x of tracking.top10?.players||[])if(!(String(x.id) in p)&&Number.isFinite(x.points))t[String(x.id)]=[x.points];
 const frame={at:tracking.updatedAt||new Date().toISOString(),p,...(Object.keys(t).length?{t}:{}),...(m?.players?.length&&Number.isFinite(m.points)?{mvp:{points:m.points,players:m.players.map(({id,name,team})=>({id:String(id),name,team}))}}:{}),...(finished?{fin:true}:{})};
 const all=readVerlauf(),list=(all[day]||(all[day]=[])),last=list[list.length-1];
 const sig=f=>JSON.stringify([f.p,f.t||null,f.mvp?.points??null,(f.mvp?.players||[]).map(x=>x.id),!!f.fin]);
 if(last&&(sig(last)===sig(frame)||Date.parse(frame.at)<=Date.parse(last.at)))return;
 list.push(frame);
 try{const tmp=VERLAUF_FILE+'.tmp';fs.writeFileSync(tmp,JSON.stringify(all));fs.renameSync(tmp,VERLAUF_FILE);}catch{}
}
// Vorschlag nach Spieltagsende. Gleichstand: alle gewinnen. Fehlt etwas, wird nichts geraten.
async function tippResult(token,day,rule,rows){
 if(!rule)return {status:'missing',message:'Das fehlt: Für diesen Spieltag wurde keine Tippregel eingetragen.',rows:[],winners:[]};
 if(!rows.length)return {status:'empty',message:'An diesem Spieltag hat niemand getippt.',rows:[],winners:[]};
 const m=await loadMatchdayMvp(token,day),kind=tippKind(rule),pool=await tippPool(token,rule),conds=tippConds(rule),chk=condChecker(token,day,conds);
 const cb=chk?await condTop(m.all,pool,chk,1):null,mvp={...m,players:cb?cb.list:poolMvp(m,pool),reliable:m.reliable&&!cb?.unsure};
 // Ohne eingestellte Wertung: nur den MVP zeigen, Gewinner bestimmt die Liga selbst.
 if(!kind||kind==='keine')return {status:'manual',message:kind?'Den Gewinner bestimmt ihr nach eurer Tippregel selbst.':'Für diese Tippregel ist keine Wertung eingestellt. Den Gewinner bestimmt ihr selbst.',rows:[],winners:[],
  ...(mvp.players.length?{mvp:{players:mvp.players.map(p=>({id:String(p.id),name:p.name,team:p.team})),points:mvp.players[0].points}}:{})};
 if(!mvp.players.length&&TIPP_MVP_KINDS.has(kind))return {status:'missing',message:'Das fehlt: Der MVP des Spieltags ist noch nicht bekannt.',rows:[],winners:[]};
 const ids=new Set(mvp.players.map(p=>String(p.id))),top=mvp.players.length?mvp.players[0].points:null;
 const out=[];let missing=0;
 for(const r of rows){
  const hit=ids.has(String(r.playerId));let actual=top,diff=null,ok=true;
  if(kind==='prognose'||kind==='spieler'){actual=await tippPlayerPoints(token,r.playerId,day);if(actual===null){missing++;ok=false;}}
  if(actual!==null)diff=Math.abs(r.points-actual);
  if(['volltreffer','name','drunter','korridor'].includes(kind)&&!hit){ok=false;diff=null;}
  if(kind==='drunter'&&r.points>top)ok=false;
  if(kind==='korridor'&&ok&&diff>TIPP_KORRIDOR)ok=false;
  let allowed=!pool.length||pool.includes(r.team),why='';
  if(allowed&&chk){const c=await chk(r.playerId);if(!c.ok){allowed=false;why=c.why;}}
  if(!allowed)ok=false;
  out.push({managerId:r.managerId,hit,actual,diff,eligible:ok,...(allowed?{}:{allowed:false}),...(why?{why}:{})});
 }
 const el=out.filter(r=>r.eligible);
 let winners=[];
 if(kind==='name'||kind==='korridor')winners=el.map(r=>r.managerId);
 else if(kind==='spieler'&&el.length){const hi=Math.max(...el.map(r=>r.actual)),b=el.filter(r=>r.actual===hi),best=Math.min(...b.map(r=>r.diff));winners=b.filter(r=>r.diff===best).map(r=>r.managerId);}
 else if(el.length){const best=Math.min(...el.map(r=>r.diff));winners=el.filter(r=>r.diff===best).map(r=>r.managerId);}
 const unsure=!mvp.reliable||missing>0;
 const best=await tippBest(token,day,kind,top,pool,rows,out,winners);
 return {status:unsure?'unsure':'ok',kind,...(pool.length?{pool}:{}),...(conds.length?{conds}:{}),...(mvp.players.length?{mvp:{players:mvp.players.map(p=>({id:String(p.id),name:p.name,team:p.team})),points:top}}:{}),rows:out,winners,...(best?{best}:{}),
  message:missing?`Das fehlt: Für ${missing} getippte Spieler gibt es noch keine Spieltagspunkte.`:!mvp.reliable?'Nicht alle Spielerdaten waren abrufbar, der MVP ist unsicher.':''};
}
// Bester Tipper des Spieltags (Kevin-Vorgabe): Er bestimmt die Tippregel des naechsten Spieltags, auch wenn niemand gewonnen hat.
// Gibt es Gewinner, ist es der Gewinner mit dem kleinsten Abstand. Sonst zaehlt (nur Spieler der genannten Vereine, falls die Regel welche nennt):
// meiste Punkte des getippten Spielers, dann kleinster Abstand zur Zahl (bei MVP-Wertungen zur MVP-Punktzahl). Gleichstand = alle.
async function tippBest(token,day,kind,top,pool,rows,out,winners){
 let cand=out.filter(r=>winners.includes(r.managerId)),how='winner';
 if(!cand.length){
  how='closest';
  const tipOf=new Map(rows.map(r=>[r.managerId,r])),inPool=out.filter(r=>r.allowed!==false&&(!pool.length||pool.includes(tipOf.get(r.managerId)?.team)));
  cand=[];
  for(const r of inPool){const t=tipOf.get(r.managerId),own=await tippPlayerPoints(token,t.playerId,day);
   if(own===null)return null;// Punkte fehlen: nie raten
   const ref=TIPP_MVP_KINDS.has(kind)&&top!==null?top:own;cand.push({managerId:r.managerId,own,diff:Math.abs(t.points-ref)});}
  if(!cand.length)return null;
  const hi=Math.max(...cand.map(r=>r.own));cand=cand.filter(r=>r.own===hi);
 }
 const d=cand.map(r=>r.diff).filter(Number.isFinite),lo=d.length?Math.min(...d):null;
 if(lo!==null)cand=cand.filter(r=>r.diff===lo);
 return {how,managers:cand.map(r=>r.managerId)};
}
// Spielerfotos: Ohne Kickbase-Abo liefert Kickbase nur Silhouetten (Kevin, T1000 hat kein Abo). Darum die Bildpfade
// mit dem Challenge-Konto (T800, mit Abo) holen, falls eingerichtet, und in kbl-player-photos.json sichern.
// Auf GitHub wird nur diese Datei gelesen (keine T800-Anmeldung von dort, siehe getChallengeToken).
const PHOTO_FILE=path.join(process.cwd(),'kbl-player-photos.json');
let photoCache=null;
function readPhotoFile(){try{const j=JSON.parse(fs.readFileSync(PHOTO_FILE,'utf8'));const m=new Map(Object.entries(j.photos||{}));return m.size?m:null;}catch{return null;}}
async function playerPhotos(){
 if(photoCache&&Date.now()-photoCache.at<6*3600*1000)return photoCache.map;
 if(ON_GITHUB||!process.env.KBL_CHALLENGE_EMAIL||!process.env.KBL_CHALLENGE_PASSWORD){const m=readPhotoFile();if(m)photoCache={at:Date.now(),map:m};return m;}
 const token=await getChallengeToken();
 const table=await kbFetch('/v4/competitions/1/table',{token});
 const teams=extractEntities(table,['ti','tid','i','id'],['tn','n','name']);
 const map=new Map();
 for(const t of teams?.items||[]){
  try{const prof=await kbFetch(`/v4/competitions/1/teams/${t.id}/teamprofile`,{token});const pl=extractEntities(prof,['pi','i','id'],['pn','n','ln','name']);
   if(pl)for(const [id,img] of imagesById(prof,pl.idKey))map.set(id,img);}catch{}
 }
 if(map.size){photoCache={at:Date.now(),map};try{fs.writeFileSync(PHOTO_FILE,JSON.stringify({updatedAt:new Date().toISOString(),photos:Object.fromEntries(map)},null,1));}catch{}}
 return map;
}
// Wackelköpfe (Kevin-Wunsch: nur der Kopf, ohne Kreis und ohne Schulteransatz). Das freigestellte Kickbase-Brustbild
// wird hier auf dem Server zugeschnitten, weil der Browser fremde Bilder wegen CORS nicht auslesen darf.
// PNG lesen/schreiben: tools/png.mjs (ohne Zusatzpaket).
// Kopf finden: Breite je Zeile (zusammenhängend um die Kopfmitte). Von oben wird der Kopf breiter, am Hals schmaler,
// darunter kommen die Schultern. Schnitt an der schmalsten Stelle des Halses; alles außerhalb des Kopfes wird durchsichtig.
const HEAD_VERSION=4;
function cropHead(buf,jaw){
 const img=pngDecode(buf);if(!img)return null;const {w,h,data}=img,A=(x,y)=>data[(y*w+x)*4+3]>100;
 let top=-1;for(let y=0;y<h&&top<0;y++)for(let x=0;x<w;x++)if(A(x,y)){top=y;break;}
 if(top<0)return null;
 let cnt=0;for(let x=0;x<w;x++)if(A(x,top))cnt++;if(cnt>w*.6)return null;// kein freigestelltes Bild
 // Kopfmitte aus den obersten Zeilen
 let sx=0,n=0;for(let y=top;y<Math.min(h,top+Math.round(h*.08));y++)for(let x=0;x<w;x++)if(A(x,y)){sx+=x;n++;}
 let cx=Math.round(sx/n);
 const L=[],R=[];
 for(let y=top;y<h;y++){let x0=cx;while(x0<w&&!A(x0,y)&&x0-cx<4)x0++;if(!A(x0,y)){L[y]=R[y]=-1;continue;}
  let l=x0,r=x0,gap=0;for(let x=x0-1;x>=0;x--){if(A(x,y)){l=x;gap=0;}else if(++gap>3)break;}
  gap=0;for(let x=x0+1;x<w;x++){if(A(x,y)){r=x;gap=0;}else if(++gap>3)break;}
  L[y]=l;R[y]=r;if(y<top+h*.3)cx=Math.round((l+r)/2);}
 const W=y=>L[y]<0?0:R[y]-L[y]+1;
 // Mit Kinnlinie (17 Gesichtspunkte von Ohr zu Ohr, tools/kinn-linien.mjs): alles unterhalb der Kinnlinie fällt weg,
 // so endet der Kopf genau am echten Kinn (Kevin: kein Hals, kein Doppelkinn).
 if(Array.isArray(jaw)&&jaw.length===17){
  const fw=jaw[16][0]-jaw[0][0],m=Math.max(2,Math.round(fw*.025));if(fw<20)return null;
  // Neben dem Gesicht (Ohren) bis auf Höhe von Punkt 2 bzw. 14, damit die Ohrläppchen nicht gerade abgeschnitten werden.
  const lim=x=>{if(x<=jaw[0][0])return jaw[2][1]+m;if(x>=jaw[16][0])return jaw[14][1]+m;
   for(let i=0;i<16;i++){const [x1,y1]=jaw[i],[x2,y2]=jaw[i+1];if(x>=x1&&x<=x2)return (x2===x1?Math.max(y1,y2):y1+(y2-y1)*(x-x1)/(x2-x1))+m;}return jaw[8][1]+m;};
  const bottom=Math.min(h,Math.ceil(Math.max(...jaw.map(p=>p[1]))+m+2));
  let l=w,r=0;for(let y=top;y<bottom;y++)if(L[y]>=0)for(let x=L[y];x<=R[y];x++)if(y<=lim(x)){l=Math.min(l,x);r=Math.max(r,x);}
  const ow=r-l+1,oh=bottom-top;if(ow<8||oh<8||oh>ow*2.2)return null;
  const out=Buffer.alloc(ow*oh*4);
  for(let y=0;y<oh;y++){const yy=top+y;if(L[yy]<0)continue;
   for(let x=0;x<ow;x++){const xx=l+x;if(xx<L[yy]||xx>R[yy])continue;const edge=Math.max(0,Math.min(1,(lim(xx)-yy)/2));if(!edge)continue;
    const s=(yy*w+xx)*4,q=(y*ow+x)*4;data.copy(out,q,s,s+4);out[q+3]=Math.round(out[q+3]*edge);}}
  return pngEncode(ow,oh,out);
 }
 // Schultern: erste Zeile, die mehr als halb so breit ist wie das Bild unten (Kickbase-Fotos sind alle gleich aufgebaut).
 // Hals: schmalste Zeile in der unteren Hälfte zwischen Kopfoberkante und Schultern. Kopfbreite: breiteste Zeile darüber.
 const Wb=Math.max(...Array.from({length:Math.min(20,h-top)},(_,i)=>W(h-1-i)));
 let S=top;while(S<h&&W(S)<=Wb*.55)S++;
 let neck=-1,nw=1e9;for(let y=top+Math.round((S-top)/2);y<S;y++){const v=W(y);if(v>0&&v<nw){nw=v;neck=y;}}
 let peak=0;for(let y=top;y<neck;y++)peak=Math.max(peak,W(y));
 if(S>=h||neck<0||peak<8||nw>peak*.85)return null;// kein Hals erkennbar: lieber kein Foto
 // Von vorn ist das Kinn etwa so breit wie der Hals: Schnitt erst dort, wo der Kragen beginnt (Breite wächst wieder),
 // dann ein Stück darüber, damit kein Stoff mitkommt.
 let cut=neck;while(cut+1<h&&W(cut+1)<=nw*1.08)cut++;
 neck=Math.max(top+1,cut-Math.round(peak*.04));
 const bottom=neck;let l=w,r=0;for(let y=top;y<bottom;y++)if(L[y]>=0){l=Math.min(l,L[y]);r=Math.max(r,R[y]);}
 const ow=r-l+1,oh=bottom-top;if(ow<8||oh<peak*.9||oh>peak*2)return null;// unplausibel: lieber kein Foto
 const out=Buffer.alloc(ow*oh*4);
 // Keine geraden Halsränder (Kevin): unten läuft der Kopf in einem U zusammen wie ein Kinn. Im unteren Viertel nur, was in
 // einer Halbellipse um die Halsmitte liegt (von Halsbreite auf ein Drittel), weicher Rand, ganz unten kurz ausblenden.
 const nc=(L[bottom-1]+R[bottom-1])/2-l,Rr=Math.round(oh*.25),half=Math.max(nw,W(top+oh-Rr))/2+1;
 for(let y=0;y<oh;y++){const yy=top+y,fade=Math.min(1,(oh-y)/Math.max(2,oh*.03));
  const t=(y-(oh-Rr))/Rr,hw=t>0?half*(.35+.65*Math.sqrt(Math.max(0,1-t*t))):1e9;
  for(let x=0;x<ow;x++){const xx=l+x;if(L[yy]<0||xx<L[yy]||xx>R[yy])continue;const s=(yy*w+xx)*4,q=(y*ow+x)*4;
   const edge=Math.max(0,Math.min(1,(hw-Math.abs(x+.5-nc))/2));if(!edge)continue;
   data.copy(out,q,s,s+4);out[q+3]=Math.round(out[q+3]*fade*edge);}}
 return pngEncode(ow,oh,out);
}
// Kinnlinien je Spieler (von tools/kinn-linien.mjs berechnet, nur gültig für genau dieses Foto).
let jawFile=null;
function headJaw(id,src){
 if(!jawFile||Date.now()-jawFile.at>60e3){try{jawFile={at:Date.now(),data:JSON.parse(fs.readFileSync(path.join(process.cwd(),'kbl-head-landmarks.json'),'utf8')).players||{}};}catch{jawFile={at:Date.now(),data:{}};}}
 const e=jawFile.data[String(id)];return e&&e.img===src?e.jaw:null;
}
const headCache=new Map();
async function headImage(id,orig,token){
 const k=(orig?'o':'h')+id;if(headCache.has(k))return headCache.get(k);
 const photos=await playerPhotos().catch(()=>null);
 let src=photos?.get(String(id));
 if(!src&&token){const all=await loadAllPlayers(token).catch(()=>null);src=all?.players.get(String(id))?.img||all?.players.get(Number(id))?.img;}
 if(!src)return null;
 const url=/^https?:\/\//.test(src)?src:'https://kickbase.b-cdn.net/'+String(src).replace(/^\//,'');
 const r=await fetch(url,{signal:AbortSignal.timeout(15000)});if(!r.ok)return null;
 const buf=Buffer.from(await r.arrayBuffer());
 let v=orig?buf:null;if(!orig){try{v=cropHead(buf,headJaw(id,src));}catch{v=null;}}
 if(headCache.size>800)headCache.clear();headCache.set(k,v);return v;
}
app.get('/api/mvp-tipps/head/:id',async(req,res)=>{
 const id=String(req.params.id||'').replace(/\.png$/,'');if(!/^\d{1,9}$/.test(id))return res.status(400).end();
 try{const v=await headImage(id,req.query.orig==='1',await tippToken(req));if(!v)return res.status(404).end();
  res.set({'Content-Type':'image/png','Cache-Control':'public, max-age=86400','X-Head-Version':String(HEAD_VERSION)}).send(v);}
 catch{res.status(502).end();}
});
// Manager-Profilbild über den eigenen Server (für das Zeitraffer-Video: das Kickbase-CDN erlaubt kein CORS, Bilder fremder Server darf die Leinwand nicht aufnehmen).
const mgrImgCache=new Map();
app.get('/api/mgr-img',async(req,res)=>{
 const p=String(req.query.p||'');if(!/^user\/[\w.-]{1,80}$/.test(p))return res.status(400).end();
 try{let v=mgrImgCache.get(p);
  if(!v){const r=await fetch('https://kickbase.b-cdn.net/'+p,{signal:AbortSignal.timeout(15000)});if(!r.ok)return res.status(404).end();
   v={type:r.headers.get('content-type')||'image/jpeg',buf:Buffer.from(await r.arrayBuffer())};if(mgrImgCache.size>200)mgrImgCache.clear();mgrImgCache.set(p,v);}
  res.set({'Content-Type':v.type,'Cache-Control':'public, max-age=86400'}).send(v.buf);}
 catch{res.status(502).end();}
});
app.get('/api/mvp-tipps/players',async(req,res)=>{
 const token=await tippToken(req);if(!token)return res.status(503).json({error:'Kein Kickbase-Zugang auf dem Server.'});
 try{const all=await loadAllPlayers(token);
  const photos=await playerPhotos().catch(e=>{console.log('Spielerfotos (Challenge-Konto) nicht abrufbar:',e.message);return null;});
  if(photos){let diff=0;for(const [id,p] of all.players)if(photos.get(String(id))&&photos.get(String(id))!==p.img)diff++;console.log(`Spielerfotos ueber Challenge-Konto: ${photos.size}, davon ${diff} anders als beim Dienst-Login`);}
  res.set('Cache-Control','no-store').json({players:[...all.players.entries()].map(([id,p])=>{const img=photos?.get(String(id))||p.img;return {id:String(id),name:p.name,team:p.team,...(img?{img}:{}),...(p.teamImg?{teamImg:p.teamImg}:{}),...(p.pos?{pos:p.pos}:{})};}).sort((a,b)=>a.name.localeCompare(b.name,'de')),failedTeams:all.failedTeams});
 }catch(e){res.status(502).json({error:'Spielerliste nicht abrufbar: '+e.message});}
});
app.get('/api/mvp-tipps',async(req,res)=>{
 try{const md=await tippMatchdays(),all=readTipps();
  const next=md.days.find(x=>x.status==='upcoming')?.day||null;
  const days=md.days.filter(d=>d.status!=='upcoming'||d.day===next).map(d=>({day:d.day,status:d.status,tips:Object.keys(all[d.day]?.tips||{}).length}));
  // Managerliste: braucht auch der Online-Tippdienst (tools/tipp-dienst), er liest sie aus der exportierten Datei.
  const token=await tippToken(req),managers=token?await tippManagers(token).catch(()=>null):null;
  const teams=token?await loadAllPlayers(token).then(a=>[...new Set([...a.players.values()].map(p=>p.team))].sort()).catch(()=>null):null;
  res.set('Cache-Control','no-store').json({next,days,rules:TIPP_RULES,wertungen:TIPP_WERTUNG,...(managers?{managers}:{}),...(teams?{teams}:{})});
 }catch(e){res.status(503).json({error:'Spielplan nicht abrufbar: '+e.message});}
});
app.get('/api/mvp-tipps/:day',async(req,res)=>{
 const token=await tippToken(req),day=validDay(req.params.day);
 if(!token)return res.status(503).json({error:'Kein Kickbase-Zugang auf dem Server.'});
 if(!day)return res.status(400).json({error:'Ungültiger Spieltag.'});
 try{const md=await tippMatchdays(),st=tippState(md,day),managers=await tippManagers(token),codes=readTippCodes();
  const rec=readTipps()[day]||{},tips=rec.tips||{},me=TIPP_EXPORT?null:currentSession(req)?.userId||null,rule=tippRule(rec);
  const reveal=st.locked&&st.status!=='upcoming';
  const list=managers.map(m=>{const t=tips[m.id];return {id:m.id,name:m.name,tipped:!!t,hasCode:!!codes[m.id],...(t&&(reveal||m.id===me)?{tip:{playerId:t.playerId,player:t.player,team:t.team,points:t.points,updatedAt:t.updatedAt,...(t.late?{late:true}:{})}}:{})};});
  let result=null;
  if(st.status==='finished'){const rows=managers.filter(m=>tips[m.id]).map(m=>({managerId:m.id,...tips[m.id]}));
   try{result=await tippResult(token,day,rule,rows);}catch(e){result={status:'missing',message:'Das fehlt: Auswertung nicht möglich ('+e.message+').',rows:[],winners:[]};}}
  let tracking=null;
  if(reveal&&Object.keys(tips).length)try{tracking=await tippTracking(token,day,tips,st.status==='finished',tippKind(rule),await tippPool(token,rule),tippConds(rule));}catch{}
  if(tracking)recordVerlauf(day,tracking,result,st.status==='finished');
  const verlauf=reveal?readVerlauf()[day]||[]:[];
  res.set('Cache-Control','no-store').json({day,...st,reveal,rule,rules:TIPP_RULES,wertungen:TIPP_WERTUNG,korridor:TIPP_KORRIDOR,managers:list,
   me:managers.some(m=>m.id===me)?me:null,admin:!TIPP_EXPORT&&isAdmin(req),result,tracking,verlauf});
 }catch(e){res.status(502).json({error:e.message});}
});
app.put('/api/mvp-tipps/:day',async(req,res)=>{
 const s=currentSession(req),day=validDay(req.params.day);
 if(!day)return res.status(400).json({error:'Ungültiger Spieltag.'});
 const playerId=String(req.body?.playerId||''),points=Number(req.body?.points);
 if(!/^\d{1,10}$/.test(playerId)||!Number.isInteger(points)||points<-1000||points>2000)return res.status(400).json({error:'Bitte einen Spieler aus der Liste und eine ganze Punktzahl angeben.'});
 try{const md=await tippMatchdays(),st=tippState(md,day);
  if(!st.open)return res.status(409).json({error:st.locked?'Der Spieltag ist angepfiffen, Tipps sind gesperrt.':'Getippt wird nur auf den nächsten Spieltag.'});
  const token=await tippToken(req);if(!token)return res.status(503).json({error:'Kein Kickbase-Zugang auf dem Server.'});
  const managers=await tippManagers(token);
  // Angemeldet als Manager: kein Code noetig. Sonst Name + eigener Tipp-Code.
  let me=s?.userId?managers.find(m=>m.id===String(s.userId)):null,created=false;
  if(!me){
   me=managers.find(m=>m.id===String(req.body?.managerId||''));
   if(!me)return res.status(400).json({error:'Bitte deinen Namen aus der Liste wählen.'});
   const c=checkTippCode(me.id,req.body?.code,true);if(!c.ok)return res.status(c.status).json({error:c.error});created=!!c.created;
  }
  const player=(await loadAllPlayers(token)).players.get(playerId);
  if(!player)return res.status(400).json({error:'Spieler nicht gefunden.'});
  const all=readTipps(),rec=all[day]||(all[day]={tips:{}});rec.tips=rec.tips||{};
  rec.tips[me.id]={name:me.name,playerId,player:player.name,team:player.team,points,updatedAt:new Date().toISOString()};
  saveTipps(all);
  res.set('Cache-Control','no-store').json({ok:true,codeCreated:created,tip:rec.tips[me.id]});
 }catch(e){res.status(502).json({error:e.message});}
});
// Eigenen Tipp mit Code ansehen (vor dem Anpfiff sonst verdeckt).
app.post('/api/mvp-tipps/:day/mine',async(req,res)=>{
 const day=validDay(req.params.day),id=String(req.body?.managerId||'');
 if(!day||!validManager(id))return res.status(400).json({error:'Ungültige Angaben.'});
 const c=checkTippCode(id,req.body?.code,false);if(!c.ok)return res.status(c.status).json({error:c.error});
 res.set('Cache-Control','no-store').json({ok:true,tip:readTipps()[day]?.tips?.[id]||null});
});
app.delete('/api/mvp-tipps/codes/:id',(req,res)=>{
 if(!isAdmin(req)||!getToken(req))return res.status(403).json({error:'Nur der Liga-Admin kann Codes zurücksetzen.'});
 const id=String(req.params.id);if(!validManager(id))return res.status(400).json({error:'Ungültiger Manager.'});
 const all=readTippCodes();delete all[id];saveTippCodes(all);tippCodeFails.delete(id);
 res.set('Cache-Control','no-store').json({ok:true});
});
app.put('/api/mvp-tipps/:day/rule',async(req,res)=>{
 const day=validDay(req.params.day);
 if(!getToken(req))return res.status(401).json({error:'Nicht angemeldet.'});
 if(!isAdmin(req))return res.status(403).json({error:'Nur der Liga-Admin kann die Tippregel ändern.'});
 if(!day)return res.status(400).json({error:'Ungültiger Spieltag.'});
 const id=String(req.body?.ruleId||''),text=String(req.body?.text||'').trim();
 const base=TIPP_RULES.find(r=>r.id===id);
 if(!base&&!(id==='eigene'&&text&&text.length<=500))return res.status(400).json({error:'Bitte eine Tippregel wählen oder eine eigene eintragen.'});
 try{const st=tippState(await tippMatchdays(),day);
  if(st.locked)return res.status(409).json({error:'Der Spieltag ist angepfiffen, die Tippregel steht fest.'});
  // Wer die Regel an diesem Spieltag bestimmt hat (wechselt jeden Spieltag), optional.
  const by=req.body?.byId?(await tippManagers(getToken(req))).find(m=>m.id===String(req.body.byId)):null;
  if(req.body?.byId&&!by)return res.status(400).json({error:'Unbekannter Manager.'});
  const wertung=req.body?.wertung?String(req.body.wertung):'';
  if(wertung&&!TIPP_WERTUNG.some(w=>w.id===wertung))return res.status(400).json({error:'Unbekannte Wertung.'});
  const all=readTipps(),rec=all[day]||(all[day]={tips:{}});
  rec.rule={...(base?{...base}:{id:'eigene',title:'Eigene Regel',text}),...(by?{by:{id:by.id,name:by.name}}:{}),...(wertung?{wertung}:{})};
  rec.ruleUpdatedAt=new Date().toISOString();saveTipps(all);
  res.set('Cache-Control','no-store').json({ok:true,rule:rec.rule});
 }catch(e){res.status(502).json({error:e.message});}
});
// Wertung der Tippregel (nur Admin), auch nach dem Anpfiff: Der Regeltext bleibt, nur die Auswertung wird eingestellt.
app.put('/api/mvp-tipps/:day/wertung',(req,res)=>{
 const day=validDay(req.params.day);
 if(!getToken(req))return res.status(401).json({error:'Nicht angemeldet.'});
 if(!isAdmin(req))return res.status(403).json({error:'Nur der Liga-Admin kann die Wertung einstellen.'});
 if(!day)return res.status(400).json({error:'Ungültiger Spieltag.'});
 // Leer = automatisch aus dem Regeltext.
 const wertung=String(req.body?.wertung||'');
 if(wertung&&!TIPP_WERTUNG.some(w=>w.id===wertung))return res.status(400).json({error:'Unbekannte Wertung.'});
 const all=readTipps(),rec=all[day];
 if(!rec?.rule)return res.status(409).json({error:'Bitte zuerst die Tippregel eintragen.'});
 const {wertung:_old,...base}=rec.rule;rec.rule={...base,...(wertung?{wertung}:{})};saveTipps(all);tippTrackCache.delete(day);
 res.set('Cache-Control','no-store').json({ok:true,rule:rec.rule});
});
// Tipp nachtragen (nur Admin, erst nach dem Anpfiff), z. B. wenn ein Manager im Chat getippt hat.
// Nur fuer Manager ohne eigenen Tipp; ein eigener Tipp wird nie ueberschrieben, ein nachgetragener darf korrigiert werden.
app.put('/api/mvp-tipps/:day/nachtrag',async(req,res)=>{
 const day=validDay(req.params.day),token=getToken(req);
 if(!token)return res.status(401).json({error:'Nicht angemeldet.'});
 if(!isAdmin(req))return res.status(403).json({error:'Nur der Liga-Admin kann Tipps nachtragen.'});
 if(!day)return res.status(400).json({error:'Ungültiger Spieltag.'});
 const id=String(req.body?.managerId||''),playerId=String(req.body?.playerId||''),points=Number(req.body?.points);
 if(!/^\d{1,10}$/.test(playerId)||!Number.isInteger(points)||points<-1000||points>2000)return res.status(400).json({error:'Bitte einen Spieler aus der Liste und eine ganze Punktzahl angeben.'});
 try{const st=tippState(await tippMatchdays(),day);
  if(!st.locked||st.status==='upcoming')return res.status(409).json({error:'Nachtragen geht erst nach dem Anpfiff. Bis dahin tippt jeder selbst.'});
  const me=(await tippManagers(token)).find(m=>m.id===id);
  if(!me)return res.status(400).json({error:'Bitte einen Manager aus der Liste wählen.'});
  const all=readTipps(),rec=all[day]||(all[day]={tips:{}});rec.tips=rec.tips||{};
  if(rec.tips[id]&&!rec.tips[id].late)return res.status(409).json({error:`${me.name} hat selbst getippt. Ein eigener Tipp wird nicht überschrieben.`});
  const player=(await loadAllPlayers(token)).players.get(playerId);
  if(!player)return res.status(400).json({error:'Spieler nicht gefunden.'});
  rec.tips[id]={name:me.name,playerId,player:player.name,team:player.team,points,late:true,updatedAt:new Date().toISOString()};
  saveTipps(all);tippTrackCache.delete(day);
  res.set('Cache-Control','no-store').json({ok:true,tip:rec.tips[id]});
 }catch(e){res.status(502).json({error:e.message});}
});
async function finishedMatchday(day) {
  return (await loadMatchdays()).days.find(d => d.day === day)?.status === 'finished';
}

// ---- Automatische Erkennung fuer RK, BN, UM (nur aufgestellte Spieler; Marktwert wird noch nicht beruecksichtigt) ----
// Ereignisse in playercenter: pro Spieler/Minute werden die Punkte je Ereignisnummer aufsummiert.
// Summe 0 = Ereignis wurde zurueckgenommen (z. B. Videobeweis) und zaehlt nicht.
// Verschossener Elfmeter hat bei Kickbase zwei Nummern (beide -60): 4051 vorbei/Latte (Futkeu, ST 6) und 4054 vermutlich gehalten (Petkov, ST 6, Nachschuss verwandelt).
// 4048 traegt in der Kickbase-Stammliste (/v4/live/eventtypes) ebenfalls „Penalty missed“ und zaehlt darum mit.
const ETI_PEN_MISSED_SET = new Set([4048, 4051, 4054]), ETI_PEN_CAUSED = 4171, ETI_PEN_WON = 4177;
function netEvents(center) {
  const map = new Map(); // "eti@minute" -> { eti, minute, net }
  for (const e of Array.isArray(center?.events) ? center.events : []) {
    // Minute kann als Zahl oder Text kommen (z. B. "3" oder "45+2"); fehlt sie, zaehlt das Ereignis trotzdem (Minute -1).
    const eti = Number(e.eti), pt = Number(e.p), parsed = parseInt(String(e.mt ?? ''), 10), minute = Number.isFinite(parsed) ? parsed : -1;
    if (!Number.isFinite(eti) || !Number.isFinite(pt)) continue;
    const key = eti + '@' + minute;
    if (!map.has(key)) map.set(key, { eti, minute, net: 0 });
    map.get(key).net += pt;
  }
  return [...map.values()].filter(x => x.net !== 0);
}
// Einzelne Gelbe Karten eines Spieltags (Kevin 28.10.): Die Gelbe vor einer Gelb-Roten zaehlt nicht zur Gelbsperre.
// Steht sie bei Kickbase als eigene 4 neben der 5, wird sie abgezogen; steht nur die 5 da, aendert sich nichts.
function singleYellows(k) { const a = Array.isArray(k) ? k.map(Number) : [], y = a.filter(c => c === 4).length; return y - Math.min(y, a.filter(c => c === 5).length); }
function seasonYellowCards(perfData, day) {
  let before = 0, upTo = 0;
  for (const rec of seasonEntries(perfData, CURRENT_SEASON)) {
    const d = Number(rec.day);
    if (!Number.isFinite(d) || d > day || !Array.isArray(rec.k)) continue;
    const n = singleYellows(rec.k);
    upTo += n; if (d < day) before += n;
  }
  return { before, upTo };
}
// Reine Funktion: Ereignisse eines Spielers an einem Spieltag.
function classifyPlayerDay(center, perfData, day) {
  const record = findDayRecord(perfData, day);
  const codes = new Set([...(Array.isArray(center?.k) ? center.k : []), ...(Array.isArray(record?.k) ? record.k : [])]);
  const nets = netEvents(center);
  const yellows = seasonYellowCards(perfData, day);
  const out = { ownGoal: codes.has(2), penMissed: nets.filter(x => ETI_PEN_MISSED_SET.has(x.eti) && x.net < 0).map(x => x.minute),
    penCaused: nets.filter(x => x.eti === ETI_PEN_CAUSED && x.net < 0).map(x => x.minute),
    red: codes.has(6), yellowRed: codes.has(5), yellowsBefore: yellows.before, yellowsTotal: yellows.upTo };
  // Sperre bei jeder 5. Gelben Karte (5, 10, 15 ...): neu, wenn dieser Spieltag eine Fuenferschwelle ueberschreitet.
  out.yellowBan = Math.floor(yellows.upTo / 5) > Math.floor(yellows.before / 5) ? Math.floor(yellows.upTo / 5) * 5 : null;
  return out;
}
async function detectAutoEvents({ token, day, lineupPlayers, ownerOf, getCenter: sharedGetCenter }) {
  // lineupPlayers: [{ managerId, manager, playerId, playerName, perf }]
  const actions = [], unclear = [], failures = [];
  const centers = new Map();
  const getCenter = sharedGetCenter || (async id => {
    if (centers.has(id)) return centers.get(id);
    const data = await kbFetch(`/v4/competitions/1/playercenter/${id}?dayNumber=${day}`, { token });
    centers.set(id, data); return data;
  });
  const infos = [];
  for (let i = 0; i < lineupPlayers.length; i += 5) {
    await Promise.all(lineupPlayers.slice(i, i + 5).map(async lp => {
      try { infos.push({ lp, center: await getCenter(lp.playerId), info: null }); }
      catch (e) { failures.push({ playerId: lp.playerId, error: `HTTP ${e.status || 502}` }); }
    }));
  }
  for (const it of infos) it.info = classifyPlayerDay(it.center, it.lp.perf, day);
  const base = lp => ({ managerId: lp.managerId, manager: lp.manager, playerId: lp.playerId, playerName: lp.playerName });
  for (const { lp, info } of infos) {
    // BN: mindestens ein Eigentor oder verschossener Elfmeter
    const bn = [];
    if (info.ownGoal) bn.push('Eigentor');
    if (info.penMissed.length) bn.push(`Elfmeter verschossen (${info.penMissed.join(', ')}. Min.)`);
    if (bn.length) actions.push({ ...base(lp), rule: 'BN', reason: bn.join(' + '), action: 'An einen beliebigen Mitmanager abgeben; Empfänger stellt ihn am nächsten Spieltag auf' });
    // RK: Rot, Gelb-Rot oder 5. Gelbe Karte
    const rk = [];
    if (info.red) rk.push('Rote Karte');
    if (info.yellowRed) rk.push('Gelb-Rote Karte');
    if (info.yellowBan) rk.push(`${info.yellowBan}. Gelbe Karte der Saison`);
    if (rk.length) actions.push({ ...base(lp), rule: 'RK', reason: rk.join(' + '), action: 'An einen beliebigen Mitmanager abgeben; Empfänger stellt ihn am nächsten Spieltag auf' });
  }
  // UM: verursachter Elfmeter durch Foul (Gegner hat "Elfmeter herausgeholt" bis 5 Min. daneben: Kickbase stempelt
  // Foul und Pfiff nach VAR-Pruefung unterschiedlich, Tapsoba ST 7: 4171 in der 78., Asllani 4177 in der 75. Min.)
  // 6 bis 15 Min. daneben: "bitte pruefen". Weiter weg ist es ein anderer Elfmeter (Kevin-Meldung Matsima ST 6:
  // verursacht in der 3., Futkeu holte erst in der 96. einen heraus), dann zaehlt es wie Handspiel.
  for (const { lp, center, info } of infos) {
    for (const minute of info.penCaused) {
      const own = String(center?.tid ?? ''), t1 = String(center?.t1 ?? ''), t2 = String(center?.t2 ?? '');
      const oppTeam = own && own === t1 ? t2 : own && own === t2 ? t1 : null;
      const label = `${minute}. Min.`;
      if (!oppTeam) { unclear.push({ ...base(lp), rule: 'UM', reason: `Elfmeter verursacht (${label}), Gegner nicht erkennbar` }); continue; }
      let all; try { all = await loadAllPlayers(token); } catch { unclear.push({ ...base(lp), rule: 'UM', reason: `Elfmeter verursacht (${label}), Spielerliste nicht ladbar` }); continue; }
      const opp = [...all.players.entries()].filter(([, p]) => String(p.teamId) === oppTeam);
      const hits = [], other = []; let oppFailed = 0;
      for (let i = 0; i < opp.length; i += 5) {
        await Promise.all(opp.slice(i, i + 5).map(async ([id, p]) => {
          try {
            const c = await getCenter(id);
            for (const e of netEvents(c)) if (e.eti === ETI_PEN_WON && e.net > 0) { const d = Math.abs(e.minute - minute); if (d <= 5) hits.push({ playerId: id, name: p.name, minute: e.minute }); else if (d <= 15) other.push({ playerId: id, name: p.name, minute: e.minute }); }
          } catch { oppFailed++; }
        }));
      }
      if (hits.length === 1 && !oppFailed) {
        const fouled = hits[0], owner = ownerOf(fouled.playerId);
        if (owner && owner.source !== 'kader' && owner.source !== 'startelf') unclear.push({ ...base(lp), rule: 'UM', reason: `Elfmeter per Foul verursacht (${label}), gefoult wurde ${fouled.name}. Wem er am Spieltag gehoerte, ist nicht gespeichert; heute ist er ${owner.managerId ? 'bei ' + owner.manager : 'bei keinem Manager'}. Bitte pruefen` });
        else if (owner && String(owner.managerId) === String(lp.managerId)) unclear.push({ ...base(lp), rule: 'UM', reason: `Elfmeter per Foul verursacht (${label}); gefoulter Spieler ${fouled.name} steht im selben Kader. Sonderfall, bitte entscheiden` });
        else actions.push({ ...base(lp), rule: 'UM', reason: `Elfmeter per Foul verursacht (${label}), gefoult wurde ${fouled.name}`,
          recipient: owner ? owner.manager : 'Markt', recipientId: owner ? String(owner.managerId) : null, recipientKind: owner ? 'manager' : 'markt',
          action: owner ? `An ${owner.manager} abgeben; Empfänger stellt ihn am nächsten Spieltag auf` : 'Niemand hat den gefoulten Spieler: an den Markt verkaufen' });
      } else if (!hits.length && !oppFailed && !other.length) { /* Handspiel: zaehlt nicht fuer UM */ }
      else if (!hits.length && !oppFailed) unclear.push({ ...base(lp), rule: 'UM', reason: `Elfmeter verursacht (${label}); beim Gegner "Elfmeter herausgeholt" nur zu anderer Zeit: ${other.map(o => `${o.name} ${o.minute}. Min.`).join(', ')}. Bitte prüfen` });
      else unclear.push({ ...base(lp), rule: 'UM', reason: `Elfmeter verursacht (${label}): ${oppFailed ? 'Gegnerdaten nicht vollständig lesbar' : hits.length + ' mögliche gefoulte Spieler'}, bitte prüfen` });
    }
  }
  const order = { RK: 0, BN: 1, UM: 2 };
  actions.sort((a, b) => order[a.rule] - order[b.rule] || a.manager.localeCompare(b.manager, 'de'));
  return { actions, unclear, failures, playersChecked: lineupPlayers.length, note: 'Nur aufgestellte Spieler. Marktwert noch nicht berücksichtigt. Besitzer des gefoulten Spielers zum Stand des Spieltags (gespeicherter Kader oder Startelf).' };
}

// KBL 4.12: von Hand abgehakte Aufgaben je Spieltag, fuer alle Geraete gleich.
const TODO_FILE=path.join(process.cwd(),'kbl-todo-checks.json');
function readTodos(){try{return JSON.parse(fs.readFileSync(TODO_FILE,'utf8'));}catch(e){if(e.code==='ENOENT')return {};throw e;}}
function saveTodos(data){const tmp=TODO_FILE+'.tmp';fs.writeFileSync(tmp,JSON.stringify(data,null,2),{mode:0o600});fs.renameSync(tmp,TODO_FILE);}
const validTodoKey=k=>typeof k==='string'&&/^[A-Z]{2,3}:\d{1,15}(:\d{1,12})?$/.test(k);
app.get('/api/todo-checks/:day',(req,res)=>{
  if(!getToken(req))return res.status(401).json({error:'Nicht angemeldet.'});
  const day=validDay(req.params.day);if(!day)return res.status(400).json({error:'Ungültiger Spieltag.'});
  try{res.set('Cache-Control','no-store').json({day,checks:readTodos()[day]||{}});}catch(e){res.status(500).json({error:'Haken nicht lesbar.'});}
});
app.post('/api/todo-checks/:day',(req,res)=>{
  if(!getToken(req))return res.status(401).json({error:'Nicht angemeldet.'});
  const day=validDay(req.params.day);if(!day)return res.status(400).json({error:'Ungültiger Spieltag.'});
  const {key,done,target,removed}=req.body||{};
  if(!validTodoKey(key)||typeof done!=='boolean'||(removed!=null&&typeof removed!=='boolean'))return res.status(400).json({error:'Ungültige Angabe.'});
  // Magic Miyoshi: wen der Manager bestimmt hat (Managername).
  if(target!=null&&(typeof target!=='string'||!target.trim()||target.length>60))return res.status(400).json({error:'Ungültiger Manager.'});
  try{
    const all=readTodos();all[day]=all[day]||{};
    // Strafe entfernen (Kevin-Wunsch): falsch berechnete Strafe gilt nicht, zaehlt nicht in der BumsTabelle; wiederherstellbar.
    if(done)all[day][key]={done:true,at:new Date().toISOString(),...(target?{target:target.trim()}:{}),...(removed?{removed:true}:{})};else delete all[day][key];
    saveTodos(all);res.set('Cache-Control','no-store').json({day,checks:all[day]});
  }catch(e){res.status(500).json({error:'Haken nicht gespeichert.'});}
});

// KBL 4.16: BumsTabelle. Bumsungen je Spieltag und Manager, wie sie die BumsParade zaehlt (vom Browser gemeldet).
const BUMS_FILE=path.join(process.cwd(),'kbl-bumsungen.json');
function readBums(){try{return JSON.parse(fs.readFileSync(BUMS_FILE,'utf8'));}catch(e){if(e.code==='ENOENT')return {};throw e;}}
// Spieltagsbericht (Kevin-Wunsch): schreibt tools/spieltagsbericht.mjs auf GitHub in kbl-berichte.json; hier nur lesen.
app.get('/api/berichte',(req,res)=>{
  let d={berichte:{}};try{d=JSON.parse(fs.readFileSync(path.join(process.cwd(),'kbl-berichte.json'),'utf8'));}catch{}
  res.set('Cache-Control','no-store').json({berichte:Object.values(d.berichte||{}).sort((a,b)=>b.day-a.day),pruefungen:Object.fromEntries(Object.entries(d.entwuerfe||{}).filter(([k,e])=>e.pruefung&&!d.berichte?.[k]).map(([k,e])=>[k,e.pruefung])),zahlen:Object.fromEntries(Object.entries(d.entwuerfe||{}).filter(([k,e])=>e.zahlen&&!d.berichte?.[k]).map(([k,e])=>[k,e.zahlen]))});
});
app.get('/api/bumsungen',(req,res)=>{
  if(!getToken(req))return res.status(401).json({error:'Nicht angemeldet.'});
  try{res.set('Cache-Control','no-store').json({days:readBums()});}catch(e){res.status(500).json({error:'BumsTabelle nicht lesbar.'});}
});
app.post('/api/bumsungen/:day',(req,res)=>{
  if(!getToken(req))return res.status(401).json({error:'Nicht angemeldet.'});
  const day=validDay(req.params.day);if(!day)return res.status(400).json({error:'Ungültiger Spieltag.'});
  const m=req.body?.managers;
  if(!m||typeof m!=='object'||Array.isArray(m)||Object.keys(m).length>40)return res.status(400).json({error:'Ungültige Angabe.'});
  const clean={};
  for(const [id,v] of Object.entries(m)){
    if(!/^\d{1,15}$/.test(id)||!v||typeof v.name!=='string'||!v.name.trim()||v.name.length>60||!Number.isInteger(v.count)||v.count<0||v.count>60)return res.status(400).json({error:'Ungültige Angabe.'});
    const rules={};for(const [r,n] of Object.entries(v.rules||{})){if(!/^[A-Z]{2,3}$/.test(r)||!Number.isInteger(n)||n<0||n>60)return res.status(400).json({error:'Ungültige Angabe.'});if(n)rules[r]=n;}
    const dir={};for(const k of ['out','in','other'])if(v[k]!==undefined){if(!Number.isInteger(v[k])||v[k]<0||v[k]>60)return res.status(400).json({error:'Ungültige Angabe.'});dir[k]=v[k];}
    let moves;if(v.moves!==undefined){if(!Array.isArray(v.moves)||v.moves.length>40)return res.status(400).json({error:'Ungültige Angabe.'});
      moves=[];for(const x of v.moves){if(!x||!/^[A-Z]{2,3}$/.test(x.r)||!['o','i','x'].includes(x.d)||typeof x.t!=='string'||x.t.length>200)return res.status(400).json({error:'Ungültige Angabe.'});moves.push({r:x.r,d:x.d,t:x.t});}}
    clean[id]={name:v.name.trim(),count:v.count,rules,...dir,...(moves?{moves}:{})};
  }
  try{
    // Abrechnungsstand aus der BumsParade (fuer den Hinweis im Spieltag-Auswahlfeld).
    const pg=req.body?.progress,okN=n=>Number.isInteger(n)&&n>=0&&n<=500;
    const progress=pg&&okN(pg.done)&&okN(pg.total)&&okN(pg.unclear)&&pg.done<=pg.total?{done:pg.done,total:pg.total,unclear:pg.unclear}:null;
    const all=readBums();all[day]={savedAt:new Date().toISOString(),...(req.body.manual===true?{manual:true}:{}),...(progress?{progress}:{}),managers:clean};
    const tmp=BUMS_FILE+'.tmp';fs.writeFileSync(tmp,JSON.stringify(all,null,2),{mode:0o600});fs.renameSync(tmp,BUMS_FILE);
    res.set('Cache-Control','no-store').json({day,saved:true});
  }catch(e){res.status(500).json({error:'BumsTabelle nicht gespeichert.'});}
});

// BumsParade LIVE (Kevin-Wunsch): Waehrend der Spieltag laeuft, zeigt die BumsParade ohne "pruefen", welche Strafen nach dem
// aktuellen Stand faellig waeren. Nur vorlaeufig: Punkte und Ereignisse aendern sich bis Spielende (und koennen danach korrigiert werden).
// Startelf aus ranking?dayNumber (lp, wie die Live-Punkte), sonst die gespeicherte. Punkte aus dayPlayerPoints.
// AH: MVP-Zwischenstand aller Bundesliga-Spieler, hoechstens alle 30 Min. neu (ca. 500 Abrufe, kbl-live-mvp.json).
// Hoechstens alle 5 Min. neu. Keine Haken, nichts geht in die BumsTabelle, Teamlimit erst in der echten BumsParade.
const fmtNum=n=>Number(n).toLocaleString('de-DE');
const LIVE_MVP_FILE=path.join(process.cwd(),'kbl-live-mvp.json'),ruleLiveCache=new Map(),ruleLiveDone=new Map();
async function liveMvpFor(token,day){
 let file={};try{file=JSON.parse(fs.readFileSync(LIVE_MVP_FILE,'utf8'));}catch{}
 const fresh=x=>x&&Date.now()-Date.parse(x.at)<30*60e3;
 if(fresh(file[day]))return file[day];
 const t=readTipps()[day]?.liveMvp;if(fresh(t)&&!(t.pool||[]).length&&!(t.conds||[]).length)return t;
 const m=await loadMatchdayMvp(token,day,{live:true});
 const v={at:new Date().toISOString(),points:m.players.length?m.players[0].points:null,players:m.players.map(p=>({id:String(p.id),name:p.name,team:p.team})),checked:m.playersChecked,failed:m.failedPlayers,reliable:m.reliable};
 try{const tmp=LIVE_MVP_FILE+'.tmp';fs.writeFileSync(tmp,JSON.stringify({[day]:v}));fs.renameSync(tmp,LIVE_MVP_FILE);}catch{}
 return v;
}
app.get('/api/rule-live/:day',async(req,res)=>{
 const token=getToken(req)||newestToken();
 if(!token)return res.status(401).json({error:'Nicht angemeldet.'});
 const day=validDay(req.params.day);
 if(!day)return res.status(400).json({error:'Ungültiger Spieltag.'});
 try{
  const md=await loadMatchdays(),st=md.days.find(d=>d.day===day)?.status;
  // Alle Spiele vorbei, aber Kickbase hat den Spieltag noch nicht abgeschlossen (Ranking il, meist bis zum Abend danach):
  // bleibt LIVE (Kevin-Wunsch), closing = true.
  const ended=()=>res.set('Cache-Control','no-store').json({day,status:st||'unknown',live:false,message:st==='finished'?'Spieltag beendet: Die echte BumsParade gibt es über „BumsParade prüfen“.':'Spieltag hat noch nicht begonnen.'});
  const maybeClosing=st==='finished'&&day===md.lastFinishedDay;
  if(st!=='live'&&!maybeClosing)return ended();
  const c=ruleLiveCache.get(day);
  if(c&&Date.now()-c.at<5*60e3)return res.set('Cache-Control','no-store').json(c.value);
  const memo=new Map(),get=p=>{if(!memo.has(p))memo.set(p,kbFetch(p,{token}).catch(e=>{memo.delete(p);throw e;}));return memo.get(p);};
  const ranking=await get(`/v4/leagues/6422780/ranking?dayNumber=${day}`);
  if(st!=='live'&&ranking.il!==true)return ended();
  const closing=st!=='live';
  // Nicht auf performance umstellen, sobald das Ranking mdp hat (an ST 7 versucht, Kevin: falsche BD). Bis Kickbase den
  // Spieltag abschliesst, bleibt playercenter die Quelle; die Abweichungen zeigt die echte BumsParade als Warnung.
  const settled=false;
  const users=(ranking.us||[]).filter(u=>validManager(u.i)&&String(u.n||'').toLowerCase()!=='t1000');
  const snaps=readSnapshots(),notes=[];
  const lineups=users.map(u=>{const lp=(u.lp||[]).filter(x=>x!=null).map(String),s=snaps[`${day}:${u.i}`],own=Array.isArray(s?.playerIds)?s.playerIds.map(String):[];
   return {managerId:String(u.i),name:String(u.n||u.i),ids:lp.length?lp:own};});
  const noLineup=lineups.filter(m=>!m.ids.length).map(m=>m.name);
  if(noLineup.length)notes.push(`Das fehlt: Startelf nicht lesbar bei ${noLineup.join(', ')}. Drehtür und Magic Miyoshi werden darum nicht berechnet.`);
  const all=await loadAllPlayers(token).catch(()=>null);
  const pname=id=>all?.players.get(String(id))?.name||Object.values(snaps).find(s=>s?.day===day&&s.playerNames?.[id])?.playerNames?.[id]||`Spieler-ID ${id}`;
  const ids=[...new Set(lineups.flatMap(m=>m.ids))],pts={},perf={};
  for(let i=0;i<ids.length;i+=5)await Promise.all(ids.slice(i,i+5).map(async id=>{
   // Spiel vorbei: Punkte nur alle 30 Min. neu (Kevin-Vorgabe: danach reichen groessere Abstaende, wegen Korrekturen).
   const k=`${day}:${id}:${settled?'p':'c'}`,c=ruleLiveDone.get(k);
   if(c&&Date.now()-c.at<30*60e3)pts[id]=c.value;
   else{try{pts[id]=await dayPlayerPoints(token,id,day,settled,get);}catch{pts[id]={points:null,state:'error'};}
    if(pts[id].state==='done')ruleLiveDone.set(k,{at:Date.now(),value:pts[id]});else ruleLiveDone.delete(k);}
   try{perf[id]=await get(`/v4/competitions/1/players/${id}/performance`);}catch{}
  }));
  // Alle Spiele vorbei (closing): nichts laeuft mehr. Spieler nur aus playercenter (z. B. Pejcinovic) gelten als beendet,
  // Spieler ohne Punkte wurden nicht eingesetzt (Kevin: "1 im Spiel, 17 nicht angepfiffen" war nach Spielende unverstaendlich).
  if(closing)for(const id of ids){if(pts[id]?.state==='live')pts[id]={...pts[id],state:'done'};else if(pts[id]?.state==='open')pts[id]={...pts[id],state:'unused'};}
  const roster=lineups.filter(m=>m.ids.length).map(m=>{
   const players=m.ids.filter(id=>Number.isFinite(pts[id]?.points)).map(id=>({playerId:id,playerName:pname(id),points:pts[id].points,state:pts[id].state}));
   return {...m,players,dayPoints:players.reduce((s,p)=>s+p.points,0)-100*Math.max(0,11-m.ids.length),
    open:m.ids.filter(id=>pts[id]?.state==='open').length,errors:m.ids.filter(id=>pts[id]?.state==='error').length};});
  const errors=roster.reduce((s,m)=>s+m.errors,0);
  if(errors)notes.push(`${errors} aufgestellte Spieler nicht abrufbar, ihre Punkte fehlen im Zwischenstand.`);
  // RK, BN, UM aus den Spieltagsdaten (nur Spieler, deren Spiel schon laeuft oder vorbei ist).
  const squads=new Map();
  for(let i=0;i<users.length;i+=4)await Promise.all(users.slice(i,i+4).map(async u=>{try{squads.set(String(u.i),(await get(`/v4/leagues/6422780/managers/${u.i}/squad`)).it||[]);}catch{}}));
  const owner=new Map();
  for(const m of lineups){const s=snaps[`${day}:${m.managerId}`];
   for(const pid of (Array.isArray(s?.squadIds)?s.squadIds:[]))owner.set(String(pid),{managerId:m.managerId,manager:m.name,source:'kader'});}
  for(const m of lineups)for(const pid of m.ids)if(!owner.has(pid))owner.set(pid,{managerId:m.managerId,manager:m.name,source:'startelf'});
  // Waehrend des Spieltags ist der heutige Kader der Kader am Spieltag (Transfers sind gesperrt).
  for(const m of lineups)for(const p of (squads.get(m.managerId)||[]))if(p.pi!=null&&!owner.has(String(p.pi)))owner.set(String(p.pi),{managerId:m.managerId,manager:m.name,source:'kader'});
  const allSquads=users.every(u=>squads.has(String(u.i)));
  const ownerOf=id=>owner.get(String(id))||(allSquads?null:{managerId:null,manager:'unbekannt',source:'heute'});
  const kicked=roster.flatMap(m=>m.players.filter(p=>p.state!=='open').map(p=>({managerId:m.managerId,manager:m.name,playerId:p.playerId,playerName:p.playerName,perf:perf[p.playerId]})));
  const center=id=>get(`/v4/competitions/1/playercenter/${id}?dayNumber=${day}`);
  let ev;try{ev=await detectAutoEvents({token,day,lineupPlayers:kicked,ownerOf,getCenter:center});}
  catch(e){ev={actions:[],unclear:[],failures:[]};notes.push('Karten, Eigentore und Elfmeter nicht lesbar: '+e.message);}
  // 5. Gelbe live: performance kennt die Karte des laufenden Spiels oft noch nicht, playercenter schon.
  for(const lp of kicked){
   if(ev.actions.some(a=>a.rule==='RK'&&String(a.playerId)===lp.playerId))continue;
   let c;try{c=await center(lp.playerId);}catch{continue;}
   const rec=findDayRecord(lp.perf,day);if(Array.isArray(rec?.k)&&rec.k.includes(4))continue;
   const today=singleYellows(c?.k);if(!today)continue;
   const before=seasonYellowCards(lp.perf,day).before;
   if(Math.floor((before+today)/5)>Math.floor(before/5))ev.actions.push({managerId:lp.managerId,manager:lp.manager,playerId:lp.playerId,playerName:lp.playerName,rule:'RK',reason:`${Math.floor((before+today)/5)*5}. Gelbe Karte der Saison`});
  }
  if(ev.failures?.length)notes.push(`Ereignisse von ${ev.failures.length} Spielern nicht lesbar.`);
  // AH: aktuell bester Spieler aller Bundesliga-Spieler.
  let mvp=null;try{mvp=await liveMvpFor(token,day);}catch(e){notes.push('Aktueller MVP nicht ermittelbar: '+e.message);}
  const mvpIds=new Set((mvp?.players||[]).map(p=>String(p.id)));
  const ah=roster.flatMap(m=>m.players.filter(p=>mvpIds.has(p.playerId)).map(p=>({managerId:m.managerId,manager:m.name,...p})));
  // BD erst nach Spielende (Kevin-Vorgabe): waehrend des Spiels aendern sich die Punkte staendig.
  const bd=roster.flatMap(m=>m.players.filter(p=>p.state==='done'&&isSchnapszahl(p.points)).map(p=>({managerId:m.managerId,manager:m.name,...p})));
  // Rangfolge wie in der BumsParade: BD tritt hinter allen anderen Regeln zurueck, DD zuletzt.
  const other=new Map(),add=(id,r)=>{id=String(id);if(!other.has(id))other.set(id,new Set());other.get(id).add(r);};
  for(const a of ev.actions)add(a.playerId,a.rule);
  for(const a of ah)add(a.playerId,'AH');
  // state je Spieler (open/live/done): Push-Nachrichten "gebumst" gehen erst nach Spielende raus (tools/tipp-dienst/worker.js).
  const items=[],item=(rule,m,text,extra={})=>items.push({rule,managerId:String(m.managerId),manager:m.manager||m.name,text,...(m.playerName?{playerId:String(m.playerId),playerName:m.playerName,...(pts[String(m.playerId)]?.state?{state:pts[String(m.playerId)].state}:{})}:{}),...extra});
  for(const [id,r] of other)if(r.size>1){const a=ev.actions.find(x=>String(x.playerId)===id)||ah.find(x=>String(x.playerId)===id);item('EZ',a,`${a.playerName} ist von ${[...r].join(' und ')} betroffen: Einzelfallentscheidung`);}
  const multi=id=>(other.get(String(id))?.size||0)>1;
  for(const p of ah)if(!multi(p.playerId))item('AH',p,`${p.playerName} ist mit ${fmtNum(p.points)} Punkten gerade MVP des Spieltags: müsste zum Verkauf angeboten werden`);
  for(const a of ev.actions)if(!multi(a.playerId))item(a.rule,a,a.rule==='UM'?`${a.playerName}: ${a.reason}. ${a.recipientKind==='manager'?`Ginge an ${a.recipient}`:'Ginge an den Markt'}`:`${a.playerName}: ${a.reason}. Müsste an einen Mitmanager abgegeben werden`,{reason:a.reason,...(a.rule==='UM'&&a.recipientKind==='manager'?{to:[String(a.recipient)]}:{})});
  for(const p of bd)if(!other.has(String(p.playerId)))item('BD',p,`${p.playerName} steht bei ${fmtNum(p.points)} Punkten (Schnapszahl): müsste an den Markt verkauft werden (Spiel beendet)`,{state:p.state,points:p.points});
  for(const u of (ev.unclear||[]))item(u.rule,u,`${u.playerName}: ${u.reason}`,{unclear:true});
  let dd=null,mm=null;
  if(!noLineup.length&&roster.length){
   const ex=new Map();for(const p of bd)ex.set(String(p.playerId),['BD']);for(const [id,r] of other)ex.set(id,[...(ex.get(id)||[]),...r]);
   const top=Math.max(...roster.map(m=>m.dayPoints)),low=Math.min(...roster.map(m=>m.dayPoints));
   const winners=roster.filter(m=>m.dayPoints===top),last=roster.filter(m=>m.dayPoints===low);
   dd={winners:winners.map(m=>({managerId:m.managerId,manager:m.name,dayPoints:m.dayPoints,...ddCandidates(m.players,ex)})),last:last.map(m=>({managerId:m.managerId,manager:m.name,dayPoints:m.dayPoints})),tie:winners.length!==1||last.length!==1};
   const lastNames=last.map(m=>m.name).join(', ');
   for(const w of dd.winners)item('DD',w,`führt mit ${fmtNum(w.dayPoints)} Punkten: müsste einen dieser Spieler an ${lastNames} abgeben: ${w.candidates.map(p=>`${p.playerName} (${fmtNum(p.points)})`).join(', ')||'keiner frei'}`,{role:'give',to:dd.last.map(l=>String(l.manager||l.name)),cands:w.candidates.map(p=>({id:String(p.playerId),name:p.playerName,points:p.points,state:p.state||null}))});
   for(const l of dd.last)item('DD',l,`ist mit ${fmtNum(l.dayPoints)} Punkten Letzter: dürfte sich einen Spieler von ${dd.winners.map(w=>w.manager).join(', ')} aussuchen`,{role:'get'});
   if(dd.tie)notes.push('Gleichstand an der Spitze oder am Ende: Die Drehtür gilt dann für alle mit gleicher Punktzahl.');
   mm=calculateMm(roster);
   for(const v of mm.affected)item('MM',v,`hat gerade die meisten Minuspunkte (${fmtNum(v.negativeSum)}): dürfte bestimmen, wer am nächsten Spieltag einen Spieler weniger aufstellt`);
  }
  const order={EZ:0,DD:1,AH:2,RK:3,BN:4,UM:5,BD:6,MM:7};
  items.sort((a,b)=>(order[a.rule]??9)-(order[b.rule]??9));
  const open=ids.filter(id=>pts[id]?.state==='open').length,running=ids.filter(id=>pts[id]?.state==='live').length;
  const value={day,status:'live',live:true,...(closing?{closing:true}:{}),...(settled?{settled:true}:{}),updatedAt:new Date().toISOString(),expected:users.length,managers:roster.length,players:ids.length,open,running,
   standings:roster.map(m=>({managerId:m.managerId,manager:m.name,dayPoints:m.dayPoints})).sort((a,b)=>b.dayPoints-a.dayPoints),
   items,mvp:mvp&&{players:mvp.players,points:mvp.points,at:mvp.at,reliable:mvp.reliable},notes,
   // Punkte aller Spieler mit beendetem Spiel: Push-Entwarnung, wenn eine gemeldete Schnapszahl korrigiert wird (worker.js).
   donePoints:Object.fromEntries(ids.filter(id=>pts[id]?.state==='done'&&Number.isFinite(pts[id].points)).map(id=>[id,pts[id].points]))};
  ruleLiveCache.set(day,{at:Date.now(),value});
  res.set('Cache-Control','no-store').json(value);
 }catch(err){res.status(err.status||502).json({error:'BumsParade LIVE nicht abrufbar.',detail:err.message});}
});

// 22:00 Uhr deutscher Zeit am Tag nach dem Zeitpunkt ms (Verkaufsfrist der BumsParade), als UTC-Millisekunden.
function berlinNextDay22(ms){
 const [y,m,d]=new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Berlin',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(ms)).split('-').map(Number);
 const guess=Date.UTC(y,m-1,d+1,22,0);
 const wall=Date.parse(new Date(guess).toLocaleString('sv-SE',{timeZone:'Europe/Berlin'}).replace(' ','T')+'Z');
 return guess-(wall-guess);
}
app.get('/api/rule-accounting/:day', async (req, res) => {
  const token = getToken(req);
  if (!token) return res.status(401).json({error:'Nicht angemeldet.'});
  const day = validDay(req.params.day);
  if (!day) return res.status(400).json({error:'Ungültiger Spieltag.'});
  const testMode = req.query.test === '1';
  // Probelauf: heutige Aufstellungen (Kaderfeld lo) werden NUR im Speicher als Startelf des
  // gewaehlten, schon beendeten Spieltags angenommen. Es wird nichts gespeichert. Das prueft
  // die Technik mit echten Kickbase-Antworten, ist aber keine echte Abrechnung.
  const probe = req.query.probe === '1';
  // Kurzprotokoll jeder Abrechnung in _probe/accounting-<Spieltag>.json (fuer die Fehlersuche, ohne Zugangsdaten).
  const sendJson = res.json.bind(res);
  res.json = b => { try { if (b && typeof b === 'object' && !probe) { fs.mkdirSync(path.join(process.cwd(), '_probe'), { recursive: true });
    fs.writeFileSync(path.join(process.cwd(), '_probe', `accounting-${day}.json`), JSON.stringify({ at: new Date().toISOString(), ready: b.ready, status: b.status, complete: b.complete, message: b.message, missing: b.missing, invalid: b.invalid,
      incompletePoints: b.incompletePoints, missingPoints: b.missingPoints, expected: b.expected, managers: b.managers, warnings: b.warnings, plausibility: (b.plausibility || []).filter(x => x.status !== 'match') }, null, 2)); } } catch {} return sendJson(b); };
  try {
    if (!await finishedMatchday(day)) return res.set('Cache-Control','no-store').json({day,ready:false,status:'not-finished',message:'Spieltag noch nicht vollständig beendet. Keine Abrechnung.'});
    // Managerliste aus dem aktuellen Ranking; historische Rankingpunkte sind
    // KEINE Voraussetzung fuer BD (nur fuer DD und Gesamtplatzierungen).
    const ranking = await kbFetch('/v4/leagues/6422780/ranking',{token});
    let managers = (ranking.us || []).filter(u => String(u.i) !== '3783040' && String(u.n || '').toLowerCase() !== 't1000');
    let historic = null, previous = null, rankingWarning = null;
    try {
      historic = await kbFetch(`/v4/leagues/6422780/ranking?dayNumber=${day}`,{token});
      if(day > 1) previous = await kbFetch(`/v4/leagues/6422780/ranking?dayNumber=${day-1}`,{token});
    } catch(e) { rankingWarning = `Historische Rankingpunkte nicht abrufbar (HTTP ${e.status||502}); BD wird unabhängig berechnet.`; }
    const historicPoints = rankingLookup(historic);
    const prior = rankingLookup(previous);
    let snapshots;
    const probeUnreadable = [];
    if (probe) {
      snapshots = {};
      for (const m of managers) {
        try {
          const lineup = extractFrozenLineup(await kbFetch(`/v4/leagues/6422780/managers/${m.i}/squad`,{token}));
          if (lineup) snapshots[`${day}:${m.i}`] = { day, managerId:String(m.i), playerIds:lineup.playerIds, playerNames:lineup.playerNames, source:FROZEN_SOURCE };
          else probeUnreadable.push(String(m.n||m.i));
        } catch { probeUnreadable.push(String(m.n||m.i)); }
      }
    } else snapshots = readSnapshots();
    // Fehlt eine gespeicherte Startelf (oder ist sie unbestaetigt und weicht ab), nimmt die Abrechnung die Startelf,
    // die Kickbase im historischen Ranking mitliefert (Feld lp). An ST 6 bei allen 16 Managern gegen die
    // gespeicherten Startelfen geprueft: identisch. Nur im Speicher, die Datei wird nie veraendert.
    const histNotes = [];
    if (!probe && historic) {
      const fromKb = [], replaced = [];
      for (const u of (historic.us || [])) {
        const lp = (u.lp || []).filter(x => x != null).map(String);
        if (!lp.length || !managers.some(m => String(m.i) === String(u.i))) continue;
        const key = `${day}:${u.i}`, own = snapshots[key];
        const rec = { day, managerId: String(u.i), playerIds: lp, source: 'kickbase-historie' };
        if (!own) { snapshots[key] = rec; fromKb.push(u.n); }
        else if (own.verified === false && JSON.stringify([...(own.playerIds || [])].map(String).sort()) !== JSON.stringify([...lp].sort())) { snapshots[key] = { ...rec, squadIds: own.squadIds }; replaced.push(u.n); }
      }
      if (fromKb.length) histNotes.push(`Startelf von Kickbase (historisches Ranking) übernommen, weil keine gespeichert war: ${fromKb.join(', ')}.`);
      if (replaced.length) histNotes.push(`Unbestätigte gespeicherte Startelf weicht von Kickbase ab, verwendet wird die von Kickbase: ${replaced.join(', ')}.`);
    }
    // ST 1 (Liga-Vorgabe, von Kevin bestaetigt): Wer keine Startelf hatte, wurde nachtraeglich von -1.100 auf 0 gesetzt
    // und wird an ST 1 nicht gewertet (auch nicht als Letzter der Drehtuer).
    const day1Points = !probe && day === 1;
    if (day1Points) {
      const none = managers.filter(m => !snapshots[`1:${m.i}`]);
      if (none.length) { managers = managers.filter(m => snapshots[`1:${m.i}`]); histNotes.push(`ST 1: ohne Startelf, darum nicht gewertet: ${none.map(m => m.n).join(', ')}.`); }
      histNotes.push('ST 1: Spieltagspunkte aus den Startelfen berechnet, weil die Kickbase-Rangliste für ST 1 abweichende Werte liefert (die Startelf-Summen stimmen mit der Kickbase-App überein).');
    }
    const missing = [], invalid = [], scored = [];
    for (const manager of managers) {
      const id=String(manager.i), snapshot=snapshots[`${day}:${id}`];
      if (!snapshot) {missing.push({managerId:id,name:manager.n});continue;}
      if (!parsePlayerIds(snapshot.playerIds)) {invalid.push({managerId:id,name:manager.n,reason:'Snapshot enthält keine gültigen 1 bis 11 Spieler-IDs'});continue;}
      if (!CONFIRMED_SOURCES.has(snapshot.source) && snapshot.source !== 'kickbase-historie') {invalid.push({managerId:id,name:manager.n,reason:'Eigene API-Aufstellung ist noch nicht manuell bestätigt'});continue;}
      const total=Number(historicPoints.get(id,manager.n)), base=day===1?0:Number(prior.get(id,manager.n));
      const hasRanking=historicPoints.has(id,manager.n)&&(day===1||prior.has(id,manager.n))&&Number.isFinite(total)&&Number.isFinite(base);
      scored.push({managerId:id,name:manager.n,dayPoints:hasRanking?total-base:null,snapshot});
    }
    if (!scored.length || !managers.length) {
      return res.set('Cache-Control','no-store').json({day,ready:false,status:'incomplete',expected:managers.length,available:scored.length,missing,invalid,message:'Nur vollständige, manuell bestätigte Aufstellungen werden abgerechnet.'});
    }
    const allIds=[...new Set(scored.flatMap(m=>m.snapshot.playerIds))];
    const performances=new Map();const performancePayloads=new Map();const failures=[];
    // Begrenzte Parallelitaet, um die Kickbase-API nicht zu ueberlasten.
    const inferredZero=new Set();
    for(let i=0;i<allIds.length;i+=5) {
      const batch=allIds.slice(i,i+5);
      await Promise.all(batch.map(async id=>{
        try {const data=await kbFetch(`/v4/competitions/1/players/${id}/performance`,{token});
          performancePayloads.set(id,data); performances.set(id,pointFromPerformance(data,day,true));
          // Beendeter Spieltag, gueltige Saisondaten, aber kein Eintrag fuer den Tag: nicht eingesetzt = 0 Punkte (wird in den Hinweisen genannt; die Plausibilitaetspruefung faengt Irrtuemer ab).
          if(performances.get(id)===null && (Array.isArray(data?.it)||Array.isArray(data?.data?.it)) && !findDayRecord(data,day)){performances.set(id,0);inferredZero.add(String(id));}}
        catch(e){failures.push({playerId:id,error:`HTTP ${e.status||502}`});}
      }));
    }
    // Zweitquelle: Spieltagsdaten (playercenter). Fehlt in den Leistungsdaten der Eintrag oder die Punkte, werden die Punkte von dort uebernommen
    // (z. B. nachtraeglich korrigierte Spieler). Weichen beide Quellen bei echten Punkten ab, hat Kickbase die Korrekturen noch nicht
    // in Leistungsdaten und Ranking uebernommen (ST 7: Omari 66 im Profil, 78 live mit +12 Korrekturen; Kevin: live ist aktueller).
    // Dann pendingCorrections: nichts in die BumsTabelle, keine Push-Abrechnung (an ST 3 bis 6 nach dem Abschluss keine Abweichung).
    const centerCache=new Map();
    // Spieltagsdetails je Spieler; ein Fehlschlag (z. B. zu viele Anfragen) wird nicht gemerkt, sondern bis zu zweimal neu versucht.
    const fetchCenter=async id=>{for(let attempt=0;;attempt++){try{return await kbFetch(`/v4/competitions/1/playercenter/${id}?dayNumber=${day}`,{token});}catch(e){if(attempt>=2)throw e;await new Promise(r=>setTimeout(r,1500*(attempt+1)));}}};
    const getCenter=id=>{id=String(id);if(!centerCache.has(id))centerCache.set(id,fetchCenter(id).catch(e=>{centerCache.delete(id);throw e;}));return centerCache.get(id);};
    const fromCenter=new Map(), centerConflicts=[];
    for(let i=0;i<allIds.length;i+=5) {
      await Promise.all(allIds.slice(i,i+5).map(async id=>{
        const data=performancePayloads.get(id);
        if(!data)return;
        let center; try{center=await getCenter(id);}catch{return;}
        const cp=center&&center.p!==undefined&&center.p!==null&&center.p!==''&&Number.isFinite(Number(center.p))?Number(center.p):null;
        if(cp===null)return;
        const rec=findDayRecord(data,day);
        const real=!!(rec&&rec.p!==undefined&&rec.p!==null&&rec.p!==''&&Number.isFinite(Number(rec.p)));
        if(!real){ if(cp!==0||performances.get(id)===null){performances.set(id,cp);fromCenter.set(String(id),cp);inferredZero.delete(String(id));} }
        else if(Number(rec.p)!==cp) centerConflicts.push({playerId:String(id),performance:Number(rec.p),center:cp});
      }));
    }
    const missingPoints=allIds.filter(id=>performances.get(id)===null||!performances.has(id));
    const failedIds=new Set(failures.map(f=>String(f.playerId)));
    const pointDiagnostics=missingPoints.map(id=>{
      const data=performancePayloads.get(id);
      const seasons=Array.isArray(data?.it)?data.it:Array.isArray(data?.data?.it)?data.data.it:[];
      return {playerId:id,reason:failedIds.has(String(id))?'api-error':'no-matchday-entry',
        responseKeys:data&&typeof data==='object'?Object.keys(data).slice(0,16):[],
        seasons:seasons.map(x=>({season:String(x.ti??''),historyCount:Array.isArray(x.ph)?x.ph.length:0,
          daysNearTarget:Array.isArray(x.ph)?x.ph.filter(y=>Math.abs(Number(y.day)-day)<=1).map(y=>({day:y.day,p:y.p??null,keys:Object.keys(y).slice(0,12)})):[]})).slice(0,8)};
    });
    const missingDetails=missingPoints.map(id=>({playerId:id,reason:failedIds.has(String(id))?'api-error':'no-matchday-entry',error:failures.find(f=>String(f.playerId)===String(id))?.error||null}));
    // BD ist ein Einzelspieler-Ereignis. Auch bei unvollstaendiger Aufstellung
    // werden ALLE bekannten Spielerpunkte ausgewertet; unbekannte bleiben offen.
    const incompletePoints=[];
    const roster=scored.map(m=>{
      const absent=m.snapshot.playerIds.filter(id=>!Number.isFinite(performances.get(id)));
      if(absent.length)incompletePoints.push({managerId:m.managerId,name:m.name,playerIds:absent});
      const players=m.snapshot.playerIds.filter(id=>Number.isFinite(performances.get(id))).map(id=>({playerId:id,points:performances.get(id)}));
      // ST 1: Punkte aus der Startelf (Summe minus leere Positionen), die Rangliste ist dort falsch.
      if(day1Points&&!absent.length)return {...m,players,dayPoints:players.reduce((s,p)=>s+p.points,0)-Math.max(0,11-m.snapshot.playerIds.length)*100};
      return {...m,players};
    });
    if(!roster.length)return res.set('Cache-Control','no-store').json({day,ready:false,status:'missing-player-points',missingPoints,failures,message:'Keine gespeicherten Aufstellungen vorhanden.'});
    const ddRoster=roster.filter(m=>Number.isFinite(m.dayPoints));
    const computed=calculateBdDd(ddRoster);
    computed.bd=roster.flatMap(m=>m.players.filter(p=>isSchnapszahl(p.points)).map(p=>({managerId:m.managerId,manager:m.name,...p})));
    const mm=incompletePoints.length===0 && missing.length===0 && invalid.length===0 ? calculateMm(roster) : null;
    const ah=calculateAh(roster,null);
    const bd=computed.bd;
    // Namen aus aktuellen Kadern sind Komfortdaten, keine historische Garantie.
    const playerNames=new Map();
    // Leistungsantworten koennen einen Namen auch dann enthalten, wenn der
    // Spieler inzwischen den Kader verlassen hat. Nur explizite Felder lesen.
    for (const [id, payload] of performancePayloads) {
      const candidates=[payload?.pn,payload?.n,payload?.name,payload?.player?.pn,payload?.player?.name,payload?.data?.pn,payload?.data?.name];
      const name=candidates.find(x=>typeof x==='string' && x.trim().length>2);
      if(name)playerNames.set(String(id),name.trim());
    }
    // Gespeicherte Namen behalten ihre Gueltigkeit auch nach Transfers.
    for (const m of scored) for (const [id,name] of Object.entries(m.snapshot.playerNames||{})) if(name) playerNames.set(String(id),String(name));
    // Aktuelle Kader aller Manager einmal laden (in kleinen Gruppen, um die Kickbase-API zu schonen).
    // Daraus kommen: Marktstatus (iotm) fuer die BD-Kontrolle, fehlende Spielernamen und der Besitzer des gefoulten Spielers (UM).
    // Das aendert nie die gespeicherte Aufstellung.
    const squads=new Map(); // managerId -> Kaderliste; fehlt, wenn der Abruf scheiterte
    for(let i=0;i<managers.length;i+=4) {
      await Promise.all(managers.slice(i,i+4).map(async m=>{
        try {const squad=await kbFetch(`/v4/leagues/6422780/managers/${m.i}/squad`,{token});squads.set(String(m.i),Array.isArray(squad.it)?squad.it:[]);}
        catch{ /* Marktstatus und Besitzer bleiben unbekannt */ }
      }));
    }
    const marketInfo=new Map(); // managerId -> Map(playerId -> iotm)
    const ownerMap=new Map(); // playerId -> { managerId, manager }
    for(const m of managers){
      const list=squads.get(String(m.i));
      if(!list)continue;
      const info=new Map();
      for(const p of list){
        if(p.pi==null)continue;
        const id=String(p.pi);
        if(!playerNames.has(id))playerNames.set(id,String(p.pn||p.n||id));
        info.set(id,typeof p.iotm==='boolean'?p.iotm:null);
        ownerMap.set(id,{managerId:String(m.i),manager:String(m.n||m.i)});
      }
      marketInfo.set(String(m.i),info);
    }
    // Fehlende Namen aus der Liste aller Bundesliga-Spieler ergaenzen (auch fuer Spieler, die inzwischen in keinem Kader mehr stehen).
    const clubOf=new Map(); // playerId -> { teamId, team } fuer das Teamlimit
    try {
      const everyone=await loadAllPlayers(token);
      for(const [id,p] of everyone.players){ if(!playerNames.has(String(id)) && p.name) playerNames.set(String(id),p.name); if(p.teamId!=null)clubOf.set(String(id),{teamId:String(p.teamId),team:p.team}); }
    } catch { /* Namen bleiben optional */ }
    // Marktstatus ist eine Momentaufnahme zum Zeitpunkt der Abfrage, kein Nachweis fuer eine Frist.
    const marketStatusOf=p=>{
      const info=marketInfo.get(String(p.managerId));
      if(!info)return 'unbekannt';
      if(!info.has(String(p.playerId)))return 'nicht_mehr_im_kader';
      const onMarket=info.get(String(p.playerId));
      return onMarket===true?'auf_dem_markt':onMarket===false?'noch_im_kader':'unbekannt';
    };
    const namedBd=bd.map(p=>({...p,playerName:playerNames.get(String(p.playerId))||null,marketStatus:marketStatusOf(p)}));
    let autoEvents = null;
    if (!testMode) {
      try {
        const lineupPlayers = scored.flatMap(m => m.snapshot.playerIds.map(id => ({ managerId: m.managerId, manager: m.name, playerId: String(id),
          playerName: playerNames.get(String(id)) || null, perf: performancePayloads.get(String(id)) ?? performancePayloads.get(id) })));
        // Besitzer zum Stand des Spieltags: 1. gespeicherter Gesamtkader, 2. gespeicherte Startelf, 3. erst dann der heutige Kader (unsicher).
        const dayOwner=new Map(),lineupOwner=new Map();
        const nameOfManager=id=>String(managers.find(m=>String(m.i)===String(id))?.n||id);
        for(const m of managers){
          const snap=snapshots[`${day}:${m.i}`];if(!snap)continue;
          for(const pid of (Array.isArray(snap.squadIds)?snap.squadIds:[]))dayOwner.set(String(pid),{managerId:String(m.i),manager:nameOfManager(m.i),source:'kader'});
          for(const pid of (Array.isArray(snap.playerIds)?snap.playerIds:[]))lineupOwner.set(String(pid),{managerId:String(m.i),manager:nameOfManager(m.i),source:'startelf'});
        }
        // Alle Gesamtkader des Tages gespeichert: Wer in keinem steht, gehoerte keinem Manager (dann Markt).
        const allSquadsSaved=managers.length>0&&managers.every(m=>Array.isArray(snapshots[`${day}:${m.i}`]?.squadIds));
        const ownerAtDay=id=>{id=String(id);
          if(dayOwner.has(id))return dayOwner.get(id);
          if(lineupOwner.has(id))return lineupOwner.get(id);
          if(allSquadsSaved)return null;
          const now=ownerMap.get(id);return now?{...now,source:'heute'}:{managerId:null,manager:'niemand',source:'heute'};};
        autoEvents = await detectAutoEvents({ token, day, lineupPlayers, ownerOf: ownerAtDay, getCenter });
      } catch (e) { autoEvents = { error: 'Automatische Ereigniserkennung fehlgeschlagen: ' + e.message, actions: [], unclear: [], failures: [] }; }
    }
    let mvpInfo = null;
    if (!testMode) {
      try { mvpInfo = await loadMatchdayMvp(token, day); }
      catch (e) { mvpInfo = { error: 'MVP konnte nicht ermittelt werden: ' + e.message, players: [], top: [], reliable: false }; }
    }
    const ahFinal = (() => {
      if (!mvpInfo || mvpInfo.error || !mvpInfo.players.length) return { ...ah, mvp: mvpInfo };
      const affected = mvpInfo.players.flatMap(mp => calculateAh(roster, mp.id).affected);
      return { status: mvpInfo.reliable ? 'provisional' : 'unsure', affected, mvp: mvpInfo };
    })();
    // KBL 4.13: Rangfolge bei Mehrfachtreffern (Liga-Vorgabe): DD zuletzt (nur Spieler ohne andere Regel),
    // BD tritt hinter allen anderen Regeln zurueck. RK, BN, UM und AH sind gleichrangig: trifft es einen Spieler
    // mehrfach, entscheidet die Liga im Einzelfall (wird angezeigt, nichts wird automatisch gewaehlt).
    const otherRules=new Map();
    const addRule=(id,r)=>{id=String(id);if(!otherRules.has(id))otherRules.set(id,new Set());otherRules.get(id).add(r);};
    for(const a of (autoEvents?.actions||[]))addRule(a.playerId,a.rule);
    for(const a of (ahFinal.affected||[]))addRule(a.playerId,'AH');
    const bdDropped=namedBd.filter(p=>otherRules.has(String(p.playerId))).map(p=>({...p,because:[...otherRules.get(String(p.playerId))]}));
    const bdActive=namedBd.filter(p=>!otherRules.has(String(p.playerId)));
    const conflicts=[...otherRules.entries()].filter(([,r])=>r.size>1).map(([id,r])=>{
      const src=(autoEvents?.actions||[]).find(a=>String(a.playerId)===id)||(ahFinal.affected||[]).find(a=>String(a.playerId)===id);
      return {playerId:id,playerName:playerNames.get(id)||src?.playerName||null,managerId:String(src?.managerId??''),manager:src?.manager||null,rules:[...r],
        details:(autoEvents?.actions||[]).filter(a=>String(a.playerId)===id).map(a=>({rule:a.rule,reason:a.reason,action:a.action}))};
    });
    const conflictIds=new Set(conflicts.map(c=>c.playerId));
    const exMap=new Map();
    const addEx=(id,label)=>{id=String(id);if(!exMap.has(id))exMap.set(id,[]);if(!exMap.get(id).includes(label))exMap.get(id).push(label);};
    for(const p of bd)addEx(p.playerId,'BD');
    for(const a of (autoEvents?.actions||[]))addEx(a.playerId,a.rule);
    for(const a of (ahFinal.affected||[]))addEx(a.playerId,'AH');
    const uncertain=new Map((autoEvents?.unclear||[]).map(u=>[String(u.playerId),u.rule]));
    // Spieler, deren Ereignisse nicht lesbar waren: koennten von BN, RK oder UM betroffen sein, also nicht stillschweigend als Kandidat werten.
    for(const f of (autoEvents?.failures||[]))if(!uncertain.has(String(f.playerId)))uncertain.set(String(f.playerId),`Ereignisdaten nicht lesbar (${f.error})`);
    const nameOf=p=>({...p,playerName:playerNames.get(String(p.playerId))||null});
    const dd=computed.dd.winners.map(m=>{
      const pl=ddRoster.find(r=>String(r.managerId)===String(m.managerId))?.players||[];
      const r=ddCandidates(pl,exMap);
      return {...m,cutoff:r.cutoff,candidates:r.candidates.map(nameOf),excluded:r.excluded.map(nameOf),
        uncertain:r.cutoff==null?[]:pl.filter(p=>uncertain.has(String(p.playerId))&&p.points>=r.cutoff).map(p=>({...nameOf(p),rule:uncertain.get(String(p.playerId))}))};
    });
    const last=computed.dd.lastPlace;
    const tie=computed.dd.tie;
    // Selbstkontrolle: Summe der Spielerpunkte der Startelf muss den Spieltagspunkten laut Ranking entsprechen.
    // Abweichung = gespeicherte Elf nicht die echte Elf, fehlende Spielerpunkte oder eine Kickbase-Regel, die wir noch nicht kennen.
    // Kickbase zieht fuer jeden nicht aufgestellten Platz 100 Punkte ab (auch unter 0). Die erwartete Summe beruecksichtigt das.
    const EMPTY_SLOT_PENALTY=100;
    const plausibility=roster.map(m=>{
      const incompleteEntry=incompletePoints.some(x=>x.managerId===m.managerId);
      const lineupSize=m.snapshot.playerIds.length;
      const emptySlots=Math.max(0,11-lineupSize);
      const emptySlotPenalty=emptySlots*EMPTY_SLOT_PENALTY;
      const playerSum=incompleteEntry?null:m.players.reduce((s,p)=>s+p.points,0);
      const expected=playerSum===null?null:playerSum-emptySlotPenalty;
      const rankingPoints=Number.isFinite(m.dayPoints)?m.dayPoints:null;
      const checkable=expected!==null&&rankingPoints!==null;
      const zeroGuessed=m.snapshot.playerIds.filter(id=>inferredZero.has(String(id))).map(id=>playerNames.get(String(id))||String(id));
      return {managerId:m.managerId,manager:m.name,lineupSize,emptySlots,emptySlotPenalty,playerSum,expected,rankingPoints,zeroGuessed,
        difference:checkable?expected-rankingPoints:null,status:!checkable?'not_checkable':expected===rankingPoints?'match':'diff'};
    });
    const complete=missing.length===0 && invalid.length===0 && scored.length===managers.length && incompletePoints.length===0 && ddRoster.length===managers.length;
    // KBL 4.12: To-do-Liste fuer die Uebersicht mit automatischer Pruefung anhand der HEUTIGEN Kader.
    // Momentaufnahme: Wer einen Spieler spaeter weitergibt, kann das Ergebnis verfaelschen. Darum kann man immer auch von Hand abhaken.
    const ownerName=pid=>ownerMap.get(String(pid))?.manager||null;
    const inSquad=(mid,pid)=>marketInfo.has(String(mid))?marketInfo.get(String(mid)).has(String(pid)):null;
    const onMarket=(mid,pid)=>marketInfo.get(String(mid))?.get(String(pid))===true;
    const allSquadsKnown=managers.every(m=>marketInfo.has(String(m.i)));
    const pname=p=>playerNames.get(String(p.playerId))||p.playerName||`Spieler-ID ${p.playerId}`;
    const todos=[];
    const todo=(key,rule,managerId,manager,text,check)=>todos.push({key,rule,managerId:String(managerId),manager,text,check});
    for(const p of bdActive){
      const here=inSquad(p.managerId,p.playerId);
      todo(`BD:${p.managerId}:${p.playerId}`,'BD',p.managerId,p.manager,`verkauft ${pname(p)} (${p.points} Pkt.) an den Markt`,
        here===null?{state:'unknown',note:'Kader nicht lesbar'}:!here?(ownerName(p.playerId)?{state:'unknown',note:`nicht an den Markt verkauft, sondern jetzt bei ${ownerName(p.playerId)}`}:{state:'done',note:'an den Markt verkauft'}):
        onMarket(p.managerId,p.playerId)?{state:'progress',note:'steht auf dem Transfermarkt, ist aber noch im Kader'}:{state:'open',note:'noch im Kader'});
    }
    if(complete&&!tie)for(const w of dd){
      const lastIds=last.map(m=>String(m.managerId));
      const got=(w.candidates||[]).find(c=>lastIds.includes(String(ownerMap.get(String(c.playerId))?.managerId)));
      todo(`DD:${w.managerId}`,'DD',w.managerId,w.manager,`gibt einen seiner drei besten Spieler an ${last.map(m=>m.manager||m.name).join(', ')}`,
        got?{state:'done',note:`${pname(got)} ist jetzt bei ${ownerName(got.playerId)}`}:allSquadsKnown?{state:'open',note:'noch keiner der Kandidaten beim Letzten'}:{state:'unknown',note:'nicht alle Kader lesbar'});
      // Kandidaten fuer die Anzeige; moved = dieser Spieler steht jetzt beim Letzten.
      todos.at(-1).options=(w.candidates||[]).map(c=>({playerId:String(c.playerId),name:pname(c),points:c.points,moved:!!got&&String(got.playerId)===String(c.playerId),uncertain:uncertain.get(String(c.playerId))||null}));
      // Empfaenger zaehlt in der BumsParade ebenfalls als betroffen (Liga-Vorgabe).
      todos.at(-1).to=last.map(m=>({managerId:String(m.managerId),manager:m.manager||m.name,playerName:got?pname(got):null}));
    }
    for(const m of (mm?.affected||[]))todo(`MM:${m.managerId}`,'MM',m.managerId,m.manager,'bestimmt, wer am nächsten Spieltag einen Spieler weniger aufstellt',{state:'manual',note:'nur von Hand abhakbar'});
    for(const c of conflicts)todo(`EZ:${c.managerId}:${c.playerId}`,'EZ',c.managerId,c.manager,`${pname(c)} ist von ${c.rules.join(' und ')} betroffen: Einzelfallentscheidung, danach von Hand abhaken`,{state:'manual',note:'mehrere gleichrangige Regeln'});
    for(const p of (ahFinal.affected||[])){
      if(conflictIds.has(String(p.playerId)))continue;
      const here=inSquad(p.managerId,p.playerId);
      todo(`AH:${p.managerId}:${p.playerId}`,'AH',p.managerId,p.manager,`bietet den MVP ${pname(p)} zum Verkauf an`,
        here===null?{state:'unknown',note:'Kader nicht lesbar'}:!here?{state:'done',note:ownerName(p.playerId)?`verkauft an ${ownerName(p.playerId)}`:'verkauft'}:
        onMarket(p.managerId,p.playerId)?{state:'done',note:'steht auf dem Transfermarkt'}:{state:'open',note:'noch nicht angeboten'});
      // Kaeufer ist ebenfalls betroffen (Bumsung = von einer Regel betroffen), bekannt erst nach dem Verkauf.
      const buyer=ownerMap.get(String(p.playerId));
      if(here===false&&buyer?.managerId&&String(buyer.managerId)!==String(p.managerId))todos.at(-1).to=[{managerId:String(buyer.managerId),manager:buyer.manager,playerName:pname(p)}];
    }
    for(const a of (autoEvents?.actions||[])){
      if(conflictIds.has(String(a.playerId)))continue;
      const here=inSquad(a.managerId,a.playerId),owner=ownerMap.get(String(a.playerId));
      const toMarket=a.rule==='UM'&&a.recipientKind==='markt';
      const wanted=a.rule==='UM'&&a.recipientKind==='manager'?String(a.recipientId):null;
      let check;
      if(here===null||!allSquadsKnown)check={state:'unknown',note:'nicht alle Kader lesbar'};
      else if(here)check={state:'open',note:'noch im Kader'};
      else if(toMarket)check=owner?{state:'unknown',note:`jetzt bei ${owner.manager}, sollte an den Markt`}:{state:'done',note:'an den Markt verkauft'};
      else if(!owner)check={state:'unknown',note:'bei keinem Manager, an den Markt verkauft?'};
      else if(wanted&&String(owner.managerId)!==wanted)check={state:'unknown',note:`jetzt bei ${owner.manager} statt bei ${a.recipient}`};
      else check={state:'done',note:`jetzt bei ${owner.manager}`};
      todo(`${a.rule}:${a.managerId}:${a.playerId}`,a.rule,a.managerId,a.manager,a.rule==='UM'?(toMarket?`verkauft ${pname(a)} an den Markt`:`gibt ${pname(a)} an ${a.recipient}`):`gibt ${pname(a)} an einen Mitmanager ab`,check);
      // Empfaenger: bei UM fest, bei RK und BN erst nach dem Transfer bekannt.
      if(a.rule==='UM'&&a.recipientKind==='manager'&&a.recipientId)todos.at(-1).to=[{managerId:String(a.recipientId),manager:a.recipient,playerName:pname(a)}];
      else if((a.rule==='RK'||a.rule==='BN')&&here===false&&owner?.managerId&&String(owner.managerId)!==String(a.managerId))todos.at(-1).to=[{managerId:String(owner.managerId),manager:owner.manager,playerName:pname(a)}];
    }
    // KBL 4.15: Teamlimit 1 (Liga-Vorgabe). Wer in der BumsParade einen Spieler bekommt (UM, DD, RK, BN, AH),
    // muss seinen bisherigen Spieler desselben Vereins verkaufen (Markt oder Manager, egal).
    // Vereinskollegen aus dem Kader am Spieltag (falls gespeichert) und dem heutigen Kader.
    const clubName=id=>clubOf.get(String(id))?.team||null;
    const sameClub=(a,b)=>{const x=clubOf.get(String(a))?.teamId,y=clubOf.get(String(b))?.teamId;return x!=null&&y!=null&&String(x)===String(y);};
    // Transfer-Verlauf nur bis eine Woche vor dem ersten Anstoss des Spieltags zurueck laden (ohne Termin: ganz).
    let histSince=0;if(!probe){try{const w0=await dayWindow(day);if(w0)histSince=w0.first-7*864e5;}catch{}}
    // Empfaenger aus dem Transfer-Verlauf des Abgebenden (/managers/{id}/transfer: tty 2 Verkauf, othnm Kaeufer, dt Zeitpunkt).
    // Wichtig fuer alte Spieltage: Der heutige Kader zeigt nur, wo der Spieler jetzt ist, nicht wohin er damals ging.
    // Gesucht wird der erste Verkauf nach dem letzten Anstoss des Spieltags, bevorzugt vor dem naechsten Spieltag.
    if(!probe&&complete){
      let win=null;try{win=await dayWindow(day);}catch{win=null;}
      if(win){
        const hCache=new Map();
        const salesOf=async gid=>{if(!hCache.has(gid)){try{hCache.set(gid,await transfersSince(token,gid,histSince));}catch{hCache.set(gid,null);}}return hCache.get(gid);};
        const firstSale=async(gid,pid)=>{const list=await salesOf(String(gid));if(!list)return null;
          const c=list.filter(t=>String(t.pi)===String(pid)&&Number(t.tty)===2&&Date.parse(t.dt)>=win.end).sort((a,b)=>Date.parse(a.dt)-Date.parse(b.dt));
          return c.find(t=>Date.parse(t.dt)<=win.next)||c.find(t=>Date.parse(t.dt)<=win.end+14*864e5)||null;};
        const byName=n=>managers.find(m=>String(m.n)===String(n));
        for(const t of todos){
          if(!['AH','RK','BN'].includes(t.rule))continue;
          const pid=String(t.key).split(':')[2];if(!pid)continue;
          const sale=await firstSale(t.managerId,pid);
          // Nie raten: Steht kein Verkauf im Verlauf, ist der heutige Besitzer nur ein Hinweis (Kevin-Meldung Suzuki ST 1).
          if(!sale){if(await salesOf(String(t.managerId))&&t.check?.state==='done'&&t.to?.[0]?.manager)t.check={state:'unknown',note:`heute bei ${t.to[0].manager}, Verkauf nicht im Transfer-Verlauf gefunden, bitte prüfen`};continue;}
          const buyer=sale.othnm?byName(sale.othnm):null;
          if(buyer&&String(buyer.i)!==String(t.managerId)){t.to=[{managerId:String(buyer.i),manager:String(buyer.n),playerName:pname({playerId:pid})}];t.check={state:'done',note:`laut Transfer-Verlauf an ${buyer.n}`};}
          else if(!sale.othnm){delete t.to;t.check={state:'done',note:'laut Transfer-Verlauf an den Markt verkauft'};}
        }
        if(!tie)for(const w of dd){
          const t=todos.find(x=>x.key===`DD:${w.managerId}`);if(!t)continue;
          const lastNames=last.map(m=>String(m.manager||m.name));
          let hit=null;for(const c of (w.candidates||[])){const sale=await firstSale(w.managerId,c.playerId);if(sale&&lastNames.includes(String(sale.othnm))){hit={c,to:sale.othnm};break;}}
          if(!hit)continue;
          for(const o of (t.options||[]))o.moved=String(o.playerId)===String(hit.c.playerId);
          t.to=(t.to||[]).map(r=>({...r,playerName:pname(hit.c)}));
          t.check={state:'done',note:`laut Transfer-Verlauf ${pname(hit.c)} an ${hit.to}`};
        }
      }
    }
    const incoming=[];
    const addIncoming=(recipientId,playerId,rule)=>{if(recipientId)incoming.push({recipientId:String(recipientId),playerId:String(playerId),rule});};
    // Wer in der BumsParade einen Spieler bekommt: aus den Aufgaben (Empfaenger aus dem Transfer-Verlauf oder dem heutigen Kader).
    for(const t of todos){
      if(!['UM','RK','BN','AH','DD'].includes(t.rule)||!t.to)continue;
      const pid=t.rule==='DD'?(t.options||[]).find(o=>o.moved)?.playerId:String(t.key).split(':')[2];if(!pid)continue;
      for(const r of t.to)if(r.managerId&&String(r.managerId)!==String(t.managerId))addIncoming(r.managerId,pid,t.rule);
    }
    const lastIdsTl=last.map(m=>String(m.managerId));
    const squadAtDay=rid=>{const s=snapshots[`${day}:${rid}`];return Array.isArray(s?.squadIds)?s.squadIds.map(String):[];};
    const squadNow=rid=>marketInfo.has(String(rid))?[...marketInfo.get(String(rid)).keys()]:[];
    const matesOf=(rid,pid)=>[...new Set([...squadAtDay(rid),...squadNow(rid)])].filter(id=>id!==String(pid)&&sameClub(id,pid));
    if(complete&&!tie)for(const w of dd){
      const got=(w.candidates||[]).find(c=>lastIdsTl.includes(String(ownerMap.get(String(c.playerId))?.managerId)));
      // Vor dem Transfer: bei jedem Kandidaten anzeigen, wen der Letzte dann abgeben muesste.
      const opt=todos.find(t=>t.key===`DD:${w.managerId}`);
      if(opt?.options&&!got)for(const o of opt.options){const mates=lastIdsTl.flatMap(rid=>matesOf(rid,o.playerId));if(mates.length)o.clash=mates.map(id=>playerNames.get(id)||`Spieler-ID ${id}`).join(', ');}
    }
    const seenTl=new Set();
    // Spieler, die der Empfaenger erst NACH dem Erhalt gekauft hat, zaehlen nicht fuers Teamlimit (Kevin-Meldung: Laimer kam
    // erst spaeter zu xDanii). Zeitpunkt aus dem Transfer-Verlauf des Empfaengers (tty 1 Kauf); ohne Verlauf bleibt alles wie bisher.
    const tlHist=new Map();
    const histOf=async rid=>{if(!tlHist.has(rid)){try{tlHist.set(rid,await transfersSince(token,rid,histSince));}catch{tlHist.set(rid,null);}}return tlHist.get(rid);};
    for(const inc of incoming){
      const rname=String(managers.find(m=>String(m.i)===inc.recipientId)?.n||inc.recipientId);
      const hist=probe?null:await histOf(inc.recipientId);
      const gotAt=hist?Math.min(...hist.filter(t=>String(t.pi)===inc.playerId&&Number(t.tty)===1).map(t=>Date.parse(t.dt)).filter(Number.isFinite)):Infinity;
      const atDay=new Set(squadAtDay(inc.recipientId));
      // Nicht im Kader beim Erhalt: letzter Transfer davor war ein Verkauf, oder der erste ueberhaupt ist ein spaeterer Kauf
      // (Kevin-Meldung Schwolow ST 2: im August gekauft und verkauft, erst im Oktober wieder gekauft).
      const laterBuy=mate=>Number.isFinite(gotAt)&&!atDay.has(String(mate))&&(()=>{
        const ev=hist.filter(t=>String(t.pi)===String(mate)&&[1,2].includes(Number(t.tty))).map(t=>({at:Date.parse(t.dt),tty:Number(t.tty)})).filter(e=>Number.isFinite(e.at)).sort((a,b)=>a.at-b.at);
        if(!ev.length)return false;
        const before=ev.filter(e=>e.at<=gotAt).at(-1);
        return before?before.tty===2:ev[0].tty===1;})();
      for(const mate of matesOf(inc.recipientId,inc.playerId)){
        if(laterBuy(mate))continue;
        const key=`TL:${inc.recipientId}:${mate}`;if(seenTl.has(key))continue;seenTl.add(key);
        const here=inSquad(inc.recipientId,mate);
        todo(key,'TL',inc.recipientId,rname,`verkauft ${playerNames.get(mate)||`Spieler-ID ${mate}`} (${clubName(mate)||'gleicher Verein'}), weil ${pname({playerId:inc.playerId})} über ${inc.rule} kommt (Teamlimit 1)`,
          here===null?{state:'unknown',note:'Kader nicht lesbar'}:!here?{state:'done',note:'verkauft'}:onMarket(inc.recipientId,mate)?{state:'progress',note:'steht auf dem Transfermarkt'}:{state:'open',note:'noch im Kader'});
        const buyer=here===false?ownerMap.get(String(mate)):null;
        if(buyer?.managerId&&String(buyer.managerId)!==String(inc.recipientId))todos.at(-1).to=[{managerId:String(buyer.managerId),manager:buyer.manager,playerName:playerNames.get(mate)||null}];
      }
    }
    // Teamlimit nachtraeglich aus dem Transfer-Verlauf des Empfaengers (/managers/{id}/transfer: tty 1 Kauf, 2 Verkauf,
    // tid Verein, dt Zeitpunkt): Verkauf eines anderen Spielers desselben Vereins von 1 Stunde vor bis 72 Stunden nach
    // dem Erhalt. Spieler, die selbst von einer Regel betroffen sind, zaehlen nicht.
    if (!probe && complete) {
      const ruleIds = new Set(todos.map(t => String(t.key).split(':')[2]).filter(Boolean));
      for (const w of dd) { const got = (w.candidates || []).find(c => lastIdsTl.includes(String(ownerMap.get(String(c.playerId))?.managerId))); if (got) ruleIds.add(String(got.playerId)); }
      const tCache = new Map();
      const transfersOf = async rid => { if (!tCache.has(rid)) { try { tCache.set(rid, await transfersSince(token, rid, histSince)); } catch { tCache.set(rid, null); } } return tCache.get(rid); };
      for (const inc of incoming) {
        const list = await transfersOf(inc.recipientId); if (!list) continue;
        const got = list.find(t => String(t.pi) === inc.playerId && Number(t.tty) === 1); if (!got) continue;
        const club = String(got.tid), at = Date.parse(got.dt);
        const rname = String(managers.find(m => String(m.i) === inc.recipientId)?.n || inc.recipientId);
        for (const t of list) {
          const pid = String(t.pi), when = Date.parse(t.dt);
          if (Number(t.tty) !== 2 || String(t.tid) !== club || pid === inc.playerId || ruleIds.has(pid)) continue;
          if (!(when >= at - 3600e3 && when <= at + 72 * 3600e3)) continue;
          const key = `TL:${inc.recipientId}:${pid}`; if (seenTl.has(key)) continue; seenTl.add(key);
          todo(key, 'TL', inc.recipientId, rname, `verkauft ${t.pn || playerNames.get(pid) || `Spieler-ID ${pid}`} (gleicher Verein), weil ${pname({ playerId: inc.playerId })} über ${inc.rule} kam (Teamlimit 1)`,
            { state: 'done', note: `laut Transfer-Verlauf verkauft${t.othnm ? ' an ' + t.othnm : ' an den Markt'}` });
          // Kaeufer fuer die Auswahl „automatisch: …“ (Kevin-Meldung: stand „nicht erkannt“, obwohl der Verlauf ihn kennt).
          if (t.othnm) { const b = managers.find(m => String(m.n) === String(t.othnm)); todos.at(-1).to = [{ managerId: b ? String(b.i) : null, manager: String(t.othnm), playerName: t.pn || playerNames.get(pid) || null }]; }
        }
      }
    }
    // Verkaufszeitpunkt je Strafe (Kevin-Wunsch): Laut Regel muss bis 22:00 Uhr am Tag nach dem Spieltag verkauft sein
    // (Tag nach dem letzten Anstoss, deutsche Zeit). Aus dem Transfer-Verlauf des Abgebenden: erster Verkauf nach dem letzten Anstoss.
    let saleDeadline=null;
    if(!probe){
      let win=null;try{win=await dayWindow(day);}catch{win=null;}
      if(win){
        saleDeadline=berlinNextDay22(win.end);
        const sCache=new Map();
        const salesList=async gid=>{if(!sCache.has(gid)){try{sCache.set(gid,await transfersSince(token,gid,histSince));}catch{sCache.set(gid,null);}}return sCache.get(gid);};
        for(const t of todos){
          if(!['BD','AH','RK','BN','UM','TL','DD'].includes(t.rule))continue;
          const pid=t.rule==='DD'?(t.options||[]).find(o=>o.moved)?.playerId:String(t.key).split(':')[2];
          if(!pid){if(t.check?.state==='open'&&Date.now()>saleDeadline)t.overdue=true;continue;}
          const list=await salesList(String(t.managerId));if(!list)continue;
          const sale=list.filter(x=>String(x.pi)===String(pid)&&Number(x.tty)===2&&Date.parse(x.dt)>=win.end).sort((a,b)=>Date.parse(a.dt)-Date.parse(b.dt))[0];
          if(sale){t.soldAt=new Date(Date.parse(sale.dt)).toISOString();t.late=Date.parse(sale.dt)>saleDeadline;}
          else if(t.check?.state!=='done'&&Date.now()>saleDeadline)t.overdue=true;
          if(!sale)continue;
          const buyerName=sale.othnm?String(sale.othnm):null,buyer=buyerName?managers.find(m=>String(m.n)===buyerName):null;
          // Pruefung am Verkauf selbst, nicht am heutigen Kader (Kevin-Meldungen Vandevoordt ST 7, Brackelmann ST 6, Nicolas und
          // Musiala ST 4): Spieler koennen spaeter weiterverkauft oder zurueckgekauft sein. Nur ein Verkauf bis 14 Tage nach dem
          // Spieltag zaehlt; von Hand gesetzte Haken (state manual) bleiben unberuehrt.
          if(Date.parse(sale.dt)>win.end+14*864e5||t.check?.state==='manual')continue;
          const viaLog=to=>`laut Transfer-Verlauf an ${to||'den Markt'}`;
          if(t.rule==='TL'||t.rule==='AH'){
            t.check={state:'done',note:buyerName?viaLog(buyerName):'laut Transfer-Verlauf an den Markt verkauft'};
            if(buyerName&&String(buyer?.i)!==String(t.managerId))t.to=[{managerId:buyer?String(buyer.i):null,manager:buyerName,playerName:sale.pn||playerNames.get(String(pid))||null}];
            else delete t.to;
          }
          else if(t.rule==='BD'){
            t.check=buyerName?{state:'unknown',note:`${viaLog(buyerName)} statt an den Markt`}:{state:'done',note:'laut Transfer-Verlauf an den Markt verkauft'};
          }
          else if(t.rule==='UM'&&t.check?.state!=='done'){
            const want=(t.to||[])[0]?.manager||null;
            if(want&&buyerName===want)t.check={state:'done',note:viaLog(want)};
            else if(!want&&!buyerName)t.check={state:'done',note:'laut Transfer-Verlauf an den Markt verkauft'};
            else t.check={state:'unknown',note:`${viaLog(buyerName)}${want?` statt an ${want}`:' statt an den Markt'}`};
          }
          else if((t.rule==='RK'||t.rule==='BN')&&t.check?.state!=='done'){
            t.check=buyerName&&String(buyer?.i)!==String(t.managerId)?{state:'done',note:viaLog(buyerName)}:{state:'unknown',note:`${viaLog(buyerName)} statt an einen Mitmanager`};
            if(buyerName&&buyer)t.to=[{managerId:String(buyer.i),manager:buyerName,playerName:playerNames.get(String(pid))||null}];
          }
        }
      }
    }
    return res.set('Cache-Control','no-store').json({day,ready:true,status:testMode?'test':probe?'probe':'provisional',testMode,probe,complete,pendingCorrections:centerConflicts.length?{count:centerConflicts.length,examples:centerConflicts.slice(0,5).map(c=>({playerName:playerNames.get(c.playerId)||c.playerId,performance:c.performance,center:c.center}))}:null,todos,saleDeadline:saleDeadline?new Date(saleDeadline).toISOString():null,expected:managers.length,missing,invalid,incompletePoints,missingPoints,missingDetails,pointDiagnostics,failures,plausibility,managers:roster.length,
      actions:bdActive.map(p=>({rule:'BD',managerId:p.managerId,manager:p.manager,playerId:p.playerId,playerName:p.playerName,points:p.points,action:'Spieler an den Markt verkaufen',status:'zu_pruefen',marketStatus:p.marketStatus})),
      mm:mm&&{...mm,values:mm.values.map(v=>({...v,negatives:v.negatives.map(n=>({...n,playerName:playerNames.get(String(n.playerId))||null}))}))},ah:{...ahFinal,affected:(ahFinal.affected||[]).map(p=>({...p,playerName:playerNames.get(String(p.playerId))||null}))},autoEvents,bd:bdActive,bdDropped,conflicts,dd:{winners:complete?dd:[],lastPlace:complete?last.map(m=>({managerId:m.managerId,manager:m.manager||m.name,dayPoints:m.dayPoints})):[],tie:complete&&tie},
      warnings:[...histNotes,...(probe?[`PROBELAUF: Die heutigen Aufstellungen wurden als Startelf von Spieltag ${day} angenommen. Nur ein Funktionstest, keine echte Abrechnung, nichts gespeichert.`,...(probeUnreadable.length?[`Startelf nicht lesbar bei: ${probeUnreadable.join(', ')}.`]:[])]:[]),...(rankingWarning?[rankingWarning]:[]),...(inferredZero.size?[`${inferredZero.size} aufgestellte Spieler hatten keinen Spieltagseintrag und wurden mit 0 Punkten gewertet (nicht eingesetzt): ${[...inferredZero].map(id=>playerNames.get(String(id))||id).join(', ')}.`]:[]),...(fromCenter.size?[`${fromCenter.size} aufgestellte Spieler hatten keinen Eintrag in den Leistungsdaten; die Punkte stammen aus den Spieltagsdaten: ${[...fromCenter].map(([id,pt])=>(playerNames.get(String(id))||id)+' ('+pt+')').join(', ')}.`]:[]),...(centerConflicts.length?[`Abweichende Punkte in zwei Quellen (verwendet: Leistungsdaten): ${centerConflicts.map(c=>(playerNames.get(c.playerId)||c.playerId)+' '+c.performance+' statt '+c.center).join(', ')}.`]:[]),...(!complete?['Unvollständige Daten: BD zeigt alle nachgewiesenen Schnapszahlen; weitere BD-Fälle können fehlen. DD und MM sind nicht verbindlich berechenbar.']:[]),...incompletePoints.map(m=>m.name+': Spielerpunkte fehlen ('+m.playerIds.length+' Spieler-IDs: '+m.playerIds.map(id=>{if(failedIds.has(String(id)))return id+' [API-Fehler]';const rec=findDayRecord(performancePayloads.get(id),day);if(!rec)return id+' [kein Spieltagseintrag]';const keep={};for(const k of ['day','p','mp','st','cur','mdst','md','k'])if(rec[k]!==undefined)keep[k]=rec[k];return id+' [Eintrag ohne verwertbare Punkte: '+JSON.stringify(keep)+']';}).join(', ')+').'),...missing.map(m=>m.name+': Aufstellung fehlt.'),...invalid.map(m=>m.name+': '+m.reason),...scored.filter(m=>!Number.isFinite(m.dayPoints)).map(m=>m.name+': Spieltagspunkte laut Ranking nicht ermittelbar.'),...(ahFinal.mvp&&!ahFinal.mvp.error&&ahFinal.mvp.reliable?[]:['AH: Der Spieltags-MVP konnte nicht sicher ermittelt werden'+(ahFinal.mvp?.error?' ('+ahFinal.mvp.error+')':ahFinal.mvp?` (${ahFinal.mvp.failedPlayers} Spieler nicht abrufbar, ${(ahFinal.mvp.failedTeams||[]).length} Vereine nicht lesbar)`:'')+'. AH und die Ausschlüsse bei der Drehtür sind unsicher.']),
        'Marktwerte (BN, RK) werden noch nicht berücksichtigt.','Nur Anzeige: keine automatischen Transfers oder Gebote.']});
  } catch(err) {res.status(err.status||502).json({error:'Abrechnung fehlgeschlagen.',detail:err.message});}
});

// ===== Arena (Kevin-Wunsch): zweite Liga "Legenden Arena" (12612349), Head-to-Head. Jeden Spieltag neue Elf mit Kapitaen (Punkte doppelt).
// Kickbase: /v4/leagues/{id}/matchups (mds[]: day, sd, ed, it[] Paare u1/u2 mit i, n, uim, p = Spieltagspunkte, hhsp) und
// /ranking?dayNumber=N (us[]: lp Elf, cpti Kapitaen, hhoui Gegner, hhsp H2H-Punkte, hhpl H2H-Platz, sp Gesamtpunkte, mdp).
// Lesen darf das nur ein Mitglied der Arena (T800, nur auf dem PC, nie von GitHub). Jeder erfolgreiche Abruf landet in
// kbl-arena.json; ohne Zugriff (GitHub) wird diese Datei genommen. Live-Punkte je Spieler wie beim MVP-Tipp (dayPlayerPoints),
// das darf jedes Konto. Aufstellungen eines noch nicht angepfiffenen Spieltags werden nie gezeigt.
const ARENA_ID = '12612349', ARENA_FILE = path.join(process.cwd(), 'kbl-arena.json'), ARENA_POINTS_FILE = path.join(process.cwd(), 'kbl-arena-points.json');
function readArena(){try{return JSON.parse(fs.readFileSync(ARENA_FILE,'utf8'));}catch{return null;}}
function saveArena(d){const {points,source,fetchError,...rest}=d;const tmp=ARENA_FILE+'.tmp';fs.writeFileSync(tmp,JSON.stringify(rest));fs.renameSync(tmp,ARENA_FILE);arenaUpload(rest).catch(e=>{arenaUploadState.error=e.message;});}
// Spielerpunkte beendeter Spieltage in eigener Datei: die schreibt jeder selbst (PC und GitHub), kbl-arena.json schreibt nur der PC.
function readArenaPoints(){try{return JSON.parse(fs.readFileSync(ARENA_POINTS_FILE,'utf8'));}catch{return {};}}
function saveArenaPoints(d){const tmp=ARENA_POINTS_FILE+'.tmp';fs.writeFileSync(tmp,JSON.stringify(d));fs.renameSync(tmp,ARENA_POINTS_FILE);}
// Kevin-Entscheidung: Der PC schickt kbl-arena.json selbst zu GitHub (Branch main), damit die Online-Seite die Duelle kennt.
// Schluessel nur in der Umgebung (KBL_GITHUB_TOKEN in start.bat, fein eingeschraenkt: nur dieses Repository, Contents lesen/schreiben).
// Nur bei geaenderten Paarungen/Aufstellungen/Tabelle, hoechstens alle 10 Minuten. Auf GitHub selbst nie.
const arenaUploadState={at:0,hash:null,error:null,lastOk:null};
async function arenaUpload(d){
 const gh=process.env.KBL_GITHUB_TOKEN;if(ON_GITHUB||!gh)return;
 const hash=crypto.createHash('sha1').update(JSON.stringify([d.matchups,d.lineups,d.table?.rows])).digest('hex');
 if(hash===arenaUploadState.hash||Date.now()-arenaUploadState.at<10*60e3)return;
 arenaUploadState.at=Date.now();
 const url='https://api.github.com/repos/TEE800/kbl-legenden/contents/kbl-arena.json';
 const h={Authorization:`Bearer ${gh}`,Accept:'application/vnd.github+json','User-Agent':'kbl-legenden-app'};
 const cur=await fetch(url+'?ref=main',{headers:h,signal:AbortSignal.timeout(15000)});
 const sha=cur.ok?(await cur.json()).sha:undefined;
 const r=await fetch(url,{method:'PUT',headers:{...h,'Content-Type':'application/json'},signal:AbortSignal.timeout(20000),
  body:JSON.stringify({message:'Arena-Daten vom PC',branch:'main',content:Buffer.from(JSON.stringify(d)).toString('base64'),...(sha?{sha}:{})})});
 if(!r.ok)throw new Error(`GitHub HTTP ${r.status}`);
 arenaUploadState.hash=hash;arenaUploadState.error=null;arenaUploadState.lastOk=new Date().toISOString();
 console.log('Arena-Daten zu GitHub geschickt.');
}
let arenaMem=null;const arenaDayCache=new Map();
async function arenaReadToken(req){
 const t=getToken(req)||newestToken();if(t)return t;
 if(ON_GITHUB)return getServiceToken().catch(()=>null);// T1000: klappt nur, falls er Mitglied der Arena ist
 return getChallengeToken().catch(()=>null);
}
// Holt Paarungen und Aufstellungen von Kickbase (hoechstens alle 5 Min.) und mischt sie in kbl-arena.json.
async function arenaState(req,days=[]){
 const file=readArena()||{league:{id:ARENA_ID}};
 if(arenaMem&&Date.now()-arenaMem.at<5*60e3&&days.every(d=>arenaMem.days.has(d)))return arenaMem.value;
 const token=await arenaReadToken(req);
 if(!token)return file.matchups?{...file,source:'datei'}:file;
 try{
  const L=`/v4/leagues/${ARENA_ID}`;
  const mu=await kbFetch(`${L}/matchups`,{token});
  const managers={...(file.managers||{})};
  const matchups=(mu.mds||[]).map(m=>({day:Number(m.day),name:m.mdln||`Spieltag ${m.day}`,start:m.sd||null,end:m.ed||null,live:!!m.il,
   pairs:(m.it||[]).map(x=>{for(const u of [x.u1,x.u2])if(u?.i!=null)managers[String(u.i)]={n:u.n||managers[String(u.i)]?.n||'',uim:u.uim||managers[String(u.i)]?.uim||null};
    return [String(x.u1?.i??''),String(x.u2?.i??''),x.u1?.p??null,x.u2?.p??null];})}));
  const lineups={...(file.lineups||{})};let table=file.table||null;
  const md=days.length?await loadMatchdays().catch(()=>null):null;
  for(const d of [...new Set(days)]){
   const r=await kbFetch(`${L}/ranking?dayNumber=${d}`,{token});
   // Kevin-Vorgabe: wie die Startelfen der BumsParade mit dem ersten Anpfiff eingefroren. Nach dem Anpfiff gelesene
   // Aufstellungen bekommen frozen und werden nie mehr ueberschrieben (nur die Kickbase-Punkte mdp laufen weiter).
   const kick=Date.parse(md?.days.find(x=>Number(x.day)===Number(d))?.firstKickoffUTC||'');
   const afterKick=Number.isFinite(kick)&&Date.now()>=kick;
   const old=lineups[d]||{};lineups[d]={};
   for(const u of (r.us||[])){const id=String(u.i);if(!managers[id])managers[id]={n:u.n||'',uim:u.uim||null};
    const fresh={lp:(u.lp||[]).filter(x=>x!=null).map(String),cpt:u.cpti!=null?String(u.cpti):null,opp:u.hhoui!=null?String(u.hhoui):null,mdp:u.mdp??null};
    if(old[id]?.frozen)lineups[d][id]={...old[id],mdp:fresh.mdp};
    else lineups[d][id]=afterKick&&fresh.lp.length?{...fresh,frozen:new Date().toISOString()}:fresh;}
   for(const id of Object.keys(old))if(old[id]?.frozen&&!lineups[d][id])lineups[d][id]=old[id];
   if(!table||d>=table.day)table={day:d,at:new Date().toISOString(),rows:(r.us||[]).map(u=>({id:String(u.i),n:u.n,hhsp:u.hhsp??null,hhpl:u.hhpl??null,sp:u.sp??null,spl:u.spl??null}))};
  }
  const value={...file,league:{id:ARENA_ID,name:'Legenden Arena'},updatedAt:new Date().toISOString(),managers,matchups,lineups,table,source:'kickbase'};
  try{saveArena(value);}catch{}
  arenaMem={at:Date.now(),days:new Set(days),value};
  return value;
 }catch(e){
  // Kein Mitglied (z. B. Dienst-Login auf GitHub) oder Kickbase nicht erreichbar: gespeicherter Stand.
  return file.matchups?{...file,source:'datei',fetchError:e.status||e.message}:{...file,fetchError:e.status||e.message};
 }
}
async function arenaAuto(){
 if(ON_GITHUB||!process.env.KBL_GITHUB_TOKEN)return;
 try{const md=await loadMatchdays();const live=md.days.find(d=>d.status==='live')?.day,cur=live||md.lastFinishedDay;
  if(!live&&Date.now()-arenaUploadState.at<2*3600e3&&arenaUploadState.hash)return;
  arenaMem=null;await arenaState({headers:{}},cur?[cur]:[]);}catch(e){arenaUploadState.error=e.message;}
}
setInterval(arenaAuto,15*60e3).unref();setTimeout(arenaAuto,60e3).unref();
// Kevin-Wunsch: Auch die Challenge-/Rush-Daten schickt der PC selbst zu GitHub (GitHub darf sich nie mit T800 anmelden und laedt sie
// darum nicht selbst). Gleicher Schluessel wie bei der Arena; nur wenn sich updatedAt geaendert hat, Pruefung alle 15 Min.
const challengeUploadState={updatedAt:null,error:null,lastOk:null};
async function challengeUpload(){
 const gh=process.env.KBL_GITHUB_TOKEN;if(ON_GITHUB||!gh)return;
 let raw;try{raw=fs.readFileSync(path.join(process.cwd(),'kbl-challenge-cache.json'),'utf8');}catch{return;}
 let c;try{c=JSON.parse(raw);}catch{return;}
 if(!c.updatedAt||c.updatedAt===challengeUploadState.updatedAt||c.running)return;
 const url='https://api.github.com/repos/TEE800/kbl-legenden/contents/kbl-challenge-cache.json';
 const h={Authorization:`Bearer ${gh}`,Accept:'application/vnd.github+json','User-Agent':'kbl-legenden-app'};
 try{
  const cur=await fetch(url+'?ref=main',{headers:{...h,Accept:'application/vnd.github.raw+json'},signal:AbortSignal.timeout(20000)});
  const old=cur.ok?await cur.json().catch(()=>null):null;
  // Nie einen aelteren Stand ueber einen neueren schreiben.
  if(old?.updatedAt&&old.updatedAt>=c.updatedAt){challengeUploadState.updatedAt=c.updatedAt;return;}
  const meta=await fetch(url+'?ref=main',{headers:h,signal:AbortSignal.timeout(15000)});
  const sha=meta.ok?(await meta.json()).sha:undefined;
  const r=await fetch(url,{method:'PUT',headers:{...h,'Content-Type':'application/json'},signal:AbortSignal.timeout(30000),
   body:JSON.stringify({message:'Challenge-Daten vom PC',branch:'main',content:Buffer.from(raw).toString('base64'),...(sha?{sha}:{})})});
  if(!r.ok)throw new Error(`GitHub HTTP ${r.status}`);
  challengeUploadState.updatedAt=c.updatedAt;challengeUploadState.error=null;challengeUploadState.lastOk=new Date().toISOString();
  console.log('Challenge-Daten zu GitHub geschickt.');
 }catch(e){challengeUploadState.error=e.message;}
}
setInterval(challengeUpload,15*60e3).unref();setTimeout(challengeUpload,90e3).unref();
// Transferhistorie (Kevin-Wunsch, Reiter "Transfers"): Käufe und Verkäufe je Manager mit Preisen, Gewinn/Verlust je Spieler
// (Verkaufspreis minus Kaufpreis) und Summen. Quelle: /managers/{id}/transfer (it[]: pi, pn, tid, tty 1 Kauf / 2 Verkauf,
// othnm Gegenüber, ohne = Markt, trp Preis, dt) und der heutige Kader (prc Kaufpreis laut Kickbase, mv Marktwert, mvgl = mv - prc).
// Verkauf ohne Kauf im Verlauf = Startkader: kein Kaufpreis, darum kein Gewinn/Verlust (nie raten).
// Zeitraum (Kevin: Halbserien): from/to in ms (to = null = offen); current = laufende Halbserie (dann mit heutigem Kader).
// Gezählt wird ein Deal im Zeitraum, in dem er endet (Verkauf); Käufe und Verkäufe je Zeitraum nach Datum.
function buildTransferHistory(list, squad, from = 0, to = null, current = to == null) {
  const asc = [...list].filter(t => t && t.pi != null && (t.tty === 1 || t.tty === 2) && Number.isFinite(Number(t.trp)))
    .sort((a, b) => Date.parse(a.dt) - Date.parse(b.dt));
  const side = t => ({ price: Number(t.trp), at: t.dt || null, other: t.othnm || null });
  const open = new Map(), trades = [];
  for (const t of asc) {
    const pi = String(t.pi), base = { id: pi, name: t.pn || '?', team: t.tid != null ? String(t.tid) : null, img: t.pim || null };
    if (t.tty === 1) {
      // Zweiter Kauf ohne Verkauf dazwischen: Verkauf fehlt im Verlauf, alter Kauf bleibt ohne Verkaufspreis stehen.
      if (open.has(pi)) trades.push({ ...open.get(pi), status: 'unknown' });
      open.set(pi, { ...base, buy: side(t), sell: null });
    } else {
      const o = open.get(pi); open.delete(pi);
      const tr = o ? { ...o, ...base, sell: side(t) } : { ...base, buy: null, sell: side(t) };
      tr.status = tr.buy ? 'sold' : 'start';
      if (tr.buy) { tr.diff = tr.sell.price - tr.buy.price; tr.days = Math.max(0, Math.round((Date.parse(tr.sell.at) - Date.parse(tr.buy.at)) / 864e5)); }
      trades.push(tr);
    }
  }
  const sq = new Map(((squad && squad.it) || []).map(p => [String(p.pi), p]));
  for (const o of open.values()) {
    const p = sq.get(o.id);
    if (!p) { trades.push({ ...o, status: 'unknown' }); continue; }
    const mv = Number.isFinite(Number(p.mv)) ? Number(p.mv) : null;
    trades.push({ ...o, status: 'held', mv, diff: mv != null ? mv - o.buy.price : null, days: Math.max(0, Math.round((Date.now() - Date.parse(o.buy.at)) / 864e5)) });
    sq.delete(o.id);
  }
  // Spieler im Kader ohne Kauf im Verlauf (Startkader): Kaufpreis laut Kickbase (prc), Marktwert heute.
  for (const p of sq.values()) {
    const mv = Number.isFinite(Number(p.mv)) ? Number(p.mv) : null, prc = Number.isFinite(Number(p.prc)) && Number(p.prc) > 0 ? Number(p.prc) : null;
    trades.push({ id: String(p.pi), name: p.pn || '?', team: p.tid != null ? String(p.tid) : null, img: p.pim || null, buy: prc != null ? { price: prc, at: null, other: null } : null, sell: null,
      status: 'held', start: true, mv, diff: mv != null && prc != null ? mv - prc : null });
  }
  const inRange = iso => { const x = Date.parse(iso); return x >= from && (to == null || x < to); };
  const keep = t => t.status === 'held' ? current : inRange((t.sell || t.buy || {}).at);
  for (let i = trades.length - 1; i >= 0; i--) if (!keep(trades[i])) trades.splice(i, 1);
  const own = asc.filter(t => inRange(t.dt));
  const sum = f => trades.reduce((s, t) => s + (f(t) || 0), 0);
  const sold = trades.filter(t => t.status === 'sold'), held = trades.filter(t => t.status === 'held');
  const best = sold.reduce((b, t) => !b || t.diff > b.diff ? t : b, null), worst = sold.reduce((b, t) => !b || t.diff < b.diff ? t : b, null);
  const pick = t => t && { id: t.id, name: t.name, diff: t.diff };
  return {
    buys: own.filter(t => t.tty === 1).length, sells: own.filter(t => t.tty === 2).length,
    spent: own.filter(t => t.tty === 1).reduce((s, t) => s + Number(t.trp), 0), earned: own.filter(t => t.tty === 2).reduce((s, t) => s + Number(t.trp), 0),
    realized: sum(t => t.status === 'sold' ? t.diff : 0), soldCount: sold.length, wins: sold.filter(t => t.diff > 0).length, losses: sold.filter(t => t.diff < 0).length,
    unrealized: sum(t => t.status === 'held' ? t.diff : 0), squadValue: sum(t => t.status === 'held' ? t.mv : 0), heldCount: held.length,
    startSold: trades.filter(t => t.status === 'start').length, unknown: trades.filter(t => t.status === 'unknown').length,
    best: pick(best), worst: pick(worst),
    trades: trades.sort((a, b) => Date.parse((b.sell || b.buy || {}).at || 0) - Date.parse((a.sell || a.buy || {}).at || 0))
  };
}
// Transfer-Verlauf fuer die BumsParade: seitenweise (25 je Seite) bis vor `since` zurueck. Nur die erste Seite reichte bei alten
// Spieltagen nicht (Kevin-Meldung ST 1: Schwaebe als verkauft angezeigt und zugleich „Frist abgelaufen, noch nicht verkauft“).
const transferSinceCache=new Map();
async function transfersSince(token,id,since=0){
  const c=transferSinceCache.get(id);if(c&&Date.now()-c.at<120e3&&c.since<=since)return c.list;
  const seen=new Set(),all=[];
  for(let page=0;page<80;page++){
    const r=await kbFetch(`/v4/leagues/6422780/managers/${id}/transfer${all.length?`?start=${all.length}`:''}`,{token});
    let neu=0,oldest=Infinity;
    for(const t of (r.it||[])){const k=`${t.pi}|${t.tty}|${t.dt}`;oldest=Math.min(oldest,Date.parse(t.dt));if(!seen.has(k)){seen.add(k);all.push(t);neu++;}}
    if(!neu||oldest<since)break;
  }
  transferSinceCache.set(id,{at:Date.now(),since,list:all});
  return all;
}
// Kickbase liefert den Verlauf seitenweise (25 je Seite): weiter mit ?start=, solange neue Einträge kommen (höchstens 80 Seiten).
async function fetchTransferList(token, id) {
  const seen = new Set(), all = [];
  for (let page = 0; page < 80; page++) {
    const r = await kbFetch(`/v4/leagues/6422780/managers/${id}/transfer${all.length ? `?start=${all.length}` : ''}`, { token });
    let neu = 0;
    for (const t of (r.it || [])) { const k = `${t.pi}|${t.tty}|${t.dt}`; if (!seen.has(k)) { seen.add(k); all.push(t); neu++; } }
    if (!neu) break;
  }
  return all;
}
let transferCache = null;
// Halbserien aus den Rücksetzungen der Liga: Kickbase startet jede Saison ein paar Wochen vor Spieltag 1, vorher ruht der Markt.
// Eine Lücke von mindestens 5 Tagen ohne einen einzigen Transfer in der ganzen Liga = Rücksetzung; die Halbserie beginnt mit dem ersten Transfer danach.
// Name nach dem Startmonat: Juni bis Oktober = Hinrunde, sonst Rückrunde. Ergibt sich derselbe Name zweimal, wird nicht geteilt (nie raten).
function transferPeriods(times, now = Date.now()) {
  const ts = [...new Set(times.filter(Number.isFinite))].sort((a, b) => a - b);
  if (!ts.length) return [];
  const starts = [ts[0]];
  for (let i = 1; i < ts.length; i++) if (ts[i] - ts[i - 1] >= 5 * 864e5) starts.push(ts[i]);
  const keyOf = ms => { const d = new Date(ms), m = d.getUTCMonth(), y = m >= 5 ? d.getUTCFullYear() : d.getUTCFullYear() - 1; return `${m >= 5 && m <= 9 ? 'Hinrunde' : 'Rückrunde'} ${y}/${String(y + 1).slice(2)}`; };
  const periods = [];
  for (const st of starts) { const key = keyOf(st); if (periods.length && periods[periods.length - 1].key === key) continue; if (periods.length) periods[periods.length - 1].to = st; periods.push({ key, from: st, to: null }); }
  // Der Zeitraum beginnt am Tag des ersten Transfers (0 Uhr UTC), damit nichts vom ersten Tag fehlt.
  for (const pd of periods) pd.from = Date.UTC(new Date(pd.from).getUTCFullYear(), new Date(pd.from).getUTCMonth(), new Date(pd.from).getUTCDate());
  for (let i = 0; i < periods.length - 1; i++) periods[i].to = periods[i + 1].from;
  return periods.reverse();
}
app.get('/api/transfers', async (req, res) => {
  const token = getToken(req) || newestToken();
  if (!token) return res.status(401).json({ error: 'Nicht angemeldet.' });
  if (transferCache && Date.now() - transferCache.at < 30 * 60e3 && req.query.neu !== '1') return res.set('Cache-Control', 'no-store').json(transferCache.value);
  try {
    const ranking = await kbFetch('/v4/leagues/6422780/ranking', { token });
    const users = (ranking.us || []).filter(u => validManager(u.i) && String(u.n || '').toLowerCase() !== 't1000');
    const raw = [];
    for (let i = 0; i < users.length; i += 3) raw.push(...await Promise.all(users.slice(i, i + 3).map(async u => {
      const base = { id: String(u.i), name: u.n, img: u.uim || null };
      try {
        const [list, squad] = await Promise.all([fetchTransferList(token, u.i), kbFetch(`/v4/leagues/6422780/managers/${u.i}/squad`, { token }).catch(() => null)]);
        return { base, list, squad };
      } catch (e) { return { base, error: e.message }; }
    })));
    // Halbserien (Kevin: die Liga spielt Halbserien) ab den Rücksetzungen, neueste zuerst; die letzte läuft noch.
    const now = Date.now(), periods = transferPeriods(raw.flatMap(r => (r.list || []).map(t => Date.parse(t.dt))), now);
    const seasons = periods.map(pd => {
      const current = pd.to == null;
      const managers = raw.map(r => r.error ? { ...r.base, error: r.error } : { ...r.base, squadMissing: current && !r.squad, ...buildTransferHistory(r.list, r.squad, pd.from, pd.to, current) })
        .filter(m => current || m.error || m.buys || m.sells).sort((a, b) => (b.realized ?? -Infinity) - (a.realized ?? -Infinity));
      return { key: pd.key, current, from: new Date(pd.from).toISOString(), to: pd.to == null ? null : new Date(pd.to).toISOString(), managers };
    }).filter(se => se.current || se.managers.length);
    const value = { updatedAt: new Date().toISOString(), seasons };
    transferCache = { at: Date.now(), value, raw };
    res.set('Cache-Control', 'no-store').json(value);
  } catch (err) { res.status(err.status || 502).json({ error: 'Transfers konnten nicht geladen werden.', detail: err.message }); }
});

// Transfer-Pech-Radar (Kevin-Wunsch 28.10., Reiter "Transfers"): Spieler, die ein Manager verkauft hat und die gleich am nächsten
// Spieltag gepunktet haben. Nächster Spieltag = erster Spieltag, dessen erster Anstoß (OpenLigaDB) nach dem Verkauf liegt; nur
// abgeschlossene Spieltage, Punkte aus den Leistungsdaten (nur Saison 2026/27, darum nur die laufende Halbserie). Hat der Verkäufer
// ihn vor dem Anstoß zurückgekauft, zählt der Verkauf nicht. Pech ab PECH_MIN Punkten; Käufer aus der Liga: ob er ihn in der Startelf
// hatte (ranking?dayNumber lp). Fehlen Punkte, wird der Verkauf nicht gewertet (nie raten).
const PECH_MIN = 100;
let pechCache = null;
app.get('/api/transfer-pech', async (req, res) => {
  const token = getToken(req) || newestToken();
  if (!token) return res.status(401).json({ error: 'Nicht angemeldet.' });
  if (pechCache && Date.now() - pechCache.at < 3 * 3600e3 && req.query.neu !== '1') return res.set('Cache-Control', 'no-store').json(pechCache.value);
  try {
    const md = await loadMatchdays();
    const kick = md.days.filter(d => d.firstKickoffUTC).map(d => ({ day: d.day, at: Date.parse(d.firstKickoffUTC), finished: d.status === 'finished' })).sort((a, b) => a.at - b.at);
    if (!kick.length) throw new Error('Kein Spielplan');
    let raw = transferCache && Date.now() - transferCache.at < 30 * 60e3 && transferCache.raw;
    if (!raw) {
      const ranking = await kbFetch('/v4/leagues/6422780/ranking', { token });
      const users = (ranking.us || []).filter(u => validManager(u.i) && String(u.n || '').toLowerCase() !== 't1000');
      raw = [];
      for (let i = 0; i < users.length; i += 3) raw.push(...await Promise.all(users.slice(i, i + 3).map(async u => {
        const base = { id: String(u.i), name: u.n, img: u.uim || null };
        try { return { base, list: await fetchTransferList(token, u.i) }; } catch (e) { return { base, error: e.message }; }
      })));
    }
    // Nur die laufende Halbserie: sie beginnt mit dem ersten Transfer nach der Rücksetzung der Liga.
    const periods = transferPeriods(raw.flatMap(r => (r.list || []).map(t => Date.parse(t.dt))));
    const from = periods[0]?.from ?? 0;
    const sales = [];
    for (const r of raw) for (const t of (r.list || [])) {
      const at = Date.parse(t.dt);
      if (t.tty !== 2 || t.pi == null || !(at >= from)) continue;
      const next = kick.find(k => k.at > at);
      if (!next || !next.finished) continue;
      // Vor dem Anstoß zurückgekauft: der Verkäufer hatte ihn am Spieltag wieder, kein Pech.
      if (r.list.some(b => b.tty === 1 && String(b.pi) === String(t.pi) && Date.parse(b.dt) > at && Date.parse(b.dt) < next.at)) continue;
      sales.push({ seller: r.base, t, at, next });
    }
    const perf = new Map(); let failed = 0;
    const ids = [...new Set(sales.map(x => String(x.t.pi)))];
    for (let i = 0; i < ids.length; i += 5) await Promise.all(ids.slice(i, i + 5).map(async id => {
      try { perf.set(id, await kbFetch(`/v4/competitions/1/players/${id}/performance`, { token })); } catch { failed++; }
    }));
    const lineups = new Map();
    const lineupOf = async day => {
      if (!lineups.has(day)) {
        try { const r = await kbFetch(`/v4/leagues/6422780/ranking?dayNumber=${day}`, { token }); lineups.set(day, new Map((r.us || []).map(u => [String(u.n || '').toLowerCase(), new Set((u.lp || []).filter(x => x != null).map(String))]))); }
        catch { lineups.set(day, null); }
      }
      return lineups.get(day);
    };
    const items = []; let missing = 0;
    for (const x of sales) {
      const data = perf.get(String(x.t.pi));
      const points = data ? pointFromPerformance(data, x.next.day, true) : null;
      if (points == null) { missing++; continue; }
      const buyer = x.t.othnm || null, lu = buyer ? await lineupOf(x.next.day) : null, bl = lu && lu.get(buyer.toLowerCase());
      items.push({ id: String(x.t.pi), name: x.t.pn || '?', team: x.t.tid != null ? String(x.t.tid) : null, img: x.t.pim || null,
        seller: x.seller, soldAt: x.t.dt, price: Number.isFinite(Number(x.t.trp)) ? Number(x.t.trp) : null, buyer,
        buyerStarted: bl ? bl.has(String(x.t.pi)) : null, day: x.next.day, kickoff: new Date(x.next.at).toISOString(),
        hoursBefore: Math.round((x.next.at - x.at) / 36e5), points });
    }
    items.sort((a, b) => b.points - a.points);
    const value = { updatedAt: new Date().toISOString(), from: new Date(from).toISOString(), min: PECH_MIN, checked: items.length, missing, failedPlayers: failed,
      failedManagers: raw.filter(r => r.error).map(r => r.base.name), items };
    pechCache = { at: Date.now(), value };
    res.set('Cache-Control', 'no-store').json(value);
  } catch (err) { res.status(err.status || 502).json({ error: 'Transfer-Pech-Radar konnte nicht geladen werden.', detail: err.message }); }
});

app.get('/api/arena-upload-status',(req,res)=>res.set('Cache-Control','no-store').json({token:!!process.env.KBL_GITHUB_TOKEN&&!ON_GITHUB,...arenaUploadState}));
app.get('/api/challenge-upload-status',(req,res)=>res.set('Cache-Control','no-store').json({token:!!process.env.KBL_GITHUB_TOKEN&&!ON_GITHUB,...challengeUploadState}));
app.get('/api/arena',async(req,res)=>{
 try{
  const md=await loadMatchdays().catch(()=>null);
  const live=md?.days.find(d=>d.status==='live')?.day,next=md?.days.find(d=>d.status==='upcoming')?.day;
  const cur=live||md?.lastFinishedDay||null;
  const a=await arenaState(req,cur?[cur]:[]);
  if(!a.matchups)return res.status(404).json({error:'Die Arena-Daten fehlen noch. Sie kommen mit dem nächsten Abruf über ein Konto, das in der Legenden Arena spielt (T800 am PC).'});
  const st=d=>md?.days.find(x=>x.day===d)?.status||'unknown';
  res.set('Cache-Control','no-store').json({league:a.league,updatedAt:a.updatedAt||null,source:a.source||null,live:live||null,next:next||null,current:cur,
   days:a.matchups.map(m=>({day:m.day,name:m.name,start:m.start,status:st(m.day)}))});
 }catch(e){res.status(502).json({error:'Arena nicht abrufbar.',detail:e.message});}
});
app.get('/api/arena/:day',async(req,res)=>{
 const day=validDay(req.params.day);if(!day)return res.status(400).json({error:'Ungültiger Spieltag.'});
 try{
  const md=await loadMatchdays().catch(()=>null),mdd=md?.days.find(d=>d.day===day),status=mdd?.status||'unknown';
  const started=status==='live'||status==='finished';
  const c=arenaDayCache.get(day);
  if(c&&(c.final||Date.now()-c.at<5*60e3))return res.set('Cache-Control','no-store').json(c.value);
  const a=await arenaState(req,started?[day]:[]);
  const m=a.matchups?.find(x=>x.day===day);
  if(!m)return res.status(404).json({error:a.matchups?`Für Spieltag ${day} gibt es keine Paarungen.`:'Die Arena-Daten fehlen noch.'});
  const lu=started?(a.lineups?.[day]||null):null;
  // Punkte je Spieler (nur angepfiffene Spieltage). Beendete Spieltage werden in kbl-arena.json gemerkt.
  let pts={};const saved=readArenaPoints()[day];
  if(started&&lu){
   if(status==='finished'&&saved)pts=saved;
   else{
    const tok=getToken(req)||newestToken()||await getServiceToken().catch(()=>null)||await arenaReadToken(req);
    const ids=[...new Set(Object.values(lu).flatMap(x=>x.lp))];
    for(let i=0;i<ids.length;i+=5)await Promise.all(ids.slice(i,i+5).map(async id=>{try{pts[id]=await dayPlayerPoints(tok,id,day,status==='finished');}catch{pts[id]={points:null,state:'error'};}}));
    if(status==='finished'&&ids.length&&ids.every(id=>pts[id]?.state==='done')){try{saveArenaPoints({...readArenaPoints(),[day]:pts});}catch{}}
   }
  }
  const all=started?await loadAllPlayers(getToken(req)||newestToken()||await getServiceToken().catch(()=>null)).catch(()=>null):null;
  // Kickbase-Punkte (p) eines beendeten Spieltags nur nehmen, wenn die Arena-Daten vom PC nach dem letzten Spiel abgerufen wurden
  // (letzter Anstoss + 2,5 Std.). Sonst sind es Zwischenstaende (am 25.10. standen so mehrere Manager auf 0), dann eigene Rechnung.
  const win=status==='finished'?await dayWindow(day).catch(()=>null):null;
  const kbOk=status==='finished'&&!!win&&Date.parse(a.updatedAt||'')>=win.end+150*60e3;
  const side=(id,kb)=>{
   const info=a.managers?.[id]||{},l=lu?.[id];
   const base={id,name:id==='1'?'Kickbase CPU':info.n||`Manager ${id}`,img:info.uim||null,cpu:id==='1'};
   if(!started||!l)return {...base,points:kb??null,kbPoints:kb??null,players:null};
   const players=l.lp.map(pid=>{const q=pts[pid]||{points:null,state:'open'},p=all?.players.get(pid)||all?.players.get(Number(pid));
    const cap=pid===l.cpt,kt=Date.parse(q.kick||''),playing=q.state==='live'&&Number.isFinite(kt)&&kt<=Date.now()&&Date.now()-kt<150*60e3;return {id:pid,playing,name:p?.name||`Spieler ${pid}`,team:p?.team||null,img:p?.img||null,teamImg:p?.teamImg||null,points:q.points,state:q.state,captain:cap,total:q.points==null?null:q.points*(cap?2:1)};})
    .sort((x,y)=>(y.total??-1e9)-(x.total??-1e9));
   const calc=players.reduce((s,p)=>s+(p.total||0),0);
   // Beendet: Kickbase-Punkte zaehlen (offiziell, korrigiert). Laufend: eigene Rechnung (Kickbase zeigt waehrend des Spieltags nicht immer den Stand).
   const points=kbOk&&kb!=null?kb:calc;
   return {...base,points,calc,kbPoints:kb??l.mdp??null,captain:l.cpt,open:players.filter(p=>p.state==='open').length,live:players.filter(p=>p.playing).length,players};
  };
  const duels=m.pairs.map(([x,y,px,py])=>{const A=side(x,px),B=side(y,py);
   const done=status==='finished',diff=A.points!=null&&B.points!=null?A.points-B.points:null;
   return {a:A,b:B,diff,winner:diff==null||!started?null:diff>0?x:diff<0?y:'draw',final:done};});
  // H2H-Tabelle: Kickbase-Stand (hhsp, hhpl), dazu Siege/Unentschieden/Niederlagen aus allen angepfiffenen Spieltagen.
  const rec={};
  for(const mm of a.matchups||[]){const s2=md?.days.find(d=>d.day===mm.day)?.status;if(s2!=='live'&&s2!=='finished')continue;
   // Gezeigter Spieltag mit unsicheren Kickbase-Punkten: Ergebnis aus der eigenen Rechnung (duels).
   const pairs=mm.day===day&&started&&!kbOk?duels.map(d=>[d.a.id,d.b.id,d.a.points,d.b.points]):mm.pairs;
   for(const [x,y,px,py] of pairs){if(px==null||py==null)continue;for(const [u,me,ot] of [[x,px,py],[y,py,px]]){const r=rec[u]||(rec[u]={w:0,d:0,l:0});if(me>ot)r.w++;else if(me<ot)r.l++;else r.d++;}}}
  const table=(a.table?.rows||[]).map(r=>({...r,name:r.id==='1'?'Kickbase CPU':r.n,img:a.managers?.[r.id]?.uim||null,...(rec[r.id]||{w:0,d:0,l:0})})).sort((x,y)=>(x.hhpl??99)-(y.hhpl??99));
  const value={day,name:m.name,status,start:m.start,firstKickoffUTC:mdd?.firstKickoffUTC||m.start,updatedAt:new Date().toISOString(),dataAt:a.updatedAt||null,source:a.source||null,
   lineupsMissing:started&&!lu,duels,table,tableDay:a.table?.day||null};
  const final=status==='finished'&&!!saved&&kbOk;
  arenaDayCache.set(day,{at:Date.now(),final,value});
  res.set('Cache-Control','no-store').json(value);
 }catch(e){res.status(502).json({error:'Arena nicht abrufbar.',detail:e.message});}
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`KBL-Prototyp läuft auf http://localhost:${PORT}`);
  // Adressen fuer Handy/Tablet im selben WLAN anzeigen
  try {
    const nets = Object.entries(os.networkInterfaces()).flatMap(([name, list]) => (list || []).filter(n => n.family === 'IPv4' && !n.internal).map(n => ({ name, address: n.address })));
    if (nets.length) {
      console.log('Vom Handy im selben WLAN (eine dieser Adressen probieren):');
      for (const n of nets) console.log(`  http://${n.address}:${PORT}   (${n.name})`);
    }
  } catch { /* nur Komfort */ }
});
