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
- Jeder Manager wählt seinen Namen, legt beim ersten Tipp seinen eigenen Tipp-Code fest und tippt Spieler und Punkte.
- Bis zum ersten Anpfiff beliebig oft änderbar. Vorher sieht niemand fremde Tipps, auch du nicht.
- Die Tippregel trägst du im Bereich „Tippregel festlegen (nur Admin)“ mit deinem Admin-Code ein.
- Nach dem Anpfiff holt GitHub die Tipps ab (beim nächsten Lauf während der Spiele). Nach dem Spieltag zeigt die Seite den Gewinner-Vorschlag.
- Kosten: keine. Der kostenlose Tarif reicht für die Liga bei Weitem.
