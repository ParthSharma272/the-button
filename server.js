'use strict';
/*
 * The Button — one button, one owner. Outbid the owner and the whole page is yours.
 * Zero dependencies: plain Node http + Server-Sent Events for the live bits,
 * a JSON file for persistence, and (optionally) Stripe Checkout via its REST API.
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = Number(process.env.PORT) || 4321;
const BASE_URL = (process.env.BASE_URL || `http://localhost:${PORT}`).replace(/\/$/, '');
const STRIPE_KEY = process.env.STRIPE_SECRET_KEY || '';
const ADMIN_KEY = process.env.ADMIN_KEY || '';
const CURRENCY = (process.env.CURRENCY || 'usd').toLowerCase();
const START_PRICE = Number(process.env.START_PRICE_CENTS) || 100; // first bid: $1.00
const MIN_STEP = Number(process.env.MIN_INCREMENT_CENTS) || 100; // outbid by at least $1.00 …
const MIN_STEP_PCT = Number(process.env.MIN_INCREMENT_PCT) || 5; // … or 5%, whichever is larger
const MAX_BID = 100_000_000_00; // $100M sanity cap
const MODE = STRIPE_KEY ? 'stripe' : 'demo';

const PUBLIC_DIR = path.join(__dirname, 'public');
const DATA_DIR = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : path.join(__dirname, 'data');
const STATE_FILE = path.join(DATA_DIR, 'state.json');
const UPLOAD_DIR = path.join(DATA_DIR, 'uploads');
const MAX_UPLOAD = 2 * 1024 * 1024; // images: 2 MB; the browser downsizes big photos before sending
const MAX_AUDIO_UPLOAD = 8 * 1024 * 1024; // soundtrack files: 8 MB
const MAX_UPLOAD_FILES = 5000;

const FONTS = ['Big Shoulders Display', 'Bebas Neue', 'Inter', 'Playfair Display', 'Space Mono', 'Pacifico', 'Press Start 2P', 'Permanent Marker'];
const LAYER_KINDS = ['image', 'text', 'shape', 'emoji'];
const MOTIONS = ['float', 'rain', 'rise', 'orbit', 'bounce', 'drift', 'spin', 'pulse', 'still'];
const SHAPES = ['circle', 'ring', 'square', 'diamond', 'triangle', 'star', 'heart', 'blob'];
const MAX_LAYERS = 4;
const TEXT_FILLS = ['solid', 'gradient'];
const TEXT_SHADOWS = ['none', 'soft', 'glow', 'hard', 'extrude'];
const TEXT_ANIMS = ['none', 'shimmer', 'pulse', 'flicker', 'float'];
// Uploaded images are served from /u/<sha256>.<ext>
const UPLOAD_PATH = /^\/u\/[a-f0-9]{64}\.(png|jpg|gif|webp)$/;
const AUDIO_UPLOAD_PATH = /^\/u\/[a-f0-9]{64}\.(mp3|m4a|ogg|wav)$/;
const ANY_UPLOAD_PATH = /^\/u\/[a-f0-9]{64}\.(png|jpg|gif|webp|mp3|m4a|ogg|wav)$/;
const UPLOAD_TYPES = {
  png: 'image/png', jpg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp',
  mp3: 'audio/mpeg', m4a: 'audio/mp4', ogg: 'audio/ogg', wav: 'audio/wav',
};
const AUDIO_SOURCES = ['spotify', 'file'];
const BEAT_STYLES = ['none', 'rings', 'bars', 'halo', 'shock', 'trap'];
const BG_TYPES = ['solid', 'gradient', 'mesh', 'image'];
const GRAD_STYLES = ['linear', 'radial', 'conic'];
const POSITIONS = ['center', 'top', 'bottom', 'left', 'right'];
const BG_FITS = ['cover', 'contain', 'tile'];
const TEXTURES = ['none', 'dots', 'grid', 'stripes', 'checker', 'waves'];
const BG_FILTERS = ['none', 'vivid', 'noir', 'vintage', 'cinematic', 'faded', 'warm', 'cool', 'dreamy',
  'acid', 'deepfried', 'glitch', 'thermal', 'xray', 'invert', 'posterize', 'duotone', 'liquid', 'vhs'];
const REACTIONS = ['🔥', '😂', '😍', '👏', '🤯', '💸'];

const DEFAULT_CONFIG = Object.freeze({
  headline: 'This button is for sale.',
  tagline: 'Pay the most and this page is yours: your colors, your link, your video. It stays yours until someone pays more.',
  buttonText: 'Buy me',
  buttonColor: '#e0301e',
  buttonTextColor: '#ffffff',
  textColor: '#eceee8',
  bgType: 'gradient',
  bg1: '#2a2d30',
  bg2: '#121314',
  bgAngle: 180,
  bgImage: '',
  gradStyle: 'linear',
  bg3: '#7c5cff',
  bg3On: false,
  gradPos: 'center',
  bgAudio: '',
  audioSource: 'spotify',
  audioFile: '',
  audioVolume: 60,
  beatStyle: 'none',
  beatMatch: true,
  beatColor: '#ffd23f',
  beatBpm: 120,
  beatIntensity: 70,
  beatShake: false,
  beatParticles: false,
  bgFit: 'cover',
  bgPos: 'center',
  bgBlur: 0,
  bgBright: 100,
  bgFilter: 'none',
  duoDark: '#1b0b3a',
  duoLight: '#ffd23f',
  bgAnimate: false,
  bgSpeed: 1,
  overlayColor: '#000000',
  overlayOpacity: 0,
  vignette: 0,
  grain: 0,
  texture: 'none',
  textureColor: '#ffffff',
  textureOpacity: 0.12,
  textureScale: 24,
  font: 'Big Shoulders Display',
  headlineSize: 100,
  taglineSize: 100,
  letterSpacing: 0,
  uppercase: false,
  textFill: 'solid',
  textColor2: '#ffd23f',
  textGradAngle: 90,
  textStroke: 0,
  strokeColor: '#000000',
  textShadow: 'none',
  shadowColor: '#000000',
  textAnim: 'none',
  layers: [],
  parallax: false,
  burst: true,
  patternUrl: '',
  patternSize: 120,
  patternOpacity: 0.15,
  linkUrl: '',
  embedUrl: '',
  links: [],
});

// ───────────────────────────── helpers ─────────────────────────────

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

const sha = (s) => crypto.createHash('sha256').update(String(s)).digest('hex');
const safeEqual = (a, b) => a.length === b.length && crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
const fmt = (cents) => new Intl.NumberFormat('en-US', { style: 'currency', currency: CURRENCY.toUpperCase() }).format(cents / 100);

function cleanText(s, max) {
  if (typeof s !== 'string') return '';
  return s.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
}

// allowUpload: image fields may also point at a file uploaded to this server.
function cleanUrl(u, allowUpload = false) {
  if (typeof u !== 'string' || !u.trim() || u.length > 800) return '';
  if (allowUpload && UPLOAD_PATH.test(u.trim())) return u.trim();
  try {
    const x = new URL(u.trim());
    return x.protocol === 'https:' || x.protocol === 'http:' ? x.href : '';
  } catch { return ''; }
}

// An audio file: one uploaded here, or a link to one elsewhere.
function cleanAudioFile(u) {
  if (typeof u === 'string' && AUDIO_UPLOAD_PATH.test(u.trim())) return u.trim();
  return cleanUrl(u);
}

// Soundtrack links must be Spotify pages the player can embed.
function cleanSpotify(u) {
  const url = cleanUrl(u);
  return /^https:\/\/open\.spotify\.com\/(intl-[a-z]+\/)?(track|album|playlist|episode|show|artist)\/[A-Za-z0-9]+/.test(url) ? url : '';
}

const cleanColor = (c, fallback) => (typeof c === 'string' && /^#[0-9a-f]{6}$/i.test(c) ? c.toLowerCase() : fallback);
const cleanEnum = (v, list, fallback) => (list.includes(v) ? v : fallback);
function cleanNum(v, min, max, fallback) {
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
}
const cleanVid = (v) => (typeof v === 'string' && /^[\w-]{8,64}$/.test(v) ? v : '');

function cleanLayer(l) {
  if (!l || typeof l !== 'object') return null;
  const kind = cleanEnum(l.kind, LAYER_KINDS, 'emoji');
  const value = kind === 'image' ? cleanUrl(l.value, true)
    : kind === 'shape' ? cleanEnum(l.value, SHAPES, 'circle')
      : kind === 'text' ? cleanText(l.value, 30)
        : cleanText(l.value, 48); // emoji: a few, separated by spaces
  if (!value) return null;
  return {
    kind,
    value,
    color: cleanColor(l.color, '#ffffff'),
    motion: cleanEnum(l.motion, MOTIONS, 'float'),
    count: Math.round(cleanNum(l.count, 1, 40, 12)),
    size: Math.round(cleanNum(l.size, 10, 260, 48)),
    speed: cleanNum(l.speed, 0.25, 3, 1),
    opacity: cleanNum(l.opacity, 0.1, 1, 1),
    blur: Math.round(cleanNum(l.blur, 0, 16, 0)),
    spin: l.spin === true,
  };
}

// Pages saved before layers existed had one list of "floaters"; turn it into layers.
function legacyLayers(i) {
  const f = Array.isArray(i.floaters) ? i.floaters.map(String) : [];
  if (!f.length || i.floatMode === 'none') return [];
  const base = { motion: i.floatMode, count: i.floatCount, size: i.floatSize, speed: i.floatSpeed };
  const emoji = f.filter((x) => !/^https?:/i.test(x));
  return [
    ...(emoji.length ? [{ ...base, kind: 'emoji', value: emoji.join(' ') }] : []),
    ...f.filter((x) => /^https?:/i.test(x)).map((url) => ({ ...base, kind: 'image', value: url })),
  ];
}

function cleanConfig(input) {
  const i = input && typeof input === 'object' ? input : {};
  const d = DEFAULT_CONFIG;
  const layers = (Array.isArray(i.layers) ? i.layers : legacyLayers(i))
    .slice(0, MAX_LAYERS)
    .map(cleanLayer)
    .filter(Boolean);
  const links = (Array.isArray(i.links) ? i.links : [])
    .slice(0, 4)
    .map((l) => ({ label: cleanText(l && l.label, 30), url: cleanUrl(l && l.url) }))
    .filter((l) => l.url);
  return {
    headline: cleanText(i.headline, 80),
    tagline: cleanText(i.tagline, 220),
    buttonText: cleanText(i.buttonText, 32) || 'The Button',
    buttonColor: cleanColor(i.buttonColor, d.buttonColor),
    buttonTextColor: cleanColor(i.buttonTextColor, d.buttonTextColor),
    textColor: cleanColor(i.textColor, d.textColor),
    bgType: cleanEnum(i.bgType, BG_TYPES, d.bgType),
    bg1: cleanColor(i.bg1, d.bg1),
    bg2: cleanColor(i.bg2, d.bg2),
    bgAngle: Math.round(cleanNum(i.bgAngle, 0, 360, d.bgAngle)),
    bgImage: cleanUrl(i.bgImage, true),
    gradStyle: cleanEnum(i.gradStyle, GRAD_STYLES, d.gradStyle),
    bg3: cleanColor(i.bg3, d.bg3),
    bg3On: i.bg3On === true,
    gradPos: cleanEnum(i.gradPos, POSITIONS, d.gradPos),
    bgAudio: cleanSpotify(i.bgAudio),
    audioSource: cleanEnum(i.audioSource, AUDIO_SOURCES, d.audioSource),
    audioFile: cleanAudioFile(i.audioFile),
    audioVolume: Math.round(cleanNum(i.audioVolume, 0, 100, d.audioVolume)),
    beatStyle: cleanEnum(i.beatStyle, BEAT_STYLES, d.beatStyle),
    beatMatch: i.beatMatch !== false,
    beatColor: cleanColor(i.beatColor, d.beatColor),
    beatBpm: Math.round(cleanNum(i.beatBpm, 60, 180, d.beatBpm)),
    beatIntensity: Math.round(cleanNum(i.beatIntensity, 20, 100, d.beatIntensity)),
    beatShake: i.beatShake === true,
    beatParticles: i.beatParticles === true,
    bgFit: cleanEnum(i.bgFit, BG_FITS, d.bgFit),
    bgPos: cleanEnum(i.bgPos, POSITIONS, d.bgPos),
    bgBlur: Math.round(cleanNum(i.bgBlur, 0, 20, d.bgBlur)),
    bgBright: Math.round(cleanNum(i.bgBright, 40, 150, d.bgBright)),
    bgFilter: cleanEnum(i.bgFilter, BG_FILTERS, d.bgFilter),
    duoDark: cleanColor(i.duoDark, d.duoDark),
    duoLight: cleanColor(i.duoLight, d.duoLight),
    bgAnimate: i.bgAnimate === true,
    bgSpeed: cleanNum(i.bgSpeed, 0.25, 3, d.bgSpeed),
    overlayColor: cleanColor(i.overlayColor, d.overlayColor),
    overlayOpacity: cleanNum(i.overlayOpacity, 0, 0.85, d.overlayOpacity),
    vignette: Math.round(cleanNum(i.vignette, 0, 100, d.vignette)),
    grain: Math.round(cleanNum(i.grain, 0, 100, d.grain)),
    texture: cleanEnum(i.texture, TEXTURES, d.texture),
    textureColor: cleanColor(i.textureColor, d.textureColor),
    textureOpacity: cleanNum(i.textureOpacity, 0.02, 0.6, d.textureOpacity),
    textureScale: Math.round(cleanNum(i.textureScale, 8, 80, d.textureScale)),
    font: cleanEnum(i.font, FONTS, d.font),
    headlineSize: Math.round(cleanNum(i.headlineSize, 60, 160, d.headlineSize)),
    taglineSize: Math.round(cleanNum(i.taglineSize, 70, 150, d.taglineSize)),
    letterSpacing: Math.round(cleanNum(i.letterSpacing, -5, 30, d.letterSpacing)),
    uppercase: i.uppercase === true,
    textFill: cleanEnum(i.textFill, TEXT_FILLS, d.textFill),
    textColor2: cleanColor(i.textColor2, d.textColor2),
    textGradAngle: Math.round(cleanNum(i.textGradAngle, 0, 360, d.textGradAngle)),
    textStroke: cleanNum(i.textStroke, 0, 6, d.textStroke),
    strokeColor: cleanColor(i.strokeColor, d.strokeColor),
    textShadow: cleanEnum(i.textShadow, TEXT_SHADOWS, d.textShadow),
    shadowColor: cleanColor(i.shadowColor, d.shadowColor),
    textAnim: cleanEnum(i.textAnim, TEXT_ANIMS, d.textAnim),
    layers,
    parallax: i.parallax === true,
    burst: i.burst !== false,
    patternUrl: cleanUrl(i.patternUrl, true),
    patternSize: Math.round(cleanNum(i.patternSize, 24, 400, d.patternSize)),
    patternOpacity: cleanNum(i.patternOpacity, 0.03, 1, d.patternOpacity),
    linkUrl: cleanUrl(i.linkUrl),
    embedUrl: cleanUrl(i.embedUrl, true),
    links,
  };
}

// Tiny sliding-window rate limiter. Returns true when the caller is over the limit.
const hits = new Map();
function limited(key, max, windowMs) {
  const now = Date.now();
  const recent = (hits.get(key) || []).filter((t) => now - t < windowMs);
  recent.push(now);
  hits.set(key, recent);
  return recent.length > max;
}
setInterval(() => hits.clear(), 10 * 60_000).unref();

// ───────────────────────────── state ─────────────────────────────

function loadState() {
  const fresh = {
    current: null, // { name, amount, since, config, clicks, impressions, reactions, reports, tokenHash }
    history: [], // past owners, oldest first
    bids: [], // every takeover, oldest first
    pending: {}, // Stripe checkouts awaiting payment
    visitors: [],
    stats: { totalVisits: 0, peakViewers: 0, peakAt: null, totalClicks: 0, totalRaised: 0, totalReactions: 0, totalBids: 0, firstBid: 0 },
  };
  try {
    const saved = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
    return { ...fresh, ...saved, stats: { ...fresh.stats, ...saved.stats } };
  } catch {
    return fresh;
  }
}

const state = loadState();
const visitors = new Set(state.visitors);
let reporters = new Set(); // IPs that reported the current owner

function writeState() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const tmp = STATE_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify({ ...state, visitors: [...visitors] }));
  fs.renameSync(tmp, STATE_FILE);
}
let saveTimer = null;
function save() {
  if (saveTimer) return;
  saveTimer = setTimeout(() => { saveTimer = null; writeState(); }, 500);
}
for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => { if (saveTimer) writeState(); process.exit(0); });
}

// Just enough of an owner's page to draw a thumbnail of it in the history.
function lookOf(c) {
  return {
    bgType: c.bgType, bg1: c.bg1, bg2: c.bg2, bgAngle: c.bgAngle, bgImage: c.bgImage,
    gradStyle: c.gradStyle, bg3: c.bg3, bg3On: c.bg3On, gradPos: c.gradPos, bgFit: c.bgFit, bgPos: c.bgPos,
    textColor: c.textColor, font: c.font, headline: c.headline,
    buttonColor: c.buttonColor, buttonTextColor: c.buttonTextColor, buttonText: c.buttonText,
  };
}

function minNextBid() {
  const c = state.current;
  if (!c) return START_PRICE;
  return c.amount + Math.max(MIN_STEP, Math.ceil((c.amount * MIN_STEP_PCT) / 100));
}

function longestReign() {
  const now = Date.now();
  const reigns = state.history.map((h) => ({ name: h.name, ms: h.until - h.since }));
  if (state.current) reigns.push({ name: state.current.name, ms: now - state.current.since, current: true });
  return reigns.reduce((best, r) => (!best || r.ms > best.ms ? r : best), null);
}

function publicState() {
  const c = state.current;
  return {
    mode: MODE,
    currency: CURRENCY,
    now: Date.now(),
    minNextBid: minNextBid(),
    viewers: viewerCount(),
    owner: c && { name: c.name, amount: c.amount, since: c.since, clicks: c.clicks, impressions: c.impressions, reactions: c.reactions },
    config: c ? c.config : DEFAULT_CONFIG,
    history: state.history.slice(-100).reverse().map((h) => ({
      name: h.name, amount: h.amount, since: h.since, until: h.until,
      clicks: h.clicks, impressions: h.impressions, reactions: h.reactions || 0,
      swatch: h.swatch, headline: h.headline, link: h.link || '', look: h.look || null,
    })),
    bids: state.bids.slice(-30).reverse(),
    stats: {
      ...state.stats,
      uniqueVisitors: visitors.size,
      owners: state.history.length + (c ? 1 : 0),
      longestReign: longestReign(),
    },
  };
}

function takeover({ name, amount, config }) {
  const now = Date.now();
  const prev = state.current;
  if (prev) {
    state.history.push({
      name: prev.name, amount: prev.amount, since: prev.since, until: now,
      clicks: prev.clicks, impressions: prev.impressions, reactions: prev.reactions,
      headline: prev.config.headline, swatch: prev.config.buttonColor,
      link: prev.config.linkUrl, look: lookOf(prev.config),
    });
    if (state.history.length > 1000) state.history = state.history.slice(-1000);
  }
  const token = crypto.randomBytes(24).toString('base64url');
  state.current = { name, amount, since: now, config, clicks: 0, impressions: 0, reactions: 0, reports: 0, tokenHash: sha(token) };
  state.bids.push({ name, amount, at: now });
  if (state.bids.length > 500) state.bids = state.bids.slice(-500);
  if (!state.stats.firstBid) state.stats.firstBid = amount;
  state.stats.totalRaised += amount;
  state.stats.totalBids += 1;
  reporters = new Set();
  save();
  broadcast('takeover', { previous: prev ? { name: prev.name, since: prev.since } : null, state: publicState() });
  console.log(`👑 ${name} took the button for ${fmt(amount)}`);
  return { token, since: now };
}

// ───────────────────────────── live (SSE) ─────────────────────────────

const clients = new Set(); // { res, vid }
const viewerCount = () => new Set([...clients].map((c) => c.vid)).size; // tabs from one browser count once

function send(res, event, data) { res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`); }
function broadcast(event, data) { for (const c of clients) send(c.res, event, data); }

let viewersTimer = null;
function viewersChanged() {
  if (viewersTimer) return;
  viewersTimer = setTimeout(() => {
    viewersTimer = null;
    const v = viewerCount();
    if (v > state.stats.peakViewers) { state.stats.peakViewers = v; state.stats.peakAt = Date.now(); save(); }
    broadcast('viewers', { viewers: v, peakViewers: state.stats.peakViewers });
  }, 400);
}

let stateTimer = null;
function stateChanged() {
  if (stateTimer) return;
  stateTimer = setTimeout(() => { stateTimer = null; broadcast('state', publicState()); }, 1000);
}

function openStream(req, res, url) {
  if (clients.size >= 10_000) throw new HttpError(503, 'Too many viewers right now');
  const client = { res, vid: cleanVid(url.searchParams.get('vid')) || crypto.randomUUID() };
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.write('retry: 3000\n\n');
  clients.add(client);
  send(res, 'state', publicState());
  viewersChanged();
  req.on('close', () => { clients.delete(client); viewersChanged(); });
}
setInterval(() => { for (const c of clients) c.res.write(': ping\n\n'); }, 25_000).unref();

// ───────────────────────────── Stripe (optional) ─────────────────────────────

async function stripe(method, pathname, params) {
  const res = await fetch(`https://api.stripe.com/v1${pathname}`, {
    method,
    headers: { Authorization: `Bearer ${STRIPE_KEY}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params ? new URLSearchParams(params).toString() : undefined,
  });
  const data = await res.json();
  if (!res.ok) throw new HttpError(502, (data.error && data.error.message) || 'Payment provider error');
  return data;
}

function prunePending() {
  const cutoff = Date.now() - 24 * 3600_000;
  for (const [id, p] of Object.entries(state.pending)) if (p.createdAt < cutoff) delete state.pending[id];
}

const confirming = new Map(); // pid → promise, so a double-confirm can't apply twice
async function confirmCheckout(sessionId) {
  if (typeof sessionId !== 'string' || !/^cs_[\w]+$/.test(sessionId)) throw new HttpError(400, 'Bad session id');
  const session = await stripe('GET', `/checkout/sessions/${sessionId}`);
  const pid = session.metadata && session.metadata.pid;
  if (!pid || !state.pending[pid]) throw new HttpError(404, 'Unknown checkout');
  if (!confirming.has(pid)) confirming.set(pid, finalize(pid, session).finally(() => confirming.delete(pid)));
  return confirming.get(pid);
}

async function finalize(pid, session) {
  const p = state.pending[pid];
  if (p.status === 'applied') return { ok: true, token: p.token, since: p.since };
  if (p.status === 'refunded') return { ok: false, refunded: true, error: p.error };
  if (session.payment_status !== 'paid') return { ok: false, error: 'Payment was not completed.' };
  if (session.amount_total !== p.amount) throw new HttpError(409, 'Amount mismatch');
  if (p.amount < minNextBid()) {
    // Someone else took the button while this person was on the payment page.
    await stripe('POST', '/refunds', { payment_intent: session.payment_intent });
    p.status = 'refunded';
    p.error = `Someone outbid you while you were paying — your ${fmt(p.amount)} has been refunded.`;
    save();
    return { ok: false, refunded: true, error: p.error };
  }
  const { token, since } = takeover(p);
  Object.assign(p, { status: 'applied', token, since, config: null });
  save();
  return { ok: true, token, since };
}

// ───────────────────────────── HTTP ─────────────────────────────

function json(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
}

function readRaw(req, limit, tooLarge = 'Payload too large') {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) { reject(new HttpError(413, tooLarge)); req.destroy(); } else chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

async function readBody(req, limit = 32 * 1024) {
  const buf = await readRaw(req, limit);
  if (!buf.length) return {};
  try { return JSON.parse(buf.toString('utf8')); } catch { throw new HttpError(400, 'Invalid JSON'); }
}

// Trust the file's bytes, not its name or Content-Type. SVG is refused because it can carry scripts.
// Same idea for soundtracks: MP3 (ID3 tag or frame sync), M4A (MP4 'ftyp' box), OGG and WAV.
function sniffAudio(b) {
  if (b.length > 3 && b.toString('ascii', 0, 3) === 'ID3') return 'mp3';
  if (b.length > 2 && b[0] === 0xff && (b[1] & 0xe0) === 0xe0) return 'mp3';
  if (b.length > 12 && b.toString('ascii', 4, 8) === 'ftyp') return 'm4a';
  if (b.length > 4 && b.toString('ascii', 0, 4) === 'OggS') return 'ogg';
  if (b.length > 12 && b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === 'WAVE') return 'wav';
  return null;
}

function sniffImage(b) {
  if (b.length > 8 && b[0] === 0x89 && b.toString('ascii', 1, 4) === 'PNG') return 'png';
  if (b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'jpg';
  if (b.length > 6 && b.toString('ascii', 0, 4) === 'GIF8') return 'gif';
  if (b.length > 12 && b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === 'WEBP') return 'webp';
  return null;
}

function requireAdmin(req) {
  const key = String(req.headers['x-admin-key'] || '');
  if (!ADMIN_KEY || !safeEqual(sha(key), sha(ADMIN_KEY))) throw new HttpError(403, 'Forbidden');
}

async function api(req, res, url, ip) {
  switch (`${req.method} ${url.pathname}`) {
    case 'GET /api/state':
      return json(res, 200, publicState());

    case 'GET /api/stream':
      return openStream(req, res, url);

    case 'POST /api/hello': { // one page view
      const { vid } = await readBody(req, 1024);
      if (!limited(`hello:${ip}`, 30, 60_000)) {
        state.stats.totalVisits++;
        if (cleanVid(vid)) visitors.add(vid);
        if (state.current) state.current.impressions++;
        save();
        stateChanged();
      }
      return json(res, 200, { ok: true });
    }

    case 'POST /api/click': { // someone pressed the owner's button
      if (state.current && !limited(`click:${ip}`, 1, 2000)) {
        state.current.clicks++;
        state.stats.totalClicks++;
        save();
        stateChanged();
      }
      return json(res, 200, { ok: true });
    }

    case 'POST /api/react': {
      const { emoji } = await readBody(req, 1024);
      if (!REACTIONS.includes(emoji)) throw new HttpError(400, 'Unknown reaction');
      if (limited(`react:${ip}`, 8, 4000)) throw new HttpError(429, 'Easy there!');
      state.stats.totalReactions++;
      if (state.current) state.current.reactions++;
      broadcast('react', { emoji });
      save();
      stateChanged();
      return json(res, 200, { ok: true });
    }

    case 'POST /api/report': {
      if (state.current && !reporters.has(ip)) {
        reporters.add(ip);
        state.current.reports++;
        save();
        console.warn(`⚠️  Report #${state.current.reports} against "${state.current.name}"`);
      }
      return json(res, 200, { ok: true });
    }

    case 'POST /api/bid': {
      if (limited(`bid:${ip}`, 6, 60_000)) throw new HttpError(429, 'Too many bids — try again in a minute.');
      const body = await readBody(req);
      const name = cleanText(body.name, 40);
      if (!name) throw new HttpError(400, 'Tell everyone who is taking the button.');
      const amount = Number(body.amount);
      if (!Number.isInteger(amount) || amount <= 0 || amount > MAX_BID) throw new HttpError(400, 'Invalid amount.');
      const min = minNextBid();
      if (amount < min) throw new HttpError(409, `Too low — the minimum bid is now ${fmt(min)}.`);
      const config = cleanConfig(body.config);

      if (MODE === 'demo') return json(res, 200, { ok: true, ...takeover({ name, amount, config }) });

      const pid = crypto.randomUUID();
      prunePending();
      state.pending[pid] = { name, amount, config, createdAt: Date.now(), status: 'open' };
      const session = await stripe('POST', '/checkout/sessions', {
        mode: 'payment',
        'line_items[0][quantity]': '1',
        'line_items[0][price_data][currency]': CURRENCY,
        'line_items[0][price_data][unit_amount]': String(amount),
        'line_items[0][price_data][product_data][name]': 'Ownership of The Button',
        'line_items[0][price_data][product_data][description]': `Displayed as "${name}". You keep the page until someone outbids you.`,
        success_url: `${BASE_URL}/?session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${BASE_URL}/?canceled=1`,
        'metadata[pid]': pid,
      });
      save();
      return json(res, 200, { checkoutUrl: session.url });
    }

    case 'POST /api/checkout/confirm': {
      if (MODE !== 'stripe') throw new HttpError(400, 'Payments are not enabled.');
      const { sessionId } = await readBody(req, 1024);
      return json(res, 200, await confirmCheckout(sessionId));
    }

    case 'POST /api/upload': { // an owner's own image: logo, product shot, background
      if (limited(`upload:${ip}`, 30, 10 * 60_000)) throw new HttpError(429, 'Too many uploads. Try again in a few minutes.');
      const buf = await readRaw(req, MAX_AUDIO_UPLOAD, 'That file is too big. Images can be up to 2 MB and audio up to 8 MB.');
      const image = sniffImage(buf);
      const ext = image || sniffAudio(buf);
      if (!ext) throw new HttpError(415, 'Upload a PNG, JPG, GIF or WebP image, or an MP3, M4A, OGG or WAV audio file.');
      if (image && buf.length > MAX_UPLOAD) throw new HttpError(413, 'That image is over 2 MB. Try a smaller one.');
      const name = `${crypto.createHash('sha256').update(buf).digest('hex')}.${ext}`;
      const file = path.join(UPLOAD_DIR, name);
      if (!fs.existsSync(file)) {
        fs.mkdirSync(UPLOAD_DIR, { recursive: true });
        if (fs.readdirSync(UPLOAD_DIR).length >= MAX_UPLOAD_FILES) throw new HttpError(507, 'Uploads are full right now. Paste an image link instead.');
        fs.writeFileSync(file, buf);
      }
      return json(res, 200, { url: `/u/${name}` });
    }

    case 'POST /api/edit': { // current owner restyles their page without re-bidding
      const body = await readBody(req);
      const c = state.current;
      if (!c || typeof body.token !== 'string' || !safeEqual(sha(body.token), c.tokenHash)) {
        throw new HttpError(403, 'This edit link no longer owns the button.');
      }
      if (limited(`edit:${ip}`, 20, 60_000)) throw new HttpError(429, 'Too many edits — give it a minute.');
      c.config = cleanConfig(body.config);
      save();
      broadcast('state', publicState());
      return json(res, 200, { ok: true });
    }

    case 'GET /api/admin': {
      requireAdmin(req);
      const c = state.current;
      return json(res, 200, { owner: c && c.name, reports: c ? c.reports : 0, pending: Object.keys(state.pending).length, clients: clients.size });
    }

    case 'POST /api/admin/takedown': { // moderation: wipe the content, keep the ownership/price
      requireAdmin(req);
      const c = state.current;
      if (!c) throw new HttpError(404, 'Nobody owns the button.');
      c.config = cleanConfig({
        ...DEFAULT_CONFIG,
        headline: 'Removed by a moderator',
        tagline: 'This owner’s content broke the rules. Outbid them to take the page.',
        buttonText: 'Outbid them',
      });
      save();
      broadcast('state', publicState());
      return json(res, 200, { ok: true });
    }
  }
  throw new HttpError(404, 'Not found');
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.webmanifest': 'application/manifest+json',
};

const SECURITY_HEADERS = {
  'Content-Security-Policy': [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    'font-src https://fonts.gstatic.com',
    'img-src * data: blob:',
    'media-src *',
    'frame-src https://www.youtube-nocookie.com https://player.vimeo.com https://open.spotify.com',
    "connect-src 'self'",
    "base-uri 'none'",
    "object-src 'none'",
  ].join('; '),
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
};

function serveUpload(req, res, url) {
  if (!ANY_UPLOAD_PATH.test(url.pathname)) throw new HttpError(404, 'Not found');
  const name = path.basename(url.pathname);
  fs.readFile(path.join(UPLOAD_DIR, name), (err, buf) => {
    if (err) return json(res, 404, { error: 'Not found' });
    const headers = {
      'Content-Type': UPLOAD_TYPES[path.extname(name).slice(1)],
      'Cache-Control': 'public, max-age=31536000, immutable', // names are content hashes
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'none'; sandbox",
      'Accept-Ranges': 'bytes',
    };
    // Audio players ask for byte ranges to seek; Safari won't play audio without them.
    const m = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range || '');
    if (m && (m[1] || m[2])) {
      let start = m[1] ? Number(m[1]) : buf.length - Number(m[2]);
      let end = m[1] && m[2] ? Number(m[2]) : buf.length - 1;
      start = Math.max(0, start);
      end = Math.min(end, buf.length - 1);
      if (start > end) { res.writeHead(416, { 'Content-Range': `bytes */${buf.length}` }); return res.end(); }
      res.writeHead(206, { ...headers, 'Content-Range': `bytes ${start}-${end}/${buf.length}`, 'Content-Length': end - start + 1 });
      return res.end(req.method === 'HEAD' ? undefined : buf.subarray(start, end + 1));
    }
    res.writeHead(200, { ...headers, 'Content-Length': buf.length });
    res.end(req.method === 'HEAD' ? undefined : buf);
  });
}

function serveStatic(req, res, url) {
  if (req.method !== 'GET' && req.method !== 'HEAD') throw new HttpError(405, 'Method not allowed');
  let p;
  try { p = decodeURIComponent(url.pathname); } catch { throw new HttpError(400, 'Bad path'); }
  if (p === '/') p = '/index.html';
  const file = path.normalize(path.join(PUBLIC_DIR, p));
  if (!file.startsWith(PUBLIC_DIR + path.sep)) throw new HttpError(404, 'Not found');
  fs.readFile(file, (err, buf) => {
    if (err) return json(res, 404, { error: 'Not found' });
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache', ...SECURITY_HEADERS });
    res.end(req.method === 'HEAD' ? undefined : buf);
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  // Behind a proxy (Render, Fly, nginx…) the real client IP is in X-Forwarded-For.
  const ip = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket.remoteAddress;
  try {
    if (url.pathname.startsWith('/api/')) await api(req, res, url, ip);
    else if (url.pathname.startsWith('/u/')) serveUpload(req, res, url);
    else serveStatic(req, res, url);
  } catch (e) {
    const status = e.status || 500;
    if (status === 500) console.error(e);
    if (!res.headersSent) json(res, status, { error: status === 500 ? 'Something went wrong.' : e.message });
  }
});

server.listen(PORT, () => {
  console.log(`\n  🔴 The Button is live on ${BASE_URL}`);
  console.log(`     mode: ${MODE === 'demo' ? 'DEMO (bids are free — set STRIPE_SECRET_KEY to take real payments)' : 'Stripe Checkout'}\n`);
});
