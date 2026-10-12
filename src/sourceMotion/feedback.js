import * as THREE from 'three';
import {SWING_FEEDBACK as SOURCE} from './feedback-data.js';


const radians=THREE.MathUtils.degToRad,f=Math.fround;
// Numeric RGBA is source gamma-space texture color. Multiply first lerps to
// neutral white with texture alpha, then uses Zero/SrcColor; alpha alone cannot
// fade Three.MultiplyBlending. No material tint exists in the mobile shaders.
function material(blend){
 const m=new THREE.ShaderMaterial({transparent:true,side:THREE.DoubleSide,depthWrite:false,
  vertexColors:true,toneMapped:false,forceSinglePass:true,uniforms:{fade:{value:1},alphaMultiplier:{value:blend==='crack'?2:1}},
  blending:THREE.CustomBlending,blendEquation:THREE.AddEquation,
  blendSrc:blend==='multiply'?THREE.ZeroFactor:THREE.SrcAlphaFactor,
  blendDst:blend==='multiply'?THREE.SrcColorFactor:blend==='crack'?THREE.OneMinusSrcAlphaFactor:THREE.OneFactor,
  vertexShader:'varying vec4 ink; void main(){ink=color;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}',
  fragmentShader:`varying vec4 ink;uniform float fade;uniform float alphaMultiplier;void main(){float a=clamp(ink.a*fade*alphaMultiplier,0.0,1.0);gl_FragColor=${blend==='multiply'?'vec4(mix(vec3(1.0),ink.rgb,a),1.0)':blend==='crack'?'vec4(ink.rgb*fade,a)':'vec4(ink.rgb,a)'};}`});
 m.userData={sourceBlend:blend,sourceShader:blend==='multiply'?'Mobile/Particles/Multiply':blend==='crack'?'Custom/Mobile Alpha Blend plus':'Mobile/Particles/Additive'};
 return m;
}
function triangle(out,a,b,c){out.push(a,b,c);}
function ribbon(out,start,sweep,radius,width,center=[0,0]){
 const steps=Math.ceil(Math.abs(sweep)/15),rings=[];
 for(let i=0;i<=steps;i++){
  const t=i/steps,a=radians(start+sweep*t),w=width*(.03+.97*Math.sin(Math.PI*t)**.65),row=[];
  for(const [q,alpha]of [[0,0],[.18,1],[.82,1],[1,0]]){
   const r=radius-w*q;row.push([center[0]+Math.cos(a)*r,center[1]+Math.sin(a)*r,alpha]);
  }
  rings.push(row);
 }
 for(let i=0;i<steps;i++)for(let j=0;j<3;j++){
  triangle(out,rings[i][j],rings[i+1][j],rings[i][j+1]);triangle(out,rings[i][j+1],rings[i+1][j],rings[i+1][j+1]);
 }
}
const layouts={swing1:[[140,110,.88,.55],[135,250,.91,.35],[135,245,.91,.34],[15,310,.92,.14]],
 swingex1:[[145,150,.88,.37],[130,265,.94,.43],[65,335,.96,.56],[25,325,.92,.13]],
 swingex2:[[145,115,.88,.46],[130,265,.92,.3],[135,240,.92,.3],[30,315,.94,.19]]};
