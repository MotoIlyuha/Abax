import { initTopbarFit, topbarFit } from './topbar-fit';
import { renderAnalyticsSettings } from './analytics-consent';
import { startCrop } from './crop';
import type {
  AnimationMode, BoardSettings, Camera, Element, GridMode, ImageEl, NoteEl, Page, PageTransition, Project, ProjectMeta, ShapeEl, TaskEl, TextAlign, TextEl, TextVAlign,
  ToolId, ToolbarPos, WheelMode,
} from './types';
import { setStickyTool, stickyTool } from './sticky-tool';
import { resolveAnimationMode } from './motion';
import { setZoomCounter } from './zoom-counter';
import { createValueCounter } from './value-counter';
import { initZoomChevron } from './zoom-chevron';
import { claimMenu, closeMenu, drillMenu, menuShown, openMenu, releaseMenu } from './menu-motion';
import { attachOverlayScroll } from './overlay-scroll';
import {
  state, update, onChange, undo, redo, canUndo, canRedo, setTool, setGrid, setCoordLabels, setStyleColor,
  setStyleWidth, setStyleOpacity, pickTool, setNoteColor, selectPreset, presetKind, addElement, replaceElements, pushHistory, uid,
  applyStyleToSelection, colorElement, setSettings, setView, switchPage, addPage, deletePage, renamePage, setSelection,
  openProject, blankProject, blankPage, projectMeta, groupSelected, ungroupSelected, movePage,
  bringForward, sendBackward, moveSelectionLayer, selectionLayerOrder, pinSelectionLayer, deleteSelected, setSolidSides, removeImageFrames, selectInserted,
  clampOpacity, opacityField, OPACITY_MIN, parseZoomPercent,
  addDraft, deleteDraft, onDraft, realPageId,
  canCopyCurrentBoard, canCloneCurrentProject, canAddPageTo, PAGE_LIMIT_TEXT, projectPlan,
} from './state';
import { readClipboardText, type PastedText } from './paste-text';
import { remapRuns } from './text-runs';
import type { PresetKind, StylePatch, StyleValue } from './state';
import { doskaApi, storage } from './storage';
import { isNativeApp, sharePng } from './native';
import { RELEASES_URL, openDesktopApp } from './desktop-app';
import { renderScene, contentBBox, imageEpoch, imagesLoaded, linkView, presentCanvas, renderNow, requestRender, advanceRecursion } from './renderer';
import { easeInOut, linkCameras, lockInput, newPageLink, zoomDuration, zoomPath } from './page-links';
import { makeSortable, reordering } from './reorder';
import { capturePageTransition } from './page-transition';
import { hasBaseSides, SIDES_MAX, SIDES_MIN, solidSides } from './solid';
import {
  type AABB, aabbUnion, elementAABB, hitTest, imageFrame, lineWidth, parseTextSize, shapeCaption, shapeHoldsText, stepTextSize,
  NOTE_W, NOTE_H, NOTE_PAD, NOTE_FONT, NOTE_TEXT_COLOR, SHAPE_TEXT_LH, TEXT_SIZE, TEXT_SIZE_MAX, TEXT_SIZE_MIN, TEXT_SIZES,
} from './geom';
import * as pdfjsLib from 'pdfjs-dist';
// ?worker&inline: воркер инлайнится в бандл и работает из file:// (Electron)
import PdfWorker from 'pdfjs-dist/build/pdf.worker.min.mjs?worker&inline';
import { initNotifyButton } from './notify-button';
import { initNotifyStack } from './notify-stack';
import { collabActive, isHost, myCollabCaps, myColor, noteSelection, readOnly, startHostConnection, stopCollab, type CollabGotoDetail, type CollabSummonDetail } from './collab';
import { animateCameraTo, cameraAnimating, clampZoom } from './camera-anim';
import { stopFollowByUser } from './follow';
import { fillPageAvatars, initCollabPresence } from './collab-presence';
import { closePresent, openPresent, presentOpen } from './present';
import { renderProfileSettings } from './profile-settings';
import { cursorSvg } from './cursors';
import { authErrorText, type AuthOutcome } from './auth';
import { myCursorId, onProfileChange, profileName } from './profile';
import { type ToolbarGroup, onToolbarChange, restoreToolbar, toolDef, toolTip, toolUsesColor, toolbarConfig } from './toolbar';
import { canDropTool, toolDropElement } from './tool-drop';
import {
  addSettingsSection, lastSettingsSection, openSettingsDialog, removeSettingsSection, settingsDialogOpen, type SettingsSection,
} from './settings-dialog';
import { experimentalHeadIcon, experimentsShown, renderExperimental, setExperimentsShown, setRecursionDiscovered } from './experimental';
import { renderToolbarEditor } from './toolbar-editor';
import { GRIP_ROOM, clampFloat, dragFloat, floatSide, orientOfPos, rotateFloat, sanitizeToolbarFloat, type Area, type ToolbarFloat } from './toolbar-float';
import { renderHotkeysSettings } from './hotkeys-settings';
import { DEFAULT_NEW_PAGE_KEY, DRAFT_KEY, comboLabel, macKeys, newPageKeyProblem } from './hotkeys';
import { renderAbout, showToast } from './about';
import { closeIconPicker } from './icon-picker';
import { createIconButton, type IconButton } from './icon-button';
import { capitalize, dayLabel, pagesLabel } from './format';
import { buildCustomColorPicker } from './color-picker';
import { setShown } from './collapse';
import { eyedropperActive } from './eyedropper';
import { copySelection, duplicateSelection as duplicateInPlace, pasteFromMemory, pasteFromSystem } from './clipboard';
import { stretchCancel, stretchClose, stretchOpen } from './stretch';
import { morphLeave } from './morph-tooltip';
import { initMorphPages, morphPagesOpen, morphPagesReset, morphPagesSync } from './morph-pages';
import { hideHeldTooltip, showHeldTooltip } from './tooltip';
import { copyBoardLink, currentBoardLink, registerLinkViewHooks } from './link-view-ui';
import { canCreateProject, isOverPageLimit, isOverProjectLimit, PLAN_LIMITS } from './limits';
import { limitsEnforced, onPlanChange, userPlan } from './plan';
import { proBadge, refreshProBadges, requestUpgrade, setProBadgeNeeded, setUpgradeHandler, startProBadges } from './pro-badge';
import { openPlansDialog, setPlansDialogHooks } from './plans-dialog';
import { renderSubscriptionSettings } from './subscription-settings';
import { mountTierButton, onTierHiddenChange, setTierHidden, tierHidden } from './tier-button';
import { refreshBilling } from './subscription';
import { openProjectDialog, type FirstProjectStep, type ProjectFormValues } from './project-dialog';
import { wireTopName, type TopName } from './topbar-names';
import { PAGE_NAME_MAX, PROJECT_NAME_MAX, defaultProjectName, planNote } from './project-names';
import { pushNotice } from './notify-center';
import { CONFLICT_DRAFT_TEXT, CONFLICT_TEXT, cloudStorage, openFresh, type ConflictResolution } from './cloud-sync';
import { clearStarter, isPristineStarterProject, starterId } from './sync-state';
import { parseProject } from './file';
import { setPanelActions } from './panel-actions';
import { setChatAttachActions } from './chat-attach-view';
import { attachSelection, selectionAttachBlock } from './chat-attach';
import { chatAvailable, chatCanWrite, openChat } from './collab-chat';
import { registerPanelModes } from './panel-modes';
import { closeSidePanel, onSidePanel, sidePanelMode, sidePanelOpen, toggleSidePanel } from './side-panel';
import { initSyncIndicator } from './sync-indicator';
import { openShareDialog as openShareDialogUi, type ShareApi } from './share-dialog';
import { onCancelInteraction } from './interaction';
import { incomingInvites, incomingInvitesSection, onIncomingInvites, refreshIncomingInvites } from './incoming-invites';
import { addGestureProbe } from './gesture';
import { initTaskOverlay, isTeacher } from './task-overlay';
import { initCommentsUi } from './comments-ui';
import { initAnnotLayer } from './annot-layer';
import { initAttention } from './attention';
import { initNoteNotices } from './note-notices';
import { openTaskDialog, taskDialogOpen, type TaskFormValues } from './task-dialog';
import { TASK_H, TASK_W, createTaskElement } from './task-element';
import { createToggleSwitch } from './toggle-switch';
import { ALIGN_ICONS, BACKGROUND_ICON, BACK_ARROW_ICON, COORD_ICON_ZERO, FONT_ICON, GRID_ICONS, GRIP_ICON, ICONS, OPACITY_ICON, PIN_ICON, PROFILE_ICON, SLIDER_TRACK_ICON, GUIDES_ICON, INTERACTIONS_ICON, SMOOTH_PAN_ICON, SNAP_ICON, VALIGN_ICONS, WIDTH_ICON, svg } from './icons';
import { setTopbarGroupHidden } from './topbar-hide';
import {
  browserSetRights, browserShareStatus, startBrowserCloud, startBrowserHost, stopBrowserCloud, stopBrowserHost,
} from './browser-host';

pdfjsLib.GlobalWorkerOptions.workerPort = new PdfWorker();

/** Иконка фона; у координатной плоскости ноль виден, пока деления не скрыты. */
function gridIcon(g: GridMode, coordLabels = true): string {
  return g === 'coord' && coordLabels ? COORD_ICON_ZERO : GRID_ICONS[g];
}

/** Последний выбранный инструмент группы (по id группы) — его иконку показывает кнопка группы. */
const lastGroupTool: Record<string, ToolId> = {};

/** Группа, кнопка которой сейчас на панели инструментов. */
function toolbarGroup(id: string): ToolbarGroup | undefined {
  return toolbarConfig().items.find((it): it is ToolbarGroup => it.type === 'group' && it.id === id && it.tools.length > 0);
}

/** Палитра как в Miro: строки — семейства оттенков, столбцы — светлый / яркий / тёмный / нейтральный. */
const PALETTE = [
  '#fff6b6', '#ffdc4a', '#af7e04', '#ffffff',
  '#f8d3af', '#fe9f4d', '#9b4a08', '#e7e7e7',
  '#ffc6c6', '#ff6464', '#bd0a0a', '#b0b0b0',
  '#adf0c7', '#2dc75c', '#067429', '#595959',
  '#c6dcff', '#659df2', '#305bab', '#1f2329',
  '#dedaff', '#8f7fee', '#6631d7', '#316f45',
  '#d3f0a2', '#5b4100', '#e4f9c1', '#fddaff',
];
const NOTE_PASTELS = ['#ffe066', '#ffd6a5', '#ffd5d5', '#d3f9d8', '#a9def9', '#e4c1f9', '#fde4cf', '#d8f3dc'];
const CUSTOM_MAX = 8;

let canvas: HTMLCanvasElement;
let saveTimer = 0;
let lastPagesKey = '';
let lastHomeKey = '';
let lastSelectionKey = '';

// ----- Персистентность стиля и настроек -----

const CUSTOM_COLORS_KEY = 'doska.customColors';
const STYLE_KEY = 'doska.style';
const SETTINGS_KEY = 'doska.settings';

function loadCustomColors(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(CUSTOM_COLORS_KEY) || '[]');
    return Array.isArray(v) ? v.filter(c => typeof c === 'string').slice(0, CUSTOM_MAX) : [];
  } catch {
    return [];
  }
}

function saveCustomColors(list: string[]): void {
  localStorage.setItem(CUSTOM_COLORS_KEY, JSON.stringify(list.slice(0, CUSTOM_MAX)));
}

function persistStyle(): void {
  localStorage.setItem(STYLE_KEY, JSON.stringify({ ...state.style, noteColor: state.noteColor, presets: state.presets }));
}

function restoreStyle(): void {
  try {
    const v = JSON.parse(localStorage.getItem(STYLE_KEY) || 'null');
    const styleOf = (x: unknown): StyleValue | null => {
      const o = x as { color?: unknown; width?: unknown; opacity?: unknown } | null;
      return o && typeof o.color === 'string' && /^#[0-9a-fA-F]{6}$/.test(o.color) && typeof o.width === 'number'
        ? { color: o.color, width: Math.min(14, Math.max(0.5, o.width)), ...opacityField(clampOpacity(o.opacity)) }
        : null;
    };
    for (const kind of Object.keys(state.presets) as PresetKind[]) {
      const saved = v?.presets?.[kind];
      const set = state.presets[kind];
      if (!saved || !Array.isArray(saved.list)) continue;
      set.list.forEach((_, i) => { set.list[i] = styleOf(saved.list[i]) ?? set.list[i]; });
      if (Number.isInteger(saved.active) && saved.active >= 0 && saved.active < set.list.length) set.active = saved.active;
    }
    // старый формат: один стиль на всё — становится пресетом «остальных» инструментов
    const legacy = !v?.presets ? styleOf(v) : null;
    if (legacy) state.presets.other.list[0] = legacy;
    const set = state.presets[presetKind(state.tool)];
    state.style = { ...set.list[set.active] };
    if (v && typeof v.noteColor === 'string' && /^#[0-9a-fA-F]{6}$/.test(v.noteColor)) {
      state.noteColor = v.noteColor;
    }
  } catch { /* нет сохранённого стиля — дефолт */ }
}

function restoreSettings(): void {
  try {
    const v = JSON.parse(localStorage.getItem(SETTINGS_KEY) || 'null');
    const pos = ['left', 'right', 'top', 'bottom'] as const;
    if (v && pos.includes(v.toolbarPos)) {
      state.settings = {
        toolbarPos: v.toolbarPos as ToolbarPos,
        toolbarDetachable: v.toolbarDetachable === true,
        toolbarFloat: v.toolbarDetachable === true ? sanitizeToolbarFloat(v.toolbarFloat) : null,
        snapToGrid: typeof v.snapToGrid === 'boolean' ? v.snapToGrid : false,
        wheelMode: v.wheelMode === 'scroll' ? 'scroll' : 'zoom',
        pageTransition: PAGE_TRANSITIONS.some(t => t.mode === v.pageTransition) ? v.pageTransition : 'slide',
        pageKeyMod: v.pageKeyMod === 'ctrl' ? 'ctrl' : 'alt',
        mouseMode: v.mouseMode === 'history' || v.mouseMode === 'custom' ? v.mouseMode : 'pages',
        mouseBindings: Object.fromEntries(['1', '3', '4'].map(key => { const b = v.mouseBindings?.[key]; return [key, b && typeof b.action === 'string' && typeof b.label === 'string' ? { action: b.action, label: b.label } : null]; })) as BoardSettings['mouseBindings'],
        newPageKey: DEFAULT_NEW_PAGE_KEY,
        animationMode: resolveAnimationMode(v),
        hideUndoRedo: typeof v.hideUndoRedo === 'boolean' ? v.hideUndoRedo : false,
        keepImageAspect: typeof v.keepImageAspect === 'boolean' ? v.keepImageAspect : true,
        smoothPan: typeof v.smoothPan === 'boolean' ? v.smoothPan : true,
        alignGuides: typeof v.alignGuides === 'boolean' ? v.alignGuides : true,
        closePagesOnPick: typeof v.closePagesOnPick === 'boolean' ? v.closePagesOnPick : false,
        thumbViewport: typeof v.thumbViewport === 'boolean' ? v.thumbViewport : true,
        pageLinks: typeof v.pageLinks === 'boolean' ? v.pageLinks : false,
        recursionEnabled: typeof v.recursionEnabled === 'boolean' ? v.recursionEnabled : false,
      };
      // null — пользователь снял сочетание; занятое или битое значение — снова по умолчанию
      const k = v.newPageKey;
      if (k === null) state.settings.newPageKey = null;
      else if (typeof k === 'string' && !newPageKeyProblem(k, state.settings.pageKeyMod)) state.settings.newPageKey = k;
    }
  } catch { /* дефолт */ }
}

/** Варианты анимации перехода на другую страницу (в настройках доски). */
const PAGE_TRANSITIONS: { mode: PageTransition; name: string; hint: string }[] = [
  { mode: 'none', name: 'Нет', hint: 'Страница сменяется мгновенно' },
  { mode: 'slide', name: 'Слайд', hint: 'Страницы сдвигаются в сторону, как слайды' },
  { mode: 'fade', name: 'Затухание', hint: 'Прежняя страница плавно растворяется' },
  { mode: 'zoom', name: 'Приближение', hint: 'Новая страница выплывает из глубины' },
];

function persistSettings(): void {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(state.settings));
}

/** Варианты режима анимаций (настройка доски «Анимации»). */
const ANIMATION_MODES: { mode: AnimationMode; name: string; hint: string }[] = [
  { mode: 'off', name: 'Выкл', hint: 'Без движения: меню и панели появляются сразу, пружин нет' },
  { mode: 'normal', name: 'Обычные', hint: 'Меню и панели плавно выплывают, подсказка и пружины выключены' },
  { mode: 'enhanced', name: 'Улучшенные', hint: 'Меню и панели выплывают, подсказка панели перетекает от кнопки к кнопке, иконки пружинят' },
];

/**
 * Режим анимаций на классах body: «выкл» гасит появление панелей (no-ui-anim) и пружины (no-motion);
 * «обычные» — только пружины; «улучшенные» — ничего не гасит.
 */
function applyAnimationMode(): void {
  const mode = state.settings.animationMode;
  document.body.classList.toggle('no-ui-anim', mode === 'off');
  document.body.classList.toggle('no-motion', mode !== 'enhanced');
  if (mode !== 'enhanced') morphLeave(true);
  morphPagesReset(pagesOpen);
}

/** Кнопки отмены/повтора в шапке прячутся вместе с разделителями вокруг них (см. style.css). */
/** animate — плавно (при «Улучшенных» анимациях), иначе сразу, как при запуске. */
function applyUndoRedoVisibility(animate = false): void {
  const setClass = (hidden: boolean) => document.body.classList.toggle('hide-undo-redo', hidden);
  if (!animate) { setClass(state.settings.hideUndoRedo); return; }
  setTopbarGroupHidden(document.querySelector<HTMLElement>('.undo-group')!, state.settings.hideUndoRedo, setClass);
}

let styleColorTab: 'border' | 'fill' = 'border';

function currentPanelColor(): string {
  if (styleColorTab === 'fill') {
    const shape = selectedForStyle().find((e): e is ShapeEl => e.type === 'shape' && e.shape !== 'line' && e.shape !== 'arrow');
    return shape?.fill ?? '';
  }
  return state.style.color;
}

/** Выбор цвета: применяется к выделению (если есть) и становится текущим. */
function chooseColor(c: string): void {
  if (styleColorTab === 'fill') {
    applyStyleToSelection({ fill: c });
    const sp = panelOf('style');
    if (sp) {
      updateSwatchActive(sp.el, c);
      sp.el.querySelector('.ctx-fill-clear')?.classList.remove('active');
    }
    refresh();
    return;
  }
  if (state.selection.size > 0 && state.tool !== 'laser') applyStyleToSelection({ color: c });
  setStyleColor(c);
  persistStyle();
  // панель не пересобираем: живой HSV-пикер должен остаться на месте;
  // обновляем только активность свотчей
  const sp = panelOf('style');
  if (sp) {
    updateSwatchActive(sp.el, c);
    sp.el.style.setProperty('--ink', c); // дорожка прозрачности — к новому цвету
  }
  refresh();
}

/** Цвет, который текущая сессия пикера держит первым в «Моих цветах». */
let pickerHead: string | null = null;

/** Цвет из пикера: правит один и тот же свотч, а не плодит новый на каждое движение. */
function choosePickedColor(c: string): void {
  const rest = loadCustomColors().filter(x => x !== c && x !== pickerHead);
  pickerHead = PALETTE.includes(c) ? null : c;
  saveCustomColors(pickerHead ? [c, ...rest] : rest);
  renderCustomSwatches();
  chooseColor(c);
}

/** Подсвечивает текущий цвет в панели без её пересборки. */
function updateSwatchActive(panel: HTMLElement, current: string): void {
  for (const btn of panel.querySelectorAll<HTMLButtonElement>('.ctx-swatch[data-c]')) {
    btn.classList.toggle('active', btn.dataset.c === current);
  }
}

/**
 * Выбор толщины: применяется к выделению (если есть) и становится текущей.
 * first — первое изменение за жест ползунка: в историю пишется один шаг на всё протягивание.
 */
function chooseWidth(w: number, first = true): void {
  const clamped = Math.min(14, Math.max(0.5, Math.round(w * 2) / 2));
  if (state.selection.size > 0) applyStyleToSelection({ width: clamped }, first);
  setStyleWidth(clamped);
  persistStyle();
  refresh();
}

/** Выбор непрозрачности: к выделению (у картинок — к рамке) и как текущая. */
function chooseOpacity(v: number, first: boolean): void {
  if (styleColorTab === 'fill') {
    applyStyleToSelection({ fillOpacity: v }, first);
    return;
  }
  if (state.selection.size > 0) applyStyleToSelection({ opacity: v }, first);
  setStyleOpacity(v);
  persistStyle();
  refresh();
}

/** Скругление углов выделенных прямоугольников и картинок. */
function chooseRadius(v: number, first: boolean): void {
  applyStyleToSelection({ radius: v }, first);
}

// ----- Редактор текста/стикеров (in-place) -----

interface Editing {
  el: TextEl | NoteEl | ShapeEl | null;
  at: { x: number; y: number } | null;
  /** shape — надпись внутри прямоугольника, эллипса или треугольника. */
  target: 'text' | 'note' | 'shape';
  ta: HTMLTextAreaElement;
  /** Кегль и начертание нового текста (у существующего — в самом элементе, их меняет меню выделения). */
  draft: { size: number; bold: boolean; italic: boolean };
}
let editing: Editing | null = null;

/** Набирают новый текст: элемента ещё нет, меню выделения правит черновик. */
function editingNewText(): boolean {
  return !!editing && editing.target === 'text' && !editing.el;
}

/** Фокус ушёл в меню выделения или его панели (поле размера, цвет): ввод текста продолжается. */
function insideTextMenus(t: EventTarget | null): boolean {
  return t instanceof Node && (quickMenuEl().contains(t) || ctxLayerEl().contains(t));
}

/**
 * append — набранный символ, с которого начали ввод надписи выделенной фигуры;
 * backspace — ввод начали с Backspace: последний символ надписи стирается.
 */
export function beginTextEdit(opts: { el?: TextEl | NoteEl | ShapeEl; at?: { x: number; y: number }; target?: 'text' | 'note'; append?: string; backspace?: boolean }): void {
  closeEditor(true);
  const el = opts.el ?? null;
  const target: Editing['target'] = el ? (el.type === 'note' ? 'note' : el.type === 'shape' ? 'shape' : 'text') : (opts.target ?? 'text');
  const ta = document.createElement('textarea');
  ta.rows = 1;
  ta.spellcheck = false;
  ta.className = target === 'text' ? 'inplace-edit' : `inplace-edit ${target}`;
  if (el?.type === 'shape') {
    const chars = Array.from(el.text ?? ''); // по кодовым точкам: эмодзи стирается целиком
    if (opts.backspace) chars.pop();
    ta.value = chars.join('') + (opts.append ?? '');
    state.hideTextId = el.id; // контур остаётся на холсте, надпись живёт в редакторе
  } else if (el) {
    ta.value = el.text;
    state.hideElId = el.id; // прячем канвасную версию, текст живёт в редакторе
  }
  if (target === 'note' && !el && opts.at) {
    state.liveNote = { x: opts.at.x - NOTE_W / 2, y: opts.at.y - NOTE_H / 2, w: NOTE_W, h: NOTE_H, color: state.noteColor };
    // сразу возвращаем выделение, чтобы случайные клики не плодили стикеры
    if (state.tool === 'note') setTool('select');
  }
  if (target === 'text' && !el) {
    // новый текст сразу настраивают в меню выделения: оно — для него; инструмент — снова выделение
    if (state.selection.size > 0) setSelection([]);
    if (state.tool === 'text') setTool('select');
  } else if (el && target !== 'note' && !(state.selection.size === 1 && state.selection.has(el.id))) {
    // меню выделения при вводе — у правящегося элемента
    setSelection([el.id]);
  }
  document.getElementById('overlay')!.appendChild(ta);
  editing = { el, at: opts.at ?? null, target, ta, draft: { size: TEXT_SIZE, bold: false, italic: false } };
  positionEditor();
  syncLiveText();
  update();
  ta.focus();
  ta.setSelectionRange(ta.value.length, ta.value.length);
  ta.addEventListener('keydown', e => {
    e.stopPropagation();
    // Ctrl+B и Ctrl+I — начертание; Ctrl+Z, X, C, V остаются у поля ввода: работают с текстом
    if ((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && (e.code === 'KeyB' || e.code === 'KeyI') && target !== 'note') {
      e.preventDefault();
      toggleTextFlag(e.code === 'KeyB' ? 'bold' : 'italic');
      return;
    }
    // Esc у надписи фигуры — «готово», как в Miro (фигура остаётся выделенной); у текста и стикера — отмена
    if (e.key === 'Escape') { e.preventDefault(); closeEditor(target === 'shape'); }
    else if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); closeEditor(true); }
    // Shift+Enter — перевод строки (стандартное поведение textarea)
  });
  ta.addEventListener('input', () => {
    syncLiveText();
    update(); // подписчик заодно подгоняет размер редактора
  });
  ta.addEventListener('blur', e => {
    if (!insideTextMenus(e.relatedTarget)) closeEditor(true);
  });
}

/** Правящийся элемент — актуальная версия с доски (её могли передвинуть, перекрасить, сменить кегль). */
function editedEl<T extends TextEl | NoteEl | ShapeEl>(e: Editing): T {
  const cur = state.board.elements.find(x => x.id === e.el!.id);
  return (cur?.type === e.el!.type ? cur : e.el) as T;
}

function editedShape(e: Editing): ShapeEl {
  return editedEl<ShapeEl>(e);
}

/** Вводимый текст — в state.liveText: окно демонстрации рисует его вместо редактора. */
function syncLiveText(): void {
  const e = editing;
  if (!e) { state.liveText = null; return; }
  const text = e.ta.value;
  if (e.target === 'shape') {
    // без id: надпись фигуры с этим id не рисуется (её показывает редактор)
    state.liveText = { ...editedShape(e), id: '', text };
  } else if (e.el) {
    const ed = editedEl<TextEl | NoteEl>(e);
    state.liveText = ed.type === 'text' ? withRuns(ed, text) : { ...ed, text };
  } else if (e.target === 'text') {
    state.liveText = { id: '', ...newTextProps(e), text };
  } else {
    const n = state.liveNote;
    state.liveText = n ? { id: '', type: 'note', x: n.x, y: n.y, w: n.w, h: n.h, text, color: n.color } : null;
  }
}

/** Текстовый блок с новым текстом: смешанное форматирование переезжает вместе с неизменённым текстом. */
function withRuns(el: TextEl, text: string): TextEl {
  const { runs: _old, ...rest } = el;
  const runs = remapRuns(el.runs, el.text, text);
  return runs ? { ...rest, text, runs } : { ...rest, text };
}

/** Новый текст по черновику: место, кегль, начертание и текущий цвет. */
function newTextProps(e: Editing): Omit<TextEl, 'id' | 'text'> {
  return {
    type: 'text', x: e.at!.x, y: e.at!.y - e.draft.size * 1.25 / 2, size: e.draft.size, color: state.style.color,
    ...(e.draft.bold ? { bold: true } : {}), ...(e.draft.italic ? { italic: true } : {}), ...opacityField(state.style.opacity),
  };
}

function positionEditor(): void {
  const e = editing;
  if (!e) return;
  const cam = state.camera;
  const z = cam.zoom;
  const ta = e.ta;
  if (e.target === 'shape') {
    positionShapeEditor(ta, editedShape(e));
    return;
  }
  if (e.target === 'note') {
    const n = (e.el as NoteEl | null) ?? state.liveNote;
    if (!n) return;
    ta.style.left = `${(n.x + NOTE_PAD - cam.x) * z}px`;
    ta.style.top = `${(n.y + NOTE_PAD - cam.y) * z}px`;
    ta.style.width = `${(n.w - NOTE_PAD * 2) * z}px`;
    ta.style.fontSize = `${NOTE_FONT * z}px`;
    ta.style.lineHeight = '1.35';
    ta.style.color = NOTE_TEXT_COLOR;
    ta.style.maxHeight = `${(n.h - NOTE_PAD * 2) * z}px`;
  } else {
    const t = e.el ? editedEl<TextEl>(e) : { ...newTextProps(e), text: '' };
    ta.style.left = `${(t.x - cam.x) * z}px`;
    ta.style.top = `${(t.y - cam.y) * z}px`;
    ta.style.fontSize = `${t.size * z}px`;
    ta.style.fontWeight = t.bold ? '700' : '';
    ta.style.fontStyle = t.italic ? 'italic' : '';
    ta.style.lineHeight = '1.25';
    ta.style.color = t.color;
    ta.style.opacity = String(t.opacity ?? 1);
    ta.style.whiteSpace = t.w !== undefined ? 'pre-wrap' : 'pre';
    ta.style.overflowWrap = t.w !== undefined ? 'anywhere' : 'normal';
    if (t.w !== undefined) ta.style.width = `${t.w * z}px`;
    else {
      ta.style.width = '10px';
      ta.style.width = `${Math.max(60, ta.scrollWidth + 12)}px`;
    }
  }
  ta.style.height = 'auto';
  ta.style.height = `${ta.scrollHeight + 2}px`;
}

/** Редактор надписи — в области текста фигуры, тем же кеглем, начертанием, выравниванием и поворотом. */
function positionShapeEditor(ta: HTMLTextAreaElement, s: ShapeEl): void {
  const cam = state.camera;
  const z = cam.zoom;
  const c = shapeCaption(s, ta.value);
  const box = c.box;
  ta.style.width = `${box.w * z}px`;
  ta.style.fontSize = `${c.size * z}px`;
  ta.style.fontWeight = s.bold ? '700' : '';
  ta.style.fontStyle = s.italic ? 'italic' : '';
  ta.style.textAlign = c.align;
  ta.style.lineHeight = String(SHAPE_TEXT_LH);
  ta.style.color = s.color;
  ta.style.opacity = String(s.opacity ?? 1);
  ta.style.height = 'auto';
  const h = ta.scrollHeight;
  ta.style.height = `${h}px`;
  const left = (box.x - cam.x) * z;
  // по вертикали — как на холсте: у верхнего края, по центру или у нижнего
  const top = c.valign === 'top' ? (box.y - cam.y) * z
    : c.valign === 'bottom' ? (box.y + box.h - cam.y) * z - h
      : (box.y + box.h / 2 - cam.y) * z - h / 2;
  ta.style.left = `${left}px`;
  ta.style.top = `${top}px`;
  const rot = s.rot ?? 0;
  ta.style.transformOrigin = `${(s.x + s.w / 2 - cam.x) * z - left}px ${(s.y + s.h / 2 - cam.y) * z - top}px`;
  ta.style.transform = rot ? `rotate(${rot}rad)` : '';
}

export function closeEditor(commit: boolean): void {
  const e = editing;
  if (!e) return;
  editing = null;
  const text = e.ta.value.replace(/[ \t]+$/gm, '').replace(/\s+$/, '');
  e.ta.remove();
  state.hideElId = null;
  state.hideTextId = null;
  state.liveText = null;
  if (e.target === 'shape') {
    commitShapeText(editedShape(e), commit ? text : null);
    return;
  }
  const liveNote = state.liveNote;
  state.liveNote = null;
  // элемент, который правили, — с доски: кегль и начертание могли поменять, пока шёл ввод
  const cur = e.el ? state.board.elements.find(x => x.id === e.el!.id) as TextEl | NoteEl | undefined : undefined;
  if (!commit || text === '') {
    if (commit && cur) {
      // очистили текст существующего элемента — удаляем его
      pushHistory(state.board.elements);
      replaceElements(state.board.elements.filter(x => x.id !== cur.id));
    } else {
      update();
    }
    return;
  }
  if (e.el) {
    // элемент успели удалить или текст не изменился — в истории нечего записывать
    if (!cur || cur.text === text) { update(); return; }
    pushHistory(state.board.elements);
    replaceElements(state.board.elements.map(x => (x.id === cur.id ? (cur.type === 'text' ? withRuns(cur, text) : { ...cur, text }) as Element : x)));
  } else if (e.target === 'text') {
    const id = uid();
    addElement({ id, ...newTextProps(e), text });
    // вставленный текст выделен: его сразу можно двигать и оформлять
    selectInserted(id);
  } else if (liveNote) {
    addElement({ id: uid(), type: 'note', x: liveNote.x, y: liveNote.y, w: liveNote.w, h: liveNote.h, text, color: liveNote.color });
  }
}

/** Надпись фигуры (null — отмена): пустая убирается, фигура остаётся; без изменений — без записи в историю. */
function commitShapeText(s: ShapeEl, text: string | null): void {
  const cur = state.board.elements.find(x => x.id === s.id);
  if (text === null || cur?.type !== 'shape' || (cur.text ?? '') === text) { update(); return; }
  const next: ShapeEl = { ...cur, text };
  if (!text) delete next.text;
  pushHistory(state.board.elements);
  replaceElements(state.board.elements.map(x => (x.id === cur.id ? next : x)));
}

/**
 * Фигура, в которую пойдёт набранный текст (как в Miro: у выделенной фигуры сразу стоит курсор):
 * единственная выделенная — прямоугольник, эллипс или треугольник; редактор ещё не открыт.
 */
export function selectedTextShape(): ShapeEl | null {
  if (editing || state.view !== 'board' || state.tool !== 'select' || state.selection.size !== 1) return null;
  if (!canEditBoard() || settingsDialogOpen()) return null;
  const el = state.board.elements.find(e => state.selection.has(e.id));
  return shapeHoldsText(el) ? el : null;
}

/** Фокус в поле ввода: набранное уходит туда, а не на доску. */
function isTypingField(t: EventTarget | null): boolean {
  return t instanceof HTMLElement && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable);
}

let shapeCaret: HTMLElement | null = null;

/**
 * Мигающий курсор в выделенной фигуре — за последним символом надписи (в пустой — у точки выравнивания).
 * Это только метка: настоящий редактор открывается с первым набранным символом (см. controller.ts).
 */
function syncShapeCaret(): void {
  const el = selectedTextShape();
  if (!el || state.liveEdit || isTypingField(document.activeElement)) {
    shapeCaret?.remove();
    shapeCaret = null;
    return;
  }
  if (!shapeCaret) {
    shapeCaret = document.createElement('div');
    shapeCaret.className = 'shape-caret';
    document.getElementById('overlay')!.appendChild(shapeCaret);
  }
  const c = shapeCaption(el);
  const n = c.lines.length;
  const last = lineWidth(c.lines[n - 1] ?? '', c.size, el.bold, el.italic);
  // верхний конец курсора в системе фигуры, затем — поворот вокруг её центра
  const lx = (c.align === 'left' ? c.x + last : c.align === 'right' ? c.x : c.x + last / 2) + 1;
  const ly = c.top + (n - 1) * c.lh;
  const cx = el.x + el.w / 2, cy = el.y + el.h / 2;
  const rot = el.rot ?? 0;
  const cos = Math.cos(rot), sin = Math.sin(rot);
  const cam = state.camera;
  shapeCaret.style.left = `${(cx + (lx - cx) * cos - (ly - cy) * sin - cam.x) * cam.zoom}px`;
  shapeCaret.style.top = `${(cy + (lx - cx) * sin + (ly - cy) * cos - cam.y) * cam.zoom}px`;
  shapeCaret.style.height = `${c.lh * cam.zoom}px`;
  shapeCaret.style.background = el.color;
  shapeCaret.style.transform = rot ? `rotate(${rot}rad)` : '';
}

