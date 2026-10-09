import * as THREE from 'three';
import { equipWeapon } from './weaponModels.js';
import { DEFAULT_WEAPON_ID } from './weapons.js';
import { applyWeaponPose, reconcileWeaponGrip, reconcileAttackFootwork } from './weaponMotion.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

// All body parts share geometry; each character owns its palette for hit flashes.
const geometries = new Map();
let characterSerial = 0;
const geometry = (key, create) => {
  if (!geometries.has(key)) geometries.set(key, create());
  return geometries.get(key);
};
const box = geometry('box', () => new THREE.BoxGeometry(1, 1, 1));
const orb = geometry('orb', () => new THREE.IcosahedronGeometry(1, 0));
const cylinder = geometry('cylinder', () => new THREE.CylinderGeometry(1, 1, 1, 6));
const cone = geometry('cone', () => new THREE.ConeGeometry(1, 1, 5));
const sphere = geometry('sphere', () => new THREE.SphereGeometry(1, 7, 4));

function mergeStaticParts(root, type, palette) {
  const materialKeys = new Map(Object.entries(palette).map(([key, value]) => [value, key]));
  const jobs = [];
  // Record paths before replacing meshes so the cache keys match every instance.
  function collect(parent, path) {
    const byMaterial = new Map();
    parent.children.forEach((child, index) => {
      if (child.isMesh) {
        if (!byMaterial.has(child.material)) byMaterial.set(child.material, []);
        byMaterial.get(child.material).push(child);
      } else if (child.isGroup) collect(child, `${path}/${index}`);
    });
    for (const [mat, parts] of byMaterial) {
      if (parts.length > 1) jobs.push({ parent, parts, key: `joined:${type}:${path}:${materialKeys.get(mat)}` });
    }
  }
  collect(root, 'root');
  for (const { parent, parts, key } of jobs) {
    const merged = geometry(key, () => {
      const pieces = parts.map(part => {
        part.updateMatrix();
        const source = part.geometry;
        const piece = source.index ? source.toNonIndexed() : source.clone();
        piece.applyMatrix4(part.matrix);
        // Cloth has no UVs; retaining a common layout makes merging deterministic.
        for (const name of Object.keys(piece.attributes)) {
          if (!['position', 'normal', 'uv'].includes(name)) piece.deleteAttribute(name);
        }
        if (!piece.attributes.normal) piece.computeVertexNormals();
        if (!piece.attributes.uv) piece.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(piece.attributes.position.count * 2), 2));
        return piece;
      });
      const result = mergeGeometries(pieces, false);
      for (const piece of pieces) piece.dispose();
      if (!result) throw new Error(`Cannot merge character geometry: ${key}`);
      return result;
    });
    // Keep the original mesh and every animated Group/Object3D in place.
    const first = parts[0];
    first.geometry = merged;
    first.position.set(0, 0, 0);
    first.rotation.set(0, 0, 0);
    first.scale.set(1, 1, 1);
    first.updateMatrix();
    for (let i = 1; i < parts.length; i++) parent.remove(parts[i]);
  }
}

function bladeGeometry() {
  const shape = new THREE.Shape();
  shape.moveTo(-.086, -.10);
  shape.lineTo(.086, -.10);
  shape.lineTo(.115, -.50);
  shape.lineTo(.072, -.78);
  shape.lineTo(0, -.99);
  shape.lineTo(-.059, -.81);
  shape.lineTo(-.096, -.49);
  shape.closePath();
  return new THREE.ExtrudeGeometry(shape, {depth: .035, bevelEnabled: true, bevelSegments: 1, steps: 1, bevelSize: .012, bevelThickness: .009, curveSegments: 1});
}
const swordGeometry = geometry('sword', bladeGeometry);
const clothGeometry = geometry('cloth', () => {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute([
    -.12, 0, 0, .12, 0, 0, -.14, -.29, .045,
    .12, 0, 0, .14, -.29, .045, -.14, -.29, .045,
    -.14, -.29, .045, .14, -.29, .045, .035, -.51, .09,
    -.14, -.29, .045, .035, -.51, .09, -.10, -.47, .075,
  ], 3));
  g.computeVertexNormals();
  return g;
});

const palettes = {
  hero: {skin: 0xc4a078, dark: 0x111c24, armor: 0x234751, edge: 0x6caaa4, cloth: 0x152a42, sash: 0xb94137, metal: 0xe8eef0, gold: 0xc49c50, eyes: 0xf4e1b8},
  grunt: {skin: 0x748d83, dark: 0x202b2a, armor: 0x394a4c, edge: 0x687a71, cloth: 0x4f5144, sash: 0x74513f, metal: 0xa0b9ba, gold: 0x6f796b, eyes: 0xa6ec98},
  brute: {skin: 0x8b9280, dark: 0x282321, armor: 0x4b4540, edge: 0x887c66, cloth: 0x554238, sash: 0x9c5942, metal: 0x9fa49a, gold: 0x967c49, eyes: 0xffa577},
  archer: {skin: 0x7a9689, dark: 0x1b2d2c, armor: 0x30453d, edge: 0x79907b, cloth: 0x334337, sash: 0x9e7942, metal: 0xc0c9b7, gold: 0xa18a50, eyes: 0xb2e8a6},
  boss: {skin: 0xaaa097, dark: 0x17141c, armor: 0x292732, edge: 0x71635d, cloth: 0x581f2c, sash: 0xb44236, metal: 0xcbd0d4, gold: 0xb2945d, eyes: 0xff7362},
};

