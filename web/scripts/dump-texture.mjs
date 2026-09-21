// Extrae la TEXTURA frontal que el shader usa, para medir qué se dibuja realmente.
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
const CHROME='/opt/data/cache/chrome/chrome-headless-shell-linux64/chrome-headless-shell';
const b=await puppeteer.launch({executablePath:CHROME,headless:true,args:['--no-sandbox','--use-gl=swiftshader','--enable-unsafe-swiftshader']});
const p=await b.newPage();
await p.setViewport({width:1440,height:1000});
await p.goto('http://172.18.0.1:4000/v/gkuro-monochrome',{waitUntil:'load',timeout:60000});
await new Promise(r=>setTimeout(r,7000));
// Buscar el canvas de la textura (el que NO es el canvas de WebGL) y volcarlo
const dataUrl=await p.evaluate(()=>{
  const canvases=[...document.querySelectorAll('canvas')];
  // El canvas de la textura no está en el DOM; se recrea: leer del THREE no es posible,
  // así que se instrumenta: se busca en el canvas WebGL ya renderizado.
  return null;
});
// Alternativa robusta: capturar el canvas WebGL renderizado y medir el bounding box del personaje
const el=await p.$('[data-testid="holo-card"]');
await el.screenshot({path:'/tmp/card-current.png'});
const box=await el.boundingBox();
console.log('contenedor de la carta:',JSON.stringify(box));
await b.close();
