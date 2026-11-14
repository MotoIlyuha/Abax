/** Стереометрические тела (id инструмента совпадает с видом тела). */
export type SolidKind =
  | 'cube' | 'box' | 'prism' | 'pyramid' | 'truncPyramid'
  | 'cylinder' | 'cone' | 'truncCone' | 'sphere';

export type ToolId =
  | 'select' | 'pen' | 'highlighter' | 'eraser' | 'partEraser' | 'pan'
  | 'text' | 'note' | 'spread' | 'rect' | 'ellipse' | 'triangle' | 'line' | 'arrow' | 'poly'
  | PointerKind
  | SolidKind;

/** Инструменты группы «Указка»: ничего не оставляют на доске. */
export type PointerKind = 'laser' | 'fadePen' | 'flash';

/** Общие поля всех элементов доски. */
export interface BaseEl {
  id: string;
  /** Идентификатор группы, если элемент сгруппирован. */
  groupId?: string;
  /** Реакции: эмодзи → id пользователей, поставивших её. */
  reactions?: Record<string, string[]>;
}

/** Точка в координатах сцены; p — давление 0..1 (мышь даёт 0.5). */
export interface Pt { x: number; y: number; p: number }

export interface StrokeEl extends BaseEl {
  type: 'stroke';
  tool: 'pen' | 'highlighter';
  color: string;
  /** Базовая толщина в юнитах сцены (умножается на давление при рендере). */
  width: number;
  /** Непрозрачность 0..1; нет поля — непрозрачный. */
  opacity?: number;
  pts: Pt[];
  /**
   * Основа, на которой нарисован штрих: id картинки, стикера или фигуры; null — вне основы.
   * Нет поля у старых проектов — привязка фиксируется при открытии (см. attachment.ts).
   */
  baseId?: string | null;
}

/** Выравнивание надписи в фигуре по горизонтали и по вертикали. */
export type TextAlign = 'left' | 'center' | 'right';
export type TextVAlign = 'top' | 'middle' | 'bottom';

export interface ShapeEl extends BaseEl {
  type: 'shape';
  shape: 'rect' | 'ellipse' | 'triangle' | 'line' | 'arrow';
  /** x,y — якорь; w,h — смещения (для линии/стрелки могут быть отрицательными). */
  x: number; y: number; w: number; h: number;
  color: string;
  /** Цвет заливки; отсутствие означает прозрачную заливку. */
  fill?: string;
  /** Непрозрачность заливки; старые фигуры наследуют opacity. */
  fillOpacity?: number;
  width: number;
  opacity?: number;
  /** Поворот вокруг центра в радианах (только rect/ellipse/triangle). */
  rot?: number;
  /** Радиус скругления углов в юнитах сцены (только rect). */
  radius?: number;
  /** Надпись внутри фигуры (только rect/ellipse/triangle). */
  text?: string;
  /** Кегль надписи; нет поля — подбирается под размер фигуры. */
  textSize?: number;
  bold?: boolean;
  italic?: boolean;
  /** Выравнивание надписи; нет поля — по центру. */
  align?: TextAlign;
  valign?: TextVAlign;
}

/** Ломаная: открытая или замкнутая (контур). */
export interface PolyEl extends BaseEl {
  type: 'poly';
  closed: boolean;
  color: string;
  width: number;
  opacity?: number;
  pts: Pt[];
}

export interface TextEl extends BaseEl {
  type: 'text';
  /** x,y — левый верхний угол текстового блока. */
  x: number; y: number;
  text: string;
  /** Заданная ширина текстового блока; без неё ширина определяется содержимым. */
  w?: number;
  size: number;
  color: string;
  opacity?: number;
  bold?: boolean;
  italic?: boolean;
}
export interface NoteEl extends BaseEl {
  type: 'note';
  x: number; y: number; w: number; h: number;
  text: string;
  color: string;
  /**
   * Основа, на которой поставлен стикер: id картинки; null — вне основы.
   * Нет поля у старых проектов — привязка фиксируется при открытии (см. attachment.ts).
   */
  baseId?: string | null;
}

