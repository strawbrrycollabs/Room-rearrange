import type { Opening, OpeningKind, Pt, Room } from '../types';
import { newRoom, defaultOpening } from '../store';
import { clampOpening, dist, ensureClockwise, walls } from '../geometry';

export type ScanOpening = { kind: OpeningKind; a: Pt; b: Pt; height: number; sill: number };
export type ScanResult = { corners: Pt[]; openings: ScanOpening[]; ceilingHeight?: number; source: 'ar' | 'aim' };

const rad = (d: number) => (d * Math.PI) / 180;
const deg = (r: number) => (r * 180) / Math.PI;

export const OPENING_DEFAULTS: Record<OpeningKind, { height: number; sill: number }> = {
  door: { height: 205, sill: 0 },
  window: { height: 130, sill: 90 },
  radiator: { height: 60, sill: 15 },
};

/* ---------------- Phone orientation ("aim and tap") ---------------- */

/** Unit vector (east, north, up) the rear camera points along, from W3C deviceorientation angles. */
export function lookDirection(alpha: number, beta: number, gamma: number) {
  const a = rad(alpha), b = rad(beta), g = rad(gamma);
  const ca = Math.cos(a), sa = Math.sin(a), cb = Math.cos(b), sb = Math.sin(b), cg = Math.cos(g), sg = Math.sin(g);
  return {
    east: -ca * sg - sa * sb * cg,
    north: -sa * sg + ca * sb * cg,
    up: -cb * cg,
  };
}
export type Dir = ReturnType<typeof lookDirection>;

export const elevationDeg = (d: Dir) => deg(Math.asin(Math.max(-1, Math.min(1, d.up))));

export function averageDirections(ds: Dir[]): Dir | null {
  if (!ds.length) return null;
  const s = ds.reduce((m, d) => ({ east: m.east + d.east, north: m.north + d.north, up: m.up + d.up }), { east: 0, north: 0, up: 0 });
  const len = Math.hypot(s.east, s.north, s.up) || 1;
  return { east: s.east / len, north: s.north / len, up: s.up / len };
}

/** Minimum angle below the horizon at which a floor point can be estimated. */
export const MIN_DEPRESSION = 5;

/**
 * Where the crosshair meets the floor, relative to the phone (cm). Plan x = east, plan y = -north,
 * so the result looks like the real room seen from above. Null when aimed too level or straight down.
 */
export function floorHit(dir: Dir, camHeight: number): Pt | null {
  const el = elevationDeg(dir);
  if (-el < MIN_DEPRESSION || -el > 88) return null;
  const horiz = Math.hypot(dir.east, dir.north);
  if (horiz < 1e-6) return null;
  const d = camHeight / Math.tan(rad(-el));
  return { x: (dir.east / horiz) * d, y: -(dir.north / horiz) * d };
}

/** Rough ± error (cm) of a floor hit if the phone's pitch is off by 1°. */
export function floorHitError(dir: Dir, camHeight: number): number | null {
  const el = -elevationDeg(dir);
  if (el < MIN_DEPRESSION) return null;
  return (camHeight / Math.sin(rad(el)) ** 2) * rad(1);
}

/** Ceiling height from aiming at the wall/ceiling line directly above a corner `horizDist` cm away. */
export function ceilingHeightFrom(dir: Dir, camHeight: number, horizDist: number): number | null {
  const el = elevationDeg(dir);
  if (el < 3) return null;
  return camHeight + horizDist * Math.tan(rad(el));
}

/* ---------------- Cleaning up a scan ---------------- */

/** Drops points that sit on top of their predecessor (double taps). */
export function dedupe(pts: Pt[], minGap = 15): Pt[] {
  const out: Pt[] = [];
  for (const p of pts) if (!out.length || dist(out[out.length - 1], p) >= minGap) out.push(p);
  while (out.length > 1 && dist(out[0], out[out.length - 1]) < minGap) out.pop();
  return out;
}

export type Straightened = { corners: Pt[]; map: (p: Pt) => Pt };

/**
 * Snaps a roughly rectilinear outline (all walls within ~22° of two perpendicular directions)
 * to exact right angles. Returns null for rooms with genuinely angled walls.
 */
