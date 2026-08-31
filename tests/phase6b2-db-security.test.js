const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { assertPostgresPrivileges, assertScope } = require('./helpers/phase6b2-security-audit.cjs');
const read = name => JSON.parse(fs.readFileSync(path.join(__dirname, `fixtures/phase6b2-${name}.json`), 'utf8'));
const changedFunctions = ['private.select_main_quest', 'private.update_member_profile',
  'private.execute_phase3_command', 'private.execute_phase5b_economy_command'];

test('6B-2 recorded live ACL audit: postgres future defaults and Phase 3 MAINTAIN are hardened', () => {
  const after = path.join(__dirname, 'fixtures/phase6b2-after-privileges.json');
  const file = fs.existsSync(after) ? after : path.join(__dirname, 'fixtures/phase6b2-before.json');
  assertPostgresPrivileges(JSON.parse(fs.readFileSync(file, 'utf8')));
});

test('6B-2 recorded Before/After: policies, ownership, RPC ACL and all unauthorized defaults are unchanged', () => {
  const before = read('before'), after = read('after');
  assertPostgresPrivileges(after);
  assertScope(before, after, changedFunctions);
  assert.equal(after.migrations.length, before.migrations.length + 2);
  assert.deepEqual(after.migrations.slice(-2).map(m => m.name), [
    'phase_6b2_postgres_privilege_hardening', 'phase_6b2_mandatory_command_versions']);
  for (const original of before.defaults.filter(d => d.owner === 'postgres' && d.schema === 'public')) {
    const current = after.defaults.find(d => d.owner === original.owner && d.schema === original.schema && d.type === original.type);
    assert.deepEqual(current.acl, original.acl.filter(a => !/^(?:anon|authenticated)?=/.test(a)));
  }
});

test('6B-2 recorded RPC definitions differ only by the two reviewed pre-reservation guards', () => {
  const before = read('before'), after = read('after');
  const migration = fs.readFileSync(path.join(__dirname,
    '../supabase/migrations/20260828155920_phase_6b2_mandatory_command_versions.sql'), 'utf8').replace(/\r\n/g, '\n');
  const guards = [...migration.matchAll(/v_guard text := \$guard\$([\s\S]*?)\$guard\$/g)].map(m => m[1]);
  assert.equal(guards.length, 2);
  for (const original of before.functions.filter(f => changedFunctions.includes(`${f.schema}.${f.name}`))) {
    const current = after.functions.find(f => f.schema === original.schema && f.name === original.name && f.args === original.args);
    const guard = guards[original.name === 'execute_phase5b_economy_command' ? 1 : 0];
    assert.equal(current.definition.split(guard).length, 2, 'exactly one guard insertion');
    assert.equal(current.definition.replace(guard, ''), original.definition);
  }
});

test('6B-2 audit guards detect old ACLs and unauthorized policy/ownership/function changes', () => {
  assert.throws(() => assertPostgresPrivileges(read('before')));
  for (const field of ['policies', 'schemas', 'functions']) {
    const before = read('before'), after = read('after');
    after[field][0].unexpected = true;
    assert.throws(() => assertScope(before, after, changedFunctions));
  }
  const after = read('after');
  after.tables[0].owner = 'unexpected_owner';
  assert.throws(() => assertScope(read('before'), after, changedFunctions));
});