/** Импортированная страница PDF или картинка — фон для аннотирования. */
export interface ImageEl extends BaseEl {
  type: 'image';
  x: number; y: number; w: number; h: number;
  /** data:image/jpeg;base64,... или data:image/png;base64,... */
  src: string;
  /** Видимая область исходного изображения в долях его размера. */
  crop?: { x: number; y: number; w: number; h: number };
  /** Поворот вокруг центра в радианах. */
  rot?: number;
  /** Рамка: цвет, толщина и непрозрачность; без цвета рамки нет. */
  color?: string;
  width?: number;
  opacity?: number;
  /** Радиус скругления углов (картинка обрезается вместе с рамкой). */
  radius?: number;
  /**
   * Страница на холсте (раздел «Экспериментальные»): вместо картинки — превью страницы проекта с этим id,
   * клик по нему переходит на неё (src пустой). Не поворачивается: переход приближением был бы не бесшовным.
   */
  page?: string;
}

/**
 * Стереометрическое тело — каркасная модель: невидимые рёбра рисуются пунктиром.
 * Многогранники — в кабинетной проекции (глубина под 45° с сокращением 0.5),
 * тела вращения — с основаниями-эллипсами, как в школьных учебниках.
 */
export interface SolidEl extends BaseEl {
  type: 'solid';
  solid: SolidKind;
  /**
   * Якорь в сцене: у многогранников — передний левый нижний угол (3D-начало координат),
   * у тел вращения — центр нижнего основания, у шара — центр.
   */
  x: number; y: number;
  /** Ширина (у тел вращения — диаметр основания). */
  w: number;
  /** Глубина: у многогранников — истинная (рисуется с сокращением), у тел вращения — высота эллипса основания. */
  d: number;
  /** Высота тела. */
  h: number;
  /** Число сторон основания призмы/пирамиды. */
  n?: number;
  /** Отношение верхнего основания к нижнему (усечённые пирамида и конус), 0..1. */
  t?: number;
  color: string;
  width: number;
  opacity?: number;
}

/** Попытка ученика ответить на задание. */
export interface TaskAttempt {
  value: string;
  timestamp: number;
  isCorrect: boolean;
}

export type TaskExamType = 'oge' | 'ege_base' | 'ege_prof' | 'vpr' | 'custom';
export type TaskSubject = 'math' | 'physics' | 'informatics' | 'other';

/** Интерактивное задание ОГЭ/ЕГЭ (Abax Tutor): условие, ответ и попытки ученика. */
export interface TaskEl extends BaseEl {
  type: 'task';
  x: number; y: number; w: number; h: number;
  taskId: string;
  examType: TaskExamType;
  topic: string;
  statementMd: string;
  /** Правильный ответ; несколько допустимых — через «|». Ученику не отправляется. */
  answer: string;
  solutionMd?: string;
  /** Текущий ввод ученика в реальном времени. */
  studentDraft?: string;
  attempts?: TaskAttempt[];
  /** Помечено репетитором как сложное для повторения. */
  markedHard?: boolean;
  /** Показывать ли решение ученику. */
  solutionVisibleToStudent?: boolean;
  /** Предмет; нет поля — математика. */
  subject?: TaskSubject;
  /** Единицы измерения ответа (физика): «м/с», «кДж». */
  answerUnit?: string;
  /** Фрагмент кода (информатика). */
  codeSnippet?: { lang: 'python' | 'cpp' | 'text'; code: string };
}

export type Element = (StrokeEl | ShapeEl | PolyEl | TextEl | NoteEl | ImageEl | SolidEl | TaskEl) & {
  /** Закрепление относительно обычных слоёв. */
  layerPin?: 'top' | 'bottom';
};

/** Экран = (сцена - камера) * zoom. */
export interface Camera { x: number; y: number; zoom: number }

/** Страница — один холст: свой фон и набор элементов. */
export interface Page {
  id: string;
  name: string;
  grid: GridMode;
  backgroundColor?: string;
  elements: Element[];
  /** Ветки комментариев к странице. */
  comments?: CommentThread[];
}

export interface CommentMessage {
  id: string;
  authorId: string;
  authorName: string;
  text: string;
  createdAt: number;
}

export interface CommentThread {
  id: string;
  x: number;
  y: number;
  /** Если привязан к элементу доски — двигается вместе с ним. */
  targetElementId?: string;
  resolved?: boolean;
  messages: CommentMessage[];
}

/** Тариф владельца проекта. */
export type PlanTier = 'free' | 'pro' | 'tutor';

/** Право на страницу для ссылки совместной работы. */
export type PageRight = 'edit' | 'view' | 'hidden';

export interface ProjectPermissions {
  /** Запретить клонирование проекта по ссылке просмотра (Pro/Tutor). */
  forbidClone?: boolean;
  /** Разрешить читателям выделять и копировать элементы (нет поля — разрешено). */
  allowCopy?: boolean;
  /** Права по страницам для ссылки совместной работы (pageId → право). */
  pageRights?: Record<string, PageRight>;
}

