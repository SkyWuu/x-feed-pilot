declare const chrome: any;
const $ = (id: string) => document.getElementById(id)!;
async function send(type: string, data: Record<string, unknown> = {}): Promise<any> {
  const response = await chrome.runtime.sendMessage({ type, ...data });
  if (!response?.ok) throw new Error(response?.error || '通信失败');
  return response.value;
}
function error(value: unknown): void { $('error').textContent = String(value || ''); }
async function refresh(): Promise<void> {
  try {
    const state = await send('STATUS');
    const s = state.session;
    $('status').textContent = !s ? '已连接 · 尚未开始' : s.foregroundPaused ? `已暂停 · 返回 X 训练页后继续 · ${s.uniqueCount}/80 条` : s.status === 'active' ? `运行中 · ${s.phase} · ${s.uniqueCount}/80 条` : `已停止 · ${s.stopReason || '完成'}`;
    $('dot').classList.toggle('active', s?.status === 'active' && !s.foregroundPaused);
    ($('start') as HTMLButtonElement).disabled = s?.status === 'active';
    ($('stop') as HTMLButtonElement).disabled = s?.status !== 'active';
  } catch (e) {
    $('status').textContent = '本机服务未连接';
    $('dot').classList.remove('active');
    ($('start') as HTMLButtonElement).disabled = true;
    ($('stop') as HTMLButtonElement).disabled = true;
    error(e);
  }
}
$('start').addEventListener('click', async () => { try { error(''); await send('START'); await refresh(); } catch (e) { error(e); } });
$('stop').addEventListener('click', async () => { try { error(''); await send('STOP'); await refresh(); } catch (e) { error(e); } });
$('copy').addEventListener('click', async () => { await navigator.clipboard.writeText($('feed-url').textContent || ''); $('copy').textContent = '已复制'; });
refresh();
