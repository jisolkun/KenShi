import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

// All art is procedural. Warm limestone, cinnabar timber, and mineral-green roofs.
const materials = new Map();
const geometries = new Map();
function mat(color, opts = {}) {
  const key = `${color}:${JSON.stringify(opts)}`;
  if (!materials.has(key)) materials.set(key, new THREE.MeshStandardMaterial({ color, roughness: .86, metalness: 0, flatShading: true, ...opts }));
  return materials.get(key);
}
function boxGeo() {
  if (!geometries.has('box')) geometries.set('box', new THREE.BoxGeometry(1, 1, 1));
  return geometries.get('box');
}
function mesh(parent, geometry, material, x=0, y=0, z=0, scale=[1,1,1]) {
  const m = new THREE.Mesh(geometry, material);
  m.position.set(x,y,z); m.scale.set(...scale); m.castShadow = true; m.receiveShadow = true;
  parent.add(m); return m;
}
function box(parent, color, x,y,z,w,h,d, opts) { return mesh(parent, boxGeo(), mat(color,opts),x,y,z,[w,h,d]); }
function cyl(parent,color,x,y,z,r1,r2,h,sides=8) { return mesh(parent,new THREE.CylinderGeometry(r1,r2,h,sides),mat(color),x,y,z); }
function ico(parent,color,x,y,z,w,h,d,detail=0) {
  const key=`ico${detail}`;
  if(!geometries.has(key)) geometries.set(key,new THREE.IcosahedronGeometry(1,detail));
  return mesh(parent,geometries.get(key),mat(color),x,y,z,[w,h,d]);
}
function beam(parent,a,b,r,color,sides=6) {
  const va = new THREE.Vector3(...a), vb = new THREE.Vector3(...b), direction = vb.clone().sub(va);
  const m=mesh(parent,new THREE.CylinderGeometry(r*.8,r,direction.length(),sides),mat(color));
  m.position.copy(va.add(vb).multiplyScalar(.5)); m.quaternion.setFromUnitVectors(new THREE.Vector3(0,1,0),direction.normalize());return m;
}
function ring(parent,radius,width,y,color,segments=64) {
  const m=mesh(parent,new THREE.RingGeometry(radius-width,radius,segments),mat(color,{side:THREE.DoubleSide}),0,y,0);
  m.rotation.x=-Math.PI/2;m.castShadow=false;return m;
}
function seeded(seed=51) { return () => { seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296; }; }

// Bake scenery by material, keeping moving roots and the floor's instances intact.
// Hundreds of hand-placed decorative pieces therefore cost only a few draw calls.
function batchScenery(root, excluded = new Set()) {
  root.updateWorldMatrix(true,true);
  const inverse=root.matrixWorld.clone().invert(), buckets=new Map(), removed=[];
  function visit(node) {
    if(excluded.has(node))return;
    if(node.isMesh&&!node.isInstancedMesh) {
      const key=`${node.material.uuid}:${node.castShadow}:${node.receiveShadow}`;
      if(!buckets.has(key))buckets.set(key,{material:node.material,cast:node.castShadow,receive:node.receiveShadow,geometries:[]});
      const geo=node.geometry.index?node.geometry.toNonIndexed():node.geometry.clone();
      for(const name of Object.keys(geo.attributes))if(name!=='position'&&name!=='normal')geo.deleteAttribute(name);
      geo.applyMatrix4(new THREE.Matrix4().multiplyMatrices(inverse,node.matrixWorld));
      buckets.get(key).geometries.push(geo);removed.push(node);
    }
    for(const child of node.children)visit(child);
  }
  for(const child of root.children)visit(child);
  removed.forEach(node=>node.removeFromParent());
  for(const bucket of buckets.values()) {
    const merged=mergeGeometries(bucket.geometries,false);
    const m=new THREE.Mesh(merged,bucket.material);m.castShadow=bucket.cast;m.receiveShadow=bucket.receive;root.add(m);
    bucket.geometries.forEach(geo=>geo.dispose());
  }
}

