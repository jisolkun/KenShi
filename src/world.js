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

// The land continues well beyond both the camera and the playable boundary.
// Pavement is an excavated temple court inside a larger earth-and-stone landscape.
function tiledFloor(parent) {
  const random=seeded(41), palette=['#b9ad8c','#cbbd98','#d3c4a2','#a39f83','#b4ab91','#c5b799'];
  const land=mesh(parent,new THREE.PlaneGeometry(190,170),mat('#847852'),0,-.14,0);
  land.rotation.x=-Math.PI/2;land.castShadow=false;
  const soil=mesh(parent,new THREE.CircleGeometry(57,24),mat('#a49670'),0,-.115,2,[1.2,1,1]);
  soil.rotation.x=-Math.PI/2;soil.castShadow=false;
  // Uneven low patches, rather than a raised slab, join the court to the hillside.
  for(let i=0;i<48;i++) {
    const angle=random()*Math.PI*2,radius=27+random()*43;
    const px=Math.cos(angle)*radius,pz=Math.sin(angle)*radius;
    if(px>26&&px<60)continue;
    const patch=ico(parent,['#788064','#8c8963','#9d9068'][i%3],px,-.20,pz,3+random()*8,.16+random()*.10,2+random()*7);
    patch.castShadow=false;
  }
  const tiles=palette.map(()=>[]),dummy=new THREE.Object3D();
  for(let iz=0;iz<19;iz++)for(let ix=0;ix<23;ix++) {
    const x=(ix-11)*1.63+(iz%2?.56:0),z=(iz-9)*1.43;
    // Some edges and whole paving stones are lost to the dirt and weeds.
    if((Math.abs(x)>11.5||Math.abs(z)>9.5)&&random()<.62)continue;
    if(Math.abs(x)>7.5&&Math.abs(z)>5.5&&random()<.38)continue;
    if(random()<.055)continue;
    tiles[Math.floor(random()*palette.length)].push([x,.015+random()*.009,z,1.60,.07,1.40,(random()-.5)*.018]);
  }
  // Broad causeways break the rectangular rhythm and run into the outer lanes.
  for(const z of [-19,-17.4,-15.8,15,16.8,18.6,20.4])for(let ix=-2;ix<=2;ix++) {
    tiles[Math.floor(random()*palette.length)].push([ix*1.71,.012,z,1.66,.07,1.58,(random()-.5)*.025]);
  }
  for(const sign of [-1,1])for(let ix=0;ix<5;ix++)for(let iz=-1;iz<=1;iz++) {
    tiles[(ix+iz+6)%palette.length].push([sign*(19+ix*1.72),.012,iz*1.62+3,1.68,.065,1.58,random()*.02]);
  }
  tiles.forEach((items,i)=>{
    const batch=new THREE.InstancedMesh(boxGeo(),mat(palette[i]),items.length);
    items.forEach((p,j)=>{dummy.position.set(p[0],p[1],p[2]);dummy.scale.set(p[3],p[4],p[5]);dummy.rotation.y=p[6];dummy.updateMatrix();batch.setMatrixAt(j,dummy.matrix);});
    batch.receiveShadow=true;batch.castShadow=false;parent.add(batch);
  });
  // Worn garden soil cuts into the paving and gives each combat quadrant a landmark.
  for(const [x,z,rx,rz] of [[-10,-7,3.6,2.6],[11,7,4,2.8],[-13,5,3.1,3.5],[13,-7,3.4,3.5]]) {
    const patch=mesh(parent,new THREE.CircleGeometry(1,9),mat('#7c8059'),x,.062,z,[rx,rz,1]);patch.rotation.x=-Math.PI/2;patch.rotation.z=.25;patch.castShadow=false;
    const inner=mesh(parent,new THREE.CircleGeometry(1,8),mat('#8f8660'),x+.3,.064,z,[rx*.82,rz*.8,1]);inner.rotation.x=-Math.PI/2;inner.castShadow=false;
    for(let i=0;i<17;i++) {
      const a=random()*Math.PI*2,r=.7+random()*.45;
      const moss=ico(parent,i%2?'#687451':'#819163',x+Math.cos(a)*rx*r,.074,z+Math.sin(a)*rz*r,.15+random()*.25,.022,.1+random()*.15);moss.castShadow=false;
    }
  }
  // Small bands of worn brick, an offset shrine foundation, and an octagonal seal.
  for(const side of [-1,1])for(let i=-5;i<=5;i++) {
    if(i===1||i===-3)continue;
    box(parent,'#6d8172',side*18.65,-.025,i*2.35,.32,.08,2.25);
    box(parent,'#c7b58b',side*18.36,.014,i*2.35,.10,.035,2.20);
  }
  for(const z of [-13.7,13.7])for(let i=-7;i<=7;i++)if(Math.abs(i)>2) {
    box(parent,'#9a977a',i*2.45,-.026,z,2.36,.08,.33);
  }
  const seal=new THREE.Group();seal.position.set(-.7,0,-1);parent.add(seal);
  ring(seal,5.15,.07,.057,'#6d8172',8);ring(seal,4.84,.035,.06,'#a78e61',8);
  ring(seal,2.4,.038,.06,'#8e9b81',48);
  for(let i=0;i<8;i++) {
    const a=i*Math.PI/4;
    const rune=box(seal,'#6d8172',Math.sin(a)*4.58,.063,Math.cos(a)*4.58,.07,.012,.40);rune.rotation.y=a;
    const line=box(seal,'#9c835c',Math.sin(a)*3.6,.061,Math.cos(a)*3.6,.04,.01,.55);line.rotation.y=a;
  }
  const symbol=new THREE.Group();seal.add(symbol);symbol.rotation.y=Math.PI/4;
  box(symbol,'#9a977a',0,.06,0,1.8,.01,.06);box(symbol,'#9a977a',0,.06,0,.06,.01,1.8);
  // Cracks, scattered gravel, and tiny moss filaments stop the ground feeling tiled.
  for(let i=0;i<140;i++) {
    const x=-25+random()*50,z=-20+random()*40;
    if(Math.abs(x)<12&&Math.abs(z)<8&&random()<.85)continue;
    const pebble=ico(parent,i%3?'#a39f83':'#7f8a66',x,.022,z,.06+random()*.18,.025,.05+random()*.13);pebble.castShadow=false;
  }
  for(let i=0;i<64;i++) {
    const x=(random()-.5)*34,z=(random()-.5)*24;
    const crack=box(parent,'#9a977a',x,.056,z,.022,.009,.25+random()*.9);crack.rotation.y=random()*Math.PI;crack.castShadow=false;
  }
}

