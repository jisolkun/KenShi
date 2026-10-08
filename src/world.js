import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

// All artwork is generated here. The court is intentionally clear through its centre.
export function createWorld(scene) {
  const bounds = { minX: -17, maxX: 17, minZ: -15, maxZ: 15 };
  const obstacles = [];
  const root = new THREE.Group();
  root.name = 'the-fallen-temple';
  scene.add(root);
  let seed = 74281;
  const rand = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
  const range = (a, b) => a + rand() * (b - a);
  const mat = (color, extra = {}) => new THREE.MeshStandardMaterial({ color, roughness: .88, flatShading: true, ...extra });
  const stone = mat(0x657776), paleStone = mat(0xa0a79b), darkStone = mat(0x465957);
  const edgeStone = mat(0x778982), ochreStone = mat(0x95876b);
  const red = mat(0x813c32), wood = mat(0x382e2a), roofMat = mat(0x344e50), roofEdge = mat(0x697976);
  const gold = mat(0xb29755, { metalness: .3, roughness: .65 });
  const bark = mat(0x4b4034), bambooMat = mat(0x526947), bambooJoint = mat(0x7d8551);
  const leafMats = [mat(0x875033), mat(0xbb6038), mat(0x9b6735), mat(0xc79947), mat(0x68774b)];
  const boxGeo = new THREE.BoxGeometry(1, 1, 1);
  const cylinderGeo = new THREE.CylinderGeometry(1, 1, 1, 8);
  const sphereGeo = new THREE.IcosahedronGeometry(1, 0);
  const coneGeo = new THREE.ConeGeometry(1, 1, 5);
  const temp = new THREE.Object3D();
  function mesh(geo, material, x, y, z, sx = 1, sy = 1, sz = 1, parent = root) {
    const m = new THREE.Mesh(geo, material);
    m.position.set(x, y, z); m.scale.set(sx, sy, sz);
    m.castShadow = true; m.receiveShadow = true; parent.add(m); return m;
  }
  const box = (m, x, y, z, sx, sy, sz, p) => mesh(boxGeo, m, x, y, z, sx, sy, sz, p);
  const cyl = (m, x, y, z, r, h, p) => mesh(cylinderGeo, m, x, y, z, r, h, r, p);
  function segment(a, b, radius, material, parent = root) {
    const d = new THREE.Vector3().subVectors(b, a);
    const m = mesh(cylinderGeo, material, ...a.clone().add(b).multiplyScalar(.5).toArray(), radius, d.length(), radius, parent);
    m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize()); return m;
  }
  function texture(size, draw) {
    const canvas = document.createElement('canvas'); canvas.width = canvas.height = size;
    draw(canvas.getContext('2d'), size);
    const t = new THREE.CanvasTexture(canvas); t.colorSpace = THREE.SRGBColorSpace; return t;
  }
  const earthMap = texture(512, (c, s) => {
    c.fillStyle = '#6b7161'; c.fillRect(0, 0, s, s);
    for (let i = 0; i < 15000; i++) {
      c.fillStyle = ['#9b9675', '#737a67', '#525e50', '#b0a185', '#596b5b'][i % 5];
      c.globalAlpha = range(.08, .35); c.fillRect(rand() * s, rand() * s, range(1, 4), range(1, 4));
    }
    c.globalAlpha = .15;
    for (let i = 0; i < 90; i++) { c.fillStyle = '#323e33'; c.beginPath(); c.ellipse(rand() * s, rand() * s, range(3, 17), range(2, 9), rand() * 6, 0, Math.PI * 2); c.fill(); }
  });
  earthMap.wrapS = earthMap.wrapT = THREE.RepeatWrapping; earthMap.repeat.set(7, 7);
  const ground = mesh(new THREE.PlaneGeometry(76, 75), mat(0xaeb39a, { map: earthMap }), 0, -.045, -4);
  ground.rotation.x = -Math.PI / 2; ground.castShadow = false;
  const stoneMap = texture(256, (c, s) => {
    c.fillStyle = '#afb8b0'; c.fillRect(0, 0, s, s);
    for (let i = 0; i < 4000; i++) { c.fillStyle = i % 2 ? '#8c9c93' : '#d0cebc'; c.globalAlpha = .18; c.fillRect(rand() * s, rand() * s, range(1, 5), 1); }
    c.strokeStyle = '#425952'; c.globalAlpha = .25; c.lineWidth = 1;
    for (let i = 0; i < 6; i++) { let x = rand() * s, y = rand() * s; c.beginPath(); c.moveTo(x, y); for (let j = 0; j < 5; j++) { x += range(-20, 20); y += range(9, 22); c.lineTo(x, y); } c.stroke(); }
    c.globalAlpha = .17; c.fillStyle = '#495b46'; c.fillRect(0, 0, 10, s); c.fillRect(0, 0, s, 7);
  });
  const slabMat = mat(0x889993, { map: stoneMap });
  const tileGeo = new THREE.BoxGeometry(1, 1, 1);
  const slabs = [];
  for (let z = -17, row = 0; z <= 17; row++) {
    const rowDepth = range(1.18, 1.52);
    let x = -19 - (row % 2 ? .62 : 0);
    while (x <= 19) {
      const width = range(1.12, 1.89), centerX = x + width * .5;
      const distance = Math.hypot(centerX, z);
      if (distance >= 6.85 && !(distance > 16 && rand() < .2) && rand() > .025) {
        slabs.push({ x: centerX + range(-.018, .018), z: z + range(-.018, .018), y: range(-.055, -.024), sx: width - range(.055, .09), sz: rowDepth - range(.055, .09), angle: range(-.014, .014), color: new THREE.Color().setHSL(range(.13, .19), range(.035, .12), range(.48, .61)) });
      }
      x += width;
    }
    z += rowDepth;
  }
  const slabMesh = new THREE.InstancedMesh(tileGeo, slabMat, slabs.length);
  slabs.forEach((t, i) => { temp.position.set(t.x, t.y, t.z); temp.rotation.set(0, t.angle, 0); temp.scale.set(t.sx, .14, t.sz); temp.updateMatrix(); slabMesh.setMatrixAt(i, temp.matrix); slabMesh.setColorAt(i, t.color); });
  slabMesh.receiveShadow = true; slabMesh.castShadow = false; root.add(slabMesh);

  // The old formation is carved into stone; faded pigments keep it quieter than combat FX.
  const arrayMap = texture(1024, (c, s) => {
    c.fillStyle = '#7e908a'; c.fillRect(0, 0, s, s);
    for (let i = 0; i < 19000; i++) { c.globalAlpha = .13; c.fillStyle = i % 2 ? '#c3c4aa' : '#364f49'; c.fillRect(rand() * s, rand() * s, range(1, 4), range(1, 3)); }
    c.translate(s / 2, s / 2); c.globalAlpha = .68; c.strokeStyle = '#c1ae74'; c.lineWidth = 3;
    const polygon = (r) => { c.beginPath(); for (let i = 0; i <= 8; i++) { const a = Math.PI / 8 + i * Math.PI / 4; const x = Math.cos(a) * r, y = Math.sin(a) * r; if (!i) c.moveTo(x, y); else c.lineTo(x, y); } c.stroke(); };
    polygon(465); polygon(447); polygon(333); polygon(322);
    c.strokeStyle = '#374d48'; c.lineWidth = 8; polygon(469);
    c.strokeStyle = '#b5a376'; c.lineWidth = 4;
    for (let i = 0; i < 8; i++) {
      c.save(); c.rotate(i * Math.PI / 4); c.translate(0, -386);
      for (let j = 0; j < 3; j++) { c.beginPath(); c.moveTo(-29, j * 13 - 13); c.lineTo(-5, j * 13 - 13); c.moveTo(5, j * 13 - 13); c.lineTo(29, j * 13 - 13); c.stroke(); }
      c.restore();
    }
    c.globalAlpha = .28; c.beginPath(); c.arc(0, 0, 218, 0, Math.PI * 2); c.stroke();
    c.lineWidth = 13; c.strokeStyle = '#bdab7f'; c.beginPath(); c.arc(0, 0, 112, .5, 5.9); c.stroke();
    c.lineWidth = 6; c.beginPath(); c.moveTo(-33, -65); c.lineTo(32, -65); c.lineTo(-8, -6); c.lineTo(61, -6); c.moveTo(-9, -31); c.lineTo(-9, 81); c.moveTo(-62, 40); c.lineTo(50, 40); c.stroke();
    c.globalAlpha = .34; c.lineWidth = 2; c.strokeStyle = '#2f4641';
    for (let i = 0; i < 8; i++) { c.save(); c.rotate(i * Math.PI / 4); c.beginPath(); c.moveTo(0, -472); c.lineTo(range(-5, 5), -335); c.lineTo(range(-12, 12), -295); c.stroke(); c.restore(); }
    for (let i = 0; i < 17; i++) { c.beginPath(); let x = range(-460, 460), y = range(-460, 460); c.moveTo(x, y); for (let j = 0; j < 5; j++) { x += range(-32, 32); y += range(8, 30); c.lineTo(x, y); } c.stroke(); }
  });
  const court = mesh(new THREE.CylinderGeometry(6.7, 6.7, .11, 8), stone, 0, -.009, 0);
  court.rotation.y = Math.PI / 8; court.castShadow = false;
  const array = mesh(new THREE.CircleGeometry(6.65, 8), mat(0xffffff, { map: arrayMap }), 0, .049, 0);
  array.rotation.x = -Math.PI / 2; array.rotation.z = Math.PI / 8; array.castShadow = false;
  // Inset drain stones give the perimeter a readable, believable border.
  for (let z = -15; z <= 15; z += 1.8) for (const x of [-17.8, 17.8]) box(edgeStone, x, .08, z, .47, .25, 1.69);
  for (let x = -17; x <= 17; x += 1.8) for (const z of [-15.8, 15.8]) box(edgeStone, x, .08, z, 1.69, .25, .47);

  function rock(x, z, size, collidable = false) {
    const r = mesh(sphereGeo, rand() < .5 ? darkStone : stone, x, size * .32 - .05, z, size * range(.75, 1.12), size * range(.48, .77), size * range(.65, .98));
    r.rotation.set(rand() * 2, rand() * 6, rand() * .6);
    if (collidable) obstacles.push({ x, z, radius: size * .8 });
    return r;
  }
  for (let i = 0; i < 65; i++) {
    const side = i % 2 ? -1 : 1; const x = side * range(17.9, 26), z = range(-20, 18);
    rock(x, z, range(.22, .86));
  }
  [[-15.8, -11, 1.2], [15.9, -11.5, 1.3], [-16.1, 10.7, .8], [16.2, 11.7, 1.1]].forEach(([x,z,s]) => rock(x,z,s,true));

  // Hip roofs have lifted wing corners, tiled ribs and a separate ridge.
  function roof(parent, width, depth, y, height) {
    const vertices = [], indices = [];
    const rings = [[1, 0], [.82, -.08], [.48, .47], [.08, 1]];
    rings.forEach(([scale, h], ring) => {
      for (let i = 0; i < 8; i++) {
        const corners = [[-1,-1],[0,-1],[1,-1],[1,0],[1,1],[0,1],[-1,1],[-1,0]];
        const [x,z] = corners[i]; const lifted = ring === 0 && x !== 0 && z !== 0 ? .37 : 0;
        vertices.push(x * width * .5 * scale, y + height * h + lifted, z * depth * .5 * scale);
      }
    });
    for (let ring = 0; ring < 3; ring++) for (let i = 0; i < 8; i++) { const a = ring * 8 + i, b = ring * 8 + (i+1)%8, d = a+8, e=b+8; indices.push(a,d,b,b,d,e); }
    indices.push(24,25,26,24,26,27,24,27,28,24,28,29,24,29,30,24,30,31);
    const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3)); geo.setIndex(indices); geo.computeVertexNormals();
    const r = mesh(geo, roofMat, 0, 0, 0, 1,1,1,parent); r.material.side = THREE.DoubleSide;
    for (let i = 0; i < 8; i++) {
      const j=(i+1)%8; segment(new THREE.Vector3(...vertices.slice(i*3,i*3+3)),new THREE.Vector3(...vertices.slice(j*3,j*3+3)),.065,roofEdge,parent);
    }
    box(roofEdge, 0, y + height + .05, 0, width * .55, .13, .15, parent);
    for (const sign of [-1,1]) {
      const end=width*.28*sign; segment(new THREE.Vector3(end,y+height,0),new THREE.Vector3(end+sign*.38,y+height+.38,0),.1,roofEdge,parent);
      mesh(coneGeo,gold,end+sign*.4,y+height+.45,0,.12,.27,.1,parent);
    }
    // Narrow low-profile strips catch the grazing light like handmade roof tiles.
    for (let x = -width*.39; x <= width*.39; x += .43) for (const s of [-1,1]) {
      segment(new THREE.Vector3(x,y+.02,s*depth*.43),new THREE.Vector3(x*.56,y+height*.48,s*depth*.23),.025,roofEdge,parent);
    }
  }
  function pillar(parent, x, z, height) {
    cyl(paleStone,x,.2,z,.39,.4,parent); cyl(red,x,height/2+.35,z,.235,height,parent);
    cyl(gold,x,.52,z,.25,.08,parent); cyl(gold,x,height+.19,z,.25,.09,parent);
    box(wood,x,height+.42,z,.63,.21,.64,parent);
  }
  const lanternFlames = [], lanternLights = [];
  function lantern(x, y, z, parent = root, light = false) {
    const paper = mat(0xe8b75a, { emissive: 0xd78b27, emissiveIntensity: .8 });
    cyl(wood,x,y+.47,z,.36,.09,parent); cyl(wood,x,y-.48,z,.29,.09,parent);
    const shell = mesh(new THREE.CylinderGeometry(.32,.25,.86,6),paper,x,y,z,1,1,1,parent); shell.castShadow=false;
    for (let i=0;i<6;i++) { const a=i*Math.PI/3; segment(new THREE.Vector3(x+Math.cos(a)*.31,y+.41,z+Math.sin(a)*.31),new THREE.Vector3(x+Math.cos(a)*.25,y-.41,z+Math.sin(a)*.25),.022,wood,parent); }
    cyl(red,x,y-.64,z,.035,.31,parent);
    const flame = mesh(coneGeo,new THREE.MeshBasicMaterial({color:0xffd787}),x,y,z,.09,.35,.09,parent); flame.castShadow=false;
    flame.userData.animated = shell.userData.animated = true;
    lanternFlames.push({mesh:flame, shell, phase:rand()*6});
    if (light) { const l = new THREE.PointLight(0xffbd63, 3.2, 8, 2); l.position.set(x,y,z); parent.add(l); lanternLights.push(l); }
  }
  function pavilion(x, z, width, depth, height, gate = false) {
    const p = new THREE.Group(); p.position.set(x,0,z); root.add(p);
    box(darkStone,0,.16,0,width*.86,.32,depth*.88,p);
    box(paleStone,0,.35,0,width*.82,.12,depth*.85,p);
    if (!gate) {
      box(stone,0,1.08,depth*.28,width*.82,1.4,.43,p);
      box(red,-width*.34,1.22,0,.35,1.65,depth*.7,p); box(red,width*.34,1.22,0,.35,1.65,depth*.7,p);
      for (let i=-2;i<=2;i++) box(wood,i*.45,2.25,depth*.27,.06,1.22,.12,p);
    }
    for (const px of [-width*.31,width*.31]) for (const pz of [-depth*.26,depth*.26]) pillar(p,px,pz,height);
    box(red,0,height+.4,0,width*.83,.36,depth*.68,p);
    for (const side of [-1,1]) for (let i=-2;i<=2;i++) { box(wood,i*width*.12,height+.05,side*depth*.28,.15,.27,.55,p); box(gold,i*width*.12,height+.24,side*depth*.34,.24,.08,.49,p); }
    roof(p,width,depth,height+.52,1.2);
    if (gate) {
      box(wood,0,height-.03,depth*.28,3,.74,.17,p);
      const plaqueMap=texture(512,(c,s)=>{c.fillStyle='#263632';c.fillRect(0,0,s,s);c.strokeStyle='#b9a36a';c.lineWidth=12;c.strokeRect(18,125,s-36,260);c.fillStyle='#dac697';c.textAlign='center';c.textBaseline='middle';c.font='bold 112px serif';c.fillText('镇魂关',s/2,s/2);});
      const plaque=mesh(new THREE.PlaneGeometry(2.8,.67),mat(0xffffff,{map:plaqueMap}),0,height-.03,depth*.28+.095,1,1,1,p); plaque.castShadow=false;
      roof(p,width*.7,depth*.74,height+2.12,.93);
      for (const side of [-1,1]) { pillar(p,side*width*.21,0,height+1.65); lantern(side*width*.34,height-.56,depth*.33,p,true); }
      // Far doors are in the shadowed passage, with brass bosses and diagonal braces.
      for(const side of [-1,1]) {box(wood,side*1.16,1.95,-depth*.3,2.15,3.2,.2,p); for(let h=.85;h<3.4;h+=.7) for(let j=0;j<3;j++) mesh(sphereGeo,gold,side*(.42+j*.55),h,-depth*.3+.15,.055,.055,.04,p); }
    } else for (const side of [-1,1]) lantern(side*width*.28,height-.33,depth*.3,p);
    return p;
  }
  pavilion(0,-20,10.5,6.4,4.3,true);
  pavilion(-23,-15,7.5,6.5,3.2); pavilion(23,-16,7.5,6.5,3.2);
  // Broad shallow approach steps make the gate feel embedded in the courtyard.
  for(let i=0;i<4;i++) box(i%2?stone:paleStone,0,.09+i*.1,-15.9-i*.54,8.3,.18,.56);
  function wall(x,z,length,angle=0,broken=false) {
    const w=new THREE.Group(); w.position.set(x,0,z); w.rotation.y=angle; root.add(w);
    box(darkStone,0,.22,0,length+.2,.44,.85,w);
    const n=Math.ceil(length/1.25);
    for(let row=0;row<4;row++) for(let i=0;i<n;i++) {
      if(broken && i>n*.52 && row>1 && rand()<.72) continue;
      const px=(i+.5)*length/n-length*.5+(row%2?.13:0);
      const b=box(row%2?stone:edgeStone,px,.59+row*.43,0,length/n-.035,.4,.69,w);
      if(broken && i>n*.55) b.rotation.z=range(-.12,.12);
    }
    if(!broken) { box(paleStone,0,2.13,0,length+.2,.17,.91,w); roof(w,length+.5,1.15,2.25,.31); }
    for(const sign of [-1,1]) { box(paleStone,sign*length*.48,1.21,0,.45,2.42,.95,w); box(darkStone,sign*length*.48,2.46,0,.64,.13,1.09,w); }
  }
  wall(-11.8,-20,12); wall(11.8,-20,12);
  wall(-20,-4,17,Math.PI/2); wall(20,-4,17,Math.PI/2);
  wall(-20,10.4,5.7,Math.PI/2,true); wall(20,10.8,5.2,Math.PI/2,true);

  function lion(x,z,side) {
    const p=new THREE.Group();p.position.set(x,0,z);p.rotation.y=side*.18;root.add(p);
    box(darkStone,0,.2,0,1.48,.4,1.7,p);box(paleStone,0,.43,0,1.31,.14,1.51,p);
    mesh(sphereGeo,paleStone,0,1.02,.13,.46,.67,.56,p);
    mesh(sphereGeo,stone,0,1.66,-.04,.53,.56,.49,p);
    mesh(sphereGeo,paleStone,0,1.68,.34,.36,.29,.27,p);
    for(const s of [-1,1]) {mesh(sphereGeo,stone,s*.32,1.98,-.03,.19,.24,.18,p);mesh(sphereGeo,darkStone,s*.17,1.79,.53,.04,.045,.025,p);box(paleStone,s*.34,.75,.46,.23,.47,.31,p);}
    for(let i=0;i<7;i++) {const a=i*Math.PI/3.5;mesh(sphereGeo,stone,Math.sin(a)*.47,1.71+Math.cos(a)*.4,-.1,.16,.17,.2,p);}
    const tail=mesh(new THREE.TorusGeometry(.23,.09,4,7,Math.PI*1.55),stone,.37,1.02,-.42,1,1,1,p);tail.rotation.y=Math.PI/2;
    mesh(sphereGeo,ochreStone,side*.38,.64,.64,.2,.2,.2,p);
    obstacles.push({x,z,radius:.93});
  }
  lion(-7.1,-14,-1);lion(7.1,-14,1);

  // Bamboo and angular maple canopies frame the court without masking its playable area.
  const foliage = [];
  function tree(x,z,scale=1,kind='maple') {
    const p=new THREE.Group();p.position.set(x,0,z);root.add(p);
    const top = new THREE.Vector3(.32*scale,4.3*scale,0);
    segment(new THREE.Vector3(0,0,0),top,.19*scale,bark,p);
    for(let i=0;i<6;i++) {
      const a=i*2.41, h=range(2.2,3.4)*scale;
      const end=new THREE.Vector3(Math.cos(a)*range(1.1,2.2)*scale,h+range(.7,1.5)*scale,Math.sin(a)*range(1.1,1.9)*scale);
      segment(new THREE.Vector3(.17*scale,h,0),end,.08*scale,bark,p);
      if(kind==='dead') {segment(end,end.clone().add(new THREE.Vector3(Math.cos(a)*.5,.45,Math.sin(a)*.5)),.035,bark,p);continue;}
      for(let k=0;k<3;k++) foliage.push({x:x+end.x+range(-.6,.6)*scale,y:end.y+range(-.05,.55)*scale,z:z+end.z+range(-.6,.6)*scale,sx:range(.8,1.45)*scale,sy:range(.42,.75)*scale,sz:range(.75,1.3)*scale,color:kind==='ginkgo'?3:k%3});
    }
    if(Math.abs(x)<17)obstacles.push({x,z,radius:.45*scale});
  }
  tree(-21,4,1.2);tree(22,5,1.25);tree(-16.7,14.7,.9);tree(17,15.5,.85,'ginkgo');tree(-25,-6,1.3,'ginkgo');tree(25,-7,1.2);tree(-25,14,1.1,'dead');tree(24,16,1,'dead');
  leafMats.forEach((material,index)=>{
    const list=foliage.filter(f=>f.color===index);if(!list.length)return;
    const canopy=new THREE.InstancedMesh(sphereGeo,material,list.length);
    list.forEach((f,i)=>{temp.position.set(f.x,f.y,f.z);temp.rotation.set(range(0,.3),rand()*6,range(-.2,.2));temp.scale.set(f.sx,f.sy,f.sz);temp.updateMatrix();canopy.setMatrixAt(i,temp.matrix);});canopy.castShadow=true;root.add(canopy);
  });
  const bambooLeaves=[];
  function bambooPatch(x,z,count=8) {
    for(let i=0;i<count;i++) {
      const bx=x+range(-1.8,1.8),bz=z+range(-1.5,1.5),height=range(3.2,5.7),lean=range(-.3,.3);
      segment(new THREE.Vector3(bx,0,bz),new THREE.Vector3(bx+lean,height,bz+.14),range(.055,.09),bambooMat);
      for(let h=.6;h<height;h+=.61) {cyl(bambooJoint,bx+lean*h/height,h,bz+.14*h/height,.088,.047); if(h<height*.53)continue;
        const sign=i%2?-1:1; const end=new THREE.Vector3(bx+sign*.79,h+.26,bz+range(-.3,.3));segment(new THREE.Vector3(bx,h,bz),end,.021,bambooMat);
        for(let j=0;j<3;j++) bambooLeaves.push({x:end.x+sign*j*.13,y:end.y+range(-.13,.17),z:end.z+range(-.25,.25),angle:sign*(.5+j*.3)});
      }
    }
  }
  bambooPatch(-23,-1,11);bambooPatch(23,0,11);bambooPatch(-18,-15,6);bambooPatch(19,-15,6);
  const leafGeo=new THREE.BufferGeometry();leafGeo.setAttribute('position',new THREE.Float32BufferAttribute([0,0,0,.15,.02,.36,0,0,.78,-.13,.01,.32],3));leafGeo.setIndex([0,1,2,0,2,3]);leafGeo.computeVertexNormals();
  const bambooLeafMesh=new THREE.InstancedMesh(leafGeo,mat(0x425b3d,{side:THREE.DoubleSide}),bambooLeaves.length);
  bambooLeaves.forEach((l,i)=>{temp.position.set(l.x,l.y,l.z);temp.rotation.set(.15,l.angle,range(-.3,.3));temp.scale.set(1,1,1);temp.updateMatrix();bambooLeafMesh.setMatrixAt(i,temp.matrix);});bambooLeafMesh.castShadow=true;root.add(bambooLeafMesh);

  function stoneLamp(x,z) {
    cyl(darkStone,x,.2,z,.6,.4);cyl(paleStone,x,.68,z,.21,.66);box(paleStone,x,1.05,z,.73,.17,.73);
    const light=mat(0xf3c17b,{emissive:0xe8a354,emissiveIntensity:1.1});box(light,x,1.39,z,.44,.57,.44);
    for(const sx of [-1,1])for(const sz of [-1,1])box(darkStone,x+sx*.25,1.39,z+sz*.25,.07,.65,.07);
    const cap=mesh(new THREE.ConeGeometry(.66,.44,4),roofMat,x,1.89,z);cap.rotation.y=Math.PI/4;cyl(gold,x,2.16,z,.06,.2);
    obstacles.push({x,z,radius:.57});
  }
  stoneLamp(-15.9,-7);stoneLamp(15.9,-7);stoneLamp(-16,6.5);stoneLamp(16,6.5);

  const flags=[];
  const flagMap=texture(256,(c,s)=>{c.fillStyle='#81392d';c.fillRect(0,0,s,s);c.strokeStyle='#b69855';c.lineWidth=7;c.strokeRect(12,12,s-24,s-24);c.fillStyle='#c0a461';c.textAlign='center';c.textBaseline='middle';c.font='bold 116px serif';c.fillText('魂',128,128);for(let i=0;i<1200;i++){c.globalAlpha=.13;c.fillStyle='#201e18';c.fillRect(rand()*s,rand()*s,2,2);}});
  function flag(x,z,angle) {
    const p=new THREE.Group();p.position.set(x,0,z);p.rotation.y=angle;root.add(p);
    cyl(wood,0,2.3,0,.055,4.6,p);mesh(coneGeo,gold,0,4.79,0,.12,.36,.12,p);segment(new THREE.Vector3(0,4.35,0),new THREE.Vector3(1.37,4.35,0),.035,wood,p);
    const g=new THREE.PlaneGeometry(1.24,2.1,5,8);g.translate(.68,3.23,0);
    const m=mesh(g,mat(0xffffff,{map:flagMap,side:THREE.DoubleSide}),0,0,0,1,1,1,p);m.userData.animated=true;flags.push({mesh:m,original:Float32Array.from(g.attributes.position.array),phase:rand()*6});
    cyl(darkStone,0,.16,0,.25,.32,p);
  }
  flag(-17.3,-11,.2);flag(17.5,-11,-.8);flag(-20.2,10,-.3);flag(20.6,10,.7);
  for(let i=0;i<30;i++){const side=i%2?-1:1;rock(side*range(18.1,21.5),range(8,14),range(.17,.61));}

  // Faceted silhouettes are softened by the main scene's atmospheric fog.
  const mountainMats=[mat(0x607777),mat(0x6e8280),mat(0x82948b)];
  for(let i=0;i<15;i++) {
    const x=-52+i*7.5, z=range(-49,-38), h=range(9,23);
    const m=mesh(new THREE.ConeGeometry(range(7,13),h,5,1),mountainMats[i%3],x,h*.5-2,z,1,1,range(.65,1.1));m.rotation.y=rand()*6;m.castShadow=false;
    if(i%3===0){const crag=mesh(sphereGeo,darkStone,x,range(9,16),z+5,range(2,3),range(3,5),range(1.7,2.8));crag.castShadow=false;}
  }
  // A weathered welcome marker, seen obliquely from the camera, anchors the front corners.
  for(const side of [-1,1]) {
    const p=new THREE.Group();p.position.set(side*22,.1,17);p.rotation.z=side*.08;root.add(p);
    box(darkStone,0,.17,0,1.3,.34,1.1,p);box(stone,0,1.03,0,.87,1.63,.46,p);box(paleStone,0,1.88,0,1.05,.16,.66,p);
    for(let j=0;j<3;j++)box(ochreStone,0,1.47-j*.29,.24,.24,.07,.015,p);
  }

  const leafCount=66,dustCount=28;
  const flyingLeafGeo=new THREE.BufferGeometry();flyingLeafGeo.setAttribute('position',new THREE.Float32BufferAttribute([0,0,-.16,.11,.035,-.02,.04,0,.13,-.09,-.015,.04],3));flyingLeafGeo.setIndex([0,1,2,0,2,3]);flyingLeafGeo.computeVertexNormals();
  const flyingLeaves=new THREE.InstancedMesh(flyingLeafGeo,mat(0xbc8241,{side:THREE.DoubleSide}),leafCount);flyingLeaves.instanceMatrix.setUsage(THREE.DynamicDrawUsage);flyingLeaves.castShadow=false;root.add(flyingLeaves);
  const leaves=Array.from({length:leafCount},()=>({x:range(-22,22),y:range(.4,7),z:range(-17,17),speed:range(.2,.63),phase:rand()*Math.PI*2,spin:range(-1.8,1.8),scale:range(.55,1.4)}));
  const dustGeo=new THREE.BufferGeometry();const dustPositions=new Float32Array(dustCount*3);const dust=[];
  for(let i=0;i<dustCount;i++){dust.push({x:range(-22,22),y:range(.2,4),z:range(-19,16),phase:rand()*6});}
  dustGeo.setAttribute('position',new THREE.BufferAttribute(dustPositions,3));
  const dustPoints=new THREE.Points(dustGeo,new THREE.PointsMaterial({color:0xf5dbad,size:.042,transparent:true,opacity:.42,depthWrite:false,sizeAttenuation:true}));root.add(dustPoints);
  // Batch decorative construction by material. Thousands of hand-built roof, wall and
  // bamboo pieces cost only a few dozen draws; animated cloth and lights stay separate.
  root.updateMatrixWorld(true);
  const batches=new Map();
  root.traverse(o=>{
    if(!o.isMesh||o.isInstancedMesh||o.userData.animated)return;
    const key=`${o.material.uuid}:${o.castShadow}:${o.receiveShadow}`;
    if(!batches.has(key))batches.set(key,{material:o.material,cast:o.castShadow,receive:o.receiveShadow,objects:[],geometries:[]});
    const batch=batches.get(key);
    const g=(o.geometry.index?o.geometry.toNonIndexed():o.geometry.clone()).applyMatrix4(o.matrixWorld);
    // Roofs, rocks and primitives carry the same position/normal/uv attribute set.
    // The handcrafted roof intentionally needs no UVs, so fill them before merging.
    if(!g.attributes.uv)g.setAttribute('uv',new THREE.BufferAttribute(new Float32Array(g.attributes.position.count*2),2));
    batch.objects.push(o);batch.geometries.push(g);
  });
  batches.forEach(batch=>{
    const geometry=mergeGeometries(batch.geometries,false);
    if(geometry){const m=new THREE.Mesh(geometry,batch.material);m.castShadow=batch.cast;m.receiveShadow=batch.receive;root.add(m);batch.objects.forEach(o=>o.removeFromParent());}
    batch.geometries.forEach(g=>g.dispose());
  });
  const prune=group=>{for(const child of [...group.children])if(child.isGroup){prune(child);if(child.children.length===0)group.remove(child);}};
  prune(root);
  let environmentTime=0,environmentInitialized=false;
  const wrap=(value,minimum,span)=>minimum+((value-minimum)%span+span)%span;
  function update(dt) {
    // Keep every environmental layer on the same simulation clock. The caller's
    // wall clock can keep running during pause without moving cloth or fire.
    const elapsed=Number.isFinite(dt)?Math.max(0,dt):0;
    if(environmentInitialized&&elapsed===0)return;
    environmentInitialized=true;
    environmentTime+=elapsed;
    const time=environmentTime;
    flags.forEach(f=>{
      const pos=f.mesh.geometry.attributes.position;
      for(let i=0;i<pos.count;i++){const x=f.original[i*3],y=f.original[i*3+1];const looseness=Math.max(0,(4.29-y)/2.1);pos.array[i*3+2]=Math.sin(time*2.6+x*3.5+f.phase)*.12*looseness+Math.sin(time*1.45+y*2)*.08*looseness;pos.array[i*3]=x+Math.sin(time*1.7+y+f.phase)*.04*looseness;}
      pos.needsUpdate=true;f.mesh.geometry.computeVertexNormals();
    });
    lanternFlames.forEach(f=>{const flicker=1+Math.sin(time*9+f.phase)*.12+Math.sin(time*16+f.phase)*.06;f.mesh.scale.y=.35*flicker;f.shell.material.emissiveIntensity=.76+flicker*.13;});
    // Analytic drift and wrap avoid capped-dt slowdowns and frame-dependent
    // random respawns. A long frame advances exactly as far as small frames.
    leaves.forEach((l,i)=>{
      const x=wrap(l.x+time*.26,-24,48),y=wrap(l.y-time*l.speed,.12,6.9),z=wrap(l.z+time*.13,-18,36);
      temp.position.set(x+Math.sin(time*.7+l.phase)*.42,y,z+Math.cos(time*.5+l.phase)*.4);
      temp.rotation.set(time*l.spin,l.phase+time*.4,Math.sin(time+l.phase));temp.scale.setScalar(l.scale);temp.updateMatrix();flyingLeaves.setMatrixAt(i,temp.matrix);
    });flyingLeaves.instanceMatrix.needsUpdate=true;
    dust.forEach((d,i)=>{dustPositions[i*3]=d.x+Math.sin(time*.13+d.phase)*.8;dustPositions[i*3+1]=d.y+Math.sin(time*.45+d.phase)*.23;dustPositions[i*3+2]=d.z+Math.cos(time*.15+d.phase)*.65;});dustGeo.attributes.position.needsUpdate=true;
  }
  update(0,0);
  return {bounds,obstacles,lanternLights,root,update};
}
