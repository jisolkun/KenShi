// Ordinary contact feedback ported from the uploaded reference runtime.
// Numeric envelopes and geometric drawing methods are preserved verbatim;
// the archive does not contain the original bitmap textures.
import * as THREE from 'three';
import {HIT_GLINT_SOURCE as GLINT_SOURCE, ORDINARY_BLOOD_SOURCE as BLOOD_SOURCE} from './impact-data.js';
const f=Math.fround;

function authoredGlintGeometry() {
  const bounds=GLINT_SOURCE.texture.uvBounds,vertices=[],alpha=[];
  const centre=[(bounds[0]+bounds[2])/2,(bounds[1]+bounds[3])/2];
  const rim=[[-.5,0],[-.35,-.35],[0,-.5],[.35,-.35],[.5,0],[.35,.35],[0,.5],[-.35,.35]];
  const point=(p,r=1)=>[centre[0]+p[0]*(bounds[2]-bounds[0])*r,centre[1]+p[1]*(bounds[3]-bounds[1])*r];
  let mass=0;
  function triangle(a,b,c,aa,ab,ac) {
    mass+=Math.abs((b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]))/2*(aa+ab+ac)/3;
    for(const [p,v]of [[a,aa],[b,ab],[c,ac]]){vertices.push((p[0]-.5)*2*GLINT_SOURCE.planeHalfExtent*GLINT_SOURCE.worldScale,0,(p[1]-.5)*2*GLINT_SOURCE.planeHalfExtent*GLINT_SOURCE.worldScale);alpha.push(v);}
  }
  // Original octagonal halo with translucent edges and narrow highlights.
  // These rings/angles are authored, not a bitmap contour or source mesh trace.
  for(let i=0;i<rim.length;i++) {
    const a=point(rim[i],.35),b=point(rim[(i+1)%rim.length],.35),c=point(rim[i]),d=point(rim[(i+1)%rim.length]);
    triangle(centre,a,b,1,.7,.7);
    triangle(a,c,b,.7,0,.7);triangle(b,c,d,.7,0,0);
  }
  for(const angle of [Math.PI/2,Math.PI/2+.18,-Math.PI/2,0,Math.PI]) {
    const dir=[Math.cos(angle),Math.sin(angle)],normal=[-dir[1],dir[0]],tip=point([dir[0]*.5,dir[1]*.5]);
    const a=point([normal[0]*.012,normal[1]*.012]),b=point([-normal[0]*.012,-normal[1]*.012]);
    triangle(centre,a,tip,1,0,0);triangle(centre,tip,b,1,0,0);
  }
  const multiplier=GLINT_SOURCE.texture.alphaMass/mass;
  if(multiplier>1)throw new Error('Authored glint has insufficient alpha capacity');
  const geometry=new THREE.BufferGeometry();
  geometry.setAttribute('position',new THREE.Float32BufferAttribute(vertices,3));
  geometry.setAttribute('glintAlpha',new THREE.Float32BufferAttribute(alpha.map(v=>v*multiplier),1));
  geometry.userData={sourceAlphaMass:GLINT_SOURCE.texture.alphaMass,authoredAlphaMass:mass*multiplier,alphaScale:multiplier,sourceUVBounds:[...bounds]};
  return geometry;
}
function glintMaterial() {
  return new THREE.ShaderMaterial({transparent:true,side:THREE.DoubleSide,forceSinglePass:true,depthWrite:false,toneMapped:false,
    blending:THREE.CustomBlending,blendEquation:THREE.AddEquation,blendSrc:THREE.SrcAlphaFactor,blendDst:THREE.OneFactor,
    // The source RGB blend is additive; retain opaque canvas coverage.
    blendSrcAlpha:THREE.ZeroFactor,blendDstAlpha:THREE.OneFactor,
    uniforms:{ink:{value:new THREE.Vector3(...GLINT_SOURCE.texture.alphaWeightedRGB.map(v=>v/255))}},
    vertexShader:'attribute float glintAlpha;varying float alpha;void main(){alpha=glintAlpha;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}',
    fragmentShader:'varying float alpha;uniform vec3 ink;void main(){gl_FragColor=vec4(ink,alpha);}',
    userData:{sourceBlend:GLINT_SOURCE.blend,sourceShader:'Mobile/Particles/Additive',sourceRenderQueue:GLINT_SOURCE.renderQueue}});
}

