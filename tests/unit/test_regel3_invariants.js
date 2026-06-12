/**
 * test_regel3_invariants.js — REGEL-3 Property-Based Drift-Verhinderung
 *
 *
 * Zweck:
 *   Mechanische Drift-Verhinderung fuer die 3 REGEL-3-Cluster-Invarianten,
 *   die in Audit-Welle-β als HIGH-Findings aufgedeckt wurden. fast-check
 *   generiert zufaellige Eingaben innerhalb des Vertragsraums und prueft,
 *   dass die Invariante fuer ALLE Eingaben gilt. Counterexample-Shrinking
 *   liefert minimale Fail-Reproduktion bei kuenftigem Code-Regress.
 *
 * Invarianten:
 *   INV-1 (β-002 Cross-Field): Wenn corrections[i].element auf scene.elements
 *         mit bbox_reliability ∈ {'not_measurable','approximate'} verweist,
 *         dann DARF dx/dy/dw/dh in corrections[i] NICHT existieren.
 *         (Re-formuliert als Postcondition auf analyzeOutputCompound.)
 *
 *   INV-2 (β-003 Hoist): Wenn elements.length > SCENE_MAX_ELEMENTS UND
 *         mindestens ein Element auf Position >= SCENE_MAX_ELEMENTS warnings
 *         traegt, dann ist meta.truncated_warnings nicht leer UND enthaelt
 *         genau die verschobenen warning-Eintraege.
 *
 *   INV-3 (β-004 Constraint-Output-Vertrag): Fuer JEDES check()-Resultat
 *         eines registrierten Constraints — sofern pass=false — gilt:
 *         dx ODER dy ist definiert. Scoped auf DISTANCE-FROM (Sprint-β3-Scope,
 *         siehe WORKLOG §3 Andon-Cord-#3-Notiz: SAME-SIZE + COLOR sind Pre-
 *         Existing und werden in getrenntem Sprint adressiert).
 *
 * Aufruf:
 *   node tests/unit/test_regel3_invariants.js
 *
 * DEPENDS: fast-check (devDep), src/interface/schema.js, src/adapters/emitter/structured.js,
 *          src/core/constraints/loader.js
 */
import fc from 'fast-check';
import { formatStructured } from '../../src/adapters/emitter/structured.js';
import { constraintCheckSchema } from '../../src/core/constraints/_schema.js';
import { validatedCheckConstraint } from '../../src/core/constraints/loader.js';
import { analyzeOutputCompound } from '../../src/interface/schema.js';

const NUM_RUNS = 100; // default fast-check; bei flakes erhoehen
const SCENE_MAX_ELEMENTS = 7;

let passCount = 0;
let failCount = 0;
function assertProp(label, run) {
  try {
    run();
    console.log(`  PASS: ${label}`);
    passCount++;
  } catch (e) {
    console.error(`  FAIL: ${label}\n    ${e.message}`);
    failCount++;
  }
}

// ── Arbitraries ──────────────────────────────────────────────────────────

const arbBboxReliability = fc.constantFrom(
  'reliable',
  'approximate',
  'not_measurable',
);

const arbElementStatus = fc.constantFrom('ok', 'fail', 'warn');

const arbElement = fc.record({
  id: fc
    .string({ minLength: 1, maxLength: 8 })
    .filter((s) => /^[A-Za-z][A-Za-z0-9_]*$/.test(s)),
  tag: fc.constantFrom('rect', 'circle', 'text', 'ellipse'),
  cell: fc.string({ minLength: 1, maxLength: 4 }),
  color: fc.constantFrom('red', 'blue', 'green', 'black', 'white'),
  status: arbElementStatus,
  bbox_reliability: arbBboxReliability,
  warnings: fc.option(
    fc.array(
      fc.constantFrom(
        '3D_TRANSFORM_ANCESTOR',
        'CSS_TRANSFORM_2D_FLOAT_DRIFT',
        'OPACITY_GREY_ZONE',
        'TEXT_DOMINANT_BASELINE_SHIFT',
      ),
      { minLength: 0, maxLength: 3 },
    ),
    { nil: undefined },
  ),
});

// IDs muessen eindeutig sein — z.uniqueArray-Aequivalent fuer fast-check
const arbElementArrayUnique = (minSize, maxSize) =>
  fc
    .array(arbElement, { minLength: minSize, maxLength: maxSize })
    .filter((arr) => new Set(arr.map((e) => e.id)).size === arr.length);

