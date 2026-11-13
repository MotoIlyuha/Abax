import { describe, expect, it } from 'vitest';
import {
  attachNewElement, foundationFor, freezeAttachments, geometricFoundationFor, rebindAttachment, reattachMoved, withAttached,
} from '../../src/attachment';
import type { Element, ImageEl, NoteEl, StrokeEl } from '../../src/types';

const image: ImageEl = { id: 'image', type: 'image', x: 0, y: 0, w: 100, h: 100, src: '' };
const note: NoteEl = { id: 'note', type: 'note', x: 0, y: 0, w: 60, h: 60, text: '', color: '#fff' };
const stroke = (end: number, id = 'ink'): StrokeEl =>
  ({ id, type: 'stroke', tool: 'pen', color: '#000', width: 1, pts: [{ x: 0, y: 30, p: .5 }, { x: end, y: 30, p: .5 }] });
const shifted = (id: string, dx: number): StrokeEl =>
  ({ ...stroke(50, id), pts: [{ x: dx, y: 30, p: .5 }, { x: dx + 50, y: 30, p: .5 }] });

describe('automatic attachments', () => {
  it('uses the length of a stroke and the two-thirds threshold', () => {
    expect(foundationFor(stroke(90), [note])?.id).toBe('note');
    expect(foundationFor(stroke(100), [note])).toBeUndefined();
  });
  it('only attaches to foundations below the item', () => {
    const ink = stroke(50);
    expect(foundationFor(ink, [ink, note])).toBeUndefined();
    expect(foundationFor(ink, [note, ink])?.id).toBe('note');
    expect(withAttached(new Set(['note']), [ink, note]).has('ink')).toBe(false);
  });
  it('attaches notes only to images and follows nested attachments', () => {
    const elements: Element[] = [image, note, stroke(50)];
    expect(foundationFor(note, elements)?.id).toBe('image');
    expect([...withAttached(new Set(['image']), elements)]).toEqual(['image', 'note', 'ink']);
  });
});

describe('recorded attachments', () => {
  it('uses the recorded foundation instead of the current overlap', () => {
    const ink: StrokeEl = { ...shifted('ink', 300), baseId: 'image' };
    expect(foundationFor(ink, [image, ink])?.id).toBe('image');
    expect([...withAttached(new Set(['image']), [image, ink])]).toEqual(['image', 'ink']);
  });

  it('does not attach a stroke drawn outside when an image slides under it', () => {
    // Перо геометрически лежит на картинке, но нарисовано было вне её.
    const ink: StrokeEl = { ...stroke(90), baseId: null };
    expect(geometricFoundationFor(ink, [image, ink])?.id).toBe('image');
    expect(foundationFor(ink, [image, ink])).toBeUndefined();
    expect([...withAttached(new Set(['image']), [image, ink])]).toEqual(['image']);
  });

  it('remembers the foundation of a new stroke or note', () => {
    expect(attachNewElement(stroke(50), [image])).toMatchObject({ baseId: 'image' });
    expect(attachNewElement(shifted('far', 300), [image])).toMatchObject({ baseId: null });
    expect(attachNewElement(note, [image])).toMatchObject({ baseId: 'image' });
    expect(attachNewElement({ ...note, id: 'far', x: 300 }, [image])).toMatchObject({ baseId: null });
  });

  it('recomputes the foundation after the annotation itself moves', () => {
    const away = shifted('ink', 300);
    away.baseId = 'image';
    expect(reattachMoved(new Set(['ink']), [image, away], new Set(['ink']))[1]).toMatchObject({ baseId: null });

    const onto: StrokeEl = { ...stroke(50), baseId: null };
    expect(reattachMoved(new Set(['ink']), [image, onto], new Set(['ink']))[1]).toMatchObject({ baseId: 'image' });
  });

  it('keeps the foundation when it moves together with the annotation', () => {
    const ink: StrokeEl = { ...shifted('ink', 300), baseId: 'image' };
    const elements: Element[] = [image, ink];
    expect(reattachMoved(new Set(['ink']), elements, new Set(['image', 'ink']))).toBe(elements);
    expect(ink.baseId).toBe('image');
  });

  it('does not attach annotations to a foundation that is moving along with them', () => {
    const ink: StrokeEl = { ...stroke(50), baseId: null };
    const elements: Element[] = [image, ink];
    expect(reattachMoved(new Set(['ink']), elements, new Set(['image', 'ink']))).toBe(elements);
    expect(ink.baseId).toBeNull();
  });

  it('rebinds a copied attachment to the copied foundation or detaches it', () => {
    const ink: StrokeEl = { ...stroke(50), baseId: 'image' };
    const both = new Map([['image', 'image-2'], ['ink', 'ink-2']]);
    expect(rebindAttachment(ink, both)).toMatchObject({ baseId: 'image-2' });
    expect(rebindAttachment(ink, new Map([['ink', 'ink-2']]))).toMatchObject({ baseId: null });
  });

  it('freezes legacy attachments once by their current position', () => {
    const explicit: StrokeEl = { ...stroke(50, 'old'), baseId: null };
    const elements: Element[] = [image, note, stroke(50, 'on-note'), shifted('outside', 300), explicit];
    const out = freezeAttachments(elements);
    expect(out[1]).toMatchObject({ baseId: 'image' });
    expect(out[2]).toMatchObject({ baseId: 'note' });
    expect(out[3]).toMatchObject({ baseId: null });
    // уже зафиксированную (в том числе пустую) привязку миграция не трогает
    expect(out[4]).toBe(explicit);
  });
});
