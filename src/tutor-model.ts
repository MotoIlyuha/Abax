export const tutorColors = [
  '#5277bc',
  '#9463a9',
  '#b05e78',
  '#bd7045',
  '#a98124',
  '#778446',
  '#428367',
  '#298587',
  '#3d7fa3',
  '#796ebd',
  '#b26068',
  '#8c735d',
] as const;
export const durations = [45, 60, 90, 120];
export const defaultPageTitle = 'Занятие #{n} - {date}';

export class TutorError extends Error {
  constructor(
    readonly code: string,
    readonly status = 400,
  ) {
    super(code);
  }
}
export function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TutorError('bad-form');
  return value as Record<string, unknown>;
}
export function stringField(v: unknown, max = 200): string {
  if (typeof v !== 'string' || v.length > max) throw new TutorError('bad-text');
  return v.trim();
}
export function integer(v: unknown, min: number, max: number): number {
  if (typeof v !== 'number' || !Number.isSafeInteger(v) || v < min || v > max) throw new TutorError('bad-number');
  return v;
}
export function key(v: unknown): string {
  if (typeof v !== 'string' || !/^[a-zA-Z0-9_-]{1,100}$/.test(v)) throw new TutorError('bad-id');
  return v;
}
function booleanField(value: unknown): boolean {
  if (typeof value !== 'boolean') throw new TutorError('bad-flag');
  return value;
}
export const dayMs = 86400000;
export interface ScheduleSlot {
  id: string;
  weekday: number;
  minute: number;
  duration: number;
  from: string;
  until: string;
  offset: number;
}
export function calendarDay(value: unknown): number {
  if (typeof value !== 'string' || !/^\d{4}-\d\d-\d\d$/.test(value)) throw new TutorError('bad-date');
  const time = Date.parse(value);
  if (!Number.isFinite(time) || new Date(time).toISOString().slice(0, 10) !== value) throw new TutorError('bad-date');
  return time;
}
export function readSchedule(value: unknown): ScheduleSlot[] {
  if (!Array.isArray(value) || value.length > 28) throw new TutorError('bad-schedule');
  const ids = new Set<string>();
  return value.map((item) => {
    const slot = record(item);
    const id = key(slot.id);
    const from = stringField(slot.from),
      until = stringField(slot.until);
    const span = calendarDay(until) - calendarDay(from);
    if (span < 0 || span > 731 * dayMs || ids.has(id)) throw new TutorError('bad-schedule');
    ids.add(id);
    return {
      id,
      from,
      until,
      weekday: integer(slot.weekday, 0, 6),
      minute: integer(slot.minute, 0, 1439),
      duration: integer(slot.duration, 5, 720),
      offset: integer(slot.offset, -720, 840),
    };
  });
}

export interface Student {
  id: string;
  name: string;
  grade: string;
  subject: string;
  color: string;
  price: number;
  duration_min: number;
  balance: number;
  schedule: ScheduleSlot[];
  project_id: string | null;
  invite_slug: string;
  auto_create_page: boolean;
  page_title_template: string;
  parent_name: string;
  parent_contact: string;
  student_contact: string;
  timezone_offset: number | null;
  notes: string;
  archived: boolean;
  created_at: number;
  updated_at: number;
}

export function studentForm(value: unknown, id: string, now: number, old?: Student): Student {
  const patch = record(value);
  const base: Student = old ?? {
    id,
    name: '',
    grade: '',
    subject: 'Математика',
    color: tutorColors[0],
    price: 2000,
    duration_min: 60,
    balance: 0,
    schedule: [],
    project_id: null,
    invite_slug: '',
    auto_create_page: true,
    page_title_template: defaultPageTitle,
    parent_name: '',
    parent_contact: '',
    student_contact: '',
    timezone_offset: null,
    notes: '',
    archived: false,
    created_at: now,
    updated_at: now,
  };
  const s = { ...base, updated_at: now };
  for (const field of [
    'name',
    'grade',
    'subject',
    'color',
    'parent_name',
    'parent_contact',
    'student_contact',
    'page_title_template',
    'notes',
  ] as const) {
    if (field in patch) s[field] = stringField(patch[field], field === 'notes' ? 4000 : 200);
  }
  if (!s.name || !s.subject || !s.page_title_template || !tutorColors.some((c) => c === s.color))
    throw new TutorError('bad-student');
  if ('price' in patch) s.price = integer(patch.price, 0, 10000000);
  if ('duration_min' in patch) {
    s.duration_min = integer(patch.duration_min, 45, 120);
    if (!durations.includes(s.duration_min)) throw new TutorError('bad-duration');
  }
  if ('schedule' in patch) s.schedule = readSchedule(patch.schedule);
  if ('timezone_offset' in patch)
    s.timezone_offset = patch.timezone_offset === null ? null : integer(patch.timezone_offset, -720, 840);
  if ('auto_create_page' in patch) s.auto_create_page = booleanField(patch.auto_create_page);
  if ('archived' in patch) s.archived = booleanField(patch.archived);
  if ('project_id' in patch) s.project_id = patch.project_id === null ? null : key(patch.project_id);
  if (s.project_id !== base.project_id) s.invite_slug = '';
  return s;
}

export interface TutorPayment {
  id: string;
  student_id: string;
  lesson_id: string | null;
  amount: number;
  created_at: number;
}
