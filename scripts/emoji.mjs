// Эмодзи для выбора иконки проекта: src/emoji-data.json из emojibase-data (русские названия и теги).
// Запуск: npm run emoji.
// Берём только то, что рисуют системные шрифты (Emoji 13 и старше — Windows 10, Android 11),
// без оттенков кожи и служебных символов. По категориям, как вкладки в окне выбора:
//   s — смайлы и люди, a — животные и природа, f — еда, c — занятия и спорт,
//   t — путешествия и места, o — предметы, y — символы, g — флаги.
// Элемент — [эмодзи, «название и теги» в нижнем регистре через пробел] — по ним ищет поиск.

import { readFile, writeFile } from 'node:fs/promises';

const MAX_VERSION = 13;
/** Группы emojibase → вкладки окна выбора (2 — компоненты: тона кожи, причёски — не нужны). */
const GROUPS = { 0: 's', 1: 's', 3: 'a', 4: 'f', 6: 'c', 5: 't', 7: 'o', 8: 'y', 9: 'g' };
const ORDER = ['s', 'a', 'f', 'c', 't', 'o', 'y', 'g'];

const src = new URL('../node_modules/emojibase-data/ru/data.json', import.meta.url);
const data = JSON.parse(await readFile(src, 'utf8'));

const out = Object.fromEntries(ORDER.map(k => [k, []]));
const kept = data
  .filter(e => e.group in GROUPS && (e.version ?? Infinity) <= MAX_VERSION)
  .sort((a, b) => a.order - b.order);
for (const e of kept) {
  const words = [e.label, ...(e.tags ?? [])].join(' ').toLowerCase();
  out[GROUPS[e.group]].push([e.emoji, words]);
}

const file = new URL('../src/emoji-data.json', import.meta.url);
await writeFile(file, JSON.stringify(out) + '\n');
console.log(`emoji-data.json: ${kept.length} эмодзи`, Object.fromEntries(ORDER.map(k => [k, out[k].length])));
