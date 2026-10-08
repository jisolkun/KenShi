import * as THREE from 'three';

export function createEffects(scene, camera) {
  const objects = [], trails = [], allCached = new Set(), cache = new Map(), geometries = new Map();
  const temp = new THREE.Vector3(), cameraRight = new THREE.Vector3(), cameraUp = new THREE.Vector3();
  const dummy = new THREE.Object3D(), tint = new THREE.Color();
  const palette = [0xffe3a9, 0xfff8e6, 0xd9b9ff, 0xb4d3ff], trailLife = 0.105;
  const additive = (color, opacity = 1) => new THREE.MeshBasicMaterial({color, transparent:true, opacity, depthWrite:false, side:THREE.DoubleSide, blending:THREE.AdditiveBlending, toneMapped:false});
  function cachedGeometry(key, make) {
    if (!geometries.has(key)) geometries.set(key, make());
    return geometries.get(key);
  }
  function acquire(key, make) {
    const available = cache.get(key), mesh = available?.length ? available.pop() : make();
    allCached.add(mesh); mesh.userData.effectCacheKey = key;
    mesh.visible = true; mesh.scale.set(1,1,1); mesh.rotation.set(0,0,0);
    return mesh;
  }
  function release(mesh) {
    scene.remove(mesh);
    const key = mesh.userData.effectCacheKey;
    if (!cache.has(key)) cache.set(key, []);
    cache.get(key).push(mesh);
  }
  function add(mesh, duration, update) {
    scene.add(mesh); objects.push({mesh, age:0, duration, update}); return mesh;
  }
  function ring(position, radius, color = 0xffb275, duration = 0.5, isWarning = false) {
    const mesh = acquire('ring', () => new THREE.Mesh(cachedGeometry('ring', () => new THREE.RingGeometry(0.955,1,40)), additive(color)));
    mesh.material.color.setHex(color); mesh.material.opacity = isWarning ? 0.65 : 0.48;
    mesh.rotation.x = -Math.PI/2; mesh.position.copy(position); mesh.position.y = 0.035;
    mesh.scale.setScalar(radius * (isWarning ? 1 : 0.65));
    return add(mesh, duration, (o,p) => {
      o.material.opacity = Math.pow(1-p,1.5) * (isWarning ? 0.65 : 0.48);
      o.scale.setScalar(radius * (isWarning ? 1 : 0.65+p*0.5));
    });
  }
  function warning(position, radius, duration) {
    const group = acquire('warning', () => {
      const g = new THREE.Group();
      const fill = new THREE.Mesh(cachedGeometry('warning-fill', () => new THREE.CircleGeometry(1,40)), additive(0xa93129,0.22));
      const edge = new THREE.Mesh(cachedGeometry('warning-edge', () => new THREE.RingGeometry(0.985,1,40)), additive(0xff7152,0.75));
      fill.rotation.x = edge.rotation.x = -Math.PI/2; g.add(fill,edge); return g;
    });
    group.position.copy(position); group.position.y = 0.045; group.scale.setScalar(radius*0.72);
    group.children[0].material.opacity = 0.12; group.children[1].material.opacity = 0.55;
    return add(group, duration, (o,p) => {
      o.scale.setScalar(radius*(0.72+0.28*p));
      o.children[0].material.opacity = 0.12+p*0.28;
      o.children[1].material.opacity = 0.45+Math.sin(p*18)*0.2;
    });
  }
  // Three shared draw calls cover every flash, flying sliver and falling chip.
  function flatShape(points) {
    const shape = new THREE.Shape(); shape.moveTo(...points[0]);
    points.slice(1).forEach(p => shape.lineTo(...p)); shape.closePath(); return new THREE.ShapeGeometry(shape);
  }
  function particlePool(geometry, capacity, debris = false) {
    const material = debris ? new THREE.MeshBasicMaterial({color:0xffffff,toneMapped:false}) : additive(0xffffff);
    const mesh = new THREE.InstancedMesh(geometry, material, capacity);
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage); mesh.frustumCulled = false; mesh.count = 0; mesh.visible = false; mesh.renderOrder = debris ? 0 : 2;
    for (let i=0;i<capacity;i++) mesh.setColorAt(i,tint.setHex(0xffffff));
    mesh.instanceColor.setUsage(THREE.DynamicDrawUsage); scene.add(mesh);
    return {mesh,debris,cursor:0,particles:Array.from({length:capacity},()=>({active:false,pos:new THREE.Vector3(),velocity:new THREE.Vector3(),color:new THREE.Color(),age:0,life:0,x:0,y:0,z:0,angle:0,spin:0,gravity:0}))};
  }
  const flashes = particlePool(flatShape([[1,0],[0.13,0.12],[0,0.8],[-0.13,0.12],[-1,0],[-0.13,-0.12],[0,-0.8],[0.13,-0.12]]),64);
  const slivers = particlePool(flatShape([[-0.5,0],[0,0.075],[0.5,0],[0,-0.075]]),160);
  const chips = particlePool(new THREE.OctahedronGeometry(1,0),96,true), particlePools = [flashes,slivers,chips];
  function emit(pool,pos,velocity,color,life,x,y,z=1,gravity=0,angle=0) {
    const p = pool.particles[pool.cursor++ % pool.particles.length];
    p.active=true; p.pos.copy(pos); p.velocity.copy(velocity); p.color.setHex(color);
    p.age=0; p.life=life; p.x=x; p.y=y; p.z=z; p.gravity=gravity; p.angle=angle; p.spin=(Math.random()-0.5)*8;
  }
  function updateParticles(dt) {
    cameraRight.set(1,0,0).applyQuaternion(camera.quaternion); cameraUp.set(0,1,0).applyQuaternion(camera.quaternion);
    for (const pool of particlePools) {
      let count=0;
      for (const p of pool.particles) {
        if (!p.active) continue;
        p.age+=dt; if(p.age>=p.life){p.active=false;continue;}
        p.velocity.y-=dt*p.gravity; p.pos.addScaledVector(p.velocity,dt);
        if(pool.debris && p.pos.y<0.055){p.pos.y=0.055;p.velocity.y=0;p.velocity.x*=0.72;p.velocity.z*=0.72;}
        const phase=p.age/p.life,fade=Math.pow(1-phase,pool.debris?0.4:1.3);
        dummy.position.copy(p.pos);
        if(pool.debris) dummy.rotation.set(p.angle+p.age*p.spin,p.age*p.spin,p.angle);
        else {
          dummy.quaternion.copy(camera.quaternion);
          const angle=p.velocity.lengthSq()>0.2?Math.atan2(p.velocity.dot(cameraUp),p.velocity.dot(cameraRight)):p.angle;
          dummy.rotateZ(angle);
        }
        const scale=pool.debris?Math.max(0.03,fade):0.6+0.4*fade;
        dummy.scale.set(p.x*scale,p.y*scale,p.z*scale); dummy.updateMatrix();
        pool.mesh.setMatrixAt(count,dummy.matrix); pool.mesh.setColorAt(count++,tint.copy(p.color).multiplyScalar(pool.debris?1:fade));
      }
      pool.mesh.count=count;pool.mesh.visible=count>0;
      if(count){pool.mesh.instanceMatrix.needsUpdate=true;pool.mesh.instanceColor.needsUpdate=true;}
    }
  }
  const direction=new THREE.Vector3(),side=new THREE.Vector3(),velocity=new THREE.Vector3(),point=new THREE.Vector3(),zero=new THREE.Vector3();
  function impact(position,cutDirection,strength=1,critical=false) {
    const weight=THREE.MathUtils.clamp(strength,0.4,2);
    direction.copy(cutDirection||zero);if(direction.lengthSq()<0.001)direction.set(0,0,1);direction.normalize();
    side.set(-direction.z,0.15,direction.x).normalize();
    cameraRight.set(1,0,0).applyQuaternion(camera.quaternion);cameraUp.set(0,1,0).applyQuaternion(camera.quaternion);
    const angle=Math.atan2(direction.dot(cameraUp),direction.dot(cameraRight)),size=0.22+weight*0.1;
    emit(flashes,position,zero,0xfff9df,0.06+(critical?0.015:0),size,size*0.75,1,0,angle);
    emit(flashes,position,zero,0xd3a8ef,critical?0.16:0.12,size*(critical?2.2:1.65),size*0.66,1,0,angle+0.6);
    for(let i=0,count=critical?8:Math.round(4+weight);i<count;i++){
      velocity.copy(direction).multiplyScalar(3+Math.random()*3*weight).addScaledVector(side,(Math.random()-0.5)*(critical?4.4:3));
      velocity.y+=0.2+Math.random()*1.5;point.copy(position).addScaledVector(side,(Math.random()-0.5)*0.12);
      emit(slivers,point,velocity,palette[i%palette.length],0.13+Math.random()*0.09,0.26+Math.random()*0.35*weight,0.15+Math.random()*0.12,1,5);
    }
    if(critical)ring(position,0.85+weight*0.12,0xd5b6ed,0.17);
  }
  function burst(position,strength=1,color) {
    point.copy(position);point.y+=0.6;
    for(let i=0,count=Math.min(12,Math.round(4+strength*3));i<count;i++){
      const angle=i/count*Math.PI*2+Math.random()*0.4,speed=1.5+Math.random()*2.3*strength;
      velocity.set(Math.sin(angle)*speed,1+Math.random()*1.4,Math.cos(angle)*speed);
      emit(slivers,point,velocity,color||palette[i%palette.length],0.2+Math.random()*0.11,0.28,0.17,1,10);
    }
  }
  function death(position,fallDirection,strength=1) {
    direction.copy(fallDirection||zero);if(direction.lengthSq()>0.001)direction.normalize();point.copy(position);point.y=0.12;
    for(let i=0;i<5+Math.floor(strength);i++){
      const angle=Math.random()*Math.PI*2,speed=0.5+Math.random()*1.8,size=0.055+Math.random()*0.045;
      velocity.set(Math.sin(angle)*speed,0.7+Math.random()*1.2,Math.cos(angle)*speed).addScaledVector(direction,1.2);
      emit(chips,point,velocity,i%2?0x8c8066:0xbbb096,0.4+Math.random()*0.3,size,size*0.6,size,9,angle);
    }
  }
  function arcGeometry(combo,core=false) {
    const sweep=combo===3?2.05:combo===2?1.1:1.45,vertices=[],segments=24,tilt=combo%2?-0.3:0.3;
    for(let i=0;i<segments;i++){
      const values=[];
      for(const index of [i,i+1]){
        const t=index/segments,angle=(t-0.5)*sweep,width=Math.sin(t*Math.PI)*(core?0.024:combo===3?0.17:0.105);
        for(const r of [1-width,1])values.push([Math.sin(angle)*r,Math.sin(angle)*tilt+(combo===2?Math.cos(angle)*0.15:0),Math.cos(angle)*r]);
      }
      for(const index of [0,1,2,2,1,3])vertices.push(...values[index]);
    }
    const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.Float32BufferAttribute(vertices,3));return geometry;
  }
  function arc(position,angle,radius=2,combo=0,color=0xb9a9f1) {
    const style=((combo%4)+4)%4;
    const group=acquire(`arc-${style}`,()=>{
      const g=new THREE.Group();g.add(new THREE.Mesh(cachedGeometry(`arc-outer-${style}`,()=>arcGeometry(style)),additive(color,0.3)),new THREE.Mesh(cachedGeometry(`arc-core-${style}`,()=>arcGeometry(style,true)),additive(0xfff2ff,0.52)));return g;
    });
    group.children[0].material.color.setHex(color);group.children[0].material.opacity=0.3;group.children[1].material.opacity=0.52;
    group.position.copy(position);group.position.y+=style===2?1.2:1.03;group.rotation.y=angle+(style%2?0.12:-0.12);group.scale.set(radius,1,radius);
    return add(group,style===3?0.145:0.115,(o,p)=>{
      o.rotation.y=angle+(style%2?1:-1)*(0.12+p*0.22);o.children[0].material.opacity=0.3*Math.pow(1-p,1.6);o.children[1].material.opacity=0.52*Math.pow(1-p,2);
    });
  }
  // A baked afterimage is one draw; its vertex buffer is reused on the next pose.
  function ghost(rig) {
    rig.group.updateMatrixWorld(true);const meshes=[];let vertexCount=0;
    rig.group.traverse(o=>{if(o.isMesh&&o.visible&&o.geometry.attributes.position){meshes.push(o);vertexCount+=o.geometry.index?.count||o.geometry.attributes.position.count;}});
    const copy=acquire('ghost',()=>{const m=new THREE.Mesh(new THREE.BufferGeometry(),additive(0xbacdec,0.12));m.frustumCulled=false;return m;});
    let attribute=copy.geometry.attributes.position;
    if(!attribute||attribute.count<vertexCount){copy.geometry.dispose();copy.geometry=new THREE.BufferGeometry();attribute=new THREE.BufferAttribute(new Float32Array(vertexCount*3),3).setUsage(THREE.DynamicDrawUsage);copy.geometry.setAttribute('position',attribute);}
    let offset=0;
    for(const mesh of meshes){const positions=mesh.geometry.attributes.position,index=mesh.geometry.index;
      for(let i=0,count=index?.count||positions.count;i<count;i++){temp.fromBufferAttribute(positions,index?index.getX(i):i).applyMatrix4(mesh.matrixWorld);attribute.setXYZ(offset++,temp.x,temp.y,temp.z);}}
    attribute.needsUpdate=true;copy.geometry.setDrawRange(0,vertexCount);copy.material.opacity=0.12;copy.position.set(0,0,0);
    return add(copy,0.16,(o,p)=>{o.material.opacity=(1-p)*0.12;});
  }
  function swordTrail() {
    // A broad blue-violet strip and a narrow warm-white core follow the blade tip.
    const positions=new Float32Array(28*12*3),colors=new Float32Array(28*12*3),geo=new THREE.BufferGeometry();
    geo.setAttribute('position',new THREE.BufferAttribute(positions,3).setUsage(THREE.DynamicDrawUsage));geo.setAttribute('color',new THREE.BufferAttribute(colors,3).setUsage(THREE.DynamicDrawUsage));geo.setDrawRange(0,0);
    const material=additive(0xffffff,0.8);material.vertexColors=true;
    const mesh=new THREE.Mesh(geo,material);mesh.frustumCulled=false;scene.add(mesh);
    const trail={mesh,points:[],spare:Array.from({length:32},()=>({tip:new THREE.Vector3(),inner:new THREE.Vector3(),core:new THREE.Vector3(),body:new THREE.Vector3(),age:0})),positions,colors,wasActive:false};trails.push(trail);return trail;
  }
  function resetTrail(trail) {
    while(trail.points.length)trail.spare.push(trail.points.pop());trail.mesh.geometry.setDrawRange(0,0);trail.wasActive=false;
  }
  function sample(trail,tip,body,active,dt) {
    const elapsed=Math.max(0,Math.min(dt||0,0.2));for(const p of trail.points)p.age+=elapsed;
    while(trail.points.length&&trail.points[0].age>=trailLife)trail.spare.push(trail.points.shift());
    if(active&&tip&&body){
      const last=trail.points.at(-1);
      // Mount/state changes and discontinuous sampling never connect into a rod.
      if(!trail.wasActive||elapsed>0.07||(last&&(last.tip.distanceToSquared(tip)>4.4||last.body.distanceToSquared(body)>1.4)))resetTrail(trail);
      const previous=trail.points.at(-1);
      if(!previous||previous.tip.distanceToSquared(tip)>0.0004){const p=trail.spare.pop()||trail.points.shift();p.tip.copy(tip);p.body.copy(body);p.inner.copy(tip).lerp(body,0.26);p.core.copy(tip).lerp(body,0.055);p.age=0;trail.points.push(p);if(trail.points.length>29)trail.spare.push(trail.points.shift());}
    }
    trail.wasActive=Boolean(active);let at=0;
    function vertex(point,age,layer,edge){
      trail.positions[at]=point.x;trail.positions[at+1]=point.y;trail.positions[at+2]=point.z;const fade=Math.pow(Math.max(0,1-age/trailLife),1.6);
      trail.colors[at]=fade*(layer?1:edge?0.69:0.14);trail.colors[at+1]=fade*(layer?0.97:edge?0.77:0.2);trail.colors[at+2]=fade*(layer?0.92:edge?1:0.48);at+=3;
    }
    for(let i=1;i<trail.points.length;i++){const a=trail.points[i-1],b=trail.points[i];for(let layer=0;layer<2;layer++){const inside=layer?'core':'inner';for(const[p,edge]of[[a,true],[a,false],[b,true],[b,true],[a,false],[b,false]])vertex(edge?p.tip:p[inside],p.age,layer,edge);}}
    trail.mesh.geometry.setDrawRange(0,at/3);trail.mesh.geometry.attributes.position.needsUpdate=true;trail.mesh.geometry.attributes.color.needsUpdate=true;
  }
  function update(dt) {
    for(let i=objects.length-1;i>=0;i--){const o=objects[i];o.age+=dt;o.update?.(o.mesh,Math.min(1,o.age/o.duration),dt);if(o.age>=o.duration){release(o.mesh);objects.splice(i,1);}}updateParticles(dt);
  }
  function clear() {
    for(const o of objects)release(o.mesh);objects.length=0;
    for(const pool of particlePools){pool.particles.forEach(p=>{p.active=false;});pool.mesh.count=0;pool.mesh.visible=false;}trails.forEach(resetTrail);
  }
  function destroy() {
    clear();const disposed=new Set();
    function disposeMesh(mesh){scene.remove(mesh);mesh.traverse(o=>{if(!o.isMesh)return;if(!disposed.has(o.geometry)){o.geometry.dispose();disposed.add(o.geometry);}for(const material of Array.isArray(o.material)?o.material:[o.material]){if(!disposed.has(material)){material.dispose();disposed.add(material);}}});}
    allCached.forEach(disposeMesh);particlePools.forEach(pool=>disposeMesh(pool.mesh));trails.forEach(trail=>disposeMesh(trail.mesh));geometries.forEach(geometry=>{if(!disposed.has(geometry))geometry.dispose();});allCached.clear();cache.clear();geometries.clear();
  }
  return {ring,warning,burst,impact,death,arc,ghost,swordTrail,sample,update,clear,destroy};
}
