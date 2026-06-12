# ADR-027: Readback-Schicht (Understood-Block)
<!-- BEACON:ROOT | TYPE:ADR | NAVIGATION:START_HERE→BAUPLAN→hier -->

```text
STATUS: accepted
DATUM:  2026-04-18
TAGS:   [ADR] [ARCH] [OUTPUT] [COMMUNICATION] [KERNEL]
SCOPE:  Wie das Tool dem LLM zurückmeldet was es als Input verstanden hat.
```

## Kontext

Ein grosser Teil der Silent-Pass-Findings (VM-LC-001, VM-LC-008, VM-PR-001, VM-PR-002) hat dieselbe Wurzel: das Tool verarbeitet Input still und meldet das Ergebnis, ohne den Input sichtbar zu machen. Bei Tippfehlern, unklaren Constraints oder unerwarteten Reinigungen durch den Sanitizer bleibt das LLM ahnungslos.

Flugkontrolle löst das seit 1950ern mit **Readback**: der Pilot wiederholt die kritische Information vor Ausführung. Der Lotse erkennt Missverständnisse sofort. LSP löst es mit strukturierten Diagnostic-Listen, MCP Elicitation löst es protokollbasiert — aber Elicitation ist Draft-Spec und Client-Support unsicher.

Die robuste Basis-Lösung: **Inband-Echo im structuredContent**. Unabhängig von Client-Capabilities.

## Entscheidung

**Jeder Tool-Call der Constraints oder strukturierte Inputs verarbeitet liefert einen `understood`-Block im structuredContent. Kein Protokoll-Feature erforderlich, kein Client-Opt-In.**

### 1. Schema

```
understood: {
  parsed: string[],                     // Constraints die syntaktisch erkannt wurden
  unknown: Array<{                      // Constraints die nicht interpretierbar waren
    input: string,
    reasonCode: ReasonCode,
    suggestion?: string                 // Levenshtein-Nachbar wenn nahe
  }>,
  warnings: Array<{                     // Plausibilitäts-Auffälligkeiten
    code: string,                       // z.B. DISTANCE_FROM_ZERO
    input: string,
    note: string
  }>,
  element_context: {                    // Statistik zum SVG
    total: number,
    with_explicit_ids: number,
    auto_named: number,
    dropped_during_extraction: number
  },
  sanitizer_actions?: Array<{           // Was DOMPurify entfernt hat (optional)
    type: "element" | "attribute",
    name: string,
    count: number
  }>
}
```

### 2. ReasonCode-Vokabular

Feste Enum-Liste (nicht willkürlich erweiterbar):

| reasonCode | Bedeutung |
|---|---|
| `CONSTRAINT_TYPE_UNKNOWN` | Typo oder nicht registrierter Constraint-Typ |
| `CONSTRAINT_SCOPE_MISMATCH` | Constraint passt nicht zur Situation (z.B. FILL im check-Pfad) |
| `SUBJECT_NOT_FOUND` | Subject-ID existiert nicht im SVG |
| `REFERENCE_NOT_FOUND` | Reference-ID existiert nicht im SVG |
| `REFERENCE_DEGENERATE` | Referenz hat 0-Dimension |
| `MEASUREMENT_AMBIGUOUS` | Messung unklar (z.B. text ohne Font-Fallback) |
| `SEMANTIC_SUSPICIOUS` | Plausibilitäts-Flag (z.B. DISTANCE-FROM 0) |
| `MISSING_REQUIRED_PARAMETER` | z.B. COLOR ohne Farbwert |

Jeder Wert hat deterministische Herkunft im Code, jede Einfügung eines neuen reasonCodes ist ein expliziter Release-Schritt.

### 3. Anwendung

`understood` wird erzeugt von: `analyze`, `compare`, `arrange`.
`understood` wird NICHT erzeugt von: `constraints`, `status`, `selftest` (diese verarbeiten keine Constraints).

Der Block ist **immer anwesend** (auch wenn leer — `parsed: [], unknown: [], warnings: []`). Die Abwesenheit wäre für das LLM uninterpretierbar.

### 4. Beziehung zu Elicitation

Elicitation (MCP-Protokoll-Primitive für Rückfragen) ist **Phase 2 optional**. Wenn der Client `elicitation`-Capability deklariert, kann der Server bei kritischen Warnings eine Rückfrage stellen — zusätzlich zum Inband-`understood`-Block, nicht als Ersatz.

Die Inband-Variante ist die garantierte Baseline.

### 5. Explizites Anti-Pattern

- `understood` enthält **keine** LLM-generierten Formulierungen (ADR-031)
- `understood` enthält **keine** Float-Confidence-Scores (ADR-032)
- `understood.warnings` sind **keine** freien Texte sondern strukturierte Objekte mit `code`-Feld

## Garantierter Scope

- Jeder Constraint-verarbeitende Call liefert `understood` im structuredContent.
- Tippfehler produzieren eine `suggestion` bei Levenshtein-Distanz ≤2 zu einem bekannten Constraint-Typ.
- Plausibilitäts-Flags (DISTANCE-FROM 0, ASPECT-RATIO mit negativen Werten, etc.) produzieren `warnings`-Einträge.
- DOMPurify-Entfernungen sind sichtbar in `sanitizer_actions` (wenn detektierbar).

## Konsequenzen

**Positiv**:
- VM-LC-001 (Silent-Pass), VM-LC-008 (Crash-Pfad), VM-PR-001 (Contract-Drift) und indirekt alle weiteren Input-Transparenz-Themen strukturell gelöst
- Jedes LLM sieht sofort was das Tool verstanden hat
- Keine Protokoll-Abhängigkeit, läuft mit jedem MCP-Client
- Halluzinationen in Constraint-Syntax werden sichtbar statt still verworfen

**Negativ akzeptiert**:
- Output wird ~100-200 Tokens länger pro Call (passt in ADR-011 Budget)
- LLM muss `understood`-Block lesen und interpretieren
- Levenshtein-Suggestion-Berechnung muss handgepflegt werden

**Umsetzung**: siehe FIX_PLAN P1-12.

## Nicht im Scope

- Elicitation (MCP-Protokoll-Rückfragen) — Phase 2 optional
- Lokalisierung der `note`-Felder in `warnings` — v3.0 via eigene i18n-DB
- Historie vergangener `understood`-Blöcke — Session-lokal in `bookmarks` möglich, nicht automatisch

## Verwandte ADRs

- ADR-008 Spotter-Sniper-Prinzip
- ADR-011 Token-Budget (Prose-Output)
- ADR-030 Prinzip der Eigenständigkeit (kein Elicitation-Zwang)
- ADR-031 No LLM-Generated Spotter Content (keine Text-Formulierungen im Block)
- ADR-032 Qualitative Confidence
