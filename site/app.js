const TARGET_LEAGUE_ID='6422780';
// Organisatorischer Account: bleibt bei Kickbase, wird aber nicht gewertet.
const EXCLUDED_MANAGERS=new Set(['t1000']);
const isEligibleManager=name=>!EXCLUDED_MANAGERS.has(String(name).trim().toLocaleLowerCase('de-DE'));
const $=s=>document.querySelector(s);let currentLeague=null,penalties=[],currentManagers=[],historyData=[];
// Bereiche, die Daten erst nach erfolgreicher Anmeldung laden (Abrechnung, NPC). Werden in loadLeagues der Reihe nach gestartet.
const onConnected=[];
const escapeHtml=v=>String(v).replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
const pick=(o,keys,def='–')=>{for(const k of keys)if(o?.[k]!=null)return o[k];return def};
const leagueItems=d=>[d?.lins,d?.it,d].find(Array.isArray)||[];
const rankingItems=d=>{const a=[d?.it,d?.us,d?.ranking,d?.users,d?.tom,d?.rnks,d].find(Array.isArray)||[];rememberManagerImgs(a);return a;};
const managerName=x=>pick(x,['n','unm','userName','name'],pick(x?.u,['n','unm','name'],'Manager'));
const points=x=>pick(x,['p','pts','points','v','sp','tp'],pick(x?.u,['p','pts','points'],null));
const position=(x,i)=>pick(x,['r','pos','position','pl','rank'],i+1);
// Manager-Logos (Kevin-Wunsch): Profilbild des Managers aus dem Kickbase-Ranking (uim), gemerkt je Name und ID.
// mgrFace(name) setzt das Logo vor einen Namen. Ist das Ranking noch nicht geladen, bleibt ein leerer Platzhalter,
// den fillMgrFaces füllt, sobald die Bilder bekannt sind. Ohne Bild: Anfangsbuchstabe im Kreis.
const KBL_MGR_IMG=new Map();
const mgrKey=n=>String(n??'').trim().toLocaleLowerCase('de-DE');
const kbImgUrl=p=>!p?'':/^https?:\/\//.test(p)?p:'https://kickbase.b-cdn.net/'+String(p).replace(/^\//,'');
function rememberManagerImgs(list){
 let neu=false;
 for(const x of list||[]){const n=x&&(x.n??x.u?.n);if(n==null||x.i==null&&x.u?.i==null)continue;const src=kbImgUrl(x.uim??x.u?.uim)||null;
  for(const k of [mgrKey(n),'#'+(x.i??x.u?.i)])if(!KBL_MGR_IMG.has(k)||src&&KBL_MGR_IMG.get(k)!==src){KBL_MGR_IMG.set(k,src);neu=true;}}
 if(neu)queueMicrotask(fillMgrFaces);
}
const mgrInitial=n=>escapeHtml((String(n??'').trim()[0]||'?').toUpperCase());
function mgrFaceInner(name,id){
 const k=id!=null&&KBL_MGR_IMG.has('#'+id)?'#'+id:mgrKey(name);if(!KBL_MGR_IMG.has(k))return null;
 const src=KBL_MGR_IMG.get(k);
 // width/height: Notgroesse, falls styles.css fehlt oder veraltet ist (sonst erscheint das Profilbild riesig); die CSS-Regeln gehen vor.
 return src?`<img src="${escapeHtml(src)}" alt="" width="24" height="24" referrerpolicy="no-referrer" onerror="this.parentNode.classList.add('mgr-av-txt');this.replaceWith(${escapeHtml(JSON.stringify(String(name??'').trim()[0]?.toUpperCase()||'?'))})">`:mgrInitial(name);
}
function mgrFace(name,cls='',id=null){
 const inner=mgrFaceInner(name,id),txt=inner!=null&&!inner.startsWith('<img');
 return `<span class="mgr-av${txt?' mgr-av-txt':''}${cls?' '+cls:''}" data-mgr="${escapeHtml(name??'')}"${id!=null?` data-mgr-id="${escapeHtml(id)}"`:''} aria-hidden="true">${inner??''}</span>`;
}
// Logo plus Name; Logo und Namensanfang bleiben in einer Zeile, lange Namen dürfen nach „_“ umbrechen.
function mgrName(name,cls='',id=null){
 const t=escapeHtml(name??''),i=t.indexOf('_'),head=i<0?t:t.slice(0,i+1),rest=i<0?'':'<wbr>'+t.slice(i+1).replaceAll('_','_<wbr>');
 return `<span class="mgr-nm">${mgrFace(name,cls,id)}${head}</span>${rest}`;
}
function fillMgrFaces(root=document){
 for(const el of root.querySelectorAll('.mgr-av[data-mgr]:empty')){const inner=mgrFaceInner(el.dataset.mgr,el.dataset.mgrId);if(inner==null)continue;el.innerHTML=inner;if(!inner.startsWith('<img'))el.classList.add('mgr-av-txt');}
}
// Manager mit seinem Profil verlinken (Kevin-Wunsch): Klick öffnet „Managerprofile“ mit diesem Manager. html = Inhalt (Standard: Logo plus Name).
function mgrLink(name,html=mgrName(name)){return `<a class="mgr-link" href="#profiles" data-goto-profile="${escapeHtml(name??'')}">${html}</a>`;}
window.kblMgrFace=mgrFace;window.kblMgrName=mgrName;window.kblMgrLink=mgrLink;window.kblFillMgrFaces=fillMgrFaces;
// Abgelaufene Sitzung (z. B. nach einem Server-Neustart): Anmeldemaske wieder zeigen statt Fehlern in jedem Reiter.
async function api(url,options){const r=await fetch(url,options);const d=await r.json().catch(()=>({}));if(r.status===401&&!String(url).startsWith('/api/login')){try{setConnected(false);}catch{}throw Error('Bitte neu anmelden (Sitzung abgelaufen).');}if(!r.ok)throw Error(d.error||`HTTP ${r.status}`);return d}
function setConnected(on){$('#status').textContent=on?'● Kickbase verbunden':'Nicht verbunden';$('#status').classList.toggle('ok',on);$('#loginCard').classList.toggle('hidden',on);$('#leagueCard').classList.add('hidden');if(!on)$('#dashboard').classList.add('hidden')}
async function loadLeagues(){
 const items=leagueItems(await api('/api/leagues'));
 setConnected(true);
 const l=items.find(item=>String(pick(item,['i','id','leagueId'],''))===TARGET_LEAGUE_ID);
 if(!l){$('#leagueCard').classList.remove('hidden');$('#leagues').textContent='KBL Legenden (Liga-ID 6422780) ist in diesem Kickbase-Konto nicht verfügbar.';return}
 currentLeague={id:TARGET_LEAGUE_ID,name:String(pick(l,['n','name'],'KBL Legenden'))};
 $('#leagueName').textContent=currentLeague.name;
 $('#dashboard').classList.remove('hidden');
 await loadRanking();loadPenalties();
  // Profile und Saisonstatistiken direkt nach dem Verbinden bereitstellen.
  await loadHistory();
  await snapshotInit();
  for(const fn of onConnected){try{await fn();}catch{}}
}
function number(v){const n=Number(v);return Number.isFinite(n)?n:null}
function fmt(n){return n==null?'–':new Intl.NumberFormat('de-DE',{maximumFractionDigits:1}).format(n)}
async function loadRanking(){if(!currentLeague)return;const day=$('#dayNumber').value;$('#rankingMeta').textContent=day?`Spieltag ${day}`:'Gesamtwertung';$('#ranking').innerHTML='<tr><td colspan="6">Lade …</td></tr>';try{const d=await api(`/api/ranking/${encodeURIComponent(currentLeague.id)}${day?`?dayNumber=${encodeURIComponent(day)}`:''}`);const items=rankingItems(d).filter(x=>isEligibleManager(managerName(x)));const managers=items.map((x,i)=>({name:String(managerName(x)),score:number(points(x)),pos:position(x,i)}));managers.sort((a,b) => {
  if (a.score === null) return 1;
  if (b.score === null) return -1;
  return b.score - a.score;
});

managers.forEach((m,i) => {
  m.pos = i + 1;
});currentManagers=managers;rankingDay=day;renderProfiles();renderRankingTable();const scored=managers.filter(m=>m.score!==null);const total=scored.reduce((s,m)=>s+m.score,0);const sorted=[...scored].sort((a,b)=>b.score-a.score);const max=Math.max(1,...scored.map(m=>m.score));$('#bars').innerHTML=sorted.map(m=>`<div class="barline"><span>${mgrName(m.name)}</span><div class="track"><div class="fill" style="width:${Math.max(0,m.score)/max*100}%"></div></div><b>${fmt(m.score)}</b></div>`).join('')||'<p class="muted">Noch keine Punktedaten.</p>';}catch(e){$('#ranking').innerHTML=`<tr><td colspan="6" class="error">${escapeHtml(e.message)}</td></tr>`}}
// Liga-Tabelle: in der Gesamtwertung zusätzlich letzter Spieltag, Platzveränderung und Rückstand auf Platz 1.
let rankingDay='';
function renderRankingTable(){
 const body=$('#ranking');if(!body)return;
 let managers=currentManagers;
 if(!managers.length){body.innerHTML='<tr><td colspan="8">Keine auswertbaren Manager gefunden.</td></tr>';return;}
 // Live-Tabelle (Kevin-Vorgabe): Während des Spieltags Stand nach dem letzten abgeschlossenen Spieltag plus Live-Punkte
 // (/api/live-points, wie in der Übersicht). Kickbase schreibt die Punkte erst nach dem Spieltag ins Ranking.
 const liveDay=kblLiveDay()?.day,base=liveDay&&historyData.find(h=>h.day===liveDay-1&&h.status==='finished');
 const lp=!rankingDay&&base&&pvLive?.day===liveDay&&!pvLive.error?new Map((pvLive.managers||[]).map(x=>[x.name,x.points])):null;
 const title=$('#tableTitle');if(title)title.innerHTML=lp?'LIGA-TABELLE <span class="live-badge">● LIVE</span>':'LIGA-TABELLE';
 if(lp){
  const baseOf=new Map(base.list.map(x=>[x.name,x.score]));
  managers=managers.map(m=>{const b=baseOf.get(m.name),l=lp.get(m.name);return {...m,base:b??null,live:l??null,score:b==null||l==null?null:b+l};})
   .sort((a,b)=>(a.score===null)-(b.score===null)||(b.score??0)-(a.score??0)).map((m,i)=>({...m,pos:i+1}));
 }
 const finished=rankingDay?[]:historyData.filter(h=>h.status==='finished').slice().sort((a,b)=>a.day-b.day);
 const last=finished.at(-1),before=finished.at(-2);
 let now=last?rankMap(last):null,prev=before?rankMap(before):null;
 let lastPoints=new Map((last?.list||[]).map(m=>[m.name,m.dayPoints]));
 // Live: Platzveränderung gegenüber dem Stand vor dem Spieltag, Spalte zeigt die Live-Punkte.
 if(lp){now=new Map(managers.map(m=>[m.name,m.pos]));prev=rankMap(base);lastPoints=new Map(managers.map(m=>[m.name,m.live]));}
 const leader=managers.find(m=>m.score!==null)?.score??null;
 const lastPos=Math.max(...managers.filter(m=>m.score!==null).map(m=>m.pos));
 $('#rankingDayHead').textContent=lp?`ST ${liveDay} LIVE`:last?`ST ${last.day}`:'SPIELTAG';
 // Schnitt und Spieltagssiege über alle abgeschlossenen Spieltage (nur in der Gesamtwertung).
 const avgOf=new Map(),winsOf=new Map();
 for(const h of finished){const scored=h.list.filter(m=>m.dayPoints!==null&&isEligibleManager(m.name));const best=Math.max(...scored.map(m=>m.dayPoints));
  for(const m of scored){const a=avgOf.get(m.name)||{s:0,n:0};a.s+=m.dayPoints;a.n++;avgOf.set(m.name,a);if(m.dayPoints===best)winsOf.set(m.name,(winsOf.get(m.name)||0)+1);}}
 body.innerHTML=managers.map((m,i)=>{
  let move='<span class="muted">–</span>';
  if(now&&prev&&now.has(m.name)&&prev.has(m.name)){const d=prev.get(m.name)-now.get(m.name);move=d>0?`<span class="rank-up">▲${d}</span>`:d<0?`<span class="rank-down">▼${-d}</span>`:'<span class="muted">=</span>';}
  const cls=m.pos===1?'rank-row-1':m.pos<=3?'rank-row-top':m.pos===lastPos&&managers.length>3?'rank-row-last':'';
  const gap=leader===null||m.score===null||m.pos===1?'':`−${fmt(leader-m.score)}`;
  return `<tr class="${cls}"><td>${escapeHtml(m.pos)}</td><td class="center">${move}</td><td><button class="manager-link" data-profile="${i}">${mgrName(m.name)}</button></td><td class="right muted">${last?fmt(lastPoints.get(m.name)):'–'}</td><td class="right muted">${avgOf.has(m.name)?fmt(Math.round(avgOf.get(m.name).s/avgOf.get(m.name).n)):'–'}</td><td class="right muted">${last?(winsOf.get(m.name)||0):'–'}</td><td class="right muted">${gap}</td><td class="right">${fmt(m.score)}</td></tr>`;
 }).join('');
}
function storageKey(){return 'kbl-penalties-'+String(currentLeague?.id||'none')}
function loadPenalties(){try{penalties=JSON.parse(localStorage.getItem(storageKey())||'[]');if(!Array.isArray(penalties))penalties=[]}catch{penalties=[]}renderPenalties();const old=$('#penaltyOld');if(old)old.hidden=!penalties.length}
function renderPenalties(){$('#penaltyList').innerHTML=penalties.length?penalties.map((p,i)=>`<div class="penalty"><span><strong>${escapeHtml(p.manager)}</strong> · ${escapeHtml(p.rule)} <small class="muted">${p.done?'Erledigt':'Offen'}</small></span><div><button class="ghost" data-toggle="${i}">${p.done?'↶':'✓'}</button> <button class="ghost" data-delete="${i}">×</button></div></div>`).join(''):'<p class="muted">Noch keine Strafen erfasst.</p>'}
function savePenalties(){localStorage.setItem(storageKey(),JSON.stringify(penalties));renderPenalties();showProfile()}
$('#penaltyForm').onsubmit=e=>{e.preventDefault();penalties.push({manager:$('#penaltyManager').value.trim(),rule:$('#penaltyRule').value.trim(),done:false});savePenalties();e.target.reset()};
$('#penaltyList').onclick=e=>{const b=e.target.closest('button');if(!b)return;if(b.dataset.toggle!=null)penalties[Number(b.dataset.toggle)].done=!penalties[Number(b.dataset.toggle)].done;if(b.dataset.delete!=null)penalties.splice(Number(b.dataset.delete),1);savePenalties()};
$('#loginForm').onsubmit=async e=>{e.preventDefault();const b=e.submitter;b.disabled=true;$('#loginError').textContent='';try{await api('/api/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:$('#email').value,password:$('#password').value})});$('#password').value='';if(location.hash!=='#overview')location.hash='#overview';await loadLeagues()}catch(err){$('#loginError').textContent=err.message}finally{b.disabled=false}};
$('#logoutBtn').onclick=async()=>{await api('/api/logout',{method:'POST'}).catch(()=>{});currentLeague=null;setConnected(false)};
$('#reloadRanking').onclick=async()=>{await loadRanking();await loadHistory();};
(async()=>{try{await loadLeagues()}catch{setConnected(false)}})();


function renderProfiles(){
 const a=$('#profileSelect'),b=$('#compareSelect');const previousName=a.selectedOptions[0]?.textContent,otherName=b.value===''?null:b.selectedOptions[0]?.textContent;
 a.innerHTML=currentManagers.map((m,i)=>`<option value="${i}">${escapeHtml(m.name)}</option>`).join('');
 b.innerHTML='<option value="">Kein Vergleich</option>'+currentManagers.map((m,i)=>`<option value="${i}">${escapeHtml(m.name)}</option>`).join('');
 const selectedIndex=currentManagers.findIndex(m=>m.name===previousName);
 if(selectedIndex>=0)a.value=String(selectedIndex);
 const compareIndex=currentManagers.findIndex(m=>m.name===otherName);
 if(compareIndex>=0)b.value=String(compareIndex);
 showProfile();
}
// Rekordbuch der aktuellen Halbserie. Für spätere Halbserien kann diese
// reine Auswertung mit einem anderen historyData-Datensatz verwendet werden.
function calculateHallRecords(sourceHistory){
 const finished=sourceHistory.filter(h=>h.status==='finished').slice().sort((a,b)=>a.day-b.day);
 const byManager=new Map(), allDays=[];
 for(const h of finished){
  const ranked=h.list.filter(m=>isEligibleManager(m.name)&&m.dayPoints!==null&&Number.isFinite(m.dayPoints)).slice().sort((a,b)=>b.dayPoints-a.dayPoints);
  if(!ranked.length)continue;
  const high=ranked[0].dayPoints, low=ranked[ranked.length-1].dayPoints;
  const validScores=ranked.filter(m=>m.score!==null&&Number.isFinite(m.score));
  const minScore=validScores.length?Math.min(...validScores.map(m=>m.score)):null;
  // Platz in der Gesamtwertung nach diesem Spieltag; Gleichstand = gleicher Platz.
  const tableRank=m=>m.score!==null&&Number.isFinite(m.score)?1+validScores.filter(x=>x.score>m.score).length:null;
  const maxScore=validScores.length?Math.max(...validScores.map(m=>m.score)):null;
  const dayAvg=ranked.reduce((s,m)=>s+m.dayPoints,0)/ranked.length;
  for(const m of ranked){
   if(!byManager.has(m.name))byManager.set(m.name,[]);
   const e={name:m.name,day:h.day,points:m.dayPoints,score:m.score,win:m.dayPoints===high,last:m.dayPoints===low,second:m.dayPoints<high&&ranked.filter(x=>x.dayPoints>m.dayPoints).length===1,lantern:minScore!==null&&m.score===minScore,deficit:high-m.dayPoints,
    podium:ranked.filter(x=>x.dayPoints>m.dayPoints).length<3,bottom:ranked.length>=6&&ranked.filter(x=>x.dayPoints<m.dayPoints).length<3,tableRank:tableRank(m),
    below:m.dayPoints<dayAvg,gapLeader:maxScore!==null&&m.score!==null&&Number.isFinite(m.score)?maxScore-m.score:null,
    tableBottom:validScores.length>=6&&m.score!==null&&Number.isFinite(m.score)&&validScores.filter(x=>x.score<m.score).length<3};
   byManager.get(m.name).push(e);allDays.push(e);
  }
 }
 const summaries=[],moves=[];
 for(const [name,entries] of byManager){
  entries.sort((a,b)=>a.day-b.day);
  let winStreak=0,maxWin=0,noWin=0,maxNoWin=0,prev=null,prevRank=null,belowStreak=0,maxBelow=0;
  for(const e of entries){
   // Bewegung in der Gesamtwertung nur zwischen direkt aufeinanderfolgenden Spieltagen.
   if(prev!==null&&e.day===prev+1&&prevRank!==null&&e.tableRank!==null)moves.push({name,day:e.day,move:prevRank-e.tableRank});
   prevRank=e.tableRank;
   if(prev!==null&&e.day!==prev+1){winStreak=0;noWin=0;belowStreak=0;}
   belowStreak=e.below?belowStreak+1:0;maxBelow=Math.max(maxBelow,belowStreak);
   winStreak=e.win?winStreak+1:0;
   noWin=e.win?0:noWin+1;
   maxWin=Math.max(maxWin,winStreak);maxNoWin=Math.max(maxNoWin,noWin);prev=e.day;
  }
  const average=entries.reduce((s,e)=>s+e.points,0)/entries.length;
  // Typische Abweichung vom eigenen Schnitt (Standardabweichung), erst ab 3 Spieltagen.
  const spread=entries.length>=3?Math.sqrt(entries.reduce((s,e)=>s+(e.points-average)**2,0)/entries.length):null;
  summaries.push({name,games:entries.length,wins:entries.filter(e=>e.win).length,seconds:entries.filter(e=>e.second).length,lasts:entries.filter(e=>e.last).length,lanterns:entries.filter(e=>e.lantern).length,average,maxWin,maxNoWin,
   leads:entries.filter(e=>e.tableRank===1).length,podiums:entries.filter(e=>e.podium).length,bottoms:entries.filter(e=>e.bottom).length,spread,
   belows:entries.filter(e=>e.below).length,maxBelow,tableBottoms:entries.filter(e=>e.tableBottom).length});
 }
 const select=(items,value,mode='max')=>{
  const eligible=items.filter(x=>Number.isFinite(value(x)));
  if(!eligible.length)return [];
  const extreme=Math[mode](...eligible.map(value));
  return eligible.filter(x=>Math.abs(value(x)-extreme)<0.000001);
 };
 return {finishedDays:finished.length,managerCount:summaries.length,records:[
  {type:'fame',icon:'🚀',title:'PUNKTE-MONSTER',desc:'Bester Spieltag',unit:' Pkt.',winners:select(allDays,e=>e.points),value:e=>e.points,day:true},
  {type:'fame',icon:'🏆',title:'SERIENSIEGER',desc:'Meiste Spieltagssiege',unit:' Siege',winners:select(summaries,s=>s.wins),value:s=>s.wins},
  {type:'fame',icon:'📈',title:'PUNKTE-MASCHINE',desc:'Höchster Punktedurchschnitt',unit:' Ø',winners:select(summaries,s=>s.average),value:s=>s.average},
  {type:'fame',icon:'🔥',title:'SIEGESRAUSCH',desc:'Längste Siegesserie',unit:' in Folge',winners:select(summaries,s=>s.maxWin),value:s=>s.maxWin},
  {type:'fame',icon:'👑',title:'DAUERBRENNER',desc:'Am häufigsten Tabellenführer nach einem Spieltag',unit:'-mal',winners:select(summaries.filter(s=>s.leads>0),s=>s.leads),value:s=>s.leads},
  {type:'fame',icon:'🥉',title:'PODEST-ABO',desc:'Am häufigsten unter den besten drei im Spieltag',unit:'-mal',winners:select(summaries.filter(s=>s.podiums>0),s=>s.podiums),value:s=>s.podiums},
  {type:'fame',icon:'🛫',title:'HIMMELSSTÜRMER',desc:'Größter Sprung nach oben in der Gesamtwertung an einem Spieltag',unit:' Plätze',winners:select(moves.filter(m=>m.move>0),m=>m.move),value:m=>m.move,day:true},
  {type:'fame',icon:'🎯',title:'MR. ZUVERLÄSSIG',desc:'Gleichmäßigste Spieltagspunkte (typische Abweichung vom eigenen Schnitt, ab 3 Spieltagen)',unit:' Pkt.',winners:select(summaries,s=>s.spread,'min'),value:s=>Math.round(s.spread)},
  {type:'shame',icon:'💀',title:'TOTALVERSAGER',desc:'Schlechtester Spieltag',unit:' Pkt.',winners:select(allDays,e=>e.points,'min'),value:e=>e.points,day:true},
  {type:'shame',icon:'🥄',title:'HOLZLÖFFEL',desc:'Häufigster letzter Spieltagsplatz',unit:'-mal',winners:select(summaries,s=>s.lasts),value:s=>s.lasts},
  {type:'shame',icon:'😭',title:'DEMÜTIGUNG',desc:'Größter Rückstand auf den Spieltagssieger',unit:' Pkt.',winners:select(allDays,e=>e.deficit),value:e=>e.deficit,day:true},
  {type:'shame',icon:'<img class="clown" src="clown.svg" alt="🤡">',title:'SIEGLOSER CLOWN',desc:'Längste Serie ohne Spieltagssieg',unit:' Spieltage',winners:select(summaries,s=>s.maxNoWin),value:s=>s.maxNoWin},
  {type:'shame',icon:'🚨',title:'ROTE LATERNE',desc:'Am häufigsten Letzter der Gesamtwertung',unit:'-mal',winners:select(summaries,s=>s.lanterns),value:s=>s.lanterns},
  {type:'shame',icon:'🥈',title:'EWIGER ZWEITER',desc:'Am häufigsten Zweiter im Spieltag',unit:'-mal',winners:select(summaries,s=>s.seconds),value:s=>s.seconds},
  {type:'shame',icon:'🕳️',title:'ABSTIEGSZONE',desc:'Am häufigsten unter den letzten drei im Spieltag',unit:'-mal',winners:select(summaries.filter(s=>s.bottoms>0),s=>s.bottoms),value:s=>s.bottoms},
  {type:'shame',icon:'📉',title:'FREIER FALL',desc:'Größter Absturz in der Gesamtwertung an einem Spieltag',unit:' Plätze',winners:select(moves.filter(m=>m.move<0),m=>m.move,'min'),value:m=>-m.move,day:true},
  {type:'shame',icon:'🎢',title:'ACHTERBAHN',desc:'Wechselhafteste Spieltagspunkte (typische Abweichung vom eigenen Schnitt, ab 3 Spieltagen)',unit:' Pkt.',winners:select(summaries,s=>s.spread),value:s=>Math.round(s.spread)},
  {type:'shame',icon:'🐌',title:'PUNKTE-FLAUTE',desc:'Niedrigster Punktedurchschnitt',unit:' Ø',winners:select(summaries,s=>s.average,'min'),value:s=>s.average},
  {type:'shame',icon:'⬇️',title:'UNTER DEM STRICH',desc:'Am häufigsten unter dem Ligaschnitt des Spieltags',unit:'-mal',winners:select(summaries.filter(s=>s.belows>0),s=>s.belows),value:s=>s.belows},
  {type:'shame',icon:'🌧️',title:'DAUERREGEN',desc:'Längste Serie unter dem Ligaschnitt',unit:' Spieltage',winners:select(summaries.filter(s=>s.maxBelow>0),s=>s.maxBelow),value:s=>s.maxBelow},
  {type:'shame',icon:'🤏',title:'SO NAH DRAN',desc:'Knappste Niederlage: kleinster Rückstand auf den Spieltagssieger ohne Sieg',unit:' Pkt.',winners:select(allDays.filter(e=>!e.win),e=>e.deficit,'min'),value:e=>e.deficit,day:true},
  {type:'shame',icon:'🔭',title:'ABGEHÄNGT',desc:'Größter Rückstand auf den Tabellenführer nach einem Spieltag',unit:' Pkt.',winners:select(allDays.filter(e=>e.gapLeader>0),e=>e.gapLeader),value:e=>e.gapLeader,day:true},
  {type:'shame',icon:'🧱',title:'KELLERABO',desc:'Am häufigsten unter den letzten drei der Gesamtwertung',unit:'-mal',winners:select(summaries.filter(s=>s.tableBottoms>0),s=>s.tableBottoms),value:s=>s.tableBottoms}
 ]};
}
function renderHall(){
 const target=$('#hallContent');if(!target)return;
 const result=calculateHallRecords(historyData);
 if(!result.finishedDays||!result.managerCount){target.innerHTML='<p class="muted">Noch keine abgeschlossenen Spieltage mit auswertbaren Daten.</p>';return;}
 const card=r=>{
  const winnerNames=[...new Set(r.winners.map(w=>w.name))];
  const shown=winnerNames.length>3?winnerNames.slice(0,2):winnerNames;
  const nm=n=>mgrLink(n);
  const names=shown.map(nm).join(' · ')+(winnerNames.length>3?` <details class="hall-more"><summary>+ ${winnerNames.length-2} weitere</summary>${winnerNames.slice(2).map(nm).join(' · ')}</details>`:'');
  const best=r.winners[0];
  const value=best?`${fmt(r.value(best))}${r.unit}`:'–';
  const day=r.day?`<div class="hall-day">${[...new Set(r.winners.map(w=>w.day))].sort((a,b)=>a-b).map(d=>'Spieltag '+d).join(' · ')}</div>`:'';
  return `<article class="hall-card ${r.type}"><div class="hall-title">${r.icon} ${r.title}</div><div class="hall-value">${value}</div><div class="hall-names">${names||'–'}</div><div class="hall-desc">${r.desc}</div>${day}</article>`;
 };
 const section=(type,title)=>`<div class="hall-section"><h4>${title}</h4><div class="hall-grid">${result.records.filter(r=>r.type===type).map(card).join('')}</div></div>`;
 target.innerHTML=`<div class="hall-meta">${result.finishedDays} ABGESCHLOSSENE SPIELTAGE · ${result.managerCount} GEWERTETE MANAGER</div>`+section('shame','💀 HALL OF SHAME')+section('fame','🏆 HALL OF FAME');
}

// Saisonstatistiken ausschließlich aus vollständig abgeschlossenen Spieltagen.
// Fehlende Werte werden nicht als Null-Punkte-Spieltag gezählt.
function managerSeasonStats(name){
 const completed=historyData.filter(h=>h.status==='finished');
 const entries=[];let wins=0,last=0,second=0,lantern=0;
 for(const h of completed){
  const ranked=h.list.filter(x=>x.dayPoints!==null).slice().sort((a,b)=>b.dayPoints-a.dayPoints);
  const own=ranked.find(x=>x.name===name);
  if(!own||!ranked.length)continue;
  const best=ranked[0].dayPoints,low=ranked[ranked.length-1].dayPoints;
  const rank=1+ranked.filter(x=>x.dayPoints>own.dayPoints).length;
  const isWin=own.dayPoints===best;
  if(isWin)wins++;
  if(own.dayPoints===low)last++;
  if(rank===2&&!isWin)second++;
  const cumulative=h.list.filter(x=>x.score!==null);
  if(cumulative.length&&own.score===Math.min(...cumulative.map(x=>x.score)))lantern++;
  entries.push({day:h.day,points:own.dayPoints,rank,win:isWin,deficit:best-own.dayPoints});
 }
 const total=entries.reduce((s,e)=>s+e.points,0);
 const best=entries.length?entries.reduce((a,b)=>b.points>a.points?b:a):null;
 const worst=entries.length?entries.reduce((a,b)=>b.points<a.points?b:a):null;
 const humiliation=entries.length?entries.reduce((a,b)=>b.deficit>a.deficit?b:a):null;
 // Eine Serie endet nur an einem Sieg; bei fehlenden Spieltagen wird sie unterbrochen.
 let longest=0,streak=0,prevDay=null;
 for(const e of entries){
  if(prevDay!==null&&e.day!==prevDay+1)streak=0;
  streak=e.win?0:streak+1;
  longest=Math.max(longest,streak);prevDay=e.day;
 }
 return {games:entries.length,wins,last,second,lantern,avg:entries.length?total/entries.length:null,best,worst,humiliation,longest};
}
// Weitere Kacheln zum Manager aus der geladenen Historie (nur abgeschlossene Spieltage).
function profileFormTiles(name,tile){
 const days=historyData.filter(h=>h.status==='finished').slice().sort((a,b)=>a.day-b.day);
 const mine=days.map(h=>{const sc=h.list.filter(m=>m.dayPoints!==null&&isEligibleManager(m.name));const me=sc.find(m=>m.name===name);if(!me)return null;
  return {day:h.day,points:me.dayPoints,better:sc.filter(m=>m.dayPoints>me.dayPoints).length,avg:sc.reduce((s,m)=>s+m.dayPoints,0)/sc.length,best:Math.max(...sc.map(m=>m.dayPoints)),rank:rankMap(h).get(name)??null};}).filter(Boolean);
 if(!mine.length)return [];
 const own=mine.reduce((s,x)=>s+x.points,0)/mine.length;
 const n=Math.min(3,mine.length),form=mine.slice(-n).reduce((s,x)=>s+x.points,0)/n,fd=Math.round(form-own);
 const ranks=mine.filter(x=>x.rank!=null),bestRank=ranks.length?Math.min(...ranks.map(x=>x.rank)):null,bestRankDay=ranks.find(x=>x.rank===bestRank);
 const avgs=[...new Set(days.flatMap(h=>h.list.map(m=>m.name)))].filter(isEligibleManager).map(nm=>{const p=days.map(h=>h.list.find(m=>m.name===nm)?.dayPoints).filter(x=>x!=null);return p.length?{nm,avg:p.reduce((s,x)=>s+x,0)/p.length}:null;}).filter(Boolean);
 const avgRank=1+avgs.filter(x=>x.avg>own).length;
 return [
  tile('PODESTPLÄTZE',fmt(mine.filter(x=>x.better<3).length),'Unter den besten drei im Spieltag'),
  tile('ÜBER DEM LIGASCHNITT',`${mine.filter(x=>x.points>x.avg).length} von ${mine.length}`,'Spieltagen'),
  tile('AKTUELLE FORM',fmt(Math.round(form)),`Ø der letzten ${n} Spieltage · ${fd>0?'+':''}${fmt(fd)} zum eigenen Schnitt`),
  tile('BESTER TABELLENPLATZ',bestRank?`#${bestRank}`:'–',bestRankDay?`nach Spieltag ${bestRankDay.day} · aktuell #${ranks.at(-1).rank}`:''),
  tile('SCHNITT-RANG',`#${avgRank}`,`von ${avgs.length} Managern nach Ø Punkten`),
  tile('Ø RÜCKSTAND AUF DEN SIEGER',fmt(Math.round(mine.reduce((s,x)=>s+(x.best-x.points),0)/mine.length)),'Punkte pro Spieltag')];
}
// Ligaschnitt wie in der Halbserien-Analyse: Schnitt der Manager-Durchschnitte, nur abgeschlossene Spieltage.
function leagueAvgNote(){
 const days=historyData.filter(h=>h.status==='finished');
 const avgs=[...new Set(days.flatMap(h=>h.list.map(m=>m.name)))].filter(isEligibleManager).map(n=>{const p=days.map(h=>h.list.find(m=>m.name===n)?.dayPoints).filter(x=>x!=null);return p.length?p.reduce((s,x)=>s+x,0)/p.length:null;}).filter(x=>x!=null);
 return avgs.length?`Ligaschnitt ${fmt(Math.round(avgs.reduce((s,x)=>s+x,0)/avgs.length*10)/10)}`:'';
}
// Gegenstück zu „Über dem Ligaschnitt“: Spieltage unter dem Schnitt aller Manager dieses Spieltags.
function profileBelowAvgTile(name,tile){
 const games=historyData.filter(h=>h.status==='finished').map(h=>{const sc=h.list.filter(m=>m.dayPoints!==null&&isEligibleManager(m.name));const me=sc.find(m=>m.name===name);return me?{points:me.dayPoints,avg:sc.reduce((s,m)=>s+m.dayPoints,0)/sc.length}:null;}).filter(Boolean);
 return games.length?[tile('UNTER DEM LIGASCHNITT',`${games.filter(x=>x.points<x.avg).length} von ${games.length}`,'Spieltagen')]:[];
}
// Bumsungen eines Managers in der laufenden Halbserie, aus der BumsTabelle (null = noch nicht geladen).
function bumsOf(name){
 let keys;try{keys=Object.keys(bumsDays||{}).map(Number);}catch{return null;}if(!keys.length)return null;
 const finished=historyData.filter(h=>h.status==='finished').map(h=>h.day),ref=Math.max(0,...finished,...keys);
 const from=ref<=17?1:18,to=ref<=17?17:34;let n=0;
 for(const d of keys)if(d>=from&&d<=to)for(const v of Object.values(bumsDays[d].managers||{}))if(v.name===name)n+=v.count;
 return n;
}
// Direktduell im Managerprofil: Bilanz, Werte nebeneinander, Punkteverlauf.
const DUEL_SEC='⚔️ DIREKTDUELL';
function duelHtml(a,b,bm){
 const days=historyData.filter(h=>h.status==='finished').slice().sort((x,y)=>x.day-y.day);
 const rows=days.map(h=>{const pa=h.list.find(m=>m.name===a)?.dayPoints,pb=h.list.find(m=>m.name===b)?.dayPoints;return pa!=null&&pb!=null?{day:h.day,pa,pb}:null;}).filter(Boolean);
 const open=profOpen.has(DUEL_SEC)?' open':'';
 if(!rows.length)return `<details class="hall-section prof-sec" data-sec="${DUEL_SEC}"${open}><summary><h4>${DUEL_SEC}</h4></summary><p class="muted">Noch keine gemeinsamen abgeschlossenen Spieltage.</p></details>`;
 const wa=rows.filter(r=>r.pa>r.pb).length,wb=rows.filter(r=>r.pb>r.pa).length,dr=rows.length-wa-wb;
 const sa=managerSeasonStats(a),sb=managerSeasonStats(b);
 const form=n=>{const p=days.map(h=>h.list.find(m=>m.name===n)?.dayPoints).filter(x=>x!=null).slice(-3);return p.length?p.reduce((s,x)=>s+x,0)/p.length:null;};
 const ma=currentManagers.find(m=>m.name===a),bA=bumsOf(a),bB=bumsOf(b);
 // [Bezeichnung, Wert A, Wert B, höher besser?, Anzeige]
 const lines=[
  ['Platz',ma?.pos,bm?.pos,false,v=>v==null?'–':'#'+fmt(v)],
  ['Punkte gesamt',ma?.score,bm?.score,true,fmt],
  ['Ø Punkte / Spieltag',sa.avg,sb.avg,true,v=>fmt(v==null?null:Math.round(v))],
  ['Bester Spieltag',sa.best?.points,sb.best?.points,true,fmt],
  ['Schwächster Spieltag',sa.worst?.points,sb.worst?.points,true,fmt],
  ['Spieltagssiege',sa.wins,sb.wins,true,fmt],
  ['Form (Ø letzte 3)',form(a),form(b),true,v=>fmt(v==null?null:Math.round(v))],
  ['Bumsungen',bA,bB,false,v=>v==null?'–':fmt(v)]];
 const cell=(v,o,hi,f)=>`<td class="${v!=null&&o!=null&&v!==o&&(hi?v>o:v<o)?'duel-win':''}">${f(v)}</td>`;
 const table=`<table class="duel-table"><thead><tr><th>${mgrName(a)}</th><th></th><th>${mgrName(b)}</th></tr></thead><tbody>${lines.map(([l,va,vb,hi,f])=>`<tr>${cell(va,vb,hi,f)}<th>${l}</th>${cell(vb,va,hi,f)}</tr>`).join('')}</tbody></table>`;
 // Punkte je Spieltag als kleines Liniendiagramm.
 const W=900,H=260,L=44,R=12,T=14,B=30,vals=rows.flatMap(r=>[r.pa,r.pb]);let lo=Math.min(...vals),hi=Math.max(...vals);if(lo===hi){lo-=50;hi+=50;}
 const pad=(hi-lo)*.1;lo=Math.floor((lo-pad)/50)*50;const step=Math.max(50,Math.ceil((hi+pad-lo)/4/50)*50);hi=lo+4*step;
 const x=i=>rows.length===1?(L+W-R)/2:L+i*(W-L-R)/(rows.length-1),y=v=>T+(hi-v)*(H-T-B)/(hi-lo);
 const ticks=[0,1,2,3,4].map(i=>lo+(hi-lo)*i/4);
 const line=(k,c)=>`${rows.length>1?`<polyline points="${rows.map((r,i)=>`${x(i).toFixed(1)},${y(r[k]).toFixed(1)}`).join(' ')}" fill="none" stroke="${c}" stroke-width="3" stroke-linejoin="round" stroke-linecap="round"/>`:''}${rows.map((r,i)=>`<circle cx="${x(i).toFixed(1)}" cy="${y(r[k]).toFixed(1)}" r="4" fill="${c}" stroke="#12212b" stroke-width="1.5"><title>${escapeHtml(k==='pa'?a:b)} · ST ${r.day}: ${fmt(r[k])} Pkt.</title></circle>`).join('')}`;
 const svg=`<svg class="duel-chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Punkte je Spieltag"><g font-size="11" fill="#9db0bd">${ticks.map(t=>`<line x1="${L}" x2="${W-R}" y1="${y(t)}" y2="${y(t)}" stroke="#2e3f4a"/><text x="${L-6}" y="${y(t)+4}" text-anchor="end">${fmt(Math.round(t))}</text>`).join('')}${rows.map((r,i)=>`<text x="${x(i)}" y="${H-10}" text-anchor="middle">ST ${r.day}</text>`).join('')}</g>${line('pb','#6fd6d6')}${line('pa','#ebc768')}</svg>`;
 const lead=wa>wb?a:wb>wa?b:null;
 return `<details class="hall-section prof-sec" data-sec="${DUEL_SEC}"${open}><summary><h4>${DUEL_SEC}</h4></summary>
 <div class="duel-score"><div class="duel-side"><b>${escapeHtml(a)}</b></div><div class="duel-num"><span class="${wa>wb?'duel-win':''}">${wa}</span> : <span class="${wb>wa?'duel-win':''}">${wb}</span></div><div class="duel-side right"><b>${escapeHtml(b)}</b></div></div>
 <p class="muted tiny" style="text-align:center;margin:4px 0 14px">Spieltage mit mehr Punkten${dr?` · ${dr}× unentschieden`:''} · ${rows.length} gemeinsame Spieltage${lead?` · ${escapeHtml(lead)} führt`:''}</p>
 ${table}<div class="duel-legend"><span><i style="background:#ebc768"></i>${escapeHtml(a)}</span><span><i style="background:#6fd6d6"></i>${escapeHtml(b)}</span></div>${svg}</details>`;
}
const profOpen=new Set();
document.addEventListener('toggle',e=>{const d=e.target;if(d.classList?.contains('prof-sec')){if(d.open)profOpen.add(d.dataset.sec);else profOpen.delete(d.dataset.sec);}},true);
function profileSeasonHtml(name,other){
 const s=managerSeasonStats(name);
 if(!s.games)return '<div class="profilecompare">Saisonstatistiken werden automatisch geladen oder sind noch nicht verfügbar.</div>';
 // Gleiche Optik wie Ruhm & Schande in der Übersicht.
 const tile=(label,value,detail='')=>`<article class="hall-card __type__"><div class="hall-title">${label}</div><div class="hall-value">${value}</div>${detail?`<div class="hall-desc">${detail}</div>`:''}</article>`;
 // Einklappbar (feste Regel: beim Öffnen des Reiters zu); beim Wechsel des Managers bleibt offen, was offen war.
 const section=(title,items,type='fame')=>`<details class="hall-section prof-sec" data-sec="${title}"${profOpen.has(title)?' open':''}><summary><h4>${title}</h4></summary><div class="hall-grid">${items.join('').replaceAll('__type__',type)}</div></details>`;
 return `<div style="grid-column:1/-1;min-width:0;width:100%;margin-top:20px;border-top:1px solid #4b463b;padding-top:12px"><div style="opacity:.75;font-size:12px">SAISONSTATISTIK · ${s.games} AUSGEWERTETE SPIELTAGE · NUR ABGESCHLOSSEN</div>`+
 section('💀 HALL OF SHAME',[
  tile('TOTALAUSFALL',fmt(s.worst?.points),s.worst?`Spieltag ${s.worst.day}`:''),
  tile('KELLERKIND · LETZTE PLÄTZE',fmt(s.last)),
  tile('GRÖSSTE KLATSCHE',s.humiliation?`${fmt(s.humiliation.deficit)} Pkt.`:'–',s.humiliation?`Rückstand auf den Spieltagssieger · Spieltag ${s.humiliation.day}`:''),
  tile('EWIGER ZWEITER',fmt(s.second),'Zweite Plätze'),
  tile('SIEGLOSE SERIE',fmt(s.longest),'Spieltage in Folge'),
  tile('ROTE LATERNE',fmt(s.lantern),'Letzter der Gesamtwertung'),
  ...profileBelowAvgTile(name,tile)],'shame')+
 section('🏆 RUHMESHALLE',[
  tile('SPIELTAGSSIEGE',fmt(s.wins)),tile('Ø PUNKTE / SPIELTAG',fmt(s.avg),leagueAvgNote()),
  tile('BESTER SPIELTAG',fmt(s.best?.points),s.best?`Spieltag ${s.best.day}`:'')])+
 section('📈 FORM & KONSTANZ',profileFormTiles(name,tile))+(other?duelHtml(name,other.name,other):'')+'</div>';
}
function showProfile(){
 const m=currentManagers[Number($('#profileSelect').value)],other=$('#compareSelect').value===''?null:currentManagers[Number($('#compareSelect').value)];
 if(!m){$('#profileDetails').textContent='Keine Managerdaten geladen.';return}
 const diff=other&&m.score!=null&&other.score!=null?m.score-other.score:null;
 $('#profileDetails').innerHTML=`<div class="profiletitle">${mgrName(m.name,'mgr-av-lg')}</div><div class="profiletile"><small>PLATZIERUNG</small><strong>#${fmt(m.pos)}</strong></div><div class="profiletile"><small>PUNKTE</small><strong>${fmt(m.score)}</strong></div><div class="profiletile bums-goto" data-bums-goto="${escapeHtml(m.name)}" role="link" tabindex="0" title="Zur BumsTabelle"><small>BUMSUNGEN ›</small><strong>${bumsOf(m.name)??'–'}</strong><span class="muted tiny" style="display:block;margin-top:6px">diese Halbserie · zur BumsTabelle</span></div>${other?`<div class="profilecompare">Vergleich mit <b>${mgrName(other.name)}</b>: ${diff==null?'Keine Punkte':(diff>0?'+':'')+fmt(diff)+' Punkte'} · Platz #${fmt(other.pos)}</div>`:''}${profileSeasonHtml(m.name,other)}`;
}
$('#profileSelect').addEventListener('change',showProfile);
$('#compareSelect').addEventListener('change',()=>{if($('#compareSelect').value!=='')profOpen.add(DUEL_SEC);showProfile();});
// Verlinkte Manager (mgrLink): Profil wählen, dann über die Adresse #profiles den Reiter öffnen (index.html, hashchange).
document.addEventListener('click',e=>{const a=e.target.closest('[data-goto-profile]');if(!a)return;e.preventDefault();
 const i=currentManagers.findIndex(m=>m.name===a.dataset.gotoProfile);
 if(i>=0){$('#profileSelect').value=String(i);showProfile();}
 if(location.hash==='#profiles')window.scrollTo({top:0,behavior:'instant'});else location.hash='#profiles';
});
$('#ranking').addEventListener('click',e=>{const b=e.target.closest('[data-profile]');if(!b)return;$('#profileSelect').value=b.dataset.profile;showProfile();$('#profiles').scrollIntoView({behavior:'smooth'});});
// Historische Rankingwerte sind kumuliert. Spieltagspunkte = Differenz zum Vortag.
// Nur beendete Bundesliga-Spieltage zählen für offizielle Spieltagssiege.
function renderHistory(){
 const selected=currentManagers[Number($('#profileSelect').value)];
 if(!selected)return;
 const rows=historyData.map(({day,list,status})=>{
  const own=list.find(m=>m.name===selected.name);
  const leader=list.find(m=>m.dayPoints!==null);
  const live=status==='live';
  const leaderText=leader?(live?`Vorläufig: ${escapeHtml(leader.name)}`:escapeHtml(leader.name)):'–';
  return `<tr><td>${day}${live?' <strong title="Noch nicht abgeschlossen" class="live-mark">● LIVE</strong>':''}</td><td class="right">${fmt(own?.dayPoints)}</td><td class="right">${fmt(own?.score)}</td><td>${leaderText}</td><td class="right">${fmt(leader?.dayPoints)}</td></tr>`;
 });
 $('#historyTable').innerHTML='<table><thead><tr><th>SPIELTAG</th><th class="right">SPIELTAGSPUNKTE</th><th class="right">GESAMTPUNKTE</th><th>SPIELTAGSSIEGER / FÜHRENDER</th><th class="right">PUNKTE</th></tr></thead><tbody>'+rows.join('')+'</tbody></table>';
}
$('#profileSelect').addEventListener('change',()=>{if(historyData.length)renderHistory();});
$('#ranking').addEventListener('click',()=>{if(historyData.length)renderHistory();});
async function loadHistory(){
 if(!currentLeague)return;
 const btn=$('#loadHistory'),statusEl=$('#historyStatus');
 btn.disabled=true;
 statusEl.textContent='Prüfe automatisch den Bundesliga-Spieltagstatus …';
 try{
  const matchdays=await api('/api/matchday-status');
  const completed=Number(matchdays.lastFinishedDay);
  if(!Number.isInteger(completed)||completed<0||completed>34)throw Error('Ungültiger Spieltagsstatus');
  const dayStatuses=Array.isArray(matchdays.days)?matchdays.days:[];
  const liveDay=dayStatuses.find(d=>d.status==='live'&&d.day===completed+1);
  const lastDay=liveDay?liveDay.day:completed;
  if(lastDay<1){historyData=[];$('#historySummary').textContent='';$('#historyTable').textContent='';statusEl.textContent='Noch kein Spieltag begonnen.';showProfile();renderHall();renderLeagueAnalysis();renderProgressChart();renderRankHistory();renderCenter();renderPreview();return;}
  const nextHistory=[];
  const wins=new Map();
  let previous=new Map();
  for(let day=1;day<=lastDay;day++){
   let isLive=!!liveDay&&day===liveDay.day;
   statusEl.textContent=`Lade Spieltag ${day} von ${lastDay}${isLive?' (LIVE)':''} …`;
   let data;
   try{data=await api(`/api/ranking/${encodeURIComponent(currentLeague.id)}?dayNumber=${day}`);}
   catch(err){if(isLive)continue;throw err;}
   // Spiele beendet, aber Kickbase rechnet noch (il = true): noch nicht als abgeschlossen werten, sonst zählt ein Zwischenstand.
   if(!isLive&&day===completed&&data?.il===true)isLive=true;
   const list=rankingItems(data).filter(x=>isEligibleManager(managerName(x))).map(x=>{
    const name=String(managerName(x)),score=number(points(x));
    const prior=day===1?0:previous.get(name);
    return {name,score,dayPoints:score===null||prior==null?null:score-prior};
   }).filter(x=>x.score!==null);
   if(!list.length)continue;
   list.sort((a,b)=>(b.dayPoints??-Infinity)-(a.dayPoints??-Infinity));
   nextHistory.push({day,list,status:isLive?'live':'finished'});
   const eligible=list.filter(m=>m.dayPoints!==null);
   if(!isLive&&eligible.length){
    const best=eligible[0].dayPoints;
    eligible.filter(m=>m.dayPoints===best).forEach(m=>wins.set(m.name,(wins.get(m.name)||0)+1));
   }
   previous=new Map(list.map(m=>[m.name,m.score]));
  }
  const winners=[...wins.entries()].sort((a,b)=>b[1]-a[1]);
  const awards=winners.length?winners.slice(0,5).map(([name,n])=>`<span>🏆 ${escapeHtml(name)}: <b>${n}</b> Spieltagssieg${n===1?'':'e'}</span>`).join(''):'Noch keine offiziellen Spieltagssiege.';
  const liveEntry=nextHistory.find(x=>x.status==='live');
  const liveHtml=liveEntry?`<div class="center-live" id="historyLive">${historyLiveInner(liveEntry.day)}</div>`:'';
  historyData=nextHistory;
  $('#historySummary').innerHTML='<div class="history-awards">'+awards+'</div>'+liveHtml;
  statusEl.textContent='';
  renderHistory();
  showProfile();
  renderRankingTable();
  renderHall();
  renderLeagueAnalysis();
  renderProgressChart();renderRankHistory();renderCenter();renderPreview();
  if(document.querySelector('.kbl-view.kbl-current[data-view="accounting"]'))accLiveLoad();
 }catch(err){
  statusEl.textContent=`Abruf fehlgeschlagen: ${String(err.message).replace(/\.+$/,'')}. Keine ungeprüften Spieltagssiege hinzugefügt.`;
  if(historyData.length){renderHistory();renderHall();renderLeagueAnalysis();renderProgressChart();renderRankHistory();renderCenter();renderPreview();}
  else {const hall=$('#hallContent');if(hall)hall.innerHTML='<p class="muted">Rekordbuch konnte nicht geladen werden. Bitte unter „Tabelle“ auf „Aktualisieren“ tippen.</p>';const analysis=$('#analysisContent');if(analysis)analysis.innerHTML='<p class="muted">Analyse konnte nicht geladen werden. Bitte unter „Tabelle“ auf „Aktualisieren“ tippen.</p>';}
 }finally{btn.disabled=false;}
}
$('#loadHistory').addEventListener('click',loadHistory);

// Aktualisiert alle 10 Minuten nur bei aktivem LIVE-Spieltag, geöffnetem Tab und ohne parallele Abfrage.
// Dabei wird der Spieltagsstatus erneut geprüft, sodass ein Abschluss automatisch
// in die offizielle Siegerstatistik übernommen wird.
setInterval(()=>{
 if(!currentLeague || document.hidden || !historyData.some(x=>x.status==='live'))return;
 const btn=$('#loadHistory');
 if(btn && !btn.disabled)btn.click();
},600000);


// Liga-Analyse: nur abgeschlossene Spieltage, keine zusätzlichen API-Abfragen.
function renderLeagueAnalysis(){
 const el=document.querySelector('#analysisContent');if(!el)return;
 const days=historyData.filter(h=>h.status==='finished').sort((a,b)=>a.day-b.day);
 if(!days.length){el.innerHTML='<p class="muted">Noch keine abgeschlossenen Spieltage vorhanden.</p>';return;}
 const names=[...new Set(days.flatMap(h=>h.list.map(m=>m.name)))].filter(isEligibleManager);
 const rows=names.map(name=>{
  const games=days.map(h=>({day:h.day,entry:h.list.find(m=>m.name===name)})).filter(x=>x.entry&&x.entry.dayPoints!==null);
  if(!games.length)return null;
  const values=games.map(x=>x.entry.dayPoints),total=values.reduce((a,b)=>a+b,0);
  const avg=total/values.length,best=Math.max(...values),worst=Math.min(...values);
  const last=games.at(-1),prev=games.at(-2),trend=prev?last.entry.dayPoints-prev.entry.dayPoints:null;
  return {name,games:games.length,avg,best,worst,trend};
 }).filter(Boolean).sort((a,b)=>b.avg-a.avg);
 if(!rows.length){el.textContent='Noch keine auswertbaren Daten.';return;}
 const avgAll=rows.reduce((s,r)=>s+r.avg,0)/rows.length;
 const card=(label,value,sub)=>`<div style="background:#17232c;border:1px solid #34424c;border-radius:10px;padding:16px;min-width:0"><small style="color:#9eafbc">${label}</small><div style="font-size:clamp(16px,4.6vw,24px);font-weight:800;color:#e9c878;margin:8px 0;overflow-wrap:anywhere">${value}</div><small style="color:#a6b7c4">${sub}</small></div>`;
 const esc=x=>escapeHtml(String(x)).replace(/_/g,'_<wbr>');
 const nm=x=>mgrLink(x);
 const short=list=>list.length>2?`${list.slice(0,2).map(nm).join(', ')} <details class="hall-more"><summary>+ ${list.length-2} weitere</summary>${list.slice(2).map(nm).join(', ')}</details>`:list.map(nm).join(', ');
 const pick=(list,val,dir=1)=>{const v=dir>0?Math.max(...list.map(val)):Math.min(...list.map(val));return {v,who:list.filter(x=>val(x)===v)};};
 // Je Spieltag: Ligaschnitt und Abstand Sieger zu Zweitem.
 const dayStats=days.map(h=>{const sc=h.list.filter(m=>m.dayPoints!==null&&isEligibleManager(m.name)).sort((a,b)=>b.dayPoints-a.dayPoints);
  if(sc.length<2)return null;const solo=sc[0].dayPoints>sc[1].dayPoints;
  return {day:h.day,avg:sc.reduce((s,m)=>s+m.dayPoints,0)/sc.length,winner:sc[0].name,second:sc[1].name,margin:sc[0].dayPoints-sc[1].dayPoints,solo};}).filter(Boolean);
 const stDays=list=>{const ds=list.map(x=>x.day);return ds.length>2?`${ds.length} Spieltage`:'ST '+ds.join(', ');};
 const bestDay=dayStats.length?pick(dayStats,x=>Math.round(x.avg)):null,worstDay=dayStats.length?pick(dayStats,x=>Math.round(x.avg),-1):null;
 const solos=dayStats.filter(x=>x.solo);
 const bigWin=solos.length?pick(solos,x=>x.margin):null,tight=solos.length?pick(solos,x=>x.margin,-1):null;
 // Form: Schnitt der letzten drei Spieltage (nur wer alle drei gespielt hat).
 const n=Math.min(3,days.length),recent=days.slice(-n);
 const form=rows.map(r=>{const pts=recent.map(h=>h.list.find(m=>m.name===r.name)?.dayPoints).filter(x=>x!=null);return pts.length===n?{name:r.name,avg:Math.round(pts.reduce((s,x)=>s+x,0)/n)}:null;}).filter(Boolean);
 const hot=form.length?pick(form,x=>x.avg):null,cold=form.length?pick(form,x=>x.avg,-1):null;
 el.innerHTML=`<div class="rank-cards analysis-cards">${
  card('LIGA-DURCHSCHNITT',fmt(avgAll)+' Pkt.','Ø Manager / Spieltag')}${
  hot?card('IN FORM',short(hot.who.map(x=>x.name)),`${fmt(hot.v)} Ø in den letzten ${n} Spieltagen`):''}${
  cold?card('FORMTIEF',short(cold.who.map(x=>x.name)),`${fmt(cold.v)} Ø in den letzten ${n} Spieltagen`):''}${
  bestDay&&worstDay?card('STÄRKSTER SPIELTAG',stDays(bestDay.who),`${fmt(bestDay.v)} Ø Punkte der Liga · schwächster: ${stDays(worstDay.who)} (${fmt(worstDay.v)} Ø)`):''}${
  (()=>{const rm=window.kblRankMoves;if(!rm)return '';return card('GRÖSSTE AUFHOLJAGD',rm.climbers.length?rm.climbers.map(r=>nm(r.name)).join(', '):'–',rm.climbers.length?rm.moves(rm.climbers,r=>`von Platz ${r.lowest} auf Platz ${r.now} (+${r.climb})`):'Noch niemand hat sich nach vorne gekämpft')+
   card('TIEFSTER FALL',rm.fallers.length?rm.fallers.map(r=>nm(r.name)).join(', '):'–',rm.fallers.length?rm.moves(rm.fallers,r=>`von Platz ${r.highest} auf Platz ${r.now} (−${r.fall})`):'Noch niemand ist abgerutscht');})()}${
  bigWin?card('DEUTLICHSTER SIEG',short([...new Set(bigWin.who.map(x=>x.winner))]),`+${fmt(bigWin.v)} vor ${bigWin.who.length===1?mgrLink(bigWin.who[0].second,esc(bigWin.who[0].second))+' · ST '+bigWin.who[0].day:'dem Zweiten · '+stDays(bigWin.who)}`):''}${
  tight?card('KNAPPSTER SIEG',short([...new Set(tight.who.map(x=>x.winner))]),`+${fmt(tight.v)} vor ${tight.who.length===1?mgrLink(tight.who[0].second,esc(tight.who[0].second))+' · ST '+tight.who[0].day:'dem Zweiten · '+stDays(tight.who)}`):''}</div>`;
 const pill=document.querySelector('#stats .sectionhead .pill');if(pill)pill.textContent=`${days.length} abgeschlossene Spieltage · ${rows.length} Manager`;
}


// KBL 4.14: Übersichtlicheres Diagramm. Alle Manager als graue Linien, hervorgehobene Manager farbig
// mit Namen am Linienende. Standardansicht „Abstand zu Platz 1“, damit die Linien nicht alle parallel steigen.
// Nur beendete Spieltage, T1000 bleibt ausgeschlossen. Keine zusätzlichen Requests.
const progressSelected=new Set();
const progressColors=['#f1c75c','#59b8e8','#ed8b85','#7fd3a6','#bb9af7','#e8a665','#75d5d1','#ed94c6','#a6c76a','#d0b8ff','#ffb4a0','#86b2ff','#c1db77','#d1a77b','#e0d9a0','#9ebdc8'];
const OWN_MANAGER='T800';
// Gestapelte Balken: ein Balken je Eintrag, ein Abschnitt je Spieltag, höchster Balken zuerst.
// Die Oberkante ist immer die Summe: Minus-Spieltage schieben den Balken unter die Null, dieser Teil ist schraffiert.
const stackDayColors=['#3f8fd2','#e0a43a','#4fb286','#c9607a','#8d7bd6','#5fb7c9','#d27f45','#9cb84a'];
function kblStackChart(root,bars,o){
 const esc=escapeHtml,hid='kblHatch-'+(root.id||'x'),col=i=>stackDayColors[i%stackDayColors.length],val=o.fmt||fmt;
 bars=bars.slice().sort((a,b)=>b.total-a.total);
 const days=bars[0]?.segs.map(s=>s.day)||[];
 const geo=bars.map(b=>{const negSum=b.segs.reduce((t,s)=>t+Math.min(0,s.v||0),0);let p=negSum,q=negSum;const parts=[];
  b.segs.forEach((s,i)=>{if(s.v>0){parts.push({s,i,a:p,b:p+s.v});p+=s.v;}});
  b.segs.forEach((s,i)=>{if(s.v<0){parts.push({s,i,a:q,b:q-s.v,neg:true});q-=s.v;}});
  return {b,negSum,pos:Math.max(p,q),parts};});
 let lo=Math.min(0,...geo.map(g=>g.negSum)),hi=Math.max(1,...geo.map(g=>g.pos));
 const rough=Math.max(o.minStep||1,(hi-lo)/5),mag=10**Math.floor(Math.log10(rough));
 const tickStep=[1,2,2.5,5,10].map(f=>f*mag).find(v=>v>=rough);
 lo=lo<0?lo-tickStep*.12:0;hi=Math.ceil(hi/tickStep)*tickStep;const t0=Math.ceil(lo/tickStep-1e-9)*tickStep;
 const anyNeg=geo.some(g=>g.parts.some(x=>x.neg));
 const tip=(b,s)=>`${b.full||b.name} · Spieltag ${s.day}: ${val(s.v)}${s.v<0?' (abgezogen)':''} · gesamt ${val(b.total)}`;
 const defs=`<defs><pattern id="${hid}" width="7" height="7" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><line x1="0" y1="0" x2="0" y2="7" stroke="#e8737f" stroke-width="3"/></pattern></defs>`;
 const rect=(x,y,w,h,part,b)=>part.neg?`<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${w.toFixed(1)}" height="${h.toFixed(1)}" fill="#12212b" fill-opacity=".45" stroke="#e8737f" stroke-dasharray="3 2"/><rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${w.toFixed(1)}" height="${h.toFixed(1)}" fill="url(#${hid})" fill-opacity=".8"><title>${esc(tip(b,part.s))}</title></rect>`:`<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${w.toFixed(1)}" height="${h.toFixed(1)}" fill="${col(part.i)}"><title>${esc(tip(b,part.s))}</title></rect>`;
 const label=(x,y,part,size)=>`<text x="${x.toFixed(1)}" y="${y.toFixed(1)}" fill="${part.neg?'#ffd5d9':'#0b161d'}" font-size="${size}" font-weight="700" text-anchor="middle" pointer-events="none"${part.neg?' paint-order="stroke" stroke="#12212b" stroke-width="3"':''}>${val(part.s.v)}</text>`;
 const narrow=(root.clientWidth||1000)<640;
 let svg;
 if(narrow){
  const left=104,right=56,top=34,row=40,bh=30,W=420,H=top+bars.length*row+10,pw=W-left-right;
  const x=v=>left+(v-lo)/(hi-lo)*pw;
  svg=`<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(o.aria)}" xmlns="http://www.w3.org/2000/svg">${defs}<rect width="${W}" height="${H}" fill="#12212b" rx="10"/>`;
  for(let v=t0;v<=hi+tickStep/1000;v+=tickStep){if(v!==hi&&Math.abs(v)>1e-9&&Math.round(v/tickStep)%2)continue;svg+=`<line x1="${x(v)}" y1="${top-6}" x2="${x(v)}" y2="${H-8}" stroke="${Math.abs(v)<1e-9?'#6b5a2e':'#2c3c47'}"/><text x="${x(v)}" y="${top-12}" fill="#9fb3c0" font-size="12" text-anchor="middle">${fmt((Math.round(v*10)/10)||0)}</text>`;}
  geo.forEach((g,k)=>{const b=g.b,yy=top+k*row+(row-bh)/2,shown=b.name.length>10?b.name.slice(0,9)+'…':b.name;
   svg+=`<g data-stack-i="${k}" style="cursor:pointer"><rect x="0" y="${top+k*row}" width="${W}" height="${row}" fill="transparent"/><text x="${left-8}" y="${yy+bh/2+5}" fill="#e6edf1" font-size="15" text-anchor="end">${k+1}. ${esc(shown)}</text>`;
   for(const part of g.parts){const x0=x(part.a),w=x(part.b)-x0;svg+=rect(x0,yy,Math.max(.5,w-(part.neg?0:1)),bh,part,b);const va=part.neg?part.a:Math.max(part.a,0),vw=x(part.b)-x(va);if(vw>=28)svg+=label(x(va)+vw/2,yy+bh/2+4,part,12.5);}
   svg+=`<text x="${x(g.pos)+6}" y="${yy+bh/2+5}" fill="#f1c75c" font-size="14" font-weight="700">${val(b.total)}</text></g>`;});
  svg+='</svg>';
 }else{
  const W=1000,left=64,right=16,top=34,bottom=78,H=470,pw=W-left-right,ph=H-top-bottom,slot=pw/bars.length,bw=Math.min(54,slot*.72);
  const y=v=>top+(hi-v)/(hi-lo)*ph;
  svg=`<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(o.aria)}" xmlns="http://www.w3.org/2000/svg">${defs}<rect width="${W}" height="${H}" fill="#12212b" rx="10"/>`;
  for(let v=t0;v<=hi+tickStep/1000;v+=tickStep)svg+=`<line x1="${left}" y1="${y(v)}" x2="${W-right}" y2="${y(v)}" stroke="${Math.abs(v)<1e-9?'#6b5a2e':'#2c3c47'}"/><text x="${left-10}" y="${y(v)+4}" fill="#9fb3c0" font-size="12" text-anchor="end">${fmt((Math.round(v*10)/10)||0)}</text>`;
  geo.forEach((g,k)=>{const b=g.b,cx=left+slot*(k+.5),x0=cx-bw/2,shown=b.name.length>13?b.name.slice(0,12)+'…':b.name;
   svg+=`<g data-stack-i="${k}" style="cursor:pointer"><rect x="${(left+slot*k).toFixed(1)}" y="${top}" width="${slot.toFixed(1)}" height="${H-top}" fill="transparent"/>`;
   for(const part of g.parts){const y0=y(part.b),h=y(part.a)-y0;svg+=rect(x0,y0,bw,Math.max(.5,h-(part.neg?0:1)),part,b);const va=part.neg?part.a:Math.max(part.a,0),vh=y(va)-y0;if(vh>=15)svg+=label(cx,y0+vh/2+4,part,11);}
   svg+=`<text x="${cx}" y="${y(g.pos)-7}" fill="#f1c75c" font-size="12" font-weight="700" text-anchor="middle">${val(b.total)}</text><text transform="translate(${cx+4},${y(lo)+14}) rotate(-35)" fill="#e6edf1" font-size="12" text-anchor="end">${esc(shown)}</text></g>`;});
  svg+='</svg>';
 }
 const legend=days.map((d,i)=>`<span style="white-space:nowrap;margin-right:12px"><span style="display:inline-block;width:12px;height:12px;border-radius:3px;background:${col(i)};vertical-align:-1px;margin-right:4px"></span>ST ${d}</span>`).join('')+(anyNeg?`<span style="white-space:nowrap"><span style="display:inline-block;width:12px;height:12px;border-radius:3px;border:1px dashed #e8737f;background:repeating-linear-gradient(45deg,#e8737f 0 2px,transparent 2px 5px);vertical-align:-1px;margin-right:4px"></span>Minuspunkte (unter der Null)</span>`:'');
 const hint='Auf einen Balken tippen, um alle Spieltage zu sehen. Nochmal tippen oder daneben tippen hebt die Auswahl auf.';
 root.dataset.stack=JSON.stringify(geo.map(g=>[g.b.full||g.b.name,val(g.b.total),g.b.segs.map(s=>[s.day,s.v==null?'–':val(s.v)])]));
 root.dataset.stackSel='';
 root.innerHTML=svg+`<p class="tiny" style="margin-top:10px;line-height:1.9">${legend}</p><p class="muted kbl-stack-info" style="min-height:1.4em" role="status" data-hint="${esc(hint)}">${hint}</p><p class="muted tiny">${o.note}</p>`;
}
// Antippen eines Balkens zeigt die Spieltage; nochmal tippen, daneben tippen oder „zurück“ hebt die Auswahl auf.
document.addEventListener('click',e=>{const box=e.target.closest('[data-stack]');const info=box?.querySelector('.kbl-stack-info');if(!info)return;const items=box.querySelectorAll('[data-stack-i]'),g=e.target.closest('[data-stack-i]');
 if(!g||box.dataset.stackSel===g.dataset.stackI){items.forEach(el=>el.style.opacity='');box.dataset.stackSel='';info.textContent=info.dataset.hint;return;}
 let rows=[];try{rows=JSON.parse(box.dataset.stack||'[]');}catch{}const r=rows[+g.dataset.stackI];if(!r)return;
 box.dataset.stackSel=g.dataset.stackI;items.forEach(el=>el.style.opacity=el===g?'1':'.4');
 info.innerHTML=`<b>${escapeHtml(r[0])}</b>: ${escapeHtml(r[1])} · ${r[2].map(([d,v])=>`ST ${d}: ${escapeHtml(v)}`).join(' · ')} <button type="button" class="ghost" style="margin-left:6px;padding:2px 10px">× zurück</button>`;});
function renderProgressStack(root,days,names){
 const bars=names.map(name=>{const segs=days.map(h=>{const v=h.list.find(x=>x.name===name)?.dayPoints;return {day:h.day,v:Number.isFinite(v)?v:null};});return {name,segs,total:segs.reduce((t,s)=>t+(s.v||0),0)};});
 kblStackChart(root,bars,{aria:'Punkte je Manager, aufgeteilt nach Spieltagen',note:'Ein Balken je Manager, sortiert nach Gesamtpunkten. Jeder Abschnitt ist ein abgeschlossener Spieltag. Die Oberkante des Balkens ist immer die Gesamtpunktzahl. Minuspunkte ziehen den Balken unter die Null; dieser Teil ist schraffiert. LIVE-Spieltage zählen nicht.'});
}
function renderProgressChart(){
 const root=$('#progressChart'),choices=$('#progressManagers');if(!root||!choices)return;
 const days=historyData.filter(h=>h.status==='finished').slice().sort((a,b)=>a.day-b.day);
 if(!days.length){root.innerHTML='<p class="muted">Noch keine abgeschlossenen Spieltage vorhanden.</p>';choices.innerHTML='';return;}
 const names=[...new Set(days.flatMap(h=>h.list.map(m=>m.name)))].filter(isEligibleManager);
 const latest=days.at(-1);
 names.sort((a,b)=>(latest.list.find(m=>m.name===b)?.score??-Infinity)-(latest.list.find(m=>m.name===a)?.score??-Infinity));
 // Start: die ersten drei und der eigene Manager.
 if(!progressSelected.size&&!choices.dataset.initialized){names.slice(0,3).forEach(n=>progressSelected.add(n));if(names.includes(OWN_MANAGER))progressSelected.add(OWN_MANAGER);choices.dataset.initialized='yes';}
 for(const n of [...progressSelected])if(!names.includes(n))progressSelected.delete(n);
 const selected=names.filter(n=>progressSelected.has(n));
 // Farben in der Reihenfolge des Hervorhebens, damit ein Manager seine Farbe behält.
 const colorOf=new Map([...progressSelected].map((n,i)=>[n,progressColors[i%progressColors.length]]));
 choices.innerHTML=names.map(name=>{const c=colorOf.get(name);return `<label style="border-color:${c||'#394c57'}"><input type="checkbox" data-progress-name="${escapeHtml(name)}" ${c?'checked':''}><span style="color:${c||'#5d6f7b'}">●</span>${escapeHtml(name)}</label>`;}).join('');
 const mode=$('#progressMode')?.value||'gap',isRank=mode==='rank';
 const vSel=$('#progressView'),canStack=mode==='cumulative'||mode==='daily';if(vSel){vSel.querySelector('[value="stacked"]').disabled=!canStack;vSel.value=canStack&&window.kblProgressStack?'stacked':'lines';}const stacked=canStack&&!!window.kblProgressStack;[choices,$('#progressPanel .kbl-chart-buttons'),$('#progressPanel .sectionhead+p.muted')].forEach(el=>{if(el)el.style.display=stacked?'none':'';});
 if(stacked){renderProgressStack(root,days,names);return;}
 const ranks=isRank?days.map(rankMap):null;
 const leaderScore=days.map(h=>Math.max(...h.list.filter(m=>isEligibleManager(m.name)&&m.score!==null).map(m=>m.score)));
 const valueOf=(name,h,i)=>{if(isRank)return ranks[i].get(name)??null;const m=h.list.find(x=>x.name===name);if(!m)return null;return mode==='daily'?m.dayPoints:mode==='gap'?m.score-leaderScore[i]:m.score;};
 const lines=names.map(name=>({name,color:colorOf.get(name)||null,values:days.map((h,i)=>valueOf(name,h,i))}));
 const all=lines.flatMap(l=>l.values).filter(v=>v!==null&&Number.isFinite(v));
 if(!all.length){root.innerHTML='<p class="muted">Keine auswertbaren Punkte vorhanden.</p>';return;}
 const narrow=(root.clientWidth||1000)<640;
 const W=narrow?480:1000,H=narrow?400:400,left=narrow?64:78,right=narrow?100:150,top=24,bottom=48,pw=W-left-right,ph=H-top-bottom,fs=narrow?16:12;
 let lo=Math.min(...all),hi=Math.max(...all);
 if(mode==='gap')hi=0;
 const rough=Math.max(1,(hi-lo)/5),mag=10**Math.floor(Math.log10(rough));
 const tickStep=[1,2,2.5,5,10].map(f=>f*mag).find(v=>v>=rough);
 lo=Math.floor(lo/tickStep)*tickStep;hi=Math.ceil(hi/tickStep)*tickStep;if(hi===lo)hi=lo+tickStep;
 const rankCount=isRank?Math.max(...ranks.flatMap(r=>[...r.values()])):0;
 if(isRank){lo=.5;hi=rankCount+.5;}
 const x=i=>left+(days.length===1?pw/2:i*pw/(days.length-1));
 const y=v=>isRank?top+(v-lo)/(hi-lo)*ph:top+(hi-v)/(hi-lo)*ph;
 const esc=escapeHtml;
 const unit=v=>isRank?`Platz ${v}`:mode==='gap'?(v===0?'Tabellenführer':`${fmt(-v)} Punkte hinter Platz 1`):`${fmt(v)} Punkte`;
 let svg=`<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Verlauf der Manager" xmlns="http://www.w3.org/2000/svg"><rect x="0" y="0" width="${W}" height="${H}" fill="#12212b" rx="10"/>`;
 if(isRank){const every=rankCount>12?2:1;for(let r=1;r<=rankCount;r++){if((r-1)%every&&r!==rankCount)continue;svg+=`<line x1="${left}" y1="${y(r)}" x2="${W-right}" y2="${y(r)}" stroke="#2c3c47" stroke-width="1"/><text x="${left-10}" y="${y(r)+4}" fill="${r===1?'#f1c75c':'#9fb3c0'}" text-anchor="end" font-size="${fs}">${r}.</text>`;}}
 else for(let value=lo;value<=hi+tickStep/1000;value+=tickStep){const yy=y(value);svg+=`<line x1="${left}" y1="${yy}" x2="${W-right}" y2="${yy}" stroke="${mode==='gap'&&Math.abs(value)<1e-9?'#6b5a2e':'#2c3c47'}" stroke-width="1"/><text x="${left-10}" y="${yy+4}" fill="#9fb3c0" text-anchor="end" font-size="${fs}">${mode==='gap'&&value<0?'−'+fmt(Math.round(-value)):fmt(Math.round(value))}</text>`;}
 const step=Math.max(1,Math.ceil(days.length/(narrow?7:12)));days.forEach((h,i)=>{if(i%step===0||i===days.length-1)svg+=`<text x="${x(i)}" y="${H-18}" fill="#9fb3c0" text-anchor="middle" font-size="${fs}">ST ${h.day}</text>`;});
 const pts=l=>{const segs=[];let seg=[];l.values.forEach((v,i)=>{if(v===null||!Number.isFinite(v)){if(seg.length)segs.push(seg);seg=[];}else seg.push(`${x(i).toFixed(1)},${y(v).toFixed(1)}`);});if(seg.length)segs.push(seg);return segs;};
 // Graue Linien zuerst, darüber die hervorgehobenen. Klick auf eine Linie hebt hervor bzw. nimmt zurück.
 for(const l of [...lines.filter(l=>!l.color),...lines.filter(l=>l.color)]){
  const hl=!!l.color,last=[...l.values].reverse().find(v=>v!==null&&Number.isFinite(v));
  svg+=`<g class="kbl-line" data-progress-name="${esc(l.name)}" style="cursor:pointer"><title>${esc(l.name)}${last!=null?` · Spieltag ${days.at(-1).day}: ${unit(last)}`:''} (klicken zum ${hl?'Zurücknehmen':'Hervorheben'})</title>`;
  for(const p of pts(l))if(p.length>1){svg+=`<polyline points="${p.join(' ')}" fill="none" stroke="transparent" stroke-width="14" pointer-events="stroke"/><polyline points="${p.join(' ')}" fill="none" stroke="${hl?l.color:'#5d6f7b'}" stroke-opacity="${hl?1:.45}" stroke-width="${hl?3.5:1.5}" stroke-linecap="round" stroke-linejoin="round"/>`;}
  if(hl)l.values.forEach((v,i)=>{if(v===null||!Number.isFinite(v))return;svg+=`<circle cx="${x(i)}" cy="${y(v)}" r="4" fill="${l.color}" stroke="#12212b" stroke-width="1.5"><title>${esc(l.name)} · Spieltag ${days[i].day}: ${unit(v)}</title></circle>`;});
  svg+='</g>';
 }
 // Namen am Linienende, überlappungsfrei untereinander geschoben.
 const labels=lines.filter(l=>l.color).map(l=>{const i=l.values.map((v,k)=>v!==null&&Number.isFinite(v)?k:-1).filter(k=>k>=0).at(-1);return i==null?null:{name:l.name,color:l.color,ty:y(l.values[i]),lx:x(i)};}).filter(Boolean).sort((a,b)=>a.ty-b.ty);
 const gap=fs+3;labels.forEach((l,k)=>{l.y=Math.max(l.ty,k?labels[k-1].y+gap:top);});
 const overflow=labels.length?labels.at(-1).y-(H-bottom):0;if(overflow>0)labels.forEach(l=>l.y-=overflow);
 for(const l of labels){const max=narrow?10:16,shown=l.name.length>max?l.name.slice(0,max-1)+'…':l.name;svg+=`<line x1="${l.lx+6}" y1="${l.ty}" x2="${W-right+8}" y2="${l.y}" stroke="${l.color}" stroke-opacity=".5"/><text x="${W-right+12}" y="${l.y+4}" fill="${l.color}" font-size="${fs}" font-weight="700">${esc(shown)}</text>`;}
 svg+='</svg>';
 const how={gap:'Abstand zum Tabellenführer nach jedem abgeschlossenen Spieltag (0 = Platz 1, je tiefer, desto weiter zurück)',daily:'Punkte je abgeschlossenem Spieltag',rank:'Tabellenplatz nach jedem abgeschlossenen Spieltag (Platz 1 oben, Punktgleichheit = gleicher Platz)',cumulative:'Kumulierter Punktestand nach jedem abgeschlossenen Spieltag'}[mode];
 root.innerHTML=svg+`<p class="muted tiny" style="margin-top:12px">${how}. Graue Linien sind die übrigen Manager: antippen oder oben anhaken, um sie hervorzuheben. LIVE-Spieltage zählen nicht.</p>`;
}
$('#progressManagers')?.addEventListener('change',e=>{const el=e.target.closest('input[data-progress-name]');if(!el)return;if(el.checked)progressSelected.add(el.dataset.progressName);else progressSelected.delete(el.dataset.progressName);renderProgressChart();});
$('#progressChart')?.addEventListener('click',e=>{const g=e.target.closest('[data-progress-name]');if(!g)return;const n=g.dataset.progressName;if(progressSelected.has(n))progressSelected.delete(n);else progressSelected.add(n);renderProgressChart();});
window.addEventListener('resize',()=>{clearTimeout(window.__kblChartResize);window.__kblChartResize=setTimeout(renderProgressChart,200);});
$('#progressMode')?.addEventListener('change',renderProgressChart);
$('#progressView')?.addEventListener('change',e=>{window.kblProgressStack=e.target.value==='stacked';renderProgressChart();});
$('#progressTop')?.addEventListener('click',()=>{const days=historyData.filter(h=>h.status==='finished');const latest=days.at(-1);if(!latest)return;progressSelected.clear();latest.list.filter(x=>isEligibleManager(x.name)).sort((a,b)=>(b.score??-Infinity)-(a.score??-Infinity)).slice(0,5).forEach(x=>progressSelected.add(x.name));renderProgressChart();});
$('#progressAll')?.addEventListener('click',()=>{historyData.filter(h=>h.status==='finished').forEach(h=>h.list.forEach(m=>{if(isEligibleManager(m.name))progressSelected.add(m.name)}));renderProgressChart();});
$('#progressNone')?.addEventListener('click',()=>{progressSelected.clear();renderProgressChart();});

// KBL 4.9: Tabellenplatz je Spieltag (Community-Wunsch). Plätze aus dem kumulierten
// Punktestand nach jedem abgeschlossenen Spieltag, Punktgleichheit = gleicher Platz.
// T1000 bleibt ausgeschlossen. Keine zusätzlichen Requests.
function rankMap(entry){
 const list=entry.list.filter(m=>isEligibleManager(m.name)&&m.score!==null).slice().sort((a,b)=>b.score-a.score);
 const map=new Map();
 list.forEach((m,i)=>map.set(m.name,i>0&&list[i-1].score===m.score?map.get(list[i-1].name):i+1));
 return map;
}
function renderRankHistory(){
 const el=$('#rankHistoryContent');if(!el)return;
 const days=historyData.filter(h=>h.status==='finished').slice().sort((a,b)=>a.day-b.day);
 if(!days.length){el.innerHTML='<p class="muted">Noch keine abgeschlossenen Spieltage vorhanden.</p>';return;}
 const ranks=days.map(rankMap),last=ranks.at(-1);
 const names=[...new Set(ranks.flatMap(r=>[...r.keys()]))].sort((a,b)=>(last.get(a)??Infinity)-(last.get(b)??Infinity)||a.localeCompare(b,'de'));
 const rows=names.map(name=>{
  const seq=ranks.map(r=>r.get(name)??null),known=seq.filter(v=>v!==null);
  const now=last.get(name)??null,prev=ranks.length>1?ranks.at(-2).get(name)??null:null;
  // Aufholjagd: tiefster Platz vor dem aktuellen Stand bis heute; Absturz: bester Platz bis heute.
  const before=seq.slice(0,-1).filter(v=>v!==null);
  const climb=now!==null&&before.length?Math.max(...before)-now:0;
  const fall=now!==null&&before.length?now-Math.min(...before):0;
  return {name,seq,now,best:known.length?Math.min(...known):null,worst:known.length?Math.max(...known):null,trend:now!==null&&prev!==null?prev-now:null,climb,fall,leads:seq.filter(v=>v===1).length,lowest:before.length?Math.max(...before):null,highest:before.length?Math.min(...before):null};
 });
 const top=(key)=>{const max=Math.max(0,...rows.map(r=>r[key]));return max>0?rows.filter(r=>r[key]===max):[];};
 const nameList=list=>list.map(r=>escapeHtml(r.name)).join(', ');
 // Bei Gleichstand eigene Plätze je Manager zeigen, sonst ist die Angabe irreführend.
 const moves=(list,text)=>list.length===1?text(list[0]):list.map(r=>`${mgrLink(r.name,`<b>${escapeHtml(r.name)}:</b>`)} ${text(r)}`).join('<br>');
 const card=(label,value,sub)=>`<div><small>${label}</small><strong>${value}</strong><span>${sub}</span></div>`;
 const climbers=top('climb'),fallers=top('fall'),leaders=top('leads');
 window.kblRankMoves={climbers,fallers,moves,nameList};
 const cards='';
 const head='<tr><th class="rank-name">MANAGER</th>'+days.map(h=>`<th class="right">ST ${h.day}</th>`).join('')+'<th class="right">BESTER</th><th class="right">TIEFSTER</th><th class="right" title="Veränderung zum vorigen Spieltag"><span class="rank-up">▲</span><span class="rank-down">▼</span><span class="muted">=</span></th></tr>';
 const body=rows.map(r=>{
  const cells=r.seq.map((v,i)=>{
   if(v===null)return '<td class="right muted">–</td>';
   const p=i>0?r.seq[i-1]:null,diff=p===null?0:p-v;
   const cls=v===1?'rank-first':diff>0?'rank-up':diff<0?'rank-down':'';
   const tip=`Spieltag ${days[i].day}: Platz ${v}${diff>0?` (+${diff})`:diff<0?` (−${-diff})`:''}`;
   return `<td class="right ${cls}" title="${escapeHtml(r.name)} · ${tip}">${v}</td>`;
  }).join('');
  const trend=r.trend===null?'–':r.trend>0?`<span class="rank-up">▲ ${r.trend}</span>`:r.trend<0?`<span class="rank-down">▼ ${-r.trend}</span>`:'<span class="muted">=</span>';
  return `<tr><td class="rank-name"><b>${r.now??'–'}.</b> ${mgrName(r.name)}</td>${cells}<td class="right">${r.best??'–'}</td><td class="right">${r.worst??'–'}</td><td class="right">${trend}</td></tr>`;
 }).join('');
 el.innerHTML=cards+`<div class="rank-wrap"><table class="rank-table"><thead>${head}</thead><tbody>${body}</tbody></table></div><p class="muted tiny" style="margin-top:12px">Platz nach dem Gesamtpunktestand am Ende jedes abgeschlossenen Spieltags. <span class="rank-up">Grün</span> = Plätze gutgemacht, <span class="rank-down">Rot</span> = Plätze verloren, <span class="rank-first">Gold</span> = Tabellenführer. Bei Punktgleichheit teilen sich Manager den Platz. LIVE-Spieltage zählen nicht. Den Verlauf als Linien gibt es weiter unten im Diagramm unter „Tabellenplatz-Verlauf“.</p>`;
 // Neueste Spieltage zuerst sichtbar (wichtig auf dem Handy).
 const wrap=el.querySelector('.rank-wrap');if(wrap)requestAnimationFrame(()=>{wrap.scrollLeft=wrap.scrollWidth;});
 renderLeagueAnalysis();
}



// KBL 4.8: Aufstellungs-Snapshots mit ausdruecklicher manueller Bestaetigung.
const snapshotState={managers:[],players:[],selected:new Set(),saved:[]};
function snapshotMsg(message,isError=false){const el=$('#snapshotMessage');if(el){el.textContent=message;el.style.color=isError?'#f1a5aa':'';}}
function snapshotDayValue(){return Number($('#snapshotDay')?.value);}
function snapshotManagerValue(){return String($('#snapshotManager')?.value||'');}
function snapshotUpdateButtons(){
 const day=snapshotDayValue(),managerId=snapshotManagerValue();
 const existing=snapshotState.saved.some(s=>s.day===day&&String(s.managerId)===managerId);
 $('#snapshotSave').disabled=existing||snapshotState.selected.size<1||snapshotState.selected.size>11;
 $('#snapshotOwn').disabled=existing||!managerId;
 const all=$('#snapshotSelectAll'),clear=$('#snapshotClearSelection');
 if(all){all.disabled=existing||!snapshotState.players.length;all.textContent='Alle auswählen';}
 if(clear)clear.disabled=existing||!snapshotState.selected.size;
 const n=$('#snapshotCount');if(n)n.textContent=`${snapshotState.selected.size} von maximal 11 ausgewählt${existing?' · bereits gespeichert':''}`;
}
async function snapshotLoadSaved(){
 const day=snapshotDayValue();if(!day)return;
 try{const d=await api(`/api/lineup-snapshots/${day}`);snapshotState.saved=d.snapshots||[];
 const names=new Map(snapshotState.managers.map(m=>[String(m.id),m.name]));
 $('#snapshotSaved').innerHTML=snapshotState.saved.length?`<table><thead><tr><th>MANAGER</th><th>QUELLE</th><th>ERFASST</th><th>SPIELER</th><th>AKTION</th></tr></thead><tbody>${snapshotState.saved.map(s=>`<tr><td>${mgrFace(names.get(String(s.managerId))||'','',s.managerId)}${escapeHtml(names.get(String(s.managerId))||s.managerId)}</td><td>${s.source==='kickbase-own-lineup'?'Eigene Kickbase-Elf':s.source==='kickbase-lo-frozen'?'Automatisch aus Kickbase':'Manuell bestätigt'}</td><td>${escapeHtml(new Date(s.capturedAt).toLocaleString('de-DE'))}</td><td>${s.playerIds?.length||0}</td><td><button type="button" class="ghost" data-snapshot-delete="${escapeHtml(String(s.managerId))}" title="Fehlerhafte Aufstellung löschen">Löschen</button></td></tr>`).join('')}</tbody></table>`:'<p class="muted">Noch keine Snapshots für diesen Spieltag.</p>';
 snapshotUpdateButtons();
 }catch(e){snapshotMsg(e.message,true);}
}
async function snapshotLoadSquad(){
 const managerId=snapshotManagerValue();snapshotState.selected.clear();snapshotState.players=[];
 $('#snapshotPlayers').innerHTML='';if(!managerId){snapshotUpdateButtons();return;}
 snapshotMsg('Lade Kader …');
 try{const d=await api(`/api/manager-squad-v4/${TARGET_LEAGUE_ID}/${managerId}`);
 snapshotState.players=(d.data?.it||[]).map(p=>({id:String(p.pi??p.i??''),name:String(p.pn??p.n??'Unbekannt'),pos:p.pos})).filter(p=>/^\d+$/.test(p.id));
 const selectedExisting=snapshotState.saved.some(s=>s.day===snapshotDayValue()&&String(s.managerId)===managerId);
 $('#snapshotPlayers').innerHTML=`<div style="width:100%;margin:4px 0;display:flex;align-items:center;gap:10px;flex-wrap:wrap"><strong id="snapshotCount">0 von maximal 11 ausgewählt</strong><button type="button" class="ghost" id="snapshotSelectAll">Alle auswählen</button><button type="button" class="ghost" id="snapshotClearSelection">Auswahl aufheben</button></div>`+snapshotState.players.map(p=>`<label style="min-width:180px"><input type="checkbox" data-snapshot-player="${escapeHtml(p.id)}" ${selectedExisting?'disabled':''}><span>${escapeHtml(p.name)}</span></label>`).join('');
 snapshotMsg(selectedExisting?'Für diesen Manager wurde bereits eine Aufstellung gespeichert.':`Kader geladen: ${snapshotState.players.length} Spieler. Bitte die tatsächlich aufgestellten Spieler markieren (maximal elf).`);
 }catch(e){snapshotMsg(e.message,true);}snapshotUpdateButtons();
}
async function snapshotInit(){
 const daySelect=$('#snapshotDay');if(!daySelect)return;
 daySelect.innerHTML=Array.from({length:34},(_,i)=>`<option value="${i+1}">Spieltag ${i+1}</option>`).join('');
 try{const status=await api('/api/matchday-status');const current=(status.days||[]).find(d=>d.status==='live')?.day||Math.min(34,Number(status.lastFinishedDay||0)+1);daySelect.value=String(current);}
 catch{daySelect.value='1';}
 try{const d=await api(`/api/ranking/${TARGET_LEAGUE_ID}`);
 snapshotState.managers=rankingItems(d).filter(m=>isEligibleManager(managerName(m))).map(m=>({id:String(m.i),name:String(managerName(m))})).filter(m=>/^\d+$/.test(m.id));
 $('#snapshotManager').innerHTML='<option value="">Manager auswählen</option>'+snapshotState.managers.map(m=>`<option value="${escapeHtml(m.id)}">${escapeHtml(m.name)}</option>`).join('');
 await snapshotLoadSaved();snapshotMsg('Manager auswählen und Startelf bestätigen.');
 }catch(e){snapshotMsg(e.message,true);}
}
$('#snapshotSaved')?.addEventListener('click',async e=>{
 const button=e.target.closest('button[data-snapshot-delete]');if(!button)return;
 const day=snapshotDayValue(),managerId=button.dataset.snapshotDelete;
 const manager=snapshotState.managers.find(m=>m.id===managerId);
 const name=manager?.name||managerId;
 if(!confirm(`Aufstellung von ${name} für Spieltag ${day} wirklich löschen? Die gespeicherte Elf geht verloren und muss neu bestätigt werden.`))return;
 button.disabled=true;
 try{
  await api(`/api/lineup-snapshots/${day}/${encodeURIComponent(managerId)}`,{method:'DELETE',headers:{'Content-Type':'application/json'},body:JSON.stringify({confirm:'DELETE_SNAPSHOT'})});
  await snapshotLoadSaved();
  if(snapshotManagerValue()===managerId)await snapshotLoadSquad();
  snapshotMsg(`Aufstellung von ${name} für Spieltag ${day} gelöscht. Du kannst sie neu erfassen.`);
 }catch(err){snapshotMsg(err.message,true);button.disabled=false;}
});
$('#snapshotDay')?.addEventListener('change',async()=>{await snapshotLoadSaved();await snapshotLoadSquad();});
$('#snapshotManager')?.addEventListener('change',snapshotLoadSquad);
$('#snapshotReload')?.addEventListener('click',async()=>{await snapshotLoadSaved();await snapshotLoadSquad();});
$('#snapshotPlayers')?.addEventListener('click',e=>{
 const button=e.target.closest('button');if(!button)return;
 const managerId=snapshotManagerValue();
 if(snapshotState.saved.some(s=>s.day===snapshotDayValue()&&String(s.managerId)===managerId))return;
 if(button.id==='snapshotSelectAll'){
  snapshotState.selected=new Set(snapshotState.players.map(p=>p.id));
  snapshotMsg('Alle Kaderspieler ausgewählt. Nicht aufgestellte Spieler abwählen; speicherbar sind 1 bis 11 Spieler.');
 }else if(button.id==='snapshotClearSelection'){
  snapshotState.selected.clear();snapshotMsg('Auswahl aufgehoben.');
 }else return;
 $('#snapshotPlayers').querySelectorAll('input[data-snapshot-player]').forEach(input=>{input.checked=snapshotState.selected.has(input.dataset.snapshotPlayer);});
 snapshotUpdateButtons();
});
$('#snapshotPlayers')?.addEventListener('change',e=>{
 const input=e.target.closest('input[data-snapshot-player]');if(!input)return;
 
 if(input.checked)snapshotState.selected.add(input.dataset.snapshotPlayer);else snapshotState.selected.delete(input.dataset.snapshotPlayer);
 snapshotUpdateButtons();
});
$('#snapshotSave')?.addEventListener('click',async()=>{
 if(snapshotState.selected.size<1||snapshotState.selected.size>11)return;
 if(!confirm(`Sind dies die ${snapshotState.selected.size} tatsächlich aufgestellten Spieler? Die Auswahl wird gespeichert.`))return;
 const button=$('#snapshotSave');button.disabled=true;
 try{await api('/api/lineup-snapshots/confirmed',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({day:snapshotDayValue(),managerId:snapshotManagerValue(),playerIds:[...snapshotState.selected]})});
 snapshotMsg('Aufstellung gespeichert.');await snapshotLoadSaved();await snapshotLoadSquad();
 }catch(e){snapshotMsg(e.message,true);snapshotUpdateButtons();}
});
$('#snapshotOwn')?.addEventListener('click',async()=>{
 const m=snapshotState.managers.find(m=>m.id===snapshotManagerValue());
 if(!m||!confirm(`Bist du in Kickbase wirklich als „${m.name}“ angemeldet? Nur dann fortfahren. Die aktuelle Elf wird für Spieltag ${snapshotDayValue()} gespeichert.`))return;
 const button=$('#snapshotOwn');button.disabled=true;
 try{await api('/api/lineup-snapshots/own',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({day:snapshotDayValue(),managerId:m.id})});
 snapshotMsg('Eigene aktuelle Kickbase-Elf gespeichert.');await snapshotLoadSaved();await snapshotLoadSquad();
 }catch(e){snapshotMsg(e.message,true);snapshotUpdateButtons();}
});
const refreshAutoStatus=async()=>{const el=$('#autoCaptureStatus');if(!el)return;
 try{const a=await api('/api/auto-capture-status');
  const zugang=a.serviceLogin?'Dienst-Login eingerichtet: läuft auch ohne Anmeldung.':'<span style="color:#f1a5aa">Kein Dienst-Login eingerichtet: die Automatik läuft nur, solange jemand angemeldet ist.</span>';
  el.innerHTML=`Automatik: ${zugang}${a.lastRun?` Letzte Prüfung ${new Date(a.lastRun).toLocaleTimeString('de-DE',{hour:'2-digit',minute:'2-digit'})} Uhr · ${escapeHtml(String(a.lastResult||''))}`:' Noch keine Prüfung seit dem Start.'}${a.lastError?` <span style="color:#f1a5aa">Fehler: ${escapeHtml(String(a.lastError))}</span>`:''}`;
 }catch(e){}
};
onConnected.push(refreshAutoStatus);setInterval(()=>{if(currentLeague)refreshAutoStatus();},60000);
$('#autoLoginTest')?.addEventListener('click',async()=>{const b=$('#autoLoginTest'),m=$('#autoLoginTestMsg');b.disabled=true;m.style.color='';m.textContent='Teste …';
 try{const d=await api('/api/auto-capture-test-login',{method:'POST'});m.textContent='✓ '+d.message;m.style.color='#8fd19e';}
 catch(e){m.textContent=e.message;m.style.color='#f1a5aa';}
 finally{b.disabled=false;refreshAutoStatus();}
});
$('#snapshotCaptureAll')?.addEventListener('click',async()=>{
 const day=snapshotDayValue(),msg=$('#snapshotCaptureMessage'),button=$('#snapshotCaptureAll');
 if(!day)return;
 if(!confirm(`Startelfen aller Manager für Spieltag ${day} jetzt aus Kickbase übernehmen? Bereits gespeicherte Aufstellungen bleiben unverändert.`))return;
 button.disabled=true;msg.style.color='';msg.textContent='Lese alle Kader …';
 try{
  const d=await api('/api/lineup-snapshots/capture-frozen',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({day})});
  const parts=[`${d.saved.length} neu gespeichert`,`${d.existing.length} schon vorhanden`];
  if(d.failed.length)parts.push(`${d.failed.length} nicht lesbar: ${d.failed.map(f=>f.name).join(', ')}`);
  msg.textContent=`Spieltag ${d.day}: ${parts.join(' · ')}.`;
  if(d.failed.length)msg.style.color='#f1a5aa';
  await snapshotLoadSaved();await snapshotLoadSquad();
 }catch(e){msg.textContent=e.message;msg.style.color='#f1a5aa';}
 finally{button.disabled=false;}
});
// Die Aufstellungsauswahl wird direkt in loadLeagues initialisiert, auch beim automatischen Login.


