export function el<K extends keyof HTMLElementTagNameMap>(tag: K, options: { className?: string; text?: string } = {}, ...children: (Node | string)[]): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (options.className) node.className = options.className;
  if (options.text !== undefined) node.textContent = options.text;
  node.append(...children);
  return node;
}

export function button(text: string, handler?: () => void, className = ''): HTMLButtonElement {
  const node = el('button', { text, className });
  node.type = handler ? 'button' : 'submit';
  if (handler) node.addEventListener('click', handler);
  return node;
}

export function link(text: string, href: string, className?: string): HTMLAnchorElement {
  const node = el('a', { text, className });
  node.href = href;
  return node;
}

export function input(name: string, type = 'text', options: Partial<HTMLInputElement> = {}): HTMLInputElement {
  const node = document.createElement('input');
  node.name = name;
  node.type = type;
  Object.assign(node, options);
  return node;
}

export function select(name: string, options: Record<string, string>, value = ''): HTMLSelectElement {
  const node = el('select');
  node.name = name;
  for (const [key, label] of Object.entries(options)) {
    node.add(new Option(label, key, false, value === key));
  }
  return node;
}

export function field(text: string, control: HTMLElement): HTMLLabelElement {
  return el('label', { className: 'field' }, el('span', { text }), control);
}

export function alertBox(): HTMLParagraphElement {
  const node = el('p', { className: 'error' });
  node.setAttribute('role', 'alert');
  node.hidden = true;
  return node;
}

export function pair(primary: string | Node, secondary?: string | null): HTMLElement {
  return el('div', { className: 'pair' }, primary, ...(secondary ? [el('small', { text: secondary })] : []));
}

export function badge(text: string, tone = 'neutral'): HTMLSpanElement {
  return el('span', { className: 'badge ' + tone, text });
}

export function table(title: string, headers: string[], rows: (Node | string)[][]): HTMLElement {
  const heading = el('tr');
  for (const text of headers) {
    const th = el('th', { text });
    th.scope = 'col';
    heading.append(th);
  }
  const tbody = el('tbody');
  for (const cells of rows) tbody.append(el('tr', {}, ...cells.map(cell => el('td', {}, cell))));
  const grid = el('table', {}, el('thead', {}, heading), tbody);
  grid.setAttribute('aria-label', title);
  const wrap = el('div', { className: 'table-wrap' }, grid);
  wrap.tabIndex = 0;
  wrap.setAttribute('role', 'region');
  wrap.setAttribute('aria-label', title);
  return wrap;
}
