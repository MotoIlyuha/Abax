// Типы режимов правой боковой панели (SPEC_CHAT §5): каркас — src/side-panel.ts, содержимое — модули режимов.
export type PanelMode = 'notify' | 'history' | 'help' | 'import' | 'export';
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
export interface PanelModeDef { id: PanelMode; label: string; icon: string; mount(host: HTMLElement): PanelView }