// KBL 4.9.5: Vollstaendigkeitskontrolle und nachvollziehbare Regelabrechnung.
(function(){
 const day=$('#accountingDay'),button=$('#accountingRun'),probeButton=$('#accountingProbe'),status=$('#accountingStatus'),result=$('#accountingResults'),coverage=$('#accountingCoverage');
 if(!day||!button)return;
 day.innerHTML=Array.from({length:34},(_,i)=>`<option value="${i+1}">Spieltag ${i+1}</option>`).join('');
 const safe=x=>escapeHtml(String(x??''));
 const npcNames=new Map();
 const playerLabel=p=>safe(p.playerName||`Spieler-ID ${p.playerId}`);
 async function loadCoverage(){
  coverage.textContent='Prüfe gespeicherte Aufstellungen …';
  try{
   const d=await api(`/api/lineup-coverage/${day.value}`);
   const rows=d.entries.map(x=>`<tr><td>${mgrName(x.name)}</td><td>${x.status==='confirmed'?'Bestätigt':x.status==='missing'?'Fehlt':x.status==='invalid'?'Ungültig':'Noch nicht manuell bestätigt'}</td><td>${x.count||'–'}</td></tr>`).join('');
   const ok=d.confirmed===d.expected;
   // Abgeschlossene Spieltage: fehlende Startelfen nimmt die Abrechnung aus dem Kickbase-Verlauf (historisches Ranking), kein Alarm.
   const past=!ok&&historyData.some(h=>h.status==='finished'&&Number(h.day)===Number(day.value));
   coverage.innerHTML=`<p style="margin:0"><span class="acc-badge ${ok?'ok':past?'':'warn'}">${ok?'✓':past?'ℹ':'!'} Aufstellungen: ${d.confirmed} von ${d.expected} bestätigt</span></p>${ok?'':past?'<p class="muted tiny" style="margin:8px 0 0">Spieltag ist vorbei: Fehlende Startelfen nimmt die Abrechnung aus dem Kickbase-Verlauf. Was dabei fehlt, steht unten in der Prüfung.</p>':'<p class="muted tiny" style="margin:8px 0 0">Ohne vollständige Aufstellungen ist keine verlässliche Abrechnung möglich.</p>'}<details><summary>Details je Manager</summary><div class="tablewrap"><table><thead><tr><th>MANAGER</th><th>STATUS</th><th>SPIELER</th></tr></thead><tbody>${rows}</tbody></table></div></details>`;
  }catch(e){coverage.textContent='Aufstellungsstatus nicht abrufbar: '+e.message;}
 }
 async function selectDay(){try{const d=await api('/api/matchday-status');day.value=String(Math.max(1,Math.min(34,Number(d.lastFinishedDay||0))));}catch{day.value='1';}await loadCoverage();}
 onConnected.push(selectDay);day.addEventListener('change',()=>{result.innerHTML='';status.textContent='';loadCoverage();});
 async function runAccounting(probe=false){
  button.disabled=true;if(probeButton)probeButton.disabled=true;status.textContent=probe?'Probelauf: lese alle Aufstellungen und Spielerpunkte aus Kickbase …':'Prüfe Spieltag und berechne Spielerpunkte …';result.innerHTML='';
  Object.assign(centerAccounting,{day:Number(day.value),state:'loading',data:null,error:null,checks:{},probe});renderAccTodo();
  try{
   if(!probe)await loadCoverage();
   const d=await api(`/api/rule-accounting/${day.value}${probe?'?probe=1':''}`);
   const checks=probe||!d.ready?{}:((await api(`/api/todo-checks/${d.day}`).catch(()=>({checks:{}}))).checks||{});
   Object.assign(centerAccounting,{data:d,checks,state:'done'});
   if(!d.ready){status.textContent=d.message||'Abrechnung nicht möglich.';return;}
   lastAcc={d,probe};
   renderAccResult();
  }catch(e){status.textContent=e.message;Object.assign(centerAccounting,{state:'error',error:e.message});}
  finally{button.disabled=false;if(probeButton)probeButton.disabled=false;renderAccTodo();}
 }
 let lastAcc=null;
 function renderAccResult(){
   const {d,probe}=lastAcc;
   status.textContent=`${probe?'PROBELAUF · ':''}Spieltag ${d.day} · ${d.managers} von ${d.expected||d.managers} Managern · ${d.complete?'vollständige':'unvollständige'} vorläufige Auswertung · keine Transfers`;
   const plaus=d.plausibility?.length?`<div class="tablewrap"><table><thead><tr><th>MANAGER</th><th>SPIELER IN ELF</th><th>SUMME SPIELERPUNKTE</th><th>ABZUG LEERE PLÄTZE</th><th>ERWARTET</th><th>RANKING</th><th>ERGEBNIS</th></tr></thead><tbody>${d.plausibility.map(x=>`<tr><td>${safe(x.manager)}</td><td>${safe(x.lineupSize)}</td><td>${x.playerSum==null?'–':fmt(x.playerSum)}</td><td>${x.emptySlotPenalty?'−'+fmt(x.emptySlotPenalty)+' ('+safe(x.emptySlots)+' leer)':'–'}</td><td>${x.expected==null?'–':fmt(x.expected)}</td><td>${x.rankingPoints==null?'–':fmt(x.rankingPoints)}</td><td>${x.status==='match'?'✓ stimmt überein':x.status==='diff'?'✕ Abweichung '+fmt(x.difference)+(x.zeroGuessed&&x.zeroGuessed.length?`<br><span class="muted tiny">Als 0 gewertet, evtl. nachträglich geändert: ${x.zeroGuessed.map(safe).join(', ')}</span>`:''):'nicht prüfbar'}</td></tr>`).join('')}</tbody></table></div><p class="muted tiny">Für jeden nicht aufgestellten Platz zieht Kickbase 100 Punkte ab. Stimmt eine Summe nicht, ist die gespeicherte Aufstellung nicht die tatsächliche Elf, es fehlen Spielerpunkte, oder Kickbase hat Punkte nach Spielende noch korrigiert.</p>`:'';
   const box=(title,badge,cls,body)=>`<details class="accbox"><summary><span class="acc-title">${title}</span>${badge?`<span class="acc-badge ${cls||''}">${badge}</span>`:''}</summary><div class="acc-content">${body}</div></details>`;
   const plausBad=(d.plausibility||[]).filter(x=>x.status==='diff').length;
   const plausOk=(d.plausibility||[]).length>0&&plausBad===0&&(d.plausibility||[]).every(x=>x.status==='match');
   const boxes=[
    // Kontrolle nur als Hinweis, wenn Spielerpunkte und Ranking nicht zusammenpassen.
    plausBad?`<p class="error">Achtung, Punkte passen nicht zum Ranking: ${(d.plausibility||[]).filter(x=>x.status==='diff').map(x=>`${safe(x.manager)} (${x.difference>0?'+':''}${fmt(x.difference)})`).join(' · ')}. Die gespeicherte Aufstellung ist dann evtl. nicht die echte Elf.</p>`:'',
    d.warnings&&d.warnings.length?box('Offene Prüfungen',`${d.warnings.length}`,'',`<ul>${d.warnings.map(w=>`<li>${safe(w)}</li>`).join('')}</ul>`):''
   ].join('');
   result.innerHTML=boxes;
 }
 // Automatisch geladener Spieltag (Übersicht): Kontrolle gleich mit anzeigen, wenn derselbe Spieltag gewählt ist.
 window.kblAccShow=d=>{if(String(day.value)!==String(d.day)||button.disabled)return;lastAcc={d,probe:false};renderAccResult();};
 button.addEventListener('click',()=>runAccounting());
  probeButton?.addEventListener('click',()=>{if(confirm(`Probelauf für Spieltag ${day.value}: Die heutigen Aufstellungen werden als Startelf dieses Spieltags angenommen. Nur zum Testen, es wird nichts gespeichert. Fortfahren?`))runAccounting(true);});
})();

