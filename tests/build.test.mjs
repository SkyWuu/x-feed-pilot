import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

test('Chrome extension scripts contain no ESM syntax', () => {
  for (const name of ['background','content','popup']) {
    const source = readFileSync(new URL(`../dist/extension/${name}.js`,import.meta.url),'utf8');
    assert.doesNotMatch(source,/^\s*(import|export)\s/m);
  }
});