export function createCharacter(type = 'hero') {
  if (!palettes[type]) type = 'grunt';
  const colors = palettes[type];
  const material = {};
  for (const [key, color] of Object.entries(colors)) material[key] = new THREE.MeshStandardMaterial({color, roughness: key === 'metal' ? .29 : .78, metalness: key === 'metal' ? .7 : key === 'gold' ? .6 : .08, flatShading: true, side: THREE.DoubleSide});
  const group = new THREE.Group();
  group.name = `character-${type}`;
  const body = new THREE.Group();
  body.position.y = .91;
  group.add(body);
  const nodes = [];
  function joint(parent, name, x = 0, y = 0, z = 0) {
    const node = new THREE.Group();
    node.name = name;
    node.position.set(x, y, z);
    parent.add(node);
    nodes.push(node);
    return node;
  }
  function mesh(parent, geo, mat, size, pos = [0,0,0], rotation = [0,0,0]) {
    const m = new THREE.Mesh(geo, material[mat]);
    m.scale.set(...size);
    m.position.set(...pos);
    m.rotation.set(...rotation);
    m.castShadow = true;
    m.receiveShadow = true;
    parent.add(m);
    return m;
  }
  const heavy = type === 'brute';
  const boss = type === 'boss';
  const hero = type === 'hero';
  const narrow = type === 'archer';
  const width = heavy ? 1.31 : narrow ? .84 : 1;
  // Pelvis and a separate chest make coiling and counter-rotation visible.
  mesh(body, orb, 'dark', [.245 * width, .18, .165], [0,.02,0]);
  mesh(body, cylinder, 'sash', [.25 * width, .115, .17], [0,.06,.008], [0,Math.PI / 6,0]);
  mesh(body, box, 'gold', [.105,.095,.026], [0,.064,.185]);
  const chest = joint(body, 'chest', 0,.15,0);
  mesh(chest, orb, 'cloth', [.30 * width,.33,.185], [0,.22,0]);
  mesh(chest, cylinder, 'armor', [.272 * width,.37,.185], [0,.23,.015], [0,Math.PI / 6,0]);
  mesh(chest, box, 'edge', [.14,.21,.035], [-.145 * width,.27,.178], [0,0,-.14]);
  mesh(chest, box, 'armor', [.14,.20,.045], [.145 * width,.27,.185], [0,0,.14]);
  for (let i = 0; i < 3; i++) {
    mesh(chest, box, 'gold', [.28 * width,.012,.024], [0,.15 + i*.065,.205]);
    mesh(body, box, 'armor', [.19,.09,.042], [-.16,.005-i*.075,.178], [0,0,-.10]);
    mesh(body, box, 'armor', [.19,.09,.042], [.16,.005-i*.075,.178], [0,0,.10]);
  }
  mesh(chest, box, 'gold', [.045,.35,.028], [-.17 * width,.25,.22], [0,0,-.44]);
  const head = joint(chest, 'head', 0,.48,.008);
  mesh(head, cylinder, 'skin', [.065,.115,.067], [0,-.015,0]);
  mesh(head, orb, 'skin', [.165,.219,.156], [0,.11,.025]);
  mesh(head, orb, 'skin', [.115,.094,.09], [0,-.007,.078]);
  mesh(head, cone, 'skin', [.025,.067,.041], [0,.095,.176], [Math.PI/2,0,0]);
  mesh(head, orb, 'skin', [.042,.061,.025], [-.168,.11,.02]);
  mesh(head, orb, 'skin', [.042,.061,.025], [.168,.11,.02]);
  for (const side of [-1,1]) {
    mesh(head, box, 'dark', [.065,.014,.016], [side*.073,.167,.157], [0,0,side*-.1]);
    mesh(head, box, 'eyes', [.021,.015,.013], [side*.071,.143,.165]);
  }
  if (hero) {
    mesh(head, box, 'dark', [.088,.062,.023], [-.079,.139,.171], [0,0,-.10]);
    mesh(head, box, 'dark', [.31,.019,.025], [0,.176,.109], [0,0,.1]);
    mesh(head, orb, 'dark', [.09,.05,.085], [0,-.022,.085]);
  }
  mesh(head, sphere, 'dark', [.176,.115,.17], [0,.264,.004]);
  const pony = joint(head, 'ponytail', 0,.30,-.08);
  if (hero || boss) {
    mesh(pony, orb, 'dark', [.075,.086,.07], [0,0,0]);
    mesh(pony, cylinder, 'gold', [.073,.031,.07], [0,-.022,0]);
    mesh(pony, cone, 'dark', [.072,.35,.075], [0,-.13,-.12], [.52,0,Math.PI]);
    mesh(pony, cone, 'dark', [.046,.26,.049], [0,-.30,-.19], [.30,0,Math.PI]);
  } else if (narrow) {
    mesh(head, orb, 'cloth', [.19,.235,.19], [0,.16,-.07]);
    mesh(head, box, 'cloth', [.06,.27,.14], [-.163,.13,.05]);
    mesh(head, box, 'cloth', [.06,.27,.14], [.163,.13,.05]);
  } else {
    mesh(head, cylinder, 'armor', [.175,.12,.175], [0,.27,0], [0,Math.PI/6,0]);
    mesh(head, box, 'edge', [.28,.027,.03], [0,.255,.166]);
  }
  if (boss) {
    mesh(head, orb, 'armor', [.205,.21,.19], [0,.25,-.005]);
    mesh(head, box, 'gold', [.032,.27,.032], [0,.31,.19]);
    for (const side of [-1,1]) {
      mesh(head, cone, 'gold', [.064,.32,.065], [side*.22,.36,0], [0,0,-side*.65]);
      mesh(head, box, 'armor', [.09,.22,.09], [side*.18,.1,-.015]);
    }
  }
  const legs = [];
  const arms = [];
  for (const side of [-1,1]) {
    const hip = joint(body, `${side === -1 ? 'left' : 'right'}-hip`, side*.155 * width, -.035,0);
    hip.rotation.order = 'YXZ';
    mesh(hip, cylinder, 'cloth', [.098,.42,.10], [0,-.205,0]);
    mesh(hip, box, 'armor', [.135,.26,.10], [0,-.17,.076], [0,0,side*.045]);
    const knee = joint(hip, 'knee', 0,-.41,0);
    mesh(knee, orb, 'edge', [.094,.095,.09], [0,0,.045]);
    mesh(knee, cylinder, 'dark', [.081,.38,.075], [0,-.19,0]);
    mesh(knee, box, 'armor', [.102,.255,.06], [0,-.16,.061]);
    for (let n=0;n<2;n++) mesh(knee, box, 'gold', [.115,.024,.021], [0,-.09-n*.115,.094]);
    const foot = joint(knee, 'foot', 0,-.395,.016);
    mesh(foot, box, 'dark', [.14,.105,.27], [0,-.016,.063]);
    mesh(foot, box, 'edge', [.143,.033,.11], [0,.016,.131]);
    legs.push({hip,knee,foot,side});
    const shoulder = joint(chest, `${side === -1 ? 'left' : 'right'}-shoulder`, side*.29 * width,.365,0);
    mesh(shoulder, orb, 'armor', [heavy ? .21 : .16,heavy ? .18 : .125,.175], [side*.025,-.036,0]);
    mesh(shoulder, box, 'edge', [.17,.035,.20], [side*.045,.045,.016], [0,0,side*-.14]);
    mesh(shoulder, cylinder, 'cloth', [.066,.29,.068], [0,-.15,0]);
    const elbow = joint(shoulder, 'elbow', 0,-.29,0);
    mesh(elbow, orb, 'dark', [.074,.075,.07]);
    mesh(elbow, cylinder, 'skin', [.058,.255,.057], [0,-.126,0]);
    mesh(elbow, box, 'armor', [.09,.17,.074], [0,-.135,.019]);
    mesh(elbow, cylinder, 'gold', [.068,.032,.068], [0,-.235,0]);
    const wrist = joint(elbow, 'wrist', 0,-.27,0);
    mesh(wrist, orb, 'dark', [.067,.075,.063], [0,-.029,0]);
    arms.push({shoulder,elbow,wrist,side});
  }
  const cloths = [];
  const sash = joint(body, 'sash-tail', -.11,.048,-.135);
  mesh(sash, clothGeometry, 'sash', [.67,1.25,1], [0,0,0], [.08,0,.17]);
  cloths.push(sash);
  const cape = joint(chest, 'cape', 0,.415,-.15);
  mesh(cape, clothGeometry, hero ? 'cloth' : 'sash', [boss ? 2.8 : 1.8,boss ? 1.8 : 1.15,1], [0,0,0], [-.13,0,0]);
  cloths.push(cape);
  const tips = [];
  function sword(parent, multiplier = 1) {
    const weapon = joint(parent, 'sword');
    weapon.scale.setScalar(multiplier);
    mesh(weapon, cylinder, 'dark', [.031,.18,.031], [0,.024,0]);
    mesh(weapon, cylinder, 'gold', [.041,.028,.042], [0,.113,0]);
    mesh(weapon, box, 'gold', [.275,.045,.084], [0,-.069,0]);
    mesh(weapon, swordGeometry, 'metal', [1,1,1], [0,0,-.018]);
    mesh(weapon, box, 'gold', [.018,.55,.015], [-.084,-.385,.031], [0,0,-.019]);
    mesh(weapon, box, 'edge', [.014,.51,.015], [.021,-.375,.036]);
    const tip = new THREE.Object3D();
    tip.position.set(0,-.99,0);
    weapon.add(tip);
    tips.push(tip);
    return weapon;
  }
  let bow = null;
  if (hero) {
    arms[0].weapon=sword(arms[0].wrist,.84);
    arms[1].weapon=sword(arms[1].wrist,.9);
  } else if (heavy) {
    const hammer = joint(arms[1].wrist,'hammer');
    mesh(hammer,cylinder,'dark',[.042,.85,.042],[0,-.35,0]);
    mesh(hammer,cylinder,'gold',[.052,.033,.052],[0,-.07,0]);
    mesh(hammer,box,'metal',[.37,.23,.24],[0,-.81,0]);
    mesh(hammer,orb,'armor',[.27,.17,.17],[0,-.81,0]);
    for(const side of [-1,1]) mesh(hammer,cone,'metal',[.07,.20,.07],[side*.245,-.81,0],[0,0,side*-Math.PI/2]);
    const tip = new THREE.Object3D(); tip.position.set(0,-.82,0); hammer.add(tip); tips.push(tip);
  } else if (narrow) {
    bow = joint(arms[0].wrist,'bow');
    // Six actual curved stave sections and a taut string, all visible without textures.
    const points = [[0,-.48,0],[-.10,-.33,0],[-.145,-.14,0],[-.145,.14,0],[-.10,.33,0],[0,.48,0]];
    const staveMat = material.gold;
    for(let i=0;i<points.length-1;i++) {
      const a = new THREE.Vector3(...points[i]), b = new THREE.Vector3(...points[i+1]);
      const segment = new THREE.Mesh(cylinder,staveMat);
      segment.scale.set(.023,a.distanceTo(b),.023);
      segment.position.copy(a).add(b).multiplyScalar(.5);
      segment.quaternion.setFromUnitVectors(new THREE.Vector3(0,1,0),b.sub(a).normalize());
      bow.add(segment); segment.castShadow=true;
    }
    mesh(bow,cylinder,'cloth',[.007,.96,.007]);
    mesh(bow,cylinder,'dark',[.035,.17,.035],[-.14,0,0]);
    const arrow = joint(arms[1].wrist,'arrow');
    mesh(arrow,cylinder,'gold',[.009,.68,.009],[0,0,.23],[Math.PI/2,0,0]);
    mesh(arrow,cone,'metal',[.029,.095,.029],[0,0,.61],[Math.PI/2,0,0]);
    mesh(arrow,box,'cloth',[.055,.005,.09],[0,0,-.08]);
    const tip=new THREE.Object3D();tip.position.z=.65;arrow.add(tip);tips.push(tip);
    const quiver=joint(chest,'quiver',.13,.19,-.2);quiver.rotation.z=-.27;
    mesh(quiver,cylinder,'dark',[.085,.45,.085],[0,0,0]);
    for(let i=0;i<4;i++){
      const x=(i%2-.5)*.045,z=(Math.floor(i/2)-.5)*.045;
      mesh(quiver,cylinder,'gold',[.008,.26,.008],[x,.27,z]);
      mesh(quiver,box,'cloth',[.042,.069,.008],[x,.395,z]);
    }
  } else sword(arms[1].wrist,boss ? 1.30 : .87);
  if (heavy) for(const side of [-1,1]) mesh(arms[side===-1?0:1].shoulder,cone,'metal',[.06,.16,.07],[side*.06,.15,-.035],[0,0,-side*.35]);
  mergeStaticParts(group, type, material);
  // Only the hero's rib armour expands. Head, shoulder joints and cape retain
  // their own anchors, so breathing never scales limbs or weapon reach.
  let ribcage = null;
  if(hero){
    const shell=chest.children.filter(child=>child.isMesh);
    ribcage=joint(chest,'ribcage',0,.22,0);
    for(const part of shell){chest.remove(part);part.position.y-=.22;ribcage.add(part);}
  }
  const scale = hero ? 1 : type === 'grunt' ? .90 : narrow ? .9 : heavy ? 1.23 : 1.66;
  group.scale.setScalar(scale);
  // Keep a bind pose per joint. Every update is absolute, so interrupted moves cannot leak.
  const resetNodes = [body,...nodes];
  const bind = resetNodes.map(n => ({node:n, p:n.position.clone(),r:n.rotation.clone(),s:n.scale.clone()}));
  const rig = {
    type, group, body, chest, ribcage, head, pony, legs, arms, cloths, bow, bind, materials: material,
    swords: hero ? arms.map(arm=>arm.weapon) : [],
    idleOffset: (characterSerial++ * 2.3999632297) % TAU,
    weaponTips() { group.updateMatrixWorld(true); return (rig.weaponTipNodes ?? tips).map(t => t.getWorldPosition(new THREE.Vector3())); },
    setWeapon(id = DEFAULT_WEAPON_ID) {
      if(type !== 'hero')return;
      equipWeapon(rig,id);
      for(const binding of bind){
        if(arms.some(arm => arm.weapon === binding.node)){
          binding.p.copy(binding.node.position);binding.r.copy(binding.node.rotation);binding.s.copy(binding.node.scale);
        }
      }
      rig.motion = undefined;
      poseCharacter(rig,{state:'idle',time:0,phase:0,immediate:true});
    },
    setFlash(amount) {
      const value = THREE.MathUtils.clamp(amount,0,1);
      for (const m of Object.values(material)) { m.emissive.setRGB(value*.82,value*.86,value*.9); m.emissiveIntensity = 1; }
    },
  };
  if(hero)rig.setWeapon(DEFAULT_WEAPON_ID);
  else poseCharacter(rig,{state:'idle',time:0,phase:0});
  return rig;
}

