/**
 * _schema.js — Constraint Output Contract (REGEL-3 Caller-Boundary Gate)
 *
 *
 * Zweck:
 *   REGEL-3 "Spotter-Anti-Luege" (CONSTANTS.md Z.116) maschinen-mässig
 *   erzwingen. Jeder Constraint, dessen check() ein fail-Verdict liefert,
 *   MUSS strukturierte Pixel-Korrekturen (dx oder dy) zurueckgeben — nicht
 *   nur Prosa. Bis Sprint-β3 war REGEL-3 textuelle Konvention; jetzt ist
 *   sie via Zod-Schema kodiert und durch loader.validatedCheckConstraint
 *   testbar.
 *
 * Vertrag:
 *   - pass=true   → keine Pixel-Korrektur erwartet (detail darf null sein)
 *   - pass=false  → MUSS mindestens dx ODER dy enthalten (oder beide)
 *
 * REGEL-4 Hexagonal:
 *   - Modul ist Layer "core/" — darf NUR aus core/ oder Pure-Libraries
 *     importieren. Hier: ausschliesslich `zod` (Pure-Library, transport-
 *     agnostisch). KEIN Import aus adapters/ oder interface/.
 *
 * Adressiert Audit-Welle-β:
 *   WELLE-β-004 (DISTANCE-FROM ohne dx/dy — REGEL-3-Asymmetrie zu
 *               kanonischen Constraints CENTERED-IN/ALIGNED-LEFT).
 *
 * DEPENDS: zod
 */
import { z } from 'zod';

/**
 * constraintCheckSchema — Zod-Output-Vertrag fuer alle Constraint .check()-Resultate.
 *
 * Aufbau:
 *   - Basis (z.object): pass:boolean, detail:string|null.
 *   - .and(z.union(...)): diskriminiert nach pass-Wert.
 *       Branch 1 (pass=true):  KEINE Pflicht zu dx/dy.
 *       Branch 2 (pass=false): refine erzwingt dx ODER dy (optional beide,
 *                              aber mindestens eins).
 *
 * REGEL-3-Pflicht bei pass=false (TYP-EHRLICH, maintainer decision S2b
 * Step-0, D-007):
 *   - spatial-Constraints (CENTERED-IN, ALIGNED-*, DISTANCE-FROM, …):
 *     mindestens `dx` ODER `dy`.
 *   - Resize-Constraints (SAME-SIZE): erfuellen REGEL-3 mit `dw` ODER `dh`
 *     (Groessen-Delta ist ihre kanonische strukturierte Korrektur).
 *   - non-spatial-Constraints (COLOR): haben KEINEN Pixel-Delta. Sie tragen
 *     einen expliziten `non_spatial: true`-Marker und sind damit von der
 *     Delta-Pflicht ausgenommen. Der Marker ist self-describing (lokal vom
 *     Constraint deklariert, kein zentraler Typ-Katalog im Schema → keine
 *     Drift). OHNE Marker bleibt die Delta-Pflicht streng: ein spatial/resize-
 *     Constraint, der weder Delta noch Marker liefert, wirft weiterhin
 *     (keine Prosa-only-Antwort fuer mess-bare Constraints).
 */
export const constraintCheckSchema = z
  .object({
    pass: z.boolean(),
    detail: z.string().nullable(),
  })
  .and(
    z.union([
      // pass=true: keine Korrektur-Daten erwartet
      z.object({ pass: z.literal(true) }),
      // pass=false: REGEL-3 verlangt strukturierte Korrektur — (dx|dy) ODER
      // (dw|dh) — ausser der Constraint markiert sich als non_spatial.
      z
        .object({
          pass: z.literal(false),
          dx: z.number().optional(),
          dy: z.number().optional(),
          dw: z.number().optional(),
          dh: z.number().optional(),
          // non-spatial-Marker (COLOR): nimmt den Constraint von der
          // Pixel-Delta-Pflicht aus. Muss explizit `true` sein.
          non_spatial: z.literal(true).optional(),
        })
        .refine(
          (v) =>
            v.non_spatial === true ||
            v.dx !== undefined ||
            v.dy !== undefined ||
            v.dw !== undefined ||
            v.dh !== undefined,
          {
            message:
              'REGEL-3: fail-Verdict MUSS strukturierte Korrektur liefern — dx/dy (spatial) ODER dw/dh (resize) ODER non_spatial:true (z.B. COLOR). Keine Prosa-only-Antwort fuer mess-bare Constraints.',
          },
        ),
    ]),
  );
