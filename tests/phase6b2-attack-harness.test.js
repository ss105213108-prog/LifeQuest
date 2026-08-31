const test=require('node:test');
const assert=require('node:assert/strict');
const {AUDIT_FIELDS,assertRejectedWithoutMutation,runCrossAccountAttacks}=require('./helpers/phase6b2-attack-harness.cjs');
const ids=['11111111-1111-4111-8111-111111111111','22222222-2222-4222-8222-222222222222'];
const snapshot=()=>Object.fromEntries(ids.map(id=>[id,Object.fromEntries(AUDIT_FIELDS.map(k=>[k,[]]))]));

test('6B-2 attack harness refuses to run without fresh explicit A/B authorization',async()=>{
  let calls=0;
  await assert.rejects(runCrossAccountAttacks({actors:[],readAudit:()=>{calls++;}}),/AUTHORIZATION REQUIRED/);
  assert.equal(calls,0);
});
test('6B-2 no-partial assertion checks all resources, domain rows and receipts, not just status',async()=>{
  for(const field of AUDIT_FIELDS) {
    const current=snapshot();
    await assert.rejects(assertRejectedWithoutMutation({userIds:ids,readAudit:async()=>current,
      send:async()=>{current[ids[0]][field]=['unexpected-write'];return {ok:false,errorCode:'VERSION_CONFLICT'};},
      expectedCodes:['VERSION_CONFLICT']}),/changed authoritative/);
  }
});
test('6B-2 no-partial assertion permits an unchanged rejected request',async()=>{
  await assertRejectedWithoutMutation({userIds:ids,readAudit:async()=>snapshot(),
    send:async()=>({ok:false,errorCode:'CATALOG_CHANGED'}),expectedCodes:['CATALOG_CHANGED']});
});
test('6B-2 attack failure due to Auth/network cannot masquerade as RLS/ownership success',async()=>{
  await assert.rejects(assertRejectedWithoutMutation({userIds:ids,readAudit:async()=>snapshot(),
    send:async()=>({ok:false,errorCode:'AUTH_UNAVAILABLE'}),expectedCodes:['42501']}),/expected rejection/);
});
test('6B-2 incomplete audits and successful attacks fail closed',async()=>{
  await assert.rejects(assertRejectedWithoutMutation({userIds:ids,readAudit:async()=>({}),
    send:async()=>({ok:false,errorCode:'42501'}),expectedCodes:['42501']}),/exact test users/);
  await assert.rejects(assertRejectedWithoutMutation({userIds:ids,readAudit:async()=>snapshot(),
    send:async()=>({ok:true}),expectedCodes:['42501']}),/unexpectedly succeeded/);
});
