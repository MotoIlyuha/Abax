import { randomBytes } from 'node:crypto';
import { connect as netConnect, type Socket } from 'node:net';
import { connect as tlsConnect, type ConnectionOptions, type TLSSocket } from 'node:tls';

// Отправка писем (коды входа по почте) без npm-зависимостей: интерфейс Mailer и транспорты —
// память (тесты), консоль (разработка), HTTP-webhook и SMTP на node:net / node:tls.

export interface MailMessage {
  to: string;
  subject: string;
  text: string;
}

export interface Mailer {
  readonly kind: 'memory' | 'console' | 'webhook' | 'smtp';
  send(msg: MailMessage): Promise<void>;
}

/** Письма копятся в outbox (тесты). */
export function memoryMailer(): Mailer & { outbox: MailMessage[] } {
  const outbox: MailMessage[] = [];
  return { kind: 'memory', outbox, async send(msg) { outbox.push({ ...msg }); } };
}

/** Письма печатаются в лог (разработка). */
export function consoleMailer(log: (m: string) => void): Mailer {
  return { kind: 'console', async send(msg) { log(`[почта] → ${msg.to}: ${msg.subject}\n${msg.text}`); } };
}

/** Письмо уходит POST-запросом JSON { to, subject, text } на адрес почтового сервиса (с Bearer-токеном, если задан). */
export function webhookMailer(url: string, token?: string, fetchImpl: typeof fetch = fetch): Mailer {
  return {
    kind: 'webhook',
    async send(msg) {
      const res = await fetchImpl(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({ to: msg.to, subject: msg.subject, text: msg.text }),
      });
      if (!res.ok) throw new Error(`почтовый webhook ответил ${res.status}`);
    },
  };
}

export interface SmtpOptions {
  host: string;
  port: number;
  /** TLS с самого начала (порт 465). Иначе — STARTTLS, если сервер его предлагает. */
  secure?: boolean;
  /** Требовать STARTTLS (по умолчанию — использовать, если предложен). */
  requireTls?: boolean;
  user?: string;
  pass?: string;
  from: string;
  /** Имя в EHLO. */
  heloName?: string;
  timeoutMs?: number;
  /** Дополнительные параметры TLS (тесты: собственный сертификат). */
  tls?: ConnectionOptions;
}

/** Ответ SMTP-сервера: код и строки (многострочный ответ собран целиком). */
interface SmtpReply { code: number; lines: string[] }

/** Читает ответы сервера построчно с одного сокета. */
class ReplyReader {
  private buf = '';
  private lines: string[] = [];
  private waiters: { resolve: (r: SmtpReply) => void; reject: (e: Error) => void }[] = [];
  private ready: SmtpReply[] = [];
  private failed: Error | null = null;
  private readonly onData = (d: Buffer) => this.feed(d.toString('utf8'));
  private readonly onErr = (e: Error) => this.fail(e);
  private readonly onClose = () => this.fail(new Error('SMTP: соединение закрыто'));

  constructor(private readonly sock: Socket | TLSSocket) {
    sock.on('data', this.onData);
    sock.on('error', this.onErr);
    sock.on('close', this.onClose);
  }

  detach(): void {
    this.sock.off('data', this.onData);
    this.sock.off('error', this.onErr);
    this.sock.off('close', this.onClose);
  }

  private feed(text: string): void {
    this.buf += text;
    let i: number;
    while ((i = this.buf.indexOf('\n')) >= 0) {
      const line = this.buf.slice(0, i).replace(/\r$/, '');
      this.buf = this.buf.slice(i + 1);
      this.lines.push(line.slice(4));
      // «250-…» — продолжение, «250 …» — последняя строка ответа
      if (line.length < 4 || line[3] !== '-') {
        const reply = { code: Number(line.slice(0, 3)) || 0, lines: this.lines };
        this.lines = [];
        const w = this.waiters.shift();
        if (w) w.resolve(reply); else this.ready.push(reply);
      }
    }
  }

  private fail(e: Error): void {
    if (this.failed) return;
    this.failed = e;
    for (const w of this.waiters.splice(0)) w.reject(e);
  }

  next(): Promise<SmtpReply> {
    const r = this.ready.shift();
    if (r) return Promise.resolve(r);
    if (this.failed) return Promise.reject(this.failed);
    return new Promise((resolve, reject) => this.waiters.push({ resolve, reject }));
  }
}

const b64 = (s: string): string => Buffer.from(s, 'utf8').toString('base64');
/** Заголовок с не-ASCII символами (RFC 2047). */
const encodeHeader = (s: string): string => (/^[\x20-\x7e]*$/.test(s) ? s : `=?UTF-8?B?${b64(s)}?=`);
const NO_CRLF = (s: string): boolean => !/[\r\n]/.test(s);

