# ADR-032: Qualitative Confidence, no Floats
<!-- BEACON:ROOT | TYPE:ADR | NAVIGATION:START_HERE→BAUPLAN→hier -->

```text
STATUS: accepted
DATUM:  2026-04-18
TAGS:   [ADR] [PRINCIPLE] [OUTPUT] [SCHEMA] [LLM]
SCOPE:  Wie Unsicherheit in Tool-Outputs ausgedrückt wird.
```

## Kontext

Messungen haben Unschärfen. Text-bbox enthält Glyph-Ascent. Float-Akkumulation driftet um Subpixel. 3D-Transforms projizieren Z verloren. Das LLM braucht Signal über die Verlässlichkeit einer Messung.

Zwei Wege diese Unsicherheit auszudrücken:

**Numerisch**: `confidence: 0.73`. Scheinbar präzise, empirisch irreführend. Die Sensible.so-Studie (RB-01) hat gezeigt: LLM-Confidence-Scores sind systematisch unkalibriert. 0.73 hat keine garantierte Bedeutung relativ zu 0.85. Ein False-Sense-of-Precision entsteht.

**Qualitativ**: drei diskrete Stufen. Klar kommuniziert, debuggbar, LLM-lesbar. Analog zu BI-RADS-Kategorien in der Mammografie oder RFC-2119-Normativen-Schlüsselwörtern (MUST/SHOULD/MAY).

## Entscheidung

**Vector Mirror drückt Unsicherheit in drei diskreten qualitativen Stufen aus, nicht als Float.**

Die Stufen:

- `"DEFINITE"` — Messung ist reproduzierbar, keine bekannte Unschärfe. Beispiel: `rect.bbox` ohne 3D-Transform-Vorfahre.
- `"LIKELY"` — Messung hat dokumentierte Näherung, in der Regel stimmig. Beispiel: Float-Akkumulation über sequenzielle arrange-Schritte (Drift < 1px erwartet).
- `"UNCERTAIN"` — Messung hat bekannte Limits, Interpretation mit Vorsicht. Beispiel: `text.bbox` wegen Glyph-Ascent, oder Element mit 3D-Transform-Vorfahre.

Schema-Erweiterung:
```
corrections[i].confidence: "DEFINITE" | "LIKELY" | "UNCERTAIN"
scene.elements[i].bbox_reliability: "reliable" | "approximate" | "not_measurable"
```

Die beiden Felder bedienen verschiedene Aspekte: `confidence` pro Correction-Delta, `bbox_reliability` pro Element-Geometrie. Beide diskret, beide Enum.

Verbot:
- Keine numerischen Confidence-Werte im Output
- Keine Prozent-Angaben (`73% certain`)
- Keine nicht-geerdeten Qualifier (`very likely`, `somewhat sure`)

## Konsequenzen

**Positiv**:
- LLM-Parse-Robustheit: `if (conf === "DEFINITE")` statt `if (conf > 0.8)` mit willkürlicher Schwelle
- Strukturelle Ehrlichkeit: keine Scheingenauigkeit
- Jede Stufe hat reproduzierbare Herkunft im Code (z.B. Text → UNCERTAIN, 3D → UNCERTAIN)
- Debugging klar: Warum UNCERTAIN? Code-Pfad zeigt Grund
- Konsistent mit RB-01 Empfehlung

**Negativ akzeptiert**:
- Feinkörnigkeit geht verloren (keine 0.73 vs 0.74 Unterscheidung)
- Übergang zwischen Stufen ist ein harter Schnitt (z.B. Float-Drift bei genau 1.0px)

**Umsetzung**:
- Confidence-Herleitung ist rule-based (z.B. "Text bekommt UNCERTAIN per default")
- Jede Constraint-Implementation deklariert ihre default-Confidence
- Bei mehreren Unsicherheits-Quellen gewinnt die niedrigste Stufe (Pessimismus-Prinzip)

## Nicht im Scope

- Keine Aussage über interne Berechnung. Intern dürfen Floats benutzt werden, nur der **Output** ist qualitativ.
- Internationale Lokalisierung der Strings. "DEFINITE" bleibt Schlüsselwort, Client kann lokalisieren.
- Erweiterung um weitere Stufen. Wenn drei nicht reichen, ist die Diskussion neu zu führen.

## Verwandte ADRs

- ADR-008 Spotter-Sniper-Prinzip
- ADR-030 Prinzip der Eigenständigkeit
- ADR-031 No LLM-Generated Spotter Content
