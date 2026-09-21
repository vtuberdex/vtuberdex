/**
 * Mide el TINTE del efecto holográfico: compara la textura base (sin efectos) con
 * la misma zona del render 3D, y calcula el desplazamiento de color por canal.
 */
import puppeteer from 'puppeteer-core';
const CHROME='/opt/data/cache/chrome/chrome-headless-shell-linux64/chrome-headless-shell';
const b=await puppeteer.launch({executablePath:CHROME,headless:true,args:['--no-sandbox','--use-gl=swiftshader','--enable-unsafe-swiftshader']});
const p=await b.newPage();
await p.setViewport({width:1440,height:1000});
await p.goto('http://172.18.0.1:5173/v/gkuro-monochrome',{waitUntil:'load',timeout:60000});
await new Promise(r=>setTimeout(r,5000));
const out=await p.evaluate(async()=>{
  const mod=await import('/src/features/card3d/cardTexture.ts');
  const api=await fetch('/api/vtubers/gkuro-monochrome').then(r=>r.json());
  const load=(s)=>new Promise(res=>{const i=new Image();i.crossOrigin='anonymous';i.onload=()=>res(i);i.onerror=()=>res(null);i.src=s;});
  const art=await load(api.images.character);
  const front=mod.drawCardFront({card:api,art,logo:await load(api.images.logo)});
  // Zona central (donde esta el personaje), promediando el color de la textura base.
  const ctx=front.getContext('2d');
  const d=ctx.getImageData(Math.round(front.width*0.25), Math.round(front.height*0.30), 200, 200).data;
  let r=0,g=0,bl=0,n=0;
  for(let i=0;i<d.length;i+=4){ r+=d[i]; g+=d[i+1]; bl+=d[i+2]; n++; }
  return {base:{r:Math.round(r/n),g:Math.round(g/n),b:Math.round(bl/n)}};
});
console.log('textura BASE (sin efectos):', JSON.stringify(out.base));
await b.close();
