import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('Apple Vision extracts only the target crop from a screenshot', t => {
  if (spawnSync('python3',['-c','import PIL']).status !== 0) return t.skip('Pillow unavailable for image fixture');
  const dir = mkdtempSync(join(tmpdir(),'feed-ocr-test-'));
  try {
    const image = join(dir,'text.png');
    execFileSync('python3',['-c',`from PIL import Image, ImageDraw, ImageFont
im=Image.new('RGB',(900,400),'white')
d=ImageDraw.Draw(im)
f=ImageFont.truetype('/System/Library/Fonts/Supplemental/Arial Bold.ttf',78)
d.text((25,35),'IGNORE',font=f,fill='black')
d.text((25,240),'SLM BENCHMARK',font=f,fill='black')
im.save('${image}')`]);
    const result = spawnSync(new URL('../dist/ocr',import.meta.url).pathname,[image,JSON.stringify([{x:0,y:200,width:900,height:200}]),'900','400']);
    if (result.status === 3 && result.stderr.toString().includes('Vision unavailable')) return t.skip('Apple Vision unavailable in sandbox');
    assert.equal(result.status,0,result.stderr.toString());
    const text = JSON.parse(result.stdout.toString()).map(x=>x.text).join(' ');
    assert.match(text,/SLM BENCHMARK/i);
    assert.doesNotMatch(text,/IGNORE/i);
  } finally { rmSync(dir,{recursive:true,force:true}); }
});
