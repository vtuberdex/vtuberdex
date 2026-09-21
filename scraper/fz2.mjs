import sharp from 'sharp';
// Ampliar la esquina sup-izq (20% x 30% de la carta) con rejilla de % para medir la bandera
const comps=[]; let top=0;
for(const s of process.argv.slice(2)){
  const info=await sharp(`../data/images/card/${s}.webp`).metadata();
  const w=Math.round(info.width*0.22), h=Math.round(info.height*0.30);
  const W=440;
  const buf=await sharp(`../data/images/card/${s}.webp`).extract({left:0,top:0,width:w,height:h}).resize({width:W}).png().toBuffer();
  const m=await sharp(buf).metadata();
  const sc=W/w; // px carta -> px imagen mostrada
  const g=[[0.10,'#0f0'],[0.20,'#0f0']].map(([f,c])=>`<line x1="${w*f*sc}" y1="0" x2="${w*f*sc}" y2="${m.height}" stroke="${c}" stroke-width="1.5"/>`).join('');
  const gh=[[0.10,'#ff0'],[0.15,'#ff0'],[0.20,'#ff0'],[0.25,'#ff0']].map(([f,c])=>`<line x1="0" y1="${h*f*sc}" x2="${W}" y2="${h*f*sc}" stroke="${c}" stroke-width="1.5"/>`).join('');
  const svg=Buffer.from(`<svg width="${W}" height="${m.height}">${g}${gh}</svg>`);
  const svgT=Buffer.from(`<svg width="${W}" height="16"><text x="2" y="12" font-size="11" fill="#8ef">${s} — verde=10/20% ancho, amarillo=10/15/20/25% alto</text></svg>`);
  comps.push({input:svgT,top,left:0}); comps.push({input:buf,top:top+16,left:0}); comps.push({input:svg,top:top+16,left:0});
  top+=16+m.height+6;
}
await sharp({create:{width:440,height:top,channels:3,background:'#111'}}).composite(comps).png().toFile('/tmp/fz2.png');
console.log('ok');
