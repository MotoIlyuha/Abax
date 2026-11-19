// Компоненты окна «Поделиться» (по мотивам designbookmark.com/motion и Kokonut UI): выпадающий список на пружинах,
// счётчик, сегменты и вкладки, перекатывающаяся надпись, спойлер, своя полоса прокрутки, движение формы приглашения — в трёх режимах анимаций.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createSpringSelect } from '../../src/spring-select';
import { createNumberStepper } from '../../src/number-stepper';
import { createSegmented } from '../../src/segmented';
import { createRoll } from '../../src/roll-text';
import { createSpoiler } from '../../src/spoiler';
import { attachOverlayScroll } from '../../src/overlay-scroll';
import { flyInvite, shakeField } from '../../src/invite-motion';

const frame = () => new Promise(r => requestAnimationFrame(() => r(null)));
const frames = async (n: number) => { for (let i = 0; i < n; i++) await frame(); };
const key = (k: string) => new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true });

afterEach(() => {
  document.body.replaceChildren();
  document.body.className = '';
  vi.useRealTimers();
});

function dialogHost(): HTMLElement {
  const d = document.createElement('div');
  d.setAttribute('role', 'dialog');
  document.body.append(d);
  return d;
}

function select(onChange = (_v: string) => {}) {
  const host = dialogHost();
  const s = createSpringSelect({
    className: 'role', label: 'Роль', value: 'editor', onChange,
    options: [
      { value: 'editor', label: 'Редактор' }, { value: 'commenter', label: 'Комментатор' }, { value: 'reader', label: 'Читатель' },
      { value: '__revoke', label: 'Отозвать', danger: true, action: true },
    ],
  });
  host.append(s.el);
  return { s, host, menu: () => host.querySelector<HTMLElement>('[role="listbox"]') };
}

