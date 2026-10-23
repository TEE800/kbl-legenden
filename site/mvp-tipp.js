// Ansicht "MVP-Tipp" (NPC Goes MVP): verdeckter Tipp auf Spieler und Punktzahl, bis zum ersten Anstoß änderbar (Daten von /api/mvp-tipps).
(()=>{
 const $=s=>document.querySelector(s);
 const esc=v=>String(v??'').replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
 const fmt=n=>n==null||!Number.isFinite(Number(n))?'–':new Intl.NumberFormat('de-DE').format(n);
 const when=s=>s?new Date(s).toLocaleString('de-DE',{weekday:'short',day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'}):'–';
 const STATIC=!!window.KBL_STATIC;
 // Online-Seite mit Tippdienst (tools/tipp-dienst): offene und laufende Spieltage kommen live vom Dienst, beendete (mit Auswertung) aus dem Export.
 const API=STATIC?String(window.KBL_TIPP_API||'').replace(/\/+$/,''):'';
 const LIVE=!STATIC||!!API;
 const tippUrl=path=>API?API+path.replace(/^\/api\/mvp-tipps/,'/tipps').replace('/tipps/codes/','/codes/'):path;
 const adminCode=()=>$('#mvpAdminCode')?.value||'';
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
  if(players){fillPlayers();return;}
  const d=await get('/api/mvp-tipps/players');players=d.players;
  const seen=new Map();
  for(const p of players){let l=`${p.name} (${p.team})`;const n=(seen.get(l)||0)+1;seen.set(l,n);if(n>1)l+=` #${n}`;p.label=l;playerByLabel.set(l,p);}
  fillPlayers();
 }
 function fillPlayers(){
  if(!players)return;
  for(const dl of document.querySelectorAll('datalist[data-mvp-players]'))if(!dl.children.length)dl.innerHTML=players.map(p=>`<option value="${esc(p.label)}"></option>`).join('');
 }
 function ruleBox(d){
  if(!d.rule)return `<div class="mvp-rule"><div class="eyebrow">TIPPREGEL SPIELTAG ${d.day}</div><p>Die Tippregel für diesen Spieltag steht noch nicht fest. Getippt werden kann trotzdem schon.</p></div>`;
  // Die Liga schreibt die Regel selbst (keine Vorlagen); ältere Einträge mit Vorlagen-Titel zeigen ihn weiter an.
  return `<div class="mvp-rule"><div class="eyebrow">TIPPREGEL SPIELTAG ${d.day}</div>${d.rule.id!=='eigene'?`<strong>${esc(d.rule.title)}</strong>`:''}<p class="mvp-rule-text">${esc(d.rule.text)}</p>${d.rule.by?`<small class="muted">Regel bestimmt von <b>${esc(d.rule.by.name)}</b></small>`:''}</div>`;
 }
 function deadline(d){
  if(d.open)return `<p class="mvp-deadline">Tipps bis <b>${esc(when(d.deadline))}</b>${d.firstMatch?` (${esc(d.firstMatch)})`:''} · <span data-mvp-left="${esc(d.deadline)}">${left(d.deadline)}</span></p>`;
  if(d.status==='upcoming')return `<p class="muted">Auf diesen Spieltag wird erst getippt, wenn er als nächster dran ist.</p>`;
  return `<p class="muted">Angepfiffen am ${esc(when(d.deadline))}. Die Tipps sind gesperrt und für alle sichtbar.</p>`;
 }
 // Ohne Anmeldung: Name wählen und mit eigenem Tipp-Code tippen (beim ersten Tipp selbst festgelegt).
 const store={get(){try{return localStorage.getItem('kblMvpManager')||'';}catch{return '';}},set(v){try{localStorage.setItem('kblMvpManager',v);}catch{}}};
 let codeTip=null;
 function form(d){
  if(!d.open)return '';
  if(!LIVE)return `<p class="muted">In der Online-Ansicht kann man noch nicht tippen.</p>`;
  const byCode=!d.me,who=byCode?d.managers.find(m=>m.id===store.get()):null;
  const mine=byCode?(codeTip&&codeTip.day===d.day&&codeTip.id===who?.id?codeTip.tip:null):d.managers.find(m=>m.id===d.me)?.tip;
  const codeFields=byCode?`<label class="acc-label">Dein Name<select id="mvpWho" required><option value="">Bitte wählen …</option>${d.managers.map(m=>`<option value="${esc(m.id)}"${m.id===who?.id?' selected':''}>${esc(m.name)}</option>`).join('')}</select></label>
   <label class="acc-label">Tipp-Code<input id="mvpCode" type="password" inputmode="numeric" autocomplete="off" pattern="[0-9]{4,8}" minlength="4" maxlength="8" required placeholder="4–8 Ziffern"></label>`:'';
  const hint=byCode?(who?(who.hasCode?'Gib deinen Tipp-Code ein.':'Du tippst zum ersten Mal: Den Code legst du jetzt selbst fest (4 bis 8 Ziffern). Merk ihn dir gut, du brauchst ihn für jede Änderung.'):'Wähle deinen Namen.'):'';
  return `<form class="mvp-form" id="mvpForm" autocomplete="off">${codeFields}
   <label class="acc-label">Spieler<input id="mvpPlayer" list="mvpPlayers" placeholder="Name eintippen …" required value="${esc(mine?`${mine.player} (${mine.team})`:'')}"></label>
   <label class="acc-label">Punkte<input id="mvpPoints" type="number" inputmode="numeric" step="1" min="-1000" max="2000" required value="${mine?esc(mine.points):''}"></label>
   <button class="gold" type="submit">${mine||who?.tipped?'Tipp ändern':'Tipp abgeben'}</button>${byCode&&who?.tipped?' <button type="button" class="ghost" id="mvpShowMine">Meinen Tipp anzeigen</button>':''}</form>
   <datalist id="mvpPlayers" data-mvp-players></datalist>
   ${hint?`<p class="muted tiny" id="mvpHint">${esc(hint)}</p>`:''}
   <p class="muted" id="mvpMsg" role="status">${mine?`Dein Tipp: <b>${esc(mine.player)}</b> (${esc(mine.team)}), ${fmt(mine.points)} Punkte · gespeichert ${esc(when(mine.updatedAt))}. Nur du siehst ihn bis zum Anpfiff.`:byCode?(who?.tipped?'Du hast schon getippt. Mit deinem Code kannst du ihn ansehen oder ändern.':''):'Du hast noch nicht getippt.'}</p>`;
 }
 function table(d){
  const res=d.result,byId=new Map((res?.rows||[]).map(r=>[r.managerId,r])),win=new Set(res?.winners||[]);
  const progn=d.rule?.id==='prognose',showRes=!!res?.rows?.length;
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
 // Übersicht nach dem Anpfiff: alle Tipps mit den aktuellen Punkten der getippten Spieler.
 // Führend = getippter Spieler mit den meisten Punkten, danach kleinster Abstand zur getippten Punktzahl (Grundidee des MVP-Tipps).
 // Die Tippregel schreibt die Liga als freien Text, darum entscheidet am Ende die Liga selbst.
 const STATE={done:'Spiel vorbei',live:'Spiel läuft',open:'noch nicht gespielt',error:'nicht abrufbar',wait:'Punkte folgen'};
 const clock=s=>s?new Date(s).toLocaleTimeString('de-DE',{hour:'2-digit',minute:'2-digit'}):'';
 function standings(d){
  const tr=d.tracking?.players||{};
  const rows=d.managers.filter(m=>m.tip).map(m=>{const x=tr[m.tip.playerId],pts=x?.points??null;return {m,t:m.tip,pts,state:x?.state||'wait',diff:pts===null?null:Math.abs(m.tip.points-pts)};});
  rows.sort((a,b)=>(a.pts===null)-(b.pts===null)||(b.pts??0)-(a.pts??0)||(a.diff??1e9)-(b.diff??1e9)||a.m.name.localeCompare(b.m.name,'de'));
  let rank=0;rows.forEach((r,i)=>{const p=rows[i-1];r.rank=r.pts===null?null:p&&p.pts===r.pts&&p.diff===r.diff?p.rank:(rank=i+1);});
  return {rows,lead:rows.filter(r=>r.rank===1)};
 }
 function allTips(d){
  if(!d.reveal)return '';
  const {rows,lead}=standings(d);if(!rows.length)return '';
  const fin=d.status==='finished',max=Math.max(1,...rows.map(r=>Math.max(r.pts??0,r.t.points)));
  const pct=v=>Math.max(0,Math.min(100,(v/max)*100)).toFixed(1);
  let h=`<h4 style="margin:22px 0 8px">Übersicht aller Tipps <small class="muted">${d.tracking?`Punkte Stand ${esc(clock(d.tracking.updatedAt))} Uhr`:'Punkte folgen'}</small></h4>`;
  if(lead.length)h+=`<div class="mvp-lead"><div class="eyebrow">${fin?'VORNE NACH PUNKTEN':'FÜHREND'}</div>${lead.map(r=>`<div><b>${esc(r.m.name)}</b> mit ${esc(r.t.player)} <small class="muted">${esc(r.t.team)}</small>: <b>${fmt(r.pts)}</b> Punkte, getippt ${fmt(r.t.points)} (${r.diff?`${fmt(r.diff)} daneben`:'genau getroffen'})</div>`).join('')}</div>
   <p class="muted tiny">Vorne ist, wessen Spieler gerade die meisten Punkte hat. Bei Gleichstand zählt, wer mit seiner Punktzahl näher dran ist. Wer am Ende gewinnt, entscheidet ihr nach der Tippregel.</p>`;
  else h+=`<p class="muted">Noch hat keiner der getippten Spieler Punkte.</p>`;
  const picks=new Map();for(const r of rows){const k=r.t.playerId,c=picks.get(k)||{t:r.t,n:0};c.n++;picks.set(k,c);}
  const multi=[...picks.values()].filter(c=>c.n>1).sort((a,b)=>b.n-a.n);
  if(multi.length)h+=`<p class="mvp-picks">Mehrfach getippt: ${multi.map(c=>`<span class="pill">${esc(c.t.player)} ×${c.n}</span>`).join(' ')}</p>`;
  h+='<div class="mvp-cards">'+rows.map(r=>`<div class="mvp-card${r.rank===1?' lead':''}${r.m.id===d.me?' me':''}">
   <div class="mvp-card-top"><span class="mvp-rank">${r.rank??'–'}</span><b>${esc(r.m.name)}</b>${r.t.late?' <small class="mvp-late">nachgetragen</small>':''}</div>
   <div class="mvp-card-player">${esc(r.t.player)} <small class="muted">${esc(r.t.team)}</small></div>
   <div class="mvp-bar" title="Balken = aktuelle Punkte, Strich = getippte Punktzahl"><span style="width:${r.pts===null?0:pct(r.pts)}%"></span><i style="left:${pct(r.t.points)}%"></i></div>
   <div class="mvp-card-nums"><span><b>${r.pts===null?'–':fmt(r.pts)}</b> Pkt. <small class="muted">${esc(STATE[r.state]||'')}</small></span><span class="muted">Tipp ${fmt(r.t.points)}${r.diff===null?'':r.diff?` · ${fmt(r.diff)} daneben`:' · genau'}</span></div>
  </div>`).join('')+'</div>';
  const none=d.managers.filter(m=>!m.tipped);
  if(none.length)h+=`<p class="muted tiny">Ohne Tipp: ${none.map(m=>esc(m.name)).join(', ')}</p>`;
  return h;
 }
 // Nachtragen nach dem Anpfiff (nur Admin): für Manager ohne eigenen Tipp, nachgetragene lassen sich korrigieren.
 let lateCode='',lateMsg='';
 function late(d){
  if(!d.reveal||!(API||d.admin&&!STATIC))return '';
  const opts=d.managers.filter(m=>!m.tipped||m.tip?.late);
  if(!opts.length)return '';
  return `<details class="acc-group" id="mvpLate" style="margin-top:18px"${lateMsg?' open':''}><summary>Tipp nachtragen (nur Admin)</summary><div class="acc-sub">
   <p class="muted">Für Manager, die nicht rechtzeitig in der App getippt haben, zum Beispiel im Chat. Eigene Tipps werden nie überschrieben, nachgetragene kannst du korrigieren.</p>
   <form class="mvp-form" id="mvpLateForm" autocomplete="off">
    <label class="acc-label">Manager<select id="mvpLateWho" required><option value="">Bitte wählen …</option>${opts.map(m=>`<option value="${esc(m.id)}">${esc(m.name)}${m.tip?.late?' (nachgetragen)':''}</option>`).join('')}</select></label>
    <label class="acc-label">Spieler<input id="mvpLatePlayer" list="mvpLatePlayers" placeholder="Name eintippen …" required></label>
    <label class="acc-label">Punkte<input id="mvpLatePoints" type="number" inputmode="numeric" step="1" min="-1000" max="2000" required></label>
    ${API?`<label class="acc-label">Admin-Code<input id="mvpLateCode" type="password" autocomplete="off" required value="${esc(lateCode)}"></label>`:''}
    <button class="gold" type="submit">Tipp nachtragen</button></form>
   <datalist id="mvpLatePlayers" data-mvp-players></datalist>
   <p class="muted" id="mvpLateMsg" role="status">${esc(lateMsg)}</p></div></details>`;
 }
 function result(d){
  const r=d.result;if(!r)return d.status==='live'?'<p class="muted">Ausgewertet wird, sobald der Spieltag beendet ist.</p>':'';
  let h='';
  if(r.mvp)h+=`<p class="mvp-mvp">MVP des Spieltags: ${r.mvp.players.map(p=>`<b>${esc(p.name)}</b> (${esc(p.team)})`).join(', ')} mit <b>${fmt(r.mvp.points)}</b> Punkten.</p>`;
  if(r.message)h+=`<p class="${['ok','empty','manual'].includes(r.status)?'muted':'error'}">${esc(r.message)}</p>`;
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
  root.innerHTML=ruleBox(d)+deadline(d)+form(d)+result(d)+allTips(d)+(!d.reveal||d.result?.rows?.length?table(d):'')+late(d);lateMsg='';
  if($('#mvpLate')?.open)loadPlayers().catch(()=>{});
  const admin=$('#mvpAdminBox');admin.hidden=!((d.admin&&!STATIC||API&&d.online)&&d.status==='upcoming'&&!d.locked);$('#mvpAdminCodeBox').hidden=!API;
  if(!admin.hidden){
   const withCode=d.managers.filter(m=>m.hasCode);
   $('#mvpCodes').innerHTML=withCode.length?'<h4>Tipp-Codes zurücksetzen</h4><p class="muted tiny">Falls jemand seinen Code vergessen hat.</p>'+withCode.map(m=>`<button type="button" class="ghost" data-mvp-reset="${esc(m.id)}" data-name="${esc(m.name)}" style="margin:4px 6px 4px 0">${esc(m.name)}</button>`).join(''):'';
   $('#mvpRuleText').value=d.rule?.text||'';
   $('#mvpRuleBy').innerHTML='<option value="">Bitte wählen …</option>'+d.managers.map(m=>`<option value="${esc(m.id)}">${esc(m.name)}</option>`).join('');
   $('#mvpRuleBy').value=d.rule?.by?.id||'';
  }
  if(d.open&&LIVE)loadPlayers().then(()=>{const dl=$('#mvpPlayers');if(dl&&!dl.children.length)dl.innerHTML=players.map(p=>`<option value="${esc(p.label)}"></option>`).join('');}).catch(e=>{const m=$('#mvpMsg');if(m)m.textContent='Spielerliste nicht abrufbar: '+e.message;});
 }
 async function loadDay(day){
  const root=$('#mvpContent');
  if(!data||data.day!==day){root.className='muted';root.textContent=`Lade Spieltag ${day} …`;}
  try{const st=overview?.days?.find(x=>x.day===day)?.status;
   let d;
   if(API&&st!=='finished'){
    // Tipps live vom Tippdienst, Punkte der getippten Spieler aus dem Export (alle 10 Minuten während der Spiele).
    d=await get(tippUrl(`/api/mvp-tipps/${day}`));
    if(d.reveal){const x=await get(`/api/mvp-tipps/${day}`).catch(()=>null);d.tracking=x?.tracking||null;}
   }else{
    d=await get(`/api/mvp-tipps/${day}`);
    // Beendeter Spieltag online: gerade nachgetragene Tipps schon zeigen, bevor der nächste Export sie übernimmt.
    if(API){const x=await get(tippUrl(`/api/mvp-tipps/${day}`)).catch(()=>null);
     if(x?.managers)for(const m of d.managers){const o=x.managers.find(y=>y.id===m.id);if(o?.tip&&!m.tip){m.tip=o.tip;m.tipped=true;}}}
   }
   data=d;render();}
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
  const who=$('#mvpWho')?.value,code=$('#mvpCode')?.value;
  if($('#mvpWho')&&!who){msg.textContent='Bitte deinen Namen wählen.';btn.disabled=false;return;}
  try{const r=await get(tippUrl(`/api/mvp-tipps/${data.day}`),{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({playerId:p.id,points:pts,...(who?{managerId:who,code}:{})})});
   if(who)codeTip={day:data.day,id:who,tip:r.tip};await loadDay(data.day);
   if(r.codeCreated){const m=$('#mvpMsg');if(m)m.insertAdjacentHTML('beforeend','<br><b>Dein Tipp-Code ist gespeichert.</b> Merk ihn dir gut.');}}
  catch(err){msg.textContent='Nicht gespeichert: '+err.message;btn.disabled=false;}
 });
 document.addEventListener('submit',async e=>{
  if(e.target.id!=='mvpLateForm')return;e.preventDefault();
  const msg=$('#mvpLateMsg'),who=$('#mvpLateWho').value,p=playerByLabel.get($('#mvpLatePlayer').value.trim()),pts=Number($('#mvpLatePoints').value);
  if(!who){msg.textContent='Bitte einen Manager wählen.';return;}
  if(!p){msg.textContent='Bitte einen Spieler aus der Vorschlagsliste wählen.';return;}
  if(!Number.isInteger(pts)){msg.textContent='Bitte eine ganze Punktzahl eintragen.';return;}
  if($('#mvpLateCode'))lateCode=$('#mvpLateCode').value;
  const btn=e.target.querySelector('button');btn.disabled=true;msg.textContent='Speichere …';
  try{await get(tippUrl(`/api/mvp-tipps/${data.day}/nachtrag`),{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({managerId:who,playerId:p.id,points:pts,adminCode:lateCode})});
   const name=data.managers.find(m=>m.id===who)?.name||'';
   lateMsg=`Tipp für ${name} nachgetragen.${API?' Die Punkte des Spielers erscheinen mit dem nächsten Abgleich (während der Spiele alle 10 Minuten).':''}`;
   await loadDay(data.day);}
  catch(err){msg.textContent='Nicht gespeichert: '+err.message;btn.disabled=false;}
 });
 document.addEventListener('toggle',e=>{if(e.target.id==='mvpLate'&&e.target.open)loadPlayers().catch(err=>{const m=$('#mvpLateMsg');if(m)m.textContent='Spielerliste nicht abrufbar: '+err.message;});},true);
 document.addEventListener('change',e=>{
  if(e.target.id==='mvpLateWho'){const t=data?.managers.find(m=>m.id===e.target.value)?.tip;$('#mvpLatePlayer').value=t?`${t.player} (${t.team})`:'';$('#mvpLatePoints').value=t?t.points:'';}
  if(e.target.id==='mvpDay')loadDay(Number(e.target.value));
  if(e.target.id==='mvpWho'){store.set(e.target.value);codeTip=null;const pl=$('#mvpPlayer')?.value,pt=$('#mvpPoints')?.value;render();if($('#mvpPlayer'))$('#mvpPlayer').value=pl||'';if($('#mvpPoints'))$('#mvpPoints').value=pt||'';}
 });
 document.addEventListener('click',async e=>{
  if(e.target.id==='mvpRuleSave'){
   const m=$('#mvpRuleMsg');m.textContent='Speichere …';
   try{await get(tippUrl(`/api/mvp-tipps/${data.day}/rule`),{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({ruleId:'eigene',text:$('#mvpRuleText').value,byId:$('#mvpRuleBy').value,adminCode:adminCode()})});m.textContent='Tippregel gespeichert.';await loadDay(data.day);}
   catch(err){m.textContent='Fehler: '+err.message;}
  }
  if(e.target.id==='mvpShowMine'){
   const m=$('#mvpMsg'),who=$('#mvpWho')?.value,code=$('#mvpCode')?.value;
   try{const r=await get(tippUrl(`/api/mvp-tipps/${data.day}/mine`),{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({managerId:who,code})});codeTip={day:data.day,id:who,tip:r.tip};render();}
   catch(err){m.textContent=err.message;}
  }
  const rc=e.target.closest?.('[data-mvp-reset]');
  if(rc){const name=rc.dataset.name;if(!confirm(`Tipp-Code von ${name} zurücksetzen? Beim nächsten Tipp legt ${name} einen neuen fest.`))return;
   try{await get(tippUrl(`/api/mvp-tipps/codes/${rc.dataset.mvpReset}`),{method:'DELETE',headers:{'X-Admin-Code':adminCode()}});await loadDay(data.day);}catch(err){alert('Fehler: '+err.message);}
  }
  if(e.target.id==='mvpToNpc'){
   const m=$('#mvpNpcMsg');
   if(!data.rule)return;
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
 // Während der Spiele den Stand alle 2 Minuten neu holen, solange der Reiter sichtbar ist und niemand gerade nachträgt.
 setInterval(()=>{if(data?.status==='live'&&$('#mvpContent')?.offsetParent&&!$('#mvpLate')?.open&&!document.hidden)loadDay(data.day);},120000);
 if(typeof onConnected!=='undefined')onConnected.push(()=>{load();});
})();
