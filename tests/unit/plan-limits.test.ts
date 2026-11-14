// Лимиты тарифа в состоянии доски: страницы, черновики, тариф проекта и пользователя.
import { beforeEach, describe, expect, it } from 'vitest';
import { ENFORCE_LIMITS_KEY, PLAN_KEY, limitsEnforced, setLimitsEnforced, setUserPlan, userPlan } from '../../src/plan';
import { addDraft, addPage, blankProject, canAddPageTo, openProject, projectPlan, state } from '../../src/state';

beforeEach(() => {
  localStorage.clear();
  openProject(blankProject('Тест'));
});

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

  it('тариф проекта: свой, а без него — тариф пользователя', () => {
    expect(projectPlan({})).toBe('free');
    setUserPlan('tutor');
    expect(projectPlan({})).toBe('tutor');
    expect(projectPlan({ ownerPlan: 'free' })).toBe('free');
    expect(projectPlan({ ownerPlan: 'мусор' })).toBe('tutor');
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

  it('pro, tutor и проект pro у бесплатного пользователя — без лимита; существующие сверх лимита не трогаются', () => {
    setLimitsEnforced(true);
    state.project.ownerPlan = 'pro';
    for (let i = 0; i < 5; i++) expect(addPage()).not.toBeNull();
    state.project.ownerPlan = undefined;
    setUserPlan('tutor');
    expect(canAddPageTo(state.project)).toBe(true);
    setUserPlan('free');
    expect(state.project.pages).toHaveLength(6);
    expect(canAddPageTo(state.project)).toBe(false);
    expect(state.project.pages).toHaveLength(6);
  });
});