const TAU = Math.PI*2;
const clamp = THREE.MathUtils.clamp;
const mix = THREE.MathUtils.lerp;
const smooth = t => {t=clamp(t,0,1);return t*t*(3-2*t);};
const pulse = (p,start,end) => Math.sin(Math.PI*clamp((p-start)/(end-start),0,1));
function sample(p, keys) {
  for(let i=1;i<keys.length;i++) if(p<=keys[i][0]) {
    const a=keys[i-1],b=keys[i];return mix(a[1],b[1],smooth((p-a[0])/(b[0]-a[0])));
  }
  return keys[keys.length-1][1];
}

export function poseCharacter(rig, {state='idle',time=0,phase=0,combo=0,speed=1,skill=0,dt,
  gaitPhase,moveBlend,turnLean=0,attackCarry=0,attackStep=null,hurtDirection=1,hurtStrength=1,transition=true,immediate=false,
  alertness=.35,idleAge,lookYaw} = {}) {
  if(dt===0&&!immediate&&transition!==false&&rig.motion)return;
  const {body,chest,head,arms,legs,pony,cloths,type} = rig;
  const motion = rig.motion ??= {
    key: null, phase: 0, lastTime: time, gait: 0, move: 0, pace: 0, drive: 0, armDrive: 0,
    idleClock: time+rig.idleOffset, idleAge: 0, idleLayer: 0, lookYaw: 0,
    elapsed: 1, duration: .08, targetQ: new THREE.Quaternion(),
    idleQ: new THREE.Quaternion(), idleBendQ: new THREE.Quaternion(), idleFootQ: new THREE.Quaternion(),
    idleRootQ: new THREE.Quaternion(), idleTarget: new THREE.Vector3(),
    secondary: [pony,...cloths].map(node=>({node,x:node.rotation.x,z:node.rotation.z,vx:0,vz:0})),
    from: rig.bind.map(({node}) => ({p:node.position.clone(),q:node.quaternion.clone(),s:node.scale.clone()})),
  };
  const delta=clamp(dt ?? (time>motion.lastTime ? time-motion.lastTime : 1/60),0,.05);
  const locomotion=state==='idle'||state==='run';
  const key=locomotion?'locomotion':`${state}:${state==='attack'?combo:state==='skill'?skill:0}`;
  const restarted=!locomotion && phase<motion.phase-.2;
  const stepping=rig.weaponId==='great-dao'&&state==='attack'&&attackStep;
  const footworkChanged=rig.weaponId==='great-dao'&&Boolean(motion.stepActive)!==Boolean(stepping);
  if(motion.key!==null && (key!==motion.key||restarted||footworkChanged)) {
    if(['tang-dao','great-dao'].includes(rig.weaponId)){
      rig.group.updateMatrixWorld(true);
      const groupQ=rig.group.getWorldQuaternion(new THREE.Quaternion());
      motion.shaftFrom={point:rig.group.worldToLocal(rig.arms[1].wrist.getWorldPosition(new THREE.Vector3())),quaternion:groupQ.invert().multiply(rig.arms[1].wrist.getWorldQuaternion(new THREE.Quaternion()))};
      if(rig.weaponId==='great-dao')motion.feetFrom=rig.legs.map((leg,index)=>rig.group.worldToLocal(
        footworkChanged&&!stepping&&rig.attackFootTargets?rig.attackFootTargets[index].point.clone():leg.foot.getWorldPosition(new THREE.Vector3())));
      if(footworkChanged&&!stepping&&rig.attackFootTargets)motion.footRotationsFrom=rig.attackFootTargets.map(foot=>foot.rotation.clone());
    }
    rig.bind.forEach(({node},i)=>{motion.from[i].p.copy(node.position);motion.from[i].q.copy(node.quaternion);motion.from[i].s.copy(node.scale);});
    motion.elapsed=0;
    motion.duration=state==='hurt'?.04:state==='roll'?.06:.08;
    motion.footworkBlend=footworkChanged&&key===motion.key&&!restarted;
    if(motion.footworkBlend)motion.duration=.10;
  } else motion.elapsed+=delta;
  motion.gait+=locomotion?delta*clamp(speed,0,1)*12:0;
  motion.move=mix(motion.move,state==='run'?1:0,1-Math.exp(-delta/.075));
  const movement=clamp(moveBlend??motion.move,0,1);
  const gait=gaitPhase??motion.gait;
  if(type==='hero'){
    const pace=locomotion?clamp(speed,0,1)*smooth(movement/.2):0;
    const drive=locomotion&&delta>0?clamp((pace-motion.pace)/(delta*8),-1,1):0;
    motion.drive=mix(motion.drive,drive,1-Math.exp(-delta/.10));
    motion.armDrive=mix(motion.armDrive,motion.drive,1-Math.exp(-delta/.075));
    motion.pace=pace;
  }
  motion.idleClock=immediate||transition===false ? time+rig.idleOffset : motion.idleClock+delta;
  motion.idleAge=idleAge??(locomotion&&movement<.12 ? motion.idleAge+delta : Math.max(0,motion.idleAge-delta*5));
  const idleGoal=locomotion&&movement<.2?smooth(motion.idleAge/.32):0;
  motion.idleLayer=immediate||transition===false?idleGoal:mix(motion.idleLayer,idleGoal,1-Math.exp(-delta/.12));
  if(lookYaw!==undefined)motion.lookYaw=immediate||transition===false?clamp(lookYaw,-.55,.55):mix(motion.lookYaw,clamp(lookYaw,-.55,.55),1-Math.exp(-delta/.18));
  for(const {node,p,r,s} of rig.bind) {node.position.copy(p);node.rotation.copy(r);node.scale.copy(s);}
  const p=clamp(phase,0,1), hero=type==='hero', heavy=type==='brute', boss=type==='boss', archer=type==='archer';
  const L=arms[0],R=arms[1],LL=legs[0],RL=legs[1];
  const breath=Math.sin(time*2.3);
  body.position.y += breath*.009;
  chest.rotation.x=-.08;
  chest.rotation.y=-.07;
  head.rotation.x=.045;
  // An asymmetrical, low guard: bent knees, right blade ready, left near the hip.
  for(const leg of legs){leg.hip.rotation.x=-.15;leg.knee.rotation.x=.28;leg.foot.rotation.x=-.13;}
  L.shoulder.rotation.set(.10,.12,-.22);
  L.elbow.rotation.x=-.62;
  L.wrist.rotation.set(.19,-.18,-.14);
  R.shoulder.rotation.set(-.30,-.21,.21);
  R.elbow.rotation.x=-1.06;
  R.wrist.rotation.set(-.22,.20,.10);
  if(!hero){L.elbow.rotation.x=-.40;R.elbow.rotation.x=-.72;}
  if(heavy){R.shoulder.rotation.x=.45;R.elbow.rotation.x=-.8;L.shoulder.rotation.z=-.55;}
  if(archer){L.shoulder.rotation.x=-.65;L.elbow.rotation.x=-.8;L.wrist.rotation.x=1.38;R.shoulder.rotation.x=-.72;R.elbow.rotation.x=-1.5;R.wrist.rotation.x=2.22;}
  pony.rotation.x=Math.sin(time*3)*.05;
  for(let i=0;i<cloths.length;i++){cloths[i].rotation.x=Math.sin(time*2.6+i)*.07;cloths[i].rotation.z=Math.sin(time*2.2+i)*.045;}
  if(locomotion) {
    sampleLocomotion(rig,gait,movement,speed,turnLean,time);
    sampleIdle(rig,motion.idleClock,Math.pow(1-movement,3)*motion.idleLayer,alertness,lookYaw===undefined?undefined:motion.lookYaw,time);
  } else if(state==='attack' || state==='charge') {
    const c=((combo%4)+4)%4;
    const wind=sample(p,[[0,0],[.23,1],[.37,1],[.62,0],[1,0]]);
    const cut=sample(p,[[0,0],[.30,0],[.57,1],[.70,1],[1,0]]);
    const exert=pulse(p,.30,.79);
    const active=c===1?L:R, off=c===1?R:L;
    const direction=c===1?-1:1;
    body.position.y-=.09*wind+.045*exert;
    body.position.z+=sample(p,[[0,0],[.26,-.06],[.56,.15],[1,.015]]);
    body.rotation.y=direction*(-.40*wind+.40*cut);
    chest.rotation.y=direction*(-.63*wind+.72*cut);
    chest.rotation.x=-.08+.09*wind+.18*exert;
    head.rotation.y=-body.rotation.y*.6-chest.rotation.y*.5;
    head.rotation.x=-.02-.1*exert;
    LL.hip.rotation.x=-.16-.30*wind+(c===1?.47:-.48)*exert;
    RL.hip.rotation.x=-.14+.20*wind+(c===1?-.48:.47)*exert;
    LL.knee.rotation.x=.28+.25*wind;RL.knee.rotation.x=.28+.12*wind;
    LL.foot.rotation.x=-.16;RL.foot.rotation.x=-.18;
    active.shoulder.rotation.x=sample(p,[[0,-.3],[.24,.38],[.35,.34],[.53,-1.44],[.68,-.91],[1,-.3]]);
    active.shoulder.rotation.y=direction*sample(p,[[0,-.15],[.28,-.95],[.55,.84],[.72,.66],[1,-.15]]);
    active.shoulder.rotation.z=direction*sample(p,[[0,.22],[.27,.62],[.52,-.46],[.72,-.34],[1,.22]]);
    active.elbow.rotation.x=sample(p,[[0,-1.06],[.27,-1.72],[.52,-.18],[.65,-.4],[1,-1.06]]);
    active.wrist.rotation.x=sample(p,[[0,-.22],[.30,-.30],[.52,.05],[.73,.22],[1,-.22]]);
    active.wrist.rotation.z=direction*(-.25*wind+.47*cut);
    off.shoulder.rotation.x=.12+.28*wind-.28*exert;
    off.elbow.rotation.x=-.74-.52*wind;
    off.shoulder.rotation.z=-direction*(.31+.22*exert);
    if(c===2 && hero){
      body.rotation.y=-.2*wind+.15*cut;chest.rotation.y=-.15*wind+.24*cut;
      body.position.z+=.13*exert;chest.rotation.x=.16+.20*exert;
      for(const arm of arms){arm.shoulder.rotation.x=mix(.32,-1.48,cut);arm.shoulder.rotation.y=arm.side*(.22-.31*cut);arm.shoulder.rotation.z=arm.side*(.45-.15*cut);arm.elbow.rotation.x=mix(-1.85,-.12,cut);arm.wrist.rotation.x=.08;}
    }
    if(c===3 && hero){
      const spin=sample(p,[[0,0],[.28,-.75],[.40,-.75],[.72,TAU-.15],[1,TAU]]);
      body.rotation.y=spin;chest.rotation.y=-.27*wind;
      body.position.y-=.06*exert;
      for(const arm of arms){arm.shoulder.rotation.x=-.95*cut+.4*wind;arm.shoulder.rotation.z=arm.side*(.35+1.02*exert);arm.shoulder.rotation.y=arm.side*.35;arm.elbow.rotation.x=-.45;arm.wrist.rotation.z=arm.side*.18;}
      LL.hip.rotation.y=-.22*exert;RL.hip.rotation.y=.22*exert;
      RL.hip.rotation.x=.20*exert-.15;
    }
    if(heavy || boss){
      R.shoulder.rotation.x=sample(p,[[0,-.3],[.29,-2.85],[.40,-2.7],[.61,-.65],[1,-.3]]);
      R.elbow.rotation.x=-.55+.37*cut;
      chest.rotation.x=sample(p,[[0,0],[.3,-.27],[.62,.52],[1,0]]);
      if(heavy){L.shoulder.rotation.x=R.shoulder.rotation.x+.2;L.elbow.rotation.x=-1.1;}
    }
    if(archer){
      body.rotation.y=-.43;chest.rotation.y=-.44;head.rotation.y=.78;
      L.shoulder.rotation.set(-1.5,-.25,-.15);L.elbow.rotation.x=-.1;L.wrist.rotation.set(1.58,0,.16);
      R.shoulder.rotation.set(-1.20,.48,.48);R.elbow.rotation.x=-1.95;R.wrist.rotation.set(3.15+.20*wind-.20*cut,.18,0);
      R.shoulder.rotation.y+=.36*wind;R.elbow.rotation.x-=.20*wind;
      R.wrist.position.z-=.13*wind;
      R.shoulder.rotation.x+=.20*cut;
    }
    pony.rotation.x=.17+.23*exert;pony.rotation.z=-direction*.22*exert;
    for(const cloth of cloths){cloth.rotation.x=-.15-.28*exert;cloth.rotation.z=-direction*.38*exert;}
    if(hero) sampleHeroAttack(rig,p,c,gait,attackCarry,turnLean);
  } else if(state==='roll') {
    const tuck=Math.sin(Math.PI*p);
    body.position.y=sample(p,[[0,.91],[.125,.88],[.25,.63],[.375,.99],[.5,.94],[.625,.94],[.75,.30],[.875,.53],[1,.91]])+.08*smooth(p/.05)*smooth((1-p)/.05);
    body.position.z=.06*tuck;
    body.rotation.x=TAU*p;
    chest.rotation.x=.48*tuck;
    head.rotation.x=.55*tuck;
    for(const leg of legs){leg.hip.rotation.x=-1.68*tuck;leg.knee.rotation.x=2.13*tuck;leg.foot.rotation.x=-.51*tuck;}
    for(const arm of arms){arm.shoulder.rotation.x=-1.25*tuck;arm.shoulder.rotation.z=arm.side*.28;arm.elbow.rotation.x=-1.69*tuck-.35;arm.wrist.rotation.x=-1.55*tuck;}
    pony.rotation.x=-.40*tuck;
    for(const c of cloths){c.rotation.x=-.6*tuck;c.rotation.z=.2*Math.sin(p*TAU);}
  } else if(state==='hurt') {
    const stagger=sample(p,[[0,0],[.12,1],[.33,.72],[.65,.27],[1,0]])*clamp(hurtStrength,0,1);
    const side=clamp(hurtDirection,-1,1);
    const resistance=heavy?.52:boss?.34:1;
    body.position.z-=.12*stagger*resistance;body.position.x+=side*.065*stagger*resistance;
    body.position.y-=.025*stagger;
    body.rotation.set(-.25*stagger*resistance,side*.23*stagger,-side*.16*stagger*resistance);
    chest.rotation.x=-.08-.24*stagger;chest.rotation.y=side*.30*stagger;
    head.rotation.y=-side*.55*stagger;head.rotation.x=-.24*stagger;
    R.shoulder.rotation.x+=.4*stagger;L.shoulder.rotation.z-=.28*stagger;
    LL.hip.rotation.x=-.15-.30*stagger;RL.knee.rotation.x=.28+.30*stagger;
    LL.hip.rotation.z=side*.10*stagger;RL.hip.rotation.z=side*.10*stagger;
  } else if(state==='dead') {
    const fall=smooth(p);
    body.position.y=mix(.91,.42,fall);body.position.z=-.16*fall;
    body.rotation.set(-1.48*fall,.20*fall,-.22*fall);
    chest.rotation.x=-.10-.12*fall;head.rotation.x=-.12*fall;head.rotation.z=.25*fall;
    L.shoulder.rotation.z=-.28-.72*fall;R.shoulder.rotation.z=.28+.8*fall;
    L.shoulder.rotation.x=.4*fall;R.shoulder.rotation.x=-.3*fall;
    L.elbow.rotation.x=-.6+.5*fall;R.elbow.rotation.x=-.7+.55*fall;
    LL.hip.rotation.x=-.15+.30*fall;RL.hip.rotation.x=-.15-.36*fall;
    LL.knee.rotation.x=.28;RL.knee.rotation.x=.28+.35*fall;
    for(const c of cloths)c.rotation.x=-.2*fall;
  } else if(state==='skill') {
    const s=((skill%5)+5)%5;
    const coil=sample(p,[[0,0],[.23,1],[.35,1],[.58,0],[1,0]]);
    const strike=sample(p,[[0,0],[.32,0],[.62,1],[.76,1],[1,0]]);
    const energy=pulse(p,.27,.88);
    body.position.y-=.20*coil;
    chest.rotation.x=.2*coil;
    for(const leg of legs){leg.hip.rotation.x=-.35*coil-.15;leg.knee.rotation.x=.28+.62*coil;}
    for(const arm of arms){arm.shoulder.rotation.x=.30*coil-1.4*strike;arm.shoulder.rotation.z=arm.side*(.23+.55*coil-.14*strike);arm.elbow.rotation.x=-1.65*coil-.22*strike-.5*(1-coil-strike);arm.wrist.rotation.x=-.14;}
    if(s===0){
      body.position.z=.26*energy;body.rotation.x=.20*energy;chest.rotation.y=-.3*coil+.40*strike;
      LL.hip.rotation.x-=.5*energy;RL.hip.rotation.x+=.6*energy;
      R.shoulder.rotation.y=-.7*coil+.55*strike;L.shoulder.rotation.y=.7*coil-.55*strike;
    } else if(s===1){
      body.rotation.y=sample(p,[[0,0],[.25,-.6],[.38,-.6],[.83,TAU*2],[1,TAU*2]]);
      for(const arm of arms){arm.shoulder.rotation.z=arm.side*(.4+1.0*energy);arm.shoulder.rotation.x=-.75*energy;arm.elbow.rotation.x=-.25-.5*coil;}
      chest.rotation.x=-.06;body.position.y-=.05*energy;
    } else if(s===2){
      const jump=pulse(p,.24,.74);
      body.position.y+=.70*jump;
      chest.rotation.x=-.30*jump+.55*pulse(p,.60,.91);
      body.rotation.y=-.20*jump;
      for(const arm of arms){arm.shoulder.rotation.x=sample(p,[[0,-.3],[.29,-2.8],[.55,-2.95],[.73,-.8],[1,-.3]]);arm.elbow.rotation.x=-.42;arm.shoulder.rotation.z=arm.side*.20;}
      LL.hip.rotation.x=-.5*jump;LL.knee.rotation.x=.3+1.20*jump;
      RL.hip.rotation.x=.4*jump;RL.knee.rotation.x=.3+.65*jump;
      body.position.y-=.16*pulse(p,.73,.96);
    } else if(s===3){
      chest.rotation.y=-.8*coil+.85*strike;body.rotation.y=-.35*coil+.35*strike;
      for(const arm of arms){arm.shoulder.rotation.z=arm.side*sample(p,[[0,.2],[.29,-.22],[.55,1.30],[1,.2]]);arm.shoulder.rotation.x=-.95;arm.elbow.rotation.x=-1.4*coil-.22;arm.wrist.rotation.y=arm.side*.35;}
      body.position.z=.16*energy;
    } else {
      body.position.y-=.11*coil;chest.rotation.x=-.35*coil+.23*strike;
      R.shoulder.rotation.x=-2.45*coil-.8*strike;L.shoulder.rotation.x=-2.6*coil-.6*strike;
      R.elbow.rotation.x=-.65;L.elbow.rotation.x=-.7;
      body.rotation.y=-.4*coil+.5*strike;chest.rotation.y=-.4*coil+.35*strike;
    }
    pony.rotation.x=.2+.4*energy;pony.rotation.z=-.35*energy;
    for(const c of cloths){c.rotation.x=-.15-.65*energy;c.rotation.z=.35*energy;}
  }
  rig.attackFootTargets=null;
  applyWeaponPose(rig,{state,time,phase:p,combo,skill,speed,dt,gaitPhase:gait,moveBlend:movement,attackCarry,attackStep:stepping,idleClock:motion.idleClock,idleAge:motion.idleAge},plantIdleFoot);
  // Blend only the opening of a changed action. Contacts and complete spin arcs
  // are sampled absolutely; quaternion interpolation never wraps a full turn.
  if(locomotion)settleSecondary(motion,delta);
  let blend=transition&&!immediate?smooth(motion.elapsed/motion.duration):1;
  if((state==='attack'||state==='skill')&&p>=.32)blend=1;
  // Changing the way the feet follow the root must not re-time an attack's
  // already moving blade. Blend its contacts separately from the action.
  if(motion.footworkBlend)blend=1;
  const footBlend=motion.footworkBlend?smooth(motion.elapsed/motion.duration):blend;
  if(motion.elapsed>=motion.duration)motion.footworkBlend=false;
  rig.reviewedShaftBlend=null;
  let blendedFeet;
  if(footBlend<1&&rig.weaponId==='great-dao'&&motion.feetFrom&&!stepping&&!['roll','dead'].includes(state)){
    rig.group.updateMatrixWorld(true);
    blendedFeet=rig.legs.map((leg,i)=>motion.feetFrom[i].clone().lerp(rig.group.worldToLocal(leg.foot.getWorldPosition(new THREE.Vector3())),footBlend));
  }
  if(blend<1&&['tang-dao','great-dao'].includes(rig.weaponId)&&motion.shaftFrom){
    rig.group.updateMatrixWorld(true);
    const groupQ=rig.group.getWorldQuaternion(new THREE.Quaternion());
    const point=rig.group.worldToLocal(rig.arms[1].wrist.getWorldPosition(new THREE.Vector3()));
    const quaternion=groupQ.clone().invert().multiply(rig.arms[1].wrist.getWorldQuaternion(new THREE.Quaternion()));
    rig.reviewedShaftBlend={point:rig.group.localToWorld(motion.shaftFrom.point.clone().lerp(point,blend)),quaternion:groupQ.multiply(motion.shaftFrom.quaternion.clone().slerp(quaternion,blend))};
  }
  if(blend<1)rig.bind.forEach(({node},i)=>{
    motion.targetQ.copy(node.quaternion);
    node.position.lerpVectors(motion.from[i].p,node.position,blend);
    node.quaternion.slerpQuaternions(motion.from[i].q,motion.targetQ,blend);
    node.scale.lerpVectors(motion.from[i].s,node.scale,blend);
  });
  if(blend<1)reconcileWeaponGrip(rig);
  if(blendedFeet){
    // Blend ankle targets, then solve the leg chains. Blending the knee and
    // hip rotations independently can drive a heavy landing below the floor.
    for(let i=0;i<legs.length;i++){
      const foot=blendedFeet[i];
      plantIdleFoot(rig,legs[i],1,foot.z,Math.max(.075,foot.y),foot.x);
    }
    if(motion.footworkBlend){
      rig.group.updateMatrixWorld(true);
      const heading=rig.group.getWorldQuaternion(new THREE.Quaternion());
      rig.attackFootTargets=blendedFeet.map((foot,index)=>({point:rig.group.localToWorld(foot.clone()),
        rotation:motion.footRotationsFrom[index].clone().slerp(heading,footBlend)}));
      reconcileAttackFootwork(rig,plantIdleFoot);
    }
  }
  if(stepping)reconcileAttackFootwork(rig,plantIdleFoot);
  for(const part of motion.secondary){
    if(!locomotion&&delta>0){
      part.vx=clamp((part.node.rotation.x-part.x)/delta,-1.4,1.4);
      part.vz=clamp((part.node.rotation.z-part.z)/delta,-1.4,1.4);
    }
    part.x=part.node.rotation.x;part.z=part.node.rotation.z;
  }
  motion.key=key;motion.phase=p;motion.lastTime=time;motion.stepActive=Boolean(stepping);
  // World matrices are updated once by the renderer or weaponTips, not per joint.
}

