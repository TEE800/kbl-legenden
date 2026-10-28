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

 let pub=[],drafts=[],sel=null,editing=false,msg='';
 async function loadPublic(){
  let list=[];
  try{const r=await fetch('/api/berichte',{cache:'no-store'});if(r.ok)list=(await r.json()).berichte||[];}catch{}
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
  const foot=`<p class="muted tiny ber-foot">Spieltag ${sel.day} · geschrieben von Claude${sel.editedAt?' · bearbeitet':''}${sel.approvedAt?' · freigegeben '+esc(when(sel.approvedAt)):''} · alle Zahlen aus der App</p>`;
  if(editing){
   box.innerHTML=`${bar}<label class="ber-lbl">Schlagzeile<input id="berTitle" maxlength="200" value="${esc(sel.title||'')}"></label><label class="ber-lbl">Text<textarea id="berText" rows="18">${esc(bodyOf(sel.text))}</textarea></label><p class="muted tiny">## am Zeilenanfang = Zwischenüberschrift, **so** = fett, - am Zeilenanfang = Liste, Leerzeile = neuer Absatz.</p><div class="ber-btns"><button type="button" class="ghost" data-ber="speichern">💾 Speichern</button>${draft?'<button type="button" class="gold" data-ber="freigeben">✅ Speichern und veröffentlichen</button>':''}<button type="button" class="ghost" data-ber="abbrechen">Abbrechen</button></div><p class="muted tiny" role="status">${esc(msg)}</p>`;
   return;
  }
  box.innerHTML=`${bar}<h3 class="ber-title">${esc(sel.title||`Spieltag ${sel.day}`)}</h3><div class="ber-body">${md(sel.text)}</div>${foot}${msg?`<p class="muted tiny" role="status">${esc(msg)}</p>`:''}`;
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