function createGlintPool(push) {
  let holder=null,slots=null,index=0,serial=0;
  function snapshot() {
    return {index,poolSize:GLINT_SOURCE.poolSize,sourceBlend:GLINT_SOURCE.blend,slots:slots?.map(s=>({sourceSlot:s.slot,serial:s.serial,
      age:s.age,active:s.active,scale:[...s.scale],position:s.group.position.toArray(),yaw:s.group.rotation.y,layer:s.layer}))??[]};
  }
  function sync(s) {
    s.group.visible=s.active;s.group.scale.set(s.scale[0],s.scale[1],s.scale[2]);
    s.group.userData.age=s.age;s.group.userData.active=s.active;s.group.userData.serial=s.serial;
  }
  function ensurePool() {
    if(holder)return;
    holder=new THREE.Group();holder.name='Source ef_hit 10-slot pool';holder.renderOrder=GLINT_SOURCE.renderQueue;
    holder.userData={effectType:'reference-hit-pool',sourcePoolSize:GLINT_SOURCE.poolSize,snapshotSlots:snapshot};
    const geometry=authoredGlintGeometry(),material=glintMaterial();
    slots=Array.from({length:GLINT_SOURCE.poolSize},(_,slot)=>{
      const group=new THREE.Group(),mesh=new THREE.Mesh(geometry,material);mesh.renderOrder=GLINT_SOURCE.renderQueue;
      group.name='Source ef_hit bright sheet';group.add(mesh);holder.add(group);
      group.userData={effectType:'reference-hit',sourceSlot:slot,sourceBlend:GLINT_SOURCE.blend,
        sourceRenderQueue:GLINT_SOURCE.renderQueue,snapshot:()=>snapshot().slots[slot]};
      const entry={group,slot,age:0,active:false,scale:[...GLINT_SOURCE.sourceScale],serial:0,layer:null};sync(entry);return entry;
    });
    // Keep source pool resources owned by the existing effects disposal queue.
    push(holder,Infinity,dt=>{
      const step=f(Math.max(0,dt));
      for(const s of slots) {
        if(!s.active)continue;
        if(s.age<GLINT_SOURCE.durationGuard) {
          for(let i=0;i<3;i++)s.scale[i]=f(s.scale[i]+f(GLINT_SOURCE.growVector[i]*step));
          s.age=f(s.age+step);
        }else {
          s.age=0;s.scale=[...GLINT_SOURCE.sourceScale];s.active=false;
          s.group.position.fromArray(GLINT_SOURCE.resetPosition).multiplyScalar(GLINT_SOURCE.worldScale);
        }
        sync(s);
      }
    },[geometry]);
  }
  return {
    referenceGlint(origin,direction,{withBlood=false,layer=20,yaw}={}) {
      ensurePool();const s=slots[index];index=(index+1)%GLINT_SOURCE.poolSize;
      // Reusing an active slot moves it without restarting showdelay or scale.
      s.active=true;s.serial=++serial;s.layer=layer;
      s.group.name=withBlood?'Source hit bright sheet':'Source Blood_Only bright sheet';
      s.group.userData.layer=layer;
      s.group.position.copy(origin).addScaledVector(direction,(withBlood?.1:-.1)*GLINT_SOURCE.worldScale);
      s.group.position.y+=.05*GLINT_SOURCE.worldScale;
      s.group.rotation.y=yaw??Math.floor(Math.random()*360)*Math.PI/180;
      sync(s);return s.group;
    },
    referenceGlintDiagnostics:snapshot,
  };
}

const mod=(n,m)=>(n%m+m)%m;

