import type { TutorStore } from './tutor-store';

export function el<K extends keyof HTMLElementTagNameMap>(tag:K, cls='', text=''): HTMLElementTagNameMap[K] {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text) n.textContent = text;
  return n;
}
export type View = 'students'|'calendar'|'income';
export interface TutorUI {
  store:TutorStore; main:HTMLElement; sheet:HTMLDialogElement;
  navigate(view:View):void; render():void; close():void; modal(title:string):HTMLElement;
  error(e:unknown):void; message(text:string):void;
  button(label:string,fn:()=>unknown,cls?:string):HTMLButtonElement;
}
export function group(cls:string,...nodes:Node[]):HTMLDivElement {
  const n = el('div',cls); n.append(...nodes); return n;
}
export const rub = (n:number) => n.toLocaleString('ru-RU',{maximumFractionDigits:0}) + ' ₽';
export const timeLabel = (n:number) => new Date(n).toLocaleTimeString('ru-RU',{ hour:'2-digit',minute:'2-digit' });
export const dayLabel = (n:number) => new Date(n).toLocaleDateString('ru-RU',{ day:'numeric',month:'long' });
export function dateInput(d:Date):string { return new Date(d.getTime()-d.getTimezoneOffset()*60000).toISOString().slice(0,10); }
export function input(value:string, type='text') { const n=el('input'); n.type=type; n.value=value; return n; }
export function select(items: [string,string][], value:string) {
  const n=el('select');
  for (const [id,name] of items) { const o=el('option','',name); o.value=id; n.append(o); }
  n.value=value;
  return n;
}
export function field(label:string,control:HTMLElement) {
  const wrap=el('label','tu-field'); wrap.append(el('span','',label),control); return wrap;
}
export function submit(ui:TutorUI, form:HTMLFormElement, label:string, fn:()=>Promise<void>) {
  const b=el('button','tu-primary',label); b.type='submit';
  form.addEventListener('submit',async e => {
    e.preventDefault(); if (b.disabled) return; b.disabled=true;
    try { await fn(); } catch (err) { ui.error(err); } finally { b.disabled=false; }
  });
  return b;
}
export function heading(title:string,action?:HTMLElement) {
  const row=group('tu-heading',el('h1','',title));
  if (action) row.append(action);
  return row;
}
export function avatar(name:string,color:string) {
  const a=el('span','tu-avatar',name.split(/\s+/).slice(0,2).map(n=>n[0]).join('').toUpperCase());
  a.style.setProperty('--student',color); return a;
}
export function empty(title:string,action?:HTMLElement) {
  const box=group('tu-empty',el('h3','',title)); if(action) box.append(action); return box;
}
export function errorText(e:unknown):string {
  const code=e && typeof e === 'object' && 'code' in e ? String(e.code) : '';
  const messages: Record<string,string>={
    'invite-needs-cloud':'Для совместной ссылки подключите облако Abax.',
    'telegram-needs-cloud':'Для входа через Telegram требуется подключение к серверу Abax.',
    'bad-telegram-signature':'Срок входа истёк. Откройте кабинет заново из Telegram.',
    'next-lesson-missing':'Сначала запланируйте следующее занятие.',
    'bad-alias':'Используйте от 12 до 23 латинских букв, цифр или дефисов.',
    'alias-taken':'Этот адрес уже занят. Выберите другой.',
    'invite-paused':'Ссылка приостановлена. Включите её в настройках доступа доски.',
    'plan-limit-pages':'Достигнут лимит страниц тарифа.', 'plan-limit-projects':'Достигнут лимит досок тарифа.',
    'settled-price':'Чтобы изменить цену, сначала отмените отметку оплаты.',
    'bad-schedule':'Проверьте дни и период расписания (до двух лет).',
    'account-changed':'Аккаунт изменился. Откройте кабинет заново.',
    'network':'Сервер недоступен. Проверьте подключение.',
  };
  return messages[code] ?? 'Не удалось выполнить действие. Проверьте данные и повторите.';
}
