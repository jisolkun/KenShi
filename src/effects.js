import * as THREE from 'three';

const GOLD = 0xf2bc68;
const CYAN = 0x84d5cb;
const TAU = Math.PI * 2;
const ribbonVertex = `attribute float alpha; varying vec3 vColor; varying float vAlpha;
void main(){ vColor=color; vAlpha=alpha; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }`;
const ribbonFragment = `uniform vec3 tint; uniform float opacity; varying vec3 vColor; varying float vAlpha;
void main(){float a=vAlpha*opacity;if(a<0.008)discard;gl_FragColor=vec4(vColor*tint,a);
#include <tonemapping_fragment>
#include <colorspace_fragment>
}`;
const particleVertex = `attribute float size; attribute float alpha; attribute float kind; attribute float angle;
varying vec3 vColor; varying float vAlpha; varying float vKind; varying float vAngle;
void main(){vec4 p=modelViewMatrix*vec4(position,1.0);gl_Position=projectionMatrix*p;
gl_PointSize=clamp(size*560.0/max(1.0,-p.z),1.0,72.0);vColor=color;vAlpha=alpha;vKind=kind;vAngle=angle;}`;
const particleFragment = `varying vec3 vColor; varying float vAlpha; varying float vKind; varying float vAngle;
void main(){vec2 q=gl_PointCoord-0.5;float c=cos(vAngle),s=sin(vAngle);q=mat2(c,-s,s,c)*q;
float a;if(vKind>1.5){a=step(abs(q.x)*1.8+q.y,0.4)*step(-0.4,q.y);}else if(vKind>0.5){a=pow(max(0.0,1.0-length(q)*2.0),2.0);}else{a=pow(max(0.0,1.0-abs(q.x)*9.0-abs(q.y)*2.1),0.7);}
a*=vAlpha;if(a<0.01)discard;gl_FragColor=vec4(vColor,a);
#include <tonemapping_fragment>
#include <colorspace_fragment>
}`;