function tiledFloor(parent) {
  const random=seeded(41), palette=['#b8b8a0','#c3c3ad','#d0cfb9','#c6c7b3','#adb4a0','#d5d1b9'];
  const tiles=palette.map(()=>[]), dummy=new THREE.Object3D();
  for(let iz=0;iz<14;iz++) for(let ix=0;ix<18;ix++) {
    const x=(ix-8.5)*1.55+(iz%2?.28:0),z=(iz-6.5)*1.55;
    if(Math.abs(x)>13.6)continue;
    tiles[Math.floor(random()*palette.length)].push([x,-.082+random()*.012,z,1.52,.13,1.515]);
  }
  tiles.forEach((items,i)=>{
    const batch=new THREE.InstancedMesh(boxGeo(),mat(palette[i]),items.length);
    items.forEach((p,j)=>{dummy.position.set(p[0],p[1],p[2]);dummy.scale.set(p[3],p[4],p[5]);dummy.updateMatrix();batch.setMatrixAt(j,dummy.matrix);});
    batch.receiveShadow=true;batch.castShadow=false;parent.add(batch);
  });
  // Finely spaced pavement seams and worn garden edges remain readable at game scale.
  box(parent,'#849386',0,-.31,0,30,.5,25);
  for(const side of [-1,1]) {
    box(parent,'#a0a895',side*14.25,-.10,0,.6,.25,23.6);
    box(parent,'#d4c9a9',side*13.89,.025,0,.10,.07,23.6);
  }
  for(const z of [-11.6,11.6])box(parent,'#a0a895',0,-.10,z,28.7,.25,.6);
  ring(parent,4.2,.04,.004,'#849e92');ring(parent,3.82,.026,.005,'#a2ac96');
  ring(parent,1.58,.022,.005,'#a2ac96');
  for(let i=0;i<12;i++) {
    const a=i*Math.PI/6, rune=box(parent,'#899c89',Math.sin(a)*3.97,.007,Math.cos(a)*3.97,.065,.015,.19);
    rune.rotation.y=a;
  }
  // Pale central seal is painted directly onto the stone.
  const seal=new THREE.Group();parent.add(seal);seal.rotation.y=Math.PI/4;
  box(seal,'#a8ad94',0,.003,0,1.04,.008,.05);box(seal,'#a8ad94',0,.003,0,.05,.008,1.04);
}

