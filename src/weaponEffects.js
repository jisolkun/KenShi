import * as THREE from 'three';
import { getWeapon } from './weapons.js';

// Local coordinates follow the combat convention: +Z forward, +X right.
// Each silhouette is authored once, shared by all pooled instances.
export function createWeaponEffects(scene, baseEffects) {
  const geometries = new Map(), spare = new Map(), all = new Set(), live = [];
  const direction = new THREE.Vector3();
  let destroyed = false;
  const MAX_LIVE = 72;
  const arc = (radius, start, end, y = 0, x = 0, z = 0, count = 18) => Array.from({length:count+1}, (_, i) => {
    const a = start + (end-start)*i/count; return [x+Math.sin(a)*radius,y, z+Math.cos(a)*radius];
  });
  const line = (a,b) => [a,b];
  const cuts = {
    'dual-dao': [arc(1.6,-1.2,0.75,0.13,-0.3),arc(1.55,-0.6,1.35,-0.13,0.3)],
    'tang-dao': [line([-1.45,0.45,1.65],[1.45,-0.3,1.65])],
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
  function material(color,opacity) {return new THREE.MeshBasicMaterial({color,opacity,transparent:true,depthWrite:false,side:THREE.DoubleSide,toneMapped:false});}
  function release(o) {scene.remove(o.group);if(!spare.has(o.key))spare.set(o.key,[]);const pool=spare.get(o.key);if(pool.length<4)pool.push(o);else{o.group.traverse(n=>{if(n.isMesh)n.material.dispose();});all.delete(o);}}
  function emit(id,pos,angle,combo,mode='attack',power=1) {
    if(destroyed)return;
    const weapon=getWeapon(id), move=weapon.moves[((combo%4)+4)%4], key=`${id}:${mode}:${((combo%4)+4)%4}`;
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
        if(shapeKind==='crush'||shapeKind==='radial') {
          const facets=5+authored.length;
          shape=Array.from({length:facets},(_,i)=>{const a=i/facets*Math.PI*2,reach=0.48+(i%2)*0.25;return line([Math.sin(a)*0.1,0,Math.cos(a)*0.1],[Math.sin(a)*reach,0.05,Math.cos(a)*reach]);});
        } else if(shapeKind==='thrust')shape=[line([0,0,-0.45],[0,0,0.5]),line([-0.14,0,-0.14],[0.14,0,0.14]),line([-0.3,0,0],[0.3,0,0])];
        else shape=paths.map(p=>p.map(v=>[v[0]*0.24,v[1]*0.3,(v[2]-1.1)*0.25]));
      }
      const width=mode==='impact'?0.045:shapeKind==='thrust'?0.018:0.052;
      group.add(new THREE.Mesh(geometry(`${key}:veil`,shape,width),material(0xffffff,0.3)),new THREE.Mesh(geometry(`${key}:edge`,shape,width*0.18),material(0xffffff,0.65)));
      o={key,group,age:0,life:0,angle:0,spin:0,scale:1,mode};all.add(o);
    }
    if(live.length>=MAX_LIVE)release(live.shift());
    o.age=0;o.life=mode==='impact'?0.14:0.16;o.angle=angle;o.spin=(combo%2?-1:1)*(shapeKind==='thrust'||shapeKind==='crush'?0:mode==='impact'?0.12:0.32);o.scale=power;
    o.group.position.copy(pos);o.group.position.y+=mode==='impact'?0.22:1.02;if(mode==='impact'&&shapeKind==='crush')o.group.position.y=0.07;
    o.group.rotation.set(0,angle,mode==='impact'||shapeKind==='thrust'||shapeKind==='crush'?0:[0.12,-0.12,0.35,-0.3][combo%4]);o.group.scale.set(power*(combo%2?-1:1),power,power);o.mirror=combo%2?-1:1;
    o.group.children[0].material.color.setHex(weapon?.effectColor??0xc9ae7b);o.group.children[1].material.color.setHex(weapon?.effectAccent??0xffe4ac);
    o.group.children[0].material.opacity=mode==='impact'?0.46:0.24;o.group.children[1].material.opacity=0.6;
    scene.add(o.group);live.push(o);
  }
  function attack(id,pos,angle,combo=0) {emit(id,pos,angle,combo);}
  function impact(id,pos,angle,combo=0,critical=false) {
    emit(id,pos,angle,combo,'impact',critical?1.35:1);
    direction.set(Math.sin(angle),0,Math.cos(angle));
    baseEffects?.impact(pos,direction,.75,critical);
  }
  function update(dt) {
    if(!(dt>0))return;
    for(let i=live.length-1;i>=0;i--){const o=live[i];o.age+=dt;const p=Math.min(1,o.age/o.life),fade=(1-p)*(1-p);
      o.group.rotation.y=o.angle+o.spin*p;const size=o.scale*(1+(o.mode==='impact'?0.55:0.06)*p);o.group.scale.set(size*o.mirror,size,size);
      o.group.children[0].material.opacity=(o.mode==='impact'?0.46:0.24)*fade;o.group.children[1].material.opacity=0.6*fade;
      if(p>=1){release(o);live.splice(i,1);}
    }
  }
  function clear(){while(live.length)release(live.pop());}
  function destroy(){if(destroyed)return;clear();destroyed=true;for(const o of all)o.group.traverse(n=>{if(n.isMesh)n.material.dispose();});for(const g of geometries.values())g.dispose();all.clear();spare.clear();geometries.clear();}
  return {attack,impact,update,clear,destroy};
}
