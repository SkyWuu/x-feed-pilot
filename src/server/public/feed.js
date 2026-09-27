const feed = document.getElementById('feed');
const more = document.getElementById('more');
const source = document.getElementById('source');
let selectedLabel = '';
let offset = 0;
let loading = false;
let exhausted = false;

function el(tag, className, value) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (value !== undefined) node.textContent = value;
  return node;
}
function validUrl(value) {
  try { const url = new URL(value); return url.hostname === 'x.com' || url.hostname === 'twitter.com' ? url.href : null; }
  catch { return null; }
}
function actions(row) {
  const labels = { open_post:'已打开原帖', author_visit:'已探索作者', like:'已点赞', bookmark:'已收藏' };
  const visits = (row.exploration_steps || []).map(step => {
    let destination = step.url;
    try {
      const url = new URL(step.final_url || step.url);
      destination = step.kind === 'mention' ? `@${url.pathname.split('/').filter(Boolean)[0] || url.hostname}` : url.hostname;
    } catch { /* retain the recorded destination */ }
    return `${step.success ? '已查看' : '访问失败'} ${destination}`;
  });
  return [...visits, ...(row.actual_actions || []).filter(item => item.success).map(item => labels[item.action]).filter(Boolean)];
}
function item(row) {
  const entry = el('article', `entry ${row.label}`);
  const sequence = el('div', 'sequence', `#${String(row.seq).padStart(4, '0')}`);
  const card = el('div', 'entry-card');
  const head = el('div', 'entry-head');
  const labels = { selected:'精选', ignored:'忽略', insufficient:'证据不足' };
  head.append(el('span', `badge ${row.label}`, labels[row.label] || row.label));
  head.append(el('span', 'source', row.source === 'search' ? `主动搜索 · ${row.query || ''}` : 'For You'));
  const time = el('time', '', new Date(row.seen_at).toLocaleString('zh-CN'));
  head.append(time);
  const snapshot = el('div', 'snapshot');
  snapshot.append(el('div', 'author', `@${row.author}`));
  snapshot.append(el('p', 'post-text', row.body || '这条帖子的可读文字不足。'));
  if (row.ocr_text) snapshot.append(el('div', 'ocr', `图片文字 · ${row.ocr_text}`));
  const footer = el('div', 'entry-actions');
  for (const action of actions(row)) footer.append(el('span', 'action-chip', action));
  const href = validUrl(row.url);
  if (href) {
    const link = el('a', 'permalink', '打开原帖 ↗'); link.href = href; link.target = '_blank'; link.rel = 'noopener noreferrer';
    footer.append(link);
  }
  const embed = el('div', 'embed-slot');
  card.append(head, snapshot, embed, footer);
  entry.append(sequence, card);
  if (href && /^\d+$/.test(row.post_id)) {
    entry.dataset.postId = row.post_id;
    entry.dataset.href = href;
    observer.observe(entry);
  }
  return entry;
}
function tryEmbed(entry) {
  if (entry.dataset.started || !window.twttr?.widgets?.createTweet) return;
  entry.dataset.started = '1';
  const mount = entry.querySelector('.embed-slot');
  window.twttr.widgets.createTweet(entry.dataset.postId, mount, { conversation: 'none', align: 'left', dnt: true })
    .then(widget => { if (widget) entry.classList.add('embedded'); })
    .catch(() => { /* snapshot remains visible */ });
}
const observer = new IntersectionObserver(entries => {
  for (const entry of entries) {
    if (entry.isIntersecting && window.twttr?.widgets?.createTweet) { tryEmbed(entry.target); observer.unobserve(entry.target); }
  }
}, { rootMargin: '350px' });
setInterval(() => document.querySelectorAll('.entry[data-post-id]:not([data-started])').forEach(entry => {
  const rect = entry.getBoundingClientRect();
  if (rect.top < innerHeight + 350 && rect.bottom > -350) tryEmbed(entry);
}), 3500);

async function load(reset = false) {
  if (loading) return;
  if (reset) { offset = 0; exhausted = false; feed.replaceChildren(); }
  if (exhausted) return;
  loading = true;
  try {
    const query = new URLSearchParams({ offset: String(offset), limit:'30' });
    if (selectedLabel) query.set('label', selectedLabel);
    if (source.value) query.set('source', source.value);
    const response = await fetch(`/api/feed?${query}`, { cache:'no-store' });
    if (!response.ok) throw new Error('读取失败');
    const { items } = await response.json();
    for (const row of items) feed.append(item(row));
    offset += items.length;
    exhausted = items.length < 30;
    more.hidden = exhausted;
    document.getElementById('result-count').textContent = `已显示 ${offset} 条`;
    if (!offset) feed.append(el('div', 'empty', '还没有符合当前筛选的记录。启动一次会话后，这里会显示真实采集的帖子。'));
  } catch (error) { if (!offset) feed.append(el('div', 'empty', `无法读取本地服务：${error.message}`)); }
  finally { loading = false; }
}
async function overview() {
  try {
    const [records, sessions] = await Promise.all([
      fetch('/api/counts').then(r => r.json()),
      fetch('/api/sessions').then(r => r.json()),
    ]);
    const totals = { selected:records.counts.selected || 0, ignored:records.counts.ignored || 0, insufficient:records.counts.insufficient || 0 };
    const total = Object.values(totals).reduce((sum, n) => sum + n, 0);
    document.getElementById('metric-total').textContent = total;
    document.getElementById('count-all').textContent = total;
    for (const [key, value] of Object.entries(totals)) {
      document.getElementById(`count-${key}`).textContent = value;
      if (key !== 'insufficient') document.getElementById(`metric-${key}`).textContent = value;
    }
    const last = sessions.sessions?.[0];
    document.getElementById('metric-session').textContent = last ? (last.foregroundPaused ? '已暂停' : last.status === 'active' ? '运行中' : '已结束') : '—';
    document.getElementById('metric-reason').textContent = last ? (last.foregroundPaused ? `${last.uniqueCount} 条 · 返回 X 训练页后继续` : `${last.uniqueCount} 条 · ${last.stopReason || last.phase}`) : '等待首次运行';
  } catch { /* page may load before service is ready */ }
}
document.querySelectorAll('.filter').forEach(button => button.addEventListener('click', () => {
  document.querySelector('.filter.active')?.classList.remove('active');
  button.classList.add('active'); selectedLabel = button.dataset.label || ''; load(true);
}));
source.addEventListener('change', () => load(true));
more.addEventListener('click', () => load());
document.getElementById('refresh').addEventListener('click', () => { overview(); load(true); });
overview(); load(true);
setInterval(overview, 5000);
