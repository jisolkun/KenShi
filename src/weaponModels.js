import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { getWeapon } from './weapons.js';

// Shared geometry owns GPU buffers for the lifetime of the game; switching never disposes it.
const cache = new Map();
const cached = (key, create) => { if (!cache.has(key)) cache.set(key, create()); return cache.get(key); };
const box = cached('box', () => new THREE.BoxGeometry(1,1,1));
const rod = cached('rod', () => new THREE.CylinderGeometry(1,1,1,6));
const ring = cached('ring', () => new THREE.TorusGeometry(1,.17,4,12));
function polygon(key, points) {
  return cached(key, () => { const s=new THREE.Shape(); points.forEach(([x,y],i)=>i?s.lineTo(x,y):s.moveTo(x,y)); s.closePath(); return new THREE.ExtrudeGeometry(s,{depth:.035,bevelEnabled:false,steps:1,curveSegments:1}); });
}
// Straight spine on -X, sharpened edge on +X, with an oblique dao point.
const tangBlade=polygon('tang-single-edge',[[-.065,0],[.055,0],[.055,-.88],[-.035,-1],[-.065,-.94]]);
const dao = polygon('dao', [[-.07,0],[.09,0],[.14,-.58],[.08,-.88],[-.04,-1],[-.07,-.72]]);
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
  rig.weaponId=def.id;rig.weaponDefinition=def;rig.weaponTipNodes=[];rig.weaponArticulation=[];rig.offhandGrip=null;rig.weaponBladeFrames=[];rig.reviewedAttackSample=null;
  for(let side=0;side<2;side++) {
    const arm=rig.arms[side];if(!arm.weapon){arm.weapon=new THREE.Group();arm.wrist.add(arm.weapon);}
    const root=arm.weapon;root.clear();root.scale.setScalar(1);root.visible=side===1||def.grip==='dual';root.position.set(0,-.029,0);root.rotation.set(0,0,0);
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
    }
    if(['dual-dao','tang-dao'].includes(id)) {
      const lengths={'dual-dao':.92,'tang-dao':1.35};
      const heel=mark(root,-.12),tip=mark(root,-lengths[id],0),edge=mark(root,-lengths[id]*.55,.15),face=mark(root,-lengths[id]*.55,0,.15);
      rig.weaponBladeFrames.push({hand:side,root,heel,tip,edge,face});
    }
    if(def.grip==='twohand')rig.offhandGrip=mark(root,.209);
    merge(root,`${id}:${side}`);
  }
  rig.swords=rig.arms.map(a=>a.weapon);
  rig.weaponBlades=()=>{
    rig.group.updateMatrixWorld(true);
    return rig.weaponBladeFrames.map(b=>{
      const heel=b.heel.getWorldPosition(new THREE.Vector3()),tip=b.tip.getWorldPosition(new THREE.Vector3());
      const quaternion=b.root.getWorldQuaternion(new THREE.Quaternion());
      return {hand:b.hand,heel,tip,edge:new THREE.Vector3(1,0,0).applyQuaternion(quaternion),normal:new THREE.Vector3(0,0,1).applyQuaternion(quaternion)};
    });
  };
  return def;
}

// Both retained weapon types have rigid blades and hilts.
export function animateWeaponParts() {}
