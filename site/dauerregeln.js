// Dauerregeln (Kevin-Wunsch 31.10.): Regeln, die dauerhaft überwacht werden, z. B. FV – Frühverkauf.
// Anzeige in der BumsParade unter den Aufgaben (#dauerBox), eingeklappt. Daten: /api/dauerregeln/:day (Server rechnet alles).
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
   <p class="dr-text">hat den aufgestellten <b>${esc(v.playerName)}</b>${v.club?` (${esc(v.club)})`:''} am ${when(v.at)} ${to} verkauft, bevor die BumsParade abgeschlossen war.</p>
   ${v.note?`<p class="muted tiny dr-text">${esc(v.note)}</p>`:''}
   ${(v.penalties||[]).length?`<ul class="dr-pen">${v.penalties.map(penHtml).join('')}</ul>`:''}</div>`;
 }
 function closeHtml(c){
  if(!c)return '';
  if(c.state==='abgeschlossen')return `<p class="muted tiny">BumsParade abgeschlossen: ${when(c.at)} (${c.by==='admin'?'vom Admin beendet':c.by==='letzter-verkauf'?'letzte Pflichtabgabe':'Verkaufsfrist'}). Ab da dürfen aufgestellte Spieler wieder verkauft werden.${c.unsureUntil?` Verkäufe bis ${when(c.unsureUntil)} prüft die BumsKI nur unter Vorbehalt, weil eine Pflichtabgabe ohne Verkaufszeit abgehakt wurde.`:''}</p>`;
  if(c.state==='offen')return `<p class="muted tiny">BumsParade noch nicht abgeschlossen${c.note?`: ${esc(String(c.note).replace(/\.$/,''))}`:''}. Aufgestellte Spieler dürfen noch nicht verkauft werden${c.deadline?`, spätestens ab ${when(c.deadline)} wieder`:''}.</p>`;
  return `<p class="muted tiny">${esc(c.note||'Abschluss der BumsParade unbekannt.')}</p>`;
 }
 // Admin beendet die BumsParade (Haken BPA:0, gleicher Speicher wie die Aufgaben-Haken). Online nur nach Admin-Anmeldung.
 const canEdit=()=>!window.KBL_STATIC||!!window.kblHaken?.admin?.();
 function adminHtml(day,d){
  if(!d.started||!d.close||!canEdit())return '';
  if(d.close.by==='admin')return `<p><button type="button" class="ghost" data-bpa="${day}" data-bpa-on="0">↺ „Abgeschlossen“ zurücknehmen</button></p>`;
  if(d.close.state==='abgeschlossen')return '';
  return `<p><button type="button" class="gold" data-bpa="${day}" data-bpa-on="1">✅ BumsParade jetzt abgeschlossen</button> <span class="muted tiny">Ab jetzt dürfen aufgestellte Spieler wieder verkauft werden.</span></p>`;
 }
 document.addEventListener('click',async e=>{
  const b=e.target.closest('[data-bpa]');if(!b)return;
  const day=Number(b.dataset.bpa),on=b.dataset.bpaOn==='1';b.disabled=true;
  try{
   const r=await fetch(`/api/todo-checks/${day}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({key:'BPA:0',done:on})});
   const j=await r.json().catch(()=>({}));if(!r.ok)throw Error(j.error||`HTTP ${r.status}`);
   if(window.KBL_STATIC){b.replaceWith(Object.assign(document.createElement('span'),{className:'muted tiny',textContent:'Gespeichert. Die BumsKI übernimmt das beim nächsten Abgleich der Online-Seite.'}));return;}
   await window.kblDauerLoad(day,true);
  }catch(err){alert(err.message);b.disabled=false;}
 });
 function groupHtml(day,d,live){
  if(d.error)return `<details class="acc-group dr-group" data-day="${day}${live?'L':''}"><summary>🛡️ Dauerregeln · Spieltag ${day}${live?' LIVE':''}</summary><div class="acc-sub"><p class="muted">Nicht prüfbar: ${esc(d.error)}</p></div></details>`;
  const vs=d.violations||[],n=vs.filter(v=>v.state==='verstoss').length,maybe=vs.length-n;
  const pill=!d.started?'noch nicht angepfiffen':n?`${n} Verstoß${n===1?'':'e'}`:maybe?`${maybe} zu prüfen`:'alles sauber';
  if(d.rules?.length&&!d.rules.some(r=>r.active!==false))return `<details class="acc-group dr-group" data-day="${day}${live?'L':''}"><summary>🛡️ Dauerregeln · Spieltag ${day} <span class="pill">noch nicht gültig</span></summary><div class="acc-sub"><p class="muted">${d.rules.map(r=>`${esc(r.code)} ${esc(r.name)} gilt ab Spieltag ${esc(r.ab)}.`).join(' ')}</p></div></details>`;
  const rules=(d.rules||[]).filter(r=>r.active!==false).map(r=>`<span class="bums-rule bums-r-${esc(r.code)}" data-rule="${esc(r.code)}" role="button" tabindex="0">${esc(r.code)}</span> ${esc(r.name)}`).join(' · ');
  return `<details class="acc-group dr-group" data-day="${day}${live?'L':''}"><summary>🛡️ Dauerregeln · Spieltag ${day}${live?' LIVE':''} <span class="pill${n?' dr-pill-bad':''}">${esc(pill)}</span></summary><div class="acc-sub">
   <p class="muted tiny">Überwacht: ${rules}</p>${closeHtml(d.close)}${live?'':adminHtml(day,d)}
   ${!d.started?'':vs.length?vs.map(vHtml).join(''):'<p>✓ Niemand hat einen aufgestellten Spieler zu früh verkauft.</p>'}
   ${(d.failures||[]).length?`<p class="error tiny">Nicht vollständig geprüft: ${esc(d.failures.join('; '))}</p>`:''}</div></details>`;
 }
 function render(){
  const el=document.getElementById('dauerBox');if(!el)return;
  const parts=[];
  if(state.live&&state.live.data&&state.live.day!==state.sel?.day)parts.push(groupHtml(state.live.day,state.live.data,true));
  if(state.sel?.data)parts.push(groupHtml(state.sel.day,state.sel.data,false));
  // Neu zeichnen ohne Zuklappen (nur innerhalb des offenen Reiters; beim Öffnen des Reiters ist alles zu).
  const wasOpen=new Set([...el.querySelectorAll('details.dr-group[open]')].map(x=>x.dataset.day));
  el.innerHTML=parts.join('');
  el.querySelectorAll('details.dr-group').forEach(x=>{if(wasOpen.has(x.dataset.day))x.open=true;});
  window.kblFillMgrFaces?.(el);
 }
 async function load(day,fresh=false){
  try{const r=await fetch(`/api/dauerregeln/${day}${fresh?'?neu=1':''}`,{cache:'no-store'});const d=await r.json().catch(()=>({}));if(!r.ok)return {error:d.error||`HTTP ${r.status}`};return d;}
  catch(e){return {error:e.message};}
 }
 // Ausgewählter Spieltag der BumsParade (aufgerufen von centerLoadAccounting in app.js).
 window.kblDauerLoad=async(day,fresh=false)=>{if(!day)return;if(!fresh)state.sel={day,data:null};const data=await load(day,fresh);if(state.sel?.day===day){state.sel.data=data;render();}};
 // Laufender Spieltag (aufgerufen von accLiveLoad in app.js): Verkäufe während des Spieltags sofort sehen.
 window.kblDauerLive=async day=>{if(!day){if(state.live){state.live=null;render();}return;}const data=await load(day);state.live={day,data};render();};
})();