/** Письмо целиком: заголовки и тело в base64 (без проблем с 8-битными символами и точками в начале строки). */
export function buildMime(from: string, msg: MailMessage, now = new Date()): string {
  const domain = from.split('@')[1]?.replace(/[>\s]/g, '') || 'abax.local';
  const body = b64(msg.text).replace(/.{1,76}/g, '$&\r\n');
  return [
    `From: ${from}`,
    `To: ${msg.to}`,
    `Subject: ${encodeHeader(msg.subject)}`,
    `Date: ${now.toUTCString()}`,
    `Message-ID: <${randomBytes(12).toString('hex')}@${domain}>`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=UTF-8',
    'Content-Transfer-Encoding: base64',
    '',
    body,
  ].join('\r\n');
}

/** SMTP-клиент: EHLO, STARTTLS (если есть), AUTH PLAIN (если задан логин), MAIL FROM, RCPT TO, DATA, QUIT. */
export function smtpMailer(o: SmtpOptions): Mailer {
  const timeout = o.timeoutMs ?? 20_000;
  const helo = o.heloName ?? 'abax.local';
  const address = (s: string) => /<([^>]+)>/.exec(s)?.[1] ?? s;

  async function send(msg: MailMessage): Promise<void> {
    if (!NO_CRLF(msg.to) || !NO_CRLF(msg.subject) || !NO_CRLF(o.from)) throw new Error('SMTP: перевод строки в заголовке');
    let sock: Socket | TLSSocket = o.secure
      ? tlsConnect({ host: o.host, port: o.port, servername: o.host, ...o.tls })
      : netConnect(o.port, o.host);
    sock.setTimeout(timeout, () => sock.destroy(new Error('SMTP: время ожидания истекло')));
    let reader = new ReplyReader(sock);
    const write = (line: string) => { sock.write(`${line}\r\n`); };
    const expect = async (codes: number[], what: string): Promise<SmtpReply> => {
      const r = await reader.next();
      if (!codes.includes(r.code)) throw new Error(`SMTP ${what}: ${r.code} ${r.lines.join(' ')}`);
      return r;
    };
    try {
      await expect([220], 'приветствие');
      write(`EHLO ${helo}`);
      let caps = await expect([250], 'EHLO');
      if (!o.secure && caps.lines.some(l => /^STARTTLS\b/i.test(l))) {
        write('STARTTLS');
        await expect([220], 'STARTTLS');
        reader.detach();
        const plain = sock;
        sock = await new Promise<TLSSocket>((resolve, reject) => {
          const t = tlsConnect({ socket: plain as Socket, servername: o.host, ...o.tls }, () => resolve(t));
          t.once('error', reject);
        });
        sock.setTimeout(timeout, () => sock.destroy(new Error('SMTP: время ожидания истекло')));
        reader = new ReplyReader(sock);
        write(`EHLO ${helo}`);
        caps = await expect([250], 'EHLO после STARTTLS');
      } else if (!o.secure && o.requireTls) {
        throw new Error('SMTP: сервер не предлагает STARTTLS');
      }
      if (o.user) {
        write(`AUTH PLAIN ${Buffer.from(`\0${o.user}\0${o.pass ?? ''}`, 'utf8').toString('base64')}`);
        await expect([235], 'AUTH');
      }
      write(`MAIL FROM:<${address(o.from)}>`);
      await expect([250], 'MAIL FROM');
      write(`RCPT TO:<${msg.to}>`);
      await expect([250, 251], 'RCPT TO');
      write('DATA');
      await expect([354], 'DATA');
      sock.write(`${buildMime(o.from, msg)}\r\n.\r\n`);
      await expect([250], 'конец письма');
      write('QUIT');
      await reader.next().catch(() => undefined);
    } finally {
      reader.detach();
      sock.destroy();
    }
  }
  return { kind: 'smtp', send };
}

/** Почта из окружения: MAIL_WEBHOOK_URL (+ MAIL_WEBHOOK_TOKEN) или SMTP_HOST (+ SMTP_PORT, SMTP_SECURE, SMTP_USER, SMTP_PASS, SMTP_FROM). */
export function mailerFromEnv(env: NodeJS.ProcessEnv): Mailer | null {
  if (env.MAIL_WEBHOOK_URL) return webhookMailer(env.MAIL_WEBHOOK_URL, env.MAIL_WEBHOOK_TOKEN || undefined);
  if (env.SMTP_HOST) {
    const secure = env.SMTP_SECURE === '1' || env.SMTP_SECURE?.toLowerCase() === 'true';
    return smtpMailer({
      host: env.SMTP_HOST,
      port: Number(env.SMTP_PORT) || (secure ? 465 : 587),
      secure,
      user: env.SMTP_USER || undefined,
      pass: env.SMTP_PASS || undefined,
      from: env.SMTP_FROM || `Abax <no-reply@${env.SMTP_HOST}>`,
    });
  }
  return null;
}
