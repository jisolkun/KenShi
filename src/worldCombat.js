import * as THREE from 'three';

const clamp = (x, low, high) => Math.max(low, Math.min(high, x));
const point = (a, b, t) => ({ x: a.x + (b.x - a.x) * t,
  y: a.y + (b.y - a.y) * t, z: a.z + (b.z - a.z) * t });

// Distance to an actual prop's vertical volume, rather than to the hero or an
// invented impact position. Convex minimization also catches a long blade whose
// endpoints miss the prop while its middle crosses the stone.
function bladeContact(heel, tip, volume, width) {
  const distance = t => {
    const p = point(heel, tip, t);
    const horizontal = Math.max(0, Math.hypot(p.x - volume.x, p.z - volume.z) - volume.radius);
    const vertical = Math.max(volume.minY - p.y, 0, p.y - volume.maxY);
    return horizontal * horizontal + vertical * vertical;
  };
  let low = 0, high = 1;
  for (let i = 0; i < 26; i++) {
    const a = (low * 2 + high) / 3, b = (low + high * 2) / 3;
    if (distance(a) < distance(b)) high = b; else low = a;
  }
  const t = (low + high) / 2;
  return distance(t) <= width * width ? point(heel, tip, t) : null;
}

export function sweptPropContact(previous, current, volume, width = .1) {
  if (!current?.heel || !current?.tip) return null;
  const poses = previous ? [previous, current] : [current];
  const minX = Math.min(...poses.flatMap(p => [p.heel.x, p.tip.x])) - width;
  const maxX = Math.max(...poses.flatMap(p => [p.heel.x, p.tip.x])) + width;
  const minZ = Math.min(...poses.flatMap(p => [p.heel.z, p.tip.z])) - width;
  const maxZ = Math.max(...poses.flatMap(p => [p.heel.z, p.tip.z])) + width;
  const minY = Math.min(...poses.flatMap(p => [p.heel.y, p.tip.y])) - width;
  const maxY = Math.max(...poses.flatMap(p => [p.heel.y, p.tip.y])) + width;
  if (maxX < volume.x - volume.radius || minX > volume.x + volume.radius ||
    maxZ < volume.z - volume.radius || minZ > volume.z + volume.radius ||
    maxY < volume.minY || minY > volume.maxY) return null;
  const travel = previous ? Math.max(Math.hypot(current.tip.x - previous.tip.x,
    current.tip.y - previous.tip.y, current.tip.z - previous.tip.z),
  Math.hypot(current.heel.x - previous.heel.x,
    current.heel.y - previous.heel.y, current.heel.z - previous.heel.z)) : 0;
  const count = Math.max(1, Math.min(24, Math.ceil(travel / .07)));
  for (let i = 0; i <= count; i++) {
    const t = i / count;
    const contact = bladeContact(previous ? point(previous.heel, current.heel, t) : current.heel,
      previous ? point(previous.tip, current.tip, t) : current.tip, volume, width);
    if (contact) return contact;
  }
  return null;
}

export function lowestBladePoint(previous, current) {
  const points = previous ? [previous.heel, previous.tip, current.heel, current.tip]
    : [current.heel, current.tip];
  return points.reduce((lowest, candidate) => candidate.y < lowest.y ? candidate : lowest);
}

// Only the physical hammer head sweeps this volume. The handle and an
// advertised attack radius cannot create stone fragments.
export function sweptHammerPropContact(previous, current, volume, radius = .27) {
  const center=current?.headCenter;
  if(!center||![center.x,center.y,center.z,radius].every(Number.isFinite)||radius<0)return null;
  const start=previous?.headCenter??center;
  if(![start.x,start.y,start.z].every(Number.isFinite))return null;
  const halfHeight=frame=>Number.isFinite(frame?.headHalfHeight)&&frame.headHalfHeight>=0?frame.headHalfHeight:.19;
  const startHeight=halfHeight(previous??current),heightDelta=halfHeight(current)-startHeight;
  const dx=center.x-start.x,dy=center.y-start.y,dz=center.z-start.z;
  let from=0,to=1;
  // Projected head height changes as it rotates. Clip both vertical slab
  // inequalities at that same phase before finding the horizontal closest point.
  for(const [offset,slope] of [[start.y+startHeight-volume.minY,dy+heightDelta],
    [volume.maxY-start.y+startHeight,-dy+heightDelta]]){
    if(Math.abs(slope)<1e-12){if(offset<0)return null;}
    else if(slope>0)from=Math.max(from,-offset/slope);
    else to=Math.min(to,-offset/slope);
    if(to<from)return null;
  }
  const length=dx*dx+dz*dz;
  const projected=length?((volume.x-start.x)*dx+(volume.z-start.z)*dz)/length:from;
  const t=clamp(projected,from,to),contact=point(start,center,t),reach=volume.radius+radius;
  return (contact.x-volume.x)**2+(contact.z-volume.z)**2<=reach*reach+1e-12?contact:null;
}

