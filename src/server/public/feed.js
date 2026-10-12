const source = document.getElementById('source');
let widgetScriptTimedOut = false;
const columnKeys = ['all', 'selected', 'ignored', 'insufficient'];
const columns = Object.fromEntries(columnKeys.map(key => [key, {
  feed: document.getElementById(`feed-${key}`),
  more: document.querySelector(`.more[data-label="${key}"]`),
  bottom: document.querySelector(`.more[data-label="${key}"]`).parentElement,
  offset: 0,
  lastSessionId: null,
  exhausted: false,
  loading: false,
  version: 0,
  controller: null,
  entries: new Map(),
  boundaries: new Map(),
}]));

function el(tag, className, value) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (value !== undefined) node.textContent = value;
  return node;
}
function validUrl(value) {
  try { const url = new URL(value); return url.protocol === 'https:' && (url.hostname === 'x.com' || url.hostname === 'twitter.com') ? url.href : null; }
  catch { return null; }
}
function actions(row) {
  const labels = { open_post:'已打开原帖', author_visit:'已探索作者', like:'已点赞', bookmark:'已收藏' };
  const visits = (row.exploration_steps || []).filter(step => step.success).map(step => {
    let destination = step.url;
    try {
      const url = new URL(step.final_url || step.url);
      destination = step.kind === 'mention' ? `@${url.pathname.split('/').filter(Boolean)[0] || url.hostname}` : url.hostname;
    } catch { /* retain the recorded destination */ }
    return `已查看 ${destination}`;
  });
  return [...visits, ...(row.actual_actions || []).filter(item => item.success).map(item => labels[item.action]).filter(Boolean)];
}
function entryHead(row) {
  const head = el('div', 'entry-head');
  const labels = { selected:'精选', ignored:'忽略', insufficient:'证据不足' };
  const sequence = el('span', 'sequence', `#${String(row.seq).padStart(4, '0')}`);
  sequence.title = `第 ${row.seq} 条曝光记录`;
  sequence.setAttribute('aria-label', sequence.title);
  head.append(sequence);
  head.append(el('span', `badge ${row.label}`, labels[row.label] || row.label));
  head.append(el('span', 'source', row.source === 'search' ? `主动搜索 · ${row.query || ''}` : 'For You'));
  const time = el('time', '', new Date(row.seen_at).toLocaleString('zh-CN'));
  head.append(time);
  return head;
}
function entrySnapshot(row) {
  const snapshot = el('div', 'snapshot');
  snapshot.append(el('div', 'author', `@${row.author}`));
  const body = row.body || '这条帖子的可读文字不足。';
  const postText = el('p', 'post-text', body);
  snapshot.append(postText);
  if (body.length > 320) {
    postText.classList.add('is-clamped');
    const expand = el('button', 'expand', '展开全文');
    expand.type = 'button';
    expand.setAttribute('aria-expanded', 'false');
    expand.addEventListener('click', () => {
      const collapsed = postText.classList.toggle('is-clamped');
      expand.textContent = collapsed ? '展开全文' : '收起全文';
      expand.setAttribute('aria-expanded', String(!collapsed));
    });
    snapshot.append(expand);
  }
  if (row.ocr_text) {
    const ocr = el('details', 'ocr');
    ocr.append(el('summary', '', '查看图片文字'));
    ocr.append(el('div', 'ocr-content', row.ocr_text));
    snapshot.append(ocr);
  }
  return snapshot;
}
function entryActions(row) {
  const footer = el('div', 'entry-actions');
  for (const action of actions(row)) footer.append(el('span', 'action-chip', action));
  return footer;
}
function item(row) {
  const entry = el('article', `entry ${row.label}`);
  const card = el('div', 'entry-card');
  const head = entryHead(row);
  const snapshot = entrySnapshot(row);
  const footer = entryActions(row);
  const href = validUrl(row.url);
  const embed = el('div', 'embed-slot');
  const status = el('div', 'widget-status');
  const statusText = el('p', '', '正在加载 X 帖子…');
  const showSnapshot = el('button', 'show-snapshot', '查看本地采集文字');
  showSnapshot.type = 'button';
  showSnapshot.hidden = true;
  showSnapshot.addEventListener('click', () => {
    const showing = entry.classList.toggle('show-snapshot');
    showSnapshot.textContent = showing ? '收起本地采集文字' : '查看本地采集文字';
    showSnapshot.setAttribute('aria-expanded', String(showing));
  });
  const retryWidget = el('button', 'retry-widget', '重试加载 X 帖子');
  retryWidget.type = 'button';
  retryWidget.hidden = true;
  retryWidget.addEventListener('click', () => {
    delete entry.dataset.started;
    tryEmbed(entry);
  });
  status.append(statusText, showSnapshot, retryWidget);
  if (href) {
    const link = el('a', '', '在 X 查看 ↗');
    link.href = href; link.target = '_blank'; link.rel = 'noopener noreferrer';
    status.append(link);
  }
  card.append(head, snapshot, embed, status, footer);
  entry.append(card);
  if (href && /^\d+$/.test(row.post_id)) {
    entry.classList.add('widget-pending');
    entry.dataset.postId = row.post_id;
    observer.observe(entry);
    if (widgetScriptTimedOut && !window.twttr?.widgets?.createTweet) markWidgetUnavailable(entry, 'X 组件未能加载，请检查浏览器网络连接。');
  } else {
    markWidgetUnavailable(entry, '这条记录没有可嵌入的 X 帖子。');
    retryWidget.hidden = true;
  }
  return entry;
}
function sessionBoundary(row) {
  const date = new Date(row.session_started_at);
  const when = Number.isNaN(date.getTime()) ? '' : ` · ${date.toLocaleString('zh-CN', { year: 'numeric', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false })}`;
  const divider = el('div', 'session-divider', `上一轮运行${when}`);
  divider.setAttribute('role', 'separator');
  return divider;
}
function markWidgetUnavailable(entry, message) {
  entry.classList.remove('widget-idle', 'widget-pending', 'widget-ready');
  entry.classList.add('widget-unavailable');
  entry.querySelector('.widget-status p').textContent = message;
  entry.querySelector('.show-snapshot').hidden = false;
  entry.querySelector('.retry-widget').hidden = false;
}
function tryEmbed(entry) {
  if (entry.dataset.started || entry.classList.contains('widget-ready')) return;
  if (!window.twttr?.widgets?.createTweet) {
    markWidgetUnavailable(entry, 'X 组件未能加载，请检查浏览器网络连接。');
    return;
  }
  entry.dataset.started = '1';
  entry.classList.remove('widget-idle', 'widget-unavailable', 'show-snapshot');
  entry.classList.add('widget-pending');
  entry.querySelector('.widget-status p').textContent = '正在加载 X 帖子…';
  entry.querySelector('.show-snapshot').hidden = true;
  entry.querySelector('.show-snapshot').textContent = '查看本地采集文字';
  entry.querySelector('.retry-widget').hidden = true;
  const mount = entry.querySelector('.embed-slot');
  mount.replaceChildren();
  const attempt = String(Number(entry.dataset.attempt || 0) + 1);
  entry.dataset.attempt = attempt;
  const timeout = setTimeout(() => {
    if (entry.dataset.attempt === attempt && entry.classList.contains('widget-pending')) markWidgetUnavailable(entry, 'X 帖子加载超时。');
  }, 12000);
  try {
    Promise.resolve(window.twttr.widgets.createTweet(entry.dataset.postId, mount, { conversation: 'none', align: 'center', dnt: true, theme: 'light' }))
      .then(widget => {
        clearTimeout(timeout);
        if (entry.dataset.attempt !== attempt) return;
        if (widget) {
          entry.classList.remove('widget-pending', 'widget-unavailable', 'show-snapshot');
          entry.classList.add('widget-ready');
        } else markWidgetUnavailable(entry, 'X 无法嵌入这条帖子，可能已删除或设为私密。');
      })
      .catch(() => {
        clearTimeout(timeout);
        if (entry.dataset.attempt === attempt && entry.classList.contains('widget-pending')) markWidgetUnavailable(entry, 'X 帖子暂时无法加载。');
      });
  } catch {
    clearTimeout(timeout);
    markWidgetUnavailable(entry, 'X 帖子暂时无法加载。');
  }
}
const observer = new IntersectionObserver(entries => {
  for (const entry of entries) {
    if (entry.isIntersecting && window.twttr?.widgets?.createTweet) {
      tryEmbed(entry.target);
      observer.unobserve(entry.target);
    }
  }
}, { rootMargin: '250px' });
setInterval(() => document.querySelectorAll('.entry[data-post-id]:not([data-started])').forEach(entry => {
  const rect = entry.getBoundingClientRect();
  if (rect.width && rect.height && rect.top < innerHeight + 250 && rect.bottom > -250 && rect.left < innerWidth + 250 && rect.right > -250) tryEmbed(entry);
}), 1000);
setTimeout(() => {
  widgetScriptTimedOut = true;
  if (!window.twttr?.widgets?.createTweet) {
    document.querySelectorAll('.entry.widget-pending:not([data-started])').forEach(entry => {
      markWidgetUnavailable(entry, 'X 组件未能加载，请检查浏览器网络连接。');
    });
  }
}, 8000);

