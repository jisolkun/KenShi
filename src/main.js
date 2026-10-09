import * as THREE from "three";
import { createCharacter, poseCharacter } from "./characters.js";
import { createWorld } from "./world.js";
import { createUI } from "./ui.js";
import { createAudio } from "./audio.js";
import { createEffects } from "./effects.js";
import { requestMobileFullscreen } from "./fullscreen.js";
import { WEAPONS, getWeapon, DEFAULT_WEAPON_ID, isWeaponUnlocked } from "./weapons.js";
import { createWeaponEffects } from "./weaponEffects.js";
import { weaponStrikeContains, bladeSweepContains } from "./weaponCombat.js";
import { getReviewedAttack, sampleReviewedAttack } from "./choreography/index.js";
import { isCombatTarget, attackDistances, chooseAttackTarget, attackCanTrack,
  attackRecoveryPhase, attackChainPhase, segmentClear, planObstaclePath, projectWalkablePoint } from "./heroAI.js";
import "./style.css";

const app = document.querySelector("#app") || document.body;
const canvas = document.createElement("canvas");
canvas.className = "game-canvas";
canvas.setAttribute("aria-label", "亡灵杀手战场，点击移动与追击，双击翻滚");
app.prepend(canvas);
let renderer;
try {
  renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: true,
    alpha: false,
    powerPreference: "high-performance",
  });
} catch (error) {
  app.innerHTML =
    '<main class="webgl-fallback"><h1>无法开启这片战场</h1><p>请启用浏览器硬件加速，或使用支持 WebGL 的浏览器。</p><button onclick="location.reload()">重新尝试</button></main>';
  throw error;
}
renderer.setPixelRatio(Math.min(devicePixelRatio, 1.7));
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.16;
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x87958b);
scene.fog = new THREE.Fog(0x8b9a8e, 35, 85);
// Estimated from original gameplay screenshots; these are our tuning values.
const cameraSettings = {
  yaw: Math.PI / 4,
  pitch: THREE.MathUtils.degToRad(58),
  span: 11.2,
  distance: 36,
};
const camera = new THREE.OrthographicCamera(-10, 10, 5.6, -5.6, 0.1, 100);
const cameraRight = new THREE.Vector3(
  Math.cos(cameraSettings.yaw),
  0,
  -Math.sin(cameraSettings.yaw),
);
const cameraBack = new THREE.Vector3(
  Math.sin(cameraSettings.yaw),
  0,
  Math.cos(cameraSettings.yaw),
);
const cameraOffset = new THREE.Vector3(
  Math.sin(cameraSettings.yaw) * Math.cos(cameraSettings.pitch),
  Math.sin(cameraSettings.pitch),
  Math.cos(cameraSettings.yaw) * Math.cos(cameraSettings.pitch),
).multiplyScalar(cameraSettings.distance);
function resizeCamera() {
  const halfHeight = cameraSettings.span / 2;
  const halfWidth = (halfHeight * innerWidth) / innerHeight;
  camera.left = -halfWidth;
  camera.right = halfWidth;
  camera.top = halfHeight;
  camera.bottom = -halfHeight;
  camera.updateProjectionMatrix();
}
resizeCamera();
const hemi = new THREE.HemisphereLight(0xd9e7df, 0x3b3830, 2.0);
scene.add(hemi);
const sun = new THREE.DirectionalLight(0xffd49b, 3.3);
sun.position.set(-12, 21, -9);
sun.castShadow = true;
sun.shadow.mapSize.set(
  innerWidth < 700 ? 1024 : 1536,
  innerWidth < 700 ? 1024 : 1536,
);
sun.shadow.camera.left = -26;
sun.shadow.camera.right = 26;
sun.shadow.camera.top = 24;
sun.shadow.camera.bottom = -24;
sun.shadow.camera.far = 70;
sun.shadow.bias = -0.0004;
sun.shadow.normalBias = 0.03;
scene.add(sun);
const rim = new THREE.DirectionalLight(0xc4e1e6, 1.2);
rim.position.set(8, 8, 17);
scene.add(rim);
const world = createWorld(scene);
const audio = createAudio();
const fx = createEffects(scene, camera);
const weaponFx = createWeaponEffects(scene, fx);
let storedWeaponId = DEFAULT_WEAPON_ID;
try { storedWeaponId = localStorage.getItem("undead-slayer-weapon") || DEFAULT_WEAPON_ID; } catch {}
let currentWeapon = getWeapon(isWeaponUnlocked(storedWeaponId) ? storedWeaponId : DEFAULT_WEAPON_ID);
let weaponWarmGeneration = 0;
const rig = createCharacter("hero");
rig.setWeapon(currentWeapon.id);
scene.add(rig.group);
const hero = {
  rig,
  weaponId: currentWeapon.id,
  previewAge: Infinity,
  previewContact: -1,
  pos: new THREE.Vector3(0, 0, 4),
  velocity: new THREE.Vector3(), // External knockback, separate from locomotion.
  moveVelocity: new THREE.Vector3(),
  gaitPhase: 0,
  moveBlend: 0,
  turnLean: 0,
  attackCarry: 0,
  localHitStop: 0,
  attackHits: new Set(),
  strokeContacts: new Set(),
  reviewedPrevious: null,
  trailSeries: 0,
  impactDone: false,
  globalImpactDone: false,
  nextAttackIn: 0,
  transition: { from: "idle", to: "idle", age: 1, duration: 0.08 },
  poseState: "idle",
  poseCombo: 0,
  idleAge: 0,
  combatAge: 10,
  alertness: 0.18,
  lookYaw: 0,
  angle: Math.PI,
  state: "idle",
  elapsed: 0,
  duration: 0,
  combo: 0,
  comboTimer: 0,
  hitDone: false,
  invulnerable: 0,
  flash: 0,
  hp: 120,
  maxHp: 120,
  stamina: 100,
  target: null,
  attackTarget: null,
  navigation: null,
  attackEndRendered: false,
  destination: null,
  disengage: 0,
  rollDirection: new THREE.Vector3(),
  ghostTimer: 0,
};
const metrics = { taps: 0, rolls: 0 };
let mode = "start",
  gameTime = 0,
  globalTime = 0,
  presentationTime = 0,
  wave = 1,
  kills = 0,
  hits = 0,
  combo = 0,
  comboTimeout = 0,
  waveTimer = -1,
  total = 36,
  shake = 0,
  hitStop = 0,
  slowTime = 0,
  slowScale = 1,
  sound = true,
  nextId = 1,
  arrowTime = 0;
let enemies = [],
  projectiles = [],
  drops = [];
let attackDurations = currentWeapon.moves.map(move => move.duration);
let attackWindows = currentWeapon.moves.map(move => move.active);
let attackContacts = currentWeapon.moves.map(move => move.contact);
let shakeAge = 1,
  shakeNext = 0;
const shakeDirection = new THREE.Vector3();
let attackDamages = currentWeapon.moves.map(move => move.damage);
let attackRanges = currentWeapon.moves.map(move => move.reach);
const raycaster = new THREE.Raycaster(),
  pointer = new THREE.Vector2(),
  ground = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
const cameraFocus = new THREE.Vector3(0, 0, 2),
  temp = new THREE.Vector3(),
  temp2 = new THREE.Vector3();
const keys = new Set();
const damageQueue = [];
const ui = createUI({
  start: startGame,
  weapon: selectWeapon,
  chooseWeapon: chooseWeapon,
  mobileEntry: retryMobilePresentation,
  mobileViewRetry: retryMobilePresentation,
  pause: pauseGame,
  resume: resumeGame,
  retry: startGame,
  sound(enabled) {
    sound = enabled;
    audio.setEnabled?.(enabled);
  },
  help() {
    pauseGame("help");
  },
}, currentWeapon.id);
const trails = Array.from({ length: 4 }, () => fx.swordTrail());
const destinationMarker = new THREE.Group();
for (let i = 0; i < 2; i++) {
  const mesh = new THREE.Mesh(
    new THREE.RingGeometry(i ? 0.21 : 0.32, i ? 0.235 : 0.345, 32),
    new THREE.MeshBasicMaterial({
      color: i ? 0xffebc1 : 0xccab78,
      transparent: true,
      opacity: 0.65,
      side: THREE.DoubleSide,
      depthWrite: false,
    }),
  );
  mesh.rotation.x = -Math.PI / 2;
  destinationMarker.add(mesh);
}
destinationMarker.position.y = 0.04;
destinationMarker.visible = false;
scene.add(destinationMarker);
const targetMarker = new THREE.Mesh(
  new THREE.RingGeometry(0.75, 0.8, 40),
  new THREE.MeshBasicMaterial({
    color: 0xe95a3d,
    transparent: true,
    opacity: 0.8,
    side: THREE.DoubleSide,
    depthWrite: false,
  }),
);
targetMarker.rotation.x = -Math.PI / 2;
scene.add(targetMarker);
targetMarker.visible = false;

