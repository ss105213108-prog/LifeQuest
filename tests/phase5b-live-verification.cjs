const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createClient } = require('@supabase/supabase-js');
const { safeFailure, safeVerificationRecord } = require('./helpers/safe-verification-output.cjs');
const { createTemporaryAccountCleanup } = require('./helpers/temporary-account-cleanup.cjs');

const REF = 'jwpbwlrdzmfzjlbrktlc';
const PREFIX = 'LIFEQUEST_PHASE5B_RESULT=';
const temporaryCleanup = createTemporaryAccountCleanup(record =>
  process.stdout.write(`${PREFIX}${JSON.stringify(safeVerificationRecord(record))}\n`));
const TABLES = ['player_inventory', 'player_equipment', 'player_reward_tickets', 'economy_transactions'];
const assert = (value, message) => { if (!value) throw new Error(message); };

function config() {
  const source = fs.readFileSync(path.resolve(__dirname, '..', 'supabaseConfig.js'), 'utf8');
  const sandbox = { globalThis: {} };
  vm.runInNewContext(source, sandbox, { filename: 'supabaseConfig.js' });
  const value = sandbox.globalThis.LIFEQUEST_SUPABASE_CONFIG;
  if (!value || !String(value.url).includes(REF)) throw new Error('Wrong Supabase project');
  return value;
}

function memoryStorage() {
  const values = new Map();
  return { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, String(value)),
    removeItem: key => values.delete(key) };
}

function makeClient(value, runId, label) {
  return createClient(value.url, value.publishableKey, { auth: { persistSession: false,
    autoRefreshToken: false, detectSessionInUrl: false, storage: memoryStorage(),
    storageKey: `phase5b-${label}-${runId}` } });
}

function userSpec(value, runId, label) {
  return {
    label, runId,
    email: `lifequest-phase5b-${label}-${runId}@example.com`,
    password: crypto.randomBytes(24).toString('base64url') + '!Aa9',
    client: createClient(value.url, value.publishableKey, { auth: { persistSession: true,
      autoRefreshToken: false, detectSessionInUrl: false, storage: memoryStorage(),
      storageKey: `phase5b-${label}-${runId}` } })
  };
}

function today() {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Taipei', year: 'numeric',
    month: '2-digit', day: '2-digit' }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function envelope(type, id, payload) {
  return { contractVersion: 1, type, operationId: id, occurredAt: new Date().toISOString(),
    context: { businessDate: today(), timeZone: 'Asia/Taipei' }, intentKey: `${type}:${id}`, payload };
}

async function request(value, user, command = null, expectedVersion = null) {
  const session = (await user.client.auth.getSession()).data?.session;
  assert(session?.access_token, `Missing session ${user.label}`);
  const headers = { apikey: value.publishableKey, Authorization: `Bearer ${session.access_token}`,
    'Content-Type': 'application/json' };
  if (command) headers['Idempotency-Key'] = command.operationId;
  if (expectedVersion !== null) headers['If-Match'] = String(expectedVersion);
  const response = await fetch(`${value.url}/functions/v1/lifequest-command`, {
    method: command ? 'POST' : 'GET', headers, body: command ? JSON.stringify(command) : undefined
  });
  let body = {};
  try { body = await response.json(); } catch (_) { /* keep empty */ }
  return { ok: response.ok, status: response.status, body };
}

async function send(value, user, type, payload, suffix, version = user.version) {
  const command = envelope(type, `phase5b-${user.label}-${suffix}-${user.runId}`, payload);
  return { command, response: await request(value, user, command, version) };
}

async function login(value, user) {
  const { data, error } = await user.client.auth.signInWithPassword({ email: user.email, password: user.password });
  assert(!error && data?.session && data?.user?.id, `Login failed ${user.label}: ${error?.message || 'no session'}`);
  user.userId = data.user.id;
  const loaded = await request(value, user);
  assert(loaded.ok, `Cloud load failed ${user.label}`);
  user.version = loaded.body.repositoryVersion;
  user.state = loaded.body.state;
  return loaded.body;
}

