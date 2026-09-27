import test from 'node:test';
import assert from 'node:assert/strict';
import { candidatesFor, normalizedWebUrl } from '../dist/server/followups.js';
import { retrievePage } from '../dist/server/retrieve.js';
import { actionPlan, newSession } from '../dist/server/engine.js';

const post = {
  postId:'123456789012345', url:'https://x.com/a/status/123456789012345', author:'a',
  text:'Read these sources and ask @boyanxyz', source:'for_you', imageRects:[],
  viewportWidth:1000, viewportHeight:800, hasVideo:false, promoted:false,
  links:[
    {url:'https://example.com/first',text:'first source'},
    {url:'https://example.com/second',text:'second source'},
    {url:'https://example.com/first',text:'duplicate first source'},
  ],
  mentions:[{handle:'boyanxyz',url:'https://x.com/boyanxyz'}],
};

test('each distinct link and mention is selectable until visited', () => {
  const initial = candidatesFor(post);
  assert.deepEqual(initial.map(item => [item.kind,item.url]), [
    ['link','https://example.com/first'],
    ['link','https://example.com/second'],
    ['mention','https://x.com/boyanxyz'],
  ]);
  const remaining = candidatesFor(post,[{kind:'link',url:initial[0].url,finalUrl:initial[0].url,text:'page content',success:true}]);
  assert.deepEqual(remaining.map(item => item.url), ['https://example.com/second','https://x.com/boyanxyz']);
});

test('exploration defers engagement and later evidence can change the final decision', () => {
  const session = newSession('s','pref','hash',0);
  const base = {interest:.9,like:.95,bookmark:.95,exploreAuthor:.1,excluded:.01};
  const during = actionPlan(post,base,session,{liked:false,bookmarked:false},{kind:'mention',url:'https://x.com/boyanxyz'});
  assert.deepEqual([during.like,during.bookmark,during.openPost,during.visitAuthor],[false,false,false,false]);
  assert.equal(during.nextVisit.url,'https://x.com/boyanxyz');
  const after = actionPlan(post,{...base,interest:.1,excluded:.9},session,{liked:false,bookmarked:false},undefined,'The linked page is about crypto.');
  assert.equal(after.label,'ignored');
  assert.equal(after.like,false);
});

test('retrieval routes X to browser and rejects local destinations', async () => {
  assert.equal(normalizedWebUrl('http://www.x.com/boyanxyz'), 'https://www.x.com/boyanxyz');
  const x = await retrievePage('https://x.com/boyanxyz');
  assert.equal(x.needsBrowser,true);
  const local = await retrievePage('http://127.0.0.1/private');
  assert.equal(local.success,false);
});
