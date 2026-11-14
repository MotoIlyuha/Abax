// Задания (Abax Tutor) в комнате: проверка ответа, маскировка для ученика, защита чужого ввода.
// Зеркало чистых функций src/task-element.ts для сервера Electron (CJS без сборки); совпадение поведения
// проверяют тесты tests/server/room-tasks.test.ts на общем наборе случаев.

const MAX_ATTEMPTS = 100;
const MAX_DRAFT = 1000;

function normalizeAnswer(raw) {
  return String(raw)
    .toLowerCase()
    .replace(/\s+/g, '')
    .replace(/,/g, '.')
    .replace(/[\u2212\u2013\u2014]/g, '-')
    .replace(/ё/g, 'е');
}

const NUMBER_RE = /^[+-]?(\d+(\.\d*)?|\.\d+)$/;

function withoutUnit(input, unit) {
  const u = unit ? normalizeAnswer(unit) : '';
  return u && input.length > u.length && input.endsWith(u) ? input.slice(0, input.length - u.length) : input;
}

function answersMatch(correct, input, unit) {
  const given = withoutUnit(normalizeAnswer(input), unit);
  if (given === '') return false;
  for (const variant of String(correct).split('|')) {
    const want = withoutUnit(normalizeAnswer(variant), unit);
    if (want === '') continue;
    if (want === given) return true;
    if (NUMBER_RE.test(want) && NUMBER_RE.test(given) && Number(want) === Number(given)) return true;
  }
  return false;
}

const capAttempts = list => (list.length > MAX_ATTEMPTS ? list.slice(list.length - MAX_ATTEMPTS) : list);

function submitTaskAttempt(el, rawInput, now = Date.now()) {
  const value = String(rawInput).trim().slice(0, MAX_DRAFT);
  if (value === '') return { updated: el, isCorrect: false };
  const isCorrect = answersMatch(el.answer, value, el.answerUnit);
  const attempts = capAttempts([...(el.attempts || []), { value, timestamp: now, isCorrect }]);
  return { updated: { ...el, attempts }, isCorrect };
}

function updateStudentDraft(el, draft) {
  const next = String(draft).slice(0, MAX_DRAFT);
  if ((el.studentDraft ?? '') === next) return el;
  const { studentDraft: _old, ...rest } = el;
  return next === '' ? rest : { ...rest, studentDraft: next };
}

/** Задание для ученика: без ответа и (пока автор не открыл) без решения. */
function projectTaskForGuest(el) {
  const { solutionMd, ...rest } = el;
  return { ...rest, answer: '', ...(solutionMd !== undefined && el.solutionVisibleToStudent ? { solutionMd } : {}) };
}

const attemptKey = a => `${a.timestamp}\u0000${a.value}`;

function mergeGuestTask(hostEl, guestEl) {
  let out = hostEl;
  if (typeof guestEl.studentDraft === 'string') out = updateStudentDraft(out, guestEl.studentDraft);
  const known = new Set((hostEl.attempts || []).map(attemptKey));
  const fresh = (guestEl.attempts || []).filter(a => !known.has(attemptKey(a)) && typeof a.value === 'string' && a.value.trim() !== '');
  if (fresh.length > 0) {
    const added = fresh.map(a => ({
      value: a.value.slice(0, MAX_DRAFT), timestamp: a.timestamp, isCorrect: answersMatch(hostEl.answer, a.value, hostEl.answerUnit),
    }));
    out = { ...out, attempts: capAttempts([...(hostEl.attempts || []), ...added]) };
  }
  return out;
}

function mergeHostTask(known, incoming) {
  if (known.studentDraft === incoming.studentDraft && known.attempts === incoming.attempts) return incoming;
  const { studentDraft: _d, attempts: _a, ...rest } = incoming;
  return {
    ...rest,
    ...(known.attempts ? { attempts: known.attempts } : {}),
    ...(known.studentDraft !== undefined ? { studentDraft: known.studentDraft } : {}),
  };
}

const isTask = el => !!el && el.type === 'task';

module.exports = {
  MAX_ATTEMPTS, MAX_DRAFT, normalizeAnswer, answersMatch, submitTaskAttempt, updateStudentDraft,
  projectTaskForGuest, mergeGuestTask, mergeHostTask, isTask,
};
