// Окно подписки (по мотивам «Plan switch» с designbookmark.com/motion, plan.js): тарифы «Бесплатный», Pro и Tutor.
// Срок «Месяц / 3 месяца / Год» переключает подсветка на двух пружинах (край, обращённый к движению, жёсткий 620/36,
// отстающий — мягкий 190/19: подсветка тянется в пути и приземляется целой); цена в месяц катится на барабанах
// цифр (260/22+2i, с задержкой 45 мс между разрядами), чип скидки выпрыгивает от правого края (520/16), строка
// оплаты перекатывается (420/32), строка «Экономия» вырастает (высота на пружине 260/24), а её галочка
// выпрыгивает чуть позже (через 0,16 с). «Оформить» сжимается в круг со спиннером (260/24) и раскрывается
// зелёным «Вы на Pro». Пружины — ровно как в tokens.css образца (у нас — те же токены в style.css).
//
// Три режима анимаций доски:
// - «Улучшенные» — пружины;
// - «Обычные» (body.no-motion) — пружины встают на цель сразу, плавность даёт CSS (переходы в style.css);
// - «Выкл» (body.no-ui-anim) — всё сразу, без переходов.
//
// Купить и взять пробный период можно только после входа (src/subscription.ts); оплату проверяет сервер.
// Текст — только textContent; значки — константы.

import {
  BILLING_PERIODS, PERIOD_TITLES, PERIOD_FOR, PLAN_TITLES, PRICES, dateText, formatRub, monthlyPrice, planRank, savingsPct, savingsRub,
  type BillingPeriod, type PaidPlan,
} from './billing';
import { CLOSE_ICON, ICONS } from './icons';
import { S, atRest, clamp, motionEnabled, register, snap, spring, step, tune, uiAnimOff, unregister, wake, type MotionComponent, type Spring } from './motion';
import { userPlan } from './plan';
import type { ProFeature } from './pro-badge';
import { billingBlocker, billingErrorText, billingState, checkout, onBillingChange, refreshBilling, startTrial } from './subscription';
import type { PlanTier } from './types';

export interface PlansDialogHooks {
  /** «Войти»: окно закрывается, открывается вход (настройки → «Профиль»). */
  openLogin(): void;
  /** «Есть промокод?»: настройки → «Подписка». */
  openPromo(): void;
}

let hooks: PlansDialogHooks = { openLogin: () => {}, openPromo: () => {} };
export function setPlansDialogHooks(h: PlansDialogHooks): void { hooks = h; }

const REASONS: Record<ProFeature, string> = {
  pages: 'На бесплатном тарифе - до 3 страниц в проекте. В Pro страниц сколько угодно',
  projects: 'На бесплатном тарифе - до 3 проектов. В Pro проектов сколько угодно',
  history: 'История изменений доступна в подписке Pro',
  follow: 'Автопереход участников за вами доступен в подписке Pro',
  copy: 'Запрет копирования и экспорта доступен в подписке Pro',
  clone: 'Запрет копий доски доступен в подписке Pro',
  guests: 'Свой лимит гостей доступен в подписке Pro',
  alias: 'Именной адрес доски доступен в подписке Pro',
};
const DEFAULT_REASON = 'Доски без ограничений, история изменений и защита ваших материалов';

/** Строка списка Pro, которую подсветить, если окно открыто из-за возможности. */
const WANTED_ROW: Record<ProFeature, string> = {
  pages: 'unlimited', projects: 'unlimited', history: 'history', follow: 'follow', copy: 'protect', clone: 'protect', guests: 'guests', alias: 'alias',
};

const FEATURES: Record<PlanTier, readonly (readonly [string, string])[]> = {
  free: [['projects', '3 проекта по 3 страницы'], ['guest', 'Один гость на доске'], ['cloud', 'Облако и вход с любого устройства'], ['chat', 'Совместная работа и чат']],
  pro: [
    ['unlimited', 'Проекты и страницы без ограничений'], ['guests', 'Сколько угодно гостей'], ['history', 'История изменений'],
    ['protect', 'Запрет копирования и копий доски'], ['alias', 'Именной адрес доски'], ['follow', 'Участники переходят за вами'], ['cursors', 'Pro-курсоры'],
  ],
  tutor: [['all', 'Всё, что есть в Pro'], ['tasks', 'Задания ОГЭ и ЕГЭ с проверкой ответов'], ['answers', 'Ответы и решения видны только вам']],
};

