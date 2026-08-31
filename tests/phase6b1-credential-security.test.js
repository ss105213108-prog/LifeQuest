const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { createVerificationHarness } = require('./helpers/live-verification-harness.cjs');

const scripts = [
  ['phase4b-live-verification.cjs', 'Lq9!'],
  ['phase5a-live-verification.cjs', 'Lq5!'],
  ['phase5b-live-verification.cjs', 'Lq5B!']
];
for (const [file, legacyPrefix] of scripts) {
  test(`${file}: public CLI output cannot reconstruct a temporary password`, async () => {
    const h = createVerificationHarness(file);
    await h.run();
    assert.equal(h.signups.length, 2);
    const logged = h.records().find(record => record.runId === h.runId);
    assert.ok(logged, 'run identifier remains available for cleanup');
    for (const [index, user] of h.signups.entries()) {
      const label = ['a', 'b'][index];
      const guess = legacyPrefix + crypto.createHash('sha256')
        .update(`${logged.runId}:${label}`).digest('hex').slice(0, 18) + 'Aa';
      // Boolean assertions deliberately never print credentials on failure.
      assert.equal(user.password === guess, false, 'logged metadata reconstructs the Auth password');
      assert.equal(h.output.join('').includes(user.password), false, 'password must not be logged');
    }
  });

  test(`${file}: repeated public metadata gets independent CSPRNG credentials`, async () => {
    const first = createVerificationHarness(file), second = createVerificationHarness(file);
    await first.run(); await second.run();
    assert.equal(first.runId, second.runId);
    assert.equal(first.signups.length, 2);
    assert.equal(second.signups.length, 2);
    const passwords = [...first.signups, ...second.signups].map(user => user.password);
    assert.equal(new Set(passwords).size, 4, 'credentials must be independent across accounts and executions');
    for (const h of [first, second]) {
      assert.ok(h.entropyRequests.filter(bytes => bytes >= 24).length >= 2);
      const text = h.output.join('');
      for (const user of h.signups) {
        assert.equal(text.includes(user.password), false);
        assert.equal(text.includes(crypto.createHash('sha256').update(user.password).digest('hex')), false);
      }
      assert.equal(/password|verifier|credentialSeed|passwordSeed|access_token|refresh_token/i.test(text), false);
    }
  });

  for (const scenario of [
    { name: 'successful setup', options: {} },
    { name: 'bootstrap failure', options: { failAfterSignup: true } },
    { name: 'remote signOut failure', options: { signOutFails: true } }
  ]) test(`${file}: exact cleanup IDs survive ${scenario.name} without credential recovery`, async () => {
    const h = createVerificationHarness(file, scenario.options);
    await h.run();
    assert.ok(h.signups.length >= 1);
    const expected = h.signups.map(user => user.id).sort();
    const targets = h.records().filter(row => row.event === 'AUTH_ADMIN_DELETE_REQUIRED');
    assert.deepEqual(targets.map(row => row.userId).sort(), expected);
    assert.ok(targets.every(row => row.cleanupRequired === true && row.runId === h.runId));
    const results = h.records().filter(row => row.event === 'TEMP_GLOBAL_SIGNOUT');
    assert.deepEqual(results.map(row => row.userId).sort(), expected);
    assert.ok(results.every(row => row.ok === !scenario.options.signOutFails));
    assert.deepEqual(h.signouts.map(row => row.userId).sort(), expected);
    assert.ok(h.signouts.every(row => row.scope === 'global'));
    assert.equal(h.logins, 0, 'cleanup must never reconstruct credentials or log in again');
    assert.equal(h.output.join('').includes('private auth detail'), false);
    assert.equal(h.exitCode, Object.values(scenario.options).some(Boolean) ? 1 : 0);
    // An admin cleanup consumer only needs the exact allowlisted IDs, not passwords.
    const remaining = new Set(['existing-manual-member', ...expected]);
    for (const target of targets) {
      assert.ok(expected.includes(target.userId));
      remaining.delete(target.userId);
    }
    assert.deepEqual([...remaining], ['existing-manual-member']);
  });

  test(`${file}: old cross-process resume modes fail closed before Auth I/O`, async () => {
    const modes = file.startsWith('phase4b')
      ? ['basic', 'fixtures', 'concurrency', 'receipt-security', 'latest-state', 'idempotency-matrix', 'signout']
      : ['verify', 'signout'];
    for (const mode of modes) {
      const h = createVerificationHarness(file, { mode });
      await h.run();
      assert.equal(h.exitCode, 1);
      assert.equal(h.clients, 0, `${mode} must not reconstruct credentials or create a client`);
      assert.equal(h.signups.length + h.logins + h.commands.length, 0);
    }
  });
}

test('secret scan rejects legacy metadata-derived credentials but permits random credentials and non-secret hashes', () => {
  const { scanText } = require('./helpers/secret-scan.cjs');
  const field = ['pass', 'word'].join('');
  const derivation = "crypto.createHash('sha256').update(`${runId}:${label}`).digest('hex')";
  for (const source of [
    `function ${field}(runId, label) {\n return ${derivation};\n}`,
    `const user = { ${field}: ${derivation} };`,
    `const ${field} = ${derivation};`
  ]) {
    assert.ok(scanText(source, 'legacy-live.cjs').some(row => row.rule === 'metadata_derived_password'));
  }
  assert.deepEqual(scanText(`const ${field} = crypto.randomBytes(24).toString('base64url');`), []);
  assert.deepEqual(scanText("const shortId = crypto.createHash('sha256').update(runId).digest('hex');"), []);
});

test('output guard removes credential derivation seeds and verifiers while retaining cleanup identity', () => {
  const { safeVerificationRecord } = require('./helpers/safe-verification-output.cjs');
  const output = safeVerificationRecord({ runId: 'audit-run', label: 'a', userId: 'exact-cleanup-id',
    seed: 'private-entropy', verifier: 'private-verifier', passwordHash: 'private-hash',
    nested: { randomSeed: 'private-randomness', password: 'private-password' } });
  const text = JSON.stringify(output);
  assert.equal(/private-/.test(text), false);
  assert.equal(output.userId, 'exact-cleanup-id');
  assert.equal(output.runId, 'audit-run');
});
