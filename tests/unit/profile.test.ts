// Профиль на устройстве: имя, курсор, право на Pro-курсоры, смешные имена и логика поля имени.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  PROFILE_KEY, cursorEntitled, getProfile, myAvatar, myCursorId, mySelectionColor, notifyProfileChanged, onProfileChange, profileName,
  resetProfileForTests, setProfile,
} from '../../src/profile';
import { DEV_MODE_KEY, PLAN_KEY, applyServerPlan, clearServerPlan } from '../../src/plan';
import { FUNNY_NAMES, nextFunnyName, randomFunnyName } from '../../src/funny-names';
import { initialChoice, pickCursor, previewLocked, resolveName, revertChoice, tabFill } from '../../src/onboarding-logic';

beforeEach(() => {
  localStorage.clear();
  clearServerPlan();
  resetProfileForTests();
  vi.unstubAllEnvs();
  vi.stubEnv('DEV', false);
});

describe('профиль', () => {
  it('по умолчанию: без имени, классический курсор, знакомство не пройдено', () => {
    expect(getProfile()).toEqual({ name: '', cursorId: 'default', avatar: null, onboarded: false, updatedAt: 0 });
    expect(profileName()).toBe('');
  });

  it('сохраняется в doska.profile, имя нормализуется, неизвестный курсор игнорируется', () => {
    setProfile({ name: '  Капи‮бара   ', cursorId: 'mint', onboarded: true });
    const saved = JSON.parse(localStorage.getItem(PROFILE_KEY)!);
    expect(saved).toMatchObject({ name: 'Капи бара', cursorId: 'mint', onboarded: true });
    setProfile({ cursorId: 'nope' });
    expect(getProfile().cursorId).toBe('mint');
    setProfile({ name: 'x'.repeat(100) });
    expect(getProfile().name).toHaveLength(32);
  });

  it('аватар: смайл и фото сохраняются, неподходящее игнорируется, null — буквы', () => {
    setProfile({ avatar: '🐼' });
    expect(getProfile().avatar).toBe('🐼');
    expect(myAvatar()).toBe('🐼');
    setProfile({ avatar: 'не смайл' });
    expect(getProfile().avatar).toBe('🐼');
    const photo = 'data:image/jpeg;base64,/9j/AAAA';
    setProfile({ avatar: photo });
    expect(JSON.parse(localStorage.getItem(PROFILE_KEY)!).avatar).toBe(photo);
    setProfile({ avatar: null });
    expect(getProfile().avatar).toBeNull();
    localStorage.setItem(PROFILE_KEY, JSON.stringify({ name: 'А', avatar: '<b>x</b>' }));
    expect(getProfile().avatar).toBeNull();
  });

  it('испорченная запись — значения по умолчанию', () => {
    localStorage.setItem(PROFILE_KEY, '{oops');
    expect(getProfile().cursorId).toBe('default');
    localStorage.setItem(PROFILE_KEY, JSON.stringify({ name: 5, cursorId: '<x>', onboarded: 'yes' }));
    expect(getProfile()).toMatchObject({ name: '5', cursorId: 'default', onboarded: false });
  });

  it('подписчики узнают об изменениях; отписка работает', () => {
    const seen: string[] = [];
    const off = onProfileChange(p => seen.push(p.cursorId));
    setProfile({ cursorId: 'coral' });
    notifyProfileChanged();
    off();
    setProfile({ cursorId: 'mint' });
    expect(seen).toEqual(['coral', 'coral']);
  });

  it('Pro-курсор действует только при праве; выбор сохраняется', () => {
    setProfile({ cursorId: 'neon' });
    expect(cursorEntitled()).toBe(false);
    expect(myCursorId()).toBe('default');
    expect(mySelectionColor()).toBe('#3273f5');
    applyServerPlan({ plan: 'pro', limitsEnforced: false });
    expect(cursorEntitled()).toBe(true);
    expect(myCursorId()).toBe('neon');
    expect(mySelectionColor()).toBe('#0c8599');
    clearServerPlan();
    expect(myCursorId()).toBe('default');
    expect(getProfile().cursorId).toBe('neon');
  });

  it('режим разработки даёт право на Pro-курсоры', () => {
    setProfile({ cursorId: 'gold' });
    localStorage.setItem(DEV_MODE_KEY, '1');
    expect(myCursorId()).toBe('gold');
    localStorage.setItem(PLAN_KEY, 'free');
    expect(cursorEntitled()).toBe(true);
  });
});

describe('смешные имена', () => {
  it('не меньше 40, уникальные, с обязательными', () => {
    expect(FUNNY_NAMES.length).toBeGreaterThanOrEqual(40);
    expect(new Set(FUNNY_NAMES).size).toBe(FUNNY_NAMES.length);
    for (const n of ['Лемур', 'Капибара', 'Аксолотль', 'Вомбат', 'Выхухоль', 'Сурикат', 'Корги', 'Пингвин', 'Енот', 'Бобёр']) {
      expect(FUNNY_NAMES).toContain(n);
    }
    expect(FUNNY_NAMES.some(n => n.includes(' '))).toBe(true);
    for (const n of FUNNY_NAMES) expect(n.length).toBeLessThanOrEqual(40);
  });

  it('случайное имя из списка', () => {
    expect(randomFunnyName(() => 0)).toBe(FUNNY_NAMES[0]);
    expect(randomFunnyName(() => 0.9999999)).toBe(FUNNY_NAMES[FUNNY_NAMES.length - 1]);
    expect(FUNNY_NAMES).toContain(randomFunnyName());
  });

  it('рандомайзер всегда даёт другое имя, чем текущее', () => {
    for (const cur of FUNNY_NAMES.slice(0, 5)) {
      for (const r of [0, 0.5, 0.9999999]) expect(nextFunnyName(cur, () => r)).not.toBe(cur);
    }
    expect(FUNNY_NAMES).toContain(nextFunnyName('Своё имя'));
  });
});

describe('поле имени и выбор курсора', () => {
  it('Tab в пустом поле подставляет подсказку; Shift+Tab и заполненное поле — штатно', () => {
    expect(tabFill('', 'Лемур', false)).toBe('Лемур');
    expect(tabFill('   ', 'Бодрый Енот', false)).toBe('Бодрый Енот');
    expect(tabFill('', 'Лемур', true)).toBeNull();
    expect(tabFill('Аня', 'Лемур', false)).toBeNull();
    expect(tabFill('', '', false)).toBeNull();
  });

  it('«Продолжить» с пустым полем — имя из подсказки', () => {
    expect(resolveName('', 'Капибара')).toBe('Капибара');
    expect(resolveName('  Аня  ', 'Капибара')).toBe('Аня');
  });

  it('примерка Pro-курсора без права не меняет сохраняемый курсор', () => {
    let c = initialChoice('mint', false);
    expect(c).toEqual({ preview: 'mint', saved: 'mint' });
    c = pickCursor(c, 'neon', false);
    expect(c).toEqual({ preview: 'neon', saved: 'mint' });
    expect(previewLocked(c)).toBe(true);
    expect(revertChoice(c)).toEqual({ preview: 'mint', saved: 'mint' });
    c = pickCursor(c, 'coral', false);
    expect(previewLocked(c)).toBe(false);
    expect(pickCursor(c, 'neon', true)).toEqual({ preview: 'neon', saved: 'neon' });
    expect(initialChoice('neon', false)).toEqual({ preview: 'neon', saved: 'default' });
  });
});
