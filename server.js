// Сервер «Бумажного мира»: статика проекта + API комнат.
// Без зависимостей: node server.js → http://localhost:8100
//
// Самостоятельная копия проекта «Бумажный аквариум» под отдельный поддомен.
// Базовый аквариум (../server.js) не трогается: у мира свой код и свои данные
// (data/rooms/), общего рантайма нет.
//
// Комнаты фиксированы контентом: один вид журнала = один QR = одна комната.
// Реестр — assets/world/rooms.json, набор эталонов — assets/world/room-set.json.
// «Открыта» — свойство устройства (localStorage у клиента), сервер о ней не помнит.
//
// Страницы:
//   /                 — список комнат (открытые / закрытые)
//   /r/<id>           — сама комната
//
// API:
//   GET  /api/rooms/catalog          — реестр комнат для главной (без хешей)
//   POST /api/r/<id>/unlock {token}  — сверить QR-токен → ok / 401 / 404
//   GET  /api/r/<id>/set             — набор комнаты (персонажи, наряды, декор)
//   GET  /api/r/<id>/state           — сохранённая расстановка
//   POST /api/r/<id>/state {dolls,decor} — сохранить расстановку (только эталоны)
//   GET  /api/r/<id>/preview         — снимок сцены; POST — сохранить снимок
'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');

const ROOT = __dirname;
const PORT = Number(process.env.PORT) || 8100;
const MAX_BODY = 12 * 1024 * 1024;

const ROOMS_DATA = path.join(ROOT, 'data', 'rooms');
const ROOMS_FILE = path.join(ROOT, 'assets', 'world', 'rooms.json');
const SET_FILE = path.join(ROOT, 'assets', 'world', 'room-set.json');

fs.mkdirSync(ROOMS_DATA, { recursive: true });

// ── пределы ────────────────────────────────────────────────────────────────
// Слабое устройство не должно лечь от сотни объектов в сцене.
const LIMITS = {
  dolls: Number(process.env.WORLD_MAX_DOLLS) || 30,
  decor: Number(process.env.WORLD_MAX_DECOR) || 40,
  previewBytes: 3 * 1024 * 1024,
  dataMB: Number(process.env.WORLD_MAX_DATA_MB) || 1024
};

// ── реестр и наборы (читаем с диска; меняются только при пересборке) ─────────
function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '')); }
  catch (e) { return null; }
}

function listRooms() {
  const m = readJson(ROOMS_FILE);
  return (m && Array.isArray(m.rooms)) ? m.rooms : [];
}

function findRoom(id) {
  return listRooms().find((r) => r.id === id) || null;
}

// Наружу — без секретов разблокировки.
function publicRoom(r) {
  return { id: r.id, titles: r.titles, background: r.background };
}

function readSet() {
  const s = readJson(SET_FILE);
  return s || { bases: [], garments: [], decor: [], recognition: {} };
}

// Набор, суженный до одной комнаты (Requirement 3.1 / 4.1 / 7.5).
function roomSet(id) {
  const s = readSet();
  const bases = (s.bases || []).filter((b) => b.room === id);
  const baseIds = new Set(bases.map((b) => b.id));
  const garments = (s.garments || []).filter((g) => baseIds.has(g.baseId));
  const decor = (s.decor || []).filter((d) => d.room === id);
  return { bases, garments, decor, recognition: s.recognition || {} };
}

// ── идентификаторы комнат ────────────────────────────────────────────────────
// Комнаты фиксированы реестром, id — slug из [a-z0-9-], а не случайный код.
const ROOM_ID_RE = /^[a-z0-9-]{2,32}$/;

function room(id) {
  const dir = path.join(ROOMS_DATA, id);
  return {
    id,
    dir,
    meta: path.join(dir, 'meta.json'),
    state: path.join(dir, 'state.json'),
    preview: path.join(dir, 'preview.jpg')
  };
}

function ensureRoom(r) {
  fs.mkdirSync(r.dir, { recursive: true });
}

// ── диск ─────────────────────────────────────────────────────────────────────
let dataSize = { bytes: 0, at: 0 };
function dataBytes() {
  if (Date.now() - dataSize.at < 60 * 1000) return dataSize.bytes;
  let total = 0;
  const walk = (dir) => {
    let items = [];
    try { items = fs.readdirSync(dir, { withFileTypes: true }); } catch (e) { return; }
    for (const it of items) {
      const full = path.join(dir, it.name);
      if (it.isDirectory()) walk(full);
      else { try { total += fs.statSync(full).size; } catch (e) { /* исчез */ } }
    }
  };
  walk(ROOMS_DATA);
  dataSize = { bytes: total, at: Date.now() };
  return total;
}

function diskFull() { return dataBytes() > LIMITS.dataMB * 1024 * 1024; }

// ── антиперебор токена (растущая пауза по адресу) ────────────────────────────
const FAILS_FREE = 5;
const BLOCK_BASE = 20 * 1000;
const BLOCK_MAX = 10 * 60 * 1000;
const unlockMiss = new Map();   // адрес → { fails, blockUntil }