// A planted stance followed by a short lifted return; solve both leg joints so
// ankle height stays steady instead of lifting the entire character each step.
function legTarget(leg,y,z,weight=1) {
  const a=.41,b=.395,d=clamp(Math.hypot(y,z),.12,a+b-.002);
  const hip=Math.atan2(-z,-y)-Math.acos(clamp((a*a+d*d-b*b)/(2*a*d),-1,1));
  const knee=Math.PI-Math.acos(clamp((a*a+b*b-d*d)/(2*a*b),-1,1));
  leg.hip.rotation.x=mix(leg.hip.rotation.x,hip,weight);
  leg.knee.rotation.x=mix(leg.knee.rotation.x,knee,weight);
  leg.foot.rotation.x=mix(leg.foot.rotation.x,-hip-knee,weight);
}

function sampleLocomotion(rig,gait,blend,speed,turn,time) {
  if(rig.type==='hero'){
    sampleHeroLocomotion(rig,gait,blend,speed,turn);
    return;
  }
  const {body,chest,head,legs,arms,pony,cloths,type}=rig;
  const lean=clamp(turn,-1,1)*blend;
  const pace=clamp(speed,0,1), stride=(type==='brute'?.215:.235)+.085*pace;
  // gaitPhase is a complete left/right cycle. At sprint speed a short ground
  // contact and longer airborne return preserve cadence without sliding feet.
  const cycleDistance=mix(.85,2.9,pace);
  const stance=clamp(stride*2/cycleDistance,.20,.58);
  body.position.y=.91+Math.sin(time*2.3)*.004*(1-blend)-(.055+.025*pace)*blend-.003*Math.abs(Math.sin(gait*2))*blend;
  body.rotation.set(.12*blend,Math.sin(gait)*.036*blend,-lean*.09);
  chest.rotation.x=mix(-.08,.105,blend);
  chest.rotation.y=-.07*(1-blend)-Math.sin(gait)*.078*blend;
  chest.rotation.z=lean*.035;
  head.rotation.x=mix(.045,-.17,blend);
  head.rotation.y=-chest.rotation.y*.6;
  head.rotation.z=lean*.045;
  for(const leg of legs){
    const u=((gait/TAU+(leg.side===-1?.5:0))%1+1)%1;
    let z,lift;
    if(u<stance){z=stride*(1-2*u/stance);lift=0;}
    else{const t=(u-stance)/(1-stance);z=mix(-stride,stride,smooth(t));lift=(.08+.025*pace)*Math.sin(Math.PI*t);}
    const ankle=.069+lift;
    const hipY=body.position.y-.035;
    legTarget(leg,ankle-hipY,z,blend);
    leg.hip.rotation.x-=body.rotation.x*blend;
    leg.hip.rotation.y=-lean*.08;
    leg.hip.rotation.z=lean*.055+(leg.side===-1?-.018:.018)*blend;
    leg.foot.rotation.y=lean*.065;
    // A slight toe peel only during the returning foot, never on the stance foot.
    if(u>stance)leg.foot.rotation.x+=.12*Math.sin(Math.PI*(u-stance)/(1-stance))*blend;
  }
  for(const arm of arms){
    const swing=Math.sin(gait+(arm.side===-1?Math.PI:0));
    arm.shoulder.rotation.x=mix(arm.shoulder.rotation.x,.25+swing*.18,blend);
    if(type!=='archer')arm.elbow.rotation.x=mix(arm.elbow.rotation.x,-.48,blend);
  }
  pony.rotation.x=mix(pony.rotation.x,.25+pace*.11+Math.sin(gait-.8)*.055,blend);
  pony.rotation.z=-lean*.20+Math.sin(gait-.7)*.025*blend;
  for(let i=0;i<cloths.length;i++){
    cloths[i].rotation.x=mix(cloths[i].rotation.x,-.25-.12*pace+Math.sin(gait-.65+i)*.055,blend);
    cloths[i].rotation.z=-lean*.19+Math.sin(gait-.9+i)*.075*blend;
  }
}

