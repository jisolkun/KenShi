import * as THREE from 'three';
import { buildWorld } from './world.js';
import { createWarrior, createEnemy } from './characters.js';
import { CombatEffects } from './effects.js';
import { animateCharacter } from './animation.js';
import { GameAudio } from './audio.js';
import { getActionClip, ENEMY_CLIPS } from './action-clips.js';
import { initLandscape } from './landscape.js';
import './style.css';

const $ = id => document.getElementById(id);
const setText = (id, text) => { const el = $(id); if (el) el.textContent = text; };
const canvas = $('game-canvas');
const landscape = initLandscape();
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.8));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = .99;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
const scene = new THREE.Scene();
scene.background = new THREE.Color('#dce4dd');
scene.fog = new THREE.Fog('#dce4dd', 70, 130);
scene.add(new THREE.HemisphereLight(0xfff4dd, 0x354840, 1.3));
const sunlight = new THREE.DirectionalLight(0xffefd4, 2.9);
sunlight.position.set(-12, 28, 16);
sunlight.castShadow = true;
sunlight.shadow.mapSize.set(2048, 2048);
Object.assign(sunlight.shadow.camera, { left: -35, right: 35, top: 32, bottom: -32, near: 1, far: 80 });
sunlight.shadow.normalBias = 0.035;
sunlight.shadow.bias = -0.0002;
sunlight.shadow.radius = 3;
scene.add(sunlight);
const fillLight = new THREE.DirectionalLight(0xc6e8dd, 0.65);
fillLight.position.set(15, 12, -18);
scene.add(fillLight);
const world = buildWorld(scene);
const bounds = world?.bounds || { minX: -13, maxX: 13, minZ: -10, maxZ: 10 };
const minX = bounds.minX ?? bounds.xMin ?? -13;
const maxX = bounds.maxX ?? bounds.xMax ?? 13;
const minZ = bounds.minZ ?? bounds.zMin ?? -10;
const maxZ = bounds.maxZ ?? bounds.zMax ?? 10;
const camera = new THREE.OrthographicCamera(-20, 20, 17, -17, 0.1, 130);
const cameraHome = new THREE.Vector3(22, 30, 25);
const cameraFocus = new THREE.Vector3();
const cameraFocusTarget = new THREE.Vector3();
let cameraViewHeight = 25;
let viewportAspect = window.innerWidth / window.innerHeight;
camera.position.copy(cameraHome);
camera.lookAt(0, 0, 0);
const raycaster = new THREE.Raycaster();
const pointerNDC = new THREE.Vector2();
const floorPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
const effects = new CombatEffects(scene);
const audio = new GameAudio();
const temp = new THREE.Vector3();
const temp2 = new THREE.Vector3();
const playerMove = new THREE.Vector3();
const screenRight = new THREE.Vector3(.756, 0, -.655);
const screenUp = new THREE.Vector3(-.655, 0, -.756);
const frostColor = new THREE.Color(0x80c8d6);
const flashColor = new THREE.Color(0xffffff);
const bladeReleaseOrigin = new THREE.Vector3();
const gold = 0xffe4a6;
const jade = 0x95f1d5;

const skillInfo = {
  dash: { cooldown: 5, cost: 18, label: '破阵突进', key: 'Q' },
  whirl: { cooldown: 9, cost: 25, label: '回风斩', key: 'E' },
  burst: { cooldown: 22, cost: 60, label: '无双 · 镇魂', key: 'R' },
  frost: { cooldown: 13, cost: 25, label: '玄冰牢', key: 'F' },
  blades: { cooldown: 8, cost: 20, label: '飞刃', key: 'C' },
};
const waves = [
  ['soldier', 'soldier', 'archer', 'soldier', 'soldier'],
  ['soldier', 'brute', 'archer', 'soldier', 'soldier', 'archer', 'brute'],
  ['soldier', 'archer', 'brute', 'soldier', 'archer', 'soldier', 'boss'],
];
const stats = {
  soldier: { hp: 44, speed: 2.1, damage: 7, reach: 1.8, windup: 0.76, interval: 1.6, souls: 5 },
  brute: { hp: 100, speed: 1.35, damage: 12, reach: 2.3, windup: 1.03, interval: 2.1, souls: 12 },
  archer: { hp: 38, speed: 1.5, damage: 6, reach: 11, windup: 0.95, interval: 2.5, souls: 7 },
  boss: { hp: 410, speed: 1.65, damage: 15, reach: 3.5, windup: 1.18, interval: 2.2, souls: 50 },
};
let state;
let enemies = [];
let pickups = [];
let projectiles = [];
let nextEnemyId = 1;
let frameTime = performance.now();
let visualTime = 0;
let hitstop = 0;
let shake = 0;
let slowMotion = 0;
let cameraPunch = 0;
let impactSerial = 0;
let impactCooldown = 0;
const cameraKick = new THREE.Vector3();
let spawnSchedule = [];
let waveTimer = null;
let toastTimer = 0;
let toastMessage = '';
let lastTapTime = -10;
let lastTapPoint = new THREE.Vector3(100, 0, 100);
let heldPointer = null;
let input = new Set();
let uiTimer = 0;

function prepareModel(model) {
  const materialSet = new Set();
  model.traverse(object => {
    if (!object.isMesh) return;
    object.castShadow = true;
    object.receiveShadow = true;
    const originals = Array.isArray(object.material) ? object.material : [object.material];
    const clones = originals.map(material => {
      const copy = material.clone();
      copy.userData.baseColor = copy.color?.clone();
      copy.userData.baseEmissive = copy.emissive?.clone();
      materialSet.add(copy);
      return copy;
    });
    object.material = Array.isArray(object.material) ? clones : clones[0];
  });
  const rig = model.userData.rig || {};
  const rest = {};
  for (const [name, object] of Object.entries(rig)) {
    if (object?.rotation) rest[name] = { rotation: object.rotation.clone(), position: object.position.clone() };
  }
  model.userData.rest = rest;
  model.userData.ownedMaterials = materialSet;
  return model;
}
const playerModel = prepareModel(createWarrior());
scene.add(playerModel);
const player = {
  model: playerModel,
  position: playerModel.position,
  destination: null,
  target: null,
  yaw: Math.PI,
  action: null,
  invulnerable: 0,
  flash: 0,
  hurtTimer: 0,
  hurtDuration: .23,
  reactionYaw: 0,
  comboStep: 0,
  comboWindow: 0,
  attackCooldown: 0,
  rollCooldown: 0,
  pendingHeavy: false,
  pendingBladeRelease: null,
  walk: 0,
};
player.model.rotation.y = player.yaw;

function makeGroundRing(color, inner, outer, opacity = 0.8) {
  const ring = new THREE.Mesh(new THREE.RingGeometry(inner, outer, 64), new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide, transparent: true, opacity, depthWrite: false }));
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.04;
  return ring;
}
const playerRing = makeGroundRing(0xa4bc9a, 0.69, 0.75, 0.45);
scene.add(playerRing);
const targetRing = makeGroundRing(0xbd3d32, 1, 1.075, 0.9);
scene.add(targetRing);
targetRing.visible = false;
const destinationRing = makeGroundRing(0xd59c48, 0.34, 0.39, 0.9);
scene.add(destinationRing);
destinationRing.visible = false;
let destinationLife = 0;

