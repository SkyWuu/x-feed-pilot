import { execFile } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ImageRect, ObservedPost } from '../shared/types.js';

const IMAGE_BIN = fileURLToPath(new URL('../ocr', import.meta.url));
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
export interface PreparedImage { index: number; dataUrl: string; source: 'original' | 'screenshot'; }
export interface PreparedMedia {
  hasImages: boolean;
  complete: boolean;
  images: PreparedImage[];
}

export function validImageUrl(value: unknown): value is string {
  if (typeof value !== 'string' || value.length > 2048) return false;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && url.hostname === 'pbs.twimg.com' && !url.port &&
      !url.username && !url.password && /^\/media\/[^/]+$/.test(url.pathname);
  } catch { return false; }
}

function validRect(value: unknown): value is ImageRect {
  if (!value || typeof value !== 'object') return false;
  const r = value as ImageRect;
  return [r.x, r.y, r.width, r.height].every(Number.isFinite) && r.width > 0 && r.height > 0;
}

export function validPostMedia(post: ObservedPost): boolean {
  return Array.isArray(post.imageRects) && post.imageRects.length <= 4 && post.imageRects.every(validRect) &&
    Number.isFinite(post.viewportWidth) && post.viewportWidth > 0 && Number.isFinite(post.viewportHeight) && post.viewportHeight > 0 &&
    (post.screenshot === undefined || (typeof post.screenshot === 'string' && /^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/.test(post.screenshot))) &&
    (post.images === undefined || (Array.isArray(post.images) && post.images.length <= 4 &&
      post.images.every(image => image && validImageUrl(image.url) && (image.rect === undefined || validRect(image.rect)))));
}

function runImage(args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(IMAGE_BIN, args, { timeout: 10_000, maxBuffer: 32 * 1024 * 1024 }, (error, stdout) => {
      if (error) reject(new Error('Image processing unavailable'));
      else resolve(stdout);
    });
  });
}

async function withImage<T>(dataUrl: string, action: (path: string) => Promise<T>): Promise<T> {
  const folder = await mkdtemp(join(tmpdir(), 'x-feed-image-'));
  try {
    const path = join(folder, 'image');
    await writeFile(path, Buffer.from(dataUrl.slice(dataUrl.indexOf(',') + 1), 'base64'));
    return await action(path);
  } finally { await rm(folder, { recursive: true, force: true }); }
}

async function downloadImage(url: string, signal: AbortSignal, fetcher: typeof fetch): Promise<string> {
  if (!validImageUrl(url)) throw new Error('Invalid image URL');
  const response = await fetcher(url, { signal, redirect: 'error', credentials: 'omit' });
  const mime = response.headers.get('content-type')?.split(';')[0].trim().toLowerCase();
  if (!response.ok || !mime || !['image/jpeg', 'image/png', 'image/webp'].includes(mime) ||
      Number(response.headers.get('content-length')) > MAX_IMAGE_BYTES || !response.body) {
    await response.body?.cancel();
    throw new Error('Image download unavailable');
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > MAX_IMAGE_BYTES) throw new Error('Image too large');
      chunks.push(value);
    }
  } finally { await reader.cancel(); }
  if (!size) throw new Error('Empty image');
  return 'data:' + mime + ';base64,' + Buffer.concat(chunks).toString('base64');
}

export async function prepareMedia(post: ObservedPost, fetcher: typeof fetch = fetch): Promise<PreparedMedia> {
  // Old extensions supply only rectangles. An explicit images array is authoritative.
  const attachments = post.images ?? post.imageRects.map(rect => ({ url: '', rect }));
  const result: PreparedMedia = { hasImages: attachments.length > 0, complete: true, images: [] };
  if (!attachments.length) return result;
  const signal = AbortSignal.timeout(10_000);
  const downloaded = await Promise.allSettled(attachments.map(image => downloadImage(image.url, signal, fetcher)));
  const missing: number[] = [];
  downloaded.forEach((item, index) => {
    if (item.status === 'fulfilled') result.images.push({ index, dataUrl: item.value, source: 'original' });
    else missing.push(index);
  });
  const cropIndices = missing.filter(index => validRect(attachments[index].rect));
  if (post.screenshot && cropIndices.length) {
    try {
      const crops = await withImage(post.screenshot, async path => JSON.parse(await runImage([
        path, JSON.stringify(cropIndices.map(index => attachments[index].rect)),
        String(post.viewportWidth), String(post.viewportHeight), '--crop',
      ])) as { index: number; dataUrl: string }[]);
      for (const crop of crops) {
        if (Number.isInteger(crop.index) && crop.index >= 0 && crop.index < cropIndices.length &&
            /^data:image\/png;base64,/.test(crop.dataUrl)) {
          result.images.push({ index: cropIndices[crop.index], dataUrl: crop.dataUrl, source: 'screenshot' });
        }
      }
    } catch { /* Missing visual evidence is handled without stopping the session. */ }
  }
  result.images.sort((a, b) => a.index - b.index);
  result.complete = result.images.length === attachments.length;
  return result;
}
