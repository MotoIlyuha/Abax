import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  CHAT_IMAGE_QUALITIES, CHAT_IMAGE_SIDE, ChatImageError, IMAGE_TOO_BIG, IMAGE_UNREADABLE, chatImageSteps, fitSide,
} from '../../src/chat-image';
import {
  ATTACH_IMAGE_TITLE, ATTACH_SELECTION_TITLE, COPY_DENIED, SELECT_FIRST, TASKS_NOTE, VIEW_ONLY_NOTE, attachComposerTools,
  attachImageFile, boardCopies, boardDraftLabel, chatDraft, imageDraft, imageFileFrom, pageTitle, selectionAttachBlock, setChatDraft,
} from '../../src/chat-attach';
import {
  BAD_IMAGE_TEXT, COPY_NO_EDIT, COPY_VIEW_ONLY, GONE_TEXT, HIDDEN_TEXT, boardCopyElements, copyBlock, fitBox, insertBoardCopy,
  renderAttachment, setChatAttachActions, type ChatAttachActions,
} from '../../src/chat-attach-view';
import { INSERT_DENIED, chatLightboxOpen, closeChatLightbox } from '../../src/chat-lightbox';
import { createChatComposer, type ChatComposer } from '../../src/chat-composer';
import {
  chatMessages, chatReceive, chatReset, sendChatMessage, setChatAvailable, setChatCanWrite, setChatSender,
} from '../../src/collab-chat';
import { addElement, blankProject, canUndo, openProject, setCopyGuard, setSelection, state } from '../../src/state';
import { createTaskElement } from '../../src/task-element';
import type { ChatBoardAtt } from '../../src/room-chat';
import type { ShapeEl } from '../../src/types';

const PNG = 'data:image/png;base64,iVBORw0KGgo=';
const rect = (id: string, x = 0): ShapeEl => ({ id, type: 'shape', shape: 'rect', x, y: 0, w: 10, h: 10, color: '#000000', width: 2 });
const task = (id: string) => createTaskElement({ id, x: 0, y: 0, taskId: `t-${id}`, statementMd: '2+2', answer: '4' });
const board = (extra: Partial<ChatBoardAtt> = {}): ChatBoardAtt => ({
  kind: 'board', pageId: 'p1', pageName: 'Страница 1', ids: ['a'], count: 1, preview: PNG, w: 120, h: 80, ...extra,
});

function openBoard(): void {
  openProject(blankProject('Тест'));
  state.camera = { x: 0, y: 0, zoom: 1 };
  state.collabRole = null;
  state.linkMode = null;
  state.view = 'board';
}

let canEdit = true;
const actions: ChatAttachActions & { inserted: string[] } = {
  inserted: [],
  canEdit: () => canEdit,
  insertImage(src) { this.inserted.push(src); },
  goToPage: async () => false,
};

beforeEach(() => {
  document.body.className = 'no-motion no-ui-anim';
  openBoard();
  canEdit = true;
  actions.inserted = [];
  setChatAttachActions(actions);
  setCopyGuard(null);
  setChatDraft(null);
});
afterEach(() => {
  closeChatLightbox(true);
  setChatAttachActions(null);
  setCopyGuard(null);
  document.body.innerHTML = '';
  document.body.className = '';
});

