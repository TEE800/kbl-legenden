// Wird im Export-Lauf vor server.js geladen und schont Kickbase:
// - gleiche GET-Anfrage nur einmal pro Lauf (z. B. Leistungsdaten eines Spielers fuer mehrere Spieltage)
// - hoechstens 2 Anfragen gleichzeitig und mindestens 150 ms Abstand
// - bei 429 (zu viele Anfragen) oder Sperre: sofort aufhoeren, keine weiteren Anfragen in diesem Lauf
// Am Ende wird gezaehlt, wie viele Anfragen wirklich an Kickbase gingen.
const orig = globalThis.fetch;
const stats = { gesendet: 0, gespart: 0, status: {}, byPath: {} };
const cache = new Map();
let stop = null, active = 0, last = 0;
const queue = [];
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function slot() {
  while (active >= 2) await new Promise(r => queue.push(r));
  active++;
  const wait = last + 150 - Date.now();
  last = Math.max(Date.now(), last + 150);
  if (wait > 0) await sleep(wait);
}
function release() { active--; const next = queue.shift(); if (next) next(); }
globalThis.fetch = async (input, opts = {}) => {
  const url = String(typeof input === 'string' ? input : input?.url || '');
  if (!url.includes('api.kickbase.com')) return orig(input, opts);
  const method = String(opts.method || 'GET').toUpperCase();
  const key = method === 'GET' ? url + '|' + (opts.headers?.Authorization || '') : null;
  if (key && cache.has(key)) { stats.gespart++; const c = cache.get(key); return new Response(c.body, { status: c.status, headers: c.headers }); }
  if (stop) throw new Error('Kickbase-Abruf gestoppt: ' + stop);
  await slot();
  try {
    // Eigene Zeitgrenze erst ab dem Senden, damit Wartezeit in der Schlange nicht als Zeitueberschreitung zaehlt.
    const r = await orig(input, { ...opts, signal: AbortSignal.timeout(30000) });
    stats.gesendet++;
    stats.status[r.status] = (stats.status[r.status] || 0) + 1;
    const p = url.replace('https://api.kickbase.com', '').replace(/\?.*$/, '').replace(/\/\d+/g, '/N');
    stats.byPath[p] = (stats.byPath[p] || 0) + 1;
    if (r.status === 429) stop = 'Kickbase meldet zu viele Anfragen (429)';
    const body = await r.text();
    const headers = { 'content-type': r.headers.get('content-type') || 'application/json' };
    if (key && r.ok) cache.set(key, { body, status: r.status, headers });
    return new Response(body, { status: r.status, headers });
  } finally { release(); }
};
const report = () => { console.log('KICKBASE-ANFRAGEN', JSON.stringify({ ...stats, gestoppt: stop })); process.exit(0); };
process.on('SIGTERM', report);
