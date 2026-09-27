declare const chrome: any;
const API = 'http://127.0.0.1:47831';

async function storage(): Promise<{ trainingTabId?: number }> {
  return await chrome.storage.local.get(['trainingTabId']);
}
async function request(path: string, method = 'GET', value?: unknown): Promise<any> {
  const response = await fetch(`${API}${path}`, {
    method,
    credentials: 'omit',
    headers: { 'content-type': 'application/json', 'x-x-feed-pilot-extension-id': chrome.runtime.id },
    body: value === undefined ? undefined : JSON.stringify(value),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
  return data;
}
async function waitForLoad(tabId: number): Promise<void> {
  const current = await chrome.tabs.get(tabId);
  if (current.status === 'complete') return;
  await new Promise<void>(resolve => {
    const timer = setTimeout(() => { chrome.tabs.onUpdated.removeListener(listener); resolve(); }, 12_000);
    const listener = (id: number, info: any) => {
      if (id === tabId && info.status === 'complete') {
        clearTimeout(timer); chrome.tabs.onUpdated.removeListener(listener); resolve();
      }
    };
    chrome.tabs.onUpdated.addListener(listener);
  });
}
async function visit(url: string, duration: number, profile: boolean): Promise<boolean> {
  if (!/^https:\/\/(x\.com|twitter\.com)\//.test(url)) return false;
  const { trainingTabId } = await storage();
  if (!trainingTabId) return false;
  const main = await chrome.tabs.get(trainingTabId);
  const child = await chrome.tabs.create({ windowId: main.windowId, url, active: true });
  try {
    await waitForLoad(child.id);
    if (profile) {
      await chrome.scripting.executeScript({ target: { tabId: child.id }, func: async () => {
        for (let i = 0; i < 3; i++) { window.scrollBy(0, 480); await new Promise(r => setTimeout(r, 1500)); }
      }});
    }
    await new Promise(r => setTimeout(r, Math.min(20_000, Math.max(2500, duration))));
    return true;
  } finally {
    try { await chrome.tabs.remove(child.id); } catch { /* already closed */ }
    try { await chrome.tabs.update(trainingTabId, { active: true }); } catch { /* main closed */ }
  }
}
async function visitEvidence(url: string, duration: number, profile: boolean): Promise<{ visited: boolean; url: string; text: string }> {
  if (!/^https:\/\/(?:www\.)?(?:x\.com|twitter\.com)\//i.test(url)) return { visited: false, url, text: '' };
  const { trainingTabId } = await storage();
  if (!trainingTabId) return { visited: false, url, text: '' };
  const main = await chrome.tabs.get(trainingTabId);
  const child = await chrome.tabs.create({ windowId: main.windowId, url, active: true });
  try {
    await waitForLoad(child.id);
    await new Promise(r => setTimeout(r, 1200));
    const current = await chrome.tabs.get(child.id);
    if (!/^https:\/\/(?:www\.)?(?:x\.com|twitter\.com)\//i.test(current.url || '')) {
      return { visited: false, url: current.url || url, text: '' };
    }
    const results = await chrome.scripting.executeScript({ target: { tabId: child.id }, func: async (scroll: boolean) => {
      if (scroll) {
        for (let i = 0; i < 3; i++) {
          window.scrollBy(0, 480);
          await new Promise(r => setTimeout(r, 750));
        }
      }
      const main = document.querySelector('[data-testid="primaryColumn"],main,[role="main"]') || document.body;
      return (main as HTMLElement).innerText.slice(0, 12_000);
    }, args: [profile] });
    await new Promise(r => setTimeout(r, Math.min(12_000, Math.max(1000, duration))));
    return { visited: true, url: current.url || url, text: String(results?.[0]?.result || '').slice(0, 12_000) };
  } catch {
    return { visited: false, url, text: '' };
  } finally {
    try { await chrome.tabs.remove(child.id); } catch { /* already closed */ }
    try { await chrome.tabs.update(trainingTabId, { active: true }); } catch { /* main closed */ }
  }
}
chrome.runtime.onMessage.addListener((message: any, sender: any, sendResponse: (x: any) => void) => {
  (async () => {
    const state = await storage();
    if (message.type === 'START') {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab?.id || !/^https:\/\/(x\.com|twitter\.com)\//.test(tab.url || '')) throw new Error('请先打开并登录 X 标签页');
      const result = await request('/api/session/start', 'POST', {});
      try {
        await chrome.storage.local.set({ trainingTabId: tab.id });
        await chrome.tabs.update(tab.id, { url: 'https://x.com/home', active: true });
      } catch (error) {
        await chrome.storage.local.remove('trainingTabId');
        try { await request('/api/session/stop', 'POST', { reason: 'navigation_failed' }); } catch { /* original error is clearer */ }
        throw error;
      }
      return result;
    }
    if (message.type === 'STOP') {
      const result = await request('/api/session/stop', 'POST', { reason: 'manual' });
      await chrome.storage.local.remove('trainingTabId');
      return result;
    }
    if (message.type === 'STATUS') {
      if (sender.tab?.id && sender.tab.id !== state.trainingTabId) return { session: null };
      return await request('/api/session/status');
    }
    if (!sender.tab?.id || sender.tab.id !== state.trainingTabId) throw new Error('不是训练标签页');
    if (message.type === 'OBSERVE') return await request('/api/observe', 'POST', message.post);
    if (message.type === 'FOREGROUND') return await request('/api/session/foreground', 'POST', {
      sessionId: message.sessionId, foreground: message.foreground,
    });
    if (message.type === 'RETRIEVE') return await request('/api/observe/retrieve', 'POST', { sessionId: message.sessionId, postId: message.postId, observationSeq: message.observationSeq });
    if (message.type === 'CONTINUE') return await request('/api/observe/continue', 'POST', message.result);
    if (message.type === 'ACTION') return await request('/api/action', 'POST', message.result);
    if (message.type === 'PAUSE') return await request('/api/session/stop', 'POST', { reason: message.reason || 'paused' });
    if (message.type === 'SCREENSHOT') {
      const tab = await chrome.tabs.get(sender.tab.id);
      const windowInfo = await chrome.windows.get(tab.windowId);
      if (!tab.active || !windowInfo.focused) throw new Error('训练标签页不在前台');
      return { screenshot: await chrome.tabs.captureVisibleTab(tab.windowId, { format: 'png' }) };
    }
    if (message.type === 'VISIT') return { visited: await visit(message.url, message.duration, message.profile) };
    if (message.type === 'VISIT_EVIDENCE') return await visitEvidence(message.url, message.duration, message.profile);
    throw new Error('Unknown message');
  })().then(value => sendResponse({ ok: true, value })).catch(error => sendResponse({ ok: false, error: String(error) }));
  return true;
});