// ----- Оформление текста: начертание, кегль, выравнивание -----

/** Текстовые элементы выделения: текст и надписи фигур (у фигуры — если надпись есть или её сейчас набирают). */
function textTargets(): (TextEl | ShapeEl)[] {
  return state.board.elements.filter((e): e is TextEl | ShapeEl =>
    state.selection.has(e.id) && (e.type === 'text' || (shapeHoldsText(e) && (!!e.text || editing?.el?.id === e.id))));
}

interface TextProps {
  size: number;
  bold: boolean;
  italic: boolean;
  /** Кегль надписи подбирается под фигуру. */
  auto: boolean;
  /** Среди оформляемого есть надписи фигур: у них — «Авто» и выравнивание. */
  shapes: boolean;
  align: TextAlign;
  valign: TextVAlign;
}

/** Оформление того, что сейчас правят (новый текст — по черновику) или выделено. null — текста нет. */
function textProps(): TextProps | null {
  const e = editing;
  if (e && editingNewText()) return { ...e.draft, auto: false, shapes: false, align: 'center', valign: 'middle' };
  const els = textTargets();
  if (els.length === 0) return null;
  const first = els[0];
  const shape = els.find((x): x is ShapeEl => x.type === 'shape');
  // у надписи с подобранным кеглем показываем тот, что получился (с учётом набираемого текста)
  const size = first.type === 'text' ? first.size
    : shapeCaption(first, e?.el?.id === first.id ? e.ta.value : first.text).size;
  return {
    size, bold: els.every(x => !!x.bold), italic: els.every(x => !!x.italic),
    auto: first.type === 'shape' && !first.textSize, shapes: !!shape,
    align: shape?.align ?? 'center', valign: shape?.valign ?? 'middle',
  };
}

/** Оформление: у нового текста — в черновик, иначе — выделенным (среди них и правящийся элемент). */
function setTextProps(patch: StylePatch, history = true): void {
  const e = editing;
  if (e && editingNewText()) {
    if (patch.size) e.draft.size = patch.size;
    if (patch.bold !== undefined) e.draft.bold = patch.bold;
    if (patch.italic !== undefined) e.draft.italic = patch.italic;
    syncLiveText();
    update();
    return;
  }
  applyStyleToSelection(patch, history);
}

/** Полужирный или курсив (кнопки B и I, Ctrl+B и Ctrl+I): у всего текстового — включить, если не у всех. */
export function toggleTextFlag(key: 'bold' | 'italic'): void {
  const p = textProps();
  if (p) setTextProps({ [key]: !p[key] });
}

// ----- Контекстная панель (цвет и толщина / стикеры) -----

/** 'style', 'note' или id группы инструментов (у групп свои id, с этими двумя не совпадают). */
type CtxKind = string;
/** Откуда вызвана панель: с тулбара — встаёт сбоку по центру кнопки, из плавающего меню — под ним. */
type CtxSource = 'toolbar' | 'quick';
interface CtxPanel {
  el: HTMLElement;
  kind: CtxKind;
  source: CtxSource;
  /** Высота панели при открытии: центрируемся по ней, чтобы раскрытие пикера росло вниз, а не прыгало. */
  baseHeight: number;
  /** Панель перетащена за ручку: стоит, где оставили, и не закрывается кликом мимо. */
  detached: boolean;
}
/**
 * Открытые панели: не больше одной каждого вида. Пристыкованная к кнопке-вызову — максимум одна,
 * откреплённых может быть сколько угодно.
 */
const ctxPanels: CtxPanel[] = [];
/** Счётчик z-index: панель, которую трогали последней, — поверх остальных. */
let ctxZ = 0;

function ctxLayerEl(): HTMLElement {
  return document.getElementById('ctx-layer')!;
}

function dockedPanel(): CtxPanel | undefined {
  return ctxPanels.find(cp => !cp.detached);
}

function panelOf(kind: CtxKind): CtxPanel | undefined {
  return ctxPanels.find(cp => cp.kind === kind);
}

const isGroupPanel = (cp: CtxPanel): boolean => cp.el.dataset.kind === 'shapes' && cp.source === 'toolbar';

function closePanel(cp: CtxPanel): void {
  const i = ctxPanels.indexOf(cp);
  if (i < 0) return;
  ctxPanels.splice(i, 1);
  if (cp.kind === 'font') qmFrozen = null;
  // группа с панели инструментов втягивается в кнопку (src/stretch.ts); остальные панели и откреплённые — как раньше
  if (isGroupPanel(cp) && !cp.detached) stretchClose(cp.el, ctxAnchor(cp));
  cp.el.remove();
  syncCtxButtons();
}

/** Закрывает пристыкованную панель; откреплённые остаются на доске. */
export function closeCtxPanel(): void {
  const d = dockedPanel();
  if (d) closePanel(d);
}

function openCtxPanel(kind: CtxKind, source: CtxSource): void {
  if (kind === 'style') styleColorTab = 'border';
  // пристыкованное место одно, а вид панели не дублируется
  closeCtxPanel();
  const same = panelOf(kind);
  if (same) closePanel(same);
  // пока открыта панель кегля, меню выделения стоит на месте: текст меняет размер, а меню под ним — не должно «дрожать»
  if (kind === 'font' && source === 'quick') freezeQuickMenu();
  const el = document.createElement('div');
  el.className = 'ctx-panel';
  el.style.zIndex = String(++ctxZ);
  // откуда выплывает при появлении: от панели инструментов или из-под меню выделения
  el.dataset.from = source === 'quick' ? 'quick' : toolbarSide();
  const cp: CtxPanel = { el, kind, source, baseHeight: 0, detached: false };
  ctxPanels.push(cp);
  el.addEventListener('pointerdown', () => { el.style.zIndex = String(++ctxZ); }, { capture: true });
  ctxLayerEl().appendChild(el);
  buildPanelBody(cp);
  el.appendChild(buildCtxBar(cp));
  positionCtxPanel(cp);
  syncCtxButtons();
  if (isGroupPanel(cp)) stretchOpen(el, ctxAnchor(cp));
}

/** Клик по кнопке-вызову: открытую ею (или откреплённую) панель закрывает, иначе открывает. */
function toggleCtxPanel(kind: CtxKind, source: CtxSource): void {
  const cur = panelOf(kind);
  if (cur && (cur.detached || cur.source === source)) closePanel(cur);
  else openCtxPanel(kind, source);
}

function setCtxDetached(cp: CtxPanel, v: boolean): void {
  cp.detached = v;
  if (v) stretchCancel(cp.el);
  cp.el.classList.toggle('detached', v);
  syncCtxButtons();
}

/** Возвращает откреплённую панель к её кнопке-вызову, вытесняя пристыкованную там сейчас. */
function dockCtxPanel(cp: CtxPanel): void {
  closeCtxPanel();
  setCtxDetached(cp, false);
  cp.baseHeight = 0;
  positionCtxPanel(cp);
}

/** Правый верхний угол: ручка перетаскивания, у откреплённой — ещё pin к кнопке-вызову. */
function buildCtxBar(cp: CtxPanel): HTMLElement {
  const bar = document.createElement('div');
  bar.className = 'ctx-bar';
  const pin = document.createElement('button');
  pin.className = 'ctx-pin';
  pin.title = cp.source === 'quick' ? 'Вернуть под меню выделения' : 'Вернуть к панели инструментов';
  pin.innerHTML = PIN_ICON;
  pin.addEventListener('click', () => dockCtxPanel(cp));
  const grip = document.createElement('div');
  grip.className = 'ctx-grip';
  grip.title = 'Перетащить';
  grip.innerHTML = GRIP_ICON;
  grip.addEventListener('pointerdown', e => {
    e.preventDefault();
    const p = cp.el;
    const startX = e.clientX;
    const startY = e.clientY;
    const left0 = p.offsetLeft;
    const top0 = p.offsetTop;
    let moved = false;
    try { grip.setPointerCapture(e.pointerId); } catch { /* синтетический pointer */ }
    const onMove = (ev: PointerEvent) => {
      const dx = ev.clientX - startX;
      const dy = ev.clientY - startY;
      // мелкое дрожание при клике — ещё не перенос
      if (!moved && Math.hypot(dx, dy) < 3) return;
      moved = true;
      if (!cp.detached) setCtxDetached(cp, true);
      placeDetached(cp, left0 + dx, top0 + dy);
    };
    const onUp = () => {
      grip.removeEventListener('pointermove', onMove);
      grip.removeEventListener('pointerup', onUp);
      grip.removeEventListener('pointercancel', onUp);
    };
    grip.addEventListener('pointermove', onMove);
    grip.addEventListener('pointerup', onUp);
    grip.addEventListener('pointercancel', onUp);
  });
  bar.append(pin, grip);
  return bar;
}

/** Ставит открепленную панель в точку, не выпуская её за пределы холста. */
function placeDetached(cp: CtxPanel, left: number, top: number): void {
  const p = cp.el;
  const wrap = document.getElementById('canvas-wrap')!;
  const margin = 8;
  p.style.maxHeight = `${wrap.clientHeight - margin * 2}px`;
  p.style.left = `${Math.max(margin, Math.min(left, wrap.clientWidth - p.offsetWidth - margin))}px`;
  p.style.top = `${Math.max(margin, Math.min(top, wrap.clientHeight - p.offsetHeight - margin))}px`;
}

function toggleStylePanel(source: CtxSource): void {
  toggleCtxPanel('style', source);
}

/** Панель «открыта этой кнопкой»: пристыкована к ней или откреплена (тогда кнопка её закроет). */
function ctxOpenFrom(kind: CtxKind, source: CtxSource): boolean {
  const cp = panelOf(kind);
  return !!cp && (cp.detached || cp.source === source);
}

/** Кнопка-вызов подсвечена, пока её панель открыта. */
function syncCtxButtons(): void {
  for (const b of document.querySelectorAll('#toolbar .style-btn')) {
    b.classList.toggle('active', b.hasAttribute('data-ctx') && ctxOpenFrom('style', 'toolbar'));
  }
  quickMenuEl().querySelector('[data-ctx="style"]')?.classList.toggle('active', ctxOpenFrom('style', 'quick'));
}

/** Элемент, вызвавший панель (кнопка тулбара или плавающего меню). */
function ctxAnchor(cp: CtxPanel): HTMLElement | null {
  const host = cp.source === 'quick' ? quickMenuEl() : document.getElementById('toolbar')!;
  if (host.hidden) return null;
  const own = host.querySelector<HTMLElement>(`[data-ctx="${cp.kind}"]`);
  // стикер, убранный в группу, показывает цвета у кнопки этой группы
  if (!own && cp.kind === 'note' && cp.source === 'toolbar') return host.querySelector<HTMLElement>('[data-tools~="note"]');
  return own;
}

/** Пристыкованную панель держим у её кнопки (без кнопки — закрываем), откреплённые — в пределах холста. */
function positionCtxPanels(includeDetached = false): void {
  for (const cp of [...ctxPanels]) {
    if (!cp.detached || includeDetached) positionCtxPanel(cp);
  }
}

function positionCtxPanel(cp: CtxPanel): void {
  const p = cp.el;
  // откреплённая панель живёт сама по себе: только держим её в пределах холста
  if (cp.detached) { placeDetached(cp, p.offsetLeft, p.offsetTop); return; }
  const ar = ctxAnchor(cp)?.getBoundingClientRect();
  if (!ar || ar.width === 0) { closePanel(cp); return; }
  const wr = document.getElementById('canvas-wrap')!.getBoundingClientRect();
  const gap = 10;
  const margin = 8;
  // естественная высота без max-height: прокручиваемая часть целиком
  const scroller = p.querySelector<HTMLElement>('.ctx-scroll');
  const natural = scroller ? p.offsetHeight - scroller.clientHeight + scroller.scrollHeight : p.offsetHeight;
  if (!cp.baseHeight) cp.baseHeight = natural;
  const w = p.offsetWidth;
  const ax = ar.left + ar.width / 2 - wr.left;
  const ay = ar.top + ar.height / 2 - wr.top;
  let left = ax - w / 2;
  let top: number;
  let maxH: number;
  if (cp.source === 'quick') {
    // как в Miro: сразу под плавающим меню, по центру кнопки; не влезает — над меню
    const qr = quickMenuEl().getBoundingClientRect();
    const below = wr.bottom - qr.bottom - gap - margin;
    const above = qr.top - wr.top - gap - margin;
    // небольшие панели оформления текста — над меню, если влезают: не закрывают набираемый текст
    const preferAbove = (cp.kind === 'font' || cp.kind === 'align') && above >= natural;
    if (!preferAbove && (below >= Math.min(natural, 260) || below >= above)) {
      maxH = below;
      top = qr.bottom - wr.top + gap;
    } else {
      maxH = above;
      top = qr.top - wr.top - gap - Math.min(natural, above);
    }
  } else {
    // центр панели — на уровне кнопки инструмента
    const tr = document.getElementById('toolbar')!.getBoundingClientRect();
    const pos = toolbarSide();
    if (pos === 'left' || pos === 'right') {
      maxH = wr.height - margin * 2;
      left = pos === 'left' ? tr.right - wr.left + gap : tr.left - wr.left - w - gap;
      top = ay - Math.min(cp.baseHeight, maxH) / 2;
    } else if (pos === 'top') {
      maxH = wr.bottom - tr.bottom - gap - margin;
      top = tr.bottom - wr.top + gap;
    } else {
      maxH = tr.top - wr.top - gap - margin;
      top = tr.top - wr.top - gap - Math.min(natural, maxH);
    }
  }
  maxH = Math.max(120, maxH);
  p.style.maxHeight = `${maxH}px`;
  const h = Math.min(natural, maxH);
  left = Math.max(margin, Math.min(left, wr.width - w - margin));
  top = Math.max(margin, Math.min(top, wr.height - h - margin));
  p.style.left = `${left}px`;
  p.style.top = `${top}px`;
}

function buildToolGroupPanel(cp: CtxPanel, groupId: string): void {
  const p = cp.el;
  const group = toolbarGroup(groupId);
  // панели групп оформлены одинаково (data-kind='shapes'), различаются набором кнопок
  p.dataset.kind = 'shapes';
  const title = document.createElement('div');
  title.className = 'ctx-title';
  title.textContent = group?.name ?? '';
  p.appendChild(title);
  const grid = document.createElement('div');
  grid.className = 'ctx-shapes';
  for (const id of group?.tools ?? []) {
    const b = document.createElement('button');
    b.className = 'tool' + (state.tool === id ? ' active' : '');
    b.title = toolTip(id);
    b.innerHTML = toolDef(id).icon;
    b.dataset.shape = id;
    if (canDropTool(id)) {
      b.classList.add('tool-drop');
      b.addEventListener('pointerdown', e => {
        if (e.button === 0 && e.isPrimary) {
          startToolDrop(id, e, () => { if (!cp.detached) closePanel(cp); });
        }
      });
    }
    b.addEventListener('click', () => {
      if (dropClickBlocked()) return;
      // откреплённая панель работает как палитра — остаётся открытой, подсветку обновит refresh()
      if (!cp.detached) closePanel(cp);
      pickTool(id);
    });
    grid.appendChild(b);
  }
  p.appendChild(grid);
}

/** Панель инструментов перенастроили: панели групп пересобираем, у исчезнувших групп — закрываем. */
function syncGroupPanels(): void {
  for (const cp of [...ctxPanels]) {
    if (PANEL_KINDS.has(cp.kind)) continue;
    if (!toolbarGroup(cp.kind)) { closePanel(cp); continue; }
    cp.el.textContent = '';
    buildToolGroupPanel(cp, cp.kind);
    cp.el.appendChild(buildCtxBar(cp));
  }
}

function sectionHead(text: string): HTMLElement {
  const d = document.createElement('div');
  d.className = 'ctx-section';
  d.textContent = text;
  return d;
}

function isLightColor(hex: string): boolean {
  const n = parseInt(hex.slice(1), 16);
  return 0.299 * ((n >> 16) & 255) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255) > 165;
}

/** Круглый свотч в стиле Miro; у активного — галочка контрастного цвета. */
let colorMenuController: AbortController | null = null;
let allColorsCollapsed = false;
/** «Все цвета» свернула открытая панель «Добавить цвет»: при её закрытии разворачиваем обратно. */
let allAutoCollapsed = false;
let draggedColor: { color: string; custom: boolean } | null = null;
function changeFavorite(c: string, add: boolean): void {
  const rest = loadCustomColors().filter(x => x !== c);
  saveCustomColors(add ? [c, ...rest] : rest);
  renderCustomSwatches();
}
function makeSwatch(c: string, active: boolean, onPick: (c: string) => void, custom = false): HTMLButtonElement {
  const b = document.createElement('button');
  b.className = 'ctx-swatch' + (active ? ' active' : '');
  b.dataset.c = c;
  b.title = c;
  b.style.background = c;
  b.style.setProperty('--check', isLightColor(c) ? '#1f2329' : '#ffffff');
  b.addEventListener('click', () => onPick(c));
  if (onPick === chooseColor) {
    b.draggable = true;
    b.addEventListener('dragstart', e => { draggedColor = { color: c, custom }; e.dataTransfer?.setData('text/plain', c); });
    b.addEventListener('dragend', () => { draggedColor = null; document.querySelector('.ctx-my-colors.drop-over')?.classList.remove('drop-over'); });
    b.addEventListener('contextmenu', e => {
      e.preventDefault(); e.stopPropagation();
      colorMenuController?.abort();
      document.querySelector('.color-context-menu')?.remove();
      const controller = new AbortController();
      colorMenuController = controller;
      const menu = document.createElement('div');
      menu.className = 'color-context-menu';
      const action = document.createElement('button');
      action.textContent = custom ? 'Убрать из моих цветов' : 'Добавить в мои цвета';
      const close = () => { controller.abort(); menu.remove(); };
      action.addEventListener('click', () => { changeFavorite(c, !custom); close(); });
      menu.appendChild(action); document.body.appendChild(menu);
      menu.style.left = `${Math.min(e.clientX, window.innerWidth - menu.offsetWidth - 4)}px`;
      menu.style.top = `${Math.min(e.clientY, window.innerHeight - menu.offsetHeight - 4)}px`;
      document.addEventListener('pointerdown', event => {
        if (!menu.contains(event.target as Node)) close();
      }, { signal: controller.signal });
    });
  }
  return b;
}

function renderCustomSwatches(): void {
  const grid = panelOf('style')?.el.querySelector<HTMLElement>('.ctx-swatches.custom');
  if (!grid) return;
  grid.textContent = '';
  const list = loadCustomColors();
  for (const c of list) grid.appendChild(makeSwatch(c, c === currentPanelColor(), chooseColor, true));
  // приёмник перетаскивания занимает остаток ряда за свотчами; текст — только пока своих цветов нет
  const cols = 4;
  const hint = document.createElement('div');
  hint.className = 'ctx-drop-hint';
  if (list.length === 0) {
    hint.style.gridColumn = `span ${cols}`;
    const strong = document.createElement('b');
    strong.textContent = 'Мои цвета';
    const text = document.createElement('span');
    text.append('Перетащите цвет сюда, чтобы добавить его в ', strong);
    hint.appendChild(text);
  } else {
    hint.style.gridColumn = `span ${cols - (list.length % cols)}`;
    hint.title = 'Перетащите цвет сюда, чтобы добавить его в «Мои цвета»';
  }
  grid.appendChild(hint);
}

/** Выделенные элементы, к которым относится панель из меню выделения. */
function selectedForStyle(): Element[] {
  return state.board.elements.filter(e => state.selection.has(e.id));
}

/** Толщина нужна с тулбара и для выделенных линий/фигур и рамок картинок (у текста и стикеров её нет). */
function styleNeedsWidth(source: CtxSource): boolean {
  if (source === 'toolbar') return state.tool !== 'laser'; // у указки только цвет
  return selectedForStyle().some(e =>
    e.type === 'stroke' || e.type === 'shape' || e.type === 'poly' || e.type === 'solid' || e.type === 'image');
}

/** Прозрачность — у всего, кроме стикеров. */
function styleNeedsOpacity(source: CtxSource): boolean {
  if (source === 'toolbar' && state.tool === 'laser') return false;
  return source === 'toolbar' || selectedForStyle().some(e => e.type !== 'note');
}

/** Скругляются прямоугольники и картинки, выделенные на доске. */
function roundable(e: Element): e is ShapeEl | ImageEl {
  return e.type === 'image' || (e.type === 'shape' && e.shape === 'rect');
}

const RADIUS_MAX = 50;

/** Уголок с тем же скруглением, что выбрано на ползунке. */
function cornerIcon(v: number): string {
  const r = (Math.min(v, RADIUS_MAX) / RADIUS_MAX) * 13;
  const arc = r > 0.2 ? `A${r.toFixed(2)} ${r.toFixed(2)} 0 0 1 ${(5 + r).toFixed(2)} 5` : '';
  return svg(`<path d="M5 19V${(5 + r).toFixed(2)}${arc}H19"/>`);
}

function hasFramedImage(): boolean {
  return selectedForStyle().some(e => e.type === 'image' && !!imageFrame(e));
}

/** Рамку добавили цветом или толщиной, убрали кнопкой или отменой — кнопка «Убрать рамку» следом. */
function syncFrameOff(): void {
  const off = panelOf('style')?.el.querySelector<HTMLElement>('.ctx-frame-off');
  if (off) off.hidden = !hasFramedImage();
}

/** Толщина подписью: до десятых, с запятой. */
function formatWidth(v: number): string {
  return String(Math.round(v * 10) / 10).replace('.', ',');
}

/** Единая панель в духе Miro: толщина, прозрачность и скругление сверху, ниже свои и все цвета. */
function buildStylePanel(cp: CtxPanel): void {
  const p = cp.el;
  p.dataset.kind = 'style';
  p.dataset.selection = `${state.pageId}:${[...state.selection].sort().join(',')}`;
  const selected = selectedForStyle();
  const hasFill = selected.some(e => e.type === 'shape' && e.shape !== 'line' && e.shape !== 'arrow');
  if (!hasFill) styleColorTab = 'border';
  p.style.setProperty('--ink', currentPanelColor() || 'transparent');
  if (styleNeedsWidth(cp.source)) {
    // как у прозрачности и скругления: иконка — «капля» — значение
    const row = document.createElement('div');
    row.className = 'ctx-range ctx-width';
    row.title = 'Толщина';
    const icon = document.createElement('span');
    icon.className = 'ctx-range-icon';
    icon.innerHTML = WIDTH_ICON;
    const sliderHost = document.createElement('div');
    sliderHost.className = 'ctx-drop-slider';
    const val = document.createElement('span');
    val.className = 'ctx-range-val';
    const counter = createValueCounter(val, formatWidth, 0.05, state.style.width);
    const show = (v: number) => counter.set(v);
    buildDropSlider(sliderHost, state.style.width, (v, first) => {
      show(v);
      chooseWidth(v, first);
    });
    row.append(icon, sliderHost, val);
    p.appendChild(row);
  }
  const sel = cp.source === 'quick' || cp.detached ? selected : [];
  const round = sel.filter(roundable);
  if (round.length > 0) {
    p.appendChild(buildRange({
      kind: 'radius', title: 'Скругление углов', min: 0, max: RADIUS_MAX, step: 1, value: round[0].radius ?? 0,
      format: v => String(v), icon: cornerIcon, onChange: chooseRadius,
    }));
  }
  if (sel.some(e => e.type === 'image')) {
    // кнопка видна, пока у выделенных картинок есть рамка (см. syncFrameOff)
    const off = document.createElement('button');
    off.className = 'ctx-frame-off';
    off.textContent = 'Убрать рамку';
    off.hidden = !hasFramedImage();
    off.addEventListener('click', () => removeImageFrames());
    p.appendChild(off);
  }
  if (hasFill) {
    const tabs = document.createElement('div');
    tabs.className = 'ctx-color-tabs';
    for (const [tab, label] of [['border', 'Рамка'], ['fill', 'Заливка']] as const) {
      const button = document.createElement('button');
      button.textContent = label;
      button.className = tab === styleColorTab ? 'active' : '';
      button.setAttribute('aria-pressed', String(tab === styleColorTab));
      button.addEventListener('click', () => { styleColorTab = tab; rebuildPanel(cp); });
      tabs.appendChild(button);
    }
    p.appendChild(tabs);
  }
  const scroll = document.createElement('div');
  scroll.className = 'ctx-scroll';
  if (hasFill && styleColorTab === 'fill') {
    const clear = document.createElement('button');
    clear.className = 'ctx-fill-clear';
    clear.textContent = 'Без заливки';
    clear.classList.toggle('active', !currentPanelColor());
    clear.addEventListener('click', () => { applyStyleToSelection({ fill: null }); rebuildPanel(cp); });
    scroll.appendChild(clear);
  }
  const add = document.createElement('button');
  add.className = 'ctx-add-color';
  add.textContent = '+ Добавить цвет';
  // пикер стоит над свотчами: новый свотч не сдвигает его под курсором
  const pickerHost = document.createElement('div');
  pickerHost.className = 'ctx-picker';
  pickerHost.hidden = true;
  let pickerOpen = false;
  const reposition = () => positionCtxPanel(cp);
  add.addEventListener('click', () => {
    pickerOpen = !pickerOpen;
    if (pickerOpen) {
      pickerHead = null;
      buildCustomColorPicker(pickerHost, currentPanelColor() || '#ffffff', choosePickedColor, { eyedropper: true });
      // пикер вместо «Всех цветов»: панель не растягивается на два больших блока
      if (!allColorsCollapsed) { allAutoCollapsed = true; allColorsCollapsed = true; updateCollapsed(true); }
    } else if (allAutoCollapsed) {
      allAutoCollapsed = false; allColorsCollapsed = false; updateCollapsed(true);
    }
    setShown(pickerHost, pickerOpen, reposition);
    add.textContent = pickerOpen ? 'Готово' : '+ Добавить цвет';
  });
  const custom = document.createElement('div');
  custom.className = 'ctx-swatches custom';
  const all = document.createElement('div');
  all.className = 'ctx-swatches';
  for (const c of PALETTE) all.appendChild(makeSwatch(c, c === currentPanelColor(), chooseColor));
  // сворачивается обёртка без отступов: у сетки есть padding, высота сетки до нуля не доедет
  const allWrap = document.createElement('div');
  allWrap.className = 'ctx-all-colors';
  allWrap.appendChild(all);
  const myHeader = sectionHead('Мои цвета');
  myHeader.classList.add('ctx-section-row'); myHeader.appendChild(add);
  const allHeader = sectionHead('Все цвета');
  allHeader.classList.add('ctx-section-row');
  const toggle = document.createElement('button'); toggle.className = 'ctx-section-action';
  function updateCollapsed(animate: boolean): void {
    toggle.textContent = allColorsCollapsed ? 'Развернуть' : 'Свернуть';
    if (animate) setShown(allWrap, !allColorsCollapsed, reposition);
    else allWrap.hidden = allColorsCollapsed;
  }
  toggle.addEventListener('click', () => { allAutoCollapsed = false; allColorsCollapsed = !allColorsCollapsed; updateCollapsed(true); });
  // панель пересобрали с открытым пикером (пикер после пересборки закрыт) — «Все цвета» возвращаются
  if (allAutoCollapsed) { allAutoCollapsed = false; allColorsCollapsed = false; }
  allHeader.appendChild(toggle); updateCollapsed(false);
  const dropZone = (zone: HTMLElement, addFavorite: boolean) => {
    // «Мои цвета» подсвечивают приёмник синим, пока цвет над зоной
    const over = (on: boolean) => { if (addFavorite) zone.classList.toggle('drop-over', on); };
    zone.addEventListener('dragover', e => { if (draggedColor) { e.preventDefault(); if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy'; over(true); } });
    zone.addEventListener('dragleave', e => { if (!(e.relatedTarget instanceof Node && zone.contains(e.relatedTarget))) over(false); });
    zone.addEventListener('drop', e => { over(false); if (!draggedColor) return; e.preventDefault(); e.stopPropagation(); changeFavorite(draggedColor.color, addFavorite); });
  };
  const mine = document.createElement('div'); mine.className = 'ctx-my-colors';
  mine.append(myHeader, pickerHost, custom); dropZone(mine, true);
  const allSection = document.createElement('div'); allSection.append(allHeader, allWrap); dropZone(allSection, false);
  // прозрачность — в самом низу «Всех цветов»; не в сворачиваемой обёртке, чтобы не пропадала при сворачивании
  if (styleNeedsOpacity(cp.source)) {
    allSection.appendChild(buildRange({
      kind: 'opacity', title: 'Прозрачность', min: OPACITY_MIN, max: 1, step: 0.01, value: styleColorTab === 'fill' ? ((selected.find((e): e is ShapeEl => e.type === 'shape' && e.shape !== 'line' && e.shape !== 'arrow')?.fillOpacity) ?? (selected.find((e): e is ShapeEl => e.type === 'shape' && e.shape !== 'line' && e.shape !== 'arrow')?.opacity) ?? 1) : (state.style.opacity ?? 1),
      format: v => `${Math.round(v * 100)}%`, icon: () => OPACITY_ICON, onChange: chooseOpacity,
    }));
  }
  scroll.append(mine, allSection);
  p.appendChild(scroll);
  renderCustomSwatches();
}

// ----- Кастомный слайдер толщины «капля» -----

const WIDTH_MIN = 0.5;
const WIDTH_MAX = 14;

/** Слайдер формы капли: слева узко, справа широко; ручка растёт с толщиной. first — начало протягивания. */
function buildDropSlider(host: HTMLElement, initial: number, onChange: (v: number, first: boolean) => void): void {
  host.textContent = '';
  let value = Math.min(WIDTH_MAX, Math.max(WIDTH_MIN, initial));
  let first = true;
  const track = document.createElement('div');
  track.className = 'qs-track';
  track.innerHTML = SLIDER_TRACK_ICON;
  const thumb = document.createElement('div');
  thumb.className = 'qs-thumb';
  host.append(track, thumb);
  const apply = (emit: boolean) => {
    const frac = (value - WIDTH_MIN) / (WIDTH_MAX - WIDTH_MIN);
    const d = 10 + frac * 14;
    thumb.style.width = `${d}px`;
    thumb.style.height = `${d}px`;
    // центр ручки ходит от 5px (радиус при минимуме) до «ширина − 12px» (радиус при максимуме):
    // ручка не вылезает за края, а на минимуме закрывает тонкий хвост дорожки
    thumb.style.left = `calc(5px + (100% - 17px) * ${frac.toFixed(4)} - ${d / 2}px)`;
    if (emit) {
      onChange(Math.round(value * 2) / 2, first);
      first = false;
    }
  };
  const pointToValue = (e: PointerEvent) => {
    const r = track.getBoundingClientRect();
    // центр ручки ходит от 5px до «ширина − 12px» (см. apply)
    const frac = Math.max(0, Math.min(1, (e.clientX - r.left - 5) / Math.max(1, r.width - 17)));
    value = WIDTH_MIN + frac * (WIDTH_MAX - WIDTH_MIN);
    apply(true);
  };
  track.addEventListener('pointerdown', e => {
    track.setPointerCapture(e.pointerId);
    first = true;
    pointToValue(e);
  });
  track.addEventListener('pointermove', e => {
    if (e.buttons > 0) pointToValue(e);
  });
  apply(false);
}

// ----- Ползунки прозрачности и скругления -----

interface RangeOpts {
  kind: string;
  title: string;
  min: number;
  max: number;
  step: number;
  value: number;
  format: (v: number) => string;
  /** Иконка слева: перерисовывается вместе со значением. */
  icon: (v: number) => string;
  /** first — первое изменение за жест (протягивание или нажатие клавиши): шаг истории. */
  onChange: (v: number, first: boolean) => void;
}

/** Строка «иконка — дорожка — значение»; тянется мышью и пальцем, стрелки меняют по шагу. */
function buildRange(o: RangeOpts): HTMLElement {
  const row = document.createElement('div');
  row.className = `ctx-range ctx-${o.kind}`;
  row.title = o.title;
  const icon = document.createElement('span');
  icon.className = 'ctx-range-icon';
  const track = document.createElement('div');
  track.className = 'ctx-range-track';
  track.tabIndex = 0;
  track.setAttribute('role', 'slider');
  track.setAttribute('aria-label', o.title);
  track.setAttribute('aria-valuemin', String(o.min));
  track.setAttribute('aria-valuemax', String(o.max));
  const thumb = document.createElement('div');
  thumb.className = 'ctx-range-thumb';
  track.appendChild(thumb);
  const val = document.createElement('span');
  val.className = 'ctx-range-val';
  row.append(icon, track, val);
  // числа меняются так же, как процент масштаба в МВВ: по режиму анимаций (src/value-counter.ts)
  const counter = createValueCounter(val, o.format, (o.max - o.min) / 200, o.value);
  const snap = (v: number) => Number(Math.min(o.max, Math.max(o.min, Math.round(v / o.step) * o.step)).toFixed(4));
  let value = snap(o.value);
  let fresh = true;
  let painted = false;
  const paint = () => {
    const frac = (value - o.min) / (o.max - o.min);
    thumb.style.left = `${(frac * 100).toFixed(2)}%`;
    track.setAttribute('aria-valuenow', String(value));
    track.setAttribute('aria-valuetext', o.format(value));
    counter.set(value, !painted);
    painted = true;
    icon.innerHTML = o.icon(value);
  };
  const emit = (v: number) => {
    const next = snap(v);
    if (next === value) return;
    value = next;
    paint();
    o.onChange(value, fresh);
    fresh = false;
  };
  const pointTo = (e: PointerEvent) => {
    const r = track.getBoundingClientRect();
    emit(o.min + Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)) * (o.max - o.min));
  };
  track.addEventListener('pointerdown', e => {
    try { track.setPointerCapture(e.pointerId); } catch { /* синтетический pointer */ }
    fresh = true;
    pointTo(e);
  });
  track.addEventListener('pointermove', e => {
    if (e.buttons > 0) pointTo(e);
  });
  track.addEventListener('keydown', e => {
    const page = (o.max - o.min) / 10;
    const to: Record<string, number> = {
      ArrowRight: value + o.step, ArrowUp: value + o.step, ArrowLeft: value - o.step, ArrowDown: value - o.step,
      PageUp: value + page, PageDown: value - page, Home: o.min, End: o.max,
    };
    if (!(e.key in to)) return;
    e.preventDefault();
    e.stopPropagation();
    fresh = true;
    emit(to[e.key]);
  });
  paint();
  return row;
}

/** Индикатор «цвет + толщина» как в Miro: кружок, внутри точка текущего цвета, её размер — толщина. */
function styleIndicator(withWidth: boolean, style: StyleValue = state.style): HTMLElement {
  const ring = document.createElement('i');
  ring.className = 'style-ind';
  ring.appendChild(document.createElement('b'));
  paintStyleIndicator(ring, withWidth, style);
  return ring;
}

function paintStyleIndicator(ring: HTMLElement, withWidth: boolean, style: StyleValue = state.style): void {
  const dot = ring.firstElementChild as HTMLElement;
  // у элементов толщина бывает больше максимума слайдера — точка не должна вылезать из кольца
  const frac = Math.max(0, Math.min(1, (style.width - WIDTH_MIN) / (WIDTH_MAX - WIDTH_MIN)));
  const d = withWidth ? Math.round(7 + frac * 9) : 14;
  dot.style.width = `${d}px`;
  dot.style.height = `${d}px`;
  dot.style.background = style.color;
  dot.style.opacity = String(style.opacity ?? 1);
}

function buildNotePanel(cp: CtxPanel): void {
  const p = cp.el;
  p.dataset.kind = 'note';
  p.appendChild(sectionHead('Цвет стикера'));
  const grid = document.createElement('div');
  grid.className = 'ctx-swatches';
  for (const c of NOTE_PASTELS) {
    grid.appendChild(makeSwatch(c, c === state.noteColor, () => {
      setNoteColor(c);
      persistStyle();
      updateSwatchActive(p, c);
    }));
  }
  p.appendChild(grid);
}

// ----- Панели кегля и выравнивания текста (из меню выделения) -----

/** Панели, которые не группы инструментов (у групп свои id, с этими не совпадают — см. toolbar.ts). */
const PANEL_KINDS = new Set(['style', 'note', 'font', 'align']);

function buildPanelBody(cp: CtxPanel): void {
  if (cp.kind === 'style') buildStylePanel(cp);
  else if (cp.kind === 'note') buildNotePanel(cp);
  else if (cp.kind === 'font') buildFontPanel(cp);
  else if (cp.kind === 'align') buildAlignPanel(cp);
  else buildToolGroupPanel(cp, cp.kind);
}

/** Пересобирает содержимое панели на месте (подсветка выбранного после клика). */
function rebuildPanel(cp: CtxPanel): void {
  cp.el.textContent = '';
  buildPanelBody(cp);
  cp.el.appendChild(buildCtxBar(cp));
  cp.baseHeight = 0;
  positionCtxPanel(cp);
}

const ALIGN_TITLES: Record<TextAlign, string> = { left: 'По левому краю', center: 'По центру', right: 'По правому краю' };
const VALIGN_TITLES: Record<TextVAlign, string> = { top: 'Сверху', middle: 'Посередине', bottom: 'Снизу' };

/** Кегль ↔ положение ползунка: шкала логарифмическая, мелкие кегли не теснятся у края. */
const sizeToPos = (size: number) => Math.log(size / TEXT_SIZE_MIN) / Math.log(TEXT_SIZE_MAX / TEXT_SIZE_MIN);
const posToSize = (pos: number) => Math.round(TEXT_SIZE_MIN * (TEXT_SIZE_MAX / TEXT_SIZE_MIN) ** pos);

/** Поле кегля, пока в нём набирают (или тянут ползунок его панели); start — кегль до начала. */
let fontEdit: { input: HTMLInputElement; start: number } | null = null;

/**
 * Кегль в меню выделения: стрелки — соседние значения из TEXT_SIZES, клик по числу — ввод вручную
 * и панель с ползунком и готовыми кеглями под ним.
 */
function fontSizeControl(p: TextProps): HTMLElement {
  const box = document.createElement('div');
  box.className = 'qm-font';
  box.dataset.ctx = 'font';
  box.title = 'Размер текста';
  const input = document.createElement('input');
  input.className = 'qm-font-val';
  input.inputMode = 'numeric';
  input.autocomplete = 'off';
  input.spellcheck = false;
  input.maxLength = 5;
  input.setAttribute('aria-label', 'Размер текста');
  input.value = String(Math.round(p.size));
  const steps = document.createElement('div');
  steps.className = 'qm-font-steps';
  const step = (dir: 1 | -1, icon: string, title: string): HTMLButtonElement => {
    const b = document.createElement('button');
    b.className = 'qm-font-step';
    b.title = title;
    b.innerHTML = icon;
    b.addEventListener('mousedown', e => e.preventDefault());
    b.addEventListener('click', () => {
      const cur = textProps();
      if (cur) setTextProps({ size: stepTextSize(Math.round(cur.size), dir) });
    });
    return b;
  };
  steps.append(step(1, ICONS.chevronUp, 'Крупнее'), step(-1, ICONS.chevronDown, 'Мельче'));
  box.append(input, steps);
  input.addEventListener('focus', () => {
    fontEdit = { input, start: Math.round(p.size) };
    input.select();
    openCtxPanel('font', 'quick');
  });
  input.addEventListener('input', () => checkFontInput(false));
  input.addEventListener('keydown', e => {
    e.stopPropagation();
    if (e.key === 'Enter') {
      e.preventDefault();
      const size = checkFontInput(true);
      if (size !== null) finishFontEdit(size);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      finishFontEdit(null);
    } else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      // как у числового поля: стрелки — соседний кегль из списка
      e.preventDefault();
      const cur = checkFontInput(false) ?? fontEdit?.start ?? TEXT_SIZE;
      pickFontSize(stepTextSize(cur, e.key === 'ArrowUp' ? 1 : -1), false);
    }
  });
  // ушли из поля (не в его панель — та фокус не берёт): верное значение применяется, ошибочное — нет
  input.addEventListener('blur', () => { if (fontEdit?.input === input) finishFontEdit(checkFontInput(false)); });
  return box;
}

