// Online-Ansicht (GitHub-Seite): Statt des Servers werden fertig exportierte Daten aus data/ gelesen.
// Nur aktiv, wenn die exportierte index.html window.KBL_STATIC setzt. Lokal passiert nichts.
(()=>{
 if(!window.KBL_STATIC)return;
 const key=u=>u.replace(/^\/api\//,'').replace(/[^A-Za-z0-9._-]+/g,'_')+'.json';
 const json=(status,body)=>new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json'}});
 const orig=window.fetch.bind(window);
 window.fetch=async(input,opts={})=>{
  const url=typeof input==='string'?input:input.url;
  const path=url.startsWith(location.origin)?url.slice(location.origin.length):url;
  if(!path.startsWith('/api/'))return orig(input,opts);
  const method=String(opts.method||'GET').toUpperCase();
  if(method!=='GET')return json(403,{error:'Online-Ansicht: Hier kann man nur ansehen.'});
  const r=await orig('data/'+key(path),{cache:'no-store'});
  if(!r.ok)return json(404,{error:'In der Online-Ansicht nicht verfügbar.'});
  const d=await r.json();
  if(d&&typeof d==='object'&&d.__status){const {__status,...rest}=d;return json(__status,rest);}
  return json(200,d);
 };
 // Datenstand anzeigen
 orig('data/_meta.json',{cache:'no-store'}).then(r=>r.json()).then(m=>{
  const el=document.createElement('div');
  el.style.cssText='text-align:center;font-size:12px;opacity:.7;padding:10px 0 80px';
  el.textContent='Datenstand: '+new Date(m.exportedAt).toLocaleString('de-DE',{dateStyle:'short',timeStyle:'short'})+' · aktualisiert sich automatisch';
  document.body.append(el);
 }).catch(()=>{});
})();
