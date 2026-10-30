# MVP-Tipp: Online-Tippdienst einrichten (einmalig, ca. 15 Minuten)

Die Online-Seite auf GitHub kann nur anzeigen. Die Tipps nimmt ein kleiner kostenloser Dienst bei Cloudflare an.
Er hält sie bis zum Anpfiff verdeckt. Danach holt GitHub sie automatisch ab, und die Seite zeigt sie an und wertet sie aus.

Du brauchst nur einen Browser. Programmieren musst du nichts, nur einmal Text kopieren und einfügen.

## 1. Cloudflare-Konto anlegen
1. Öffne https://dash.cloudflare.com/sign-up und registriere dich mit E-Mail und Passwort (kostenlos, keine Kreditkarte).
2. Bestätige die E-Mail.

## 2. Speicher für die Tipps anlegen
1. Im Cloudflare-Dashboard links auf **Storage & Databases** → **Workers KV** (oder „KV“).
2. **Create instance** (oder „Create namespace“) anklicken.
3. Name: `kbl-tipps` → **Create**.

## 3. Den Dienst anlegen
1. Links auf **Compute (Workers)** → **Workers & Pages** → **Create**.
2. **Start with Hello World!** wählen, Name: `kbl-tipps` → **Deploy**.
3. Danach **Edit code** anklicken. Links steht eine Datei `worker.js` mit etwas Beispieltext.
4. Den ganzen Beispieltext löschen (Strg+A, Entf).
5. Diese Seite öffnen und den gesamten Text kopieren (Strg+A, Strg+C):
   https://raw.githubusercontent.com/TEE800/kbl-legenden/main/tools/tipp-dienst/worker.js
6. Im Cloudflare-Editor einfügen (Strg+V) und oben rechts auf **Deploy** klicken.

## 4. Einstellungen des Dienstes
Im Dienst `kbl-tipps` auf **Settings** (Einstellungen):
1. **Bindings** → **Add binding** → **KV namespace**:
   - Variable name: `TIPPS`
   - KV namespace: `kbl-tipps`
   - Speichern.
2. **Variables and Secrets** → **Add**:
   - Type **Text**, Name `SITE_URL`, Wert `https://tee800.github.io/kbl-legenden`
   - Speichern.
3. Nochmal **Add**:
   - Type **Secret**, Name `ADMIN_CODE`, Wert: ein eigener Admin-Code nur für dich (8 oder mehr Zeichen). Damit legst du auf der Seite die Tippregel fest und setzt vergessene Tipp-Codes zurück. Nicht weitergeben.
   - Speichern bzw. **Deploy**.

## 5. Adresse kopieren und testen
1. Oben im Dienst steht die Adresse, z. B. `https://kbl-tipps.DEINNAME.workers.dev`. Kopieren.
2. Im Browser öffnen: `https://kbl-tipps.DEINNAME.workers.dev/status`
   Dort sollte `{"ok":true,"dienst":"KBL Legenden MVP-Tipp"}` stehen.

## 6. Adresse bei GitHub eintragen
1. Öffne https://github.com/TEE800/kbl-legenden/settings/variables/actions
2. Reiter **Variables** → **New repository variable**:
   - Name: `KBL_TIPP_DIENST`
   - Value: die Adresse aus Schritt 5 (ohne `/status` am Ende)
   - **Add variable**.

## 7. Seite neu bauen
Unter https://github.com/TEE800/kbl-legenden/actions/workflows/seite.yml auf **Run workflow** klicken.
Nach ein paar Minuten können alle Manager im Reiter „MVP-Tipp“ tippen.

## So läuft es danach
- Jeder Manager wählt seinen Namen, legt beim ersten Tipp jedes Spieltags einen eigenen Tipp-Code fest (gilt nur für diesen Spieltag) und tippt Spieler und Punkte.
- Bis zum ersten Anpfiff beliebig oft änderbar. Vorher sieht niemand fremde Tipps, auch du nicht.
- Die Tippregel trägst du im Bereich „Tippregel festlegen (nur Admin)“ mit deinem Admin-Code ein.
- Nach dem Anpfiff holt GitHub die Tipps ab (beim nächsten Lauf während der Spiele). Nach dem Spieltag zeigt die Seite den Gewinner-Vorschlag.
- Kosten: keine. Der kostenlose Tarif reicht für die Liga bei Weitem.

