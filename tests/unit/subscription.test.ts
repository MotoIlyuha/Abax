// Подписка на клиенте: цены и сроки, смена тарифа и лестница «−/+», единый бейдж Pro и его разлом по факту
// просмотра, окно подписки (Plan switch), раздел «Подписка», тариф в шапке. Анимации выключены (body.no-ui-anim).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setApiForTests, type ApiClient, type MeResponse } from '../../src/api-client';
import {
  DAY_MS, extendPlan, formatRub, monthlyPrice, normalizePromoCode, promoEffectText, savingsPct, savingsRub, timeLeftText,
  type BillingInfo,
} from '../../src/billing';
import { clearServerPlan, devPlanStep, onPlanChange, resetPlanListenersForTests, setLimitsEnforced, setUserPlan, applyServerPlan, DEV_MODE_KEY } from '../../src/plan';
import {
  LOCKED_KEY, PENDING_KEY, breakPending, featureLocked, proBadge, resetProBadgesForTests, setProBadgeNeeded, setUpgradeHandler, startProBadges, syncProLocks,
} from '../../src/pro-badge';
import { closePlansDialog, openPlansDialog, plansDialogOpen, setPlansDialogHooks } from '../../src/plans-dialog';
import { resetBillingForTests } from '../../src/subscription';
import { renderSubscriptionSettings, tierSummary } from '../../src/subscription-settings';
import { resetProfileSyncForTests, setAccount } from '../../src/profile-sync';

const billing = (over: Partial<BillingInfo> = {}): BillingInfo => ({
  plan: 'free', planExpiresAt: null, trial: false, trialAvailable: true, paymentsEnabled: true, payments: [], promos: [], ...over,
});

const me = (plan: 'free' | 'pro' | 'tutor', anonymous = false): MeResponse => ({
  user: { id: 'u1', displayName: 'Аня', tgUsername: null, avatarUrl: null, isAnonymous: anonymous, plan, email: anonymous ? null : 'a@b.ru' },
  plan, planExpiresAt: null, limitsEnforced: true,
  limits: { maxProjects: null, maxPagesPerProject: null, maxRoomGuests: null, canForbidClone: true, canDisableCopy: true },
});

function fakeApi(handler: (method: string, path: string, body: any) => unknown): ApiClient & { calls: [string, string, any][] } {
  const calls: [string, string, any][] = [];
  return {
    base: 'http://api.test', calls,
    async request<T>(method: string, path: string, body?: unknown): Promise<T> {
      calls.push([method, path, body]);
      const r = handler(method, path, body);
      if (r instanceof Error) throw r;
      return r as T;
    },
    ensureSession: async () => 'tok', me: async () => me('free'), logout: async () => {},
  };
}

const flush = () => new Promise(r => setTimeout(r, 0));

beforeEach(() => {
  localStorage.clear();
  document.body.className = 'no-ui-anim no-motion';
  document.body.textContent = '';
  resetPlanListenersForTests();
  resetProBadgesForTests();
  resetBillingForTests();
  resetProfileSyncForTests();
  clearServerPlan();
  setApiForTests(null);
});
afterEach(() => {
  closePlansDialog();
  setApiForTests(undefined);
  setUpgradeHandler(null);
});

