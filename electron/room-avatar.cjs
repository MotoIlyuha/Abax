// Значение аватара участника для хаба Electron — зеркало src/avatar-value.ts.
// Паритет с TypeScript-версией проверяет tests/server/room-user-avatar.test.ts.

const MAX_AVATAR_EMOJI = 32;
const MAX_AVATAR_PHOTO = 60000;
const EMOJI_CHARS = /^[\p{Extended_Pictographic}\p{Emoji_Component}‍️⃣]+$/u;
const EMOJI_CORE = /[\p{Extended_Pictographic}\p{Regional_Indicator}⃣]/u;
const PHOTO = /^data:image\/(?:jpeg|png|webp);base64,[A-Za-z0-9+/]+={0,2}$/;

const isAvatarEmoji = v => typeof v === 'string' && v.length > 0 && v.length <= MAX_AVATAR_EMOJI && EMOJI_CHARS.test(v) && EMOJI_CORE.test(v);
const isAvatarPhoto = v => typeof v === 'string' && v.length <= MAX_AVATAR_PHOTO && PHOTO.test(v);

/** null или '' — буквы; смайл и фото — как есть; остальное — undefined (не принимается). */
function cleanAvatar(v) {
  if (v === null || v === '') return null;
  return isAvatarEmoji(v) || isAvatarPhoto(v) ? v : undefined;
}

/** В снимок участников: смайл как есть, фото — «photo:<версия>», буквы — null. */
function avatarKey(avatar, rev) {
  if (avatar === null) return null;
  return isAvatarPhoto(avatar) ? `photo:${rev}` : avatar;
}

module.exports = { MAX_AVATAR_EMOJI, MAX_AVATAR_PHOTO, isAvatarEmoji, isAvatarPhoto, cleanAvatar, avatarKey };
