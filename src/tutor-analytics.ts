import type { Lesson } from './tutor-lessons';
import type { Student } from './tutor-model';

export interface Totals {
  plan: number;
  fact: number;
  debt: number;
  count: number;
  minutes: number;
  cancelled: number;
  moved: number;
}
const totals = (): Totals => ({ plan: 0, fact: 0, debt: 0, count: 0, minutes: 0, cancelled: 0, moved: 0 });
function add(row: Totals, l: Lesson) {
  if (l.status === 'cancelled') {
    row.cancelled += l.price;
    return;
  }
  if (l.status === 'rescheduled') {
    row.moved += l.price;
    return;
  }
  row.plan += l.price;
  if (l.status === 'paid') row.fact += l.price;
  if (l.status === 'unpaid') row.debt += l.price;
  if (l.status === 'paid' || l.status === 'unpaid') {
    row.count++;
    row.minutes += l.duration_min;
  }
}
export interface ChartGroup {
  key: string;
  name: string;
  color: string;
  plan: number;
  fact: number;
}
export type Detail = 'student' | 'total' | 'subject';
export function analytics(
  students: Student[],
  lessons: Lesson[],
  from: Date,
  to: Date,
  hourly: boolean,
  detail: Detail = 'student',
) {
  let moveLoss = 0;
  const allLessons = new Map(lessons.map((l) => [l.id, l]));
  const participants = new Set<string>();
  const total = totals(),
    byStudent = new Map(students.map((s) => [s.id, { student: s, ...totals() }]));
  const bins: { from: number; to: number; label: string; groups: Map<string, ChartGroup> }[] = [];
  const step = Math.max(1, Math.ceil((+to - +from) / (86400000 * 50)));
  for (let at = +from; at < +to; ) {
    const d = new Date(at),
      end = hourly ? at + 3600000 : +new Date(d.getFullYear(), d.getMonth(), d.getDate() + step);
    bins.push({
      from: at,
      to: Math.min(end, +to),
      label: d.toLocaleString(
        'ru-RU',
        hourly ? { hour: '2-digit', minute: '2-digit' } : { day: 'numeric', month: 'short' },
      ),
      groups: new Map(),
    });
    at = end;
  }
  const subjectColors = ['#497ba4', '#9c678e', '#538662', '#b27e47', '#6872a1'];
  for (const l of lessons) {
    if (l.start_at < +from || l.start_at >= +to) continue;
    const row = byStudent.get(l.student_id);
    if (!row) continue;
    participants.add(l.student_id);
    if (l.status === 'rescheduled')
      moveLoss += Math.max(0, l.price - (allLessons.get(l.rescheduled_to_id ?? '')?.price ?? 0));
    add(total, l);
    add(row, l);
    if (l.status === 'cancelled' || l.status === 'rescheduled') continue;
    const bin = bins.find((b) => l.start_at >= b.from && l.start_at < b.to);
    if (!bin) continue;
    const s = row.student,
      key = detail === 'total' ? 'all' : detail === 'subject' ? s.subject : s.id;
    let g = bin.groups.get(key);
    if (!g) {
      const hash = Array.from(s.subject).reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 0);
      g = {
        key,
        name: detail === 'total' ? 'Всего' : detail === 'subject' ? s.subject : s.name,
        color:
          detail === 'total' ? '#487e6d' : detail === 'subject' ? subjectColors[hash % subjectColors.length] : s.color,
        plan: 0,
        fact: 0,
      };
      bin.groups.set(key, g);
    }
    g.plan += l.price;
    if (l.status === 'paid') g.fact += l.price;
  }
  return {
    total,
    bins,
    loss: total.cancelled + moveLoss,
    ranking: [...byStudent.values()]
      .filter((r) => participants.has(r.student.id))
      .sort((a, b) => b.fact - a.fact || b.plan - a.plan || a.student.name.localeCompare(b.student.name)),
  };
}
