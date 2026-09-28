import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const script = readFileSync(new URL('../dist/server/public/feed.js', import.meta.url), 'utf8');

function page(createTweet) {
  const timers = [];
  const observed = [];
  const elements = new Map();
  class Element {
    constructor(tag, className = '') {
      this.tag = tag;
      this.classes = new Set(className.split(' ').filter(Boolean));
      this.children = [];
      this.dataset = {};
      this.hidden = false;
      this.textContent = '';
      this.listeners = new Map();
      this.classList = {
        add: (...names) => names.forEach(name => this.classes.add(name)),
        remove: (...names) => names.forEach(name => this.classes.delete(name)),
        contains: name => this.classes.has(name),
        toggle: name => this.classes.has(name) ? (this.classes.delete(name), false) : (this.classes.add(name), true),
      };
    }
    set className(value) { this.classes = new Set(value.split(' ').filter(Boolean)); }
    get className() { return [...this.classes].join(' '); }
    append(...children) { for (const child of children) { child.parentElement = this; this.children.push(child); } }
    replaceChildren(...children) { this.children = []; this.append(...children); }
    insertBefore(child, reference) { child.parentElement = this; this.children.splice(this.children.indexOf(reference), 0, child); }
    querySelector(selector) {
      const [first, second] = selector.split(' ');
      const matches = (node, part) => part.startsWith('.') ? node.classes.has(part.slice(1)) : node.tag === part;
      const walk = (node, part) => {
        for (const child of node.children) {
          if (matches(child, part)) return child;
          const descendant = walk(child, part);
          if (descendant) return descendant;
        }
        return undefined;
      };
      const found = walk(this, first);
      return second && found ? walk(found, second) : found;
    }
    setAttribute() {}
    addEventListener(type, callback) { this.listeners.set(type, callback); }
    click() { this.listeners.get('click')?.(); }
  }
  for (const key of ['all', 'selected', 'ignored', 'insufficient']) {
    const feed = new Element('div');
    const bottom = new Element('div');
    const more = new Element('button');
    bottom.append(more);
    elements.set(`feed-${key}`, feed);
    elements.set(`more-${key}`, more);
  }
  const source = new Element('select');
  source.value = '';
  elements.set('source', source);
  elements.set('sidebar-toggle', new Element('button'));
  elements.set('refresh', new Element('button'));
  const document = {
    createElement: tag => new Element(tag),
    getElementById: id => elements.get(id) || new Element('span'),
    querySelector: selector => selector === '.shell' ? new Element('div') : elements.get(`more-${selector.match(/data-label="([^"]+)"/)?.[1]}`),
    querySelectorAll: selector => selector.includes('widget-pending') ? observed.filter(entry => entry.classList.contains('widget-pending') && !entry.dataset.started) : [],
  };
  const context = vm.createContext({
    document,
    window: createTweet ? { twttr: { widgets: { createTweet } } } : {},
    IntersectionObserver: class { observe(entry) { observed.push(entry); } unobserve() {} },
    URL,
    Date,
    Promise,
    AbortController,
    fetch: () => new Promise(() => {}),
    setInterval: () => 0,
    setTimeout: callback => (timers.push(callback), timers.length),
    clearTimeout: () => {},
    localStorage: { getItem: () => 'false' },
    matchMedia: () => ({ matches: false }),
  });
  vm.runInContext(`${script}\nglobalThis.widgetTest = { item, tryEmbed, actions };`, context);
  const row = {
    seq: 43, label: 'selected', source: 'for_you', seen_at: 1,
    author: 'author', body: 'Post text', url: 'https://x.com/author/status/12345', post_id: '12345',
    exploration_steps: [{ success: false, url: 'https://t.co/fail' }], actual_actions: [],
  };
  return { ...context.widgetTest, row, timers, observed };
}

test('starts with X widget pending and embeds when the post enters view', async () => {
  let calls = 0;
  const { item, tryEmbed, row, observed } = page(() => { calls++; return Promise.resolve({}); });
  const entry = item(row);
  assert.equal(calls, 0);
  assert.equal(entry.classList.contains('widget-pending'), true);
  assert.equal(observed.includes(entry), true);
  assert.equal(entry.querySelector('.show-snapshot').hidden, true);
  tryEmbed(entry);
  await Promise.resolve();
  assert.equal(calls, 1);
  assert.equal(entry.classList.contains('widget-ready'), true);
});

test('uses X widget when the embed resolves', async () => {
  const { item, tryEmbed, row } = page(() => Promise.resolve({}));
  const entry = item(row);
  tryEmbed(entry);
  await Promise.resolve();
  assert.equal(entry.classList.contains('widget-ready'), true);
  assert.equal(entry.classList.contains('widget-unavailable'), false);
  assert.equal(entry.querySelector('.entry-actions').children.length, 0);
});

test('shows an explicit unavailable state when X cannot embed a post', async () => {
  const { item, tryEmbed, row } = page(() => Promise.resolve(null));
  const entry = item(row);
  tryEmbed(entry);
  await Promise.resolve();
  assert.equal(entry.classList.contains('widget-unavailable'), true);
  assert.match(entry.querySelector('.widget-status p').textContent, /无法嵌入/);
  assert.equal(entry.querySelector('.show-snapshot').hidden, false);
});

test('reports a missing X script after the startup grace period', () => {
  const { item, row, timers } = page();
  const entry = item(row);
  timers[0]();
  assert.equal(entry.classList.contains('widget-unavailable'), true);
  assert.match(entry.querySelector('.widget-status p').textContent, /组件未能加载/);
});

test('keeps local text hidden until requested after an embed timeout', () => {
  const { item, tryEmbed, row, timers } = page(() => new Promise(() => {}));
  const entry = item(row);
  tryEmbed(entry);
  timers[1]();
  assert.equal(entry.classList.contains('widget-unavailable'), true);
  assert.match(entry.querySelector('.widget-status p').textContent, /加载超时/);
  assert.equal(entry.classList.contains('show-snapshot'), false);
  entry.querySelector('.show-snapshot').click();
  assert.equal(entry.classList.contains('show-snapshot'), true);
  assert.equal(entry.querySelector('.snapshot').querySelector('.post-text').textContent, 'Post text');
  assert.equal(entry.querySelector('.retry-widget').hidden, false);
});