describe('картинка для чата: подбор размера и качества', () => {
  it('fitSide вписывает по длинной стороне и не увеличивает', () => {
    expect(fitSide(4000, 3000, 1280)).toEqual({ w: 1280, h: 960 });
    expect(fitSide(720, 2560, 1280)).toEqual({ w: 360, h: 1280 });
    expect(fitSide(300, 200, 1280)).toEqual({ w: 300, h: 200 });
    expect(fitSide(10000, 1, 1280)).toEqual({ w: 1280, h: 1 });
  });

  it('без прозрачности — JPEG: сначала 1280 px и 0.82, затем ниже качество, затем меньше размер', () => {
    const steps = chatImageSteps(4000, 3000, false, true);
    expect(steps[0]).toEqual({ w: CHAT_IMAGE_SIDE, h: 960, type: 'image/jpeg', quality: 0.82 });
    expect(steps.slice(0, 3).map(s => s.quality)).toEqual([...CHAT_IMAGE_QUALITIES]);
    expect(steps[3]).toMatchObject({ w: 960, h: 720, quality: 0.82 });
    expect(steps.every(s => s.type === 'image/jpeg')).toBe(true);
    // размер не растёт от шага к шагу
    for (let i = 1; i < steps.length; i++) expect(steps[i].w).toBeLessThanOrEqual(steps[i - 1].w);
  });

  it('с прозрачностью — WebP, а без поддержки WebP — PNG только уменьшением размера', () => {
    expect(chatImageSteps(800, 600, true, true)[0]).toEqual({ w: 800, h: 600, type: 'image/webp', quality: 0.82 });
    const png = chatImageSteps(2560, 1440, true, false);
    expect(png.map(s => s.type)).toEqual(png.map(() => 'image/png'));
    expect(png.every(s => s.quality === undefined)).toBe(true);
    expect(png[0]).toMatchObject({ w: 1280, h: 720 });
    expect(png.length).toBe(4);
  });

  it('крошечная картинка: одинаковые размеры не повторяются', () => {
    const steps = chatImageSteps(1, 1, false, false);
    expect(steps).toHaveLength(CHAT_IMAGE_QUALITIES.length);
    expect(steps.every(s => s.w === 1 && s.h === 1)).toBe(true);
  });

  it('ошибка подготовки — понятный текст; иначе — черновик «Изображение · W×H»', async () => {
    expect(await attachImageFile(new Blob(['x']), async () => { throw new ChatImageError(IMAGE_TOO_BIG); })).toBe(IMAGE_TOO_BIG);
    expect(await attachImageFile(new Blob(['x']), async () => { throw new Error('сбой'); })).toBe(IMAGE_UNREADABLE);
    expect(chatDraft()).toBeNull();
    expect(await attachImageFile(new Blob(['x']), async () => ({ src: PNG, w: 1280, h: 720 }))).toBeNull();
    expect(chatDraft()).toEqual({ att: { kind: 'image', src: PNG, w: 1280, h: 720 }, label: 'Изображение · 1280×720' });
  });

  it('файл из буфера или перетаскивания — первая картинка', () => {
    const img = new File(['x'], 'a.png', { type: 'image/png' });
    const txt = new File(['x'], 'a.txt', { type: 'text/plain' });
    const dt = { items: [{ kind: 'file', type: 'text/plain', getAsFile: () => txt }, { kind: 'file', type: 'image/png', getAsFile: () => img }], files: [] };
    expect(imageFileFrom(dt as never)).toBe(img);
    expect(imageFileFrom({ items: [], files: [txt] } as never)).toBeNull();
    expect(imageFileFrom(null)).toBeNull();
  });
});

describe('выделенное во вложение', () => {
  it('копии: без заданий и без поля by; слишком большие — только просмотр', () => {
    const owned = { ...rect('a'), by: 'u:7' } as ShapeEl;
    const r = boardCopies([owned, task('t')]);
    expect(r.tasks).toBe(1);
    expect(r.elements).toHaveLength(1);
    expect(r.elements![0]).not.toHaveProperty('by');
    expect((r.elements![0] as ShapeEl).id).toBe('a');
    expect(owned).toHaveProperty('by', 'u:7'); // оригинал не тронут
    expect(boardCopies([task('t')])).toEqual({ tasks: 1 });
    const huge = { ...rect('h'), text: 'я'.repeat(310_000) } as ShapeEl;
    expect(boardCopies([huge]).elements).toBeUndefined();
  });

  it('подпись чипа: число объектов, страница и пояснения', () => {
    expect(boardDraftLabel({ count: 3, pageName: 'Страница 1', elements: [{}] }, 0)).toEqual({ label: '3 объекта · «Страница 1»' });
    expect(boardDraftLabel({ count: 1, pageName: 'Задачи' }, 0)).toEqual({ label: '1 объект · «Задачи»', note: VIEW_ONLY_NOTE });
    expect(boardDraftLabel({ count: 2, pageName: 'Задачи', elements: [{}] }, 1).note).toBe(TASKS_NOTE);
    expect(pageTitle(state.pageId)).toBe(state.project.pages[0].name.trim() || 'Страница 1');
  });

  it('кнопка недоступна без выделения и при запрете копирования — с подсказкой', () => {
    expect(selectionAttachBlock()).toBe(SELECT_FIRST);
    addElement(rect('a'));
    setSelection(['a']);
    expect(selectionAttachBlock()).toBeNull();
    setCopyGuard(() => false);
    expect(selectionAttachBlock()).toBe(COPY_DENIED);
  });
});

