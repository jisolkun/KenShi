import * as THREE from "three";
import { createCharacter, poseCharacter } from "./characters.js";
import { createWorld } from "./world.js";
import { createUI } from "./ui.js";
import { createAudio } from "./audio.js";
import { createEffects } from "./effects.js";
import { requestMobileFullscreen } from "./fullscreen.js";
import { WEAPONS, getWeapon, DEFAULT_WEAPON_ID, isWeaponUnlocked } from "./weapons.js";
import { createWeaponEffects } from "./weaponEffects.js";
import { resolveGreatDaoStep } from "./greatDaoMovement.js";
import { getSourceAttackProfile, getSourceAttackTiming } from "./sourceMotion/catalogue.js";
import { createSourceAttackClock, advanceSourceAttackClock, sampleSourceAttackClock } from "./sourceMotion/clock.js";
import { getSourceAttackRule, createSourceAttackVolumes, advanceSourceAttackVolumes, sourceVolumeContains, sourceForceTravel } from "./sourceMotion/combat.js";
import { createWeaponFeedback } from "./sourceMotion/weaponFeedback.js";
import { createWeaponImpact } from "./sourceMotion/weaponImpact.js";
import { getSourceCameraImpulse, lerpSourceCameraOffset } from "./sourceMotion/impact.js";
import { sampleWeaponContact } from "./sourceMotion/contact.js";
import { createEnemyFinishers } from "./enemyFinishers.js";
import {HAMMER_ID} from './customHammer/definition.js';
import {clipHammerSweep,hammerSweepContact,hammerGroundContact} from './customHammer/combat.js';
import {createHammerFeedback} from './customHammer/feedback.js';
import {sampleHammerTravel} from './customHammer/pose.js';
import {resolveHammerStep} from './customHammer/movement.js';
import { isCombatTarget, referenceAttackSensorTargets,
  sourceAttackDirectionAllowed,
  projectWalkablePoint } from "./heroAI.js";
import { createHeroControl, resetHeroControl, resetHeroAttackFamily,
  sampleHeroMovement, stepHeroMovement, selectHeroAttack, startHeroAttack, stepHeroCombo,
  clearHeroCombo, disableHeroSensor } from "./referenceHeroControl.js";
import "./style.css";

const isHeavyWeapon = id => id === 'great-dao' || id === HAMMER_ID;

