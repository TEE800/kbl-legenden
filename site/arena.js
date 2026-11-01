// Ansicht "Arena" (Kevin-Wunsch): zweite Liga "Legenden Arena" im Head-to-Head-Modus. Je Spieltag Duelle zwischen zwei Managern,
// als Boxkampf mit Pixel-Boxern (Kevin-Wunsch 1.11.). Daten von /api/arena und /api/arena/:day.
(()=>{
 const $=s=>document.querySelector(s);
 const esc=v=>String(v??'').replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
 const fmt=n=>n==null||!Number.isFinite(Number(n))?'–':new Intl.NumberFormat('de-DE').format(n);
 const when=s=>s?new Date(s).toLocaleString('de-DE',{weekday:'short',day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'}):'–';
 let overview=null,data=null,loading=false,raceOpen=true;
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
  const src=d.source==='datei'&&d.dataAt?` Paarungen und Aufstellungen: Stand Anpfiff ${esc(when(d.firstKickoffUTC||d.dataAt))}.`:'';
  // Ohne Aufstellungen kein Rennen (Kevin 1.11.: sonst stehen alle ohne Punkte am Start). Grund: Nur die App am PC (T800) darf die Arena lesen.
  if(d.lineupsMissing)return `<p class="arena-note error">Das fehlt: die Aufstellungen von Spieltag ${d.day}, darum noch kein Boxkampf. Nur die App am PC (T800) darf die Arena lesen${d.dataAt?`, ihr letzter Abruf war ${esc(when(d.dataAt))}`:''}. Sobald sie am PC läuft (start.bat), kommen Aufstellungen und Punkte nach wenigen Minuten.</p>`;
  return src?`<p class="arena-note muted tiny">${src.trim()}</p>`:'';
 }
 // Kevin-Wunsch: keine Anzeigetafel oben. Vor dem Anpfiff nur die Paarungen, danach steht alles im Boxring.
 function pairings(d){
  return `<div class="arena-pairs">${d.duels.map(x=>`<div class="arena-pair"><span class="arena-side a">${face(x.a,'arena-ava')}<span class="arena-name">${esc(x.a.name)}</span></span><span class="arena-vs">vs</span><span class="arena-side b"><span class="arena-name">${esc(x.b.name)}</span>${face(x.b,'arena-ava')}</span></div>`).join('')}</div>`;
 }
 function playerList(m){
  if(!m.players)return '<p class="muted tiny">Keine Aufstellung.</p>';
  const K=T();
  return `<ol class="arena-players">${m.players.map(p=>`<li class="${p.playing?'live':''}${p.why?' arena-out':''}${p.total!=null&&p.total<0?' neg':''}">${K?`<span class="arena-phead"><img src="${esc(K.headSrc(p.id))}" alt="" loading="lazy" onerror="this.remove()"></span>`:''}<span class="arena-pname">${esc(p.name)}${p.captain?' <b class="arena-cap" title="Kapitän: Punkte doppelt">C</b>':''}<small class="muted">${esc(p.team||'')}</small></span><span class="arena-ppts">${p.why==='ban'?'<small class="arena-ban">🟥 gesperrt</small>':p.why==='out'?`<small class="muted">${p.whyLive?'nicht im Spiel':'nicht eingesetzt'}</small>`:p.state==='open'?'<small class="muted">noch nicht</small>':p.playing?'⚽ ':''}${p.state==='open'?'':fmt(p.total)}${p.captain&&p.points!=null?`<small class="muted"> (2×${fmt(p.points)})</small>`:''}</span></li>`).join('')}</ol>`;
 }
 // Boxkampf (Kevin-Wunsch 1.11., ersetzt das Duell-Rennen): oben ein großer Ring mit einem Duell (zuerst das eigene, Antippen
 // einer Karte wechselt), darunter alle Duelle als kleine Karten. Boxer = Pixel-Figuren wie im MVP-Rennen, Kopf = verpixeltes Profilbild.
 // Lebensbalken: Führender voll, der andere = eigene Punkte / Punkte des Führenden. Ende: Sieger jubelt, Verlierer liegt K.O.
 let pick=null,rest=null; // rest: Seite (a/b), deren verbliebene Spieler unter dem Ring aufgeklappt sind (Kevin-Wunsch 1.11.)
 const meId=()=>{try{const v=String(JSON.parse(localStorage.getItem('kbl-push')||'null')?.managerId||'')||localStorage.getItem('kblMvpManager')||'';return /^\d{1,15}$/.test(v)?v:'';}catch{return '';}};
 const duelKey=x=>x.a.id+'-'+x.b.id;
 const hp=(m,o)=>{const a=Math.max(0,m.points||0),b=Math.max(0,o.points||0);return b<=a?1:a/b;};
 const ended=d=>d.status==='finished';
 const pose=(d,x,m,o)=>ended(d)?(x.winner==='draw'||!x.winner?'guard':x.winner===m.id?'cheer':'ko'):(m.points??0)>(o.points??0)?'punch':(m.points??0)<(o.points??0)?'hurt':'guard';
 const side=m=>m.live?`🥊 ${m.live} im Kampf`:m.open?`${m.open} ${m.open===1?'kommt':'kommen'} noch`:'fertig';
 // Gesperrte und nicht eingesetzte Spieler (Kevin-Wunsch 1.11.): zählen nicht als „kommen noch“.
 // Gesperrt = RK aus der BumsParade des Vorspieltags (gleiche Quelle wie in den Aufstellungen, window.kblLuBans).
 // Nicht eingesetzt = keine Punkte, obwohl das Spiel seines Vereins schon angepfiffen ist (Anstoß aus der Ligenübersicht
 // oder ein Mitspieler desselben Vereins hat schon Punkte). Nur der Spieltag danach, wie lange Rot sperrt, liefert Kickbase nicht.
 const extra=new Map();
 function loadExtra(day){
  if(extra.has(day))return;extra.set(day,{bans:null,kicks:null});
  const bansP=window.kblLuBans?window.kblLuBans(day).catch(()=>null):Promise.resolve(null);
  const kicksP=get('/api/ligen').then(l=>{const bl=(l.leagues||[]).find(x=>x.key==='bl1'),dd=bl?.days?.find(x=>x.day===day),m=new Map();
   for(const g of dd?.matches||[])for(const t of [g.t1,g.t2])m.set(String(t),{dt:Date.parse(g.dt),state:g.state});return m;}).catch(()=>null);
  Promise.all([bansP,kicksP]).then(([b,k])=>{extra.set(day,{bans:b?.map||null,kicks:k});if(data?.day===day)render();});
 }
 function annot(d){
  const ex=extra.get(d.day)||{},now=Date.now(),all=d.duels.flatMap(x=>[x.a,x.b]).flatMap(m=>m.players||[]);
  const teamOn=new Set(all.filter(p=>p.state==='done'||p.state==='live').map(p=>p.team).filter(Boolean));
  for(const m of d.duels.flatMap(x=>[x.a,x.b])){if(!m.players)continue;
   for(const p of m.players){delete p.why;delete p.whyLive;if(p.state!=='open')continue;
    const k=p.tid?ex.kicks?.get(String(p.tid)):null,started=k?k.dt<=now:teamOn.has(p.team);
    if(ex.bans?.has(String(p.id)))p.why='ban';else if(started){p.why='out';p.whyLive=!!k&&k.state!=='done';}}
   m.open=m.players.filter(p=>p.state==='open'&&!p.why).length;}
 }
 // Manager-Bilder: das Kickbase-CDN erlaubt kein CORS (Canvas), darum online aus site/faces/ (Export), am PC über /api/mgr-img.
 const faceSrc=img=>{const k=/^(?:https?:\/\/kickbase\.b-cdn\.net\/)?\/?(user\/([\w.-]{1,80}))$/.exec(String(img||''));
  return !k?'':window.KBL_STATIC?'faces/'+k[2].replace(/\.(jpe|jpeg)$/i,'.jpg'):'/api/mgr-img?p='+encodeURIComponent(k[1]);};
 const imgs=new Map();
 const loadImg=src=>{if(!src)return Promise.resolve(null);if(!imgs.has(src))imgs.set(src,new Promise(r=>{const i=new Image();i.onload=()=>r(i);i.onerror=()=>r(null);i.src=src;setTimeout(()=>r(null),8000);}));return imgs.get(src);};
 // Pixel-Boxer 26×36: rote bzw. blaue Ecke. pose: guard | punch | hurt | cheer | ko
 async function boxDraw(cv){
  const o=JSON.parse(cv.dataset.box),W=26,H=36,red=o.c==='a';cv.width=W;cv.height=H;
  const x=cv.getContext('2d',{willReadFrequently:true});x.imageSmoothingEnabled=false;x.clearRect(0,0,W,H);
  const P=(a,b,w,h,c)=>{x.fillStyle=c;x.fillRect(a,b,w,h);};
  const SK='#e9b48a',SK2='#c98f66',G=red?'#d6332a':'#2f6fe0',SH=red?'#b71c1c':'#1e4fb8';
  const img=o.cpu?null:await loadImg(faceSrc(o.img));
  if(o.p==='ko'){x.save();x.translate(W/2,H/2);x.rotate(-Math.PI/2);x.translate(-W/2,-H/2);}
  P(8,27,4,7,SK);P(14,27,4,7,SK);P(7,33,6,3,'#111');P(13,33,6,3,'#111');
  P(7,22,12,6,SH);P(7,22,12,1,'#fff');P(12,24,2,4,'#0004');
  P(8,14,10,8,SK);P(14,14,4,8,SK2);
  if(img){const t=document.createElement('canvas');t.width=12;t.height=12;const tx=t.getContext('2d');tx.imageSmoothingQuality='high';
   const q=Math.min(img.width,img.height);tx.drawImage(img,(img.width-q)/2,(img.height-q)/2,q,q,0,0,12,12);x.drawImage(t,7,1);}
  else if(o.cpu){P(7,1,12,12,'#9aa7b0');P(9,5,3,3,'#e33');P(14,5,3,3,'#e33');P(10,10,6,1,'#333');P(12,-1,2,2,'#9aa7b0');}
  else{P(7,1,12,12,SK);P(7,1,12,3,'#3b2a1a');P(10,6,2,2,'#222');P(14,6,2,2,'#222');P(11,10,4,1,'#a55');}
  if(o.p==='punch'){P(17,15,6,3,SK);P(21,13,5,6,G);P(21,13,5,1,'#fff6');P(4,15,4,3,SK);P(2,14,5,5,G);}
  else if(o.p==='cheer'){P(4,4,3,10,SK);P(19,4,3,10,SK);P(3,0,5,5,G);P(18,0,5,5,G);}
  else if(o.p==='hurt'||o.p==='ko'){P(5,16,3,5,SK);P(18,16,3,5,SK);P(4,20,5,5,G);P(17,20,5,5,G);}
  else{P(5,15,3,5,SK);P(18,15,3,5,SK);P(4,11,5,5,G);P(17,11,5,5,G);P(4,11,5,1,'#fff6');P(17,11,5,1,'#fff6');}
  if(o.p==='ko')x.restore();
  try{const dd=x.getImageData(0,0,W,H),p=dd.data,n=new Uint8ClampedArray(p),A=(a,b)=>a>=0&&b>=0&&a<W&&b<H&&p[(b*W+a)*4+3]>0;
   for(let b=0;b<H;b++)for(let a=0;a<W;a++){const i=(b*W+a)*4;if(p[i+3])continue;if(A(a-1,b)||A(a+1,b)||A(a,b-1)||A(a,b+1)){n[i]=n[i+1]=n[i+2]=10;n[i+3]=255;}}
   dd.data.set(n);x.putImageData(dd,0,0);}catch{}
 }
 const boxer=(m,c,p,flip)=>`<canvas class="box-c" data-box="${esc(JSON.stringify({img:m.img||'',cpu:!!m.cpu,c,p}))}" width="26" height="36"></canvas>`;
 const bar=(v,cls='')=>`<div class="box-hb${v<.85?' low':''} ${cls}"><i style="width:${(v*100).toFixed(1)}%"></i></div>`;
 function boxRing(d){
  if(!d.duels.length)return '';
  if(d.status!=='finished')loadExtra(d.day);annot(d);
  const me=meId(),def=d.duels.find(x=>x.a.id===me||x.b.id===me)||d.duels[0];
  const x=d.duels.find(y=>duelKey(y)===pick)||def,a=x.a,b=x.b,pa=pose(d,x,a,b),pb=pose(d,x,b,a);
  let crowd='';for(let i=0;i<64;i++)crowd+=`<i style="left:${(i*37)%100}%;top:${8+((i*53)%96)}px;background:hsl(${i*47%360} 30% ${25+i%3*8}%)"></i>`;
  const ko=ended(d)&&x.winner&&x.winner!=='draw',draw=ended(d)&&x.winner==='draw';
  const fig=(m,c,p)=>`<div class="box-f ${c} ${p}${!ended(d)&&m.live?' live':''}">${boxer(m,c,p)}</div>`;
  const left=m=>(m.players||[]).filter(p=>p.playing||(p.state==='open'||p.state==='wait')&&!p.why);
  const stBtn=(m,c)=>left(m).length&&!ended(d)?`<button type="button" class="box-st box-rest${rest===c?' on':''}" data-arena-rest="${c}">${side(m)} ${rest===c?'▴':'▾'}</button>`:`<span class="box-st">${side(m)}</span>`;
  // Antippen der Punkte (Kevin-Wunsch 1.11.): ganze Aufstellung; Antippen von „im Kampf“: nur die verbliebenen Spieler.
  const bigBtn=(m,c)=>m.players?`<button type="button" class="box-big box-lu${rest===c+'*'?' on':''}" data-arena-rest="${c}*" title="Aufstellung anzeigen">${fmt(m.points)}</button>`:`<span class="box-big">${fmt(m.points)}</span>`;
  const rs=String(rest||''),all=rs.endsWith('*'),rc=rs[0],restM=rc==='a'?a:rc==='b'?b:null;
  const restBox=!restM?'':all?`<div class="box-restlist ${rc}"><b>Aufstellung von ${esc(restM.name)}</b>${playerList(restM)}</div>`:!ended(d)&&left(restM).length?`<div class="box-restlist ${rc}"><b>Noch dabei bei ${esc(restM.name)}</b>${playerList({...restM,players:left(restM)})}</div>`:'';
  const ring=`<div class="box-ring" data-arena-key="${esc(duelKey(x))}"><div class="box-crowd">${crowd}</div><i class="box-spot l"></i><i class="box-spot r"></i>
   <div class="box-hud"><div class="s"><span class="box-nm">${esc(a.name)}</span>${bar(hp(a,b))}${bigBtn(a,'a')}${stBtn(a,'a')}</div>
   <div class="box-vs">VS<small>${x.diff?(ended(d)?'Sieg mit ':'+')+fmt(Math.abs(x.diff)):ended(d)?'':'gleich'}</small></div>
   <div class="s r"><span class="box-nm">${esc(b.name)}</span>${bar(hp(b,a))}${bigBtn(b,'b')}${stBtn(b,'b')}</div></div>
   <div class="box-mat"></div><i class="box-post a"></i><i class="box-post b"></i><i class="box-rope" style="bottom:110px"></i><i class="box-rope" style="bottom:85px"></i><i class="box-rope" style="bottom:60px"></i>
   ${fig(a,'a',pa)}${fig(b,'b',pb)}${ko?'<span class="box-stamp">K.O.</span>':draw?'<span class="box-stamp draw">UNENTSCHIEDEN</span>':''}</div>${restBox}`;
  const cards=`<div class="box-list">${d.duels.map(y=>{const on=y===x,w=m=>y.winner&&y.winner!=='draw'?(y.winner===m.id?' win':' lose'):'';
   return `<button type="button" class="box-mini${on?' on':''}" data-arena-pick="${esc(duelKey(y))}"><span class="l"><span class="${w(y.a)}">${esc(y.a.name)}</span><span class="${w(y.b)}">${esc(y.b.name)}</span></span><span class="box-bars">${bar(hp(y.a,y.b),'flip')}${bar(hp(y.b,y.a))}</span><span class="l"><b>${fmt(y.a.points)}</b>${ended(d)&&y.winner&&y.winner!=='draw'?'<small>K.O.</small>':''}<b>${fmt(y.b.points)}</b></span></button>`;}).join('')}</div>`;
  setTimeout(()=>document.querySelectorAll('canvas.box-c:not([data-done])').forEach(cv=>{cv.dataset.done='1';boxDraw(cv);}),0);
  return ring+cards;
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
  // Ausnahme (Kevin-Wunsch, wie beim MVP-Tipp): der Platz mit den Figuren ist gleich offen (kbl-keep-open), außer man hat ihn selbst zugeklappt.
  const wasOpen=new Set([...root.querySelectorAll('details.acc-group[open]')].map(x=>x.dataset.arenaDuel??x.className));
  const raceShut=!raceOpen&&!!root.querySelector('details.arena-race:not([open])');raceOpen=false;
  root.className='';
  const started=d.status!=='upcoming'&&!d.lineupsMissing;
  root.innerHTML=stateText(d)+(!started?pairings(d):`<details class="acc-group arena-race kbl-keep-open"${raceShut?'':' open'}><summary>🥊 Arena</summary><div class="acc-sub">${boxRing(d)}<p class="muted tiny">Antippen einer Karte holt das Duell in den Ring. Der Führende hat den vollen Lebensbalken, beim anderen zeigt er seine Punkte im Verhältnis zum Gegner. „Im Kampf“ = Spieler im laufenden Spiel. Nach dem Spieltag jubelt der Sieger, der Verlierer liegt K.O.</p></div></details>`)+table(d);
  root.querySelectorAll('details.acc-group:not(.arena-race)').forEach(x=>{if(wasOpen.has(x.dataset.arenaDuel??x.className))x.open=true;});
 }
 async function loadDay(day){
  const root=$('#arenaContent');
  if(!data||data.day!==day){root.className='muted';root.textContent=`Lade Spieltag ${day} …`;}
  try{data=await get(`/api/arena/${day}`);render();}
  catch(e){root.className='error';root.textContent='Arena nicht abrufbar: '+e.message;}
 }
 async function load(){
  if(loading)return;loading=true;raceOpen=true;
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
 document.addEventListener('click',e=>{const r=e.target.closest?.('[data-arena-rest]');if(!r)return;rest=rest===r.dataset.arenaRest?null:r.dataset.arenaRest;render();});
 document.addEventListener('click',e=>{const k=e.target.closest?.('[data-arena-pick]');if(!k)return;if(pick!==k.dataset.arenaPick)rest=null;pick=k.dataset.arenaPick;render();document.querySelector('.box-ring')?.scrollIntoView({block:'nearest',behavior:'smooth'});});
 document.addEventListener('click',e=>{if(e.target.closest?.('[data-kbl-nav="arena"]'))load();});
 window.addEventListener('hashchange',()=>{if(location.hash==='#arena')load();});
 setInterval(()=>{for(const el of document.querySelectorAll('[data-arena-left]'))el.textContent=left(el.dataset.arenaLeft);},30000);
 // Während der Spiele den Stand alle 2 Minuten neu holen, solange der Reiter sichtbar ist.
 setInterval(()=>{if(data?.status==='live'&&$('#arenaContent')?.offsetParent&&!document.hidden)loadDay(data.day);},120000);
})();
