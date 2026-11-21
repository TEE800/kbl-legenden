// Verpasste Chancen (Kevin-Wunsch 21.11.): in der BumsParade (und im BumsArchiv) unter der BumsParade-Zeremonie.
// Spieler, die eine Regel ausgelöst hätten (BD, AH, RK, BN, UM), aber in keiner Startelf standen: nur auf der Bank oder bei keinem Manager.
// Daten: /api/verpasste-chancen/:day (Server rechnet alles, gleiche Erkennung wie die BumsParade). Zählt nicht als Bumsung.
// Startet eingeklappt (feste Regel); app.js ruft window.kblChancenLoad(day) beim Laden eines Spieltags.
(()=>{
 const esc=v=>String(v??'').replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
 const mgr=(n,id)=>window.kblMgrLink&&window.kblMgrName?window.kblMgrLink(n,window.kblMgrName(n,'',id)):esc(n);
 const num=n=>Number(n).toLocaleString('de-DE');
 const cache={};let cur=null;
 function item(x){
  const pts=x.points!=null?` <span class="ch-pts">${num(x.points)} Pkt.</span>`:'';
  const who=x.place==='bank'?`<span class="ch-who">auf der Bank bei ${mgr(x.manager,x.managerId)}</span>`:'';
  const um=x.rule==='UM'&&x.recipient?` · wäre an ${x.recipientId?mgr(x.recipient,x.recipientId):esc(x.recipient==='Markt'?'den Markt':x.recipient)} gegangen`:'';
  return `<li class="ch-item"><div class="ch-head"><span class="bums-rule bums-r-${esc(x.rule)}" data-rule="${esc(x.rule)}" role="button" tabindex="0" title="Regel ansehen">${esc(x.rule)}</span> <b>${esc(x.playerName||'Spieler '+x.playerId)}</b>${x.team?` <span class="muted">(${esc(x.team)})</span>`:''}${pts}${x.unsure?' <span class="dr-state dr-wait">? unsicher</span>':''}</div>
   <div class="muted tiny">${esc(x.reason)}${um}</div>${who}</li>`;
 }
 function render(){
  const box=document.getElementById('chancenBox');if(!box)return;
  const d=cur&&cache[cur];
  if(!d||d.error||(!d.items?.length&&!d.message&&!d.notes?.length)){box.innerHTML='';return;}
  const items=d.items||[],bank=items.filter(x=>x.place==='bank'),frei=items.filter(x=>x.place!=='bank');
  const grp=(t,l)=>l.length?`<h4 class="ch-sub">${t} · ${l.length}</h4><ul class="ch-list">${l.map(item).join('')}</ul>`:'';
  const pill=d.message?'':items.length?`${bank.length} Bank · ${frei.length} frei`:'keine';
  const wasOpen=box.querySelector('details')?.open&&box.dataset.day===String(cur);
  box.dataset.day=String(cur);
  box.innerHTML=`<details class="acc-group ch-box"${wasOpen?' open':''}><summary>🍀 Verpasste Chancen${pill?` <span class="pts-sub">${pill}</span>`:''}</summary><div class="acc-sub">
   ${d.message?`<p class="muted">${esc(d.message)}</p>`:`<p class="muted tiny" style="margin:0 0 8px">Diese Spieler haben an Spieltag ${esc(d.day)} eine Regel ausgelöst, standen aber in keiner Startelf. Darum keine Bumsung.</p>
   ${items.length?grp('🪑 Nur auf der Bank',bank)+grp('🛒 Bei keinem Manager',frei):'<p class="muted">Keine verpassten Chancen: Jeder betroffene Spieler stand in einer Startelf.</p>'}`}
   ${(d.notes||[]).map(n=>`<p class="muted tiny">${esc(n)}</p>`).join('')}</div></details>`;
 }
 window.kblChancenLoad=async day=>{
  cur=day;render();if(!day||cache[day])return;
  try{const r=await fetch(`/api/verpasste-chancen/${day}`,{credentials:'same-origin'});cache[day]=r.ok?await r.json():{error:r.status};}
  catch(e){cache[day]={error:e.message};}
  if(cur===day)render();
 };
})();
