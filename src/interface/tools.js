/**
 * tools.js - MCP Tool Definitions and Handlers (transport-agnostic)
 * Vector Mirror v2.0 Phase 2
 *
 * Interface module: Exports { name, config, handler } per tool.
 * BAUPLAN ref: Sektion 5 (Tools), 5.1 (Annotations), 7.3 (Architecture Separation), 9.3 (Descriptions)
 * DEPENDS: pipeline.js, interface/schema.js
 */
import {
  analyze,
  analyzeErrorStructured,
  arrange,
  bookmark,
  compare,
  getConstraintTypes,
  getStatus,
  init,
  inspect,
  NO_BASELINE_HINT,
  palette,
  runSelftest,
} from '../pipeline.js';
// §RELAIS (an internal spec §0/§1) + P2/S1b Ein-Leib: die VOLLSTÄNDIGEN
// Descriptions sind PROJEKTIONEN des Claims-Registers (claims.js — die eine
// Quelle; Blöcke 1–3+5 via BLOCKS, Eigenheiten via EIGENHEITEN). tools.js
// trägt KEINEN Description-Freitext mehr. Drift ist doppelt unmöglich: per
// Konstruktion (Import) + per Protokoll-Selftest (tests/relais_red/
// selftest_claims.mjs, S1 Wortidentität / S1b Vollstring-Pin / S2 Deckung).
import { DESCRIPTIONS } from './claims.js';
import {
  analyzeInput,
  analyzeOutput,
  arrangeInput,
  arrangeOutput,
  bookmarkInput,
  bookmarkOutput,
  compareInput,
  constraintsInput,
  constraintsOutput,
  inspectInput,
  inspectOutput,
  paletteInput,
  paletteOutput,
  selftestInput,
  selftestOutput,
  statusInput,
  statusOutput,
} from './schema.js';

// ── ERROR RESPONSE HELPERS ──────────────────────────────────

/** Schema-conformant error response for analyze/compare (outputSchema: analyzeOutput).
 *  §H9 P2: die Hülle kommt aus pipeline.js#analyzeErrorStructured — EINE Quelle
 *  statt physischer Kopie. Der frühere Inline-Spiegel trug denselben
 *  Selbst-Widerspruch (isError:true + convergence:'SOLVED' + erfundene
 *  randomUUID-analysisId); die wahre Form (null/null) lebt jetzt an genau
 *  einem Ort und gilt für JS-API- und MCP-Rand identisch.
 *  §6 RELAIS: optionales error{code,hint} aus der pipeline-Quelle wird additiv
 *  eingebettet (NUR im isError-Pfad präsent; Parity: prose trägt den hint). */
function analyzeErrorResponse(prose, error) {
  return {
    content: [{ type: 'text', text: prose }],
    structuredContent: {
      ...analyzeErrorStructured(),
      ...(error ? { error } : {}),
    },
    isError: true,
  };
}

/** Schema-conformant error response for inspect (outputSchema: inspectOutput).
 *  §P2: scene.suppressed ist in inspectOutput REQUIRED (schema.js) — analog zum
 *  analyzeErrorResponse-Muster (iteration.suppressed). Fehlt es, scheitert die
 *  SDK-safeParse der structuredContent still. 0 = nichts getrunkt im Error-Pfad. */
function inspectErrorResponse(prose, error) {
  return {
    content: [{ type: 'text', text: prose }],
    structuredContent: {
      scene: { width: 0, height: 0, grid: '0x0', elements: [], suppressed: 0 },
      ...(error ? { error } : {}),
    },
    isError: true,
  };
}

/** Schema-conformant error response for palette (outputSchema: paletteOutput). */
function paletteErrorResponse(prose, error) {
  return {
    content: [{ type: 'text', text: prose }],
    structuredContent: { colors: [], ...(error ? { error } : {}) },
    isError: true,
  };
}

/** Schema-conformant error response for bookmark (outputSchema: bookmarkOutput).
 *  analysisId ist im Error-Pfad bereits eine validierte UUID (bookmarkInput
 *  erzwingt .uuid()), erfüllt also bookmarkOutput.analysisId=.uuid(). */
function bookmarkErrorResponse(prose, name, analysisId, error) {
  return {
    content: [{ type: 'text', text: prose }],
    structuredContent: {
      name: name ?? '',
      analysisId,
      stored: false,
      bookmarkCount: 0,
      ...(error ? { error } : {}),
    },
    isError: true,
  };
}