describe('поле ввода: кнопки вложений и чип', () => {
  let c: ChatComposer;
  let tools: ReturnType<typeof attachComposerTools>;
  const sel = () => c.tools.querySelector<HTMLButtonElement>('.composer-attach-selection')!;
  const send = () => c.el.querySelector<HTMLButtonElement>('.composer-send')!;

  beforeEach(() => {
    c = createChatComposer({ submit: () => 'ok' });
    tools = attachComposerTools(c);
    document.body.append(c.el);
  });
  afterEach(() => tools.dispose());

  it('скрепка с выбором картинки и «Прикрепить выделенное»', () => {
    const clip = c.tools.querySelector<HTMLButtonElement>('.composer-attach-image')!;
    expect(clip.getAttribute('aria-label')).toBe(ATTACH_IMAGE_TITLE);
    expect(clip.querySelector('svg')).not.toBeNull();
    const file = c.tools.querySelector<HTMLInputElement>('input[type=file]')!;
    expect(file.accept).toBe('image/*');
    expect(sel().getAttribute('aria-label')).toBe(ATTACH_SELECTION_TITLE);
  });

  it('«Прикрепить выделенное» следит за выделением и правом копирования', () => {
    expect(sel().getAttribute('aria-disabled')).toBe('true');
    expect(sel().title).toBe(SELECT_FIRST);
    addElement(rect('a'));
    setSelection(['a']);
    expect(sel().getAttribute('aria-disabled')).toBe('false');
    expect(sel().title).toBe(ATTACH_SELECTION_TITLE);
    setCopyGuard(() => false);
    setSelection(['a']);
    expect(sel().getAttribute('aria-disabled')).toBe('true');
    expect(sel().title).toBe(COPY_DENIED);
  });

  it('чип: миниатюра, подпись, пояснение, «×» убирает; с чипом можно отправить без текста', () => {
    expect(send().disabled).toBe(true);
    setChatDraft({ att: board(), label: '1 объект · «Страница 1»', note: VIEW_ONLY_NOTE });
    const chip = c.el.querySelector('.cchip')!;
    expect(chip.querySelector('img')!.getAttribute('src')).toBe(PNG);
    expect(chip.querySelector('.cchip-label')!.textContent).toBe('1 объект · «Страница 1»');
    expect(chip.querySelector('.cchip-note')!.textContent).toBe(VIEW_ONLY_NOTE);
    expect(send().disabled).toBe(false);
    chip.querySelector<HTMLButtonElement>('.cchip-remove')!.click();
    expect(chatDraft()).toBeNull();
    expect(c.el.querySelector('.cchip')).toBeNull();
    expect(send().disabled).toBe(true);
  });

  it('негодный data URL не становится src миниатюры', () => {
    setChatDraft({ att: { kind: 'image', src: 'data:image/svg+xml;base64,PHN2Zz4=', w: 1, h: 1 }, label: 'x' });
    expect(c.el.querySelector('.cchip img')).toBeNull();
  });

  it('новое вложение заменяет прежнее — одно на сообщение', () => {
    setChatDraft(imageDraft({ src: PNG, w: 10, h: 10 }));
    setChatDraft(imageDraft({ src: PNG, w: 20, h: 10 }));
    expect(c.el.querySelectorAll('.cchip')).toHaveLength(1);
    expect(c.el.querySelector('.cchip-label')!.textContent).toBe('Изображение · 20×10');
  });
});

