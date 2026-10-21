// Vorschaumodus: Hinweis fuer Gaeste, dass sie nur ansehen koennen. Ohne Vorschaumodus passiert nichts.
(()=>{
 let bar=null;
 async function check(){
  try{
   const r=await fetch('/api/vorschau',{cache:'no-store'});if(!r.ok)return;
   const v=await r.json();
   // Gäste in der Vorschau sehen keine Admin-Werkzeuge.
   document.documentElement.classList.toggle('kbl-guest',!!v.preview&&!v.admin);
   if(!v.preview){bar?.remove();bar=null;return;}
   if(!bar){bar=document.createElement('div');bar.setAttribute('role','status');
    bar.style.cssText='position:sticky;top:0;z-index:999;padding:6px 12px;text-align:center;font-size:13px;background:#c9a14a;color:#111;font-weight:600';
    document.body.prepend(bar);}
   bar.textContent=v.admin?'Vorschau für die Community läuft · Du bist Admin und kannst ändern':'Vorschau-Version in Entwicklung · Nur ansehen, Änderungen sind gesperrt · Feedback gern an T800';
  }catch{}
 }
 check();setInterval(check,20000);
})();