// KBL 4.10.1: manuelle NPC-Tippregel und Joker-Gewinner je Spieltag.
(function(){
 const day=document.querySelector('#accountingDay'),rule=document.querySelector('#npcRule'),list=document.querySelector('#npcManagers'),save=document.querySelector('#npcSave'),msg=document.querySelector('#npcMessage');
 if(!day||!rule||!list||!save)return;
 const esc=x=>escapeHtml(String(x??''));
 let managers=[];
 async function load(){msg.textContent='Lade NPC-Regel …';save.disabled=true;
  try{const d=await api(`/api/npc-jokers/${day.value}`);managers=d.managers;rule.value=d.record.rule||'';const winners=new Set(d.record.winners||[]);
   list.innerHTML=managers.map(m=>`<label style="display:inline-flex;align-items:center;gap:6px;margin:6px 14px 6px 0"><input type="checkbox" data-npc-id="${esc(m.id)}" ${winners.has(m.id)?'checked':''}>${esc(m.name)}</label>`).join('');
   msg.textContent='Joker-Gewinner manuell markieren; mehrere Gewinner sind möglich.';save.disabled=false;
  }catch(e){msg.textContent='NPC-Daten nicht abrufbar: '+e.message;}
 }
 save.addEventListener('click',async()=>{const winners=[...list.querySelectorAll('input[data-npc-id]:checked')].map(e=>e.dataset.npcId);
  if(!confirm(`Tippregel und ${winners.length} Joker-Gewinner für Spieltag ${day.value} speichern?`))return;
  save.disabled=true;try{await api(`/api/npc-jokers/${day.value}`,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({rule:rule.value,winners})});msg.textContent='NPC-Regel und Joker-Gewinner gespeichert.';}catch(e){msg.textContent='Fehler: '+e.message;}finally{save.disabled=false;}
 });
 day.addEventListener('change',load);onConnected.push(load);
})();

