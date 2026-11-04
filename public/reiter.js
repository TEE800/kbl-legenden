// Reiter sortieren (Kevin-Wunsch 4.11.): Reihenfolge der Reiter per Ziehen ändern, gespeichert nur auf diesem Gerät
// (localStorage kbl-reiter, getrennt für PC-Seitenleiste und Handy). Am Handy stehen die ersten 4 unten in der Leiste,
// der Rest unter „Mehr“. Öffnen: „↕ Reiter sortieren“ (unter „Mehr“ bzw. unten in der Seitenleiste) oder lange auf einen Reiter drücken.
// Admin bleibt immer am Ende unter „Mehr“ und taucht im Sortierfenster nicht auf. Wischen (wischen.js) folgt der neuen Reihenfolge.
(function(){
 const KEY='kbl-reiter',BAR=4;
 const side=document.querySelector('.sidebar nav'),bar=document.querySelector('.mobilenav'),more=document.querySelector('#mobileMore'),moreBtn=document.querySelector('#mobileMoreBtn');
 if(!side||!bar||!more||!moreBtn)return;
 const NAMES={overview:'Übersicht',profiles:'Managerprofile',accounting:'BumsParade',penalties:'BumsTabelle',archiv:'BumsArchiv',rules:'Regeln',lineups:'Aufstellungen',ligen:'Ligenübersicht',challenges:'Challenges',points:'Punkteübersicht',arena:'Arena',transfers:'Transfers',mvp:'MVP-Tipp',meister:'Meisterecke'};
 // Kurze Namen für die schmale Leiste unten am Handy.
 const SHORT={profiles:'Profile',points:'Punkte',ligen:'Ligen',lineups:'Aufstellung',meister:'Meister',penalties:'BumsTabelle'};
 const isPhone=()=>matchMedia('(max-width:900px)').matches;
 const load=()=>{try{return JSON.parse(localStorage.getItem(KEY))||{};}catch{return {};}};
 const save=o=>{try{localStorage.setItem(KEY,JSON.stringify(o));}catch{}};
 const sideLinks=()=>[...side.querySelectorAll('a[data-kbl-nav]')];
 const phoneLinks=()=>[...bar.querySelectorAll('a[data-kbl-nav]'),...more.querySelectorAll('a[data-kbl-nav]')];
 const ids=list=>list.map(a=>a.dataset.kblNav).filter(v=>v!=='admin');
 const DEFAULT={pc:ids(sideLinks()),handy:ids(phoneLinks())};
 // Gespeicherte Reihenfolge mit den heute vorhandenen Reitern abgleichen (neue Reiter hinten an, alte weg).
 function norm(list,def){const ok=(Array.isArray(list)?list:[]).filter((v,i,a)=>def.includes(v)&&a.indexOf(v)===i);return [...ok,...def.filter(v=>!ok.includes(v))];}
 function label(a,text){const t=[...a.childNodes].find(n=>n.nodeType===3&&n.textContent.trim());if(t)t.textContent=text;}
 function apply(){
  const o=load(),pc=norm(o.pc,DEFAULT.pc),handy=norm(o.handy,DEFAULT.handy);
  const sl=Object.fromEntries(sideLinks().map(a=>[a.dataset.kblNav,a]));
  const admin=sl.admin;for(const v of pc)side.insertBefore(sl[v],admin||null);
  const pl=Object.fromEntries(phoneLinks().map(a=>[a.dataset.kblNav,a]));
  const padmin=pl.admin;
  handy.forEach((v,i)=>{
   const a=pl[v],inBar=i<BAR;
   if(inBar)bar.insertBefore(a,moreBtn);else more.insertBefore(a,padmin||null);
   label(a,inBar?(SHORT[v]||NAMES[v]):NAMES[v]);
   const svg=a.querySelector('svg');if(svg){svg.setAttribute('width',inBar?20:18);svg.setAttribute('height',inBar?20:18);}
  });
  // „Mehr“ leuchtet, wenn der offene Reiter jetzt unter „Mehr“ steht.
  moreBtn.classList.toggle('active',!!more.querySelector('a.active'));
 }
 apply();

 // ---- Sortierfenster ----
 let modal=null;
 function close(){modal?.remove();modal=null;document.removeEventListener('keydown',onKey);}
 function onKey(e){if(e.key==='Escape')close();}
 function open(){
  close();
  const phone=isPhone(),k=phone?'handy':'pc',o=load();
  const order=norm(o[k],DEFAULT[k]);
  modal=document.createElement('div');
  modal.className='push-modal rs-modal kbl-no-swipe';
  modal.setAttribute('role','dialog');modal.setAttribute('aria-label','Reiter sortieren');
  modal.innerHTML=`<div class="rs-box"><div class="rs-head"><strong>↕ Reiter sortieren</strong><button type="button" class="rs-x" aria-label="Schließen">✕</button></div>
   <p class="muted tiny rs-hint">Am Griff ☰ ziehen${phone?'. Die ersten '+BAR+' stehen unten in der Leiste, der Rest unter „Mehr“':''}. Gilt nur auf diesem Gerät.</p>
   <ol class="rs-list${phone?' rs-phone':''}">${order.map(v=>`<li class="rs-item" data-v="${v}"><span class="rs-grip" aria-hidden="true">☰</span><span class="rs-name">${NAMES[v]}</span><span class="rs-btns"><button type="button" class="rs-up" aria-label="${NAMES[v]} nach oben">▲</button><button type="button" class="rs-dn" aria-label="${NAMES[v]} nach unten">▼</button></span></li>`).join('')}</ol>
   <div class="rs-foot"><button type="button" class="ghost rs-reset">Zurücksetzen</button><button type="button" class="gold rs-done">Fertig</button></div></div>`;
  document.body.appendChild(modal);
  const list=modal.querySelector('.rs-list');
  const store=()=>{const cur=load();cur[k]=[...list.children].map(li=>li.dataset.v);save(cur);apply();};
  modal.addEventListener('click',e=>{
   if(e.target===modal||e.target.closest('.rs-x,.rs-done'))return close();
   if(e.target.closest('.rs-reset')){const cur=load();delete cur[k];save(cur);apply();open();return;}
   const li=e.target.closest('.rs-item');if(!li)return;
   if(e.target.closest('.rs-up')&&li.previousElementSibling){list.insertBefore(li,li.previousElementSibling);store();}
   else if(e.target.closest('.rs-dn')&&li.nextElementSibling){list.insertBefore(li.nextElementSibling,li);store();}
  });
  document.addEventListener('keydown',onKey);
  // Ziehen: am Handy über den Griff, mit der Maus über die ganze Zeile.
  let drag=null;
  list.addEventListener('pointerdown',e=>{
   const li=e.target.closest('.rs-item');if(!li||e.target.closest('button'))return;
   if(e.pointerType!=='mouse'&&!e.target.closest('.rs-grip'))return;
   e.preventDefault();
   drag={li,id:e.pointerId};li.classList.add('rs-drag');list.setPointerCapture(e.pointerId);
  });
  list.addEventListener('pointermove',e=>{
   if(!drag||e.pointerId!==drag.id)return;
   const y=e.clientY;
   const others=[...list.children].filter(x=>x!==drag.li);
   const before=others.find(x=>{const r=x.getBoundingClientRect();return y<r.top+r.height/2;});
   if(before!==drag.li.nextElementSibling||(!before&&drag.li!==list.lastElementChild))list.insertBefore(drag.li,before||null);
   // Am Rand des Fensters mitscrollen.
   const box=modal.querySelector('.rs-box'),r=box.getBoundingClientRect();
   if(y<r.top+40)box.scrollTop-=8;else if(y>r.bottom-40)box.scrollTop+=8;
  });
  const end=e=>{if(!drag||e.pointerId!==drag.id)return;drag.li.classList.remove('rs-drag');drag=null;store();};
  list.addEventListener('pointerup',end);list.addEventListener('pointercancel',end);
 }
 window.kblReiterSortieren=open;

 // Einstiege: Knopf unter „Mehr“ und unten in der Seitenleiste.
 const mk=cls=>{const b=document.createElement('button');b.type='button';b.className=cls;b.textContent='↕ Reiter sortieren';b.addEventListener('click',e=>{e.stopPropagation();more.hidden=true;moreBtn.setAttribute('aria-expanded','false');open();});return b;};
 more.appendChild(mk('rs-open rs-open-more'));
 side.after(mk('rs-open rs-open-side'));

 // Lange auf einen Reiter drücken öffnet das Sortierfenster (der Klick danach wird verschluckt).
 let lp=null,eat=false;
 const navSel='.sidebar nav a[data-kbl-nav], .mobilenav a[data-kbl-nav], #mobileMore a[data-kbl-nav]';
 document.addEventListener('pointerdown',e=>{
  const a=e.target.closest(navSel);if(!a||e.button>0)return;
  const x=e.clientX,y=e.clientY;
  lp={x,y,t:setTimeout(()=>{lp=null;eat=true;open();},550)};
 },true);
 const cancel=()=>{if(lp){clearTimeout(lp.t);lp=null;}};
 document.addEventListener('pointermove',e=>{if(lp&&Math.hypot(e.clientX-lp.x,e.clientY-lp.y)>10)cancel();},true);
 document.addEventListener('pointerup',cancel,true);document.addEventListener('pointercancel',cancel,true);
 document.addEventListener('click',e=>{if(eat&&e.target.closest(navSel)){e.preventDefault();e.stopImmediatePropagation();}eat=false;},true);
 document.addEventListener('contextmenu',e=>{if(e.target.closest(navSel)&&(lp||eat))e.preventDefault();},true);
})();
