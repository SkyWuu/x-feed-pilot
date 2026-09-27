declare const chrome: any;
type Phase = 'for_you' | 'search' | 'return' | 'stopped';
type Plan = { label: string; dwellMs: number; openPost: boolean; visitAuthor: boolean; like: boolean; bookmark: boolean; phase: Phase; query?: string; stopReason?: string; nextVisit?: { kind: 'link' | 'mention'; url: string } };
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
let running = false;
const seen = new Set<string>();
let mousePosition: { x: number; y: number } | null = null;
let hoveredElement: Element | null = null;
let indicator: HTMLElement | null = null;
let checkingIndicator = false;

function setIndicator(active: boolean): void {
  if (!indicator) {
    const host = document.createElement('div');
    host.id = 'x-feed-pilot-status';
    host.style.cssText = 'all: initial; position: fixed; z-index: 2147483647; right: 16px; bottom: 16px; pointer-events: none;';
    const shadow = host.attachShadow({ mode: 'closed' });
    shadow.innerHTML = `
      <style>
        :host { all: initial; }
        .badge {
          display: flex; align-items: center; gap: 8px; padding: 8px 11px;
          border: 1px solid rgba(255,255,255,.12); border-radius: 999px;
          background: rgba(24, 31, 27, .92); color: #f3f7f3;
          box-shadow: 0 3px 14px rgba(0,0,0,.2);
          font: 500 12px/1 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
          letter-spacing: .01em; white-space: nowrap;
        }
        .lamp {
          width: 8px; height: 8px; flex: none; border-radius: 50%;
          background: #55d98a; box-shadow: 0 0 7px rgba(85,217,138,.75);
          animation: pilot-pulse 2.8s ease-in-out infinite;
        }
        @keyframes pilot-pulse {
          0%, 100% { opacity: 1; box-shadow: 0 0 7px rgba(85,217,138,.75); }
          50% { opacity: .42; box-shadow: 0 0 2px rgba(85,217,138,.35); }
        }
        @media (prefers-reduced-motion: reduce) { .lamp { animation: none; } }
      </style>
      <div class="badge" role="status" aria-live="polite" aria-label="X Feed Pilot 正在运行">
        <span class="lamp" aria-hidden="true"></span><span>正在运行</span>
      </div>`;
    document.documentElement.appendChild(host);
    indicator = host;
  }
  indicator.style.display = active ? 'block' : 'none';
}

async function refreshIndicator(): Promise<void> {
  if (checkingIndicator) return;
  checkingIndicator = true;
  try {
    const state = await send('STATUS');
    setIndicator(state.session?.status === 'active');
  } catch {
    setIndicator(false);
  } finally {
    checkingIndicator = false;
  }
}