describe('вложения в ленте', () => {
  it('картинка: вписана в 240×240, ленивая, с alt; щелчок — просмотр, Esc закрывает', () => {
    const box = renderAttachment({ att: { kind: 'image', src: PNG, w: 1280, h: 720 } })!;
    document.body.append(box);
    const img = box.querySelector('img')!;
    expect(img.getAttribute('src')).toBe(PNG);
    expect(img.loading).toBe('lazy');
    expect(img.decoding).toBe('async');
    expect(img.alt).toBe('Изображение 1280×720');
    expect([img.width, img.height]).toEqual([240, 135]);
    expect(fitBox(100, 400, 240, 240)).toEqual({ w: 60, h: 240 });
    box.click();
    expect(chatLightboxOpen()).toBe(true);
    const lb = document.querySelector('.chat-lightbox')!;
    expect(lb.getAttribute('role')).toBe('dialog');
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(chatLightboxOpen()).toBe(false);
    expect(document.querySelector('.chat-lightbox')).toBeNull();
  });

  it('просмотр: «Вставить на доску» — только с правом правки; щелчок мимо закрывает', () => {
    const box = renderAttachment({ att: { kind: 'image', src: PNG, w: 10, h: 10 } })!;
    document.body.append(box);
    canEdit = false;
    box.click();
    const ins = document.querySelector<HTMLButtonElement>('.clb-insert')!;
    expect(ins.getAttribute('aria-disabled')).toBe('true');
    expect(ins.title).toBe(INSERT_DENIED);
    ins.click();
    expect(actions.inserted).toEqual([]);
    document.querySelector<HTMLElement>('.chat-lightbox')!.click();
    expect(chatLightboxOpen()).toBe(false);
    canEdit = true;
    box.click();
    document.querySelector<HTMLButtonElement>('.clb-insert')!.click();
    expect(actions.inserted).toEqual([PNG]);
    expect(chatLightboxOpen()).toBe(false);
  });

  it('безопасность: негодный data URL не становится src, просмотр не открывается', () => {
    for (const src of ['javascript:alert(1)', 'data:image/svg+xml;base64,PHN2Zz4=', 'data:image/png;base64,AA==" onerror="x', 'https://x/a.png']) {
      const box = renderAttachment({ att: { kind: 'image', src, w: 10, h: 10 } })!;
      expect(box.querySelector('img')).toBeNull();
      expect(box.textContent).toBe(BAD_IMAGE_TEXT);
      const card = renderAttachment({ att: board({ preview: src }) })!;
      expect(card.querySelector('img')).toBeNull();
    }
  });

  it('gone и hidden — плашки с текстом', () => {
    expect(renderAttachment({ att: { kind: 'gone', was: 'image' } })!.textContent).toBe(GONE_TEXT);
    expect(renderAttachment({ att: { kind: 'gone', was: 'board' } })!.className).toBe('cf-att cf-att-gone');
    const h = renderAttachment({ att: { kind: 'hidden' } })!;
    expect(h.textContent).toBe(HIDDEN_TEXT);
    expect(h.querySelector('img')).toBeNull();
  });

  it('карточка объектов: превью, подпись, «Показать» и «Вставить копию»', () => {
    const card = renderAttachment({ att: board({ count: 3, elements: [rect('a')] }) })!;
    expect(card.querySelector('.cf-att-preview img')!.getAttribute('src')).toBe(PNG);
    expect(card.querySelector('.cf-att-label')!.textContent).toBe('3 объекта · «Страница 1»');
    expect(card.querySelector('.cf-att-show')!.textContent).toBe('Показать');
    expect(card.querySelector('.cf-att-copy')!.getAttribute('aria-disabled')).toBe('false');
    const viewOnly = renderAttachment({ att: board() })!;
    expect(viewOnly.querySelector('.cf-att-copy')!.getAttribute('aria-disabled')).toBe('true');
    expect(viewOnly.querySelector<HTMLElement>('.cf-att-copy')!.title).toBe(COPY_VIEW_ONLY);
  });
});