function roof(parent,x,y,z,width,depth,height=1.3) {
  const g=new THREE.Group();g.position.set(x,y,z);parent.add(g);
  const verts=[], inds=[];
  const outer=[[-1,-1],[0,-1],[1,-1],[1,0],[1,1],[0,1],[-1,1],[-1,0]];
  outer.forEach(([px,pz])=>verts.push(px*width*.5,(px!==0&&pz!==0)?.32:0,pz*depth*.5));
  outer.forEach(([px,pz])=>verts.push(px*width*.34,height,pz*depth*.08));
  verts.push(0,height,0);
  for(let i=0;i<8;i++){const n=(i+1)%8;inds.push(i,n,i+8,n,n+8,i+8,i+8,n+8,16);}
  const geo=new THREE.BufferGeometry();geo.setAttribute('position',new THREE.Float32BufferAttribute(verts,3));geo.setIndex(inds);geo.computeVertexNormals();
  mesh(g,geo,mat('#355958',{side:THREE.DoubleSide}));
  // Tile ribs echo the rhythm of traditional glazed ceramic roofs.
  for(let i=-8;i<=8;i++) {
    const xx=i*width/24;
    for(const s of [-1,1])beam(g,[xx,height,.08*depth*s],[xx*1.42,.045,.49*depth*s],.026,'#54716a',5);
  }
  for(const s of [-1,1])beam(g,[-width*.49,.15,depth*.5*s],[width*.49,.15,depth*.5*s],.066,'#54716a');
  beam(g,[-width*.36,height+.02,0],[width*.36,height+.02,0],.1,'#719281');
  for(const s of [-1,1]){
    beam(g,[s*width*.35,height,0],[s*width*.41,height+.24,0],.055,'#c7a762');
    ico(g,'#d8be7e',s*width*.414,height+.27,0,.1,.17,.1);
  }
  return g;
}
function lantern(parent,x,y,z,animated) {
  const pivot=new THREE.Group();pivot.position.set(x,y,z);parent.add(pivot);
  beam(pivot,[0,0,0],[0,-.34,0],.021,'#70593b');
  const lamp=mesh(pivot,new THREE.CylinderGeometry(.25,.25,.52,8),mat('#ebac67',{emissive:'#df7d36',emissiveIntensity:.32}),0,-.59,0);
  cyl(pivot,'#6d3628',0,-.3,0,.29,.29,.08);cyl(pivot,'#6d3628',0,-.88,0,.29,.29,.08);
  for(let i=0;i<8;i++) { const a=i*Math.PI/4;beam(pivot,[Math.sin(a)*.25,-.34,Math.cos(a)*.25],[Math.sin(a)*.25,-.84,Math.cos(a)*.25],.012,'#983e2e'); }
  beam(pivot,[0,-.92,0],[0,-1.14,0],.018,'#6d3628');
  animated.push({object:pivot,phase:x+z,amplitude:.06,axis:'z'}); return lamp;
}
function templeHall(parent,x,z,width,depth,height,animated,grand=false) {
  const hall=new THREE.Group();hall.position.set(x,0,z);parent.add(hall);
  box(hall,'#686e5c',0,.24,0,width+1.2,.48,depth+1.2);
  box(hall,'#b3ad90',0,.52,0,width+.65,.15,depth+.65);
  box(hall,'#c7b58b',0,height*.46+.6,0,width-.7,height*.92,depth-.6);
  const front=depth*.5;
  for(let i=0;i<5;i++) {
    const xx=(i-2)*width*.2;
    cyl(hall,'#983e2e',xx,height*.5+.6,front,.15,.22,height,8);
    cyl(hall,'#c7a762',xx,.76,front,.28,.3,.19,8);
    box(hall,'#6d3628',xx,height+.36,front,.43,.28,.64);
    for(const s of [-1,1])box(hall,'#c19452',xx+s*.20,height+.60,front,.55,.12,.77);
  }
  for(const side of [-1,1]) {
    for(let i=0;i<3;i++) {
      const xx=side*(width*.19+i*.10);
      box(hall,'#233b31',xx,height*.53+.65,front-.25,width*.086,height*.64,.12);
      for(let k=-2;k<=2;k++)box(hall,'#c19452',xx+k*.15,height*.53+.65,front-.17,.035,height*.61,.03);
      box(hall,'#c19452',xx,height*.53+.65,front-.15,width*.084,.04,.025);
    }
  }
  box(hall,'#6d3628',0,height+.65,front,width+.4,.34,.46);
  box(hall,'#c7a762',0,height+.85,front+.22,width+.5,.065,.065);
  roof(hall,0,height+.88,0,width+2,depth+2.0,grand?1.8:1.25);
  if(grand) {
    box(hall,'#983e2e',0,height+2.5,0,width*.61,.95,depth*.38);
    roof(hall,0,height+2.95,0,width*.78,depth*.62,1.35);
    for(const xx of [-width*.30,width*.30])lantern(hall,xx,height+.43,front+.35,animated);
  }
  box(hall,'#233b31',0,height+.60,front+.28,width*.27,.68,.10);
  for(const xx of [-.65,0,.65]) {
    box(hall,'#d8be7e',xx,height+.6,front+.35,.25,.045,.026);
    const mark=box(hall,'#d8be7e',xx,height+.6,front+.36,.045,.35,.026);mark.rotation.z=.22;
  }
  return hall;
}
function gate(parent,animated) {
  const hall=new THREE.Group();hall.position.set(0,0,-27);parent.add(hall);
  for(const x of [-6.8,-3.3,3.3,6.8]) {
    cyl(hall,'#983e2e',x,2.6,.8,.23,.3,5.0,8);
    cyl(hall,'#c7a762',x,.33,.8,.43,.49,.35,8);
    box(hall,'#6d3628',x,4.95,.8,.65,.28,.9);
    for(const sign of [-1,1]) {
      box(hall,'#c19452',x+sign*.28,5.15,.83,.85,.16,1.0);
      box(hall,'#c19452',x+sign*.20,4.80,.83,.15,.5,.83);
    }
  }
  box(hall,'#983e2e',0,5.28,.8,15.4,.46,.6);
  box(hall,'#d8be7e',0,5.54,1.12,15.5,.07,.08);
  roof(hall,0,5.65,.25,17.2,6.8,1.8);
  box(hall,'#983e2e',0,7.3,0,9.1,.8,1.6);
  roof(hall,0,7.92,0,11.5,4.15,1.35);
  box(hall,'#233b31',0,5.30,1.19,3.65,.97,.12);
  for(const y of [4.8,5.80])box(hall,'#c7a762',0,y,1.28,3.85,.075,.06);
  for(const x of [-1.05,0,1.05]) {
    box(hall,'#d8be7e',x,5.3,1.28,.44,.07,.035);
    box(hall,'#d8be7e',x,5.3,1.30,.06,.53,.035);
    const b=box(hall,'#d8be7e',x,5.3,1.32,.05,.57,.035);b.rotation.z=.7;
  }
  for(const x of [-4.9,4.9])lantern(hall,x,4.94,1.08,animated);
  // Gate stairs and separate rising terraces lead to a full temple compound.
  for(let i=0;i<5;i++)box(parent,'#b3ad90',0,.04+i*.04,-22.7-i*.5,10-i*.2,.12,.55);
  for(let tier=0;tier<3;tier++) {
    box(parent,'#686e5c',0,.24+tier*.6,-35-tier*5,34-tier*3,.5+tier*1.2,7);
    box(parent,'#b3ad90',0,.56+tier*1.2,-32-tier*5,34-tier*3,.22,.5);
  }
  templeHall(parent,0,-41,18,9,6.6,animated,true);
  templeHall(parent,-18,-34,8,7,4.4,animated);
  templeHall(parent,18,-33.5,8,7,4.1,animated);
  templeHall(parent,-13,-49,9,6,5.0,animated);
  templeHall(parent,14,-49,9,7,5.2,animated);
  for(const sign of [-1,1]) {
    for(let i=0;i<5;i++)box(parent,'#b3ad90',sign*11,.12+i*.15,-30-i*.65,4,.28,.72);
    for(let z=-31;z>=-47;z-=4) {
      box(parent,'#70593b',sign*25,1.1,z,.6,2.4,.6);
      box(parent,'#536957',sign*25,2.37,z,.94,.18,.94);
    }
    box(parent,'#a39f83',sign*25,.9,-40,.35,1.2,18);
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
  beam(tree,[lean,height*.5,0],[lean+.15,height*.88,.12],.12,'#6a6951');
  for(let i=0;i<5;i++) {
    const a=i*2.15, y=height*(.4+i*.105),reach=height*(.36-i*.035);
    const ex=lean+Math.cos(a)*reach,ez=Math.sin(a)*reach;
    beam(tree,[lean,y,0],[ex,y+.23,ez],.075,'#6a6951');
    const canopy=new THREE.Group();canopy.position.set(ex,y+.3,ez);tree.add(canopy);
    ico(canopy,i%2?'#4c7060':'#3e6054',0,0,0,reach*.74,.40,reach*.56,1);
    ico(canopy,'#6e8870',-.12,.19,.06,reach*.59,.22,reach*.49);
  }
  ico(tree,'#52735e',lean+.15,height*.95,.12,height*.28,.45,height*.23,1);
  // Trunk and crown are baked; airborne leaves carry the wind motion.
}
function bamboo(parent,x,z,random) {
  const g=new THREE.Group();g.position.set(x,0,z);parent.add(g);
  for(let i=0;i<7;i++) {
    const xx=(random()-.5)*1.35, zz=(random()-.5)*1.2,h=2.7+random()*1.7;
    const pole=beam(g,[xx,0,zz],[xx+.12,h,zz-.08],.043,'#658570');
    for(let j=1;j<h/.43;j++)cyl(g,'#a3b28b',xx+.12*j*.43/h,j*.43,zz-.08*j*.43/h,.052,.052,.035,6);
    for(let j=0;j<3;j++) {
      const y=h*(.55+j*.15),s=j%2?-1:1;
      beam(g,[xx,y,zz],[xx+s*.55,y+.15,zz+.2],.017,'#658570');
      for(let k=0;k<3;k++) {
        const leaf=ico(g,'#658570',xx+s*(.22+k*.18),y+.16,zz+.15,.29,.04,.10);
        leaf.rotation.y=s*.55;
      }
    }
  }
}
function stoneLamp(parent,x,z,animated) {
  const g=new THREE.Group();g.position.set(x,0,z);parent.add(g);
  box(g,'#686e5c',0,.14,0,.83,.28,.83);
  cyl(g,'#a39f83',0,.59,0,.22,.28,.72,6);
  box(g,'#b3ad90',0,1.08,0,.78,.17,.78);
  box(g,'#ecc67c',0,1.40,0,.45,.53,.45,{emissive:'#de9249',emissiveIntensity:.35});
  for(const xx of [-.29,.29])for(const zz of [-.29,.29])box(g,'#686e5c',xx,1.42,zz,.11,.65,.11);
  const top=mesh(g,new THREE.ConeGeometry(.72,.41,4),mat('#6d8172'),0,1.91,0);top.rotation.y=Math.PI/4;
  cyl(g,'#a39f83',0,2.2,0,.08,.13,.2,6);
}

function banner(parent,x,z,animated) {
  const g=new THREE.Group();g.position.set(x,0,z);g.rotation.z=(x<0?1:-1)*.05;parent.add(g);
  box(g,'#a39f83',0,.2,0,.8,.4,.8);
  beam(g,[0,.4,0],[0,4.5,0],.055,'#70593b');
  beam(g,[-.55,4.18,0],[.55,4.18,0],.04,'#c19452');
  const flag=new THREE.Group();flag.position.y=4.12;g.add(flag);
  const shape=new THREE.Shape();
  shape.moveTo(-.45,0);shape.lineTo(.45,0);shape.lineTo(.45,-.82);
  shape.lineTo(.26,-.97);shape.lineTo(.44,-1.03);shape.lineTo(.42,-1.5);
  shape.lineTo(.33,-1.8);shape.lineTo(.15,-1.60);shape.lineTo(.02,-1.84);
  shape.lineTo(-.09,-1.63);shape.lineTo(-.31,-1.78);shape.lineTo(-.45,-1.48);shape.closePath();
  mesh(flag,new THREE.ShapeGeometry(shape),mat('#983e2e',{side:THREE.DoubleSide}));
  box(flag,'#c7a762',0,-.04,.026,.88,.045,.025);
  box(flag,'#c7a762',-.36,-.68,.026,.025,1.24,.025);
  box(flag,'#c7a762',.36,-.39,.026,.025,.67,.025);
  const lozenge=box(flag,'#c7a762',0,-.70,.03,.30,.30,.025);lozenge.rotation.z=Math.PI/4;
  box(flag,'#c7a762',0,-.73,.055,.028,.65,.025);
  animated.push({object:flag,phase:x,amplitude:.06,axis:'x'});
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

function brokenColumn(parent,x,z,rotation=0) {
  const g=new THREE.Group();g.position.set(x,0,z);g.rotation.y=rotation;parent.add(g);
  box(g,'#686e5c',0,.15,0,1.6,.30,1.6);
  box(g,'#c7b58b',0,.35,0,1.32,.12,1.32);
  cyl(g,'#a39f83',0,1.24,0,.39,.48,1.7,7);
  const fracture=ico(g,'#b3ad90',0,2.03,0,.44,.14,.41);fracture.rotation.z=.16;
  for(let i=0;i<4;i++) {
    const chip=box(g,'#a39f83',.75+i*.24,.10,.3+(i%2)*.35,.30,.20,.39);chip.rotation.y=i*.81;
  }
  const shaft=cyl(g,'#b3ad90',1.65,.37,-.62,.39,.40,2.35,7);shaft.rotation.z=Math.PI/2-.12;shaft.rotation.y=.15;
  box(g,'#7b8a63',-.38,.39,.42,.27,.04,.48);
}
function supplyCart(parent,x,z,rotation) {
  const g=new THREE.Group();g.position.set(x,0,z);g.rotation.y=rotation;parent.add(g);
  box(g,'#70593b',0,.80,0,2.0,.23,3.0);
  for(let i=-2;i<=2;i++)box(g,'#a48251',i*.36,1.02,0,.31,.14,2.7);
  for(const side of [-1,1]) {
    box(g,'#70593b',side,1.2,0,.16,.57,3.1);
    for(const zz of [-1,1]) {
      const wheel=cyl(g,'#473d2d',side*1.15,.55,zz,.53,.53,.16,10);wheel.rotation.z=Math.PI/2;
      const hub=cyl(g,'#a48251',side*1.26,.55,zz,.12,.12,.21,8);hub.rotation.z=Math.PI/2;
      for(let j=0;j<5;j++) {
        const a=j*Math.PI/5;beam(g,[side*1.25,.55+Math.sin(a)*.45,zz+Math.cos(a)*.45],[side*1.25,.55-Math.sin(a)*.45,zz-Math.cos(a)*.45],.035,'#a48251');
      }
    }
    beam(g,[side*.72,.8,1.2],[side*.72,.25,3.0],.07,'#70593b');
  }
  for(const p of [[-.42,1.45,-.6],[.4,1.4,.56]]) {
    box(g,'#a48251',...p,.86,.8,.9);
    for(const y of [-.27,.27])box(g,'#473d2d',p[0],p[1]+y,p[2]+.47,.87,.055,.04);
    box(g,'#473d2d',p[0],p[1],p[2]+.47,.055,.76,.04);
  }
  cyl(g,'#70593b',.3,1.35,-.56,.34,.4,.58,8);
  const lid=cyl(g,'#b3ad90',.3,1.65,-.56,.35,.35,.04,8);lid.castShadow=false;
}
function riverbank(parent,random) {
  // A winding river sits beside the combat ground, with stones instead of a hard edge.
  const vertices=[],indices=[];
  for(let i=0;i<=28;i++) {
    const z=-68+i*5,x=35+Math.sin(i*.28)*2.3;
    vertices.push(x,-.09,z,x+14+Math.sin(i*.4),-.09,z);
    if(i<28){const j=i*2;indices.push(j,j+1,j+2,j+1,j+3,j+2);}
  }
  const geo=new THREE.BufferGeometry();geo.setAttribute('position',new THREE.Float32BufferAttribute(vertices,3));geo.setIndex(indices);geo.computeVertexNormals();
  mesh(parent,geo,mat('#285d60',{roughness:.36,metalness:.18})).castShadow=false;
  for(let i=0;i<40;i++) {
    const z=-61+i*3.1,x=33+Math.sin((z+68)/5*.28)*2.3;
    rock(parent,x,z,.65+random()*1.2,random);
    if(i%3===0)for(let j=0;j<5;j++)beam(parent,[x-.7+j*.13,0,z],[x-.63+j*.13,.6+random()*.3,z+.07],.018,'#658570');
  }
  // Old ferry landing, bollards and a modest reed-covered boat.
  box(parent,'#70593b',32.8,.10,16,7,.20,4.2);
  for(let i=0;i<15;i++)box(parent,'#a48251',30+i*.45,.22,16,.38,.07,4.12);
  for(const z of [14.35,17.65])for(const x of [30.4,35.2])cyl(parent,'#70593b',x,.39,z,.16,.22,1.25,7);
  const boat=new THREE.Group();boat.position.set(39.8,0,17);boat.rotation.y=.24;parent.add(boat);
  box(boat,'#473d2d',0,.06,0,2,.27,5.6);
  for(const sign of [-1,1]) {
    const gunwale=box(boat,'#a48251',sign*.91,.35,0,.20,.53,5.6);gunwale.rotation.z=sign*.16;
    const bow=box(boat,'#70593b',0,.17,sign*2.8,1.45,.43,.7);bow.rotation.y=sign*.25;
  }
  for(const z of [-1.7,-.1,1.6])box(boat,'#a48251',0,.34,z,1.75,.12,.3);
  beam(boat,[-1.1,.6,-1.8],[1.5,.1,2.2],.05,'#c7b58b');
}

export function buildWorld(scene) {
  const group=new THREE.Group();group.name='Cloudpass Temple — ancient ferry battlefield';scene.add(group);
  const random=seeded(777),animated=[];
  tiledFloor(group);gate(group,animated);riverbank(group,random);
  // Hillside terraces on the west meet a weathered pilgrim stair and a pagoda.
  for(let i=0;i<6;i++) {
    box(group,'#686e5c',-36-i*1.9,.2+i*.50,-8,6+i*.4,.6+i,34-i*1.5);
    box(group,'#a39f83',-32-i*.74,.04+i*.12,-6,1.1,.18,5.5);
  }
  const pagoda=new THREE.Group();pagoda.position.set(-42,2.1,-10);group.add(pagoda);
  box(pagoda,'#b3ad90',0,.35,0,8,.7,8);
  for(let tier=0;tier<3;tier++) {
    const width=6-tier*.85,y=.75+tier*2.85;
    box(pagoda,'#c7b58b',0,y+1.05,0,width-1.2,2.1,width-1.2);
    for(const x of [-1,1])for(const z of [-1,1])cyl(pagoda,'#983e2e',x*(width*.5-.4),y+1.15,z*(width*.5-.4),.17,.23,2.3,8);
    box(pagoda,'#6d3628',0,y+2.12,0,width+.2,.25,width+.2);
    roof(pagoda,0,y+2.27,0,width+2,width+2,1.1);
  }
  cyl(pagoda,'#c7a762',0,10.9,0,.10,.18,1.1,8);
  ico(pagoda,'#d8be7e',0,11.55,0,.15,.24,.15);
  for(const s of [-1,1]) {
    // Scenery is beyond the traversable perimeter; the entire center stays legible.
    for(let i=0;i<18;i++)rock(group,s*(28+random()*4),-24+random()*49,.45+random()*1.3,random);
    for(const z of [-24,-12,2,25])pine(group,s*(30+random()*2),z,5.2+random()*1.6,random,animated);
    bamboo(group,s*29,-17,random);bamboo(group,s*28.7,9,random);
    stoneLamp(group,s*21.7,-22.9,animated);stoneLamp(group,s*28.5,15.5,animated);
    banner(group,s*19.5,-24.0,animated);
    banner(group,s*29.1,21.8,animated);
    brokenColumn(group,s*23.8,-22.8,s*.6);
    brokenColumn(group,s*28.9,-5,s*.9);
    supplyCart(group,s*27.9,20.5,s*.46);
    for(let i=0;i<12;i++) {
      const xx=s*(26.6+random()*2),zz=22+random()*8;
      const rubble=box(group,'#b3ad90',xx,.12,zz,.4+random()*.4,.24,.3+random()*.5);rubble.rotation.y=random()*Math.PI;
    }
  }
  // The ruined garden enters the close combat view without closing the central lanes.
  // These small monuments have simple circular collision anchors for the game logic.
  brokenColumn(group,-9.4,-6.8,.3);
  brokenColumn(group,10.4,6.8,-.3);
  stoneLamp(group,-8.3,5.8,animated);
  stoneLamp(group,8.8,-6.1,animated);
  supplyCart(group,13.6,.8,1.1);
  banner(group,-10.9,1.5,animated);
  pine(group,-12.4,-8.5,4.7,random,animated);
  pine(group,13.1,-9.3,4.2,random,animated);
  bamboo(group,-13.8,7.7,random);
  for(const [x,z] of [[-11,-5.5],[11,8.3],[-12.6,4.1],[12.2,-6.8]]) {
    for(let i=0;i<5;i++)rock(group,x+(random()-.5)*2,z+(random()-.5)*1.4,.25+random()*.36,random);
    for(let i=0;i<6;i++) {
      const stone=box(group,'#a39f83',x+(random()-.5)*2,.095,z+(random()-.5)*2,.3+random()*.4,.16,.3+random()*.3);stone.rotation.y=random()*Math.PI;
    }
  }
  // A collapsed shrine sill is low enough to cross and has no enclosing wall.
  for(let i=0;i<5;i++)box(group,'#a39f83',-3.3+i*.70,.10,-11.6,.62,.20,.72);
  const fallen=box(group,'#6d3628',-3,.22,-11.6,2.7,.19,.19);fallen.rotation.y=.16;
  for(const x of [-3.5,-2.4])box(group,'#c7a762',x,.31,-11.6,.10,.025,.18);
  // The near side is open land, with distant tree lines rather than a table rim.
  for(const x of [-21,-7,9,23]) {
    rock(group,x,30+random()*4,1.2+random()*.8,random);
    pine(group,x,37+random()*7,5.0+random()*2,random,animated);
  }
  for(let i=0;i<9;i++)mountain(group,-68+i*16,-64-random()*14,12+random()*18,10+random()*9,['#546f65','#647b68','#748776'][i%3],random);
  for(let i=0;i<6;i++)mountain(group,-81+i*31,-88,22+random()*18,15+random()*8,'#81958a',random);
  mountain(group,-65,5,21,16,'#647b68',random);mountain(group,70,-7,20,16,'#647b68',random);
  // Light, slow leaves use one instanced draw call across the whole level.
  const leaves=[],leafBatch=new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1),mat('#bc954f'),36),dummy=new THREE.Object3D();
  leafBatch.castShadow=false;group.add(leafBatch);
  for(let i=0;i<36;i++)leaves.push({x:-28+random()*56,y:random()*7,z:-23+random()*46,phase:random()*10});
  const glints=new THREE.InstancedMesh(boxGeo(),mat('#b2d4c1',{transparent:true,opacity:.32,depthWrite:false,roughness:.4}),24);
  glints.castShadow=false;group.add(glints);
  const waves=Array.from({length:24},()=>({x:36+random()*10,z:-57+random()*116,phase:random()*6,scale:.4+random()*1.6}));
  animated.forEach(a=>batchScenery(a.object));
  batchScenery(group,new Set([...animated.map(a=>a.object),leafBatch,glints]));
  const update=(dt,time=0)=>{
    const t=time;
    animated.forEach(a=>{a.object.rotation[a.axis]=Math.sin(t*.8+a.phase)*a.amplitude;});
    leaves.forEach((leaf,i)=>{
      dummy.position.set(leaf.x+Math.sin(t*.22+leaf.phase)*2,.25+((leaf.y-t*.2)%7+7)%7,leaf.z+Math.cos(t*.3+leaf.phase)*.8);
      dummy.rotation.set(t*.5+leaf.phase,t*.7+leaf.phase,t*.3);dummy.scale.set(.07,.018,.13);dummy.updateMatrix();leafBatch.setMatrixAt(i,dummy.matrix);
    });leafBatch.instanceMatrix.needsUpdate=true;
    waves.forEach((wave,i)=>{
      dummy.position.set(wave.x,-.08,wave.z+Math.sin(t*.32+wave.phase)*1.6);
      dummy.rotation.set(0,Math.sin(t*.22+wave.phase)*.12,0);dummy.scale.set(wave.scale*(.8+Math.sin(t*.65+wave.phase)*.2),.009,.035);dummy.updateMatrix();glints.setMatrixAt(i,dummy.matrix);
    });glints.instanceMatrix.needsUpdate=true;
  };
  update(0,0);
  return {
    bounds:{minX:-26,maxX:26,minZ:-21,maxZ:21},
    obstacles:[{x:-9.4,z:-6.8,radius:1.02},{x:10.4,z:6.8,radius:1.02},{x:-8.3,z:5.8,radius:.50},{x:8.8,z:-6.1,radius:.50},{x:13.6,z:.8,radius:1.8},{x:-10.9,z:1.5,radius:.45},{x:-12.4,z:-8.5,radius:.38},{x:13.1,z:-9.3,radius:.38},{x:-13.8,z:7.7,radius:1.0}],
    spawnPoints:[{x:-25,z:-17},{x:-25,z:1},{x:-24,z:18},{x:-10,z:20},{x:11,z:20},{x:25,z:16},{x:25,z:-4},{x:19,z:-20},{x:-12,z:-20}],
    update,
  };
}

export { createWarrior, createEnemy } from './characters.js';
