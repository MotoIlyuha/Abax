import { readFile, rename, rm, writeFile } from 'node:fs/promises';
import { parseArgs } from 'node:util';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CATALOG = resolve(ROOT, 'src/fipi-imported.json');
const PROJECTS = [
  ['oge', 'oge', 'DE0E276E497AB3784C3FC4CC20248DC0', 25],
  ['oge', 'oge', 'DE0E27A215EBFEAD4EC371C043E2925F', 25],
  ['ege_prof', 'ege', 'AC437B34557F88EA4115D2F374B0A07B', 19],
  ['ege_base', 'ege', 'E040A72A1A3DABA14C90C97E0B6EE7DC', 21],
];

export function readFrame() {
  const clean = text => text.replace(/[^\S\n]+/g, ' ').replace(/ *\n */g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  const skip = 'script, style, form, input, button, select, textarea, iframe, svg, object, annotation, annotation-xml';
  const excluded = '[data-answer], [data-solution], .qinfo, .qanswer, .qsolution, .correct-answer';

  function plain(node) {
    if (node.nodeType === Node.TEXT_NODE) return node.nodeValue.replace(/\s+/g, ' ');
    if (!(node instanceof Element) || node.matches(skip)) return '';
    const tag = node.localName;
    const part = index => node.children[index] ? plain(node.children[index]) : '';
    const text = () => [...node.childNodes].map(plain).join('');
    switch (tag) {
      case 'br': return '\n';
      case 'mfrac': return '(' + part(0) + ')/(' + part(1) + ')';
      case 'msqrt': return '√(' + text() + ')';
      case 'mroot': return '√[' + part(1) + '](' + part(0) + ')';
      case 'msup':
      case 'sup': return tag === 'sup' ? '^(' + text() + ')' : part(0) + '^(' + part(1) + ')';
      case 'msub':
      case 'sub': return tag === 'sub' ? '_(' + text() + ')' : part(0) + '_(' + part(1) + ')';
      case 'msubsup': return part(0) + '_(' + part(1) + ')^(' + part(2) + ')';
      case 'mfenced': return (node.getAttribute('open') ?? '(') + [...node.children].map(plain).join(', ') + (node.getAttribute('close') ?? ')');
      case 'tr': return [...node.cells].map(cell => clean(plain(cell)).replace(/\n/g, ' ')).join(' | ') + '\n';
      case 'li': return '\n• ' + text();
      case 'table':
      case 'div':
      case 'p': return '\n' + text() + '\n';
      case 'img': return node.getAttribute('alt') ?? '';
      default: return text();
    }
  }

  return [...document.querySelectorAll('.qblock')].flatMap((block, blockIndex) => {
    const id = /^q([0-9a-f]{6})$/i.exec(block.id) ??
      /^q([0-9a-f]{6})$/i.exec(block.querySelector('[id^="q"]')?.id ?? '') ??
      /Номер\s*[:№]\s*([0-9a-f]{6})\b/i.exec(block.innerText);
    if (!id) return [];
    const code = id[1].toUpperCase();
    const meta = document.getElementById('i' + id[1]) ?? document.getElementById('i' + code);
    const metadata = clean(meta?.innerText ?? '');
    const kes = /КЭС\s*[:：]\s*([\d.,; ]+)/i.exec(metadata)?.[1].trim() ?? '';
    const exerciseNumber = Number(block.getAttribute('data-task-number') ??
      /(?:Позиция в КИМ|Номер задания в КИМ)\s*[:№]?\s*(\d{1,2})/i.exec(metadata)?.[1]) || null;
    const prompt = block.querySelector('[data-statement], .qtext, .qcontent') ?? block;
    const pictures = [...block.querySelectorAll('img, svg, object')].flatMap((node, index) => {
      if (!prompt.contains(node) || node.closest(excluded) || node.parentElement.closest('svg, object')) return [];
      if (node.getBoundingClientRect().width <= 1 || node.getBoundingClientRect().height <= 1) return [];
      return [{ index, alt: (node.getAttribute('alt') ?? node.getAttribute('aria-label') ?? '').trim().slice(0, 240) }];
    });
    const needsImage = pictures.length > 0 ||
      [...prompt.querySelectorAll('script')].some(script => /ShowPicture|document\.write/i.test(script.textContent ?? ''));
    const copy = prompt.cloneNode(true);
    copy.querySelectorAll(excluded).forEach(el => el.remove());
    const statementMd = clean(plain(copy)).replace(/^(?:Задание\s+\d+\s*\n+)?(?:Впишите правильный ответ\.|Выберите один или несколько правильных ответов\.)\s*/i, '').trim();
    if (!statementMd) return [];
    return [{
      code, kes, exerciseNumber, statementMd, needsImage, pictures, blockIndex,
      answer: block.querySelector('[data-answer]')?.getAttribute('data-answer') ||
        block.querySelector('.correct-answer')?.textContent?.trim() || null,
      solutionMd: block.querySelector('[data-solution], .qsolution')?.textContent?.trim() || null,
    }];
  });
}

export async function collectIllustrations(scope, { blockIndex, pictures }, timeout) {
  const illustrations = [];
  if (pictures.length > 4) return illustrations;
  for (const { index, alt } of pictures) {
    const node = scope.locator('.qblock').nth(blockIndex).locator('img, svg, object').nth(index);
    try {
      await node.evaluate(element => {
        if (element.localName === 'img' && !element.naturalWidth) throw new Error('Рисунок не загрузился.');
      }, undefined, { timeout });
      const png = await node.screenshot({ scale: 'css', animations: 'disabled', timeout });
      const width = png.readUInt32BE(16);
      const height = png.readUInt32BE(20);
      if (width > 2048 || height > 2048 || png.length > 192 * 1024) continue;
      illustrations.push({ src: 'data:image/png;base64,' + png.toString('base64'), width, height, alt });
    } catch { /* неполные карточки помечаются для проверки */ }
  }
  return illustrations;
}

function taskNumber(card, review, byKes, exam, max) {
  const numbers = [...new Set(card.kes.split(/[;,\s]+/).map(kes => byKes[exam]?.[kes]).filter(Number.isInteger))];
  const value = review?.number ?? card.exerciseNumber ?? (numbers.length === 1 ? numbers[0] : null);
  return Number.isInteger(value) && value >= 1 && value <= max ? value : null;
}

async function saveJson(file, data) {
  const tmp = file + '.' + process.pid + '.tmp';
  try {
    await writeFile(tmp, JSON.stringify(data, null, 2) + '\n', { flag: 'wx' });
    await rename(tmp, file);
  } finally {
    await rm(tmp, { force: true });
  }
}

async function main() {
  const { values } = parseArgs({ options: {
    timeout: { type: 'string', default: '5000' },
    pages: { type: 'string', default: '1' },
    review: { type: 'string' },
    output: { type: 'string' },
    browser: { type: 'string' },
    'illustrated-only': { type: 'boolean' },
    help: { type: 'boolean' },
  } });
  if (values.help) {
    console.log('node scripts/scrape-fipi.mjs --output выгрузка.json [--pages 1] [--illustrated-only] [--browser chrome] [--review проверка.json]');
    console.log('В --review укажите byKes (тип экзамена → КЭС → номер КИМ) и tasks (тип экзамена:код → number, topic, answer, solutionMd).');
    console.log('Загрузите выгрузку через «Задания → Импорт JSON» в панели управления.');
    console.log('Выгрузка включает растровые копии рисунков. Позиций без полного набора рисунков в режиме --illustrated-only нет.');
    return;
  }
  const timeout = Number(values.timeout);
  const pages = Number(values.pages);
  if (!Number.isSafeInteger(timeout) || timeout < 1 || !Number.isSafeInteger(pages) || pages < 1) {
    throw new Error('Таймаут и число страниц должны быть положительными целыми числами.');
  }
  if (!values.output) throw new Error('Укажите --output для сохранения выгрузки.');
  const output = resolve(values.output);
  if (output === CATALOG) throw new Error('Сохраните выгрузку отдельно от встроенного каталога.');
  const { byKes = {}, tasks = {} } = values.review ? JSON.parse(await readFile(values.review, 'utf8')) : {};
  const browser = await chromium.launch({ headless: true, ...(values.browser ? { channel: values.browser } : {}) });
  const extracted = new Map();
  const seen = new Set();
  const visited = new Set();
  try {
    const context = await browser.newContext();
    const page = await context.newPage();
    for (const [exam, host, proj, max] of PROJECTS) {
      if (visited.has(exam)) continue;
      const link = new URL('https://' + host + '.fipi.ru/bank/index.php');
      link.searchParams.set('proj', proj);
      try {
        const response = await page.goto(link.href, { waitUntil: 'domcontentloaded', timeout });
        if (!response?.ok()) throw new Error('HTTP ' + response?.status());
        await page.locator('iframe[src*="questions.php"], frame[src*="questions.php"]').first().waitFor({ state: 'attached', timeout });
        const frame = page.frameLocator('iframe[src*="questions.php"], frame[src*="questions.php"]').first();
        const src = await page.locator('iframe[src*="questions.php"], frame[src*="questions.php"]').first().getAttribute('src');
        if (!src) throw new Error('Не найден адрес фрейма с заданиями.');
        const questions = new URL(src, link);
        if (questions.origin !== link.origin) throw new Error('Фрейм ведёт на другой сайт.');
        let read = 0;
        for (let index = 0; index < pages; index++) {
          if (index > 0) {
            questions.searchParams.delete('init_filter_themes');
            questions.searchParams.set('page', String(index));
            await new Promise(done => setTimeout(done, 1000));
            const next = await page.goto(questions.href, { waitUntil: 'domcontentloaded', timeout });
            if (!next?.ok()) throw new Error('HTTP ' + next?.status());
          }
          const scope = index === 0 ? frame : page;
          await scope.locator('.qblock').first().waitFor({ state: 'attached', timeout });
          const cards = await scope.locator('body').evaluate(readFrame);
          const size = seen.size;
          for (const { blockIndex, pictures, ...card } of cards) {
            const id = exam + ':' + card.code;
            if (seen.has(id)) continue;
            seen.add(id);
            if (values['illustrated-only'] && !card.needsImage) continue;
            const review = Object.hasOwn(tasks, id) ? tasks[id] : undefined;
            const number = taskNumber(card, review, byKes, exam, max);
            const source = new URL(link);
            source.searchParams.set('qid', card.code);
            const illustrations = pictures.length ? await collectIllustrations(scope, { blockIndex, pictures }, timeout) : [];
            const imagesMissing = card.needsImage && (!illustrations.length || illustrations.length !== pictures.length);
            if (values['illustrated-only'] && imagesMissing) continue;
            const topic = review?.topic ?? (card.kes ? 'КЭС ' + card.kes : 'ФИПИ #' + card.code);
            extracted.set(id, {
              ...card, exam, number, topic, url: source.href, illustrations, imagesMissing,
              answer: review?.answer ?? card.answer,
              solutionMd: review?.solutionMd ?? card.solutionMd,
              statementMd: review?.statementMd ?? card.statementMd,
            });
          }
          read += seen.size - size;
          if (seen.size === size) break;
        }
        if (read) visited.add(exam);
        console.log(exam + ': извлечено карточек — ' + read);
      } catch (error) {
        console.warn(exam + ': не удалось прочитать банк (' + error.message.split('\n')[0] + ')');
      }
    }
  } finally {
    await browser.close();
  }
  if (!extracted.size) {
    console.log('Выгрузка пуста.');
    process.exitCode = 1;
    return;
  }
  const pending = [...extracted.values()].filter(card => !card.imagesMissing);
  const missing = extracted.size - pending.length;
  if (missing) console.warn('Пропущено карточек с неполным набором рисунков: ' + missing);
  if (!pending.length) { process.exitCode = 1; return; }
  for (let from = 0; from < pending.length; from += 6) {
    const file = from === 0 ? output : output.replace(/(?:\.json)?$/i, '-' + (from / 6 + 1) + '.json');
    await saveJson(file, pending.slice(from, from + 6));
  }
  console.log('Карточек для импорта: ' + pending.length);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
}
