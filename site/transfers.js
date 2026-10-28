// Ansicht "Transfers" (Kevin-Wunsch): Transferhistorie je Manager mit Kauf- und Verkaufspreis und Gewinn/Verlust je Spieler.
// Daten von /api/transfers (Server: buildTransferHistory). Oben die Liga im Vergleich, darunter je Manager ein eingeklappter Bereich.
(()=>{
 const $=s=>document.querySelector(s);
 const esc=v=>String(v??'').replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
 const full=n=>n==null?'–':new Intl.NumberFormat('de-DE').format(n)+' €';
 // Kurz: 12,8 Mio. / 850 Tsd.; mit Vorzeichen für Gewinn/Verlust.
 const money=(n,sign)=>{
  if(n==null||!Number.isFinite(n))return '–';
  const a=Math.abs(n),s=sign?(n>0?'+':n<0?'−':'±'):n<0?'−':'';
  const t=a>=1e6?new Intl.NumberFormat('de-DE',{maximumFractionDigits:a>=1e8?0:1}).format(a/1e6)+' Mio.':a>=1e3?new Intl.NumberFormat('de-DE',{maximumFractionDigits:0}).format(a/1e3)+' Tsd.':new Intl.NumberFormat('de-DE').format(a)+' €';
  return s+t;
 };
 const cls=n=>n==null?'':n>0?'tr-pos':n<0?'tr-neg':'';
 const date=s=>s?new Date(s).toLocaleDateString('de-DE',{day:'2-digit',month:'2-digit',year:'2-digit'}):'';
 const img=p=>!p?'':/^https?:\/\//.test(p)?p:'https://kickbase.b-cdn.net/'+String(p).replace(/^\//,'');
 const face=(src,name)=>src?`<img class="tr-face" src="${esc(img(src))}" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.replaceWith(Object.assign(document.createElement('span'),{className:'tr-face tr-noimg',textContent:${esc(JSON.stringify((name||'?').trim()[0]||'?'))}}))">`:`<span class="tr-face tr-noimg">${esc((name||'?').trim()[0]||'?')}</span>`;
 let data=null,pech=null,loading=false,sortBy='realized',season=null;
 // Halbserien vom Server (Hinrunde bis Spieltag 17, Rückrunde danach; Feld seasons); ältere Exporte ohne seasons gelten als ein laufender Zeitraum.
 const seasons=()=>data?.seasons||(data?.managers?[{key:'',current:true,managers:data.managers}]:[]);
 // Liga-Zählung (Kevin): jede Halbserie heißt „Saison“, Saison 0 = Rückrunde 2024/25, dann je Halbserie eins weiter.
 const ligaSaison=key=>{const m=/^(Hin|Rück)runde (\d{4})\//.exec(key||'');if(!m)return '';const n=m[1]==='Hin'?2*(+m[2]-2025)+1:2*(+m[2]-2024);return n>=0?` (Saison ${n})`:' (vor Saison 0)';};
 const cur=()=>seasons().find(x=>x.key===season)||seasons()[0];

 async function get(url){
  const r=await fetch(url,{cache:'no-store'});const d=await r.json().catch(()=>({}));
  if(!r.ok)throw Error(d.error||`HTTP ${r.status}`);return d;
 }
 const SORTS={realized:['Verkaufte Spieler','realized'],unrealized:['Aktueller Kader','unrealized'],total:['Gesamt',m=>(m.realized||0)+(m.unrealized||0)]};
 const val=(m,k)=>{const f=SORTS[k][1];return typeof f==='function'?f(m):m[f];};

 // Liga im Vergleich: ein Balken je Manager, nach rechts grün (Gewinn), nach links rot (Verlust).
 function league(ms){
  const ok=ms.filter(m=>!m.error);
  if(!cur()?.current&&sortBy!=='realized')sortBy='realized';
  const rows=[...ok].sort((a,b)=>val(b,sortBy)-val(a,sortBy));
  const max=Math.max(1,...rows.map(m=>Math.abs(val(m,sortBy)||0)));
  const bar=v=>{const w=Math.abs(v||0)/max*50;return `<span class="tr-bar"><i class="${v<0?'neg':'pos'}" style="${v<0?`right:50%`:`left:50%`};width:${w.toFixed(1)}%"></i></span>`;};
  return `<div class="tr-league"><div class="tr-sorts" role="group" aria-label="Sortieren nach">${Object.entries(SORTS).filter(([k])=>cur()?.current||k==='realized').map(([k,[t]])=>`<button type="button" class="tr-sort${k===sortBy?' active':''}" data-tr-sort="${k}" aria-pressed="${k===sortBy}">${esc(t)}</button>`).join('')}</div>
   <ol class="tr-rank">${rows.map((m,i)=>{const v=val(m,sortBy);return `<li title="${esc(`${m.name}: ${full(v)}`)}"><span class="tr-place">${i+1}.</span>${face(m.img,m.name)}<span class="tr-mname">${esc(m.name)}</span>${bar(v)}<b class="tr-val ${cls(v)}">${money(v,true)}</b></li>`;}).join('')}</ol>
   ${ms.some(m=>m.error)?`<p class="error tiny">Das fehlt: Transfers von ${esc(ms.filter(m=>m.error).map(m=>m.name).join(', '))} (Kickbase hat nicht geantwortet).</p>`:''}</div>`;
 }
 // Größter Einzel-Gewinn und -Verlust der Halbserie (Kevin-Wunsch): nur verkaufte Spieler mit Kaufpreis, Gleichstand = alle.
 function records(ms){
  const all=ms.filter(m=>!m.error).flatMap(m=>m.trades.filter(t=>t.status==='sold'&&t.diff!=null).map(t=>({...t,mgr:m})));
  const card=(label,pick,c)=>{
   const v=all.length?pick(...all.map(t=>t.diff)):null,hits=v==null||(c==='tr-pos'?v<=0:v>=0)?[]:all.filter(t=>t.diff===v);
   return `<div class="tr-tile tr-record"><span>${label}</span>${hits.length?`<b class="${c}">${money(v,true)}</b>${hits.map(t=>`<div class="tr-record-who">${face(t.img,t.name)}<div><strong>${esc(t.name)}</strong><small class="tr-record-mgr">${face(t.mgr.img,t.mgr.name)}${esc(t.mgr.name)}</small><small>${money(t.buy?.price)} → ${money(t.sell?.price)}${t.sell?.at?' · '+esc(date(t.sell.at)):''}</small></div></div>`).join('')}`:'<b class="muted">–</b><small>noch keiner</small>'}</div>`;
  };
  return `<div class="tr-tiles tr-records">${card('Größter Gewinn der Saison',Math.max,'tr-pos')}${card('Größter Verlust der Saison',Math.min,'tr-neg')}</div>`;
 }
 // Transfer-Pech-Radar (Kevin-Wunsch): verkauft und gleich am nächsten Spieltag gepunktet. Daten von /api/transfer-pech,
 // nur die laufende Halbserie (Leistungsdaten der laufenden Bundesliga-Saison). Startet eingeklappt (feste Regel).
 function pechRadar(){
  if(!pech||!cur()?.current)return '';
  if(pech.error)return `<details class="acc-group tr-pech"><summary><span class="tr-mname">🎯 Transfer-Pech-Radar</span><span class="tr-pill error">fehlt</span></summary><div class="acc-sub"><p class="error">Das fehlt: ${esc(pech.error)}</p></div></details>`;
  const hits=(pech.items||[]).filter(x=>x.points>=pech.min);
  const before=h=>h<48?`${h} Std.`:`${Math.round(h/24)} Tage`;
  const byMgr=new Map();for(const x of hits){const m=byMgr.get(x.seller.id)||{...x.seller,n:0,pts:0};m.n++;m.pts+=x.points;byMgr.set(x.seller.id,m);}
  const mg=[...byMgr.values()].sort((a,b)=>b.n-a.n||b.pts-a.pts),kings=mg.filter(m=>m.n===mg[0]?.n);
  const top=hits.filter(x=>x.points===hits[0]?.points);
  const tiles=`<div class="tr-tiles tr-records">
   <div class="tr-tile tr-record"><span>Größtes Pech</span>${top.length?`<b class="tr-neg">${top[0].points} Punkte</b>${top.map(x=>`<div class="tr-record-who">${face(x.img,x.name)}<div><strong>${esc(x.name)}</strong><small class="tr-record-mgr">${face(x.seller.img,x.seller.name)}${esc(x.seller.name)}</small><small>verkauft ${esc(before(x.hoursBefore))} vor Spieltag ${x.day}</small></div></div>`).join('')}`:'<b class="muted">–</b><small>noch keiner</small>'}</div>
   <div class="tr-tile tr-record"><span>Pech-König</span>${kings.length?`<b class="tr-neg">${kings[0].n}× Pech</b>${kings.map(m=>`<div class="tr-record-who">${face(m.img,m.name)}<div><strong>${esc(m.name)}</strong><small>${m.pts} Punkte verschenkt</small></div></div>`).join('')}`:'<b class="muted">–</b><small>noch keiner</small>'}</div></div>`;
  const row=(x,i)=>`<li class="tr-pech-row"><span class="tr-place">${i+1}.</span>${face(x.img,x.name)}<div class="tr-pech-txt"><b>${esc(x.name)}</b>
   <small>${face(x.seller.img,x.seller.name)}${esc(x.seller.name)} → ${esc(x.buyer||'Markt')}${x.diff!=null?` · <span class="${cls(x.diff)}">${money(x.diff,true)}</span>`:''}</small><small>verkauft ${esc(date(x.soldAt))}, ${esc(before(x.hoursBefore))} vor Spieltag ${x.day}</small>
   ${x.buyerStarted?`<small class="tr-pech-buyer">🍀 ${esc(x.buyer)} hatte ihn gleich in der Startelf</small>`:''}</div><b class="tr-pech-pts">${x.points}</b></li>`;
  const notes=[pech.missing?`${pech.missing} Verkäufe ohne Punkte in den Leistungsdaten`:'',pech.failedPlayers?`Leistungsdaten von ${pech.failedPlayers} Spielern`:'',pech.failedManagers?.length?`Transfers von ${pech.failedManagers.join(', ')}`:''].filter(Boolean);
  return `<details class="acc-group tr-pech"><summary><span class="tr-mname">🎯 Transfer-Pech-Radar</span><span class="tr-pill ${hits.length?'tr-neg':''}">${hits.length} Pech-${hits.length===1?'Moment':'Momente'}</span></summary><div class="acc-sub">
   <p class="muted tiny">Verkauft und gleich am nächsten Spieltag mindestens ${pech.min} Punkte geholt. Die BumsKI zählt nur abgeschlossene Spieltage; wer den Spieler vor dem Anpfiff zurückgekauft hat, ist raus.</p>
   ${tiles}${hits.length?`<ol class="tr-pech-list">${hits.map(row).join('')}</ol>`:'<p class="muted tiny">Bisher hat niemand zu früh verkauft.</p>'}
   ${notes.length?`<p class="error tiny">Das fehlt: ${esc(notes.join('; '))}.</p>`:''}</div></details>`;
 }
 const side=(s,verb)=>s?`<span class="tr-price">${money(s.price)}</span><small>${s.at?esc(date(s.at))+' · ':''}${verb} ${esc(s.other||'Markt')}</small>`:'';
 function trade(t){
  let buy,sell,note='';
  if(t.status==='start'){buy=`<span class="tr-price muted">?</span><small title="Startkader oder älter als der Kickbase-Verlauf">Kauf nicht im Verlauf</small>`;note='Kaufpreis unbekannt';}
  else if(t.start){buy=t.buy?`<span class="tr-price">${money(t.buy.price)}</span><small title="Kauf nicht im Verlauf (Startkader oder älter), Preis aus dem Kader">laut Kickbase-Kader</small>`:`<span class="tr-price muted">?</span><small>Kauf nicht im Verlauf</small>`;}
  else buy=side(t.buy,'von');
  if(t.status==='sold'||t.status==='start')sell=side(t.sell,'an');
  else if(t.status==='held')sell=`<span class="tr-price">${money(t.mv)}</span><small>Marktwert heute</small>`;
  else if(!cur()?.current){sell=`<span class="tr-price muted">–</span><small>bei Saisonende noch im Kader</small>`;note='nicht verkauft';}
  else {sell=`<span class="tr-price muted">?</span><small title="Kein Verkauf im Kickbase-Verlauf und nicht mehr im Kader, z. B. weil der Spieler die Bundesliga verlassen hat">Spieler nicht mehr da</small>`;note='kein Verkaufspreis';}
  const d=t.diff;
  return `<li class="tr-trade ${t.status}"><div class="tr-player">${face(t.img,t.name)}<span><b>${esc(t.name)}</b>${t.days!=null?`<small>${t.status==='held'?'seit ':''}${t.days} ${t.days===1?'Tag':'Tage'}</small>`:''}</span></div>
   <div class="tr-side"><em>Kauf</em>${buy}</div><div class="tr-side"><em>${t.status==='held'?'Heute':'Verkauf'}</em>${sell}</div>
   <div class="tr-diff ${cls(d)}" title="${esc(d==null?note:full(d))}">${d==null?`<small class="muted">${esc(note||'–')}</small>`:`<b>${money(d,true)}</b>${t.status==='held'?'<small>seit Kauf</small>':''}`}</div></li>`;
 }
 function manager(m){
  if(m.error)return `<details class="acc-group tr-manager"><summary>${face(m.img,m.name)}<span class="tr-mname">${esc(m.name)}</span><span class="tr-pill error">fehlt</span></summary><div class="acc-sub"><p class="error">Das fehlt: Transfer-Verlauf (${esc(m.error)}).</p></div></details>`;
  const sold=m.trades.filter(t=>t.status==='sold'||t.status==='start'),held=m.trades.filter(t=>t.status==='held'),unk=m.trades.filter(t=>t.status==='unknown');
  const tile=(label,v,sub,c)=>`<div class="tr-tile"><span>${label}</span><b class="${c||''}">${v}</b>${sub?`<small>${sub}</small>`:''}</div>`;
  const deal=(t,w)=>t?`${esc(t.name)} ${money(t.diff,true)}`:'–';
  return `<details class="acc-group tr-manager"><summary>${face(m.img,m.name)}<span class="tr-mname">${esc(m.name)}</span><span class="tr-count">${m.buys} Käufe · ${m.sells} Verkäufe</span><span class="tr-pill ${cls(m.realized)}">${money(m.realized,true)}</span></summary><div class="acc-sub">
   <div class="tr-tiles">${tile('Ausgegeben',money(m.spent),`${m.buys} Käufe`)}${tile('Eingenommen',money(m.earned),`${m.sells} Verkäufe`)}
    ${tile('Gewinn/Verlust verkauft',money(m.realized,true),`${m.wins} mit Gewinn, ${m.losses} mit Verlust${m.startSold?`, ${m.startSold} ohne Kaufpreis`:''}`,cls(m.realized))}
    ${!cur()?.current?'':tile('Wertänderung aktueller Kader',money(m.unrealized,true),`Marktwert heute minus Kaufpreis · ${m.heldCount} Spieler, zusammen ${money(m.squadValue)}`,cls(m.unrealized))}
    ${tile('Bester Deal',deal(m.best),'','tr-pos')}${tile('Schlechtester Deal',deal(m.worst),'','tr-neg')}</div>
   ${m.squadMissing?'<p class="error tiny">Das fehlt: der heutige Kader, darum kein Marktwert für die Spieler im Kader.</p>':''}
   <h4 class="tr-h">Verkaufte Spieler <small class="muted">(${sold.length})</small></h4>${sold.length?`<ol class="tr-trades">${sold.map(trade).join('')}</ol>`:'<p class="muted tiny">Noch keine Verkäufe.</p>'}
   ${!cur()?.current?'':`<h4 class="tr-h">Noch im Kader <small class="muted">(${held.length})</small></h4>${held.length?`<ol class="tr-trades">${held.map(trade).join('')}</ol>`:'<p class="muted tiny">Kein Spieler im Kader.</p>'}`}
   ${unk.length?`<h4 class="tr-h">${cur()?.current?'Ohne Verkauf':'Bei Saisonende im Kader'} <small class="muted">(${unk.length})</small></h4><ol class="tr-trades">${unk.map(trade).join('')}</ol>`:''}
  </div></details>`;
 }
 function render(){
  const root=$('#transfersContent');if(!root||!data)return;
  root.className='';
  $('#transfersMeta').textContent='Stand '+new Date(data.updatedAt).toLocaleString('de-DE',{day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'});
  const all=seasons(),c=cur();if(!c){root.textContent='Noch keine Transfers.';return;}
  const pick=all.length>1?`<div class="controls" style="margin-bottom:12px"><label class="acc-label">Halbserie <select id="trSeason">${all.map(x=>`<option value="${esc(x.key)}"${x===c?' selected':''}>${esc(/^\d/.test(x.key)?'Saison '+x.key:x.key)}${esc(ligaSaison(x.key))}${x.current?' · läuft':''}</option>`).join('')}</select></label></div>`:'';
  root.innerHTML=`${pick}${records(c.managers)}<div id="trPech">${pechRadar()}</div><details class="acc-group tr-pech"><summary><span class="tr-mname">Gewinn/Verlust im Vergleich</span></summary><div class="acc-sub">${league(c.managers)}</div></details><details class="acc-group tr-pech"><summary><span class="tr-mname">Transfers je Manager</span><span class="tr-pill">${c.managers.length}</span></summary><div class="acc-sub"><div class="tr-managers">${c.managers.map(manager).join('')}</div></div></details>`;
 }
 async function load(){
  if(loading)return;loading=true;
  const pp=get('/api/transfer-pech').catch(e=>({error:e.message}));
  try{data=await get('/api/transfers');render();pech=await pp;const el=$('#trPech');if(el)el.innerHTML=pechRadar();}
  catch(e){const r=$('#transfersContent');r.className='error';r.textContent='Transfers nicht abrufbar: '+e.message;$('#transfersMeta').textContent='–';}
  finally{loading=false;}
 }
 document.addEventListener('click',e=>{
  const s=e.target.closest?.('[data-tr-sort]');
  if(s){sortBy=s.dataset.trSort;const old=$('.tr-league');if(old&&data)old.outerHTML=league(cur().managers);return;}
  if(e.target.closest?.('[data-kbl-nav="transfers"]'))load();
 });
 document.addEventListener('change',e=>{if(e.target.id==='trSeason'){season=e.target.value;render();}});
 window.addEventListener('hashchange',()=>{if(location.hash==='#transfers')load();});
 if(location.hash==='#transfers')load();
})();