function clientKey(req) {
  const fwd = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
  return fwd || req.socket.remoteAddress || '?';
}

function missFor(key) {
  let ev = unlockMiss.get(key);
  if (!ev) {
    if (unlockMiss.size > 5000) unlockMiss.clear();
    ev = { fails: 0, blockUntil: 0 };
    unlockMiss.set(key, ev);
  }
  return ev;
}
function blockedFor(ev) { return Math.max(0, ev.blockUntil - Date.now()); }
function noteFail(ev) {
  ev.fails++;
  if (ev.fails > FAILS_FREE) {
    const n = ev.fails - FAILS_FREE - 1;
    ev.blockUntil = Date.now() + Math.min(BLOCK_BASE * Math.pow(2, n), BLOCK_MAX);
  }
}

function hashToken(token, salt) {
  return crypto.scryptSync(String(token), salt, 32).toString('hex');
}
function sameHash(a, b) {
  const ba = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  return ba.length === bb.length && crypto.timingSafeEqual(ba, bb);
}

// ── http helpers ──────────────────────────────────────────────────────────────
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon'
};

function send(res, code, body, type) {
  res.writeHead(code, { 'Content-Type': type || 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(body);
}

function readBody(req, res, onDone) {
  let body = '', size = 0, tooBig = false;
  req.on('data', (chunk) => {
    size += chunk.length;
    if (size > MAX_BODY) { tooBig = true; req.destroy(); return; }
    body += chunk;
  });
  req.on('end', () => {
    if (tooBig) return;
    try { onDone(body ? JSON.parse(body) : {}); }
    catch (e) { send(res, 400, JSON.stringify({ error: String(e.message || e) })); }
  });
}

// ── состояние комнаты (расстановка) ──────────────────────────────────────────
const EMPTY_STATE = { dolls: [], decor: [] };

function readState(r) {
  try { return Object.assign({ dolls: [], decor: [] }, JSON.parse(fs.readFileSync(r.state, 'utf8'))); }
  catch (e) { return Object.assign({}, EMPTY_STATE, { dolls: [], decor: [] }); }
}

function shortId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
}

function num01(v) { const n = Number(v); return (isFinite(n) && n >= 0 && n <= 1) ? n : 0.5; }

// Принять расстановку, оставив только валидные эталоны из набора комнаты
// (Requirement 3.5 / 4.4: в мир попадают только эталоны).
function sanitizeState(id, patch) {
  const set = roomSet(id);
  const baseIds = new Set(set.bases.map((b) => b.id));
  const garmentsByBase = {};
  set.garments.forEach((g) => {
    (garmentsByBase[g.baseId] = garmentsByBase[g.baseId] || new Set()).add(g.id);
  });
  const decorIds = new Set(set.decor.map((d) => d.id));

  const dolls = [];
  (Array.isArray(patch.dolls) ? patch.dolls : []).slice(0, LIMITS.dolls).forEach((d) => {
    if (!d || !baseIds.has(d.baseId)) return;
    const allowed = garmentsByBase[d.baseId] || new Set();
    const garments = (Array.isArray(d.garments) ? d.garments : []).filter((g) => allowed.has(g));
    dolls.push({ iid: d.iid || shortId(), baseId: d.baseId, garments: garments, x: num01(d.x), y: num01(d.y) });
  });

  const decor = [];
  (Array.isArray(patch.decor) ? patch.decor : []).slice(0, LIMITS.decor).forEach((d) => {
    if (!d || !decorIds.has(d.decorId)) return;
    decor.push({ iid: d.iid || shortId(), decorId: d.decorId, x: num01(d.x), y: num01(d.y) });
  });

  return { dolls, decor, updated: new Date().toISOString() };
}

// ── API комнаты ────────────────────────────────────────────────────────────
function handleRoomApi(req, res, id, url) {
  const meta = findRoom(id);
  if (!meta) return send(res, 404, '{"error":"нет такой комнаты"}');
  const r = room(id);

  if (req.method === 'POST' && url === '/unlock') {
    const ev = missFor(clientKey(req));
    const wait = blockedFor(ev);
    if (wait) {
      return send(res, 429, JSON.stringify({ error: 'слишком много попыток', retryAfter: Math.ceil(wait / 1000) }));
    }
    return readBody(req, res, (data) => {
      const token = String(data.token || '');
      if (token && meta.salt && sameHash(hashToken(token, meta.salt), meta.unlockHash)) {
        ev.fails = 0; ev.blockUntil = 0;
        return send(res, 200, JSON.stringify({ ok: true, id: id }));
      }
      noteFail(ev);
      send(res, 401, '{"error":"нужен действительный QR из журнала"}');
    });
  }

  if (req.method === 'GET' && url === '/set') {
    return send(res, 200, JSON.stringify(Object.assign({ id: id }, roomSet(id))));
  }

  if (req.method === 'GET' && url === '/state') {
    return send(res, 200, JSON.stringify(readState(r)));
  }

  if (req.method === 'POST' && url === '/state') {
    if (diskFull()) return send(res, 507, '{"error":"на сервере кончилось место"}');
    return readBody(req, res, (patch) => {
      const clean = sanitizeState(id, patch);
      ensureRoom(r);
      fs.writeFileSync(r.state, JSON.stringify(clean));
      send(res, 200, JSON.stringify(clean));
    });
  }

  if (req.method === 'GET' && url === '/preview') {
    if (!fs.existsSync(r.preview)) return send(res, 404, '{"error":"нет снимка"}');
    return send(res, 200, fs.readFileSync(r.preview), 'image/jpeg');
  }

  if (req.method === 'POST' && url === '/preview') {
    if (diskFull()) return send(res, 507, '{"error":"на сервере кончилось место"}');
    return readBody(req, res, (data) => {
      const m = /^data:image\/jpeg;base64,/.exec(data.image || '');
      if (!m) return send(res, 400, '{"error":"нужен image: dataURL jpeg"}');
      const buf = Buffer.from(data.image.slice(m[0].length), 'base64');
      if (!buf.length) return send(res, 400, '{"error":"пустой снимок"}');
      if (buf.length > LIMITS.previewBytes) return send(res, 413, '{"error":"снимок слишком тяжёлый"}');
      ensureRoom(r);
      fs.writeFileSync(r.preview, buf);
      send(res, 200, JSON.stringify({ ok: true, bytes: buf.length }));
    });
  }

  send(res, 404, '{"error":"unknown api"}');
}

function handleApi(req, res, url) {
  if (req.method === 'GET' && url === '/api/rooms/catalog') {
    return send(res, 200, JSON.stringify({ rooms: listRooms().map(publicRoom) }));
  }

  const m = url.match(/^\/api\/r\/([^/]+)(\/.*)?$/);
  if (m) {
    if (!ROOM_ID_RE.test(m[1])) return send(res, 404, '{"error":"нет такой комнаты"}');
    return handleRoomApi(req, res, m[1], m[2] || '/');
  }

  send(res, 404, '{"error":"unknown api"}');
}

// ── статика ────────────────────────────────────────────────────────────────
function pageFor(url) {
  if (url === '/') return 'index.html';
  const m = url.match(/^\/r\/([^/]+)\/?$/);
  if (m && ROOM_ID_RE.test(m[1])) return 'room.html';
  return null;
}

const STATIC_DIRS = ['/assets/', '/vendor/'];
const STATIC_FILES = ['/favicon.ico'];
// Из data наружу смотрит только снимок сцены комнаты.
const DATA_FILE_RE = /^\/data\/rooms\/([a-z0-9-]+)\/preview\.jpg$/;

function staticFor(url) {
  const clean = path.posix.normalize(url);
  if (clean !== url) return null;   // «..», «//», лишние «.» — сразу мимо

  const data = clean.match(DATA_FILE_RE);
  const allowed = data
    ? ROOM_ID_RE.test(data[1])
    : STATIC_FILES.includes(clean) || STATIC_DIRS.some((dir) => clean.startsWith(dir));
  if (!allowed) return null;

  const file = path.normalize(path.join(ROOT, clean));
  return file.startsWith(ROOT + path.sep) ? file : null;
}

function cacheControl(ext, url) {
  if (ext === '.html' || ext === '.js' || ext === '.css') return 'no-cache';
  if (url.startsWith('/data/')) return 'no-cache';
  return 'public, max-age=86400';
}

http.createServer((req, res) => {
  const url = decodeURIComponent(req.url.split('?')[0]);

  if (url.startsWith('/api/')) return handleApi(req, res, url);

  const page = pageFor(url);
  const file = page ? path.join(ROOT, page) : staticFor(url);

  if (!file) return send(res, 404, 'not found', 'text/plain');
  if (!fs.existsSync(file) || !fs.statSync(file).isFile()) {
    return send(res, 404, 'not found', 'text/plain');
  }

  const ext = path.extname(file).toLowerCase();
  const stat = fs.statSync(file);
  const etag = `W/"${stat.size.toString(16)}-${Math.trunc(stat.mtimeMs).toString(16)}"`;
  const headers = { 'Cache-Control': cacheControl(ext, url), ETag: etag };
  if (req.headers['if-none-match'] === etag) {
    res.writeHead(304, headers);
    return res.end();
  }
  headers['Content-Type'] = MIME[ext] || 'application/octet-stream';
  res.writeHead(200, headers);
  fs.createReadStream(file).pipe(res);
}).listen(PORT, '0.0.0.0', () => {
  console.log(`Бумажный мир: http://localhost:${PORT}/`);
  const nets = os.networkInterfaces();
  for (const name of Object.keys(nets)) {
    for (const net of nets[name]) {
      if (net.family === 'IPv4' && !net.internal) {
        console.log(`С телефона (Wi-Fi ${name}): http://${net.address}:${PORT}/`);
      }
    }
  }
});
