// Ansicht "Ligenübersicht" (Kevin-Wunsch): Spielplan, Ergebnisse und Tabelle von Bundesliga, 2. Bundesliga, LaLiga,
// Frauen-Bundesliga und MLS aus Kickbase (/api/ligen). Je Liga ein eingeklappter Bereich, darin Spieltag zum Blättern
// und die Tabelle (wieder eingeklappt). Erinnerung 1 Std. vor Spieltagsbeginn schickt der Tippdienst (push.js, pushTick).
(()=>{
 const $=s=>document.querySelector(s);
 const esc=v=>String(v??'').replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
 const img=p=>!p?'':/^https?:\/\//.test(p)?p:'https://kickbase.b-cdn.net/'+String(p).replace(/^\//,'');
 const TZ={timeZone:'Europe/Berlin'};
 const time=t=>new Date(t).toLocaleTimeString('de-DE',{...TZ,hour:'2-digit',minute:'2-digit'});
 const dayName=t=>new Date(t).toLocaleDateString('de-DE',{...TZ,weekday:'long',day:'2-digit',month:'2-digit'});
 const short=t=>new Date(t).toLocaleDateString('de-DE',{...TZ,weekday:'short',day:'2-digit',month:'2-digit'})+' '+time(t);
 const dateKey=t=>new Date(t).toLocaleDateString('sv-SE',TZ);
 let data=null,loading=false,timer=null;
 const pick={};// gewählter Spieltag je Liga (nur bis zum Neuladen der Seite)

 const crest=(t,cls='lg-crest')=>t?.img?`<img class="${cls}" src="${esc(img(t.img))}" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.style.visibility='hidden'">`:`<span class="${cls}"></span>`;
 const tname=t=>t?.n||t?.sy||'?';
 const dayState=d=>!d?'':d.matches.some(m=>m.state==='live')?'live':d.matches.length&&d.matches.every(m=>m.state==='done')?'done':'open';

 function pill(l){
  const d=l.days.find(x=>x.day===l.current);
  if(!d)return '';
  const s=dayState(d);
  if(s==='live')return `${esc(d.label)} · <b class="lg-live">LIVE</b>`;
  if(s==='done')return `${esc(d.label)} · beendet`;
  const next=d.matches.find(m=>m.state==='open'&&m.dt&&Date.parse(m.dt)>Date.now());
  return `${esc(d.label)}${next?' · '+esc(short(next.dt)):''}`;
 }
 function match(m,teams){
  const a=teams[m.t1],b=teams[m.t2];
  const mid=m.state==='open'||m.g1==null?`<span class="lg-time">${m.dt?esc(time(m.dt)):'–'}</span>`
   :`<span class="lg-score${m.state==='live'?' live':''}">${m.g1}:${m.g2}${m.state==='live'&&m.min?`<small>${esc(m.min)}'</small>`:''}</span>`;
  const win=m.state==='done'&&m.g1!=null?(m.g1>m.g2?1:m.g1<m.g2?2:0):0;
  return `<li class="lg-match"><span class="lg-team lg-home${win===1?' win':''}"><span class="lg-tn">${esc(tname(a))}</span>${crest(a)}</span>${mid}<span class="lg-team${win===2?' win':''}">${crest(b)}<span class="lg-tn">${esc(tname(b))}</span></span></li>`;
 }
 function matchday(l){
  const days=l.days;if(!days.length)return '<p class="muted">Kein Spielplan.</p>';
  const cur=pick[l.key]??l.current??days[0].day,i=Math.max(0,days.findIndex(x=>x.day===cur)),d=days[i];
  const groups=new Map();
  for(const m of d.matches){const k=m.dt?dateKey(m.dt):'';if(!groups.has(k))groups.set(k,[]);groups.get(k).push(m);}
  const nav=`<div class="lg-nav"><button type="button" class="ghost" data-lg-day="${l.key}:${days[i-1]?.day??''}"${i?'':' disabled'} aria-label="Spieltag davor">‹</button>
   <select data-lg-pick="${l.key}" aria-label="Spieltag wählen">${days.map(x=>`<option value="${x.day}"${x.day===d.day?' selected':''}>${esc(x.label)}${x.day===l.current?' (aktuell)':''}</option>`).join('')}</select>
   <button type="button" class="ghost" data-lg-day="${l.key}:${days[i+1]?.day??''}"${days[i+1]?'':' disabled'} aria-label="Spieltag danach">›</button></div>`;
  return nav+[...groups].map(([k,ms])=>`<h4 class="lg-date">${k&&ms[0].dt?esc(dayName(ms[0].dt)):'Termin offen'}</h4><ul class="lg-matches">${ms.map(m=>match(m,l.teams)).join('')}</ul>`).join('');
 }
 function table(rows,teams,title){
  if(!rows.length)return '';
  return `${title?`<h4 class="lg-date">${esc(title)}</h4>`:''}<table class="lg-table"><thead><tr><th>#</th><th>Verein</th><th class="right">Sp.</th><th class="right">TD</th><th class="right">Pkt.</th></tr></thead><tbody>${rows.map(r=>{const t=teams[r.id];
   return `<tr${r.live?' class="lg-tlive"':''}><td>${r.place??''}</td><td><span class="lg-tcell">${crest(t)}<span class="lg-tn">${esc(tname(t))}</span></span></td><td class="right">${r.games??''}</td><td class="right">${r.gd==null?'':r.gd>0?'+'+r.gd:r.gd}</td><td class="right"><b>${r.points??''}</b></td></tr>`;}).join('')}</tbody></table>`;
 }
 function league(l){
  if(l.error)return `<details class="acc-group lg-liga" data-lg="${l.key}"><summary><span class="tr-mname">${esc(l.name)}</span><span class="tr-pill error">fehlt</span></summary><div class="acc-sub"><p class="error">Das fehlt: Spielplan von Kickbase (${esc(l.error)}).</p></div></details>`;
  const tab=l.conf?.length?l.conf.map(c=>table(c.rows,l.teams,c.name)).join(''):table(l.table,l.teams);
  return `<details class="acc-group lg-liga" data-lg="${l.key}"><summary><span class="tr-mname">${esc(l.name)}</span><span class="lg-pill">${pill(l)}</span></summary><div class="acc-sub">
   <div class="lg-day" data-lg-body="${l.key}">${matchday(l)}</div>
   ${tab?`<details class="acc-group lg-tab" data-lg="${l.key}-tab"><summary><span class="tr-mname">Tabelle</span></summary><div class="acc-sub">${tab}</div></details>`:''}
  </div></details>`;
 }
 function render(){
  const root=$('#ligenContent');if(!root||!data)return;
  // Offene Bereiche beim Auffrischen offen lassen (nur innerhalb des geöffneten Reiters).
  const open=new Set([...root.querySelectorAll('details[open][data-lg]')].map(d=>d.dataset.lg));
  const push=window.kblPushOpen?`<p class="lg-push"><button type="button" class="ghost" data-lg-push>🔔 Erinnerung 1 Std. vor Spieltagsbeginn</button></p>`:'';
  root.className='';
  root.innerHTML=push+(data.leagues||[]).map(league).join('');
  root.querySelectorAll('details[data-lg]').forEach(d=>{if(open.has(d.dataset.lg))d.open=true;});
  const live=(data.leagues||[]).some(l=>l.days?.some(d=>dayState(d)==='live'));
  $('#ligenMeta').innerHTML=live?'<b class="lg-live">LIVE</b>':data.updatedAt?'Stand '+esc(short(data.updatedAt)):'';
  clearTimeout(timer);
  // Läuft ein Spiel, alle 2 Min. neu laden, solange der Reiter offen ist.
  if(live)timer=setTimeout(()=>{if($('.kbl-view[data-view="ligen"]')?.classList.contains('kbl-current'))load(true);},120e3);
 }
 async function load(quiet){
  if(loading)return;loading=true;
  try{
   const r=await fetch('/api/ligen',{cache:'no-store'});const d=await r.json().catch(()=>({}));
   if(!r.ok)throw Error(d.error||`HTTP ${r.status}`);
   data=d;render();
  }catch(e){if(!quiet){const r=$('#ligenContent');r.className='error';r.textContent='Ligen nicht abrufbar: '+e.message;$('#ligenMeta').textContent='–';}}
  finally{loading=false;}
 }
 const setDay=(key,day)=>{
  const l=data?.leagues?.find(x=>x.key===key);if(!l||!Number.isInteger(day))return;
  pick[key]=day;const body=document.querySelector(`[data-lg-body="${key}"]`);if(body)body.innerHTML=matchday(l);
 };
 document.addEventListener('click',e=>{
  const b=e.target.closest?.('[data-lg-day]');
  if(b){const [k,d]=b.dataset.lgDay.split(':');setDay(k,Number(d));return;}
  if(e.target.closest?.('[data-lg-push]')){window.kblPushOpen?.();return;}
  if(e.target.closest?.('[data-kbl-nav="ligen"]'))load();
 });
 document.addEventListener('change',e=>{const s=e.target.closest?.('[data-lg-pick]');if(s)setDay(s.dataset.lgPick,Number(s.value));});
 window.addEventListener('hashchange',()=>{if(location.hash==='#ligen')load();});
 if(location.hash==='#ligen')load();
})();
