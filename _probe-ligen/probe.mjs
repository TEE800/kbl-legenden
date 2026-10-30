// Einmaliger Test: wie liefert Kickbase Spielplaene der Wettbewerbe? Ergebnis -> _probe-ligen/ergebnis.json
const B = 'https://api.kickbase.com';
const h = { Accept: 'application/json', 'Accept-Language': 'de-DE,de;q=0.9' };
const lg = await (await fetch(B + '/v4/user/login', { method: 'POST', headers: { ...h, 'Content-Type': 'application/json' }, body: JSON.stringify({ em: process.env.KBL_AUTO_EMAIL, loy: false, pass: process.env.KBL_AUTO_PASSWORD, rep: {} }) })).json();
h.Authorization = 'Bearer ' + lg.tkn;
const out = {};
const shape = (x, d = 0) => Array.isArray(x) ? [x.length, x.length ? shape(x[0], d + 1) : null] : (x && typeof x === 'object' && d < 6) ? Object.fromEntries(Object.entries(x).map(([k, v]) => [k, shape(v, d + 1)])) : x;
for (const cid of [1, 2, 3, 4, 9]) for (const p of ['matchdays', 'table', 'matchdays/current', 'schedule', 'matches']) {
  const url = `/v4/competitions/${cid}/${p}`;
  try {
    const r = await fetch(B + url, { headers: h }); const t = await r.text(); let j; try { j = JSON.parse(t); } catch { j = t.slice(0, 300); }
    out[url] = { status: r.status, shape: shape(j), sample: JSON.stringify(j).slice(0, cid === 1 || p === 'table' ? 6000 : 2500) };
  } catch (e) { out[url] = { error: String(e) }; }
  await new Promise(r => setTimeout(r, 300));
}
for (const cid of [1, 9]) for (const p of ['matchdays?day=10', 'teams/2/teamprofile']) { const url = `/v4/competitions/${cid}/${p}`; try { const r = await fetch(B + url, { headers: h }); out[url] = { status: r.status, sample: (await r.text()).slice(0, 1500) }; } catch (e) { out[url] = { error: String(e) }; } }
const fs = await import('node:fs'); fs.writeFileSync('_probe-ligen/ergebnis.json', JSON.stringify(out, null, 1));
