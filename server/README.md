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
| Вход | `POST /api/auth/anon` (токен устройства), `POST /api/auth/telegram` (Telegram Login, подпись HMAC), `POST /api/auth/logout`, `GET /api/me`, `PATCH /api/me` (имя и курсор) |
| Способы входа (Ночь №4) | `GET /api/auth/providers`; почта — `POST /api/auth/email/start` и `/verify` (6-значный код, 10 минут, 5 попыток); Telegram и Google — `POST /api/auth/flow` → переход на сайт провайдера → возврат `#abaxAuth=` → `POST /api/auth/flow/complete` (оба провайдера — OpenID Connect, Authorization Code + PKCE); режимы `login` (вход, слияние анонима) и `link` (привязка к текущему аккаунту, `409 identity-taken`, если способ у другого). Dev-провайдеры — `ABAX_DEV_AUTH=1` (в `npm run dev:cloud` включены, если нет ключей) |
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

## Вход через Google

Используется OpenID Connect (Authorization Code + PKCE S256 + `nonce`) по документации Google
([OpenID Connect](https://developers.google.com/identity/openid-connect/openid-connect),
[OAuth 2.0 для веб-серверов](https://developers.google.com/identity/protocols/oauth2/web-server)); браузер уходит на
`accounts.google.com`, код меняется на токены сервером (`oauth2.googleapis.com/token`, с `client_secret`), в `id_token`
проверяются `iss`, `aud`, `exp`, `nonce`; пользователь определяется по `sub` (не по почте — так советует Google).

1. [Google Cloud Console → Branding](https://console.developers.google.com/auth/branding): название приложения, почта поддержки
   (экран согласия). Пока приложение в режиме тестирования, войти могут только тестовые пользователи (Audience → Test users).
   Области `openid email profile` — несенситивные, проверка Google для них не нужна.
2. [Clients → Create client](https://console.developers.google.com/auth/clients), тип **Web application**.
   **Authorized redirect URIs** — точный адрес (схема, хост, порт, путь):
   - разработка: `http://localhost:5173/api/auth/google/callback` (открывайте приложение именно по `localhost`, не `127.0.0.1`);
   - прод: `https://<домен API>/api/auth/google/callback` (только https и доменное имя, не IP).
   Секрет показывается один раз — сохраните его.
3. Разработка: в корне репозитория файл `.env.local` (в git не попадает):
   ```
   GOOGLE_CLIENT_ID=….apps.googleusercontent.com
   GOOGLE_CLIENT_SECRET=…
   ```
   и `npm run dev:cloud` — кнопка «Google» ведёт на настоящий Google (Telegram и почта остаются dev-заглушками, если их ключей нет).
4. Прод: `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `PUBLIC_API_URL=https://<домен API>` (из него строится redirect URI),
   `PUBLIC_WEB_URL` (или `ALLOWED_ORIGINS`) — адрес веб-клиента, куда возвращать после входа.

Ошибка `redirect_uri_mismatch` на странице Google — адрес в консоли не совпадает символ в символ с
`<PUBLIC_API_URL или адрес, по которому открыт сервер>/api/auth/google/callback`.

## Вход через Telegram

OpenID Connect по документации Telegram ([Log In With Telegram](https://core.telegram.org/widgets/login),
discovery — `https://oauth.telegram.org/.well-known/openid-configuration`), без скрипта виджета (строгий CSP):
браузер уходит на `https://oauth.telegram.org/auth` (`scope=openid profile`, `state`, PKCE S256), код меняется на токены
сервером (`https://oauth.telegram.org/token`, `Authorization: Basic base64(client_id:client_secret)`, `code_verifier`).
Подпись `id_token` проверяется обязательно — по ключам `https://oauth.telegram.org/.well-known/jwks.json` (RS256 по
умолчанию; ES256 и EdDSA тоже поддержаны), затем `iss = https://oauth.telegram.org`, `aud` = ID бота, `exp`.
Аккаунт — по числовому `id` пользователя Telegram (claim `id`), поэтому прежние входы через виджет узнаются.

1. В @BotFather откройте мини-приложение, выберите бота → **Login Widget** → добавьте **Allowed URLs**: адрес веб-клиента
   (`https://<домен>`) и redirect URI `https://<домен API>/api/auth/telegram/callback` (точно этот путь).
   Там же — **Client ID** (ID бота) и **Client Secret**. Алгоритм подписи по умолчанию (RS256) менять не нужно; EdDSA и
   ES256K запрещают scope `profile`, без него не будет имени и `id` — вход не пройдёт.
2. Переменные: `TELEGRAM_CLIENT_SECRET` (обязательно), `TELEGRAM_CLIENT_ID` (если не задан — берётся из `TELEGRAM_BOT_TOKEN`,
   часть до «:»), `PUBLIC_API_URL` (из него строится redirect URI), `PUBLIC_WEB_URL` / `ALLOWED_ORIGINS`.
3. Разработка: Telegram не принимает `http://localhost` в Allowed URLs («Domain is invalid») — нужен https-домен.
   Покупать его не обязательно: бесплатный туннель, например ngrok со статическим доменом бесплатного тарифа
   (`ngrok http 5173 --url=<имя>.ngrok-free.app`). В `.env.local`:
   ```
   PUBLIC_API_URL=https://<имя>.ngrok-free.app
   TELEGRAM_CLIENT_SECRET=…
   ```
   `npm run dev:cloud` сам разрешит этот хост в Vite и использует его как адрес облака и адрес возврата;
   в @BotFather → Login Widget → Allowed URLs — `https://<имя>.ngrok-free.app` и
   `https://<имя>.ngrok-free.app/api/auth/telegram/callback`. Открывайте приложение по адресу туннеля.

Старый `POST /api/auth/telegram` (данные Login Widget с подписью HMAC от `TELEGRAM_BOT_TOKEN`) оставлен для совместимости.

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
