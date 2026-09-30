'use strict';

const $ = (sel, el = document) => el.querySelector(sel);
const $$ = (sel, el = document) => [...el.querySelectorAll(sel)];

let S = null; // latest public state from the server
let clockOffset = 0; // server clock − local clock
let previewing = false; // wizard open → the stage shows the draft instead of the live owner's page
let mode = 'bid'; // wizard mode: 'bid' | 'edit'
let biddingAs = null; // our own bid in flight, so its takeover isn't announced as a stranger's
let wiping = false; // a takeover wipe is playing; hold the old page until it finishes
const applied = { scene: '', ticker: '' }; // avoid restarting animations needlessly

const now = () => Date.now() + clockOffset;
const reduceMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
const rid = () => (crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2) + Date.now().toString(36));
const store = {
  get(k) { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
};
const vid = store.get('tb_vid') || (() => { const v = rid(); store.set('tb_vid', v); return v; })();

// ───────────────────────────── formatting ─────────────────────────────

const currency = () => (S && S.currency ? S.currency : 'usd').toUpperCase();
function money(cents) {
  return new Intl.NumberFormat(undefined, { style: 'currency', currency: currency(), minimumFractionDigits: cents % 100 ? 2 : 0 }).format(cents / 100);
}
function currencySymbol() {
  const part = new Intl.NumberFormat(undefined, { style: 'currency', currency: currency() }).formatToParts(1).find((p) => p.type === 'currency');
  return part ? part.value : '$';
}
const num = (n) => new Intl.NumberFormat(undefined, { notation: n >= 100000 ? 'compact' : 'standard' }).format(n);
const pad = (n) => String(n).padStart(2, '0');
function dur(ms) {
  const s = Math.max(0, Math.floor(ms / 1000));
  const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  if (d) return `${d}d ${h}h`;
  if (h) return `${h}h ${m}m`;
  if (m) return `${m}m ${sec}s`;
  return `${sec}s`;
}
function clock(ms) {
  const s = Math.max(0, Math.floor(ms / 1000));
  const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  if (d) return `${d}d ${pad(h)}h`;
  if (h) return `${h}:${pad(m)}:${pad(sec)}`;
  return `${m}:${pad(sec)}`;
}
const pct = (a, b) => (b ? `${((a / b) * 100).toFixed(a / b < 0.1 ? 1 : 0)}%` : '–');
const timeOfDay = (t) => new Date(t).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

// Images uploaded to this server live at /u/<sha256>.<ext>
const UPLOAD_PATH = /^\/u\/[a-f0-9]{64}\.(png|jpg|gif|webp)$/;
function safeUrl(u, allowUpload = false) {
  if (allowUpload && UPLOAD_PATH.test(String(u).trim())) return String(u).trim();
  try {
    const x = new URL(String(u).trim());
    return x.protocol === 'https:' || x.protocol === 'http:' ? x.href : '';
  } catch { return ''; }
}
const cssUrl = (u) => u.replace(/["\\\n\r]/g, encodeURIComponent);
const hostOf = (u) => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return ''; } };

function h(tag, props = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === 'class') el.className = v;
    else if (k === 'style') el.style.cssText = v;
    else if (k.startsWith('data-') || k.startsWith('aria-')) el.setAttribute(k, v);
    else if (k in el) el[k] = v;
    else el.setAttribute(k, v);
  }
  el.append(...kids.filter((k) => k != null && k !== false));
  return el;
}
function icon(name) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('class', 'ico');
  svg.setAttribute('aria-hidden', 'true');
  const use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
  use.setAttribute('href', `#i-${name}`);
  svg.append(use);
  return svg;
}
const setText = (el, text) => { if (el && el.textContent !== text) el.textContent = text; };

// ───────────────────────────── popups ─────────────────────────────

function openPopup(id) {
  for (const d of $$('dialog[open]')) if (d.id !== id) d.close();
  const d = $(`#${id}`);
  if (!d.open) d.showModal();
  return d;
}
$$('[data-pop]').forEach((b) => b.addEventListener('click', () => {
  if (b.dataset.pop === 'statsPop' && S) renderChart();
  if (b.dataset.pop === 'historyPop' && S) renderHistory();
  openPopup(b.dataset.pop);
}));
document.addEventListener('click', (e) => {
  const close = e.target.closest('[data-close]');
  if (close) close.closest('dialog').close();
});
// Clicking the dimmed backdrop closes a popup (not the wizard, where a stray click would lose your place).
$$('dialog.pop').forEach((d) => d.addEventListener('click', (e) => { if (e.target === d && d.id !== 'bidPop') d.close(); }));

// ───────────────────────────── the owner's page ─────────────────────────────

// Background options; pages saved before these existed fall back to them.
const BG_STYLE = {
  gradStyle: 'linear', bg3: '#7c5cff', bg3On: false, gradPos: 'center', bgAudio: '', audioSource: 'spotify', audioFile: '', audioVolume: 60, bgFit: 'cover', bgPos: 'center',
  bgBlur: 0, bgBright: 100, bgFilter: 'none', duoDark: '#1b0b3a', duoLight: '#ffd23f', bgAnimate: false, bgSpeed: 1, overlayColor: '#000000', overlayOpacity: 0, vignette: 0, grain: 0,
  texture: 'none', textureColor: '#ffffff', textureOpacity: 0.12, textureScale: 24,
};
// Image/video filters. Clean ones are plain CSS; unhinged ones add SVG filters (see index.html) or animations.
const FILTERS = {
  none: { name: 'Original', css: '' },
  vivid: { name: 'Vivid', css: 'saturate(1.6) contrast(1.1)' },
  noir: { name: 'Noir', css: 'grayscale(1) contrast(1.35) brightness(0.9)' },
  vintage: { name: 'Vintage', css: 'sepia(0.55) contrast(1.05) saturate(0.9) hue-rotate(-8deg)' },
  cinematic: { name: 'Cinematic', css: 'contrast(1.2) saturate(1.25) sepia(0.18) hue-rotate(-10deg) brightness(0.95)' },
  faded: { name: 'Faded', css: 'contrast(0.78) saturate(0.7) brightness(1.1)' },
  warm: { name: 'Warm', css: 'url(#f-warm) saturate(1.15)' },
  cool: { name: 'Cool', css: 'url(#f-cool) contrast(1.05)' },
  dreamy: { name: 'Dreamy', css: 'saturate(1.35) brightness(1.12) contrast(0.88) blur(1.2px)' },
  acid: { name: 'Acid', wild: true, anim: 'acid' },
  deepfried: { name: 'Deep fried', wild: true, css: 'saturate(9) contrast(3) brightness(1.15) sepia(0.4) url(#f-posterize)' },
  glitch: { name: 'Glitch', wild: true, anim: 'glitch' },
  thermal: { name: 'Thermal', wild: true, css: 'url(#f-thermal) contrast(1.1)' },
  xray: { name: 'X-ray', wild: true, css: 'grayscale(1) invert(1) contrast(1.5) brightness(1.1) sepia(0.25) hue-rotate(170deg)' },
  invert: { name: 'Inverted', wild: true, css: 'invert(1)' },
  posterize: { name: 'Posterize', wild: true, css: 'url(#f-posterize) saturate(1.6) contrast(1.1)' },
  duotone: { name: 'Duotone', wild: true, css: 'url(#f-duotone)' },
  liquid: { name: 'Liquid', wild: true, css: 'url(#f-liquid)' },
  vhs: { name: 'VHS', wild: true, anim: 'vhs' },
};
function setDuotone(dark, light) {
  const ch = (hex, shift) => (((parseInt(String(hex).slice(1), 16) || 0) >> shift) & 255) / 255;
  [['duoR', 16], ['duoG', 8], ['duoB', 0]].forEach(([id, shift]) => {
    document.getElementById(id).setAttribute('tableValues', `${ch(dark, shift).toFixed(3)} ${ch(light, shift).toFixed(3)}`);
  });
}

const POS = { center: '50% 50%', top: '50% 0%', bottom: '50% 100%', left: '0% 50%', right: '100% 50%' };
function rgba(hex, a) {
  const n = parseInt(String(hex).slice(1), 16) || 0;
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
}

function bgCss(raw) {
  const c = { ...BG_STYLE, ...raw };
  if (c.bgType === 'image') {
    const img = safeUrl(c.bgImage, true);
    if (!img) return c.bg1;
    const fit = c.bgFit === 'tile' ? 'auto repeat' : `${c.bgFit} no-repeat`;
    return `url("${cssUrl(img)}") ${POS[c.bgPos]} / ${fit}, ${c.bg1}`;
  }
  if (c.bgType === 'gradient') {
    const stops = (c.bg3On ? [c.bg1, c.bg3, c.bg2] : [c.bg1, c.bg2]).join(', ');
    const at = POS[c.gradPos];
    if (c.gradStyle === 'radial') return `radial-gradient(circle at ${at}, ${stops})`;
    if (c.gradStyle === 'conic') return `conic-gradient(from ${c.bgAngle}deg at ${at}, ${stops}, ${c.bg1})`;
    return `linear-gradient(${c.bgAngle}deg, ${stops})`;
  }
  if (c.bgType === 'mesh') { // soft overlapping glows over a base color
    return [
      `radial-gradient(at 18% 22%, ${c.bg2} 0, transparent 55%)`, `radial-gradient(at 82% 18%, ${c.bg3} 0, transparent 50%)`,
      `radial-gradient(at 75% 85%, ${c.bg2} 0, transparent 55%)`, `radial-gradient(at 12% 88%, ${c.bg3} 0, transparent 52%)`, c.bg1,
    ].join(', ');
  }
  return c.bg1; // solid
}

function textureCss(c) {
  const col = rgba(c.textureColor, c.textureOpacity);
  const s = c.textureScale;
  const dot = Math.max(1, s * 0.08);
  switch (c.texture) {
    case 'dots': return `radial-gradient(${col} ${dot.toFixed(1)}px, transparent ${(dot + 0.6).toFixed(1)}px) 0 0 / ${s}px ${s}px`;
    case 'grid': return `linear-gradient(${col} 1px, transparent 1px) 0 0 / ${s}px ${s}px, linear-gradient(90deg, ${col} 1px, transparent 1px) 0 0 / ${s}px ${s}px`;
    case 'stripes': return `repeating-linear-gradient(45deg, ${col} 0 ${Math.round(s * 0.25)}px, transparent ${Math.round(s * 0.25)}px ${Math.round(s * 0.6)}px)`;
    case 'checker': return `conic-gradient(${col} 25%, transparent 0 50%, ${col} 0 75%, transparent 0) 0 0 / ${s}px ${s}px`;
    case 'waves': return `radial-gradient(circle at 50% 100%, transparent 45%, ${col} 46% 52%, transparent 53%) 0 0 / ${s}px ${Math.round(s / 2)}px`;
    default: return '';
  }
}

function applyBackground(raw) {
  const c = { ...BG_STYLE, ...raw };
  const bg = $('#bg');
  bg.style.background = bgCss(c);

  const media = c.bgType === 'image';
  const filters = [];
  if (media && c.bgBlur) filters.push(`blur(${c.bgBlur}px)`);
  if (media && c.bgBright !== 100) filters.push(`brightness(${c.bgBright / 100})`);
  // Filters go on the wrapper so they combine with the background's own motion.
  const wrap = $('#bgWrap');
  const fx = (media && FILTERS[c.bgFilter]) || FILTERS.none;
  if (fx.anim) { wrap.style.filter = ''; wrap.style.setProperty('--bgf', filters.join(' ')); }
  else { wrap.style.filter = [...filters, fx.css].filter(Boolean).join(' '); wrap.style.removeProperty('--bgf'); }
  wrap.className = `stage-bgwrap${fx.anim ? ` fx-${fx.anim}` : ''}`;
  if (media && c.bgFilter === 'duotone') setDuotone(c.duoDark, c.duoLight);
  bg.style.filter = '';
  // Blur leaves a soft edge and Liquid drags pixels in from outside, so let the image bleed past the screen.
  const bleed = Math.max(media && c.bgBlur ? c.bgBlur * 2 : 0, media && c.bgFilter === 'liquid' ? 60 : 0);
  bg.style.inset = bleed ? `-${bleed}px` : '';

  const motion = !c.bgAnimate ? '' : c.bgType === 'image' ? 'zoom' : c.bgType === 'gradient' || c.bgType === 'mesh' ? 'shift' : '';
  bg.classList.toggle('anim-shift', motion === 'shift');
  bg.classList.toggle('anim-zoom', motion === 'zoom');
  if (motion === 'shift') bg.style.backgroundSize = '200% 200%';
  bg.style.setProperty('--bg-dur', `${(18 / c.bgSpeed).toFixed(1)}s`);

  const layers = [];
  if (c.texture !== 'none') layers.push(textureCss(c));
  if (c.vignette) layers.push(`radial-gradient(ellipse at center, transparent ${Math.round(70 - c.vignette * 0.35)}%, rgba(0, 0, 0, ${(c.vignette / 100 * 0.85).toFixed(2)}) 100%)`);
  if (c.overlayOpacity) layers.push(`linear-gradient(${rgba(c.overlayColor, c.overlayOpacity)}, ${rgba(c.overlayColor, c.overlayOpacity)})`);
  $('#bgFx').style.background = layers.join(', ');
  $('#bgGrain').style.opacity = (c.grain / 100 * 0.45).toFixed(2);
}

// ── Button beat: rings / EQ bars / halo / shockwave around the button ──
// With an uploaded soundtrack playing, it follows the real music (bass hits via an analyser);
// otherwise it pulses at the owner's tempo. Spotify can't be analysed, so it uses the tempo too.
const BEAT_STYLE = { beatStyle: 'none', beatMatch: true, beatColor: '#ffd23f', beatBpm: 120, beatIntensity: 70, beatShake: false, beatParticles: false };
const BEAT_BARS = 32;
const SPEC_N = 48; // half of the mirrored circular spectrum
const beat = {
  cfg: null, raf: 0, analyser: null, bins: null, avg: 0, lastHit: 0, phase: 0, last: 0,
  bars: [], barNoise: [], spec: new Float32Array(SPEC_N), specNoise: new Float32Array(SPEC_N), specMax: new Float32Array(SPEC_N).fill(0.2), history: [],
  canvas: null, particles: [], pw: 0, ph: 0,
};
const beatActive = (c) => c && (c.beatStyle !== 'none' || c.beatShake || c.beatParticles) && !reduceMotion();

