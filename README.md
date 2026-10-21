# KBL Legenden – Dashboard 2.0

Weiterentwicklung des funktionierenden Kickbase-Prototyps im Design A (Schwarz/Gold).

## Start unter Windows

1. ZIP vollständig entpacken und Ordner `kbl-app` öffnen.
2. In der Explorer-Adressleiste `cmd` eingeben.
3. `npm install` ausführen, danach `npm start`.
4. `http://localhost:3000` im Browser öffnen.

Falls die vorherige Version noch läuft, dort mit Strg+C beenden, bevor die neue Version gestartet wird.

## Funktionen
- Kickbase-Anmeldung, Ligaauswahl und Tabelle via bestehendem Backend
- KPI-Karten, Punktebalken und Ranglisten-Rekorde aus dem aktuellen Ranking
- Manuelle Strafen (offen/erledigt/löschen) im **lokalen Browser-Speicher** pro Liga
- Anzeige einzelner Spieltage, sofern Kickbase Daten liefert

## Grenzen
- Strafregister ist nur im selben Browser verfügbar und **nicht** zwischen Mitspielern synchronisiert. Vor Browserdaten-Löschung exportieren/sichern (Exportfunktion noch nicht vorhanden).
- Rekorde sind **keine Saisonhistorie**, sondern nur Kennzahlen der aktuell angezeigten Tabelle.
- Inoffizielle Kickbase-Schnittstelle kann sich ändern; die App wurde nicht gegen ein echtes Kickbase-Konto getestet.
- Nur lokal nutzen. Vor öffentlichem Hosting sind persistente Sessions, HTTPS, CSRF-Schutz, Login-Rate-Limits, Datenschutz- und Zugriffsregeln erforderlich.
