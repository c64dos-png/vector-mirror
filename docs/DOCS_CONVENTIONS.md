# Docs Conventions
<!-- BEACON:ROOT | TYPE:CONVENTION | NAVIGATION:docs-governance -->

```text
ZWECK:      Pflegearme Dokumentstruktur für Cold Start, Agentenführung und Langzeitpflege
STATUS:     Aktiv
SCOPE:      Zentrale Projekt- und Architekturdokumente
PRINZIP:    Wenige starke Dokumente statt viele konkurrierende SSOTs
```

## Dokument-Hierarchie

1. `START_HERE.md`
   Der operative Einstiegspunkt. Immer kurz, aktuell und commit-sensibel halten.
2. `PROJEKTMAPPE.md`
   Gesamtbild, Historie, Roadmap, Uebergabe. Breiter, aber nicht widersprüchlich zu `START_HERE`.
3. `docs/BAUPLAN_VECTOR_MIRROR_v2.0.md`
   Architektur- und Vertragsdokument.
4. `docs/ADR-*.md`
   Echte Architekturentscheidungen mit Begründung.
5. `docs/audit-prompts/`
   Prüfspur und Arbeitsmaterial, nicht SSOT.

## Pflicht-Metadaten Fuer Zentrale Dokumente

Diese Elemente sind für `START_HERE`, `PROJEKTMAPPE`, `BAUPLAN`, `ADR-*` empfohlen:
- Titelzeile
- genau ein `BEACON:ROOT`
- kurzer Headerblock im Codefence-Format
- Status
- Datum
- Tags

Minimalbeispiel:

```md
# TITEL
<!-- BEACON:ROOT | TYPE:ENTRYPOINT | NAVIGATION:first-read -->

```text
STATUS: aktiv
DATUM:  2026-04-17
TAGS:   [ARCH] [SVG] [MCP]
```
```

## Beacons

Beacons sind Sprungmarken für Agenten. Regeln:
- Nur in langlebigen Dokumenten verwenden
- Pro Dokument genau ein `BEACON:ROOT`
- Untersektionen nur dann mit Beacons markieren, wenn sie echte Navigationsziele sind
- Beacon-Namen stabil halten

Empfohlene Muster:
- `BEACON:ROOT`
- `BEACON:ARCH`
- `BEACON:CONSTRAINT`
- `BEACON:QA`
- `BEACON:ROADMAP`

## Tags

Tags dienen nur der schnellen Einordnung. Regeln:
- sparsam halten
- nur etablierte Tags wiederverwenden
- keine Tag-Explosion

Empfohlene Kern-Tags:
- `[MCP]`
- `[SVG]`
- `[ARCH]`
- `[HEXAGONAL]`
- `[SPOTTER]`
- `[ARRANGE]`
- `[REGISTRY]`
- `[QA]`
- `[ADR]`

## IDs

Stabile IDs sind Pflicht für Dinge, die über Sessions referenziert werden:
- ADRs: `ADR-023`
- Findings: `F-001`, `R-02`, `S-01`
- Phasen: `Phase 3a`, `Phase 3b`
- Commit-Referenzen: immer kurz und eindeutig, z.B. `ded0ce1`

Regeln:
- nie recyceln
- nie für etwas anderes wiederverwenden
- in Doku und Commits konsistent halten

## ADR-Regeln

Ein ADR ist angemessen bei:
- Architekturentscheidungen
- Scope-Entscheidungen mit Langzeitwirkung
- Richtungswechseln

Ein ADR ist nicht nötig für:
- kleine Bugfixes
- lokale Refactors
- Testkorrekturen ohne Architekturwirkung

## Skeletons

### START_HERE Skeleton
- Mission
- stabiler Stand
- Lesereihenfolge
- Vertrauensanker
- offene Produktfragen

### ADR Skeleton
- Status
- Kontext
- Entscheidung
- Konsequenzen
- Nicht im Scope

### Audit Skeleton
- Findings
- Beweise
- Risiko
- Empfehlung

## Pflege-Regeln

- Erst Code stabilisieren, dann Doku synchronisieren
- Nie mehrere SSOTs mit gleichem Anspruch parallel pflegen
- Arbeitsmaterial darf existieren, aber nicht als SSOT getarnt sein
- Wenn unklar ist, welches Dokument Vorrang hat: `START_HERE` muss das klären