// Ereigniscodes entdecken: Karten pro Code, unbekannte zuerst.
(function(){
 const day=document.querySelector('#accountingDay'),scope=document.querySelector('#codeScope'),btn=document.querySelector('#codeScan'),msg=document.querySelector('#codeScanMessage'),root=document.querySelector('#codeScanResults');
 if(!day||!btn||!root)return;
 const safe=x=>escapeHtml(String(x??''));
 const where=(e,all)=>`${all?(e.season==='2025/26'?'Vorsaison ':''):''}ST ${safe(e.day??'?')}`;
 const card=(c,showSeason)=>{
  const known=c.certainty!=='unbekannt';
  const rows=c.players.map(p=>{
   const shown=p.entries.slice(0,4).map(e=>`${where(e,showSeason)}: ${e.points==null?'–':fmt(e.points)} Pkt., ${safe(e.minutes||'–')}`).join(' · ');
   const more=p.entries.length>4?` <details class="hall-more"><summary>+ ${p.entries.length-4} weitere</summary>${p.entries.slice(4).map(e=>`${where(e,showSeason)}: ${e.points==null?'–':fmt(e.points)} Pkt., ${safe(e.minutes||'–')}`).join(' · ')}</details>`:'';
   return `<li style="overflow-wrap:anywhere;margin-bottom:6px"><b>${safe(p.name)}</b>${p.times>1?' ×'+p.times:''} <span class="muted">· ${safe(p.managers.join(', '))}<br>${shown}${more}</span></li>`;
  }).join('');
  const list=known?`<details style="margin-top:10px"><summary>Spieler anzeigen (${c.players.length})</summary><ul style="margin:10px 0 0;padding-left:18px">${rows}</ul></details>`:`<ul style="margin:10px 0 0;padding-left:18px">${rows}</ul><p class="muted tiny" style="margin-top:10px">Was ist bei diesen Spielern passiert? In Kickbase nachsehen und die Bedeutung dieses Codes mitteilen.</p>`;
  return `<article style="background:#17232c;border:1px solid ${known?'#34424c':'#b18b39'};border-radius:10px;padding:16px;min-width:0">${known?'':`<div style="font-size:12px;opacity:.75">CODE ${safe(c.code)}</div>`}<div style="font-size:20px;font-weight:800;color:${known?'#e9c878':'#f2c65d'};margin:6px 0">${known?safe(c.label):'Noch unbekannt'}</div><div class="muted tiny">${c.occurrences}-mal vorgekommen · ${c.players.length} Spieler</div>${list}</article>`;
 };
 btn.addEventListener('click',async()=>{
  btn.disabled=true;root.innerHTML='';msg.style.color='';msg.textContent='Lese Spielerdaten, bei allen Spielern kann das mehrere Minuten dauern …';
  try{
   const d=await api(`/api/event-code-scan/${day.value}?scope=${encodeURIComponent(scope?.value||'day')}&players=${encodeURIComponent(document.querySelector('#codePlayers')?.value||'league')}`);
   const warn=[d.failedSquads?`${d.failedSquads} Kader nicht abrufbar`:'',d.failedPlayers?`${d.failedPlayers} Spieler nicht abrufbar`:'',(d.failedTeams&&d.failedTeams.length)?`Vereine nicht lesbar: ${d.failedTeams.join(', ')}`:''].filter(Boolean).join(' · ');
   const range=d.scope==='day'?`Spieltag ${d.day}`:d.scope==='season'?'Saison 2026/27':'Saison 2026/27 und Vorsaison';
   msg.textContent=`${range}: ${d.playersScanned} Spieler ${d.allPlayers?'der Bundesliga':'aus '+d.managers+' Kadern'} geprüft, ${d.playersWithEvents} mit Ereignissen, ${d.codes.length} verschiedene Codes.${warn?' Achtung: '+warn+'.':''}`;
   if(warn)msg.style.color='#f1a5aa';
   const sorted=[...d.codes].sort((a,b)=>(a.certainty==='unbekannt'?0:1)-(b.certainty==='unbekannt'?0:1)||a.code-b.code);
   root.innerHTML=sorted.length?`<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,320px),1fr));gap:12px;margin-top:14px">${sorted.map(c=>card(c,d.scope==='all')).join('')}</div><p class="muted tiny" style="margin-top:12px">${safe(d.note)}</p>`:'<p class="muted">Keine Ereignisse gefunden.</p>';
  }catch(e){msg.textContent='Fehlgeschlagen: '+e.message;msg.style.color='#f1a5aa';}
  finally{btn.disabled=false;}
 });
 day.addEventListener('change',()=>{msg.textContent='';root.innerHTML='';});
 scope?.addEventListener('change',()=>{msg.textContent='';root.innerHTML='';});
})();

