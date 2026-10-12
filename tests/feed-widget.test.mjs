import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const script = readFileSync(new URL('../dist/server/public/feed.js', import.meta.url), 'utf8');

function page(createTweet) {
  const timers = [];
  const observed = [];
  const elements = new Map();
  let fetchResponse = () => new Promise(() => {});
  class Element {
    constructor(tag, className = '') {
      this.tag = tag;
      this.classes = new Set(className.split(' ').filter(Boolean));
      this.children = [];
      this.dataset = {};
      this.hidden = false;
      this.textContent = '';
      this.listeners = new Map();
      this.attributes = new Map();
      this.scrollTop = 0;
      this.moves = 0;
      this.classList = {
        add: (...names) => names.forEach(name => this.classes.add(name)),
        remove: (...names) => names.forEach(name => this.classes.delete(name)),
        contains: name => this.classes.has(name),
        toggle: name => this.classes.has(name) ? (this.classes.delete(name), false) : (this.classes.add(name), true),
      };
    }
    set className(value) { this.classes = new Set(value.split(' ').filter(Boolean)); }
    get className() { return [...this.classes].join(' '); }
    get firstElementChild() { return this.children[0] || null; }
    get nextElementSibling() { return this.parentElement?.children[this.parentElement.children.indexOf(this) + 1] || null; }
    append(...children) { for (const child of children) { child.remove(); child.parentElement = this; this.children.push(child); } }
    replaceChildren(...children) { for (const child of [...this.children]) child.remove(); this.append(...children); }
    insertBefore(child, reference) {
      if (child.parentElement) child.moves++;
      child.remove();
      child.parentElement = this;
      this.children.splice(reference ? this.children.indexOf(reference) : this.children.length, 0, child);
    }
    remove() {
      if (!this.parentElement) return;
      this.parentElement.children.splice(this.parentElement.children.indexOf(this), 1);
      this.parentElement = null;
    }
    replaceWith(node) { this.parentElement.insertBefore(node, this); this.remove(); }
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
    setAttribute(name, value) { this.attributes.set(name, value); }
    getAttribute(name) { return this.attributes.get(name); }
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
    URLSearchParams,
    fetch: (...args) => fetchResponse(...args),
    setInterval: () => 0,
    setTimeout: callback => (timers.push(callback), timers.length),
    clearTimeout: () => {},
    localStorage: { getItem: () => 'false' },
    matchMedia: () => ({ matches: false }),
  });
  vm.runInContext(`${script}\nglobalThis.widgetTest = { item, tryEmbed, actions, loadColumn, columns };`, context);
  const row = {
    seq: 43, session_id: 'session-1', session_started_at: 1, label: 'selected', source: 'for_you', seen_at: 1,
    author: 'author', body: 'Post text', url: 'https://x.com/author/status/12345', post_id: '12345',
    exploration_steps: [{ success: false, url: 'https://t.co/fail' }], actual_actions: [],
  };
  return { ...context.widgetTest, row, timers, observed, elements, setFetch: fn => { fetchResponse = fn; } };
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

function feedResponse(rows) {
  return { ok: true, json: async () => ({ items: rows }) };
}

test('refresh keeps loaded widgets, reading state and scroll position without moving retained cards', async () => {
  let calls = 0;
  const view = page(() => { calls++; return Promise.resolve({}); });
  view.setFetch(async () => feedResponse([view.row]));
  await view.loadColumn('all', 'reset');
  const column = view.columns.all;
  const entry = column.feed.querySelector('.entry');
  view.tryEmbed(entry);
  await Promise.resolve();
  entry.querySelector('.show-snapshot').click();
  column.feed.scrollTop = 320;
  await view.loadColumn('all', 'refresh');
  assert.equal(column.feed.querySelector('.entry'), entry);
  assert.equal(entry.moves, 0);
  assert.equal(entry.classList.contains('widget-ready'), true);
  assert.equal(entry.classList.contains('show-snapshot'), true);
  assert.equal(column.feed.scrollTop, 320);
  assert.equal(calls, 1);
});