// ── TOOL DEFINITIONS (registerTool-compatible) ──────────────

/**
 * Cluster 1: ANALYSE — vector_mirror_analyze
 * BAUPLAN 5 Cluster 1 + 5.1 Annotations
 */
export const analyzeTool = {
  name: 'vector_mirror_analyze',
  config: {
    // §RELAIS 5-Block-Form (an internal spec §1.1): Orientierung · Input-
    // Grammatik · Output-Kernfelder · verifizierte Eigenheiten (Register-
    // Projektion, endet mit P5-Zeile) · Next step. Budget ≤1300 Zeichen.
    // P2/S1b: vollständig aus dem Register komponiert (claims.js BLOCKS).
    description: DESCRIPTIONS.analyze,
    inputSchema: analyzeInput,
    outputSchema: analyzeOutput,
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
  handler: async ({ svg, constraints, previousIssueCount }) => {
    const result = await analyze(svg, constraints, previousIssueCount);
    if (!result.structured)
      return analyzeErrorResponse(result.prose, result.error);
    return {
      content: [{ type: 'text', text: result.prose }],
      structuredContent: result.structured,
    };
  },
};

/**
 * Cluster 1: ANALYSE — vector_mirror_compare
 * BAUPLAN 5 Cluster 1 + 5.1 Annotations
 */
export const compareTool = {
  name: 'vector_mirror_compare',
  config: {
    description: DESCRIPTIONS.compare,
    inputSchema: compareInput,
    outputSchema: analyzeOutput,
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    },
  },
  handler: async ({ svg, constraints, analysisId }) => {
    const result = await compare(svg, constraints, analysisId);
    if (!result.structured)
      return analyzeErrorResponse(result.prose, result.error);
    return {
      content: [{ type: 'text', text: result.prose }],
      structuredContent: result.structured,
      // §H9 K-13bc: der No-Baseline-Pfad liefert jetzt eine ehrliche non-null
      // Hülle (statt null-Sentinel) — der Nutzungsfehler bleibt am MCP-Rand
      // als isError projiziert (exakte Erkennung via NO_BASELINE_HINT, eine
      // Quelle in pipeline.js; MCP-Verhalten wie vor H9).
      ...(result.prose === NO_BASELINE_HINT ? { isError: true } : {}),
    };
  },
};

/**
 * Cluster 1: ANALYSE — vector_mirror_bookmark
 * §1.4 Globale Bookmarks (B-3, O1): Named-Baseline für den Sniper-Loop.
 */
