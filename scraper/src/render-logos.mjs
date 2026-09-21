import sharp from 'sharp';
import fs from 'node:fs';
// Muestra aleatoria determinista amplia: 24 logos
const all = fs.readdirSync('../data/images/logo').filter(f=>f.endsWith('.webp')).sort();
const step = Math.floor(all.length/24);
const picks = all.filter((_,i)=>i%step===0).slice(0,24);
const COLS=4, W=340, H=200, PAD=6, LH=18;
const comps=[];
for(let i=0;i<picks.length;i++){
  const f=picks[i];
  const col=i%COLS, row=Math.floor(i/COLS);
  const x=col*(W+PAD)+PAD, y=row*(H+PAD+LH)+PAD;
  const svg=Buffer.from(`<svg width="${W}" height="${LH}"><text x="2" y="13" font-size="12" fill="#8ef">${f.replace('.webp','')}</text></svg>`);
  comps.push({input:svg,top:y,left:x});
  // fondo gris para ver transparencia
  comps.push({input:{create:{width:W,height:H,channels:3,background:'#555'}},top:y+LH,left:x});
  try{
    const buf=await sharp(`../data/images/logo/${f}`).resize({width:W,height:H,fit:'inside'}).png().toBuffer();
    const m=await sharp(buf).metadata();
    comps.push({input:buf,top:y+LH+Math.floor((H-m.height)/2),left:x+Math.floor((W-m.width)/2)});
  }catch{}
}
const rowsN=Math.ceil(picks.length/COLS);
await sharp({create:{width:COLS*(W+PAD)+PAD,height:rowsN*(H+PAD+LH)+PAD,channels:3,background:'#111'}}).composite(comps).png().toFile('/tmp/logo-final-check.png');
console.log('rejilla final:', picks.length, 'logos de', all.length);
