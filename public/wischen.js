// Wischen zwischen den Reitern (Kevin-Wunsch 31.10.): Nur am Handy (wenn die untere Navigation .mobilenav sichtbar ist).
// Nach links wischen = nächster Reiter, nach rechts = vorheriger. Reihenfolge wie unten in der Navigation:
// Übersicht, BumsTabelle, Profile, dann die Reiter unter „Mehr“ von oben nach unten. Ausgeblendete Reiter (Admin für Gäste) werden übersprungen.
// Kein Wischen in waagerecht scrollbaren Bereichen (Tabellen, Schieberegler, Rennen …), in Eingabefeldern, Fenstern und im Vollbild.
(function(){
 const nav=document.querySelector('.mobilenav');if(!nav)return;
 const SKIP='input,textarea,[contenteditable],canvas,video,.push-modal,.zer,.zer-akte,.zr-full,[role="dialog"],.zr,.mobilemore,.mobilenav,.kbl-no-swipe';
 const order=()=>[...document.querySelectorAll('.mobilenav a[data-kbl-nav], #mobileMore a[data-kbl-nav]')]
  .filter((a,i,arr)=>arr.findIndex(b=>b.dataset.kblNav===a.dataset.kblNav)===i);
 const visibleTab=a=>!(a.dataset.kblNav==='admin'&&document.documentElement.matches('.kbl-guest,.kbl-no-admin'));
 // Liegt der Finger in einem Bereich, der sich waagerecht scrollen lässt? Dann gehört die Geste dem Bereich.
 function scrollsX(el){
  for(let n=el;n&&n!==document.body&&n.nodeType===1;n=n.parentElement){
   if(n.scrollWidth>n.clientWidth+2){const o=getComputedStyle(n).overflowX;if(o==='auto'||o==='scroll')return true;}
  }
  return false;
 }
 let s=null;
 document.addEventListener('touchstart',e=>{
  s=null;
  if(e.touches.length!==1||getComputedStyle(nav).display==='none'||document.fullscreenElement||document.body.classList.contains('zr-on'))return;
  if(window.visualViewport&&visualViewport.scale>1.05)return; // hineingezoomt: Wischen verschiebt den Ausschnitt
  const t=e.touches[0],el=e.target;
  if(t.clientX<24||t.clientX>innerWidth-24)return; // Randgeste des Handys (Zurück) nicht abfangen
  if(el.closest?.(SKIP)||el.closest?.('input[type=range]')||scrollsX(el))return;
  s={x:t.clientX,y:t.clientY,at:Date.now(),scrollX:scrollX};
 },{passive:true});
 document.addEventListener('touchcancel',()=>{s=null;},{passive:true});
 document.addEventListener('touchend',e=>{
  if(!s)return;const st=s;s=null;
  const t=e.changedTouches[0];const dx=t.clientX-st.x,dy=t.clientY-st.y;
  if(Date.now()-st.at>700||Math.abs(dx)<70||Math.abs(dx)<Math.abs(dy)*2||Math.abs(scrollX-st.scrollX)>4)return;
  if(String(getSelection?.()||'').length)return; // Text wurde markiert
  const tabs=order().filter(visibleTab);
  const cur=tabs.findIndex(a=>document.querySelector(`.kbl-view.kbl-current[data-view="${a.dataset.kblNav}"]`));
  if(cur<0)return;
  const next=tabs[cur+(dx<0?1:-1)];if(!next)return;
  next.click();
  const view=document.querySelector('.kbl-view.kbl-current');
  if(view){view.classList.remove('kbl-swipe-l','kbl-swipe-r');void view.offsetWidth;view.classList.add(dx<0?'kbl-swipe-l':'kbl-swipe-r');}
 },{passive:true});
 document.addEventListener('animationend',e=>{if(e.target.classList?.contains('kbl-view'))e.target.classList.remove('kbl-swipe-l','kbl-swipe-r');});
})();
