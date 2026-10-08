import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

// Art uses faceted, curved sections and tailored silhouettes. Geometry is baked
// per articulated body part, then shared by every instance of an archetype.
const geometryCache = new Map();
const templates = new Map();
const materials = {
  cloth: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: .9, flatShading: true }),
  metal: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: .48, metalness: .58, flatShading: true }),
  eyes: new THREE.MeshStandardMaterial({ color: '#d7fbb8', emissive: '#8bea71', emissiveIntensity: 1.65, roughness: .5 }),
};
const boneNames = ['hips', 'body', 'head', 'leftArm', 'rightArm', 'leftForearm', 'rightForearm',
  'leftHand', 'rightHand', 'leftLeg', 'rightLeg', 'leftShin', 'rightShin', 'leftFoot', 'rightFoot',
  'weapon', 'scarf', 'scarfTip', 'cape', 'capeTail', 'skirtLeft', 'skirtRight'];

function cached(key, make) {
  if (!geometryCache.has(key)) geometryCache.set(key, make());
  return geometryCache.get(key);
}

// Elliptical cross sections describe jaw, torso, sleeves and boots without cubes.
// Each section is [height, half-width, half-depth, optional depth offset].
function section(profile, sides = 10) {
  return cached(`section:${sides}:${JSON.stringify(profile)}`, () => {
    const points = [], indices = [];
    for (const [y, rx, rz, z = 0] of profile) {
      for (let i = 0; i < sides; i++) {
        const angle = i / sides * Math.PI * 2 + Math.PI / sides;
        points.push(Math.sin(angle) * rx, y, Math.cos(angle) * rz + z);
      }
    }
    for (let row = 0; row < profile.length - 1; row++) {
      for (let i = 0; i < sides; i++) {
        const a = row * sides + i, b = row * sides + (i + 1) % sides;
        indices.push(a, b, a + sides, b, b + sides, a + sides);
      }
    }
    // Cap both ends; the same winding works for increasing-height profiles.
    for (let i = 1; i < sides - 1; i++) {
      indices.push(0, i + 1, i);
      const offset = (profile.length - 1) * sides;
      indices.push(offset, offset + i, offset + i + 1);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(points, 3));
    g.setIndex(indices); g.computeVertexNormals();
    return g;
  });
}

function outline(points, depth = .03, bevel = .008) {
  return cached(`plate:${JSON.stringify(points)}:${depth}:${bevel}`, () => {
    const shape = new THREE.Shape();
    points.forEach(([x, y], i) => i ? shape.lineTo(x, y) : shape.moveTo(x, y));
    shape.closePath();
    const g = new THREE.ExtrudeGeometry(shape, {
      depth, bevelEnabled: bevel > 0, bevelSize: bevel, bevelThickness: bevel,
      bevelSegments: 1, steps: 1, curveSegments: 1,
    });
    g.translate(0, 0, -depth / 2);
    return g;
  });
}

