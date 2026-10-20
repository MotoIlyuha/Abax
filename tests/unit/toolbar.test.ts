import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ToolId } from '../../src/types';
import {
  type ToolbarConfig, TOOL_DEFS, addGroup, combineTools, defaultToolbar, keyLabel, keyProblem, moveEntry,
  nextGroupName, renameGroup, sanitizeToolbar, setEntryHidden, setToolKey, ungroup,
} from '../../src/toolbar';

type ToolbarModule = typeof import('../../src/toolbar');

async function load(): Promise<ToolbarModule> {
  vi.resetModules();
  return import('../../src/toolbar');
}

/** Все инструменты настройки по порядку: группа — как «id[инструменты]». */
function layout(cfg: ToolbarConfig, list: 'items' | 'hidden' = 'items'): string[] {
  return cfg[list].map(it => (it.type === 'tool' ? it.id : `${it.id}[${it.tools.join(',')}]`));
}

function allTools(cfg: ToolbarConfig): ToolId[] {
  return [...cfg.items, ...cfg.hidden].flatMap(it => (it.type === 'tool' ? [it.id] : it.tools));
}

beforeEach(() => localStorage.clear());

describe('настройка по умолчанию', () => {
  it('все инструменты ровно один раз, группы как раньше', () => {
    const cfg = defaultToolbar();
    expect(allTools(cfg).sort()).toEqual(TOOL_DEFS.map(t => t.id).sort());
    expect(cfg.items.filter(it => it.type === 'group').map(g => g.id)).toEqual(['shapes', 'solids', 'pointer']);
    expect(cfg.hidden).toEqual([]);
    expect(cfg.keys.pen).toBe('KeyP');
    expect(cfg.keys.cube).toBeUndefined();
  });
});

describe('sanitizeToolbar', () => {
  it('мусор — настройка по умолчанию', () => {
    for (const raw of [null, 42, 'x', [], { items: 'нет' }]) {
      expect(allTools(sanitizeToolbar(raw)).sort()).toEqual(TOOL_DEFS.map(t => t.id).sort());
    }
  });

  it('дубли и неизвестные инструменты выкидываются, недостающие встают в свою группу', () => {
    const cfg = sanitizeToolbar({
      items: [
        { type: 'tool', id: 'pen' },
        { type: 'tool', id: 'pen' },
        { type: 'tool', id: 'magic' },
        { type: 'group', id: 'shapes', name: '  Мои фигуры  ', tools: ['rect', 'pen', 'rect', 'nope'] },
      ],
      hidden: [{ type: 'tool', id: 'eraser' }],
    });
    expect(allTools(cfg).sort()).toEqual(TOOL_DEFS.map(t => t.id).sort());
    const shapes = cfg.items.find(it => it.type === 'group' && it.id === 'shapes');
    // недостающие фигуры дописаны в существующую группу «shapes», без повторов
    expect(shapes).toMatchObject({ name: 'Мои фигуры', tools: ['rect', 'ellipse', 'triangle', 'line', 'arrow', 'poly'] });
    expect(layout(cfg, 'hidden')).toEqual(['eraser']);
    // групп «solids» и «pointer» нет — их инструменты встают на панель по одному
    expect(layout(cfg)).toContain('cube');
    expect(layout(cfg)).toContain('laser');
  });

  it('опасные и повторяющиеся id групп заменяются, пустое имя — «Группа»', () => {
    const cfg = sanitizeToolbar({
      items: [
        { type: 'group', id: 'a"]x', name: '', tools: ['pen'] },
        { type: 'group', id: 'style', name: 'С', tools: ['eraser'] },
        { type: 'group', id: 'g', name: 'Г', tools: ['text'] },
        { type: 'group', id: 'g', name: 'Г2', tools: [] },
      ],
    });
    const groups = cfg.items.filter(it => it.type === 'group');
    const ids = groups.map(g => g.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id).toMatch(/^[a-z][\w-]*$/i);
    expect(ids).not.toContain('style');
    expect(groups[0]).toMatchObject({ name: 'Группа', tools: ['pen'] });
    expect(groups[3]).toMatchObject({ name: 'Г2', tools: [] }); // пустая группа сохраняется
  });

  it('клавиши: снятая остаётся снятой, повтор и запрещённые отбрасываются, новые получают умолчание', () => {
    const cfg = sanitizeToolbar({
      items: [],
      keys: { pen: null, eraser: 'KeyP', text: 'KeyP', select: 'KeyB', note: 'Space', cube: 'Digit1' },
    });
    expect(cfg.keys.pen).toBeUndefined();
    expect(cfg.keys.eraser).toBe('KeyP');
    expect(cfg.keys.text).toBeUndefined(); // KeyP уже у ластика
    expect(cfg.keys.select).toBeUndefined(); // B — панель страниц
    expect(cfg.keys.note).toBeUndefined();
    expect(cfg.keys.cube).toBe('Digit1');
    // инструментов нет в сохранённых клавишах — у них клавиши по умолчанию
    expect(cfg.keys.rect).toBe('KeyR');
  });

  it('клавиша по умолчанию не отнимает назначенную пользователем', () => {
    const cfg = sanitizeToolbar({ items: [], keys: { cube: 'KeyR' } });
    expect(cfg.keys.cube).toBe('KeyR');
    expect(cfg.keys.rect).toBeUndefined();
  });
});

