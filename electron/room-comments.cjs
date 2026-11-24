// Реакции и комментарии в комнате: зеркало чистых функций src/comments.ts для сервера Electron (CJS без сборки).
// Совпадение поведения проверяет tests/server/room-comments.test.ts.
const crypto = require('node:crypto');

const MAX_REACTION_LEN = 16;
const MAX_COMMENT_TEXT = 2000;
const MAX_AUTHOR_NAME = 40;
const MAX_USER_ID = 64;

const newId = () => crypto.randomUUID();
const isUserId = v => typeof v === 'string' && v.length > 0;

function cleanCommentText(raw) {
  if (typeof raw !== 'string') return null;
  const t = raw.trim();
  return t ? t.slice(0, MAX_COMMENT_TEXT) : null;
}

function cleanAuthorName(raw) {
  return typeof raw === 'string' ? Array.from(raw.replace(/\s+/g, ' ').trim()).slice(0, MAX_AUTHOR_NAME).join('') : '';
}

/** Идентификатор автора реакции или комментария из сообщения участника: короткая строка без управляющих символов. */
function cleanUserId(raw) {
  if (typeof raw !== 'string') return null;
  const s = raw.replace(/[\p{Cc}\u2028\u2029]/gu, '').trim();
  return s && s.length <= MAX_USER_ID ? s : null;
}

function toggleElementReaction(el, emoji, userId) {
  if (typeof emoji !== 'string' || emoji === '' || emoji.length > MAX_REACTION_LEN || !isUserId(userId)) return el;
  const reactions = { ...el.reactions };
  const users = reactions[emoji] || [];
  const next = users.includes(userId) ? users.filter(u => u !== userId) : [...users, userId];
  if (next.length > 0) reactions[emoji] = next;
  else delete reactions[emoji];
  const { reactions: _old, ...rest } = el;
  return Object.keys(reactions).length > 0 ? { ...rest, reactions } : rest;
}

const withComments = (page, comments) => ({ ...page, comments });

function createCommentThread(page, params) {
  const text = cleanCommentText(params.text);
  if (!text || !Number.isFinite(params.x) || !Number.isFinite(params.y) || !isUserId(params.authorId)) return page;
  if (params.targetElementId !== undefined && !page.elements.some(e => e.id === params.targetElementId)) return page;
  const thread = {
    id: params.id ?? newId(), x: params.x, y: params.y,
    ...(params.targetElementId === undefined ? {} : { targetElementId: params.targetElementId }),
    ...(params.targetElementId && validCommentOffset(params.offset) ? { offset: params.offset } : {}),
    messages: [{
      id: params.messageId ?? newId(), authorId: params.authorId, authorName: cleanAuthorName(params.authorName), text,
      createdAt: params.now ?? Date.now(),
    }],
  };
  return withComments(page, [...(page.comments || []), thread]);
}

function addCommentReply(page, threadId, msg, opts = {}) {
  const text = cleanCommentText(msg.text);
  if (!text || !isUserId(msg.authorId) || !(page.comments || []).some(t => t.id === threadId)) return page;
  const message = {
    id: opts.id ?? newId(), authorId: msg.authorId, authorName: cleanAuthorName(msg.authorName), text, createdAt: opts.now ?? Date.now(),
  };
  return withComments(page, page.comments.map(t => (t.id === threadId ? { ...t, messages: [...t.messages, message] } : t)));
}

function resolveCommentThread(page, threadId, resolved = true) {
  const thread = (page.comments || []).find(t => t.id === threadId);
  if (!thread || (thread.resolved === true) === resolved) return page;
  return withComments(page, page.comments.map(t => {
    if (t.id !== threadId) return t;
    const { resolved: _old, ...rest } = t;
    return resolved ? { ...rest, resolved: true } : rest;
  }));
}

const validCommentOffset = offset => !!offset && Number.isFinite(offset.x) && Number.isFinite(offset.y);

function moveCommentThread(page, id, x, y, offset) {
  const thread = page.comments?.find(t => t.id === id);
  if (!thread || !Number.isFinite(x) || !Number.isFinite(y)) return page;
  const next = { ...thread, x, y };
  if (thread.targetElementId && validCommentOffset(offset)) next.offset = offset;
  if (thread.x === x && thread.y === y && thread.offset?.x === next.offset?.x && thread.offset?.y === next.offset?.y) return page;
  return withComments(page, page.comments.map(t => t === thread ? next : t));
}

function deleteCommentThread(page, id) {
  const comments = page.comments?.filter(t => t.id !== id);
  if (!comments || comments.length === page.comments.length) return page;
  return withComments(page, comments);
}

module.exports = {
  moveCommentThread, deleteCommentThread,
  MAX_USER_ID, cleanUserId, toggleElementReaction, createCommentThread, addCommentReply, resolveCommentThread,
};