function applyBeat(raw) {
  const c = { ...BEAT_STYLE, ...raw };
  const box = $('#beat');
  const on = beatActive(c);
  box.style.setProperty('--bc', c.beatMatch ? c.buttonColor : c.beatColor);
  const housing = $('#housing');
  housing.style.setProperty('--beat-int', (c.beatIntensity / 100).toFixed(2));
  housing.classList.toggle('beating', on && c.beatStyle !== 'none');
  housing.classList.toggle('trap', c.beatStyle === 'trap');
  if (!beat.cfg || beat.cfg.beatStyle !== c.beatStyle) {
    box.replaceChildren();
    beat.bars = [];
    beat.canvas = null;
    if (c.beatStyle === 'halo') box.append(h('span', { class: 'beat-halo' }));
    if (c.beatStyle === 'bars') {
      for (let i = 0; i < BEAT_BARS; i++) {
        const bar = h('span', { class: 'beat-bar', style: `--a:${(i * 360) / BEAT_BARS}deg` });
        beat.bars.push(bar);
        box.append(bar);
      }
    }
    if (c.beatStyle === 'trap') { beat.canvas = h('canvas', { class: 'beat-canvas' }); box.append(beat.canvas); }
  }
  if (!c.beatParticles) { beat.particles = []; clearParticles(); }
  if (!c.beatShake) { $('#bgWrap').style.translate = ''; $('#bgWrap').style.scale = ''; }
  beat.cfg = c;
  if (on && !beat.raf) beat.raf = requestAnimationFrame(beatFrame);
  if (!on && beat.raf) { cancelAnimationFrame(beat.raf); beat.raf = 0; box.style.setProperty('--beat', 0); }
}

// Hook an uploaded soundtrack into an analyser. Only same-origin files: analysing a file
// from another site without CORS permission would silence it.
function beatListen(audio) {
  if (beat.analyser || !AUDIO_UPLOAD_PATH.test(new URL(audio.src).pathname)) return;
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const src = ctx.createMediaElementSource(audio);
    const an = ctx.createAnalyser();
    an.fftSize = 1024; // ~43 Hz per bin: enough detail to separate 808s from kicks
    an.smoothingTimeConstant = 0.7;
    src.connect(an);
    an.connect(ctx.destination);
    beat.analyser = an;
    beat.bins = new Uint8Array(an.frequencyBinCount);
    beat.audio = audio;
    if (ctx.state === 'suspended') ctx.resume();
  } catch {}
}

function spawnBeat(cls) {
  const el = h('span', { class: cls });
  el.addEventListener('animationend', () => el.remove());
  $('#beat').append(el);
}

// Mix a hex colour toward white (canvas can't use CSS color-mix).
function lighten(hex, amt, alpha = 1) {
  const n = parseInt(String(hex).slice(1), 16) || 0;
  const mix = (v) => Math.round(v + (255 - v) * amt);
  return `rgba(${mix((n >> 16) & 255)}, ${mix((n >> 8) & 255)}, ${mix(n & 255)}, ${alpha})`;
}

// ── The trap-channel visualizer: a mirrored circular spectrum in stacked colour layers ──
function drawSpectrum(c, level) {
  const cv = beat.canvas;
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const size = Math.round(cv.clientWidth * dpr);
  if (!size) return;
  if (cv.width !== size) { cv.width = size; cv.height = size; }
  const g = cv.getContext('2d');
  g.clearRect(0, 0, size, size);
  const cx = size / 2;
  const base = size * 0.158; // just outside the button's bezel
  const reach = size * 0.15 * (0.45 + c.beatIntensity / 180); // stays clear of the headline (see .housing.trap margin)
  const color = c.beatMatch ? c.buttonColor : c.beatColor;
  // Oldest spectrum drawn biggest and faintest: the classic trailing colour layers.
  const layers = [
    { spec: beat.history[4] || beat.spec, gain: 1.15, fill: rgba(color, 0.35), glow: color },
    { spec: beat.history[2] || beat.spec, gain: 1.0, fill: lighten(color, 0.35, 0.65), glow: color },
    { spec: beat.spec, gain: 0.82, fill: 'rgba(255, 255, 255, 0.95)', glow: '#ffffff' },
  ];
  const n = SPEC_N * 2;
  for (const L of layers) {
    const pts = [];
    for (let i = 0; i < n; i++) {
      const v = L.spec[i < SPEC_N ? i : n - 1 - i]; // mirror left/right
      const ang = -Math.PI / 2 + (i / n) * Math.PI * 2;
      const r = base + v * reach * L.gain + level * size * 0.012;
      pts.push([cx + Math.cos(ang) * r, cx + Math.sin(ang) * r]);
    }
    g.beginPath();
    const mid = (p, q) => [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2];
    let m = mid(pts[n - 1], pts[0]);
    g.moveTo(m[0], m[1]);
    for (let i = 0; i < n; i++) { // smooth curve through the midpoints
      const p = pts[i];
      const q = mid(p, pts[(i + 1) % n]);
      g.quadraticCurveTo(p[0], p[1], q[0], q[1]);
    }
    g.closePath();
    g.moveTo(cx + base * 0.97, cx);
    g.arc(cx, cx, base * 0.97, 0, Math.PI * 2, true); // hollow middle: the button sits in it like a logo
    g.fillStyle = L.fill;
    g.shadowColor = L.glow;
    g.shadowBlur = 18 * dpr;
    g.fill('evenodd');
  }
  g.shadowBlur = 0;
}

// ── Particles that stream out from the button, faster on the bass ──
function clearParticles() {
  const cv = $('#vizParticles');
  cv.getContext('2d').clearRect(0, 0, cv.width, cv.height);
}
function updateParticles(c, level, hit, dt) {
  const cv = $('#vizParticles');
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const w = Math.round(cv.clientWidth * dpr), hgt = Math.round(cv.clientHeight * dpr);
  if (cv.width !== w || cv.height !== hgt) { cv.width = w; cv.height = hgt; }
  const stage = $('#stage').getBoundingClientRect();
  const btn = $('#housing').getBoundingClientRect();
  const ox = (btn.left - stage.left + btn.width / 2) * dpr, oy = (btn.top - stage.top + btn.height / 2) * dpr;
  const spawn = (count) => {
    for (let i = 0; i < count && beat.particles.length < 260; i++) {
      const a = Math.random() * Math.PI * 2;
      const d = (btn.width / 2) * dpr * (0.9 + Math.random() * 0.3);
      beat.particles.push({ x: ox + Math.cos(a) * d, y: oy + Math.sin(a) * d, vx: Math.cos(a), vy: Math.sin(a), sp: 30 + Math.random() * 70, r: (0.6 + Math.random() * 1.8) * dpr, a: 0.4 + Math.random() * 0.6 });
    }
  };
  spawn(Math.random() < 0.6 ? 1 : 0);
  if (hit) spawn(Math.round(10 + 20 * (c.beatIntensity / 100)));
  const boost = 1 + level * 9 * (c.beatIntensity / 100); // the rush on every hit
  const g = cv.getContext('2d');
  g.clearRect(0, 0, w, hgt);
  const color = c.beatMatch ? c.buttonColor : c.beatColor;
  g.shadowColor = color;
  g.shadowBlur = 8 * dpr;
  g.fillStyle = '#ffffff';
  beat.particles = beat.particles.filter((p) => {
    p.x += p.vx * p.sp * boost * dt * dpr;
    p.y += p.vy * p.sp * boost * dt * dpr;
    if (p.x < -20 || p.y < -20 || p.x > w + 20 || p.y > hgt + 20) return false;
    g.globalAlpha = p.a;
    g.beginPath();
    g.arc(p.x, p.y, p.r * (1 + level * 0.6), 0, Math.PI * 2);
    g.fill();
    return true;
  });
  g.globalAlpha = 1;
}

function beatFrame(t) {
  beat.raf = requestAnimationFrame(beatFrame);
  const c = beat.cfg;
  if (!c || document.hidden) return;
  const dt = Math.min(0.1, (t - (beat.last || t)) / 1000);
  beat.last = t;
  let level = 0;
  let hit = false;
  let levels = null;
  const live = beat.analyser && beat.audio && !beat.audio.paused && beat.audio.isConnected;
  if (live) {
    beat.analyser.getByteFrequencyData(beat.bins);
    let bass = 0;
    for (let i = 1; i < 5; i++) bass += beat.bins[i]; // ~40–200 Hz: kicks and 808s
    bass /= 4 * 255;
    beat.avg = beat.avg * 0.94 + bass * 0.06;
    level = Math.min(1, Math.max(0, (bass - beat.avg * 0.8) * 3.2));
    // relative to the recent average, so detection works at any volume setting
    if (bass > beat.avg * 1.25 && bass > 0.04 && t - beat.lastHit > 240) { hit = true; beat.lastHit = t; }
    // bars: log-spaced bins so bass and treble both show
    levels = beat.bars.map((_, i) => {
      const k = Math.min(beat.bins.length - 1, Math.round(2 * Math.pow(beat.bins.length / 4, i / BEAT_BARS)));
      return beat.bins[k] / 255;
    });
    // circular spectrum: the low end gets most of the circle, like the trap channels
    const usable = beat.bins.length * 0.4;
    for (let i = 0; i < SPEC_N; i++) {
      const k = Math.min(beat.bins.length - 1, 1 + Math.round(Math.pow(i / SPEC_N, 1.25) * usable));
      const raw = beat.bins[k] / 255;
      // each band against its own recent peak, so quiet highs still spike like the loud bass
      beat.specMax[i] = Math.max(beat.specMax[i] * 0.996, raw, 0.08);
      const v = Math.pow(raw / beat.specMax[i], 2.2) * (1 - (i / SPEC_N) * 0.35);
      beat.spec[i] += (v - beat.spec[i]) * 0.55;
    }
  } else {
    const before = beat.phase;
    beat.phase = (beat.phase + dt * (c.beatBpm / 60)) % 1;
    if (beat.phase < before) {
      hit = true;
      beat.barNoise = beat.bars.map(() => 0.35 + Math.random() * 0.65);
      for (let i = 0; i < SPEC_N; i++) beat.specNoise[i] = 0.4 + Math.random() * 0.6;
    }
    level = Math.exp(-beat.phase * 5);
    levels = beat.bars.map((_, i) => level * (beat.barNoise[i] || 0.5) * (0.75 + 0.25 * Math.sin(t / 300 + i)));
    // a believable bass-heavy spectrum at the owner's tempo
    for (let i = 0; i < SPEC_N; i++) {
      const f = i / SPEC_N;
      const target = level * (1 - f * 0.75) * (beat.specNoise[i] || 0.6) + 0.07 * (0.5 + 0.5 * Math.sin(t / 380 + i * 0.9)) * (1 - f * 0.5);
      beat.spec[i] += (target - beat.spec[i]) * 0.35;
    }
  }
  beat.history.unshift(Float32Array.from(beat.spec));
  beat.history.length = Math.min(beat.history.length, 6);

  $('#beat').style.setProperty('--beat', level.toFixed(3));
  $('#housing').style.setProperty('--beat', level.toFixed(3));
  if (c.beatStyle === 'bars') beat.bars.forEach((bar, i) => bar.style.setProperty('--lv', levels[i].toFixed(3)));
  if (hit && c.beatStyle === 'rings') spawnBeat('beat-ring');
  if (hit && c.beatStyle === 'shock') spawnBeat('beat-shock');
  if (c.beatStyle === 'trap' && beat.canvas) drawSpectrum(c, level);
  if (c.beatParticles) updateParticles(c, level, hit, dt);
  if (c.beatShake) { // camera shake and zoom on the bass (individual properties, so filters' own motion still works)
    const k = level * (c.beatIntensity / 100);
    const wrap = $('#bgWrap');
    wrap.style.translate = `${((Math.random() - 0.5) * 14 * k).toFixed(1)}px ${((Math.random() - 0.5) * 14 * k).toFixed(1)}px`;
    wrap.style.scale = (1.02 + k * 0.05).toFixed(3);
  }
}

// ── Soundtrack: a Spotify player behind the Music button in the dock ──
function spotifyEmbed(raw) {
  const m = String(raw || '').trim().match(/^https:\/\/open\.spotify\.com\/(?:intl-[a-z]+\/)?(track|album|playlist|episode|show|artist)\/([A-Za-z0-9]+)/);
  if (!m) return null;
  const compact = m[1] === 'track' || m[1] === 'episode';
  return { kind: m[1], src: `https://open.spotify.com/embed/${m[1]}/${m[2]}?theme=0`, height: compact ? 80 : 152 };
}
// Audio files: uploaded here (/u/<hash>.mp3 …) or linked from elsewhere.
const AUDIO_UPLOAD_PATH = /^\/u\/[a-f0-9]{64}\.(mp3|m4a|ogg|wav)$/;
const audioFileUrl = (u) => (AUDIO_UPLOAD_PATH.test(String(u || '').trim()) ? String(u).trim() : safeUrl(u));
const fmtTime = (sec) => (Number.isFinite(sec) ? `${Math.floor(sec / 60)}:${pad(Math.floor(sec % 60))}` : '0:00');

function renderSoundtrack(c) {
  const frame = $('#playerFrame');
  const sp = c.audioSource === 'spotify' ? spotifyEmbed(c.bgAudio) : null;
  const file = c.audioSource === 'file' ? audioFileUrl(c.audioFile) : '';
  const key = sp ? sp.src : file;
  // Only rebuilt when the source changes, so a song that's playing isn't interrupted.
  if (key && frame.dataset.key !== key) {
    frame.dataset.key = key;
    if (sp) {
      const f = h('iframe', { src: sp.src, title: 'Soundtrack', loading: 'lazy', allow: 'autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture' });
      f.style.height = `${sp.height}px`;
      // Spotify's embed has no volume control and doesn't let pages set one, so say so plainly.
      frame.replaceChildren(f, h('p', { class: 'player-hint' }, icon('volume'), 'Volume follows your device. Use your volume keys to turn it down.'));
      $('.player-note').textContent = 'Press play to listen';
    } else {
      frame.replaceChildren(audioPlayer(file));
      $('.player-note').textContent = 'Now playing on this page';
    }
    $('#musicBtn').classList.remove('playing');
  } else if (!key && frame.dataset.key) {
    delete frame.dataset.key;
    frame.replaceChildren();
    setPlayer(false);
  }
  // Starting volume: a visitor's own choice wins; while editing, the owner hears their setting.
  const audio = $('audio', frame);
  if (audio) {
    const mine = store.get('tb_volume');
    const vol = previewing || mine == null ? c.audioVolume : mine;
    setVolume(audio, vol, false);
  }
  $('#musicBtn').hidden = !key;
}