function clampPosition(position, padding = 0.6) {
  position.x = THREE.MathUtils.clamp(position.x, minX + padding, maxX - padding);
  position.z = THREE.MathUtils.clamp(position.z, minZ + padding, maxZ - padding);
  position.y = 0;
  // Low ruins have circular footprints; sliding around them keeps paths continuous.
  for (const obstacle of world.obstacles || []) {
    const dx = position.x - obstacle.x, dz = position.z - obstacle.z;
    const radius = obstacle.radius + Math.min(.55, padding);
    const distance = Math.hypot(dx, dz);
    if (distance < radius) {
      const nx = distance > .001 ? dx / distance : 1;
      const nz = distance > .001 ? dz / distance : 0;
      position.x = obstacle.x + nx * radius;
      position.z = obstacle.z + nz * radius;
    }
  }
}
function steerMovement(position, direction, entity, destination = null) {
  if (direction.lengthSq() < .001 || !(world.obstacles?.length)) return;
  const desired = direction.clone().normalize();
  const remaining = destination ? position.distanceTo(destination) : 5;
  const lookahead = Math.min(remaining, 3.2);
  let blocker = null, blockerIndex = -1, nearest = Infinity;
  for (let i = 0; i < world.obstacles.length; i++) {
    const obstacle = world.obstacles[i];
    const ox = obstacle.x - position.x, oz = obstacle.z - position.z;
    const along = ox * desired.x + oz * desired.z;
    const lateral = Math.abs(ox * desired.z - oz * desired.x);
    const destinationClearance = destination ? Math.hypot(destination.x - obstacle.x, destination.z - obstacle.z) : Infinity;
    const radius = Math.min(obstacle.radius + .78, Math.max(obstacle.radius + .53, destinationClearance - .02));
    if (along > -.25 && along < lookahead + radius && lateral < radius && along < nearest) {
      blocker = obstacle; blockerIndex = i; nearest = along;
    }
  }
  if (!blocker) { entity.detour = null; return; }
  const normal = new THREE.Vector3(position.x - blocker.x, 0, position.z - blocker.z).normalize();
  const tangent = new THREE.Vector3(-normal.z, 0, normal.x);
  if (entity.detour?.index !== blockerIndex) {
    const alignment = tangent.dot(desired);
    entity.detour = { index: blockerIndex, side: Math.abs(alignment) > .12 ? Math.sign(alignment) : (entity.id || 1) % 2 ? 1 : -1 };
  }
  tangent.multiplyScalar(entity.detour.side);
  // Tangent motion advances around the footprint; outward bias gives the sword arm room.
  direction.copy(desired).multiplyScalar(.38).addScaledVector(tangent, .95).addScaledVector(normal, .16).normalize();
}
function directionTo(position) {
  const direction = position.clone().sub(player.position).setY(0);
  if (direction.lengthSq() < 0.001) return new THREE.Vector3(Math.sin(player.yaw), 0, Math.cos(player.yaw));
  return direction.normalize();
}
function face(yaw, dt, speed = 18) {
  const diff = Math.atan2(Math.sin(yaw - player.yaw), Math.cos(yaw - player.yaw));
  player.yaw += diff * Math.min(1, dt * speed);
}
function showToast(message, duration = 2.3) {
  toastMessage = message;
  toastTimer = duration;
  const el = $('toast');
  if (el) {
    el.textContent = message;
    el.hidden = false;
    el.classList.add('visible');
  }
}
function makeHealthBar(enemy) {
  const group = new THREE.Group();
  const width = enemy.type === 'boss' ? 2.7 : 1.25;
  const background = new THREE.Mesh(new THREE.PlaneGeometry(width + 0.08, 0.16), new THREE.MeshBasicMaterial({ color: 0x233c36, transparent: true, opacity: 0.9, depthWrite: false }));
  const fill = new THREE.Mesh(new THREE.PlaneGeometry(width, 0.095), new THREE.MeshBasicMaterial({ color: enemy.type === 'boss' ? 0xa6382e : 0xba6656, depthWrite: false }));
  fill.position.z = 0.005;
  group.add(background, fill);
  group.renderOrder = 20;
  group.userData.width = width;
  scene.add(group);
  enemy.healthBar = group;
  enemy.healthFill = fill;
}
function makeTelegraph(enemy) {
  const radius = enemy.type === 'boss' ? 4.25 : enemy.type === 'brute' ? 2.4 : 1.8;
  const group = new THREE.Group();
  const disk = new THREE.Mesh(new THREE.CircleGeometry(radius, 48), new THREE.MeshBasicMaterial({ color: 0xc54730, side: THREE.DoubleSide, transparent: true, opacity: 0.13, depthWrite: false }));
  const outline = makeGroundRing(0xc4472e, radius * 0.94, radius, 0.55);
  disk.rotation.x = -Math.PI / 2;
  disk.position.y = 0.025;
  group.add(disk, outline);
  scene.add(group);
  group.visible = false;
  enemy.telegraph = group;
  enemy.warningDisk = disk;
  enemy.warningOutline = outline;
}
function spawnEnemy(type, index) {
  const variant = type;
  const model = prepareModel(createEnemy(variant));
  if (type === 'boss') {
    model.scale.multiplyScalar(1.12);
    for (const material of model.userData.ownedMaterials) {
      if (material.color && material.color.r + material.color.g + material.color.b < 1.4) {
        material.color.lerp(new THREE.Color(0x63252a), 0.35);
        material.userData.baseColor.copy(material.color);
      }
    }
  }
  const anchor = world.spawnPoints?.[(index * 5 + state.wave * 2) % world.spawnPoints.length];
  const angle = anchor ? Math.atan2(anchor.x - player.position.x, anchor.z - player.position.z) : index * 2.39996 + state.wave * .88;
  const radius = index < 2 ? 9.5 : 11 + index % 3 * 1.35;
  const x = THREE.MathUtils.clamp(player.position.x + Math.sin(angle) * radius, minX + 2, maxX - 2);
  const z = THREE.MathUtils.clamp(player.position.z + Math.cos(angle) * radius, minZ + 2, maxZ - 2);
  model.position.set(x, 0, z);
  model.rotation.y = Math.atan2(player.position.x - x, player.position.z - z);
  const enemy = {
    id: nextEnemyId++, type, model, position: model.position,
    hp: stats[type].hp, maxHp: stats[type].hp,
    mode: 'spawn', timer: 0.58,
    attackCooldown: 0.5 + Math.random() * 0.7,
    velocity: new THREE.Vector3(), yaw: model.rotation.y,
    flash: 0, stun: 0, frost: 0, walk: 0, deathAge: 0,
    attackKind: 'slam', attacks: 0, windupDuration: stats[type].windup, recoverDuration: .6,
    guard: type === 'brute' || type === 'boss',
    aim: new THREE.Vector3(), shotAim: new THREE.Vector3(),
    lastHitDirection: new THREE.Vector3(0, 0, 1), reactionYaw: 0, reactionStrength: 0, reactionAge: 1, reactionDuration: .25,
  };
  model.traverse(object => { if (object.isMesh) object.userData.enemyId = enemy.id; });
  makeHealthBar(enemy);
  makeTelegraph(enemy);
  scene.add(model);
  enemies.push(enemy);
  effects.ring(model.position, type === 'boss' ? 2 : 1.2, 0x8cb9a3, 0.68);
  if (type === 'boss') {
    showToast('尸将现身 · 先避开红圈，再寻找破绽', 4);
    audio.play('wave');
  }
}
function beginWave(number) {
  state.wave = number;
  waveTimer = null;
  spawnSchedule = waves[number - 1].map((type, index) => ({ type, index, at: state.elapsed + 0.45 + index * 0.65 }));
  showToast(number === 1 ? '第一波 · 点击敌人，出刀即行' : number === 2 ? '第二波 · 弓手与重甲加入战场' : '最后一波 · 镇魂之战', 3);
  audio.play('wave');
}
function disposeBar(group) {
  if (!group) return;
  group.traverse(mesh => {
    if (mesh.isMesh) { mesh.geometry.dispose(); mesh.material.dispose(); }
  });
  scene.remove(group);
}
function disposeEnemy(enemy) {
  scene.remove(enemy.model);
  enemy.model.userData.ownedGeometries?.forEach(geometry => geometry.dispose());
  enemy.model.userData.ownedMaterials.forEach(material => material.dispose());
  disposeBar(enemy.healthBar);
  disposeBar(enemy.telegraph);
}
function clearProjectile(projectile) {
  scene.remove(projectile.mesh);
  projectile.mesh.geometry.dispose();
  projectile.mesh.material.dispose();
}
function clearPickup(pickup) {
  scene.remove(pickup.mesh);
  pickup.mesh.geometry.dispose();
  pickup.mesh.material.dispose();
}
function resetGame() {
  enemies.forEach(disposeEnemy);
  pickups.forEach(clearPickup);
  projectiles.forEach(clearProjectile);
  enemies = [];
  pickups = [];
  projectiles = [];
  effects.clear();
  audio.clear();
  cameraFocus.set(0, 0, 0);
  cameraFocusTarget.set(0, 0, 0);
  camera.position.copy(cameraHome);
  camera.lookAt(cameraFocus);
  spawnSchedule = [];
  waveTimer = null;
  input.clear();
  heldPointer = null;
  lastTapTime = -10;
  lastTapPoint.set(100, 0, 100);
  hitstop = 0;
  shake = 0;
  slowMotion = 0;
  cameraPunch = 0;
  impactSerial = 0;
  impactCooldown = 0;
  cameraKick.set(0, 0, 0);
  nextEnemyId = 1;
  state = {
    phase: 'ready', paused: false, hp: 100, sp: 100, wave: 0,
    kills: 0, souls: 0, combo: 0, maxCombo: 0, comboTimeout: 0,
    elapsed: 0, hits: 0, stars: 0, finisherCooldown: 0,
    cooldowns: { dash: 0, whirl: 0, burst: 0, frost: 0, blades: 0 },
  };
  player.position.set(0, 0, 2.4);
  player.yaw = Math.PI;
  player.model.rotation.set(0, player.yaw, 0);
  player.model.visible = true;
  player.destination = null;
  player.target = null;
  player.action = null;
  player.flash = 0;
  player.hurtTimer = 0;
  player.hurtDuration = .23;
  player.reactionYaw = 0;
  player.invulnerable = 0;
  player.pendingHeavy = false;
  player.pendingBladeRelease = null;
  player.comboStep = 0;
  player.comboWindow = 0;
  player.attackCooldown = 0;
  player.rollCooldown = 0;
  player.walk = 0;
  player.detour = null;
  for (const [name, base] of Object.entries(player.model.userData.rest || {})) {
    const joint = player.model.userData.rig[name];
    joint.rotation.copy(base.rotation);
    joint.position.copy(base.position);
  }
  targetRing.visible = false;
  destinationRing.visible = false;
  destinationLife = 0;
  toastTimer = 0;
  if ($('toast')) { $('toast').hidden = true; $('toast').classList.remove('visible'); }
  for (const id of ['pause-screen', 'result-screen']) if ($(id)) $(id).hidden = true;
  setText('result-stars', '');
  updateUI(true);
}
function startGame() {
  landscape.requestLandscape();
  audio.unlock();
  audio.resume();
  resetGame();
  state.phase = 'running';
  if ($('start-screen')) $('start-screen').hidden = true;
  if ($('help-panel')) $('help-panel').hidden = true;
  beginWave(1);
  updateUI(true);
}
function pauseGame() {
  if (state.phase !== 'running' || state.paused) return;
  state.paused = true;
  input.clear();
  heldPointer = null;
  if ($('pause-screen')) $('pause-screen').hidden = false;
  audio.suspend();
  updateUI(true);
}
function resumeGame() {
  landscape.requestLandscape();
  if (state.phase !== 'running' || !state.paused) return;
  state.paused = false;
  if ($('pause-screen')) $('pause-screen').hidden = true;
  audio.unlock();
  audio.resume();
  frameTime = performance.now();
  updateUI(true);
}
function finishGame(victory) {
  if (state.phase !== 'running') return;
  state.phase = victory ? 'victory' : 'defeat';
  state.paused = false;
  state.stars = victory ? 1 + Number(state.elapsed <= 180) + Number(state.hits < 2) : 0;
  input.clear();
  heldPointer = null;
  player.action = null;
  player.destination = null;
  player.target = null;
  targetRing.visible = false;
  destinationRing.visible = false;
  if ($('pause-screen')) $('pause-screen').hidden = true;
  if ($('result-screen')) $('result-screen').hidden = false;
  setText('result-title', victory ? '镇魂功成' : '战意未尽');
  setText('result-subtitle', victory ? '古寺重归寂静。此役，你守住了山门。' : '调整走位，避开红圈，再战山门。');
  setText('result-kills', `${state.kills}`);
  setText('result-time', formatTime(state.elapsed));
  setText('result-combo', `${state.maxCombo}`);
  setText('result-stars', victory ? '★'.repeat(state.stars) + '☆'.repeat(3 - state.stars) : '☆☆☆');
  setText('result-hits', `${state.hits}`);
  setText('result-grade', victory ? `${state.stars} 星 · ${state.elapsed <= 180 ? '限时达成' : '超过 180 秒'} · ${state.hits < 2 ? '受击目标达成' : '受击目标未达成'}` : '调整走位 · 保存气力 · 再战山门');
  audio.play(victory ? 'win' : 'lose');
  if (victory) effects.ring(player.position, 6, gold, 1.1);
  updateUI(true);
}
function nearestEnemy(range = Infinity) {
  let nearest = null;
  let minDistance = range * range;
  for (const enemy of enemies) {
    if (enemy.hp <= 0 || enemy.mode === 'spawn') continue;
    const distance = enemy.position.distanceToSquared(player.position);
    if (distance < minDistance) { nearest = enemy; minDistance = distance; }
  }
  return nearest;
}
function setDestination(position) {
  player.target = null;
  player.pendingHeavy = false;
  player.destination = position.clone();
  clampPosition(player.destination);
  destinationRing.position.copy(player.destination);
  destinationRing.position.y = 0.045;
  destinationRing.visible = true;
  destinationLife = 0.95;
}
function setTarget(enemy, heavy = false) {
  player.target = enemy;
  player.destination = null;
  player.pendingHeavy = heavy;
  targetRing.visible = true;
}
function beginAttack(enemy, heavy = false) {
  if (player.action || player.attackCooldown > 0) return;
  if (heavy && state.sp < 18) {
    player.pendingHeavy = false;
    showToast('气力不足 · 稍候恢复');
    heavy = false;
  }
  if (heavy) state.sp -= 18;
  player.comboStep = player.comboWindow > 0 ? (player.comboStep + 1) % 3 : 0;
  player.comboWindow = 1.4;
  const direction = directionTo(enemy?.position || player.destination || player.position.clone().add(new THREE.Vector3(Math.sin(player.yaw), 0, Math.cos(player.yaw))));
  player.yaw = Math.atan2(direction.x, direction.z);
  const clip = getActionClip(heavy ? 'heavy' : 'attack', player.comboStep);
  player.action = {
    type: heavy ? 'heavy' : 'attack', age: 0, clip,
    duration: clip.duration,
    direction, focus: enemy, hits: new Set(), step: player.comboStep, fired: false, impact: false,
  };
  player.pendingHeavy = false;
  player.attackCooldown = 0.05;
  if (heavy) player.invulnerable = Math.max(player.invulnerable, 0.4);
}
function roll(direction) {
  if (state.phase !== 'running' || state.paused) return;
  if (player.rollCooldown > 0 || state.sp < 12) {
    showToast(state.sp < 12 ? '气力不足 · 无法翻滚' : '翻滚恢复中', 1);
    return;
  }
  state.sp -= 12;
  player.action = { type: 'roll', age: 0, duration: getActionClip('roll').duration, clip: getActionClip('roll'), direction: direction.clone(), hits: new Set() };
  player.invulnerable = 0.55;
  player.rollCooldown = 0.65;
  player.yaw = Math.atan2(direction.x, direction.z);
  player.destination = null;
  player.pendingHeavy = false;
  audio.play('roll');
  effects.dust?.(player.position, direction, .65);
  effects.ring(player.position, 0.8, jade, 0.23);
}
function useSkill(name, directionOverride) {
  if (state.phase !== 'running' || state.paused || !skillInfo[name]) return;
  const info = skillInfo[name];
  if (state.cooldowns[name] > 0) { showToast(`${info.label} · 尚需 ${Math.ceil(state.cooldowns[name])} 秒`, 1.1); return; }
  if (state.sp < info.cost) { showToast(`气力不足 · 需要 ${info.cost} 气力`, 1.5); return; }
  if (player.action && ['burst', 'heavy', 'finisher'].includes(player.action.type)) return;
  state.sp -= info.cost;
  state.cooldowns[name] = info.cooldown;
  let direction = directionOverride || directionTo(player.target?.hp > 0 ? player.target.position : nearestEnemy(10)?.position || player.destination || player.position.clone().add(new THREE.Vector3(Math.sin(player.yaw), 0, Math.cos(player.yaw))));
  direction = direction.clone().setY(0).normalize();
  if (direction.lengthSq() < 0.1) direction.set(Math.sin(player.yaw), 0, Math.cos(player.yaw));
  const clip = getActionClip(name);
  player.action = { type: name, age: 0, duration: clip.duration, clip, direction, hits: new Set(), pulse: 0, fired: false };
  player.invulnerable = clip.duration + 0.12;
  player.yaw = Math.atan2(direction.x, direction.z);
  player.pendingHeavy = false;
  if (name === 'burst') {
    effects.ring(player.position, 1.2, gold, .62);
    showToast('无双 · 镇魂　范围爆发', 1.8);
    audio.play('charge');
  } else if (name === 'frost') {
    showToast('玄冰牢 · 冻缓群敌', 1.3);
    audio.play('seal');
  } else if (name === 'blades') {
    audio.play('draw');
  } else if (name === 'dash') audio.play('dash');
  updateUI(true);
}
function useFinisher(direction) {
  if (state.phase !== 'running' || state.paused) return;
  if (state.finisherCooldown > 0) { showToast('瞬杀恢复中', 1); return; }
  if (state.sp < 60) { showToast('气力不足 · 瞬杀需要 60 气力', 1.4); return; }
  if (player.action && ['burst', 'heavy', 'finisher'].includes(player.action.type)) return;
  direction = direction.clone().setY(0).normalize();
  if (direction.lengthSq() < 0.01) direction.set(Math.sin(player.yaw), 0, Math.cos(player.yaw));
  let focus = player.target?.hp > 0 && player.target.position.distanceTo(player.position) <= 8 ? player.target : null;
  if (!focus) {
    let nearest = 8;
    for (const enemy of enemies) {
      if (enemy.hp <= 0 || enemy.mode === 'spawn') continue;
      const offset = enemy.position.clone().sub(player.position).setY(0);
      const distance = offset.length();
      if (distance < nearest && offset.normalize().dot(direction) > 0.35) { focus = enemy; nearest = distance; }
    }
  }
  state.sp -= 60;
  state.finisherCooldown = 3;
  if (focus) direction = directionTo(focus.position);
  player.action = { type: 'finisher', age: 0, duration: getActionClip('finisher').duration, clip: getActionClip('finisher'), direction, focus, hits: new Set(), fired: false };
  player.invulnerable = 0.92;
  player.yaw = Math.atan2(direction.x, direction.z);
  player.destination = null;
  player.pendingHeavy = false;
  audio.play('draw');
  effects.dust(player.position, direction, .6);
  showToast('瞬杀 · 寻隙处决', 1.3);
  updateUI(true);
}
function impactBeat(direction, strength = 1, heavy = false, strike = player.action) {
  // A contact gets one pause, even when the blade catches a whole crowd.
  const pulse = strike?.pulse || 0;
  if (strike && strike.impactPulse === pulse) return;
  if (strike) strike.impactPulse = pulse;
  if (impactCooldown > 0) return;
  hitstop = heavy ? .064 : .032 + Math.min(.012, strength * .007);
  impactCooldown = heavy ? .14 : .09;
  impactSerial++;
  cameraKick.copy(direction).multiplyScalar(heavy ? .32 : .13);
  cameraPunch = Math.max(cameraPunch, heavy ? .62 : .2);
  shake = Math.max(shake, heavy ? .13 : .045);
}
function hitEnemy(enemy, damage, knockback = 2.2, color = gold, strike = player.action, hitDirection = strike?.direction) {
  if (enemy.hp <= 0 || enemy.mode === 'spawn') return;
  const heavy = damage >= 55 || strike?.type === 'finisher';
  const direction = enemy.lastHitDirection;
  if (hitDirection) direction.copy(hitDirection).setY(0);
  else direction.copy(enemy.position).sub(player.position).setY(0);
  if (direction.lengthSq() < .01) direction.set(Math.sin(player.yaw),0,Math.cos(player.yaw));
  direction.normalize();
  const guarded = enemy.guard && enemy.mode === 'chase' && !heavy && enemy.stun <= 0;
  if (guarded) damage = Math.round(damage * (enemy.type === 'boss' ? .86 : .78));
  enemy.hp = Math.max(0, enemy.hp - damage);
  enemy.flash = .12;
  // Committed boss attacks retain their telegraph; heavy blows interrupt them.
  if (!(enemy.type === 'boss' && enemy.mode === 'windup' && !heavy)) {
    enemy.stun = enemy.type === 'boss' ? .11 : heavy ? .42 : .25;
    enemy.mode = 'chase';
    enemy.telegraph.visible = false;
    enemy.attackCooldown = Math.max(enemy.attackCooldown, .5);
  }
  enemy.velocity.addScaledVector(direction, enemy.type === 'boss' ? knockback * .28 : knockback);
  enemy.reactionYaw = Math.atan2(direction.x, direction.z) - enemy.yaw;
  enemy.reactionStrength = heavy ? 1.5 : guarded ? .6 : 1;
  enemy.reactionAge = 0;
  enemy.reactionDuration = heavy ? .32 : .22;
  state.combo++;
  state.maxCombo = Math.max(state.maxCombo, state.combo);
  state.comboTimeout = 3.1;
  effects.impact?.(enemy.position, direction, heavy ? 1.5 : guarded ? .65 : .95, color);
  if (!effects.impact) effects.emit(enemy.position, color, 12, .9);
  // Normal blows are readable through animation; floating type marks the rare decisive hit.
  if (heavy || guarded || state.combo % 5 === 0) effects.label(enemy.position, heavy ? `重创 ${damage}` : guarded ? `护甲 ${damage}` : String(damage), heavy ? '#ffdfa0' : '#fff4d5', heavy ? 33 : 22);
  if (!strike || strike.soundPulse !== (strike.pulse || 0)) {
    audio.play('hit', heavy ? 1.35 : guarded ? .65 : .9);
    if (strike) strike.soundPulse = strike.pulse || 0;
  }
  impactBeat(direction, heavy ? 1.5 : 1, heavy, strike);
  if (heavy) slowMotion = Math.max(slowMotion, .07);
  if (enemy.hp <= 0) killEnemy(enemy);
}
function killEnemy(enemy) {
  enemy.mode = 'dead';
  enemy.deathAge = 0;
  enemy.velocity.addScaledVector(enemy.lastHitDirection || new THREE.Vector3(0,0,1), enemy.type === 'boss' ? 2 : 3.8);
  enemy.telegraph.visible = false;
  enemy.healthBar.visible = false;
  state.kills++;
  state.souls += stats[enemy.type].souls;
  if (player.target === enemy) {
    player.target = null;
    player.pendingHeavy = false;
  }
  if (enemy.type === 'brute' || enemy.type === 'boss' || state.kills % 4 === 0) spawnPickup(enemy.position, 'health');
  else spawnPickup(enemy.position, 'soul');
  effects.emit(enemy.position, jade, 10, 0.7);
}
function hurtPlayer(damage, source) {
  if (player.invulnerable > 0 || state.phase !== 'running') return;
  state.hp = Math.max(0, state.hp - damage);
  state.hits++;
  state.combo = 0;
  state.comboTimeout = 0;
  player.invulnerable = 0.9;
  player.flash = 0.32;
  player.hurtDuration = damage >= 12 ? .29 : .23;
  player.hurtTimer = player.hurtDuration;
  player.action = null;
  player.attackCooldown = .23;
  shake = 0.34;
  hitstop = Math.max(hitstop, .055);
  cameraPunch = .6;
  temp.copy(player.position).sub(source).setY(0);
  if (temp.lengthSq() < .001) temp.set(-Math.sin(player.yaw), 0, -Math.cos(player.yaw));
  temp.normalize();
  player.reactionYaw = Math.atan2(temp.x, temp.z) - player.yaw;
  cameraKick.copy(temp).multiplyScalar(.38);
  player.position.addScaledVector(temp, 0.55);
  clampPosition(player.position);
  effects.emit(player.position, 0xe49877, 10, 0.7);
  effects.label(player.position, `−${damage}`, '#ffb8a5', 31);
  audio.play('hurt');
  if (state.hp <= 0) finishGame(false);
}
function strikeArea(radius, damage, action, full = false, knockback = 3, color = gold) {
  for (const enemy of enemies) {
    if (enemy.hp <= 0 || action.hits.has(enemy.id)) continue;
    const displacement = temp2.copy(enemy.position).sub(player.position).setY(0);
    if (displacement.length() > radius + (enemy.type === 'boss' ? 0.5 : 0.2)) continue;
    if (!full && displacement.lengthSq() > 0.6 && displacement.normalize().dot(action.direction) < 0.08) continue;
    action.hits.add(enemy.id);
    hitEnemy(enemy, damage, knockback, color, action, full && action.type !== 'dash' ? null : action.direction);
  }
}
function spawnPickup(position, type) {
  const mesh = new THREE.Mesh(new THREE.IcosahedronGeometry(type === 'health' ? 0.2 : 0.12, 1), new THREE.MeshBasicMaterial({ color: type === 'health' ? 0x94d7b1 : 0xf7cf82 }));
  mesh.position.copy(position);
  mesh.position.y = 0.6;
  scene.add(mesh);
  pickups.push({ mesh, type, age: 0, life: 18 });
}
function shootEnemy(enemy) {
  const direction = enemy.shotAim.clone().sub(enemy.position).setY(0).normalize();
  const mesh = new THREE.Mesh(new THREE.ConeGeometry(0.095, 0.7, 5), new THREE.MeshBasicMaterial({ color: 0xcd7651 }));
  mesh.position.copy(enemy.position);
  mesh.position.y = 1.05;
  mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction);
  scene.add(mesh);
  projectiles.push({ mesh, direction, age: 0, life: 3, speed: 8, damage: stats[enemy.type].damage, friendly: false, source: enemy.position.clone() });
}
function shootBlades(action) {
  const hand = player.model.userData.rig?.leftHand;
  if (hand) {
    hand.updateWorldMatrix(true, false);
    hand.getWorldPosition(bladeReleaseOrigin);
  } else {
    bladeReleaseOrigin.copy(player.position);
    bladeReleaseOrigin.y = 1.2;
  }
  for (const angle of [-0.24, 0, 0.24]) {
    const direction = action.direction.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), angle);
    const mesh = new THREE.Mesh(new THREE.OctahedronGeometry(0.23), new THREE.MeshBasicMaterial({ color: 0xfde4af }));
    mesh.scale.set(0.45, 0.35, 2.6);
    mesh.position.copy(bladeReleaseOrigin);
    mesh.rotation.y = Math.atan2(direction.x, direction.z);
    scene.add(mesh);
    projectiles.push({ mesh, direction, age: 0, life: 1.4, speed: 14, damage: 43, friendly: true, hits: new Set(), source: bladeReleaseOrigin.clone() });
  }
}
function driveProgress(progress, start, end) {
  const t = THREE.MathUtils.clamp((progress - start) / Math.max(.001, end - start), 0, 1);
  return t * t * (3 - 2 * t);
}
function updateAction(dt, allowCombo = true) {
  const action = player.action;
  if (!action) return;
  const clip = action.clip || getActionClip(action.type, action.step);
  const previous = action.age / action.duration;
  action.age += dt;
  const p = action.age / action.duration;
  const drive = driveProgress(p, clip.driveStart, clip.driveEnd) - driveProgress(previous, clip.driveStart, clip.driveEnd);
  if (action.type === 'roll') {
    player.position.addScaledVector(action.direction, drive * 3.55);
    clampPosition(player.position);
    if (!action.departed && p >= clip.driveStart) {
      action.departed = true;
      effects.dust(player.position, action.direction, .5);
    }
  } else if (action.type === 'attack' || action.type === 'heavy') {
    const heavy = action.type === 'heavy';
    const distance = action.focus?.hp > 0 ? action.focus.position.distanceTo(player.position) : Infinity;
    player.position.addScaledVector(action.direction, Math.min(drive * (heavy ? .95 : [.6, .7, .85][action.step]), Math.max(0, distance - 1.25)));
    clampPosition(player.position);
    if (!action.air && p >= clip.trailStart) {
      action.air = true;
      audio.play(heavy ? 'heavy' : 'slash', heavy ? 1 : [.9, 1.05, 1.2][action.step]);
    }
    if (p >= clip.contact && !action.fired) {
      action.fired = true;
      strikeArea(heavy ? 3.3 : action.step === 2 ? 2.7 : 2.45, heavy ? 65 : [23, 26, 36][action.step], action, false, heavy ? 5.2 : 2.8);
      effects.dust(player.position, action.direction, heavy ? .85 : .25);
    }
  } else if (action.type === 'dash') {
    player.position.addScaledVector(action.direction, drive * 6.48);
    clampPosition(player.position);
    if (!action.departed && p >= clip.driveStart) {
      action.departed = true;
      effects.dust(player.position, action.direction, 1);
    }
    if (p >= clip.contact && previous < clip.driveEnd) strikeArea(1.95, 48, action, true, 5, jade);
  } else if (action.type === 'whirl') {
    const contacts = clip.contacts;
    while (action.pulse < contacts.length && p >= contacts[action.pulse]) {
      action.pulse++;
      action.hits.clear();
      strikeArea(4, 29, action, true, 3.7);
      audio.play('slash', 1.05);
      effects.dust(player.position, player.yaw + action.pulse * 2.1, .45);
    }
  } else if (action.type === 'burst' && p >= clip.contact && !action.fired) {
    action.fired = true;
    audio.play('burst');
    temp.copy(player.position).setY(0);
    effects.skill(temp, 'burst', player.yaw);
    strikeArea(6.6, 112, action, true, 8.5);
    if (action.hits.size) slowMotion = .1;
  } else if (action.type === 'finisher') {
    // Arrive before the authored cut; then settle into the finishing stance.
    const travel = driveProgress(p, clip.driveStart, clip.contact) - driveProgress(previous, clip.driveStart, clip.contact);
    if (action.focus?.hp > 0) {
      const distance = player.position.distanceTo(action.focus.position);
      if (distance > 1.35 && travel > 0) {
        action.direction.copy(action.focus.position).sub(player.position).setY(0).normalize();
        player.position.addScaledVector(action.direction, Math.min(travel * 8, distance - 1.35));
        player.yaw = Math.atan2(action.direction.x, action.direction.z);
      }
    } else player.position.addScaledVector(action.direction, travel * 3.4);
    clampPosition(player.position);
    if (!action.air && p >= clip.trailStart) { action.air = true; audio.play('slash', 1.3); }
    if (p >= clip.contact && !action.fired) {
      action.fired = true;
      audio.play('finisher');
      const focus = action.focus;
      if (focus?.hp > 0 && focus.position.distanceTo(player.position) < 3.5) {
        hitEnemy(focus, focus.type === 'boss' ? 155 : focus.hp, 7, gold);
        if (focus.hp <= 0) {
          state.hp = Math.min(100, state.hp + 24);
          effects.label(player.position, '+24', '#b5ecd4', 27);
          showToast('瞬杀成功 · 气血恢复', 1.8);
        } else showToast('尸将重创 · 乘势追击', 1.5);
        slowMotion = .11;
      }
    }
  } else if (action.type === 'frost' && p >= clip.contact && !action.fired) {
    action.fired = true;
    effects.skill(player.position, 'frost', player.yaw);
    audio.play('frost');
    for (const enemy of enemies) {
      if (enemy.hp > 0 && enemy.position.distanceTo(player.position) < 6.2) {
        enemy.frost = 5.5;
        action.hits.add(enemy.id);
        hitEnemy(enemy, 22, 1, 0x9ce2f4, action, null);
      }
    }
  } else if (action.type === 'blades' && p >= clip.contact && !action.fired) {
    action.fired = true;
    player.pendingBladeRelease = action;
  }
  // Preserve the return-cut chamber and accept the next target during recovery.
  if (allowCombo && action.type === 'attack' && action.fired && p >= clip.comboOpen) {
    const target = player.target?.hp > 0 && player.target.position.distanceTo(player.position) <= 2.8 ? player.target : nearestEnemy(2.5);
    if (target) { player.action = null; beginAttack(target, player.pendingHeavy); return; }
  }
  if (action.age >= action.duration) player.action = null;
}
function setModelAppearance(model, flash, opacity = 1, frost = 0) {
  for (const material of model.userData.ownedMaterials) {
    if (material.color && material.userData.baseColor) {
      material.color.copy(material.userData.baseColor);
      if (frost > 0) material.color.lerp(frostColor, 0.45);
      if (flash > 0) material.color.lerp(flashColor, 0.8);
    }
    if (material.emissive && material.userData.baseEmissive) {
      material.emissive.copy(material.userData.baseEmissive);
      if (flash > 0) material.emissive.setHex(0x9a8b65);
    }
    material.transparent = opacity < 1;
    material.opacity = opacity;
    material.depthWrite = opacity > 0.25;
  }
}
function updatePlayer(dt) {
  player.invulnerable = Math.max(0, player.invulnerable - dt);
  player.flash = Math.max(0, player.flash - dt);
  player.hurtTimer = Math.max(0, player.hurtTimer - dt);
  player.attackCooldown = Math.max(0, player.attackCooldown - dt);
  player.rollCooldown = Math.max(0, player.rollCooldown - dt);
  player.comboWindow = Math.max(0, player.comboWindow - dt);
  if (player.target?.hp <= 0) player.target = null;
  const move = playerMove.set(0, 0, 0);
  // Screen-space WASD is an optional desktop aid; pointer movement is primary.
  const right = screenRight, up = screenUp;
  if (input.has('KeyW') || input.has('ArrowUp')) move.add(up);
  if (input.has('KeyS') || input.has('ArrowDown')) move.sub(up);
  if (input.has('KeyD') || input.has('ArrowRight')) move.add(right);
  if (input.has('KeyA') || input.has('ArrowLeft')) move.sub(right);
  const manualMove = move.lengthSq() > 0;
  if (manualMove) { move.normalize(); player.destination = null; player.target = null; player.pendingHeavy = false; }
  let walking = false;
  if (!player.action && player.hurtTimer <= 0) {
    const attackRange = player.pendingHeavy ? 3.1 : 2.3;
    const attackTarget = player.target?.hp > 0 ? (player.target.position.distanceTo(player.position) <= attackRange ? player.target : null) : nearestEnemy(attackRange);
    if (attackTarget && !manualMove) beginAttack(attackTarget, player.pendingHeavy);
    if (!player.action) {
      let destination = player.target?.hp > 0 ? player.target.position : player.destination;
      if (!manualMove && destination) {
        move.copy(destination).sub(player.position).setY(0);
        if (move.length() > (player.target ? 1.8 : 0.17)) move.normalize();
        else { move.set(0, 0, 0); if (!player.target) player.destination = null; }
      }
      if (move.lengthSq() > 0.01) {
        if (!manualMove) steerMovement(player.position, move, player, destination);
        face(Math.atan2(move.x, move.z), dt);
        player.position.addScaledVector(move, dt * 5.6);
        clampPosition(player.position);
        walking = true;
      }
    }
  }
  updateAction(dt, !manualMove);
  player.walk = THREE.MathUtils.damp(player.walk, walking ? 1 : 0, 10, dt);
  player.model.rotation.y = player.yaw;
  animateCharacter(player.model, player.walk, player.action, visualTime, dt, true, player);
  if (player.pendingBladeRelease) {
    shootBlades(player.pendingBladeRelease);
    player.pendingBladeRelease = null;
    audio.play('blades');
  }
  const activeClip = player.action?.clip;
  const progress = player.action ? player.action.age / player.action.duration : 0;
  effects.weaponTrail(player.model.userData.rig.weapon, player.action,
    !!activeClip && progress >= activeClip.trailStart && progress <= activeClip.trailEnd && activeClip.trailEnd > activeClip.trailStart,
    player.action?.type === 'dash' ? jade : gold);
  setModelAppearance(player.model, player.flash);
  if (player.invulnerable > 0 && !player.action && player.flash <= 0) player.model.visible = Math.floor(visualTime * 16) % 2 === 0;
  else player.model.visible = true;
  playerRing.position.copy(player.position);
  playerRing.position.y = 0.035;
  if (player.target?.hp > 0) {
    targetRing.visible = true;
    targetRing.position.copy(player.target.position);
    targetRing.position.y = 0.06;
    const size = player.target.type === 'boss' ? 1.7 : player.target.type === 'brute' ? 1.35 : 1;
    targetRing.scale.setScalar(size * (1 + Math.sin(visualTime * 4) * 0.04));
  } else targetRing.visible = false;
  if (destinationLife > 0) {
    destinationLife -= dt;
    destinationRing.material.opacity = destinationLife * 0.9;
    destinationRing.scale.setScalar(1 + (1 - destinationLife) * 0.5);
  } else destinationRing.visible = false;
}
function updateEnemies(dt) {
  for (let i = enemies.length - 1; i >= 0; i--) {
    const enemy = enemies[i];
    if (enemy.mode === 'dead') {
      enemy.deathAge += dt;
      const p = enemy.deathAge / 1.15;
      enemy.position.addScaledVector(enemy.velocity, dt);
      enemy.velocity.multiplyScalar(Math.exp(-4 * dt));
      enemy.model.position.x = enemy.position.x;
      enemy.model.position.z = enemy.position.z;
      const fall = Math.min(1.55, p * 3.4);
      enemy.model.rotation.x = Math.cos(enemy.reactionYaw) * fall;
      enemy.model.rotation.z = -Math.sin(enemy.reactionYaw) * fall;
      enemy.model.position.y = Math.sin(Math.min(1, p * 2) * Math.PI) * .65 - Math.max(0, p - .5) * 1.3;
      setModelAppearance(enemy.model, 0, Math.max(0, 1 - p));
      if (p >= 1) { disposeEnemy(enemy); enemies.splice(i, 1); }
      continue;
    }
    enemy.flash = Math.max(0, enemy.flash - dt);
    enemy.reactionAge += dt;
    enemy.stun = Math.max(0, enemy.stun - dt);
    enemy.frost = Math.max(0, enemy.frost - dt);
    const localDt = dt * (enemy.frost > 0 ? 0.44 : 1);
    enemy.attackCooldown = Math.max(0, enemy.attackCooldown - localDt);
    enemy.position.addScaledVector(enemy.velocity, dt);
    enemy.velocity.multiplyScalar(Math.exp(-7 * dt));
    clampPosition(enemy.position, 0.8);
    const difference = temp.copy(player.position).sub(enemy.position).setY(0);
    const distance = difference.length();
    const direction = difference.clone().normalize();
    let walking = false;
    if (enemy.mode === 'spawn') {
      enemy.timer -= dt;
      setModelAppearance(enemy.model, 0, Math.min(1, (0.58 - enemy.timer) * 3));
      if (enemy.timer <= 0) enemy.mode = 'chase';
    } else if (enemy.stun <= 0) {
      if (enemy.mode === 'windup') {
        enemy.timer -= localDt;
        enemy.telegraph.position.copy(enemy.type === 'archer' ? enemy.shotAim : enemy.aim);
        enemy.telegraph.position.y = 0.02;
        const anticipation = 1 - enemy.timer / enemy.windupDuration;
        enemy.warningDisk.material.opacity = .1 + anticipation * .22;
        enemy.warningOutline.material.opacity = .4 + anticipation * .5;
        enemy.warningOutline.scale.setScalar(.5 + anticipation * .5);
        if (enemy.type === 'boss' && enemy.attackKind === 'slam' && anticipation > ENEMY_CLIPS.boss.anticipation) {
          const toAim = enemy.aim.clone().sub(enemy.position).setY(0);
          if (toAim.length() > .55) enemy.position.addScaledVector(toAim.normalize(), localDt * 7);
        }
        if (enemy.timer <= 0) {
          if (enemy.type === 'archer') shootEnemy(enemy);
          else {
            const boss = enemy.type === 'boss';
            const sweep = boss && enemy.attackKind === 'sweep';
            const radius = boss ? (sweep ? 4.25 : 2.85) : enemy.type === 'brute' ? 2.3 : 1.75;

            effects.dust?.(enemy.aim, direction, boss ? 1.8 : .55);
            if (boss) {
              audio.play('boss');
              if (!sweep) effects.ring(enemy.aim, radius, 0xe99665, .4);
            }
            if (player.position.distanceTo(enemy.aim) < radius) hurtPlayer(stats[enemy.type].damage + (boss && !sweep ? 5 : 0), enemy.position);
          }
          enemy.mode = 'recover';
          enemy.recoverDuration = enemy.type === 'boss' ? (enemy.attackKind === 'slam' ? 1.12 : .9) : .58;
          enemy.timer = enemy.recoverDuration;
          enemy.attackCooldown = stats[enemy.type].interval;
          enemy.telegraph.visible = false;
        }
      } else if (enemy.mode === 'recover') {
        enemy.timer -= localDt;
        if (enemy.timer <= 0) enemy.mode = 'chase';
      } else {
        enemy.yaw = Math.atan2(direction.x, direction.z);
        const reach = enemy.type === 'archer' ? 9.5 : stats[enemy.type].reach + 0.05;
        if (distance < reach && enemy.attackCooldown <= 0) {
          enemy.mode = 'windup';
          enemy.attacks++;
          enemy.attackKind = enemy.type === 'boss' && enemy.attacks % 2 === 0 ? 'sweep' : 'slam';
          enemy.windupDuration = stats[enemy.type].windup + (enemy.type === 'boss' && enemy.attackKind === 'slam' ? .24 : 0);
          enemy.timer = enemy.windupDuration;
          enemy.aim.copy(enemy.type === 'boss' && enemy.attackKind === 'slam' ? player.position : enemy.position);
          enemy.telegraph.scale.setScalar(enemy.type === 'boss' && enemy.attackKind === 'slam' ? 2.85 / 4.25 : 1);
          enemy.warningDisk.material.color.setHex(enemy.type === 'boss' && enemy.attackKind === 'sweep' ? 0xcf7930 : 0xc54730);
          if (enemy.type === 'boss') showToast(enemy.attackKind === 'slam' ? '尸将 · 重砸　离开红圈' : '尸将 · 旋扫　拉开距离', 1.25);
          if (enemy.type !== 'boss' && enemy.type !== 'archer') enemy.aim.addScaledVector(direction, 0.6);
          enemy.shotAim.copy(player.position);
          enemy.telegraph.visible = true;
          if (enemy.type === 'archer') enemy.telegraph.scale.setScalar(0.34);
        } else if (enemy.type === 'archer' && distance < 4.4) {
          enemy.position.addScaledVector(direction, -stats[enemy.type].speed * localDt);
          walking = true;
        } else if (distance > (enemy.type === 'archer' ? 7.5 : stats[enemy.type].reach * 0.77)) {
          const pursuit = direction.clone();
          steerMovement(enemy.position, pursuit, enemy, player.position);
          enemy.position.addScaledVector(pursuit, stats[enemy.type].speed * localDt);
          enemy.yaw = Math.atan2(pursuit.x, pursuit.z);
          walking = true;
        }
      }
    }
    // Soft separation keeps a crowd readable without blocking the warrior's path.
    for (const other of enemies) {
      if (other.id <= enemy.id || other.hp <= 0) continue;
      const separation = temp2.copy(enemy.position).sub(other.position).setY(0);
      const dist = separation.length();
      const minimum = enemy.type === 'boss' || other.type === 'boss' ? 1.7 : 0.95;
      if (dist < minimum && dist > 0.01) {
        separation.multiplyScalar((minimum - dist) / dist * dt * 1.6);
        enemy.position.add(separation);
        other.position.sub(separation);
      }
    }
    clampPosition(enemy.position, 0.75);
    enemy.model.rotation.y = enemy.yaw;
    enemy.walk = THREE.MathUtils.damp(enemy.walk, walking ? 1 : 0, 10, dt);
    animateCharacter(enemy.model, enemy.walk, null, visualTime + enemy.id * 0.2, dt, false, enemy);
    const clip = ENEMY_CLIPS[enemy.type];
    const bladeActive = enemy.type !== 'archer' && enemy.stun <= 0 &&
      (enemy.mode === 'windup' && 1 - enemy.timer / enemy.windupDuration >= clip.anticipation ||
       enemy.mode === 'recover' && 1 - enemy.timer / enemy.recoverDuration <= clip.follow);
    effects.weaponTrail(enemy.model.userData.rig.weapon, enemy, bladeActive, 0xe99b76);
    if (enemy.mode !== 'spawn') setModelAppearance(enemy.model, enemy.flash, 1, enemy.frost);
    enemy.healthBar.visible = enemy.type === 'boss' || enemy.hp < enemy.maxHp || player.target === enemy;
    enemy.healthBar.position.copy(enemy.position);
    enemy.healthBar.position.y = enemy.type === 'boss' ? 3.85 : enemy.type === 'brute' ? 3.45 : 2.95;
    enemy.healthBar.quaternion.copy(camera.quaternion);
    const ratio = enemy.hp / enemy.maxHp;
    enemy.healthFill.scale.x = Math.max(0.001, ratio);
    enemy.healthFill.position.x = -(1 - ratio) * enemy.healthBar.userData.width / 2;
  }
}
function updateProjectiles(dt) {
  for (let i = projectiles.length - 1; i >= 0; i--) {
    const projectile = projectiles[i];
    projectile.age += dt;
    projectile.mesh.position.addScaledVector(projectile.direction, projectile.speed * dt);
    let remove = projectile.age > projectile.life;
    if (projectile.friendly) {
      projectile.mesh.rotation.z += dt * 18;
      for (const enemy of enemies) {
        if (enemy.hp <= 0 || projectile.hits.has(enemy.id)) continue;
        const flatDistance = (enemy.position.x - projectile.mesh.position.x) ** 2 + (enemy.position.z - projectile.mesh.position.z) ** 2;
        if (flatDistance < (enemy.type === 'boss' ? 1.5 : 0.9) ** 2) {
          projectile.hits.add(enemy.id);
          hitEnemy(enemy, projectile.damage, 3.3, gold, projectile, projectile.direction);
        }
      }
    } else {
      const distance = (player.position.x - projectile.mesh.position.x) ** 2 + (player.position.z - projectile.mesh.position.z) ** 2;
      if (distance < 0.65 ** 2) {
        hurtPlayer(projectile.damage, projectile.source);
        remove = true;
      }
    }
    if (Math.abs(projectile.mesh.position.x) > maxX + 2 || Math.abs(projectile.mesh.position.z) > maxZ + 2) remove = true;
    if (remove) { clearProjectile(projectile); projectiles.splice(i, 1); }
  }
}
function updatePickups(dt) {
  for (let i = pickups.length - 1; i >= 0; i--) {
    const pickup = pickups[i];
    pickup.age += dt;
    const distance = Math.hypot(pickup.mesh.position.x - player.position.x, pickup.mesh.position.z - player.position.z);
    pickup.mesh.rotation.y += dt * 2.5;
    pickup.mesh.position.y = 0.6 + Math.sin(pickup.age * 4) * 0.13;
    if (distance < 3.1 && pickup.age > 0.25) {
      temp.copy(player.position).sub(pickup.mesh.position).setY(0).normalize();
      pickup.mesh.position.addScaledVector(temp, dt * 7);
    }
    if (distance < 0.65) {
      if (pickup.type === 'health') {
        state.hp = Math.min(100, state.hp + 15);
        effects.label(player.position, '+15', '#adf2c3', 24);
      } else {
        state.sp = Math.min(100, state.sp + 8);
        state.souls += 2;
      }
      audio.play('pickup');
      clearPickup(pickup);
      pickups.splice(i, 1);
    } else if (pickup.age > pickup.life) { clearPickup(pickup); pickups.splice(i, 1); }
  }
}
function updateGame(dt, realDt) {
  state.elapsed += realDt;
  state.sp = Math.min(100, state.sp + dt * 9);
  state.finisherCooldown = Math.max(0, state.finisherCooldown - realDt);
  for (const name of Object.keys(state.cooldowns)) state.cooldowns[name] = Math.max(0, state.cooldowns[name] - realDt);
  state.comboTimeout -= realDt;
  if (state.comboTimeout <= 0) state.combo = 0;
  while (spawnSchedule.length && spawnSchedule[0].at <= state.elapsed) {
    const spawn = spawnSchedule.shift();
    spawnEnemy(spawn.type, spawn.index);
  }
  updatePlayer(dt);
  updateEnemies(dt);
  updateProjectiles(dt);
  updatePickups(dt);
  if (state.phase !== 'running') return;
  if (!spawnSchedule.length && !enemies.some(enemy => enemy.hp > 0)) {
    if (waveTimer === null) {
      waveTimer = 2.6;
      if (state.wave < waves.length) {
        state.hp = Math.min(100, state.hp + 10);
        state.sp = Math.min(100, state.sp + 20);
        showToast('此波已清 · 恢复生命与气力', 2.4);
      }
    }
    waveTimer -= realDt;
    if (waveTimer <= 0) {
      if (state.wave < waves.length) beginWave(state.wave + 1);
      else finishGame(true);
    }
  }
}
function formatTime(seconds) {
  const time = Math.floor(seconds);
  return `${Math.floor(time / 60).toString().padStart(2, '0')}:${(time % 60).toString().padStart(2, '0')}`;
}
function updateUI(force = false) {
  if (!state) return;
  setText('health-value', `${Math.ceil(state.hp)} / 100`);
  if ($('health-fill')) { $('health-fill').style.width = `${state.hp}%`; $('health-fill').parentElement?.setAttribute('aria-valuenow', String(Math.ceil(state.hp))); }
  setText('sp-value', `${Math.floor(state.sp)} / 100`);
  if ($('sp-fill')) $('sp-fill').style.width = `${state.sp}%`;
  setText('wave-value', `${Math.max(1, state.wave)} / 3`);
  setText('kill-value', state.kills);
  setText('soul-value', state.souls);
  setText('elapsed-value', formatTime(state.elapsed));
  if ($('combo-value')) $('combo-value').hidden = state.combo < 2;
  setText('combo-count', state.combo);
  $('stage-markers')?.querySelectorAll('i').forEach((marker, index) => {
    marker.classList.toggle('active', index === Math.max(0, state.wave - 1));
    marker.classList.toggle('cleared', index < state.wave - 1 || state.phase === 'victory');
  });
  setText('objective-value', state.phase === 'victory' ? '山门已清' : state.phase === 'defeat' ? '再战山门' : state.wave === 3 ? '击败尸将 · 清退亡灵' : '清退三波亡灵');
  setText('status-label', state.paused ? '已暂停' : state.phase === 'ready' ? '等待出征' : state.phase === 'victory' ? '关卡完成' : state.phase === 'defeat' ? '战败' : state.wave === 3 ? '最后一战' : '战斗中');
  for (const [name, info] of Object.entries(skillInfo)) {
    const button = $(`skill-${name}`);
    if (!button) continue;
    const remaining = state.cooldowns[name];
    const cooling = remaining > 0;
    const unavailable = state.sp < info.cost;
    button.disabled = state.phase !== 'running' || state.paused || cooling || unavailable;
    button.classList.toggle('cooling', cooling);
    button.classList.toggle('no-energy', unavailable);
    button.style.setProperty('--cooldown', `${remaining / info.cooldown * 100}%`);
    button.style.setProperty('--cooldown-progress', String(remaining / info.cooldown));
    button.setAttribute('aria-label', `${info.label}，${info.key}，${cooling ? `冷却 ${Math.ceil(remaining)} 秒` : `消耗 ${info.cost} 气力`}`);
    const label = button.querySelector('.cooldown');
    if (label) label.textContent = cooling ? `${Math.ceil(remaining)}s` : '';
  }
  if ($('pause-button')) $('pause-button').disabled = state.phase !== 'running';
  if ($('audio-button')) {
    $('audio-button').setAttribute('aria-pressed', String(audio.enabled));
    $('audio-button').dataset.muted = String(!audio.enabled);
    $('audio-button').setAttribute('aria-label', audio.enabled ? '关闭声音' : '开启声音');
  }
}
function pointerWorld(clientX, clientY) {
  const ndc = landscape.clientToNDC(clientX, clientY, canvas);
  pointerNDC.set(ndc.x, ndc.y);
  raycaster.setFromCamera(pointerNDC, camera);
  const point = new THREE.Vector3();
  return raycaster.ray.intersectPlane(floorPlane, point) ? point : null;
}
function pointerEnemy(clientX, clientY) {
  const ndc = landscape.clientToNDC(clientX, clientY, canvas);
  pointerNDC.set(ndc.x, ndc.y);
  raycaster.setFromCamera(pointerNDC, camera);
  const live = enemies.filter(enemy => enemy.hp > 0);
  const hits = raycaster.intersectObjects(live.map(enemy => enemy.model), true);
  if (hits.length) {
    const id = hits[0].object.userData.enemyId;
    const enemy = live.find(item => item.id === id);
    if (enemy) return enemy;
  }
  const point = pointerWorld(clientX, clientY);
  if (!point) return null;
  let closest = null;
  let distance = 1.35;
  for (const enemy of live) {
    const d = enemy.position.distanceTo(point);
    if (d < distance) { closest = enemy; distance = d; }
  }
  return closest;
}
function dispatchHeavy(pointer) {
  if (state.phase !== 'running' || state.paused) return;
  pointer.long = true;
  const target = pointerEnemy(pointer.startX, pointer.startY);
  if (target) setTarget(target, true);
  else {
    const point = pointerWorld(pointer.startX, pointer.startY);
    if (point) {
      player.destination = null;
      player.target = null;
      const enemy = nearestEnemy(3.2);
      if (!enemy) player.yaw = Math.atan2(point.x - player.position.x, point.z - player.position.z);
      beginAttack(enemy, true);
    }
  }
  showToast('蓄力 · EX重击', 1);
}
canvas.addEventListener('pointerdown', event => {
  if (state.phase !== 'running' || state.paused || event.button > 0) return;
  event.preventDefault();
  audio.unlock();
  canvas.setPointerCapture?.(event.pointerId);
  heldPointer = { id: event.pointerId, startX: event.clientX, startY: event.clientY, x: event.clientX, y: event.clientY, startTime: performance.now(), moved: false, long: false };
});
canvas.addEventListener('pointermove', event => {
  if (!heldPointer || event.pointerId !== heldPointer.id) return;
  heldPointer.x = event.clientX;
  heldPointer.y = event.clientY;
  if (Math.hypot(event.clientX - heldPointer.startX, event.clientY - heldPointer.startY) > 18) heldPointer.moved = true;
});
canvas.addEventListener('pointerup', event => {
  if (!heldPointer || event.pointerId !== heldPointer.id) return;
  event.preventDefault();
  const pointer = heldPointer;
  heldPointer = null;
  if (canvas.hasPointerCapture?.(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
  if (state.phase !== 'running' || state.paused || pointer.long) return;
  const displacement = Math.hypot(event.clientX - pointer.startX, event.clientY - pointer.startY);
  const duration = performance.now() - pointer.startTime;
  if (displacement > 75 && duration < 900) {
    const from = pointerWorld(pointer.startX, pointer.startY);
    const to = pointerWorld(event.clientX, event.clientY);
    if (from && to) useFinisher(to.sub(from).normalize());
    return;
  }
  if (pointer.moved) return;
  if (duration >= 500) { dispatchHeavy(pointer); return; }
  const target = pointerEnemy(event.clientX, event.clientY);
  const point = pointerWorld(event.clientX, event.clientY);
  if (!point) return;
  const now = performance.now() / 1000;
  if (!target && now - lastTapTime < 0.32 && point.distanceTo(lastTapPoint) < 2.4) {
    roll(directionTo(point));
    lastTapTime = -10;
  } else {
    if (target) setTarget(target);
    else setDestination(point);
    lastTapTime = now;
    lastTapPoint.copy(point);
  }
});
canvas.addEventListener('pointercancel', () => { heldPointer = null; });
canvas.addEventListener('contextmenu', event => event.preventDefault());
window.addEventListener('keydown', event => {
  if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) return;
  const keySkills = { KeyQ: 'dash', KeyE: 'whirl', KeyR: 'burst', KeyF: 'frost', KeyC: 'blades' };
  if (event.code === 'Escape') {
    event.preventDefault();
    if (event.repeat) return;
    if ($('help-panel') && !$('help-panel').hidden) { $('help-panel').hidden = true; return; }
    if (state.paused) resumeGame(); else pauseGame();
    return;
  }
  if (state.phase !== 'running' || state.paused) return;
  if (['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space', ...Object.keys(keySkills)].includes(event.code)) event.preventDefault();
  if (!event.repeat && keySkills[event.code]) useSkill(keySkills[event.code]);
  else if (!event.repeat && event.code === 'Space') {
    const move = new THREE.Vector3();
    if (input.has('KeyW')) move.add(new THREE.Vector3(-0.655, 0, -0.756));
    if (input.has('KeyS')) move.add(new THREE.Vector3(0.655, 0, 0.756));
    if (input.has('KeyD')) move.add(new THREE.Vector3(0.756, 0, -0.655));
    if (input.has('KeyA')) move.add(new THREE.Vector3(-0.756, 0, 0.655));
    roll(move.lengthSq() > 0 ? move.normalize() : new THREE.Vector3(Math.sin(player.yaw), 0, Math.cos(player.yaw)));
  }
  input.add(event.code);
});
window.addEventListener('keyup', event => input.delete(event.code));
window.addEventListener('blur', pauseGame);
document.addEventListener('visibilitychange', () => { if (document.hidden) pauseGame(); });
const bind = (id, fn) => $(id)?.addEventListener('click', event => { event.preventDefault(); fn(); });
bind('start-button', startGame);
bind('pause-button', pauseGame);
bind('resume-button', resumeGame);
bind('restart-button', startGame);
bind('result-restart', startGame);
bind('audio-button', () => {
  audio.unlock();
  audio.toggle();
  updateUI(true);
});
for (const name of Object.keys(skillInfo)) bind(`skill-${name}`, () => useSkill(name));
bind('help-button', () => {
  const panel = $('help-panel');
  if (!panel) return;
  panel.hidden = !panel.hidden;
  $('help-button')?.setAttribute('aria-expanded', String(!panel.hidden));
  if (!panel.hidden && state.phase === 'running' && !state.paused) pauseGame();
});
bind('help-close', () => { if ($('help-panel')) $('help-panel').hidden = true; });
function applyProjection() {
  camera.left = -cameraViewHeight * viewportAspect / 2;
  camera.right = cameraViewHeight * viewportAspect / 2;
  camera.top = cameraViewHeight / 2;
  camera.bottom = -cameraViewHeight / 2;
  camera.updateProjectionMatrix();
}
function resize() {
  const { width, height } = landscape.getViewport();
  viewportAspect = width / height;
  const compact = height <= 540;
  cameraViewHeight = state?.phase === 'ready' || !state ? (compact ? 22 : 25) : compact ? 17.8 : 21;
  applyProjection();
  renderer.setSize(width, height);
}
function updateCamera(dt, now) {
  const runningView = state.phase !== 'ready';
  const cinematic = player.action?.type === 'finisher' ? 1.1 : 0;
  const compact = landscape.getViewport().height <= 540;
  const targetHeight = (runningView ? (compact ? 17.8 : 21) : compact ? 22 : 25) - cameraPunch - cinematic;
  const nextHeight = THREE.MathUtils.damp(cameraViewHeight, targetHeight, 5.5, dt);
  if (Math.abs(nextHeight - cameraViewHeight) > .002) {
    cameraViewHeight = nextHeight;
    applyProjection();
  }
  if (runningView) cameraFocusTarget.set(THREE.MathUtils.clamp(player.position.x, minX + 4.5, maxX - 4.5), .35, THREE.MathUtils.clamp(player.position.z, minZ + 4.5, maxZ - 4.5));
  else cameraFocusTarget.set(0, .4, -4);
  if (!state.paused) {
    cameraFocus.x = THREE.MathUtils.damp(cameraFocus.x, cameraFocusTarget.x, 5.5, dt);
    cameraFocus.y = THREE.MathUtils.damp(cameraFocus.y, cameraFocusTarget.y, 5.5, dt);
    cameraFocus.z = THREE.MathUtils.damp(cameraFocus.z, cameraFocusTarget.z, 5.5, dt);
  }
  camera.position.copy(cameraHome).add(cameraFocus).add(cameraKick);
  if (shake > .005 && !state.paused) {
    camera.position.x += Math.sin(now * .09) * shake;
    camera.position.y += Math.cos(now * .077) * shake * .3;
    camera.position.z += Math.sin(now * .067) * shake;
  }
  camera.lookAt(cameraFocus);
}
window.addEventListener('resize', resize);
resize();
resetGame();
if ($('start-screen')) $('start-screen').hidden = false;
function frame(now) {
  requestAnimationFrame(frame);
  // Process slow devices in bounded substeps, preserving time rather than slowing combat.
  const realDt = Math.min(Math.max((now - frameTime) / 1000, 0), 0.20);
  frameTime = now;
  if (!state.paused) {
    visualTime += realDt;
    world?.update?.(realDt, visualTime);
    if (state.phase === 'running') {
      if (heldPointer && !heldPointer.moved && !heldPointer.long && now - heldPointer.startTime >= 500) dispatchHeavy(heldPointer);
      const steps = Math.max(1, Math.ceil(realDt / 0.04));
      const stepDt = realDt / steps;
      for (let step = 0; step < steps; step++) {
        impactCooldown = Math.max(0, impactCooldown - stepDt);
        let simulationDt = stepDt;
        if (slowMotion > 0) {
          slowMotion = Math.max(0, slowMotion - stepDt);
          simulationDt *= .48;
        }
        if (hitstop > 0) {
          hitstop = Math.max(0, hitstop - stepDt);
          simulationDt *= 0.06;
        }
        if (state.phase === 'running') updateGame(simulationDt, stepDt);
        effects.update(simulationDt);
      }
    } else {
      if (state.phase === 'ready') player.model.rotation.y = .72;
      animateCharacter(player.model, 0, null, visualTime, realDt, true);
      setModelAppearance(player.model, 0);
      player.model.visible = true;
      playerRing.position.copy(player.position);
      playerRing.position.y = 0.035;
      effects.update(realDt);
    }
    shake *= Math.exp(-15 * realDt);
    cameraKick.multiplyScalar(Math.exp(-12 * realDt));
    cameraPunch *= Math.exp(-7 * realDt);
    toastTimer -= realDt;
    if (toastTimer <= 0 && $('toast')) { $('toast').hidden = true; $('toast').classList.remove('visible'); }
  }
  updateCamera(realDt, now);
  uiTimer += realDt;
  if (uiTimer > 0.075) { uiTimer = 0; updateUI(); }
  renderer.render(scene, camera);
}
requestAnimationFrame(frame);

// Read-only inspection and real controls for browser automation, without cheat actions.
const api = {
  start: startGame, restart: startGame, pause: pauseGame, resume: resumeGame,
  snapshot: () => ({
    phase: state.phase, hp: Math.round(state.hp * 10) / 10, sp: Math.round(state.sp * 10) / 10,
    wave: state.wave, kills: state.kills, combo: state.combo, maxCombo: state.maxCombo,
    elapsed: Math.round(state.elapsed * 100) / 100, paused: state.paused, souls: state.souls,
    hits: state.hits, stars: state.stars, enemies: enemies.filter(enemy => enemy.hp > 0).length,
    playerPosition: { x: player.position.x, z: player.position.z },
    cooldowns: { ...state.cooldowns },
    action: player.action?.type || null, actionProgress: player.action ? player.action.age / player.action.duration : 0,
    pose: Object.fromEntries(Object.entries(player.model.userData.rig || {}).filter(([_,o])=>o?.rotation).map(([k,o])=>[k,{x:o.rotation.x,y:o.rotation.y,z:o.rotation.z}])),
    actionDuration: player.action?.duration || 0, actionContact: player.action?.clip?.contact ?? null,
    actionStep: player.action?.step ?? null, actionPulse: player.action?.pulse || 0,
    hurtTimer: player.hurtTimer, hurtDuration: player.hurtDuration, reactionYaw: player.reactionYaw,
    weaponTrailSegments: effects.ribbonLive.length, impactSerial,
    cameraHeight: cameraViewHeight, hitstop, slowMotion,
    renderInfo: { calls: renderer.info.render.calls, triangles: renderer.info.render.triangles, geometries: renderer.info.memory.geometries, textures: renderer.info.memory.textures }, targetId: player.target?.id || null,
    rollCooldown: player.rollCooldown, finisherCooldown: state.finisherCooldown, effects: effects.effects.length + effects.sparkLive.length + effects.ribbonLive.length,
  }),
  enemyPositions: () => enemies.filter(enemy => enemy.hp > 0).map(enemy => ({ id: enemy.id, type: enemy.type, hp: enemy.hp, mode: enemy.mode, attackKind: enemy.attackKind, telegraph: enemy.telegraph.visible, x: enemy.position.x, z: enemy.position.z })),
  screenToWorld: (x, y) => { const point = pointerWorld(x, y); return point ? { x: point.x, z: point.z } : null; },
  worldToScreen: (x, z) => {
    const point = typeof x === 'object' ? new THREE.Vector3(x.x, x.y || 0, x.z) : new THREE.Vector3(x, 0, z);
    point.project(camera);
    return landscape.ndcToClient(point.x, point.y, canvas);
  },
};
Object.defineProperty(api, 'viewport', { get: () => Object.freeze({ width: canvas.clientWidth, height: canvas.clientHeight }) });
Object.defineProperty(window, '__undeadSlayer', { value: Object.freeze(api), writable: false, configurable: false });