function hoodShell() {
  return cached('open-hood', () => {
    const profile = [[-.15, .20, .175, -.043], [.10, .218, .195, -.028], [.245, .15, .15, -.04], [.30, .075, .085, -.045]];
    const vertices = [], indices = [], steps = 10;
    for (const [y, rx, rz, z] of profile) for (let i = 0; i <= steps; i++) {
      const angle = (.19 + i / steps * .62) * Math.PI * 2;
      vertices.push(Math.sin(angle) * rx, y, Math.cos(angle) * rz + z);
    }
    for (let row = 0; row < profile.length - 1; row++) for (let i = 0; i < steps; i++) {
      const a = row * (steps + 1) + i, b = a + 1, c = a + steps + 1, d = c + 1;
      indices.push(a, b, c, b, d, c, c, b, a, c, d, b);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
    g.setIndex(indices); g.computeVertexNormals();
    return g;
  });
}

function orb() {
  return cached('orb12', () => new THREE.SphereGeometry(1, 12, 8));
}
function cylinder(sides = 8) {
  return cached(`cylinder:${sides}`, () => new THREE.CylinderGeometry(1, 1, 1, sides));
}
function bone(parent, name, x = 0, y = 0, z = 0) {
  const group = new THREE.Group();
  group.name = name; group.position.set(x, y, z); group.userData.parts = [];
  parent.add(group);
  return group;
}
function part(parent, geometry, color, position = [0, 0, 0], scale = [1, 1, 1], rotation = [0, 0, 0], kind = 'cloth') {
  const transform = new THREE.Matrix4().compose(new THREE.Vector3(...position),
    new THREE.Quaternion().setFromEuler(new THREE.Euler(...rotation)), new THREE.Vector3(...scale));
  const g = geometry.index ? geometry.toNonIndexed() : geometry.clone();
  // Extrusions and curved primitives have different UV attributes. Only the
  // shared rendering attributes survive merging, so no material groups remain.
  for (const name of Object.keys(g.attributes)) {
    if (name !== 'position' && name !== 'normal') g.deleteAttribute(name);
  }
  g.applyMatrix4(transform);
  if (kind !== 'eyes') {
    const c = new THREE.Color(color), colors = new Float32Array(g.attributes.position.count * 3);
    for (let i = 0; i < colors.length; i += 3) colors.set([c.r, c.g, c.b], i);
    g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  }
  parent.userData.parts.push({ geometry: g, kind });
}
function ball(parent, color, x, y, z, sx, sy, sz, kind = 'cloth') {
  part(parent, orb(), color, [x, y, z], [sx, sy, sz], [0, 0, 0], kind);
}
function bar(parent, color, a, b, radius, kind = 'cloth', sides = 8) {
  const start = new THREE.Vector3(...a), end = new THREE.Vector3(...b), vector = end.clone().sub(start);
  const rotation = new THREE.Euler().setFromQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), vector.clone().normalize()));
  part(parent, cylinder(sides), color, start.add(end).multiplyScalar(.5).toArray(), [radius, vector.length(), radius], rotation.toArray().slice(0, 3), kind);
}
function plate(parent, color, points, x, y, z, scale = [1, 1, 1], rotation = [0, 0, 0], kind = 'metal', depth = .025) {
  part(parent, outline(points, depth), color, [x, y, z], scale, rotation, kind);
}
const lamella = [[-.11, .09], [.11, .09], [.105, -.065], [.07, -.10], [-.07, -.10], [-.105, -.065]];
const shoulder = [[-.18, .085], [-.085, .14], [.10, .12], [.18, .04], [.17, -.105], [.06, -.15], [-.145, -.10]];