function setVolume(audio, vol, remember) {
  audio.volume = Math.max(0, Math.min(1, vol / 100));
  const slider = $('.audio-vol input', audio.parentElement);
  if (slider) { slider.value = vol; $('.audio-vol output', audio.parentElement).textContent = `${Math.round(vol)}%`; }
  if (remember) store.set('tb_volume', Math.round(vol));
}

function audioPlayer(src) {
  const audio = h('audio', { src, loop: true, preload: 'metadata' });
  const playBtn = h('button', { type: 'button', class: 'play-btn', 'aria-label': 'Play' }, icon('play'));
  const seek = h('input', { type: 'range', min: 0, max: 1000, value: 0, 'aria-label': 'Position' });
  const cur = h('span', {}, '0:00');
  const total = h('span', {}, '0:00');
  const muteBtn = h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Mute' }, icon('volume'));
  const vol = h('input', { type: 'range', min: 0, max: 100, step: 1, 'aria-label': 'Volume' });
  const volOut = h('output', {}, '');
  const ui = h('div', { class: 'audio-ui' },
    playBtn,
    h('div', { class: 'audio-mid' }, h('span', { class: 'audio-title' }, S && S.owner ? `${S.owner.name} soundtrack` : 'Soundtrack'), h('div', { class: 'audio-time' }, cur, seek, total)),
    h('div', { class: 'audio-vol' }, muteBtn, vol, volOut),
    audio);
  const sync = () => {
    playBtn.replaceChildren(icon(audio.paused ? 'play' : 'pause'));
    playBtn.setAttribute('aria-label', audio.paused ? 'Play' : 'Pause');
    $('#musicBtn').classList.toggle('playing', !audio.paused);
  };
  playBtn.addEventListener('click', () => (audio.paused ? (beatListen(audio), audio.play()).catch(() => toast('That audio file can’t be played. The owner may need to use a different file.', 'bad')) : audio.pause()));
  audio.addEventListener('play', sync);
  audio.addEventListener('pause', sync);
  audio.addEventListener('loadedmetadata', () => { total.textContent = fmtTime(audio.duration); });
  audio.addEventListener('timeupdate', () => {
    cur.textContent = fmtTime(audio.currentTime);
    if (audio.duration) seek.value = Math.round((audio.currentTime / audio.duration) * 1000);
  });
  seek.addEventListener('input', () => { if (audio.duration) audio.currentTime = (seek.value / 1000) * audio.duration; });
  vol.addEventListener('input', () => {
    audio.muted = false;
    setVolume(audio, Number(vol.value), true);
    muteBtn.replaceChildren(icon(Number(vol.value) ? 'volume' : 'mute'));
  });
  muteBtn.addEventListener('click', () => {
    audio.muted = !audio.muted;
    muteBtn.replaceChildren(icon(audio.muted ? 'mute' : 'volume'));
    muteBtn.setAttribute('aria-label', audio.muted ? 'Unmute' : 'Mute');
  });
  return ui;
}

function setPlayer(open) {
  $('#playerCard').hidden = !open;
  $('#musicBtn').setAttribute('aria-expanded', String(open));
  if (open) setTray(false);
}
$('#musicBtn').addEventListener('click', () => setPlayer($('#playerCard').hidden));
$('#playerClose').addEventListener('click', () => setPlayer(false));

const MEDIA_CHIPS = {
  youtube: ['play', 'Watch video'], vimeo: ['play', 'Watch video'], video: ['play', 'Watch video'],
  spotify: ['music', 'Listen'], image: ['image', 'View image'],
};

// Text styling defaults; pages saved before these options existed fall back to them.
const TEXT_STYLE = { letterSpacing: 0, uppercase: false, textFill: 'solid', textColor2: '#ffd23f', textGradAngle: 90, textStroke: 0, strokeColor: '#000000', textShadow: 'none', shadowColor: '#000000', textAnim: 'none' };
const TEXT_DEFAULTS = { headlineSize: 100, taglineSize: 100, ...TEXT_STYLE };

// Shadows are drop-shadow filters so they also work on gradient-filled text.
function shadowFilter(kind, color) {
  if (kind === 'soft') return `drop-shadow(0 6px 16px ${color}99)`;
  if (kind === 'glow') return `drop-shadow(0 0 6px ${color}) drop-shadow(0 0 22px ${color})`;
  if (kind === 'hard') return `drop-shadow(5px 5px 0 ${color})`;
  if (kind === 'extrude') return Array.from({ length: 6 }, () => `drop-shadow(1px 1px 0 ${color})`).join(' ');
  return '';
}

function applyTextStyle(raw) {
  const t = { ...TEXT_DEFAULTS, ...raw };
  const hl = $('#headline');
  hl.style.setProperty('--hl-scale', t.headlineSize / 100);
  $('#tagline').style.setProperty('--tl-scale', t.taglineSize / 100);
  hl.style.setProperty('--hl-ls', `${t.letterSpacing / 100}em`);
  hl.style.textTransform = t.uppercase ? 'uppercase' : '';
  hl.style.setProperty('--g1', t.textColor);
  hl.style.setProperty('--g2', t.textFill === 'gradient' ? t.textColor2 : `color-mix(in srgb, ${t.textColor}, white 60%)`);
  hl.style.setProperty('--ga', `${t.textGradAngle}deg`);
  hl.classList.toggle('fx-grad', t.textFill === 'gradient');
  hl.style.webkitTextStroke = t.textStroke ? `${t.textStroke}px ${t.strokeColor}` : '';
  hl.style.filter = shadowFilter(t.textShadow, t.shadowColor);
  hl.dataset.anim = t.textAnim;
}

let shown = null; // the config currently on screen (live page or the wizard's draft)
function applyConfig(c) {
  shown = c;
  applyBackground(c);
  renderSoundtrack({ ...BG_STYLE, ...c });
  applyBeat(c);
  const pattern = safeUrl(c.patternUrl, true);
  $('#pattern').style.cssText = pattern
    ? `background-image:url("${cssUrl(pattern)}");background-size:${c.patternSize}px auto;opacity:${c.patternOpacity}`
    : '';
  const root = document.documentElement.style;
  root.setProperty('--owner-text', c.textColor);
  root.setProperty('--owner-font', `'${c.font}'`);
  root.setProperty('--btn-bg', c.buttonColor);
  root.setProperty('--btn-fg', c.buttonTextColor);

  $('#headline').textContent = c.headline;
  $('#tagline').textContent = c.tagline;
  applyTextStyle(c);
  const label = c.buttonText || 'The Button';
  const cap = $('#theButton');
  $('.cap-label', cap).textContent = label;
  cap.style.setProperty('--cap-scale', label.length <= 6 ? 1 : label.length <= 12 ? 0.8 : label.length <= 20 ? 0.64 : 0.52);
  const link = safeUrl(c.linkUrl);
  cap.title = link ? `Opens ${hostOf(link)}` : '';

  const chips = (c.links || []).filter((l) => safeUrl(l.url)).map((l) =>
    h('a', { href: safeUrl(l.url), target: '_blank', rel: 'noopener noreferrer nofollow' }, l.label || hostOf(l.url)));
  const media = parseEmbed(c.embedUrl);
  if (media && media.kind === 'link') {
    chips.push(h('a', { href: media.href, target: '_blank', rel: 'noopener noreferrer nofollow' }, icon('link'), media.host));
  } else if (media) {
    const [ico, text] = MEDIA_CHIPS[media.kind];
    chips.push(h('button', { type: 'button', onclick: () => openMedia() }, icon(ico), text));
  }
  $('#links').replaceChildren(...chips);

  const sk = JSON.stringify(c.layers || []);
  if (sk !== applied.scene) { applied.scene = sk; buildScene(c.layers || []); }
  if (!c.parallax) { $('#floaters').style.removeProperty('--px'); $('#floaters').style.removeProperty('--py'); }
  requestAnimationFrame(() => { fitHeadline(); fitCapLabel(); placeOrbitCenter(); });
}

// The chosen headline size is a maximum: shrink until it fits in 3 lines without splitting words.
function fitHeadline() {
  const hl = $('#headline');
  if (!hl.textContent) return;
  const over = () => hl.scrollHeight > hl.clientHeight + 2 || hl.scrollWidth > hl.clientWidth + 2;
  hl.style.overflowWrap = 'normal';
  let fit = 1;
  hl.style.setProperty('--hl-fit', fit);
  while (fit > 0.45 && over()) {
    fit -= 0.05;
    hl.style.setProperty('--hl-fit', fit.toFixed(2));
  }
  if (over()) hl.style.overflowWrap = 'anywhere'; // one enormous word: break it rather than hide it
}

// Shrink the button text until its longest word fits on the cap (wide fonts like the pixel one need this).
function fitCapLabel() {
  const cap = $('#theButton');
  const label = $('.cap-label', cap);
  let fit = 1;
  cap.style.setProperty('--cap-fit', fit);
  const room = cap.clientWidth * 0.66; // inside the cap's padding
  while (fit > 0.35 && (label.scrollWidth > room || label.offsetHeight > cap.clientHeight * 0.72)) {
    fit -= 0.05;
    cap.style.setProperty('--cap-fit', fit.toFixed(2));
  }
}
addEventListener('resize', () => { fitHeadline(); fitCapLabel(); });

// Things orbit the button itself, and rings/wipes start from it.
function placeOrbitCenter() {
  const stage = $('#stage').getBoundingClientRect();
  const btn = $('#housing').getBoundingClientRect();
  $('#stage').style.setProperty('--ox', `${(btn.left - stage.left + btn.width / 2).toFixed(0)}px`);
  $('#stage').style.setProperty('--oy', `${(btn.top - stage.top + btn.height / 2).toFixed(0)}px`);
}
new ResizeObserver(placeOrbitCenter).observe($('#content'));

const BASE_DURATION = { float: 9, rain: 9, rise: 10, drift: 16, orbit: 20, bounce: 11, spin: 8, pulse: 6, still: 1 };
const splitEmoji = (v) => String(v).split(/\s+/).filter(Boolean).slice(0, 8);

// One item of a layer: an image, a word, a shape or an emoji.
function renderItem(L, v) {
  if (L.kind === 'image') return h('img', { src: safeUrl(v, true), alt: '', loading: 'lazy', referrerPolicy: 'no-referrer', draggable: false });
  if (L.kind === 'text') return h('span', { class: 'word' }, v);
  if (L.kind === 'shape') return h('span', { class: `shape shape-${v}` });
  return document.createTextNode(v);
}
const layerItems = (L) => (L.kind === 'emoji' ? splitEmoji(L.value) : [L.value]).filter((v) => v && (L.kind !== 'image' || safeUrl(v, true)));

function buildScene(layers) {
  const root = $('#floaters');
  root.replaceChildren();
  const stage = $('#stage').getBoundingClientRect();
  const btn = $('#housing').getBoundingClientRect().width || 260;
  const reach = Math.max(80, Math.min(stage.width, stage.height) / 2 - btn / 2);
  layers.forEach((L, li) => {
    const items = layerItems(L);
    if (!items.length) return;
    const layer = h('div', {
      class: 'layer',
      style: `--depth:${10 + li * 14};opacity:${L.opacity};${L.blur ? `filter:blur(${L.blur}px)` : ''}`,
    });
    for (let i = 0; i < L.count; i++) {
      const size = Math.round(L.size * (L.motion === 'still' ? 0.8 + Math.random() * 0.4 : 0.6 + Math.random() * 0.8));
      const d = (BASE_DURATION[L.motion] * (0.7 + Math.random() * 0.6)) / L.speed;
      layer.append(h('div', {
        class: `floater m-${L.motion}${L.kind === 'text' ? ' is-text' : ''}${L.spin ? ' spins' : ''}`,
        style: [
          `--s:${size}px`, `--c:${L.color}`, `--d:${d.toFixed(2)}s`, `--delay:${(-Math.random() * d).toFixed(2)}s`,
          `--x:${(Math.random() * 100).toFixed(1)}`, `--y:${(Math.random() * 100).toFixed(1)}`,
          `--r:${Math.round(btn * 0.62 + size / 2 + Math.random() * reach)}px`,
          `--rot:${Math.round(Math.random() * 60 - 30)}deg`,
          `--spin:${Math.random() < 0.5 ? '-' : ''}${180 + Math.round(Math.random() * 360)}deg`,
        ].join(';'),
      }, h('div', { class: 'fi' }, h('div', { class: 'sp' }, renderItem(L, items[i % items.length])))));
    }
    root.append(layer);
  });
}

// Parallax: layers slide with the cursor, back layers least.
$('#stage').addEventListener('pointermove', (e) => {
  if (!shown || !shown.parallax || e.pointerType !== 'mouse' || reduceMotion()) return;
  const r = $('#stage').getBoundingClientRect();
  const f = $('#floaters').style;
  f.setProperty('--px', (((e.clientX - r.left) / r.width) * 2 - 1).toFixed(3));
  f.setProperty('--py', (((e.clientY - r.top) / r.height) * 2 - 1).toFixed(3));
});
$('#stage').addEventListener('pointerleave', () => { $('#floaters').style.setProperty('--px', 0); $('#floaters').style.setProperty('--py', 0); });

