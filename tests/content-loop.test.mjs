import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runInNewContext } from 'node:vm';

test('a background session pauses, then observes an unread post before refreshing', async () => {
  const events = [];
  let statusCalls = 0;
  let focusCalls = 0;
  const link = { href: 'https://x.com/example/status/123456789012345' };
  const article = {
    querySelector: selector => selector === 'time' ? { closest: () => link } : null,
    querySelectorAll: () => [],
    scrollIntoView: () => {},
  };
  const notice = {
    innerText: 'Show 105 posts',
    getAttribute: () => null,
    getBoundingClientRect: () => ({ width: 100, height: 25, top: 0, bottom: 25 }),
    hasAttribute: () => false,
    click: () => events.push('refresh'),
  };
  const document = {
    hasFocus: () => focusCalls++ > 0,
    visibilityState: 'visible',
    querySelectorAll: selector => {
      if (selector === 'article[data-testid="tweet"]') return [article];
      if (selector === 'button,[role="button"]') return [notice];
      return [];
    },
  };
  const chrome = { runtime: { sendMessage: async message => {
    if (message.type === 'STATUS') {
      return { ok: true, value: { session: { id: 'session', status: statusCalls++ < 2 ? 'active' : 'stopped', phase: 'for_you' } } };
    }
    if (message.type === 'FOREGROUND') {
      events.push(`foreground:${message.foreground}`);
      return { ok: true, value: {} };
    }
    if (message.type === 'OBSERVE') {
      events.push('observe');
      return { ok: true, value: { observationSeq: 1, plan: { phase: 'stopped', dwellMs: 0 } } };
    }
    throw new Error(`Unexpected message: ${message.type}`);
  } } };
  const compiled = readFileSync(new URL('../dist/extension/content.js', import.meta.url), 'utf8');
  const startup = compiled.indexOf('if (/^\\/(home|search)/.test(location.pathname))');
  assert.ok(startup > 0);
  const context = {
    chrome, document, location: { pathname: '/home' },
    getComputedStyle: () => ({ visibility: 'visible', display: 'block' }),
    setTimeout: callback => queueMicrotask(callback),
    window: { scrollBy: () => {} },
    innerHeight: 800, innerWidth: 1000,
  };
  await runInNewContext(`${compiled.slice(0, startup)}\nloop()`, context);
  assert.deepEqual(events, ['foreground:false', 'foreground:true', 'observe']);
});

test('time spent away from the training tab does not consume the session', async t => {
  const dir = mkdtempSync(join(tmpdir(), 'feed-foreground-test-'));
  writeFileSync(join(dir, 'PREFERENCE.md'), 'Interested in small language model evaluation.');
  writeFileSync(join(dir, 'search-seeds.json'), JSON.stringify(['SLM benchmark']));
  const probe = createServer();
  await new Promise(resolve => probe.listen(0, '127.0.0.1', resolve));
  const port = probe.address().port;
  await new Promise(resolve => probe.close(resolve));
  const app = spawn(process.execPath, [new URL('../dist/server/server.js', import.meta.url).pathname], {
    cwd: dir, env: { ...process.env, PILOT_PORT: String(port), TYPESAFE_API_KEY: 'test-key', OPENAI_API_KEY: 'test-openai-key' },
  });
  t.after(async () => {
    if (app.exitCode === null) {
      const exit = new Promise(resolve => app.once('exit', resolve));
      app.kill();
      await exit;
    }
    rmSync(dir, { recursive: true, force: true });
  });
  let output = '';
  app.stdout.on('data', chunk => output += chunk);
  for (let i = 0; i < 60 && !output.includes('Feed:'); i++) await new Promise(resolve => setTimeout(resolve, 100));
  assert.match(output, /Feed:/);
  const api = async (path, method = 'GET', value) => {
    const response = await fetch(`http://127.0.0.1:${port}${path}`, {
      method,
      headers: { origin: 'chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        'x-x-feed-pilot-extension-id': 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', 'content-type': 'application/json' },
      body: value === undefined ? undefined : JSON.stringify(value),
    });
    assert.equal(response.status, 200);
    return response.json();
  };
  const started = await api('/api/session/start', 'POST', {});
  const sessionId = started.session.id;
  const initialStart = started.session.startedAt;
  const paused = await api('/api/session/foreground', 'POST', { sessionId, foreground: false });
  assert.equal(paused.session.foregroundPaused, true);
  await new Promise(resolve => setTimeout(resolve, 120));
  const duringPause = await api('/api/session/status');
  assert.equal(duringPause.session.startedAt, initialStart);
  assert.equal(duringPause.session.foregroundPaused, true);
  const resumed = await api('/api/session/foreground', 'POST', { sessionId, foreground: true });
  assert.equal(resumed.session.foregroundPaused, false);
  assert.ok(resumed.session.startedAt - initialStart >= 100);
  assert.equal((await api('/api/sessions')).sessions[0].foregroundPaused, false);
});

test('a model failure moves to the next Tweet without retrying or interacting',async()=>{
  let checks=0;const observed=[];
  const articles=['123456789012345','123456789012346'].map(id=>({
    querySelector:selector=>selector==='time'?{closest:()=>({href:`https://x.com/a/status/${id}`})}:null,
    querySelectorAll:()=>[],scrollIntoView:()=>{},
  }));
  const context={
    chrome:{runtime:{sendMessage:async message=>{
      if(message.type==='STATUS')return {ok:true,value:{session:{id:'s',status:checks++<2?'active':'stopped',phase:'for_you'}}};
      if(message.type==='FOREGROUND')return {ok:true,value:{}};
      if(message.type==='OBSERVE'){observed.push(message.post.postId);return {ok:false,error:'Model unavailable',code:'decision_failed'};}
      throw new Error('Unexpected action '+message.type);
    }}},
    document:{hasFocus:()=>true,visibilityState:'visible',querySelectorAll:selector=>selector==='article[data-testid="tweet"]'?articles:[]},
    location:{pathname:'/home'},innerWidth:1000,innerHeight:800,setTimeout:callback=>queueMicrotask(callback),window:{scrollBy:()=>{}},
  };
  const compiled=readFileSync(new URL('../dist/extension/content.js',import.meta.url),'utf8');
  const startup=compiled.indexOf('if (/^\\/(home|search)/.test(location.pathname))');
  await runInNewContext(compiled.slice(0,startup)+'\nloop()',context);
  assert.deepEqual(observed,['123456789012345','123456789012346']);
});
