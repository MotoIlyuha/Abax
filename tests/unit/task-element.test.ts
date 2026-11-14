import { describe, expect, it } from 'vitest';
import {
  answersMatch, createTaskElement, mergeGuestTask, normalizeAnswer, projectTaskForRole, submitTaskAttempt, taskStatus,
  toggleTaskHardFlag, updateStudentDraft,
} from '../../src/task-element';
import { parseProject, sanitizeElement, serializeProject } from '../../src/file';
import { applyBoardPatch } from '../../src/delta';
import { createRoomHub, type RoomSocket } from '../../src/room-host';
import { elementAABB, hitTest, scaleElement, applyHandle, elementHandles } from '../../src/geom';
import { renderScene } from '../../src/renderer';
import { blankProject } from '../../src/state';
import type { Element, TaskEl } from '../../src/types';

const task = (extra: Partial<TaskEl> = {}): TaskEl =>
  createTaskElement({ x: 10, y: 20, taskId: 'oge-1', statementMd: 'Найдите значение выражения 1/4 + 0,5.', answer: '0,75', id: 't1', ...extra });

describe('createTaskElement', () => {
  it('значения по умолчанию', () => {
    const t = createTaskElement({ x: 1, y: 2, taskId: 'a', statementMd: 'Условие', answer: '5' });
    expect(t).toMatchObject({ type: 'task', x: 1, y: 2, w: 360, h: 220, examType: 'custom', topic: '', subject: 'math', answer: '5' });
    expect(t.id).toBeTruthy();
    expect(t).not.toHaveProperty('attempts');
  });

  it('переданные параметры сохраняются, включая физику и информатику', () => {
    const t = task({
      examType: 'ege_prof', topic: 'Кинематика', subject: 'physics', answerUnit: 'м/с', w: 500, h: 300,
      codeSnippet: { lang: 'python', code: 'print(1)' }, solutionMd: 'Решение',
    });
    expect(t).toMatchObject({ id: 't1', examType: 'ege_prof', subject: 'physics', answerUnit: 'м/с', w: 500, h: 300 });
    expect(t.codeSnippet).toEqual({ lang: 'python', code: 'print(1)' });
  });
});

describe('проверка ответа', () => {
  it('«0,25» и «0.25» — один ответ; пробелы, знак и регистр не важны', () => {
    expect(normalizeAnswer('  0,25 ')).toBe('0.25');
    expect(answersMatch('0.25', '0,25')).toBe(true);
    expect(answersMatch('0,25', '0.25')).toBe(true);
    expect(answersMatch('0,25', ' 0 , 25')).toBe(true);
    expect(answersMatch('0.25', '0.250')).toBe(true);
    expect(answersMatch('-3', '\u22123')).toBe(true);
    expect(answersMatch('-3', '–3')).toBe(true);
    expect(answersMatch('Ёлка', 'елка')).toBe(true);
    expect(answersMatch('0.25', '0.26')).toBe(false);
    expect(answersMatch('0.25', '')).toBe(false);
    expect(answersMatch('', '')).toBe(false);
  });

  it('несколько допустимых ответов через «|»', () => {
    expect(answersMatch('2|-2', '-2')).toBe(true);
    expect(answersMatch('2|-2', '2')).toBe(true);
    expect(answersMatch('2|-2', '3')).toBe(false);
  });

  it('единицы измерения в конце ответа не мешают', () => {
    expect(answersMatch('15', '15 м/с', 'м/с')).toBe(true);
    expect(answersMatch('15 м/с', '15', 'м/с')).toBe(true);
    expect(answersMatch('15', '15 км/ч', 'м/с')).toBe(false);
  });

  it('код: строки сравниваются точно после нормализации', () => {
    expect(answersMatch('YES', 'yes')).toBe(true);
    expect(answersMatch('1/4', '1/4')).toBe(true);
    expect(answersMatch('1/4', '0.25')).toBe(false);
  });
});