/** Проверка набранного кегля: ошибка — красная рамка и подсказка; strict — пустое поле тоже ошибка. */
function checkFontInput(strict: boolean): number | null {
  const f = fontEdit;
  if (!f) return null;
  const r = parseTextSize(f.input.value);
  const error = 'error' in r && (strict || f.input.value.trim() !== '') ? r.error : '';
  f.input.classList.toggle('invalid', !!error);
  f.input.setAttribute('aria-invalid', String(!!error));
  f.input.title = error;
  return 'size' in r ? r.size : null;
}

/** Кегль из панели или стрелками поля: применяется сразу; close — ввод на этом закончен. */
function pickFontSize(size: number, close: boolean): void {
  if (close) { finishFontEdit(size); return; }
  if (fontEdit) {
    fontEdit.input.value = String(size);
    checkFontInput(false);
  }
  setTextProps({ size });
  const cp = panelOf('font');
  if (cp) rebuildPanel(cp);
}

/** Конец ввода кегля: применить (null — ничего), закрыть панель, вернуть фокус редактору текста. */
function finishFontEdit(size: number | null): void {
  const f = fontEdit;
  if (!f) return;
  fontEdit = null;
  const cp = panelOf('font');
  if (cp) closePanel(cp);
  const cur = textProps();
  if (size !== null && cur && (size !== Math.round(cur.size) || (size === 0) !== cur.auto)) setTextProps({ size });
  // ввод текста продолжается с того же места
  if (editing) editing.ta.focus();
  else f.input.blur();
  refresh();
}

/** Ползунок кегля и готовые значения под ним в ряд (у надписей фигур — ещё «Авто»). */
function buildFontPanel(cp: CtxPanel): void {
  const p = cp.el;
  p.dataset.kind = 'font';
  const props = textProps();
  const size = checkFontInput(false) ?? props?.size ?? TEXT_SIZE;
  p.appendChild(buildRange({
    kind: 'font-size', title: 'Размер текста', min: 0, max: 1, step: 0.001, value: sizeToPos(size),
    format: v => String(posToSize(v)), icon: () => FONT_ICON,
    onChange: (v, first) => {
      const s = posToSize(v);
      if (fontEdit) {
        fontEdit.input.value = String(s);
        checkFontInput(false);
      }
      setTextProps({ size: s }, first);
      for (const c of p.querySelectorAll<HTMLElement>('.ctx-font-chip')) c.classList.toggle('active', Number(c.dataset.size) === s);
    },
  }));
  const chips = document.createElement('div');
  chips.className = 'ctx-font-chips';
  const chip = (label: string, value: number, active: boolean, title: string): HTMLButtonElement => {
    const b = document.createElement('button');
    b.className = 'ctx-font-chip' + (active ? ' active' : '');
    b.dataset.size = String(value);
    b.textContent = label;
    b.title = title;
    b.addEventListener('click', () => pickFontSize(value, true));
    return b;
  };
  if (props?.shapes) chips.appendChild(chip('Авто', 0, props.auto, 'Подбирать размер под фигуру'));
  for (const s of TEXT_SIZES) chips.appendChild(chip(String(s), s, !props?.auto && Math.round(size) === s, `${s}`));
  p.appendChild(chips);
}

/** Выравнивание надписи: по горизонтали и по вертикали, по три кнопки в ряд. */
function buildAlignPanel(cp: CtxPanel): void {
  const p = cp.el;
  p.dataset.kind = 'align';
  const props = textProps();
  const row = <K extends string>(icons: Record<K, string>, titles: Record<K, string>, cur: K | undefined, apply: (v: K) => StylePatch) => {
    const r = document.createElement('div');
    r.className = 'ctx-align-row';
    for (const v of Object.keys(icons) as K[]) {
      const b = document.createElement('button');
      b.className = 'tool' + (v === cur ? ' active' : '');
      b.dataset.align = v;
      b.title = titles[v];
      b.innerHTML = icons[v];
      b.addEventListener('click', () => {
        setTextProps(apply(v));
        rebuildPanel(cp);
      });
      r.appendChild(b);
    }
    return r;
  };
  p.append(
    row(ALIGN_ICONS, ALIGN_TITLES, props?.align, align => ({ align })),
    row(VALIGN_ICONS, VALIGN_TITLES, props?.valign, valign => ({ valign })),
  );
}

// ----- Плавающее меню быстрых настроек выделения -----

function quickMenuEl(): HTMLElement {
  return document.getElementById('quick-menu')!;
}

/** Есть ли смысл в «выше/ниже»: выделенное пересекается (по bbox) с невыделенным над ним / под ним. */
function layerMoves(): { up: boolean; down: boolean } {
  type Box = { x0: number; y0: number; x1: number; y1: number };
  const hit = (a: Box, b: Box) => a.x0 <= b.x1 && b.x0 <= a.x1 && a.y0 <= b.y1 && b.y0 <= a.y1;
  const boxes = state.board.elements.map(elementAABB);
  // общая рамка выделения — дешёвый отсев невыделенных, которые точно ни с чем не пересекаются
  const all: Box = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };
  state.board.elements.forEach((el, i) => {
    if (!state.selection.has(el.id)) return;
    const a = boxes[i];
    all.x0 = Math.min(all.x0, a.x0); all.y0 = Math.min(all.y0, a.y0);
    all.x1 = Math.max(all.x1, a.x1); all.y1 = Math.max(all.y1, a.y1);
  });
  const selBelow: Box[] = [];   // выделенные, пройденные ранее (ниже текущего)
  const otherBelow: Box[] = []; // невыделенные, пройденные ранее
  let up = false, down = false;
  for (let i = 0; i < boxes.length; i++) {
    const a = boxes[i];
    if (state.selection.has(state.board.elements[i].id)) {
      if (!down && otherBelow.some(b => hit(a, b))) down = true;
      selBelow.push(a);
    } else {
      if (!hit(a, all)) continue;
      if (!up && selBelow.some(b => hit(a, b))) up = true;
      otherBelow.push(a);
    }
    if (up && down) break;
  }
  return { up, down };
}

let layerPanelOpen = false;
let layerPanelSelection = '';
let layerClickTimer = 0;

function buildLayerControl(sel: Element[], moves: { up: boolean; down: boolean }): HTMLElement {
  const root = document.createElement('div');
  root.className = 'qm-layers';
  const pinned = sel.length > 0 && sel.every(e => e.layerPin === sel[0].layerPin) ? sel[0].layerPin : undefined;
  const button = document.createElement('button');
  button.className = 'qm-btn qm-layer-icon' + (layerPanelOpen ? ' active' : '');
  button.title = 'Слои: открыть ползунок для перемещения и закрепления';
  button.setAttribute('aria-label', button.title);
  button.innerHTML = ICONS.layers + (pinned ? '<span class="qm-layer-pin">📌</span>' : '');
  button.addEventListener('click', () => { layerPanelOpen = !layerPanelOpen; updateQuickMenu(); });
  root.appendChild(button);
  const arrows = document.createElement('div');
  arrows.className = 'qm-layer-arrows';
  const arrow = (direction: 'top' | 'bottom', visible: boolean) => {
    if (!visible) return;
    const b = document.createElement('button');
    b.className = 'qm-layer-arrow';
    b.title = direction === 'top'
      ? 'Выше на слой; двойной клик - наверх; удержание - закрепить наверху'
      : 'Ниже на слой; двойной клик - вниз; удержание - закрепить внизу';
    b.setAttribute('aria-label', b.title);
    b.innerHTML = (direction === 'top' ? ICONS.layerTop : ICONS.layerBottom);
    let hold = 0, held = false;
    b.addEventListener('pointerdown', e => {
      if (e.button !== 0) return;
      held = false;
      hold = window.setTimeout(() => { held = true; clearTimeout(layerClickTimer); pinSelectionLayer(direction); }, 600);
    });
    for (const event of ['pointerup', 'pointercancel', 'pointerleave'] as const) b.addEventListener(event, () => clearTimeout(hold));
    b.addEventListener('click', e => {
      if (held) { held = false; return; }
      if (e.detail >= 2) {
        clearTimeout(layerClickTimer);
        moveSelectionLayer(direction === 'top' ? state.board.elements.length : 0);
      } else {
        clearTimeout(layerClickTimer);
        layerClickTimer = window.setTimeout(() => direction === 'top' ? bringForward() : sendBackward(), 250);
      }
    });
    arrows.appendChild(b);
  };
  arrow('top', moves.up); arrow('bottom', moves.down);
  if (arrows.childElementCount) root.appendChild(arrows);
  if (layerPanelOpen) {
    const panel = document.createElement('div');
    panel.className = 'qm-layer-panel';
    const rest = state.board.elements.filter(e => !state.selection.has(e.id));
    const first = state.board.elements.findIndex(e => state.selection.has(e.id));
    let value = state.board.elements.slice(0, first).filter(e => !state.selection.has(e.id)).length;
    const track = document.createElement('div');
    track.className = 'qm-layer-track';
    const count = rest.length + 1;
    for (let i = 0; i < count; i++) {
      const tick = document.createElement('span');
      tick.className = 'qm-layer-tick';
      tick.style.bottom = `${count === 1 ? 50 : i * 100 / (count - 1)}%`;
      track.appendChild(tick);
    }
    const thumb = document.createElement('button');
    thumb.className = 'qm-layer-thumb' + (pinned ? ' pinned' : '');
    thumb.title = pinned ? 'Нажмите, чтобы открепить слой' : 'Нажмите, чтобы закрепить слой';
    thumb.setAttribute('aria-label', thumb.title);
    const place = () => { thumb.style.bottom = `${count === 1 ? 50 : value * 100 / (count - 1)}%`; };
    place(); track.appendChild(thumb); panel.appendChild(track); root.appendChild(panel);
    let startY = 0, dragging = false, startedOnThumb = false;
    let original: Element[] | null = null;
    const fromPointer = (y: number) => {
      const r = track.getBoundingClientRect();
      const nextValue = Math.max(0, Math.min(count - 1, Math.round((r.bottom - y) / r.height * (count - 1))));
      if (state.layerPreview && nextValue === value) return;
      value = nextValue;
      place();
      if (original) {
        state.layerPreview = selectionLayerOrder(original, value);
        requestRender();
      }
    };
    const cancelPreview = () => {
      original = null;
      if (state.layerPreview) { state.layerPreview = null; requestRender(); }
    };
    track.addEventListener('pointerdown', e => {
      if (e.button !== 0) return;
      e.preventDefault(); e.stopPropagation();
      startY = e.clientY; dragging = false; startedOnThumb = e.target === thumb;
      original = state.board.elements;
      track.setPointerCapture(e.pointerId);
      if (!startedOnThumb) { dragging = true; fromPointer(e.clientY); }
    });
    track.addEventListener('pointermove', e => {
      if (!track.hasPointerCapture(e.pointerId)) return;
      if (Math.abs(e.clientY - startY) > 4) dragging = true;
      if (dragging) fromPointer(e.clientY);
    });
    track.addEventListener('pointerup', e => {
      if (!track.hasPointerCapture(e.pointerId)) return;
      const unchanged = original === state.board.elements;
      cancelPreview();
      track.releasePointerCapture(e.pointerId);
      if (!unchanged) return;
      if (dragging) moveSelectionLayer(value);
      else if (startedOnThumb) pinSelectionLayer(pinned ? null : (value >= (count - 1) / 2 ? 'top' : 'bottom'));
    });
    track.addEventListener('pointercancel', cancelPreview);
    track.addEventListener('lostpointercapture', cancelPreview);
    thumb.addEventListener('keydown', e => {
      if (e.key === 'ArrowUp' || e.key === 'ArrowDown') { e.preventDefault(); moveSelectionLayer(value + (e.key === 'ArrowUp' ? 1 : -1)); }
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pinSelectionLayer(pinned ? null : (value >= (count - 1) / 2 ? 'top' : 'bottom')); }
    });
  }
  return root;
}

document.addEventListener('pointerdown', e => {
  if (layerPanelOpen && e.target instanceof window.Element && !e.target.closest('.qm-layers')) {
    layerPanelOpen = false;
    document.querySelector('.qm-layer-panel')?.remove();
  }
});

function copyImageButton(): HTMLButtonElement {
  const copyImage = document.createElement('button');
  copyImage.className = 'qm-btn';
  copyImage.title = macKeys('Копировать как изображение (Ctrl+Shift+C)');
  copyImage.setAttribute('aria-label', copyImage.title);
  copyImage.innerHTML = ICONS.copyImage;
  copyImage.addEventListener('click', () => { void copySelectionAsImage(); });
  return copyImage;
}

/** «Отправить в чат»: выделенное — вложением в поле ввода чата (панель ЧУ, вкладка «Чат»). */
function sendToChatButton(): HTMLButtonElement | null {
  if (!collabActive() || !chatAvailable() || !chatCanWrite() || selectionAttachBlock()) return null;
  const b = document.createElement('button');
  b.className = 'qm-btn qm-send-chat';
  b.title = 'Отправить в чат';
  b.setAttribute('aria-label', b.title);
  b.innerHTML = ICONS.sendChat;
  b.addEventListener('click', () => {
    void attachSelection().then(err => { if (err) showToast(err); else openChat(); });
  });
  return b;
}

function updateQuickMenu(): void {
  const qm = quickMenuEl();
  // кегль набирают в поле меню — меню не пересобираем, иначе поле пропадёт из-под курсора
  if (fontEdit && !qm.hidden) { positionQuickMenu(); return; }
  const selEls = state.board.elements.filter(e => state.selection.has(e.id));
  // при вводе текста меню остаётся (у нового текста — над редактором); у стикера — нет: оформлять нечего
  if (state.view !== 'board' || (selEls.length === 0 && !editingNewText()) || editing?.target === 'note') {
    qm.hidden = true;
    return;
  }
  const selectionKey = selEls.map(e => e.id).sort().join(',');
  if (selectionKey !== layerPanelSelection) { layerPanelOpen = false; layerPanelSelection = selectionKey; }
  qm.hidden = false;
  qm.textContent = '';
  // читатель (править доску не может): если автор разрешил — копия картинкой и в чат; реакции и комментарии —
  // кнопками под объектом (src/annot-layer.ts)
  if (!canEditBoard()) {
    if (canCopyCurrentBoard()) qm.appendChild(copyImageButton());
    const toChat = sendToChatButton();
    if (toChat) qm.appendChild(toChat);
    if (!qm.hasChildNodes()) { qm.hidden = true; return; }
    positionQuickMenu();
    return;
  }
  // цвет и толщина — одна кнопка и одна панель; толщина — только для «линейных» элементов и рамок картинок
  const hasInk = selEls.some(e => e.type === 'stroke' || e.type === 'shape' || e.type === 'poly' || e.type === 'solid' || e.type === 'image');
  // у задания нет ни цвета, ни толщины: кнопка «Цвет» ничего бы не делала
  if (!selEls.every(e => e.type === 'task')) {
    const sBtn = document.createElement('button');
    sBtn.className = 'qm-btn qm-style' + (ctxOpenFrom('style', 'quick') ? ' active' : '');
    sBtn.dataset.ctx = 'style';
    sBtn.title = selEls.every(e => e.type === 'image') ? 'Рамка и скругление' : hasInk ? 'Цвет и толщина' : 'Цвет';
    sBtn.appendChild(styleIndicator(hasInk));
    sBtn.addEventListener('mousedown', e => e.preventDefault());
    sBtn.addEventListener('click', () => toggleStylePanel('quick'));
    qm.appendChild(sBtn);
  }
  if (selEls.length === 1 && selEls[0].type === 'task' && isTeacher() && canEditBoard()) {
    const task = selEls[0];
    const editBtn = document.createElement('button');
    editBtn.className = 'qm-btn qm-task-edit';
    editBtn.title = 'Редактировать задание';
    editBtn.setAttribute('aria-label', editBtn.title);
    editBtn.innerHTML = ICONS.pen;
    editBtn.addEventListener('click', () => editTaskElement(task));
    qm.appendChild(editBtn);
  }
  if (selEls.length === 1 && selEls[0].type === 'image' && !selEls[0].page && canEditBoard()) {
    const image = selEls[0];
    const crop = document.createElement('button');
    crop.className = 'qm-btn qm-crop';
    crop.title = 'Кадрировать';
    crop.setAttribute('aria-label', 'Кадрировать');
    crop.innerHTML = ICONS.crop;
    crop.addEventListener('click', () => startCrop(image));
    qm.appendChild(crop);
  }
  // жирность, курсив и кегль — у текста и надписей фигур, выравнивание — у надписей
  const tp = textProps();
  if (tp) {
    const bBtn = document.createElement('button');
    bBtn.className = 'qm-btn qm-text-b' + (tp.bold ? ' active' : '');
    bBtn.title = macKeys('Полужирный (Ctrl+B)');
    bBtn.textContent = 'B';
    bBtn.addEventListener('mousedown', e => e.preventDefault());
    bBtn.addEventListener('click', () => toggleTextFlag('bold'));
    const iBtn = document.createElement('button');
    iBtn.className = 'qm-btn qm-text-i' + (tp.italic ? ' active' : '');
    iBtn.title = macKeys('Курсив (Ctrl+I)');
    iBtn.textContent = 'I';
    iBtn.addEventListener('mousedown', e => e.preventDefault());
    iBtn.addEventListener('click', () => toggleTextFlag('italic'));
    qm.append(bBtn, iBtn, fontSizeControl(tp));
    if (tp.shapes) {
      const aBtn = document.createElement('button');
      aBtn.className = 'qm-btn qm-align' + (ctxOpenFrom('align', 'quick') ? ' active' : '');
      aBtn.dataset.ctx = 'align';
      aBtn.title = 'Выравнивание текста';
      aBtn.innerHTML = ALIGN_ICONS[tp.align];
      aBtn.addEventListener('mousedown', e => e.preventDefault());
      aBtn.addEventListener('click', () => toggleCtxPanel('align', 'quick'));
      qm.appendChild(aBtn);
    }
  }
  // при вводе — только оформление: слои, группы и удаление — когда ввод закончат
  if (editing) {
    positionQuickMenu();
    return;
  }
  // число сторон основания призмы/пирамиды
  const sides = new Set<number>();
  for (const e of selEls) if (e.type === 'solid' && hasBaseSides(e.solid)) sides.add(solidSides(e));
  if (sides.size > 0) {
    const cur = sides.size === 1 ? [...sides][0] : null;
    const box = document.createElement('div');
    box.className = 'qm-sides';
    box.title = 'Число сторон основания';
    const minus = document.createElement('button');
    minus.className = 'qm-btn qm-step';
    minus.textContent = '−';
    minus.disabled = cur !== null && cur <= SIDES_MIN;
    minus.addEventListener('click', () => setSolidSides((cur ?? SIDES_MIN + 1) - 1));
    const val = document.createElement('span');
    val.className = 'qm-sides-val';
    val.textContent = cur === null ? 'n' : `n = ${cur}`;
    const plus = document.createElement('button');
    plus.className = 'qm-btn qm-step';
    plus.textContent = '+';
    plus.disabled = cur !== null && cur >= SIDES_MAX;
    plus.addEventListener('click', () => setSolidSides((cur ?? SIDES_MAX - 1) + 1));
    box.append(minus, val, plus);
    qm.appendChild(box);
  }
  // Слои и закрепление доступны и без пересечений с другими объектами.
  if (selEls.length) qm.appendChild(buildLayerControl(selEls, layerMoves()));
  // группы
  const sel = state.board.elements.filter(e => state.selection.has(e.id));
  const allGrouped = sel.length > 0 && sel.every(e => e.groupId === sel[0].groupId && e.groupId);
  if (state.selection.size >= 2 && !allGrouped) {
    const g = document.createElement('button');
    g.className = 'qm-btn';
    g.title = macKeys('Сгруппировать (Ctrl+G)');
    g.innerHTML = ICONS.group;
    g.addEventListener('click', () => { groupSelected(); });
    qm.appendChild(g);
  }
  if (allGrouped) {
    const ug = document.createElement('button');
    ug.className = 'qm-btn';
    ug.title = macKeys('Разгруппировать (Ctrl+Shift+G)');
    ug.innerHTML = ICONS.ungroup;
    ug.addEventListener('click', () => { ungroupSelected(); });
    qm.appendChild(ug);
  }
  qm.appendChild(copyImageButton());
  const toChat = sendToChatButton();
  if (toChat) qm.appendChild(toChat);
  // ссылка на выделенные объекты: открывается с наведением на них
  if (currentBoardLink('focus')) {
    const linkBtn = document.createElement('button');
    linkBtn.className = 'qm-btn qm-link';
    linkBtn.title = 'Ссылка на выделенные объекты';
    linkBtn.setAttribute('aria-label', linkBtn.title);
    linkBtn.innerHTML = ICONS.link;
    linkBtn.addEventListener('click', () => { void copyBoardLink('focus'); });
    qm.appendChild(linkBtn);
  }
  // дублирование
  const dup = document.createElement('button');
  dup.className = 'qm-btn';
  dup.title = macKeys('Дублировать (Ctrl+D)');
  dup.innerHTML = ICONS.duplicate;
  dup.addEventListener('click', () => { duplicateSelection(); });
  qm.appendChild(dup);
  // удаление
  const del = document.createElement('button');
  del.className = 'qm-btn';
  del.title = 'Удалить (Del)';
  del.innerHTML = ICONS.trash;
  del.addEventListener('click', () => {
    deleteSelected();
  });
  qm.appendChild(del);
  positionQuickMenu();
}

/** Где на экране то, над чем стоит меню: выделенное или (у нового текста) редактор. */
function quickMenuTarget(wr: DOMRect): { sx: number; sy: number; sw: number; topGap: number } | null {
  if (editing && editingNewText()) {
    const r = editing.ta.getBoundingClientRect();
    return { sx: r.left - wr.left, sy: r.top - wr.top, sw: r.width, topGap: 10 };
  }
  const cam = state.camera;
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const el of state.board.elements) {
    if (!state.selection.has(el.id)) continue;
    const a = elementAABB(el);
    x0 = Math.min(x0, a.x0); y0 = Math.min(y0, a.y0);
    x1 = Math.max(x1, a.x1); y1 = Math.max(y1, a.y1);
  }
  if (x0 === Infinity) return null;
  // ручка поворота у левого верхнего угла чуть выступает над bbox — оставляем ей немного места
  const hasRotateHandle = state.selection.size === 1 && state.board.elements.some(e =>
    state.selection.has(e.id) && ((e.type === 'shape' && e.shape !== 'line' && e.shape !== 'arrow') || e.type === 'image'));
  return { sx: (x0 - cam.x) * cam.zoom, sy: (y0 - cam.y) * cam.zoom, sw: (x1 - x0) * cam.zoom, topGap: 10 + (hasRotateHandle ? 22 : 0) };
}

/** Положение меню выделения (координаты сцены), зафиксированное на время работы панели кегля. */
let qmFrozen: { x: number; y: number } | null = null;

function freezeQuickMenu(): void {
  const qm = quickMenuEl();
  const left = parseFloat(qm.style.left), top = parseFloat(qm.style.top);
  if (qm.hidden || Number.isNaN(left) || Number.isNaN(top)) { qmFrozen = null; return; }
  const cam = state.camera;
  qmFrozen = { x: cam.x + left / cam.zoom, y: cam.y + top / cam.zoom };
}

function positionQuickMenu(): void {
  const qm = quickMenuEl();
  const wrap = document.getElementById('canvas-wrap')!;
  const wr = wrap.getBoundingClientRect();
  if (qmFrozen) {
    // двигается только вместе с камерой (прокрутка, масштаб), но не вслед за размером текста
    const cam = state.camera;
    qm.style.left = `${(qmFrozen.x - cam.x) * cam.zoom}px`;
    qm.style.top = `${(qmFrozen.y - cam.y) * cam.zoom}px`;
    return;
  }
  const target = quickMenuTarget(wr);
  if (!target) { qm.hidden = true; return; }
  const { sx, sy, sw, topGap } = target;
  const qr = qm.getBoundingClientRect();
  let left = sx + sw / 2 - qr.width / 2;
  let top = sy - qr.height - topGap;
  if (top < 8) top = sy + 12;
  left = Math.max(8, Math.min(left, wr.width - qr.width - 8));
  qm.style.left = `${left}px`;
  qm.style.top = `${top}px`;
}

// ----- Фон страницы (выпадающий список с иконками) -----

const GRID_LABELS: Record<GridMode, string> = {
  none: 'Без фона',
  dots: 'Точки',
  square: 'Клетка',
  coord: 'Координатная плоскость',
};

/** Переключатель «Показать деления»: только для координатной плоскости, меняет фон страницы у всех участников. */
function coordLabelsSwitch(): HTMLElement | null {
  if (state.board.grid !== 'coord') return null;
  return createToggleSwitch({
    className: 'grid-switch',
    label: 'Показать деления',
    checked: state.board.coordLabels !== false,
    onChange: on => {
      setCoordLabels(on);
      // иконка «Координатная плоскость» в открытых списках меняется сразу (нолик при делениях)
      const icon = gridIcon('coord', on);
      document.querySelectorAll<HTMLElement>('.grid-option[data-grid="coord"]').forEach(b => {
        b.querySelector('svg')?.remove();
        b.insertAdjacentHTML('afterbegin', icon);
      });
      document.querySelectorAll<HTMLElement>('button[data-grid="coord"] > .view-icon').forEach(i => { i.innerHTML = icon; });
      void saveNow();
    },
  });
}

function gridButton(): HTMLElement {
  return document.getElementById('grid-mode')!;
}

function gridMenu(): HTMLElement {
  return document.getElementById('grid-menu')!;
}

/** Кнопка показывает иконку и название текущего фона; перерисовывается только при смене. */
function renderGridButton(): void {
  const btn = gridButton();
  const g = state.board.grid;
  const shown = state.board.coordLabels !== false;
  const icon = gridIcon(g, shown);
  const viewIcon = document.getElementById('view-grid-icon')!;
  if (viewIcon.dataset.icon !== icon) {
    viewIcon.dataset.icon = icon;
    viewIcon.innerHTML = icon;
  }
  const key = `${g}:${shown}`;
  if (btn.dataset.value === key) return;
  btn.dataset.value = key;
  btn.innerHTML = icon;
  const label = document.createElement('span');
  label.textContent = GRID_LABELS[g];
  btn.append(label);
  btn.insertAdjacentHTML('beforeend', ICONS.chevronDown);
}

function closeGridMenu(): void {
  gridMenu().hidden = true;
  gridButton().setAttribute('aria-expanded', 'false');
}

function pickGrid(g: GridMode): void {
  closeGridMenu();
  gridButton().focus();
  if (g === state.board.grid) return;
  setGrid(g);
  void saveNow();
}

function openGridMenu(): void {
  const menu = gridMenu();
  menu.textContent = '';
  for (const g of Object.keys(GRID_LABELS) as GridMode[]) {
    const item = document.createElement('button');
    item.className = 'grid-option';
    item.dataset.grid = g;
    item.setAttribute('role', 'option');
    item.setAttribute('aria-selected', String(g === state.board.grid));
    item.innerHTML = gridIcon(g, state.board.coordLabels !== false);
    const label = document.createElement('span');
    label.textContent = GRID_LABELS[g];
    item.append(label);
    item.addEventListener('click', () => pickGrid(g));
    menu.appendChild(item);
  }
  const coordSwitch = coordLabelsSwitch();
  if (coordSwitch) menu.appendChild(coordSwitch);
  menu.hidden = false;
  const btn = gridButton();
  btn.setAttribute('aria-expanded', 'true');
  const br = btn.getBoundingClientRect();
  menu.style.left = `${br.left}px`;
  menu.style.top = `${br.bottom + 6}px`;
  menu.style.minWidth = `${br.width}px`;
  menu.querySelector<HTMLElement>('[aria-selected="true"]')?.focus();
}

function wireGridPicker(): void {
  const btn = gridButton();
  const menu = gridMenu();
  btn.addEventListener('click', () => {
    if (menu.hidden) openGridMenu();
    else closeGridMenu();
  });
  btn.addEventListener('keydown', e => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      e.stopPropagation();
      openGridMenu();
    }
  });
  // стрелки ходят по пунктам и не долетают до хоткеев холста; Tab закрывает меню
  menu.addEventListener('keydown', e => {
    const items = [...menu.querySelectorAll<HTMLElement>('.grid-option')];
    const i = items.indexOf(document.activeElement as HTMLElement);
    let next = -1;
    if (e.key === 'ArrowDown') next = (i + 1) % items.length;
    else if (e.key === 'ArrowUp') next = (i - 1 + items.length) % items.length;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = items.length - 1;
    else if (e.key === 'Tab') { closeGridMenu(); return; }
    else return;
    e.preventDefault();
    e.stopPropagation();
    items[next].focus();
  });
  document.addEventListener('pointerdown', e => {
    const t = e.target as Node;
    if (!menu.hidden && !menu.contains(t) && !btn.contains(t)) closeGridMenu();
  }, { capture: true });
  window.addEventListener('resize', closeGridMenu);
}

// ----- Настройки доски (поповер) -----

function settingsPopover(): HTMLElement {
  return document.getElementById('settings-popover')!;
}

function closeSettings(): void {
  document.body.classList.remove('settings-popover-open');
  settingsPopover().hidden = true;
}

function openSettings(): void {
  const pop = settingsPopover();
  document.body.classList.add('settings-popover-open');
  pop.hidden = false;
  pop.textContent = '';
  const title = document.createElement('div');
  title.className = 'ctx-title';
  title.textContent = 'Настройки доски';
  pop.appendChild(title);
  fillBoardSettings(pop, openSettings);
  const all = document.createElement('button');
  all.className = 'settings-all';
  all.title = macKeys('Все настройки (Ctrl+,)');
  all.innerHTML = ICONS.settings;
  const allText = document.createElement('span');
  allText.textContent = 'Все настройки';
  all.append(allText);
  all.insertAdjacentHTML('beforeend', ICONS.chevron);
  all.addEventListener('click', () => openAllSettings());
  pop.appendChild(all);
  const btn = document.getElementById('btn-settings')!;
  const br = (btn.closest('.topbar-group') ?? btn).getBoundingClientRect();
  pop.style.left = `${Math.max(8, br.right - pop.offsetWidth)}px`;
  pop.style.top = `${br.bottom + 6}px`;
}

