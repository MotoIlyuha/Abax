// Локальный тест совместной работы: поднимает standalone-сервер, подключает
// виртуальных участников и проверяет presence, права и лимит редакторов.
// Использование: npm run collab:demo
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const require = createRequire(import.meta.url);
const { createShareServer } = require('../electron/share.cjs');

const __dirname = path.dirname(fileURLToPath(import.meta.url));
process.env.DOSKA_AWAY_MS = '1200'; // ускоряем «Отошёл» для теста

const PORT = 0; // случайный свободный порт
const results = [];
const check = (name, ok) => { results.push({ name, ok }); console.log(`${ok ? 'OK ' : 'FAIL'} ${name}`); };

const wait = ms => new Promise(r => setTimeout(r, ms));
const lastMsg = (inbox, t) => inbox.filter(m => m.t === t).pop();

function connect(url) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    const inbox = [];
    ws.onmessage = ev => { inbox.push(JSON.parse(ev.data)); };
    ws.onopen = () => resolve({ ws, inbox });
    ws.onerror = reject;
  });
}

async function waitInit(client) {
  for (let i = 0; i < 40; i++) {
    const m = client.inbox.find(x => x.t === 'init');
    if (m) return m;
    await wait(50);
  }
  throw new Error('init не получен');
}

const demoProject = {
  id: 'demo1', name: 'Демо', createdAt: 1, updatedAt: 2,
  pages: [
    { id: 'pg1', name: 'Страница 1', grid: 'square', elements: [] },
    { id: 'pg2', name: 'Страница 2', grid: 'square', elements: [] },
  ],
};

const server = await createShareServer({ port: PORT, code: 'DEMO01' });
const actualPort = server.port;
server.setDistDir(path.join(__dirname, '..', 'dist'));

try {
  // 1. host подключается и заливает проект
  const host = await connect(`ws://127.0.0.1:${actualPort}/ws?host=1&name=${encodeURIComponent('Автор')}`);
  host.ws.send(JSON.stringify({ t: 'project', project: demoProject }));
  await waitInit(host);
  await wait(100); // даём серверу обработать проект до подключения гостя
  check('host init (uid=0)', host.inbox[0].userId === 0);
  // 2. гость: default = view (openEdit выключен)
  const guest = await connect(`ws://127.0.0.1:${actualPort}/ws?name=${encodeURIComponent('Ученик')}`);
  const gInit = await waitInit(guest);
  check('гость получил проект и цвет', gInit?.project?.pages?.length === 2 && !!gInit?.color);
  // 3. presence: курсор гостя виден хосту
  guest.ws.send(JSON.stringify({ t: 'cursor', x: 111, y: 222, pageId: 'pg1' }));
  await wait(200);
  const u1 = lastMsg(host.inbox, 'users');
  const gCursor = u1?.users?.find(u => u.name === 'Ученик');
  check('курсор гостя транслируется', gCursor?.cursor?.x === 111 && gCursor?.pageId === 'pg1');

  // 4. enforcement: гость view не может менять страницу
  const hacked = JSON.parse(JSON.stringify(demoProject));
  hacked.pages[0].elements = [{ id: 'x', type: 'shape', shape: 'rect', x: 0, y: 0, w: 10, h: 10, color: '#000', width: 2 }];
  guest.ws.send(JSON.stringify({ t: 'project', project: hacked }));
  await wait(200);
  check('view-страница гостя не изменилась', server.room.project.pages[0].elements.length === 0);

  // 5. автор выдаёт edit на pg1 — теперь мутация проходит
  const r = server.setRights(gInit.userId, { pages: { pg1: 'edit' } });
  await wait(100);
  guest.ws.send(JSON.stringify({ t: 'project', project: hacked }));
  await wait(200);
  check('setRights edit разрешает мутацию', r.ok && server.room.project.pages[0].elements.length === 1);
  const hostGot = lastMsg(host.inbox, 'project');
  check('хост получил чужую правку', hostGot?.project?.pages?.[0]?.elements?.[0]?.id === 'x');

  // 6. away: гость молчит > AWAY_MS → статус «Отошёл» у остальных
  guest.inbox.length = 0;
  host.inbox.length = 0;
  // прямая проверка: ставим last=0 и вызываем users()
  const guestInfo = [...server.room.clients.values()].find(c => c.uid === gInit.userId);
  guestInfo.last = 0;
  const snap = server.users();
  const gAwayDirect = snap.find(u => u.name === 'Ученик');
  check('бездействующий гость «Отошёл»', gAwayDirect?.away === true);

  // 7. лимит редакторов: добавляем гостей с edit до превышения
  let denied = 0;
  for (let i = 0; i < 5; i++) {
    const g = await connect(`ws://127.0.0.1:${actualPort}/ws?name=${encodeURIComponent('Гость' + (i + 2))}`);
    const gi = await waitInit(g);
    const rr = server.setRights(gi.userId, { all: 'edit' });
    if (!rr.ok) denied++;
  }
  check(`5-й редактор отклонён (лимит 4)`, denied >= 1);

  // 8. раздача клиента: GET / возвращает HTML
  const html = await fetch(`http://127.0.0.1:${actualPort}/`).then(r => r.text());
  check('клиент доски раздаётся по HTTP', html.length > 1000);
} finally {
  server.close();
}

const failed = results.filter(r => !r.ok);
console.log(`\nИтог: ${results.length - failed.length}/${results.length} проверок пройдено`);
process.exit(failed.length ? 1 : 0);
