/* =========================================================
   NINGÚN NIÑO SIN REGALO · Fundación ITACA · 21 de diciembre
   Cartel interactivo en 3D real (Three.js r128 · WebGL)

   · Toda la escena está modelada en 3D con texturas procedurales
     (madera, tejas, nieve, agujas de pino, pelaje, arpillera,
     barro, metal y papeles de regalo) generadas con <canvas>.
   · Luces y sombras en tiempo real: la luz del cursor proyecta
     sombras que se mueven con el ratón.
   · Eventos: mousemove (cámara 3D, luz, viento, miradas, hover 3D
     por raycasting), mouseenter / mouseleave (textos y marca) y click.
   ========================================================= */

/* =========================================================
   0 · Constantes, utilidades y estado
   ========================================================= */
const W = 848;
const H = 1200;

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => [...document.querySelectorAll(sel)];
const rand = (a, b) => Math.random() * (b - a) + a;
const pick = (list) => list[Math.floor(Math.random() * list.length)];
const lerp = (a, b, t) => a + (b - a) * t;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const TAU = Math.PI * 2;

const ease = {
  linear: (p) => p,
  outCubic: (p) => 1 - Math.pow(1 - p, 3),
  inOutSine: (p) => -(Math.cos(Math.PI * p) - 1) / 2,
  outBack: (p) => { const c = 1.9; return 1 + (c + 1) * Math.pow(p - 1, 3) + c * Math.pow(p - 1, 2); },
};

const posterWrap = $('#posterWrap');
const poster     = $('#poster');
const canvas     = $('#scene3d');
const headline   = $('#headline');
const badge      = $('#badge');
const badgeRing  = $('#badgeRing');
const badgeCore  = $('#badgeCore');
const cta        = $('#cta');
const cursorEl   = $('#cursor');
const tooltip    = $('#tooltip');

const COLORS = { red: '#c0262f', gold: '#f2c35b', cream: '#fbf3e6', green: '#2c5e3f', ink: '#2e2219' };

const captureMode = new URLSearchParams(location.search).has('captura');

const mouse = { x: W / 2, y: H / 2, vx: 0, vy: 0, nx: 0, ny: 0, inside: false, moved: false };
const cursor = { x: W / 2, y: H / 2, scale: 1, targetScale: 1 };
const wind = { value: 0.3 };
const timers = {};
let scale = 1;

function later(name, fn, ms) {
  clearTimeout(timers[name]);
  timers[name] = setTimeout(fn, ms);
}
function every(name, fn, ms) {
  clearInterval(timers[name]);
  timers[name] = setInterval(fn, ms);
}
function stopEvery(name) {
  clearInterval(timers[name]);
}

/* =========================================================
   1 · TEXTURAS PROCEDURALES (canvas → THREE.CanvasTexture)
   ========================================================= */
let maxAniso = 4;

function hash(x, y, s) {
  const n = Math.sin(x * 127.1 + y * 311.7 + s * 13.37) * 43758.5453;
  return n - Math.floor(n);
}

// ruido de valor periódico (las texturas se repiten sin costuras)
function noiseT(x, y, s, px, py) {
  const xi = Math.floor(x), yi = Math.floor(y);
  const xf = x - xi, yf = y - yi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
  const x0 = ((xi % px) + px) % px, x1 = (x0 + 1) % px;
  const y0 = ((yi % py) + py) % py, y1 = (y0 + 1) % py;
  const a = hash(x0, y0, s), b = hash(x1, y0, s), c = hash(x0, y1, s), d = hash(x1, y1, s);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}

function fbmT(x, y, s, px, py, oct = 4) {
  let f = 0, amp = 0.5, norm = 0;
  for (let i = 0; i < oct; i++) {
    f += amp * noiseT(x, y, s + i * 7, px, py);
    norm += amp;
    x *= 2; y *= 2; px *= 2; py *= 2; amp *= 0.5;
  }
  return f / norm;
}

function finishTexture(cv, repeat, linear) {
  const t = new THREE.CanvasTexture(cv);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  if (repeat) t.repeat.set(repeat[0], repeat[1]);
  if (!linear) t.encoding = THREE.sRGBEncoding;
  t.anisotropy = maxAniso;
  return t;
}

function canvasTexture(w, h, draw, repeat, linear) {
  const cv = document.createElement('canvas');
  cv.width = w;
  cv.height = h;
  draw(cv.getContext('2d'), w, h);
  return finishTexture(cv, repeat, linear);
}

function pixelTexture(w, h, fn, repeat, linear) {
  return canvasTexture(w, h, (ctx) => {
    const img = ctx.createImageData(w, h);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const c = fn(x, y);
        const i = (y * w + x) * 4;
        img.data[i] = clamp(c[0], 0, 255);
        img.data[i + 1] = clamp(c[1], 0, 255);
        img.data[i + 2] = clamp(c[2], 0, 255);
        img.data[i + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
  }, repeat, linear);
}

// Madera en tablones con veta, juntas, nudos y desgaste
function woodTexture({ planks, vertical, base, weather, seed, size = 512 }) {
  const knots = Array.from({ length: 6 }, (_, i) => ({
    u: hash(i, 3, seed) * size, v: hash(i, 4, seed) * size, r: 5 + hash(i, 5, seed) * 7,
  }));
  const pw = size / planks;
  return pixelTexture(size, size, (x, y) => {
    const u = vertical ? x : y;
    const v = vertical ? y : x;
    const pi = Math.floor(u / pw);
    const lu = u - pi * pw;
    const tone = 0.8 + hash(pi, 1, seed) * 0.32;
    const g = fbmT((u / size) * planks * 3, (v / size) * 2, seed + pi, planks * 3, 2);
    const lines = Math.pow(0.5 + 0.5 * Math.sin((u / size) * 260 + g * 10 + hash(pi, 2, seed) * 6), 7);
    let k = tone * (0.74 + 0.36 * g) * (1 - lines * 0.28);
    for (const kn of knots) {
      const dx = (u - kn.u) * 1.4, dy = (v - kn.v) * 0.55;
      const d = Math.sqrt(dx * dx + dy * dy);
      if (d < kn.r * 2.2) k *= 0.55 + 0.45 * Math.min(1, Math.abs(Math.sin(d * 0.9)) + d / (kn.r * 2.2));
    }
    if (lu < 2.5 || lu > pw - 1.5) k *= 0.35;
    const wv = fbmT((u / size) * 4, (v / size) * 4, seed + 50, 4, 4);
    const gray = (base[0] + base[1] + base[2]) / 3;
    const wm = weather * wv;
    return [
      (base[0] * (1 - wm) + gray * 1.05 * wm) * k,
      (base[1] * (1 - wm) + gray * 1.05 * wm) * k,
      (base[2] * (1 - wm) + gray * 1.1 * wm) * k,
    ];
  });
}

function snowTexture() {
  return pixelTexture(512, 512, (x, y) => {
    const n = fbmT((x / 512) * 8, (y / 512) * 8, 21, 8, 8, 5);
    const k = (1 - n) * 0.5;
    if (hash(x, y, 99) > 0.996) return [255, 255, 255];
    return [248 - 52 * k, 249 - 40 * k, 253 - 22 * k];
  });
}

function clayTexture() {
  return pixelTexture(256, 256, (x, y) => {
    const n = fbmT((x / 256) * 6, (y / 256) * 6, 31, 6, 6);
    const sp = hash(x, y, 7) > 0.985 ? 0.75 : 1;
    const k = (0.78 + 0.34 * n) * sp;
    return [190 * k, 100 * k, 62 * k];
  });
}

function burlapTexture() {
  return pixelTexture(256, 256, (x, y) => {
    const cell = 8;
    const horiz = (Math.floor(x / cell) + Math.floor(y / cell)) % 2 === 0;
    const t = ((horiz ? y : x) % cell) / cell;
    const shade = 0.7 + 0.3 * Math.sin(t * Math.PI);
    const n = 0.85 + 0.3 * fbmT((x / 256) * 16, (y / 256) * 16, 41, 16, 16, 3);
    const k = shade * n;
    return [196 * k, 166 * k, 116 * k];
  });
}

function shinglesTexture() {
  return canvasTexture(512, 512, (ctx, w, h) => {
    ctx.fillStyle = '#2f241c';
    ctx.fillRect(0, 0, w, h);
    const rowH = 32, sw = 48;
    for (let r = 0; r < h / rowH; r++) {
      const off = (r % 2) * (sw / 2);
      for (let c = -1; c < w / sw + 1; c++) {
        const x = c * sw + off;
        const y = r * rowH;
        const t = 40 + Math.floor(Math.random() * 30);
        ctx.fillStyle = `rgb(${t + 26},${t + 14},${t + 4})`;
        ctx.fillRect(x + 1, y, sw - 2, rowH - 2);
        ctx.fillStyle = 'rgba(0,0,0,.45)';
        ctx.fillRect(x + 1, y + rowH - 6, sw - 2, 4);
        ctx.fillStyle = 'rgba(255,255,255,.07)';
        ctx.fillRect(x + 1, y, sw - 2, 3);
      }
    }
  });
}

function strokesTexture(base, palette, count, len, angle, spread, size = 256, width = 1.6) {
  return canvasTexture(size, size, (ctx, w, h) => {
    ctx.fillStyle = base;
    ctx.fillRect(0, 0, w, h);
    ctx.lineCap = 'round';
    for (let i = 0; i < count; i++) {
      const x = Math.random() * w, y = Math.random() * h;
      const a = angle + rand(-spread, spread);
      const l = rand(len * 0.5, len);
      ctx.strokeStyle = pick(palette);
      ctx.globalAlpha = rand(0.35, 0.9);
      ctx.lineWidth = rand(width * 0.6, width * 1.3);
      for (const ox of [-w, 0, w]) {
        for (const oy of [-h, 0, h]) {
          ctx.beginPath();
          ctx.moveTo(x + ox, y + oy);
          ctx.lineTo(x + ox + Math.cos(a) * l, y + oy + Math.sin(a) * l);
          ctx.stroke();
        }
      }
    }
    ctx.globalAlpha = 1;
  });
}

// Luna llena: disco con oscurecimiento en el borde, mares, cráteres con borde claro y rayos
function moonTexture() {
  const S = 512, C = S / 2, Rr = S * 0.47;
  const craters = Array.from({ length: 40 }, (_, i) => {
    const a = hash(i, 1, 3) * TAU, d = Math.sqrt(hash(i, 2, 3)) * 0.92;
    return { x: C + Math.cos(a) * d * Rr, y: C + Math.sin(a) * d * Rr, r: 3 + Math.pow(hash(i, 3, 3), 3) * 18 };
  });
  const rays = { x: C - Rr * 0.18, y: C + Rr * 0.58 };   // cráter brillante con rayos (abajo)
  const t = canvasTexture(S, S, (ctx) => {
    const img = ctx.createImageData(S, S);
    for (let y = 0; y < S; y++) {
      for (let x = 0; x < S; x++) {
        const dx = (x - C) / Rr, dy = (y - C) / Rr;
        const r2 = dx * dx + dy * dy;
        const i = (y * S + x) * 4;
        if (r2 > 1.0) {
          img.data[i + 3] = 0;
          continue;
        }
        const mu = Math.sqrt(1 - r2);                     // "altura" de la esfera
        let k = 0.62 + 0.42 * Math.pow(mu, 0.3);        // oscurece suavemente hacia el borde
        // mares (zonas oscuras grandes)
        const m = fbmT(x / S * 3.2 + 4, y / S * 3.2 + 9, 41, 1000, 1000, 5);
        const maria = clamp((m - 0.5) * 4.5, 0, 1);
        k *= 1 - maria * 0.32;
        // textura fina del suelo lunar
        k *= 0.93 + fbmT(x / S * 24, y / S * 24, 77, 1000, 1000, 3) * 0.12;
        // cráteres: fondo algo oscuro y borde iluminado
        for (const c of craters) {
          const d = Math.hypot(x - c.x, y - c.y) / c.r;
          if (d < 1.25) {
            if (d < 0.85) k *= 0.95 + d * 0.03;
            else if (d < 1.05) k *= 1 + (1 - Math.abs(d - 0.95) * 10) * 0.05;
            else k *= 1 - (1.25 - d) * 0.06;
          }
        }
        // rayos claros del cráter brillante
        const rx = x - rays.x, ry = y - rays.y;
        const rd = Math.hypot(rx, ry) / Rr;
        const ra = Math.atan2(ry, rx);
        const streak = Math.pow(0.5 + 0.5 * Math.sin(ra * 13 + Math.sin(ra * 5) * 2), 6);
        k += streak * Math.max(0, 0.6 - rd) * 0.08 + Math.max(0, 0.04 - rd) * 2.5;
        // borde suave con antialias
        const edge = clamp((1 - Math.sqrt(r2)) * Rr / 1.5, 0, 1);
        img.data[i]     = clamp(255 * k, 0, 255);
        img.data[i + 1] = clamp(249 * k, 0, 255);
        img.data[i + 2] = clamp(232 * k, 0, 255);
        img.data[i + 3] = 255 * edge;
      }
    }
    ctx.putImageData(img, 0, 0);
  });
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  return t;
}

// Pelaje suave: manchas amplias y pelusa fina en todas direcciones (sin rayas ni "esponja")
function furTexture(base, light, seed) {
  const S = 256;
  return pixelTexture(S, S, (x, y) => {
    const big = fbmT((x / S) * 4, (y / S) * 4, seed, 4, 4, 3);              // zonas más claras/oscuras
    const fuzz = fbmT((x / S) * 64, (y / S) * 48, seed + 5, 64, 48, 2);     // pelusa fina
    const t = clamp(0.2 + big * 0.6 + (fuzz - 0.5) * 0.25, 0, 1);
    const shade = 0.94 + (fuzz - 0.5) * 0.1;
    return [
      (base[0] + (light[0] - base[0]) * t) * shade,
      (base[1] + (light[1] - base[1]) * t) * shade,
      (base[2] + (light[2] - base[2]) * t) * shade,
    ];
  });
}

// Agujas de pino en gris claro (se tiñen con los colores de vértice)
function needleDetailTexture() {
  const t = strokesTexture('#d8d8d8', ['#ffffff', '#a8a8a8', '#c4c4c4', '#8c8c8c'], 3200, 12, Math.PI / 2, 0.9);
  t.repeat.set(5, 3);
  return t;
}

function metalTexture() {
  return canvasTexture(256, 256, (ctx, w, h) => {
    ctx.fillStyle = '#b4bdc4';
    ctx.fillRect(0, 0, w, h);
    for (let i = 0; i < 26; i++) {
      ctx.fillStyle = `rgba(${pick(['255,255,255', '60,70,80'])},${rand(0.05, 0.16)})`;
      ctx.beginPath();
      const cx = Math.random() * w, cy = Math.random() * h;
      for (let k = 0; k < 6; k++) {
        const a = (k / 6) * TAU, r = rand(14, 34);
        ctx.lineTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
      }
      ctx.fill();
    }
    for (let y = 0; y < h; y += 2) {
      ctx.fillStyle = `rgba(0,0,0,${rand(0, 0.05)})`;
      ctx.fillRect(0, y, w, 1);
    }
  });
}

function paperTexture(kind) {
  return canvasTexture(256, 256, (ctx, w, h) => {
    if (kind === 'stripes') {
      ctx.fillStyle = '#f7efe3'; ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = '#c0262f';
      ctx.save(); ctx.translate(w / 2, h / 2); ctx.rotate(Math.PI / 4);
      for (let i = -12; i < 12; i++) ctx.fillRect(i * 32, -400, 16, 800);
      ctx.restore();
    } else if (kind === 'dots') {
      ctx.fillStyle = '#e3a92c'; ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = '#b81f2a';
      for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) {
        ctx.beginPath(); ctx.arc(x * 32 + (y % 2) * 16 + 8, y * 32 + 16, 6, 0, TAU); ctx.fill();
      }
    } else if (kind === 'plaid') {
      ctx.fillStyle = '#1f6a42'; ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = 'rgba(192,38,47,.75)';
      for (let i = 0; i < 4; i++) { ctx.fillRect(i * 64 + 20, 0, 18, h); ctx.fillRect(0, i * 64 + 20, w, 18); }
      ctx.fillStyle = 'rgba(242,195,91,.8)';
      for (let i = 0; i < 4; i++) { ctx.fillRect(i * 64 + 50, 0, 3, h); ctx.fillRect(0, i * 64 + 50, w, 3); }
    } else if (kind === 'stars') {
      ctx.fillStyle = '#2f5aa8'; ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = '#f7efe3';
      for (let i = 0; i < 40; i++) {
        const x = (i * 53) % w, y = (i * 97) % h, r = 7;
        ctx.beginPath();
        for (let k = 0; k < 10; k++) {
          const a = (k / 10) * TAU - Math.PI / 2, rr = k % 2 ? r * 0.45 : r;
          ctx.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
        }
        ctx.fill();
      }
    } else {
      ctx.fillStyle = '#c0262f'; ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = '#2f7048';
      for (let i = 0; i < 8; i++) ctx.fillRect(i * 32, 0, 14, h);
    }
    // ligera textura de papel
    for (let i = 0; i < 900; i++) {
      ctx.fillStyle = `rgba(0,0,0,${rand(0, 0.06)})`;
      ctx.fillRect(Math.random() * w, Math.random() * h, 2, 2);
    }
  });
}

function spriteTexture(draw, size = 128) {
  const t = canvasTexture(size, size, (ctx, w, h) => draw(ctx, w, h));
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  return t;
}

function radial(ctx, w, stops) {
  const g = ctx.createRadialGradient(w / 2, w / 2, 0, w / 2, w / 2, w / 2);
  stops.forEach(([o, c]) => g.addColorStop(o, c));
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, w);
}

