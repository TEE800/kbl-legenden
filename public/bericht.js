// Spieltagsbericht auf der Startseite (Kevin-Wunsch): Neuester Bericht, den Claude nach der Abrechnung schreibt
// (tools/spieltagsbericht.mjs auf GitHub, Daten /api/berichte bzw. data/berichte.json). Bereich startet zu (feste Regel),
// die Schlagzeile steht auch eingeklappt in der Überschrift.
(()=>{
 const sec=document.getElementById('bericht');if(!sec)return;
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
   if(/^#\s/.test(line)){flushP();flushL();continue;} // Schlagzeile steht schon in der Überschrift
   if((m=/^#{2,4}\s+(.+)$/.exec(line))){flushP();flushL();out.push(`<h4 class="ber-h">${inline(m[1])}</h4>`);continue;}
   if(/^(-{3,}|\*{3,})$/.test(line)){flushP();flushL();out.push('<hr class="ber-hr">');continue;}
   if((m=/^[-*•]\s+(.+)$/.exec(line))){flushP();if(list?.t!=='ul'){flushL();list={t:'ul',items:[]};}list.items.push(m[1]);continue;}
   if((m=/^\d+[.)]\s+(.+)$/.exec(line))){flushP();if(list?.t!=='ol'){flushL();list={t:'ol',items:[]};}list.items.push(m[1]);continue;}
   flushL();para.push(line);
  }
  flushP();flushL();return out.join('');
 }
 async function load(){
  let d;try{const r=await fetch('/api/berichte',{cache:'no-store'});if(!r.ok)throw 0;d=await r.json();}catch{sec.hidden=true;return;}
  const b=(d.berichte||[]).slice().sort((x,y)=>y.day-x.day)[0];
  if(!b){sec.hidden=true;return;}
  sec.hidden=false;
  document.getElementById('berichtPill').textContent=`ST ${b.day}: ${b.title||''}`;
  document.getElementById('berichtPill').title=b.title||'';
  const when=b.createdAt?new Date(b.createdAt).toLocaleString('de-DE',{dateStyle:'short',timeStyle:'short'}):'';
  document.getElementById('berichtContent').innerHTML=`<h3 class="ber-title">${esc(b.title||`Spieltag ${b.day}`)}</h3><div class="ber-body">${md(b.text)}</div><p class="muted tiny ber-foot">Spieltag ${b.day} · geschrieben von Claude${when?' · '+esc(when):''} · alle Zahlen aus der App</p>`;
 }
 load();
 // Online kommt ein neuer Bericht mit dem nächsten Export; beim Zurückholen der Seite neu laden.
 document.addEventListener('visibilitychange',()=>{if(!document.hidden)load();});
})();
