import * as THREE from 'three';
import { getWeapon } from './weapons.js';

// Local coordinates follow the combat convention: +Z forward, +X right.
// Each silhouette is authored once, shared by all pooled instances.
export function createWeaponEffects(scene, baseEffects) {
  const geometries = new Map(), spare = new Map(), all = new Set(), live = [];
  const direction = new THREE.Vector3(), forward = new THREE.Vector3(0,0,1), up = new THREE.Vector3(0,1,0);
  const greatCutDirections=[[-.98,-.06,.18],[.78,-.62,.18],[-.96,.10,.22],[.06,-.92,.38]];
  let destroyed = false, lastImpact = null, impactSequence = 0;
  const MAX_LIVE = 72, MAX_GREAT_IMPACTS = 24, FIRST_PRESENTATION_TIMEOUT = .5;
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
  function emit(id,pos,angle,combo,mode='attack',power=1,cutDirection=null) {
    if(destroyed)return;
    const style=((combo%4)+4)%4;
    const weapon=getWeapon(id), move=weapon.moves[style], key=`${id}:${mode}:${style}`;
    const greatImpact=id==='great-dao'&&mode==='impact',greatFinisher=greatImpact&&style===3;
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
    o.group.rotation.set(0,angle,mode==='impact'||shapeKind==='thrust'||shapeKind==='crush'?0:[0.12,-0.12,0.35,-0.3][combo%4]);
    if(greatImpact)o.group.quaternion.setFromUnitVectors(forward,cutDirection);
    o.mirror=greatImpact?1:combo%2?-1:1;o.group.scale.set(power*o.mirror,power,power);
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
    if(id==='great-dao') {
      const style=((combo%4)+4)%4;
      if(cutDirection?.isVector3&&Number.isFinite(cutDirection.lengthSq())&&cutDirection.lengthSq()>.0001)direction.copy(cutDirection).normalize();
      else {
        direction.fromArray(greatCutDirections[style]).normalize();
        direction.applyAxisAngle(up,angle);
      }
    }
    lastImpact={sequence:++impactSequence,id,combo:((combo%4)+4)%4,critical,position:pos.toArray(),cutDirection:direction.toArray()};
    emit(id,pos,angle,combo,'impact',critical?(id==='great-dao'?1.25:1.35):1,direction);
    // Keep the authored combo index with the physical hit so the base effect
    // can reserve the wide crescent and ground flare for the final great-dao
    // chop.  Older callers accept the original four arguments, therefore the
    // optional fifth value remains backwards compatible.
    baseEffects?.impact(pos,direction,id==='great-dao'?(combo===3?1.55:1.08):.75,critical,combo);
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
    return {active:live.length,activeGreatImpacts:live.filter(o=>o.greatImpact).length,awaitingPresentation:live.filter(o=>o.awaitingPresentation).length,pooled,destroyed,
      lastImpact:lastImpact?{...lastImpact,position:[...lastImpact.position],cutDirection:[...lastImpact.cutDirection]}:null};
  }
  function clear(){while(live.length)release(live.pop());lastImpact=null;}
  function destroy(){if(destroyed)return;clear();destroyed=true;for(const o of all)disposeInstance(o);for(const g of geometries.values())g.dispose();all.clear();spare.clear();geometries.clear();}
  return {attack,impact,presented,getState,update,clear,destroy};
}
