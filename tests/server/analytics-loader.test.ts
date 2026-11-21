import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { describe, expect, it, vi } from 'vitest';

const code = readFileSync('public/metrika.js', 'utf8');

describe('загрузка Метрики', () => {
  it('не загружает счётчик до согласия и запускает его после разрешения', () => {
    let choice: string | null = null;
    const listeners: Record<string, () => void> = {};
    const insertBefore = vi.fn();
    const first = { parentNode: { insertBefore } };
    const doc = { scripts: [first], createElement: () => ({}), getElementsByTagName: () => [first], referrer: '' };
    const win = { addEventListener: (name: string, cb: () => void) => { listeners[name] = cb; } };
    const location = { protocol: 'https:', href: 'https://example.com/', reload: vi.fn() };
    runInNewContext(code, { window: win, document: doc, location, localStorage: { getItem: () => choice }, Date });
    expect(insertBefore).not.toHaveBeenCalled();
    choice = 'accepted';
    listeners['abax:analytics-accepted']();
    expect(insertBefore).toHaveBeenCalledOnce();
    listeners['abax:analytics-accepted']();
    expect(insertBefore).toHaveBeenCalledOnce();
  });
});
