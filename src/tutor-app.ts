import { TutorStore } from './tutor-store';
import { appHref, mountTelegram, telegramData } from './tutor-launch';
import { el, errorText, group, type TutorUI, type View } from './tutor-ui';
import { calendarView } from './tutor-calendar-ui';
import { studentsView } from './tutor-students-ui';

export async function bootTutor() {
  const root=document.getElementById('tutor-root')!;
  document.body.classList.add('tutor-mode');root.hidden=false;document.title='Кабинет репетитора · Abax Tutor';
  const rail=el('nav','tu-rail');rail.setAttribute('aria-label','Разделы кабинета');
  const logo=el('img');logo.src='logo.svg';logo.alt='';
  const brand=group('tu-brand',logo,el('strong','','Abax Tutor'));
  const nav=group('tu-nav');
  const main=el('main','tu-main'); main.tabIndex=-1;
  const sheet=el('dialog','tu-sheet'), toast=el('div','tu-toast');toast.hidden=true;toast.setAttribute('role','status');
  root.append(rail,main,sheet,toast);rail.append(brand,nav);
  const store=new TutorStore();
  let view:View='calendar';
  let toastTimer=0;
  let backVisible: (v:boolean)=>void=()=>{};
  const message=(text:string)=>{
    window.clearTimeout(toastTimer);
    const target=sheet.open?sheet.querySelector<HTMLElement>('.tu-feedback')!:toast;
    target.textContent=text;target.hidden=false;
    toastTimer=window.setTimeout(()=>{target.hidden=true;},5500);
  };
  const ui:TutorUI={
    store,main,sheet,message,error:e=>message(errorText(e)),close(){sheet.close();},
    button(label,fn,cls=''){const b=el('button',cls,label);b.type='button';b.addEventListener('click',async()=>{
      if(b.disabled)return;b.disabled=true;
      try{await fn();}catch(e){ui.error(e);}finally{b.disabled=false;}
    });return b;},
    modal(title){
      const h=el('h2','',title);h.id='tu-sheet-title';sheet.setAttribute('aria-labelledby',h.id);
      const close=ui.button('×',()=>sheet.close(),'tu-close');close.setAttribute('aria-label','Закрыть');
      const pane=group('tu-sheet-body');const feedback=el('div','tu-feedback');feedback.hidden=true;feedback.setAttribute('role','status');
      sheet.replaceChildren(group('tu-sheet-head',h,close),pane,feedback);
      if(!sheet.open)sheet.showModal();backVisible(true);return pane;
    },
    navigate(next){view=next;if(sheet.open)sheet.close();ui.render();},
    render(){
      main.replaceChildren();
      for(const b of nav.querySelectorAll('button'))b.setAttribute('aria-current',b.dataset.view===view?'page':'false');
      if(view==='calendar')calendarView(ui);else studentsView(ui);
      backVisible(sheet.open||view!=='calendar');
    },
  };
  const links=[['calendar','Календарь','▦'],['students','Ученики','◉']] as const;
  for(const [id,text,icon] of links){
    const b=ui.button('',()=>ui.navigate(id));b.dataset.view=id;
    const glyph=el('span','tu-glyph',icon);glyph.setAttribute('aria-hidden','true');b.append(glyph,el('span','',text));nav.append(b);
  }
  const exit=ui.button('↗  Abax Board',()=>location.assign(appHref('board')),'tu-exit');rail.append(exit);
  const back=()=>{if(sheet.open)sheet.close();else ui.navigate('calendar');};
  backVisible=mountTelegram(root,back);
  sheet.addEventListener('close',()=>backVisible(view!=='calendar'));
  sheet.addEventListener('click',e=>{if(e.target===sheet){const r=sheet.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)sheet.close();}});
  try {await store.init(telegramData());}
  catch(e){main.append(el('h1','','Кабинет репетитора'),el('p','',errorText(e)),ui.button('Повторить',()=>location.reload()));return;}
  ui.render();
  const refresh=()=>{void store.refresh().then(()=>ui.render()).catch(ui.error);};
  window.addEventListener('online',refresh);
  window.addEventListener('storage',e=>{if(e.key?.startsWith('doska.tutor.') && !sheet.open) {
    // Другие вкладки уже записали подтверждённый снимок.
    store.reread();ui.render();
  }});
}
