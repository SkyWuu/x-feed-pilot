import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

async function listen(server) {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  return server.address().port;
}

test('link and mention visits feed evidence into repeated decisions', async t => {
  const dir = mkdtempSync(join(tmpdir(), 'feed-followup-api-'));
  writeFileSync(join(dir, 'PREFERENCE.md'), 'Interested in useful research on small language models.');
  writeFileSync(join(dir, 'search-seeds.json'), JSON.stringify(['SLM benchmark']));
  const requests = [];
  const jev = createServer(async (req, res) => {
    let raw = '';
    for await (const chunk of req) raw += chunk;
    const input = JSON.parse(raw);
    requests.push(input);
    const round = input.state.visited_pages?.length || 0;
    const high = round === 2;
    const answer = {
      interest:{noul:1}, like:{noul:high ? 1 : .2},
      bookmark:{noul:high ? 1 : .2}, exploreAuthor:{noul:1}, excluded:{noul:.01},
      nextAction:{choice:round === 0 ? 'visit_2' : round === 1 ? 'visit_0' : 'finish'},
    };
    res.writeHead(200, {'content-type':'application/json'});
    res.end(JSON.stringify({answers:answer}));
  });
  const jevPort = await listen(jev);
  const free = createServer();
  const port = await listen(free);
  await new Promise(resolve => free.close(resolve));
  const app = spawn(process.execPath, [new URL('../dist/server/server.js', import.meta.url).pathname], {
    cwd:dir, env:{...process.env, PILOT_PORT:String(port), PILOT_JEV_ENDPOINT:`http://127.0.0.1:${jevPort}`, TYPESAFE_API_KEY:'test-key'},
  });
  t.after(async () => { app.kill(); await new Promise(resolve => jev.close(resolve)); rmSync(dir,{recursive:true,force:true}); });
  let output = '';
  app.stdout.on('data', chunk => output += chunk);
  for (let i = 0; i < 60 && !output.includes('Feed:'); i++) await new Promise(resolve => setTimeout(resolve, 100));
  assert.match(output, /Feed:/);
  const origin = 'chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
  const api = async (path, method = 'GET', value) => {
    const response = await fetch(`http://127.0.0.1:${port}${path}`, {
      method, headers:{origin,'content-type':'application/json','x-x-feed-pilot-extension-id':'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'},
      body:value === undefined ? undefined : JSON.stringify(value),
    });
    return {status:response.status, body:await response.json()};
  };
  const started = await api('/api/session/start','POST',{});
  const sessionId = started.body.session.id;
  const postId = '123456789012345';
  const post = {
    postId,url:`https://x.com/a/status/${postId}`,author:'a',text:'A research thread with links and @boyanxyz',
    source:'for_you',imageRects:[],viewportWidth:1000,viewportHeight:800,hasVideo:false,promoted:false,
    links:[{url:'https://x.com/b/status/234567890123456',text:'related X post'},{url:'https://example.com/paper',text:'paper'}],
    mentions:[{handle:'boyanxyz',url:'https://x.com/boyanxyz'}],
  };
  const observed = await api('/api/observe','POST',post);
  assert.equal(observed.status,200,JSON.stringify(observed.body));
  assert.equal(observed.body.plan.nextVisit.kind,'mention');
  assert.equal(observed.body.plan.nextVisit.url,'https://x.com/boyanxyz');
  assert.equal(observed.body.plan.like,false);
  assert.equal(observed.body.session.session.forYouCount,0);
  const observationSeq = observed.body.observationSeq;
  const retrieve1 = await api('/api/observe/retrieve','POST',{sessionId,postId,observationSeq});
  assert.equal(retrieve1.body.needsBrowser,true);
  const first = await api('/api/observe/continue','POST',{sessionId,postId,observationSeq,evidence:{
    kind:'mention',url:'https://x.com/boyanxyz',finalUrl:'https://x.com/boyanxyz',text:'Profile discusses SLM evaluation',success:true,
  }});
  assert.equal(first.status,200,JSON.stringify(first.body));
  assert.equal(first.body.plan.nextVisit.kind,'link');
  assert.equal(first.body.plan.nextVisit.url,'https://x.com/b/status/234567890123456');
  const retrieve2 = await api('/api/observe/retrieve','POST',{sessionId,postId,observationSeq});
  assert.equal(retrieve2.body.needsBrowser,true);
  const second = await api('/api/observe/continue','POST',{sessionId,postId,observationSeq,evidence:{
    kind:'link',url:'https://x.com/b/status/234567890123456',finalUrl:'https://x.com/b/status/234567890123456',text:'The linked post contains a benchmark release',success:true,
  }});
  assert.equal(second.status,200,JSON.stringify(second.body));
  assert.equal(second.body.plan.nextVisit,undefined);
  assert.equal(second.body.plan.label,'selected');
  assert.equal(second.body.plan.like,true);
  assert.equal(second.body.session.session.forYouCount,1);
  assert.equal(second.body.session.session.forYouSelected,1);
  assert.deepEqual(requests.map(input => Object.keys(input.questions.nextAction.criteria).length),[4,3,2]);
  assert.deepEqual(requests.map(input => input.state.visited_pages?.length || 0),[0,1,2]);
  const feed = await api('/api/feed');
  assert.equal(feed.body.items[0].label,'selected');
  assert.equal(feed.body.items[0].exploration_steps.length,2);
  const ad = await api('/api/observe','POST',{...post,postId:'123456789012346',url:'https://x.com/a/status/123456789012346',promoted:true});
  assert.equal(ad.body.skipped,true);
  assert.equal((await api('/api/feed')).body.items.length,1);
});