const CHECK = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 12.5l4 4 8-9"/></svg>';
/** Высота строки списка (px): строка «Экономия» вырастает до неё. */
const ROW_H = 30;
const DIGITS = 3;
const DIGIT_H = 44;

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

const animated = (): boolean => motionEnabled() && !uiAnimOff();

// ----- Пружины образца -----

interface Tokens { lead: [number, number]; trail: [number, number]; pop: [number, number]; fade: [number, number]; soft: [number, number] }
function tokens(): Tokens {
  return {
    lead: spring('--spring-lead', [620, 36]), trail: spring('--spring-trail', [190, 19]), pop: spring('--spring-pop', [520, 16]),
    fade: spring('--spring-fade', [420, 32]), soft: spring('--spring-soft', [260, 24]),
  };
}

// ----- Перекатывающаяся строка и барабаны цифр (line() и roller() образца) -----

interface Line { set(key: string, fill: (host: HTMLElement) => void): void; step(dt: number): void; render(): void; springs(): Spring[] }

function rollLine(box: HTMLElement, h: number, T: Tokens): Line {
  let items: { el: HTMLElement; y: Spring; o: Spring; dead: boolean }[] = [];
  let cur: string | null = null;
  return {
    set(key, fill) {
      if (key === cur) return;
      for (const o of items) { o.y.t = -h; o.o.t = 0; o.dead = true; }
      const sp = el('span');
      fill(sp);
      box.appendChild(sp);
      const o = { el: sp, y: S(cur === null ? 0 : h), o: S(cur === null ? 1 : 0), dead: false };
      tune(o.y, ...T.fade); tune(o.o, ...T.fade);
      o.y.t = 0; o.o.t = 1;
      items.push(o);
      cur = key;
    },
    step(dt) {
      for (const o of items) { step(o.y, dt); step(o.o, dt); }
      items = items.filter(o => {
        if (o.dead && o.o.x < 0.02) { o.el.remove(); return false; }
        return true;
      });
    },
    render() {
      for (const o of items) {
        o.el.style.transform = `translateY(${o.y.x.toFixed(2)}px)`;
        o.el.style.opacity = clamp(o.o.x, 0, 1).toFixed(3);
      }
    },
    springs: () => items.flatMap(o => [o.y, o.o]),
  };
}

interface Roller { set(v: number): void; step(dt: number): void; render(): void; springs(): Spring[] }

function roller(box: HTMLElement, n: number, px: number, after: (sec: number, fn: () => void) => void): Roller {
  const cols: { s: HTMLElement; y: Spring }[] = [];
  for (let i = 0; i < n; i++) {
    const c = el('span', 'pl-rc');
    const s = el('span', 'pl-rs');
    for (let d = 0; d <= 9; d++) s.appendChild(el('i', '', String(d)));
    c.appendChild(s);
    box.appendChild(c);
    const y = S(0);
    tune(y, 260, 22 + i * 2);
    cols.push({ s, y });
  }
  let first = true;
  return {
    set(v) {
      const str = String(v).padStart(n, '0');
      cols.forEach((col, i) => {
        const go = () => { col.y.t = +str[i]; };
        if (first) { go(); snap(col.y); } else after(i * 0.045, go);
      });
      first = false;
    },
    step(dt) { for (const c of cols) step(c.y, dt); },
    render() { for (const c of cols) c.s.style.transform = `translateY(${(-c.y.x * px).toFixed(2)}px)`; },
    springs: () => cols.map(c => c.y),
  };
}

// ----- Карточка платного тарифа -----

type CtaState = 'idle' | 'busy' | 'done' | 'off';

