import { appHref } from './tutor-launch';
import { reminder, statusNames, type Lesson, type LessonStatus } from './tutor-lessons';
import { studentEditor } from './tutor-students-ui';
import { dateInput, dayLabel, el, empty, field, group, heading, input, rub, select, submit, timeLabel, type TutorUI } from './tutor-ui';
import type { Student } from './tutor-model';

export type CalendarMode = 'day'|'week'|'month'|'agenda';
export const calendar = { mode:'week' as CalendarMode,date:new Date(),student:'',subject:'',status:'' };
const symbols:Record<LessonStatus,string>={scheduled:'○',current:'●',unpaid:'!',paid:'✓',rescheduled:'↪',cancelled:'×'};
const dates = (d:Date,n:number) => new Date(d.getFullYear(),d.getMonth(),d.getDate()+n);
export function period(d:Date,mode:CalendarMode) {
  const day=dates(d,0);
  const start=mode==='week'?dates(day,-(day.getDay()+6)%7):mode==='month'||mode==='agenda'?new Date(d.getFullYear(),d.getMonth(),1):day;
  const end=mode==='week'?dates(start,7):mode==='day'?dates(start,1):new Date(start.getFullYear(),start.getMonth()+1,1);
  return {start,end};
}
function localTime(n:number){const d=new Date(n);return dateInput(d)+'T'+String(d.getHours()).padStart(2,'0')+':'+String(d.getMinutes()).padStart(2,'0');}
export function lessonEditor(ui:TutorUI,at=Date.now(),existing?:Lesson) {
  const available=ui.store.book.students.filter(s=>!s.archived||s.id===existing?.student_id);
  if (!available.length){ui.modal('Новое занятие').append(empty('Для занятия нужен ученик',ui.button('Добавить ученика',()=>studentEditor(ui))));return;}
  const pane=ui.modal(existing?'Редактирование занятия':'Новое занятие'),form=el('form','tu-form');
  const student=select(available.map(s=>[s.id,s.name]),existing?.student_id??(available.some(s=>s.id===calendar.student)?calendar.student:available[0].id));
  student.disabled=!!existing; const curr=()=>available.find(s=>s.id===student.value)!;
  const start=input(localTime(existing?.start_at??at),'datetime-local');start.required=true;
  const duration=input(String(existing?.duration_min??curr().duration_min),'number');duration.min='5';duration.max='720';duration.required=true;
  const price=input(String(existing?.price??curr().price),'number');price.min='0';price.required=true;
  student.onchange=()=>{duration.value=String(curr().duration_min);price.value=String(curr().price);};
  const topic=input(existing?.topic??''),hw=el('textarea'),notes=el('textarea'); hw.value=existing?.homework??'';notes.value=existing?.notes??'';
  const scope=select([['one','Только это занятие'],['following','Это и все следующие занятия']], 'one');
  form.append(field('Ученик',student),field('Дата и время',start),group('tu-pair',field('Длительность, мин',duration),field('Цена, ₽',price)),field('Тема',topic),field('Домашнее задание',hw),field('Заметки к уроку',notes));
  if(existing?.schedule_slot_id)form.append(field('Изменение времени',scope));
  form.append(submit(ui,form,'Сохранить занятие',async()=>{
    const ts=new Date(start.value).getTime(), props={ duration_min:+duration.value,price:+price.value,topic:topic.value,homework:hw.value,notes:notes.value };
    if(existing){
      let id=existing.id;
      if(ts!==existing.start_at && existing.status==='scheduled'){
        const replacement=await ui.store.act('move',id,{start_at:ts,scope:scope.value,duration_min:+duration.value});
        id=Array.isArray(replacement)?replacement.find((l:Lesson)=>l.start_at===ts)?.id:replacement.id;
      }
      await ui.store.act('editLesson',id,{...props,start_at:ts});
    } else await ui.store.act('lesson','',{...props,student_id:student.value,start_at:ts});
    calendar.date=new Date(ts);ui.close();ui.navigate('calendar');
  }));pane.append(form);
}

