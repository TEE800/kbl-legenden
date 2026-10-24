// Ansicht "Arena" (Kevin-Wunsch): zweite Liga "Legenden Arena" im Head-to-Head-Modus. Je Spieltag Duelle zwischen zwei Managern,
// als Cartoon-Rennen wie beim MVP-Tipp (Männchen aus public/mvp-tipp.js, window.kblToon). Daten von /api/arena und /api/arena/:day.
(()=>{
 const $=s=>document.querySelector(s);
 const esc=v=>String(v??'').replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
 const fmt=n=>n==null||!Number.isFinite(Number(n))?'–':new Intl.NumberFormat('de-DE').format(n);
 const when=s=>s?new Date(s).toLocaleString('de-DE',{weekday:'short',day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'}):'–';
 let overview=null,data=null,loading=false;
 const T=()=>window.kblToon;
 const avatar=img=>!img?'':/^https?:\/\//.test(img)?img:'https://kickbase.b-cdn.net/'+String(img).replace(/^\//,'');

 async function get(url){
  const r=await fetch(url,{cache:'no-store'});const d=await r.json().catch(()=>({}));
  if(!r.ok)throw Error(d.error||`HTTP ${r.status}`);return d;
 }
 function left(iso){
  const ms=Date.parse(iso)-Date.now();if(!(ms>0))return 'Anpfiff';
  const d=Math.floor(ms/864e5),h=Math.floor(ms/36e5)%24,m=Math.floor(ms/6e4)%60;
  return d?`noch ${d} T. ${h} Std.`:h?`noch ${h} Std. ${m} Min.`:`noch ${m} Min.`;
 }
 // Kopf eines Managers: sein Kickbase-Profilbild, sonst Anfangsbuchstabe (Kickbase CPU: Roboter).
 const face=(m,cls)=>m.cpu?`<span class="${cls} arena-noimg">🤖</span>`:m.img?`<img class="${cls}" src="${esc(avatar(m.img))}" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.replaceWith(Object.assign(document.createElement('span'),{className:'${cls} arena-noimg',textContent:${esc(JSON.stringify((m.name||'?').trim()[0]||'?'))}}))">`:`<span class="${cls} arena-noimg">${esc((m.name||'?').trim()[0]||'?')}</span>`;

 function stateText(d){
  if(d.status==='upcoming')return `<p class="arena-note">Anpfiff ${esc(when(d.firstKickoffUTC))} · <b data-arena-left="${esc(d.firstKickoffUTC||'')}">${esc(left(d.firstKickoffUTC))}</b>. Die Paarungen stehen schon, die Aufstellungen werden erst mit dem Anpfiff sichtbar.</p>`;
  const src=d.source==='datei'&&d.dataAt?` Paarungen und Aufstellungen: Stand ${esc(when(d.dataAt))}.`:'';
  if(d.lineupsMissing)return `<p class="arena-note error">Das fehlt: die Aufstellungen von Spieltag ${d.day}. Sie kommen mit dem nächsten Abruf über ein Arena-Konto (T800 am PC).${src}</p>`;
  return src?`<p class="arena-note muted tiny">${src.trim()}</p>`:'';
 }
 // Anzeigetafel: je Duell eine aufklappbare Zeile (Feste Regel: startet zu), darin die beiden Elfen.
 function board(d){
  const started=d.status!=='upcoming';
  return `<div class="arena-board">${d.duels.map((x,i)=>{
   const lead=x.winner,sideCls=m=>lead&&lead!=='draw'?(lead===m.id?' win':' lose'):'';
   const res=!started?'<span class="arena-vs">vs</span>':`<span class="arena-score"><b class="${sideCls(x.a).trim()}">${fmt(x.a.points)}</b><i>:</i><b class="${sideCls(x.b).trim()}">${fmt(x.b.points)}</b></span>`;
   const tag=!started?'':x.final?(lead==='draw'?'Unentschieden':`Sieg ${esc(lead===x.a.id?x.a.name:x.b.name)}`):lead==='draw'?'Gleichstand':`${esc(lead===x.a.id?x.a.name:x.b.name)} führt mit ${fmt(Math.abs(x.diff))}`;
   return `<details class="acc-group arena-duel" data-arena-duel="${i}"><summary><span class="arena-side a${sideCls(x.a)}">${face(x.a,'arena-ava')}<span class="arena-name">${esc(x.a.name)}</span></span>${res}<span class="arena-side b${sideCls(x.b)}"><span class="arena-name">${esc(x.b.name)}</span>${face(x.b,'arena-ava')}</span>${tag?`<small class="arena-tag${x.final?'':' live'}">${tag}</small>`:''}</summary><div class="acc-sub">${duelDetail(d,x)}</div></details>`;
  }).join('')}</div>`;
 }
 function playerList(m){
  if(!m.players)return '<p class="muted tiny">Keine Aufstellung.</p>';
  const K=T();
  return `<ol class="arena-players">${m.players.map(p=>`<li class="${p.state==='live'?'live':''}${p.total!=null&&p.total<0?' neg':''}">${K?`<span class="arena-phead"><img src="${esc(K.headSrc(p.id))}" alt="" loading="lazy" onerror="this.remove()"></span>`:''}<span class="arena-pname">${esc(p.name)}${p.captain?' <b class="arena-cap" title="Kapitän: Punkte doppelt">C</b>':''}<small class="muted">${esc(p.team||'')}</small></span><span class="arena-ppts">${p.state==='open'?'<small class="muted">noch nicht</small>':p.state==='live'?'⚽ ':''}${p.state==='open'?'':fmt(p.total)}${p.captain&&p.points!=null?`<small class="muted"> (2×${fmt(p.points)})</small>`:''}</span></li>`).join('')}</ol>`;
 }
 function duelDetail(d,x){
  if(d.status==='upcoming')return `<p class="muted">Die Aufstellungen von ${esc(x.a.name)} und ${esc(x.b.name)} sind bis zum Anpfiff geheim.</p>`;
  const extra=m=>m.open||m.live?`<small class="muted">${m.live?`${m.live} spielen gerade`:''}${m.live&&m.open?', ':''}${m.open?`${m.open} noch nicht gespielt`:''}</small>`:'';
  const check=m=>d.status==='finished'&&m.calc!=null&&m.kbPoints!=null&&m.calc!==m.kbPoints?`<small class="muted">Kickbase: ${fmt(m.kbPoints)}, Summe der Spieler: ${fmt(m.calc)}</small>`:'';
  return `${duelRace(d,[x],true)}<div class="arena-cols">${[x.a,x.b].map(m=>`<div class="arena-col"><div class="arena-colhead">${face(m,'arena-ava')}<b>${esc(m.name)}</b><span class="arena-colpts">${fmt(m.points)}</span></div>${extra(m)}${check(m)}${playerList(m)}</div>`).join('')}</div>`;
 }
 // Cartoon: je Duell eine Reihe auf dem Platz, beide Manager als Männchen mit ihrem Profilbild als Kopf, Position nach Punkten.
 // Ein Seil zwischen beiden zeigt den Abstand. Wer gerade Spieler auf dem Platz hat, rennt mit Ball, Führender mit Krone.
 function duelRace(d,duels,single){
  const K=T();if(!K||d.status==='upcoming'||!duels.length)return '';
  const vals=duels.flatMap(x=>[x.a.points,x.b.points]).filter(v=>v!=null),lo=Math.min(0,...vals),hi=Math.max(1,...vals),span=hi-lo||1;
  const pos=v=>4+76*((v??0)-lo)/span;
  const ROW=single?150:96,TOP=single?34:30;
  const fig=(m,x,y,lead,place)=>{const [shirt,trim]=K.clubColor(m.name),neg=m.points!=null&&m.points<0,run=m.live?' run':m.open?' idle':neg?' fall':'';
   return `<div class="toon-runner arena-runner${run}${x>50?' flip':''}" style="left:${x.toFixed(1)}%;top:${y}px">${lead?'<div class="toon-crown">👑</div>':''}<div class="toon-body">${K.toon({},shirt,trim,neg?'sad':lead?'wow':'happy',place??'')}${face(m,'arena-face')}</div>${m.live?'<span class="toon-ball">⚽</span>':''}<div class="toon-tag">${esc(m.name)} <b>${fmt(m.points)}</b></div></div>`;};
  const place=id=>d.table?.find(r=>r.id===id)?.hhpl??'';
  const rows=duels.map((x,i)=>{
   const y=TOP+i*ROW,xa=pos(x.a.points),xb=pos(x.b.points),near=Math.abs(xa-xb)<9;
   const ya=near||single?y-(single?28:16):y,yb=near||single?y+(single?40:16):y;
   const l=Math.min(xa,xb),w=Math.abs(xa-xb),lead=x.winner;
   return `<div class="arena-rope" style="left:${(l+2).toFixed(1)}%;width:${w.toFixed(1)}%;top:${(single?y+30:y+34)}px">${x.diff?`<span>${fmt(Math.abs(x.diff))}</span>`:''}</div>`+
    fig(x.a,xa,ya,lead===x.a.id,place(x.a.id))+fig(x.b,xb,yb,lead===x.b.id,place(x.b.id));
  }).join('');
  const h=single?TOP+ROW:TOP+duels.length*ROW;
  return `<div class="toon-pitch arena-pitch${single?' single':''}" style="height:${h}px"><i class="tp-start"></i><i class="tp-mid"></i><i class="tp-circle"></i>${rows}</div>`;
 }
 function table(d){
  if(!d.table?.length)return '';
  const live=overview?.live&&d.tableDay===overview.live;
  return `<details class="acc-group arena-table"><summary>Tabelle Head-to-Head${live?' <span class="live-badge">LIVE</span>':''}</summary><div class="acc-sub"><div class="arena-tablewrap"><table><thead><tr><th>#</th><th>Manager</th><th class="right" title="Siege – Unentschieden – Niederlagen">S-U-N</th><th class="right">Punkte</th><th class="right" title="Kickbase-Punkte gesamt">KB-Punkte</th></tr></thead><tbody>${d.table.map(r=>`<tr><td>${r.hhpl??'–'}</td><td><span class="arena-tname">${face({...r,cpu:r.id==='1'},'arena-ava sm')}${esc(r.name)}</span></td><td class="right">${r.w}-${r.d}-${r.l}</td><td class="right"><b>${fmt(r.hhsp)}</b></td><td class="right">${fmt(r.sp)}</td></tr>`).join('')}</tbody></table></div><p class="muted tiny">Sieg 3 Punkte, Unentschieden 1, Niederlage 0. Bei Punktgleichheit entscheiden die Kickbase-Punkte.${live?' Mit dem laufenden Spieltag (vorläufig).':''}</p></div></details>`;
 }
 function render(){
  const root=$('#arenaContent');if(!root||!data)return;
  const d=data;
  $('#arenaMeta').innerHTML=`${esc(d.name)} · ${d.status==='live'?'<span class="live-badge" style="margin:0">LIVE</span>':d.status==='finished'?'beendet':'kommt noch'}`;
  // Beim automatischen Neuladen bleiben aufgeklappte Bereiche offen; beim Öffnen des Reiters klappt kblCollapseView alles zu.
  const wasOpen=new Set([...root.querySelectorAll('details.acc-group[open]')].map(x=>x.dataset.arenaDuel??x.className));
  root.className='';
  root.innerHTML=stateText(d)+board(d)+(d.status!=='upcoming'&&d.duels.length>1?`<details class="acc-group arena-race"><summary>Duell-Rennen: alle auf einem Platz</summary><div class="acc-sub">${duelRace(d,d.duels,false)}<p class="muted tiny">Je mehr Punkte, desto weiter rechts. Das Seil zeigt den Abstand im Duell, die Krone den Führenden. Wer gerade Spieler auf dem Platz hat, rennt mit Ball. Die Zahl auf dem Trikot ist der Tabellenplatz.</p></div></details>`:'')+table(d);
  root.querySelectorAll('details.acc-group').forEach(x=>{if(wasOpen.has(x.dataset.arenaDuel??x.className))x.open=true;});
 }
 async function loadDay(day){
  const root=$('#arenaContent');
  if(!data||data.day!==day){root.className='muted';root.textContent=`Lade Spieltag ${day} …`;}
  try{data=await get(`/api/arena/${day}`);render();}
  catch(e){root.className='error';root.textContent='Arena nicht abrufbar: '+e.message;}
 }
 async function load(){
  if(loading)return;loading=true;
  try{
   overview=await get('/api/arena');
   const sel=$('#arenaDay'),keep=Number(sel.value)||null;
   const days=[...overview.days].sort((a,b)=>b.day-a.day);
   sel.innerHTML=days.map(d=>`<option value="${d.day}">Spieltag ${d.day}${d.status==='live'?' · läuft':d.status==='upcoming'?' · kommt':''}</option>`).join('');
   // Zuerst der laufende Spieltag, sonst die letzte Auswahl, sonst der zuletzt beendete.
   const pick=overview.live||(keep&&days.some(d=>d.day===keep)?keep:overview.current||days.find(d=>d.status==='finished')?.day||days[0]?.day);
   if(pick){sel.value=String(pick);await loadDay(pick);}
   else $('#arenaContent').textContent='Noch keine Paarungen gefunden.';
  }catch(e){$('#arenaContent').className='error';$('#arenaContent').textContent='Arena nicht abrufbar: '+e.message;$('#arenaMeta').textContent='–';}
  finally{loading=false;}
 }
 document.addEventListener('change',e=>{if(e.target.id==='arenaDay')loadDay(Number(e.target.value));});
 document.addEventListener('click',e=>{if(e.target.closest?.('[data-kbl-nav="arena"]'))load();});
 window.addEventListener('hashchange',()=>{if(location.hash==='#arena')load();});
 setInterval(()=>{for(const el of document.querySelectorAll('[data-arena-left]'))el.textContent=left(el.dataset.arenaLeft);},30000);
 // Während der Spiele den Stand alle 2 Minuten neu holen, solange der Reiter sichtbar ist.
 setInterval(()=>{if(data?.status==='live'&&$('#arenaContent')?.offsetParent&&!document.hidden)loadDay(data.day);},120000);
})();
