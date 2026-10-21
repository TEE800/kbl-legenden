// Zaehlt im Export-Lauf alle Anfragen von server.js an Kickbase (nur Statistik, aendert nichts).
const orig = globalThis.fetch;
const count = { total: 0, byPath: {} , status: {} };
globalThis.fetch = async (input, opts) => {
  const url = String(typeof input === 'string' ? input : input?.url || '');
  if (url.includes('api.kickbase.com')) {
    count.total++;
    const p = url.replace('https://api.kickbase.com', '').replace(/\?.*$/, '').replace(/\/\d+/g, '/N');
    count.byPath[p] = (count.byPath[p] || 0) + 1;
    const r = await orig(input, opts);
    count.status[r.status] = (count.status[r.status] || 0) + 1;
    return r;
  }
  return orig(input, opts);
};
const report = () => { console.log('KICKBASE-ANFRAGEN', JSON.stringify(count)); process.exit(0); };
process.on('SIGTERM', report);
