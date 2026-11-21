// Почтовые транспорты без npm-зависимостей: память, webhook, SMTP (поддельный SMTP-сервер на node:net).
import { createServer, type Server, type Socket } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { buildMime, mailerFromEnv, memoryMailer, smtpMailer, webhookMailer } from '../../server/mailer';

interface FakeSmtp { server: Server; port: number; log: string[]; data: string[] }

/** Минимальный SMTP-сервер: EHLO, AUTH PLAIN, MAIL, RCPT, DATA, QUIT. rejectAuth — отказ на AUTH. */
function fakeSmtp(opts: { rejectAuth?: boolean; rejectRcpt?: boolean } = {}): Promise<FakeSmtp> {
  const log: string[] = [];
  const data: string[] = [];
  const server = createServer((sock: Socket) => {
    let inData = false;
    let buf = '';
    let body = '';
    sock.write('220 fake.smtp ESMTP\r\n');
    sock.on('data', d => {
      buf += d.toString('utf8');
      let i: number;
      while ((i = buf.indexOf('\r\n')) >= 0) {
        const line = buf.slice(0, i);
        buf = buf.slice(i + 2);
        if (inData) {
          if (line === '.') { inData = false; data.push(body); body = ''; sock.write('250 OK queued\r\n'); } else body += `${line}\n`;
          continue;
        }
        log.push(line);
        const cmd = line.split(' ')[0].toUpperCase();
        if (cmd === 'EHLO') sock.write('250-fake.smtp\r\n250-AUTH PLAIN\r\n250 8BITMIME\r\n');
        else if (cmd === 'AUTH') sock.write(opts.rejectAuth ? '535 bad credentials\r\n' : '235 ok\r\n');
        else if (cmd === 'MAIL') sock.write('250 ok\r\n');
        else if (cmd === 'RCPT') sock.write(opts.rejectRcpt ? '550 no such user\r\n' : '250 ok\r\n');
        else if (cmd === 'DATA') { inData = true; sock.write('354 go ahead\r\n'); }
        else if (cmd === 'QUIT') { sock.write('221 bye\r\n'); sock.end(); }
        else sock.write('502 unknown\r\n');
      }
    });
  });
  return new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve({ server, port: (server.address() as { port: number }).port, log, data })));
}

const servers: Server[] = [];
afterEach(() => { for (const s of servers.splice(0)) s.close(); });

describe('почта', () => {
  it('memoryMailer копит письма', async () => {
    const m = memoryMailer();
    await m.send({ to: 'a@b.ru', subject: 'Тема', text: 'Текст' });
    expect(m.outbox).toEqual([{ to: 'a@b.ru', subject: 'Тема', text: 'Текст' }]);
  });

  it('webhookMailer шлёт JSON с токеном; ошибка сервиса - исключение', async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const ok = webhookMailer('https://mail.example/send', 'tok', (async (url: string, init: RequestInit) => { calls.push({ url, init }); return new Response('{}', { status: 200 }); }) as unknown as typeof fetch);
    await ok.send({ to: 'a@b.ru', subject: 'S', text: 'T' });
    expect(calls[0].url).toBe('https://mail.example/send');
    expect((calls[0].init.headers as Record<string, string>).Authorization).toBe('Bearer tok');
    expect(JSON.parse(String(calls[0].init.body))).toEqual({ to: 'a@b.ru', subject: 'S', text: 'T' });
    const bad = webhookMailer('https://mail.example/send', undefined, (async () => new Response('', { status: 500 })) as unknown as typeof fetch);
    await expect(bad.send({ to: 'a@b.ru', subject: 'S', text: 'T' })).rejects.toThrow('500');
  });

  it('SMTP: AUTH PLAIN, конверт и письмо в base64 с UTF-8 темой', async () => {
    const s = await fakeSmtp();
    servers.push(s.server);
    const m = smtpMailer({ host: '127.0.0.1', port: s.port, user: 'u', pass: 'p', from: 'Abax <no-reply@abax.example>' });
    await m.send({ to: 'kapi@bara.ru', subject: 'Код входа в Abax: 123456', text: 'Ваш код: 123456\n.строка с точкой' });
    expect(s.log[0]).toMatch(/^EHLO /);
    expect(s.log).toContain(`AUTH PLAIN ${Buffer.from('\0u\0p').toString('base64')}`);
    expect(s.log).toContain('MAIL FROM:<no-reply@abax.example>');
    expect(s.log).toContain('RCPT TO:<kapi@bara.ru>');
    expect(s.log.at(-1)).toBe('QUIT');
    const mail = s.data[0];
    expect(mail).toContain(`Subject: =?UTF-8?B?${Buffer.from('Код входа в Abax: 123456').toString('base64')}?=`);
    expect(mail).toContain('Content-Transfer-Encoding: base64');
    const body = mail.split('\n\n')[1].replace(/\n/g, '');
    expect(Buffer.from(body, 'base64').toString('utf8')).toBe('Ваш код: 123456\n.строка с точкой');
  });

  it('SMTP: отказ сервера - исключение с кодом', async () => {
    const s = await fakeSmtp({ rejectAuth: true });
    servers.push(s.server);
    await expect(smtpMailer({ host: '127.0.0.1', port: s.port, user: 'u', pass: 'x', from: 'a@b.ru' }).send({ to: 'c@d.ru', subject: 'S', text: 'T' })).rejects.toThrow('535');
    const r = await fakeSmtp({ rejectRcpt: true });
    servers.push(r.server);
    await expect(smtpMailer({ host: '127.0.0.1', port: r.port, from: 'a@b.ru' }).send({ to: 'c@d.ru', subject: 'S', text: 'T' })).rejects.toThrow('550');
  });

  it('SMTP: перевод строки в адресе не пропускается (подмена заголовков)', async () => {
    await expect(smtpMailer({ host: '127.0.0.1', port: 1, from: 'a@b.ru' }).send({ to: 'x@y.ru\r\nBcc: z@w.ru', subject: 'S', text: 'T' })).rejects.toThrow('перевод строки');
  });

  it('SMTP: требуется STARTTLS, а сервер его не предлагает - отказ', async () => {
    const s = await fakeSmtp();
    servers.push(s.server);
    await expect(smtpMailer({ host: '127.0.0.1', port: s.port, from: 'a@b.ru', requireTls: true }).send({ to: 'c@d.ru', subject: 'S', text: 'T' })).rejects.toThrow('STARTTLS');
  });

  it('buildMime: заголовки и base64-тело строками ≤ 76', () => {
    const mime = buildMime('a@b.ru', { to: 'c@d.ru', subject: 'Hello', text: 'x'.repeat(200) }, new Date(0));
    expect(mime).toContain('Subject: Hello');
    expect(mime).toContain('Date: Thu, 01 Jan 1970 00:00:00 GMT');
    for (const line of mime.split('\r\n\r\n')[1].split('\r\n')) expect(line.length).toBeLessThanOrEqual(76);
  });

  it('mailerFromEnv: webhook, SMTP или ничего', () => {
    expect(mailerFromEnv({})).toBeNull();
    expect(mailerFromEnv({ MAIL_WEBHOOK_URL: 'https://x' })?.kind).toBe('webhook');
    expect(mailerFromEnv({ SMTP_HOST: 'smtp.example' })?.kind).toBe('smtp');
  });
});
