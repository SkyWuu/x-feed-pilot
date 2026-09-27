import { lookup } from 'node:dns/promises';
import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { isIP } from 'node:net';
import { isXPage, normalizedWebUrl } from './followups.js';

export interface RetrievedPage {
  finalUrl: string;
  text: string;
  success: boolean;
  needsBrowser?: boolean;
}

function publicIpv4(address: string): boolean {
  if (isIP(address) !== 4) return false;
  const [a, b, c] = address.split('.').map(Number);
  return !(a === 0 || a === 10 || a === 127 || a >= 224 ||
    (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) || (a === 192 && (b === 0 || b === 168)) ||
    (a === 198 && (b === 18 || b === 19)) ||
    (a === 192 && b === 0 && c === 2) || (a === 198 && b === 51 && c === 100) ||
    (a === 203 && b === 0 && c === 113));
}

async function pinnedAddress(url: URL): Promise<string> {
  const host = url.hostname.toLowerCase();
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal')) throw new Error('Private destination');
  if (isIP(host)) {
    if (!publicIpv4(host)) throw new Error('Private destination');
    return host;
  }
  const addresses = await lookup(host, { all: true, family: 4 });
  const address = addresses.find(entry => publicIpv4(entry.address))?.address;
  if (!address) throw new Error('No public IPv4 address');
  return address;
}

function htmlText(raw: string): string {
  return raw.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript\b[^>]*>[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&(?:amp|lt|gt|quot|apos|nbsp);|&#(?:\d+|x[\da-f]+);/gi, entity => {
      const named: Record<string, string> = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&apos;': "'", '&nbsp;': ' ' };
      if (named[entity.toLowerCase()]) return named[entity.toLowerCase()];
      const n = entity[2].toLowerCase() === 'x' ? parseInt(entity.slice(3, -1), 16) : parseInt(entity.slice(2, -1), 10);
      return Number.isFinite(n) && n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : ' ';
    })
    .replace(/\s+/g, ' ').trim().slice(0, 12_000);
}

async function requestPage(url: URL, deadline: number): Promise<{ status: number; location?: string; type: string; body: string }> {
  const address = await pinnedAddress(url);
  const left = deadline - Date.now();
  if (left <= 0) throw new Error('Retrieval timeout');
  return await new Promise((resolve, reject) => {
    const request = (url.protocol === 'https:' ? httpsRequest : httpRequest)(url, {
      method: 'GET',
      lookup: (...args: any[]) => args.at(-1)(null, address, 4),
      headers: { 'user-agent': 'X-Feed-Pilot/0.1', accept: 'text/html,text/plain;q=0.9', 'accept-encoding': 'identity' },
      timeout: Math.min(left, 10_000),
    }, response => {
      const chunks: Buffer[] = [];
      let size = 0;
      response.on('data', (chunk: Buffer) => {
        size += chunk.length;
        if (size > 256_000) { request.destroy(new Error('Page too large')); return; }
        chunks.push(chunk);
      });
      response.on('end', () => resolve({
        status: response.statusCode || 0,
        location: typeof response.headers.location === 'string' ? response.headers.location : undefined,
        type: String(response.headers['content-type'] || '').toLowerCase(),
        body: Buffer.concat(chunks).toString('utf8'),
      }));
    });
    request.on('timeout', () => request.destroy(new Error('Retrieval timeout')));
    request.on('error', reject);
    request.end();
  });
}

export async function retrievePage(value: string): Promise<RetrievedPage> {
  const normalized = normalizedWebUrl(value);
  if (!normalized) return { finalUrl: value, text: 'Invalid destination URL', success: false };
  let current = new URL(normalized);
  const deadline = Date.now() + 20_000;
  try {
    for (let redirect = 0; redirect <= 5; redirect++) {
      if (isXPage(current.href)) {
        current.protocol = 'https:';
        return { finalUrl: current.href, text: '', success: true, needsBrowser: true };
      }
      const page = await requestPage(current, deadline);
      if (page.status >= 300 && page.status < 400 && page.location) {
        const target = normalizedWebUrl(new URL(page.location, current).href);
        if (!target) throw new Error('Invalid redirect');
        current = new URL(target);
        continue;
      }
      if (page.status < 200 || page.status >= 300) throw new Error(`HTTP ${page.status}`);
      if (!/^(text\/html|text\/plain|application\/xhtml\+xml)\b/.test(page.type)) throw new Error('Unsupported page content type');
      return { finalUrl: current.href, text: htmlText(page.body), success: true };
    }
    throw new Error('Too many redirects');
  } catch (error) {
    return { finalUrl: current.href, text: String(error).slice(0, 240), success: false };
  }
}
