/**
 * RELAIS-Probe (JS-API) — DISTANCE-FROM-Einheit: euklidische Lücke ≥ N ×
 * Zellbreite.
 *
 * Claim: C-GLO-05 (claims.js). Belegt K-30 als 3-Punkt-Kongruenz:
 *   Identische Pixel-Lücke (100px), drei Canvas-Breiten ⇒ drei Zellbreiten
 *   (800/16=50 · 320/6≈53.3 · 1600/16=100); das Verdikt folgt EXAKT der
 *   Formel Lücke ≥ N × (Canvas-Breite ÷ Grid-Spalten):
 *     800er:  N=2 (100≥100) PASS · N=3 (150)  FAIL
 *     320er:  N=2 (≈106.7)  FAIL
 *     1600er: N=1 (100≥100) PASS · N=2 (200)  FAIL
 *   §P7 (Opus): die Diagonale — der Abstand ist EUKLIDISCH über die
 *   AABB-Lücke (sqrt(gapX²+gapY²)), nicht achsen-getrennt:
 *     gapX=60, gapY=80 ⇒ Distanz 100: N=2 (Soll 100) PASS — eine
 *     Achsen-Metrik (max(60,80)=80 < 100) würde FAIL liefern; N=2.2
 *     (Soll 110 > 100) FAIL.
 *
 * Eigenständig, deterministisch, Exit 1 wenn rot.
 */
import * as M from '../../src/pipeline.js';

const svgFor = (w) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} 100" width="${w}" height="100">` +
  '<rect id="a" x="10" y="10" width="50" height="30" fill="red"/>' +
  '<rect id="b" x="160" y="10" width="50" height="30" fill="blue"/></svg>'; // Lücke: 160-60 = 100px

let failCount = 0;
function assert(name, cond, ist) {
  const verdict = cond ? 'PASS' : 'FAIL';
  if (!cond) failCount += 1;
  console.log(`ASSERT ${name}: ${verdict} — ist: ${ist}`);
}

async function verdict(w, n) {
  const r = await M.analyze(svgFor(w), [`#a DISTANCE-FROM #b ${n}`]);
  const grid = r.structured?.scene?.grid;
  const status = r.structured?.status;
  console.log(`OBS canvas=${w} grid=${grid} N=${n} status=${status}`);
  return { grid, status };
}

try {
  await M.init();

  const p1 = await verdict(800, 2);
  assert('800_grid_16_spalten', p1.grid?.startsWith('16x'), p1.grid);
  assert('800_N2_pass (100 >= 2*50)', p1.status === 'PASS', p1.status);
  const p2 = await verdict(800, 3);
  assert('800_N3_fail (100 < 3*50)', p2.status === 'FAIL', p2.status);

  const p3 = await verdict(320, 2);
  assert('320_grid_6_spalten', p3.grid?.startsWith('6x'), p3.grid);
  assert('320_N2_fail (100 < 2*53.3)', p3.status === 'FAIL', p3.status);

  const p4 = await verdict(1600, 1);
  assert('1600_grid_16_spalten', p4.grid?.startsWith('16x'), p4.grid);
  assert('1600_N1_pass (100 >= 1*100)', p4.status === 'PASS', p4.status);
  const p5 = await verdict(1600, 2);
  assert('1600_N2_fail (100 < 2*100)', p5.status === 'FAIL', p5.status);

  // §P7 Diagonale: a endet bei (60|40), b beginnt bei (120|120) ⇒ gapX=60,
  // gapY=80, euklidisch sqrt(60²+80²)=100; Zellbreite 800/16=50.
  const DIAG =
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 200" width="800" height="200">' +
    '<rect id="a" x="10" y="10" width="50" height="30" fill="red"/>' +
    '<rect id="b" x="120" y="120" width="50" height="30" fill="blue"/></svg>';
  const d1 = await M.analyze(DIAG, ['#a DISTANCE-FROM #b 2']);
  console.log(`OBS diagonal N=2 status=${d1.structured?.status}`);
  assert(
    'diagonal_euklidisch_N2_pass (sqrt(60²+80²)=100 >= 100; Achsen-Metrik wäre FAIL)',
    d1.structured?.status === 'PASS',
    d1.structured?.status,
  );
  const d2 = await M.analyze(DIAG, ['#a DISTANCE-FROM #b 2.2']);
  console.log(`OBS diagonal N=2.2 status=${d2.structured?.status}`);
  assert(
    'diagonal_N2.2_fail (100 < 110)',
    d2.structured?.status === 'FAIL',
    d2.structured?.status,
  );
} finally {
  await M.shutdown();
}

if (failCount > 0) {
  console.log(`RELAIS-PROBE einheiten_distance: ROT (${failCount} FAIL)`);
  process.exit(1);
} else {
  console.log('RELAIS-PROBE einheiten_distance: GRUEN');
  process.exit(0);
}
