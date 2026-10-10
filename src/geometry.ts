import type { Furniture, Opening, Pt, Room } from './types';

export const dist = (a: Pt, b: Pt) => Math.hypot(b.x - a.x, b.y - a.y);
export const rad = (deg: number) => (deg * Math.PI) / 180;
export const deg = (r: number) => (r * 180) / Math.PI;
export const normDeg = (d: number) => ((d % 360) + 360) % 360;

/** Positive when the polygon is clockwise on screen (y down). */
export function signedArea(p: Pt[]): number {
  let a = 0;
  for (let i = 0; i < p.length; i++) {
    const q = p[(i + 1) % p.length];
    a += p[i].x * q.y - q.x * p[i].y;
  }
  return a / 2;
}

export const polygonArea = (p: Pt[]) => Math.abs(signedArea(p));

export function ensureClockwise(p: Pt[]): Pt[] {
  return signedArea(p) < 0 ? [...p].reverse() : p;
}

export function bounds(p: Pt[]) {
  const xs = p.map((q) => q.x);
  const ys = p.map((q) => q.y);
  const minX = Math.min(...xs), maxX = Math.max(...xs);
  const minY = Math.min(...ys), maxY = Math.max(...ys);
  return { minX, minY, maxX, maxY, w: maxX - minX, h: maxY - minY };
}

