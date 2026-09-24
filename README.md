# MaisDoc

Web-App für Landwirtinnen und Landwirte, die Mais an eine Trocknung liefern:
Wiegeschein bei der Ablieferung fotografieren, Hektar der Fuhre und Feld
eintragen, Trockenmasseertrag je Hektar sehen, Fuhren über die Jahre sammeln.

Eigene Anwendung der BLICKWINKEL FlexCo, kostenlos für die Nutzer, unabhängig von den
Trocknungsanlagen. Online: https://maisdoc.vercel.app (später https://maisdoc.blickwinkel.pro).

**Testbetrieb:** Suchmaschinen sind ausgesperrt (`robots.txt`, `X-Robots-Tag` in `vercel.json`).
Vor dem offiziellen Start beides entfernen.

Erste unterstützte Trocknung: Wiegescheine der Trocknung Reding (Format des Beispiels
100120, Texterkennung in `parseSlip`). Weitere Trocknungen folgen als eigene Leseregeln.

## Aufbau

| Teil | Datei | Aufgabe |
|---|---|---|
| App | `index.html` | Oberfläche, Rechnung, Speicher im Gerät (IndexedDB), Abgleich mit dem Konto |
| Offline | `sw.js`, `manifest.webmanifest`, Icons | installierbar, läuft an der Waage auch ohne Netz |
| Konto | `api/auth.js` | registrieren, anmelden, abmelden, Passwort ändern, Konto löschen |
| Abgleich | `api/sync.js` | Fuhren, Felder, Einstellungen zwischen Geräten |
| Fotos | `api/foto.js` | Wiegeschein-Fotos hoch- und herunterladen (nur eigene) |
| Gemeinsam | `api/_lib.js` | Datenbank, Tabellen (legt sie selbst an), Passwörter, Sitzungen |

Kein Build. Vercel liefert die statischen Dateien aus und macht aus `api/*.js`
Serverfunktionen (Node, Region Frankfurt `fra1`). Einzige Abhängigkeit: `pg`.

Recht und Datenschutz: `impressum.html`, `datenschutz.html` (Stand 24.09.2026).
Schriften (`fonts/`) und Texterkennung (`ocr/`: tesseract.js 5.1.1, Sprachdaten deu
4.0.0_best_int) liegen auf dem eigenen Server, damit beim Öffnen keine Daten an Google
oder CDNs gehen. Die Content-Security-Policy in `vercel.json` erlaubt nur die eigene Adresse.

## Konto und Daten

- Anmeldung mit **E-Mail und Passwort** (scrypt-Hash, Sitzung als HttpOnly-Cookie, 180 Tage).
  Sperre nach 8 Fehlversuchen in 15 Minuten.
- **Ohne Konto** funktioniert alles weiter, nur auf dem Gerät. Beim ersten Anmelden wird
  übernommen, was schon auf dem Gerät liegt.
- **Mit Konto** gleicht die App nach jeder Änderung, beim Öffnen und bei Netz-Rückkehr ab.
  Offline Erfasstes wird nachgereicht. Konflikt: der jüngere Stand gewinnt; Löschungen
  laufen als Grabstein mit, damit sie auf allen Geräten ankommen.
- Fotos liegen in der Datenbank (Tabelle `fotos`), abrufbar nur für das eigene Konto.
- Abmelden: Daten auf dem Gerät behalten oder Gerät leeren. Konto löschen entfernt
  alles auf dem Server.
- **Passwort vergessen:** `DATABASE_URL=… node scripts/passwort-zuruecksetzen.mjs <E-Mail>`
  erzeugt ein Einmal-Passwort und meldet alle Geräte ab. Später: Rücksetzen per E-Mail-Link.

### Einrichtung der Datenbank (einmalig)

Vercel → Projekt `maisdoc` → **Storage** → **Neon (Postgres)** anlegen und mit dem Projekt
verbinden, **Region Frankfurt (aws-eu-central-1)**. Das setzt `DATABASE_URL`. Danach einmal neu veröffentlichen (Deployments →
Redeploy). Die Tabellen legt die App beim ersten Aufruf selbst an. Solange die
Datenbank fehlt, ist der Konto-Knopf ausgeblendet und die App läuft nur im Gerät.

