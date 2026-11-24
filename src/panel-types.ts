// Типы режимов правой боковой панели (SPEC_CHAT §5): каркас — src/side-panel.ts, содержимое — модули режимов.
export type PanelMode = 'notify' | 'history' | 'help' | 'import' | 'export' | 'tasks';
/** Вид режима, смонтированный в контейнер панели. */
export interface PanelView {
  /** Режим показан (панель открыта на нём) — обновить содержимое. */
  show?(): void;
  /** Режим скрыт (другой режим или панель закрыта). */
  hide?(): void;
  /** Кнопки действий режима для правой части шапки панели (необязательно). */
  actions?: HTMLElement;
  /** Куда поставить фокус при открытии. */
  focus?(): void;
}
export interface PanelModeDef {
  id: PanelMode; label: string; icon: string; mount(host: HTMLElement): PanelView;
  /** Режим по подписке: пока закрыт тарифом — в переключателе бейдж Pro, выбор открывает окно подписки. */
  pro?: import('./pro-badge').ProFeature;
  /** Отдельная левая панель, не включённая в переключатель режимов. */
  side?: 'left';
  /** Кнопка отдельной панели; получает фокус при закрытии. */
  trigger?: HTMLButtonElement;
  /** Подпись рядом с названием отдельной панели. */
  badge?: string;
}
