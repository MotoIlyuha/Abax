import { join, resolve } from 'node:path';
import { isPlanTier } from '../src/limits';
import { openDb } from './db';
import { findByTelegram, setUserPlanRow } from './users';

// Выдача тарифа без платежей: node dist-server/plan-cli.mjs <userId | tg:<telegramId>> <free|pro|tutor> [дней]

function main(): void {
  const [who, plan, daysRaw] = process.argv.slice(2);
  if (!who || !isPlanTier(plan)) {
    console.error('Использование: server:plan -- <userId | tg:<id>> <free|pro|tutor> [дней]');
    process.exit(2);
  }
  const days = daysRaw === undefined ? undefined : Number(daysRaw);
  if (days !== undefined && !(days > 0)) { console.error('Срок — положительное число дней'); process.exit(2); }
  const db = openDb(join(resolve(process.env.DATA_DIR || '.data'), 'abax.db'));
  const id = who.startsWith('tg:') ? findByTelegram(db, who.slice(3))?.id : who;
  const ok = id ? setUserPlanRow(db, id, plan, Date.now(), days) : false;
  db.close();
  if (!ok) { console.error('Пользователь не найден'); process.exit(1); }
  console.log(`Тариф ${plan}${days ? ` на ${days} дн.` : ' бессрочно'} назначен: ${id}`);
}

main();
