import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

// All body parts share geometry; each character owns its palette for hit flashes.
const geometries = new Map();
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
    sword(arms[0].wrist,.84);
    sword(arms[1].wrist,.9);
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
  const scale = hero ? 1 : type === 'grunt' ? .90 : narrow ? .9 : heavy ? 1.23 : 1.66;
  group.scale.setScalar(scale);
  // Keep a bind pose per joint. Every update is absolute, so interrupted moves cannot leak.
  const resetNodes = [body,...nodes];
  const bind = resetNodes.map(n => ({node:n, p:n.position.clone(),r:n.rotation.clone()}));
  const rig = {
    type, group, body, chest, head, pony, legs, arms, cloths, bow, bind,
    weaponTips() { group.updateMatrixWorld(true); return tips.map(t => t.getWorldPosition(new THREE.Vector3())); },
    setFlash(amount) {
      const value = THREE.MathUtils.clamp(amount,0,1);
      for (const m of Object.values(material)) { m.emissive.setRGB(value*.82,value*.86,value*.9); m.emissiveIntensity = 1; }
    },
  };
  poseCharacter(rig,{state:'idle',time:0,phase:0});
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

export function poseCharacter(rig, {state='idle',time=0,phase=0,combo=0,speed=1,skill=0} = {}) {
  const {body,chest,head,arms,legs,pony,cloths,type} = rig;
  for(const {node,p,r} of rig.bind) {node.position.copy(p);node.rotation.copy(r);}
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
  if(state==='run') {
    const cycle=time*(hero?12.6:heavy?8.5:10.5), amplitude=.49*clamp(speed,.2,1);
    body.position.y-=.07+Math.abs(Math.sin(cycle))*.028;
    body.rotation.x=.13;
    chest.rotation.x=.15;
    chest.rotation.y=Math.sin(cycle)*.085;
    head.rotation.x=-.17;
    for(const leg of legs){
      const a=cycle+(leg.side===-1?Math.PI:0),s=Math.sin(a);
      leg.hip.rotation.x=s*amplitude-.12;
      leg.knee.rotation.x=.23+Math.max(0,-s)*.76;
      leg.foot.rotation.x=-leg.knee.rotation.x*.35;
    }
    if(hero){
      L.shoulder.rotation.set(.65+Math.sin(cycle)*.14,.12,-.23);L.elbow.rotation.x=-.36;L.wrist.rotation.x=.22;
      R.shoulder.rotation.set(.52-Math.sin(cycle)*.14,-.10,.24);R.elbow.rotation.x=-.48;R.wrist.rotation.x=.34;
    } else {
      L.shoulder.rotation.x=.20-Math.sin(cycle)*.25;R.shoulder.rotation.x=.18+Math.sin(cycle)*.26;
    }
    pony.rotation.x=.35+Math.sin(cycle)*.09;
    for(const c of cloths){c.rotation.x=-.42+Math.sin(cycle)*.10;c.rotation.z=Math.sin(cycle*.5)*.13;}
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
    const stagger=Math.sin(Math.PI*p);
    body.position.z-=.13*stagger;body.position.y-=.06*stagger;
    body.rotation.set(-.23*stagger,.24*stagger,-.13*stagger);
    chest.rotation.x=-.16-.23*stagger;chest.rotation.y=.20*stagger;
    head.rotation.y=-.48*stagger;head.rotation.x=-.23*stagger;
    R.shoulder.rotation.x=.35*stagger;L.shoulder.rotation.z=-.35-.25*stagger;
    LL.hip.rotation.x=-.25-.40*stagger;RL.knee.rotation.x=.3+.36*stagger;
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
  // World matrices are updated once by the renderer or weaponTips, not per joint.
}
