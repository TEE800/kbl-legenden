// Service Worker der KBL Legenden App: zeigt Push-Nachrichten (vom Tippdienst, tools/tipp-dienst/worker.js) und oeffnet beim Antippen den passenden Reiter.
// Speichert bewusst nichts zwischen (kein fetch-Handler), damit die Seite immer frisch laedt.
self.addEventListener('install',()=>self.skipWaiting());
self.addEventListener('activate',e=>e.waitUntil(self.clients.claim()));
self.addEventListener('push',e=>{
 let d={};try{d=e.data?e.data.json():{};}catch{d={body:e.data?e.data.text():''};}
 e.waitUntil(self.registration.showNotification(d.title||'KBL Legenden',{body:d.body||'',icon:'icons/icon-192.png',badge:'icons/favicon-32.png',tag:d.tag||undefined,renotify:!!d.tag,data:{url:d.url||'./'}}));
});
self.addEventListener('notificationclick',e=>{
 e.notification.close();
 const url=new URL(e.notification.data?.url||'./',self.registration.scope).href;
 e.waitUntil(self.clients.matchAll({type:'window',includeUncontrolled:true}).then(list=>{
  const w=list.find(c=>c.url.startsWith(self.registration.scope));
  if(w)return w.navigate(url).then(c=>(c||w).focus()).catch(()=>w.focus());
  return self.clients.openWindow(url);
 }));
});