// Burst: layer 1 flies out of the button when it's pressed.
function burst() {
  const L = shown && shown.burst && (shown.layers || [])[0];
  if (!L || reduceMotion()) return;
  const items = layerItems(L);
  if (!items.length) return;
  const stage = $('#stage');
  const reach = Math.min(stage.clientWidth, stage.clientHeight) * 0.45;
  for (let i = 0; i < 14; i++) {
    const angle = (i / 14) * Math.PI * 2 + Math.random() * 0.4;
    const dist = reach * (0.55 + Math.random() * 0.45);
    const el = h('div', {
      class: `burst${L.kind === 'text' ? ' is-text' : ''}`,
      style: `--s:${Math.round(Math.min(L.size, 90) * (0.7 + Math.random() * 0.5))}px;--c:${L.color};--bx:${Math.round(Math.cos(angle) * dist)}px;--by:${Math.round(Math.sin(angle) * dist)}px;--br:${Math.round(Math.random() * 540 - 270)}deg;opacity:${L.opacity}`,
    }, renderItem(L, items[i % items.length]));
    el.addEventListener('animationend', () => el.remove());
    stage.append(el);
  }
}

function parseEmbed(raw) {
  if (!raw) return null;
  if (UPLOAD_PATH.test(String(raw).trim())) return { kind: 'image', src: raw.trim(), href: raw.trim(), host: 'your upload' };
  const href = safeUrl(raw);
  if (!href) return null;
  const u = new URL(href);
  const host = u.hostname.replace(/^(www|m)\./, '');
  let m;
  let yt = null;
  if (host === 'youtu.be') yt = u.pathname.slice(1);
  else if (host.endsWith('youtube.com')) yt = u.searchParams.get('v') || (u.pathname.match(/^\/(?:shorts|embed|live)\/([\w-]+)/) || [])[1];
  if (yt && /^[\w-]{6,20}$/.test(yt)) return { kind: 'youtube', src: `https://www.youtube-nocookie.com/embed/${yt}?rel=0&autoplay=1`, href, host };
  if (host === 'vimeo.com' && (m = u.pathname.match(/^\/(\d+)/))) return { kind: 'vimeo', src: `https://player.vimeo.com/video/${m[1]}?autoplay=1`, href, host };
  if (host === 'open.spotify.com' && (m = u.pathname.match(/^\/(?:intl-\w+\/)?(track|album|playlist|episode|show|artist)\/(\w+)/))) {
    return { kind: 'spotify', src: `https://open.spotify.com/embed/${m[1]}/${m[2]}`, href, host };
  }
  if (/\.(mp4|webm|ogv|mov)$/i.test(u.pathname)) return { kind: 'video', src: href, href, host };
  if (/\.(png|jpe?g|gif|webp|avif|svg)$/i.test(u.pathname)) return { kind: 'image', src: href, href, host };
  return { kind: 'link', href, host, path: (u.pathname + u.search).replace(/^\/$/, '') };
}

// Featured media plays in a popup, loaded only when opened and removed when closed.
function openMedia() {
  const e = shown && parseEmbed(shown.embedUrl);
  if (!e) return;
  const box = $('#mediaBody');
  const frame = (cls = '') => h('div', { class: `frame ${cls}` }, h('iframe', {
    src: e.src, title: 'Featured media', allowFullscreen: true, referrerPolicy: 'strict-origin-when-cross-origin',
    allow: 'autoplay; encrypted-media; picture-in-picture; fullscreen; clipboard-write',
  }));
  $('#mediaTitle').textContent = { youtube: 'Video', vimeo: 'Video', video: 'Video', spotify: 'Listen', image: 'Image' }[e.kind];
  if (e.kind === 'youtube' || e.kind === 'vimeo') box.replaceChildren(frame());
  else if (e.kind === 'spotify') box.replaceChildren(frame('spotify'));
  else if (e.kind === 'video') box.replaceChildren(h('div', { class: 'frame' }, h('video', { src: e.src, controls: true, autoplay: true, playsInline: true })));
  else box.replaceChildren(h('img', { class: 'media', src: e.src, alt: 'Featured image', referrerPolicy: 'no-referrer' }));
  openPopup('mediaPop');
}
$('#mediaPop').addEventListener('close', () => $('#mediaBody').replaceChildren());

// ───────────────────────────── live data ─────────────────────────────

function render(state, holdConfig = false) {
  S = state;
  clockOffset = state.now - Date.now();
  $('#demoBadge').hidden = state.mode !== 'demo';
  $('#modeNote').textContent = state.mode === 'demo'
    ? 'This is a demo, so bids are not charged.'
    : 'Payments are handled by Stripe. If someone outbids you while you pay, you are refunded automatically.';
  if (!previewing && !holdConfig && !wiping) applyConfig(state.config);
  for (const el of $$('[data-min-bid]')) setText(el, money(state.minNextBid));
  renderViewers(state.viewers);
  renderPlate();
  renderTicker();
  renderStats();
  renderChart();
  renderHistory();
  tick();
  $('#editBtn').hidden = !myOwnership();
  if (previewing && mode === 'bid') syncAmountFloor();
}

function renderViewers(v) {
  setText($('#viewers'), num(v));
  setText($('#sWatching'), num(v));
}

// The lower third: who's on air right now.
function renderPlate() {
  const o = S.owner;
  $('#lowerThird').classList.toggle('open', !o);
  setText($('#ltTag'), o ? 'Now on air' : 'Airtime for sale');
  if (o) {
    setText($('#ltName'), o.name);
    $('#ltMeta').replaceChildren('Paid ', h('b', {}, money(o.amount)), ' · on air ', h('b', { 'data-since': o.since }, dur(now() - o.since)));
  } else {
    setText($('#ltName'), 'This slot is open');
    $('#ltMeta').replaceChildren('Opening bid ', h('b', {}, money(S.minNextBid)), ' · press the button to bid');
  }
}

// The news crawl: rebuilt only when the takeovers change, so the scroll doesn't jump.
function renderTicker() {
  const key = JSON.stringify([S.bids.map((b) => b.at), S.minNextBid, S.owner && S.owner.name]);
  if (key === applied.ticker) return;
  applied.ticker = key;
  const items = S.owner
    ? [['Now on air: ', S.owner.name, ` · ${money(S.owner.amount)}`], ['Take the button for ', money(S.minNextBid), '']]
    : [['Airtime for sale · opening bid ', money(S.minNextBid), ''], ['Pay the most and this page is yours', '', '']];
  for (const b of S.bids.slice(0, 12)) items.push([`${timeOfDay(b.at)} · `, b.name, ` takes the button for ${money(b.amount)}`]);
  const make = () => items.map(([before, bold, after]) => h('span', { class: 'tick' }, before, bold ? h('b', {}, bold) : null, after));
  const track = $('#ticker');
  track.replaceChildren(...make(), ...make());
  requestAnimationFrame(() => track.style.setProperty('--dur', `${Math.max(20, track.scrollWidth / 2 / 70).toFixed(1)}s`));
}

function renderStats() {
  const o = S.owner;
  const st = S.stats;
  const price = $('#sPrice');
  setText($('#sPriceLabel'), o ? 'Current price' : 'Right now');
  setText(price, o ? money(o.amount) : 'Up for grabs');
  price.classList.toggle('is-word', !o);
  const line = $('#sOwnerLine');
  line.replaceChildren(...(o ? ['Owned by ', h('b', {}, o.name)] : ['Opening bid ', h('b', { class: 'num' }, money(S.minNextBid))]));
  const r = o || { impressions: 0, clicks: 0, reactions: 0 };
  setText($('#mViews'), num(r.impressions));
  setText($('#mPresses'), num(r.clicks));
  setText($('#mRate'), pct(r.clicks, r.impressions));
  const rate = r.impressions ? Math.min(100, (r.clicks / r.impressions) * 100) : 0;
  $('#rateGauge').setAttribute('stroke-dasharray', `${rate.toFixed(1)} 100`);
  $('#rateGauge').style.visibility = rate > 0 ? 'visible' : 'hidden'; // a round cap would draw a dot at 0%
  setText($('#mReacts'), num(r.reactions));
  setText($('#reignOwner'), o ? o.name : 'Nobody yet');
  setText($('#aRaised'), money(st.totalRaised));
  setText($('#aRaisedSub'), `${num(st.totalBids)} winning bid${st.totalBids === 1 ? '' : 's'}`);
  setText($('#aOwners'), num(st.owners));
  setText($('#aVisitors'), num(st.uniqueVisitors));
  setText($('#aVisitorsSub'), `${num(st.totalVisits)} visit${st.totalVisits === 1 ? '' : 's'}`);
  setText($('#aPeak'), num(st.peakViewers));
  setText($('#aGrowth'), o && st.firstBid && st.totalBids > 1 ? `+${num(Math.round((o.amount / st.firstBid - 1) * 100))}%` : '–');
}

// Runs every second: reign clocks and anything marked with data-since.
function tick() {
  const d = new Date();
  setText($('#clock'), `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`);
  if (!S) return;
  const o = S.owner;
  setText($('#sHeld'), o ? clock(now() - o.since) : '–');
  for (const el of $$('[data-since]')) setText(el, dur(now() - Number(el.dataset.since)));
  // The server's record is a snapshot; the reigning owner can overtake it between updates.
  let lr = S.stats.longestReign;
  if (o && (!lr || lr.current || now() - o.since > lr.ms)) lr = { name: o.name, ms: now() - o.since, current: true };
  setText($('#aLongest'), lr ? dur(lr.ms) : '–');
  setText($('#aLongestSub'), lr ? `${lr.name}${lr.current ? ', holding' : ''}` : '');
}
setInterval(tick, 1000);

// Price history: a step line with a dot per takeover and a glowing "now" dot; hover for details.
let chartPts = [];
function renderChart() {
  const pts = [...S.history].reverse().map((x) => ({ t: x.since, a: x.amount, name: x.name }));
  if (S.owner) pts.push({ t: S.owner.since, a: S.owner.amount, name: S.owner.name });
  const has = pts.length > 0;
  // SVG elements ignore the .hidden property, so toggle the attribute.
  $('#chart').toggleAttribute('hidden', !has);
  $('#chartEmpty').hidden = has;
  $('#chartBox').classList.toggle('empty', !has);
  $('#chartAxis').hidden = !has;
  $('#chartPaths').replaceChildren();
  $('#chartDots').replaceChildren();
  $('#chartTip').hidden = true;
  setText($('#chartRange'), pts.length > 1 ? `${money(pts[0].a)} → ${money(pts.at(-1).a)}` : '');
  chartPts = [];
  if (!has) return;

  const W = 600, H = 136, PAD = 14;
  const t0 = pts[0].t, t1 = Math.max(now(), t0 + 60_000);
  const aMax = Math.max(...pts.map((p) => p.a)) * 1.18;
  const x = (t) => PAD + ((t - t0) / (t1 - t0)) * (W - PAD * 2);
  const y = (a) => H - (a / aMax) * (H - 8);
  let d = `M${x(pts[0].t).toFixed(1)},${y(pts[0].a).toFixed(1)}`;
  for (const p of pts.slice(1)) d += ` H${x(p.t).toFixed(1)} V${y(p.a).toFixed(1)}`;
  d += ` H${(W - PAD).toFixed(1)}`;
  const svgNS = 'http://www.w3.org/2000/svg';
  const path = (cls, dd) => { const el = document.createElementNS(svgNS, 'path'); el.setAttribute('class', cls); el.setAttribute('d', dd); return el; };
  $('#chartPaths').append(path('area', `${d} V150 H${x(t0).toFixed(1)} Z`), path('line', d));

  chartPts = pts.map((p) => ({ ...p, fx: x(p.t) / W, fy: y(p.a) / 150 }));
  const last = pts.at(-1);
  chartPts.push({ ...last, t: null, now: true, fx: (W - PAD) / W, fy: y(last.a) / 150 });
  $('#chartDots').append(...chartPts.map((p) => h('span', {
    class: `chart-dot${p.now ? ' now' : ''}`,
    style: `left:${(p.fx * 100).toFixed(2)}%;top:${(p.fy * 100).toFixed(2)}%`,
  })));
  const first = new Date(t0);
  setText($('#axisStart'), Date.now() - t0 < 86_400_000
    ? first.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
    : first.toLocaleDateString([], { month: 'short', day: 'numeric' }));
}

$('#chartBox').addEventListener('pointermove', (e) => {
  if (!chartPts.length) return;
  const box = $('#chartBox').getBoundingClientRect();
  const fx = (e.clientX - box.left) / box.width;
  let best = 0;
  chartPts.forEach((p, i) => { if (Math.abs(p.fx - fx) < Math.abs(chartPts[best].fx - fx)) best = i; });
  const p = chartPts[best];
  $$('.chart-dot').forEach((dot, i) => dot.classList.toggle('hot', i === best));
  const tip = $('#chartTip');
  const when = p.now ? 'holding now' : `took it ${new Date(p.t).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`;
  tip.replaceChildren(h('b', {}, money(p.a)), h('span', {}, `${p.name} · ${when}`));
  tip.hidden = false;
  const dots = $('#chartDots').getBoundingClientRect();
  const half = tip.offsetWidth / 2 + 8; // keep the whole tip inside the chart
  const left = Math.min(Math.max(p.fx * box.width, half), box.width - half);
  tip.style.left = `${left}px`;
  tip.style.top = `${dots.top - box.top + p.fy * dots.height}px`;
  tip.classList.toggle('below', p.fy < 0.5); // no room above high points, so show the tip underneath
});
$('#chartBox').addEventListener('pointerleave', () => {
  $('#chartTip').hidden = true;
  $$('.chart-dot').forEach((dot) => dot.classList.remove('hot'));
});

// ── History: every reign is an episode ──
let histSort = 'latest';
let histQuery = '';
const openEpisodes = new Set(); // keep expanded rows open across live updates

const fmtWhen = (t) => new Date(t).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
const lookFromConfig = (c) => ({
  bgType: c.bgType, bg1: c.bg1, bg2: c.bg2, bgAngle: c.bgAngle, bgImage: c.bgImage, textColor: c.textColor, font: c.font,
  headline: c.headline, buttonColor: c.buttonColor, buttonTextColor: c.buttonTextColor, buttonText: c.buttonText,
});

