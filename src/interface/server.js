#!/usr/bin/env node
/**
 * server.js - MCP Server Entry Point (stdio)
 * Vector Mirror v2.0 Phase 2
 *
 * Interface module: ONLY transport setup. No business logic.
 * BAUPLAN ref: Sektion 7.2 (SDK-Pattern), 7.3 (Architecture Separation), 7.4 (Config)
 * DEPENDS: @modelcontextprotocol/sdk, interface/tools.js, pipeline.js
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { markCalibrationPending, runSelftest, shutdown } from '../pipeline.js';
import { QUICKSTART } from './claims.js';
import { tools } from './tools.js';

// §RELAIS §4: instructions-Quickstart als additives 2. Konstruktor-Argument
// (ServerOptions.instructions, SDK-verifiziert). Inhalt ist eine PROJEKTION
// des Claims-Registers (claims.js — eine Quelle); Auslieferung an den
// Konsumenten ist client-abhängig (P5-Ehrlichkeit) — die Tool-Descriptions
// bleiben selbsttragend, der Quickstart ist Beschleuniger, nicht Voraussetzung.
const server = new McpServer(
  {
    name: 'vector-mirror',
    version: '1.0.0',
  },
  { instructions: QUICKSTART },
);

// Register all tools from tools.js (BAUPLAN 7.2: registerTool, NOT deprecated tool())
for (const t of tools) {
  server.registerTool(t.name, t.config, t.handler);
}

// Graceful shutdown: close browser on SIGINT/SIGTERM
process.on('SIGINT', async () => {
  await shutdown();
  process.exit(0);
});
process.on('SIGTERM', async () => {
  await shutdown();
  process.exit(0);
});

// Connect transport and start serving (BAUPLAN 7.2: StdioServerTransport)
const transport = new StdioServerTransport();
await server.connect(transport);

// §1.9 Auto-Selftest: FIRE-AND-FORGET nach connect (R-1, KEIN eager-blocking
// init). Der Server bleibt sofort verfügbar; markCalibrationPending() setzt
// status.calibration='PENDING' BIS der Selftest fertig ist (dann PASS/FAIL).
// Selftest-Fehler sind NICHT fatal für den Start (z.B. fehlendes Chromium) —
// der Server läuft lazy weiter, status zeigt den Stand. Kein await: connect
// ist nicht geblockt, Startup-Latenz bleibt minimal.
markCalibrationPending();
runSelftest(false).catch(() => {
  /* Selftest-Fehler nicht fatal: status.calibration bleibt PENDING/letzter Stand. */
});
