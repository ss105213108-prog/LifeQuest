// Exercise the actual Deno HTTP handler in Node. Only Supabase/Deno I/O is
// substituted; production validators, domain modules and routing remain real.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { pathToFileURL } = require('node:url');
const { stripTypeScriptTypes } = require('node:module');
const Contract = require('../../backendContract.js');
const edgePath = path.join(__dirname, '../../supabase/functions/lifequest-command/index.ts');

function envelope(type = 'PURCHASE_ITEM', payload = { itemKey: 'potion_red', seenCatalogVersion: 1 }) {
  return Contract.createCommandEnvelope({ type, payload, operationId: 'security-test-operation-001' });
}

async function createEdgeHarness({ authError = null, authThrows = null, user = { id: 'verified-user' },
  rpcResult = { ok: true, repositoryVersion: 1 }, rpcThrows = null,
  receiptResult = { ok: true, duplicate: false }, readThrows = null, readResult = { data: null, error: null },
  readResolver = null
} = {}) {
  const calls = [], reads = [];
  let authCalls = 0, serviceClients = 0, handler;
  const createClient = (_url, key) => {
    if (key === 'test-anon') return { auth: { getUser: async () => {
      authCalls++;
      if (authThrows) throw authThrows;
      return { data: { user }, error: authError };
    } } };
    serviceClients++;
    return {
      rpc: async (name, args) => {
        calls.push({ name, args });
        if (rpcThrows) throw rpcThrows;
        return { data: name === 'get_phase4b_operation_receipt' ? receiptResult : rpcResult, error: null };
      },
      from(table) {
        reads.push(table);
        if (readThrows) throw readThrows;
        const query = new Proxy({}, { get: (_target, key) => key === 'then'
          ? (resolve, reject) => Promise.resolve(readResolver ? readResolver(table, reads.length) : readResult).then(resolve, reject)
          : () => query });
        return query;
      }
    };
  };
  const imports = { '@supabase/supabase-js': { createClient } };
  const source = fs.readFileSync(edgePath, 'utf8');
  const importPattern = /import\s*\{([\s\S]*?)\}\s*from\s*['"]([^'"]+)['"];?/g;
  for (const match of source.matchAll(importPattern)) {
    if (!imports[match[2]]) imports[match[2]] = await import(pathToFileURL(path.resolve(path.dirname(edgePath), match[2])).href);
  }
  const executable = stripTypeScriptTypes(source.replace(importPattern,
    (_match, names, specifier) => `const {${names}} = imports[${JSON.stringify(specifier)}];`));
  const context = vm.createContext({ imports, Request, Response, Headers, TextEncoder, TextDecoder,
    Uint8Array, Uint32Array, crypto: globalThis.crypto, console,
    Deno: { serve(fn) { handler = fn; }, env: { get: name => ({
      SUPABASE_URL: 'https://test.invalid', SUPABASE_ANON_KEY: 'test-anon', SUPABASE_SERVICE_ROLE_KEY: 'test-server'
    })[name] } }
  });
  vm.runInContext(executable, context, { filename: edgePath });
  return {
    calls, reads, get authCalls() { return authCalls; }, get serviceClients() { return serviceClients; },
    async request(body = envelope(), options = {}) {
      const headers = { authorization: 'Bearer test-only', 'content-type': 'application/json',
        'idempotency-key': body?.operationId || 'security-test-operation-001', 'if-match': '0', ...options.headers };
      for (const key of Object.keys(headers)) if (headers[key] === null) delete headers[key];
      const method = options.method || 'POST';
      const response = await handler(new Request('https://test.invalid/functions/v1/lifequest-command', {
        method, headers, ...(method === 'POST' ? {
          body: options.raw === undefined ? JSON.stringify(body) : options.raw,
          ...(options.raw instanceof ReadableStream ? { duplex: 'half' } : {})
        } : {})
      }));
      const text = await response.text();
      return { status: response.status, headers: response.headers, text, body: JSON.parse(text) };
    }
  };
}
module.exports = { createEdgeHarness, envelope, edgePath };
