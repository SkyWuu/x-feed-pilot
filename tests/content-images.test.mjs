import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
const compiled=readFileSync(new URL('../dist/extension/content.js',import.meta.url),'utf8');
const startup=compiled.indexOf('if (/^\\/(home|search)/.test(location.pathname))');
function imagesFor(definitions) {
  const article={querySelectorAll:()=>definitions.map(d=>({currentSrc:`https://pbs.twimg.com/media/${d.name}?format=jpg&name=small`,closest:selector=>selector==='article[data-testid="tweet"]'?(d.nested?{}:article):selector.includes('card.wrapper')?(d.card||d.video?{}:null):{href:`https://x.com/a/status/${d.owner||'12345'}/photo/1`},getBoundingClientRect:()=>({x:0,y:d.offscreen?1500:0,top:d.offscreen?1500:0,bottom:d.offscreen?1600:100,width:100,height:100,left:0,right:100})}))};
  return JSON.parse(JSON.stringify(runInNewContext(compiled.slice(0,startup)+'\npostImages(article,"12345")',{article,URL,innerWidth:1000,innerHeight:800})));
}
test('only main Tweet attachments are collected, including offscreen images and excluding quoted media',()=>{
  const result=imagesFor([{name:'own'},{name:'own'},{name:'quoted',owner:'99999'},{name:'card',card:true},{name:'video',video:true},{name:'nested',nested:true},{name:'offscreen',offscreen:true}]);
  assert.equal(result.length,2);assert.match(result[0].url,/own.*name=orig/);assert.equal(result[1].rect,undefined);assert.match(result[1].url,/offscreen/);
  assert.equal(imagesFor([{name:'quoted',owner:'99999'}]).length,0);
  assert.equal(imagesFor(Array.from({length:6},(_,i)=>({name:'photo'+i}))).length,4);
});
