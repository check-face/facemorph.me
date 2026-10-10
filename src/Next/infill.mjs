/** Canonical frame indices, endpoints first then breadth-first midpoints. */
export function* infillIndices(total,perSegment){
 if(!Number.isInteger(total)||total<1||!Number.isInteger(perSegment)||perSegment<2)throw RangeError('Invalid morph frame counts');
 const seen=new Set();
 for(let i=0;i<total;i+=perSegment){seen.add(i);yield i;}
 let intervals=[];for(let left=0;left<total;left+=perSegment)intervals.push([left,Math.min(total,left+perSegment)]);
 while(intervals.length){const next=[];for(const [left,right] of intervals){if(right-left<2)continue;const mid=Math.floor((left+right)/2);if(!seen.has(mid)){seen.add(mid);yield mid;}next.push([left,mid],[mid,right]);}intervals=next;}
}
export function* infillFrames(path,morph){
 for(const index of infillIndices(path.totalFrames,morph.framesPerSegment)){
  const segment=Math.floor(index/morph.framesPerSegment),u=(index%morph.framesPerSegment)/morph.framesPerSegment;
  yield {index,segment,u,visitId:u===0?morph.controls[segment].visitId:null,values:path.sample(segment,u)};
 }
}
