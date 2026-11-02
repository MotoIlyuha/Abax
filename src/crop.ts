import type { ImageEl } from './types';
import { state, pushHistory, replaceElements, update } from './state';
import { alignGuides, alignShift, elementAABB } from './geom';

export function cropResizeModifiers(original: {x:number;y:number;w:number;h:number}, edges: {l:number;r:number;t:number;b:number}, dx:number, dy:number, proportional:boolean, fromCenter:boolean, image: {x:number;y:number;w:number;h:number}) {
  let {l,r,t,b}=edges;
  const cx=original.x+original.w/2, cy=original.y+original.h/2;
  if (fromCenter) {
    if (dx) { const half=Math.max(0,dx<0?cx-l:r-cx); l=cx-half; r=cx+half; }
    if (dy) { const half=Math.max(0,dy<0?cy-t:b-cy); t=cy-half; b=cy+half; }
  }
  if (proportional) {
    const scale=dx===0?(b-t)/original.h:dy===0?(r-l)/original.w:Math.max((r-l)/original.w,(b-t)/original.h);
    const w=original.w*scale,h=original.h*scale;
    if(fromCenter || !dx) { l=cx-w/2; r=cx+w/2; } else if(dx>0) r=l+w; else l=r-w;
    if(fromCenter || !dy) { t=cy-h/2; b=cy+h/2; } else if(dy>0) b=t+h; else t=b-h;
  }
  // Останавливаем все стороны одновременно на границе исходного изображения.
  let factor=1;
  for (const [start,end,min,max] of [[original.x,l,image.x,image.x+image.w],[original.x+original.w,r,image.x,image.x+image.w],[original.y,t,image.y,image.y+image.h],[original.y+original.h,b,image.y,image.y+image.h]]) {
    if(end<min) factor=Math.min(factor,(min-start)/(end-start));
    if(end>max) factor=Math.min(factor,(max-start)/(end-start));
  }
  return {l:original.x+(l-original.x)*factor,r:original.x+original.w+(r-original.x-original.w)*factor,t:original.y+(t-original.y)*factor,b:original.y+original.h+(b-original.y-original.h)*factor};
}

