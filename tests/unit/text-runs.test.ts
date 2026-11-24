import { describe, expect, it } from 'vitest';
import { clearRunField, normalizeRuns, remapRuns, sanitizeRuns, styledSegments } from '../../src/text-runs';
import { parseClipboardHtml } from '../../src/paste-text';
import { sanitizeElement } from '../../src/file';

describe('фрагменты текста', () => {
  it('normalizeRuns склеивает одинаковые, обрезает по длине и убирает пустой хвост', () => {
    expect(normalizeRuns([{ n: 2, bold: true }, { n: 3, bold: true }, { n: 4 }], 8)).toEqual([{ n: 5, bold: true }]);
    expect(normalizeRuns([{ n: 10, bold: true }], 4)).toEqual([{ n: 4, bold: true }]);
    expect(normalizeRuns([{ n: 3 }], 3)).toBeUndefined();
  });

  it('remapRuns: вставка наследует стиль соседнего символа, удаление сдвигает фрагменты', () => {
    const runs = [{ n: 3 }, { n: 3, bold: true }];
    expect(remapRuns(runs, 'abcdef', 'abcdXef')).toEqual([{ n: 3 }, { n: 4, bold: true }]);
    expect(remapRuns(runs, 'abcdef', 'bcdef')).toEqual([{ n: 2 }, { n: 3, bold: true }]);
    expect(remapRuns(runs, 'abcdef', 'abc')).toBeUndefined();
  });

  it('styledSegments: отрезки наследуют стиль блока', () => {
    const segs = styledSegments({ bold: false, italic: true, color: '#111111', runs: [{ n: 2, bold: true, color: '#ff0000' }] }, 0, 5);
    expect(segs).toEqual([
      { from: 0, to: 2, style: { bold: true, italic: true, underline: false, strike: false, color: '#ff0000' } },
      { from: 2, to: 5, style: { bold: false, italic: true, underline: false, strike: false, color: '#111111' } },
    ]);
  });

  it('clearRunField снимает поле у всех фрагментов', () => {
    expect(clearRunField([{ n: 2, bold: true }, { n: 2, italic: true }], 'bold', 4)).toEqual([{ n: 2 }, { n: 2, italic: true }]);
  });

  it('sanitizeRuns и sanitizeElement отбрасывают мусор', () => {
    expect(sanitizeRuns([{ n: 2, bold: 'да' }, { n: 'x' }, { n: 2, color: '#fff' }], 4)).toEqual([{ n: 2 }, { n: 2, color: '#fff' }]);
    const el = sanitizeElement({ id: 'a', type: 'text', x: 0, y: 0, text: 'abcd', size: 20, color: '#000', runs: [{ n: 2, bold: true }, { n: 99 }] });
    expect(el && 'runs' in el ? el.runs : null).toEqual([{ n: 2, bold: true }]);
  });
});

describe('вставка HTML', () => {
  it('жирный фрагмент внутри обычного текста становится отдельным фрагментом', () => {
    const p = parseClipboardHtml('<p>Это <b>важно</b> знать</p>')!;
    expect(p.text).toBe('Это важно знать');
    expect(p.bold).toBe(false);
    expect(p.runs).toEqual([{ n: 4 }, { n: 5, bold: true }]);
  });

  it('цвет фрагмента сохраняется, абзацы и списки разбираются', () => {
    const p = parseClipboardHtml('<p style="color:#000000">один</p><ul><li>два <span style="color:rgb(255,0,0)">кр</span></li></ul>')!;
    expect(p.text).toBe('один\n• два кр');
    expect(p.color).toBe('#000000');
    expect(p.runs?.some(r => r.color === '#ff0000')).toBe(true);
  });
});
