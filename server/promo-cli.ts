import { join, resolve } from 'node:path';
import { DAY_MS, isPaidPlan, normalizePromoCode } from '../src/billing';
import { createPromoCode } from './billing';
import { openDb } from './db';

// Завести промокод: node dist-server/promo-cli.mjs <КОД> <pro|tutor> <дней> [активаций] [действует дней]

function main(): void {
  const [rawCode, plan, daysRaw, usesRaw, validRaw] = process.argv.slice(2);
  const code = normalizePromoCode(rawCode);
  const days = Number(daysRaw);
  if (!code || !isPaidPlan(plan) || !Number.isInteger(days) || days < 1) {
    console.error('Использование: server:promo -- <КОД> <pro|tutor> <дней> [активаций] [действует дней]');
    process.exit(2);
  }
  const maxUses = usesRaw === undefined ? null : Number(usesRaw);
  const valid = validRaw === undefined ? null : Number(validRaw);
  if ((maxUses !== null && !(maxUses >= 1)) || (valid !== null && !(valid > 0))) { console.error('Активаций и срок — положительные числа'); process.exit(2); }
  const now = Date.now();
  const db = openDb(join(resolve(process.env.DATA_DIR || '.data'), 'abax.db'));
  const ok = createPromoCode(db, code, { plan, days }, now, { maxUses, expiresAt: valid === null ? null : now + valid * DAY_MS });
  db.close();
  if (!ok) { console.error(`Промокод ${code} уже есть`); process.exit(1); }
  console.log(`Промокод ${code}: ${plan} на ${days} дн.${maxUses ? `, активаций: ${maxUses}` : ''}${valid ? `, действует ${valid} дн.` : ''}`);
}

main();
