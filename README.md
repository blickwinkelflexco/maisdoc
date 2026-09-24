# Maisertrag Reding – Prototyp

Web-App für Mitglieder der **Trocknungsgenossenschaft Reding eG** (Neuhaus/Inn):
Wiegeschein bei der Maisablieferung fotografieren, Hektar der Fuhre und Feld
eintragen, Trockenmasseertrag je Hektar sehen, Fuhren über die Jahre sammeln.

Eigenständige Anwendung der BLICKWINKEL FlexCo. Entstanden am 24.09.2026 im Repo
`booky` (`apps/maisertrag/`), seitdem hier zu Hause; `booky` ist nicht beteiligt.

## Design

BLICKWINKEL-CI wie `blickwinkel_f200_landing` (`client/src/index.css`): Grün `#6AB43E`,
Text `#4D5249`, Überschriften `#0B1206`, Montserrat (Überschriften, Zahlen, Knöpfe),
Roboto (Text), Radius 6 px. Dunkelmodus in der Palette von Mission Control
(`#070A06`, Grün `#7ED957`). Keine Code-Schrift.

## Betrieb

- Repo `blickwinkelflexco/maisdoc`, Branch `main`. Jeder Push auf `main` geht über das
  Vercel-Projekt `maisdoc` online (Preset „Other“, kein Build, Wurzel `./`).
- Statisch: `index.html`, `manifest.webmanifest`, `sw.js`, Icons, `vercel.json`.
- Installierbar („Zum Home-Bildschirm“), offline an der Waage über den Service Worker.
  Bei Änderungen an `index.html` die Cache-Version in `sw.js` hochzählen.

## Stand (Prototyp 1, 24.09.2026)

- Eine Datei: `index.html`, kein Build, kein Server nötig. Läuft im Handy-Browser.
- **Kein Login.** Daten liegen nur im Browser des Geräts (IndexedDB), inkl. Foto.
- Sicherung als JSON (mit Fotos) und Tabelle als CSV (Excel, `;`, Dezimalkomma).
- Texterkennung des Fotos (Tesseract.js, lädt nur auf Knopfdruck, ca. 20–40 s). Liest am
  Schein 100120 alle 8 Werte (Datum, Wa.-Nr., Wiegungen, Netto, Feuchte, Abzug, Kennzeichen). Werte bleiben
  editierbar; wo die Bibliothek nicht laden darf, werden die Werte abgetippt.

## Ansichten

| Reiter | Inhalt |
|---|---|
| Erfassen | Foto, Felder wie am Wiegeschein (Datum, Wa.-Nr., Wiegung 1/2, Wareneingang, Feuchtigkeit, Abzug, Kennzeichen), Feld, **Hektar dieser Fuhre**, Sorte, Notiz; Ergebnis live |
| Verlauf | Zeitleiste je Erntejahr mit Saisonsumme (Ø t TM/ha, t TM, ha, Fuhren, Ø Feuchte); Tipp öffnet Details mit Foto, Bearbeiten, Löschen |
| Felder | Ertrag je Feld über alle Erntejahre inkl. Veränderung zum Vorjahr; Felder anlegen; Einstellungen; Sichern/Einlesen |

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

Der „Abzug“ am Wiegeschein ist **Bruchkorn und Besatz** (Michael, 24.09.2026) und
wird deshalb vor der Trockenmasse vom Nettogewicht abgezogen.

## Datenmodell (schema 1)

```jsonc
// Store "lieferungen"
{ "schema":1, "id":"uuid", "erstellt":"ISO", "geaendert":"ISO",
  "kundeNr":"10410", "genossenschaft":"Trocknungsgenossenschaft Reding eG", "frucht":"Körnermais",
  "jahr":2026, "datum":"2026-09-24", "waNr":"100120", "kennzeichen":"RI 737 GB",
  "w1":43820, "w2":15840, "netto":27980, "feuchte":24.7, "abzug":0.6,
  "feldId":"uuid", "ha":1.8, "sorte":"", "notiz":"", "foto":Blob|null }
// Store "felder"
{ "id":"uuid", "name":"Pirath Süd", "flaeche":4.2, "angelegt":"ISO" }
// Store "meta" → "settings"
{ "kundeNr":"10410", "stdFeuchte":14, "abzugAnwenden":true }
```

Abgeleitete Werte (TM, t/ha) werden nie gespeichert, immer gerechnet – so bleibt
eine geänderte Rechenregel rückwirkend richtig.

## Nächste Schritte

1. Eigene Domain (z. B. maisdoc.blickwinkel.pro) als CNAME auf Vercel.
2. **Login** (Mehrjahres-Monitoring, Gerätewechsel): Anmeldung per E-Mail-Link oder
   Telefonnummer, Konto an `kundeNr` der Genossenschaft gebunden. Server-Datenbank
   (z. B. Supabase/Postgres) mit Zeilen-Rechten je Mitglied; Fotos in Objektspeicher.
   Beim ersten Login werden die lokalen Fuhren hochgeladen (`id` bleibt, daher kein Doppel).
3. **Texterkennung** serverseitig oder per KI-Bildauslese statt Tesseract im Browser.
4. **Genossenschaft**: optional Abgleich mit den Wiegedaten der Reding eG (Export
   je Kunde), dann entfällt das Abtippen; anonymisierter Vergleich „mein Ertrag vs.
   Durchschnitt der Mitglieder“ nur mit Zustimmung.
5. Feldgrenzen/Karte, Sorte und Aussaat je Feld, Ertrag je Sorte.