/** Кнопка профиля в шапке домашнего экрана: мини-курсор и имя; открывает раздел «Профиль». */
function profileButton(): HTMLButtonElement {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'home-profile';
  b.classList.toggle('has-invites', incomingInvites().length > 0);
  b.title = 'Профиль: имя, курсор и вход';
  const icon = document.createElement('span');
  icon.className = 'home-profile-cursor';
  icon.innerHTML = cursorSvg(myCursorId(), { size: 19 });
  const name = document.createElement('span');
  name.className = 'home-profile-name';
  name.textContent = profileName() || 'Профиль';
  b.append(icon, name);
  b.addEventListener('click', () => openAllSettings('profile'));
  return b;
}

/** Сообщение о входе для раздела «Профиль» (вернулись от провайдера в настройки). */
let profileNotice: { text: string; kind: 'error' | 'info'; until: number } | null = null;

/**
 * Сообщение о входе для «Профиля»: живёт несколько секунд — раздел перерисовывается, когда после запуска
 * приходит ответ сервера об аккаунте, и сообщение не должно пропасть.
 */
export function takeProfileNotice(): { text: string; kind: 'error' | 'info' } | null {
  if (!profileNotice || profileNotice.until < Date.now()) { profileNotice = null; return null; }
  return { text: profileNotice.text, kind: profileNotice.kind };
}

/** Вернулись от провайдера входа, начатого в настройках: открыть «Профиль» и показать итог. */
export function openProfileAfterAuth(outcome: AuthOutcome): void {
  const until = Date.now() + 8000;
  profileNotice = outcome.ok
    ? { text: outcome.mode === 'link' ? 'Способ входа привязан' : 'Вы вошли в аккаунт', kind: 'info', until }
    : { text: authErrorText(outcome.error ?? 'auth-failed'), kind: 'error', until };
  openAllSettings('profile');
}

/** «Есть промокод?» в окне подписки: раздел «Подписка» откроется с фокусом в поле промокода. */
let promoFocusNext = false;

/** Окно «Все настройки»; section — раздел, с которого открыть (по умолчанию — последний открытый). */
export function openAllSettings(section?: string): void {
  closeSettings();
  openSettingsDialog([
    {
      id: 'profile',
      title: 'Профиль',
      icon: PROFILE_ICON,
      render: (host, rerender) => renderProfileSettings(host, rerender, { notice: takeProfileNotice(), openSubscription: () => openAllSettings('subscription') }),
    },
    {
      id: 'subscription',
      title: 'Подписка',
      icon: ICONS.crown,
      render: host => {
        const focusPromo = promoFocusNext;
        promoFocusNext = false;
        return renderSubscriptionSettings(host, { openLogin: () => openAllSettings('profile'), focusPromo });
      },
    },
    {
      id: 'general',
      title: 'Доска',
      icon: ICONS.settings,
      render: (host, rerender) => {
        const box = document.createElement('div');
        box.className = 'sd-general';
        fillBoardSettings(box, rerender);
        host.appendChild(box);
      },
    },
    { id: 'toolbar', title: 'Панель инструментов', icon: ICONS.toolbar, render: host => renderToolbarEditor(host) },
    {
      id: 'hotkeys',
      title: 'Горячие клавиши',
      icon: ICONS.keyboard,
      render: host => renderHotkeysSettings(host, {
        save: patch => {
          setSettings(patch);
          persistSettings();
          renderPages(); // подсказки кнопки и плитки «новая страница» показывают сочетание
        },
        editToolKeys: () => openAllSettings('toolbar'),
      }),
    },
    { id: 'advanced', title: 'Дополнительные', icon: ICONS.advanced, render: host => renderAdvancedSettings(host) },
    { id: 'about', title: 'О проекте', icon: ICONS.info, render: host => renderAbout(host, showExperiments) },
    ...(experimentsShown() ? [EXPERIMENTAL] : []),
    // «Профиль» — первым в списке, но окно без явного раздела по-прежнему открывается на «Доске» (или на последнем)
  ], section ?? (lastSettingsSection() || 'general'));
}

/** Раздел «Дополнительные»: редкие настройки, которые по умолчанию выключены. */
function renderAdvancedSettings(host: HTMLElement): void {
  const box = document.createElement('div');
  box.className = 'sd-general';
  const lbl = document.createElement('div');
  lbl.className = 'ctx-label';
  lbl.textContent = 'Панель инструментов';
  box.appendChild(lbl);
  box.appendChild(settingCheck('toolbarDetachable', 'Разрешить откреплять панель инструментов',
    'При наведении над панелью появляется ручка: за неё панель переносят по доске (не помещается - поворачивается), '
    + 'нажатие на ручку поворачивает панель. Выключение возвращает панель на её край',
    () => {
      // запрет откреплять — панель возвращается к своему краю
      if (!state.settings.toolbarDetachable) { setSettings({ toolbarFloat: null }); persistSettings(); }
      applyToolbarPos();
    }));
  renderAnalyticsSettings(box);
  host.appendChild(box);
}

/** Скрытый раздел (см. experimental.ts): открывается, если задержать логотип в «О проекте». */
const EXPERIMENTAL: SettingsSection = {
  id: 'experimental',
  title: 'Экспериментальные',
  icon: ICONS.flask,
  headIcon: experimentalHeadIcon,
  render: host => renderExperimental(host, {
    check: (key, text, hint) => settingCheck(key, text, hint, key === 'thumbViewport' ? () => syncThumbViewport() : undefined),
    hide: () => {
      setExperimentsShown(false);
      setRecursionDiscovered(false);
      setSettings({ recursionEnabled: false });
      persistSettings();
      removeSettingsSection('experimental');
    },
  }),
};

function showExperiments(): void {
  if (experimentsShown()) return;
  setExperimentsShown(true);
  addSettingsSection(EXPERIMENTAL);
}

/** Основные настройки доски — в поповере и в разделе «Доска» окна всех настроек. */
function fillBoardSettings(pop: HTMLElement, rerender: () => void): void {
  const lbl1 = document.createElement('div');
  lbl1.className = 'ctx-label';
  lbl1.textContent = 'Панель инструментов';
  pop.appendChild(lbl1);
  const row = document.createElement('div');
  row.className = 'ctx-toolbar-pos';
  for (const pos of (['left', 'top', 'right', 'bottom'] as ToolbarPos[])) {
    const b = document.createElement('button');
    const names: Record<ToolbarPos, string> = { left: 'Слева', top: 'Сверху', right: 'Справа', bottom: 'Снизу' };
    b.textContent = names[pos];
    // откреплённая панель — ни одна сторона не выбрана; выбор стороны снова пристыковывает её
    b.className = !state.settings.toolbarFloat && state.settings.toolbarPos === pos ? 'active' : '';
    b.addEventListener('click', () => {
      setSettings({ toolbarPos: pos, toolbarFloat: null });
      persistSettings();
      applyToolbarPos();
      rerender();
    });
    row.appendChild(b);
  }
  pop.appendChild(row);
  const lbl8 = document.createElement('label');
  lbl8.className = 'ctx-check';
  lbl8.title = macKeys('Изображения и страницы PDF не искажаются при изменении размера - Ctrl или Shift зажимать не нужно');
  const cb8 = document.createElement('input');
  cb8.type = 'checkbox';
  cb8.checked = state.settings.keepImageAspect;
  cb8.addEventListener('change', () => {
    setSettings({ keepImageAspect: cb8.checked });
    persistSettings();
  });
  const span8 = document.createElement('span');
  span8.textContent = 'Пропорциональный размер изображений';
  lbl8.append(cb8, span8);
  pop.appendChild(lbl8);
  const lbl4 = document.createElement('div');
  lbl4.className = 'ctx-label';
  lbl4.textContent = 'Колёсико мыши';
  pop.appendChild(lbl4);
  const wheelRow = document.createElement('div');
  wheelRow.className = 'ctx-toolbar-pos';
  const wheelModes: { mode: WheelMode; name: string; hint: string }[] = [
    { mode: 'scroll', name: 'Прокрутка', hint: 'Колёсико прокручивает, Shift - по горизонтали, Ctrl - масштаб' },
    { mode: 'zoom', name: 'Масштаб', hint: 'Колёсико масштабирует, Shift - прокрутка по горизонтали, Ctrl+Shift - по вертикали. Настройка также действует на тачпад' },
  ];
  for (const { mode, name, hint } of wheelModes) {
    const b = document.createElement('button');
    b.textContent = name;
    b.title = hint;
    b.className = state.settings.wheelMode === mode ? 'active' : '';
    b.addEventListener('click', () => {
      setSettings({ wheelMode: mode });
      persistSettings();
      rerender();
    });
    wheelRow.appendChild(b);
  }
  pop.appendChild(wheelRow);
  const lbl5 = document.createElement('div');
  lbl5.className = 'ctx-label';
  lbl5.textContent = 'Анимация перехода на другую страницу';
  pop.appendChild(lbl5);
  const transRow = document.createElement('div');
  transRow.className = 'ctx-toolbar-pos ctx-options';
  for (const { mode, name, hint } of PAGE_TRANSITIONS) {
    const b = document.createElement('button');
    b.textContent = name;
    b.title = hint;
    b.className = state.settings.pageTransition === mode ? 'active' : '';
    b.addEventListener('click', () => {
      setSettings({ pageTransition: mode });
      persistSettings();
      rerender();
    });
    transRow.appendChild(b);
  }
  pop.appendChild(transRow);
  const lblPages = document.createElement('div');
  lblPages.className = 'ctx-label';
  lblPages.textContent = 'Список страниц';
  pop.appendChild(lblPages);
  pop.appendChild(settingCheck('closePagesOnPick', 'Закрывать после выбора страницы'));
  const lblAnim = document.createElement('div');
  lblAnim.className = 'ctx-label';
  lblAnim.textContent = 'Анимации';
  pop.appendChild(lblAnim);
  const animRow = document.createElement('div');
  animRow.className = 'ctx-toolbar-pos ctx-options';
  for (const { mode, name, hint } of ANIMATION_MODES) {
    const b = document.createElement('button');
    b.textContent = name;
    b.title = hint;
    b.className = state.settings.animationMode === mode ? 'active' : '';
    b.addEventListener('click', () => {
      setSettings({ animationMode: mode });
      persistSettings();
      applyAnimationMode();
      rerender();
    });
    animRow.appendChild(b);
  }
  pop.appendChild(animRow);
  const lbl7 = document.createElement('label');
  lbl7.className = 'ctx-check';
  lbl7.title = macKeys('Отмена и повтор по-прежнему работают на Ctrl+Z и Ctrl+Y');
  const cb7 = document.createElement('input');
  cb7.type = 'checkbox';
  cb7.checked = state.settings.hideUndoRedo;
  cb7.addEventListener('change', () => {
    setSettings({ hideUndoRedo: cb7.checked });
    persistSettings();
    applyUndoRedoVisibility(true);
  });
  const span7 = document.createElement('span');
  span7.textContent = 'Скрыть кнопки отмены и повтора';
  lbl7.append(cb7, span7);
  pop.appendChild(lbl7);
}

type BoolSetting = 'toolbarDetachable' | 'alignGuides' | 'closePagesOnPick' | 'thumbViewport' | 'pageLinks' | 'recursionEnabled';

/** Флажок настройки доски: меняет и сразу сохраняет. */
function settingCheck(key: BoolSetting, text: string, hint?: string, after?: () => void): HTMLElement {
  const lbl = document.createElement('label');
  lbl.className = 'ctx-check';
  if (hint) lbl.title = hint;
  const cb = document.createElement('input');
  cb.type = 'checkbox';
  cb.checked = state.settings[key];
  cb.addEventListener('change', () => {
    setSettings({ [key]: cb.checked });
    persistSettings();
    after?.();
  });
  const span = document.createElement('span');
  span.textContent = text;
  lbl.append(cb, span);
  return lbl;
}

function applyToolbarPos(): void {
  const tb = document.getElementById('toolbar')!;
  document.body.classList.toggle('toolbar-detachable', state.settings.toolbarDetachable);
  placeToolbar(tb);
  // панель внизу заняла бы место кнопки страниц: кнопка уходит наверх, список — колонкой под ней
  const dock = document.getElementById('pages-dock')!;
  const top = pagesAtTop();
  dock.dataset.side = top ? 'top' : 'bottom';
  dock.dataset.tipSide = top ? 'bottom' : 'top';
  positionCtxPanels();
}

/** Кнопка страниц — слева вверху, список вертикальный (когда панель инструментов внизу). */
function pagesAtTop(): boolean {
  return !state.settings.toolbarFloat && state.settings.toolbarPos === 'bottom';
}

// ----- Откреплённая панель инструментов (src/toolbar-float.ts) -----

/** Сторона, от которой раскладывается всё, что открывается с панели: у откреплённой — по её месту на холсте. */
function toolbarSide(): ToolbarPos {
  return document.getElementById('toolbar')?.dataset.pos as ToolbarPos | undefined ?? state.settings.toolbarPos;
}

/** Холст для откреплённой панели: сверху — под шапкой доски, с местом под ручку. */
function canvasArea(): Area {
  const wrap = document.getElementById('canvas-wrap')!;
  const bar = document.getElementById('topbar');
  const under = bar && bar.offsetHeight ? bar.getBoundingClientRect().bottom - wrap.getBoundingClientRect().top + 6 : 8;
  return { w: wrap.clientWidth, h: wrap.clientHeight, top: Math.max(8, under) + GRIP_ROOM };
}

/** Пристыкованная — у своего края; откреплённая — в своей точке, повёрнутая как сохранено, в пределах холста. */
function placeToolbar(tb: HTMLElement): void {
  const f = state.settings.toolbarFloat;
  tb.classList.toggle('floating', !!f);
  if (!f) {
    tb.style.left = '';
    tb.style.top = '';
    tb.dataset.pos = state.settings.toolbarPos;
    return;
  }
  // сначала ориентация (по ней раскладываются кнопки), потом размер и место
  tb.dataset.pos = f.orient === 'v' ? 'left' : 'top';
  const area = canvasArea();
  const size = { w: tb.offsetWidth, h: tb.offsetHeight };
  const at = area.w > 0 && size.w > 0 ? clampFloat(f, size, area) : f;
  tb.style.left = `${at.x}px`;
  tb.style.top = `${at.y}px`;
  if (area.w > 0) tb.dataset.pos = floatSide(at, size, area);
}

function setToolbarFloat(f: ToolbarFloat | null): void {
  setSettings({ toolbarFloat: f });
  applyToolbarPos();
}

/**
 * Ручка над панелью (видна при наведении, если откреплять разрешено): перенос открепляет панель
 * и поворачивает её, когда она не помещается; простое нажатие — поворачивает на месте;
 * удержание — возвращает откреплённую панель к её краю.
 */
/** Сколько держать ручку, чтобы прикрепить панель обратно (мс). */
const TOOLBAR_HOLD_MS = 500;

function toolbarGrip(tb: HTMLElement): HTMLElement {
  const grip = document.createElement('div');
  grip.className = 'tb-grip';
  grip.title = 'Перетащите, чтобы переместить панель. Нажмите - повернуть, удерживайте - прикрепить обратно к краю';
  grip.innerHTML = GRIP_ICON;
  grip.addEventListener('pointerdown', e => {
    if (e.button !== 0 || !e.isPrimary || !state.settings.toolbarDetachable) return;
    e.preventDefault();
    const wr = document.getElementById('canvas-wrap')!.getBoundingClientRect();
    const tr = tb.getBoundingClientRect();
    // ручка — середина верхнего края; запоминаем, где за неё взялись, чтобы панель не прыгнула
    const offX = e.clientX - (tr.left + tr.width / 2);
    const offY = e.clientY - tr.top;
    const startX = e.clientX;
    const startY = e.clientY;
    let moved = false;
    let held = false;
    try { grip.setPointerCapture(e.pointerId); } catch { /* синтетический pointer */ }
    tb.classList.add('tb-dragging');
    // удержание без движения: откреплённая панель возвращается к своему краю
    const holdTimer = window.setTimeout(() => {
      if (moved || !state.settings.toolbarFloat) return;
      held = true;
      tb.classList.remove('tb-dragging');
      navigator.vibrate?.(10);
      setToolbarFloat(null);
      persistSettings();
    }, TOOLBAR_HOLD_MS);
    const onMove = (ev: PointerEvent) => {
      if (held) return;
      if (!moved && Math.hypot(ev.clientX - startX, ev.clientY - startY) < 3) return;
      moved = true;
      clearTimeout(holdTimer);
      const cur = state.settings.toolbarFloat;
      const orient = cur?.orient ?? orientOfPos(state.settings.toolbarPos);
      const size = { w: tb.offsetWidth, h: tb.offsetHeight };
      setToolbarFloat(dragFloat(ev.clientX - offX - wr.left, ev.clientY - offY - wr.top, orient, size, canvasArea()));
    };
    const onUp = (ev: PointerEvent) => {
      grip.removeEventListener('pointermove', onMove);
      grip.removeEventListener('pointerup', onUp);
      grip.removeEventListener('pointercancel', onUp);
      clearTimeout(holdTimer);
      tb.classList.remove('tb-dragging');
      if (held) return;
      if (!moved && ev.type === 'pointerup') {
        const r = tb.getBoundingClientRect();
        const size = { w: tb.offsetWidth, h: tb.offsetHeight };
        const cur = state.settings.toolbarFloat
          ?? { x: r.left - wr.left, y: r.top - wr.top, orient: orientOfPos(state.settings.toolbarPos) };
        setToolbarFloat(rotateFloat(cur, size, canvasArea()));
      }
      persistSettings();
    };
    grip.addEventListener('pointermove', onMove);
    grip.addEventListener('pointerup', onUp);
    grip.addEventListener('pointercancel', onUp);
  });
  return grip;
}

// ----- Экспорт PNG -----

export async function copySelectionAsImage(): Promise<void> {
  if (!canCopyCurrentBoard()) { showToast('Автор запретил копирование'); return; }
  const els = state.board.elements.filter(el => state.selection.has(el.id));
  if (!els.length) return;
  showToast('Копирование...');
  try {
    const bb = contentBBox(els), pad = 8;
    const w = Math.max(1, bb.w + pad * 2), h = Math.max(1, bb.h + pad * 2);
    const scale = Math.min(2, 8000 / Math.max(w, h));
    const cv = document.createElement('canvas');
    cv.width = Math.ceil(w * scale); cv.height = Math.ceil(h * scale);
    const ctx = cv.getContext('2d');
    if (!ctx) throw new Error('Не удалось создать изображение');
    const api = window.doskaAPI as { copyImage?: (data: string) => Promise<void> } | undefined;
    const makeImage = async (): Promise<Blob> => {
      await imagesLoaded(els);
      renderScene(ctx, els, { x: bb.x0 - pad, y: bb.y0 - pad, zoom: 1 }, w, h, scale, 'none', undefined, true);
      return new Promise((resolve, reject) => cv.toBlob(blob => blob ? resolve(blob) : reject(new Error('Не удалось создать изображение')), 'image/png'));
    };
    if (api?.copyImage) {
      const blob = await makeImage();
      const data = await new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = () => reject(reader.error); reader.readAsDataURL(blob); });
      await api.copyImage(data);
    } else {
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': makeImage() })]);
    }
    showToast('Скопировано в буфер обмена');
  } catch (err) {
    showToast('Не удалось скопировать изображение');
    console.error(err);
  }
}

/**
 * PNG страницы. scope: 'auto' (как раньше: есть выделение — только оно, иначе вся страница), 'page' — вся страница,
 * 'selection' — только выделенное (режим «Экспорт» боковой панели).
 */
export async function exportPng(scope: 'auto' | 'page' | 'selection' = 'auto'): Promise<void> {
  if (!canCopyCurrentBoard()) { showToast('Автор запретил копирование'); return; }
  const onlySelected = scope === 'selection' || (scope === 'auto' && state.selection.size > 0);
  const els = onlySelected
    ? state.board.elements.filter(e => state.selection.has(e.id))
    : state.board.elements;
  if (els.length === 0) {
    if (scope === 'selection') showToast('Сначала выделите объекты на доске');
    else alert('Страница пуста - нечего экспортировать');
    return;
  }
  const bb = contentBBox(els);
  const pad = 32;
  const bw = bb.w + pad * 2;
  const bh = bb.h + pad * 2;
  const scale = Math.min(2, 8000 / Math.max(bw, bh));
  const cv = document.createElement('canvas');
  cv.width = Math.ceil(bw * scale);
  cv.height = Math.ceil(bh * scale);
  const c = cv.getContext('2d');
  if (!c) return;
  renderScene(c, els, { x: bb.x0 - pad, y: bb.y0 - pad, zoom: 1 }, bw, bh, scale, 'none');
  const dataUrl = cv.toDataURL('image/png');
  const name = `${state.project.name.trim() || 'abax'} — ${state.board.name.trim() || 'стр'}.png`;
  const api = (window as { doskaAPI?: { exportPng(d: string, n: string): Promise<boolean> } }).doskaAPI;
  if (api) {
    await api.exportPng(dataUrl, name);
  } else if (isNativeApp()) {
    await sharePng(dataUrl, name);
  } else {
    const a = document.createElement('a');
    a.href = dataUrl;
    a.download = name.replace(/—/g, '-');
    a.click();
  }
}

// ----- Импорт PDF -----

function pickPdfViaInput(): Promise<string | null> {
  const { promise, resolve } = Promise.withResolvers<string | null>();
  const inp = document.createElement('input');
  inp.type = 'file';
  inp.accept = 'application/pdf';
  inp.onchange = () => {
    const f = inp.files?.[0];
    if (!f) { resolve(null); return; }
    const fr = new FileReader();
    fr.onload = () => resolve(String(fr.result));
    fr.onerror = () => resolve(null);
    fr.readAsDataURL(f);
  };
  inp.click();
  return promise;
}

// Форматы Office и OpenDocument представляют собой ZIP-архивы с XML.
async function documentXmlFiles(data: ArrayBuffer): Promise<Map<string, string>> {
  const view = new DataView(data);
  const bytes = new Uint8Array(data);
  let end = bytes.length - 22;
  while (end >= Math.max(0, bytes.length - 65557) && view.getUint32(end, true) !== 0x06054b50) end--;
  if (end < 0) throw new Error('Некорректный архив документа');
  let offset = view.getUint32(end + 16, true);
  const count = view.getUint16(end + 10, true);
  const files = new Map<string, string>();
  for (let i = 0; i < count; i++) {
    if (view.getUint32(offset, true) !== 0x02014b50) throw new Error('Некорректный архив документа');
    const method = view.getUint16(offset + 10, true), size = view.getUint32(offset + 20, true);
    const nameLen = view.getUint16(offset + 28, true), extra = view.getUint16(offset + 30, true), comment = view.getUint16(offset + 32, true);
    const name = new TextDecoder().decode(bytes.slice(offset + 46, offset + 46 + nameLen));
    const local = view.getUint32(offset + 42, true);
    const start = local + 30 + view.getUint16(local + 26, true) + view.getUint16(local + 28, true);
    if (name.endsWith('.xml')) {
      const chunk = bytes.slice(start, start + size);
      let content: ArrayBuffer;
      if (method === 0) content = chunk.buffer;
      else if (method === 8) content = await new Response(new Blob([chunk]).stream().pipeThrough(new DecompressionStream('deflate-raw'))).arrayBuffer();
      else throw new Error('Неподдерживаемое сжатие документа');
      files.set(name, new TextDecoder().decode(content));
    }
    offset += 46 + nameLen + extra + comment;
  }
  return files;
}

function xmlDocument(xml: string): Document {
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  if (doc.querySelector('parsererror')) throw new Error('Некорректное содержимое документа');
  return doc;
}

async function documentText(file: File): Promise<string> {
  const ext = file.name.split('.').pop()?.toLowerCase();
  if (['txt', 'csv', 'tsv', 'md'].includes(ext || '')) return file.text();
  const files = await documentXmlFiles(await file.arrayBuffer());
  if (ext === 'docx') {
    const xml = files.get('word/document.xml');
    if (!xml) throw new Error('Не найден текст документа');
    return Array.from(xmlDocument(xml).getElementsByTagNameNS('*', 'p')).map(p => Array.from(p.getElementsByTagNameNS('*', 't')).map(t => t.textContent).join('')).join('\n');
  }
  if (ext === 'odt' || ext === 'ods') {
    const xml = files.get('content.xml');
    if (!xml) throw new Error('Не найдено содержимое документа');
    const doc = xmlDocument(xml);
    return Array.from(doc.getElementsByTagNameNS('*', 'p')).map(p => p.textContent || '').join('\n');
  }
  if (ext === 'xlsx') {
    const shared = files.get('xl/sharedStrings.xml');
    const strings = shared ? Array.from(xmlDocument(shared).getElementsByTagNameNS('*', 'si')).map(si => si.textContent || '') : [];
    return Array.from(files.entries()).filter(([name]) => /^xl\/worksheets\/sheet\d+\.xml$/.test(name)).sort(([a], [b]) => a.localeCompare(b, undefined, { numeric: true })).map(([name, xml]) => {
      const rows = Array.from(xmlDocument(xml).getElementsByTagNameNS('*', 'row')).map(row => Array.from(row.getElementsByTagNameNS('*', 'c')).map(cell => {
        const value = cell.getElementsByTagNameNS('*', 'v')[0]?.textContent || cell.getElementsByTagNameNS('*', 'is')[0]?.textContent || '';
        return cell.getAttribute('t') === 's' ? (strings[Number(value)] || '') : value;
      }).join('\t'));
      return name.match(/sheet(\d+)/)?.[1] ? `Лист ${name.match(/sheet(\d+)/)![1]}\n${rows.join('\n')}` : rows.join('\n');
    }).join('\n\n');
  }
  throw new Error('Формат не поддерживается');
}

/** Документ с диска: PDF — страницами-картинками, Word/Excel/OpenDocument/текст — текстом на доске. */
async function importDocumentFile(file: File): Promise<void> {
  try {
    if (/\.pdf$/i.test(file.name) || file.type === 'application/pdf') {
      const dataUrl = await new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = () => reject(reader.error); reader.readAsDataURL(file); });
      await importPdfFromDataUrl(dataUrl);
    } else {
      const text = (await documentText(file)).trim();
      if (!text) throw new Error('Документ не содержит текста');
      const el: TextEl = { id: uid(), type: 'text', text, x: state.camera.x + 40, y: state.camera.y + 40, size: 20, color: '#222222' };
      pushHistory(state.board.elements);
      replaceElements([...state.board.elements, el]);
      selectInserted(el.id);
      fitContent();
    }
  } catch (err) { alert('Не удалось открыть документ: ' + (err instanceof Error ? err.message : String(err))); }
}

export async function importDocument(): Promise<void> {
  if (!canEditBoard()) return;
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.pdf,.docx,.xlsx,.odt,.ods,.txt,.csv,.tsv,.md';
  input.onchange = async () => {
    const file = input.files?.[0];
    if (!file) return;
    await importDocumentFile(file);
  };
  input.click();
}

const PDF_PAGE_W = 900; // юниты сцены
const PDF_PAGE_GAP = 48;
const PDF_MAX_PAGES = 30;

/** Импортирует PDF: каждая страница — картинка-фон на доске. */
export async function importPdf(): Promise<void> {
  if (!canEditBoard()) return;
  const dataUrl = (window as { doskaAPI?: { pickPdf(): Promise<string | null> } }).doskaAPI
    ? await (window as unknown as { doskaAPI: { pickPdf(): Promise<string | null> } }).doskaAPI.pickPdf()
    : await pickPdfViaInput();
  if (dataUrl) await importPdfFromDataUrl(dataUrl);
}

/** Рендерит страницы PDF в картинки и добавляет их на доску. */
export async function importPdfFromDataUrl(dataUrl: string): Promise<void> {
  try {
    const base64 = dataUrl.slice(dataUrl.indexOf(',') + 1);
    const bin = atob(base64);
    const u8 = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
    // без eval: CSP запрещает его, а pdf.js иначе пробует new Function для шрифтов
    const pdf = await pdfjsLib.getDocument({ data: u8, isEvalSupported: false }).promise;
    const x = state.camera.x + 40;
    let y = state.camera.y + 40;
    const imgs: ImageEl[] = [];
    const pages = Math.min(pdf.numPages, PDF_MAX_PAGES);
    for (let p = 1; p <= pages; p++) {
      const page = await pdf.getPage(p);
      const vp0 = page.getViewport({ scale: 1 });
      const scale = PDF_PAGE_W / vp0.width;
      const vp = page.getViewport({ scale: scale * 2 }); // 2x для чёткости
      const cv = document.createElement('canvas');
      cv.width = Math.ceil(vp.width);
      cv.height = Math.ceil(vp.height);
      const c2 = cv.getContext('2d')!;
      c2.fillStyle = '#ffffff';
      c2.fillRect(0, 0, cv.width, cv.height);
      await page.render({ canvasContext: c2, viewport: vp }).promise;
      const h = vp0.height * scale;
      imgs.push({ id: uid(), type: 'image', src: cv.toDataURL('image/jpeg', 0.9), x, y, w: PDF_PAGE_W, h });
      y += h + PDF_PAGE_GAP;
    }
    pushHistory(state.board.elements);
    replaceElements([...state.board.elements, ...imgs]);
    selectInserted(...imgs.map(i => i.id));
    fitContent();
  } catch (err) {
    alert('Не удалось открыть PDF: ' + (err instanceof Error ? err.message : String(err)));
  }
}

// ----- Вставка изображений -----

function pickImageViaInput(): Promise<string | null> {
  const { promise, resolve } = Promise.withResolvers<string | null>();
  const inp = document.createElement('input');
  inp.type = 'file';
  inp.accept = 'image/*';
  inp.onchange = () => {
    const f = inp.files?.[0];
    if (!f) { resolve(null); return; }
    const fr = new FileReader();
    fr.onload = () => resolve(String(fr.result));
    fr.onerror = () => resolve(null);
    fr.readAsDataURL(f);
  };
  inp.click();
  return promise;
}

/** Вставляет картинку по dataURL: центрирует на точке (или в центре экрана), вписывает в экран. */
export function insertImageFromDataUrl(dataUrl: string, at?: { x: number; y: number }): void {
  const probe = new Image();
  probe.onload = () => {
    const nw = probe.naturalWidth || 400;
    const nh = probe.naturalHeight || 300;
    const r = canvas.getBoundingClientRect();
    const scale = Math.min(1, 800 / nw, (r.height * 0.6) / nh);
    const w = Math.max(24, nw * scale);
    const h = Math.max(24, nh * scale);
    const cam = state.camera;
    const cx = at ? at.x : cam.x + r.width / (2 * cam.zoom);
    const cy = at ? at.y : cam.y + r.height / (2 * cam.zoom);
    const el: ImageEl = { id: uid(), type: 'image', src: dataUrl, x: cx - w / 2, y: cy - h / 2, w, h };
    pushHistory(state.board.elements);
    replaceElements([...state.board.elements, el]);
    // картинку обычно сразу двигают и масштабируют — включаем выделение
    selectInserted(el.id);
  };
  probe.onerror = () => alert('Не удалось прочитать изображение');
  probe.src = dataUrl;
}

export async function insertImage(): Promise<void> {
  if (!canEditBoard()) return;
  const api = (window as { doskaAPI?: { pickImage(): Promise<string | null> } }).doskaAPI;
  const dataUrl = api ? await api.pickImage() : await pickImageViaInput();
  if (dataUrl) insertImageFromDataUrl(dataUrl);
}

function fileToDataUrl(f: Blob): Promise<string | null> {
  const { promise, resolve } = Promise.withResolvers<string | null>();
  const fr = new FileReader();
  fr.onload = () => resolve(String(fr.result));
  fr.onerror = () => resolve(null);
  fr.readAsDataURL(f);
  return promise;
}

/** Картинка-файл (вставка Ctrl+V, перетаскивание, «Из буфера обмена») — на доску в центр экрана. */
function insertImageFile(f: Blob): void {
  void fileToDataUrl(f).then(d => { if (d) insertImageFromDataUrl(d); });
}

const DOCUMENT_FILE = /\.(pdf|docx|xlsx|odt|ods|txt|csv|tsv|md)$/i;
const PROJECT_FILE = /\.json$/i;

/**
 * Перетащенный файл — на холст или в зону режима «Импорт» боковой панели: изображение, PDF или документ
 * встаёт на доску (нужно право правки), проект .json открывается отдельным проектом.
 */
export function importDroppedFile(f: File): boolean {
  if (PROJECT_FILE.test(f.name) || f.type === 'application/json') { void importProjectFile(f); return true; }
  if (!canEditBoard()) return false;
  if (f.type.startsWith('image/')) insertImageFile(f);
  else if (f.type === 'application/pdf' || DOCUMENT_FILE.test(f.name)) void importDocumentFile(f);
  else { showToast('Этот формат не поддерживается: подойдут PDF, изображение, документ или файл проекта'); return false; }
  return true;
}

/** «Из буфера обмена»: картинка из системного буфера — тем же путём, что вставка Ctrl+V. */
export async function pasteImageFromClipboard(): Promise<void> {
  if (!canEditBoard()) return;
  let items: ClipboardItems;
  try {
    items = await navigator.clipboard.read();
  } catch {
    showToast(macKeys('Нет доступа к буферу обмена - нажмите Ctrl+V на доске'));
    return;
  }
  for (const it of items) {
    const type = it.types.find(t => t.startsWith('image/'));
    if (type) { insertImageFile(await it.getType(type)); return; }
  }
  showToast('В буфере обмена нет изображения');
}

/** Можно открыть проект из файла: не просмотр по ссылке и не гость чужой доски. */
export function canOpenProjectFile(): boolean {
  return state.linkMode === null && state.collabRole !== 'guest';
}

/**
 * Проект из файла .json (скачанный «Скачать проект как файл»): проверка parseProject и открытие копией —
 * с новым id, чтобы не перезаписать свой проект с тем же id; права доступа и закрепление не переносятся.
 */
export async function importProjectFile(f: File): Promise<void> {
  if (!canOpenProjectFile()) return;
  let parsed: Project | null = null;
  try { parsed = parseProject(JSON.parse(await f.text())); } catch { parsed = null; }
  if (!parsed) { showToast('Это не файл проекта Abax'); return; }
  if (limitsEnforced() && !canCreateProject(userPlan(), state.projects.length)) { requestUpgrade('projects'); return; }
  await saveNow();
  saveCamera();
  rememberOpenProject();
  const now = Date.now();
  const { permissions: _p, pinned: _pin, ...rest } = parsed;
  const p: Project = { ...rest, id: uid(), createdAt: now, updatedAt: now, ownerPlan: userPlan() };
  await storage.save(p);
  state.projects = [projectMeta(p), ...state.projects];
  openProject(p);
  if (!state.linkMode) localStorage.setItem('doska.last', JSON.stringify({ pid: p.id, pageId: realPageId() }));
  refresh();
  fitContent();
  showToast(`Проект «${p.name}» открыт`);
}

/** Выбор файла проекта (.json) — строка «Файл проекта» режима «Импорт». */
export function openProjectFile(): void {
  if (!canOpenProjectFile()) return;
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.json,application/json';
  input.onchange = () => {
    const f = input.files?.[0];
    if (f) void importProjectFile(f);
  };
  input.click();
}

