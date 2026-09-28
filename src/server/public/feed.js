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
function item(row) {
  const entry = el('article', `entry ${row.label}`);
  const card = el('div', 'entry-card');
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
  const footer = el('div', 'entry-actions');
  for (const action of actions(row)) footer.append(el('span', 'action-chip', action));
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

async function loadColumn(key, reset = false) {
  const column = columns[key];
  if (reset) {
    column.controller?.abort();
    column.version++;
    column.offset = 0;
    column.lastSessionId = null;
    column.exhausted = false;
    column.feed.replaceChildren(el('div', 'empty', '正在读取本地记录…'), column.bottom);
    column.more.hidden = true;
    column.bottom.hidden = true;
    column.feed.scrollTop = 0;
  } else if (column.loading || column.exhausted) return;

  const version = column.version;
  const controller = new AbortController();
  column.controller = controller;
  column.loading = true;
  column.more.hidden = true;
  column.bottom.hidden = true;
  try {
    const query = new URLSearchParams({ offset: String(column.offset), limit: '20' });
    if (key !== 'all') query.set('label', key);
    if (source.value) query.set('source', source.value);
    const response = await fetch(`/api/feed?${query}`, { cache: 'no-store', signal: controller.signal });
    if (!response.ok) throw new Error('读取失败');
    const { items } = await response.json();
    if (version !== column.version) return;
    if (!column.offset) column.feed.replaceChildren(column.bottom);
    for (const row of items) {
      if (column.lastSessionId && column.lastSessionId !== row.session_id) column.feed.insertBefore(sessionBoundary(row), column.bottom);
      column.feed.insertBefore(item(row), column.bottom);
      column.lastSessionId = row.session_id;
    }
    column.offset += items.length;
    column.exhausted = items.length < 20;
    column.more.hidden = column.exhausted;
    column.bottom.hidden = column.exhausted;
    column.more.textContent = '加载更多';
    if (!column.offset) column.feed.insertBefore(el('div', 'empty', source.value ? '此来源下暂无记录，试试其他来源。' : '这里还没有记录。启动一次会话后，采集的帖子会出现在此。'), column.bottom);
  } catch (error) {
    if (controller.signal.aborted || version !== column.version) return;
    if (!column.offset) column.feed.replaceChildren(el('div', 'empty', '无法读取本地服务，请检查服务是否运行。'), column.bottom);
    column.more.textContent = '重试';
    column.more.hidden = false;
    column.bottom.hidden = false;
  } finally {
    if (version === column.version) column.loading = false;
  }
}
function refreshColumns() {
  for (const key of columnKeys) loadColumn(key, true);
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
source.addEventListener('change', () => { overview(); refreshColumns(); });
document.querySelectorAll('.more').forEach(button => button.addEventListener('click', () => loadColumn(button.dataset.label)));
document.getElementById('refresh').addEventListener('click', () => { overview(); refreshColumns(); });
overview();
refreshColumns();
setInterval(overview, 5000);