describe('цены и сроки', () => {
  it('цена в месяц, экономия и скидка', () => {
    expect(monthlyPrice('pro', 'month')).toBe(399);
    expect(monthlyPrice('pro', 'quarter')).toBe(333);
    expect(monthlyPrice('pro', 'year')).toBe(292);
    expect(monthlyPrice('tutor', 'quarter')).toBe(500);
    expect(monthlyPrice('tutor', 'year')).toBe(500);
    expect(savingsRub('pro', 'year')).toBe(399 * 12 - 3499);
    expect(savingsPct('pro', 'month')).toBe(0);
    expect(savingsPct('pro', 'year')).toBe(27);
    expect(savingsPct('tutor', 'quarter')).toBe(29);
    expect(formatRub(3499)).toBe('3\u00a0499\u00a0₽');
  });

  it('срок: тот же тариф складывается, старший начинается сейчас, младший добавляет дни к старшему', () => {
    const now = 1000 * DAY_MS;
    expect(extendPlan({ plan: 'free', expiresAt: null }, { plan: 'pro', days: 30 }, now)).toEqual({ plan: 'pro', expiresAt: now + 30 * DAY_MS });
    expect(extendPlan({ plan: 'pro', expiresAt: now + DAY_MS }, { plan: 'pro', days: 30 }, now)).toEqual({ plan: 'pro', expiresAt: now + 31 * DAY_MS });
    expect(extendPlan({ plan: 'pro', expiresAt: now + DAY_MS }, { plan: 'tutor', days: 7 }, now)).toEqual({ plan: 'tutor', expiresAt: now + 7 * DAY_MS });
    expect(extendPlan({ plan: 'tutor', expiresAt: now + DAY_MS }, { plan: 'pro', days: 7 }, now)).toEqual({ plan: 'tutor', expiresAt: now + 8 * DAY_MS });
    // истёкший тариф — как free
    expect(extendPlan({ plan: 'tutor', expiresAt: now - 1 }, { plan: 'pro', days: 7 }, now)).toEqual({ plan: 'pro', expiresAt: now + 7 * DAY_MS });
    // бессрочный остаётся бессрочным
    expect(extendPlan({ plan: 'pro', expiresAt: null }, { plan: 'pro', days: 7 }, now)).toEqual({ plan: 'pro', expiresAt: null });
  });

  it('промокод: канонический вид и текст эффекта; остаток времени', () => {
    expect(normalizePromoCode(' spring-2026 ')).toBe('SPRING-2026');
    expect(normalizePromoCode('ab')).toBeNull();
    expect(normalizePromoCode('<script>')).toBeNull();
    expect(promoEffectText({ plan: 'pro', days: 30 })).toBe('Pro на 30 дней');
    expect(promoEffectText({ plan: 'tutor', days: 1 })).toBe('Tutor на 1 день');
    expect(timeLeftText(13 * DAY_MS + 5 * 3600_000, 0)).toBe('13 дней 5 часов');
    expect(timeLeftText(2 * 3600_000 - 1, 0)).toBe('2 часа');
    expect(timeLeftText(0, 0)).toBe('меньше часа');
  });
});

describe('смена тарифа', () => {
  it('подписчики узнают о смене тарифа и лимитов один раз', () => {
    const seen: string[] = [];
    onPlanChange(c => seen.push(`${c.from}>${c.to}:${c.enforced}`));
    applyServerPlan({ plan: 'pro', limitsEnforced: true });
    applyServerPlan({ plan: 'pro', limitsEnforced: true });
    clearServerPlan();
    expect(seen).toEqual(['free>pro:true', 'pro>free:false']);
  });

  it('«+» и «−» в режиме разработки идут по лестнице Free → Pro → Tutor', () => {
    expect(devPlanStep('Equal', 'free')).toBe('pro');
    expect(devPlanStep('NumpadAdd', 'pro')).toBe('tutor');
    expect(devPlanStep('Equal', 'tutor')).toBe('tutor');
    expect(devPlanStep('Minus', 'tutor')).toBe('pro');
    expect(devPlanStep('NumpadSubtract', 'pro')).toBe('free');
    expect(devPlanStep('Minus', 'free')).toBe('free');
    expect(devPlanStep('KeyA', 'free')).toBeNull();
  });
});

