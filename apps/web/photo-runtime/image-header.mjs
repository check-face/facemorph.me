/** Encoded dimensions are admitted before a native decoder can allocate pixels. */
export function inspectImage(bytes,{maxPixels=4*1024*1024,maxBytes=25*1024*1024}={}){
 if(!(bytes instanceof Uint8Array)||bytes.length<8||bytes.length>maxBytes)throw Error('Choose a PNG or JPEG smaller than25 MB.');
 const v=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);let width,height,format,orientation=1;
 if(v.getUint32(0)===0x89504e47&&v.getUint32(4)===0x0d0a1a0a){
  if(bytes.length<33||v.getUint32(8)!==13||v.getUint32(12)!==0x49484452)throw Error('Invalid PNG header.');
  width=v.getUint32(16);height=v.getUint32(20);format='png';
  if(bytes[24]!==8)throw Error('This alignment route currently requires an8-bit PNG or JPEG.');
 }else if(v.getUint16(0)===0xffd8){
  format='jpeg';let at=2,scanned=0;
  while(at+4<=bytes.length&&scanned++<10000){
   if(bytes[at++]!==255)throw Error('Invalid JPEG marker.');while(bytes[at]===255)at++;const marker=bytes[at++];
   if(marker===0xd9||marker===0xda)break;if(marker===0x01||(marker>=0xd0&&marker<=0xd7))continue;
   if(at+2>bytes.length)throw Error('Truncated JPEG.');const n=v.getUint16(at);if(n<2||at+n>bytes.length)throw Error('Truncated JPEG segment.');
   if([0xc0,0xc1,0xc2].includes(marker)){
    if(n<8||bytes[at+2]!==8||![1,3].includes(bytes[at+7]))throw Error('This route supports8-bit grayscale or RGB JPEG.');
    height=v.getUint16(at+3);width=v.getUint16(at+5);
   }
   if(marker===0xe1&&n>=16&&v.getUint32(at+2)===0x45786966&&v.getUint16(at+6)===0){
    const base=at+8,little=v.getUint16(base)===0x4949;
    if((little||v.getUint16(base)===0x4d4d)&&v.getUint16(base+2,little)===42){
     const offset=v.getUint32(base+4,little),dir=base+offset;
     if(dir>=base&&dir+2<=at+n){const count=v.getUint16(dir,little);for(let j=0;j<count;j++){const p=dir+2+j*12;if(p+12>at+n)break;if(v.getUint16(p,little)===0x0112&&v.getUint16(p+2,little)===3&&v.getUint32(p+4,little)===1)orientation=v.getUint16(p+8,little);}}
    }
   }
   at+=n;
  }
 }else throw Error('Choose a PNG or JPEG image.');
 if(!Number.isInteger(width)||!Number.isInteger(height)||width<1||height<1||width>8192||height>8192||width*height>maxPixels)throw Error('This local alignment route supports images up to4 megapixels; resize a copy and try again.');
 return{width,height,format,encodedBytes:bytes.length,exifOrientation:orientation,orientationPolicy:'legacy-ignore-exif'};
}