function sampleHeroLocomotion(rig,gait,blend,speed,turn) {
  const {body,chest,head,legs,arms,pony,cloths,motion}=rig;
  const pace=clamp(speed,0,1), lean=clamp(turn,-1,1)*blend;
  const stride=.235+.085*pace, cycleDistance=mix(.85,2.9,pace);
  const stance=clamp(stride*2/cycleDistance,.20,.58);
  const stepBlend=smooth(blend/.2);
  // Shift onto the supporting leg, compress after contact, rise on push-off.
  // The hips lead; the chest and arms follow at slightly different phases.
  const support=Math.cos(gait-Math.PI*stance);
  const step=((gait/Math.PI)%1+1)%1;
  const bounce=sample(step,[[0,-.006],[.12,-.024],[.30,-.009],[.55,.020],[.72,.026],[.90,.006],[1,-.006]]);
  const recoil=Math.cos(2*gait-.55);
  const drive=motion.drive*(.3+.7*blend);
  body.position.x=support*.035*blend;
  body.position.y=mix(.875,.832,blend)+bounce*blend-.016*Math.abs(lean)-.006*Math.abs(drive)*blend;
  body.position.z=Math.sin(2*gait-.6)*.012*blend+drive*.012;
  body.rotation.set(
    mix(.075,.18,blend)+recoil*.026*blend+drive*.085,
    Math.sin(gait+.05)*.105*blend,
    -support*.055*blend-lean*.15,
  );
  chest.position.y+=Math.cos(2*gait-.9)*.008*blend;
  chest.position.z-=drive*.009;
  chest.rotation.set(
    mix(.065,.055,blend)-Math.cos(2*gait-.85)*.046*blend+drive*.020,
    -Math.sin(gait-.32)*.225*blend-lean*.045,
    Math.cos(gait-Math.PI*stance-.28)*.020*blend+lean*.05,
  );
  // Stabilize the gaze without freezing the entire head in world space.
  head.rotation.set(
    -(body.rotation.x+chest.rotation.x)*(1-.28*blend)+Math.sin(2*gait-1.05)*.026*blend,
    -(body.rotation.y+chest.rotation.y)*.55+lean*.12,
    -(body.rotation.z+chest.rotation.z)*.6,
  );
  const targets=motion.stepTargets??=legs.map(()=>new THREE.Vector3());
  const toeAngles=motion.stepToeAngles??=[];
  for(let i=0;i<legs.length;i++){
    const leg=legs[i];
    const u=((gait/TAU+(leg.side===-1?.5:0))%1+1)%1;
    let z,lift;
    if(u<stance){z=stride*(1-2*u/stance);lift=0;}
    else{
      const t=(u-stance)/(1-stance);
      z=mix(-stride,stride,smooth(t/.94));
      const swingTime=t+.08*Math.sin(Math.PI*t);
      lift=(.10+.055*pace)*Math.sin(Math.PI*swingTime);
    }
    // Solve against the moving pelvis in three dimensions: support feet keep
    // their height and stride while the upper body rolls, twists and shifts.
    // Keep the distance-driven stride at walking speeds; scaling it by speed
    // would make a planted foot slide forward with the character.
    targets[i].set(leg.hip.position.x+leg.side*.012*stepBlend,.075+lift*stepBlend,.026+z*stepBlend);
    toeAngles[i]=u>stance?.15*Math.sin(Math.PI*(u-stance)/(1-stance))*blend:0;
  }
  // During quick starts or sharp banking the speed and pose blend can diverge.
  // Give the pelvis enough room for the stride instead of extending a planted
  // leg beyond its length and pulling the boot off the ground.
  const reach=.41+Math.hypot(.395,.016)-.001;
  let lower=0;
  for(let i=0;i<legs.length;i++){
    const hip=motion.idleTarget.copy(legs[i].hip.position).applyQuaternion(body.quaternion).add(body.position);
    const target=targets[i];
    const horizontal=(hip.x-target.x)**2+(hip.z-target.z)**2;
    const height=Math.sqrt(Math.max(0,reach*reach-horizontal));
    lower=Math.max(lower,hip.y-target.y-height);
  }
  body.position.y-=lower;
  for(let i=0;i<legs.length;i++){
    const target=targets[i];
    plantIdleFoot(rig,legs[i],1,target.z,target.y,target.x);
    legs[i].foot.rotation.x+=toeAngles[i];
  }
  for(const arm of arms){
    const phase=gait+(arm.side===-1?Math.PI:0);
    const asymmetry=arm.side===1?1.06:.94;
    const swing=-Math.sin(phase-.18)*(.20+.13*pace)*blend*asymmetry;
    const follow=-Math.sin(phase-.53)*.11*blend*asymmetry;
    const arc=Math.cos(phase-.38)*.05*blend;
    const carry=motion.armDrive*(.45+.55*blend);
    arm.shoulder.position.y+=Math.cos(phase-.48)*.012*blend-arm.side*.004*(1-blend);
    arm.shoulder.rotation.set(
      mix(.22,.30,blend)+swing+arm.side*.010+carry*.16,
      arm.side*-.025-lean*.05+arm.side*arc*.45,
      arm.side*(mix(.18,.235,blend)+arc),
    );
    arm.elbow.rotation.set(mix(-.22,-.32,blend)-follow-arm.side*.018+carry*.04,0,0);
    // Let the hands travel with the shoulders; the grip absorbs part of the
    // swing so the blades remain low, pointing forward and down.
    const grip=-Math.sin(phase-.43)*(.20+.13*pace)*blend*asymmetry;
    arm.wrist.rotation.set(mix(-.3075,-.3925,blend)-grip*.40+follow*.35+arm.side*.008-carry*.04,arm.side*(.025+arc*.3),arm.side*(.14+arc*.25));
    arm.weapon.position.set(0,-.029,0);
    arm.weapon.rotation.set(-.85,0,0);
  }
  pony.rotation.x=mix(pony.rotation.x,.27+pace*.12+Math.sin(2*gait-1.0)*.13+drive*.14,blend);
  pony.rotation.z=-lean*.27+Math.sin(gait-.9)*.08*blend;
  for(let i=0;i<cloths.length;i++){
    cloths[i].rotation.x=mix(cloths[i].rotation.x,-.25-.12*pace+Math.sin(2*gait-.95+i*.4)*.11-drive*.12,blend);
    cloths[i].rotation.z=-lean*.26+Math.sin(gait-1.0+i*.45)*.13*blend;
  }
}

