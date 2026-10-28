// Ansicht "MVP-Tipp" (NPC Goes MVP): verdeckter Tipp auf Spieler und Punktzahl, bis zum ersten Anstoß änderbar (Daten von /api/mvp-tipps).
(()=>{
 const $=s=>document.querySelector(s);
 // Manager-Logo aus app.js (mgrFace), leer, falls nicht geladen.
 const mn=(n,id)=>window.kblMgrName?window.kblMgrName(n,'',id):esc(n);
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
  if(players)return;
  const d=await get('/api/mvp-tipps/players');players=d.players;
  const seen=new Map();
  for(const p of players){let l=`${p.name} (${p.team})`;const n=(seen.get(l)||0)+1;seen.set(l,n);if(n>1)l+=` #${n}`;p.label=l;playerByLabel.set(l,p);}
  for(const el of document.querySelectorAll('[data-mvp-player]'))if(el===document.activeElement)suggest(el);
 }
 // Eigene Vorschlagsliste statt <datalist> (die zeigen manche Handy-Browser nicht an, z. B. Samsung Internet).
 // Getippte Namen werden ohne Akzente und Groß-/Kleinschreibung verglichen; passt genau ein Spieler, gilt er als gewählt.
 const norm=v=>String(v||'').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/ß/g,'ss').replace(/\s+/g,' ').trim();
 function findPlayers(q){
  q=norm(q);if(!q||!players)return [];
  const exact=players.filter(p=>norm(p.label)===q||norm(p.name)===q);if(exact.length)return exact;
  const words=q.split(' '),starts=p=>norm(p.name).split(/[ -]/).some(x=>x.startsWith(words[0]));
  const pool=poolOf(data),inPool=p=>pool.includes(p.team);
  return players.filter(p=>{const l=norm(p.label);return words.every(w=>l.includes(w));}).sort((a,b)=>inPool(b)-inPool(a)||starts(b)-starts(a)||a.name.localeCompare(b.name,'de'));
 }
 function pickPlayer(input){
  const v=input.value.trim(),hit=playerByLabel.get(v);if(hit)return {p:hit};
  const m=findPlayers(v);if(m.length===1){input.value=m[0].label;return {p:m[0]};}
  return {error:!players?'Die Spielerliste lädt noch, bitte gleich noch einmal versuchen.':m.length?`Mehrere Spieler passen (${m.slice(0,4).map(p=>p.label).join(', ')}${m.length>4?' …':''}). Bitte einen aus der Liste unter dem Feld antippen.`:'Kein Spieler mit diesem Namen gefunden. Tippe einen Teil des Namens und tippe dann den Spieler in der Liste an.'};
 }
 function suggest(input){
  const box=input.parentElement.querySelector('.mvp-suggest');if(!box)return;
  if(!players){box.hidden=false;box.innerHTML='<div class="muted tiny">Spielerliste lädt …</div>';return;}
  const m=playerByLabel.has(input.value.trim())?[]:findPlayers(input.value).slice(0,8);
  box.hidden=!m.length;box.innerHTML=m.map(p=>`<button type="button" data-mvp-pick="${esc(p.label)}">${esc(p.name)} <small>${esc(p.team)}</small></button>`).join('');
 }
 document.addEventListener('input',e=>{if(e.target.matches?.('[data-mvp-player]')){loadPlayers().catch(()=>{});suggest(e.target);}});
 document.addEventListener('focusout',e=>{if(e.target.matches?.('[data-mvp-player]'))setTimeout(()=>{const b=e.target.parentElement?.querySelector('.mvp-suggest');if(b&&!b.contains(document.activeElement))b.hidden=true;},200);});
 document.addEventListener('pointerdown',e=>{const b=e.target.closest?.('[data-mvp-pick]');if(b)e.preventDefault();});
 document.addEventListener('click',e=>{const b=e.target.closest?.('[data-mvp-pick]');if(!b)return;const input=b.closest('.mvp-pick').querySelector('input');input.value=b.dataset.mvpPick;b.parentElement.hidden=true;});
 // Bester Tipper des Vorspieltags bestimmt die Tippregel (Kevin-Vorgabe), Server: tippBest (result.best).
 const bestIds=d=>d.prevBest?.managers||[];
 const bestNames=d=>bestIds(d).map(id=>{const m=d.managers.find(x=>x.id===id);return m?mn(m.name,m.id):null;}).filter(Boolean);
 function bestLine(d){
  if(!d.prevBest)return '';
  const n=bestNames(d);
  if(!n.length)return `<small class="muted">Wer die Regel bestimmt, steht noch nicht fest: Der beste Tipper von Spieltag ${d.prevBest.day} ist noch nicht ausgewertet.</small>`;
  return `<small class="muted">Regel bestimmt von <b>${n.join(', ')}</b> (bester MVP-Tipper an Spieltag ${d.prevBest.day})</small>`;
 }
 function ruleBox(d){
  if(!d.rule)return `<div class="mvp-rule"><div class="eyebrow">TIPPREGEL SPIELTAG ${d.day}</div><p>Die Tippregel für diesen Spieltag steht noch nicht fest. Getippt werden kann trotzdem schon.</p>${bestLine(d)}</div>`;
  // Die Liga schreibt die Regel selbst (keine Vorlagen); ältere Einträge mit Vorlagen-Titel zeigen ihn weiter an.
  return `<div class="mvp-rule"><div class="eyebrow">TIPPREGEL SPIELTAG ${d.day}</div>${d.rule.id!=='eigene'?`<strong>${esc(d.rule.title)}</strong>`:''}<p class="mvp-rule-text">${esc(d.rule.text)}</p>${d.rule.by?`<small class="muted">Regel bestimmt von <b>${mn(d.rule.by.name,d.rule.by.id)}</b>${bestIds(d).includes(d.rule.by.id)?` (bester MVP-Tipper an Spieltag ${d.prevBest.day})`:''}</small>`:bestLine(d)}${!kindOf(d)?'<small class="muted mvp-wertung">Wertung: aus dem Regeltext nicht erkannt, bitte im Admin-Bereich wählen</small>':kindAuto(d)?'':`<small class="muted mvp-wertung">Wertung (vom Admin gewählt): <b>${esc(kindTitle(d,kindOf(d)))}</b></small>`}</div>`;
 }
 function deadline(d){
  if(d.open)return `<p class="mvp-deadline">Tipps bis <b>${esc(when(d.deadline))}</b>${d.firstMatch?` (${esc(d.firstMatch)})`:''} · <span data-mvp-left="${esc(d.deadline)}">${left(d.deadline)}</span></p>`;
  if(d.status==='upcoming')return `<p class="muted">Auf diesen Spieltag wird erst getippt, wenn er als nächster dran ist.</p>`;
  if(d.status==='live'||d.closing)return '';// während des Spieltags (bis Kickbase ihn abschließt) nur die Tippregel (Kevin-Wunsch)
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
   <label class="acc-label mvp-pick">Spieler<input id="mvpPlayer" data-mvp-player placeholder="Name eintippen …" autocomplete="off" required value="${esc(mine?`${mine.player} (${mine.team})`:'')}"><div class="mvp-suggest" hidden></div></label>
   <label class="acc-label">Punkte<input id="mvpPoints" type="number" inputmode="numeric" step="1" min="-1000" max="2000" required value="${mine?esc(mine.points):''}"></label>
   <button class="gold" type="submit">${mine||who?.tipped?'Tipp ändern':'Tipp abgeben'}</button>${byCode&&who?.tipped?' <button type="button" class="ghost" id="mvpShowMine">Meinen Tipp anzeigen</button>':''}</form>
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
 const MVP_KINDS=new Set(['volltreffer','zahl','name','drunter','korridor']),KORRIDOR=25;
 // Wertung der Tippregel (vom Admin eingestellt); alte Einträge mit Vorlage werten nach ihrer Vorlage.
 // Ohne eingestellte Wertung aus dem Regeltext erkannt (gleiche Funktion wie detectWertung in server.js).
 function detectWertung(text){
  const t=String(text||'').toLowerCase().replace(/ä/g,'ae').replace(/ö/g,'oe').replace(/ü/g,'ue').replace(/ß/g,'ss');
  if(!t.trim())return null;
  const pts=/punkt|zahl/.test(t);
  if(/mvp/.test(t)){
   if(/korridor/.test(t))return 'korridor';
   if(/(nicht|ohne|kein) *(drueber|darueber|ueber)|drunter|darunter|ueberbiet/.test(t))return 'drunter';
   if(pts&&/(spieler|name) *(ist|sind)? *egal|egal,? welche|nur die (punkt)?zahl/.test(t))return 'zahl';
   if(/punkt\w* *(zaehl\w*|ist|sind) *(nicht|egal)|ohne punkt/.test(t))return 'name';
   if(/(punktzahl|punkte\w*) des mvp|mvp-punkt/.test(t)&&!/richtig\w* *(mvp|spieler)|mvp richtig/.test(t))return 'zahl';
   return pts?'volltreffer':'name';
  }
  // "Punktbester Spieler (der Aufsteiger)": wer den Besten tippt; nennt die Regel Vereine, zaehlen nur deren Spieler (ruleTeams).
  if(/punktbest|beste\w* (feld)?spieler|meiste\w* punkte|hoechste\w* punkt/.test(t))return 'volltreffer';
  if(/(eigen|getippt|seine|ihre)\w* *spieler/.test(t)&&/genau|naechst|nah/.test(t))return 'prognose';
  return null;
 }
 const kindOf=d=>d.rule?.wertung||(d.rule&&d.rule.id!=='eigene'?d.rule.id:detectWertung(d.rule?.text));
 // Vereine, die der Regeltext nennt (gleiche Funktion wie in server.js). Leer = alle Spieler zählen.
 function ruleTeams(text,teams){
  const n=v=>String(v||'').toLowerCase().replace(/ä/g,'ae').replace(/ö/g,'oe').replace(/ü/g,'ue').replace(/ß/g,'ss');
  const t=n(text);
  return [...new Set(teams)].filter(x=>{const k=n(x);return [k,...k.split(/['\s]/).filter(w=>w.length>=5)].some(w=>w.length>=4&&new RegExp(`(^|[^a-z0-9])${w.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')}([^a-z0-9]|$)`).test(t));});
 }
 // Bedingungen an den Spieler (gleiche Erkennung wie ruleConds in server.js): field = kein Torwart, noGoal = keine direkte Torbeteiligung.
 function ruleConds(text){
  const t=String(text||'').toLowerCase().replace(/ä/g,'ae').replace(/ö/g,'oe').replace(/ü/g,'ue').replace(/ß/g,'ss'),c=[];
  if(/feldspieler|(kein|ohne)\w* *(torwart|torhueter)/.test(t))c.push('field');
  if(/(ohne|kein)\w* *(direkte\w* *)?torbeteiligung/.test(t))c.push('noGoal');
  return c;
 }
 const condsOf=d=>d?.tracking?.conds||d?.result?.conds||ruleConds(d?.rule?.text);
 const condText=c=>[c.includes('field')?'nur Feldspieler':'',c.includes('noGoal')?'ohne direkte Torbeteiligung':''].filter(Boolean).join(', ');
 // Getippte Spieler, die die Bedingungen nicht erfüllen (Server: tracking.out), gesetzt in render().
 let ruleOut=new Set();
 const offRule=(pool,team,id)=>(pool.length&&!pool.includes(team))||ruleOut.has(String(id));
 const poolOf=d=>d?.tracking?.pool||d?.result?.pool||(d?.rule?.text&&overview?.teams?ruleTeams(d.rule.text,overview.teams):[]);
 const kindAuto=d=>!!d.rule&&!d.rule.wertung&&d.rule.id==='eigene';
 // Nennt die Regel Vereine, heißt die Wertung nach dem Besten dieser Vereine statt nach dem MVP der ganzen Liga.
 const POOL_TITLE={volltreffer:p=>`Wer den Punktbesten von ${p} tippt, dann nächste Punktzahl`,name:p=>`Wer den Punktbesten von ${p} tippt`,
  zahl:p=>`Am nächsten an der Punktzahl des Besten von ${p}`,drunter:p=>`Punktbester von ${p}, nächste Punktzahl, nicht drüber`,korridor:p=>`Punktbester von ${p}, höchstens 25 Punkte daneben`};
 const kindTitle=(d,k)=>{const pool=poolOf(d),c=condText(condsOf(d)),base=(d.wertungen||overview?.wertungen||[]).find(w=>w.id===k)?.title||k;
  const t=pool.length?(POOL_TITLE[k]?POOL_TITLE[k](pool.join(', ')):`${base} (nur Spieler von ${pool.join(', ')})`):base;
  return c?`${t} (${c})`:t;};
 const STATE={done:'Spiel vorbei',live:'Spiel läuft',open:'noch nicht gespielt',error:'nicht abrufbar',wait:'Punkte folgen'};
 const clock=s=>s?new Date(s).toLocaleTimeString('de-DE',{hour:'2-digit',minute:'2-digit'}):'';
 // Rangfolge nach der Wertung des Spieltags. Während des Spieltags vorläufig (Punkte und MVP-Zwischenstand aus dem letzten Abgleich).
 function standings(d){
  const kind=kindOf(d),tr=d.tracking?.players||{},auto=!!kind&&kind!=='keine',pool=poolOf(d);
  const mvp=d.status==='finished'?d.result?.mvp:d.tracking?.mvp;
  const mvpIds=new Set((mvp?.players||[]).map(p=>String(p.id))),mvpPts=mvp?.players?.length&&Number.isFinite(mvp.points)?mvp.points:null;
  const needMvp=MVP_KINDS.has(kind),ready=auto&&(!needMvp||mvpPts!==null);
  const rows=d.managers.filter(m=>m.tip).map(m=>{
   const x=tr[m.tip.playerId],pts=x?.points??null,hit=mvpIds.has(String(m.tip.playerId));
   const ref=needMvp?mvpPts:pts,diff=ref===null?null:Math.abs(m.tip.points-ref);
   let ok=ready,why='';
   if(ready){
    if(!needMvp&&pts===null){ok=false;why='noch keine Punkte';}
    else if(['volltreffer','name','drunter','korridor'].includes(kind)&&!hit){ok=false;why=pool.length?'nicht der Beste der genannten Vereine':condsOf(d).length?'nicht der Beste laut Tippregel':'nicht der MVP';}
    else if(kind==='drunter'&&m.tip.points>mvpPts){ok=false;why='zu hoch getippt';}
    else if(kind==='korridor'&&diff>KORRIDOR){ok=false;why=`mehr als ${KORRIDOR} daneben`;}
   }
   if(ready&&pool.length&&!pool.includes(m.tip.team)){ok=false;why='nicht von den genannten Vereinen';}
   else if(ready&&d.tracking?.out?.[m.tip.playerId]){ok=false;why=d.tracking.out[m.tip.playerId];}
   return {m,t:m.tip,pts,state:x?.state||'wait',diff,hit,ok,why};
  });
  // Schlüssel: kleiner ist besser. "Name reicht" und "Korridor": alle Treffer gleichauf.
  const key=r=>kind==='spieler'?[-r.pts,r.diff]:kind==='name'||kind==='korridor'?[0,0]:[r.diff,0];
  const cmp=(a,b)=>{if(a.ok!==b.ok)return a.ok?-1:1;if(a.ok){const A=key(a),B=key(b);if(A[0]!==B[0])return A[0]-B[0];if(A[1]!==B[1])return A[1]-B[1];}
   return (a.pts===null)-(b.pts===null)||(b.pts??0)-(a.pts??0)||a.m.name.localeCompare(b.m.name,'de');};
  rows.sort(cmp);
  let rank=0;rows.forEach((r,i)=>{const p=rows[i-1];r.rank=!r.ok?null:p&&p.ok&&String(key(p))===String(key(r))?p.rank:(rank=i+1);});
  return {rows,lead:rows.filter(r=>r.rank===1),kind,auto,ready,needMvp,mvp,mvpPts,pool};
 }
 // Abstand: bei MVP-Wertungen zur MVP-Punktzahl, sonst zu den Punkten des getippten Spielers.
 const off=(r,toMvp,pre,post,pool)=>r.diff===null?'':pre+(r.diff?`${fmt(r.diff)} ${toMvp?(pool?'neben den Punkten des Besten':'neben den MVP-Punkten'):'daneben'}`:toMvp?(pool?'genau die Punkte des Besten':'genau die MVP-Punktzahl'):'genau getroffen')+post;

 // Cartoon-Rennen: je getipptem Spieler ein gezeichnetes Männchen im Vereinstrikot, das nach seinen Punkten über den Platz läuft.
 const CLUB_COLORS=[['bayern','#dc052d','#fff'],['dortmund','#fde100','#111'],['leverkusen','#e32221','#111'],['leipzig','#fff','#dd0741'],['frankfurt','#111','#e1000f'],['stuttgart','#fff','#e32219'],['freiburg','#e2001a','#111'],['gladbach','#fff','#00a651'],['wolfsburg','#65b32e','#fff'],['werder','#1d9053','#fff'],['bremen','#1d9053','#fff'],['union','#d4011d','#fff'],['hoffenheim','#1961b5','#fff'],['mainz','#c3141e','#fff'],['augsburg','#ba3733','#46714d'],['köln','#fff','#ed1c24'],['koeln','#fff','#ed1c24'],['heidenheim','#e2001a','#003b79'],['hamburg','#fff','#0a3f86'],['hsv','#fff','#0a3f86'],['pauli','#5c3a21','#fff'],['schalke','#004d9d','#fff'],['elversberg','#111','#fff'],['paderborn','#005ca9','#111'],['bochum','#005ca9','#fff'],['kiel','#0a3f86','#fff'],['darmstadt','#004e9f','#fff'],['berlin','#005ca9','#fff']];
 function clubColor(team){const t=String(team||'').toLowerCase(),c=CLUB_COLORS.find(([k])=>t.includes(k));if(c)return [c[1],c[2]];let n=0;for(const ch of t)n=(n*31+ch.charCodeAt(0))>>>0;return [`hsl(${n%360} 65% 45%)`,'#fff'];}
 function toon(g,shirt,trim,mood,num){
  const mouth=mood==='sad'?'M15 17 Q20 13 25 17':mood==='wow'?'M18 15 a2 2 0 1 0 4 0 a2 2 0 1 0 -4 0':'M15 14 Q20 19 25 14';
  return `<svg class="toon-fig" viewBox="0 0 40 60" aria-hidden="true">
   <g class="toon-legs"><path class="toon-leg l" d="M17 42 L13 55" /><path class="toon-leg r" d="M23 42 L27 55" /></g>
   <rect x="13" y="37" width="14" height="7" rx="2" fill="${trim}" stroke="#111" stroke-width="1"/>
   <path class="toon-shirt" d="M11 24 Q20 20 29 24 L28 39 L12 39 Z" fill="${shirt}" stroke="#111" stroke-width="1.2"/>
   <text class="toon-num" x="20" y="35" text-anchor="middle" font-size="8" font-weight="800" fill="${trim}" stroke="#111" stroke-width=".3">${num}</text>
   <g class="toon-arms"><path class="toon-arm l" d="M12 26 L6 33" /><path class="toon-arm r" d="M28 26 L34 31" /></g>
   <g class="toon-head"><circle cx="20" cy="12" r="10" fill="#f5c9a0" stroke="#111" stroke-width="1.2"/>
   <path d="M10 10 Q12 1 20 2 Q29 1 30 10 Q25 6 20 7 Q14 6 10 10Z" fill="#3b2a1a"/>
   <circle cx="16" cy="11" r="2.6" fill="#fff" stroke="#111" stroke-width=".6"/><circle cx="24" cy="11" r="2.6" fill="#fff" stroke="#111" stroke-width=".6"/>
   <circle cx="16.8" cy="11.4" r="1.2" fill="#111"/><circle cx="24.8" cy="11.4" r="1.2" fill="#111"/>
   <path d="${mouth}" fill="${mood==='wow'?'#7a2a2a':'none'}" stroke="#111" stroke-width="1.2" stroke-linecap="round"/>
   ${mood==='sad'?'<path d="M28 9 q1 3 0 4" stroke="#6ec3ff" stroke-width="1.5" fill="none"/>':''}</g>
  </svg>`;
 }
 // Kickbase liefert Bildpfade wie "content/file/….png" (Spielerfoto pim, Wappen), Bilder liegen im Kickbase-CDN.
 const kbImg=p=>!p?'':/^https?:\/\//.test(p)?p:'https://kickbase.b-cdn.net/'+String(p).replace(/^\//,'');
 const toonPhoto=(src,cls,alt)=>!src?'':`<img class="${cls}" src="${esc(src)}" alt="${esc(alt)}" loading="lazy" referrerpolicy="no-referrer" onerror="this.closest('.toon-runner')?.classList.remove('has-crest');this.remove()">`;
 // Wackelkopf: nur der Kopf, auf dem Server aus dem Kickbase-Foto ausgeschnitten (online als fertige Datei aus dem Export).
 // Lädt er nicht (kein Foto, kein Hals erkennbar), bleibt das gezeichnete Gesicht. Nie ein Kreis-Ausschnitt.
 const HEAD_VERSION=4;
 const headSrc=id=>window.KBL_STATIC?`heads/v${HEAD_VERSION}/${encodeURIComponent(id)}.png`:`/api/mvp-tipps/head/${encodeURIComponent(id)}`;
 // Auch für die Arena (public/arena.js): gleiche Männchen, Trikotfarben und Wackelköpfe.
 window.kblToon={toon,clubColor,kbImg,headSrc};
 const toonHead=(id,alt)=>`<img class="toon-face" src="${esc(headSrc(id))}" alt="${esc(alt)}" onload="this.closest('.toon-runner')?.classList.add('has-face')" onerror="this.remove()">`;
 function toonRace(live,groups,leadIds,bestIds,me,best,pool,auto=false){
  const byId=new Map((players||[]).map(p=>[String(p.id),p]));
  if(!groups.length)return '';
  const vals=[...groups.map(g=>g.pts??0),...(best?[best.points]:[])],lo=Math.min(0,...vals),hi=Math.max(1,...vals),span=hi-lo;
  const pos=v=>(4+78*((v??0)-lo)/span).toFixed(1);
  // Alle Figuren auf einem Platz (Kevin-Wunsch): x nach Punkten, je Spieler eine eigene Höhe, damit sich niemand verdeckt.
  // ROW: Kopf (ragt ~25px über den Körper) + Körper (60px), Name steht daneben; so verdeckt bei gleichen Punkten niemand den anderen.
  const ROW=88,TOP=104;
  const runner=(o,row)=>{const info=byId.get(String(o.id)),face=kbImg(info?.img),crest=kbImg(info?.teamImg),[shirt,trim]=clubColor(o.team),x=pos(o.pts);
   return `<div class="toon-runner${o.run}${x>50?' flip':''}${crest?' has-crest':''}${o.ghost?' leader':''}${o.crown?' champ':''}${o.party?' tag-down':''}" style="left:${x}%;top:${Y(row)-60}px;z-index:${row+2}">
    ${o.crown?'<div class="toon-crown">👑</div>':''}<div class="toon-body">${toon({},shirt,trim,o.mood,o.num)}${face?toonHead(o.id,o.name):''}${toonPhoto(crest,'toon-crest',o.team)}</div>${o.run===' run'?'<span class="toon-ball">⚽</span>':''}${o.ko?'<span class="toon-dizzy">💫</span>':''}
    <div class="toon-tag">${esc(o.name)} <b>${o.pts===null?'–':fmt(o.pts)}</b>${o.ko?' <span class="toon-ko">K.O.</span>':''}</div></div>`;};
  const figs=[];
  // Ist der Beste selbst getippt, trägt er die Krone im Rennen; halbtransparent nur, wen keiner getippt hat.
  const tipped=new Set(groups.map(g=>String(g.t.playerId)));
  if(best)best.players.filter(p=>!tipped.has(String(p.id))).forEach(p=>figs.push({id:p.id,name:p.name,team:p.team,pts:best.points,crown:true,ghost:true,mood:'wow',num:'★',run:''}));
  // K.O. auf dem Rasen (Kevin-Wunsch): wer nicht mehr gewinnen kann, also Spiel vorbei und weniger Punkte als der gerade Beste,
  // oder (bei genannten Vereinen) gar nicht aus diesen Vereinen ist.
  const ko=g=>!bestIds.has(String(g.t.playerId))&&(offRule(pool,g.t.team,g.t.playerId)||(!!best&&g.state==='done'&&g.pts!==null&&g.pts<best.points));
  groups.forEach(g=>{const neg=g.pts!==null&&g.pts<0,k=ko(g);
   figs.push({id:g.t.playerId,name:g.t.player,team:g.t.team,pts:g.pts,crown:bestIds.has(String(g.t.playerId)),ko:k,mood:neg||k?'sad':g.place===1&&g.pts!==null?'wow':'happy',num:g.place??'?',
    run:k?' ko':g.state==='live'?' run':g.state==='open'||g.state==='wait'?' idle':neg?' fall':''});});
  // Kevin-Wunsch: Wer den Sieger-Spieler getippt hat und nach der Wertung vorne liegt, tanzt direkt neben ihm.
  // Wer den richtigen Spieler, aber eine andere Zahl getippt hat, liegt weinend daneben. Ohne Wertung tanzen alle seine Tipper.
  const right=best?groups.filter(g=>bestIds.has(String(g.t.playerId))).flatMap(g=>g.rs):[];
  const fans=right.filter(r=>!auto||leadIds.has(r.m.id)),losers=auto?right.filter(r=>!leadIds.has(r.m.id)):[];
  const wi=figs.findIndex(f=>f.crown);
  // Kevin-Wunsch: alle in der Zeile des Siegers, direkt links neben ihm die Tanzenden, daneben auf gleicher Höhe die Weinenden.
  // Der Name des Siegers steht dann über der Krone (oben 24px mehr Platz), die der Tänzer unter den Füßen (Zeilen darunter rücken um PARTY nach unten).
  const party=wi>=0&&(fans.length||losers.length),PARTY=12;
  if(party)figs[wi].party=true;
  const Y=row=>TOP+(party?24:0)+row*ROW+(party&&row>wi?PARTY:0);
  const face=window.kblMgrFace||(()=>'');
  const edge=o=>`${(100-Number(pos(o.pts))).toFixed(1)}%`,fansW=fans.length?fans.length*52-12+10:0;
  const dancers=(o,row)=>(losers.length?mourners(o,row):'')+(fans.length?`<div class="toon-dancers" style="right:calc(${edge(o)} + 2px);top:${Y(row)-84}px">${fans.map(r=>`<div class="toon-dancer"><div class="toon-dancer-body">${toon({},'#d4a017','#fff','wow','')}<span class="toon-dancer-face">${face(r.m.name,'',r.m.id)}</span></div><span class="toon-dancer-name">${esc(r.m.name)} <b>${fmt(r.t.points)}</b></span></div>`).join('')}</div>`:'');
  const mourners=(o,row)=>`<div class="toon-mourners" style="right:calc(${edge(o)} + ${2+fansW}px);top:${Y(row)-74}px">${losers.map(r=>`<div class="toon-mourner"><div class="toon-mourner-body">${toon({},'#6b7280','#fff','sad','')}<span class="toon-mourner-face">${face(r.m.name,'',r.m.id)}</span></div><span class="toon-tears">💧</span><span class="toon-mourner-name">${esc(r.m.name)}</span></div>`).join('')}</div>`;
  const pitch=`<div class="toon-pitch" style="height:${Y(figs.length-1)+40}px"><i class="tp-start"></i><i class="tp-mid"></i><i class="tp-circle"></i><i class="tp-finish"></i>${figs.map((o,row)=>runner(o,row)+(o.party?dancers(o,row):'')).join('')}</div>`;
  // Kevin-Wunsch: in der Liste der beste getippte Spieler (bei genannten Vereinen nur aus diesen), nicht der Beste der Vereine.
  const cand=groups.filter(g=>g.pts!==null&&!offRule(pool,g.t.team,g.t.playerId)),top=cand.length?Math.max(...cand.map(g=>g.pts)):null,tops=cand.filter(g=>g.pts===top);
  const ghostLine=tops.length?`<div class="toon-row ghost"><span class="mvp-rank">👑</span><span class="muted">Gerade bester getippter Spieler:</span> <b>${tops.map(g=>esc(g.t.player)).join(', ')}</b> <small class="muted">${esc([...new Set(tops.map(g=>g.t.team))].join(', '))}</small><span class="toon-pts">${fmt(top)}<small> Pkt.</small></span></div>`:'';
  const rows=groups.map(g=>`<div class="toon-row${bestIds.has(String(g.t.playerId))?' best':''}"><span class="mvp-rank">${g.place??'–'}</span><b>${esc(g.t.player)}</b> <small class="muted">${esc(g.t.team)}</small><span class="toon-pts">${g.pts===null?'–':fmt(g.pts)}<small> Pkt.</small></span>
    <div class="mvp-lane-tips"><small class="muted">Fans:</small> ${g.rs.map(r=>`<span class="mvp-chip${leadIds.has(r.m.id)?' lead':''}${r.m.id===me?' me':''}">${mn(r.m.name,r.m.id)} <b>${fmt(r.t.points)}</b>${r.t.late?'<sup>*</sup>':''}</span>`).join('')}</div></div>`).join('');
  // Während des Spieltags gleich offen und ohne Erklärtext (Kevin-Wunsch, Ausnahme von der Zuklapp-Regel: kbl-keep-open).
  return `<details class="acc-group toon-race${live?' kbl-keep-open':''}"${live?' open':''} style="margin-top:14px"><summary>Rennen der getippten Spieler</summary><div class="acc-sub">${pitch}<div class="toon-list">${ghostLine}${rows}</div>${live?'':`<p class="muted tiny">Je mehr Punkte, desto weiter rechts. Mit Krone: wer gerade nach der Tippregel vorne liegt. Halbtransparent und am Boden: wer nicht mehr gewinnen kann. Wer gerade spielt, rennt mit Ball, bei Minuspunkten liegt er auf der Nase. Bei den Fans steht die getippte Zahl${groups.some(g=>g.rs.some(r=>r.t.late))?', * = nachgetragen':''}.</p>`}</div></details>`;
 }
 // Zeitraffer (Kevin-Wunsch): der Spieltag als Animation aus den gespeicherten Zwischenständen (d.verlauf, Server kbl-mvp-verlauf.json).
 // Gleiche Männchen wie im Rennen; Krone = Bester nach der Tippregel zu dem Zeitpunkt, oben die Führenden nach der Wertung.
 // Korrekturen = Punkte ändern sich, obwohl das Spiel schon vorbei war; der letzte Stand nach Spieltagsende kommt aus den Leistungsdaten.
 const zr={day:null,i:0,timer:null,speed:1,autoplay:false,full:false,video:false};
 let zrGroups=null;
 const zrWhen=s=>new Date(s).toLocaleString('de-DE',{weekday:'short',hour:'2-digit',minute:'2-digit',timeZone:'Europe/Berlin'}).replace(',','');
 function zrFrames(d){
  const tipped=new Map(d.managers.filter(m=>m.tip).map(m=>[String(m.tip.playerId),m.tip])),pool=poolOf(d);
  // Kevin: das Rennen beginnt beim Anpfiff bei 0, erst danach kommen die gespeicherten Stände.
  const raw=d.verlauf||[],t0=d.deadline&&raw.length&&Date.parse(d.deadline)<Date.parse(raw[0].at)?d.deadline:null;
  const start=t0?[{at:t0,start:true,players:Object.fromEntries([...tipped.keys()].map(id=>[id,{points:0,state:'open'}])),best:null,fixes:[],lead:[],ready:false}]:[];
  return start.concat(raw.map((f,i,all)=>{
   const players={};for(const [id,[points,s]] of Object.entries(f.p||{}))players[id]={points,state:s==='d'?'done':s==='l'?'live':'open'};
   // Wie auf dem Server (freshBest): getippte Spieler haben frischere Punkte als der Zwischenstand aller Spieler.
   let best=f.mvp?{points:f.mvp.points,players:f.mvp.players.map(p=>({...p}))}:null;
   for(const [id,x] of Object.entries(players)){const t=tipped.get(id);if(!t||offRule(pool,t.team,id))continue;
    if(!best||x.points>best.points)best={points:x.points,players:[{id,name:t.player,team:t.team}]};
    else if(x.points===best.points&&!best.players.some(p=>p.id===id))best.players.push({id,name:t.player,team:t.team});}
   if(best&&f.mvp)best.players=best.players.filter(p=>f.mvp.players.some(m=>m.id===p.id)||players[p.id]?.points===best.points);
   const prev=all[i-1],fixes=[];
   if(prev)for(const [id,x] of Object.entries(players)){const o=prev.p?.[id];if(o&&o[1]==='d'&&o[0]!==x.points)fixes.push({id,from:o[0],to:x.points,name:tipped.get(id)?.player||id});}
   const st=standings({...d,status:'live',result:null,tracking:{players,pool,mvp:best}});
   return {at:f.at,fin:!!f.fin,players,best,fixes,lead:st.ready?st.lead:[],ready:st.ready};
  }));
 }
 function zrMoments(frames){
  const out=[];let lastBest='',lastLead='';
  frames.forEach((f,i)=>{
   const b=(f.best?.players||[]).map(p=>p.id).sort().join(),l=f.lead.map(r=>r.m.id).sort().join();
   const fx=f.fixes.map(x=>`${esc(x.name)} ${fmt(x.from)} → <b>${fmt(x.to)}</b>`).join(', ');
   if(f.fin)out.push({i,ico:'🏁',fix:!!fx,txt:`Spieltag beendet, Wertung nach den Kickbase-Leistungsdaten${f.best?`: <b>${f.best.players.map(p=>esc(p.name)).join(', ')}</b> mit ${fmt(f.best.points)}`:''}${fx?`<br><small>Geändert: ${fx}</small>`:''}`});
   else if(fx)out.push({i,ico:'✏️',fix:true,txt:`Korrektur nach Abpfiff: ${fx}`});
   if(b&&b!==lastBest&&!f.fin)out.push({i,ico:'👑',txt:`${f.best.players.map(p=>`<b>${esc(p.name)}</b>`).join(', ')} ${i?'übernimmt':'vorne'} mit ${fmt(f.best.points)} Punkten`});
   if(l!==lastLead&&f.lead.length)out.push({i,ico:'🕺',txt:`Führend: ${f.lead.map(r=>`<b>${esc(r.m.name)}</b> (${esc(r.t.player)} ${fmt(r.t.points)})`).join(', ')}`});
   lastBest=b;lastLead=l;
  });
  return out;
 }
 function zeitraffer(d,groups){
  const frames=zrFrames(d);if(frames.length<2)return '';
  const ghosts=[...new Map(frames.flatMap(f=>(f.best?.players||[]).filter(p=>!groups.some(g=>String(g.t.playerId)===p.id)).map(p=>[p.id,p]))).values()];
  const moments=zrMoments(frames),n=frames.length;
  return `<details class="acc-group zr" data-zr data-zr-ghosts="${esc(JSON.stringify(ghosts))}" style="margin-top:14px"><summary>🎬 Spieltag im Zeitraffer</summary><div class="acc-sub">
   <div class="zr-hud"><div class="zr-clock" data-zr-clock></div><div class="zr-lead" data-zr-lead></div><button type="button" class="ghost zr-close" data-zr-close aria-label="Vollbild schließen">✕</button></div>
   <div class="zr-pitch-wrap"><div class="toon-pitch zr-pitch" data-zr-pitch></div><div class="zr-flash" data-zr-flash hidden></div></div>
   <div class="zr-ctrl"><button type="button" class="gold zr-play" data-zr-play aria-label="Abspielen">▶</button>
    <div class="zr-track"><input type="range" min="0" max="${n-1}" value="0" data-zr-seek aria-label="Zeitpunkt"><div class="zr-marks">${moments.filter(m=>m.fix||m.ico==='👑'||m.ico==='🏁').map(m=>`<i class="${m.ico==='🏁'?'fin':m.fix?'fix':'lead'}" style="left:${(m.i/(n-1)*100).toFixed(1)}%"></i>`).join('')}</div></div>
    <button type="button" class="ghost zr-speed" data-zr-speed>1×</button><button type="button" class="ghost zr-fullbtn" data-zr-full aria-label="Vollbild">⛶</button></div>
   <div class="zr-vid"><button type="button" class="ghost" data-zr-video>⬇ Video herunterladen</button><span class="muted tiny" data-zr-vstat></span></div>
   <details class="acc-group zr-list"><summary>Wichtige Momente (${moments.length})</summary><ol class="zr-moments">${moments.map(m=>`<li data-zr-go="${m.i}"${m.fix?' class="fix"':''}><span class="zr-t">${esc(zrWhen(frames[m.i].at))}</span><span>${m.ico}</span><span>${m.txt}</span></li>`).join('')}</ol></details>
   <p class="muted tiny">Aus ${(d.verlauf||[]).length} gespeicherten Zwischenständen (während der Spiele etwa alle 5 bis 30 Minuten). Je mehr Punkte, desto weiter rechts; 👑 = Bester nach der Tippregel zu dem Zeitpunkt (Zwischenstand aller Spieler höchstens alle 30 Min., getippte Spieler frischer). ✏️ = Punkte haben sich nach Abpfiff noch geändert (Kickbase-Korrektur). 🏁 = Wert nach Spieltagsende aus den Kickbase-Leistungsdaten. Gelbe Striche auf der Zeitleiste: Führungswechsel, rote: Korrekturen.</p>
  </div></details>`;
 }
 function zrMount(root,d,groups){
  const box=root.querySelector('[data-zr]');if(!box)return;
  const frames=zrFrames(d),n=frames.length,pool=poolOf(d),ghosts=JSON.parse(box.dataset.zrGhosts||'[]');
  if(zr.day!==d.day){zr.day=d.day;zr.i=n-1;zrStop();zr.full=false;document.body.classList.remove('zr-on');}
  zr.i=Math.min(zr.i,n-1);
  const byId=new Map((players||[]).map(p=>[String(p.id),p]));
  const final=frames[n-1].players;
  const rowsList=[...ghosts.map(p=>({id:p.id,name:p.name,team:p.team,ghost:true,rs:[]})),
   ...groups.map(g=>({id:String(g.t.playerId),name:g.t.player,team:g.t.team,rs:g.rs})).sort((a,b)=>(final[b.id]?.points??-1e9)-(final[a.id]?.points??-1e9))];
  const vals=frames.flatMap(f=>[...Object.values(f.players).map(x=>x.points),f.best?.points??0]),lo=Math.min(0,...vals),hi=Math.max(1,...vals);
  const pos=v=>(4+78*((v??0)-lo)/(hi-lo));
  const ROW=78,TOP=96,Y=r=>TOP+r*ROW;
  const pitch=box.querySelector('[data-zr-pitch]');
  pitch.style.height=Y(rowsList.length-1)+40+'px';
  pitch.innerHTML='<i class="tp-start"></i><i class="tp-mid"></i><i class="tp-circle"></i><i class="tp-finish"></i>'+rowsList.map((o,r)=>{
   const info=byId.get(o.id),crest=kbImg(info?.teamImg),[shirt,trim]=clubColor(o.team);
   return `<div class="toon-runner zr-runner${crest?' has-crest':''}${o.ghost?' leader zr-ghost':''}" data-zr-id="${esc(o.id)}" style="left:4%;top:${Y(r)-60}px;z-index:${r+2}">
    <div class="toon-crown">👑</div><div class="toon-body">${toon({},shirt,trim,'happy',o.ghost?'★':'')}${toonHead(o.id,o.name)}${toonPhoto(crest,'toon-crest',o.team)}</div><span class="toon-ball">⚽</span><span class="toon-dizzy">💫</span>
    <div class="toon-tag">${esc(o.name)} <b data-zr-pts>–</b><span class="zr-fix" data-zr-fix></span></div>
    ${o.rs.length?`<div class="zr-fans">${o.rs.map(r=>`<span data-zr-m="${esc(r.m.id)}" title="${esc(r.m.name)} tippt ${esc(fmt(r.t.points))}">${(window.kblMgrFace||(()=>''))(r.m.name,'',r.m.id)}<small>${esc(fmt(r.t.points))}</small></span>`).join('')}</div>`:''}</div>`;}).join('');
  const show=i=>{
   zr.i=i;const f=frames[i],bestIds=new Set((f.best?.players||[]).map(p=>p.id)),leadIds=new Set(f.lead.map(r=>r.m.id));
   const sk=box.querySelector('[data-zr-seek]');sk.value=String(i);sk.style.setProperty('--f',String(n>1?i/(n-1):0));
   box.querySelector('[data-zr-clock]').innerHTML=`<b>${esc(zrWhen(f.at))}</b> <small>${f.start?'Anpfiff':f.fin?'🏁 nach Spieltagsende':i===n-1?'letzter Stand':`Stand ${i+1} von ${n}`}</small>`;
   box.querySelector('[data-zr-lead]').innerHTML=f.best?`👑 <b>${f.best.players.map(p=>esc(p.name)).join(', ')}</b> ${fmt(f.best.points)}${f.lead.length?` <span class="zr-sep">·</span> führend: ${f.lead.map(r=>mn(r.m.name,r.m.id)).join(', ')}`:f.ready?' <span class="zr-sep">·</span> keiner vorne':''}`:`<span class="muted">${f.start?'Alle starten bei 0':'Noch kein Zwischenstand'}</span>`;
   pitch.querySelectorAll('[data-zr-id]').forEach(el=>{
    const id=el.dataset.zrId,o=rowsList.find(x=>x.id===id),x=f.players[id],isBest=bestIds.has(id),pts=o.ghost?(isBest?f.best.points:null):x?.points??null;
    const out=!isBest&&(offRule(pool,o.team,o.id)||(!!f.best&&x?.state==='done'&&pts!==null&&pts<f.best.points));
    const left=pos(pts);el.style.left=left.toFixed(1)+'%';
    el.classList.toggle('flip',left>50);el.classList.toggle('champ',isBest);el.classList.toggle('zr-off',!!o.ghost&&!isBest);
    el.classList.toggle('run',!out&&x?.state==='live');el.classList.toggle('idle',!o.ghost&&pts===null);el.classList.toggle('ko',out);
    el.querySelector('[data-zr-pts]').textContent=pts===null?'–':fmt(pts);
    const fx=f.fixes.find(z=>z.id===id),fe=el.querySelector('[data-zr-fix]');
    fe.textContent=fx?` ✏️ ${fx.to>fx.from?'+':''}${fmt(fx.to-fx.from)}`:'';el.classList.toggle('zr-fixed',!!fx);
    el.querySelectorAll('[data-zr-m]').forEach(m=>m.classList.toggle('lead',leadIds.has(m.dataset.zrM)));
   });
   const fl=box.querySelector('[data-zr-flash]');
   if(f.fixes.length){fl.hidden=false;fl.innerHTML=`✏️ ${f.fin?'Endwert nach Spieltagsende':'Kickbase-Korrektur'}: ${f.fixes.map(z=>`${esc(z.name)} ${fmt(z.from)} → <b>${fmt(z.to)}</b>`).join(', ')}`;fl.classList.remove('pop');void fl.offsetWidth;fl.classList.add('pop');}
   else fl.hidden=true;
   box.querySelectorAll('[data-zr-go]').forEach(li=>li.classList.toggle('now',Number(li.dataset.zrGo)===i));
  };
  const btn=box.querySelector('[data-zr-play]');
  const tick=()=>{if(zr.i>=n-1){zrStop();btn.textContent='▶';return;}show(zr.i+1);zr.timer=setTimeout(tick,(frames[zr.i].fixes.length?2600:1500)/zr.speed);};
  btn.onclick=()=>{if(zr.timer){zrStop();btn.textContent='▶';return;}if(zr.i>=n-1)show(0);btn.textContent='⏸';zr.timer=setTimeout(tick,900/zr.speed);};
  box.querySelector('[data-zr-seek]').oninput=e=>{zrStop();btn.textContent='▶';show(Number(e.target.value));};
  box.querySelector('[data-zr-speed]').onclick=e=>{zr.speed=zr.speed===1?2:zr.speed===2?4:1;e.target.textContent=zr.speed+'×';};
  box.querySelector('[data-zr-speed]').textContent=zr.speed+'×';
  box.querySelectorAll('[data-zr-go]').forEach(li=>li.onclick=()=>{zrStop();btn.textContent='▶';show(Number(li.dataset.zrGo));});
  // Beim Aufklappen von vorn abspielen; Wackelköpfe und Wappen brauchen die Spielerliste.
  // Vollbild (Kevin-Wunsch): alle Spieler, Zeit und Steuerung auf einem Bildschirm; der Platz wird passend verkleinert.
  // Am PC zusätzlich Browser-Vollbild, am Handy nur über die ganze Seite (wie in der BumsParade, kein Browser-Hinweis).
  const pw=box.querySelector('.zr-pitch-wrap');
  zr.fit=()=>{if(!box.isConnected)return;
   if(!zr.full){pitch.style.transform='';pitch.style.width='';pw.style.height='';return;}
   pitch.style.transform='';pitch.style.width='';
   const h=pitch.offsetHeight,sc=Math.min(1,pw.clientHeight/h);
   pitch.style.transformOrigin='0 0';pitch.style.width=(100/sc)+'%';pitch.style.transform=`scale(${sc})`;};
  const setFull=on=>{zr.full=on;box.classList.toggle('zr-full',on);document.body.classList.toggle('zr-on',on);
   if(on){box.open=true;if(matchMedia('(pointer:fine)').matches)try{document.documentElement.requestFullscreen?.().catch(()=>{});}catch{}}
   else try{if(document.fullscreenElement)document.exitFullscreen();}catch{}
   requestAnimationFrame(zr.fit);};
  zr.exit=()=>setFull(false);
  box.querySelector('[data-zr-full]').onclick=()=>{setFull(true);if(!zr.timer){if(zr.i>=n-1)show(0);btn.click();}};
  box.querySelector('[data-zr-close]').onclick=()=>setFull(false);
  if(zr.full){box.classList.add('zr-full');document.body.classList.add('zr-on');requestAnimationFrame(zr.fit);}
  const vb=box.querySelector('[data-zr-video]'),vs=box.querySelector('[data-zr-vstat]');
  if(zr.video){vb.disabled=true;vs.textContent='Video wird aufgenommen …';}
  vb.onclick=async()=>{if(zr.video)return;zr.video=true;vb.disabled=true;zrStop();btn.textContent='▶';
   const stat=t=>{const el=document.querySelector('[data-zr-vstat]');if(el)el.textContent=t;};
   try{const marks=zrMoments(frames).filter(m=>m.fix||m.ico==='👑'||m.ico==='🏁').map(m=>({i:m.i,cls:m.ico==='🏁'?'fin':m.fix?'fix':'lead'}));
    const {blob,ext}=await zrVideo({d,frames,rowsList,pos,pool,byId,marks},stat);
    const name=`MVP-Zeitraffer-Spieltag-${d.day}.${ext}`,url=URL.createObjectURL(blob),a=document.createElement('a');
    a.href=url;a.download=name;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),60000);
    stat(`Fertig: ${name} (${(blob.size/1e6).toFixed(1).replace('.',',')} MB).`);
   }catch(e){stat('Video nicht möglich: '+e.message);}
   finally{zr.video=false;const b=document.querySelector('[data-zr-video]');if(b)b.disabled=false;}};
  if(box.open)box.dataset.zrSkip='1';// beim Neuladen wieder aufgeklappt: nicht von vorn starten
  box.ontoggle=()=>{if(box.dataset.zrSkip){delete box.dataset.zrSkip;return;}
   if(!box.open){zrStop();btn.textContent='▶';return;}
   if(!players){zr.autoplay=true;loadPlayers().then(()=>render()).catch(()=>{});return;}
   if(!zr.timer&&zr.i===n-1&&!matchMedia('(prefers-reduced-motion: reduce)').matches){show(0);btn.click();}};
  show(zr.i);
  if(zr.autoplay&&box.open&&!zr.timer){zr.autoplay=false;show(0);btn.click();return;}
  // Lief die Animation beim Neuladen (alle 2 Min.), läuft sie im neuen Kasten weiter.
  if(zr.timer){zrStop();if(box.open){btn.textContent='⏸';zr.timer=setTimeout(tick,1500/zr.speed);}}
 }
 // Zeitraffer als Video herunterladen (Kevin-Wunsch): im Browser auf einer Leinwand (1080×1920, Hochformat fürs Handy)
 // nachgezeichnet und mit MediaRecorder aufgenommen, MP4 wenn der Browser es kann, sonst WebM. Läuft in Echtzeit.
 // Bilder von fremden Servern (Kickbase-CDN) nur, wenn sie CORS erlauben; Manager-Bilder darum über den eigenen Server bzw. site/faces/.
 async function zrVideo(o,onStat){
  const {d,frames,rowsList,pos,pool,byId}=o,n=frames.length,W=1080,H=1920;
  if(!window.MediaRecorder||!HTMLCanvasElement.prototype.captureStream)throw new Error('Dieser Browser kann keine Videos aufnehmen.');
  const mime=['video/mp4;codecs=avc1','video/mp4','video/webm;codecs=vp9','video/webm'].find(m=>MediaRecorder.isTypeSupported(m));
  if(!mime)throw new Error('Dieser Browser kann keine Videos aufnehmen.');
  onStat('Bilder werden geladen …');
  const load=src=>!src?Promise.resolve(null):new Promise(r=>{const i=new Image();i.crossOrigin='anonymous';i.onload=()=>r(i);i.onerror=()=>r(null);i.src=src;setTimeout(()=>r(null),8000);});
  // Manager-Bilder: das Kickbase-CDN erlaubt kein CORS, darum online aus site/faces/ (Export), am PC über /api/mgr-img.
  const faceSrc=m=>{const h=(window.kblMgrFace||(()=>''))(m.name,'',m.id),x=/src="([^"]+)"/.exec(h),u=x?x[1].replace(/&amp;/g,'&'):'',k=/kickbase\.b-cdn\.net\/(user\/([\w.-]+))$/.exec(u);
   return !k?u:window.KBL_STATIC?'faces/'+k[2].replace(/\.(jpe|jpeg)$/i,'.jpg'):'/api/mgr-img?p='+encodeURIComponent(k[1]);};
  const heads=new Map(),crests=new Map(),faces=new Map();
  await Promise.all(rowsList.map(async r=>{heads.set(r.id,await load(headSrc(r.id)));crests.set(r.id,await load(kbImg(byId.get(r.id)?.teamImg)));
   for(const x of r.rs)if(!faces.has(x.m.id))faces.set(x.m.id,await load(faceSrc(x.m)));}));
  const cv=document.createElement('canvas');cv.width=W;cv.height=H;const c=cv.getContext('2d');
  // Ablauf: Start 1,5 s stehen, je Stand 1,2 s Bewegung und 0,8 s stehen (Korrekturen 2,4 s), am Ende 3 s.
  const seg=[];let T=1.5;
  for(let k=1;k<n;k++){const hold=frames[k].fixes.length?2.4:k===n-1?3:0.8;seg.push({k,t0:T,t1:T+1.2,t2:T+1.2+hold});T+=1.2+hold;}
  const ease=x=>x<.5?2*x*x:1-Math.pow(-2*x+2,2)/2;
  const PX=40,PY=300,PW=W-80,PH=1360,rows=rowsList.length,RH=Math.min(150,PH/Math.max(rows,1)),S=RH/150;
  const font=(sz,w=700)=>`${w} ${Math.round(sz)}px system-ui,-apple-system,Segoe UI,Roboto,sans-serif`;
  const rr=(x,y,w,h,r)=>{c.beginPath();c.moveTo(x+r,y);c.arcTo(x+w,y,x+w,y+h,r);c.arcTo(x+w,y+h,x,y+h,r);c.arcTo(x,y+h,x,y,r);c.arcTo(x,y,x+w,y,r);c.closePath();};
  const fit=(t,max)=>{if(c.measureText(t).width<=max)return t;while(t.length>1&&c.measureText(t+'…').width>max)t=t.slice(0,-1);return t+'…';};
  const ptsAt=(f,r)=>{const isBest=(f.best?.players||[]).some(p=>p.id===r.id);return r.ghost?(isBest?f.best.points:null):f.players[r.id]?.points??null;};
  function figure(r,x,y,f,time,alphaGhost){
   const x0=f.players[r.id],isBest=(f.best?.players||[]).some(p=>p.id===r.id),pts=ptsAt(f,r);
   const ko=!isBest&&(offRule(pool,r.team,r.id)||(!!f.best&&x0?.state==='done'&&pts!==null&&pts<f.best.points));
   const run=!ko&&x0?.state==='live',[shirt,trim]=clubColor(r.team),flip=(x-PX)/PW>.5;
   c.save();c.globalAlpha=r.ghost?alphaGhost:ko?.45:1;c.translate(x,y);c.scale(S,S);
   if(ko)c.rotate(flip?Math.PI/2:-Math.PI/2);
   const bob=run?Math.sin(time*16)*3:isBest?Math.sin(time*8)*2:0,sw=run?Math.sin(time*16)*.5:0;
   c.lineCap='round';c.strokeStyle='#f5c9a0';c.lineWidth=6;
   [[-5,1],[5,-1]].forEach(([dx,dir])=>{c.save();c.translate(dx,-10);c.rotate(sw*dir);c.beginPath();c.moveTo(0,0);c.lineTo(0,26);c.stroke();c.restore();});
   c.translate(0,bob);
   const arm=isBest?Math.sin(time*14)*.7:-sw;
   [[-15,-50,1],[15,-50,-1]].forEach(([dx,dy,dir])=>{c.save();c.translate(dx,dy);c.rotate((dir>0?.5:-.5)+arm*dir);c.beginPath();c.moveTo(0,0);c.lineTo(0,24);c.stroke();c.restore();});
   c.fillStyle=trim;rr(-14,-16,28,12,3);c.fill();
   c.fillStyle=shirt;c.strokeStyle='#111';c.lineWidth=2;c.beginPath();c.moveTo(-18,-56);c.quadraticCurveTo(0,-64,18,-56);c.lineTo(16,-14);c.lineTo(-16,-14);c.closePath();c.fill();c.stroke();
   const cr=crests.get(r.id);if(cr)c.drawImage(cr,-9,-46,18,18);
   const hd=heads.get(r.id);
   if(hd){const h=96,w=Math.min(110,h*hd.width/hd.height);c.drawImage(hd,-w/2,-56-h+4,w,h);}
   else{c.fillStyle='#f5c9a0';c.beginPath();c.arc(0,-82,22,0,7);c.fill();c.stroke();c.fillStyle='#111';c.beginPath();c.arc(-7,-84,3,0,7);c.arc(7,-84,3,0,7);c.fill();}
   if(isBest){c.font='44px serif';c.textAlign='center';c.fillText('👑',0,-150);}
   if(run){c.font='26px serif';c.textAlign='left';c.fillText('⚽',18,6);}
   c.restore();
   return {pts,ko,isBest,flip};
  }
  function draw(time){
   let k=0,p=1;for(const s of seg){if(time>=s.t0){k=s.k;p=Math.min(1,(time-s.t0)/1.2);}}
   const f=frames[k],prev=frames[Math.max(0,k-1)],e=ease(p);
   c.fillStyle='#081118';c.fillRect(0,0,W,H);
   // Kopf: Titel, Uhrzeit, Krone und Führende
   c.textAlign='left';c.fillStyle='#9db0bd';c.font=font(34,800);c.fillText(`MVP-TIPP · SPIELTAG ${d.day} · ZEITRAFFER`,PX,80);
   c.fillStyle='#f4d777';c.font=font(80,900);c.fillText(zrWhen(f.at),PX,170);
   const cw=c.measureText(zrWhen(f.at)).width;c.fillStyle='#9db0bd';c.font=font(36,600);
   c.fillText(f.start?'Anpfiff':f.fin?'🏁 nach Spieltagsende':`Stand ${k+1} von ${n}`,PX+cw+24,170);
   c.fillStyle='#e9f0f4';c.font=font(40,700);
   const lead=f.best?`👑 ${f.best.players.map(x=>x.name).join(', ')} ${fmt(f.best.points)}${f.lead.length?` · führend: ${f.lead.map(r=>r.m.name).join(', ')}`:f.ready?' · keiner vorne':''}`:f.start?'Alle starten bei 0':'Noch kein Zwischenstand';
   c.fillText(fit(lead,PW),PX,240);
   // Platz
   c.save();rr(PX,PY,PW,PH,18);c.clip();
   for(let i=0;i*60<PW;i++){c.fillStyle=i%2?'#348a40':'#2f7d3a';c.fillRect(PX+i*60,PY,60,PH);}
   c.strokeStyle='rgba(255,255,255,.4)';c.lineWidth=3;c.beginPath();c.moveTo(PX+PW*.04,PY);c.lineTo(PX+PW*.04,PY+PH);c.moveTo(PX+PW/2,PY);c.lineTo(PX+PW/2,PY+PH);c.stroke();
   c.beginPath();c.arc(PX+PW/2,PY+PH/2,90,0,7);c.stroke();
   for(let y=0;y<PH;y+=16){c.fillStyle='#fff';c.fillRect(PX+PW-16+((y/16)%2?8:0),PY+y,8,8);c.fillStyle='#111';c.fillRect(PX+PW-16+((y/16)%2?0:8),PY+y,8,8);}
   const leadIds=new Set(f.lead.map(r=>r.m.id));
   rowsList.forEach((r,i)=>{
    const a=ptsAt(prev,r),b=ptsAt(f,r),va=a??(r.ghost?b:0),vb=b??(r.ghost?a:0);
    const v=(va??0)+((vb??0)-(va??0))*e,x=PX+PW*pos(v)/100,y=PY+(i+.5)*RH+RH*.38;
    const pb=(prev.best?.players||[]).some(q=>q.id===r.id),fb=(f.best?.players||[]).some(q=>q.id===r.id);
    const ga=r.ghost?(pb&&fb?1:fb?e:pb?1-e:0):1;if(r.ghost&&ga<=0.01)return;
    const st=figure(r,x,y,f,time,ga*.9);
    // Name und Punkte daneben, darunter die Tipper (Gold = führend)
    c.save();c.globalAlpha=r.ghost?ga:st.ko?.6:1;c.font=font(30*S,800);
    const fx=f.fixes.find(z=>z.id===r.id)&&p>=1;
    const label=`${r.name} ${b===null&&!r.ghost?'–':fmt(Math.round(v))}${fx?` ✏️ ${f.fixes.find(z=>z.id===r.id).to-f.fixes.find(z=>z.id===r.id).from>0?'+':''}${fmt(f.fixes.find(z=>z.id===r.id).to-f.fixes.find(z=>z.id===r.id).from)}`:''}`;
    const tw=c.measureText(label).width+20*S,th=40*S,tx=st.flip?x-34*S-tw:x+34*S,ty=y-70*S;
    c.fillStyle=fx?'#c0392b':'rgba(0,0,0,.6)';rr(tx,ty,tw,th,10*S);c.fill();
    c.fillStyle='#fff';c.textAlign='left';c.fillText(label,tx+10*S,ty+29*S);
    let fxp=tx;const fs=30*S;
    const chips=r.rs.map(x=>({m:x.m,t:fmt(x.t.points)}));c.font=font(22*S,700);
    const cwid=chips.map(ch=>fs+8*S+c.measureText(ch.t).width+10*S);const total=cwid.reduce((s,w)=>s+w+6*S,0);
    if(st.flip)fxp=tx+tw-total;
    chips.forEach((ch,j)=>{const w=cwid[j],cy=ty+th+8*S,ld=leadIds.has(ch.m.id);
     c.fillStyle=ld?'#b48633':'rgba(0,0,0,.5)';rr(fxp,cy,w,fs,fs/2);c.fill();if(ld){c.strokeStyle='#ebc768';c.lineWidth=3*S;c.stroke();}
     const im=faces.get(ch.m.id);c.save();c.beginPath();c.arc(fxp+fs/2,cy+fs/2,fs/2-2*S,0,7);c.clip();
     if(im)c.drawImage(im,fxp,cy,fs,fs);else{c.fillStyle='#17242e';c.fillRect(fxp,cy,fs,fs);c.fillStyle='#9db0bd';c.font=font(18*S,800);c.textAlign='center';c.fillText((ch.m.name||'?')[0].toUpperCase(),fxp+fs/2,cy+fs*.68);}
     c.restore();c.fillStyle='#fff';c.font=font(22*S,700);c.textAlign='left';c.fillText(ch.t,fxp+fs+6*S,cy+fs*.72);fxp+=w+6*S;});
    c.restore();
   });
   c.restore();
   // Korrektur-Hinweis
   if(f.fixes.length&&p>=1){c.font=font(36,800);const t=`✏️ ${f.fin?'Endwert nach Spieltagsende':'Kickbase-Korrektur'}: ${f.fixes.map(z=>`${z.name} ${fmt(z.from)} → ${fmt(z.to)}`).join(', ')}`;
    const words=t.split(' '),lines=[];let l='';for(const w of words){const tt=l?l+' '+w:w;if(c.measureText(tt).width>PW-80){lines.push(l);l=w;}else l=tt;}lines.push(l);
    const bh=lines.length*46+30;c.fillStyle='#ffd54a';c.strokeStyle='#111';c.lineWidth=4;rr(PX+20,PY+20,PW-40,bh,18);c.fill();c.stroke();
    c.fillStyle='#111';c.textAlign='center';lines.forEach((ln,j)=>c.fillText(ln,W/2,PY+62+j*46));}
   // Zeitleiste
   const TY=1740,TX=PX+20,TW=PW-40,prog=n>1?(k-1+e)/(n-1):1,pr=Math.max(0,Math.min(1,k===0?0:prog));
   c.fillStyle='#465864';rr(TX,TY,TW,12,6);c.fill();c.fillStyle='#ebc768';rr(TX,TY,TW*pr,12,6);c.fill();
   o.marks.forEach(m=>{c.fillStyle=m.cls==='fix'?'#e74c3c':m.cls==='fin'?'#fff':'#ebc768';c.fillRect(TX+TW*m.i/(n-1)-3,TY-34,6,20);});
   c.fillStyle='#ebc768';c.strokeStyle='#111';c.lineWidth=4;c.beginPath();c.arc(TX+TW*pr,TY+6,20,0,7);c.fill();c.stroke();
   c.fillStyle='#728592';c.font=font(30,700);c.textAlign='center';c.fillText('KBL LEGENDEN',W/2,1860);
  }
  const stream=cv.captureStream(30),rec=new MediaRecorder(stream,{mimeType:mime,videoBitsPerSecond:6e6}),chunks=[];
  rec.ondataavailable=e=>{if(e.data.size)chunks.push(e.data);};
  const done=new Promise(r=>rec.onstop=r);
  draw(0);rec.start(500);
  const t0=performance.now();
  await new Promise(res=>{const step=()=>{const t=(performance.now()-t0)/1000;draw(Math.min(t,T));onStat(`Video wird aufgenommen … ${Math.max(0,Math.ceil(T-t))} s (Seite bitte offen lassen)`);if(t>=T)return res();setTimeout(step,1000/30);};step();});
  rec.stop();await done;stream.getTracks().forEach(t=>t.stop());
  return {blob:new Blob(chunks,{type:mime.split(';')[0]}),ext:mime.includes('mp4')?'mp4':'webm'};
 }
 function zrStop(){clearTimeout(zr.timer);zr.timer=null;}
 addEventListener('resize',()=>zr.fit?.());
 document.addEventListener('keydown',e=>{if(e.key==='Escape'&&zr.full)zr.exit?.();});
 document.addEventListener('fullscreenchange',()=>{if(!document.fullscreenElement&&zr.full&&matchMedia('(pointer:fine)').matches)zr.exit?.();});
 function top10(d,rows,pool,bestIds,fin){
  const t=d.tracking?.top10,list=t?.players||[];
  const fans=new Map();rows.forEach(r=>{const k=String(r.t.playerId);if(!fans.has(k))fans.set(k,[]);fans.get(k).push(r);});
  let place=0;
  const body=!list.length?`<p class="muted tiny">Das fehlt: ${fin?'Die Spieltagspunkte aller Spieler sind nicht abrufbar.':'Der Zwischenstand aller Spieler wird während der Spiele etwa alle 30 Minuten berechnet und ist noch nicht da.'}</p>`
   :`<ol class="mvp-top10">${list.map((p,i)=>{if(!i||list[i-1].points!==p.points)place=i+1;const f=fans.get(p.id)||[];
     return `<li class="${bestIds.has(p.id)?'best':''}${f.length?' tipped':''}"><span class="mvp-top10-pl">${place}.</span><span class="mvp-top10-nm">${bestIds.has(p.id)?'👑 ':''}${esc(p.name)} <small>${esc(p.team)}</small>${f.length?`<span class="mvp-top10-fans">${f.map(r=>`<span>${window.kblMgrFace?window.kblMgrFace(r.m.name,'',r.m.id):''}<small>${esc(r.m.name)} (${fmt(r.t.points)})</small></span>`).join('')}</span>`:''}</span><b>${fmt(p.points)}</b></li>`;}).join('')}</ol>
    <p class="muted tiny">${pool.length?`Nur Spieler von ${esc(pool.join(', '))}${condsOf(d).length?`, ${esc(condText(condsOf(d)))}`:''}. `:condsOf(d).length?`Alle Bundesliga-Spieler, ${esc(condText(condsOf(d)))}. `:'Alle Bundesliga-Spieler. '}Darunter steht, wer den Spieler getippt hat.${fin?'':` Stand ${esc(clock(t.at))} Uhr, getippte Spieler aktueller.`}${t.reliable===false?' Nicht alle Spieler waren abrufbar.':''}</p>`;
  return `<details class="acc-group" style="margin-top:14px"><summary>Top 10 laut Tippregel</summary><div class="acc-sub">${body}</div></details>`;
 }
 function allTips(d){
  if(!d.reveal)return '';
  const {rows,lead,kind,auto,ready,needMvp,mvp,mvpPts,pool}=standings(d);if(!rows.length)return '';
  const fin=d.status==='finished',live=d.status==='live',max=Math.max(1,...rows.map(r=>Math.max(r.pts??0,r.t.points)));
  const pct=v=>Math.max(0,Math.min(100,(v/max)*100)).toFixed(1);
  let h=`<h4 style="margin:22px 0 8px">Übersicht aller Tipps <small class="muted">${d.tracking?`Punkte Stand ${esc(clock(d.tracking.updatedAt))} Uhr`:'Punkte folgen'}</small></h4>`;
  const mvpLine=needMvp&&mvp?.players?.length?`<div class="muted">${pool.length?'Bester der genannten Vereine':condsOf(d).length?'Bester laut Tippregel':'MVP'} ${fin?'am Spieltag':'gerade'}: ${mvp.players.map(p=>`<b>${esc(p.name)}</b> (${esc(p.team)})`).join(', ')} mit <b>${fmt(mvpPts)}</b> Punkten${fin?'':` · Stand ${esc(clock(mvp.at))} Uhr${mvp.reliable===false?', nicht alle Spieler abrufbar':''}`}</div>`:'';
  // Hat keiner den Besten getippt (Kevin-Wunsch): statt "niemand vorne" den besten getippten Spieler mit seinen Tippern zeigen.
  const tipBest=(()=>{const c=rows.filter(r=>r.pts!==null&&!offRule(pool,r.t.team,r.t.playerId));if(!c.length)return '';
   const top=Math.max(...c.map(r=>r.pts)),w=c.filter(r=>r.pts===top),pl=[...new Map(w.map(r=>[String(r.t.playerId),r.t])).values()];
   return `<div>Bester getippter Spieler: ${pl.map(t=>`<b>${esc(t.player)}</b> <small class="muted">${esc(t.team)}</small>`).join(', ')} mit <b>${fmt(top)}</b> Punkten, getippt von ${w.map(r=>`<b>${mn(r.m.name,r.m.id)}</b> (${fmt(r.t.points)})`).join(', ')}</div>`;})();
  if(live&&!(auto&&ready&&lead.length)){if(auto&&ready)h+=`<div class="mvp-lead"><div class="eyebrow">FÜHREND</div>${tipBest||'<div>Gerade liegt niemand vorne.</div>'}${mvpLine}</div>`;}
  else if(!auto)h+=`<p class="muted">${kind?'Für diese Tippregel gibt es keine automatische Wertung.':'Die Wertung ließ sich aus dem Regeltext nicht erkennen. Der Admin kann sie unten wählen.'} Sortiert nach den Punkten der getippten Spieler.</p>`;
  else if(!ready)h+=`<p class="muted">Wertung: ${esc(kindTitle(d,kind))}. Der ${pool.length||condsOf(d).length?'Zwischenstand laut Tippregel':'MVP-Zwischenstand'} fehlt noch${fin?'':', er wird während der Spiele etwa alle 30 Minuten berechnet'}.</p>`;
  else if(lead.length)h+=`<div class="mvp-lead"><div class="eyebrow">${fin?'VORNE NACH DER WERTUNG':'FÜHREND'}</div>${lead.map(r=>`<div><b>${mn(r.m.name,r.m.id)}</b> mit ${esc(r.t.player)} <small class="muted">${esc(r.t.team)}</small>: getippt ${fmt(r.t.points)}${r.pts===null?'':`, Spieler hat ${fmt(r.pts)}`}${off(r,needMvp,' (',')',pool.length||condsOf(d).length)}</div>`).join('')}${mvpLine}</div>
   ${live?'':`<p class="muted tiny">Wertung: ${esc(kindTitle(d,kind))}.${fin?' Den Joker vergebt ihr in der BumsParade.':' Vorläufig, bis der Spieltag beendet ist.'}</p>`}`;
  else h+=`<div class="mvp-lead"><div class="eyebrow">${fin?'ERGEBNIS':'FÜHREND'}</div><div>Gerade liegt niemand nach der Wertung vorne.</div>${tipBest}${mvpLine}</div><p class="muted tiny">Wertung: ${esc(kindTitle(d,kind))}.</p>`;
  // Rennen: Spieler gruppiert (aktuelle Punkte), darunter alle Manager, die ihn getippt haben, mit ihrer Zahl (Cartoon-Ansicht in toonRace).
  const leadIds=new Set(lead.map(r=>r.m.id)),bestIds=new Set((mvp?.players||[]).map(p=>String(p.id)));
  const groups=[...rows.reduce((g,r)=>{const k=String(r.t.playerId);if(!g.has(k))g.set(k,{t:r.t,pts:r.pts,state:r.state,rs:[]});g.get(k).rs.push(r);return g;},new Map()).values()];
  groups.sort((a,b)=>(a.pts===null)-(b.pts===null)||(b.pts??0)-(a.pts??0)||b.rs.length-a.rs.length||a.t.player.localeCompare(b.t.player,'de'));
  let place=0;groups.forEach((g,i)=>{const p=groups[i-1];g.place=g.pts===null?null:p&&p.pts===g.pts?p.place:(place=i+1);});
  const played=groups.filter(g=>g.pts!==null).length;
  h+=`<div class="mvp-stats"><span><b>${rows.length}</b> Tipps</span><span><b>${groups.length}</b> Spieler getippt</span><span><b>${played}</b> davon schon mit Punkten</span>${groups[0]?.rs.length>1?`<span>Beliebtester Tipp: <b>${esc(groups.slice().sort((a,b)=>b.rs.length-a.rs.length)[0].t.player)}</b> (${groups.slice().sort((a,b)=>b.rs.length-a.rs.length)[0].rs.length}×)</span>`:''}</div>`;
  h+=toonRace(live||!!d.closing,groups,leadIds,bestIds,d.me,needMvp&&mvp?.players?.length&&mvpPts!==null?{players:mvp.players,points:mvpPts}:null,pool,auto&&ready);
  // Zeitraffer des Spieltags (Kevin-Wunsch), eingeklappt.
  h+=zeitraffer(d,groups);zrGroups=groups;
  // Top 10 des Spieltags unter allen Spielern, die die Tippregel erlaubt (Kevin-Wunsch), eingeklappt.
  h+=top10(d,rows,pool,bestIds,fin);
  // Zahlenstrahl „Wer liegt mit der Zahl am nächsten?“ entfernt (Kevin-Wunsch).
  // Rangliste je Manager (eingeklappt, Liga-Vorgabe).
  h+=`<details class="acc-group" style="margin-top:14px"><summary>Rangliste aller Manager</summary><div class="acc-sub"><div class="tablewrap"><table class="mvp-table"><tr><th>Pl.</th><th>Manager</th><th>Spieler</th><th class="num">Tipp</th><th class="num">Punkte</th><th>Stand</th></tr>${rows.map(r=>`<tr${r.m.id===d.me?' class="mvp-me"':''}><td>${r.rank??'–'}</td><td>${mn(r.m.name,r.m.id)}${r.t.late?'<sup>*</sup>':''}</td><td>${esc(r.t.player)} <small class="muted">${esc(r.t.team)}</small></td><td class="num">${fmt(r.t.points)}</td><td class="num">${r.pts===null?'–':fmt(r.pts)}</td><td><small class="muted">${r.why?esc(r.why):off(r,needMvp,'','',pool.length||condsOf(d).length)||esc(STATE[r.state]||'')}</small></td></tr>`).join('')}</table></div></div></details>`;
  const none=d.managers.filter(m=>!m.tipped);
  if(none.length)h+=`<p class="muted tiny">Ohne Tipp: ${none.map(m=>esc(m.name)).join(', ')}</p>`;
  return h;
 }
 // Nachtragen nach dem Anpfiff (nur Admin): für Manager ohne eigenen Tipp, nachgetragene lassen sich korrigieren.
 let lateCode='',lateMsg='';
 function late(d){
  if(!d.reveal||!(API||d.admin&&!STATIC))return '';
  const opts=d.managers.filter(m=>!m.tipped||m.tip?.late),ws=d.wertungen||overview?.wertungen||[];
  return `<details class="acc-group" id="mvpLate" style="margin-top:18px"${lateMsg?' open':''}><summary>Wertung und Tipps nachtragen (nur Admin)</summary><div class="acc-sub">
   ${API?`<label class="acc-label" style="display:block;margin-bottom:10px">Admin-Code <input id="mvpLateCode" type="password" autocomplete="off" value="${esc(lateCode)}" style="display:block;margin-top:6px"></label>`:''}
   ${d.rule?`<div class="mvp-form"><label class="acc-label">So wird gewertet<select id="mvpLateWertung"><option value="">Automatisch aus dem Regeltext${kindAuto(d)&&kindOf(d)?` (${esc(kindTitle(d,kindOf(d)))})`:''}</option>${ws.map(w=>`<option value="${esc(w.id)}"${w.id===d.rule.wertung?' selected':''}>${esc(w.title)}</option>`).join('')}</select></label><button type="button" class="gold" id="mvpWertungSave">Wertung speichern</button></div>`:'<p class="muted">Für diesen Spieltag wurde keine Tippregel eingetragen.</p>'}
   ${opts.length?`<h4 style="margin:16px 0 4px">Tipp nachtragen</h4><p class="muted">Für Manager, die nicht rechtzeitig in der App getippt haben, zum Beispiel im Chat. Eigene Tipps werden nie überschrieben, nachgetragene kannst du korrigieren.</p>
   <form class="mvp-form" id="mvpLateForm" autocomplete="off">
    <label class="acc-label">Manager<select id="mvpLateWho" required><option value="">Bitte wählen …</option>${opts.map(m=>`<option value="${esc(m.id)}">${esc(m.name)}${m.tip?.late?' (nachgetragen)':''}</option>`).join('')}</select></label>
    <label class="acc-label mvp-pick">Spieler<input id="mvpLatePlayer" data-mvp-player placeholder="Name eintippen …" autocomplete="off" required><div class="mvp-suggest" hidden></div></label>
    <label class="acc-label">Punkte<input id="mvpLatePoints" type="number" inputmode="numeric" step="1" min="-1000" max="2000" required></label>
    <button class="gold" type="submit">Tipp nachtragen</button></form>
`:''}
   <p class="muted" id="mvpLateMsg" role="status">${esc(lateMsg)}</p></div></details>`;
 }
 function result(d){
  const r=d.result;if(!r)return '';
  let h='';
  if(r.mvp)h+=`<p class="mvp-mvp">MVP des Spieltags: ${r.mvp.players.map(p=>`<b>${esc(p.name)}</b> (${esc(p.team)})`).join(', ')} mit <b>${fmt(r.mvp.points)}</b> Punkten.</p>`;
  if(r.message)h+=`<p class="${['ok','empty','manual'].includes(r.status)?'muted':'error'}">${esc(r.message)}</p>`;
  if(r.rows?.length){
   const names=d.managers.filter(m=>r.winners.includes(m.id)).map(m=>m.name);
   h+=`<p>Vorschlag für den Joker: <b>${names.length?esc(names.join(', ')):'niemand'}</b>${r.status==='ok'?'':' (bitte prüfen)'}. Entschieden wird in der BumsParade.</p>`;
   const best=(r.best?.managers||[]).map(id=>d.managers.find(m=>m.id===id)).filter(Boolean);
   h+=best.length?`<p>Bester Tipper: <b>${best.map(m=>mn(m.name,m.id)).join(', ')}</b>${r.best.how==='closest'?' (kein Gewinner, am nächsten dran)':''}. ${best.length>1?'Sie bestimmen':'Er bestimmt'} die Tippregel für Spieltag ${d.day+1}.</p>`:`<p class="muted">Bester Tipper: noch nicht bestimmbar.</p>`;
   if(d.admin&&!STATIC&&names.length)h+=`<button type="button" class="ghost" id="mvpToNpc">Vorschlag als Joker-Gewinner übernehmen</button> <span class="muted" id="mvpNpcMsg"></span>`;
  }
  return h;
 }
 function render(){
  const root=$('#mvpContent');if(!root||!data)return;
  const d=data;ruleOut=new Set(Object.keys(d.tracking?.out||{}));
  $('#mvpMeta').textContent=d.open?`Spieltag ${d.day} · Tipps offen`:d.status==='finished'?`Spieltag ${d.day} · beendet`:`Spieltag ${d.day} · ${d.status==='live'?'läuft':'gesperrt'}`;
  root.className='';
  // Beim automatischen Neuladen (alle 2 Min.) bleiben aufgeklappte Bereiche offen; beim Öffnen des Reiters klappt kblCollapseView alles zu.
  const wasOpen=new Set([...root.querySelectorAll('details.acc-group[open]>summary')].map(x=>x.textContent));
  const raceShut=root.querySelector('details.toon-race.kbl-keep-open:not([open])');// von Hand zugeklappt: so lassen
  const intro=$('#mvpIntro');if(intro)intro.hidden=d.status==='live'||!!d.closing;
  root.innerHTML=ruleBox(d)+deadline(d)+form(d)+result(d)+allTips(d)+(!d.reveal?table(d):'')+late(d);lateMsg='';
  root.querySelectorAll('details.acc-group>summary').forEach(x=>{if(wasOpen.has(x.textContent))x.parentElement.open=true;});
  const race=root.querySelector('details.toon-race');if(race&&raceShut)race.open=false;
  if(zrGroups&&d.reveal)zrMount(root,d,zrGroups);zrGroups=null;
  if(race?.open&&!players)loadPlayers().then(()=>render()).catch(()=>{});
  if($('#mvpLate')?.open)loadPlayers().catch(()=>{});
  const admin=$('#mvpAdminBox');admin.hidden=!((d.admin&&!STATIC||API&&d.online)&&d.status==='upcoming'&&!d.locked);$('#mvpAdminCodeBox').hidden=!API;
  if(!admin.hidden){
   const withCode=d.managers.filter(m=>m.hasCode);
   $('#mvpCodes').innerHTML=withCode.length?'<h4>Tipp-Codes zurücksetzen</h4><p class="muted tiny">Falls jemand seinen Code vergessen hat.</p>'+withCode.map(m=>`<button type="button" class="ghost" data-mvp-reset="${esc(m.id)}" data-name="${esc(m.name)}" style="margin:4px 6px 4px 0">${esc(m.name)}</button>`).join(''):'';
   $('#mvpRuleText').value=d.rule?.text||'';
   $('#mvpRuleBy').innerHTML='<option value="">Bitte wählen …</option>'+d.managers.map(m=>`<option value="${esc(m.id)}">${esc(m.name)}</option>`).join('');
   $('#mvpRuleBy').value=d.rule?.by?.id||(bestIds(d).length===1?bestIds(d)[0]:'');
   $('#mvpRuleWertung').innerHTML='<option value="">Automatisch aus dem Regeltext</option>'+(d.wertungen||overview?.wertungen||[]).map(w=>`<option value="${esc(w.id)}">${esc(w.title)}</option>`).join('');
   $('#mvpRuleWertung').value=d.rule?.wertung||'';
  }
  if(d.open&&LIVE)loadPlayers().catch(e=>{const m=$('#mvpMsg');if(m)m.textContent='Spielerliste nicht abrufbar: '+e.message;});
 }
 // Spieltag gespielt, aber Kickbase hat ihn noch nicht abgeschlossen (Ranking il, meist bis zum Abend nach dem letzten Spiel):
 // Rennen bleibt offen stehen und der Spieltag wird beim Öffnen gewählt (Kevin-Wunsch).
 let closingMemo=null;
 async function closingDay(){
  if(closingMemo&&Date.now()-closingMemo.at<5*60e3)return closingMemo.day;
  let day=null;
  try{const st=await get('/api/matchday-status'),n=Number(st.lastFinishedDay);
   if(n&&!(st.days||[]).some(x=>x.status==='live')){const r=await get(`/api/ranking/6422780?dayNumber=${n}`);if(r?.il===true)day=n;}}catch{}
  closingMemo={at:Date.now(),day};return day;
 }
 async function loadDay(day){
  const root=$('#mvpContent');
  if(!data||data.day!==day){root.className='muted';root.textContent=`Lade Spieltag ${day} …`;}
  try{const st=overview?.days?.find(x=>x.day===day)?.status;
   let d;
   if(API&&st!=='finished'){
    // Tipps live vom Tippdienst, Punkte der getippten Spieler aus dem Export (alle 5 Minuten während der Spiele).
    d=await get(tippUrl(`/api/mvp-tipps/${day}`));
    if(d.reveal){const x=await get(`/api/mvp-tipps/${day}`).catch(()=>null);d.tracking=x?.tracking||null;d.verlauf=x?.verlauf||[];}
   }else{
    d=await get(`/api/mvp-tipps/${day}`);
    // Beendeter Spieltag online: gerade nachgetragene Tipps schon zeigen, bevor der nächste Export sie übernimmt.
    if(API){const x=await get(tippUrl(`/api/mvp-tipps/${day}`)).catch(()=>null);
     if(x?.managers)for(const m of d.managers){const o=x.managers.find(y=>y.id===m.id);if(o?.tip&&!m.tip){m.tip=o.tip;m.tipped=true;}}}
   }
   if(d.status==='finished'&&await closingDay()===day)d.closing=true;
   if(d.status!=='finished'&&day>1&&overview?.days?.find(x=>x.day===day-1)?.status==='finished'){
    const p=await get(`/api/mvp-tipps/${day-1}`).catch(()=>null);
    if(p?.result&&!['missing','empty'].includes(p.result.status))d.prevBest={day:day-1,managers:p.result.best?.managers||[]};
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
   // Beim Öffnen des Reiters zuerst der laufende Spieltag (Kevin-Vorgabe), sonst die letzte Auswahl, sonst der offene.
   const liveDay=days.find(d=>d.status==='live')?.day;
   const pick=liveDay||await closingDay()||(keep&&days.some(d=>d.day===keep)?keep:overview.next||days[0]?.day);
   if(pick){sel.value=String(pick);await loadDay(pick);}
   else $('#mvpContent').textContent='Kein Spieltag zum Tippen gefunden.';
  }catch(e){$('#mvpContent').className='error';$('#mvpContent').textContent='MVP-Tipps nicht abrufbar: '+e.message;}
  finally{loading=false;}
 }

 document.addEventListener('submit',async e=>{
  if(e.target.id!=='mvpForm')return;e.preventDefault();
  const msg=$('#mvpMsg'),pick=pickPlayer($('#mvpPlayer')),p=pick.p,pts=Number($('#mvpPoints').value);
  if(!p){msg.textContent=pick.error;return;}
  if(!Number.isInteger(pts)){msg.textContent='Bitte eine ganze Punktzahl eintragen.';return;}
  const pool=poolOf(data);
  if(pool.length&&!pool.includes(p.team)&&!confirm(`Laut Tippregel zählen nur Spieler von ${pool.join(', ')}. ${p.name} spielt für ${p.team}. Trotzdem tippen?`))return;
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
  const msg=$('#mvpLateMsg'),who=$('#mvpLateWho').value,pick=pickPlayer($('#mvpLatePlayer')),p=pick.p,pts=Number($('#mvpLatePoints').value);
  if(!who){msg.textContent='Bitte einen Manager wählen.';return;}
  if(!p){msg.textContent=pick.error;return;}
  if(!Number.isInteger(pts)){msg.textContent='Bitte eine ganze Punktzahl eintragen.';return;}
  if($('#mvpLateCode'))lateCode=$('#mvpLateCode').value;
  const btn=e.target.querySelector('button');btn.disabled=true;msg.textContent='Speichere …';
  try{await get(tippUrl(`/api/mvp-tipps/${data.day}/nachtrag`),{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({managerId:who,playerId:p.id,points:pts,adminCode:lateCode})});
   const name=data.managers.find(m=>m.id===who)?.name||'';
   lateMsg=`Tipp für ${name} nachgetragen.${API?' Die Punkte des Spielers erscheinen mit dem nächsten Abgleich (während der Spiele alle 5 Minuten).':''}`;
   await loadDay(data.day);}
  catch(err){msg.textContent='Nicht gespeichert: '+err.message;btn.disabled=false;}
 });
 document.addEventListener('toggle',e=>{if(e.target.open&&!players&&e.target.querySelector?.('.toon-pitch'))loadPlayers().then(()=>render()).catch(()=>{});},true);
 document.addEventListener('toggle',e=>{if(e.target.id==='mvpLate'&&e.target.open)loadPlayers().catch(err=>{const m=$('#mvpLateMsg');if(m)m.textContent='Spielerliste nicht abrufbar: '+err.message;});},true);
 document.addEventListener('change',e=>{
  if(e.target.id==='mvpLateWho'){const t=data?.managers.find(m=>m.id===e.target.value)?.tip;$('#mvpLatePlayer').value=t?`${t.player} (${t.team})`:'';$('#mvpLatePoints').value=t?t.points:'';}
  if(e.target.id==='mvpDay')loadDay(Number(e.target.value));
  if(e.target.id==='mvpWho'){store.set(e.target.value);codeTip=null;const pl=$('#mvpPlayer')?.value,pt=$('#mvpPoints')?.value;render();if($('#mvpPlayer'))$('#mvpPlayer').value=pl||'';if($('#mvpPoints'))$('#mvpPoints').value=pt||'';}
 });
 document.addEventListener('click',async e=>{
  if(e.target.id==='mvpRuleSave'){
   const m=$('#mvpRuleMsg');m.textContent='Speichere …';
   try{await get(tippUrl(`/api/mvp-tipps/${data.day}/rule`),{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({ruleId:'eigene',text:$('#mvpRuleText').value,byId:$('#mvpRuleBy').value,wertung:$('#mvpRuleWertung').value,adminCode:adminCode()})});m.textContent='Tippregel gespeichert.';await loadDay(data.day);}
   catch(err){m.textContent='Fehler: '+err.message;}
  }
  if(e.target.id==='mvpWertungSave'){
   const m=$('#mvpLateMsg')||$('#mvpContent'),w=$('#mvpLateWertung').value;
   if($('#mvpLateCode'))lateCode=$('#mvpLateCode').value;
   try{await get(tippUrl(`/api/mvp-tipps/${data.day}/wertung`),{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({wertung:w,adminCode:lateCode})});
    lateMsg=`Wertung gespeichert.${API&&data.status==='live'&&MVP_KINDS.has(w)?' Der MVP-Zwischenstand kommt mit einem der nächsten Abgleiche.':''}`;await loadDay(data.day);}
   catch(err){if($('#mvpLateMsg'))$('#mvpLateMsg').textContent='Nicht gespeichert: '+err.message;}
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
