import { useEffect, useMemo, useRef, useState } from 'react';
import { activeLayout, splitWall, reclamp, useRoom, useStore } from '../store';
import {
  bounds, deg, dist, findProblems, itemCorners, normDeg, snapItem, walls, wallPoint,
} from '../geometry';
import type { Furniture, Pt } from '../types';
import { fmtLen } from '../units';
import type { Walkways } from '../analysis';
import { useViewport } from '../useViewport';

export type Tool = 'select' | 'measure' | 'corners';

type Gesture =
  | { t: 'pan'; sx: number; sy: number; tx: number; ty: number; moved: boolean }
  | { t: 'pinch'; d0: number; k0: number; mx: number; my: number; tx0: number; ty0: number }
  | { t: 'drag'; id: string; start: Pt; item: Furniture; moved: boolean }
  | { t: 'rotate'; id: string; moved: boolean }
  | { t: 'corner'; idx: number; moved: boolean }
  | null;

const wallOf = (n: number) => n;

export function Plan2D({ tool, snapOn, walkways }: { tool: Tool; snapOn: boolean; walkways?: Walkways | null }) {
  const room = useRoom()!;
  const unit = useStore((s) => s.unit);
  const selectedId = useStore((s) => s.selectedId);
  const { select, live, checkpoint } = useStore.getState();
  const { ref, view, setView, viewRef, toWorld, zoomAt, fit } = useViewport();
  const g = useRef<Gesture>(null);
  const pts = useRef(new Map<number, Pt>());
  const [measure, setMeasure] = useState<{ a: Pt; b: Pt | null } | null>(null);
  const [hover, setHover] = useState<Pt | null>(null);

  const items = activeLayout(room).items;
  const problems = useMemo(() => findProblems(items, room.corners), [items, room.corners]);
  const wl = useMemo(() => walls(room.corners), [room.corners]);
  const roomBounds = useMemo(() => bounds(room.corners), [room.corners]);

  // Fit when the room is opened.
  useEffect(() => {
    const b = bounds([...room.corners, ...items.flatMap((i) => itemCorners(i))]);
    fit(b);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [room.id]);
  useEffect(() => { if (tool !== 'measure') setMeasure(null); }, [tool]);

  const k = view.k;
  const px = (n: number) => n / k; // screen px -> world cm
  const poly = room.corners.map((p) => `${p.x},${p.y}`).join(' ');

  const snapPoint = (w: Pt): Pt => {
    for (const c of room.corners) if (dist(c, w) * k < 14) return c;
    return { x: Math.round(w.x), y: Math.round(w.y) };
  };

  const onDown = (e: React.PointerEvent<SVGSVGElement>) => {
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
    pts.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pts.current.size === 2) {
      const [a, b] = [...pts.current.values()];
      const v = viewRef.current;
      const r = ref.current!.getBoundingClientRect();
      g.current = {
        t: 'pinch', d0: Math.hypot(a.x - b.x, a.y - b.y) || 1, k0: v.k,
        mx: (a.x + b.x) / 2 - r.left, my: (a.y + b.y) / 2 - r.top, tx0: v.tx, ty0: v.ty,
      };
      return;
    }
    const target = (e.target as Element).closest('[data-kind]') as HTMLElement | null;
    const kind = target?.dataset.kind;
    const w = toWorld(e.clientX, e.clientY);

    if (tool === 'measure') {
      const p = snapPoint(w);
      setMeasure((m) => (m && !m.b ? { a: m.a, b: p } : { a: p, b: null }));
      return;
    }
    if (kind === 'split') {
      useStore.getState().edit((r) => splitWall(r, Number(target!.dataset.idx)));
      return;
    }
    if (kind === 'corner') {
      checkpoint();
      g.current = { t: 'corner', idx: Number(target!.dataset.idx), moved: false };
      return;
    }
    if (kind === 'rot') {
      checkpoint();
      g.current = { t: 'rotate', id: target!.dataset.id!, moved: false };
      return;
    }
    if (kind === 'item' && tool === 'select') {
      const id = target!.dataset.id!;
      select(id);
      const item = items.find((i) => i.id === id)!;
      if (!item.locked) g.current = { t: 'drag', id, start: w, item, moved: false };
      return;
    }
    g.current = { t: 'pan', sx: e.clientX, sy: e.clientY, tx: viewRef.current.tx, ty: viewRef.current.ty, moved: false };
  };

  const onMove = (e: React.PointerEvent<SVGSVGElement>) => {
    if (pts.current.has(e.pointerId)) pts.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const w = toWorld(e.clientX, e.clientY);
    if (tool === 'measure') {
      setHover(snapPoint(w));
    }
    const s = g.current;
    if (!s) return;
    if (s.t === 'pinch') {
      if (pts.current.size < 2) return;
      const [a, b] = [...pts.current.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y) || 1;
      const k2 = Math.min(8, Math.max(0.05, (s.k0 * d) / s.d0));
      const r = ref.current!.getBoundingClientRect();
      const mx = (a.x + b.x) / 2 - r.left, my = (a.y + b.y) / 2 - r.top;
      setView({
        k: k2,
        tx: mx - ((s.mx - s.tx0) / s.k0) * k2,
        ty: my - ((s.my - s.ty0) / s.k0) * k2,
      });
    } else if (s.t === 'pan') {
      const dx = e.clientX - s.sx, dy = e.clientY - s.sy;
      if (Math.abs(dx) + Math.abs(dy) > 3) s.moved = true;
      setView((v) => ({ ...v, tx: s.tx + dx, ty: s.ty + dy }));
    } else if (s.t === 'drag') {
      const dxw = w.x - s.start.x, dyw = w.y - s.start.y;
      if (!s.moved && Math.hypot(dxw, dyw) * k < 4) return;
      if (!s.moved) { s.moved = true; checkpoint(); }
      let next = { x: s.item.x + dxw, y: s.item.y + dyw, rotation: s.item.rotation };
      if (snapOn && !e.altKey) {
        const cur = activeLayout(useStore.getState().rooms.find((r) => r.id === room.id)!).items;
        const sn = snapItem({ ...s.item, ...next }, cur, room.corners, 12 / Math.max(k, 0.3) * 0.6 + 6);
        next = { x: sn.x, y: sn.y, rotation: sn.rotation };
      } else {
        next.x = Math.round(next.x); next.y = Math.round(next.y);
      }
      patchItem(s.id, { x: Math.round(next.x * 10) / 10, y: Math.round(next.y * 10) / 10, rotation: next.rotation });
    } else if (s.t === 'rotate') {
      const it = useStore.getState().rooms.find((r) => r.id === room.id)!;
      const item = activeLayout(it).items.find((i) => i.id === s.id);
      if (!item) return;
      let r = normDeg(deg(Math.atan2(w.y - item.y, w.x - item.x)) + 90);
      const step = e.shiftKey ? 1 : 5;
      r = Math.round(r / step) * step;
      for (const q of [0, 90, 180, 270, 360]) if (Math.abs(r - q) <= 4) r = q % 360;
      patchItem(s.id, { rotation: r });
    } else if (s.t === 'corner') {
      const p = { x: Math.round(w.x / 5) * 5, y: Math.round(w.y / 5) * 5 };
      live((r) => reclamp({ ...r, corners: r.corners.map((c, i) => (i === s.idx ? p : c)) }));
    }
  };

  const patchItem = (id: string, patch: Partial<Furniture>) =>
    live((r) => ({
      ...r,
      layouts: r.layouts.map((l) =>
        l.id === r.activeLayoutId ? { ...l, items: l.items.map((i) => (i.id === id ? { ...i, ...patch } : i)) } : l),
    }));

  const onUp = (e: React.PointerEvent<SVGSVGElement>) => {
    pts.current.delete(e.pointerId);
    const s = g.current;
    if (s?.t === 'pan' && !s.moved && tool === 'select') select(null);
    if (s?.t === 'pinch') { g.current = null; return; }
    if (pts.current.size === 0) g.current = null;
  };

  const fs = px(12); // 12px text

  const ordered = [...items].sort((a, b) => Number(b.flat) - Number(a.flat));

  return (
    <div className="canvas-wrap">
      <svg
        ref={ref}
        className={`plan tool-${tool}`}
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={onUp}
      >
        <defs>
          <pattern id="g10" width="10" height="10" patternUnits="userSpaceOnUse">
            <path d="M10 0H0V10" fill="none" stroke="var(--grid)" strokeWidth="1" vectorEffect="non-scaling-stroke" />
          </pattern>
          <pattern id="g100" width="100" height="100" patternUnits="userSpaceOnUse">
            <path d="M100 0H0V100" fill="none" stroke="var(--grid-major)" strokeWidth="1" vectorEffect="non-scaling-stroke" />
          </pattern>
        </defs>
        <g transform={`translate(${view.tx} ${view.ty}) scale(${k})`}>
          <rect x={-20000} y={-20000} width={40000} height={40000} fill="url(#g100)" />
          {k * 10 >= 7 && <rect x={-20000} y={-20000} width={40000} height={40000} fill="url(#g10)" opacity={Math.min(1, (k * 10 - 7) / 8)} />}

          {/* walls (outer half visible), then floor on top */}
          <polygon points={poly} fill="none" stroke="var(--wall)" strokeWidth={10} strokeLinejoin="miter" />
          <polygon points={poly} fill="var(--floor)" />
          <polygon points={poly} fill="url(#g10)" opacity={k * 10 >= 7 ? 0.6 : 0} pointerEvents="none" />

          {walkways && walkways.narrow.map((p, i) => (
            <rect key={i} x={p.x - walkways.cell / 2} y={p.y - walkways.cell / 2} width={walkways.cell + 0.4} height={walkways.cell + 0.4} fill="#f59e0b" opacity={0.5} pointerEvents="none" />
          ))}
          {walkways && walkways.doors.filter((d) => d.blocked).map((d) => (
            <polygon key={d.id} points={d.swing.map((p) => `${p.x},${p.y}`).join(' ')} fill="var(--danger)" opacity={0.35} pointerEvents="none" />
          ))}

          {/* openings */}
          {room.openings.map((o) => {
            const w = wl[wallOf(o.wall)];
            if (!w) return null;
            return (
              <g key={o.id} transform={`translate(${w.a.x} ${w.a.y}) rotate(${w.angle})`} pointerEvents="none">
                {o.kind === 'window' && (
                  <>
                    <rect x={o.offset} y={-5} width={o.width} height={10} fill="var(--window)" stroke="var(--wall)" strokeWidth={1} vectorEffect="non-scaling-stroke" />
                    <line x1={o.offset} x2={o.offset + o.width} y1={0} y2={0} stroke="var(--wall)" strokeWidth={1} vectorEffect="non-scaling-stroke" />
                  </>
                )}
                {o.kind === 'door' && (
                  <g transform={`scale(1 ${o.swing === 'out' ? -1 : 1})`}>
                    <rect x={o.offset} y={-6} width={o.width} height={12} fill="var(--floor)" />
                    {o.hinge === 'start' ? (
                      <>
                        <line x1={o.offset} y1={0} x2={o.offset} y2={o.width} stroke="var(--accent)" strokeWidth={3} />
                        <path d={`M${o.offset + o.width} 0A${o.width} ${o.width} 0 0 1 ${o.offset} ${o.width}`} fill="var(--accent-soft)" stroke="var(--accent)" strokeWidth={1} vectorEffect="non-scaling-stroke" strokeDasharray="4 3" />
                      </>
                    ) : (
                      <>
                        <line x1={o.offset + o.width} y1={0} x2={o.offset + o.width} y2={o.width} stroke="var(--accent)" strokeWidth={3} />
                        <path d={`M${o.offset} 0A${o.width} ${o.width} 0 0 0 ${o.offset + o.width} ${o.width}`} fill="var(--accent-soft)" stroke="var(--accent)" strokeWidth={1} vectorEffect="non-scaling-stroke" strokeDasharray="4 3" />
                      </>
                    )}
                  </g>
                )}
                {o.kind === 'radiator' && (
                  <rect x={o.offset} y={0} width={o.width} height={8} rx={2} fill="var(--radiator)" stroke="var(--wall)" strokeWidth={1} vectorEffect="non-scaling-stroke" />
                )}
              </g>
            );
          })}

          {/* furniture */}
          {ordered.map((it) => {
            const prob = problems.get(it.id);
            const bad = !!prob && (prob.overlaps.length > 0 || prob.outside);
            const sel = it.id === selectedId;
            return (
              <g key={it.id}>
                <g transform={`translate(${it.x} ${it.y}) rotate(${it.rotation})`} data-kind="item" data-id={it.id} style={{ cursor: it.locked ? 'default' : 'grab' }}>
                  {it.shape === 'round' ? (
                    <ellipse rx={it.width / 2} ry={it.depth / 2} fill={it.color} fillOpacity={it.flat ? 0.75 : 1} stroke={bad ? 'var(--danger)' : 'var(--item-stroke)'} strokeWidth={bad ? 2.5 : 1.25} vectorEffect="non-scaling-stroke" />
                  ) : (
                    <rect x={-it.width / 2} y={-it.depth / 2} width={it.width} height={it.depth} rx={Math.min(6, it.depth / 6)} fill={it.color} fillOpacity={it.flat ? 0.75 : 1} stroke={bad ? 'var(--danger)' : 'var(--item-stroke)'} strokeWidth={bad ? 2.5 : 1.25} vectorEffect="non-scaling-stroke" />
                  )}
                  {it.shape === 'box' && !it.flat && <rect x={-it.width / 4} y={it.depth / 2 - 4} width={it.width / 2} height={3} rx={1.5} fill="#000" opacity={0.22} />}
                  {bad && (
                    it.shape === 'round'
                      ? <ellipse rx={it.width / 2} ry={it.depth / 2} fill="var(--danger)" opacity={0.45} />
                      : <rect x={-it.width / 2} y={-it.depth / 2} width={it.width} height={it.depth} rx={Math.min(6, it.depth / 6)} fill="var(--danger)" opacity={0.45} />
                  )}
                </g>
                {Math.min(it.width, it.depth) * k > 38 && (
                  <text x={it.x} y={it.y} textAnchor="middle" dominantBaseline="central" fontSize={px(11)} fill="var(--item-text)" pointerEvents="none">
                    {it.locked ? '🔒 ' : ''}{it.name}
                  </text>
                )}
                {sel && <SelectionOverlay item={it} k={k} unit={unit} showRot={!it.locked} />}
              </g>
            );
          })}

          {/* wall dimensions */}
          {wl.map((w) => {
            if (w.length * k < 46) return null;
            const p = wallPoint(w, w.length / 2, -(10 + px(14)));
            return (
              <text key={w.index} x={p.x} y={p.y} textAnchor="middle" dominantBaseline="central" fontSize={fs} fill="var(--muted)" className="halo" pointerEvents="none">
                {fmtLen(w.length, unit)}
              </text>
            );
          })}

          {/* corner editing */}
          {tool === 'corners' && (
            <>
              {wl.map((w) => {
                const m = wallPoint(w, w.length / 2);
                return (
                  <g key={`s${w.index}`} data-kind="split" data-idx={w.index} style={{ cursor: 'copy' }}>
                    <circle cx={m.x} cy={m.y} r={px(13)} fill="var(--bg)" stroke="var(--accent)" strokeWidth={1.5} vectorEffect="non-scaling-stroke" />
                    <path d={`M${m.x - px(5)} ${m.y}H${m.x + px(5)}M${m.x} ${m.y - px(5)}V${m.y + px(5)}`} stroke="var(--accent)" strokeWidth={2} vectorEffect="non-scaling-stroke" />
                  </g>
                );
              })}
              {room.corners.map((c, i) => (
                <g key={`c${i}`} data-kind="corner" data-idx={i} style={{ cursor: 'move' }}>
                  <circle cx={c.x} cy={c.y} r={px(15)} fill="var(--accent)" />
                  <text x={c.x} y={c.y} textAnchor="middle" dominantBaseline="central" fontSize={px(12)} fill="#fff" pointerEvents="none">{i + 1}</text>
                </g>
              ))}
            </>
          )}
          {tool !== 'corners' && k * 40 > 24 && room.corners.map((c, i) => (
            <circle key={i} cx={c.x} cy={c.y} r={px(3)} fill="var(--wall)" pointerEvents="none" />
          ))}

          {/* measuring tool */}
          {tool === 'measure' && (() => {
            const a = measure?.a;
            const b = measure?.b ?? (measure && hover) ?? null;
            return (
              <g pointerEvents="none">
                {a && <circle cx={a.x} cy={a.y} r={px(5)} fill="var(--accent)" />}
                {a && b && (
                  <>
                    <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="var(--accent)" strokeWidth={2} vectorEffect="non-scaling-stroke" />
                    <circle cx={b.x} cy={b.y} r={px(5)} fill="var(--accent)" />
                    <text x={(a.x + b.x) / 2} y={(a.y + b.y) / 2 - px(12)} textAnchor="middle" fontSize={px(14)} fontWeight={600} fill="var(--accent)" className="halo">
                      {fmtLen(dist(a, b), unit)}
                    </text>
                  </>
                )}
                {!measure && hover && <circle cx={hover.x} cy={hover.y} r={px(5)} fill="var(--accent)" opacity={0.5} />}
              </g>
            );
          })()}
        </g>
      </svg>

      <div className="zoom">
        <button aria-label="Zoom in" onClick={() => { const r = ref.current!.getBoundingClientRect(); zoomAt(r.left + r.width / 2, r.top + r.height / 2, 1.3); }}>+</button>
        <button aria-label="Zoom out" onClick={() => { const r = ref.current!.getBoundingClientRect(); zoomAt(r.left + r.width / 2, r.top + r.height / 2, 1 / 1.3); }}>−</button>
        <button aria-label="Fit to screen" onClick={() => fit(bounds([...room.corners, ...items.flatMap((i) => itemCorners(i))]))}>⤢</button>
      </div>
      {tool === 'measure' && <div className="hint">Tap two points to measure{measure?.b ? ' — tap again to restart' : ''}</div>}
      {tool === 'corners' && <div className="hint">Drag corners · tap + to add a corner</div>}
      <div className="area-chip">{fmtArea(roomBounds, room.corners, unit)}</div>
    </div>
  );
}

