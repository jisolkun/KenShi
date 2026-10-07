import * as THREE from 'three';

const smooth = t => t * t * (3 - 2 * t);
const clamp = t => Math.max(0, Math.min(1, t));
const mix = (a, b, t) => a + (b - a) * t;
const pose = (body, rightArm, leftArm, rightForearm, leftForearm, hips, rightLeg, leftLeg, rightShin, leftShin, weapon) => ({ body, rightArm, leftArm, rightForearm, leftForearm, hips, rightLeg, leftLeg, rightShin, leftShin, weapon });
const ready = pose([.07, -.13, .02], [-.37, -.17, -.18], [-.2, .1, .12], [-.5, 0, 0], [-.38, 0, 0], [0, .06, 0], [-.08, 0, -.04], [.08, 0, .04], [.12, 0, 0], [.12, 0, 0], [.56, 0, -.12]);
const slashes = [
  [pose([.03,-.68,-.1],[-.75,-.85,-.65],[-.4,.2,.65],[-.95,.25,-.2],[-.65,0,0],[0,-.3,0],[-.4,0,0],[.25,0,0],[.45,0,0],[.16,0,0]), pose([.18,.88,.12],[-.72,1.1,-1.05],[-.35,-.5,.55],[-.08,-.4,.12],[-.5,0,0],[0,.4,0],[.28,0,0],[-.5,0,0],[.18,0,0],[.4,0,0])],
  [pose([.05,.7,.07],[-.72,1.12,-.95],[-.4,-.4,.58],[-.18,-.2,0],[-.6,0,0],[0,.28,0],[.18,0,0],[-.32,0,0],[.2,0,0],[.42,0,0]), pose([.12,-.9,-.1],[-.9,-1.22,-.42],[-.4,.48,.65],[-.2,.25,-.3],[-.45,0,0],[0,-.34,0],[-.42,0,0],[.24,0,0],[.4,0,0],[.2,0,0])],
  [pose([-.2,-.5,0],[-2.05,-.45,-.4],[-1.45,.4,.42],[-1.05,0,.1],[-.8,0,0],[0,-.18,0],[-.35,0,0],[.24,0,0],[.55,0,0],[.3,0,0],[1.1,0,0]), pose([.38,.38,.08],[-.5,.48,-.3],[-.55,.2,.25],[-.08,0,0],[-.25,0,0],[0,.17,0],[.45,0,0],[-.62,0,0],[.35,0,0],[.65,0,0])],
];
const heavy = [pose([-.23,-.18,0],[-2.65,-.25,-.25],[-2.35,.35,.24],[-.72,0,.15],[-.8,0,-.12],[0,-.08,0],[-.28,0,0],[.22,0,0],[.45,0,0],[.35,0,0],[1.75,0,0]),pose([.63,.17,0],[-.57,.18,-.16],[-.65,-.2,.14],[-.13,0,0],[-.2,0,0],[0,.05,0],[.42,0,0],[-.85,0,0],[.45,0,0],[.75,0,0],[.75,0,0])];
function blendPose(a, b, t) {
  const result = {};
  for (const name of new Set([...Object.keys(a), ...Object.keys(b)])) {
    const av = a[name] || [0,0,0], bv = b[name] || [0,0,0];
    result[name] = av.map((v,i)=>mix(v,bv[i],t));
  }
  return result;
}
function attackPose(p, poses, heavyAttack = false) {
  const wind = heavyAttack ? .43 : .27;
  const strike = heavyAttack ? .56 : .43;
  if (p < wind) return blendPose(ready, poses[0], smooth(clamp(p / wind)));
  if (p < strike) return blendPose(poses[0], poses[1], smooth((p - wind) / (strike - wind)));
  const recover = clamp((p - strike) / (1 - strike));
  return blendPose(poses[1], ready, smooth(recover));
}

