/* global $, THREE */

// the potato and every part are real 3d models built out of three.js shapes (no picture files).
// every part is built facing +z (pointing out of the potato) with +y as up,
// so it can be stuck onto any spot on the potato by turning its +z to match the surface there

const $playArea = $('#playArea');
const $trash = $('#trash');
const $sidebar = $('#sidebar');
const canvas = $('#scene')[0];

const Z_AXIS = new THREE.Vector3(0, 0, 1);
const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

// =====================================================================
// renderer, camera, lights
// =====================================================================

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true }); // alpha so the css background shows through
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.outputEncoding = THREE.sRGBEncoding;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(32, 1, 0.1, 100);
const LOOK_AT = new THREE.Vector3(0, 0.45, 0);

function resize() {
  const width = $playArea.width();
  const height = $playArea.height();
  renderer.setSize(width, height, false);
  camera.aspect = width / height;

  // back the camera up on narrow screens so the arms still fit
  const fit = Math.max(4.8, 4 / camera.aspect);
  const distance = fit / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)));
  camera.position.set(0, LOOK_AT.y + 0.6, distance);
  camera.lookAt(LOOK_AT);
  camera.updateProjectionMatrix();
}

new ResizeObserver(resize).observe($playArea[0]);
resize();

// a warm key light, a soft sky fill and a cool rim light from behind, like an animated movie
const hemi = new THREE.HemisphereLight();
const key = new THREE.DirectionalLight();
const rim = new THREE.DirectionalLight();
const fill = new THREE.DirectionalLight();
key.position.set(3, 6, 5);
rim.position.set(-4, 3, -4);
fill.position.set(-4, 1, 3);
key.castShadow = true;
key.shadow.mapSize.set(2048, 2048);
Object.assign(key.shadow.camera, { left: -3, right: 3, top: 4, bottom: -3, near: 1, far: 20 });
key.shadow.bias = -0.0005;
key.shadow.normalBias = 0.02;
scene.add(hemi, key, rim, fill);

const LIGHTING = {
  day: { sky: '#cfe8ff', ground: '#8a6a3a', hemi: 0.7, key: ['#fff1d6', 1.6], rim: ['#9fd4ff', 0.9], fill: ['#ffd9c2', 0.35] },
  night: { sky: '#4a5a9a', ground: '#1a1530', hemi: 0.5, key: ['#bcd0ff', 0.9], rim: ['#7fb2ff', 1.3], fill: ['#ffb36b', 0.45] }
};

function setLighting(name) {
  const l = LIGHTING[name];
  hemi.color.set(l.sky);
  hemi.groundColor.set(l.ground);
  hemi.intensity = l.hemi;
  [[key, l.key], [rim, l.rim], [fill, l.fill]].forEach(([light, [color, intensity]]) => {
    light.color.set(color);
    light.intensity = intensity;
  });
}

// an invisible floor that only shows the shadow
const floor = new THREE.Mesh(new THREE.PlaneGeometry(20, 20), new THREE.ShadowMaterial({ opacity: 0.25 }));
floor.rotation.x = -Math.PI / 2;
floor.position.y = -1.45;
floor.receiveShadow = true;
scene.add(floor);

// =====================================================================
// springs (all the bouncy motion comes from these)
// =====================================================================

// pulls value toward target and overshoots a little before settling, like a heavy spring
class Spring {
  constructor(value, stiffness = 170, damping = 14) {
    this.value = value;
    this.target = value;
    this.velocity = 0;
    this.stiffness = stiffness;
    this.damping = damping;
  }

  step(dt) {
    const force = -this.stiffness * (this.value - this.target) - this.damping * this.velocity;
    this.velocity += force * dt;
    this.value += this.velocity * dt;
    return this.value;
  }
}

// =====================================================================
// little helpers for building models
// =====================================================================

const SPHERE = new THREE.SphereGeometry(1, 40, 28);
const HALF_SPHERE = new THREE.SphereGeometry(1, 40, 20, 0, Math.PI * 2, 0, Math.PI / 2);
const TOOTH = new THREE.BoxGeometry(0.085, 0.08, 0.04);
const BIG_TOOTH = new THREE.BoxGeometry(0.08, 0.11, 0.04);

// colors are written as normal css hex, three.js wants them in linear space
const srgb = hex => new THREE.Color(hex).convertSRGBToLinear();

// shiny toy plastic
function plastic(color, extra) {
  return new THREE.MeshPhysicalMaterial(Object.assign({ color: srgb(color), roughness: 0.35, clearcoat: 0.6, clearcoatRoughness: 0.2 }, extra));
}

// fuzzy or matte things (hair, eyebrows)
function soft(color, extra) {
  return new THREE.MeshStandardMaterial(Object.assign({ color: srgb(color), roughness: 0.8 }, extra));
}