const TEX = {};
function makeTextures() {
  TEX.planks = woodTexture({ planks: 6, vertical: true, base: [150, 124, 98], weather: 0.55, seed: 3 });
  TEX.planks.repeat.set(2, 1.2);
  TEX.bench = woodTexture({ planks: 4, vertical: false, base: [178, 138, 94], weather: 0.15, seed: 9 });
  TEX.post = woodTexture({ planks: 2, vertical: true, base: [110, 84, 60], weather: 0.3, seed: 5, size: 256 });
  TEX.shingles = shinglesTexture();
  TEX.snow = snowTexture();
  TEX.clay = clayTexture();
  TEX.burlap = burlapTexture();
  TEX.metal = metalTexture();
  TEX.needles = strokesTexture('#1d5134', ['#2f7a4c', '#163f28', '#3d8d5c', '#123222'], 2600, 14, Math.PI / 2, 0.7);
  // detalle de agujas en gris claro: el color real lo ponen los colores de vértice del pino
  TEX.needleDetail = needleDetailTexture();
  TEX.bark = strokesTexture('#4a3426', ['#2e1f16', '#6b4c38', '#3a281d'], 700, 40, Math.PI / 2, 0.15, 256, 3);
  TEX.fur = {
    deer: furTexture([138, 86, 46], [190, 132, 82], 11),
    fox: furTexture([196, 88, 32], [232, 138, 74], 12),
    rabbit: furTexture([132, 112, 94], [190, 172, 152], 13),
    squirrel: furTexture([143, 136, 130], [196, 190, 184], 14),
    cream: furTexture([236, 228, 214], [255, 252, 246], 15),
    bear: furTexture([138, 86, 48], [180, 126, 80], 16),
    gray: furTexture([141, 138, 144], [184, 181, 188], 17),
  };
  TEX.papers = ['stripes', 'dots', 'plaid', 'stars', 'candy'].map(paperTexture);

  TEX.glow = spriteTexture((ctx, w) => radial(ctx, w, [[0, 'rgba(255,255,255,1)'], [0.25, 'rgba(255,255,255,.55)'], [1, 'rgba(255,255,255,0)']]));
  TEX.flake = spriteTexture((ctx, w) => radial(ctx, w, [[0, 'rgba(255,255,255,1)'], [0.45, 'rgba(255,255,255,.8)'], [1, 'rgba(255,255,255,0)']]), 64);
  TEX.smoke = spriteTexture((ctx, w) => {
    radial(ctx, w, [[0, 'rgba(230,224,236,.9)'], [0.6, 'rgba(210,204,220,.35)'], [1, 'rgba(200,194,210,0)']]);
  });
  TEX.star4 = spriteTexture((ctx, w) => {
    const c = w / 2, s = w * 0.48;
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.moveTo(c, c - s);
    ctx.quadraticCurveTo(c + s * 0.12, c - s * 0.12, c + s, c);
    ctx.quadraticCurveTo(c + s * 0.12, c + s * 0.12, c, c + s);
    ctx.quadraticCurveTo(c - s * 0.12, c + s * 0.12, c - s, c);
    ctx.quadraticCurveTo(c - s * 0.12, c - s * 0.12, c, c - s);
    ctx.fill();
  });
  TEX.heart = spriteTexture((ctx, w) => {
    const s = w * 0.36, c = w / 2;
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.moveTo(c, c + s * 0.9);
    ctx.bezierCurveTo(c - s * 1.4, c - s * 0.2, c - s * 0.6, c - s * 1.2, c, c - s * 0.4);
    ctx.bezierCurveTo(c + s * 0.6, c - s * 1.2, c + s * 1.4, c - s * 0.2, c, c + s * 0.9);
    ctx.fill();
  });
  TEX.note = spriteTexture((ctx, w) => {
    ctx.fillStyle = '#fff';
    ctx.font = `700 ${w * 0.8}px Georgia, serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('♪', w / 2, w / 2);
  });

  TEX.sky = canvasTexture(4, 512, (ctx, w, h) => {
    const g = ctx.createLinearGradient(0, 0, 0, h);
    [[0, '#0e1630'], [0.22, '#222f5a'], [0.4, '#545a8c'], [0.5, '#a5809a'], [0.57, '#e2ab95'], [0.64, '#f2c9a8'], [1, '#f6dcc0']]
      .forEach(([o, c]) => g.addColorStop(o, c));
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
  });
  TEX.sky.wrapS = TEX.sky.wrapT = THREE.ClampToEdgeWrapping;
}

// Etiqueta de texto (cartel del saco, del saquito de semillas…)
function labelTexture(lines, opts = {}) {
  return canvasTexture(opts.w || 256, opts.h || 128, (ctx, w, h) => {
    if (opts.bg) { ctx.fillStyle = opts.bg; ctx.fillRect(0, 0, w, h); }
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    lines.forEach((l, i) => {
      ctx.font = l.font;
      ctx.fillStyle = l.color;
      ctx.fillText(l.text, w / 2, h * l.y);
    });
  });
}

// Texto flotante para las reacciones ("¡pío!", "¡clin!"…)
const textCache = new Map();
function textSpriteTexture(text, color) {
  const key = text + color;
  if (textCache.has(key)) return textCache.get(key);
  const t = canvasTexture(512, 128, (ctx, w, h) => {
    ctx.font = 'italic 800 64px Fraunces, Georgia, serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineWidth = 12;
    ctx.strokeStyle = 'rgba(20,14,30,.7)';
    ctx.strokeText(text, w / 2, h / 2);
    ctx.fillStyle = color;
    ctx.fillText(text, w / 2, h / 2);
  });
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  textCache.set(key, t);
  return t;
}

/* =========================================================
   2 · RENDERER, ESCENA, CÁMARA Y LUCES
   ========================================================= */
let renderer, scene, camera;
const CAM_BASE = new THREE.Vector3(0, 2.7, 14);
const CAM_TARGET = new THREE.Vector3(0.2, 2.2, 0);
const camState = { intro: 0, offX: 0, offY: 0 };
const lights = {};

function setupRenderer() {
  renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: captureMode });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
  renderer.setSize(W, H, false);
  renderer.outputEncoding = THREE.sRGBEncoding;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  maxAniso = renderer.capabilities.getMaxAnisotropy();

  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(38, W / H, 0.1, 200);
  camera.position.copy(CAM_BASE);
  camera.lookAt(CAM_TARGET);
}

function setupLights() {
  scene.background = TEX.sky;
  scene.fog = new THREE.Fog(0xc9a0a4, 13, 44);

  lights.hemi = new THREE.HemisphereLight(0x8a98d0, 0xf0ddd2, 0.62);
  scene.add(lights.hemi);

  // luz cálida del atardecer: proyecta las sombras principales
  const key = new THREE.DirectionalLight(0xffd2ac, 1.05);
  key.position.set(-7, 9, 7);
  key.target.position.set(1, 0, -1);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  Object.assign(key.shadow.camera, { left: -9, right: 9, top: 9, bottom: -9, near: 1, far: 32 });
  key.shadow.bias = -0.0006;
  key.shadow.normalBias = 0.02;
  scene.add(key, key.target);
  lights.key = key;

  // luz fría de la luna (contraluz)
  const moon = new THREE.DirectionalLight(0x9fb4ff, 0.45);
  moon.position.set(4, 10, -12);
  scene.add(moon);

  // luz del cursor: una linterna cálida que proyecta sombras
  const cur = new THREE.PointLight(0xffd9a8, 0, 7, 2);
  cur.castShadow = true;
  cur.shadow.mapSize.set(512, 512);
  cur.shadow.bias = -0.003;
  cur.position.set(0, 3, 4);
  scene.add(cur);
  lights.cursor = cur;
  lights.cursorTarget = new THREE.Vector3(0, 3, 4);
}

/* =========================================================
   3 · AYUDAS DE GEOMETRÍA Y MATERIALES
   ========================================================= */
const GEO = {};
function makeGeometries() {
  GEO.sphere = new THREE.SphereGeometry(1, 28, 20);
  GEO.sphereLo = new THREE.SphereGeometry(1, 12, 8);
  GEO.box = new THREE.BoxGeometry(1, 1, 1);
  GEO.cyl = new THREE.CylinderGeometry(1, 1, 1, 18);
  GEO.cone = new THREE.ConeGeometry(1, 1, 24);
  GEO.plane = new THREE.PlaneGeometry(1, 1);
}

const MAT = {};
function std(opts) {
  return new THREE.MeshStandardMaterial({ roughness: 0.8, metalness: 0, ...opts });
}
function makeMaterials() {
  MAT.wall = std({ map: TEX.planks, bumpMap: TEX.planks, bumpScale: 0.035, roughness: 0.92 });
  MAT.post = std({ map: TEX.post, bumpMap: TEX.post, bumpScale: 0.02, roughness: 0.9 });
  MAT.bench = std({ map: TEX.bench, bumpMap: TEX.bench, bumpScale: 0.02, roughness: 0.75 });
  MAT.roof = std({ map: TEX.shingles, bumpMap: TEX.shingles, bumpScale: 0.05, roughness: 0.95 });
  MAT.snow = std({ map: TEX.snow, bumpMap: TEX.snow, bumpScale: 0.04, roughness: 0.85, color: 0xffffff });
  MAT.ice = std({ color: 0xdff1ff, roughness: 0.05, metalness: 0.1, transparent: true, opacity: 0.82, emissive: 0x6f9fd8, emissiveIntensity: 0.18 });
  MAT.clay = std({ map: TEX.clay, bumpMap: TEX.clay, bumpScale: 0.02, roughness: 0.95 });
  MAT.metal = std({ map: TEX.metal, roughness: 0.42, metalness: 0.35 });
  MAT.darkMetal = std({ color: 0x2c2c32, roughness: 0.5, metalness: 0.7 });
  MAT.burlap = std({ map: TEX.burlap, bumpMap: TEX.burlap, bumpScale: 0.03, roughness: 1 });
  MAT.needles = std({ map: TEX.needles, bumpMap: TEX.needles, bumpScale: 0.05, roughness: 0.9 });
  MAT.pine = std({ map: TEX.needleDetail, vertexColors: true, roughness: 0.95 });
  MAT.xmasPine = std({ map: TEX.needleDetail, bumpMap: TEX.needleDetail, bumpScale: 0.03, vertexColors: true, roughness: 0.85 });
  MAT.bark = std({ map: TEX.bark, bumpMap: TEX.bark, bumpScale: 0.04, roughness: 1 });
  MAT.cream = std({ color: 0xece2cf, roughness: 0.7 });
  MAT.black = std({ color: 0x141010, roughness: 0.3 });
  MAT.eyeShine = new THREE.MeshBasicMaterial({ color: 0xffffff });
  MAT.red = std({ color: 0xc0262f, roughness: 0.5 });
  MAT.redGloss = std({ color: 0xc0262f, roughness: 0.2, metalness: 0.4 });
  MAT.gold = std({ color: 0xe8b23a, roughness: 0.25, metalness: 0.8 });
  MAT.green = std({ color: 0x2f7048, roughness: 0.6 });
  MAT.leaf = std({ color: 0x2a7a45, roughness: 0.4, side: THREE.DoubleSide });
  MAT.straw = std({ color: 0xa8915f, roughness: 1 });
  MAT.pink = std({ color: 0xe6a2a0, roughness: 0.6 });
  MAT.orange = std({ color: 0xe08a2a, roughness: 0.5 });
  MAT.fur = Object.fromEntries(Object.entries(TEX.fur).map(([k, t]) => [k, std({ map: t, bumpMap: t, bumpScale: 0.004, roughness: 0.95 })]));
  MAT.papers = TEX.papers.map((t) => std({ map: t, roughness: 0.55 }));
}

// Crea una malla con posición/rotación/escala en una sola llamada
function mesh(geo, mat, parent, o = {}) {
  const m = new THREE.Mesh(geo, mat);
  m.castShadow = o.cast !== false;
  m.receiveShadow = o.receive !== false;
  if (o.p) m.position.set(o.p[0], o.p[1], o.p[2]);
  if (o.r) m.rotation.set(o.r[0], o.r[1], o.r[2]);
  if (o.s !== undefined) {
    if (Array.isArray(o.s)) m.scale.set(o.s[0], o.s[1], o.s[2]);
    else m.scale.setScalar(o.s);
  }
  if (parent) parent.add(m);
  return m;
}

function group(parent, p, r) {
  const g = new THREE.Group();
  if (p) g.position.set(p[0], p[1], p[2]);
  if (r) g.rotation.set(r[0], r[1], r[2]);
  if (parent) parent.add(g);
  return g;
}

function glowSprite(parent, color, size, p, opacity = 0.9) {
  const s = new THREE.Sprite(new THREE.SpriteMaterial({
    map: TEX.glow, color, transparent: true, opacity, depthWrite: false, blending: THREE.AdditiveBlending, fog: false,
  }));
  s.scale.setScalar(size);
  if (p) s.position.set(p[0], p[1], p[2]);
  s.userData.noRay = true;
  parent.add(s);
  return s;
}

function makeEye(parent, p, r = 0.022) {
  const eye = group(parent, p);
  mesh(GEO.sphereLo, MAT.black, eye, { s: r, cast: false });
  mesh(GEO.sphereLo, MAT.eyeShine, eye, { p: [r * 0.45, r * 0.4, r * 0.35], s: r * 0.3, cast: false });
  return eye;
}

// Registro de objetos interactivos 3D
const reactRoots = [];
function makeReact(obj, name, label) {
  obj.userData.react = name;
  obj.userData.label = label;
  reactRoots.push(obj);
  return obj;
}

const R = {};            // referencias a todo lo que se anima
const heads = [];        // cabezas que siguen al cursor
const blinkers = [];     // grupos de ojos que parpadean
const breathers = [];    // cuerpos que respiran

/* =========================================================
   4 · CONSTRUCCIÓN DE LA ESCENA
   ========================================================= */

// ---------- Suelo nevado con relieve ----------
function buildGround() {
  const geo = new THREE.PlaneGeometry(90, 90, 160, 160);
  geo.rotateX(-Math.PI / 2);
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), z = pos.getZ(i);
    const n = fbmT(x * 0.18 + 50, z * 0.18 + 50, 77, 64, 64, 4);
    const far = clamp((Math.hypot(x, z) - 4) / 8, 0, 1);
    pos.setY(i, (n - 0.5) * (0.12 + far * 0.7) - 0.03);
  }
  geo.computeVertexNormals();
  const tex = TEX.snow.clone();
  tex.needsUpdate = true;
  tex.repeat.set(30, 30);
  const mat = std({ map: tex, bumpMap: tex, bumpScale: 0.05, roughness: 0.88 });
  const ground = mesh(geo, mat, scene, { cast: false });
  R.ground = ground;

  // montículos de nieve alrededor de las cosas
  [[-2.15, 1.0, 0.75], [2.4, 2.3, 0.6], [1.2, -0.9, 1.3], [-4.5, -2, 1.4], [5.5, -3.5, 1.8]].forEach(([x, z, r]) => {
    mesh(GEO.sphere, MAT.snow, scene, { p: [x, -r * 0.82, z], s: [r * 1.4, r, r * 1.2], cast: false });
  });
}

// ---------- Cielo: estrellas, luna y bandada ----------
function buildSky() {
  const starGeo = new THREE.BufferGeometry();
  const pts = [];
  for (let i = 0; i < 700; i++) {
    const a = rand(-Math.PI * 0.85, -Math.PI * 0.15);
    const e = rand(0.12, 0.9);
    const r = 90;
    pts.push(Math.cos(a) * Math.cos(e) * r, Math.sin(e) * r, Math.sin(a) * Math.cos(e) * r);
  }
  starGeo.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
  R.stars = [0.9, 1.6].map((size, i) => {
    const geo = i === 0 ? starGeo : starGeo.clone();
    if (i === 1) geo.setDrawRange(0, 160);
    const p = new THREE.Points(geo, new THREE.PointsMaterial({
      size: size * 2.2, sizeAttenuation: false, map: TEX.flake, transparent: true, depthWrite: false, fog: false, color: 0xfff6e8,
    }));
    p.userData.noRay = true;
    scene.add(p);
    return p;
  });

  // Luna
  const moon = makeReact(group(scene, [8.6, 9.2, -32]), 'moon', 'La luna');
  // halo amplio y suave detrás del disco
  R.moonGlow = glowSprite(moon, 0xdfe6ff, 9, [0, 0, -0.6], 0.42);
  glowSprite(moon, 0xfff4dc, 4.2, [0, 0, -0.4], 0.5);
  // disco lunar pintado con mares, cráteres y rayos (siempre mirando a la cámara)
  const disc = new THREE.Sprite(new THREE.SpriteMaterial({ map: moonTexture(), transparent: true, fog: false, depthWrite: false, toneMapped: false }));
  disc.scale.setScalar(2.9);
  disc.userData.noRay = true;
  moon.add(disc);
  // esfera invisible: solo para que el ratón "toque" la luna
  mesh(GEO.sphereLo, new THREE.MeshBasicMaterial({ visible: false }), moon, { s: 1.35, cast: false, receive: false });
  R.moon = moon;

  // bandada (aparece de vez en cuando)
  R.flock = group(scene, [0, 0, -26]);
  R.flock.visible = false;
  R.flockBirds = [];
  const wingMat = new THREE.MeshBasicMaterial({ color: 0x1b1a2e, side: THREE.DoubleSide, fog: false });
  for (let i = 0; i < 5; i++) {
    const b = group(R.flock, [-Math.abs(i - 2) * 1.1, Math.abs(i - 2) * 0.55, rand(-0.5, 0.5)]);
    const l = mesh(GEO.plane, wingMat, b, { p: [-0.25, 0, 0], s: [0.5, 0.12, 1], cast: false });
    const r = mesh(GEO.plane, wingMat, b, { p: [0.25, 0, 0], s: [0.5, 0.12, 1], cast: false });
    R.flockBirds.push({ l, r, phase: rand(0, TAU) });
  }
}

// ---------- Piso de ramas (cono con puntas caídas, agujas y nieve) ----------
// Cono unitario (radio 1, alto 1, centrado) con el borde en picos que cuelgan,
// y colores de vértice: verde oscuro dentro/abajo, más claro en las puntas y
// manchas de nieve en la parte de arriba de las ramas.
function branchTierGeometry(seed, o = {}) {
  const branches = o.branches || 9;
  const snowAmount = o.snow ?? 0.55;
  const dark = new THREE.Color(o.dark || 0x123a2a);
  const light = new THREE.Color(o.light || 0x2f6a4c);
  const snowC = new THREE.Color(0xf2f5fb);
  const geo = new THREE.ConeGeometry(1, 1, branches * 6, 6, false);
  const pos = geo.attributes.position;
  const colors = [];
  const c = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    const rr = Math.hypot(x, z);
    const a = Math.atan2(z, x);
    const t = y + 0.5;                       // 0 = borde inferior, 1 = punta
    // picos de rama en el borde: la punta sale y cae
    const tip = Math.pow(0.5 + 0.5 * Math.cos(a * branches + seed), 3);
    const edge = Math.pow(1 - t, 2.5);       // solo afecta cerca del borde
    const n = noiseT(a * 3 + seed, t * 4, seed, 1000, 1000);
    const k = 1 + edge * (tip * 0.22 - 0.06) + (n - 0.5) * 0.08 * (1 - t);
    if (rr > 1e-4) { pos.setX(i, x * k); pos.setZ(i, z * k); }
    pos.setY(i, y - edge * tip * 0.1);
    // color: degradado por altura y por pico de rama
    const shade = clamp(0.35 + t * 0.25 + tip * edge * 0.45 + (n - 0.5) * 0.3, 0, 1);
    c.copy(dark).lerp(light, shade);
    // nieve: en la parte de arriba de cada piso y sobre las puntas de rama
    const sn = noiseT(a * 5 + seed * 3, t * 6, seed + 11, 1000, 1000);
    const snowy = (t > 0.55 ? (t - 0.55) * 1.6 : 0) + tip * edge * 0.55 + (sn - 0.5) * 0.9;
    if (rr > 1e-4 && snowy > 1 - snowAmount) c.lerp(snowC, clamp((snowy - (1 - snowAmount)) * 3, 0, 0.95));
    c.convertSRGBToLinear();               // el renderer trabaja en lineal → colores fieles, no lavados
    colors.push(c.r, c.g, c.b);
  }
  geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geo.computeVertexNormals();
  return geo;
}

// ---------- Pinos del bosque ----------
const pineTierGeos = [];
function makePine(parent, h, interactive) {
  if (!pineTierGeos.length) for (let i = 0; i < 4; i++) pineTierGeos.push(branchTierGeometry(i * 1.7 + 0.4, { snow: 0.45 + i * 0.08 }));
  const root = group(parent);
  const sway = group(root);
  const inner = group(sway);
  mesh(GEO.cyl, MAT.bark, inner, { p: [0, h * 0.08, 0], s: [h * 0.035, h * 0.16, h * 0.035] });
  const tiers = 5;
  for (let i = 0; i < tiers; i++) {
    const t = i / tiers;
    const r = h * (0.33 - t * 0.21);
    const th = h * 0.32;
    const y = h * 0.1 + t * h * 0.66;
    mesh(pickTier(i), MAT.pine, inner, { p: [0, y + th / 2, 0], r: [0, rand(0, TAU), 0], s: [r, th, r] });
  }
  return { root, sway, inner, h, phase: rand(0, TAU), interactive };
}
const pickTier = (i) => pineTierGeos[(i + Math.floor(Math.random() * 4)) % pineTierGeos.length];

function buildForest() {
  R.pines = [];
  const spots = [
    [-4.8, -7.2, 4.2, true], [-3.1, -8.6, 3.4, true], [-6.6, -9.4, 4.8, true], [-1.6, -10.5, 3.8, true],
    [-8.5, -12, 5.2], [0.8, -13, 4.4], [3.4, -12.2, 5], [5.8, -10.8, 4.6], [7.8, -14, 5.6],
    [-10.5, -15.5, 6], [-5.5, -16, 5.4], [2.4, -17, 6], [9.5, -9, 4.4], [-12, -9, 5],
  ];
  spots.forEach(([x, z, h, interactive]) => {
    const pine = makePine(scene, h, interactive);
    pine.root.position.set(x, 0, z);
    pine.root.rotation.y = rand(0, TAU);
    if (interactive) makeReact(pine.root, 'pine', 'Un pino nevado');
    pine.root.userData.pine = pine;
    R.pines.push(pine);
  });
}

// ---------- Animales (modelados con primitivas + pelaje) ----------
function legPair(parent, mat, list, len, radius, hoofMat) {
  return list.map(([x, y, z]) => {
    const leg = group(parent, [x, y, z]);
    mesh(GEO.cyl, mat, leg, { p: [0, -len / 2, 0], s: [radius, len, radius] });
    mesh(GEO.sphereLo, mat, leg, { s: [radius * 1.6, radius * 2.2, radius * 1.6] });
    if (hoofMat) mesh(GEO.cyl, hoofMat, leg, { p: [0, -len + 0.025, 0], s: [radius * 1.05, 0.05, radius * 1.05] });
    return leg;
  });
}

function buildDeer() {
  const deer = group(scene, [-1.3, 0, -5.4], [0, -Math.PI / 2 + 0.5, 0]);
  const body = group(deer);
  const fur = MAT.fur.deer;
  mesh(GEO.sphere, fur, body, { p: [0, 0.95, 0], s: [0.56, 0.3, 0.27] });
  mesh(GEO.sphere, MAT.fur.cream, body, { p: [0.04, 0.84, 0], s: [0.44, 0.17, 0.2] });
  mesh(GEO.sphere, MAT.fur.cream, body, { p: [-0.52, 1.0, 0], s: [0.08, 0.13, 0.17] });
  const tail = group(body, [-0.56, 1.08, 0]);
  mesh(GEO.sphere, MAT.fur.cream, tail, { p: [-0.03, -0.05, 0], s: [0.05, 0.1, 0.05] });
  const legs = legPair(body, fur, [[0.36, 0.82, 0.12], [0.36, 0.82, -0.12], [-0.36, 0.84, 0.12], [-0.36, 0.84, -0.12]], 0.8, 0.045, MAT.black);
  const neck = group(body, [0.42, 1.05, 0]);
  mesh(GEO.cyl, fur, neck, { p: [0.1, 0.22, 0], r: [0, 0, -0.45], s: [0.09, 0.5, 0.1] });
  const head = group(neck, [0.22, 0.47, 0]);
  mesh(GEO.sphere, fur, head, { p: [0.04, 0, 0], s: [0.17, 0.12, 0.11] });
  mesh(GEO.sphere, MAT.fur.deer, head, { p: [0.19, -0.04, 0], s: [0.1, 0.07, 0.07] });
  mesh(GEO.sphereLo, MAT.black, head, { p: [0.28, -0.03, 0], s: 0.03 });
  mesh(GEO.sphere, MAT.fur.cream, head, { p: [0.08, -0.1, 0], s: [0.08, 0.04, 0.07] });
  const ears = [1, -1].map((side) => {
    const ear = group(head, [-0.04, 0.1, side * 0.08], [side * 0.6, 0, 0.3]);
    mesh(GEO.sphere, fur, ear, { p: [0, 0.08, 0], s: [0.035, 0.1, 0.06] });
    mesh(GEO.sphere, MAT.pink, ear, { p: [0.01, 0.08, side * 0.012], s: [0.02, 0.07, 0.04] });
    return ear;
  });
  const eyes = [1, -1].map((side) => makeEye(head, [0.12, 0.04, side * 0.085], 0.024));
  R.deer = { root: deer, body, legs, neck, head, ears, tail, eyes, x: -1.3, dir: 0, mode: 'idle', target: -1.3, paused: false, walkT: 0 };
  makeReact(deer, 'deer', 'Un ciervo');
  heads.push({ obj: head, weight: 0.8, max: 1.0 });
  blinkers.push(eyes);
  breathers.push({ obj: body, amp: 0.012, speed: 1.6 });
}

function buildFox() {
  const fox = group(scene, [9, 0, -4.4], [0, Math.PI, 0]);
  const body = group(fox);
  const fur = MAT.fur.fox;
  mesh(GEO.sphere, fur, body, { p: [0, 0.44, 0], s: [0.36, 0.15, 0.14] });
  mesh(GEO.sphere, MAT.fur.cream, body, { p: [0.26, 0.42, 0], s: [0.14, 0.12, 0.11] });
  const legs = legPair(body, MAT.black, [[0.22, 0.36, 0.07], [0.22, 0.36, -0.07], [-0.22, 0.38, 0.07], [-0.22, 0.38, -0.07]], 0.36, 0.026);
  const tail = group(body, [-0.34, 0.48, 0], [0, 0, 0.35]);
  mesh(GEO.sphere, fur, tail, { p: [-0.25, 0, 0], s: [0.3, 0.1, 0.1] });
  mesh(GEO.sphere, MAT.fur.cream, tail, { p: [-0.52, 0.02, 0], s: [0.08, 0.07, 0.07] });
  const head = group(body, [0.36, 0.56, 0]);
  mesh(GEO.sphere, fur, head, { s: [0.13, 0.11, 0.11] });
  mesh(GEO.cone, fur, head, { p: [0.16, -0.03, 0], r: [0, 0, -Math.PI / 2], s: [0.06, 0.18, 0.06] });
  mesh(GEO.sphereLo, MAT.black, head, { p: [0.25, -0.03, 0], s: 0.022 });
  mesh(GEO.sphere, MAT.fur.cream, head, { p: [0.06, -0.06, 0], s: [0.08, 0.05, 0.1] });
  [1, -1].forEach((side) => {
    mesh(GEO.cone, fur, head, { p: [-0.03, 0.12, side * 0.06], r: [side * 0.2, 0, 0.15], s: [0.045, 0.11, 0.03] });
  });
  const eyes = [1, -1].map((side) => makeEye(head, [0.08, 0.035, side * 0.075], 0.018));
  R.fox = { root: fox, body, legs, tail, head, eyes, x: 9, active: false, paused: false, t: 0 };
  makeReact(fox, 'fox', 'Un zorro');
  heads.push({ obj: head, weight: 0.9, max: 1.2 });
  blinkers.push(eyes);
  breathers.push({ obj: body, amp: 0.015, speed: 2.4 });
}

function buildRabbit() {
  const rabbit = group(scene, [-0.55, 0, 2.55], [0, Math.PI - 0.55, 0]);
  const body = group(rabbit);
  const fur = MAT.fur.rabbit;
  mesh(GEO.sphere, fur, body, { p: [0, 0.17, 0], s: [0.2, 0.16, 0.15] });
  mesh(GEO.sphere, fur, body, { p: [-0.07, 0.13, 0], s: [0.14, 0.12, 0.16] });
  mesh(GEO.sphere, MAT.fur.cream, body, { p: [-0.21, 0.2, 0], s: 0.05 });
  mesh(GEO.sphere, fur, body, { p: [0.14, 0.04, 0.06], s: [0.06, 0.03, 0.035] });
  mesh(GEO.sphere, fur, body, { p: [0.14, 0.04, -0.06], s: [0.06, 0.03, 0.035] });
  const head = group(body, [0.16, 0.29, 0]);
  mesh(GEO.sphere, fur, head, { s: [0.1, 0.09, 0.09] });
  mesh(GEO.sphere, MAT.fur.cream, head, { p: [0.06, -0.03, 0], s: [0.05, 0.04, 0.06] });
  const nose = mesh(GEO.sphereLo, MAT.pink, head, { p: [0.1, -0.01, 0], s: 0.015 });
  const ears = [1, -1].map((side) => {
    const ear = group(head, [-0.02, 0.07, side * 0.04], [side * 0.2, 0, -0.15]);
    mesh(GEO.sphere, fur, ear, { p: [0, 0.12, 0], s: [0.03, 0.13, 0.045] });
    mesh(GEO.sphere, MAT.pink, ear, { p: [0.012, 0.12, 0], s: [0.016, 0.1, 0.028] });
    return ear;
  });
  const eyes = [1, -1].map((side) => makeEye(head, [0.055, 0.03, side * 0.068], 0.018));
  R.rabbit = { root: rabbit, body, head, ears, nose, eyes, baseX: -0.55, x: 0, paused: false };
  makeReact(rabbit, 'rabbit', 'Un conejo');
  heads.push({ obj: head, weight: 0.7, max: 0.9 });
  blinkers.push(eyes);
  breathers.push({ obj: body, amp: 0.025, speed: 3.2 });
}

// pájaro genérico: cada especie cambia colores y detalles
function makeBird(parent, o) {
  const root = group(parent, o.p, [0, o.yaw || 0, 0]);
  const s = o.size || 1;
  const body = group(root, null);
  body.scale.setScalar(s);
  mesh(GEO.sphere, o.bodyMat, body, { p: [0, 0.085, 0], s: [0.09, 0.065, 0.062] });
  mesh(GEO.sphere, o.bellyMat, body, { p: [0.025, 0.07, 0], s: [0.068, 0.05, 0.052] });
  mesh(GEO.box, o.tailMat || o.bodyMat, body, { p: [-0.1, 0.1, 0], r: [0, 0, 0.35], s: [0.09, 0.012, 0.045] });
  const wings = [1, -1].map((side) => {
    const w = group(body, [0, 0.11, side * 0.05]);
    mesh(GEO.sphere, o.wingMat || o.bodyMat, w, { p: [-0.02, 0, side * 0.012], s: [0.07, 0.014, 0.04] });
    return w;
  });
  [0.025, -0.025].forEach((z) => mesh(GEO.cyl, MAT.black, body, { p: [0.01, 0.015, z], s: [0.005, 0.04, 0.005], cast: false }));
  const head = group(body, [0.075, 0.135, 0]);
  mesh(GEO.sphere, o.headMat, head, { s: 0.046 });
  mesh(GEO.cone, o.beakMat, head, { p: [0.055, -0.005, 0], r: [0, 0, -Math.PI / 2], s: [0.016, 0.045, 0.016] });
  if (o.crest) mesh(GEO.cone, o.headMat, head, { p: [-0.02, 0.055, 0], r: [0, 0, 0.55], s: [0.022, 0.06, 0.02] });
  if (o.mask) mesh(GEO.sphere, MAT.black, head, { p: [0.032, -0.006, 0], s: [0.022, 0.026, 0.04] });
  if (o.cheek) [1, -1].forEach((side) => mesh(GEO.sphere, o.cheek, head, { p: [0.01, -0.012, side * 0.03], s: [0.025, 0.017, 0.02] }));
  if (o.cap) mesh(GEO.sphere, o.cap, head, { p: [-0.004, 0.018, 0], s: [0.047, 0.032, 0.047] });
  const eyes = [1, -1].map((side) => makeEye(head, [0.028, 0.014, side * 0.036], 0.008));
  blinkers.push(eyes);
  heads.push({ obj: head, weight: 0.8, max: 1.0 });
  return { root, body, head, wings, eyes, base: root.position.clone() };
}

function buildGroundBirds() {
  const brown = std({ map: TEX.fur.deer, color: 0xb08a6a, roughness: 1 });
  R.sparrow = makeBird(scene, {
    p: [0.45, 0, 3.05], yaw: 0.6, bodyMat: brown, bellyMat: MAT.fur.cream, headMat: brown,
    beakMat: MAT.black, wingMat: std({ color: 0x5a4535, roughness: 1 }), size: 1.25,
  });
  R.sparrow.paused = false;
  makeReact(R.sparrow.root, 'sparrow', 'Un gorrión');

  R.robin = makeBird(scene, {
    p: [1.1, 0, 2.95], yaw: 2.6, bodyMat: MAT.fur.gray, bellyMat: std({ color: 0xd9772f, roughness: 0.9 }),
    headMat: std({ color: 0x3e3833, roughness: 0.9 }), beakMat: MAT.orange, size: 1.3,
  });
  R.robin.paused = false;
  makeReact(R.robin.root, 'robin', 'Un petirrojo');
}

// ---------- Árbol de Navidad ----------
function buildTree() {
  const root = group(scene, [-2.15, 0, 1.0]);
  const pts = [[0.001, 0], [0.33, 0], [0.42, 0.52], [0.45, 0.54], [0.44, 0.56], [0.001, 0.56]].map(([r, y]) => new THREE.Vector2(r, y));
  mesh(new THREE.LatheGeometry(pts, 40), MAT.metal, root);
  mesh(new THREE.TorusGeometry(0.425, 0.025, 8, 40), MAT.metal, root, { p: [0, 0.54, 0], r: [Math.PI / 2, 0, 0] });
  [0.18, 0.36].forEach((y) => mesh(new THREE.TorusGeometry(0.36 + y * 0.12, 0.012, 6, 40), MAT.darkMetal, root, { p: [0, y, 0], r: [Math.PI / 2, 0, 0] }));
  mesh(GEO.cyl, MAT.snow, root, { p: [0, 0.55, 0], s: [0.41, 0.02, 0.41] });

  const sway = group(root, [0, 0.55, 0]);
  const tree = group(sway);
  mesh(GEO.cyl, MAT.bark, tree, { p: [0, 0.15, 0], s: [0.07, 0.3, 0.07] });
  const tiers = [{ y: 0.2, r: 0.95, h: 1.0 }, { y: 0.68, r: 0.78, h: 0.9 }, { y: 1.12, r: 0.58, h: 0.78 }, { y: 1.5, r: 0.38, h: 0.62 }];
  tiers.forEach((t, i) => {
    // abeto más verde y con solo un toque de nieve en las puntas
    const geo = branchTierGeometry(i * 2.3 + 1, { branches: 11, snow: 0.3, dark: 0x0f3b24, light: 0x3c8a57 });
    mesh(geo, MAT.xmasPine, tree, { p: [0, t.y + t.h / 2, 0], s: [t.r, t.h, t.r] });
  });

  const radiusAt = (y) => {
    for (let i = tiers.length - 1; i >= 0; i--) {
      const t = tiers[i];
      if (y >= t.y && y <= t.y + t.h) return t.r * (1 - (y - t.y) / t.h);
    }
    return 0.1;
  };

  // guirnalda dorada en espiral
  const garlandPts = [];
  for (let i = 0; i <= 120; i++) {
    const tt = i / 120;
    const y = 0.32 + tt * 1.6;
    const r = radiusAt(y) * 0.98 + 0.03;
    const a = tt * TAU * 3.2;
    garlandPts.push(new THREE.Vector3(Math.cos(a) * r, y, Math.sin(a) * r));
  }
  mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(garlandPts), 300, 0.018, 6), MAT.gold, tree);

  // luces
  const palette = [0xffd45a, 0xff5a5a, 0x7fe0a8, 0xffffff, 0x7fb2ff];
  R.treeLights = [];
  for (let i = 0; i < 44; i++) {
    const tt = i / 44;
    const y = 0.28 + tt * 1.7;
    const r = radiusAt(y) * 0.94 + 0.02;
    const a = tt * TAU * 4.6 + 1.2;
    const color = palette[i % palette.length];
    const bulbMat = new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 1.2, roughness: 0.3 });
    const p = [Math.cos(a) * r, y, Math.sin(a) * r];
    const bulb = mesh(GEO.sphereLo, bulbMat, tree, { p, s: 0.032, cast: false });
    bulb.userData.noCollide = true;
    const glow = glowSprite(tree, color, 0.26, p, 0.8);
    R.treeLights.push({ bulb, glow, mat: bulbMat, phase: rand(0, TAU), index: i });
  }

  // bolas que se balancean
  R.ornaments = [];
  const ornColors = [0xc0262f, 0xe8b23a, 0x2f5aa8, 0xc0262f, 0xd9d9e8];
  tiers.slice(0, 3).forEach((t, ti) => {
    for (let k = 0; k < 5 - ti; k++) {
      const a = (k / (5 - ti)) * TAU + ti * 0.7;
      const y = t.y + t.h * 0.22;
      const r = radiusAt(y) + 0.02;
      const pivot = group(tree, [Math.cos(a) * r, y + 0.05, Math.sin(a) * r]);
      const mat = std({ color: ornColors[(k + ti) % ornColors.length], roughness: 0.15, metalness: 0.7 });
      mesh(GEO.sphere, mat, pivot, { p: [0, -0.08, 0], s: 0.07 });
      mesh(GEO.cyl, MAT.gold, pivot, { p: [0, -0.005, 0], s: [0.02, 0.025, 0.02] });
      R.ornaments.push({ pivot, phase: rand(0, TAU) });
    }
  });

  // estrella extruida que brilla
  const starShape = new THREE.Shape();
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * TAU + Math.PI / 2;
    const rr = i % 2 ? 0.085 : 0.2;
    if (i === 0) starShape.moveTo(Math.cos(a) * rr, Math.sin(a) * rr);
    else starShape.lineTo(Math.cos(a) * rr, Math.sin(a) * rr);
  }
  const starGeo = new THREE.ExtrudeGeometry(starShape, { depth: 0.05, bevelEnabled: true, bevelThickness: 0.02, bevelSize: 0.015, bevelSegments: 2 });
  starGeo.center();
  const starRoot = makeReact(group(tree, [0, 2.24, 0]), 'treeStar', 'La estrella del árbol');
  const star = group(starRoot);
  mesh(starGeo, std({ color: 0xf2c14e, emissive: 0xffb82e, emissiveIntensity: 0.9, metalness: 0.6, roughness: 0.25 }), star);
  R.starGlow = glowSprite(starRoot, 0xffd27a, 1.1, [0, 0, 0], 0.75);
  const starLight = new THREE.PointLight(0xffc36a, 0.6, 3.5, 2);
  starRoot.add(starLight);
  R.star = star;

  // cardenal posado en una rama
  R.cardinal = makeBird(tree, {
    p: [-0.42, 0.98, 0.4], yaw: -2.3, bodyMat: std({ color: 0xc4222b, roughness: 0.7 }), bellyMat: std({ color: 0xd0303a, roughness: 0.7 }),
    headMat: std({ color: 0xd0262f, roughness: 0.7 }), beakMat: MAT.orange, wingMat: std({ color: 0x8d1820, roughness: 0.8 }),
    crest: true, mask: true, size: 1.5,
  });
  makeReact(R.cardinal.root, 'cardinal', 'Un cardenal');

  R.tree = { root, sway, tree };
  makeReact(tree, 'tree', 'El árbol de Navidad');
}

// ---------- Regalo 3D con tapa que se abre ----------
function makeGift(parent, w, h, d, paper, ribbonMat, p) {
  const root = group(parent, p);
  const bodyH = h * 0.82;
  mesh(GEO.box, paper, root, { p: [0, bodyH / 2, 0], s: [w, bodyH, d] });
  mesh(GEO.box, ribbonMat, root, { p: [0, bodyH / 2, 0], s: [w * 0.16, bodyH * 1.005, d * 1.01] });
  mesh(GEO.box, ribbonMat, root, { p: [0, bodyH / 2, 0], s: [w * 1.01, bodyH * 1.005, d * 0.16] });
  const lid = group(root, [0, bodyH, -d / 2]);
  const lidH = h * 0.18;
  mesh(GEO.box, paper, lid, { p: [0, lidH / 2, d / 2], s: [w * 1.07, lidH, d * 1.07] });
  mesh(GEO.box, ribbonMat, lid, { p: [0, lidH / 2, d / 2], s: [w * 0.17, lidH * 1.02, d * 1.08] });
  mesh(GEO.box, ribbonMat, lid, { p: [0, lidH / 2, d / 2], s: [w * 1.08, lidH * 1.02, d * 0.17] });
  const loop = new THREE.TorusGeometry(Math.min(w, d) * 0.16, Math.min(w, d) * 0.04, 8, 20);
  mesh(loop, ribbonMat, lid, { p: [-w * 0.1, lidH + Math.min(w, d) * 0.12, d / 2], r: [0, 0.4, 0.5] });
  mesh(loop, ribbonMat, lid, { p: [w * 0.1, lidH + Math.min(w, d) * 0.12, d / 2], r: [0, -0.4, -0.5] });
  mesh(GEO.sphere, ribbonMat, lid, { p: [0, lidH + 0.01, d / 2], s: Math.min(w, d) * 0.07 });
  return { root, lid, bodyH, w, h, d };
}

const ribbonGold = () => std({ color: 0xe8b23a, roughness: 0.3, metalness: 0.5 });

// ---------- Caseta, banco y todo lo que hay en ella ----------
function buildShed() {
  const shed = group(scene, [1.45, 0, -2.1], [0, 0.3, 0]);
  R.shed = shed;
  const Wd = 3.6, D = 2.4, Hh = 2.3, PEAK = 3.45, OV = 0.35;
  const slope = Math.atan2(PEAK - Hh, D / 2);
  const front = D / 2;

  // paredes
  mesh(GEO.box, MAT.wall, shed, { p: [0, Hh / 2, front], s: [Wd, Hh, 0.12] });
  mesh(GEO.box, MAT.wall, shed, { p: [0, Hh / 2, -front], s: [Wd, Hh, 0.12] });
  mesh(GEO.box, MAT.wall, shed, { p: [-Wd / 2, Hh / 2, 0], s: [0.12, Hh, D] });
  mesh(GEO.box, MAT.wall, shed, { p: [Wd / 2, Hh / 2, 0], s: [0.12, Hh, D] });
  const tri = new THREE.Shape();
  tri.moveTo(-front, 0); tri.lineTo(front, 0); tri.lineTo(0, PEAK - Hh); tri.lineTo(-front, 0);
  const gable = new THREE.ExtrudeGeometry(tri, { depth: 0.12, bevelEnabled: false });
  [-Wd / 2 - 0.06, Wd / 2 - 0.06].forEach((x) => mesh(gable, MAT.wall, shed, { p: [x, Hh, 0], r: [0, Math.PI / 2, 0] }));
  [[-1, 1], [1, 1], [-1, -1], [1, -1]].forEach(([sx, sz]) => mesh(GEO.box, MAT.post, shed, { p: [sx * Wd / 2, Hh / 2, sz * front], s: [0.18, Hh, 0.18] }));
  mesh(GEO.box, MAT.post, shed, { p: [0, 0.1, front + 0.02], s: [Wd + 0.2, 0.2, 0.16] });

  // tejado de tejas + capa de nieve
  const halfDepth = front + OV;
  const panelLen = Math.hypot(halfDepth, halfDepth * Math.tan(slope)) + 0.05;
  const eaveY = PEAK - halfDepth * Math.tan(slope);
  [1, -1].forEach((side) => {
    const cz = side * halfDepth / 2;
    const cy = (PEAK + eaveY) / 2;
    const normal = new THREE.Vector3(0, Math.cos(slope), side * Math.sin(slope));
    mesh(GEO.box, MAT.roof, shed, { p: [0, cy + 0.04, cz], r: [side * slope, 0, 0], s: [Wd + OV * 2, 0.1, panelLen] });
    const snow = mesh(GEO.box, MAT.snow, shed, { p: [0, cy + 0.04 + normal.y * 0.12, cz + normal.z * 0.12], r: [side * slope, 0, 0], s: [Wd + OV * 2 + 0.06, 0.15, panelLen + 0.06] });
    if (side === 1) R.roofSnowPanel = snow;
  });
  // rodillos de nieve de la cumbrera y del alero: decorativos (los regalos no se quedan en equilibrio encima)
  mesh(GEO.cyl, MAT.snow, shed, { p: [0, PEAK + 0.2, 0], r: [0, 0, Math.PI / 2], s: [0.13, Wd + OV * 2 + 0.05, 0.13] }).userData.noCollide = true;
  mesh(GEO.cyl, MAT.snow, shed, { p: [0, eaveY + 0.07, halfDepth + 0.02], r: [0, 0, Math.PI / 2], s: [0.1, Wd + OV * 2 + 0.06, 0.1] }).userData.noCollide = true;
  mesh(GEO.box, MAT.post, shed, { p: [0, eaveY - 0.04, halfDepth - 0.02], s: [Wd + OV * 2, 0.12, 0.05] });

  // placa de nieve que puede resbalar
  const chunk = makeReact(group(shed, [-0.9, 0, 0]), 'roofSnow', 'Nieve sobre el tejado');
  const chunkInner = group(chunk);
  const zc = halfDepth * 0.55;
  const yc = PEAK - zc * Math.tan(slope) + 0.36;
  mesh(GEO.sphere, MAT.snow, chunkInner, { p: [0, yc, zc], r: [slope, 0, 0], s: [0.55, 0.12, 0.42] });
  mesh(GEO.sphere, MAT.snow, chunkInner, { p: [0.35, yc + 0.02, zc - 0.1], r: [slope, 0, 0], s: [0.3, 0.1, 0.3] });
  R.roofChunk = { inner: chunkInner, slope };

  // carámbanos + guirnalda de luces del alero
  const eave = makeReact(group(shed), 'eave', 'Carámbanos y luces del alero');
  eave.userData.noCollide = true;
  R.icicles = [];
  for (let x = -Wd / 2 - OV + 0.12; x < Wd / 2 + OV - 0.1; x += rand(0.12, 0.24)) {
    const len = rand(0.08, 0.38);
    const ic = mesh(GEO.cone, MAT.ice, eave, { p: [x, eaveY - 0.06 - len / 2, halfDepth - 0.02], r: [Math.PI, 0, 0], s: [0.022, len, 0.022], cast: false });
    R.icicles.push({ mesh: ic, tip: new THREE.Vector3(x, eaveY - 0.06 - len, halfDepth - 0.02) });
  }
  const wirePts = [];
  const nb = 16;
  for (let i = 0; i <= nb * 4; i++) {
    const t = i / (nb * 4);
    const x = -Wd / 2 - OV + 0.1 + t * (Wd + OV * 2 - 0.2);
    const sag = Math.abs(Math.sin(t * nb * Math.PI)) * 0.07;
    wirePts.push(new THREE.Vector3(x, eaveY - 0.08 - sag, halfDepth + 0.03));
  }
  mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(wirePts), 200, 0.008, 5), std({ color: 0x1a1410 }), eave, { cast: false });
  const bulbColors = [0xffcf6b, 0xff6b5a, 0xffe9b0, 0x7fe0a8, 0x7fb2ff];
  R.eaveLights = [];
  for (let i = 0; i <= nb; i++) {
    const x = -Wd / 2 - OV + 0.1 + (i / nb) * (Wd + OV * 2 - 0.2);
    const pivot = group(eave, [x, eaveY - 0.09, halfDepth + 0.03]);
    const color = bulbColors[i % bulbColors.length];
    const mat = new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 1.2, roughness: 0.3 });
    mesh(GEO.cyl, MAT.darkMetal, pivot, { p: [0, -0.02, 0], s: [0.015, 0.03, 0.015], cast: false });
    const bulb = mesh(GEO.sphere, mat, pivot, { p: [0, -0.07, 0], s: [0.03, 0.045, 0.03], cast: false });
    const glow = glowSprite(pivot, color, 0.3, [0, -0.07, 0], 0.8);
    R.eaveLights.push({ pivot, bulb, glow, mat, phase: rand(0, TAU), index: i });
  }

  // chimenea de estufa
  const chimney = makeReact(group(shed, [1.1, PEAK - 0.5 * Math.tan(slope), -0.5]), 'chimney', 'La chimenea');
  const chimInner = group(chimney);
  mesh(GEO.cyl, MAT.darkMetal, chimInner, { p: [0, 0.45, 0], s: [0.1, 1.1, 0.1] });
  mesh(GEO.cyl, MAT.darkMetal, chimInner, { p: [0, 1.02, 0], s: [0.17, 0.07, 0.17] });
  mesh(GEO.cone, MAT.darkMetal, chimInner, { p: [0, 1.12, 0], s: [0.2, 0.1, 0.2] });
  mesh(GEO.sphere, MAT.snow, chimInner, { p: [0, 1.16, 0], s: [0.17, 0.05, 0.17] });
  R.chimney = { root: chimney, inner: chimInner, top: new THREE.Vector3(0, 1.2, 0) };

  // ventana con interior iluminado y osito
  const winP = [0.95, 1.55, front];
  const win = makeReact(group(shed, winP), 'window', 'La ventana');
  const interiorTex = canvasTexture(256, 200, (ctx, w, h) => {
    const g = ctx.createRadialGradient(w * 0.55, h * 0.75, 10, w * 0.55, h * 0.7, w * 0.8);
    g.addColorStop(0, '#ffe2a0'); g.addColorStop(0.45, '#d98c3e'); g.addColorStop(1, '#3a2414');
    ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#2a1a0f'; ctx.fillRect(10, 74, 110, 6);
    ['#6b4a30', '#7d5a3c', '#5c3f29'].forEach((c, i) => { ctx.fillStyle = c; ctx.fillRect(16 + i * 30, 40 - i * 6, 20, 34 + i * 6); });
  });
  const interiorMat = new THREE.MeshBasicMaterial({ map: interiorTex, color: 0x9a8070 });
  mesh(GEO.plane, interiorMat, win, { p: [0, 0, 0.065], s: [0.92, 0.72, 1], cast: false });
  const teddy = group(win, [0.18, -0.24, 0.1]);
  const bear = MAT.fur.bear;
  mesh(GEO.sphere, bear, teddy, { p: [0, 0.07, 0], s: [0.07, 0.08, 0.05] });
  mesh(GEO.sphere, bear, teddy, { p: [0, 0.18, 0], s: 0.055 });
  [-1, 1].forEach((s) => mesh(GEO.sphere, bear, teddy, { p: [s * 0.04, 0.23, 0], s: 0.022 }));
  mesh(GEO.sphere, MAT.cream, teddy, { p: [0, 0.165, 0.045], s: [0.025, 0.02, 0.015] });
  [-1, 1].forEach((s) => mesh(GEO.sphereLo, MAT.black, teddy, { p: [s * 0.02, 0.19, 0.05], s: 0.007, cast: false }));
  mesh(GEO.box, MAT.red, teddy, { p: [0, 0.12, 0.02], s: [0.1, 0.02, 0.06] });
  const teddyArm = group(teddy, [0.06, 0.1, 0], [0, 0, -0.4]);
  mesh(GEO.sphere, bear, teddyArm, { p: [0.03, 0.04, 0], s: [0.022, 0.05, 0.022] });
  const glass = std({ color: 0xfff1d8, roughness: 0.05, metalness: 0.3, transparent: true, opacity: 0.16 });
  mesh(GEO.plane, glass, win, { p: [0, 0, 0.13], s: [0.92, 0.72, 1], cast: false });
  const frameMat = std({ color: 0xe9dfcc, roughness: 0.6 });
  [[0, 0.39, 1.04, 0.07], [0, -0.39, 1.04, 0.07], [-0.49, 0, 0.07, 0.85], [0.49, 0, 0.07, 0.85], [0, 0, 0.04, 0.72], [0, 0.02, 0.92, 0.04]]
    .forEach(([x, y, sx, sy]) => mesh(GEO.box, frameMat, win, { p: [x, y, 0.13], s: [sx, sy, 0.08] }));
  mesh(GEO.box, frameMat, win, { p: [0, -0.45, 0.17], s: [1.16, 0.06, 0.2] });
  mesh(GEO.box, MAT.snow, win, { p: [0, -0.4, 0.18], s: [1.12, 0.05, 0.18] });
  const winLight = new THREE.PointLight(0xffb35a, 0.7, 5, 2);
  winLight.position.set(0, -0.1, 0.9);
  win.add(winLight);
  R.window = { root: win, interiorMat, teddy, teddyArm, light: winLight };

  // corona de acebo con campanillas
  const wreathWind = group(shed, [-0.55, 1.98, front + 0.08]);
  const wreath = makeReact(group(wreathWind), 'wreath', 'La corona');
  const wreathRing = group(wreath, [0, -0.3, 0]);
  mesh(new THREE.TorusGeometry(0.26, 0.08, 12, 32), MAT.needles, wreathRing);
  for (let i = 0; i < 9; i++) {
    const a = (i / 9) * TAU;
    mesh(GEO.sphereLo, MAT.redGloss, wreathRing, { p: [Math.cos(a) * 0.26, Math.sin(a) * 0.26, 0.08], s: 0.03 });
  }
  [-1, 1].forEach((s) => mesh(GEO.cone, MAT.red, wreathRing, { p: [s * 0.07, -0.27, 0.08], r: [0, 0, s * Math.PI / 2], s: [0.05, 0.12, 0.03] }));
  mesh(GEO.sphere, MAT.red, wreathRing, { p: [0, -0.27, 0.09], s: 0.035 });
  R.bells = [-1, 1].map((s) => {
    const pivot = group(wreathRing, [s * 0.04, -0.3, 0.08]);
    mesh(GEO.cone, MAT.gold, pivot, { p: [0, -0.07, 0], s: [0.04, 0.07, 0.04] });
    mesh(GEO.sphereLo, MAT.gold, pivot, { p: [0, -0.11, 0], s: 0.012 });
    return pivot;
  });
  R.wreath = { wind: wreathWind, root: wreath };

  // casita de pájaros colgando del alero
  const bhY = PEAK - (front + 0.2) * Math.tan(slope) - 0.06;
  const bhWind = group(shed, [-1.15, bhY, front + 0.2]);
  const birdhouse = makeReact(group(bhWind), 'birdhouse', 'La casita de pájaros');
  mesh(GEO.cyl, MAT.black, birdhouse, { p: [0, -0.15, 0], s: [0.006, 0.3, 0.006], cast: false });
  const bhRed = std({ map: TEX.post, color: 0xd04a3a, roughness: 0.8 });
  mesh(GEO.box, bhRed, birdhouse, { p: [0, -0.46, 0], s: [0.24, 0.26, 0.2] });
  [-1, 1].forEach((s) => mesh(GEO.box, MAT.post, birdhouse, { p: [s * 0.075, -0.3, 0], r: [0, 0, s * -0.75], s: [0.2, 0.025, 0.25] }));
  [-1, 1].forEach((s) => mesh(GEO.box, MAT.snow, birdhouse, { p: [s * 0.07, -0.275, 0], r: [0, 0, s * -0.75], s: [0.19, 0.025, 0.24] }));
  mesh(new THREE.CircleGeometry(0.04, 20), MAT.black, birdhouse, { p: [0, -0.43, 0.101], cast: false });
  mesh(GEO.cyl, MAT.post, birdhouse, { p: [0, -0.51, 0.13], r: [Math.PI / 2, 0, 0], s: [0.008, 0.07, 0.008] });
  const peek = group(birdhouse, [0, -0.43, 0.08]);
  mesh(GEO.sphere, MAT.black, peek, { s: 0.035 });
  mesh(GEO.sphere, MAT.cream, peek, { p: [0.0, -0.01, 0.02], s: [0.025, 0.015, 0.02] });
  mesh(GEO.cone, MAT.black, peek, { p: [0, 0, 0.04], r: [Math.PI / 2, 0, 0], s: [0.01, 0.03, 0.01] });
  peek.scale.setScalar(0.001);
  R.birdhouse = { wind: bhWind, root: birdhouse, peek };

  // arrendajo azul sobre la nieve del tejado
  const jz = halfDepth * 0.72;
  R.jay = makeBird(shed, {
    p: [-1.45, PEAK - jz * Math.tan(slope) + 0.27, jz], yaw: -0.3,
    bodyMat: std({ color: 0x4f7fc2, roughness: 0.7 }), bellyMat: MAT.cream, headMat: std({ color: 0x5d8dd0, roughness: 0.7 }),
    beakMat: MAT.black, wingMat: std({ color: 0x3a66a8, roughness: 0.7 }), crest: true, size: 1.6,
  });
  R.jay.slope = slope;
  makeReact(R.jay.root, 'jay', 'Un arrendajo azul');

  // herramientas apoyadas en la pared
  const shovel = makeReact(group(shed, [-1.6, 0, front + 0.34], [-0.17, 0, 0.05]), 'shovel', 'La pala');
  const shovelInner = group(shovel);
  mesh(GEO.cyl, MAT.bench, shovelInner, { p: [0, 0.85, 0], s: [0.022, 1.3, 0.022] });
  mesh(new THREE.TorusGeometry(0.06, 0.012, 6, 16, Math.PI), MAT.bench, shovelInner, { p: [0, 1.5, 0] });
  mesh(GEO.box, MAT.metal, shovelInner, { p: [0, 0.16, 0], s: [0.24, 0.32, 0.02] });
  R.shovel = shovelInner;

  const rake = makeReact(group(shed, [-1.3, 0, front + 0.3], [-0.15, 0, -0.06]), 'rake', 'El rastrillo');
  const rakeInner = group(rake);
  mesh(GEO.cyl, MAT.bench, rakeInner, { p: [0, 0.75, 0], s: [0.02, 1.5, 0.02] });
  const tines = group(rakeInner, [0, 1.5, 0]);
  tines.userData.noCollide = true;
  for (let i = 0; i < 9; i++) {
    const a = (i / 8 - 0.5) * 1.1;
    mesh(GEO.cyl, MAT.metal, tines, { p: [Math.sin(a) * 0.14, 0.13, 0], r: [0, 0, -a], s: [0.005, 0.28, 0.005], cast: false });
  }
  mesh(GEO.box, MAT.metal, tines, { p: [0, 0.02, 0], s: [0.12, 0.03, 0.02] });
  R.rake = { inner: rakeInner, tines };

  buildBench(shed, front);
}

function buildBench(shed, front) {
  const bench = group(shed, [0.1, 0, front + 0.42]);
  mesh(GEO.box, MAT.bench, bench, { p: [0, 0.98, 0], s: [2.7, 0.07, 0.62] });
  mesh(GEO.box, MAT.bench, bench, { p: [0, 0.91, 0.29], s: [2.7, 0.12, 0.04] });
  [[-1.25, -0.25], [1.25, -0.25], [-1.25, 0.26], [1.25, 0.26]].forEach(([x, z]) => mesh(GEO.box, MAT.post, bench, { p: [x, 0.48, z], s: [0.08, 0.96, 0.08] }));
  mesh(GEO.box, MAT.bench, bench, { p: [0, 0.3, 0], s: [2.6, 0.05, 0.56] });
  mesh(GEO.sphere, MAT.snow, bench, { p: [-1.18, 1.02, 0.15], s: [0.18, 0.03, 0.12], cast: false });
  mesh(GEO.sphere, MAT.snow, bench, { p: [0.95, 1.02, -0.18], s: [0.22, 0.03, 0.1], cast: false });
  const top = 1.015;
  const low = 0.325;

  // regadera
  const can = makeReact(group(bench, [-0.98, top, -0.02]), 'can', 'La regadera');
  const canInner = group(can, [0.17, 0, 0]);
  const canBody = group(canInner, [-0.17, 0, 0]);
  const canPts = [[0.001, 0], [0.13, 0], [0.12, 0.26], [0.1, 0.27], [0.001, 0.27]].map(([r, y]) => new THREE.Vector2(r, y));
  mesh(new THREE.LatheGeometry(canPts, 32), MAT.metal, canBody);
  mesh(GEO.cyl, MAT.metal, canBody, { p: [0.17, 0.2, 0], r: [0, 0, -0.9], s: [0.02, 0.32, 0.02] });
  mesh(GEO.cyl, MAT.metal, canBody, { p: [0.3, 0.3, 0], r: [0, 0, -0.9], s: [0.04, 0.04, 0.04] });
  mesh(new THREE.TorusGeometry(0.1, 0.012, 8, 20, Math.PI), MAT.metal, canBody, { p: [-0.02, 0.27, 0] });
  R.can = { inner: canInner, spout: new THREE.Vector3(0.32, 0.3, 0), body: canBody };

  // maceta con acebo y carbonero
  const holly = makeReact(group(bench, [-0.48, top, 0]), 'holly', 'El acebo');
  const potPts = [[0.001, 0], [0.09, 0], [0.12, 0.2], [0.135, 0.21], [0.135, 0.25], [0.12, 0.25], [0.11, 0.23], [0.001, 0.23]].map(([r, y]) => new THREE.Vector2(r, y));
  const potGeo = new THREE.LatheGeometry(potPts, 32);
  mesh(potGeo, MAT.clay, holly);
  const leaves = group(holly, [0, 0.23, 0]);
  const leafGeo = new THREE.SphereGeometry(1, 10, 6);
  for (let i = 0; i < 18; i++) {
    const a = rand(0, TAU), r = rand(0.02, 0.14), y = rand(0.04, 0.24);
    const leaf = group(leaves, [Math.cos(a) * r, y, Math.sin(a) * r], [rand(-0.6, 0.6), a, rand(-0.6, 0.6)]);
    mesh(leafGeo, MAT.leaf, leaf, { s: [0.07, 0.012, 0.035] });
  }
  for (let i = 0; i < 9; i++) {
    const a = rand(0, TAU), r = rand(0.03, 0.1);
    mesh(GEO.sphereLo, MAT.redGloss, leaves, { p: [Math.cos(a) * r, rand(0.12, 0.26), Math.sin(a) * r], s: 0.022 });
  }
  R.holly = { leaves };
  R.chickadee = makeBird(holly, {
    p: [0.03, 0.47, 0.02], yaw: 0.9, bodyMat: std({ color: 0xb8b2a8, roughness: 0.8 }), bellyMat: MAT.cream,
    headMat: std({ color: 0x1d1d1d, roughness: 0.6 }), beakMat: MAT.black, cheek: MAT.cream, size: 1.3,
  });
  makeReact(R.chickadee.root, 'chickadee', 'Un carbonero');

  // regalo grande con sorpresa de muelle
  const jackG = makeGift(bench, 0.38, 0.32, 0.32, MAT.papers[0], ribbonGold(), [0.12, top, 0]);
  makeReact(jackG.root, 'jackGift', 'Un regalo grande');
  const jack = group(jackG.root, [0, jackG.bodyH - 0.05, 0]);
  const spring = [];
  for (let i = 0; i <= 60; i++) {
    const t = i / 60;
    spring.push(new THREE.Vector3(Math.cos(t * TAU * 5) * 0.04, t * 0.3, Math.sin(t * TAU * 5) * 0.04));
  }
  mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(spring), 120, 0.006, 5), MAT.metal, jack);
  const jStar = new THREE.Shape();
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * TAU + Math.PI / 2, rr = i % 2 ? 0.045 : 0.1;
    if (i === 0) jStar.moveTo(Math.cos(a) * rr, Math.sin(a) * rr); else jStar.lineTo(Math.cos(a) * rr, Math.sin(a) * rr);
  }
  const jsGeo = new THREE.ExtrudeGeometry(jStar, { depth: 0.03, bevelEnabled: true, bevelThickness: 0.01, bevelSize: 0.008, bevelSegments: 2 });
  jsGeo.center();
  mesh(jsGeo, std({ color: 0xf2c14e, emissive: 0xc88a1a, emissiveIntensity: 0.4, metalness: 0.5, roughness: 0.3 }), jack, { p: [0, 0.38, 0] });
  jack.scale.set(1, 0.001, 1);
  R.jackGift = { ...jackG, jack };

  // ardilla con su bellota
  buildSquirrel(bench, [0.62, top, 0.02]);

  // regalo pequeño de confeti
  const confG = makeGift(bench, 0.2, 0.2, 0.2, MAT.papers[1], MAT.red, [1.0, top, 0.05]);
  makeReact(confG.root, 'confettiGift', 'Un regalo pequeño');
  R.confettiGift = confG;

  // balda inferior: maceta boca abajo con ratón, caja de música, semillas, macetas
  const mousePot = makeReact(group(bench, [-0.95, low, 0]), 'mousePot', 'Una maceta boca abajo');
  const mouse3d = group(mousePot);
  mesh(GEO.sphere, MAT.fur.gray, mouse3d, { p: [0, 0.05, 0], s: [0.07, 0.045, 0.045] });
  mesh(GEO.sphere, MAT.fur.gray, mouse3d, { p: [0.07, 0.07, 0], s: 0.035 });
  [-1, 1].forEach((s) => mesh(GEO.sphere, MAT.pink, mouse3d, { p: [0.06, 0.11, s * 0.025], s: [0.012, 0.025, 0.022] }));
  mesh(GEO.sphereLo, MAT.pink, mouse3d, { p: [0.105, 0.065, 0], s: 0.008 });
  [-1, 1].forEach((s) => makeEye(mouse3d, [0.09, 0.08, s * 0.018], 0.007));
  mouse3d.scale.setScalar(0.001);
  const upPot = group(mousePot);
  const upPotInner = group(upPot, [0, 0.25, 0], [Math.PI, 0, 0]);
  mesh(potGeo, MAT.clay, upPotInner);
  R.mousePot = { pot: upPot, mouse: mouse3d };

  const music = makeGift(bench, 0.26, 0.17, 0.2, MAT.papers[2], MAT.cream, [-0.35, low, 0]);
  makeReact(music.root, 'musicBox', 'Una caja de música');
  const musicStar = group(music.root, [0, 0.12, 0]);
  mesh(jsGeo, std({ color: 0xffe08a, emissive: 0xd9a52e, emissiveIntensity: 0.5, metalness: 0.5, roughness: 0.3 }), musicStar, { s: 0.7 });
  musicStar.scale.setScalar(0.001);
  R.musicBox = { ...music, star: musicStar };

  const seed = makeReact(group(bench, [0.3, low, 0]), 'seedBag', 'Semillas de ilusión');
  const seedInner = group(seed, [0.1, 0, 0]);
  const seedBody = group(seedInner, [-0.1, 0, 0]);
  const bagPts = [[0.001, 0], [0.11, 0], [0.12, 0.12], [0.1, 0.22], [0.07, 0.25], [0.085, 0.29], [0.001, 0.29]].map(([r, y]) => new THREE.Vector2(r, y));
  mesh(new THREE.LatheGeometry(bagPts, 24), MAT.burlap, seedBody);
  const seedLabel = labelTexture([
    { text: 'semillas', font: 'italic 700 46px Fraunces, Georgia, serif', color: '#5e3c1c', y: 0.38 },
    { text: 'de ilusión', font: 'italic 700 40px Fraunces, Georgia, serif', color: '#5e3c1c', y: 0.72 },
  ], { bg: '#efe1c2' });
  mesh(GEO.plane, std({ map: seedLabel, roughness: 0.9 }), seedBody, { p: [0, 0.12, 0.118], s: [0.17, 0.085, 1], cast: false });
  const sprout = group(seedBody, [0, 0.27, 0]);
  mesh(GEO.cyl, MAT.leaf, sprout, { p: [0, 0.06, 0], s: [0.006, 0.12, 0.006] });
  [-1, 1].forEach((s) => mesh(leafGeo, MAT.leaf, sprout, { p: [s * 0.03, 0.12, 0], r: [0, 0, s * 0.5], s: [0.04, 0.008, 0.02] }));
  sprout.scale.setScalar(0.001);
  R.seedBag = { inner: seedInner, sprout, mouth: new THREE.Vector3(0.1, 0.29, 0) };

  const pots = makeReact(group(bench, [0.9, low, 0]), 'pots', 'Macetas de barro');
  R.pots = [[-0.14, 1], [0.12, 0.8], [0.0, 0.7]].map(([x, s], i) => {
    const pot = group(pots, [x, i === 2 ? 0.2 : 0, i === 2 ? -0.1 : 0]);
    mesh(potGeo, MAT.clay, pot, { s });
    return pot;
  });
}

function buildSquirrel(parent, p) {
  const root = makeReact(group(parent, p, [0, -0.5, 0]), 'squirrel', 'Una ardilla');
  const body = group(root);
  const fur = MAT.fur.squirrel;
  mesh(GEO.sphere, fur, body, { p: [0, 0.14, 0], s: [0.09, 0.13, 0.08] });
  mesh(GEO.sphere, MAT.fur.cream, body, { p: [0.035, 0.13, 0], s: [0.06, 0.1, 0.065] });
  [-1, 1].forEach((s) => mesh(GEO.sphere, fur, body, { p: [0.02, 0.025, s * 0.045], s: [0.055, 0.025, 0.03] }));
  const tailCurve = new THREE.CatmullRomCurve3([[-0.06, 0.06, 0], [-0.18, 0.12, 0], [-0.22, 0.28, 0], [-0.15, 0.4, 0], [-0.07, 0.38, 0]].map((v) => new THREE.Vector3(...v)));
  const tail = group(body, [-0.04, 0.05, 0]);
  mesh(new THREE.TubeGeometry(tailCurve, 40, 0.055, 10), fur, tail, { p: [0.04, -0.05, 0] });
  const head = group(body, [0.03, 0.29, 0]);
  mesh(GEO.sphere, fur, head, { s: 0.07 });
  mesh(GEO.sphere, fur, head, { p: [0.06, -0.012, 0], s: [0.04, 0.035, 0.035] });
  mesh(GEO.sphereLo, MAT.black, head, { p: [0.098, -0.005, 0], s: 0.01 });
  [-1, 1].forEach((s) => mesh(GEO.cone, fur, head, { p: [-0.01, 0.07, s * 0.035], s: [0.018, 0.04, 0.015] }));
  const eyes = [1, -1].map((s) => makeEye(head, [0.045, 0.02, s * 0.045], 0.012));
  const acorn = group(body, [0.085, 0.18, 0]);
  mesh(GEO.sphere, std({ color: 0x9a6a3c, roughness: 0.5 }), acorn, { s: [0.025, 0.03, 0.025] });
  mesh(GEO.sphere, std({ color: 0x5b3c20, roughness: 1 }), acorn, { p: [0, 0.022, 0], s: [0.027, 0.015, 0.027] });
  const mini = makeGift(body, 0.07, 0.07, 0.07, MAT.papers[0], ribbonGold(), [0.09, 0.15, 0]);
  mini.root.scale.setScalar(0.001);
  R.squirrel = { root, body, tail, head, eyes, acorn, mini: mini.root, paused: false };
  heads.push({ obj: head, weight: 0.8, max: 1.0 });
  blinkers.push(eyes);
  breathers.push({ obj: body, amp: 0.02, speed: 3 });
}

// ---------- Saco de "ILUSIÓN" ----------
function buildSack() {
  const sack = makeReact(group(scene, [2.35, 0, 2.3], [0, -0.3, 0]), 'sack', 'El saco de ilusión');
  const inner = group(sack);
  const pts = [[0.001, 0], [0.34, 0.02], [0.44, 0.16], [0.47, 0.38], [0.42, 0.6], [0.3, 0.74], [0.17, 0.82], [0.14, 0.88], [0.21, 0.97], [0.001, 0.97]]
    .map(([r, y]) => new THREE.Vector2(r, y));
  mesh(new THREE.LatheGeometry(pts, 40), MAT.burlap, inner);
  mesh(new THREE.TorusGeometry(0.15, 0.022, 8, 24), std({ color: 0x6b4f30, roughness: 1 }), inner, { p: [0, 0.85, 0], r: [Math.PI / 2, 0, 0] });
  const label = labelTexture([
    { text: 'ILUSIÓN', font: '900 64px Fraunces, Georgia, serif', color: '#5e4426', y: 0.42 },
    { text: 'para todos', font: 'italic 600 34px Fraunces, Georgia, serif', color: '#5e4426', y: 0.78 },
  ], { w: 320, h: 160 });
  const labelMat = new THREE.MeshStandardMaterial({ map: label, transparent: true, roughness: 1 });
  mesh(GEO.plane, labelMat, inner, { p: [0, 0.42, 0.47], r: [-0.05, 0, 0], s: [0.6, 0.3, 1], cast: false });
  const peek = group(inner, [0, 0.82, 0]);
  makeGift(peek, 0.18, 0.2, 0.16, MAT.papers[3], ribbonGold(), [-0.06, 0, 0]).root.rotation.z = 0.3;
  makeGift(peek, 0.16, 0.18, 0.15, MAT.papers[4], MAT.cream, [0.08, 0, 0.02]).root.rotation.z = -0.25;
  R.sack = { inner, peek };
}

// ---------- Hierba seca que asoma de la nieve ----------
function buildGrass() {
  R.grass = [];
  const spots = [[-3.4, 2.3], [-2.9, 3.2], [-1.2, 3.4], [-0.1, 2.2], [0.2, 3.6], [1.7, 3.3], [2.2, 2.7], [3.6, 3.0], [3.9, 1.2], [-3.9, 0.4], [-0.9, 1.6], [4.2, 2.3]];
  spots.forEach(([x, z]) => {
    const tuft = group(scene, [x, 0, z]);
    tuft.userData.noCollide = true;   // los regalos no se apoyan en la hierba
    for (let i = 0; i < 7; i++) {
      const h = rand(0.18, 0.42);
      const blade = group(tuft, [rand(-0.05, 0.05), 0, rand(-0.05, 0.05)], [rand(-0.35, 0.35), rand(0, TAU), rand(-0.35, 0.35)]);
      mesh(GEO.cone, MAT.straw, blade, { p: [0, h / 2, 0], s: [0.008, h, 0.008] });
      if (Math.random() < 0.4) mesh(GEO.sphereLo, MAT.straw, blade, { p: [0, h, 0], s: [0.012, 0.03, 0.012] });
    }
    R.grass.push({ tuft, x, z, bend: 0, phase: rand(0, TAU) });
  });
}

/* =========================================================
   5 · SISTEMA DE ANIMACIÓN (tweens y oscilaciones)
   ========================================================= */
const anims = [];

function run(ms, fn, opts = {}) {
  const a = { t: -(opts.delay || 0), ms, fn, ease: opts.ease || ease.outCubic, done: opts.done, alive: true };
  anims.push(a);
  return a;
}

function cancel(a) {
  if (a) a.alive = false;
}

// lleva obj[key] hasta un valor (cancela la animación anterior de esa propiedad)
function tweenTo(obj, key, to, ms, opts = {}) {
  obj.__tw = obj.__tw || {};
  cancel(obj.__tw[key]);
  let from;
  const a = run(ms, (e) => {
    if (from === undefined) from = obj[key];
    obj[key] = from + (to - from) * e;
  }, opts);
  obj.__tw[key] = a;
  return a;
}

function scaleTo(obj, s, ms, opts) {
  tweenTo(obj.scale, 'x', Array.isArray(s) ? s[0] : s, ms, opts);
  tweenTo(obj.scale, 'y', Array.isArray(s) ? s[1] : s, ms, opts);
  tweenTo(obj.scale, 'z', Array.isArray(s) ? s[2] : s, ms, opts);
}

// oscilación amortiguada (sacudidas, balanceos, campanillas…)
function wobble(obj, key, amp, ms, freq = 3, opts = {}) {
  obj.__tw = obj.__tw || {};
  cancel(obj.__tw[key]);
  let base;
  const a = run(ms, (e, p) => {
    if (base === undefined) base = obj[key];
    obj[key] = base + amp * Math.sin(p * freq * TAU) * (1 - p);
  }, { ...opts, ease: ease.linear, done: () => { obj[key] = base; if (opts.done) opts.done(); } });
  obj.__tw[key] = a;
  return a;
}

function updateAnims(dt) {
  for (let i = anims.length - 1; i >= 0; i--) {
    const a = anims[i];
    if (!a.alive) { anims.splice(i, 1); continue; }
    a.t += dt * 1000;
    if (a.t < 0) continue;
    const p = Math.min(1, a.t / a.ms);
    a.fn(a.ease(p), p);
    if (p >= 1) {
      anims.splice(i, 1);
      a.alive = false;
      if (a.done) a.done();
    }
  }
}

/* =========================================================
   6 · PARTÍCULAS 3D (sprites y confeti)
   ========================================================= */
const particles = [];
const tmpV = new THREE.Vector3();

function emit(tex, pos, o = {}) {
  if (particles.length > 450) return;
  const mat = new THREE.SpriteMaterial({
    map: tex, color: o.color || 0xffffff, transparent: true, depthWrite: false,
    blending: o.additive ? THREE.AdditiveBlending : THREE.NormalBlending, opacity: o.opacity || 1, fog: false,
  });
  const s = new THREE.Sprite(mat);
  s.position.copy(pos);
  const size = o.size || 0.15;
  s.scale.set(size * (o.aspect || 1), size, 1);
  s.userData.noRay = true;
  scene.add(s);
  particles.push({
    obj: s, mat, vel: o.vel || new THREE.Vector3(), gravity: o.gravity ?? 1.5, life: 1,
    decay: o.decay || 0.8, grow: o.grow || 0, spin: o.spin || 0, windy: o.windy || 0,
    size, aspect: o.aspect || 1, maxOpacity: o.opacity || 1, flutter: o.flutter || 0, phase: rand(0, TAU),
  });
}

function emitMesh(color, pos, o = {}) {
  if (particles.length > 450) return;
  const mat = new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide, transparent: true });
  const m = new THREE.Mesh(GEO.plane, mat);
  m.position.copy(pos);
  m.scale.set(o.w || 0.04, o.h || 0.02, 1);
  m.rotation.set(rand(0, TAU), rand(0, TAU), rand(0, TAU));
  m.userData.noRay = true;
  scene.add(m);
  particles.push({
    obj: m, mat, vel: o.vel || new THREE.Vector3(), gravity: o.gravity ?? 2, life: 1, decay: o.decay || 0.4,
    spinV: new THREE.Vector3(rand(-6, 6), rand(-6, 6), rand(-6, 6)), windy: o.windy || 0, isMesh: true, flutter: o.flutter || 0, phase: rand(0, TAU),
  });
}

function updateParticles(dt) {
  for (let i = particles.length - 1; i >= 0; i--) {
    const p = particles[i];
    p.vel.y -= p.gravity * dt;
    p.vel.x += wind.value * p.windy * dt;
    if (p.flutter) p.vel.x += Math.sin(p.phase + p.life * 12) * p.flutter * dt;
    p.obj.position.addScaledVector(p.vel, dt);
    p.life -= p.decay * dt;
    if (p.life <= 0) {
      scene.remove(p.obj);
      p.mat.dispose();
      particles.splice(i, 1);
      continue;
    }
    if (p.isMesh) {
      p.obj.rotation.x += p.spinV.x * dt;
      p.obj.rotation.y += p.spinV.y * dt;
      p.mat.opacity = Math.min(1, p.life * 2);
    } else {
      const g = 1 + (1 - p.life) * p.grow;
      p.obj.scale.set(p.size * g * p.aspect, p.size * g, 1);
      p.mat.opacity = Math.min(1, p.life * 1.6) * p.maxOpacity;
      p.mat.rotation += p.spin * dt;
    }
  }
}

const v3 = (x, y, z) => new THREE.Vector3(x, y, z);
const worldOf = (obj, local = v3(0, 0, 0)) => obj.localToWorld(local.clone());

function sparks(pos, n = 14, power = 1.6, color = 0xffd27a) {
  for (let i = 0; i < n; i++) {
    const dir = v3(rand(-1, 1), rand(-0.2, 1.2), rand(-1, 1)).normalize().multiplyScalar(rand(0.4, power));
    emit(TEX.star4, pos, { vel: dir, gravity: 1.2, size: rand(0.06, 0.13), decay: rand(0.9, 1.5), additive: true, color: pick([color, 0xffffff, 0xff8a7a]), spin: rand(-4, 4) });
  }
}
function hearts(pos, n = 4) {
  for (let i = 0; i < n; i++) emit(TEX.heart, pos.clone().add(v3(rand(-0.1, 0.1), 0, 0)), { vel: v3(rand(-0.2, 0.2), rand(0.4, 0.7), 0), gravity: -0.05, size: rand(0.1, 0.16), decay: 0.6, color: 0xff5a64 });
}
function notes(pos, n = 3, color = 0xffe08a) {
  for (let i = 0; i < n; i++) emit(TEX.note, pos.clone().add(v3(rand(-0.1, 0.1), i * 0.05, 0)), { vel: v3(rand(-0.25, 0.25), rand(0.4, 0.7), 0), gravity: -0.05, size: rand(0.14, 0.2), decay: 0.55, color, flutter: 1.5 });
}
function say(pos, text, color = '#fbf3e6') {
  emit(textSpriteTexture(text, color), pos.clone().add(v3(0, 0.15, 0)), { vel: v3(0, 0.35, 0), gravity: 0, size: 0.16, aspect: 4, decay: 0.45 });
}
function puff(pos, n = 14, spread = 0.25) {
  for (let i = 0; i < n; i++) emit(TEX.flake, pos.clone().add(v3(rand(-spread, spread), 0, rand(-spread, spread))), { vel: v3(rand(-0.6, 0.6), rand(0.3, 1.2), rand(-0.6, 0.6)), gravity: 2, size: rand(0.04, 0.09), decay: 0.9 });
}
function snowFall(pos, n = 18, spread = 0.6) {
  for (let i = 0; i < n; i++) emit(TEX.flake, pos.clone().add(v3(rand(-spread, spread), rand(-spread, spread), rand(-spread, spread))), { vel: v3(rand(-0.2, 0.2), rand(-0.3, 0.2), rand(-0.2, 0.2)), gravity: 1.2, size: rand(0.03, 0.08), decay: 0.5, windy: 0.6 });
}
function drops(pos, n = 2, color = 0x9fd0ff) {
  for (let i = 0; i < n; i++) emit(TEX.flake, pos.clone(), { vel: v3(rand(0.1, 0.5), rand(-0.2, 0.1), rand(-0.1, 0.1)), gravity: 6, size: 0.03, decay: 1.4, color });
}
function smoke(pos, power = 1) {
  emit(TEX.smoke, pos.clone().add(v3(rand(-0.03, 0.03), 0, 0)), { vel: v3(rand(-0.05, 0.05), rand(0.35, 0.6) * power, rand(-0.05, 0.05)), gravity: -0.02, size: rand(0.18, 0.3) * power, grow: 3, decay: 0.22, windy: 0.9, opacity: 0.55, color: 0xd8d2e0, spin: rand(-0.5, 0.5) });
}
function confetti(pos, n = 50) {
  const cols = [0xc0262f, 0xf2c35b, 0x4f7fc2, 0x3f8a5c, 0xffffff];
  for (let i = 0; i < n; i++) emitMesh(pick(cols), pos, { vel: v3(rand(-1.2, 1.2), rand(1.5, 3.2), rand(-1.2, 1.2)), gravity: 3.2, decay: 0.45, flutter: 3 });
}
function leaf(pos) {
  emitMesh(pick([0x3f8a5c, 0x2a6142, 0x8a6a3a, 0xb07a3a]), pos, { w: 0.05, h: 0.02, vel: v3(wind.value * 1.5, rand(-0.2, 0.3), rand(-0.3, 0.3)), gravity: 0.25, decay: 0.18, windy: 2.2, flutter: 2 });
}

/* =========================================================
   7 · NIEVE 3D (dos capas: lejana y cercana desenfocada)
   ========================================================= */
const snowLayers = [];

function makeSnowLayer(count, box, size, speed, opacity) {
  const pos = new Float32Array(count * 3);
  const vel = new Float32Array(count);
  const phase = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    pos[i * 3] = rand(box.x0, box.x1);
    pos[i * 3 + 1] = rand(box.y0, box.y1);
    pos[i * 3 + 2] = rand(box.z0, box.z1);
    vel[i] = rand(speed * 0.6, speed * 1.4);
    phase[i] = rand(0, TAU);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const pts = new THREE.Points(geo, new THREE.PointsMaterial({
    size, map: TEX.flake, transparent: true, opacity, depthWrite: false, sizeAttenuation: true, color: 0xffffff,
  }));
  pts.userData.noRay = true;
  pts.frustumCulled = false;
  scene.add(pts);
  snowLayers.push({ pts, pos, vel, phase, box, count });
}

const ray = new THREE.Raycaster();
const pointerNDC = new THREE.Vector2();

function updateSnow(dt, time) {
  const o = ray.ray.origin, d = ray.ray.direction;
  snowLayers.forEach((L, li) => {
    const { pos, vel, phase, box } = L;
    for (let i = 0; i < L.count; i++) {
      const ix = i * 3;
      pos[ix + 1] -= vel[i] * dt;
      pos[ix] += (wind.value * 1.6 + Math.sin(time * 0.7 + phase[i]) * 0.25) * dt;
      pos[ix + 2] += Math.cos(time * 0.5 + phase[i]) * 0.1 * dt;
      // los copos cercanos se apartan del cursor
      if (li === 1 && mouse.inside) {
        const px = pos[ix] - o.x, py = pos[ix + 1] - o.y, pz = pos[ix + 2] - o.z;
        const t = px * d.x + py * d.y + pz * d.z;
        const cx = px - d.x * t, cy = py - d.y * t, cz = pz - d.z * t;
        const dist = Math.sqrt(cx * cx + cy * cy + cz * cz);
        if (dist < 0.6 && dist > 0.001) {
          const f = ((0.6 - dist) / 0.6) * 4 * dt;
          pos[ix] += (cx / dist) * f;
          pos[ix + 1] += (cy / dist) * f;
          pos[ix + 2] += (cz / dist) * f;
        }
      }
      if (pos[ix + 1] < box.y0) { pos[ix + 1] = box.y1; pos[ix] = rand(box.x0, box.x1); }
      if (pos[ix] > box.x1) pos[ix] = box.x0;
      if (pos[ix] < box.x0) pos[ix] = box.x1;
    }
    L.pts.geometry.attributes.position.needsUpdate = true;
  });
}

/* =========================================================
   8 · VIENTO
   ========================================================= */
function updateWind(time, dt) {
  const gust = 0.5 * Math.sin(time * 0.33) + 0.3 * Math.sin(time * 0.83 + 1.3) + 0.2 * Math.sin(time * 2.1 + 0.4);
  let target = 0.25 + gust * 0.6 + clamp(mouse.vx * 0.05, -1.3, 1.3);
  wind.value = lerp(wind.value, target, 0.03);
  const strength = Math.abs(wind.value);
  const calm = 0.3 + strength;
  const s = (ph, sp = 1) => Math.sin(time * 2.4 * sp + ph);

  // árbol de Navidad, pinos, bolas, bombillas, casita, corona, acebo y hierba
  R.tree.sway.rotation.z = -wind.value * 0.05 - s(0) * 0.012 * calm;
  R.tree.sway.rotation.x = s(1.3, 0.7) * 0.008 * calm;
  R.pines.forEach((p) => { p.sway.rotation.z = -wind.value * 0.035 - s(p.phase, 0.8) * 0.01 * calm; });
  R.ornaments.forEach((o) => {
    o.pivot.rotation.z = -wind.value * 0.25 + s(o.phase, 1.3) * 0.08 * calm;
    o.pivot.rotation.x = s(o.phase + 1, 1.1) * 0.06 * calm;
  });
  R.eaveLights.forEach((l) => { l.pivot.rotation.z = -wind.value * 0.4 + s(l.phase, 1.4) * 0.1 * calm; });
  R.birdhouse.wind.rotation.z = -wind.value * 0.12 + s(0.5, 0.8) * 0.04;
  R.wreath.wind.rotation.z = -wind.value * 0.03 + s(2, 0.6) * 0.012;
  R.holly.leaves.rotation.z = -wind.value * 0.06 + s(3, 1.8) * 0.03 * calm;
  R.grass.forEach((g) => {
    let push = 0;
    if (mouse.inside && cursorPoint) {
      const dd = Math.hypot(g.x - cursorPoint.x, g.z - cursorPoint.z);
      if (dd < 0.8) push = Math.sign(g.x - cursorPoint.x || 1) * (1 - dd / 0.8) * 0.6;
    }
    g.bend = lerp(g.bend, push, 0.12);
    g.tuft.rotation.z = -wind.value * 0.3 - s(g.phase, 2) * 0.08 * calm - g.bend;
  });

  // humo continuo y efectos de ráfaga
  if (Math.random() < 0.18) smoke(worldOf(R.chimney.inner, R.chimney.top));
  if (strength > 0.6) {
    if (Math.random() < 0.3) leaf(worldOf(R.tree.tree, v3(rand(-0.6, 0.6), rand(0.3, 1.9), rand(-0.6, 0.6))));
    if (Math.random() < 0.2) leaf(worldOf(pick(R.pines).inner, v3(0, rand(1, 3), 0)));
    if (Math.random() < 0.4) snowFall(worldOf(R.shed, v3(rand(-2, 2), 3.3, rand(0, 1.4))), 2, 0.2);
  } else if (Math.random() < 0.02) {
    leaf(worldOf(R.tree.tree, v3(rand(-0.6, 0.6), rand(0.3, 1.9), rand(-0.6, 0.6))));
  }
}

/* =========================================================
   9 · VIDA PROPIA DE LOS ANIMALES
   ========================================================= */
function angleLerp(a, b, t) {
  let d = ((b - a + Math.PI) % TAU + TAU) % TAU - Math.PI;
  return a + d * t;
}

// ---- Ciervo: pasea, pasta y mira alrededor
function deerNextAction() {
  const d = R.deer;
  if (d.paused) { later('deer', deerNextAction, 1500); return; }
  const r = Math.random();
  if (r < 0.45) {
    d.target = rand(-3.2, 0.4);
    d.mode = 'walk';
    setDeerGraze(false);
  } else if (r < 0.8) {
    d.mode = 'graze';
    setDeerGraze(true);
    later('deer', deerNextAction, rand(2500, 4500));
  } else {
    d.mode = 'idle';
    setDeerGraze(false);
    wobble(d.head.rotation, 'y', 0.5, 1800, 1);
    later('deer', deerNextAction, rand(2000, 3500));
  }
}

function setDeerGraze(on) {
  tweenTo(R.deer.neck.rotation, 'z', on ? -1.15 : 0, 1300, { ease: ease.inOutSine });
}

function updateDeer(dt, time) {
  const d = R.deer;
  let facing = -Math.PI / 2 + 0.5;
  if (d.mode === 'walk' && !d.paused) {
    const dir = Math.sign(d.target - d.x);
    d.x += dir * 0.45 * dt;
    d.walkT += dt * 7;
    facing = dir > 0 ? 0 : Math.PI;
    if (Math.abs(d.target - d.x) < 0.05) {
      d.mode = 'idle';
      later('deer', deerNextAction, rand(1500, 3000));
    }
  }
  const walking = d.mode === 'walk' && !d.paused;
  d.legs.forEach((leg, i) => {
    const target = walking ? Math.sin(d.walkT + (i % 2 ? Math.PI : 0) + (i > 1 ? Math.PI / 2 : 0)) * 0.45 : 0;
    leg.rotation.z = lerp(leg.rotation.z, target, 0.3);
  });
  d.body.position.y = walking ? Math.abs(Math.sin(d.walkT)) * 0.025 : 0;
  d.root.position.x = d.x;
  d.root.rotation.y = angleLerp(d.root.rotation.y, facing, 0.06);
  d.tail.rotation.z = Math.sin(time * 9) * (Math.sin(time * 0.7) > 0.85 ? 0.4 : 0.02);
}

// ---- Zorro: cruza el bosque y desaparece detrás de la caseta
function foxStart() {
  const f = R.fox;
  f.active = true;
  f.x = 9;
}

function updateFox(dt) {
  const f = R.fox;
  if (!f.active) return;
  if (!f.paused) {
    f.x -= 1.5 * dt;
    f.t += dt * 13;
    if (f.x < -10) {
      f.active = false;
      later('fox', foxStart, rand(14000, 22000));
    }
  }
  const trot = f.active && !f.paused;
  f.legs.forEach((leg, i) => {
    const target = trot ? Math.sin(f.t + (i % 2 ? Math.PI : 0) + (i > 1 ? Math.PI / 2 : 0)) * 0.7 : 0;
    leg.rotation.z = lerp(leg.rotation.z, target, 0.35);
  });
  f.body.position.y = trot ? Math.abs(Math.sin(f.t)) * 0.03 : 0;
  f.tail.rotation.y = Math.sin(f.t * (f.paused ? 0.9 : 0.25)) * (f.paused ? 0.5 : 0.15);
  f.root.position.x = f.x;
}

// ---- Conejo: da saltitos por la nieve
function rabbitWander() {
  const r = R.rabbit;
  if (!r.paused) {
    const from = r.x;
    const to = clamp(from + rand(-0.6, 0.6), -0.8, 0.6);
    r.x = to;
    const facing = to > from ? -0.4 : Math.PI + 0.4;
    tweenTo(r.root.rotation, 'y', r.root.rotation.y + ((((facing - r.root.rotation.y + Math.PI) % TAU) + TAU) % TAU - Math.PI), 300);
    run(1000, (e, p) => {
      r.root.position.x = r.baseX + lerp(from, to, e);
      r.root.position.y = Math.abs(Math.sin(p * Math.PI * 2)) * 0.16;
    }, { ease: ease.inOutSine, done: () => puff(r.root.position.clone(), 6, 0.1) });
  }
  later('rabbit', rabbitWander, rand(4000, 8000));
}

// ---- Gorrión y petirrojo: saltitos y picoteos
function hopBird(bird) {
  if (bird.paused) return;
  const from = bird.root.position.clone();
  const to = bird.base.clone().add(v3(rand(-0.3, 0.3), 0, rand(-0.2, 0.2)));
  run(320, (e, p) => {
    bird.root.position.lerpVectors(from, to, e);
    bird.root.position.y = Math.sin(p * Math.PI) * 0.08;
  });
}
function peck(bird) {
  wobble(bird.head.rotation, 'z', -0.7, 600, 2);
}

function groundBirdsLife() {
  [R.sparrow, R.robin].forEach((b) => {
    if (b.paused) return;
    const r = Math.random();
    if (r < 0.45) hopBird(b);
    else if (r < 0.8) peck(b);
    else b.wings.forEach((w, i) => wobble(w.rotation, 'x', i ? -0.8 : 0.8, 400, 3));
  });
  later('groundBirds', groundBirdsLife, rand(1500, 3200));
}

// ---- Ardilla, arrendajo, cardenal y carbonero: pequeños gestos
function smallCreaturesLife() {
  const r = Math.random();
  if (r < 0.3 && !R.squirrel.paused) {
    wobble(R.squirrel.acorn.position, 'y', 0.06, 900, 3);
    for (let i = 0; i < 3; i++) emit(TEX.flake, worldOf(R.squirrel.head, v3(0.08, -0.02, 0)), { vel: v3(rand(-0.2, 0.2), 0, 0), gravity: 2, size: 0.02, decay: 1, color: 0x7a5030 });
  } else if (r < 0.5) {
    wobble(R.jay.head.rotation, 'z', 0.4, 700, 1.5);
    R.jay.wings.forEach((w, i) => wobble(w.rotation, 'x', i ? -0.6 : 0.6, 450, 3));
  } else if (r < 0.75 && !R.cardinal.flying) {
    run(420, (e, p) => { R.cardinal.root.position.y = R.cardinal.base.y + Math.sin(p * Math.PI) * 0.08; });
  } else {
    wobble(R.chickadee.head.rotation, 'y', 0.8, 900, 1.5);
  }
  wobble(R.squirrel.tail.rotation, 'z', 0.12, 900, 2);
  later('smallLife', smallCreaturesLife, rand(1500, 3200));
}

// ---- Parpadeo y respiración
function blinkSomeone() {
  const eyes = pick(blinkers);
  eyes.forEach((e) => { e.scale.y = 0.1; });
  later('unblink', () => eyes.forEach((e) => { e.scale.y = 1; }), 130);
  later('blink', blinkSomeone, rand(350, 1200));
}

function updateBreathing(time) {
  breathers.forEach((b, i) => {
    const k = 1 + Math.sin(time * b.speed + i) * b.amp;
    b.obj.scale.set(1, k, 1 + (k - 1) * 0.6);
  });
}

// ---- Las cabezas siguen al cursor (en 3D)
const qTmp = new THREE.Quaternion();
const eTmp = new THREE.Euler();
const hTmp = new THREE.Vector3();
function updateHeads() {
  heads.forEach((h) => {
    let target = 0;
    if (mouse.inside && cursorPoint) {
      h.obj.getWorldPosition(hTmp);
      const dx = cursorPoint.x - hTmp.x;
      const dz = cursorPoint.z - hTmp.z;
      const worldYaw = Math.atan2(-dz, dx);
      h.obj.parent.getWorldQuaternion(qTmp);
      eTmp.setFromQuaternion(qTmp, 'YXZ');
      let local = worldYaw - eTmp.y;
      local = ((local + Math.PI) % TAU + TAU) % TAU - Math.PI;
      target = clamp(local, -h.max, h.max) * h.weight;
    }
    const busy = h.obj.rotation.__tw && h.obj.rotation.__tw.y && h.obj.rotation.__tw.y.alive;
    if (!busy) {
      h.obj.rotation.y = lerp(h.obj.rotation.y, target, 0.08);
    }
  });
}

// ---- Bandada cruzando el cielo
function flyFlock() {
  const f = R.flock;
  f.visible = true;
  const dir = Math.random() < 0.5 ? 1 : -1;
  const y = rand(9, 14);
  f.rotation.y = dir > 0 ? 0 : Math.PI;
  run(18000, (e) => {
    f.position.set(lerp(-34 * dir, 34 * dir, e), y + e * 2, -26);
  }, { ease: ease.linear, done: () => { f.visible = false; } });
  later('flock', flyFlock, rand(24000, 34000));
}

function updateFlock(time) {
  if (!R.flock.visible) return;
  R.flockBirds.forEach((b) => {
    const a = Math.sin(time * 10 + b.phase) * 0.6;
    b.l.rotation.z = a;
    b.r.rotation.z = -a;
  });
}

/* =========================================================
   10 · REACCIONES 3D (hover por raycasting)
   Cada objeto tiene su función de entrada y de salida.
   ========================================================= */
let starBoost = 0;
let treeChaseUntil = 0;
let eaveChaseUntil = 0;

const REACTIONS = {
  moon: {
    enter() { scaleTo(R.moonGlow, 14, 600); starBoost = 1; sparks(worldOf(R.moon), 12, 2); },
    leave() { scaleTo(R.moonGlow, 9, 600); starBoost = 0; },
  },
  pine: {
    enter(obj) {
      const p = obj.userData.pine;
      wobble(p.inner.rotation, 'z', 0.07, 1000, 4);
      snowFall(worldOf(p.inner, v3(0, p.h * 0.6, 0)), 30, 0.8);
    },
    leave() {},
  },
  deer: {
    enter() {
      const d = R.deer;
      d.paused = true;
      setDeerGraze(false);
      tweenTo(d.neck.rotation, 'z', 0.25, 500);
      d.ears.forEach((e, i) => wobble(e.rotation, 'x', i ? -0.5 : 0.5, 700, 3));
      wobble(d.tail.rotation, 'z', 0.6, 800, 4);
      hearts(worldOf(d.head, v3(0, 0.25, 0)), 4);
      say(worldOf(d.head, v3(0, 0.35, 0)), '¡hola!');
    },
    leave() {
      const d = R.deer;
      d.paused = false;
      tweenTo(d.neck.rotation, 'z', 0, 600);
    },
  },
  fox: {
    enter() { R.fox.paused = true; say(worldOf(R.fox.head, v3(0, 0.25, 0)), '¡yip!', '#ffd2a8'); },
    leave() { R.fox.paused = false; },
  },
  chimney: {
    enter() {
      wobble(R.chimney.inner.rotation, 'z', 0.06, 600, 5);
      const top = worldOf(R.chimney.inner, R.chimney.top);
      for (let i = 0; i < 12; i++) later('smk' + i, () => smoke(top, 1.8), i * 50);
      say(top.clone().add(v3(0.3, 0.2, 0)), '¡puf!');
    },
    leave() {},
  },
  roofSnow: {
    enter() {
      const c = R.roofChunk;
      if (c.sliding) return;
      c.sliding = true;
      run(900, (e) => {
        c.inner.position.z = e * 0.85;
        c.inner.position.y = -e * 0.85 * Math.tan(c.slope);
      }, { ease: (p) => p * p, done: () => {
        snowFall(worldOf(c.inner, v3(0, 2.4, 1.6)), 40, 0.4);
        c.inner.visible = false;
        later('chunkBack', () => {
          c.inner.position.set(0, 0, 0);
          c.inner.scale.setScalar(0.001);
          c.inner.visible = true;
          scaleTo(c.inner, 1, 1500, { done: () => { c.sliding = false; } });
        }, 2500);
      } });
    },
    leave() {},
  },
  eave: {
    enter() {
      eaveChaseUntil = performance.now() + 3000;
      R.icicles.forEach((ic, i) => wobble(ic.mesh.rotation, 'z', 0.12, 500, 3, { delay: i * 25 }));
      every('drip', () => {
        const ic = pick(R.icicles);
        drops(worldOf(R.shed, ic.tip), 1, 0xcfe6fb);
      }, 90);
    },
    leave() { stopEvery('drip'); },
  },
  birdhouse: {
    enter() {
      wobble(R.birdhouse.root.rotation, 'z', 0.35, 1200, 2);
      scaleTo(R.birdhouse.peek, 1, 400, { ease: ease.outBack });
      say(worldOf(R.birdhouse.root, v3(0, -0.2, 0.2)), '¡pi-pío!');
    },
    leave() { scaleTo(R.birdhouse.peek, 0.001, 300); },
  },
  jay: {
    enter() {
      const j = R.jay;
      const from = j.base.clone();
      run(900, (e, p) => {
        const dz = -e * 0.35;
        j.root.position.set(from.x + e * 0.4, from.y - dz * Math.tan(j.slope) + Math.abs(Math.sin(p * Math.PI * 3)) * 0.1, from.z + dz);
      });
      j.wings.forEach((w, i) => wobble(w.rotation, 'x', i ? -0.9 : 0.9, 800, 5));
      say(worldOf(j.head, v3(0, 0.15, 0)), '¡crá, crá!', '#cfe0ff');
    },
    leave() {
      const j = R.jay;
      const from = j.root.position.clone();
      run(700, (e) => j.root.position.lerpVectors(from, j.base, e));
    },
  },
  window: {
    enter() {
      tweenTo(R.window.light, 'intensity', 2.2, 500);
      R.window.interiorMat.color.set(0xffffff);
      R.window.wave = run(1e9, (e, p) => { R.window.teddyArm.rotation.z = -0.4 - Math.abs(Math.sin(performance.now() / 160)) * 1.1; }, { ease: ease.linear });
      hearts(worldOf(R.window.teddy, v3(0, 0.3, 0.2)), 3);
    },
    leave() {
      tweenTo(R.window.light, 'intensity', 0.7, 500);
      R.window.interiorMat.color.set(0x9a8070);
      cancel(R.window.wave);
      tweenTo(R.window.teddyArm.rotation, 'z', -0.4, 300);
    },
  },
  wreath: {
    enter() {
      wobble(R.wreath.root.rotation, 'z', 0.2, 1200, 2.5);
      R.bells.forEach((b, i) => wobble(b.rotation, 'z', 0.7, 1000, 4, { delay: i * 100 }));
      const p = worldOf(R.wreath.root, v3(0, -0.6, 0.1));
      say(p, '¡din don!', '#ffe08a');
      notes(p, 3);
    },
    leave() {},
  },
  rake: {
    enter() {
      wobble(R.rake.inner.rotation, 'z', 0.12, 1100, 2.5);
      wobble(R.rake.tines.scale, 'x', 0.2, 600, 6);
      snowFall(worldOf(R.rake.tines, v3(0, 0.2, 0)), 8, 0.15);
    },
    leave() {},
  },
  shovel: {
    enter() {
      const s = R.shovel;
      run(900, (e, p) => {
        const up = p < 0.5 ? Math.sin(p * Math.PI) : Math.sin(p * Math.PI) * 0.6;
        s.position.y = up * 0.3 - (p > 0.7 ? (p - 0.7) * 0.2 : 0);
        s.rotation.x = -up * 0.3;
      }, { ease: ease.linear, done: () => { s.position.y = 0; s.rotation.x = 0; puff(worldOf(s, v3(0, 0.02, 0)), 18, 0.15); } });
    },
    leave() {},
  },
  mousePot: {
    enter() {
      const m = R.mousePot;
      tweenTo(m.pot.position, 'y', 0.22, 400, { ease: ease.outBack });
      tweenTo(m.pot.rotation, 'z', 0.35, 400);
      scaleTo(m.mouse, 1, 450, { ease: ease.outBack, delay: 150 });
      say(worldOf(m.mouse, v3(0, 0.25, 0)), '¡hola!');
    },
    leave() {
      const m = R.mousePot;
      tweenTo(m.pot.position, 'y', 0, 350);
      tweenTo(m.pot.rotation, 'z', 0, 350);
      scaleTo(m.mouse, 0.001, 250);
    },
  },
  musicBox: {
    enter() {
      const m = R.musicBox;
      tweenTo(m.lid.rotation, 'x', -1.7, 500, { ease: ease.outBack });
      scaleTo(m.star, 1, 500, { ease: ease.outBack });
      tweenTo(m.star.position, 'y', 0.32, 500);
      m.spin = run(1e9, () => { m.star.rotation.y += 0.05; }, { ease: ease.linear });
      every('music', () => notes(worldOf(m.star, v3(0, 0.1, 0)), 1), 300);
    },
    leave() {
      const m = R.musicBox;
      tweenTo(m.lid.rotation, 'x', 0, 400);
      scaleTo(m.star, 0.001, 300);
      tweenTo(m.star.position, 'y', 0.12, 300);
      cancel(m.spin);
      stopEvery('music');
    },
  },
  seedBag: {
    enter() {
      const s = R.seedBag;
      tweenTo(s.inner.rotation, 'z', -0.5, 500);
      scaleTo(s.sprout, 1, 900, { ease: ease.outBack, delay: 300 });
      every('seeds', () => {
        for (let i = 0; i < 2; i++) emit(TEX.flake, worldOf(s.inner, s.mouth), { vel: v3(rand(0.2, 0.6), 0, rand(-0.1, 0.1)), gravity: 3, size: 0.025, decay: 1, color: pick([0xf2c35b, 0xffe9a8]) });
      }, 60);
      later('seedsStop', () => stopEvery('seeds'), 800);
    },
    leave() {
      tweenTo(R.seedBag.inner.rotation, 'z', 0, 400);
      scaleTo(R.seedBag.sprout, 0.001, 300);
      stopEvery('seeds');
    },
  },
  pots: {
    enter(obj) {
      R.pots.forEach((p, i) => wobble(p.rotation, 'z', 0.2, 500, 3, { delay: i * 130 }));
      say(worldOf(obj, v3(0, 0.4, 0)), '¡clin!');
    },
    leave() {},
  },
  can: {
    enter() {
      const c = R.can;
      tweenTo(c.inner.rotation, 'z', -0.5, 500);
      every('pour', () => drops(worldOf(c.body, c.spout), 2), 50);
    },
    leave() {
      tweenTo(R.can.inner.rotation, 'z', 0, 400);
      stopEvery('pour');
    },
  },
  holly: {
    enter() {
      wobble(R.holly.leaves.rotation, 'y', 0.3, 800, 3);
      for (let i = 0; i < 4; i++) emit(TEX.flake, worldOf(R.holly.leaves, v3(rand(-0.1, 0.1), 0.2, rand(-0.1, 0.1))), { vel: v3(rand(-0.3, 0.3), 0.4, rand(-0.3, 0.3)), gravity: 3, size: 0.04, decay: 0.9, color: 0xd0262f });
    },
    leave() {},
  },
  chickadee: {
    enter() {
      const c = R.chickadee;
      run(450, (e, p) => { c.root.position.y = c.base.y + Math.sin(p * Math.PI) * 0.12; c.root.position.x = c.base.x - e * 0.08; });
      wobble(c.head.rotation, 'z', -0.8, 900, 3, { delay: 450 });
      say(worldOf(c.head, v3(0, 0.12, 0)), '¡chic-a-dí!');
    },
    leave() {
      const c = R.chickadee;
      run(400, (e) => { c.root.position.x = lerp(c.base.x - 0.08, c.base.x, e); });
    },
  },
  jackGift: {
    enter() {
      const g = R.jackGift;
      tweenTo(g.lid.rotation, 'x', -1.9, 450, { ease: ease.outBack });
      tweenTo(g.jack.scale, 'y', 1, 700, { ease: ease.outBack, delay: 150 });
      sparks(worldOf(g.root, v3(0, 0.6, 0)), 18, 1.6);
      say(worldOf(g.root, v3(0, 0.75, 0)), 'ilusión', '#ffd27a');
    },
    leave() {
      const g = R.jackGift;
      tweenTo(g.jack.scale, 'y', 0.001, 300);
      tweenTo(g.lid.rotation, 'x', 0, 400, { delay: 150 });
    },
  },
  confettiGift: {
    enter() {
      const g = R.confettiGift;
      if (g.flying) return;
      g.flying = true;
      run(900, (e, p) => {
        g.lid.position.y = g.bodyH + Math.sin(p * Math.PI) * 0.5;
        g.lid.rotation.y = e * TAU;
        g.lid.rotation.x = Math.sin(p * Math.PI) * -0.6;
      }, { ease: ease.linear, done: () => { g.lid.position.y = g.bodyH; g.lid.rotation.set(0, 0, 0); g.flying = false; } });
      confetti(worldOf(g.root, v3(0, 0.25, 0)), 60);
      say(worldOf(g.root, v3(0, 0.6, 0)), '¡fiesta!', '#ffe08a');
    },
    leave() {},
  },
  squirrel: {
    enter() {
      const s = R.squirrel;
      s.paused = true;
      scaleTo(s.acorn, 0.001, 200);
      scaleTo(s.mini, 1, 400, { ease: ease.outBack, delay: 150 });
      tweenTo(s.mini.position, 'y', 0.3, 400, { delay: 150 });
      wobble(s.tail.rotation, 'z', 0.25, 900, 3);
      sparks(worldOf(s.head, v3(0.1, 0.05, 0)), 10, 1);
    },
    leave() {
      const s = R.squirrel;
      s.paused = false;
      scaleTo(s.acorn, 1, 300, { delay: 150 });
      scaleTo(s.mini, 0.001, 250);
      tweenTo(s.mini.position, 'y', 0.15, 250);
    },
  },
  tree: {
    enter() {
      treeChaseUntil = performance.now() + 4000;
      R.ornaments.forEach((o, i) => wobble(o.pivot.rotation, 'x', 0.5, 900, 3, { delay: i * 40 }));
      wobble(R.tree.tree.rotation, 'y', 0.06, 900, 2);
    },
    leave() {},
  },
  treeStar: {
    enter() {
      tweenTo(R.star.rotation, 'y', R.star.rotation.y + TAU, 900, { ease: ease.outBack });
      scaleTo(R.star, 1.35, 500, { ease: ease.outBack });
      scaleTo(R.starGlow, 2.2, 500);
      sparks(worldOf(R.star), 26, 2.2);
    },
    leave() {
      scaleTo(R.star, 1, 400);
      scaleTo(R.starGlow, 1.1, 400);
    },
  },
  cardinal: {
    enter() {
      const c = R.cardinal;
      if (c.flying) return;
      c.flying = true;
      const b = c.base;
      run(2400, (e, p) => {
        const a = p * TAU;
        c.root.position.set(b.x + Math.sin(a) * 0.9, b.y + Math.sin(p * Math.PI) * 1.1, b.z + (1 - Math.cos(a)) * 0.6);
        c.root.rotation.y = -2.3 - a;
        c.wings.forEach((w, i) => { w.rotation.x = Math.sin(p * 90) * (i ? -1 : 1) * 0.9; });
      }, { ease: ease.inOutSine, done: () => { c.root.position.copy(b); c.root.rotation.y = -2.3; c.wings.forEach((w) => { w.rotation.x = 0; }); c.flying = false; } });
      notes(worldOf(c.head), 3, 0xff8a8a);
    },
    leave() {},
  },
  rabbit: {
    enter() {
      const r = R.rabbit;
      r.paused = true;
      r.ears.forEach((e, i) => tweenTo(e.rotation, 'z', 0.3, 300));
      run(950, (e, p) => {
        r.root.position.y = Math.abs(Math.sin(p * Math.PI * 2)) * (p < 0.5 ? 0.35 : 0.15);
      }, { ease: ease.linear, done: () => puff(r.root.position.clone(), 16, 0.15) });
    },
    leave() {
      const r = R.rabbit;
      r.paused = false;
      r.ears.forEach((e) => tweenTo(e.rotation, 'z', -0.15, 300));
    },
  },
  sparrow: {
    enter() {
      const s = R.sparrow;
      s.paused = true;
      cancel(s.back);
      const from = s.root.position.clone();
      run(1100, (e) => {
        s.root.position.set(from.x + e * 2.5, from.y + e * 3, from.z - e * 2);
        s.wings.forEach((w, i) => { w.rotation.x = Math.sin(e * 60) * (i ? -1 : 1) * 1.1; });
      }, { ease: (p) => p * p });
      scaleTo(s.root, 0.001, 1100);
      puff(from, 8, 0.1);
    },
    leave() {
      const s = R.sparrow;
      later('sparrowBack', () => {
        s.root.position.copy(s.base).add(v3(0, 1.5, 0));
        scaleTo(s.root, 1, 600);
        s.back = run(800, (e) => { s.root.position.y = s.base.y + (1 - e) * 1.5; s.wings.forEach((w, i) => { w.rotation.x = Math.sin(e * 40) * (i ? -1 : 1) * (1 - e); }); }, { done: () => { s.paused = false; } });
      }, 900);
    },
  },
  robin: {
    enter() {
      const r = R.robin;
      r.paused = true;
      const from = r.root.position.clone();
      run(700, (e, p) => {
        r.root.position.set(from.x - e * 0.35, Math.abs(Math.sin(p * Math.PI * 2)) * 0.08, from.z + e * 0.1);
      });
      say(worldOf(r.head, v3(0, 0.15, 0)), '¡pío!', '#ff9a7a');
    },
    leave() {
      const r = R.robin;
      const from = r.root.position.clone();
      run(600, (e) => r.root.position.lerpVectors(from, r.base, e), { done: () => { r.paused = false; } });
    },
  },
  sack: {
    enter() {
      wobble(R.sack.inner.rotation, 'z', 0.08, 700, 3);
      tweenTo(R.sack.peek.position, 'y', 0.97, 400, { ease: ease.outBack });
    },
    leave() { tweenTo(R.sack.peek.position, 'y', 0.82, 300); },
  },
  fallingGift: {
    enter(obj) {
      const g = obj.userData.gift;
      tweenTo(g.lid.rotation, 'x', -1.8, 400, { ease: ease.outBack });
      sparks(worldOf(g.root, v3(0, g.h, 0)), 12, 1.2);
      say(worldOf(g.root, v3(0, g.h + 0.2, 0)), g.word, '#ffd27a');
      if (g.settled) { g.vel.y = 2.4; g.settled = false; }
    },
    leave(obj) { tweenTo(obj.userData.gift.lid.rotation, 'x', 0, 400); },
  },
};

/* ---------- Raycasting: qué objeto 3D hay bajo el cursor ---------- */
let rayTargets = [];
let hovered = null;
let cursorPoint = null;
let cursorHit = null;

// Solo proyectan sombra las piezas que se notan (rendimiento)
function optimizeShadows() {
  const sphere = new THREE.Sphere();
  const sc = new THREE.Vector3();
  let casters = 0;
  scene.updateMatrixWorld(true);
  scene.traverse((o) => {
    if (!o.isMesh || !o.castShadow) return;
    if (!o.geometry.boundingSphere) o.geometry.computeBoundingSphere();
    sphere.copy(o.geometry.boundingSphere);
    o.getWorldScale(sc);
    const radius = sphere.radius * Math.max(sc.x, sc.y, sc.z);
    o.getWorldPosition(sc);
    if (radius < 0.05 || sc.z < -8.5) o.castShadow = false;
    else casters++;
  });
  return casters;
}

// Si el ordenador va justo, se reduce la calidad automáticamente
const perf = { frames: 0, time: 0, checked: false };
function adaptQuality(dt) {
  if (perf.checked) return;
  perf.frames++;
  perf.time += dt;
  if (perf.time > 4) {
    perf.checked = true;
    const fps = perf.frames / perf.time;
    if (fps < 40) {
      lights.cursor.castShadow = false;
      renderer.setPixelRatio(1);
      renderer.setSize(W, H, false);
    }
    if (fps < 25) {
      lights.key.shadow.mapSize.set(1024, 1024);
      lights.key.shadow.map && lights.key.shadow.map.dispose();
      lights.key.shadow.map = null;
    }
  }
}

function collectRayTargets() {
  rayTargets = [];
  scene.traverse((o) => {
    if (o.isMesh && !o.userData.noRay) rayTargets.push(o);
  });
  // la escena fija (suelo, caseta, árbol, banco…) sirve de "suelo" para los regalos que caen;
  // se excluyen piezas finas como la hierba, los carámbanos o los cables de luces
  const noCollide = (o) => { for (; o; o = o.parent) if (o.userData.noCollide) return true; return false; };
  staticColliders = rayTargets.filter((o) => !noCollide(o));
}

function reactOwner(obj) {
  while (obj) {
    if (obj.userData && obj.userData.react) return obj;
    obj = obj.parent;
  }
  return null;
}

function updateHover() {
  if (!mouse.inside) {
    if (hovered) setHovered(null);
    return;
  }
  pointerNDC.set((mouse.x / W) * 2 - 1, -(mouse.y / H) * 2 + 1);
  ray.setFromCamera(pointerNDC, camera);
  if (!mouse.moved) return;
  mouse.moved = false;
  const hits = ray.intersectObjects(rayTargets, false);
  if (hits.length) {
    cursorHit = hits[0];
    cursorPoint = hits[0].point.clone();
    setHovered(reactOwner(hits[0].object));
  } else {
    cursorHit = null;
    cursorPoint = ray.ray.at(10, new THREE.Vector3());
    setHovered(null);
  }
}

function setHovered(obj) {
  if (obj === hovered) return;
  if (hovered) REACTIONS[hovered.userData.react].leave(hovered);
  hovered = obj;
  if (hovered) {
    REACTIONS[hovered.userData.react].enter(hovered);
    tooltip.textContent = hovered.userData.label;
    tooltip.style.opacity = '1';
    setCursorScale(1.7);
  } else {
    tooltip.style.opacity = '0';
    setCursorScale(1);
  }
}

/* =========================================================
   11 · REGALOS QUE CAEN (física sencilla en 3D)
   ========================================================= */
const fallingGifts = [];
const GIFT_WORDS = ['risas', 'ilusión', 'juego', 'abrazos', 'magia', 'sueños', 'alegría', 'calor', 'amigos', 'cuentos', 'futuro'];

let staticColliders = [];
const downRay = new THREE.Raycaster();
const DOWN = new THREE.Vector3(0, -1, 0);

// Primera superficie fija justo debajo de (x, fromY, z): su altura y su inclinación
function surfaceBelow(x, fromY, z) {
  downRay.set(v3(x, fromY, z), DOWN);
  downRay.far = fromY + 5;
  const hit = downRay.intersectObjects(staticColliders, false)[0];
  if (!hit) return { y: 0, normal: v3(0, 1, 0) };
  const normal = hit.face ? hit.face.normal.clone().transformDirection(hit.object.matrixWorld) : v3(0, 1, 0);
  if (normal.y < 0) normal.negate();
  return { y: hit.point.y, normal };
}

// Suelo bajo toda la base del regalo (centro + 6 puntos del borde): así
// ninguna esquina se hunde en el tejado, el banco o el borde de un montículo
const FOOT = Array.from({ length: 6 }, (_, i) => [Math.cos(i / 6 * TAU), Math.sin(i / 6 * TAU)]);
function footprintFloor(g) {
  const p = g.root.position;
  const from = p.y + g.h * 0.9;
  const center = surfaceBelow(p.x, from, p.z);
  const rr = g.radius * 0.65;
  const samples = FOOT.map(([cx, cz]) => ({ cx, cz, y: surfaceBelow(p.x + cx * rr, from, p.z + cz * rr).y }));
  const y = Math.max(center.y, ...samples.map((s) => s.y));
  // ¿cuelga de un borde? (el centro no apoya y lo que sujeta está todo a un lado)
  let overhang = null;
  if (center.y < y - 0.05) {
    let ax = 0, az = 0, n = 0;
    for (const s of samples) if (s.y > y - 0.04) { ax += s.cx; az += s.cz; n++; }
    ax /= n; az /= n;
    const len = Math.hypot(ax, az);
    if (len > 0.3) overhang = v3(-ax / len, 0, -az / len);   // dirección hacia la que vuelca
  }
  return { y, centerY: center.y, normal: center.normal, overhang };
}

// Choque lateral: un rayo horizontal en la dirección del movimiento, a dos
// alturas; si hay una pared, la chimenea, una pata del banco… el regalo se para ahí
const sideRay = new THREE.Raycaster();
function blockHorizontal(g, prev) {
  const p = g.root.position;
  const mx = p.x - prev.x, mz = p.z - prev.z;
  const len = Math.hypot(mx, mz);
  if (len < 1e-5) return;
  const dir = v3(mx / len, 0, mz / len);
  let best = null;
  const reach = g.radius / 0.85;            // media diagonal completa: ninguna esquina entra en la pared
  for (const hFrac of [0.25, 0.75]) {
    sideRay.set(v3(prev.x, prev.y + g.h * hFrac, prev.z), dir);
    sideRay.far = len + reach;
    for (const hit of sideRay.intersectObjects(staticColliders, false)) {
      const n = hit.face ? hit.face.normal.clone().transformDirection(hit.object.matrixWorld) : dir.clone().negate();
      if (Math.abs(n.y) > 0.7) continue;   // suelos y tejados los gestiona footprintFloor
      if (!best || hit.distance < best.d) best = { d: hit.distance, n };
      break;
    }
  }
  if (!best) return;
  const allowed = Math.max(0, best.d - reach);
  p.x = prev.x + dir.x * allowed;
  p.z = prev.z + dir.z * allowed;
  // quita la velocidad que va contra la pared (con un pequeño rebote)
  const nh = v3(best.n.x, 0, best.n.z).normalize();
  const vn = g.vel.x * nh.x + g.vel.z * nh.z;
  if (vn < 0) { g.vel.x -= nh.x * vn * 1.3; g.vel.z -= nh.z * vn * 1.3; }
}

// Si alguna esquina ha quedado pegada a una pared (p. ej. al caer en vertical
// junto a ella), se le aparta lo justo. Rayos cortos en 8 direcciones.
const PUSH_DIRS = Array.from({ length: 8 }, (_, i) => v3(Math.cos(i / 8 * TAU), 0, Math.sin(i / 8 * TAU)));
function pushOutOfWalls(g) {
  const p = g.root.position;
  const reach = g.radius / 0.85;
  for (const hFrac of [0.2, 0.7]) {
    for (const dir of PUSH_DIRS) {
      sideRay.set(v3(p.x, p.y + g.h * hFrac, p.z), dir);
      sideRay.far = reach;
      const hit = sideRay.intersectObjects(staticColliders, false)[0];
      if (!hit || !hit.face) continue;
      const n = hit.face.normal.clone().transformDirection(hit.object.matrixWorld);
      if (Math.abs(n.y) > 0.7) continue;
      p.x -= dir.x * (reach - hit.distance);
      p.z -= dir.z * (reach - hit.distance);
    }
  }
}

// Techo: si sube (rebote, saco…) no atraviesa el alero ni el banco por debajo
const UP = new THREE.Vector3(0, 1, 0);
function blockCeiling(g, prevY, dt) {
  if (g.vel.y <= 0) return;
  const p = g.root.position;
  sideRay.set(v3(p.x, prevY + g.h * 0.5, p.z), UP);
  sideRay.far = g.h * 0.5 + g.vel.y * dt + 0.02;
  const hit = sideRay.intersectObjects(staticColliders, false)[0];
  if (hit) { p.y = Math.min(p.y, hit.point.y - g.h - 0.01); g.vel.y = -0.2; }
}

function dropGift(x, z, floorY, vel) {
  if (fallingGifts.length >= 16) removeGift(fallingGifts[0]);
  const s = rand(0.22, 0.36);
  const ribbon = pick([ribbonGold(), MAT.red, MAT.cream, MAT.green]);
  const g = makeGift(scene, s * rand(0.9, 1.3), s, s * rand(0.9, 1.2), pick(MAT.papers), ribbon, [x, vel ? floorY + 0.3 : 7, z]);
  g.root.rotation.set(rand(-0.5, 0.5), rand(0, TAU), rand(-0.5, 0.5));
  g.vel = vel || v3(0, 0, 0);
  g.spin = v3(rand(-3, 3), rand(-3, 3), rand(-3, 3));
  // huella circular para chocar con otros regalos (incluye la tapa, algo más ancha)
  g.radius = Math.hypot(g.w, g.d) * 0.5 * 1.07 * 0.85;
  g.floor = 0;
  g.floorAt = null;   // posición (x, z) donde se calculó el suelo fijo
  g.settled = false;
  g.word = pick(GIFT_WORDS);
  g.born = performance.now();
  g.root.userData.gift = g;
  makeReact(g.root, 'fallingGift', 'Un regalo caído del cielo');
  g.root.traverse((o) => { if (o.isMesh) rayTargets.push(o); });
  fallingGifts.push(g);
}

function removeGift(g) {
  scene.remove(g.root);
  const meshes = new Set();
  g.root.traverse((o) => { if (o.isMesh) meshes.add(o); });
  rayTargets = rayTargets.filter((o) => !meshes.has(o));
  const i = fallingGifts.indexOf(g);
  if (i >= 0) fallingGifts.splice(i, 1);
  if (hovered === g.root) setHovered(null);
  // los regalos que estaban apoyados encima vuelven a caer
  fallingGifts.forEach((o) => { if (o.settled) o.settled = false; });
}

const giftTop = (g) => g.root.position.y + g.h * g.root.scale.y;

// Suelo real bajo un regalo: la escena fija o la tapa de otro regalo
function supportFor(g) {
  const p = g.root.position;
  if (!g.floorAt || Math.hypot(p.x - g.floorAt.x, p.z - g.floorAt.z) > 0.03) {
    const s = footprintFloor(g);
    g.floor = s.y;
    g.centerFloor = s.centerY;
    g.floorNormal = s.normal;
    g.overhang = s.overhang;
    g.floorAt = { x: p.x, z: p.z };
  }
  let floor = g.floor;
  g.onGift = false;
  for (const o of fallingGifts) {
    if (o === g || o.tilted) continue;   // sobre un regalo inclinado no se puede apilar
    const top = giftTop(o);
    // solo cuenta si está debajo (su tapa no supera la mitad de este regalo)
    if (top > p.y + g.h * 0.5) continue;
    const dist = Math.hypot(p.x - o.root.position.x, p.z - o.root.position.z);
    if (dist < (g.radius + o.radius) * 0.75 && top > floor) { floor = top; g.onGift = true; }
  }
  return floor;
}

// Los regalos no se atraviesan de lado: se empujan en el plano XZ
function separateGifts() {
  for (let i = 0; i < fallingGifts.length; i++) {
    const a = fallingGifts[i], pa = a.root.position;
    for (let j = i + 1; j < fallingGifts.length; j++) {
      const b = fallingGifts[j], pb = b.root.position;
      // ¿se solapan en altura?
      if (pa.y >= giftTop(b) - 0.02 || pb.y >= giftTop(a) - 0.02) continue;
      let dx = pa.x - pb.x, dz = pa.z - pb.z;
      let dist = Math.hypot(dx, dz);
      const min = a.radius + b.radius;
      if (dist >= min) continue;
      if (dist < 1e-4) { dx = rand(-1, 1); dz = rand(-1, 1); dist = Math.hypot(dx, dz); }
      const push = (min - dist) / dist;
      // el que está quieto se mueve menos
      const wa = a.settled && !b.settled ? 0.15 : b.settled && !a.settled ? 0.85 : 0.5;
      pa.x += dx * push * wa;       pa.z += dz * push * wa;
      pb.x -= dx * push * (1 - wa); pb.z -= dz * push * (1 - wa);
      // si un regalo quieto se desplaza, comprueba de nuevo si sigue apoyado
      if (a.settled && wa > 0.2) a.settled = false;
      if (b.settled && wa < 0.8) b.settled = false;
      // rebote suave entre los dos
      const nx = dx / dist, nz = dz / dist;
      const rel = (a.vel.x - b.vel.x) * nx + (a.vel.z - b.vel.z) * nz;
      if (rel < 0) {
        a.vel.x -= rel * nx * 0.6; a.vel.z -= rel * nz * 0.6;
        b.vel.x += rel * nx * 0.6; b.vel.z += rel * nz * 0.6;
      }
    }
  }
}

function updateGifts(dt) {
  const now = performance.now();
  dt = Math.min(dt, 1 / 30); // evita que atraviesen cosas si un fotograma tarda mucho
  for (let i = fallingGifts.length - 1; i >= 0; i--) {
    const g = fallingGifts[i];
    const age = (now - g.born) / 1000;
    if (age > 12) {
      const k = Math.max(0.001, 1 - (age - 12) * 2);
      g.root.scale.setScalar(k);
      if (k <= 0.001) { removeGift(g); continue; }
    }
  }

  separateGifts();
  // si al separarlos uno se ha metido en una pared, se le frena ahí
  for (const g of fallingGifts) if (g.last) blockHorizontal(g, g.last);

  // de abajo arriba, para que cada regalo vea ya colocado al que tiene debajo
  const order = fallingGifts.slice().sort((a, b) => a.root.position.y - b.root.position.y);
  for (const g of order) {
    const p = g.root.position;
    g.prev = p.clone();
    if (g.settled) {
      // cada medio segundo comprueba que sigue apoyado (p. ej. si un animal se movió)
      if (now - g.checkedAt < 500) continue;
      g.checkedAt = now;
      g.floorAt = null;
      if (supportFor(g) >= p.y - 0.01 && !(g.overhang && !g.onGift)) continue;
      g.settled = false;
    }

    g.vel.y -= 9.8 * dt;
    p.addScaledVector(g.vel, dt);
    blockHorizontal(g, g.prev);
    blockCeiling(g, g.prev.y, dt);
    pushOutOfWalls(g);
    const floor = supportFor(g);
    g.root.rotation.x += g.spin.x * dt;
    g.root.rotation.y += g.spin.y * dt;
    g.root.rotation.z += g.spin.z * dt;

    if (p.y <= floor) {
      const impact = Math.abs(g.vel.y);
      p.y = floor;
      g.vel.y = impact * 0.35;
      g.vel.x *= 0.6;
      g.vel.z *= 0.6;
      g.spin.multiplyScalar(0.5);
      if (impact > 1) puff(p.clone(), 5, 0.1);
      const n = g.floorNormal;
      g.slideTime = (g.slideTime || 0) + dt;
      if (!g.onGift && g.overhang && g.slideTime < 3) {
        // medio regalo en el aire: vuelca y cae por el borde (alero, banco, tejado…)
        g.vel.x += g.overhang.x * 1.5;
        g.vel.z += g.overhang.z * 1.5;
        g.vel.y = Math.min(g.vel.y, 0.3);
        g.spin.x += g.overhang.z * 4;
        g.spin.z -= g.overhang.x * 4;
      } else if (!g.onGift && n && n.y < 0.9 && g.slideTime < 1.5) {
        // superficie inclinada (p. ej. el tejado): resbala cuesta abajo
        g.vel.x += n.x * 9.8 * dt * 2;
        g.vel.z += n.z * 9.8 * dt * 2;
        g.vel.y = Math.min(g.vel.y, 0.5);
      } else if (impact < 0.8 || g.slideTime >= 1.5) {
        g.slideTime = 0;
        g.vel.set(0, 0, 0);
        g.spin.set(0, 0, 0);
        g.settled = true;
        g.checkedAt = now;
        // en una pendiente uniforme se inclina como ella; en una cumbre (el centro es lo más alto) queda recto
        if (!g.onGift && n && n.y < 0.97 && n.y > 0.6 && g.floor - g.centerFloor > 0.03) {
          // apoyado por el centro, siguiendo la pendiente (sin hundirse)
          const yaw = new THREE.Quaternion().setFromAxisAngle(v3(0, 1, 0), g.root.rotation.y);
          g.root.quaternion.setFromUnitVectors(v3(0, 1, 0), n).multiply(yaw);
          p.y = g.centerFloor;
          g.tilted = true;
        } else {
          g.tilted = false;
          tweenTo(g.root.rotation, 'x', 0, 300);
          tweenTo(g.root.rotation, 'z', 0, 300);
        }
      }
    }
  }
  for (const g of fallingGifts) g.last = g.root.position.clone();
}

function spillFromSack() {
  const top = worldOf(R.sack.inner, v3(0, 0.95, 0));
  for (let i = 0; i < 5; i++) {
    dropGift(top.x, top.z, 0, v3(rand(-1.6, -0.4), rand(3, 4.5), rand(0.2, 1.2)));
    fallingGifts[fallingGifts.length - 1].root.position.y = top.y;
  }
  sparks(top, 24, 2);
}

/* =========================================================
   12 · CAPA HTML: titular, palabras, sello, botón y marca
   (estos sí usan mouseenter / mouseleave del DOM)
   ========================================================= */
let letters = [];
const badgeState = { angle: 0, speed: 0.25, targetSpeed: 0.25 };
const ctaState = { x: 0, y: 0, scale: 1, targetScale: 1, cx: 0, cy: 0 };

function toPosterCoords(clientX, clientY) {
  const rect = poster.getBoundingClientRect();
  return { x: (clientX - rect.left) / scale, y: (clientY - rect.top) / scale };
}

function centerOf(el) {
  const r = el.getBoundingClientRect();
  return toPosterCoords(r.left + r.width / 2, r.top + r.height / 2);
}

function splitHeadline() {
  let index = 0;
  headline.querySelectorAll('.line').forEach((line) => {
    const text = line.textContent;
    line.textContent = '';
    [...text].forEach((char) => {
      const outer = document.createElement('span');
      outer.setAttribute('aria-hidden', 'true');
      if (char === ' ') {
        outer.className = 'ch space';
      } else {
        outer.className = 'ch';
        const inner = document.createElement('span');
        inner.className = 'ch-in';
        inner.textContent = char;
        inner.style.animationDelay = `${0.6 + index * 0.05}s`;
        outer.appendChild(inner);
        letters.push({ el: outer, cx: 0, cy: 0, x: 0, y: 0, r: 0, hot: false });
        index++;
      }
      line.appendChild(outer);
    });
  });
}

function measureLayout() {
  letters.forEach((l) => {
    const c = centerOf(l.el);
    l.cx = c.x - l.x;
    l.cy = c.y - l.y;
  });
  if (!cta) return;
  const c = centerOf(cta);
  ctaState.cx = c.x - ctaState.x;
  ctaState.cy = c.y - ctaState.y;
}

function updateLetters() {
  const RADIUS = 150;
  letters.forEach((l) => {
    let tx = 0, ty = 0, tr = 0, hot = false;
    if (mouse.inside) {
      const dx = l.cx - mouse.x, dy = l.cy - mouse.y;
      const d = Math.hypot(dx, dy);
      if (d < RADIUS && d > 0.01) {
        const f = 1 - d / RADIUS;
        tx = (dx / d) * f * 26;
        ty = (dy / d) * f * 26;
        tr = Math.sign(dx) * f * 14;
        hot = f > 0.45;
      }
    }
    l.x = lerp(l.x, tx, 0.14);
    l.y = lerp(l.y, ty, 0.14);
    l.r = lerp(l.r, tr, 0.14);
    l.el.style.transform = `translate(${l.x.toFixed(2)}px, ${l.y.toFixed(2)}px) rotate(${l.r.toFixed(2)}deg)`;
    if (hot !== l.hot) {
      l.hot = hot;
      l.el.style.color = hot ? '#ff8a7a' : '';
    }
  });
}

const SHAKE = [
  { transform: 'rotate(0)' }, { transform: 'rotate(-4deg)' }, { transform: 'rotate(4deg)' },
  { transform: 'rotate(-3deg)' }, { transform: 'rotate(2deg)' }, { transform: 'rotate(0)' },
];

const WORD_FX = {
  shake(word) {
    word.style.color = COLORS.red;
    word.style.backgroundColor = COLORS.cream;
    word.style.boxShadow = `0 0 0 4px ${COLORS.cream}`;
    word.animate(SHAKE, { duration: 500 });
    sparks(worldOf(R.jackGift.root, v3(0, 0.5, 0)), 10, 1.2);
  },
  smile(word) {
    word.style.transform = 'translateY(-6px) rotate(-6deg) scale(1.18)';
    word.style.color = '#ffd27a';
    word.style.letterSpacing = '.06em';
    hearts(worldOf(R.window.teddy, v3(0, 0.3, 0.2)), 3);
  },
  flip(word) {
    word.animate([{ transform: 'perspective(300px) rotateX(0)' }, { transform: 'perspective(300px) rotateX(360deg)' }], { duration: 700, easing: 'ease-out' });
    word.style.color = COLORS.gold;
  },
  hug(word) {
    word.style.backgroundColor = COLORS.red;
    word.style.color = COLORS.cream;
    word.style.boxShadow = `0 0 0 6px ${COLORS.red}, 0 8px 18px rgba(0,0,0,.35)`;
    word.style.transform = 'scale(1.06)';
  },
};

function handleWordEnter(event) {
  WORD_FX[event.currentTarget.dataset.fx](event.currentTarget);
  setCursorScale(1.5);
}
function handleWordLeave(event) {
  const w = event.currentTarget;
  w.style.color = '';
  w.style.backgroundColor = '';
  w.style.boxShadow = '';
  w.style.transform = '';
  w.style.letterSpacing = '';
  setCursorScale(1);
}

function flipDate(event) {
  event.currentTarget.style.transform = 'rotateX(360deg) scale(1.15)';
  event.currentTarget.style.color = COLORS.green;
  setCursorScale(1.5);
}
function restDate(event) {
  event.currentTarget.style.transform = '';
  event.currentTarget.style.color = '';
  setCursorScale(1);
}

const domAnims = {};
function rockLogo(event) {
  domAnims.logo = event.currentTarget.animate([{ transform: 'rotate(-5deg) scale(1.06)' }, { transform: 'rotate(5deg) scale(1.06)' }], { duration: 700, iterations: Infinity, direction: 'alternate', easing: 'ease-in-out' });
  setCursorScale(1.5);
}
function restLogo() {
  if (domAnims.logo) domAnims.logo.cancel();
  setCursorScale(1);
}

// Sello "10€ = 1 regalo": cada clic es una donación simbólica →
// cae un regalo del cielo en la escena 3D y sube el contador
let donatedGifts = 0;
function donateGift(event) {
  if (event) event.stopPropagation();
  dropGift(rand(-3, 3), rand(-1, 2), 0);
  donatedGifts++;
  const count = $('#badgeCount');
  count.textContent = `🎁 ${donatedGifts} ${donatedGifts === 1 ? 'regalo donado' : 'regalos donados'}`;
  count.classList.add('is-visible');
  badgeCore.animate(
    [{ transform: 'scale(1)' }, { transform: 'scale(.82)' }, { transform: 'scale(1.12)' }, { transform: 'scale(1)' }],
    { duration: 450, easing: 'ease-out' }
  );
}

function stampSeal(event) {
  event.currentTarget.style.transform = 'scale(.84) rotate(-14deg)';
  event.currentTarget.style.filter = 'drop-shadow(0 1px 1px rgba(40,30,50,.4))';
  setCursorScale(1.5);
}
function liftSeal(event) {
  event.currentTarget.style.transform = '';
  event.currentTarget.style.filter = '';
  setCursorScale(1);
}

function activateBadge() {
  badgeState.targetSpeed = 4;
  badge.style.transform = 'scale(1.12) rotate(-6deg)';
  badgeCore.style.background = 'radial-gradient(circle at 35% 30%, #ffe08a, #f2c35b 55%, #b8861c)';
  badgeCore.style.color = COLORS.ink;
  setCursorScale(1.6);
}
function deactivateBadge() {
  badgeState.targetSpeed = 0.25;
  badge.style.transform = '';
  badgeCore.style.background = '';
  badgeCore.style.color = '';
  setCursorScale(1);
}
function updateBadge() {
  badgeState.speed = lerp(badgeState.speed, badgeState.targetSpeed, 0.05);
  badgeState.angle = (badgeState.angle + badgeState.speed) % 360;
  badgeRing.style.transform = `rotate(${badgeState.angle.toFixed(2)}deg)`;
}

function activateCta() {
  if (!cta.dataset.original) cta.dataset.original = cta.textContent.trim();
  cta.textContent = cta.dataset.hover;
  cta.style.background = 'linear-gradient(180deg, #3f7d55, #24503a)';
  ctaState.targetScale = 1.1;
  setCursorScale(1.6);
}
function deactivateCta() {
  cta.textContent = cta.dataset.original;
  cta.style.background = '';
  ctaState.targetScale = 1;
  setCursorScale(1);
}
function updateCta() {
  if (!cta) return;
  let tx = 0, ty = 0;
  if (mouse.inside) {
    const dx = mouse.x - ctaState.cx, dy = mouse.y - ctaState.cy;
    if (Math.hypot(dx, dy) < 140) { tx = dx * 0.3; ty = dy * 0.3; }
  }
  ctaState.x = lerp(ctaState.x, tx, 0.15);
  ctaState.y = lerp(ctaState.y, ty, 0.15);
  ctaState.scale = lerp(ctaState.scale, ctaState.targetScale, 0.2);
  cta.style.transform = `translate(${ctaState.x.toFixed(1)}px, ${ctaState.y.toFixed(1)}px) scale(${ctaState.scale.toFixed(3)})`;
}

function setCursorScale(s) { cursor.targetScale = s; }
function updateCursor(time) {
  cursor.x = lerp(cursor.x, mouse.x, 0.35);
  cursor.y = lerp(cursor.y, mouse.y, 0.35);
  cursor.scale = lerp(cursor.scale, cursor.targetScale, 0.2);
  cursorEl.style.transform = `translate(${(cursor.x - 17).toFixed(1)}px, ${(cursor.y - 17).toFixed(1)}px) rotate(${((time * 50) % 360).toFixed(1)}deg) scale(${cursor.scale.toFixed(3)})`;
  tooltip.style.left = `${cursor.x}px`;
  tooltip.style.top = `${cursor.y - 18}px`;
}

/* =========================================================
   13 · EVENTOS DEL CARTEL
   ========================================================= */
function fitPoster() {
  const margin = 24;
  scale = Math.min((window.innerWidth - margin) / W, (window.innerHeight - margin) / H, 1);
  poster.style.transform = `scale(${scale})`;
  posterWrap.style.width = `${W * scale}px`;
  posterWrap.style.height = `${H * scale}px`;
  measureLayout();
}

function handlePosterMove(event) {
  const p = toPosterCoords(event.clientX, event.clientY);
  mouse.vx = p.x - mouse.x;
  mouse.vy = p.y - mouse.y;
  mouse.x = p.x;
  mouse.y = p.y;
  mouse.nx = (p.x / W) * 2 - 1;
  mouse.ny = (p.y / H) * 2 - 1;
  mouse.moved = true;
  if (!mouse.inside) {
    mouse.inside = true;
    cursor.x = p.x;
    cursor.y = p.y;
    cursorEl.style.opacity = '1';
  }
}

function handlePosterLeave() {
  mouse.inside = false;
  mouse.vx = mouse.vy = mouse.nx = mouse.ny = 0;
  cursorEl.style.opacity = '0';
  setHovered(null);
}

function handlePosterClick(event) {
  if (event.target.closest('.cta')) {
    if (cursorPoint) sparks(cursorPoint, 40, 3);
    return;
  }
  if (hovered && hovered.userData.react === 'sack') { spillFromSack(); return; }
  if (cursorHit) {
    const p = cursorHit.point;
    dropGift(p.x, p.z, p.y);
  }
}

/* =========================================================
   14 · BUCLE PRINCIPAL
   ========================================================= */
const clock = new THREE.Clock();

function updateCamera(dt) {
  camState.offX = lerp(camState.offX, mouse.inside ? mouse.nx * 0.9 : 0, 0.04);
  camState.offY = lerp(camState.offY, mouse.inside ? -mouse.ny * 0.5 : 0, 0.04);
  const intro = camState.intro;
  camera.position.set(
    CAM_BASE.x + camState.offX,
    CAM_BASE.y + camState.offY + (1 - intro) * 2.2,
    CAM_BASE.z + (1 - intro) * 6
  );
  camera.lookAt(CAM_TARGET);
}

function updateLightsFx(time) {
  // linterna del cursor: sigue el punto 3D bajo el ratón
  const L = lights.cursor;
  if (mouse.inside && cursorPoint) {
    lights.cursorTarget.copy(cursorPoint).add(v3(0, 0.9, 0)).addScaledVector(ray.ray.direction, -0.9);
  }
  L.position.lerp(lights.cursorTarget, 0.15);
  L.intensity = lerp(L.intensity, mouse.inside ? 1.6 : 0, 0.08);

  const now = performance.now();
  const chase = (list, until) => list.forEach((l) => {
    let k = 0.75 + 0.25 * Math.sin(time * 3 + l.phase);
    if (now < until) k = 0.2 + Math.max(0, Math.sin(time * 11 - l.index * 0.9)) * 1.4;
    l.mat.emissiveIntensity = k * 1.3;
    l.glow.material.opacity = clamp(k * 0.8, 0.1, 1);
  });
  chase(R.treeLights, treeChaseUntil);
  chase(R.eaveLights, eaveChaseUntil);

  R.stars[0].material.opacity = 0.75 + Math.sin(time * 1.3) * 0.15 + starBoost * 0.2;
  R.stars[1].material.opacity = 0.55 + Math.sin(time * 2.1 + 1) * 0.35 + starBoost * 0.3;
  R.starGlow.material.opacity = 0.65 + Math.sin(time * 4) * 0.12;
  R.window.light.intensity += Math.sin(time * 23) * 0.02;
}

function animate() {
  const dt = Math.min(clock.getDelta(), 0.05);
  const time = clock.elapsedTime;
  mouse.vx *= 0.8;
  mouse.vy *= 0.8;
  adaptQuality(dt);

  updateHover();
  updateAnims(dt);
  updateWind(time, dt);
  updateDeer(dt, time);
  updateFox(dt);
  updateHeads();
  updateBreathing(time);
  updateFlock(time);
  updateGifts(dt);
  updateSnow(dt, time);
  updateParticles(dt);
  updateCamera(dt);
  updateLightsFx(time);
  updateLetters();
  updateBadge();
  updateCta();
  updateCursor(time);

  renderer.render(scene, camera);
  requestAnimationFrame(animate);
}

/* =========================================================
   15 · INICIALIZACIÓN
   ========================================================= */
function init() {
  setupRenderer();
  makeTextures();
  makeGeometries();
  makeMaterials();
  setupLights();

  buildGround();
  buildSky();
  buildForest();
  buildShed();
  buildTree();
  buildDeer();
  buildFox();
  buildRabbit();
  buildGroundBirds();
  buildSack();
  buildGrass();
  makeSnowLayer(1600, { x0: -14, x1: 14, y0: 0, y1: 14, z0: -16, z1: 6 }, 0.07, 0.7, 0.85);
  makeSnowLayer(160, { x0: -4, x1: 4, y0: 0, y1: 7, z0: 6, z1: 10.5 }, 0.08, 1.3, 0.6);

  // guarda las posiciones base de los pájaros (ya colocados)
  [R.sparrow, R.robin, R.jay, R.chickadee, R.cardinal].forEach((b) => { b.base = b.root.position.clone(); });
  collectRayTargets();
  optimizeShadows();

  splitHeadline();
  fitPoster();

  if (captureMode) {
    document.documentElement.classList.add('no-intro');
    camState.intro = 1;
    for (let i = 0; i < 160; i++) { updateWind(i / 60, 1 / 60); updateParticles(1 / 60); updateSnow(1 / 60, i / 60); }
  } else {
    run(2800, (e) => { camState.intro = e; }, { ease: ease.inOutSine });
    later('deer', deerNextAction, 2500);
    later('fox', foxStart, 5000);
    later('rabbit', rabbitWander, 3500);
    later('groundBirds', groundBirdsLife, 2500);
    later('smallLife', smallCreaturesLife, 3000);
    later('blink', blinkSomeone, 1500);
    later('flock', flyFlock, 7000);
  }

  window.addEventListener('resize', fitPoster);
  if (document.fonts) document.fonts.ready.then(measureLayout);

  poster.addEventListener('mousemove', handlePosterMove);
  poster.addEventListener('mouseleave', handlePosterLeave);
  poster.addEventListener('click', handlePosterClick);

  $$('.kw[data-fx]').forEach((w) => {
    w.addEventListener('mouseenter', handleWordEnter);
    w.addEventListener('mouseleave', handleWordLeave);
  });
  const dateNum = $('#dateNum');
  dateNum.addEventListener('mouseenter', flipDate);
  dateNum.addEventListener('mouseleave', restDate);
  const logo = $('#logo');
  logo.addEventListener('mouseenter', rockLogo);
  logo.addEventListener('mouseleave', restLogo);
  const seal = $('#seal');
  seal.addEventListener('mouseenter', stampSeal);
  seal.addEventListener('mouseleave', liftSeal);
  badge.addEventListener('mouseenter', activateBadge);
  badge.addEventListener('mouseleave', deactivateBadge);
  badge.addEventListener('click', donateGift);
  badge.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); donateGift(e); }
  });
  if (cta) {
    cta.addEventListener('mouseenter', activateCta);
    cta.addEventListener('mouseleave', deactivateCta);
  }

  $('#loading').style.opacity = '0';
  clock.start();
  requestAnimationFrame(animate);
}

init();
