// Три языка для «Бумажного мира»: русский, английский, польский.
//
// Компактный форк i18n аквариума: тот же API, но только строки мира.
// Язык — из выбора человека (localStorage), иначе из настроек устройства.
//
//   I18N.t('home.title')            — строка
//   I18N.t('room.doll', {n: 3})     — с подстановкой
//   I18N.apply(root)                — разложить переводы по data-t
//   I18N.set('pl')                  — переключить и запомнить
//   I18N.mount(el)                  — переключатель RU EN PL
(function () {
  'use strict';

  var KEY = 'world.lang';
  var LANGS = ['ru', 'en', 'pl'];

  var DICT = {
    ru: {
      'lang.name': 'Русский',
      'home.title': 'Бумажный мир',
      'home.lead': 'Открой комнату своего журнала по QR-коду — и наполни её персонажами и декором.',
      'home.locked': 'Закрыта — нужен QR из журнала',
      'home.open': 'Открыть',
      'home.locked.title': 'Комната закрыта',
      'home.locked.text': 'Чтобы открыть эту комнату, отсканируй QR-код из соответствующего журнала.',
      'home.noserver': 'Сервер недоступен. Запусти node server.js и обнови страницу.',
      'unlock.ok.title': 'Комната открыта',
      'unlock.bad.title': 'QR не подошёл',
      'unlock.bad.text': 'Код из журнала недействителен или не соответствует этой комнате.',
      'unlock.many.title': 'Слишком много попыток',
      'unlock.many.text': 'Подожди {n} с и попробуй снова.',
      'room.loading': 'Открываю комнату…',
      'room.notfound': 'Комната не найдена — возможно, неверная ссылка.',
      'room.tolist': 'К списку комнат →',
      'room.locked': 'Комната закрыта. Отсканируй QR-код из журнала.',
      'room.menu.hint': 'нажми в любом месте — покажу меню',
      'menu.close': 'Закрыть меню',
      'menu.back': '← назад',
      'menu.catalog.title': 'Каталог',
      'menu.catalog.sub': 'персонажи и декор из набора комнаты',
      'menu.photo.title': 'Собрать по фото',
      'menu.photo.sub': 'сфотографируй бумажную куклу',
      'menu.home.title': 'Мои комнаты',
      'menu.home.sub': 'вернуться к списку',
      'cat.tab.chars': 'Персонажи',
      'cat.tab.decor': 'Декор',
      'cat.pick.base': 'Выбери персонажа',
      'cat.pick.garments': 'Выбери наряд',
      'cat.add': 'Поставить в комнату',
      'cat.empty': 'Набор пуст',
      'photo.title': 'Собрать по фото',
      'photo.shoot': 'Сфотографировать куклу',
      'photo.hint': 'Положи куклу на светлый стол, всю целиком в кадре',
      'photo.searching': 'Узнаю куклу…',
      'photo.base.bad.title': 'Не узнал персонажа',
      'photo.base.bad.text': 'Переснимите куклу целиком при хорошем свете — или выберите персонажа вручную из каталога.',
      'photo.retake': 'Переснять',
      'photo.manual': 'Выбрать вручную',
      'photo.add': 'Поставить в комнату',
      'photo.err.photo': 'Не удалось открыть фото, попробуй ещё раз.',
      'modal.cancel': 'Отмена',
      'modal.ok': 'Понятно',
      'modal.save': 'Сохранить',
      'modal.delete': 'Удалить',
      'modal.copyHint': 'Нажми, чтобы скопировать',
      'modal.copied': 'скопировано'
    },
    en: {
      'lang.name': 'English',
      'home.title': 'Paper World',
      'home.lead': 'Open your magazine’s room with a QR code — then fill it with characters and decor.',
      'home.locked': 'Locked — needs a QR from the magazine',
      'home.open': 'Open',
      'home.locked.title': 'Room is locked',
      'home.locked.text': 'To open this room, scan the QR code from the matching magazine.',
      'home.noserver': 'The server is unreachable. Run node server.js and refresh.',
      'unlock.ok.title': 'Room unlocked',
      'unlock.bad.title': 'The QR did not fit',
      'unlock.bad.text': 'The code from the magazine is invalid or does not match this room.',
      'unlock.many.title': 'Too many attempts',
      'unlock.many.text': 'Wait {n} s and try again.',
      'room.loading': 'Opening the room…',
      'room.notfound': 'Room not found — the link may be wrong.',
      'room.tolist': 'To the room list →',
      'room.locked': 'The room is locked. Scan the QR code from the magazine.',
      'room.menu.hint': 'tap anywhere — the menu will show up',
      'menu.close': 'Close the menu',
      'menu.back': '← back',
      'menu.catalog.title': 'Catalog',
      'menu.catalog.sub': 'characters and decor from the room set',
      'menu.photo.title': 'Assemble from a photo',
      'menu.photo.sub': 'photograph a paper doll',
      'menu.home.title': 'My rooms',
      'menu.home.sub': 'back to the list',
      'cat.tab.chars': 'Characters',
      'cat.tab.decor': 'Decor',
      'cat.pick.base': 'Pick a character',
      'cat.pick.garments': 'Pick an outfit',
      'cat.add': 'Place in the room',
      'cat.empty': 'The set is empty',
      'photo.title': 'Assemble from a photo',
      'photo.shoot': 'Photograph the doll',
      'photo.hint': 'Put the doll on a light table, the whole of it in frame',
      'photo.searching': 'Recognizing the doll…',
      'photo.base.bad.title': 'Could not recognize the character',
      'photo.base.bad.text': 'Retake the whole doll in good light — or pick a character manually from the catalog.',
      'photo.retake': 'Retake',
      'photo.manual': 'Pick manually',
      'photo.add': 'Place in the room',
      'photo.err.photo': 'Could not open the photo, try again.',
      'modal.cancel': 'Cancel',
      'modal.ok': 'Got it',
      'modal.save': 'Save',
      'modal.delete': 'Delete',
      'modal.copyHint': 'Click to copy',
      'modal.copied': 'copied'
    },
    pl: {
      'lang.name': 'Polski',
      'home.title': 'Papierowy świat',
      'home.lead': 'Otwórz pokój swojego magazynu kodem QR — i wypełnij go postaciami i dekoracjami.',
      'home.locked': 'Zamknięty — potrzebny kod QR z magazynu',
      'home.open': 'Otwórz',
      'home.locked.title': 'Pokój jest zamknięty',
      'home.locked.text': 'Aby otworzyć ten pokój, zeskanuj kod QR z odpowiedniego magazynu.',
      'home.noserver': 'Serwer niedostępny. Uruchom node server.js i odśwież stronę.',
      'unlock.ok.title': 'Pokój otwarty',
      'unlock.bad.title': 'Kod QR nie pasuje',
      'unlock.bad.text': 'Kod z magazynu jest nieprawidłowy lub nie pasuje do tego pokoju.',
      'unlock.many.title': 'Zbyt wiele prób',
      'unlock.many.text': 'Poczekaj {n} s i spróbuj ponownie.',
      'room.loading': 'Otwieram pokój…',
      'room.notfound': 'Nie znaleziono pokoju — link może być błędny.',
      'room.tolist': 'Do listy pokoi →',
      'room.locked': 'Pokój jest zamknięty. Zeskanuj kod QR z magazynu.',
      'room.menu.hint': 'dotknij w dowolnym miejscu — pokażę menu',
      'menu.close': 'Zamknij menu',
      'menu.back': '← wstecz',
      'menu.catalog.title': 'Katalog',
      'menu.catalog.sub': 'postacie i dekoracje z zestawu pokoju',
      'menu.photo.title': 'Złóż ze zdjęcia',
      'menu.photo.sub': 'sfotografuj papierową lalkę',
      'menu.home.title': 'Moje pokoje',
      'menu.home.sub': 'powrót do listy',
      'cat.tab.chars': 'Postacie',
      'cat.tab.decor': 'Dekoracje',
      'cat.pick.base': 'Wybierz postać',
      'cat.pick.garments': 'Wybierz strój',
      'cat.add': 'Umieść w pokoju',
      'cat.empty': 'Zestaw jest pusty',
      'photo.title': 'Złóż ze zdjęcia',
      'photo.shoot': 'Sfotografuj lalkę',
      'photo.hint': 'Połóż lalkę na jasnym stole, całą w kadrze',
      'photo.searching': 'Rozpoznaję lalkę…',
      'photo.base.bad.title': 'Nie rozpoznano postaci',
      'photo.base.bad.text': 'Zrób zdjęcie całej lalki przy dobrym świetle — lub wybierz postać ręcznie z katalogu.',
      'photo.retake': 'Powtórz',
      'photo.manual': 'Wybierz ręcznie',
      'photo.add': 'Umieść w pokoju',
      'photo.err.photo': 'Nie udało się otworzyć zdjęcia, spróbuj ponownie.',
      'modal.cancel': 'Anuluj',
      'modal.ok': 'OK',
      'modal.save': 'Zapisz',
      'modal.delete': 'Usuń',
      'modal.copyHint': 'Kliknij, aby skopiować',
      'modal.copied': 'skopiowano'
    }
  };

  function pick() {
    var saved;
    try { saved = localStorage.getItem(KEY); } catch (e) { saved = null; }
    if (saved && LANGS.indexOf(saved) !== -1) return saved;
    var codes = (navigator.languages || [navigator.language || 'en'])
      .map(function (c) { return String(c).slice(0, 2).toLowerCase(); });
    for (var i = 0; i < codes.length; i++) {
      if (LANGS.indexOf(codes[i]) !== -1) return codes[i];
      if (codes[i] === 'be' || codes[i] === 'uk' || codes[i] === 'kk') return 'ru';
    }
    return 'en';
  }

  var lang = pick();

  function t(key, vars) {
    var s = (DICT[lang] && DICT[lang][key]) || (DICT.ru[key]) || key;
    if (vars) {
      s = s.replace(/\{(\w+)\}/g, function (m, k) {
        return vars[k] !== undefined ? vars[k] : m;
      });
    }
    return s;
  }

  function apply(root) {
    root = root || document;
    root.querySelectorAll('[data-t]').forEach(function (el) {
      el.textContent = t(el.getAttribute('data-t'));
    });
    root.querySelectorAll('[data-t-ph]').forEach(function (el) {
      el.setAttribute('placeholder', t(el.getAttribute('data-t-ph')));
    });
    root.querySelectorAll('[data-t-title]').forEach(function (el) {
      el.setAttribute('title', t(el.getAttribute('data-t-title')));
    });
    root.querySelectorAll('[data-t-alt]').forEach(function (el) {
      el.setAttribute('alt', t(el.getAttribute('data-t-alt')));
    });
  }

  function set(next) {
    if (LANGS.indexOf(next) === -1) return;
    lang = next;
    try { localStorage.setItem(KEY, next); } catch (e) { /* приватный режим */ }
    apply(document);
    dispatchEvent(new Event('world:lang'));
  }

  function mount(el) {
    if (!el) return;
    el.className = 'langpick';
    el.textContent = '';
    LANGS.forEach(function (code) {
      var b = document.createElement('button');
      b.type = 'button';
      b.textContent = code.toUpperCase();
      b.setAttribute('aria-pressed', code === lang ? 'true' : 'false');
      b.onclick = function () {
        set(code);
        el.querySelectorAll('button').forEach(function (x) {
          x.setAttribute('aria-pressed', x.textContent.toLowerCase() === lang ? 'true' : 'false');
        });
      };
      el.appendChild(b);
    });
  }

  window.I18N = {
    get lang() { return lang; },
    t: t, apply: apply, set: set, mount: mount
  };

  document.addEventListener('DOMContentLoaded', function () { apply(document); });
})();