async function send(type: string, data: Record<string, unknown> = {}): Promise<any> {
  const response = await chrome.runtime.sendMessage({ type, ...data });
  if (!response?.ok) throw new Error(response?.error || '扩展通信失败');
  return response.value;
}
function canonical(article: Element): { id: string; url: string } | null {
  const timestamp = article.querySelector('time')?.closest<HTMLAnchorElement>('a[href*="/status/"]');
  const links = [timestamp, ...Array.from(article.querySelectorAll<HTMLAnchorElement>('a[href*="/status/"]'))].filter((link): link is HTMLAnchorElement => !!link);
  for (const link of links) {
    const match = link.href.match(/https:\/\/(?:x\.com|twitter\.com)\/[^/]+\/status\/(\d+)/);
    if (match) return { id: match[1], url: match[0] };
  }
  return null;
}
function articleFor(id: string): Element | undefined {
  return Array.from(document.querySelectorAll('article[data-testid="tweet"]')).find(article => canonical(article)?.id === id);
}
function author(article: Element): string {
  const user = article.querySelector<HTMLAnchorElement>('[data-testid="User-Name"] a[href^="/"]');
  return user?.getAttribute('href')?.replace(/^\//, '').split('/')[0] || 'unknown';
}
function authorUrl(handle: string): string | null {
  return /^[A-Za-z0-9_]{1,15}$/.test(handle) ? `https://x.com/${handle}` : null;
}
async function expand(article: Element): Promise<void> {
  const candidates = Array.from(article.querySelectorAll<HTMLElement>('button,a,[role="button"]'));
  const control = candidates.find(el => /^(show more|显示更多|展开)$/i.test(el.innerText.trim()));
  if (control) { control.click(); await sleep(450); }
}
function postMentions(article: Element): { handle: string; url: string }[] {
  const body = article.querySelector<HTMLElement>('[data-testid="tweetText"]');
  if (!body) return [];
  const handles = new Map<string, string>();
  const add = (handle: string): void => {
    if (!/^[A-Za-z0-9_]{1,15}$/.test(handle)) return;
    const key = handle.toLowerCase();
    if (!handles.has(key)) handles.set(key, handle);
  };
  for (const link of Array.from(body.querySelectorAll<HTMLAnchorElement>('a[href]'))) {
    const match = link.textContent?.trim().match(/^@([A-Za-z0-9_]{1,15})$/);
    if (!match) continue;
    let url: URL;
    try { url = new URL(link.href); } catch { continue; }
    if (!['x.com', 'twitter.com'].includes(url.hostname)) continue;
    if (url.pathname.toLowerCase() !== `/${match[1].toLowerCase()}`) continue;
    add(match[1]);
  }
  // A plain-text mention can appear before X turns it into a profile anchor.
  const plainText = body.innerText.replace(/https?:\/\/\S+/g, ' ');
  for (const match of plainText.matchAll(/(^|[^\w@])@([A-Za-z0-9_]{1,15})(?![\w])/g)) add(match[2]);
  return Array.from(handles.values(), handle => ({ handle, url: `https://x.com/${handle}` }));
}
function postLinks(article: Element): { url: string; text: string }[] {
  const body = article.querySelector<HTMLElement>('[data-testid="tweetText"]');
  const links = [
    ...Array.from(body?.querySelectorAll<HTMLAnchorElement>('a[href]') || []),
    ...Array.from(article.querySelectorAll<HTMLAnchorElement>('[data-testid="card.wrapper"] a[href], a[data-testid="card.wrapper"][href]')),
  ];
  const unique = new Map<string, { url: string; text: string }>();
  const add = (rawUrl: string, text: string): void => {
    let url: URL;
    try { url = new URL(rawUrl); } catch { return; }
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return;
    if (!unique.has(url.href)) unique.set(url.href, { url: url.href, text: text.slice(0, 300) });
  };
  for (const link of links) {
    let url: URL;
    try { url = new URL(link.href); } catch { continue; }
    const text = (link.innerText || link.textContent || '').trim();
    if (/^@[A-Za-z0-9_]{1,15}$/.test(text)) continue;
    if (['x.com', 'twitter.com'].includes(url.hostname) &&
        (/^\/hashtag\//.test(url.pathname) || url.pathname === '/search') && /^[#$]\S+$/.test(text)) continue;
    add(url.href, text);
  }
  if (body) {
    const textNodes = document.createTreeWalker(body, NodeFilter.SHOW_TEXT);
    let node: Node | null;
    while ((node = textNodes.nextNode())) {
      if (node.parentElement?.closest('a')) continue;
      for (const match of (node.textContent || '').matchAll(/https?:\/\/[^\s<>"“”]+/g)) {
        const raw = match[0].replace(/[)\].,;:!?，。；：！？…]+$/u, '');
        add(raw, raw);
      }
    }
  }
  return Array.from(unique.values());
}
function visibleRects(article: Element): { x: number; y: number; width: number; height: number }[] {
  const images = Array.from(article.querySelectorAll<HTMLImageElement>('[data-testid="tweetPhoto"] img, img[src*="pbs.twimg.com/media"]'));
  return images.slice(0, 4).map(img => img.getBoundingClientRect()).filter(r => r.width > 20 && r.height > 20 && r.bottom > 0 && r.top < innerHeight)
    .map(r => ({ x: r.x, y: r.y, width: r.width, height: r.height }));
}
function promoted(article: Element): boolean {
  const adLabel = /^(?:ad|promoted|推广|广告)$/i;
  const contentSelector = '[data-testid="tweetText"], [data-testid="User-Name"], [data-testid="card.wrapper"]';
  return Array.from(article.querySelectorAll<HTMLElement>('*')).some(el => {
    if (el.closest(contentSelector)) return false;
    if (el.children.length === 0 && adLabel.test(el.textContent?.trim() || '')) return true;
    return adLabel.test(el.getAttribute('aria-label')?.trim() || '');
  });
}
async function extract(article: Element, source: 'for_you' | 'search', query?: string): Promise<any> {
  const link = canonical(article);
  if (!link) return null;
  (article as HTMLElement).scrollIntoView({ block: 'center', behavior: 'instant' });
  await sleep(350);
  if (promoted(article)) return null;
  await expand(article);
  if (promoted(article)) return null;
  const text = (article.querySelector<HTMLElement>('[data-testid="tweetText"]')?.innerText || '').trim();
  const imageRects = visibleRects(article);
  let screenshot: string | undefined;
  if (imageRects.length) {
    try { screenshot = (await send('SCREENSHOT')).screenshot; } catch { /* OCR evidence unavailable */ }
  }
  return {
    postId: link.id, url: link.url, author: author(article), text, source, query,
    links: postLinks(article), mentions: postMentions(article),
    imageRects, viewportWidth: innerWidth, viewportHeight: innerHeight,
    hasVideo: !!article.querySelector('video,[data-testid="videoPlayer"]'),
    promoted: promoted(article), screenshot,
  };
}
async function record(postId: string, sessionId: string, observationSeq: number, action: string, success: boolean): Promise<void> {
  try { await send('ACTION', { result: { postId, sessionId, observationSeq, action, success } }); } catch { /* next status will reveal service failure */ }
}
async function canContinue(sessionId: string): Promise<boolean> {
  try {
    const state = await send('STATUS');
    return state.session?.id === sessionId && state.session.status === 'active' && document.visibilityState === 'visible';
  } catch { return false; }
}
async function retrieveVisit(target: NonNullable<Plan['nextVisit']>, sessionId: string, postId: string, observationSeq: number): Promise<{ kind: 'link' | 'mention'; url: string; finalUrl: string; text: string; success: boolean }> {
  let finalUrl = target.url;
  let text = '';
  let success = false;
  try {
    const result = await send('RETRIEVE', { sessionId, postId, observationSeq });
    finalUrl = result.finalUrl || target.url;
    if (result.needsBrowser) {
      const visited = await send('VISIT_EVIDENCE', { url: finalUrl, duration: 2500, profile: target.kind === 'mention' });
      finalUrl = visited.url || finalUrl;
      text = visited.text || '';
      success = !!visited.visited;
    } else {
      text = result.text || '';
      success = !!result.success;
    }
  } catch { /* The next decision can use a failed-visit result. */ }
  return { kind: target.kind, url: target.url, finalUrl, text: String(text).slice(0, 12_000), success };
}
function dispatchMouseEvent(element: Element, type: string, x: number, y: number, relatedTarget: Element | null = null): void {
  const init = { bubbles: true, clientX: x, clientY: y, relatedTarget, view: window };
  element.dispatchEvent(new PointerEvent(type.replace('mouse', 'pointer'), { ...init, pointerId: 1, pointerType: 'mouse', isPrimary: true }));
  element.dispatchEvent(new MouseEvent(type, init));
}
async function moveMouseTo(target: HTMLElement): Promise<boolean> {
  target.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'instant' });
  await sleep(180);
  if (!target.isConnected) return false;
  const rect = target.getBoundingClientRect();
  const left = Math.max(0, rect.left);
  const right = Math.min(innerWidth, rect.right);
  const top = Math.max(0, rect.top);
  const bottom = Math.min(innerHeight, rect.bottom);
  if (right - left < 4 || bottom - top < 4) return false;

  const end = {
    x: left + (right - left) * (0.35 + Math.random() * 0.3),
    y: top + (bottom - top) * (0.35 + Math.random() * 0.3),
  };
  const start = mousePosition || {
    x: Math.max(0, Math.min(innerWidth - 1, end.x + (Math.random() - 0.5) * 240)),
    y: Math.max(0, Math.min(innerHeight - 1, end.y + (Math.random() - 0.5) * 180)),
  };
  const bend = (Math.random() - 0.5) * 50;
  const control = { x: (start.x + end.x) / 2 + bend, y: (start.y + end.y) / 2 - bend };
  const steps = 12 + Math.floor(Math.random() * 7);
  for (let step = 1; step <= steps; step++) {
    if (!target.isConnected) return false;
    const t = step / steps;
    const x = (1 - t) ** 2 * start.x + 2 * (1 - t) * t * control.x + t ** 2 * end.x;
    const y = (1 - t) ** 2 * start.y + 2 * (1 - t) * t * control.y + t ** 2 * end.y;
    const current = document.elementFromPoint(x, y);
    if (current) {
      if (hoveredElement !== current) {
        if (hoveredElement?.isConnected) dispatchMouseEvent(hoveredElement, 'mouseout', x, y, current);
        dispatchMouseEvent(current, 'mouseover', x, y, hoveredElement);
        hoveredElement = current;
      }
      dispatchMouseEvent(current, 'mousemove', x, y);
    }
    mousePosition = { x, y };
    await sleep(10 + Math.random() * 12);
  }
  await sleep(60 + Math.random() * 80);
  const hit = document.elementFromPoint(end.x, end.y);
  return target.isConnected && !!hit && (hit === target || target.contains(hit));
}
async function moveAndClick(target: HTMLElement): Promise<boolean> {
  if (!(await moveMouseTo(target))) return false;
  target.click();
  return true;
}
async function clickAction(postId: string, action: 'like' | 'bookmark'): Promise<boolean> {
  const article = articleFor(postId);
  if (!article || canonical(article)?.id !== postId) return false;
  const testId = action === 'like' ? 'like' : 'bookmark';
  const opposite = action === 'like' ? 'unlike' : 'removeBookmark';
  if (article.querySelector(`[data-testid="${opposite}"]`)) return false;
  const button = article.querySelector<HTMLElement>(`button[data-testid="${testId}"]`);
  if (button) {
    if (!(await moveAndClick(button))) return false;
    await sleep(650);
    const current = articleFor(postId);
    return action === 'like'
      ? !!current?.querySelector('[data-testid="unlike"],button[aria-label="Unlike"]')
      : !!current?.querySelector('[data-testid="removeBookmark"],button[data-testid="unbookmark"],button[aria-label*="Remove Bookmark"]');
  }
  if (action !== 'bookmark') return false;
  const caret = article.querySelector<HTMLElement>('button[data-testid="caret"]');
  if (!caret) return false;
  if (!(await moveAndClick(caret))) return false;
  await sleep(300);
  const menuItems = Array.from(document.querySelectorAll<HTMLElement>('[role="menuitem"]'));
  const add = menuItems.find(item => /^(bookmark|add to bookmarks|添加书签|加入书签)$/i.test(item.innerText.trim()));
  if (!add || canonical(articleFor(postId) || article)?.id !== postId) { document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true})); return false; }
  if (!(await moveAndClick(add))) { document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true})); return false; }
  await sleep(650);
  const current = articleFor(postId);
  const newCaret = current?.querySelector<HTMLElement>('button[data-testid="caret"]');
  if (!newCaret) return false;
  if (!(await moveAndClick(newCaret))) return false;
  await sleep(300);
  const remove = Array.from(document.querySelectorAll<HTMLElement>('[role="menuitem"]')).some(item => /^(remove bookmark|remove from bookmarks|移除书签|从书签移除)$/i.test(item.innerText.trim()));
  document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));
  return remove;
}
async function act(post: any, plan: Plan, sessionId: string, observationSeq: number): Promise<void> {
  if (plan.phase === 'stopped') return;
  for (let remaining = plan.dwellMs; remaining > 0;) {
    const interval = Math.min(1000, remaining);
    await sleep(interval);
    remaining -= interval;
    if (!document.hasFocus() || document.visibilityState !== 'visible') return;
  }
  if (!(await canContinue(sessionId))) return;
  if (plan.openPost) {
    let success = false;
    try { success = (await send('VISIT', { url: post.url, duration: 3500, profile: false })).visited; } catch { /* skip */ }
    await record(post.postId, sessionId, observationSeq, 'open_post', success);
    await sleep(300);
  }
  if (!(await canContinue(sessionId))) return;
  if (plan.visitAuthor) {
    const url = authorUrl(post.author);
    let success = false;
    try { if (url) success = (await send('VISIT', { url, duration: 2500, profile: true })).visited; } catch { /* skip */ }
    await record(post.postId, sessionId, observationSeq, 'author_visit', success);
    await sleep(300);
  }
  if (!(await canContinue(sessionId))) return;
  if (plan.like) { await record(post.postId, sessionId, observationSeq, 'like', await clickAction(post.postId, 'like')); await sleep(900); }
  if (!(await canContinue(sessionId))) return;
  if (plan.bookmark) { await record(post.postId, sessionId, observationSeq, 'bookmark', await clickAction(post.postId, 'bookmark')); await sleep(900); }
}
function desiredUrl(phase: Phase, query?: string): string {
  return phase === 'search' ? `https://x.com/search?q=${encodeURIComponent(query || '')}&src=typed_query&f=live` : 'https://x.com/home';
}
function onCorrectPage(phase: Phase, query?: string): boolean {
  if (phase === 'search') return location.pathname.startsWith('/search') && new URLSearchParams(location.search).get('q') === query;
  return location.pathname === '/home';
}
async function ensureForYou(): Promise<void> {
  const tab = Array.from(document.querySelectorAll<HTMLElement>('[role="tab"]')).find(el => /^(for you|为你推荐)$/i.test(el.innerText.trim()));
  if (tab && tab.getAttribute('aria-selected') !== 'true') { tab.click(); await sleep(850); }
}
function visibleNewPostsButton(): HTMLElement | null {
  const label = /^(?:show\s+\d+\s+posts?|show\s+new\s+posts|显示\s*\d+\s*条\s*(?:新\s*)?帖子|显示\s*新帖子)$/i;
  const newPostsNotice = /new\s+posts\s+are\s+available|有新(?:的)?帖子(?:可用|可查看)|有新内容可用/i;
  const candidates = Array.from(document.querySelectorAll<HTMLElement>('button,[role="button"]'));
  return candidates.find(el => {
    const visibleText = el.innerText.trim();
    const accessibleLabel = [el.getAttribute('aria-label'), el.getAttribute('title')].filter(Boolean).join(' ');
    if (!label.test(visibleText) && !newPostsNotice.test(accessibleLabel) && !newPostsNotice.test(visibleText)) return false;
    const rect = el.getBoundingClientRect();
    const style = getComputedStyle(el);
    return rect.width > 0 && rect.height > 0 && rect.bottom > 0 && rect.top < innerHeight &&
      style.visibility !== 'hidden' && style.display !== 'none' && !el.hasAttribute('disabled') &&
      el.getAttribute('aria-disabled') !== 'true';
  }) || null;
}
async function refreshTimelineIfAvailable(): Promise<boolean> {
  const button = visibleNewPostsButton();
  if (!button) return false;
  button.click();
  await sleep(1200);
  return true;
}
async function loop(): Promise<void> {
  if (running) return;
  running = true;
  let reportedForeground: boolean | null = null;
  let noNew = 0;
  let emptySince = Date.now();
  try {
    while (true) {
      const state = await send('STATUS');
      const s = state.session;
      if (!s || s.status !== 'active') break;
      const foreground = document.hasFocus() && document.visibilityState === 'visible';
      if (reportedForeground !== foreground) {
        try { await send('FOREGROUND', { sessionId: s.id, foreground }); reportedForeground = foreground; }
        catch { await sleep(1200); continue; }
        if (foreground) { noNew = 0; emptySince = Date.now(); }
      }
      if (!foreground) { await sleep(1200); continue; }
      if (!onCorrectPage(s.phase, state.query)) { location.assign(desiredUrl(s.phase, state.query)); break; }
      if (s.phase !== 'search') await ensureForYou();
      const article = Array.from(document.querySelectorAll('article[data-testid="tweet"]')).find(a => {
        const link = canonical(a); return link && !seen.has(`${s.phase}:${link.id}`);
      });
      if (!article) {
        if (s.phase !== 'search' && await refreshTimelineIfAvailable()) {
          noNew = 0;
          emptySince = Date.now();
          continue;
        }
        window.scrollBy(0, Math.round(innerHeight * 0.72));
        await sleep(1200);
        if (++noNew >= 3 && Date.now() - emptySince >= 20_000) { await send('PAUSE', { reason: 'no_new_posts' }); break; }
        continue;
      }
      noNew = 0;
      emptySince = Date.now();
      const articleLink = canonical(article);
      if (articleLink && promoted(article)) {
        seen.add(`${s.phase}:${articleLink.id}`);
        continue;
      }
      const post = await extract(article, s.phase === 'search' ? 'search' : 'for_you', state.query);
      if (!post) {
        if (articleLink && promoted(article)) seen.add(`${s.phase}:${articleLink.id}`);
        else noNew++;
        continue;
      }
      seen.add(`${s.phase}:${post.postId}`);
      let response: any;
      try { response = await send('OBSERVE', { post }); }
      catch { seen.delete(`${s.phase}:${post.postId}`); await sleep(1500); continue; }
      let visitRounds = 0;
      while (response.plan.nextVisit && visitRounds++ < 20) {
        if (!(await canContinue(s.id))) break;
        const evidence = await retrieveVisit(response.plan.nextVisit, s.id, post.postId, response.observationSeq);
        if (!(await canContinue(s.id))) break;
        try {
          response = await send('CONTINUE', { result: { sessionId: s.id, postId: post.postId, observationSeq: response.observationSeq, evidence } });
        } catch { break; }
      }
      if (response.plan.nextVisit) continue;
      await act(post, response.plan, s.id, response.observationSeq);
      if (response.plan.phase === 'stopped') break;
    }
  } catch (error) {
    console.error('X Feed Pilot stopped', error);
  } finally { running = false; }
}

if (/^\/(home|search)/.test(location.pathname)) setTimeout(() => { loop(); }, 1400);
chrome.runtime.onMessage.addListener((message: any) => { if (message.type === 'START') loop(); });
void refreshIndicator();
setInterval(() => { void refreshIndicator(); }, 2000);
