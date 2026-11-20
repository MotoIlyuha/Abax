// Уведомления о чужих комментариях и реакциях (SPEC_COMMENTS §6): комната прислала комментарии страницы или правку
// элементов (событие doska:collab-notes из src/collab.ts, до применения у себя) — новое от других участников
// становится уведомлением вида comment: аватар участника, эмодзи на нём, «Перейти» (к объекту) и «Посмотреть»
// (панель ЧКУ, вкладка «Комментарии», карточка подсвечивается; то же — щелчок по уведомлению).
// Своё и загрузка проекта уведомлений не дают. Тексты участников — только textContent (центр уведомлений).

import { NOTES_EVENT, type CollabNotesDetail } from './collab';
import { addedComments, addedReactions, elementLabel } from './discussion';
import { pushNotice, type NoticeInput } from './notify-center';
import { notePerson } from './note-people';
import { clientId } from './identity';
import { state } from './state';
import type { Element } from './types';
import { showBoardObjects } from './chat-attach-view';
import { openSidePanel } from './side-panel';
import { revealCommentCard } from './notify-panel';
import { DEFAULT_CURSOR_ID } from './cursors';

/** Длина текста комментария в уведомлении. */
export const NOTICE_TEXT_MAX = 140;

function shorten(text: string, max = NOTICE_TEXT_MAX): string {
  const t = text.replace(/\s+/g, ' ').trim();
  const chars = Array.from(t);
  return chars.length > max ? `${chars.slice(0, max - 1).join('')}…` : t;
}

/** Общие поля уведомления о комментарии или реакции участника noteId к объекту. */
function base(noteId: string, fallbackName: string, ref: { pageId: string; elId?: string; threadId?: string }): Pick<NoticeInput, 'kind' | 'title' | 'user' | 'ref' | 'action' | 'actions' | 'onClick'> {
  const who = notePerson(noteId);
  const name = fallbackName || who.name;
  const view = (): void => {
    revealCommentCard(ref);
    openSidePanel('notify');
  };
  return {
    kind: 'comment',
    title: name,
    user: { ...(who.userId !== undefined ? { userId: who.userId } : {}), name, cursorId: who.cursorId ?? DEFAULT_CURSOR_ID, avatar: who.avatar ?? null },
    ref,
    action: { label: 'Перейти', run: () => { void showBoardObjects({ pageId: ref.pageId, ids: ref.elId ? [ref.elId] : [] }); } },
    actions: [{ label: 'Посмотреть', run: view }],
    onClick: view,
  };
}

/** Где объект: подпись и страница, если она не текущая. */
function where(pageId: string, el: Element | undefined): string {
  const page = state.project.pages.find(p => p.id === pageId);
  const label = elementLabel(el);
  return page && pageId !== state.pageId ? `${label} на странице «${page.name}»` : label;
}

/** Новые чужие сообщения в комментариях страницы. */
export function noticeComments(d: Extract<CollabNotesDetail, { kind: 'comments' }>): number {
  const me = clientId();
  const page = state.project.pages.find(p => p.id === d.pageId);
  let n = 0;
  for (const { thread, message } of addedComments(d.prev, d.next)) {
    if (message.authorId === me) continue;
    const el = thread.targetElementId ? page?.elements.find(e => e.id === thread.targetElementId) : undefined;
    const ref = el ? { pageId: d.pageId, elId: el.id } : { pageId: d.pageId, threadId: thread.id };
    pushNotice({
      ...base(message.authorId, message.authorName, ref),
      body: `${el ? where(d.pageId, el) : 'Комментарий на доске'}: ${shorten(message.text)}`,
      emoji: '💬',
      ts: message.createdAt,
    });
    n++;
  }
  return n;
}

/** Новые чужие реакции в присланных элементах: одно уведомление на участника и объект. */
export function noticeReactions(d: Extract<CollabNotesDetail, { kind: 'elements' }>): number {
  const me = clientId();
  const prev = new Map<string, Element>();
  const next = new Map<string, Element>();
  const want = new Set(d.ids);
  for (const e of d.prev) if (want.has(e.id)) prev.set(e.id, e);
  for (const e of d.next) if (want.has(e.id)) next.set(e.id, e);
  let n = 0;
  for (const id of want) {
    const byUser = new Map<string, string[]>();
    for (const r of addedReactions(prev.get(id), next.get(id))) {
      if (r.userId === me) continue;
      byUser.set(r.userId, [...(byUser.get(r.userId) ?? []), r.emoji]);
    }
    for (const [userId, emojis] of byUser) {
      pushNotice({
        ...base(userId, '', { pageId: d.pageId, elId: id }),
        body: `реакция ${emojis.join(' ')} · ${where(d.pageId, next.get(id))}`,
        emoji: emojis[0],
      });
      n++;
    }
  }
  return n;
}

let inited = false;

export function initNoteNotices(): void {
  if (inited) return;
  inited = true;
  document.addEventListener(NOTES_EVENT, e => {
    const d = (e as CustomEvent<CollabNotesDetail>).detail;
    if (d.kind === 'comments') noticeComments(d);
    else noticeReactions(d);
  });
}
