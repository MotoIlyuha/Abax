// Свой пикер цвета: квадрат насыщенность–яркость, радужная полоса тона и поле hex.
// Нужен панели цветов и разделу «Экспериментальные» (цвета иконки приложения).

export function hsvToHex(h: number, s: number, v: number): string {
  const f = (n: number) => {
    const k = (n + h / 60) % 6;
    const val = v - v * s * Math.max(0, Math.min(k, 4 - k, 1));
    return Math.round(val * 255).toString(16).padStart(2, '0');
  };
  return `#${f(5)}${f(3)}${f(1)}`;
}

export function hexToHsv(hex: string): { h: number; s: number; v: number } {
  const n = parseInt(hex.slice(1), 16);
  const r = ((n >> 16) & 255) / 255, g = ((n >> 8) & 255) / 255, b = (n & 255) / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
  let h = 0;
  if (d !== 0) {
    if (max === r) h = 60 * (((g - b) / d) % 6);
    else if (max === g) h = 60 * ((b - r) / d + 2);
    else h = 60 * ((r - g) / d + 4);
  }
  if (h < 0) h += 360;
  return { h, s: max === 0 ? 0 : d / max, v: max };
}

/** Собственный пикер: SV-квадрат + радужная полоса + hex. */
export function buildCustomColorPicker(host: HTMLElement, initial: string, onChange: (hex: string) => void): void {
  host.textContent = '';
  let { h, s, v } = hexToHsv(initial);
  const sv = document.createElement('div');
  sv.className = 'picker-sv';
  const cursor = document.createElement('div');
  cursor.className = 'picker-cursor';
  sv.appendChild(cursor);
  const hue = document.createElement('input');
  hue.type = 'range';
  hue.min = '0';
  hue.max = '360';
  hue.value = String(Math.round(h));
  hue.className = 'picker-hue';
  const hexRow = document.createElement('div');
  hexRow.className = 'picker-hex';
  const hexInput = document.createElement('input');
  hexInput.value = initial;
  hexInput.maxLength = 7;
  const swatch = document.createElement('span');
  swatch.className = 'picker-swatch';
  hexRow.append(hexInput, swatch);
  host.append(sv, hue, hexRow);

  const apply = (emit: boolean) => {
    const base = hsvToHex(h, 1, 1);
    sv.style.background = `linear-gradient(to top, #000, transparent), linear-gradient(to right, #fff, ${base})`;
    cursor.style.left = `${Math.round(s * 100)}%`;
    cursor.style.top = `${Math.round((1 - v) * 100)}%`;
    cursor.style.background = hsvToHex(h, s, v);
    hue.value = String(Math.round(h));
    const hex = hsvToHex(h, s, v);
    if (hexInput.value.toLowerCase() !== hex) hexInput.value = hex;
    swatch.style.background = hex;
    if (emit) onChange(hex);
  };
  const pointToSv = (e: PointerEvent) => {
    const r = sv.getBoundingClientRect();
    s = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width));
    v = Math.max(0, Math.min(1, 1 - (e.clientY - r.top) / r.height));
    apply(true);
  };
  sv.addEventListener('pointerdown', e => {
    pointToSv(e);
    try { sv.setPointerCapture(e.pointerId); } catch { /* синтетика/потерянный pointer — цвет уже применён */ }
  });
  sv.addEventListener('pointermove', e => {
    if (e.buttons > 0) pointToSv(e);
  });
  hue.addEventListener('input', () => {
    h = Number(hue.value);
    apply(true);
  });
  hexInput.addEventListener('change', () => {
    if (/^#[0-9a-fA-F]{6}$/.test(hexInput.value)) {
      ({ h, s, v } = hexToHsv(hexInput.value.toLowerCase()));
      apply(true);
    }
  });
  apply(false);
}
