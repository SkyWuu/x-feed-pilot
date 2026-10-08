import { deflateSync } from 'node:zlib';

export const post = { postId:'123456789012345', url:'https://x.com/a/status/123456789012345', author:'a', text:'A useful small language model benchmark', source:'for_you', images:[], imageRects:[], viewportWidth:100, viewportHeight:100, hasVideo:false, promoted:false };
export const noMedia = { hasImages:false, complete:true, images:[] };
export const values = { interest:1, like:1, bookmark:1, exploreAuthor:1, excluded:0 };
export function answers(provider, choice, overrides = {}) {
  const scores = {...values,...overrides};
  if (provider === 'jev') return {answers:{...Object.fromEntries(Object.entries(scores).map(([name,noul])=>[name,{type:'noul',noul}])),...(choice ? {nextAction:{type:'choice',choice}} : {})}};
  return {answers:[...Object.entries(scores).map(([name,probability])=>({type:'predicate',name,probability})),...(choice ? [{type:'choice',name:'nextAction',choice}] : [])].reverse()};
}
function crc32(data) {
  let crc=0xffffffff;
  for (const byte of data) { crc^=byte; for(let j=0;j<8;j++) crc=(crc>>>1)^((crc&1)?0xedb88320:0); }
  return (crc^0xffffffff)>>>0;
}
function chunk(type,data) {
  const body=Buffer.concat([Buffer.from(type),data]);
  const size=Buffer.alloc(4);size.writeUInt32BE(data.length);
  const crc=Buffer.alloc(4);crc.writeUInt32BE(crc32(body));
  return Buffer.concat([size,body,crc]);
}
export function png(width=100,height=100) {
  const header=Buffer.alloc(13);header.writeUInt32BE(width);header.writeUInt32BE(height,4);header[8]=8;header[9]=2;
  const pixels=Buffer.alloc(height*(1+width*3));
  for(let y=0;y<height;y++) for(let x=0;x<width;x++) {
    const offset=y*(1+width*3)+1+x*3;
    pixels[offset]=y<height/2?255:0;pixels[offset+2]=y<height/2?0:255;
  }
  return Buffer.concat([Buffer.from('89504e470d0a1a0a','hex'),chunk('IHDR',header),chunk('IDAT',deflateSync(pixels)),chunk('IEND',Buffer.alloc(0))]);
}
export const screenshot='data:image/png;base64,'+png().toString('base64');
export const imageMedia={hasImages:true,complete:true,images:[{index:0,dataUrl:screenshot,source:'original'}]};