function safeAudio(name, ...args) {
  audio[name]?.(...args);
}
function face(direction, rate = 0.35) {
  if (direction.lengthSq() < 0.001) return;
  const desired = Math.atan2(direction.x, direction.z);
  hero.angle +=
    Math.atan2(Math.sin(desired - hero.angle), Math.cos(desired - hero.angle)) *
    rate;
}
function keyboardDirection() {
  const horizontal =
    Number(keys.has("d") || keys.has("arrowright")) -
    Number(keys.has("a") || keys.has("arrowleft"));
  const vertical =
    Number(keys.has("s") || keys.has("arrowdown")) -
    Number(keys.has("w") || keys.has("arrowup"));
  return cameraRight
    .clone()
    .multiplyScalar(horizontal)
    .addScaledVector(cameraBack, vertical)
    .normalize();
}
function kickCamera(direction, amount) {
  if (presentationTime < shakeNext && amount <= shake) return;
  shakeNext = presentationTime + 0.065;
  shake = Math.max(shake, amount);
  shakeAge = 0;
  shakeDirection.copy(direction);
  shakeDirection.y = 0;
  if (shakeDirection.lengthSq() < 0.001) shakeDirection.copy(cameraRight);
  shakeDirection.normalize();
}
function locomotion(
  dt,
  direction,
  distance = Infinity,
  maxSpeed = 5.8,
  stoppingDistance = 0,
  turn = true,
) {
  const remaining = Math.max(0, distance - stoppingDistance);
  const desired = direction?.clone().normalize() || new THREE.Vector3();
  const speed = direction ? Math.min(maxSpeed, remaining / 0.09) : 0;
  desired.multiplyScalar(speed);
  const response = speed > hero.moveVelocity.length() ? 24 : 27;
  hero.moveVelocity.lerp(desired, 1 - Math.exp(-dt * response));
  if (hero.moveVelocity.lengthSq() < 0.0025 && speed === 0)
    hero.moveVelocity.set(0, 0, 0);
  const displacement = hero.moveVelocity.clone().multiplyScalar(dt);
  if (direction && distance < Infinity && displacement.length() > remaining) {
    displacement.copy(direction).normalize().multiplyScalar(remaining);
    hero.moveVelocity.copy(displacement).multiplyScalar(dt > 0 ? 1 / dt : 0);
  }
  hero.pos.add(displacement);
  if (turn && direction && direction.lengthSq() > 0.1) {
    const desiredAngle = Math.atan2(direction.x, direction.z);
    const delta = Math.atan2(
      Math.sin(desiredAngle - hero.angle),
      Math.cos(desiredAngle - hero.angle),
    );
    hero.turnLean = THREE.MathUtils.lerp(
      hero.turnLean,
      THREE.MathUtils.clamp(delta * 0.9, -1, 1),
      1 - Math.exp(-dt * 12),
    );
    face(direction, 1 - Math.exp(-dt * 24));
  } else hero.turnLean *= Math.exp(-dt * 12);
}
function routedMovement(destination, stoppingDistance = 0, command = "ground") {
  const delta = destination.clone().sub(hero.pos);
  const distance = delta.length();
  const direction = delta.clone().normalize();
  const direct = { direction, distance, stoppingDistance };
  if (distance <= stoppingDistance) return direct;
  const endpoint = destination.clone().addScaledVector(direction, -stoppingDistance);
  clampPosition(endpoint);
  const endpointDelta = endpoint.clone().sub(hero.pos);
  const obstacles = world.obstacles || [];
  if (segmentClear(hero.pos, endpoint, obstacles, .5)) {
    hero.navigation = null;
    return { direction: endpointDelta.clone().normalize(), distance: endpointDelta.length(), stoppingDistance: 0 };
  }
  let navigation = hero.navigation;
  if (!navigation || navigation.command !== command ||
    navigation.endpoint.distanceTo(endpoint) > .35 ||
    (!navigation.path.length && globalTime >= navigation.retryAt) ||
    (navigation.path.length && !segmentClear(hero.pos, navigation.path[0], obstacles, .5))) {
    navigation = hero.navigation = { command, endpoint: endpoint.clone(),
      path: planObstaclePath(hero.pos, endpoint, obstacles, .5, world.bounds), retryAt: globalTime + .35 };
  }
  while (navigation.path.length > 1 &&
    Math.hypot(navigation.path[0].x - hero.pos.x, navigation.path[0].z - hero.pos.z) < .1 &&
    segmentClear(hero.pos, navigation.path[1], obstacles, .5)) navigation.path.shift();
  const waypoint = navigation.path[0];
  if (!waypoint) return null;
  const detour = new THREE.Vector3(waypoint.x - hero.pos.x, 0, waypoint.z - hero.pos.z);
  return { direction: detour.clone().normalize(), distance: detour.length(), stoppingDistance: 0 };
}
function movementGoal() {
  const keyboard = keyboardDirection();
  if (keyboard.lengthSq() > 0) {
    hero.destination = null;
    hero.target = null;
    hero.navigation = null;
    destinationMarker.visible = false;
    targetMarker.visible = false;
    return { direction: keyboard, distance: Infinity, stoppingDistance: 0 };
  }
  if (hero.destination) {
    const delta = hero.destination.clone().sub(hero.pos);
    const distance = delta.length();
    if (distance < 0.035) {
      hero.pos.copy(hero.destination);
      hero.destination = null;
      hero.moveVelocity.set(0, 0, 0);
      destinationMarker.visible = false;
      return null;
    }
    return routedMovement(hero.destination);
  }
  if (isCombatTarget(hero.target, enemies)) {
    const range = attackDistances(currentWeapon.moves[hero.combo], hero.target.radius,
      !!getReviewedAttack(currentWeapon.id, hero.combo));
    const stoppingDistance = segmentClear(hero.pos, hero.target.pos, world.obstacles) ? range.stop : 0;
    return routedMovement(hero.target.pos, stoppingDistance, `target:${hero.target.id}`);
  }
  return null;
}
function locomotionState() {
  hero.state = hero.moveVelocity.length() > 0.12 ? "run" : "idle";
}
function clampPosition(pos, radius = 0.5) {
  const projected = projectWalkablePoint(pos, world.obstacles, radius, world.bounds);
  pos.x = projected.x;
  pos.z = projected.z;
  pos.y = 0;
}
function move(position, direction, speed, dt, radius = 0.5) {
  position.addScaledVector(direction, speed * dt);
  clampPosition(position, radius);
}
function worldToScreen(position) {
  const p = position.clone().project(camera);
  return {
    x: (p.x * 0.5 + 0.5) * innerWidth,
    y: (-p.y * 0.5 + 0.5) * innerHeight,
    visible: p.z > -1 && p.z < 1 && Math.abs(p.x) <= 1 && Math.abs(p.y) <= 1,
  };
}
function queueDamage(text, position, kind) {
  damageQueue.push({ text, position: position.clone(), kind });
}
function showDamage(entity, amount, kind = "normal") {
  queueDamage(
    String(amount),
    entity.pos
      .clone()
      .add(
        new THREE.Vector3(
          (Math.random() - 0.5) * 0.35,
          entity.type === "boss" ? 3 : 2.1,
          0,
        ),
      ),
    kind,
  );
}
function flushDamage() {
  for (const damage of damageQueue) {
    const p = worldToScreen(damage.position);
    ui.damage(damage.text, p.x, p.y, damage.kind);
  }
  damageQueue.length = 0;
}
function updateAwareness(dt) {
  const idle = hero.state === "idle" && hero.moveVelocity.length() < 0.15;
  hero.idleAge = idle ? hero.idleAge + dt : 0;
  hero.combatAge += dt;
  const threat = nearestEnemy(hero.pos, 8);
  const proximity = threat ? 1 - threat.pos.distanceTo(hero.pos) / 8 : 0;
  const desiredAlert = Math.max(
    0.18,
    proximity,
    Math.max(0, 1 - hero.combatAge / 3.5) * 0.85,
  );
  hero.alertness = THREE.MathUtils.lerp(
    hero.alertness,
    desiredAlert,
    1 - Math.exp(-dt * 4),
  );
  let desiredLook = 0;
  if (idle && threat) {
    const angle =
      Math.atan2(threat.pos.x - hero.pos.x, threat.pos.z - hero.pos.z) -
      hero.angle;
    desiredLook = THREE.MathUtils.clamp(
      Math.atan2(Math.sin(angle), Math.cos(angle)),
      -0.5,
      0.5,
    );
  }
  hero.lookYaw = THREE.MathUtils.lerp(
    hero.lookYaw,
    desiredLook,
    1 - Math.exp(-dt * 3.5),
  );
}
function stateSnapshot() {
  const boss = enemies.find((e) => e.type === "boss" && e.state !== "dead");
  return {
    weaponId: currentWeapon.id,
    weaponName: currentWeapon.name,
    attack: { name: currentWeapon.moves[hero.combo].name, shape: currentWeapon.moves[hero.combo].shape, reach: attackRanges[hero.combo] },
    hp: hero.hp,
    maxHp: hero.maxHp,
    stamina: hero.stamina,
    maxStamina: 100,
    wave,
    progress: kills / total,
    kills,
    total,
    combo,
    time: gameTime,
    bossHp: boss?.hp || 0,
    bossMaxHp: boss?.maxHp || 0,
    sound,
    mode,
    phase: mode,
    clocks: { simulation: globalTime, presentation: presentationTime },
    hits,
    resources: { stamina: hero.stamina },
    inputs: { ...metrics },
    render: {
      drawCalls: renderer.info.render.calls,
      triangles: renderer.info.render.triangles,
    },
    player: {
      weaponId: currentWeapon.id,
      x: hero.pos.x,
      z: hero.pos.z,
      hp: hero.hp,
      stamina: hero.stamina,
      state: hero.state,
      combo: hero.combo,
      speed: hero.moveVelocity.length(),
      velocity: { x: hero.moveVelocity.x, z: hero.moveVelocity.z },
      angle: hero.angle,
      target: hero.target?.id ?? null,
      attackTarget: hero.attackTarget?.id ?? null,
      gait: hero.gaitPhase,
      transition: { ...hero.transition },
    },
    camera: {
      type: "orthographic",
      yaw: THREE.MathUtils.radToDeg(cameraSettings.yaw),
      pitch: THREE.MathUtils.radToDeg(cameraSettings.pitch),
      span: cameraSettings.span,
      horizontalSpan: (cameraSettings.span * innerWidth) / innerHeight,
      focus: { x: cameraFocus.x, z: cameraFocus.z },
    },
    motion: {
      idleAge: hero.idleAge,
      alertness: hero.alertness,
      lookYaw: hero.lookYaw,
      velocity: { x: hero.moveVelocity.x, z: hero.moveVelocity.z },
      speed: hero.moveVelocity.length(),
      gait: hero.gaitPhase,
      moveBlend: hero.moveBlend,
      turnLean: hero.turnLean,
      transition: { ...hero.transition },
      localHitStop: hero.localHitStop,
      destination: hero.destination
        ? { x: hero.destination.x, z: hero.destination.z }
        : null,
    },
    hero: {
      x: hero.pos.x,
      z: hero.pos.z,
      state: hero.state,
      combo: hero.combo,
    },
    enemies: enemies.filter((e) => e.state !== "dead").length,
  };
}
function pauseGame(screen = "pause") {
  if (mode !== "playing") return;
  mode = "pause";
  keys.clear();
  ui.showScreen(screen, stateSnapshot());
}
function resumeGame() {
  if (mode !== "pause") return;
  mode = "playing";
  ui.showScreen("hide");
}
function disposeGroup(group, geometry = true) {
  scene.remove(group);
  group?.traverse((o) => {
    if (o.isMesh) {
      if (geometry) o.geometry?.dispose();
      if (Array.isArray(o.material)) o.material.forEach((m) => m.dispose());
      else o.material?.dispose();
    }
  });
}
function clearDynamic() {
  for (const e of enemies) {
    disposeGroup(e.rig.group, false);
    disposeGroup(e.bar);
  }
  for (const p of projectiles) disposeGroup(p.mesh, false);
  for (const d of drops) disposeGroup(d.mesh, false);
  enemies = [];
  projectiles = [];
  drops = [];
  fx.clear();
  weaponFx.clear();
}
function selectWeapon(id = currentWeapon.id, preview = true) {
  if (!isWeaponUnlocked(id)) return false;
  currentWeapon = getWeapon(id);
  hero.weaponId = currentWeapon.id;
  rig.setWeapon(currentWeapon.id);
  attackDurations = currentWeapon.moves.map(move => move.duration);
  attackWindows = currentWeapon.moves.map(move => move.active);
  attackContacts = currentWeapon.moves.map(move => move.contact);
  attackDamages = currentWeapon.moves.map(move => move.damage);
  attackRanges = currentWeapon.moves.map(move => move.reach);
  hero.combo = 0;
  hero.attackHits.clear();
  hero.previewAge = preview && mode === "start" ? 0 : Infinity;
  hero.reviewedPrevious = null;
  hero.strokeContacts.clear();
  hero.trailSeries++;
  if (mode === "start") hero.angle = cameraSettings.yaw + 0.24;
  hero.previewContact = -1;
  fx.clear();
  weaponFx.clear();
  const width = currentWeapon.id === "great-dao" ? 1.35 : currentWeapon.stats.power >= 4 ? 1.1 : 0.7;
  for (const trail of trails) {
    trail.color = new THREE.Color(currentWeapon.effectColor);
    trail.coreColor = new THREE.Color(currentWeapon.effectAccent);
    trail.widthFactor = width;
  }
  ui.setWeapon(currentWeapon.id);
  warmReviewedWeapon(currentWeapon.id);
  try { localStorage.setItem("undead-slayer-weapon", currentWeapon.id); } catch {}
}
function warmReviewedWeapon(id) {
  const generation=++weaponWarmGeneration;
  const queue=[];
  for(let i=0;i<4;i++){
    const action=getReviewedAttack(id,i);
    if(action)queue.push({state:'attack',i,phase:action.contact});
  }
  const schedule=callback=>window.requestIdleCallback?window.requestIdleCallback(callback,{timeout:500}):setTimeout(callback,30);
  const next=()=>{
    if(generation!==weaponWarmGeneration||!queue.length)return;
    const action=queue.shift();
    sampleReviewedAttack(id,action.i,action.phase,action.state);
    if(queue.length)schedule(next);
  };
  if(queue.length)schedule(next);
}
function chooseWeapon(id = currentWeapon.id) {
  if (!isWeaponUnlocked(id)) return false;
  mode = "start";
  keys.clear();
  clearDynamic();
  damageQueue.length = 0;
  hero.pos.set(0, 0, 4);
  hero.angle = Math.PI;
  hero.state = "idle";
  hero.elapsed = 0;
  hero.duration = 0;
  hero.target = null;
  hero.attackTarget = null;
  hero.navigation = null;
  hero.destination = null;
  hero.velocity.set(0, 0, 0);
  hero.moveVelocity.set(0, 0, 0);
  hero.moveBlend = 0;
  hero.attackCarry = 0;
  hero.flash = 0;
  hero.idleAge = 0;
  hero.combatAge = 10;
  hero.localHitStop = 0;
  hero.rig.setFlash(0);
  destinationMarker.visible = false;
  targetMarker.visible = false;
  selectWeapon(id);
  ui.showScreen("start");
}
function reportMobilePresentation(result) {
  ui.syncMobileDisplay();
  if (!result.entered) {
    ui.notify(result.unsupported
      ? "当前浏览器不支持网页全屏 · 请将游戏添加到手机主屏幕后打开"
      : "浏览器未允许全屏 · 请点击提示按钮重试");
  } else if (!result.landscape) {
    ui.notify("全屏已开启 · 请打开自动旋转并将手机转为横向");
  }
}
function retryMobilePresentation() {
  const request = requestMobileFullscreen();
  if (request) void request.then(reportMobilePresentation);
}
function startGame(weaponId = currentWeapon.id) {
  // Keep the Fullscreen API call at the very start of the trusted start click.
  const mobilePresentationRequest = requestMobileFullscreen();
  audio.unlock?.();
  keys.clear();
  lastTap = null;
  pointerStart = null;
  clearDynamic();
  selectWeapon(isWeaponUnlocked(weaponId) ? weaponId : DEFAULT_WEAPON_ID, false);
  damageQueue.length = 0;
  mode = "playing";
  gameTime = 0;
  Object.keys(metrics).forEach((k) => (metrics[k] = 0));
  kills = 0;
  hits = 0;
  combo = 0;
  comboTimeout = 0;
  wave = 1;
  waveTimer = -1;
  shake = 0;
  hitStop = 0;
  slowTime = 0;
  hero.pos.set(0, 0, 4);
  hero.angle = Math.PI;
  hero.idleAge = 0;
  hero.combatAge = 10;
  hero.alertness = 0.18;
  hero.lookYaw = 0;
  hero.state = "idle";
  hero.elapsed = 0;
  hero.combo = 0;
  hero.comboTimer = 0;
  hero.hp = 120;
  hero.stamina = 100;
  hero.invulnerable = 1.3;
  hero.flash = 0;
  hero.target = null;
  hero.attackTarget = null;
  hero.navigation = null;
  hero.destination = null;
  hero.disengage = 0;
  hero.velocity.set(0, 0, 0);
  hero.moveVelocity.set(0, 0, 0);
  hero.gaitPhase = 0;
  hero.moveBlend = 0;
  hero.turnLean = 0;
  hero.localHitStop = 0;
  hero.nextAttackIn = 0;
  hero.attackHits.clear();
  hero.transition = { from: "idle", to: "idle", age: 1, duration: 0.08 };
  hero.poseState = "idle";
  hero.poseCombo = 0;
  destinationMarker.visible = false;
  targetMarker.visible = false;
  ui.showScreen("hide");
  if (mobilePresentationRequest) void mobilePresentationRequest.then(reportMobilePresentation);
  spawnWave(1);
  ui.notify("第一阵 · 山门尸潮");
  cameraFocus.copy(hero.pos);
}
function finishGame(won) {
  if (mode !== "playing") return;
  mode = won ? "win" : "lose";
  keys.clear();
  hero.destination = null;
  hero.target = null;
  destinationMarker.visible = false;
  ui.showScreen(won ? "win" : "lose", {
    stars: won ? 1 + Number(gameTime <= 180) + Number(hits <= 2) : 0,
    kills,
    time: gameTime,
    hits,
    total,
  });
  if (won) {
    hero.presentationHeight = rig.group.position.y;
    hero.state = "idle";
    hero.elapsed = 0;
    hero.moveVelocity.set(0, 0, 0);
    hero.velocity.set(0, 0, 0);
    hero.localHitStop = 0;
    hero.moveBlend = 0;
    hero.attackCarry = 0;
    hero.combatAge = 10;
    hero.idleAge = 0;
    safeAudio("win");
  }
}

