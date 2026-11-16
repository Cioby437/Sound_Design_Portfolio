import * as THREE from 'three';

// Append ?debug to the URL to see renderer status in the corner.
const DEBUG = location.search.includes('debug');
const dbg = (msg) => {
  if (!DEBUG) return;
  let el = document.getElementById('dbg');
  if (!el) { el = document.createElement('pre'); el.id = 'dbg'; el.style.cssText = 'position:fixed;left:8px;bottom:8px;z-index:9;color:#0f0;font:12px monospace;margin:0;background:#000a;padding:6px'; document.body.appendChild(el); }
  el.textContent += msg + '\n';
};
window.addEventListener('error', (e) => dbg('error: ' + e.message));

/* =========================================================
   Particle cassette
   assets/cassette.bin = [uint32 count][int16 xyz * count][uint8 rgb * count]
   Points were sampled from the "portable_cassette_player_casette" mesh of the
   FBX, coloured from its diffuse texture (label details are over-sampled).
   ========================================================= */

const canvas = document.getElementById('bg');
const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, alpha: false, powerPreference: 'high-performance' });
renderer.setClearColor(0x000000, 1);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(35, 1, 0.1, 100);
camera.position.set(0, 0, 4.4);

const pivot = new THREE.Group();
scene.add(pivot);

const uniforms = {
  uTime: { value: 0 },
  uIntro: { value: reduceMotion ? 1 : 0 },
  uLevel: { value: 0 },
  uSize: { value: 1 },
  uPixelRatio: { value: renderer.getPixelRatio() },
  uReelAngle: { value: 0 },
};

// Hub centres of the two tape reels, in normalised model space.
const REELS = [new THREE.Vector2(-0.424, 0.071), new THREE.Vector2(0.424, 0.071)];
const REEL_RADIUS = 0.13;

const vertexShader = /* glsl */ `
  uniform float uTime;
  uniform float uIntro;
  uniform float uLevel;
  uniform float uSize;
  uniform float uPixelRatio;
  uniform float uReelAngle;
  uniform vec2 uReelL;
  uniform vec2 uReelR;
  attribute vec3 aColor;
  attribute vec4 aRand;
  attribute vec3 aScatter;
  attribute float aReel;
  varying vec3 vColor;
  varying float vAlpha;

  vec2 rot(vec2 p, vec2 c, float a) {
    vec2 d = p - c;
    float s = sin(a), co = cos(a);
    return c + vec2(d.x * co - d.y * s, d.x * s + d.y * co);
  }

  void main() {
    vec3 p = position;

    // spinning reel hubs
    if (aReel > 0.5 && aReel < 1.5) p.xy = rot(p.xy, uReelL, uReelAngle);
    else if (aReel > 1.5)            p.xy = rot(p.xy, uReelR, uReelAngle);

    // intro: particles fly in from a scattered cloud
    float t = clamp(uIntro * 1.6 - aRand.x * 0.6, 0.0, 1.0);
    t = 1.0 - pow(1.0 - t, 3.0);
    p = mix(aScatter, p, t);

    // idle shimmer
    float ph = aRand.z * 6.2831;
    p += vec3(sin(uTime * (0.6 + aRand.y) + ph), cos(uTime * (0.5 + aRand.w) + ph * 1.3), sin(uTime * 0.7 + ph * 0.7)) * 0.0045;

    // audio: breathe outward + jitter on transients
    vec3 dir = normalize(aScatter + 0.0001);
    p += dir * uLevel * (0.04 + aRand.w * 0.10);
    p.z += sin(uTime * 22.0 + ph * 3.0) * uLevel * 0.03 * aRand.y;

    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    gl_Position = projectionMatrix * mv;

    float lum = dot(aColor, vec3(0.299, 0.587, 0.114));
    float size = uSize * (0.55 + aRand.w * 0.7) * (1.0 + smoothstep(0.25, 0.6, lum) * 0.5) * (1.0 + uLevel * 0.9);
    gl_PointSize = size * uPixelRatio * (9.0 / -mv.z);

    // colour: dim cool grey for the shell, true (boosted) texture colour for labels
    vec3 shell = vec3(0.50, 0.55, 0.60);
    vec3 detail = min(aColor * 2.1 + 0.05, vec3(1.3));
    vColor = mix(shell, detail, smoothstep(0.22, 0.45, lum)) * (0.45 + lum * 1.1 + uLevel * 0.6);
    vAlpha = mix(0.0, 1.0, t) * (0.55 + aRand.y * 0.45);
  }
`;

