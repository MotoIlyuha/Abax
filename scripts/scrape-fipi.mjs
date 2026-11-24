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
  const skip = 'script, style, form, input, button, select, textarea, iframe, svg, annotation, annotation-xml';

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

  return [...document.querySelectorAll('.qblock')].flatMap(block => {
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
    const needsImage = !!prompt.querySelector('img, svg, object') ||
      [...prompt.querySelectorAll('script')].some(script => /ShowPicture|document\.write/i.test(script.textContent ?? ''));
    const copy = prompt.cloneNode(true);
    copy.querySelectorAll('[data-answer], [data-solution], .qinfo, .qanswer, .qsolution, .correct-answer').forEach(el => el.remove());
    const statementMd = clean(plain(copy)).replace(/^(?:Задание\s+\d+\s*\n+)?(?:Впишите правильный ответ\.|Выберите один или несколько правильных ответов\.)\s*/i, '').trim();
    if (!statementMd) return [];
    return [{
      code, kes, exerciseNumber, statementMd, needsImage,
      answer: block.querySelector('[data-answer]')?.getAttribute('data-answer') ||
        block.querySelector('.correct-answer')?.textContent?.trim() || null,
      solutionMd: block.querySelector('[data-solution], .qsolution')?.textContent?.trim() || null,
    }];
  });
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
    help: { type: 'boolean' },
  } });
  if (values.help) {
    console.log('node scripts/scrape-fipi.mjs [--timeout 5000] [--pages 1] [--output выгрузка.json] [--review проверка.json]');
    console.log('В --review укажите byKes (тип экзамена → КЭС → номер КИМ) и tasks (тип экзамена:код → number, topic, answer, solutionMd).');
    console.log('Каталог обновляется карточками с известным номером, полным условием, ответом и решением. --output отдельно сохраняет выгрузку для проверки.');
    return;
  }
  const timeout = Number(values.timeout);
  const pages = Number(values.pages);
  if (!Number.isSafeInteger(timeout) || timeout < 1 || !Number.isSafeInteger(pages) || pages < 1) {
    throw new Error('Таймаут и число страниц должны быть положительными целыми числами.');
  }
  const output = values.output ? resolve(values.output) : null;
  if (output === CATALOG) throw new Error('Сохраните выгрузку отдельно от встроенного каталога.');
  const { byKes = {}, tasks = {} } = values.review ? JSON.parse(await readFile(values.review, 'utf8')) : {};
  const browser = await chromium.launch({ headless: true });
  const extracted = new Map();
  const complete = new Map();
  const visited = new Set();
  try {
    const context = await browser.newContext({ ignoreHTTPSErrors: true });
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
          const size = extracted.size;
          for (const card of cards) {
            const id = exam + ':' + card.code;
            const review = Object.hasOwn(tasks, id) ? tasks[id] : undefined;
            const number = taskNumber(card, review, byKes, exam, max);
            const source = new URL(link);
            source.searchParams.set('qid', card.code);
            extracted.set(id, { ...card, exam, number, url: source.href });
            const answer = review?.answer ?? card.answer;
            const solutionMd = review?.solutionMd ?? card.solutionMd;
            const statementMd = review?.statementMd ?? (card.needsImage ? null : card.statementMd);
            if (number && answer?.trim() && solutionMd?.trim() && statementMd?.trim()) {
              complete.set(id, {
                id, code: card.code, exam, number, answer, solutionMd, statementMd, url: source.href,
                topic: review?.topic ?? (card.kes ? 'КЭС ' + card.kes : 'Математика'),
              });
            }
          }
          read += extracted.size - size;
          if (extracted.size === size) break;
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
  if (output && extracted.size) await saveJson(output, [...extracted.values()]);
  if (!complete.size) {
    console.log('Нет новых карточек с полными данными. Встроенный каталог сохранён.');
    return;
  }
  const previous = JSON.parse(await readFile(CATALOG, 'utf8'));
  const all = new Map(previous.map(card => [card.id, card]));
  for (const [id, card] of complete) all.set(id, card);
  await saveJson(CATALOG, [...all.values()]);
  console.log('Проверено и сохранено карточек: ' + complete.size);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
}
