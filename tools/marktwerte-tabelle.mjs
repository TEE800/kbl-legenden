// Marktwerte aller Spieler als einfache Tabelle fuer Excel „Daten > Aus dem Web“ (Kevin-Wunsch 18.11.).
// Liest site/data/marktwerte.json (Export) und schreibt site/marktwerte.html (eine HTML-Tabelle, Zahlen ohne Tausenderpunkte)
// und site/marktwerte.csv (UTF-8 mit BOM, Semikolon). Laeuft am Ende von export-static.mjs, also mit jeder Aktualisierung.
// Aufruf auch einzeln: node tools/marktwerte-tabelle.mjs [site-Ordner]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const POS = { 1: 'Torwart', 2: 'Abwehr', 3: 'Mittelfeld', 4: 'Sturm' };
const COLS = ['Platz', 'Spieler', 'Verein', 'Position', 'Marktwert', 'Änderung 1 Tag', 'Änderung 7 Tage', 'Änderung 30 Tage', 'Jahreshoch', 'Jahrestief', 'Besitzer'];
const esc = v => String(v ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

export function marktwerteTabelle(site) {
  const src = path.join(site, 'data', 'marktwerte.json');
  if (!fs.existsSync(src)) return false;
  const d = JSON.parse(fs.readFileSync(src, 'utf8'));
  if (!d.players?.length) return false;
  const mg = new Map((d.managers || []).map(m => [String(m.id), m.name]));
  const rows = [...d.players].sort((a, b) => (b.mv ?? 0) - (a.mv ?? 0) || String(a.n).localeCompare(String(b.n), 'de'))
    .map((p, i) => [i + 1, p.n, p.t || '', POS[p.pos] || '', p.mv, p.d1, p.d7, p.d30, p.hmv, p.lmv, p.owner ? (mg.get(String(p.owner)) || '') : 'frei']);
  const stand = d.date ? new Date(d.date + 'T12:00:00Z').toLocaleDateString('de-DE', { timeZone: 'UTC' }) : '';
  const html = `<!doctype html><html lang="de"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>KBL Legenden · Marktwerte</title>
<style>body{font:14px Arial,sans-serif;margin:16px;background:#fff;color:#111}table{border-collapse:collapse}th,td{border:1px solid #ccc;padding:4px 8px}th{background:#1f3864;color:#fff;text-align:left}td.n{text-align:right}</style></head><body>
<h1>Marktwerte aller Bundesliga-Spieler</h1>
<p>Stand: Kickbase-Anpassung vom ${esc(stand)}, 22 Uhr. ${rows.length} Spieler. Werte in Euro. Besitzer = Manager der Liga KBL Legenden, „frei“ = bei keinem. Als CSV: <a href="marktwerte.csv">marktwerte.csv</a></p>
<table id="marktwerte"><thead><tr>${COLS.map(c => `<th>${c}</th>`).join('')}</tr></thead><tbody>
${rows.map(r => `<tr>${r.map((v, i) => `<td${i === 0 || (i >= 4 && i <= 9) ? ' class="n"' : ''}>${esc(v)}</td>`).join('')}</tr>`).join('\n')}
</tbody></table></body></html>\n`;
  fs.writeFileSync(path.join(site, 'marktwerte.html'), html);
  const c = v => { const s = String(v ?? ''); return /[;"\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
  fs.writeFileSync(path.join(site, 'marktwerte.csv'), '﻿' + [COLS, ...rows].map(r => r.map(c).join(';')).join('\r\n') + '\r\n');
  return rows.length;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  console.log('Marktwert-Tabelle:', marktwerteTabelle(process.argv[2] || path.join(process.cwd(), 'site')));
}