const app = document.querySelector("#app") || document.body;
const canvas = document.createElement("canvas");
canvas.className = "game-canvas";
canvas.setAttribute("aria-label", "亡灵杀手战场，点击或按住调整移动方向，前方接敌自动攻击，双击翻滚");
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
// Unlock on the same user gesture that opens or replays the armory, so its
// first demonstration is audible before entering the battlefield.
document.addEventListener('pointerdown',()=>audio.unlock?.(),{capture:true,passive:true});
document.addEventListener('keydown',()=>audio.unlock?.(),{capture:true});
const fx = createEffects(scene, camera);
const weaponFx = createWeaponEffects(scene, fx);
const sourceFx = createWeaponFeedback(scene);
const sourceImpact = createWeaponImpact(scene);
const hammerFeedback = createHammerFeedback(scene);
const enemyFinishers = createEnemyFinishers(scene);
const sourceCameraOffset = new THREE.Vector3();
let sourceStrokes = [], sourceForces = [], sourceHitParity = 0, sourceStrokeSerial = 0;
let storedWeaponId = DEFAULT_WEAPON_ID;
try { storedWeaponId = localStorage.getItem("undead-slayer-weapon") || DEFAULT_WEAPON_ID; } catch {}
let currentWeapon = getWeapon(isWeaponUnlocked(storedWeaponId) ? storedWeaponId : DEFAULT_WEAPON_ID);

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
  control: createHeroControl({ comboCount: currentWeapon.moves.length }),
  gaitPhase: 0,
  moveBlend: 0,
  turnLean: 0,
  attackCarry: 0,
  attackStep: null,
  attackStepPhase: 0,
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
  hitDone: false,
  invulnerable: 0,
  flash: 0,
  hp: 120,
  maxHp: 120,
  stamina: 100,
  target: null,
  attackTarget: null,
  attackEndRendered: false,
  destination: null,
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
// A released press leaves a direction and a decaying speed factor. The ground
// marker is presentation only; it is never fed back into the controller.
function sampleContinuousHeroInput() {
  const keyboard = keyboardDirection();
  if (keyboard.lengthSq() > 0) {
    sampleHeroMovement(hero.control, hero.pos, {
      x: hero.pos.x + keyboard.x * 2,
      z: hero.pos.z + keyboard.z * 2,
    });
    hero.destination = null;
    destinationMarker.visible = false;
    return;
  }
  if (pointerStart && !pointerStart.doubleTap && mode === "playing") {
    const point = pointFromEvent({ clientX: pointerStart.currentX,
      clientY: pointerStart.currentY });
    if (point) {
      sampleHeroMovement(hero.control, hero.pos, point);
      pointerStart.sampled = true;
    }
  }
}
function locomotion(dt, maxSpeed) {
  const previousAngle = hero.angle;
  const movement = stepHeroMovement(hero.control, hero.angle, dt, maxSpeed);
  hero.angle = movement.angle;
  hero.moveVelocity.set((movement.direction?.x || 0) * movement.speed, 0,
    (movement.direction?.z || 0) * movement.speed);
  if (movement.distance > 0) {
    // Sweep the body displacement so source-style movement cannot jump across
    // props or living bodies during a slow frame. The reference injects its
    // character controller into ordinary movement, including attack recovery.
    const resolveStep=currentWeapon.customMotion?resolveHammerStep:resolveGreatDaoStep;
    const resolved = resolveStep(hero.pos, {
      x: hero.moveVelocity.x * dt, z: hero.moveVelocity.z * dt,
    }, { obstacles: world.obstacles, bounds: world.bounds,
      targets: enemies.filter(enemy => isCombatTarget(enemy, enemies)).map(enemy => ({
        x: enemy.pos.x, z: enemy.pos.z, radius: enemy.radius,
      })),
    });
    hero.pos.set(resolved.x, 0, resolved.z);
  }
  const delta = Math.atan2(Math.sin(hero.angle - previousAngle),
    Math.cos(hero.angle - previousAngle));
  hero.turnLean = THREE.MathUtils.lerp(hero.turnLean,
    THREE.MathUtils.clamp(dt > 0 ? delta / dt * .04 : 0, -1, 1),
    1 - Math.exp(-dt * 12));
  if (movement.action === "idle") {
    hero.destination = null;
    destinationMarker.visible = false;
  }
  return movement;
}
function locomotionState() {
  hero.state = hero.moveVelocity.length() > 0.12
    ? (hero.control.locomotion === 'walk' ? 'walk' : 'run') : 'idle';
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
      attackPhase: hero.state === 'attack' ? Math.min(1, hero.elapsed / hero.duration) : 0,
      attackDuration: hero.state === 'attack' ? hero.duration : 0,
      sourceAttack:hero.state==='attack'&&hero.sourceClock?{segment:hero.sourceClock.segment,rawTime:hero.sourceClock.rawTime}:null,
      target: hero.target?.id ?? null,
      aiTarget: null,
      control: { direction: { ...hero.control.direction }, speedFactor: hero.control.speedFactor,
        comboTime: hero.control.comboTime, cursor: hero.control.cursor,
        sensorEnabled: hero.control.sensorEnabled, locomotion: hero.control.locomotion },
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
  cancelHeroPress();
  mode = "pause";
  audio.pause?.();
  keys.clear();
  ui.showScreen(screen, stateSnapshot());
}
function resumeGame() {
  if (mode !== "pause") return;
  mode = "playing";
  audio.resume?.();
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
  sourceFx.clear();
  sourceImpact.clear();
  hammerFeedback.clear();
  enemyFinishers.clear();
  sourceStrokes = []; sourceForces = [];
  sourceCameraOffset.set(0,0,0);
  hero.sourceClock = null; hero.previewClock = null; hero.previewIndex = 0; hero.sourceStepTimes = new Map(); hero.sourceAirborne=false;
  world.clearCombat?.();
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
  hero.state='idle'; hero.elapsed=0; hero.duration=0; hero.attackTarget=null;
  hero.control.sensorEnabled=true; hero.control.sensorInside.clear(); hero.control.locomotion='idle';
  resetHeroAttackFamily(hero.control);
  hero.control.comboCount=currentWeapon.moves.length;
  if(currentWeapon.customMotion)clearHeroCombo(hero.control);
  hero.attackHits.clear();
  hero.previewAge = preview && mode === "start" ? 0 : Infinity;
  hero.attackStep = null;
  hero.attackStepPhase = 0;
  hero.previewStepIndex = -1;
  rig.attackFootTargets = null;
  if (rig.motion) rig.motion.attackFootwork = null;
  if (preview && mode === 'start') {
    hero.pos.set(0, 0, 4);
    hero.moveVelocity.set(0, 0, 0);
    hero.gaitPhase = 0;
    rig.group.position.copy(hero.pos);
    cameraFocus.set(hero.pos.x, 1.05, hero.pos.z);
    shake = 0;
    updateCamera(0);
  }
  hero.reviewedPrevious = null;
  hero.strokeContacts.clear();
  hero.trailSeries++;
  if (mode === "start") hero.angle = cameraSettings.yaw + 0.24;
  hero.previewContact = -1;
  fx.clear();
  weaponFx.clear();
  sourceFx.clear();
  sourceImpact.clear();
  hammerFeedback.clear();
  sourceStrokes = []; sourceForces = [];
  sourceCameraOffset.set(0,0,0);
  hero.sourceClock = null; hero.previewClock = null; hero.previewIndex = 0; hero.sourceStepTimes = new Map(); hero.sourceAirborne=false;
  ui.setWeapon(currentWeapon.id);

  try { localStorage.setItem("undead-slayer-weapon", currentWeapon.id); } catch {}
}
function chooseWeapon(id = currentWeapon.id) {
  if (!isWeaponUnlocked(id)) return false;
  audio.resume?.();
  mode = "start";
  keys.clear();
  cancelHeroPress();
  clearDynamic();
  damageQueue.length = 0;
  hero.pos.set(0, 0, 4);
  hero.angle = Math.PI;
  hero.state = "idle";
  hero.elapsed = 0;
  hero.duration = 0;
  hero.target = null;
  hero.attackTarget = null;
  resetHeroControl(hero.control, { comboCount: currentWeapon.moves.length });
  if(currentWeapon.customMotion)clearHeroCombo(hero.control);
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
  audio.resume?.();
  keys.clear();
  cancelHeroPress();
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
  hero.hp = 120;
  hero.stamina = 100;
  hero.invulnerable = 1.3;
  hero.flash = 0;
  hero.target = null;
  hero.attackTarget = null;
  resetHeroControl(hero.control, { comboCount: currentWeapon.moves.length });
  if(currentWeapon.customMotion)clearHeroCombo(hero.control);
  hero.destination = null;
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
  cancelHeroPress();
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
  hero.combo = selectHeroAttack(hero.control);
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
  hero.attackCarry = 0;
  hero.moveVelocity.set(0, 0, 0);
  hero.attackTarget = enemy;
  hero.nextAttackIn = .05;
  if (isCombatTarget(enemy, enemies)) face(enemy.pos.clone().sub(hero.pos), 1);
  startHeroAttack(hero.control, hero.combo, hero.angle);
  hero.attackStep = null;
  hero.sourceClock = beginSourceStroke(hero.combo);
  if(currentWeapon.customMotion) {
    hero.attackStep={angle:hero.angle,progress:0,previousTravel:{forward:0,lateral:0},resolvedLocal:{forward:0,lateral:0},
      feet:rig.legs.map(leg=>leg.foot.getWorldPosition(new THREE.Vector3()))};
  }
  hero.attackStepPhase = 0;
  destinationMarker.visible = !!hero.destination;
}
function beginSourceStroke(comboIndex, preview = false) {
  const clock = createSourceAttackClock(currentWeapon.id,comboIndex);
  advanceSourceAttackClock(clock,0);
  const timing = getSourceAttackTiming(currentWeapon.id,comboIndex);
  if(currentWeapon.customMotion) {
    safeAudio('weaponReady',currentWeapon.id,comboIndex);
    sourceStrokes.push({id:++sourceStrokeSerial,custom:true,clock,
      weaponId:currentWeapon.id,combo:comboIndex,move:currentWeapon.moves[comboIndex],preview,
      previous:rig.weaponBlades()[0],previousPhase:0,hitTargets:new Set(),released:false,ground:false});
    return clock;
  }
  const rule = getSourceAttackRule(currentWeapon.id,comboIndex,timing.atkspd);
  const volumes = createSourceAttackVolumes(currentWeapon.id,comboIndex,timing.atkspd);
  safeAudio('weaponReady',currentWeapon.id,comboIndex);
  sourceStrokes.push({id:++sourceStrokeSerial,volumes,weaponId:currentWeapon.id,combo:comboIndex,
    move:currentWeapon.moves[comboIndex],rising:rule.rising,preview});
  // Weapon-specific visuals observe the same clocks as the reference damage
  // sensors. Their pooling never cancels a sensor or prolongs its lifetime.
  for (const volume of volumes) sourceFx.emit(rig.group,volume.descriptor,volume,rig);
  if (!preview && rule.startForce) sourceForces.push({force:rule.startForce,age:0,angle:hero.angle});
  return clock;
}
function advanceSourceForces(dt,preview=false) {
  if (!(dt>0)) return;
  const displacement = new THREE.Vector3();
  for (const impulse of sourceForces) {
    const before = impulse.age; impulse.age += dt;
    const travel=sourceForceTravel(impulse.force,impulse.age)-sourceForceTravel(impulse.force,before);
    displacement.x += Math.sin(impulse.angle)*travel;
    displacement.z += Math.cos(impulse.angle)*travel;
  }
  sourceForces=sourceForces.filter(impulse=>impulse.age<1.5);
  const resolved=resolveGreatDaoStep(hero.pos,displacement,{obstacles:world.obstacles,bounds:world.bounds,
    targets:preview?[]:enemies.filter(e=>isCombatTarget(e,enemies)).map(e=>({x:e.pos.x,z:e.pos.z,radius:e.radius}))});
  hero.moveVelocity.x += (resolved.x-hero.pos.x)/dt;
  hero.moveVelocity.z += (resolved.z-hero.pos.z)/dt;
  hero.pos.set(resolved.x,0,resolved.z);
}
function advanceHammerRoot(dt) {
  const step=hero.attackStep;
  if(!currentWeapon.customMotion||hero.state!=='attack'||!step||!(dt>0))return;
  const travel=sampleHammerTravel(hero.combo,hero.sourceClock.phase);
  const previous=step.previousTravel??{forward:0,lateral:0};
  const forward=travel.forward-previous.forward,lateral=travel.lateral-previous.lateral;
  step.previousTravel=travel;
  const sine=Math.sin(step.angle),cosine=Math.cos(step.angle);
  const displacement={x:sine*forward+cosine*lateral,z:cosine*forward-sine*lateral};
  const resolved=resolveHammerStep(hero.pos,displacement,{obstacles:world.obstacles,bounds:world.bounds,
    targets:enemies.filter(e=>isCombatTarget(e,enemies)).map(e=>({x:e.pos.x,z:e.pos.z,radius:e.radius}))});
  const dx=resolved.x-hero.pos.x,dz=resolved.z-hero.pos.z;
  step.resolvedLocal.forward+=dx*sine+dz*cosine;
  step.resolvedLocal.lateral+=dx*cosine-dz*sine;
  hero.moveVelocity.x+=dx/dt;hero.moveVelocity.z+=dz/dt;
  hero.pos.set(resolved.x,0,resolved.z);
}
function heroAttackCandidate() {
  if (!hero.control.sensorEnabled || hero.nextAttackIn > 0 ||
      hero.state === 'roll' || hero.state === 'hurt' || hero.state === 'dead' ||
      hero.hp <= 0) return null;
  const sensor = referenceAttackSensorTargets({
    position: hero.pos,
    angle: hero.angle,
    enemies,
    weaponId: currentWeapon.id,
    previousInside: hero.control.sensorInside,
  });
  hero.control.sensorInside = sensor.inside;
  // The reference loop has two paths: OnTriggerEnter catches a newly
  // entering body while the final player-movement block also checks the
  // nearest body every frame. The latter is what keeps a close target's
  // ordinary combo running after the first stroke.
  const entered = sensor.entered || sensor.near[0];
  if (!entered) return null;
  // Cha_Control rejects an entered body when the input direction points away
  // from it. It disables the sensor until the next run/walk state entry
  // of turning the hero around or pursuing the body.
  if (!sourceAttackDirectionAllowed({
    position: hero.pos,
    target: entered,
    moveDirection: hero.control.direction,
  })) {
    disableHeroSensor(hero.control);
    return null;
  }
  return entered;
}