## Rechnung

```
netto      = Wiegung 1 − Wiegung 2            (bzw. „Wareneingang“ vom Schein)
bereinigt  = netto × (1 − Abzug Bruchkorn/Besatz %)  (abschaltbar in Einstellungen)
TM         = bereinigt × (1 − Feuchtigkeit %)
Ware 14 %  = TM ÷ (1 − 14 %)                  (Bezugsfeuchte einstellbar)
je ha      = Wert ÷ Hektar der Fuhre
Feld/Saison: Σ TM ÷ Σ ha (nur Fuhren mit Hektar)
```

Beispiel Wiegeschein 100120 vom 24.09.2026: 43.820 − 15.840 = 27.980 kg,
× 0,994 × 0,753 = 20.943 kg TM. Bei 1,80 ha → **11,63 t TM/ha** (13,53 t/ha bei 14 %).
Der „Abzug“ am Wiegeschein ist **Bruchkorn und Besatz** (Michael, 24.09.2026).

Texterkennung des Fotos: Tesseract.js, lädt erst auf Knopfdruck (20–40 s am Handy).
Liest am Schein 100120 alle 8 Werte; die Werte bleiben editierbar.

## Design

BLICKWINKEL-CI wie `blickwinkel_f200_landing` (`client/src/index.css`): Grün `#6AB43E`,
Text `#4D5249`, Überschriften `#0B1206`, Montserrat (Überschriften, Zahlen, Knöpfe),
Roboto (Text), Radius 6 px. Dunkelmodus in der Palette von Mission Control
(`#070A06`, Grün `#7ED957`). Keine Code-Schrift.

## Entwickeln und testen

```
npm install
DATABASE_URL=postgres://… npm run dev     # http://localhost:3000
BASE=http://localhost:3000 npm test       # 28 API-Prüfungen (Konto, Abgleich, Fotos, Rechte)
```

Bei Änderungen an `index.html` die Cache-Version in `sw.js` hochzählen.

## Datenmodell (schema 1)

```jsonc
// Fuhre (Gerät: Store "lieferungen", Server: Tabelle lieferungen.data)
{ "schema":1, "id":"uuid", "erstellt":"ISO", "geaendert":"ISO", "geloescht":null,
  "kundeNr":"10410", "trocknung":"…", "frucht":"Körnermais",
  "jahr":2026, "datum":"2026-09-24", "waNr":"100120", "kennzeichen":"RI 737 GB",
  "w1":43820, "w2":15840, "netto":27980, "feuchte":24.7, "abzug":0.6,
  "feldId":"uuid", "ha":1.8, "sorte":"", "notiz":"", "hatFoto":true }
// nur im Gerät: "foto" (Blob), "dirty", "fotoDirty"
// Feld
{ "id":"uuid", "name":"Pirath Süd", "flaeche":4.2, "angelegt":"ISO", "geaendert":"ISO" }
// Einstellungen (Server: users.settings)
{ "trocknung":"…", "kundeNr":"10410", "stdFeuchte":14, "abzugAnwenden":true, "geaendert":"ISO" }
```

Abgeleitete Werte (TM, t/ha) werden nie gespeichert, immer gerechnet.

## Nächste Schritte

1. Eigene Domain `maisdoc.blickwinkel.pro` (Vercel → Domains, CNAME beim DNS von blickwinkel.pro).
2. Passwort-Rücksetzen per E-Mail-Link (braucht einen Mail-Dienst, z. B. Resend).
3. Weitere Trocknungen anschließen: je Trocknung eine Leseregel für ihren Wiegeschein; Auswahl der
   Trocknung je Fuhre. Später anonymer Vergleich „mein Ertrag vs. Durchschnitt“ nur mit Zustimmung.
4. Feldgrenzen/Karte, Sorte und Aussaat je Feld, Ertrag je Sorte.
