import { collabActive, isHost, myName, noteOnline, readOnly, sendComment, sendReaction } from './collab';
import { state } from './state';

// Тонкая прослойка между интерфейсом реакций/комментариев и collab.ts: так comments-ui.ts не тянет за собой весь
// модуль комнаты и его удобно подменять в тестах.

export { noteOnline, sendComment, sendReaction };
export type { CommentRequest } from './collab';

/** Своё имя в подписи комментария: в комнате — имя участника, у автора без комнаты — «Автор». */
export function noteName(): string {
  return collabActive() ? myName() || (isHost() ? 'Автор' : 'Участник') : 'Автор';
}

/** Можно ли менять доску у себя без хаба: автор без комнаты или участник с правом правки страницы. */
export function canEditPagesNote(): boolean {
  return state.linkMode === null && !(collabActive() && readOnly());
}
