/**
 * Mide el HEADER DE LA CARD DERECHA de la ficha (el bloque con número+nombre+meta,
 * donde va el logo) en varios anchos, para fijar la regla:
 *   logo = alto FIJO, ancho relativo, y nunca mayor a 2x el alto del header.
 */
import puppeteer from 'puppeteer-core';
const CHROME='/opt/data/cache/chrome/chrome-headless-shell-linux64/chrome-headless-shell';
const b=await puppeteer.launch({executablePath:CHROME,headless:true,args:['--no-sandbox','--use-gl=swiftshader','--enable-unsafe-swiftshader']});
const p=await b.newPage();
for (const [w,h,label] of [[1440,1100,'desktop'],[1024,900,'laptop'],[420,900,'movil']]) {
  await p.setViewport({width:w,height:h});
  await p.goto('http://172.18.0.1:4000/v/gkuro-monochrome',{waitUntil:'load',timeout:60000});
  await new Promise(r=>setTimeout(r,4000));
  const out=await p.evaluate(()=>{
    const h1=document.querySelector('h1');
    const bloque=h1 ? h1.parentElement : null;
    const img=[...document.querySelectorAll('img')].find(i=>i.alt && i.alt.startsWith('Logo de'));
    const card=h1 ? h1.closest('header') : null;
    return {
      bloqueTexto: bloque ? Math.round(bloque.getBoundingClientRect().height) : null,
      cardHeader: card ? Math.round(card.getBoundingClientRect().height) : null,
      logo: img ? {w:Math.round(img.getBoundingClientRect().width), h:Math.round(img.getBoundingClientRect().height)} : null,
    };
  });
  const lim = out.bloqueTexto ? out.bloqueTexto*2 : null;
  console.log(label.padEnd(8)+'bloqueTexto='+String(out.bloqueTexto).padStart(3)+'  limite(2x)='+String(lim).padStart(3)+'  logo='+(out.logo?out.logo.w+'x'+out.logo.h:'-'));
}
await b.close();