describe('бейдж Pro', () => {
  it('один вид везде; виден, только пока возможность закрыта; нажатие — окно подписки', () => {
    const upgrade = vi.fn();
    setUpgradeHandler(upgrade);
    const b = proBadge('history');
    document.body.appendChild(b);
    expect(b.className).toContain('pro-badge');
    expect(b.textContent).toBe('Pro');
    expect(b.hidden).toBe(true); // лимиты выключены — ничего не закрыто
    setLimitsEnforced(true);
    startProBadges();
    expect(featureLocked('history')).toBe(true);
    expect(b.hidden).toBe(false);
    b.click();
    expect(upgrade).toHaveBeenCalledWith('history');
    // «нужен ли здесь» решает место: например, страниц ещё мало
    setProBadgeNeeded(b, false);
    expect(b.hidden).toBe(true);
  });

  it('после оплаты бейдж ждёт, пока его увидят, и раскалывается; невидимый — ждёт дальше', async () => {
    setLimitsEnforced(true);
    startProBadges();
    expect(JSON.parse(localStorage.getItem(LOCKED_KEY)!)).toContain('copy');
    // бейдж «копирование» сейчас не на экране (окно «Поделиться» закрыто)
    applyServerPlan({ plan: 'pro', limitsEnforced: true });
    expect(breakPending('copy')).toBe(true);
    expect(JSON.parse(localStorage.getItem(PENDING_KEY)!)).toContain('copy');
    // открыли окно — бейдж появился, «увидели» его и он раскололся (анимации выключены — сразу)
    const b = proBadge('copy');
    expect(b.hidden).toBe(false);
    expect(b.classList.contains('is-waiting')).toBe(true);
    document.body.appendChild(b);
    syncProLocks(); // после появления в документе наблюдатель начинает следить за бейджем
    await flush();
    expect(breakPending('copy')).toBe(false);
    expect(b.hidden).toBe(true);
    // новый бейдж той же возможности больше не появляется
    expect(proBadge('copy').hidden).toBe(true);
    // другие возможности по-прежнему ждут
    expect(breakPending('alias')).toBe(true);
  });

  it('вернулся бесплатный тариф — бейджи снова на месте; первый запуск ничего не ломает', () => {
    applyServerPlan({ plan: 'pro', limitsEnforced: true });
    startProBadges();
    expect(breakPending('history')).toBe(false); // снимка не было — ломать нечего
    clearServerPlan();
    setLimitsEnforced(true);
    expect(proBadge('history').hidden).toBe(false);
    resetProBadgesForTests();
    syncProLocks();
    expect(breakPending('history')).toBe(false);
  });
});

