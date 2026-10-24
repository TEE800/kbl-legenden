// Kleiner PNG-Leser/-Schreiber ohne Zusatzpaket (8 Bit, nicht interlaced; sonst null).
// Genutzt von server.js (Wackelköpfe) und tools/kinn-linien.mjs.
import zlib from 'node:zlib';
export function pngDecode(buf){
 if(!buf||buf.length<33||buf.readUInt32BE(0)!==0x89504e47)return null;
 let o=8,w=0,h=0,bd=0,ct=0,il=0,pal=null,trns=null;const idat=[];
 while(o+8<=buf.length){const len=buf.readUInt32BE(o),type=buf.toString('latin1',o+4,o+8),d=buf.subarray(o+8,o+8+len);o+=12+len;
  if(type==='IHDR'){w=d.readUInt32BE(0);h=d.readUInt32BE(4);bd=d[8];ct=d[9];il=d[12];}
  else if(type==='PLTE')pal=d;else if(type==='tRNS')trns=d;else if(type==='IDAT')idat.push(d);else if(type==='IEND')break;}
 const ch={0:1,2:3,3:1,4:2,6:4}[ct];if(bd!==8||il||!ch||!w||!h)return null;
 const raw=zlib.inflateSync(Buffer.concat(idat)),stride=w*ch,px=Buffer.alloc(stride*h);
 for(let y=0;y<h;y++){const f=raw[y*(stride+1)],src=y*(stride+1)+1,dst=y*stride;
  for(let i=0;i<stride;i++){const x=raw[src+i],a=i>=ch?px[dst+i-ch]:0,b=y?px[dst-stride+i]:0,c=y&&i>=ch?px[dst-stride+i-ch]:0;
   let v=x;if(f===1)v=x+a;else if(f===2)v=x+b;else if(f===3)v=x+((a+b)>>1);else if(f===4){const p=a+b-c,pa=Math.abs(p-a),pb=Math.abs(p-b),pc=Math.abs(p-c);v=x+(pa<=pb&&pa<=pc?a:pb<=pc?b:c);}
   px[dst+i]=v&255;}}
 const out=Buffer.alloc(w*h*4);
 for(let i=0;i<w*h;i++){const s=i*ch,q=i*4;
  if(ct===6){px.copy(out,q,s,s+4);}
  else if(ct===2){out[q]=px[s];out[q+1]=px[s+1];out[q+2]=px[s+2];out[q+3]=255;}
  else if(ct===0){out[q]=out[q+1]=out[q+2]=px[s];out[q+3]=255;}
  else if(ct===4){out[q]=out[q+1]=out[q+2]=px[s];out[q+3]=px[s+1];}
  else{const k=px[s];if(!pal)return null;out[q]=pal[k*3];out[q+1]=pal[k*3+1];out[q+2]=pal[k*3+2];out[q+3]=trns&&k<trns.length?trns[k]:255;}}
 return {w,h,data:out};
}
const CRC_T=Array.from({length:256},(_,n)=>{let c=n;for(let k=0;k<8;k++)c=c&1?0xedb88320^(c>>>1):c>>>1;return c>>>0;});
const crc32=b=>{let c=0xffffffff;for(const x of b)c=CRC_T[(c^x)&255]^(c>>>8);return (c^0xffffffff)>>>0;};
export function pngEncode(w,h,data){
 const chunk=(t,d)=>{const l=Buffer.alloc(4);l.writeUInt32BE(d.length);const td=Buffer.concat([Buffer.from(t,'latin1'),d]),c=Buffer.alloc(4);c.writeUInt32BE(crc32(td));return Buffer.concat([l,td,c]);};
 const ih=Buffer.alloc(13);ih.writeUInt32BE(w,0);ih.writeUInt32BE(h,4);ih[8]=8;ih[9]=6;
 const raw=Buffer.alloc((w*4+1)*h);for(let y=0;y<h;y++)data.copy(raw,y*(w*4+1)+1,y*w*4,(y+1)*w*4);
 return Buffer.concat([Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a]),chunk('IHDR',ih),chunk('IDAT',zlib.deflateSync(raw,{level:9})),chunk('IEND',Buffer.alloc(0))]);
}