describe('выпадающий список (Spring dropdown)', () => {
  it('иконки и счётчики пунктов: иконка выбранного на кнопке, setBadge без пересоздания меню, счётчик невыбранного — на кнопке', () => {
    document.body.className = 'no-ui-anim';
    const host = dialogHost();
    const s = createSpringSelect({
      className: 'mode', label: 'Режим', value: 'a', onChange: () => {},
      options: [{ value: 'a', label: 'А', icon: '<svg class="ia"></svg>' }, { value: 'b', label: 'Б', icon: '<svg class="ib"></svg>', badge: '3' }],
    });
    host.append(s.el);
    expect(s.el.textContent).toBe('А3'); // подпись и счётчик невыбранного «Б»
    expect(s.el.querySelector('.roll-icon .ia')).not.toBeNull();
    expect(s.el.querySelector('.ss-badge')!.classList.contains('on')).toBe(true);
    s.el.click();
    const row = host.querySelector<HTMLElement>('[data-value="b"]')!;
    expect(row.querySelector('.ss-opt-icon .ib')).not.toBeNull();
    expect(row.querySelector('.ss-opt-badge')!.textContent).toBe('3');
    s.setBadge('b', '4');
    expect(host.querySelector('[data-value="b"]')).toBe(row);
    expect(row.querySelector('.ss-opt-badge')!.textContent).toBe('4');
    s.setValue('b');
    expect(s.el.querySelector('.ss-badge')!.classList.contains('on')).toBe(false); // счётчик выбранного на кнопке не нужен
    expect(s.el.querySelector('.roll-icon .ib')).not.toBeNull();
    s.setBadge('b', '');
    s.setValue('a');
    expect(s.el.querySelector('.ss-badge')!.classList.contains('on')).toBe(false);
  });

  it('разметка: кнопка listbox с подписью значения; меню — внутри окна, с выбранной строкой', () => {
    document.body.className = 'no-ui-anim';
    const { s, menu } = select();
    expect(s.el.getAttribute('aria-haspopup')).toBe('listbox');
    expect(s.el.getAttribute('aria-expanded')).toBe('false');
    expect(s.el.dataset.value).toBe('editor');
    expect(s.el.textContent).toBe('Редактор');
    s.el.click();
    expect(s.el.getAttribute('aria-expanded')).toBe('true');
    expect(s.el.getAttribute('aria-controls')).toBe(menu()!.id);
    const opts = [...menu()!.querySelectorAll('[role="option"]')];
    expect(opts.map(o => o.getAttribute('aria-selected'))).toEqual(['true', 'false', 'false', 'false']);
    expect(opts[3].classList.contains('danger')).toBe(true);
    expect(opts[3].querySelector('.ss-tick')).toBeNull(); // у действия нет галочки
  });

  it('«Улучшенные»: меню раскрывается пружинами, выбор вкатывает значение и складывает меню', async () => {
    const changes: string[] = [];
    const { s, menu } = select(v => changes.push(v));
    s.el.click();
    expect(menu()!.style.height).toBe('0px');
    expect(menu()!.style.opacity).toBe('0');
    await frames(3);
    expect(Number(menu()!.style.opacity)).toBeGreaterThan(0);
    expect(s.el.querySelector<SVGElement>('.ss-chev')!.style.transform).toMatch(/rotate/);
    menu()!.querySelector<HTMLElement>('[data-value="reader"]')!.click();
    expect(changes).toEqual(['reader']);
    expect(s.value).toBe('reader');
    expect(s.el.dataset.value).toBe('reader');
    // выбор сделан — список уже не открыт, хотя ещё складывается: Esc достаётся окну вокруг
    expect(s.el.getAttribute('aria-expanded')).toBe('false');
    expect(menu()).not.toBeNull();
    const outer = vi.fn();
    s.el.parentElement!.addEventListener('keydown', outer);
    s.el.dispatchEvent(key('Escape'));
    expect(outer).toHaveBeenCalledTimes(1);
    // меню складывается через 0.24 с и уходит из документа
    for (let i = 0; i < 120 && menu(); i++) await frame();
    expect(menu()).toBeNull();
    expect(s.el.getAttribute('aria-expanded')).toBe('false');
  });

  it('клавиатура: стрелка открывает и двигает, Enter выбирает; Esc закрывает только список', async () => {
    document.body.className = 'no-ui-anim';
    const changes: string[] = [];
    const { s, host, menu } = select(v => changes.push(v));
    const outer = vi.fn();
    host.addEventListener('keydown', outer);
    s.el.dispatchEvent(key('ArrowDown'));
    expect(menu()).not.toBeNull();
    s.el.dispatchEvent(key('ArrowDown'));
    expect(s.el.getAttribute('aria-activedescendant')).toBe(menu()!.querySelectorAll('[role="option"]')[1].id);
    s.el.dispatchEvent(key('Enter'));
    expect(changes).toEqual(['commenter']);
    expect(menu()).toBeNull();
    s.el.dispatchEvent(key('ArrowUp'));
    expect(menu()).not.toBeNull();
    outer.mockClear();
    s.el.dispatchEvent(key('Escape'));
    expect(menu()).toBeNull();
    expect(outer).not.toHaveBeenCalled(); // окно не закрывается
  });

  it('действие (danger) сообщается, но выбранным не становится', () => {
    document.body.className = 'no-ui-anim';
    const changes: string[] = [];
    const { s, menu } = select(v => changes.push(v));
    s.el.click();
    menu()!.querySelector<HTMLElement>('[data-value="__revoke"]')!.click();
    expect(changes).toEqual(['__revoke']);
    expect(s.value).toBe('editor');
  });

  it('«Обычные»: меню выплывает и гаснет CSS-анимацией', async () => {
    vi.useFakeTimers();
    document.body.className = 'no-motion';
    const { s, menu } = select();
    s.el.click();
    expect(menu()!.classList.contains('ss-in')).toBe(true);
    expect(menu()!.style.height).toBe('');
    s.el.click();
    expect(menu()!.classList.contains('ss-out')).toBe(true);
    vi.advanceTimersByTime(200);
    expect(menu()).toBeNull();
  });

  it('setValue и setOptions меняют значение без события', () => {
    document.body.className = 'no-ui-anim';
    const changes: string[] = [];
    const { s } = select(v => changes.push(v));
    s.setValue('reader');
    expect(s.el.dataset.value).toBe('reader');
    s.setOptions([{ value: 'a', label: 'А' }], 'a');
    expect(s.el.textContent).toBe('А');
    expect(changes).toEqual([]);
  });
});

