const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');
const { createRequire } = require('node:module');

// Run the real CLI entry point with only Auth/HTTP replaced. Never create live users.
function createVerificationHarness(file, { mode = 'setup', failAfterSignup = false,
  signOutFails = false } = {}) {
  const full = path.resolve(__dirname, '..', file);
  const localRequire = createRequire(full);
  const output = [], signups = [], signouts = [], commands = [], entropyRequests = [];
  let clients = 0, logins = 0;
  const runId = 'credential-audit-fixture';
  const sdk = { createClient() {
    clients++;
    let account = null;
    return { auth: {
      async signUp(input) {
        account = { ...input, id: `00000000-0000-4000-8000-${String(signups.length + 1).padStart(12, '0')}` };
        signups.push(account);
        return { data: { user: { id: account.id, email: input.email }, session: {} }, error: null };
      },
      async getSession() { return { data: { session: { access_token: 'offline-session-only' } } }; },
      async signInWithPassword(input) {
        logins++;
        account = signups.find(user => user.email === input.email && user.password === input.password);
        if (!account) throw new Error('Unexpected credential recovery');
        return { data: { user: { id: account.id }, session: {} }, error: null };
      },
      async signOut(options) {
        signouts.push({ userId: account?.id, scope: options?.scope });
        if (signOutFails) throw Object.assign(new Error('private auth detail'), { status: 503 });
        return { error: null };
      }
    } };
  } };
  const context = vm.createContext({
    require: name => name === '@supabase/supabase-js' ? sdk : name === 'node:crypto'
      ? { ...crypto, randomBytes(size) { entropyRequests.push(size); return crypto.randomBytes(size); } }
      : localRequire(name),
    __dirname: path.dirname(full), URL,
    process: { argv: ['node', full, mode, runId], env: {}, stdout: { write: line => output.push(line) } },
    console: { log: line => output.push(line) },
    async fetch(_url, options) {
      const command = JSON.parse(options.body);
      commands.push(command);
      if (failAfterSignup) throw new Error('offline bootstrap failure');
      const versions = { INITIALIZE_MEMBER_PROFILE: 1, SELECT_MAIN_QUEST: 2, CREATE_CUSTOM_HABIT: 3 };
      return { ok: true, status: 200, async json() { return { ok: true,
        repositoryVersion: versions[command.type],
        state: { customHabits: [{ id: 'offline-habit', title: command.payload.title }] }
      }; } };
    }
  });
  const source = fs.readFileSync(full, 'utf8');
  if (!source.includes('main().catch(error => {')) throw new Error('CLI boundary missing');
  vm.runInContext(source.replace('main().catch(error => {', 'globalThis.run = () => main().catch(error => {'), context);
  return { output, signups, signouts, commands, entropyRequests, runId,
    get clients() { return clients; }, get logins() { return logins; },
    get exitCode() { return context.process.exitCode || 0; },
    run: () => context.run(),
    records: () => output.map(line => JSON.parse(line.slice(line.indexOf('{'))))
  };
}
module.exports = { createVerificationHarness };
