// Spieltagsbericht auf der Startseite (Kevin-Wunsch): Bericht, den Claude nach der Abrechnung schreibt (tools/spieltagsbericht.mjs).
// Freigabe (Kevin-Wunsch 28.10.): Claude schreibt nur einen Entwurf im Tippdienst. Sichtbar für alle ist nur, was der Admin
// freigegeben hat (data/berichte.json bzw. live GET /bericht). Mit Admin-Code (wie die BumsParade-Haken) sieht der Admin hier
// den Entwurf, kann Schlagzeile und Text ändern, speichern, veröffentlichen oder wieder zurückziehen.
// Bereich startet zu (feste Regel), die Schlagzeile steht auch eingeklappt in der Pill.
(()=>{
 const sec=document.getElementById('bericht');if(!sec)return;
 const $=id=>document.getElementById(id);
 const API=String(window.KBL_TIPP_API||'').replace(/\/+$/,''),CODE='kbl-admin-haken';
 const code=()=>{try{return localStorage.getItem(CODE)||'';}catch{return '';}};
 const isAdmin=()=>!!(API&&code());
 const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 // Kleiner, sicherer Markdown-Leser: erst alles maskieren, dann nur Überschriften, **fett**, *kursiv*, Listen und Absätze.
 const inline=s=>esc(s).replace(/\*\*(.+?)\*\*/g,'<b>$1</b>').replace(/(^|[^*])\*([^*\s][^*]*?)\*(?!\*)/g,'$1<i>$2</i>');
 function md(text){
  const out=[];let list=null,para=[];
  const flushP=()=>{if(para.length){out.push(`<p>${inline(para.join(' '))}</p>`);para=[];}};
  const flushL=()=>{if(list){out.push(`<${list.t}>${list.items.map(i=>`<li>${inline(i)}</li>`).join('')}</${list.t}>`);list=null;}};
  for(const raw of String(text||'').split(/\r?\n/)){
   const line=raw.trim();let m;
   if(!line){flushP();flushL();continue;}
   if(/^#\s/.test(line)){flushP();flushL();continue;} // Schlagzeile steht extra darüber
   if((m=/^#{2,4}\s+(.+)$/.exec(line))){flushP();flushL();out.push(`<h4 class="ber-h">${inline(m[1])}</h4>`);continue;}
   if(/^(-{3,}|\*{3,})$/.test(line)){flushP();flushL();out.push('<hr class="ber-hr">');continue;}
   if((m=/^[-*•]\s+(.+)$/.exec(line))){flushP();if(list?.t!=='ul'){flushL();list={t:'ul',items:[]};}list.items.push(m[1]);continue;}
   if((m=/^\d+[.)]\s+(.+)$/.exec(line))){flushP();if(list?.t!=='ol'){flushL();list={t:'ol',items:[]};}list.items.push(m[1]);continue;}
   flushL();para.push(line);
  }
  flushP();flushL();return out.join('');
 }
 // Erste Zeile „# Schlagzeile“ gehört zum Text; beim Bearbeiten werden Schlagzeile und Text getrennt gezeigt.
 const bodyOf=t=>String(t||'').replace(/^\s*#\s+.*(\r?\n)?/,'').replace(/^\s+/,'');
 const when=s=>s?new Date(s).toLocaleString('de-DE',{dateStyle:'short',timeStyle:'short'}):'';
 const req=async(p,body)=>{const r=await fetch(API+p,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...body,adminCode:code()}),cache:'no-store'});const d=await r.json().catch(()=>({}));if(!r.ok){if(r.status===403)try{localStorage.removeItem(CODE);}catch{}throw Error(d.error||'Tippdienst nicht erreichbar.');}return d;};

 // Zahlenprüfung im Browser für eigene Änderungen (gleiche Regel wie zahlenPruefen in tools/spieltagsbericht.mjs).
 const normNum=t=>Number(String(t).replace(/[–−]/g,'-').replace(/\.(?=\d{3}(\D|$))/g,'').replace(',','.'));
 function fremdeZahlen(text,day){const ok=new Set(zahlen[day]||[]);if(!ok.size)return null;const out=[];for(const m of String(text).matchAll(/[–−-]?\d{1,3}(?:\.\d{3})+(?:,\d+)?|[–−-]?\d+(?:,\d+)?/g)){const v=normNum(m[0]);if(Number.isFinite(v)&&![v,Math.abs(v),Math.round(Math.abs(v)*10)/10].some(x=>ok.has(String(x))))out.push(m[0]);}return [...new Set(out)];}
 // Prüfbox für den Admin: Ergebnis der automatischen Prüfung (Zahlen + Gegenprüfung durch Claude) und Zahlen aus eigenen Änderungen.
 function pruefHtml(b){
  const p=pruef[b.day],rows=[];
  if(p){
   rows.push(p.zahlen?.length?`<li class="bad">⚠️ ${p.zahlen.length} Zahl${p.zahlen.length===1?'':'en'} nicht in den App-Daten gefunden: ${p.zahlen.map(z=>`<b>${esc(z.zahl)}</b>`).join(', ')}</li>`:'<li>✓ Alle Zahlen stammen aus den App-Daten.</li>');
   if(!p.ki||p.ki.fehler)rows.push(`<li class="muted">Gegenprüfung durch Claude: ${esc(p.ki?.fehler||'nicht gelaufen')}</li>`);
   else rows.push(p.ki.probleme.length?`<li class="bad">⚠️ Gegenprüfung fand ${p.ki.probleme.length} Punkt${p.ki.probleme.length===1?'':'e'}:<ul>${p.ki.probleme.map(x=>`<li>„${esc(x.zitat)}“: ${esc(x.grund)}</li>`).join('')}</ul></li>`:'<li>✓ Gegenprüfung: Claude hat jede Aussage mit den App-Daten verglichen, kein Fehler gefunden.</li>');
  }else rows.push('<li class="muted">Noch keine automatische Prüfung für diese Fassung.</li>');
  if(b.editedAt){const f=fremdeZahlen(b.text,b.day);if(f)rows.push(f.length?`<li class="bad">⚠️ In deiner Änderung stehen Zahlen, die nicht in den App-Daten vorkommen: ${f.map(x=>`<b>${esc(x)}</b>`).join(', ')}</li>`:'<li>✓ Auch nach deiner Änderung stammen alle Zahlen aus den App-Daten.</li>');}
  return `<div class="ber-pruef"><b>🔍 Prüfung</b><ul>${rows.join('')}</ul></div>`;
 }
 let pub=[],drafts=[],sel=null,editing=false,msg='',pruef={},zahlen={};
 async function loadPublic(){
  let list=[];
  try{const r=await fetch('/api/berichte',{cache:'no-store'});if(r.ok){const d=await r.json();list=d.berichte||[];pruef=d.pruefungen||{};zahlen=d.zahlen||{};}}catch{}
  // Online sofort nach der Freigabe sichtbar, nicht erst nach dem nächsten Export.
  if(API)try{const r=await fetch(API+'/bericht',{cache:'no-store'});if(r.ok){const live=(await r.json()).berichte||[];const m=new Map(list.map(b=>[b.day,b]));for(const b of live)if(b.status==='frei')m.set(b.day,b);list=[...m.values()];}}catch{}
  return list.sort((a,b)=>b.day-a.day);
 }
 async function load(){
  pub=await loadPublic();
  drafts=[];if(isAdmin())try{drafts=(await req('/bericht/admin',{})).berichte||[];}catch(e){msg=e.message;}
  const newestDraft=drafts.find(b=>b.status!=='frei'&&!pub.some(p=>p.day>=b.day));
  if(!editing)sel=newestDraft||pub[0]||null;
  render();
 }
 function render(){
  if(!sel&&!isAdmin()){sec.hidden=true;return;}
  sec.hidden=false;
  const pill=$('berichtPill'),box=$('berichtContent');
  if(!sel){pill.textContent='Noch kein Bericht';box.innerHTML=`<p class="muted">Noch kein Bericht. Sobald ein Spieltag abgerechnet ist, schreibt Claude einen Entwurf, den du hier prüfst und freigibst.</p>${msg?`<p class="error">${esc(msg)}</p>`:''}`;return;}
  const draft=sel.status&&sel.status!=='frei';
  pill.textContent=`${draft?'📝 Entwurf · ':''}ST ${sel.day}: ${sel.title||''}`;pill.title=sel.title||'';
  const admin=isAdmin()&&drafts.some(b=>b.day===sel.day);
  const bar=admin?`<div class="ber-admin">${draft?'<span class="ber-badge">Entwurf · nur für dich sichtbar</span>':'<span class="ber-badge ber-ok">✓ Veröffentlicht</span>'}<div class="ber-btns">${editing?'':`<button type="button" class="ghost" data-ber="edit">✏️ Bearbeiten</button>${draft?'<button type="button" class="gold" data-ber="freigeben">✅ Veröffentlichen</button>':'<button type="button" class="ghost" data-ber="zurueckziehen">↩ Zurückziehen</button>'}`}</div></div>`:'';
  const foot=`<p class="muted tiny ber-foot">Spieltag ${sel.day} · geschrieben von Claude${sel.editedAt?' · bearbeitet von T800':''}${sel.approvedAt?' · freigegeben '+esc(when(sel.approvedAt)):''} · alle Zahlen aus der App</p>`;
  if(editing){
   box.innerHTML=`${bar}<label class="ber-lbl">Schlagzeile<input id="berTitle" maxlength="200" value="${esc(sel.title||'')}"></label><label class="ber-lbl">Text<textarea id="berText" rows="18">${esc(bodyOf(sel.text))}</textarea></label><p class="muted tiny">## am Zeilenanfang = Zwischenüberschrift, **so** = fett, - am Zeilenanfang = Liste, Leerzeile = neuer Absatz.</p><div class="ber-btns"><button type="button" class="ghost" data-ber="speichern">💾 Speichern</button>${draft?'<button type="button" class="gold" data-ber="freigeben">✅ Speichern und veröffentlichen</button>':''}<button type="button" class="ghost" data-ber="abbrechen">Abbrechen</button></div><p class="muted tiny" id="berLive"></p><p class="muted tiny" role="status">${esc(msg)}</p>`;
   const live=()=>{const f=fremdeZahlen($('berText').value,sel.day),el=$('berLive');if(!el||!f)return;el.innerHTML=f.length?`⚠️ Diese Zahlen stehen nicht in den App-Daten: ${f.map(x=>`<b>${esc(x)}</b>`).join(', ')}`:'✓ Alle Zahlen stammen aus den App-Daten.';el.className=f.length?'tiny ber-warn':'muted tiny';};
   $('berText').addEventListener('input',live);live();
   return;
  }
  const pr=admin&&draft?pruefHtml(sel):'';
  box.innerHTML=`${bar}${pr}<h3 class="ber-title">${esc(sel.title||`Spieltag ${sel.day}`)}</h3><div class="ber-body">${md(sel.text)}</div>${foot}${msg?`<p class="muted tiny" role="status">${esc(msg)}</p>`:''}`;
 }
 sec.addEventListener('click',async e=>{
  const b=e.target.closest('[data-ber]');if(!b||!sel)return;const act=b.dataset.ber;
  if(act==='edit'){editing=true;msg='';render();return;}
  if(act==='abbrechen'){editing=false;msg='';render();return;}
  if(act==='freigeben'&&!confirm(`Bericht zu Spieltag ${sel.day} für alle veröffentlichen?`))return;
  if(act==='zurueckziehen'&&!confirm('Bericht wieder zurückziehen? Dann sieht ihn nur noch du.'))return;
  const body={action:act==='speichern'?'speichern':act};
  if(editing){const t=$('berTitle').value.trim(),x=$('berText').value;body.title=t;body.text=`# ${t}\n\n${x.trim()}\n`;}
  b.disabled=true;
  try{const d=await req(`/bericht/${sel.day}`,body);sel=d.bericht;editing=false;msg=act==='freigeben'?'Veröffentlicht. Alle sehen ihn sofort.':act==='zurueckziehen'?'Zurückgezogen.':'Gespeichert.';await load();}
  catch(err){msg='Nicht gespeichert: '+err.message;render();}
 });
 load();
 // Neue Berichte kommen mit dem nächsten Export; beim Zurückholen der Seite neu laden (nicht während des Bearbeitens).
 document.addEventListener('visibilitychange',()=>{if(!document.hidden&&!editing)load();});
 // Nach der Admin-Anmeldung in der BumsParade (gleicher Code) Entwürfe zeigen.
 window.addEventListener('storage',e=>{if(e.key===CODE&&!editing)load();});
 window.kblBerichtReload=()=>{if(!editing)load();};
 // Anmeldung/Abmeldung als Admin (BumsParade „🔑 Bearbeiten (Admin)“) gleich hier übernehmen.
 const H=window.kblHaken;if(H?.login&&!H.__ber){const li=H.login.bind(H),lo=H.logout.bind(H);H.login=async c=>{await li(c);window.kblBerichtReload();};H.logout=()=>{lo();window.kblBerichtReload();};H.__ber=true;}
})();