async function setup(value, runId) {
  const users = ['a', 'b'].map(label => userSpec(value, runId, label));
  for (const user of users) {
    const shortId = crypto.createHash('sha256').update(runId).digest('hex').slice(0, 6);
    const adventurerName = `P5B${user.label.toUpperCase()}${shortId}`;
    const signup = await user.client.auth.signUp({ email: user.email, password: user.password,
      options: { data: { adventurer_name: adventurerName } } });
    temporaryCleanup.track(user, signup.data?.user);
    assert(!signup.error && signup.data?.session && signup.data?.user?.id, `Signup failed ${user.label}`);
    user.userId = signup.data.user.id;
    let out = await send(value, user, 'INITIALIZE_MEMBER_PROFILE', { adventurerName }, 'init', 0);
    assert(out.response.ok && out.response.body.repositoryVersion === 1,
      `Initialize failed ${user.label}: ${out.response.status}/${JSON.stringify(out.response.body)}`);
    user.version = 1;
    out = await send(value, user, 'SELECT_MAIN_QUEST', { questId: user.label === 'a' ? 'sleep' : 'exercise' }, 'quest');
    assert(out.response.ok && out.response.body.repositoryVersion === 2, `Quest failed ${user.label}`);
  }
  return { temporaryAccountsCreated: true,
    users: users.map(({ label, userId, email }) => ({ label, userId, email })) };
}

const inventory = (state, key) => state.inventory?.find(row => (row.itemKey || row.item_key) === key);
const rewardTicket = (state, id) => state.rewardTickets?.find(row => row.id === id);

