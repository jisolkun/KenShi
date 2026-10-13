import * as THREE from 'three';
import { getWeapon } from './weapons.js';
import { getHammerFeedback } from './hammerFeedback.js';

// Local coordinates follow the combat convention: +Z forward, +X right.
// Each silhouette is authored once, shared by all pooled instances.
export function createWeaponEffects(scene, baseEffects) {
  const geometries = new Map(), spare = new Map(), all = new Set(), live = [];
  const direction = new THREE.Vector3(), forward = new THREE.Vector3(0,0,1), up = new THREE.Vector3(0,1,0);
  const greatCutDirections=[[-.98,-.06,.18],[.78,-.62,.18],[-.96,.10,.22],[.06,-.92,.38],[.56,-.18,-.82]];
  let destroyed = false, lastImpact = null, impactSequence = 0;
  const MAX_LIVE = 72, MAX_GREAT_IMPACTS = 24, MAX_HAMMER_SWINGS = 8, FIRST_PRESENTATION_TIMEOUT = .5;
  const arc = (radius, start, end, y = 0, x = 0, z = 0, count = 18) => Array.from({length:count+1}, (_, i) => {
    const a = start + (end-start)*i/count; return [x+Math.sin(a)*radius,y, z+Math.cos(a)*radius];
  });
  const line = (a,b) => [a,b];
  const cuts = {
    'dual-dao': [arc(1.6,-1.2,0.75,0.13,-0.3),arc(1.55,-0.6,1.35,-0.13,0.3)],
    'tang-dao': [line([-1.45,0.45,1.65],[1.45,-0.3,1.65])],
    // Preview slash: leave a long, readable veil on screen even before the
    // real blade samples begin. Combat trails still come from the physical tip.
    'great-dao': [arc(2.25,-1.48,1.48,0.08)],
  };
  function ribbon(paths,width) {
    const vertices=[];
    for(const points of paths) for(let i=1;i<points.length;i++) {
      const a=points[i-1],b=points[i],dx=b[0]-a[0],dz=b[2]-a[2],length=Math.hypot(dx,dz)||1;
      const taper=0.3+0.7*Math.sin(Math.PI*(i-0.5)/(points.length-1));
      const ox=-dz/length*width*taper,oz=dx/length*width*taper;
      const corners=[[a[0]-ox,a[1],a[2]-oz],[a[0]+ox,a[1]+0.025,a[2]+oz],[b[0]-ox,b[1],b[2]-oz],[b[0]+ox,b[1]+0.025,b[2]+oz]];
      for(const j of [0,1,2,2,1,3])vertices.push(...corners[j]);
    }
    const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(vertices,3));return g;
  }
  function verticalRibbon(paths,width) {
    const vertices=[];
    for(const points of paths) for(let i=1;i<points.length;i++) {
      const a=points[i-1],b=points[i],dx=b[0]-a[0],dy=b[1]-a[1],length=Math.hypot(dx,dy)||1;
      const taper=.3+.7*Math.sin(Math.PI*(i-.5)/(points.length-1)),ox=-dy/length*width*taper,oy=dx/length*width*taper;
      const corners=[[a[0]-ox,a[1]-oy,a[2]],[a[0]+ox,a[1]+oy,a[2]+.025],[b[0]-ox,b[1]-oy,b[2]],[b[0]+ox,b[1]+oy,b[2]+.025]];
      for(const j of [0,1,2,2,1,3])vertices.push(...corners[j]);
    }
    const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(vertices,3));return g;
  }
  function geometry(key,paths,width) {if(!geometries.has(key))geometries.set(key,ribbon(paths,width));return geometries.get(key);}
  function debrisGeometry() {if(!geometries.has('great-dao:chips'))geometries.set('great-dao:chips',new THREE.OctahedronGeometry(1,0));return geometries.get('great-dao:chips');}
  function contactCoreGeometry() {
    if(!geometries.has('great-dao:contact-core')) {
      const shape=new THREE.Shape();
      [[0,.23],[.025,.035],[.115,0],[.025,-.035],[0,-.15],[-.025,-.035],[-.115,0],[-.025,.035]].forEach(([x,y],i)=>i?shape.lineTo(x,y):shape.moveTo(x,y));shape.closePath();
      const flat=new THREE.ShapeGeometry(shape).toNonIndexed(),positions=flat.attributes.position,vertices=[];
      // Crossed narrow planes keep the local contact readable from above and
      // from the side, without a large camera-facing white disc.
      for(let i=0;i<positions.count;i++)vertices.push(positions.getX(i),0,positions.getY(i));
      for(let i=0;i<positions.count;i++)vertices.push(0,positions.getX(i),positions.getY(i));
      const geo=new THREE.BufferGeometry();geo.setAttribute('position',new THREE.Float32BufferAttribute(vertices,3));flat.dispose();geometries.set('great-dao:contact-core',geo);
    }
    return geometries.get('great-dao:contact-core');
  }
  function greatContactPaths(finisher) {
    const gain=finisher?1.24:1;
    return [
      [[-.27,0,.05],[-.22,.025,.27],[0,.025,.45],[.22,.025,.27],[.27,0,.05]],
      line([0,0,-.015],[0,0,.55]),
      line([-.035,0,.025],[-.17,.06,.36]),
      line([.035,0,.025],[.17,-.035,.36]),
    ].map(path=>path.map(point=>point.map(value=>value*gain)));
  }
  function material(color,opacity) {return new THREE.MeshBasicMaterial({color,opacity,transparent:true,depthWrite:false,side:THREE.DoubleSide,toneMapped:false});}
  function disposeInstance(o) {o.group.traverse(n=>{if(n.isMesh)n.material.dispose();if(n.isInstancedMesh)n.dispose();});}
  function release(o) {scene.remove(o.group);if(!spare.has(o.key))spare.set(o.key,[]);const pool=spare.get(o.key);if(pool.length<4)pool.push(o);else{disposeInstance(o);all.delete(o);}}
  function hammerCoreGeometry() {
    if(!geometries.has('great-hammer:core'))geometries.set('great-hammer:core',new THREE.IcosahedronGeometry(1,0));
    return geometries.get('great-hammer:core');
  }
  function hammerFanGeometry(key,halfAngle) {
    const geometryKey=`${key}:pressure`;
    if(!geometries.has(geometryKey)) {
      const positions=[];
      for(let i=0;i<28;i++) {
        const a=-halfAngle+i/28*halfAngle*2,b=-halfAngle+(i+1)/28*halfAngle*2;
        const inner=i%3===0?.72:.77;
        const vertices=[[Math.sin(a)*inner,.08,Math.cos(a)*inner],
          [Math.sin(a),.12,Math.cos(a)],[Math.sin(b)*inner,.08,Math.cos(b)*inner],
          [Math.sin(b),.12,Math.cos(b)]];
        for(const n of [0,1,2,2,1,3])positions.push(...vertices[n]);
      }
      const geometry=new THREE.BufferGeometry();
      geometry.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));
      geometries.set(geometryKey,geometry);
    }
    return geometries.get(geometryKey);
  }
  function hammerSwingGeometry(key, feedback, core=false) {
    const geometryKey=`${key}:${core?'core':'outer'}`;
    if(!geometries.has(geometryKey)) {
      // The reference heavy swing reads as one large, tapered silhouette. It
      // is deliberately a display-only arc; the physical head remains the
      // sole source of damage in reviewedHammerStrike.
      const sweep=feedback.swingSweep, radius=feedback.swingRadius*.62;
      const path=Array.from({length:29},(_,i)=>{const a=-.40+sweep*i/28;return [Math.sin(a)*radius,Math.cos(a)*radius,.12];});
      geometries.set(geometryKey,verticalRibbon([path],core?feedback.swingWidth*.28:feedback.swingWidth));
    }
    return geometries.get(geometryKey);
  }
  function hammerBurstGeometry(key, finisher=false) {
    const geometryKey=`${key}:burst`;
    if(!geometries.has(geometryKey)) {
      const count=finisher?10:8,positions=[];
      for(let i=0;i<count;i++) {
        const a=i/count*Math.PI*2,inner=.055,outer=finisher?.62+(i%2)*.16:.44+(i%2)*.10;
        const width=finisher?.024:.019,cos=Math.cos(a),sin=Math.sin(a);
        const p1=[cos*inner-sin*width,sin*inner+cos*width,0],p2=[cos*inner+sin*width,sin*inner-cos*width,0];
        const tip=[cos*outer,sin*outer,0];
        positions.push(...p1,...tip,...p2);
      }
      const geo=new THREE.BufferGeometry();geo.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));geometries.set(geometryKey,geo);
    }
    return geometries.get(geometryKey);
  }
  function hammerRippleGeometry(key) {
    const geometryKey=`${key}:ripple`;
    if(!geometries.has(geometryKey))geometries.set(geometryKey,new THREE.RingGeometry(.22,.27,20));
    return geometries.get(geometryKey);
  }
  function updateHammerFan(o,phase) {
    o.pressure.material.opacity=.46*Math.pow(1-phase,1.4);
    o.dust.material.opacity=.72*(1-phase);
    for(let i=0;i<o.dust.count;i++) {
      const angle=-o.halfAngle*.93+i/(o.dust.count-1)*o.halfAngle*1.86;
      const radius=.74+phase*.19;
      o.dummy.position.set(Math.sin(angle)*radius,.12+Math.sin(phase*Math.PI)*.38,Math.cos(angle)*radius);
      o.dummy.rotation.set(i*.7+phase*2,i*.3,phase*3);
      const size=(.025+i%3*.009)*(1-phase*.70);
      o.dummy.scale.set(size,size*.8,size*1.15);o.dummy.updateMatrix();
      o.dust.setMatrixAt(i,o.dummy.matrix);
    }
    o.dust.instanceMatrix.needsUpdate=true;
  }
  function hammerFan(area,combo=0) {
    if(destroyed||area?.kind!=='fan'||![area.radius,area.halfAngle,area.angle,
      area.origin?.x,area.origin?.y,area.origin?.z].every(Number.isFinite)
      ||area.radius<=0||area.halfAngle<=0||area.halfAngle>Math.PI)return;
    const style=((Math.trunc(combo)%5)+5)%5,key=`great-hammer:fan:${style}:${area.halfAngle.toFixed(4)}`;
    let o=spare.get(key)?.pop();
    if(!o) {
      const group=new THREE.Group(),pressure=new THREE.Mesh(hammerFanGeometry(key,area.halfAngle),material(0xb18c55,.46));
      pressure.name='hammer-thick-pressure-fan';
      const dust=new THREE.InstancedMesh(debrisGeometry(),material(0xc4ad87,.72),12);
      dust.name='hammer-pressure-stones';dust.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      group.add(pressure,dust);group.children.forEach(mesh=>mesh.frustumCulled=false);
      o={key,group,pressure,dust,dummy:new THREE.Object3D(),hammerFan:true};all.add(o);
    }
    if(live.length>=MAX_LIVE)release(live.shift());
    o.age=0;o.unseenAge=0;o.awaitingPresentation=true;o.life=.16;o.halfAngle=area.halfAngle;
    o.group.position.set(area.origin.x,area.origin.y,area.origin.z);
    o.group.rotation.set(0,area.angle,0);o.group.scale.set(area.radius,1,area.radius);
    o.group.userData.hammerArea={...area,origin:{...area.origin}};
    o.group.visible=true;updateHammerFan(o,0);scene.add(o.group);live.push(o);
  }
  function updateHammerSwing(o,phase) {
    const feedback=o.feedback,fade=Math.pow(1-phase,1.35),grow=.72+.38*Math.min(1,phase*2.2);
    o.group.scale.setScalar(o.power*grow);
    o.outer.material.opacity=.48*fade;
    o.core.material.opacity=.82*Math.pow(Math.max(0,1-phase),1.8);
    o.group.rotation.y=o.angle+o.spin*phase;
  }
  function hammerSwing(pos,angle,combo=0,power=1) {
    if(destroyed||!pos||![pos.x,pos.y,pos.z,angle,power].every(Number.isFinite)||power<=0)return;
    const style=((Math.trunc(combo)%5)+5)%5,feedback=getHammerFeedback(style),key=`great-hammer:swing:${style}`;
    let o=spare.get(key)?.pop();
    if(!o) {
      const group=new THREE.Group(),outer=new THREE.Mesh(hammerSwingGeometry(key,feedback),material(0x5c78ae,.38)),core=new THREE.Mesh(hammerSwingGeometry(key,feedback,true),material(0xffdda4,.82));
      outer.name='hammer-release-outer-arc';core.name='hammer-release-white-core';group.add(outer,core);group.children.forEach(mesh=>mesh.frustumCulled=false);
      o={key,group,outer,core,hammerSwing:true,feedback,angle:0,spin:0,power:1,age:0,life:feedback.swingLife,awaitingPresentation:false};all.add(o);
    }
    const swings=live.map((entry,index)=>entry.hammerSwing?index:-1).filter(index=>index>=0);
    if(swings.length>=MAX_HAMMER_SWINGS)release(live.splice(swings[0],1)[0]);
    if(live.length>=MAX_LIVE)release(live.shift());
    o.feedback=feedback;o.angle=angle;o.spin=style%2?-0.18:.14;o.power=power;o.age=0;o.unseenAge=0;o.awaitingPresentation=true;o.life=feedback.swingLife;
    o.outer.material.color.setHex(style>=3?0x9b7ed1:0x6f8fbd);
    o.core.material.color.setHex(style>=3?0xfff5df:0xffdda4);
    o.group.visible=true;o.group.position.set(pos.x,pos.y+.92+feedback.swingRadius*.24,pos.z);o.group.rotation.set(0,angle,0);updateHammerSwing(o,0);scene.add(o.group);live.push(o);
  }
  function updateHammerImpact(o,phase) {
    const fade=(1-phase)*(1-phase),dummy=o.dummy,feedback=o.feedback;
    for(let i=0;i<o.dust.count;i++){
      const angle=i/o.dust.count*Math.PI*2;
      const spread=.045+o.age*(.85+i%3*.18)*feedback.dustSpread;
      // The whole cluster faces the measured head velocity. Rising blows
      // drive a narrow plume; the waist swing spreads a wider blunt fan.
      dummy.position.set(Math.sin(angle)*spread,Math.cos(angle)*spread*.65,
        .025+o.age*feedback.dustDrive*(.8+i%2*.25));
      dummy.rotation.set(i*.8,o.age*3,i*.4);
      const size=(.050+i%3*.018)*(1+phase*.60)*Math.max(.08,1-phase);
      dummy.scale.set(size,size*.62,size*(o.style===1?1.8:1.3));dummy.updateMatrix();o.dust.setMatrixAt(i,dummy.matrix);
    }
    o.dust.instanceMatrix.needsUpdate=true;o.dust.material.opacity=.70*fade;
    const coreFade=Math.max(0,1-o.age/feedback.flashLife);
    o.core.material.opacity=.94*coreFade*coreFade;
    o.core.scale.fromArray(feedback.coreScale).multiplyScalar(1+phase*.16);
    if(o.star){o.star.material.opacity=.92*fade;o.star.scale.setScalar(1+phase*(o.hammerFinisher?1.35:.85));}
    if(o.ripple){o.ripple.material.opacity=.52*fade;o.ripple.scale.setScalar(.35+phase*(o.hammerFinisher?1.65:1.15));}
  }
  function emitHammerImpact(pos,combo,power,headDirection) {
    const style=((Math.trunc(combo)%5)+5)%5,key=`great-hammer:impact:${style}`;
    let o=spare.get(key)?.pop();
    if(!o){
      const group=new THREE.Group(),core=new THREE.Mesh(hammerCoreGeometry(),material(0xffedc6,.94));
      core.name='hammer-blunt-core';core.renderOrder=3;
      const dust=new THREE.InstancedMesh(debrisGeometry(),material(0xbfa285,.48),style>=3?8:6);
      dust.name='hammer-short-impact-dust';dust.instanceMatrix.setUsage(THREE.DynamicDrawUsage);dust.frustumCulled=false;
      const finisher=style>=3,star=new THREE.Mesh(hammerBurstGeometry(key,finisher),material(finisher?0x9edcff:0xfff1d0,.92));
      star.name='hammer-directional-star';star.renderOrder=4;
      const ripple=new THREE.Mesh(hammerRippleGeometry(key),material(finisher?0x76b6d5:0xd1a76d,.52));
      ripple.name='hammer-impact-ripple';ripple.rotation.x=Math.PI/2;ripple.renderOrder=2;
      group.add(core,dust,star,ripple);group.children.forEach(mesh=>mesh.frustumCulled=false);
      o={key,group,core,dust,star,ripple,dummy:new THREE.Object3D(),hammerImpact:true,hammerFinisher:finisher};all.add(o);
    }
    const hammerIndices=live.map((entry,index)=>entry.hammerImpact?index:-1).filter(index=>index>=0);
    if(hammerIndices.length>=24)release(live.splice(hammerIndices[0],1)[0]);
    if(live.length>=MAX_LIVE)release(live.shift());
    o.feedback=getHammerFeedback(style);o.style=style;
    o.age=0;o.unseenAge=0;o.awaitingPresentation=true;o.life=o.feedback.impactLife;
    o.group.visible=true;o.group.position.copy(pos);o.group.quaternion.setFromUnitVectors(forward,headDirection);o.group.scale.setScalar(power);
    updateHammerImpact(o,0);scene.add(o.group);live.push(o);
  }
  function emit(id,pos,angle,combo,mode='attack',power=1,cutDirection=null) {
    if(destroyed)return;
    if(id==='great-hammer'){
      // Contact effects require a struck enemy or a confirmed world contact.
      // The real moving head is presented by the character, not a blade arc.
      if(mode==='impact')emitHammerImpact(pos,combo,power,cutDirection);
      return;
    }
    const style=((Math.trunc(combo)%5)+5)%5;
    const weapon=getWeapon(id), move=weapon.moves[style], key=`${id}:${mode}:${style}`;
    const greatImpact=id==='great-dao'&&mode==='impact',greatFinisher=greatImpact&&style>=3;
    const greatSwing=id==='great-dao'&&mode==='attack';
    const authored=cuts[id]||cuts['tang-dao'];
    const reach=move.reach,shapeKind=move.shape;
    const paths=authored.map((path,layer)=>{
      if(shapeKind==='thrust'){const offset=weapon.grip==='dual'?(layer%2?-1:1)*Math.min(0.2,move.width*0.4):0;return path.map((v,i)=>[offset+v[0]*0.045,v[1]*0.1,0.25+(i/(path.length-1))*reach]);}
      if(shapeKind==='crush')return Array.from({length:15},(_,i)=>{const t=i/14;return [(layer-(authored.length-1)/2)*0.16+Math.sin(t*Math.PI)*0.07,1-t*1.95,0.35+reach*t*0.85];});
      if(shapeKind==='radial')return arc(reach*(0.75-layer*0.09),-Math.PI,Math.PI,layer*0.055,0,0,30);
      const radius=Math.max(...path.map(v=>Math.hypot(v[0],v[2])));return path.map(v=>[v[0]*reach/radius,v[1],v[2]*reach/radius]);
    });
    let o=spare.get(key)?.pop();
    if(!o) {
      const group=new THREE.Group();let shape=paths;
      if(mode==='impact') {
        if(greatImpact)shape=greatContactPaths(greatFinisher);
        else if(shapeKind==='crush'||shapeKind==='radial') {
          const facets=5+authored.length;
          shape=Array.from({length:facets},(_,i)=>{const a=i/facets*Math.PI*2,reach=greatFinisher?0.22+(i%2)*0.12:0.48+(i%2)*0.25;return line([Math.sin(a)*0.1,0,Math.cos(a)*0.1],[Math.sin(a)*reach,0.05,Math.cos(a)*reach]);});
        } else if(shapeKind==='thrust')shape=[line([0,0,-0.45],[0,0,0.5]),line([-0.14,0,-0.14],[0.14,0,0.14]),line([-0.3,0,0],[0.3,0,0])];
        else shape=paths.map(p=>p.map(v=>[v[0]*0.24,v[1]*0.3,(v[2]-1.1)*0.25]));
      }
      const width=mode==='impact'?(greatImpact?(greatFinisher?.09:.065):.045):shapeKind==='thrust'?0.018:0.052;
      group.add(new THREE.Mesh(geometry(`${key}:veil`,shape,width),material(0xffffff,0.3)),new THREE.Mesh(geometry(`${key}:edge`,shape,width*0.18),material(0xffffff,0.65)));
      o={key,group,age:0,life:0,angle:0,spin:0,scale:1,mode,greatImpact,greatFinisher};all.add(o);
      if(greatImpact) {
        o.flash=new THREE.Mesh(contactCoreGeometry(),material(0xfff8df,.84));o.flash.renderOrder=3;group.add(o.flash);
        // Three ordinary cuts throw four chips; the heavy chop throws six.
        // Each cluster uses one extra draw and reuses its instance matrices.
        const mesh=new THREE.InstancedMesh(debrisGeometry(),material(0xba814e,0.92),greatFinisher?6:4);
        mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);mesh.frustumCulled=false;
        group.add(mesh);o.debris={mesh,dummy:new THREE.Object3D()};
        group.children.forEach(mesh=>{mesh.frustumCulled=false;});
      }
    }
    if(greatImpact) {
      let count=0,oldest=-1;
      for(let i=0;i<live.length;i++)if(live[i].greatImpact){count++;if(oldest<0)oldest=i;}
      if(count>=MAX_GREAT_IMPACTS)release(live.splice(oldest,1)[0]);
    }
    if(live.length>=MAX_LIVE)release(live.shift());
    o.age=0;o.unseenAge=0;o.awaitingPresentation=greatImpact;o.group.visible=true;o.life=greatFinisher?.25:greatImpact?.19:mode==='impact'?.14:.16;o.angle=angle;o.spin=(combo%2?-1:1)*(shapeKind==='thrust'||shapeKind==='crush'?0:mode==='impact'?0.12:0.32);o.scale=power;
    o.group.position.copy(pos);o.group.position.y+=greatImpact?0:mode==='impact'?.22:1.02;if(mode==='impact'&&shapeKind==='crush'&&id!=='great-dao')o.group.position.y=0.07;
    o.group.rotation.set(0,angle,mode==='impact'||shapeKind==='thrust'||shapeKind==='crush'?0:[0.12,-0.12,0.35,-0.3,0.18][style]);
    if(greatImpact)o.group.quaternion.setFromUnitVectors(forward,cutDirection);
    o.mirror=greatImpact?1:style%2?-1:1;o.group.scale.set(power*o.mirror,power,power);
    o.group.children[0].material.color.setHex(greatFinisher?0x5caecb:(greatSwing||greatImpact)?0x7898d0:(weapon?.effectColor??0xc9ae7b));o.group.children[1].material.color.setHex(greatFinisher?0x9fe9ff:(greatSwing||greatImpact)?0xe8f2ff:(weapon?.effectAccent??0xffe4ac));
    o.group.children[0].material.opacity=greatImpact?.56:mode==='impact'?.46:.24;o.group.children[1].material.opacity=greatImpact?.80:.6;
    if(o.flash){o.flash.material.opacity=.84;o.flash.scale.setScalar(greatFinisher?1.45:1);}
    if(o.debris)updateDebris(o,0);
    scene.add(o.group);live.push(o);
  }
  function attack(id,pos,angle,combo=0) {emit(id,pos,angle,combo);}
  function impact(id,pos,angle,combo=0,critical=false,cutDirection=null) {
    if(destroyed)return;
    direction.set(Math.sin(angle),0,Math.cos(angle));
    if(id==='great-dao'||id==='great-hammer') {
      const style=((Math.trunc(combo)%5)+5)%5;
      if(cutDirection?.isVector3&&Number.isFinite(cutDirection.lengthSq())&&cutDirection.lengthSq()>.0001)direction.copy(cutDirection).normalize();
      else {
        direction.fromArray(id==='great-hammer'?getHammerFeedback(style).direction:greatCutDirections[style]).normalize();
        direction.applyAxisAngle(up,angle);
      }
    }
    lastImpact={sequence:++impactSequence,id,combo:((Math.trunc(combo)%5)+5)%5,critical,position:pos.toArray(),cutDirection:direction.toArray()};
    emit(id,pos,angle,combo,'impact',critical?(id==='great-dao'?1.25:1.35):1,direction);
    if(id==='great-hammer'){
      baseEffects?.hammerImpact?.(pos,direction,combo>=3?1.4:1,critical,combo);
      return;
    }
    // Keep the authored combo index with the physical hit so the base effect
    // can reserve the wide crescent and ground flare for the final great-dao
    // chop.  Older callers accept the original four arguments, therefore the
    // optional fifth value remains backwards compatible.
    baseEffects?.impact(pos,direction,id==='great-dao'?(combo>=3?1.55:1.08):.75,critical,combo);
  }
  function updateDebris(o,p) {
    const {mesh,dummy}=o.debris;
    for(let i=0;i<mesh.count;i++) {
      const angle=-.95+i/(mesh.count-1)*1.9,travel=.035+(1.45+i%3*.25)*(o.greatFinisher?1.2:1)*o.age;
      dummy.position.set(Math.sin(angle)*travel,.025+(.45+i%2*.35)*o.age-4.5*o.age*o.age,Math.cos(angle)*travel);
      dummy.rotation.set(i*.7+o.age*9,i+o.age*7,i*.9);
      const size=(.025+i%3*.009)*(1-p*.65);dummy.scale.set(size,size*.65,size*1.3);dummy.updateMatrix();mesh.setMatrixAt(i,dummy.matrix);
    }
    mesh.instanceMatrix.needsUpdate=true;mesh.material.opacity=.92*(1-p)*(1-p);
  }
  function update(dt) {
    if(!(dt>0))return;
    for(let i=live.length-1;i>=0;i--){const o=live[i];
      if(o.awaitingPresentation){o.unseenAge+=dt;if(o.unseenAge>=FIRST_PRESENTATION_TIMEOUT){release(o);live.splice(i,1);}continue;}
      o.age+=dt;const p=Math.min(1,o.age/o.life),fade=(1-p)*(1-p);
      if(o.hammerFan){updateHammerFan(o,p);if(p>=1){release(o);live.splice(i,1);}continue;}
      if(o.hammerSwing){updateHammerSwing(o,p);if(p>=1){release(o);live.splice(i,1);}continue;}
      if(o.hammerImpact){updateHammerImpact(o,p);if(p>=1){release(o);live.splice(i,1);}continue;}
      if(!o.greatImpact)o.group.rotation.y=o.angle+o.spin*p;const size=o.scale*(1+(o.greatImpact?.35:o.mode==='impact'?.55:.06)*p);o.group.scale.set(size*o.mirror,size,size);
      o.group.children[0].material.opacity=(o.greatImpact?.56:o.mode==='impact'?.46:.24)*fade;o.group.children[1].material.opacity=(o.greatImpact?.80:.6)*fade;
      if(o.flash){const flashFade=Math.max(0,1-o.age/(o.greatFinisher?.078:.058));o.flash.material.opacity=.84*flashFade*flashFade;}
      if(o.debris)updateDebris(o,p);
      if(p>=1){release(o);live.splice(i,1);}
    }
  }
  function presented() {
    // The caller invokes this once after a real draw, after every simulation
    // substep. An unpresented impact keeps its bright contact and times out.
    for(const o of live)if(o.awaitingPresentation&&o.group.visible){o.awaitingPresentation=false;o.age=0;o.unseenAge=0;}
  }
  function getState() {
    let pooled=0;for(const pool of spare.values())pooled+=pool.length;
    return {active:live.length,activeGreatImpacts:live.filter(o=>o.greatImpact).length,activeHammerImpacts:live.filter(o=>o.hammerImpact).length,activeHammerFans:live.filter(o=>o.hammerFan).length,activeHammerSwings:live.filter(o=>o.hammerSwing).length,awaitingPresentation:live.filter(o=>o.awaitingPresentation).length,pooled,destroyed,
      lastImpact:lastImpact?{...lastImpact,position:[...lastImpact.position],cutDirection:[...lastImpact.cutDirection]}:null};
  }
  function clear(){while(live.length)release(live.pop());lastImpact=null;}
  function destroy(){if(destroyed)return;clear();destroyed=true;for(const o of all)disposeInstance(o);for(const g of geometries.values())g.dispose();all.clear();spare.clear();geometries.clear();}
  return {attack,impact,hammerFan,hammerSwing,presented,getState,update,clear,destroy};
}