// Oldest → newest, with episode numbers, neighbours and records worked out.
function episodes() {
  const list = [...S.history].reverse().map((e) => ({ ...e }));
  if (S.owner) list.push({ ...S.owner, until: null, current: true, swatch: S.config.buttonColor, link: S.config.linkUrl, look: lookFromConfig(S.config) });
  const first = S.stats.totalBids - list.length + 1;
  const mine = new Set(store.get('tb_mine') || []);
  list.forEach((e, i) => {
    e.ep = first + i;
    e.prev = list[i - 1] || null;
    e.next = list[i + 1] || null;
    e.held = (e.until || now()) - e.since;
    e.mine = mine.has(e.since);
    e.selfRaise = !!(e.prev && e.prev.name === e.name);
  });
  const best = (key) => list.reduce((a, e) => (e[key] > (a ? a[key] : 0) ? e : a), null);
  const top = best('amount'), longest = best('held'), pressed = best('clicks');
  for (const e of list) {
    e.badges = [];
    if (e.current) e.badges.push(['now', 'Now']);
    if (e.mine) e.badges.push(['you', 'You']);
    if (list.length > 1 && e === top) e.badges.push(['top', 'Top bid']);
    if (list.length > 1 && e === longest) e.badges.push(['long', 'Longest']);
    if (pressed && pressed.clicks > 0 && list.length > 1 && e === pressed) e.badges.push(['press', 'Most pressed']);
    if (e.selfRaise) e.badges.push(['self', 'Raised own bid']);
  }
  return list;
}

// A tiny picture of the owner's page: their background, headline and button.
function thumb(e, big = false) {
  const L = e.look;
  const el = h('span', { class: `thumb${big ? ' big' : ''}`, style: L ? `background:${bgCss({ ...L, bgImage: L.bgImage || '' })}` : 'background:#1d1f21' });
  if (big && L && L.headline) el.append(h('span', { class: 'thumb-head', style: `color:${L.textColor};font-family:'${L.font}',var(--ui)` }, L.headline));
  el.append(h('span', { class: 'thumb-btn', style: `background:${(L && L.buttonColor) || e.swatch}` }));
  return el;
}

const sep = () => h('span', { class: 'dot-sep' }, '·');
const heldEl = (e) => (e.current ? h('span', { 'data-since': e.since }, dur(now() - e.since)) : dur(e.held));
const pctUp = (e) => (e.prev && e.prev.amount ? Math.round((e.amount / e.prev.amount - 1) * 100) : null);

function episodeRow(e) {
  const up = pctUp(e);
  const details = h('details', { class: 'ep', 'data-ep': e.ep, open: openEpisodes.has(e.ep) });
  details.addEventListener('toggle', () => { if (details.open) openEpisodes.add(e.ep); else openEpisodes.delete(e.ep); });
  const tags = e.badges.slice(0, 2).map(([k, t]) => h('span', { class: `badge b-${k}` }, t));
  details.append(
    h('summary', {},
      h('span', { class: 'ep-no' }, 'EP', h('b', {}, String(e.ep).padStart(2, '0'))),
      thumb(e),
      h('span', { class: 'who' },
        h('span', { class: 'who-line' }, h('b', {}, e.name), ...tags),
        h('span', { class: 'meta' }, e.current ? 'On air ' : 'Held ', heldEl(e), sep(), `took over ${timeOfDay(e.since)}`)),
      h('span', { class: 'paid' }, h('b', {}, money(e.amount)), up != null ? h('small', {}, `+${num(up)}%`) : h('small', {}, 'First bid')),
      icon('chevron')),
    episodeBody(e));
  return h('li', { class: e.current ? 'is-now' : '' }, details);
}

function episodeBody(e) {
  const row = (k, ...v) => h('div', {}, h('dt', {}, k), h('dd', {}, ...v));
  const up = pctUp(e);
  const link = safeUrl(e.link);
  const lines = [
    row('Took over', fmtWhen(e.since)),
    row('On air', `${timeOfDay(e.since)} → `, e.current ? 'now' : timeOfDay(e.until), ' (', heldEl(e), ')'),
    row('Paid', money(e.amount), up != null ? h('span', { class: 'up' }, e.selfRaise ? ` raised their own bid ${num(up)}%` : ` +${num(up)}% over the last owner`) : ''),
    row('Took it from', !e.prev ? 'Nobody. First owner of this run' : e.selfRaise ? `Themselves (${money(e.prev.amount)})` : e.prev.name),
  ];
  if (!e.current) lines.push(row('Lost it to', e.next ? `${e.next.name}, for ${money(e.next.amount)}` : '–'));
  if (e.look && e.look.headline) lines.push(row('Headline', `“${e.look.headline}”`));
  const extra = e.badges.slice(2); // the first two are already on the row
  const allBadges = extra.length ? h('div', { class: 'badges' }, ...extra.map(([k, t]) => h('span', { class: `badge b-${k}` }, t))) : null;
  return h('div', { class: 'ep-body' },
    h('div', { class: 'ep-top' }, thumb(e, true), h('dl', { class: 'ep-list' }, ...lines)),
    allBadges,
    h('div', { class: 'ep-metrics' },
      h('div', {}, h('span', { class: 'label' }, 'Page views'), h('b', {}, num(e.impressions || 0))),
      h('div', {}, h('span', { class: 'label' }, 'Presses'), h('b', {}, num(e.clicks || 0))),
      h('div', {}, h('span', { class: 'label' }, 'Press rate'), h('b', {}, pct(e.clicks || 0, e.impressions || 0))),
      h('div', {}, h('span', { class: 'label' }, 'Reactions'), h('b', {}, num(e.reactions || 0)))),
    link ? h('a', { class: 'btn glass-btn sm ep-visit', href: link, target: '_blank', rel: 'noopener noreferrer nofollow' }, `Visit ${hostOf(link)}`, icon('external')) : null);
}

function renderHistory() {
  const all = episodes();
  const names = new Set(all.map((e) => e.name.toLowerCase()));
  const top = all.reduce((a, e) => (!a || e.amount > a.amount ? e : a), null);
  const longest = all.reduce((a, e) => (!a || e.held > a.held ? e : a), null);
  const cell = (label, value, sub) => h('div', {}, h('span', { class: 'label' }, label), h('b', {}, value), h('span', { class: 'sub' }, sub || ''));
  $('#histSummary').replaceChildren(...(all.length ? [
    cell('Takeovers', num(S.stats.totalBids), 'all time'),
    cell('Owners', num(names.size), all.length < S.stats.totalBids ? `in the last ${all.length}` : 'different names'),
    cell('Top bid', money(top.amount), top.name),
    cell('Longest reign', dur(longest.held), longest.name),
  ] : []));
  $('#histSummary').hidden = !all.length;
  $('#histControls').hidden = all.length < 2;
  $('.hist-search').hidden = all.length < 6;

  const q = histQuery.trim().toLowerCase();
  const shown = all.filter((e) => !q || e.name.toLowerCase().includes(q));
  const by = { latest: (a, b) => b.since - a.since, amount: (a, b) => b.amount - a.amount, held: (a, b) => b.held - a.held, clicks: (a, b) => b.clicks - a.clicks || b.since - a.since };
  shown.sort(by[histSort]);
  $('#historyList').replaceChildren(...shown.map(episodeRow));
  $('#historyEmpty').hidden = all.length > 0;
  $('#historyNoMatch').hidden = !all.length || shown.length > 0;
}

$$('[data-sort]').forEach((b) => b.addEventListener('click', () => {
  histSort = b.dataset.sort;
  for (const x of $$('[data-sort]')) x.setAttribute('aria-selected', String(x === b));
  if (S) renderHistory();
}));
$('#histSearch').addEventListener('input', (e) => { histQuery = e.target.value; if (S) renderHistory(); });

// ───────────────────────────── ownership ─────────────────────────────

const myOwnership = () => {
  const mine = store.get('tb_owner');
  return mine && S && S.owner && S.owner.since === mine.since ? mine : null;
};

// Opened from a private edit link (#edit=<token>.<since>) on another device.
(function claimEditLink() {
  const m = location.hash.match(/^#edit=([\w-]+)\.(\d+)$/);
  if (!m) return;
  store.set('tb_owner', { token: m[1], since: Number(m[2]) });
  history.replaceState(null, '', location.pathname);
})();

function showWon(token, since, name, amount) {
  store.set('tb_owner', { token, since });
  store.set('tb_mine', [...new Set([...(store.get('tb_mine') || []), since])].slice(-50));
  const o = S && S.owner && S.owner.since === since ? S.owner : null;
  $('#rName').textContent = name || (o && o.name) || '–';
  $('#rAmount').textContent = amount ? money(amount) : o ? money(o.amount) : '–';
  $('#rTime').textContent = new Date(since).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });
  $('#editLink').value = `${location.origin}/#edit=${token}.${since}`;
  $('#copyEdit').textContent = 'Copy';
  openPopup('wonDialog');
}
$('#copyEdit').addEventListener('click', async () => {
  const input = $('#editLink');
  try { await navigator.clipboard.writeText(input.value); } catch { input.select(); document.execCommand('copy'); }
  $('#copyEdit').textContent = 'Copied';
});
$('#wonDialog').addEventListener('close', () => { ring(); $('#editBtn').hidden = !myOwnership(); });

// ───────────────────────────── the wizard ─────────────────────────────

const FONTS = ['Big Shoulders Display', 'Bebas Neue', 'Inter', 'Playfair Display', 'Space Mono', 'Pacifico', 'Permanent Marker', 'Press Start 2P'];

// Themes set colors, type and a starter scene. Image layers the owner added are kept.
const PRESETS = {
  'Cola Blue': {
    bgType: 'gradient', bg1: '#0050b5', bg2: '#001a4d', bgAngle: 180, textColor: '#ffffff', buttonColor: '#e4002b', buttonTextColor: '#ffffff', font: 'Bebas Neue', parallax: true, burst: true,
    layers: [
      { kind: 'shape', value: 'circle', color: '#ffffff', motion: 'rise', count: 28, size: 16, speed: 0.75, opacity: 0.35 },
      { kind: 'emoji', value: '🥤 🧊', motion: 'float', count: 12, size: 64 },
    ],
  },
  'Neon Night': {
    bgType: 'gradient', bg1: '#0d0221', bg2: '#3a0ca3', bgAngle: 135, textColor: '#f6f7ff', buttonColor: '#ff2a6d', buttonTextColor: '#ffffff', font: 'Press Start 2P', parallax: true, burst: true,
    layers: [
      { kind: 'shape', value: 'ring', color: '#ff2a6d', motion: 'pulse', count: 7, size: 130, speed: 0.75, opacity: 0.45, blur: 3 },
      { kind: 'text', value: 'PLAY', color: '#00f0ff', motion: 'drift', count: 5, size: 64, opacity: 0.85 },
      { kind: 'emoji', value: '👾 ⚡', motion: 'bounce', count: 6, size: 44 },
    ],
  },
  Sunset: {
    bgType: 'gradient', bg1: '#ff7e5f', bg2: '#feb47b', bgAngle: 170, textColor: '#2b1100', buttonColor: '#2b1100', buttonTextColor: '#ffe8d6', font: 'Playfair Display', parallax: true, burst: true,
    layers: [
      { kind: 'shape', value: 'circle', color: '#fff3d6', motion: 'float', count: 6, size: 190, speed: 0.5, opacity: 0.3, blur: 12 },
      { kind: 'emoji', value: '🌴 ☀️', motion: 'float', count: 10, size: 54, speed: 0.75 },
    ],
  },
  'Gold Rush': {
    bgType: 'gradient', bg1: '#1a1400', bg2: '#4a3b00', bgAngle: 200, textColor: '#ffd700', buttonColor: '#ffd700', buttonTextColor: '#1a1400', font: 'Big Shoulders Display', parallax: false, burst: true,
    layers: [
      { kind: 'shape', value: 'star', color: '#ffd700', motion: 'spin', count: 18, size: 26, speed: 0.75, opacity: 0.6 },
      { kind: 'emoji', value: '💰 🪙 💎', motion: 'rain', count: 24, size: 40 },
    ],
  },
  Forest: {
    bgType: 'gradient', bg1: '#0b3d2e', bg2: '#1f6f50', bgAngle: 160, textColor: '#eafff4', buttonColor: '#f4d35e', buttonTextColor: '#0b3d2e', font: 'Pacifico', parallax: true, burst: true,
    layers: [
      { kind: 'emoji', value: '🌲', motion: 'still', count: 7, size: 110, opacity: 0.45, blur: 6 },
      { kind: 'emoji', value: '🌿 🍃', motion: 'rain', count: 18, size: 44, speed: 0.5 },
    ],
  },
  Space: {
    bgType: 'gradient', bg1: '#000000', bg2: '#0b1d3a', bgAngle: 180, textColor: '#ffffff', buttonColor: '#7c5cff', buttonTextColor: '#ffffff', font: 'Space Mono', parallax: true, burst: true,
    layers: [
      { kind: 'shape', value: 'circle', color: '#ffffff', motion: 'still', count: 40, size: 10, opacity: 0.7 },
      { kind: 'emoji', value: '🪐 🚀 ⭐', motion: 'orbit', count: 10, size: 44 },
    ],
  },
  Paper: {
    bgType: 'solid', bg1: '#f3f4f0', bg2: '#f3f4f0', bgAngle: 180, textColor: '#111111', buttonColor: '#111111', buttonTextColor: '#f3f4f0', font: 'Inter', parallax: true, burst: false,
    layers: [{ kind: 'shape', value: 'blob', color: '#111111', motion: 'float', count: 3, size: 240, speed: 0.4, opacity: 0.1 }],
  },
  Graffiti: {
    bgType: 'gradient', bg1: '#ff006e', bg2: '#ffbe0b', bgAngle: 120, textColor: '#111111', buttonColor: '#111111', buttonTextColor: '#ffbe0b', font: 'Permanent Marker', parallax: false, burst: true,
    layers: [
      { kind: 'text', value: 'WOW', color: '#111111', motion: 'bounce', count: 4, size: 90, opacity: 0.9 },
      { kind: 'emoji', value: '🎨 💥', motion: 'pulse', count: 8, size: 60 },
    ],
  },
};
// Some themes show off text effects; the rest reset them, so switching themes never leaves a stray glow.
Object.assign(PRESETS['Cola Blue'], { uppercase: true, textShadow: 'soft', shadowColor: '#000c26' });
Object.assign(PRESETS['Neon Night'], { textShadow: 'glow', shadowColor: '#ff2a6d', textAnim: 'flicker' });
Object.assign(PRESETS['Gold Rush'], { textFill: 'gradient', textColor2: '#ff9f1a', textGradAngle: 180, textShadow: 'extrude', shadowColor: '#3a2a00', textAnim: 'shimmer' });
Object.assign(PRESETS.Graffiti, { textStroke: 2.5, strokeColor: '#ffffff', textShadow: 'hard', shadowColor: '#111111', letterSpacing: 2 });
Object.assign(PRESETS.Space, { letterSpacing: 12, uppercase: true, textShadow: 'glow', shadowColor: '#7c5cff' });
Object.assign(PRESETS['Cola Blue'], { bgAnimate: true, vignette: 30 });
Object.assign(PRESETS['Neon Night'], { texture: 'grid', textureColor: '#00f0ff', textureOpacity: 0.1, textureScale: 32, vignette: 45 });
Object.assign(PRESETS.Sunset, { gradStyle: 'radial', gradPos: 'bottom', bg3On: true, bg3: '#ff9a76', grain: 25 });
Object.assign(PRESETS['Gold Rush'], { vignette: 55, grain: 30 });
Object.assign(PRESETS.Space, { bgType: 'mesh', bg1: '#02030a', bg2: '#1b2a6b', bg3: '#4b1d6b', bgAnimate: true, bgSpeed: 0.5 });
Object.assign(PRESETS.Paper, { grain: 35, texture: 'dots', textureColor: '#111111', textureOpacity: 0.08, textureScale: 20 });
Object.assign(PRESETS['Neon Night'], { beatStyle: 'trap', beatMatch: false, beatColor: '#00f0ff', beatBpm: 140, beatIntensity: 80, beatShake: true, beatParticles: true });
Object.assign(PRESETS['Gold Rush'], { beatStyle: 'halo', beatBpm: 96 });
for (const name of Object.keys(PRESETS)) PRESETS[name] = { ...TEXT_STYLE, ...BG_STYLE, ...BEAT_STYLE, ...PRESETS[name] };