/** Short-lived meshes plus two pooled, batched particle clouds. */
export class CombatEffects {
  constructor(scene) {
    this.root = new THREE.Group();
    scene.add(this.root);
    this.effects = [];
    this.sparkLive = [];
    this.sparkPool = [];
    this.maxSparks = 560;
    this.maxEffects = 72;
    this.geometryCache = new Map();
    this.batches = [this.makeBatch(false), this.makeBatch(true)];
    this.tempColor = new THREE.Color();
  }
  makeBatch(dust) {
    const geometry = new THREE.BufferGeometry();
    for (const [name, itemSize] of [['position', 3], ['color', 3], ['size', 1], ['alpha', 1], ['kind', 1], ['angle', 1]]) {
      geometry.setAttribute(name, new THREE.BufferAttribute(new Float32Array(this.maxSparks * itemSize), itemSize).setUsage(THREE.DynamicDrawUsage));
    }
    geometry.setDrawRange(0, 0);
    const material = new THREE.ShaderMaterial({ vertexShader: particleVertex, fragmentShader: particleFragment, vertexColors: true,
      transparent: true, depthWrite: false, blending: dust ? THREE.NormalBlending : THREE.AdditiveBlending });
    const points = new THREE.Points(geometry, material);
    points.frustumCulled = false;
    points.renderOrder = dust ? 3 : 5;
    this.root.add(points);
    return points;
  }
  material(color, opacity = 1, additive = true) {
    return new THREE.ShaderMaterial({ vertexShader: ribbonVertex, fragmentShader: ribbonFragment,
      uniforms: { tint: { value: new THREE.Color(color) }, opacity: { value: opacity } }, vertexColors: true,
      transparent: true, side: THREE.DoubleSide, depthWrite: false,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending });
  }
  geometry(vertices, alphas, colors = null) {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
    geometry.setAttribute('alpha', new THREE.Float32BufferAttribute(alphas, 1));
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors || vertices.map(() => 1), 3));
    geometry.computeBoundingSphere();
    return geometry;
  }
  cached(key, build) {
    if (!this.geometryCache.has(key)) this.geometryCache.set(key, build());
    return this.geometryCache.get(key);
  }
  add(mesh, life, kind = 'flash', options = {}) {
    if (this.effects.length >= this.maxEffects) {
      const index = Math.max(0, this.effects.findIndex(effect => effect.kind !== 'label'));
      this.removeEffect(this.effects[index]);
      this.effects.splice(index, 1);
    }
    this.root.add(mesh);
    mesh.renderOrder = 4;
    const effect = { mesh, age: 0, life: Math.max(0.05, life), kind, scale: 1, opacity: mesh.material.uniforms?.opacity?.value ?? mesh.material.opacity, ...options };
    this.effects.push(effect);
    return effect;
  }
  particle(position, velocity, color, size, life, kind = 0, gravity = 12, drag = 1.8) {
    if (this.sparkLive.length >= this.maxSparks) return;
    const particle = this.sparkPool.pop() || { position: new THREE.Vector3(), velocity: new THREE.Vector3(), color: new THREE.Color() };
    particle.position.copy(position);
    particle.velocity.copy(velocity);
    particle.color.set(color);
    Object.assign(particle, { size, life, kind, gravity, drag, age: 0, angle: Math.random() * TAU });
    this.sparkLive.push(particle);
  }
  emit(position, color = GOLD, count = 12, power = 1) {
    const origin = position.clone();
    origin.y += 0.9;
    for (let i = 0; i < Math.min(count, 64); i++) {
      const angle = Math.random() * TAU;
      const speed = (1.5 + Math.random() * 4) * power;
      this.particle(origin, new THREE.Vector3(Math.sin(angle) * speed, (1.5 + Math.random() * 3.5) * power, Math.cos(angle) * speed), color,
        0.15 + Math.random() * 0.13, 0.2 + Math.random() * 0.3);
    }
  }
  direction(direction = 0) {
    if (typeof direction === 'number') return new THREE.Vector3(Math.sin(direction), 0, Math.cos(direction));
    return direction?.clone().normalize() || new THREE.Vector3(0, 0, 1);
  }
  dust(position, direction = 0, power = 1) {
    const forward = this.direction(direction);
    const origin = position.clone();
    origin.y += 0.12;
    for (let i = 0; i < Math.min(20, 5 + Math.ceil(power * 4)); i++) {
      this.particle(origin, new THREE.Vector3((Math.random() - 0.5) * power * 2 - forward.x * power,
        0.3 + Math.random() * 0.7, (Math.random() - 0.5) * power * 2 - forward.z * power),
      i % 2 ? 0x847765 : 0xb09c80, 0.55 + Math.random() * 0.8, 0.35 + Math.random() * 0.4, 1, 0.7, 3);
    }
  }
  // A tapered crescent: thin cutting edge, translucent pressure wake, and broken energy threads.
  arcGeometry(full = false) {
    return this.cached(`arc-${full}`, () => {
      const vertices = [], alphas = [], colors = [];
      const span = full ? 5.45 : 2.95;
      const segments = full ? 72 : 46;
      const strips = [
        { r: 0.99, width: 0.019, alpha: 0.92, light: 1 },
        { r: 0.94, width: 0.15, alpha: 0.19, light: 0.78 },
        { r: 0.82, width: 0.065, alpha: 0.085, light: 0.65 },
        { r: 1.065, width: 0.004, alpha: 0.34, light: 0.95 },
        { r: 0.89, width: 0.007, alpha: 0.22, light: 0.85 },
      ];
      for (const strip of strips) {
        for (let i = 0; i < segments; i++) {
          if (strip.width < 0.009 && (i % 13 > 8 || i < 5)) continue;
          const samples = [];
          for (const step of [i, i + 1]) {
            const t = step / segments;
            const taper = Math.pow(Math.sin(Math.PI * t), 0.75);
            const theta = -span * 0.53 + t * span;
            for (const side of [0, 1]) {
              const r = strip.r - strip.width * taper * side;
              samples.push({ p: [Math.sin(theta) * r, Math.sin(theta * 0.75) * 0.15 + (1 - r) * 0.3, Math.cos(theta) * r],
                a: taper * strip.alpha * (side ? 0.18 : 1) * (0.45 + t * 0.55) });
            }
          }
          for (const k of [0, 1, 2, 2, 1, 3]) {
            vertices.push(...samples[k].p); alphas.push(samples[k].a); colors.push(strip.light, strip.light, strip.light);
          }
        }
      }
      return this.geometry(vertices, alphas, colors);
    });
  }
  arc(position, yaw, radius = 2.1, color = GOLD, duration = 0.22, full = false) {
    const mesh = new THREE.Mesh(this.arcGeometry(full), this.material(color, 0.86));
    mesh.position.copy(position); mesh.position.y += 1.05;
    mesh.rotation.set(0.14, yaw, -0.27);
    mesh.scale.setScalar(radius);
    this.add(mesh, duration, 'arc', { sharedGeometry: true, scale: radius, spin: full ? 4.5 : 2.6 });
  }
  ring(position, radius, color = CYAN, duration = 0.5) {
    const geometry = this.cached('ground-ring', () => {
      const vertices = [], alphas = [];
      for (let i = 0; i < 96; i++) {
        const a = i / 96 * TAU, b = (i + 1) / 96 * TAU;
        for (const [angle, r, opacity] of [[a, 1, 0.5], [a, 0.965, 0], [b, 1, 0.5], [b, 1, 0.5], [a, 0.965, 0], [b, 0.965, 0]]) {
          vertices.push(Math.sin(angle) * r, 0, Math.cos(angle) * r); alphas.push(opacity);
        }
      }
      return this.geometry(vertices, alphas);
    });
    const mesh = new THREE.Mesh(geometry, this.material(color, 0.72));
    mesh.position.copy(position); mesh.position.y += 0.06;
    this.add(mesh, duration, 'ring', { sharedGeometry: true, scale: radius });
    mesh.scale.setScalar(radius * 0.4);
  }
  trail(position, yaw, color = CYAN) {
    const geometry = this.cached('motion-trail', () => this.geometry([
      -0.16, 0.3, 0, 0.16, 0.3, 0, -0.36, 1.35, -1.45,
      0.16, 0.3, 0, 0.36, 1.35, -1.45, -0.36, 1.35, -1.45,
      -0.06, 0.5, 0.1, 0.06, 0.5, 0.1, 0.0, 1.15, -2.2,
    ], [0.32, 0.32, 0, 0.32, 0, 0, 0.52, 0.52, 0]));
    const mesh = new THREE.Mesh(geometry, this.material(color, 0.5));
    mesh.position.copy(position); mesh.rotation.y = yaw;
    this.add(mesh, 0.24, 'trail', { sharedGeometry: true });
  }
  impact(position, direction = 0, strength = 1, color = GOLD) {
    const forward = this.direction(direction);
    const origin = position.clone(); origin.y += 1;
    const vertices = [], alphas = [];
    // Longitudinal contact rays are a single mesh, rather than one object per spark.
    for (let i = 0; i < 11; i++) {
      const a = i / 11 * TAU + Math.random() * 0.25;
      const length = (0.22 + Math.random() * 0.5) * Math.sqrt(strength);
      const dx = Math.cos(a), dy = Math.sin(a);
      const width = i % 3 === 0 ? 0.035 : 0.012;
      vertices.push(-dy * width, dx * width, 0, dy * width, -dx * width, 0, dx * length, dy * length, 0);
      alphas.push(0.9, 0.9, 0);
    }
    const flash = new THREE.Mesh(this.geometry(vertices, alphas), this.material(color, 0.9));
    flash.position.copy(origin); flash.rotation.y = Math.atan2(forward.x, forward.z);
    this.add(flash, 0.16, 'impact');
    this.emit(position, color, 8 + Math.ceil(strength * 7), Math.sqrt(strength));
    for (let i = 0; i < 6; i++) {
      this.particle(origin, new THREE.Vector3(forward.x * (2 + Math.random() * 2) + (Math.random() - 0.5) * 3,
        Math.random() * 3, forward.z * (2 + Math.random() * 2) + (Math.random() - 0.5) * 3),
        0xc49863, 0.2 + Math.random() * 0.16, 0.2 + Math.random() * 0.25, 2, 16, 1.8);
    }
    this.dust(position, forward, Math.min(strength, 2));
  }
  lines(position, vertices, color, duration, kind = 'glyph', opacity = 0.45) {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
    const mesh = new THREE.LineSegments(geometry, new THREE.LineBasicMaterial({ color, transparent: true, opacity,
      depthWrite: false, blending: THREE.AdditiveBlending }));
    mesh.position.copy(position);
    return this.add(mesh, duration, kind);
  }
  skill(position, type, yaw = 0) {
    const forward = this.direction(yaw);
    if (type === 'dash') {
      this.dust(position, forward, 2);
      for (let i = 0; i < 18; i++) {
        const origin = position.clone().addScaledVector(forward, -Math.random() * 1.5); origin.y += 0.25 + Math.random() * 0.5;
        this.particle(origin, forward.clone().multiplyScalar(-3 - Math.random() * 3).add(new THREE.Vector3((Math.random() - 0.5) * 2, 1 + Math.random(), (Math.random() - 0.5) * 2)),
          i % 3 ? 0xe99343 : 0xf3ca82, 0.28 + Math.random() * 0.24, 0.22 + Math.random() * 0.22, 0, -0.5, 3);
      }
      this.trail(position, yaw, 0xeeb16c);
    } else if (type === 'whirl') {
      const geometry = this.cached('vortex', () => {
        const vertices = [], alphas = [];
        for (let strand = 0; strand < 3; strand++) for (let i = 0; i < 72; i++) {
          const samples = [];
          for (const n of [i, i + 1]) {
            const t = n / 72, a = t * TAU * 1.5 + strand * TAU / 3;
            const r = 1.6 + t * 1.3;
            for (const edge of [0, 1]) samples.push({ p: [Math.sin(a) * (r - edge * 0.06), 0.2 + t * 1.65, Math.cos(a) * (r - edge * 0.06)], a: Math.sin(t * Math.PI) * (edge ? 0 : 0.36) });
          }
          for (const k of [0, 1, 2, 2, 1, 3]) { vertices.push(...samples[k].p); alphas.push(samples[k].a); }
        }
        return this.geometry(vertices, alphas);
      });
      const mesh = new THREE.Mesh(geometry, this.material(0xb8cfb2, 0.65)); mesh.position.copy(position);
      this.add(mesh, 0.55, 'vortex', { sharedGeometry: true, spin: 5 });
      this.dust(position, yaw, 2);
    } else if (type === 'burst' || type === 'frost') {
      const frost = type === 'frost', color = frost ? 0x8bdbe8 : GOLD;
      const vertices = [];
      for (let i = 0; i < 24; i++) {
        const a = i / 24 * TAU;
        const r = frost ? 1.2 + Math.random() * 3.7 : 3.1;
        const x = Math.sin(a), z = Math.cos(a);
        vertices.push(x * r, 0.07, z * r, x * (r + 0.55), 0.07, z * (r + 0.55));
        if (frost) {
          vertices.push(x * r, 0.07, z * r, x * r + z * 0.24, 0.07, z * r - x * 0.24);
          vertices.push(x * r, 0.07, z * r, x * r - z * 0.24, 0.07, z * r + x * 0.24);
        } else {
          const b = a + TAU / 24;
          vertices.push(x * r, 0.07, z * r, Math.sin(b) * r, 0.07, Math.cos(b) * r);
          vertices.push(x * 2.7, 0.07, z * 2.7, Math.sin(b) * 2.7, 0.07, Math.cos(b) * 2.7);
        }
      }
      this.lines(position, vertices, color, frost ? 0.95 : 0.72, 'glyph', 0.55);
      const crystal = [], alphas = [], colors = [];
      for (let i = 0; i < (frost ? 16 : 7); i++) {
        const a = i / (frost ? 16 : 7) * TAU, r = frost ? 1.1 + Math.random() * 3.2 : 0.3 + Math.random() * 1.8;
        const x = Math.sin(a) * r, z = Math.cos(a) * r, h = frost ? 0.45 + Math.random() * 0.7 : 1.8 + Math.random() * 1.5;
        const w = frost ? 0.18 : 0.08;
        for (const side of [0, 1, 2, 3]) {
          const b = side / 4 * TAU, c = (side + 1) / 4 * TAU;
          crystal.push(x + Math.sin(b) * w, 0.07, z + Math.cos(b) * w,
            x + Math.sin(c) * w, 0.07, z + Math.cos(c) * w, x + w * 0.7, h, z);
          alphas.push(frost ? 0.55 : 0.22, frost ? 0.55 : 0.22, frost ? 0.82 : 0);
          for (let n = 0; n < 3; n++) colors.push(0.6 + side * 0.1, 0.7 + side * 0.07, 0.85 + side * 0.04);
        }
      }
      const mesh = new THREE.Mesh(this.geometry(crystal, alphas, colors), this.material(color, 0.65, !frost));
      mesh.position.copy(position); this.add(mesh, frost ? 0.85 : 0.6, 'crystal');
      this.ring(position, frost ? 5.5 : 6.4, color, 0.65);
      if (!frost) {
        this.emit(position, GOLD, 30, 1.7); this.dust(position, yaw, 3);
        for (let i = 0; i < 12; i++) {
          const a = i / 12 * TAU, origin = position.clone(); origin.y += 0.15;
          this.particle(origin, new THREE.Vector3(Math.sin(a) * 4, 3 + Math.random() * 3, Math.cos(a) * 4), 0x8c7d67,
            0.24 + Math.random() * 0.2, 0.4 + Math.random() * 0.25, 2, 16, 0.8);
        }
      }
      else this.emit(position, color, 16, 0.7);
    } else if (type === 'blades') {
      for (const offset of [-0.34, 0, 0.34]) {
        const origin = position.clone().addScaledVector(new THREE.Vector3(Math.cos(yaw), 0, -Math.sin(yaw)), offset * 2);
        this.trail(origin, yaw + offset, 0xcfdaa8);
      }
    } else if (type === 'finisher') {
      const vertices = [];
      for (const offset of [-0.18, 0.18]) vertices.push(-3.7, 0.7 + offset, -0.35, 3.7, 1.4 + offset, 0.35);
      const effect = this.lines(position, vertices, 0xeed5a1, 0.25, 'cut', 0.82); effect.mesh.rotation.y = yaw;
      const mesh = new THREE.Mesh(this.arcGeometry(false), this.material(0x182126, 0.68, false));
      mesh.position.copy(position); mesh.position.y += 0.85; mesh.rotation.set(0.35, yaw + 0.3, -0.4); mesh.scale.setScalar(3.6);
      this.add(mesh, 0.45, 'afterimage', { sharedGeometry: true, scale: 3.6, spin: 0.6 });
      this.arc(position, yaw, 3.9, 0xecc997, 0.3); this.dust(position, yaw, 2);
    }
  }
  label(position, text, color = '#fff1c9', size = 30) {
    const canvas = document.createElement('canvas'); canvas.width = 256; canvas.height = 96;
    const ctx = canvas.getContext('2d');
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.font = `800 ${size * 2}px Arial, sans-serif`;
    ctx.shadowColor = '#142321'; ctx.shadowBlur = 8; ctx.shadowOffsetY = 3; ctx.fillStyle = color; ctx.fillText(text, 128, 48);
    const texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace;
    const mesh = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, transparent: true, depthWrite: false }));
    mesh.position.copy(position); mesh.position.y += 2.45; mesh.scale.set(2.1, 0.79, 1);
    this.add(mesh, 0.66, 'label');
  }
  removeEffect(effect) {
    this.root.remove(effect.mesh);
    // Three.js Sprite geometry is shared globally; cached ribbons live until dispose().
    if (!effect.mesh.isSprite && !effect.sharedGeometry) effect.mesh.geometry?.dispose();
    effect.mesh.material.map?.dispose();
    effect.mesh.material.dispose();
  }
  update(dt) {
    dt = Math.min(Math.max(dt, 0), 0.1);
    for (let i = this.effects.length - 1; i >= 0; i--) {
      const effect = this.effects[i]; effect.age += dt;
      const p = effect.age / effect.life;
      if (p >= 1) { this.removeEffect(effect); this.effects.splice(i, 1); continue; }
      const opacity = effect.opacity * Math.pow(1 - p, effect.kind === 'label' ? 0.5 : 1.45);
      if (effect.mesh.material.uniforms) effect.mesh.material.uniforms.opacity.value = opacity;
      else effect.mesh.material.opacity = opacity;
      if (effect.kind === 'ring') effect.mesh.scale.setScalar(effect.scale * (0.4 + Math.sin(p * Math.PI / 2) * 0.65));
      if (effect.spin) effect.mesh.rotation.y += dt * effect.spin;
      if (effect.kind === 'arc') effect.mesh.scale.setScalar(effect.scale * (0.94 + p * 0.08));
      if (effect.kind === 'label') effect.mesh.position.y += dt * (1.2 - p * 0.8);
      if (effect.kind === 'impact') effect.mesh.scale.setScalar(0.85 + p * 0.45);
      if (effect.kind === 'crystal') effect.mesh.scale.y = Math.min(1, 0.4 + p * 4);
    }
    const counts = [0, 0];
    for (let i = this.sparkLive.length - 1; i >= 0; i--) {
      const particle = this.sparkLive[i]; particle.age += dt;
      if (particle.age >= particle.life) { this.sparkPool.push(particle); this.sparkLive.splice(i, 1); continue; }
      particle.velocity.multiplyScalar(Math.exp(-particle.drag * dt)); particle.velocity.y -= particle.gravity * dt;
      particle.position.addScaledVector(particle.velocity, dt);
      if (particle.position.y < 0.05) { particle.position.y = 0.05; particle.velocity.y *= -0.18; }
      const batch = particle.kind ? 1 : 0, n = counts[batch]++, attributes = this.batches[batch].geometry.attributes;
      attributes.position.setXYZ(n, particle.position.x, particle.position.y, particle.position.z);
      attributes.color.setXYZ(n, particle.color.r, particle.color.g, particle.color.b);
      const p = particle.age / particle.life;
      attributes.alpha.setX(n, (particle.kind === 1 ? 0.22 : particle.kind === 2 ? 0.75 : 0.9) * Math.pow(1 - p, 1.3));
      attributes.size.setX(n, particle.size * (particle.kind === 1 ? 1 + p * 1.4 : 1 - p * 0.45));
      attributes.kind.setX(n, particle.kind); attributes.angle.setX(n, particle.angle + (particle.kind === 2 ? particle.age * 8 : 0));
    }
    for (let i = 0; i < 2; i++) {
      this.batches[i].geometry.setDrawRange(0, counts[i]);
      for (const attribute of Object.values(this.batches[i].geometry.attributes)) attribute.needsUpdate = true;
    }
  }
  clear() {
    this.effects.forEach(effect => this.removeEffect(effect)); this.effects.length = 0;
    this.sparkPool.push(...this.sparkLive); this.sparkLive.length = 0;
    for (const batch of this.batches) batch.geometry.setDrawRange(0, 0);
  }
  dispose() {
    this.clear();
    for (const geometry of this.geometryCache.values()) geometry.dispose();
    this.geometryCache.clear();
    for (const batch of this.batches) { batch.geometry.dispose(); batch.material.dispose(); }
    this.root.removeFromParent(); this.sparkPool.length = 0;
  }
}
