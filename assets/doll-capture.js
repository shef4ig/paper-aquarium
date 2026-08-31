// Распознавание собранной бумажной куклы по фотографии.
//
// Фото — КЛЮЧ к сборке, а не источник пикселей: с него берутся только
// идентификаторы базовой фигурки и надетых слоёв в пределах набора комнаты.
// Персонаж в сцене собирается из эталонов (см. room-scene.js).
//
//   DollCapture.process(source, set) → Promise<{
//     baseId, garments:[…], uncertain:[…], confident:bool
//   }> | reject(Error)
//
// Без внешних зависимостей: заливка фона от краёв и оценка признаков силуэта
// на canvas, тот же подход, что в capture.js базового проекта.
(function () {
  'use strict';

  var WORK_MAX = 1000;

  function toWork(source) {
    var sw = source.width || source.naturalWidth || source.videoWidth;
    var sh = source.height || source.naturalHeight || source.videoHeight;
    var k = Math.min(1, WORK_MAX / Math.max(sw, sh));
    var W = Math.round(sw * k), H = Math.round(sh * k);
    var cv = document.createElement('canvas');
    cv.width = W; cv.height = H;
    var ctx = cv.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(source, 0, 0, W, H);
    return { W: W, H: H, data: ctx.getImageData(0, 0, W, H).data };
  }

  // Заливка фона от краёв: светлые пиксели, связные с рамкой, считаем фоном.
  function segment(W, H, data) {
    var bg = new Uint8Array(W * H);
    var stack = [];
    function lum(i) { var o = i * 4; return data[o] * 0.299 + data[o + 1] * 0.587 + data[o + 2] * 0.114; }
    function push(i, force) {
      if (bg[i]) return;
      if (force || lum(i) > 150) { bg[i] = 1; stack.push(i); }
    }
    for (var x = 0; x < W; x++) { push(x, true); push((H - 1) * W + x, true); }
    for (var y = 0; y < H; y++) { push(y * W, true); push(y * W + W - 1, true); }
    while (stack.length) {
      var c = stack.pop(), px = c % W, py = (c / W) | 0;
      for (var dy = -1; dy <= 1; dy++) for (var dx = -1; dx <= 1; dx++) {
        var nx = px + dx, ny = py + dy;
        if (nx >= 0 && ny >= 0 && nx < W && ny < H) push(ny * W + nx, false);
      }
    }
    return bg;
  }

  function bbox(W, H, bg) {
    var minX = W, maxX = 0, minY = H, maxY = 0, n = 0;
    for (var y = 0; y < H; y++) for (var x = 0; x < W; x++) {
      if (!bg[y * W + x]) { n++; if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y; }
    }
    return { minX: minX, maxX: maxX, minY: minY, maxY: maxY, n: n };
  }

  // Доминирующий оттенок области объекта (для слоёв). Возвращает hue 0..360
  // и покрытие (доля цветных, не серых пикселей).
  function regionHue(W, H, data, bg, x0, y0, x1, y1) {
    var hx = 0, hy = 0, colored = 0, total = 0;
    for (var y = y0; y < y1; y++) for (var x = x0; x < x1; x++) {
      var i = y * W + x;
      if (bg[i]) continue;
      total++;
      var o = i * 4, r = data[o], g = data[o + 1], b = data[o + 2];
      var mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
      if (d < 30) continue;      // серое/бумага — не в счёт
      colored++;
      var h;
      if (mx === r) h = ((g - b) / d) % 6;
      else if (mx === g) h = (b - r) / d + 2;
      else h = (r - g) / d + 4;
      h *= 60; if (h < 0) h += 360;
      var rad = h * Math.PI / 180;
      hx += Math.cos(rad); hy += Math.sin(rad);
    }
    var hue = Math.atan2(hy, hx) * 180 / Math.PI; if (hue < 0) hue += 360;
    return { hue: hue, coverage: total ? colored / total : 0, total: total };
  }

  function hueDist(a, b) { var d = Math.abs(a - b) % 360; return d > 180 ? 360 - d : d; }

  function process(source, set) {
    return new Promise(function (resolve, reject) {
      var w;
      try { w = toWork(source); } catch (e) { reject(new Error('photo')); return; }
      var W = w.W, H = w.H, data = w.data;

      var bg = segment(W, H, data);
      var bb = bbox(W, H, bg);
      if (bb.n < 200 || bb.minX > bb.maxX) { reject(new Error('nofish')); return; }

      var objW = bb.maxX - bb.minX + 1, objH = bb.maxY - bb.minY + 1;
      var aspect = objW / objH;

      var rec = set.recognition || {};
      var baseThr = rec.baseConfidence != null ? rec.baseConfidence : 0.55;
      var garThr = rec.garmentConfidence != null ? rec.garmentConfidence : 0.5;

      // ── база по признаку силуэта (аспект) в пределах набора комнаты ──
      var best = null, bestScore = -1;
      (set.bases || []).forEach(function (base) {
        var target = (base.recognition && base.recognition.aspect) || 0.5;
        // score: близость аспекта, нормируем разумным разбросом
        var score = 1 - Math.min(1, Math.abs(aspect - target) / 0.4);
        if (score > bestScore) { bestScore = score; best = base; }
      });
      if (!best) { reject(new Error('nofish')); return; }
      var confident = bestScore >= baseThr;

      // ── слои по anchor базы: цвет области вокруг точки крепления ──
      var garments = [], uncertain = [];
      var candidates = (set.garments || []).filter(function (g) { return g.baseId === best.id; });
      var baseW = (best.size && best.size.w) || 300;
      var baseH = (best.size && best.size.h) || 560;

      candidates.forEach(function (g) {
        var anchor = best.anchors && best.anchors[g.anchor];
        if (!anchor) { return; }
        // окно вокруг anchor в координатах фото
        var ax = bb.minX + (anchor.x / baseW) * objW;
        var ay = bb.minY + (anchor.y / baseH) * objH;
        var rw = objW * 0.22, rh = objH * 0.14;
        var x0 = Math.max(bb.minX, (ax - rw) | 0), x1 = Math.min(bb.maxX + 1, (ax + rw) | 0);
        var y0 = Math.max(bb.minY, (ay - rh) | 0), y1 = Math.min(bb.maxY + 1, (ay + rh) | 0);
        var reg = regionHue(W, H, data, bg, x0, y0, x1, y1);

        var want = (g.recognition && g.recognition.dominantHue != null) ? g.recognition.dominantHue : null;
        var minCov = (g.recognition && g.recognition.coverage) || 0.2;
        if (want == null) { return; }

        var hueOk = hueDist(reg.hue, want) <= 40;
        var covOk = reg.coverage >= minCov * 0.6;
        // уверенность: и цвет, и покрытие
        var conf = (hueOk ? 0.6 : 0) + (covOk ? 0.4 : 0);
        if (conf >= garThr && hueOk && covOk) garments.push(g.id);
        else if (hueOk || covOk) uncertain.push(g.id);
      });

      resolve({ baseId: best.id, garments: garments, uncertain: uncertain, confident: confident });
    });
  }

  window.DollCapture = { process: process };
})();