/** Continuous joint targets, with action anticipation and follow-through retained between actions. */
export function animateCharacter(model, walk, action, time, dt, isPlayer = false, entity = null) {
  const rig = model.userData.rig || {}, rest = model.userData.rest || {};
  let target = blendPose({}, ready, isPlayer ? 1 : .7);
  const cycle = time * (isPlayer ? 12.5 : 9.5), stride = Math.sin(cycle), opposite = Math.sin(cycle + Math.PI);
  target.leftLeg = [-stride * .68 * walk, 0, .025]; target.rightLeg = [stride * .68 * walk,0,-.025];
  target.leftShin = [.13 + Math.max(0, stride) * .86 * walk,0,0]; target.rightShin = [.13 + Math.max(0, opposite) * .86 * walk,0,0];
  target.body = [.08 + walk * .12, Math.sin(cycle) * .09 * walk, Math.cos(cycle) * .025 * walk];
  target.leftArm = [-.2 + stride * .34 * walk,.1,.15]; target.rightArm = [-.38 - stride * .2 * walk,-.17,-.18];
  let rootY = Math.abs(Math.sin(cycle)) * .085 * walk, rootX = 0, rootZ = 0, rootYaw = 0;
  let hipsY = -.045 + Math.sin(time * 2.7) * .015;
  if (action) {
    const p = clamp(action.age / action.duration), type = action.type;
    if (type === 'attack' || type === 'heavy') {
      target = attackPose(p, type === 'heavy' ? heavy : slashes[action.step || 0], type === 'heavy');
      hipsY = -(type === 'heavy' ? .22 : .12) * Math.sin(p * Math.PI);
      rootY = type === 'heavy' ? Math.sin(clamp((p - .28)/.25) * Math.PI) * .19 : 0;
    } else if (type === 'roll') {
      const tuck = Math.sin(p * Math.PI);
      const folded = pose([.32,0,0],[-1.15,0,-.15],[-1.15,0,.15],[-1.4,0,0],[-1.4,0,0],[0,0,0],[-1.45,0,0],[-1.45,0,0],[1.95,0,0],[1.95,0,0],[2.15,0,0]);
      target = blendPose(ready, folded, smooth(Math.min(1, p / .15, (1 - p) / .2)));
      target.hips = [p * Math.PI * 2, 0, 0]; rootY = .5 * tuck; hipsY = .03 * tuck;
    } else if (type === 'whirl') {
      const extend = Math.sin(clamp(p / .2) * Math.PI / 2) * (1 - smooth(clamp((p-.78)/.22)));
      target = pose([.1,.35,0],[-.68,0,-1.45*extend],[-.4,0,1.1*extend],[-.12,0,0],[-.3,0,0],[0,.12,0],[-.26,0,-.08],[.25,0,.08],[.36,0,0],[.3,0,0]);
      rootYaw = smooth(p) * Math.PI * 4; rootY = Math.sin(p * Math.PI) * .12;
    } else if (type === 'burst') {
      target = attackPose(p, heavy, true);
      hipsY = -.36 * Math.sin(clamp(p / .4) * Math.PI / 2) * (p < .57 ? 1 : 1 - smooth((p-.57)/.43));
      rootY = p > .27 && p < .57 ? Math.sin((p - .27)/.3 * Math.PI) * 1.35 : 0;
      if (p > .57) target.body[0] += .3 * (1 - p);
    } else if (type === 'dash' || type === 'finisher') {
      target = attackPose(p, type === 'finisher' ? slashes[0] : slashes[1]);
      target.body[0] += .45 * Math.sin(p * Math.PI); target.rightLeg[0] -= .5 * Math.sin(p*Math.PI); target.leftShin[0] += .5;
      hipsY = -.22 * Math.sin(p * Math.PI); rootY = .12 * Math.sin(p * Math.PI);
    } else {
      target = attackPose(p, heavy); target.body[0] *= .45;
    }
  } else if (entity) {
    if (entity.mode === 'windup') {
      const p = clamp(1 - entity.timer / (entity.windupDuration || 1));
      if (entity.type === 'archer') target = blendPose(ready, pose([.02,-.36,0],[-1.2,.8,-.55],[-1.35,-.5,.45],[-1.7,.1,0],[-.1,0,0],[0,-.12,0],[-.18,0,0],[.18,0,0],[.22,0,0],[.25,0,0]), smooth(p));
      else target = blendPose(ready, entity.attackKind === 'sweep' ? slashes[0][0] : heavy[0], .4 + smooth(p)*.6);
      hipsY = -.12 * p;
    } else if (entity.mode === 'recover') {
      const duration = entity.recoverDuration || .6;
      const p = clamp(1 - entity.timer / duration);
      target = blendPose(entity.attackKind === 'sweep' ? slashes[0][1] : heavy[1], ready, smooth(p));
      if (entity.attackKind === 'sweep') rootYaw = (1 - p) * Math.PI * 1.5;
    }
    if (entity.stun > 0) {
      target.body[0] -= .52; target.body[2] += .17; target.head = [-.22,0,0];
      target.rightArm[2] -= .2; target.leftArm[2] += .3; hipsY -= .08;
    }
  }
  if (isPlayer && entity?.hurtTimer > 0) {
    const recoil = clamp(entity.hurtTimer / .15);
    target.body[0] -= .47 * recoil;
    target.body[2] -= .14 * recoil;
    target.head = [-.22 * recoil,.12 * recoil,.08 * recoil];
    target.leftArm[2] += .35 * recoil;
    target.rightArm[2] -= .28 * recoil;
    target.leftLeg[0] -= .32 * recoil;
    target.rightLeg[0] += .23 * recoil;
    target.leftShin[0] += .45 * recoil;
    target.rightShin[0] += .25 * recoil;
    hipsY -= .1 * recoil;
  }
  if (entity?.type === 'archer') target.weapon = [0,0,0];
  target.head ||= [-target.body[0] * .2,-(target.body[1]||0)*.4,0];
  target.hips ||= [0,0,0];
  target.scarf = [.1 + walk*.35 + Math.sin(time*8)*.12,Math.sin(time*5)*.05,0];
  target.cape = [.13 + walk*.27 + Math.sin(time*6)*.06,Math.sin(time*4)*.025,0];
  target.skirtLeft = [walk * Math.max(0, stride)*.25,0,.04]; target.skirtRight = [walk * Math.max(0, opposite)*.25,0,-.04];
  const rate = action ? (action.type === 'roll' ? 35 : 27) : entity?.stun > 0 || entity?.hurtTimer > 0 ? 30 : 14;
  const alpha = 1 - Math.exp(-rate * dt);
  for (const [name, base] of Object.entries(rest)) {
    const object = rig[name]; if (!object?.rotation) continue;
    const offset = target[name] || [0,0,0];
    object.rotation.x = name === 'hips' && action?.type === 'roll' ? base.rotation.x + offset[0] : mix(object.rotation.x,base.rotation.x+offset[0],alpha);
    object.rotation.y = mix(object.rotation.y,base.rotation.y+offset[1],alpha);
    object.rotation.z = mix(object.rotation.z,base.rotation.z+offset[2],alpha);
    object.position.x = mix(object.position.x,base.position.x,alpha);
    object.position.y = mix(object.position.y,base.position.y + (name==='hips' ? hipsY : 0),alpha);
    object.position.z = mix(object.position.z,base.position.z,alpha);
  }
  if (action?.type === 'roll' && rig.weapon) {
    // Counter the body tumble at the wrist, carrying the long blade clear of the floor.
    rig.weapon.rotation.x = Math.PI / 2 - ['hips','body','rightArm','rightForearm'].reduce((sum,name)=>sum + (rig[name]?.rotation.x || 0),0);
  }
  model.position.y = mix(model.position.y, rootY, alpha);
  model.rotation.x = action?.type === 'roll' ? rootX : mix(model.rotation.x,rootX,alpha);
  model.rotation.z = mix(model.rotation.z,rootZ,alpha);
  if (action?.type === 'whirl' || entity?.attackKind === 'sweep' && entity.mode === 'recover') model.rotation.y += rootYaw;
}