test('refresh inserts new sessions and updates metadata while preserving the existing embed and expanded text', async () => {
  const view = page(() => Promise.resolve({}));
  const original = { ...view.row, body: 'Long text '.repeat(50) };
  view.setFetch(async () => feedResponse([original]));
  await view.loadColumn('all', 'reset');
  const column = view.columns.all;
  const entry = column.entries.get(original.seq).entry;
  const embed = entry.querySelector('.embed-slot');
  view.tryEmbed(entry);
  await Promise.resolve();
  entry.querySelector('.expand').click();
  const next = { ...original, label: 'ignored', body: 'Updated long text '.repeat(50), actual_actions: [{ action: 'like', success: true }] };
  const newest = { ...original, seq: 44, session_id: 'session-2', session_started_at: 2 };
  view.setFetch(async () => feedResponse([newest, next]));
  await view.loadColumn('all', 'refresh');
  assert.deepEqual([...column.entries.keys()], [44, 43]);
  assert.equal(column.feed.children[1].classList.contains('session-divider'), true);
  assert.equal(column.entries.get(43).entry, entry);
  assert.equal(entry.moves, 0);
  assert.equal(entry.querySelector('.embed-slot'), embed);
  assert.equal(entry.classList.contains('widget-ready'), true);
  assert.equal(entry.classList.contains('ignored'), true);
  assert.equal(entry.querySelector('.post-text').textContent, next.body);
  assert.equal(entry.querySelector('.post-text').classList.contains('is-clamped'), false);
  assert.equal(entry.querySelector('.entry-actions').children[0].textContent, '已点赞');
  await view.loadColumn('all', 'refresh');
  assert.equal(entry.moves, 0);
  assert.equal(column.feed.children.filter(node => node.classList.contains('session-divider')).length, 1);
});

test('refresh preserves loaded pagination beyond the API limit and removes records that leave a category', async () => {
  const view = page();
  let rows = Array.from({ length: 120 }, (_, index) => ({ ...view.row, seq: index + 1 }));
  const requests = [];
  view.setFetch(async url => {
    const query = new URL(url, 'http://localhost').searchParams;
    const offset = Number(query.get('offset'));
    const limit = Number(query.get('limit'));
    requests.push({ offset, limit });
    return feedResponse(rows.slice(offset, offset + limit));
  });
  await view.loadColumn('selected', 'reset');
  for (let i = 0; i < 5; i++) await view.loadColumn('selected');
  const column = view.columns.selected;
  const retained = column.entries.get(1).entry;
  requests.length = 0;
  await view.loadColumn('selected', 'refresh');
  assert.deepEqual(requests, [{ offset: 0, limit: 100 }, { offset: 100, limit: 20 }]);
  assert.equal(column.offset, 120);
  assert.equal(column.entries.get(1).entry, retained);
  assert.equal(retained.moves, 0);
  rows = rows.slice(1);
  await view.loadColumn('selected', 'refresh');
  assert.equal(column.entries.has(1), false);
  assert.equal(retained.parentElement, null);
  assert.equal(column.offset, 119);
  assert.equal(column.exhausted, true);
});

test('a failed refresh keeps existing cards and retries the refresh instead of loading the next page', async () => {
  const view = page();
  view.setFetch(async () => feedResponse([view.row]));
  await view.loadColumn('all', 'reset');
  const column = view.columns.all;
  const entry = column.entries.get(view.row.seq).entry;
  view.setFetch(async () => { throw new Error('offline'); });
  await view.loadColumn('all', 'refresh');
  assert.equal(column.entries.get(view.row.seq).entry, entry);
  assert.equal(entry.parentElement, column.feed);
  assert.equal(column.retryMode, 'refresh');
  assert.match(column.more.textContent, /刷新失败/);
});

test('a source reset supersedes an in-flight refresh and clears cards from the previous source', async () => {
  const view = page();
  view.setFetch(async () => feedResponse([view.row]));
  await view.loadColumn('all', 'reset');
  const oldEntry = view.columns.all.entries.get(view.row.seq).entry;
  let resolveRefresh;
  view.setFetch(() => new Promise(resolve => { resolveRefresh = resolve; }));
  const refresh = view.loadColumn('all', 'refresh');
  view.elements.get('source').value = 'search';
  const next = { ...view.row, seq: 44, source: 'search' };
  view.setFetch(async () => feedResponse([next]));
  await view.loadColumn('all', 'reset');
  resolveRefresh(feedResponse([view.row]));
  await refresh;
  assert.deepEqual([...view.columns.all.entries.keys()], [44]);
  assert.equal(oldEntry.parentElement, null);
  assert.equal(view.columns.all.loading, false);
});
