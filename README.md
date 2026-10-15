# aoSPIN

Virtuelle Rennen auf dem Spinningrad – ohne Leistungsdaten, gesteuert über den Puls. Läuft im Chrome-Browser auf dem Chromebook (quer) und bekommt den Puls per Bluetooth direkt von der Amazfit-Uhr (App **Herzfrequenz-Push**).

**App öffnen:** https://walterhansi.github.io/aospin/

## Funktionen

- **Rennen:** 6 Strecken (Flachland, Hügelrunde, Kriterium, Klassiker, Alpenpass, Zeitfahrkurs), Formate „5 Gegner“, „Ghost“ (gegen deine Bestzeit) und „Zeitfahren“.
- **Trainingsziel:** Grundlage, Tempo, Intervalle oder Frei – legt fest, bis zu welchem Puls es Tempo gibt.
- **Widerstand:** Die App sagt die Stellung der Drehschraube an (IST → SOLL, 0 bis 3 Umdrehungen ab Anschlag). Nach dem Drehen „Gedreht“ tippen (oder Eingabetaste). Tipp auf IST korrigiert die Stellung.
- **Kalibrierfahrt** (ca. 30 min): misst deinen Puls auf jeder Stellung bei 80 Umdrehungen pro Minute. Danach wählen die Rennen die Stellungen passend zu dir.
- **Pulszonen** selbst festlegen (Untergrenzen), aus Pulsreserve oder % HFmax berechnen oder aus ao Puls übernehmen.
- **Pulsschutz:** Hinweis bei langer Zeit in Zone 5, Tempoverlust über HFmax, Pause bei fehlendem Puls.
- **Verlauf** mit Ergebnissen und Fitness-Trend der Kalibrierungen; Sichern und Einlesen als Datei.

## Updates

Jede Änderung wird automatisch geprüft und veröffentlicht (GitHub Actions → GitHub Pages). **Neu laden** (Knopf oben oder Strg + R) bringt sofort die neue Version; ein laufendes Rennen geht danach an derselben Stelle weiter. Läuft die App ohne Neuladen weiter, erscheint oben „Neue Version verfügbar – Aktualisieren“. Die Version steht oben in der Kopfzeile.

## Testen ohne Uhr

Einstellungen → „Testmodus ohne Uhr“. Puls per Regler oder Pfeiltasten. Für schnelle Tests lässt `?speed=20` an der Adresse alles 20-mal schneller laufen.

## Aufbau

```
app/                    Die App (wird 1:1 veröffentlicht)
  index.html            Alle Bildschirme und Styles
  app.js                Logik: Puls, Rennen, Gegner, Widerstand, Kalibrierung
  sw.js                 Offline-Betrieb und Updates (zuerst Netz, sonst Speicher)
  manifest.webmanifest  App-Name, Icons, Kennung de.walterhansi.aospin
  icons/                Icon „Schwungrad“
.github/workflows/      Prüfung und Veröffentlichung
VERSION, CHANGELOG.md   Versionsnummer und Änderungen
ENTWICKLUNG.md          Ablauf für Änderungswünsche während des Fahrens
```