## Später: Änderungen am Tippdienst automatisch einspielen (einmalig, ca. 5 Minuten)
Ohne diesen Schritt muss `worker.js` nach einer Änderung von Hand neu in den Cloudflare-Editor kopiert werden.
1. Im Cloudflare-Dashboard oben rechts auf das Personen-Symbol → **Profile** → **API Tokens** → **Create Token**.
2. Bei **Edit Cloudflare Workers** auf **Use template** klicken.
3. Unten **Continue to summary** → **Create Token**. Den angezeigten Schlüssel kopieren (er wird nur einmal gezeigt).
4. Deine **Account ID**: im Dashboard links auf **Workers & Pages**, rechts steht „Account ID“ → kopieren.
5. Öffne https://github.com/TEE800/kbl-legenden/settings/secrets/actions → **New repository secret**:
   - Name `CLOUDFLARE_API_TOKEN`, Wert: der Schlüssel aus Schritt 3
   - Nochmal: Name `CLOUDFLARE_ACCOUNT_ID`, Wert: die Account ID aus Schritt 4
Ab dann spielt GitHub jede Änderung am Tippdienst selbst ein.

## Push-Nachrichten einschalten (einmalig, ca. 5 Minuten)
Der Tippdienst verschickt auch die Push-Nachrichten (gebumst, Tippschluss in 1 Stunde, MVP-Tipp fertig).
Die nötigen Schlüssel erzeugt er beim ersten Mal selbst, ein Geheimnis musst du nicht anlegen.
1. Neuen Code einspielen: wie in Schritt 3 den ganzen Text von
   https://raw.githubusercontent.com/TEE800/kbl-legenden/main/tools/tipp-dienst/worker.js
   in den Cloudflare-Editor kopieren und **Deploy** klicken
   (entfällt, wenn GitHub das schon automatisch macht, siehe unten).
2. Im Dienst `kbl-tipps` auf **Settings** → **Trigger Events** (oder „Triggers“) → **Add** → **Cron Triggers**.
3. Bei „Cron“ eintragen: `*/5 * * * *` (heißt: alle 5 Minuten) → **Add** bzw. **Save**.
   Mit dem automatischen Einspielen (unten) steht das schon in `wrangler.toml` und wird mit eingespielt.
4. Fertig. Jeder Manager schaltet Push auf der Online-Seite selbst ein: oben auf die 🔔 tippen.
   iPhone: nur, wenn die Seite auf dem Home-Bildschirm liegt (die Glocke erklärt das).

## Nutzung der App zählen (einmalig, ca. 5 Minuten)
Der Tippdienst zählt, wie oft die Online-Seite geöffnet wird, welche Reiter beliebt sind und welcher Manager sie nutzt.
Keine IP-Adressen, keine Namen: Jedes Gerät bekommt nur eine Zufallsnummer. Ein Manager wird erkannt, wenn er auf seinem Gerät bei der 🔔 oder im MVP-Tipp seinen Namen gewählt hat.
Die Zahlen sieht nur, wer den Admin-Code kennt.
1. Neuen Code einspielen: den ganzen Text von
   https://raw.githubusercontent.com/TEE800/kbl-legenden/main/tools/tipp-dienst/worker.js
   in den Cloudflare-Editor des Dienstes `kbl-tipps` kopieren (alten Text vorher löschen) und **Deploy** klicken.
2. Datenbank anlegen: im Cloudflare-Dashboard links **Storage & Databases** → **D1 SQL Database** → **Create** (oder „Create database“).
   Name: `kbl-nutzung` → **Create**. Sonst nichts eintragen, die Tabelle legt der Dienst selbst an.
3. Verbinden: links **Compute (Workers)** → **Workers & Pages** → `kbl-tipps` → **Settings** → **Bindings** → **Add binding** → **D1 database**:
   - Variable name: `NUTZUNG`
   - D1 database: `kbl-nutzung`
   - **Add binding** bzw. **Deploy**.
4. Fertig. Ab jetzt zählt die Seite mit.

Ansehen: Auf der Online-Seite **5× schnell auf das Clown-Logo** tippen (am Handy oben links, am PC links über dem Menü).
Es öffnet sich ein Fenster, dort den Admin-Code eingeben. Ganz unten kannst du „Dieses Gerät nicht mitzählen“ anhaken,
damit deine eigenen Besuche die Zahlen nicht aufblähen (je Gerät einmal).