describe('«Вставить копию»', () => {
  it('элементы — через sanitizeElement: негодные и задания отброшены, by снят', () => {
    const els = boardCopyElements({ elements: [{ ...rect('a'), by: 'u:3' }, task('t'), { type: 'shape' }, { id: 'z', type: 'нет такого' }, 5] });
    expect(els.map(e => e.id)).toEqual(['a']);
    expect(els[0]).not.toHaveProperty('by');
  });

  it('вставка в центр видимой области с записью в историю; выделяются копии', () => {
    window.innerWidth = 800; window.innerHeight = 600;
    expect(canUndo()).toBe(false);
    expect(insertBoardCopy({ elements: [rect('a', 0), task('t'), rect('b', 30)] })).toBe(true);
    expect(canUndo()).toBe(true);
    const copies = state.board.elements as ShapeEl[];
    expect(copies).toHaveLength(2);
    expect(copies.every(e => e.type === 'shape' && e.id !== 'a' && e.id !== 'b')).toBe(true);
    // общий центр копий — в центре экрана
    const cx = (Math.min(...copies.map(e => e.x)) + Math.max(...copies.map(e => e.x + e.w))) / 2;
    expect(cx).toBeCloseTo(state.camera.x + window.innerWidth / 2 / state.camera.zoom);
    expect([...state.selection].sort()).toEqual(copies.map(e => e.id).sort());
  });

  it('без права правки или без копий — недоступно, доска не меняется', () => {
    canEdit = false;
    expect(copyBlock({ elements: [rect('a')] })).toBe(COPY_NO_EDIT);
    expect(insertBoardCopy({ elements: [rect('a')] })).toBe(false);
    canEdit = true;
    expect(copyBlock({ elements: [task('t')] })).toBe(COPY_VIEW_ONLY);
    expect(insertBoardCopy({})).toBe(false);
    expect(state.board.elements).toHaveLength(0);
    expect(canUndo()).toBe(false);
  });
});

describe('отправка и приём вложений', () => {
  afterEach(() => {
    setChatAvailable(false);
    setChatCanWrite(true);
    setChatSender(null);
  });

  it('с вложением можно отправить пустой текст; вложение уходит отправителю', () => {
    const sent: unknown[] = [];
    setChatAvailable(true);
    setChatSender((text, att) => { sent.push({ text, att }); return true; });
    const att = { kind: 'image' as const, src: PNG, w: 2, h: 2 };
    expect(sendChatMessage('  ')).toBe('empty');
    expect(sendChatMessage('  ', att)).toBe('ok');
    expect(sent).toEqual([{ text: '', att }]);
  });

  it('входящие: строгая форма вложения — неверный data URL и задания отклоняют сообщение', () => {
    setChatAvailable(true);
    chatReset([], 1);
    const m = (id: string, att: unknown) => ({ id, by: 2, name: 'У2', text: '', ts: Date.now(), att });
    chatReceive(m('bad-src', { kind: 'image', src: 'javascript:1', w: 1, h: 1 }));
    chatReceive(m('task', board({ elements: [{ id: 't', type: 'task' }] })));
    chatReceive(m('kind', { kind: 'что-то' }));
    chatReceive(m('ok', board({ elements: [{ ...rect('a'), by: 'u:1' }] })));
    chatReceive(m('gone', { kind: 'gone', was: 'image', extra: '<b>' }));
    expect(chatMessages().map(x => x.id)).toEqual(['ok', 'gone']);
    const ok = chatMessages()[0].att as ChatBoardAtt;
    expect(ok.elements![0]).not.toHaveProperty('by');
    expect(chatMessages()[1].att).toEqual({ kind: 'gone', was: 'image' });
  });
});