describe('счётчик (Number stepper)', () => {
  const make = (onChange = (_v: number) => {}) => {
    const st = createNumberStepper({ values: [1, 2, 3, 0], value: 0, label: 'Максимум гостей', format: v => (v ? String(v) : '∞'), spoken: v => (v ? String(v) : 'без ограничений'), onChange });
    document.body.append(st.el);
    return { st, num: st.el.querySelector<HTMLElement>('[role="spinbutton"]')!, minus: st.el.querySelector<HTMLButtonElement>('.stp-minus')!, plus: st.el.querySelector<HTMLButtonElement>('.stp-plus')! };
  };

  it('кнопки и клавиши идут по списку; на краю кнопка «выключена»', () => {
    document.body.className = 'no-ui-anim';
    const got: number[] = [];
    const { st, num, minus, plus } = make(v => got.push(v));
    expect(num.getAttribute('aria-valuetext')).toBe('без ограничений');
    expect(plus.classList.contains('off')).toBe(true);
    minus.click();
    expect(st.value).toBe(3);
    num.dispatchEvent(key('Home'));
    expect(st.value).toBe(1);
    expect(minus.classList.contains('off')).toBe(true);
    num.dispatchEvent(key('End'));
    expect(got).toEqual([3, 1, 0]);
    expect(num.textContent).toBe('∞');
  });

  it('«Улучшенные»: число перекатывается, на краю кнопка мотает головой', async () => {
    const { num, minus, plus } = make();
    minus.click();
    await frame();
    const spans = num.querySelectorAll('span');
    expect(spans[0].textContent).toBe('3');
    expect(spans[1].textContent).toBe('∞'); // уходящее число
    expect(spans[0].style.transform).toMatch(/translateY/);
    num.dispatchEvent(key('End'));
    await frames(2);
    plus.click(); // упор
    let kicked = false;
    for (let i = 0; i < 10 && !kicked; i++) { await frame(); kicked = /translateX/.test(plus.style.transform); }
    expect(kicked).toBe(true);
  });

  it('«Обычные»: число проявляется CSS, без толчков', () => {
    document.body.className = 'no-motion';
    const { num, minus, plus } = make();
    minus.click();
    expect(num.querySelector('span')!.classList.contains('stp-fade')).toBe(true);
    minus.click(); minus.click(); minus.click();
    expect(minus.style.transform).toBe('');
    expect(plus.style.transform).toBe('');
  });

  it('выключенный счётчик не меняется и не в обходе Tab', () => {
    const got: number[] = [];
    const { st, num, minus } = make(v => got.push(v));
    st.setDisabled(true);
    minus.click();
    num.dispatchEvent(key('Home'));
    expect(got).toEqual([]);
    expect(num.tabIndex).toBe(-1);
  });
});

describe('сегменты (Smooth tab)', () => {
  it('radiogroup: щелчок и стрелки меняют выбор; «Обычные» — CSS-переход, «Выкл» — без него', () => {
    const got: string[] = [];
    const seg = createSegmented({ label: 'Кто зовёт', value: 'owner', options: [{ value: 'owner', label: 'Только я' }, { value: 'editors', label: 'И редакторы' }], onChange: v => got.push(v) });
    document.body.append(seg.el);
    const [a, b] = [...seg.el.querySelectorAll<HTMLButtonElement>('[role="radio"]')];
    expect(seg.el.getAttribute('role')).toBe('radiogroup');
    expect([a.getAttribute('aria-checked'), b.getAttribute('aria-checked')]).toEqual(['true', 'false']);
    document.body.className = 'no-motion';
    b.click();
    expect(seg.value).toBe('editors');
    expect(seg.el.classList.contains('seg-css')).toBe(true);
    document.body.className = 'no-ui-anim';
    b.focus();
    seg.el.dispatchEvent(key('ArrowRight'));
    expect(seg.value).toBe('owner');
    expect(seg.el.classList.contains('seg-css')).toBe(false);
    expect(document.activeElement).toBe(a);
    seg.setValue('editors');
    expect(got).toEqual(['editors', 'owner']); // setValue — без события
    expect(b.tabIndex).toBe(0);
  });
});