function hurtEnemy(e,damage,from,force=1,critical=false,playerContact=false,cutDirection=null,contactPoint=null,sourceContact=null) {
  if (e.state==='dead'||e.state==='spawn') return false;
  e.hp=Math.max(0,e.hp-damage); updateEnemyBar(e); e.flash=1;
  temp.subVectors(e.pos,from);
  if(temp.lengthSq()<.01) temp.set(Math.sin(hero.angle),0,Math.cos(hero.angle));
  temp.normalize();
  const direction=sourceContact?.direction?.clone() ?? temp.clone();
  const knockback=sourceContact?.knockback ?? temp;
  e.hurtDirection=Math.sin(Math.atan2(knockback.x,knockback.z)-e.angle);
  e.hurtVertical=sourceContact?.rising?.65:0;
  e.hurtStrength=critical?1.15:.8;
  e.localHitStop=sourceContact?0:Math.max(e.localHitStop||0,.027);
  e.velocity.addScaledVector(knockback,force*(e.type==='boss'?.4:1));
  if(sourceContact?.rising&&sourceContact.weaponId!==HAMMER_ID&&e.type!=='boss') e.sourceAirTime=0;
  showDamage(e,damage,critical?'critical':'normal');
  if(sourceContact) {
    sourceImpact.hit(contactPoint??e.pos.clone().add(new THREE.Vector3(0,.9,0)),direction,
      sourceContact.weaponId,sourceContact.combo,critical,e.rig);
    sourceCameraOffset.copy(getSourceCameraImpulse(sourceContact.layer,sourceHitParity++));
    safeAudio('weaponHit',sourceContact.weaponId,critical?1.25:.8,sourceContact.combo);
  } else {
    fx.impact?.(e.pos.clone().add(new THREE.Vector3(0,1.05,0)),direction,critical?1.2:.75,critical);
    safeAudio('hit',critical?1.5:.75,hero.combo);
  }
  combo++; comboTimeout=3;
  if(e.hp<=0) {
    e.state='dead'; e.elapsed=0; e.duration=1.5; e.bar.visible=false;
    kills++; dropLoot(e.pos); e.deathDirection=direction; e.deathImpactDone=false; safeAudio('kill');
    if(sourceContact) {
      e.rig.setFlash?.(0);
      if(sourceContact.weaponId===HAMMER_ID){e.velocity.set(0,0,0);e.sourceAirTime=undefined;}
      e.finisher=enemyFinishers.breakEnemy(e.rig,{weaponId:sourceContact.weaponId,combo:sourceContact.combo,
        direction,contactPoint,cutNormal:sourceContact.cutNormal,critical});
      e.deathImpactDone=!!e.finisher;
    }
    if(e.type==='boss'){slowTime=.24;slowScale=.5;}
    if(hero.target===e)hero.target=null;
    return true;
  }
  if(e.type==='boss') {
    if(!critical||(e.poise||0)>0)return true;
    e.poise=3.2;
  }
  e.state='hurt';e.elapsed=0;e.duration=e.type==='boss'?.16:.32;e.cooldown=Math.max(e.cooldown,.7);
  return true;
}
function playSourceFootsteps() {
  const previous=hero.sourceStepTimes??=new Map();
  for(const entry of rig.sourceMotionDebug?.locomotion??[]) {
    const old=previous.get(entry.state)??entry.rawTime;
    previous.set(entry.state,entry.rawTime);
    const profile=entry.state==='run'?{length:.3333333134651184,events:[.13333334028720856,.30000001192092896]}
      :entry.state==='walk'&&currentWeapon.id!=='dual-dao'
      ?{length:.46666669845581055,events:[.23333333432674408,.46666666865348816]}:null;
    if(!profile||entry.rawTime<=old||entry.weight<=0)continue;
    if(profile.events.some(event=>Math.floor((entry.rawTime-event)/profile.length)>Math.floor((old-event)/profile.length)))safeAudio('footstep',.6);
  }
}
function playSourceLanding() {
  const minimum=rig.sourcePose?.footMinY;
  if(!Number.isFinite(minimum)){hero.sourceAirborne=false;return;}
  if(minimum>(currentWeapon.customMotion ? .18 : .09))hero.sourceAirborne=true;
  else if(hero.sourceAirborne&&minimum<(currentWeapon.customMotion ? .078 : .035)) {
    hero.sourceAirborne=false;
    safeAudio('landing',1);
  }
}
function updateSourceCombat(dt) {
  if (!(dt>0)) return;
  playSourceLanding();
  for(const stroke of sourceStrokes) {
    if(stroke.custom) {updateHammerCombat(stroke,dt);continue;}
    const result=advanceSourceAttackVolumes(stroke.volumes,dt,rig.group);
    for(const {descriptor,addForce} of result.onsets) {
      if(!stroke.preview&&addForce) sourceForces.push({force:addForce,age:0,angle:hero.angle});
      safeAudio('weaponSlash',stroke.weaponId,stroke.combo,descriptor.type);
    }
    const blades=stroke.combo===hero.combo&&stroke.weaponId===currentWeapon.id ? rig.weaponBlades() : [];
    if(result.active.length&&blades.length) {
      for(const frame of blades) {
        const previous=stroke.previousBlades?.find(old=>old.hand===frame.hand);
        world.reactToBlade?.({current:frame,previous,combo:stroke.combo,strikeId:stroke.id,origin:hero.pos,
          phase:hero.elapsed/Math.max(.001,hero.duration)});
      }
    }
    if(!stroke.preview&&mode==='playing') for(const volume of result.active) {
      for(const enemy of enemies) {
        if(!isCombatTarget(enemy,enemies)||volume.hitTargets.has(enemy.id))continue;
        const air=Number.isFinite(enemy.sourceAirTime)?Math.sin(Math.PI*Math.min(1,enemy.sourceAirTime/.55))*.65:0;
        if(!sourceVolumeContains(volume,{...enemy,colliderHeight:.9+air},rig.group))continue;
        volume.hitTargets.add(enemy.id);
        const critical=stroke.combo===4||Math.random()<.12;
        const frame=blades.find(sample=>sample.hand===volume.descriptor.hand) ?? blades[0];
        const previous=stroke.previousBlades?.find(sample=>sample.hand===frame?.hand);
        const contact=sampleWeaponContact({frame,previous,targetRig:enemy.rig,targetPosition:enemy.pos,
          attackerPosition:hero.pos,angle:hero.angle});
        hurtEnemy(enemy,Math.round(stroke.move.damage*(critical?1.25:1)),hero.pos,
          stroke.move.knockback*(stroke.rising?4:3),critical,true,null,contact.point,
          {...contact,weaponId:stroke.weaponId,combo:stroke.combo,layer:volume.descriptor.layer,rising:stroke.rising});
      }
    }
    if(blades.length)stroke.previousBlades=blades;
    stroke.finished=result.finished;
  }
  sourceStrokes=sourceStrokes.filter(stroke=>!stroke.finished);
  sourceFx.update(dt);
}
function updateHammerCombat(stroke,dt) {
  const owner=stroke.preview?hero.previewClock:hero.sourceClock;
  if(owner!==stroke.clock||hero.state!=='attack'||hero.combo!==stroke.combo) {stroke.finished=true;return;}
  const frame=rig.weaponBlades()[0],phase=stroke.clock.phase;
  if(!frame?.headCenter){stroke.finished=true;return;}
  const sweep=clipHammerSweep(frame,stroke.previous,phase,stroke.previousPhase,stroke.move.active);
  hammerFeedback.trace({frame,previous:stroke.previous,dt,
    active:phase>=.12&&phase<=stroke.move.recoverAt*.98,
    combo:stroke.combo,strikeId:stroke.id});
  if(!stroke.released&&phase>=stroke.move.active[0]) {
    stroke.released=true;safeAudio('weaponSlash',stroke.weaponId,stroke.combo);
  }
  if(sweep) {
    if(stroke.combo===2&&!stroke.ground) {
      const point=hammerGroundContact(sweep.current,sweep.previous);
      if(point) {
        stroke.ground=true;
        const direction=frame.headCenter.clone().sub(stroke.previous?.headCenter??frame.headCenter);
        hammerFeedback.ground({point,direction,combo:stroke.combo,strikeId:stroke.id});
        safeAudio('weaponGround',stroke.weaponId,stroke.combo);
        if(!stroke.preview)kickCamera(new THREE.Vector3(Math.sin(hero.angle),0,Math.cos(hero.angle)),.08);
      }
    }
    if(!stroke.preview&&mode==='playing')for(const enemy of enemies) {
      if(!isCombatTarget(enemy,enemies)||stroke.hitTargets.has(enemy.id))continue;
      const lift=Number.isFinite(enemy.sourceAirTime)?Math.sin(Math.PI*Math.min(1,enemy.sourceAirTime/.55))*.65:0;
      const physical=hammerSweepContact(sweep.current,sweep.previous,{x:enemy.pos.x,z:enemy.pos.z,
        radius:enemy.radius,minY:enemy.pos.y+.12+lift,maxY:enemy.pos.y+1.78*enemy.rig.group.scale.y+lift});
      if(!physical)continue;
      stroke.hitTargets.add(enemy.id);
      const contact=sampleWeaponContact({frame:sweep.current,previous:sweep.previous,targetRig:enemy.rig,
        targetPosition:enemy.pos,attackerPosition:hero.pos,angle:hero.angle});
      contact.point=physical.point;
      const critical=stroke.combo===2||Math.random()<.08;
      hurtEnemy(enemy,Math.round(stroke.move.damage*(critical?1.18:1)),hero.pos,
        stroke.move.knockback*2.25,critical,true,null,contact.point,
        {...contact,weaponId:HAMMER_ID,combo:stroke.combo,layer:21,rising:stroke.combo===1});
    }
  }
  stroke.previous=frame;stroke.previousPhase=phase;stroke.finished=stroke.clock.done;
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
  hero.attackTarget = null;
  disableHeroSensor(hero.control);
  clearHeroCombo(hero.control);
  hero.elapsed = 0;
  hero.duration = 0.24;
  hero.destination = null;
  destinationMarker.visible = false;
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

function commandTap(position, { sample = true, count = true } = {}) {
  if (mode !== "playing" || hero.hp <= 0 || hero.state === "hurt" || hero.state === "roll") return;
  if (count) metrics.taps++;
  audio.unlock?.();
  const p = position.clone
    ? position.clone()
    : new THREE.Vector3(position.x, 0, position.z);
  // The source raycasts ground even over an enemy. A point marks the input;
  // it does not lock a victim or remain an autonomous movement destination.
  if (sample) sampleHeroMovement(hero.control, hero.pos, p);
  hero.target = null;
  hero.destination = p;
  destinationMarker.visible = true;
  destinationMarker.position.set(p.x, 0.045, p.z);
  destinationMarker.scale.setScalar(1);
  targetMarker.visible = false;
}
function roll(direction) {
  if (mode !== "playing" || hero.hp <= 0 || hero.stamina < 23 ||
      hero.state === "roll" || hero.state === "hurt" || hero.state === "dead") return false;
  const d = direction?.clone() ||
    new THREE.Vector3(Math.sin(hero.angle), 0, Math.cos(hero.angle));
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
  face(d, 1);
  sampleHeroMovement(hero.control, hero.pos,
    { x: hero.pos.x + d.x * 2, z: hero.pos.z + d.z * 2 });
  clearHeroCombo(hero.control);
  disableHeroSensor(hero.control);
  hero.invulnerable = 0.48;
  hero.destination = null;
  hero.target = null;
  hero.attackTarget = null;
  targetMarker.visible = false;
  destinationMarker.visible = false;
  safeAudio("roll");
  fx.ring(hero.pos, 0.8, 0xcbb99a, 0.25);
  return true;
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
  hero.nextAttackIn = Math.max(0, hero.nextAttackIn - dt);
  sampleContinuousHeroInput();
  hero.velocity.multiplyScalar(Math.exp(-dt * 10));
  hero.pos.addScaledVector(hero.velocity, dt);
  if (hero.attackTarget && !isCombatTarget(hero.attackTarget, enemies)) hero.attackTarget = null;
  const maxSpeed = currentWeapon.customMotion ? 6.25 : 5.8 * (0.88 + currentWeapon.stats.speed * 0.024);
  function navigate() {
    locomotion(dt, maxSpeed);
    locomotionState();
    hero.attackTarget = null;
  }
  if (hero.state === "roll") {
    const phase = Math.min(1, hero.elapsed / hero.duration);
    move(hero.pos, hero.rollDirection, 13 * (1 - phase * 0.45), dt);
    hero.ghostTimer -= dt;
    if (hero.ghostTimer <= 0 && dt > 0) {
      fx.ghost(hero.rig);
      hero.ghostTimer = 0.09;
    }
    if (phase >= 1) navigate();
  } else if (hero.state === "attack") {
    const native=advanceSourceAttackClock(hero.sourceClock,dt);
    hero.elapsed=native.elapsed;
    const recovering=native.recovering||native.done;
    stepHeroCombo(hero.control,dt,{attacking:true,combo:hero.combo,recovering});
    // Layer0 locomotion resumes below the uninterrupted layer1 recovery.
    // A fresh ordinary attack immediately replaces that upper layer.
    if(recovering) locomotion(dt,maxSpeed);
    else hero.moveVelocity.set(0,0,0);
    if(recovering) {
      const enemy=heroAttackCandidate();
      if(enemy)beginAttack(enemy);
      else if(native.done){hero.attackTarget=null;locomotionState();}
    }
  } else if (hero.state === "hurt" || hero.state === "dead") {
    stepHeroCombo(hero.control, dt, { attacking: false, combo: hero.combo });
    hero.moveVelocity.set(0, 0, 0);
    if (hero.state === "hurt" && hero.elapsed >= hero.duration) navigate();
    if (hero.state === "dead" && hero.elapsed >= hero.duration) finishGame(false);
  } else {
    stepHeroCombo(hero.control, dt, { attacking: false, combo: hero.combo });
    navigate();
    const enemy = heroAttackCandidate();
    if (enemy) beginAttack(enemy);
  }
  advanceHammerRoot(dt);
  advanceSourceForces(dt);
  clampPosition(hero.pos);
  if (hero.state !== 'attack') hero.attackStep = null;
  hero.attackCarry=hero.state==='attack'?THREE.MathUtils.clamp(hero.moveVelocity.length()/maxSpeed,0,1):0;
  const moved = hero.pos.distanceTo(previousPosition);
  const locomoting =
    hero.state === "run" ||
    hero.state === "walk" ||
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
    attackStep: hero.attackStep,
    sourceAttack: hero.state==='attack'?sampleSourceAttackClock(hero.sourceClock):null,
    sourceLocomotion: hero.control.locomotion,
    speedFactor: hero.control.speedFactor,
    hurtDirection: hero.hurtDirection || 0,
    hurtStrength: hero.hurtStrength || 0,
  });
  hero.rig.group.updateMatrixWorld(true);
  if(currentWeapon.customMotion)hammerFeedback.movement?.({position:hero.pos,direction:hero.moveVelocity,
    speed:hero.actualSpeed,dt,grounded:(rig.sourcePose?.footMinY??0)<.10});
  playSourceFootsteps();
  updateSourceCombat(dt);

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
      if (!e.finisher && e.deathAge >= 0.5 && !e.deathImpactDone) {
        e.deathImpactDone = true;
        fx.death?.(e.pos, e.deathDirection, e.type === "boss" ? 1.5 : 0.8);
      }
      e.bar.visible = false;
      e.pos.addScaledVector(e.velocity, tickDt);
      if (!e.finisher && e.deathAge > 0.9)
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
    if (e.finisher) continue;
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
    if(Number.isFinite(e.sourceAirTime)) {
      e.sourceAirTime+=tickDt;
      e.rig.group.position.y+=Math.sin(Math.PI*Math.min(1,e.sourceAirTime/.55))*.65;
      if(e.sourceAirTime>=.55)e.sourceAirTime=undefined;
    }
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
      combo: ((e.combo % 5) + 5) % 5,
      speed,
      skill: e.attackKind,
      dt: tickDt,
      gaitPhase: e.gaitPhase || 0,
      moveBlend: e.moveBlend,
      alertness: 0.7,
      hurtDirection: e.hurtDirection || 0,
      hurtStrength: e.hurtStrength || 0,
      hurtVertical: e.hurtVertical || 0,
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
canvas.addEventListener("pointerdown", (event) => {
  if (mode !== "playing" || pointerStart || (event.button && event.button !== 0)) return;
  const point = pointFromEvent(event);
  if (!point) return;
  audio.unlock?.();
  pointerStart = {
    currentX: event.clientX, currentY: event.clientY,
    id: event.pointerId, sampled: false, doubleTap: false,
  };
  canvas.setPointerCapture(event.pointerId);
  // The reference compares taps in simulation time and starts dodge on the
  // second press. A browser dblclick has a different window, so use one path.
  if (lastTap && globalTime - lastTap.time < .15 && roll(point.clone().sub(hero.pos))) {
    pointerStart.doubleTap = true;
    lastTap = null;
  }
});
canvas.addEventListener("pointermove", (event) => {
  if (!pointerStart || event.pointerId !== pointerStart.id) return;
  pointerStart.currentX = event.clientX;
  pointerStart.currentY = event.clientY;
});
canvas.addEventListener("pointerup", (event) => {
  if (!pointerStart || pointerStart.id !== event.pointerId) return;
  const press = pointerStart;
  pointerStart = null;
  if (mode !== "playing" || press.doubleTap) return;
  const point = pointFromEvent(event);
  if (!point) { lastTap = null; return; }
  commandTap(point, { sample: !press.sampled });
  lastTap = { time: globalTime };
});
function cancelHeroPress() {
  const id = pointerStart?.id;
  pointerStart = null;
  lastTap = null;
  if (id !== undefined && canvas.hasPointerCapture?.(id)) canvas.releasePointerCapture(id);
}
const cancelPointer = event => {
  if (pointerStart?.id === event.pointerId) cancelHeroPress();
};
canvas.addEventListener("pointercancel", cancelPointer);
canvas.addEventListener("lostpointercapture", cancelPointer);
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
      const direction = keyboard.lengthSq() > 0
        ? keyboard
        : new THREE.Vector3(hero.control.direction.x, 0, hero.control.direction.z);
      roll(direction);
    }
  }
});
window.addEventListener("keyup", (event) =>
  keys.delete(event.key.toLowerCase()),
);
window.addEventListener("blur", () => {
  keys.clear();
  cancelHeroPress();
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
  const followRate = currentWeapon.customMotion ? 8 : !preview && isHeavyWeapon(currentWeapon.id) && hero.state === 'attack' ? 3.8 : 7;
  cameraFocus.lerp(desired, 1 - Math.exp(-dt * followRate));
  shakeAge += dt;
  const amplitude = shake * Math.exp(-shakeAge * 19) * Math.sin(shakeAge * 58);
  lerpSourceCameraOffset(sourceCameraOffset,dt);
  const offset = shakeDirection.clone().multiplyScalar(amplitude).add(sourceCameraOffset);
  camera.position.copy(cameraFocus).add(cameraOffset).add(offset);
  camera.lookAt(cameraFocus.clone().add(offset));
  if (shakeAge > 0.3) shake = 0;
  camera.updateMatrixWorld(true);
}
function updatePresentation(dt) {
  let state=mode==='lose'?'dead':'idle',sample=null;
  if(mode==='start'&&Number.isFinite(hero.previewAge)) {
    hero.previewAge+=dt;
    if(hero.previewAge>=.18&&!hero.previewClock)hero.previewClock=beginSourceStroke(hero.previewIndex??0,true);
    if(hero.previewClock) {
      sample=advanceSourceAttackClock(hero.previewClock,dt);
      if(sample.done||(currentWeapon.customMotion&&sample.recovering&&(hero.previewIndex??0)<currentWeapon.moves.length-1)) {
        hero.previewIndex=(hero.previewIndex??0)+1;
        if(hero.previewIndex<currentWeapon.moves.length) {
          hero.previewClock=beginSourceStroke(hero.previewIndex,true);
          sample=sampleSourceAttackClock(hero.previewClock);
        } else {hero.previewClock=null;hero.previewAge=Infinity;sample=null;}
      }
      if(sample)state='attack';
    }
  }
  hero.state=state;hero.combo=sample?(hero.previewIndex??0):0;
  hero.elapsed=sample?.elapsed??0;hero.duration=sample?.duration??0;
  hero.moveVelocity.set(0,0,0);
  rig.group.position.copy(hero.pos);rig.group.rotation.y=hero.angle;
  poseCharacter(rig,{state,time:globalTime,dt,phase:sample?.progress??(state==='dead'?1:0),
    combo:hero.combo,sourceAttack:sample,sourceLocomotion:'idle',speedFactor:7,alertness:.25});
  rig.group.updateMatrixWorld(true);
  updateSourceCombat(dt);hammerFeedback.update(dt);sourceImpact.update(dt);enemyFinishers.update(dt);fx.update(dt);weaponFx.update(dt);
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
      if (!e.finisher) {
        e.rig.group.position.copy(e.pos);
        e.rig.group.position.y = -Math.min(2, Math.max(0, e.deathAge - 0.9) * 2);
        poseCharacter(e.rig, {
          state: "dead",
          time: globalTime,
          dt,
          phase: Math.min(1, e.elapsed / e.duration),
        });
      }
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
      const strikeStep = isHeavyWeapon(currentWeapon.id) ? 1 / 120 : .03;
      const steps = Math.ceil(dt / strikeStep),
        step = dt / steps;
      for (let i = 0; i < steps && mode === "playing"; i++) {
        globalTime += step;
        updateHero(step);
        updateEnemies(step);
        updateProjectiles(step);
        updateDrops(step);
        fx.update(step);
        weaponFx.update(step);
        hammerFeedback.update(step);
        sourceImpact.update(step);
        enemyFinishers.update(step);
      }
    }
    const markerTarget = hero.target;
    targetMarker.visible = !!markerTarget && markerTarget.state !== "dead";
    if (targetMarker.visible) {
      targetMarker.position.set(markerTarget.pos.x, 0.05, markerTarget.pos.z);
      targetMarker.scale.setScalar(
        markerTarget.type === "boss"
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
  fx.presented?.();
  weaponFx.presented?.();
  hammerFeedback.presented();
  sourceImpact.presented?.();
  world.presentedCombat?.();
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
    getCombatEffects: () => ({
      world: world.getCombatState?.() ?? null,
      weapon: weaponFx.getState?.() ?? null,
      source: sourceFx.diagnostics(),
      impacts: sourceImpact.snapshot(),
      hammer: hammerFeedback.diagnostics(),
      finishers: enemyFinishers.diagnostics(),
    }),
    positionPlayer(x, z) {
      if (mode !== 'playing' || !Number.isFinite(x) || !Number.isFinite(z)) return false;
      hero.pos.set(x, 0, z);
      clampPosition(hero.pos);
      hero.velocity.set(0, 0, 0);
      hero.moveVelocity.set(0, 0, 0);
      hero.target = hero.destination = null;
      resetHeroControl(hero.control, { comboCount: currentWeapon.moves.length });
      if(currentWeapon.customMotion)clearHeroCombo(hero.control);
      rig.group.position.copy(hero.pos);
      cameraFocus.copy(hero.pos);
      return true;
    },
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
        sourceMotion: rig.sourceMotionDebug,
        customMotion: rig.customHammerDebug,
        hammer:currentWeapon.customMotion?rig.weaponBlades().map(frame=>({
          center:xyz(frame.headCenter),quaternion:frame.headQuaternion.toArray(),
          halfExtents:frame.headHalfExtents.toArray(),minY:frame.headMinY,
          corners:frame.headCorners.map(xyz)})):null,
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
    commandTap(x, z) {
      commandTap(
        typeof x === "object"
          ? new THREE.Vector3(x.x, 0, x.z)
          : new THREE.Vector3(x, 0, z),
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
      enemyFinishers.clear();
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
