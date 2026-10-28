// Reiter "BumsKI Wrapped" (Kevin-Wunsch 28.10.): Rückblick je Manager auf die laufende Halbserie, als Karten zum Durchtippen
// wie ein Jahresrückblick. Bis Spieltag 17 bzw. 34 ein Zwischenstand, danach der Endstand.
// Rechnet nur aus Daten, die die App schon hat (nie raten): Liga-Ranking je Spieltag (historyData aus app.js),
// BumsTabelle (/api/bumsungen, online nachgerechnet wie bumsStaticDerive), Transfers (/api/transfers) und MVP-Tipp (/api/mvp-tipps/:day).
(()=>{
 const $=s=>document.querySelector(s);
 const esc=v=>String(v??'').replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
 const num=n=>n==null?'–':new Intl.NumberFormat('de-DE').format(n);
 const sgn=n=>n==null?'–':(n>0?'+':n<0?'−':'±')+num(Math.abs(n));
 const money=(n,sign)=>{if(n==null||!Number.isFinite(n))return '–';const a=Math.abs(n),s=sign?(n>0?'+':n<0?'−':'±'):n<0?'−':'';
  return s+(a>=1e6?new Intl.NumberFormat('de-DE',{maximumFractionDigits:1}).format(a/1e6)+' Mio.':new Intl.NumberFormat('de-DE',{maximumFractionDigits:0}).format(a/1e3)+' Tsd.');};
 const img=p=>!p?'':/^https?:\/\//.test(p)?p:'https://kickbase.b-cdn.net/'+String(p).replace(/^\//,'');
 const face=(n,cls='')=>typeof mgrFace==='function'?mgrFace(n,cls):'';
 const names=l=>l.map(esc).join(', ');
 const andList=l=>l.length<2?names(l):names(l.slice(0,-1))+' und '+esc(l[l.length-1]);
 const RN={BD:'Besoffener Davies',DD:'Dämonische Drehtür',MM:'Magic Miyoshi',AH:'Angeschossener Höler',RK:'Räudiger Kohr',BN:'Blinder Niklas',UM:'Upamaguire',EZ:'Einzelfallentscheidung',TL:'Teamlimit'};
 const chip=k=>`<span class="bums-rule bums-r-${esc(k)}">${esc(k)}</span>`;
 let data=null,loading=null,who='',slide=0;

 const wait=async()=>{for(let i=0;i<60&&!(typeof historyData!=='undefined'&&historyData.some(h=>h.status==='finished'));i++)await new Promise(r=>setTimeout(r,500));};
 async function build(){
  await wait();
  const fin=historyData.filter(h=>h.status==='finished');
  if(!fin.length)return {empty:true};
  const ref=Math.max(...fin.map(h=>h.day)),from=ref<=17?1:18,to=ref<=17?17:34;
  const days=fin.filter(h=>h.day>=from&&h.day<=to).sort((a,b)=>a.day-b.day);
  const [bums,tr,tips]=await Promise.all([
   (async()=>{const d=(await api('/api/bumsungen')).days||{};if(window.KBL_STATIC&&typeof bumsStaticDerive==='function')try{await bumsStaticDerive(d);}catch{}return d;})().catch(()=>null),
   api('/api/transfers').catch(()=>null),
   Promise.all(days.map(h=>api(`/api/mvp-tipps/${h.day}`).then(d=>({day:h.day,d})).catch(()=>({day:h.day,d:null}))))]);
  const season=tr?.seasons?.find(s=>s.current)||null;
  const halfName=season?.key||(from===1?'Hinrunde':'Rückrunde');
  // Manager: alle aus dem letzten Spieltag (T1000 ist dort schon raus).
  const mgrs=[...new Set(days.flatMap(h=>h.list.map(m=>m.name)))];
  const M={};for(const n of mgrs)M[n]={name:n,days:[],ranks:[],wins:[],lasts:[],bums:0,rules:{},per:{},by:{},on:{},clean:0,bumsDays:0,tipped:0,hits:0,best:0,tips:[]};
  // Ranking: Spieltagspunkte und Platz in der Gesamtwertung je Spieltag.
  for(const h of days){
   const ok=h.list.filter(m=>m.dayPoints!==null),hi=Math.max(...ok.map(m=>m.dayPoints)),lo=Math.min(...ok.map(m=>m.dayPoints));
   for(const m of h.list){const e=M[m.name];if(!e)continue;
    if(m.dayPoints!==null){e.days.push({day:h.day,p:m.dayPoints,place:1+ok.filter(x=>x.dayPoints>m.dayPoints).length,of:ok.length});
     if(m.dayPoints===hi)e.wins.push(h.day);if(ok.length>1&&m.dayPoints===lo)e.lasts.push(h.day);}
    if(m.score!=null)e.ranks.push({day:h.day,r:1+h.list.filter(x=>x.score>m.score).length});}
  }
  const last=days[days.length-1],table=last?.list.filter(m=>m.score!=null)||[];
  for(const m of table)if(M[m.name]){M[m.name].score=m.score;M[m.name].pos=1+table.filter(x=>x.score>m.score).length;}
  // BumsTabelle: nur Spieltage dieser Halbserie. Erzfeind = wer einen am häufigsten gebumst hat (Empfänger-Einträge „… von X“, wie „Wer bumst wen“).
  const bDays=bums?Object.keys(bums).map(Number).filter(d=>d>=from&&d<=to).sort((a,b)=>a-b):[];
  for(const d of bDays)for(const v of Object.values(bums[d].managers||{})){const e=M[v.name];if(!e)continue;
   e.bumsDays++;e.bums+=v.count;e.per[d]=v.count;if(v.count===0)e.clean++;
   for(const [k,n] of Object.entries(v.rules||{}))e.rules[k]=(e.rules[k]||0)+n;
   for(const x of (v.moves||[])){if(x.d!=='i')continue;const m=/ von (.+?)(?::|$)/.exec(x.t||'');if(!m)continue;const by=m[1].trim();if(!by||by===v.name)continue;
    (e.by[by]||(e.by[by]={n:0,rules:{}})).n++;e.by[by].rules[x.r]=(e.by[by].rules[x.r]||0)+1;
    if(M[by]){(M[by].on[v.name]||(M[by].on[v.name]={n:0,rules:{}})).n++;M[by].on[v.name].rules[x.r]=(M[by].on[v.name].rules[x.r]||0)+1;}}}
  // Transfers der laufenden Halbserie: größter Verlust und Gewinn je verkauftem Spieler.
  if(season)for(const t of season.managers||[]){const e=M[t.name];if(!e||t.error)continue;
   const sold=(t.trades||[]).filter(x=>x.status==='sold'&&Number.isFinite(x.diff));
   e.tr={realized:t.realized,sold:sold.length,buys:t.buys,sells:t.sells,img:t.img};
   const lo=Math.min(...sold.map(x=>x.diff)),hi=Math.max(...sold.map(x=>x.diff));
   if(sold.length&&lo<0)e.tr.worst=sold.find(x=>x.diff===lo);if(sold.length&&hi>0)e.tr.best=sold.find(x=>x.diff===hi);}
  // MVP-Tipp: nur Spieltage, an denen getippt wurde.
  const idName={};for(const {d} of tips)for(const m of d?.managers||[])idName[m.id]=m.name;
  const tipDays=tips.filter(({d})=>d?.managers?.some(m=>m.tipped));
  for(const {day,d} of tipDays){const rows=new Map((d.result?.rows||[]).map(r=>[String(r.managerId),r])),bestIds=new Set((d.result?.best?.managers||[]).map(String));
   for(const m of d.managers){const e=M[m.name];if(!e||!m.tipped)continue;const r=rows.get(String(m.id));
    e.tipped++;if(r?.hit)e.hits++;if(bestIds.has(String(m.id)))e.best++;
    e.tips.push({day,player:m.tip?.player,points:m.tip?.points,got:d.tracking?.players?.[m.tip?.playerId]?.points,hit:!!r?.hit,best:bestIds.has(String(m.id)),late:!!m.tip?.late});}}
  return {halfName,from,to,ref:last.day,closed:last.day===to,days:days.length,bumsN:bDays.length,tipN:tipDays.length,M,mgrs,idName};
 }

 // Titel der Halbserie: wer in einer Wertung allein oder gemeinsam vorne liegt (Gleichstand = alle).
 const AWARDS=[
  ['👑','Spieltagskönig','meiste Spieltagssiege',e=>e.wins.length,'hi',v=>`${v} Sieg${v===1?'':'e'}`],
  ['🚀','Rekord-Spieltag','meiste Punkte an einem Spieltag',e=>e.days.length?Math.max(...e.days.map(x=>x.p)):null,'hi',v=>`${num(v)} Punkte`],
  ['🏮','Rote Laterne','meiste Spieltage als Letzter',e=>e.lasts.length,'hi',v=>`${v}× Letzter`],
  ['💥','Bumskönig','meiste Bumsungen',e=>e.bumsDays?e.bums:null,'hi',v=>`${v} Bumsung${v===1?'':'en'}`],
  ['😇','Weißeste Weste','meiste Spieltage ohne Bumsung',e=>e.bumsDays?e.clean:null,'hi',v=>`${v} Spieltag${v===1?'':'e'} sauber`],
  ['💸','Transfer-Pechvogel','größter Verlust mit einem Spieler',e=>e.tr?.worst?.diff??null,'lo',v=>money(v,true)],
  ['🦊','Transfer-Fuchs','größter Gewinn mit einem Spieler',e=>e.tr?.best?.diff??null,'hi',v=>money(v,true)],
  ['🎯','Tipp-Ass','am häufigsten bester MVP-Tipper',e=>e.best,'hi',v=>`${v}× bester Tipper`]];
 function awards(){
  const out=[];for(const [ico,title,desc,val,dir,show] of AWARDS){
   const vals=data.mgrs.map(n=>[n,val(data.M[n])]).filter(([,v])=>v!=null&&(dir==='lo'||v>0));if(!vals.length)continue;
   const top=dir==='hi'?Math.max(...vals.map(x=>x[1])):Math.min(...vals.map(x=>x[1]));
   out.push({ico,title,desc,value:show(top),who:vals.filter(x=>x[1]===top).map(x=>x[0])});}
  return out;
 }
 // Kleine Linie: Platz in der Gesamtwertung je Spieltag (oben = Platz 1).
 function rankLine(ranks,of){
  if(ranks.length<2)return '';const W=260,H=70,x=i=>8+i*(W-16)/(ranks.length-1),y=r=>8+(r-1)*(H-16)/Math.max(1,of-1);
  const pts=ranks.map((r,i)=>`${x(i).toFixed(1)},${y(r.r).toFixed(1)}`).join(' ');
  return `<svg class="wr-line" viewBox="0 0 ${W} ${H}" role="img" aria-label="Platz je Spieltag"><polyline points="${pts}"/>${ranks.map((r,i)=>`<circle cx="${x(i).toFixed(1)}" cy="${y(r.r).toFixed(1)}" r="3.5"/><text x="${x(i).toFixed(1)}" y="${H-1}">${r.day}</text>`).join('')}</svg>`;
 }
 function slides(n){
  const e=data.M[n],D=data,out=[],of=D.mgrs.length,stand=D.closed?`Endstand nach Spieltag ${D.ref}`:`Zwischenstand nach Spieltag ${D.ref} von ${D.to}`;
  const card=(cls,eyebrow,big,sub,body='')=>out.push(`<div class="wr-card ${cls}"><div class="wr-eyebrow">${eyebrow}</div><div class="wr-big">${big}</div>${sub?`<div class="wr-sub">${sub}</div>`:''}${body}</div>`);
  card('wr-c-intro','BumsKI WRAPPED',`${face(n,'wr-face')}<span class="wr-name">${esc(n)}</span>`,`Deine ${esc(D.halfName)}`,`<p class="wr-note">${esc(stand)}.${D.closed?'':' Fertig ist das Wrapped nach dem letzten Spieltag der Halbserie.'}</p><p class="wr-hint">Tippe rechts für weiter, links für zurück.</p>`);
  if(e.pos!=null){const br=Math.min(...e.ranks.map(r=>r.r)),wr=Math.max(...e.ranks.map(r=>r.r)),at=r=>e.ranks.filter(x=>x.r===r).map(x=>x.day).join(', ');
   card('wr-c-table','TABELLE',`Platz ${e.pos}`,`von ${of} · ${num(e.score)} Punkte`,`${rankLine(e.ranks,of)}<ul class="wr-facts"><li>Bester Platz: <b>${br}</b> <span>(ST ${at(br)})</span></li><li>Schlechtester Platz: <b>${wr}</b> <span>(ST ${at(wr)})</span></li></ul>`);}
  if(e.days.length){const b=Math.max(...e.days.map(x=>x.p)),w=Math.min(...e.days.map(x=>x.p)),bd=e.days.filter(x=>x.p===b),wd=e.days.filter(x=>x.p===w);
   const avg=Math.round(e.days.reduce((s,x)=>s+x.p,0)/e.days.length);
   card('wr-c-best','DEIN BESTER SPIELTAG',`${num(b)}`,`Punkte an Spieltag ${bd.map(x=>x.day).join(', ')} · Platz ${bd[0].place} von ${bd[0].of}`,`<ul class="wr-facts"><li>Spieltagssiege: <b>${e.wins.length}</b>${e.wins.length?` <span>(ST ${e.wins.join(', ')})</span>`:''}</li><li>Schnitt: <b>${num(avg)}</b> <span>Punkte pro Spieltag</span></li></ul>`);
   card('wr-c-worst','DEIN TIEFPUNKT',`${num(w)}`,`Punkte an Spieltag ${wd.map(x=>x.day).join(', ')} · Platz ${wd[0].place} von ${wd[0].of}`,`<ul class="wr-facts"><li>Letzter des Spieltags: <b>${e.lasts.length}×</b>${e.lasts.length?` <span>(ST ${e.lasts.join(', ')})</span>`:''}</li></ul>`);}
  if(e.bumsDays){const all=D.mgrs.map(x=>data.M[x]).filter(x=>x.bumsDays),place=1+all.filter(x=>x.bums>e.bums).length;
   const top=Object.entries(e.rules).sort((a,b)=>b[1]-a[1]),tr=top.length?top.filter(x=>x[1]===top[0][1]):[];
   const days=Object.keys(e.per).map(Number).sort((a,b)=>a-b),mx=Math.max(1,...days.map(d=>e.per[d]));
   card('wr-c-bums','BUMSUNGEN',`${e.bums}`,`Bumsung${e.bums===1?'':'en'} · Platz ${place} von ${all.length} in der BumsTabelle`,
    `<div class="wr-bars">${days.map(d=>`<span title="ST ${d}: ${e.per[d]}"><i style="height:${Math.round(e.per[d]/mx*100)}%"></i><b>${e.per[d]}</b><small>${d}</small></span>`).join('')}</div><ul class="wr-facts">${tr.length?`<li>Häufigste Regel: ${tr.map(([k])=>chip(k)+' '+esc(RN[k]||k)).join(', ')} <span>(${tr[0][1]}×)</span></li>`:''}<li>Weiße Westen: <b>${e.clean}</b> <span>von ${e.bumsDays} Spieltagen ohne Bumsung</span></li></ul>`);
   const by=Object.entries(e.by).sort((a,b)=>b[1].n-a[1].n),on=Object.entries(e.on).sort((a,b)=>b[1].n-a[1].n);
   const best=l=>l.length?l.filter(x=>x[1].n===l[0][1].n):[],rl=r=>Object.entries(r).map(([k,n])=>chip(k)+(n>1?` ×${n}`:'')).join(' ');
   const foe=best(by),prey=best(on);
   card('wr-c-foe','DEIN ERZFEIND',foe.length?`<span class="wr-faces">${foe.map(([x])=>face(x,'wr-face')).join('')}</span><span class="wr-name">${andList(foe.map(x=>x[0]))}</span>`:'Keiner',
    foe.length?`hat dich ${foe[0][1].n}× gebumst`:'Niemand hat dir in dieser Halbserie einen Spieler oder MM aufgedrückt.',
    `${foe.length?`<p class="wr-rules">${foe.map(([,v])=>rl(v.rules)).join(' · ')}</p>`:''}<ul class="wr-facts"><li>Dein Lieblingsopfer: ${prey.length?`<b>${andList(prey.map(x=>x[0]))}</b> <span>(${prey[0][1].n}× gebumst)</span>`:'<span>noch keins</span>'}</li></ul>`);}
  if(e.tr){const t=e.tr,w=t.worst,b=t.best,pi=x=>x.img?`<img class="wr-player" src="${esc(img(x.img))}" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.remove()">`:'';
   card('wr-c-trans','TEUERSTER FEHLKAUF',w?`${pi(w)}<span class="wr-name">${esc(w.name)}</span>`:'Keiner',
    w?`gekauft für ${money(w.buy?.price)}, verkauft für ${money(w.sell?.price)}: <b class="wr-neg">${money(w.diff,true)}</b>`:`Kein Spieler mit Verlust verkauft.`,
    `<ul class="wr-facts">${b?`<li>Bester Deal: <b>${esc(b.name)}</b> <span class="wr-pos">${money(b.diff,true)}</span></li>`:''}<li>Bilanz verkaufte Spieler: <b class="${t.realized>0?'wr-pos':t.realized<0?'wr-neg':''}">${money(t.realized,true)}</b> <span>(${t.sold} verkauft)</span></li></ul>`);}
  if(D.tipN){const q=e.tipped?Math.round(e.hits/e.tipped*100):null;
   card('wr-c-tipp','MVP-TIPP',`${e.tipped} von ${D.tipN}`,`Spieltag${D.tipN===1?'':'en'} getippt`,
    `<ul class="wr-facts"><li>Volltreffer: <b>${e.hits}</b>${q!=null?` <span>(Trefferquote ${q} %)</span>`:''}</li><li>Bester Tipper: <b>${e.best}×</b></li></ul>${e.tips.length?`<ul class="wr-tips">${e.tips.map(t=>`<li><span>ST ${t.day}</span> ${esc(t.player||'?')} <b>${num(t.points)}</b> getippt${t.got!=null?` · ${num(t.got)} geholt`:''}${t.hit?' · 🎯':''}${t.best?' · 👑 bester Tipper':''}</li>`).join('')}</ul>`:''}`);}
  const mine=awards().filter(a=>a.who.includes(n));
  card('wr-c-end','DEINE TITEL',mine.length?mine.map(a=>a.ico).join(' '):'🤷',mine.length?`${mine.length} Titel ${D.closed?'in':'bisher in'} der ${esc(D.halfName)}`:(D.closed?'Kein Titel in dieser Halbserie.':`Noch kein Titel. ${D.to-D.ref} Spieltag${D.to-D.ref===1?'':'e'} Zeit.`),
   mine.length?`<ul class="wr-awards">${mine.map(a=>`<li><b>${a.ico} ${esc(a.title)}</b> <span>${esc(a.value)}${a.who.length>1?` · gemeinsam mit ${andList(a.who.filter(x=>x!==n))}`:''}</span></li>`).join('')}</ul>`:'');
  return out;
 }
 function show(){
  const box=$('#wrStory');if(!box)return;const s=[...box.querySelectorAll('.wr-card')];slide=Math.max(0,Math.min(slide,s.length-1));
  s.forEach((c,i)=>c.classList.toggle('on',i===slide));
  box.querySelectorAll('.wr-prog i').forEach((p,i)=>p.className=i<slide?'done':i===slide?'now':'');
  box.querySelector('.wr-prev').disabled=slide===0;box.querySelector('.wr-next').disabled=slide===s.length-1;
 }
 function render(){
  const root=$('#wrappedContent');if(!root)return;
  if(data?.empty){root.className='muted';root.textContent='Noch kein Spieltag abgeschlossen.';return;}
  root.className='';
  const stored=(()=>{try{const id=String(JSON.parse(localStorage.getItem('kbl-push')||'null')?.managerId||'')||localStorage.getItem('kblMvpManager')||'';return data.idName[id]||'';}catch{return '';}})();
  if(!data.mgrs.includes(who))who=data.mgrs.includes(stored)?stored:'';
  $('#wrappedMeta').textContent=`${data.halfName} · ${data.closed?'Endstand':'nach ST '+data.ref}`;
  const pick=`<div class="controls"><label class="acc-label">Manager <select id="wrWho"><option value="">Bitte wählen …</option>${[...data.mgrs].sort((a,b)=>a.localeCompare(b,'de')).map(n=>`<option${n===who?' selected':''}>${esc(n)}</option>`).join('')}</select></label></div>`;
  const aw=awards();
  const league=aw.length?`<details class="hall-section prof-sec wr-league"><summary><h4>🏆 ALLE TITEL DER LIGA</h4></summary><div class="hall-grid">${aw.map(a=>`<article class="hall-card"><div class="hall-title">${a.ico} ${esc(a.title.toUpperCase())}</div><div class="hall-value">${esc(a.value)}</div><div class="hall-desc">${a.who.map(x=>typeof mgrLink==='function'?mgrLink(x):esc(x)).join(', ')} · ${esc(a.desc)}</div></article>`).join('')}</div></details>`:'';
  if(!who){root.innerHTML=`${pick}<div class="wr-pickgrid">${[...data.mgrs].sort((a,b)=>a.localeCompare(b,'de')).map(n=>`<button type="button" class="wr-pickbtn" data-wr-who="${esc(n)}">${face(n,'wr-face-s')}<span>${esc(n)}</span></button>`).join('')}</div>${league}`;return;}
  const s=slides(who);slide=0;
  root.innerHTML=`${pick}<div class="wr-story" id="wrStory" tabindex="0" aria-roledescription="Karten" aria-label="Wrapped von ${esc(who)}"><div class="wr-prog">${s.map(()=>'<i></i>').join('')}</div>${s.join('')}<button type="button" class="wr-nav wr-prev" aria-label="Zurück">‹</button><button type="button" class="wr-nav wr-next" aria-label="Weiter">›</button></div>${league}`;
  show();
 }
 async function load(){
  const root=$('#wrappedContent');if(!root)return;
  if(!loading)loading=build().then(d=>{data=d;}).catch(e=>{data=null;loading=null;root.className='error';root.textContent='Wrapped nicht abrufbar: '+e.message;});
  await loading;if(data)render();
 }
 document.addEventListener('click',e=>{
  if(e.target.closest?.('[data-kbl-nav="wrapped"]')){load();return;}
  const p=e.target.closest?.('[data-wr-who]');if(p){who=p.dataset.wrWho;render();return;}
  const box=e.target.closest?.('#wrStory');if(!box||e.target.closest('a'))return;
  if(e.target.closest('.wr-prev'))slide--;else if(e.target.closest('.wr-next'))slide++;
  else{const r=box.getBoundingClientRect();slide+=e.clientX-r.left<r.width/3?-1:1;}
  show();
 });
 document.addEventListener('keydown',e=>{if(!$('#wrStory')||!document.querySelector('.kbl-view[data-view="wrapped"].kbl-current'))return;
  if(e.key==='ArrowRight'){slide++;show();}else if(e.key==='ArrowLeft'){slide--;show();}});
 document.addEventListener('change',e=>{if(e.target.id==='wrWho'){who=e.target.value;render();}});
 window.addEventListener('hashchange',()=>{if(location.hash==='#wrapped')load();});
 if(location.hash==='#wrapped')load();
})();
