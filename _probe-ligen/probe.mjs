// Einmaliger Test (2): volle Rohdaten der Spielplaene und Tabellen -> _probe-ligen/roh.json
const B = 'https://api.kickbase.com';
const h = { Accept: 'application/json', 'Accept-Language': 'de-DE,de;q=0.9' };
const lg = await (await fetch(B + '/v4/user/login', { method: 'POST', headers: { ...h, 'Content-Type': 'application/json' }, body: JSON.stringify({ em: process.env.KBL_AUTO_EMAIL, loy: false, pass: process.env.KBL_AUTO_PASSWORD, rep: {} }) })).json();
h.Authorization = 'Bearer ' + lg.tkn;
const out = {};
for (const cid of [1, 2, 3, 4, 9]) for (const p of ['matchdays', 'table']) { out[cid + '/' + p] = await (await fetch(`${B}/v4/competitions/${cid}/${p}`, { headers: h })).json(); await new Promise(r => setTimeout(r, 300)); }
const fs = await import('node:fs'); fs.writeFileSync('_probe-ligen/roh.json', JSON.stringify(out));
