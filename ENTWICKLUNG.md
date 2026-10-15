# Änderungen während des Fahrens

Alfred fährt mit aoSPIN auf dem Chromebook und schickt Änderungswünsche per Handy an Claude.

## Ablauf für Claude

1. Wunsch umsetzen (app/index.html, app/app.js, ggf. app/sw.js). Bei Unklarheit nur eine kurze Frage stellen.
2. Prüfen: `node --check app/app.js app/sw.js`; bei größeren Änderungen im Browser mit Testmodus und `?speed=60` durchspielen.
3. `VERSION` erhöhen (Patch für Anpassungen, Minor für neue Funktionen) und `CHANGELOG.md` ergänzen.
4. Commit und Push auf `main`.
5. Warten, bis der Workflow „Prüfen und veröffentlichen“ grün ist (`gh run watch`), inklusive Deploy.
6. Erst dann antworten, genau so:
   `Am PC neu laden, am Handy auf „Aktualisieren“ tippen. (Version X.Y.Z, Build N)`
   Build N = Laufnummer des Workflows.
7. Schlägt die Prüfung fehl: alte Version bleibt online; kurz sagen, was los ist. „Zurück“ = vorige Version wiederherstellen (Tag `vX.Y.Z`).

## Regeln

- Farben: ao-Farbwelt (Grund #131419, Flächen #1d1f27, Z1 #00b5a6, Z2 #124f92, Z3 #247d4d, Z4 #f9a73b, Z5 #cc2d3f, Magenta #c2185b, frei #717378). Schrift auf Farbflächen immer mit höchstem Kontrast (Schwarz/Weiß).
- Alle Flächen mit abgerundeten Ecken.
- Ein laufendes Rennen darf durch ein Update nie verloren gehen (Zustand liegt in `aos_race`).
