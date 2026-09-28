import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('SQLite records repeated observations and actual action results', () => {
  const dir = mkdtempSync(join(tmpdir(), 'feed-db-test-'));
  const path = join(dir, 'pilot.sqlite');
  const script = new URL('../dist/server/db.py', import.meta.url).pathname;
  const call = (op, arg = {}) => JSON.parse(execFileSync('python3', [script, path], { input:JSON.stringify({op,arg}) }).toString()).result;
  try {
    call('init');
    call('save_session',{session:{id:'s',startedAt:0,status:'active'}});
    const post = {postId:'123456789012345',url:'https://x.com/a/status/123456789012345',author:'a',text:'small language models',source:'for_you',hasVideo:false,promoted:false};
    const row = {sessionId:'s',phase:'for_you',post,label:'selected',judgments:{interest:.9},plan:{like:true},now:100};
    const seq = call('add_observation',row);
    assert.equal(call('seen_in_session',{sessionId:'s',postId:post.postId}),true);
    assert.equal(call('seen_in_phase',{sessionId:'s',postId:post.postId,phase:'return'}),false);
    call('record_attempt',{postId:post.postId,sessionId:'s',observationSeq:seq,action:'like',success:true,now:101});
    assert.equal(call('record_action',{postId:post.postId,sessionId:'s',action:'like',now:101}),true);
    assert.equal(call('record_action',{postId:post.postId,sessionId:'s',action:'like',now:102}),false);
    call('add_exploration_step',{sessionId:'s',observationSeq:seq,kind:'link',url:'https://x.com/b/status/23456',finalUrl:'https://x.com/b/status/23456',evidence:'Read the linked post',success:true,judgments:{interest:.1},plan:{label:'ignored'},now:103});
    assert.equal(call('update_observation_decision',{sessionId:'s',observationSeq:seq,label:'ignored',judgments:{interest:.1},plan:{label:'ignored'}}),true);
    const rows = call('feed',{source:null,label:null,limit:20,offset:0});
    assert.equal(rows.length,1);
    assert.deepEqual(rows[0].actual_actions,[{action:'like',success:1}]);
    assert.equal(rows[0].exploration_steps[0].evidence,'Read the linked post');
    assert.equal(rows[0].label,'ignored');
    assert.deepEqual(call('counts'),{ignored:1});
    call('save_session',{session:{id:'newer',startedAt:200,status:'active'}});
    for (const [index, postId] of ['234567890123456','345678901234567'].entries()) {
      call('add_observation',{...row,sessionId:'newer',post:{...post,postId,url:`https://x.com/a/status/${postId}`},now:201 + index});
    }
    const firstPage = call('feed',{source:null,label:null,limit:2,offset:0});
    const secondPage = call('feed',{source:null,label:null,limit:2,offset:2});
    assert.deepEqual(firstPage.map(item => item.session_id),['newer','newer']);
    assert.deepEqual(firstPage.map(item => item.session_started_at),[200,200]);
    assert.equal(secondPage[0].session_id,'s');
    assert.equal(secondPage[0].session_started_at,0);
  } finally { rmSync(dir,{recursive:true,force:true}); }
});
