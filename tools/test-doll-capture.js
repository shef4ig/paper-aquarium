// Юнит-проверка распознавания куклы без тест-фреймворка и без браузера.
//
// DollCapture.process работает на canvas. В Node canvas нет, поэтому даём
// минимальный шим document/createElement('canvas'): getContext рисует наш
// синтетический источник в ImageData. Источник — объект с методом paint(data,W,H),
// заполняющим пиксели (силуэт куклы на белом фоне + цветное пятно наряда).
'use strict';

const fs = require('fs');
const path = require('path');
const assert = require('assert');

const ROOT = path.join(__dirname, '..');
const SET = JSON.parse(fs.readFileSync(path.join(ROOT, 'assets', 'world', 'room-set.json'), 'utf8'));

// ── canvas-шим ──────────────────────────────────────────────────────────────
function makeCanvas() {
  const cv = { width: 0, height: 0, _painter: null };
  cv.getContext = function () {
    return {
      drawImage: function (src, x, y, w, h) {
        cv.width = w || src.width; cv.height = h || src.height;
        cv._data = new Uint8ClampedArray(cv.width * cv.height * 4);
        // белый фон
        for (let i = 0; i < cv.width * cv.height; i++) {
          cv._data[i * 4] = 255; cv._data[i * 4 + 1] = 255; cv._data[i * 4 + 2] = 255; cv._data[i * 4 + 3] = 255;
        }
        if (src.paint) src.paint(cv._data, cv.width, cv.height);
      },
      getImageData: function (x, y, w, h) { return { data: cv._data, width: w, height: h }; }
    };
  };
  return cv;
}

global.document = { createElement: function (t) { return t === 'canvas' ? makeCanvas() : {}; } };

// Загружаем модуль под window/global.
global.window = global;
require(path.join(ROOT, 'assets', 'doll-capture.js'));

// ── синтетические источники ──────────────────────────────────────────────────
// Прямоугольный силуэт с заданным аспектом; при dressHue — цветное пятно
// в зоне body (центр по вертикали).
function dollSource(aspect, dressHue) {
  const W = 600, H = 800;
  return {
    width: W, height: H,
    paint: function (data) {
      // силуэт: тёмная фигура по центру, ширина = aspect * высота
      const objH = Math.round(H * 0.75);
      const objW = Math.round(objH * aspect);
      const x0 = ((W - objW) / 2) | 0, y0 = ((H - objH) / 2) | 0;
      for (let y = y0; y < y0 + objH; y++) {
        for (let x = x0; x < x0 + objW; x++) {
          const i = (y * W + x) * 4;
          data[i] = 70; data[i + 1] = 60; data[i + 2] = 55; // тёмная фигура
        }
      }
      if (dressHue != null) {
        // тело ~ середина фигуры по вертикали (anchor body y=300 из 560 ≈ 0.54)
        const by0 = y0 + Math.round(objH * 0.40), by1 = y0 + Math.round(objH * 0.70);
        const rgb = hslToRgb(dressHue, 0.75, 0.5);
        for (let y = by0; y < by1; y++) {
          for (let x = x0; x < x0 + objW; x++) {
            const i = (y * W + x) * 4;
            data[i] = rgb[0]; data[i + 1] = rgb[1]; data[i + 2] = rgb[2];
          }
        }
      }
    }
  };
}

function hslToRgb(h, s, l) {
  h /= 360;
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs((h * 6) % 2 - 1));
  const m = l - c / 2;
  let r, g, b;
  if (h < 1 / 6) [r, g, b] = [c, x, 0];
  else if (h < 2 / 6) [r, g, b] = [x, c, 0];
  else if (h < 3 / 6) [r, g, b] = [0, c, x];
  else if (h < 4 / 6) [r, g, b] = [0, x, c];
  else if (h < 5 / 6) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  return [Math.round((r + m) * 255), Math.round((g + m) * 255), Math.round((b + m) * 255)];
}

// ── прогон ───────────────────────────────────────────────────────────────────
let passed = 0, failed = 0;
function ok(name, cond) {
  if (cond) { passed++; console.log('  ok  ' + name); }
  else { failed++; console.log('FAIL  ' + name); }
}

// Аспект первой базы из реального набора — под него строим синтетику.
const FIRST_BASE = SET.bases[0];
const BASE_ASPECT = (FIRST_BASE.recognition && FIRST_BASE.recognition.aspect) || 0.57;

// Наряд с заданным dominantHue (если такой есть в наборе) — для проверки
// цветового распознавания слоёв. У авто-нарезанных нарядов hue может не быть.
const HUE_GARMENT = (SET.garments || []).filter(function (g) {
  return g.baseId === FIRST_BASE.id && g.recognition && g.recognition.dominantHue != null;
})[0];

async function run() {
  // 1. Узнаём первую базу набора по её аспекту.
  const r1 = await window.DollCapture.process(dollSource(BASE_ASPECT, null), SET);
  ok('база распознана (' + FIRST_BASE.id + ')', r1.baseId === FIRST_BASE.id);
  ok('уверенность по базе', r1.confident === true);

  // 2. Совсем другой аспект → низкая уверенность по базе.
  const r4 = await window.DollCapture.process(dollSource(BASE_ASPECT + 0.5, null), SET);
  ok('чужой аспект → не уверен', r4.confident === false);

  // 3. Если у набора есть наряд с hue — проверяем цветовое распознавание.
  if (HUE_GARMENT) {
    const r2 = await window.DollCapture.process(dollSource(BASE_ASPECT, HUE_GARMENT.recognition.dominantHue), SET);
    ok('распознан цветной наряд (' + HUE_GARMENT.id + ')', r2.garments.indexOf(HUE_GARMENT.id) !== -1);
    const r3 = await window.DollCapture.process(dollSource(BASE_ASPECT, null), SET);
    ok('без наряда — цветной наряд не добавлен', r3.garments.indexOf(HUE_GARMENT.id) === -1);
  } else {
    console.log('  --  нарядов с dominantHue в наборе нет, цветовой тест пропущен');
  }

  console.log('\n' + passed + ' passed, ' + failed + ' failed');
  process.exit(failed ? 1 : 0);
}

run().catch(function (e) { console.error(e); process.exit(1); });