describe('попытки и черновик', () => {
  it('верная и неверная попытки пишутся в attempts', () => {
    const t0 = task({ answer: '0,25' });
    const wrong = submitTaskAttempt(t0, ' 0,3 ', 100);
    expect(wrong.isCorrect).toBe(false);
    expect(wrong.updated.attempts).toEqual([{ value: '0,3', timestamp: 100, isCorrect: false }]);
    expect(taskStatus(wrong.updated)).toBe('unsolved');
    const right = submitTaskAttempt(wrong.updated, '0.25', 200);
    expect(right.isCorrect).toBe(true);
    expect(right.updated.attempts).toHaveLength(2);
    expect(right.updated.attempts![1]).toEqual({ value: '0.25', timestamp: 200, isCorrect: true });
    expect(taskStatus(right.updated)).toBe('solved');
    expect(taskStatus(t0)).toBe('none');
    expect(t0.attempts).toBeUndefined(); // исходное задание не менялось
  });

  it('пустой ввод попытку не создаёт', () => {
    const t0 = task();
    const r = submitTaskAttempt(t0, '   ');
    expect(r.updated).toBe(t0);
    expect(r.isCorrect).toBe(false);
  });

  it('попыток не больше 100: старые отбрасываются', () => {
    let t = task();
    for (let i = 0; i < 120; i++) t = submitTaskAttempt(t, String(i), i).updated;
    expect(t.attempts).toHaveLength(100);
    expect(t.attempts![0].value).toBe('20');
  });

  it('время по умолчанию — текущее', () => {
    const before = Date.now();
    const t = submitTaskAttempt(task(), '1').updated.attempts![0].timestamp;
    expect(t).toBeGreaterThanOrEqual(before);
  });

  it('черновик обновляется в реальном времени и очищается', () => {
    const t0 = task();
    const t1 = updateStudentDraft(t0, '0,');
    expect(t1.studentDraft).toBe('0,');
    expect(t0.studentDraft).toBeUndefined();
    expect(updateStudentDraft(t1, '0,')).toBe(t1);
    expect(updateStudentDraft(t1, '')).not.toHaveProperty('studentDraft');
    expect(updateStudentDraft(t0, '')).toBe(t0);
    expect(updateStudentDraft(t0, 'я'.repeat(5000)).studentDraft).toHaveLength(1000);
  });

  it('флаг «Сложное» переключается туда и обратно', () => {
    const t0 = task();
    const hard = toggleTaskHardFlag(t0);
    expect(hard.markedHard).toBe(true);
    expect(toggleTaskHardFlag(hard)).not.toHaveProperty('markedHard');
    expect(t0).not.toHaveProperty('markedHard');
  });
});

describe('защита от списывания: projectTaskForRole', () => {
  const full = task({ answer: '0,75', solutionMd: 'Сложить дроби', studentDraft: '0,7', attempts: [{ value: '1', timestamp: 1, isCorrect: false }], markedHard: true });

  it('ученик не получает ответ и закрытое решение', () => {
    const s = projectTaskForRole(full, 'guest');
    expect(s.answer).toBe('');
    expect(s).not.toHaveProperty('solutionMd');
    expect(JSON.stringify(s)).not.toContain('0,75');
    expect(JSON.stringify(s)).not.toContain('Сложить');
    // остальное — как есть
    expect(s).toMatchObject({ id: 't1', statementMd: full.statementMd, studentDraft: '0,7', markedHard: true });
    expect(s.attempts).toEqual(full.attempts);
    expect(full.answer).toBe('0,75'); // исходное не менялось
  });

  it('решение показывается, если автор его открыл — но ответ всё равно скрыт', () => {
    const s = projectTaskForRole({ ...full, solutionVisibleToStudent: true }, 'guest');
    expect(s.solutionMd).toBe('Сложить дроби');
    expect(s.answer).toBe('');
  });

  it('автору — без изменений', () => {
    expect(projectTaskForRole(full, 'host')).toBe(full);
  });

  it('повторная проекция ничего не меняет', () => {
    const once = projectTaskForRole(full, 'guest');
    expect(projectTaskForRole(once, 'guest')).toEqual(once);
  });
});