function fmtArea(_b: ReturnType<typeof bounds>, corners: Pt[], unit: 'metric' | 'imperial') {
  let a = 0;
  for (let i = 0; i < corners.length; i++) {
    const q = corners[(i + 1) % corners.length];
    a += corners[i].x * q.y - q.x * corners[i].y;
  }
  a = Math.abs(a / 2);
  return unit === 'metric' ? `${(a / 10000).toFixed(1)} m²` : `${(a / 929.0304).toFixed(0)} ft²`;
}

function SelectionOverlay({ item, k, unit, showRot }: { item: Furniture; k: number; unit: 'metric' | 'imperial'; showRot: boolean }) {
  const px = (n: number) => n / k;
  const handleDist = item.depth / 2 + px(30);
  return (
    <g>
      <g transform={`translate(${item.x} ${item.y}) rotate(${item.rotation})`} pointerEvents="none">
        <rect x={-item.width / 2 - px(3)} y={-item.depth / 2 - px(3)} width={item.width + px(6)} height={item.depth + px(6)} rx={px(4)} fill="none" stroke="var(--accent)" strokeWidth={2} strokeDasharray="6 4" vectorEffect="non-scaling-stroke" />
      </g>
      {showRot && (
        <g transform={`translate(${item.x} ${item.y}) rotate(${item.rotation})`}>
          <line x1={0} y1={-item.depth / 2} x2={0} y2={-handleDist} stroke="var(--accent)" strokeWidth={1.5} vectorEffect="non-scaling-stroke" pointerEvents="none" />
          <circle data-kind="rot" data-id={item.id} cx={0} cy={-handleDist} r={px(14)} fill="var(--accent)" style={{ cursor: 'grab' }} />
          <path d={`M${-px(5)} ${-handleDist + px(1)}a${px(5)} ${px(5)} 0 1 1 ${px(2)} ${px(4)}`} fill="none" stroke="#fff" strokeWidth={1.8} vectorEffect="non-scaling-stroke" pointerEvents="none" />
        </g>
      )}
      <text x={item.x} y={item.y + Math.max(item.width, item.depth) / 2 + px(26)} textAnchor="middle" fontSize={px(12)} fill="var(--accent)" fontWeight={600} className="halo" pointerEvents="none">
        {fmtLen(item.width, unit)} × {fmtLen(item.depth, unit)} · {Math.round(item.rotation)}°
      </text>
    </g>
  );
}
