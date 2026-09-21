import sharp from 'sharp';
import fs from 'node:fs';
const dir='../data/images/faction';
const files=fs.readdirSync(dir).filter(f=>f.endsWith('.png')).sort();
const picks=files.filter((_,i)=>i%Math.ceil(files.length/20)===0).slice(0,20);
const S=130,PAD=6,COLS=5;
const comps=[];
picks.forEach((f,i)=>{
  const col=i%COLS,row=Math.floor(i/COLS);
  const cx=col*(S+PAD)+PAD, cy=row*(S+20+PAD)+PAD;
  const svg=Buffer.from(`<svg width="${S}" height="15"><text x="1" y="11" font-size="9" fill="#0f0">${f.replace('.png','').slice(0,20)}</text></svg>`);
  comps.push({input:svg,top:cy,left:cx});
});
// hay que await cada imagen
const imgs=[];
for(const f of picks){
  const buf=await sharp(`${dir}/${f}`).resize({width:S,height:S,fit:'inside'}).png().toBuffer();
  const m=await sharp(buf).metadata();
  imgs.push({buf,w:m.width,h:m.height});
}
picks.forEach((f,i)=>{
  const col=i%COLS,row=Math.floor(i/COLS);
  const cx=col*(S+PAD)+PAD, cy=row*(S+20+PAD)+PAD;
  comps.push({input:{create:{width:S,height:S,channels:3,background:'#444'}},top:cy+16,left:cx});
});
imgs.forEach((im,i)=>{
  const col=i%COLS,row=Math.floor(i/COLS);
  const cx=col*(S+PAD)+PAD, cy=row*(S+20+PAD)+PAD;
  comps.push({input:im.buf,top:cy+16+Math.floor((S-im.h)/2),left:cx+Math.floor((S-im.w)/2)});
});
const rowsN=Math.ceil(picks.length/COLS);
await sharp({create:{width:COLS*(S+PAD)+PAD,height:rowsN*(S+20+PAD)+PAD,channels:3,background:'#181818'}}).composite(comps).png().toFile('/tmp/factions.png');
console.log('rejilla:',picks.length,'de',files.length);