const EMOJI_SETS = [['🥤', '🧊', '🫧'], ['🌮', '🌶️', '🥑'], ['💸', '👑', '🔥'], ['🚀', '🪐', '⭐'], ['🎧', '🎵', '💿'], ['🍕', '🍟', '🍔'], ['❤️', '✨', '🌸']];
const STARTER = { ...TEXT_DEFAULTS, ...BG_STYLE, ...BEAT_STYLE, ...PRESETS['Neon Night'], headline: '', tagline: '', buttonText: 'Visit us', linkUrl: '', embedUrl: '', bgImage: '', links: [], patternUrl: '', patternSize: 120, patternOpacity: 0.15 };

const MAX_LAYERS = 4;
const SHAPES = ['circle', 'ring', 'square', 'diamond', 'triangle', 'star', 'heart', 'blob'];
const KIND_NAMES = { image: 'Image', text: 'Text', shape: 'Shape', emoji: 'Emoji' };
const MOTION_NAMES = { float: 'Hover', rain: 'Rain', rise: 'Rise', drift: 'Drift', orbit: 'Orbit', bounce: 'Bounce', spin: 'Spin', pulse: 'Pulse', still: 'Still' };
const LAYER_DEFAULTS = { kind: 'image', value: '', color: '#ffffff', motion: 'float', count: 12, size: 48, speed: 1, opacity: 1, blur: 0, spin: false };

const pop = $('#bidPop');
const form = $('#bidForm');
const F = form.elements;
const wide = matchMedia('(min-width: 900px)');
let step = 1;
let adv = false;
let advTab = 'bg';
let peeking = false; // mobile: sheet hidden to look at the preview
let linkRows = 1;

$('#presets').append(...Object.entries(PRESETS).map(([name, p]) => {
  const emoji = p.layers.find((l) => l.kind === 'emoji');
  return h('button', {
    type: 'button', class: 'theme',
    onclick: () => {
      const cur = readForm();
      const keep = cur.layers.filter((l) => l.kind === 'image' && l.value);
      fillForm({ ...cur, ...p, layers: [...keep, ...p.layers].slice(0, MAX_LAYERS) });
      onFormInput();
    },
  },
  h('span', { class: 'theme-swatch', style: `background:${bgCss(p)}` },
    h('span', { class: 'theme-dot', style: `background:${p.buttonColor}` }),
    emoji ? h('span', { class: 'theme-float' }, splitEmoji(emoji.value)[0]) : null),
  name);
}));

for (const [key, fx] of Object.entries(FILTERS)) {
  $(fx.wild ? '#filtersWild' : '#filtersClean').append(h('label', { title: fx.name },
    h('input', { type: 'radio', name: 'bgFilter', value: key }),
    h('span', { class: 'fx-tile' }, h('span', { class: fx.anim ? `fx-${fx.anim}` : '', style: fx.css ? `filter:${fx.css}` : '' })),
    h('span', { class: 'fx-name' }, fx.name)));
}

$('#fontPick').append(...FONTS.map((f) => h('label', {},
  h('input', { type: 'radio', name: 'font', value: f }),
  h('span', {}, h('span', { class: 'aa', style: `font-family:'${f}'` }, 'Aa'), h('span', { class: 'fname' }, f)))));

// ── Steps ──
const stepList = () => (mode === 'bid' ? [1, 2, 3] : [2, 3]);
const STEP_TITLES = { 2: 'Your look', 3: 'Link & media' };

function setStep(n, advanced = false) {
  step = n;
  adv = advanced;
  for (const s of $$('[data-step]', form)) s.hidden = advanced ? s.dataset.step !== 'adv' : s.dataset.step !== String(n);
  const list = stepList();
  const i = list.indexOf(n);
  const last = i === list.length - 1;
  $('#wizEyebrow').textContent = advanced ? 'Your look' : `Step ${i + 1} of ${list.length}`;
  $('#wizTitle').textContent = advanced ? 'Customize'
    : n === 1 ? (S && S.owner ? `Outbid ${S.owner.name}` : 'Take the button')
      : STEP_TITLES[n];
  $('#progress').replaceChildren(...list.map((_, k) => h('span', { class: k <= i ? 'on' : '' })));
  $('#progress').hidden = advanced;
  $('#backBtn').hidden = !advanced && i === 0;
  $('#nextBtn').hidden = !advanced && last;
  $('#nextBtn').replaceChildren(advanced ? 'Done' : 'Continue', icon(advanced ? 'check' : 'arrow'));
  $('#submitBtn').hidden = advanced || !last;
  // Past step 1 the page itself is the point, so the popup steps aside.
  const side = advanced || n !== 1;
  pop.classList.toggle('side', side);
  pop.classList.toggle('has-preview', side);
  document.body.classList.toggle('wiz-side', side && wide.matches);
  $('#previewTag').hidden = !side;
  $('.pop-body', pop).scrollTop = 0;
  if (advanced) setAdvTab(advTab);
  syncFormUi();
  setTimeout(placeOrbitCenter, 380);
}
wide.addEventListener('change', () => {
  if (pop.open) document.body.classList.toggle('wiz-side', pop.classList.contains('side') && wide.matches);
});

function setAdvTab(t) {
  advTab = t;
  for (const b of $$('[data-adv-tab]')) b.setAttribute('aria-selected', String(b.dataset.advTab === t));
  for (const p of $$('[data-adv]')) p.hidden = p.dataset.adv !== t;
}
$$('[data-adv-tab]').forEach((b) => b.addEventListener('click', () => setAdvTab(b.dataset.advTab)));
$('#moreBtn').addEventListener('click', () => setStep(2, true));

$('#backBtn').addEventListener('click', () => {
  if (adv) return setStep(2);
  const list = stepList();
  setStep(list[Math.max(0, list.indexOf(step) - 1)]);
});
$('#nextBtn').addEventListener('click', () => {
  if (adv) return setStep(2);
  if (!validateStep(step)) return;
  const list = stepList();
  setStep(list[list.indexOf(step) + 1]);
});

// ── Scene layers ──
let layerUid = 0;
const layerCards = () => $$('#layers .layer-card');

function layerCard(L) {
  const card = $('#layerTpl').content.firstElementChild.cloneNode(true);
  const uid = ++layerUid;
  $$('[data-k="kind"]', card).forEach((r) => { r.name = `kind-${uid}`; });
  $('.shapes', card).append(...SHAPES.map((sh) => h('label', { title: sh },
    h('input', { type: 'radio', name: `shape-${uid}`, value: sh, 'aria-label': sh }),
    h('span', {}, h('span', { class: `shape shape-${sh}` })))));
  $('.lc-sets', card).append(...EMOJI_SETS.map((set) => h('button', {
    type: 'button', class: 'chip',
    onclick: () => { $('[data-k="emoji"]', card).value = set.join(' '); onFormInput(); },
  }, set.join(' '))));
  card.open = false;
  setLayer(card, L);
  return card;
}

function setLayer(card, raw) {
  const L = { ...LAYER_DEFAULTS, ...raw };
  $$('[data-k="kind"]', card).forEach((r) => { r.checked = r.value === L.kind; });
  for (const k of ['image', 'text', 'emoji']) $(`[data-k="${k}"]`, card).value = L.kind === k ? L.value : '';
  $$('.shapes input', card).forEach((r) => { r.checked = r.value === (L.kind === 'shape' ? L.value : 'circle'); });
  for (const k of ['color', 'motion', 'count', 'size', 'speed', 'opacity', 'blur']) $(`[data-k="${k}"]`, card).value = L[k];
  $('[data-k="spin"]', card).checked = !!L.spin;
}

function readLayer(card) {
  const kind = ($('[data-k="kind"]:checked', card) || {}).value || 'image';
  const value = kind === 'shape' ? ($('.shapes input:checked', card) || {}).value || 'circle' : $(`[data-k="${kind}"]`, card).value.trim();
  const n = (k) => Number($(`[data-k="${k}"]`, card).value);
  return {
    kind, value,
    color: $('[data-k="color"]', card).value,
    motion: $('[data-k="motion"]', card).value,
    count: n('count'), size: n('size'), speed: n('speed'), opacity: n('opacity'), blur: n('blur'),
    spin: $('[data-k="spin"]', card).checked,
  };
}

function fmtSlider(k, v) {
  if (k === 'bgAngle' || k === 'textGradAngle') return `${v}°`;
  if (k === 'headlineSize' || k === 'taglineSize' || k === 'bgBright' || k === 'vignette' || k === 'grain') return `${v}%`;
  if (k === 'overlayOpacity' || k === 'textureOpacity') return `${Math.round(v * 100)}%`;
  if (k === 'bgBlur') return Number(v) ? `${v}px` : 'Off';
  if (k === 'textureScale') return `${v}px`;
  if (k === 'bgSpeed') return `${v}×`;
  if (k === 'audioVolume' || k === 'beatIntensity') return `${v}%`;
  if (k === 'beatBpm') return `${v} bpm`;
  if (k === 'textStroke') return Number(v) ? `${v}px` : 'Off';
  if (k === 'letterSpacing') return Number(v) > 0 ? `+${v}` : String(v);
  if (k === 'speed') return `${v}×`;
  if (k === 'opacity' || k === 'patternOpacity') return `${Math.round(v * 100)}%`;
  if (k === 'size' || k === 'blur' || k === 'patternSize') return `${v}px`;
  return String(v);
}

function syncLayerCards() {
  const cards = layerCards();
  cards.forEach((card, i) => {
    const L = readLayer(card);
    $('.lc-title', card).textContent = `Layer ${i + 1}`;
    $('.lc-sum', card).textContent = `${KIND_NAMES[L.kind]} · ${MOTION_NAMES[L.motion]} · ${L.count}`;
    const thumb = $('.lc-thumb', card);
    thumb.style.setProperty('--c', L.color);
    const first = layerItems(L)[0];
    thumb.replaceChildren(first ? (L.kind === 'text' ? h('span', { class: 'word' }, first.slice(0, 4)) : renderItem(L, first)) : '+');
    for (const el of $$('[data-kind]', card)) el.hidden = !el.dataset.kind.split(' ').includes(L.kind);
    for (const out of $$('.slider output', card)) out.textContent = fmtSlider($('input', out.parentElement).dataset.k, $('input', out.parentElement).value);
    $('[data-act="up"]', card).disabled = i === 0;
    $('[data-act="down"]', card).disabled = i === cards.length - 1;
  });
  $('#addLayer').disabled = cards.length >= MAX_LAYERS;
}

$('#layers').addEventListener('click', (e) => {
  const btn = e.target.closest('[data-act]');
  if (!btn) return;
  e.preventDefault(); // don't toggle the <details>
  const card = btn.closest('.layer-card');
  if (btn.dataset.act === 'remove') card.remove();
  if (btn.dataset.act === 'up' && card.previousElementSibling) card.previousElementSibling.before(card);
  if (btn.dataset.act === 'down' && card.nextElementSibling) card.nextElementSibling.after(card);
  syncLogoFromLayers();
  onFormInput();
});
$('#addLayer').addEventListener('click', () => {
  if (layerCards().length >= MAX_LAYERS) return;
  // Start with something visible right away: their name, drifting in their button color.
  const name = F.name.value.trim() || (S && S.owner && mode === 'edit' ? S.owner.name : '') || 'Your brand';
  const card = layerCard({ kind: 'text', value: name.slice(0, 30), color: F.buttonColor.value, motion: 'drift', count: 6, size: 64, opacity: 0.9 });
  layerCards().forEach((c) => { c.open = false; });
  card.open = true;
  $('#layers').append(card);
  onFormInput();
});

// ── "Your logo": a shortcut for image layer 1 ──
function renderLogoThumb() {
  const u = safeUrl($('#logoUrl').value, true);
  $('#logoThumb').replaceChildren(u ? h('img', { src: u, alt: '' }) : '+');
}
function syncLogoFromLayers() {
  const first = layerCards()[0];
  const L = first && readLayer(first);
  $('#logoUrl').value = L && L.kind === 'image' ? L.value : '';
  renderLogoThumb();
}
$('#logoUrl').addEventListener('input', () => {
  const url = $('#logoUrl').value.trim();
  const first = layerCards()[0];
  if (first && readLayer(first).kind === 'image') {
    if (url) $('[data-k="image"]', first).value = url;
    else first.remove();
  } else if (url) {
    $('#layers').prepend(layerCard({ kind: 'image', value: url, motion: 'float', count: 8, size: 90 }));
    while (layerCards().length > MAX_LAYERS) layerCards().at(-1).remove();
  }
  renderLogoThumb();
});

