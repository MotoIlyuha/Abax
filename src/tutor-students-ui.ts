import { defaultPageTitle, durations, tutorColors, type ScheduleSlot, type Student } from './tutor-model';
import { avatar, dateInput, dayLabel, el, empty, field, group, heading, input, rub, select, submit, type TutorUI } from './tutor-ui';
import { uid } from './tutor-local';
import { appHref } from './tutor-launch';

const weekdays = ['Воскресенье','Понедельник','Вторник','Среда','Четверг','Пятница','Суббота'];
const colors = ['Синий','Сиреневый','Розовый','Терракотовый','Золотистый','Оливковый','Зелёный','Бирюзовый','Лазурный','Фиолетовый','Коралловый','Каштановый'];
const subjects = ['Математика','Физика','Информатика','Другое'];

export function studentsView(ui:TutorUI, archived=false) {
  const add=()=>studentEditor(ui);
  ui.main.append(heading('Ученики',ui.button('Добавить ученика',add,'tu-primary')));
  const search=input('','search'); search.placeholder='Найти по имени или предмету'; search.setAttribute('aria-label','Поиск учеников');
  const tabs=group('tu-segments');
  for (const [text,value] of [['Активные',false],['Архив',true]] as const) {
    const btn=ui.button(text,()=>{ ui.main.replaceChildren();studentsView(ui,value); }); btn.setAttribute('aria-pressed',String(archived===value)); tabs.append(btn);
  }
  const list=group('tu-students');
  function filter() {
    list.replaceChildren();
    const rows=ui.store.book.students.filter(s=>s.archived===archived && (s.name+' '+s.subject).toLocaleLowerCase().includes(search.value.toLocaleLowerCase()))
      .sort((a,b)=>a.name.localeCompare(b.name,'ru'));
    for(const s of rows) {
      const c=ui.button('',()=>studentCard(ui,s.id),'tu-student');
      c.append(avatar(s.name,s.color),group('tu-cardtext',el('strong','',s.name),el('small','',[s.subject,s.grade].filter(Boolean).join(' · '))),
        group('tu-cardrate',el('strong','',rub(s.price)),el('small','',s.duration_min+' мин')));
      list.append(c);
    }
    if (!rows.length) list.append(empty(search.value?'Совпадений нет':archived?'Архив пуст':'Добавьте первого ученика',archived||search.value?undefined:ui.button('Создать карточку',add)));
  }
  search.addEventListener('input',filter); filter();
  ui.main.append(group('tu-toolbar',tabs,search),list);
}

