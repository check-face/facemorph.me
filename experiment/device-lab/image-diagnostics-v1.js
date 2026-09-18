export function imageStats(raw){
 const channels=[];const n=1048576;
 for(let c=0;c<3;c++){let min=Infinity,max=-Infinity,nonFinite=0,clippedLow=0,clippedHigh=0;for(let i=c*n;i<(c+1)*n;i++){const v=raw[i];if(!Number.isFinite(v)){nonFinite++;continue;}min=Math.min(min,v);max=Math.max(max,v);const p=Math.fround(Math.fround(v*127.5)+128);if(p<0)clippedLow++;if(p>255)clippedHigh++;}channels.push({channel:['R','G','B'][c],min:Number.isFinite(min)?min:null,max:Number.isFinite(max)?max:null,nonFinite,clippedLow,clippedHigh});}
 return {channels,allFinite:channels.every(c=>c.nonFinite===0)};
}
