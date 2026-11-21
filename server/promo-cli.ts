import { join, resolve } from 'node:path';
import { createPromoCode, promoDefinition } from './billing';
import { openDb } from './db';

// Завести промокод: node dist-server/promo-cli.mjs <КОД> <pro|tutor> <дней> [активаций] [действует дней]

function main(): void {
  const [rawCode, plan, daysRaw, usesRaw, validRaw] = process.argv.slice(2);
  const now = Date.now();
  const valid = validRaw === undefined ? null : Number(validRaw);
  const promo = promoDefinition({
    code: rawCode, plan, days: Number(daysRaw), maxUses: usesRaw === undefined ? null : Number(usesRaw), validDays: valid,
  }, now);
  if (!promo) {
    console.error('Использование: server:promo -- <КОД> <pro|tutor> <дней> [активаций] [действует дней]');
    process.exit(2);
  }
  const { code, effect, maxUses } = promo;
  const db = openDb(join(resolve(process.env.DATA_DIR || '.data'), 'abax.db'));
  const ok = createPromoCode(db, code, effect, now, promo);
  db.close();
  if (!ok) { console.error(`Промокод ${code} уже есть`); process.exit(1); }
  console.log(`Промокод ${code}: ${effect.plan} на ${effect.days} дн.${maxUses ? `, активаций: ${maxUses}` : ''}${valid ? `, действует ${valid} дн.` : ''}`);
}

main();