function sampleHeroAttack(rig,p,combo,gait,carry,turn) {
  const {body,chest,head,arms,legs,pony,cloths}=rig;
  const wind=sample(p,[[0,0],[.19,1],[.29,1],[.49,0],[1,0]]);
  const cut=sample(p,[[0,0],[.29,0],[.50,1],[.72,1],[1,.26]]);
  const drive=pulse(p,.29,.81), recover=smooth((p-.75)/.25);
  const dir=combo===1?-1:1;
  body.position.set(0,.91-.045*wind-.025*drive,.085*drive+.015*cut);
  body.rotation.set(.035*drive,dir*(-.34*wind+.34*cut),-dir*.025*drive);
  chest.rotation.set(-.08+.20*drive,dir*(-.57*wind+.66*cut),dir*.035*drive);
  head.rotation.set(-.06-.08*drive,-body.rotation.y*.65-chest.rotation.y*.55,0);
  const leading=combo===1?1:0;
  for(let i=0;i<legs.length;i++){
    const leg=legs[i],front=i===leading;
    leg.hip.rotation.set(-.15,0,0);leg.knee.rotation.x=.28;leg.foot.rotation.set(-.13,0,0);
    const z=front?(.07+.22*drive):(-.05-.12*drive);
    legTarget(leg,.072-(body.position.y-.035),z);
    leg.hip.rotation.y=dir*(front?-.09:.12)*drive;
    // Distance phase can keep a restrained carry step underneath a moving cut.
    const follow=clamp(carry,0,1)*.17;
    leg.hip.rotation.x+=Math.sin(gait+i*Math.PI)*.24*follow;
    leg.knee.rotation.x+=Math.max(0,-Math.sin(gait+i*Math.PI))*.32*follow;
  }
  const active=combo===1?arms[0]:arms[1],off=combo===1?arms[1]:arms[0];
  active.shoulder.rotation.set(
    sample(p,[[0,combo===1?-.35:-.30],[.19,.32],[.29,.28],[.47,-1.40],[.64,-.89],[1,-.53]]),
    dir*sample(p,[[0,-.13],[.22,-.84],[.29,-.84],[.49,.78],[.72,.83],[1,.12]]),
    dir*sample(p,[[0,.22],[.23,.61],[.29,.61],[.49,-.44],[.68,-.30],[1,.20]]));
  active.elbow.rotation.set(sample(p,[[0,-1.02],[.23,-1.73],[.29,-1.73],[.47,-.15],[.67,-.55],[1,-.97]]),0,0);
  active.wrist.rotation.set(-.16+.25*cut,dir*.12,dir*(-.24*wind+.38*cut));
  off.shoulder.rotation.set(.10+.26*wind-.39*drive,-dir*.12,-dir*(.23+.19*drive));
  off.elbow.rotation.set(-.66-.57*wind-.13*drive,0,0);
  off.wrist.rotation.set(.15,-dir*.16,-dir*.12);
  if(combo===2){
    body.rotation.y=-.12*wind+.08*cut;
    chest.rotation.y=-.20*wind+.10*cut;chest.rotation.x=.02+.27*drive;
    body.position.z=.12*drive+.012*cut;
    for(const arm of arms){
      arm.shoulder.rotation.set(.23*wind-1.47*cut,arm.side*(-.50*wind+.18*cut),arm.side*(.08*wind+.15*cut));
      arm.elbow.rotation.set(-.94-.77*wind+.76*cut,0,0);
      arm.wrist.rotation.set(.08,arm.side*-.18,arm.side*(-.18*wind-.08*cut));
    }
  } else if(combo===3){
    // Sweep around a planted left foot; the right leg takes a short crossing step.
    const spin=sample(p,[[0,0],[.24,-.57],[.31,-.57],[.77,TAU-.12],[1,TAU]]);
    body.rotation.set(0,spin,0);
    body.position.set(.038*Math.sin(spin)*drive,.91-.075*wind-.035*drive,.035*drive);
    chest.rotation.set(.10*drive,-.25*wind+.16*drive,0);
    head.rotation.y=-.19*wind;
    for(const arm of arms){
      arm.shoulder.rotation.set(.27*wind-.88*drive,arm.side*.18,arm.side*(.24+1.02*drive));
      arm.elbow.rotation.set(-.88*wind-.30-.25*recover,0,0);
      arm.wrist.rotation.set(.08,arm.side*.12,arm.side*.14);
    }
    legTarget(legs[0],.072-(body.position.y-.035),-.03);
    legTarget(legs[1],.072+.08*drive-(body.position.y-.035),.14*Math.sin(spin));
    legs[0].hip.rotation.y=-spin;
    legs[0].foot.rotation.y=.12*drive;
    legs[1].hip.rotation.y=-spin*.70;
  }
  body.rotation.z-=clamp(turn,-1,1)*.02;
  pony.rotation.set(.13+.25*drive,0,-dir*.27*drive);
  for(const cloth of cloths)cloth.rotation.set(-.13-.36*drive,0,-dir*.33*drive);
}