function roof(parent,x,y,z,width,depth,height=1.3) {
  const g=new THREE.Group();g.position.set(x,y,z);parent.add(g);
  const verts=[], inds=[];
  const outer=[[-1,-1],[0,-1],[1,-1],[1,0],[1,1],[0,1],[-1,1],[-1,0]];
  outer.forEach(([px,pz])=>verts.push(px*width*.5,(px!==0&&pz!==0)?.32:0,pz*depth*.5));
  outer.forEach(([px,pz])=>verts.push(px*width*.34,height,pz*depth*.08));
  for(let i=0;i<8;i++){const n=(i+1)%8;inds.push(i,n,i+8,n,n+8,i+8);}
  const geo=new THREE.BufferGeometry();geo.setAttribute('position',new THREE.Float32BufferAttribute(verts,3));geo.setIndex(inds);geo.computeVertexNormals();
  mesh(g,geo,mat('#355958',{side:THREE.DoubleSide}));
  // Tile ribs echo the rhythm of traditional glazed ceramic roofs.
  for(let i=-8;i<=8;i++) {
    const xx=i*width/18;
    for(const s of [-1,1])beam(g,[xx,height,.08*depth*s],[xx*1.36,.045,.49*depth*s],.026,'#54716a',5);
  }
  for(const s of [-1,1])beam(g,[-width*.49,.15,depth*.5*s],[width*.49,.15,depth*.5*s],.066,'#6d8876');
  beam(g,[-width*.36,height+.02,0],[width*.36,height+.02,0],.1,'#719281');
  for(const s of [-1,1]){
    beam(g,[s*width*.35,height,0],[s*width*.41,height+.24,0],.055,'#baa568');
    ico(g,'#c0ab6b',s*width*.414,height+.27,0,.1,.17,.1);
  }
  return g;
}
function lantern(parent,x,y,z,animated) {
  const pivot=new THREE.Group();pivot.position.set(x,y,z);parent.add(pivot);
  beam(pivot,[0,0,0],[0,-.34,0],.021,'#766447');
  const lamp=mesh(pivot,new THREE.CylinderGeometry(.25,.25,.52,8),mat('#ebac67',{emissive:'#df7d36',emissiveIntensity:.32}),0,-.59,0);
  cyl(pivot,'#795240',0,-.3,0,.29,.29,.08);cyl(pivot,'#795240',0,-.88,0,.29,.29,.08);
  for(let i=0;i<8;i++) { const a=i*Math.PI/4;beam(pivot,[Math.sin(a)*.25,-.34,Math.cos(a)*.25],[Math.sin(a)*.25,-.84,Math.cos(a)*.25],.012,'#a45734'); }
  beam(pivot,[0,-.92,0],[0,-1.14,0],.018,'#be683a');
  animated.push({object:pivot,phase:x+z,amplitude:.06,axis:'z'}); return lamp;
}
function gate(parent,animated) {
  const hall=new THREE.Group();hall.position.set(0,0,-13.8);parent.add(hall);
  box(hall,'#acafa0',0,.13,0,11,.3,4.8);
  box(hall,'#c5c4ab',0,.37,.6,9.6,.22,3.8);
  for(const x of [-4.2,-1.95,1.95,4.2]) {
    cyl(hall,'#9c493b',x,2.25,.8,.17,.23,3.9,8);
    cyl(hall,'#d1b273',x,.6,.8,.28,.3,.18,8);
    box(hall,'#6f483a',x,3.94,.8,.5,.18,.65);
  }
  box(hall,'#a65441',0,3.8,.8,9.6,.38,.4);
  box(hall,'#ccad70',0,4.025,1.03,9.8,.075,.08);
  // Carved brackets and double roof give the gate a strong, unmistakable silhouette.
  for(const x of [-4.2,-1.95,1.95,4.2])for(const s of [-1,1]) {
    box(hall,'#ae7552',x+s*.18,3.7,.83,.15,.34,.66);
    box(hall,'#b39260',x+s*.24,3.91,.83,.54,.12,.88);
  }
  roof(hall,0,4.15,.2,11.5,5.6,1.34);
  box(hall,'#954c3c',0,5.56,.05,5.7,.64,1.35);
  roof(hall,0,6.02,.03,7.7,3.15,1.04);
  box(hall,'#273e39',0,3.95,1.10,2.8,.73,.12);
  box(hall,'#bca16a',0,4.32,1.18,2.91,.055,.05);
  box(hall,'#bca16a',0,3.59,1.18,2.91,.055,.05);
  // Three abstract brush glyphs rendered with tiny golden wooden strokes.
  for(const x of [-.76,0,.76]) {
    box(hall,'#d3bd7f',x,3.96,1.20,.30,.035,.035);
    box(hall,'#d3bd7f',x,3.96,1.21,.035,.34,.035);
    const b=box(hall,'#d3bd7f',x,3.95,1.22,.035,.36,.035);b.rotation.z=.7;
  }
  for(const x of [-3.1,3.1])lantern(hall,x,3.71,1.05,animated);
  for(let i=0;i<3;i++)box(parent,'#c6c4aa',0,.07+i*.07,-11.0-i*.55,6.3-i*.15,.15,.6);
  // Quiet temple buildings beyond the gate.
  for(const x of [-8,8]) {
    box(parent,'#bbb39b',x,1.65,-17.1,4.7,3.2,3.8);
    for(let i=-1;i<=1;i++)box(parent,'#664e42',x+i*1.35,1.7,-15.16,.12,2.8,.15);
    box(parent,'#9e6350',x,2.9,-15.1,4.9,.30,.2);
    roof(parent,x,3.3,-17.1,6.4,5.1,1.15);
    for(const off of [-1.2,1.2]) {
      box(parent,'#596a5c',x+off,1.8,-15.12,.87,1.3,.04);
      for(let k=-2;k<=2;k++)box(parent,'#a99b72',x+off+k*.14,1.8,-15.06,.045,1.35,.05);
    }
  }
}
function rock(parent,x,z,s,random) {
  const stone=ico(parent,['#75887c','#849589','#a1aa97'][Math.floor(random()*3)],x,s*.34,z,s*.73,s*.56,s*.6);
  stone.rotation.set(random()*.25,random()*Math.PI,random()*.2);
  if(s>.9)ico(parent,'#6f8b67',x-s*.14,s*.64,z,.44*s,.12*s,.42*s);
}
function pine(parent,x,z,height,random,animated) {
  const tree=new THREE.Group();parent.add(tree);tree.position.set(x,0,z);
  const lean=(random()-.5)*.8;
  beam(tree,[0,0,0],[lean,height*.5,0],.22,'#6a6951');
  beam(tree,[lean,height*.5,0],[lean+.15,height*.88,.12],.12,'#77705b');
  for(let i=0;i<5;i++) {
    const a=i*2.15, y=height*(.4+i*.105),reach=height*(.36-i*.035);
    const ex=lean+Math.cos(a)*reach,ez=Math.sin(a)*reach;
    beam(tree,[lean,y,0],[ex,y+.23,ez],.075,'#746b53');
    const canopy=new THREE.Group();canopy.position.set(ex,y+.3,ez);tree.add(canopy);
    ico(canopy,i%2?'#4c7060':'#3e6054',0,0,0,reach*.74,.40,reach*.56,1);
    ico(canopy,'#6e8870',-.12,.19,.06,reach*.59,.22,reach*.49);
  }
  ico(tree,'#52735e',lean+.15,height*.95,.12,height*.28,.45,height*.23,1);
  animated.push({object:tree,phase:x,amplitude:.012,axis:'z'});
}
function bamboo(parent,x,z,random) {
  const g=new THREE.Group();g.position.set(x,0,z);parent.add(g);
  for(let i=0;i<7;i++) {
    const xx=(random()-.5)*1.35, zz=(random()-.5)*1.2,h=2.7+random()*1.7;
    const pole=beam(g,[xx,0,zz],[xx+.12,h,zz-.08],.043,'#658570');
    for(let j=1;j<h/.43;j++)cyl(g,'#a3b28b',xx+.12*j*.43/h,j*.43,zz-.08*j*.43/h,.052,.052,.035,6);
    for(let j=0;j<3;j++) {
      const y=h*(.55+j*.15),s=j%2?-1:1;
      beam(g,[xx,y,zz],[xx+s*.55,y+.15,zz+.2],.017,'#617b57');
      for(let k=0;k<3;k++) {
        const leaf=ico(g,'#5e7f5f',xx+s*(.22+k*.18),y+.16,zz+.15,.29,.04,.10);
        leaf.rotation.y=s*.55;
      }
    }
  }
}
function stoneLamp(parent,x,z,animated) {
  const g=new THREE.Group();g.position.set(x,0,z);parent.add(g);
  box(g,'#969e89',0,.14,0,.83,.28,.83);
  cyl(g,'#a7aa92',0,.59,0,.22,.28,.72,6);
  box(g,'#afb297',0,1.08,0,.78,.17,.78);
  box(g,'#ecc67c',0,1.40,0,.45,.53,.45,{emissive:'#de9249',emissiveIntensity:.35});
  for(const xx of [-.29,.29])for(const zz of [-.29,.29])box(g,'#7c8975',xx,1.42,zz,.11,.65,.11);
  const top=mesh(g,new THREE.ConeGeometry(.72,.41,4),mat('#7e8e7a'),0,1.91,0);top.rotation.y=Math.PI/4;
  cyl(g,'#9b9f82',0,2.2,0,.08,.13,.2,6);
}
function wall(parent,x,side) {
  box(parent,'#aeb39f',x,.70,-.9,.42,1.25,22);
  box(parent,'#718573',x,1.37,-.9,.66,.16,22.2);
  for(let z=-11;z<=10;z+=3.5) {
    box(parent,'#a6aa94',x,.90,z,.76,1.85,.76);
    box(parent,'#70816e',x,1.92,z,1,.22,1);
    const cap=mesh(parent,new THREE.ConeGeometry(.68,.24,4),mat('#627b69'),x,2.14,z);cap.rotation.y=Math.PI/4;
    box(parent,'#c4b58d',x+side*.40,1.12,z,.04,.12,.46);
  }
}
function banner(parent,x,z,animated) {
  const g=new THREE.Group();g.position.set(x,0,z);parent.add(g);
  box(g,'#9e9e84',0,.2,0,.8,.4,.8);
  beam(g,[0,.4,0],[0,4.5,0],.055,'#776850');
  beam(g,[-.55,4.18,0],[.55,4.18,0],.04,'#ad9160');
  const flag=new THREE.Group();flag.position.y=4.12;g.add(flag);
  box(flag,'#9b4d40',0,-.90,0,.87,1.8,.035);
  box(flag,'#c3a86c',0,-.025,.026,.86,.045,.025);
  box(flag,'#c3a86c',-.36,-.87,.026,.035,1.68,.025);
  box(flag,'#c3a86c',.36,-.87,.026,.035,1.68,.025);
  const lozenge=box(flag,'#c7b17a',0,-.83,.03,.26,.26,.03);lozenge.rotation.z=Math.PI/4;
  box(flag,'#c7b17a',0,-.84,.055,.025,.65,.025);
  animated.push({object:flag,phase:x,amplitude:.04,axis:'x'});
}
function mountain(parent,x,z,h,w,color,random) {
  const n=7,verts=[],indices=[];
  for(let level=0;level<3;level++)for(let i=0;i<n;i++) {
    const a=i/n*Math.PI*2,r=(level===0?1:level===1?.59:.11)*(1+random()*.15);
    verts.push(x+Math.cos(a)*w*r+(level===2?-w*.14:0),level*h*.47+(level?random()*h*.15:0),z+Math.sin(a)*w*.62*r);
  }
  verts.push(x-w*.14,h,z);
  for(let l=0;l<2;l++)for(let i=0;i<n;i++){let a=l*n+i,b=l*n+(i+1)%n,c=a+n,d=b+n;indices.push(a,b,c,b,d,c);}
  for(let i=0;i<n;i++)indices.push(n*2+i,n*2+(i+1)%n,21);
  const geo=new THREE.BufferGeometry();geo.setAttribute('position',new THREE.Float32BufferAttribute(verts,3));geo.setIndex(indices);geo.computeVertexNormals();
  const m=mesh(parent,geo,mat(color));m.castShadow=false;
}

