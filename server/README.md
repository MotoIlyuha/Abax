# Сервер Abax

Облачный бэкенд: учётные записи, проекты и картинки в облаке, ссылки-приглашения и **облачные комнаты** совместной работы.
Node 22 + TypeScript + SQLite (`better-sqlite3`, режим WAL), HTTP на `node:http`, WebSocket на `ws`. Модули клиента из
`src/` (`file`, `delta`, `limits`, `task-element`, `room-host`, `asset-store`, `project-access`, `board-url`) сервер
использует напрямую — правила проверки и маскировки заданий у клиента и сервера общие.

```
браузер/приложение ──HTTP /api/…──┐
                   ──WS /ws/room/…─┤ server (Node) ── SQLite (.data/abax.db)
                                    └── картинки: .data/assets/ или S3-совместимое хранилище
```

## Запуск

```bash
npm run server          # собирает dist-server/ и запускает; порт 8787, данные — .data/
npm run dev:cloud       # dev-сервер Vite со встроенным сервером Abax: клиент и API на http://localhost:5173
npm run server:plan -- <userId | tg:<id>> pro 30    # выдать тариф на 30 дней (платежей пока нет)
```

Настройки — переменные окружения, образец — [`.env.example`](.env.example). В продакшене обязателен `JWT_SECRET`
(`openssl rand -hex 32`); в разработке секрет создаётся в `.data/jwt-secret`. За прокси (nginx, Caddy) включите `TRUST_PROXY=1`
и TLS на прокси: cookie сессии помечается `Secure` при `NODE_ENV=production`, WebSocket идёт по `wss://`.

Клиент подключается к серверу, если задан адрес: `apiUrl` в `package.json`, переменная `DOSKA_API_URL` при сборке
или (для проверки вручную) `localStorage['doska.apiUrl']`. Пустой адрес — облако выключено, всё работает на устройстве.
Адрес сервера автоматически добавляется в CSP (`connect-src`) при сборке.

## Что умеет

| Область | Маршруты |
| --- | --- |
| Вход | `POST /api/auth/anon` (токен устройства), `POST /api/auth/telegram` (Telegram Login Widget, подпись HMAC), `POST /api/auth/logout`, `GET /api/me` |
| Проекты | `GET /api/projects`, `GET/PUT/DELETE /api/projects/:id`, `POST /api/projects/:id/patch`, `POST /api/projects/:id/clone` |
| Картинки | `POST /api/assets` (`{dataUrl}`), `GET /api/assets/:hash` (по хэшу SHA-256 от строки data URL) |
| Приглашения | `POST /api/invites`, `GET /api/invites?projectId=`, `DELETE /api/invites/:token`, `GET /api/invites/:token` и `GET /j/:token` (JSON) |
| Комнаты | WebSocket `/ws/room/:проект`, первое сообщение `{t:'hello', proto, name, invite \| session}` |

Сессия — JWT HS256 на 30 дней (`Authorization: Bearer …` или cookie `abax_session`). Гостю по приглашению учётная запись не нужна.

## Безопасность

- **Ответы заданий** (`TaskEl.answer`) и закрытые решения не уходят никому, кроме владельца проекта: ни в REST (`projectTaskForRole`),
  ни в клон, ни в сообщения комнаты. Ответ ученика проверяет сервер.
- Всё, что приходит на сервер и пишется в базу, проходит `parseProject` / `sanitizeElement`; `data:image/…` из проектов и патчей
  выносится в хранилище, адреса картинок из интернета и чужие схемы стираются.
- Картинки отдаются с `nosniff` и `Content-Security-Policy: default-src 'none'; sandbox`; SVG — только как скачивание.
- Создание анонимных пользователей ограничено по адресу (30 в час), подключения к комнатам — 120 в минуту.

## Тарифы и лимиты

Лимиты тарифа (3 проекта, 3 страницы в проекте, один гость в комнате) сервер применяет при `ABAX_ENFORCE_LIMITS=1`.
Пока флаг не задан (по умолчанию), ограничений по числу нет, а права, доступные только платным тарифам
(запрет клонирования и копирования), режутся всегда. `GET /api/me` сообщает клиенту тариф и признак `limitsEnforced`.
Платежи (ЮKassa, Telegram Stars) — Фаза 4: тариф выдаётся вручную командой `server:plan`.

Облачная комната: на Pro и Tutor живёт без автора (гость заходит по ссылке, когда автора нет в сети); на free — пока подключён
автор, с одним гостем. Состояние комнаты пишется в базу через 0,5 с после правки, сразу — при ответе ученика, при уходе
последнего участника и при остановке сервера. Журнал ревизий хранит последние 200 записей на проект.

## Хранилище картинок

По умолчанию — файлы `.data/assets/<xx>/<хэш>`. Для S3-совместимого облака (Yandex Object Storage, Timeweb Cloud) задайте
`S3_ENDPOINT`, `S3_BUCKET`, `S3_REGION`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` — запросы подписываются AWS Signature V4
без внешних библиотек.

## Тесты

```bash
npx vitest run --project server    # сервер: tests/server/*.test.ts, база в памяти, настоящие HTTP и WebSocket
npx playwright test night3-cloud   # два изолированных браузерных контекста против настоящего сервера
```

`createAppServer({ dbPath: ':memory:', assetsDir, jwtSecret, … })` — фабрика для тестов и встраивания (см. `server/app.ts`).
