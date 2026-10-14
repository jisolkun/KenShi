import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { getWeapon } from './weapons.js';

// Shared geometry owns GPU buffers for the lifetime of the game; switching never disposes it.
const cache = new Map();
const cached = (key, create) => { if (!cache.has(key)) cache.set(key, create()); return cache.get(key); };
const box = cached('box', () => new THREE.BoxGeometry(1,1,1));
const rod = cached('rod', () => new THREE.CylinderGeometry(1,1,1,6));
const ring = cached('ring', () => new THREE.TorusGeometry(1,.17,4,12));
function polygon(key, points, depth=.035) {
  return cached(key, () => { const s=new THREE.Shape(); points.forEach(([x,y],i)=>i?s.lineTo(x,y):s.moveTo(x,y)); s.closePath(); return new THREE.ExtrudeGeometry(s,{depth,bevelEnabled:false,steps:1,curveSegments:1}); });
}
// Straight spine on -X, sharpened edge on +X, with an oblique dao point.
const tangBlade=polygon('tang-single-edge',[[-.065,0],[.055,0],[.055,-.88],[-.035,-1],[-.065,-.94]]);
const dao = polygon('dao', [[-.07,0],[.09,0],[.14,-.58],[.08,-.88],[-.04,-1],[-.07,-.72]]);
// A continuous back and a forward cutting belly lead into an oblique dao point.
// The narrow edge stays inside the steel silhouette; mount -.1 + tip -1.38
// keeps the reviewed physical tip exactly on its original centerline.
const greatDao = polygon('great-dao-forged', [[-.085,0],[.09,0],[.12,-.26],[.18,-.66],[.22,-.99],[.205,-1.14],[.13,-1.28],[0,-1.38],[-.064,-1.225],[-.087,-1.04],[-.102,-.63],[-.095,-.23]], .07);
const greatDaoEdge = polygon('great-dao-forged-edge', [[.067,-.025],[.0928,-.025],[.12,-.26],[.18,-.66],[.22,-.99],[.205,-1.14],[.13,-1.28],[0,-1.38],[.104,-1.277],[.18,-1.137],[.195,-.994],[.155,-.663],[.096,-.264]], .006);
const greatDaoSpine = polygon('great-dao-forged-spine', [[-.085,-.02],[-.060,-.02],[-.067,-.23],[-.074,-.62],[-.059,-1.04],[-.039,-1.20],[0,-1.38],[-.064,-1.225],[-.087,-1.04],[-.102,-.63],[-.095,-.23]], .085);
const greatDaoFuller = polygon('great-dao-forged-fuller', [[-.043,-.20],[.010,-.20],[.040,-.82],[.017,-1.08],[-.001,-1.11],[-.002,-.82]], .003);
const greatDaoGuard = polygon('great-dao-forged-guard', [[-.16,-.021],[-.118,.018],[-.045,.024],[.045,.024],[.118,.018],[.16,-.021],[.145,-.032],[.082,-.012],[-.082,-.012],[-.145,-.032]], .08);
function ensureGreatDaoMaterials(palette) {
  // Separate materials participate in the rig's hit flash and lifetime while
  // leaving the retained blades, armour and shared palette colours intact.
  const finishes={
    greatSteel:[0x526e80,.42,.74], greatSpine:[0x283f4d,.55,.65],
    greatEdge:[0xc7d7db,.26,.82], greatLeather:[0x19232a,.94,.02],
    greatCopper:[0xa57b48,.50,.68],
  };
  for(const [name,[color,roughness,metalness]]of Object.entries(finishes))if(!palette[name]) {
    const material=palette.metal.clone();material.name=`great-dao:${name}`;material.color.setHex(color);material.roughness=roughness;material.metalness=metalness;palette[name]=material;
  }
}
// A hand-built chamfer keeps the forged silhouette inside its physical box.
// Each face, edge and corner has a flat normal, so the striking faces remain
// readable in the game's low-poly lighting without an oversized bevel shell.
function chamferedBox(key, half, bevel) {
  return cached(key, () => {
    const vertices=[],uvs=[];
    const face=points=>{
      const normal=new THREE.Vector3().subVectors(points[1],points[0]).cross(new THREE.Vector3().subVectors(points[2],points[0]));
      const center=points.reduce((sum,point)=>sum.add(point),new THREE.Vector3()).multiplyScalar(1/points.length);
      if(normal.dot(center)<0)points.reverse();
      const axes=[0,1,2].sort((a,b)=>Math.abs(normal.getComponent(a))-Math.abs(normal.getComponent(b))).slice(0,2);
      for(let i=1;i<points.length-1;i++)for(const point of [points[0],points[i],points[i+1]]) {
        vertices.push(point.x,point.y,point.z);
        uvs.push((point.getComponent(axes[0])/half[axes[0]]+1)*.5,(point.getComponent(axes[1])/half[axes[1]]+1)*.5);
      }
    };
    for(let axis=0;axis<3;axis++)for(const sign of [-1,1]) {
      const other=[0,1,2].filter(value=>value!==axis);
      face([[-1,-1],[1,-1],[1,1],[-1,1]].map(([a,b])=>{
        const values=[0,0,0];values[axis]=sign*half[axis];values[other[0]]=a*(half[other[0]]-bevel);values[other[1]]=b*(half[other[1]]-bevel);return new THREE.Vector3(...values);
      }));
    }
    for(let a=0;a<3;a++)for(let b=a+1;b<3;b++)for(const signA of [-1,1])for(const signB of [-1,1]) {
      const c=3-a-b;
      face([[0,-1],[1,-1],[1,1],[0,1]].map(([side,signC])=>{
        const values=[0,0,0];values[a]=signA*(half[a]-(side?bevel:0));values[b]=signB*(half[b]-(side?0:bevel));values[c]=signC*(half[c]-bevel);return new THREE.Vector3(...values);
      }));
    }
    for(const x of [-1,1])for(const y of [-1,1])for(const z of [-1,1]) {
      const signs=[x,y,z];face([0,1,2].map(axis=>new THREE.Vector3(...half.map((value,i)=>signs[i]*(value-(i===axis?0:bevel))))));
    }
    const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.Float32BufferAttribute(vertices,3));geometry.setAttribute('uv',new THREE.Float32BufferAttribute(uvs,2));geometry.computeVertexNormals();return geometry;
  });
}
const hammerCore=chamferedBox('hammer-three-forged-core',[.223,.160,.144],.022);
const hammerFace=chamferedBox('hammer-three-striking-face',[.0275,.180,.170],.014);
const hammerCheek=chamferedBox('hammer-three-cheek',[.155,.112,.012],.010);
const HAMMER_HEAD_HALF_EXTENTS=new THREE.Vector3(.26,.18,.17);
function ensureHammerMaterials(palette) {
  const finishes={
    hammerCore:[0x29333b,.61,.70], hammerSteel:[0x8d9da3,.39,.82],
    hammerCheek:[0x4a606b,.49,.77], hammerWood:[0x503b30,.86,.02],
    hammerLeather:[0x30231d,.94,.02], hammerWrap:[0x514035,.95,.02],
    hammerCopper:[0x9e6d43,.48,.70],
  };
  for(const [name,[color,roughness,metalness]]of Object.entries(finishes))if(!palette[name]) {
    const material=palette.metal.clone();material.name=`hammer-three:${name}`;material.color.setHex(color);material.roughness=roughness;material.metalness=metalness;palette[name]=material;
  }
}
function add(root,geo,mat,size=[1,1,1],pos=[0,0,0],rot=[0,0,0]) { const m=new THREE.Mesh(geo,mat);m.scale.set(...size);m.position.set(...pos);m.rotation.set(...rot);m.castShadow=true;root.add(m);return m; }
function mark(root,y,x=0,z=0) { const n=new THREE.Object3D();n.position.set(x,y,z);root.add(n);return n; }
function merge(root,key) {
  const sets=new Map();for(const c of root.children)if(c.isMesh){if(!sets.has(c.material))sets.set(c.material,[]);sets.get(c.material).push(c);}
  let i=0;for(const [mat,meshes]of sets){const k=`merged:${key}:${i++}`;if(meshes.length<2)continue;const geo=cached(k,()=>{const parts=meshes.map(m=>{m.updateMatrix();const g=m.geometry.index?m.geometry.toNonIndexed():m.geometry.clone();g.applyMatrix4(m.matrix);return g;});const merged=mergeGeometries(parts,false);parts.forEach(g=>g.dispose());return merged;});meshes.forEach(m=>root.remove(m));add(root,geo,mat);}
  for(const c of root.children)if(c.isGroup)merge(c,`${key}:${root.children.indexOf(c)}`);
}
export function equipWeapon(rig,id) {
  const def=getWeapon(id); const palette=rig.materials;
  if(!palette)throw new Error('Weapon models require rig.materials');
  if(def.id==='great-dao')ensureGreatDaoMaterials(palette);
  if(def.id==='great-hammer')ensureHammerMaterials(palette);
  rig.weaponId=def.id;rig.weaponDefinition=def;rig.weaponTipNodes=[];rig.weaponArticulation=[];rig.offhandGrip=null;rig.hammerHeadNode=null;rig.weaponBladeFrames=[];rig.reviewedAttackSample=null;
  for(let side=0;side<2;side++) {
    const arm=rig.arms[side];if(!arm.weapon){arm.weapon=new THREE.Group();arm.wrist.add(arm.weapon);}
    const root=arm.weapon;root.clear();root.scale.setScalar(1);root.visible=side===1||def.grip==='dual';root.position.set(0,def.id==='great-hammer'?0:-.029,0);root.rotation.set(0,0,0);
    if(!root.visible)continue;
    const m=(geo,mat,size,pos,rot)=>add(root,geo,palette[mat],size,pos,rot);
    const tip=(y,x=0)=>rig.weaponTipNodes.push(mark(root,y,x));
    const handle=(length=.23)=>{m(rod,'dark',[.035,length,.035],[0,.04,0]);m(rod,'gold',[.048,.035,.048],[0,.04+length/2,0]);};
    const guard=()=>m(box,'gold',[.25,.035,.065],[0,-.075,0]);
    const blade=(geo=dao,length=1,width=1,y=-.1)=>m(geo,'metal',[width,length,1],[0,y,-.017]);
    const id=def.id;
    switch(id) {
      case 'dual-dao':handle();guard();blade(dao,.82,.9);tip(-.92);break;
      case 'tang-dao':
        // A modern long-handle straight dao: two grips fit on the actual hilt.
        m(rod,'dark',[.035,.46,.035],[0,.20,0]);
        m(rod,'gold',[.048,.035,.048],[0,.435,0]);guard();
        blade(tangBlade,1.25,1);m(box,'edge',[.009,1.10,.008],[.05,-.655,.021]);
        m(ring,'gold',[.055,.055,.055],[0,.46,0]);tip(-1.35);break;
      case 'great-dao':
        // A long wrapped grip reads separately from the forged blade, with
        // small copper fittings instead of bright bands along the whole hilt.
        m(rod,'greatLeather',[.038,.45,.038],[0,.165,0]);
        for(let i=0;i<10;i++)m(rod,'greatLeather',[.040,.009,.040],[0,-.01+i*.036,0],[0,Math.PI/6,0]);
        m(rod,'greatSpine',[.048,.040,.048],[0,.406,0]);
        m(rod,'greatCopper',[.045,.018,.045],[0,.383,0]);
        m(rod,'greatSpine',[.039,.034,.039],[0,-.042,0]);
        m(greatDaoGuard,'greatCopper',[1,1,1],[0,-.075,-.04]);
        m(greatDao,'greatSteel',[1,1,1],[0,-.1,-.035]);
        m(greatDaoSpine,'greatSpine',[1,1,1],[0,-.1,-.0425]);
        m(greatDaoFuller,'greatSpine',[1,1,1],[0,-.1,.0355]);
        m(greatDaoFuller,'greatSpine',[1,1,1],[0,-.1,-.0385]);
        m(greatDaoEdge,'greatEdge',[1,1,1],[0,-.1,.0355]);
        m(greatDaoEdge,'greatEdge',[1,1,1],[0,-.1,-.0415]);
        m(box,'greatCopper',[.176,.044,.077],[0,-.125,0]);
        tip(-1.48);break;
      case 'great-hammer': {
        // The near hand controls the long shaft; the support hand holds the
        // wrapped tail. Neither grip intersects a collar or the forged head.
        m(rod,'hammerWood',[.040,1.17,.040],[0,-.225,0]);
        m(rod,'hammerLeather',[.045,.68,.045],[0,-.020,0]);
        for(let i=0;i<24;i++)m(rod,'hammerWrap',[.047,.010,.047],[0,-.326+i*.027,0],[0,(i%2)*Math.PI/6,0]);
        m(rod,'hammerCore',[.056,.038,.056],[0,.341,0]);
        m(rod,'hammerCopper',[.052,.015,.052],[0,.312,0]);
        m(rod,'hammerCore',[.063,.135,.063],[0,-.800,0]);
        m(rod,'hammerCopper',[.066,.030,.066],[0,-.758,0]);
        m(hammerCore,'hammerCore',[1,1,1],[0,-1.02,0]);
        for(const side of [-1,1]) {
          m(hammerFace,'hammerSteel',[1,1,1],[side*.2325,-1.02,0]);
          m(hammerCheek,'hammerCheek',[1,1,1],[0,-1.02,side*.145]);
          // The recessed maker's bar stays within the cheek surface.
          m(box,'hammerCopper',[.027,.105,.004],[0,-1.02,side*.157]);
          m(box,'hammerCore',[.100,.009,.003],[0,-1.048,side*.159]);
        }
        const heel=mark(root,0),head=mark(root,-1.02);
        heel.name='hammer-three-primary-grip';head.name='hammer-three-head-center';
        rig.hammerHeadNode=head;rig.weaponTipNodes.push(head);
        rig.weaponBladeFrames.push({kind:'hammer',hand:side,root,heel,tip:head});
        break;
      }
    }
    if(['dual-dao','tang-dao','great-dao'].includes(id)) {
      const lengths={'dual-dao':.92,'tang-dao':1.35,'great-dao':1.48};
      const heel=mark(root,-.12),tip=mark(root,-lengths[id],0),edge=mark(root,-lengths[id]*.55,.15),face=mark(root,-lengths[id]*.55,0,.15);
      rig.weaponBladeFrames.push({hand:side,root,heel,tip,edge,face});
    }
    if(def.grip==='twohand')rig.offhandGrip=mark(root,id==='great-hammer'?.24:id==='great-dao'?.249:.209);
    merge(root,`${id}:${side}`);
  }
  rig.swords=rig.arms.map(a=>a.weapon);
  rig.weaponBlades=()=>{
    rig.group.updateMatrixWorld(true);
    return rig.weaponBladeFrames.map(b=>{
      const heel=b.heel.getWorldPosition(new THREE.Vector3()),tip=b.tip.getWorldPosition(new THREE.Vector3());
      const quaternion=b.root.getWorldQuaternion(new THREE.Quaternion());
      const frame={hand:b.hand,heel,tip,edge:new THREE.Vector3(1,0,0).applyQuaternion(quaternion),normal:new THREE.Vector3(0,0,1).applyQuaternion(quaternion)};
      if(b.kind==='hammer') {
        const scale=b.root.getWorldScale(new THREE.Vector3());
        const halfExtents=HAMMER_HEAD_HALF_EXTENTS.clone().multiply(new THREE.Vector3(Math.abs(scale.x),Math.abs(scale.y),Math.abs(scale.z)));
        const corners=[];
        for(const x of [-1,1])for(const y of [-1,1])for(const z of [-1,1])corners.push(new THREE.Vector3(x*.26,-1.02+y*.18,z*.17).applyMatrix4(b.root.matrixWorld));
        Object.assign(frame,{kind:'hammer',headCenter:tip.clone(),headQuaternion:quaternion,headHalfExtents:halfExtents,headCorners:corners,headMinY:Math.min(...corners.map(corner=>corner.y)),headRadius:halfExtents.length()});
      }
      return frame;
    });
  };
  return def;
}

// Blades, forged hammer heads and their handles remain rigid while swinging.
export function animateWeaponParts() {}