function authoredShape(family,frame,widthFactor=1){
 const out=[];
 if(family==='thrust'){
  const width=.45*widthFactor;
  // A narrow authored dart with two fins; variable opacity edges avoid a solid
  // bright triangle covering the whole measured atlas cell.
  const rows=[[-1,.025],[-.55,width],[.05,width*.45],[.75,width*.12],[1,0]];
  const strips=rows.map(([y,w])=>[[-w,y,0],[-w*.6,y,1],[w*.6,y,1],[w,y,0]]);
  for(let i=0;i<strips.length-1;i++)for(let j=0;j<3;j++){
   triangle(out,strips[i][j],strips[i+1][j],strips[i][j+1]);triangle(out,strips[i][j+1],strips[i+1][j],strips[i+1][j+1]);
  }
 }else if(family==='glow')ribbon(out,185,180,.92,.47*widthFactor);
 else if(family==='fire'){
  // Three unequal rising tongues use common source envelope, with one root.
  // No star, radial white fan, billboard or extra additive core.
  const heights=[.72,1,.55],xs=[-.55,.08,.58];
  for(let i=0;i<3;i++){
   const x=xs[i],w=(i===1?.55:.42)*widthFactor,y=heights[i];
   const a=[x-w,-1,0],b=[x,-.85,1],c=[x+w,-1,0],d=[x-.11,y-.45,.5],e=[x+.10,y,0],g=[x+.17,y-.4,.5];
   triangle(out,a,d,b);triangle(out,b,d,e);triangle(out,b,e,g);triangle(out,b,g,c);
  }
 }else if(family==='crack'){
  for(let ray=0;ray<10;ray++){
   const a=ray*Math.PI*.2+.05*Math.sin(ray*2.1);let prev=[0,0];
   for(let i=1;i<=5;i++){
    const r=i/5,ang=a+Math.sin(ray+i*2)*.13,p=[Math.cos(ang)*r,Math.sin(ang)*r],w=.045*widthFactor*(1-r*.7);
    const dx=p[0]-prev[0],dy=p[1]-prev[1],n=Math.hypot(dx,dy),nx=-dy/n*w,ny=dx/n*w;
    triangle(out,[prev[0]-nx,prev[1]-ny,0],[p[0]-nx,p[1]-ny,0],[prev[0],prev[1],1]);
    triangle(out,[prev[0],prev[1],1],[p[0]-nx,p[1]-ny,0],[p[0],p[1],1]);
    triangle(out,[prev[0],prev[1],1],[p[0],p[1],1],[prev[0]+nx,prev[1]+ny,0]);
    triangle(out,[prev[0]+nx,prev[1]+ny,0],[p[0],p[1],1],[p[0]+nx,p[1]+ny,0]);prev=p;
   }
  }
 }else{
  const [start,sweep,radius,width]=layouts[family][frame];ribbon(out,start,sweep,radius,width*widthFactor);
  if(family==='swingex1'&&frame<3){const n=[3,7,10][frame];for(let i=0;i<n;i++)ribbon(out,start+i*sweep/n,38,radius*(.68+.3*i/n),width*.55*widthFactor);}
 }
 return out;
}
function fitShape(points,bounds){
 const min=[Math.min(...points.map(p=>p[0])),Math.min(...points.map(p=>p[1]))],max=[Math.max(...points.map(p=>p[0])),Math.max(...points.map(p=>p[1]))];
 return points.map(p=>[(bounds[0]+(p[0]-min[0])/(max[0]-min[0])*(bounds[2]-bounds[0]))*2-1,
  (bounds[1]+(p[1]-min[1])/(max[1]-min[1])*(bounds[3]-bounds[1]))*2-1,p[2]]);
}
function alphaIntegral(points){let sum=0;for(let i=0;i<points.length;i+=3){const [a,b,c]=points.slice(i,i+3);sum+=Math.abs((b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]))/2*(a[2]+b[2]+c[2])/3;}return sum;}
function measuredShape(family,frame){
 const spec=SOURCE.visualFrames[family][frame],target=spec.alphaMass*4;
 let points,mass;
 // Match total alpha contribution without adding a second bright overlapping
 // core. In dense EX frames, texturelike overlaps stay inside this same budget.
 for(const widthFactor of [1,1.4,2,2.8,4]){
  const authored=authoredShape(family,frame,widthFactor);
  if(family==='fire'||family==='thrust')for(const p of authored)p[1]*=-1;
  points=fitShape(authored,spec.bounds);mass=alphaIntegral(points);if(mass>=target)break;
 }
 const opacity=Math.min(1,target/mass);points=points.map(p=>[p[0],p[1],p[2]*opacity]);
 return {points,spec,audit:{family,frame,bounds:spec.bounds,sourceAlphaMass:spec.alphaMass,
  authoredAlphaMass:alphaIntegral(points)/4,alphaScale:opacity,sourceColor:spec.color,vertexCount:points.length}};
}
function shapeGeometry(shape,{planeHalf=1,vertical=false,angle=0}={}){
 const positions=[],colors=[],a=radians(angle),s=SOURCE.splash;
 for(const [x,y,alpha]of shape.points){
  if(vertical){const radius=x*s.fireRadius,h=s.fireBottom+(1-(y+1)/2)*(s.fireTop-s.fireBottom);positions.push(radius*Math.cos(a),h,radius*Math.sin(a));}
  else positions.push(x*planeHalf,0,y*planeHalf);
  colors.push(...shape.spec.color.map(c=>c/255),alpha);
 }
 const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));g.setAttribute('color',new THREE.Float32BufferAttribute(colors,4));g.userData=shape.audit;return g;
}
export function sourceSwingShapeAudit(){
 return Object.entries(SOURCE.visualFrames).flatMap(([family,frames])=>frames.map((_,i)=>measuredShape(family,i).audit));
}
function stepReferenceSplashTint(value,scaledDt,elapsed,visible=true){
 if(!visible||elapsed<1||elapsed>=1.5||!(scaledDt>0))return value;
 const a=Math.min(1,Math.max(0,f(f(scaledDt)*14)));return f(value+f(f(-value)*a));
}
function rootPose(position,facing,entity,target){
 if(entity?.isObject3D){entity.updateWorldMatrix(true,false);entity.getWorldPosition(target.position);entity.getWorldQuaternion(target.quaternion);}
 else{const p=entity?.pos??entity?.position??entity??position;target.position.set(p.x??position.x,(p.y??0)+(entity?.airHeight??0)*SOURCE.worldScale,p.z??position.z);target.rotation.set(0,entity?.facing??entity?.angle??facing,0);}
}
function familyFor(emitter){return emitter==='thrust'?'thrust':['swingex1','swing_ex1'].includes(emitter)?'swingex1':['swingex2','swing_ex2'].includes(emitter)?'swingex2':'swing1';}