describe('вкладки (Smooth tab в режиме tabs)', () => {
  const make = () => {
    const paints: [number, string][] = [];
    const got: string[] = [];
    const t = createSegmented({
      tabs: true, label: 'Разделы', value: 'a', onChange: v => got.push(v), onPaint: (p, how) => paints.push([p, how]),
      options: [{ value: 'a', label: 'А', id: 'ta', controls: 'pa' }, { value: 'b', label: 'Б', id: 'tb', controls: 'pb' }],
    });
    document.body.append(t.el);
    return { t, paints, got, tabs: [...t.el.querySelectorAll<HTMLButtonElement>('[role="tab"]')] };
  };

  it('role="tablist"/"tab", aria-selected и aria-controls; «Выкл» — панели сразу на месте', () => {
    document.body.className = 'no-ui-anim';
    const { t, paints, got, tabs } = make();
    expect(t.el.getAttribute('role')).toBe('tablist');
    expect(tabs.map(b => [b.id, b.getAttribute('aria-controls'), b.getAttribute('aria-selected')])).toEqual([['ta', 'pa', 'true'], ['tb', 'pb', 'false']]);
    tabs[1].click();
    expect(got).toEqual(['b']);
    expect(paints.at(-1)).toEqual([1, 'jump']);
  });

  it('«Улучшенные»: одна пружина ведёт и пилюлю, и панели (onPaint с дробным положением)', async () => {
    const { tabs, paints } = make();
    tabs[1].click();
    for (let i = 0; i < 90 && paints.at(-1)?.[0] !== 1; i++) await frame();
    expect(paints.some(([p, how]) => how === 'spring' && p > 0 && p < 1)).toBe(true);
    expect(paints.at(-1)).toEqual([1, 'jump']); // встал — тот, кто рисует панели, это узнаёт
  });

  it('свайп: drag ставит положение, release выбирает вкладку и доводит пружиной со скоростью пальца', async () => {
    const { t, got, paints } = make();
    t.drag(0.4);
    expect(t.progress).toBe(0.4);
    expect(paints.at(-1)).toEqual([0.4, 'jump']);
    t.release(1, 3);
    expect(got).toEqual(['b']);
    for (let i = 0; i < 90 && t.progress !== 1; i++) await frame();
    expect(t.progress).toBe(1);
  });
});

describe('спойлер', () => {
  const make = () => {
    const content = document.createElement('p');
    content.textContent = 'внутри';
    const toggles: boolean[] = [];
    const d = createSpoiler({ className: 'x', summary: 'Без облака', title: 'Подсказка', content, onToggle: o => toggles.push(o) });
    document.body.append(d);
    return { d, summary: d.querySelector('summary')!, body: d.querySelector<HTMLElement>('.spoiler-body')!, toggles };
  };

  it('«Выкл»: открывается и закрывается сразу; подсказка — у заголовка', () => {
    document.body.className = 'no-ui-anim';
    const { d, summary, toggles } = make();
    expect(summary.title).toBe('Подсказка');
    summary.click();
    expect(d.open).toBe(true);
    summary.click();
    expect(d.open).toBe(false);
    expect(toggles).toEqual([true, false]);
  });

  it('«Улучшенные»: высота едет пружиной, закрытый details — когда доехала', async () => {
    const { d, summary, body } = make();
    summary.click();
    expect(d.open).toBe(true);
    expect(body.style.overflow).toBe('hidden');
    for (let i = 0; i < 90 && body.style.height; i++) await frame();
    expect(body.style.height).toBe('');
    summary.click();
    expect(d.open).toBe(true); // ещё едет
    expect(d.classList.contains('spoiler-closing')).toBe(true);
    for (let i = 0; i < 90 && d.open; i++) await frame();
    expect(d.open).toBe(false);
  });

  it('«Обычные»: CSS-переход высоты', () => {
    vi.useFakeTimers();
    document.body.className = 'no-motion';
    const { d, summary, body } = make();
    summary.click();
    expect(body.style.transition).toContain('height');
    vi.advanceTimersByTime(300);
    expect(body.style.transition).toBe('');
    expect(d.open).toBe(true);
  });
});

