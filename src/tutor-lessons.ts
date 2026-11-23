import { calendarDay, dayMs, integer, key, stringField, TutorError, type Student } from './tutor-model';

export const statusNames = {
  scheduled: 'Запланировано', current: 'Текущее', unpaid: 'Не оплачено', paid: 'Оплачено',
  rescheduled: 'Перенесено', cancelled: 'Отменено',
};
export type LessonStatus = keyof typeof statusNames;
export interface Lesson {
  id: string; student_id: string; start_at: number; duration_min: number; status: LessonStatus;
  price: number; paid_at: number | null; topic: string; homework: string; notes: string;
  board_project_id: string | null; board_page_id: string | null; schedule_slot_id: string | null;
  occurrence_at: number | null; rescheduled_to_id: string | null; created_at: number; updated_at: number;
}
export const timestamp = (v: unknown) => integer(v, 0, Date.UTC(2200, 0, 1));

export function newLesson(s: Student, id: string, at: number, now: number): Lesson {
  if (s.archived) throw new TutorError('student-archived', 409);
  return { id, student_id: s.id, start_at: timestamp(at), duration_min: s.duration_min, status: 'scheduled', price: s.price,
    paid_at: null, topic: '', homework: '', notes: '', board_project_id: null, board_page_id: null,
    schedule_slot_id: null, occurrence_at: null, rescheduled_to_id: null, created_at: now, updated_at: now };
}
export function editLesson(old: Lesson, patch: Record<string, unknown>, now: number): Lesson {
  const l = { ...old, updated_at: now };
  if ('start_at' in patch) l.start_at = timestamp(patch.start_at);
  if ('duration_min' in patch) l.duration_min = integer(patch.duration_min, 5, 720);
  if ('price' in patch) {
    l.price = integer(patch.price, 0, 10000000);
    if (old.status === 'paid' && l.price !== old.price) throw new TutorError('settled-price', 409);
  }
  for (const field of ['topic', 'homework', 'notes'] as const) {
    if (field in patch) l[field] = stringField(patch[field], field === 'topic' ? 200 : 4000);
  }
  return l;
}

/** Дата исходного вхождения сохраняется при переносе. У прошедших уроков сохраняется историческая ставка. */
export function reconcileSchedule(s: Student, existing: Lesson[], now: number): { write: Lesson[]; remove: string[] } {
  const records = new Map(existing.filter(l => l.schedule_slot_id).map(l => [l.schedule_slot_id + ':' + l.occurrence_at, l]));
  const write: Lesson[] = [];
  if (!s.archived) for (const slot of s.schedule) {
    const from = calendarDay(slot.from), end = calendarDay(slot.until);
    const first = from + (slot.weekday - new Date(from).getUTCDay() + 7) % 7 * dayMs;
    for (let day = first; day <= end; day += 7 * dayMs) {
      const at = day + (slot.minute - slot.offset) * 60000;
      const k = slot.id + ':' + day;
      const old = records.get(k);
      records.delete(k);
      if (old) {
        if (old.status === 'scheduled' && old.start_at >= now && (old.start_at !== at || old.duration_min !== slot.duration)) {
          write.push({ ...old, start_at: at, duration_min: slot.duration, updated_at: now });
        }
      } else {
        write.push({ ...newLesson(s, s.id + '.' + slot.id + '.' + day, at, now), schedule_slot_id: slot.id,
          occurrence_at: day, duration_min: slot.duration });
      }
    }
  }
  return { write, remove: [...records.values()].filter(l => l.status === 'scheduled' && l.start_at >= now).map(l => l.id) };
}

export function changeStatus(l: Lesson, status: unknown, balance: number, charged: number, now: number) {
  if (typeof status !== 'string' || !Object.hasOwn(statusNames, status) || status === 'rescheduled') throw new TutorError('bad-status');
  if (l.status === 'rescheduled') throw new TutorError('lesson-rescheduled', 409);
  let next = status as LessonStatus;
  let amount = 0;
  if (next !== l.status) {
    if (l.status === 'paid') amount = charged;
    else if ((next === 'unpaid' || next === 'paid') && balance >= l.price) {
      next = 'paid';
      amount = -l.price;
    }
  }
  return { lesson: { ...l, status: next, paid_at: next === 'paid' ? l.paid_at ?? now : null, updated_at: now }, amount };
}

export function moveLesson(l: Lesson, at: number, id: string, now: number): [Lesson, Lesson] {
  if (l.status !== 'scheduled' || at === l.start_at) throw new TutorError('cannot-reschedule', 409);
  const replacement = { ...l, id, start_at: timestamp(at), schedule_slot_id: null, occurrence_at: null, created_at: now, updated_at: now };
  return [{ ...l, status: 'rescheduled', rescheduled_to_id: id, updated_at: now }, replacement];
}
export function lessonId(v: unknown): string {
  if (typeof v === 'string' && /^[\w-]+\.[\w-]+\.\d+$/.test(v) && v.length < 225) return v;
  return key(v);
}
export function reminder(s: Student, l: Lesson, lessons: Lesson[]): string {
  const debt = lessons.filter(row => row.student_id === s.id && row.status === 'unpaid').reduce((n, row) => n + row.price, 0);
  return (s.parent_name ? s.parent_name + ', здравствуйте!' : 'Здравствуйте!') + ' Напоминаю об оплате занятия ' +
    new Date(l.start_at).toLocaleDateString('ru-RU') + ' (' + l.price + ' ₽). Общая сумма к оплате: ' + debt + ' ₽. Спасибо!';
}