function healthRatio(hp, maxHp) {
  if (!Number.isFinite(hp) || !Number.isFinite(maxHp) || maxHp <= 0) return 0;
  return THREE.MathUtils.clamp(hp / maxHp, 0, 1);
}
function makeBar(type) {
  const g = new THREE.Group();
  const width = type === "boss" ? 1.76 : 1;
  const back = new THREE.Mesh(
    new THREE.PlaneGeometry(type === "boss" ? 1.8 : 1.05, 0.09),
    new THREE.MeshBasicMaterial({
      color: 0x1b1716,
      transparent: true,
      opacity: 0.85,
      depthTest: false,
      depthWrite: false,
      toneMapped: false,
    }),
  );
  const fill = new THREE.Mesh(
    new THREE.PlaneGeometry(width, 0.064),
    new THREE.MeshBasicMaterial({
      color: type === "boss" ? 0xefaa58 : 0xef674f,
      transparent: true,
      opacity: 1,
      depthTest: false,
      depthWrite: false,
      toneMapped: false,
    }),
  );
  // Both layers belong to the transparent pass. Render order guarantees that
  // the black track draws first; an opaque fill would be covered afterward.
  g.renderOrder = 200;
  back.renderOrder = 200;
  fill.renderOrder = 201;
  fill.position.z = 0.002;
  g.add(back, fill);
  g.visible = false;
  g.userData.back = back;
  g.userData.fill = fill;
  g.userData.width = width;
  scene.add(g);
  return g;
}
function updateEnemyBar(e) {
  const ratio = healthRatio(e.hp, e.maxHp);
  const fill = e.bar.userData.fill;
  fill.scale.x = ratio;
  fill.position.x = -(1 - ratio) * e.bar.userData.width * 0.5;
  fill.visible = ratio > 0;
  e.bar.visible =
    e.state !== "dead" &&
    ratio > 0 &&
    (ratio < 1 || e.type === "boss" || e === hero.target);
  e.bar.position.set(
    e.pos.x,
    e.type === "boss" ? 3.6 : e.type === "brute" ? 2.85 : 2.25,
    e.pos.z,
  );
  e.bar.quaternion.copy(camera.quaternion);
}
const enemyStats = {
  grunt: { hp: 65, speed: 2.05, range: 1.55, damage: 7, radius: 0.45 },
  brute: { hp: 155, speed: 1.5, range: 2.2, damage: 14, radius: 0.75 },
  archer: { hp: 48, speed: 1.85, range: 10, damage: 6, radius: 0.44 },
  boss: { hp: 1100, speed: 1.65, range: 3.5, damage: 18, radius: 1.0 },
};
function spawnEnemy(type, x, z) {
  const st = enemyStats[type],
    rig = createCharacter(type);
  const e = {
    id: nextId++,
    type,
    rig,
    pos: new THREE.Vector3(x, 0, z),
    velocity: new THREE.Vector3(),
    angle: 0,
    state: "spawn",
    elapsed: 0,
    duration: 0.65 + Math.random() * 0.4,
    hp: st.hp,
    maxHp: st.hp,
    ...st,
    cooldown: 0.9 + Math.random() * 1.8,
    flash: 0,
    hitDone: false,
    targetPos: new THREE.Vector3(),
    attackKind: 0,
    combo: 0,
    bar: makeBar(type),
    deathAge: 0,
  };
  clampPosition(e.pos, e.radius);
  rig.group.position.copy(e.pos);
  rig.group.traverse((o) => {
    o.userData.enemyId = e.id;
    if (type === "grunt" || type === "archer") o.castShadow = false;
  });
  scene.add(rig.group);
  enemies.push(e);
  fx.ring(e.pos, 0.75, type === "boss" ? 0xdf7951 : 0x9ab1a3, 0.8);
  return e;
}
function spawnWave(index) {
  wave = index;
  waveTimer = -1;
  const types =
    index === 1
      ? Array(8).fill("grunt").concat(["archer", "brute"])
      : index === 2
        ? Array(8).fill("grunt").concat(["brute", "brute", "archer", "archer"])
        : Array(8)
            .fill("grunt")
            .concat(["brute", "brute", "archer", "archer", "archer", "boss"]);
  types.forEach((type, i) => {
    const angle = (Math.PI * 2 * i) / types.length + Math.random() * 0.18;
    const radius = 9 + Math.random() * 3;
    spawnEnemy(
      type,
      hero.pos.x + Math.sin(angle) * radius,
      hero.pos.z + Math.cos(angle) * radius,
    );
  });
  if (index > 1) {
    hero.hp = Math.min(hero.maxHp, hero.hp + 25);
    ui.notify(index === 2 ? "第二阵 · 重甲压境" : "终阵 · 鬼将现身");
  }
}
function nearestEnemy(position = hero.pos, max = Infinity) {
  let best = null,
    distance = max;
  for (const e of enemies) {
    if (e.state === "dead" || e.state === "spawn") continue;
    const d = e.pos.distanceTo(position);
    if (d < distance) {
      distance = d;
      best = e;
    }
  }
  return best;
}
function beginAttack(enemy) {
  hero.state = "attack";
  hero.combatAge = 0;
  hero.elapsed = 0;
  hero.duration = attackDurations[hero.combo];
  hero.hitDone = false;
  hero.attackHits.clear();
  hero.impactDone = false;
  hero.reviewedPrevious = null;
  hero.strokeContacts.clear();
  hero.trailSeries++;
  hero.globalImpactDone = false;
  hero.attackEndRendered = false;
  hero.attackCarry = hero.destination
    ? Math.min(1, hero.moveVelocity.length() / 5.8)
    : 0;
  if(getReviewedAttack(currentWeapon.id,hero.combo))hero.attackCarry=Math.min(1,hero.moveVelocity.length()/5.8);
  hero.attackTarget = enemy;
  if (isCombatTarget(enemy, enemies)) face(enemy.pos.clone().sub(hero.pos));
  destinationMarker.visible = !!hero.destination;
}
function heroAttackCandidate(previousTarget = hero.attackTarget) {
  return chooseAttackTarget({ position: hero.pos, enemies, manualTarget: hero.target,
    previousTarget, move: currentWeapon.moves[hero.combo],
    reviewed: !!getReviewedAttack(currentWeapon.id, hero.combo),
    moving: !!hero.destination || keyboardDirection().lengthSq() > 0,
    disengage: hero.disengage, cooldown: hero.nextAttackIn, obstacles: world.obstacles });
}
function hurtEnemy(
  e,
  damage,
  from = hero.pos,
  force = 1,
  critical = false,
  playerContact = false,
) {
  if (e.state === "dead" || e.state === "spawn") return false;
  e.hp = Math.max(0, e.hp - damage);
  updateEnemyBar(e);
  e.flash = 1;
  temp.subVectors(e.pos, from);
  if (temp.lengthSq() < 0.01)
    temp.set(Math.sin(hero.angle), 0, Math.cos(hero.angle));
  temp.normalize();
  const hitDirection = temp.clone();
  e.hurtDirection = Math.sin(
    Math.atan2(hitDirection.x, hitDirection.z) - e.angle,
  );
  e.hurtStrength = critical ? 1 : 0.65;
  e.localHitStop = Math.max(e.localHitStop || 0, critical ? 0.038 : 0.027);
  e.velocity.addScaledVector(temp, force * (e.type === "boss" ? 0.4 : 1));
  showDamage(e, damage, critical ? "critical" : "normal");
  if (playerContact) {
    weaponFx.impact(currentWeapon.id, e.pos.clone().add(new THREE.Vector3(0, 1.05, 0)), hero.angle, hero.combo, critical);
  } else if (fx.impact)
    fx.impact(
      e.pos
        .clone()
        .add(new THREE.Vector3(0, e.type === "boss" ? 1.3 : 1.05, 0)),
      hitDirection,
      critical ? 1.35 : 0.75,
      critical,
    );
  else fx.burst(e.pos, critical ? 1.2 : 0.55);
  combo++;
  comboTimeout = 3;
  if (playerContact || e.pos.distanceTo(hero.pos) < 6)
    kickCamera(hitDirection, (critical ? 0.075 : 0.035) * (playerContact ? 0.7 + currentWeapon.stats.power * 0.12 : 1) *
      (playerContact && currentWeapon.id === "great-dao" && hero.combo === 3 ? 1.2 : 1));
  const isPlayerContact = playerContact && hero.state === "attack";
  if (isPlayerContact && !hero.impactDone) {
    hero.impactDone = true;
    const contactStop = currentWeapon.moves[hero.combo].hitstop;
    hero.localHitStop = Math.min(currentWeapon.id === "great-dao" ? .11 : .08, contactStop * (critical ? 1.2 : 1));
  }
  if (
    playerContact &&
    hero.state === "attack" &&
    hero.combo === 3 &&
    !hero.globalImpactDone
  ) {
    hero.globalImpactDone = true;
    hitStop = Math.max(hitStop, currentWeapon.id === "great-dao" ? .035 : .025);
  }
  if (playerContact) safeAudio("weaponHit", currentWeapon.id, critical ? 1.5 : 0.75, hero.combo);
  else safeAudio("hit", critical ? 1.5 : 0.75, hero.combo);
  if (e.hp <= 0) {
    e.state = "dead";
    e.elapsed = 0;
    e.duration = 1.5;
    e.bar.visible = false;
    kills++;
    dropLoot(e.pos);
    e.deathDirection = hitDirection;
    e.deathImpactDone = false;
    safeAudio("kill");
    if (e.type === "boss") {
      slowTime = 0.24;
      slowScale = 0.5;
    }
    if (hero.target === e) { hero.target = null; hero.navigation = null; }
    return true;
  }
  if (e.type === "boss") {
    // The last basic slash can break the general's stance. Recovery prevents
    // chaining these contacts into a permanent stun.
    const heavyHit = critical && hero.state === "attack" && hero.combo === 3;
    if (!heavyHit || (e.poise || 0) > 0) return true;
    e.poise = 3.2;
  }
  e.state = "hurt";
  e.elapsed = 0;
  e.duration = e.type === "boss" ? 0.16 : 0.32;
  e.cooldown = Math.max(e.cooldown, 0.7);
  return true;
}
function attackHit(phase = attackContacts[hero.combo]) {
  const firstContact = !hero.hitDone;
  hero.hitDone = true;
  const c = hero.combo,
    move = currentWeapon.moves[c];
  const origin = hero.pos.clone();
  for (const e of enemies) {
    if (e.state === "dead" || e.state === "spawn" || hero.attackHits.has(e.id))
      continue;
    if (!weaponStrikeContains(move, e.pos.x - origin.x, e.pos.z - origin.z, hero.angle, e.radius)) continue;
    const crit = c === 3 || Math.random() < 0.12;
    hero.attackHits.add(e.id);
    hurtEnemy(
      e,
      Math.round(attackDamages[c] * (crit ? 1.5 : 1)),
      origin,
      move.knockback * (c === 3 ? 5 : 3.5),
      crit,
      true,
    );
  }
  if (firstContact) {
    weaponFx.attack(currentWeapon.id, origin, hero.angle, c);
    safeAudio("weaponSlash", currentWeapon.id, c);
  }
}
function reviewedStrike(phase,frames) {
  const action=getReviewedAttack(currentWeapon.id,hero.combo,hero.state);
  if(!action)return;
  const previous=hero.reviewedPrevious;
  action.contacts.forEach((contact,stroke)=>{
    if(phase<contact.window[0]||phase>contact.window[1])return;
    const frame=frames.find(b=>b.hand===contact.hand);
    if(!frame)return;
    hero.hitDone=true;
    if(!hero.strokeContacts.has(stroke)){
      hero.strokeContacts.add(stroke);
      safeAudio('weaponSlash',currentWeapon.id,hero.combo,contact.kind??'cut');
    }
    const prior=previous&&previous.state===hero.state&&previous.combo===hero.combo&&previous.phase>=contact.window[0]
      ?previous.frames.find(b=>b.hand===contact.hand):null;
    for(const e of enemies){
      const key=`${stroke}:${e.id}`;
      if(e.state==='dead'||e.state==='spawn'||hero.attackHits.has(key))continue;
      const target={x:e.pos.x,z:e.pos.z,minY:.18,maxY:e.type==='boss'?3.2:e.type==='brute'?2.4:1.85};
      if(!bladeSweepContains(frame,prior,target,e.radius,action.width*.5))continue;
      hero.attackHits.add(key);
      const move=currentWeapon.moves[hero.combo];
      const critical=hero.combo===3;
      hurtEnemy(e,Math.round(move.damage/action.contacts.length*(critical?1.25:1)),hero.pos,move.knockback*3.5,critical,true);
    }
  });
  hero.reviewedPrevious={state:hero.state,combo:hero.combo,phase,frames};
}
function sampleHeroTrails(frames,tips,phase,dt,active) {
  const action=hero.state==='attack'?getReviewedAttack(currentWeapon.id,hero.combo):null;
  const source=`${currentWeapon.id}:${hero.trailSeries}:${hero.state}:${hero.combo}`;
  for(let i=0;i<trails.length;i++){
    const trail=trails[i];
    const blade=action&&frames.find(b=>b.hand===i);
    const contact=action?.contacts.find(c=>c.hand===i&&phase>=c.window[0]&&phase<=c.window[1]);
    const cutting=action?!!blade&&!!contact:active&&!!tips[i];
    // A short active interval can cover one displayed frame. Seed from the
    // preceding real blade pose so its path still forms a visible ribbon.
    if(blade&&cutting&&dt>0&&!trail.wasActive&&trail.previousBlade?.source===source&&phase-trail.previousBlade.phase<.1){
      fx.sample(trail,trail.previousBlade.tip,trail.previousBlade.heel,true,0);
    }
    fx.sample(trail,blade?blade.tip:tips[i],blade?blade.heel:hero.pos,dt>0&&cutting,dt);
    trail.previousBlade=blade?{tip:blade.tip,heel:blade.heel,phase,source}:null;
  }
}
function damageHero(amount, from) {
  if (
    mode !== "playing" ||
    hero.hp <= 0 ||
    hero.state === "dead" ||
    hero.invulnerable > 0
  )
    return;
  hero.combatAge = 0;
  hero.hp = Math.max(0, hero.hp - amount);
  hits++;
  hero.flash = 1;
  hero.invulnerable = 0.85;
  hero.state = "hurt";
  hero.elapsed = 0;
  hero.duration = 0.24;
  hero.destination = null;
  hero.combo = 0;
  temp.subVectors(hero.pos, from).normalize();
  hero.velocity.addScaledVector(temp, 5);
  hero.localHitStop = 0.04;
  hero.hurtDirection = Math.sin(Math.atan2(temp.x, temp.z) - hero.angle);
  hero.hurtStrength = 1;
  kickCamera(temp, 0.1);
  queueDamage(
    `−${amount}`,
    hero.pos.clone().add(new THREE.Vector3(0, 2.3, 0)),
    "hurt",
  );
  fx.burst(hero.pos, 0.8, 0xc47753);
  safeAudio("enemy");
  if (hero.hp <= 0) {
    hero.state = "dead";
    hero.elapsed = 0;
    hero.duration = 1.1;
    hero.target = null;
    hero.destination = null;
  }
}

