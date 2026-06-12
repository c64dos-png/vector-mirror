// Minimal MCP stdio client — speaks ONLY the MCP protocol (JSON-RPC 2.0, newline-delimited).
// No SDK, no project code. Spawns the server entry from package.json (bin: src/interface/server.js).
import { spawn } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// Resolved relative to this file (tests/relais_red/) → repo-root/src/interface/server.js.
const SERVER = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'src', 'interface', 'server.js');

export function createSession() {
  const proc = spawn('node', [SERVER], { stdio: ['pipe', 'pipe', 'pipe'] });
  proc.stderr.on('data', d => process.stderr.write('[server-stderr] ' + d));

  let buf = '';
  const pending = new Map();
  proc.stdout.on('data', chunk => {
    buf += chunk.toString();
    let nl;
    while ((nl = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (!line) continue;
      let msg;
      try { msg = JSON.parse(line); } catch { continue; }
      if (msg.id !== undefined && pending.has(msg.id)) {
        const { resolve } = pending.get(msg.id);
        pending.delete(msg.id);
        resolve(msg);
      }
    }
  });

  let nextId = 1;
  function rpc(method, params, timeoutMs = 120000) {
    const id = nextId++;
    const payload = JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n';
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => { pending.delete(id); reject(new Error(`timeout ${method}`)); }, timeoutMs);
      pending.set(id, { resolve: m => { clearTimeout(t); resolve(m); } });
      proc.stdin.write(payload);
    });
  }

  async function init() {
    const res = await rpc('initialize', {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'r9a-cold-client', version: '1.0.0' }
    });
    proc.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');
    return res;
  }

  async function call(name, args = {}) {
    const res = await rpc('tools/call', { name, arguments: args });
    return res;
  }

  function close() { proc.kill(); }

  return { init, call, close, rpc };
}

// Hilfsfunktion: extrahiert das strukturierte Ergebnis aus einer tools/call-Antwort
export function unwrap(res) {
  if (res.error) return { _rpcError: res.error };
  const r = res.result || {};
  if (r.structuredContent) return r.structuredContent;
  if (r.content?.[0]?.text) {
    try { return JSON.parse(r.content[0].text); } catch { return r.content[0].text; }
  }
  return r;
}
