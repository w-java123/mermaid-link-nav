/**
 * 画布式平移与缩放控制器。
 *
 * 交互：
 * - Ctrl/⌘ + 滚轮 / 触摸板双指捏合：以指针位置为中心缩放
 * - 鼠标滚轮：以指针位置为中心缩放
 * - 触摸板双指滑动（含水平/垂直）：平移
 * - 左键 / 触屏单指拖动：平移；拖动超过阈值后在 svg 上标记 mln-pan，
 *   由 click/dblclick 处理器读取并抑制，避免拖动结束误触发跳转或聚焦。
 *
 * 与 DiagramFocusController 协作：每次手势开始前 sync() 读取 SVG 当前 viewBox，
 * 因此聚焦动画改变 viewBox 后不会跳变。
 */

export interface PanZoomOptions {
  /** 最小缩放比例（相对初始 viewBox），默认 0.15 */
  minScale?: number;
  /** 最大缩放比例，默认 6 */
  maxScale?: number;
  /** 判定为拖动的像素阈值，默认 5 */
  panThreshold?: number;
}

interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

export class PanZoomController {
  private svg: SVGSVGElement;
  private opts: Required<PanZoomOptions>;
  private current: Box;
  private readonly baseW: number;
  private readonly baseH: number;
  private readonly ratio: number; // baseH / baseW

  private dragging = false;
  private startX = 0;
  private startY = 0;
  private lastX = 0;
  private lastY = 0;
  private panned = false;

  private readonly handlers: Array<{
    type: string;
    listener: EventListenerOrEventListenerObject;
    options?: AddEventListenerOptions;
  }> = [];

  constructor(svg: SVGSVGElement, opts: PanZoomOptions = {}) {
    this.svg = svg;
    this.opts = {
      minScale: opts.minScale ?? 0.15,
      maxScale: opts.maxScale ?? 6,
      panThreshold: opts.panThreshold ?? 5,
    };
    this.current = this.readBox();
    this.baseW = this.current.width;
    this.baseH = this.current.height;
    this.ratio = this.baseW > 0 ? this.baseH / this.baseW : 1;
    this.bind();
  }

  private readBox(): Box {
    const vb = this.svg.viewBox.baseVal;
    return { x: vb.x, y: vb.y, width: vb.width, height: vb.height };
  }

  private writeBox(b: Box): void {
    this.svg.setAttribute('viewBox', `${b.x} ${b.y} ${b.width} ${b.height}`);
    this.current = b;
  }

  /** 从 SVG 同步当前 viewBox（聚焦动画可能已修改它） */
  sync(): void {
    this.current = this.readBox();
  }

  /** 以屏幕坐标为中心缩放 */
  private zoomAt(clientX: number, clientY: number, factor: number): void {
    const rect = this.svg.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;
    const px = (clientX - rect.left) / rect.width;
    const py = (clientY - rect.top) / rect.height;
    const b = this.current;
    const cx = b.x + px * b.width;
    const cy = b.y + py * b.height;

    const minW = this.baseW / this.opts.maxScale;
    const maxW = this.baseW / this.opts.minScale;
    const newW = Math.min(Math.max(b.width * factor, minW), maxW);
    const newH = newW * this.ratio;

    this.writeBox({
      x: cx - px * newW,
      y: cy - py * newH,
      width: newW,
      height: newH,
    });
  }

  /** 按屏幕像素差平移 */
  private panBy(deltaX: number, deltaY: number): void {
    const rect = this.svg.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;
    const scaleX = this.current.width / rect.width;
    const scaleY = this.current.height / rect.height;
    this.writeBox({
      x: this.current.x - deltaX * scaleX,
      y: this.current.y - deltaY * scaleY,
      width: this.current.width,
      height: this.current.height,
    });
  }

  private bind(): void {
    const onWheel = (e: Event): void => {
      const ev = e as WheelEvent;
      ev.preventDefault();
      this.sync();
      if (ev.ctrlKey) {
        // 触摸板双指捏合 / Ctrl+滚轮 → 缩放（deltaY<0 上滚/张开=放大）
        this.zoomAt(ev.clientX, ev.clientY, Math.exp(ev.deltaY * 0.01));
      } else if (Math.abs(ev.deltaX) > 0) {
        // 触摸板水平滑动 → 平移
        this.panBy(ev.deltaX, ev.deltaY);
      } else if (ev.deltaMode === 0 && Math.abs(ev.deltaY) < 40) {
        // 触摸板垂直滑动（像素模式小增量）→ 平移
        this.panBy(0, ev.deltaY);
      } else {
        // 鼠标滚轮 → 以指针位置为中心缩放（上滚放大、下滚缩小）
        this.zoomAt(ev.clientX, ev.clientY, Math.exp(ev.deltaY * 0.0015));
      }
    };

    const onPointerDown = (e: Event): void => {
      const ev = e as PointerEvent;
      if (ev.pointerType === 'mouse' && ev.button !== 0) return;
      this.sync();
      this.dragging = true;
      this.panned = false;
      this.startX = this.lastX = ev.clientX;
      this.startY = this.lastY = ev.clientY;
      try {
        this.svg.setPointerCapture(ev.pointerId);
      } catch {
        /* ignore */
      }
    };

    const onPointerMove = (e: Event): void => {
      if (!this.dragging) return;
      const ev = e as PointerEvent;
      const dx = ev.clientX - this.lastX;
      const dy = ev.clientY - this.lastY;
      this.lastX = ev.clientX;
      this.lastY = ev.clientY;
      if (!this.panned) {
        const dist = Math.hypot(ev.clientX - this.startX, ev.clientY - this.startY);
        if (dist < this.opts.panThreshold) return;
        this.panned = true;
        this.svg.dataset.mlnPan = '1'; // 抑制后续 click/dblclick
        this.svg.classList.add('mln-panning');
      }
      this.panBy(dx, dy);
    };

    const onPointerUp = (e: Event): void => {
      if (!this.dragging) return;
      const ev = e as PointerEvent;
      this.dragging = false;
      this.svg.classList.remove('mln-panning');
      try {
        this.svg.releasePointerCapture(ev.pointerId);
      } catch {
        /* ignore */
      }
      if (this.panned) {
        // 延迟清除标志，让紧接着的 click/dblclick 能检测到
        window.setTimeout(() => {
          delete this.svg.dataset.mlnPan;
        }, 0);
      }
    };

    this.add('wheel', onWheel, { passive: false });
    this.add('pointerdown', onPointerDown);
    this.add('pointermove', onPointerMove);
    this.add('pointerup', onPointerUp);
    this.add('pointercancel', onPointerUp);
  }

  private add(
    type: string,
    listener: EventListenerOrEventListenerObject,
    options?: AddEventListenerOptions,
  ): void {
    this.svg.addEventListener(type, listener, options);
    this.handlers.push({ type, listener, options });
  }

  dispose(): void {
    for (const h of this.handlers) {
      this.svg.removeEventListener(h.type, h.listener, h.options);
    }
    this.svg.classList.remove('mln-panning');
    this.svg.style.cursor = '';
    delete this.svg.dataset.mlnPan;
  }
}
