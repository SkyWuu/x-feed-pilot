import test from 'node:test';
import assert from 'node:assert/strict';
import { prepareMedia, validPostMedia, validImageUrl } from '../dist/server/media.js';
import { post, png, screenshot } from './helpers/fixtures.mjs';
const url='https://pbs.twimg.com/media/test.png?name=orig';
const rect={x:0,y:50,width:100,height:50};
const imagePost={...post,images:[{url,rect}],imageRects:[rect],screenshot};
const dimensions=dataUrl=>{const data=Buffer.from(dataUrl.split(',')[1],'base64');return [data.readUInt32BE(16),data.readUInt32BE(20)];};

test('full attachments include offscreen images, maintain order and use no credentials or redirects',async()=>{
  const calls=[];const media=await prepareMedia({...post,images:[{url},{url:url.replace('test','second')}]},async(u,o)=>{calls.push([u,o]);return new Response(png(),{headers:{'content-type':'image/png'}});});
  assert.equal(media.complete,true);assert.deepEqual(media.images.map(i=>[i.index,i.source]),[[0,'original'],[1,'original']]);
  assert.equal(calls.length,2);assert.equal(calls[0][1].redirect,'error');assert.equal(calls[0][1].credentials,'omit');assert.ok(calls[0][1].signal);
});
for(const failure of ['network','http','mime','large','stream_large','empty']) test('download '+failure+' uses only the corresponding screenshot crop',async()=>{
  const media=await prepareMedia(imagePost,async()=>{
    if(failure==='network')throw new Error('offline');
    if(failure==='http')return new Response('',{status:404});
    if(failure==='mime')return new Response('html',{headers:{'content-type':'text/html'}});
    if(failure==='large')return new Response(png(),{headers:{'content-type':'image/png','content-length':'6000000'}});
    if(failure==='stream_large')return new Response(Buffer.alloc(6*1024*1024),{headers:{'content-type':'image/png'}});
    return new Response(Buffer.alloc(0),{headers:{'content-type':'image/png'}});
  });
  assert.equal(media.complete,true);assert.equal(media.images[0].source,'screenshot');assert.deepEqual(dimensions(media.images[0].dataUrl),[100,50]);
});
test('crop accounts for retina scaling and partially visible boundaries',async()=>{
  const media=await prepareMedia({...imagePost,viewportWidth:50,viewportHeight:50,images:[{url,rect:{x:-10,y:25,width:40,height:40}}]},async()=>{throw new Error('offline');});
  assert.deepEqual(dimensions(media.images[0].dataUrl),[60,50]);
});
test('unavailable or entirely offscreen images remain insufficient; explicit empty list wins over legacy rectangles',async()=>{
  for(const missing of [{...imagePost,screenshot:undefined},{...imagePost,screenshot:'data:image/png;base64,YmFk'},{...imagePost,images:[{url,rect:{x:0,y:200,width:50,height:50}}]}]) {
    const media=await prepareMedia(missing,async()=>{throw new Error('offline');});assert.equal(media.complete,false);assert.equal(media.images.length,0);
  }
  assert.equal((await prepareMedia({...imagePost,images:[]},async()=>{throw new Error('must not fetch');})).hasImages,false);
});
test('validates media URLs, count and rectangles before fetching',()=>{
  assert.equal(validPostMedia(imagePost),true);
  for(const invalid of ['http://pbs.twimg.com/media/a','https://pbs.twimg.com.evil.test/media/a','https://pbs.twimg.com/profile_images/a','https://user:pass@pbs.twimg.com/media/a','https://127.0.0.1/media/a','https://pbs.twimg.com:444/media/a'])assert.equal(validImageUrl(invalid),false);
  assert.equal(validPostMedia({...imagePost,images:Array(5).fill({url})}),false);
  assert.equal(validPostMedia({...imagePost,images:[{url,rect:{...rect,width:NaN}}]}),false);
});