/** Событие буфера обмена относится к доске, а не к полю ввода или окну настроек. */
function boardClipboardEvent(e: ClipboardEvent): boolean {
  return state.view === 'board' && !settingsDialogOpen() && !isTypingField(e.target);
}

/** Можно менять содержимое активной страницы (в совместной работе — нужно право edit). */
export function canEditBoard(): boolean {
  return state.linkMode === null && !(collabActive() && readOnly());
}

// ----- Задания -----

let toolBeforeTask: ToolId = 'select';
let taskToolPending = false;

/**
 * «Задание» на панели — не режим рисования, а кнопка: инструмент возвращается прежний, открывается форма.
 * true — это было нажатие на неё (дальше onChange ничего не делает).
 */
function interceptTaskTool(): boolean {
  if (state.tool !== 'task') { toolBeforeTask = state.tool; return false; }
  if (!taskToolPending) {
    taskToolPending = true;
    queueMicrotask(() => {
      taskToolPending = false;
      if (state.tool === 'task') setTool(toolBeforeTask);
      openTaskForm(null);
    });
  }
  return true;
}

/** Форма задания: новое (el = null) или правка существующего. Задания добавляет и правит автор, не ученик. */
export function openTaskForm(el: TaskEl | null): void {
  if (state.view !== 'board' || !canEditBoard() || !isTeacher()) return;
  openTaskDialog(el, values => (el ? applyTaskForm(el.id, values) : addTaskFromForm(values)));
}

export function editTaskElement(el: TaskEl): void {
  openTaskForm(el);
}

function addTaskFromForm(v: TaskFormValues): void {
  const r = canvas.getBoundingClientRect();
  const cam = state.camera;
  const el = createTaskElement({
    ...v, taskId: uid(),
    x: cam.x + r.width / (2 * cam.zoom) - TASK_W / 2,
    y: cam.y + r.height / (2 * cam.zoom) - TASK_H / 2,
  });
  addElement(el);
  selectInserted(el.id);
}

/** Правка формой: условие, ответ, решение и остальное; положение, размер, попытки и ввод ученика остаются. */
function applyTaskForm(id: string, v: TaskFormValues): void {
  const prev = state.board.elements;
  const next = prev.map(e => {
    if (e.id !== id || e.type !== 'task') return e;
    const { answerUnit: _u, codeSnippet: _c, solutionMd: _s, ...rest } = e;
    return {
      ...rest, subject: v.subject, examType: v.examType, topic: v.topic, statementMd: v.statementMd, answer: v.answer,
      ...(v.answerUnit !== undefined ? { answerUnit: v.answerUnit } : {}),
      ...(v.codeSnippet !== undefined ? { codeSnippet: v.codeSnippet } : {}),
      ...(v.solutionMd !== undefined ? { solutionMd: v.solutionMd } : {}),
    } as Element;
  });
  pushHistory(prev);
  replaceElements(next);
}

/** Видимая область холста в координатах сцены. */
export function viewRect(): AABB {
  const r = canvas.getBoundingClientRect();
  const cam = state.camera;
  return { x0: cam.x, y0: cam.y, x1: cam.x + r.width / cam.zoom, y1: cam.y + r.height / cam.zoom };
}

/** Ctrl+D: копия выделенного со сдвигом, выделение переходит на неё. */
export function duplicateSelection(): void {
  if (!canEditBoard()) return;
  duplicateInPlace();
}

/** Вставляет текст из буфера обмена на холст в центр видимой области. */
function pasteTextOnBoard(pt: PastedText): void {
  const v = viewRect();
  const size = Math.round(Math.min(120, Math.max(8, pt.size ?? 20)));
  const longest = pt.text.split('\n').reduce((m, l) => Math.max(m, l.length), 0);
  const w = longest > 50 ? Math.min(560, (v.x1 - v.x0) * 0.7) : undefined;
  const el: TextEl = {
    id: uid(), type: 'text', text: pt.text,
    x: (v.x0 + v.x1) / 2 - (w ?? 0) / 2, y: (v.y0 + v.y1) / 2 - size * 1.25 / 2,
    size, color: pt.color ?? state.style.color,
  };
  if (w) el.w = w;
  if (pt.bold) el.bold = true;
  if (pt.italic) el.italic = true;
  if (pt.runs) el.runs = pt.runs;
  pushHistory(state.board.elements);
  replaceElements([...state.board.elements, el]);
  selectInserted(el.id);
}

function wireImageInput(): void {
  document.getElementById('btn-image')!.addEventListener('click', () => { void insertImage(); });
  // Ctrl+C / Ctrl+X / Ctrl+V: элементы доски и картинки из буфера обмена
  const copyOrCut = (e: ClipboardEvent, cut: boolean) => {
    if (!boardClipboardEvent(e)) return;
    // выделенный текст интерфейса копируется как обычно
    const sel = window.getSelection();
    if (sel && !sel.isCollapsed) return;
    if (cut && !canEditBoard()) return;
    if (copySelection(e.clipboardData, cut)) e.preventDefault();
  };
  document.addEventListener('copy', e => copyOrCut(e, false));
  document.addEventListener('cut', e => copyOrCut(e, true));
  document.addEventListener('paste', e => {
    if (!boardClipboardEvent(e) || !canEditBoard()) return;
    // скопированное на доске важнее картинки: системный буфер хранит последнее копирование
    if (pasteFromSystem(e.clipboardData, viewRect())) { e.preventDefault(); return; }
    for (const it of e.clipboardData?.items ?? []) {
      if (it.kind === 'file' && it.type.startsWith('image/')) {
        const f = it.getAsFile();
        if (f) {
          e.preventDefault();
          insertImageFile(f);
          return;
        }
      }
    }
    // текст из буфера: ложится на холст с абзацами, списками, жирным/курсивом, цветом и размером
    const pt = readClipboardText(e.clipboardData);
    if (pt) { e.preventDefault(); pasteTextOnBoard(pt); return; }
    if (pasteFromMemory(viewRect())) e.preventDefault();
  });
  // перетаскивание файла на доску
  const wrap = document.getElementById('canvas-wrap')!;
  wrap.addEventListener('dragover', e => e.preventDefault());
  wrap.addEventListener('drop', e => {
    e.preventDefault();
    const f = e.dataTransfer?.files?.[0];
    if (f) importDroppedFile(f);
  });
}

// ----- Камера -----

/** Куда плавно едет камера сейчас (центр и масштаб): повторные «+»/«−» складываются, а не теряют шаги. */
let viewGoal: { cx: number; cy: number; zoom: number } | null = null;

/** Плавно перевести камеру: центр экрана — в мировую точку, масштаб — в zoom (без анимаций — сразу). */
function glideView(cx: number, cy: number, zoom: number): void {
  viewGoal = { cx, cy, zoom: clampZoom(zoom) };
  animateCameraTo(cx, cy, viewGoal.zoom);
}

/** Плавный масштаб относительно центра холста: кнопки «+»/«−», пункты 50…800 %, «Другой масштаб». */
function zoomCenterSmooth(zoom: number): void {
  stopFollowByUser();
  const r = canvas.getBoundingClientRect();
  const goal = cameraAnimating() ? viewGoal : null;
  const cam = state.camera;
  glideView(goal?.cx ?? cam.x + r.width / 2 / cam.zoom, goal?.cy ?? cam.y + r.height / 2 / cam.zoom, zoom);
}

/** Масштаб, к которому идёт камера: текущий или конечный у идущего перелёта. */
function zoomGoal(): number {
  return cameraAnimating() && viewGoal ? viewGoal.zoom : state.camera.zoom;
}

/** «Показать всё»; smooth — плавный перелёт (по действию пользователя), иначе мгновенно (открытие страницы). */
export function fitContent(smooth = false): void {
  const r = canvas.getBoundingClientRect();
  const els = state.board.elements;
  if (els.length === 0) {
    if (smooth) { glideView(0, 0, 1); return; }
    state.camera = { x: -r.width / 2, y: -r.height / 2, zoom: 1 };
    update();
    return;
  }
  const bb = contentBBox(els);
  const zoom = Math.max(0.05, Math.min(1.5, Math.min(r.width / (bb.w + 160), r.height / (bb.h + 160))));
  if (smooth) { glideView(bb.x0 + bb.w / 2, bb.y0 + bb.h / 2, zoom); return; }
  state.camera = {
    zoom,
    x: bb.x0 + bb.w / 2 - r.width / (2 * zoom),
    y: bb.y0 + bb.h / 2 - r.height / (2 * zoom),
  };
  update();
}

// Положение просмотра хранится локально, отдельно от содержимого общего проекта.
function cameraKey(projectId: string, pageId: string): string {
  return `doska.camera.${encodeURIComponent(projectId)}.${encodeURIComponent(pageId)}`;
}

/** Камеры черновиков — только в памяти: на диске им не место. */
const draftCameras = new Map<string, Camera>();

function saveCamera(): void {
  if (linkTransit || state.linkMode) return;
  if (onDraft()) { draftCameras.set(state.pageId, { ...state.camera }); return; }
  try { localStorage.setItem(cameraKey(state.project.id, state.pageId), JSON.stringify(state.camera)); }
  catch { /* просмотр продолжает работать, даже если хранилище недоступно */ }
}

function restoreCamera(): boolean {
  // по ссылке просмотра положение камеры не запоминается и не берётся с устройства
  if (state.linkMode) return false;
  if (onDraft()) {
    const camera = draftCameras.get(state.pageId);
    if (!camera) return false;
    state.camera = { ...camera };
    update();
    return true;
  }
  try {
    const camera = JSON.parse(localStorage.getItem(cameraKey(state.project.id, state.pageId)) || 'null') as Camera | null;
    if (!camera || !Number.isFinite(camera.x) || !Number.isFinite(camera.y) ||
        !Number.isFinite(camera.zoom) || camera.zoom <= 0) return false;
    state.camera = { x: camera.x, y: camera.y, zoom: camera.zoom };
    update();
    return true;
  } catch { return false; }
}

// ----- Сохранение -----

export async function saveNow(): Promise<void> {
  clearTimeout(saveTimer);
  // просмотр по ссылке ничего не записывает: в проекте зрителя нет скрытых страниц и ответов
  if (state.linkMode) { state.dirty = false; return; }
  if (!state.dirty) return;
  state.dirty = false;
  await storage.save(state.project);
  const meta = projectMeta(state.project);
  state.projects = [meta, ...state.projects.filter(m => m.id !== meta.id)];
  localStorage.setItem('doska.last', JSON.stringify({ pid: state.project.id, pageId: realPageId() }));
  renderPages();
}

function scheduleSave(): void {
  if (!state.dirty) return;
  clearTimeout(saveTimer);
  saveTimer = window.setTimeout(() => { void saveNow(); }, 600);
}

// уход в фон (свернули окно, на планшете — кнопка «Домой» или «Назад»): сохраняем сразу,
// не дожидаясь таймера — система может выгрузить приложение раньше
document.addEventListener('visibilitychange', () => {
  if (document.hidden) { saveCamera(); void saveNow(); }
});
window.addEventListener('beforeunload', saveCamera);

// ----- Страницы и проекты -----

/** Холсты, на которых играет переход между страницами: основной и окно демонстрации. */
function transitionCanvases(): HTMLCanvasElement[] {
  const pc = presentCanvas();
  return pc ? [canvas, pc] : [canvas];
}

/** Номер страницы в списке; черновики стоят правее всех страниц. */
function pageIndex(pageId: string): number {
  const i = state.project.pages.findIndex(p => p.id === pageId);
  if (i >= 0) return i;
  const d = state.drafts.findIndex(p => p.id === pageId);
  return d >= 0 ? state.project.pages.length + d : -1;
}

/** Смена активной страницы (переключение, новая, удаление) — с анимацией перехода из настроек. */
function changePage(change: () => void): void {
  const fromId = state.pageId;
  saveCamera();
  const from = pageIndex(fromId);
  const board = state.view === 'board';
  const mode = state.settings.pageTransition;
  const play = board ? capturePageTransition(mode, [canvas]) : null;
  // окну демонстрации страница меняется, только если зрители увидят другую (черновик им не показывают)
  const pc = presentCanvas();
  const playPresent = board && pc ? capturePageTransition(mode, [pc]) : null;
  const shownBefore = realPageId();
  change();
  refresh();
  if (state.pageId !== fromId) {
    if (!restoreCamera()) fitContent();
    if (!state.linkMode) localStorage.setItem('doska.last', JSON.stringify({ pid: state.project.id, pageId: realPageId() }));
  }
  // кадр новой страницы — сразу и начисто, не дожидаясь покоя камеры
  renderNow();
  const dir = pageIndex(state.pageId) >= from ? 1 : -1;
  if (play && state.pageId !== fromId) play(dir);
  if (playPresent && realPageId() !== shownBefore) playPresent(dir);
}

// ----- Страницы на холсте (раздел «Экспериментальные», см. page-links.ts) -----

/** Сколько растворяется кадр «до» после перехода по странице на холсте (мс; как у перехода «Затухание»). */
const LINK_FADE_MS = 280;
/** Идёт переход по странице на холсте: новый не начинается. */
let linkTransit = false;

/**
 * Клик по странице на холсте: превью плавно приближается на весь экран, и открывается сама страница —
 * в том же положении, поэтому переход бесшовный. Пока он идёт, ввод заблокирован.
 */
export async function openPageLink(el: ImageEl, duringDrag = false): Promise<void> {
  if (linkTransit || !el.page || state.view !== 'board') return;
  const page = state.project.pages.find(p => p.id === el.page);
  if (!page) return;
  if (page.id === state.pageId) { setRecursionDiscovered(true); if (!state.settings.recursionEnabled) advanceRecursion(el); return; }
  saveCamera();
  linkTransit = true;
  const unlock = duringDrag ? () => {} : lockInput();
  setSelection([]);
  const r = canvas.getBoundingClientRect();
  const { fill, target } = linkCameras(el, page, r.width, r.height, linkView(page, el.w / el.h));
  const from = { ...state.camera };
  const ms = zoomDuration(from, fill);
  const t0 = performance.now();
  await new Promise<void>(resolve => {
  const step = (now: number) => {
    const t = Math.min(1, (now - t0) / ms);
    state.camera = zoomPath(from, fill, easeInOut(t));
    update();
    // каждый кадр начисто: растянутый кэш сцены размылся бы
    renderNow();
    if (t < 1) { requestAnimationFrame(step); return; }
    void (async () => {
      try {
        await saveNow();
        // кадр «до» растворяется поверх страницы: отличаются только поля вокруг превью и его рамка
        const play = capturePageTransition('fade', transitionCanvases());
        switchPage(page.id);
        if (!restoreCamera()) { state.camera = target; update(); }
        if (!state.linkMode) localStorage.setItem('doska.last', JSON.stringify({ pid: state.project.id, pageId: realPageId() }));
        refresh();
        renderNow();
        play?.(1);
        if (play) await new Promise(res => setTimeout(res, LINK_FADE_MS));
      } finally {
        unlock();
        linkTransit = false;
        saveCamera();
        resolve();
      }
    })();
  };
  requestAnimationFrame(step);
  });
}

/** Карточка страницы, вынесенная из списка: её превью едет за указателем. */
function pageCardGhost(item: HTMLElement): HTMLElement {
  const ghost = document.createElement('div');
  ghost.className = 'page-ghost';
  const src = item.querySelector<HTMLCanvasElement>('.page-thumb canvas');
  const cv = document.createElement('canvas');
  if (src && src.width > 0) {
    cv.width = src.width;
    cv.height = src.height;
    cv.getContext('2d')?.drawImage(src, 0, 0);
  }
  ghost.appendChild(cv);
  return ghost;
}

/** Страницу из списка бросили на холст — там появляется её превью (а мимо холста — ничего). */
function dropPageOnCanvas(index: number, x: number, y: number): void {
  const page = state.project.pages[index];
  if (!page || state.view !== 'board' || !canEditBoard() || document.elementFromPoint(x, y) !== canvas) return;
  if (page.id === state.pageId) setRecursionDiscovered(true);
  const r = canvas.getBoundingClientRect();
  const cam = state.camera;
  const el = newPageLink(uid(), page, { x: (x - r.left) / cam.zoom + cam.x, y: (y - r.top) / cam.zoom + cam.y }, cam, r.width, r.height);
  addElement(el);
  selectInserted(el.id);
}

/** Перейти к участнику: его страница, затем плавный перелёт камеры к точке (SPEC_NIGHT5 §8). */
async function goToCollabPoint(d: CollabGotoDetail): Promise<void> {
  if (state.view !== 'board' || !state.project.pages.some(p => p.id === d.pageId)) return;
  if (d.pageId !== state.pageId) await switchPageHandler(d.pageId);
  if (state.pageId !== d.pageId) return;
  if (d.x !== undefined && d.y !== undefined) animateCameraTo(d.x, d.y, d.zoom, d.ms);
}

/** Аватары участников у карточек страниц (состав комнаты изменился). */
function refreshPageAvatars(): void {
  for (const page of state.project.pages) {
    const card = pageCards.get(page.id);
    if (card) fillPageAvatars(card.avatars, page.id);
  }
}

async function switchPageHandler(pageId: string): Promise<void> {
  if (pageId === state.pageId || state.view !== 'board') return;
  await saveNow();
  changePage(() => switchPage(pageId));
}

/** Переход во время переноса без задержки на сохранение и анимацию. */
export function switchPageForDrag(pageId: string): void {
  if (pageId !== state.pageId) changePage(() => switchPage(pageId));
}

/** Переход на страницу по номеру (Ctrl или Alt + 1…9); такой страницы нет — ничего. */
export function switchToPage(n: number): void {
  const page = state.project.pages[n - 1];
  if (page) void switchPageHandler(page.id);
}

/** Новая страница по горячей клавише (гость совместной работы страниц не добавляет). */
export function addPageFromKey(): void {
  if (state.view !== 'board' || !canEditPages()) return;
  void newPageHandler();
}

/** Новый черновик по горячей клавише. */
export function addDraftFromKey(): void {
  if (state.view !== 'board' || !canEditPages()) return;
  void newDraftHandler();
}

/** Подсказка «Создать черновик (Alt+Shift+N)». */
function newDraftTip(): string {
  return `Создать черновик (${comboLabel(DRAFT_KEY)})`;
}

async function newDraftHandler(): Promise<void> {
  await saveNow();
  changePage(() => addDraft());
}

/** Подсказка «Новая страница (Ctrl+N)» — с сочетанием из настроек, если оно есть. */
function newPageTip(): string {
  const k = state.settings.newPageKey;
  return k ? `Новая страница (${comboLabel(k)})` : 'Новая страница';
}

async function newPageHandler(): Promise<void> {
  if (!canAddPageTo(state.project)) { requestUpgrade('pages'); return; }
  await saveNow();
  changePage(() => addPage());
}

async function deletePageHandler(pageId: string): Promise<void> {
  if (!canEditPages()) return;
  const draft = state.drafts.find(d => d.id === pageId);
  if (draft) {
    // пустой черновик убираем сразу: терять в нём нечего
    if (draft.elements.length > 0 && !confirm(`Удалить черновик «${draft.name}»?`)) return;
    changePage(() => deleteDraft(pageId));
    draftCameras.delete(pageId);
    return;
  }
  const page = state.project.pages.find(p => p.id === pageId);
  if (!page) return;
  // проект сверх лимита free (остался с Pro): после удаления страницу заново не создать
  const overLimit = limitsEnforced() && isOverPageLimit(projectPlan(state.project), state.project.pages.length);
  const msg = overLimit
    ? `Удалить страницу «${page.name}»?\n\nВ проекте больше страниц, чем разрешено на бесплатном тарифе (${PLAN_LIMITS.free.maxPagesPerProject}). Заново создать удалённую страницу не получится, пока не оформлена подписка Pro. Оформите подписку, чтобы снять ограничение.`
    : `Удалить страницу «${page.name}»?`;
  if (!confirm(msg)) return;
  await saveNow();
  changePage(() => deletePage(pageId));
  try { localStorage.removeItem(cameraKey(state.project.id, pageId)); } catch { /* нет доступа к хранилищу */ }
}

async function renamePageHandler(pageId: string, name: string): Promise<void> {
  if (!canEditPages()) return;
  renamePage(pageId, name);
  await saveNow();
}

async function movePageHandler(from: number, to: number): Promise<void> {
  if (!canEditPages()) return;
  movePage(from, to);
  await saveNow();
}

const THUMB_W = 164;
const THUMB_H = 100;

/** Камера превью, вписывающая рамку frame; null — пустая страница: начало координат в центре. */
function thumbCamera(frame: AABB | null): Camera {
  const W = THUMB_W;
  const H = THUMB_H;
  if (!frame) return { x: -W / 2, y: -H / 2, zoom: 1 };
  const w = frame.x1 - frame.x0, h = frame.y1 - frame.y0;
  const zoom = Math.max(0.02, Math.min(1, Math.min(W / (w + 40), H / (h + 40))));
  return { zoom, x: frame.x0 + w / 2 - W / (2 * zoom), y: frame.y0 + h / 2 - H / (2 * zoom) };
}

/** Что вписать в превью: содержимое и, если задана, видимую область (у текущей страницы — как на мини-карте). */
function thumbFrame(content: AABB | null, view: AABB | null): AABB | null {
  return content && view ? aabbUnion(content, view) : content ?? view;
}

/** Мини-превью страницы: вписывает содержимое (и область view) в карточку; возвращает камеру превью и рамку содержимого. */
function renderPageThumb(page: Page, cv: HTMLCanvasElement, view: AABB | null = null): { cam: Camera; content: AABB | null } {
  cv.width = THUMB_W * 2;
  cv.height = THUMB_H * 2;
  const content = page.elements.length > 0 ? contentBBox(page.elements) : null;
  const cam = thumbCamera(thumbFrame(content, view));
  const c = cv.getContext('2d');
  if (c) renderScene(c, page.elements, cam, THUMB_W, THUMB_H, 2, page.grid === 'coord' ? 'none' : page.grid, undefined, false, page.backgroundColor);
  return { cam, content };
}

function pagesKey(): string {
  return [
    state.project.id,
    state.project.name,
    state.pageId,
    state.projects.length,
    state.project.updatedAt,
    state.project.pages.map(p => `${p.id}:${p.name}:${p.grid}:${p.elements.length}`).join('|'),
    state.drafts.map(p => `${p.id}:${p.name}:${p.grid}:${p.elements.length}`).join('|'),
    state.draftRev,
  ].join('#');
}

// ----- Плавающая кнопка страниц и список под ней -----

/** Список страниц показан: кнопка приподнята над ним. */
let pagesOpen = false;
/** Последнее решение syncPagesLift: при закрытии списка сохраняется, чтобы угол опустился вместе с кнопкой. */
let pagesLift = false;

interface PageCard {
  el: HTMLElement;
  /** Аватары участников на этой странице (SPEC_NIGHT5 §8). */
  avatars: HTMLElement;
  thumb: HTMLCanvasElement;
  /** Рамка видимой области (только у текущей страницы). */
  view: HTMLElement;
  /** Камера превью: где на нём сцена (при каждой перерисовке превью — своя). */
  cam: Camera | null;
  /** Рамка содержимого на момент перерисовки превью. */
  content: AABB | null;
  num: HTMLElement;
  grid: HTMLElement;
  name: HTMLElement;
  gridMode: string | null;
  /** С чего снято превью: массивы элементов иммутабельны — сравниваем по ссылке. */
  shot: { elements: Element[]; grid: GridMode; epoch: number; recursion: boolean } | null;
}
const pageCards = new Map<string, PageCard>();
let revealedPageId = '';

/** Гость совместной работы страниц не добавляет и не удаляет. */
function canEditPages(): boolean {
  return state.linkMode === null && !(collabActive() && !isHost());
}

function makePageCard(pageId: string, draft = false): PageCard {
  const el = document.createElement('div');
  el.className = draft ? 'page-item draft' : 'page-item';
  el.dataset.pageId = pageId;
  const thumbBox = document.createElement('div');
  thumbBox.className = 'page-thumb';
  const thumb = document.createElement('canvas');
  // размер — сразу: превью рисуются при первом открытии списка
  thumb.style.width = `${THUMB_W}px`;
  thumb.style.height = `${THUMB_H}px`;
  const num = document.createElement('span');
  num.className = 'page-num';
  const view = document.createElement('div');
  view.className = 'page-view';
  view.hidden = true;
  const avatars = document.createElement('div');
  avatars.className = 'page-avatars';
  avatars.hidden = true;
  thumbBox.append(thumb, view, num, avatars);
  const row = document.createElement('div');
  row.className = 'page-row';
  const grid = document.createElement('span');
  grid.className = 'page-grid-icon';
  grid.title = 'Фон страницы';
  const name = document.createElement('span');
  name.className = 'page-name';
  name.title = 'Двойной клик - переименовать';
  row.append(grid, name);
  const del = document.createElement('button');
  del.className = 'page-del';
  del.title = draft ? 'Удалить черновик' : 'Удалить страницу';
  del.innerHTML = ICONS.del;
  el.append(thumbBox, row, del);
  const card: PageCard = { el, avatars, thumb, view, cam: null, content: null, num, grid, name, gridMode: null, shot: null };
  el.addEventListener('click', e => {
    if ((e.target as HTMLElement).closest('.page-del, input')) return;
    void switchPageHandler(pageId);
    if (state.settings.closePagesOnPick) setPagesOpen(false);
  });
  name.addEventListener('dblclick', () => startPageRename(card, pageId));
  del.addEventListener('click', e => {
    e.stopPropagation();
    void deletePageHandler(pageId);
  });
  pageCards.set(pageId, card);
  return card;
}

/** Последний элемент списка — плитка с пунктиром: новая страница. */
function makeAddPageTile(): HTMLButtonElement {
  const b = document.createElement('button');
  b.className = 'page-add';
  b.title = 'Новая страница';
  // два вида: «+» и, пока зажат Alt или палец, «Создать черновик»
  b.innerHTML = `<span class="add-new">${ICONS.plus}</span>`
    + `<span class="add-draft">${ICONS.draft}<span>Создать черновик</span></span>`;
  wireCreate(b, () => canEditPages(), () => { void newPageHandler(); });
  // четвёртая страница на бесплатном тарифе — бейдж Pro (src/pro-badge.ts)
  b.appendChild(proBadge('pages', { className: 'page-add-pro', needed: false }));
  return b;
}

/** Разделитель между страницами и черновиками. */
function makeDraftDivider(): HTMLElement {
  const d = document.createElement('div');
  d.className = 'page-divider';
  d.setAttribute('role', 'separator');
  d.title = 'Справа - черновики: их видите только вы';
  return d;
}

// ----- Черновик вместо страницы: Alt, долгое нажатие -----

/** Задержка долгого нажатия, после которой вместо страницы создаётся черновик (планшеты без Alt). */
const DRAFT_HOLD_MS = 550;
/** Раньше этого срока кнопка уже «переодевается» в «Создать черновик»: видно, что происходит. */
const DRAFT_HINT_MS = 220;
let altHeld = false;
/** Палец или кнопка мыши удерживаются на кнопке создания страницы. */
let pressDraft = false;
let addPageTile: HTMLButtonElement | null = null;
let addDraftDivider: HTMLElement | null = null;

/** Кнопка создаёт черновик, а не страницу: зажат Alt или идёт долгое нажатие. */
function draftMode(): boolean {
  return altHeld || pressDraft;
}

/** Кнопки «новая страница» показывают то, что нажатие сделает сейчас. */
function syncDraftMode(): void {
  const on = draftMode();
  if (addPageTile) {
    addPageTile.classList.toggle('draft-mode', on);
    const pro = addPageTile.querySelector<HTMLElement>('.pro-badge');
    // черновики лимитом не считаются: бейдж — только у «новой страницы», когда страниц уже столько, сколько даёт free
    if (pro) setProBadgeNeeded(pro, !on && state.project.pages.length >= PLAN_LIMITS.free.maxPagesPerProject);
    const tip = on ? newDraftTip() : newPageTip();
    if ((addPageTile.getAttribute('title') ?? addPageTile.dataset.tip) !== tip) addPageTile.title = tip;
  }
  syncPagesButton();
}

function setAltHeld(on: boolean): void {
  if (altHeld === on) return;
  altHeld = on;
  syncDraftMode();
}

/**
 * Кнопка создания страницы: клик — страница; клик с Alt или долгое нажатие — черновик.
 * enabled — можно ли сейчас (гость совместной работы страниц не добавляет).
 */
function wireCreate(el: HTMLElement, enabled: () => boolean, createPage: () => void): void {
  let hint = 0;
  let hold = 0;
  let fired = false;
  let start = { x: 0, y: 0 };
  const cancel = () => {
    clearTimeout(hint);
    clearTimeout(hold);
    hint = hold = 0;
    if (pressDraft) { pressDraft = false; syncDraftMode(); }
  };
  el.addEventListener('pointerdown', e => {
    if (e.button !== 0 || !enabled()) return;
    fired = false;
    start = { x: e.clientX, y: e.clientY };
    cancel();
    hint = window.setTimeout(() => { pressDraft = true; syncDraftMode(); }, DRAFT_HINT_MS);
    hold = window.setTimeout(() => {
      fired = true;
      cancel();
      void newDraftHandler();
    }, DRAFT_HOLD_MS);
  });
  el.addEventListener('pointermove', e => {
    if ((hint || hold) && Math.hypot(e.clientX - start.x, e.clientY - start.y) > 10) cancel();
  });
  for (const type of ['pointerup', 'pointercancel', 'pointerleave']) el.addEventListener(type, cancel);
  // долгое нажатие на сенсорном экране не должно открывать контекстное меню
  el.addEventListener('contextmenu', e => { if (hint || hold || fired) e.preventDefault(); });
  // клик, которым закончилось долгое нажатие, — не «новая страница»
  el.addEventListener('click', e => {
    if (fired) { fired = false; e.stopImmediatePropagation(); e.preventDefault(); return; }
    if (!e.altKey || !enabled()) return;
    e.stopImmediatePropagation();
    e.preventDefault();
    void newDraftHandler();
  }, true);
  el.addEventListener('click', () => { if (enabled()) createPage(); });
}

/** Видимая область, которую вписывает превью страницы: только у текущей и при включённой настройке. */
function thumbView(pageId: string): AABB | null {
  return pageId === state.pageId && state.settings.thumbViewport && state.view === 'board' ? viewRect() : null;
}

/** Превью уже вписано иначе, чем нужно сейчас: заметно другой масштаб или сдвиг. */
function thumbOffFrame(card: PageCard, view: AABB | null): boolean {
  const cam = card.cam;
  if (!cam) return true;
  const want = thumbCamera(thumbFrame(card.content, view));
  return Math.abs(want.zoom / cam.zoom - 1) > 0.1
    || Math.abs((want.x - cam.x) * want.zoom) > 4 || Math.abs((want.y - cam.y) * want.zoom) > 4;
}

/** Превью перерисовывается, только если изменились содержимое, фон или (у текущей страницы) видимая область вышла за него. */
function syncPageThumb(card: PageCard, page: Page): void {
  const epoch = imageEpoch();
  const shot = card.shot;
  const view = thumbView(page.id);
  if (shot && shot.elements === page.elements && shot.grid === page.grid && shot.epoch === epoch && shot.recursion === state.settings.recursionEnabled && !thumbOffFrame(card, view)) return;
  card.shot = { elements: page.elements, grid: page.grid, epoch, recursion: state.settings.recursionEnabled };
  ({ cam: card.cam, content: card.content } = renderPageThumb(page, card.thumb, view));
}

let reframeTimer = 0;

/**
 * Рамка видимой сейчас области — на превью текущей страницы, цветом курсора
 * (в совместной работе — своим цветом участника). Двигается вместе с камерой; когда камера
 * успокоится, превью перевписывается, чтобы рамка была видна целиком.
 */
function syncThumbViewport(): void {
  if (!pagesOpen) return;
  const card = pageCards.get(state.pageId);
  for (const c of pageCards.values()) if (c !== card) c.view.hidden = true;
  if (!card?.cam) return;
  const view = thumbView(state.pageId);
  card.view.hidden = !view;
  if (thumbOffFrame(card, view)) {
    clearTimeout(reframeTimer);
    reframeTimer = window.setTimeout(() => {
      if (!pagesOpen || card !== pageCards.get(state.pageId)) return;
      syncPageThumb(card, state.board);
      syncThumbViewport();
    }, 150);
  }
  if (!view) return;
  const t = card.cam;
  const v = card.view;
  v.style.left = `${(view.x0 - t.x) * t.zoom}px`;
  v.style.top = `${(view.y0 - t.y) * t.zoom}px`;
  v.style.width = `${(view.x1 - view.x0) * t.zoom}px`;
  v.style.height = `${(view.y1 - view.y0) * t.zoom}px`;
  v.style.setProperty('--view', collabActive() ? myColor() : '#3273f5');
}

/** Список страниц сверяется с проектом: карточки переиспользуются, а не пересоздаются. */
function renderPages(): void {
  // карточку тащат: список сверится с проектом, когда её отпустят
  if (reordering()) return;
  try {
    topProjectName?.set(state.project.name);
    topProjectIcon?.set(state.project.icon ?? null);
    const list = document.getElementById('pages-list')!;
    const pages = state.project.pages;
    const seen = new Set<string>();
    pages.forEach((page, i) => {
      seen.add(page.id);
      const card = pageCards.get(page.id) ?? makePageCard(page.id);
      card.el.classList.toggle('active', page.id === state.pageId);
      card.el.style.setProperty('--i', String(i));
      card.num.textContent = String(i + 1);
      fillPageAvatars(card.avatars, page.id);
      if (card.name.textContent !== page.name) card.name.textContent = page.name;
      const pageGridKey = `${page.grid}:${page.coordLabels !== false}`;
      if (card.gridMode !== pageGridKey) {
        card.gridMode = pageGridKey;
        card.grid.innerHTML = gridIcon(page.grid, page.coordLabels !== false);
      }
      // превью рисуются только у открытого списка
      if (pagesOpen) syncPageThumb(card, page);
      // переставляем, только если не на месте: перенос узла сбросил бы фокус переименования
      if (list.children[i] !== card.el) list.insertBefore(card.el, list.children[i] ?? null);
    });
    // черновики — правее всех страниц, за разделителем
    state.drafts.forEach((draft, i) => {
      seen.add(draft.id);
      const card = pageCards.get(draft.id) ?? makePageCard(draft.id, true);
      card.el.classList.toggle('active', draft.id === state.pageId);
      card.el.style.setProperty('--i', String(pages.length + 1 + i));
      card.num.textContent = 'Ч';
      card.num.title = 'Черновик';
      if (card.name.textContent !== draft.name) card.name.textContent = draft.name;
      const draftGridKey = `${draft.grid}:${draft.coordLabels !== false}`;
      if (card.gridMode !== draftGridKey) {
        card.gridMode = draftGridKey;
        card.grid.innerHTML = gridIcon(draft.grid, draft.coordLabels !== false);
      }
      if (pagesOpen) syncPageThumb(card, draft);
    });
    for (const [id, card] of pageCards) {
      if (seen.has(id)) continue;
      card.el.remove();
      pageCards.delete(id);
    }
    // за страницами: плитка «новая страница», разделитель и черновики
    const tail: HTMLElement[] = [];
    if (canEditPages()) {
      addPageTile ??= makeAddPageTile();
      addPageTile.style.setProperty('--i', String(pages.length));
      tail.push(addPageTile);
    } else {
      addPageTile?.remove();
    }
    if (state.drafts.length > 0) {
      addDraftDivider ??= makeDraftDivider();
      tail.push(addDraftDivider);
      for (const draft of state.drafts) tail.push(pageCards.get(draft.id)!.el);
    } else {
      addDraftDivider?.remove();
    }
    tail.forEach((node, k) => {
      const at = pages.length + k;
      if (list.children[at] !== node) list.insertBefore(node, list.children[at] ?? null);
    });
    // подсказка плитки уже могла переехать в data-tip (см. tooltip.ts): syncDraftMode обновляет её, только если она сменилась
    syncDraftMode();
    const tray = document.getElementById('pages-tray')!;
    document.getElementById('pages-dock')!.style.setProperty('--tray-h', `${tray.offsetHeight}px`);
    syncPagesLift();
    if (pagesOpen && revealedPageId !== state.pageId) {
      revealedPageId = state.pageId;
      revealActivePage(true);
    }
    morphPagesSync();
  } catch (err) { console.error('[doska] renderPages failed:', err); }
}

