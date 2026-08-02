import sharp from "sharp";
const DIR="public/art/slime";const NAME=["đỏ","cam","vàng","lá","teal","dương","tím","hồng","trắng","xám nhạt","xám đậm","nâu","đen","navy","tan","da trời","lá đậm","đào","mận"];
let bad=[];
for(let id=0;id<19;id++){const {data,info}=await sharp(`${DIR}/tile-${id}.png`).ensureAlpha().raw().toBuffer({resolveWithObject:true});const W=info.width,H=info.height;
 let mnx=1e9,mny=1e9,mxx=-1,mxy=-1,n=0;for(let y=0;y<H;y++)for(let x=0;x<W;x++){if(data[(y*W+x)*4+3]>200){n++;if(x<mnx)mnx=x;if(x>mxx)mxx=x;if(y<mny)mny=y;if(y>mxy)mxy=y;}}
 const asp=(mxx-mnx+1)/(mxy-mny+1);const ok=asp>=0.82&&asp<=1.22;if(!ok)bad.push(`${id}(${NAME[id]}) asp=${asp.toFixed(2)}`);
 process.stdout.write(`${id}:${asp.toFixed(2)}${ok?"":"⚠"}  `);}
console.log("\nLỖI còn:",bad.length?bad.join(", "):"KHÔNG (tất cả vuông)");
