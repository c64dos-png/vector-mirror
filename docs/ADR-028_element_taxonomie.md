# ADR-028: Element-Taxonomie v1
<!-- BEACON:ROOT | TYPE:ADR | NAVIGATION:START_HERE→BAUPLAN→hier -->

```text
STATUS: accepted
DATUM:  2026-04-18
TAGS:   [ADR] [SCHEMA] [TAXONOMY] [KERNEL]
SCOPE:  Wie Scene-Elemente im structuredContent strukturiert sind.
```

## Kontext

Das bisherige Scene-Element-Schema kannte drei Status-Werte: `ok`, `fail`, `warn`. Diese Armut zwingt heterogene Realität in drei Schubladen: ein Off-Canvas-Element erhält `warn` ohne präziseren Hinweis; ein maskiertes Element wird nicht markiert; ein Gruppen-Container erscheint wie ein bewertetes Element.

HTML löst das mit **non-hierarchischen Multi-Tag-Kategorien** (Flow + Phrasing + Interactive überlappen). SVG hat durch die WAI-ARIA-Graphics-Module-Spec eine eigene Rollen-Taxonomie (`graphics-document`, `graphics-symbol`, `graphics-object`, `img`). Zod unterstützt Discriminated Unions mit literal-discriminant — das macht heterogene Schemas typsicher und LLM-lesbar.

## Entscheidung

**Scene-Elemente tragen fünf orthogonale Tags, davon zwei Pflicht. Das Schema nutzt Zod-`discriminatedUnion` über den status-Discriminator.**

### 1. Die fünf Dimensionen

Jedes Scene-Element hat:

| Dimension | Pflicht | Wertebereich |
|---|---|---|
| `status` | ja (Discriminator) | `visible` \| `offscreen` \| `straddling` \| `decoration` \| `container` \| `unknown` |
| `bbox_reliability` | ja | `reliable` \| `approximate` \| `not_measurable` (siehe ADR-032) |
| `role` | optional | `graphics-document` \| `graphics-object` \| `graphics-symbol` \| `img` \| `text-label` \| `container` \| `decoration` \| `null` |
| `warnings` | optional | `string[]` — nur strukturierte Codes (3D_TRANSFORM_ANCESTOR, etc.) |
| `containment` | nur bei status ∈ {offscreen, straddling} | `{ visible_ratio, overflow: {n,e,s,w}, crossing_edges }` |

Zusätzliche Pflichtfelder unabhängig von Dimension: `id`, `tag`, `bbox`, `cell`, `color`.
Optionales `parent_id`, `parent_tag` für tspan (siehe ADR-026, FIX_PLAN P1-16).

### 2. Status-Semantik

- **`visible`** — Element ist voll im Viewport, effective opacity ≥ 0.1, keine Maskierung. Default-Fall.
- **`offscreen`** — `containment.visible_ratio === 0`. Element existiert ausserhalb ViewBox.
- **`straddling`** — `0 < containment.visible_ratio < 1`. Überschreitet mindestens eine ViewBox-Kante.
- **`decoration`** — effective opacity < 0.1 oder `aria-hidden="true"`. Element ist da, wird aber visuell nicht als Figur behandelt.
- **`container`** — Gruppen-Element (`<g>`) mit explizitem `id`-Attribut. **Wichtig**: Dieses Status-Tag bedeutet ausschliesslich organisatorische Repräsentation — das Tool meldet die Existenz der Gruppe und ihre direkten Kinder-IDs, aber **führt keine Analyse gegen die Gruppe selbst durch**. Keine bbox-Aussage, keine Constraint-Annahme, kein Arrange-Vertrag. Gruppen ohne `id` werden im Output nicht geführt (Transform wird weiterhin über `getCTM` bei Kindern berücksichtigt). Vollständig konsistent mit ADR-024: `<g>` ist nicht Kernklasse, wird nicht erstklassig analysiert, erscheint hier nur als organisatorischer Metadaten-Tag.
- **`unknown`** — Fallback wenn keine andere Kategorie greift.

Priorität bei mehreren zutreffenden Kategorien: `offscreen` > `straddling` > `decoration` > `container` > `visible` > `unknown`.

### 3. Rollen-Ableitung

`role`-Herleitung ist **deterministisch im Code**, nicht über Chromium-AOM:

- Wenn `el.hasAttribute('role')` und Wert ∈ erlaubter Liste → übernehmen
- Sonst tag-basierte Regel:
  - `<svg>` mit ≥3 benannten Kindern → `graphics-document`
  - `<svg>` sonst → `img`
  - `<use>` auf `<symbol>` → `graphics-symbol`
  - `<text>`, `<tspan>` → `text-label`
  - `aria-hidden="true"` oder `role="presentation"` → `decoration`
  - Sonst → `null`

**Wichtig**: `<g>`-Elemente werden **nicht** automatisch zu `graphics-object` abgeleitet — das würde ADR-024 widersprechen. `graphics-object`-Role wird nur gesetzt wenn das SVG es explizit via `role="graphics-object"` deklariert. Ohne explizite Deklaration bleibt role = `null`, und das Element erscheint als `status: "container"` mit leerer semantischer Rolle.

Chromium's AOM kann **zusätzlich** als Signal abgerufen werden (Phase 2, opt-in), bleibt aber nicht Autorität. Siehe ADR-030.

### 4. Discriminated Union im Zod-Schema

```typescript
const sceneElement = z.discriminatedUnion('status', [
  z.object({ status: z.literal('visible'), id, tag, bbox, ..., 
             containment: z.object({ visible_ratio: z.literal(1) }).optional() }),
  z.object({ status: z.literal('offscreen'), id, tag, bbox, ...,
             containment: containmentWithOverflow }),  // required
  z.object({ status: z.literal('straddling'), id, tag, bbox, ...,
             containment: containmentWithOverflow }),  // required
  z.object({ status: z.literal('decoration'), id, tag, bbox, ... }),
  z.object({ status: z.literal('container'), id, tag, bbox, 
             children: z.array(z.string()) }),
  z.object({ status: z.literal('unknown'), id, tag, ... })
]);
```

Zod erzwingt zur Laufzeit dass z.B. `status: "offscreen"` ohne `containment.overflow` ein Validation-Fehler ist.

### 5. Erweiterbarkeit

Neue status-Werte (`masked`, `clipped_invisible`, etc.) sind für v3.0 möglich durch Hinzufügen einer Discriminated-Union-Variante. Nicht-Breaking solange alte Werte bestehen bleiben.

Neue Rollen sind möglich durch Erweiterung der `role`-Enum. Ebenfalls additiv.

Neue `warnings`-Codes sind immer additiv — die Liste ist offen, aber jeder Code hat deterministische Herkunft im Code.

## Garantierter Scope

- Jedes Scene-Element hat genau einen `status` und genau eine `bbox_reliability`.
- `containment`-Feld ist exakt dann gefüllt wenn `status` ∈ {offscreen, straddling}.
- `role`-Herleitung ist deterministisch und reproduzierbar.
- Schema-Validierung scheitert bei inkonsistenten Kombinationen (z.B. offscreen ohne containment).

## Konsequenzen

**Positiv**:
- VM-AG-007 Schicht 7, VM-RF-002 Off-Canvas, VM-RF-003 tspan, VM-PR-004 teilweise unterstützt strukturell gelöst
- Schema ist selbst-dokumentierend für LLM-Clients
- Zod-Validierung fängt inkonsistente Outputs zur Laufzeit
- Erweiterbar ohne Breaking Change

**Negativ akzeptiert**:
- Schema-Komplexität steigt gegenüber einfachem `{status: "ok"|"fail"|"warn"}`
- Vorhandene Client-Integrationen müssen das neue Schema lesen lernen (v2.0 → v2.5 Major-Bump in diesem Aspekt)

**Umsetzung**: siehe FIX_PLAN P1-10, P1-11, P1-13, P1-16, P1-17, P1-18.

## Nicht im Scope

- Automatische Rollen-Ableitung über Chromium AOM (Phase 2 optional)
- Erweiterte status-Werte `masked`, `clipped_invisible` (v3.0)
- Accessibility-Tree-Equivalenz (v3.0 mit eigener Schicht)

## Verwandte ADRs

- ADR-024 Kernel-Vertrag v1
- ADR-026 Rendering Fidelity Scope (warnings-Codes-Definition)
- ADR-030 Prinzip der Eigenständigkeit (eigene Rollen-Logik)
- ADR-032 Qualitative Confidence (bbox_reliability-Stufen)