describe('окно подписки', () => {
  it('три тарифа, срок по умолчанию — год; переключение срока меняет цену и строку оплаты', () => {
    openPlansDialog('history');
    expect(plansDialogOpen()).toBe(true);
    const root = document.getElementById('plans-dialog')!;
    expect([...root.querySelectorAll<HTMLElement>('.pl-card')].map(c => c.dataset.plan)).toEqual(['free', 'pro', 'tutor']);
    expect(root.querySelector('.pl-sub')!.textContent).toBe('История изменений доступна в подписке Pro');
    expect(root.querySelector('.pl-card-pro [data-key="history"]')!.classList.contains('is-wanted')).toBe(true);
    const year = root.querySelector<HTMLElement>('[data-period="year"]')!;
    expect(year.getAttribute('aria-checked')).toBe('true');
    expect(root.querySelector('.pl-card-pro .pl-sr')!.textContent).toBe('292 рублей в месяц');
    expect(root.querySelector('.pl-card-pro .pl-save')!.textContent).toBe('−27%');
    root.querySelector<HTMLElement>('[data-period="month"]')!.click();
    expect(root.querySelector('.pl-card-pro .pl-sr')!.textContent).toBe('399 рублей в месяц');
    expect(root.querySelector('.pl-card-tutor .pl-sr')!.textContent).toBe('699 рублей в месяц');
    // стрелка вправо — следующий срок
    root.querySelector('.pl-seg')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    expect(root.querySelector('[data-period="quarter"]')!.getAttribute('aria-checked')).toBe('true');
    // у Tutor — 14 дней бесплатно, пока пробный период не взят
    expect(root.querySelector('.pl-card-tutor .pl-cta')!.getAttribute('aria-label')).toBe('14 дней бесплатно');
    expect(root.querySelector('.pl-card-free .pl-current')!.textContent).toBe('Ваш тариф');
    // Esc закрывает
    root.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(plansDialogOpen()).toBe(false);
  });

  it('без входа купить нельзя: вместо оплаты — «Войти»', async () => {
    const api = fakeApi(() => billing());
    setApiForTests(api);
    setAccount(me('free', true), api);
    const login = vi.fn();
    setPlansDialogHooks({ openLogin: login, openPromo: () => {} });
    openPlansDialog();
    const root = document.getElementById('plans-dialog')!;
    root.querySelector<HTMLButtonElement>('.pl-card-pro .pl-cta')!.click();
    await flush();
    expect(api.calls.some(([m, p]) => m === 'POST' && p.startsWith('/api/billing/'))).toBe(false);
    const msg = root.querySelector<HTMLElement>('.pl-msg')!;
    expect(msg.hidden).toBe(false);
    expect(msg.textContent).toContain('Войдите в аккаунт');
    msg.querySelector<HTMLButtonElement>('button')!.click();
    expect(login).toHaveBeenCalled();
    expect(plansDialogOpen()).toBe(false);
  });

  it('после входа оплата идёт через сервер; тариф меняется, кнопка — «Вы на Pro»', async () => {
    const api = fakeApi((m, p, body) => {
      if (p === '/api/billing' && m === 'GET') return billing();
      if (p === '/api/billing/checkout') {
        expect(body).toEqual({ plan: 'pro', period: 'year' });
        return { billing: billing({ plan: 'pro', planExpiresAt: Date.now() + 365 * DAY_MS, trialAvailable: true }), me: me('pro') };
      }
      throw new Error(`неожиданный запрос ${m} ${p}`);
    });
    setApiForTests(api);
    setAccount(me('free'), api);
    const changes: string[] = [];
    onPlanChange(c => changes.push(c.to));
    openPlansDialog();
    const root = document.getElementById('plans-dialog')!;
    root.querySelector<HTMLButtonElement>('.pl-card-pro .pl-cta')!.click();
    await flush();
    await new Promise(r => setTimeout(r, 700));
    expect(changes).toEqual(['pro']);
    expect(root.querySelector('.pl-card-pro .pl-cta')!.classList.contains('is-done')).toBe(true);
    expect(root.querySelector('.pl-card-pro .pl-cta')!.getAttribute('aria-label')).toBe('Вы на Pro');
    expect(root.querySelector('.pl-card-pro .pl-current')!.textContent).toBe('Ваш тариф');
  });

  it('ЮKassa: ссылка на оплату оставляет тариф бесплатным, проверка подтверждённого платежа обновляет его', async () => {
    let state = billing();
    const api = fakeApi((m, p) => {
      if (p === '/api/billing' && m === 'GET') return state;
      if (p === '/api/billing/checkout') {
        state = billing({ payments: [{ id: 'pay1', plan: 'pro', period: 'year', days: 365, amount: 3499, status: 'pending', createdAt: Date.now() }] });
        return { billing: state, me: me('free'), confirmationUrl: 'https://yoomoney.ru/checkout/payments/test' };
      }
      throw new Error(`неожиданный запрос ${m} ${p}`);
    });
    api.me = async () => me('pro');
    setApiForTests(api);
    setAccount(me('free'), api);
    openPlansDialog();
    const root = document.getElementById('plans-dialog')!;
    root.querySelector<HTMLButtonElement>('.pl-card-pro .pl-cta')!.click();
    await new Promise(r => setTimeout(r, 700));
    const link = root.querySelector<HTMLAnchorElement>('.pl-msg a')!;
    expect(link.href).toBe('https://yoomoney.ru/checkout/payments/test');
    expect(link.target).toBe('_blank');
    expect(root.querySelector('.pl-card-free')!.classList.contains('is-current')).toBe(true);
    expect(root.querySelector('.pl-card-pro .pl-cta')!.classList.contains('is-done')).toBe(false);
    state = billing({ plan: 'pro', payments: [{ ...state.payments[0], status: 'paid' }] });
    root.querySelector<HTMLButtonElement>('.pl-msg button')!.click();
    await flush();
    expect(root.querySelector('.pl-card-pro .pl-current')!.textContent).toBe('Ваш тариф');
  });
});

