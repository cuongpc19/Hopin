// Slice public/art/level art/2/puzzle-characters.png (5x2 grid, white bg + dashed
// grid lines) into 10 clean cutouts. Uses BORDER-FLOOD background removal (not white-
// key, not largest-blob) so DETACHED parts (robot head, bunny ears, bee antennae) and
// INTERIOR white areas (penguin belly, bunny paws) are all kept; only the border-
// connected white + light dashed lines are removed.
// Names: "<realColours>_<name>.png" (palette colours covering >=5% of the subject).
import sharp from "sharp";
import fs from "fs";

const SRC = "public/art/level art/2/puzzle-characters.png";
const OUT = "public/art/level art/sliced/set2";
const NAMES = ["cat", "robot", "frog", "bear", "bunny", "owl", "fish", "dino", "bee", "penguin"];

const BASE_HEX = ["#fe4038","#fe8f28","#fed734","#37cb5c","#2ac0cc","#408afa","#9756fd","#fd55a5","#ffffff","#cbcbcb","#4a4a4a","#985828","#262630","#3050a0","#e0b888","#98d0f0","#208038","#f8c0c8","#902030"];
const hex = h => { h = h.replace("#",""); return [parseInt(h.slice(0,2),16),parseInt(h.slice(2,4),16),parseInt(h.slice(4,6),16)]; };
const DROP = new Set([13,16,18]);
const pal = BASE_HEX.map(hex).map((c,i)=>({c,i})).filter(o=>!DROP.has(o.i));
const d2 = (a,b) => { const x=a[0]-b[0],y=a[1]-b[1],z=a[2]-b[2]; return x*x+y*y+z*z; };
const near = p => { let b=0,bd=1e9; for(const o of pal){ const dd=d2(p,o.c); if(dd<bd){bd=dd;b=o.i;} } return b; };
// "light" = white bg or the light-grey dashed grid lines (min channel high, near-neutral)
const isLight = (r,g,b) => Math.min(r,g,b) > 175;

const COLS = 5, ROWS = 2;
fs.mkdirSync(OUT, { recursive: true });
const { data, info } = await sharp(SRC).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
const IW = info.width, IH = info.height, cw = Math.floor(IW/COLS), ch = Math.floor(IH/ROWS);
const line = [];

for (let idx = 0; idx < 10; idx++) {
  const col = idx % COLS, row = (idx/COLS)|0;
  const ix = Math.round(cw*0.04), iy = Math.round(ch*0.04);
  const cx = col*cw+ix, cy = row*ch+iy, w = cw-2*ix, h = ch-2*iy;
  const cell = Buffer.from(await sharp(data,{raw:{width:IW,height:IH,channels:4}}).extract({left:cx,top:cy,width:w,height:h}).raw().toBuffer());

  // border-flood: mark every border-connected light/transparent pixel as background
  const bg = new Uint8Array(w*h);
  const px = i => [cell[i*4],cell[i*4+1],cell[i*4+2]];
  const isBg = i => cell[i*4+3] < 128 || isLight(...px(i));
  const stack = [];
  const seed = i => { if(!bg[i] && isBg(i)){ bg[i]=1; stack.push(i); } };
  for (let x=0;x<w;x++){ seed(x); seed((h-1)*w+x); }
  for (let y=0;y<h;y++){ seed(y*w); seed(y*w+w-1); }
  while (stack.length) {
    const i = stack.pop(), x = i%w, y = (i/w)|0;
    const nb = [x>0?i-1:-1, x<w-1?i+1:-1, y>0?i-w:-1, y<h-1?i+w:-1];
    for (const n of nb) if (n>=0 && !bg[n] && isBg(n)){ bg[n]=1; stack.push(n); }
  }

  // keep non-bg; drop bg to transparent; bbox + colour count over kept pixels
  let minX=w,minY=h,maxX=0,maxY=0; const cnt=new Map(); let tot=0;
  for (let i=0;i<w*h;i++){
    if (bg[i]) { cell[i*4+3]=0; continue; }
    const x=i%w,y=(i/w)|0;
    if(x<minX)minX=x; if(x>maxX)maxX=x; if(y<minY)minY=y; if(y>maxY)maxY=y;
    const k=near(px(i)); cnt.set(k,(cnt.get(k)||0)+1); tot++;
  }
  const K = [...cnt.values()].filter(c=>c/tot>=0.05).length;
  const bw = maxX-minX+1, bh = maxY-minY+1;
  const name = `${K}_${NAMES[idx]}.png`;
  await sharp(cell,{raw:{width:w,height:h,channels:4}}).extract({left:minX,top:minY,width:bw,height:bh}).resize({width:256,height:256,fit:"inside"}).png().toFile(`${OUT}/${name}`);
  line.push(name);
}
console.log(line.join("  "));
console.log("done -> "+OUT);
