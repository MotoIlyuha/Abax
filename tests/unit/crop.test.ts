import { describe, expect, it } from 'vitest';
import { cropResizeModifiers } from '../../src/crop';

describe('модификаторы рамки кадрирования', () => {
  const original = {x:20,y:20,w:100,h:50};
  const image = {x:0,y:0,w:200,h:200};
  it('Alt изменяет рамку от центра', () => {
    expect(cropResizeModifiers(original,{l:20,r:100,t:20,b:70},1,0,false,true,image)).toEqual({l:40,r:100,t:20,b:70});
  });
  it('Shift и Ctrl сохраняют пропорции, включая боковые ручки', () => {
    expect(cropResizeModifiers(original,{l:20,r:80,t:20,b:70},1,0,true,false,image)).toEqual({l:20,r:80,t:30,b:60});
  });
  it('Alt и Shift вместе ограничиваются границами исходника', () => {
    const box=cropResizeModifiers(original,{l:20,r:180,t:20,b:70},1,0,true,true,image);
    expect((box.r-box.l)/(box.b-box.t)).toBeCloseTo(2);
    expect(box.t).toBeGreaterThanOrEqual(image.y);
    expect((box.l+box.r)/2).toBe(70);
  });
});
