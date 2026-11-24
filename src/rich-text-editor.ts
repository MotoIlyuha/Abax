import type { TextRun } from './types';
import { clearRunField, formatRange, remapRuns, styledSegments, type RunStyle, type TextFlag, type TextStyle } from './text-runs';

interface TextRange { from: number; to: number; backward?: boolean }
interface Draft {
  text: string;
  style: Partial<Omit<TextStyle, 'runs'>>;
  runs?: TextRun[];
}
interface Snapshot { draft: Draft; range: TextRange }

/** In-place редактор: браузер отвечает за выделение и ввод, доска хранит текст и фрагменты отдельно от DOM. */
export class RichTextEditor {
  readonly el = document.createElement('div');
  private draft: Draft;
  private range: TextRange;
  private before: TextRange | undefined;
  private composing = false;
  private undo: Snapshot[] = [];
  private redo: Snapshot[] = [];

  constructor(text: string, runs: TextRun[] | undefined, private base: () => Omit<TextStyle, 'runs'>, private change: () => void) {
    this.draft = { text, runs, style: {} };
    this.range = { from: text.length, to: text.length };
    this.el.contentEditable = 'plaintext-only';
    this.el.setAttribute('role', 'textbox');
    this.el.setAttribute('aria-multiline', 'true');
    this.el.setAttribute('aria-label', 'Текст');
    this.paint();
    this.el.addEventListener('beforeinput', event => {
      if (event.inputType === 'historyUndo' || event.inputType === 'historyRedo') {
        event.preventDefault();
        this.history(event.inputType === 'historyRedo');
        return;
      }
      if (!this.composing) this.before = this.selection();
      if (event.inputType === 'insertParagraph' || event.inputType === 'insertLineBreak') {
        event.preventDefault();
        this.insert('\n');
      }
    });
    this.el.addEventListener('input', () => { if (!this.composing) this.readInput(); });
    this.el.addEventListener('compositionstart', () => {
      this.composing = true;
      this.before = this.selection();
    });
    this.el.addEventListener('compositionend', () => {
      this.composing = false;
      this.readInput();
    });
    this.el.addEventListener('paste', event => {
      if (!event.clipboardData) return;
      event.preventDefault();
      event.stopPropagation();
      this.insert(event.clipboardData.getData('text/plain').replace(/\r\n?/g, '\n'));
    });
    this.el.addEventListener('blur', () => { this.range = this.selection(); });
  }

  get text(): string { return this.draft.text; }

  get style(): TextStyle {
    return { ...this.base(), ...this.draft.style, runs: this.draft.runs };
  }

  selection(): TextRange {
    const sel = window.getSelection();
    if (!sel?.anchorNode || !sel.focusNode || !this.el.contains(sel.anchorNode) || !this.el.contains(sel.focusNode)) return this.range;
    const prefix = document.createRange();
    prefix.selectNodeContents(this.el);
    prefix.setEnd(sel.anchorNode, sel.anchorOffset);
    const anchor = prefix.toString().length;
    prefix.setEnd(sel.focusNode, sel.focusOffset);
    const focus = prefix.toString().length;
    return { from: Math.min(anchor, focus), to: Math.max(anchor, focus), backward: anchor > focus };
  }

  rememberSelection(): void {
    if (document.activeElement === this.el) this.range = this.selection();
  }

  focus(): void {
    this.rememberSelection();
    this.el.focus();
    this.restoreSelection();
  }

  /** Стиль выделения, а при свёрнутом выделении — всего текста. */
  styles(): RunStyle[] {
    const { from, to } = this.selection();
    const [start, end] = from === to ? [0, this.text.length] : [from, to];
    return styledSegments(this.style, start, end || 1).map(seg => seg.style);
  }