// ── Extra links: one row at a time ──
function syncLinkRows() {
  const filled = [0, 1, 2].filter((i) => F[`l${i}label`].value.trim() || F[`l${i}url`].value.trim()).length;
  linkRows = Math.max(linkRows, filled, 1);
  for (const row of $$('[data-link]')) row.hidden = Number(row.dataset.link) >= linkRows;
  $('#addLink').hidden = linkRows >= 3;
}
$('#addLink').addEventListener('click', () => {
  linkRows = Math.min(3, linkRows + 1);
  syncLinkRows();
  F[`l${linkRows - 1}label`].focus();
});

// ── Uploads: logos, product shots, backgrounds ──
async function shrinkImage(file) {
  if (!file.type.startsWith('image/') || file.type === 'image/gif' || file.size < 1_200_000) return file; // audio, and GIFs keep their animation
  try {
    const bmp = await createImageBitmap(file);
    const scale = Math.min(1, 1600 / Math.max(bmp.width, bmp.height));
    const canvas = h('canvas', { width: Math.round(bmp.width * scale), height: Math.round(bmp.height * scale) });
    canvas.getContext('2d').drawImage(bmp, 0, 0, canvas.width, canvas.height);
    return (await new Promise((r) => canvas.toBlob(r, 'image/webp', 0.88))) || file;
  } catch { return file; }
}

let uploadTarget = null;
let uploadBtn = null;
form.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-upload]');
  if (!btn) return;
  uploadBtn = btn;
  uploadTarget = btn.dataset.upload ? F[btn.dataset.upload] : $('[data-k="image"]', btn.closest('.layer-card'));
  $('#filePick').accept = btn.dataset.upload === 'audioFile'
    ? 'audio/mpeg,audio/mp4,audio/x-m4a,audio/ogg,audio/wav,.mp3,.m4a,.ogg,.wav'
    : 'image/png,image/jpeg,image/gif,image/webp';
  $('#filePick').click();
});
$('#filePick').addEventListener('change', async (e) => {
  e.stopPropagation();
  const file = $('#filePick').files[0];
  $('#filePick').value = '';
  if (!file || !uploadTarget) return;
  const btn = uploadBtn;
  const before = [...btn.childNodes];
  btn.disabled = true;
  btn.replaceChildren('Uploading…');
  try {
    const body = await shrinkImage(file);
    const res = await fetch('/api/upload', { method: 'POST', headers: { 'Content-Type': body.type || 'application/octet-stream' }, body });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'That upload didn’t go through. Try another image.');
    uploadTarget.value = data.url;
    if (uploadTarget === F.bgImage) F.bgType.value = 'image';
    uploadTarget.dispatchEvent(new Event('input', { bubbles: true }));
  } catch (ex) {
    showError(ex.message);
  } finally {
    btn.disabled = false;
    btn.replaceChildren(...before);
  }
});

function raiseTo(pctUp) {
  if (!pctUp) return S.minNextBid;
  return Math.max(S.minNextBid, Math.ceil((S.minNextBid * (1 + pctUp / 100)) / 100) * 100);
}
$$('[data-raise]').forEach((chip) => chip.addEventListener('click', () => {
  F.amount.value = (raiseTo(Number(chip.dataset.raise)) / 100).toFixed(2);
  clearFieldError(F.amount);
  onFormInput();
}));

// ── Form ↔ config ──
function readForm() {
  const v = (n) => String(F[n].value || '').trim();
  return {
    headline: v('headline'), tagline: v('tagline'), buttonText: v('buttonText'),
    buttonColor: v('buttonColor'), buttonTextColor: v('buttonTextColor'), textColor: v('textColor'),
    bgType: v('bgType') || 'gradient', bg1: v('bg1'), bg2: v('bg2'), bgAngle: Number(v('bgAngle')), bgImage: v('bgImage'),
    gradStyle: v('gradStyle') || 'linear', bg3: v('bg3'), bg3On: F.bg3On.checked, gradPos: v('gradPos') || 'center',
    beatStyle: v('beatStyle') || 'none', beatMatch: F.beatMatch.checked, beatColor: v('beatColor'), beatBpm: Number(v('beatBpm')), beatIntensity: Number(v('beatIntensity')),
    beatShake: F.beatShake.checked, beatParticles: F.beatParticles.checked,
    bgAudio: v('bgAudio'), audioSource: v('audioSource') || 'spotify', audioFile: v('audioFile'), audioVolume: Number(v('audioVolume')), bgFit: v('bgFit') || 'cover', bgPos: v('bgPos') || 'center',
    bgBlur: Number(v('bgBlur')), bgBright: Number(v('bgBright')),
    bgFilter: v('bgFilter') || 'none', duoDark: v('duoDark'), duoLight: v('duoLight'), bgAnimate: F.bgAnimate.checked, bgSpeed: Number(v('bgSpeed')),
    overlayColor: v('overlayColor'), overlayOpacity: Number(v('overlayOpacity')), vignette: Number(v('vignette')), grain: Number(v('grain')),
    texture: v('texture') || 'none', textureColor: v('textureColor'), textureOpacity: Number(v('textureOpacity')), textureScale: Number(v('textureScale')),
    font: v('font') || FONTS[0],
    headlineSize: Number(v('headlineSize')), taglineSize: Number(v('taglineSize')), letterSpacing: Number(v('letterSpacing')),
    uppercase: F.uppercase.checked,
    textFill: v('textFill') || 'solid', textColor2: v('textColor2'), textGradAngle: Number(v('textGradAngle')),
    textStroke: Number(v('textStroke')), strokeColor: v('strokeColor'),
    textShadow: v('textShadow') || 'none', shadowColor: v('shadowColor'), textAnim: v('textAnim') || 'none',
    layers: layerCards().map(readLayer),
    parallax: F.parallax.checked, burst: F.burst.checked,
    patternUrl: v('patternUrl'), patternSize: Number(v('patternSize')), patternOpacity: Number(v('patternOpacity')),
    linkUrl: v('linkUrl'), embedUrl: v('embedUrl'),
    links: [0, 1, 2].map((i) => ({ label: v(`l${i}label`), url: v(`l${i}url`) })).filter((l) => l.url),
  };
}

function fillForm(raw) {
  const c = { ...TEXT_DEFAULTS, ...BG_STYLE, ...BEAT_STYLE, ...raw };
  F.beatMatch.checked = c.beatMatch !== false;
  F.beatShake.checked = !!c.beatShake;
  F.beatParticles.checked = !!c.beatParticles;
  for (const key of ['beatStyle', 'beatColor', 'beatBpm', 'beatIntensity']) F[key].value = c[key];
  F.uppercase.checked = !!c.uppercase;
  F.bg3On.checked = !!c.bg3On;
  F.bgAnimate.checked = !!c.bgAnimate;
  for (const key of Object.keys(BG_STYLE)) if (key !== 'bg3On' && key !== 'bgAnimate' && c[key] != null) F[key].value = c[key];
  for (const key of ['headlineSize', 'taglineSize', 'letterSpacing', 'textFill', 'textColor2', 'textGradAngle', 'textStroke', 'strokeColor', 'textShadow', 'shadowColor', 'textAnim', 'headline', 'tagline', 'buttonText', 'buttonColor', 'buttonTextColor', 'textColor', 'bgType', 'bg1', 'bg2', 'bgAngle', 'bgImage', 'font', 'linkUrl', 'embedUrl', 'patternUrl', 'patternSize', 'patternOpacity']) {
    if (c[key] != null) F[key].value = c[key];
  }
  $('#layers').replaceChildren(...(c.layers || []).slice(0, MAX_LAYERS).map(layerCard));
  F.parallax.checked = !!c.parallax;
  F.burst.checked = c.burst !== false;
  [0, 1, 2].forEach((i) => {
    const l = (c.links || [])[i] || {};
    F[`l${i}label`].value = l.label || '';
    F[`l${i}url`].value = l.url || '';
  });
  linkRows = 1;
  syncLogoFromLayers();
  syncFormUi();
}

function embedHint(raw) {
  if (!raw.trim()) return ['YouTube, Vimeo and Spotify play in a popup on your page. Images show there too. Any other link becomes a button.', ''];
  const e = parseEmbed(raw);
  if (!e) return ['This needs to be a full link starting with https://', 'bad'];
  return [{
    youtube: 'YouTube video. Visitors watch it right on your page.',
    vimeo: 'Vimeo video. Visitors watch it right on your page.',
    spotify: 'Spotify. Visitors listen right on your page.',
    video: 'Video file. Visitors watch it right on your page.',
    image: 'Image. Visitors can open it on your page.',
    link: `A button linking to ${e.host}.`,
  }[e.kind], 'ok'];
}

function renderSummary() {
  const d = readForm();
  const rows = [];
  if (mode === 'bid') {
    rows.push(['Shown as', F.name.value.trim() || '–']);
    const cents = Math.round(Number(F.amount.value) * 100);
    rows.push(['Your bid', cents ? money(cents) : '–']);
  }
  const link = safeUrl(d.linkUrl);
  rows.push(['Button opens', link ? hostOf(link) : 'Nothing, it counts presses']);
  const e = parseEmbed(d.embedUrl);
  if (e) rows.push(['Featured', e.kind === 'link' ? e.host : { youtube: 'YouTube video', vimeo: 'Vimeo video', spotify: 'Spotify', video: 'Video', image: 'Image' }[e.kind]]);
  $('#summary').replaceChildren(...rows.map(([k, v]) => h('div', {}, h('dt', {}, k), h('dd', {}, v))));
}

function syncFormUi() {
  const type = F.bgType.value;
  for (const el of $$('[data-show]', form)) el.hidden = !el.dataset.show.split(' ').includes(type);
  for (const el of $$('[data-grad]', form)) el.hidden = el.hidden || !el.dataset.grad.split(' ').includes(F.gradStyle.value);
  $('[data-mid]', form).hidden = !(type === 'mesh' || (type === 'gradient' && F.bg3On.checked));
  $$('[data-when="texture"]', form).forEach((el) => { el.hidden = F.texture.value === 'none'; });
  $('[data-when="bganim"]', form).hidden = !F.bgAnimate.checked;
  $('[data-when="duo"]', form).hidden = F.bgFilter.value !== 'duotone';
  setDuotone(F.duoDark.value, F.duoLight.value);
  // Filter tiles preview the owner's own image when there is one.
  const tileImg = type === 'image' && safeUrl(F.bgImage.value, true);
  const sample = tileImg ? `url("${cssUrl(tileImg)}")` : 'linear-gradient(135deg, #ff5f6d, #ffc371 35%, #47e5bc 65%, #5f72ff)';
  $$('.filters').forEach((el) => el.style.setProperty('--tile-bg', sample));
  const names = { solid: ['Color'], gradient: ['Start', 'End', 'Middle'], mesh: ['Base', 'Glow 2', 'Glow 1'], image: ['Behind image'] }[type] || ['Color'];
  $('#bg1Label').textContent = names[0];
  if (names[1]) { $('#bg2Label').textContent = names[1]; $('#bg3Label').textContent = names[2]; }
  $('#bgAnimLabel').textContent = type === 'image' ? 'Slow zoom (Ken Burns)' : 'Slowly drift the colors';
  $('#bgTypeHint').textContent = {
    solid: 'One flat color.',
    gradient: 'A blend of two or three colors: straight, circular or swept around a point.',
    mesh: 'Soft glowing blobs of color, like an aurora.',
    image: 'A photo or graphic, uploaded or linked.',
  }[type];
  const audio = F.bgAudio.value.trim();
  const sp = spotifyEmbed(audio);
  $('#audioHint').textContent = !audio
    ? 'Paste a Spotify link to a song, album, playlist or podcast. A Music button appears for visitors, who press play (browsers don’t let pages start sound by themselves).'
    : sp ? `Spotify ${sp.kind} ✓ Visitors play it from the Music button. Spotify doesn't let pages set its volume, so it follows each visitor's device. Choose Audio file if you want a volume control.` : 'That isn’t a Spotify link. Copy it from Spotify with Share → Copy link.';
  $('#audioHint').className = `help ${!audio ? '' : sp ? 'ok' : 'bad'}`;
  const beatOn = (F.beatStyle.value || 'none') !== 'none';
  $$('[data-when="beat"]', form).forEach((el) => { el.hidden = !beatOn && !el.querySelector('[name=beatShake], [name=beatParticles]'); });
  $('[data-when="beatcolor"]', form).hidden = !beatOn || F.beatMatch.checked;
  const uploadedTrack = F.audioSource.value === 'file' && AUDIO_UPLOAD_PATH.test(F.audioFile.value.trim());
  $('#beatHint').textContent = !beatOn ? 'Animated effects around the button that pulse to a beat. Visualizer is the circular spectrum from trap and bass music channels.'
    : uploadedTrack ? 'Follows your soundtrack’s real beat while it plays, and the tempo below the rest of the time.'
      : 'Pulses at the tempo below. Upload your soundtrack as an audio file and it will follow the real music.';
  const source = F.audioSource.value || 'spotify';
  for (const el of $$('[data-audio]', form)) el.hidden = el.dataset.audio !== source;
  const fileVal = F.audioFile.value.trim();
  const fileOk = fileVal && audioFileUrl(fileVal);
  $$('[data-when="audiofile"]', form).forEach((el) => { el.hidden = !fileOk; });
  $('#audioFileHint').textContent = !fileVal
    ? 'Upload an MP3, M4A, OGG or WAV file (up to 8 MB), or paste a direct link to one. It loops, and you choose how loud it starts.'
    : fileOk ? (AUDIO_UPLOAD_PATH.test(fileVal) ? 'Audio file uploaded ✓' : 'Audio link ✓ It must be a direct link to the file itself.') : 'That link needs to start with https://';
  $('#audioFileHint').className = `help ${!fileVal ? '' : fileOk ? 'ok' : 'bad'}`;
  for (const out of $$('output[data-for]', form)) out.textContent = fmtSlider(out.dataset.for, F[out.dataset.for].value);
  for (const el of $$('[data-needs]', form)) el.hidden = !F[el.dataset.needs].value.trim();
  for (const el of $$('[data-fill]', form)) el.hidden = F.textFill.value !== el.dataset.fill;
  $('[data-when="stroke"]', form).hidden = !Number(F.textStroke.value);
  $('[data-when="shadow"]', form).hidden = F.textShadow.value === 'none';
  syncLayerCards();
  syncLinkRows();
  for (const c of $$('[data-count]', form)) c.textContent = `${F[c.dataset.count].value.length}/${F[c.dataset.count].maxLength}`;
  const [hint, tone] = embedHint(F.embedUrl.value);
  $('#embedHint').textContent = hint;
  $('#embedHint').className = `help ${tone}`;
  if (mode === 'bid' && S) {
    const cents = Math.round(Number(F.amount.value) * 100);
    $('#submitBtn').textContent = cents ? `Take it for ${money(cents)}` : 'Take the button';
    for (const chip of $$('[data-raise]')) chip.classList.toggle('on', cents === raiseTo(Number(chip.dataset.raise)));
  } else {
    $('#submitBtn').textContent = 'Save changes';
  }
  renderSummary();
}