function addHead(head, p, hero, archer, brute) {
  part(head, section([[-.20, .10, .10, .025], [-.135, .147, .145], [.035, .171, .155], [.17, .156, .143, -.01], [.245, .085, .078, -.025]], 12), p.skin);
  ball(head, p.skin, -.173, -.005, -.015, .037, .073, .046);
  ball(head, p.skin, .173, -.005, -.015, .037, .073, .046);
  // A projecting nose, brow ridge, chin and cheek facets give a human face.
  plate(head, hero ? '#bc9477' : '#788377', [[-.029, .045], [.014, .056], [.038, -.04], [-.024, -.046]], 0, -.015, .171, [1, 1, 1], [0, -.23, 0], 'cloth', .034);
  plate(head, hero ? '#9c7562' : '#45584b', [[-.066, .012], [.066, .012], [.035, -.015], [-.040, -.016]], 0, -.12, .132, [1, 1, 1], [0, 0, 0], 'cloth', .009);
  for (const side of [-1, 1]) {
    plate(head, '#1d2928', [[-.046, .016], [.044, .010], [.041, -.015], [-.034, -.016]], side * .086, .026, .148, [1, 1, 1], [0, side * .26, side * -.08], 'cloth', .006);
    plate(head, p.hair, [[-.053, .015], [.049, .018], [.046, -.005], [-.040, -.011]], side * .089, .073, .150, [1, 1, 1], [0, side * .25, side * .13], 'cloth', .006);
    if (!hero) ball(head, '#ceffb0', side * .086, .026, .164, .027, .015, .010, 'eyes');
  }
  if (hero) {
    ball(head, '#e8e0c7', .086, .024, .165, .031, .010, .008);
    ball(head, '#282c26', .086, .024, .173, .009, .011, .004);
    // The ivory left-eye patch has an inset lip and an actual wrap around the head.
    part(head, section([[.007, .181, .169], [.043, .183, .171]], 12), '#c4bc9d');
    plate(head, '#f1e4c2', [[-.068, .053], [.061, .044], [.071, -.031], [.035, -.055], [-.049, -.041]], -.086, .022, .178, [1, 1, 1], [0, -.23, -.07], 'cloth', .014);
    part(head, section([[.11, .174, .157, -.018], [.20, .166, .146, -.023], [.27, .085, .082, -.038]], 12), p.hair);
    // Swept fringe and temple strands are tapered irregular surfaces.
    for (const side of [-1, 1]) {
      plate(head, '#202c2b', [[-.04, .14], [.043, .12], [.042, -.07], [.013, -.14], [-.02, -.03]], side * .142, .083, .096, [1, 1, 1], [0, side * .64, side * -.12], 'cloth', .018);
      bar(head, '#43514a', [side * .085, .23, -.065], [side * .14, .13, -.02], .010);
    }
    ball(head, p.hair, 0, .307, -.046, .096, .084, .086);
    part(head, section([[.279, .077, .073, -.046], [.301, .081, .076, -.046]], 10), p.gold, [0, 0, 0], [1, 1, 1], [0, 0, 0], 'metal');
    bar(head, '#d4bd80', [-.16, .293, -.048], [.18, .318, -.052], .013, 'metal');
    ball(head, '#eee1b1', .183, .32, -.052, .027, .023, .023, 'metal');
  } else {
    // Hollow cheeks, exposed teeth and a split forehead read as an undead face.
    for (const side of [-1, 1]) {
      plate(head, '#526555', [[-.03, .04], [.038, .028], [.018, -.045], [-.018, -.027]], side * .114, -.091, .113, [1, 1, 1], [0, side * .47, 0], 'cloth', .008);
      bar(head, '#ddd5aa', [side * .025, -.120, .148], [side * .023, -.157, .137], .008);
    }
    bar(head, '#535b49', [-.038, .08, .145], [-.056, .17, .123], .008);
    if (archer) {
      part(head, hoodShell(), p.dark);
      // Keep the front face visible: a hood surrounds rather than covers it.
      plate(head, p.cloth, [[-.10, .14], [.01, .18], [.044, -.095], [-.027, -.22], [-.083, -.07]], -.19, .025, .068, [1, 1, 1], [0, -.8, -.07], 'cloth');
      plate(head, p.cloth, [[-.044, .16], [.08, .14], [.09, -.08], [.036, -.21], [-.024, -.1]], .19, .025, .068, [1, 1, 1], [0, .8, .07], 'cloth');
    } else {
      part(head, section([[.11, .192, .167], [.19, .173, .150], [.285, .08, .074]], 10), p.iron, [0, 0, 0], [1, 1, 1], [0, 0, 0], 'metal');
      part(head, section([[.102, .202, .177], [.131, .202, .177]], 10), p.gold, [0, 0, 0], [1, 1, 1], [0, 0, 0], 'metal');
      for (const side of [-1, 1]) plate(head, p.iron, [[-.04, .09], [.046, .077], [.043, -.08], [-.017, -.13], [-.04, -.032]], side * .188, -.044, -.008, [1, 1, 1], [0, side * .7, 0]);
      if (brute) plate(head, '#634d40', [[-.026, .24], [.026, .24], [.04, -.11], [-.04, -.11]], 0, .201, -.04, [1, 1, 1], [0, 0, 0], 'cloth', .15);
    }
  }
}

