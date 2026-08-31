// Сцена комнаты: фон-плоскость + спрайты кукол и декора (2.5D на three.js).
//
// Кукла собирается композитом эталонов в offscreen-canvas: база + слои одежды
// по точкам крепления. Качество фиксировано эталонами и не зависит от фото.
// Декор — спрайт готового эталона. Лёгкий дрейф — покачивание без деформации.
//
// API:
//   RoomScene.init(background)              — создать сцену
//   RoomScene.setSet(set)                   — запомнить набор эталонов комнаты
//   RoomScene.load(state)                   — восстановить расстановку
//   RoomScene.addDoll(baseId, garments)     — поставить куклу (случайное место)
//   RoomScene.addDecor(decorId)             — поставить декор
//   RoomScene.serialize()                   — вернуть {dolls, decor}
//   RoomScene.snapshot()                    — dataURL jpeg сцены
//   RoomScene.onChange(fn)                  — колбэк при изменении расстановки
(function () {
  'use strict';

  var renderer, scene, camera, clock;
  var objects = [];          // { iid, type, id, garments, sprite, baseX, baseY, phase }
  var set = { bases: [], garments: [], decor: [] };
  var changeCb = null;
  var W = 16, Hh = 9;        // мир: логическая ширина/высота плоскости сцены

  var texCache = {};

  function byId(list, id) { for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i]; return null; }

  // ── композит куклы: база + слои одежды по anchor ──────────────────────────
  function loadImage(src) {
    return new Promise(function (resolve, reject) {
      var img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = function () { resolve(img); };
      img.onerror = function () { reject(new Error('img ' + src)); };
      img.src = src;
    });
  }

  function composeDoll(baseId, garments) {
    var base = byId(set.bases, baseId);
    if (!base) return Promise.reject(new Error('no base ' + baseId));
    var w = (base.size && base.size.w) || 300;
    var h = (base.size && base.size.h) || 560;
    var cv = document.createElement('canvas');
    cv.width = w; cv.height = h;
    var ctx = cv.getContext('2d');

    // База рисуется на весь холст. Наряды — реальные вырезки, кладём каждый
    // по его точке крепления (anchor), масштабируя по ширине базы, а не растягивая
    // на весь холст (иначе предмет одежды размажется по всей фигуре).
    var layers = [{ src: base.sprite, garment: null }];
    (garments || []).forEach(function (gid) {
      var g = byId(set.garments, gid);
      if (g && g.baseId === baseId) layers.push({ src: g.sprite, garment: g });
    });

    return Promise.all(layers.map(function (l) { return loadImage(l.src); })).then(function (imgs) {
      imgs.forEach(function (img, i) {
        var l = layers[i];
        if (!l.garment) { ctx.drawImage(img, 0, 0, w, h); return; }
        var anchor = (base.anchors && base.anchors[l.garment.anchor]) || { x: w / 2, y: h / 2 };
        // Ширина наряда — доля ширины базы; высота по пропорции спрайта.
        var gw = w * 0.7;
        var gh = gw * (img.height / img.width);
        ctx.drawImage(img, anchor.x - gw / 2, anchor.y - gh / 2, gw, gh);
      });
      return { canvas: cv, w: w, h: h };
    });
  }

  function spriteFromCanvas(cv) {
    var tex = new THREE.CanvasTexture(cv);
    tex.minFilter = THREE.LinearFilter;
    tex.generateMipmaps = false;
    var mat = new THREE.SpriteMaterial({ map: tex, transparent: true });
    return new THREE.Sprite(mat);
  }

  function decorSprite(decorId) {
    var d = byId(set.decor, decorId);
    if (!d) return Promise.reject(new Error('no decor ' + decorId));
    return loadImage(d.sprite).then(function (img) {
      var cv = document.createElement('canvas');
      var w = (d.size && d.size.w) || img.width || 300;
      var h = (d.size && d.size.h) || img.height || 300;
      cv.width = w; cv.height = h;
      cv.getContext('2d').drawImage(img, 0, 0, w, h);
      return { canvas: cv, w: w, h: h };
    });
  }

  // Разместить спрайт: x,y — доли сцены (0..1), верх-лево. Масштаб — от высоты.
  function place(sprite, wpx, hpx, x, y, worldH) {
    var aspect = wpx / hpx;
    var sy = worldH;
    var sx = worldH * aspect;
    sprite.scale.set(sx, sy, 1);
    var px = (x - 0.5) * W;
    var py = (0.5 - y) * Hh;
    sprite.position.set(px, py, 0);
  }

  function fireChange() { if (changeCb) changeCb(); }

  // ── публичные операции ────────────────────────────────────────────────────
  function addDollAt(iid, baseId, garments, x, y) {
    return composeDoll(baseId, garments).then(function (c) {
      var sp = spriteFromCanvas(c.canvas);
      place(sp, c.w, c.h, x, y, Hh * 0.55);
      sp.renderOrder = 2;
      scene.add(sp);
      objects.push({
        iid: iid, type: 'doll', id: baseId, garments: (garments || []).slice(),
        sprite: sp, baseX: sp.position.x, baseY: sp.position.y,
        phase: Math.random() * Math.PI * 2
      });
    });
  }

  function addDecorAt(iid, decorId, x, y) {
    return decorSprite(decorId).then(function (c) {
      var sp = spriteFromCanvas(c.canvas);
      place(sp, c.w, c.h, x, y, Hh * 0.32);
      sp.renderOrder = 1;
      scene.add(sp);
      objects.push({
        iid: iid, type: 'decor', id: decorId,
        sprite: sp, baseX: sp.position.x, baseY: sp.position.y,
        phase: Math.random() * Math.PI * 2
      });
    });
  }

  var seq = 0;
  function newIid() { return Date.now().toString(36) + (seq++).toString(36); }

  function init(background) {
    renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    renderer.setSize(innerWidth, innerHeight);
    document.body.appendChild(renderer.domElement);

    scene = new THREE.Scene();
    scene.background = new THREE.Color('#101018');

    // Ортокамера: комната — плоская сцена «окно в бумажный мир».
    var aspect = innerWidth / innerHeight;
    camera = new THREE.OrthographicCamera(-W / 2, W / 2, Hh / 2, -Hh / 2, 0.1, 100);
    // подгоняем под аспект окна (cover)
    fitCamera();
    camera.position.set(0, 0, 10);
    camera.lookAt(0, 0, 0);

    if (background) {
      loadImage(background).then(function (img) {
        var tex = new THREE.CanvasTexture(toCanvas(img));
        tex.minFilter = THREE.LinearFilter; tex.generateMipmaps = false;
        var geo = new THREE.PlaneGeometry(W, Hh);
        var mat = new THREE.MeshBasicMaterial({ map: tex });
        var plane = new THREE.Mesh(geo, mat);
        plane.position.set(0, 0, -1);
        plane.renderOrder = 0;
        scene.add(plane);
      }).catch(function () { /* фон не загрузился — сцена всё равно работает */ });
    }

    clock = new THREE.Clock();
    addEventListener('resize', onResize);
    animate();
  }

  function toCanvas(img) {
    var cv = document.createElement('canvas');
    cv.width = img.width || 1280; cv.height = img.height || 720;
    cv.getContext('2d').drawImage(img, 0, 0);
    return cv;
  }

  function fitCamera() {
    var aspect = innerWidth / innerHeight;
    var worldAspect = W / Hh;
    if (aspect > worldAspect) {
      var h = W / aspect;
      camera.top = h / 2; camera.bottom = -h / 2; camera.left = -W / 2; camera.right = W / 2;
    } else {
      var w = Hh * aspect;
      camera.left = -w / 2; camera.right = w / 2; camera.top = Hh / 2; camera.bottom = -Hh / 2;
    }
    camera.updateProjectionMatrix();
  }

  function onResize() {
    renderer.setSize(innerWidth, innerHeight);
    fitCamera();
  }

  function animate() {
    requestAnimationFrame(animate);
    var t = clock.getElapsedTime();
    // Лёгкий дрейф: покачивание позицией, изображение не деформируется.
    objects.forEach(function (o) {
      if (o.type === 'doll') {
        o.sprite.position.y = o.baseY + Math.sin(t * 1.2 + o.phase) * 0.08;
        o.sprite.position.x = o.baseX + Math.cos(t * 0.8 + o.phase) * 0.05;
      }
    });
    renderer.render(scene, camera);
  }

  window.RoomScene = {
    init: init,
    setSet: function (s) { set = s || set; },
    load: function (state) {
      (state && state.decor || []).forEach(function (d) { addDecorAt(d.iid || newIid(), d.decorId, d.x, d.y); });
      (state && state.dolls || []).forEach(function (d) { addDollAt(d.iid || newIid(), d.baseId, d.garments, d.x, d.y); });
    },
    addDoll: function (baseId, garments) {
      return addDollAt(newIid(), baseId, garments, 0.35 + Math.random() * 0.3, 0.55 + Math.random() * 0.2)
        .then(fireChange);
    },
    addDecor: function (decorId) {
      return addDecorAt(newIid(), decorId, 0.3 + Math.random() * 0.4, 0.7 + Math.random() * 0.15)
        .then(fireChange);
    },
    serialize: function () {
      var dolls = [], decor = [];
      objects.forEach(function (o) {
        var x = o.baseX / W + 0.5;
        var y = 0.5 - o.baseY / Hh;
        if (o.type === 'doll') dolls.push({ iid: o.iid, baseId: o.id, garments: o.garments, x: x, y: y });
        else decor.push({ iid: o.iid, decorId: o.id, x: x, y: y });
      });
      return { dolls: dolls, decor: decor };
    },
    snapshot: function () {
      try { renderer.render(scene, camera); return renderer.domElement.toDataURL('image/jpeg', 0.8); }
      catch (e) { return null; }
    },
    onChange: function (fn) { changeCb = fn; }
  };
})();
