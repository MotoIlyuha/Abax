import { BANK_EXAMS, filterBankTasks, type BankExam } from '../src/fipi-bank';
import imported from '../src/fipi-imported.json';
import { catalogSearchText } from '../shared/task-catalog';
import type { Db } from './db';

function createCatalogTasks(db: Db, table: 'catalog_tasks' | 'catalog_tasks_v14'): void {
  db.exec(`
    CREATE TABLE ${table} (
      id TEXT PRIMARY KEY, subject_id TEXT NOT NULL REFERENCES catalog_subjects(id) ON DELETE RESTRICT,
      exam TEXT NOT NULL, number INTEGER CHECK (number BETWEEN 1 AND 999), topic TEXT NOT NULL, statement TEXT NOT NULL, answer TEXT NOT NULL,
      solution TEXT NOT NULL, code TEXT NOT NULL, source_url TEXT NOT NULL, published INTEGER NOT NULL,
      illustrations TEXT NOT NULL, search_text TEXT NOT NULL
    );
  `);
}

function indexCatalogTasks(db: Db): void {
  db.exec(`
    CREATE INDEX idx_catalog_task_filters ON catalog_tasks(subject_id, exam, published, number);
    CREATE UNIQUE INDEX idx_catalog_task_source ON catalog_tasks(exam, source_url, code) WHERE code <> '' AND source_url <> '';
  `);
}

export function migrateTaskCatalog(db: Db): void {
  db.exec(`
    CREATE TABLE catalog_subjects (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, board_subject TEXT NOT NULL, name_key TEXT NOT NULL UNIQUE
    );
  `);
  createCatalogTasks(db, 'catalog_tasks');
  indexCatalogTasks(db);
  db.prepare("INSERT INTO catalog_subjects VALUES ('math', 'Математика', 'math', 'математика')").run();
  const insertTask = db.prepare(`INSERT INTO catalog_tasks
    (id, subject_id, exam, number, topic, statement, answer, solution, code, source_url, published, illustrations, search_text)
    VALUES (?, 'math', ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`);
  const sources = new Map(imported.map(task => [task.id, task.url]));
  for (const exam of Object.keys(BANK_EXAMS) as BankExam[]) {
    for (const task of filterBankTasks({ exam, subject: 'math' })) {
      insertTask.run(task.id, task.exam, task.number, task.topic, task.statementMd, task.answer, task.solutionMd,
        task.code ?? '', sources.get(task.id) ?? '', '[]', catalogSearchText([task.code, task.topic, task.statementMd, task.code ? 'ФИПИ' : 'Тренировка'].join(' ')));
    }
  }
  // ОГЭ 2026, демоверсия, задание 15. Схема перерисована по условию.
  const topic = 'Синус острого угла в прямоугольном треугольнике';
  const statement = 'В прямоугольном треугольнике ABC гипотенуза AB равна 21, угол C прямой и sin B = 3/7. Найдите AC.';
  const source = 'https://vpr-ege.ru/z6/oge26-ma-demo.pdf#page=12';
  const images = [{ src: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAANwAAACGAQAAAACeNNm9AAAB3ElEQVR42u2XPW7CQBCFn00koihSqkh0+CgcgdKlj8ANwlFSUrigTElHmShCVooU7oJwhOwAiYGYSYEB/8y+IhWKso0lf9p96zezO2NLYByJDTL+4bnBxCGw0WPLdn6pmeIJgOhjHLclNsHmYiyxYdnMgwNYempu5tfLlik158DUuNsBsq4JyhA3oQluRsSEiDnkEyhDAncjAr9YVCYMugRm3nFn9ZGIyJuIHrKApYlLoHgwa66FaM5YavoEHlxXYR5oHUbsOPgMDgnMRgSu2BEMGHQJPAVaMT7Jn6rxAbsTXgiUEGbNVIhmxO4hn8BCoOuwEOg6jNjd985gj8CsU81ExXXVhIBdxi6B5UBXNAuSdc1PVgAeCJR7Aiuul2HEio5PYCXQZViXLMAtK3SvDHYJrLteMD4pp37Z+IBVXpdAVRLFe9SkOWfVfkCg4voJKq6fYMQ6DJ9AXTKHO1USF/uCeV15bTXT48xJdc5deFrWJf2Q7noOV30CA9ZmuQSKR+C2T+CMtXY+gQbX9wm20143TX1CMSqWnFdP/aGDdQdA9dQexuJRYhsNfebSAWzEOpymgI0rw25agA30yW6f2ae0DWQK2Bjp56R1STS/Q8CGE6rwtseC+bf+In8Af1yqVl61B3gAAAAASUVORK5CYII=', width: 220, height: 134, alt: 'Треугольник ABC с прямым углом C' }];
  insertTask.run(
    'demo:oge:2026:15', 'oge', 15, topic, statement, '9',
    'Синус угла B равен AC / AB. Значит, AC = 21 × 3/7 = 9.', 'ОГЭ-2026-15', source,
    JSON.stringify(images), catalogSearchText('ОГЭ-2026-15 демоверсия ФИПИ ' + topic + ' ' + statement));
}

/** В ранней схеме V13 задание ссылалось на раздел, а в выпущенной V13 — на предмет. */
export function migrateCatalogTaskSubjects(db: Db): void {
  const columns = db.pragma('table_info(catalog_tasks)') as { name: string }[];
  if (!columns.some(column => column.name === 'section_id')) return;

  createCatalogTasks(db, 'catalog_tasks_v14');
  db.exec(`
    INSERT INTO catalog_tasks_v14
      (id, subject_id, exam, number, topic, statement, answer, solution, code, source_url, published, illustrations, search_text)
    SELECT t.id, s.subject_id, t.exam, t.number, t.topic, t.statement, t.answer, t.solution, t.code, t.source_url,
      t.published, t.illustrations, t.search_text
    FROM catalog_tasks t LEFT JOIN catalog_sections s ON s.id = t.section_id;

    DROP TABLE catalog_tasks;
    ALTER TABLE catalog_tasks_v14 RENAME TO catalog_tasks;
    DROP TABLE catalog_sections;
  `);
  indexCatalogTasks(db);
}
