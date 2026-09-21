import puppeteer from 'puppeteer-core';
const CHROME='/opt/data/cache/chrome/chrome-headless-shell-linux64/chrome-headless-shell';
const b=await puppeteer.launch({executablePath:CHROME,headless:true,args:['--no-sandbox','--use-gl=swiftshader','--enable-unsafe-swiftshader']});
const p=await b.newPage();
await p.setViewport({width:1440,height:1000});
await p.goto('http://172.18.0.1:5173/v/gkuro-monochrome',{waitUntil:'load',timeout:60000});
await new Promise(r=>setTimeout(r,4000));
const out=await p.evaluate(async()=>{
  const mod=await import('/src/features/card3d/cardTexture.ts');
  const api=await fetch('/api/vtubers/gkuro-monochrome').then(r=>r.json());
  const load=(s)=>new Promise(res=>{const i=new Image();i.crossOrigin='anonymous';i.onload=()=>res(i);i.onerror=()=>res(null);i.src=s;});
  const art=await load(api.images.character);
  const front=mod.drawCardFront({card:api,art,logo:await load(api.images.logo)});
  const mask=mod.inkAndSkinMask(front,front.width,front.height);
  const ctx=mask.getContext('2d');
  const d=ctx.getImageData(0,0,mask.width,mask.height).data;
  let n=0,sum=0,max=0,blancos=0;
  for(let i=0;i<d.length;i+=4){ const a=d[i+3]; if(a<8) continue; const v=d[i]; n++; sum+=v; if(v>max)max=v; if(v>200)blancos++; }
  return {n,media:(sum/Math.max(1,n)).toFixed(1),max,blancos,pctBlanco:(blancos/Math.max(1,n)*100).toFixed(2),url:mask.toDataURL('image/png')};
});
const fs=await import('node:fs');
if(out.url) fs.writeFileSync('/tmp/mask-real.png',Buffer.from(out.url.split(',')[1],'base64'));
console.log(JSON.stringify({n:out.n,media:out.media,max:out.max,pctBlanco:out.pctBlanco}));
await b.close();
