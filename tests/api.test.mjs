import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

async function freePort() {
  const server = createServer();
  await new Promise(resolve => server.listen(0,'127.0.0.1',resolve));
  const port = server.address().port;
  await new Promise(resolve => server.close(resolve));
  return port;
}

for (const keySource of ['environment', '.env']) test(`local service uses ${keySource} key and records extension actions without pairing`, async t => {
  const dir = mkdtempSync(join(tmpdir(),'feed-api-test-'));
  mkdirSync(join(dir,'data'));
  writeFileSync(join(dir,'data','config.json'),JSON.stringify({pairingCode:'old-code',tokenHash:'old-hash'}));
  writeFileSync(join(dir,'PREFERENCE.md'),'Interested in small language model evaluation. Dislike crypto.');
  writeFileSync(join(dir,'search-seeds.json'),JSON.stringify(['SLM benchmark lang:en']));
  if (keySource === '.env') writeFileSync(join(dir,'.env'),'# local key\nTYPESAFE_API_KEY="file-key"\n');
  const jev = createServer(async (req,res) => {
    assert.equal(req.headers.authorization,`Bearer ${keySource === '.env' ? 'file-key' : 'test-key'}`);
    let body = '';
    for await (const chunk of req) body += chunk;
    const input = JSON.parse(body);
    assert.match(input.state.preference,/small language model/);
    assert.equal(Object.keys(input.questions).length,5);
    res.writeHead(200,{'content-type':'application/json'});
    res.end(JSON.stringify({answers:{interest:{type:'noul',noul:1},like:{type:'noul',noul:1},bookmark:{type:'noul',noul:1},exploreAuthor:{type:'noul',noul:.3},excluded:{type:'noul',noul:.01}}}));
  });
  await new Promise(resolve => jev.listen(0,'127.0.0.1',resolve));
  const jevPort = jev.address().port;
  const port = await freePort();
  const app = spawn(process.execPath,[new URL('../dist/server/server.js',import.meta.url).pathname],{
    cwd:dir,
    env:{...process.env,PILOT_PORT:String(port),PILOT_JEV_ENDPOINT:`http://127.0.0.1:${jevPort}`,TYPESAFE_API_KEY:'test-key',OPENAI_API_KEY:'test-openai-key'},
  });
  t.after(async () => { app.kill(); await new Promise(resolve => jev.close(resolve)); rmSync(dir,{recursive:true,force:true}); });
  let output = '';
  app.stdout.on('data',chunk => output += chunk);
  let err = '';
  app.stderr.on('data',chunk => err += chunk);
  for (let i=0;i<60 && !output.includes('Feed:');i++) await new Promise(r=>setTimeout(r,100));
  assert.match(output,/Feed:/,err);
  assert.doesNotMatch(output,/Pairing code:/);
  const origin = 'chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
  const extensionId = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
  const api = async (path,method='GET',value,requestOrigin=origin,extraHeaders={}) => {
    const response = await fetch(`http://127.0.0.1:${port}${path}`,{
      method,headers:{...(requestOrigin ? {origin:requestOrigin} : {}),'content-type':'application/json','x-x-feed-pilot-extension-id':extensionId,...extraHeaders},
      body:value===undefined?undefined:JSON.stringify(value),
    });
    return { status:response.status, body:await response.json() };
  };
  assert.deepEqual((await api('/health')).body,{ok:true});
  assert.equal((await api('/api/session/status','GET',undefined,'https://example.com')).status,403);
  assert.equal((await api('/api/session/status','GET',undefined,'chrome-extension://bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb')).status,403);
  assert.equal((await api('/api/session/status','GET',undefined,null)).status,403);
  assert.equal((await api('/api/session/status','GET',undefined,origin,{'x-x-feed-pilot-extension-id':''})).status,403);
  assert.equal((await api('/api/session/status','GET',undefined,null,{'sec-fetch-site':'cross-site','sec-fetch-mode':'cors'})).status,403);
  assert.equal((await api('/api/session/status','GET',undefined,null,{'sec-fetch-site':'none','sec-fetch-mode':'cors'})).status,200);
  const preflight = await fetch(`http://127.0.0.1:${port}/api/session/start`,{method:'OPTIONS',headers:{origin,'access-control-request-method':'POST','access-control-request-headers':'content-type,x-x-feed-pilot-extension-id'}});
  assert.equal(preflight.status,204);
  assert.match(preflight.headers.get('access-control-allow-headers'),/x-x-feed-pilot-extension-id/);
  const started = await api('/api/session/start','POST',{},null,{'sec-fetch-site':'none','sec-fetch-mode':'cors'});
  assert.equal(started.status,200);
  const sessionId = started.body.session.id;
  const postId = '123456789012345';
  const observed = await api('/api/observe','POST',{
    postId,url:`https://x.com/researcher/status/${postId}`,author:'researcher',
    text:'A new benchmark for small language model evaluation with open results.',
    source:'for_you',imageRects:[],viewportWidth:1200,viewportHeight:800,
    hasVideo:false,promoted:false,
  });
  assert.equal(observed.status,200,JSON.stringify(observed.body));
  assert.equal(observed.body.plan.label,'selected');
  assert.equal(observed.body.plan.like,true);
  const result = await api('/api/action','POST',{postId,sessionId,observationSeq:observed.body.observationSeq,action:'like',success:true});
  assert.equal(result.status,200);
  const feed = await api('/api/feed');
  assert.equal(feed.body.items.length,1);
  assert.equal(feed.body.items[0].actual_actions[0].action,'like');
  assert.equal((await api('/api/counts')).body.counts.selected,1);
  assert.equal((await api('/api/session/stop','POST',{reason:'manual'})).body.session.status,'stopped');
});