// Visuals observe combat's authoritative source display clocks. They never
// advance a second effect timer or drift away from the active collider frames.
export function createSourceFeedback(scene) {
 const active=new Map();
 function dispose(entry) {
  scene.remove(entry.group);
  for(const geometry of entry.geometries)geometry.dispose();
  for(const mat of entry.materials)mat.dispose();
  if(active.get(entry.key)===entry)active.delete(entry.key);
 }
 function emit(root,descriptor,volume) {
  if(!volume?.clock)throw new TypeError('Source feedback needs an authoritative attack volume clock');
  const isSplash=descriptor.type==='splash'||descriptor.emitter==='splash';
  const group=new THREE.Group(),emitter=new THREE.Group();group.add(emitter);
  group.name=isSplash?'Original polearm splash':'Original root slash';
  const key=`${root?.id??root?.uuid??'hero'}:${descriptor.emitter}`;
  if(active.has(key))dispose(active.get(key));
  const geometries=[],materials=new Set(),stages=[];
  const entry={group,emitter,descriptor,volume,root,key,geometries,materials,stages,isSplash,snapped:false};
  const mesh=(shape,mat,options={},parent=emitter)=>{
   const geometry=shapeGeometry(shape,options);geometries.push(geometry);materials.add(mat);
   const item=new THREE.Mesh(geometry,mat);parent.add(item);return item;
  };
  const local=descriptor.position??[0,.055,0];
  emitter.position.fromArray(local).multiplyScalar(SOURCE.worldScale);
  emitter.scale.fromArray(descriptor.scale??[1.6,2,2]).multiplyScalar(SOURCE.worldScale);
  if(descriptor.quaternion)emitter.quaternion.fromArray(descriptor.quaternion).normalize();
  else emitter.rotation.set(...(descriptor.rotation??[0,0,0]).map(radians),descriptor.rotationOrder??'YXZ');
  if(!isSplash) {
   const family=familyFor(descriptor.emitter),mat=material(family==='swingex2'?'multiply':'add');
   const count=(descriptor.tiles?.[0]??2)*(descriptor.tiles?.[1]??2);
   for(let frame=0;frame<count;frame++) {
    const stage=new THREE.Group();mesh(measuredShape(family,frame%4),mat,{},stage);
    stage.visible=false;emitter.add(stage);stages.push(stage);
   }
   if(family==='swingex2')mesh(measuredShape('glow',0),material('add'));
   emitter.scale.multiplyScalar(SOURCE.planeHalfExtent);
  } else {
   emitter.position.set(0,0,0);emitter.scale.set(1,1,1);emitter.quaternion.identity();
   const spec=SOURCE.splash,crackMaterial=material('crack');
   mesh(measuredShape('crack',0),crackMaterial,{planeHalf:spec.halfExtent});
   const fire=new THREE.Group(),fireMaterial=material('multiply'),fireStages=[];emitter.add(fire);
   for(let frame=0;frame<spec.fireFrames;frame++) {
    const stage=new THREE.Group(),shape=measuredShape('fire',frame);
    for(const angle of spec.firePanelAngles)mesh(shape,fireMaterial,{vertical:true,angle},stage);
    stage.visible=false;fire.add(stage);fireStages.push(stage);
   }
   Object.assign(entry,{crackMaterial,fire,fireMaterial,fireStages});
  }
  group.userData={effectType:isSplash?'source-splash':'source-swing',descriptor,
   atlasFrame:-1,collisionActive:false,attachment:isSplash?'world-snapshot-at-show':'root'};
  group.cancel=()=>{volume.cancelled=true;dispose(entry);};
  group.visible=false;rootPose(new THREE.Vector3(),0,root,group);
  active.set(key,entry);scene.add(group);return group;
 }
 function update() {
  for(const entry of [...active.values()]) {
   const {group,volume,root,descriptor,isSplash}=entry,clock=volume.clock;
   if(volume.cancelled||clock.finished){dispose(entry);continue;}
   group.visible=clock.visible;
   if(!isSplash||!entry.snapped)rootPose(new THREE.Vector3(),0,root,group);
   if(isSplash&&group.visible&&!entry.snapped) {
    if(volume.origin)group.position.copy(volume.origin);
    else group.position.add(new THREE.Vector3().fromArray(descriptor.position).multiplyScalar(SOURCE.worldScale).applyQuaternion(group.quaternion));
    group.rotation.set(0,SOURCE.splash.worldYawAtShow,0);entry.snapped=true;
   }
   group.userData.atlasFrame=clock.frame;
   group.userData.collisionActive=group.visible&&clock.colliding;
   if(isSplash) {
    entry.crackMaterial.uniforms.fade.value=clock.tint;
    entry.fire.visible=clock.fireVisible;
    for(let frame=0;frame<entry.fireStages.length;frame++)entry.fireStages[frame].visible=clock.fireVisible&&frame===clock.fireFrame;
    group.userData.splashTint=clock.tint;group.userData.fireFrame=clock.fireFrame;
   } else for(let frame=0;frame<entry.stages.length;frame++)entry.stages[frame].visible=frame===clock.frame;
  }
 }
 function clear(){for(const entry of [...active.values()])dispose(entry);}
 return {emit,update,clear,diagnostics:()=>({active:active.size,
  effects:[...active.values()].map(({group,volume})=>({emitter:volume.descriptor.emitter,
   visible:group.visible,frame:volume.clock.frame,collision:volume.clock.colliding,attachment:group.userData.attachment}))})};
}
