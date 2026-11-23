import { analytics, type Detail, type ChartGroup } from './tutor-analytics';
import { period, lessonDetails } from './tutor-calendar-ui';
import { avatar, dateInput, dayLabel, el, field, group, heading, input, rub, select, type TutorUI } from './tutor-ui';

type RangeMode = 'day' | 'week' | 'month' | 'custom';
const income = {
  mode: 'month' as RangeMode,
  date: new Date(),
  from: dateInput(new Date(new Date().getFullYear(), new Date().getMonth(), 1)),
  to: dateInput(new Date()),
  detail: 'student' as Detail,
};
const svgNS = 'http://www.w3.org/2000/svg';
function svg<K extends keyof SVGElementTagNameMap>(name: K, attrs: Record<string, string | number> = {}) {
  const n = document.createElementNS(svgNS, name);
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, String(v));
  return n;
}
function tip(n: SVGElement, text: string, output: HTMLElement) {
  const title = svg('title');
  title.textContent = text;
  n.append(title);
  n.setAttribute('aria-label', text);
  n.setAttribute('tabindex', '0');
  for (const e of ['focus', 'pointerenter', 'click'])
    n.addEventListener(e, () => {
      output.textContent = text;
    });
}
type Report = ReturnType<typeof analytics>;
function bars(r: Report) {
  const panel = group('tu-chart', el('h3', '', 'План и факт')),
    legend = group('tu-legend', el('span', 'tu-plan-key', 'План'), el('span', 'tu-fact-key', 'Факт'));
  const out = el('output', 'tu-chart-tip'),
    chart = svg('svg', { role: 'img', 'aria-label': 'План и факт по времени', 'data-chart': 'plan-fact' });
  const width = Math.max(260, Math.min(940, innerWidth <= 720 ? innerWidth - 68 : (innerWidth - 320) * 0.68)),
    height = 192,
    left = 46,
    bottom = 154;
  chart.setAttribute('viewBox', '0 0 ' + width + ' ' + height);
  const labelEvery = Math.max(1, Math.ceil(r.bins.length / Math.max(1, Math.floor((width - left) / 48))));
  const max = Math.max(1, ...r.bins.map((b) => [...b.groups.values()].reduce((n, g) => n + g.plan, 0)));
  for (let i = 0; i <= 3; i++) {
    const y = bottom - (132 * i) / 3;
    chart.append(svg('line', { x1: left, x2: width - 4, y1: y, y2: y, class: 'tu-gridline' }));
    const t = svg('text', { x: left - 5, y: y + 3, 'text-anchor': 'end' });
    t.textContent = new Intl.NumberFormat('ru-RU', { notation: 'compact' }).format((max * i) / 3);
    chart.append(t);
  }
  const defs = svg('defs'),
    pattern = svg('pattern', { id: 'tu-hatch', patternUnits: 'userSpaceOnUse', width: 6, height: 6 });
  pattern.append(
    svg('path', {
      d: 'M-1 1L1 -1 M0 6L6 0 M5 7L7 5',
      stroke: 'currentColor',
      'stroke-opacity': 0.32,
      'stroke-width': 1,
    }),
  );
  defs.append(pattern);
  chart.append(defs);
  const bar = (g: ChartGroup, k: 'plan' | 'fact', x: number, y: number, w: number, h: number, label: string) => {
    const rect = svg('rect', {
      x,
      y,
      width: w,
      height: h,
      fill: g.color,
      'fill-opacity': k === 'plan' ? 0.28 : 1,
      stroke: g.color,
      'data-value': g[k],
      'data-series': k,
    });
    tip(rect, label + ' · ' + g.name + ' · ' + (k === 'plan' ? 'План ' : 'Факт ') + rub(g[k]), out);
    chart.append(rect);
    if (k === 'plan')
      chart.append(svg('rect', { x, y, width: w, height: h, fill: 'url(#tu-hatch)', 'pointer-events': 'none' }));
  };
  const slot = (width - left) / Math.max(r.bins.length, 1),
    bw = Math.min(14, slot * 0.32);
  r.bins.forEach((b, i) => {
    const x = left + (i + 0.5) * slot;
    let yp = bottom,
      yf = bottom;
    for (const g of b.groups.values()) {
      if (g.plan) {
        const h = (g.plan / max) * 132;
        yp -= h;
        bar(g, 'plan', x - bw - 1, yp, bw, h, b.label);
      }
      if (g.fact) {
        const h = (g.fact / max) * 132;
        yf -= h;
        bar(g, 'fact', x + 1, yf, bw, h, b.label);
      }
    }
    const t = svg('text', { x, y: bottom + 20, 'text-anchor': 'middle' });
    t.textContent = i % labelEvery === 0 ? b.label : '';
    chart.append(t);
  });
  const scroll = group('tu-chart-scroll', chart);
  panel.append(legend, scroll, out);
  return panel;
}
function donut(r: Report) {
  const panel = group('tu-chart tu-donut', el('h3', '', 'Структура дохода')),
    chart = svg('svg', {
      viewBox: '0 0 180 180',
      role: 'img',
      'aria-label': 'Доход по ученикам',
      'data-chart': 'income-share',
    });
  const out = el('output', 'tu-chart-tip');
  chart.append(svg('circle', { cx: 90, cy: 90, r: 68, fill: 'none', class: 'tu-ring', 'stroke-width': 17 }));
  let offset = 0;
  const length = 2 * Math.PI * 68;
  for (const row of r.ranking.filter((r) => r.fact > 0)) {
    const arc = (length * row.fact) / r.total.fact;
    const c = svg('circle', {
      cx: 90,
      cy: 90,
      r: 68,
      fill: 'none',
      stroke: row.student.color,
      'stroke-width': 17,
      'stroke-dasharray': arc + ' ' + (length - arc),
      'stroke-dashoffset': -offset,
      transform: 'rotate(-90 90 90)',
      'data-student': row.student.id,
    });
    tip(c, row.student.name + ' · ' + rub(row.fact) + ' · ' + Math.round((100 * row.fact) / r.total.fact) + '%', out);
    chart.append(c);
    offset += arc;
  }
  const t = svg('text', { x: 90, y: 96, 'text-anchor': 'middle', class: 'tu-ring-total' });
  t.textContent = rub(r.total.fact);
  chart.append(t);
  panel.append(chart, out);
  return panel;
}
export function incomeView(ui: TutorUI) {
  ui.main.append(heading('Доход и аналитика'));
  const modes = group('tu-segments');
  for (const [k, label] of [
    ['day', 'День'],
    ['week', 'Неделя'],
    ['month', 'Месяц'],
    ['custom', 'Период'],
  ] as const) {
    const b = ui.button(label, () => {
      income.mode = k;
      ui.render();
    });
    b.setAttribute('aria-pressed', String(k === income.mode));
    modes.append(b);
  }
  const a = new Date(income.from + 'T00:00'),
    z = new Date(income.to + 'T00:00');
  z.setDate(z.getDate() + 1);
  const { start, end } = income.mode === 'custom' ? { start: a, end: z } : period(income.date, income.mode);
  const jump = (dir: number) => {
    if (income.mode === 'custom') {
      const n = Math.round((+z - +a) / 86400000) * dir;
      a.setDate(a.getDate() + n);
      z.setDate(z.getDate() + n - 1);
      income.from = dateInput(a);
      income.to = dateInput(z);
    } else {
      const d = new Date(start);
      if (income.mode === 'month') d.setMonth(d.getMonth() + dir);
      else d.setDate(d.getDate() + dir * (income.mode === 'week' ? 7 : 1));
      income.date = d;
    }
    ui.render();
  };
  ui.main.append(
    group(
      'tu-toolbar',
      group(
        'tu-period',
        ui.button('‹', () => jump(-1)),
        el('h3', '', dayLabel(+start) + (income.mode === 'day' ? '' : ' – ' + dayLabel(+end - 1))),
        ui.button('›', () => jump(1)),
      ),
      modes,
    ),
  );
  if (income.mode === 'custom') {
    const from = input(income.from, 'date'),
      to = input(income.to, 'date');
    from.max = income.to;
    to.min = income.from;
    const apply = () => {
      if (from.value && to.value && from.value <= to.value) {
        income.from = from.value;
        income.to = to.value;
        ui.render();
      }
    };
    from.onchange = apply;
    to.onchange = apply;
    ui.main.append(group('tu-filters', field('С даты', from), field('По дату', to)));
  }
  const report = analytics(
      ui.store.book.students,
      ui.store.book.lessons,
      start,
      end,
      income.mode === 'day',
      income.detail,
    ),
    t = report.total;
  const kpi = (title: string, value: string, cls = '') =>
    group('tu-kpi ' + cls, el('small', '', title), el('strong', '', value));
  const debt = kpi('Ожидает оплаты', rub(t.debt));
  debt.append(
    ui.button('Список должников', () => {
      const pane = ui.modal('Ожидают оплаты'),
        rows = ui.store.book.lessons.filter((l) => l.status === 'unpaid' && l.start_at >= +start && l.start_at < +end);
      if (!rows.length) pane.append(el('p', '', 'За период долгов нет.'));
      for (const l of rows) {
        const s = ui.store.book.students.find((s) => s.id === l.student_id)!;
        pane.append(
          group(
            'tu-line',
            avatar(s.name, s.color),
            el('span', '', s.name + ' · ' + dayLabel(l.start_at) + ' · ' + rub(l.price)),
            ui.button('Оплачено', async () => {
              await ui.store.act('editLesson', l.id, { status: 'paid' });
              ui.close();
              ui.render();
            }),
            ui.button('Урок', () => lessonDetails(ui, l)),
          ),
        );
      }
    }),
  );
  ui.main.append(
    group(
      'tu-kpis',
      kpi('Фактический доход', rub(t.fact), 'tu-kpi-feature'),
      kpi('Планируемый доход', rub(t.plan)),
      debt,
      kpi(
        'Проведено занятий',
        t.count + ' · ' + (t.minutes / 60).toLocaleString('ru-RU', { maximumFractionDigits: 2 }) + ' ч',
      ),
    ),
  );
  const detail = select(
    [
      ['student', 'По ученикам'],
      ['total', 'Общий план и факт'],
      ['subject', 'По предметам'],
    ],
    income.detail,
  );
  detail.onchange = () => {
    income.detail = detail.value as Detail;
    ui.render();
  };
  ui.main.append(
    group('tu-chart-controls', field('Детализация', detail)),
    group('tu-charts', bars(report), donut(report)),
  );
  const table = group('tu-ranking', el('h3', '', 'Доход по ученикам'));
  if (!report.ranking.length) table.append(el('p', 'tu-muted', 'За выбранный период занятий нет.'));
  for (const r of report.ranking) {
    const progress = el('progress');
    progress.max = r.plan || 1;
    progress.value = r.fact;
    progress.style.accentColor = r.student.color;
    progress.setAttribute('aria-label', 'Выполнение плана ' + r.student.name);
    table.append(
      group(
        'tu-rank',
        avatar(r.student.name, r.student.color),
        group(
          'tu-cardtext',
          el('strong', '', r.student.name),
          el('small', '', 'Уроков: ' + r.count + ' · Долг: ' + rub(r.debt)),
        ),
        group('tu-cardrate', el('strong', '', rub(r.fact) + ' / ' + rub(r.plan)), progress),
      ),
    );
  }
  ui.main.append(
    table,
    group(
      'tu-summary',
      kpi('Средняя ставка за проведённый час', rub(t.minutes ? ((t.fact + t.debt) * 60) / t.minutes : 0)),
      kpi('Отменено на сумму', rub(t.cancelled)),
      kpi('Потери от отмен и переносов', rub(report.loss)),
    ),
  );
}
