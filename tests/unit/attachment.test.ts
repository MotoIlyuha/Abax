import { describe, expect, it } from 'vitest';
import { foundationFor, withAttached } from '../../src/attachment';
import type { Element, ImageEl, NoteEl, StrokeEl } from '../../src/types';

const image: ImageEl = { id: 'image', type: 'image', x: 0, y: 0, w: 100, h: 100, src: '' };
const note: NoteEl = { id: 'note', type: 'note', x: 0, y: 0, w: 60, h: 60, text: '', color: '#fff' };
const stroke = (end: number): StrokeEl => ({ id: 'ink', type: 'stroke', tool: 'pen', color: '#000', width: 1, pts: [{ x: 0, y: 30, p: .5 }, { x: end, y: 30, p: .5 }] });

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
