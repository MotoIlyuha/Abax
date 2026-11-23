export const tutorSchema = `
CREATE TABLE tutor_students (
  id TEXT PRIMARY KEY, tutor_id TEXT NOT NULL REFERENCES users(id), name TEXT NOT NULL, grade TEXT NOT NULL,
  subject TEXT NOT NULL, color TEXT NOT NULL, price INTEGER NOT NULL, duration_min INTEGER NOT NULL,
  balance INTEGER NOT NULL CHECK(balance >= 0), schedule_json TEXT NOT NULL,
  project_id TEXT, invite_slug TEXT NOT NULL, auto_create_page INTEGER NOT NULL, page_title_template TEXT NOT NULL,
  parent_name TEXT NOT NULL, parent_contact TEXT NOT NULL, student_contact TEXT NOT NULL, timezone_offset INTEGER,
  notes TEXT NOT NULL, archived INTEGER NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
);
CREATE INDEX tutor_students_owner ON tutor_students(tutor_id);
CREATE TABLE tutor_lessons (
  id TEXT PRIMARY KEY, tutor_id TEXT NOT NULL REFERENCES users(id), student_id TEXT NOT NULL REFERENCES tutor_students(id),
  start_at INTEGER NOT NULL, duration_min INTEGER NOT NULL, status TEXT NOT NULL CHECK(status IN
  ('scheduled','current','unpaid','paid','rescheduled','cancelled')), price INTEGER NOT NULL, paid_at INTEGER,
  topic TEXT NOT NULL, homework TEXT NOT NULL, board_project_id TEXT, board_page_id TEXT,
  schedule_slot_id TEXT, occurrence_at INTEGER, rescheduled_to_id TEXT, notes TEXT NOT NULL,
  created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
  UNIQUE(student_id, schedule_slot_id, occurrence_at)
);
CREATE INDEX tutor_lessons_period ON tutor_lessons(tutor_id, start_at);
CREATE TABLE tutor_payments (
  id TEXT PRIMARY KEY, tutor_id TEXT NOT NULL REFERENCES users(id), student_id TEXT NOT NULL REFERENCES tutor_students(id),
  lesson_id TEXT REFERENCES tutor_lessons(id), amount INTEGER NOT NULL, created_at INTEGER NOT NULL
);
CREATE INDEX tutor_payments_student ON tutor_payments(student_id, created_at);
CREATE TABLE tutor_operations (
  tutor_id TEXT NOT NULL REFERENCES users(id), id TEXT NOT NULL, request TEXT NOT NULL, response TEXT NOT NULL,
  PRIMARY KEY(tutor_id,id)
);
`;
