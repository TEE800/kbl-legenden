// Ansicht "Challenges": Wertung der Legenden in den Kickbase-Challenges (Daten von /api/challenges).
(()=>{
 const $=s=>document.querySelector(s);
 const esc=v=>String(v??'').replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
 const mn=(n,id)=>window.kblMgrName?window.kblMgrName(n,'',id):esc(n);
 const fmt=n=>n==null||!Number.isFinite(n)?'–':new Intl.NumberFormat('de-DE',{maximumFractionDigits:1}).format(n);
 const date=s=>s?new Date(s).toLocaleDateString('de-DE',{day:'2-digit',month:'2-digit'}):'';
 let data=null,sortKey='avg',sortDir=-1,detailCh=null;

 // Pro Challenge: Rangliste der Legenden (Gleichstand = gleicher Platz).
 function ranked(c){
  const rows=Object.entries(c.results||{}).filter(([,r])=>r.players!==0).map(([id,r])=>({id,name:data.managers?.[id]||id,...r})).sort((a,b)=>b.points-a.points);
  rows.forEach((r,i)=>{r.rank=i&&rows[i-1].points===r.points?rows[i-1].rank:i+1;});
  return rows;
 }
 function stats(){
  const list=Object.values(data.challenges||{}).filter(c=>c.counted!==false).sort((a,b)=>String(a.end).localeCompare(String(b.end))||Number(a.ch)-Number(b.ch));
  const per={};
  for(const id of Object.keys(data.managers||{}))per[id]={id,name:data.managers[id],n:0,wins:0,podium:0,sum:0,rankSum:0,best:null,bestCh:null,last:0,capt:0};
  for(const c of list){
   const rows=ranked(c);
   for(const r of rows){
    const s=per[r.id]||(per[r.id]={id:r.id,name:r.name,n:0,wins:0,podium:0,sum:0,rankSum:0,best:null,bestCh:null,last:0,capt:0});
    s.n++;s.sum+=r.points;s.rankSum+=r.rank;s.capt+=r.captain?.points||0;
    if(r.rank===1&&rows.length>1)s.wins++;
    if(r.rank<=3&&rows.length>1)s.podium++;
    if(rows.length>1&&r.points===rows.at(-1).points)s.last++;
    if(s.best==null||r.points>s.best){s.best=r.points;s.bestCh=c.name;}
   }
  }
  const all=Object.values(per).map(s=>({...s,avg:s.n?s.sum/s.n:null,avgRank:s.n?s.rankSum/s.n:null,avgCapt:s.n?s.capt/s.n:null}));
  return {list,all};
 }

 function kpis(list,all){
  const played=all.filter(s=>s.n);
  const top=(k,dir=-1)=>{const v=played.map(s=>s[k]).filter(Number.isFinite);if(!v.length)return null;const m=dir<0?Math.max(...v):Math.min(...v);return{v:m,who:played.filter(s=>s[k]===m).map(s=>s.name)};};
  const best=top('best'),wins=top('wins'),avg=top('avg');
  const card=(t,v,sub)=>`<article><small>${t}</small><strong>${v}</strong><span>${sub}</span></article>`;
  return `<div class="kpis">${card('CHALLENGES GEWERTET',fmt(list.length),'Seit Saisonstart')}${card('MEISTE SIEGE',wins?fmt(wins.v):'–',wins?esc(wins.who.join(', ')):'')}${card('BESTER SCHNITT',avg?fmt(Math.round(avg.v)):'–',avg?esc(avg.who.join(', ')):'')}${card('HÖCHSTE PUNKTZAHL',best?fmt(best.v):'–',best?esc(best.who.join(', ')):'')}</div>`;
 }

 const cols=[['name','MANAGER',1],['n','TEILN.',-1],['wins','SIEGE',-1],['podium','TOP 3',-1],['last','LETZTER',-1],['avgRank','Ø PLATZ',1],['avg','Ø PUNKTE',-1],['best','BESTWERT',-1],['avgCapt','Ø KAPITÄN',-1],['sum','GESAMT',-1]];
 function table(all){
  const rows=all.filter(s=>s.n).sort((a,b)=>{const x=a[sortKey],y=b[sortKey];if(typeof x==='string')return sortDir*x.localeCompare(y);return sortDir*((x??-1e9)-(y??-1e9))||b.avg-a.avg;});
  const none=all.filter(s=>!s.n).map(s=>esc(s.name));
  const head=cols.map(([k,t])=>`<th class="${k==='name'?'':'right'}" data-ch-sort="${k}" style="cursor:pointer" title="Sortieren">${t}${sortKey===k?(sortDir<0?' ▼':' ▲'):''}</th>`).join('');
  const body=rows.map((s,i)=>`<tr><td>${i+1}. ${mn(s.name,s.id)}</td><td class="right">${s.n}</td><td class="right">${s.wins}</td><td class="right">${s.podium}</td><td class="right">${s.last}</td><td class="right">${fmt(s.avgRank)}</td><td class="right"><b>${fmt(Math.round(s.avg))}</b></td><td class="right" title="${esc(s.bestCh)}">${fmt(s.best)}</td><td class="right">${fmt(Math.round(s.avgCapt))}</td><td class="right">${fmt(s.sum)}</td></tr>`).join('');
  return `<div class="tablewrap"><table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></div><p class="muted tiny">Platz, Sieg, Top 3 und Letzter beziehen sich nur auf die Legenden, die die Challenge gespielt haben. Auf eine Spalte tippen zum Sortieren.${none.length?` Keine gewertete Challenge: ${none.join(', ')}.`:''}</p>`;
 }





 // Rush: Platzierung der Legenden nach aktueller Rush-Division (Kickbase), innerhalb gleicher Division nach den
 // seit Erfassung gesammelten Rush-Punkten. Gesamt-Rushpunkte gibt Kickbase nur fuer T800 heraus.
 function rushList(){return Object.values(data.challenges||{}).filter(c=>c.fav&&Object.keys(c.fav).length).sort((a,b)=>String(a.end).localeCompare(String(b.end))||Number(a.ch)-Number(b.ch));}
 function rushTable(){
  const R=data.rush;if(!R||!R.divisions?.length)return '<p class="muted">Noch keine Rush-Daten. Nach dem nächsten „Neue Challenges laden“ erscheinen hier die Divisionen der Legenden.</p>';
  const div=new Map(R.divisions.map((d,i)=>[String(d.dvi),{...d,idx:i}]));
  // Exakte Werte aus den gesicherten Kickbase-Gesamtstaenden: seit Beginn der Aufzeichnung und Schnitt je abgeschlossener Woche.
  const weeks=weekList().filter(w=>w.exact&&!w.open);
  const firstAt=Object.values(data.rushTotals||{}).map(h=>h[0]?.at).filter(Boolean).sort()[0]||null;
  const rows=Object.keys(data.managers||{}).map(id=>{
   const d=div.get(String(R.current?.[id]??'')),total=R.totals?.[id]??(id==='699062'?R.ownTotal:null);
   const up=d&&d.idx>0?R.divisions[d.idx-1]:null;
   // Gesamtplatz unter allen Rush-Spielern: alle in hoeheren Divisionen sind vorne; innerhalb der eigenen Division ist die
   // genaue Stelle unbekannt, darum ein Bereich (Teilnehmerzahlen uc aus der Divisionsleiter).
   const above=d?R.divisions.slice(0,d.idx).reduce((s,x)=>s+(x.uc||0),0):null,place=d&&d.uc!=null?{from:above+1,to:above+d.uc}:null;
   const h=data.rushHistory?.[id]||[],prev=h.length>1?div.get(String(h.at(-2).dvi)):null;
   const t0=data.rushTotals?.[id]?.[0]?.skp,since=total!=null&&t0!=null?total-t0:null;
   const wv=weeks.map(w=>w.rush[id]?.skp).filter(v=>v!=null),perWeek=wv.length?wv.reduce((x,y)=>x+y,0)/wv.length:null;
   return {id,name:data.managers[id],d,prev,total,up,place,since,perWeek,weeks:wv.length};
  }).sort((a,b)=>(b.total??-1)-(a.total??-1)||(a.d?a.d.idx:999)-(b.d?b.d.idx:999));
  const body=rows.map((r,i)=>{
   const arrow=r.prev&&r.d&&r.prev.idx!==r.d.idx?(r.d.idx<r.prev.idx?` <span style="color:#7fd3a6" title="aufgestiegen aus ${esc(r.prev.dvn)}">▲</span>`:` <span style="color:#ed8b85" title="abgestiegen aus ${esc(r.prev.dvn)}">▼</span>`):'';
   const toUp=r.up&&r.total!=null?`<span title="bis ${esc(r.up.dvn)}">${fmt(r.up.bod-r.total)}</span>`:'–';
   return `<tr><td>${r.total!=null?i+1+'.':'–'} ${mn(r.name,r.id)}</td><td class="right"><b>${r.total!=null?fmt(r.total):'–'}</b></td><td>${r.d?`${esc(r.d.dvn)}${arrow}`:'<span class="muted">unbekannt</span>'}</td><td class="right">${toUp}</td><td class="right">${r.place?`${fmt(r.place.from)}–${fmt(r.place.to)}`:'–'}</td><td class="right">${r.perWeek!=null?`<span title="Schnitt aus ${r.weeks} abgeschlossenen Woche(n)">${fmt(Math.round(r.perWeek))}</span>`:'–'}</td></tr>`;
  }).join('');
  const since=firstAt?date(firstAt):null;
  return `<div class="tablewrap"><table><thead><tr><th>MANAGER</th><th class="right">RUSH-PUNKTE</th><th>DIVISION</th><th class="right">BIS AUFSTIEG</th><th class="right">GESAMTPLATZ</th><th class="right">Ø PRO WOCHE</th></tr></thead><tbody>${body}</tbody></table></div><p class="muted tiny">Rush-Punkte und Division kommen direkt von Kickbase (Social Hub, gefolgte Manager). „Bis Aufstieg“ = fehlende Punkte bis zur nächsten Division. „Gesamtplatz“ = Platz unter allen ${fmt(R.divisions.reduce((s,x)=>s+(x.uc||0),0))} Rush-Spielern: alle in höheren Divisionen liegen vorne, die genaue Stelle innerhalb der eigenen Division gibt Kickbase nicht heraus, darum der Bereich. „Ø pro Woche“ ist exakt aus den gesicherten Kickbase-Ständen (alle 3 Stunden, seit ${since||'jetzt'}) und zählt nur abgeschlossene Wochen ab Beginn der Aufzeichnung (${weeks.length?weeks.length+' bisher':'noch keine, die erste kommt nach Ende von Woche 22'}).</p>`;
 }

 // Punkteentwicklung wie unter "Tabelle & Spieltage", aber je Challenge (aelteste links). Nicht gespielt = 0 Punkte.
 const progSel=new Set();let progMode='rush',progInit=false,progCleared=false;
 const RUSH_MODES=['rush','rushDaily','rushRank','top','rushWeek'];
 // Rush-Punkte je Kickbase-Woche (wn). Exakt aus den gesicherten Kickbase-Gesamtstaenden: Stand vor der ersten Challenge der
 // naechsten Woche minus Stand vor der ersten Challenge dieser Woche. Geht nur, wenn an beiden Grenzen ein Ladelauf lag (rushRuns);
 // sonst Summe der einzeln bekannten Challenges (unvollstaendig, Name mit *). Datum = Ende der letzten Challenge.
 function weekList(){
  const m=new Map();
  for(const c of rushList()){if(c.wn==null)continue;const w=m.get(c.wn)||{name:`Woche ${c.wn}`,wn:c.wn,end:c.end,first:c.end,rush:{},n:0};w.n++;if(String(c.end)>String(w.end))w.end=c.end;if(String(c.end)<String(w.first))w.first=c.end;
   for(const [id,r] of Object.entries(c.rush||{})){const t=w.rush[id]||(w.rush[id]={skp:0,top:null,n:0});t.n++;t.skp+=r.skp||0;}m.set(c.wn,w);}
  const weeks=[...m.values()].sort((a,b)=>a.wn-b.wn),T=data.rushTotals||{},runs=data.rushRuns||[];
  const at=(id,t)=>{let v=null;for(const e of T[id]||[]){if(String(e.at)<=String(t))v=e.skp;else break;}return v;};
  const ran=(a,b)=>runs.some(r=>String(r)>=String(a)&&(b==null||String(r)<String(b)));
  weeks.forEach((w,i)=>{
   const prev=weeks[i-1],next=weeks[i+1];
   if(prev&&ran(prev.end,w.first)&&(!next||ran(w.end,next.first))){
    const ex={};
    for(const id of Object.keys(T)){const a=at(id,w.first),b=next?at(id,next.first):(data.rush?.totals?.[id]??null);if(a!=null&&b!=null)ex[id]={skp:b-a,n:w.rush[id]?.n||0};}
    w.rush=ex;w.exact=true;if(!next){w.open=true;w.name+=' (laufend)';}
   }else w.name+='*';
  });
  return weeks;
 }
 const progColors=['#f1c75c','#59b8e8','#ed8b85','#7fd3a6','#bb9af7','#e8a665','#75d5d1','#ed94c6','#a6c76a','#d0b8ff','#ffb4a0','#86b2ff','#c1db77','#d1a77b','#e0d9a0','#9ebdc8'];
 function progress(list){
  const rushMode=RUSH_MODES.includes(progMode);
  if(rushMode)list=progMode==='rushWeek'?weekList():rushList();
  const rec=(c,id)=>rushMode?c.rush?.[id]:c.results?.[id];
  const val=(c,id)=>rushMode?(c.rush?.[id]?.skp||0):(c.results?.[id]?.points||0);
  const hasTotal=id=>data.rush?.totals?.[id]!=null,needTotal=(progMode==='rush'||progMode==='rushRank')&&Object.keys(data.rush?.totals||{}).length;
  // Rush: alle Legenden mit Kickbase-Stand zeigen, auch wenn sie zuletzt nicht gespielt haben (dann Luecke).
  const ids=Object.keys(data.managers||{}).filter(id=>(rushMode&&hasTotal(id))||(!needTotal&&list.some(c=>rec(c,id))));
  if(!list.length||!ids.length)return `<div class="kbl-chart-tools"><label>Ansicht <select id="challengeProgMode">${modeOpts()}</select></label></div><p class="muted">${rushMode?'Noch keine Rush-Daten der Legenden gesichert.':'Noch keine Challenges vorhanden.'}</p>`;
  const name=id=>data.managers[id]||id;
  const cum={};ids.forEach(id=>cum[id]=[]);
  list.forEach((c,i)=>ids.forEach(id=>cum[id][i]=(i?cum[id][i-1]:0)+val(c,id)));
  // Rush gesamt: vom aktuellen Kickbase-Stand rueckwaerts (Stand nach Challenge i = heute minus spaetere Challenges).
  if(rushMode){const T=data.rush?.totals||{};ids.forEach(id=>{const t=T[id]??(id==='699062'?data.rush?.ownTotal:null);if(t==null)return;const last=cum[id][list.length-1];cum[id]=cum[id].map(v=>t-last+v);});}
  const n=list.length-1;
  ids.sort((a,b)=>cum[b][n]-cum[a][n]);
  if(!progInit||(!progSel.size&&!progCleared)){ids.slice(0,3).forEach(id=>progSel.add(id));if(ids.includes('699062'))progSel.add('699062');progInit=true;}
  for(const id of [...progSel])if(!ids.includes(id))progSel.delete(id);
  const colorOf=new Map([...progSel].map((id,i)=>[id,progColors[i%progColors.length]]));
  const isRank=progMode==='rank'||progMode==='rushRank',inv=isRank||progMode==='top';
  const ranks=list.map((c,i)=>{const s=[...ids].sort((a,b)=>cum[b][i]-cum[a][i]),m=new Map();s.forEach((id,k)=>m.set(id,k&&cum[s[k-1]][i]===cum[id][i]?m.get(s[k-1]):k+1));return m;});
  const lead=list.map((c,i)=>Math.max(...ids.map(id=>cum[id][i])));
  const avgs={};ids.forEach(id=>{let n=0,sum=0;avgs[id]=list.map(c=>{const r=c.results?.[id];if(r&&r.players!==0){n++;sum+=r.points;}return n?sum/n:null;});});
  const valueOf=(id,c,i)=>isRank?ranks[i].get(id):progMode==='rushWeek'?(c.rush?.[id]?c.rush[id].skp:null):progMode==='rushDaily'?(c.rush?.[id]?(c.rush[id].skp??null):null):progMode==='top'?(c.rush?.[id]?c.rush[id].top:null):progMode==='rush'?cum[id][i]:progMode==='avg'?avgs[id][i]:progMode==='daily'?(c.results?.[id]?c.results[id].points:null):progMode==='gap'?cum[id][i]-lead[i]:cum[id][i];
  const lines=ids.map(id=>({id,name:name(id),color:colorOf.get(id)||null,values:list.map((c,i)=>valueOf(id,c,i))}));
  const all=lines.flatMap(l=>l.values).filter(v=>v!==null&&Number.isFinite(v));
  const narrow=(document.querySelector('#challengeContent')?.clientWidth||1000)<640;
  const W=narrow?480:1000,H=400,left=narrow?64:78,right=narrow?100:150,top=24,bottom=48,pw=W-left-right,ph=H-top-bottom,fs=narrow?16:12;
  let lo=Math.min(...all),hi=Math.max(...all);if(progMode==='gap')hi=0;
  if(progMode==='avg')lo=Math.max(0,lo);
  if(progMode==='top'){lo=0;hi=100;}
  const rough=Math.max(1,(hi-lo)/5),mag=10**Math.floor(Math.log10(rough)),tickStep=[1,2,2.5,5,10].map(f=>f*mag).find(v=>v>=rough);
  lo=Math.floor(lo/tickStep)*tickStep;hi=Math.ceil(hi/tickStep)*tickStep;if(hi===lo)hi=lo+tickStep;
  const rankCount=isRank?ids.length:0;if(isRank){lo=.5;hi=rankCount+.5;}
  const x=i=>left+(list.length===1?pw/2:i*pw/(list.length-1));
  const y=v=>inv?top+(v-lo)/(hi-lo)*ph:top+(hi-v)/(hi-lo)*ph;
  const unit=v=>isRank?`Platz ${v}`:progMode==='top'?`Top ${fmt(v)} %`:progMode==='rush'||progMode==='rushDaily'||progMode==='rushWeek'?`${fmt(v)} Rush-Punkte`:progMode==='avg'?`Ø ${fmt(Math.round(v))} Punkte`:progMode==='gap'?(v===0?'vorne':`${fmt(-v)} Punkte hinter Platz 1`):`${fmt(v)} Punkte`;
  let svg=`<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Punkteentwicklung in den Challenges" xmlns="http://www.w3.org/2000/svg" style="width:100%;height:auto"><rect x="0" y="0" width="${W}" height="${H}" fill="#12212b" rx="10"/>`;
  if(isRank){const every=rankCount>12?2:1;for(let r=1;r<=rankCount;r++){if((r-1)%every&&r!==rankCount)continue;svg+=`<line x1="${left}" y1="${y(r)}" x2="${W-right}" y2="${y(r)}" stroke="#2c3c47"/><text x="${left-10}" y="${y(r)+4}" fill="${r===1?'#f1c75c':'#9fb3c0'}" text-anchor="end" font-size="${fs}">${r}.</text>`;}}
  else for(let v=lo;v<=hi+tickStep/1000;v+=tickStep){const yy=y(v);svg+=`<line x1="${left}" y1="${yy}" x2="${W-right}" y2="${yy}" stroke="${progMode==='gap'&&Math.abs(v)<1e-9?'#6b5a2e':'#2c3c47'}"/><text x="${left-10}" y="${yy+4}" fill="#9fb3c0" text-anchor="end" font-size="${fs}">${progMode==='gap'&&v<0?'−'+fmt(Math.round(-v)):fmt(Math.round(v))}</text>`;}
  const step=Math.max(1,Math.ceil(list.length/(narrow?6:12)));list.forEach((c,i)=>{if((i%step===0&&list.length-1-i>=step/2)||i===list.length-1)svg+=`<text x="${x(i)}" y="${H-18}" fill="#9fb3c0" text-anchor="middle" font-size="${fs}">${date(c.end)}</text>`;});
  const pts=l=>{const segs=[];let seg=[];l.values.forEach((v,i)=>{if(v===null||!Number.isFinite(v)){if(seg.length)segs.push(seg);seg=[];}else seg.push(`${x(i).toFixed(1)},${y(v).toFixed(1)}`);});if(seg.length)segs.push(seg);return segs;};
  for(const l of [...lines.filter(l=>!l.color),...lines.filter(l=>l.color)]){
   const hl=!!l.color,last=[...l.values].reverse().find(v=>v!==null&&Number.isFinite(v));
   svg+=`<g data-ch-line="${esc(l.id)}" style="cursor:pointer"><title>${esc(l.name)}${last!=null?`: ${unit(last)}`:''} (klicken zum ${hl?'Zurücknehmen':'Hervorheben'})</title>`;
   for(const p of pts(l))if(p.length>1)svg+=`<polyline points="${p.join(' ')}" fill="none" stroke="transparent" stroke-width="14" pointer-events="stroke"/><polyline points="${p.join(' ')}" fill="none" stroke="${hl?l.color:'#5d6f7b'}" stroke-opacity="${hl?1:.45}" stroke-width="${hl?3.5:1.5}" stroke-linecap="round" stroke-linejoin="round"/>`;
   if(!hl)l.values.forEach((v,i)=>{if(v===null||!Number.isFinite(v))return;svg+=`<circle cx="${x(i)}" cy="${y(v)}" r="2.5" fill="#5d6f7b" fill-opacity=".6"></circle>`;});
   if(hl)l.values.forEach((v,i)=>{if(v===null||!Number.isFinite(v))return;svg+=`<circle cx="${x(i)}" cy="${y(v)}" r="4" fill="${l.color}" stroke="#12212b" stroke-width="1.5"><title>${esc(l.name)} · ${esc(list[i].name)} (${date(list[i].end)}): ${unit(v)}</title></circle>`;});
   svg+='</g>';
  }
  const labels=lines.filter(l=>l.color).map(l=>{const i=l.values.map((v,k)=>v!==null&&Number.isFinite(v)?k:-1).filter(k=>k>=0).at(-1);return i==null?null:{name:l.name,color:l.color,ty:y(l.values[i]),lx:x(i)};}).filter(Boolean).sort((a,b)=>a.ty-b.ty);
  const gap=fs+3;labels.forEach((l,k)=>{l.y=Math.max(l.ty,k?labels[k-1].y+gap:top);});
  const over=labels.length?labels.at(-1).y-(H-bottom):0;if(over>0)labels.forEach(l=>l.y-=over);
  for(const l of labels){const max=narrow?10:16,shown=l.name.length>max?l.name.slice(0,max-1)+'…':l.name;svg+=`<line x1="${l.lx+6}" y1="${l.ty}" x2="${W-right+8}" y2="${l.y}" stroke="${l.color}" stroke-opacity=".5"/><text x="${W-right+12}" y="${l.y+4}" fill="${l.color}" font-size="${fs}" font-weight="700">${esc(shown)}</text>`;}
  svg+='</svg>';
  const how={rush:'Rush-Punkte nach jeder Challenge (heutiger Kickbase-Stand, rückwärts um die Punkte der späteren Challenges verringert)',rushDaily:'Rush-Punkte je Challenge (Lücke = nicht gespielt)',rushWeek:'Rush-Punkte je Kickbase-Woche, exakt aus dem Kickbase-Gesamtstand (Stand Wochenende minus Stand Wochenanfang, alle Challenges inkl. Perfect Matchday). * = Woche vor Beginn der Aufzeichnung: nur Summe der einzeln bekannten Challenges, unvollständig',rushRank:'Platz unter den Legenden nach Rush-Punkten (Platz 1 oben)',top:'Top-Prozent je Challenge unter allen Kickbase-Teilnehmern (oben = besser, Lücke = nicht gespielt)',avg:'Durchschnittspunkte je gespielter Challenge, laufend nach jeder Challenge (fairer Vergleich unabhängig von der Anzahl)',gap:'Abstand zum Führenden der Challenge-Gesamtpunkte nach jeder Challenge (0 = vorne)',cumulative:'Kumulierte Challenge-Punkte nach jeder Challenge',daily:'Punkte je Challenge (Lücke = nicht gespielt)',rank:'Platz in der Challenge-Gesamtpunktzahl nach jeder Challenge (Platz 1 oben)'}[progMode];
  const boxes=ids.map(id=>{const c=colorOf.get(id);return `<label style="border-color:${c||'#394c57'}"><input type="checkbox" data-ch-pick="${esc(id)}" ${c?'checked':''}><span style="color:${c||'#5d6f7b'}">●</span>${esc(name(id))}</label>`;}).join('');
  return `<div class="kbl-chart-tools"><label>Ansicht <select id="challengeProgMode">${modeOpts()}</select></label><div class="kbl-chart-buttons"><button type="button" class="ghost" data-ch-prog="top">Top 5</button><button type="button" class="ghost" data-ch-prog="all">Alle</button><button type="button" class="ghost" data-ch-prog="none">Keine</button></div></div><div class="kbl-chart-managers">${boxes}</div><div class="kbl-chart-area">${svg}<p class="muted tiny" style="margin-top:12px">${how}.${rushMode?'':' Nicht gespielte Challenges zählen als 0 Punkte.'} Graue Linien antippen oder oben anhaken, um sie hervorzuheben.</p></div>`;
 }

 function modeOpts(){
  const opt=(v,t)=>`<option value="${v}"${progMode===v?' selected':''}>${t}</option>`;
  return `${opt('rush','Rush-Punkte gesamt')}${opt('rushRank','Rush-Platz-Verlauf')}${opt('rushWeek','Rush-Punkte pro Woche')}${opt('rushDaily','Rush-Punkte pro Challenge')}${opt('top','Top-Prozent pro Challenge')}`;
 }

 let devOpen=false,rushOpen=false;
 document.addEventListener('toggle',e=>{if(e.target.id==='challengeDev')devOpen=e.target.open;if(e.target.id==='challengeRush')rushOpen=e.target.open;},true);
 function render(){
  const root=$('#challengeContent');if(!root||!data)return;
  const {list,all}=stats();
  $('#challengeMeta').textContent=data.updatedAt?`Stand ${new Date(data.updatedAt).toLocaleString('de-DE',{day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'})}`:'Noch nicht geladen';
  if(!list.length&&!Object.keys(data.challenges||{}).length){root.innerHTML='<p class="muted">Noch keine Challenges gespeichert. Mit „Neue Challenges laden“ holt die App alle abgeschlossenen Challenges dieser Saison (nur Admin, dauert beim ersten Mal ein paar Minuten).</p>';return;}
  const out=Object.values(data.challenges||{}).filter(c=>c.counted===false);
  const outHtml=out.length?`<p class="muted tiny">Nicht gewertet (${out.length}): ${out.map(c=>esc(c.name)+(c.check&&!c.check.ok?` – Gegenprobe T800: ${fmt(c.check.computed)} statt ${fmt(c.check.expected)}`:c.found?' – gefunden, Wettbewerb nicht bestätigt':'')).join(' · ')}</p>`:'';
  root.innerHTML=`<details class="acc-group pts-group" id="challengeRush"${rushOpen?' open':''}><summary>Rush-Platzierung <span class="pts-sub">Rush-Punkte, Division und Wochenschnitt der Legenden</span></summary><div class="acc-sub">${rushTable()}</div></details><details class="acc-group pts-group" id="challengeDev"${devOpen?' open':''}><summary>Entwicklung <span class="pts-sub">Rush-Punkte, Platz und Wochen im Verlauf</span></summary><div class="acc-sub">${progress(list)}</div></details>`;
 }

 async function load(){
  try{const r=await fetch('/api/challenges',{cache:'no-store'});data=await r.json();render();}
  catch{const root=$('#challengeContent');if(root)root.textContent='Challenges konnten nicht geladen werden.';}
 }
 function showResult(j){
  const msg=$('#challengeMessage');if(!j)return;
  if(j.error){msg.textContent=j.error;return;}
  const parts=[j.added.length?`${j.added.length} neue Challenges gespeichert.`:'Keine neuen abgeschlossenen Challenges.'];
  if(j.mismatched?.length)parts.push(`Gegenprobe stimmt nicht bei: ${j.mismatched.join(', ')}.`);
  if(j.failed?.length)parts.push(`Nicht geladen (Kickbase-Fehler, nächstes Mal erneut): ${j.failed.map(f=>f.name).join(', ')}.`);
  msg.textContent=parts.join(' ');
 }
 // Laden laeuft auf dem Server im Hintergrund; hier wird alle 3 Sekunden der Stand abgefragt.
 async function poll(){
  const btn=$('#challengeRefresh'),msg=$('#challengeMessage');
  await load();
  if(data?.running){btn.disabled=true;const p=data.running;msg.textContent=`Lade bei Kickbase: ${p.phase}${p.total?` (${p.done} von ${p.total})`:''} … Beim ersten Mal kann das einige Minuten dauern.`;setTimeout(poll,3000);}
  else{btn.disabled=false;showResult(data?.lastResult);}
 }
 async function refresh(){
  const btn=$('#challengeRefresh'),msg=$('#challengeMessage');
  btn.disabled=true;msg.textContent='Starte …';
  try{
   const r=await fetch('/api/challenges/refresh',{method:'POST'});
   if(!r.ok){const j=await r.json().catch(()=>({}));msg.textContent=j.error||'Fehler beim Laden.';btn.disabled=false;return;}
   poll();
  }catch{msg.textContent='Keine Verbindung zum Server.';btn.disabled=false;}
 }
 document.addEventListener('click',e=>{
  const s=e.target.closest('[data-ch-sort]');
  if(s){const k=s.dataset.chSort;if(sortKey===k)sortDir=-sortDir;else{sortKey=k;sortDir=cols.find(c=>c[0]===k)[2];}render();return;}
  const d=e.target.closest('[data-ch-detail]');
  if(d){detailCh=d.dataset.chDetail;render();$('#challengeDetail')?.scrollIntoView({behavior:'smooth'});}
 });
 document.addEventListener('change',e=>{
  if(e.target.id==='challengeDetailSelect'){detailCh=e.target.value;render();}
  if(e.target.id==='challengeProgMode'){progMode=e.target.value;render();}
  const pk=e.target.closest?.('[data-ch-pick]');if(pk){progCleared=true;if(pk.checked)progSel.add(pk.dataset.chPick);else progSel.delete(pk.dataset.chPick);render();}
 });
 document.addEventListener('click',e=>{
  const ln=e.target.closest('[data-ch-line]');if(ln){progCleared=true;const id=ln.dataset.chLine;if(progSel.has(id))progSel.delete(id);else progSel.add(id);render();return;}
  const b=e.target.closest('[data-ch-prog]');if(!b||!data)return;
  const list=Object.values(data.challenges||{}),ids=Object.keys(data.managers||{}).filter(id=>list.some(c=>c.results?.[id]||c.rush?.[id]));
  const rm=RUSH_MODES.includes(progMode),tot=id=>list.reduce((s,c)=>s+(rm?(c.rush?.[id]?.skp||0):(c.results?.[id]?.points||0)),0);
  progSel.clear();progCleared=b.dataset.chProg==='none';if(b.dataset.chProg==='top')ids.sort((a,b)=>tot(b)-tot(a)).slice(0,5).forEach(id=>progSel.add(id));if(b.dataset.chProg==='all')ids.forEach(id=>progSel.add(id));render();
 });
 $('#challengeRefresh')?.addEventListener('click',refresh);
 poll();
})();
