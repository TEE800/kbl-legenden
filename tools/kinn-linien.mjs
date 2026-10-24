// Kinnlinien für die Wackelköpfe im MVP-Rennen (Kevin: nur der Kopf, kein Hals, kein Doppelkinn).
// Sucht in jedem Kickbase-Spielerfoto das Gesicht und speichert die 17 Punkte der Kinnlinie (Ohr zu Ohr) in
// kbl-head-landmarks.json. server.js (cropHead) schneidet den Kopf dann genau an dieser Linie ab.
// Läuft nur auf GitHub vor dem Export (seite.yml); die Gesichtserkennung (@vladmandic/face-api, ohne Kickbase,
// nur das Foto aus dem Kickbase-CDN) wird dort nur installiert, wenn neue Fotos dazugekommen sind.
// Aufruf: node tools/kinn-linien.mjs [--pruefen]   (--pruefen: Ende mit Code 3, wenn Fotos fehlen)
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { pngDecode } from './png.mjs';

const ROOT = process.cwd(), FILE = path.join(ROOT, 'kbl-head-landmarks.json');
let players = [];
try { players = JSON.parse(fs.readFileSync(path.join(ROOT, 'site', 'data', 'mvp-tipps_players.json'), 'utf8')).players.filter(p => p.img); } catch {}
let store = { players: {} };
try { store = JSON.parse(fs.readFileSync(FILE, 'utf8')); store.players ||= {}; } catch {}
const todo = players.filter(p => store.players[p.id]?.img !== p.img).slice(0, 600);
if (process.argv.includes('--pruefen')) { console.log(`Kinnlinien: ${todo.length} Fotos ohne Kinnlinie`); process.exit(todo.length ? 3 : 0); }
if (!todo.length) { console.log('Kinnlinien: nichts zu tun'); process.exit(0); }

const require = createRequire(path.join(ROOT, 'package.json'));
let faceapi;
try { require('@tensorflow/tfjs-backend-wasm'); faceapi = require('@vladmandic/face-api/dist/face-api.node-wasm.js'); }
catch (e) { console.log('Kinnlinien: Gesichtserkennung nicht installiert, übersprungen.', e.message); process.exit(0); }
const tf = faceapi.tf;
await tf.setBackend('wasm'); await tf.ready();
const MODEL = path.join(path.dirname(require.resolve('@vladmandic/face-api/package.json')), 'model');
async function load(net, name) {
  const man = JSON.parse(fs.readFileSync(path.join(MODEL, name + '-weights_manifest.json'), 'utf8'));
  const buf = fs.readFileSync(path.join(MODEL, name + '.bin'));
  await net.loadFromWeightMap(tf.io.decodeWeights(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.length), man[0].weights));
}
await load(faceapi.nets.tinyFaceDetector, 'tiny_face_detector_model');
await load(faceapi.nets.faceLandmark68Net, 'face_landmark_68_model');

const save = () => fs.writeFileSync(FILE, JSON.stringify({ updatedAt: new Date().toISOString(), players: store.players }));
let found = 0, none = 0, failed = 0;
for (const [i, p] of todo.entries()) {
  try {
    const url = /^https?:\/\//.test(p.img) ? p.img : 'https://kickbase.b-cdn.net/' + String(p.img).replace(/^\//, '');
    const r = await fetch(url, { signal: AbortSignal.timeout(15000) });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const img = pngDecode(Buffer.from(await r.arrayBuffer()));
    let jaw = null;
    if (img) {
      // Durchsichtige Stellen grau füllen, sonst sieht die Erkennung schwarzen Hintergrund.
      const { w, h, data } = img, rgb = new Int32Array(w * h * 3);
      for (let k = 0; k < w * h; k++) { const a = data[k * 4 + 3] / 255; for (let c = 0; c < 3; c++) rgb[k * 3 + c] = Math.round(data[k * 4 + c] * a + 128 * (1 - a)); }
      const t = tf.tensor3d(rgb, [h, w, 3], 'int32');
      const res = await faceapi.detectSingleFace(t, new faceapi.TinyFaceDetectorOptions({ inputSize: 416, scoreThreshold: 0.3 })).withFaceLandmarks();
      t.dispose();
      if (res) jaw = res.landmarks.positions.slice(0, 17).map(q => [Math.round(q.x), Math.round(q.y)]);
    }
    store.players[p.id] = { img: p.img, jaw };
    jaw ? found++ : none++;
  } catch (e) { failed++; }
  if (i % 50 === 49) save();
}
save();
console.log(`Kinnlinien: ${found} gefunden, ${none} ohne Gesicht, ${failed} nicht abrufbar`);