export function buildWorld(scene) {
  const group=new THREE.Group();group.name='The Jade Gate Courtyard';scene.add(group);
  const random=seeded(777),animated=[];
  tiledFloor(group);gate(group,animated);wall(group,-14.55,1);wall(group,14.55,-1);
  // Gardens frame the playable rectangle, never hiding its combat floor.
  for(const s of [-1,1]) {
    box(group,'#809279',s*17,-.21,-1,4.0,.35,27);
    for(let i=0;i<14;i++)rock(group,s*(15.7+random()*3.1),-13+random()*26,.5+random()*1.1,random);
    pine(group,s*17,-8,5.6,random,animated);pine(group,s*18,-1,4.7,random,animated);
    pine(group,s*17.4,8.1,4.4,random,animated);
    bamboo(group,s*16.4,-12,random);bamboo(group,s*16.2,3.4,random);
    stoneLamp(group,s*12.7,-9.9,animated);stoneLamp(group,s*12.7,9.9,animated);
    banner(group,s*8.1,-11.2,animated);
    // Cropped stones and reeds on the near edge add a diorama-like foreground.
    rock(group,s*10.4,12.9,1.4,random);rock(group,s*11.7,13.2,.7,random);
  }
  // Moss follows the joints instead of covering the clear arena.
  for(let i=0;i<48;i++) {
    const s=i%2?-1:1,x=s*(12.8+random()*.95),z=-10.8+random()*21.6;
    const patch=ico(group,['#789170','#8fa181','#9fa88b'][i%3],x,.016,z,.13+random()*.24,.02,.08+random()*.18);patch.castShadow=false;
  }
  for(let i=0;i<8;i++)mountain(group,-37+i*10,-30-random()*8,8+random()*12,6+random()*7,['#acbdb3','#a0b4aa','#b8c7be'][i%3],random);
  for(let i=0;i<5;i++)mountain(group,-31+i*15,-42,15+random()*11,10+random()*5,'#c3d0c7',random);
  // Floating ginkgo leaves are sparse enough to preserve gameplay readability.
  const leaves=[];
  for(let i=0;i<16;i++) {
    const leaf=ico(group,i%3?'#bdad72':'#ab754e',-13+random()*26,1+random()*5,-9+random()*18,.065,.014,.10);
    leaf.castShadow=false;leaves.push({object:leaf,start:leaf.position.clone(),phase:random()*10});
  }
  animated.forEach(a=>batchScenery(a.object));
  batchScenery(group,new Set([...animated.map(a=>a.object),...leaves.map(l=>l.object)]));
  return {
    bounds:{minX:-13,maxX:13,minZ:-10,maxZ:10},
    update(dt,time) {
      const t=time ?? 0;
      animated.forEach(a=>{a.object.rotation[a.axis]=Math.sin(t*.8+a.phase)*a.amplitude;});
      leaves.forEach(l=>{l.object.position.x=l.start.x+Math.sin(t*.22+l.phase)*1.7;l.object.position.y=.2+((l.start.y-t*.18)%5+5)%5;l.object.position.z=l.start.z+Math.cos(t*.3+l.phase)*.6;l.object.rotation.y=t*.7+l.phase;});
    }
  };
}