// ── INV-1: Cross-Field-Postcondition (β-002) ──────────────────────────────
console.log('--- REGEL-3 INV-1: correction.element + bbox_reliability ---');
{
  // Property: ein konstruierter Output, der die Invariante WAHRT, muss
  // analyzeOutputCompound passieren. Ein konstruierter Output, der sie
  // BRICHT, muss rejected werden.
  assertProp('analyzeOutputCompound akzeptiert valides Output', () => {
    fc.assert(
      fc.property(arbElementArrayUnique(1, 5), (elements) => {
        // Filter: corrections nur auf reliable-Elemente mit dx/dy
        const reliableEls = elements.filter(
          (e) => e.bbox_reliability === 'reliable',
        );
        const corrections = reliableEls.map((e) => ({
          element: `#${e.id}`,
          tag: e.tag,
          constraint: 'CENTERED-IN',
          reference: null,
          dx: 5,
          dy: -3,
        }));
        const candidate = {
          status: 'FAIL',
          iteration: {
            sequence: 1,
            previous_issues: 0,
            current_issues: corrections.length,
            total_issues: corrections.length,
            returned_issues: corrections.length,
            suppressed: 0,
            convergence: 'STAGNATING',
            analysisId: '00000000-0000-4000-8000-000000000000',
          },
          scene: { width: 100, height: 100, grid: '4x4', elements },
          corrections,
          unchecked: [],
          diff: [],
        };
        const r = analyzeOutputCompound.safeParse(candidate);
        return r.success;
      }),
      { numRuns: NUM_RUNS },
    );
  });

  assertProp('analyzeOutputCompound rejectet not_measurable+dx', () => {
    fc.assert(
      fc.property(
        arbElement.filter((e) => true),
        fc.integer({ min: -50, max: 50 }),
        (el, dxVal) => {
          if (dxVal === 0) dxVal = 1; // dx undefined-Detection nicht stören
          const bad = {
            status: 'FAIL',
            iteration: {
              sequence: 1,
              previous_issues: 0,
              current_issues: 1,
              total_issues: 1,
              returned_issues: 1,
              suppressed: 0,
              convergence: 'STAGNATING',
              analysisId: '00000000-0000-4000-8000-000000000000',
            },
            scene: {
              width: 100,
              height: 100,
              grid: '4x4',
              elements: [{ ...el, bbox_reliability: 'not_measurable' }],
            },
            corrections: [
              {
                element: `#${el.id}`,
                tag: el.tag,
                constraint: 'CENTERED-IN',
                reference: null,
                dx: dxVal,
              },
            ],
            unchecked: [],
            diff: [],
          };
          const r = analyzeOutputCompound.safeParse(bad);
          // MUSS rejected werden (REGEL-3-Verletzung)
          return r.success === false;
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });
}

// ── INV-2: truncated_warnings-Hoist (β-003) ──────────────────────────────
console.log('--- REGEL-3 INV-2: structured.js truncated_warnings-Hoist ---');
{
  // Property: bei >7 Elementen mit warning auf Position >=7 in der Original-
  // Reihenfolge wird das Element in meta.truncated_warnings sichtbar UND
  // der status ist nicht PASS (PARTIAL bei keinem failing).
  assertProp(
    'truncated_warnings: warning auf Position>=7 wird gehoisted',
    () => {
      fc.assert(
        fc.property(
          // Generiere mindestens 8 unique elements
          arbElementArrayUnique(8, 12),
          (elements) => {
            // Stelle sicher, dass mindestens 1 warning-traegt UND auf Pos >= 7 liegt.
            // Wir setzen Pos 8 (Index 7+) auf garantiert warning-tragend.
            const taggedElements = elements.map((el, idx) => {
              if (idx >= SCENE_MAX_ELEMENTS) {
                return {
                  ...el,
                  bbox_reliability: 'not_measurable',
                  warnings: ['3D_TRANSFORM_ANCESTOR'],
                };
              }
              // Erste 7 ohne warnings (deterministisch sauber).
              return {
                ...el,
                bbox_reliability: 'reliable',
                warnings: undefined,
              };
            });
            // structured.js erwartet gridMap mit canvas + elements
            const gridMap = {
              canvas: { width: 100, height: 100 },
              grid: { cellsX: 4, cellsY: 4 },
              elements: taggedElements,
            };
            const arbitrated = {
              failing: [],
              unchecked: [],
              diff: [],
              totals: {},
            };
            const out = formatStructured(gridMap, arbitrated, {
              analysisId: '00000000-0000-4000-8000-000000000000',
            });
            // 1) meta.truncated_warnings ist gesetzt und nicht-leer
            const hoistOK =
              out.meta &&
              Array.isArray(out.meta.truncated_warnings) &&
              out.meta.truncated_warnings.length >=
                taggedElements.length - SCENE_MAX_ELEMENTS;
            // 2) status ist nicht PASS (failing=0 → PARTIAL wegen Hoist)
            const statusOK = out.status === 'PARTIAL';
            // 3) Jede hoisted entry hat position >= 7
            const positionsOK = out.meta.truncated_warnings.every(
              (e) => e.position >= SCENE_MAX_ELEMENTS,
            );
            return hoistOK && statusOK && positionsOK;
          },
        ),
        { numRuns: NUM_RUNS },
      );
    },
  );

  assertProp('truncated_warnings: leeres elements-Array → meta absent', () => {
    fc.assert(
      fc.property(arbElementArrayUnique(1, 7), (elements) => {
        const cleanEls = elements.map((el) => ({
          ...el,
          bbox_reliability: 'reliable',
          warnings: undefined,
        }));
        const gridMap = {
          canvas: { width: 100, height: 100 },
          grid: { cellsX: 4, cellsY: 4 },
          elements: cleanEls,
        };
        const arbitrated = { failing: [], unchecked: [], diff: [], totals: {} };
        const out = formatStructured(gridMap, arbitrated, {
          analysisId: '00000000-0000-4000-8000-000000000000',
        });
        // <=7 Elemente und keine warnings → kein meta-Block
        return out.meta === undefined && out.status === 'PASS';
      }),
      { numRuns: NUM_RUNS },
    );
  });
}

// ── INV-3: DISTANCE-FROM REGEL-3-Vertrag (β-004) ─────────────────────────
console.log('--- REGEL-3 INV-3: DISTANCE-FROM dx/dy Pflicht bei fail ---');
{
  // Scope: DISTANCE-FROM. Generiert bbox-Konfigurationen, die DISTANCE-FROM
  // brechen, und prueft zwei Aspekte:
  //   (a) Praesenz: pass=false → dx ODER dy gesetzt (REGEL-3-Schema).
  //   (b) Korrektheit (F-CODEX-B3-001 Patch-1 + F-CODEX-Re-Review-F3 Patch-2):
  //       Nach REALER AABB-Translation der subj-bbox um (dx, dy) MUSS
  //       newDist >= expectedDist gelten. KEINE 1D-Addition (gapX + |dx|)!
  //       Begruendung: bei Ueberlappung (gapX=0, subj.x < ref.x+ref.w) ist
  //       gapX + |dx| OPTIMISTISCH — der reale neue Gap = max(0, subj_new.x -
  //       (ref.x+ref.w)) ist KLEINER, weil subj zuerst die Ueberlappung
  //       ueberbruecken muss. F-3-Probe: ref=subj=(0,0,10,10), expected=20.
  //       Patch-1 liefert dx=20 → 1D-Form: 0+20=20 PASS. Reale AABB: subj
  //       wird zu (20,0,10,10), AABB-gapX = 20-10 = 10 < 20 FAIL.
  // S2b-Step-0-Update (D-007): SAME-SIZE + COLOR sind NICHT mehr Pre-Existing-
  // Brueche. Der Output-Vertrag ist jetzt TYP-EHRLICH — SAME-SIZE erfuellt
  // REGEL-3 mit dw/dh, COLOR ist non-spatial (non_spatial:true-Marker). Beide
  // sind unten in INV-3b explizit als "wirft-nicht-mehr" abgesichert.
  // Korrektheits-Check (b) gilt NUR fuer DISTANCE-FROM (Vector-Scaling-
  // Constraints). CENTERED-IN hat andere Semantik (zentrums-relative
  // Offset-Korrektur, nicht Push-Distanz) → bleibt auf Praesenz-Test (a).
  assertProp(
    'DISTANCE-FROM check fail → dx oder dy gesetzt + AABB-recompute >= expectedDist',
    () => {
      fc.assert(
        fc.property(
          // Generator-Wahl (F-CODEX-Re-Review-F3, Patch-2):
          // Geometry-Variant deckt 3 Faelle ab:
          //   'separated'        – AABB-Gap > 0 in beiden Achsen
          //   'corner-touch'     – AABB-Gap = 0, aber separiert (Eckberuehrung)
          //   'fully-overlapping'– subj == ref exakt (F-3-Pathologie)
          // Damit ist sowohl der Vector-Scaling-Pfad als auch der
          // actualDist==0-Pfad in distance.js abgedeckt.
          fc.record({
            geom: fc.constantFrom(
              'separated',
              'corner-touch',
              'fully-overlapping',
            ),
            gapX: fc.integer({ min: 0, max: 100 }),
            gapY: fc.integer({ min: 0, max: 100 }),
            expected: fc.integer({ min: 1, max: 200 }),
          }),
          ({ geom, gapX, gapY, expected }) => {
            // Konstruiere subj/ref deterministisch je Geometry-Variante:
            const ref = { bbox: { x: 0, y: 0, w: 10, h: 10 } };
            let subj;
            if (geom === 'separated') {
              // ref @ (0,0,10,10), subj @ (10+gapX, 10+gapY, 10, 10)
              // → AABB-Gap = (gapX, gapY). Bei gapX==gapY==0: corner-touch.
              subj = { bbox: { x: 10 + gapX, y: 10 + gapY, w: 10, h: 10 } };
            } else if (geom === 'corner-touch') {
              // Beide Boxen beruehren sich in einer Ecke: gapX=gapY=0,
              // actualDist=0, ABER nicht ueberlappend.
              subj = { bbox: { x: 10, y: 10, w: 10, h: 10 } };
            } else {
              // 'fully-overlapping': subj komplett identisch ref.
              // F-3-Pathologie: actualDist=0, raeumliche Ueberlappung.
              subj = { bbox: { x: 0, y: 0, w: 10, h: 10 } };
            }
            // grid.cellW so waehlen, dass expectedDist = expected (value=1).
            const grid = {
              cellW: expected,
              cellH: expected,
              cellsX: 4,
              cellsY: 4,
            };
            try {
              const r = validatedCheckConstraint('DISTANCE-FROM', subj, ref, {
                grid,
                value: 1,
              });
              // Sanity: aktuellen Distanz-Wert berechnen (AABB-Gap)
              const aabbGap = (a, b) =>
                Math.max(
                  0,
                  Math.max(a.bbox.x, b.bbox.x) -
                    Math.min(a.bbox.x + a.bbox.w, b.bbox.x + b.bbox.w),
                );
              const aabbGapY = (a, b) =>
                Math.max(
                  0,
                  Math.max(a.bbox.y, b.bbox.y) -
                    Math.min(a.bbox.y + a.bbox.h, b.bbox.y + b.bbox.h),
                );
              const curGapX = aabbGap(subj, ref);
              const curGapY = aabbGapY(subj, ref);
              const actualDist = Math.sqrt(
                curGapX * curGapX + curGapY * curGapY,
              );
              if (r.pass === true) {
                // Sanity: in dem Fall MUSS actualDist >= expected gelten
                return actualDist >= expected;
              }
              // (a) Praesenz: dx ODER dy MUSS gesetzt sein
              const presenceOK = r.dx !== undefined || r.dy !== undefined;
              if (!presenceOK) return false;
              // (b) Korrektheit: REALE AABB-Translation, NICHT 1D-Addition.
              //     subj_new = (subj.x+dx, subj.y+dy, subj.w, subj.h)
              //     newGap   = AABB-Gap(subj_new, ref)
              //     newDist  = sqrt(newGapX^2 + newGapY^2)
              const dx = r.dx || 0;
              const dy = r.dy || 0;
              const subjNew = {
                bbox: {
                  x: subj.bbox.x + dx,
                  y: subj.bbox.y + dy,
                  w: subj.bbox.w,
                  h: subj.bbox.h,
                },
              };
              const newGapX = aabbGap(subjNew, ref);
              const newGapY = aabbGapY(subjNew, ref);
              const newDist = Math.sqrt(newGapX * newGapX + newGapY * newGapY);
              const correctnessOK = newDist >= expected;
              return correctnessOK;
            } catch (e) {
              // validatedCheckConstraint wirft NUR bei REGEL-3-Bruch
              // → INV-3-Verletzung
              return false;
            }
          },
        ),
        { numRuns: NUM_RUNS },
      );
    },
  );

  // Positive Kontrolle: CENTERED-IN ist konform (sanity)
  assertProp(
    'CENTERED-IN check fail → dx ODER dy gesetzt (Kontroll-Test)',
    () => {
      fc.assert(
        fc.property(
          fc.record({
            sx: fc.integer({ min: 0, max: 100 }),
            sy: fc.integer({ min: 0, max: 100 }),
            sw: fc.integer({ min: 1, max: 20 }),
            sh: fc.integer({ min: 1, max: 20 }),
            rx: fc.integer({ min: 0, max: 100 }),
            ry: fc.integer({ min: 0, max: 100 }),
            rw: fc.integer({ min: 30, max: 50 }),
            rh: fc.integer({ min: 30, max: 50 }),
          }),
          ({ sx, sy, sw, sh, rx, ry, rw, rh }) => {
            const subj = { bbox: { x: sx, y: sy, w: sw, h: sh } };
            const ref = { bbox: { x: rx, y: ry, w: rw, h: rh } };
            const grid = { cellW: 50, cellH: 50, cellsX: 4, cellsY: 4 };
            try {
              const r = validatedCheckConstraint('CENTERED-IN', subj, ref, {
                grid,
              });
              if (r.pass === true) return true;
              return r.dx !== undefined || r.dy !== undefined;
            } catch (e) {
              return false;
            }
          },
        ),
        { numRuns: NUM_RUNS },
      );
    },
  );
}

// ── INV-3b: SAME-SIZE (resize) + COLOR (non-spatial) wirft nicht mehr ─────
// S2b-Step-0 (D-007): validatedCheckConstraint WARF bisher bei jedem failing
// SAME-SIZE (nur dw/dh) und COLOR (kein Delta), weil _schema.js HART dx|dy
// verlangte. Jetzt ist der Vertrag typ-ehrlich: Resize=dw/dh, COLOR=non_spatial.
// Diese Tests belegen die "vorher-wirft / nachher-nicht"-Stop-Condition direkt.
console.log('--- REGEL-3 INV-3b: SAME-SIZE + COLOR wirft nicht mehr ---');
{
  // SAME-SIZE: failing liefert nur dw/dh (kein dx/dy) → MUSS validieren.
  assertProp(
    'validatedCheckConstraint(SAME-SIZE, failing) wirft NICHT (dw/dh erfuellen REGEL-3)',
    () => {
      const subj = {
        id: 's',
        bbox: { x: 0, y: 0, w: 106, h: 106 },
        color: 'red',
      };
      const ref = {
        id: 'r',
        bbox: { x: 0, y: 0, w: 100, h: 100 },
        color: 'blue',
      };
      const grid = { cellW: 50, cellH: 50 };
      const r = validatedCheckConstraint('SAME-SIZE', subj, ref, { grid });
      if (r.pass !== false)
        throw new Error(`erwartet pass=false, got pass=${r.pass}`);
      if (r.dw === undefined && r.dh === undefined)
        throw new Error('SAME-SIZE failing ohne dw/dh');
      // REGEL-3 typ-ehrlich: KEIN dx/dy noetig (resize-Constraint).
    },
  );

  // COLOR: failing liefert keinen Pixel-Delta, nur non_spatial-Marker → MUSS validieren.
  assertProp(
    'validatedCheckConstraint(COLOR, failing) wirft NICHT (non_spatial-Marker)',
    () => {
      const subj = {
        id: 's',
        color: 'red',
        bbox: { x: 0, y: 0, w: 10, h: 10 },
      };
      const r = validatedCheckConstraint('COLOR', subj, null, {
        value: 'blue',
      });
      if (r.pass !== false)
        throw new Error(`erwartet pass=false, got pass=${r.pass}`);
      if (r.non_spatial !== true)
        throw new Error('COLOR failing ohne non_spatial:true-Marker');
      if (r.dx !== undefined || r.dy !== undefined)
        throw new Error('COLOR (non-spatial) darf keinen Pixel-Delta tragen');
    },
  );

  // COLOR ohne value (fehlender Farbwert) → ebenfalls failing + non_spatial.
  assertProp(
    'validatedCheckConstraint(COLOR, kein value) wirft NICHT (non_spatial-Marker)',
    () => {
      const subj = {
        id: 's',
        color: 'red',
        bbox: { x: 0, y: 0, w: 10, h: 10 },
      };
      const r = validatedCheckConstraint('COLOR', subj, null, {});
      if (r.pass !== false)
        throw new Error(`erwartet pass=false, got pass=${r.pass}`);
      if (r.non_spatial !== true)
        throw new Error('COLOR (kein value) ohne non_spatial:true-Marker');
    },
  );

  // Negativ-Kontrolle: ein spatial-Constraint OHNE Delta UND OHNE Marker MUSS
  // weiterhin werfen (Prosa-only-Verbot bleibt streng fuer mess-bare Constraints).
  assertProp(
    'Prosa-only spatial-fail (kein Delta, kein Marker) wirft WEITERHIN',
    () => {
      // constraintCheckSchema direkt: simuliert ein hypothetisches fail-Resultat
      // ohne strukturierte Korrektur und ohne non_spatial-Marker.
      const r = constraintCheckSchema.safeParse({
        pass: false,
        detail: 'nur prosa, kein delta',
      });
      if (r.success)
        throw new Error(
          'Schema akzeptierte prosa-only spatial-fail — REGEL-3 verletzt',
        );
    },
  );
}

console.log(`\nErgebnis: ${passCount} bestanden, ${failCount} fehlgeschlagen`);
process.exit(failCount === 0 ? 0 : 1);
