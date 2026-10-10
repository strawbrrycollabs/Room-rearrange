import type { Furniture, Room } from '../types';
import { bounds, findProblems, walls, wallPoint } from '../geometry';
import { fmtLen } from '../units';
import type { Walkways } from '../analysis';
import type { Unit } from '../types';

export type PlanColors = {
  bg: string; floor: string; wall: string; text: string; muted: string; grid: string;
  window: string; radiator: string; accent: string; danger: string; itemStroke: string; warn: string;
};

export const LIGHT: PlanColors = {
  bg: '#ffffff', floor: '#fbfbfc', wall: '#3b4252', text: '#1f2430', muted: '#6b7280', grid: 'rgba(20,22,26,.07)',
  window: '#bfe3f7', radiator: '#f6b99a', accent: '#4f46e5', danger: '#e5484d', itemStroke: 'rgba(20,22,26,.55)', warn: '#f59e0b',
};

type Props = {
  room: Room;
  items: Furniture[];
  unit: Unit;
  colors?: PlanColors;
  /** Output width in px; height follows the room's aspect ratio. */
  width?: number;
  walkways?: Walkways | null;
  dims?: boolean;
  itemLabels?: boolean;
  pad?: number;
  title?: string;
  className?: string;
};

/** The SVG viewBox used for a room (shared with the exporter so image sizes match). */
export function planViewBox(room: Pick<Room, 'corners'>, hasTitle = false, padOverride?: number) {
  const b = bounds(room.corners);
  const m = Math.max(b.w, b.h);
  const pad = padOverride ?? Math.max(80, m * 0.14);
  const fs = m / 38;
  const top = hasTitle ? fs * 3 : 0;
  return { x: b.minX - pad, y: b.minY - pad - top, w: b.w + pad * 2, h: b.h + pad * 2 + top, pad, fs, top };
}

/** Self-contained SVG of a room layout; no CSS variables so it can be rasterised for export. */
export function StaticPlan({ room, items, unit, colors = LIGHT, width, walkways, dims = true, itemLabels = true, pad: padProp, title, className }: Props) {
  const c = colors;
  const b = bounds(room.corners);
  const { pad, fs, ...vb } = planViewBox(room, !!title, padProp);
  const scale = width ? width / vb.w : 1;
  const wl = walls(room.corners);
  const problems = findProblems(items, room.corners);
  const poly = room.corners.map((p) => `${p.x},${p.y}`).join(' ');
  const ordered = [...items].sort((a, z) => Number(z.flat) - Number(a.flat));
  const t = Math.max(6, Math.max(b.w, b.h) / 70); // wall thickness drawn

  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      viewBox={`${vb.x} ${vb.y} ${vb.w} ${vb.h}`}
      width={width}
      height={width ? vb.h * scale : undefined}
      fontFamily="system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif"
    >
      <rect x={vb.x} y={vb.y} width={vb.w} height={vb.h} fill={c.bg} />
      {title && <text x={vb.x + pad / 2} y={vb.y + fs * 1.9} fontSize={fs * 1.6} fontWeight={700} fill={c.text}>{title}</text>}
      <polygon points={poly} fill="none" stroke={c.wall} strokeWidth={t} strokeLinejoin="miter" />
      <polygon points={poly} fill={c.floor} />

      {walkways && walkways.narrow.map((p, i) => (
        <rect key={i} x={p.x - walkways.cell / 2} y={p.y - walkways.cell / 2} width={walkways.cell} height={walkways.cell} fill={c.warn} opacity={0.45} />
      ))}

      {room.openings.map((o) => {
        const w = wl[o.wall];
        if (!w) return null;
        const door = walkways?.doors.find((d) => d.id === o.id);
        const col = door?.blocked ? c.danger : c.accent;
        const out = o.swing === 'out' ? -1 : 1;
        return (
          <g key={o.id} transform={`translate(${w.a.x} ${w.a.y}) rotate(${w.angle})`}>
            {o.kind === 'window' && <rect x={o.offset} y={-t / 2} width={o.width} height={t} fill={c.window} stroke={c.wall} strokeWidth={t / 10} />}
            {o.kind === 'radiator' && <rect x={o.offset} y={0} width={o.width} height={8} rx={2} fill={c.radiator} stroke={c.wall} strokeWidth={t / 10} />}
            {o.kind === 'door' && (
              <g transform={`scale(1 ${out})`}>
                <rect x={o.offset} y={-t / 2 - 1} width={o.width} height={t + 2} fill={c.floor} />
                {o.hinge === 'start' ? (
                  <>
                    <line x1={o.offset} y1={0} x2={o.offset} y2={o.width} stroke={col} strokeWidth={t / 3} />
                    <path d={`M${o.offset + o.width} 0A${o.width} ${o.width} 0 0 1 ${o.offset} ${o.width}`} fill="none" stroke={col} strokeWidth={t / 8} strokeDasharray={`${t / 2} ${t / 3}`} />
                  </>
                ) : (
                  <>
                    <line x1={o.offset + o.width} y1={0} x2={o.offset + o.width} y2={o.width} stroke={col} strokeWidth={t / 3} />
                    <path d={`M${o.offset} 0A${o.width} ${o.width} 0 0 0 ${o.offset + o.width} ${o.width}`} fill="none" stroke={col} strokeWidth={t / 8} strokeDasharray={`${t / 2} ${t / 3}`} />
                  </>
                )}
              </g>
            )}
          </g>
        );
      })}

      {ordered.map((it) => {
        const p = problems.get(it.id);
        const bad = !!p && (p.overlaps.length > 0 || p.outside);
        const stroke = bad ? c.danger : c.itemStroke;
        return (
          <g key={it.id}>
            <g transform={`translate(${it.x} ${it.y}) rotate(${it.rotation})`}>
              {it.shape === 'round'
                ? <ellipse rx={it.width / 2} ry={it.depth / 2} fill={it.color} fillOpacity={it.flat ? 0.75 : 1} stroke={stroke} strokeWidth={bad ? t / 4 : t / 8} />
                : <rect x={-it.width / 2} y={-it.depth / 2} width={it.width} height={it.depth} rx={Math.min(6, it.depth / 6)} fill={it.color} fillOpacity={it.flat ? 0.75 : 1} stroke={stroke} strokeWidth={bad ? t / 4 : t / 8} />}
              {bad && (it.shape === 'round'
                ? <ellipse rx={it.width / 2} ry={it.depth / 2} fill={c.danger} opacity={0.4} />
                : <rect x={-it.width / 2} y={-it.depth / 2} width={it.width} height={it.depth} fill={c.danger} opacity={0.4} />)}
            </g>
            {itemLabels && Math.min(it.width, it.depth) > fs * 3 && (
              <text x={it.x} y={it.y} textAnchor="middle" fontSize={fs * 0.75} fill={c.text}>
                <tspan x={it.x} dy={-fs * 0.1}>{it.name}</tspan>
                {dims && <tspan x={it.x} dy={fs * 0.9} fontSize={fs * 0.6} fill={c.muted}>{fmtLen(it.width, unit)} × {fmtLen(it.depth, unit)}</tspan>}
              </text>
            )}
          </g>
        );
      })}

      {dims && wl.map((w) => {
        const p = wallPoint(w, w.length / 2, -(t / 2 + fs * 1.1));
        return <text key={w.index} x={p.x} y={p.y} textAnchor="middle" dominantBaseline="central" fontSize={fs} fill={c.muted}>{fmtLen(w.length, unit)}</text>;
      })}
    </svg>
  );
}
