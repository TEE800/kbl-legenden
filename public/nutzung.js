// Nutzung der Online-Seite zählen (Kevin-Wunsch). Nur online mit Tippdienst (window.KBL_TIPP_API).
// Gemeldet wird je Besuch und je geöffnetem Reiter: Zufallsnummer des Geräts, Reiter, Handy/PC, und der Manager,
// falls auf dem Gerät einer gewählt ist (🔔 Push oder MVP-Tipp). Keine IP, keine Namen. Speicherung im Tippdienst (D1 NUTZUNG).
// Versteckter Bereich: 5× schnell auf das Clown-Logo tippen, dann Admin-Code. Die Zahlen sieht nur, wer den Code kennt.
(()=>{
 const API=window.KBL_STATIC?String(window.KBL_TIPP_API||'').replace(/\/+$/,''):'';
 if(!API)return;
 const OFF='kbl-nutzung-aus',VID='kbl-vid';
 const ls={get(k){try{return localStorage.getItem(k);}catch{return null;}},set(k,v){try{localStorage.setItem(k,v);}catch{}},del(k){try{localStorage.removeItem(k);}catch{}}};
 const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const fmt=n=>new Intl.NumberFormat('de-DE').format(n||0);
 const geraete=n=>`${fmt(n)} ${n===1?'Gerät':'Geräte'}`;

 // ===== Zählen =====
 let vid=ls.get(VID);
 if(!vid||!/^[a-z0-9]{8,32}$/.test(vid)){vid=Array.from(crypto.getRandomValues(new Uint8Array(10)),b=>b.toString(36).padStart(2,'0')).join('').slice(0,16);ls.set(VID,vid);}
 const manager=()=>{let m='';try{m=String(JSON.parse(ls.get('kbl-push')||'null')?.managerId||'');}catch{}return /^\d{1,15}$/.test(m)?m:(/^\d{1,15}$/.test(ls.get('kblMvpManager')||'')?ls.get('kblMvpManager'):'');};
 const ua=navigator.userAgent,touch=navigator.maxTouchPoints>1;
 const dev=/iPad|Tablet/.test(ua)||(navigator.platform==='MacIntel'&&touch)||(/Android/.test(ua)&&!/Mobile/.test(ua))?'tablet':/Mobi|iPhone|Android/.test(ua)?'handy':'pc';
 const app=navigator.standalone===true||matchMedia('(display-mode: standalone)').matches;
 const current=()=>document.querySelector('.kbl-view.kbl-current')?.dataset.view||'overview';
 function send(kind,view){
  if(ls.get(OFF))return;
  const body=JSON.stringify({vid,kind,view,mid:manager(),dev,app:app?1:0});
  try{if(navigator.sendBeacon&&navigator.sendBeacon(API+'/nutzung/melden',new Blob([body],{type:'text/plain'})))return;}catch{}
  fetch(API+'/nutzung/melden',{method:'POST',body,keepalive:true,headers:{'Content-Type':'text/plain'}}).catch(()=>{});
 }
 // Besuch = Seite geöffnet oder nach mehr als 30 Minuten im Hintergrund wieder vorgeholt (Home-Bildschirm-App bleibt offen).
 let last='',hiddenAt=0,timer=0;
 const visit=()=>{last=current();send('open',last);};
 setTimeout(visit,800);
 document.addEventListener('visibilitychange',()=>{
  if(document.hidden){hiddenAt=Date.now();return;}
  if(hiddenAt&&Date.now()-hiddenAt>30*60e3)visit();
  hiddenAt=0;
 });
 // Reiterwechsel: an der Klasse kbl-current erkennen (Klick, Zurück-Taste, Sprünge aus anderen Reitern).
 new MutationObserver(()=>{clearTimeout(timer);timer=setTimeout(()=>{const v=current();if(last&&v!==last){last=v;send('view',v);}},400);})
  .observe(document.querySelector('.content')||document.body,{subtree:true,attributes:true,attributeFilter:['class']});

 // ===== Versteckter Bereich =====
 const TITLES={overview:'Übersicht',table:'Tabelle & Spieltage',profiles:'Managerprofile',accounting:'BumsParade',penalties:'BumsTabelle',rules:'Regeln',lineups:'Aufstellungen',challenges:'Challenges',points:'Punkteübersicht',arena:'Arena',transfers:'Transfers',mvp:'MVP-Tipp',admin:'Admin',meister:'Meisterecke'};
 const DEV={handy:'📱 Handy',tablet:'📱 Tablet',pc:'💻 PC','?':'Unbekannt'};
 let taps=[];
 document.addEventListener('click',e=>{
  if(!e.target.closest('.brand,.topbar-brand'))return;
  const now=Date.now();taps=taps.filter(t=>now-t<4000);taps.push(now);
  if(taps.length>=5){taps=[];open();}
 });
 const modal=document.createElement('div');modal.className='push-modal nz-modal';modal.hidden=true;
 modal.innerHTML='<div class="push-box nz-box" role="dialog" aria-modal="true" aria-labelledby="nzTitle"><div class="push-head"><h3 id="nzTitle">📊 Nutzung der App</h3><button type="button" class="push-x" data-nz="close" aria-label="Schließen">✕</button></div><div id="nzBody"></div></div>';
 document.body.append(modal);
 const body=modal.querySelector('#nzBody');
 let code='',tage=30;
 const close=()=>{modal.hidden=true;code='';document.removeEventListener('keydown',onKey);};
 const onKey=e=>{if(e.key==='Escape')close();};
 modal.addEventListener('click',e=>{if(e.target===modal||e.target.closest('[data-nz="close"]'))close();});

 function open(){
  modal.hidden=false;document.addEventListener('keydown',onKey);
  body.innerHTML=`<p class="muted">Nur für den Admin.</p><form id="nzLogin" class="nz-login"><label class="acc-label push-who">Admin-Code <input id="nzCode" type="password" autocomplete="off" required></label><button type="submit" class="gold">Öffnen</button></form><p id="nzMsg" class="push-msg" role="status"></p>`;
  const f=body.querySelector('#nzLogin');body.querySelector('#nzCode').focus();
  f.onsubmit=async e=>{e.preventDefault();code=body.querySelector('#nzCode').value;await load();};
 }
 async function load(){
  const m=body.querySelector('#nzMsg');if(m){m.className='push-msg';m.textContent='Wird geladen …';}
  try{
   const r=await fetch(API+'/nutzung/zahlen',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({adminCode:code,tage})});
   const d=await r.json().catch(()=>({}));if(!r.ok)throw new Error(d.error||`Fehler ${r.status}`);
   render(d);
  }catch(err){
   const el=body.querySelector('#nzMsg');
   if(el){el.className='push-msg error';el.textContent=err.message;}else body.innerHTML=`<p class="error">${esc(err.message)}</p>`;
  }
 }
 const tile=(t,v)=>`<div class="nz-tile"><small>${t}</small><strong>${fmt(v.visits)}</strong><span>${geraete(v.visitors)} · ${fmt(v.managers)} Manager</span></div>`;
 const bar=(label,n,max,extra='')=>`<div class="nz-row"><span class="nz-l">${label}</span><span class="nz-track"><i style="width:${max?Math.max(2,Math.round(n/max*100)):0}%"></i></span><b>${fmt(n)}</b>${extra}</div>`;
 const sec=(title,inner)=>`<details class="acc-group nz-sec"><summary>${title}</summary><div class="acc-sub">${inner}</div></details>`;
 const ago=ms=>{const m=Math.round((Date.now()-ms)/6e4);return m<60?`vor ${Math.max(1,m)} Min.`:m<1440?`vor ${Math.round(m/60)} Std.`:`vor ${Math.round(m/1440)} T.`;};
 const mgr=(name,id)=>window.kblMgrName?window.kblMgrName(name,'',id):esc(name);
 function render(d){
  const span=d.tage===365?'letztes Jahr':`letzte ${d.tage} Tage`;
  const maxDay=Math.max(1,...d.daily.map(x=>x.visits));
  const dayBars=d.daily.map(x=>{const dt=new Date(x.d+'T12:00:00');return `<div class="nz-col" title="${dt.toLocaleDateString('de-DE',{weekday:'short',day:'2-digit',month:'2-digit'})}: ${x.visits} Besuche, ${x.visitors} Geräte"><i style="height:${Math.round(x.visits/maxDay*100)}%"></i></div>`;}).join('');
  const first=d.daily[0]?.d,lastD=d.daily[d.daily.length-1]?.d,dm=s=>s?new Date(s+'T12:00:00').toLocaleDateString('de-DE',{day:'2-digit',month:'2-digit'}):'';
  const maxView=Math.max(1,...d.views.map(v=>v.n));
  const maxM=Math.max(1,...d.managers.map(v=>v.visits));
  const maxH=Math.max(1,...d.hours);
  const maxDev=Math.max(1,...d.devices.map(v=>v.visits));
  const off=!!ls.get(OFF);
  body.innerHTML=`<div class="nz-tiles">${tile('Heute',d.today)}${tile('7 Tage',d.d7)}${tile('30 Tage',d.d30)}</div>
   <p class="muted tiny">Zahl = Besuche (Seite geöffnet oder nach über 30 Min. wieder vorgeholt). Geräte = verschiedene Handys/PCs. Insgesamt ${fmt(d.all.visits)} Besuche${d.all.since?` seit ${dm(d.all.since)}`:'.'}</p>
   <label class="acc-label nz-span">Zeitraum <select id="nzTage">${[7,30,90,365].map(n=>`<option value="${n}"${n===d.tage?' selected':''}>${n===365?'1 Jahr':`${n} Tage`}</option>`).join('')}</select></label>
   ${sec(`Besuche je Tag <span class="pts-sub">${span}</span>`,`<div class="nz-days">${dayBars}</div><div class="nz-axis"><span>${dm(first)}</span><span>${dm(lastD)}</span></div>`)}
   ${sec(`Beliebte Reiter <span class="pts-sub">Aufrufe</span>`,d.views.length?d.views.map(v=>bar(esc(TITLES[v.view]||v.view),v.n,maxView,`<small>${geraete(v.visitors)}</small>`)).join(''):'<p class="muted">Noch keine Daten.</p>')}
   ${sec(`Manager <span class="pts-sub">${d.managers.length} erkannt</span>`,`${d.managers.length?d.managers.map(m=>bar(mgr(m.name,m.mid),m.visits,maxM,`<small>${ago(m.last)}</small>`)).join(''):'<p class="muted">Noch kein Manager erkannt.</p>'}<p class="muted tiny">Erkannt wird ein Manager nur, wenn er auf seinem Gerät bei der 🔔 oder im MVP-Tipp seinen Namen gewählt hat. Ohne Namen: ${geraete(d.unknown)}.</p>`)}
   ${sec('Geräte',d.devices.map(v=>bar(`${DEV[v.dev]||esc(v.dev)}${v.app?' · App':''}`,v.visits,maxDev,`<small>${geraete(v.visitors)}</small>`)).join('')+'<p class="muted tiny">„App“ = vom Home-Bildschirm geöffnet.</p>')}
   ${sec('Uhrzeit',`<div class="nz-days nz-hours">${d.hours.map((n,h)=>`<div class="nz-col" title="${h} Uhr: ${n} Besuche"><i style="height:${Math.round(n/maxH*100)}%"></i></div>`).join('')}</div><div class="nz-axis"><span>0 Uhr</span><span>12</span><span>23 Uhr</span></div>`)}
   <label class="push-pref nz-off"><input type="checkbox" id="nzOff"${off?' checked':''}><span><b>Dieses Gerät nicht mitzählen</b><small>Damit deine eigenen Besuche die Zahlen nicht aufblähen.</small></span></label>
   <p class="muted tiny">Stand ${new Date(d.at).toLocaleString('de-DE',{dateStyle:'short',timeStyle:'short'})}</p><p id="nzMsg" class="push-msg" role="status"></p>`;
  body.querySelector('#nzTage').onchange=e=>{tage=Number(e.target.value);load();};
  body.querySelector('#nzOff').onchange=e=>{if(e.target.checked)ls.set(OFF,'1');else ls.del(OFF);};
  window.kblFillMgrFaces?.();
 }
})();