  format(key: TextFlag | 'color', value: boolean | string, asRange = false): void {
    this.range = this.selection();
    const { from, to } = this.range;
    this.remember();
    if (from !== to || asRange) {
      this.draft = {
        ...this.draft,
        runs: formatRange(this.style, this.text.length, from === to ? 0 : from, from === to ? this.text.length : to, { [key]: value }),
      };
    } else {
      this.draft = {
        ...this.draft,
        style: { ...this.draft.style, [key]: value },
        runs: clearRunField(this.draft.runs, key, this.text.length),
      };
    }
    this.paint();
    this.change();
  }

  insert(text: string): void {
    const range = this.selection();
    const next = this.text.slice(0, range.from) + text + this.text.slice(range.to);
    const end = range.from + text.length;
    this.accept(next, range, { from: end, to: end });
  }

  history(redo: boolean): void {
    const from = redo ? this.redo : this.undo;
    const to = redo ? this.undo : this.redo;
    const previous = from.pop();
    if (!previous) return;
    to.push({ draft: this.draft, range: this.selection() });
    this.draft = previous.draft;
    this.range = previous.range;
    this.paint();
    this.change();
  }

  private remember(range = this.range): void {
    this.undo.push({ draft: this.draft, range });
    if (this.undo.length > 100) this.undo.shift();
    this.redo = [];
  }

  private readInput(): void {
    const range = this.before;
    this.before = undefined;
    // Обычный ввод меняет текстовые узлы. Для многострочного системного ввода
    // браузер также может создать блочные элементы или переносы.
    const raw = this.el.textContent ?? '';
    const multiline = this.el.querySelector('div, p, br:not([data-editor-end])');
    const text = multiline ? this.el.innerText.replace(/\n$/, raw.endsWith('\n') ? '\n' : '') : raw;
    let next = this.selection();
    if (multiline && range && next.from === next.to) {
      const cursor = range.to + text.length - this.text.length;
      next = { from: cursor, to: cursor };
    }
    this.accept(text, range, next);
  }

  private accept(text: string, previous: TextRange | undefined, next: TextRange): void {
    if (text !== this.text) {
      this.remember(previous);
      let changed = previous;
      // Backspace и Delete при свёрнутом выделении: привязываем удаление к каретке.
      if (previous && previous.from === previous.to && text.length < this.text.length) {
        changed = { from: next.from, to: next.from + this.text.length - text.length };
      }
      this.draft = { ...this.draft, text, runs: remapRuns(this.draft.runs, this.text, text, changed) };
      this.range = next;
      this.paint();
      this.change();
    } else {
      this.range = next;
      this.paint();
    }
  }

  private paint(): void {
    const style = this.style;
    const nodes: Node[] = styledSegments(style, 0, this.text.length).map(seg => {
      const span = document.createElement('span');
      span.textContent = this.text.slice(seg.from, seg.to);
      if (seg.style.color !== style.color) span.style.color = seg.style.color;
      span.style.fontWeight = seg.style.bold ? '700' : '400';
      span.style.fontStyle = seg.style.italic ? 'italic' : 'normal';
      span.style.textDecorationLine = [seg.style.underline && 'underline', seg.style.strike && 'line-through'].filter(Boolean).join(' ');
      return span;
    });
    if (!this.text || this.text.endsWith('\n')) {
      const end = document.createElement('br');
      end.dataset.editorEnd = '';
      nodes.push(end);
    }
    this.el.replaceChildren(...nodes);
    if (document.activeElement === this.el) this.restoreSelection();
  }

  private restoreSelection(): void {
    const walker = document.createTreeWalker(this.el, NodeFilter.SHOW_TEXT);
    const point = (index: number): [Node, number] => {
      walker.currentNode = this.el;
      let offset = Math.max(0, index);
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        const len = node.textContent!.length;
        if (offset <= len) return [node, offset];
        offset -= len;
      }
      return [this.el, 0];
    };
    const { from, to, backward } = this.range;
    window.getSelection()?.setBaseAndExtent(...point(backward ? to : from), ...point(backward ? from : to));
  }
}
