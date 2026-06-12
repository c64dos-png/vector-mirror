# Mirror — a deterministic SVG perception eye for LLM agents

> **Mirror renders SVG in a real browser and reports what is actually where — in grid cells and
> W3C color names, with prose and structured output — and it never guesses.** Spatial layout
> constraints become unit tests. And every tool description is a claim the server proves about
> itself. Built for agents that can't afford to hallucinate coordinates.

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)
[![npm](https://img.shields.io/npm/v/vector-mirror.svg)](https://www.npmjs.com/package/vector-mirror)
[![GitHub stars](https://img.shields.io/github/stars/c64dos-png/vector-mirror.svg?style=social)](https://github.com/c64dos-png/vector-mirror)
[![MCP](https://img.shields.io/badge/MCP-server-blue.svg)](https://modelcontextprotocol.io)

---

## What is this?

When an LLM agent edits an SVG, how does it know whether the change worked? Today it either
**guesses from the source text** (and hallucinates positions, because layout is a render-time
property, not a source property) or it **takes a screenshot and guesses from pixels** (and burns
tokens on a vision round-trip that still can't name a color or address a region precisely).

Mirror is the third option: a **measuring eye**. It is a sensory organ for LLMs, not a tool with
a purpose. It perceives and measures; it never interprets, decides, or acts — the **brain** (the
LLM or you) does that. The eye has three tissues:

| Tissue | What it does |
|--------|--------------|
| **Retina** (measurement) | renders the SVG in real Chromium and measures geometry, colors, visibility |
| **Mouth** (utterance) | says what it saw — `prose` + `structured`, two projections of one truth |
| **Package insert** (self-description) | explains the organ to a stranger brain: every tool description is a machine-verified claim |

Because the measurement runs in a real browser engine, Mirror sees what the browser sees — including
things the SVG source never tells you.

---

## Killer demo: the perceive → constrain → correct → compare loop

A cold agent (no source code, MCP only) built a 17-element mission-control panel and verified it
to an exact stop-condition. Here is the loop, with **real outputs from that session**:

```text
# 1 — INSPECT: see the layout in LLM grammar (no constraints checked yet)
inspect(svg)
  → scene: 16 elements, grid 16×10, canvas_validity: valid
    e.g. { id: "led-ok", tag: "circle", cell: "B3", color: "lime" }
    colors come out as W3C NAMES, never hex.

# 2 — CONSTRAINTS: ask the vocabulary (it is finite and closed)
constraints()
  → 11 types. RIGHT-OF / BELOW deliberately do NOT exist
    (use LEFT-OF / ABOVE with swapped operands).

# 3 — ANALYZE: turn layout intent into unit tests
analyze(svg, ["#title CENTERED-IN #frame", "#led-ok ABOVE #led-warn", ...16 constraints])
  → PARTIAL: 2 unchecked SUBJECT_TIME_VARIANT
    "#beacon has an animated r → not measurable; geometrically satisfied @t0 (bbox …)"
    # the eye refuses to guess about an animated value. It says so, with a reason code.

# 4 — fix, re-analyze until PASS (convergence is tracked, not vibes)
analyze(svg_v3, [...], previousIssueCount: N)
  → PASS  (corrections == [] && unchecked == [] && canvas_validity == valid && diff == [])

# 5 — SNIPER LOOP: pin a baseline, edit, catch regressions in one call
bookmark("panel-pass", analysisId)
compare(sabotaged_svg, [], "panel-pass")
  → FAIL: FARBÄNDERUNG orange→crimson  +  VERSCHOBEN D7→H8
    with ready-to-apply fixes: { x: 262→182, y: 372→324 }
    # exactly the two injected faults. Nothing more, nothing less.
```

The agent's verdict, verbatim: *"In 13 calls it never once guessed, lied, or made me guess.
`analyze` landed on the first try. Lost diagnostic loops: 0."* — **8.5/10.**

---

## Features — the honesty axes

Mirror's differentiator is not *what* it measures but that it is **honest about what it cannot**.

| Capability | What it gives the agent | Honest about |
|------------|-------------------------|--------------|
| **Grid grammar** | every element addressed by cell (`B3`, `D7→H8`) | measurement space is the viewBox, declared |
| **W3C color names** | `lime`, `crimson` — never raw hex | nearest-name snap is named as such |
| **Spatial constraints** | `#logo CENTERED-IN #frame` as a checkable assertion | unknown types → `unchecked` + reason code, never guessed |
| **Diff vocabulary** | finite, typed: `MOVED / COLOR-CHANGE / SHAPE-CHANGE / NEW / REMOVED` | — |
| **State axis** | flags elements whose visibility depends on interaction | `state_dependent` |
| **Media axis** | flags viewport/media-dependent measurement | `media_dependent` |
| **Motion axis** | animated geometry → `not_measurable`, never a guessed frame | `motion_dependent`, `SUBJECT_TIME_VARIANT` |
| **Paint truth** | ink outside the geometric bbox (glow/shadow/blur) is flagged | `has_paint_overflow`, `visual_bbox` |
| **Convergence** | `previousIssueCount` → BASELINE / SOLVED, progress is measured | — |

The rule, stated once: **the eye measures gaps; the brain prescribes corrections.** Mirror never
clamps, smooths, or invents a value to please you. If it can't measure, it says `not_measurable`.

---

## Why not screenshots?

A whole field exists for "show the agent the UI" — screenshot MCPs, SVG rasterizers, pixel-diff
regression (Percy, BackstopJS, Playwright snapshots), accessibility-tree snapshots. They all share
one limit: **they hand the agent pixels (or structure) and the agent still has to guess.** A
screenshot can't be addressed (`which region?`), can't name a color precisely, can't tell you
whether an element is *measurably* inside a frame or just *looks* inside, and can't say "I don't
actually know — this is animated." (A 24-source competitive scan found no tool that combines
LLM-grammar SVG perception, declared honesty axes, and proven tool descriptions.)

Mirror replaces the pixel guess with **measured render truth in a grammar LLMs read natively** —
no image modality, no vision round-trip, no hallucinated coordinates.

---

## Quickstart

**Requirements:** Node ≥ 18. Mirror renders in real Chromium via Playwright, so a browser binary
is needed once.

```bash
# install the Chromium engine Mirror measures with (one-time)
npx playwright install chromium
```

**Run as an MCP server** — add to your client's MCP config (Claude Desktop, etc.):

```json
{
  "mcpServers": {
    "vector-mirror": {
      "command": "npx",
      "args": ["-y", "vector-mirror"]
    }
  }
}
```

On `initialize`, the server hands your agent a full **Quickstart**: the workflow, the constraint
grammar, four verified gotchas, a glossary, and the exact stop-condition — so a cold agent is
productive with **zero source reading** (this is measured; see The Proof).

**First call to try:** `vector_mirror_inspect` with an SVG string → you get the scene in grid
grammar. Then `vector_mirror_constraints` for the vocabulary, then `vector_mirror_analyze`.

---

## The Proof

Mirror does not ask for trust; it earns it. Three pieces of evidence:

### 1 · Cold-consumer love metric
A cold agent (MCP only, no source) built and verified a 17-element panel in **13 tool calls with
0 lost diagnostic loops**, scoring **8.5/10** with the reason *"never once guessed, lied, or made
me guess."* The built-in sabotage test caught exactly the two injected faults, with ready-to-apply
fix numbers. The one point deducted was an honestly-reported design seam — Mirror reports its own
weaknesses too.

### 2 · Multi-model convergence
**13 cold agents across 5 model families** (Haiku, Sonnet, Opus, Gemini, Codex) consumed the
server independently. **Median love 8.0/10; substantive lost loops near zero.** Agents guided
through the MCP layer did not fall into the traps that un-guided raw-API users did — the guidance
layer measurably works.

### 3 · Machine-proven tool descriptions + anti-circular self-test
Every sentence the server ships — tool descriptions, quickstart, glossary — is projected from **one
source** (`src/interface/claims.js`) and is a **probe-backed claim** (`tests/relais_red/`). A
mutation in the shipped text turns a test red. On top of that, a **5-fixture self-test** runs
**anti-circularly** — against spec-derived expected values, never against the server's own stored
output. As one consumer put it: *"that is the sentence that actually justifies trust."*

> **Determinism:** byte-identical input (sanitized DOM, time, selector) → byte-identical output,
> for a pinned Chromium engine. Verified by a dedicated determinism suite (including an
> anti-false-green mutation) and property-based fuzzing (`fast-check`).

---

## Architecture — three tissues, one organ

```
                    ┌─────────────────────────────────────────┐
   raw SVG  ──────▶ │  RETINA   sanitize → real Chromium       │  measured truth
                    │  (src/adapters/renderer, src/core)       │  (geometry, color,
                    │  hexagonal: core is import-free          │   visibility, paint)
                    └───────────────────┬─────────────────────┘
                                        ▼
                    ┌─────────────────────────────────────────┐
                    │  MOUTH    prose + structured             │  two projections
                    │  (src/adapters/emitter)                  │  of ONE truth
                    └───────────────────┬─────────────────────┘
                                        ▼
                    ┌─────────────────────────────────────────┐
                    │  PACKAGE INSERT   tool descriptions +    │  every claim
                    │  quickstart (src/interface/claims.js)    │  is proven
                    └─────────────────────────────────────────┘
```

- **Retina:** DOMPurify sanitize → headless Chromium (Playwright) → `getBBox` /
  `getBoundingClientRect` + computed style → quantized onto a letter-digit grid → AABB constraints.
- **Hexagonal contract:** all measurement lives in the adapter; the core (grid / arbitrate / diff /
  palette) imports nothing from adapters or interface. Reference truth comes from outside, never
  from the tool's own past output (anti-circular).
- **Tools:** `inspect`, `constraints`, `analyze`, `compare`, `bookmark`, `palette`, `arrange`,
  `status`, `selftest`.

---

## Honest Limitations

Mirror's promise is *"the eye does not lie about what it claims to see, and does not stay silent
about what it cannot see."* That means stating the blind spots plainly:

- **Pinned-engine determinism.** Byte-identity holds for a pinned Chromium version. Cross-version
  bit-stability is a standing, *not-yet-closed* watch.
- **Measurement space is the viewBox, not CSS pixels.** A visually distorted shape (round in
  viewBox, oval on screen) measures by its viewBox geometry. Declared, but easy to forget.
- **Display caps.** `inspect`/`analyze` show up to 7 elements; the rest are counted in `suppressed`
  but not individually addressable (no paging cursor yet). Hard limits: 500 DOM nodes / 100 KB.
- **Geometry-only motion flag (today).** The motion axis flags clock-rooted SMIL *geometry*; a
  purely blinking (`opacity`) or color-animating (`fill`) element can currently return a static
  value. On the roadmap.
- **Constraints check the geometric bbox**, not `visual_bbox` — paint overflow is reported
  separately, not folded into `INSIDE`.
- **Prose channel language.** The structured/tool layer is English; the layout-prose vocabulary
  is currently German. Full English prose projection is a v1.1 item.
- **Mask/clip geometry, `<use>` shadow edges** and a few other surfaces are over-flagged
  (`indeterminate` / `not_measurable`) rather than silently guessed.

We list these because honesty is the product. Several are tracked as issues — see the roadmap.

---

## Roadmap (teaser)

The eye is declared healthy on its known blind-spot denominator; the growth epoch is open. Next
super-powers (deterministic + non-generating, like an eye gaining night-vision or zoom):

- a paging cursor / `limits` section so suppressed elements are addressable;
- a full paint/opacity/fill **time axis** (not just SMIL geometry);
- machine-readable measurement constants (tolerance, grid rule, color-snap distance);
- the optional **docking station** — a deterministic correction loop that drives one measured gap
  to a brain-given goal (lives *downstream* of the eye, physically separate);
- full English prose projection (v1.1).

---

## License

[MIT](./LICENSE) © c64dos-png

<!-- The brain decides; the eye only measures. "It's in the eye of the beholder: if the eye is
     healthy, the beholder can do whatever they want with it." -->