const DOWN = new THREE.Vector3(0,-1,0);
const AXIS_X = new THREE.Vector3(1,0,0);
function plantIdleFoot(rig,leg,weight,targetZ=.026,targetY=.075,targetX=leg.hip.position.x) {
  const m=rig.motion,a=.41,b=Math.hypot(.395,.016),gamma=Math.atan2(.016,.395);
  // The ankle target is in character space; it stays put while the pelvis shifts.
  m.idleRootQ.copy(rig.body.quaternion).invert();
  m.idleTarget.set(targetX,targetY,targetZ).sub(rig.body.position).applyQuaternion(m.idleRootQ).sub(leg.hip.position);
  const d=clamp(m.idleTarget.length(),.2,a+b-.0001);
  const beta=Math.acos(clamp((a*a+d*d-b*b)/(2*a*d),-1,1));
  const knee=Math.PI-Math.acos(clamp((a*a+b*b-d*d)/(2*a*b),-1,1));
  m.idleQ.setFromUnitVectors(DOWN,m.idleTarget.normalize());
  m.idleBendQ.setFromAxisAngle(AXIS_X,-beta);
  m.idleQ.multiply(m.idleBendQ);
  leg.hip.quaternion.slerp(m.idleQ,weight);
  m.idleBendQ.setFromAxisAngle(AXIS_X,knee+gamma);
  leg.knee.quaternion.slerp(m.idleBendQ,weight);
  m.idleFootQ.copy(rig.body.quaternion).multiply(leg.hip.quaternion).multiply(leg.knee.quaternion).invert();
  leg.foot.quaternion.slerp(m.idleFootQ,weight);
}

