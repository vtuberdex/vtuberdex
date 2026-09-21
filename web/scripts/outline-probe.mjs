/**
 * Mide la SILUETA real de la carta: captura el canvas con fondo transparente
 * (neutralizando los fondos de los contenedores) y lee el contorno por fila.
 * Sirve para comprobar si las esquinas son curvas y con qué radio.
 */
import puppeteer from 'puppeteer-core';
const CHROME='/opt/data/cache/chrome/chrome-headless-shell-linux64/chrome-headless-shell';
const b=await puppeteer.launch({executablePath:CHROME,headless:true,args:['--no-sandbox','--use-gl=swiftshader','--enable-unsafe-swiftshader']});
const p=await b.newPage();
await p.setViewport({width:1200,height:900,deviceScaleFactor:1});
await p.goto('http://172.18.0.1:4000/v/gkuro-monochrome',{waitUntil:'load',timeout:60000});
await new Promise(r=>setTimeout(r,7000));
// Neutralizar cualquier fondo (contenedores y pagina) para que solo quede la carta.
await p.evaluate(()=>{
  document.documentElement.style.background='transparent';
  document.body.style.background='transparent';
  document.querySelectorAll('*').forEach(el=>{ el.style.background='transparent'; el.style.backgroundImage='none'; el.style.border='none'; el.style.boxShadow='none'; });
});
await new Promise(r=>setTimeout(r,600));
const el=await p.$('canvas');
await el.screenshot({path:'/tmp/outline.png', omitBackground:true});
const box=await el.boundingBox();
console.log('canvas:',JSON.stringify({w:Math.round(box.width),h:Math.round(box.height)}));
await b.close();
