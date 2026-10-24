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
 function ruleBox(d){
  if(!d.rule)return `<div class="mvp-rule"><div class="eyebrow">TIPPREGEL SPIELTAG ${d.day}</div><p>Die Tippregel für diesen Spieltag steht noch nicht fest. Getippt werden kann trotzdem schon.</p></div>`;
  // Die Liga schreibt die Regel selbst (keine Vorlagen); ältere Einträge mit Vorlagen-Titel zeigen ihn weiter an.
  return `<div class="mvp-rule"><div class="eyebrow">TIPPREGEL SPIELTAG ${d.day}</div>${d.rule.id!=='eigene'?`<strong>${esc(d.rule.title)}</strong>`:''}<p class="mvp-rule-text">${esc(d.rule.text)}</p>${d.rule.by?`<small class="muted">Regel bestimmt von <b>${esc(d.rule.by.name)}</b></small>`:''}${!kindOf(d)?'<small class="muted mvp-wertung">Wertung: aus dem Regeltext nicht erkannt, bitte im Admin-Bereich wählen</small>':kindAuto(d)?'':`<small class="muted mvp-wertung">Wertung (vom Admin gewählt): <b>${esc(kindTitle(d,kindOf(d)))}</b></small>`}</div>`;
 }
 function deadline(d){
  if(d.open)return `<p class="mvp-deadline">Tipps bis <b>${esc(when(d.deadline))}</b>${d.firstMatch?` (${esc(d.firstMatch)})`:''} · <span data-mvp-left="${esc(d.deadline)}">${left(d.deadline)}</span></p>`;
  if(d.status==='upcoming')return `<p class="muted">Auf diesen Spieltag wird erst getippt, wenn er als nächster dran ist.</p>`;
  if(d.status==='live')return '';// während des Spieltags nur die Tippregel (Kevin-Wunsch)
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
  if(/punktbest|beste\w* spieler|meiste\w* punkte|hoechste\w* punkt/.test(t))return 'volltreffer';
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
 const poolOf=d=>d?.tracking?.pool||d?.result?.pool||(d?.rule?.text&&overview?.teams?ruleTeams(d.rule.text,overview.teams):[]);
 const kindAuto=d=>!!d.rule&&!d.rule.wertung&&d.rule.id==='eigene';
 // Nennt die Regel Vereine, heißt die Wertung nach dem Besten dieser Vereine statt nach dem MVP der ganzen Liga.
 const POOL_TITLE={volltreffer:p=>`Wer den Punktbesten von ${p} tippt, dann nächste Punktzahl`,name:p=>`Wer den Punktbesten von ${p} tippt`,
  zahl:p=>`Am nächsten an der Punktzahl des Besten von ${p}`,drunter:p=>`Punktbester von ${p}, nächste Punktzahl, nicht drüber`,korridor:p=>`Punktbester von ${p}, höchstens 25 Punkte daneben`};
 const kindTitle=(d,k)=>{const pool=poolOf(d),base=(d.wertungen||overview?.wertungen||[]).find(w=>w.id===k)?.title||k;
  return pool.length?(POOL_TITLE[k]?POOL_TITLE[k](pool.join(', ')):`${base} (nur Spieler von ${pool.join(', ')})`):base;};
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
    else if(['volltreffer','name','drunter','korridor'].includes(kind)&&!hit){ok=false;why=pool.length?'nicht der Beste der genannten Vereine':'nicht der MVP';}
    else if(kind==='drunter'&&m.tip.points>mvpPts){ok=false;why='zu hoch getippt';}
    else if(kind==='korridor'&&diff>KORRIDOR){ok=false;why=`mehr als ${KORRIDOR} daneben`;}
   }
   if(ready&&pool.length&&!pool.includes(m.tip.team)){ok=false;why='nicht von den genannten Vereinen';}
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
 const HEAD_VERSION=1;
 const headSrc=id=>window.KBL_STATIC?`heads/v${HEAD_VERSION}/${encodeURIComponent(id)}.png`:`/api/mvp-tipps/head/${encodeURIComponent(id)}`;
 const toonHead=(id,alt)=>`<img class="toon-face" src="${esc(headSrc(id))}" alt="${esc(alt)}" onload="this.closest('.toon-runner')?.classList.add('has-face')" onerror="this.remove()">`;
 function toonRace(live,groups,leadIds,bestIds,me,best,pool){
  const byId=new Map((players||[]).map(p=>[String(p.id),p]));
  if(!groups.length)return '';
  const vals=[...groups.map(g=>g.pts??0),...(best?[best.points]:[])],lo=Math.min(0,...vals),hi=Math.max(1,...vals),span=hi-lo;
  const pos=v=>(4+78*((v??0)-lo)/span).toFixed(1);
  // Alle Figuren auf einem Platz (Kevin-Wunsch): x nach Punkten, je Spieler eine eigene Höhe, damit sich niemand verdeckt.
  const ROW=58,TOP=104;
  const runner=(o,row)=>{const info=byId.get(String(o.id)),face=kbImg(info?.img),crest=kbImg(info?.teamImg),[shirt,trim]=clubColor(o.team),x=pos(o.pts);
   return `<div class="toon-runner${o.run}${x>50?' flip':''}${crest?' has-crest':''}${o.ghost?' ghost':''}" style="left:${x}%;top:${TOP+row*ROW-60}px;z-index:${row+2}">
    ${o.crown?'<div class="toon-crown">👑</div>':''}<div class="toon-body">${toon({},shirt,trim,o.mood,o.num)}${face?toonHead(o.id,o.name):''}${toonPhoto(crest,'toon-crest',o.team)}</div>${o.run===' run'?'<span class="toon-ball">⚽</span>':''}
    <div class="toon-tag">${esc(o.name)} <b>${o.pts===null?'–':fmt(o.pts)}</b></div></div>`;};
  const figs=[];
  if(best)best.players.forEach(p=>figs.push({id:p.id,name:p.name,team:p.team,pts:best.points,crown:true,ghost:true,mood:'wow',num:'★',run:''}));
  groups.forEach(g=>{const neg=g.pts!==null&&g.pts<0;
   figs.push({id:g.t.playerId,name:g.t.player,team:g.t.team,pts:g.pts,crown:bestIds.has(String(g.t.playerId)),mood:neg?'sad':g.place===1&&g.pts!==null?'wow':'happy',num:g.place??'?',
    run:g.state==='live'?' run':g.state==='open'||g.state==='wait'?' idle':neg?' fall':''});});
  const pitch=`<div class="toon-pitch" style="height:${TOP+(figs.length-1)*ROW+40}px"><i class="tp-start"></i><i class="tp-mid"></i><i class="tp-circle"></i><i class="tp-finish"></i>${figs.map(runner).join('')}</div>`;
  const ghostLine=best?`<div class="toon-row ghost"><span class="mvp-rank">👑</span><span class="muted">${pool.length?'Gerade Bester der genannten Vereine':'Gerade MVP'}:</span> <b>${best.players.map(p=>esc(p.name)).join(', ')}</b> <small class="muted">${esc([...new Set(best.players.map(p=>p.team))].join(', '))}</small><span class="toon-pts">${fmt(best.points)}<small> Pkt.</small></span></div>`:'';
  const rows=groups.map(g=>`<div class="toon-row${bestIds.has(String(g.t.playerId))?' best':''}"><span class="mvp-rank">${g.place??'–'}</span><b>${esc(g.t.player)}</b> <small class="muted">${esc(g.t.team)}</small><span class="toon-pts">${g.pts===null?'–':fmt(g.pts)}<small> Pkt.</small></span>
    <div class="mvp-lane-tips"><small class="muted">Fans:</small> ${g.rs.map(r=>`<span class="mvp-chip${leadIds.has(r.m.id)?' lead':''}${r.m.id===me?' me':''}">${esc(r.m.name)} <b>${fmt(r.t.points)}</b>${r.t.late?'<sup>*</sup>':''}</span>`).join('')}</div></div>`).join('');
  // Während des Spieltags gleich offen und ohne Erklärtext (Kevin-Wunsch, Ausnahme von der Zuklapp-Regel: kbl-keep-open).
  return `<details class="acc-group toon-race${live?' kbl-keep-open':''}"${live?' open':''} style="margin-top:14px"><summary>Rennen der getippten Spieler</summary><div class="acc-sub">${pitch}<div class="toon-list">${ghostLine}${rows}</div>${live?'':`<p class="muted tiny">Je mehr Punkte, desto weiter rechts. Halbtransparent mit Krone: wer gerade nach der Tippregel vorne liegt. Wer gerade spielt, rennt mit Ball, bei Minuspunkten liegt er auf der Nase. Bei den Fans steht die getippte Zahl${groups.some(g=>g.rs.some(r=>r.t.late))?', * = nachgetragen':''}.</p>`}</div></details>`;
 }
 function allTips(d){
  if(!d.reveal)return '';
  const {rows,lead,kind,auto,ready,needMvp,mvp,mvpPts,pool}=standings(d);if(!rows.length)return '';
  const fin=d.status==='finished',live=d.status==='live',max=Math.max(1,...rows.map(r=>Math.max(r.pts??0,r.t.points)));
  const pct=v=>Math.max(0,Math.min(100,(v/max)*100)).toFixed(1);
  let h=`<h4 style="margin:22px 0 8px">Übersicht aller Tipps <small class="muted">${d.tracking?`Punkte Stand ${esc(clock(d.tracking.updatedAt))} Uhr`:'Punkte folgen'}</small></h4>`;
  const mvpLine=needMvp&&mvp?.players?.length?`<div class="muted">${pool.length?'Bester der genannten Vereine':'MVP'} ${fin?'am Spieltag':'gerade'}: ${mvp.players.map(p=>`<b>${esc(p.name)}</b> (${esc(p.team)})`).join(', ')} mit <b>${fmt(mvpPts)}</b> Punkten${fin?'':` · Stand ${esc(clock(mvp.at))} Uhr${mvp.reliable===false?', nicht alle Spieler abrufbar':''}`}</div>`:'';
  if(live&&!(auto&&ready&&lead.length)){if(auto&&ready)h+=`<div class="mvp-lead"><div class="eyebrow">FÜHREND</div><div>Gerade liegt niemand vorne.</div>${mvpLine}</div>`;}
  else if(!auto)h+=`<p class="muted">${kind?'Für diese Tippregel gibt es keine automatische Wertung.':'Die Wertung ließ sich aus dem Regeltext nicht erkennen. Der Admin kann sie unten wählen.'} Sortiert nach den Punkten der getippten Spieler.</p>`;
  else if(!ready)h+=`<p class="muted">Wertung: ${esc(kindTitle(d,kind))}. Der ${pool.length?'Zwischenstand der genannten Vereine':'MVP-Zwischenstand'} fehlt noch${fin?'':', er wird während der Spiele etwa alle 30 Minuten berechnet'}.</p>`;
  else if(lead.length)h+=`<div class="mvp-lead"><div class="eyebrow">${fin?'VORNE NACH DER WERTUNG':'FÜHREND'}</div>${lead.map(r=>`<div><b>${esc(r.m.name)}</b> mit ${esc(r.t.player)} <small class="muted">${esc(r.t.team)}</small>: getippt ${fmt(r.t.points)}${r.pts===null?'':`, Spieler hat ${fmt(r.pts)}`}${off(r,needMvp,' (',')',pool.length)}</div>`).join('')}${mvpLine}</div>
   ${live?'':`<p class="muted tiny">Wertung: ${esc(kindTitle(d,kind))}.${fin?' Den Joker vergebt ihr in der BumsParade.':' Vorläufig, bis der Spieltag beendet ist.'}</p>`}`;
  else h+=`<div class="mvp-lead"><div class="eyebrow">${fin?'ERGEBNIS':'FÜHREND'}</div><div>Gerade liegt niemand nach der Wertung vorne.</div>${mvpLine}</div><p class="muted tiny">Wertung: ${esc(kindTitle(d,kind))}.</p>`;
  // Rennen: Spieler gruppiert (aktuelle Punkte), darunter alle Manager, die ihn getippt haben, mit ihrer Zahl (Cartoon-Ansicht in toonRace).
  const leadIds=new Set(lead.map(r=>r.m.id)),bestIds=new Set((mvp?.players||[]).map(p=>String(p.id)));
  const groups=[...rows.reduce((g,r)=>{const k=String(r.t.playerId);if(!g.has(k))g.set(k,{t:r.t,pts:r.pts,state:r.state,rs:[]});g.get(k).rs.push(r);return g;},new Map()).values()];
  groups.sort((a,b)=>(a.pts===null)-(b.pts===null)||(b.pts??0)-(a.pts??0)||b.rs.length-a.rs.length||a.t.player.localeCompare(b.t.player,'de'));
  let place=0;groups.forEach((g,i)=>{const p=groups[i-1];g.place=g.pts===null?null:p&&p.pts===g.pts?p.place:(place=i+1);});
  const played=groups.filter(g=>g.pts!==null).length;
  h+=`<div class="mvp-stats"><span><b>${rows.length}</b> Tipps</span><span><b>${groups.length}</b> Spieler getippt</span><span><b>${played}</b> davon schon mit Punkten</span>${groups[0]?.rs.length>1?`<span>Beliebtester Tipp: <b>${esc(groups.slice().sort((a,b)=>b.rs.length-a.rs.length)[0].t.player)}</b> (${groups.slice().sort((a,b)=>b.rs.length-a.rs.length)[0].rs.length}×)</span>`:''}</div>`;
  h+=toonRace(live,groups,leadIds,bestIds,d.me,needMvp&&mvp?.players?.length&&mvpPts!==null?{players:mvp.players,points:mvpPts}:null,pool);
  // Zahlenstrahl: wo liegen die getippten Zahlen im Vergleich zur Punktzahl des Besten?
  if(needMvp&&mvpPts!==null){
   const vals=[...rows.map(r=>r.t.points),mvpPts],lo=Math.min(...vals),hi=Math.max(...vals),span=Math.max(1,hi-lo),pos=v=>(5+90*(v-lo)/span).toFixed(1);
   const byPts=[...rows.reduce((m,r)=>{const k=r.t.points;(m.get(k)||m.set(k,[]).get(k)).push(r);return m;},new Map())].sort((a,b)=>a[0]-b[0]);
   const rowsY=[];const dots=byPts.map(([v,rs])=>{const x=Number(pos(v));let y=0;while((rowsY[y]??-99)>x-7)y++;rowsY[y]=x;return {v,rs,x,y};});
   h+=`<details class="acc-group" style="margin-top:14px"><summary>Wer liegt mit der Zahl am nächsten?</summary><div class="acc-sub"><div class="mvp-line" style="height:${54+Math.max(1,rowsY.length)*26}px"><div class="mvp-line-axis"></div>
    <div class="mvp-line-target" style="left:${pos(mvpPts)}%"><span>${fmt(mvpPts)}</span></div>
    ${dots.map(o=>`<div class="mvp-dot${o.rs.some(r=>leadIds.has(r.m.id))?' lead':''}" style="left:${o.x}%;top:${44+o.y*26}px" title="${esc(o.rs.map(r=>`${r.m.name} (${r.t.player})`).join(', '))}">${fmt(o.v)}${o.rs.length>1?`<sup>×${o.rs.length}</sup>`:''}</div>`).join('')}</div>
    ${live?'':`<p class="muted tiny">Goldener Strich = Punktzahl ${pool.length?'des Besten der genannten Vereine':'des MVP'}${fin?'':' gerade'}. Wer welche Zahl getippt hat, steht oben im Rennen.</p>`}</div></details>`;
  }
  // Rangliste je Manager (eingeklappt, Liga-Vorgabe).
  h+=`<details class="acc-group" style="margin-top:14px"><summary>Rangliste aller Manager</summary><div class="acc-sub"><div class="tablewrap"><table class="mvp-table"><tr><th>Pl.</th><th>Manager</th><th>Spieler</th><th class="num">Tipp</th><th class="num">Punkte</th><th>Stand</th></tr>${rows.map(r=>`<tr${r.m.id===d.me?' class="mvp-me"':''}><td>${r.rank??'–'}</td><td>${esc(r.m.name)}${r.t.late?'<sup>*</sup>':''}</td><td>${esc(r.t.player)} <small class="muted">${esc(r.t.team)}</small></td><td class="num">${fmt(r.t.points)}</td><td class="num">${r.pts===null?'–':fmt(r.pts)}</td><td><small class="muted">${r.why?esc(r.why):off(r,needMvp,'','',pool.length)||esc(STATE[r.state]||'')}</small></td></tr>`).join('')}</table></div></div></details>`;
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
   if(d.admin&&!STATIC&&names.length)h+=`<button type="button" class="ghost" id="mvpToNpc">Vorschlag als Joker-Gewinner übernehmen</button> <span class="muted" id="mvpNpcMsg"></span>`;
  }
  return h;
 }
 function render(){
  const root=$('#mvpContent');if(!root||!data)return;
  const d=data;
  $('#mvpMeta').textContent=d.open?`Spieltag ${d.day} · Tipps offen`:d.status==='finished'?`Spieltag ${d.day} · beendet`:`Spieltag ${d.day} · ${d.status==='live'?'läuft':'gesperrt'}`;
  root.className='';
  // Beim automatischen Neuladen (alle 2 Min.) bleiben aufgeklappte Bereiche offen; beim Öffnen des Reiters klappt kblCollapseView alles zu.
  const wasOpen=new Set([...root.querySelectorAll('details.acc-group[open]>summary')].map(x=>x.textContent));
  const raceShut=root.querySelector('details.toon-race.kbl-keep-open:not([open])');// von Hand zugeklappt: so lassen
  const intro=$('#mvpIntro');if(intro)intro.hidden=d.status==='live';
  root.innerHTML=ruleBox(d)+deadline(d)+form(d)+result(d)+allTips(d)+(!d.reveal?table(d):'')+late(d);lateMsg='';
  root.querySelectorAll('details.acc-group>summary').forEach(x=>{if(wasOpen.has(x.textContent))x.parentElement.open=true;});
  const race=root.querySelector('details.toon-race');if(race&&raceShut)race.open=false;
  if(race?.open&&!players)loadPlayers().then(()=>render()).catch(()=>{});
  if($('#mvpLate')?.open)loadPlayers().catch(()=>{});
  const admin=$('#mvpAdminBox');admin.hidden=!((d.admin&&!STATIC||API&&d.online)&&d.status==='upcoming'&&!d.locked);$('#mvpAdminCodeBox').hidden=!API;
  if(!admin.hidden){
   const withCode=d.managers.filter(m=>m.hasCode);
   $('#mvpCodes').innerHTML=withCode.length?'<h4>Tipp-Codes zurücksetzen</h4><p class="muted tiny">Falls jemand seinen Code vergessen hat.</p>'+withCode.map(m=>`<button type="button" class="ghost" data-mvp-reset="${esc(m.id)}" data-name="${esc(m.name)}" style="margin:4px 6px 4px 0">${esc(m.name)}</button>`).join(''):'';
   $('#mvpRuleText').value=d.rule?.text||'';
   $('#mvpRuleBy').innerHTML='<option value="">Bitte wählen …</option>'+d.managers.map(m=>`<option value="${esc(m.id)}">${esc(m.name)}</option>`).join('');
   $('#mvpRuleBy').value=d.rule?.by?.id||'';
   $('#mvpRuleWertung').innerHTML='<option value="">Automatisch aus dem Regeltext</option>'+(d.wertungen||overview?.wertungen||[]).map(w=>`<option value="${esc(w.id)}">${esc(w.title)}</option>`).join('');
   $('#mvpRuleWertung').value=d.rule?.wertung||'';
  }
  if(d.open&&LIVE)loadPlayers().catch(e=>{const m=$('#mvpMsg');if(m)m.textContent='Spielerliste nicht abrufbar: '+e.message;});
 }
 async function loadDay(day){
  const root=$('#mvpContent');
  if(!data||data.day!==day){root.className='muted';root.textContent=`Lade Spieltag ${day} …`;}
  try{const st=overview?.days?.find(x=>x.day===day)?.status;
   let d;
   if(API&&st!=='finished'){
    // Tipps live vom Tippdienst, Punkte der getippten Spieler aus dem Export (alle 5 Minuten während der Spiele).
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
   // Beim Öffnen des Reiters zuerst der laufende Spieltag (Kevin-Vorgabe), sonst die letzte Auswahl, sonst der offene.
   const liveDay=days.find(d=>d.status==='live')?.day;
   const pick=liveDay||(keep&&days.some(d=>d.day===keep)?keep:overview.next||days[0]?.day);
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