describe('клавиши', () => {
  it('подпись и проверка', () => {
    expect(keyLabel('KeyR')).toBe('R');
    expect(keyLabel('Digit7')).toBe('7');
    expect(keyProblem('KeyQ')).toBeNull();
    expect(keyProblem('Digit9')).toBeNull();
    expect(keyProblem('KeyB')).toMatch(/занята/);
    expect(keyProblem('Digit0')).toMatch(/занята/);
    expect(keyProblem('Space')).toMatch(/буква или цифра/);
    expect(keyProblem('F5')).toMatch(/буква или цифра/);
  });

  it('setToolKey: переназначение снимает клавишу у прежнего владельца', () => {
    const cfg = defaultToolbar();
    const r = setToolKey(cfg, 'pen', 'KeyR');
    expect(r.displaced).toBe('rect');
    expect(r.cfg.keys.pen).toBe('KeyR');
    expect(r.cfg.keys.rect).toBeUndefined();
    expect(cfg.keys.pen).toBe('KeyP'); // исходная не меняется
    const cleared = setToolKey(r.cfg, 'pen', null);
    expect(cleared.cfg.keys.pen).toBeUndefined();
    expect(setToolKey(cfg, 'pen', 'KeyB').cfg).toBe(cfg); // запрещённая — без изменений
  });
});