export function straighten(pts: Pt[]): Straightened | null {
  if (pts.length < 4) return null;
  let sx = 0, sy = 0;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i], b = pts[(i + 1) % pts.length];
    const len = dist(a, b), ang = Math.atan2(b.y - a.y, b.x - a.x);
    sx += len * Math.cos(4 * ang); sy += len * Math.sin(4 * ang);
  }
  const th = Math.atan2(sy, sx) / 4;
  const c = Math.cos(-th), s = Math.sin(-th);
  const map = (p: Pt): Pt => ({ x: p.x * c - p.y * s, y: p.x * s + p.y * c });
  let q = pts.map(map);

  const orient = (a: Pt, b: Pt): 'H' | 'V' => (Math.abs(b.y - a.y) <= Math.abs(b.x - a.x) ? 'H' : 'V');
  const skew = (a: Pt, b: Pt) => {
    const dx = Math.abs(b.x - a.x), dy = Math.abs(b.y - a.y);
    return deg(Math.atan2(Math.min(dx, dy), Math.max(dx, dy)));
  };
  for (let i = 0; i < q.length; i++) if (skew(q[i], q[(i + 1) % q.length]) > 22) return null;

  // Merge consecutive walls running the same way (a corner that was really a straight wall).
  for (let guard = 0; guard < 50 && q.length >= 4; guard++) {
    const n = q.length;
    let merged = false;
    for (let i = 0; i < n; i++) {
      if (orient(q[i], q[(i + 1) % n]) === orient(q[(i + 1) % n], q[(i + 2) % n])) {
        q = q.filter((_, k) => k !== (i + 1) % n);
        merged = true;
        break;
      }
    }
    if (!merged) break;
  }
  const n = q.length;
  if (n < 4 || n % 2) return null;
  const o = q.map((p, i) => orient(p, q[(i + 1) % n]));
  if (o.some((v, i) => v === o[(i + 1) % n])) return null;

  // Each wall becomes the line through the middle of its two endpoints.
  const line = q.map((p, i) => {
    const r = q[(i + 1) % n];
    return o[i] === 'H' ? (p.y + r.y) / 2 : (p.x + r.x) / 2;
  });
  const corners: Pt[] = q.map((_, i) => {
    const prev = (i - 1 + n) % n;
    return o[prev] === 'H' ? { x: Math.round(line[i]), y: Math.round(line[prev]) } : { x: Math.round(line[prev]), y: Math.round(line[i]) };
  });
  return { corners, map };
}

/** Builds an ordinary, editable room from raw scan data. */
export function buildRoom(scan: ScanResult, opts: { name: string; straighten: boolean; ceilingHeight?: number }): Room {
  let pts = dedupe(scan.corners);
  let map = (p: Pt): Pt => p;
  if (opts.straighten) {
    const st = straighten(pts);
    if (st) { pts = st.corners; map = st.map; }
  }
  // Move to the origin, clockwise, whole centimetres.
  const minX = Math.min(...pts.map((p) => p.x)), minY = Math.min(...pts.map((p) => p.y));
  const shift = (p: Pt): Pt => ({ x: p.x - minX, y: p.y - minY });
  const corners = ensureClockwise(pts.map((p) => {
    const q = shift(p);
    return { x: Math.round(q.x), y: Math.round(q.y) };
  }));
  const room = newRoom(opts.name, corners, Math.round(opts.ceilingHeight ?? scan.ceilingHeight ?? 250));

  const ws = walls(room.corners);
  const openings: Opening[] = [];
  for (const so of scan.openings) {
    const a = shift(map(so.a)), b = shift(map(so.b));
    const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    let best: { w: (typeof ws)[number]; d: number } | null = null;
    for (const w of ws) {
      const t = Math.max(0, Math.min(w.length, (mid.x - w.a.x) * w.dir.x + (mid.y - w.a.y) * w.dir.y));
      const d = Math.hypot(mid.x - (w.a.x + w.dir.x * t), mid.y - (w.a.y + w.dir.y * t));
      if (!best || d < best.d) best = { w, d };
    }
    if (!best || best.d > 60) continue; // not near any wall
    const w = best.w;
    const ta = (a.x - w.a.x) * w.dir.x + (a.y - w.a.y) * w.dir.y;
    const tb = (b.x - w.a.x) * w.dir.x + (b.y - w.a.y) * w.dir.y;
    const lo = Math.max(0, Math.min(ta, tb)), hi = Math.min(w.length, Math.max(ta, tb));
    if (hi - lo < 20) continue;
    const base = defaultOpening(so.kind, w.index);
    openings.push(clampOpening(room, { ...base, offset: Math.round(lo), width: Math.round(hi - lo), height: so.height, sill: so.sill }));
  }
  return { ...room, openings };
}
