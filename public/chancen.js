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
 // Heutige Besitzer (Kevin 23.11., Schäfer ST 9: am Spieltag frei, heute bei Mic193). Aus den heutigen Kadern aller Manager, T1000 ausgenommen.
 let nowOwner=null,nowP=null;
 function loadNow(){
  if(!nowP)nowP=(async()=>{const get=u=>fetch(u,{credentials:'same-origin'}).then(r=>r.ok?r.json():null).catch(()=>null);
   const r=await get('/api/ranking/6422780'),map=new Map();
   const us=(r?.us||[]).filter(u=>String(u.i)!=='3783040'&&String(u.n||'').toLowerCase()!=='t1000');
   const sq=await Promise.all(us.map(u=>get(`/api/manager-squad-v4/6422780/${u.i}`)));
   let ok=0;us.forEach((u,i)=>{const it=sq[i]?.data?.it;if(Array.isArray(it)){ok++;it.forEach(p=>map.set(String(p.pi),{id:String(u.i),name:u.n}));}});
   nowOwner=us.length&&ok===us.length?map:null;
   for(const k in cur)if(cur[k])render(k);})();
  return nowP;
 }
 // Heute bei: nur wenn sich der Besitzer seit dem Spieltag geändert hat.
 const today=x=>{if(!nowOwner)return null;const o=nowOwner.get(String(x.playerId));
  if(x.place==='bank')return o?.id===String(x.managerId)?null:o||{none:true};return o||null;};
 function item(x){
  const pts=x.points!=null?` <span class="ch-pts">${num(x.points)} Pkt.</span>`:'';
  const t=today(x),now=t?(t.none?'heute bei keinem Manager':`heute bei ${mgr(t.name,t.id)}`):'';
  const who=x.place==='bank'?`<span class="ch-who">auf der Bank bei ${mgr(x.manager,x.managerId)}${now?' · '+now:''}</span>`:now?`<span class="ch-who">${now}</span>`:'';
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
  if(items.length&&!nowP)loadNow();
  box.innerHTML=`<details class="acc-group ch-box"${wasOpen?' open':''}><summary>🍀 Verpasste Chancen${pill?` <span class="pts-sub">${pill}</span>`:''}</summary><div class="acc-sub">
   ${items.length&&!d.message?'<div class="ch-tools"><button type="button" class="ghost small" data-ch-shot>📷 Als Bild</button></div>':''}
   ${d.message?`<p class="muted">${esc(d.message)}</p>`:`<p class="muted tiny" style="margin:0 0 8px">Diese Spieler haben an Spieltag ${esc(d.day)} eine Regel ausgelöst, standen aber in keiner Startelf. Darum keine Bumsung.</p>
   ${items.length?grp('🪑 Nur auf der Bank',bank)+grp('🛒 Am Spieltag bei keinem Manager',frei):'<p class="muted">Keine verpassten Chancen: Jeder betroffene Spieler stand in einer Startelf.</p>'}`}
   ${(d.notes||[]).map(n=>`<p class="muted tiny">${esc(n)}</p>`).join('')}</div></details>`;
 }
 // Als Bild (Kevin 23.11.): gleiches Bild-Fenster wie überall (kblImgDialog), 1080 breit, dazu Text für Discord.
 const whoTxt=x=>{const t=today(x),now=t?(t.none?'heute bei keinem Manager':`heute bei ${t.name}`):'';
  return [x.place==='bank'?`auf der Bank bei ${x.manager}`:'',now].filter(Boolean).join(' · ');};
 const umTxt=x=>x.rule==='UM'&&x.recipient?` · wäre an ${x.recipient==='Markt'?'den Markt':x.recipient} gegangen`:'';
 function shotCanvas(d){
  const items=d.items||[],groups=[['🪑 Nur auf der Bank',items.filter(x=>x.place==='bank')],['🛒 Am Spieltag bei keinem Manager',items.filter(x=>x.place!=='bank')]].filter(g=>g[1].length);
  const W=1080,P=44,RH=96,GH=70,HEAD=190,c=document.createElement('canvas'),ctx=c.getContext('2d');
  const sans='"Segoe UI",Arial,sans-serif',serif='Georgia,"Times New Roman",serif';
  // Zweite Zeile (Grund, Besitzer) bricht bei Bedarf um, statt abgeschnitten zu werden.
  const wrap=t=>{ctx.font=`500 22px ${sans}`;const max=W-2*P-32,out=[];let line='';
   for(const w of String(t).split(' ')){const n=line?line+' '+w:w;if(line&&ctx.measureText(n).width>max){out.push(line);line=w;}else line=n;}
   if(line)out.push(line);return out;};
  const sub=new Map(items.map(x=>[x,wrap([x.reason+umTxt(x),whoTxt(x)].filter(Boolean).join(' · '))]));
  const rh=x=>RH+(sub.get(x).length-1)*28;
  const H=HEAD+groups.reduce((n,g)=>n+GH+g[1].reduce((m,x)=>m+rh(x),0),0)+80;c.width=W;c.height=H;
  const g=ctx.createLinearGradient(0,0,0,H);g.addColorStop(0,'#14212b');g.addColorStop(1,'#081118');ctx.fillStyle=g;ctx.fillRect(0,0,W,H);
  ctx.strokeStyle='#b48633';ctx.lineWidth=5;ctx.strokeRect(14,14,W-28,H-28);
  const ell=(t,max)=>{t=String(t);if(ctx.measureText(t).width<=max)return t;while(t.length>1&&ctx.measureText(t+'…').width>max)t=t.slice(0,-1);return t+'…';};
  ctx.textAlign='left';ctx.fillStyle='#ebc768';ctx.font=`700 24px ${sans}`;ctx.fillText('KBL LEGENDEN',P,P+36);
  ctx.font=`700 56px ${serif}`;ctx.fillStyle='#f4d777';ctx.fillText(`🍀 Verpasste Chancen · Spieltag ${d.day}`,P,P+104);
  ctx.font=`500 24px ${sans}`;ctx.fillStyle='#9fb3c0';ctx.fillText(ell('Regel ausgelöst, aber in keiner Startelf: keine Bumsung.',W-2*P),P,P+142);
  let y=HEAD;
  for(const [t,l] of groups){
   ctx.font=`700 32px ${sans}`;ctx.fillStyle='#ebc768';ctx.fillText(`${t} · ${l.length}`,P,y+46);y+=GH;
   for(const x of l){
    ctx.fillStyle='rgba(255,255,255,.05)';ctx.fillRect(P,y,W-2*P,rh(x)-12);
    ctx.font=`800 24px ${sans}`;const rw=ctx.measureText(x.rule).width+22;
    ctx.fillStyle='#7a2e35';ctx.fillRect(P+14,y+14,rw,34);ctx.fillStyle='#fff';ctx.fillText(x.rule,P+25,y+40);
    const pts=x.points!=null?`${num(x.points)} Pkt.`:'';ctx.font=`700 28px ${sans}`;const pw=ctx.measureText(pts).width;
    ctx.textAlign='right';ctx.fillStyle='#f1a5aa';ctx.fillText(pts,W-P-16,y+41);ctx.textAlign='left';
    ctx.fillStyle='#e9f0f4';ctx.fillText(ell(`${x.playerName||'Spieler '+x.playerId}${x.team?` (${x.team})`:''}${x.unsure?' ?':''}`,W-2*P-rw-pw-60),P+rw+28,y+41);
    ctx.font=`500 22px ${sans}`;ctx.fillStyle='#9fb3c0';
    sub.get(x).forEach((l,i)=>ctx.fillText(l,P+16,y+74+i*28));
    y+=rh(x);
   }
  }
  ctx.font=`500 20px ${sans}`;ctx.fillStyle='#6f8594';ctx.fillText('BumsKI · KBL Legenden',P,H-40);
  return c;
 }
 function shotText(d){
  const items=d.items||[],out=[`🍀 **Verpasste Chancen · Spieltag ${d.day}**`];
  for(const [t,l] of [['🪑 Nur auf der Bank',items.filter(x=>x.place==='bank')],['🛒 Am Spieltag bei keinem Manager',items.filter(x=>x.place!=='bank')]]){
   if(!l.length)continue;out.push('',`**${t}**`);
   for(const x of l)out.push(`• ${x.rule}: ${x.playerName||'Spieler '+x.playerId}${x.points!=null?` (${num(x.points)} Pkt.)`:''}, ${x.reason}${umTxt(x)}${whoTxt(x)?', '+whoTxt(x):''}`);
  }
  return out.join('\n');
 }
 document.addEventListener('click',async e=>{const b=e.target.closest('[data-ch-shot]');if(!b)return;
  const box=b.closest('#chancenBox,#chancenParade'),d=box&&cache[cur[box.id]];if(!d||!window.kblImgDialog)return;
  await loadNow().catch(()=>{});window.kblImgDialog(shotCanvas(d),`verpasste-chancen-st${d.day}.png`,()=>shotText(d),'Verpasste Chancen');});
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
