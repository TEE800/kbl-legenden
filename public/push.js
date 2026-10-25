// Push-Nachrichten (Kevin-Wunsch): Glocke oben in der Kopfzeile, einmaliger Hinweis unter der Kopfzeile.
// Nur auf der Online-Seite mit Tippdienst (window.KBL_TIPP_API): Der Dienst speichert die Abos und verschickt die Nachrichten
// (tools/tipp-dienst/worker.js, pushTick). Jeder waehlt seinen Manager und welche Nachrichten er will. sw.js zeigt sie an.
(()=>{
 const API=window.KBL_STATIC?String(window.KBL_TIPP_API||'').replace(/\/+$/,''):'';
 if(!API)return;
 const LS='kbl-push',HINT='kbl-push-hint';
 const ls={get(k){try{return JSON.parse(localStorage.getItem(k)||'null');}catch{return null;}},set(k,v){try{localStorage.setItem(k,JSON.stringify(v));}catch{}}};
 const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const ios=/iPad|iPhone|iPod/.test(navigator.userAgent)||(navigator.platform==='MacIntel'&&navigator.maxTouchPoints>1);
 const standalone=navigator.standalone===true||matchMedia('(display-mode: standalone)').matches;
 const supported='serviceWorker' in navigator&&'PushManager' in window&&'Notification' in window;
 const PREFS=[['bums','💥 Du wurdest gebumst','Nach Spielende, je Spiel gebündelt, je Spieler nur einmal. Nach der Abrechnung einmal alle Aufgaben des Spieltags.'],
  ['tipp','⏰ Tippschluss in 1 Stunde','Nur wenn du für den Spieltag noch keinen MVP-Tipp hast.'],
  ['mvp','🎯 Dein MVP-Tipp ist fertig','Sobald das Spiel deines getippten Spielers vorbei ist, mit seinen Punkten.']];
 const call=async(path,body)=>{const r=await fetch(API+path,body?{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}:{});const d=await r.json().catch(()=>({}));if(!r.ok)throw new Error(d.error||`Fehler ${r.status}`);return d;};
 const keyBytes=s=>Uint8Array.from(atob(s.replace(/-/g,'+').replace(/_/g,'/')+'==='.slice((s.length+3)%4)),c=>c.charCodeAt(0));
 const sameKey=(sub,pub)=>{try{const a=new Uint8Array(sub.options.applicationServerKey),b=keyBytes(pub);return a.length===b.length&&a.every((x,i)=>x===b[i]);}catch{return true;}};
 let reg=null,info=null;
 const swReady=supported?navigator.serviceWorker.register('sw.js').then(r=>(reg=r)).catch(()=>null):Promise.resolve(null);
 const currentSub=async()=>{const r=await swReady;return r?r.pushManager.getSubscription():null;};

 // Glocke in der Kopfzeile
 const bar=document.querySelector('.topbar');
 if(!bar)return;
 const bell=document.createElement('button');
 bell.type='button';bell.className='push-bell';bell.title='Push-Nachrichten';bell.setAttribute('aria-label','Push-Nachrichten');
 bell.innerHTML='<svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9M13.73 21a2 2 0 0 1-3.46 0"/></svg><i class="push-dot" hidden></i>';
 bar.insertBefore(bell,document.getElementById('status'));
 const setBell=on=>{bell.classList.toggle('on',!!on);bell.querySelector('.push-dot').hidden=!on;bell.title=on?'Push-Nachrichten sind an':'Push-Nachrichten einschalten';};
 currentSub().then(s=>{setBell(!!s&&!!ls.get(LS));showHint(!s);}).catch(()=>showHint(true));

 // Einmaliger Hinweis unter der Kopfzeile (bis eingeschaltet oder weggeklickt)
 function showHint(notOn){
  if(!notOn||ls.get(HINT))return;
  const h=document.createElement('div');h.className='push-hint';
  h.innerHTML='<span><b>Neu:</b> Push-Nachrichten, wenn du gebumst wirst, der Tippschluss naht oder dein MVP-Tipp fertig ist.</span><button type="button" class="gold" data-p="open">Einschalten</button><button type="button" class="push-x" data-p="close" aria-label="Hinweis schließen">✕</button>';
  bar.after(h);
  h.addEventListener('click',e=>{const b=e.target.closest('[data-p]');if(!b)return;ls.set(HINT,1);h.remove();if(b.dataset.p==='open')open();});
 }

 // Fenster
 const modal=document.createElement('div');modal.className='push-modal';modal.hidden=true;
 modal.innerHTML='<div class="push-box" role="dialog" aria-modal="true" aria-labelledby="pushTitle"><div class="push-head"><h3 id="pushTitle">🔔 Push-Nachrichten</h3><button type="button" class="push-x" data-p="close" aria-label="Schließen">✕</button></div><div id="pushBody"></div></div>';
 document.body.append(modal);
 const body=modal.querySelector('#pushBody');
 const close=()=>{modal.hidden=true;document.removeEventListener('keydown',onKey);};
 const onKey=e=>{if(e.key==='Escape')close();};
 modal.addEventListener('click',e=>{if(e.target===modal||e.target.closest('[data-p="close"]'))close();});
 bell.addEventListener('click',open);
 const msg=(t,cls='')=>{const m=body.querySelector('#pushMsg');if(m){m.className='push-msg '+cls;m.textContent=t;}};

 async function open(){
  modal.hidden=false;document.addEventListener('keydown',onKey);
  if(!supported){
   body.innerHTML=ios&&!standalone?`<p>Auf dem iPhone gehen Push-Nachrichten nur, wenn die Seite auf dem Home-Bildschirm liegt:</p><ol class="push-steps"><li>Unten in Safari auf <b>Teilen</b> tippen (Viereck mit Pfeil nach oben).</li><li><b>„Zum Home-Bildschirm“</b> wählen und <b>Hinzufügen</b>.</li><li>Die App <b>KBL Legenden</b> vom Home-Bildschirm öffnen.</li><li>Dort oben noch mal auf die 🔔 tippen und einschalten.</li></ol><p class="muted tiny">Geht ab iOS 16.4.</p>`
    :'<p>Dieser Browser kann leider keine Push-Nachrichten. Am Handy geht es mit Chrome (Android) oder über den Home-Bildschirm (iPhone).</p>';
   return;
  }
  if(Notification.permission==='denied'){body.innerHTML='<p>Mitteilungen sind für diese Seite blockiert. Bitte in den Einstellungen des Browsers (bzw. am iPhone unter Einstellungen → Mitteilungen → KBL Legenden) wieder erlauben und dann hier einschalten.</p>';return;}
  body.innerHTML='<p class="muted">Wird geladen …</p>';
  try{info=info||await call('/push/info');}catch(e){body.innerHTML=`<p class="error">Push-Dienst nicht erreichbar: ${esc(e.message)}</p>`;return;}
  const sub=await currentSub(),saved=ls.get(LS),on=!!sub&&!!saved;
  const prefs=saved?.prefs||{bums:1,tipp:1,mvp:1};
  body.innerHTML=`<p class="muted">${on?'Push ist auf diesem Gerät an. Du kannst die Auswahl hier ändern.':'Du bekommst eine Nachricht auf dieses Gerät, wenn etwas passiert. Jedes Gerät wird einzeln eingeschaltet.'}</p>
   <label class="acc-label push-who">Ich bin <select id="pushManager"><option value="">Manager wählen …</option>${info.managers.map(m=>`<option value="${esc(m.id)}"${String(saved?.managerId)===m.id?' selected':''}>${esc(m.name)}</option>`).join('')}</select></label>
   <div class="push-prefs">${PREFS.map(([k,t,d])=>`<label class="push-pref"><input type="checkbox" data-pref="${k}"${prefs[k]?' checked':''}><span><b>${t}</b><small>${d}</small></span></label>`).join('')}</div>
   <div class="push-actions"><button type="button" class="gold" id="pushSave">${on?'Speichern':'Einschalten'}</button>${on?'<button type="button" class="ghost" id="pushTest">Test-Nachricht</button><button type="button" class="ghost" id="pushOff">Ausschalten</button>':''}</div>
   <p id="pushMsg" class="push-msg" role="status"></p>`;
  body.querySelector('#pushSave').onclick=save;
  body.querySelector('#pushTest')?.addEventListener('click',test);
  body.querySelector('#pushOff')?.addEventListener('click',off);
 }
 async function save(){
  const managerId=body.querySelector('#pushManager').value;
  const prefs={};body.querySelectorAll('[data-pref]').forEach(c=>{if(c.checked)prefs[c.dataset.pref]=1;});
  if(!managerId)return msg('Bitte zuerst deinen Namen wählen.','error');
  if(!Object.keys(prefs).length)return msg('Bitte mindestens eine Nachricht anhaken oder „Ausschalten“ nehmen.','error');
  const btn=body.querySelector('#pushSave');btn.disabled=true;msg('Einen Moment …');
  try{
   // Erlaubnis zuerst und direkt nach dem Tippen fragen (iPhone verlangt das).
   if(Notification.permission!=='granted'&&await Notification.requestPermission()!=='granted')throw new Error('Mitteilungen wurden nicht erlaubt.');
   const r=await swReady;if(!r)throw new Error('Service Worker nicht startbar.');
   let sub=await r.pushManager.getSubscription();
   if(sub&&!sameKey(sub,info.publicKey)){await sub.unsubscribe().catch(()=>{});sub=null;}
   sub=sub||await r.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:keyBytes(info.publicKey)});
   await call('/push/subscribe',{subscription:sub.toJSON(),managerId,prefs});
   ls.set(LS,{managerId,prefs});ls.set(HINT,1);document.querySelector('.push-hint')?.remove();setBell(true);
   await open();msg('Gespeichert. Tippe auf „Test-Nachricht“, um es auszuprobieren.','ok');
  }catch(e){msg(e.message||'Das hat nicht geklappt.','error');btn.disabled=false;}
 }
 async function test(){
  try{const s=await currentSub();if(!s)throw new Error('Auf diesem Gerät ist Push nicht an.');await call('/push/test',{endpoint:s.endpoint});msg('Test-Nachricht geschickt. Sie kommt in wenigen Sekunden.','ok');}
  catch(e){msg(e.message,'error');}
 }
 async function off(){
  try{const s=await currentSub();if(s){await call('/push/unsubscribe',{endpoint:s.endpoint}).catch(()=>{});await s.unsubscribe();}
   try{localStorage.removeItem(LS);}catch{}setBell(false);await open();msg('Push ist auf diesem Gerät aus.','ok');}
  catch(e){msg(e.message,'error');}
 }
})();