describe('своя полоса прокрутки', () => {
  function scroller(total: number, view: number) {
    const host = document.createElement('div');
    const sc = document.createElement('div');
    host.append(sc);
    document.body.append(host);
    Object.defineProperty(sc, 'scrollHeight', { value: total, configurable: true });
    Object.defineProperty(sc, 'clientHeight', { value: view, configurable: true });
    return { host, sc };
  }

  it('ползунок поверх, родная полоса скрыта; размер и положение — по прокрутке, при прокрутке появляется и гаснет', () => {
    vi.useFakeTimers();
    const { host, sc } = scroller(400, 100);
    const o = attachOverlayScroll(sc, { axis: 'y' });
    expect(sc.classList.contains('oscroll')).toBe(true);
    expect(o.thumb.parentElement).toBe(host);
    o.sync();
    expect(o.thumb.hidden).toBe(false);
    expect(o.thumb.style.height).toBe('25px');
    sc.scrollTop = 300;
    sc.dispatchEvent(new Event('scroll'));
    expect(o.thumb.style.transform).toBe('translate(0px, 75px)');
    expect(host.classList.contains('scrolling')).toBe(true);
    vi.advanceTimersByTime(1000);
    expect(host.classList.contains('scrolling')).toBe(false);
    o.destroy();
    expect(host.querySelector('.oscroll-thumb')).toBeNull();
  });

  it('края: тень у края, за которым есть ещё (shadow), растворение — переменными маски (fade)', () => {
    const { host, sc } = scroller(400, 100);
    attachOverlayScroll(sc, { axis: 'y', edges: 'shadow' }).sync();
    expect(host.querySelectorAll('.oscroll-shade')).toHaveLength(2);
    expect(host.classList.contains('oscroll-more-start')).toBe(false);
    expect(host.classList.contains('oscroll-more-end')).toBe(true);
    sc.scrollTop = 150;
    sc.dispatchEvent(new Event('scroll'));
    expect(host.classList.contains('oscroll-more-start')).toBe(true);
    const f = scroller(400, 100);
    attachOverlayScroll(f.sc, { axis: 'y', edges: 'fade' }).sync();
    expect(f.sc.classList.contains('oscroll-fade-y')).toBe(true);
    expect(f.sc.style.getPropertyValue('--oscroll-fe')).toBe('1');
    expect(f.sc.style.getPropertyValue('--oscroll-fs')).toBe('0');
  });

  it('ось на лету: лента страниц вверху — колонка, внизу — ряд', () => {
    let axis: 'x' | 'y' = 'x';
    const { sc } = scroller(400, 100);
    const o = attachOverlayScroll(sc, { axis: () => axis, edges: 'fade' });
    expect(o.thumb.classList.contains('oscroll-thumb-x')).toBe(true);
    axis = 'y';
    o.sync();
    expect(o.thumb.classList.contains('oscroll-thumb-y')).toBe(true);
    expect(sc.classList.contains('oscroll-fade-y')).toBe(true);
    expect(sc.classList.contains('oscroll-fade-x')).toBe(false);
  });

  it('содержимое помещается — ползунка нет', () => {
    const { sc } = scroller(100, 100);
    const o = attachOverlayScroll(sc, { axis: 'y' });
    o.sync();
    expect(o.thumb.hidden).toBe(true);
  });
});

describe('перекатывающаяся надпись', () => {
  it('«Улучшенные»: новая строка въезжает, прежняя уходит и удаляется', async () => {
    const r = createRoll('x', 18);
    document.body.append(r.el);
    r.set('Пригласить');
    r.set('Готово');
    const lines = r.el.querySelectorAll('.roll-line');
    expect(lines).toHaveLength(2);
    expect(lines[0].classList.contains('roll-leaving')).toBe(true);
    expect(lines[0].getAttribute('aria-hidden')).toBe('true');
    for (let i = 0; i < 90 && r.el.querySelectorAll('.roll-line').length > 1; i++) await frame();
    expect(r.el.querySelectorAll('.roll-line')).toHaveLength(1);
    expect(r.el.textContent).toBe('Готово');
  });

  it('«Обычные» — одна строка с CSS-проявлением; «Выкл» — сразу', () => {
    const r = createRoll('x', 18);
    document.body.append(r.el);
    r.set('А');
    document.body.className = 'no-motion';
    r.set('Б');
    expect(r.el.querySelectorAll('.roll-line')).toHaveLength(1);
    expect(r.el.querySelector('.roll-line')!.classList.contains('roll-fade')).toBe(true);
    document.body.className = 'no-ui-anim no-motion';
    r.set('В');
    expect(r.el.textContent).toBe('В');
    expect(r.el.querySelector('.roll-line')!.classList.contains('roll-fade')).toBe(false);
  });
});

describe('форма приглашения (Invite people)', () => {
  it('неверный адрес: поле краснеет; «Улучшенные» — качается пружиной, «Обычные» — CSS', async () => {
    const field = document.createElement('div');
    document.body.append(field);
    shakeField(field);
    expect(field.classList.contains('is-bad')).toBe(true);
    let moved = false;
    for (let i = 0; i < 10 && !moved; i++) { await frame(); moved = /px/.test(field.style.translate); }
    expect(moved).toBe(true);
    document.body.className = 'no-motion';
    const f2 = document.createElement('div');
    document.body.append(f2);
    shakeField(f2);
    expect(f2.classList.contains('is-shaking')).toBe(true);
  });

  it('без размеров (или при выключенных анимациях) строка показывается сразу', () => {
    const reveal = vi.fn();
    const host = dialogHost();
    flyInvite(document.createElement('div'), 'anna@mail.ru', document.createElement('span'), host, reveal);
    expect(reveal).toHaveBeenCalledTimes(1);
    expect(host.querySelector('.inv-fly')).toBeNull();
  });
});
