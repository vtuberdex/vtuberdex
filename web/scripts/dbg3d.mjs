import puppeteer from 'puppeteer-core';
const CHROME='/opt/data/cache/chrome/chrome-headless-shell-linux64/chrome-headless-shell';
const b=await puppeteer.launch({executablePath:CHROME,headless:true,args:['--no-sandbox','--use-gl=swiftshader','--enable-unsafe-swiftshader','--disable-gpu-sandbox']});
const p=await b.newPage();
await p.setViewport({width:1440,height:1000});
const logs=[];
p.on('console',m=>logs.push(m.type()+': '+m.text()));
p.on('pageerror',e=>logs.push('PAGEERROR: '+e.message));
await p.goto('http://172.18.0.1:4000/v/gkuro-monochrome',{waitUntil:'load',timeout:60000});
await new Promise(r=>setTimeout(r,7000));
// ¿hay canvas WebGL y qué tamaño tiene?
const info=await p.evaluate(()=>{
  const c=document.querySelector('canvas');
  if(!c) return {canvas:false};
  const gl=c.getContext('webgl2')||c.getContext('webgl');
  return {canvas:true,w:c.width,h:c.height,gl:!!gl,
    // leer un pixel central
    };
});
// capturar solo la zona de la carta
const el=await p.$('[data-testid="holo-card"]');
if(el) await el.screenshot({path:'/tmp/card3d-only.png'});
console.log('INFO:',JSON.stringify(info));
console.log('LOGS:',logs.filter(l=>!l.includes('Download the React')).slice(0,8).join(' | '));
await b.close();
