// Zeremonie-Modus und Anklageschriften (Kevin-Wunsch): Montagabend wird die BumsParade auf Discord gefeiert.
// Vollbild zum Bildschirm-Teilen: jeder Angeklagte einzeln, jeder Anklagepunkt mit Trommelwirbel enthüllt,
// Knopf „Vollstreckt ✅“, am Ende Abspann. Anklageschrift = Bild (PNG) je Sünder zum Posten in Discord.
// Daten: dieselbe Abrechnung wie die BumsParade (centerAccounting aus app.js), nichts wird neu berechnet.
(()=>{
 const RULE={BD:'Besoffener Davies',DD:'Dämonische Drehtür',MM:'Magic Miyoshi',AH:'Angeschossener Höler',RK:'Räudiger Kohr',BN:'Blinder Niklas',UM:'Upamaguire',EZ:'Einzelfallentscheidung',TL:'Teamlimit'};
 const ICON={BD:'🍺',DD:'🌀',MM:'🪄',AH:'🔨',RK:'🟥',BN:'🙈',UM:'🦵',EZ:'⚖️',TL:'🧮'};
 const COLOR={BD:'#ed8b85',DD:'#c79bf2',MM:'#7fb8f0',AH:'#f0a35e',RK:'#d8c066',BN:'#7fd3a6',UM:'#f28fc4',EZ:'#a8b8c4',TL:'#6fd6d6'};
 const VERDICT=n=>n>=4?'Komplett zerlegt.':n===3?'Dreifach dran.':n===2?'Doppelt dran.':'Erwischt.';
 const safe=x=>escapeHtml(String(x??''));
 const reduced=()=>matchMedia('(prefers-reduced-motion: reduce)').matches;

 // ---------- Daten aus der BumsParade ----------
 function model(){
  const a=centerAccounting;if(a.state!=='done'||!a.data?.ready||a.probe)return null;
  const d=a.data,checks=a.checks||{},ae=d.autoEvents&&!d.autoEvents.error?d.autoEvents:null;
  const same=(x,mid,pid)=>String(x.managerId)===String(mid)&&(pid==null||String(x.playerId)===String(pid));
  const pts=new Map((d.plausibility||[]).map(p=>[String(p.managerId),{name:p.manager,pts:p.rankingPoints}]));
  const all=[...pts.values()].filter(x=>isEligibleManager(x.name)&&x.pts!=null).map(x=>x.pts);
  const placeOf=p=>p==null?null:1+all.filter(x=>x>p).length;
  const idOf=n=>[...pts.entries()].find(([,x])=>x.name===n)?.[0]||null;
  const proof=t=>{const [,mid,pid]=t.key.split(':');
   if(t.rule==='BD'){const x=(d.bd||[]).find(x=>same(x,mid,pid));return x?`Schnapszahl: ${fmt(x.points)} Punkte`:'Schnapszahl';}
   if(t.rule==='DD'){const w=(d.dd?.winners||[]).find(x=>same(x,mid)),l=d.dd?.lastPlace||[];return `Spieltagssieger mit ${fmt(w?.dayPoints)} Punkten. ${l.map(x=>`${x.manager} (${fmt(x.dayPoints)})`).join(' & ')} sucht sich einen aus.`;}
   if(t.rule==='MM'){const v=(d.mm?.values||[]).find(x=>same(x,mid));return v?`Die meisten Minuspunkte: ${fmt(v.negativeSum)}`:'Die meisten Minuspunkte';}
   if(t.rule==='AH'){const all=d.ah?.mvp?.players||[],m=all.find(x=>String(x.id)===String(pid))||all[0];if(!m)return 'MVP des Spieltags aufgestellt';
    // Gleichstand an der Spitze: alle MVPs nennen (Kevin-Wunsch), der eigene zuerst.
    return all.length>1?`MVP des Spieltags (Gleichstand, ${all.length} MVPs mit ${fmt(m.points)} Punkten): ${[m,...all.filter(x=>x!==m)].map(x=>x.name).join(', ')}`:`MVP des Spieltags: ${m.name} mit ${fmt(m.points)} Punkten`;}
   if(['RK','BN','UM'].includes(t.rule)){const x=(ae?.actions||[]).find(x=>x.rule===t.rule&&same(x,mid,pid));return x?.reason||'';}
   if(t.rule==='TL')return 'Teamlimit 1: nur ein Spieler pro Verein';
   if(t.rule==='EZ'){const c=(d.conflicts||[]).find(x=>String(x.playerId)===String(pid));return (c?.details||[]).map(x=>`${x.rule}: ${x.reason}`).join(' · ');}
   return '';};
  // Wer bekommt etwas? Von Hand korrigierte Empfänger (BumsParade) gehen vor.
  const recv=t=>{const g=checks[t.key]?.target,k=todoPick(t);
   if(t.rule==='MM')return g?[`🎯 ${g} stellt einen Spieler weniger auf`]:['🎯 bestimmt noch einen Manager'];
   if(t.rule==='DD'){const to=(t.to||[]).map(r=>r.manager).join(', ');return [g?`🎁 ${g} geht an ${to}`:`🎁 ${to} sucht sich aus: ${(t.options||[]).map(o=>`${o.name} (${fmt(o.points)})`).join(', ')}`];}
   if(k==='to'&&g)return [g==='Markt'?'🗑️ an den Markt':`→ an ${g}`];
   if((t.to||[]).length)return t.to.map(r=>`→ an ${r.manager}`);
   return [];};
  const mgrs=new Map(),get=(mid,name)=>{const k=String(mid||idOf(name)||name);if(!mgrs.has(k)){const p=pts.get(k)?.pts??null;mgrs.set(k,{id:mid||idOf(name),name,pts:p,place:placeOf(p),charges:[],gifts:[]});}return mgrs.get(k);};
  for(const t of d.todos||[]){if(checks[t.key]?.removed||!isEligibleManager(t.manager))continue;
   const done=t.check?.state==='done'||!!checks[t.key]?.done;
   get(t.managerId,t.manager).charges.push({key:t.key,rule:t.rule,manager:t.manager,pts:t.rule==='BD'?((d.bd||[]).find(x=>same(x,t.managerId,t.key.split(':')[2]))?.points??null):null,text:t.text,proof:proof(t),recv:recv(t),done,auto:t.check?.state==='done',needPick:todoNeedsPick(t)&&!checks[t.key]?.target,options:t.rule==='DD'?(t.options||[]):[],player:todoPlayer(t)});
   // Empfänger (UM, DD, RK, BN, AH, MM) sind auch gebumst und bekommen einen eigenen Anklagepunkt, genau wie in der BumsTabelle (bumsCounts); TL nur erste Ebene.
   if(t.rule==='TL')continue;
   const g=checks[t.key]?.target,k=todoPick(t);
   const inCharge=(name,id,text)=>{if(isEligibleManager(name))get(id,name).charges.push({key:`IN:${t.key}:${name}`,rule:t.rule,manager:name,in:true,src:t.key,text,proof:proof(t),recv:[],done,auto:t.check?.state==='done',needPick:false,options:[],player:null});};
   if(t.rule==='MM'){if(g)inCharge(g,idOf(g),`Muss am nächsten Spieltag einen Spieler weniger aufstellen (von ${t.manager})`);continue;}
   let to=(t.to||[]).map(r=>({name:r.manager,id:r.managerId,player:k==='dd'&&g?g:r.playerName}));
   if(k==='to'&&g)to=g==='Markt'?[]:[{name:g,id:idOf(g),player:todoPlayer(t)}];
   for(const r of to)inCharge(r.name,r.id,`Bekommt ${r.player||'einen Spieler'} von ${t.manager}`);}
  for(const u of ae?.unclear||[]){if(!isEligibleManager(u.manager))continue;const k=unclearKey(u),g=checks[k]?.target;
   if(g==='Entfällt')continue;
   get(u.managerId,u.manager).charges.push({key:k,rule:u.rule,manager:u.manager,text:`${u.playerName||u.name||'Spieler'}: ${g?(g==='Markt'?'an den Markt':'an '+g):'wird vom Gericht geprüft'}`,proof:u.reason||'',recv:[],done:!!g,auto:false,needPick:!g,options:[],player:u.playerName});
   if(g&&g!=='Markt'&&isEligibleManager(g))get(null,g).charges.push({key:`IN:${k}:${g}`,rule:u.rule,manager:g,in:true,src:k,text:`Bekommt ${u.playerName||'einen Spieler'} von ${u.manager}`,proof:u.reason||'',recv:[],done:true,auto:false,needPick:false,options:[],player:null});}
  // Reihenfolge wie bei der Abrechnung: vom Spieltagssieger abwärts, DD zuletzt.
  const ord=r=>r==='DD'?2:r==='TL'?1:0;
  const list=[...mgrs.values()].map(m=>({...m,charges:m.charges.sort((a,b)=>ord(a.rule)-ord(b.rule))})).sort((a,b)=>(a.place??99)-(b.place??99)||a.name.localeCompare(b.name,'de'));
  const counts=bumsCounts(d,checks);
  const clean=[...pts.entries()].filter(([id,x])=>isEligibleManager(x.name)&&!(counts[id]?.count)).map(([id,x])=>({id,name:x.name,pts:x.pts}));
  const king=Object.values(counts).filter(m=>m.count).sort((a,b)=>b.count-a.count);
  const kings=king.filter(m=>m.count===king[0]?.count);
  return {day:a.day,d,checks,defendants:list.filter(m=>m.charges.length),giftOnly:list.filter(m=>!m.charges.length&&m.gifts.length),clean,kings,total:list.reduce((n,m)=>n+m.charges.length,0)};
 }

 // ---------- Kasten in der BumsParade ----------
 let boxOpen=false;
 function renderBox(){
  const el=document.getElementById('zeremonieBox');if(!el)return;
  const m=model();if(!m){el.innerHTML='';return;}
  const rows=m.defendants.map((x,i)=>`<li><span class="zer-row-name">${mgrName(x.name,'',x.id)}<span class="muted tiny">${x.charges.length} Anklagepunkt${x.charges.length===1?'':'e'}</span></span><span class="zer-row-rules">${x.charges.map(c=>`<span class="bums-rule bums-r-${safe(c.rule)}">${safe(c.rule)}</span>`).join('')}</span><button type="button" class="ghost" data-zer-akte="${i}">📜 Anklageschrift</button></li>`).join('');
  el.innerHTML=`<details class="center-box acc-todo-box zer-box"${boxOpen?' open':''}><summary class="center-boxhead"><strong>🎺 BumsParade · Spieltag ${m.day} · ${m.defendants.length} Angeklagte</strong><span class="pill">für Discord</span></summary>
  <p class="muted" style="margin-top:0">Für den Montagabend: Bildschirm in Discord teilen und die Strafen einzeln vollstrecken. Mit Trommelwirbel, Drehtür und Abspann. Leertaste oder → geht weiter, Esc beendet.</p>
  <p><button type="button" class="gold" data-zer-start>▶ BumsParade starten</button> <button type="button" class="ghost" data-zer-alltext>📝 Alle Anklagen als Text kopieren</button></p>
  ${m.defendants.length?`<p class="muted tiny" style="margin:14px 0 6px"><b>Anklageschriften</b> · je Sünder ein Bild zum Posten in Discord</p><ul class="zer-rows">${rows}</ul>`:'<p>Keine Angeklagten. Die Parade fällt aus. 😴</p>'}</details>`;
  el.querySelector('details').addEventListener('toggle',e=>{boxOpen=e.target.open;});
 }
 const orig=window.renderAccTodo;
 if(typeof orig==='function')window.renderAccTodo=function(){const r=orig.apply(this,arguments);try{renderBox();}catch(e){console.warn('Zeremonie',e);}return r;};
 const origCollapse=window.kblCollapseView;
 window.kblCollapseView=v=>{if(v==='accounting')boxOpen=false;return origCollapse?.(v);};

 // ---------- Ton: Trommelwirbel und Becken (WebAudio, ohne Dateien) ----------
 let ac=null,muted=false;try{muted=localStorage.getItem('kbl-zer-mute')==='1';}catch{}
 const audio=()=>{if(muted)return null;try{ac=ac||new (window.AudioContext||window.webkitAudioContext)();if(ac.state==='suspended')ac.resume();return ac;}catch{return null;}};
 function noise(c,len){const b=c.createBuffer(1,c.sampleRate*len,c.sampleRate),x=b.getChannelData(0);for(let i=0;i<x.length;i++)x[i]=Math.random()*2-1;return b;}
 function hit(c,t,vol,dur,freq){const s=c.createBufferSource();s.buffer=noise(c,dur);const f=c.createBiquadFilter();f.type='bandpass';f.frequency.value=freq;f.Q.value=.8;const g=c.createGain();g.gain.setValueAtTime(vol,t);g.gain.exponentialRampToValueAtTime(.001,t+dur);s.connect(f).connect(g).connect(c.destination);s.start(t);s.stop(t+dur);}
 function drumroll(sec){const c=audio();if(!c)return;const t0=c.currentTime;let t=t0;while(t<t0+sec){const p=(t-t0)/sec;hit(c,t,.12+.3*p,.07,1800);t+=.07-.035*p;}}
 function crash(){const c=audio();if(!c)return;const t=c.currentTime;hit(c,t,.5,1.6,6500);
  const o=c.createOscillator(),g=c.createGain();o.type='sine';o.frequency.setValueAtTime(90,t);o.frequency.exponentialRampToValueAtTime(40,t+.4);g.gain.setValueAtTime(.7,t);g.gain.exponentialRampToValueAtTime(.001,t+.5);o.connect(g).connect(c.destination);o.start(t);o.stop(t+.5);}
 function fanfare(){const c=audio();if(!c)return;const t=c.currentTime;[[523,0],[659,.18],[784,.36],[1047,.54]].forEach(([f,d])=>{const o=c.createOscillator(),g=c.createGain();o.type='triangle';o.frequency.value=f;g.gain.setValueAtTime(0,t+d);g.gain.linearRampToValueAtTime(.18,t+d+.03);g.gain.exponentialRampToValueAtTime(.001,t+d+(d>.5?1.2:.3));o.connect(g).connect(c.destination);o.start(t+d);o.stop(t+d+1.3);});}

 // ---------- Zeremonie (Vollbild) ----------
 let Z=null;
 function start(){
  const m=model();if(!m)return;
  // Ablauf: Titel, je Angeklagter ein Bild (Anklagepunkte darin einzeln), Davongekommene, Abspann.
  const steps=[{kind:'title'}];
  m.defendants.forEach((x,i)=>{steps.push({kind:'def',i,shown:0});x.charges.forEach((c,j)=>steps.push({kind:'def',i,shown:j+1}));});
  steps.push({kind:'clean'},{kind:'end'});
  Z={m,steps,i:0,local:new Set(),mvpTipp:null};
  const el=document.createElement('div');el.className='zer';el.setAttribute('role','dialog');el.setAttribute('aria-label','BumsParade');
  el.innerHTML=`<div class="zer-curtain l"></div><div class="zer-curtain r"></div><div class="zer-stage"></div><div class="zer-bar"><button type="button" class="ghost" data-zer="back" aria-label="Zurück">◀</button><span class="zer-prog"></span><button type="button" class="gold" data-zer="next"></button><button type="button" class="ghost" data-zer="mute" aria-label="Ton an oder aus"></button><button type="button" class="ghost" data-zer="close" aria-label="BumsParade beenden">✕</button></div>`;
  document.body.appendChild(el);document.body.classList.add('zer-on');Z.el=el;
  // Echtes Vollbild nur am PC: Auf dem Handy blendet der Browser sonst lange einen Hinweis über den Knöpfen ein (Kevin, Android).
  if(matchMedia('(pointer:fine)').matches)try{document.documentElement.requestFullscreen?.().catch(()=>{});}catch{}
  api(`/api/mvp-tipps/${m.day}`).then(x=>{Z&&(Z.mvpTipp=x);if(Z?.steps[Z.i].kind==='end')draw();}).catch(()=>{});
  draw();
 }
 function close(){if(!Z)return;Z.el.remove();Z=null;document.body.classList.remove('zer-on');try{if(document.fullscreenElement)document.exitFullscreen();}catch{}}
 function isDone(c){return c.done||Z.local.has(c.key)||(c.src&&Z.local.has(c.src));}
 function chargeHtml(c,j,n,fresh){
  const done=isDone(c),door=c.rule==='DD'&&c.options.length;
  const slot=(o,k,len)=>{const a=len<=4?45+90*k:Math.round(360*k/len);return `<div class="rdoor-slot" style="--a:${a}deg"><div class="rdoor-bill"><div class="rdoor-face"><div class="zer-door-tag">${safe(o.name)}<b>${fmt(o.points)}</b></div></div></div></div>`;};
  const doorHtml=door?`<div class="rdoor has-cands zer-door" aria-hidden="true"><div class="rdoor-roof"></div><div class="rdoor-stage"><div class="rdoor-rot"><i></i><i></i><i></i><i></i>${c.options.map((o,k)=>slot(o,k,c.options.length)).join('')}</div></div><div class="rdoor-floor"></div><small>Dämonische Drehtür</small></div>`:'';
  return `<li class="zer-charge${fresh?' fresh':''}${done?' done':''}" style="--c:${COLOR[c.rule]||'#ebc768'}"><div class="zer-flip"><div class="zer-back"><span>Anklagepunkt ${j+1} von ${n}</span><b>?</b></div><div class="zer-front"><div class="zer-ch-head"><span class="zer-ch-icon">${ICON[c.rule]||'⚖️'}</span><span class="zer-ch-rule">${safe(c.rule)} · ${safe(RULE[c.rule]||c.rule)}</span></div><p class="zer-ch-text">${safe(c.text)}</p>${c.proof?`<p class="zer-ch-proof">${safe(c.proof)}</p>`:''}${doorHtml}${c.recv.map(r=>`<p class="zer-ch-recv">${safe(r)}</p>`).join('')}<div class="zer-ch-foot">${done?`<span class="zer-stamp">VOLLSTRECKT</span>${c.auto?'<span class="muted tiny">die App hat es schon gesehen</span>':''}`:c.in?`<span class="muted tiny">wird mit der Abgabe vollstreckt</span>`:`<button type="button" class="gold zer-exec" data-zer-exec="${safe(c.key)}">Vollstreckt ✅</button>${c.needPick?'<span class="muted tiny">Empfänger danach in der BumsParade auswählen</span>':''}`}</div></div></div></li>`;
 }
 function draw(){
  if(!Z)return;const {m,steps}=Z,s=steps[Z.i],st=Z.el.querySelector('.zer-stage'),next=Z.el.querySelector('[data-zer="next"]');
  Z.el.classList.toggle('open',s.kind!=='title');
  Z.el.querySelector('[data-zer="mute"]').textContent=muted?'🔇':'🔊';
  Z.el.querySelector('[data-zer="back"]').disabled=Z.i===0;
  Z.el.querySelector('.zer-prog').textContent=`${Z.i+1} / ${steps.length}`;
  const nx=steps[Z.i+1];
  next.textContent=!nx?'Vorhang zu ✕':nx.kind==='def'&&s.kind==='def'&&nx.i===s.i?'🥁 Nächster Anklagepunkt':nx.kind==='def'?(s.kind==='title'?'Die Parade beginnt ▶':'Nächster Angeklagter ▶'):nx.kind==='clean'?'Wer ist davongekommen? ▶':'Abspann ▶';
  if(s.kind==='title'){
   st.innerHTML=`<div class="zer-title"><p class="zer-kicker">KBL Legenden präsentiert</p><h1>Die BumsParade</h1><p class="zer-sub">Spieltag ${m.day} · ${m.total} Strafe${m.total===1?'':'n'} · ${m.defendants.length} Angeklagte</p><div class="zer-faces">${m.defendants.map(x=>`<span>${mgrFace(x.name,'mgr-av-lg',x.id)}<small>${safe(x.name)}</small></span>`).join('')}</div><p class="zer-hint">Bitte erheben Sie sich. Das hohe Gericht der Legenden tagt.</p><button type="button" class="gold zer-go" data-zer="next">▶ Die Parade beginnt</button></div>`;
  }else if(s.kind==='def'){
   const x=m.defendants[s.i],n=x.charges.length,fresh=s.shown>0&&steps[Z.i-1]?.i===s.i&&steps[Z.i-1].shown===s.shown-1&&Z.dir>0;
   st.innerHTML=`<div class="zer-def"><div class="zer-def-head${s.shown===0&&Z.dir>0?' enter':''}">${mgrFace(x.name,'zer-av',x.id)}<div><p class="zer-kicker">Angeklagter ${s.i+1} von ${m.defendants.length}</p><h2>${safe(x.name)}</h2><p class="muted">${x.place?`Platz ${x.place} am Spieltag`:''}${x.pts!=null?` · ${fmt(x.pts)} Punkte`:''} · ${n} Anklagepunkt${n===1?'':'e'}${s.shown===n?` · <b class="zer-verdict">${VERDICT(n)}</b>`:''}</p>${x.gifts.length?`<p class="zer-gifts">${x.gifts.map(safe).join('<br>')}</p>`:''}</div><button type="button" class="ghost zer-akte-btn" data-zer-akte="${s.i}">📜 Anklageschrift</button></div><ol class="zer-charges">${x.charges.map((c,j)=>j<s.shown?chargeHtml(c,j,n,fresh&&j===s.shown-1):`<li class="zer-charge zer-wait"><div class="zer-flip"><div class="zer-back"><span>Anklagepunkt ${j+1} von ${n}</span><b>?</b></div></div></li>`).join('')}</ol></div>`;
   st.querySelectorAll('.zer-charge:not(.zer-wait)').forEach((li,j)=>{if(!fresh||j<s.shown-1)li.classList.add('flipped');});
   if(fresh){const li=st.querySelectorAll('.zer-charge')[s.shown-1];li.scrollIntoView({block:'nearest',behavior:reduced()?'auto':'smooth'});
    const wait=reduced()?0:1600;li.classList.add('rolling');drumroll(wait/1000||.3);
    setTimeout(()=>{li.classList.remove('rolling');li.classList.add('flipped');crash();},wait);}
   if(s.shown===0&&Z.dir>0)fanfare();
  }else if(s.kind==='clean'){
   st.innerHTML=`<div class="zer-title"><p class="zer-kicker">Freispruch</p><h1 class="zer-h1-sm">Davongekommen</h1>${m.clean.length?`<div class="zer-faces">${m.clean.map(x=>`<span>${mgrFace(x.name,'mgr-av-lg',x.id)}<small>${safe(x.name)}</small></span>`).join('')}</div><p class="zer-hint">Diesmal keine Bumsung. Nächste Woche wird zurückgeschlagen.</p>`:'<p class="zer-hint">Niemand. Wirklich niemand. Alle gebumst. 🫠</p>'}${m.giftOnly.length?`<p class="zer-sub" style="margin-top:28px">Nur beschenkt</p>${m.giftOnly.map(x=>`<p class="zer-gifts">${mgrName(x.name,'',x.id)}: ${x.gifts.map(safe).join(' · ')}</p>`).join('')}`:''}</div>`;
  }else{
   const d=m.d,w=d.dd?.winners||[],l=d.dd?.lastPlace||[],mvp=d.ah?.mvp?.players||[],res=Z.mvpTipp?.result;
   const nameOf=id=>(d.plausibility||[]).find(p=>String(p.managerId)===String(id))?.manager||id;
   const tipWin=res?((res.winners?.length?res.winners:(res.rows||[]).filter(r=>r.hit).map(r=>r.managerId))).map(nameOf):null;
   const all=m.defendants.flatMap(x=>x.charges),done=all.filter(isDone).length;
   const line=(k,v)=>`<div class="zer-credit"><span>${k}</span><b>${v}</b></div>`;
   st.innerHTML=`<div class="zer-end"><div class="zer-roll${reduced()?' still':''}"><p class="zer-kicker">Abspann</p><h1 class="zer-h1-sm">Spieltag ${m.day}</h1>
    ${w.length?line('🏆 Spieltagssieger',w.map(x=>`${mgrName(x.manager,'',x.managerId)} ${fmt(x.dayPoints)}`).join(', ')):''}
    ${l.length?line('🏮 Rote Laterne',l.map(x=>`${mgrName(x.manager,'',x.managerId)} ${fmt(x.dayPoints)}`).join(', ')):''}
    ${mvp.length?line('⭐ MVP des Spieltags',mvp.map(p=>`${safe(p.name)} (${safe(p.team)}) ${fmt(p.points)}`).join(', ')):''}
    ${line('🎯 MVP-Tipp',tipWin==null?'wird geladen …':tipWin.length?tipWin.map(n=>mgrName(n)).join(', '):'kein Treffer')}
    ${m.kings.length?line('👑 Bumskönig des Spieltags',m.kings.map(k=>`${mgrName(k.name)} ${k.count}×`).join(', ')):''}
    ${line('✅ Vollstreckt',`${done} von ${all.length}`)}
    <p class="zer-hint" style="margin-top:30px">Die Sitzung ist geschlossen. Bis nächsten Montag! 🤡</p></div></div>`;
   if(Z.dir>0)fanfare();
  }
 }
 function go(dir){if(!Z)return;const n=Z.i+dir;if(n<0)return;if(n>=Z.steps.length){close();return;}Z.dir=dir;Z.i=n;draw();}
 async function execute(key){
  if(!Z)return;const c=Z.m.defendants.flatMap(x=>x.charges).find(c=>c.key===key);if(!c)return;
  Z.local.add(key);crash();
  // Wie der Haken in der BumsParade speichern (online nur als angemeldeter Admin); Auswahl-Regeln ohne Empfänger nur hier markieren.
  if((!window.KBL_STATIC||window.kblHaken?.admin())&&!c.needPick&&!c.done){
   try{const d=await api(`/api/todo-checks/${Z.m.day}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({key,done:true})});centerAccounting.checks=d.checks||{};renderAccTodo();}catch{}}
  const li=Z.el.querySelector(`[data-zer-exec="${CSS.escape(key)}"]`)?.closest('.zer-charge');
  if(li){li.classList.add('done');li.querySelector('.zer-ch-foot').innerHTML='<span class="zer-stamp hit">VOLLSTRECKT</span>';}
 }

 // ---------- Anklageschrift als Bild ----------
 const imgCache=new Map();
 function loadImg(src){if(!src)return Promise.resolve(null);if(imgCache.has(src))return imgCache.get(src);
  const p=new Promise(r=>{const i=new Image();i.crossOrigin='anonymous';i.referrerPolicy='no-referrer';i.onload=()=>r(i);i.onerror=()=>r(null);i.src=src;setTimeout(()=>r(null),4000);});imgCache.set(src,p);return p;}
 const faceSrc=x=>{try{const k=x.id!=null&&KBL_MGR_IMG.has('#'+x.id)?'#'+x.id:mgrKey(x.name);return KBL_MGR_IMG.get(k)||null;}catch{return null;}};
 function wrap(ctx,text,maxW){const out=[];for(const para of String(text).split('\n')){let line='';for(const w of para.split(' ')){const t=line?line+' '+w:w;if(ctx.measureText(t).width>maxW&&line){out.push(line);line=w;}else line=t;}out.push(line);}return out;}
 async function akteCanvas(m,x){
  const W=1080,P=72,cw=W-2*P,c=document.createElement('canvas'),ctx=c.getContext('2d');
  const serif='Georgia,"Times New Roman",serif',sans='"Segoe UI",Arial,sans-serif';
  // Erst messen, dann zeichnen.
  ctx.font=`600 34px ${sans}`;
  const blocks=x.charges.map(ch=>{ctx.font=`600 34px ${sans}`;const t=wrap(ctx,ch.text,cw-110);ctx.font=`26px ${sans}`;const p=ch.proof?wrap(ctx,ch.proof,cw-110):[];const r=ch.recv.length?wrap(ctx,ch.recv.join('  ·  '),cw-110):[];return {ch,t,p,r,h:70+t.length*44+p.length*36+r.length*36+24};});
  const H=Math.max(1080,520+blocks.reduce((n,b)=>n+b.h+20,0)+320);
  c.width=W;c.height=H;
  const g=ctx.createLinearGradient(0,0,0,H);g.addColorStop(0,'#14212b');g.addColorStop(1,'#081118');ctx.fillStyle=g;ctx.fillRect(0,0,W,H);
  ctx.strokeStyle='#b48633';ctx.lineWidth=6;ctx.strokeRect(24,24,W-48,H-48);ctx.lineWidth=2;ctx.strokeStyle='#ebc768';ctx.strokeRect(38,38,W-76,H-76);
  ctx.textAlign='center';ctx.fillStyle='#ebc768';ctx.font=`700 30px ${sans}`;ctx.fillText('⚖️  DAS HOHE GERICHT DER KBL LEGENDEN  ⚖️',W/2,110);
  ctx.font=`700 92px ${serif}`;ctx.fillStyle='#f4d777';ctx.fillText('Anklageschrift',W/2,210);
  ctx.font=`28px ${sans}`;ctx.fillStyle='#9db0bd';ctx.fillText(`BumsParade · Spieltag ${m.day}`,W/2,256);
  // Angeklagter mit Profilbild.
  let y=300;const img=await loadImg(faceSrc(x)),R=58,cx=P+R,cy=y+R;
  ctx.save();ctx.beginPath();ctx.arc(cx,cy,R,0,Math.PI*2);ctx.closePath();ctx.fillStyle='#22313c';ctx.fill();ctx.clip();
  if(img){try{ctx.drawImage(img,cx-R,cy-R,2*R,2*R);}catch{}}else{ctx.fillStyle='#ebc768';ctx.font=`700 56px ${sans}`;ctx.textAlign='center';ctx.fillText((x.name[0]||'?').toUpperCase(),cx,cy+20);}
  ctx.restore();ctx.beginPath();ctx.arc(cx,cy,R,0,Math.PI*2);ctx.strokeStyle='#ebc768';ctx.lineWidth=3;ctx.stroke();
  ctx.textAlign='left';ctx.fillStyle='#9db0bd';ctx.font=`600 24px ${sans}`;ctx.fillText('ANGEKLAGT',P+2*R+30,y+38);
  ctx.fillStyle='#e9f0f4';ctx.font=`700 54px ${sans}`;ctx.fillText(x.name,P+2*R+30,y+92);
  ctx.fillStyle='#9db0bd';ctx.font=`26px ${sans}`;ctx.fillText([x.place?`Platz ${x.place}`:'',x.pts!=null?`${fmt(x.pts)} Punkte`:'',`${x.charges.length} Anklagepunkt${x.charges.length===1?'':'e'}`].filter(Boolean).join('  ·  '),P+2*R+30,y+130);
  y+=170;ctx.fillStyle='#cfd9e0';ctx.font=`italic 28px ${serif}`;
  for(const l of wrap(ctx,`Die Anklage wirft ${x.name} vor, am Spieltag ${m.day} gegen die heiligen Regeln der Liga verstoßen zu haben:`,cw)){y+=38;ctx.fillText(l,P,y);}
  y+=34;
  for(const [k,b] of blocks.entries()){const col=COLOR[b.ch.rule]||'#ebc768';
   ctx.fillStyle='rgba(255,255,255,.04)';ctx.fillRect(P,y,cw,b.h);ctx.fillStyle=col;ctx.fillRect(P,y,8,b.h);
   ctx.fillStyle=col;ctx.font=`800 26px ${sans}`;ctx.fillText(`${k+1}.  ${b.ch.rule} · ${(RULE[b.ch.rule]||b.ch.rule).toUpperCase()}`,P+36,y+44);
   let yy=y+44;ctx.fillStyle='#e9f0f4';ctx.font=`600 34px ${sans}`;for(const l of b.t){yy+=44;ctx.fillText(l,P+36,yy);}
   ctx.fillStyle='#9db0bd';ctx.font=`26px ${sans}`;for(const l of b.p){yy+=36;ctx.fillText(l,P+36,yy);}
   ctx.fillStyle='#ebc768';for(const l of b.r){yy+=36;ctx.fillText(l,P+36,yy);}
   if(isDoneStatic(b.ch)){ctx.save();ctx.translate(P+cw-120,y+36);ctx.rotate(-.12);ctx.strokeStyle='#7fd3a6';ctx.lineWidth=3;ctx.strokeRect(-95,-22,190,44);ctx.fillStyle='#7fd3a6';ctx.font=`900 24px ${sans}`;ctx.textAlign='center';ctx.fillText('VOLLSTRECKT',0,9);ctx.restore();ctx.textAlign='left';}
   y+=b.h+20;}
  y+=20;ctx.textAlign='center';ctx.fillStyle='#f1a5aa';ctx.font=`800 40px ${sans}`;ctx.fillText(`Urteil: schuldig. ${VERDICT(x.charges.length)}`,W/2,y+40);y+=60;
  ctx.fillStyle='#728592';ctx.font=`24px ${sans}`;ctx.fillText('Vollstreckung: Montagabend, BumsParade auf Discord  🤡',W/2,H-70);
  return c;
 }
 const isDoneStatic=ch=>ch.done||(Z?.local.has(ch.key))||(ch.src&&Z?.local.has(ch.src));
 function akteText(m,x){return `**📜 ANKLAGESCHRIFT · Spieltag ${m.day}**\nAngeklagt: **${x.name}**${x.place?` (Platz ${x.place}, ${fmt(x.pts)} Pkt.)`:''}\n${x.charges.map((c,i)=>`${i+1}. **${c.rule}** ${ICON[c.rule]||''} ${c.text}${c.proof?` (${c.proof})`:''}`).join('\n')}\n**Urteil: schuldig. ${VERDICT(x.charges.length)}**`;}
 async function copyText(t,btn){try{await navigator.clipboard.writeText(t);flash(btn,'✓ kopiert');}catch{prompt('Zum Kopieren markieren:',t);}}
 const flash=(btn,t)=>{if(!btn)return;const o=btn.textContent;btn.textContent=t;setTimeout(()=>{btn.textContent=o;},1600);};
 async function openAkte(i){
  const m=Z?.m||model();if(!m)return;const x=m.defendants[i];if(!x)return;
  const box=document.createElement('div');box.className='zer-akte';box.setAttribute('role','dialog');box.setAttribute('aria-label',`Anklageschrift ${x.name}`);
  box.innerHTML=`<div class="zer-akte-in"><div class="zer-akte-img"><p class="muted">Anklageschrift wird geschrieben …</p></div><div class="zer-akte-btns"><button type="button" class="gold" data-a="copy">📋 Bild kopieren</button><button type="button" class="ghost" data-a="save">⬇ Bild speichern</button><button type="button" class="ghost" data-a="text">📝 Text kopieren</button><button type="button" class="ghost" data-a="close">Schließen</button></div><p class="muted tiny">In Discord einfügen (Strg+V) oder das gespeicherte Bild hochladen.</p></div>`;
  document.body.appendChild(box);
  const cv=await akteCanvas(m,x);let url=null,blob=null;
  try{blob=await new Promise(r=>cv.toBlob(r,'image/png'));url=URL.createObjectURL(blob);}catch{}
  box.querySelector('.zer-akte-img').innerHTML=url?`<img src="${url}" alt="Anklageschrift ${safe(x.name)}">`:'<p class="error">Bild nicht möglich (Profilbild gesperrt). Text kopieren geht.</p>';
  box.addEventListener('click',async e=>{const a=e.target.closest('[data-a]')?.dataset.a;if(e.target===box||a==='close'){box.remove();if(url)URL.revokeObjectURL(url);return;}
   if(a==='text')copyText(akteText(m,x),e.target);
   if(a==='save'&&url){const l=document.createElement('a');l.href=url;l.download=`anklageschrift-st${m.day}-${x.name}.png`;l.click();}
   if(a==='copy'&&blob){try{await navigator.clipboard.write([new ClipboardItem({'image/png':blob})]);flash(e.target,'✓ kopiert');}catch{flash(e.target,'geht hier nicht, bitte speichern');}}});
 }

 // ---------- Bedienung ----------
 document.addEventListener('click',e=>{
  if(e.target.closest('[data-zer-start]'))return start();
  const ak=e.target.closest('[data-zer-akte]');if(ak)return openAkte(Number(ak.dataset.zerAkte));
  if(e.target.closest('[data-zer-alltext]')){const m=model();if(m)copyText(m.defendants.map(x=>akteText(m,x)).join('\n\n'),e.target);return;}
  const ex=e.target.closest('[data-zer-exec]');if(ex)return execute(ex.dataset.zerExec);
  const b=e.target.closest('[data-zer]');if(!b||!Z)return;const k=b.dataset.zer;
  if(k==='next')go(1);else if(k==='back')go(-1);else if(k==='close')close();
  else if(k==='mute'){muted=!muted;try{localStorage.setItem('kbl-zer-mute',muted?'1':'0');}catch{}draw();}
 });
 document.addEventListener('keydown',e=>{
  if(document.querySelector('.zer-akte')){if(e.key==='Escape')document.querySelector('.zer-akte').remove();return;}
  if(!Z)return;
  if(e.key==='Escape'){e.preventDefault();close();}
  else if(e.key===' '||e.key==='ArrowRight'||e.key==='Enter'&&!e.target.closest('button')){e.preventDefault();go(1);}
  else if(e.key==='ArrowLeft'){e.preventDefault();go(-1);}
 });
 try{renderBox();}catch{}
})();
