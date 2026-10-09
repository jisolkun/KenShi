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
  const wave = (length, width, turns, y=0) => Array.from({length:23},(_,i)=>[Math.sin(i/22*Math.PI*turns)*width,y,i/22*length]);
  const cuts = {
    'dual-dao': [arc(1.6,-1.2,0.75,0.13,-0.3),arc(1.55,-0.6,1.35,-0.13,0.3)],
    'tang-dao': [line([-1.45,0.45,1.65],[1.45,-0.3,1.65])],
    'yanling-dao': [arc(1.65,-1,0.9),arc(1.53,-0.7,0.9,-0.06)],
    'miao-dao': [line([-0.3,1.05,0.8],[0.25,-0.65,2.25]),arc(2.05,-0.8,0.7,-0.45)],
    'ring-dao': [arc(1.65,-1.2,1.15),arc(0.13,0,Math.PI*2,0,0.85,1.37,10)],
    'pu-dao': [arc(2.25,-1.3,1.1,-0.12),line([-1.7,-0.3,0.9],[1.9,0.05,1.1])],
    'longquan-jian': [line([0,0,0.4],[0,0,2.15]),line([-0.2,0.05,1.55],[0.2,0.05,1.95])],
    'dual-jian': [line([-0.65,0.2,0.6],[0.55,-0.15,2]),line([0.65,-0.15,0.6],[-0.55,0.2,2])],
    guandao: [arc(2.35,-1.45,1.4),arc(2.05,-1.35,1.15,-0.17),arc(1.75,-1.15,0.85,-0.3)],
    qiang: [line([0,0,0.3],[0,0,2.8]),arc(0.18,0,Math.PI*2,0,0,2.45,12)],
    shemao: [wave(2.65,0.16,5),wave(2.65,0.08,5,0.08)],
    'fangtian-ji': [line([0,0,0.4],[0,0,2.55]),arc(0.48,-1.5,1.6,0,0.25,1.9)],
    'dual-ji': [arc(0.65,-2,1.5,0.12,-0.65,1.1),arc(0.65,-1.5,2,-0.12,0.65,1.1)],
    staff: [line([-1.7,0.15,1.2],[1.7,-0.15,1.2]),line([-1.4,-0.12,0.7],[1.4,0.12,0.7])],
    'three-section-staff': [line([-1.5,0.2,0.9],[-0.45,0.05,1.65]),line([-0.45,0.05,1.65],[0.75,-0.1,1.8]),line([0.75,-0.1,1.8],[1.6,-0.22,1.05])],
    'nine-section-whip': [wave(2.4,0.42,3),arc(0.55,-1.5,1.4,0,0,1.75)],
    'iron-whip': [line([-0.8,0.6,0.8],[0.55,-0.4,1.9]),line([-0.7,0.55,0.7],[0.65,-0.35,1.8])],
    'dual-jian-maces': [line([-0.75,0.65,0.8],[-0.35,-0.4,1.65]),line([0.75,0.65,0.8],[0.35,-0.4,1.65])],
    'wolf-club': [line([0,1.1,0.7],[0,-0.55,1.85]),line([-0.28,0.85,0.9],[-0.28,-0.4,1.75]),line([0.28,0.85,0.9],[0.28,-0.4,1.75])],
    'dual-axes': [arc(1.5,-1.45,0.5,0.3,-0.25),arc(1.5,-0.5,1.45,-0.25,0.25)],
    'war-hammer': [line([0,1.2,0.75],[0,-0.6,1.7]),line([-0.45,0.8,0.9],[-0.45,-0.5,1.7]),line([0.45,0.8,0.9],[0.45,-0.5,1.7])],
    'hook-swords': [arc(0.7,-2.3,1.2,0,-0.6,1.25),arc(0.7,-1.2,2.3,0,0.6,1.25)],
    'emei-piercers': [line([-0.23,0.12,0.6],[-0.23,0.12,1.55]),line([0.23,-0.12,0.6],[0.23,-0.12,1.55])],
    'mandarin-yue': [arc(0.66,-2,2,0.1,-0.5,0.8),arc(0.66,-2,2,-0.1,0.5,0.8)],
    'meteor-hammer': [arc(2.1,-1.8,1.6),arc(0.24,0,Math.PI*2,0,1.92,0.75,10)],
    'judge-brush': [wave(1.7,0.25,2),line([-0.22,0.05,1.2],[0.22,-0.1,1.75])],
    'battle-yue': [arc(2,-1.4,1.3,0.1),arc(1.7,-1.4,1.3,-0.16),line([-1.5,0.2,1.3],[1.5,-0.2,1.3])],
  };
  const heavy = new Set(['guandao','pu-dao','wolf-club','war-hammer','battle-yue','dual-jian-maces']);
  const chains = new Set(['nine-section-whip','three-section-staff','meteor-hammer']);
  const thrust = new Set(['qiang','shemao','longquan-jian','emei-piercers','judge-brush']);
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
  function emit(id,pos,angle,combo,mode='attack',power=1,kind=null) {
    if(destroyed)return;
    const contactKind=id==='yanling-dao' && mode==='impact' && ['thrust','cut','chop'].includes(kind)?kind:null;
    const weapon=getWeapon(id), move=weapon.moves[((combo%4)+4)%4], key=`${id}:${mode}:${((combo%4)+4)%4}${contactKind?`:${contactKind}`:''}`;
    const authored=cuts[id]||cuts['tang-dao'];
    const reach=move.reach,shapeKind=contactKind==='chop'?'crush':contactKind==='cut'?'arc':contactKind||move.shape;
    const paths=authored.map((path,layer)=>{
      if(shapeKind==='thrust'){const offset=weapon.grip==='dual'?(layer%2?-1:1)*Math.min(0.2,move.width*0.4):0;return path.map((v,i)=>[offset+v[0]*0.045,v[1]*0.1,0.25+(i/(path.length-1))*reach]);}
      if(shapeKind==='crush')return Array.from({length:15},(_,i)=>{const t=i/14;return [(layer-(authored.length-1)/2)*0.16+Math.sin(t*Math.PI)*0.07,1-t*1.95,0.35+reach*t*0.85];});
      if(shapeKind==='radial')return arc(reach*(0.75-layer*0.09),-Math.PI,Math.PI,layer*0.055,0,0,30);
      if(shapeKind==='hook')return arc(reach*(0.7-layer*0.065),-move.halfAngle*1.25,move.halfAngle*1.25,layer*0.08,(layer%2?-1:1)*0.16,0.1);
      if(shapeKind==='chain')return path.map(v=>[v[0]*reach/2.5,v[1],v[2]*reach/2.5]);
      // Preserve authored cutting planes; straight spear wakes become staff sweeps.
      if(weapon.moves[0].shape==='thrust'||id==='wolf-club'||id==='war-hammer'||id==='emei-piercers')return arc(reach*(0.83-layer*0.07),-move.halfAngle,move.halfAngle,layer*0.06);
      const radius=Math.max(...path.map(v=>Math.hypot(v[0],v[2])));return path.map(v=>[v[0]*reach/radius,v[1],v[2]*reach/radius]);
    });
    let o=spare.get(key)?.pop();
    if(!o) {
      const group=new THREE.Group();let shape=paths;
      if(mode==='impact') {
        if(contactKind) {
          // Contact fragments only: the actual blade supplies the cutting trail.
          shape=contactKind==='thrust'?[line([0,0,-0.24],[0,0,0.34]),line([-0.035,0.025,-0.05],[-0.025,0.025,0.13]),line([0.035,-0.025,0.02],[0.025,-0.025,0.19])]
            :contactKind==='chop'?[line([-0.22,0.27,-0.025],[0.14,-0.17,0.025]),line([0.13,-0.04,0.015],[0.2,-0.15,0.03]),line([-0.15,0.17,-0.015],[-0.22,0.24,-0.03])]
            :[line([-0.33,0.04,-0.025],[0.29,-0.035,0.025]),line([0.11,0.07,0.025],[0.23,0.095,0.045]),line([-0.13,-0.07,-0.025],[-0.24,-0.09,-0.045])];
        } else if(shapeKind==='crush'||shapeKind==='radial'||heavy.has(id)){const facets={guandao:5,'pu-dao':4,'wolf-club':9,'war-hammer':8,'battle-yue':6,'dual-jian-maces':7}[id]||5+authored.length;shape=Array.from({length:facets},(_,i)=>{const a=i/facets*Math.PI*2,reach=id==='wolf-club'?0.35+(i%3)*0.16:id==='war-hammer'?0.68:0.48+(i%2)*0.25;return line([Math.sin(a)*0.1,0,Math.cos(a)*0.1],[Math.sin(a)*reach,id==='dual-jian-maces'?(i%2)*0.25:0.05,Math.cos(a)*reach]);});if(id==='war-hammer')shape.push(arc(0.48,0,Math.PI*2,0,0,0,8));}
        else if(chains.has(id))shape=[arc(0.35,-2.7,2.7),arc(0.55,-1.4,1.4)];
        else if(shapeKind==='thrust'){shape=[line([0,0,-0.45],[0,0,0.5]),line([-0.14,0,-0.14],[0.14,0,0.14])];if(id==='qiang')shape.push(arc(0.24,0,Math.PI*2,0,0,0,12));else if(id==='shemao')shape.push(wave(0.65,0.14,4));else if(id==='emei-piercers')shape.push(line([-0.23,0,-0.2],[-0.23,0,0.3]),line([0.23,0,-0.2],[0.23,0,0.3]));else if(id==='judge-brush')shape.push(arc(0.28,-2.5,1.1));else shape.push(line([-0.3,0,0],[0.3,0,0]));}
        else shape=paths.map(p=>p.map(v=>[v[0]*0.24,v[1]*0.3,(v[2]-1.1)*0.25]));
      }
      const width=contactKind?(contactKind==='thrust'?0.012:0.018):mode==='impact'?0.045:shapeKind==='thrust'?0.018:heavy.has(id)?0.095:0.052;
      group.add(new THREE.Mesh(geometry(`${key}:veil`,shape,width),material(0xffffff,0.3)),new THREE.Mesh(geometry(`${key}:edge`,shape,width*0.18),material(0xffffff,0.65)));
      if(chains.has(id)||id==='ring-dao') {
        const chain=shape[0];const gems=new THREE.Group();
        const gkey='chain-bead';if(!geometries.has(gkey))geometries.set(gkey,new THREE.OctahedronGeometry(0.035,0));
        for(let i=0;i<9;i++){const p=chain[Math.round(i/8*(chain.length-1))];const bead=new THREE.Mesh(geometries.get(gkey),material(0xffffff,0.6));bead.position.set(...p);gems.add(bead);}group.add(gems);
      }
      o={key,group,age:0,life:0,angle:0,spin:0,scale:1,mode};all.add(o);
    }
    if(live.length>=MAX_LIVE)release(live.shift());
    o.age=0;o.life=contactKind?(contactKind==='thrust'?0.085:contactKind==='chop'?0.13:0.105):mode==='impact'?0.14:heavy.has(id)?0.22:0.16;o.angle=angle;o.spin=(combo%2?-1:1)*(shapeKind==='thrust'||shapeKind==='crush'?0:mode==='impact'?0.12:0.32);o.scale=power;
    o.group.position.copy(pos);o.group.position.y+=mode==='impact'?0.22:1.02;if(mode==='impact'&&shapeKind==='crush'&&!contactKind)o.group.position.y=0.07;
    o.group.rotation.set(0,angle,mode==='impact'||shapeKind==='thrust'||shapeKind==='crush'?0:[0.12,-0.12,0.35,-0.3][combo%4]);o.group.scale.set(power*(combo%2?-1:1),power,power);o.mirror=combo%2?-1:1;
    o.group.children[0].material.color.setHex(weapon?.effectColor??0xc9ae7b);o.group.children[1].material.color.setHex(weapon?.effectAccent??0xffe4ac);
    o.group.children[0].material.opacity=mode==='impact'?0.46:0.24;o.group.children[1].material.opacity=0.6;
    if(o.group.children[2])for(const bead of o.group.children[2].children){bead.material.color.setHex(weapon?.effectAccent??0xffe4ac);bead.material.opacity=0.6;}
    scene.add(o.group);live.push(o);
  }
  function attack(id,pos,angle,combo=0) {emit(id,pos,angle,combo);}
  function impact(id,pos,angle,combo=0,critical=false,kind=null) {
    emit(id,pos,angle,combo,'impact',critical?1.35:1,kind);
    direction.set(Math.sin(angle),0,Math.cos(angle));
    baseEffects?.impact(pos,direction,heavy.has(id)?1.4:0.75,critical);
  }
  function skill(id,pos,angle,index=0,isImpact=false) {
    if(isImpact){impact(id,pos,angle,index,true);if(heavy.has(id))baseEffects?.ring(pos,1.4,getWeapon(id)?.effectColor,0.24);}
    else {emit(id,pos,angle,index,'attack',1.2+index*0.1);if(index%2===1)emit(id,pos,angle+Math.PI*0.65,index+1,'attack',1.05);}
  }
  function update(dt) {
    if(!(dt>0))return;
    for(let i=live.length-1;i>=0;i--){const o=live[i];o.age+=dt;const p=Math.min(1,o.age/o.life),fade=(1-p)*(1-p);
      o.group.rotation.y=o.angle+o.spin*p;const size=o.scale*(1+(o.mode==='impact'?0.55:0.06)*p);o.group.scale.set(size*o.mirror,size,size);
      o.group.children[0].material.opacity=(o.mode==='impact'?0.46:0.24)*fade;o.group.children[1].material.opacity=0.6*fade;
      if(o.group.children[2])for(const bead of o.group.children[2].children)bead.material.opacity=0.6*fade;
      if(p>=1){release(o);live.splice(i,1);}
    }
  }
  function clear(){while(live.length)release(live.pop());}
  function destroy(){if(destroyed)return;clear();destroyed=true;for(const o of all)o.group.traverse(n=>{if(n.isMesh)n.material.dispose();});for(const g of geometries.values())g.dispose();all.clear();spare.clear();geometries.clear();}
  return {attack,impact,skill,update,clear,destroy};
}
