/**
 * distance.js - DISTANCE-FROM Constraint
 * Migrated from mirror.js:94-102
 * Vector Mirror v2.0
 * Uses ctx.value (multiplier, default 1) + ctx.grid
 */
import { registerConstraint } from './registry.js';

registerConstraint('DISTANCE-FROM', {
  check(subj, ref, { grid, value }) {
    const gapX = Math.max(
      0,
      Math.max(subj.bbox.x, ref.bbox.x) -
        Math.min(subj.bbox.x + subj.bbox.w, ref.bbox.x + ref.bbox.w),
    );
    const gapY = Math.max(
      0,
      Math.max(subj.bbox.y, ref.bbox.y) -
        Math.min(subj.bbox.y + subj.bbox.h, ref.bbox.y + ref.bbox.h),
    );
    const actualDist = Math.sqrt(gapX * gapX + gapY * gapY);
    const targetValue = value ?? 1;
    // D-003: Ein negativer Ziel-Abstand ist eine INVALIDE Mess-Vorgabe — kein
    // physikalisch sinnvoller Abstand kann < 0 sein. Ohne diese Wache liefe
    // `actualDist >= expectedDist` mit expectedDist < 0 IMMER auf pass=true
    // hinaus (jede nicht-negative reale Distanz erfuellt eine negative Schranke),
    // d.h. das Auge meldete still "Alles korrekt" auf eine unmessbare Vorgabe.
    // Das verletzt Prinzip-3 (keine stille Korrektur/Beschoenigung im Auge):
    // wir CLAMPEN NICHT (das waere eine stille Korrektur der Vorgabe), sondern
    // reichen den Wert unveraendert durch und melden ehrlich Unmessbarkeit.
    // pass:null → arbitrate.js sortiert nach `unchecked`, NIE nach `passing`.
    if (targetValue < 0) {
      return {
        pass: null,
        reasonCode: 'INVALID_MEASUREMENT',
        reasonCategory: 'SPECIFICATION',
        detail: `Negativer Ziel-Abstand (${targetValue}) ist keine messbare Vorgabe — ein Abstand kann nicht < 0 sein.`,
      };
    }
    const expectedDist = targetValue * grid.cellW;
    const pass = actualDist >= expectedDist;
    const shortfall = expectedDist - actualDist;
    if (pass) {
      return { pass: true, detail: null };
    }
    //
    // + F-CODEX-Re-Review-F3 (Patch-2, 2026-05-31):
    // Strukturierte Pixel-Korrektur dx/dy zusaetzlich zur detail-Prosa.
    // REGEL-3 verlangt maschinenlesbare Deltas. INV-3 fordert Korrektheit:
    // nach REALER AABB-Translation MUSS actualDist_after >= expectedDist.
    //
    // Strategie: VECTOR-SCALING (nicht 1D-Dominant-Axis).
    //   Begruendung: Euklid-Distanz ist 2D. Die alte 1D-Dominant-Axis-Variante
    //   lieferte fuer gapX=gapY=10, expected=20 ein dx=6 → neue Distanz
    //   sqrt(16^2+10^2)=18.87 < 20 (Codex-Probe Patch-1). Korrekt ist
    //   Skalierung des AABB-Gap-Vektors auf expectedDist via
    //   factor = expectedDist/actualDist.
    //
    // Verifikation Codex-Probe (gapX=gapY=10, expected=20):
    //   actualDist=14.14, factor=1.414, rawDx=rawDy=4.14
    //   nach Apply: gap=(14.14,14.14), dist=19.99 ~ 20  ✓
    //
    // Sonderfaelle (in Reihenfolge):
    //   1) actualDist == 0 (Elemente raeumlich ueberlappend, gapX=gapY=0):
    //      Vector-Skalierung undefiniert. Push subj's linke (bzw. rechte) Kante
    //      auf ref's gegenueberliegende Kante + expectedDist.
    //      F-CODEX-Re-Review-F3-Fix:
    //        Patch-1 setzte dx = expectedDist. Bei subj=ref=(0,0,10,10),
    //        expected=20 → dx=20, neuer subj.x=20, AABB-gapX=20-10=10 → newDist=10 < 20  ✗
    //      Korrekt: targetSubjX = ref.x + ref.w + expectedDist (push rechts)
    //               dx = targetSubjX - subj.x = (ref.x + ref.w - subj.x) + expectedDist
    //      Verifikation F-3-Probe (subj=ref=(0,0,10,10), expected=20):
    //        dx = (0+10-0) + 20 = 30. Neuer subj.x=30. AABB-gapX=30-10=20.
    //        newDist=20 >= 20  ✓
    //      Sign-Wahl: signX aus centerDx (falls != 0), sonst default +1
    //      (push rechts, analog arrange()-Fallback Z.148).
    //   2) centerDx == 0 UND centerDy == 0 (identisch zentriert ABER mit gap>0,
    //      z.B. konzentrische Boxen): Sign-Vektor undefiniert. Push in X um
    //      shortfall (Konsistenz mit arrange()-Fallback). Hinweis: bei
    //      identisch zentrierten Boxen IST actualDist == 0 (gapX=gapY=0
    //      geometrisch zwingend), d.h. dieser Pfad ist defensiv und wird
    //      vom Sonderfall 1 oben bereits abgedeckt — bleibt nur fuer
    //      Floating-Point-Pathologie.
    //   3) Sonst: rawDx/rawDy = (factor-1) * gapX/gapY, Sign aus center-Relativ.
    //      Math.ceil fuer Korrektheit. Mindestens 1px nur wenn rawAchse != 0
    //      (kein Achsen-Push fuer perfekt-vertikale/horizontale Gaps mit gap=0).
    const sCx = subj.bbox.x + subj.bbox.w / 2;
    const sCy = subj.bbox.y + subj.bbox.h / 2;
    const rCx = ref.bbox.x + ref.bbox.w / 2;
    const rCy = ref.bbox.y + ref.bbox.h / 2;
    const centerDx = sCx - rCx;
    const centerDy = sCy - rCy;
    // G2 (D-006): detail beschreibt NUR das WAS/WIEVIEL-daneben (Ist-Distanz
    // vs. Soll-Distanz, Defizit). Die strukturierte Korrektur lebt
    // ausschliesslich in dx/dy — prose.js/structured.js bauen den
    // Korrektur-Hinweis aus diesen Feldern, nicht mehr aus dem detail-String.
    const detail = `Zu nah dran (${Math.round(actualDist)}px statt ${Math.round(expectedDist)}px, Defizit ~${Math.round(shortfall)}px)`;
    // Sonderfall 1: actualDist == 0 → keine Skalierung moeglich.
    // F-CODEX-Re-Review-F3-Fix: dx MUSS die raeumliche Ueberlappung +
    // expectedDist ueberwinden. Push entlang dominanter Achse (X bei
    // |centerDx|>=|centerDy|, sonst Y). Default +X bei centerDx==centerDy==0.
    if (actualDist === 0) {
      const dominantX = Math.abs(centerDx) >= Math.abs(centerDy);
      if (dominantX) {
        const signX = centerDx >= 0 ? 1 : -1;
        // signX>0: subj nach rechts. targetSubjX = ref.x + ref.w + expectedDist
        // signX<0: subj nach links.  targetSubjX = ref.x - subj.w - expectedDist
        const targetSubjX =
          signX > 0
            ? ref.bbox.x + ref.bbox.w + expectedDist
            : ref.bbox.x - subj.bbox.w - expectedDist;
        const rawDx = targetSubjX - subj.bbox.x;
        const dxRounded =
          rawDx >= 0 ? Math.ceil(rawDx) : -Math.ceil(Math.abs(rawDx));
        const dxFinal = dxRounded === 0 ? signX : dxRounded;
        return { pass: false, detail, dx: dxFinal };
      } else {
        const signY = centerDy >= 0 ? 1 : -1;
        const targetSubjY =
          signY > 0
            ? ref.bbox.y + ref.bbox.h + expectedDist
            : ref.bbox.y - subj.bbox.h - expectedDist;
        const rawDy = targetSubjY - subj.bbox.y;
        const dyRounded =
          rawDy >= 0 ? Math.ceil(rawDy) : -Math.ceil(Math.abs(rawDy));
        const dyFinal = dyRounded === 0 ? signY : dyRounded;
        return { pass: false, detail, dy: dyFinal };
      }
    }
    // Sonderfall 2: identisch zentriert (centerDx==0 AND centerDy==0).
    // Defensiv: geometrisch wird das bereits von Sonderfall 1 abgefangen
    // (centers identisch ⇒ gapX=gapY=0 ⇒ actualDist=0), bleibt nur fuer
    // Floating-Point-Pathologie.
    if (centerDx === 0 && centerDy === 0) {
      return {
        pass: false,
        detail,
        dx: Math.max(1, Math.round(shortfall)),
      };
    }
    // Vector-Scaling.
    const factor = expectedDist / actualDist; // > 1 weil pass=false
    const rawDx = (factor - 1) * gapX;
    const rawDy = (factor - 1) * gapY;
    // Sign aus center-Relativ (push-weg-vektor). Bei centerDx==0 (perfekt
    // vertikal ausgerichtet): rawDx ist ohnehin 0 (gapX==0 in dem Setup) →
    // sign-Wahl egal, dx=0.
    const signX = centerDx >= 0 ? 1 : -1;
    const signY = centerDy >= 0 ? 1 : -1;
    // Aufrunden (Math.ceil) statt Math.round gegen Rundungs-Defizit:
    // Math.round(4.142)=4 wuerde fuer Codex-Probe newDist=19.8 < 20 liefern
    // und INV-3-Korrektheit brechen. Math.ceil garantiert
    // newGap_axis >= raw_target → newDist >= expectedDist.
    // Mindest-Push 1px erfolgt nur wenn rawAchse != 0 (sonst wuerde ein
    // 1px-Push auf eine Achse ohne Gap kreiert, was semantisch falsch waere).
    let dx = 0;
    let dy = 0;
    if (rawDx !== 0) {
      const r = Math.ceil(Math.abs(rawDx));
      dx = Math.max(1, r) * signX;
    }
    if (rawDy !== 0) {
      const r = Math.ceil(Math.abs(rawDy));
      dy = Math.max(1, r) * signY;
    }
    // Mindestens eine der beiden Achsen MUSS != 0 sein (REGEL-3-Vertrag).
    // Wenn beide rawDx, rawDy == 0 waeren, waere actualDist == 0 — und das
    // ist oben (Sonderfall 1) bereits abgefangen. Defensiv: wenn doch beide
    // 0 (Floating-Point-Pathologie), fallback dx=1.
    if (dx === 0 && dy === 0) {
      dx = 1;
    }
    // Output: nur gesetzte Achsen aufnehmen (kanonische Form analog
    // centered-in.js — undefined statt 0 ist semantisch "keine Korrektion").
    const out = { pass: false, detail };
    if (dx !== 0) out.dx = dx;
    if (dy !== 0) out.dy = dy;
    return out;
  },
  arrange(subj, ref, { canvas, value }) {
    const cellsX = Math.max(4, Math.min(16, Math.round(canvas.width / 50)));
    const cellW = canvas.width / cellsX;
    const minDist = (value ?? 1) * cellW;

    // AABB gap metric — identical to check() for consistency (Audit Fix J)
    const gapX = Math.max(
      0,
      Math.max(subj.bbox.x, ref.bbox.x) -
        Math.min(subj.bbox.x + subj.bbox.w, ref.bbox.x + ref.bbox.w),
    );
    const gapY = Math.max(
      0,
      Math.max(subj.bbox.y, ref.bbox.y) -
        Math.min(subj.bbox.y + subj.bbox.h, ref.bbox.y + ref.bbox.h),
    );
    const actualDist = Math.sqrt(gapX * gapX + gapY * gapY);

    // Already far enough apart — no-op
    if (actualDist >= minDist) {
      return { x: subj.bbox.x, y: subj.bbox.y };
    }

    // Push along dominant axis (center-to-center direction)
    const sCx = subj.bbox.x + subj.bbox.w / 2;
    const sCy = subj.bbox.y + subj.bbox.h / 2;
    const rCx = ref.bbox.x + ref.bbox.w / 2;
    const rCy = ref.bbox.y + ref.bbox.h / 2;
    const dx = sCx - rCx;
    const dy = sCy - rCy;

    // Deterministic fallback for identical positions: push right (Audit Fix D)
    if (dx === 0 && dy === 0) {
      return { x: ref.bbox.x + ref.bbox.w + minDist, y: subj.bbox.y };
    }

    // Push along dominant axis so AABB gap = minDist
    if (Math.abs(dx) >= Math.abs(dy)) {
      const sign = dx >= 0 ? 1 : -1;
      const targetX =
        sign > 0
          ? ref.bbox.x + ref.bbox.w + minDist
          : ref.bbox.x - subj.bbox.w - minDist;
      return { x: targetX, y: subj.bbox.y };
    } else {
      const sign = dy >= 0 ? 1 : -1;
      const targetY =
        sign > 0
          ? ref.bbox.y + ref.bbox.h + minDist
          : ref.bbox.y - subj.bbox.h - minDist;
      return { x: subj.bbox.x, y: targetY };
    }
  },
});