describe('mergeGuestTask: от ученика принимается только ввод', () => {
  const host = task({ answer: '5', solutionMd: 'секрет', markedHard: true });

  it('черновик и новые попытки принимаются, оценивает автор', () => {
    const forged: TaskEl = {
      ...projectTaskForRole(host, 'guest'), answer: '7', solutionMd: 'подмена', markedHard: false, x: 999, statementMd: 'подмена',
      studentDraft: '5', attempts: [{ value: '5', timestamp: 10, isCorrect: false }, { value: '9', timestamp: 11, isCorrect: true }],
    };
    const merged = mergeGuestTask(host, forged);
    expect(merged).toMatchObject({ answer: '5', solutionMd: 'секрет', markedHard: true, x: 10, statementMd: host.statementMd, studentDraft: '5' });
    // «isCorrect» ученика не принимается: верно только то, что совпало с ответом автора
    expect(merged.attempts).toEqual([
      { value: '5', timestamp: 10, isCorrect: true },
      { value: '9', timestamp: 11, isCorrect: false },
    ]);
  });

  it('старые попытки нельзя стереть или переписать, повтор не удваивается', () => {
    const base = submitTaskAttempt(host, '5', 10).updated;
    const wiped: TaskEl = { ...base, attempts: [] };
    expect(mergeGuestTask(base, wiped)).toBe(base);
    const rewritten: TaskEl = { ...base, attempts: [{ value: '5', timestamp: 10, isCorrect: false }] };
    expect(mergeGuestTask(base, rewritten).attempts).toEqual(base.attempts);
  });

  it('без изменений — тот же объект; чужая правка страницы не стирает черновик', () => {
    const withDraft = updateStudentDraft(host, '12');
    expect(mergeGuestTask(withDraft, withDraft)).toBe(withDraft);
    const { studentDraft: _d, ...noDraft } = withDraft;
    expect(mergeGuestTask(withDraft, noDraft as TaskEl).studentDraft).toBe('12');
    expect(mergeGuestTask(withDraft, { ...withDraft, studentDraft: '' })).not.toHaveProperty('studentDraft');
  });
});

describe('геометрия', () => {
  const t = task();
  it('габариты и попадание', () => {
    expect(elementAABB(t)).toEqual({ x0: 10, y0: 20, x1: 370, y1: 240 });
    expect(hitTest(t, 100, 100, 0)).toBe(true);
    expect(hitTest(t, 5, 100, 0)).toBe(false);
    expect(hitTest(t, 5, 100, 6)).toBe(true);
    expect(hitTest(t, 100, 300, 6)).toBe(false);
  });

  it('масштабирование и ручки изменения размера', () => {
    const bb = elementAABB(t);
    const scaled = scaleElement(t, bb, { x0: 0, y0: 0, x1: 720, y1: 440 }) as TaskEl;
    expect(scaled).toMatchObject({ x: 0, y: 0, w: 720, h: 440 });
    const handles = elementHandles(t, 1);
    expect(handles).toHaveLength(8); // без поворота
    expect(handles.some(h => h.h.kind === 'rotate')).toBe(false);
    const grown = applyHandle(t, { kind: 'resize', dx: 1, dy: 1 }, { x: 600, y: 500, p: 0.5 }) as TaskEl;
    expect(grown.w).toBeGreaterThan(t.w);
    const tiny = applyHandle(t, { kind: 'resize', dx: 1, dy: 1 }, { x: 0, y: 0, p: 0.5 }) as TaskEl;
    expect(tiny.w).toBeGreaterThanOrEqual(220);
    expect(tiny.h).toBeGreaterThanOrEqual(140);
  });
});

