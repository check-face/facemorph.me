// Byte-exact reference decoding, deliberately limited to our RGB/RGBA PNG fixtures.
// No canvas, browser color conversion or privacy-sensitive pixel readback.
const table = Uint32Array.from({length:256},(_,n)=>{for(let k=0;k<8;k++)n=n&1?0xedb88320^(n>>>1):n>>>1;return n>>>0;});
function crc(bytes,start,end){let n=0xffffffff;for(let i=start;i<end;i++)n=table[(n^bytes[i])&255]^(n>>>8);return (n^0xffffffff)>>>0;}
function paeth(a,b,c){const p=a+b-c,pa=Math.abs(p-a),pb=Math.abs(p-b),pc=Math.abs(p-c);return pa<=pb&&pa<=pc?a:pb<=pc?b:c;}
export async function decodeReferencePng(input,{expectedWidth=1024,expectedHeight=1024,signal}={}) {
  const bytes=input instanceof Uint8Array?input:new Uint8Array(input);
  if(bytes.byteLength>16*1024*1024)throw Error('Reference PNG compressed size exceeds limit');
  if(bytes.length<33||![137,80,78,71,13,10,26,10].every((x,i)=>bytes[i]===x))throw Error('Invalid PNG signature');
  const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);let pos=8,width,height,channels,ended=false,idatEnded=false;const parts=[];let chunkCount=0;
  while(pos<bytes.length){
    if(++chunkCount>4096)throw Error('Reference PNG chunk count exceeds limit');
    if(pos+12>bytes.length)throw Error('Truncated PNG chunk');
    const length=view.getUint32(pos),start=pos+8,end=start+length;
    if(end+4>bytes.length)throw Error('Truncated PNG chunk data');
    const type=String.fromCharCode(...bytes.subarray(pos+4,pos+8));
    if(!/^[A-Za-z]{4}$/.test(type)||type[2]!==type[2].toUpperCase())throw Error('Invalid PNG chunk type');
    if(crc(bytes,pos+4,end)!==view.getUint32(end))throw Error('PNG CRC mismatch: '+type);
    if(pos===8&&type!=='IHDR')throw Error('PNG must start with IHDR');
    if(type==='IHDR'){
      if(width!==undefined||length!==13)throw Error('Invalid PNG IHDR');
      width=view.getUint32(start);height=view.getUint32(start+4);const depth=bytes[start+8],color=bytes[start+9];
      if(!width||!height||width>2048||height>2048||width!==expectedWidth||height!==expectedHeight)throw Error('Unexpected reference PNG dimensions');
      if(depth!==8||![2,6].includes(color)||bytes[start+10]!==0||bytes[start+11]!==0||bytes[start+12]!==0)throw Error('Reference decoder requires 8-bit RGB/RGBA noninterlaced PNG');
      channels=color===2?3:4;
    }else if(type==='IDAT'){
      if(idatEnded)throw Error('Noncontiguous PNG IDAT');parts.push(bytes.subarray(start,end));
    }else if(type==='IEND'){
      if(length!==0||!parts.length)throw Error('Invalid PNG IEND');ended=true;pos=end+4;break;
    }else{
      if(parts.length)idatEnded=true;
      if(['tRNS','acTL','fcTL','fdAT'].includes(type)||!(bytes[pos+4]&32))throw Error('Unsupported PNG chunk: '+type);
      // Ancillary color/gamma metadata intentionally does not change encoded reference samples.
    }
    pos=end+4;
  }
  if(!ended||pos!==bytes.length)throw Error('Missing IEND or trailing PNG bytes');
  if(typeof DecompressionStream!=='function')throw Error('PNG reference decoder requires DecompressionStream(deflate)');
  const stride=width*channels,expected=(stride+1)*height,filtered=new Uint8Array(expected);
  const reader=new Blob(parts).stream().pipeThrough(new DecompressionStream('deflate')).getReader();let offset=0,abort;
  const aborted=new Promise((_,reject)=>{abort=()=>{const error=new DOMException('PNG decode cancelled','AbortError');void reader.cancel(error).catch(()=>{});reject(error);};if(signal?.aborted)abort();else signal?.addEventListener('abort',abort,{once:true});});
  try{for(;;){const {value,done}=await Promise.race([reader.read(),aborted]);if(done)break;if(value.byteLength>expected-offset)throw Error('PNG inflated data exceeds expected size');filtered.set(value,offset);offset+=value.byteLength;}}
  catch(error){void reader.cancel(error).catch(()=>{});throw error;}finally{signal?.removeEventListener('abort',abort);}
  // One-shot private reader: no handoff/reuse needs releaseLock. Explicit releaseLock
  // entered a WebKit GC/stream lock wait in the captured iOS Simulator failure.
  if(offset!==expected)throw Error('Truncated PNG inflated data');
  const rgba=new Uint8ClampedArray(width*height*4),previous=new Uint8Array(stride),current=new Uint8Array(stride);
  for(let y=0;y<height;y++){
    const rowStart=y*(stride+1),filter=filtered[rowStart];if(filter>4)throw Error('Invalid PNG row filter');
    for(let x=0;x<stride;x++){const a=x>=channels?current[x-channels]:0,b=previous[x],c=x>=channels?previous[x-channels]:0;
      current[x]=(filtered[rowStart+1+x]+(filter===0?0:filter===1?a:filter===2?b:filter===3?Math.floor((a+b)/2):paeth(a,b,c)))&255;
    }
    for(let x=0;x<width;x++){const dst=(y*width+x)*4,src=x*channels;rgba[dst]=current[src];rgba[dst+1]=current[src+1];rgba[dst+2]=current[src+2];rgba[dst+3]=channels===4?current[src+3]:255;}
    previous.set(current);
  }
  return {width,height,rgba,decoder:'png-reference-v1',colorPolicy:'Encoded 8-bit samples; no canvas or color conversion'};
}
