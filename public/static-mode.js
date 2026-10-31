// Online-Ansicht (GitHub-Seite): Statt des Servers werden fertig exportierte Daten aus data/ gelesen.
// Nur aktiv, wenn die exportierte index.html window.KBL_STATIC setzt. Lokal passiert nichts.
(()=>{
 if(!window.KBL_STATIC)return;
 const key=u=>u.replace(/^\/api\//,'').replace(/[^A-Za-z0-9._-]+/g,'_')+'.json';
 const json=(status,body)=>new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json'}});
 const orig=window.fetch.bind(window);
 // BumsParade-Haken online (Kevin-Wunsch): mit Admin-Code des Tippdienstes speichern. Der Tippdienst haelt sie,
 // hier werden sie sofort zum exportierten Stand gemischt (neuerer Zeitstempel gewinnt, done:false hebt einen Haken auf).
 const API=String(window.KBL_TIPP_API||'').replace(/\/+$/,''),CODE='kbl-admin-haken';
 // Admin-Reiter (Prüfwerkzeuge) online nur nach Anmeldung mit Admin-Code (Klasse kbl-no-admin blendet .admin-only aus).
 const adminMark=on=>document.documentElement.classList.toggle('kbl-no-admin',!on);
 const store={get(){try{return localStorage.getItem(CODE)||'';}catch{return '';}},set(v){try{v?localStorage.setItem(CODE,v):localStorage.removeItem(CODE);}catch{}adminMark(!!v);}};
 adminMark(!!(API&&store.get()));
 const mergeChecks=(base,over)=>{const out={...(base||{})};for(const [k,v] of Object.entries(over||{})){const b=out[k];if(b?.at&&v?.at&&b.at>=v.at)continue;if(v?.done){const {done,target,removed,at}=v;out[k]={done,at,...(target?{target}:{}),...(removed?{removed:true}:{})};}else delete out[k];}return out;};
 const remote=async(p,o)=>{const r=await orig(API+p,{cache:'no-store',...o});const d=await r.json().catch(()=>({}));if(!r.ok){const e=Error(d.error||'Tippdienst nicht erreichbar.');e.status=r.status;throw e;}return d;};
 window.kblHaken={on:!!API,admin:()=>!!(API&&store.get()),
  async login(code){await remote('/haken/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({adminCode:code})});store.set(code);},
  logout(){store.set('');}};
 const hakenDay=p=>{const m=/^\/api\/todo-checks\/(\d{1,2})(\?|$)/.exec(p);return m?Number(m[1]):null;};
 window.fetch=async(input,opts={})=>{
  const url=typeof input==='string'?input:input.url;
  const path=url.startsWith(location.origin)?url.slice(location.origin.length):url;
  if(!path.startsWith('/api/'))return orig(input,opts);
  const method=String(opts.method||'GET').toUpperCase(),hd=API?hakenDay(path):null;
  if(hd&&method==='POST'){
   if(!store.get())return json(403,{error:'Bitte zuerst als Admin anmelden.'});
   let b={};try{b=JSON.parse(opts.body||'{}');}catch{}
   try{const [base,d]=await Promise.all([orig('data/'+key(path),{cache:'no-store'}).then(r=>r.ok?r.json():{}).catch(()=>({})),remote(`/haken/${hd}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...b,adminCode:store.get()})})]);
    return json(200,{day:hd,checks:mergeChecks(base.checks,d.checks)});}
   catch(e){if(e.status===403)store.set('');return json(e.status||502,{error:e.message});}
  }
  if(method!=='GET')return json(403,{error:'Online-Ansicht: Hier kann man nur ansehen.'});
  if(hd){
   const [r,over]=await Promise.all([orig('data/'+key(path),{cache:'no-store'}),remote(`/haken/${hd}`).then(d=>d.checks).catch(()=>({}))]);
   const base=r.ok?await r.json().catch(()=>({})):{};
   if(!r.ok&&!Object.keys(over).length)return json(404,{error:'In der Online-Ansicht nicht verfügbar.'});
   return json(200,{day:hd,checks:mergeChecks(base.checks,over)});
  }
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