function addTorso(body, hips, p, hero, brute, archer) {
  part(body, section([[-.19, .27, .165], [.05, .29, .175], [.39, .345, .19], [.56, .325, .18], [.64, .24, .15]], 12), p.cloth);
  part(body, section([[.60, .102, .088], [.78, .085, .08]], 10), p.skin);
  // White crossed hanfu collar, with the jade lapel folding over it.
  plate(body, p.linen, [[-.23, .61], [-.14, .68], [.19, .23], [.105, .18]], 0, 0, .181, [1, 1, 1], [0, 0, 0], 'cloth');
  plate(body, p.linen, [[.18, .64], [.25, .59], [-.05, .25], [-.13, .30]], 0, 0, .188, [1, 1, 1], [0, 0, 0], 'cloth');
  plate(body, p.dark, [[-.22, .565], [-.175, .60], [.20, .12], [.15, .07]], 0, 0, .202, [1, 1, 1], [0, 0, 0], 'cloth');
  if (!archer) {
    const chest = [[-.285, .34], [-.20, .41], [.20, .41], [.285, .32], [.235, -.08], [0, -.16], [-.235, -.08]];
    plate(body, p.gold, chest, 0, .09, .209, [1.025, 1.02, 1], [0, 0, 0]);
    plate(body, p.iron, chest, 0, .10, .23, [.94, .94, 1], [0, 0, 0]);
    // Convex central rib and overlapping rows are caught by directional light.
    for (let row = 0; row < 3; row++) for (let i = -1; i <= 1; i++) {
      if (!hero && !brute && row === 1 && i === -1) continue;
      plate(body, row % 2 ? p.ironLight : p.iron, lamella, i * .155, .30 - row * .115, .268 - Math.abs(i) * .025,
        [.68, .58, 1], [0, i * .13, 0]);
      bar(body, p.gold, [i * .155 - .063, .341 - row * .115, .28 - Math.abs(i) * .025],
        [i * .155 + .063, .341 - row * .115, .28 - Math.abs(i) * .025], .007, 'metal');
    }
    plate(body, p.gold, [[0, .09], [.072, 0], [0, -.07], [-.072, 0]], 0, .39, .276);
    ball(body, hero ? '#80b8a0' : '#7d6d51', 0, .39, .292, .037, .049, .012, 'metal');
    if (!hero) {
      // Broken lacquer and crooked copper seams interrupt the soldiers' clean
      // armor, without adding transparent decals or per-instance draw calls.
      plate(body, '#786548', [[-.035, .095], [.017, .084], [.042, -.04], [.004, -.11], [-.018, -.036]],
        .18, .17, .273, [1, 1, 1], [0, .13, -.25], 'metal', .008);
      plate(body, '#384e41', [[-.05, .03], [.041, .02], [.031, -.055], [-.009, -.02]],
        -.17, -.04, .244, [1, 1, 1], [0, -.1, .14], 'metal', .008);
      bar(body, '#93805c', [-.19, .32, .275], [-.16, .215, .274], .011, 'metal');
    }
  } else {
    for (const side of [-1, 1]) {
      bar(body, '#473e36', [side * .26, .49, .18], [side * -.16, -.10, .196], .041);
      plate(body, p.gold, lamella, side * .22, .26, .21, [.57, 1.05, 1]);
    }
  }
  // Oval leather girdle and a decorated clasp hold the silhouette together.
  part(hips, section([[-.075, .302, .19], [.069, .306, .192]], 12), p.leather);
  part(hips, section([[.046, .309, .194], [.067, .309, .194]], 12), p.gold, [0, 0, 0], [1, 1, 1], [0, 0, 0], 'metal');
  plate(hips, p.gold, [[-.082, .06], [.081, .06], [.085, -.06], [-.074, -.065]], 0, 0, .207);
  plate(hips, hero ? '#2c675b' : '#596447', [[-.046, .035], [.042, .035], [.046, -.035], [-.043, -.039]], 0, 0, .224);
  for (const side of [-1, 1]) {
    const skirt = bone(hips, side < 0 ? 'skirtLeft' : 'skirtRight', side * .135, -.07, 0);
    skirt.rotation.z = side * .055;
    const hem = [[-.115, 0], [.118, .01], [.22, -.59], [.07, -.66], [-.16, -.61], [-.21, -.52]];
    plate(skirt, p.cloth, hem, side * .058, 0, -.017, [1, 1, 5], [0, side * -.3, side * -.05], 'cloth', .035);
    plate(skirt, p.dark, [[-.06, .008], [.052, .008], [.10, -.58], [.005, -.625]], side * .17, -.02, .107, [1, 1, 1], [0, side * -.3, 0], 'cloth');
    bar(skirt, p.gold, [-.145 + side * .058, -.597, .105], [.063 + side * .058, -.645, .106], .011, 'metal');
    if (!archer) for (let row = 0; row < 3; row++) {
      plate(skirt, row % 2 ? p.ironLight : p.iron, lamella, side * .023, -.13 - row * .12, .173,
        [1.02, .72, 1], [0, side * -.25, side * -.06]);
      bar(skirt, p.gold, [side * .023 - .11, -.079 - row * .12, .19], [side * .023 + .11, -.079 - row * .12, .19], .007, 'metal');
    }
  }
  if (brute) {
    part(body, section([[-.13, .31, .19], [.10, .34, .215], [.48, .385, .218]], 10), p.iron, [0, 0, -.045], [1, 1, 1], [0, 0, 0], 'metal');
    for (const side of [-1, 1]) bar(body, p.gold, [side * .29, .40, .20], [side * .22, -.05, .225], .026, 'metal');
  }
}

