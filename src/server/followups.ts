import type { FollowUpEvidence, FollowUpTarget, ObservedPost } from '../shared/types.js';

export const MAX_VISITS_PER_POST = 4;
export const MAX_EVIDENCE_TEXT = 12_000;
const MAX_CANDIDATES = 254; // Choice supports 255 options, including "finish".

export interface FollowUpCandidate extends FollowUpTarget {
  label: string;
}

export function normalizedWebUrl(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > 2048) return null;
  try {
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return null;
    if (isXPage(url.href)) url.protocol = 'https:';
    url.hash = '';
    return url.href;
  } catch { return null; }
}

export function isXPage(value: string): boolean {
  try { return ['x.com', 'www.x.com', 'twitter.com', 'www.twitter.com'].includes(new URL(value).hostname.toLowerCase()); }
  catch { return false; }
}

export function candidatesFor(post: ObservedPost, history: FollowUpEvidence[] = []): FollowUpCandidate[] {
  const seen = new Set(history.map(item => `${item.kind}:${item.url}`));
  const result: FollowUpCandidate[] = [];
  for (const link of post.links || []) {
    const url = normalizedWebUrl(link?.url);
    if (!url || seen.has(`link:${url}`)) continue;
    seen.add(`link:${url}`);
    result.push({ kind: 'link', url, label: `${String(link.text || '').slice(0, 160)} (${url})` });
  }
  // OCR and plain post text may expose a URL without a DOM anchor.
  for (const match of `${post.text} ${post.ocrText || ''}`.matchAll(/https?:\/\/[^\s<>"'“”]+/gi)) {
    const url = normalizedWebUrl(match[0].replace(/[)\].,;:!?，。；：！？…]+$/u, ''));
    if (!url || seen.has(`link:${url}`)) continue;
    seen.add(`link:${url}`);
    result.push({ kind: 'link', url, label: url });
  }
  for (const mention of post.mentions || []) {
    const handle = typeof mention?.handle === 'string' ? mention.handle.replace(/^@/, '') : '';
    if (!/^[A-Za-z0-9_]{1,15}$/.test(handle)) continue;
    const url = `https://x.com/${handle}`;
    if (seen.has(`mention:${url}`)) continue;
    seen.add(`mention:${url}`);
    result.push({ kind: 'mention', url, label: `@${handle} profile` });
  }
  return result.slice(0, MAX_CANDIDATES);
}
