# Зависимостей у сервера нет — образ это просто node и код мира.
FROM node:22-alpine

WORKDIR /app
COPY . .

# Комнаты пишутся в /app/data — том монтируется снаружи, владелец должен
# совпадать с пользователем контейнера (uid 1000), иначе запись не пройдёт.
RUN mkdir -p data && chown -R node:node /app
USER node

ENV PORT=8100
EXPOSE 8100

HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD wget -qO- http://127.0.0.1:8100/ >/dev/null || exit 1

CMD ["node", "server.js"]