describe('операции', () => {
  it('moveEntry: перестановка на панели', () => {
    const cfg = moveEntry(defaultToolbar(), { tool: 'pan' }, { list: 'items', before: { tool: 'select' } });
    expect(layout(cfg).slice(0, 3)).toEqual(['pan', 'select', 'pen']);
    const end = moveEntry(cfg, { tool: 'pan' }, { list: 'items', before: null });
    expect(layout(end).at(-1)).toBe('pan');
  });

  it('moveEntry: инструмент в группу и из группы', () => {
    let cfg = moveEntry(defaultToolbar(), { tool: 'pen' }, { list: 'items', group: 'shapes', before: { tool: 'ellipse' } });
    expect(layout(cfg)).toContain('shapes[rect,pen,ellipse,triangle,line,arrow,poly]');
    expect(layout(cfg)).not.toContain('pen');
    cfg = moveEntry(cfg, { tool: 'rect' }, { list: 'items', before: { tool: 'select' } });
    expect(layout(cfg)[0]).toBe('rect');
    expect(layout(cfg)).toContain('shapes[pen,ellipse,triangle,line,arrow,poly]');
  });

  it('moveEntry: группа целиком в скрытые; группу в группу нельзя', () => {
    const base = defaultToolbar();
    const cfg = moveEntry(base, { group: 'solids' }, { list: 'hidden', before: null });
    expect(layout(cfg, 'hidden')).toEqual(['solids[cube,box,prism,pyramid,truncPyramid,cylinder,cone,truncCone,sphere]']);
    expect(moveEntry(base, { group: 'solids' }, { list: 'items', group: 'shapes', before: null })).toBe(base);
    expect(moveEntry(base, { tool: 'pen' }, { list: 'items', before: { tool: 'pen' } })).toBe(base);
  });

  it('combineTools: два инструмента — новая группа на месте цели', () => {
    const base = defaultToolbar();
    const r = combineTools(base, 'pen', 'eraser', 'Рисование');
    expect(r.group).toBeTruthy();
    expect(layout(r.cfg).slice(0, 5)).toEqual(['select', 'pan', `${r.group}[pen,eraser]`, 'highlighter', 'text']);
    expect(r.cfg.items.find(it => it.type === 'group' && it.id === r.group)).toMatchObject({ name: 'Рисование' });
    // из группы тоже можно
    const r2 = combineTools(base, 'select', 'ellipse', 'Г');
    expect(layout(r2.cfg)[0]).toBe(`${r2.group}[select,ellipse]`);
    expect(layout(r2.cfg)).toContain('shapes[rect,triangle,line,arrow,poly]');
    // с самим собой и с инструментом внутри группы — нет
    expect(combineTools(base, 'pen', 'pen', 'x').group).toBeNull();
    expect(combineTools(base, 'rect', 'pen', 'x').group).toBeNull();
  });

  it('addGroup, renameGroup, nextGroupName', () => {
    const base = defaultToolbar();
    expect(nextGroupName(base)).toBe('Группа 1');
    const r = addGroup(base, nextGroupName(base));
    expect(r.cfg.items.at(-1)).toEqual({ type: 'group', id: r.group, name: 'Группа 1', tools: [] });
    expect(nextGroupName(r.cfg)).toBe('Группа 2');
    const renamed = renameGroup(r.cfg, r.group, '  Моя  ');
    expect(renamed.items.at(-1)).toMatchObject({ name: 'Моя' });
    expect(renameGroup(renamed, r.group, '   ')).toBe(renamed); // пустое имя не принимается
    expect(renameGroup(renamed, r.group, 'x'.repeat(100)).items.at(-1)).toMatchObject({ name: 'x'.repeat(40) });
  });

  it('ungroup: инструменты группы встают на её место', () => {
    const cfg = ungroup(defaultToolbar(), 'pointer');
    expect(layout(cfg).slice(-3)).toEqual(['laser', 'fadePen', 'flash']);
    const empty = addGroup(defaultToolbar(), 'Пусто');
    expect(ungroup(empty.cfg, empty.group).items.some(it => it.type === 'group' && it.id === empty.group)).toBe(false);
  });

  it('setEntryHidden: скрыть и вернуть', () => {
    let cfg = setEntryHidden(defaultToolbar(), { tool: 'ellipse' }, true);
    expect(layout(cfg, 'hidden')).toEqual(['ellipse']);
    expect(layout(cfg)).toContain('shapes[rect,triangle,line,arrow,poly]');
    expect(setEntryHidden(cfg, { tool: 'ellipse' }, true)).toBe(cfg);
    cfg = setEntryHidden(cfg, { tool: 'ellipse' }, false);
    expect(layout(cfg).at(-1)).toBe('ellipse');
    cfg = setEntryHidden(cfg, { group: 'shapes' }, true);
    expect(layout(cfg, 'hidden')).toEqual(['shapes[rect,triangle,line,arrow,poly]']);
  });
});

describe('текущая настройка', () => {
  it('сохраняется в localStorage и восстанавливается', async () => {
    const m = await load();
    m.restoreToolbar();
    const seen = vi.fn();
    m.onToolbarChange(seen);
    const r = m.setToolKey(m.toolbarConfig(), 'cube', 'KeyQ');
    m.setToolbarConfig(m.setToolKey(m.setEntryHidden(r.cfg, { tool: 'pen' }, true), 'pen', null).cfg);
    expect(seen).toHaveBeenCalledTimes(1);
    expect(m.toolByKey('KeyQ')).toBe('cube');
    expect(m.toolByKey('KeyP')).toBeNull();
    expect(m.toolTip('cube')).toBe('Куб (Q)');
    expect(m.toolTip('pen')).toBe('Перо');

    const again = await load();
    again.restoreToolbar();
    expect(again.toolByKey('KeyQ')).toBe('cube');
    expect(again.toolByKey('KeyP')).toBeNull(); // снятая клавиша не вернулась к умолчанию
    expect(layout(again.toolbarConfig(), 'hidden')).toEqual(['pen']);
  });

  it('битое значение в localStorage — настройка по умолчанию', async () => {
    localStorage.setItem('doska.toolbar', '{oops');
    const m = await load();
    m.restoreToolbar();
    expect(m.toolByKey('KeyV')).toBe('select');
    expect(layout(m.toolbarConfig())).toEqual(layout(defaultToolbar()));
  });

  it('та же настройка — без уведомления и записи', async () => {
    const m = await load();
    const seen = vi.fn();
    m.onToolbarChange(seen);
    m.setToolbarConfig(m.toolbarConfig());
    expect(seen).not.toHaveBeenCalled();
    expect(localStorage.getItem('doska.toolbar')).toBeNull();
  });
});
