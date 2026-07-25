// Slice every 5x2 flashcard grid into 10 clean cutouts each, keeping only the LARGEST
// connected blob per cell (auto-drops labels + separate scenery: clouds, stars, rugs).
// Names: "<realColours>_<name>.png" (real = palette colours covering >=5% of the subject).
import sharp from "sharp";
import fs from "fs";
const DIR = "public/art/level art/1";
const OUT = "public/art/level art/sliced";
const SETS = [
  { file: "Gemini_Generated_Image_23599a23599a2359.png", tag: "toys",
    names: ["dog","dino","train","pencils","rainbow","goldfish","airplane","book","elephant","doll"] },
  { file: "Gemini_Generated_Image_i0wmnei0wmnei0wm.png", tag: "flashcard",
    names: ["giraffe","dolphin","pinetree","doctor","prince","star","sailboat","chick","rainbow","house"] },
  { file: "Gemini_Generated_Image_iracgqiracgqirac.png", tag: "heroes",
    names: ["giraffe","spacecat","pirate","panda","prince","star","artist","bus","astronaut","mushroom"] },
  { file: "Gemini_Generated_Image_wx0zsqwx0zsqwx0z.png", tag: "animals2",
    names: ["elephant","dino","lion","robot","pig","whale","owl","monkey","rocket","rainbow"] },
  { file: "Gemini_Generated_Image_ys69cyys69cyys69.png", tag: "objects",
    names: ["diamond","kite","bridge","pyramid","windmill","cactus","clock","lamp","bus","house"] },
];
const BASE_HEX=["#fe4038","#fe8f28","#fed734","#37cb5c","#2ac0cc","#408afa","#9756fd","#fd55a5","#ffffff","#cbcbcb","#4a4a4a","#985828","#262630","#3050a0","#e0b888","#98d0f0","#208038","#f8c0c8","#902030"];
const hex=h=>{h=h.replace("#","");return [parseInt(h.slice(0,2),16),parseInt(h.slice(2,4),16),parseInt(h.slice(4,6),16)];};
const DROP=new Set([13,16,18]);
const pal=BASE_HEX.map(hex).map((c,i)=>({c,i})).filter(o=>!DROP.has(o.i));
const d2=(a,b)=>{const x=a[0]-b[0],y=a[1]-b[1],z=a[2]-b[2];return x*x+y*y+z*z;};
const near=p=>{let b=0,bd=1e9;for(const o of pal){const dd=d2(p,o.c);if(dd<bd){bd=dd;b=o.i;}}return b;};
const isWhite=(r,g,b)=>r>224&&g>224&&b>224;
const COLS=5,ROWS=2;

for(const set of SETS){
  const outdir=`${OUT}/${set.tag}`; fs.mkdirSync(outdir,{recursive:true});
  const {data,info}=await sharp(`${DIR}/${set.file}`).ensureAlpha().raw().toBuffer({resolveWithObject:true});
  const IW=info.width,IH=info.height,cw=Math.floor(IW/COLS),ch=Math.floor(IH/ROWS);
  const line=[];
  for(let idx=0;idx<10;idx++){
    const col=idx%COLS,row=Math.floor(idx/COLS);
    const ix=Math.round(cw*0.03),iy=Math.round(ch*0.03);
    const cx=col*cw+ix,cy=row*ch+iy,w=cw-2*ix,h=ch-2*iy;
    const cell=Buffer.from(await sharp(data,{raw:{width:IW,height:IH,channels:4}}).extract({left:cx,top:cy,width:w,height:h}).raw().toBuffer());
    // mask: non-white, opaque
    const mask=new Uint8Array(w*h);
    for(let i=0;i<w*h;i++){const p=i*4;mask[i]=(cell[p+3]>=128 && !isWhite(cell[p],cell[p+1],cell[p+2]))?1:0;}
    // largest connected component (4-dir)
    const lab=new Int32Array(w*h).fill(-1);let best=-1,bestSz=0;
    const stack=[];
    for(let s=0;s<w*h;s++){
      if(!mask[s]||lab[s]>=0)continue;
      let sz=0;const cells=[];stack.length=0;stack.push(s);lab[s]=s;
      while(stack.length){const i=stack.pop();cells.push(i);sz++;const x=i%w,y=(i/w)|0;
        const nb=[x>0?i-1:-1,x<w-1?i+1:-1,y>0?i-w:-1,y<h-1?i+w:-1];
        for(const n of nb){if(n>=0&&mask[n]&&lab[n]<0){lab[n]=s;stack.push(n);}}}
      if(sz>bestSz){bestSz=sz;best=s;}
    }
    // keep only best component; compute bbox + colours
    let minX=w,minY=h,maxX=0,maxY=0;const cnt=new Map();let tot=0;
    for(let i=0;i<w*h;i++){
      if(lab[i]===best){const x=i%w,y=(i/w)|0;if(x<minX)minX=x;if(x>maxX)maxX=x;if(y<minY)minY=y;if(y>maxY)maxY=y;
        const p=i*4;cnt.set(near([cell[p],cell[p+1],cell[p+2]]),(cnt.get(near([cell[p],cell[p+1],cell[p+2]]))||0)+1);tot++;}
      else {const p=i*4;cell[p+3]=0;} // drop everything except the main blob
    }
    const K=[...cnt.values()].filter(c=>c/tot>=0.05).length;
    const bw=maxX-minX+1,bh=maxY-minY+1;
    const name=`${K}_${set.names[idx]}.png`;
    await sharp(cell,{raw:{width:w,height:h,channels:4}}).extract({left:minX,top:minY,width:bw,height:bh}).resize({width:256,height:256,fit:"inside"}).png().toFile(`${outdir}/${name}`);
    line.push(name);
  }
  console.log(`[${set.tag}] `+line.join("  "));
}
console.log("done → "+OUT);