function onFormInput() {
  syncFormUi();
  const draft = readForm();
  applyConfig(draft);
  if (mode === 'bid') store.set('tb_draft', { ...draft, name: F.name.value });
}
form.addEventListener('input', (e) => { clearFieldError(e.target); onFormInput(); });

function syncAmountFloor() {
  if (step === 1 && !adv) $('#wizTitle').textContent = S.owner ? `Outbid ${S.owner.name}` : 'Take the button';
  F.amount.min = (S.minNextBid / 100).toFixed(2);
  if (Math.round(Number(F.amount.value) * 100) < S.minNextBid) {
    F.amount.value = (S.minNextBid / 100).toFixed(2);
    syncFormUi();
  }
}

// ── Validation ──
function clearFieldError(el) {
  if (el && el.removeAttribute) el.removeAttribute('aria-invalid');
  if (!$('[aria-invalid="true"]', form)) $('#formError').hidden = true;
}
function showError(message, el) {
  if (el) {
    const section = el.closest('[data-step]');
    if (section.dataset.step === 'adv') { setStep(2, true); setAdvTab(el.closest('[data-adv]').dataset.adv); }
    else if (section.hidden) setStep(Number(section.dataset.step));
    const card = el.closest('.layer-card');
    if (card) card.open = true;
    el.setAttribute('aria-invalid', 'true');
    el.focus();
  }
  $('#formError').textContent = message;
  $('#formError').hidden = false;
}
// A link field that isn't a usable link (fields hidden because they don't apply are ignored).
function badLinkIn(scope) {
  return $$('input[data-url]', scope).find((input) => {
    const val = input.value.trim();
    if (!val || input.closest('[data-kind][hidden], [data-show][hidden], [data-audio][hidden]')) return false;
    if (input.dataset.url === 'spotify') return !spotifyEmbed(val);
    if (input.dataset.url === 'audio') return !audioFileUrl(val);
    return !safeUrl(val, input.dataset.url === 'upload');
  });
}
function validateStep(n) {
  if (n === 1 && mode === 'bid') {
    if (!F.name.value.trim()) { showError('Add the name everyone will see on the page.', F.name); return false; }
    const amount = Math.round(Number(F.amount.value) * 100);
    if (!amount || amount < S.minNextBid) { showError(`Bid at least ${money(S.minNextBid)} to take the button.`, F.amount); return false; }
  }
  const scope = $(`[data-step="${n}"]`, form);
  const bad = badLinkIn(scope) || (n === 2 ? badLinkIn($('[data-step="adv"]', form)) : null);
  if (bad) { showError(bad.dataset.url === 'audio' ? 'The audio file needs a full link starting with https://, or use Upload.' : bad.dataset.url === 'spotify' ? 'The soundtrack needs a Spotify link (open.spotify.com/…).' : 'That link needs to be complete, starting with https://', bad); return false; }
  return true;
}

// ── Open / close ──
function openWizard(m) {
  if (!S) return;
  if (peeking) return resumeWizard();
  mode = m;
  previewing = true;
  $$('[aria-invalid]', form).forEach((el) => el.removeAttribute('aria-invalid'));
  $('#formError').hidden = true;
  if (m === 'edit') {
    fillForm(S.config);
    $('#submitNote').textContent = 'Everyone watching sees your changes right away.';
  } else {
    const draft = store.get('tb_draft');
    fillForm(draft ? { ...STARTER, ...draft } : STARTER);
    F.name.value = (draft && draft.name) || '';
    F.amount.value = (S.minNextBid / 100).toFixed(2);
    $('#curSym').textContent = currencySymbol();
    $('#submitNote').textContent = S.mode === 'demo' ? 'Demo mode: no money is charged.' : 'You pay on Stripe’s secure checkout.';
  }
  openPopup('bidPop');
  setStep(m === 'edit' ? 2 : 1);
  onFormInput();
  if (m === 'bid') (F.name.value ? F.amount : F.name).focus();
}
function endWizard() {
  previewing = false;
  document.body.classList.remove('wiz-side');
  pop.classList.remove('side', 'has-preview');
  $('#previewTag').hidden = true;
  if (S) applyConfig(S.config);
  setTimeout(placeOrbitCenter, 380);
}
pop.addEventListener('close', () => { if (!peeking) endWizard(); });

// Mobile: hide the sheet to look at the page, then come back to the same spot.
$('#previewBtn').addEventListener('click', () => {
  peeking = true;
  pop.close();
  $('#backToEdit').hidden = false;
  $('#previewTag').hidden = false;
});
function resumeWizard() {
  $('#backToEdit').hidden = true;
  openPopup('bidPop');
  peeking = false;
}
$('#backToEdit').addEventListener('click', resumeWizard);

$$('[data-open-bid]').forEach((b) => b.addEventListener('click', () => openWizard('bid')));
$('#editBtn').addEventListener('click', () => openWizard('edit'));

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  // Enter on an earlier step moves forward instead of submitting.
  const list = stepList();
  if (adv) return setStep(2);
  if (list.indexOf(step) < list.length - 1) return $('#nextBtn').click();

  for (const n of list) if (!validateStep(n)) return;
  const config = readForm();
  const btn = $('#submitBtn');
  btn.disabled = true;
  try {
    if (mode === 'edit') {
      const mine = myOwnership();
      if (!mine) throw new Error('Someone outbid you, so this page is no longer yours to edit.');
      await post('/api/edit', { token: mine.token, config });
      pop.close();
      toast('Changes saved. Everyone sees your new page.');
      return;
    }
    const name = F.name.value.trim();
    const amount = Math.round(Number(F.amount.value) * 100);
    biddingAs = { name, amount };
    const res = await post('/api/bid', { name, amount, config });
    if (res.checkoutUrl) { location.href = res.checkoutUrl; return; }
    pop.close();
    showWon(res.token, res.since, name, amount);
  } catch (ex) {
    showError(ex.message);
  } finally {
    biddingAs = null;
    btn.disabled = false;
    syncFormUi();
  }
});

// ───────────────────────────── the button, dock & reactions ─────────────────────────────

async function post(url, body) {
  const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}), keepalive: true });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'That didn’t go through. Try again.');
  return data;
}

let audio = null;
function clickSound() {
  try {
    audio = audio || new (window.AudioContext || window.webkitAudioContext)();
    const t = audio.currentTime;
    const osc = audio.createOscillator();
    const gain = audio.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(240, t);
    osc.frequency.exponentialRampToValueAtTime(70, t + 0.07);
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(0.2, t + 0.005);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.1);
    osc.connect(gain).connect(audio.destination);
    osc.start(t);
    osc.stop(t + 0.12);
  } catch {}
}

function ring() {
  if (reduceMotion()) return;
  const el = h('div', { class: 'ring' });
  el.addEventListener('animationend', () => el.remove());
  $('#stage').append(el);
}

const cap = $('#theButton');
const press = () => { cap.classList.add('pressed'); clickSound(); };
const release = () => cap.classList.remove('pressed');
cap.addEventListener('pointerdown', press);
['pointerup', 'pointerleave', 'pointercancel'].forEach((ev) => cap.addEventListener(ev, release));
cap.addEventListener('keydown', (e) => { if ((e.key === 'Enter' || e.key === ' ') && !e.repeat) press(); });
cap.addEventListener('keyup', release);
cap.addEventListener('click', () => {
  ring();
  burst();
  if (previewing) return;
  if (!S || !S.owner) return openWizard('bid');
  const link = safeUrl(S.config.linkUrl);
  if (link) window.open(link, '_blank', 'noopener,noreferrer');
  post('/api/click').catch(() => {});
});

function setTray(open) {
  $('#reactTray').hidden = !open;
  $('#reactBtn').setAttribute('aria-expanded', String(open));
}
$('#reactBtn').addEventListener('click', () => { const open = $('#reactTray').hidden; setTray(open); if (open) setPlayer(false); });
document.addEventListener('pointerdown', (e) => {
  if (!$('#reactTray').hidden && !e.target.closest('#reactTray, #reactBtn')) setTray(false);
});
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') setTray(false); });
$$('[data-react]').forEach((b) => b.addEventListener('click', () => post('/api/react', { emoji: b.dataset.react }).catch(() => {})));

function spawnReaction(emoji) {
  const layer = $('#reactionsLayer');
  if (layer.childElementCount > 60 || reduceMotion()) return;
  const left = innerWidth >= 900 ? 72 + Math.random() * 22 : 35 + Math.random() * 30; // above the dock
  const el = h('span', { class: 'react-pop', style: `left:${left}%;--wx:${Math.round((Math.random() - 0.5) * 200)}px` }, emoji);
  el.addEventListener('animationend', () => el.remove());
  layer.append(el);
}

// The takeover, like a channel cutting to breaking news: a burst of static, the new page
// wipes out from the button, and a BREAKING banner slides across.
let wipeTimer = null;
let soldTimer = null;
function takeoverMoment(state) {
  if (previewing) return;
  if (reduceMotion()) { applyConfig(state.config); return; }
  wiping = true;
  const noise = $('#static');
  noise.classList.remove('go');
  void noise.offsetWidth;
  noise.classList.add('go');
  const wipe = $('#wipe');
  wipe.style.background = bgCss(state.config);
  wipe.hidden = false;
  wipe.classList.remove('go');
  void wipe.offsetWidth;
  wipe.classList.add('go');
  const sold = $('#sold');
  $('#soldName').textContent = state.owner.name;
  $('#soldAmount').textContent = money(state.owner.amount);
  sold.hidden = false;
  sold.style.animation = 'none';
  void sold.offsetWidth;
  sold.style.animation = '';
  clearTimeout(wipeTimer);
  wipeTimer = setTimeout(() => {
    wiping = false;
    applyConfig(S.config);
    wipe.hidden = true;
    wipe.classList.remove('go');
  }, 1000);
  clearTimeout(soldTimer);
  soldTimer = setTimeout(() => { sold.hidden = true; }, 3100);
}

function toast(text, kind = '') {
  const el = h('div', { class: `toast ${kind}` }, text);
  $('#toasts').append(el);
  setTimeout(() => { el.classList.add('out'); setTimeout(() => el.remove(), 350); }, kind === 'bad' ? 6000 : 4000);
}

$('#shareBtn').addEventListener('click', async () => {
  const text = S && S.owner
    ? `${S.owner.name} owns The Button for ${money(S.owner.amount)}. Can you outbid them?`
    : 'The Button is for sale. Pay the most and the page is yours.';
  try {
    if (navigator.share) await navigator.share({ title: 'The Button', text, url: location.origin });
    else { await navigator.clipboard.writeText(`${text} ${location.origin}`); toast('Link copied'); }
  } catch {}
});

$('#reportBtn').addEventListener('click', async () => {
  if (!S || !S.owner) return toast('Nobody owns the button yet, so there is nothing to report.');
  if (!confirm(`Report ${S.owner.name}'s page as offensive, misleading or unsafe?`)) return;
  await post('/api/report').catch(() => {});
  toast('Reported. A moderator will review this page.');
});

// ───────────────────────────── live connection ─────────────────────────────

function connect() {
  const es = new EventSource(`/api/stream?vid=${encodeURIComponent(vid)}`);
  es.addEventListener('state', (e) => render(JSON.parse(e.data)));
  es.addEventListener('viewers', (e) => {
    const { viewers, peakViewers } = JSON.parse(e.data);
    if (!S) return;
    S.viewers = viewers;
    S.stats.peakViewers = peakViewers;
    renderViewers(viewers);
    setText($('#aPeak'), num(peakViewers));
  });
  es.addEventListener('react', (e) => spawnReaction(JSON.parse(e.data).emoji));
  es.addEventListener('takeover', (e) => {
    const { previous, state } = JSON.parse(e.data);
    const mine = store.get('tb_owner') || {};
    const wasMine = previous && mine.since === previous.since;
    const isMine = mine.since === state.owner.since
      || (biddingAs && biddingAs.name === state.owner.name && biddingAs.amount === state.owner.amount);
    render(state, true);
    takeoverMoment(state);
    if (wasMine) toast(`${state.owner.name} outbid you with ${money(state.owner.amount)}. Take it back for ${money(state.minNextBid)}.`, 'bad');
    else if (!isMine) toast(`${state.owner.name} took the button for ${money(state.owner.amount)}.`);
    if (previewing && mode === 'edit') pop.close();
  });
}

async function boot() {
  const params = new URLSearchParams(location.search);
  connect();
  post('/api/hello', { vid }).catch(() => {});
  if (document.fonts) document.fonts.ready.then(() => { fitHeadline(); fitCapLabel(); placeOrbitCenter(); });
  if (params.has('session_id')) {
    history.replaceState(null, '', location.pathname);
    try {
      const res = await post('/api/checkout/confirm', { sessionId: params.get('session_id') });
      if (res.ok) showWon(res.token, res.since);
      else toast(res.error || 'The payment didn’t complete, so the button wasn’t transferred.', 'bad');
    } catch (ex) { toast(ex.message, 'bad'); }
  } else if (params.has('canceled')) {
    history.replaceState(null, '', location.pathname);
    toast('Checkout canceled. You were not charged.');
  }
}
boot();