// Derive the displayed cell from retained UV, independently of logical index.
function visibleFrame(offset) {
  const col=mod(Math.round(offset[0]/BLOOD_SOURCE.textureScale[0]),4);
  const row=mod(Math.round((1-BLOOD_SOURCE.textureScale[1]-offset[1])/BLOOD_SOURCE.textureScale[1]),4);
  return row*4+col;
}
function authoredIslands() {
  const centres=[[0,.16],[.28,0],[.48,.18],[.76,.10],[1,.29],[.65,.35],[.31,.35],[.12,.48],
    [.48,.54],[.8,.56],[.95,.74],[.65,.77],[.35,.73],[.10,.81],[.42,1],[.82,.93]];
  return centres.map((centre,i)=>{
    let polygon=[[0,0],[1,0],[1,1],[0,1]];
    for(const other of centres) {
      if(other===centre)continue;
      const normal=[other[0]-centre[0],other[1]-centre[1]],limit=(other[0]**2+other[1]**2-centre[0]**2-centre[1]**2)/2;
      const distance=p=>p[0]*normal[0]+p[1]*normal[1]-limit,next=[];
      for(let n=0;n<polygon.length;n++) {
        const a=polygon[n],b=polygon[(n+1)%polygon.length],da=distance(a),db=distance(b);
        if(da<=0)next.push(a);
        if((da<=0)!==(db<=0)) {
          const t=da/(da-db);next.push([a[0]+(b[0]-a[0])*t,a[1]+(b[1]-a[1])*t]);
        }
      }
      polygon=next;
    }
    const size=.72+.25*Math.sin(i*2.3)**2;
    return {centre,polygon:polygon.map(p=>[centre[0]+(p[0]-centre[0])*size,centre[1]+(p[1]-centre[1])*size]),inkWeight:.9+.18*Math.sin(i*1.7)**2};
  });
}
const ISLANDS=authoredIslands();
function authoredFrameGeometry(frame) {
  const spec=BLOOD_SOURCE.texture.frames[frame],bounds=spec.uvBounds;
  const width=bounds[2]-bounds[0],height=bounds[3]-bounds[1];
  // Independently authored irregular islands. Their cell positions and polygon
  // shape do not derive from texture contours or the original quad topology.
  const islands=[];let area=0,weightedArea=0;
  for(const authored of ISLANDS) {
    const point=p=>[bounds[0]+p[0]*width,bounds[1]+p[1]*height];
    const centre=point(authored.centre),poly=authored.polygon.map(point);
    let islandArea=0;
    for(let j=0;j<poly.length;j++) {
      const a=poly[j],b=poly[(j+1)%poly.length];
      islandArea+=Math.abs((a[0]-centre[0])*(b[1]-centre[1])-(a[1]-centre[1])*(b[0]-centre[0]))/2;
    }
    const inkWeight=authored.inkWeight;
    islands.push({centre,poly,inkWeight});area+=islandArea;weightedArea+=islandArea*inkWeight;
  }
  const scale=Math.sqrt(spec.visibleCoverage/area),opacity=spec.alphaMass/(weightedArea*scale**2);
  if(scale>1)throw new Error('Authored blood islands exceed their measured frame envelope');
  const vertices=[],uv=[],alpha=[],basis=BLOOD_SOURCE.mesh.uvAffineXZ;
  function vertex(p,a) {
    const x=basis[0][0]+p[0]*basis[1][0]+p[1]*basis[2][0];
    const z=basis[0][1]+p[0]*basis[1][1]+p[1]*basis[2][1];
    vertices.push(x*BLOOD_SOURCE.worldScale,0,z*BLOOD_SOURCE.worldScale);uv.push(...p);alpha.push(a);
  }
  for(const island of islands) {
    const c=island.centre,p=island.poly.map(q=>[c[0]+(q[0]-c[0])*scale,c[1]+(q[1]-c[1])*scale]);
    const a=island.inkWeight*opacity;
    if(a>1||a<=32/255)throw new Error('Authored blood alpha falls outside measured coverage threshold');
    for(let j=0;j<p.length;j++){vertex(c,a);vertex(p[j],a);vertex(p[(j+1)%p.length],a);}
  }
  const geometry=new THREE.BufferGeometry();
  geometry.setAttribute('position',new THREE.Float32BufferAttribute(vertices,3));
  geometry.setAttribute('uv',new THREE.Float32BufferAttribute(uv,2));
  geometry.setAttribute('bloodAlpha',new THREE.Float32BufferAttribute(alpha,1));
  geometry.userData={frame,sourceAlphaMass:spec.alphaMass,authoredAlphaMass:weightedArea*scale**2*opacity,
    sourceCoverage:spec.visibleCoverage,authoredCoverage:area*scale**2,sourceUVBounds:[...bounds],authoredPolygonCount:16};
  return geometry;
}
function bloodMaterial(frame) {
  return new THREE.ShaderMaterial({transparent:true,side:THREE.DoubleSide,forceSinglePass:true,depthWrite:false,toneMapped:false,
    blending:THREE.NormalBlending,uniforms:{ink:{value:new THREE.Vector3(...BLOOD_SOURCE.texture.frames[frame].alphaWeightedRGB.map(v=>v/255))}},
    vertexShader:'attribute float bloodAlpha;varying float alpha;void main(){alpha=bloodAlpha;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}',
    fragmentShader:'varying float alpha;uniform vec3 ink;void main(){gl_FragColor=vec4(ink,alpha);}',
    userData:{sourceBlend:BLOOD_SOURCE.blend,sourceRenderQueue:BLOOD_SOURCE.renderQueue,sourceShader:'Mobile/Particles/Alpha Blended',frame}});
}