export function pointInPolygon(pt: Pt, poly: Pt[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i], b = poly[j];
    if (a.y > pt.y !== b.y > pt.y && pt.x < ((b.x - a.x) * (pt.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

export type Wall = { index: number; a: Pt; b: Pt; length: number; dir: Pt; normal: Pt; angle: number };

/** Walls with unit direction and inward normal (corners must be clockwise). */
export function walls(corners: Pt[]): Wall[] {
  return corners.map((a, i) => {
    const b = corners[(i + 1) % corners.length];
    const length = dist(a, b) || 1e-6;
    const dir = { x: (b.x - a.x) / length, y: (b.y - a.y) / length };
    return { index: i, a, b, length, dir, normal: { x: -dir.y, y: dir.x }, angle: deg(Math.atan2(dir.y, dir.x)) };
  });
}

export function wallPoint(w: Wall, t: number, inward = 0): Pt {
  return { x: w.a.x + w.dir.x * t + w.normal.x * inward, y: w.a.y + w.dir.y * t + w.normal.y * inward };
}

/** Four corners of an item's footprint, in room coordinates. */
export function itemCorners(it: Pick<Furniture, 'x' | 'y' | 'width' | 'depth' | 'rotation'>): Pt[] {
  const r = rad(it.rotation);
  const c = Math.cos(r), s = Math.sin(r);
  const hw = it.width / 2, hd = it.depth / 2;
  return [[-hw, -hd], [hw, -hd], [hw, hd], [-hw, hd]].map(([lx, ly]) => ({
    x: it.x + lx * c - ly * s,
    y: it.y + lx * s + ly * c,
  }));
}

/** Separating-axis test for two convex polygons; touching edges do not overlap. */
export function convexOverlap(a: Pt[], b: Pt[], eps = 0.5): boolean {
  for (const poly of [a, b]) {
    for (let i = 0; i < poly.length; i++) {
      const p = poly[i], q = poly[(i + 1) % poly.length];
      const ax = -(q.y - p.y), ay = q.x - p.x;
      const len = Math.hypot(ax, ay) || 1;
      let minA = Infinity, maxA = -Infinity, minB = Infinity, maxB = -Infinity;
      for (const v of a) { const d = (v.x * ax + v.y * ay) / len; minA = Math.min(minA, d); maxA = Math.max(maxA, d); }
      for (const v of b) { const d = (v.x * ax + v.y * ay) / len; minB = Math.min(minB, d); maxB = Math.max(maxB, d); }
      if (maxA <= minB + eps || maxB <= minA + eps) return false;
    }
  }
  return true;
}

function segIntersect(p1: Pt, p2: Pt, p3: Pt, p4: Pt): boolean {
  const d = (p2.x - p1.x) * (p4.y - p3.y) - (p2.y - p1.y) * (p4.x - p3.x);
  if (Math.abs(d) < 1e-9) return false;
  const t = ((p3.x - p1.x) * (p4.y - p3.y) - (p3.y - p1.y) * (p4.x - p3.x)) / d;
  const u = ((p3.x - p1.x) * (p2.y - p1.y) - (p3.y - p1.y) * (p2.x - p1.x)) / d;
  const e = 1e-6;
  return t > e && t < 1 - e && u > e && u < 1 - e;
}

/** True when the footprint lies entirely inside the room (small tolerance). */
export function itemInsideRoom(it: Furniture, corners: Pt[]): boolean {
  const fp = itemCorners(it);
  const shrunk = itemCorners({ ...it, width: it.width - 1, depth: it.depth - 1 });
  if (!shrunk.every((p) => pointInPolygon(p, corners))) return false;
  for (let i = 0; i < 4; i++) {
    for (let j = 0; j < corners.length; j++) {
      if (segIntersect(fp[i], fp[(i + 1) % 4], corners[j], corners[(j + 1) % corners.length])) {
        // Edge crossing only counts when it goes beyond the tolerance.
        const mid = { x: (fp[i].x + fp[(i + 1) % 4].x) / 2, y: (fp[i].y + fp[(i + 1) % 4].y) / 2 };
        if (!pointInPolygon(mid, corners)) return false;
      }
    }
  }
  return true;
}

export type Problem = { overlaps: string[]; outside: boolean };

/** Maps item id -> problems. Items without problems are absent. */
export function findProblems(items: Furniture[], corners: Pt[]): Map<string, Problem> {
  const out = new Map<string, Problem>();
  const get = (id: string) => {
    let p = out.get(id);
    if (!p) out.set(id, (p = { overlaps: [], outside: false }));
    return p;
  };
  const fps = items.map((i) => itemCorners(i));
  for (let i = 0; i < items.length; i++) {
    if (!items[i].flat && !itemInsideRoom(items[i], corners)) get(items[i].id).outside = true;
    for (let j = i + 1; j < items.length; j++) {
      if (items[i].flat || items[j].flat) continue;
      if (convexOverlap(fps[i], fps[j])) {
        get(items[i].id).overlaps.push(items[j].id);
        get(items[j].id).overlaps.push(items[i].id);
      }
    }
  }
  return out;
}

export function openingMax(room: Pick<Room, 'corners'>, wall: number): number {
  const c = room.corners;
  return dist(c[wall], c[(wall + 1) % c.length]);
}

export function clampOpening(room: Pick<Room, 'corners'>, o: Opening): Opening {
  const wall = Math.min(Math.max(0, o.wall), room.corners.length - 1);
  const len = openingMax(room, wall);
  const width = Math.min(Math.max(10, o.width), Math.max(10, len));
  const offset = Math.min(Math.max(0, o.offset), Math.max(0, len - width));
  return { ...o, wall, width, offset };
}

export type SnapResult = { x: number; y: number; rotation: number; snapped: boolean };

/**
 * Snaps an item to the nearest wall (flush, aligned) or to other items' edges.
 * `threshold` is in cm.
 */
export function snapItem(
  it: Furniture,
  others: Furniture[],
  corners: Pt[],
  threshold = 12,
): SnapResult {
  let { x, y, rotation } = it;
  let snapped = false;

  // Wall snap: align rotation to the wall and put the nearest side flush.
  let best: { gap: number; w: Wall } | null = null;
  const ws = walls(corners);
  for (const w of ws) {
    const fp = itemCorners({ x, y, width: it.width, depth: it.depth, rotation });
    let minD = Infinity;
    for (const p of fp) minD = Math.min(minD, (p.x - w.a.x) * w.normal.x + (p.y - w.a.y) * w.normal.y);
    const centreD = (x - w.a.x) * w.normal.x + (y - w.a.y) * w.normal.y;
    // Only consider walls the item is actually beside (projection within the wall).
    const t = (x - w.a.x) * w.dir.x + (y - w.a.y) * w.dir.y;
    if (t < -it.width || t > w.length + it.width) continue;
    if (centreD < -threshold) continue;
    const gap = Math.abs(minD);
    if (gap <= threshold && (!best || gap < best.gap)) best = { gap, w };
  }
  if (best) {
    const w = best.w;
    // Align rotation so the item's back (local -y) faces the wall: rotation = wallAngle (back toward the wall).
    const candidates = [0, 90, 180, 270].map((q) => normDeg(w.angle + q));
    const near = candidates.find((c) => Math.abs(angleDiff(c, rotation)) <= 20);
    if (near !== undefined) rotation = near;
    const fp = itemCorners({ x, y, width: it.width, depth: it.depth, rotation });
    let minD = Infinity;
    for (const p of fp) minD = Math.min(minD, (p.x - w.a.x) * w.normal.x + (p.y - w.a.y) * w.normal.y);
    x -= w.normal.x * minD;
    y -= w.normal.y * minD;
    snapped = true;
  }

  // Item-edge snap on axis-aligned bounding boxes.
  const aabb = (f: Pick<Furniture, 'x' | 'y' | 'width' | 'depth' | 'rotation'>) => bounds(itemCorners(f));
  const me = aabb({ x, y, width: it.width, depth: it.depth, rotation });
  let dx = 0, dy = 0, bestDx = threshold + 1, bestDy = threshold + 1;
  for (const o of others) {
    if (o.id === it.id || o.flat) continue;
    const ob = aabb(o);
    const overlapY = me.minY < ob.maxY + threshold && me.maxY > ob.minY - threshold;
    const overlapX = me.minX < ob.maxX + threshold && me.maxX > ob.minX - threshold;
    if (overlapY) {
      for (const d of [ob.minX - me.maxX, ob.maxX - me.minX, ob.minX - me.minX, ob.maxX - me.maxX]) {
        if (Math.abs(d) < bestDx) { bestDx = Math.abs(d); dx = d; }
      }
    }
    if (overlapX) {
      for (const d of [ob.minY - me.maxY, ob.maxY - me.minY, ob.minY - me.minY, ob.maxY - me.maxY]) {
        if (Math.abs(d) < bestDy) { bestDy = Math.abs(d); dy = d; }
      }
    }
  }
  if (bestDx <= threshold) { x += dx; snapped = true; }
  if (bestDy <= threshold) { y += dy; snapped = true; }
  return { x, y, rotation, snapped };
}

export const angleDiff = (a: number, b: number) => ((a - b + 540) % 360) - 180;

/** Moves wall `i` to a new length. Rectilinear neighbours move together so shapes stay square. */
export function setWallLength(corners: Pt[], i: number, newLen: number): Pt[] {
  const n = corners.length;
  const ws = walls(corners);
  const w = ws[i];
  const delta = newLen - w.length;
  const out = corners.map((p) => ({ ...p }));
  const move = (idx: number) => {
    out[idx].x += w.dir.x * delta;
    out[idx].y += w.dir.y * delta;
  };
  move((i + 1) % n);
  const next = ws[(i + 1) % n];
  if (Math.abs(next.dir.x * w.dir.x + next.dir.y * w.dir.y) < 1e-3) move((i + 2) % n);
  return out;
}

export function rectCorners(w: number, l: number): Pt[] {
  return [{ x: 0, y: 0 }, { x: w, y: 0 }, { x: w, y: l }, { x: 0, y: l }];
}

/** L-shape: bounding w x l with a notch (nw x nl) removed from the chosen corner. */
export function lShapeCorners(w: number, l: number, nw: number, nl: number, notch: 'tl' | 'tr' | 'br' | 'bl' = 'tr'): Pt[] {
  switch (notch) {
    case 'tr': return [{ x: 0, y: 0 }, { x: w - nw, y: 0 }, { x: w - nw, y: nl }, { x: w, y: nl }, { x: w, y: l }, { x: 0, y: l }];
    case 'tl': return [{ x: nw, y: 0 }, { x: w, y: 0 }, { x: w, y: l }, { x: 0, y: l }, { x: 0, y: nl }, { x: nw, y: nl }];
    case 'br': return [{ x: 0, y: 0 }, { x: w, y: 0 }, { x: w, y: l - nl }, { x: w - nw, y: l - nl }, { x: w - nw, y: l }, { x: 0, y: l }];
    case 'bl': return [{ x: 0, y: 0 }, { x: w, y: 0 }, { x: w, y: l }, { x: nw, y: l }, { x: nw, y: l - nl }, { x: 0, y: l - nl }];
  }
}
