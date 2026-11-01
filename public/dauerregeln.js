// Dauerregeln (Kevin-Wunsch 31.10.): Regeln, die dauerhaft überwacht werden, z. B. FV – Frühverkauf.
// Anzeige in der BumsParade ohne eigenen Kasten (Kevin 1.11.): im LIVE-Kasten und im Aufgaben-Kasten des Spieltags (Platzhalter [data-dauer]).
// Daten: /api/dauerregeln/:day (Server rechnet alles). Abgerechnete Spieltage: Verstöße stehen als Aufgaben (FV) in der BumsParade.
// Neue Dauerregeln brauchen hier nichts Neues: Jeder Verstoß bringt Text, Zustand und Strafen mit.
(()=>{
 const esc=v=>String(v??'').replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
 const when=iso=>{const t=Date.parse(iso);if(!Number.isFinite(t))return '';return new Date(t).toLocaleString('de-DE',{timeZone:'Europe/Berlin',weekday:'short',day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'})+' Uhr';};
 const mgr=(n,id)=>window.kblMgrLink&&window.kblMgrName?window.kblMgrLink(n,window.kblMgrName(n,'',id)):esc(n);
 const STATE={verstoss:['✗','Verstoß','dr-bad'],vorlaeufig:['⏳','vorläufig','dr-wait'],unklar:['?','bitte prüfen','dr-wait']};
 const PEN={offen:['○','steht noch an','dr-wait'],laeuft:['⏳','läuft','dr-wait'],eingehalten:['✓','eingehalten','dr-ok'],gebrochen:['✗','nicht eingehalten','dr-bad'],unklar:['?','unklar','dr-wait']};
 const tag=(m,s)=>{const x=m[s]||['?',s,'dr-wait'];return `<span class="dr-state ${x[2]}">${x[0]} ${esc(x[1])}</span>`;};
 const state={sel:null,live:null};
 function penHtml(p){
  if(p.kind==='leer'){
   const need=p.need>1?`${p.need} Positionen`:'eine Position';
   const extra=p.mm?` (davon ${p.mm} aus Magic Miyoshi)`:'';
   const seen=p.empty!=null?` · leer: ${p.empty}`:'';
   return `<li>${tag(PEN,p.state)} ${p.day?`Spieltag ${p.day}: `:''}${need} freilassen${extra}${seen}${p.note?` <span class="muted">${esc(p.note)}</span>`:''}</li>`;
  }
  if(p.kind==='kaufsperre'){
   const buys=(p.buys||[]).map(b=>`${esc(b.playerName)} (${when(b.at)})`).join(', ');
   return `<li>${tag(PEN,p.state)} Kaufsperre für alle Spieler von ${esc(p.club||'diesem Verein')} bis zum Anpfiff von Spieltag ${esc(p.day)} (${when(p.until)})${buys?`: gekauft ${buys}`:''}${p.note?` <span class="muted">${esc(p.note)}</span>`:''}</li>`;
  }
  return `<li>${tag(PEN,p.state)} ${esc(p.note||p.kind)}</li>`;
 }
 function vHtml(v){
  if(!v.playerId)return `<div class="dr-item">${mgr(v.manager,v.managerId)} ${tag(STATE,v.state)} <span class="muted">${esc(v.note)}</span></div>`;
  const to=v.buyer?`an ${esc(v.buyer)}`:'an den Markt';
  return `<div class="dr-item"><div class="dr-head"><span class="bums-rule bums-r-${esc(v.rule)}" data-rule="${esc(v.rule)}" role="button" tabindex="0" title="Regel ansehen">${esc(v.rule)}</span> ${mgr(v.manager,v.managerId)} ${tag(STATE,v.state)}</div>
   <p class="dr-text">hat den aufgestellten <b>${esc(v.playerName)}</b>${v.club?` (${esc(v.club)})`:''} am ${when(v.at)} ${to} verkauft, bevor die BumsParade begonnen hat.</p>
   ${v.note?`<p class="muted tiny dr-text">${esc(v.note)}</p>`:''}
   ${(v.penalties||[]).length?`<ul class="dr-pen">${v.penalties.map(penHtml).join('')}</ul>`:''}</div>`;
 }
 function startHtml(st){
  if(!st)return '';
  return `<p class="muted tiny">${st.begun?'BumsParade begonnen':'BumsParade beginnt'}: ${when(st.at)}${st.by==='admin'?' (vom Admin gestartet)':' (üblicher Beginn)'}. Bis dahin dürfen aufgestellte Spieler nicht verkauft werden, danach schon.</p>`;
 }
 // Admin startet die BumsParade (Haken BPA:0, gleicher Speicher wie die Aufgaben-Haken). Online nur nach Admin-Anmeldung.
 const canEdit=()=>!window.KBL_STATIC||!!window.kblHaken?.admin?.();
 function adminHtml(day,d){
  const st=d.start;if(!d.started||!st||!canEdit())return '';
  if(st.by==='admin')return `<p><button type="button" class="ghost" data-bpa="${day}" data-bpa-on="0">↺ Start zurücknehmen (wieder üblicher Beginn)</button></p>`;
  if(Date.now()>Date.parse(st.at)+6*3600e3)return '';
  return `<p><button type="button" class="gold" data-bpa="${day}" data-bpa-on="1">▶ BumsParade beginnt jetzt</button> <span class="muted tiny">Nur wenn sie nicht zum üblichen Beginn startet.</span></p>`;
 }
 document.addEventListener('click',async e=>{
  const b=e.target.closest('[data-bpa]');if(!b)return;
  const day=Number(b.dataset.bpa),on=b.dataset.bpaOn==='1';b.disabled=true;
  try{
   const r=await fetch(`/api/todo-checks/${day}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({key:'BPA:0',done:on})});
   const j=await r.json().catch(()=>({}));if(!r.ok)throw Error(j.error||`HTTP ${r.status}`);
   if(window.KBL_STATIC){b.replaceWith(Object.assign(document.createElement('span'),{className:'muted tiny',textContent:'Gespeichert. Die BumsKI übernimmt das beim nächsten Abgleich der Online-Seite.'}));return;}
   await window.kblDauerLoad(day,true);window.kblAccReload?.();
  }catch(err){alert(err.message);b.disabled=false;}
 });
 // Kevin-Wunsch 1.11.: keine eigenen Klappkästen mehr. Die Dauerregeln stehen mit in der BumsParade: beim laufenden Spieltag
 // im LIVE-Kasten (vorläufig), beim abgeschlossenen Spieltag im Aufgaben-Kasten. Ist er abgerechnet, sind Verstöße dort
 // schon Aufgaben (FV), hier dann nichts doppelt. Gilt eine Regel noch nicht (ab Spieltag X), steht hier nichts.
 function partHtml(day,d,live,closing){
  if(!d)return '';
  if(d.error)return `<div class="dr-part"><p class="muted tiny">🛡️ Dauerregeln für Spieltag ${day} nicht prüfbar: ${esc(d.error)}</p></div>`;
  const act=(d.rules||[]).filter(r=>r.active!==false);
  if(d.rules?.length&&!act.length)return '';
  const fails=(d.failures||[]).length?`<p class="error tiny">Nicht vollständig geprüft: ${esc(d.failures.join('; '))}</p>`:'';
  const admin=live&&!closing?'':adminHtml(day,d); // LIVE: Start-Knopf erst, wenn alle Spiele vorbei sind
  if(d.accReady)return fails||admin?`<div class="dr-part">${admin}${fails}</div>`:'';
  const vs=d.violations||[],n=vs.filter(v=>v.state==='verstoss').length,maybe=vs.length-n;
  const rules=act.map(r=>`<span class="bums-rule bums-r-${esc(r.code)}" data-rule="${esc(r.code)}" role="button" tabindex="0" title="Regel ansehen">${esc(r.code)}</span> ${esc(r.name)}`).join(' · ');
  const head=!d.started?'noch nicht angepfiffen':n?`${n} Verstoß${n===1?'':'e'}${live?' (vorläufig)':''}`:maybe?`${maybe} zu prüfen`:'alles sauber';
  return `<div class="dr-part"><p class="dr-part-head">🛡️ <b>Dauerregeln</b> · ${rules} <span class="dr-state ${n?'dr-bad':maybe||!d.started?'dr-wait':'dr-ok'}">${esc(head)}</span></p>${startHtml(d.start)}${admin}
   ${!d.started?'':vs.length?vs.map(vHtml).join(''):'<p class="muted tiny">✓ Bisher hat niemand einen aufgestellten Spieler zu früh verkauft.</p>'}${fails}</div>`;
 }
 function render(){
  const put=(slot,html)=>{const el=document.querySelector(`[data-dauer="${slot}"]`);if(!el)return;el.innerHTML=html;window.kblFillMgrFaces?.(el);};
  const same=state.live&&state.sel&&state.live.day===state.sel.day;
  put('live',state.live&&!same?partHtml(state.live.day,state.live.data,true,state.live.closing):'');
  put('sel',state.sel?.data?partHtml(state.sel.day,state.sel.data,false):'');
 }
 // Nach jedem Neuzeichnen der Kästen (app.js) die Dauerregeln wieder einsetzen.
 window.kblDauerRender=render;
 async function load(day,fresh=false){
  try{const r=await fetch(`/api/dauerregeln/${day}${fresh?'?neu=1':''}`,{cache:'no-store'});const d=await r.json().catch(()=>({}));if(!r.ok)return {error:d.error||`HTTP ${r.status}`};return d;}
  catch(e){return {error:e.message};}
 }
 // Ausgewählter Spieltag der BumsParade (aufgerufen von centerLoadAccounting in app.js).
 window.kblDauerLoad=async(day,fresh=false)=>{if(!day)return;if(!fresh)state.sel={day,data:null};const data=await load(day,fresh);if(state.sel?.day===day){state.sel.data=data;render();}};
 // Laufender Spieltag (aufgerufen von accLiveLoad in app.js): Verkäufe während des Spieltags sofort sehen.
 window.kblDauerLive=async(day,closing)=>{if(!day){if(state.live){state.live=null;render();}return;}const data=await load(day);state.live={day,data,closing:!!closing};render();};
})();