/** Проект — набор страниц. */
export interface Project {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  pages: Page[];
  /** Закреплён в избранном на домашней странице. */
  pinned?: boolean;
  /** Иконка рядом с названием: эмодзи или загруженная картинка (data:image/…). */
  icon?: string;
  /** Тариф владельца; нет поля — free. */
  ownerPlan?: PlanTier;
  permissions?: ProjectPermissions;
}

export interface ProjectMeta {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  pageCount: number;
  pinned?: boolean;
  icon?: string;
}

export type GridMode = 'none' | 'dots' | 'square' | 'coord';

/**
 * Точка лазерной указки в экранных координатах с меткой времени.
 * Экранных, а не сцены: при масштабировании след не раздувается вместе с доской.
 */
export interface LaserPt { x: number; y: number; t: number }

/** Росчерк исчезающего маркера; endT — когда оторвали перо (с этого момента гаснет). */
export interface FadeStroke { color: string; width: number; opacity?: number; pts: Pt[]; endT: number | null }

/** Кратковременная подсветка контура элементов; t — момент начала, ms — длительность (нет — по умолчанию). */
export interface Flash { ids: string[]; t: number; ms?: number }

/** Ручка редактирования выделенного элемента. */
export type Handle =
  | { kind: 'end'; i: 0 | 1 }
  | { kind: 'node'; i: number }
  | { kind: 'insert'; i: number }
  | { kind: 'resize'; dx: -1 | 0 | 1; dy: -1 | 0 | 1 }
  | { kind: 'rotate' }
  /** Параметр тела: a — ребро куба (меняет w, d, h разом). */
  | { kind: 'param'; key: 'w' | 'd' | 'h' | 't' | 'a' };

/** Направляющая выравнивания: axis 'x' — вертикальная линия x = at (от y = from до y = to), 'y' — горизонтальная. */
export interface Guide { axis: 'x' | 'y'; at: number; from: number; to: number }

/** from — начало направляющей (высота, радиус), которую рисуем к ручке. */
export interface HandlePos { h: Handle; x: number; y: number; from?: { x: number; y: number } }

/** Позиция панели инструментов. */
export type ToolbarPos = 'left' | 'right' | 'top' | 'bottom';

/** Поведение колёсика мыши: прокрутка холста или масштаб (как в Figma). */
export type WheelMode = 'scroll' | 'zoom';

/** Анимация перехода на другую страницу. */
export type PageTransition = 'none' | 'slide' | 'fade' | 'zoom';

/** Модификатор перехода на страницу по номеру: Ctrl+1…9 или Alt+1…9. */
export type PageKeyMod = 'ctrl' | 'alt';

export interface BoardSettings {
  toolbarPos: ToolbarPos;
  /** Подписи делений на координатной плоскости. */
  coordLabels: boolean;
  /** Привязка перемещения/размеров к видимому шагу сетки. */
  snapToGrid: boolean;
  /** Колёсико без модификаторов: прокрутка или масштаб. */
  wheelMode: WheelMode;
  pageTransition: PageTransition;
  pageKeyMod: PageKeyMod;
  mouseMode: 'pages' | 'history' | 'custom';
  mouseBindings: Record<'1' | '3' | '4', { action: string; label: string } | null>;
  /** Сочетание «новая страница» («Ctrl+KeyN», см. hotkeys.ts); null — без сочетания. */
  newPageKey: string | null;
  /** Плавное появление меню и панелей (кроме плавающего меню выделения). */
  uiAnimations: boolean;
  /** Скрыть кнопки «Отменить» и «Повторить» в шапке (Ctrl+Z / Ctrl+Y работают). */
  hideUndoRedo: boolean;
  /** Изображения (и страницы PDF) меняют размер только пропорционально — без Shift и Ctrl. */
  keepImageAspect: boolean;
  /** Направляющие выравнивания по соседним объектам при переносе и изменении размера (с примагничиванием). */
  alignGuides: boolean;
  /** Список страниц закрывается, когда в нём выбрали страницу. */
  closePagesOnPick: boolean;
  /** На превью текущей страницы — рамка видимой сейчас области (цветом курсора). */
  thumbViewport: boolean;
  /** Экспериментальное: страницу из списка можно перетащить на холст — ссылкой на неё. */
  pageLinks: boolean;
  /** Показывать вложенные страницы вместо пасхалки при самоссылке. */
  recursionEnabled: boolean;
}
