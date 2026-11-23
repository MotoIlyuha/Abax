interface Insets {
  top?: number;
  right?: number;
  bottom?: number;
  left?: number;
}
interface WebApp {
  initData?: string;
  colorScheme?: string;
  themeParams?: Record<string, string>;
  safeAreaInset?: Insets;
  contentSafeAreaInset?: Insets;
  ready?(): void;
  expand?(): void;
  onEvent?(name: string, fn: () => void): void;
  BackButton?: { show(): void; hide(): void; onClick(fn: () => void): void };
}
type BridgeWindow = Window & {
  TelegramWebviewProxy?: { postEvent(type: string, data: string): void };
  TelegramGameProxy_receiveEvent?: (type: string, data: unknown) => void;
  Telegram?: { WebApp?: WebApp; WebView?: { receiveEvent(type: string, data: unknown): void } };
};
function bridge(): BridgeWindow {
  return window as BridgeWindow;
}
export function telegramData(href = location.href): string {
  const u = new URL(href);
  return (
    bridge().Telegram?.WebApp?.initData ||
    new URLSearchParams(u.hash.slice(1)).get('tgWebAppData') ||
    u.searchParams.get('tgWebAppData') ||
    ''
  );
}
export function launchesTutor(href = location.href): boolean {
  const u = new URL(href),
    route = u.searchParams.get('route');
  if (
    (route && route !== 'tutor') ||
    u.searchParams.has('room') ||
    /^\/(j|p)\//.test(u.pathname) ||
    /(^#|&)relay=/.test(u.hash)
  )
    return false;
  return route === 'tutor' || /^tutor\./i.test(u.hostname) || /^\/tutor\/?$/.test(u.pathname) || !!telegramData(href);
}
export function appHref(route: 'tutor' | 'board', project?: string, page?: string): string {
  const u = new URL(location.href);
  u.search = '';
  u.hash = '';
  if (u.protocol !== 'file:') u.pathname = '/';
  u.searchParams.set('route', route);
  if (project) u.searchParams.set('tutorProject', project);
  if (page) u.searchParams.set('tutorPage', page);
  return u.href;
}
export function mountTelegram(root: HTMLElement, back: () => void) {
  const w = bridge(),
    app = w.Telegram?.WebApp;
  const applyInsets = (insets: Insets = {}, prefix: string) => {
    for (const side of ['top', 'right', 'bottom', 'left'] as const) {
      const n = insets?.[side];
      root.style.setProperty('--t-' + prefix + '-' + side, (Number.isFinite(n) ? Math.max(0, n!) : 0) + 'px');
    }
  };
  const theme = (params: Record<string, string> = {}, scheme?: string) => {
    if (scheme === 'dark' || scheme === 'light') root.dataset.scheme = scheme;
    if (/^#[\da-f]{6}$/i.test(params.bg_color ?? '')) {
      const n = Number.parseInt(params.bg_color.slice(1), 16);
      root.dataset.scheme =
        scheme ?? ((n >> 16) * 299 + ((n >> 8) & 255) * 587 + (n & 255) * 114 < 128000 ? 'dark' : 'light');
    }
  };
  if (app) {
    const apply = () => {
      theme(app.themeParams, app.colorScheme);
      applyInsets(app.safeAreaInset, 'safe');
      applyInsets(app.contentSafeAreaInset, 'content');
    };
    apply();
    for (const ev of ['themeChanged', 'safeAreaChanged', 'contentSafeAreaChanged']) app.onEvent?.(ev, apply);
    app.BackButton?.onClick(back);
    app.ready?.();
    app.expand?.();
    return (visible: boolean) => (visible ? app.BackButton?.show() : app.BackButton?.hide());
  }
  if (!telegramData()) return () => {};
  const post = (type: string, data: object = {}) => {
    if (w.TelegramWebviewProxy) w.TelegramWebviewProxy.postEvent(type, JSON.stringify(data));
    else if (window.parent !== window)
      window.parent.postMessage(JSON.stringify({ eventType: type, eventData: data }), 'https://web.telegram.org');
  };
  const receive = (type: string, payload: unknown) => {
    const data =
      payload && typeof payload === 'object' ? (payload as Insets & { theme_params?: Record<string, string> }) : {};
    if (type === 'back_button_pressed') back();
    if (type === 'theme_changed') theme(data.theme_params);
    if (type === 'safe_area_changed') applyInsets(data, 'safe');
    if (type === 'content_safe_area_changed') applyInsets(data, 'content');
  };
  w.TelegramGameProxy_receiveEvent = receive;
  w.Telegram ??= {};
  w.Telegram.WebView = { receiveEvent: receive };
  window.addEventListener('message', (e) => {
    if (e.source !== window.parent || e.origin !== 'https://web.telegram.org') return;
    try {
      const data = typeof e.data === 'string' ? JSON.parse(e.data) : e.data;
      receive(data.eventType, data.eventData);
    } catch {
      /* сообщение другого формата */
    }
  });
  for (const type of [
    'web_app_ready',
    'web_app_expand',
    'web_app_request_theme',
    'web_app_request_safe_area',
    'web_app_request_content_safe_area',
  ])
    post(type);
  return (visible: boolean) => post('web_app_setup_back_button', { is_visible: visible });
}