/** Редактор держит геометрию исходника и рамки отдельно; пиксели исходника не меняются. */
export function startCrop(el: ImageEl): void {
  if (document.querySelector('.crop-overlay')) return;
  const wrap = document.getElementById('canvas-wrap')!;
  const initialPage = state.pageId;
  const z = state.camera.zoom;
  const original = el.crop ?? { x: 0, y: 0, w: 1, h: 1 };
  let frame = { x: 0, y: 0, w: el.w, h: el.h };
  let image = { x: -original.x * el.w / original.w, y: -original.y * el.h / original.h, w: el.w / original.w, h: el.h / original.h };
  const angle = el.rot ?? 0, cos = Math.cos(angle), sin = Math.sin(angle);
  const cx = el.x + el.w / 2, cy = el.y + el.h / 2;
  const overlay = document.createElement('div');
  overlay.className = 'crop-overlay';
  overlay.style.cssText = 'position:absolute;inset:0;z-index:200;touch-action:none;overflow:hidden;';
  const plane = document.createElement('div');
  plane.style.cssText = `position:absolute;left:${(cx-state.camera.x)*z}px;top:${(cy-state.camera.y)*z}px;width:0;height:0;transform:rotate(${angle}rad);`;
  const dim = document.createElement('img');
  dim.src = el.src; dim.draggable = false;
  dim.style.cssText = 'position:absolute;max-width:none;filter:brightness(.4);pointer-events:none;';
  const box = document.createElement('div');
  box.className = 'crop-frame';
  box.style.cssText = 'position:absolute;box-sizing:border-box;border:2px solid white;outline:1px solid #3678ff;cursor:move;touch-action:none;';
  const clip = document.createElement('div');
  clip.style.cssText = 'position:absolute;inset:0;overflow:hidden;pointer-events:none;';
  const bright = document.createElement('img');
  bright.src = el.src; bright.draggable = false;
  bright.style.cssText = 'position:absolute;max-width:none;';
  clip.appendChild(bright); box.appendChild(clip); plane.append(dim, box); overlay.appendChild(plane);
  const panel = document.createElement('div');
  panel.className = 'crop-presets';
  panel.style.cssText = `position:absolute;left:${Math.min(wrap.clientWidth-115,(cx-state.camera.x+el.w/2)*z+20)}px;top:${Math.max(8,(cy-state.camera.y-el.h/2)*z)}px;display:flex;flex-direction:column;gap:4px;background:white;padding:8px;border-radius:8px;box-shadow:0 2px 12px #0003;`;
  for (const [label, ratio] of [['1:1',1],['4:3',4/3],['3:2',3/2],['16:9',16/9],['9:16',9/16]] as const) {
    const button = document.createElement('button'); button.type = 'button'; button.className = 'crop-preset';
    const iconW = ratio >= 1 ? 20 : 20 * ratio;
    const iconH = ratio >= 1 ? 20 / ratio : 20;
    button.innerHTML = `<svg aria-hidden="true" viewBox="0 0 24 24" width="24" height="24"><rect x="${(24-iconW)/2}" y="${(24-iconH)/2}" width="${iconW}" height="${iconH}" rx="1" fill="none" stroke="currentColor" stroke-width="1.5"/></svg><span>${label}</span>`;
    button.addEventListener('click', () => {
      let w = frame.w, h = w / ratio;
      if (h > frame.h) { h = frame.h; w = h * ratio; }
      frame = { x: frame.x+(frame.w-w)/2, y: frame.y+(frame.h-h)/2, w, h }; paint();
    }); panel.appendChild(button);
  }
  overlay.appendChild(panel); wrap.appendChild(overlay);
  for (const [dx,dy] of [[-1,-1],[0,-1],[1,-1],[-1,0],[1,0],[-1,1],[0,1],[1,1]]) {
    const h = document.createElement('div'); h.className = 'crop-handle'; h.dataset.dx = String(dx); h.dataset.dy = String(dy);
    h.style.cssText = `position:absolute;left:${(dx+1)*50}%;top:${(dy+1)*50}%;width:12px;height:12px;background:white;border:1px solid #3678ff;border-radius:2px;transform:translate(-50%,-50%);cursor:${dx===0?'ns':dy===0?'ew':dx===dy?'nwse':'nesw'}-resize;touch-action:none;`;
    box.appendChild(h);
  }
  const setRect = (node: HTMLElement, x: number, y: number, w: number, h: number) => { node.style.left=`${x*z}px`; node.style.top=`${y*z}px`; node.style.width=`${w*z}px`; node.style.height=`${h*z}px`; };
  function paint(): void {
    setRect(dim,image.x-el.w/2,image.y-el.h/2,image.w,image.h);
    setRect(box,frame.x-el.w/2,frame.y-el.h/2,frame.w,frame.h);
    setRect(bright,image.x-frame.x-2/z,image.y-frame.y-2/z,image.w,image.h);
  }
  function point(e: PointerEvent): {x:number;y:number} {
    const r=wrap.getBoundingClientRect(), x=(e.clientX-r.left)/z+state.camera.x-cx, y=(e.clientY-r.top)/z+state.camera.y-cy;
    return {x: x*cos+y*sin+el.w/2, y: -x*sin+y*cos+el.h/2};
  }
  function constrainImage(): void {
    image.x=Math.min(frame.x,Math.max(frame.x+frame.w-image.w,image.x));
    image.y=Math.min(frame.y,Math.max(frame.y+frame.h-image.h,image.y));
  }
  function zoom(factor:number): void {
    const min=Math.max(frame.w/image.w,frame.h/image.h);
    factor=Math.max(min,Math.min(20,factor));
    const x=frame.x+frame.w/2,y=frame.y+frame.h/2;
    image={x:x+(image.x-x)*factor,y:y+(image.y-y)*factor,w:image.w*factor,h:image.h*factor}; constrainImage(); paint();
  }
  let drag: { id:number; x:number; y:number; dx:number; dy:number; frame:typeof frame; image:typeof image } | null = null;
  const touches = new Map<number,{x:number;y:number}>(); let pinch = 0;
  overlay.addEventListener('pointerdown', e => {
    e.stopPropagation();
    if (panel.contains(e.target as Node)) return;
    if (!box.contains(e.target as Node)) { finish(true); return; }
    e.preventDefault(); overlay.setPointerCapture(e.pointerId);
    touches.set(e.pointerId,{x:e.clientX,y:e.clientY});
    if (touches.size===2) { const a=[...touches.values()]; pinch=Math.hypot(a[0].x-a[1].x,a[0].y-a[1].y); drag=null; return; }
    const p=point(e), target=e.target as HTMLElement;
    drag={id:e.pointerId,x:p.x,y:p.y,dx:Number(target.dataset.dx ?? 0),dy:Number(target.dataset.dy ?? 0),frame:{...frame},image:{...image}};
  });
  overlay.addEventListener('pointermove', e => {
    if (touches.has(e.pointerId)) touches.set(e.pointerId,{x:e.clientX,y:e.clientY});
    if (touches.size===2) { const a=[...touches.values()], d=Math.hypot(a[0].x-a[1].x,a[0].y-a[1].y); if(pinch) zoom(d/pinch); pinch=d; return; }
    if (!drag || drag.id!==e.pointerId) return;
    const p=point(e), dx=p.x-drag.x, dy=p.y-drag.y, f=drag.frame;
    if (!drag.dx && !drag.dy) { image={...drag.image,x:drag.image.x+dx,y:drag.image.y+dy}; constrainImage(); paint(); return; }
    let l=f.x, r=f.x+f.w, t=f.y, b=f.y+f.h;
    if(drag.dx<0) l=Math.max(image.x,Math.min(r-10/z,f.x+dx));
    if(drag.dx>0) r=Math.min(image.x+image.w,Math.max(l+10/z,f.x+f.w+dx));
    if(drag.dy<0) t=Math.max(image.y,Math.min(b-10/z,f.y+dy));
    if(drag.dy>0) b=Math.min(image.y+image.h,Math.max(t+10/z,f.y+f.h+dy));
    if (state.settings.alignGuides && !angle) {
      const others=state.board.elements.filter(e=>e.id!==el.id).map(elementAABB), tol=6/z;
      const sx=drag.dx ? alignShift([el.x+(drag.dx<0?l:r)],others,'x',tol) : null;
      const sy=drag.dy ? alignShift([el.y+(drag.dy<0?t:b)],others,'y',tol) : null;
      if(sx!==null) { if(drag.dx<0 && l+sx>=image.x && l+sx<r-10/z) l+=sx; else if(drag.dx>0 && r+sx<=image.x+image.w && r+sx>l+10/z) r+=sx; }
      if(sy!==null) { if(drag.dy<0 && t+sy>=image.y && t+sy<b-10/z) t+=sy; else if(drag.dy>0 && b+sy<=image.y+image.h && b+sy>t+10/z) b+=sy; }
      const bounds={x0:el.x+l,x1:el.x+r,y0:el.y+t,y1:el.y+b};
      state.guides=[...alignGuides(bounds,drag.dx?[el.x+(drag.dx<0?l:r)]:[],others,'x',tol*.05),...alignGuides(bounds,drag.dy?[el.y+(drag.dy<0?t:b)]:[],others,'y',tol*.05)]; update();
    }
    if (state.settings.alignGuides && angle) {
      const others=state.board.elements.filter(e=>e.id!==el.id).map(elementAABB), tol=6/z;
      const world = (x:number,y:number) => ({x:cx+(x-el.w/2)*cos-(y-el.h/2)*sin,y:cy+(x-el.w/2)*sin+(y-el.h/2)*cos});
      const point0=world(drag.dx<0?l:drag.dx>0?r:(l+r)/2,drag.dy<0?t:drag.dy>0?b:(t+b)/2);
      const sx=alignShift([point0.x],others,'x',tol) ?? 0, sy=alignShift([point0.y],others,'y',tol) ?? 0;
      const lx=sx*cos+sy*sin, ly=-sx*sin+sy*cos;
      if(drag.dx<0 && l+lx>=image.x && l+lx<r-10/z) l+=lx;
      if(drag.dx>0 && r+lx<=image.x+image.w && r+lx>l+10/z) r+=lx;
      if(drag.dy<0 && t+ly>=image.y && t+ly<b-10/z) t+=ly;
      if(drag.dy>0 && b+ly<=image.y+image.h && b+ly>t+10/z) b+=ly;
      const p=world(drag.dx<0?l:drag.dx>0?r:(l+r)/2,drag.dy<0?t:drag.dy>0?b:(t+b)/2);
      const corners=[world(l,t),world(r,t),world(l,b),world(r,b)];
      const bounds={x0:Math.min(...corners.map(v=>v.x)),x1:Math.max(...corners.map(v=>v.x)),y0:Math.min(...corners.map(v=>v.y)),y1:Math.max(...corners.map(v=>v.y))};
      state.guides=[...alignGuides(bounds,[p.x],others,'x',tol*.05),...alignGuides(bounds,[p.y],others,'y',tol*.05)]; update();
    }
    if (e.altKey || e.shiftKey || e.ctrlKey || e.metaKey) {
      ({l,r,t,b}=cropResizeModifiers(f,{l,r,t,b},drag.dx,drag.dy,e.shiftKey || e.ctrlKey || e.metaKey,e.altKey,image));
      // После ограничения пропорций показываем только действительно совпадающие линии.
      if (state.settings.alignGuides && !angle) {
        const others=state.board.elements.filter(item=>item.id!==el.id).map(elementAABB), tol=6/z;
        const bounds={x0:el.x+l,x1:el.x+r,y0:el.y+t,y1:el.y+b};
        state.guides=[...alignGuides(bounds,drag.dx?[el.x+(drag.dx<0?l:r)]:[],others,'x',tol*.05),...alignGuides(bounds,drag.dy?[el.y+(drag.dy<0?t:b)]:[],others,'y',tol*.05)]; update();
      } else if (angle) { state.guides=[]; update(); }
    }
    frame={x:l,y:t,w:r-l,h:b-t}; paint();
  });
  function release(e: PointerEvent): void { touches.delete(e.pointerId); drag=null; pinch=0; if(state.guides.length) { state.guides=[]; update(); } }
  overlay.addEventListener('pointerup',release); overlay.addEventListener('pointercancel',release);
  overlay.addEventListener('wheel',e=>{ e.preventDefault(); e.stopPropagation(); zoom(Math.exp(-e.deltaY*.001)); },{passive:false});
  function key(e:KeyboardEvent):void { if(e.key==='Escape') { e.preventDefault(); e.stopImmediatePropagation(); finish(false); } else if(e.key==='Enter') { e.preventDefault(); e.stopImmediatePropagation(); finish(true); } }
  window.addEventListener('keydown',key,true);
  function outside(e: PointerEvent): void { if (!wrap.contains(e.target as Node)) finish(true); }
  document.addEventListener('pointerdown', outside, true);
  function finish(commit:boolean):void {
    window.removeEventListener('keydown',key,true); document.removeEventListener('pointerdown',outside,true); overlay.remove(); state.guides=[];
    if(commit && state.pageId===initialPage && state.board.elements.includes(el)) {
      const mx=frame.x+frame.w/2-el.w/2, my=frame.y+frame.h/2-el.h/2;
      const next:ImageEl={...el,x:cx+mx*cos-my*sin-frame.w/2,y:cy+mx*sin+my*cos-frame.h/2,w:frame.w,h:frame.h,crop:{x:(frame.x-image.x)/image.w,y:(frame.y-image.y)/image.h,w:frame.w/image.w,h:frame.h/image.h}};
      if(JSON.stringify(next)!==JSON.stringify({...el,crop:el.crop ?? {x:0,y:0,w:1,h:1}})) { pushHistory(state.board.elements); replaceElements(state.board.elements.map(e=>e.id===el.id?next:e)); return; }
    }
    update();
  }
  paint();
}
