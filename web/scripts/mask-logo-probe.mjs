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
  const logo=await load(api.images.logo);
  const front=mod.drawCardFront({card:api,art:await load(api.images.character),logo});
  const box=mod.getLastLogoBox();
  if(!box) return {box:null};
  const mask=mod.logoMask(logo,box,front.width,front.height);
  const d=mask.getContext('2d').getImageData(0,0,mask.width,mask.height).data;
  let cubiertos=0; for(let i=0;i<d.length;i+=4) if(d[i]>127) cubiertos++;
  return {box:{x:Math.round(box.x),y:Math.round(box.y),w:Math.round(box.w),h:Math.round(box.h)},
          cubiertos, total:mask.width*mask.height, pct:(cubiertos/(mask.width*mask.height)*100).toFixed(2),
          url:mask.toDataURL('image/png')};
});
const fs=await import('node:fs');
if(out.url) fs.writeFileSync('/tmp/mask-logo.png',Buffer.from(out.url.split(',')[1],'base64'));
console.log(JSON.stringify({box:out.box,pctCubierto:out.pct}));
await b.close();
