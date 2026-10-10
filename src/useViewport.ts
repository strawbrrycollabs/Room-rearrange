import { useCallback, useEffect, useRef, useState } from 'react';
import type { Pt } from './types';

export type View = { k: number; tx: number; ty: number };

/** Pan/zoom state for an SVG canvas; world units are centimetres. */
export function useViewport() {
  const ref = useRef<SVGSVGElement>(null);
  const [view, setView] = useState<View>({ k: 1, tx: 0, ty: 0 });
  const [size, setSize] = useState({ w: 0, h: 0 });
  const viewRef = useRef(view);
  viewRef.current = view;

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    setSize({ w: el.clientWidth, h: el.clientHeight });
    return () => ro.disconnect();
  }, []);

  const toWorld = useCallback((cx: number, cy: number): Pt => {
    const r = ref.current!.getBoundingClientRect();
    const v = viewRef.current;
    return { x: (cx - r.left - v.tx) / v.k, y: (cy - r.top - v.ty) / v.k };
  }, []);

  const zoomAt = useCallback((cx: number, cy: number, factor: number) => {
    const r = ref.current!.getBoundingClientRect();
    setView((v) => {
      const k = Math.min(8, Math.max(0.05, v.k * factor));
      const px = cx - r.left, py = cy - r.top;
      return { k, tx: px - ((px - v.tx) / v.k) * k, ty: py - ((py - v.ty) / v.k) * k };
    });
  }, []);

  const fit = useCallback((b: { minX: number; minY: number; w: number; h: number }, pad = 56) => {
    const el = ref.current;
    if (!el) return;
    const W = el.clientWidth, H = el.clientHeight;
    if (!W || !H) return;
    const k = Math.min(8, Math.max(0.05, Math.min((W - pad * 2) / Math.max(b.w, 1), (H - pad * 2) / Math.max(b.h, 1))));
    setView({ k, tx: (W - b.w * k) / 2 - b.minX * k, ty: (H - b.h * k) / 2 - b.minY * k });
  }, []);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      if (e.ctrlKey || e.metaKey || Math.abs(e.deltaY) >= 40 || e.deltaMode) zoomAt(e.clientX, e.clientY, Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0015)));
      else setView((v) => ({ ...v, tx: v.tx - e.deltaX, ty: v.ty - e.deltaY }));
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [zoomAt]);

  return { ref, view, setView, viewRef, size, toWorld, zoomAt, fit };
}