describe('сохранение и загрузка через file.ts', () => {
  const full: TaskEl = {
    ...task({
      examType: 'ege_prof', topic: 'Механика', subject: 'physics', answerUnit: 'кДж', solutionMd: 'решение', solutionVisibleToStudent: true,
      markedHard: true, studentDraft: '12', codeSnippet: { lang: 'cpp', code: 'int main(){}' },
    }),
    attempts: [{ value: '12', timestamp: 5, isCorrect: true }],
    reactions: { '👍': ['u1'] },
  };

  it('все поля задания переживают круг сохранения', () => {
    const project = { ...blankProject('П'), pages: [{ id: 'g', name: 'С', grid: 'square' as const, elements: [full as Element] }] };
    const back = parseProject(JSON.parse(serializeProject(project)))!;
    expect(back.pages[0].elements[0]).toEqual(full);
  });

  it('предмет по умолчанию не навязывается, неверные поля отбрасываются, задание не теряется', () => {
    const minimal = { id: 'a', type: 'task', x: 0, y: 0, w: 300, h: 200, taskId: 'x', statementMd: 'у', answer: '1' };
    const out = sanitizeElement({ ...minimal, examType: 'ЕГЭ', topic: 5, subject: 'химия', answerUnit: 5, codeSnippet: { lang: 'rust', code: '' }, markedHard: 'да' })!;
    expect(out).toMatchObject({ examType: 'custom', topic: '' });
    for (const k of ['subject', 'answerUnit', 'codeSnippet', 'markedHard']) expect(out).not.toHaveProperty(k);
  });

  it('попытки очищаются и ограничиваются', () => {
    const base = { id: 'a', type: 'task', x: 0, y: 0, w: 300, h: 200, taskId: 'x', statementMd: 'у', answer: '1', examType: 'oge', topic: '' };
    const attempts = [
      { value: '1', timestamp: 1, isCorrect: true }, { value: 5, timestamp: 1, isCorrect: true }, { value: 'x', timestamp: NaN, isCorrect: true }, 'мусор',
    ];
    expect((sanitizeElement({ ...base, attempts }) as TaskEl).attempts).toEqual([{ value: '1', timestamp: 1, isCorrect: true }]);
    expect(sanitizeElement({ ...base, attempts: ['мусор'] })).not.toHaveProperty('attempts');
    const many = Array.from({ length: 300 }, (_, i) => ({ value: String(i), timestamp: i, isCorrect: false }));
    expect((sanitizeElement({ ...base, attempts: many }) as TaskEl).attempts).toHaveLength(100);
  });

  it('без обязательных полей — отбрасывается', () => {
    expect(sanitizeElement({ id: 'a', type: 'task', x: 0, y: 0, w: 1, h: 1, taskId: 'x', answer: '1' })).toBeNull(); // нет условия
    expect(sanitizeElement({ id: 'a', type: 'task', x: 0, w: 1, h: 1, taskId: 'x', statementMd: '', answer: '' })).toBeNull();
  });
});

describe('рисование на холсте', () => {
  /** Контекст, который запоминает выведенный текст. */
  function recorder(): { ctx: CanvasRenderingContext2D; texts: string[] } {
    const texts: string[] = [];
    const base: Record<string, unknown> = {
      font: '10px sans-serif',
      measureText(text: string) { return { width: text.length * 7 }; },
      fillText(text: string) { texts.push(text); },
    };
    const ctx = new Proxy(base, {
      get: (t, k) => (k in t ? t[k as string] : () => undefined),
      set: (t, k, v) => { t[k as string] = v; return true; },
    }) as unknown as CanvasRenderingContext2D;
    return { ctx, texts };
  }
  const draw = (el: TaskEl) => {
    const r = recorder();
    renderScene(r.ctx, [el as Element], { x: 0, y: 0, zoom: 1 }, 800, 600, 1, 'none');
    return r.texts;
  };

  it('карточка показывает экзамен, тему, условие и статус, но не ответ и не решение', () => {
    const texts = draw(task({ answer: 'СЕКРЕТНЫЙ-ОТВЕТ', solutionMd: 'СЕКРЕТНОЕ-РЕШЕНИЕ', examType: 'oge', topic: 'Дроби', markedHard: true }));
    expect(texts).toContain('ОГЭ');
    expect(texts).toContain('Дроби');
    expect(texts).toContain('Сложное');
    expect(texts).toContain('Нет ответа');
    expect(texts.join(' ')).toContain('Найдите');
    expect(texts.join('\n')).not.toContain('СЕКРЕТН');
  });

  it('статусы и ввод ученика', () => {
    expect(draw(submitTaskAttempt(task(), '0,75', 1).updated)).toContain('Решено');
    expect(draw(submitTaskAttempt(task(), '1', 1).updated)).toContain('Не решено');
    const typing = draw(updateStudentDraft(task({ answerUnit: 'м' }), '0,7'));
    expect(typing).toContain('Ответ: 0,7 м');
    expect(draw(task())).not.toContain('Сложное');
  });
});