function updateEntry(record, row) {
  const { entry, row: previous } = record;
  if (JSON.stringify([previous.label, previous.seq, previous.source, previous.query, previous.seen_at]) !== JSON.stringify([row.label, row.seq, row.source, row.query, row.seen_at])) {
    entry.classList.remove(previous.label);
    entry.classList.add(row.label);
    entry.querySelector('.entry-head').replaceWith(entryHead(row));
  }
  if (JSON.stringify([previous.author, previous.body, previous.ocr_text]) !== JSON.stringify([row.author, row.body, row.ocr_text])) {
    const oldSnapshot = entry.querySelector('.snapshot');
    const snapshot = entrySnapshot(row);
    if (oldSnapshot.querySelector('.expand')?.getAttribute('aria-expanded') === 'true') snapshot.querySelector('.expand')?.click();
    const ocr = snapshot.querySelector('.ocr');
    if (ocr) ocr.open = oldSnapshot.querySelector('.ocr')?.open || false;
    oldSnapshot.replaceWith(snapshot);
  }
  const nextActions = actions(row);
  if (JSON.stringify(actions(previous)) !== JSON.stringify(nextActions)) entry.querySelector('.entry-actions').replaceWith(entryActions(row));
  record.row = row;
}
function reconcileColumn(column, rows) {
  const wanted = [];
  const entries = new Map();
  const boundaries = new Map();
  let lastSessionId = null;
  for (const row of rows) {
    if (lastSessionId && lastSessionId !== row.session_id) {
      const divider = column.boundaries.get(row.session_id) || sessionBoundary(row);
      boundaries.set(row.session_id, divider);
      wanted.push(divider);
    }
    let record = column.entries.get(row.seq);
    if (record) updateEntry(record, row);
    else record = { entry: item(row), row };
    entries.set(row.seq, record);
    wanted.push(record.entry);
    lastSessionId = row.session_id;
  }
  for (const [seq, record] of column.entries) {
    if (!entries.has(seq)) observer.unobserve(record.entry);
  }
  const keep = new Set([...wanted, column.bottom]);
  for (const child of [...column.feed.children]) if (!keep.has(child)) child.remove();
  // Leave retained nodes in place: moving a loaded iframe can reload its X widget.
  let cursor = column.feed.firstElementChild;
  for (const node of wanted) {
    if (node === cursor) cursor = cursor.nextElementSibling;
    else column.feed.insertBefore(node, cursor);
  }
  column.entries = entries;
  column.boundaries = boundaries;
  column.lastSessionId = lastSessionId;
  if (!rows.length) column.feed.insertBefore(el('div', 'empty', source.value ? '此来源下暂无记录，试试其他来源。' : '这里还没有记录。启动一次会话后，采集的帖子会出现在此。'), column.bottom);
}
async function loadColumn(key, mode = 'more') {
  const column = columns[key];
  if (mode === 'more' && (column.loading || column.exhausted)) return;
  if (mode !== 'more') {
    column.controller?.abort();
    column.version++;
  }
  const target = Math.max(20, column.offset);
  if (mode === 'reset') {
    for (const { entry } of column.entries.values()) observer.unobserve(entry);
    column.entries.clear();
    column.boundaries.clear();
    column.offset = 0;
    column.lastSessionId = null;
    column.exhausted = false;
    column.feed.replaceChildren(el('div', 'empty', '正在读取本地记录…'), column.bottom);
    column.feed.scrollTop = 0;
  }
  const version = column.version;
  const controller = new AbortController();
  column.controller = controller;
  column.loading = true;
  column.more.hidden = true;
  column.bottom.hidden = true;
  try {
    const rows = [];
    let exhausted = false;
    const refreshing = mode === 'refresh';
    do {
      const limit = refreshing ? Math.min(100, target - rows.length) : 20;
      const query = new URLSearchParams({ offset: String(refreshing ? rows.length : column.offset), limit: String(limit) });
      if (key !== 'all') query.set('label', key);
      if (source.value) query.set('source', source.value);
      const response = await fetch(`/api/feed?${query}`, { cache: 'no-store', signal: controller.signal });
      if (!response.ok) throw new Error('读取失败');
      const { items } = await response.json();
      if (version !== column.version) return;
      rows.push(...items);
      exhausted = items.length < limit;
    } while (refreshing && !exhausted && rows.length < target);
    const allRows = mode === 'more' ? [...column.entries.values()].map(record => record.row).concat(rows) : rows;
    reconcileColumn(column, allRows);
    column.offset = allRows.length;
    column.exhausted = exhausted;
    column.more.hidden = exhausted;
    column.bottom.hidden = exhausted;
    column.more.textContent = '加载更多';
    column.retryMode = null;
  } catch (error) {
    if (controller.signal.aborted || version !== column.version) return;
    if (!column.offset) column.feed.replaceChildren(el('div', 'empty', '无法读取本地服务，请检查服务是否运行。'), column.bottom);
    column.more.textContent = mode === 'more' ? '重试' : '刷新失败，点击重试';
    column.more.hidden = false;
    column.bottom.hidden = false;
    column.retryMode = mode;
  } finally {
    if (version === column.version) column.loading = false;
  }
}
function refreshColumns(reset = false) {
  for (const key of columnKeys) loadColumn(key, reset ? 'reset' : 'refresh');
}
async function overview() {
  try {
    const [records, sessions] = await Promise.all([
      fetch('/api/counts', { cache: 'no-store' }).then(r => r.json()),
      fetch('/api/sessions', { cache: 'no-store' }).then(r => r.json()),
    ]);
    const totals = { selected: records.counts.selected || 0, ignored: records.counts.ignored || 0, insufficient: records.counts.insufficient || 0 };
    const total = Object.values(totals).reduce((sum, n) => sum + n, 0);
    document.getElementById('count-all').textContent = total;
    for (const [key, value] of Object.entries(totals)) {
      document.getElementById(`count-${key}`).textContent = value;
    }
    for (const key of columnKeys) document.getElementById(`column-count-${key}`).textContent = source.value ? '来源筛选中' : (key === 'all' ? total : totals[key]);
    const last = sessions.sessions?.[0];
    document.getElementById('metric-session').textContent = last ? (last.foregroundPaused ? '已暂停' : last.status === 'active' ? '运行中' : '已结束') : '—';
    document.getElementById('metric-reason').textContent = last ? ` · ${last.uniqueCount} 条${last.foregroundPaused ? ' · 返回 X 后继续' : ''}` : '';
  } catch { /* page may load before service is ready */ }
}
const shell = document.querySelector('.shell');
const sidebarToggle = document.getElementById('sidebar-toggle');
function setSidebarCollapsed(collapsed) {
  shell.classList.toggle('sidebar-collapsed', collapsed);
  sidebarToggle.textContent = collapsed ? '›' : '‹';
  sidebarToggle.setAttribute('aria-label', collapsed ? '展开侧栏' : '收起侧栏');
  sidebarToggle.setAttribute('aria-expanded', String(!collapsed));
  sidebarToggle.title = collapsed ? '展开侧栏' : '收起侧栏';
}
try { setSidebarCollapsed(localStorage.getItem('feedPilot.sidebarCollapsed') === 'true'); }
catch { setSidebarCollapsed(false); }
sidebarToggle.addEventListener('click', () => {
  const collapsed = !shell.classList.contains('sidebar-collapsed');
  setSidebarCollapsed(collapsed);
  try { localStorage.setItem('feedPilot.sidebarCollapsed', String(collapsed)); }
  catch { /* Keep the current view when local storage is unavailable. */ }
});
document.querySelectorAll('.deck-link').forEach(button => button.addEventListener('click', () => {
  const key = button.dataset.column;
  document.querySelectorAll('.deck-link').forEach(link => {
    link.classList.toggle('active', link === button);
    if (link === button) link.setAttribute('aria-current', 'true');
    else link.removeAttribute('aria-current');
  });
  document.querySelectorAll('.column').forEach(column => column.classList.toggle('is-current', column.id === `column-${key}`));
  if (matchMedia('(min-width: 701px)').matches) document.getElementById(`column-${key}`).scrollIntoView({ block: 'nearest', inline: 'start', behavior: 'smooth' });
}));
source.addEventListener('change', () => { overview(); refreshColumns(true); });
document.querySelectorAll('.more').forEach(button => button.addEventListener('click', () => loadColumn(button.dataset.label, columns[button.dataset.label].retryMode || 'more')));
document.getElementById('refresh').addEventListener('click', () => { overview(); refreshColumns(); });
overview();
refreshColumns(true);
setInterval(overview, 5000);
