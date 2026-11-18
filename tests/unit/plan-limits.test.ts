// Лимиты тарифа в состоянии доски: страницы, черновики, тариф проекта и пользователя.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DEV_MODE_KEY, ENFORCE_LIMITS_KEY, PLAN_KEY, SERVER_PLAN_KEY, applyServerPlan, clearServerPlan, devModeEnabled,
  devPlanForCode, limitsEnforced, setLimitsEnforced, setUserPlan, userPlan,
} from '../../src/plan';
import { addDraft, addPage, blankProject, canAddPageTo, openProject, projectPlan, state } from '../../src/state';

beforeEach(() => {
  localStorage.clear();
  clearServerPlan();
  openProject(blankProject('Тест'));
});
afterEach(() => { vi.unstubAllEnvs(); });

describe('тариф и включение лимитов', () => {
  it('по умолчанию free и лимиты выключены; значения запоминаются', () => {
    expect(userPlan()).toBe('free');
    expect(limitsEnforced()).toBe(false);
    setUserPlan('pro');
    setLimitsEnforced(true);
    expect(localStorage.getItem(PLAN_KEY)).toBe('pro');
    expect(localStorage.getItem(ENFORCE_LIMITS_KEY)).toBe('1');
    expect(userPlan()).toBe('pro');
    expect(limitsEnforced()).toBe(true);
    setLimitsEnforced(false);
    expect(localStorage.getItem(ENFORCE_LIMITS_KEY)).toBeNull();
  });

  it('мусор в хранилище — free', () => {
    localStorage.setItem(PLAN_KEY, 'platinum');
    expect(userPlan()).toBe('free');
  });

  it('тариф проекта: свой ownerPlan, а у старого проекта без него — free, что бы ни было у пользователя', () => {
    expect(projectPlan({})).toBe('free');
    setUserPlan('tutor');
    expect(userPlan()).toBe('tutor');
    expect(projectPlan({})).toBe('free');
    expect(projectPlan({ ownerPlan: 'free' })).toBe('free');
    expect(projectPlan({ ownerPlan: 'pro' })).toBe('pro');
    expect(projectPlan({ ownerPlan: 'мусор' })).toBe('free');
  });
});

describe('клавиши переключения тарифа в режиме разработки', () => {
  it('«−» (и цифровой блок) — Free, «+» (Shift+«=» и цифровой блок) — Pro; остальные клавиши — не тариф', () => {
    expect(devPlanForCode('Minus')).toBe('free');
    expect(devPlanForCode('NumpadSubtract')).toBe('free');
    expect(devPlanForCode('Equal')).toBe('pro');
    expect(devPlanForCode('NumpadAdd')).toBe('pro');
    expect(devPlanForCode('KeyA')).toBeNull();
    expect(devPlanForCode('Digit0')).toBeNull();
  });

  it('Free в режиме разработки включает лимиты, и страницы ограничены тремя', () => {
    setLimitsEnforced(false);
    // то же, что делает обработчик клавиши «−»
    setUserPlan('free');
    setLimitsEnforced(true);
    expect(userPlan()).toBe('free');
    expect(limitsEnforced()).toBe(true);
    addPage();
    addPage();
    expect(state.project.pages.length).toBe(3);
    expect(addPage()).toBeNull();
    expect(state.project.pages.length).toBe(3);
  });
});

describe('источник тарифа пользователя', () => {
  it('сервер: тариф и признак лимитов запоминаются и переживают перезагрузку страницы', () => {
    applyServerPlan({ plan: 'pro', limitsEnforced: true });
    expect(userPlan()).toBe('pro');
    expect(limitsEnforced()).toBe(true);
    expect(JSON.parse(localStorage.getItem(SERVER_PLAN_KEY)!)).toEqual({ plan: 'pro', limitsEnforced: true });
    clearServerPlan();
    expect(userPlan()).toBe('free');
    expect(limitsEnforced()).toBe(false);
  });

  it('локальный переключатель сильнее серверного только в dev-режиме', () => {
    applyServerPlan({ plan: 'free', limitsEnforced: false });
    setUserPlan('tutor');
    expect(devModeEnabled()).toBe(true); // vitest — режим разработки
    expect(userPlan()).toBe('tutor');
  });

  it('вне dev-режима doska.plan игнорируется; с doska.devMode=1 — работает', () => {
    vi.stubEnv('DEV', false);
    applyServerPlan({ plan: 'pro', limitsEnforced: false });
    setUserPlan('tutor');
    expect(devModeEnabled()).toBe(false);
    expect(userPlan()).toBe('pro');
    clearServerPlan();
    expect(userPlan()).toBe('free');
    localStorage.setItem(DEV_MODE_KEY, '1');
    expect(devModeEnabled()).toBe(true);
    expect(userPlan()).toBe('tutor');
  });

  it('мусор в серверном кэше — free', () => {
    localStorage.setItem(SERVER_PLAN_KEY, '{"plan":"vip"}');
    expect(userPlan()).toBe('free');
    localStorage.setItem(SERVER_PLAN_KEY, 'не json');
    expect(userPlan()).toBe('free');
  });

  it('лимиты действуют, если их включили локально или сервер', () => {
    expect(limitsEnforced()).toBe(false);
    applyServerPlan({ plan: 'free', limitsEnforced: true });
    expect(limitsEnforced()).toBe(true);
    applyServerPlan({ plan: 'free', limitsEnforced: false });
    expect(limitsEnforced()).toBe(false);
    setLimitsEnforced(true);
    expect(limitsEnforced()).toBe(true);
  });
});

describe('страницы', () => {
  it('пока лимиты выключены, страниц сколько угодно', () => {
    for (let i = 0; i < 6; i++) expect(addPage()).not.toBeNull();
    expect(state.project.pages).toHaveLength(7);
  });

  it('на free с лимитами — не больше трёх; отказ ничего не меняет', () => {
    setLimitsEnforced(true);
    expect(addPage()).not.toBeNull();
    expect(addPage()).not.toBeNull();
    expect(state.project.pages).toHaveLength(3);
    const project = state.project;
    const active = state.pageId;
    expect(canAddPageTo(state.project)).toBe(false);
    expect(addPage()).toBeNull();
    expect(state.project).toBe(project);
    expect(state.pageId).toBe(active);
  });

  it('черновики в лимит не входят', () => {
    setLimitsEnforced(true);
    addPage(); addPage();
    expect(addDraft()).toBeTruthy();
    expect(addDraft()).toBeTruthy();
    expect(state.drafts).toHaveLength(2);
    expect(state.project.pages).toHaveLength(3);
  });

  it('проект pro у бесплатного пользователя — без лимита; старый проект без ownerPlan — free даже у tutor; существующие сверх лимита не трогаются', () => {
    setLimitsEnforced(true);
    state.project.ownerPlan = 'pro';
    for (let i = 0; i < 5; i++) expect(addPage()).not.toBeNull();
    state.project.ownerPlan = undefined;
    setUserPlan('tutor');
    expect(canAddPageTo(state.project)).toBe(false);
    state.project.ownerPlan = 'tutor';
    expect(canAddPageTo(state.project)).toBe(true);
    state.project.ownerPlan = undefined;
    setUserPlan('free');
    expect(state.project.pages).toHaveLength(6);
    expect(canAddPageTo(state.project)).toBe(false);
    expect(state.project.pages).toHaveLength(6);
  });
});