function addLimbs(body, hips, p, hero, brute, archer) {
  for (const side of [-1, 1]) {
    const prefix = side < 0 ? 'left' : 'right';
    const arm = bone(body, `${prefix}Arm`, side * .365, .535, 0);
    arm.rotation.z = side * .12;
    part(arm, section([[-.36, .101, .105], [-.30, .139, .14], [-.105, .16, .158], [.04, .115, .12]], 10), p.cloth);
    // Rounded double pauldrons overlap the sleeve rather than forming a box.
    if (!archer) {
      part(arm, section([[-.10, .182, .18], [.02, .175, .17], [.10, .11, .12]], 10), p.iron, [0, .014, 0], [1, 1, 1], [0, 0, 0], 'metal');
      const shoulderScale = hero && side > 0 ? .84 : 1;
      plate(arm, p.gold, shoulder, side * .025, -.01, .153, [1.12 * shoulderScale, 1.05 * shoulderScale, 1], [0, side * .13, side * -.10]);
      plate(arm, p.ironLight, shoulder, side * .03, -.04, .177, [shoulderScale, .85 * shoulderScale, 1], [0, side * .13, side * -.10]);
      if (!hero && side < 0) {
        plate(arm, '#71654e', [[-.061, .045], [.04, .038], [.007, -.061], [-.044, -.052]], -.06, -.022, .204,
          [1, 1, 1], [0, -.1, -.26], 'metal', .008);
      }
      if (brute) for (let i = -1; i <= 1; i++) {
        part(arm, cached('spike', () => new THREE.ConeGeometry(.046, .13, 6)), '#bbb49a', [i * .075, .11, -.015], [1, 1, 1], [0, 0, i * -.3], 'metal');
      }
    }
    part(arm, section([[-.37, .109, .112], [-.335, .112, .118]], 10), p.linen);
    const forearm = bone(arm, `${prefix}Forearm`, 0, -.37, 0);
    forearm.rotation.x = hero ? -.10 : -.065;
    part(forearm, section([[-.335, .070, .074], [-.22, .092, .087], [-.06, .103, .10], [.025, .083, .085]], 10), archer ? p.skin : p.dark);
    part(forearm, section([[-.29, .079, .08], [-.26, .093, .092], [-.092, .112, .109]], 10), p.leather);
    plate(forearm, p.ironLight, [[-.071, .09], [.07, .09], [.06, -.094], [-.057, -.108]], 0, -.185, .100,
      [1, 1, 1], [-.04, 0, 0]);
    for (const y of [-.098, -.267]) part(forearm, section([[y, .103, .102], [y + .022, .105, .104]], 10), p.gold, [0, 0, 0], [1, 1, 1], [0, 0, 0], 'metal');
    // A real wrist carries the hand and weapon together. Fingers wrap around
    // the grip; the thumb crosses it rather than floating beside the blade.
    const hand = bone(forearm, `${prefix}Hand`, 0, -.35, 0);
    ball(hand, p.leather, 0, -.026, -.010, .069, .069, .052);
    for (let finger = 0; finger < 4; finger++) {
      part(hand, cached('knuckle', () => new THREE.SphereGeometry(1, 8, 5)), p.skin,
        [-.043 + finger * .028, -.056, .043], [.017, .042, .025]);
      bar(hand, hero ? '#ad8469' : '#65745c', [-.051 + finger * .028, -.06, .063], [-.034 + finger * .028, -.06, .063], .004);
    }
    ball(hand, p.skin, side * -.054, -.016, .043, .031, .049, .028);
    plate(hand, p.iron, [[-.047, .03], [.047, .03], [.044, -.034], [-.035, -.043]], 0, -.014, -.053, [1, 1, 1], [0, 0, 0], 'cloth');

    const leg = bone(hips, `${prefix}Leg`, side * .167, -.083, -.002);
    part(leg, section([[-.475, .105, .104], [-.25, .13, .137], [.016, .138, .145]], 10), p.dark);
    const shin = bone(leg, `${prefix}Shin`, 0, -.474, 0);
    ball(shin, p.iron, 0, -.008, .074, .108, .096, .055, 'metal');
    part(shin, section([[-.365, .082, .078], [-.21, .096, .10], [.006, .103, .106]], 10), p.leather);
    plate(shin, p.ironLight, [[-.069, .018], [.068, .018], [.069, -.205], [.039, -.296], [-.046, -.294], [-.07, -.197]], 0, -.05, .088);
    bar(shin, p.gold, [-.066, -.068, .111], [.066, -.068, .111], .009, 'metal');
    // Independent ankles allow planted soles and a toe-first running lift.
    const foot = bone(shin, `${prefix}Foot`, 0, -.425, 0);
    part(foot, section([[-.116, .101, .174, .058], [-.087, .111, .183, .060], [-.025, .098, .151, .054], [.065, .081, .080, -.002]], 12), p.leather);
    part(foot, section([[-.116, .106, .181, .063], [-.09, .112, .187, .064]], 12), '#202a27');
    plate(foot, p.iron, [[-.068, .043], [.068, .043], [.082, -.035], [.038, -.076], [-.048, -.07]], 0, -.015, .192, [1, .57, 1], [-.52, 0, 0], 'cloth');
    bar(foot, p.gold, [-.075, -.014, .142], [.075, -.014, .142], .008, 'cloth');
  }
}

