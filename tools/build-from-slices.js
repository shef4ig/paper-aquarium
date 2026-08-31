// Собирает набор комнаты из реально нарезанных объектов страниц.
//
// Принимает staging-папки нарезки (см. slice-page.ps1) и классифицирует
// объекты по аспекту: высокие (aspect < 0.8) — базовые фигурки, широкие/
// квадратные — предметы одежды/декора. Копирует спрайты в assets/world/sprites
// и пишет room-set.json + rooms.json.
//
// Использование:
//   node tools/build-from-slices.js
//
// Конфиг ниже описывает, какие staging-папки к какой комнате относятся и как
// раскладывать объекты. Это единственное «ручное» знание — всё остальное
// (нарезка, классификация, привязки) делается автоматически.
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.join(__dirname, '..');
const SPRITES = path.join(ROOT, 'assets', 'world', 'sprites');
const SET_OUT = path.join(ROOT, 'assets', 'world', 'room-set.json');
const ROOMS_OUT = path.join(ROOT, 'assets', 'world', 'rooms.json');

// Комнаты: реальные фоны-локации + токены разблокировки.
const ROOMS = [
  { id: 'bedroom', token: 'bedroom-key', titles: { ru: 'Спальня', en: 'Bedroom', pl: 'Sypialnia' }, background: '/assets/world/backgrounds/bedroom.png', stage: '_slice12' },
  { id: 'kitchen', token: 'kitchen-key', titles: { ru: 'Кухня', en: 'Kitchen', pl: 'Kuchnia' }, background: '/assets/world/backgrounds/kitchen.png', stage: '_slice10' }
];

// Аспект, ниже которого объект — фигурка (высокий силуэт).
const FIGURE_ASPECT = 0.8;

function imgSize(file) {
  // Читаем размер PNG из заголовка IHDR (байты 16..24).
  const b = fs.readFileSync(file);
  return { w: b.readUInt32BE(16), h: b.readUInt32BE(20) };
}

function copySprite(srcFile, destRel) {
  const dest = path.join(ROOT, destRel.replace(/^\//, ''));
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(srcFile, dest);
  return destRel;
}

function build() {
  const set = { version: 1, recognition: { baseConfidence: 0.5, garmentConfidence: 0.5 }, bases: [], garments: [], decor: [] };
  const rooms = { version: 1, rooms: [] };

  ROOMS.forEach((r) => {
    const stageDir = path.join(__dirname, r.stage);
    let files = [];
    try { files = fs.readdirSync(stageDir).filter((f) => f.endsWith('.png')).sort(); }
    catch (e) { console.warn('нет staging', r.stage, '— пропускаю комнату', r.id); }

    // Разбор объектов на фигурки и предметы по аспекту.
    const figures = [], items = [];
    files.forEach((f) => {
      const full = path.join(stageDir, f);
      const s = imgSize(full);
      const aspect = s.w / s.h;
      (aspect < FIGURE_ASPECT ? figures : items).push({ full: full, w: s.w, h: s.h, aspect: aspect });
    });

    // Первая фигурка — базовая фигурка комнаты. Остальные фигурки — тоже базы
    // (разные персонажи), но для простоты берём первую как основную базу,
    // а прочие фигурки — как альтернативные базы.
    figures.slice(0, 3).forEach((fig, i) => {
      const baseId = r.id + '-char' + (i + 1);
      const w = fig.w, h = fig.h;
      const sprite = copySprite(fig.full, '/assets/world/sprites/' + r.id + '/' + baseId + '.png');
      set.bases.push({
        id: baseId, room: r.id,
        titles: { ru: 'Персонаж ' + (i + 1), en: 'Character ' + (i + 1), pl: 'Postać ' + (i + 1) },
        sprite: sprite, thumb: sprite,
        size: { w: w, h: h },
        anchors: {
          head: { x: Math.round(w / 2), y: Math.round(h * 0.12) },
          body: { x: Math.round(w / 2), y: Math.round(h * 0.5) },
          feet: { x: Math.round(w / 2), y: Math.round(h * 0.9) }
        },
        recognition: { aspect: Math.round(fig.aspect * 1000) / 1000 }
      });
    });

    // Широкие объекты — предметы одежды/декора. Крупные (площадь) — декор
    // комнаты, помельче — наряды на первую базу.
    // Широкие объекты со страницы персонажей — наряды на первую базу.
    // Чередуем anchor, чтобы предметы не наваливались в одну точку.
    // Широкие объекты со страницы персонажей: часть — наряды на первую базу,
    // часть — предметы декора (чтобы обе вкладки каталога были наполнены).
    const primaryBase = set.bases.filter((b) => b.room === r.id)[0];
    const anchors = ['body', 'head', 'feet'];
    let gi = 0, di = 0;
    items.forEach((it, i) => {
      if (primaryBase && i % 2 === 0) {
        gi++;
        const gid = r.id + '-garment' + gi;
        const sprite = copySprite(it.full, '/assets/world/sprites/' + r.id + '/' + gid + '.png');
        set.garments.push({
          id: gid, baseId: primaryBase.id, anchor: anchors[gi % anchors.length],
          titles: { ru: 'Наряд ' + gi, en: 'Outfit ' + gi, pl: 'Strój ' + gi },
          sprite: sprite, thumb: sprite, size: { w: it.w, h: it.h }, recognition: {}
        });
      } else {
        di++;
        const did = r.id + '-decor' + di;
        const sprite = copySprite(it.full, '/assets/world/sprites/decor/' + did + '.png');
        set.decor.push({
          id: did, room: r.id,
          titles: { ru: 'Предмет ' + di, en: 'Item ' + di, pl: 'Przedmiot ' + di },
          sprite: sprite, thumb: sprite, size: { w: it.w, h: it.h }
        });
      }
    });

    // Комната в реестр (реальный scrypt-хеш токена).
    const salt = crypto.randomBytes(16).toString('hex');
    const unlockHash = crypto.scryptSync(r.token, salt, 32).toString('hex');
    rooms.rooms.push({ id: r.id, titles: r.titles, background: r.background, salt: salt, unlockHash: unlockHash });
    console.log(r.id + ': базы ' + set.bases.filter((b) => b.room === r.id).length +
      ', наряды ' + set.garments.length + ', декор ' + set.decor.filter((d) => d.room === r.id).length +
      '  (токен: ' + r.token + ')');
  });

  fs.writeFileSync(SET_OUT, JSON.stringify(set, null, 2));
  fs.writeFileSync(ROOMS_OUT, JSON.stringify(rooms, null, 2));
  console.log('записаны room-set.json и rooms.json');
}

build();
