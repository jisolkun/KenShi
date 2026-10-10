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
// A compact forged sledge head: squared striking faces have clipped corners,
// and thin copper collars sit between those faces and the darker steel body.
const hammerBody = polygon('great-hammer-body', [[-.23,-.135],[-.20,-.165],[.20,-.165],[.23,-.135],[.23,.135],[.20,.165],[-.20,.165],[-.23,.135]], .33);
const hammerFace = polygon('great-hammer-face', [[-.19,-.15],[-.15,-.19],[.15,-.19],[.19,-.15],[.19,.15],[.15,.19],[-.15,.19],[-.19,.15]], .044);
const hammerHeadHalfExtents = new THREE.Vector3(.27,.19,.19);
const hammerHeadCorners = [-1,1].flatMap(x=>[-1,1].flatMap(y=>[-1,1].map(z=>new THREE.Vector3(x*.27,y*.19,z*.19))));
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
function ensureGreatHammerMaterials(palette) {
  const finishes={
    hammerIron:[0x344650,.54,.72], hammerFace:[0x7a8b97,.38,.74],
    hammerCopper:[0xa27445,.59,.65], hammerGrip:[0x1c252c,.93,.03],
  };
  for(const [name,[color,roughness,metalness]]of Object.entries(finishes))if(!palette[name]) {
    const material=palette.metal.clone();material.name=`great-hammer:${name}`;material.color.setHex(color);material.roughness=roughness;material.metalness=metalness;palette[name]=material;
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
  if(def.id==='great-hammer')ensureGreatHammerMaterials(palette);
  rig.weaponId=def.id;rig.weaponDefinition=def;rig.weaponTipNodes=[];rig.weaponArticulation=[];rig.offhandGrip=null;rig.weaponBladeFrames=[];rig.weaponHeadFrames=[];rig.hammerHead=null;rig.reviewedAttackSample=null;
  for(let side=0;side<2;side++) {
    const arm=rig.arms[side];if(!arm.weapon){arm.weapon=new THREE.Group();arm.wrist.add(arm.weapon);}
    const root=arm.weapon;root.clear();root.scale.setScalar(1);root.visible=side===1||def.grip==='dual';root.position.set(0,-.029,0);root.rotation.set(0,0,0);
    root.headCenter=null;root.headRadius=null;root.headHalfExtents=null;
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
        // The primary wrist, support wrist and forged head share one rigid
        // shaft. The -.029 mount makes the head exactly 1.25m from the wrist.
        const center=-1.221;
        m(rod,'hammerGrip',[.030,.98,.030],[0,-.53,0]);
        m(rod,'hammerGrip',[.037,.374,.037],[0,.112,0]);
        for(let i=0;i<9;i++)m(rod,'hammerGrip',[.039,.010,.039],[0,-.015+i*.036,0],[0,Math.PI/6,0]);
        // The rear cap ends .31m behind the primary wrist: .339 root - .029
        // mount. The support at .22m retains .09m without entering armour.
        m(rod,'hammerIron',[.047,.040,.047],[0,.319,0]);
        for(const y of [-.084,.288])m(rod,'hammerCopper',[.042,.018,.042],[0,y,0]);
        m(rod,'hammerIron',[.062,.18,.062],[0,center+.21,0]);
        m(rod,'hammerCopper',[.066,.016,.066],[0,center+.265,0]);
        m(hammerBody,'hammerIron',[1,1,1],[0,center,-.165]);
        for(const x of [-.27,.226])m(hammerFace,'hammerFace',[1,1,1],[x,center,0],[0,Math.PI/2,0]);
        for(const x of [-.224,.214])m(hammerFace,'hammerCopper',[.94,.94,.01/.044],[x,center,0],[0,Math.PI/2,0]);
        const headCenter=mark(root,center),middle=mark(root,-.871),headTip=mark(root,-1.411),heel=mark(root,-.12);
        headCenter.name='hammer-head-center';middle.name='hammer-shaft-middle';headTip.name='hammer-head-tip';
        headCenter.userData={kind:'hammer',radius:.27,size:[.54,.38,.38]};
        root.headCenter=headCenter;root.headRadius=.27;root.headHalfExtents=hammerHeadHalfExtents.clone();rig.hammerHead=headCenter;rig.weaponTipNodes.push(headTip);
        const frame={hand:side,root,heel,tip:headTip,middle,headCenter,headRadius:.27,headHalfExtents:hammerHeadHalfExtents.clone(),kind:'hammer'};
        rig.weaponBladeFrames.push(frame);rig.weaponHeadFrames.push(frame);
        break;
      }
    }
    if(['dual-dao','tang-dao','great-dao'].includes(id)) {
      const lengths={'dual-dao':.92,'tang-dao':1.35,'great-dao':1.48};
      const heel=mark(root,-.12),tip=mark(root,-lengths[id],0),edge=mark(root,-lengths[id]*.55,.15),face=mark(root,-lengths[id]*.55,0,.15);
      rig.weaponBladeFrames.push({hand:side,root,heel,tip,edge,face});
    }
    if(def.grip==='twohand')rig.offhandGrip=mark(root,['great-dao','great-hammer'].includes(id)?.249:.209);
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
        const headCenter=b.headCenter.getWorldPosition(new THREE.Vector3());
        const headCorners=hammerHeadCorners.map(corner=>corner.clone().add(b.headCenter.position).applyMatrix4(b.root.matrixWorld));
        const bottom=headCorners.reduce((lowest,corner)=>corner.y<lowest.y?corner:lowest),minY=bottom.y,maxY=Math.max(...headCorners.map(corner=>corner.y));
        Object.assign(frame,{kind:'hammer',headCenter,head:headCenter,headRadius:b.headRadius,headHalfExtents:b.headHalfExtents.clone(),headQuaternion:quaternion,middle:b.middle.getWorldPosition(new THREE.Vector3()),headCorners,headBottom:bottom.clone(),headMinY:minY,headMaxY:maxY,headHalfHeight:(maxY-minY)*.5});
      }
      return frame;
    });
  };
  return def;
}

// Retained weapon types have rigid blades and hilts.
export function animateWeaponParts() {}
