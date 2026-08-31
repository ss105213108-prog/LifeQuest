const assert = require('node:assert/strict');

function assertPostgresPrivileges(snapshot) {
  const targets = snapshot.defaults.filter(d => d.owner === 'postgres'
    && (d.schema === 'public' || (d.schema === '*' && d.type === 'f')));
  assert.ok(targets.some(d => d.schema === '*' && d.type === 'f'),
    'global FUNCTION default must override implicit PUBLIC EXECUTE');
  for (const row of targets) {
    assert.ok(!row.acl.some(acl => /^(?:anon|authenticated)?=/.test(acl)),
      `browser default privileges remain: ${row.schema}/${row.type}`);
  }
  for (const name of ['daily_drafts', 'custom_habits', 'rule_preferences']) {
    const row = snapshot.tables.find(t => t.schema === 'public' && t.name === name);
    assert.equal(row.rls, true);
    assert.ok(!row.acl.some(acl => /^(anon|authenticated)=[^/]*m/.test(acl)),
      `MAINTAIN remains: ${name}`);
    assert.ok(row.acl.includes('authenticated=r/postgres'));
    assert.ok(row.acl.some(acl => /^service_role=.*r.*w/.test(acl)));
  }
}

function assertScope(before, after, changedFunctions = []) {
  assert.deepEqual(after.schemas, before.schemas);
  assert.deepEqual(after.policies, before.policies);
  const outsideDefaults = s => s.defaults.filter(d => !(d.owner === 'postgres'
    && (d.schema === 'public' || (d.schema === '*' && d.type === 'f'))));
  assert.deepEqual(outsideDefaults(after), outsideDefaults(before));
  const expectedTables = structuredClone(before.tables);
  for (const row of expectedTables) {
    if (row.schema !== 'public' || !['daily_drafts', 'custom_habits', 'rule_preferences'].includes(row.name)) continue;
    row.acl = row.acl.map(acl => acl.replace(/^(anon|authenticated)=([^/]*)\//,
      (_, role, rights) => `${role}=${rights.replace(/m/g, '')}/`))
      .filter(acl => !/^(anon|authenticated)=\//.test(acl));
  }
  assert.deepEqual(after.tables, expectedTables);
  assert.equal(after.functions.length, before.functions.length);
  for (const original of before.functions) {
    const current = after.functions.find(f => f.schema === original.schema && f.name === original.name && f.args === original.args);
    assert.ok(current);
    const permitted = changedFunctions.includes(`${original.schema}.${original.name}`);
    assert.deepEqual(permitted ? { ...current, definition: original.definition } : current, original);
  }
  assert.deepEqual(after.migrations.slice(0, before.migrations.length), before.migrations);
}
module.exports = { assertPostgresPrivileges, assertScope };