export async function studentEditor(ui:TutorUI,s?:Student) {
  const pane=ui.modal(s?'Редактирование ученика':'Новый ученик');
  const form=el('form','tu-form');
  const name=input(s?.name??''); name.required=true; name.maxLength=200;
  const grade=input(s?.grade??''); grade.placeholder='Например, 9 класс · ОГЭ';
  const subject=select(subjects.map(v=>[v,v]),s && !subjects.includes(s.subject)?'Другое':s?.subject??subjects[0]);
  const custom=input(s && !subjects.includes(s.subject)?s.subject:'');
  const customWrap=field('Название предмета',custom);
  const showCustom=()=>{customWrap.hidden=subject.value!=='Другое'; custom.required=!customWrap.hidden;};
  subject.onchange=showCustom;showCustom();
  const price=input(String(s?.price??2000),'number'); price.min='0';price.max='10000000';price.required=true;
  const duration=select(durations.map(n=>[String(n),n+' мин']),String(s?.duration_min??60));
  const chips=group('tu-colors'); let color=s?.color??tutorColors[ui.store.book.students.length%12];
  tutorColors.forEach((v,i)=>{
    const b=ui.button('',()=>{color=v;for(const c of chips.children)c.setAttribute('aria-pressed',String(c===b));},'tu-color');
    b.title=colors[i];b.setAttribute('aria-label',colors[i]);b.setAttribute('aria-pressed',String(v===color));b.style.setProperty('--student',v);chips.append(b);
  });
  const parent=input(s?.parent_name??''),pcontact=input(s?.parent_contact??''),contact=input(s?.student_contact??'');
  const offset=input(s?.timezone_offset!=null?String(s.timezone_offset/60):'','number');offset.step='0.25';offset.min='-12';offset.max='14';offset.placeholder='Как у репетитора';
  const notes=el('textarea');notes.value=s?.notes??'';
  const auto=input('','checkbox');auto.checked=s?.auto_create_page??true;
  const template=input(s?.page_title_template??defaultPageTitle);template.required=true;
  const boards=select([['','Создать при первом занятии']], ''); if(s?.project_id) boards.add(new Option('Закреплённая доска',s.project_id,true,true));
  const sections=(summary:string,...children:HTMLElement[])=>{const d=el('details','tu-details');d.append(el('summary','',summary),group('tu-form',...children));return d;};
  const schedule=group('tu-slots');
  const getters=new Map<HTMLElement,()=>ScheduleSlot>();
  const addSlot=(slot?:ScheduleSlot)=>{
    const d=new Date(), end=new Date(d);end.setMonth(end.getMonth()+3);
    const weekday=select(weekdays.map((w,i)=>[String(i),w]),String(slot?.weekday??d.getDay()));
    const minute=slot?.minute??1020; const clock=input(String(Math.floor(minute/60)).padStart(2,'0')+':'+String(minute%60).padStart(2,'0'),'time');
    const len=input(String(slot?.duration??duration.value),'number'); len.min='5';len.max='720';
    const from=input(slot?.from??dateInput(d),'date'),until=input(slot?.until??dateInput(end),'date');
    for (const n of [clock,len,from,until]) n.required=true;
    const row=group('tu-slot',field('День недели',weekday),field('Начало',clock),field('Минут',len),field('С даты',from),field('По дату',until));
    row.append(ui.button('Убрать слот',()=>{getters.delete(row);row.remove();}));
    schedule.append(row);const id=slot?.id??uid();
    getters.set(row,()=>{const [h,m]=clock.value.split(':').map(Number);return {id,weekday:+weekday.value,minute:h*60+m,duration:+len.value,from:from.value,until:until.value,offset:slot?.offset??-new Date(from.value+'T12:00').getTimezoneOffset()};});
  };
  for(const slot of s?.schedule??[])addSlot(slot);
  form.append(field('Имя ученика',name),field('Класс, курс или цель',grade),field('Предмет',subject),customWrap,field('Цвет ученика',chips),
    group('tu-pair',field('Цена занятия, ₽',price),field('Длительность',duration)),
    sections('Регулярный график',schedule,ui.button('Добавить слот',()=>addSlot())),
    sections('Контакты и заметки',field('Контакт ученика',contact),field('Имя родителя',parent),field('Контакт родителя',pcontact),field('Часовой пояс ученика, UTC',offset),field('Заметки',notes)),
    sections('Доска и страницы',field('Доска ученика',boards),field('Новое занятие - новая страница',auto),field('Шаблон названия страницы',template),el('small','','{date} · {n} · {student} · {subject} · {weekday} · {topic}')));
  form.append(submit(ui,form,'Сохранить',async()=>{
    await ui.store.act(s?'editStudent':'student',s?.id??'',{name:name.value,grade:grade.value,subject:subject.value==='Другое'?custom.value:subject.value,
      color,price:+price.value,duration_min:+duration.value,schedule:[...getters.values()].map(fn=>fn()),student_contact:contact.value,parent_name:parent.value,
      parent_contact:pcontact.value,notes:notes.value,timezone_offset:offset.value?+offset.value*60:null,auto_create_page:auto.checked,page_title_template:template.value,
      project_id:boards.value||null});
    ui.close();ui.render();
  }));
  pane.append(form);name.focus();
  const projects=await ui.store.projects(); const selected=boards.value;
  for(const p of projects){const opt=Array.from(boards.options).find(o=>o.value===p.id);if(opt)opt.textContent=p.name;else boards.add(new Option(p.name,p.id));}
  boards.value=selected;
}

