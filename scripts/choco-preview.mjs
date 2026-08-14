// XEM TRƯỚC mặt HỘP SOCOLA mà không phải mở game:
//   node scripts/choco-preview.mjs /tmp/xem.png
// Vẽ 2 cột: TRÁI = không bóng mờ, PHẢI = có bóng mờ, hàng dưới = slime NÂU id11 thật để so.
//
// ⚠ FILE NÀY CHÉP LẠI CÔNG THỨC CỦA GameScene.bakeChocoTexture — sửa một bên thì phải sửa bên
// kia, không thì bản xem trước nói dối. Chấp nhận trùng lặp vì nó đã bắt được BA lỗi mà đọc
// code không thấy: dải cầu vồng trải một lần thì mỗi cánh chỉ còn 3 màu (đọc ra hộp hai màu),
// bóng mờ vẽ bằng một fillEllipse thì ra vệt VIỀN SẮC như dán sticker, và ruy băng nâu id11
// nằm trên nền socola nâu thì gần như tàng hình.
import sharp from "sharp";
const COLORS = [0xfe4038,0xfe8f28,0xfed734,0x37cb5c,0x2ac0cc,0x408afa,0x9756fd,0xfd55a5,0xffffff,
  0xcbcbcb,0x4a4a4a,0x985828,0x262630,0x3050a0,0xe0b888,0x98d0f0,0x208038,0xf8c0c8,0x902030];
