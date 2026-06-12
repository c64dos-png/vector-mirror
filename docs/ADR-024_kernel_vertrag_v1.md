# ADR-024: Kernel-Vertrag v1 fuer Vector Mirror
<!-- BEACON:ROOT | TYPE:ADR | NAVIGATION:START_HERE.md→BAUPLAN→hier -->

```text
STATUS: accepted
DATUM:  2026-04-17
TAGS:   [ADR] [ARCH] [SVG] [SPOTTER] [ARRANGE]
SCOPE:  Verlaesslicher Kernvertrag fuer Analyze/Compare/Inspect/Palette/Arrange
```

## Kontext

Der reparierte Codezustand ist stabil genug fuer einen expliziten Kernel-Vertrag, aber der
Planungsstand der Phase-3-Doku ist breiter als der heute wirklich belastbare Scope.
Fuer LLM-Nutzung ist das kritisch: Vertrauen darf sich nur auf Verhalten stuetzen, das
im Code und in den Vertrauensankern abgesichert ist.

## Entscheidung

Vector Mirror `Kernel-Vertrag v1` ist der heute garantierte Minimalvertrag:

1. Renderer-Wahrheit ist bindend.
   Analyse basiert auf Playwright-Rendering, `getBBox()` und `getCTM()`-Projektion.
   Verwendet wird die sichtbare Renderer-Geometrie, nicht die Quelltext-Intuition.

2. Grid-Semantik ist eine kompakte Sekundaersicht.
   Elemente werden auf ein dynamisches Raster von `4x4` bis `16x16` mit Zielgroesse
   von etwa `50px` pro Zelle gemappt. Zellwechsel unterliegen 10%-Hysterese.

3. Spotter-Deltas sind der normative Korrekturkanal.
   Constraint-Verletzungen liefern numerische `dx`, `dy`, `dw`, `dh`, soweit der
   jeweilige Constraint das sinnvoll bestimmen kann. Structured und Prosa muessen
   denselben Fehlerzustand transportieren.

4. Arrange ist inverse Geometrie, kein SVG-Autor.
   `arrange()` liefert Attribut-Patches pro Element und arbeitet sequentiell.
   Positionsaenderungen werden normativ als Delta-`transform` ausgegeben, nicht als
   absolute Neuposition, wenn eine Gegenbewegung gegen den Ursprungszustand benoetigt ist.

5. Der Kernel ist elementzentriert und id-basiert.
   Analyse, Diff, Korrekturen und Arrange adressieren einzelne sichtbare Elemente.
   Stabile `id`s sind Teil des Nutzungsvertrags.

## Garantierter Scope

- Sicherheitsgrenzen:
  Leerer Input, `DOCTYPE`, `ENTITY`, SVGs ueber `100KB` und SVGs mit mehr als `500`
  Knoten werden abgewiesen.
- Analyse-Tools:
  `vector_mirror_analyze`, `compare`, `inspect`, `palette`, `constraints`, `status`.
- Arrange-Tools:
  `vector_mirror_arrange` mit sequentieller Constraint-Auswertung.
- Constraint-Menge:
  `CENTERED-IN`, `NO-OVERLAP`, `INSIDE`, `ALIGNED-LEFT`, `ALIGNED-TOP`, `LEFT-OF`,
  `ABOVE`, `DISTANCE-FROM`, `SAME-SIZE`, `COLOR`, `FILL`.
- Diff-Dialekt:
  `VERSCHOBEN`, `FARBÄNDERUNG`, `NEU`, `ENTFERNT`.
- Verlaessliche Elementklassen im Vertrag:
  `rect`, `circle`, `text`.
- Teilweise unterstuetzte Elementklassen:
  `ellipse`, `line`, `image`, `tspan`.
  Sie koennen im Renderer sichtbar und im Grid/Diff erfassbar sein, sind aber nicht
  fuer den vollen Analyze->Structured->Arrange-Roundtrip als Kernklasse zugesagt.

## Roundtrip-Invarianten

1. Analyze und compare benutzen denselben Diff-Dialekt.
2. `CONSTRAINT_FAIL`-Deltas duerfen in `arbitrate()` nicht verloren gehen.
3. `structuredContent.corrections[*]` muss denselben Delta-Sinn tragen wie die Prosa.
4. Fix-Attribute muessen tag-abhaengig stabil gemappt werden.
   Kernklasse:
   `circle -> cx/cy/r`, `rect -> x/y/width/height`, `text -> x/y`.
5. Arrange berechnet Gegenbewegung relativ zum Ursprungselement.
   Bestehende `translate(...)`-Anteile werden ersetzt, andere Transform-Tokens bleiben erhalten.
6. Arrange ist idempotent fuer identische Inputs und rein lokal auf `canvas + elements + constraints`.
7. Duplicate-IDs im Arrange-Input sind ungueltig.
   Das Schema blockt sie, die Pipeline warnt zusaetzlich defensiv.
8. `COLOR` ist check-only, `FILL` ist arrange-only.
   Beide duerfen den jeweils anderen Kanal nicht implizit vortaeuschen.

## Explizit Nicht Im Scope

- `<g>` als erstklassige Semantik-Einheit.
  Gruppen werden im Renderer derzeit bewusst uebersprungen und haben keinen eigenen
  Analyse-, Diff- oder Arrange-Vertrag.
- Template-System, Workspace, Template-Katalog, Placeholder-Semantik.
- Vollstaendige SVG-Abdeckung.
  Filter, Masken, Marker, Symbole, Pattern, Animationen, Pfad-Topologie und komplexe
  Stil-/Vererbungssemantik sind nicht Teil des Kernel-Vertrags v1.
- Generierung fertiger SVG-Fragmente.
  Vector Mirror bleibt Spotter/Arrange-Helfer, nicht Sniper.

## Konsequenzen

- Die naechste Kernluecke ist nicht das Template-System, sondern die fehlende explizite
  Semantik fuer strukturierte Gruppen (`<g>`).
- Vor einem Template-System wuerde ein Ausbau von `<g>` den Kernvertrag direkt staerken:
  bessere Referenzierbarkeit, weniger Workarounds, stabilerer Roundtrip fuer reale SVGs.
- Solange `<g>` fehlt, sollte Produktkommunikation den verlaesslichen Scope auf
  elementzentrierte flache SVG-Szenen begrenzen.

## Naechster Block

Empfohlen ist `Phase 3b: <g>-Support als Kernluecke`, nicht Templates.

Minimaler Zielzustand:
- Renderer extrahiert sichtbare Gruppen als eigene semantische Knoten.
- Gruppen koennen Referenz oder Subject fuer Grid, Diff und Constraints sein.
- Arrange fuer Gruppen bleibt zunaechst auf Delta-Transform und Child-Erhalt begrenzt.
- Templates bleiben bis nach diesem Block out of scope.

## Offene Produktentscheidungen

- Soll `<g>` nur als Referenzcontainer gelten oder auch als bearbeitbares Subject?
- Soll `arrange()` Gruppen nur via `transform` bewegen oder Child-Geometrie aufloesen duerfen?
- Soll der Kernel spaeter auf `path` als Kernklasse erweitert werden oder bewusst elementar bleiben?
