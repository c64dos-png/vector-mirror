# ADR-031: No LLM-Generated Spotter Content
<!-- BEACON:ROOT | TYPE:ADR | NAVIGATION:START_HERE→BAUPLAN→hier -->

```text
STATUS: accepted
DATUM:  2026-04-18
TAGS:   [ADR] [PRINCIPLE] [LLM] [DETERMINISM] [SPOTTER]
SCOPE:  Grundsatz: welche Inhalte dürfen Ursprung außerhalb unseres
        deterministischen Codes haben.
```

## Kontext

MCP bietet eine Primitive `sampling/createMessage`: das Tool kann den Client bitten, seinen LLM eine Completion generieren zu lassen. Verführerische Anwendung: anstatt eine strukturierte Explanation-DB zu pflegen, lässt das Tool den Client-LLM Erklärungen in natürlicher Sprache erzeugen.

In einem Research-Block war das als "grosser Hebel" markiert. Bei kritischer Prüfung stellt sich heraus: **das bricht das Spotter-Sniper-Prinzip (ADR-008) frontal**.

Risiken von LLM-generiertem Spotter-Content:

1. Halluzination — Erklärung plausibel aber falsch
2. Model-Drift — verschiedene LLMs erklären dasselbe unterschiedlich
3. Keine Confidence-Sichtbarkeit — LLM antwortet immer im vollen Ton
4. False Positives — LLM legitimiert Messfehler durch plausibles Nacherzählen
5. Audit-Unmöglichkeit — keine Unit-Test-Prüfung möglich
6. Reproduzibilitäts-Bruch — gleicher Input, unterschiedlicher Output
7. Token-Kosten-Explosion — jede Antwort zusätzlicher LLM-Roundtrip
8. Rekursion — Client-LLM fragt Tool, Tool fragt Client-LLM
9. Verantwortungs-Diffusion — wer haftet für falsche Aussagen?
10. Spotter-Sniper-Bruch — Tool wird selbst zum Sniper mit Halluzinations-Risiken

Jede einzelne Eigenschaft unseres Wahrheits-Vertrags (reproduzierbar, auditierbar, versionierbar, falsifizierbar) wird verletzt.

## Entscheidung

**Vector Mirror verwendet keine LLM-generierten Inhalte als Spotter-Output. Alle Wahrheitsaussagen haben deterministische Herkunft im Code.**

Konkret verboten:
- MCP Sampling für Erklärungs-Inhalte
- MCP Sampling für Constraint-Vorschläge
- MCP Sampling für Correction-Interpretation
- MCP Sampling für Fix-Priorisierung
- MCP Sampling für Diagnose-Zusammenfassungen
- Jede Form von freiem LLM-Text in `structuredContent` oder `prose`

Erlaubt mit Guardrails:
- **MCP Elicitation für Klärungsfragen an den User**: weil der User (nicht das LLM) auswählt, und weil die Antwort auf einem vom Tool vorgegebenen strukturierten Schema basiert (Enum, Boolean). Der Inhalt kommt vom Menschen, die Options-Liste vom Tool.

Nicht erlaubt, auch wenn verlockend:
- LLM als "Sprach-Verpackung" über strukturiertem Spotter-Output ("formuliere diesen JSON-Fehler als natürlichen Satz"). Begründung: das LLM kann Nuancen verschieben, Links/Rechts verwechseln, Tragweite unbewusst umdeuten. Lokalisierung via strukturierter i18n-DB ist der korrekte Weg.

## Konsequenzen

**Positiv**:
- Spotter-Output bleibt zu 100% reproduzierbar
- Audit-Trail vollständig
- Explain-DB ist versionierbar (Semver trägt die Aussagen)
- Keine Token-Kosten für Tool-interne Operationen
- Debugging-bar: jede Aussage hat Code-Zeile als Herkunft

**Negativ akzeptiert**:
- Explain-Inhalte müssen handgepflegt werden (~3000 Zeilen strukturierte Markdown-ähnliche Einträge)
- Keine "dynamisch passende" Erklärungs-Formulierungen
- Internationalisierung erfordert eigene i18n-Struktur, nicht LLM-Übersetzung

**Umsetzung**:
- Eigene Explain-DB als Teil von `vector_mirror_explain` Tool (RB-03)
- Introspection-Algorithmus in `vector_mirror_suggest` ist deterministisches Rule-Mining (RB-10), keine LLM-Abfrage

## Nicht im Scope

- Dieses ADR verbietet nicht dass der Client-LLM das Tool-Ergebnis interpretiert oder weiterverarbeitet. Das ist explizit sein Job (Sniper-Rolle).
- Kein Verbot von LLMs im User-Endnutzen. Der User kann seinen Client-LLM fragen "erkläre mir was Vector Mirror gesagt hat" — das ist legitim ausserhalb unseres Kontrollbereichs.

## Verwandte ADRs

- ADR-008 Spotter-Sniper-Prinzip
- ADR-030 Prinzip der Eigenständigkeit
- ADR-032 Qualitative Confidence
