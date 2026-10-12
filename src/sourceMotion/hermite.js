// Packed source keys: time, value[components], inSlope[], outSlope[].
// The caller owns the output. Evaluation allocates no arrays or objects.
export function sampleReferenceHermite(values,track,time,target,offset=0){
  const components=track[0],count=track[1],start=track[2],stride=1+3*components;
  const last=start+(count-1)*stride;
  if(time<=values[start]||count===1){for(let j=0;j<components;j++)target[offset+j]=values[start+1+j];return target;}
  if(time>=values[last]){for(let j=0;j<components;j++)target[offset+j]=values[last+1+j];return target;}
  let lo=0,hi=count-1;
  while(hi-lo>1){const mid=(lo+hi)>>>1;if(values[start+mid*stride]<time)lo=mid;else hi=mid;}
  const a=start+lo*stride,b=start+hi*stride,span=values[b]-values[a],u=(time-values[a])/span;
  const u2=u*u,u3=u2*u,h00=2*u3-3*u2+1,h10=(u3-2*u2+u)*span,h01=-2*u3+3*u2,h11=(u3-u2)*span;
  for(let j=0;j<components;j++)target[offset+j]=h00*values[a+1+j]+h10*values[a+1+2*components+j]+h01*values[b+1+j]+h11*values[b+1+components+j];
  return target;
}

export function decodeReferenceCurveBinary(base64){
  const binary=atob(base64),bytes=new Uint8Array(binary.length);
  for(let i=0;i<binary.length;i++)bytes[i]=binary.charCodeAt(i);
  const view=new DataView(bytes.buffer),values=new Float32Array(bytes.length/4);
  for(let i=0;i<values.length;i++)values[i]=view.getFloat32(i*4,true);
  return values;
}