const fragmentShader = /* glsl */ `
  varying vec3 vColor;
  varying float vAlpha;
  void main() {
    vec2 c = gl_PointCoord - 0.5;
    float d = length(c);
    if (d > 0.5) discard;
    float a = smoothstep(0.5, 0.0, d);
    gl_FragColor = vec4(vColor * a, a * vAlpha);
  }
`;

let points = null;

async function loadCassette() {
  const buf = await (await fetch('assets/cassette.bin')).arrayBuffer();
  const count = new DataView(buf).getUint32(0, true);
  const q = new Int16Array(buf, 4, count * 3);
  const rgb = new Uint8Array(buf, 4 + count * 6, count * 3);

  const pos = new Float32Array(count * 3);
  const col = new Float32Array(count * 3);
  const rnd = new Float32Array(count * 4);
  const scat = new Float32Array(count * 3);
  const reel = new Float32Array(count);

  for (let i = 0; i < count; i++) {
    const x = q[i * 3] / 32767, y = q[i * 3 + 1] / 32767, z = q[i * 3 + 2] / 32767;
    pos[i * 3] = x; pos[i * 3 + 1] = y; pos[i * 3 + 2] = z;
    col[i * 3] = rgb[i * 3] / 255; col[i * 3 + 1] = rgb[i * 3 + 1] / 255; col[i * 3 + 2] = rgb[i * 3 + 2] / 255;
    for (let k = 0; k < 4; k++) rnd[i * 4 + k] = Math.random();

    // random point in a spherical shell for the intro / audio direction
    const u = Math.random() * 2 - 1, th = Math.random() * Math.PI * 2, r = 2.5 + Math.random() * 3.5;
    const s = Math.sqrt(1 - u * u);
    scat[i * 3] = s * Math.cos(th) * r; scat[i * 3 + 1] = u * r; scat[i * 3 + 2] = s * Math.sin(th) * r;

    if (Math.hypot(x - REELS[0].x, y - REELS[0].y) < REEL_RADIUS) reel[i] = 1;
    else if (Math.hypot(x - REELS[1].x, y - REELS[1].y) < REEL_RADIUS) reel[i] = 2;
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('aColor', new THREE.BufferAttribute(col, 3));
  geo.setAttribute('aRand', new THREE.BufferAttribute(rnd, 4));
  geo.setAttribute('aScatter', new THREE.BufferAttribute(scat, 3));
  geo.setAttribute('aReel', new THREE.BufferAttribute(reel, 1));

  const mat = new THREE.ShaderMaterial({
    uniforms: { ...uniforms, uReelL: { value: REELS[0] }, uReelR: { value: REELS[1] } },
    vertexShader, fragmentShader,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
  });

  points = new THREE.Points(geo, mat);
  dbg('points: ' + count + ', gl: ' + renderer.getContext().getParameter(renderer.getContext().VERSION));
  pivot.add(points);
}

/* ---------- layout ---------- */
function resize() {
  const w = window.innerWidth, h = window.innerHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  // keep the cassette a comfortable size on narrow / portrait screens
  const fit = Math.min(1, (w / h) / 1.15);
  pivot.scale.setScalar(0.62 + 0.38 * fit);
  uniforms.uSize.value = w < 700 ? 1.15 : 1;
}
window.addEventListener('resize', resize);
resize();

/* ---------- interaction ---------- */
const mouse = { x: 0, y: 0, tx: 0, ty: 0 };
window.addEventListener('pointermove', (e) => {
  mouse.tx = (e.clientX / window.innerWidth) * 2 - 1;
  mouse.ty = (e.clientY / window.innerHeight) * 2 - 1;
});

let scrollFade = 1;
function onScroll() {
  const k = Math.min(1, window.scrollY / (window.innerHeight * 0.9));
  scrollFade = 1 - k;
  canvas.style.opacity = String(0.28 + 0.72 * scrollFade);
}
window.addEventListener('scroll', onScroll, { passive: true });
onScroll();

/* ---------- audio reactivity (the portfolio video drives the particles) ---------- */
const video = document.getElementById('reel');
const featured = document.getElementById('featured');
let analyser = null, freq = null, level = 0;

function initAudio() {
  if (analyser) return;
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    const ctx = new Ctx();
    const src = ctx.createMediaElementSource(video);
    analyser = ctx.createAnalyser();
    analyser.fftSize = 256;
    analyser.smoothingTimeConstant = 0.75;
    src.connect(analyser);
    analyser.connect(ctx.destination);
    freq = new Uint8Array(analyser.frequencyBinCount);
    video.addEventListener('play', () => ctx.resume());
  } catch (err) {
    analyser = null; // video still plays normally without the visual link
  }
}

