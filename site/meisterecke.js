// Meisterecke (Kevin-Wunsch): augenzwinkernder Reiter für Meister, der nichts von KI hält.
// Echte Meilensteine der KI-Geschichte mit Jahr, dazu ausgedachte Meister-Kommentare. Rein statisch, keine Kickbase-Abfragen.
// Feste Regel: Alle Klappbereiche starten zu (kblCollapseView).
(()=>{
 const root=document.querySelector('#meisterContent');if(!root)return;
 const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const GROUPS=[
  {icon:'🧠',title:'Die Anfänge',items:[
   {y:1950,t:'Alan Turing fragt: „Können Maschinen denken?“',d:'Im Aufsatz „Computing Machinery and Intelligence“ schlägt Turing einen Test vor: Merkt ein Mensch im Gespräch nicht, dass er mit einer Maschine schreibt, gilt sie als intelligent. Heute heißt das Turing-Test.',m:'Denken? Mein Taschenrechner denkt auch, er wäre wichtig.'},
   {y:1956,t:'Die KI bekommt ihren Namen',d:'Auf der Dartmouth-Konferenz in den USA treffen sich John McCarthy, Marvin Minsky und andere. Der Begriff „Artificial Intelligence“ (Künstliche Intelligenz) wird damit zum eigenen Forschungsfeld.',m:'Schon der Name: künstlich. Wie Kunstrasen. Mag auch keiner.'},
   {y:1966,t:'ELIZA, der erste Chatbot',d:'Joseph Weizenbaum baut am MIT ein Programm, das wie eine Psychotherapeutin antwortet. Viele Testpersonen erzählen ELIZA erstaunlich offen von ihren Sorgen.',m:'Und wie fühlen Sie sich dabei, Meister?'}
  ]},
  {icon:'♟️',title:'Mensch gegen Maschine',items:[
   {y:1997,t:'Deep Blue schlägt Schachweltmeister Kasparow',d:'IBMs Schachcomputer gewinnt in New York ein ganzes Match über sechs Partien mit 3,5 zu 2,5 gegen Garri Kasparow. Zum ersten Mal verliert ein amtierender Weltmeister so gegen eine Maschine.',m:'Ein Weltmeister verliert gegen KI. Ein Meister nicht. Der spielt einfach nicht mit.'},
   {y:2011,t:'Watson gewinnt bei „Jeopardy!“',d:'IBM Watson schlägt in der US-Quizshow die beiden Rekordchampions Ken Jennings und Brad Rutter, mit Fragen voller Wortspiele und Anspielungen.',m:'Hätte ich auch gewonnen. Wenn ich mitgemacht hätte.'},
   {y:2016,t:'AlphaGo schlägt Lee Sedol',d:'Go galt wegen seiner unzähligen Möglichkeiten als zu schwer für Computer. AlphaGo von Google DeepMind gewinnt in Seoul 4 zu 1 gegen einen der besten Spieler der Welt. Sein „Zug 37“ in Partie 2 verblüfft alle Profis.',m:'Go? Kenn ich nur, wenn der Schiri anpfeift.'},
   {y:2017,t:'AlphaZero bringt sich alles selbst bei',d:'Nur mit den Spielregeln und Partien gegen sich selbst lernt AlphaZero Schach, Shogi und Go und schlägt danach die stärksten Programme, beim Schach etwa Stockfish. Ganz ohne Eröffnungsbuch.',m:'Ohne Trainer, ohne Taktiktafel. Angeber.'},
   {y:2019,t:'Pluribus blufft Poker-Profis aus',d:'Die Poker-KI von der Carnegie Mellon University und Facebook schlägt Profis in Texas Hold’em mit sechs Spielern am Tisch, inklusive Bluffen.',m:'Pokerface hat sie trotzdem keins. Hat ja kein Gesicht.'}
  ]},
  {icon:'🔬',title:'Wissenschaft und Nobelpreise',items:[
   {y:2012,t:'AlexNet lernt Bilder erkennen',d:'Ein neuronales Netz von Alex Krizhevsky, Ilya Sutskever und Geoffrey Hinton gewinnt den Bilderkennungs-Wettbewerb ImageNet mit großem Abstand. Das gilt als Startschuss für den Deep-Learning-Boom.',m:'Erkennt Katzen auf Fotos. Mein Nachbar auch.'},
   {y:2020,t:'AlphaFold knackt die Proteinfaltung',d:'Wie sich ein Eiweiß faltet, war ein rund 50 Jahre altes Rätsel der Biologie. AlphaFold 2 sagt es beim Wettbewerb CASP14 fast so genau voraus wie Laborversuche. Bis 2022 werden Strukturen für über 200 Millionen Proteine frei veröffentlicht.',m:'Eiweiß gibt’s auch im Magerquark. Ganz ohne KI.'},
   {y:2024,t:'Physik-Nobelpreis für neuronale Netze',d:'John Hopfield und Geoffrey Hinton bekommen den Nobelpreis für Physik, für die Grundlagen des maschinellen Lernens mit künstlichen neuronalen Netzen.',m:'Physik? Ich dachte, die KI wäre nur heiße Luft.'},
   {y:2024,t:'Chemie-Nobelpreis für AlphaFold',d:'Einen Tag später geht der Nobelpreis für Chemie an Demis Hassabis und John Jumper (AlphaFold) sowie an David Baker (Proteindesign am Computer).',m:'Zwei Nobelpreise in zwei Tagen? Klingt nach Schiebung.'}
  ]},
  {icon:'🩺',title:'Medizin: KI hilft heilen',items:[
   {y:2018,t:'Erste eigenständige KI-Diagnose zugelassen',d:'Die US-Arzneimittelbehörde FDA lässt IDx-DR zu. Das Programm erkennt auf Fotos der Netzhaut eine diabetische Retinopathie, eine häufige Ursache für Erblindung, ohne dass ein Facharzt das Bild vorher ansehen muss. So können auch Hausarztpraxen früh untersuchen.',m:'Augen auf beim KI-Kauf. Na gut, hier hilft’s.'},
   {y:2020,t:'Ein neues Antibiotikum: Halicin',d:'Forscher am MIT lassen eine KI über 100 Millionen Moleküle durchsuchen. Sie findet Halicin, das im Labor auch gegen Bakterien wirkt, bei denen viele Antibiotika versagen. 2023 folgt mit Abaucin ein weiterer Kandidat gegen einen gefürchteten Krankenhauskeim.',m:'Gegen Bakterien hilft auch Händewaschen. Aber gut, zählt.'},
   {y:2023,t:'Gelähmte Frau spricht wieder',d:'An der Universität von Kalifornien in San Francisco übersetzt eine KI die Hirnsignale einer Frau, die nach einem Schlaganfall nicht mehr sprechen konnte, in Text, Stimme und ein sprechendes Gesicht auf dem Bildschirm, rund 78 Wörter pro Minute.',m:'…'},
   {y:2023,t:'Brustkrebs früher erkennen (Schweden)',d:'In der großen MASAI-Studie in Schweden findet die Mammografie mit KI-Unterstützung rund 20 Prozent mehr Krebsfälle, und die Ärztinnen und Ärzte müssen fast halb so viele Bilder selbst lesen.',m:'Hm. Da sag ich mal nichts.'},
   {y:2025,t:'Brustkrebs früher erkennen (Deutschland)',d:'Die PRAIM-Studie mit über 460.000 Frauen aus dem deutschen Mammografie-Screening zeigt: Mit KI-Hilfe werden 17,6 Prozent mehr Brustkrebsfälle entdeckt, ohne mehr Fehlalarme.',m:'Okay. Das ist richtig gut. Erzählt’s aber keinem.'}
  ]},
  {icon:'🌍',title:'Wetter, Natur und Alltag',items:[
   {y:2017,t:'DeepL aus Köln übersetzt die Welt',d:'Das Kölner Unternehmen DeepL startet seinen Übersetzer mit neuronalen Netzen. Heute übersetzen Millionen Menschen damit Briefe, Arztberichte und Behördenpost in über 30 Sprachen.',m:'Aus Köln? Dann trink ich wenigstens ein Kölsch drauf.'},
   {y:2023,t:'Be My AI: Augen für Blinde',d:'Die App Be My Eyes bekommt eine KI-Funktion: Blinde und sehbehinderte Menschen fotografieren etwas und bekommen beschrieben, was zu sehen ist, etwa ein Etikett, eine Speisekarte oder das Haltbarkeitsdatum.',m:'Da mecker ich nicht. Ehrlich nicht.'},
   {y:2023,t:'GraphCast sagt das Wetter besser voraus',d:'Google DeepMinds Wettermodell berechnet eine 10-Tage-Vorhersage in unter einer Minute und ist bei rund 90 Prozent der geprüften Werte genauer als das beste klassische Modell des Europäischen Wetterzentrums.',m:'Und trotzdem regnet’s immer, wenn ich grille.'},
   {y:2023,t:'2,2 Millionen neue Kristalle',d:'Die KI GNoME schlägt 2,2 Millionen bisher unbekannte Kristallstrukturen vor, davon rund 380.000 stabile. Das sind mögliche Bausteine für bessere Akkus, Solarzellen und Computerchips.',m:'Kristalle hab ich auch. Im Bierglas nach dem Spülen.'},
   {y:2024,t:'Frühwarnung vor Hochwasser',d:'Google stellt im Fachblatt Nature seine KI-Hochwasservorhersage vor. Sie warnt in über 80 Ländern bis zu sieben Tage vorher vor Überschwemmungen, auch dort, wo es kaum Messstationen gibt.',m:'Gut, da bin ich ausnahmsweise mal still.'},
   {y:2024,t:'Verkohlte Schriftrolle aus Pompeji-Zeit gelesen',d:'Beim Vesuvius Challenge lesen Studenten mit KI erstmals Text aus einer Schriftrolle von Herculaneum, die beim Vulkanausbruch im Jahr 79 verkohlte und nie aufgerollt werden konnte. Über 2.000 Buchstaben, ohne die Rolle zu öffnen.',m:'2000 Jahre alt und trotzdem besser lesbar als mein Kickbase-Chat.'}
  ]},
  {icon:'💬',title:'KI für alle',items:[
   {y:2017,t:'„Attention Is All You Need“',d:'Forscher von Google stellen den Transformer vor. Fast alle heutigen Sprach-KIs bauen darauf auf, das „T“ in ChatGPT steht genau dafür.',m:'Attention brauch ich auch, wenn wieder eine neue Sonderregel erklärt wird.'},
   {y:2022,t:'ChatGPT erscheint',d:'Am 30. November 2022 veröffentlicht OpenAI ChatGPT. Nach Schätzungen nutzen es nach rund zwei Monaten schon etwa 100 Millionen Menschen, damals das schnellste Wachstum einer App überhaupt.',m:'100 Millionen Nutzer. Minus einer.'},
   {y:2025,t:'Gold bei der Mathe-Olympiade',d:'KI-Modelle von Google DeepMind und OpenAI lösen bei der Internationalen Mathematik-Olympiade 5 von 6 Aufgaben und erreichen damit Goldmedaillen-Niveau, in normaler Sprache aufgeschrieben und in der Zeit der Schüler.',m:'Rechnen konnte mein Taschenrechner schon 1990.'}
  ]},
  {icon:'⚽',title:'Fußball und diese Liga',items:[
   {y:2024,t:'TacticAI berät den FC Liverpool bei Ecken',d:'Google DeepMind entwickelt mit dem FC Liverpool eine KI für Eckbälle. In einer Studie ziehen Liverpool-Experten die Vorschläge der KI in rund 90 Prozent der Fälle den echten Varianten vor.',m:'Und trotzdem geht nicht jede Ecke rein. Siehste.'},
   {y:2026,t:'Die KBL Legenden App',d:'BumsParade, BumsTabelle, MVP-Tipp mit Wackelköpfen, Arena, Transfers und genau diese Seite: Die ganze Liga-App wurde mit KI (Claude) gebaut. Auch jede Strafe, die Meister je bekommen hat, rechnet ein Programm aus, das eine KI geschrieben hat.',m:'Dann schau ich mir die Tabelle ab jetzt nur noch auf Papier an.',own:true}
  ]}
 ];
 const count=GROUPS.reduce((s,g)=>s+g.items.length,0);
 const years=new Date().getFullYear()-1950;
 const face=window.kblMgrName?window.kblMgrName('Meister'):'Meister';
 root.innerHTML=`
 <div class="me-intro"><p>Lieber ${face},</p>
 <p>wir wissen: Du hältst nichts von KI. Völlig in Ordnung. Darum haben wir hier, ganz neutral und rein informativ, ein paar Kleinigkeiten gesammelt, die KI in den letzten ${years} Jahren so geschafft hat. Ohne Druck. Lies einfach mal rein, wenn gerade kein Spiel läuft.</p></div>
 <div class="me-kpis">
  <div><strong>${years}</strong><small>Jahre seit Turings Frage</small></div>
  <div><strong>2</strong><small>Nobelpreise im Jahr 2024</small></div>
  <div><strong>200 Mio.</strong><small>Proteinstrukturen von AlphaFold</small></div>
  <div class="me-zero"><strong id="meisterCount">0</strong><small>überzeugte Meister</small><button type="button" class="ghost me-btn" id="meisterBtn">Ist Meister jetzt überzeugt?</button><span class="me-answer" id="meisterAnswer" aria-live="polite"></span></div>
 </div>
 <p class="muted tiny">${count} echte Meilensteine der KI-Geschichte. Auf eine Kategorie tippen, um sie aufzuklappen.</p>
 ${GROUPS.map(g=>`<details class="acc-group me-group"><summary><span class="me-ico" aria-hidden="true">${g.icon}</span>${esc(g.title)} <span class="me-sub">${g.items[0].y}–${g.items[g.items.length-1].y} · ${g.items.length} Meilensteine</span></summary><div class="acc-sub me-list">
  ${g.items.map(x=>`<article class="me-card${x.own?' me-own':''}"><span class="me-year">${x.y}</span><div><h4>${esc(x.t)}</h4><p>${esc(x.d)}</p><p class="me-quote"><b>Meister meint:</b> „${esc(x.m)}“</p></div></article>`).join('')}
 </div></details>`).join('')}
 <p class="muted tiny me-note">Alle Meilensteine sind echt. Die Meister-Kommentare sind frei erfunden und liebevoll gemeint. Meister, du bist herzlich eingeladen, uns das Gegenteil zu beweisen.</p>`;
 window.kblFillMgrFaces?.(root);
 const ANSWERS=['Noch nicht.','Immer noch nicht.','Vielleicht nach dem nächsten Spieltag.','Die KI gibt nicht auf.','Auch nicht, wenn du noch zehnmal klickst.','Okay, Meister hat gewonnen. Für heute.'];
 let n=0;
 document.querySelector('#meisterBtn')?.addEventListener('click',()=>{const a=document.querySelector('#meisterAnswer');if(a)a.textContent=ANSWERS[Math.min(n++,ANSWERS.length-1)];});
})();