const hex = (c) => "#" + c.toString(16).padStart(6, "0");
const BROWN={rim:0x3a2113,groove:0x4a2a16,base:0x69401f,face:0x804f28};
function chocoTones(ribbon){
  if(ribbon<0||!COLORS[ribbon])return BROWN;
  const c=COLORS[ribbon];
  const r=((c>>16)&0xff)/255,gg=((c>>8)&0xff)/255,b=(c&0xff)/255;
  const mx=Math.max(r,gg,b),mn=Math.min(r,gg,b),dl=mx-mn;
  if(mx<0.001||dl/mx<0.12)return BROWN;
  let h=0; if(dl>0){ if(mx===r)h=((gg-b)/dl+6)%6; else if(mx===gg)h=(b-r)/dl+2; else h=(r-gg)/dl+4; h*=60; }
  const sat=(dl/mx)*0.5;
  const hsv=(v)=>{const cc=v*sat,x=cc*(1-Math.abs(((h/60)%2)-1)),m=v-cc;
    const [r2,g2,b2]=h<60?[cc,x,0]:h<120?[x,cc,0]:h<180?[0,cc,x]:h<240?[0,x,cc]:h<300?[x,0,cc]:[cc,0,x];
    return (Math.round((r2+m)*255)<<16)|(Math.round((g2+m)*255)<<8)|Math.round((b2+m)*255);};
  return {rim:hsv(0.34),groove:hsv(0.46),base:hsv(0.62),face:hsv(0.76)};
}
const RAINBOW = -1, DIAL = (n) => Math.max(0.16, 0.62 / n);
function bake(n, ribbon, T, gloss) {
  const S = T, rr = S * 0.055, p = [];
  const tone = chocoTones(ribbon);
  const R = (x,y,w,h,r,f,a=1)=>p.push(`<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${r}" ry="${r}" fill="${f}" fill-opacity="${a}"/>`);
  const E = (x,y,w,h,f,a)=>p.push(`<ellipse cx="${x}" cy="${y}" rx="${w/2}" ry="${h/2}" fill="${f}" fill-opacity="${a}"/>`);
  const C = (x,y,r,f,a=1)=>p.push(`<circle cx="${x}" cy="${y}" r="${r}" fill="${f}" fill-opacity="${a}"/>`);
  R(0,0,S,S,rr,hex(tone.rim));
  R(S*0.02,S*0.012,S*0.96,S*0.03,rr*0.4,"#ffffff",0.1);
  const inset=S*0.03, fx=inset, fw=S-inset*2;
  R(fx,fx,fw,fw,rr*0.8,hex(tone.groove));
  const u=fw/n, pad=u*0.085;
  for(let r=0;r<n;r++)for(let c=0;c<n;c++){const x0=fx+c*u+pad,y0=fx+r*u+pad,w=u-pad*2;
    R(x0,y0,w,w,u*0.14,hex(tone.base));
    R(x0+w*0.07,y0+w*0.05,w*0.86,w*0.82,u*0.12,hex(tone.face));
    R(x0+w*0.14,y0+w*0.12,w*0.6,w*0.24,u*0.09,"#ffffff",0.09);}
  const soften=(cx,cy,w,h,col,steps=16)=>{for(let i=steps;i>=1;i--){const k=i/steps;E(cx,cy,w*k,h*k,col,0.014);}};
  if (gloss) { soften(S*0.38,S*0.27,S*1.0,S*0.52,"#ffffff");
               soften(S*0.62,S*0.82,S*0.95,S*0.44,"#000000"); }
  const mid=(n-1)/2, bw=u*1.02, b0=fx+mid*u-(bw-u)/2;
  const rain=ribbon===RAINBOW, ribCol=rain?0xffffff:(COLORS[ribbon]??0xffffff);
  const HUES=[0,1,2,3,4,5,6,7], SEG=HUES.length*2;
  const band=(bx,by,w,h,horiz)=>{
    if(!rain) R(bx,by,w,h,0,hex(ribCol));
    else for(let i=0;i<SEG;i++){const f=hex(COLORS[HUES[i%HUES.length]]);
      if(horiz)R(bx+(w*i)/SEG,by,w/SEG+0.6,h,0,f); else R(bx,by+(h*i)/SEG,w,h/SEG+0.6,0,f);}
    if(horiz)R(bx,by+h*0.16,w,h*0.26,0,"#ffffff",0.26); else R(bx+w*0.16,by,w*0.26,h,0,"#ffffff",0.26);
    if(horiz){R(bx,by,w,h*0.07,0,"#000000",0.22);R(bx,by+h*0.93,w,h*0.07,0,"#000000",0.22);}
    else{R(bx,by,w*0.07,h,0,"#000000",0.22);R(bx+w*0.93,by,w*0.07,h,0,"#000000",0.22);}};
  band(fx,b0,fw,bw,true);
  R(b0-bw*0.06,b0,bw*1.12,bw,0,"#000000",0.18);
  band(b0,fx,bw,fw,false);
  if (gloss) soften(S*0.32,S*0.17,S*0.78,S*0.17,"#ffffff",12);
  const Rr=S*DIAL(n), mx=S/2;
  C(mx,mx+Rr*0.1,Rr*1.03,"#000000",0.25); C(mx,mx,Rr,hex(0xe0b055)); C(mx,mx,Rr*0.88,hex(0xf7ecd2));
  for(let i=0;i<12;i++){const a=(Math.PI*2*i)/12;C(mx+Math.sin(a)*Rr*0.72,mx-Math.cos(a)*Rr*0.72,Rr*0.045,hex(0xc9a06a),0.55);}
  return {svg:p.join(""),S,R:Rr,mx};
}
const CELL=52, cases=[[11,RAINBOW,55],[11,14,45],[7,15,40]];
const cols=[]; let X=30;
for (const g of [0,1]) for (const [n,rib,cnt] of cases) {
  const T=CELL*n, b=bake(n,rib,T,g);
  const fs=Math.round(b.R*(String(cnt).length>=3?0.78:String(cnt).length===2?1.0:1.15));
  cols.push(`<g transform="translate(${X},${g?60:60})">${b.svg}<text x="${b.mx}" y="${b.mx}" font-family="Arial" font-weight="bold" font-size="${fs}" fill="#4a2a16" text-anchor="middle" dominant-baseline="central">${cnt}</text></g>`);
  X += T + 26;
}
// hai hang slime nau id11 ben duoi de so sanh truc tiep
const W=X+10, H=60+CELL*11+80;
let tiles=""; for(let i=0;i<Math.floor(W/CELL);i++) tiles+=`<rect x="${i*CELL+4}" y="${60+CELL*11+14}" width="${CELL-8}" height="${CELL-8}" rx="${CELL*0.24}" fill="${hex(COLORS[11])}"/>`;
const svg=`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}"><rect width="${W}" height="${H}" fill="#2b2f4a"/>`
 +`<text x="20" y="34" font-family="Arial" font-size="20" fill="#dfe3ee">TRAI 3 = khong bong mo (cu)   ·   PHAI 3 = co bong mo (moi)   ·   hang duoi = slime NAU id11 that</text>`
 +cols.join("")+tiles+`</svg>`;
await sharp(Buffer.from(svg)).png().toFile(process.argv[2]);
console.log("ok", W, "x", H);
