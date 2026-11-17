/** Версия из package.json — подставляет Vite (define в vite.config.ts). */
declare const __APP_VERSION__: string;
/** Ретранслятор по умолчанию (relayUrl из package.json или DOSKA_RELAY_URL при сборке); пусто — не задан. */
declare const __DEFAULT_RELAY_URL__: string;
/** Адрес облачного сервера (apiUrl из package.json или DOSKA_API_URL при сборке); пусто — облако выключено. */
declare const __DEFAULT_API_URL__: string;
/** Dev-сервер со встроенным сервером Abax (`npm run dev:cloud`): API на том же адресе, что и страница. */
declare const __API_SAME_ORIGIN__: boolean;