export const bookmarkTool = {
  name: 'vector_mirror_bookmark',
  config: {
    description: DESCRIPTIONS.bookmark,
    inputSchema: bookmarkInput,
    outputSchema: bookmarkOutput,
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
  handler: async ({ name, analysisId }) => {
    const result = bookmark(name, analysisId);
    if (!result.structured)
      return bookmarkErrorResponse(
        result.prose,
        name,
        analysisId,
        result.error,
      );
    return {
      content: [{ type: 'text', text: result.prose }],
      structuredContent: result.structured,
    };
  },
};

/**
 * Cluster 2: INSPEKTION — vector_mirror_inspect
 * BAUPLAN 5 Cluster 2 + 5.1 Annotations
 */
export const inspectTool = {
  name: 'vector_mirror_inspect',
  config: {
    description: DESCRIPTIONS.inspect,
    inputSchema: inspectInput,
    outputSchema: inspectOutput,
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
  handler: async ({ svg }) => {
    const result = await inspect(svg);
    if (!result.structured)
      return inspectErrorResponse(result.prose, result.error);
    return {
      content: [{ type: 'text', text: result.prose }],
      structuredContent: result.structured,
    };
  },
};

/**
 * Cluster 2: INSPEKTION — vector_mirror_palette
 * BAUPLAN 5 Cluster 2 + 5.1 Annotations
 */
export const paletteTool = {
  name: 'vector_mirror_palette',
  config: {
    description: DESCRIPTIONS.palette,
    inputSchema: paletteInput,
    outputSchema: paletteOutput,
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
  handler: async ({ svg }) => {
    const result = await palette(svg);
    if (!result.structured)
      return paletteErrorResponse(result.prose, result.error);
    return {
      content: [{ type: 'text', text: result.prose }],
      structuredContent: result.structured,
    };
  },
};

/**
 * Cluster 4: META — vector_mirror_constraints
 * BAUPLAN 5 Cluster 4 + 5.1 Annotations
 */
export const constraintsTool = {
  name: 'vector_mirror_constraints',
  config: {
    description: DESCRIPTIONS.constraints,
    inputSchema: constraintsInput,
    outputSchema: constraintsOutput,
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
  handler: async () => {
    const result = getConstraintTypes();
    return {
      content: [{ type: 'text', text: result.prose }],
      structuredContent: result.structured,
    };
  },
};

/**
 * Cluster 4: META — vector_mirror_status
 * BAUPLAN 5 Cluster 4 + 5.1 Annotations
 */
export const statusTool = {
  name: 'vector_mirror_status',
  config: {
    description: DESCRIPTIONS.status,
    inputSchema: statusInput,
    outputSchema: statusOutput,
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    },
  },
  handler: async () => {
    const result = getStatus();
    return {
      content: [{ type: 'text', text: result.prose }],
      structuredContent: result.structured,
    };
  },
};

/**
 * Cluster 3: EDITOR — vector_mirror_arrange
 * BAUPLAN 5 Cluster 3 + 5.1 Annotations
 */

/** Schema-conformant error response for arrange (outputSchema: arrangeOutput). */
function arrangeErrorResponse(prose, error) {
  return {
    content: [{ type: 'text', text: prose }],
    structuredContent: {
      attributes: {},
      warnings: [prose],
      ...(error ? { error } : {}),
    },
    isError: true,
  };
}

export const arrangeTool = {
  name: 'vector_mirror_arrange',
  config: {
    description: DESCRIPTIONS.arrange,
    inputSchema: arrangeInput,
    outputSchema: arrangeOutput,
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
  handler: async ({ canvas, elements, constraints }) => {
    try {
      const result = arrange(canvas, elements, constraints);
      // Defense-in-depth: sanitize NaN/Infinity before SDK validation (Audit Fix N)
      const sanitized = JSON.parse(
        JSON.stringify(result.structured, (_, v) =>
          typeof v === 'number' && !Number.isFinite(v) ? 0 : v,
        ),
      );
      return {
        content: [{ type: 'text', text: result.prose }],
        structuredContent: sanitized,
      };
    } catch (err) {
      // §6 RELAIS: der Catch IST der Entstehungs-Ort dieses Fehlers (die
      // pipeline wirft ohne Code) — ARRANGE_FAILED klassifiziert ihn, der
      // hint trägt die geworfene Wahrheit und steht wortidentisch in der Prosa.
      const hint = `Arrange fehlgeschlagen: ${err.message}`;
      return arrangeErrorResponse(hint, { code: 'ARRANGE_FAILED', hint });
    }
  },
};

/**
 * Cluster 4: META — vector_mirror_selftest (§1.9 Eichkörper-Selftest)
 * 9. registriertes Tool. MISST nur (REGEL-3/9): läuft die 5 Kalibrierungs-
 * Eichkörper (EK-1..5) und PARTIAL-matcht gegen die anti-zirk aus der Spec
 * abgeleiteten expected-Felder (Grid/Farbe/Reliability-Wahrheit), NIE gegen
 * gespeicherten Tool-Output (Anti-Zirkularität REGEL-2). Read-only, idempotent.
 */
export const selftestTool = {
  name: 'vector_mirror_selftest',
  config: {
    description: DESCRIPTIONS.selftest,
    inputSchema: selftestInput,
    outputSchema: selftestOutput,
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
  handler: async ({ full }) => {
    const result = await runSelftest(full);
    return {
      content: [{ type: 'text', text: result.prose }],
      structuredContent: result.structured,
    };
  },
};

// ── EXPORTS ─────────────────────────────────────────────────

/** All tools as array for server.js registration loop. */
export const tools = [
  analyzeTool,
  compareTool,
  bookmarkTool,
  inspectTool,
  paletteTool,
  arrangeTool,
  constraintsTool,
  statusTool,
  selftestTool,
];

/**
 * Legacy handler dispatcher (Phase 1 compatibility).
 * Phase 2 uses server.js with registerTool() directly.
 */
export async function handleTool(name, args) {
  await init();

  try {
    const tool = tools.find((t) => t.name === name);
    if (!tool)
      return { content: [{ type: 'text', text: `Unbekanntes Tool: ${name}` }] };
    return await tool.handler(args);
  } catch (err) {
    return {
      content: [
        { type: 'text', text: `Vector Mirror Systemfehler: ${err.message}` },
      ],
    };
  }
}
