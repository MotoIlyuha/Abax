import { resolveAnimationMode, S, step, atRest } from './motion';
import { pushNotice } from './notify-center';
import { TutorStore } from './tutor-store';
import { appHref, mountTelegram, telegramData } from './tutor-launch';
import { el, errorText, group, type TutorUI, type View } from './tutor-ui';
import { incomeView } from './tutor-income-ui';
import { calendarView } from './tutor-calendar-ui';
import { studentsView } from './tutor-students-ui';

export async function bootTutor() {
  const root = document.getElementById('tutor-root')!;
  document.body.classList.add('tutor-mode');
  root.hidden = false;
  document.title = 'Кабинет репетитора · Abax Tutor';
  const rail = el('nav', 'tu-rail');
  rail.setAttribute('aria-label', 'Разделы кабинета');
  const logo = el('img');
  logo.src = 'logo.svg';
  logo.alt = '';
  const brand = group('tu-brand', logo, el('strong', '', 'Abax Tutor'));
  const nav = group('tu-nav');
  const main = el('main', 'tu-main');
  main.tabIndex = -1;
  const sheet = el('dialog', 'tu-sheet'),
    toast = el('div', 'tu-toast');
  toast.hidden = true;
  toast.setAttribute('role', 'status');
  root.append(rail, main, sheet, toast);
  rail.append(brand, nav);
  let prefs;
  try {
    prefs = JSON.parse(localStorage.getItem('doska.settings') ?? 'null');
  } catch {
    /* настройки по умолчанию */
  }
  const motion = resolveAnimationMode(prefs);
  document.body.classList.toggle('no-ui-anim', motion === 'off');
  document.body.classList.toggle('no-motion', motion !== 'enhanced');
  const store = new TutorStore();
  let view: View = 'calendar';
  let toastTimer = 0;
  let backVisible: (v: boolean) => void = () => {};
  const message = (text: string) => {
    pushNotice({ kind: 'system', title: text, quiet: true });
    window.clearTimeout(toastTimer);
    const target = sheet.open ? sheet.querySelector<HTMLElement>('.tu-feedback')! : toast;
    target.textContent = text;
    target.hidden = false;
    toastTimer = window.setTimeout(() => {
      target.hidden = true;
    }, 5500);
  };
  const ui: TutorUI = {
    store,
    main,
    sheet,
    message,
    error: (e) => message(errorText(e)),
    close() {
      sheet.close();
    },
    button(label, fn, cls = '') {
      const b = el('button', cls, label);
      b.type = 'button';
      b.addEventListener('click', async () => {
        if (b.disabled) return;
        b.disabled = true;
        try {
          await fn();
        } catch (e) {
          ui.error(e);
        } finally {
          b.disabled = false;
        }
      });
      return b;
    },
    modal(title) {
      const h = el('h2', '', title);
      h.id = 'tu-sheet-title';
      sheet.setAttribute('aria-labelledby', h.id);
      const close = ui.button('×', () => sheet.close(), 'tu-close');
      close.setAttribute('aria-label', 'Закрыть');
      const pane = group('tu-sheet-body');
      const feedback = el('div', 'tu-feedback');
      feedback.hidden = true;
      feedback.setAttribute('role', 'status');
      sheet.replaceChildren(group('tu-sheet-head', h, close), pane, feedback);
      if (!sheet.open) {
        sheet.showModal();
        if (!matchMedia('(prefers-reduced-motion: reduce)').matches && motion !== 'off') {
          if (motion === 'normal') sheet.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 120 });
          else {
            const spring = S(14);
            spring.t = 0;
            let last = performance.now();
            const tick = (now: number) => {
              step(spring, Math.min(0.025, (now - last) / 1000));
              last = now;
              sheet.style.translate = '0 ' + spring.x + 'px';
              if (sheet.open && !atRest(spring)) requestAnimationFrame(tick);
              else sheet.style.translate = '';
            };
            requestAnimationFrame(tick);
          }
        }
      }
      backVisible(true);
      return pane;
    },
    navigate(next) {
      view = next;
      if (sheet.open) sheet.close();
      ui.render();
    },
    render() {
      main.replaceChildren();
      for (const b of nav.querySelectorAll('button'))
        b.setAttribute('aria-current', b.dataset.view === view ? 'page' : 'false');
      if (view === 'calendar') calendarView(ui);
      else if (view === 'income') incomeView(ui);
      else studentsView(ui);
      if (store.api && store.pending) main.prepend(el('p', 'tu-pending', 'Ожидают синхронизации: ' + store.pending));
      backVisible(sheet.open || view !== 'calendar');
    },
  };
  const links = [
    ['calendar', 'Календарь', '▦'],
    ['students', 'Ученики', '◉'],
    ['income', 'Доход', '◒'],
  ] as const;
  for (const [id, text, icon] of links) {
    const b = ui.button('', () => ui.navigate(id));
    b.dataset.view = id;
    const glyph = el('span', 'tu-glyph', icon);
    glyph.setAttribute('aria-hidden', 'true');
    b.append(glyph, el('span', '', text));
    nav.append(b);
  }
  const exit = ui.button('↗  Abax Board', () => location.assign(appHref('board')), 'tu-exit');
  if (store.api) {
    const profile = ui.button(
      'Профиль',
      () => {
        const url = new URL(appHref('board'));
        url.searchParams.set('tutorProfile', '1');
        location.assign(url.href);
      },
      'tu-profile',
    );
    nav.append(profile);
  }
  rail.append(exit);
  const back = () => {
    if (sheet.open) sheet.close();
    else ui.navigate('calendar');
  };
  backVisible = mountTelegram(root, back);
  sheet.addEventListener('close', () => backVisible(view !== 'calendar'));
  sheet.addEventListener('click', (e) => {
    if (e.target === sheet) {
      const r = sheet.getBoundingClientRect();
      if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) sheet.close();
    }
  });
  try {
    await store.init(telegramData(), () => {
      ui.render();
      document.getElementById('startup')!.hidden = true;
    });
  } catch (e) {
    main.replaceChildren();
    nav.hidden = true;
    main.append(
      el('h1', '', 'Кабинет репетитора'),
      el('p', '', errorText(e)),
      ui.button('Повторить', () => location.reload()),
    );
    return;
  }
  ui.render();
  const refresh = () => {
    void store
      .refresh()
      .then(() => ui.render())
      .catch(ui.error);
  };
  window.addEventListener('online', refresh);
  window.setInterval(() => {
    if (view === 'calendar' && !sheet.open && !document.hidden) ui.render();
  }, 60000);
  window.addEventListener('storage', (e) => {
    if (store.api && (e.key === 'doska.session' || e.key === null)) {
      location.reload();
      return;
    }
    if (e.key?.startsWith('doska.tutor.') && !sheet.open) {
      // Другие вкладки уже записали подтверждённый снимок.
      store.reread();
      ui.render();
    }
  });
}