function addSword(forearm, p, heavy = false) {
  const weapon = bone(forearm, 'weapon', 0, -.04, .034);
  // Blade axis is +Y; the default wrist points it forward along character +Z.
  weapon.rotation.x = Math.PI / 2;
  bar(weapon, '#3c4035', [0, -.16, 0], [0, .13, 0], .046);
  for (let i = 0; i < 5; i++) {
    bar(weapon, '#bb9e67', [-.036, -.11 + i * .042, .025], [.036, -.081 + i * .042, .025], .006, 'metal');
  }
  ball(weapon, p.gold, 0, -.175, 0, .065, .045, .058, 'metal');
  part(weapon, section([[.125, .12, .067], [.18, .152, .075], [.205, .11, .051]], 10), p.gold, [0, 0, 0], [1, 1, 1], [0, 0, 0], 'metal');
  const blade = [[-.053, .20], [.10, .20], [.119, .63], [.153, 1.13], [.221, 1.58], [.092, 1.89], [-.01, 1.71], [-.038, 1.19]];
  const width = heavy ? 1.65 : .90;
  plate(weapon, '#b5cac8', blade, 0, 0, 0, [width, 1, 1], [0, 0, 0], 'metal', heavy ? .065 : .032);
  // Polished cutting edge and a darker fuller make the dao read as forged steel.
  plate(weapon, '#f1f0d9', [[.095, .23], [.111, .63], [.145, 1.13], [.211, 1.58], [.092, 1.89], [.123, 1.55], [.087, 1.09], [.072, .25]], 0, 0, .025, [width, 1, 1], [0, 0, 0], 'metal', .007);
  plate(weapon, '#829c99', [[-.028, .28], [.001, .28], [.025, 1.36], [.058, 1.66], [.012, 1.56]], 0, 0, .024, [width, 1, 1], [0, 0, 0], 'metal', .006);
  // A slim dao has a readable point and a weighted guard without overwhelming
  // the body's silhouette. Scale blade and fittings as a single forged object.
  weapon.scale.set(1, heavy ? .94 : .84, 1);
  return weapon;
}

