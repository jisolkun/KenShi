import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { getWeapon } from './weapons.js';

// Shared geometry owns GPU buffers for the lifetime of the game; switching never disposes it.
const cache = new Map();
const cached = (key, create) => { if (!cache.has(key)) cache.set(key, create()); return cache.get(key); };
const box = cached('box', () => new THREE.BoxGeometry(1,1,1));
const rod = cached('rod', () => new THREE.CylinderGeometry(1,1,1,6));
const ball = cached('ball', () => new THREE.IcosahedronGeometry(1,1));
const point = cached('point', () => new THREE.ConeGeometry(1,1,5));
const ring = cached('ring', () => new THREE.TorusGeometry(1,.17,4,12));
function polygon(key, points) {
  return cached(key, () => { const s=new THREE.Shape(); points.forEach(([x,y],i)=>i?s.lineTo(x,y):s.moveTo(x,y)); s.closePath(); return new THREE.ExtrudeGeometry(s,{depth:.035,bevelEnabled:false,steps:1,curveSegments:1}); });
}
const straight = polygon('straight', [[-.06,0],[.06,0],[.06,-.85],[0,-1],[-.06,-.85]]);
// Straight spine on -X, sharpened edge on +X, with an oblique dao point.
const tangBlade=polygon('tang-single-edge',[[-.065,0],[.055,0],[.055,-.88],[-.035,-1],[-.065,-.94]]);
const yanlingBlade=polygon('yanling-curved-point',[[-.055,0],[.055,0],[.065,-.65],[.10,-.83],[0,-1],[-.04,-.82],[-.055,-.52]]);
const miaoBlade=polygon('miao-long-edge',[[-.052,0],[.054,0],[.06,-.75],[.078,-.91],[0,-1],[-.043,-.90],[-.052,-.68]]);
const ringBlade=polygon('ring-heavy-edge',[[-.07,0],[.105,0],[.18,-.45],[.20,-.70],[.08,-.92],[0,-1],[-.08,-.82],[-.07,-.50]]);
const dao = polygon('dao', [[-.07,0],[.09,0],[.14,-.58],[.08,-.88],[-.04,-1],[-.07,-.72]]);
const crescent = polygon('crescent', [[-.04,0],[.12,-.05],[.34,-.24],[.4,-.55],[.25,-.85],[-.08,-1],[.10,-.69],[.15,-.4],[.06,-.2]]);
const axe = polygon('axe', [[0,.12],[.38,.20],[.49,.08],[.49,-.3],[.35,-.44],[0,-.27]]);
const hook = polygon('hook', [[-.045,0],[.045,0],[.045,-.72],[.24,-.76],[.27,-.6],[.34,-.65],[.33,-.9],[.18,-.98],[-.045,-.88]]);
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
    const shaft=(length=1.5)=>{m(rod,'dark',[.034,length,.034],[0,.3-length/2,0]);m(rod,'gold',[.043,.06,.043],[0,.28,0]);};
    const spike=(y,length=.36,x=0)=>m(point,'metal',[.085,length,.06],[x,y-length/2,0],[0,0,Math.PI]);
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
      case 'yanling-dao':handle();guard();blade(yanlingBlade,1,1);tip(-1.1);break;
      case 'miao-dao':handle(.47);guard();blade(miaoBlade,1.4,1);tip(-1.5);break;
      case 'ring-dao': {
        handle(.48);guard();blade(ringBlade,1.18,1.7);
        for(let j=0;j<9;j++){
          const node=new THREE.Group();node.position.set(-.15,-.17-j*.095,.035);root.add(node);
          add(node,ring,palette.gold,[.043,.043,.043],[-.048,0,0]);
          rig.weaponArticulation.push({node,index:j,side,kind:'blade-ring',initialized:false});
        }
        tip(-1.28);break;
      }
      case 'pu-dao':shaft(1.15);blade(dao,.87,1.25,-.88);tip(-1.75);break;
      case 'longquan-jian':handle(.25);guard();blade(straight,1.1,1);m(box,'gold',[.014,.82,.025],[0,-.52,.025]);tip(-1.2);break;
      case 'dual-jian':handle();guard();blade(straight,.88,.85);tip(-.98);break;
      case 'guandao':shaft(1.65);blade(crescent,1,1,-1.26);m(point,'gold',[.06,.25,.05],[-.02,-1.12,0],[0,0,Math.PI]);tip(-2.26,.13);break;
      case 'qiang':shaft(1.95);spike(-1.65,.42);for(let j=0;j<7;j++)m(point,'sash',[.025,.34,.026],[(j-3)*.023,-1.48,.02],[0,0,(j-3)*.12]);tip(-2.07);break;
      case 'shemao':shaft(1.75);blade(polygon('snake',[[-.045,0],[.1,-.12],[-.015,-.24],[.10,-.36],[.015,-.6],[-.05,-.42],[-.11,-.3],[.015,-.16]]),1.1,1,-1.45);tip(-2.11);break;
      case 'fangtian-ji':shaft(1.65);spike(-1.35,.64);for(const s of [-1,1])m(crescent,'metal',[s*.65,.55,1],[s*.08,-1.38,-.017]);tip(-1.99);break;
      case 'dual-ji':handle(.32);spike(-.14,.66);for(const s of [-1,1])m(crescent,'metal',[s*.46,.46,1],[s*.05,-.27,-.017]);tip(-.8);break;
      case 'staff':shaft(1.85);m(rod,'gold',[.045,.14,.045],[0,-1.47,0]);m(rod,'gold',[.045,.14,.045],[0,.23,0]);tip(-1.55);tip(.3);break;
      case 'iron-whip':handle();guard();m(rod,'metal',[.044,.8,.044],[0,-.5,0]);for(let j=0;j<7;j++)m(box,'gold',[.105,.055,.09],[0,-.17-j*.1,0]);tip(-.9);break;
      case 'dual-jian-maces':handle();guard();m(box,'metal',[.085,.87,.085],[0,-.535,0]);m(point,'gold',[.065,.13,.065],[0,-.99,0],[0,0,Math.PI]);tip(-1.055);break;
      case 'wolf-club':shaft(1.15);m(ball,'metal',[.22,.42,.22],[0,-1.13,0]);for(let j=0;j<12;j++){const a=j*Math.PI/3;const y=-.89-Math.floor(j/6)*.36;m(point,'metal',[.065,.23,.065],[Math.cos(a)*.23,y,Math.sin(a)*.23],[Math.sin(a)*Math.PI/2,0,-Math.cos(a)*Math.PI/2]);}tip(-1.65);break;
      case 'dual-axes':handle(.6);blade(axe,1,1,-.5);m(point,'metal',[.065,.2,.06],[-.15,-.55,0],[0,0,-Math.PI/2]);tip(-.94,.42);break;
      case 'war-hammer':shaft(1.05);m(box,'metal',[.62,.34,.3],[0,-.83,0]);m(box,'gold',[.13,.4,.34],[0,-.83,0]);tip(-1.04);break;
      case 'hook-swords':handle();blade(hook,1,1);m(ring,'gold',[.18,.22,.12],[0,-.04,0]);spike(.12,.18);tip(-.98,.18);break;
      case 'emei-piercers':m(rod,'metal',[.023,.53,.023],[0,-.09,0]);spike(-.355,.16);m(point,'metal',[.045,.16,.035],[0,.255,0]);m(ring,'gold',[.055,.055,.055],[0,0,.02]);tip(-.515);tip(.335);break;
      case 'mandarin-yue':handle(.18);for(const s of [-1,1]){m(crescent,'metal',[s*.65,.6,1],[s*-.08,.25,-.017],[0,0,s*.36]);}tip(-.4,.2);break;
      case 'judge-brush':handle(.2);m(rod,'gold',[.055,.32,.055],[0,-.2,0]);spike(-.36,.23);m(ball,'gold',[.065,.075,.065],[0,.18,0]);tip(-.59);break;
      case 'battle-yue':shaft(1.3);blade(axe,1.35,1.45,-.84);m(point,'metal',[.09,.35,.08],[-.19,-.97,0],[0,0,-Math.PI/2]);tip(-1.43,.62);break;
      case 'three-section-staff':case 'nine-section-whip':case 'meteor-hammer': {
        handle(.22);const count=id==='three-section-staff'?3:id==='nine-section-whip'?9:10;
        let parent=root;for(let j=0;j<count;j++){const node=new THREE.Group();node.position.y=j===0?-.10:id==='three-section-staff'?-.52:-.16;parent.add(node);const len=id==='three-section-staff'?.47:.14;
          add(node,id==='three-section-staff'?rod:ring,palette[id==='three-section-staff'?'dark':'metal'],id==='three-section-staff'?[.032,len,.032]:[.037,.072,.037],[0,-len/2,0]);
          if(id==='three-section-staff')add(node,rod,palette.gold,[.04,.045,.04],[0,-len,0]);
          rig.weaponArticulation.push({node,index:j,side});parent=node;
        }
        if(id==='meteor-hammer'){add(parent,ball,palette.metal,[.21,.21,.21],[0,-.28,0]);for(let j=0;j<5;j++)add(parent,point,palette.gold,[.045,.13,.045],[Math.sin(j*1.26)*.22,-.28+Math.cos(j*1.26)*.22,0],[0,0,-j*1.26]);rig.weaponTipNodes.push(mark(parent,-.49));}
        else if(id==='nine-section-whip'){add(parent,point,palette.metal,[.045,.22,.045],[0,-.22,0],[0,0,Math.PI]);rig.weaponTipNodes.push(mark(parent,-.33));}
        else rig.weaponTipNodes.push(mark(parent,-.47));break;
      }
    }
    if(['dual-dao','tang-dao','yanling-dao','miao-dao','ring-dao'].includes(id)) {
      const lengths={'dual-dao':.92,'tang-dao':1.35,'yanling-dao':1.1,'miao-dao':1.5,'ring-dao':1.28};
      const heel=mark(root,-.12),tip=mark(root,-lengths[id]),edge=mark(root,-lengths[id]*.55,.15),face=mark(root,-lengths[id]*.55,0,.15);
      rig.weaponBladeFrames.push({hand:side,root,heel,tip,edge,face});
    }
    if(def.grip==='twohand')rig.offhandGrip=mark(root,id==='tang-dao'?.39:.25);
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

