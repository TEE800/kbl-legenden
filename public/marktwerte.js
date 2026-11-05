// Ansicht "Marktwerte" (Kevin-Wunsch 4.11.): Marktwerte aller Bundesliga-Spieler und ihre Entwicklung.
// Daten: /api/marktwerte (je Spieler Wert, Änderung 1/7/30 Tage, Höchst-/Tiefstwert, Besitzer; je Manager Kaderwert heute),
// /api/marktwerte/verlauf (alle Verläufe, erst beim Aufklappen des Spieler-Verlaufs geladen) und die Ranglisten je Spieltag
// (Feld tv = Teamwert laut Kickbase) für die Kaderwerte. Alle Bereiche starten eingeklappt (feste Regel).
(()=>{
 const $=s=>document.querySelector(s);
 const esc=v=>String(v??'').replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
 const money=(n,sign)=>{
  if(n==null||!Number.isFinite(n))return '–';
  const a=Math.abs(n),s=sign?(n>0?'+':n<0?'−':'±'):n<0?'−':'';
  const t=a>=1e6?new Intl.NumberFormat('de-DE',{maximumFractionDigits:a>=1e8?0:a>=1e7?1:2}).format(a/1e6)+' Mio.':a>=1e3?new Intl.NumberFormat('de-DE',{maximumFractionDigits:0}).format(a/1e3)+' Tsd.':new Intl.NumberFormat('de-DE').format(a)+' €';
  return s+t;
 };
 const cls=n=>n==null?'':n>0?'tr-pos':n<0?'tr-neg':'';
 const pct=(d,v)=>d==null||!v||v===d?'':` (${d>0?'+':d<0?'−':'±'}${new Intl.NumberFormat('de-DE',{maximumFractionDigits:1}).format(Math.abs(d)/(v-d)*100)} %)`;
 const ddmm=ymd=>ymd?new Date(ymd+'T12:00:00Z').toLocaleDateString('de-DE',{day:'2-digit',month:'2-digit'}):'';
 const img=p=>!p?'':/^https?:\/\//.test(p)?p:'https://kickbase.b-cdn.net/'+String(p).replace(/^\//,'');
 const face=(src,name)=>src?`<img class="tr-face" src="${esc(img(src))}" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.replaceWith(Object.assign(document.createElement('span'),{className:'tr-face tr-noimg',textContent:${esc(JSON.stringify((name||'?').trim()[0]||'?'))}}))">`:`<span class="tr-face tr-noimg">${esc((name||'?').trim()[0]||'?')}</span>`;
 const mgr=(m,cls='')=>!m?'':`<span class="mw-mn ${cls}">${window.kblMgrName?window.kblMgrName(m.name,'',m.id):esc(m.name)}</span>`;
 const norm=s=>String(s||'').normalize('NFD').replace(/[̀-ͯ]/g,'').toLowerCase();
 const POS={1:'TW',2:'ABW',3:'MF',4:'ST'};
 let data=null,loading=false,verlauf=null,verlaufP=null,tv=null,tvP=null;
 let period='d1',scope='all',sel=null,selM=null,range=92,kPeriod='d1',kSort='value',tPeriod='d1';
 async function get(url){
  const r=await fetch(url,{cache:'no-store'});const d=await r.json().catch(()=>({}));
  if(!r.ok)throw Error(d.error||`HTTP ${r.status}`);return d;
 }
 const ownerOf=p=>p.owner?data.managers.find(m=>m.id===p.owner):null;
 const sub=p=>{const o=ownerOf(p);return `${esc(p.t||'ohne Verein')}${POS[p.pos]?' · '+POS[p.pos]:''}</small>${o?`<small class="mw-owner">bei ${mgr(o,'mw-mgr')}</small>`:''}<small hidden>`;};
 const PER={d1:['1 Tag','letzte Anpassung'],d7:['7 Tage','letzte 7 Tage'],d30:['30 Tage','letzte 30 Tage']};

 // Kaderwert-Änderung über n Tage aus dem Kaderwert-Verlauf (Kader, wie er an dem Tag war, mit Transfers; Kevin 5.11.).
 const kaderChg=(m,n)=>{const v=m.hist?.v;if(!v||v.length<=n)return null;const a=v[v.length-1],b=v[v.length-1-n];return a==null||b==null?null:(a-b)*1e4;};
 const DAYS={d1:1,d7:7,d30:30};
 // Kacheln: größter Gewinner/Verlierer im gewählten Zeitraum (Spieler und Kader), Gleichstand = alle. Umschaltbar 1/7/30 Tage (Kevin 5.11.).
 function tiles(){
  const P=tPeriod,pv=p=>p[P],mv=m=>kaderChg(m,DAYS[P]);
  const ps=data.players.filter(p=>pv(p)!=null),ms=data.managers.filter(m=>!m.error&&mv(m)!=null);
  const best=(list,val,dir)=>{if(!list.length)return [];const v=dir>0?Math.max(...list.map(val)):Math.min(...list.map(val));return dir>0?(v>0?list.filter(x=>val(x)===v):[]):(v<0?list.filter(x=>val(x)===v):[]);};
  const pTile=(label,hits)=>`<div class="tr-tile tr-record"><span>${label}</span>${hits.length?`<b class="${cls(pv(hits[0]))}">${money(pv(hits[0]),true)}</b>${hits.map(p=>`<button type="button" class="mw-who" data-mw-player="${esc(p.id)}">${face(p.img,p.n)}<div><strong>${esc(p.n)}</strong><small>${sub(p)}</small><small>jetzt ${money(p.mv)}${esc(pct(pv(p),p.mv))}</small></div></button>`).join('')}`:'<b class="muted">–</b>'}</div>`;
  const mTile=(label,hits)=>`<div class="tr-tile tr-record"><span>${label}</span>${hits.length?`<b class="${cls(mv(hits[0]))}">${money(mv(hits[0]),true)}</b>${hits.map(m=>`<div class="mw-who">${mgr(m)}<small>Kader jetzt ${money(m.value)}</small></div>`).join('')}`:'<b class="muted">–</b><small>keiner</small>'}</div>`;
  return `${chips('tperiod',Object.entries(PER).map(([k,v])=>[k,v[0]]),P)}<div class="tr-tiles mw-tiles">${pTile('Spieler-Gewinner',best(ps,pv,1))}${pTile('Spieler-Verlierer',best(ps,pv,-1))}${mTile('Kader-Gewinner',best(ms,mv,1))}${mTile('Kader-Verlierer',best(ms,mv,-1))}</div>`;
 }
 const chips=(name,opts,cur)=>`<div class="tr-sorts" role="group">${opts.map(([k,t])=>`<button type="button" class="tr-sort${k===cur?' active':''}" data-mw-${name}="${esc(k)}" aria-pressed="${k===cur}">${esc(t)}</button>`).join('')}</div>`;
 const row=(p,i)=>`<li><button type="button" class="mw-row" data-mw-player="${esc(p.id)}"><span class="tr-place">${i+1}.</span>${face(p.img,p.n)}<span class="mw-name"><b>${esc(p.n)}</b><small>${sub(p)}</small></span><span class="mw-val"><b class="${cls(p[period])}">${money(p[period],true)}</b><small>${money(p.mv)}</small></span></button></li>`;
 function movers(){
  const list=data.players.filter(p=>p[period]!=null&&(scope==='all'||p.owner));
  const up=[...list].filter(p=>p[period]>0).sort((a,b)=>b[period]-a[period]).slice(0,10),down=[...list].filter(p=>p[period]<0).sort((a,b)=>a[period]-b[period]).slice(0,10);
  return `${chips('period',Object.entries(PER).map(([k,v])=>[k,v[0]]),period)}${chips('scope',[['all','Alle Spieler'],['liga','Nur Legenden-Kader']],scope)}
   <div class="mw-cols"><div><h4 class="tr-h">📈 Gewinner · ${esc(PER[period][1])}</h4>${up.length?`<ol class="mw-list">${up.map(row).join('')}</ol>`:'<p class="muted tiny">Keiner gestiegen.</p>'}</div>
   <div><h4 class="tr-h">📉 Verlierer · ${esc(PER[period][1])}</h4>${down.length?`<ol class="mw-list">${down.map(row).join('')}</ol>`:'<p class="muted tiny">Keiner gefallen.</p>'}</div></div>`;
 }
 // Spieler-Verlauf: Suche plus Diagramm (Linie mit Fläche, Höchst-/Tiefstwert, Antippen zeigt den Wert des Tages).
 // Punkte eines Verlaufs: Spieler (Schlüssel = Spieler-ID, aus /api/marktwerte/verlauf, Zeitraum 3 Monate/1 Jahr)
 // oder Manager (Schlüssel m:<ID>, Kaderwert je Tag der Halbserie aus /api/marktwerte).
 function ptsFor(key){
  if(String(key).startsWith('m:')){const m=data.managers.find(x=>'m:'+x.id===key),h=m?.hist;if(!h)return [];
   return h.v.map((v,i)=>v==null?null:{t:(h.s+i)*864e5,v:v*1e4}).filter(Boolean);}
  const raw=verlauf?.players?.[key];if(!raw)return [];
  const start=Date.parse(verlauf.start+'T00:00:00Z');
  const pts=raw.slice(1).map((v,i)=>v==null?null:{t:start+(raw[0]+i)*864e5,v:v*verlauf.unit}).filter(Boolean);
  const cut=pts.length?pts[pts.length-1].t-range*864e5:0;return pts.filter(x=>x.t>=cut);
 }
 const dd=t=>new Date(t).toLocaleDateString('de-DE',{day:'2-digit',month:'2-digit',timeZone:'UTC'});
 // Diagramm wie beim Spieler: Kopf (Bild, Name, Wert, Änderung), Linie mit Fläche, Hoch/Tief, Antippen zeigt den Tageswert.
 function graph(key,pts,head,name,box,extra=''){
  if(pts.length<2)return `${head}<p class="muted tiny">Noch zu wenige Werte für ein Diagramm.</p>`;
  const W=Math.max(280,Math.round(($(box)?.clientWidth||600)-14)),H=W<500?180:220,L=8,R=8,T=16,B=24,vs=pts.map(x=>x.v),hi=Math.max(...vs),lo=Math.min(...vs),pad=(hi-lo)*.08||hi*.05||1;
  const y0=lo-pad,y1=hi+pad,t0=pts[0].t,t1=pts[pts.length-1].t;
  const X=t=>L+(t-t0)/(t1-t0||1)*(W-L-R),Y=v=>T+(1-(v-y0)/(y1-y0))*(H-T-B);
  const line=pts.map((x,i)=>`${i?'L':'M'}${X(x.t).toFixed(1)},${Y(x.v).toFixed(1)}`).join('');
  const first=pts[0].v,last=pts[pts.length-1].v,ch=last-first,iHi=vs.indexOf(hi),iLo=vs.indexOf(lo);
  const mark=(i,txt,up)=>{const x=X(pts[i].t),y=Y(pts[i].v),anchor=x<70?'start':x>W-70?'end':'middle';return `<circle cx="${x}" cy="${y}" r="3.5" class="mw-dot"/><text x="${x}" y="${up?y-7:y+15}" text-anchor="${anchor}" class="mw-lbl">${esc(txt)}</text>`;};
  return `<div class="mw-chart-head">${head}<div class="mw-chart-now"><b>${money(last)}</b><small class="${cls(ch)}">${money(ch,true)} seit ${esc(dd(t0))}${esc(pct(ch,last))}</small></div></div>${extra}
   <div class="mw-chart" data-mw-chart="${esc(key)}" data-w="${W}"><svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="${esc(`${name}: ${money(first)} am ${dd(t0)}, ${money(last)} am ${dd(t1)}`)}">
    <path d="${line}L${X(t1).toFixed(1)},${H-B}L${X(t0).toFixed(1)},${H-B}Z" class="mw-area"/><path d="${line}" class="mw-line ${ch<0?'neg':''}"/>
    ${mark(iHi,'Hoch '+money(hi),true)}${iLo!==iHi?mark(iLo,'Tief '+money(lo),false):''}
    <text x="${L}" y="${H-6}" class="mw-axis">${esc(dd(t0))}</text><text x="${W-R}" y="${H-6}" text-anchor="end" class="mw-axis">${esc(dd(t1))}</text>
    <line class="mw-cursor" x1="0" x2="0" y1="${T}" y2="${H-B}" visibility="hidden"/></svg><div class="mw-tip" hidden></div></div>`;
 }
 function chartHtml(){
  if(!sel)return '<p class="muted tiny">Spieler suchen oder oben in einer Liste antippen.</p>';
  const p=data.players.find(x=>x.id===sel);if(!p)return '';
  if(!verlauf)return '<p class="muted tiny">Verlauf wird geladen …</p>';
  if(verlauf.error)return `<p class="error tiny">Das fehlt: Verlauf (${esc(verlauf.error)}).</p>`;
  if(!verlauf.players[sel])return '<p class="error tiny">Das fehlt: Für diesen Spieler hat Kickbase keinen Verlauf geliefert.</p>';
  return graph(sel,ptsFor(sel),`${face(p.img,p.n)}<div><strong>${esc(p.n)}</strong><small>${sub(p)}</small></div>`,'Marktwert '+p.n,'#mwChart',chips('range',[['92','3 Monate'],['365','1 Jahr']],String(range)));
 }
 // Kaderwert-Verlauf eines Managers (Antippen in „Kaderwerte“).
 function mgrChartHtml(){
  const m=selM&&data.managers.find(x=>x.id===selM);if(!m)return '';
  const head=`<span class="mw-mgr-big">${mgr(m)}</span>`;
  if(!m.hist)return `<div class="mw-chart-head">${head}</div><p class="error tiny">Das fehlt: Kaderwert-Verlauf${m.histError?` (${esc(m.histError)})`:''}.</p>`;
  return graph('m:'+m.id,ptsFor('m:'+m.id),head,'Kaderwert '+m.name,'#mwKChart')+`<p class="muted tiny">Kaderwert je Tag seit Beginn der Halbserie: Kader laut Transfer-Verlauf, Summe der Marktwerte des Tages, ohne Kontostand.${m.hist.gaps?` An ${m.hist.gaps} Tagen fehlt der Wert eines Spielers, dort bleibt die Linie leer.`:''}</p>`;
 }
 function verlaufBox(){
  return `<div class="mvp-pick mw-search"><input type="search" id="mwSearch" placeholder="Spieler suchen …" autocomplete="off" aria-label="Spieler suchen"><div class="mvp-suggest" id="mwSuggest" hidden></div></div><div id="mwChart">${chartHtml()}</div>`;
 }
 // Kaderwerte: heute (Summe der Marktwerte im Kader) und Teamwert laut Kickbase je abgeschlossenem Spieltag (Rangliste, Feld tv).
 function spark(vals){
  const ok=vals.filter(v=>v!=null);if(ok.length<2)return '';
  const W=120,H=30,hi=Math.max(...ok),lo=Math.min(...ok),X=i=>2+i/(vals.length-1)*(W-4),Y=v=>3+(1-(v-lo)/(hi-lo||1))*(H-6);
  let dpath='',pen=false;vals.forEach((v,i)=>{if(v==null){pen=false;return;}dpath+=`${pen?'L':'M'}${X(i).toFixed(1)},${Y(v).toFixed(1)}`;pen=true;});
  return `<svg class="mw-spark" viewBox="0 0 ${W} ${H}" aria-hidden="true"><path d="${dpath}" class="mw-line ${ok[ok.length-1]<ok[0]?'neg':''}"/></svg>`;
 }
 function kader(){
  // Änderung je Zeitraum aus dem Kaderwert-Verlauf (Kader, wie er an dem Tag war, also mit Transfers; Kevin 5.11.).
  const cv=m=>kaderChg(m,DAYS[kPeriod]);
  const ms=data.managers.filter(m=>!m.error).sort((a,b)=>kSort==='chg'?(cv(b)??-Infinity)-(cv(a)??-Infinity):b.value-a.value),days=tv?.days||[];
  const lbl=kPeriod==='d1'?'heute':PER[kPeriod][0];
  const series=m=>days.map(d=>d.tv[m.id]??null);
  const head=days.length?`<p class="muted tiny">Verlauf: Teamwert laut Kickbase je Spieltag (ST ${days[0].day} bis ${days[days.length-1].day}).</p>`:tv?.error?`<p class="error tiny">Das fehlt: Teamwerte je Spieltag (${esc(tv.error)}).</p>`:tv?'':'<p class="muted tiny">Teamwerte je Spieltag werden geladen …</p>';
  return `<div id="mwKChart">${mgrChartHtml()}</div>${chips('kperiod',Object.entries(PER).map(([k,v])=>[k,v[0]]),kPeriod)}${chips('ksort',[['value','Nach Kaderwert'],['chg','Nach Änderung']],kSort)}${head}<ol class="mw-kader">${ms.map((m,i)=>{const s=series(m),ok=s.filter(v=>v!=null);return `<li class="${m.id===selM?'sel':''}" data-mw-mgr="${esc(m.id)}" role="button" tabindex="0" title="Kaderwert-Verlauf ansehen"><span class="tr-place">${i+1}.</span><span class="mw-name">${mgr(m)}<small>${m.count} Spieler${ok.length>1?` · ST ${days[s.findIndex(v=>v!=null)].day}: ${money(ok[0])}`:''}</small></span>${spark(s)}<span class="mw-val"><b>${money(m.value)}</b><small class="${cls(cv(m))}">${money(cv(m),true)} ${lbl}</small></span></li>`;}).join('')}</ol>
   ${data.managers.some(m=>m.error)?`<p class="error tiny">Das fehlt: Kader von ${esc(data.managers.filter(m=>m.error).map(m=>m.name).join(', '))}.</p>`:''}
   <p class="muted tiny">Kaderwert = Summe der heutigen Marktwerte im Kader, ohne Kontostand. Änderung (1/7/30 Tage) = Kaderwert heute minus Kaderwert vor 1/7/30 Tagen, jeweils mit dem Kader, der an dem Tag im Kader stand (Käufe und Verkäufe zählen mit). Fehlt ein Tag, steht –.</p>`;
 }

 // „📊 Kaderwerte im Vergleich“ (Kevin-Wunsch 5.11.): Liniendiagramm aller Manager wie die Punkteentwicklung der Übersicht.
 // Werte aus dem Kaderwert-Verlauf (hist, Kader wie er an dem Tag war). Graue Linien = übrige Manager, antippen/anhaken hebt hervor.
 const VCOL=['#f1c75c','#59b8e8','#ed8b85','#7fd3a6','#bb9af7','#e8a665','#75d5d1','#ed94c6','#a6c76a','#d0b8ff','#ffb4a0','#86b2ff','#c1db77','#d1a77b','#e0d9a0','#9ebdc8'];
 let vMode='value',vRange=0;const vSel=new Set();let vInit=false;
 function vglData(){
  const ms=data.managers.filter(m=>!m.error&&m.hist?.v?.length);if(!ms.length)return null;
  const end=Math.max(...ms.map(m=>m.hist.s+m.hist.v.length-1)),start0=Math.min(...ms.map(m=>m.hist.s));
  const start=vRange?Math.max(start0,end-vRange+1):start0,n=end-start+1;
  const lines=ms.map(m=>({m,values:Array.from({length:n},(_,i)=>{const v=m.hist.v[start+i-m.hist.s];return v==null?null:v*1e4;})}));
  if(vMode!=='value')for(let i=0;i<n;i++){
   const day=lines.filter(l=>l.values[i]!=null).map(l=>l.values[i]);
   const top=Math.max(...day),sorted=[...day].sort((a,b)=>b-a);
   lines.forEach(l=>{const v=l.values[i];(l.out=l.out||[])[i]=v==null?null:vMode==='gap'?v-top:sorted.indexOf(v)+1;});
  }
  lines.forEach(l=>{if(vMode!=='value')l.values=l.out;});
  return {lines,start,n};
 }
 function vglHtml(){
  const d=vglData();if(!d)return '<p class="error tiny">Das fehlt: Kaderwert-Verlauf der Manager.</p>';
  const {lines,start,n}=d,last=l=>[...l.values].reverse().find(v=>v!=null);
  lines.sort((a,b)=>vMode==='rank'?(last(a)??99)-(last(b)??99):(last(b)??-Infinity)-(last(a)??-Infinity));
  if(!vInit){vInit=true;lines.slice(0,3).forEach(l=>vSel.add(l.m.id));const own=lines.find(l=>l.m.name==='T800');if(own)vSel.add(own.m.id);}
  const colorOf=new Map([...vSel].map((id,i)=>[id,VCOL[i%VCOL.length]]));
  const ddmm2=dt=>new Date(dt*864e5).toLocaleDateString('de-DE',{day:'2-digit',month:'2-digit',timeZone:'UTC'});
  const isRank=vMode==='rank',all=lines.flatMap(l=>l.values).filter(v=>v!=null);
  const narrow=($('#mwVgl')?.clientWidth||1000)<640;
  const W=narrow?480:1000,H=400,left=narrow?64:78,right=narrow?100:150,top=24,bottom=48,pw=W-left-right,ph=H-top-bottom,fs=narrow?16:12;
  let lo=Math.min(...all),hi=Math.max(...all);if(vMode==='gap')hi=0;
  const rough=Math.max(1,(hi-lo)/5),mag=10**Math.floor(Math.log10(rough)),tick=[1,2,2.5,5,10].map(f=>f*mag).find(v=>v>=rough);
  lo=Math.floor(lo/tick)*tick;hi=Math.ceil(hi/tick)*tick;if(hi===lo)hi=lo+tick;
  const rc=isRank?Math.max(...all):0;if(isRank){lo=.5;hi=rc+.5;}
  const x=i=>left+(n===1?pw/2:i*pw/(n-1)),y=v=>isRank?top+(v-lo)/(hi-lo)*ph:top+(hi-v)/(hi-lo)*ph;
  const mio=v=>money(v).replace(' Mio.','');
  const unit=v=>isRank?`Platz ${v}`:vMode==='gap'?(v===0?'höchster Kaderwert':`${money(-v)} hinter Platz 1`):money(v);
  let svg=`<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Kaderwerte im Vergleich" xmlns="http://www.w3.org/2000/svg"><rect width="${W}" height="${H}" fill="#12212b" rx="10"/>`;
  if(isRank){const ev=rc>12?2:1;for(let r=1;r<=rc;r++){if((r-1)%ev&&r!==rc)continue;svg+=`<line x1="${left}" y1="${y(r)}" x2="${W-right}" y2="${y(r)}" stroke="#2c3c47"/><text x="${left-10}" y="${y(r)+4}" fill="${r===1?'#f1c75c':'#9fb3c0'}" text-anchor="end" font-size="${fs}">${r}.</text>`;}}
  else for(let v=lo;v<=hi+tick/1000;v+=tick)svg+=`<line x1="${left}" y1="${y(v)}" x2="${W-right}" y2="${y(v)}" stroke="${vMode==='gap'&&Math.abs(v)<1e-9?'#6b5a2e':'#2c3c47'}"/><text x="${left-10}" y="${y(v)+4}" fill="#9fb3c0" text-anchor="end" font-size="${fs}">${Math.abs(v)<1e-9?'0':(v<0?'−':'')+esc(mio(Math.abs(v)))}</text>`;
  const step=Math.max(1,Math.ceil(n/(narrow?5:10)));for(let i=0;i<n;i++)if(i%step===0||i===n-1)svg+=`<text x="${x(i)}" y="${H-18}" fill="#9fb3c0" text-anchor="middle" font-size="${fs}">${ddmm2(start+i)}</text>`;
  const segs=l=>{const out=[];let seg=[];l.values.forEach((v,i)=>{if(v==null){if(seg.length)out.push(seg);seg=[];}else seg.push(`${x(i).toFixed(1)},${y(v).toFixed(1)}`);});if(seg.length)out.push(seg);return out;};
  for(const l of [...lines.filter(l=>!colorOf.has(l.m.id)),...lines.filter(l=>colorOf.has(l.m.id))]){
   const c=colorOf.get(l.m.id),lv=last(l);
   svg+=`<g data-mw-vline="${esc(l.m.id)}" style="cursor:pointer"><title>${esc(l.m.name)}${lv!=null?` · ${ddmm2(start+n-1)}: ${esc(unit(lv))}`:''}</title>`;
   for(const p of segs(l)){if(p.length<2)continue;svg+=`<polyline points="${p.join(' ')}" fill="none" stroke="transparent" stroke-width="14" pointer-events="stroke"/><polyline points="${p.join(' ')}" fill="none" stroke="${c||'#5d6f7b'}" stroke-opacity="${c?1:.45}" stroke-width="${c?3:1.5}" stroke-linecap="round" stroke-linejoin="round"/>`;}
   svg+='</g>';
  }
  const labels=lines.filter(l=>colorOf.has(l.m.id)).map(l=>{const i=l.values.map((v,k)=>v!=null?k:-1).filter(k=>k>=0).at(-1);return i==null?null:{name:l.m.name,color:colorOf.get(l.m.id),ty:y(l.values[i]),lx:x(i)};}).filter(Boolean).sort((a,b)=>a.ty-b.ty);
  const gap=fs+3;labels.forEach((l,k)=>{l.y=Math.max(l.ty,k?labels[k-1].y+gap:top);});const of=labels.length?labels.at(-1).y-(H-bottom):0;if(of>0)labels.forEach(l=>l.y-=of);
  for(const l of labels){const mx=narrow?10:16,sh=l.name.length>mx?l.name.slice(0,mx-1)+'…':l.name;svg+=`<line x1="${l.lx+6}" y1="${l.ty}" x2="${W-right+8}" y2="${l.y}" stroke="${l.color}" stroke-opacity=".5"/><text x="${W-right+12}" y="${l.y+4}" fill="${l.color}" font-size="${fs}" font-weight="700">${esc(sh)}</text>`;}
  svg+='</svg>';
  const how={value:'Kaderwert je Tag in Mio. €',gap:'Abstand zum höchsten Kaderwert des Tages in Mio. € (0 = Platz 1)',rank:'Platz nach Kaderwert je Tag (Platz 1 oben)'}[vMode];
  return `${chips('vmode',[['value','Kaderwert'],['gap','Abstand zu Platz 1'],['rank','Platz']],vMode)}${chips('vrange',[['30','30 Tage'],['0','Ganze Halbserie']],String(vRange))}
   <div class="kbl-chart-buttons"><button type="button" class="ghost" data-mw-vpick="top">Top 5</button><button type="button" class="ghost" data-mw-vpick="all">Alle</button><button type="button" class="ghost" data-mw-vpick="none">Keine</button></div>
   <div class="kbl-chart-managers">${lines.map(l=>{const c=colorOf.get(l.m.id);return `<label style="border-color:${c||'#394c57'}"><input type="checkbox" data-mw-vchk="${esc(l.m.id)}" ${c?'checked':''}><span style="color:${c||'#5d6f7b'}">●</span>${esc(l.m.name)}</label>`;}).join('')}</div>
   <div class="kbl-chart-area">${svg}</div><p class="muted tiny" style="margin-top:12px">${how}, mit dem Kader, der an dem Tag im Kader stand (Käufe und Verkäufe zählen mit), ohne Kontostand. Graue Linien sind die übrigen Manager: antippen oder oben anhaken, um sie hervorzuheben. Fehlt ein Wert, hat die Linie dort eine Lücke.</p>`;
 }
 const vglRedraw=()=>{const b=$('#mwVgl');if(b)b.innerHTML=vglHtml();};
 function render(){
  const root=$('#mwContent');if(!root||!data)return;
  root.className='';
  $('#mwMeta').textContent=data.date?`Stand ${ddmm(data.date)}`:'–';
  if(!data.players.length){root.innerHTML='<p class="error">Das fehlt: Die BumsKI hat noch keine Marktwerte von Kickbase bekommen.</p>';return;}
  root.innerHTML=`<div id="mwTiles">${tiles()}</div>
   <details class="acc-group tr-pech" data-mw-sec="movers"><summary><span class="tr-mname">📈 Gewinner & Verlierer</span><span class="tr-pill">${data.players.length} Spieler</span></summary><div class="acc-sub" id="mwMovers">${movers()}</div></details>
   <details class="acc-group tr-pech" id="mwVerlauf" data-mw-sec="verlauf"><summary><span class="tr-mname">🔍 Spieler-Verlauf</span></summary><div class="acc-sub">${verlaufBox()}</div></details>
   <details class="acc-group tr-pech" data-mw-sec="kader"><summary><span class="tr-mname">💰 Kaderwerte</span><span class="tr-pill">${data.managers.length} Manager</span></summary><div class="acc-sub" id="mwKader">${kader()}</div></details>
   <details class="acc-group tr-pech" data-mw-sec="vgl"><summary><span class="tr-mname">📊 Kaderwerte im Vergleich</span><span class="tr-pill">Diagramm</span></summary><div class="acc-sub" id="mwVgl"></div></details>
   ${data.run&&(data.run.failed||data.run.empty)?`<p class="muted tiny">Beim letzten Abruf fehlten ${data.run.failed+data.run.empty} von ${data.run.players} Spielern.</p>`:''}`;
 }
 const redraw=()=>{const c=$('#mwChart');if(c)c.innerHTML=chartHtml();};
 function loadVerlauf(){if(!verlaufP)verlaufP=get('/api/marktwerte/verlauf').then(v=>{verlauf=v;}).catch(e=>{verlauf={error:e.message};verlaufP=null;}).then(redraw);return verlaufP;}
 function loadTv(){
  if(tvP)return tvP;
  tvP=(async()=>{try{
   const st=await get('/api/matchday-status'),last=Number(st.lastFinishedDay)||0,days=[];
   for(let d=1;d<=last;d++){try{const r=await get(`/api/ranking/6422780?dayNumber=${d}`);const m={};for(const u of r.us||[])if(Number.isFinite(Number(u.tv)))m[String(u.i)]=Number(u.tv);if(Object.keys(m).length)days.push({day:d,tv:m});}catch{}}
   tv={days};}catch(e){tv={error:e.message};tvP=null;}
   const k=$('#mwKader');if(k)k.innerHTML=kader();})();
  return tvP;
 }
 function pick(id){
  sel=id;const det=$('#mwVerlauf');if(!det)return;
  det.open=true;redraw();loadVerlauf();
  const s=$('#mwSuggest');if(s)s.hidden=true;
  det.scrollIntoView({behavior:'smooth',block:'start'});
 }
 async function load(){
  if(loading)return;loading=true;
  try{data=await get('/api/marktwerte');render();}
  catch(e){const r=$('#mwContent');r.className='error';r.textContent='Marktwerte nicht abrufbar: '+e.message;$('#mwMeta').textContent='–';}
  finally{loading=false;}
 }
 document.addEventListener('click',e=>{
  const t=e.target.closest?.('[data-mw-vmode],[data-mw-vrange],[data-mw-vpick],[data-mw-vline],[data-mw-tperiod],[data-mw-kperiod],[data-mw-ksort],[data-mw-period],[data-mw-scope],[data-mw-range],[data-mw-player]');
  if(t&&!e.target.closest('a')){
   if(t.dataset.mwVmode){vMode=t.dataset.mwVmode;vglRedraw();return;}
   if(t.dataset.mwVrange!=null){vRange=Number(t.dataset.mwVrange);vglRedraw();return;}
   if(t.dataset.mwVpick){const ls=vglData()?.lines||[],lv=l=>[...l.values].reverse().find(v=>v!=null);vSel.clear();if(t.dataset.mwVpick==='all')ls.forEach(l=>vSel.add(l.m.id));if(t.dataset.mwVpick==='top')ls.sort((a,b)=>vMode==='rank'?(lv(a)??99)-(lv(b)??99):(lv(b)??-Infinity)-(lv(a)??-Infinity)).slice(0,5).forEach(l=>vSel.add(l.m.id));vglRedraw();return;}
   if(t.dataset.mwVline){const id=t.dataset.mwVline;if(vSel.has(id))vSel.delete(id);else vSel.add(id);vglRedraw();return;}
   if(t.dataset.mwTperiod){tPeriod=t.dataset.mwTperiod;const x=$('#mwTiles');if(x)x.innerHTML=tiles();return;}
   if(t.dataset.mwKperiod||t.dataset.mwKsort){if(t.dataset.mwKperiod)kPeriod=t.dataset.mwKperiod;else kSort=t.dataset.mwKsort;const k=$('#mwKader');if(k)k.innerHTML=kader();return;}
   if(t.dataset.mwPeriod){period=t.dataset.mwPeriod;$('#mwMovers').innerHTML=movers();return;}
   if(t.dataset.mwScope){scope=t.dataset.mwScope;$('#mwMovers').innerHTML=movers();return;}
   if(t.dataset.mwRange){range=Number(t.dataset.mwRange);redraw();return;}
   if(t.dataset.mwPlayer){pick(t.dataset.mwPlayer);return;}
  }
  const mr=e.target.closest?.('[data-mw-mgr]');
  if(mr&&data){selM=selM===mr.dataset.mwMgr?null:mr.dataset.mwMgr;const k=$('#mwKader');if(k)k.innerHTML=kader();if(selM)$('#mwKChart')?.scrollIntoView({behavior:'smooth',block:'start'});return;}
  if(!e.target.closest?.('.mw-search')){const s=$('#mwSuggest');if(s)s.hidden=true;}
  if(e.target.closest?.('[data-kbl-nav="marktwerte"]'))load();
 });
 document.addEventListener('change',e=>{const id=e.target.dataset?.mwVchk;if(id==null)return;if(e.target.checked)vSel.add(id);else vSel.delete(id);vglRedraw();});
 window.addEventListener('resize',()=>{clearTimeout(window.__mwVgl);window.__mwVgl=setTimeout(()=>{if($('[data-mw-sec=vgl]')?.open)vglRedraw();},200);});
 document.addEventListener('toggle',e=>{
  const s=e.target.dataset?.mwSec;if(!s||!e.target.open)return;
  if(s==='verlauf')loadVerlauf();if(s==='kader')loadTv();if(s==='vgl')vglRedraw();
 },true);
 document.addEventListener('keydown',e=>{if((e.key==='Enter'||e.key===' ')&&e.target.dataset?.mwMgr){e.preventDefault();e.target.click();}});
 document.addEventListener('input',e=>{
  if(e.target.id!=='mwSearch'||!data)return;
  const q=norm(e.target.value.trim()),box=$('#mwSuggest');
  if(q.length<2){box.hidden=true;return;}
  const hits=data.players.filter(p=>norm(p.n).includes(q)||norm(p.t).includes(q)).sort((a,b)=>(norm(a.n).startsWith(q)?0:1)-(norm(b.n).startsWith(q)?0:1)||b.mv-a.mv).slice(0,12);
  box.innerHTML=hits.length?hits.map(p=>`<button type="button" data-mw-player="${esc(p.id)}">${esc(p.n)} <small>${esc(p.t||'')} · ${money(p.mv)}</small></button>`).join(''):'<p class="muted tiny" style="padding:10px">Kein Spieler gefunden.</p>';
  box.hidden=false;
 });
 // Antippen bzw. Überfahren des Diagramms: Wert an diesem Tag.
 const tipAt=e=>{
  const c=e.target.closest?.('.mw-chart');if(!c)return;
  const svg=c.querySelector('svg'),tip=c.querySelector('.mw-tip'),cur=c.querySelector('.mw-cursor'),pts=ptsFor(c.dataset.mwChart);if(pts.length<2)return;
  const W=Number(c.dataset.w)||600,r=svg.getBoundingClientRect(),k=r.width/W,f=Math.min(1,Math.max(0,(e.clientX-r.left-8*k)/((W-16)*k)));
  const t=pts[0].t+f*(pts[pts.length-1].t-pts[0].t),p=pts.reduce((b,x)=>Math.abs(x.t-t)<Math.abs(b.t-t)?x:b,pts[0]);
  const x=8+(p.t-pts[0].t)/(pts[pts.length-1].t-pts[0].t||1)*(W-16);
  cur.setAttribute('x1',x);cur.setAttribute('x2',x);cur.setAttribute('visibility','visible');
  tip.hidden=false;tip.textContent=`${new Date(p.t).toLocaleDateString('de-DE',{day:'2-digit',month:'2-digit',year:'2-digit',timeZone:'UTC'})}: ${money(p.v)}`;
  tip.style.left=Math.min(Math.max(0,x*k-54),r.width-120)+'px';
 };
 document.addEventListener('pointermove',tipAt);document.addEventListener('pointerdown',tipAt);
 window.addEventListener('hashchange',()=>{if(location.hash==='#marktwerte')load();});
 if(location.hash==='#marktwerte')load();
})();
