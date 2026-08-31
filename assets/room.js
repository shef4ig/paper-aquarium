// Какая комната открыта и какие открыты на этом устройстве.
//
// Регистрации нет: комнаты фиксированы реестром, «открыта» — свойство
// устройства. Список открытых комнат браузер держит в localStorage.
// Токен из QR после успешной разблокировки не хранится — он больше не нужен.
(function () {
  'use strict';

  var ID_RE = /^[a-z0-9-]{2,32}$/;
  var m = location.pathname.match(/^\/r\/([^/]+)/);
  var id = (m && ID_RE.test(m[1])) ? m[1] : null;

  var KEY = 'world.rooms';

  function unlocked() {
    try {
      var list = JSON.parse(localStorage.getItem(KEY));
      return Array.isArray(list) ? list.filter(function (x) { return ID_RE.test(x); }) : [];
    } catch (e) { return []; }
  }

  function save(list) {
    try { localStorage.setItem(KEY, JSON.stringify(list)); } catch (e) { /* приватный режим */ }
  }

  function isUnlocked(roomId) {
    return unlocked().indexOf(roomId || id) !== -1;
  }

  function remember(roomId) {
    if (!ID_RE.test(roomId)) return;
    var list = unlocked();
    if (list.indexOf(roomId) === -1) { list.push(roomId); save(list); }
  }

  // Сверить токен на сервере. Успех → запомнить комнату как открытую.
  function unlock(roomId, token) {
    return fetch('/api/r/' + roomId + '/unlock', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: token })
    }).then(function (r) {
      if (r.ok) { remember(roomId); return { ok: true }; }
      return r.json().catch(function () { return {}; }).then(function (e) {
        return { ok: false, status: r.status, retryAfter: e.retryAfter };
      });
    }, function () { return { ok: false, status: 0 }; });
  }

  function send(url, opts) {
    opts = opts || {};
    var headers = {};
    var src = opts.headers || {};
    Object.keys(src).forEach(function (k) { headers[k] = src[k]; });
    if (opts.body && !headers['Content-Type']) headers['Content-Type'] = 'application/json';
    return fetch(url, { method: opts.method || (opts.body ? 'POST' : 'GET'), headers: headers, body: opts.body });
  }

  window.Room = {
    id: id,
    api: id ? '/api/r/' + id : null,
    url: id ? '/r/' + id : null,
    isValidId: function (x) { return ID_RE.test(String(x || '').trim().toLowerCase()); },
    unlocked: unlocked,
    isUnlocked: isUnlocked,
    remember: remember,
    unlock: unlock,
    send: send
  };
})();
