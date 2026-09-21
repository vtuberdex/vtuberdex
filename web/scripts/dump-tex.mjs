// Vuelca la TEXTURA frontal real (drawCardFront) para medirla en píxeles.
import puppeteer from 'puppeteer-core';
const CHROME='/opt/data/cache/chrome/chrome-headless-shell-linux64/chrome-headless-shell';
const b=await puppeteer.launch({executablePath:CHROME,headless:true,args:['--no-sandbox','--use-gl=swiftshader','--enable-unsafe-swiftshader']});
const p=await b.newPage();
await p.setViewport({width:1440,height:1000});
const errs=[];p.on('pageerror',e=>errs.push(e.message));
await p.goto('http://172.18.0.1:5173/v/dra-yusei',{waitUntil:'load',timeout:60000});
await new Promise(r=>setTimeout(r,4000));
const out=await p.evaluate(async()=>{
  try{
    const mod=await import('/src/features/card3d/cardTexture.ts');
    const api=await fetch('/api/vtubers/dra-yusei').then(r=>r.json());
    const load=(src)=>new Promise(res=>{const i=new Image();i.crossOrigin='anonymous';i.onload=()=>res(i);i.onerror=()=>res(null);i.src=src;});
    const art=await load(api.images.character);
    const logo=await load(api.images.logo);
    const canvas=mod.drawCardFront({card:api,art,logo});
    return {ok:true,w:canvas.width,h:canvas.height,url:canvas.toDataURL('image/png'),artSize:art?art.width+'x'+art.height:'null'};
  }catch(e){return {ok:false,error:String(e)};}
});
if(out.ok){const fs=await import('node:fs');fs.writeFileSync('/tmp/texture-real.png',Buffer.from(out.url.split(',')[1],'base64'));}
console.log(JSON.stringify(out.ok?{w:out.w,h:out.h,artSize:out.artSize}:(out.error||errs[0])));
await b.close();
