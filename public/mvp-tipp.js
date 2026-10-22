// Ansicht "MVP-Tipp" (NPC Goes MVP): verdeckter Tipp auf Spieler und Punktzahl, bis zum ersten Anstoß änderbar (Daten von /api/mvp-tipps).
(()=>{
 const $=s=>document.querySelector(s);
 const esc=v=>String(v??'').replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
 const fmt=n=>n==null||!Number.isFinite(Number(n))?'–':new Intl.NumberFormat('de-DE').format(n);
 const when=s=>s?new Date(s).toLocaleString('de-DE',{weekday:'short',day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'}):'–';
 const STATIC=!!window.KBL_STATIC;
 let overview=null,data=null,players=null,playerByLabel=new Map(),loading=false;

 async function get(url,opts){
  const r=await fetch(url,{cache:'no-store',...opts});const d=await r.json().catch(()=>({}));
  if(!r.ok)throw Error(d.error||`HTTP ${r.status}`);return d;
 }
 function left(iso){
  const ms=Date.parse(iso)-Date.now();if(!(ms>0))return 'Anpfiff';
  const d=Math.floor(ms/864e5),h=Math.floor(ms/36e5)%24,m=Math.floor(ms/6e4)%60;
  return d?`noch ${d} T. ${h} Std.`:h?`noch ${h} Std. ${m} Min.`:`noch ${m} Min.`;
 }
 async function loadPlayers(){
  if(players)return;
  const d=await get('/api/mvp-tipps/players');players=d.players;
  const seen=new Map();
  for(const p of players){let l=`${p.name} (${p.team})`;const n=(seen.get(l)||0)+1;seen.set(l,n);if(n>1)l+=` #${n}`;p.label=l;playerByLabel.set(l,p);}
  const dl=$('#mvpPlayers');if(dl)dl.innerHTML=players.map(p=>`<option value="${esc(p.label)}"></option>`).join('');
 }
 function ruleBox(d){
  const src=d.rule.id==='eigene'?'eigene Regel vom Admin':d.rule.auto?'reihum dran':'vom Admin festgelegt';
  return `<div class="mvp-rule"><div class="eyebrow">TIPPREGEL SPIELTAG ${d.day}</div><strong>${esc(d.rule.title)}</strong><p>${esc(d.rule.text)}</p><small class="muted">${src}</small></div>`;
 }
 function deadline(d){
  if(d.open)return `<p class="mvp-deadline">Tipps bis <b>${esc(when(d.deadline))}</b>${d.firstMatch?` (${esc(d.firstMatch)})`:''} · <span data-mvp-left="${esc(d.deadline)}">${left(d.deadline)}</span></p>`;
  if(d.status==='upcoming')return `<p class="muted">Auf diesen Spieltag wird erst getippt, wenn er als nächster dran ist.</p>`;
  return `<p class="muted">Angepfiffen am ${esc(when(d.deadline))}. Die Tipps sind gesperrt und für alle sichtbar.</p>`;
 }
 function form(d){
  if(!d.open)return '';
  if(STATIC)return `<p class="muted">In der Online-Ansicht kann man nur ansehen. Getippt wird in der Live-App.</p>`;
  if(!d.me)return `<p class="muted">Tippen können nur Manager der KBL Legenden. Melde dich dafür mit deinem eigenen Kickbase-Konto an.</p>`;
  const mine=d.managers.find(m=>m.id===d.me)?.tip;
  return `<form class="mvp-form" id="mvpForm" autocomplete="off">
   <label class="acc-label">Spieler<input id="mvpPlayer" list="mvpPlayers" placeholder="Name eintippen …" required value="${esc(mine?`${mine.player} (${mine.team})`:'')}"></label>
   <label class="acc-label">Punkte<input id="mvpPoints" type="number" inputmode="numeric" step="1" min="-1000" max="2000" required value="${mine?esc(mine.points):''}"></label>
   <button class="gold" type="submit">${mine?'Tipp ändern':'Tipp abgeben'}</button></form>
   <datalist id="mvpPlayers"></datalist>
   <p class="muted" id="mvpMsg" role="status">${mine?`Dein Tipp: <b>${esc(mine.player)}</b> (${esc(mine.team)}), ${fmt(mine.points)} Punkte · gespeichert ${esc(when(mine.updatedAt))}. Nur du siehst ihn bis zum Anpfiff.`:'Du hast noch nicht getippt.'}</p>`;
 }
 function table(d){
  const res=d.result,byId=new Map((res?.rows||[]).map(r=>[r.managerId,r])),win=new Set(res?.winners||[]);
  const progn=d.rule.id==='prognose',showRes=!!res?.rows?.length;
  const rows=[...d.managers].sort((a,b)=>{
   if(showRes){const A=byId.get(a.id),B=byId.get(b.id);const wa=win.has(a.id)?0:1,wb=win.has(b.id)?0:1;if(wa!==wb)return wa-wb;const da=A?.diff??1e9,db=B?.diff??1e9;if(da!==db)return da-db;}
   return (b.tipped-a.tipped)||a.name.localeCompare(b.name,'de');
  });
  const tipped=d.managers.filter(m=>m.tipped).length;
  const head=`<tr><th>Manager</th><th>Spieler</th><th class="num">Punkte</th>${showRes?`${progn?'<th class="num">Echt</th>':''}<th class="num">Abstand</th><th>Wertung</th>`:''}</tr>`;
  const body=rows.map(m=>{
   const t=m.tip,r=byId.get(m.id),me=m.id===d.me;
   const player=t?`${esc(t.player)} <small class="muted">${esc(t.team)}</small>`:m.tipped?'<span class="muted">verdeckt ✓</span>':'<span class="muted">kein Tipp</span>';
   const extra=showRes?(r?`${progn?`<td class="num">${fmt(r.actual)}</td>`:''}<td class="num">${fmt(r.diff)}</td><td>${win.has(m.id)?'<b class="mvp-win">★ Gewinner</b>':r.eligible?'<span class="muted">dabei</span>':r.hit===false&&!progn?'<span class="muted">falscher Spieler</span>':'<span class="muted">raus</span>'}</td>`:`${progn?'<td></td>':''}<td></td><td></td>`):'';
   return `<tr${me?' class="mvp-me"':''}><td>${esc(m.name)}${me?' <small class="muted">(du)</small>':''}</td><td>${player}</td><td class="num">${t?fmt(t.points):''}</td>${extra}</tr>`;
  }).join('');
  return `<h4 style="margin:22px 0 8px">Tipps der Manager <small class="muted">${tipped} von ${d.managers.length} haben getippt${d.reveal?'':' · verdeckt bis zum Anpfiff'}</small></h4><div class="tablewrap"><table class="mvp-table">${head}${body}</table></div>`;
 }
 function result(d){
  const r=d.result;if(!r)return d.status==='live'?'<p class="muted">Ausgewertet wird, sobald der Spieltag beendet ist.</p>':'';
  let h='';
  if(r.mvp)h+=`<p class="mvp-mvp">MVP des Spieltags: ${r.mvp.players.map(p=>`<b>${esc(p.name)}</b> (${esc(p.team)})`).join(', ')} mit <b>${fmt(r.mvp.points)}</b> Punkten.</p>`;
  if(r.message)h+=`<p class="${r.status==='ok'||r.status==='empty'?'muted':'error'}">${esc(r.message)}</p>`;
  if(r.rows?.length){
   const names=d.managers.filter(m=>r.winners.includes(m.id)).map(m=>m.name);
   h+=`<p>Vorschlag für den Joker: <b>${names.length?esc(names.join(', ')):'niemand'}</b>${r.status==='ok'?'':' (bitte prüfen)'}. Entschieden wird in der BumsParade.</p>`;
   if(d.admin&&!STATIC&&names.length)h+=`<button type="button" class="ghost" id="mvpToNpc">Vorschlag als Joker-Gewinner übernehmen</button> <span class="muted" id="mvpNpcMsg"></span>`;
  }
  return h;
 }
 function render(){
  const root=$('#mvpContent');if(!root||!data)return;
  const d=data;
  $('#mvpMeta').textContent=d.open?`Spieltag ${d.day} · Tipps offen`:d.status==='finished'?`Spieltag ${d.day} · beendet`:`Spieltag ${d.day} · ${d.status==='live'?'läuft':'gesperrt'}`;
  root.className='';
  root.innerHTML=ruleBox(d)+deadline(d)+form(d)+result(d)+table(d);
  $('#mvpRules').innerHTML=(d.rules||[]).map((r,i)=>`<p><b>${esc(r.title)}</b>${r.id===d.rule.id?' <span class="muted">(gilt an Spieltag '+d.day+')</span>':''}<br>${esc(r.text)}</p>`).join('')+'<p class="muted tiny">Reihum: Spieltag 1 Regel 1, Spieltag 2 Regel 2 und so weiter. Bei Gleichstand gewinnen alle. MVP ist der Bundesliga-Spieler mit den meisten Spieltagspunkten.</p>';
  const admin=$('#mvpAdminBox');admin.hidden=!(d.admin&&!STATIC&&d.status==='upcoming'&&!d.locked);
  if(!admin.hidden){
   const sel=$('#mvpRuleSelect'),cur=d.rule.auto?'reihum':d.rule.id;
   sel.innerHTML=`<option value="reihum">Reihum (${esc(d.rules[(d.day-1)%d.rules.length].title)})</option>`+d.rules.map(r=>`<option value="${esc(r.id)}">${esc(r.title)}</option>`).join('')+'<option value="eigene">Eigene Regel …</option>';
   sel.value=cur;$('#mvpRuleText').hidden=cur!=='eigene';$('#mvpRuleText').value=d.rule.id==='eigene'?d.rule.text:'';
  }
  if(d.open&&d.me&&!STATIC)loadPlayers().then(()=>{const dl=$('#mvpPlayers');if(dl&&!dl.children.length)dl.innerHTML=players.map(p=>`<option value="${esc(p.label)}"></option>`).join('');}).catch(e=>{const m=$('#mvpMsg');if(m)m.textContent='Spielerliste nicht abrufbar: '+e.message;});
 }
 async function loadDay(day){
  const root=$('#mvpContent');
  if(!data||data.day!==day){root.className='muted';root.textContent=`Lade Spieltag ${day} …`;}
  try{data=await get(`/api/mvp-tipps/${day}`);render();}
  catch(e){root.className='error';root.textContent='MVP-Tipps nicht abrufbar: '+e.message;}
 }
 async function load(){
  if(loading)return;loading=true;
  try{
   overview=await get('/api/mvp-tipps');
   const sel=$('#mvpDay'),keep=Number(sel.value)||null;
   const days=[...overview.days].sort((a,b)=>b.day-a.day);
   sel.innerHTML=days.map(d=>`<option value="${d.day}">Spieltag ${d.day}${d.day===overview.next?' · offen':d.status==='live'?' · läuft':''}${d.tips?` (${d.tips} Tipps)`:''}</option>`).join('');
   const pick=keep&&days.some(d=>d.day===keep)?keep:overview.next||days[0]?.day;
   if(pick){sel.value=String(pick);await loadDay(pick);}
   else $('#mvpContent').textContent='Kein Spieltag zum Tippen gefunden.';
  }catch(e){$('#mvpContent').className='error';$('#mvpContent').textContent='MVP-Tipps nicht abrufbar: '+e.message;}
  finally{loading=false;}
 }

 document.addEventListener('submit',async e=>{
  if(e.target.id!=='mvpForm')return;e.preventDefault();
  const msg=$('#mvpMsg'),p=playerByLabel.get($('#mvpPlayer').value.trim()),pts=Number($('#mvpPoints').value);
  if(!p){msg.textContent='Bitte einen Spieler aus der Vorschlagsliste wählen.';return;}
  if(!Number.isInteger(pts)){msg.textContent='Bitte eine ganze Punktzahl eintragen.';return;}
  const btn=e.target.querySelector('button');btn.disabled=true;msg.textContent='Speichere …';
  try{await get(`/api/mvp-tipps/${data.day}`,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({playerId:p.id,points:pts})});await loadDay(data.day);}
  catch(err){msg.textContent='Nicht gespeichert: '+err.message;btn.disabled=false;}
 });
 document.addEventListener('change',e=>{
  if(e.target.id==='mvpDay')loadDay(Number(e.target.value));
  if(e.target.id==='mvpRuleSelect')$('#mvpRuleText').hidden=e.target.value!=='eigene';
 });
 document.addEventListener('click',async e=>{
  if(e.target.id==='mvpRuleSave'){
   const m=$('#mvpRuleMsg');m.textContent='Speichere …';
   try{await get(`/api/mvp-tipps/${data.day}/rule`,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({ruleId:$('#mvpRuleSelect').value,text:$('#mvpRuleText').value})});m.textContent='Tippregel gespeichert.';await loadDay(data.day);}
   catch(err){m.textContent='Fehler: '+err.message;}
  }
  if(e.target.id==='mvpToNpc'){
   const m=$('#mvpNpcMsg');
   if(!confirm(`Joker-Gewinner für Spieltag ${data.day} in der BumsParade durch den Vorschlag ersetzen?`))return;
   try{await get(`/api/npc-jokers/${data.day}`,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({rule:`${data.rule.title}: ${data.rule.text}`,winners:data.result.winners})});m.textContent='In der BumsParade eingetragen.';}
   catch(err){m.textContent='Fehler: '+err.message;}
  }
  if(e.target.closest?.('[data-kbl-nav="mvp"]'))load();
 });
 window.addEventListener('hashchange',()=>{if(location.hash==='#mvp')load();});
 setInterval(()=>{
  for(const el of document.querySelectorAll('[data-mvp-left]')){el.textContent=left(el.dataset.mvpLeft);if(Date.parse(el.dataset.mvpLeft)<=Date.now()&&data?.open)load();}
 },30000);
 if(typeof onConnected!=='undefined')onConnected.push(()=>{load();});
})();