function commandTap(position, enemy = null) {
  if (mode !== "playing" || hero.hp <= 0) return;
  metrics.taps++;
  audio.unlock?.();
  const p = position.clone
    ? position.clone()
    : new THREE.Vector3(position.x, 0, position.z);
  clampPosition(p);
  hero.target = isCombatTarget(enemy, enemies) ? enemy : null;
  hero.destination = hero.target ? null : p;
  hero.navigation = null;
  hero.disengage = hero.target ? 0 : 0.12;
  if (
    hero.state === "attack" &&
    hero.hitDone &&
    hero.elapsed / hero.duration >= attackRecoveryPhase(currentWeapon.moves[hero.combo],
      getReviewedAttack(currentWeapon.id, hero.combo))
  ) {
    hero.combo = (hero.combo + 1) % 4;
    hero.comboTimer = 0;
    hero.nextAttackIn = 0.12;
    locomotionState();
  }
  destinationMarker.visible = !hero.target;
  destinationMarker.position.set(p.x, 0.045, p.z);
  destinationMarker.scale.setScalar(1);
  if (hero.target) {
    targetMarker.visible = true;
    updateEnemyBar(enemy);
    targetMarker.position.set(enemy.pos.x, 0.05, enemy.pos.z);
  } else targetMarker.visible = false;
}
function roll(direction) {
  if (
    mode !== "playing" ||
    hero.hp <= 0 ||
    hero.stamina < 23 ||
    hero.state === "roll"
  )
    return;
  const d =
    direction?.clone() ||
    temp.set(Math.sin(hero.angle), 0, Math.cos(hero.angle)).clone();
  d.y = 0;
  if (d.lengthSq() < 0.01) d.set(Math.sin(hero.angle), 0, Math.cos(hero.angle));
  d.normalize();
  hero.stamina -= 23;
  metrics.rolls++;
  hero.state = "roll";
  hero.localHitStop = 0;
  hero.moveVelocity.set(0, 0, 0);
  hero.elapsed = 0;
  hero.duration = 0.43;
  hero.rollDirection.copy(d);
  face(d);
  hero.invulnerable = 0.48;
  hero.destination = null;
  hero.disengage = 0.65;
  hero.target = null;
  hero.attackTarget = null;
  hero.navigation = null;
  targetMarker.visible = false;
  hero.combo = 0;
  destinationMarker.visible = false;
  safeAudio("roll");
  fx.ring(hero.pos, 0.8, 0xcbb99a, 0.25);
}
function updateHero(frameDt) {
  const frozen = Math.min(frameDt, hero.localHitStop);
  hero.localHitStop = Math.max(0, hero.localHitStop - frameDt);
  const dt = frameDt - frozen;
  const previousPosition = hero.pos.clone();
  const previousPhase = hero.duration ? hero.elapsed / hero.duration : 0;
  hero.elapsed += dt;
  hero.invulnerable = Math.max(0, hero.invulnerable - frameDt);
  hero.flash = Math.max(0, hero.flash - frameDt * 7);
  hero.rig.setFlash?.(hero.flash);
  hero.stamina = Math.min(100, hero.stamina + frameDt * 27);
  hero.disengage = Math.max(0, hero.disengage - frameDt);
  hero.nextAttackIn = Math.max(0, hero.nextAttackIn - frameDt);
  hero.comboTimer += frameDt;
  if (hero.comboTimer > 1.8 && hero.state !== "attack") hero.combo = 0;
  hero.velocity.multiplyScalar(Math.exp(-dt * 10));
  hero.pos.addScaledVector(hero.velocity, dt);
  if (hero.target && !isCombatTarget(hero.target, enemies)) {
    hero.target = null;
    hero.navigation = null;
    targetMarker.visible = false;
  }
  if (hero.attackTarget && !isCombatTarget(hero.attackTarget, enemies)) hero.attackTarget = null;
  const maxSpeed = 5.8 * (0.88 + currentWeapon.stats.speed * 0.024);
  function navigate() {
    const goal = movementGoal();
    locomotion(
      dt,
      goal?.direction,
      goal?.distance ?? Infinity,
      maxSpeed,
      goal?.stoppingDistance || 0,
    );
    locomotionState();
  }
  if (hero.state === "roll") {
    const phase = Math.min(1, hero.elapsed / hero.duration);
    face(hero.rollDirection, 1 - Math.exp(-dt * 30));
    move(hero.pos, hero.rollDirection, 13 * (1 - phase * 0.45), dt);
    hero.ghostTimer -= dt;
    if (hero.ghostTimer <= 0 && dt > 0) {
      fx.ghost(hero.rig);
      hero.ghostTimer = 0.09;
    }
    if (phase >= 1) {
      hero.moveVelocity.copy(hero.rollDirection).multiplyScalar(2.5);
      locomotionState();
    }
  } else if (hero.state === "attack") {
    const phase = hero.elapsed / hero.duration;
    const move = currentWeapon.moves[hero.combo];
    const action = getReviewedAttack(currentWeapon.id, hero.combo);
    const canTrack = attackCanTrack(phase, move, action);
    const leaving = !!hero.destination || keyboardDirection().lengthSq() > 0;
    const passing = isCombatTarget(hero.target, enemies) && hero.attackTarget !== hero.target &&
      hero.pos.distanceTo(hero.target.pos) > attackDistances(move, hero.target.radius, !!action).stop;
    const travelling = leaving || passing;
    if (!hero.attackTarget && phase < move.active[0]) hero.attackTarget = heroAttackCandidate(null);
    if (!travelling && canTrack && isCombatTarget(hero.attackTarget, enemies))
      face(hero.attackTarget.pos.clone().sub(hero.pos), 1 - Math.exp(-dt * 24));
    if (travelling) {
      const goal = movementGoal();
      const carry = currentWeapon.id === "great-dao"
        ? phase < .3 ? .38 : phase < attackRecoveryPhase(move, action) ? .22 : .85
        : phase < 0.35 ? 0.75 : phase < 0.66 ? 0.43 : 1;
      locomotion(
        dt,
        goal?.direction,
        goal?.distance ?? Infinity,
        maxSpeed * carry,
        goal?.stoppingDistance || 0,
        canTrack,
      );
      hero.attackCarry = THREE.MathUtils.clamp(
        hero.moveVelocity.length() / maxSpeed,
        0,
        1,
      );
    } else if (
      isCombatTarget(hero.attackTarget, enemies) &&
      phase < move.contact + 0.12
    ) {
      if(action){
        locomotion(dt,null);
        hero.attackCarry=THREE.MathUtils.clamp(hero.moveVelocity.length()/maxSpeed,0,1);
      } else {
        const direction = hero.attackTarget.pos.clone().sub(hero.pos),
          distance = direction.length();
        locomotion(
          dt,
          direction.normalize(),
          distance,
          THREE.MathUtils.clamp(move.lunge / (move.duration * move.contact), 1.2, 4.8),
          attackDistances(move, hero.attackTarget.radius).stop,
          canTrack,
        );
        hero.attackCarry = 0;
      }
    } else locomotion(dt, null);
    const window = attackWindows[hero.combo];
    if (
      dt > 0 &&
      !action && phase >= attackContacts[hero.combo] &&
      previousPhase < window[1]
    )
      attackHit(Math.min(phase, window[1]));
    if (leaving && hero.hitDone && phase >= attackRecoveryPhase(move, action)) {
      hero.combo = (hero.combo + 1) % 4;
      hero.comboTimer = 0;
      hero.nextAttackIn = 0.12;
      locomotionState();
    } else if (phase >= attackChainPhase(currentWeapon.id, hero.combo) &&
      (currentWeapon.id !== "great-dao" || hero.attackEndRendered)) {
      hero.combo = (hero.combo + 1) % 4;
      hero.comboTimer = 0;
      const next = heroAttackCandidate();
      if (next) beginAttack(next);
      else navigate();
    }
  } else if (hero.state === "hurt" || hero.state === "dead") {
    hero.moveVelocity.multiplyScalar(Math.exp(-dt * 28));
    if (hero.state === "hurt" && hero.elapsed >= hero.duration) navigate();
    if (hero.state === "dead" && hero.elapsed >= hero.duration)
      finishGame(false);
  } else {
    const enemy = heroAttackCandidate();
    if (enemy) beginAttack(enemy);
    else navigate();
  }
  clampPosition(hero.pos);
  const reviewedMotion = getReviewedAttack(currentWeapon.id,
    hero.combo, hero.state);
  if (reviewedMotion) hero.attackCarry = THREE.MathUtils.clamp(hero.moveVelocity.length() / maxSpeed, 0, 1);
  const moved = hero.pos.distanceTo(previousPosition);
  const locomoting =
    hero.state === "run" ||
    hero.state === "idle" ||
    (hero.state === "attack" && hero.attackCarry > 0.05);
  const previousFoot = Math.floor(hero.gaitPhase / Math.PI);
  if (locomoting)
    hero.gaitPhase +=
      (moved * Math.PI * 2) /
      THREE.MathUtils.lerp(
        0.85,
        2.9,
        THREE.MathUtils.clamp(hero.moveVelocity.length() / maxSpeed, 0, 1),
      );
  if (
    locomoting &&
    Math.floor(hero.gaitPhase / Math.PI) !== previousFoot &&
    moved > 0.001
  )
    safeAudio("footstep", 0.6);
  hero.actualSpeed = dt > 0 ? moved / dt : 0;
  const targetBlend = THREE.MathUtils.clamp(
    hero.moveVelocity.length() / maxSpeed,
    0,
    1,
  );
  hero.moveBlend = THREE.MathUtils.lerp(
    hero.moveBlend,
    targetBlend,
    1 - Math.exp(-frameDt * 20),
  );
  hero.rig.group.position.copy(hero.pos);
  hero.rig.group.position.y = 0;
  hero.rig.group.rotation.y = hero.angle;
  const phase = hero.duration ? Math.min(1, hero.elapsed / hero.duration) : 0;
  const poseState = hero.state;
  const switched =
    hero.poseState !== poseState ||
    (poseState === "attack" && hero.poseCombo !== hero.combo);
  if (switched) {
    hero.transition = {
      from: hero.poseState,
      to: poseState,
      age: 0,
      duration: 0.08,
    };
    hero.poseState = poseState;
    hero.poseCombo = hero.combo;
  } else hero.transition.age = Math.min(1, hero.transition.age + dt);
  updateAwareness(dt);
  poseCharacter(hero.rig, {
    idleAge: hero.idleAge,
    alertness: hero.alertness,
    lookYaw: hero.lookYaw,
    state: poseState,
    time: globalTime,
    dt,
    phase,
    combo: hero.combo,
    speed: targetBlend,
    moveBlend: hero.moveBlend,
    gaitPhase: hero.gaitPhase,
    turnLean: hero.turnLean,
    attackCarry: hero.attackCarry,
    hurtDirection: hero.hurtDirection || 0,
    hurtStrength: hero.hurtStrength || 0,
  });
  hero.rig.group.updateMatrixWorld(true);
  const tips = hero.rig.weaponTips();
  const blades = hero.rig.weaponBlades();
  if(dt>0&&hero.state==='attack')reviewedStrike(phase,blades);
  const active =
    !switched &&
    dt > 0 &&
    hero.state === "attack" &&
    phase >= attackWindows[hero.combo][0] &&
    phase <= attackWindows[hero.combo][1];
  sampleHeroTrails(blades,tips,phase,frameDt,active&&!switched);
}
function beginEnemyAttack(e) {
  e.state = "attack";
  e.elapsed = 0;
  e.hitDone = false;
  e.targetPos.copy(hero.pos);
  e.angle = Math.atan2(hero.pos.x - e.pos.x, hero.pos.z - e.pos.z);
  e.duration =
    e.type === "brute"
      ? 1.15
      : e.type === "boss"
        ? 1.45
        : e.type === "archer"
          ? 1.05
          : 0.82;
  e.attackKind = e.type === "boss" ? e.combo++ % 3 : 0;
  if (e.type === "archer") {
    fx.ring(e.pos, 0.65, 0xcf9263, e.duration);
  } else if (e.type === "boss" && e.attackKind === 1) {
    e.dashDirection = temp.subVectors(hero.pos, e.pos).normalize().clone();
    for (let i = 0; i < 4; i++)
      fx.warning(
        e.pos.clone().addScaledVector(e.dashDirection, 1.7 + i * 1.6),
        1.25,
        e.duration * 0.58,
      );
  } else {
    const p =
      e.type === "grunt"
        ? e.pos
            .clone()
            .add(
              new THREE.Vector3(
                Math.sin(e.angle) * 0.6,
                0,
                Math.cos(e.angle) * 0.6,
              ),
            )
        : e.pos;
    fx.warning(
      p,
      e.type === "boss" ? 4 : e.type === "brute" ? 3 : 1.8,
      e.duration * 0.6,
    );
  }
}
function updateEnemies(dt) {
  for (const e of enemies) {
    (e.stepStart ||= new THREE.Vector3()).copy(e.pos);
  }
  for (let i = enemies.length - 1; i >= 0; i--) {
    const e = enemies[i];
    const frozen = Math.min(dt, e.localHitStop || 0);
    e.localHitStop = Math.max(0, (e.localHitStop || 0) - dt);
    const tickDt = dt - frozen;
    e.poseDt = tickDt;
    e.elapsed += tickDt;
    e.cooldown -= tickDt;
    e.poise = Math.max(0, (e.poise || 0) - tickDt);
    e.flash = Math.max(0, e.flash - dt * 7);
    e.rig.setFlash?.(e.flash);
    e.velocity.multiplyScalar(Math.exp(-tickDt * 7));
    e.pos.addScaledVector(e.velocity, tickDt);
    if (e.state === "dead") {
      e.rig.group.position.x = e.pos.x;
      e.rig.group.position.z = e.pos.z;
      e.deathAge += tickDt;
      if (e.deathAge >= 0.5 && !e.deathImpactDone) {
        e.deathImpactDone = true;
        fx.death?.(e.pos, e.deathDirection, e.type === "boss" ? 1.5 : 0.8);
      }
      e.bar.visible = false;
      e.pos.addScaledVector(e.velocity, tickDt);
      if (e.deathAge > 0.9)
        e.rig.group.position.y = -Math.min(2, (e.deathAge - 0.9) * 2);
      if (e.deathAge > 1.85) {
        disposeGroup(e.rig.group, false);
        disposeGroup(e.bar);
        enemies.splice(i, 1);
        continue;
      }
    } else if (e.state === "spawn") {
      if (e.elapsed >= e.duration) {
        e.state = "idle";
        e.elapsed = 0;
      }
    } else if (e.state === "hurt" || e.state === "frozen") {
      if (e.elapsed >= e.duration) {
        e.state = "idle";
        e.elapsed = 0;
      }
    } else if (e.state === "attack") {
      const phase = e.elapsed / e.duration;
      if (
        e.type === "boss" &&
        e.attackKind === 1 &&
        phase > 0.58 &&
        phase < 0.85
      ) {
        move(e.pos, e.dashDirection, 12, tickDt, e.radius);
        if (e.pos.distanceTo(hero.pos) < 2.1) damageHero(e.damage, e.pos);
      }
      if (!e.hitDone && phase > 0.58) {
        e.hitDone = true;
        if (e.type === "archer") {
          const start = e.pos.clone().add(new THREE.Vector3(0, 1.3, 0));
          const dir = temp
            .subVectors(
              hero.pos.clone().add(new THREE.Vector3(0, 0.85, 0)),
              start,
            )
            .normalize()
            .clone();
          spawnProjectile(start, dir, 11, e.damage, 0xeab875, 2.2);
        } else if (e.type === "boss" && e.attackKind === 2) {
          for (let j = -2; j <= 2; j++) {
            spawnProjectile(
              e.pos.clone().add(new THREE.Vector3(0, 1.0, 0)),
              new THREE.Vector3(
                Math.sin(e.angle + j * 0.28),
                0,
                Math.cos(e.angle + j * 0.28),
              ),
              9,
              12,
              0xc88550,
              2.5,
            );
          }
          fx.ring(e.pos, 3.8, 0xb76143, 0.55);
        } else if (e.type !== "boss" || e.attackKind === 0) {
          const radius = e.type === "boss" ? 4 : e.type === "brute" ? 3 : 2.15;
          const delta = temp.subVectors(hero.pos, e.pos);
          const inFront =
            e.type !== "grunt" ||
            delta
              .normalize()
              .dot(temp2.set(Math.sin(e.angle), 0, Math.cos(e.angle))) > -0.12;
          if (e.pos.distanceTo(hero.pos) < radius && inFront)
            damageHero(e.damage, e.pos);
          fx.ring(
            e.pos,
            radius,
            e.type === "grunt" ? 0xc59979 : 0xc8784b,
            0.35,
          );
          if (e.type !== "grunt") fx.burst(e.pos, 1.2, 0xc4a788);
        }
      }
      if (phase >= 1) {
        e.state = "recover";
        e.elapsed = 0;
        e.duration =
          e.type === "boss" ? 0.85 : e.type === "brute" ? 0.65 : 0.45;
        e.cooldown =
          e.type === "boss"
            ? 1.3
            : e.type === "archer"
              ? 1.8
              : 1.3 + Math.random() * 0.7;
      }
    } else if (e.state === "recover") {
      if (e.elapsed > e.duration) {
        e.state = "idle";
        e.elapsed = 0;
      }
    } else {
      const direction = temp.subVectors(hero.pos, e.pos),
        distance = direction.length();
      e.angle +=
        Math.atan2(
          Math.sin(Math.atan2(direction.x, direction.z) - e.angle),
          Math.cos(Math.atan2(direction.x, direction.z) - e.angle),
        ) * Math.min(1, tickDt * 8);
      if (e.type === "archer" && distance < 5) {
        move(e.pos, direction.normalize(), -e.speed, tickDt, e.radius);
        e.state = "run";
      } else if (distance > e.range) {
        move(e.pos, direction.normalize(), e.speed, tickDt, e.radius);
        e.state = "run";
      } else {
        e.state = "idle";
        if (e.cooldown <= 0) beginEnemyAttack(e);
      }
    }
    if (e.state !== "dead") {
      clampPosition(e.pos, e.radius);
      for (const other of enemies) {
        if (other === e || other.state === "dead" || other.id < e.id) continue;
        const dx = e.pos.x - other.pos.x,
          dz = e.pos.z - other.pos.z,
          d = Math.hypot(dx, dz),
          r = (e.radius + other.radius) * 0.9;
        if (d < r && d > 0.01) {
          const push = (r - d) * 0.5;
          e.pos.x += (dx / d) * push;
          e.pos.z += (dz / d) * push;
          other.pos.x -= (dx / d) * push;
          other.pos.z -= (dz / d) * push;
        }
      }
      e.rig.group.position.copy(e.pos);
    }
  }
  // Resolve all motion before posing, including pushes by another enemy.
  for (const e of enemies) {
    const tickDt = e.poseDt || 0;
    const locomotion =
      e.state === "run" || e.state === "idle" || e.state === "recover";
    if (e.state !== "dead") clampPosition(e.pos, e.radius);
    const moved = e.stepStart ? e.pos.distanceTo(e.stepStart) : 0;
    const dx = e.pos.x - e.stepStart.x,
      dz = e.pos.z - e.stepStart.z;
    const direction =
      dx * Math.sin(e.angle) + dz * Math.cos(e.angle) < -0.001 ? -1 : 1;
    const speed =
      locomotion && tickDt > 0
        ? THREE.MathUtils.clamp(moved / tickDt / 5.8, 0, 1)
        : 0;
    const movementWeight =
      locomotion && tickDt > 0
        ? THREE.MathUtils.clamp(moved / tickDt / e.speed, 0, 1)
        : 0;
    e.moveBlend = THREE.MathUtils.lerp(
      e.moveBlend || 0,
      movementWeight,
      1 - Math.exp(-tickDt * 18),
    );
    if (locomotion)
      e.gaitPhase =
        (e.gaitPhase || 0) +
        (direction * moved * Math.PI * 2) /
          THREE.MathUtils.lerp(0.85, 2.9, speed);
    if (e.state !== "dead") e.rig.group.position.copy(e.pos);
    e.rig.group.rotation.y = e.angle;
    poseCharacter(e.rig, {
      state:
        e.state === "frozen"
          ? "hurt"
          : e.state === "spawn" || e.state === "recover"
            ? "idle"
            : e.state,
      time: globalTime,
      phase: e.duration ? Math.min(1, e.elapsed / e.duration) : 0,
      combo: e.combo % 4,
      speed,
      skill: e.attackKind,
      dt: tickDt,
      gaitPhase: e.gaitPhase || 0,
      moveBlend: e.moveBlend,
      alertness: 0.7,
      hurtDirection: e.hurtDirection || 0,
      hurtStrength: e.hurtStrength || 0,
    });
    updateEnemyBar(e);
  }
  if (enemies.filter((e) => e.state !== "dead").length === 0 && waveTimer < 0) {
    if (wave === 3) {
      if (hero.hp > 0) finishGame(true);
    } else {
      waveTimer = 2.4;
      ui.notify("尸潮暂歇 · 生命恢复");
    }
  }
  if (waveTimer > 0) {
    waveTimer -= dt;
    if (waveTimer <= 0) spawnWave(wave + 1);
  }
}

