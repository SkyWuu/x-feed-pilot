import test from 'node:test';
import assert from 'node:assert/strict';
import { actionPlan, advanceSession, countObservation, newSession, searchQuery } from '../dist/server/engine.js';

const post = { postId:'123456789012345', url:'https://x.com/a/status/123456789012345', author:'a', text:'A detailed benchmark for small language models', source:'for_you', imageRects:[], viewportWidth:1000, viewportHeight:800, hasVideo:false, promoted:false };
const judgments = { interest:.91, like:.95, bookmark:.94, exploreAuthor:.9, excluded:.03 };

test('preference exclusion and missing evidence prevent interaction', () => {
  const session = newSession('s','preference','hash',0);
  assert.equal(actionPlan(post, { ...judgments, excluded:.8 }, session, {liked:false,bookmarked:false}).label, 'ignored');
  assert.equal(actionPlan({ ...post, text:'' }, null, session, {liked:false,bookmarked:false}).label, 'insufficient');
  assert.equal(actionPlan({ ...post, promoted:true }, judgments, session, {liked:false,bookmarked:false}).like, false);
});

test('like and bookmark obey thresholds, caps, and deduplication', () => {
  const random = Math.random;
  Math.random = () => .9;
  try {
    const session = newSession('s','preference','hash',0);
    const plan = actionPlan(post, judgments, session, {liked:false,bookmarked:false});
    assert.equal(plan.label, 'selected');
    assert.equal(plan.like, true);
    assert.equal(plan.bookmark, true);
    assert.equal(actionPlan(post, judgments, session, {liked:true,bookmarked:true}).like, false);
    assert.equal(actionPlan(post, judgments, { ...session, likes:8, bookmarks:4 }, {liked:false,bookmarked:false}).bookmark, false);
    assert.equal(actionPlan(post, { ...judgments, like:.89 }, session, {liked:false,bookmarked:false}).like, false);
  } finally {
    Math.random = random;
  }
});

test('session searches once, returns, and stops on low relevance', () => {
  let session = newSession('s','preference','hash',0);
  session = { ...session, forYouCount:10, forYouSelected:1, uniqueCount:10 };
  session = advanceSession(session, 120_000);
  assert.equal(session.phase, 'search');
  assert.equal(searchQuery(session, ['one','two','three'], 155_000), 'two');
  session = advanceSession({ ...session, searchCount:20 }, 160_000);
  assert.equal(session.phase, 'return');
  session = advanceSession({ ...session, returnCount:20, returnSelected:1, returnWindow:[true,...Array(19).fill(false)] }, 200_000);
  assert.equal(session.phase, 'stopped');
  assert.equal(session.stopReason, 'low_relevance');
});

test('unique post budget differs from phase exposure counts', () => {
  const session = newSession('s','preference','hash',0);
  const first = countObservation(session, 'selected', true, true);
  const repeated = countObservation(first, 'selected', false, false);
  const returned = countObservation({ ...repeated, phase:'return' }, 'selected', false, true);
  assert.equal(returned.uniqueCount, 1);
  assert.equal(returned.forYouCount, 1);
  assert.equal(returned.returnCount, 1);
  assert.equal(advanceSession({ ...returned, uniqueCount:80 }, 1000).stopReason, 'post_limit');
  assert.equal(advanceSession({ ...returned, decisionFailures:3 }, 1000).stopReason, 'decision_unavailable');
});

test('a later low-relevance window triggers search despite an initially good feed', () => {
  let session = newSession('s','preference','hash',0);
  session = { ...session, forYouCount:40, forYouSelected:12, forYouWindow:[true,...Array(19).fill(false)] };
  assert.equal(advanceSession(session, 121_000).phase,'search');
});

test('successful visual judgment permits image-only posts, but missing visual evidence does not',()=>{
  const session=newSession('s','preference','hash',0);const onlyImage={...post,text:''};
  assert.equal(actionPlan(onlyImage,judgments,session,{liked:false,bookmarked:false},undefined,'',true).label,'selected');
  assert.equal(actionPlan(onlyImage,judgments,session,{liked:false,bookmarked:false}).label,'insufficient');
  assert.equal(actionPlan(onlyImage,null,session,{liked:false,bookmarked:false},undefined,'',true).label,'insufficient');
  assert.equal(advanceSession({...session,decisionFailures:undefined,jevFailures:3},1000).stopReason,'decision_unavailable');
});
