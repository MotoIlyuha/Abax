import { expect, it, vi } from 'vitest';
import { launchesTutor, mountTelegram, telegramData } from '../../src/tutor-launch';
it('выбирает кабинет по адресу и окружению, сохраняет переход на доску и приглашение', () => {
  for (const url of [
    'https://a.test/tutor',
    'https://a.test/?route=tutor',
    'https://tutor.a.test/',
    'https://a.test/#tgWebAppData=signed',
  ])
    expect(launchesTutor(url)).toBe(true);
  for (const url of [
    'https://a.test/',
    'https://tutor.a.test/?route=board',
    'https://tutor.a.test/j/abc',
    'https://tutor.a.test/?route=collab',
  ])
    expect(launchesTutor(url)).toBe(false);
  expect(telegramData('https://a.test/#tgWebAppData=x%3D1%26y%3D2')).toBe('x=1&y=2');
});

it('применяет цвета Telegram и обновляет их при смене темы', () => {
  const root = document.createElement('div');
  const events: Record<string, () => void> = {};
  const app = {
    colorScheme: 'light',
    themeParams: { bg_color: '#ffffff', text_color: '#123456', button_color: '#abcdef' },
    onEvent: (name: string, fn: () => void) => { events[name] = fn; },
  };
  vi.stubGlobal('Telegram', { WebApp: app });
  try {
    mountTelegram(root, () => {});
    expect(root.style.getPropertyValue('--tu-tg-text-color')).toBe('#123456');
    expect(root.style.getPropertyValue('--tu-tg-button-color')).toBe('#abcdef');
    expect(root.dataset.scheme).toBe('light');
    app.colorScheme = 'dark';
    app.themeParams = { bg_color: '#111111', text_color: '#eeeeee', button_color: 'red' };
    events.themeChanged();
    expect(root.dataset.scheme).toBe('dark');
    expect(root.style.getPropertyValue('--tu-tg-text-color')).toBe('#eeeeee');
    expect(root.style.getPropertyValue('--tu-tg-button-color')).toBe('');
  } finally { vi.unstubAllGlobals(); }
});
