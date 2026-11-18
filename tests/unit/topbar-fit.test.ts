import { describe, expect, it } from 'vitest';
import { fitLevel, fitState, fitWidth, type FitInput } from '../../src/topbar-fit';

// логотип 48, проект 200, отмена/повтор 90, импорт 90, экспорт 48; справа «Поделиться» 120 (иконкой — 48)
const base = (available: number, over: Partial<Record<'export' | 'import' | 'undo', boolean>> = {}): FitInput => ({
  available,
  gap: 12,
  sideGap: 12,
  items: [
    { step: 'export', width: 48, userHidden: over.export },
    { step: 'import', width: 90, userHidden: over.import },
    { step: 'undo', width: 90, userHidden: over.undo },
    { width: 200 },
    { width: 48 },
  ],
  right: 120,
  shareShrink: 72,
});

describe('адаптивная шапка', () => {
  it('ширина: элементы, промежутки и правая сторона', () => {
    expect(fitWidth(base(0), 0)).toBe(48 + 90 + 90 + 200 + 48 + 4 * 12 + 12 + 120);
    expect(fitWidth(base(0), 1)).toBe(90 + 90 + 200 + 48 + 3 * 12 + 12 + 120);
    expect(fitWidth(base(0), 4)).toBe(200 + 48 + 12 + 12 + 48);
  });

  it('по очереди: экспорт, импорт, отмена/повтор, «Поделиться» иконкой', () => {
    const full = fitWidth(base(0), 0);
    expect(fitLevel(base(full))).toBe(0);
    expect(fitLevel(base(full - 1))).toBe(1);
    expect(fitLevel(base(fitWidth(base(0), 1) - 1))).toBe(2);
    expect(fitLevel(base(fitWidth(base(0), 2) - 1))).toBe(3);
    expect(fitLevel(base(fitWidth(base(0), 3) - 1))).toBe(4);
    expect(fitLevel(base(100))).toBe(4);
  });

  it('скрытое пользователем места не занимает: импорт остаётся, если спрятан экспорт', () => {
    const width = fitWidth(base(0), 1); // ровно без экспорта
    expect(fitLevel(base(width, { export: true }))).toBe(0);
    expect(fitState(base(width, { export: true })).noRoom.has('import')).toBe(false);
  });

  it('пункт «Скрыть» недоступен, если элементу не хватит места', () => {
    const noExport = fitWidth(base(0), 1);
    const s = fitState(base(noExport));
    expect(s.level).toBe(1);
    expect([...s.noRoom]).toEqual(['export']);
    // экспорт скрыт пользователем, но показать его всё равно некуда
    expect([...fitState(base(noExport, { export: true })).noRoom]).toEqual(['export']);
    expect([...fitState(base(fitWidth(base(0), 2))).noRoom].sort()).toEqual(['export', 'import']);
    expect(fitState(base(10_000)).noRoom.size).toBe(0);
  });

  it('элемента нет (гость, просмотр по ссылке) — пункт не блокируется', () => {
    const input = base(300);
    input.items = input.items.map(i => i.step === 'import' ? { ...i, width: 0 } : i);
    expect(fitState(input).noRoom.has('import')).toBe(false);
  });
});