async function verify(value, runId) {
  const users = ['a', 'b'].map(label => userSpec(value, runId, label));
  const [a, b] = users;
  await Promise.all(users.map(user => login(value, user)));
  const checks = {};

  for (const user of users) {
    assert(user.state.catalog?.length === 9, `Catalog missing ${user.label}`);
    for (const table of TABLES) {
      const own = await user.client.from(table).select('*');
      assert(!own.error && own.data.every(row => row.user_id === user.userId), `Own read failed ${table}`);
      assert((await user.client.from(table).insert({ user_id: user.userId })).error, `INSERT allowed ${table}`);
      assert((await user.client.from(table).update({ user_id: user.userId }).eq('user_id', user.userId)).error,
        `UPDATE allowed ${table}`);
      assert((await user.client.from(table).delete().eq('user_id', user.userId)).error, `DELETE allowed ${table}`);
    }
  }
  const leak = await a.client.from('player_inventory').select('*').eq('user_id', b.userId);
  assert(!leak.error && leak.data.length === 0, 'A can read B inventory');
  assert((await a.client.rpc('execute_phase5b_economy_command', {
    p_user_id: a.userId, p_command: {}, p_expected_version: a.version
  })).error, 'Browser can call economy RPC');
  checks.rlsBrowserAndAB = true;

  let out = await send(value, a, 'PURCHASE_ITEM', { itemKey: 'potion_red', seenCatalogVersion: 1 }, 'buy-potion');
  assert(out.response.ok && out.response.body.result.paidAmount === 22, `Purchase failed ${JSON.stringify(out.response.body)}`);
  assert(inventory(out.response.body.state, 'potion_red')?.quantity === 1, 'Potion missing');
  const originalVersion = out.response.body.repositoryVersion;
  a.version = originalVersion;
  const duplicate = await request(value, a, out.command, originalVersion - 1);
  assert(duplicate.ok && duplicate.body.duplicate && duplicate.body.repositoryVersion === originalVersion,
    'Purchase duplicate replayed');
  const changed = { ...out.command, payload: { itemKey: 'weapon_sword', seenCatalogVersion: 1 } };
  const reused = await request(value, a, changed, originalVersion - 1);
  assert(reused.status === 409 && reused.body.errorCode === 'OPERATION_ID_REUSED', 'Reused operation accepted');
  const stale = await send(value, a, 'PURCHASE_ITEM', { itemKey: 'weapon_sword', seenCatalogVersion: 99 }, 'stale');
  assert(stale.response.status === 409 && stale.response.body.errorCode === 'CATALOG_CHANGED', 'Stale catalog accepted');
  const forged = envelope('PURCHASE_ITEM', `phase5b-a-forged-${runId}`,
    { itemKey: 'weapon_sword', seenCatalogVersion: 1, price: 0 });
  const forgedResult = await request(value, a, forged, a.version);
  assert(forgedResult.status === 400 && forgedResult.body.errorCode === 'INVALID_PAYLOAD', 'Forged price accepted');
  checks.purchaseDiscountCatalogIdempotency = true;

  out = await send(value, a, 'PURCHASE_ITEM', { itemKey: 'weapon_sword', seenCatalogVersion: 1 }, 'buy-sword');
  assert(out.response.ok && !out.response.body.state.equipment?.some(row => row.slot === 'weapon'), 'Auto equip occurred');
  a.version = out.response.body.repositoryVersion;
  const duplicateEquipmentPurchase = await send(value, a, 'PURCHASE_ITEM',
    { itemKey: 'weapon_sword', seenCatalogVersion: 1 }, 'buy-sword-again');
  assert(duplicateEquipmentPurchase.response.status === 409
    && duplicateEquipmentPurchase.response.body.errorCode === 'ITEM_ALREADY_OWNED',
  'Unique equipment purchase was accepted twice');
  out = await send(value, a, 'EQUIP_ITEM', { itemKey: 'weapon_sword' }, 'equip-sword');
  assert(out.response.ok && out.response.body.state.derivedStats.energy === 12
    && out.response.body.state.player.baseStats.energy === 10, 'Equip changed base stats');
  const equipCommand = out.command;
  a.version = out.response.body.repositoryVersion;
  const equipDuplicate = await request(value, a, equipCommand, a.version - 1);
  assert(equipDuplicate.ok && equipDuplicate.body.duplicate
    && equipDuplicate.body.repositoryVersion === a.version, 'Equip duplicate replayed');
  out = await send(value, a, 'UNEQUIP_ITEM', { slot: 'weapon' }, 'unequip-sword');
  assert(out.response.ok && out.response.body.state.derivedStats.energy === 10, 'Unequip failed');
  const unequipCommand = out.command;
  a.version = out.response.body.repositoryVersion;
  const unequipDuplicate = await request(value, a, unequipCommand, a.version - 1);
  assert(unequipDuplicate.ok && unequipDuplicate.body.duplicate, 'Unequip duplicate replayed');
  const wrongSlot = await send(value, a, 'UNEQUIP_ITEM', { slot: 'accessory' }, 'wrong-slot');
  assert(wrongSlot.response.status === 400 && wrongSlot.response.body.errorCode === 'INVALID_PAYLOAD',
    'Invalid equipment slot accepted');
  checks.equipmentDerivedOnly = true;

  out = await send(value, a, 'PURCHASE_ITEM', { itemKey: 'potion_red', seenCatalogVersion: 1 }, 'buy-potion-two');
  assert(out.response.ok && inventory(out.response.body.state, 'potion_red')?.quantity === 2,
    'Potion stack purchase failed');
  a.version = out.response.body.repositoryVersion;
  out = await send(value, a, 'USE_ITEM', { itemKey: 'potion_red' }, 'use-potion');
  assert(out.response.ok && out.response.body.result.healed === 15
    && out.response.body.state.player.hp === 45, 'Potion 15 HP heal incorrect');
  const firstPotionUse = out.command;
  a.version = out.response.body.repositoryVersion;
  const potionDuplicate = await request(value, a, firstPotionUse, a.version - 1);
  assert(potionDuplicate.ok && potionDuplicate.body.duplicate
    && potionDuplicate.body.repositoryVersion === a.version, 'Potion duplicate healed twice');
  out = await send(value, a, 'USE_ITEM', { itemKey: 'potion_red' }, 'use-potion-five');
  assert(out.response.ok && out.response.body.result.healed === 5
    && out.response.body.state.player.hp === out.response.body.state.player.maxHp, 'Potion 5 HP heal incorrect');
  a.version = out.response.body.repositoryVersion;
  out = await send(value, a, 'PURCHASE_ITEM', { itemKey: 'potion_red', seenCatalogVersion: 1 }, 'buy-full-potion');
  assert(out.response.ok && inventory(out.response.body.state, 'potion_red')?.quantity === 1,
    'Full-HP test potion purchase failed');
  a.version = out.response.body.repositoryVersion;
  const full = await send(value, a, 'USE_ITEM', { itemKey: 'potion_red' }, 'full-hp');
  assert(full.response.status === 409 && full.response.body.errorCode === 'HP_ALREADY_FULL', 'Full HP use accepted');
  const damage = await send(value, a, 'REPORT_HABIT_EVENT', { habitId: 'sedentary_screen' }, 'potion-damage');
  assert(damage.response.ok && damage.response.body.state.player.hp < damage.response.body.state.player.maxHp,
    'Habit damage did not prepare last-potion concurrency');
  a.version = damage.response.body.repositoryVersion;
  const potionRaceVersion = a.version;
  const potionRaceCommands = ['one', 'two'].map(label => envelope('USE_ITEM',
    `phase5b-a-last-potion-${label}-${runId}`, { itemKey: 'potion_red' }));
  const potionRace = await Promise.all(potionRaceCommands.map(command => request(value, a, command, potionRaceVersion)));
  assert(potionRace.filter(result => result.ok).length === 1
    && potionRace.filter(result => result.body.errorCode === 'VERSION_CONFLICT').length === 1,
  'Concurrent last potion was not serialized');
  const afterPotionRace = await request(value, a);
  assert(!inventory(afterPotionRace.body.state, 'potion_red'), 'Last potion inventory row was not removed');
  a.version = afterPotionRace.body.repositoryVersion;
  const noPotion = await send(value, a, 'USE_ITEM', { itemKey: 'potion_red' }, 'no-potion');
  assert(noPotion.response.status === 404 && noPotion.response.body.errorCode === 'ITEM_NOT_OWNED',
    'Missing potion use was accepted');
  checks.potion = true;

  out = await send(value, a, 'REDEEM_REWARD_TICKET', { ticketKey: 'rest_30', seenCatalogVersion: 1 }, 'redeem-rest');
  assert(out.response.ok, 'Redeem failed');
  const redeemRestCommand = out.command;
  const usedId = out.response.body.result.ticketInstanceId;
  a.version = out.response.body.repositoryVersion;
  const redeemDuplicate = await request(value, a, redeemRestCommand, a.version - 1);
  assert(redeemDuplicate.ok && redeemDuplicate.body.duplicate
    && redeemDuplicate.body.repositoryVersion === a.version, 'Ticket redeem duplicate created another ticket');
  const cross = await send(value, b, 'USE_REWARD_TICKET', { ticketInstanceId: usedId }, 'cross-use');
  assert(cross.response.status === 404 && cross.response.body.errorCode === 'TICKET_NOT_FOUND', 'B used A ticket');
  const ticketRaceVersion = a.version;
  const ticketRaceCommands = ['one', 'two'].map(label => envelope('USE_REWARD_TICKET',
    `phase5b-a-use-rest-${label}-${runId}`, { ticketInstanceId: usedId }));
  const ticketRace = await Promise.all(ticketRaceCommands.map(command => request(value, a, command, ticketRaceVersion)));
  assert(ticketRace.filter(result => result.ok).length === 1
    && ticketRace.filter(result => result.body.errorCode === 'VERSION_CONFLICT').length === 1,
  'Concurrent ticket use was not serialized');
  const winningTicketIndex = ticketRace.findIndex(result => result.ok);
  const ticketUseDuplicate = await request(value, a, ticketRaceCommands[winningTicketIndex], ticketRaceVersion);
  assert(ticketUseDuplicate.ok && ticketUseDuplicate.body.duplicate, 'Ticket-use duplicate replayed');
  const afterTicketRace = await request(value, a);
  assert(rewardTicket(afterTicketRace.body.state, usedId)?.status === 'used', 'Ticket use failed');
  a.version = afterTicketRace.body.repositoryVersion;
  const noRefund = await send(value, a, 'REVERSE_REWARD_TICKET', { ticketInstanceId: usedId }, 'refund-used');
  assert(noRefund.response.status === 409 && noRefund.response.body.errorCode === 'TICKET_ALREADY_USED', 'Used ticket refunded');
  out = await send(value, a, 'REDEEM_REWARD_TICKET', { ticketKey: 'favorite_drink', seenCatalogVersion: 1 }, 'redeem-drink');
  assert(out.response.ok, 'Refundable redeem failed');
  const refundableId = out.response.body.result.ticketInstanceId;
  const gems = out.response.body.state.player.gems;
  a.version = out.response.body.repositoryVersion;
  out = await send(value, a, 'REVERSE_REWARD_TICKET', { ticketInstanceId: refundableId }, 'refund-drink');
  assert(out.response.ok && out.response.body.result.refundedGems === 5
    && out.response.body.state.player.gems === gems + 5, 'Snapshot refund failed');
  const refundCommand = out.command;
  a.version = out.response.body.repositoryVersion;
  const refundDuplicate = await request(value, a, refundCommand, a.version - 1);
  assert(refundDuplicate.ok && refundDuplicate.body.duplicate, 'Ticket refund duplicate refunded twice');
  const refundAgain = await send(value, a, 'REVERSE_REWARD_TICKET',
    { ticketInstanceId: refundableId }, 'refund-drink-again');
  assert(!refundAgain.response.ok, 'Reversed ticket refunded again');
  checks.ticketLifecycle = true;

  const bMaxPotion = await send(value, b, 'PURCHASE_ITEM',
    { itemKey: 'potion_red', seenCatalogVersion: 1 }, 'inventory-limit');
  assert(bMaxPotion.response.status === 409
    && bMaxPotion.response.body.errorCode === 'INVENTORY_LIMIT_REACHED', 'Potion stack limit was not enforced');
  const bNotOwned = await send(value, b, 'EQUIP_ITEM', { itemKey: 'weapon_sword' }, 'not-owned');
  assert(bNotOwned.response.status === 404 && bNotOwned.response.body.errorCode === 'ITEM_NOT_OWNED',
    'Unowned equipment was equipped');

  const beforeConcurrent = b.version;
  const concurrentCommands = [
    envelope('PURCHASE_ITEM', `phase5b-b-concurrent-armor-${runId}`, { itemKey: 'armor_shield', seenCatalogVersion: 1 }),
    envelope('PURCHASE_ITEM', `phase5b-b-concurrent-cactus-${runId}`, { itemKey: 'pet_cactus', seenCatalogVersion: 1 })
  ];
  const concurrent = await Promise.all(concurrentCommands.map(command => request(value, b, command, beforeConcurrent)));
  assert(concurrent.filter(result => result.ok).length === 1
    && concurrent.filter(result => result.body.errorCode === 'VERSION_CONFLICT').length === 1,
  'Concurrent purchase did not serialize');
  const bRefreshed = await request(value, b);
  assert(bRefreshed.body.repositoryVersion === beforeConcurrent + 1, 'Concurrent version increment incorrect');
  b.version = bRefreshed.body.repositoryVersion;
  b.state = bRefreshed.body.state;
  checks.concurrency = true;

  const refreshed = await request(value, a);
  a.version = refreshed.body.repositoryVersion;
  if (!inventory(refreshed.body.state, 'pet_cactus')) {
    out = await send(value, a, 'PURCHASE_ITEM', { itemKey: 'pet_cactus', seenCatalogVersion: 1 }, 'buy-cactus');
    assert(out.response.ok, 'Cactus purchase failed');
    a.version = out.response.body.repositoryVersion;
  }
  out = await send(value, a, 'EQUIP_ITEM', { itemKey: 'pet_cactus' }, 'equip-cactus');
  assert(out.response.ok && out.response.body.state.derivedStats.wealth === 12, 'Cactus wealth incorrect');
  a.version = out.response.body.repositoryVersion;

  const equipmentRaceVersion = a.version;
  const equipmentRaceCommands = ['one', 'two'].map(label => envelope('EQUIP_ITEM',
    `phase5b-a-equip-weapon-${label}-${runId}`, { itemKey: 'weapon_sword' }));
  const equipmentRace = await Promise.all(equipmentRaceCommands.map(command =>
    request(value, a, command, equipmentRaceVersion)));
  assert(equipmentRace.filter(result => result.ok).length === 1
    && equipmentRace.filter(result => result.body.errorCode === 'VERSION_CONFLICT').length === 1,
  'Concurrent equipment slot update was not serialized');
  const afterEquipmentRace = await request(value, a);
  assert(afterEquipmentRace.body.state.equipment.filter(row => row.slot === 'weapon').length === 1,
    'Equipment slot contains more than one item');
  a.version = afterEquipmentRace.body.repositoryVersion;
  out = await send(value, a, 'SUBMIT_DAILY_ENTRY', { sleep: 7.5, water: 2000, exercise: 30,
    study: 30, expense: 100, impulse: 0, sugaryDrinks: 0 }, 'cactus-daily');
  assert(out.response.ok,
    `Cactus daily failed ${out.response.status}/${out.response.body?.errorCode || 'UNKNOWN'}`);
  const entry = out.response.body.state.dailyEntries.find(row =>
    (row.businessDate || row.business_date) === today());
  const settlement = entry?.settlement || entry?.settlement_snapshot;
  assert(settlement?.equipmentEffects?.settlementGoldBonus === 1, 'Cactus Gold +1 snapshot missing');
  checks.cactusGoldOne = true;

  const bVersion = b.version;
  const insufficient = await send(value, b, 'PURCHASE_ITEM', { itemKey: 'pet_dragon', seenCatalogVersion: 1 }, 'insufficient');
  assert(insufficient.response.status === 409 && insufficient.response.body.errorCode === 'INSUFFICIENT_RESOURCE',
    'Insufficient purchase accepted');
  const bLatest = await request(value, b);
  assert(bLatest.body.repositoryVersion === bVersion && bLatest.body.state.player.gold === b.state.player.gold,
    'Failed purchase partially committed');
  checks.rollback = true;

  const anonymous = makeClient(value, runId, 'anonymous');
  for (const table of TABLES) {
    const read = await anonymous.from(table).select('*');
    assert(read.error || read.data.length === 0, `Anon read exposed ${table}`);
  }
  checks.anonymousDenied = true;
  await Promise.all(users.map(user => user.client.auth.signOut({ scope: 'global' })));
  checks.globalSignout = true;
  return { checks, users: users.map(({ label, userId }) => ({ label, userId })),
    finalVersions: { a: a.version, b: b.version } };
}

async function signout(value, runId) {
  const users = ['a', 'b'].map(label => userSpec(value, runId, label));
  for (const user of users) {
    await login(value, user);
    const { error } = await user.client.auth.signOut({ scope: 'global' });
    assert(!error, `Signout failed ${user.label}`);
  }
  return { globalSignout: true };
}

async function main() {
  const mode = process.argv[2]; const runId = process.argv[3];
  if (!/^[a-z0-9-]{8,40}$/.test(runId || '')) {
    throw new Error('Usage: node phase5b-live-verification.cjs setup <run-id>');
  }
  // Do not reconstruct credentials for historical cross-process verify/signout.
  if (mode !== 'setup') throw new Error('Legacy cross-process resume disabled');
  const value = config();
  let details;
  try {
    details = await setup(value, runId);
  } finally {
    await temporaryCleanup.finish();
  }
  process.stdout.write(`${PREFIX}${JSON.stringify(safeVerificationRecord({ ok: true, projectRef: REF,
    mode, runId, details, cleanupRequired: true }))}\n`);
}

main().catch(error => {
  process.stdout.write(`${PREFIX}${JSON.stringify({ ok: false, projectRef: REF,
    failure: safeFailure(error) })}\n`);
  process.exitCode = 1;
});