export async function studentCard(ui:TutorUI,id:string,tab='Карточка') {
  const s=ui.store.book.students.find(v=>v.id===id)!;
  const pane=ui.modal(s.name), tabs=group('tu-segments');
  for(const v of ['Карточка','Прогресс','Платежи']) {const b=ui.button(v,()=>studentCard(ui,id,v));b.setAttribute('aria-pressed',String(tab===v));tabs.append(b);}
  pane.append(tabs);
  if(tab==='Прогресс'){
    const p=await ui.store.progress(id);
    pane.append(el('h3','','Решено '+p.solved+' из '+p.total),el('h4','','Сложные задания'));
    if(!p.difficult.length)pane.append(el('p','tu-muted','Заданий для повторения пока нет.'));
    for(const t of p.difficult)pane.append(group('tu-review',el('strong','',t.topic||'Задание'),el('p','',t.statement),el('small','','Неверных попыток: '+t.wrong),
      ui.button('Добавить в следующий урок',async()=>{await ui.store.act('review',id,{sourcePage:t.pageId,elementId:t.elementId});ui.message('Задание добавлено в следующий урок');})));
    return;
  }
  const debt=ui.store.book.lessons.filter(l=>l.student_id===id && l.status==='unpaid').reduce((a,l)=>a+l.price,0);
  pane.append(group('tu-cardfacts',field('Баланс',el('strong','',rub(s.balance))),field('Долг',el('strong','',rub(debt)))));
  if(tab==='Платежи'){
    const form=el('form','tu-form'), amount=input('','number');amount.required=true;amount.min='1';amount.max='10000000';
    form.append(field('Сумма пополнения, ₽',amount),submit(ui,form,'Пополнить баланс',async()=>{await ui.store.act('balance',id,{amount:+amount.value});await studentCard(ui,id,tab);ui.render();}));
    pane.append(form,el('h3','','История операций'));
    const pay=ui.store.book.payments.filter(p=>p.student_id===id).sort((a,b)=>b.created_at-a.created_at);
    if(!pay.length)pane.append(el('p','tu-muted','Операций пока нет.'));
    for(const p of pay)pane.append(group('tu-line',el('span','',dayLabel(p.created_at)),el('strong','',(p.amount>0?'+':'')+rub(p.amount))));
    return;
  }
  pane.append(group('tu-line',avatar(s.name,s.color),el('strong','',[s.subject,s.grade].filter(Boolean).join(' · ')),el('span','',rub(s.price)+' / '+s.duration_min+' мин')));
  for(const [label,value] of [['Контакт ученика',s.student_contact],['Родитель',[s.parent_name,s.parent_contact].filter(Boolean).join(' · ')],['Заметки',s.notes]]) {
    if(value)pane.append(field(label,el('span','',value)));
  }
  for(const slot of s.schedule)pane.append(el('p','tu-muted',weekdays[slot.weekday]+' · '+String(Math.floor(slot.minute/60)).padStart(2,'0')+':'+String(slot.minute%60).padStart(2,'0')+' · '+slot.duration+' мин'));
  pane.append(group('tu-actions',ui.button('Редактировать',()=>studentEditor(ui,s)),
    ui.button(s.project_id?'Открыть доску':'Создать доску',async()=>{const r=await ui.store.act('board',s.id);location.assign(appHref('board',r.projectId));}),
    ui.button(s.archived?'Вернуть из архива':'В архив',async()=>{await ui.store.act(s.archived?'editStudent':'archive',id,s.archived?{archived:false}:{});ui.close();ui.render();})));
  if(ui.store.api){
    const alias=input(s.invite_slug);alias.placeholder='От 12 до 23 символов';
    pane.append(field('Именной адрес',alias),ui.button('Скопировать ссылку ученика',async()=>{const url=await ui.store.invite(id,alias.value.trim());await navigator.clipboard.writeText(url);ui.message('Ссылка скопирована');}));
  }
}
