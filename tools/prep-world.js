// Офлайн-подготовка эталонов «Бумажного мира».
//
// Это НЕ рантайм: инструмент запускают вручную при подготовке контента.
// Он собирает assets/world/room-set.json из описания нарезки, а сами спрайты
// режет из исходных страниц журнала (PNG). Без внешних зависимостей.
//
// Идея: тяжёлую ручную работу (какая фигурка где на странице, куда встают
// наряды, какие признаки распознавания) автор задаёт в файле-плане
// (tools/prep-plan.json). Инструмент лишь применяет план: копирует/режет
// спрайты и записывает манифест. Так подготовка воспроизводима и проверяема.
//
// Использование:
//   node tools/prep-world.js            — собрать по tools/prep-plan.json
//   node tools/prep-world.js --check    — только проверить план и спрайты
//
// Формат плана (tools/prep-plan.json):
//   {
//     "rooms": [{ "id", "titles", "background" }],
//     "bases": [{ "id", "room", "titles", "sprite", "size", "anchors", "recognition" }],
//     "garments": [{ "id", "baseId", "anchor", "titles", "sprite", "recognition" }],
//     "decor": [{ "id", "room", "titles", "sprite", "size" }]
//   }
//
// Нарезка из страниц: если у записи задан "crop": { "page", "x","y","w","h" },
// инструмент вырежет прямоугольник из assets/world/pages/<page> в указанный
// "sprite". Если "crop" нет — спрайт считается уже готовым.
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const PLAN = path.join(__dirname, 'prep-plan.json');
const SET_OUT = path.join(ROOT, 'assets', 'world', 'room-set.json');
const ROOMS_OUT = path.join(ROOT, 'assets', 'world', 'rooms.json');

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '')); }
  catch (e) { return null; }
}

function spriteExists(rel) {
  if (!rel) return false;
  const file = path.join(ROOT, rel.replace(/^\//, ''));
  return fs.existsSync(file);
}

// Проверка плана: все спрайты на месте, привязки согласованы.
function check(plan) {
  const problems = [];
  const baseIds = new Set((plan.bases || []).map((b) => b.id));

  (plan.bases || []).forEach((b) => {
    if (!b.id || !b.room) problems.push('base без id/room: ' + JSON.stringify(b));
    if (!b.crop && !spriteExists(b.sprite)) problems.push('нет спрайта базы: ' + b.sprite);
    if (!b.anchors) problems.push('база без anchors: ' + b.id);
  });
  (plan.garments || []).forEach((g) => {
    if (!baseIds.has(g.baseId)) problems.push('наряд ' + g.id + ' ссылается на несуществующую базу ' + g.baseId);
    if (g.anchor && plan.bases) {
      const base = plan.bases.find((b) => b.id === g.baseId);
      if (base && base.anchors && !base.anchors[g.anchor]) {
        problems.push('наряд ' + g.id + ': у базы ' + g.baseId + ' нет anchor ' + g.anchor);
      }
    }
    if (!g.crop && !spriteExists(g.sprite)) problems.push('нет спрайта наряда: ' + g.sprite);
  });
  (plan.decor || []).forEach((d) => {
    if (!d.id || !d.room) problems.push('decor без id/room: ' + JSON.stringify(d));
    if (!d.crop && !spriteExists(d.sprite)) problems.push('нет спрайта декора: ' + d.sprite);
  });
  return problems;
}

// Нарезка спрайтов из страниц. PNG-декодирование без зависимостей не делаем —
// вместо этого поддерживаем два honest-режима:
//   1) спрайт уже готов (нет crop) — просто ссылаемся;
//   2) crop задан — печатаем инструкцию для внешнего инструмента (ImageMagick),
//      чтобы нарезка была воспроизводимой и без бинарных зависимостей в проекте.
function planCrops(plan) {
  const cmds = [];
  const collect = (list) => (list || []).forEach((o) => {
    if (!o.crop) return;
    const page = path.join(ROOT, 'assets', 'world', 'pages', o.crop.page);
    const out = path.join(ROOT, o.sprite.replace(/^\//, ''));
    cmds.push(`magick "${page}" -crop ${o.crop.w}x${o.crop.h}+${o.crop.x}+${o.crop.y} +repage "${out}"`);
  });
  collect(plan.bases); collect(plan.garments); collect(plan.decor);
  return cmds;
}

// Сборка манифестов из плана.
function build(plan) {
  const set = {
    version: 1,
    recognition: plan.recognition || { baseConfidence: 0.55, garmentConfidence: 0.5 },
    bases: (plan.bases || []).map((b) => ({
      id: b.id, room: b.room, titles: b.titles,
      sprite: b.sprite, thumb: b.thumb || b.sprite,
      size: b.size, anchors: b.anchors, recognition: b.recognition || {}
    })),
    garments: (plan.garments || []).map((g) => ({
      id: g.id, baseId: g.baseId, anchor: g.anchor, titles: g.titles,
      sprite: g.sprite, thumb: g.thumb || g.sprite, recognition: g.recognition || {}
    })),
    decor: (plan.decor || []).map((d) => ({
      id: d.id, room: d.room, titles: d.titles,
      sprite: d.sprite, thumb: d.thumb || d.sprite, size: d.size
    }))
  };
  fs.writeFileSync(SET_OUT, JSON.stringify(set, null, 2));
  console.log('записан', path.relative(ROOT, SET_OUT));

  // rooms.json трогаем только если в плане есть комнаты с готовыми хешами.
  if (plan.rooms && plan.rooms.length) {
    const rooms = { version: 1, rooms: plan.rooms };
    fs.writeFileSync(ROOMS_OUT, JSON.stringify(rooms, null, 2));
    console.log('записан', path.relative(ROOT, ROOMS_OUT));
  }
}

function main() {
  const plan = readJson(PLAN);
  if (!plan) {
    console.error('нет плана', path.relative(ROOT, PLAN), '— создай его по формату из шапки prep-world.js');
    process.exit(1);
  }
  const problems = check(plan);
  if (problems.length) {
    console.error('проблемы в плане:');
    problems.forEach((p) => console.error('  · ' + p));
    process.exit(1);
  }
  const crops = planCrops(plan);
  if (crops.length) {
    console.log('нарезка спрайтов (выполни во внешнем инструменте):');
    crops.forEach((c) => console.log('  ' + c));
  }
  if (process.argv.indexOf('--check') !== -1) { console.log('план валиден'); return; }
  build(plan);
  console.log('готово');
}

main();
