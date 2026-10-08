import test from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import { createDecider } from '../dist/server/decisions.js';
import { post, noMedia, imageMedia, answers } from './helpers/fixtures.mjs';

const settings={TYPESAFE_API_KEY:'jev-key',OPENAI_API_KEY:'luna-key',PILOT_JEV_ENDPOINT:'https://jev.invalid',PILOT_LUNA_ENDPOINT:'https://luna.invalid'};
const candidates=[{kind:'link',url:'https://example.com/paper',label:'paper'}];
const history=[{kind:'link',url:'https://example.com/first',finalUrl:'https://example.com/first',text:'Evidence from the first page',success:true}];
for (const provider of ['jev','luna']) {
  test(provider+' keeps initial and follow-up judgments on one model', async()=>{
    const requests=[];
    const decide=createDecider(k=>settings[k],{log:()=>{},fetch:async(url,options)=>{
      requests.push({url,options,body:JSON.parse(options.body)});
      return Response.json(answers(provider,'visit_0'));
    }});
    const media=provider==='luna'?imageMedia:noMedia;
    for(const visited of [[],history]) {
      const result=await decide(post,'Benchmark preference',media,visited,candidates);
      assert.equal(result.provider,provider);assert.equal(result.nextVisit.url,candidates[0].url);
      assert.equal(result.hasVisualEvidence,provider==='luna');
    }
    assert.equal(requests.length,2);
    assert.ok(requests.every(r=>r.url===settings[provider==='luna'?'PILOT_LUNA_ENDPOINT':'PILOT_JEV_ENDPOINT']));
    assert.ok(requests.every(r=>r.options.headers.authorization==='Bearer '+(provider==='luna'?'luna-key':'jev-key')));
    if(provider==='luna') {
      const input=requests[1].body.input[0];
      assert.equal(input.role,'user');assert.equal(requests[1].body.model,'gpt-6-luna');
      assert.equal(JSON.parse(input.content[0].text).visited_pages[0].content,history[0].text);
      assert.match(input.content[1].text,new RegExp(post.postId));assert.match(input.content[1].text,/attachment 1/);
      assert.equal(input.content[2].image_url,imageMedia.images[0].dataUrl);
      assert.equal(requests[1].body.questions.filter(q=>q.type==='predicate').length,5);
      assert.deepEqual(requests[1].body.questions.at(-1).choices.map(c=>c.value),['finish','visit_0']);
    } else assert.deepEqual(requests[1].body.state.visited_pages.map(p=>p.content),[history[0].text]);
  });
  for(const failure of ['http','network','timeout','json','refusal','missing','range','nonfinite','wrong_type','choice','duplicate']) {
    if(provider==='jev'&&failure==='duplicate')continue;
    test(provider+' '+failure+' fails once without calling another model',async()=>{
      const urls=[];
      const decide=createDecider(k=>settings[k],{timeoutMs:5,log:()=>{},fetch:async(url,options)=>{
        urls.push(url);
        if(failure==='http')return new Response('unavailable',{status:503});
        if(failure==='network')throw new Error('connection failed');
        if(failure==='timeout'){await delay(50,null,{signal:options.signal});throw new Error('timeout did not fire');}
        if(failure==='json')return new Response('not json');
        const data=answers(provider,'finish');
        const answer=provider==='jev'?data.answers.interest:data.answers.find(a=>a.name==='interest');
        const field=provider==='jev'?'noul':'probability';
        if(failure==='refusal')answer.type='refusal';
        if(failure==='missing'){if(provider==='jev')delete data.answers.interest;else data.answers=data.answers.filter(a=>a.name!=='interest');}
        if(failure==='range')answer[field]=2;
        if(failure==='nonfinite')answer[field]=Infinity;
        if(failure==='wrong_type')answer.type='score';
        if(failure==='choice'){if(provider==='jev')data.answers.nextAction.choice='visit_99';else data.answers.find(a=>a.name==='nextAction').choice='visit_99';}
        if(failure==='duplicate')data.answers.push({...answer});
        return Response.json(data);
      }});
      await assert.rejects(decide(post,'preference',provider==='luna'?imageMedia:noMedia,history,candidates),/Decision unavailable/);
      assert.deepEqual(urls,[settings[provider==='luna'?'PILOT_LUNA_ENDPOINT':'PILOT_JEV_ENDPOINT']]);
    });
  }
  test(provider+' low probability is a successful judgment',async()=>{
    let calls=0;
    const decide=createDecider(k=>settings[k],{log:()=>{},fetch:async()=>{calls++;return Response.json(answers(provider,undefined,{interest:0}));}});
    assert.equal((await decide(post,'preference',provider==='luna'?imageMedia:noMedia)).judgments.interest,0);assert.equal(calls,1);
  });
}
test('cropped attachments retain order and explicitly identify incomplete visible content',async()=>{
  let body;
  const decide=createDecider(k=>settings[k],{log:()=>{},fetch:async(_,o)=>{body=JSON.parse(o.body);return Response.json(answers('luna'));}});
  await decide({...post,text:''},'preference',{...imageMedia,images:[imageMedia.images[0],{...imageMedia.images[0],index:1,source:'screenshot'}]});
  assert.match(body.input[0].content[3].text,/attachment 2.*screenshot crop.*incomplete/);
});
test('incomplete media makes no model request',async()=>{
  let calls=0;const decide=createDecider(k=>settings[k],{log:()=>{},fetch:async()=>{calls++;}});
  await assert.rejects(decide(post,'preference',{hasImages:true,complete:false,images:[]}),/Incomplete/);assert.equal(calls,0);
});