describe('комната: ответы не доходят до учеников', () => {
  class Sock implements RoomSocket {
    readyState = 1;
    sent: Record<string, any>[] = [];
    private h: { message: ((raw: any) => void)[]; close: (() => void)[] } = { message: [], close: [] };
    send(text: string) { this.sent.push(JSON.parse(text)); }
    close() { this.readyState = 3; this.h.close.forEach(f => f()); }
    on(ev: 'message' | 'close', fn: any) { this.h[ev].push(fn); }
    recv(m: unknown) { this.h.message.forEach(f => f(JSON.stringify(m))); }
    last(t: string) { return [...this.sent].reverse().find(m => m.t === t); }
  }
  const secret = task({ answer: 'СЕКРЕТ', solutionMd: 'РЕШЕНИЕ' });
  const project = () => ({
    ...blankProject('П'), id: 'proj', ownerPlan: 'pro' as const,
    pages: [{ id: 'pg', name: 'С', grid: 'square' as const, elements: [secret as Element] }],
  });

  function setup() {
    const hub = createRoomHub({ code: 'R' });
    const host = new Sock();
    hub.attach(host, { isHost: true, patches: true });
    host.recv({ t: 'project', project: project() });
    const student = new Sock();
    const uid = hub.attach(student, { name: 'Ученик', patches: true })!;
    return { hub, host, student, uid };
  }

  it('init, проект и права не содержат ответа', () => {
    const { hub, student, uid } = setup();
    expect(JSON.stringify(student.last('init'))).not.toContain('СЕКРЕТ');
    expect(JSON.stringify(student.last('init'))).not.toContain('РЕШЕНИЕ');
    expect(student.last('init')!.project.pages[0].elements[0].answer).toBe('');
    hub.setRights(uid, { default: 'edit' });
    expect(JSON.stringify(student.sent)).not.toContain('СЕКРЕТ');
    expect(hub.room.project!.pages[0].elements[0]).toMatchObject({ answer: 'СЕКРЕТ' }); // у автора — настоящий
  });

  it('автор правит задание — ученик получает патч без ответа', () => {
    const { hub, host, student } = setup();
    host.recv({ t: 'patch', pageId: 'pg', rev: 0, ops: [{ op: 'put', el: { ...secret, topic: 'Новая тема' } }] });
    const patch = student.last('patch')!;
    expect(patch.ops[0].el.topic).toBe('Новая тема');
    expect(patch.ops[0].el.answer).toBe('');
    expect(JSON.stringify(patch)).not.toContain('СЕКРЕТ');
    hub.pushPatch({ t: 'patch', pageId: 'pg', rev: 0, ops: [{ op: 'put', el: { ...secret, markedHard: true } }] });
    expect(JSON.stringify(student.sent)).not.toContain('СЕКРЕТ');
    // полный проект тоже
    host.recv({ t: 'project', project: { ...project(), name: 'Новое имя' } });
    expect(JSON.stringify(student.last('project'))).not.toContain('СЕКРЕТ');
  });

  it('ученик с edit не может подменить ответ патчем или проектом, но его попытки автор оценивает по своему ответу', () => {
    const { hub, student, uid, host } = setup();
    hub.setRights(uid, { default: 'edit' });
    const forged = { ...secret, answer: '42', solutionMd: 'подмена', markedHard: true, x: 500, studentDraft: 'СЕКРЕТ', attempts: [{ value: 'СЕКРЕТ', timestamp: 1, isCorrect: false }, { value: '42', timestamp: 2, isCorrect: true }] };
    student.recv({ t: 'patch', pageId: 'pg', rev: 0, ops: [{ op: 'put', el: forged }] });
    let stored = hub.room.project!.pages[0].elements[0] as TaskEl;
    expect(stored).toMatchObject({ answer: 'СЕКРЕТ', solutionMd: 'РЕШЕНИЕ', x: 10, studentDraft: 'СЕКРЕТ' });
    expect(stored.attempts).toEqual([{ value: 'СЕКРЕТ', timestamp: 1, isCorrect: true }, { value: '42', timestamp: 2, isCorrect: false }]);
    expect(host.last('patch')!.ops[0].el.answer).toBe('СЕКРЕТ'); // автору — как есть

    const p = project();
    p.pages[0].elements = [{ ...secret, answer: '42', attempts: [{ value: 'x', timestamp: 9, isCorrect: true }] } as Element];
    student.recv({ t: 'project', project: p });
    stored = hub.room.project!.pages[0].elements[0] as TaskEl;
    expect(stored.answer).toBe('СЕКРЕТ');
    expect(stored.attempts!.at(-1)).toEqual({ value: 'x', timestamp: 9, isCorrect: false });
  });

  it('патч, применённый к странице, сохраняет задание целым', () => {
    const page = applyBoardPatch(project().pages[0], { t: 'patch', pageId: 'pg', rev: 1, ops: [{ op: 'put', el: { ...secret, topic: 'Т' } }] });
    expect(page.elements[0]).toMatchObject({ type: 'task', topic: 'Т', answer: 'СЕКРЕТ' });
  });
});