document.getElementById('play').addEventListener('click', () => {
  initAudio();
  video.controls = true;
  featured.classList.add('playing');
  video.play();
});
video.addEventListener('ended', () => { featured.classList.remove('playing'); video.controls = false; });

function readLevel() {
  if (!analyser || video.paused) return 0;
  analyser.getByteFrequencyData(freq);
  let low = 0, all = 0;
  for (let i = 0; i < freq.length; i++) { all += freq[i]; if (i < 12) low += freq[i]; }
  return Math.min(1, (low / 12 / 255) * 0.75 + (all / freq.length / 255) * 0.9);
}

/* ---------- render loop ---------- */
const clock = new THREE.Clock();
let spin = 0, reelAngle = 0;

function frame() {
  const dt = Math.min(clock.getDelta(), 0.05);
  const t = clock.elapsedTime;

  if (points) {
    uniforms.uTime.value = t;
    if (uniforms.uIntro.value < 1) uniforms.uIntro.value = Math.min(1, uniforms.uIntro.value + dt / 2.8);

    level += (readLevel() - level) * 0.25;
    uniforms.uLevel.value = level;

    mouse.x += (mouse.tx - mouse.x) * 0.04;
    mouse.y += (mouse.ty - mouse.y) * 0.04;

    const speed = reduceMotion ? 0.12 : 0.42;
    spin += dt * speed * (1 + level * 1.5);
    pivot.rotation.y = spin + mouse.x * 0.35;
    pivot.rotation.x = Math.sin(t * 0.35) * 0.12 + mouse.y * 0.2;
    pivot.rotation.z = Math.sin(t * 0.22) * 0.04;
    pivot.position.y = 0.22 * scrollFade + Math.sin(t * 0.8) * 0.03;

    reelAngle -= dt * (1.2 + level * 6);
    uniforms.uReelAngle.value = reelAngle;
  }

  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}

loadCassette().catch((e) => { console.error('Could not load cassette particles', e); dbg('load failed: ' + e); });
dbg('module ok');
frame();

/* =========================================================
   Page UI
   ========================================================= */

// mobile menu
const toggle = document.querySelector('.nav-toggle');
toggle.addEventListener('click', () => {
  const open = document.body.classList.toggle('nav-open');
  toggle.setAttribute('aria-expanded', String(open));
});
document.querySelectorAll('.site-nav a').forEach((a) =>
  a.addEventListener('click', () => { document.body.classList.remove('nav-open'); toggle.setAttribute('aria-expanded', 'false'); })
);

// copy email
const copyBtn = document.getElementById('copyEmail');
copyBtn.addEventListener('click', async () => {
  const email = copyBtn.dataset.email;
  try {
    await navigator.clipboard.writeText(email);
    copyBtn.innerHTML = `${email} <span>— copied!</span>`;
  } catch {
    window.location.href = `mailto:${email}`;
  }
  setTimeout(() => (copyBtn.innerHTML = `${email} <span>— click to copy</span>`), 2200);
});

// reveal on scroll
const revealTargets = document.querySelectorAll('.section-title, .service, .about-copy, .edu-card, .software-list, .exp, .contact > p, .contact-buttons, .featured-caption');
revealTargets.forEach((el) => el.classList.add('reveal'));
const io = new IntersectionObserver((entries) => {
  entries.forEach((e) => { if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); } });
}, { threshold: 0.15 });
revealTargets.forEach((el) => io.observe(el));
