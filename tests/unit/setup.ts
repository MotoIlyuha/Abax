// jsdom не реализует canvas: подставляем минимальный 2D-контекст и Path2D.
// measureText — моноширинная модель (0.5em на символ): достаточно для проверки
// раскладки текста без нативной зависимости canvas.

class FakePath2D {
  ops: [string, ...number[]][] = [];
  moveTo(x: number, y: number) { this.ops.push(['moveTo', x, y]); }
  lineTo(x: number, y: number) { this.ops.push(['lineTo', x, y]); }
  arc(x: number, y: number, r: number, a0: number, a1: number, ccw?: boolean) {
    this.ops.push(['arc', x, y, r, a0, a1, ccw ? 1 : 0]);
  }
  closePath() { this.ops.push(['closePath']); }
}

function fontSize(font: string): number {
  const m = /(\d+(?:\.\d+)?)px/.exec(font);
  return m ? Number(m[1]) : 10;
}

function fakeContext(): Record<string, unknown> {
  const ctx: Record<string, unknown> = {
    font: '10px sans-serif',
    measureText(text: string) {
      return { width: text.length * fontSize(ctx.font as string) * 0.5 };
    },
  };
  return new Proxy(ctx, {
    get(target, key) {
      if (key in target) return target[key as string];
      return () => undefined; // любые методы рисования — no-op
    },
    set(target, key, value) {
      target[key as string] = value;
      return true;
    },
  });
}

Object.defineProperty(globalThis, 'Path2D', { value: FakePath2D, writable: true, configurable: true });
HTMLCanvasElement.prototype.getContext = function getContext() {
  return fakeContext() as unknown as CanvasRenderingContext2D;
} as unknown as typeof HTMLCanvasElement.prototype.getContext;

export {};