function addBow(forearm, body, p) {
  const weapon = bone(forearm, 'weapon', 0, -.04, .036);
  weapon.rotation.z = -.19;
  const points = [[0, -.70, 0], [.16, -.55, .014], [.245, -.29, .017], [.19, 0, .018], [.25, .31, .013], [.16, .55, .006], [0, .72, 0]];
  for (let i = 0; i < points.length - 1; i++) bar(weapon, i % 2 ? '#c5a36d' : '#947449', points[i], points[i + 1], .035);
  bar(weapon, '#ece2c2', points[0], points[points.length - 1], .006);
  bar(weapon, p.leather, [.19, -.115, .018], [.19, .12, .018], .052);
  bar(weapon, '#c4b089', [-.24, .01, -.40], [-.24, .01, .71], .011);
  part(weapon, cached('arrowtip', () => new THREE.ConeGeometry(.027, .11, 4)), '#9bacaa', [-.24, .01, .735], [1, 1, 1], [Math.PI / 2, 0, 0], 'metal');
  part(body, section([[-.38, .115, .107], [.30, .123, .112]], 8), p.leather, [-.22, .18, -.285], [1, 1, 1], [0, 0, -.20]);
  part(body, section([[.27, .13, .12], [.31, .13, .12]], 8), p.gold, [-.22, .18, -.285], [1, 1, 1], [0, 0, -.20], 'metal');
  for (let i = 0; i < 4; i++) {
    const x = -.30 + i * .048;
    bar(body, '#c9b593', [x, .18, -.29], [x + .065, .78 + i % 2 * .045, -.29], .009);
    plate(body, '#b5b29a', [[-.025, .055], [.025, .016], [.02, -.057], [-.02, -.041]], x + .061, .715 + i % 2 * .045, -.29, [1, 1, 1], [0, i * .8, -.15], 'cloth', .006);
  }
}