describe('раздел «Подписка»', () => {
  it('пробный период: дни и часы, дата окончания', () => {
    const now = Date.UTC(2026, 10, 20, 12, 0);
    const s = tierSummary(billing({ plan: 'tutor', trial: true, planExpiresAt: now + 13 * DAY_MS + 5 * 3600_000 }), now);
    expect(s.title).toBe('Tutor');
    expect(s.status).toBe('Пробный период: осталось 13 дней 5 часов');
    expect(s.sub).toMatch(/^Пробный период закончится \d\d\.\d\d\.2026 в \d\d:\d\d$/);
    expect(tierSummary(billing()).status).toContain('Бесплатный тариф');
  });

  it('промокод проверяет сервер; история платежей и промокодов', async () => {
    const redeemed = billing({
      plan: 'pro', planExpiresAt: Date.now() + 30 * DAY_MS,
      promos: [{ code: 'SPRING-2026', effect: { plan: 'pro', days: 30 }, redeemedAt: Date.now() }],
      payments: [{ id: 'p1', plan: 'pro', period: 'quarter', days: 90, amount: 999, status: 'paid', createdAt: Date.now() }],
    });
    const api = fakeApi((m, p, body) => {
      if (p === '/api/billing' && m === 'GET') return billing();
      if (p === '/api/billing/promo') {
        expect(body).toEqual({ code: 'spring-2026' });
        return { effect: { plan: 'pro', days: 30 }, billing: redeemed, me: me('pro') };
      }
      throw new Error('нет');
    });
    setApiForTests(api);
    setAccount(me('free'), api);
    const host = document.createElement('div');
    document.body.appendChild(host);
    const view = renderSubscriptionSettings(host, { openLogin: () => {} });
    await flush();
    expect(host.querySelector('.sub-pay-list')!.textContent).toBe('Платежей пока нет');
    host.querySelector<HTMLInputElement>('.sub-promo-input')!.value = 'spring-2026';
    host.querySelector('form')!.dispatchEvent(new Event('submit', { cancelable: true }));
    await flush();
    await flush();
    expect(host.querySelector('.sub-promo-msg')!.textContent).toBe('Промокод применён: Pro на 30 дней');
    expect(host.querySelector('.sub-tier-name')!.textContent).toBe('Pro');
    expect(host.querySelector('.sub-promo-list')!.textContent).toContain('SPRING-2026');
    expect(host.querySelector('.sub-promo-list')!.textContent).toContain('Pro на 30 дней');
    expect(host.querySelector('.sub-pay-list')!.textContent).toContain('Pro · 3 месяца');
    expect(host.querySelector('.sub-pay-list')!.textContent).toContain('999');
    view.dispose?.();
  });

  it('без входа поле промокода закрыто, рядом — «Войти»', () => {
    const api = fakeApi(() => billing());
    setApiForTests(api);
    setAccount(me('free', true), api);
    const host = document.createElement('div');
    const login = vi.fn();
    renderSubscriptionSettings(host, { openLogin: login });
    expect(host.querySelector<HTMLInputElement>('.sub-promo-input')!.disabled).toBe(true);
    host.querySelector<HTMLButtonElement>('.sub-promo-msg button')!.click();
    expect(login).toHaveBeenCalled();
  });
});

describe('режим разработки', () => {
  it('переопределение тарифа сообщает о смене', () => {
    localStorage.setItem(DEV_MODE_KEY, '1');
    const seen: string[] = [];
    onPlanChange(c => seen.push(c.to));
    setUserPlan('pro');
    setUserPlan('tutor');
    setUserPlan('free');
    expect(seen).toEqual(['pro', 'tutor', 'free']);
  });
});