function sword(parent,heavy=false) {
  const weapon=new THREE.Group();parent.add(weapon);weapon.position.set(0,-.66,.13);
  cyl(weapon,'#665445',0,0,0,.048,.052,.30,6);
  cyl(weapon,'#d2af6d',0,-.18,0,.06,.06,.065,6);
  box(weapon,'#c5a164',0,.16,0,heavy?.37:.31,.08,.12);
  const blade=new THREE.Shape();
  blade.moveTo(-.065,.20);blade.lineTo(.105,.20);blade.lineTo(heavy?.25:.18,1.23);blade.lineTo(.035,1.52);blade.lineTo(-.08,1.30);blade.closePath();
  const geo=new THREE.ExtrudeGeometry(blade,{depth:heavy?.085:.045,bevelEnabled:false});
  const m=mesh(weapon,geo,mat('#dbe6df',{metalness:.72,roughness:.30}),0,0,-.02);
  beam(weapon,[-.067,.25,.035],[-.075,1.27,.035],.012,'#ffffff',4);
  return weapon;
}
function bow(parent) {
  const weapon=new THREE.Group();parent.add(weapon);weapon.position.set(0,-.58,.1);
  const pts=[[0,-.56,0],[.22,-.31,.02],[.30,0,.03],[.22,.34,.02],[0,.61,0]];
  for(let i=0;i<pts.length-1;i++)beam(weapon,pts[i],pts[i+1],.035,'#af9365');
  beam(weapon,pts[0],pts[4],.008,'#d6c8a6',4);box(weapon,'#705e4a',.28,0,.03,.085,.19,.085);return weapon;
}
function character(hero=false,type='soldier') {
  const g=new THREE.Group();g.name=hero?'Jade warrior':`Undead ${type}`;
  const brute=type==='brute'&&!hero, archer=type==='archer'&&!hero;
  const robe=hero?'#477b70':brute?'#76483c':archer?'#665768':'#845b51';
  const dark=hero?'#2f5751':brute?'#453d37':archer?'#45444f':'#56514a';
  const skin=hero?'#d9b58c':'#b5c5a2',trim=hero?'#cbb57b':'#a7a084';
  const body=new THREE.Group();body.position.y=1.2;g.add(body);
  box(body,robe,0,.08,0,.76,.79,.40);
  // Crossing lapels, belt, and segmented skirt make the tiny silhouettes legible.
  const lapel=box(body,hero?'#81a38b':'#b0a78d',-.10,.24,.221,.14,.59,.05);lapel.rotation.z=-.47;
  const lapel2=box(body,dark,.18,.25,.217,.1,.55,.05);lapel2.rotation.z=.42;
  box(body,dark,0,-.17,.018,.84,.13,.46);
  box(body,trim,.08,-.17,.27,.18,.12,.045);
  for(const s of [-1,1]) {
    const skirt=box(body,robe,s*.235,-.53,.035,.42,.57,.48);skirt.rotation.z=-s*.10;
    box(body,dark,s*.35,.35,0,.20,.19,.44);
  }
  const head=new THREE.Group();head.position.set(0,1.89,.01);g.add(head);
  mesh(head,new THREE.DodecahedronGeometry(.245,0),mat(skin),0,0,0,[.87,1.09,.88]);
  box(head,'#303c33',0,.13,-.038,.40,.19,.37);
  ico(head,'#2b3931',0,.31,-.05,.115,.11,.105);
  if(hero) {
    box(head,'#c9ad6e',0,.14,.16,.42,.045,.045);
    box(head,'#485c4a',-.145,-.012,.202,.075,.025,.019);box(head,'#485c4a',.145,-.012,.202,.075,.025,.019);
    // Xiahou Dun's ivory eye wrap and bronze pauldron survive the distant camera.
    box(head,'#d7c7a0',-.112,-.005,.227,.135,.10,.038);
    const strap=box(head,'#bda77c',0,.012,.213,.405,.035,.018);strap.rotation.z=.12;
    box(body,'#a78f60',-.365,.36,.018,.34,.18,.48);
    box(body,'#ccba83',-.365,.41,.26,.29,.05,.045);
    box(body,'#8d835f',-.29,.22,.247,.23,.13,.057);
  } else {
    for(const s of [-1,1])box(head,'#d2e8a7',s*.10,-.012,.207,.06,.035,.027,{emissive:'#c7e59b',emissiveIntensity:.8});
    box(head,'#6e7c63',0,-.13,.195,.08,.035,.025);
    const hat=mesh(head,new THREE.ConeGeometry(.32,.12,6),mat(dark),0,.245,0);hat.rotation.y=.2;
  }
  const arms=[];
  for(const s of [-1,1]) {
    const arm=new THREE.Group();arm.position.set(s*.47,1.55,0);g.add(arm);
    const sleeve=box(arm,robe,0,-.24,0,.30,.54,.35);sleeve.rotation.z=-s*.035;
    box(arm,dark,0,-.46,.025,.25,.13,.32);
    box(arm,skin,0,-.59,.03,.17,.18,.19);
    arms.push(arm);
  }
  const legs=[];
  for(const s of [-1,1]) {
    const leg=new THREE.Group();leg.position.set(s*.21,.75,0);g.add(leg);
    box(leg,dark,0,-.26,0,.24,.55,.26);
    box(leg,'#343e35',0,-.61,.065,.27,.26,.37);
    box(leg,trim,0,-.44,.15,.22,.05,.026);
    legs.push(leg);
  }
  arms[0].rotation.z=.08;arms[1].rotation.z=-.09;
  const weapon=archer?bow(arms[1]):sword(arms[1],brute);
  let scarf;
  if(hero) {
    scarf=new THREE.Group();scarf.position.set(-.10,1.66,-.20);g.add(scarf);
    box(scarf,'#c26e45',.11,-.01,.15,.70,.11,.15);
    const ribbon=box(scarf,'#c5784b',-.14,-.21,-.20,.20,.58,.045);ribbon.rotation.x=-.57;ribbon.rotation.z=-.18;
    const tail=box(scarf,'#db9260',-.23,-.44,-.47,.18,.46,.038);tail.rotation.x=-.90;tail.rotation.z=-.29;
    // A scabbard and shoulder clasp finish the hero's silhouette.
    const sheath=box(body,'#354d43',-.34,-.2,-.28,.12,1.18,.11);sheath.rotation.z=-.38;
    box(body,trim,-.3,.36,.25,.12,.12,.07);
  }
  if(brute) {
    g.scale.set(1.28,1.23,1.28);
    for(const s of [-1,1]) {
      box(body,'#8b8a73',s*.38,.38,0,.29,.20,.51);
      for(let k=0;k<3;k++)box(body,'#a9a68b',s*.38,.49,(k-1)*.15,.055,.04,.07);
    }
  }
  if(archer) {
    const quiver=box(body,'#5e5147',-.27,.07,-.36,.27,.80,.26);quiver.rotation.z=.15;
    for(let i=0;i<3;i++)beam(body,[-.33+i*.07,.25,-.36],[-.33+i*.07,.76,-.36],.016,'#c7b48a');
  }
  g.userData.rig={body,head,leftArm:arms[0],rightArm:arms[1],leftLeg:legs[0],rightLeg:legs[1],weapon,scarf};
  const sharedGeometries=new Set(geometries.values());
  g.userData.ownedGeometries=new Set();
  g.traverse(node=>{
    if(node.isMesh&&!sharedGeometries.has(node.geometry))g.userData.ownedGeometries.add(node.geometry);
  });
  return g;
}
export function createWarrior() { return character(true); }
export function createEnemy(type='soldier') { return character(false,type); }
