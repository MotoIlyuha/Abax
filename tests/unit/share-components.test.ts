// Компоненты окна «Поделиться» (по мотивам designbookmark.com/motion и Kokonut UI): выпадающий список на пружинах,
// счётчик, сегменты, перекатывающаяся надпись, страницы окна, движение формы приглашения — в трёх режимах анимаций.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createSpringSelect } from '../../src/spring-select';
import { createNumberStepper } from '../../src/number-stepper';
import { createSegmented } from '../../src/segmented';
import { createRoll } from '../../src/roll-text';
import { createStackNav } from '../../src/stack-nav';
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

describe('страницы окна (Stack panel)', () => {
  function stackOf() {
    const dialog = document.createElement('div');
    const view = document.createElement('div');
    const titles = document.createElement('div');
    const back = document.createElement('button');
    const page = (id: string) => { const p = document.createElement('div'); p.id = id; p.append(document.createElement('div')); return p; };
    const title = (t: string) => { const h = document.createElement('h2'); h.textContent = t; return h; };
    const root = { page: page('root'), title: title('Поделиться'), opener: null };
    view.append(root.page);
    titles.append(root.title);
    dialog.append(titles, back, view);
    document.body.append(dialog);
    const changes: string[] = [];
    const nav = createStackNav({ dialog, view, titles, back, root, onChange: t => changes.push(t.title.textContent!) });
    return { nav, view, titles, back, page, title, changes };
  }

  it('«Улучшенные»: верхняя страница въезжает над нижней (та — inert), по окончании нижняя уходит; «назад» — обратно', async () => {
    const { nav, view, titles, back, page, title, changes } = stackOf();
    const row = document.createElement('button');
    view.querySelector('#root')!.append(row);
    nav.push({ page: page('sub'), title: title('Настройки'), opener: row });
    expect(nav.depth).toBe(1);
    expect(back.hidden).toBe(false);
    expect(view.querySelector('#sub')!.classList.contains('stack-top')).toBe(true);
    expect(view.querySelector('#root')!.hasAttribute('inert')).toBe(true);
    expect(titles.lastElementChild!.textContent).toBe('Настройки');
    for (let i = 0; i < 120 && nav.busy; i++) await frame();
    expect(nav.busy).toBe(false);
    expect(view.querySelector('#root')).toBeNull();
    expect(view.querySelector<HTMLElement>('#sub')!.style.transform).toBe('');
    nav.pop();
    for (let i = 0; i < 120 && nav.busy; i++) await frame();
    expect(view.querySelector('#sub')).toBeNull();
    expect(view.querySelector('#root')!.hasAttribute('inert')).toBe(false);
    expect(back.hidden).toBe(true);
    expect(changes).toEqual(['Настройки', 'Поделиться']);
  });

  it('«Выкл»: страницы меняются сразу', () => {
    document.body.className = 'no-ui-anim no-motion';
    const { nav, view, page, title } = stackOf();
    nav.push({ page: page('sub'), title: title('Без облака'), opener: null });
    expect(nav.busy).toBe(false);
    expect([...view.children].map(c => c.id)).toEqual(['sub']);
    nav.pop();
    expect([...view.children].map(c => c.id)).toEqual(['root']);
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
