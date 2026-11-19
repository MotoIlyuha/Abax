// Значение аватара пользователя: буквы (null), смайл или фото (data:image, уже обрезанное под круг).
// Без DOM: проверяется хабом комнаты (src/room-host.ts, зеркало — electron/room.cjs), сервером (PATCH /api/me)
// и клиентом. Значения приходят от участников и не заслуживают доверия — только эти проверки.

/** Длина смайла в кодовых единицах UTF-16 (флаги, семьи и тона кожи — длинные последовательности). */
export const MAX_AVATAR_EMOJI = 32;
/** Длина фото (data URL): квадрат AVATAR_PHOTO_PX в JPEG занимает 5–15 тысяч символов — с запасом. */
export const MAX_AVATAR_PHOTO = 60_000;
/** Сторона сохраняемого фото, px: хватает аватару на экране с высокой плотностью. */
export const AVATAR_PHOTO_PX = 160;

const EMOJI_CHARS = /^[\p{Extended_Pictographic}\p{Emoji_Component}‍️⃣]+$/u;
const EMOJI_CORE = /[\p{Extended_Pictographic}\p{Regional_Indicator}⃣]/u;
const PHOTO = /^data:image\/(?:jpeg|png|webp);base64,[A-Za-z0-9+/]+={0,2}$/;
/** Ключ фото в снимке участников: номер версии, само фото приходит отдельным сообщением { t: 'avatar' }. */
export const PHOTO_KEY = /^photo:\d{1,9}$/;

/** Смайл: только символы эмодзи (без букв, пробелов и управляющих), хотя бы один настоящий. */
export function isAvatarEmoji(v: unknown): v is string {
  return typeof v === 'string' && v.length > 0 && v.length <= MAX_AVATAR_EMOJI && EMOJI_CHARS.test(v) && EMOJI_CORE.test(v);
}

/** Фото: картинка data:image (jpeg, png или webp) в base64, не длиннее MAX_AVATAR_PHOTO. */
export function isAvatarPhoto(v: unknown): v is string {
  return typeof v === 'string' && v.length <= MAX_AVATAR_PHOTO && PHOTO.test(v);
}

/**
 * Присланное значение аватара: null или пустая строка — буквы; смайл и фото — как есть;
 * всё остальное — undefined (не принимается, прежнее значение остаётся).
 */
export function cleanAvatar(v: unknown): string | null | undefined {
  if (v === null || v === '') return null;
  return isAvatarEmoji(v) || isAvatarPhoto(v) ? v : undefined;
}

/** Что уходит в снимок участников: смайл как есть, фото — «photo:<версия>», буквы — null. */
export function avatarKey(avatar: string | null, rev: number): string | null {
  if (avatar === null) return null;
  return isAvatarPhoto(avatar) ? `photo:${rev}` : avatar;
}