function mesh(geometry, material, x = 0, y = 0, z = 0, sx = 1, sy = sx, sz = sx) {
  const m = new THREE.Mesh(geometry, material);
  m.position.set(x, y, z);
  m.scale.set(sx, sy, sz);
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

const ball = (material, x, y, z, sx, sy = sx, sz = sx) => mesh(SPHERE, material, x, y, z, sx, sy, sz);

function group(children, x = 0, y = 0, z = 0) {
  const g = new THREE.Group();
  children.forEach(child => g.add(child));
  g.position.set(x, y, z);
  return g;
}

function rot(object, x, y, z) {
  object.rotation.set(x, y, z);
  return object;
}

function noShadow(object) {
  object.castShadow = false;
  return object;
}

// a bent tube through the points, with round ends
function tube(points, radius, material) {
  const vectors = points.map(p => new THREE.Vector3(...p));
  const curve = new THREE.CatmullRomCurve3(vectors);
  return group([
    mesh(new THREE.TubeGeometry(curve, 40, radius, 12), material),
    ball(material, ...points[0], radius),
    ball(material, ...points[points.length - 1], radius)
  ]);
}

// make(1) builds the right one, make(-1) the left one
const pair = make => group([make(1), make(-1)]);

// hats are easier to build standing up (y up, front toward +z), this tips them so up points out of the potato
function upright(children, sink = 0) {
  const inner = group(children);
  inner.rotation.x = Math.PI / 2;
  inner.position.z = -sink;
  return group([inner]);
}

// shoes are built standing on the floor (top at y 0, toes toward +z), this hangs them under the potato
function onFloor(children, sink = 0) {
  const inner = group(children);
  inner.rotation.x = -Math.PI / 2;
  inner.position.z = -sink;
  return group([inner]);
}

// the same random numbers every time, so the potato skin always looks the same
function seeded(seed) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function canvasTexture(width, height, draw) {
  const c = document.createElement('canvas');
  c.width = width;
  c.height = height;
  draw(c.getContext('2d'));
  const texture = new THREE.CanvasTexture(c);
  texture.encoding = THREE.sRGBEncoding;
  texture.anisotropy = 4;
  return texture;
}

// =====================================================================
// the potato
// =====================================================================

function makePotato() {
  const geometry = new THREE.SphereGeometry(1, 128, 96);
  const position = geometry.attributes.position;
  const v = new THREE.Vector3();

  for (let i = 0; i < position.count; i++) {
    v.fromBufferAttribute(position, i);
    // a few overlapping waves push the surface in and out so it's lumpy like a real potato
    const lump = 1 +
      0.045 * Math.sin(3.1 * v.x + 1.3) * Math.sin(2.3 * v.y + 0.4) * Math.cos(2.7 * v.z) +
      0.02 * Math.sin(7 * v.x + 5 * v.z) * Math.cos(6 * v.y);
    v.multiplyScalar(lump);
    // taller than it is wide, and a little heavier at the bottom
    const belly = 1 - 0.07 * v.y;
    position.setXYZ(i, v.x * belly, v.y * 1.3, v.z * belly * 0.92);
  }
  geometry.computeVertexNormals();

  const rand = seeded(7);
  const skin = canvasTexture(1024, 512, g => {
    g.fillStyle = '#c99453';
    g.fillRect(0, 0, 1024, 512);
    // blotches of lighter and darker skin
    for (let i = 0; i < 2500; i++) {
      const r = 2 + rand() * 14;
      g.fillStyle = rand() < 0.5 ? 'rgba(120, 70, 30, 0.1)' : 'rgba(240, 200, 140, 0.1)';
      g.beginPath();
      g.ellipse(rand() * 1024, rand() * 512, r * 1.6, r, 0, 0, Math.PI * 2);
      g.fill();
    }
    // the little dark potato "eyes"
    for (let i = 0; i < 40; i++) {
      g.fillStyle = 'rgba(90, 50, 20, 0.45)';
      g.beginPath();
      g.ellipse(rand() * 1024, 40 + rand() * 432, 2 + rand() * 3, 1.5 + rand() * 2, 0, 0, Math.PI * 2);
      g.fill();
    }
  });

  const material = new THREE.MeshStandardMaterial({ map: skin, bumpMap: skin, bumpScale: 0.02, roughness: 0.78 });
  return mesh(geometry, material);
}

// turntable spins when you drag the background, body squashes from the bottom so the feet stay on the floor,
// holder is where the potato and its pieces live
const turntable = new THREE.Group();
const body = new THREE.Group();
const holder = new THREE.Group();
turntable.position.y = 0.25;
body.position.y = -1.3;
holder.position.y = 1.3;
turntable.add(body);
body.add(holder);
scene.add(turntable);

const potato = makePotato();
holder.add(potato);

const spinY = new Spring(0, 90, 14);
const tilt = new Spring(0, 120, 10);
const wobble = new Spring(0, 120, 6); // kicked when a piece lands on the potato

// =====================================================================
// the parts
// =====================================================================

const white = () => plastic('#ffffff', { roughness: 0.25 });
const black = () => plastic('#111111', { roughness: 0.3 });
const shine = () => soft('#ffffff', { emissive: srgb('#ffffff'), emissiveIntensity: 0.8 });

function googlyEyes() {
  const dome = new THREE.MeshPhysicalMaterial({ color: 0xffffff, roughness: 0.05, clearcoat: 1, transparent: true, opacity: 0.28 });
  return pair(s => {
    // the pupil rattles around inside the eye (moved by updateGooglies)
    const pupil = group([ball(black(), 0, 0, 0, 0.095, 0.095, 0.03)], 0, -0.07, 0.115);
    pupil.userData.googly = { x: 0, y: -0.07, vx: 0, vy: 0 };
    return group([
      ball(white(), 0, 0, 0, 0.2, 0.2, 0.1),
      pupil,
      noShadow(ball(dome, 0, 0, 0, 0.205, 0.205, 0.15))
    ], s * 0.24, 0, 0);
  });
}

function bigEyes() {
  return pair(s => group([
    ball(white(), 0, 0, 0, 0.2, 0.26, 0.14),
    ball(plastic('#3aa0d8'), s * -0.02, -0.03, 0.115, 0.12, 0.12, 0.04),
    ball(black(), s * -0.02, -0.03, 0.14, 0.065, 0.065, 0.03),
    ball(shine(), s * -0.02 + 0.045, 0.02, 0.16, 0.025)
  ], s * 0.24, 0.02, 0));
}

function lashEyes() {
  return pair(s => {
    const lid = [[-0.19, 0.02, 0.05], [-0.1, 0.16, 0.1], [0.05, 0.2, 0.1], [0.19, 0.04, 0.05]];
    const parts = [
      ball(white(), 0, 0, 0, 0.18, 0.2, 0.12),
      ball(plastic('#7a4a22'), 0, -0.03, 0.1, 0.1, 0.1, 0.03),
      ball(black(), 0, -0.03, 0.125, 0.055, 0.055, 0.02),
      ball(shine(), 0.035, 0.01, 0.14, 0.02),
      tube(lid.map(([x, y, z]) => [x * s, y, z]), 0.022, black())
    ];
    // three lashes flicking up and outward
    [[-0.02, 0.19], [0.08, 0.17], [0.16, 0.11]].forEach(([x, y], i) => {
      parts.push(tube([[x * s, y, 0.1], [(x + 0.04 + i * 0.02) * s, y + 0.1, 0.11]], 0.012, black()));
    });
    return group(parts, s * 0.23, 0, 0);
  });
}

function sleepyEyes() {
  return pair(s => {
    // the eyelid is half a ball tipped forward over the top of the eye
    const lid = rot(mesh(HALF_SPHERE, plastic('#7fa6d9', { side: THREE.DoubleSide }), 0, 0, 0, 0.205, 0.215, 0.13), 0.4, 0, 0);
    return group([
      ball(white(), 0, 0, 0, 0.19, 0.2, 0.12),
      ball(plastic('#2f6fd6'), 0, -0.06, 0.095, 0.1, 0.1, 0.03),
      ball(black(), 0, -0.06, 0.118, 0.05, 0.05, 0.02),
      lid,
      tube([[-0.2, 0, 0.01], [-0.14, -0.035, 0.09], [0, -0.05, 0.122], [0.14, -0.035, 0.09], [0.2, 0, 0.01]], 0.018, black())
    ], s * 0.24, 0, 0);
  });
}

function brows(angry) {
  const hair = soft(angry ? '#2a1a10' : '#4a2c17', { roughness: 0.9 });
  // angry brows point down toward the nose
  const points = angry ?
    [[0.06, -0.05, 0.06], [0.2, 0.03, 0.07], [0.36, 0.11, 0.04]] :
    [[0.08, 0, 0.05], [0.22, 0.09, 0.07], [0.36, 0.03, 0.04]];
  return pair(s => tube(points.map(([x, y, z]) => [x * s, y, z]), angry ? 0.045 : 0.035, hair));
}

function mouthTeeth() {
  const red = plastic('#d8343a');
  const tooth = plastic('#fffdf4', { roughness: 0.3 });
  const parts = [
    ball(soft('#4a0f12'), 0, -0.04, 0.03, 0.34, 0.11, 0.07),
    tube([[-0.4, 0.07, 0], [-0.22, -0.11, 0.07], [0, -0.17, 0.09], [0.22, -0.11, 0.07], [0.4, 0.07, 0]], 0.06, red),
    tube([[-0.4, 0.07, 0], [-0.18, 0.03, 0.08], [0, 0.05, 0.09], [0.18, 0.03, 0.08], [0.4, 0.07, 0]], 0.045, red)
  ];
  [-0.135, -0.045, 0.045, 0.135].forEach(x => parts.push(mesh(TOOTH, tooth, x, 0, 0.085)));
  return group(parts);
}

function mouthLips() {
  const red = plastic('#e3263b', { clearcoat: 1, roughness: 0.15 });
  return group([
    tube([[-0.32, 0, 0], [-0.16, 0.07, 0.08], [0, 0.03, 0.1], [0.16, 0.07, 0.08], [0.32, 0, 0]], 0.055, red),
    tube([[-0.32, 0, 0], [-0.13, -0.08, 0.09], [0, -0.1, 0.1], [0.13, -0.08, 0.09], [0.32, 0, 0]], 0.07, red)
  ]);
}

function mustache() {
  const hair = soft('#3b2416', { roughness: 0.85 });
  const tooth = plastic('#fffdf4', { roughness: 0.3 });
  return group([
    // each side curls up at the end
    pair(s => tube([[0.02 * s, 0, 0.1], [0.18 * s, 0.03, 0.11], [0.32 * s, -0.03, 0.08], [0.42 * s, 0.05, 0.05], [0.36 * s, 0.13, 0.04]], 0.06, hair)),
    ball(hair, 0, 0.01, 0.1, 0.09, 0.07, 0.07),
    mesh(BIG_TOOTH, tooth, -0.045, -0.11, 0.07),
    mesh(BIG_TOOTH, tooth, 0.045, -0.11, 0.07)
  ]);
}

// on the side of the potato the model's x points toward or away from the camera,
// so the inside of the ear goes on +x for the left ear and -x for the right one
function ear(side) {
  const cup = side === 'left' ? 1 : -1;
  return group([
    ball(plastic('#f0a58c', { roughness: 0.5, clearcoat: 0.3 }), 0, 0.02, 0.12, 0.07, 0.22, 0.15),
    ball(soft('#d8735e'), cup * 0.04, 0.02, 0.13, 0.035, 0.15, 0.1)
  ]);
}

function topHat() {
  const felt = plastic('#1e1e24', { roughness: 0.45, clearcoat: 0.3 });
  return upright([
    mesh(new THREE.CylinderGeometry(0.78, 0.78, 0.05, 48), felt),
    mesh(new THREE.CylinderGeometry(0.46, 0.5, 0.8, 48), felt, 0, 0.42, 0),
    mesh(new THREE.CylinderGeometry(0.505, 0.51, 0.13, 48), plastic('#c0392b'), 0, 0.1, 0)
  ], 0.12);
}

function cap() {
  const blue = plastic('#2f6fd6', { roughness: 0.55, clearcoat: 0.2, side: THREE.DoubleSide });
  // the brim is half a disc sticking out the front
  const brim = mesh(new THREE.CylinderGeometry(0.42, 0.42, 0.035, 32, 1, false, -Math.PI / 2, Math.PI), blue, 0, 0.02, 0.44, 1.3, 1, 1.05);
  brim.rotation.x = 0.12;
  return upright([
    mesh(HALF_SPHERE, blue, 0, 0, 0, 0.62, 0.5, 0.62),
    brim,
    ball(plastic('#f4a62a'), 0, 0.5, 0, 0.06, 0.04, 0.06)
  ], 0.12);
}

function partyHat() {
  // diagonal stripes on the texture wrap around the cone into a spiral
  const stripes = canvasTexture(256, 256, g => {
    g.fillStyle = '#ff5c8a';
    g.fillRect(0, 0, 256, 256);
    g.strokeStyle = '#ffd23f';
    g.lineWidth = 28;
    for (let x = -256; x < 512; x += 72) {
      g.beginPath();
      g.moveTo(x, 256);
      g.lineTo(x + 256, 0);
      g.stroke();
    }
    g.fillStyle = '#4fc3f7';
    for (let i = 0; i < 12; i++) {
      g.beginPath();
      g.arc((i * 61) % 256, (i * 97) % 256, 9, 0, Math.PI * 2);
      g.fill();
    }
  });
  stripes.wrapS = THREE.RepeatWrapping;
  stripes.repeat.set(2, 1);

  return upright([
    mesh(new THREE.ConeGeometry(0.42, 1.1, 48, 1, true), plastic('#ffffff', { map: stripes, roughness: 0.5, clearcoat: 0.4, side: THREE.DoubleSide }), 0, 0.55, 0),
    rot(mesh(new THREE.TorusGeometry(0.42, 0.05, 12, 48), plastic('#ffffff')), Math.PI / 2, 0, 0),
    ball(soft('#ffd23f', { roughness: 1 }), 0, 1.12, 0, 0.12)
  ], 0.1);
}

function blondeWig() {
  const hair = soft('#f2c94c', { roughness: 0.6 });
  const curls = [];
  const count = 70;
  // curls spread evenly over a dome (a fibonacci spiral)
  for (let k = 0; k < count; k++) {
    const y = 1 - (k / (count - 1)) * 0.95;
    const r = Math.sqrt(1 - y * y);
    const angle = k * 2.39996;
    const x = Math.cos(angle) * r;
    const z = Math.sin(angle) * r;
    if (z > 0.3 && y < 0.45) continue; // leave the forehead clear
    curls.push(ball(hair, x * 0.66, y * 0.7 - 0.22, z * 0.66, 0.15 + 0.04 * Math.sin(k * 1.7)));
  }
  return upright(curls, 0.05);
}

function brownWig() {
  const hair = soft('#6b3e1f', { roughness: 0.55, side: THREE.DoubleSide });
  const strand = soft('#55301a', { roughness: 0.6 });
  const parts = [
    mesh(HALF_SPHERE, hair, 0, -0.18, 0, 0.7, 0.62, 0.7),
    pair(s => ball(hair, s * 0.6, -0.5, -0.05, 0.2, 0.5, 0.32)),
    ball(hair, 0, -0.45, -0.42, 0.6, 0.55, 0.25),
    rot(ball(hair, 0, -0.2, 0.6, 0.45, 0.14, 0.14), 0.4, 0, 0)
  ];
  // strands running down the dome from the top
  for (let i = 0; i < 14; i++) {
    const a = (i / 14) * Math.PI * 2;
    const points = [0.05, 0.5, 0.95, 1.35].map(phi => [Math.sin(phi) * Math.cos(a) * 0.71, Math.cos(phi) * 0.63 - 0.18, Math.sin(phi) * Math.sin(a) * 0.71]);
    parts.push(tube(points, 0.035, strand));
  }
  return upright(parts, 0.1);
}

// the arm reaches out and bends up into a white glove, the thumb points toward the camera
function arm(side) {
  const thumb = side === 'left' ? 1 : -1;
  const glove = plastic('#fbfaf5', { roughness: 0.45 });
  return group([
    tube([[0, 0, -0.05], [0, 0.04, 0.35], [0, 0.22, 0.62], [0, 0.5, 0.76]], 0.075, plastic('#f4f1e6', { roughness: 0.5 })),
    rot(mesh(new THREE.TorusGeometry(0.1, 0.04, 12, 32), glove, 0, 0.53, 0.77), Math.PI / 2, 0, 0),
    ball(glove, 0, 0.7, 0.78, 0.1, 0.17, 0.16),
    ...[-0.085, 0, 0.085].map(dz => ball(glove, 0, 0.88 - Math.abs(dz) * 0.4, 0.78 + dz, 0.045, 0.1, 0.05)),
    ball(glove, thumb * 0.12, 0.7, 0.74, 0.08, 0.045, 0.045)
  ]);
}

function shoes(sneakers) {
  const leather = sneakers ? plastic('#d62828', { roughness: 0.5, clearcoat: 0.2 }) : plastic('#6b3a1e', { roughness: 0.35, clearcoat: 0.8 });
  const sole = sneakers ? plastic('#f8f8f4', { roughness: 0.6, clearcoat: 0 }) : soft('#2b1a10');
  return onFloor([pair(s => {
    const parts = [
      ball(leather, 0, -0.15, 0.1, 0.21, 0.15, 0.34),
      ball(sole, 0, -0.29, 0.1, sneakers ? 0.235 : 0.22, sneakers ? 0.06 : 0.04, sneakers ? 0.37 : 0.36),
      ball(soft('#1a0f08'), 0, -0.02, -0.04, 0.12, 0.03, 0.12) // the hole for the foot
    ];
    if (sneakers) {
      parts.push(ball(sole, 0, -0.2, 0.34, 0.15, 0.09, 0.12)); // rubber toe cap
      [0.04, 0.12, 0.2].forEach(z => parts.push(mesh(new THREE.BoxGeometry(0.16, 0.02, 0.03), sole, 0, 0, z)));
    }
    return group(parts, s * 0.3, 0, 0);
  })], 0.05);
}

function glasses() {
  const red = plastic('#e02f3b', { clearcoat: 1, roughness: 0.2 });
  const lens = new THREE.MeshPhysicalMaterial({ color: srgb('#bfe3ff'), roughness: 0.05, transparent: true, opacity: 0.25, clearcoat: 1 });
  return group([
    pair(s => group([
      mesh(new THREE.TorusGeometry(0.17, 0.028, 12, 40), red),
      noShadow(ball(lens, 0, 0, 0, 0.165, 0.165, 0.015))
    ], s * 0.24, 0, 0.2)),
    tube([[-0.08, 0.03, 0.2], [0, 0.08, 0.21], [0.08, 0.03, 0.2]], 0.024, red),
    pair(s => tube([[s * 0.41, 0.02, 0.19], [s * 0.5, 0.02, 0.05], [s * 0.55, 0, -0.25]], 0.022, red))
  ]);
}

// big black glasses, bushy brows, a big pink nose and a mustache, all in one piece
function disguise() {
  const frame = plastic('#151515', { roughness: 0.4 });
  const fuzz = soft('#151515', { roughness: 1 });
  return group([
    pair(s => mesh(new THREE.TorusGeometry(0.16, 0.045, 12, 40), frame, s * 0.24, 0.12, 0.2)),
    tube([[-0.09, 0.15, 0.22], [0, 0.19, 0.23], [0.09, 0.15, 0.22]], 0.035, frame),
    pair(s => tube([[s * 0.1, 0.33, 0.2], [s * 0.24, 0.38, 0.22], [s * 0.4, 0.32, 0.17]], 0.06, fuzz)),
    ball(plastic('#f2a39b', { roughness: 0.45 }), 0, -0.08, 0.3, 0.15, 0.19, 0.2),
    ball(fuzz, 0, -0.3, 0.24, 0.26, 0.07, 0.09),
    pair(s => rot(ball(fuzz, s * 0.2, -0.33, 0.2, 0.16, 0.065, 0.08), 0, 0, -s * 0.35))
  ]);
}

// mount is only used to turn the sidebar pictures so each part looks the way it does on the potato
const PARTS = {
  'eyes-googly': { build: googlyEyes, mount: 'face' },
  'eyes-big': { build: bigEyes, mount: 'face' },
  'eyes-lashes': { build: lashEyes, mount: 'face' },
  'eyes-sleepy': { build: sleepyEyes, mount: 'face' },
  'brows-happy': { build: () => brows(false), mount: 'face' },
  'brows-angry': { build: () => brows(true), mount: 'face' },
  'nose-orange': { build: () => group([ball(plastic('#f28c28'), 0, 0, 0.17, 0.2, 0.18, 0.28)]), mount: 'face' },
  'nose-red': { build: () => group([ball(plastic('#e0262b', { clearcoat: 1, roughness: 0.2 }), 0, 0, 0.13, 0.2)]), mount: 'face' },
  'mouth-teeth': { build: mouthTeeth, mount: 'face' },
  'mouth-lips': { build: mouthLips, mount: 'face' },
  'mustache': { build: mustache, mount: 'face' },
  'ear-left': { build: () => ear('left'), mount: 'left' },
  'ear-right': { build: () => ear('right'), mount: 'right' },
  'hat-top': { build: topHat, mount: 'top' },
  'hat-cap': { build: cap, mount: 'top' },
  'hat-party': { build: partyHat, mount: 'top' },
  'wig-blonde': { build: blondeWig, mount: 'top' },
  'wig-brown': { build: brownWig, mount: 'top' },
  'arm-left': { build: () => arm('left'), mount: 'left' },
  'arm-right': { build: () => arm('right'), mount: 'right' },
  'shoes-brown': { build: () => shoes(false), mount: 'bottom' },
  'shoes-red': { build: () => shoes(true), mount: 'bottom' },
  'glasses-red': { build: glasses, mount: 'face' },
  'disguise': { build: disguise, mount: 'face' }
};

const MOUNTS = {
  face: new THREE.Vector3(0, 0, 1),
  top: new THREE.Vector3(0, 1, 0),
  bottom: new THREE.Vector3(0, -1, 0),
  left: new THREE.Vector3(-1, 0, 0),
  right: new THREE.Vector3(1, 0, 0)
};

// =====================================================================
// sidebar pictures, rendered once from the 3d models
// =====================================================================

function makeThumbnails() {
  const size = 160;
  const r = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
  r.setSize(size, size);
  r.outputEncoding = THREE.sRGBEncoding;
  r.toneMapping = THREE.ACESFilmicToneMapping;

  const s = new THREE.Scene();
  const light = new THREE.DirectionalLight(0xfff1d6, 1.6);
  light.position.set(2, 4, 5);
  s.add(new THREE.HemisphereLight(0xcfe8ff, 0x8a6a3a, 0.8), light);
  const cam = new THREE.PerspectiveCamera(30, 1, 0.1, 50);

  $('.part').each((_, el) => {
    const part = PARTS[el.dataset.part];
    const mounted = group([part.build()]);
    mounted.quaternion.setFromUnitVectors(Z_AXIS, MOUNTS[part.mount]);
    // turned a little so it looks 3d
    const turned = rot(group([mounted]), 0.15, 0.45, 0);
    s.add(turned);

    const sphere = new THREE.Box3().setFromObject(turned).getBoundingSphere(new THREE.Sphere());
    const distance = sphere.radius / Math.sin(THREE.MathUtils.degToRad(cam.fov / 2));
    cam.position.copy(sphere.center).add(new THREE.Vector3(0, 0, distance));
    cam.lookAt(sphere.center);
    r.render(s, cam);
    $(el).find('img').attr('src', r.domElement.toDataURL());

    s.remove(turned);
  });

  r.dispose();
  r.forceContextLoss();
}

makeThumbnails();

// =====================================================================
// pieces on the potato
// =====================================================================

const pieces = []; // what's on the potato (and gets saved)
const dying = []; // pieces shrinking away after being thrown out

// a piece is stuck to the potato at point, facing out along normal (both in holder space)
function addPiece(p) {
  const model = PARTS[p.type].build();
  const piece = group([model]);
  const point = new THREE.Vector3(...p.point);
  const normal = new THREE.Vector3(...p.normal).normalize();
  const googlies = [];
  model.traverse(o => o.userData.googly && googlies.push(o));

  piece.userData = {
    type: p.type,
    point,
    normal,
    targetPoint: point.clone(),
    targetNormal: normal.clone(),
    lift: new Spring(0, 300, 22),
    squash: new Spring(0, 300, 9), // underdamped, so it wobbles a few times
    spin: new Spring(p.spin, 200, 13),
    size: new Spring(0, 220, 13),
    finalSize: p.size,
    wait: p.delay || 0, // so loaded designs can pop in one after another
    googlies,
    lastWorld: new THREE.Vector3(),
    onPotato: p.onPotato !== false
  };
  if (!piece.userData.wait) piece.userData.size.target = p.size;

  holder.add(piece);
  pieces.push(piece);
  return piece;
}

function throwAway(piece) {
  const ud = piece.userData;
  pieces.splice(pieces.indexOf(piece), 1);
  dying.push(piece);
  ud.dragging = false;
  ud.size = Object.assign(new Spring(ud.size.value, 260, 30), { target: 0 });
  ud.spin.target += Math.PI;
}

const tmpVector = new THREE.Vector3();
const tmpQuaternion = new THREE.Quaternion();

function updatePiece(piece, dt) {
  const ud = piece.userData;

  if (ud.wait > 0) {
    ud.wait -= dt;
    if (ud.wait <= 0) ud.size.target = ud.finalSize;
  }

  // slide smoothly toward where the mouse put it
  const follow = 1 - Math.exp(-dt * 22);
  ud.point.lerp(ud.targetPoint, follow);
  ud.normal.lerp(ud.targetNormal, follow).normalize();

  const lift = ud.lift.step(dt);
  const squash = ud.squash.step(dt);
  const spin = ud.spin.step(dt);
  const size = Math.max(ud.size.step(dt), 0.001);

  // it just hit the potato: squash flat and make the potato wobble
  if (ud.landing && lift < 0.02) {
    ud.landing = false;
    ud.squash.velocity += 9;
    if (ud.onPotato) wobble.velocity += 0.9;
  }

  piece.position.copy(ud.point).addScaledVector(ud.normal, lift);
  piece.quaternion.setFromUnitVectors(Z_AXIS, ud.normal).multiply(tmpQuaternion.setFromAxisAngle(Z_AXIS, spin));
  // squashing flattens it along the normal and spreads it sideways, so it keeps its volume
  piece.scale.set(size * (1 + squash * 0.5), size * (1 + squash * 0.5), size * (1 - squash));

  updateGooglies(piece, dt);
}

// googly pupils lag behind when the eyes move, then rattle back down
function updateGooglies(piece, dt) {
  const ud = piece.userData;
  if (!ud.googlies.length || dt <= 0) return;

  piece.updateMatrixWorld();
  piece.getWorldPosition(tmpVector);
  // no last position on the first frame, so count it as standing still
  const velocity = ud.seen ? tmpVector.clone().sub(ud.lastWorld).divideScalar(dt) : new THREE.Vector3();
  ud.lastWorld.copy(tmpVector);
  ud.seen = true;

  // turn the movement and gravity into the eye's own directions
  piece.getWorldQuaternion(tmpQuaternion).invert();
  velocity.applyQuaternion(tmpQuaternion);
  const down = new THREE.Vector3(0, -1, 0).applyQuaternion(tmpQuaternion);

  ud.googlies.forEach(pupil => {
    const g = pupil.userData.googly;
    const targetX = THREE.MathUtils.clamp(down.x * 0.07 - velocity.x * 0.02, -0.08, 0.08);
    const targetY = THREE.MathUtils.clamp(down.y * 0.07 - velocity.y * 0.02, -0.08, 0.08);
    g.vx += (-(g.x - targetX) * 260 - g.vx * 7) * dt;
    g.vy += (-(g.y - targetY) * 260 - g.vy * 7) * dt;
    g.x += g.vx * dt;
    g.y += g.vy * dt;

    // keep it inside the eye
    const length = Math.hypot(g.x, g.y);
    if (length > 0.085) {
      g.x *= 0.085 / length;
      g.y *= 0.085 / length;
    }
    pupil.position.x = g.x;
    pupil.position.y = g.y;
  });
}

// =====================================================================
// pointing at things
// =====================================================================

const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();

function aim(e) {
  const rect = canvas.getBoundingClientRect();
  pointer.set(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
  raycaster.setFromCamera(pointer, camera);
}

// the piece under the mouse, unless the potato is in front of it
function pieceAt(e) {
  aim(e);
  const hit = raycaster.intersectObjects([potato, ...pieces], true)[0];
  if (!hit) return null;
  let object = hit.object;
  while (object && !pieces.includes(object)) object = object.parent;
  return object;
}

// where on the potato the mouse is pointing, or a spot floating in front of it if it misses
function surfaceAt(e) {
  aim(e);
  holder.updateMatrixWorld();
  const hit = raycaster.intersectObject(potato)[0];
  if (hit) {
    return { point: holder.worldToLocal(hit.point.clone()), normal: hit.face.normal.clone(), onPotato: true };
  }

  const center = holder.getWorldPosition(new THREE.Vector3());
  const toCamera = camera.position.clone().sub(center).normalize();
  const spot = raycaster.ray.intersectPlane(new THREE.Plane().setFromNormalAndCoplanarPoint(toCamera, center), new THREE.Vector3()) || center;
  const normal = holder.worldToLocal(center.clone().add(toCamera)).sub(holder.worldToLocal(center.clone())).normalize();
  return { point: holder.worldToLocal(spot.clone()), normal, onPotato: false };
}

function isOver($element, e) {
  const rect = $element[0].getBoundingClientRect();
  return e.clientX >= rect.left && e.clientX <= rect.right && e.clientY >= rect.top && e.clientY <= rect.bottom;
}

// =====================================================================
// dragging pieces and spinning the potato
// =====================================================================

// pointer events cover the mouse and touchscreens, so one set of handlers works for both.
// every finger has its own pointerId, so a second finger can't hijack the drag
let drag = null; // the finger (or mouse) that's dragging a piece or spinning the potato
let pinch = null; // a second finger on the screen while a piece is held, for pinch to resize
let lastTap = null; // for spotting a double tap

$(window).on('pointermove', handleMove).on('pointerup pointercancel', handleUp);

// pressing a sidebar part makes a new copy of it, so a part can be used more than once
$('.part').on('pointerdown', e => {
  if (drag) return;
  e.preventDefault();
  const spot = surfaceAt(e);
  const piece = addPiece({
    type: e.currentTarget.dataset.part,
    point: spot.point.toArray(),
    normal: spot.normal.toArray(),
    spin: 0,
    size: 1,
    onPotato: spot.onPotato
  });
  startDrag(e, piece, true);
});

// pressing a piece picks it up, pressing anywhere else spins the potato
$(canvas).on('pointerdown', e => {
  e.preventDefault();

  if (drag) {
    // a second finger while holding a piece starts a pinch, any other extra finger is ignored
    if (drag.piece && !pinch) {
      pinch = {
        id: e.pointerId,
        x: e.clientX,
        y: e.clientY,
        startDistance: Math.max(Math.hypot(e.clientX - drag.cx, e.clientY - drag.cy), 1),
        startSize: drag.piece.userData.finalSize
      };
      drag.pinched = true;
    }
    return;
  }

  const piece = pieceAt(e);
  if (piece) {
    startDrag(e, piece, false);
  } else {
    drag = { id: e.pointerId, x: e.clientX, y: e.clientY, dx: 0 };
    $(canvas).addClass('grabbing');
  }
});

function startDrag(e, piece, isNew) {
  drag = { id: e.pointerId, piece, isNew, x: e.clientX, y: e.clientY, cx: e.clientX, cy: e.clientY, moved: false };
  if (isNew) liftUp(piece);
  $(canvas).addClass('grabbing');
}

// spreading two fingers grows the piece, pinching them together shrinks it
function updatePinch() {
  const ud = drag.piece.userData;
  const distance = Math.hypot(drag.cx - pinch.x, drag.cy - pinch.y);
  ud.finalSize = THREE.MathUtils.clamp(pinch.startSize * distance / pinch.startDistance, 0.4, 2.5);
  ud.size.target = ud.finalSize;
}

function twist(piece) {
  piece.userData.spin.target += THREE.MathUtils.degToRad(15);
  piece.userData.squash.velocity += 4;
  saveCurrent();
}

// anticipation: it dips into the potato and squashes a little before popping up
function liftUp(piece) {
  const ud = piece.userData;
  drag.moved = true;
  ud.dragging = true;
  ud.landing = false;
  ud.lift.velocity = -1.5;
  ud.lift.target = 0.3;
  ud.squash.velocity = 7;
}

function handleMove(e) {
  if (!drag) return;

  if (pinch && e.pointerId === pinch.id) {
    pinch.x = e.clientX;
    pinch.y = e.clientY;
    updatePinch();
    return;
  }
  if (e.pointerId !== drag.id) return;

  if (pinch) {
    // the piece holds still while it's being pinched
    drag.cx = e.clientX;
    drag.cy = e.clientY;
    updatePinch();
    return;
  }

  if (!drag.piece) {
    // spinning the potato
    const dx = e.clientX - drag.x;
    const dy = e.clientY - drag.y;
    drag.x = e.clientX;
    drag.y = e.clientY;
    drag.dx = dx;
    spinY.target += dx * 0.012;
    tilt.target = THREE.MathUtils.clamp(tilt.target + dy * 0.006, -0.35, 0.35);
    return;
  }

  drag.cx = e.clientX;
  drag.cy = e.clientY;

  // a click that doesn't move (like a double click) shouldn't pick the piece up
  if (!drag.moved) {
    if (Math.hypot(e.clientX - drag.x, e.clientY - drag.y) < 5) return;
    liftUp(drag.piece);
  }

  const spot = surfaceAt(e);
  const ud = drag.piece.userData;
  ud.targetPoint.copy(spot.point);
  ud.targetNormal.copy(spot.normal);
  ud.onPotato = spot.onPotato;

  $trash.toggleClass('open', isOver($trash, e));
}

function handleUp(e) {
  if (!drag) return;

  if (pinch && e.pointerId === pinch.id) {
    pinch = null;
    saveCurrent();
    return;
  }
  if (e.pointerId !== drag.id) return;

  pinch = null;
  $(canvas).removeClass('grabbing');
  // pointercancel means the browser took over the touch (like scrolling the parts strip)
  const cancelled = e.type === 'pointercancel';

  if (!drag.piece) {
    // let go of a spin: fling it a little further, and the tilt springs back level
    spinY.target += drag.dx * 0.05;
    tilt.target = 0;
  } else if (cancelled && drag.isNew) {
    // the finger was scrolling the sidebar, not pulling a part out
    throwAway(drag.piece);
  } else if (drag.moved) {
    // dropped on the trash or back on the sidebar, throw it away
    if (!cancelled && (isOver($trash, e) || isOver($sidebar, e))) {
      throwAway(drag.piece);
    } else {
      const ud = drag.piece.userData;
      ud.dragging = false;
      ud.lift.target = 0;
      ud.landing = true;
    }
    saveCurrent();
  } else if (drag.pinched) {
    saveCurrent();
  } else {
    // a tap that didn't move: two quick taps on the same piece twist it
    const now = performance.now();
    if (lastTap && lastTap.piece === drag.piece && now - lastTap.time < 400) {
      twist(drag.piece);
      lastTap = null;
    } else {
      lastTap = { piece: drag.piece, time: now };
    }
  }

  $trash.removeClass('open');
  drag = null;
}

// =====================================================================
// resize (mouse wheel, or pinch above) and twist (double click or double tap, in handleUp)
// =====================================================================

canvas.addEventListener('wheel', e => {
  const piece = pieceAt(e);
  if (!piece) return;
  e.preventDefault();

  const ud = piece.userData;
  const grow = e.deltaY < 0;
  ud.finalSize = THREE.MathUtils.clamp(ud.finalSize * (grow ? 1.1 : 0.9), 0.4, 2.5);
  ud.size.target = ud.finalSize;
  ud.squash.velocity += grow ? -3 : 3; // stretches when it grows, squashes when it shrinks
  saveCurrent();
}, { passive: false });

// touchscreens get tips that match what fingers can do
if (window.matchMedia('(pointer: coarse)').matches) {
  $('#hint').text('drag parts onto the potato · swipe to spin him · pinch a part to resize · double tap to twist');
}

// =====================================================================
// pieces <-> plain objects (what gets saved in localStorage)
// =====================================================================

const round = n => Math.round(n * 1000) / 1000;

function getPieces() {
  return pieces.map(piece => {
    const ud = piece.userData;
    return {
      type: ud.type,
      point: ud.targetPoint.toArray().map(round),
      normal: ud.targetNormal.toArray().map(round),
      spin: round(ud.spin.target),
      size: round(ud.finalSize),
      onPotato: ud.onPotato
    };
  });
}

function showPieces(list) {
  [...pieces].forEach(throwAway);
  list.filter(p => PARTS[p.type]).forEach((p, i) => addPiece({ ...p, delay: 0.15 + i * 0.05 }));
}

function load(key, fallback) {
  try {
    return JSON.parse(localStorage.getItem(key)) ?? fallback;
  } catch {
    return fallback;
  }
}

// =====================================================================
// the current picture is saved after every change and restored when the page opens
// (new keys, because the old flat-picture saves don't fit the 3d potato)
// =====================================================================

function saveCurrent() {
  localStorage.setItem('potato3dCurrent', JSON.stringify(getPieces()));
}

showPieces(load('potato3dCurrent', []));

$('#clear').on('click', () => {
  showPieces([]);
  saveCurrent();
});

// =====================================================================
// named designs
// =====================================================================

const designs = load('potato3dDesigns', []);
const $designsList = $('#designs');
const $designName = $('#designName');

$('#save').on('click', () => {
  const name = $designName.val().trim() || `design ${designs.length + 1}`;
  const design = { name, pieces: getPieces() };

  // saving with a name that already exists replaces that design
  const index = designs.findIndex(d => d.name === name);
  if (index === -1) {
    designs.push(design);
  } else {
    designs[index] = design;
  }

  $designName.val('');
  saveDesigns();
});

function saveDesigns() {
  localStorage.setItem('potato3dDesigns', JSON.stringify(designs));
  showDesigns();
}

const $designsMenu = $('#designsMenu');

// the dropdown button opens and closes the list
$('#designsBtn').on('click', () => $designsMenu.toggleClass('open'));

// clicking anywhere outside the dropdown closes it
$(document).on('pointerdown', e => {
  if (!$(e.target).closest('#designsMenu').length) {
    $designsMenu.removeClass('open');
  }
});

// one row per saved design, click the name to load it, the x deletes it
// (the rows are made fresh every time, so each button only ever gets one click handler)
function showDesigns() {
  $designsList.empty();
  $('#designsBtn').text(`saved designs (${designs.length}) ▾`);

  if (!designs.length) {
    $('<li class="empty">no saved designs yet</li>').appendTo($designsList);
  }

  designs.forEach((design, index) => {
    const $load = $('<button class="load">')
      .text(design.name)
      .on('click', () => {
        showPieces(design.pieces);
        saveCurrent();
        $designsMenu.removeClass('open');
      });

    // no text, the x is drawn by .delete::before in the css
    const $delete = $('<button class="delete">')
      .attr('title', `delete ${design.name}`)
      .on('click', () => {
        designs.splice(index, 1);
        saveDesigns();
      });

    $('<li class="design">').append($load, $delete).appendTo($designsList);
  });
}

showDesigns();

// =====================================================================
// background (and the lighting to match it)
// =====================================================================

const backgrounds = [
  { image: 'images/background-day.svg', color: '#7cc8f5', lighting: 'day', next: '🌙 night' },
  { image: 'images/background-night.svg', color: '#14183a', lighting: 'night', next: '☀️ day' }
];
let backgroundIndex = load('potatoBackground', 0) % backgrounds.length;

function showBackground() {
  const background = backgrounds[backgroundIndex];
  $('body').css({ backgroundImage: `url(${background.image})`, backgroundColor: background.color });
  $('#backgroundBtn').text(background.next);
  setLighting(background.lighting);
}

$('#backgroundBtn').on('click', () => {
  backgroundIndex = (backgroundIndex + 1) % backgrounds.length;
  localStorage.setItem('potatoBackground', backgroundIndex);
  showBackground();
});

showBackground();

// =====================================================================
// music
// =====================================================================

const music = $('#music')[0];
const $musicBtn = $('#musicBtn');
music.volume = 0.5;

// browsers block music until the user clicks or taps something, so start it on the first press anywhere
// (unless that press is the music button, which handles it itself)
$(document).one('pointerdown', e => {
  if (!$(e.target).closest('#musicBtn').length) {
    music.play();
  }
});

$musicBtn.on('click', () => {
  if (music.paused) {
    music.play();
  } else {
    music.pause();
  }
});

$(music).on('play pause', () => {
  $musicBtn.text(music.paused ? '♪ music off' : '♪ music on').toggleClass('playing', !music.paused);
});

// =====================================================================
// every frame
// =====================================================================

const clock = new THREE.Clock();

function frame() {
  const dt = Math.min(clock.getDelta(), 1 / 30); // a long pause (like a hidden tab) shouldn't make the springs explode
  const t = clock.elapsedTime;

  turntable.rotation.y = spinY.step(dt);
  turntable.rotation.x = tilt.step(dt);

  // a very slow breath and sway so he never looks frozen
  const breath = reduceMotion ? 0 : Math.sin(t * 1.3) * 0.008;
  turntable.rotation.z = reduceMotion ? 0 : Math.sin(t * 0.7) * 0.015;
  const w = wobble.step(dt);
  body.scale.set(1 + w * 0.5 - breath * 0.5, 1 - w + breath, 1 + w * 0.5 - breath * 0.5);

  pieces.forEach(piece => updatePiece(piece, dt));
  for (let i = dying.length - 1; i >= 0; i--) {
    const piece = dying[i];
    updatePiece(piece, dt);
    if (piece.userData.size.value < 0.03) {
      holder.remove(piece);
      dying.splice(i, 1);
    }
  }

  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}

requestAnimationFrame(frame);