interface PaidCard {
  plan: PaidPlan;
  el: HTMLElement;
  save: HTMLElement;
  extra: HTMLElement;
  extraCk: HTMLElement;
  cta: HTMLButtonElement;
  note: HTMLElement;
  current: HTMLElement;
  price: Roller;
  bill: Line;
  extraLine: Line;
  btn: Line;
  SV: Spring; EX: Spring; EK: Spring; CW: Spring; CP: Spring;
  state: CtaState;
  /** Подпись кнопки в покое (ключ для перекатки). */
  idleKey: string;
}

interface Open {
  root: HTMLElement;
  close(): void;
}

let current: Open | null = null;

export function plansDialogOpen(): boolean {
  return current !== null;
}

export function closePlansDialog(): void {
  current?.close();
}

const closeListeners = new Set<() => void>();
/** Окно закрылось (тариф в шапке показывает превращение только после этого). */
export function onPlansDialogClose(fn: () => void): () => void {
  closeListeners.add(fn);
  return () => { closeListeners.delete(fn); };
}

/** Открыть окно подписки; feature — из-за какой недоступной возможности (подсветить её). */
export function openPlansDialog(feature: ProFeature | null = null): void {
  if (current) return;
  const T = tokens();
  const timers: { t: number; fn: () => void }[] = [];
  const after = (sec: number, fn: () => void) => { timers.push({ t: sec, fn }); wake(); };

  const root = el('div');
  root.id = 'plans-dialog';
  const win = el('div', 'pl-window');
  win.setAttribute('role', 'dialog');
  win.setAttribute('aria-modal', 'true');
  const title = el('h2', 'pl-title', 'Подписка Abax');
  title.id = 'plans-dialog-title';
  win.setAttribute('aria-labelledby', title.id);
  const sub = el('p', 'pl-sub', feature ? REASONS[feature] : DEFAULT_REASON);
  const closeBtn = el('button', 'ob-close pl-close');
  closeBtn.type = 'button';
  closeBtn.title = 'Закрыть';
  closeBtn.setAttribute('aria-label', 'Закрыть');
  closeBtn.innerHTML = CLOSE_ICON; // константа значка

  // ----- срок -----
  const seg = el('div', 'pl-seg');
  seg.setAttribute('role', 'radiogroup');
  seg.setAttribute('aria-label', 'Срок оплаты');
  const hl = el('span', 'pl-hl');
  hl.setAttribute('aria-hidden', 'true');
  seg.appendChild(hl);
  const segBtns = new Map<BillingPeriod, HTMLButtonElement>();
  for (const p of BILLING_PERIODS) {
    const b = el('button', 'pl-seg-btn', PERIOD_TITLES[p]);
    b.type = 'button';
    b.setAttribute('role', 'radio');
    b.dataset.period = p;
    b.setAttribute('aria-checked', 'false');
    b.tabIndex = -1;
    seg.appendChild(b);
    segBtns.set(p, b);
  }
  const L = S(0), R = S(0);

  // ----- карточки -----
  const cards = el('div', 'pl-cards');

  const featList = (tier: PlanTier): HTMLUListElement => {
    const ul = el('ul', 'pl-feats');
    for (const [key, text] of FEATURES[tier]) {
      const li = el('li');
      li.dataset.key = key;
      const ck = el('span', 'pl-ck');
      ck.innerHTML = CHECK; // константа значка
      li.append(ck, el('span', 'pl-feat-text', text));
      if (feature && tier === 'pro' && WANTED_ROW[feature] === key) li.classList.add('is-wanted');
      ul.appendChild(li);
    }
    return ul;
  };

  const currentPill = (): HTMLElement => {
    const p = el('span', 'pl-current');
    p.hidden = true;
    return p;
  };

  // бесплатный — без цены на барабанах и без кнопки
  const freeCard = el('section', 'pl-card pl-card-free');
  freeCard.dataset.plan = 'free';
  const freeCurrent = currentPill();
  const freeHead = el('div', 'pl-name');
  freeHead.append(el('span', '', PLAN_TITLES.free), freeCurrent);
  const freePrice = el('div', 'pl-price');
  freePrice.append(el('span', 'pl-num pl-num-static', '0'), el('span', 'pl-cur', '₽'), el('span', 'pl-per', '/мес'));
  const freeBill = el('div', 'pl-bill pl-bill-static', 'Навсегда, без оплаты');
  freeCard.append(freeHead, freePrice, freeBill, featList('free'));
  cards.appendChild(freeCard);

  const paid: PaidCard[] = [];
  for (const p of ['pro', 'tutor'] as const) {
    const card = el('section', `pl-card pl-card-${p}`);
    card.dataset.plan = p;
    const name = el('div', 'pl-name');
    const nameText = el('span', 'pl-plan-name', PLAN_TITLES[p]);
    const save = el('span', 'pl-save');
    const cur = currentPill();
    name.append(nameText, cur, save);
    const priceRow = el('div', 'pl-price');
    const num = el('span', 'pl-num');
    num.setAttribute('aria-hidden', 'true');
    const spoken = el('span', 'pl-sr');
    priceRow.append(num, el('span', 'pl-cur', '₽'), el('span', 'pl-per', '/мес'), spoken);
    const bill = el('div', 'pl-bill pl-roll');
    bill.setAttribute('aria-live', 'polite');
    const feats = featList(p);
    const extra = el('li', 'pl-extra');
    const extraCk = el('span', 'pl-ck is-green');
    extraCk.innerHTML = CHECK; // константа значка
    const extraText = el('span', 'pl-roll pl-extra-text');
    extra.append(extraCk, extraText);
    feats.appendChild(extra);
    const foot = el('div', 'pl-foot-card');
    const cta = el('button', 'pl-cta');
    cta.type = 'button';
    const ctaIn = el('span', 'pl-cta-in');
    cta.appendChild(ctaIn);
    const note = el('div', 'pl-note');
    foot.append(cta, note);
    card.append(name, priceRow, bill, feats, foot);
    cards.appendChild(card);
    const c: PaidCard = {
      plan: p, el: card, save, extra, extraCk, cta, note, current: cur,
      price: roller(num, DIGITS, DIGIT_H, after), bill: rollLine(bill, 20, T), extraLine: rollLine(extraText, 20, T), btn: rollLine(ctaIn, 48, T),
      SV: S(1), EX: S(1), EK: S(1), CW: S(1), CP: S(1), state: 'idle', idleKey: '',
    };
    tune(c.SV, ...T.pop); tune(c.EX, ...T.soft); tune(c.EK, ...T.pop); tune(c.CW, ...T.soft); tune(c.CP, ...T.pop);
    paid.push(c);
    cta.addEventListener('click', () => { void buy(c); });
  }

  // ----- сообщение и подвал -----
  const msg = el('div', 'pl-msg');
  msg.setAttribute('role', 'alert');
  msg.hidden = true;
  const foot = el('div', 'pl-foot');
  const promo = el('button', 'pl-link');
  promo.type = 'button';
  promo.innerHTML = ICONS.ticket; // константа значка
  promo.append('Есть промокод?');
  promo.addEventListener('click', () => { close(); hooks.openPromo(); });
  foot.append(promo, el('span', 'pl-fine', 'Оплата разовая за выбранный срок, без автопродления'));

  win.append(closeBtn, title, sub, seg, cards, msg, foot);
  root.appendChild(win);

  function say(text: string, action?: { label: string; run: () => void }): void {
    msg.textContent = '';
    msg.hidden = false;
    msg.appendChild(el('span', '', text));
    if (action) {
      const b = el('button', 'ob-btn ob-primary pl-msg-btn', action.label);
      b.type = 'button';
      b.addEventListener('click', action.run);
      msg.appendChild(b);
    }
  }

  // ----- срок: выбор -----
  let period: BillingPeriod | null = null;
  function pick(p: BillingPeriod): void {
    if (p === period) return;
    const first = period === null;
    const prevIdx = period ? BILLING_PERIODS.indexOf(period) : 0;
    period = p;
    for (const [q, b] of segBtns) {
      b.setAttribute('aria-checked', String(q === p));
      b.tabIndex = q === p ? 0 : -1;
    }
    const b = segBtns.get(p)!;
    const l = b.offsetLeft, r = l + b.offsetWidth;
    const right = !first && BILLING_PERIODS.indexOf(p) > prevIdx; // вправо: ведёт правый край
    tune(L, ...(right ? T.trail : T.lead));
    tune(R, ...(right ? T.lead : T.trail));
    L.t = l; R.t = r;
    if (first) { snap(L); snap(R); }
    for (const c of paid) {
      c.price.set(monthlyPrice(c.plan, p));
      c.el.querySelector<HTMLElement>('.pl-sr')!.textContent = `${monthlyPrice(c.plan, p)} рублей в месяц`;
      c.bill.set(p, h => { h.textContent = `${formatRub(PRICES[c.plan][p])} ${PERIOD_FOR[p]}`; });
      const pct = savingsPct(c.plan, p);
      if (pct > 0) {
        const was = c.save.textContent;
        c.save.textContent = `−${pct}%`;
        if (was !== c.save.textContent) c.SV.x = Math.min(c.SV.x, 0.3);
      }
      c.SV.t = pct > 0 ? 1 : 0;
      c.EX.t = pct > 0 ? 1 : 0;
      if (pct > 0) {
        c.extraLine.set(p, h => { h.textContent = `Экономия ${formatRub(savingsRub(c.plan, p))}`; });
        c.EK.x = 0.3; c.EK.t = 0;
        after(0.16, () => { c.EK.t = 1; });
      }
      if (first) { snap(c.SV); snap(c.EX); c.EK.x = c.EK.t = pct > 0 ? 1 : 0; }
      syncCta(c);
    }
    wake();
  }
  for (const [p, b] of segBtns) b.addEventListener('click', () => pick(p));
  seg.addEventListener('keydown', e => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) return;
    e.preventDefault();
    const i = BILLING_PERIODS.indexOf(period ?? 'year');
    const n = e.key === 'Home' ? 0 : e.key === 'End' ? BILLING_PERIODS.length - 1
      : clamp(i + (e.key === 'ArrowRight' ? 1 : -1), 0, BILLING_PERIODS.length - 1);
    pick(BILLING_PERIODS[n]);
    segBtns.get(BILLING_PERIODS[n])!.focus();
  });

  // ----- кнопка -----
  const trialOffered = (): boolean => {
    const b = billingState();
    // без сведений (не вошли) пробный период предлагается: у нового аккаунта он есть
    return userPlan() === 'free' && (b ? b.trialAvailable : true);
  };

  function idleLabel(c: PaidCard): { key: string; text: string; disabled: boolean } {
    const now = userPlan();
    if (planRank(now) > planRank(c.plan)) return { key: 'included', text: `Входит в ${PLAN_TITLES[now]}`, disabled: true };
    if (now === c.plan) return { key: `renew-${period}`, text: `Продлить ${PERIOD_FOR[period ?? 'month']}`, disabled: false };
    if (c.plan === 'tutor' && trialOffered()) return { key: 'trial', text: '14 дней бесплатно', disabled: false };
    return { key: `buy-${c.plan}`, text: `Оформить ${PLAN_TITLES[c.plan]}`, disabled: false };
  }

  function setBtn(c: PaidCard, s: CtaState): void {
    c.state = s;
    if (s === 'idle' || s === 'off') {
      const l = idleLabel(c);
      c.cta.classList.remove('is-done');
      c.CW.t = 1;
      c.idleKey = l.key;
      c.btn.set(l.key, h => { h.textContent = l.text; });
      c.cta.setAttribute('aria-label', l.text);
      c.cta.disabled = l.disabled;
      c.state = l.disabled ? 'off' : 'idle';
    }
    if (s === 'busy') {
      c.CW.t = 0;
      c.btn.set('busy', h => { const sp = el('span', 'pl-spin'); sp.setAttribute('aria-hidden', 'true'); h.appendChild(sp); });
      c.cta.setAttribute('aria-label', 'Оформляем…');
    }
    if (s === 'done') {
      c.cta.classList.add('is-done');
      c.CW.t = 1;
      c.CP.x = 0.92;
      const text = `Вы на ${PLAN_TITLES[c.plan]}`;
      c.btn.set('done', h => { h.innerHTML = CHECK; h.append(text); }); // CHECK — константа значка
      c.cta.setAttribute('aria-label', text);
    }
    wake();
  }

  /** Подписи, «Ваш тариф» и пояснение под кнопкой — по тарифу и сведениям сервера. */
  function syncCta(c: PaidCard): void {
    if (c.state === 'idle' || c.state === 'off') {
      const l = idleLabel(c);
      if (l.key !== c.idleKey || c.cta.disabled !== l.disabled) setBtn(c, 'idle');
    }
    const b = billingState();
    const now = userPlan();
    const isCur = now === c.plan;
    c.current.hidden = !isCur;
    c.current.textContent = isCur ? (b?.trial ? 'Пробный' : 'Ваш тариф') : '';
    c.el.classList.toggle('is-current', isCur);
    let note = '';
    if (isCur && b?.planExpiresAt) note = `${b.trial ? 'Пробный период' : 'Действует'} до ${dateText(b.planExpiresAt)}`;
    else if (c.plan === 'tutor' && trialOffered()) note = 'Один раз на аккаунт, оплата не нужна';
    c.note.textContent = note;
    c.note.hidden = !note;
  }

  function syncFree(): void {
    const isCur = userPlan() === 'free';
    freeCurrent.hidden = !isCur;
    freeCurrent.textContent = isCur ? 'Ваш тариф' : '';
    freeCard.classList.toggle('is-current', isCur);
  }

  function syncAll(): void {
    syncFree();
    for (const c of paid) syncCta(c);
  }

  let closeTimer = 0;
  async function buy(c: PaidCard): Promise<void> {
    if (c.state !== 'idle' || !period) return;
    msg.hidden = true;
    const blocker = billingBlocker();
    if (blocker === 'login-required') {
      say(billingErrorText(blocker), { label: 'Войти', run: () => { close(); hooks.openLogin(); } });
      return;
    }
    if (blocker) { say(billingErrorText(blocker)); return; }
    const trial = c.idleKey === 'trial';
    c.CP.x = 0.94;
    setBtn(c, 'busy');
    const started = performance.now();
    const r = trial ? await startTrial() : await checkout(c.plan, period);
    // спиннер виден хотя бы мгновение: иначе ответ «моргает»
    const wait = Math.max(0, 0.6 - (performance.now() - started) / 1000);
    after(wait, () => {
      if (current?.root !== root) return;
      if (!r.ok) { setBtn(c, 'idle'); say(billingErrorText(r.error)); return; }
      if (r.confirmationUrl) {
        setBtn(c, 'idle');
        say('Оплатите выбранный тариф в ЮKassa. После оплаты вернитесь сюда.', {
          label: 'Проверить оплату', run: () => { void refreshBilling(); },
        });
        const link = el('a', 'ob-btn ob-primary pl-msg-btn', 'Перейти к оплате');
        link.href = r.confirmationUrl;
        link.target = '_blank';
        link.rel = 'noopener noreferrer';
        msg.appendChild(link);
        return;
      }
      setBtn(c, 'done');
      for (const o of paid) if (o !== c) syncCta(o);
      syncFree();
      // окно закрывается: в шапке «Бесплатный» превращается в новый тариф
      closeTimer = window.setTimeout(() => close(), 1400);
    });
  }

  // ----- цикл -----
  const springs = (): Spring[] => [L, R, ...paid.flatMap(c => [c.SV, c.EX, c.EK, c.CW, c.CP, ...c.price.springs(), ...c.bill.springs(), ...c.extraLine.springs(), ...c.btn.springs()])];
  const comp: MotionComponent = {
    frame(dt) {
      for (let i = timers.length - 1; i >= 0; i--) {
        if ((timers[i].t -= dt) <= 0) timers.splice(i, 1)[0].fn();
      }
      if (!animated()) { for (const s of springs()) snap(s); }
      step(L, dt); step(R, dt);
      for (const c of paid) {
        for (const s of [c.SV, c.EX, c.EK, c.CW, c.CP]) step(s, dt);
        c.price.step(dt); c.bill.step(dt); c.extraLine.step(dt); c.btn.step(dt);
      }
    },
    render() {
      hl.style.transform = `translateX(${L.x.toFixed(2)}px)`;
      hl.style.width = `${Math.max(36, R.x - L.x).toFixed(2)}px`;
      for (const c of paid) {
        c.price.render(); c.bill.render(); c.extraLine.render(); c.btn.render();
        const sv = Math.max(0, c.SV.x);
        c.save.style.transform = `scale(${sv.toFixed(4)})`;
        c.save.style.opacity = clamp(sv * 1.4, 0, 1).toFixed(3);
        const ex = clamp(c.EX.x, 0, 1.08);
        c.extra.style.height = `${(ROW_H * ex).toFixed(2)}px`;
        c.extra.style.opacity = clamp(c.EX.x * 1.6 - 0.4, 0, 1).toFixed(3);
        c.extraCk.style.transform = `scale(${Math.max(0, c.EK.x).toFixed(4)})`;
        const full = c.cta.parentElement!.clientWidth;
        const w = 48 + (full - 48) * clamp(c.CW.x, 0, 1.03);
        c.cta.style.width = `${w.toFixed(2)}px`;
        c.cta.style.transform = `scale(${c.CP.x.toFixed(4)})`;
      }
    },
    settled: () => timers.length === 0 && springs().every(s => atRest(s, 0.002)),
  };

  // ----- открытие и закрытие -----
  function close(): void {
    if (current?.root !== root) return;
    current = null;
    clearTimeout(closeTimer);
    unregister(comp);
    offBilling();
    window.removeEventListener('keydown', onOutsideKey, true);
    window.removeEventListener('resize', onResize);
    root.remove();
    for (const fn of [...closeListeners]) {
      try { fn(); } catch (e) { console.error(e); }
    }
  }

  function trapFocus(e: KeyboardEvent): void {
    const items = [...win.querySelectorAll<HTMLElement>('button, a[href]')].filter(x => !(x as HTMLButtonElement).disabled && x.tabIndex !== -1);
    const firstEl = items[0], last = items[items.length - 1];
    const cur = document.activeElement;
    if (!win.contains(cur)) { e.preventDefault(); firstEl.focus(); }
    else if (e.shiftKey && cur === firstEl) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && cur === last) { e.preventDefault(); firstEl.focus(); }
  }
  function onKey(e: KeyboardEvent): void {
    if (e.key === 'Escape') { e.preventDefault(); close(); }
    else if (e.key === 'Tab') trapFocus(e);
    e.stopPropagation();
  }
  function onOutsideKey(e: KeyboardEvent): void {
    if (e.target instanceof Node && root.contains(e.target)) return;
    e.stopPropagation();
    if (e.key === 'Escape') { e.preventDefault(); close(); }
    else if (e.key === 'Tab') { e.preventDefault(); segBtns.get(period ?? 'year')!.focus(); }
  }
  function onResize(): void {
    if (!period) return;
    const b = segBtns.get(period)!;
    L.t = b.offsetLeft; R.t = b.offsetLeft + b.offsetWidth;
    snap(L); snap(R);
    wake();
  }

  closeBtn.addEventListener('click', close);
  let downOnScrim = false;
  root.addEventListener('pointerdown', e => { downOnScrim = e.target === root; });
  root.addEventListener('click', e => { if (e.target === root && downOnScrim) close(); });
  root.addEventListener('keydown', onKey);
  window.addEventListener('keydown', onOutsideKey, true);
  window.addEventListener('resize', onResize);
  const offBilling = onBillingChange(() => syncAll());
  if (uiAnimOff()) root.classList.add('pl-instant');
  document.body.appendChild(root);
  current = { root, close };
  register(comp);
  for (const c of paid) setBtn(c, 'idle');
  pick('year');
  syncAll();
  segBtns.get(period ?? 'year')!.focus({ preventScroll: true });
  void refreshBilling();
}
