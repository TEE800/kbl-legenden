// Spieltagsbericht auf der Startseite (Kevin-Wunsch): Bericht, den Claude nach der Abrechnung schreibt (tools/spieltagsbericht.mjs).
// Freigabe (Kevin-Wunsch 28.10.): Claude schreibt nur einen Entwurf im Tippdienst. Sichtbar für alle ist nur, was der Admin
// freigegeben hat (data/berichte.json bzw. live GET /bericht). Mit Admin-Code (wie die BumsParade-Haken) sieht der Admin hier
// den Entwurf, kann Schlagzeile und Text ändern, speichern, veröffentlichen oder wieder zurückziehen.
// Bereich startet zu (feste Regel), die Schlagzeile steht auch eingeklappt in der Pill.
(()=>{
 const sec=document.getElementById('bericht');if(!sec)return;
 const $=id=>document.getElementById(id);
 const API=String(window.KBL_TIPP_API||'').replace(/\/+$/,''),CODE='kbl-admin-haken';
 const code=()=>{try{return localStorage.getItem(CODE)||'';}catch{return '';}};
 const isAdmin=()=>!!(API&&code());
 const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 // Kleiner, sicherer Markdown-Leser: erst alles maskieren, dann nur Überschriften, **fett**, *kursiv*, Listen und Absätze.
 const inline=s=>esc(s).replace(/\*\*(.+?)\*\*/g,'<b>$1</b>').replace(/(^|[^*])\*([^*\s][^*]*?)\*(?!\*)/g,'$1<i>$2</i>');
 function md(text){
  const out=[];let list=null,para=[];
  const flushP=()=>{if(para.length){out.push(`<p>${inline(para.join(' '))}</p>`);para=[];}};
  const flushL=()=>{if(list){out.push(`<${list.t}>${list.items.map(i=>`<li>${inline(i)}</li>`).join('')}</${list.t}>`);list=null;}};
  for(const raw of String(text||'').split(/\r?\n/)){
   const line=raw.trim();let m;
   if(!line){flushP();flushL();continue;}
   if(/^#\s/.test(line)){flushP();flushL();continue;} // Schlagzeile steht extra darüber
   if((m=/^#{2,4}\s+(.+)$/.exec(line))){flushP();flushL();out.push(`<h4 class="ber-h">${inline(m[1])}</h4>`);continue;}
   if(/^(-{3,}|\*{3,})$/.test(line)){flushP();flushL();out.push('<hr class="ber-hr">');continue;}
   if((m=/^[-*•]\s+(.+)$/.exec(line))){flushP();if(list?.t!=='ul'){flushL();list={t:'ul',items:[]};}list.items.push(m[1]);continue;}
   if((m=/^\d+[.)]\s+(.+)$/.exec(line))){flushP();if(list?.t!=='ol'){flushL();list={t:'ol',items:[]};}list.items.push(m[1]);continue;}
   flushL();para.push(line);
  }
  flushP();flushL();return out.join('');
 }
 // Erste Zeile „# Schlagzeile“ gehört zum Text; beim Bearbeiten werden Schlagzeile und Text getrennt gezeigt.
 const bodyOf=t=>String(t||'').replace(/^\s*#\s+.*(\r?\n)?/,'').replace(/^\s+/,'');
 const when=s=>s?new Date(s).toLocaleString('de-DE',{dateStyle:'short',timeStyle:'short'}):'';
 const req=async(p,body)=>{const r=await fetch(API+p,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...body,adminCode:code()}),cache:'no-store'});const d=await r.json().catch(()=>({}));if(!r.ok){if(r.status===403)try{localStorage.removeItem(CODE);}catch{}throw Error(d.error||'Tippdienst nicht erreichbar.');}return d;};

 // Zahlenprüfung im Browser für eigene Änderungen (gleiche Regel wie zahlenPruefen in tools/spieltagsbericht.mjs).
 const normNum=t=>Number(String(t).replace(/[–−]/g,'-').replace(/\.(?=\d{3}(\D|$))/g,'').replace(',','.'));
 function fremdeZahlen(text,day){const ok=new Set(zahlen[day]||[]);if(!ok.size)return null;const out=[];for(const m of String(text).matchAll(/[–−-]?\d{1,3}(?:\.\d{3})+(?:,\d+)?|[–−-]?\d+(?:,\d+)?/g)){const v=normNum(m[0]);if(Number.isFinite(v)&&![v,Math.abs(v),Math.round(Math.abs(v)*10)/10].some(x=>ok.has(String(x))))out.push(m[0]);}return [...new Set(out)];}
 // Prüfbox für den Admin: Ergebnis der automatischen Prüfung (Zahlen + Gegenprüfung durch Claude) und Zahlen aus eigenen Änderungen.
 function pruefHtml(b){
  const p=pruef[b.day],rows=[];
  if(p){
   rows.push(p.zahlen?.length?`<li class="bad">⚠️ ${p.zahlen.length} Zahl${p.zahlen.length===1?'':'en'} nicht in den App-Daten gefunden: ${p.zahlen.map(z=>`<b>${esc(z.zahl)}</b>`).join(', ')}</li>`:'<li>✓ Alle Zahlen stammen aus den App-Daten.</li>');
   if(!p.ki||p.ki.fehler)rows.push(`<li class="muted">Gegenprüfung durch die BumsKI: ${esc(p.ki?.fehler||'nicht gelaufen')}</li>`);
   else rows.push(p.ki.probleme.length?`<li class="bad">⚠️ Gegenprüfung fand ${p.ki.probleme.length} Punkt${p.ki.probleme.length===1?'':'e'}:<ul>${p.ki.probleme.map(x=>`<li>„${esc(x.zitat)}“: ${esc(x.grund)}</li>`).join('')}</ul></li>`:'<li>✓ Gegenprüfung: Die BumsKI hat jede Aussage mit den App-Daten verglichen, kein Fehler gefunden.</li>');
  }else rows.push('<li class="muted">Noch keine automatische Prüfung für diese Fassung.</li>');
  if(b.editedAt){const f=fremdeZahlen(b.text,b.day);if(f)rows.push(f.length?`<li class="bad">⚠️ In deiner Änderung stehen Zahlen, die nicht in den App-Daten vorkommen: ${f.map(x=>`<b>${esc(x)}</b>`).join(', ')}</li>`:'<li>✓ Auch nach deiner Änderung stammen alle Zahlen aus den App-Daten.</li>');}
  return `<div class="ber-pruef"><b>🔍 Prüfung</b><ul>${rows.join('')}</ul></div>`;
 }
 let pub=[],drafts=[],sel=null,editing=false,loadErr='',msg='',pruef={},zahlen={};
 async function loadPublic(){
  let list=[];
  try{const r=await fetch('/api/berichte',{cache:'no-store'});if(r.ok){const d=await r.json();list=d.berichte||[];pruef=d.pruefungen||{};zahlen=d.zahlen||{};}}catch{}
  // Online sofort nach der Freigabe sichtbar, nicht erst nach dem nächsten Export.
  if(API)try{const r=await fetch(API+'/bericht',{cache:'no-store'});if(r.ok){const live=(await r.json()).berichte||[];const m=new Map(list.map(b=>[b.day,b]));for(const b of live)if(b.status==='frei')m.set(b.day,b);list=[...m.values()];}}catch{}
  return list.sort((a,b)=>b.day-a.day);
 }
 async function load(){
  pub=await loadPublic();
  drafts=[];loadErr='';if(isAdmin())try{drafts=(await req('/bericht/admin',{})).berichte||[];}catch(e){loadErr=msg=e.message;}
  const newestDraft=drafts.find(b=>b.status!=='frei'&&!pub.some(p=>p.day>=b.day));
  if(!editing)sel=newestDraft||pub[0]||null;
  render();
 }
 function render(){
  if(!sel&&!isAdmin()){sec.hidden=true;return;}
  sec.hidden=false;
  const pill=$('berichtPill'),box=$('berichtContent');
  if(!sel){pill.textContent='Noch kein Bericht';box.innerHTML=`<p class="muted">Noch kein Bericht. Sobald ein Spieltag abgerechnet ist, schreibt die BumsKI einen Entwurf, den du hier prüfst und freigibst.</p>${msg?`<p class="error">${esc(msg)}</p>`:''}`;return;}
  const draft=sel.status&&sel.status!=='frei';
  pill.textContent=`${draft?'📝 Entwurf · ':''}ST ${sel.day}: ${sel.title||''}`;pill.title=sel.title||'';
  const admin=isAdmin()&&drafts.some(b=>b.day===sel.day);
  const bar=admin?`<div class="ber-admin">${draft?'<span class="ber-badge">Entwurf · nur für dich sichtbar</span>':'<span class="ber-badge ber-ok">✓ Veröffentlicht</span>'}<div class="ber-btns">${editing?'':`<button type="button" class="ghost" data-ber="edit">✏️ Bearbeiten</button>${draft?'<button type="button" class="gold" data-ber="freigeben">✅ Veröffentlichen</button>':'<button type="button" class="ghost" data-ber="zurueckziehen">↩ Zurückziehen</button>'}`}</div></div>`:'';
  const foot=`<p class="muted tiny ber-foot">Spieltag ${sel.day} · geschrieben von BumsKI${sel.editedAt?' · bearbeitet von T800':''}${sel.approvedAt?' · freigegeben '+esc(when(sel.approvedAt)):''}</p>`;
  if(editing){
   box.innerHTML=`${bar}<label class="ber-lbl">Schlagzeile<input id="berTitle" maxlength="200" value="${esc(sel.title||'')}"></label><label class="ber-lbl">Text<textarea id="berText" rows="18">${esc(bodyOf(sel.text))}</textarea></label><p class="muted tiny">## am Zeilenanfang = Zwischenüberschrift, **so** = fett, - am Zeilenanfang = Liste, Leerzeile = neuer Absatz.</p><div class="ber-btns"><button type="button" class="ghost" data-ber="speichern">💾 Speichern</button>${draft?'<button type="button" class="gold" data-ber="freigeben">✅ Speichern und veröffentlichen</button>':''}<button type="button" class="ghost" data-ber="abbrechen">Abbrechen</button></div><p class="muted tiny" id="berLive"></p><p class="muted tiny" role="status">${esc(msg)}</p>`;
   const live=()=>{const f=fremdeZahlen($('berText').value,sel.day),el=$('berLive');if(!el||!f)return;el.innerHTML=f.length?`⚠️ Diese Zahlen stehen nicht in den App-Daten: ${f.map(x=>`<b>${esc(x)}</b>`).join(', ')}`:'✓ Alle Zahlen stammen aus den App-Daten.';el.className=f.length?'tiny ber-warn':'muted tiny';};
   $('berText').addEventListener('input',live);live();
   return;
  }
  const pr=admin&&draft?pruefHtml(sel):'';
  box.innerHTML=`${bar}${pr}<h3 class="ber-title">${esc(sel.title||`Spieltag ${sel.day}`)}</h3><div class="ber-body">${md(sel.text)}</div>${foot}${msg?`<p class="muted tiny" role="status">${esc(msg)}</p>`:''}`;
  if(loadErr)box.insertAdjacentHTML('afterbegin',`<p class="error" role="status">⚠️ Entwürfe nicht abrufbar: ${esc(loadErr)}</p>`);
  fitHeads();copyBars();
  if(!draft)reactMount(sel.day);
 }
 // Emoji-Reaktionen je Absatz (Kevin-Wunsch 28.10.): unter jedem Absatz bzw. jeder Liste, durchgezählt ab 0 (Überschriften zählen nicht).
 // Kompakt: zu sehen sind nur Emojis, die schon jemand gesetzt hat, dazu ein kleiner ☺+-Knopf, der die Auswahl aufklappt.
 // Nur online mit Tippdienst und nur bei veröffentlichten Berichten. Je Emoji und Absatz einmal pro Gerät (kbl-vid wie nutzung.js),
 // nochmal tippen nimmt die Reaktion zurück. Gezählt wird im Tippdienst (/reaktion/:day), alle sehen dieselben Zahlen.
 const VID='kbl-vid';
 const vid=()=>{let v='';try{v=localStorage.getItem(VID)||'';}catch{}if(!/^[a-z0-9]{8,32}$/.test(v)){v=Array.from(crypto.getRandomValues(new Uint8Array(10)),b=>b.toString(36).padStart(2,'0')).join('').slice(0,16);try{localStorage.setItem(VID,v);}catch{}}return v;};
 let rx=null,pickSec=null;
 function reactBars(day){
  const body=$('berichtContent')?.querySelector('.ber-body');if(!body)return [];
  const bars=[];let sec=0;
  for(const el of [...body.children]){
   if(el.classList.contains('ber-h')||el.classList.contains('ber-hr')||el.classList.contains('ber-tools')||el.classList.contains('ber-react'))continue;
   const d=document.createElement('div');d.className='ber-react';d.dataset.sec=sec++;
   const t=el.nextElementSibling;if(t?.classList.contains('ber-tools'))t.prepend(d);else el.after(d);bars.push(d);
  }
  return bars;
 }
 function reactPaint(){
  if(!rx||rx.day!==sel?.day)return;
  for(const d of $('berichtContent').querySelectorAll('.ber-react')){
   const sec=d.dataset.sec,c=rx.counts[sec]||{},mine=new Set(rx.mine[sec]||[]),open=pickSec===sec;
   const chip=(e,all)=>{const n=c[e]||0,on=mine.has(e);return `<button type="button" class="ber-rx${on?' on':''}" data-rx="${e}" aria-pressed="${on}" title="${on?'Reaktion zurücknehmen':'Reagieren'}">${e}${n&&!all?`<span>${n}</span>`:''}</button>`;};
   const used=rx.emojis.filter(e=>c[e]>0);
   d.classList.toggle('open',open);
   d.innerHTML=`${used.map(e=>chip(e,false)).join('')}<button type="button" class="ber-rx-add" data-rx-add aria-expanded="${open}" title="Reagieren">☺<b>${open?'×':'+'}</b></button>${open?`<div class="ber-rx-pick">${rx.emojis.map(e=>chip(e,true)).join('')}</div>`:''}`;
  }
 }
 async function reactMount(day){
  if(!API||!reactBars(day).length)return;
  if(rx?.day===day){reactPaint();}
  try{const r=await fetch(`${API}/reaktion/${day}?vid=${vid()}`,{cache:'no-store'});if(!r.ok)throw 0;const d=await r.json();if(!Array.isArray(d.emojis))throw 0;rx=d;reactPaint();}
  catch{if(rx?.day!==day)for(const d of $('berichtContent').querySelectorAll('.ber-react'))d.remove();}
 }
 async function reactToggle(btn){
  const d=btn.closest('.ber-react'),sec=d.dataset.sec,e=btn.dataset.rx;if(!rx||!sel)return;
  // Sofort anzeigen, dann mit dem Stand des Tippdienstes überschreiben.
  const mine=new Set(rx.mine[sec]||[]),c=rx.counts[sec]||(rx.counts[sec]={}),on=mine.has(e);
  on?mine.delete(e):mine.add(e);c[e]=Math.max(0,(c[e]||0)+(on?-1:1));rx.mine[sec]=[...mine];reactPaint();
  try{const r=await fetch(`${API}/reaktion/${sel.day}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({vid:vid(),sec:Number(sec),emoji:e}),cache:'no-store'});const j=await r.json().catch(()=>({}));if(r.ok&&j.emojis){rx=j;}else throw 0;}
  catch{on?mine.add(e):mine.delete(e);c[e]=Math.max(0,(c[e]||0)+(on?1:-1));rx.mine[sec]=[...mine];}
  reactPaint();
 }
 // Absatz als Bild (Kevin-Wunsch 10.11.): unter jedem Absatz bzw. jeder Liste ein 📋, öffnet das gemeinsame Bild-Fenster
 // (window.kblImgDialog) mit Schlagzeile, Zwischenüberschrift und genau diesem Absatz, dazu Text für Discord.
 function copyBars(){
  const body=$('berichtContent')?.querySelector('.ber-body');if(!body)return;
  for(const el of [...body.children]){
   if(el.classList.contains('ber-h')||el.classList.contains('ber-hr')||el.classList.contains('ber-tools')||el.classList.contains('ber-react'))continue;
   const t=document.createElement('div');t.className='ber-tools';
   t.innerHTML='<button type="button" class="ber-cp" data-ber-cp title="Absatz als Bild (für Discord)" aria-label="Absatz als Bild">📋</button>';el.after(t);
  }
 }
 function blockOf(btn){let el=btn.closest('.ber-tools')?.previousElementSibling;let h=null;for(let p=el?.previousElementSibling;p;p=p.previousElementSibling)if(p.classList.contains('ber-h')){h=p;break;}return {el,h};}
 function paraCanvas(el,h,first){
  const W=1080,P=56,L=P+30,M=W-2*P-50,sans='"Segoe UI",Arial,sans-serif',c=document.createElement('canvas'),x=c.getContext('2d');
  const runs=node=>{const out=[];const walk=(n,b,i)=>{for(const ch of n.childNodes){if(ch.nodeType===3)out.push({t:ch.textContent,b,i});else if(ch.nodeType===1)walk(ch,b||ch.tagName==='B',i||ch.tagName==='I');}};walk(node,false,false);return out;};
  const font=(r,size,weight)=>`${r.i?'italic ':''}${r.b?800:weight} ${size}px ${r.f||sans}`;
  const wrap=(rs,size,weight,max)=>{const lines=[[]];
   for(const r of rs)for(const word of r.t.split(/(\s+)/)){if(!word)continue;x.font=font(r,size,weight);
    if(/^\s+$/.test(word)){if(lines.at(-1).length)lines.at(-1).push({...r,t:' ',w:x.measureText(' ').width});continue;}
    const ww=x.measureText(word).width,cur=lines.at(-1).reduce((s,q)=>s+q.w,0);
    if(cur+ww>max&&lines.at(-1).length){while(lines.at(-1).at(-1)?.t===' ')lines.at(-1).pop();lines.push([]);}
    lines.at(-1).push({...r,t:word,w:ww});}
   return lines.filter(l=>l.length);};
  const title=first?wrap([{t:sel.title||`Spieltag ${sel.day}`,b:false,f:'Georgia,serif'}],46,900,M):[];
  const head=h?wrap(runs(h),34,800,M):[];
  const items=el.tagName==='P'?[{mark:'',lines:wrap(runs(el),36,400,M)}]:[...el.children].map((li,k)=>({mark:el.tagName==='OL'?`${k+1}.`:'•',lines:wrap(runs(li),36,400,M-44)}));
  const H=P+60+title.length*58+(head.length?(title.length?20:4)+head.length*46:0)+24+items.reduce((s,it)=>s+it.lines.length*52+14,0)+70+P;c.width=W;c.height=H;
  x.fillStyle='#081118';x.fillRect(0,0,W,H);
  const bx=P/2,by=P/2,bw=W-P,bh=H-P;x.beginPath();x.roundRect?x.roundRect(bx,by,bw,bh,22):x.rect(bx,by,bw,bh);x.fillStyle='#17242e';x.fill();x.strokeStyle='#2e3f4a';x.lineWidth=2;x.stroke();
  x.save();x.clip();x.fillStyle='#b48633';x.fillRect(bx,by,10,bh);x.restore();
  let y=P+44;x.textBaseline='alphabetic';x.textAlign='left';
  x.font=`600 28px ${sans}`;x.fillStyle='#9db0bd';x.fillText(`📰 SPIELTAGSBERICHT · SPIELTAG ${sel.day}`,L,y);
  x.font=`900 26px Georgia,serif`;x.fillStyle='#ebc768';x.textAlign='right';x.fillText('KBL LEGENDEN',W-P-20,y);x.textAlign='left';y+=8;
  const draw=(lines,size,weight,col,colB,lh,ind=0)=>{for(const l of lines){y+=lh;let px=L+ind;for(const w of l){x.font=font(w,size,weight);x.fillStyle=w.b?colB:col;x.fillText(w.t,px,y);px+=w.w;}}};
  draw(title,46,900,'#ebc768','#ebc768',58);
  if(head.length){y+=title.length?20:4;draw(head,34,800,'#d9b45a','#d9b45a',46);}
  y+=24;
  for(const it of items){if(it.mark){x.font=`800 36px ${sans}`;x.fillStyle='#ebc768';x.fillText(it.mark,L,y+52);}draw(it.lines,36,400,'#cfd9e0','#ffffff',52,it.mark?44:0);y+=14;}
  x.font=`26px ${sans}`;x.fillStyle='#728592';x.fillText(`Spieltag ${sel.day} · geschrieben von BumsKI 🤡`,L,H-P-6);
  return c;
 }
 const mdOf=node=>{let s='';for(const ch of node.childNodes){if(ch.nodeType===3)s+=ch.textContent;else if(ch.tagName==='B')s+=`**${mdOf(ch)}**`;else if(ch.tagName==='I')s+=`*${mdOf(ch)}*`;else s+=mdOf(ch);}return s.replace(/\s+/g,' ');};
 function paraShot(btn){
  const {el,h}=blockOf(btn);if(!el||!sel)return;
  const body=el.tagName==='P'?mdOf(el).trim():[...el.children].map((li,k)=>`${el.tagName==='OL'?k+1+'.':'-'} ${mdOf(li).trim()}`).join('\n');
  // Große Schlagzeile nur beim ersten Absatz (Kevin-Wunsch 11.11.), sonst nur Zwischenüberschrift und Absatz.
  const first=[...el.parentElement.children].find(x=>!['ber-h','ber-hr','ber-tools','ber-react'].some(c=>x.classList.contains(c)))===el;
  const txt=`${first?`**${sel.title||'Spieltag '+sel.day}** (Spieltagsbericht ST ${sel.day})\n`:''}${h?`__${h.textContent.trim()}__\n`:''}${body}`;
  window.kblImgDialog?.(()=>paraCanvas(el,h,first),`kbl-bericht-st${sel.day}-absatz.png`,()=>txt,'Absatz als Bild');
 }
 // Zwischenüberschriften immer einzeilig (Kevin-Wunsch): nur zu lange einzeln so weit verkleinern, dass sie passen (min. 11 px, dann Umbruch).
 // Der Bereich startet eingeklappt (Breite 0), darum beim Aufklappen und bei Größenänderung neu über den ResizeObserver.
 function fitHeads(){
  const box=$('berichtContent');if(!box)return;
  for(const h of box.querySelectorAll('.ber-h')){
   h.style.fontSize='';h.style.whiteSpace='nowrap';
   const w=h.clientWidth;if(!w||h.scrollWidth<=w)continue;
   h.style.fontSize=Math.max(11,Math.floor(parseFloat(getComputedStyle(h).fontSize)*w/h.scrollWidth*10)/10)+'px';
   if(h.scrollWidth>w)h.style.whiteSpace='';
  }
 }
 if(window.ResizeObserver&&$('berichtContent')){let lastW=-1;new ResizeObserver(es=>{const w=Math.round(es[0].contentRect.width);if(w!==lastW){lastW=w;fitHeads();}}).observe($('berichtContent'));}
 sec.addEventListener('click',async e=>{
  const cp=e.target.closest('[data-ber-cp]');if(cp){paraShot(cp);return;}
  const ad=e.target.closest('[data-rx-add]');if(ad){const sec=ad.closest('.ber-react').dataset.sec;pickSec=pickSec===sec?null:sec;reactPaint();return;}
  const x=e.target.closest('[data-rx]');if(x){if(x.closest('.ber-rx-pick'))pickSec=null;reactToggle(x);return;}
  const b=e.target.closest('[data-ber]');if(!b||!sel)return;const act=b.dataset.ber;
  if(act==='edit'){editing=true;msg='';render();return;}
  if(act==='abbrechen'){editing=false;msg='';render();return;}
  if(act==='freigeben'&&!confirm(`Bericht zu Spieltag ${sel.day} für alle veröffentlichen?`))return;
  if(act==='zurueckziehen'&&!confirm('Bericht wieder zurückziehen? Dann sieht ihn nur noch du.'))return;
  const body={action:act==='speichern'?'speichern':act};
  if(editing){const t=$('berTitle').value.trim(),x=$('berText').value;body.title=t;body.text=`# ${t}\n\n${x.trim()}\n`;}
  b.disabled=true;
  try{const d=await req(`/bericht/${sel.day}`,body);sel=d.bericht;editing=false;msg=act==='freigeben'?'Veröffentlicht. Alle sehen ihn sofort.':act==='zurueckziehen'?'Zurückgezogen.':'Gespeichert.';await load();}
  catch(err){msg='Nicht gespeichert: '+err.message;render();}
 });
 document.addEventListener('click',e=>{if(pickSec!=null&&e.target.isConnected&&!e.target.closest('.ber-react')){pickSec=null;reactPaint();}});
 load();
 // Neue Berichte kommen mit dem nächsten Export; beim Zurückholen der Seite neu laden (nicht während des Bearbeitens).
 document.addEventListener('visibilitychange',()=>{if(!document.hidden&&!editing)load();});
 // Nach der Admin-Anmeldung in der BumsParade (gleicher Code) Entwürfe zeigen.
 window.addEventListener('storage',e=>{if(e.key===CODE&&!editing)load();});
 window.addEventListener('kbl-admin',()=>{if(!editing)load();});
 window.kblBerichtReload=()=>{if(!editing)load();};
 // Anmeldung/Abmeldung als Admin (BumsParade „🔑 Bearbeiten (Admin)“) gleich hier übernehmen.
 const H=window.kblHaken;if(H?.login&&!H.__ber){const li=H.login.bind(H),lo=H.logout.bind(H);H.login=async c=>{await li(c);window.kblBerichtReload();};H.logout=()=>{lo();window.kblBerichtReload();};H.__ber=true;}
})();
