import * as THREE from 'three';

export function createEffects(scene, camera) {
  const objects = [], trails = [], allCached = new Set(), cache = new Map(), geometries = new Map();
  const temp = new THREE.Vector3(), cameraRight = new THREE.Vector3(), cameraUp = new THREE.Vector3();
  const dummy = new THREE.Object3D(), tint = new THREE.Color();
  const palette = [0xffe3a9, 0xfff8e6, 0xd9b9ff, 0xb4d3ff], trailLife = 0.105;
  // Allow two maximum-length (250ms) frames to present; retain 60Hz ground drag.
  const firstPresentationTimeout = 0.5, groundDrag = -60 * Math.log(0.72);
  const additive = (color, opacity = 1) => new THREE.MeshBasicMaterial({color, transparent:true, opacity, depthWrite:false, side:THREE.DoubleSide, blending:THREE.AdditiveBlending, toneMapped:false});
  // Ground marks use line material instead of a mesh material so the fracture
  // stays crisp at the edge of the camera frustum.  The geometry is shared;
  // each pooled group only changes its transform and opacity.
  const lineAdditive = (color, opacity = 1) => new THREE.LineBasicMaterial({color, transparent:true, opacity, depthWrite:false, blending:THREE.AdditiveBlending, toneMapped:false});
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
  function groundCrackGeometry() {
    return cachedGeometry('ground-cracks', () => {
      const vertices = [];
      // Uneven spokes read as broken paving rather than a perfect magic ring.
      const spokes = [
        [-.06, .08, .92, .24], [.03, .10, .62, .54],
        [.13, -.04, .83, -.38], [-.16, -.05, .72, -.64],
        [.01, -.12, .48, -.82], [-.09, .03, -.42, -.68],
        [-.14, .11, -.77, -.35], [.08, .08, -.86, .16],
      ];
      for (const [x,z,dx,dz] of spokes) {
        const length = Math.hypot(dx, dz) || 1;
        const side = .018;
        const nx = -dz / length * side, nz = dx / length * side;
        // A pair of thin segments gives each crack a chipped, tapered end.
        vertices.push(
          x - nx, 0, z - nz,
          x + dx, 0, z + dz,
          x + nx, 0, z + nz,
          x + dx * .66, 0, z + dz * .66,
        );
      }
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
      return geometry;
    });
  }
  function groundImpact(position, strength = 1, critical = false) {
    const weight = THREE.MathUtils.clamp(strength, .45, 2.4);
    const point = position.clone(); point.y = .055;
    // The expanding rings sit on the floor and make a heavy blade read as a
    // force transmitted through the paving, instead of a floating hit flash.
    ring(point, .56 + weight * .16, critical ? 0xf3c080 : 0xc49368, critical ? .34 : .24);
    if (critical) ring(point, .94 + weight * .22, 0xd8a36e, .48);
    const group = acquire('ground-crack', () => {
      const g = new THREE.Group();
      const crack = new THREE.LineSegments(groundCrackGeometry(), lineAdditive(0xd2a46f, .68));
      g.add(crack);
      return g;
    });
    group.position.copy(point);
    group.scale.setScalar(.75 + weight * .22);
    group.rotation.y = Math.atan2(position.x + .13, position.z - .17);
    const crack = group.children[0];
    crack.material.color.setHex(critical ? 0xffd28d : 0xd2a46f);
    crack.material.opacity = critical ? .82 : .54;
    add(group, critical ? .46 : .31, (o, p) => {
      const fade = Math.pow(1 - p, 1.35);
      o.children[0].material.opacity = (critical ? .82 : .54) * fade;
      o.scale.setScalar((.75 + weight * .22) * (1 + p * .17));
    });
    // Kick a low dust fan from the same contact point.  This is intentionally
    // separate from impact() so a normal cut keeps its sharp, compact flash.
    const count = critical ? 10 : Math.max(4, Math.round(3 + weight * 2));
    for (let i = 0; i < count; i++) {
      const angle = i / count * Math.PI * 2 + Math.random() * .24;
      const speed = 1.1 + Math.random() * (1.4 + weight);
      velocity.set(Math.sin(angle) * speed, .34 + Math.random() * .72, Math.cos(angle) * speed);
      emit(slivers, point, velocity, critical ? 0xd5a878 : 0x9c866d,
        .22 + Math.random() * .12, .14 + weight * .05, .045 + weight * .018, .62, 6, angle, true);
    }
    return group;
  }
  // Three shared draw calls cover every flash, flying sliver and falling chip.
  function flatShape(points) {
    const shape = new THREE.Shape(); shape.moveTo(...points[0]);
    points.slice(1).forEach(p => shape.lineTo(...p)); shape.closePath(); return new THREE.ShapeGeometry(shape);
  }
  function particlePool(geometry, capacity, debris = false) {
    const material = debris
      ? new THREE.MeshBasicMaterial({color:0xffffff,vertexColors:true,toneMapped:false})
      : additive(0xffffff);
    material.vertexColors = true;
    const mesh = new THREE.InstancedMesh(geometry, material, capacity);
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage); mesh.frustumCulled = false; mesh.count = 0; mesh.visible = false; mesh.renderOrder = debris ? 0 : 2;
    for (let i=0;i<capacity;i++) mesh.setColorAt(i,tint.setHex(0xffffff));
    mesh.instanceColor.setUsage(THREE.DynamicDrawUsage); scene.add(mesh);
    const pool = {mesh,debris,cursor:0,submitted:new Array(capacity),submittedGeneration:new Uint32Array(capacity),particles:Array.from({length:capacity},()=>({active:false,pos:new THREE.Vector3(),velocity:new THREE.Vector3(),color:new THREE.Color(),age:0,life:0,x:0,y:0,z:0,angle:0,spin:0,gravity:0,awaitingPresentation:false,generation:0}))};
    // Simulation may run several times before a draw. Only an actual draw starts
    // the short impact flash's fade; motion and unseen-particle timeout continue.
    mesh.onBeforeRender = () => {
      for (let i=0;i<mesh.count;i++) {
        const p = pool.submitted[i];
        if(p?.active && p.awaitingPresentation && p.generation===pool.submittedGeneration[i]) {
          p.awaitingPresentation=false; p.age=0;
        }
      }
    };
    return pool;
  }
  const flashes = particlePool(flatShape([[1,0],[0.13,0.12],[0,0.8],[-0.13,0.12],[-1,0],[-0.13,-0.12],[0,-0.8],[0.13,-0.12]]),64);
  const slivers = particlePool(flatShape([[-0.5,0],[0,0.075],[0.5,0],[0,-0.075]]),160);
  const chips = particlePool(new THREE.OctahedronGeometry(1,0),96,true), particlePools = [flashes,slivers,chips];
  function emit(pool,pos,velocity,color,life,x,y,z=1,gravity=0,angle=0,awaitPresentation=false) {
    const p = pool.particles[pool.cursor++ % pool.particles.length];
    p.active=true; p.pos.copy(pos); p.velocity.copy(velocity); p.color.setHex(color);
    p.age=0; p.life=life; p.x=x; p.y=y; p.z=z; p.gravity=gravity; p.angle=angle; p.spin=(Math.random()-0.5)*8;
    p.awaitingPresentation=awaitPresentation; p.generation=(p.generation+1)>>>0;
  }
  function updateParticles(dt) {
    cameraRight.set(1,0,0).applyQuaternion(camera.quaternion); cameraUp.set(0,1,0).applyQuaternion(camera.quaternion);
    for (const pool of particlePools) {
      let count=0;
      for (const p of pool.particles) {
        if (!p.active) continue;
        p.age+=dt; if(p.age>=(p.awaitingPresentation?firstPresentationTimeout:p.life)){p.active=false;continue;}
        p.velocity.y-=dt*p.gravity; p.pos.addScaledVector(p.velocity,dt);
        if(pool.debris && p.pos.y<0.055){const drag=Math.exp(-groundDrag*dt);p.pos.y=0.055;p.velocity.y=0;p.velocity.x*=drag;p.velocity.z*=drag;}
        const phase=p.awaitingPresentation?0:p.age/p.life,fade=Math.pow(1-phase,pool.debris?0.4:1.3);
        dummy.position.copy(p.pos);
        if(pool.debris) dummy.rotation.set(p.angle+p.age*p.spin,p.age*p.spin,p.angle);
        else {
          dummy.quaternion.copy(camera.quaternion);
          const angle=p.velocity.lengthSq()>0.2?Math.atan2(p.velocity.dot(cameraUp),p.velocity.dot(cameraRight)):p.angle;
          dummy.rotateZ(angle);
        }
        const scale=pool.debris?Math.max(0.03,fade):0.6+0.4*fade;
        dummy.scale.set(p.x*scale,p.y*scale,p.z*scale); dummy.updateMatrix();
        pool.submitted[count]=p;pool.submittedGeneration[count]=p.generation;
        pool.mesh.setMatrixAt(count,dummy.matrix); pool.mesh.setColorAt(count++,tint.copy(p.color).multiplyScalar(pool.debris?1:fade));
      }
      pool.mesh.count=count;pool.mesh.visible=count>0;
      if(count){pool.mesh.instanceMatrix.needsUpdate=true;pool.mesh.instanceColor.needsUpdate=true;}
    }
  }
  const direction=new THREE.Vector3(),side=new THREE.Vector3(),velocity=new THREE.Vector3(),point=new THREE.Vector3(),zero=new THREE.Vector3();
  // `style` is the authored attack index when the impact came from a reviewed
  // weapon animation.  It is optional so projectile/enemy impacts keep their
  // existing API.  The great dao finisher (style 3) gets a wider second flare
  // and a crescent that carries the blade direction through the hit.  This is
  // deliberately additive: no pause or camera-facing billboard replaces the
  // actual fast blade trail.
  function impact(position,cutDirection,strength=1,critical=false,style=0) {
    const weight=THREE.MathUtils.clamp(strength,0.4,2);
    direction.copy(cutDirection||zero);if(direction.lengthSq()<0.001)direction.set(0,0,1);direction.normalize();
    side.set(-direction.z,0.15,direction.x).normalize();
    cameraRight.set(1,0,0).applyQuaternion(camera.quaternion);cameraUp.set(0,1,0).applyQuaternion(camera.quaternion);
    const angle=Math.atan2(direction.dot(cameraUp),direction.dot(cameraRight)),size=0.22+weight*0.1;
    emit(flashes,position,zero,0xfff9df,0.06+(critical?0.015:0),size,size*0.75,1,0,angle,true);
    emit(flashes,position,zero,0xd3a8ef,critical?0.16:0.12,size*(critical?2.2:1.65),size*0.66,1,0,angle+0.6);
    if (critical && style === 3) {
      // The reference heavy swing is a cold steel-blue outer edge with a
      // white core. Keep the flash wide and directional, but let the actual
      // blade trail remain the source of the motion rather than a screen-sized
      // hit billboard.
      emit(flashes,position,zero,0x38b9ff,0.18,size*3.8,size*0.18,1,0,angle+Math.PI*.5,true);
      const crescentPoint = position.clone(); crescentPoint.y = 0;
      arc(crescentPoint, Math.atan2(direction.x,direction.z), 1.48 + weight*.24, 3, 0x5caecb);
      ring(crescentPoint, 1.34 + weight*.20, 0x4b9fb8, .34);
    }
    for(let i=0,count=critical?8:Math.round(4+weight);i<count;i++){
      velocity.copy(direction).multiplyScalar(3+Math.random()*3*weight).addScaledVector(side,(Math.random()-0.5)*(critical?4.4:3));
      velocity.y+=0.2+Math.random()*1.5;point.copy(position).addScaledVector(side,(Math.random()-0.5)*0.12);
      emit(slivers,point,velocity,palette[i%palette.length],0.13+Math.random()*0.09,0.26+Math.random()*0.35*weight,0.15+Math.random()*0.12,1,5,0,true);
    }
    // A hit also throws a short, directional blood spray.  It uses the pooled
    // opaque chip pass so the droplets read as red volume instead of another
    // pale additive slash, while keeping the same draw-call budget.
    const bloodCount = critical ? 9 : Math.max(3, Math.round(2 + weight * 2));
    for (let i = 0; i < bloodCount; i++) {
      const spread = (Math.random() - .5) * (critical ? 2.6 : 1.8);
      velocity.copy(direction).multiplyScalar(1.4 + Math.random() * (1.8 + weight));
      velocity.addScaledVector(side, spread);
      velocity.y += .45 + Math.random() * (critical ? 1.8 : 1.1);
      point.copy(position).addScaledVector(side, (Math.random() - .5) * .08);
      emit(chips, point, velocity, i % 3 ? 0xb52f36 : 0xe15a45,
        .26 + Math.random() * .16, .035 + Math.random() * .028,
        .026 + Math.random() * .022, .045 + Math.random() * .03, 7.5, Math.random() * 6.28, true);
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
    const trail={mesh,points:[],color:new THREE.Color(0xb0c4ff),coreColor:new THREE.Color(0xfff7eb),widthFactor:1,life:trailLife,preserveUntilPresented:false,spare:Array.from({length:32},()=>({tip:new THREE.Vector3(),inner:new THREE.Vector3(),core:new THREE.Vector3(),body:new THREE.Vector3(),age:0,unseenAge:0,awaitingPresentation:false})),positions,colors,wasActive:false};trails.push(trail);return trail;
  }
  function releaseTrailPoint(trail,point) {
    point.age=0;point.unseenAge=0;point.awaitingPresentation=false;
    trail.spare.push(point);
  }
  function resetTrail(trail) {
    while(trail.points.length)releaseTrailPoint(trail,trail.points.pop());trail.mesh.geometry.setDrawRange(0,0);trail.wasActive=false;trail.previousBlade=null;
  }
  function presented() {
    // Called after the actual draw, once all simulation steps have contributed
    // their real blade samples. Only the first presentation starts their fade.
    for(const trail of trails) {
      if(!trail.mesh.visible||trail.mesh.geometry.drawRange.count===0)continue;
      for(const point of trail.points)if(point.awaitingPresentation) {
        point.awaitingPresentation=false;point.age=0;point.unseenAge=0;
      }
    }
  }
  function sample(trail,tip,body,active,dt) {
    const life=trail.life??trailLife;
    const unseenElapsed=Math.max(0,dt||0),elapsed=Math.min(unseenElapsed,0.2);
    for(const p of trail.points) {
      if(p.awaitingPresentation)p.unseenAge+=unseenElapsed;
      else p.age+=elapsed;
    }
    while(trail.points.length) {
      const point=trail.points[0];
      if(point.awaitingPresentation?point.unseenAge<firstPresentationTimeout:point.age<life)break;
      releaseTrailPoint(trail,trail.points.shift());
    }
    if(active&&tip&&body){
      const last=trail.points.at(-1);
      // Mount/state changes and discontinuous sampling never connect into a rod.
      if(!trail.wasActive||elapsed>0.07||(last&&(last.tip.distanceToSquared(tip)>4.4||last.body.distanceToSquared(body)>1.4)))resetTrail(trail);
      const previous=trail.points.at(-1);
      if(!previous||previous.tip.distanceToSquared(tip)>0.0004){const p=trail.spare.pop()||trail.points.shift();p.tip.copy(tip);p.body.copy(body);p.inner.copy(tip).lerp(body,0.26*trail.widthFactor);p.core.copy(tip).lerp(body,0.055*trail.widthFactor);p.age=0;p.unseenAge=0;p.awaitingPresentation=!!trail.preserveUntilPresented;trail.points.push(p);if(trail.points.length>29)releaseTrailPoint(trail,trail.points.shift());}
    }
    trail.wasActive=Boolean(active);let at=0;
    function vertex(point,age,layer,edge){
      trail.positions[at]=point.x;trail.positions[at+1]=point.y;trail.positions[at+2]=point.z;const fade=Math.pow(Math.max(0,1-age/life),1.6);
      const color=layer?trail.coreColor:trail.color,strength=layer||edge?1:0.22;
      trail.colors[at]=fade*color.r*strength;trail.colors[at+1]=fade*color.g*strength;trail.colors[at+2]=fade*color.b*strength;at+=3;
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
    function disposeMesh(mesh){scene.remove(mesh);mesh.traverse(o=>{if(!(o.isMesh||o.isLineSegments))return;if(!disposed.has(o.geometry)){o.geometry.dispose();disposed.add(o.geometry);}for(const material of Array.isArray(o.material)?o.material:[o.material]){if(!disposed.has(material)){material.dispose();disposed.add(material);}}});}
    allCached.forEach(disposeMesh);particlePools.forEach(pool=>disposeMesh(pool.mesh));trails.forEach(trail=>disposeMesh(trail.mesh));geometries.forEach(geometry=>{if(!disposed.has(geometry))geometry.dispose();});allCached.clear();cache.clear();geometries.clear();
  }
  return {ring,warning,groundImpact,burst,impact,death,arc,ghost,swordTrail,sample,presented,update,clear,destroy};
}