/** Кнопка: «Страница +», пока страница одна (добавляет вторую), иначе «Страницы» с числом. */
function syncPagesButton(): void {
  const btn = document.getElementById('btn-pages')!;
  const n = state.project.pages.length;
  const add = n === 1 && state.drafts.length === 0 && !pagesOpen && canEditPages();
  const draft = add && draftMode();
  const key = `${add}:${draft}:${n}:${pagesOpen}:${state.settings.newPageKey}`;
  if (btn.dataset.key === key) return;
  btn.dataset.key = key;
  btn.classList.toggle('add', add);
  btn.setAttribute('aria-expanded', String(pagesOpen));
  btn.innerHTML = add
    ? `${draft ? ICONS.draft : ICONS.pages}<span class="pages-label">${draft ? 'Черновик' : 'Страница'}</span> <span class="pages-plus">${ICONS.plus}</span>`
    : `${ICONS.pages}<span class="pages-label">Страницы</span> <span class="pages-count">${n}</span>`
      + `<span class="pages-chev">${ICONS.chevronUp}</span>`;
  btn.title = add ? (draft ? newDraftTip() : newPageTip()) : pagesOpen ? 'Скрыть страницы (B)' : 'Показать страницы (B)';
}

/** Прокручивает список так, чтобы активная страница была видна. */
function revealActivePage(smooth: boolean): void {
  const list = document.getElementById('pages-list')!;
  const el = pageCards.get(state.pageId)?.el;
  if (!el) return;
  const pad = 12;
  const vertical = pagesAtTop();
  const start = (vertical ? el.offsetTop : el.offsetLeft) - pad;
  const end = (vertical ? el.offsetTop + el.offsetHeight : el.offsetLeft + el.offsetWidth) + pad;
  const scroll = vertical ? list.scrollTop : list.scrollLeft;
  const size = vertical ? list.clientHeight : list.clientWidth;
  let to = scroll;
  if (start < to) to = start;
  else if (end > to + size) to = end - size;
  if (to !== scroll) list.scrollTo({ [vertical ? 'top' : 'left']: to, behavior: smooth ? 'smooth' : 'auto' });
}

/**
 * Список страниц внизу не помещается в ширину рядом с правым нижним углом: «Масштаб, вид и взаимодействия» и «Помощь»
 * поднимаются вместе с кнопкой «Страницы» (класс pages-lift у body), и список занимает всю ширину.
 * Решение не зависит от самого подъёма (ширина угла от него не меняется), поэтому не мигает.
 */
function syncPagesLift(): void {
  if (pagesOpen) {
    const dock = document.getElementById('pages-dock')!;
    const list = document.getElementById('pages-list')!;
    const last = list.lastElementChild as HTMLElement | null;
    if (pagesAtTop() || !last) {
      pagesLift = false;
    } else {
      // ширина содержимого списка (с полями 12px) минус его отрицательные поля; доступно — ширина холста без левого отступа и угла
      const content = last.offsetLeft + last.offsetWidth + 12 - 24;
      const wrapW = dock.parentElement!.clientWidth;
      const bottombarW = document.getElementById('bottombar')!.offsetWidth;
      pagesLift = content > wrapW - 36 - bottombarW;
    }
    document.documentElement.style.setProperty('--tray-h', `${document.getElementById('pages-tray')!.offsetHeight}px`);
  }
  document.body.classList.toggle('pages-lift', pagesOpen && pagesLift);
}

function setPagesOpen(open: boolean): void {
  if (pagesOpen === open) return;
  pagesOpen = open;
  renderPages();
  syncThumbViewport();
  document.getElementById('pages-dock')!.classList.toggle('open', open);
  syncPagesLift();
  if (open) {
    revealedPageId = state.pageId;
    revealActivePage(false);
  }
  morphPagesOpen(open);
}

/** Показать или скрыть список страниц (кнопка «Страницы», клавиша B). */
export function togglePages(): void {
  setPagesOpen(!pagesOpen);
}

/** Кнопка страниц работает как «Страница +»: пока страница одна, нажатие добавляет вторую. */
function pagesButtonAdds(): boolean {
  return !pagesOpen && state.project.pages.length === 1 && state.drafts.length === 0 && canEditPages();
}

function wirePagesDock(): void {
  initMorphPages({
    dock: document.getElementById('pages-dock')!,
    tray: document.getElementById('pages-tray')!,
    list: document.getElementById('pages-list')!,
    button: document.getElementById('btn-pages')!,
    bottombar: document.getElementById('bottombar')!,
    lifted: () => pagesLift,
    atTop: pagesAtTop,
    active: () => pageCards.get(state.pageId)?.el ?? null,
  });
  // Alt и долгое нажатие на «Страница +» создают черновик
  const pagesBtn = document.getElementById('btn-pages')!;
  wireCreate(pagesBtn, pagesButtonAdds, () => {});
  pagesBtn.addEventListener('click', () => {
    if (pagesButtonAdds()) {
      // «Страница +»: добавляет вторую страницу и показывает обе
      void newPageHandler().then(() => setPagesOpen(true));
      return;
    }
    togglePages();
  });
  // пока зажат Alt, кнопки «новая страница» превращаются в «Создать черновик»
  window.addEventListener('keydown', e => setAltHeld(e.altKey));
  window.addEventListener('keyup', e => setAltHeld(e.altKey));
  window.addEventListener('blur', () => setAltHeld(false));
  const list = document.getElementById('pages-list')!;
  makeSortable(list, {
    // черновики не переставляются и не выносятся на холст: они не часть проекта
    items: () => [...list.querySelectorAll<HTMLElement>(':scope > .page-item:not(.draft)')],
    enabled: canEditPages,
    scroller: list,
    // «Страницы на холсте»: карточку можно вынести на холст
    dropOutside: { enabled: () => state.settings.pageLinks && canEditBoard(), ghost: pageCardGhost, drop: dropPageOnCanvas },
    onEnd: (from, to) => {
      if (from !== to) void movePageHandler(from, to);
      else renderPages();
    },
  });
  // своя тонкая полоса прокрутки и растворение краёв, за которыми есть ещё страницы (src/overlay-scroll.ts)
  attachOverlayScroll(list, { axis: () => (pagesAtTop() ? 'y' : 'x'), host: document.getElementById('pages-tray')!, edges: 'fade' });
  list.addEventListener('wheel', e => {
    // обычное колёсико листает горизонтальный список; вертикальный листается сам
    if (pagesAtTop() || Math.abs(e.deltaY) <= Math.abs(e.deltaX)) return;
    e.preventDefault();
    list.scrollLeft += e.deltaY;
  }, { passive: false });
}

function startPageRename(card: PageCard, pageId: string): void {
  if (!canEditPages()) return;
  if (card.el.querySelector('input')) return;
  const oldName = (state.project.pages.find(p => p.id === pageId) ?? state.drafts.find(p => p.id === pageId))?.name;
  if (oldName === undefined) return;
  const input = document.createElement('input');
  input.value = oldName;
  input.maxLength = PAGE_NAME_MAX;
  input.spellcheck = false;
  card.name.hidden = true;
  card.name.after(input);
  input.focus();
  input.select();
  let done = false;
  const finish = (commit: boolean) => {
    if (done) return;
    done = true;
    input.remove();
    card.name.hidden = false;
    const v = input.value.trim();
    if (commit && v && v !== oldName) void renamePageHandler(pageId, v);
  };
  input.addEventListener('blur', () => finish(true));
  input.addEventListener('keydown', e => {
    e.stopPropagation();
    if (e.key === 'Enter') finish(true);
    if (e.key === 'Escape') finish(false);
  });
}

// ----- Домашняя страница: проекты -----

/**
 * Неоткрытые проекты, загруженные ради превью страниц; at — updatedAt из метаданных на момент загрузки
 * (разошлось — перезагружаем). project = null — файл не прочитался.
 */
const homeProjects = new Map<string, { at: number; project: Project | null }>();
const homeLoading = new Set<string>();
/** Превью страниц на домашней: холсты переживают перестройку списка, перерисовываются по изменению. */
const homeThumbs = new Map<string, { cv: HTMLCanvasElement; shot: { elements: Element[]; grid: GridMode } | null }>();

/** Проект для карточки на домашней: открытый — из состояния, остальные — из кэша (null — ещё грузится). */
function homeProject(meta: ProjectMeta): Project | null {
  if (state.project.id === meta.id) return state.project;
  const cached = homeProjects.get(meta.id);
  return cached && cached.at === meta.updatedAt ? cached.project : null;
}

function homeProjectFailed(meta: ProjectMeta): boolean {
  const cached = homeProjects.get(meta.id);
  return !!cached && cached.at === meta.updatedAt && !cached.project;
}

/** Догружает проекты, превью которых ещё нет, и перестраивает список. */
function loadHomeProjects(): void {
  const missing = state.projects.filter(m =>
    m.id !== state.project.id && !homeLoading.has(m.id) && homeProjects.get(m.id)?.at !== m.updatedAt);
  if (missing.length === 0) return;
  for (const m of missing) homeLoading.add(m.id);
  void Promise.all(missing.map(async m => {
    const project = await storage.load(m.id).catch(() => null);
    homeProjects.set(m.id, { at: m.updatedAt, project });
    homeLoading.delete(m.id);
  })).then(() => { if (state.view === 'home') renderHome(); });
}

/** Уходим из открытого проекта: его текущий вид — превью на домашней без повторной загрузки. */
function rememberOpenProject(): void {
  homeProjects.set(state.project.id, { at: state.project.updatedAt, project: state.project });
}

/** Правка неоткрытого проекта: загрузить, изменить, сохранить; метаданные и превью — следом. */
async function editClosedProject(id: string, edit: (p: Project) => Project, touch = true): Promise<Project | null> {
  const loaded = await storage.load(id);
  if (!loaded) return null;
  const p = edit(loaded);
  if (touch) p.updatedAt = Date.now();
  await storage.save(p);
  homeProjects.set(id, { at: p.updatedAt, project: p });
  state.projects = state.projects.map(m => (m.id === id ? projectMeta(p) : m));
  return p;
}

async function openProjectHandler(project: Project, pageId?: string): Promise<void> {
  await saveNow();
  saveCamera();
  if (project.id !== state.project.id) rememberOpenProject();
  openProject(project, pageId);
  if (!state.linkMode) localStorage.setItem('doska.last', JSON.stringify({ pid: project.id, pageId: realPageId() }));
  refresh();
  if (!restoreCamera()) fitContent();
}

/** Открывает проект с домашней (на заданной странице или первой). */
async function openFromHome(projectId: string, pageId?: string): Promise<void> {
  // свой проект с учётом облака: на сервере версия могла стать новее (правки с другого устройства или учеников в комнате)
  const p = state.project.id === projectId ? state.project : await openFresh(projectId);
  if (p) await openProjectHandler(p, pageId);
}

/**
 * Проект из облака — на холст (SPEC_NIGHT5 §2.3, §2.4). keepView — обновление открытого проекта: та же страница и камера,
 * несохранённое состояние открытой версии отбрасывается (вызывающий проверил, что своих правок нет или они в копии).
 */
export async function showCloudProject(project: Project, opts: { keepView?: boolean } = {}): Promise<void> {
  homeProjects.delete(project.id);
  const meta = projectMeta(project);
  state.projects = [meta, ...state.projects.filter(m => m.id !== meta.id)];
  if (opts.keepView && project.id === state.project.id) {
    clearTimeout(saveTimer);
    state.dirty = false;
    const camera = { ...state.camera };
    openProject(project, realPageId());
    state.camera = camera;
    refresh();
    update();
  } else {
    await openProjectHandler(project);
  }
  document.dispatchEvent(new CustomEvent('doska:projects-changed'));
}

let replacingStarter = false;

/**
 * Стартовая заглушка уступает место облачному проекту (SPEC_NIGHT5 §2.1): открыт нетронутый автоматически созданный
 * проект, а на сервере у пользователя есть проекты — открывается самый свежий, заглушка удаляется только с устройства.
 */
export async function replaceStarterWithCloud(metas: ProjectMeta[]): Promise<void> {
  const sid = starterId();
  const cloud = cloudStorage();
  if (!sid || !cloud || replacingStarter || state.linkMode || state.collabRole !== null) return;
  if (state.project.id !== sid || !isPristineStarterProject(state.project, sid)) return;
  const latest = metas.filter(m => m.id !== sid).sort((a, b) => b.updatedAt - a.updatedAt)[0];
  if (!latest) return;
  replacingStarter = true;
  try {
    const p = await openFresh(latest.id);
    // пока проект грузился, пользователь мог начать рисовать — тогда заглушка уже его доска
    if (!p || starterId() !== sid || state.project.id !== sid || !isPristineStarterProject(state.project, sid)) return;
    clearTimeout(saveTimer);
    state.dirty = false;
    await openProjectHandler(p);
    await cloud.removeLocal(sid);
    clearStarter(sid);
    homeProjects.delete(sid);
    state.projects = [projectMeta(p), ...state.projects.filter(m => m.id !== sid && m.id !== p.id)];
    document.dispatchEvent(new CustomEvent('doska:projects-changed'));
  } finally {
    replacingStarter = false;
  }
}

/**
 * Можно ли сохранить офлайн-правки копией: копия — новый проект, и конфликт не должен создавать проекты в обход лимита
 * тарифа (тогда правки — черновиком при проекте, src/conflict-draft.ts).
 */
export function canCopyOnConflict(): boolean {
  return !limitsEnforced() || canCreateProject(userPlan(), state.projects.length);
}

/**
 * Офлайн-конфликт разрешён: открытая доска — серверная версия, тост с переходом к копии (SPEC_NIGHT5 §2.4)
 * или с действиями над черновиком.
 */
export function applyCloudConflict(r: ConflictResolution): void {
  homeProjects.delete(r.id);
  if (state.project.id === r.id && !state.linkMode && state.collabRole === null) void showCloudProject(r.project, { keepView: true });
  else document.dispatchEvent(new CustomEvent('doska:projects-changed'));
  const copyId = r.copy?.id;
  if (copyId) pushNotice({ title: CONFLICT_TEXT, level: 'warn', icon: 'offline', action: { label: 'Открыть копию', run: () => { void openFromHome(copyId); } } });
  else conflictDraftNotice(r.id, CONFLICT_DRAFT_TEXT);
}

/** Уведомление с действиями над черновиком офлайн-конфликта (после конфликта и по клику на индикатор в шапке). */
function conflictDraftNotice(id: string, title: string, quiet = false): void {
  pushNotice({
    title, body: 'Можно оставить свою версию вместо облачной или скачать её файлом', level: 'warn', icon: 'offline', quiet,
    action: { label: 'Оставить мою версию', run: () => { void restoreConflictDraft(id); } },
    actions: [
      { label: 'Скачать файлом', run: () => { void downloadConflictDraft(id); } },
      { label: 'Удалить', run: () => { discardConflictDraft(id); } },
    ],
  });
}

/** «Оставить мою версию»: черновик заменяет облачную версию проекта (тот же проект, без нового). */
async function restoreConflictDraft(id: string): Promise<void> {
  const cloud = cloudStorage();
  const draft = await cloud?.conflictDraft(id);
  if (!cloud || !draft) { showToast('Черновика уже нет'); return; }
  const open = state.project.id === id;
  if (open && (state.linkMode || state.collabRole !== null)) { showToast('Сначала завершите совместную работу'); return; }
  if (!confirm(`Заменить проект «${draft.name}» вашими офлайн-правками?\n\nПравки, сделанные на другом устройстве, пропадут.`)) return;
  const next: Project = { ...draft, updatedAt: Date.now() };
  if (open) await showCloudProject(next, { keepView: true });
  else {
    state.projects = [projectMeta(next), ...state.projects.filter(m => m.id !== id)];
    document.dispatchEvent(new CustomEvent('doska:projects-changed'));
  }
  await storage.save(next);
  cloud.discardConflictDraft(id);
  showToast('Оставлена ваша версия проекта');
}