export function lessonDetails(ui:TutorUI,l:Lesson) {
  const s=ui.store.book.students.find(s=>s.id===l.student_id)!;
  const pane=ui.modal(s.name);
  const status=(st:LessonStatus)=>async()=>{await ui.store.act('editLesson',l.id,{status:st});ui.close();ui.render();};
  pane.append(el('h3','',dayLabel(l.start_at)+' · '+timeLabel(l.start_at)),el('p','tu-muted',s.subject+' · '+l.duration_min+' мин · '+rub(l.price)),
    el('strong','',symbols[l.status]+' '+statusNames[l.status]));
  if(l.topic)pane.append(field('Тема',el('span','',l.topic)));
  if(l.homework)pane.append(field('Домашнее задание',el('span','',l.homework)));
  if(l.notes)pane.append(field('Заметки',el('span','',l.notes)));
  const actions=group('tu-actions');
  if(l.status==='scheduled'||l.status==='current'){
    actions.append(ui.button(l.status==='current'?'Открыть доску':'Начать занятие',async()=>{
      const r=await ui.store.act('start',l.id);
      location.assign(appHref('board',r.projectId,r.pageId));
    },'tu-primary'));
    actions.append(ui.button('Завершить занятие',status('unpaid')));
  }
  if(l.status!=='rescheduled'&&l.status!=='cancelled'){
    if(l.status!=='paid')actions.append(ui.button('Отметить оплаченным',status('paid')));
    if(l.status==='paid')actions.append(ui.button('Снять отметку оплаты',status('unpaid')));
    actions.append(ui.button('Редактировать',()=>lessonEditor(ui,l.start_at,l)));
    if(l.status==='scheduled')actions.append(ui.button('Перенести',()=>{
      const view=ui.modal('Перенести занятие'),form=el('form','tu-form'),date=input(localTime(l.start_at),'datetime-local');
      date.required=true;const scope=select([['one','Только это занятие'],['following','Это и все следующие занятия']],'one');
      form.append(field('Новое время',date));if(l.schedule_slot_id)form.append(field('Применить к',scope));
      form.append(submit(ui,form,'Сохранить перенос',async()=>{const ts=new Date(date.value).getTime();await ui.store.act('move',l.id,{start_at:ts,scope:scope.value});calendar.date=new Date(ts);ui.close();ui.render();}));view.append(form);
    }));
    actions.append(ui.button('Отменить занятие',status('cancelled')));
  }
  if(l.status==='unpaid'){
    const text=reminder(s,l,ui.store.book.lessons);
    pane.append(field('Напоминание об оплате',el('p','',text)));
    actions.append(ui.button('Скопировать напоминание',async()=>{await navigator.clipboard.writeText(text);ui.message('Напоминание скопировано');}));
  }
  if(l.rescheduled_to_id){
    const next=ui.store.book.lessons.find(r=>r.id===l.rescheduled_to_id);
    if(next)actions.append(ui.button('Новое время · '+dayLabel(next.start_at)+' '+timeLabel(next.start_at),()=>lessonDetails(ui,next)));
  }
  if(l.board_project_id && l.status!=='current')actions.append(ui.button('Страница урока',()=>location.assign(appHref('board',l.board_project_id!,l.board_page_id??undefined))));
  pane.append(actions);
}
function lessonCard(ui:TutorUI,l:Lesson,s:Student,compact=false) {
  const card=ui.button('',()=>lessonDetails(ui,l),'tu-lesson'+(compact?' compact':''));
  card.style.setProperty('--student',s.color);card.dataset.status=l.status;card.dataset.lesson=l.id;
  card.setAttribute('aria-label',[s.name,timeLabel(l.start_at),statusNames[l.status]].join(', '));
  const next=l.rescheduled_to_id && ui.store.book.lessons.find(r=>r.id===l.rescheduled_to_id);
  const label=l.status==='current'?'Идёт урок':statusNames[l.status];
  card.append(el('strong','',timeLabel(l.start_at)+' · '+s.name),el('small','tu-badge',symbols[l.status]+' '+label+
    (l.status==='unpaid'?' · '+rub(l.price):next?' · '+dayLabel(next.start_at)+' '+timeLabel(next.start_at):'')));
  if(!compact&&l.topic)card.append(el('span','',l.topic));
  return card;
}
export function calendarView(ui:TutorUI) {
  const {mode,date}=calendar, {start,end}=period(date,mode);
  const students=new Map(ui.store.book.students.map(s=>[s.id,s]));
  const rows=ui.store.book.lessons.filter(l=>l.start_at>=+start&&l.start_at<+end && (!calendar.student||calendar.student===l.student_id) &&
    (!calendar.subject||students.get(l.student_id)?.subject===calendar.subject) && (!calendar.status||l.status===calendar.status)).sort((a,b)=>a.start_at-b.start_at);
  const navigate=(dir:number)=>{calendar.date=mode==='week'?dates(date,dir*7):mode==='day'?dates(date,dir):new Date(date.getFullYear(),date.getMonth()+dir,1);ui.render();};
  ui.main.append(heading('Календарь',ui.button('Новое занятие',()=>lessonEditor(ui,new Date(date.getFullYear(),date.getMonth(),date.getDate(),new Date().getHours()+1).getTime()),'tu-primary')));
  const modes=group('tu-segments');
  for(const [id,label] of [['day','День'],['week','Неделя'],['month','Месяц'],['agenda','Список']] as const){
    const b=ui.button(label,()=>{calendar.mode=id;ui.render();});b.setAttribute('aria-pressed',String(mode===id));modes.append(b);
  }
  const title=mode==='week'?dayLabel(+start)+' – '+dayLabel(+dates(end,-1)):mode==='day'?dayLabel(+date):date.toLocaleDateString('ru-RU',{month:'long',year:'numeric'});
  const prev=ui.button('‹',()=>navigate(-1)),next=ui.button('›',()=>navigate(1));prev.setAttribute('aria-label','Предыдущий период');next.setAttribute('aria-label','Следующий период');
  ui.main.append(group('tu-toolbar',group('tu-period',prev,el('h3','',title),next,ui.button('Сегодня',()=>{calendar.date=new Date();ui.render();})),modes));
  const filters=group('tu-filters');
  for(const [k,title,options] of [
    ['student','Ученик',Array.from(students.values(),s=>[s.id,s.name])],['subject','Предмет',Array.from(new Set(Array.from(students.values(),s=>s.subject)),n=>[n,n])],
    ['status','Статус',Object.entries(statusNames)],
  ] as const){
    const n=select([['','Все'],...options as [string,string][]],calendar[k]);n.onchange=()=>{calendar[k]=n.value;ui.render();};filters.append(field(title,n));
  }
  if(mode==='agenda'||calendar.status||calendar.student||calendar.subject)ui.main.append(filters);
  const area=group('tu-calendar');ui.main.append(area);
  let x=0,y=0;area.addEventListener('touchstart',e=>{x=e.touches[0].clientX;y=e.touches[0].clientY;},{passive:true});
  area.addEventListener('touchend',e=>{const dx=e.changedTouches[0].clientX-x,dy=e.changedTouches[0].clientY-y;if(Math.abs(dx)>85&&Math.abs(dx)>2*Math.abs(dy)&&innerWidth<=640){if(mode==='week'){calendar.date=dates(date,dx<0?1:-1);ui.render();}else navigate(dx<0?1:-1);}},{passive:true});
  if(mode==='agenda'){
    if(!rows.length)area.append(empty('За период занятий нет',ui.button('Добавить занятие',()=>lessonEditor(ui,+date))));
    let prevDay='';
    for(const l of rows){const day=dayLabel(l.start_at);if(day!==prevDay){area.append(el('h3','tu-daytitle',day));prevDay=day;}area.append(lessonCard(ui,l,students.get(l.student_id)!));}
  } else if(mode==='month'){
    area.classList.add('tu-month');
    for(const title of ['Пн','Вт','Ср','Чт','Пт','Сб','Вс'])area.append(el('b','tu-weekday',title));
    for(let n=0;n<(start.getDay()+6)%7;n++)area.append(el('div','tu-otherday'));
    for(let d=start;d<end;d=dates(d,1)){
      const b=ui.button(String(d.getDate()),()=>lessonEditor(ui,+d+12*3600000),'tu-date');
      const cell=group('tu-monthday',b);
      for(const l of rows.filter(l=>l.start_at>=+d&&l.start_at<+dates(d,1)))cell.append(lessonCard(ui,l,students.get(l.student_id)!,true));
      area.append(cell);
    }
  } else {
    const mobileWeek=mode==='week' && matchMedia('(max-width:640px)').matches;
    const count=mode==='week'&&!mobileWeek?7:1;
    const firstDate=mobileWeek?dates(date,0):start;
    if(mobileWeek){const days=group('tu-mobileweek');for(let i=0;i<7;i++){const d=dates(start,i);const b=ui.button(d.toLocaleDateString('ru-RU',{weekday:'short',day:'numeric'}),()=>{calendar.date=d;ui.render();});b.setAttribute('aria-pressed',String(dateInput(d)===dateInput(date)));days.append(b);}ui.main.insertBefore(days,area);}
    const hours=rows.map(l=>new Date(l.start_at).getHours());
    const first=Math.min(8,...hours), last=Math.max(21,...rows.map(l=>Math.min(24,Math.ceil((new Date(l.start_at).getHours()*60+new Date(l.start_at).getMinutes()+l.duration_min)/60))));
    area.classList.add('tu-timeline');area.style.setProperty('--days',String(count));area.style.setProperty('--hours',String(last-first));
    area.append(el('span','tu-clockhead',''));
    for(let i=0;i<count;i++){const d=dates(firstDate,i);area.append(el('strong','tu-colhead',d.toLocaleDateString('ru-RU',{weekday:'short',day:'numeric'})));}
    const times=group('tu-hours');for(let h=first;h<last;h++)times.append(el('small','',String(h).padStart(2,'0')+':00'));area.append(times);
    for(let i=0;i<count;i++){
      const d=dates(firstDate,i), column=group('tu-daycol');
      for(let h=first;h<last;h++){const at=new Date(d);at.setHours(h);const slot=ui.button('',()=>lessonEditor(ui,+at),'tu-free');slot.setAttribute('aria-label','Добавить занятие '+dayLabel(+d)+' '+timeLabel(+at));column.append(slot);}
      const todays=rows.filter(l=>l.start_at>=+d&&l.start_at<+dates(d,1));
      for(const l of todays){
        const t=new Date(l.start_at), minute=t.getHours()*60+t.getMinutes()-first*60;
        const card=lessonCard(ui,l,students.get(l.student_id)!,true);
        card.style.top='calc(var(--hour) * '+minute/60+')';card.style.height='calc(var(--hour) * '+Math.min(l.duration_min,(last-first)*60-minute)/60+' - 2px)';
        const concurrent=todays.filter(r=>r.start_at<l.start_at+l.duration_min*60000&&r.start_at+r.duration_min*60000>l.start_at);
        if(concurrent.length>1){card.style.left=100*concurrent.indexOf(l)/concurrent.length+'%';card.style.width=100/concurrent.length+'%';}
        column.append(card);
      }
      const now=new Date();if(dateInput(now)===dateInput(d)&&now.getHours()>=first&&now.getHours()<last){
        const line=el('div','tu-now');line.title='Сейчас';line.style.top='calc(var(--hour) * '+(now.getHours()-first+now.getMinutes()/60)+')';column.append(line);
      }
      area.append(column);
    }
  }
}