const arrowGeometry = new THREE.ConeGeometry(0.07, 0.7, 5);
arrowGeometry.rotateX(Math.PI / 2);
function spawnProjectile(
  position,
  direction,
  speed,
  damage,
  color = 0xe1b975,
  duration = 2,
) {
  const mesh = new THREE.Mesh(
    arrowGeometry,
    new THREE.MeshBasicMaterial({ color }),
  );
  mesh.position.copy(position);
  mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), direction);
  scene.add(mesh);
  projectiles.push({
    mesh,
    direction: direction.clone(),
    speed,
    damage,
    life: duration,
  });
}
function updateProjectiles(dt) {
  for (let i = projectiles.length - 1; i >= 0; i--) {
    const p = projectiles[i];
    p.life -= dt;
    p.mesh.position.addScaledVector(p.direction, p.speed * dt);
    if (
      Math.hypot(
        p.mesh.position.x - hero.pos.x,
        p.mesh.position.z - hero.pos.z,
      ) < 0.65
    ) {
      damageHero(p.damage, p.mesh.position);
      p.life = 0;
    }
    if (
      p.life <= 0 ||
      Math.abs(p.mesh.position.x) > 20 ||
      Math.abs(p.mesh.position.z) > 18
    ) {
      scene.remove(p.mesh);
      p.mesh.material.dispose();
      projectiles.splice(i, 1);
    }
  }
}
const healGeometry = new THREE.IcosahedronGeometry(0.15, 0);
function dropLoot(position) {
  const count = 1 + Math.floor(Math.random() * 2);
  for (let i = 0; i < count; i++) {
    if (Math.random() >= 0.14) continue;
    const mesh = new THREE.Mesh(
      healGeometry,
      new THREE.MeshStandardMaterial({
        color: 0xd69078,
        emissive: 0x391813,
        emissiveIntensity: 0.6,
        metalness: 0.6,
        roughness: 0.4,
      }),
    );
    mesh.position.copy(position);
    mesh.position.x += (Math.random() - 0.5) * 0.9;
    mesh.position.z += (Math.random() - 0.5) * 0.9;
    mesh.position.y = 0.2;
    scene.add(mesh);
    drops.push({ mesh, age: 0 });
  }
}
function updateDrops(dt) {
  if (hero.hp <= 0) return;
  for (let i = drops.length - 1; i >= 0; i--) {
    const d = drops[i];
    d.age += dt;
    d.mesh.rotation.y += dt * 2;
    d.mesh.position.y = 0.22 + Math.sin(d.age * 4) * 0.07;
    const distance = Math.hypot(
      d.mesh.position.x - hero.pos.x,
      d.mesh.position.z - hero.pos.z,
    );
    if (distance < 3.4 && d.age > 0.28) {
      temp.subVectors(hero.pos, d.mesh.position).normalize();
      d.mesh.position.addScaledVector(temp, (7 + (3.4 - distance) * 3) * dt);
    }
    if (distance < 0.6) {
      hero.hp = Math.min(hero.maxHp, hero.hp + 15);
      queueDamage(
        "+15",
        hero.pos.clone().add(new THREE.Vector3(0, 2.2, 0)),
        "heal",
      );
      scene.remove(d.mesh);
      d.mesh.material.dispose();
      drops.splice(i, 1);
    } else if (d.age > 35) {
      scene.remove(d.mesh);
      d.mesh.material.dispose();
      drops.splice(i, 1);
    }
  }
}
let pointerStart = null,
  lastTap = null;