// A folded textile surface. Adjacent rows share a crease and preserve volume
// in silhouette; both sides are baked so the cape reads during a full spin.
function textile(rows) {
  return cached(`textile:${JSON.stringify(rows)}`, () => {
    const vertices = [], indices = [];
    for (const [y, width, z, fold] of rows) {
      for (const u of [-1, -.5, 0, .5, 1]) vertices.push(u * width, y, z + (Math.abs(u) === .5 ? fold : 0));
    }
    for (let row = 0; row < rows.length - 1; row++) for (let col = 0; col < 4; col++) {
      const a = row * 5 + col, b = a + 1, c = a + 5, d = c + 1;
      indices.push(a, c, b, b, c, d, b, c, a, d, c, b);
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
    geometry.setIndex(indices); geometry.computeVertexNormals();
    // Opposite faces require separate normals instead of cancelling at a vertex.
    const flat = geometry.toNonIndexed(); flat.computeVertexNormals(); geometry.dispose();
    return flat;
  });
}

function addHeroCloth(body, hips, p) {
  const cape = bone(body, 'cape', -.045, .54, -.215);
  part(cape, textile([[.04, .205, -.01, -.025], [-.18, .252, -.07, -.045], [-.48, .278, -.075, -.055]]), '#285747');
  const tail = bone(cape, 'capeTail', 0, -.46, -.075);
  part(tail, textile([[.0, .278, 0, -.055], [-.30, .302, -.025, -.065], [-.62, .258, -.015, -.035]]), '#34755e');
  // Sewn gold edging and a jade central facing catch light on the moving hem.
  part(tail, textile([[-.566, .265, -.013, -.04], [-.605, .261, -.016, -.037], [-.62, .258, -.017, -.035]]), '#b3a374');
  part(cape, textile([[.03, .055, -.039, -.012], [-.18, .065, -.104, -.018], [-.479, .072, -.11, -.012]]), '#568d70');
  part(tail, textile([[0, .072, -.035, -.012], [-.3, .082, -.068, -.014], [-.565, .07, -.04, -.012]]), '#568d70');
  const scarf = bone(body, 'scarf', .005, 1.18, -.10);
  for (const side of [-1, 1]) {
    part(scarf, textile([[0, .024, 0, -.006], [-.22, .026, -.03, -.009], [-.42, .025, -.06, -.008]]), '#243c34', [side * .063, 0, 0], [1, 1, 1], [.18, side * .17, side * .12]);
  }
  const tip = bone(scarf, 'scarfTip', 0, -.39, -.06);
  for (const side of [-1, 1]) part(tip, textile([[0, .025, 0, -.008], [-.20, .028, -.02, -.01], [-.36, .012, -.035, -.005]]), '#354f40', [side * .11, 0, 0], [1, 1, 1], [0, 0, side * .10]);
  const sash = [[-.045, .03], [.05, .022], [.073, -.23], [.167, -.46], [.11, -.57], [.038, -.49], [-.018, -.25]];
  plate(hips, '#a77840', sash, -.24, -.028, -.015, [1, 1, 1], [-.28, -.25, -.14], 'cloth');
  const sheath = [[-.060, .45], [.06, .45], [.065, -.56], [.02, -.73], [-.052, -.67]];
  // The sheath follows the pelvis, so twisting the chest cannot swing it into
  // the planted legs. Its suspension rings are attached to the belt itself.
  plate(hips, '#203b32', sheath, -.37, .07, -.19, [.85, .92, 1], [0, .10, -.35], 'cloth', .075);
  for (const y of [.39, -.04, -.49]) bar(hips, p.gold, [-.44 - y * .30, y, -.15], [-.345 - y * .30, y - .03, -.15], .013, 'metal');
  for (const side of [-1, 1]) {
    ball(body, p.gold, side * .26, .535, .168, .043, .046, .025, 'metal');
    bar(body, '#cdb879', [side * .26, .525, .19], [side * .13, .45, .225], .01, 'metal');
  }
}

function bake(root, type) {
  root.traverse(node => {
    if (!node.userData.parts) return;
    const buckets = new Map();
    for (const item of node.userData.parts) {
      if (!buckets.has(item.kind)) buckets.set(item.kind, []);
      buckets.get(item.kind).push(item.geometry);
    }
    for (const [kind, pieces] of buckets) {
      const key = `baked:${type}:${node.name}:${kind}`;
      const geometry = mergeGeometries(pieces, false);
      geometry.computeBoundingBox(); geometry.computeBoundingSphere();
      geometryCache.set(key, geometry);
      const mesh = new THREE.Mesh(geometry, materials[kind]);
      mesh.name = `${node.name}-${kind}`; mesh.castShadow = true; mesh.receiveShadow = true;
      node.add(mesh);
      pieces.forEach(g => g.dispose());
    }
    delete node.userData.parts;
  });
}

function makeTemplate(type) {
  const hero = type === 'hero', brute = type === 'brute' || type === 'boss', archer = type === 'archer';
  const p = hero ? {
    cloth: '#34755d', dark: '#203e35', linen: '#ede7ce', skin: '#d4ac87', hair: '#1b2925',
    iron: '#3c5a50', ironLight: '#6d8c75', gold: '#c1aa6a', leather: '#343b2c',
  } : {
    cloth: brute ? '#785947' : archer ? '#677061' : '#80675a', dark: '#414f45', linen: '#b9b697',
    skin: brute ? '#8f9a7a' : archer ? '#9cac8e' : '#a2b798', hair: '#39443a',
    iron: '#59675a', ironLight: '#87917a', gold: '#ae9b68', leather: '#4b4538',
  };
  const root = new THREE.Group(); root.name = hero ? 'Xiahou Dun · Jade General' : `Undead ${type}`;
  const hips = bone(root, 'hips', 0, 1.098, 0);
  const body = bone(hips, 'body', 0, .27, 0);
  const head = bone(body, 'head', 0, .945, .005);
  head.scale.set(.96, .86, .96);
  addTorso(body, hips, p, hero, brute, archer);
  addLimbs(body, hips, p, hero, brute, archer);
  addHead(head, p, hero, archer, brute);
  const forearm = body.getObjectByName('rightHand');
  if (archer) addBow(forearm, body, p); else addSword(forearm, p, brute);
  if (hero) addHeroCloth(body, hips, p);
  if (brute) root.scale.set(1.31, 1.16, 1.28);
  if (archer) root.scale.set(.94, 1, .94);
  bake(root, type);
  return root;
}

function character(type) {
  if (!templates.has(type)) templates.set(type, makeTemplate(type));
  const group = templates.get(type).clone(true);
  const rig = {};
  for (const name of boneNames) {
    const node = group.getObjectByName(name);
    if (node) {
      rig[name] = node;
      node.userData.base = { position: node.position.clone(), rotation: node.rotation.clone(), scale: node.scale.clone() };
    }
  }
  group.userData.rig = rig;
  // All meshes are cached archetype geometry, shared between characters. The
  // gameplay disposer must never free it when an individual enemy dies.
  group.userData.ownedGeometries = new Set();
  group.userData.bladeAxis = '+Y';
  group.userData.bladeLength = type === 'archer' ? 0 : 1.69 * (type === 'hero' || type === 'soldier' ? .84 : .94);
  group.userData.archetype = type;
  group.userData.legLengths = { thigh: .474, shin: .425, sole: .116 };
  return group;
}

export function createWarrior() { return character('hero'); }
export function createEnemy(type = 'soldier') {
  return character(['archer', 'brute', 'boss'].includes(type) ? type : 'soldier');
}
