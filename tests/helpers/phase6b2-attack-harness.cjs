// Preparation only: no account creation, credentials, logging, cleanup deletion or automatic live run.
// The future authorized runner supplies exact newly-created A/B identities and read-only audit access.
const assert = require('node:assert/strict');
const PROJECT = 'jwpbwlrdzmfzjlbrktlc';
const TABLES = ['profiles','member_game_roots','daily_drafts','custom_habits','rule_preferences',
  'player_states','daily_entries','daily_entry_revisions','habit_events','resource_ledger',
  'status_effects','player_achievements','boss_encounters','boss_actions','player_inventory',
  'player_equipment','player_reward_tickets','economy_transactions'];
const AUDIT_FIELDS = ['repositoryVersion','gold','gems','hp','totalXp','inventory','equipment',
  'tickets','ledger','receipts','economyTransactions','domainRows'];

function authorizationGuard(authorization, actors) {
  assert.equal(authorization?.phase,'6B-2','TEMP A/B TEST AUTHORIZATION REQUIRED');
  assert.equal(authorization?.projectRef,PROJECT);
  assert.equal(authorization?.allowLive,true,'TEMP A/B TEST AUTHORIZATION REQUIRED');
  assert.equal(actors?.length,2);
  const ids=actors.map(a=>a.userId);
  assert.equal(new Set(ids).size,2);
  assert.ok(ids.every(id=>/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)));
  assert.deepEqual([...authorization.createdUserIds].sort(),[...ids].sort());
  return ids;
}

async function auditSnapshot(readAudit,ids) {
  const value=await readAudit(ids);
  assert.deepEqual(Object.keys(value).sort(),[...ids].sort(),'audit must contain only the exact test users');
  for(const id of ids) for(const field of AUDIT_FIELDS) {
    assert.ok(Object.hasOwn(value[id],field),`audit missing ${field}`);
  }
  return structuredClone(value);
}

async function assertRejectedWithoutMutation({send,readAudit,userIds,expectedCodes}) {
  const before=await auditSnapshot(readAudit,userIds);
  const result=await send();
  const after=await auditSnapshot(readAudit,userIds);
  assert.deepEqual(after,before,'rejected request changed authoritative rows/resources/receipts');
  assert.notEqual(result?.ok,true,'attack unexpectedly succeeded');
  const code=result?.errorCode || result?.error?.code;
  assert.ok(expectedCodes.includes(code),'attack did not reach its expected rejection boundary');
}

async function runCrossAccountAttacks({authorization,actors,readAudit}) {
  const ids=authorizationGuard(authorization,actors);
  // Verify real browser sessions before accepting any cross-user failure as isolation evidence.
  for(const a of actors) {
    assert.equal(a.client.supabaseUrl,`https://${PROJECT}.supabase.co`);
    const current=await a.client.auth.getUser();
    assert.equal(current.error,null);
    assert.equal(current.data.user.id,a.userId);
  }
  const outcomes=[];
  for(let i=0;i<2;i++) {
    const a=actors[i], b=actors[1-i];
    const own=await a.client.from('profiles').select('user_id').eq('user_id',a.userId);
    assert.equal(own.error,null); assert.equal(own.data.length,1);
    for(const table of TABLES) {
      const cross=await a.client.from(table).select('*').eq('user_id',b.userId);
      assert.equal(cross.error,null); assert.deepEqual(cross.data,[]);
      for(const send of [
        ()=>a.client.from(table).insert({user_id:b.userId}),
        ()=>a.client.from(table).update({user_id:a.userId}).eq('user_id',b.userId),
        ()=>a.client.from(table).delete().eq('user_id',b.userId)
      ]) await assertRejectedWithoutMutation({send,readAudit,userIds:ids,expectedCodes:['42501']});
    }
    // Fixtures must make item ownership unambiguous; itemKey is a catalog key, not an owner ID.
    assert.ok(b.fixture?.exclusiveItemKey && b.fixture?.ticketId && b.fixture?.habitEventId);
    const aItem=await a.client.from('player_inventory').select('item_key').eq('item_key',b.fixture.exclusiveItemKey);
    const bItem=await b.client.from('player_inventory').select('item_key').eq('item_key',b.fixture.exclusiveItemKey);
    assert.equal(aItem.error,null); assert.equal(bItem.error,null);
    assert.equal(aItem.data.length,0); assert.equal(bItem.data.length,1);
    for (const [table,id] of [['player_reward_tickets',b.fixture.ticketId],['habit_events',b.fixture.habitEventId]]) {
      const owned=await b.client.from(table).select('id,user_id').eq('id',id);
      assert.equal(owned.error,null);
      assert.equal(owned.data.length,1,'foreign fixture must really exist');
      assert.equal(owned.data[0].user_id,b.userId,'foreign fixture ownership must be verified');
      const hidden=await a.client.from(table).select('id').eq('id',id);
      assert.equal(hidden.error,null); assert.deepEqual(hidden.data,[]);
    }
    const commands=[
      ['USE_REWARD_TICKET',{ticketInstanceId:b.fixture.ticketId},['TICKET_NOT_FOUND']],
      ['EQUIP_ITEM',{itemKey:b.fixture.exclusiveItemKey},['ITEM_NOT_OWNED']],
      ['REVERSE_HABIT_EVENT',{eventId:b.fixture.habitEventId},['HABIT_EVENT_NOT_FOUND','NOT_FOUND']],
      ...['userId','ownerId','playerId','profileId'].map(field=>
        ['UPDATE_PROFILE',{dailyBudget:500,[field]:b.userId},['INVALID_PAYLOAD']])
    ];
    for(const [type,payload,expectedCodes] of commands) {
      await assertRejectedWithoutMutation({send:()=>a.command(type,payload),readAudit,userIds:ids,expectedCodes});
    }
    await assertRejectedWithoutMutation({send:()=>a.client.rpc('execute_phase5b_economy_command',{
      p_user_id:b.userId,p_command:{},p_expected_version:0
    }),readAudit,userIds:ids,expectedCodes:['42501']});
    outcomes.push({actor:i,ownRead:true,crossRead:true,directWritesDenied:true,entityOwnership:true});
  }
  return outcomes;
}
module.exports={PROJECT,TABLES,AUDIT_FIELDS,authorizationGuard,assertRejectedWithoutMutation,runCrossAccountAttacks};