function pointFromEvent(event) {
  pointer.set(
    (event.clientX / innerWidth) * 2 - 1,
    (-event.clientY / innerHeight) * 2 + 1,
  );
  raycaster.setFromCamera(pointer, camera);
  const point = new THREE.Vector3();
  return raycaster.ray.intersectPlane(ground, point) ? point : null;
}
function targetFromEvent(event) {
  pointer.set(
    (event.clientX / innerWidth) * 2 - 1,
    (-event.clientY / innerHeight) * 2 + 1,
  );
  raycaster.setFromCamera(pointer, camera);
  const result = raycaster.intersectObjects(
    enemies.filter((e) => e.state !== "dead").map((e) => e.rig.group),
    true,
  );
  if (result.length) {
    const id = result[0].object.userData.enemyId;
    return enemies.find((e) => e.id === id) || null;
  }
  let nearest = null,
    best = event.pointerType === "touch" ? 34 : 23;
  for (const e of enemies) {
    if (e.state === "dead") continue;
    const p = worldToScreen(e.pos.clone().add(new THREE.Vector3(0, 0.85, 0)));
    const d = Math.hypot(p.x - event.clientX, p.y - event.clientY);
    if (d < best) {
      nearest = e;
      best = d;
    }
  }
  return nearest;
}
canvas.addEventListener("pointerdown", (event) => {
  if (event.button && event.button !== 0) return;
  audio.unlock?.();
  pointerStart = {
    x: event.clientX,
    y: event.clientY,
    time: performance.now(),
    id: event.pointerId,
    dragged: false,
  };
  canvas.setPointerCapture(event.pointerId);
});
canvas.addEventListener("pointermove", (event) => {
  if (
    !pointerStart ||
    event.pointerId !== pointerStart.id ||
    mode !== "playing"
  )
    return;
  if (
    Math.hypot(event.clientX - pointerStart.x, event.clientY - pointerStart.y) >
    18
  )
    pointerStart.dragged = true;
  if (pointerStart.dragged) {
    const p = pointFromEvent(event);
    if (p) commandTap(p);
  }
});
canvas.addEventListener("pointerup", (event) => {
  if (!pointerStart || pointerStart.id !== event.pointerId) return;
  const drag = pointerStart.dragged;
  pointerStart = null;
  if (mode !== "playing" || drag) return;
  const p = pointFromEvent(event);
  if (!p) return;
  const now = event.timeStamp;
  if (
    lastTap &&
    now - lastTap.time < 310 &&
    Math.hypot(event.clientX - lastTap.x, event.clientY - lastTap.y) < 75
  ) {
    roll(p.clone().sub(hero.pos));
    lastTap = null;
  } else {
    commandTap(p, targetFromEvent(event));
    lastTap = { time: now, x: event.clientX, y: event.clientY };
  }
});
// Native mouse double-click recognition also survives a delayed render thread.
canvas.addEventListener("dblclick", (event) => {
  const point = pointFromEvent(event);
  if (point) roll(point.sub(hero.pos));
  lastTap = null;
  event.preventDefault();
});
canvas.addEventListener("pointercancel", () => (pointerStart = null));
canvas.addEventListener("contextmenu", (event) => event.preventDefault());
window.addEventListener("keydown", (event) => {
  const key = event.key.toLowerCase();
  if ([" ", "arrowup", "arrowdown", "arrowleft", "arrowright"].includes(key))
    event.preventDefault();
  if (event.repeat) return;
  keys.add(key);
  if (key === "escape" || key === "p") {
    if (mode === "playing") pauseGame();
    else if (mode === "pause") resumeGame();
  }
  if (mode === "playing") {
    if (key === " ") {
      const keyboard = keyboardDirection();
      const direction = hero.destination
        ? hero.destination.clone().sub(hero.pos)
        : keyboard.lengthSq() > 0
          ? keyboard
          : hero.target
            ? hero.target.pos.clone().sub(hero.pos)
            : hero.moveVelocity.lengthSq() > 0.1
              ? hero.moveVelocity.clone()
              : new THREE.Vector3(
                  Math.sin(hero.angle),
                  0,
                  Math.cos(hero.angle),
                );
      roll(direction);
    }
  }
});
window.addEventListener("keyup", (event) =>
  keys.delete(event.key.toLowerCase()),
);
window.addEventListener("blur", () => {
  keys.clear();
  pointerStart = null;
  if (mode === "playing") pauseGame();
});
document.addEventListener("visibilitychange", () => {
  if (document.hidden && mode === "playing") pauseGame();
});
window.addEventListener("resize", () => {
  resizeCamera();
  renderer.setPixelRatio(Math.min(devicePixelRatio, 1.7));
  renderer.setSize(innerWidth, innerHeight);
});
function updateCamera(dt) {
  const b = world.bounds;
  const preview = mode === "start" && document.querySelector('.game-interface')?.dataset.mode === "armory";
  const desired = hero.pos.clone().addScaledVector(cameraBack, preview ? 0 : -0.8);
  desired.x = THREE.MathUtils.clamp(desired.x, b.minX + 2, b.maxX - 2);
  desired.z = THREE.MathUtils.clamp(desired.z, b.minZ + 2, b.maxZ - 2);
  desired.y = preview ? 1.05 : 0.15;
  camera.zoom = THREE.MathUtils.lerp(camera.zoom, preview ? 2.4 : 1, 1 - Math.exp(-dt * 8));
  camera.updateProjectionMatrix();
  cameraFocus.lerp(desired, 1 - Math.exp(-dt * 7));
  shakeAge += dt;
  const amplitude = shake * Math.exp(-shakeAge * 19) * Math.sin(shakeAge * 58);
  const offset = shakeDirection.clone().multiplyScalar(amplitude);
  camera.position.copy(cameraFocus).add(cameraOffset).add(offset);
  camera.lookAt(cameraFocus.clone().add(offset));
  if (shakeAge > 0.3) shake = 0;
  camera.updateMatrixWorld(true);
}
function updatePresentation(dt) {
  let state = mode === "lose" ? "dead" : "idle", phase = state === "dead" ? 1 : 0, comboIndex = 0;
  if (mode === "start" && Number.isFinite(hero.previewAge)) {
    hero.previewAge += dt;
    let remaining = hero.previewAge - 0.18;
    for (let i = 0; i < currentWeapon.moves.length && remaining >= 0; i++) {
      const move = currentWeapon.moves[i];
      if (remaining <= move.duration) {
        state = "attack";
        comboIndex = i;
        phase = Math.min(1, remaining / move.duration);
        if (phase >= move.contact && hero.previewContact !== i) {
          hero.previewContact = i;
          if(!getReviewedAttack(currentWeapon.id,i))weaponFx.attack(currentWeapon.id, hero.pos, hero.angle, i);
        }
        break;
      }
      remaining -= move.duration + 0.1;
    }
  }
  hero.state = state;
  hero.combo = comboIndex;
  hero.moveBlend = THREE.MathUtils.lerp(
    hero.moveBlend,
    0,
    1 - Math.exp(-dt * 18),
  );
  updateAwareness(dt);
  const alertness = mode === "start" ? 0.25 : 0.18;
  hero.alertness = alertness;
  hero.lookYaw = 0;
  rig.group.position.copy(hero.pos);
  rig.group.position.y =
    mode === "win" ? hero.presentationHeight || 0 : 0;
  rig.group.rotation.y = hero.angle;
  poseCharacter(rig, {
    state,
    time: globalTime,
    dt,
    phase,
    combo: comboIndex,
    speed: 0,
    moveBlend: hero.moveBlend,
    gaitPhase: hero.gaitPhase,
    idleAge: hero.idleAge,
    alertness,
    lookYaw: 0,
  });
  rig.group.updateMatrixWorld(true);
  const tips = rig.weaponTips();
  const active = state === "attack" && phase >= attackWindows[comboIndex][0] && phase <= attackWindows[comboIndex][1];
  sampleHeroTrails(rig.weaponBlades(),tips,phase,dt,active);
  fx.update(dt);
  weaponFx.update(dt);
  if (mode !== "start") {
    for (let i = projectiles.length - 1; i >= 0; i--) {
      const p = projectiles[i];
      p.life -= dt;
      p.mesh.position.addScaledVector(p.direction, p.speed * dt);
      if (p.life <= 0) {
        disposeGroup(p.mesh, false);
        projectiles.splice(i, 1);
      }
    }
    for (let i = enemies.length - 1; i >= 0; i--) {
      const e = enemies[i];
      if (e.state !== "dead") continue;
      e.elapsed += dt;
      e.deathAge += dt;
      e.velocity.multiplyScalar(Math.exp(-dt * 7));
      e.pos.addScaledVector(e.velocity, dt);
      e.rig.group.position.copy(e.pos);
      e.rig.group.position.y = -Math.min(2, Math.max(0, e.deathAge - 0.9) * 2);
      poseCharacter(e.rig, {
        state: "dead",
        time: globalTime,
        dt,
        phase: Math.min(1, e.elapsed / e.duration),
      });
      if (e.deathAge > 1.85) {
        disposeGroup(e.rig.group, false);
        disposeGroup(e.bar);
        enemies.splice(i, 1);
      }
    }
  }
}
let lastTime = performance.now(),
  uiClock = 0;