export function animateWeaponParts(rig,pose={}) {
  const time=pose.time||0;const phase=pose.phase||0;const attack=pose.state==='attack'||pose.state==='skill'||pose.attacking;
  const energy=attack?1:.18;
  if(rig.weaponId==='ring-dao') {
    rig.group.updateMatrixWorld(true);
    const rotation=rig.arms[1].weapon.getWorldQuaternion(new THREE.Quaternion()).invert();
    const gravity=new THREE.Vector3(0,-1,0).applyQuaternion(rotation);
    // Keep rings outside the spine. Their gravity bias follows the world;
    // staggered damping gives the loose fittings a short lag behind the blade.
    gravity.x=-Math.max(.8,Math.abs(gravity.x));gravity.normalize();
    const target=new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(-1,0,0),gravity);
    for(const part of rig.weaponArticulation){
      if(!part.initialized){part.node.quaternion.copy(target);part.initialized=true;}
      else part.node.quaternion.slerp(target,1-Math.exp(-Math.max(0,pose.dt??1/60)*(12-part.index*.35)));
    }
    return;
  }
  for(const part of rig.weaponArticulation||[]){const {node,index}=part;
    if(rig.weaponId==='three-section-staff'){node.rotation.set(Math.sin(time*6-index*.8)*.12*energy,0,Math.sin(phase*Math.PI*2-index*.9+time*.8)*.65*energy);}
    else if(rig.weaponId==='nine-section-whip'){node.rotation.set(Math.cos(time*9-index*.5)*.18*energy,0,Math.sin(time*11-index*.64+phase*4)*.31*energy);}
    else {node.rotation.set(Math.sin(time*4-index*.4)*.09*energy,0,Math.sin(time*7-index*.35+phase*6)*.2*energy);}
  }
}
