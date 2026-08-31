// Каталог набора комнаты: персонажи (база + наряды) и декор.
// Рисует меню, собирает выбор и отдаёт его наружу через колбэки.
//
//   Catalog.render(container, set, {
//     onAddDoll: function(baseId, garments) {},
//     onAddDecor: function(decorId) {}
//   })
(function () {
  'use strict';

  function title(o) {
    return (o.titles && (o.titles[I18N.lang] || o.titles.ru)) || o.id;
  }

  function tile(imgSrc, label) {
    var b = document.createElement('button');
    b.type = 'button'; b.className = 'cat-tile';
    var img = document.createElement('img'); img.src = imgSrc; img.alt = '';
    var t = document.createElement('span'); t.textContent = label;
    b.appendChild(img); b.appendChild(t);
    return b;
  }

  function render(container, set, cb) {
    cb = cb || {};
    container.textContent = '';

    var tabs = document.createElement('div');
    tabs.className = 'cat-tabs';
    var tabChars = document.createElement('button');
    tabChars.type = 'button'; tabChars.className = 'b'; tabChars.textContent = I18N.t('cat.tab.chars');
    var tabDecor = document.createElement('button');
    tabDecor.type = 'button'; tabDecor.className = 'b'; tabDecor.textContent = I18N.t('cat.tab.decor');
    tabs.appendChild(tabChars); tabs.appendChild(tabDecor);
    container.appendChild(tabs);

    var pane = document.createElement('div');
    pane.className = 'cat-pane';
    container.appendChild(pane);

    function empty() {
      var p = document.createElement('p');
      p.className = 'cat-empty'; p.textContent = I18N.t('cat.empty');
      return p;
    }

    // ── персонажи ──
    function showChars() {
      tabChars.setAttribute('aria-pressed', 'true');
      tabDecor.setAttribute('aria-pressed', 'false');
      pane.textContent = '';
      if (!set.bases.length) { pane.appendChild(empty()); return; }

      var lead = document.createElement('p');
      lead.className = 'cat-lead'; lead.textContent = I18N.t('cat.pick.base');
      pane.appendChild(lead);

      var grid = document.createElement('div');
      grid.className = 'cat-grid';
      pane.appendChild(grid);

      set.bases.forEach(function (base) {
        var b = tile(base.thumb || base.sprite, title(base));
        b.onclick = function () { pickGarments(base); };
        grid.appendChild(b);
      });
    }

    function pickGarments(base) {
      pane.textContent = '';
      var lead = document.createElement('p');
      lead.className = 'cat-lead'; lead.textContent = I18N.t('cat.pick.garments');
      pane.appendChild(lead);

      var chosen = {};
      var options = set.garments.filter(function (g) { return g.baseId === base.id; });
      var grid = document.createElement('div');
      grid.className = 'cat-grid';
      options.forEach(function (g) {
        var b = tile(g.thumb || g.sprite, title(g));
        b.onclick = function () {
          if (chosen[g.id]) { delete chosen[g.id]; b.setAttribute('aria-pressed', 'false'); }
          else { chosen[g.id] = true; b.setAttribute('aria-pressed', 'true'); }
        };
        grid.appendChild(b);
      });
      pane.appendChild(grid);

      var add = document.createElement('button');
      add.type = 'button'; add.className = 'b cat-add'; add.textContent = I18N.t('cat.add');
      add.onclick = function () {
        if (cb.onAddDoll) cb.onAddDoll(base.id, Object.keys(chosen));
      };
      pane.appendChild(add);
    }

    // ── декор ──
    function showDecor() {
      tabChars.setAttribute('aria-pressed', 'false');
      tabDecor.setAttribute('aria-pressed', 'true');
      pane.textContent = '';
      if (!set.decor.length) { pane.appendChild(empty()); return; }
      var grid = document.createElement('div');
      grid.className = 'cat-grid';
      pane.appendChild(grid);
      set.decor.forEach(function (d) {
        var b = tile(d.thumb || d.sprite, title(d));
        b.onclick = function () { if (cb.onAddDecor) cb.onAddDecor(d.id); };
        grid.appendChild(b);
      });
    }

    tabChars.onclick = showChars;
    tabDecor.onclick = showDecor;
    showChars();
  }

  window.Catalog = { render: render };
})();