// Einzelereignisse entdecken: aufklappbare Liste pro Ereignisnummer.
(function(){
 const day=document.querySelector('#pointsDay'),btn=document.querySelector('#etiScan'),msg=document.querySelector('#etiScanMessage'),root=document.querySelector('#etiScanResults');
 if(!day||!btn||!root)return;
 // Online sammelt der Export jeden abgeschlossenen Spieltag selbst; dort gibt es keinen Sammeln-Knopf.
 if(window.KBL_STATIC){btn.hidden=true;const h=btn.closest('.controls')?.nextElementSibling;if(h)h.textContent='Jeder Spieltag wird automatisch gesammelt, sobald Kickbase ihn abgeschlossen hat (meist am Abend nach dem letzten Spiel).';}
 // Eigener Reiter „Punkteübersicht“; vorbelegt mit dem letzten beendeten Spieltag.
 day.innerHTML=Array.from({length:34},(_,i)=>`<option value="${i+1}">Spieltag ${i+1}</option>`).join('');
 let etiData=null,etiSort='count',etiFilter='';
 // Auf-/Zugeklappt bleibt beim Neuzeichnen (Suchen, Sortieren, anderer Spieltag) erhalten.
 const ptsOpen={stats:false,all:false};
 let dayTouched=false;day.addEventListener('change',()=>{dayTouched=true;});
 const presetDay=()=>{if(!dayTouched&&!etiData)api('/api/matchday-status').then(d=>{if(!dayTouched&&!etiData&&d?.lastFinishedDay)day.value=String(Math.max(1,Math.min(34,Number(d.lastFinishedDay))));}).catch(()=>{}).finally(()=>{if(!etiData)loadSaved();});};
 presetDay();document.querySelectorAll('[data-kbl-nav="points"]').forEach(a=>a.addEventListener('click',()=>{presetDay();markSaved();}));
 const safe=x=>escapeHtml(String(x??''));
 // Aufklappbare Liste statt Kacheln: eine Zeile je Ereignis, sortier- und filterbar.
 if(!document.querySelector('#etiListStyle')){const st=document.createElement('style');st.id='etiListStyle';st.textContent=`
.eti-tools{display:flex;gap:10px;flex-wrap:wrap;align-items:end;margin:4px 0 8px}.eti-tools label{display:grid;gap:4px;font-size:12px;color:#9eafbc}.eti-tools input{background:#17232c;color:#f2f2f2;border:1px solid #394c57;border-radius:6px;padding:10px;min-width:0;width:220px;max-width:100%}
.eti-list{border:1px solid #34424c;border-radius:10px;overflow:hidden}.eti-list details{border-top:1px solid #26343d}.eti-list details:first-child{border-top:0}
.eti-list summary{display:grid;grid-template-columns:minmax(0,1fr) auto auto;gap:12px;align-items:center;padding:10px 14px;cursor:pointer;list-style:none}.eti-list summary::-webkit-details-marker{display:none}
.eti-list summary:hover{background:#1b2a34}.eti-list details[open] summary{background:#1b2a34}.eti-name{font-weight:700;color:#e9c878;overflow-wrap:anywhere}.eti-name.unk{color:#d7dde2}.eti-name::before{content:'▸ ';color:#9eafbc}.eti-list details[open] .eti-name::before{content:'▾ '}
.eti-count{color:#d7dde2;font-variant-numeric:tabular-nums;text-align:right;white-space:nowrap}.eti-pts{min-width:52px;text-align:right;font-weight:700;font-variant-numeric:tabular-nums;white-space:nowrap}.eti-pts.pos{color:#8fd19e}.eti-pts.neg{color:#f1a5aa}
.eti-body{padding:4px 14px 14px 30px;display:grid;gap:6px;font-size:13px;color:#a6b7c4;overflow-wrap:anywhere}.eti-body b{color:#d7dde2;font-weight:600}.eti-stats summary,.eti-stats .eti-head{grid-template-columns:minmax(0,1fr) minmax(0,1.2fr) auto}.eti-stats .eti-name{overflow-wrap:normal;hyphens:auto}.eti-head{display:grid;grid-template-columns:minmax(0,1fr) auto auto;gap:12px;padding:8px 14px;font-size:11px;color:#9eafbc;letter-spacing:.04em;background:#12212b}`;document.head.appendChild(st);}
 const sign=n=>n==null?'–':(n>0?'+':'')+n;
 const mainPts=t=>t.points.length?t.points[0].points:null;
 // Spieltags-Statistik: feste Kategorien, zugeordnet ueber den Kickbase-Titel (mehrere Nummern mit gleichem Titel werden addiert).
 const STAT_CATS=[
  ['Meiste Tore',['Goal (Goalkeeper)','Goal (Defender)','Goal (Midfielder)','Goal (Striker)','Penalty scored']],['Meiste Vorlagen',['Assist (Goalkeeper)','Assist (Defender)','Assist (Midfielder)','Assist (Striker)']],
  ['Meiste Weiße Westen',['Clean Sheet (GK)','Clean Sheet (Defender)','Clean Sheet (Midfielder)','Clean Sheet (Striker)']],['Meiste Gelbe Karten',['Yellow Card']],
  ['Meiste Fouls',['Foul']],['Am häufigsten gefoult',['Fouled last third',"Fouled in the opponent's half"]],
  ['Meiste Pässe ins letzte Drittel',['Pass final Third']],['Meiste Pässe nach vorn',['Forward zone pass']],['Meiste Flanken',['Cross']],
  ['Meiste Großchancen vorbereitet',['Big Chance Created']],['Meiste Schüsse aufs Tor',['Shot on goal']],
  ['Meiste Tacklings gewonnen',['Tackle won']],['Meiste Dribblings gewonnen',['Contest won']],['Meiste Kopfballduelle gewonnen',['Aerial won']],
  ['Meiste Bälle abgefangen',['Interception (outside the box)','Interception (in the box)','Ball intercepted']],
  ['Meiste Zweikämpfe verloren',['Challenge lost']],['Meiste Ballverluste',['Possession lost']],['Am häufigsten im Abseits',['Offside']],
  ['Meiste Paraden (Torwart)',['Shot saved (GK)']]];
 // Ältere Stände zählten Gegenbuchungen (z. B. Gelb −10, später +10) mit. Bei festem Betrag ergibt sich die Anzahl aus den Punkten.
 const fixCount=(t,x)=>{if(t.signCount)return x.count;const m=new Set((t.points||[]).map(p=>Math.abs(p.points)));if(m.size!==1||m.has(0)||m.has(null))return x.count;const v=(t.points||[]).filter(p=>p.points).sort((a,b)=>b.count-a.count)[0].points;return Math.max(0,Math.round(x.points/v));};
 function statsHtml(){
  const norm=x=>String(x||'').replace(/\s+/g,' ').trim();
  const rows=STAT_CATS.map(([name,titles])=>{
   const per=new Map();
   for(const t of etiData)if(titles.includes(norm(t.kickbaseTitle)))for(const x of (t.topPlayers||[])){const r=per.get(x.playerId)||{...x,count:0,points:0};r.count+=fixCount(t,x);r.points+=x.points;per.set(x.playerId,r);}
   const top=[...per.values()].sort((a,b)=>b.count-a.count||b.points-a.points);
   if(!top.length)return '';
   const best=top.filter(x=>x.count===top[0].count);
   // Bei vielen Gleichen nur zwei Namen zeigen, der Rest steht aufgeklappt.
   const lead=best.slice(0,2).map(x=>`${safe(x.name)} <span class="muted">(${safe(x.team)})</span>`).join(', ')+(best.length>2?` <span class="muted">+ ${best.length-2} weitere</span>`:'');
   const more=top.slice(0,5).map((x,n)=>`${n+1}. ${safe(x.name)} (${safe(x.team)}) ${x.count}× · ${safe(sign(x.points))} Pkt.`).join('<br>');
   return `<details><summary><span class="eti-name">${safe(name)}</span><span class="eti-count" style="text-align:left;white-space:normal">${lead}</span><span class="eti-pts">${top[0].count}×</span></summary><div class="eti-body"><div>${more}</div></div></details>`;
  }).join('');
  if(!rows){return etiData.some(t=>t.topPlayers)?'':'<p class="muted tiny">Für die Spieltags-Statistik diesen Spieltag bitte einmal neu sammeln.</p>';}
  return `<details class="acc-group" data-pts-open="stats"${ptsOpen.stats?' open':''}><summary>Spieltags-Statistik <span class="pts-sub">${STAT_CATS.length} Kategorien, antippen für Top 5</span></summary><div class="acc-sub"><div class="eti-list eti-stats" lang="de"><div class="eti-head"><span>KATEGORIE</span><span>SPITZENREITER</span><span>ANZAHL</span></div>${rows}</div></div></details>`;
 }
 function renderEti(){
  if(!etiData){root.innerHTML='';return;}
  if(!etiData.length){root.innerHTML='<p class="muted">Keine Ereignisse gefunden.</p>';return;}
  const q=etiFilter.trim().toLowerCase();
  const list=etiData.filter(t=>!q||`${t.label||''} ${t.kickbaseTitle||''} ${t.eti} ${t.examples.map(e=>e.name+' '+e.team).join(' ')}`.toLowerCase().includes(q));
  const num=x=>x==null?-Infinity:x;
  const cmp={count:(a,b)=>b.occurrences-a.occurrences,high:(a,b)=>num(mainPts(b))-num(mainPts(a)),low:(a,b)=>(mainPts(a)??Infinity)-(mainPts(b)??Infinity),eti:(a,b)=>a.eti-b.eti}[etiSort];
  list.sort((a,b)=>cmp(a,b)||b.occurrences-a.occurrences||a.eti-b.eti);
  const rows=list.map(t=>{
   const known=!!t.label,mp=mainPts(t);
   const pts=t.points.map(x=>`${safe(sign(x.points))} (${x.count}×)`).join(', ');
   const ex=t.examples.map(e=>`${safe(e.name)} (${safe(e.team)}${e.minute!=null?', '+safe(e.minute)+'.':''})`).join(' · ');
   return `<details><summary><span class="eti-name${known?'':' unk'}">${known?safe(t.label):'Noch unbekannt'}</span><span class="eti-count">${safe(t.occurrences)}×</span><span class="eti-pts ${mp>0?'pos':mp<0?'neg':''}">${safe(sign(mp))}</span></summary><div class="eti-body"><div><b>Nummer</b> ${safe(t.eti)}${t.kickbaseTitle?` · <b>Kickbase</b> ${safe(t.kickbaseTitle)}`:''}${t.ke&&t.ke.length?' · ke '+safe(t.ke.join(',')):''}</div><div><b>Punkte</b> ${pts||'–'}</div>${t.topPlayers?.length?`<div><b>Am häufigsten</b> ${t.topPlayers.slice(0,5).map(x=>`${safe(x.name)} (${safe(x.team)}) ${x.count}×`).join(' · ')}</div>`:(ex?`<div><b>Beispiele</b> ${ex}</div>`:'')}</div></details>`;
  }).join('');
  const tools=`<div class="eti-tools"><label>Sortieren <select id="etiSort"><option value="count">Am häufigsten</option><option value="high">Meiste Punkte</option><option value="low">Meiste Minuspunkte</option><option value="eti">Nach Nummer</option></select></label><label>Suchen <input id="etiFilter" type="search" placeholder="z. B. Elfmeter oder Spieler"></label><span class="muted tiny">${list.length} von ${etiData.length}</span></div>`;
  root.innerHTML=statsHtml()+`<details class="acc-group" data-pts-open="all"${ptsOpen.all?' open':''}><summary>Alle Einzelereignisse <span class="pts-sub">${etiData.length} Arten, sortier- und durchsuchbar</span></summary><div class="acc-sub">${tools}${rows?`<div class="eti-list"><div class="eti-head"><span>EREIGNIS (antippen für Details)</span><span>ANZAHL</span><span>PUNKTE</span></div>${rows}</div>`:'<p class="muted">Nichts gefunden.</p>'}</div></details>`;
  root.querySelectorAll('[data-pts-open]').forEach(d=>d.addEventListener('toggle',()=>{ptsOpen[d.dataset.ptsOpen]=d.open;}));
  const sel=root.querySelector('#etiSort'),inp=root.querySelector('#etiFilter');
  sel.value=etiSort;inp.value=etiFilter;
  sel.addEventListener('change',()=>{etiSort=sel.value;renderEti();});
  inp.addEventListener('input',()=>{etiFilter=inp.value;const pos=inp.selectionStart;renderEti();const n=root.querySelector('#etiFilter');n.focus();try{n.setSelectionRange(pos,pos);}catch{}});
 }
 // Saison-Bestenliste: gleiche Kategorien wie die Spieltags-Statistik, über alle gespeicherten Spieltage summiert.
 // Rangliste als Balken, Verlauf als Linien wie in der Punkteentwicklung.
 const sCat=document.querySelector('#seasonCat'),sMode=document.querySelector('#seasonMode'),sRoot=document.querySelector('#seasonChart');
 let seasonData=null;
 if(sCat)sCat.innerHTML=STAT_CATS.map(([name],i)=>`<option value="${i}">${safe(name)}</option>`).join('');
 function seasonRows(){
  const [,titles]=STAT_CATS[Number(sCat.value)||0],per=new Map();
  for(const t of titles)for(const [id,c,p,d] of (seasonData.titles[t]||[])){
   const r=per.get(id)||{id,name:seasonData.players[id]?.[0]||'Unbekannt',team:seasonData.players[id]?.[1]||'',count:0,points:0,days:new Array(seasonData.days.length).fill(0)};
   r.count+=c;r.points+=p;d.forEach((v,k)=>r.days[k]+=v);per.set(id,r);
  }
  return [...per.values()].sort((a,b)=>b.count-a.count||b.points-a.points||a.name.localeCompare(b.name,'de'));
 }
 function renderSeason(){
  if(!sRoot)return;
  if(!seasonData){return;}
  const days=seasonData.days;
  if(!days.length){sRoot.innerHTML='<p class="muted">Noch keine Spieltage gespeichert. Oben einen Spieltag wählen und „Einzelereignisse sammeln“.</p>';return;}
  const rows=seasonRows(),mode=sMode.value,catName=STAT_CATS[Number(sCat.value)||0][0];
  const partial=days.filter(d=>!d.full).map(d=>d.day);
  const have=new Set(days.map(d=>d.day)),lastDay=Math.max(...days.map(d=>d.day));
  const missing=Array.from({length:lastDay},(_,i)=>i+1).filter(n=>!have.has(n));
  const notes=[`Gezählt: ${days.length} Spieltag${days.length===1?'':'e'} (ST ${days.map(d=>d.day).join(', ')})`];
  if(missing.length)notes.push(`noch nicht gesammelt: ST ${missing.join(', ')}`);
  const hint=`<p class="muted tiny" style="margin-top:12px">${notes.join(' · ')}.${partial.length?` <span style="color:#f1a5aa">ST ${partial.join(', ')} ${partial.length===1?'enthält':'enthalten'} nur die Top 10 je Spieltag. Für genaue Summen ${partial.length===1?'diesen Spieltag':'diese Spieltage'} oben einmal neu sammeln.</span>`:''}</p>`;
  if(!rows.length){sRoot.innerHTML=`<p class="muted">In dieser Kategorie gibt es noch keine Einträge.</p>${hint}`;return;}
  const narrow=(sRoot.clientWidth||1000)<640,fs=narrow?16:12,esc=safe;
  const short=(t,max)=>t.length>max?t.slice(0,max-1)+'…':t;
  if(mode==='stacked'){
   const bars=rows.slice(0,10).map(r=>({name:r.name,full:`${r.name}${r.team?' ('+r.team+')':''}`,total:r.count,segs:r.days.map((v,k)=>({day:days[k].day,v}))}));
   sRoot.classList.remove('muted');
   kblStackChart(sRoot,bars,{aria:`${catName}: Top 10, aufgeteilt nach Spieltagen`,fmt:v=>`${fmt(v)}×`,note:`${esc(catName)}: Top 10 der Saison, ein Balken je Spieler. Jeder Abschnitt ist ein gespeicherter Spieltag.`});
   sRoot.insertAdjacentHTML('beforeend',hint);return;
  }
  let svg;
  if(mode==='cumulative'||mode==='daily'){
   // Top 10 der Saison wie in der Rangliste, als Linien über die gespeicherten Spieltage.
   const top=rows.slice(0,10);
   const lines=top.map((r,i)=>{let sum=0;return {...r,color:progressColors[i%progressColors.length],values:mode==='daily'?r.days.slice():r.days.map(v=>sum+=v)};});
   const W=narrow?480:1000,H=400,left=narrow?52:64,right=narrow?110:170,topPad=24,bottom=48,pw=W-left-right,ph=H-topPad-bottom;
   let hi=Math.max(1,...lines.flatMap(l=>l.values));
   const rough=Math.max(1,hi/5),mag=10**Math.floor(Math.log10(rough)),tickStep=Math.max(1,[1,2,2.5,5,10].map(f=>f*mag).find(v=>v>=rough));
   hi=Math.ceil(hi/tickStep)*tickStep;
   const x=i=>left+(days.length===1?pw/2:i*pw/(days.length-1)),y=v=>topPad+(hi-v)/hi*ph;
   svg=`<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(catName)}: ${mode==='daily'?'Werte je Spieltag':'Verlauf über die Saison'}" xmlns="http://www.w3.org/2000/svg"><rect x="0" y="0" width="${W}" height="${H}" fill="#12212b" rx="10"/>`;
   for(let v=0;v<=hi+tickStep/1000;v+=tickStep)svg+=`<line x1="${left}" y1="${y(v)}" x2="${W-right}" y2="${y(v)}" stroke="#2c3c47" stroke-width="1"/><text x="${left-10}" y="${y(v)+4}" fill="#9fb3c0" text-anchor="end" font-size="${fs}">${fmt(Math.round(v*10)/10)}</text>`;
   const step=Math.max(1,Math.ceil(days.length/(narrow?7:12)));days.forEach((d,i)=>{if(i%step===0||i===days.length-1)svg+=`<text x="${x(i)}" y="${H-18}" fill="#9fb3c0" text-anchor="middle" font-size="${fs}">ST ${d.day}</text>`;});
   for(const l of lines.slice().reverse()){
    const pts=l.values.map((v,i)=>`${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
    svg+=`<g><title>${esc(l.name)} (${esc(l.team)}): ${l.count}× · ${esc(sign(l.points))} Pkt.</title>${days.length>1?`<polyline points="${pts}" fill="none" stroke="${l.color}" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round"/>`:''}${l.values.map((v,i)=>`<circle cx="${x(i)}" cy="${y(v)}" r="4" fill="${l.color}" stroke="#12212b" stroke-width="1.5"><title>${esc(l.name)} · ${mode==='daily'?'an':'bis'} ST ${days[i].day}: ${v}×</title></circle>`).join('')}</g>`;
   }
   const labels=lines.map(l=>({name:l.name,color:l.color,ty:y(l.values.at(-1)),lx:x(days.length-1)})).sort((a,b)=>a.ty-b.ty);
   const gap=fs+3;labels.forEach((l,k)=>{l.y=Math.max(l.ty,k?labels[k-1].y+gap:topPad);});
   const overflow=labels.length?labels.at(-1).y-(H-bottom):0;if(overflow>0)labels.forEach(l=>l.y-=overflow);
   for(const l of labels)svg+=`<line x1="${l.lx+6}" y1="${l.ty}" x2="${W-right+8}" y2="${l.y}" stroke="${l.color}" stroke-opacity=".5"/><text x="${W-right+12}" y="${l.y+4}" fill="${l.color}" font-size="${fs}" font-weight="700">${esc(short(l.name,narrow?9:18))}</text>`;
   svg+='</svg>';
  }else{
   // Rangliste: Top 10 als Balken, Spitzenreiter (auch bei Gleichstand) in Gold.
   const list=rows.slice(0,10),max=list[0].count;
   const W=narrow?480:1000,rowH=narrow?36:30,topPad=12,H=topPad*2+list.length*rowH,left=narrow?190:300,right=narrow?96:150,pw=W-left-right;
   svg=`<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(catName)}: Rangliste der Saison" xmlns="http://www.w3.org/2000/svg"><rect x="0" y="0" width="${W}" height="${H}" fill="#12212b" rx="10"/>`;
   let place=0;
   list.forEach((r,i)=>{
    if(!i||r.count!==list[i-1].count)place=i+1;
    const yy=topPad+i*rowH,bw=Math.max(3,r.count/max*pw),lead=r.count===max,col=lead?'#f1c75c':'#59b8e8';
    const label=narrow?short(r.name,12):`${short(r.name,22)}${r.team?' · '+short(r.team,12):''}`;
    svg+=`<g><title>${esc(place)}. ${esc(r.name)} (${esc(r.team)}): ${r.count}× · ${esc(sign(r.points))} Pkt.</title><text x="12" y="${yy+rowH/2+fs/3}" fill="${lead?'#f1c75c':'#9fb3c0'}" font-size="${fs}" font-weight="700">${place}.</text><text x="${narrow?42:44}" y="${yy+rowH/2+fs/3}" fill="${lead?'#f1c75c':'#d7dde2'}" font-size="${fs}"${lead?' font-weight="700"':''}>${esc(label)}</text><rect x="${left}" y="${yy+rowH*.2}" width="${bw.toFixed(1)}" height="${(rowH*.6).toFixed(1)}" rx="4" fill="${col}" fill-opacity="${lead?1:.75}"/><text x="${(left+bw+8).toFixed(1)}" y="${yy+rowH/2+fs/3}" fill="#f3f5f7" font-size="${fs}" font-weight="700">${r.count}×<tspan fill="#9fb3c0" font-weight="400"> ${esc(sign(r.points))}</tspan></text></g>`;
   });
   svg+='</svg>';
  }
  const how=mode==='daily'?'Anzahl an jedem einzelnen Spieltag (nicht aufsummiert), Top 10 der Saison.':mode==='cumulative'?'Aufaddierte Anzahl nach jedem gespeicherten Spieltag, Top 10 der Saison.':'Top 10 der Saison nach Anzahl, dahinter die Punkte aus dieser Kategorie. Antippen zeigt Verein und Punkte.';
  sRoot.classList.remove('muted');
  sRoot.innerHTML=svg+`<p class="muted tiny" style="margin-top:12px">${how}</p>`+hint;
 }
 async function loadSeason(){
  if(!sRoot)return;
  try{seasonData=await api('/api/points-season');renderSeason();}
  catch(e){sRoot.innerHTML=`<p class="muted">Saison-Bestenliste nicht verfügbar: ${safe(e.message)}</p>`;}
 }
 sCat?.addEventListener('change',renderSeason);sMode?.addEventListener('change',renderSeason);
 window.addEventListener('resize',()=>{clearTimeout(window.__kblSeasonResize);window.__kblSeasonResize=setTimeout(renderSeason,200);});
 // Beim Öffnen des Reiters ist immer alles zugeklappt. Das Diagramm wird beim Aufklappen neu gezeichnet (vorher keine Breite bekannt).
 document.querySelectorAll('[data-kbl-nav="points"]').forEach(a=>a.addEventListener('click',()=>{document.querySelectorAll('#points details').forEach(d=>{d.open=false;});ptsOpen.stats=false;ptsOpen.all=false;loadSeason();}));
 document.querySelector('#pointsSeason')?.addEventListener('toggle',e=>{if(e.target.open)renderSeason();});
 loadSeason();
 // Gespeicherte Spieltage: sofort anzeigen, ohne neu zu sammeln.
 const when=x=>x?new Date(x).toLocaleString('de-DE',{day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit'}):'';
 function showResult(d,fromStore){
  const warn=[d.failedPlayers?`${d.failedPlayers} Spieler nicht abrufbar`:'',(d.failedTeams&&d.failedTeams.length)?`Vereine nicht lesbar: ${d.failedTeams.join(', ')}`:''].filter(Boolean).join(' · ');
  msg.style.color=warn?'#f1a5aa':'';
  msg.textContent=`Spieltag ${d.day}: ${d.playersScanned} Spieler geprüft, ${d.playersWithEvents} mit Ereignissen, ${d.types.length} verschiedene Ereignisnummern.${warn?' Achtung: '+warn+'.':''}${d.savedAt?` ${fromStore?'Gespeicherter Stand':'Gespeichert'} vom ${when(d.savedAt)}.`:''}${fromStore&&!window.KBL_STATIC?' „Einzelereignisse sammeln“ holt den neuesten Stand.':''}`;
  etiData=d.types;renderEti();
 }
 async function loadSaved(){
  const want=day.value;
  try{const d=await api(`/api/points-overview/${want}`);if(d.saved&&day.value===want&&!btn.disabled)showResult(d,true);
   else if(window.KBL_STATIC&&day.value===want){msg.style.color='';msg.textContent=`Spieltag ${want} ist noch nicht gesammelt. Das passiert automatisch, sobald Kickbase ihn abgeschlossen hat.`;}}catch{}
 }
 async function markSaved(){
  try{const d=await api('/api/points-overview');const have=new Set(d.days.map(x=>String(x.day)));
   for(const o of day.options)o.textContent=`Spieltag ${o.value}${have.has(o.value)?' ✓ gespeichert':''}`;}catch{}
 }
 btn.addEventListener('click',async()=>{
  btn.disabled=true;root.innerHTML='';msg.style.color='';msg.textContent='Lese alle Spieler, das kann einige Minuten dauern …';
  try{
   const d=await api(`/api/playercenter-scan/${day.value}`);
   showResult(d,false);markSaved();loadSeason();
  }catch(e){msg.textContent='Fehlgeschlagen: '+e.message;msg.style.color='#f1a5aa';}
  finally{btn.disabled=false;}
 });
 day.addEventListener('change',()=>{msg.textContent='';msg.style.color='';root.innerHTML='';etiData=null;loadSaved();});
})();


// KBL 4.11: Spieltags-Zentrale auf der Übersicht. Was ist passiert, was ist jetzt zu tun?
// Nutzt die geladene Historie; die Strafen kommen aus der Abrechnung des letzten
// abgeschlossenen Spieltags (einmal je Seitenaufruf, keine Transfers).
const centerAccounting={day:null,state:'idle',data:null,error:null,checks:{},probe:false};
async function centerLoadAccounting(day,force=false){
 if(!force&&centerAccounting.day===day&&centerAccounting.state!=='idle')return;
 Object.assign(centerAccounting,{day,state:'loading',data:null,error:null,probe:false});renderAccTodo();
 try{
  const [data,checks]=await Promise.all([api(`/api/rule-accounting/${day}`),api(`/api/todo-checks/${day}`).catch(()=>({checks:{}}))]);
  centerAccounting.data=data;centerAccounting.checks=checks.checks||{};centerAccounting.state='done';if(data?.ready)window.kblAccShow?.(data);
 }
 catch(e){centerAccounting.error=e.message;centerAccounting.state='error';}
 renderAccTodo();
}
function centerTodoHtml(){
 const a=centerAccounting,safe=x=>escapeHtml(String(x??''));
 if(a.state==='loading'||a.state==='idle')return '<p class="muted">Die BumsParade wird geprüft … Das kann beim ersten Öffnen etwas dauern.</p>';
 if(a.state==='error')return `<p class="error">BumsParade nicht abrufbar: ${safe(a.error)}</p>`;
 const d=a.data;
 if(!d.ready){
  const issues=[...(d.missing||[]).map(x=>`${x.name}: Aufstellung fehlt`),...(d.invalid||[]).map(x=>`${x.name}: ${x.reason}`)];
  if(d.missingPoints?.length)issues.push(`Für ${d.missingPoints.length} Spieler fehlen Punkte`);
  return `<p class="muted">${safe(d.message||'Abrechnung noch nicht möglich.')}</p>${issues.length?`<p><strong>Das fehlt:</strong></p><ul class="center-list">${issues.map(x=>`<li>${safe(x)}</li>`).join('')}</ul>`:''}`;
 }
 // Eine Liste nach Manager: Aufgaben kommen fertig vom Server (inkl. automatischer Prüfung), Details zum Aufklappen.
 const todos=d.todos||[],checks=a.probe?{}:(a.checks||{});
 const ae=d.autoEvents&&!d.autoEvents.error?d.autoEvents:null;
 const pl=x=>safe(x.playerName||x.name||`Spieler-ID ${x.playerId}`);
 const same=(x,mid,pid)=>String(x.managerId)===String(mid)&&(pid==null||String(x.playerId)===String(pid));
 const RULE={BD:'Besoffener Davies',DD:'Dämonische Drehtür',MM:'Magic Miyoshi',AH:'Angeschossener Höler',RK:'Räudiger Kohr',BN:'Blinder Niklas',UM:'Upamaguire',EZ:'Einzelfallentscheidung',TL:'Teamlimit'};
 const STATE={done:['ok','✓ erledigt'],progress:['half','läuft'],open:['open','offen'],unknown:['warn','? unklar'],manual:['','von Hand']};
 const detail=t=>{const [,mid,pid]=t.key.split(':');const out=[];
  if(t.rule==='BD'){const x=(d.bd||[]).find(x=>same(x,mid,pid));if(x)out.push(`Schnapszahl: ${pl(x)} hat ${fmt(x.points)} Punkte geholt.`);out.push('Der Spieler wird an den Markt verkauft, nicht an einen Manager.');}
  if(t.rule==='DD'){const w=(d.dd?.winners||[]).find(x=>same(x,mid));
   if(w){out.push(`Spieltagssieger mit ${fmt(w.dayPoints)} Punkten. Letzter: ${(d.dd.lastPlace||[]).map(x=>`${safe(x.manager)} (${fmt(x.dayPoints)} Pkt.)`).join(', ')}. Der Letzte sucht sich einen der Kandidaten aus.`);
    if(w.candidates.length>3)out.push(`Gleichstand auf Platz 3: ${w.candidates.length} Kandidaten.`);
    if(w.excluded?.length)out.push(`Nicht dabei, weil von einer anderen Regel betroffen: ${w.excluded.map(p=>`${pl(p)} (${fmt(p.points)} Pkt., ${safe(p.reason)})`).join(' · ')}.`);
    if(w.uncertain?.length)out.push(`<span class="error">Noch nicht eindeutig: ${w.uncertain.map(p=>`${pl(p)} (${safe(p.rule)})`).join(' · ')}. Fällt er heraus, rückt der Nächstbeste nach.</span>`);}
   out.push('Es zählen die besten Spieler der Startelf. Spieler, die von einer anderen Regel betroffen sind, fallen heraus.');}
  if(t.rule==='MM'){const v=(d.mm?.values||[]).find(x=>same(x,mid));
   if(v)out.push(`Die meisten Minuspunkte: ${fmt(v.negativeSum)} Pkt.${(v.negatives||[]).length?` durch ${v.negatives.map(n=>`${pl(n)} (${fmt(n.points)})`).join(' · ')}`:''}.`);
   if(d.mm?.tie)out.push('Gleichstand: Die Regel gilt für alle Manager mit gleich vielen Minuspunkten.');
   out.push('Der bestimmte Manager stellt am nächsten Spieltag einen Spieler weniger auf.');}
  if(t.rule==='AH'){const mv=d.ah?.mvp,p=(mv?.players||[]).find(x=>String(x.id)===String(pid))||(mv?.players||[])[0];
   if(p)out.push(`MVP des Spieltags: ${safe(p.name)} (${safe(p.team)}), ${fmt(p.points)} Punkte.`);
   if((mv?.players||[]).length>1)out.push('Gleichstand an der Spitze: AH gilt für alle MVPs.');
   out.push('Verkauf an den Höchstbietenden, ohne Gebot an Kickbase. Gebote verdeckt in der Kickbase-App. Nicht über die Dämonische Drehtür.');
   if(mv&&!mv.reliable)out.push('<span class="error">Nicht alle Spielerdaten waren abrufbar, der MVP ist unsicher.</span>');
   if(mv?.top?.length)out.push(`Die besten fünf: ${mv.top.map(x=>`${safe(x.name)} ${fmt(x.points)}`).join(' · ')}`);}
  if(['RK','BN','UM'].includes(t.rule)){const x=(ae?.actions||[]).find(x=>x.rule===t.rule&&same(x,mid,pid));
   if(x){out.push(`Grund: ${safe(x.reason)}.`);if(x.rule==='UM'&&x.recipient)out.push(`Empfänger: <strong>${safe(x.recipient)}</strong>.`);out.push(safe(x.action)+'.');}}
  if(t.rule==='EZ'){const c=(d.conflicts||[]).find(x=>String(x.playerId)===String(pid));
   if(c)out.push(...(c.details||[]).map(x=>`${safe(x.rule)}: ${safe(x.reason)}`));
   out.push('Mehrere gleichrangige Regeln treffen denselben Spieler. Welche gilt, entscheidet ihr im Einzelfall.');}
  if(t.rule==='TL')out.push('Teamlimit 1: Wer in der BumsParade einen Spieler bekommt, verkauft seinen bisherigen Spieler desselben Vereins (Markt oder Manager).');
  return out.length?`<details class="center-more"><summary>${safe(RULE[t.rule]||t.rule)} · Details</summary>${out.map(x=>`<p>${x}</p>`).join('')}</details>`:'';};
 // Magic Miyoshi: Auswahl, wen der Manager bestimmt hat.
 const lastDay=historyData.filter(h=>h.status==='finished').at(-1);
 const mmNames=(lastDay?.list||[]).map(m=>m.name).filter(isEligibleManager).sort((x,y)=>x.localeCompare(y,'de'));
 const mmPick=t=>{const target=checks[t.key]?.target||'';return `<select class="center-pick" data-todo-target="${safe(t.key)}" aria-label="Wen hat ${safe(t.manager)} bestimmt?"${a.probe?' disabled':''}><option value="">Wen hat er bestimmt?</option>${mmNames.map(n=>`<option value="${safe(n)}" ${n===target?'selected':''}>${safe(n)}</option>`).join('')}</select>`;};
 // DD: welcher Spieler; RK, BN, AH, TL: an wen. Die Auswahl zählt bis in die BumsTabelle.
 const anyPick=t=>{if(ro)return '';const k=todoPick(t);if(k==='mm')return mmPick(t);if(!k)return '';const target=checks[t.key]?.target||'',need=todoNeedsPick(t);
  const autoNow=k==='dd'?(t.to||[])[0]?.playerName:(t.to||[]).length?t.to.map(r=>r.manager).join(', '):t.check?.state==='done'&&/Markt/.test(t.check?.note||'')?'an den Markt':'';
  const opts=k==='dd'?t.options.map(o=>o.name):[...(['AH','TL','UM'].includes(t.rule)?['Markt']:[]),...mmNames.filter(n=>n!==t.manager)];
  const q=k==='dd'?'Welchen Spieler hat der Letzte gewählt?':t.rule==='AH'?'Wer hat ihn gekauft?':'An wen ging er?';
  const first=need?q:`automatisch: ${autoNow||'nicht erkannt'} (ändern …)`;
  return `<select class="center-pick${need?'':' center-fix'}" data-todo-target="${safe(t.key)}"${need?' data-need="1"':''} aria-label="${safe(q)}"${a.probe?' disabled':''}><option value="">${safe(first)}</option>${opts.map(n=>`<option value="${safe(n)}" ${n===target?'selected':''}>${n==='Markt'?(t.rule==='AH'?'Kickbase / Markt':'an den Markt'):safe(n)}</option>`).join('')}</select>`;};
 const pickLabel=t=>{const g=checks[t.key]?.target;if(!g)return '';const k=todoPick(t);return k==='mm'?`hat ${g} bestimmt`:k==='dd'?`${g} an ${(t.to||[]).map(r=>r.manager).join(', ')||'den Letzten'}`:g==='Markt'?'an den Markt':`an ${g}`;};
 const gone=t=>!!checks[t.key]?.removed;
 // Online-Ansicht: Haken, Auswahl und „Strafe entfernen“ nur nach Admin-Anmeldung (Kevin), gespeichert im Tippdienst.
 const ro=a.probe||(!!window.KBL_STATIC&&!window.kblHaken?.admin());
 // Verkaufszeitpunkt (Kevin-Wunsch): Frist 22:00 Uhr am Tag nach dem Spieltag; danach rot.
 const when=iso=>new Date(iso).toLocaleString('de-DE',{weekday:'short',day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit',timeZone:'Europe/Berlin'});
 const dl=d.saleDeadline?` (Frist ${when(d.saleDeadline)} Uhr)`:'';
 const saleInfo=(t,finished)=>t.soldAt?`<span class="center-sale${t.late?' late':''}">🕒 verkauft ${safe(when(t.soldAt))} Uhr${t.late?` · zu spät${safe(dl)}`:''}</span>`:t.overdue&&!finished?`<span class="center-sale late">🕒 Frist abgelaufen${safe(dl)}, noch nicht verkauft</span>`:'';
 const rows=todos.map(t=>{
  // Von Hand entfernte Strafe (falsch berechnet): durchgestrichen, zählt nicht, lässt sich wiederherstellen.
  if(gone(t))return {key:t.key,mid:t.managerId,manager:t.manager,todo:false,removed:true,finished:true,html:`<li class="center-info center-done center-removed"><span class="center-check"></span><span class="center-rule" title="${safe(RULE[t.rule]||'')}">${safe(t.rule)}</span><span class="center-text"><span><s>${safe(t.text)}</s></span><span class="center-status"><span class="center-state">✕ Strafe entfernt</span>${ro?'':` <button type="button" class="ghost center-undo" data-todo-restore="${safe(t.key)}">↺ wiederherstellen</button>`}</span></span></li>`};
  const manual=!!checks[t.key]?.done,auto=t.check?.state==='done',finished=manual||auto;
  const [cls,label]=STATE[t.check?.state]||STATE.manual;
  const status=checks[t.key]?.target&&todoPick(t)?`<span class="center-state ok">✓ ${safe(pickLabel(t))}</span>${auto&&t.rule!=='MM'?' <span class="muted tiny">von Hand korrigiert</span>':''}`
   :auto?`<span class="center-state ok">✓ erledigt</span> <span class="muted tiny">${safe(t.check.note)}</span>`
   :manual?`<span class="center-state ok">✓ von Hand abgehakt</span>${t.check?.state&&t.check.state!=='manual'?` <span class="muted tiny">BumsKI sieht: ${safe(t.check.note)}</span>`:''}`
   :`<span class="center-state ${cls}">${label}</span> <span class="muted tiny">${safe(t.check?.note||'')}</span>`;
  const opts=t.options?.length?`<span class="center-options">${t.options.map(o=>`<span class="center-option${o.moved?' moved':''}"${o.uncertain?` title="Noch nicht sicher: ${safe(o.uncertain)}"`:''}>${o.moved?'✓ ':''}${o.uncertain?'? ':''}${safe(o.name)} <small>${fmt(o.points)} Pkt.${o.uncertain?' · unsicher':''}${o.clash?` · Letzter müsste ${safe(o.clash)} abgeben`:''}</small></span>`).join('')}</span>`:'';
  return {key:t.key,mid:t.managerId,manager:t.manager,todo:true,finished,html:`<li class="${finished?'center-done':''}"><label class="center-check" title="${auto?'Von der BumsKI als erledigt erkannt':'Abhaken, wenn erledigt'}"><input type="checkbox" data-todo-key="${safe(t.key)}" ${finished?'checked':''} ${auto||ro?'disabled':''}></label><span class="center-rule" title="${safe(RULE[t.rule]||'')}">${safe(t.rule)}</span><span class="center-text"><span>${safe(t.text)}</span><span class="center-status">${status}</span>${saleInfo(t,finished)}${anyPick(t)}${opts}${detail(t)}${ro?'':`<button type="button" class="ghost center-remove" data-todo-remove="${safe(t.key)}" title="Falls die BumsKI hier falsch gerechnet hat">✕ Strafe entfernen</button>`}</span></li>`};
 });
 // Wer bei UM, DD, RK, BN oder AH einen Spieler bekommt, ist ebenfalls betroffen (zählt als Bumsung). Käufer eines TL-Spielers nicht.
 const midOf=n=>[...(d.plausibility||[])].find(p=>p.manager===n)?.managerId||null;
 for(const t of todos){if(gone(t))continue;const g=checks[t.key]?.target,k=todoPick(t);let to=(t.to||[]).map(r=>({...r,playerName:k==='dd'&&g?g:r.playerName}));
  if(k==='to'&&g)to=g==='Markt'?[]:[{managerId:midOf(g),manager:g,playerName:todoPlayer(t)}];
  // TL nur in erster Ebene (Kevin-Vorgabe): Wer den Teamlimit-Spieler kauft, gehört nicht zur BumsParade.
  if(t.rule==='TL')continue;
  for(const r of to){const giver=rows.find(x=>x.key===t.key);
  rows.push({mid:r.managerId,manager:r.manager,todo:false,receive:true,html:`<li class="center-info${giver?.finished?' center-done':''}"><span class="center-check"></span><span class="center-rule" title="${safe(RULE[t.rule]||'')}">${safe(t.rule)}</span><span class="center-text"><span>${recvVerb(t.rule)} ${r.playerName?safe(r.playerName):'einen Spieler'} von ${safe(t.manager)}</span><span class="center-status">${giver?.finished?'<span class="center-state ok">✓ angekommen</span>':'<span class="center-state">wartet auf Abgabe</span>'}</span></span></li>`});}}
 // Magic Miyoshi: Der bestimmte Manager ist ebenfalls betroffen.
 for(const t of todos.filter(t=>t.rule==='MM'&&checks[t.key]?.target&&!gone(t))){const name=checks[t.key].target;
  const mid=[...(d.plausibility||[])].find(p=>p.manager===name)?.managerId||null;
  rows.push({mid,manager:name,todo:false,receive:true,html:`<li class="center-info center-done"><span class="center-check"></span><span class="center-rule" title="${safe(RULE.MM)}">MM</span><span class="center-text"><span>stellt am nächsten Spieltag einen Spieler weniger auf</span><span class="center-status muted tiny">bestimmt von ${safe(t.manager)}</span></span></li>`});}
 // Nicht eindeutige Fälle und entfallene Schnapszahlen stehen direkt beim Manager.
 for(const u of (ae?.unclear||[])){const k=unclearKey(u),g=checks[k]?.target,ok=/^[A-Z]{2,3}:\d{1,15}:\d{1,12}$/.test(k);
  const sel=ok?`<select class="center-pick" data-todo-target="${safe(k)}" aria-label="Wie wurde entschieden?"${a.probe?' disabled':''}><option value="">Wie wurde entschieden?</option>${['Entfällt','Markt',...mmNames.filter(n=>n!==u.manager)].map(n=>`<option value="${safe(n)}" ${n===g?'selected':''}>${n==='Entfällt'?'Regel entfällt':n==='Markt'?'an den Markt':'an '+safe(n)}</option>`).join('')}</select>`:'';
  const st=g?`<span class="center-state ok">✓ ${g==='Entfällt'?'Regel entfällt':g==='Markt'?'an den Markt':'an '+safe(g)}</span>`:`<span class="center-state warn">? bitte prüfen</span>`;
  rows.push({mid:u.managerId,manager:u.manager,todo:false,unclear:!g,html:`<li class="center-info${g?' center-done':''}"><span class="center-check"></span><span class="center-rule">${safe(u.rule)}</span><span class="center-text"><span>${pl(u)}: bitte von Hand prüfen</span><span class="center-status">${st} <span class="muted tiny">${safe(u.reason)}</span></span>${sel}</span></li>`});
  if(g&&g!=='Entfällt'&&g!=='Markt')rows.push({mid:midOf(g),manager:g,todo:false,receive:true,html:`<li class="center-info center-done"><span class="center-check"></span><span class="center-rule">${safe(u.rule)}</span><span class="center-text"><span>${recvVerb(u.rule)} ${pl(u)} von ${safe(u.manager)}</span><span class="center-status"><span class="center-state ok">✓ von Hand nachgetragen</span></span></span></li>`});}
 for(const x of (d.bdDropped||[]))rows.push({mid:x.managerId,manager:x.manager,todo:false,html:`<li class="center-info center-done"><span class="center-check"></span><span class="center-rule">BD</span><span class="center-text"><span>${pl(x)} (${fmt(x.points)} Pkt.): Schnapszahl entfällt</span><span class="center-status muted tiny">weil auch ${x.because.map(safe).join(' und ')} gilt, BD tritt zurück</span></span></li>`});
 // Reihenfolge wie bei der Abrechnung: chronologisch vom Spieltagssieger abwärts.
 const dayList=historyData.find(h=>Number(h.day)===Number(a.day))?.list||[];
 const ptsOf=new Map();
 for(const p of (d.plausibility||[]))if(p.rankingPoints!=null)ptsOf.set(String(p.managerId),{name:p.manager,pts:p.rankingPoints});
 const pointsFor=(mid,name)=>ptsOf.get(String(mid))?.pts??dayList.find(m=>m.name===name)?.dayPoints??null;
 const placeOf=pts=>{if(pts==null)return null;const all=[...ptsOf.values()].map(x=>x.pts);const src=all.length?all:dayList.map(m=>m.dayPoints).filter(x=>x!=null);return 1+src.filter(x=>x>pts).length;};
 const groups=new Map();
 for(const r of rows){const k=String(r.mid||r.manager);if(!groups.has(k))groups.set(k,{mid:r.mid,name:r.manager,list:[]});groups.get(k).list.push(r);}
 // Alle Plätze zeigen, auch Manager ohne Bumsung, damit die Reihenfolge keine Lücken hat.
 const known=new Set([...groups.values()].flatMap(g=>[String(g.mid),g.name]));
 const everyone=ptsOf.size?[...ptsOf.entries()].map(([mid,x])=>({mid,name:x.name})):dayList.filter(m=>m.dayPoints!=null).map(m=>({mid:null,name:m.name}));
 for(const m of everyone)if(isEligibleManager(m.name)&&!known.has(String(m.mid))&&!known.has(m.name))groups.set(String(m.mid||m.name),{mid:m.mid,name:m.name,list:[]});
 const sorted=[...groups.values()].map(g=>{const pts=pointsFor(g.mid,g.name);return {...g,pts,place:placeOf(pts),hits:g.list.filter(x=>x.todo||x.unclear||x.receive).length,open:g.list.filter(x=>x.todo&&!x.finished).length,check:g.list.filter(x=>x.unclear).length};})
  .sort((x,y)=>(x.place??999)-(y.place??999)||x.name.localeCompare(y.name,'de'));
 const groupHtml=sorted.map(g=>`<li class="center-group${g.list.length?'':' center-idle'}${g.open||g.check?'':' center-done'}"><div class="center-grouphead"><span>${g.place?`<span class="center-place">${g.place}.</span>`:''}<b>${mgrName(g.name)}</b>${g.pts!=null?` <span class="muted tiny" style="white-space:nowrap">${fmt(g.pts)} Pkt.</span>`:''}</span><span class="center-heads"><span class="center-hits${g.hits?'':' none'}">${g.hits?`${g.hits} Bumsung${g.hits===1?'':'en'}`:'keine Bumsung'}</span>${g.list.length?`<span class="center-state ${g.open?'open':g.check?'warn':'ok'}">${g.open?`${g.open} offen`:g.check?'bitte prüfen':'✓ erledigt'}</span>`:''}</span></div>${g.list.length?`<ul class="center-todo">${g.list.map(x=>x.html).join('')}</ul>`:''}</li>`).join('');
 const notes=[];
 if(a.probe)notes.push('PROBELAUF: Die heutigen Aufstellungen wurden als Startelf angenommen. Nur ein Test, Haken sind ausgeschaltet.');
 if(!d.complete)notes.push('Aufstellungen oder Spielerpunkte sind unvollständig, Drehtür und Magic Miyoshi fehlen noch.');
 if(d.dd?.tie)notes.push('Gleichstand bei der Drehtür, bitte von Hand entscheiden.');
 if(d.autoEvents?.error)notes.push('RK, BN und UM konnten nicht geprüft werden.');
 if(ae?.failures?.length)notes.push(`${ae.failures.length} Spieler konnten nicht gelesen werden; für sie fehlt die Erkennung von RK, BN und UM.`);
 if(d.ah?.mvp?.error)notes.push('Der MVP des Spieltags konnte nicht ermittelt werden.');
 const nTodo=rows.filter(r=>r.todo).length,nDone=rows.filter(r=>r.todo&&r.finished).length,nCheck=rows.filter(r=>r.unclear).length;
 const mvp=d.ah?.mvp?.players||[];
 const mvpLine=mvp.length&&!(d.ah?.affected||[]).length?`<p class="muted tiny">MVP des Spieltags: ${mvp.map(m=>`${safe(m.name)} (${fmt(m.points)} Pkt.)`).join(' · ')}, stand bei keinem in der Startelf.</p>`:'';
 return notes.map(n=>`<p class="error tiny">${safe(n)}</p>`).join('')+(rows.length?`<p class="center-progress"><b>${nDone} von ${nTodo}</b> erledigt${nCheck?` · <b>${nCheck}</b> bitte prüfen`:''} <button type="button" class="ghost" id="centerRecheck">↻ Neu prüfen</button>${hakenBar()}</p><p class="muted tiny" style="margin:-4px 0 10px">Reihenfolge wie bei der Abrechnung: vom Spieltagssieger abwärts. Details zum Aufklappen.</p><ul class="center-groups">${groupHtml}</ul><p class="muted tiny">Die BumsKI prüft anhand der heutigen Kader, ob ein Spieler weg ist oder beim richtigen Manager steht. Was sie nicht sicher erkennt, kannst du von Hand abhaken. Die Haken gelten auf allen Geräten.</p>`:'<p>Keine Strafen fällig. 🎉</p>')+mvpLine;
}
// Online: Admin-Anmeldung zum Abhaken (Admin-Code des Tippdienstes, wie beim MVP-Tipp).
function hakenBar(){if(!window.KBL_STATIC||!window.kblHaken?.on||centerAccounting.probe)return '';
 return window.kblHaken.admin()?` <button type="button" class="ghost" data-haken-logout title="Änderungen werden online gespeichert">🔓 Admin · abmelden</button>`:` <button type="button" class="ghost" data-haken-login>🔑 Bearbeiten (Admin)</button>`;}
document.addEventListener('click',async e=>{
 if(e.target.closest('[data-haken-logout]')){window.kblHaken.logout();renderAccTodo();return;}
 if(!e.target.closest('[data-haken-login]'))return;
 const code=prompt('Admin-Code (derselbe wie beim MVP-Tipp):');if(!code)return;
 try{await window.kblHaken.login(code.trim());}catch(err){alert(err.message);return;}
 renderAccTodo();
});
function renderAccTodo(){
 const el=$('#accTodo');if(!el)return;const a=centerAccounting;
 if(a.day==null){el.innerHTML='';return;}
 bumsSave();
 // Eingeklappt, bis man sie öffnet; der Zustand bleibt beim Neuzeichnen erhalten.
 const d=a.state==='done'&&a.data?.ready?a.data:null,todos=(d?.todos||[]).filter(t=>a.probe||!a.checks?.[t.key]?.removed);
 const done=todos.filter(t=>t.check?.state==='done'||(!a.probe&&a.checks?.[t.key]?.done)).length;
 const sum=a.state==='loading'?'wird geprüft …':a.state==='error'?'nicht abrufbar':!d?'noch nicht abrechenbar':todos.length?`${done} von ${todos.length} erledigt`:'keine Strafen';
 // Gesamtzahl der Bumsungen (Kevin-Wunsch), gleiche Zählung wie in der BumsTabelle.
 const nBums=d&&!a.probe?Object.values(bumsCounts(d,a.checks||{})).reduce((n,m)=>n+m.count,0):0;
 const bumsTxt=nBums?` · ${nBums} Bumsung${nBums===1?'':'en'}`:'';
 el.innerHTML=`<details class="center-box acc-todo-box"${accTodoOpen?' open':''}><summary class="center-boxhead"><strong>Spieltag ${a.day} · ${sum}${bumsTxt}</strong><span class="pill">${a.probe?'PROBELAUF · nur Test':'vorläufig'}</span></summary>${centerTodoHtml()}</details>`;
 el.querySelector('details').addEventListener('toggle',e=>{accTodoOpen=e.target.open;});
}
let accTodoOpen=false;
// Weitere Fakten zum letzten abgeschlossenen Spieltag (nur aus der geladenen Historie).
function centerExtraCards(finished,card){
 const last=finished.at(-1),prev=finished.at(-2);if(!last)return '';
 const esc=x=>escapeHtml(String(x)).replace(/_/g,'_<wbr>');
 const nm=x=>mgrLink(x);
 const short=list=>list.length>2?`${list.slice(0,2).map(nm).join(', ')} <details class="hall-more"><summary>+ ${list.length-2} weitere</summary>${list.slice(2).map(nm).join(', ')}</details>`:list.map(nm).join(', ');
 const scored=last.list.filter(m=>m.dayPoints!==null&&isEligibleManager(m.name)).sort((a,b)=>b.dayPoints-a.dayPoints);
 if(!scored.length)return '';
 const best=scored[0].dayPoints,winners=scored.filter(m=>m.dayPoints===best),rest=scored.filter(m=>m.dayPoints<best);
 const lead=winners.length>1?card('VORSPRUNG DES SIEGERS','Gleichstand',`${winners.length} Sieger mit ${fmt(best)} Punkten`)
  :rest.length?card('VORSPRUNG DES SIEGERS',`+${fmt(best-rest[0].dayPoints)}`,`vor ${mgrLink(rest[0].name,esc(rest[0].name))} (${fmt(rest[0].dayPoints)})`):'';
 const pointsOf=(h,n)=>h.list.find(m=>m.name===n)?.dayPoints??null;
 const earlier=finished.slice(0,-1);
 const records=scored.filter(m=>{const old=earlier.map(h=>pointsOf(h,m.name)).filter(x=>x!==null);return old.length&&m.dayPoints>Math.max(...old);});
 const rec=card('PERSÖNLICHER REKORD',records.length?short(records.map(m=>m.name)):'Niemand',records.length?`${records.length===1?'Bester eigener Spieltag':records.length+' Manager mit bestem eigenen Spieltag'}`:'Kein Manager hat seinen Bestwert verbessert');
 let jump=card('STÄRKSTE STEIGERUNG','–','Erst ab dem zweiten Spieltag');
 if(prev){const diffs=scored.map(m=>({name:m.name,now:m.dayPoints,before:pointsOf(prev,m.name)})).filter(x=>x.before!==null).map(x=>({...x,d:x.now-x.before}));
  const top=Math.max(...diffs.map(x=>x.d)),tops=diffs.filter(x=>x.d===top);
  if(diffs.length)jump=card('STÄRKSTE STEIGERUNG',short(tops.map(x=>x.name)),`${top>0?'+':''}${fmt(top)} zum Vorspieltag${tops.length===1?` (${fmt(tops[0].before)} → ${fmt(tops[0].now)})`:''}`);}
 const club=scored.filter(m=>m.dayPoints>=1000);
 const thousand=card('1.000er-CLUB',club.length?`${club.length} Manager`:'Niemand',club.length?short(club.map(m=>m.name)):'Keiner hat 1.000 Punkte geknackt');
 return lead+rec+jump+thousand;
}
// Live-Rangliste des laufenden Spieltags aus /api/live-points (null, solange nicht geladen).
function liveRanking(day){
 if(typeof pvLive==='undefined'||!pvLive||pvLive.day!==day||pvLive.error)return null;
 return (pvLive.managers||[]).filter(m=>isEligibleManager(m.name)&&m.points!=null).map(m=>({name:m.name,dayPoints:m.points})).sort((a,b)=>b.dayPoints-a.dayPoints);
}
// Vollpfosten des Spieltags (Kevin-Vorgabe): meiste Punkte auf der Bank (/api/bench-points/:day). benchData[day] = Antwort oder {error}.
const benchData={},benchBusy=new Set();
async function benchLoad(day,force=false){
 if(!day||benchBusy.has(day)||(benchData[day]&&!force))return;
 benchBusy.add(day);
 try{benchData[day]=await api(`/api/bench-points/${day}`);}catch(e){benchData[day]={error:e.message};}
 benchBusy.delete(day);try{renderCenter();}catch{}
}
function benchTop(day){
 const d=benchData[day];if(!d)return {wait:true};
 if(d.error)return {msg:`Das fehlt: Bankpunkte nicht abrufbar (${d.error}).`};
 const ms=(d.managers||[]).filter(m=>isEligibleManager(m.name));
 if(!ms.length)return {msg:d.message||'Keine Bankpunkte.'};
 const top=ms[0].points;return {top,list:ms.filter(m=>m.points===top),open:ms.reduce((s,m)=>s+m.open,0)};
}
function benchCard(day,card){
 const b=benchTop(day);
 if(b.wait)return card('🤡 VOLLPFOSTEN DES SPIELTAGS','…','Bankpunkte werden geladen');
 if(b.msg)return card('🤡 VOLLPFOSTEN DES SPIELTAGS','–',escapeHtml(b.msg));
 const best=b.list[0].bench.filter(p=>p.points!=null).slice(0,3).map(p=>`${escapeHtml(p.name||'Spieler '+p.id)} ${fmt(p.points)}`).join(', ');
 return card('🤡 VOLLPFOSTEN DES SPIELTAGS',b.list.map(m=>mgrLink(m.name)).join(', '),`${fmt(b.top)} Punkte auf der Bank gelassen${best&&b.list.length===1?` · ${best}`:''}`);
}
function historyLiveInner(day){
 const leader=liveRanking(day)?.[0];
 return `<strong>● LIVE · Spieltag ${day}</strong><div>${leader?`Aktuell führend: <b>${escapeHtml(leader.name)}</b> (${fmt(leader.dayPoints)} Punkte)`:'Live-Punkte werden geladen …'} · Vorläufig, zählt nicht als Spieltagssieg.</div>`;
}
function renderCenter(){
 const el=$('#centerContent');if(!el)return;
 const finished=historyData.filter(h=>h.status==='finished').slice().sort((a,b)=>a.day-b.day);
 if(!finished.length){el.innerHTML='<p class="muted">Noch kein Spieltag abgeschlossen.</p>';return;}
 const card=(label,value,sub)=>`<div><small>${label}</small><strong>${value}</strong><span>${sub}</span></div>`;
 const names=list=>list.map(m=>mgrLink(m.name)).join(', ');
 let html='';
 // Kein LIVE-Kasten hier (Kevin-Wunsch): Der laufende Spieltag steht oben in der Kategorie „Spieltag“, hier nur Abgeschlossenes.
 const last=finished.at(-1);
 const pill=$('#centerPill');if(pill)pill.textContent=last?`Letzter abgeschlossener Spieltag: ${last.day}`:'Noch kein Spieltag abgeschlossen';
 if(last){
  const scored=last.list.filter(m=>m.dayPoints!==null);
  const best=scored.length?scored[0].dayPoints:null,worst=scored.length?scored.at(-1).dayPoints:null;
  const winners=scored.filter(m=>m.dayPoints===best),losers=scored.filter(m=>m.dayPoints===worst);
  const avg=scored.length?scored.reduce((s,m)=>s+m.dayPoints,0)/scored.length:null;
  const now=rankMap(last),prev=finished.length>1?rankMap(finished.at(-2)):null;
  const table=[...now.entries()].sort((a,b)=>a[1]-b[1]);
  const leaders=table.filter(([,r])=>r===1).map(([n])=>n);
  const leaderScore=last.list.find(m=>m.name===leaders[0])?.score;
  const second=last.list.filter(m=>isEligibleManager(m.name)&&!leaders.includes(m.name)).sort((a,b)=>b.score-a.score)[0];
  let moveCard=card('BEWEGUNG IN DER TABELLE','–','Erst ab dem zweiten Spieltag');
  if(prev){
   const moves=table.map(([n,r])=>({name:n,diff:prev.has(n)?prev.get(n)-r:0}));
   const up=Math.max(0,...moves.map(m=>m.diff)),down=Math.min(0,...moves.map(m=>m.diff));
   const ups=moves.filter(m=>m.diff===up&&up>0),downs=moves.filter(m=>m.diff===down&&down<0);
   const short=list=>list.length>2?`${names(list.slice(0,2))} +${list.length-2}`:names(list);
   moveCard=card('BEWEGUNG IN DER TABELLE',ups.length?`▲ ${short(ups)}`:'Keine',`${ups.length?`+${up} Plätze`:'Niemand ist geklettert'}${downs.length?` · <span class="rank-down">▼ ${names(downs)} (−${-down})</span>`:''}`);
  }
  html+=`<div class="center-head"><h3>Spieltag ${last.day} · abgeschlossen</h3><a href="#accounting" class="ghost center-link">Zur BumsParade →</a></div>`;
  html+=`<div class="rank-cards">${
   card('SPIELTAGSSIEGER',winners.length?names(winners):'–',best===null?'':`${fmt(best)} Punkte`)}${
   card('LETZTER',losers.length?names(losers):'–',worst===null?'':`${fmt(worst)} Punkte${avg!==null?` · Schnitt ${fmt(Math.round(avg))}`:''}`)}${
   card('TABELLENFÜHRER',leaders.length?leaders.map(n=>mgrLink(n)).join(', '):'–',leaderScore==null?'':`${fmt(leaderScore)} Punkte${second?` · ${fmt(leaderScore-second.score)} vor ${mgrLink(second.name,escapeHtml(second.name))}`:''}`)}${
   moveCard}${benchCard(last.day,card)}${centerExtraCards(finished,card)}</div>`;

 }
 el.innerHTML=html;
 if(last)benchLoad(last.day);
 renderAccTodo();
 if(last&&centerAccounting.day==null)centerLoadAccounting(last.day);
}
document.addEventListener('change',async e=>{
 const pick=e.target.closest('select[data-todo-target]');
 if(pick&&centerAccounting.day&&!centerAccounting.probe){
  pick.disabled=true;const target=pick.value;
  try{const d=await api(`/api/todo-checks/${centerAccounting.day}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({key:pick.dataset.todoTarget,done:!!target,...(target?{target}:{})})});centerAccounting.checks=d.checks||{};bumsDerived.delete(centerAccounting.day);}
  catch(err){alert('Auswahl nicht gespeichert: '+err.message);}
  renderAccTodo();return;
 }
 const box=e.target.closest('input[data-todo-key]');if(!box||!centerAccounting.day||centerAccounting.probe)return;
 // Bei Regeln mit Auswahl (MM, DD, RK, BN, AH, TL) wird über die Auswahl abgehakt.
 if(box.closest('li')?.querySelector('select[data-todo-target][data-need]')&&box.checked){box.checked=false;box.closest('li').querySelector('select[data-need]').focus();return;}
 box.disabled=true;
 try{const d=await api(`/api/todo-checks/${centerAccounting.day}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({key:box.dataset.todoKey,done:box.checked})});centerAccounting.checks=d.checks||{};bumsDerived.delete(centerAccounting.day);}
 catch(err){box.checked=!box.checked;alert('Haken nicht gespeichert: '+err.message);}
 renderAccTodo();
});
// Strafe entfernen / wiederherstellen (Kevin-Wunsch), gespeichert in kbl-todo-checks.json, gilt auf allen Geräten.
document.addEventListener('click',async e=>{
 const rm=e.target.closest('[data-todo-remove]'),rs=e.target.closest('[data-todo-restore]');if((!rm&&!rs)||!centerAccounting.day||centerAccounting.probe)return;
 const key=(rm||rs).dataset.todoRemove||(rs||rm).dataset.todoRestore;
 if(rm&&!confirm('Diese Strafe entfernen? Sie zählt dann nicht mehr, auch nicht in der BumsTabelle. Du kannst sie wiederherstellen.'))return;
 (rm||rs).disabled=true;
 try{const d=await api(`/api/todo-checks/${centerAccounting.day}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(rm?{key,done:true,removed:true}:{key,done:false})});centerAccounting.checks=d.checks||{};bumsDerived.delete(centerAccounting.day);}
 catch(err){alert('Nicht gespeichert: '+err.message);}
 renderAccTodo();
});
document.addEventListener('click',e=>{if(e.target.closest('#centerRecheck')&&centerAccounting.day){if(centerAccounting.probe)$('#accountingProbe')?.click();else centerLoadAccounting(centerAccounting.day,true);}});

// Von Hand nachzutragen: bei DD welcher Spieler, bei RK, BN, AH und TL an wen (Manager oder Markt), bei MM wen er bestimmt hat.
const PICK_TO_RULES=['RK','BN','AH','TL','UM'];
const unclearKey=u=>`${u.rule}:${u.managerId}:${u.playerId}`;
function todoPlayer(t){const x=t.text||'',m=/bietet den MVP (.+) zum Verkauf an/.exec(x)||/gibt (.+) an einen Mitmanager ab/.exec(x)||/verkauft (.+?) \(/.exec(x)||/^verkauft (.+?) an den Markt/.exec(x)||/^gibt (.+?) an /.exec(x);return m?m[1]:(t.to||[])[0]?.playerName||null;}
function todoPick(t){if(t.rule==='MM')return 'mm';if(t.rule==='DD')return t.options?.length?'dd':null;if(PICK_TO_RULES.includes(t.rule))return 'to';return null;}
// Muss ausgewählt werden (nichts automatisch erkannt)? Sonst ist die Auswahl nur eine Korrektur.
function todoNeedsPick(t){const k=todoPick(t);return k==='mm'||k==='dd'&&!(t.to||[])[0]?.playerName||k==='to'&&!(t.to||[]).length&&t.check?.state!=='done';}
// KBL 4.16: BumsTabelle. Zählt je Spieltag die Bumsungen aus der BumsParade (Bumsung = von einer Regel betroffen,
// auch als Empfänger oder von MM Bestimmter) und summiert sie über die Halbserie.
function bumsCounts(d,checks){
 // Richtung je Bumsung: o = abgegeben (Spieler oder MM), i = bekommen (Spieler oder MM). Ältere Daten können noch x enthalten, das zählt als abgegeben.
 const out={},idOf=new Map((d.plausibility||[]).map(p=>[p.manager,String(p.managerId)]));
 const blank=name=>({name,count:0,rules:{},out:0,in:0,other:0,moves:[]});
 for(const p of (d.plausibility||[]))if(isEligibleManager(p.manager))out[String(p.managerId)]=blank(p.manager);
 const add=(mid,name,rule,dir,text)=>{mid=mid!=null&&mid!==''?String(mid):idOf.get(name);if(!mid||!/^\d+$/.test(mid)||!name||!isEligibleManager(name))return;
  const e=out[mid]||(out[mid]=blank(name));e.count++;e.rules[rule]=(e.rules[rule]||0)+1;e[dir==='o'?'out':dir==='i'?'in':'other']++;e.moves.push({r:rule,d:dir,t:String(text||'').slice(0,200)});};
 for(const t of (d.todos||[])){
  if(checks?.[t.key]?.removed)continue;
  const tgt=checks?.[t.key]?.target||null,pk=todoPick(t),pl=todoPlayer(t);
  let to=(t.to||[]).map(r=>({...r,playerName:pk==='dd'&&tgt?tgt:r.playerName}));
  if(pk==='to'&&tgt)to=tgt==='Markt'?[]:[{managerId:null,manager:tgt,playerName:pl}];
  const to0=to[0],moved=to0?.playerName&&['DD','AH','RK','BN','TL','UM'].includes(t.rule)?`${t.rule==='AH'||t.rule==='TL'?'verkauft':'gibt'} ${to0.playerName} an ${to.map(r=>r.manager).join(', ')}`:pk==='to'&&tgt==='Markt'?`verkauft ${pl||'den Spieler'} an den Markt`:null;
  const mmTo=t.rule==='MM'?tgt:null;
  add(t.managerId,t.manager,t.rule,'o',t.rule==='MM'?(mmTo?`verteilt MM an ${mmTo}`:'verteilt MM · Empfänger noch in der BumsParade auswählen'):(moved||t.text));
  if(t.rule!=='TL')for(const r of to)add(r.managerId,r.manager,t.rule,'i',`${recvVerb(t.rule)} ${r.playerName||'einen Spieler'} von ${t.manager}`);
  if(mmTo)add(null,mmTo,'MM','i',`bekommt MM von ${t.manager}: einen Spieler weniger aufstellen`);}
 for(const u of (d.autoEvents?.error?[]:(d.autoEvents?.unclear||[]))){const g=checks?.[unclearKey(u)]?.target,pn=u.playerName||'den Spieler';
  if(g==='Entfällt')continue;
  if(!g){add(u.managerId,u.manager,u.rule,'o',`unklar, bitte prüfen: ${u.reason||''}`);continue;}
  add(u.managerId,u.manager,u.rule,'o',g==='Markt'?`verkauft ${pn} an den Markt`:`gibt ${pn} an ${g}`);if(g!=='Markt')add(null,g,u.rule,'i',`${recvVerb(u.rule)} ${pn} von ${u.manager}`);}
 return out;
}
let bumsLastSaved='',bumsDays={};
// Hinweis im Spieltag-Auswahlfeld der BumsParade: welcher Spieltag schon vollständig abgerechnet ist.
function kblAccDayLabels(days){
 const sel=$('#accountingDay');if(!sel)return;const fin=new Set(historyData.filter(h=>h.status==='finished').map(h=>h.day));
 for(const o of sel.options){const n=Number(o.value),D=days?.[n],p=D?.progress;let tag='';
  if(D?.manual)tag=' · von Hand nachgetragen';
  else if(p)tag=p.done>=p.total&&!p.unclear?' · ✓ abgerechnet':` · ${p.total-p.done+p.unclear} offen`;
  else if(D)tag=' · bitte einmal öffnen';
  else if(fin.has(n))tag=' · noch nicht abgerechnet';
  o.textContent=`Spieltag ${n}${tag}`;}
}
function bumsSave(){
 const a=centerAccounting;if(a.probe||a.state!=='done'||!a.data?.ready||!a.data?.complete||a.data?.pendingCorrections||bumsDays[a.day]?.manual)return;
 const managers=bumsCounts(a.data,a.checks),todos=(a.data.todos||[]).filter(t=>!a.checks?.[t.key]?.removed);
 const progress={done:todos.filter(t=>t.check?.state==='done'||a.checks?.[t.key]?.done).length,total:todos.length,unclear:(a.data.autoEvents?.error?[]:(a.data.autoEvents?.unclear||[])).filter(u=>!a.checks?.[unclearKey(u)]?.target).length};
 const sig=a.day+JSON.stringify(managers)+JSON.stringify(progress);if(sig===bumsLastSaved)return;bumsLastSaved=sig;
 // Online (nur lesend): nichts speichern, aber Spieltag-Auswahl und BumsTabelle mit den neuen Haken neu rechnen (Kevin: stand „1 offen“ trotz 20 von 20).
 if(window.KBL_STATIC){bumsDays[a.day]={...(bumsDays[a.day]||{}),managers,progress,derived:true};bumsDerived.delete(a.day);try{kblAccDayLabels(bumsDays);}catch{}try{renderBumsTabelle();}catch{}return;}
 api(`/api/bumsungen/${a.day}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({managers,progress})}).then(()=>renderBumsTabelle()).catch(()=>{});
}
// Weitere Kacheln der BumsTabelle (einklappbar, Stil wie Ruhm & Schande). Gleichstände werden gemeinsam genannt.
let bumsDaysOpen=false,bumsStatsOpen=false,bumsTabOpen=false,bumsPairOpen=false,bumsPairWho='';
document.addEventListener('toggle',e=>{if(e.target.id==='bumsStats')bumsStatsOpen=e.target.open;if(e.target.id==='bumsTab')bumsTabOpen=e.target.open;if(e.target.id==='bumsPairs')bumsPairOpen=e.target.open;if(e.target.id==='bumsDays')bumsDaysOpen=e.target.open;},true);
function bumsStatsHtml(rows,hit,inHalf,days,RN){
 if(!hit.length)return '';
 const names=l=>l.map(x=>mgrName(x)).join(', ');
 const top=(list,val)=>{const m=Math.max(0,...list.map(val));return m>0?{m,who:list.filter(x=>val(x)===m)}:null;};
 const card=(title,t,unit,desc='')=>t?`<article class="hall-card shame"><div class="hall-title">${title}</div><div class="hall-value">${t.m}${unit}</div><div class="hall-desc">${names(t.who.map(x=>x.name))}${desc?' · '+desc:''}</div></article>`:'';
 const codes=Object.keys(RN).filter(k=>hit.some(r=>r.rules[k]));
 const ruleCards=codes.map(k=>card(`MEISTE ${k} · ${escapeHtml(RN[k]).toUpperCase()}`,top(hit,r=>r.rules[k]||0),'×'));
 const withDir=hit.filter(r=>r.out||r.in);
 const dirCards=withDir.length?[card('MEISTE ABGABEN',top(hit,r=>r.out),'×','Spieler oder MM abgegeben'),card('MEISTE EMPFÄNGE',top(hit,r=>r.in),'×','Spieler oder MM bekommen')]:[];
 // Schlimmster Einzelspieltag eines Managers und der Spieltag mit den meisten Bumsungen.
 let worst=null;for(const r of hit)for(const [d,n] of Object.entries(r.per))if(n>0&&(!worst||n>worst.m))worst={m:n,list:[]};
 if(worst)for(const r of hit)for(const [d,n] of Object.entries(r.per))if(n===worst.m)worst.list.push(`${r.name} (ST ${d})`);
 const dayTot=inHalf.map(d=>({d,n:Object.values(days[d].managers||{}).reduce((s,v)=>s+v.count,0)}));
 const maxDay=dayTot.length?Math.max(...dayTot.map(x=>x.n)):0;
 const extra=[
  worst?`<article class="hall-card shame"><div class="hall-title">SCHLIMMSTER SPIELTAG</div><div class="hall-value">${worst.m}×</div><div class="hall-desc">${names(worst.list)}</div></article>`:'',
  inHalf.length>1&&maxDay?`<article class="hall-card shame"><div class="hall-title">BUMS-REICHSTER SPIELTAG</div><div class="hall-value">${maxDay}</div><div class="hall-desc">Bumsungen an ST ${dayTot.filter(x=>x.n===maxDay).map(x=>x.d).join(', ')}</div></article>`:'',
  inHalf.length?`<article class="hall-card shame"><div class="hall-title">Ø BUMSUNGEN PRO SPIELTAG</div><div class="hall-value">${fmt(Math.round(dayTot.reduce((s,x)=>s+x.n,0)/inHalf.length*10)/10)}</div><div class="hall-desc">über ${inHalf.length} Spieltag${inHalf.length===1?'':'e'}</div></article>`:'',
  card('MEISTE VERSCHIEDENE REGELN',top(hit,r=>Object.keys(r.rules).length),'','verschiedene Regeln erwischt')];
 return `<details class="hall-section prof-sec bums-statsbox" id="bumsStats"${bumsStatsOpen?' open':''}><summary><h4>📊 STATISTIKEN JE REGEL</h4></summary><div class="hall-grid">${[...ruleCards,...dirCards,...extra].join('')}</div></details>`;
}
// Bei AH kauft der Empfaenger freiwillig (Kevin-Vorgabe), sonst bekommt er den Spieler.
function recvVerb(rule){return rule==='AH'?'kauft':'bekommt';}
// Wer bumst wen: aus den Empfänger-Einträgen („bekommt/kauft … von X“). Liga-Vorgabe: Wer abgibt (Spieler oder MM), bumst den Aufnehmenden.
function bumsPairsHtml(rows){
 // Kreuztabelle: Zeile bumst Spalte. Wer einen Spieler oder MM abgibt, bumst damit den, der ihn aufnimmt.
 const cnt=new Map(),rules=new Map(),key=(a,b)=>a+'\u0000'+b;
 for(const r of rows)for(const x of (r.moves||[])){
  if(x.d!=='i')continue;const m=/ von (.+?)(?::|$)/.exec(x.t||'');if(!m)continue;
  const by=m[1].trim(),on=r.name;if(!by||by===on)continue;
  const k=key(by,on);cnt.set(k,(cnt.get(k)||0)+1);const rr=rules.get(k)||{};rr[x.r]=(rr[x.r]||0)+1;rules.set(k,rr);}
 const open=bumsPairOpen?' open':'';
 const head=`<details class="hall-section prof-sec bums-statsbox" id="bumsPairs"${open}><summary><h4>⚔️ WER BUMST WEN</h4></summary>`;
 if(!cnt.size)return head+'<p class="muted">Noch keine Fälle mit Empfänger erfasst.</p></details>';
 const names=[...new Set([...rows.map(r=>r.name),...[...cnt.keys()].flatMap(k=>k.split('\u0000'))])].filter(n=>typeof isEligibleManager!=='function'||isEligibleManager(n)).sort((a,b)=>a.localeCompare(b,'de'));
 const max=Math.max(...cnt.values()),esc=escapeHtml;
 const given=n=>names.reduce((t,o)=>t+(cnt.get(key(n,o))||0),0),taken=n=>names.reduce((t,o)=>t+(cnt.get(key(o,n))||0),0);
 const th=names.map((n,c)=>`<th class="bx-col" data-c="${c}" title="${esc(n)}"><span>${esc(n)}</span>${mgrFace(n)}</th>`).join('');
 const body=names.map((a,r)=>`<tr><th class="bx-row" data-r="${r}">${mgrFace(a)}${esc(a)}</th>${names.map((b,c)=>{if(a===b)return `<td class="bx-self" data-r="${r}" data-c="${c}"></td>`;const v=cnt.get(key(a,b))||0;
   return `<td class="bx-cell${v?' hit':''}" data-r="${r}" data-c="${c}"${v?` data-a="${esc(a)}" data-b="${esc(b)}" data-n="${v}" data-rules="${esc(Object.entries(rules.get(key(a,b))).map(([k,n])=>n>1?`${k} ×${n}`:k).join(', '))}" style="--bx:${(.25+.75*v/max).toFixed(2)}" title="${esc(a)} hat ${esc(b)} ${v}× gebumst"`:''}>${v||''}</td>`;}).join('')}<td class="bx-sum">${given(a)||''}</td></tr>`).join('');
 const foot=`<tr><th class="bx-row" title="So oft wurde dieser Manager gebumst">Σ abbekommen</th>${names.map(n=>`<td class="bx-sum">${taken(n)||''}</td>`).join('')}<td class="bx-sum"></td></tr>`;
 return head+`<p class="muted tiny">Zeile bumst Spalte: Die Zahl sagt, wie oft der Manager links den Manager oben gebumst hat. Wer einen Spieler oder MM abgibt, bumst damit den, der ihn aufnimmt. Auf eine Zahl tippen zeigt die Regeln.</p>
 <div class="bx-wrap"><table class="bx"><thead><tr><th class="bx-corner">bumst ↓ / gebumst →</th>${th}<th class="bx-col bx-sumh"><span>Σ gebumst</span></th></tr></thead><tbody>${body}${foot}</tbody></table></div>
 <p class="muted bx-info" role="status">Auf eine Zahl tippen, um die Regeln zu sehen.</p></details>`;
}
document.addEventListener('click',e=>{const td=e.target.closest('.bx td');const box=e.target.closest('#bumsPairs');if(!box)return;const t=box.querySelector('.bx');if(!t)return;
 t.querySelectorAll('.on,.cross').forEach(el=>el.classList.remove('on','cross'));const info=box.querySelector('.bx-info');
 if(!td||!td.dataset.n){if(info)info.textContent='Auf eine Zahl tippen, um die Regeln zu sehen.';return;}
 const r=td.dataset.r,c=td.dataset.c;td.classList.add('on');t.querySelectorAll(`[data-r="${r}"],[data-c="${c}"]`).forEach(el=>el!==td&&el.classList.add('cross'));
 info.innerHTML=`<b>${escapeHtml(td.dataset.a)}</b> hat <b>${escapeHtml(td.dataset.b)}</b> ${td.dataset.n}× gebumst: `+td.dataset.rules.split(', ').map(x=>{const k=x.split(' ')[0];return `<span class="bums-rule bums-r-${escapeHtml(k)}" data-rule="${escapeHtml(k)}" role="link" tabindex="0" title="Zur Regel">${escapeHtml(x)}</span>`;}).join(' ');});
document.addEventListener('change',e=>{if(e.target.id==='bumsPairWho'){bumsPairWho=e.target.value;renderBumsTabelle();}});
// Jeder Spieltag einzeln: wer war betroffen, nach welcher Regel, wer gab an wen ab, automatisch oder von Hand.
function bumsDaysHtml(days,inHalf,RN){
 const esc=escapeHtml,DIRL={o:'↑',i:'↓',x:'↑'};
 const chip=k=>`<span class="bums-rule bums-r-${esc(k)}" data-rule="${esc(k)}" role="link" tabindex="0" title="${esc(RN[k]||k)}: zur Regel">${esc(k)}</span>`;
 const items=inHalf.slice().reverse().map(d=>{const D=days[d]||{},ms=Object.values(D.managers||{}).filter(v=>v.count>0).sort((a,b)=>b.count-a.count||a.name.localeCompare(b.name,'de'));
  const sum=ms.reduce((t,v)=>t+v.count,0),rules={};ms.forEach(v=>Object.entries(v.rules||{}).forEach(([k,n])=>rules[k]=(rules[k]||0)+n));
  const when=D.savedAt?new Date(D.savedAt).toLocaleString('de-DE',{day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'}):'';
  const src=D.manual?'von Hand nachgetragen':'automatisch aus der BumsParade';
  const body=ms.length?ms.map(v=>{const mv=(v.moves||[]);
    return `<div class="bd-man"><div class="bd-head"><b>${mgrName(v.name)}</b> <span class="bums-num-s">${v.count}×</span> ${Object.entries(v.rules||{}).map(([k,n])=>chip(k)+(n>1?`<b class="muted"> ×${n}</b>`:'')).join(' ')}</div>${mv.length?`<ul>${mv.map(x=>`<li class="bums-mv-${x.d==='i'?'i':'o'}"><b>${DIRL[x.d]||'•'}</b> ${chip(x.r)} ${esc(x.t||'')}</li>`).join('')}</ul>`:`<p class="muted tiny">${D.manual?'Von Hand eingetragen, ohne Angabe wer an wen.':'Keine Einzelheiten gespeichert.'}</p>`}</div>`;}).join(''):'<p class="muted">An diesem Spieltag gab es keine Bumsung.</p>';
  return `<details class="bd-day"><summary><b>ST ${d}</b><span>${sum} Bumsung${sum===1?'':'en'}</span><span class="bd-rules">${Object.keys(rules).map(k=>`<span class="bums-rule bums-r-${esc(k)}">${esc(k)}</span>`).join('')}</span><span class="muted tiny">${src}${when?' · '+esc(when):''}</span></summary><div class="bd-body">${body}${D.manual?'':`<p><button type="button" class="ghost bd-open" data-bums-day="${d}">In der BumsParade öffnen</button></p>`}</div></details>`;}).join('');
 return `<details class="hall-section prof-sec bums-statsbox" id="bumsDays"${bumsDaysOpen?' open':''}><summary><h4>🗓️ SPIELTAGE</h4></summary><p class="muted tiny">Jeder Spieltag einzeln zum Nachvollziehen: wer betroffen war, nach welcher Regel und wer an wen abgegeben hat. ↑ = abgegeben (bumst), ↓ = bekommen (gebumst).</p>${items||'<p class="muted">Noch keine Spieltage erfasst.</p>'}</details>`;
}
document.addEventListener('click',e=>{const b=e.target.closest('.bd-open');if(!b)return;const d=b.dataset.bumsDay;location.hash='#accounting';setTimeout(()=>{const s=$('#accountingDay');if(s&&[...s.options].some(o=>o.value===d)){s.value=d;s.dispatchEvent(new Event('change',{bubbles:true}));}},150);});
// Online-Seite (nur lesend, Kevin-Meldung ST 1 „bitte einmal öffnen“): Die gespeicherte BumsTabelle kommt vom PC und kann
// älter sein als der heutige Rechenstand. Darum rechnet die Seite je abgeschlossenem Spieltag aus der exportierten Abrechnung
// und den Haken dasselbe nach wie bumsSave am PC. Von Hand nachgetragene Spieltage bleiben unverändert.
const bumsDerived=new Map();
async function bumsStaticDerive(days){
 const fin=historyData.filter(h=>h.status==='finished').map(h=>h.day);
 await Promise.all(fin.filter(d=>!days[d]?.manual).map(async day=>{
  if(!bumsDerived.has(day))bumsDerived.set(day,(async()=>{
   const [d,c]=await Promise.all([api(`/api/rule-accounting/${day}`),api(`/api/todo-checks/${day}`).catch(()=>({checks:{}}))]);
   if(!d?.ready||!d?.complete||d?.pendingCorrections)return null;
   const checks=c.checks||{},todos=(d.todos||[]).filter(t=>!checks[t.key]?.removed);
   const progress={done:todos.filter(t=>t.check?.state==='done'||checks[t.key]?.done).length,total:todos.length,unclear:(d.autoEvents?.error?[]:(d.autoEvents?.unclear||[])).filter(u=>!checks[unclearKey(u)]?.target).length};
   return {managers:bumsCounts(d,checks),progress};})().catch(()=>null));
  const r=await bumsDerived.get(day);if(r)days[day]={...(days[day]||{}),...r,derived:true};}));
}
async function renderBumsTabelle(){
 const el=$('#bumsTable');if(!el||!currentLeague)return;
 let days;try{days=bumsDays=(await api('/api/bumsungen')).days||{};}catch(e){el.innerHTML=`<p class="error">BumsTabelle nicht abrufbar: ${escapeHtml(e.message)}</p>`;return;}
 if(window.KBL_STATIC)try{await bumsStaticDerive(days);}catch{}
 try{kblAccDayLabels(days);}catch{}
 try{showProfile();}catch{}try{renderPreview();}catch{}
 const finished=historyData.filter(h=>h.status==='finished').map(h=>h.day);
 const ref=Math.max(0,...finished,...Object.keys(days).map(Number));
 if(!ref){el.innerHTML='<p class="muted">Noch kein Spieltag abgeschlossen.</p>';return;}
 const from=ref<=17?1:18,to=ref<=17?17:34;
 const inHalf=Object.keys(days).map(Number).filter(d=>d>=from&&d<=to).sort((a,b)=>a-b);
 const missing=finished.filter(d=>d>=from&&d<=to&&!days[d]).sort((a,b)=>a-b);
 const tot=new Map();
 for(const d of inHalf)for(const [mid,v] of Object.entries(days[d].managers||{})){
  const e=tot.get(mid)||{name:v.name,count:0,rules:{},per:{},out:0,in:0,other:0,moves:[],noDir:0};e.name=v.name;e.count+=v.count;e.per[d]=v.count;
  if(v.out===undefined)e.noDir+=v.count;else{e.out+=v.out+(v.other||0);e.in+=v.in||0;for(const x of (v.moves||[]))e.moves.push({...x,d:x.d==='x'?'o':x.d,day:d});}
  for(const [r,n] of Object.entries(v.rules||{}))e.rules[r]=(e.rules[r]||0)+n;tot.set(mid,e);}
 const rows=[...tot.values()].sort((a,b)=>b.count-a.count||a.name.localeCompare(b.name,'de'));
 const RN={BD:'Besoffener Davies',DD:'Dämonische Drehtür',MM:'Magic Miyoshi',AH:'Angeschossener Höler',RK:'Räudiger Kohr',BN:'Blinder Niklas',UM:'Upamaguire',EZ:'Einzelfallentscheidung',TL:'Teamlimit'};
 const chips=r=>Object.entries(r).sort((a,b)=>b[1]-a[1]||a[0].localeCompare(b[0])).map(([k,n])=>`<span class="bums-rule bums-r-${escapeHtml(k)}" data-rule="${escapeHtml(k)}" role="link" tabindex="0" title="${escapeHtml(RN[k]||k)}: zur Regel">${escapeHtml(k)}${n>1?` <b>×${n}</b>`:''}</span>`).join('');
 const top=rows.length?rows[0].count:0,rankOf=r=>1+rows.filter(x=>x.count>r.count).length;
 const hit=rows.filter(r=>r.count>0),clean=rows.filter(r=>r.count===0);
 bumsIntroData={hit:hit.map(r=>({name:r.name,count:r.count,rules:r.rules,out:r.out,in:r.in})),clean:clean.map(r=>r.name),half:from===1?'Hinrunde':'Rückrunde',RN};
 const total=hit.reduce((s,r)=>s+r.count,0),ruleTot={};for(const r of hit)for(const [k,n] of Object.entries(r.rules))ruleTot[k]=(ruleTot[k]||0)+n;
 const topRule=Object.entries(ruleTot).sort((a,b)=>b[1]-a[1])[0];
 const medal=['🥇','🥈','🥉'],podRanks=[...new Set(hit.map(rankOf))].filter(x=>x<=3);
 const podium=podRanks.map(rk=>{const g=hit.filter(r=>rankOf(r)===rk);return `<div class="bums-pod bums-pod-${rk}"><div class="bums-pod-medal">${medal[rk-1]} Platz ${rk}</div><div class="bums-pod-names">${g.map(r=>mgrName(r.name)).join('<br>')}</div><div class="bums-pod-count">${g[0].count}<small> Bumsung${g[0].count===1?'':'en'}</small></div></div>`;}).join('');
 const DIRL={o:'↑',i:'↓',x:'•'};
 const dirLine=r=>{const parts=[r.out?`<span class="bums-out">↑ ${r.out} abgegeben</span>`:'',r.in?`<span class="bums-in">↓ ${r.in} bekommen</span>`:''].filter(Boolean).join('');
  if(!parts)return '';
  if(!r.moves.length)return `<div class="bums-dir">${parts}</div>`;
  return `<details class="bums-dir"><summary>${parts}</summary><ul>${r.moves.map(x=>`<li class="bums-mv-${x.d}"><b>${DIRL[x.d]}</b> <span class="bums-rule bums-r-${escapeHtml(x.r)}" data-rule="${escapeHtml(x.r)}" role="link" tabindex="0" title="Zur Regel">${escapeHtml(x.r)}</span> ${inHalf.length>1?`<span class="muted">ST ${x.day}:</span> `:''}${escapeHtml(x.t)}</li>`).join('')}</ul></details>`;};
 const perDay=r=>inHalf.length>1?`<div class="bums-perday">${inHalf.map(d=>`<span${r.per[d]?'':' class="zero"'}>ST ${d}: ${r.per[d]??0}</span>`).join('')}</div>`:'';
 const list=hit.map(r=>`<div class="bums-row${rankOf(r)===1?' first':''}" data-bums-name="${escapeHtml(r.name)}"><span class="bums-rank">${rankOf(r)}</span><div class="bums-who"><b>${mgrName(r.name)}</b><div class="bums-rules">${chips(r.rules)}</div>${perDay(r)}</div><div class="bums-bar"><i style="width:${top?Math.round(r.count/top*100):0}%"></i></div><span class="bums-num">${r.count}</span>${dirLine(r)}</div>`).join('');
 const legend=Object.keys(ruleTot).sort((a,b)=>ruleTot[b]-ruleTot[a]).map(k=>`<span><span class="bums-rule bums-r-${escapeHtml(k)}" data-rule="${escapeHtml(k)}" role="link" tabindex="0" title="Zur Regel">${escapeHtml(k)}</span> ${escapeHtml(RN[k]||k)} <span class="muted">${ruleTot[k]}×</span></span>`).join('');
 el.innerHTML=(hit.length?`<div class="bums-stats"><div><small>Bumsungen gesamt</small><strong>${total}</strong></div><div><small>Häufigste Regel</small><strong>${topRule?escapeHtml(RN[topRule[0]]||topRule[0]):'–'}</strong><span class="muted tiny">${topRule?topRule[1]+'×':''}</span></div><div><small>Weiße Weste</small><strong>${clean.length}</strong><span class="muted tiny">Manager ohne Bumsung</span></div></div>`+
  `<details class="hall-section prof-sec bums-statsbox" id="bumsTab"${bumsTabOpen?' open':''}><summary><h4>📋 TABELLE</h4></summary><div class="bums-podium">${podium}</div><div class="bums-list">${list}</div>`+
  (clean.length?`<p class="bums-clean"><b>😇 Weiße Weste:</b> ${clean.map(r=>escapeHtml(r.name)).join(', ')}</p>`:'')+
  `<div class="bums-legend">${legend}</div></details>${bumsDaysHtml(days,inHalf,RN)}${bumsStatsHtml(rows,hit,inHalf,days,RN)}${bumsPairsHtml(rows)}`:'<p class="muted">Noch keine Bumsungen erfasst.</p>')+
  `<p class="muted tiny">${inHalf.some(d=>days[d].manual)?`Von Hand nachgetragen: ST ${inHalf.filter(d=>days[d].manual).join(', ')}. `:''}${from===1?'Hinrunde':'Rückrunde'} · ${inHalf.length} von ${finished.filter(d=>d>=from&&d<=to).length} abgeschlossenen Spieltagen erfasst. Übernommen wird automatisch, sobald ein Spieltag in der BumsParade vollständig geprüft ist. Vorläufig: Ändert sich dort etwas, zieht die Tabelle nach.</p>`+
  (missing.length?`<p><button type="button" class="ghost" id="bumsFill">Fehlende Spieltage nachholen (ST ${missing.join(', ')})</button> <span class="muted tiny" id="bumsFillMsg"></span></p>`:'');
 kblBumsIntroTry();
}
document.addEventListener('click',async e=>{
 const b=e.target.closest('#bumsFill');if(!b)return;
 const msg=$('#bumsFillMsg');b.disabled=true;
 const days=(b.textContent.match(/ST ([\d, ]+)/)?.[1]||'').split(',').map(x=>Number(x.trim())).filter(Boolean);
 let ok=0;const fail=[];
 for(const day of days){msg.textContent=`Prüfe Spieltag ${day} …`;
  try{const [d,c]=await Promise.all([api(`/api/rule-accounting/${day}`),api(`/api/todo-checks/${day}`).catch(()=>({checks:{}}))]);
   if(!d.ready||!d.complete||d.pendingCorrections){fail.push(day);continue;}
   await api(`/api/bumsungen/${day}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({managers:bumsCounts(d,c.checks||{})})});ok++;}
  catch(err){fail.push(day);}}
 await renderBumsTabelle();
 const m2=$('#bumsFillMsg');if(m2)m2.textContent=`${ok} Spieltag${ok===1?'':'e'} übernommen.${fail.length?` Nicht möglich (Aufstellungen oder Punkte fehlen): ST ${fail.join(', ')}.`:''}`;
});
// BumsTabelle von Hand nachtragen (für Spieltage ohne gespeicherte Aufstellungen, z. B. ST 1–5).
// Eingabe je Manager als Kürzel, z. B. "BD BD UM". Von Hand gespeicherte Spieltage überschreibt die Automatik nicht.
const BUMS_CODES=['BD','DD','MM','AH','RK','BN','UM','EZ','TL'];
function bumsManualManagers(){
 const m=new Map();for(const d of Object.values(bumsDays))for(const [id,v] of Object.entries(d.managers||{}))if(isEligibleManager(v.name))m.set(id,v.name);
 return [...m].sort((a,b)=>a[1].localeCompare(b[1],'de'));
}
const BUMS_NAMES={BD:'Besoffener Davies',DD:'Dämonische Drehtür',MM:'Magic Miyoshi',AH:'Angeschossener Höler',RK:'Räudiger Kohr',BN:'Blinder Niklas',UM:'Upamaguire',EZ:'Einzelfallentscheidung',TL:'Teamlimit'};
function bumsManualCell(id,name,codes){
 return `<div class="bums-mrow" data-bums-mid="${escapeHtml(id)}" data-bums-name="${escapeHtml(name)}" data-codes="${escapeHtml(codes.join(' '))}"><span class="bums-mname">${mgrName(name,'',id)}</span><span class="bums-mchips">${codes.map((c,i)=>`<button type="button" class="bums-rule bums-r-${escapeHtml(c)} bums-mdel" data-del="${i}" title="${escapeHtml(BUMS_NAMES[c]||c)} entfernen">${escapeHtml(c)} ✕</button>`).join('')||'<span class="muted tiny">keine</span>'}</span><select class="bums-madd" aria-label="Regel hinzufügen für ${escapeHtml(name)}"><option value="">+ Regel</option>${BUMS_CODES.map(c=>`<option value="${c}">${c} · ${escapeHtml(BUMS_NAMES[c])}</option>`).join('')}</select></div>`;
}
function bumsManualRender(){
 const box=$('#bumsManual');if(!box)return;const day=Number($('#bumsManualDay')?.value||0);
 const list=bumsManualManagers();
 if(!list.length){box.innerHTML='<p class="muted tiny">Erst nötig: ein automatisch geprüfter Spieltag, damit die Manager bekannt sind.</p>';return;}
 const cur=bumsDays[day]?.managers||{};
 const codes=id=>Object.entries(cur[id]?.rules||{}).flatMap(([k,n])=>Array(n).fill(k));
 box.innerHTML=`${bumsDays[day]&&!bumsDays[day].manual?'<p class="error tiny">Dieser Spieltag wurde automatisch aus der BumsParade übernommen. Speichern ersetzt ihn durch deine Eingabe.</p>':''}<div class="bums-manual-grid">${list.map(([id,name])=>bumsManualCell(id,name,codes(id))).join('')}</div>
 <p class="muted tiny">Zweimal betroffen = Regel zweimal auswählen. Empfänger und Bestimmer bei MM auch eintragen. Tippen auf ein Kürzel entfernt es wieder.</p>
 <button type="button" class="gold" id="bumsManualSave">Spieltag ${day} speichern</button> <span class="tiny" id="bumsManualMsg" role="status"></span>`;
}
function bumsManualSet(row,codes){const tmp=document.createElement('div');tmp.innerHTML=bumsManualCell(row.dataset.bumsMid,row.dataset.bumsName,codes);row.replaceWith(tmp.firstElementChild);}
document.addEventListener('change',e=>{const s=e.target.closest('.bums-madd');if(!s||!s.value)return;const row=s.closest('.bums-mrow');bumsManualSet(row,[...row.dataset.codes.split(' ').filter(Boolean),s.value]);});
document.addEventListener('click',e=>{const d=e.target.closest('.bums-mdel');if(!d)return;const row=d.closest('.bums-mrow'),c=row.dataset.codes.split(' ').filter(Boolean);c.splice(Number(d.dataset.del),1);bumsManualSet(row,c);});
document.addEventListener('change',e=>{if(e.target.id==='bumsManualDay')bumsManualRender();});
document.addEventListener('toggle',e=>{if(e.target.id==='bumsManualBox'&&e.target.open){const sel=$('#bumsManualDay');
 const fin=historyData.filter(h=>h.status==='finished').map(h=>h.day).sort((a,b)=>a-b);
 const pick=fin.find(d=>!bumsDays[d])||fin[0]||1;
 sel.innerHTML=fin.map(d=>`<option value="${d}"${d===pick?' selected':''}>Spieltag ${d}${bumsDays[d]?(bumsDays[d].manual?' · von Hand':' · automatisch'):' · fehlt'}</option>`).join('');bumsManualRender();}},true);
document.addEventListener('click',async e=>{
 const b=e.target.closest('#bumsManualSave');if(!b)return;
 const day=Number($('#bumsManualDay').value),msg=$('#bumsManualMsg'),managers={},bad=[];
 for(const inp of document.querySelectorAll('#bumsManual [data-bums-mid]')){
  const codes=inp.dataset.codes.split(' ').filter(Boolean),rules={};
  for(const c of codes){if(!BUMS_CODES.includes(c)){bad.push(`${inp.dataset.bumsName}: ${c}`);continue;}rules[c]=(rules[c]||0)+1;}
  managers[inp.dataset.bumsMid]={name:inp.dataset.bumsName,count:Object.values(rules).reduce((s,n)=>s+n,0),rules};
 }
 if(bad.length){msg.className='tiny error';msg.textContent='Unbekanntes Kürzel: '+bad.join(', ');return;}
 b.disabled=true;msg.className='tiny muted';msg.textContent='Speichere …';
 try{await api(`/api/bumsungen/${day}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({managers,manual:true})});
  await renderBumsTabelle();const m2=$('#bumsManualMsg');if(m2){m2.className='tiny';m2.textContent=`Spieltag ${day} gespeichert.`;}
  const opt=$(`#bumsManualDay option[value="${day}"]`);if(opt)opt.textContent=`Spieltag ${day} · von Hand`;}
 catch(err){msg.className='tiny error';msg.textContent='Nicht gespeichert: '+err.message;}
 b.disabled=false;
});
// Klick auf ein Regel-Kürzel springt in den Reiter „Regeln“ und klappt genau diese Regel auf.
function kblOpenRule(code){
 if(location.hash!=='#rules')location.hash='#rules';
 setTimeout(()=>{const d=document.getElementById('regel-'+code);if(!d)return;d.open=true;d.scrollIntoView({behavior:'smooth',block:'start'});},80);
}
document.addEventListener('click',e=>{const c=e.target.closest('[data-rule]');if(c)kblOpenRule(c.dataset.rule);});
document.addEventListener('keydown',e=>{const c=e.target.closest?.('[data-rule]');if(c&&(e.key==='Enter'||e.key===' ')){e.preventDefault();kblOpenRule(c.dataset.rule);}});
onConnected.push(renderBumsTabelle);
['focus','mousedown','touchstart'].forEach(ev=>$('#accountingDay')?.addEventListener(ev,()=>{try{kblAccDayLabels(bumsDays);}catch{}},{passive:true}));
document.querySelectorAll('[data-kbl-nav="penalties"]').forEach(a=>a.addEventListener('click',()=>renderBumsTabelle()));

// BumsTabelle: Beim Öffnen des Reiters fliegen einzelne Statistiken durchs Bild (Kevin-Wunsch: meiste BD usw.),
// der Bumskönig zum Schluss groß in der Mitte. Antippen, Esc oder Scrollen überspringt.
let bumsIntroData=null,bumsIntroPending=false,bumsIntroSkipOnce=false;
function kblBumsIntroTry(){
 if(!bumsIntroPending||!bumsIntroData)return;
 if(!document.querySelector('.kbl-view[data-view="penalties"]')?.classList.contains('kbl-current')){bumsIntroPending=false;return;}
 bumsIntroPending=false;
 if(!bumsIntroData.hit.length||matchMedia('(prefers-reduced-motion: reduce)').matches||!Element.prototype.animate)return;
 kblBumsIntro(bumsIntroData);
}
function kblBumsIntro({hit,clean,half,RN}){
 document.querySelector('.bums-intro')?.remove();
 // Einzelne Statistiken: je Regel der Spitzenreiter (häufigste Regeln zuerst, max. 4), meiste abgegeben/bekommen, zum Schluss der Bumskönig.
 const best=f=>{const m=Math.max(0,...hit.map(f));return m?{n:m,who:hit.filter(r=>f(r)===m).map(r=>r.name)}:null;};
 const ruleTot={};for(const r of hit)for(const [k,n] of Object.entries(r.rules||{}))ruleTot[k]=(ruleTot[k]||0)+n;
 const cards=[];
 for(const k of Object.keys(ruleTot).filter(k=>k!=='EZ').sort((a,b)=>ruleTot[b]-ruleTot[a]).slice(0,4)){const x=best(r=>r.rules?.[k]||0);if(x)cards.push({emo:'🎯',title:`Meiste ${k}`,sub:RN[k]||k,...x,unit:'×'});}
 const o=best(r=>r.out||0);if(o)cards.push({emo:'📤',title:'Meiste abgegeben',...o,unit:'×'});
 const i=best(r=>r.in||0);if(i)cards.push({emo:'📥',title:'Meiste bekommen',...i,unit:'×'});
 const king={...best(r=>r.count)};
 const ov=document.createElement('div');ov.className='bums-intro';ov.setAttribute('aria-hidden','true');
 ov.innerHTML=`<div class="bums-intro-title">💥 BumsTabelle<small>${escapeHtml(half)}</small></div><div class="bums-intro-skip">Antippen zum Überspringen</div>`;
 document.body.appendChild(ov);
 let done=false;const timers=[];
 const end=()=>{if(done)return;done=true;timers.forEach(clearTimeout);removeEventListener('keydown',key);removeEventListener('wheel',end);
  ov.animate([{opacity:1},{opacity:0}],{duration:350,fill:'forwards'}).onfinish=()=>ov.remove();};
 const key=e=>{if(e.key==='Escape')end();};
 ov.addEventListener('click',end);addEventListener('keydown',key);addEventListener('wheel',end,{passive:true});
 ov.animate([{opacity:0},{opacity:1}],{duration:300,fill:'forwards'});
 ov.querySelector('.bums-intro-title').animate([{transform:'scale(.4) rotate(-8deg)',opacity:0},{transform:'scale(1.12) rotate(2deg)',opacity:1,offset:.6},{transform:'scale(1) rotate(0)',opacity:1}],{duration:600,easing:'ease-out',fill:'forwards'});
 const names=w=>w.map(n=>mgrName(n)).join('<br>');
 // Kevin-Vorgabe: je Welle 3 Karten gleichzeitig, verstreut übers Bild und leicht schräg hängend;
 // weich hereinschweben (0,8 s), 3 s stehen, hinaus.
 const per=3,step=4000,wide=matchMedia('(min-width:760px)').matches,waves=Math.ceil(cards.length/per);
 const SLOTS=wide?[[[24,44,-5],[52,68,4],[78,42,-3]],[[27,68,4],[50,42,-4],[75,66,6]]]
  :[[[45,30,-5],[56,53,4],[44,77,-3]],[[55,30,4],[44,53,-4],[56,77,5]]];
 const FROM=[[-130,-30],[20,120],[130,-25],[-120,40],[-15,-120],[125,35]];
 cards.forEach((c,idx)=>{const w=Math.floor(idx/per),j=idx%per;
  timers.push(setTimeout(()=>{if(done)return;
  const el=document.createElement('div');el.className='bums-intro-card';
  el.innerHTML=`<small>${c.emo} ${escapeHtml(c.title)}</small>${c.sub?`<em>${escapeHtml(c.sub)}</em>`:''}<b>${c.who.map(n=>`<i class="bi-n">${mgrName(n)}</i>`).join(', ')}</b><span>${c.n}${c.unit}</span>`;
  const [l,t,rot]=SLOTS[w%2][j],[fx,fy]=FROM[idx%FROM.length];
  el.style.left=l+'%';el.style.top=t+'%';
  ov.appendChild(el);
  const at=(x,y,r,sc=1)=>`translate(calc(-50% + ${x}vw),calc(-50% + ${y}vh)) rotate(${r}deg) scale(${sc})`;
  el.animate([
   {transform:at(fx,fy,rot*5,.7),opacity:0,easing:'cubic-bezier(.16,1,.3,1)'},
   {transform:at(0,0,rot),opacity:1,offset:.2},
   {transform:at(0,-1,rot*.6),offset:.55,easing:'ease-in-out'},
   {transform:at(0,0,rot),opacity:1,offset:.86,easing:'cubic-bezier(.5,0,.75,0)'},
   {transform:at(-fx*.8,-fy*.4+30,rot*-4,.8),opacity:0}],
   {duration:4400,fill:'forwards'}).onfinish=()=>el.remove();
 },500+w*step+j*180));});
 const cardsEnd=waves?waves*step+300:0;
 timers.push(setTimeout(()=>{if(done)return;
  const k=document.createElement('div');k.className='bums-intro-king';
  k.innerHTML=`<div class="bums-intro-crown">👑</div><div class="bums-intro-kname">${names(king.who)}</div><div class="bums-intro-kcount">${king.n}× gebumst</div><small>${king.who.length>1?'Die Bumskönige':'Bumskönig'} der ${escapeHtml(half)}</small>`+
   (clean.length?`<div class="bums-intro-clean">😇 Weiße Weste: ${clean.map(n=>mgrName(n)).join(', ')}</div>`:'');
  ov.appendChild(k);
  k.animate([{transform:'translate(-50%,-50%) scale(.1) rotate(-25deg)',opacity:0},{transform:'translate(-50%,-50%) scale(1.15) rotate(4deg)',opacity:1,offset:.55},{transform:'translate(-50%,-50%) scale(.96) rotate(-2deg)',offset:.8},{transform:'translate(-50%,-50%) scale(1) rotate(0)',opacity:1}],{duration:800,easing:'ease-out',fill:'forwards'});
  k.querySelector('.bums-intro-crown').animate([{transform:'translateY(-30px)'},{transform:'translateY(0)'},{transform:'translateY(-8px)'},{transform:'translateY(0)'}],{duration:900,delay:500,easing:'ease-out'});
  timers.push(setTimeout(end,2600));
 },500+cardsEnd));
}

// Übersicht und Tabelle & Spieltage: Bereiche per Klick auf die Überschrift ein- und ausklappen.
(function(){
 for(const id of ['preview','overview','bericht','stats','table','rankHistory','progressPanel']){
  const sec=document.getElementById(id),head=sec?.querySelector(':scope>.sectionhead');if(!head)continue;
  const fold=v=>{sec.classList.toggle('kbl-folded',v);head.setAttribute('aria-expanded',String(!v));};
  fold(true);
  head.classList.add('kbl-foldhead');head.setAttribute('role','button');head.tabIndex=0;
  const toggle=()=>{fold(!sec.classList.contains('kbl-folded'));if(id==='progressPanel'&&!sec.classList.contains('kbl-folded'))renderProgressChart();};
  head.addEventListener('click',e=>{if(!e.target.closest('a,button,select,input'))toggle();});
  head.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();toggle();}});
 }
})();
// Feste Regel (Liga-Vorgabe): Beim Öffnen eines Reiters ist jeder einklappbare Bereich zu.
// Die Punkteübersicht regelt das selbst.
window.kblCollapseView=view=>{
 if(view==='points')return;
 const root=document.querySelector(`.kbl-view[data-view="${view}"]`);if(!root)return;
 root.querySelectorAll('details[open]:not(.kbl-keep-open)').forEach(d=>{d.open=false;});
 root.querySelectorAll('.kbl-foldhead').forEach(h=>{h.parentElement.classList.add('kbl-folded');h.setAttribute('aria-expanded','false');});
 if(view==='accounting'){accTodoOpen=false;accLiveOpen=false;accRadarOpen=true;accLiveLoad();}
 if(view==='profiles')profOpen.clear();
 if(view==='penalties'){bumsDaysOpen=false;bumsStatsOpen=false;bumsTabOpen=false;bumsPairOpen=false;bumsIntroPending=!bumsIntroSkipOnce;bumsIntroSkipOnce=false;setTimeout(kblBumsIntroTry,0);}
 else document.querySelector('.bums-intro')?.remove();
};

// Managerprofil: Kachel „Bumsungen“ führt zur BumsTabelle und zeigt die Zeile des Managers.
function kblBumsFocus(name){const tab=$('#bumsTab');if(!tab)return false;tab.open=true;bumsTabOpen=true;
 const row=[...document.querySelectorAll('#bumsTable .bums-row')].find(r=>r.dataset.bumsName===name);
 if(row){row.querySelector('details.bums-dir')?.setAttribute('open','');row.classList.add('bums-focus');row.scrollIntoView({behavior:'smooth',block:'center'});setTimeout(()=>row.classList.remove('bums-focus'),3000);}
 else tab.scrollIntoView({behavior:'smooth',block:'start'});return true;}
function kblBumsGoto(el){const n=el.dataset.bumsGoto;bumsIntroSkipOnce=location.hash!=='#penalties';location.hash='#penalties';let tries=0;const go=()=>{if(!kblBumsFocus(n)&&++tries<15)setTimeout(go,300);};setTimeout(go,250);}
document.addEventListener('click',e=>{const t=e.target.closest('[data-bums-goto]');if(t)kblBumsGoto(t);});
document.addEventListener('keydown',e=>{const t=e.target.closest?.('[data-bums-goto]');if(t&&(e.key==='Enter'||e.key===' ')){e.preventDefault();kblBumsGoto(t);}});

// Spieltagsvorschau (Übersicht, erste Kategorie): Countdown bis zum ersten Anstoß des nächsten Spieltags
// und Fragen-Kacheln aus den geladenen Daten (nur abgeschlossene Spieltage und BumsTabelle, keine weiteren Kickbase-Abfragen).
let pvStatus=null,pvTarget=null;
// Spieltag fuer die LIVE-Anzeigen: laeuft laut OpenLigaDB, oder alle Spiele sind vorbei, aber Kickbase hat ihn noch nicht
// abgeschlossen (Ranking il = true, meist bis zum Abend nach dem letzten Spiel). Dann bleibt alles LIVE (Kevin-Wunsch), closing = true.
function kblLiveDay(st=pvStatus){
 const days=st?.days||[],l=days.find(d=>d.status==='live');if(l)return l;
 const f=days.find(d=>d.day===Number(st?.lastFinishedDay));
 return f&&historyData.some(h=>h.day===f.day&&h.status==='live')?{...f,closing:true}:null;
}
async function pvLoadStatus(){try{pvStatus=await api('/api/matchday-status');}catch{pvStatus=pvStatus||{error:true};}renderPreview();}
onConnected.push(pvLoadStatus);setInterval(()=>{if(currentLeague&&!document.hidden)pvLoadStatus();},900000);
function pvKickoff(d){
 if(d?.firstKickoffUTC)return {t:Date.parse(d.firstKickoffUTC),match:d.firstMatch||''};
 const u=(d?.unfinished||[]).map(g=>({t:Date.parse(g.kickoffUTC),match:g.match})).filter(g=>Number.isFinite(g.t)).sort((a,b)=>a.t-b.t)[0];
 return u||null;
}
const pvDate=t=>new Intl.DateTimeFormat('de-DE',{timeZone:'Europe/Berlin',weekday:'short',day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'}).format(new Date(t))+' Uhr';
function pvTick(){
 const box=$('#pvCountdown'),pill=$('#previewPill');if(!pvTarget)return;
 const left=pvTarget.t-Date.now();
 if(left<=0){if(box)box.innerHTML=`<div class="pv-kickoff">⚽ Anpfiff! Spieltag ${pvTarget.day} läuft.</div>`;if(pill)pill.textContent=`Spieltag ${pvTarget.day} läuft`;pvTarget=null;return;}
 const s=Math.floor(left/1000),parts=[[Math.floor(s/86400),'Tage'],[Math.floor(s/3600)%24,'Std'],[Math.floor(s/60)%60,'Min'],[s%60,'Sek']];
 if(box)parts.forEach(([v],i)=>{const el=box.querySelector(`[data-pv="${i}"]`);if(el)el.textContent=String(v).padStart(2,'0');});
 if(pill)pill.textContent=`Spieltag ${pvTarget.day} · Anstoß in ${parts[0][0]?parts[0][0]+' T ':''}${parts[1][0]} Std ${parts[2][0]} Min`;
}
setInterval(()=>{if(!document.hidden)pvTick();},1000);
function pvCountdownHtml(){
 pvTarget=null;
 if(!pvStatus)return '<p class="muted">Spielplan wird geladen …</p>';
 if(pvStatus.error)return '<p class="muted">Das fehlt: Spielplan von OpenLigaDB ist gerade nicht erreichbar, darum kein Countdown.</p>';
 const days=pvStatus.days||[],live=kblLiveDay();
 // Waehrend des Spieltags heisst der Bereich "Spieltag" mit LIVE-Abzeichen daneben (Kevin-Vorgabe), sonst "Spieltagsvorschau".
 const title=$('#previewTitle');if(title)title.innerHTML=live?'SPIELTAG <span class="live-badge">● LIVE</span>':'SPIELTAGSVORSCHAU';
 if(live){pvLoadLive(live.day);return `<div class="pv-kickoff">● LIVE · Spieltag ${live.day} ${live.closing?'ist gespielt, Kickbase schließt ihn erst am Abend nach dem letzten Spiel ab. Bis dahin vorläufiger Stand.':`läuft (${live.finishedMatches} von ${live.matches} Spielen beendet). Die Startelfen sind eingefroren.`}</div>`+pvLiveHtml(live.day);}
 const next=days.find(d=>d.status==='upcoming'),k=pvKickoff(next);
 if(!next)return '<p class="muted">Kein weiterer Spieltag im Spielplan.</p>';
 if(!k)return `<p class="muted">Das fehlt: Anstoßzeit für Spieltag ${next.day} steht noch nicht fest.</p>`;
 pvTarget={t:k.t,day:next.day};
 const unit=(i,l)=>`<div class="pv-unit"><b data-pv="${i}">–</b><small>${l}</small></div>`;
 return `<div class="pv-countdown"><div class="pv-label">Anstoß Spieltag ${next.day} in</div><div class="pv-units" id="pvCountdown">${unit(0,'Tage')}${unit(1,'Std')}${unit(2,'Min')}${unit(3,'Sek')}</div>
  <div class="pv-meta">${escapeHtml(pvDate(k.t))}${k.match?` · ${escapeHtml(k.match)}`:''}</div><div class="pv-meta muted tiny">Mit dem ersten Anpfiff friert Kickbase die Startelf ein. Wer bis dahin nicht aufgestellt hat, zahlt 100 Punkte pro leerem Platz.</div></div>`;
}
// Live-Zwischenstand (/api/live-points/:day): Summe der Live-Punkte der Startelf minus 100 je leerem Platz.
// Das Kickbase-Ranking zeigt bis Spieltagsende 0 Punkte, darum rechnet der Server selbst.
let pvLive=null,pvLiveAt=0,pvLiveBusy=false;
async function pvLoadLive(day){
 if(pvLiveBusy||(pvLive?.day===day&&Date.now()-pvLiveAt<120e3))return;
 pvLiveBusy=true;
 try{pvLive=await api(`/api/live-points/${day}`);}catch(e){pvLive={day,error:e.message};}
 pvLiveAt=Date.now();pvLiveBusy=false;benchLoad(day,true);renderPreview();try{renderRankingTable();}catch{}try{renderCenter();}catch{}try{const h=$('#historyLive');if(h)h.innerHTML=historyLiveInner(day);}catch{}
}
setInterval(()=>{if(!document.hidden&&kblLiveDay())renderPreview();},120e3);
function pvLiveHtml(day){
 if(!pvLive||pvLive.day!==day)return '<p class="muted">Live-Punkte werden geladen …</p>';
 if(pvLive.error)return `<p class="muted">Das fehlt: Live-Punkte gerade nicht abrufbar (${escapeHtml(pvLive.error)}).</p>`;
 const ms=(pvLive.managers||[]).filter(m=>isEligibleManager(m.name));
 if(!ms.length)return `<p class="muted">${escapeHtml(pvLive.message||'Noch keine Live-Punkte.')}</p>`;
 const scored=ms.filter(m=>m.points!=null),top=scored.length?scored[0].points:null,max=Math.max(1,...scored.map(m=>Math.abs(m.points)));
 const pill=$('#previewPill');if(pill)pill.textContent=top==null?`Spieltag ${day} läuft`:`Vorn: ${scored.filter(m=>m.points===top).map(m=>m.name).join(', ')} (${fmt(top)})`;
 const time=pvLive.updatedAt?new Date(pvLive.updatedAt).toLocaleTimeString('de-DE',{hour:'2-digit',minute:'2-digit'}):'';
 const st={done:'✓',live:'●',open:'–',error:'?'};
 const row=(m,i)=>{const lead=m.points!=null&&m.points===top,pts=m.points==null?'–':fmt(m.points);
  const pl=m.players.map(p=>`<li class="pvl-p pvl-${p.state}"><span>${st[p.state]||''} ${escapeHtml(p.name||'Spieler '+p.id)}${p.team?` <small class="muted">${escapeHtml(p.team)}</small>`:''}</span><b>${p.points==null?'–':fmt(p.points)}</b></li>`).join('')
   +(m.empty?`<li class="pvl-p pvl-empty"><span>${m.empty} leere${m.empty>1?'':'r'} Platz${m.empty>1?'e':''}</span><b>−${fmt(100*m.empty)}</b></li>`:'');
  return `<details class="pvl-row${lead?' pvl-lead':''}" data-pvl="${escapeHtml(m.id)}"><summary><span class="pvl-pos">${i+1}.</span><span class="pvl-name">${lead?'👑 ':''}${mgrName(m.name,'',m.id)}</span><span class="pvl-bar"><i style="width:${m.points==null?0:Math.max(0,m.points)/max*100}%"></i></span><b class="pvl-pts">${pts}</b></summary>
   <ul class="pvl-list">${pl}</ul>${m.open?`<p class="muted tiny">${m.open} Spieler noch ohne Punkte (Spiel noch nicht angepfiffen oder noch nicht eingesetzt).</p>`:''}</details>`;};
 return `<div class="pv-live"><h4 class="pv-head">Live-Zwischenstand Spieltag ${day}</h4><div class="pvl-table">${ms.map(row).join('')}</div>
  <p class="muted tiny">Summe der Live-Punkte der Startelf, minus 100 je leerem Platz. Stand ${escapeHtml(time)} Uhr. Kickbase zeigt im Ranking erst nach dem Spieltag Punkte; nach Spielende können sich Punkte noch ändern. ✓ Spiel vorbei · ● läuft · – noch keine Punkte. Auf einen Manager tippen zeigt seine Spieler.</p></div>`;
}
function pvQuestions(){
 const days=historyData.filter(h=>h.status==='finished').slice().sort((a,b)=>a.day-b.day);
 if(!days.length)return [];
 const b=n=>mgrLink(n,`<b>${escapeHtml(n)}</b>`),l=n=>mgrLink(n,escapeHtml(n)),f=v=>fmt(Math.round(v));
 const series=new Map();
 for(const h of days)for(const m of h.list)if(m.dayPoints!==null&&isEligibleManager(m.name)){if(!series.has(m.name))series.set(m.name,[]);series.get(m.name).push(m.dayPoints);}
 const avg=a=>a.reduce((s,x)=>s+x,0)/a.length;
 const out=[],q=(tag,text,sub)=>out.push({tag,text,sub});
 const last=days.at(-1),prev=days.at(-2);
 // Tabelle nach dem letzten Spieltag
 const table=last.list.filter(m=>isEligibleManager(m.name)&&m.score!==null).slice().sort((x,y)=>y.score-x.score);
 if(table.length>1){const [a,c]=table,gap=a.score-c.score;
  q('👑 THRON',`Wackelt der Thron von ${b(a.name)}?`,gap===0?`Punktgleich mit ${l(c.name)}. Wer zuckt zuerst?`:gap<250?`Nur ${f(gap)} Punkte vor ${l(c.name)}. Ein schwacher Spieltag reicht.`:`${f(gap)} Punkte vor ${l(c.name)}. Kommt da überhaupt noch wer ran?`);}
 // Formkurve: letzte 3 Spieltage gegen den eigenen Schnitt
 const form=[...series].filter(([,p])=>p.length>=4).map(([n,p])=>{const l=p.slice(-3);return {n,last:avg(l),all:avg(p),d:avg(l)-avg(p)};});
 const hot=form.slice().sort((x,y)=>y.d-x.d)[0],cold=form.slice().sort((x,y)=>x.d-y.d)[0];
 if(hot&&hot.d>0)q('🔥 FORMKURVE',`Hält die Formkurve von ${b(hot.n)}?`,`Ø letzte 3 Spieltage: ${f(hot.last)} · Saisonschnitt ${f(hot.all)} (+${f(hot.d)})`);
 // BumsTabelle (laufende Halbserie)
 const bnames=[...new Set(Object.values(bumsDays||{}).flatMap(d=>Object.values(d.managers||{}).map(v=>v.name)))].filter(isEligibleManager);
 const bums=bnames.map(n=>({n,c:bumsOf(n)})).filter(x=>x.c!=null).sort((x,y)=>y.c-x.c);
 if(bums.length&&bums[0].c>0){const top=bums.filter(x=>x.c===bums[0].c);
  q('🍆 BUMSTABELLE',top.length===1?`Wird ${b(top[0].n)} wieder am häufigsten gebumst?`:`Wer von ${top.map(x=>b(x.n)).join(' und ')} wird diesmal öfter gebumst?`,`${bums[0].c} Bumsungen in der Halbserie, Platz 1 der BumsTabelle`);}
 if(cold&&cold.d<0)q('📉 ABSTURZ',`Ist ${b(cold.n)} im freien Fall oder war das nur ein Ausrutscher?`,`Ø letzte 3 Spieltage: ${f(cold.last)} · Saisonschnitt ${f(cold.all)} (${f(cold.d)})`);
 // Engstes Duell in der Tabelle (ohne Platz 1 gegen 2, das steht schon beim Thron)
 let duel=null;for(let i=2;i<table.length;i++){const g=table[i-1].score-table[i].score;if(!duel||g<duel.g)duel={a:table[i-1],c:table[i],g,pl:i};}
 if(duel)q('⚔️ DUELL',`Zieht ${b(duel.c.name)} an ${b(duel.a.name)} vorbei?`,duel.g===0?`Platz ${duel.pl} und ${duel.pl+1}, punktgleich`:`Platz ${duel.pl} gegen ${duel.pl+1}, nur ${f(duel.g)} Punkte Abstand`);
 // Letzter Spieltag: Sieger und Letzter (Dämonische Drehtür)
 const sc=last.list.filter(m=>m.dayPoints!==null&&isEligibleManager(m.name)).slice().sort((x,y)=>y.dayPoints-x.dayPoints);
 if(sc.length>1){
  const best=sc[0].dayPoints,winners=sc.filter(m=>m.dayPoints===best),worst=sc.at(-1).dayPoints,losers=sc.filter(m=>m.dayPoints===worst);
  const pw=prev?prev.list.filter(m=>m.dayPoints!==null&&isEligibleManager(m.name)):null,prevBest=pw?.length?Math.max(...pw.map(m=>m.dayPoints)):null;
  if(winners.length===1){const w=winners[0],twice=prevBest!=null&&pw.find(m=>m.name===w.name)?.dayPoints===prevBest;
   q('🏆 SIEGER',twice?`Hattrick für ${b(w.name)}? Zwei Spieltagssiege hat es schon.`:`Schafft ${b(w.name)} zwei Spieltagssiege am Stück?`,`Spieltag ${last.day}: ${f(best)} Punkte. Nach der Drehtür fehlt jetzt einer der drei besten Spieler.`);}
  if(losers.length===1)q('🥄 LETZTER',`Holt sich ${b(losers[0].name)} wieder den Holzlöffel ab?`,`Spieltag ${last.day}: ${f(worst)} Punkte. Immerhin gab es per Drehtür ein Geschenk vom Sieger.`);
 }
 const lan=table.at(-1),above=table.at(-2);
 if(lan&&above&&lan!==table[0])q('🏮 ROTE LATERNE',`Gibt ${b(lan.name)} die rote Laterne endlich ab?`,`${f(above.score-lan.score)} Punkte hinter ${l(above.name)}`);
 // Bester Schnitt ohne Spieltagssieg
 const wins=new Map();for(const h of days){const s=h.list.filter(m=>m.dayPoints!==null&&isEligibleManager(m.name));if(!s.length)continue;const mx=Math.max(...s.map(m=>m.dayPoints));s.filter(m=>m.dayPoints===mx).forEach(m=>wins.set(m.name,1));}
 const winless=[...series].filter(([n,p])=>!wins.has(n)&&p.length>=3).map(([n,p])=>({n,a:avg(p),g:p.length})).sort((x,y)=>y.a-x.a)[0];
 if(winless)q('⏳ SIEGLOS',`Wann gewinnt ${b(winless.n)} endlich mal einen Spieltag?`,`Ø ${f(winless.a)} Punkte, aber kein Spieltagssieg in ${winless.g} Spieltagen`);
 // Noch ungebumst
 const clean=bums.filter(x=>x.c===0);
 if(clean.length&&bums.length)q('😇 UNGEBUMST',clean.length<=2?`Bleibt ${clean.map(x=>b(x.n)).join(' und ')} weiter ungebumst?`:`${clean.length} Manager sind noch ungebumst. Wen erwischt es zuerst?`,clean.length<=2?'Bisher keine einzige Bumsung in der Halbserie':clean.map(x=>l(x.n)).join(', '));
 // Größte Schwankung
 const wild=[...series].filter(([,p])=>p.length>=4).map(([n,p])=>{const a=avg(p);return {n,sd:Math.sqrt(avg(p.map(x=>(x-a)**2))),lo:Math.min(...p),hi:Math.max(...p)};}).sort((x,y)=>y.sd-x.sd)[0];
 if(wild)q('🎲 WUNDERTÜTE',`Top oder Flop: Welcher ${b(wild.n)} kommt diesmal?`,`Bisher zwischen ${f(wild.lo)} und ${f(wild.hi)} Punkten alles dabei`);
 return out;
}
function renderPreview(){
 const el=$('#previewContent');if(!el)return;
 const qs=pvQuestions(),openRows=[...el.querySelectorAll('.pvl-row[open]')].map(d=>d.dataset.pvl);
 el.innerHTML=pvCountdownHtml()+(qs.length?`<h4 class="pv-head">Die großen Fragen vor dem Spieltag</h4><div class="pv-tiles">${qs.map(x=>`<div class="pv-tile"><small>${x.tag}</small><p>${x.text}</p><span>${x.sub}</span></div>`).join('')}</div>`:'<p class="muted">Fragen gibt es, sobald der erste Spieltag abgeschlossen ist.</p>');
 openRows.forEach(id=>{const d=el.querySelector(`.pvl-row[data-pvl="${CSS.escape(id)}"]`);if(d)d.open=true;});
 pvTick();
}

// BumsParade LIVE (Kevin-Wunsch): Während der Spieltag läuft, steht oben ohne „prüfen“, welche Strafen nach dem
// aktuellen Stand fällig wären (/api/rule-live/:day, Server rechnet höchstens alle 5 Min. neu). Nur vorläufig, keine Haken,
// nichts geht in die BumsTabelle. Eingeklappt (feste Regel), die Zahl der möglichen Strafen steht schon in der Kopfzeile.
let accLive=null,accLiveOpen=false,accLiveBusy=false,accRadarOpen=true,accRadarPlayers=null;
async function accLiveLoad(){
 const el=$('#accLive');if(!el||accLiveBusy)return;
 let st=pvStatus;if(!st?.days){try{st=await api('/api/matchday-status');}catch{st=null;}}
 const day=kblLiveDay(st)?.day;
 if(!day){accLive=null;el.innerHTML='';return;}
 accLiveBusy=true;if(!accLive||accLive.day!==day){accLive={day,state:'loading'};accLiveRender();}
 try{accLive={day,state:'done',data:await api(`/api/rule-live/${day}`)};}
 catch(e){accLive=/401|angemeldet/i.test(e.message)?null:{day,state:'error',error:e.message};}
 finally{accLiveBusy=false;}
 accLiveRender();
}
// Gegenseite zu UM (Kevin-Wunsch): Wer per UM einen Spieler bekommt, steht in der LIVE-Liste und im Bums-Radar auch selbst drin.
// Beide Ansichten nutzen diese eine Liste, damit sie nie auseinanderlaufen.
function accLiveWithRecv(items,standings){
 const out=[...items];
 for(const it of items){if(it.rule!=='UM'||!(it.to||[]).length)continue;
  for(const nm of it.to){const m=(standings||[]).find(x=>x.manager===nm);
   out.push({rule:'UM',role:'recv',managerId:m?String(m.managerId):'',manager:nm,playerId:it.playerId,playerName:it.playerName,from:it.manager,state:it.state,
    text:`bekommt ${it.playerName} von ${it.manager} (Upamaguire)`});}}
 return out;
}
function accLiveRender(){
 const el=$('#accLive');if(!el)return;const a=accLive;if(!a){el.innerHTML='';return;}
 const safe=x=>escapeHtml(String(x??'')),d=a.data;
 const RULE={BD:'Besoffener Davies',DD:'Dämonische Drehtür',MM:'Magic Miyoshi',AH:'Angeschossener Höler',RK:'Räudiger Kohr',BN:'Blinder Niklas',UM:'Upamaguire',EZ:'Einzelfallentscheidung'};
 const items=d?.items||[];
 const sum=a.state==='loading'?'wird berechnet …':a.state==='error'?'nicht abrufbar':!d?.live?(d?.message||'kein laufender Spieltag'):items.length?`${items.length} mögliche Strafe${items.length===1?'':'n'}`:'aktuell keine Strafen';
 let body='';
 if(a.state==='loading')body='<p class="muted">Zwischenstand wird berechnet … Das kann beim ersten Öffnen etwas dauern.</p>';
 else if(a.state==='error')body=`<p class="error">BumsParade LIVE nicht abrufbar: ${safe(a.error)}</p>`;
 else if(d?.live){
  const groups=new Map();for(const it of accLiveWithRecv(items,d.standings)){if(!groups.has(it.managerId))groups.set(it.managerId,{name:it.manager,list:[]});groups.get(it.managerId).list.push(it);}
  const place=new Map((d.standings||[]).map((m,i)=>[m.managerId,{i:i+1,pts:m.dayPoints}]));
  const sorted=[...groups.entries()].sort((x,y)=>(place.get(x[0])?.i??99)-(place.get(y[0])?.i??99));
  const when=d.updatedAt?new Date(d.updatedAt).toLocaleTimeString('de-DE',{hour:'2-digit',minute:'2-digit'}):'';
  const mvp=d.mvp?.players?.length?`<p class="muted tiny">Gerade bester Spieler des Spieltags: ${d.mvp.players.map(p=>safe(p.name)).join(', ')} (${fmt(d.mvp.points)} Pkt., Stand ${new Date(d.mvp.at).toLocaleTimeString('de-DE',{hour:'2-digit',minute:'2-digit'})}).</p>`:'';
  body=`<p class="muted tiny" style="margin:0 0 10px"><b>Vorläufig:</b> So sähe die BumsParade aus, wenn der Spieltag jetzt vorbei wäre. Punkte, Karten und Elfmeter können sich bis zum Abpfiff (und danach) noch ändern. Stand ${safe(when)} Uhr · ${d.closing?'alle Spiele beendet':`${d.running||0} Spieler im Spiel · ${d.open||0} noch nicht angepfiffen`}.</p>`+
   (d.notes||[]).map(n=>`<p class="error tiny">${safe(n)}</p>`).join('')+
   (sorted.length?`<ul class="center-groups">${sorted.map(([mid,g])=>{const p=place.get(mid);return `<li class="center-group"><div class="center-grouphead"><span>${p?`<span class="center-place">${p.i}.</span>`:''}<b>${mgrName(g.name,'',mid)}</b>${p?` <span class="muted tiny" style="white-space:nowrap">${fmt(p.pts)} Pkt.</span>`:''}</span><span class="center-hits">${g.list.length} mögliche Bumsung${g.list.length===1?'':'en'}</span></div><ul class="center-todo">${g.list.map(it=>`<li class="center-info"><span class="center-check"></span><span class="center-rule" title="${safe(RULE[it.rule]||it.rule)}">${safe(it.rule)}</span><span class="center-text"><span>${safe(it.text)}</span>${it.unclear?'<span class="center-status"><span class="center-state warn">? bitte prüfen</span></span>':''}</span></li>`).join('')}</ul></li>`;}).join('')}</ul>`:'<p>Nach dem aktuellen Stand gäbe es keine Strafen. 🎉</p>')+mvp+
   '<p class="muted tiny">Schnapszahlen (BD) werden erst nach dem jeweiligen Spielende geprüft, danach alle 30 Minuten (wegen Korrekturen). Teamlimit und Empfänger zeigt erst die echte BumsParade nach Spielende. Aktualisiert sich alle 5 Minuten, solange die BumsParade offen ist.</p>';
 }else body=`<p class="muted">${safe(d?.message||'')}</p>`;
 el.innerHTML=(a.state==='done'&&d?.live?accRadarHtml(d):'')+`<details class="center-box acc-todo-box acc-live-box"${accLiveOpen?' open':''} style="margin:0 0 14px"><summary class="center-boxhead"><strong>Spieltag ${a.day} <span class="live-badge">● LIVE</span> · ${safe(sum)}</strong><span class="pill">vorläufig</span></summary>${body}</details>`;
 // Spielerbilder und Vereine für die Drehtür-Kandidaten (wie im MVP-Tipp), einmal laden und neu zeichnen.
 if(a.state==='done'&&d?.live&&!accRadarPlayers){accRadarPlayers=new Map();api('/api/mvp-tipps/players').then(r=>{accRadarPlayers=new Map((r.players||[]).map(p=>[String(p.id),p]));accLiveRender();}).catch(()=>{});}
 el.querySelector('details').addEventListener('toggle',e=>{accLiveOpen=e.target.open;});
 el.querySelector('.bradar')?.addEventListener('toggle',e=>{accRadarOpen=e.target.open;});
}
// Bums-Radar (Kevin-Wunsch): provokante Bildübersicht zum LIVE-Stand, wer gerade wie gebumst würde. Steht ganz oben und ist
// gleich offen (Kevin-Wunsch, Ausnahme von der Zuklapp-Regel wie beim MVP-Tipp-Rennen: kbl-keep-open).
// Nur Anzeige aus /api/rule-live; zählt nichts, geht nicht in die BumsTabelle.
function accRadarHtml(d){
 const safe=x=>escapeHtml(String(x??'')),items=d.items||[],st=d.standings||[];
 const place=new Map(st.map((m,i)=>[String(m.managerId),i+1]));
 const by=new Map();for(const it of accLiveWithRecv(items,st)){const k=it.managerId?String(it.managerId):'n:'+it.manager;if(!by.has(k))by.set(k,{id:it.managerId?k:'',name:it.manager,list:[]});by.get(k).list.push(it);}
 const victims=[...by.values()].sort((a,b)=>b.list.length-a.list.length||(place.get(a.id)??99)-(place.get(b.id)??99));
 const sum=victims.length?`${victims.length} Manager im Visier`:'gerade keiner im Visier';
 const verdict=n=>n>=3?'Komplett zerlegt.':n===2?'Doppelt dran.':'Erwischt.';
 const where=it=>it.rule==='BD'?'→ 🗑️ ab auf den Markt':it.rule==='AH'?'→ 🔨 unter den Hammer':it.rule==='DD'?(it.role==='get'?'← darf sich bedienen':`→ 🎁 an ${(it.to||[]).join(', ')}`):it.rule==='MM'?'🎯 darf einen Manager auswählen':it.rule==='UM'&&it.role==='recv'?`← bekommt ihn von ${it.from}`:it.rule==='UM'?((it.to||[]).length?`→ an ${it.to.join(', ')}`:'→ 🗑️ an den Markt'):it.rule==='EZ'?'⚖️ Einzelfall':'→ an einen Mitmanager';
 const shot=it=>`<li><span class="bradar-stamp r-${safe(it.rule)}">${safe(it.rule)}</span><span class="bradar-shot">${it.playerName?`<b>${safe(it.playerName)}</b> `:''}<span class="muted">${safe(where(it))}</span></span></li>`;
 // Hauptduell der Drehtür: Spieltagsführender gegen Letzten.
 const give=items.filter(it=>it.rule==='DD'&&it.role==='give'),get=items.filter(it=>it.rule==='DD'&&it.role==='get');
 // Drehtür (Kevin-Wunsch): in der Mitte eine sich drehende Drehtür, beim Abgebenden die drei Kandidaten als Männchen wie im MVP-Tipp.
 const K=window.kblToon,info=id=>accRadarPlayers?.get(String(id));
 const fig=c=>{const p=info(c.id),[shirt,trim]=K?K.clubColor(p?.team):['#555','#fff'],crest=K&&p?.teamImg?K.kbImg(p.teamImg):'',live=c.state==='live';
  return `<div class="rd-fig toon-runner${live?' run':''}${crest?' has-crest':''}"><div class="toon-body">${K?K.toon({},shirt,trim,c.points<0?'sad':'happy',''):''}${K&&p?.img?`<img class="toon-face" src="${safe(K.headSrc(c.id))}" alt="" onload="this.closest('.toon-runner')?.classList.add('has-face')" onerror="this.remove()">`:''}${crest?`<img class="toon-crest" src="${safe(crest)}" alt="" referrerpolicy="no-referrer" onerror="this.closest('.toon-runner')?.classList.remove('has-crest');this.remove()">`:''}</div>${live?'<span class="toon-ball">⚽</span>':''}<div class="rd-tag">${safe(c.name)}<b>${fmt(c.points)}</b></div></div>`;};
 // Kevin-Wunsch: die Kandidaten stehen in den Kammern der Drehtür und drehen mit, schauen dabei immer nach vorn.
 const cands=give.length?(give[0].cands||[]):[];
 // Kevin-Wunsch: so viele Kammern wie Kandidaten (meist drei), in jeder steht genau einer, keine leeren Kammern.
 const n=Math.max(cands.length,2),step=360/n;
 const slot=(c,i)=>{const a=Math.round(step*(i+.5));return `<div class="rdoor-slot" style="--a:${a}deg"><div class="rdoor-bill"><div class="rdoor-face">${fig(c)}</div></div></div>`;};
 const door=`<div class="rdoor${cands.length?' has-cands':''}" aria-hidden="true"><div class="rdoor-roof"></div><div class="rdoor-stage"><div class="rdoor-rot">${cands.length?Array.from({length:n},(_,i)=>`<i style="transform:rotateY(${Math.round(step*i)}deg)"></i>`).join(''):'<i></i><i></i><i></i><i></i>'}${cands.map(slot).join('')}</div></div><div class="rdoor-floor"></div><small>Dämonische Drehtür</small></div>`;
 const duel=give.length&&get.length?`<div class="bradar-duel"><div class="bradar-side give">${mgrFace(give[0].manager,'mgr-av-lg',give[0].managerId)}<b>${safe(give.map(g=>g.manager).join(' & '))}</b><span class="muted tiny">Platz 1 · gibt einen ab</span></div>${door}<div class="bradar-side get">${mgrFace(get[0].manager,'mgr-av-lg',get[0].managerId)}<b>${safe(get.map(g=>g.manager).join(' & '))}</b><span class="muted tiny">Letzter · sucht sich einen aus</span></div></div>`:'';
 const cards=victims.map(v=>`<li class="bradar-card${v.list.length>=2?' hot':''}"><div class="bradar-head">${mgrFace(v.name,'mgr-av-lg',v.id)}<div><b>${safe(v.name)}</b><span class="bradar-verdict">${verdict(v.list.length)}</span></div><span class="bradar-count">${v.list.length}×</span></div><ul class="bradar-shots">${v.list.map(shot).join('')}</ul></li>`).join('');
 const safeOnes=st.filter(m=>!by.has(String(m.managerId)));
 const clean=safeOnes.length?`<div class="bradar-clean"><p><b>Noch ungebumst</b> <span class="muted tiny">· zittern bis zum Abpfiff</span></p><div class="bradar-faces">${safeOnes.map(m=>`<span title="${safe(m.manager)}">${mgrFace(m.manager,'',m.managerId)}<small>${safe(m.manager)}</small></span>`).join('')}</div></div>`:'';
 return `<details class="center-box acc-todo-box bradar kbl-keep-open"${accRadarOpen?' open':''} style="margin:0 0 14px"><summary class="center-boxhead"><strong>🎯 Bums-Radar · ${safe(sum)}</strong><span class="pill">wenn jetzt Abpfiff wäre</span></summary>${duel}${victims.length?`<ul class="bradar-grid">${cards}</ul>`:'<p>Gerade würde keiner gebumst. Langweilig. 😴</p>'}${clean}<p class="muted tiny">Nur ein Zwischenstand aus der LIVE-Liste darüber. Er zählt nicht für die BumsTabelle, und bis zum Abpfiff kann noch alles kippen.</p></details>`;
}
setInterval(()=>{if(!document.hidden&&accLive&&document.querySelector('.kbl-view.kbl-current[data-view="accounting"]'))accLiveLoad();},5*60e3);
onConnected.push(()=>{if(document.querySelector('.kbl-view.kbl-current[data-view="accounting"]'))accLiveLoad();});