/** «Скачать файлом»: черновик — файлом .json (его можно открыть как проект, когда лимит позволит). */
async function downloadConflictDraft(id: string): Promise<void> {
  const draft = await cloudStorage()?.conflictDraft(id);
  if (!draft) { showToast('Черновика уже нет'); return; }
  const url = URL.createObjectURL(new Blob([JSON.stringify(draft, null, 2)], { type: 'application/json' }));
  const a = document.createElement('a'); a.href = url; a.download = `${draft.name || 'Abax'} (офлайн-правки).json`; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function discardConflictDraft(id: string): void {
  const cloud = cloudStorage();
  if (!cloud || !confirm('Удалить офлайн-правки? Вернуть их не получится.')) return;
  cloud.discardConflictDraft(id);
}

/** «Новый проект»: окно «Создать проект» (название, страница, смайл), затем — сам проект. */
function newProjectHandler(): void {
  if (limitsEnforced() && !canCreateProject(userPlan(), state.projects.length)) { requestUpgrade('projects'); return; }
  openProjectDialog({
    namePlaceholder: defaultProjectName(state.projects.map(m => m.name)),
    pagePlaceholder: 'Страница 1',
    planNote: planNote(userPlan(), limitsEnforced()),
    onSubmit: v => { void createProjectHandler(v); },
  });
}

async function createProjectHandler(v: ProjectFormValues): Promise<void> {
  // пока окно было открыто, лимит мог исчерпаться (проект пришёл из облака)
  if (limitsEnforced() && !canCreateProject(userPlan(), state.projects.length)) { requestUpgrade('projects'); return; }
  await saveNow();
  saveCamera();
  rememberOpenProject();
  const blank = blankProject(v.name);
  const p: Project = { ...blank, pages: [{ ...blank.pages[0], name: v.page }], ownerPlan: userPlan() };
  if (v.icon) p.icon = v.icon;
  await storage.save(p);
  state.projects = [projectMeta(p), ...state.projects];
  openProject(p);
  refresh();
  fitContent();
}

async function deleteProjectHandler(id: string): Promise<void> {
  const meta = state.projects.find(m => m.id === id);
  if (!meta) return;
  // проектов больше, чем разрешено на free: удалённый заново не создать
  const overLimit = limitsEnforced() && isOverProjectLimit(userPlan(), state.projects.length);
  const msg = overLimit
    ? `Удалить проект «${meta.name}» со всеми страницами?\n\nУ вас больше проектов, чем разрешено на бесплатном тарифе (${PLAN_LIMITS.free.maxProjects}). Заново создать удалённый проект не получится, пока не оформлена подписка Pro. Оформите подписку, чтобы снять ограничение.`
    : `Удалить проект «${meta.name}» со всеми страницами?`;
  if (!confirm(msg)) return;
  await storage.remove(id);
  homeProjects.delete(id);
  carouselPos.delete(id);
  if (openedMap()[id]) { delete openedMap()[id]; saveOpened(); }
  state.projects = state.projects.filter(m => m.id !== id);
  if (state.project.id === id) {
    // удаляют из списка проектов — там и остаёмся
    const view = state.view;
    if (state.projects.length > 0) {
      const p = await storage.load(state.projects[0].id);
      if (p) { openProject(p, undefined, view); fitContent(); }
    } else {
      const p = blankProject('Проект 1');
      await storage.save(p);
      state.projects = [projectMeta(p)];
      openProject(p, undefined, view);
      fitContent();
    }
  }
  renderHome();
}

async function renameProjectHandler(id: string, name: string): Promise<void> {
  const meta = state.projects.find(m => m.id === id);
  if (!meta) return;
  meta.name = name;
  state.projects = [...state.projects];
  if (state.project.id === id) {
    state.project = { ...state.project, name };
    await storage.save(state.project);
  } else {
    await editClosedProject(id, p => ({ ...p, name }), false);
  }
  renderHome();
  renderPages();
}

/**
 * Шаг окна первого входа «Создайте свой первый проект!»: только пока открыт стартовый проект первого запуска
 * (вошли в аккаунт и он заменился облачным — шага нет). Новый проект не создаётся — стартовый переименовывается.
 */
export function firstProjectStep(): FirstProjectStep | null {
  const id = starterId();
  if (!id || state.project.id !== id || state.linkMode || state.collabRole !== null) return null;
  return {
    namePlaceholder: state.project.name,
    pagePlaceholder: state.project.pages[0]?.name ?? 'Страница 1',
    icon: state.project.icon ?? null,
    planNote: planNote(userPlan(), limitsEnforced()),
    apply: v => { void applyFirstProject(id, v); },
  };
}

async function applyFirstProject(id: string, v: ProjectFormValues): Promise<void> {
  // пока шло знакомство, стартовый проект мог смениться облачным
  if (state.project.id !== id) return;
  await saveNow();
  const first = state.project.pages[0];
  if (first && first.name !== v.page) renamePage(first.id, v.page);
  const next: Project = { ...state.project, name: v.name };
  if (v.icon) next.icon = v.icon;
  else delete next.icon;
  state.project = next;
  await storage.save(state.project);
  state.projects = state.projects.map(m => (m.id === id ? projectMeta(state.project) : m));
  renderPages();
  refresh();
}

/** Закрепить проект в избранном или открепить (дата изменения не трогается — это не правка содержимого). */
async function togglePinnedHandler(id: string): Promise<void> {
  const meta = state.projects.find(m => m.id === id);
  if (!meta) return;
  const pinned = meta.pinned ? undefined : true;
  if (state.project.id === id) {
    await saveNow();
    state.project = { ...state.project, pinned };
    await storage.save(state.project);
    state.projects = state.projects.map(m => (m.id === id ? projectMeta(state.project) : m));
  } else {
    await editClosedProject(id, p => ({ ...p, pinned }), false);
  }
  renderHome();
}

async function homeAddPage(projectId: string): Promise<void> {
  const target = state.project.id === projectId ? state.project : homeProject(state.projects.find(m => m.id === projectId) ?? { id: '', updatedAt: 0 } as ProjectMeta);
  if (target && !canAddPageTo(target)) { showToast(PAGE_LIMIT_TEXT); return; }
  if (state.project.id === projectId) {
    await saveNow();
    addPage();
    await saveNow();
  } else {
    await editClosedProject(projectId, p => ({ ...p, pages: [...p.pages, blankPage(`Страница ${p.pages.length + 1}`)] }));
  }
  renderHome();
}

async function homeDeletePage(projectId: string, pageId: string): Promise<void> {
  if (state.project.id === projectId) {
    const page = state.project.pages.find(p => p.id === pageId);
    if (!page || !confirm(`Удалить страницу «${page.name}»?`)) return;
    await saveNow();
    deletePage(pageId);
    await saveNow();
    renderHome();
    return;
  }
  const meta = state.projects.find(m => m.id === projectId);
  const page = meta && homeProject(meta)?.pages.find(p => p.id === pageId);
  if (!page || !confirm(`Удалить страницу «${page.name}»?`)) return;
  await editClosedProject(projectId, p => {
    const pages = p.pages.filter(pg => pg.id !== pageId);
    return { ...p, pages: pages.length > 0 ? pages : [blankPage('Страница 1')] };
  });
  renderHome();
}

async function homeRenamePage(projectId: string, pageId: string, name: string): Promise<void> {
  if (state.project.id === projectId) {
    renamePage(pageId, name);
    await saveNow();
  } else {
    await editClosedProject(projectId, p => ({ ...p, pages: p.pages.map(pg => (pg.id === pageId ? { ...pg, name } : pg)) }));
  }
  renderHome();
}

/** Иконка проекта (null — убрать); дата изменения не трогается — это не правка содержимого. */
async function setProjectIconHandler(id: string, icon: string | null): Promise<void> {
  const withIcon = (p: Project): Project => {
    const next = { ...p };
    if (icon) next.icon = icon;
    else delete next.icon;
    return next;
  };
  if (state.project.id === id) {
    await saveNow();
    state.project = withIcon(state.project);
    await storage.save(state.project);
    state.projects = state.projects.map(m => (m.id === id ? projectMeta(state.project) : m));
  } else {
    await editClosedProject(id, withIcon, false);
  }
  renderHome();
  renderPages();
}

/** Поля названий страницы и проекта в шапке (создаются при запуске). */
let topPageName: TopName | null = null;
let topProjectName: TopName | null = null;

/** Кнопка иконки открытого проекта в шапке (из index.html; создаётся при запуске). */
let topProjectIcon: IconButton | null = null;

/** Кнопка-иконка проекта на домашней: клик — окно выбора иконки, как в Miro (src/icon-button.ts). */
function projectIconButton(meta: ProjectMeta, variant: 'badge' | 'row'): HTMLButtonElement {
  return createIconButton({
    className: `project-icon ${variant}`,
    value: meta.icon ?? null,
    title: v => (v ? 'Сменить иконку' : 'Добавить иконку'),
    stopPropagation: true,
    onPick: icon => { void setProjectIconHandler(meta.id, icon); },
  }).el;
}

// ----- Последнее открытие: на этом устройстве, по проектам -----

const OPENED_KEY = 'doska.opened';
/** Когда проект открывали в последний раз и на какой странице. */
type OpenedMap = Record<string, { at: number; page: string }>;
let opened: OpenedMap | null = null;
/** Проект и страница, уже записанные в «последнее открытие» (сбрасывается на домашней). */
let openedKey = '';

function openedMap(): OpenedMap {
  if (opened) return opened;
  try {
    const v: unknown = JSON.parse(localStorage.getItem(OPENED_KEY) || '{}');
    opened = v && typeof v === 'object' ? v as OpenedMap : {};
  } catch {
    opened = {};
  }
  return opened;
}

function saveOpened(): void {
  try { localStorage.setItem(OPENED_KEY, JSON.stringify(openedMap())); } catch { /* хранилище недоступно — без истории */ }
}

/**
 * Открытый на доске проект и страница — в «последнее открытие» (при входе в проект и смене страницы)
 * и в doska.last: с них приложение и запустится, даже если на доске ничего не меняли.
 */
function noteOpened(): void {
  // у гостя совместной работы проект чужой — не его история
  if (state.view !== 'board' || (collabActive() && !isHost())) { openedKey = ''; return; }
  const key = `${state.project.id}:${realPageId()}`;
  if (key === openedKey) return;
  openedKey = key;
  openedMap()[state.project.id] = { at: Date.now(), page: realPageId() };
  saveOpened();
  try {
    if (!state.linkMode) localStorage.setItem('doska.last', JSON.stringify({ pid: state.project.id, pageId: realPageId() }));
  } catch { /* хранилище недоступно — запустимся с последнего сохранённого */ }
}

// ----- Домашняя страница: вид сеткой и списком -----

const HOME_VIEW_KEY = 'doska.homeView';
type HomeView = 'grid' | 'list';

function homeView(): HomeView {
  try { return localStorage.getItem(HOME_VIEW_KEY) === 'list' ? 'list' : 'grid'; } catch { return 'grid'; }
}

function setHomeView(v: HomeView): void {
  try { localStorage.setItem(HOME_VIEW_KEY, v); } catch { /* вид не запомнится */ }
  renderHome();
}

function homeKey(): string {
  return state.projects.map(m => `${m.id}:${m.name}:${m.updatedAt}:${m.pageCount}:${m.pinned ? 1 : 0}:${m.icon ?? ''}`).join('#')
    + `@${state.project.id}@${homeView()}`;
}

/** Холст превью страницы: перерисовывается, только если содержимое или фон поменялись. */
function homeThumb(page: Page): HTMLCanvasElement {
  let entry = homeThumbs.get(page.id);
  if (!entry) {
    entry = { cv: document.createElement('canvas'), shot: null };
    homeThumbs.set(page.id, entry);
  }
  const t = entry;
  if (!t.shot || t.shot.elements !== page.elements || t.shot.grid !== page.grid) {
    const shot = { elements: page.elements, grid: page.grid };
    t.shot = shot;
    renderPageThumb(page, t.cv);
    // картинки неоткрытого проекта ещё грузятся — дорисуем, когда загрузятся
    void imagesLoaded(page.elements)?.then(() => { if (t.shot === shot) renderPageThumb(page, t.cv); });
  }
  return t.cv;
}

function renderHome(): void {
  const home = document.getElementById('home')!;
  const scroll = home.scrollTop;
  home.textContent = '';
  const view = homeView();
  home.dataset.view = view;
  const head = document.createElement('div');
  head.className = 'home-head';
  const logo = document.createElement('button');
  logo.className = 'home-logo';
  logo.type = 'button';
  logo.title = 'Вернуться к доске';
  logo.setAttribute('aria-label', 'Вернуться к доске');
  logo.innerHTML = `<span class="home-logo-image"><img src="logo.svg" alt="" /></span><span class="home-logo-back" aria-hidden="true">${ICONS.homeBack}</span>`;
  logo.addEventListener('click', () => setView('board'));
  const h = document.createElement('h1');
  h.textContent = 'Проекты';
  const tools = document.createElement('div');
  tools.className = 'home-tools';
  const views = document.createElement('div');
  views.className = 'home-views';
  views.setAttribute('role', 'group');
  views.setAttribute('aria-label', 'Вид');
  for (const [v, icon, title] of [['grid', ICONS.grid, 'Сеткой'], ['list', ICONS.list, 'Списком']] as const) {
    const b = document.createElement('button');
    b.className = 'home-view';
    b.dataset.view = v;
    b.title = title;
    b.innerHTML = icon;
    b.setAttribute('aria-pressed', String(v === view));
    b.addEventListener('click', () => setHomeView(v));
    views.appendChild(b);
  }
  const newBtn = document.createElement('button');
  newBtn.className = 'new-project';
  newBtn.innerHTML = ICONS.plus;
  newBtn.append('Новый проект');
  // четвёртый проект на бесплатном тарифе — бейдж Pro
  newBtn.appendChild(proBadge('projects', { className: 'new-project-pro', needed: state.projects.length >= PLAN_LIMITS.free.maxProjects }));
  newBtn.addEventListener('click', () => { newProjectHandler(); });
  tools.append(views, newBtn, profileButton());
  head.append(logo, h, tools);
  home.appendChild(head);
  // приглашения по почте (SPEC_NIGHT5 §7): карточки над проектами; список обновляется не чаще раза в 30 с
  const invitesBlock = incomingInvitesSection();
  if (invitesBlock) home.appendChild(invitesBlock);
  void refreshIncomingInvites();
  const pinned = state.projects.filter(m => m.pinned);
  const rest = state.projects.filter(m => !m.pinned);
  const seen = new Set<string>();
  if (pinned.length > 0) home.appendChild(homeSection('Избранное', pinned, view, seen));
  if (rest.length > 0 || pinned.length === 0) home.appendChild(homeSection(pinned.length > 0 ? 'Остальные проекты' : '', rest, view, seen));
  for (const id of homeThumbs.keys()) if (!seen.has(id)) homeThumbs.delete(id);
  home.scrollTop = scroll;
  loadHomeProjects();
}

/** Раздел домашней: заголовок (если есть) и проекты — карточками или строками списка. */
function homeSection(title: string, metas: ProjectMeta[], view: HomeView, seen: Set<string>): HTMLElement {
  const section = document.createElement('section');
  section.className = 'home-section';
  if (title) {
    const h = document.createElement('h2');
    h.className = 'home-section-title';
    h.textContent = title;
    section.appendChild(h);
  }
  if (view === 'grid') {
    const grid = document.createElement('div');
    grid.className = 'home-grid';
    for (const meta of metas) grid.appendChild(projectCard(meta, seen));
    section.appendChild(grid);
    return section;
  }
  const list = document.createElement('div');
  list.className = 'home-list';
  const head = document.createElement('div');
  head.className = 'home-list-head';
  for (const text of ['', 'Название', 'Страниц', 'Открыт', '']) {
    const c = document.createElement('span');
    c.textContent = text;
    head.appendChild(c);
  }
  list.appendChild(head);
  for (const meta of metas) list.appendChild(projectRow(meta));
  section.appendChild(list);
  return section;
}

/** Звёздочка «в избранное» и корзина — у карточки и у строки списка. */
function projectActions(meta: ProjectMeta): HTMLButtonElement[] {
  const pin = document.createElement('button');
  pin.className = 'project-pin';
  pin.title = meta.pinned ? 'Убрать из избранного' : 'Закрепить в избранном';
  pin.setAttribute('aria-pressed', String(!!meta.pinned));
  pin.innerHTML = ICONS.star;
  pin.addEventListener('click', e => { e.stopPropagation(); void togglePinnedHandler(meta.id); });
  const del = document.createElement('button');
  del.className = 'project-del';
  del.title = 'Удалить проект';
  del.innerHTML = ICONS.trash;
  del.addEventListener('click', e => { e.stopPropagation(); void deleteProjectHandler(meta.id); });
  return [pin, del];
}

/**
 * Клик по карточке или строке открывает проект на странице page(); по названию — с задержкой:
 * это может быть начало двойного клика (переименование).
 */
function wireProjectOpen(host: HTMLElement, meta: ProjectMeta, page: () => string | undefined): void {
  let timer = 0;
  host.addEventListener('click', e => {
    const t = e.target as HTMLElement;
    if (t.closest('button, input, .carousel-page')) return;
    clearTimeout(timer);
    const delay = t.closest('.project-name') ? 300 : 0;
    timer = window.setTimeout(() => { void openFromHome(meta.id, page()); }, delay);
  });
  host.querySelector('.project-name')!.addEventListener('dblclick', e => {
    e.stopPropagation();
    clearTimeout(timer);
    startProjectRename(host, meta.id, meta.name);
  });
}

/** Карточка сетки, как в Miro: карусель страниц с иконкой проекта, под ней — название и сведения. */
function projectCard(meta: ProjectMeta, seen: Set<string>): HTMLElement {
  const card = document.createElement('div');
  card.className = 'project-card';
  card.classList.toggle('pinned', !!meta.pinned);
  card.classList.toggle('current', state.project.id === meta.id);
  const preview = document.createElement('div');
  preview.className = 'project-preview';
  const project = homeProject(meta);
  if (project) {
    buildCarousel(preview, project, seen);
  } else {
    const empty = document.createElement('div');
    empty.className = 'project-preview-empty';
    // пока проект грузится — пустое превью; не прочитался — так и пишем
    if (homeProjectFailed(meta)) empty.textContent = 'Не удалось загрузить страницы';
    preview.appendChild(empty);
  }
  preview.appendChild(projectIconButton(meta, 'badge'));
  const title = document.createElement('div');
  title.className = 'project-title';
  const name = document.createElement('span');
  name.className = 'project-name';
  name.textContent = meta.name;
  name.title = 'Двойной клик - переименовать';
  title.append(name, ...projectActions(meta));
  const info = document.createElement('div');
  info.className = 'project-info';
  info.textContent = `${pagesLabel(meta.pageCount)} · изменён ${dayLabel(meta.updatedAt)}`;
  card.append(preview, title, info);
  wireProjectOpen(card, meta, () => project?.pages[carouselPos.get(meta.id) ?? 0]?.id);
  return card;
}

/** Строка списка: иконка, название и дата изменения, число страниц, последнее открытие, действия. */
function projectRow(meta: ProjectMeta): HTMLElement {
  const row = document.createElement('div');
  row.className = 'project-card project-row';
  row.classList.toggle('pinned', !!meta.pinned);
  row.classList.toggle('current', state.project.id === meta.id);
  const main = document.createElement('div');
  main.className = 'project-main';
  const name = document.createElement('span');
  name.className = 'project-name';
  name.textContent = meta.name;
  name.title = 'Двойной клик - переименовать';
  const info = document.createElement('span');
  info.className = 'project-info';
  info.textContent = `Изменён ${dayLabel(meta.updatedAt)}`;
  main.append(name, info);
  const pages = document.createElement('span');
  pages.className = 'project-cell project-pages';
  pages.textContent = String(meta.pageCount);
  const last = openedMap()[meta.id];
  const openedCell = document.createElement('span');
  openedCell.className = 'project-cell project-opened';
  openedCell.textContent = last ? capitalize(dayLabel(last.at)) : '-';
  const actions = document.createElement('div');
  actions.className = 'project-actions';
  actions.append(...projectActions(meta));
  row.append(projectIconButton(meta, 'row'), main, pages, openedCell, actions);
  wireProjectOpen(row, meta, () => openedMap()[meta.id]?.page);
  return row;
}

/** Позиция карусели по проектам: пока открыта домашняя; при входе на неё — с последней открытой страницы. */
const carouselPos = new Map<string, number>();

/** С какой страницы начинать карусель: последняя открытая на этом устройстве, у открытого проекта — текущая. */
function carouselStart(project: Project): number {
  const page = openedMap()[project.id]?.page ?? (state.project.id === project.id ? state.pageId : undefined);
  return Math.max(0, project.pages.findIndex(p => p.id === page));
}

/**
 * Карусель страниц в превью карточки: стрелки и точки (листается и пальцем), номер и название страницы
 * (двойной клик — переименовать), добавить и удалить страницу. Клик по превью открывает показанную страницу.
 */
function buildCarousel(preview: HTMLElement, project: Project, seen: Set<string>): void {
  const pages = project.pages;
  for (const pg of pages) seen.add(pg.id);
  const last = pages.length - 1;
  const track = document.createElement('div');
  track.className = 'carousel-track';
  const slides = pages.map(pg => {
    const slide = document.createElement('div');
    slide.className = 'carousel-slide';
    slide.dataset.page = pg.id;
    track.appendChild(slide);
    return slide;
  });
  const label = document.createElement('div');
  label.className = 'carousel-page';
  label.title = 'Двойной клик - переименовать страницу';
  const num = document.createElement('span');
  num.className = 'page-num';
  const pageName = document.createElement('span');
  pageName.className = 'carousel-name';
  label.append(num, pageName);
  const arrow = (cls: string, icon: string, title: string, step: number): HTMLButtonElement => {
    const b = document.createElement('button');
    b.className = cls;
    b.title = title;
    b.innerHTML = icon;
    b.addEventListener('click', () => go(i + step));
    return b;
  };
  const prev = arrow('carousel-prev', ICONS.chevronLeft, 'Предыдущая страница', -1);
  const next = arrow('carousel-next', ICONS.chevron, 'Следующая страница', 1);
  const dots = document.createElement('div');
  dots.className = 'carousel-dots';
  dots.hidden = pages.length < 2;
  const dotEls = pages.map((pg, k) => {
    const d = document.createElement('button');
    d.className = 'carousel-dot';
    d.title = pg.name;
    d.addEventListener('click', () => go(k));
    dots.appendChild(d);
    return d;
  });
  const tools = document.createElement('div');
  tools.className = 'carousel-tools';
  const add = document.createElement('button');
  add.className = 'carousel-add';
  add.title = 'Новая страница';
  add.innerHTML = ICONS.plus;
  add.addEventListener('click', () => {
    // карусель встанет на новую страницу
    carouselPos.set(project.id, pages.length);
    void homeAddPage(project.id);
  });
  const del = document.createElement('button');
  del.className = 'carousel-del';
  del.title = 'Удалить страницу';
  del.innerHTML = ICONS.del;
  del.addEventListener('click', () => { void homeDeletePage(project.id, pages[i].id); });
  tools.append(add, del);
  preview.append(track, label, prev, next, dots, tools);

  let i = Math.min(last, carouselPos.get(project.id) ?? carouselStart(project));
  const show = () => {
    carouselPos.set(project.id, i);
    track.style.transform = `translateX(${-i * 100}%)`;
    // холсты превью — только у показанной страницы и соседних: проект может быть большим
    for (let k = Math.max(0, i - 1); k <= Math.min(last, i + 1); k++) {
      if (!slides[k].firstChild) slides[k].appendChild(homeThumb(pages[k]));
    }
    num.textContent = String(i + 1);
    pageName.textContent = pages[i].name;
    prev.hidden = i === 0;
    next.hidden = i === last;
    dotEls.forEach((d, k) => d.classList.toggle('active', k === i));
  };
  const go = (k: number) => {
    i = Math.max(0, Math.min(last, k));
    track.classList.add('animate');
    show();
  };
  show();

  // пальцем: смахнуть влево или вправо; смахивание — не клик
  let swipe: { x: number; y: number } | null = null;
  let swiped = false;
  preview.addEventListener('pointerdown', e => { swipe = { x: e.clientX, y: e.clientY }; swiped = false; });
  preview.addEventListener('pointerup', e => {
    if (!swipe) return;
    const dx = e.clientX - swipe.x, dy = e.clientY - swipe.y;
    swipe = null;
    if (Math.abs(dx) > 40 && Math.abs(dx) > Math.abs(dy) * 1.5) {
      swiped = true;
      go(i + (dx < 0 ? 1 : -1));
    }
  });
  preview.addEventListener('click', e => {
    // кнопки карусели — не открытие страницы
    if (swiped || (e.target as HTMLElement).closest('.carousel-prev, .carousel-next, .carousel-dots, .carousel-tools')) {
      e.stopPropagation();
      swiped = false;
    }
  });
  label.addEventListener('dblclick', e => {
    e.stopPropagation();
    startCarouselRename(pageName, project.id, pages[i].id, pages[i].name);
  });
}

function startProjectRename(card: HTMLElement, projectId: string, oldName: string): void {
  const nameEl = card.querySelector('.project-name')!;
  const input = document.createElement('input');
  input.className = 'project-rename';
  input.value = oldName;
  input.maxLength = PROJECT_NAME_MAX;
  input.spellcheck = false;
  nameEl.replaceWith(input);
  input.focus();
  input.select();
  let done = false;
  const commit = () => {
    if (done) return;
    done = true;
    const v = input.value.trim();
    if (v && v !== oldName) void renameProjectHandler(projectId, v);
    else renderHome();
  };
  input.addEventListener('blur', commit);
  input.addEventListener('keydown', e => {
    e.stopPropagation();
    if (e.key === 'Enter') commit();
    if (e.key === 'Escape') { done = true; renderHome(); }
  });
}

function startCarouselRename(nameEl: HTMLElement, projectId: string, pageId: string, oldName: string): void {
  const input = document.createElement('input');
  input.value = oldName;
  input.maxLength = PAGE_NAME_MAX;
  input.spellcheck = false;
  nameEl.replaceWith(input);
  input.focus();
  input.select();
  let done = false;
  const commit = () => {
    if (done) return;
    done = true;
    const v = input.value.trim();
    if (v && v !== oldName) void homeRenamePage(projectId, pageId, v);
    else renderHome();
  };
  input.addEventListener('blur', commit);
  input.addEventListener('keydown', e => {
    e.stopPropagation();
    if (e.key === 'Enter') commit();
    if (e.key === 'Escape') { done = true; renderHome(); }
  });
}

// ----- Перетаскивание инструмента с панели на холст -----

/** Указатель над холстом и можно менять доску — только туда бросают инструмент. */
function overCanvas(e: PointerEvent): boolean {
  if (state.view !== 'board' || !canEditBoard()) return false;
  return document.elementFromPoint(e.clientX, e.clientY) === canvas;
}

interface ToolDrop {
  tool: ToolId;
  pointerId: number;
  x0: number;
  y0: number;
  ghost: HTMLElement | null;
  onStart?: () => void;
}

let toolDrop: ToolDrop | null = null;
/** После броска клик по кнопке инструмента уже не нужен: он выбрал бы инструмент вместо создания. */
let dropClickGuard = 0;

function blockDropClick(): void { dropClickGuard = performance.now() + 300; }
function dropClickBlocked(): boolean { return performance.now() < dropClickGuard; }

function toolGhost(tool: ToolId): HTMLElement {
  const ghost = document.createElement('div');
  ghost.className = 'tool-ghost drag-ghost';
  ghost.innerHTML = toolDef(tool).icon;
  document.body.appendChild(ghost);
  return ghost;
}

function moveToolGhost(ghost: HTMLElement, e: PointerEvent): void {
  ghost.style.left = `${e.clientX}px`;
  ghost.style.top = `${e.clientY}px`;
}

/**
 * Возможное перетаскивание инструмента: объект «срывается» с кнопки, только когда указатель
 * ушёл на холст (жест выбора из группы этим не ломается). activate — указатель уже на холсте.
 */
function startToolDrop(tool: ToolId, e: PointerEvent, onStart?: () => void, activate = false): void {
  if (toolDrop || !canDropTool(tool)) return;
  const d: ToolDrop = { tool, pointerId: e.pointerId, x0: e.clientX, y0: e.clientY, ghost: null, onStart };
  toolDrop = d;
  const begin = (ev: PointerEvent) => {
    d.ghost = toolGhost(d.tool);
    document.body.classList.add('tool-dragging');
    moveToolGhost(d.ghost, ev);
    d.onStart?.();
  };
  if (activate && overCanvas(e)) begin(e);
  const move = (ev: PointerEvent) => {
    if (ev.pointerId !== d.pointerId || toolDrop !== d) return;
    if (!d.ghost) {
      if (Math.hypot(ev.clientX - d.x0, ev.clientY - d.y0) < 6 || !overCanvas(ev)) return;
      begin(ev);
    }
    moveToolGhost(d.ghost!, ev);
  };
  const finish = (ev: PointerEvent) => {
    if (ev.pointerId !== d.pointerId) return;
    window.removeEventListener('pointermove', move);
    window.removeEventListener('pointerup', finish);
    window.removeEventListener('pointercancel', finish);
    if (toolDrop === d) toolDrop = null;
    if (!d.ghost) return;
    d.ghost.remove();
    document.body.classList.remove('tool-dragging');
    if (ev.type === 'pointerup' && overCanvas(ev)) {
      dropToolOnCanvas(d.tool, ev.clientX, ev.clientY);
      blockDropClick();
    }
  };
  window.addEventListener('pointermove', move);
  window.addEventListener('pointerup', finish);
  window.addEventListener('pointercancel', finish);
}

/** Создаёт объект в точке экрана; он сразу выделен, а стикер — открыт для ввода. */
function dropToolOnCanvas(tool: ToolId, x: number, y: number): void {
  if (state.view !== 'board' || !canEditBoard()) return;
  const r = canvas.getBoundingClientRect();
  const cam = state.camera;
  const el = toolDropElement(
    tool, uid(),
    { x: (x - r.left) / cam.zoom + cam.x, y: (y - r.top) / cam.zoom + cam.y },
    cam.zoom,
    { color: state.style.color, width: state.style.width, opacity: state.style.opacity },
    state.noteColor,
  );
  if (!el) return;
  addElement(el);
  selectInserted(el.id);
  if (el.type === 'note') {
    // фон стикера рисуем поверх скрытого холстом элемента, пока идёт ввод
    state.liveNote = { x: el.x, y: el.y, w: el.w, h: el.h, color: el.color };
    beginTextEdit({ el });
  }
}

// ----- Тулбар -----

function buildToolbar(): void {
  const tb = document.getElementById('toolbar')!;
  tb.textContent = '';
  const tools = document.createElement('div');
  tools.className = 'tool-group';
  // порядок, группы и скрытые — из настройки панели (окно «Все настройки»)
  for (const item of toolbarConfig().items) {
    const b = document.createElement('button');
    b.className = 'tool';
    if (item.type === 'group') {
      if (item.tools.length === 0) continue;
      // Клик выбирает показанный инструмент и открывает панель группы.
      const groupId = item.id;
      b.id = `btn-${groupId}`;
      b.dataset.ctx = groupId;
      b.dataset.tools = item.tools.join(' ');
      b.classList.add('tool-shapes');
      b.title = item.name;
      const selectShownTool = () => {
        const group = toolbarGroup(groupId);
        if (!group) return;
        const last = lastGroupTool[groupId];
        pickTool(group.tools.includes(last) ? last : group.tools[0]);
      };
      let suppressClick = false;
      b.addEventListener('pointerdown', e => {
        if (!e.isPrimary || e.button !== 0) return;
        suppressClick = false;
        const existing = panelOf(groupId);
        // Откреплённая палитра сохраняет обычное поведение кнопки.
        if (existing?.detached) {
          const shape = b.dataset.shape as ToolId | undefined;
          if (e.button === 0 && e.isPrimary && shape) startToolDrop(shape, e);
          return;
        }
        if (!existing) openCtxPanel(groupId, 'toolbar');
        const panel = panelOf(groupId);
        if (!panel) return;
        const startX = e.clientX, startY = e.clientY;
        let moved = false;
        let hovered: HTMLButtonElement | null = null;
        const hitTool = (event: PointerEvent): HTMLButtonElement | null => {
          const target = document.elementFromPoint(event.clientX, event.clientY)?.closest<HTMLButtonElement>('.ctx-shapes [data-shape]');
          return target && panel.el.contains(target) ? target : null;
        };
        const highlight = (next: HTMLButtonElement | null) => {
          if (next === hovered) return;
          hovered?.classList.remove('gesture-hover');
          hovered = next;
          hideHeldTooltip();
          if (!next) return;
          next.classList.add('gesture-hover');
          const pos = toolbarSide();
          showHeldTooltip(next, panel.el, pos === 'right' ? 'left' : pos === 'top' ? 'bottom' : pos === 'bottom' ? 'top' : 'right');
          navigator.vibrate?.(10);
        };
        try { b.setPointerCapture(e.pointerId); } catch { /* синтетический pointer */ }
        const move = (event: PointerEvent) => {
          if (event.pointerId !== e.pointerId) return;
          if (Math.hypot(event.clientX - startX, event.clientY - startY) > 5) moved = true;
          // потянули за кнопку группы на холст — это уже не выбор инструмента, а перенос объекта
          const shape = b.dataset.shape as ToolId | undefined;
          if (moved && shape) startToolDrop(shape, event, () => closePanel(panel), true);
          highlight(hitTool(event));
        };
        const finish = (event: PointerEvent) => {
          if (event.pointerId !== e.pointerId) return;
          window.removeEventListener('pointermove', move);
          window.removeEventListener('pointerup', finish);
          window.removeEventListener('pointercancel', finish);
          // без движения отпускание — это клик по кнопке группы: вытягивающаяся из неё панель ещё может оказаться под курсором, и её кнопка не должна выбираться
          const id = (moved ? hitTool(event) : null)?.dataset.shape as ToolId | undefined;
          highlight(null);
          if (event.type === 'pointerup' && id) {
            suppressClick = true;
            closePanel(panel);
            pickTool(id);
          } else if (moved || event.type === 'pointercancel') {
            suppressClick = true;
            closePanel(panel);
          } else if (!existing) {
            // Первый короткий клик оставляет только что открытую группу открытой.
            suppressClick = true;
            selectShownTool();
          }
        };
        window.addEventListener('pointermove', move);
        window.addEventListener('pointerup', finish);
        window.addEventListener('pointercancel', finish);
      });
      b.addEventListener('click', () => {
        if (suppressClick) { suppressClick = false; return; }
        if (dropClickBlocked()) return;
        toggleCtxPanel(groupId, 'toolbar');
        selectShownTool();
      });
      // двойной щелчок — «залипающий» режим массового добавления (индикатор «+» на кнопке); снимается выбором другого инструмента
      b.addEventListener('dblclick', () => {
        selectShownTool();
        if (state.tool === 'select' || state.tool === 'pan') return;
        setStickyTool(state.tool);
        update();
      });
    } else {
      const id = item.id;
      b.dataset.tool = id;
      b.title = toolTip(id);
      b.innerHTML = toolDef(id).icon;
      // панель стикеров открывается с этим инструментом и встаёт по центру его кнопки
      if (id === 'note') b.dataset.ctx = 'note';
      if (canDropTool(id)) {
        b.classList.add('tool-drop');
        b.addEventListener('pointerdown', e => {
          if (e.button === 0 && e.isPrimary) startToolDrop(id, e);
        });
      }
      b.addEventListener('click', () => {
        if (dropClickBlocked()) return;
        pickTool(id);
      });
    }
    tools.appendChild(b);
  }
  if (tools.childElementCount > 0) {
    tb.appendChild(tools);
    const sep = makeVsep();
    sep.classList.add('style-sep');
    tb.appendChild(sep);
  }

  // пресеты «цвет + толщина»: у пера и маркера три, у прочих инструментов один (лишние скрыты)
  const styleGroup = document.createElement('div');
  styleGroup.className = 'tool-group style-group';
  for (let i = 0; i < PRESET_SLOTS; i++) {
    const sBtn = document.createElement('button');
    sBtn.className = 'tool style-btn';
    sBtn.dataset.preset = String(i);
    sBtn.appendChild(styleIndicator(true));
    sBtn.addEventListener('click', () => {
      // клик по текущему пресету — панель цвета и толщины, по другому — выбор этого пресета
      if (state.presets[presetKind(state.tool)].active === i) toggleStylePanel('toolbar');
      else selectPreset(i);
    });
    styleGroup.appendChild(sBtn);
  }
  tb.appendChild(styleGroup);
  tb.appendChild(toolbarGrip(tb));
  // набор кнопок изменился — откреплённая панель могла перестать помещаться
  if (state.settings.toolbarFloat) placeToolbar(tb);
}

const PRESET_SLOTS = 3;
/** Пресет, к которому сейчас относится панель стиля с тулбара: смена — панель пересобирается. */
let shownPresetKey = '';

/** Кнопки пресетов: видимость, подсветка текущего, якорь панели стиля (data-ctx) — у текущего. */
function syncPresetButtons(tb: HTMLElement): void {
  // инструментам без цвета (выделение, ластики, стикер…) пресеты не нужны — прячем вместе с разделителем
  const withStyle = toolUsesColor(state.tool);
  for (const e of tb.querySelectorAll<HTMLElement>('.style-group, .style-sep')) e.hidden = !withStyle;
  const kind = presetKind(state.tool);
  const set = state.presets[kind];
  const multi = set.list.length > 1;
  const title = kind === 'pen' ? 'Перо' : kind === 'highlighter' ? 'Маркер' : kind === 'laser' ? 'Указка' : '';
  for (const b of tb.querySelectorAll<HTMLButtonElement>('.style-btn[data-preset]')) {
    const i = Number(b.dataset.preset);
    const preset = set.list[i];
    b.hidden = !preset;
    if (!preset) { delete b.dataset.ctx; b.removeAttribute('id'); continue; }
    const current = i === set.active;
    b.classList.toggle('current', multi && current);
    if (current) { b.dataset.ctx = 'style'; b.id = 'btn-style'; }
    else { delete b.dataset.ctx; b.removeAttribute('id'); }
    b.title = multi ? `${title}: пресет ${i + 1}${current ? ' - цвет и толщина' : ''}` : 'Цвет и толщина';
    // текущий показывает живой стиль (в т.ч. подхваченный из выделения)
    paintStyleIndicator(b.querySelector<HTMLElement>('.style-ind')!, kind !== 'laser', current ? state.style : preset);
  }
  syncCtxButtons();
  const sp = panelOf('style');
  // кнопки пресетов спрятаны — пристыкованной к ним панели стоять не у чего
  if (!withStyle && sp?.source === 'toolbar' && !sp.detached) closePanel(sp);
  const key = `${kind}:${set.active}`;
  if (key === shownPresetKey) return;
  shownPresetKey = key;
  // панель стиля с тулбара переезжает к новому пресету и показывает его цвет и толщину
  if (sp && sp.source === 'toolbar') {
    if (sp.detached) rebuildPanel(sp);
    else if (withStyle) openCtxPanel('style', 'toolbar');
  }
}

function makeVsep(): HTMLElement {
  const s = document.createElement('div');
  s.className = 'vsep';
  return s;
}

function wireTopbar(): void {
  // подсказки шапки из index.html: на macOS — Cmd вместо Ctrl
  for (const b of document.querySelectorAll<HTMLElement>('#topbar [title], #bottombar [title]')) b.title = macKeys(b.title);
  document.getElementById('btn-undo')!.innerHTML = ICONS.undo;
  document.getElementById('btn-redo')!.innerHTML = ICONS.redo;
  document.getElementById('btn-fit')!.innerHTML = ICONS.fit;
  document.getElementById('btn-export')!.innerHTML = ICONS.export;
  document.getElementById('btn-present')!.innerHTML = ICONS.present;
  document.getElementById('btn-import')!.innerHTML = ICONS.pdf;
  document.getElementById('btn-image')!.innerHTML = ICONS.image;
  document.getElementById('btn-settings')!.innerHTML = ICONS.settings;
  // иконка «Поделиться» — когда шапке не хватает места (см. topbar-fit.ts)
  document.querySelector<HTMLElement>('#btn-share .share-icon')!.innerHTML = ICONS.share;
  document.getElementById('btn-share')!.addEventListener('click', () => { void openShareDialog(); });
  initNotifyButton();
  initNotifyStack();
  topProjectIcon = createIconButton({
    el: document.getElementById('project-icon') as HTMLButtonElement,
    value: state.project.icon ?? null,
    title: v => (v ? 'Сменить иконку проекта' : 'Добавить иконку проекта'),
    enabled: () => !state.linkMode,
    onPick: icon => { void setProjectIconHandler(state.project.id, icon); },
  });
  // guest-режим: скрываем недоступные функции
  if (collabActive() && !isHost()) {
    for (const id of ['btn-home', 'btn-share']) {
      document.getElementById(id)!.style.display = 'none';
    }
    // группа импорта скрывается целиком: иначе в шапке остаётся пустой контейнер с отступами
    document.querySelector<HTMLElement>('.import-group')!.style.display = 'none';
    // иконку проекта меняет только автор
    topProjectIcon.el.disabled = true;
  }
  // сервер совместной работы живёт в main-процессе Electron: в браузере и на Android раздавать нечем
  if (!doskaApi && isNativeApp()) document.getElementById('btn-share')!.style.display = 'none';
  document.body.classList.toggle('web-build', !doskaApi);
  // окно демонстрации — второе окно браузера, в приложении для Android его не открыть
  if (isNativeApp()) document.getElementById('btn-present')!.style.display = 'none';

  // меню экспорта создаётся ниже; до этого закрывать нечего
  let closeExportMenu = (): void => {};
  const menuButton = document.getElementById('btn-home') as HTMLButtonElement;
  menuButton.title = 'Меню';
  menuButton.setAttribute('aria-label', 'Меню');
  menuButton.setAttribute('aria-expanded', 'false');
  menuButton.innerHTML = `<span class="logo-mark"><img src="logo.svg" alt="Abax" /></span><span class="logo-menu-mark" aria-hidden="true">${ICONS.menu}</span>`;
  const menu = document.createElement('div');
  menu.id = 'main-menu';
  menu.className = 'popup-menu menu-list';
  menu.hidden = true;
  const menuIcon = (icon = '') => `<span class="main-menu-icon" aria-hidden="true">${icon}</span>`;
  const menuItem = (action: string, label: string, icon = '', extra = '') =>
    `<button data-action="${action}">${menuIcon(icon)}<span class="main-menu-text">${label}</span>${extra}</button>`;
  const section = (id: string, label: string, icon: string, content: string) =>
    `<button class="main-menu-section" data-section="${id}" aria-expanded="false" aria-controls="menu-${id}">${menuIcon(icon)}<span class="main-menu-text">${label}</span><span class="main-menu-chevron" aria-hidden="true">›</span></button><div class="main-submenu popup-menu menu-list" id="menu-${id}" hidden>${content}</div>`;
  menu.innerHTML = `${menuItem('home', 'Домой', ICONS.home)}<hr>
    ${section('import', 'Импорт', ICONS.pdf,
      menuItem('import', 'Импорт документа', ICONS.pdf) + menuItem('image', 'Вставить изображение', ICONS.image, `<kbd>${macKeys('Ctrl+V')}</kbd>`))}
    ${section('export', 'Экспорт', ICONS.export,
      menuItem('project', 'Скачать проект как файл', ICONS.export) + '<hr>' + menuItem('pdf', 'Экспорт в PDF', ICONS.pdf) + menuItem('png', 'Экспорт в PNG', ICONS.image)
        + '<hr>' + menuItem('link-project', 'Ссылка на проект (просмотр)', ICONS.link) + menuItem('link-page', 'Ссылка на текущую страницу', ICONS.link))}<hr>
    ${section('hide', 'Скрыть', ICONS.hideSection,
      '')}
    ${menuItem('task', 'Добавить задание…', ICONS.task)}
    ${menuItem('settings', 'Настройки', ICONS.settings)}<hr>
    ${!doskaApi && !isNativeApp() ? menuItem('app', 'Открыть в приложении', ICONS.openApp) : ''}`;
  document.body.append(menu);
  // «Скрыть»: переключатели на пружинах (src/toggle-switch.ts), меню при щелчке не закрывается
  const hideUndoSwitch = createToggleSwitch({
    className: 'grid-switch main-switch',
    label: 'Кнопки отмены и повтора',
    icon: ICONS.undo,
    checked: state.settings.hideUndoRedo,
    onChange: on => { setSettings({ hideUndoRedo: on }); persistSettings(); applyUndoRedoVisibility(true); },
  });
  const hideImportsSwitch = createToggleSwitch({
    className: 'grid-switch main-switch',
    label: 'Кнопки импорта',
    icon: ICONS.pdf,
    checked: localStorage.getItem('abax.hideImports') === 'true',
    onChange: on => {
      localStorage.setItem('abax.hideImports', String(on));
      setTopbarGroupHidden(document.querySelector<HTMLElement>('.import-group')!, on, hidden => document.body.classList.toggle('hide-import-buttons', hidden));
    },
  });
  const hideExportSwitch = createToggleSwitch({
    className: 'grid-switch main-switch',
    label: 'Кнопка экспорта',
    icon: ICONS.export,
    checked: localStorage.getItem('abax.hideExport') === 'true',
    onChange: on => {
      localStorage.setItem('abax.hideExport', String(on));
      if (on) closeExportMenu();
      setTopbarGroupHidden(document.querySelector<HTMLElement>('.export-group')!, on, hidden => document.body.classList.toggle('hide-export-button', hidden));
    },
  });
  const hideTierSwitch = createToggleSwitch({
    className: 'grid-switch main-switch',
    label: 'Текущий тариф',
    icon: ICONS.crown,
    checked: tierHidden(),
    onChange: on => setTierHidden(on),
  });
  const switchInput = (row: HTMLElement) => row.querySelector<HTMLInputElement>('input')!;
  // data-action — на самом переключателе: по нему пункт находят тесты и проверяют доступность
  switchInput(hideUndoSwitch).dataset.action = 'undo';
  switchInput(hideImportsSwitch).dataset.action = 'imports';
  switchInput(hideExportSwitch).dataset.action = 'hide-export';
  switchInput(hideTierSwitch).dataset.action = 'hide-tier';
  menu.querySelector<HTMLElement>('#menu-hide')!.append(hideUndoSwitch, hideImportsSwitch, hideExportSwitch, hideTierSwitch);
  // крестик на самом тарифе тоже прячет его — переключатель меню показывает это
  onTierHiddenChange(on => { switchInput(hideTierSwitch).checked = on; });
  const submenus = () => [...menu.querySelectorAll<HTMLButtonElement>('[data-section]')]
    .map(button => ({ button, panel: document.getElementById(button.getAttribute('aria-controls')!)! }));
  /** Отметки «Скрыть» и недоступные пункты — по текущему состоянию шапки. */
  const syncMenuChecks = () => {
    // настройку могли поменять и в другом месте (окно настроек)
    switchInput(hideUndoSwitch).checked = state.settings.hideUndoRedo;
    switchInput(hideImportsSwitch).checked = localStorage.getItem('abax.hideImports') === 'true';
    switchInput(hideExportSwitch).checked = localStorage.getItem('abax.hideExport') === 'true';
    switchInput(hideTierSwitch).checked = tierHidden();
    // элемент, которому в шапке не хватает места, показать нельзя: пункт недоступен
    const { noRoom } = topbarFit();
    for (const [row, step] of [[hideImportsSwitch, 'import'], [hideExportSwitch, 'export']] as const) {
      const disabled = noRoom.has(step);
      switchInput(row).disabled = disabled;
      row.title = disabled ? 'Не хватает места в шапке' : '';
    }
  };
  const setMenuOpen = (open: boolean) => {
    if (open) {
      syncMenuChecks();
      if (!menuShown(menu)) {
        claimMenu('main', () => setMenuOpen(false));
        openMenu(menu, { from: menuButton, items: () => [...menu.children].filter((c): c is HTMLElement => c instanceof HTMLElement && !c.classList.contains('main-submenu')) });
      }
    } else if (menuShown(menu)) {
      // подменю прячутся сразу: меню втягивается в кнопку вместе с ними
      for (const { button, panel } of submenus()) { button.setAttribute('aria-expanded', 'false'); closeMenu(panel, true); }
      closeMenu(menu);
      releaseMenu('main');
    }
    menuButton.setAttribute('aria-expanded', String(open));
    document.body.classList.toggle('main-menu-open', open);
  };
  document.addEventListener('topbar-fit', () => { if (menuShown(menu)) syncMenuChecks(); });
  document.body.classList.toggle('hide-import-buttons', localStorage.getItem('abax.hideImports') === 'true');
  document.body.classList.toggle('hide-export-button', localStorage.getItem('abax.hideExport') === 'true');
  menuButton.addEventListener('click', () => setMenuOpen(!menuShown(menu)));
  menu.addEventListener('click', e => {
    const target = e.target as HTMLElement;
    const sectionButton = target.closest<HTMLButtonElement>('button[data-section]');
    if (sectionButton) {
      // подменю одно: открытое втягивается в свой пункт, новое выходит из нажатого
      const opening = sectionButton.getAttribute('aria-expanded') !== 'true';
      for (const { button, panel } of submenus()) {
        const expanded = button === sectionButton && opening;
        if (expanded === (button.getAttribute('aria-expanded') === 'true')) continue;
        button.setAttribute('aria-expanded', String(expanded));
        if (expanded) openMenu(panel, { from: button });
        else closeMenu(panel);
      }
      return;
    }
    const action = target.closest<HTMLButtonElement>('button[data-action]')?.dataset.action;
    if (!action) return;
    setMenuOpen(false);
    if (action === 'home') void (async () => { await saveNow(); setView('home'); })();
    if (action === 'import') void importDocument();
    if (action === 'image') void insertImage();
    if (action === 'png') void exportPng();
    if (action === 'task') openTaskForm(null);
    if (action === 'link-project') void copyBoardLink('project');
    if (action === 'link-page') void copyBoardLink('page');
    if (action === 'settings') openAllSettings();
    if (action === 'project') void downloadProjectFile();
    if (action === 'pdf') showToast('Экспорт в PDF пока недоступен');
    if (action === 'app') openInDesktopApp();
  });
  document.addEventListener('pointerdown', e => { if (menuShown(menu) && !menu.contains(e.target as Node) && !menuButton.contains(e.target as Node)) setMenuOpen(false); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && menuShown(menu)) { setMenuOpen(false); menuButton.focus(); } });
  document.getElementById('btn-undo')!.addEventListener('click', () => undo());
  document.getElementById('btn-redo')!.addEventListener('click', () => redo());
  document.getElementById('btn-fit')!.addEventListener('click', () => { stopFollowByUser(); fitContent(true); });
  const exportButton = document.getElementById('btn-export')!;
  exportButton.title = 'Экспорт';
  exportButton.setAttribute('aria-expanded', 'false');
  const exportMenu = document.createElement('div');
  exportMenu.id = 'export-menu';
  exportMenu.className = 'popup-menu menu-list';
  exportMenu.hidden = true;
  exportMenu.innerHTML = menu.querySelector<HTMLElement>('#menu-export')!.innerHTML;
  document.body.append(exportMenu);
  closeExportMenu = () => {
    exportButton.setAttribute('aria-expanded', 'false');
    if (!menuShown(exportMenu)) return;
    closeMenu(exportMenu);
    releaseMenu('export');
  };
  exportButton.addEventListener('click', () => {
    if (menuShown(exportMenu)) { closeExportMenu(); return; }
    claimMenu('export', closeExportMenu);
    openMenu(exportMenu, {
      from: exportButton,
      // под плашкой экспорта, по её левому краю
      place: () => {
        const bounds = exportButton.closest('.topbar-group')!.getBoundingClientRect();
        exportMenu.style.left = `${Math.max(8, Math.min(bounds.left, window.innerWidth - exportMenu.offsetWidth - 8))}px`;
        exportMenu.style.top = `${bounds.bottom + 6}px`;
      },
    });
    exportButton.setAttribute('aria-expanded', 'true');
  });
  exportMenu.addEventListener('click', e => {
    const action = (e.target as HTMLElement).closest<HTMLButtonElement>('button[data-action]')?.dataset.action;
    if (!action) return;
    closeExportMenu();
    menu.querySelector<HTMLButtonElement>(`#menu-export [data-action="${action}"]`)?.click();
  });
  document.addEventListener('pointerdown', e => { if (menuShown(exportMenu) && !exportMenu.contains(e.target as Node) && !exportButton.contains(e.target as Node)) closeExportMenu(); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && menuShown(exportMenu)) { closeExportMenu(); exportButton.focus(); } });
  document.getElementById('btn-present')!.addEventListener('click', togglePresent);
  registerPanelActions();
  registerPanelModes();
  wireHelpButton();
  initTopbarFit();
  // список страниц внизу не должен заходить под правый нижний угол
  const bottombar = document.getElementById('bottombar')!;
  new ResizeObserver(() => {
    document.documentElement.style.setProperty('--bottombar-w', `${bottombar.offsetWidth}px`);
    syncPagesLift();
  }).observe(bottombar);
  window.addEventListener('resize', syncPagesLift);
  document.getElementById('btn-import')!.addEventListener('click', () => { void importDocument(); });
  document.getElementById('btn-settings')!.addEventListener('click', () => {
    if (settingsPopover().hidden) openSettings();
    else closeSettings();
  });

  // названия в шапке: вне фокуса — сокращённые, в фокусе — полные (src/topbar-names.ts)
  topPageName = wireTopName(document.getElementById('page-name') as HTMLInputElement, {
    max: PAGE_NAME_MAX,
    canEdit: canEditPages,
    commit: v => { renamePage(state.pageId, v); void saveNow(); },
  });
  topProjectName = wireTopName(document.getElementById('project-name') as HTMLInputElement, {
    max: PROJECT_NAME_MAX,
    // проект переименовывает только автор у себя (не гость и не просмотр по ссылке)
    canEdit: () => state.linkMode === null && !(collabActive() && !isHost()),
    commit: v => { void renameProjectHandler(state.project.id, v); },
  });
  topProjectName.set(state.project.name);

  wireGridPicker();

  // закрытие панелей по клику мимо / Esc
  canvas.addEventListener('pointerdown', () => {
    closeCtxPanel();
    closeSettings();
  }, { capture: true });
  document.getElementById('canvas-wrap')!.addEventListener('pointerdown', e => {
    const t = e.target as HTMLElement;
    const d = dockedPanel();
    // кнопки-вызовы сами переключают панель по click; откреплённые панели кликом мимо не закрываются
    if (d && !d.el.contains(t) && !t.closest('[data-ctx]')) closePanel(d);
  }, { capture: true });
  window.addEventListener('resize', () => positionCtxPanels(true));
  // холст сменил размер (окно, боковая панель) — откреплённая панель остаётся в его пределах
  if (typeof ResizeObserver !== 'undefined') {
    new ResizeObserver(() => { if (state.settings.toolbarFloat) applyToolbarPos(); }).observe(document.getElementById('canvas-wrap')!);
  }
  window.addEventListener('keydown', e => {
    // Esc у открытого окна настроек закрывает только его
    if (settingsDialogOpen() || eyedropperActive()) return;
    if (e.key === 'Escape') {
      // Esc закрывает только верхнее: выделение на доске (см. controller.ts) остаётся до следующего нажатия
      if (!gridMenu().hidden) { e.stopPropagation(); closeGridMenu(); gridButton().focus(); return; }
      if (!settingsPopover().hidden) { e.stopPropagation(); closeSettings(); return; }
      // поле кегля закрывает свою панель само (Esc там — отмена ввода)
      if (dockedPanel() && !fontEdit) { e.stopPropagation(); closeCtxPanel(); return; }
    }
  }, { capture: true });
}