function createBloodPool(push) {
  let holder=null,slots=null,serial=0;
  function snapshot() {
    return {poolSize:BLOOD_SOURCE.poolSize,sourceBlend:BLOOD_SOURCE.blend,materialAttribute:0,slots:slots?.map(s=>({
      sourceSlot:s.slot,active:s.active,starttime:s.age,age:s.age,index:s.index,oldindex:s.oldindex,
      textureOffset:[...s.offset],textureScale:[...BLOOD_SOURCE.textureScale],frame:visibleFrame(s.offset),
      position:s.group.position.toArray(),yaw:s.group.rotation.y,quaternion:s.group.quaternion.toArray(),serial:s.serial,layer:s.layer}))??[]};
  }
  function sync(s) {
    const frame=visibleFrame(s.offset);
    s.group.visible=s.active;s.mesh.geometry=s.geometries[frame];s.mesh.material=s.materials[frame];
    Object.assign(s.group.userData,{active:s.active,age:s.age,starttime:s.age,index:s.index,oldindex:s.oldindex,
      textureOffset:[...s.offset],textureScale:[...BLOOD_SOURCE.textureScale],frame,serial:s.serial});
  }
  function ensurePool() {
    if(holder)return;
    holder=new THREE.Group();holder.name='Source Ef_blood shared ten-slot pool';
    holder.userData={effectType:'reference-blood-pool',sourcePoolSize:BLOOD_SOURCE.poolSize,snapshotSlots:snapshot};
    const geometries=Array.from({length:BLOOD_SOURCE.frameCount},(_,frame)=>authoredFrameGeometry(frame));
    const materials=Array.from({length:BLOOD_SOURCE.frameCount},(_,frame)=>bloodMaterial(frame));
    // Inactive frame owners keep every shared material in effects disposal traversal.
    const resources=new THREE.Group();resources.name='Authored blood frame resources';resources.visible=false;
    for(let frame=0;frame<BLOOD_SOURCE.frameCount;frame++)resources.add(new THREE.Mesh(geometries[frame],materials[frame]));
    holder.add(resources);
    slots=Array.from({length:BLOOD_SOURCE.poolSize},(_,slot)=>{
      const group=new THREE.Group(),mesh=new THREE.Mesh(geometries[0],materials[0]);mesh.renderOrder=BLOOD_SOURCE.renderQueue;
      group.name='Source ordinary directional blood';group.add(mesh);holder.add(group);
      group.position.fromArray(BLOOD_SOURCE.resetPosition).multiplyScalar(BLOOD_SOURCE.worldScale);
      group.userData={effectType:'reference-blood',sourceSlot:slot,sourceBlend:BLOOD_SOURCE.blend,
        sourceRenderQueue:BLOOD_SOURCE.renderQueue,snapshot:()=>snapshot().slots[slot]};
      const entry={group,mesh,geometries,materials,slot,active:false,age:0,index:0,oldindex:-1,
        offset:[...BLOOD_SOURCE.initialTextureOffset],serial:0,layer:null};sync(entry);return entry;
    });
    push(holder,Infinity,dt=>{
      const step=f(Math.max(0,dt));
      for(const s of slots) {
        if(!s.active||!(s.group.position.y<BLOOD_SOURCE.heightGuard*BLOOD_SOURCE.worldScale))continue;
        s.age=f(s.age+step);s.index=Math.trunc(f(s.age*BLOOD_SOURCE.fps));
        const offset=[f((s.index%4)*BLOOD_SOURCE.textureScale[0]),f(1-BLOOD_SOURCE.textureScale[1]-f(Math.trunc(s.index/4)*BLOOD_SOURCE.textureScale[1]))];
        if(s.index!==s.oldindex) {
          if(s.index>=BLOOD_SOURCE.frameCount) {
            s.group.position.fromArray(BLOOD_SOURCE.resetPosition).multiplyScalar(BLOOD_SOURCE.worldScale);
            s.age=0;s.index=0;s.active=false;
          }
          // Source writes the offset calculated before its index reset.
          s.offset=offset;s.oldindex=s.index;
        }
        sync(s);
      }
    },geometries);
  }
  return {
    referenceBlood(origin,direction,sourceSlot,{layer=20}={}) {
      if(!Number.isInteger(sourceSlot)||sourceSlot<0||sourceSlot>=BLOOD_SOURCE.poolSize)throw new RangeError('Blood needs the selected shared hit slot');
      ensurePool();const s=slots[sourceSlot];s.active=true;s.serial=++serial;s.layer=layer;
      s.group.position.copy(origin);s.group.position.y+=BLOOD_SOURCE.spawnHeight*BLOOD_SOURCE.worldScale;
      if(direction.lengthSq()>0)s.group.rotation.y=Math.atan2(-direction.x,-direction.z);
      s.group.userData.layer=layer;sync(s);return s.group;
    },
    referenceBloodDiagnostics:snapshot,
  };
}


