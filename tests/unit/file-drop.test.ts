// Зона «File drop» (src/file-drop.ts): тексты, подсветка, приём файла в трёх режимах анимаций, отказ, сброс.
import { afterEach, describe, expect, it } from 'vitest';
import { createFileDrop, type FileDrop } from '../../src/file-drop';

const frame = () => new Promise(r => requestAnimationFrame(() => r(null)));

function make(): { drop: FileDrop; el: HTMLButtonElement } {
  const drop = createFileDrop({ idleTitle: 'Перетащите файл сюда', idleHint: 'или нажмите, чтобы выбрать файл', overTitle: 'Отпустите, чтобы добавить', label: 'Импорт файла' });
  document.body.append(drop.el);
  return { drop, el: drop.el };
}
const part = (el: HTMLElement, cls: string) => el.querySelector<HTMLElement>(cls)!;
/** Текст строки без уходящей старой копии. */
const line = (el: HTMLElement, cls: string) => [...part(el, cls).children].at(-1)!.textContent;
const file = { name: 'урок-по-физике-восьмой-класс.pdf', size: 2_400_000 };

afterEach(() => {
  document.body.replaceChildren();
  document.body.className = '';
});

describe('File drop', () => {
  it('разметка: кнопка, круг со значком, две строки, имя для скринридера', () => {
    const { el } = make();
    expect(el.tagName).toBe('BUTTON');
    expect(el.type).toBe('button');
    expect(part(el, '.xfer-drop-up svg')).not.toBeNull();
    expect(part(el, '.xfer-drop-arc')).not.toBeNull();
    expect(line(el, '.xfer-drop-title')).toBe('Перетащите файл сюда');
    expect(line(el, '.xfer-drop-hint')).toBe('или нажмите, чтобы выбрать файл');
    expect(el.getAttribute('aria-label')).toBe('Импорт файла. Перетащите файл сюда. или нажмите, чтобы выбрать файл');
  });

  it('файл над зоной: класс и заголовок «Отпустите…»; ушёл — прежний текст', () => {
    const { drop, el } = make();
    drop.setOver(true);
    expect(el.classList.contains('is-over')).toBe(true);
    expect(line(el, '.xfer-drop-title')).toBe('Отпустите, чтобы добавить');
    drop.setOver(false);
    expect(el.classList.contains('is-over')).toBe(false);
    expect(line(el, '.xfer-drop-title')).toBe('Перетащите файл сюда');
  });

  it('«Улучшенные»: приём — чип летит в круг, текст «Принимаю…», кольцо появляется', async () => {
    const { drop, el } = make();
    drop.accept(file, { x: 10, y: 10 });
    expect(line(el, '.xfer-drop-title')).toBe('Принимаю «урок-по-фи…ласс.pdf»');
    expect(line(el, '.xfer-drop-hint')).toBe('2,4 МБ');
    expect(part(el, '.xfer-drop-chip').textContent).toBe('урок-по-фи…ласс.pdf');
    let ring = 0, chip = 0;
    for (let i = 0; i < 20 && !(ring > 0.2 && chip > 0.2); i++) {
      await frame();
      ring = Math.max(ring, parseFloat(part(el, '.xfer-drop-ring').style.opacity) || 0);
      chip = Math.max(chip, parseFloat(part(el, '.xfer-drop-chip').style.opacity) || 0);
    }
    expect(ring).toBeGreaterThan(0.2);
    expect(chip).toBeGreaterThan(0.2);
  });

  it('«Улучшенные»: reset — сразу покой, чип и кольцо убраны', async () => {
    const { drop, el } = make();
    drop.accept(file);
    await frame();
    drop.reset();
    expect(line(el, '.xfer-drop-title')).toBe('Перетащите файл сюда');
    expect(parseFloat(part(el, '.xfer-drop-chip').style.opacity)).toBe(0);
    expect(parseFloat(part(el, '.xfer-drop-ring').style.opacity)).toBe(0);
    expect(parseFloat(part(el, '.xfer-drop-g').style.transform.replace('scale(', ''))).toBe(0);
  });

  it.each(['no-motion', 'no-motion no-ui-anim'])('«%s»: без пружин — сразу «Файл принят», круг зелёный, чипа нет', async cls => {
    document.body.className = cls;
    const { drop, el } = make();
    drop.accept(file, { x: 10, y: 10 });
    expect(line(el, '.xfer-drop-title')).toBe('Файл принят');
    expect(line(el, '.xfer-drop-hint')).toBe('урок-по-фи…ласс.pdf · 2,4 МБ');
    expect([...part(el, '.xfer-drop-title').children]).toHaveLength(1); // старая строка не перекатывается
    await frame();
    await frame();
    expect(parseFloat(part(el, '.xfer-drop-g').style.transform.replace('scale(', ''))).toBe(1);
    expect(parseFloat(part(el, '.xfer-drop-chip').style.opacity)).toBe(0);
    expect(parseFloat(part(el, '.xfer-drop-ok').style.opacity)).toBe(1);
  });

  it('отказ не меняет текст; новый файл во время приёма перезапускает показ', () => {
    const { drop, el } = make();
    drop.reject();
    expect(line(el, '.xfer-drop-title')).toBe('Перетащите файл сюда');
    drop.accept({ name: 'a.png', size: 500 });
    drop.accept({ name: 'b.png', size: 2500 });
    expect(line(el, '.xfer-drop-title')).toBe('Принимаю «b.png»');
    expect(line(el, '.xfer-drop-hint')).toBe('3 КБ');
  });

  it('тексты покоя можно сменить (нет права правки)', () => {
    const { drop, el } = make();
    drop.setIdleText('Перетащите файл проекта', 'или нажмите, чтобы выбрать файл', true);
    expect(line(el, '.xfer-drop-title')).toBe('Перетащите файл проекта');
    expect([...part(el, '.xfer-drop-title').children]).toHaveLength(1);
  });

  it('имя файла с разметкой выводится текстом, а не разметкой', () => {
    const { drop, el } = make();
    drop.accept({ name: '<img src=x onerror=alert(1)>.png', size: 10 });
    expect(el.querySelector('img')).toBeNull();
    expect(part(el, '.xfer-drop-chip').querySelector('img')).toBeNull();
  });
});
