import { resolveAnimationMode, S, step, atRest } from './motion';
import { pushNotice } from './notify-center';
import { TutorStore } from './tutor-store';
import { appHref, mountTelegram, telegramData } from './tutor-launch';
import { el, errorText, group, type TutorUI, type View } from './tutor-ui';
import { incomeView } from './tutor-income-ui';
import { calendarView } from './tutor-calendar-ui';
import { studentsView } from './tutor-students-ui';
import { renderProfileSettings } from './profile-settings';
import { renderSubscriptionSettings } from './subscription-settings';
import { startProfileSync, syncAccount } from './profile-sync';
import { authErrorText, completePendingAuth } from './auth';
import type { SectionView } from './settings-dialog';
import { setUpgradeHandler } from './pro-badge';
import { openPlansDialog, setPlansDialogHooks } from './plans-dialog';
import { mountTutorNavMotion } from './tutor-nav-motion';
import { mountTutorSidebar } from './tutor-sidebar';

export async function bootTutor() {
  const root = document.getElementById('tutor-root')!;
  document.body.classList.add('tutor-mode');
  root.hidden = false;
  document.title = 'Кабинет репетитора · Abax Tutor';
  const rail = el('nav', 'tu-rail');
  rail.setAttribute('aria-label', 'Разделы кабинета');
  const logo = el('img');
  logo.src = 'tutor-logo.svg';
  logo.alt = '';
  const brand = group('tu-brand', logo, el('strong', 'tu-sidebar-label', 'Abax Tutor'));
  const collapse = el('button', 'tu-sidebar-toggle');
  collapse.type = 'button';
  collapse.append(el('span', 'tu-sidebar-chevron'));
  const railHead = group('tu-rail-head', brand, collapse);
  const nav = group('tu-nav');
  const main = el('main', 'tu-main');
  main.tabIndex = -1;
  const sheet = el('dialog', 'tu-sheet'),
    toast = el('div', 'tu-toast');
  toast.hidden = true;
  toast.setAttribute('role', 'status');
  root.append(rail, main, sheet, toast);
  rail.append(railHead, nav);
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
  const authOutcome = await completePendingAuth();
  let view: View = authOutcome?.resume?.where === 'tutor-profile' ? 'profile' : 'calendar';
  const profileNotice = authOutcome?.resume?.where === 'tutor-profile' ? {
    text: authOutcome.ok ? (authOutcome.mode === 'link' ? 'Способ входа привязан' : 'Вы вошли в аккаунт') : authErrorText(authOutcome.error ?? 'auth-failed'),
    kind: authOutcome.ok ? 'info' as const : 'error' as const,
  } : null;
  let section: SectionView | null = null;
  let toastTimer = 0;
  let backVisible: (v: boolean) => void = () => {};
  let updateNav = () => {};
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
      section?.dispose?.();
      section = null;
      main.replaceChildren();
      for (const b of nav.querySelectorAll('button'))
        b.setAttribute('aria-current', b.dataset.view === view ? 'page' : 'false');
      updateNav();
      if (view === 'calendar') calendarView(ui);
      else if (view === 'income') incomeView(ui);
      else if (view === 'students') studentsView(ui);
      else {
        main.append(el('h1', 'tu-heading', view === 'profile' ? 'Профиль' : 'Подписка'));
        const content = el('div', 'tu-profile-content');
        main.append(content);
        section = view === 'profile'
          ? renderProfileSettings(content, () => ui.render(), { tutor: true, notice: profileNotice, openSubscription: () => ui.navigate('subscription') })
          : renderSubscriptionSettings(content, { openLogin: () => ui.navigate('profile') });
      }
      if (store.api && store.pending) main.prepend(el('p', 'tu-pending', 'Ожидают синхронизации: ' + store.pending));
      backVisible(sheet.open || view !== 'calendar');
    },
  };
  setUpgradeHandler(f => openPlansDialog(f));
  setPlansDialogHooks({ openLogin: () => ui.navigate('profile'), openPromo: () => ui.navigate('subscription') });
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
    b.setAttribute('aria-label', text);
    b.title = text;
    b.append(glyph, el('span', 'tu-nav-label', text));
    nav.append(b);
  }
  const exit = ui.button('', () => location.assign(appHref('board')), 'tu-exit');
  exit.setAttribute('aria-label', 'Открыть Abax Board');
  exit.title = 'Открыть Abax Board';
  const exitIcon = el('span', 'tu-glyph', '↗');
  exitIcon.setAttribute('aria-hidden', 'true');
  exit.append(exitIcon, el('span', 'tu-sidebar-label', 'Abax Board'));
  const profile = ui.button('', () => ui.navigate('profile'), 'tu-profile');
  profile.dataset.view = 'profile';
  profile.setAttribute('aria-label', 'Профиль');
  profile.title = 'Профиль';
  const profileGlyph = el('span', 'tu-glyph', '◯');
  profileGlyph.setAttribute('aria-hidden', 'true');
  profile.append(profileGlyph, el('span', 'tu-nav-label', 'Профиль'));
  nav.append(profile);
  rail.append(exit);
  const updateMobileNav = mountTutorNavMotion(nav);
  const updateSidebar = mountTutorSidebar(root, rail, nav, collapse, logo);
  updateNav = () => { updateMobileNav(); updateSidebar(); };
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
  await syncAccount();
  startProfileSync(400, true);
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
