# ADR-030: Prinzip der Eigenständigkeit
<!-- BEACON:ROOT | TYPE:ADR | NAVIGATION:START_HERE→BAUPLAN→hier -->

```text
STATUS: accepted
DATUM:  2026-04-18
TAGS:   [ADR] [ARCH] [PRINCIPLE] [DEPENDENCY]
SCOPE:  Grundsatz-Regel für alle Feature-Entscheidungen ab v2.5
```

## Kontext

Vector Mirror nutzt vier externe Abhängigkeiten (Playwright, DOMPurify, MCP SDK, Zod) plus Chromium Engine. Die Versuchung ist gross, bequeme externe APIs (z.B. Chromium AOM, CDP, DOMPurify-Hooks) zu Trägern von Kernaussagen zu machen. Das spart kurzfristig Implementierungsarbeit und schafft langfristig Abhängigkeiten, Kontrollverlust und Vendor-Lock-in.

Die Balisage-Studie (2021) hat empirisch gezeigt: Chromium/Firefox/Safari divergieren in bbox-Werten. Cross-Browser-Determinismus existiert nicht. Jede externe API die wir zur Wahrheit erheben, importiert diese Drift.

## Entscheidung

**Vector Mirror funktioniert vollständig mit eigenen Mitteln. Externe APIs sind Verstärker, nie Stützpfeiler.**

Konkrete Regeln:

1. **Eigenbau-Garantie**: Jedes Feature hat eine Eigenbau-Variante die ausreichend ist. Die externe API ist optional.
2. **Autorität behalten**: Externe Daten sind Input ins eigene Reasoning. Sie sind nie alleiniger Wahrheitsträger.
3. **Degradation eingeplant**: Fällt die externe API aus, meldet das Tool "Verstärker fehlt" und läuft weiter.
4. **Rad-Neu-Erfinden erlaubt**: Wenn ein Eigenbau besser passt oder mehr Kontrolle bringt, ist er vorzuziehen — auch wenn Libraries existieren.
5. **Belastungstest vor Aktivierung**: Jeder externe Verstärker muss nachweisen welchen konkreten Pain er löst, den die Eigenbau-Basis nicht adressiert.

## Konsequenzen

**Positiv**:
- Tool überlebt Browser-Updates, SDK-Breaks, Client-Capability-Lücken
- Reproducibility ist strukturell geschützt
- Audit-Trail bleibt vollständig (keine "Chromium hat entschieden" als Sackgasse)
- Versionierung semantisch sauber (Semver trägt unsere Semantik, nicht fremde)

**Negativ akzeptiert**:
- Mehr eigener Code zu schreiben
- Mehr eigene Tests zu pflegen
- Einige Features entstehen später als mit "free lunch" von externen APIs

**Umsetzung**:
- Eichkörper-basierter Selbsttest validiert dass Eigenbau-Schicht allein trägt (RB-07)
- Feature-Flags für optionale Verstärker (Phase 2 des FIX_PLAN)
- Adapter-Pattern um externe Abhängigkeiten an der Peripherie isolieren

## Nicht im Scope

- Dieses ADR verbietet keine externen Dependencies. Es verbietet nur **Abhängigkeit** davon in der Sinn-Tragung.
- Keine Aussage über `v3.0`-Erweiterungen wie Kiwi-Solver, OpenType.js. Die dürfen kommen, wenn Phase 1 steht.

## Dokumentierte Abweichungen / Präzedenzfälle

ADR-030 ist Grundsatz, nicht Dogma. Wenn Research + SOTA-Analyse nachweisen,
dass ein Eigenbau unter BP liegt und der Eigenbau auf Feature-Parität 3× mehr
Aufwand erzeugt als Dep-Adoption, ist die Dep vorzuziehen. Jede Abweichung
wird hier einzeln dokumentiert und begrenzt sich auf den genannten P1-Item.

### Abweichung 1 — Circuit-Breaker (FIX_PLAN P1-03)

| Feld | Wert |
|---|---|
| Datum | 2026-04-23 |
| Betroffen | P1-03 (VM-SM-002 Permanent-Bricking) |
| Entscheidung | Opossum 9.x als Dependency statt 30-Zeilen-Eigenbau |
| Research | `docs/research/RB-11_2026-04-23.md` |
| Begründung | Feature-Matrix RB-11 §3 zeigt 6 Lücken im Eigenbau-30-Zeiler (Per-Call-Timeout, Error-Filter, Volume-Threshold, Slow-Call-Detection, Events, Half-Open-Race-Safety), davon 4 use-case-relevant für Playwright-Crash-Recovery. Eigenbau auf Feature-Parität wäre ~80–100 Zeilen + 30 Tests + Race-Proof — 3× der Opossum-Adoption. RB-04 §7 hatte Eigenbau bereits mit ❌ bewertet. |
| Präzedenzfall-Grenzen | Gilt **nur** für P1-03 / Circuit-Breaker. Ist keine Generalfreigabe für weitere Deps. Jede zukünftige Dep-Einführung erfordert eigene SOTA-Analyse, dokumentierte Gap-Matrix und eigenen Präzedenzfall hier. |
| Adapter-Pattern | Breaker wird in `src/lib/breaker.js` thin-wrapped, so dass ein späterer Swap (z.B. auf Cockatiel oder Eigenbau) API-stabil bleibt. |

### Abweichung 2 — async-mutex (Phase-§1.3-Closure / Beschluss B-2)

| Feld | Wert |
|---|---|
| Datum | 2026-05-13 |
| Betroffen | Phase-§1.3 (R2-F02 Cross-SVG-Leak / paralleler Page-Zugriff); STATUS_DELTA Beschluss B-2 |
| Entscheidung | `async-mutex` ^0.5.0 als Dependency, `Mutex.runExclusive` um Playwright-Page-Zugriff in `src/adapters/renderer/playwright.js:14ff` |
| Research | `docs/audit/AUDIT_OPUS_0805/sync/beschluesse.yaml` Abschnitt B-2 (4 Primärquellen) |
| Begründung | npm-Downloads ~7.97 M/Woche (2026-05); GitHub 1415 stars, last commit 2025-07-19, archived=false; 333 189 abhängige Repositories. Eine Custom-Promise-Chain-Implementierung wäre subtle gegen Edge-Cases (Cancellation, Error-Propagation, Half-Open-Race-Safety) ohne empirischen Mehrwert. v0.5.0 ist 2 Jahre stable — kadenz-arme Maintenance, kein Abandonment-Signal. |
| Präzedenzfall-Grenzen | Gilt **nur** für `async-mutex` im Playwright-Page-Schutz. Keine Generalfreigabe; jede weitere Dep-Einführung erfordert eigene SOTA-Analyse, dokumentierte Gap-Matrix und eigenen Präzedenzfall hier. |
| Adapter-Pattern | Mutex bleibt im Renderer-Adapter eingekapselt (`src/adapters/renderer/playwright.js`), Core (`src/core/`) bleibt mutex-frei. Swap auf Eigenbau-Promise-Queue oder andere Lib bleibt durch Adapter-Grenze API-stabil. |
| Korrigiert | ADR-025 § 7 Teil B ("kein `async-mutex`") wird durch diese Abweichung partial-superseded; ADR-025 trägt entsprechenden Marker. |

## Verwandte ADRs

- ADR-008 Spotter-Sniper-Prinzip (präzedenzielle Grundsatz-Regel)
- ADR-031 No LLM-Generated Spotter Content (Konsequenz dieses Prinzips auf LLM-Ebene)
- ADR-032 Qualitative Confidence (Konsequenz auf Output-Ebene)
