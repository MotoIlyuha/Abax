// Раздел настроек «Подписка»: текущий тариф и его срок, остаток пробного периода (дни и часы) с датой окончания,
// история платежей, ввод промокода (проверяет сервер) и введённые промокоды с датой и тем, что они дали.
// Купить и ввести промокод можно только после входа. Данные — только textContent.

import {
  PERIOD_TITLES, PLAN_TITLES, dateText, dateTimeText, daysText, formatRub, promoEffectText, timeLeftText,
  type BillingInfo,
} from './billing';
import { ICONS } from './icons';
import { userPlan } from './plan';
import { requestUpgrade } from './pro-badge';
import { onAccountChange } from './profile-sync';
import type { SectionView } from './settings-dialog';
import { billingBlocker, billingErrorText, billingState, onBillingChange, redeemPromo, refreshBilling } from './subscription';

export interface SubscriptionSettingsOptions {
  /** «Войти»: раздел «Профиль». */
  openLogin(): void;
  /** Сразу поставить фокус в поле промокода (пришли по «Есть промокод?»). */
  focusPromo?: boolean;
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

/** Блок «Текущий тариф»: название, срок или остаток пробного периода. */
export function tierSummary(b: BillingInfo | null, now = Date.now()): { title: string; status: string; sub: string; trialLeft: string | null } {
  const plan = b?.plan ?? userPlan();
  const title = PLAN_TITLES[plan];
  if (plan === 'free') return { title, status: 'Бесплатный тариф: 3 проекта по 3 страницы', sub: '', trialLeft: null };
  const exp = b && b.plan === plan ? b.planExpiresAt : null;
  if (b?.trial && exp) {
    return { title, status: `Пробный период: осталось ${timeLeftText(exp, now)}`, sub: `Пробный период закончится ${dateTimeText(exp)}`, trialLeft: timeLeftText(exp, now) };
  }
  if (exp) return { title, status: `Действует до ${dateText(exp)}`, sub: `Осталось ${timeLeftText(exp, now)}`, trialLeft: null };
  return { title, status: 'Действует без срока', sub: '', trialLeft: null };
}

export function renderSubscriptionSettings(host: HTMLElement, o: SubscriptionSettingsOptions): SectionView {
  const box = el('div', 'ss-sub');

  // ----- текущий тариф -----
  const tier = el('div', 'ps-block sub-tier');
  const tierHead = el('div', 'sub-tier-head');
  const tierName = el('div', 'sub-tier-name');
  const tierStatus = el('div', 'sub-tier-status');
  const tierSub = el('div', 'sub-tier-sub');
  const tierText = el('div', 'sub-tier-text');
  tierText.append(tierName, tierStatus, tierSub);
  const plans = el('button', 'ob-btn ob-primary sub-plans', 'Тарифы');
  plans.type = 'button';
  plans.addEventListener('click', () => requestUpgrade(null));
  tierHead.append(tierText, plans);
  tier.append(el('div', 'ps-caption', 'Текущий тариф'), tierHead);

  // ----- промокод -----
  const promo = el('div', 'ps-block sub-promo');
  promo.appendChild(el('div', 'ps-caption', 'Промокод'));
  const form = el('form', 'sub-promo-form');
  const input = el('input', 'ob-input sub-promo-input');
  input.type = 'text';
  input.placeholder = 'Например, SPRING-2026';
  input.autocomplete = 'off';
  input.spellcheck = false;
  input.maxLength = 32;
  input.setAttribute('aria-label', 'Промокод');
  const apply = el('button', 'ob-btn sub-promo-apply', 'Применить');
  apply.type = 'submit';
  form.append(input, apply);
  const promoMsg = el('div', 'ob-msg sub-promo-msg');
  promoMsg.setAttribute('role', 'status');
  promoMsg.hidden = true;
  const sayPromo = (text: string, kind: 'error' | 'info', action?: { label: string; run: () => void }) => {
    promoMsg.textContent = '';
    promoMsg.hidden = false;
    promoMsg.dataset.kind = kind;
    promoMsg.appendChild(el('span', '', text));
    if (action) {
      const b = el('button', 'ob-btn ob-chip sub-msg-btn', action.label);
      b.type = 'button';
      b.addEventListener('click', action.run);
      promoMsg.appendChild(b);
    }
  };
  promo.append(form, promoMsg);
  let busy = false;
  /** Под полем — пояснение «войдите» (а не итог ввода кода). */
  let blockerShown = false;
  form.addEventListener('submit', e => {
    e.preventDefault();
    if (busy) return;
    const code = input.value.trim();
    if (!code) { input.focus(); return; }
    const blocker = billingBlocker();
    if (blocker === 'login-required') { sayPromo(billingErrorText(blocker), 'error', { label: 'Войти', run: o.openLogin }); return; }
    if (blocker) { sayPromo(billingErrorText(blocker), 'error'); return; }
    busy = true;
    apply.disabled = true;
    apply.textContent = 'Проверяем…';
    void redeemPromo(code).then(r => {
      busy = false;
      apply.disabled = false;
      apply.textContent = 'Применить';
      blockerShown = false;
      if (r.ok) {
        input.value = '';
        sayPromo(r.effect ? `Промокод применён: ${promoEffectText(r.effect)}` : 'Промокод применён', 'info');
      } else sayPromo(billingErrorText(r.error), 'error');
    });
  });

  // ----- история -----
  const pays = el('div', 'ps-block sub-history');
  pays.appendChild(el('div', 'ps-caption', 'История платежей'));
  const payList = el('div', 'sub-list sub-pay-list');
  pays.appendChild(payList);
  const promos = el('div', 'ps-block sub-history');
  promos.appendChild(el('div', 'ps-caption', 'Введённые промокоды'));
  const promoList = el('div', 'sub-list sub-promo-list');
  promos.appendChild(promoList);

  const row = (icon: string, main: string, detail: string, right: string): HTMLElement => {
    const r = el('div', 'sub-row');
    const i = el('span', 'sub-row-icon');
    i.setAttribute('aria-hidden', 'true');
    i.innerHTML = icon; // константа значка
    const text = el('div', 'sub-row-text');
    text.append(el('div', 'sub-row-main', main), el('div', 'sub-row-detail', detail));
    r.append(i, text, el('div', 'sub-row-right', right));
    return r;
  };

  function paint(): void {
    const b = billingState();
    const s = tierSummary(b);
    const plan = b?.plan ?? userPlan();
    tier.dataset.plan = plan;
    tierName.textContent = s.title;
    tierStatus.textContent = s.status;
    tierSub.textContent = s.sub;
    tierSub.hidden = !s.sub;
    plans.textContent = plan === 'free' ? 'Оформить подписку' : 'Тарифы';

    const blocker = billingBlocker();
    input.disabled = blocker !== null;
    apply.disabled = blocker !== null || busy;
    // без входа поле закрыто, а под ним — почему и кнопка «Войти»; вошли — пояснение убирается
    if (blocker && promoMsg.hidden) {
      sayPromo(billingErrorText(blocker), 'info', blocker === 'login-required' ? { label: 'Войти', run: o.openLogin } : undefined);
      blockerShown = true;
    } else if (!blocker && blockerShown) {
      promoMsg.hidden = true;
      blockerShown = false;
    }

    payList.textContent = '';
    const payments = b?.payments ?? [];
    if (!payments.length) payList.appendChild(el('div', 'sub-empty', blocker === 'no-cloud' ? 'Без облака платежей нет' : 'Платежей пока нет'));
    for (const p of payments) {
      const what = p.status === 'trial' ? `Пробный период ${PLAN_TITLES[p.plan]}` : `${PLAN_TITLES[p.plan]} · ${p.period ? PERIOD_TITLES[p.period] : daysText(p.days)}`;
      payList.appendChild(row(p.status === 'trial' ? ICONS.star : ICONS.card, what, dateTimeText(p.createdAt), p.status === 'trial' ? 'Бесплатно' : formatRub(p.amount)));
    }
    promoList.textContent = '';
    const used = b?.promos ?? [];
    if (!used.length) promoList.appendChild(el('div', 'sub-empty', 'Промокодов пока не было'));
    for (const r of used) promoList.appendChild(row(ICONS.ticket, r.code, dateTimeText(r.redeemedAt), promoEffectText(r.effect)));
  }

  box.append(tier, promo, pays, promos);
  host.appendChild(box);
  paint();
  if (o.focusPromo && !input.disabled) input.focus();
  const offBilling = onBillingChange(() => paint());
  const offAccount = onAccountChange(() => { paint(); void refreshBilling(); });
  // остаток пробного периода — с точностью до часа: обновляем раз в минуту
  const clock = window.setInterval(paint, 60_000);
  void refreshBilling();
  return { dispose: () => { offBilling(); offAccount(); clearInterval(clock); } };
}
