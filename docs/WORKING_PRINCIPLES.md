# Arbeitsprinzipien fuer Vectorcraft

> Adaptiert von pixelcraft + SVG_Grafik_Projekt Working Principles.
>
> **An jedes LLM das in dieser Codebase arbeitet:** lies das hier zuerst,
> dann INDEX.md, dann der Rest. Diese Regeln sind nicht verhandelbar.

---

## 1. Zero Dependencies ist kein Kompromiss

Vectorcraft nutzt NUR Python stdlib (xml.etree, re, math, json).
Keine einzige externe Dependency. Das ist kein Ziel das wir anstreben,
das ist eine harte Grenze. Wenn etwas nicht mit stdlib geht,
brauchen wir es nicht oder es gehoert in ein anderes Tool.

**Warum:** Dependencies sind der #1 Grund fuer Installation-Fehler,
Security-Issues und Wartungsaufwand. pixelcraft braucht PIL+numpy+cairosvg.
Vectorcraft braucht nichts.

## 2. XML ist die Wahrheit

Wir parsen was in der SVG steht, nicht was ein Browser daraus macht.
- `fill="#ff0000"` → die Farbe ist rot
- `transform="rotate(45)"` → das Element ist 45 Grad gedreht
- `<animate dur="2s">` → die Animation dauert 2 Sekunden

Wir raten NICHT, rendern NICHT, interpolieren NICHT.
Wenn die Information nicht im XML steht, sagen wir "unknown".

## 3. JSON Output ist Pflicht

Jeder Command gibt JSON auf stdout aus. Kein Pretty-Print, keine
Tabellen, keine Farben im Terminal. JSON und nur JSON.

**Warum:** Der Primaer-Nutzer ist ein LLM-Agent, kein Mensch.
Ein LLM parst JSON nativ. Alles andere kostet Tokens.

## 4. Jedes Modul hat eine Aufgabe

- parser.py parst XML. Sonst nichts.
- geometry.py berechnet BBoxen. Sonst nichts.
- color.py sammelt Farben. Sonst nichts.

Kein Modul importiert ein anderes Analyzer-Modul.
Alle Analyzer bekommen ein SVGDocument und geben ein dict zurueck.
cli.py kombiniert die Ergebnisse.

## 5. Tests zuerst, Code danach

Fuer jeden Analyzer:
1. Test-SVG schreiben (bekannte Struktur)
2. Erwartetes JSON definieren
3. Code schreiben bis Test gruen
4. Edge Cases ergaenzen

Kein Code ohne Test. Kein Test ohne erwartetes Ergebnis.

## 6. Token-Effizienz ist Designziel

Output so kompakt wie moeglich, aber so detailliert wie noetig.
- `vc inspect`: ~120 Tokens (Komplett-Ueberblick)
- `vc bbox`: ~60 Tokens (Geometrie-Detail)
- `vc colors`: ~80 Tokens (Farb-Detail)

Zum Vergleich: Die SVG-Datei selbst lesen kostet ~441 Tokens im Durchschnitt.
Vectorcraft spart also Tokens UND liefert strukturierte Daten.

## 7. Ehrlichkeit ueber Perfektion

Wenn geometry.py eine Transform-Chain nicht parsen kann (z.B. matrix()),
gibt es `"computed_bbox": null, "reason": "unsupported transform: matrix()"`.

Kein Raten, kein Silent-Fail, keine falschen Zahlen.

## 8. Stabile Punkte einfrieren

Wenn ein Analyzer funktioniert und getestet ist: Git-Tag, nicht anfassen.
Weiterentwicklung passiert in neuen Analyzern, nicht durch Umbau
funktionierender Module.

## 9. Kompatibilitaet mit pixelcraft

Vectorcraft ersetzt pixelcraft nicht. Die beiden ergaenzen sich:
- Vectorcraft: Struktur, Deklaration, Mathematik (~90%)
- pixelcraft: Rendering, visuelle Verifikation (~10%)

Wo immer moeglich, nutzen wir die gleichen JSON-Schluessel
damit ein LLM die Outputs vergleichen kann.

## 10. Progressive Komplexitaet

Analyzer-Reihenfolge: structure → geometry → color → animation → a11y → text → symmetry → repetition → diff.

Jeder Analyzer baut auf parser.py auf, nicht aufeinander.
Aber die Reihenfolge spiegelt steigende Komplexitaet wider.

---

## Was diese Regeln NICHT bedeuten

Sie verbieten nicht zu experimentieren. `tools/` und `examples/`
sind frei. Aber `src/vectorcrawler/` folgt diesen Regeln. Immer.

---
*Original-Formulierung: 2026-04-10, Nexus (Opus 4.6)*
