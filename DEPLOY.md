# Деплой — Бумажный мир

Мир — один контейнер: сервер на голом Node, порт 8100 внутри докер-сети,
наружу не торчит. HTTPS, домен и сертификат — на обратном прокси (Traefik),
том же, что обслуживает аквариум. Общего рантайма с аквариумом нет: свой
контейнер, свой том `data/`, свой поддомен.

Схема повторяет аквариум (см. `../DEPLOY.md`), но проще: **пак моделей не нужен**
(мир не использует 3D-модели рыб), поэтому шаг с `pack/` отсутствует.

## Что понадобится

- Тот же сервер с докером, что и у аквариума.
- **Traefik** с внешней docker-сетью `web` и резолвером `letsencrypt`
  (уже есть — на нём работает аквариум). Проверить: `docker network ls | grep web`.
- **A-запись** `world.fantasy-games.ru` на адрес сервера.

## Один раз

**1. Код**

Мир живёт в подпапке `world/` того же репозитория. Разворачиваем её как
отдельное приложение:

```bash
# если мир вынесен в свой репозиторий:
git clone <repo-world> /opt/docker/apps/paper-world
cd /opt/docker/apps/paper-world

# если мир пока в подпапке репозитория аквариума:
cd /opt/docker/apps/paper-aquarium/world
```

**2. Настройки**

```bash
cp .env.example .env
nano .env            # DOMAIN=world.fantasy-games.ru
```

**3. Папка данных**

Контейнер работает не под root — владельца проставить заранее:

```bash
mkdir -p data
chown -R 1000:1000 data
```

**4. Запуск**

```bash
docker compose -f docker-compose.prod.yml --env-file .env up -d --build
docker compose -f docker-compose.prod.yml logs -f world
```

В логе должно появиться «Бумажный мир: http://localhost:8100/». Через
полминуты `https://world.fantasy-games.ru` открывается с сертификатом.

## Каждый раз

```bash
cd /opt/docker/apps/paper-world     # или .../paper-aquarium/world

git fetch --all --prune
git pull --ff-only

docker compose -f docker-compose.prod.yml --env-file .env up -d --build

docker compose -f docker-compose.prod.yml ps
docker compose -f docker-compose.prod.yml logs -f --tail 200

# остановить (данные на месте)
docker compose -f docker-compose.prod.yml stop
```

Пересборка образа данные не трогает: комнаты лежат в `./data`, монтируется
снаружи. Именованных томов нет — `down -v` тут ничего не стирает, но
привычки ради лучше `stop`.

## Комнаты и QR-ключи

Комнаты фиксированы контентом (`assets/world/rooms.json`). Открываются по
QR-ссылке `https://world.fantasy-games.ru/r/<id>?k=<token>`, где `<token>` —
секрет из журнала. На сервере хранится только `scrypt`-хеш токена.

Встроенные демо-комнаты и их ключи:

| Комната | QR-ссылка |
|---------|-----------|
| bedroom | `https://world.fantasy-games.ru/r/bedroom?k=bedroom-key` |
| kitchen | `https://world.fantasy-games.ru/r/kitchen?k=kitchen-key` |

Сменить токен: `node tools/gen-unlock.js <roomId> <новый-токен>` → вставить
`salt`/`unlockHash` в `rooms.json` (или пересобрать через `build-from-slices.js`).

## Бэкап

Единственное, что нельзя потерять, — `data/`: расстановка комнат и снимки сцен.
Всё остальное восстанавливается из репозитория.

```bash
# раз в сутки, храним две недели
0 4 * * * root tar czf /var/backups/world-$(date +\%F).tgz \
          -C /opt/docker/apps/paper-world data && \
          find /var/backups -name 'world-*.tgz' -mtime +14 -delete
```

## Пределы (в .env)

- `WORLD_MAX_DOLLS` (30) — кукол в комнате
- `WORLD_MAX_DECOR` (40) — предметов декора
- `WORLD_MAX_DATA_MB` (1024) — вся папка data

## Если что-то не так

| Симптом | Куда смотреть |
|---|---|
| 404 от прокси | `docker compose ... ps`; контейнер в сети `web`: `docker inspect paper-world --format '{{json .NetworkSettings.Networks}}'` |
| Сертификат не выписался | логи Traefik; чаще A-запись не доехала или 80 закрыт |
| Комната «не найдена» | `curl -s localhost:8100/api/rooms/catalog` внутри контейнера |
| Комната не открывается по QR | токен не совпадает с хешем в `rooms.json` |
| Не сохраняется расстановка | владелец `data/`: `ls -ln data` — должен быть 1000:1000 |
| Кончилось место | `du -sh data`, потом `WORLD_MAX_DATA_MB` |
