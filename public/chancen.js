// Verpasste Chancen (Kevin-Wunsch 21.11.): in der BumsParade (und im BumsArchiv) unter der BumsParade-Zeremonie.
// Spieler, die eine Regel ausgelöst hätten (BD, AH, RK, BN, UM), aber in keiner Startelf standen: nur auf der Bank oder bei keinem Manager.
// Daten: /api/verpasste-chancen/:day (Server rechnet alles, gleiche Erkennung wie die BumsParade). Zählt nicht als Bumsung.
// Startet eingeklappt (feste Regel); app.js ruft window.kblChancenLoad(day) beim Laden eines Spieltags und
// window.kblChancenParade(day) für die BumsParade, wenn dort gerade kein Spieltag offen ist (#chancenParade unter #accEmpty).
(()=>{
 const esc=v=>String(v??'').replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
 const mgr=(n,id)=>window.kblMgrLink&&window.kblMgrName?window.kblMgrLink(n,window.kblMgrName(n,'',id)):esc(n);
 const num=n=>Number(n).toLocaleString('de-DE');
 const cache={},cur={chancenBox:null,chancenParade:null};
 function item(x){
  const pts=x.points!=null?` <span class="ch-pts">${num(x.points)} Pkt.</span>`:'';
  const who=x.place==='bank'?`<span class="ch-who">auf der Bank bei ${mgr(x.manager,x.managerId)}</span>`:'';
  const um=x.rule==='UM'&&x.recipient?` · wäre an ${x.recipientId?mgr(x.recipient,x.recipientId):esc(x.recipient==='Markt'?'den Markt':x.recipient)} gegangen`:'';
  return `<li class="ch-item"><div class="ch-head"><span class="bums-rule bums-r-${esc(x.rule)}" data-rule="${esc(x.rule)}" role="button" tabindex="0" title="Regel ansehen">${esc(x.rule)}</span> <b>${esc(x.playerName||'Spieler '+x.playerId)}</b>${x.team?` <span class="muted">(${esc(x.team)})</span>`:''}${pts}${x.unsure?' <span class="dr-state dr-wait">? unsicher</span>':''}</div>
   <div class="muted tiny">${esc(x.reason)}${um}</div>${who}</li>`;
 }
 function render(id){
  const box=document.getElementById(id);if(!box)return;
  const day=cur[id],d=day&&cache[day];
  if(!d||d.error||(!d.items?.length&&!d.message&&!d.notes?.length)){box.innerHTML='';return;}
  const items=d.items||[],bank=items.filter(x=>x.place==='bank'),frei=items.filter(x=>x.place!=='bank');
  const grp=(t,l)=>l.length?`<h4 class="ch-sub">${t} · ${l.length}</h4><ul class="ch-list">${l.map(item).join('')}</ul>`:'';
  const pill=[`Spieltag ${d.day}`,...(d.message?[]:items.length?[bank.length&&`${bank.length} Bank`,frei.length&&`${frei.length} frei`].filter(Boolean):['keine'])].join(' · ');
  const wasOpen=box.querySelector('details')?.open&&box.dataset.day===String(day);
  box.dataset.day=String(day);
  box.innerHTML=`<details class="acc-group ch-box"${wasOpen?' open':''}><summary>🍀 Verpasste Chancen${pill?` <span class="pts-sub">${pill}</span>`:''}</summary><div class="acc-sub">
   ${d.message?`<p class="muted">${esc(d.message)}</p>`:`<p class="muted tiny" style="margin:0 0 8px">Diese Spieler haben an Spieltag ${esc(d.day)} eine Regel ausgelöst, standen aber in keiner Startelf. Darum keine Bumsung.</p>
   ${items.length?grp('🪑 Nur auf der Bank',bank)+grp('🛒 Bei keinem Manager',frei):'<p class="muted">Keine verpassten Chancen: Jeder betroffene Spieler stand in einer Startelf.</p>'}`}
   ${(d.notes||[]).map(n=>`<p class="muted tiny">${esc(n)}</p>`).join('')}</div></details>`;
 }
 async function load(id,day){
  if(cur[id]===day&&cache[day])return;
  cur[id]=day;render(id);if(!day||cache[day])return;
  if(!cache['p'+day])cache['p'+day]=fetch(`/api/verpasste-chancen/${day}`,{credentials:'same-origin'}).then(async r=>r.ok?await r.json():{error:r.status}).catch(e=>({error:e.message}));
  const d=await cache['p'+day];cache[day]=d;
  for(const k in cur)if(cur[k]===day)render(k);
 }
 window.kblChancenLoad=day=>load('chancenBox',day);
 // BumsParade ohne offenen Spieltag (letzter ist abgerechnet): Verpasste Chancen des letzten beendeten Spieltags trotzdem zeigen (Kevin 21.11.).
 window.kblChancenParade=day=>load('chancenParade',day);
})();
