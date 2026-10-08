import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { spawn, execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { post, answers, screenshot } from './helpers/fixtures.mjs';

async function listen(server){await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));return server.address().port;}
async function setup(t, keySource='environment', missingKey) {
  const dir=mkdtempSync(join(tmpdir(),'feed-model-api-'));const requests=[];const modes={jev:'ok',luna:'ok'};
  writeFileSync(join(dir,'PREFERENCE.md'),'Interested in useful language model benchmarks.');writeFileSync(join(dir,'search-seeds.json'),'["SLM benchmark"]');
  if(keySource==='file')writeFileSync(join(dir,'.env'),'TYPESAFE_API_KEY=file-jev\nOPENAI_API_KEY=file-luna\n');
  const models=createServer(async(req,res)=>{
    let raw='';for await(const chunk of req)raw+=chunk;
    const provider=req.url==='/luna'?'luna':'jev';const body=JSON.parse(raw);requests.push({provider,body,key:req.headers.authorization});
    if(modes[provider]==='fail'){res.writeHead(503);res.end('unavailable');return;}
    const hasChoice=provider==='luna'?body.questions.some(q=>q.name==='nextAction'):!!body.questions.nextAction;
    res.setHeader('content-type','application/json');res.end(JSON.stringify(answers(provider,hasChoice?(modes[provider]==='visit'?'visit_0':'finish'):undefined)));
  });
  const modelPort=await listen(models);const probe=createServer();const port=await listen(probe);await new Promise(resolve=>probe.close(resolve));
  const env={...process.env,TYPESAFE_API_KEY:'env-jev',OPENAI_API_KEY:'env-luna',PILOT_PORT:String(port),PILOT_JEV_ENDPOINT:`http://127.0.0.1:${modelPort}/jev`,PILOT_LUNA_ENDPOINT:`http://127.0.0.1:${modelPort}/luna`};
  if(missingKey)delete env[missingKey];
  const app=spawn(process.execPath,[new URL('../dist/server/server.js',import.meta.url).pathname],{cwd:dir,env});let output='';let errors='';app.stdout.on('data',c=>output+=c);app.stderr.on('data',c=>errors+=c);
  t.after(async()=>{if(app.exitCode===null){const exit=new Promise(resolve=>app.once('exit',resolve));app.kill();await exit;}await new Promise(resolve=>models.close(resolve));rmSync(dir,{recursive:true,force:true});});
  for(let i=0;i<80&&!output.includes('Feed:');i++)await new Promise(resolve=>setTimeout(resolve,50));assert.match(output,/Feed:/,errors);
  const api=async(path,method='GET',value)=>{const r=await fetch(`http://127.0.0.1:${port}${path}`,{method,headers:{origin:'chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa','x-x-feed-pilot-extension-id':'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa','content-type':'application/json'},body:value===undefined?undefined:JSON.stringify(value)});return {status:r.status,body:await r.json()};};
  return {api,requests,modes,dir};
}
const pictured={...post,text:'',images:undefined,imageRects:[{x:0,y:0,width:100,height:100}],screenshot};
for(const provider of ['jev','luna']) test(provider+' failures do not switch models; success resets failures and three failures stop',async t=>{
  const {api,requests,modes}=await setup(t);assert.equal((await api('/api/session/start','POST',{})).status,200);
  const observed=provider==='luna'?pictured:post;
  modes[provider]='fail';
  for(let i=1;i<=2;i++){const result=await api('/api/observe','POST',observed);assert.equal(result.status,503);assert.equal(result.body.code,'decision_failed');assert.equal(result.body.session.decisionFailures,i);}
  modes[provider]='ok';const success=await api('/api/observe','POST',observed);assert.equal(success.status,200);assert.equal(success.body.session.session.decisionFailures,0);assert.equal(success.body.plan.label,'selected');
  modes[provider]='fail';for(let i=0;i<3;i++)await api('/api/observe','POST',observed);
  const state=(await api('/api/session/status')).body.session;assert.equal(state.stopReason,'decision_unavailable');assert.equal(state.decisionFailures,3);
  assert.equal(requests.length,6);assert.ok(requests.every(r=>r.provider===provider));
});
for(const provider of ['jev','luna'])test(provider+' follow-ups retain the same provider and never fall back on failure',async t=>{
  const {api,requests,modes,dir}=await setup(t,'file');const sessionId=(await api('/api/session/start','POST',{})).body.session.id;
  const observed={...(provider==='luna'?pictured:post),links:[{url:'https://example.com/paper',text:'paper'}]};modes[provider]='visit';
  const first=await api('/api/observe','POST',observed);assert.equal(first.status,200,JSON.stringify(first.body));assert.equal(first.body.plan.nextVisit.url,observed.links[0].url);
  assert.equal(first.body.plan.like,false);modes[provider]='ok';
  const evidence={kind:'link',url:observed.links[0].url,finalUrl:observed.links[0].url,text:'New research benchmark data',success:true};
  const result=await api('/api/observe/continue','POST',{sessionId,postId:post.postId,observationSeq:first.body.observationSeq,evidence});assert.equal(result.status,200,JSON.stringify(result.body));assert.equal(result.body.plan.label,'selected');
  assert.equal((await api('/api/observe/continue','POST',{sessionId,postId:post.postId,observationSeq:first.body.observationSeq,evidence})).status,409);
  if(provider==='luna') {
    assert.equal(requests[0].body.input[0].content[2].image_url,requests[1].body.input[0].content[2].image_url);
    assert.equal(JSON.parse(requests[1].body.input[0].content[0].text).visited_pages[0].content,evidence.text);
    const saved=execFileSync('python3',['-c','import sqlite3,sys; c=sqlite3.connect(sys.argv[1]); print(list(c.iterdump()))',join(dir,'data','pilot.sqlite')],{encoding:'utf8'});
    assert.doesNotMatch(saved,/data:image\/|base64/);
  }
  modes[provider]='visit';const next=await api('/api/observe','POST',observed);modes[provider]='fail';const fail=await api('/api/observe/continue','POST',{sessionId,postId:post.postId,observationSeq:next.body.observationSeq,evidence});assert.equal(fail.status,503);
  assert.equal(requests.length,4);assert.ok(requests.every(r=>r.provider===provider));assert.ok(requests.every(r=>r.key===`Bearer file-${provider}`));
});
test('missing image evidence is recorded without a model call or failure count',async t=>{
  const {api,requests}=await setup(t);await api('/api/session/start','POST',{});
  const result=await api('/api/observe','POST',{...pictured,screenshot:undefined});assert.equal(result.status,200);assert.equal(result.body.plan.label,'insufficient');assert.equal(result.body.plan.like,false);assert.equal(result.body.session.session.decisionFailures,0);assert.equal(requests.length,0);
  assert.equal((await api('/api/feed')).body.items[0].label,'insufficient');
});
for(const key of ['TYPESAFE_API_KEY','OPENAI_API_KEY'])test('starting a session requires '+key,async t=>{
  const {api,requests}=await setup(t,'environment',key);const result=await api('/api/session/start','POST',{});assert.equal(result.status,503);assert.match(result.body.error,new RegExp(key));assert.equal(requests.length,0);
});
