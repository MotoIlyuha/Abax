import { clientId } from './identity';
import { collabUsers, type CollabUser } from './collab';
import { cursorPreset, isCursorId } from './cursors';
import { myAvatar, myCursorId } from './profile';
import { state } from './state';

// Кто поставил реакцию или написал комментарий (SPEC_COMMENTS §4): по id подписи (noteId = clientId() участника) —
// имя, цвета его плашки (badgeBg/badgeText пресета курсора) и аватар. Источники по порядку: я сам; участники комнаты
// (поле noteId снимка); кого видели в этой сессии; подписи комментариев проекта; иначе — «Участник» и цвет палитры
// по хэшу id (один и тот же у всех).

export interface NotePerson {
  noteId: string;
  name: string;
  /** Фон плашки (пилюли реакции) и цвет текста на нём. */
  bg: string;
  fg: string;
  me: boolean;
  cursorId?: string;
  avatar?: string | null;
  /** Номер участника в комнате, если он сейчас на доске. */
  userId?: number;
}

/** Палитра для тех, о ком ничего не известно: яркие цвета с белым текстом (контраст ≥ 4.5:1). */
export const FALLBACK_COLORS = ['#c2255c', '#9c36b5', '#5f3dc4', '#1864ab', '#0b7285', '#087f5b', '#2b8a3e', '#d9480f', '#495057'];

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

export function fallbackColor(noteId: string): string {
  return FALLBACK_COLORS[hash(noteId) % FALLBACK_COLORS.length];
}

function presetColors(cursorId: string | undefined, color?: string): { bg: string; fg: string } | null {
  if (cursorId && isCursorId(cursorId)) {
    const p = cursorPreset(cursorId);
    return { bg: p.badgeBg, fg: p.badgeText };
  }
  if (color && /^#[0-9a-fA-F]{6}$/.test(color)) return { bg: color, fg: '#ffffff' };
  return null;
}

/** Кого видели в комнате за эту сессию: ушедший участник сохраняет свои имя и цвет. */
const seen = new Map<string, { name: string; cursorId?: string; color?: string; avatar?: string | null }>();

function fromUser(u: CollabUser): void {
  if (u.noteId) seen.set(u.noteId, { name: String(u.name ?? ''), cursorId: u.cursorId, color: u.color, avatar: u.avatar });
}

/** Имя по подписям комментариев проекта (последнее известное). */
function commentName(noteId: string): string {
  let name = '';
  for (const pg of state.project.pages) {
    for (const t of pg.comments ?? []) for (const m of t.messages) if (m.authorId === noteId && m.authorName) name = m.authorName;
  }
  return name;
}

export function notePerson(raw: string): NotePerson {
  // id приходят из файла и от хаба: не строка — всё равно чей-то «Участник»
  const noteId = typeof raw === 'string' ? raw : String(raw);
  if (noteId === clientId()) {
    const c = presetColors(myCursorId()) ?? { bg: '#2160dd', fg: '#ffffff' };
    return { noteId, name: 'Вы', ...c, me: true, cursorId: myCursorId(), avatar: myAvatar() };
  }
  const live = collabUsers().find(u => u.noteId === noteId);
  if (live) fromUser(live);
  const known = seen.get(noteId);
  if (known) {
    const c = presetColors(known.cursorId, known.color) ?? { bg: fallbackColor(noteId), fg: '#ffffff' };
    return {
      noteId, name: known.name || commentName(noteId) || 'Участник', ...c, me: false,
      ...(known.cursorId ? { cursorId: known.cursorId } : {}), avatar: known.avatar ?? null,
      ...(live ? { userId: live.userId } : {}),
    };
  }
  return { noteId, name: commentName(noteId) || 'Участник', bg: fallbackColor(noteId), fg: '#ffffff', me: false };
}

/** Подпись «кто поставил»: «Вы, Капибара и ещё 2». */
export function peopleLabel(noteIds: readonly string[], max = 3): string {
  const names = noteIds.map(id => notePerson(id).name);
  // «Вы» — первым
  const me = names.indexOf('Вы');
  if (me > 0) { names.splice(me, 1); names.unshift('Вы'); }
  if (names.length <= max) return names.join(', ');
  return `${names.slice(0, max).join(', ')} и ещё ${names.length - max}`;
}

/** Для тестов: забыть увиденных. */
export function resetNotePeople(): void {
  seen.clear();
}