function sampleIdle(rig,clock,weight,alertness,lookYaw,time) {
  if(weight<.0001)return;
  const {body,chest,head,arms,legs,pony,cloths,type}=rig;
  const hero=type==='hero';
  const alert=clamp(alertness,0,1), heavy=type==='brute'||type==='boss';
  const tempo=heavy?1.42:1.83;
  const angle=clock*tempo;
  const breath=hero?breathWave(angle):Math.sin(angle);
  const shoulderBreath=hero?breathWave(angle-.24):0;
  const elbowBreath=hero?breathWave(angle-.38):0;
  const wristBreath=hero?breathWave(angle-.44):0;
  const age=rig.motion.idleAge;
  const cycle=((clock+rig.idleOffset)%9.6+9.6)%9.6;
  const balance=hero
    ?sample(cycle,[[0,-.45],[1.35,-.50],[2.10,.70],[4.20,.64],[5.10,-.56],[7.60,-.48],[8.55,.38],[9.60,-.45]])+.05*Math.sin(clock*.91)
    :Math.sin(clock*.57)+.22*Math.sin(clock*.91+1.1);
  const guard=pulse(cycle,6.4,8.8)*smooth(age/.8);
  const release=hero?pulse(cycle,1.35,3.15)*smooth(age/.8)*(1-alert*.55):0;
  body.position.x+=balance*(hero?.034:heavy?.016:.022)*weight;
  body.position.z+=Math.sin(clock*.47+.7)*.004*weight;
  body.position.y+=(hero?breath*.004-.006:breath*.005-.006-Math.sin(time*2.3)*.004)*weight;
  if(hero){
    body.rotation.z-=balance*.023*weight;
    body.rotation.y+=(Math.sin(clock*.57-.25)*.022-.015*release)*weight;
  }
  chest.position.y+=breath*(hero?.022:.008)*weight;
  chest.rotation.x+=(hero?-breath*.027-.012*guard-.015*release:breath*.026-.018*guard-.026*alert)*weight;
  chest.rotation.z+=balance*.018*weight;
  if(hero){
    const inhale=(breath+1)*.5*weight;
    rig.ribcage.scale.set(1+.035*inhale,1+.006*inhale,1+.065*inhale);
  }
  chest.rotation.y+=(Math.sin(clock*.57-.7)*(hero?.012:.034)-(hero?.004:.016)*guard)*weight;
  const scan=Math.sin(clock*.43)*.23+Math.sin(clock*.19+1.5)*.075;
  const look=(clamp(lookYaw??0,-.55,.55)*(.45+.55*alert)+scan*(1-alert*.8))*weight;
  head.rotation.y+=look;
  head.rotation.x+=(hero?breath*.027+shoulderBreath*.006-.005*guard:Math.sin(clock*tempo-.3)*.020-.027*guard)*weight;
  if(hero)head.position.y-=breath*.007*weight;
  head.rotation.z-=look*.11;
  chest.rotation.y+=look*.08;
  for(const arm of arms){
    const side=arm.side;
    if(hero){
      const settle=release*(side===1?1:.65);
      arm.shoulder.position.y+=(shoulderBreath*.004-settle*.006)*weight;
      // The upper arm counterbalances chest extension to carry the blades'
      // weight, then the elbow and grip follow the same breath a little later.
      arm.shoulder.rotation.x+=(breath*.024+shoulderBreath*.009+.020*guard-.032*settle)*weight;
      arm.shoulder.rotation.z+=side*(shoulderBreath*.004+.016*guard+.025*settle)*weight;
      arm.elbow.rotation.x+=(-elbowBreath*.005-.045*guard+.020*settle)*weight;
      arm.wrist.rotation.x+=(wristBreath*.003+.022*guard+.012*settle)*weight;
      arm.wrist.rotation.z+=side*.012*guard*weight;
    }else{
      arm.shoulder.position.y+=breath*.004*weight;
      arm.shoulder.rotation.x+=(breath*.022-(side===1?.085:.028)*guard-.04*alert)*weight;
      arm.shoulder.rotation.z+=side*(breath*.022+.045*guard)*weight;
      arm.elbow.rotation.x+=(-.034*breath-.13*guard)*weight;
      arm.wrist.rotation.x+=(Math.sin(clock*tempo-.55)*.022+.075*guard)*weight;
      arm.wrist.rotation.y+=side*Math.sin(clock*.67-.4)*.026*weight;
      arm.wrist.rotation.z+=side*.034*guard*weight;
    }
  }
  pony.rotation.x+=(Math.sin(clock*tempo-.9)*.075+.032*guard)*weight;
  pony.rotation.z+=(Math.sin(clock*.57-1.0)*.08)*weight;
  for(let i=0;i<cloths.length;i++){
    cloths[i].rotation.x+=(-.09+Math.sin(clock*tempo-1.0-i*.4)*.07)*weight;
    cloths[i].rotation.z+=Math.sin(clock*.57-.8-i*.4)*.085*weight;
  }
  for(const leg of legs)plantIdleFoot(rig,leg,weight);
}

function breathWave(angle){
  const phase=((angle/TAU)%1+1)%1;
  // A modest lift and expansion followed by a longer, quiet release.
  return 2*(phase<.43?smooth(phase/.43):1-smooth((phase-.43)/.57))-1;
}

function settleSecondary(motion,dt) {
  for(const part of motion.secondary){
    const targetX=part.node.rotation.x,targetZ=part.node.rotation.z;
    // Critically damped follow-through, with finite velocity after a fast action.
    part.vx=clamp((part.vx+(targetX-part.x)*70*dt)*Math.exp(-14*dt),-1.5,1.5);
    part.vz=clamp((part.vz+(targetZ-part.z)*70*dt)*Math.exp(-14*dt),-1.5,1.5);
    part.node.rotation.x=part.x+part.vx*dt;
    part.node.rotation.z=part.z+part.vz*dt;
  }
}