/** «Скачать проект как файл»: весь проект — файлом .json (пункт меню экспорта и режим «Экспорт» панели). */
async function downloadProjectFile(): Promise<void> {
  if (!canCloneCurrentProject()) { showToast('Автор запретил сохранение проекта'); return; }
  await saveNow();
  const url = URL.createObjectURL(new Blob([JSON.stringify(state.project, null, 2)], { type: 'application/json' }));
  const a = document.createElement('a'); a.href = url; a.download = `${state.project.name || 'Abax'}.json`; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** «Открыть в приложении» (только в браузере). */
function openInDesktopApp(): void {
  // установленная Abax зарегистрировала схему abax:// — запускаем её. Ссылка на скачивание
  // остаётся в тосте: так пункт меню работает и там, где приложение ещё не установлено.
  showToast('Открываем Abax…', { label: 'Скачать, если не открылось', href: RELEASES_URL });
  openDesktopApp();
}

/** Действия доски для режимов боковой панели «История», «Импорт», «Экспорт» (src/panel-actions.ts). */
function registerPanelActions(): void {
  // вложения чата у получателя: вставка картинки и копий, переход к объектам (SPEC_CHAT §7)
  setChatAttachActions({
    canEdit: canEditBoard,
    insertImage: src => { if (canEditBoard()) insertImageFromDataUrl(src); },
    goToPage: async pageId => {
      if (state.view !== 'board' || !state.project.pages.some(p => p.id === pageId)) return false;
      await switchPageHandler(pageId);
      return state.pageId === pageId;
    },
  });
  setPanelActions({
    canEdit: canEditBoard,
    importDocument: () => { void importDocument(); },
    insertImage: () => { void insertImage(); },
    importFile: importDroppedFile,
    canOpenProject: canOpenProjectFile,
    openProjectFile,
    pasteFromClipboard: () => { void pasteImageFromClipboard(); },
    exportPng: scope => { void exportPng(scope); },
    copyImage: () => { void copySelectionAsImage(); },
    downloadProject: () => { void downloadProjectFile(); },
    openInApp: !doskaApi && !isNativeApp() ? openInDesktopApp : null,
  });
}

// ----- «Помощь и советы»: кнопка в правом нижнем углу и F1 -----

/** Кнопка «Помощь» и F1 открывают и закрывают боковую панель в режиме «Справка» (SPEC_CHAT §5). */
function wireHelpButton(): void {
  const button = document.getElementById('btn-help') as HTMLButtonElement;
  button.innerHTML = ICONS.help;
  const sync = () => button.setAttribute('aria-expanded', sidePanelOpen() && sidePanelMode() === 'help' ? 'true' : 'false');
  onSidePanel(sync);
  sync();
  button.addEventListener('click', () => toggleSidePanel('help'));
  document.addEventListener('keydown', e => {
    // F1 — и на доске, и в полях ввода; браузер свою справку не открывает
    if (e.code === 'F1' && !e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey && state.view === 'board' && !settingsDialogOpen()) {
      e.preventDefault();
      if (!e.repeat) toggleSidePanel('help');
    }
  });
}

// ----- «Масштаб, вид и взаимодействия»: меню над группой в правом нижнем углу -----

/** Цвета фона страницы в подменю «Фон страницы». */
const PAGE_BACKGROUNDS: readonly [string, string][] = [
  ['Белый', '#ffffff'], ['Светло-серый', '#f1f1f1'], ['Серый', '#aaaaaa'], ['Тёмно-серый', '#444444'], ['Чёрный', '#000000'],
  ['Голубой', '#e7f7ff'], ['Сиреневый', '#eeeaff'], ['Розовый', '#fdebef'], ['Жёлтый', '#fff8db'], ['Зелёный', '#edf8e5'],
];
type ViewLevel = 'root' | 'grid' | 'background' | 'interactions';
type ViewSub = Exclude<ViewLevel, 'root'>;
const VIEW_SUB_TITLES: Record<ViewSub, string> = { grid: 'Тип сетки', background: 'Фон страницы', interactions: 'Взаимодействия' };

/**
 * Меню «Масштаб, вид и взаимодействия»: всегда шириной с группу масштаба и выходит из всей группы (src/menu-motion.ts).
 * «Тип сетки», «Фон страницы» и «Взаимодействия» открываются внутри того же меню: заголовок со стрелкой «назад» и пункты подменю.
 */
function wireZoomInput(): void {
  const label = document.getElementById('zoom-label')!;
  initZoomChevron(label, label.querySelector<HTMLElement>('.zoom-chevron')!);
  const group = document.querySelector<HTMLElement>('.view-group')!;
  const gridTrigger = document.getElementById('view-grid-icon')!;
  const menu = document.createElement('div');
  menu.id = 'view-menu';
  menu.className = 'popup-menu menu-list';
  menu.hidden = true;
  document.body.append(menu);
  let level: ViewLevel = 'root';
  let page: HTMLElement | null = null;

  const row = (attrs: string, icon: string, text: string, sub = false) =>
    `<button ${attrs}><span class="view-icon">${icon}</span><span class="view-text">${text}</span>${sub ? '<span class="view-arrow" aria-hidden="true">›</span>' : ''}</button>`;
  const makePage = (lvl: ViewLevel, html: string): HTMLElement => {
    const p = document.createElement('div');
    p.className = 'view-page';
    p.dataset.level = lvl;
    p.innerHTML = html;
    return p;
  };
  const subTitle = (lvl: ViewSub) => VIEW_SUB_TITLES[lvl];
  const subIcon = (lvl: ViewSub) => (lvl === 'grid' ? GRID_ICONS.square : lvl === 'background' ? BACKGROUND_ICON : INTERACTIONS_ICON);
  const rootPage = (): HTMLElement => {
    // в режиме просмотра по ссылке тип сетки и фон страницы не меняются: пунктов нет
    const viewOnly = state.linkMode !== null;
    const subs: ViewSub[] = viewOnly ? ['interactions'] : ['grid', 'background', 'interactions'];
    const subRows = subs.map(s => row(`data-view="${s}"`, subIcon(s), subTitle(s), true)).join('');
    const p = makePage('root', `${row('data-view="fullscreen"', (document.fullscreenElement ? ICONS.fullscreenExit : ICONS.fullscreenEnter), 'Полный экран')}
      ${row('data-view="fit"', ICONS.fit, 'Показать всё')}<hr>
      ${subRows}<hr>
      <div class="view-zoom-scroll"><div class="view-zoom-pills">${[50, 70, 100, 200, 400, 800].map(n => `<button data-zoom="${n}">${n}%</button>`).join('')}</div></div>`);
    // колесо мыши прокручивает ряд по горизонтали; полоса прокрутки — своя, поверх pills (src/overlay-scroll.ts)
    attachOverlayScroll(p.querySelector<HTMLElement>('.view-zoom-pills')!, { axis: 'x', wheel: true });
    return p;
  };
  const check = (on: boolean) => (on ? '<span class="view-check" aria-hidden="true">✓</span>' : '');
  /** Переключатель настройки доски в подменю «Взаимодействия»: меню не закрывается, настройка сразу сохраняется. */
  const settingSwitch = (key: 'snapToGrid' | 'smoothPan' | 'alignGuides', label: string, icon: string, title: string) => createToggleSwitch({
    className: 'grid-switch view-switch',
    label, icon, title,
    checked: state.settings[key],
    onChange: on => { setSettings({ [key]: on }); persistSettings(); },
  });
  const subPage = (lvl: ViewSub): HTMLElement => {
    // заголовок — тот же пункт, что в меню (иконка, название, стрелка), поверх — стрелка «назад»
    const p = makePage(lvl, `<button class="view-back" data-view="back" aria-label="Назад"><span class="view-icon"><span class="vb-arrow">${BACK_ARROW_ICON}</span><span class="vb-ghost">${subIcon(lvl)}</span></span><span class="view-text">${subTitle(lvl)}</span><span class="view-arrow vb-ghost" aria-hidden="true">›</span></button><hr>`);
    if (lvl === 'grid') {
      const labels = state.board.coordLabels !== false;
      for (const g of Object.keys(GRID_LABELS) as GridMode[]) {
        const b = document.createElement('button');
        b.dataset.grid = g;
        b.innerHTML = `<span class="view-icon">${gridIcon(g, labels)}</span>`;
        const text = document.createElement('span');
        text.className = 'view-text';
        text.textContent = GRID_LABELS[g];
        b.append(text);
        b.insertAdjacentHTML('beforeend', check(g === state.board.grid));
        p.append(b);
      }
      const coordSwitch = coordLabelsSwitch();
      if (coordSwitch) p.append(coordSwitch);
    } else if (lvl === 'interactions') {
      // подсказки — слева: справа край окна, сверху и снизу они закрывали бы пункты меню и масштаб
      p.dataset.tipSide = 'left';
      // в просмотре по ссылке доску не правят: остаётся только «Плавное движение»
      if (state.linkMode === null) p.append(settingSwitch('snapToGrid', 'Привязка к сетке', SNAP_ICON, 'Точки, фигуры и рамки при перемещении встают на узлы сетки'));
      p.append(settingSwitch('smoothPan', 'Плавное движение', SMOOTH_PAN_ICON, 'Небольшая инерция при перемещении по доске: после отпускания камера плавно останавливается'));
      if (state.linkMode === null) p.append(settingSwitch('alignGuides', 'Направляющие', GUIDES_ICON, 'При переносе и изменении размера - пунктир от соседних объектов, к их краям и центрам объект примагничивается'));
    } else {
      const current = state.board.backgroundColor ?? '#ffffff';
      for (const [name, color] of PAGE_BACKGROUNDS) {
        const b = document.createElement('button');
        b.dataset.bg = color;
        const icon = document.createElement('span');
        icon.className = 'view-icon';
        const swatch = document.createElement('span');
        swatch.className = 'view-swatch';
        swatch.style.background = color;
        icon.append(swatch);
        const text = document.createElement('span');
        text.className = 'view-text';
        text.textContent = name;
        b.append(icon, text);
        b.insertAdjacentHTML('beforeend', check(color === current));
        p.append(b);
      }
    }
    return p;
  };
  const pageFor = (lvl: ViewLevel) => (lvl === 'root' ? rootPage() : subPage(lvl));

  const positionMenu = () => {
    // группа в правом нижнем углу: меню раскрывается вверх и всегда шириной с группу
    const r = group.getBoundingClientRect();
    menu.style.width = `${r.width}px`;
    menu.style.left = `${r.left}px`; menu.style.right = 'auto';
    menu.style.top = 'auto'; menu.style.bottom = `${window.innerHeight - r.top + 6}px`;
  };
  const close = () => {
    label.setAttribute('aria-expanded', 'false');
    document.getElementById('zoom-input')?.blur();
    if (!menuShown(menu)) return;
    closeMenu(menu);
    releaseMenu('view');
  };
  const open = (lvl: ViewLevel) => {
    level = lvl;
    page = pageFor(lvl);
    menu.replaceChildren(page);
    claimMenu('view', close);
    openMenu(menu, {
      from: group,
      whole: true,
      reverse: true,
      place: positionMenu,
      items: () => (page ? [...page.children].filter((c): c is HTMLElement => c instanceof HTMLElement) : []),
      onSettled: () => { if (menuShown(menu)) positionMenu(); },
    });
    label.setAttribute('aria-expanded', 'true');
    // корневое меню сразу открывает поле масштаба — как раньше пункт «Другой…»
    if (lvl === 'root') openZoomInput(label, close);
  };
  /** Переход внутри открытого меню: в подменю, назад или из одного подменю в другое. */
  const go = (target: ViewLevel) => {
    if (!page || target === level) return;
    const from = page;
    const to = pageFor(target);
    const focused = menu.contains(document.activeElement);
    if (level === 'root') {
      drillMenu(menu, from, to, { dir: 'in', row: from.querySelector<HTMLElement>(`[data-view="${target}"]`) ?? undefined, head: to.querySelector<HTMLElement>('.view-back') ?? undefined, bottom: true });
    } else if (target === 'root') {
      drillMenu(menu, from, to, { dir: 'out', row: to.querySelector<HTMLElement>(`[data-view="${level}"]`) ?? undefined, head: from.querySelector<HTMLElement>('.view-back') ?? undefined, bottom: true });
    } else {
      drillMenu(menu, from, to, { dir: 'swap', bottom: true });
    }
    const back = level;
    level = target;
    page = to;
    // с клавиатуры фокус переходит на заголовок подменю, а после «назад» — на пункт, из которого пришли
    if (focused) (target === 'root' ? to.querySelector<HTMLElement>(`[data-view="${back}"]`) : to.querySelector<HTMLElement>('.view-back'))?.focus();
  };

  for (const [id, factor, icon] of [
    ['zoom-out', 1 / 1.25, ICONS.zoomOut],
    ['zoom-in', 1.25, ICONS.zoomIn],
  ] as const) {
    const button = document.getElementById(id)!;
    button.innerHTML = icon;
    button.addEventListener('click', () => {
      zoomCenterSmooth(zoomGoal() * factor);
    });
  }
  gridTrigger.addEventListener('click', () => {
    if (state.linkMode !== null) return; // в режиме просмотра по ссылке сетку не меняют
    if (!menuShown(menu)) open('grid');
    else if (level === 'grid') close();
    else go('grid');
  });
  label.addEventListener('click', () => {
    if (menuShown(menu)) close();
    else open('root');
  });
  menu.addEventListener('click', e => {
    const b = (e.target as HTMLElement).closest<HTMLButtonElement>('button'); if (!b || !menuShown(menu)) return;
    const view = b.dataset.view;
    if (view === 'grid' || view === 'background' || view === 'interactions') { go(view); return; }
    if (view === 'back') { go('root'); return; }
    if (b.dataset.grid) { setGrid(b.dataset.grid as GridMode); void saveNow(); close(); return; }
    if (b.dataset.bg) {
      state.board.backgroundColor = b.dataset.bg; state.board.elements = [...state.board.elements]; update(true); void saveNow(); close(); return;
    }
    if (view === 'fullscreen') { if (document.fullscreenElement) void document.exitFullscreen(); else void document.documentElement.requestFullscreen(); }
    if (view === 'fit') { stopFollowByUser(); fitContent(true); }
    if (b.dataset.zoom) zoomCenterSmooth(Number(b.dataset.zoom) / 100);
    close();
  });
  // щелчок по пункту не отнимает фокус у поля масштаба: иначе поле закрылось бы и закрыло меню вместе с собой
  // (подменю и переключатели перестали бы работать); набирать масштаб можно и после щелчка
  menu.addEventListener('mousedown', e => { if (document.activeElement?.id === 'zoom-input') e.preventDefault(); });
  // ширина группы меняется (число масштаба, узкое окно) — меню вместе с ней
  new ResizeObserver(() => { if (menuShown(menu)) positionMenu(); }).observe(group);
  window.addEventListener('resize', () => { if (menuShown(menu)) positionMenu(); });
  document.addEventListener('pointerdown', e => { if (menuShown(menu) && !menu.contains(e.target as Node) && !label.contains(e.target as Node) && !(e.target as HTMLElement).closest('.zoom-edit') && !gridTrigger.contains(e.target as Node)) close(); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && menuShown(menu)) { close(); label.focus(); } });
}

/** Поле вместо подписи масштаба: Enter применяет (ошибку объясняет подсказка), Esc и уход из поля с ошибкой — отмена. */
function openZoomInput(label: HTMLElement, onDone?: () => void): void {
  const box = document.createElement('span');
  box.className = 'zoom-edit';
  const input = document.createElement('input');
  input.id = 'zoom-input';
  input.inputMode = 'decimal';
  input.autocomplete = 'off';
  input.spellcheck = false;
  input.maxLength = 8;
  input.setAttribute('aria-label', 'Масштаб, %');
  input.value = String(Math.round(state.camera.zoom * 100));
  const unit = document.createElement('span');
  unit.className = 'zoom-unit';
  unit.textContent = '%';
  const hint = document.createElement('div');
  hint.className = 'zoom-hint';
  hint.setAttribute('role', 'alert');
  hint.hidden = true;
  box.append(input, unit, hint);
  label.hidden = true;
  label.after(box);
  input.focus();
  input.select();
  /** Проверка введённого; пустое поле при наборе не ругаем — только при подтверждении. */
  const check = (strict: boolean): number | null => {
    const r = parseZoomPercent(input.value);
    const error = 'error' in r && (strict || input.value.trim() !== '') ? r.error : '';
    input.classList.toggle('invalid', !!error);
    input.setAttribute('aria-invalid', String(!!error));
    hint.textContent = error;
    hint.hidden = !error;
    return 'zoom' in r ? r.zoom : null;
  };
  let done = false;
  const close = (zoom: number | null) => {
    if (done) return;
    done = true;
    box.remove();
    label.hidden = false;
    onDone?.();
    if (zoom === null) return;
    // относительно центра холста, как кнопки + и −
    zoomCenterSmooth(zoom);
  };
  input.addEventListener('input', () => check(false));
  input.addEventListener('keydown', e => {
    e.stopPropagation();
    if (e.key === 'Enter') {
      e.preventDefault();
      const zoom = check(true);
      if (zoom !== null) close(zoom);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      close(null);
    }
  });
  input.addEventListener('blur', e => {
    // фокус ушёл на пункт меню «Масштаб и вид»: поле просто закрывается, меню остаётся — пункт сам решит, что делать
    if ((e.relatedTarget as HTMLElement | null)?.closest('#view-menu')) {
      if (done) return;
      done = true;
      box.remove();
      label.hidden = false;
      return;
    }
    close(check(true));
  });
}

/** Окно демонстрации: открыть или закрыть. */
export function togglePresent(): void {
  if (presentOpen()) { closePresent(); return; }
  if (!openPresent()) alert('Не удалось открыть окно демонстрации: разрешите всплывающие окна для этой страницы');
}

// ----- Совместная работа: окно «Поделиться» (src/share-dialog.ts) -----

/** Совместная работа во вкладке браузера: комната и хаб живут в самой странице, гости приходят через ретранслятор. */
const browserShareApi: ShareApi = {
  async shareStart() {
    await startBrowserHost();
    return { ok: true, connected: true };
  },
  async shareStop() { stopBrowserHost(); return { ok: true }; },
  async shareStatus() { return browserShareStatus(); },
  async shareSetRights(uid, patch) { return browserSetRights(uid, patch as Parameters<typeof browserSetRights>[1]); },
  async shareOpenTestWindow() { return { ok: false }; },
  async shareCloudStart(opts) {
    const relayUrl = opts?.relayUrl || savedRelayUrl() || defaultRelayUrl();
    // как share:cloudStart в main.cjs: пустой адрес — не «неверный», а «не указан»
    if (!relayUrl) return { ok: false, error: 'Не указан адрес ретранслятора' };
    try {
      await startBrowserCloud(relayUrl);
      return { ok: true, cloud: browserShareStatus().cloud ?? null };
    } catch (e) {
      const text = e instanceof Error ? e.message : '';
      return { ok: false, error: text || 'Не удалось подключиться к ретранслятору' };
    }
  },
  async shareCloudStop() { stopBrowserCloud(); return { ok: true }; },
};

async function collabApi(): Promise<ShareApi> {
  const api = (window as unknown as { doskaAPI?: ShareApi }).doskaAPI;
  return api?.shareStart ? api : browserShareApi;
}

/** Свой адрес ретранслятора (сервер не по умолчанию); хранится только у автора. */
function savedRelayUrl(): string {
  try { return localStorage.getItem('doska.relayUrl') || ''; } catch { return ''; }
}
/** Ретранслятор по умолчанию из сборки (vite.config.ts); вне Vite (unit-тесты) — не задан. */
function defaultRelayUrl(): string {
  return typeof __DEFAULT_RELAY_URL__ === 'string' ? __DEFAULT_RELAY_URL__ : '';
}

async function openShareDialog(): Promise<void> {
  const api = await collabApi();
  await openShareDialogUi({
    api,
    saveNow,
    startHost: (port, code, hostKey) => startHostConnection(port, code, hostKey, profileName() || 'Автор'),
    stopCollab,
  });
}

/** Инструменты, которые читателю безвредны: ничего не рисуют и не меняют. */
const READER_TOOLS = new Set<ToolId>(['select', 'pan', 'laser', 'fadePen', 'flash']);
/** Указка: лазер, исчезающий маркер, подсветка. */
const POINTER_KINDS = new Set<ToolId>(['laser', 'fadePen', 'flash']);
/** Инструмент гостя до того, как ему оставили только чтение. */
let toolBeforeReader: ToolId | null = null;

function refresh(): void {
  // совместный режим: скрываем тулбар на страницах без права edit
  if (collabActive() && !isHost()) {
    document.body.classList.toggle('readonly-mode', readOnly());
    // читателю панели нет: инструмент — «Выделение» (реакции, копирование), а если копировать нельзя — «Панорама»;
    // без указки (роль «Читатель», SPEC_NIGHT6 §2.3) лазер, исчезающий маркер и подсветка недоступны
    const noPointer = myCollabCaps()?.pointer === false;
    const allowed = (t: ToolId) => READER_TOOLS.has(t) && !(noPointer && POINTER_KINDS.has(t));
    if (noPointer && POINTER_KINDS.has(state.tool)) setTool(canCopyCurrentBoard() ? 'select' : 'pan');
    if (readOnly()) {
      if (!allowed(state.tool) || (state.tool === 'select' && !canCopyCurrentBoard())) {
        if (!READER_TOOLS.has(state.tool)) toolBeforeReader = state.tool;
        setTool(canCopyCurrentBoard() ? 'select' : 'pan');
      }
    } else if (toolBeforeReader) {
      // право правки выдали: инструмент возвращается тот, каким гость пользовался до этого
      const back = toolBeforeReader;
      toolBeforeReader = null;
      if (READER_TOOLS.has(state.tool) && state.tool !== 'pan') setTool(back);
    }
  }
  const tb = document.getElementById('toolbar')!;
  for (const b of tb.querySelectorAll<HTMLButtonElement>('.tool[data-tool]')) {
    b.classList.toggle('active', b.dataset.tool === state.tool);
  }
  for (const group of toolbarConfig().items) {
    if (group.type !== 'group' || group.tools.length === 0) continue;
    const active = group.tools.includes(state.tool);
    if (active) lastGroupTool[group.id] = state.tool;
    const btn = tb.querySelector<HTMLButtonElement>(`[data-ctx="${group.id}"]`);
    if (!btn) continue;
    btn.classList.toggle('active', active);
    btn.classList.toggle('sticky', active && stickyTool() === state.tool);
    // инструмент могли перенести в другую группу — тогда кнопка показывает первый
    const cur = group.tools.includes(lastGroupTool[group.id]) ? lastGroupTool[group.id] : group.tools[0];
    if (btn.dataset.shape !== cur) {
      btn.dataset.shape = cur;
      btn.innerHTML = toolDef(cur).icon;
      btn.title = `${group.name}: ${toolDef(cur).title}`;
    }
  }
  syncPresetButtons(tb);
  // панель стикеров открывается автоматически с инструментом (если стикер не скрыт с панели)
  const noteOnToolbar = !!tb.querySelector('[data-ctx="note"], [data-tools~="note"]');
  if (state.tool === 'note' && noteOnToolbar && !dockedPanel() && !panelOf('note') && state.view === 'board') openCtxPanel('note', 'toolbar');
  const notePanel = panelOf('note');
  if (state.tool !== 'note' && notePanel && !notePanel.detached) closePanel(notePanel);
  // откреплённые палитры инструментов подсвечивают текущий инструмент
  for (const b of ctxLayerEl().querySelectorAll<HTMLElement>('[data-shape]')) {
    b.classList.toggle('active', b.dataset.shape === state.tool);
  }
  ctxLayerEl().hidden = state.view !== 'board';

  document.getElementById('btn-present')!.classList.toggle('active', presentOpen());
  // черновик не виден никому, кроме автора, — пометка на холсте, чтобы его не принять за обычную страницу
  const draftBadge = document.getElementById('draft-badge')!;
  draftBadge.hidden = !onDraft() || state.view !== 'board';
  document.body.classList.toggle('on-draft', onDraft());
  (document.getElementById('btn-undo') as HTMLButtonElement).disabled = !canUndo();
  (document.getElementById('btn-redo') as HTMLButtonElement).disabled = !canRedo();
  // режим просмотра (ссылка или гость без права правки): группа отмены скрывается целиком, а не остаётся пустой плашкой
  document.querySelector<HTMLElement>('.undo-group')!.style.display = canEditBoard() ? '' : 'none';
  setZoomCounter(document.getElementById('zoom-value')!, Math.round(state.camera.zoom * 100));
  renderGridButton();
  topPageName?.set(state.board.name);

  // вид домашней страницы
  const home = document.getElementById('home')!;
  const isHome = state.view === 'home';
  if (home.hidden === isHome) {
    home.hidden = !isHome;
    // на домашнюю пришли заново: карусели — снова с последней открытой страницы
    if (isHome) { carouselPos.clear(); lastHomeKey = ''; closeSidePanel(true); }
    closeIconPicker();
  }
  noteOpened();
  if (isHome) {
    const hk = homeKey();
    if (hk !== lastHomeKey) {
      lastHomeKey = hk;
      renderHome();
    }
  }

  const key = pagesKey();
  if (key !== lastPagesKey) {
    lastPagesKey = key;
    renderPages();
  }
  updateQuickMenu();
  const stylePanel = panelOf('style');
  const selectionKey = `${state.pageId}:${[...state.selection].sort().join(',')}`;
  if (stylePanel && stylePanel.el.dataset.selection !== selectionKey) {
    styleColorTab = 'border';
    rebuildPanel(stylePanel);
  } else if (stylePanel) {
    updateSwatchActive(stylePanel.el, currentPanelColor());
    stylePanel.el.style.setProperty('--ink', currentPanelColor() || 'transparent');
    stylePanel.el.querySelector('.ctx-fill-clear')?.classList.toggle('active', !currentPanelColor());
  }
  syncShapeCaret();
  syncFrameOff();
  syncThumbViewport();
}

/** Совместный режим: остальные участники видят рамку вокруг выделенного нами. */
function syncSelectionToCollab(): void {
  if (!collabActive()) return;
  const ids = [...state.selection];
  const key = `${state.pageId}:${ids.join(',')}`;
  if (key === lastSelectionKey) return;
  lastSelectionKey = key;
  noteSelection(ids);
}

/**
 * Подписка: окно тарифов по нажатию на недоступное, тариф в шапке, бейджи Pro. Сменился тариф — свой проект
 * живёт по тарифу владельца (то есть по моему), а бейджи «новая страница» и «новый проект» сверяются заново.
 */
function initSubscriptionUi(): void {
  setUpgradeHandler(f => openPlansDialog(f));
  setPlansDialogHooks({
    openLogin: () => openAllSettings('profile'),
    openPromo: () => { promoFocusNext = true; openAllSettings('subscription'); },
  });
  startProBadges();
  mountTierButton();
  onPlanChange(() => {
    if (state.collabRole === null && !state.linkMode && state.project.ownerPlan !== userPlan()) {
      state.project = { ...state.project, ownerPlan: userPlan() };
    }
    renderPages();
    if (state.view === 'home') renderHome();
    refreshProBadges();
  });
  void refreshBilling();
}

export function initApp(c: HTMLCanvasElement): void {
  // страницу скрыли под гостем: открытый редактор текста закрывается без сохранения (SPEC_NIGHT5 §7)
  onCancelInteraction(() => closeEditor(false));
  // пришли приглашения по почте — домашний экран показывает их сразу
  onIncomingInvites(() => { if (state.view === 'home') renderHome(); });
  // облако нашло проекты, которых нет на устройстве: показываем их на главном экране
  document.addEventListener('doska:projects-changed', () => { if (state.view === 'home') renderHome(); });
  // вернулись на вкладку: с другого устройства пришла более новая версия открытого проекта (SPEC_NIGHT5 §2.3)
  document.addEventListener('doska:cloud-fresh', ev => {
    const project = (ev as CustomEvent<{ project: Project }>).detail?.project;
    if (!project || project.id !== state.project.id || state.dirty || state.linkMode || state.collabRole !== null) return;
    void showCloudProject(project, { keepView: true });
  });
  // автор позвал всех на страницу (SPEC_NIGHT5 §8): гость переходит на неё и плавно наводит камеру на центр экрана автора
  document.addEventListener('doska:collab-summon', ev => {
    const d = (ev as CustomEvent<CollabSummonDetail>).detail;
    if (!d) return;
    void goToCollabPoint({ pageId: d.pageId, x: d.vx, y: d.vy, zoom: d.vz, reason: 'follow' });
  });
  // к участнику: краевой курсор, аватар, автопереход за автором
  document.addEventListener('doska:collab-goto', ev => {
    const d = (ev as CustomEvent<CollabGotoDetail>).detail;
    if (d) void goToCollabPoint(d);
  });
  initCollabPresence(refreshPageAvatars, { openProfile: () => openAllSettings('profile') });
  initSyncIndicator({ onDraft: () => conflictDraftNotice(state.project.id, 'Есть офлайн-правки с этого устройства', true) });
  initSubscriptionUi();
  c.addEventListener('dragover', e => { if (draggedColor && canEditBoard()) e.preventDefault(); });
  c.addEventListener('drop', e => {
    if (!draggedColor || !canEditBoard()) return;
    e.preventDefault();
    const rect = c.getBoundingClientRect();
    const x = (e.clientX - rect.left) / state.camera.zoom + state.camera.x;
    const y = (e.clientY - rect.top) / state.camera.zoom + state.camera.y;
    const target = [...state.board.elements].reverse().find(el => hitTest(el, x, y, 5 / state.camera.zoom));
    if (target) colorElement(target.id, draggedColor.color, styleColorTab === 'fill');
  });
  canvas = c;
  registerLinkViewHooks({ fit: fitContent });
  addGestureProbe(() => editing !== null || fontEdit !== null || taskDialogOpen());
  initTaskOverlay(editTaskElement);
  initCommentsUi();
  initAnnotLayer();
  initAttention();
  initNoteNotices();
  restoreCamera();
  restoreStyle();
  restoreSettings();
  applyAnimationMode();
  applyUndoRedoVisibility();
  restoreToolbar();
  buildToolbar();
  applyToolbarPos();
  wireTopbar();
  wireZoomInput();
  wirePagesDock();
  wireImageInput();
  // курсор в выделенной фигуре прячется, пока набор идёт в поле ввода
  document.addEventListener('focusin', syncShapeCaret);
  // пока правят текст (или кегль в поле меню), клики по меню выделения и панелям не забирают фокус
  for (const host of [quickMenuEl(), ctxLayerEl()]) {
    host.addEventListener('mousedown', e => {
      if ((editing || fontEdit) && !isTypingField(e.target)) e.preventDefault();
    }, { capture: true });
  }
  // фокус ушёл из редактора текста не в меню и не в панели (в название страницы и т. п.) — ввод закончен
  document.addEventListener('focusin', e => {
    if (editing && e.target !== editing.ta && !insideTextMenus(e.target)) closeEditor(true);
  });
  document.addEventListener('focusout', () => queueMicrotask(syncShapeCaret));
  try { refresh(); } catch (err) { console.error('[doska] refresh failed:', err); }
  onToolbarChange(() => {
    buildToolbar();
    syncGroupPanels();
    refresh();
    positionCtxPanels(true);
  });
  // кнопка «Выделение» показывает персональный курсор: сменился курсор (или право на него) — перестроить панель
  // кнопка профиля на домашнем экране показывает имя и курсор
  onProfileChange(() => { if (state.view === 'home') renderHome(); });
  let shownCursor = myCursorId();
  onProfileChange(() => {
    if (myCursorId() === shownCursor) return;
    shownCursor = myCursorId();
    buildToolbar();
    syncGroupPanels();
    refresh();
    positionCtxPanels(true);
  });
  const cameraId = () => (onDraft() ? `draft:${state.pageId}` : cameraKey(state.project.id, state.pageId));
  let cameraIdentity = cameraId();
  let observedCamera = state.camera;
  let cameraTimer = 0;
  onChange(() => {
    if (interceptTaskTool()) return;
    const identity = cameraId();
    if (identity !== cameraIdentity) {
      clearTimeout(cameraTimer);
      cameraIdentity = identity;
      observedCamera = state.camera;
    } else if (linkTransit) {
      clearTimeout(cameraTimer);
      observedCamera = state.camera;
    } else if (observedCamera !== state.camera) {
      observedCamera = state.camera;
      clearTimeout(cameraTimer);
      const camera = JSON.stringify(state.camera);
      cameraTimer = window.setTimeout(() => {
        if (identity.startsWith('draft:') || state.linkMode) return;
        try { localStorage.setItem(identity, camera); } catch { /* хранилище недоступно */ }
      }, 200);
    }
    refresh();
    scheduleSave();
    syncSelectionToCollab();
    if (editing) positionEditor();
    if (ctxPanels.length) positionCtxPanels();
  });
}