const BLOOD_LAYERS = new Set([17, 18, 19, 20, 28, 30, 31]);
const NORMAL_CAMERA_LAYERS = new Set([20, 22, 28]);
const ZERO = new THREE.Vector3();

function sourcePoint(value) {
  if (value?.isObject3D) {
    value.updateWorldMatrix(true, false);
    return value.getWorldPosition(new THREE.Vector3());
  }
  const point = value?.position ?? value;
  if (Array.isArray(point)) return new THREE.Vector3(point[0], point[1] ?? 0, point[2]);
  return new THREE.Vector3(point?.x ?? 0, point?.y ?? 0, point?.z ?? 0);
}

function sourceDirection(facing) {
  if (typeof facing === 'number') return new THREE.Vector3(Math.sin(facing), 0, Math.cos(facing));
  if (Array.isArray(facing)) return new THREE.Vector3(facing[0] ?? 0, 0, facing[2] ?? 0);
  // Keep the source attack direction's magnitude, including close contact 1.6.
  return new THREE.Vector3(facing?.x ?? 0, 0, facing?.z ?? 0);
}

/** The original Hitcam / Hitcam2 displacement, in source world coordinates.
 * Normal parity 0 is the first hit: Hitcam toggles dx from +1 to -1.
 * Apply any world z reflection at the camera integration boundary.
 */
export function getSourceCameraImpulse(layer = 20, parity = 0) {
  if (layer === 21) return new THREE.Vector3(0, .03, .02).multiplyScalar(GLINT_SOURCE.worldScale);
  if (!NORMAL_CAMERA_LAYERS.has(layer)) return new THREE.Vector3();
  const sign = Math.abs(Math.trunc(parity)) % 2 === 0 ? -1 : 1;
  return new THREE.Vector3(.06, 0, .03).multiplyScalar(sign * GLINT_SOURCE.worldScale);
}

/** Mutate the offset using the native camera's linear dt * 10 return. */
export function lerpSourceCameraOffset(offset, dt) {
  if (!Number.isFinite(dt) || dt < 0) throw new RangeError('Camera dt must be finite and nonnegative');
  return offset.lerp(ZERO, THREE.MathUtils.clamp(dt * 10, 0, 1));
}

/** Own the original shared ten-slot glint and blood pools for one scene. */
export function createSourceImpactFeedback(scene) {
  if (!scene?.isObject3D) throw new TypeError('Source impact feedback requires a Three scene or group');
  let effects = [];
  const push = (group, duration, update, geometries) => {
    scene.add(group);
    effects.push({ group, update, geometries });
  };
  let glints = createGlintPool(push), bloods = createBloodPool(push);

  return {
    hit(position, facing, layer = 20, rising = false) {
      const origin = sourcePoint(position), direction = sourceDirection(facing);
      const withBlood = BLOOD_LAYERS.has(layer);
      const hit = glints.referenceGlint(origin, direction, { withBlood, layer });
      const blood = withBlood ? bloods.referenceBlood(origin, direction, hit.userData.sourceSlot, { layer }) : null;
      hit.userData.rising = rising;
      if (blood) blood.userData.rising = rising;
      return { hit, blood };
    },
    update(dt) {
      if (!Number.isFinite(dt) || dt < 0) throw new RangeError('Impact dt must be finite and nonnegative');
      // Gameplay pauses at dt = 0. Do not advance a pending pool reset while paused.
      if (dt === 0) return;
      for (const effect of effects) effect.update(dt);
    },
    snapshot() {
      return { glints: glints.referenceGlintDiagnostics(), bloods: bloods.referenceBloodDiagnostics() };
    },
    clear() {
      const geometries = new Set(), materials = new Set();
      for (const effect of effects) {
        effect.group.removeFromParent();
        for (const geometry of effect.geometries) geometries.add(geometry);
        effect.group.traverse(object => {
          if (!object.isMesh) return;
          geometries.add(object.geometry);
          for (const material of Array.isArray(object.material) ? object.material : [object.material]) materials.add(material);
        });
      }
      for (const geometry of geometries) geometry.dispose();
      for (const material of materials) material.dispose();
      effects = [];
      glints = createGlintPool(push);
      bloods = createBloodPool(push);
    },
  };
}