export function createWorldCombat(parent, { props = [], random = Math.random } = {}) {
  const group = new THREE.Group(); group.name = 'blade-world-reactions'; parent.add(group);
  const dummy = new THREE.Object3D(), tint = new THREE.Color();
  const records = new Map();
  const stats = { dustSweeps: 0, propHits: 0, groundHits: 0 };
  let lastDust = null, lastContact = null, lastGround = null;
  const dustGeometry = new THREE.IcosahedronGeometry(1, 0);
  const chipGeometry = new THREE.OctahedronGeometry(1, 0);
  const leafGeometry = new THREE.PlaneGeometry(1, .38);
  const sparkGeometry = new THREE.PlaneGeometry(1, .1);
  function pool(name, geometry, capacity, opacity, additive = false) {
    const material = new THREE.MeshBasicMaterial({ color: 0xffffff, vertexColors: true,
      transparent: true, opacity, depthWrite: false, side: THREE.DoubleSide,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending, toneMapped: false });
    const mesh = new THREE.InstancedMesh(geometry, material, capacity);
    mesh.name = name; mesh.count = 0; mesh.visible = false; mesh.frustumCulled = false;
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage); group.add(mesh);
    for (let i = 0; i < capacity; i++) mesh.setColorAt(i, tint.setHex(0xffffff));
    mesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
    return { name, mesh, cursor: 0, particles: Array.from({ length: capacity }, () => ({
      active: false, position: new THREE.Vector3(), velocity: new THREE.Vector3(), color: new THREE.Color(),
      age: 0, unseen: 0, awaiting: false, life: 0, scale: 0, spin: 0, angle: 0, gravity: 0,
    })) };
  }
  const dust = pool('swept-ground-dust', dustGeometry, 72, .24);
  const leaves = pool('swept-ground-leaves', leafGeometry, 48, .86);
  const chips = pool('struck-stone-chips', chipGeometry, 64, 1);
  const sparks = pool('struck-stone-sparks', sparkGeometry, 48, .9, true);
  const pools = [dust, leaves, chips, sparks];
  const markGeometry = new THREE.PlaneGeometry(1, .038);
  const crackVertices=[];
  for(let spoke=0;spoke<7;spoke++){
    const angle=spoke/7*Math.PI*2+.12,length=.45+(spoke%3)*.13;
    const points=[[Math.cos(angle)*.08,Math.sin(angle)*.08],
      [Math.cos(angle+.12)*length*.62,Math.sin(angle+.12)*length*.62],
      [Math.cos(angle)*length,Math.sin(angle)*length]];
    for(let i=1;i<points.length;i++){
      const [ax,ay]=points[i-1],[bx,by]=points[i],dx=bx-ax,dy=by-ay,span=Math.hypot(dx,dy),ox=-dy/span*.012,oy=dx/span*.012;
      const corners=[[ax-ox,ay-oy,0],[ax+ox,ay+oy,0],[bx-ox,by-oy,0],[bx+ox,by+oy,0]];
      for(const index of [0,1,2,2,1,3])crackVertices.push(...corners[index]);
    }
  }
  const hammerCrackGeometry=new THREE.BufferGeometry();hammerCrackGeometry.setAttribute('position',new THREE.Float32BufferAttribute(crackVertices,3));
  const hammerRingGeometry=new THREE.RingGeometry(.92,1,32);
  const marks = Array.from({ length: 12 }, () => {
    const mesh = new THREE.Mesh(markGeometry, new THREE.MeshBasicMaterial({ color: 0x3c3b32,
      transparent: true, opacity: .72, depthWrite: false, polygonOffset: true,
      polygonOffsetFactor: -1, polygonOffsetUnits: -1, side: THREE.DoubleSide }));
    mesh.rotation.x = -Math.PI / 2; mesh.visible = false; group.add(mesh);
    const ring=new THREE.Mesh(hammerRingGeometry,new THREE.MeshBasicMaterial({color:0xd8b78c,transparent:true,
      opacity:0,depthWrite:false,side:THREE.DoubleSide,toneMapped:false}));
    ring.visible=false;ring.position.z=.003;mesh.add(ring);
    return { mesh, ring, hammer: false, active: false, age: 0, life: 1.5, awaiting: false, unseen: 0 };
  });
  let markCursor = 0;
  function emit(targetPool, location, velocity, color, life, scale, gravity = 3) {
    const p = targetPool.particles[targetPool.cursor++ % targetPool.particles.length];
    p.active = true; p.position.set(location.x, location.y, location.z); p.velocity.copy(velocity);
    p.color.setHex(color); p.age = p.unseen = 0; p.awaiting = true; p.life = life;
    p.scale = scale; p.gravity = gravity; p.angle = random() * Math.PI * 2; p.spin = (random() - .5) * 8;
  }
  const velocity = new THREE.Vector3();
  function dustFan(location, direction, heavy = false) {
    const count = heavy ? 20 : 10;
    for (let i = 0; i < count; i++) {
      const angle = Math.atan2(direction.x, direction.z) + (random() - .5) * 1.9;
      const speed = .6 + random() * (heavy ? 3.8 : 2.2);
      velocity.set(Math.sin(angle) * speed, .3 + random() * (heavy ? .7 : .45), Math.cos(angle) * speed);
      emit(dust, { x: location.x, y: .12, z: location.z }, velocity, 0xb2a183,
        .55 + random() * .3, .09 + random() * .11, 1.4);
    }
    for (let i = 0; i < (heavy ? 9 : 5); i++) {
      velocity.set(direction.x * (1 + random()) + (random() - .5), .6 + random() * 1.1,
        direction.z * (1 + random()) + (random() - .5));
      emit(leaves, { x: location.x, y: .08, z: location.z }, velocity,
        i % 2 ? 0xc08e46 : 0x986d35, .75 + random() * .4, .12 + random() * .09, 3);
    }
  }
  function refresh() {
    for (const ppool of pools) {
      let count = 0;
      for (const p of ppool.particles) {
        if (!p.active) continue;
        const phase = p.awaiting ? 0 : clamp(p.age / p.life, 0, 1), fade = 1 - phase;
        dummy.position.copy(p.position);
        dummy.rotation.set(p.angle + p.age * p.spin, p.angle * .5, p.age * p.spin);
        const size = p.scale * (ppool === dust ? 1 + phase * 2 : Math.max(.01, fade));
        dummy.scale.setScalar(size); dummy.updateMatrix();
        ppool.mesh.setMatrixAt(count, dummy.matrix);
        ppool.mesh.setColorAt(count++, tint.copy(p.color).multiplyScalar(ppool === sparks ? fade : 1));
      }
      ppool.mesh.count = count; ppool.mesh.visible = count > 0;
      ppool.mesh.instanceMatrix.needsUpdate = true; ppool.mesh.instanceColor.needsUpdate = true;
    }
    for (const mark of marks) {
      mark.mesh.visible = mark.active;
      const markFade=mark.awaiting?1:mark.hammer
        ?1-clamp((mark.age-1)/.5,0,1):1-clamp(mark.age/mark.life,0,1);
      mark.mesh.material.opacity = .72 * markFade;
      if(mark.hammer){
        const age=mark.awaiting?0:mark.age,phase=clamp(age/.20,0,1);
        mark.ring.visible=mark.active&&phase<1;
        mark.ring.scale.setScalar(.32+phase*.95);mark.ring.material.opacity=.30*(1-phase)*(1-phase);
      }else mark.ring.visible=false;
    }
  }
  function reactToBlade({ previous = null, current, combo = 0, strikeId = 0, origin = null } = {}) {
    if (!current?.heel || !current?.tip) return;
    if (!records.has(strikeId)) {
      records.set(strikeId, { dust: false, ground: false, props: new Set() });
      if (records.size > 32) records.delete(records.keys().next().value);
    }
    const record = records.get(strikeId), low = lowestBladePoint(previous, current);
    const direction = previous ? new THREE.Vector3(current.tip.x - previous.tip.x, 0,
      current.tip.z - previous.tip.z) : new THREE.Vector3(current.tip.x - current.heel.x, 0,
      current.tip.z - current.heel.z);
    // A vertical cleave has almost no horizontal tip velocity. It still makes
    // a real ground/stone contact; direct its debris away from the wielder.
    if (direction.lengthSq() < .00001) direction.set(current.tip.x - (origin?.x ?? current.heel.x),
      0, current.tip.z - (origin?.z ?? current.heel.z));
    if (direction.lengthSq() < .00001) direction.set(0, 0, 1);
    direction.normalize();
    if (!record.dust && low.y >= -.1 && low.y <= 1.45) {
      record.dust = true; stats.dustSweeps++; lastDust = { x: low.x, y: .12, z: low.z };
      dustFan(low, direction);
    }
    for (const prop of props) {
      if (record.props.has(prop.id)) continue;
      let contact = null;
      for (const volume of prop.volumes) {
        contact = sweptPropContact(previous, current, volume);
        if (contact) break;
      }
      if (!contact) continue;
      record.props.add(prop.id); stats.propHits++;
      lastContact = { prop: prop.id, type: prop.type, ...contact };
      // A heavy finishing edge throws a wider fan of stone and hot sparks.
      // Keep both streams in the fixed pools; this changes only the burst
      // density and launch speed, not the collision envelope.
      const fragments = combo === 3 ? 12 : 8;
      for (let i = 0; i < fragments; i++) {
        const launch = combo === 3 ? 1.35 : 1;
        velocity.set(direction.x * (launch + random() * (combo === 3 ? 2.8 : 2)) + (random() - .5),
          .6 + random() * (combo === 3 ? 2.35 : 1.8), direction.z * (launch + random() * (combo === 3 ? 2.8 : 2)) + (random() - .5));
        emit(chips, contact, velocity, i % 2 ? 0x78867b : 0xb5b3a1, .6 + random() * .35, .025 + random() * .055, 6);
        emit(sparks, contact, velocity, 0xffd594, .15 + random() * .13, .09 + random() * .08, 2);
      }
    }
    // Highest court paving is .049m; the great blade's half-width is .11m.
    // Only that physical near-ground blade envelope can leave a slash mark.
    if (combo === 3 && !record.ground && low.y >= -.1 && low.y <= .16) {
      record.ground = true; stats.groundHits++; lastGround = { x: low.x, y: .068, z: low.z };
      dustFan(low, direction, true);
      const mark = marks[markCursor++ % marks.length];
      mark.hammer=false;mark.mesh.geometry=markGeometry;mark.ring.visible=false;
      mark.active = mark.awaiting = true; mark.age = mark.unseen = 0;
      mark.mesh.position.set(low.x, .068, low.z);
      mark.mesh.rotation.set(-Math.PI / 2, 0, -Math.atan2(direction.z, direction.x));
      // The last descending edge drags a long, visible scar across the paving;
      // regular sweeps retain the short readable mark used for light contact.
      mark.mesh.scale.set(combo === 3 ? .92 : .6, combo === 3 ? 1.42 : 1, 1);
      mark.mesh.material.color.setHex(combo === 3 ? 0x5b3a31 : 0x3c3b32);
      mark.life = combo === 3 ? 2.1 : 1.5;
    }
    refresh(); // A new event is visible even before the next simulation update.
  }
  function reactToHammer({previous=null,current,combo=0,strikeId=0,headRadius=.27,groundY=.049}={}){
    const result={groundContact:null,propContacts:[]},center=current?.headCenter;
    if(!center||![center.x,center.y,center.z,headRadius,groundY].every(Number.isFinite))return result;
    if(!records.has(strikeId)){
      records.set(strikeId,{dust:false,ground:false,props:new Set()});
      if(records.size>32)records.delete(records.keys().next().value);
    }
    const record=records.get(strikeId),travel=previous?.headCenter
      ?new THREE.Vector3().subVectors(center,previous.headCenter):new THREE.Vector3(0,0,1);
    if(travel.lengthSq()<1e-6)travel.set(0,0,1);travel.normalize();
    for(const prop of props){
      if(record.props.has(prop.id))continue;
      let contact=null;
      for(const volume of prop.volumes){contact=sweptHammerPropContact(previous,current,volume,headRadius);if(contact)break;}
      if(!contact)continue;
      record.props.add(prop.id);stats.propHits++;lastContact={prop:prop.id,type:prop.type,...contact};
      result.propContacts.push({...lastContact});
      for(let i=0;i<10;i++){
        const angle=i/10*Math.PI*2;
        velocity.set(Math.sin(angle)*(.9+random()*1.4),.4+random()*1.1,Math.cos(angle)*(.9+random()*1.4));
        emit(chips,contact,velocity,i%2?0x78867b:0xb5b3a1,.36+random()*.2,.035+random()*.045,7);
      }
    }
    // The actual eight-corner head bottom controls contact; its spherical
    // damage envelope must never manufacture a floor hit during a high sweep.
    const candidates=[previous,current].filter(frame=>frame?.headCenter&&Number.isFinite(frame.headBottom));
    const low=candidates.reduce((best,frame)=>!best||frame.headBottom<best.headBottom?frame:best,null);
    if(combo===3&&!record.ground&&low&&low.headBottom>=groundY-.035&&low.headBottom<=groundY+.025){
      record.ground=true;stats.groundHits++;
      const contact={x:low.headCenter.x,y:groundY+.018,z:low.headCenter.z};
      record.dust=true;stats.dustSweeps++;lastDust={...contact};
      result.groundContact=new THREE.Vector3(contact.x,contact.y,contact.z);lastGround={...contact};
      for(let i=0;i<20;i++){
        const angle=i/20*Math.PI*2+(random()-.5)*.15,speed=1.2+random()*1.7;
        velocity.set(Math.sin(angle)*speed,.12+random()*.22,Math.cos(angle)*speed);
        emit(dust,contact,velocity,0xb29a78,.28+random()*.10,.085+random()*.065,1.4);
      }
      for(let i=0;i<8;i++){
        const angle=i/8*Math.PI*2,speed=.9+random()*1.5;
        velocity.set(Math.sin(angle)*speed,.25+random()*.55,Math.cos(angle)*speed);
        emit(chips,contact,velocity,i%2?0x8b8170:0xb29c7b,.35+random()*.18,.035+random()*.03,5);
      }
      const mark=marks[markCursor++%marks.length];
      mark.hammer=true;mark.mesh.geometry=hammerCrackGeometry;mark.mesh.material.color.setHex(0x4d4030);
      mark.active=mark.awaiting=true;mark.age=mark.unseen=0;mark.life=1.5;
      mark.mesh.position.set(contact.x,contact.y,contact.z);mark.mesh.rotation.set(-Math.PI/2,0,0);mark.mesh.scale.setScalar(1.12);
    }
    refresh();return result;
  }
  function feedbackStrike(payload={}){
    return payload.weaponId==='great-hammer'||payload.strikeVolume==='hammer-head'
      ?reactToHammer(payload):reactToBlade(payload);
  }
  function update(dt) {
    if (!Number.isFinite(dt) || dt <= 0) return;
    for (const ppool of pools) for (const p of ppool.particles) {
      if (!p.active) continue;
      if (p.awaiting) p.unseen += dt; else p.age += dt;
      if ((p.awaiting ? p.unseen >= .75 : p.age >= p.life)) { p.active = false; continue; }
      p.velocity.y -= p.gravity * dt; p.position.addScaledVector(p.velocity, dt);
      if (p.position.y < .065) {
        p.position.y = .065; p.velocity.y = 0;
        p.velocity.x *= Math.exp(-dt * 7); p.velocity.z *= Math.exp(-dt * 7);
      }
    }
    for (const mark of marks) {
      if (!mark.active) continue;
      if (mark.awaiting) mark.unseen += dt; else mark.age += dt;
      if ((mark.awaiting ? mark.unseen >= .75 : mark.age >= mark.life)) mark.active = false;
    }
    refresh();
  }
  function presentedCombat() {
    for (const ppool of pools) for (const p of ppool.particles)
      if (p.active && p.awaiting) { p.awaiting = false; p.age = 0; }
    for (const mark of marks) if (mark.active && mark.awaiting) { mark.awaiting = false; mark.age = 0; }
  }
  function clearCombat() {
    records.clear(); stats.dustSweeps = stats.propHits = stats.groundHits = 0;
    lastDust = lastContact = lastGround = null;
    for (const ppool of pools) for (const p of ppool.particles) p.active = false;
    for (const mark of marks) mark.active = false;
    refresh();
  }
  function getCombatState() {
    const poolCounts = Object.fromEntries(pools.map(ppool => [ppool.name, ppool.mesh.count]));
    return { ...stats, activeParticles: Object.values(poolCounts).reduce((a, b) => a + b, 0),
      activeMarks: marks.filter(mark => mark.active).length, poolCounts,
      activeHammerRings: marks.filter(mark=>mark.hammer&&mark.ring.visible).length,
      particleBudget: 232, markBudget: marks.length, trackedStrikes: records.size,
      lastDust, lastContact, lastGround,
      props: props.map(prop => ({ id: prop.id, type: prop.type, volumes: prop.volumes })) };
  }
  return { group, reactToBlade, feedbackStrike, update, presentedCombat, clearCombat, getCombatState };
}