function animate(now) {
  requestAnimationFrame(animate);
  const realDt = Math.min(0.25, Math.max(0, (now - lastTime) / 1000));
  lastTime = now;
  const presentationDt = mode === "pause" ? 0 : realDt;
  presentationTime += presentationDt;
  let dt = mode === "playing" ? realDt : 0;
  if (mode === "playing" && slowTime > 0) {
    slowTime -= realDt;
    dt *= slowScale;
  }
  if (mode === "playing" && hitStop > 0) {
    const frozen = Math.min(dt, hitStop);
    hitStop = Math.max(0, hitStop - realDt);
    dt = Math.max(0, dt - frozen);
  }
  if (mode === "playing") {
    gameTime += realDt;
    if (comboTimeout > 0) comboTimeout -= dt;
    else combo = 0;
    if (dt > 0) {
      // Keep collision and strike windows stable when a slow frame arrives.
      const steps = Math.ceil(dt / 0.03),
        step = dt / steps;
      for (let i = 0; i < steps && mode === "playing"; i++) {
        globalTime += step;
        updateHero(step);
        updateEnemies(step);
        updateProjectiles(step);
        updateDrops(step);
        fx.update(step);
        weaponFx.update(step);
      }
    }
    targetMarker.visible = !!hero.target && hero.target.state !== "dead";
    if (targetMarker.visible) {
      targetMarker.position.set(hero.target.pos.x, 0.05, hero.target.pos.z);
      targetMarker.scale.setScalar(
        hero.target.type === "boss"
          ? 1.65
          : 1 + Math.sin(globalTime * 5) * 0.03,
      );
    }
    if (destinationMarker.visible)
      destinationMarker.scale.setScalar(1 + Math.sin(globalTime * 5) * 0.08);
  } else if (mode !== "pause") {
    const steps = Math.max(1, Math.ceil(realDt / 0.03)),
      step = realDt / steps;
    for (let i = 0; i < steps; i++) {
      globalTime += step;
      updatePresentation(step);
    }
  }
  // Camera sees this frame's actual simulation position; floating text is
  // projected afterward so it stays attached to the same displayed contact.
  if (presentationDt > 0) updateCamera(presentationDt);
  flushDamage();
  world.update?.(presentationDt, presentationTime);
  audio.update?.(presentationDt);
  uiClock += realDt;
  if (uiClock > 0.065) {
    ui.update(stateSnapshot());
    uiClock = 0;
  }
  renderer.render(scene, camera);
  if (mode === "playing" && hero.state === "attack" && hero.elapsed >= hero.duration)
    hero.attackEndRendered = true;
}
resizeCamera();
updateCamera(1);
rig.group.position.copy(hero.pos);
rig.group.rotation.y = hero.angle;
selectWeapon(currentWeapon.id, false);
ui.update(stateSnapshot());
ui.showScreen("start");
requestAnimationFrame(animate);
if (new URLSearchParams(location.search).get("debug") === "1") {
  window.__undead = {
    get state() {
      return stateSnapshot();
    },
    getState: stateSnapshot,
    getWeapons: () => WEAPONS,
    selectWeapon,
    chooseWeapon,
    getPose() {
      rig.group.updateMatrixWorld(true);
      const xyz = (value) => ({ x: value.x, y: value.y, z: value.z });
      const joint = (node) => ({
        position: xyz(node.position),
        rotation: xyz(node.rotation),
        scale: xyz(node.scale),
      });
      const motion = Object.fromEntries(
        Object.entries(rig.motion || {}).filter(([, value]) =>
          ["number", "string", "boolean"].includes(typeof value),
        ),
      );
      return {
        weaponId: rig.weaponId,
        state: hero.state,
        clock: globalTime,
        presentationClock: presentationTime,
        idleAge: hero.idleAge,
        alertness: hero.alertness,
        lookYaw: hero.lookYaw,
        root: joint(rig.group),
        body: joint(rig.body),
        chest: joint(rig.chest),
        ribcage: rig.ribcage
          ? {
              ...joint(rig.ribcage),
              worldPos: xyz(rig.ribcage.getWorldPosition(new THREE.Vector3())),
            }
          : null,
        head: joint(rig.head),
        arms: rig.arms.map((arm) => ({
          side: arm.side,
          shoulder: joint(arm.shoulder),
          shoulderWorldPos: xyz(
            arm.shoulder.getWorldPosition(new THREE.Vector3()),
          ),
          elbow: joint(arm.elbow),
          wrist: joint(arm.wrist),
          worldPos: xyz(arm.wrist.getWorldPosition(new THREE.Vector3())),
          weaponWorldPos: xyz(arm.weapon.getWorldPosition(new THREE.Vector3())),
        })),
        weaponTips: rig.weaponTips().map(xyz),
        legs: rig.legs.map((leg) => ({
          side: leg.side,
          foot: joint(leg.foot),
          worldPos: xyz(leg.foot.getWorldPosition(new THREE.Vector3())),
        })),
        motion,
      };
    },
    worldToScreen(x, z, y = 0.8) {
      return worldToScreen(
        x?.isVector3
          ? x
          : new THREE.Vector3(
              typeof x === "object" ? x.x : x,
              y,
              typeof x === "object" ? x.z : z,
            ),
      );
    },
    commandTap(x, z, enemyId) {
      const e = enemies.find((e) => e.id === enemyId);
      commandTap(
        typeof x === "object"
          ? new THREE.Vector3(x.x, 0, x.z)
          : new THREE.Vector3(x, 0, z),
        e,
      );
    },
    start: startGame,
    reset: startGame,
    pause: pauseGame,
    resume: resumeGame,
    roll(x = 0, z = -1) {
      roll(new THREE.Vector3(x, 0, z));
    },
    getBars() {
      return enemies.map((e) => {
        const bar = e.bar,
          fill = bar.userData.fill,
          width = bar.userData.width;
        bar.updateMatrixWorld(true);
        const screenPoint = (x, node, y = 0) =>
          worldToScreen(
            new THREE.Vector3(x, y, 0).applyMatrix4(node.matrixWorld),
          );
        const left = screenPoint(-width / 2, bar),
          right = screenPoint(width / 2, bar);
        const fillLeft = screenPoint(-width / 2, fill),
          fillRight = screenPoint(width / 2, fill);
        const back = bar.userData.back;
        const backLeft = screenPoint(-back.geometry.parameters.width / 2, bar),
          backRight = screenPoint(back.geometry.parameters.width / 2, bar),
          backTop = screenPoint(0, bar, back.geometry.parameters.height / 2),
          backBottom = screenPoint(
            0,
            bar,
            -back.geometry.parameters.height / 2,
          );
        const fillTop = screenPoint(
            0,
            fill,
            fill.geometry.parameters.height / 2,
          ),
          fillBottom = screenPoint(
            0,
            fill,
            -fill.geometry.parameters.height / 2,
          );
        const material = (mesh) => ({
          transparent: mesh.material.transparent,
          opacity: mesh.material.opacity,
          depthTest: mesh.material.depthTest,
          depthWrite: mesh.material.depthWrite,
          toneMapped: mesh.material.toneMapped,
          color: mesh.material.color.getHexString(),
          renderOrder: mesh.renderOrder,
        });
        return {
          id: e.id,
          type: e.type,
          hp: e.hp,
          maxHp: e.maxHp,
          state: e.state,
          ratio: healthRatio(e.hp, e.maxHp),
          visible: bar.visible,
          screen: {
            center: screenPoint(0, bar),
            left,
            right,
            width: Math.hypot(right.x - left.x, right.y - left.y),
            fullWidthPixels: Math.hypot(
              backRight.x - backLeft.x,
              backRight.y - backLeft.y,
            ),
            height: Math.hypot(
              backBottom.x - backTop.x,
              backBottom.y - backTop.y,
            ),
            backLeft,
            backRight,
            backTop,
            backBottom,
          },
          fill: {
            visible: fill.visible,
            scale: fill.scale.x,
            x: fill.position.x,
            height: Math.hypot(
              fillBottom.x - fillTop.x,
              fillBottom.y - fillTop.y,
            ),
            top: fillTop,
            bottom: fillBottom,
            left: fillLeft,
            right: fillRight,
            width: Math.hypot(
              fillRight.x - fillLeft.x,
              fillRight.y - fillLeft.y,
            ),
          },
          materials: {
            back: material(bar.userData.back),
            fill: material(fill),
            groupOrder: bar.renderOrder,
          },
        };
      });
    },
    damageEnemy(id, amount) {
      const e = enemies.find((enemy) => enemy.id === id);
      if (!e || e.state === "dead" || !Number.isFinite(amount) || amount <= 0)
        return false;
      if (e.state === "spawn") e.state = "idle";
      return hurtEnemy(e, amount, hero.pos, 1);
    },
    positionEnemy(id, x, z) {
      const e = enemies.find((enemy) => enemy.id === id);
      if (
        !e ||
        e.state === "dead" ||
        !Number.isFinite(x) ||
        !Number.isFinite(z)
      )
        return false;
      e.pos.set(x, 0, z);
      clampPosition(e.pos, e.radius);
      e.velocity.set(0, 0, 0);
      e.rig.group.position.copy(e.pos);
      updateEnemyBar(e);
      return true;
    },
    getTargets() {
      return enemies
        .filter((e) => e.state !== "dead")
        .map((e) => ({
          id: e.id,
          type: e.type,
          x: e.pos.x,
          z: e.pos.z,
          hp: e.hp,
          state: e.state,
          screen: worldToScreen(
            e.pos.clone().add(new THREE.Vector3(0, 0.8, 0)),
          ),
        }));
    },
    forceWave(index = 3) {
      if (mode !== "playing") startGame();
      for (const e of enemies) {
        disposeGroup(e.rig.group, false);
        disposeGroup(e.bar);
      }
      enemies = [];
      kills = index === 1 ? 0 : index === 2 ? 10 : 22;
      spawnWave(THREE.MathUtils.clamp(index, 1, 3));
    },
    killAll() {
      for (const e of enemies) {
        if (e.state === "spawn") e.state = "idle";
        hurtEnemy(e, e.hp + 1, hero.pos, 2, true);
      }
    },
    damage(amount = 10) {
      hero.invulnerable = 0;
      damageHero(amount, hero.pos.clone().add(new THREE.Vector3(1, 0, 0)));
    },
    setStamina(stamina = 100) {
      if (Number.isFinite(stamina)) hero.stamina = THREE.MathUtils.clamp(stamina, 0, 100);
    },
  };
}
