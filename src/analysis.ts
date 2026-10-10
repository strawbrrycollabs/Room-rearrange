import type { Furniture, Opening, Pt, Room } from './types';
import { bounds, convexOverlap, itemCorners, pointInPolygon, rad, walls, wallPoint } from './geometry';

export type DoorCheck = { id: string; blocked: boolean; swing: Pt[] };
export type Walkways = {
  cell: number;
  /** Centres of cells that make up narrow passages. */
  narrow: Pt[];
  /** Number of separate narrow passages. */
  count: number;
  doors: DoorCheck[];
};

/** Quarter-disc swept by a door leaf (convex), or null for doors that open outwards. */
export function doorSwing(room: Pick<Room, 'corners'>, o: Opening): Pt[] | null {
  if (o.kind !== 'door' || o.swing === 'out') return null;
  const w = walls(room.corners)[o.wall];
  if (!w) return null;
  const hingeT = o.hinge === 'start' ? o.offset : o.offset + o.width;
  const H = wallPoint(w, hingeT);
  const sgn = o.hinge === 'start' ? 1 : -1;
  const u = { x: w.dir.x * sgn, y: w.dir.y * sgn };
  const v = w.normal;
  const pts: Pt[] = [H];
  for (let a = 0; a <= 90; a += 10) {
    const t = rad(a);
    pts.push({ x: H.x + (u.x * Math.cos(t) + v.x * Math.sin(t)) * o.width, y: H.y + (u.y * Math.cos(t) + v.y * Math.sin(t)) * o.width });
  }
  return pts;
}

export function checkDoors(room: Room, items: Furniture[]): DoorCheck[] {
  const solid = items.filter((i) => !i.flat).map((i) => itemCorners(i));
  const out: DoorCheck[] = [];
  for (const o of room.openings) {
    const swing = doorSwing(room, o);
    if (!swing) continue;
    out.push({ id: o.id, swing, blocked: solid.some((p) => convexOverlap(swing, p, 1)) });
  }
  return out;
}

const INF = 1e9;

/**
 * Finds lanes narrower than `minWidth` between walls/furniture that connect to open floor
 * (or to a door). Gaps under ~25 cm count as closed, not as paths. Works on a coarse grid.
 */
export function analyzeWalkways(room: Room, items: Furniture[], minWidth = 70, cell = 5): Walkways {
  const doors = checkDoors(room, items);
  const b = bounds(room.corners);
  const nx = Math.ceil(b.w / cell) + 1, ny = Math.ceil(b.h / cell) + 1;
  const solids = items.filter((i) => !i.flat).map((i) => itemCorners(i));
  const sb = solids.map((p) => bounds(p));
  const N = nx * ny;
  const blocked = new Uint8Array(N);
  const cx = (i: number) => b.minX + (i % nx) * cell + cell / 2;
  const cy = (i: number) => b.minY + Math.floor(i / nx) * cell + cell / 2;

  for (let i = 0; i < N; i++) {
    const p = { x: cx(i), y: cy(i) };
    if (!pointInPolygon(p, room.corners)) { blocked[i] = 1; continue; }
    for (let s = 0; s < solids.length; s++) {
      const bb = sb[s];
      if (p.x < bb.minX || p.x > bb.maxX || p.y < bb.minY || p.y > bb.maxY) continue;
      if (pointInPolygon(p, solids[s])) { blocked[i] = 1; break; }
    }
  }

  // Chamfer 3-4 distance transform (units of 1/3 cell).
  const d = new Int32Array(N);
  for (let i = 0; i < N; i++) d[i] = blocked[i] ? 0 : INF;
  const at = (x: number, y: number) => (x < 0 || y < 0 || x >= nx || y >= ny ? 0 : d[y * nx + x]);
  for (let y = 0; y < ny; y++) for (let x = 0; x < nx; x++) {
    const i = y * nx + x;
    if (!d[i]) continue;
    d[i] = Math.min(d[i], at(x - 1, y) + 3, at(x, y - 1) + 3, at(x - 1, y - 1) + 4, at(x + 1, y - 1) + 4);
  }
  for (let y = ny - 1; y >= 0; y--) for (let x = nx - 1; x >= 0; x--) {
    const i = y * nx + x;
    if (!d[i]) continue;
    d[i] = Math.min(d[i], at(x + 1, y) + 3, at(x, y + 1) + 3, at(x + 1, y + 1) + 4, at(x - 1, y + 1) + 4);
  }
  const clear = (i: number) => (d[i] / 3) * cell - cell / 2;

  const r = minWidth / 2;
  const minSqueeze = 12.5;
  const core = new Int32Array(N); // component id (1-based) for open areas
  let nCore = 0;
  const stack: number[] = [];
  for (let i = 0; i < N; i++) {
    if (blocked[i] || core[i] || clear(i) < r) continue;
    core[i] = ++nCore;
    stack.push(i);
    while (stack.length) {
      const c = stack.pop()!;
      const x = c % nx, y = (c / nx) | 0;
      for (const [ax, ay] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const X = x + ax, Y = y + ay;
        if (X < 0 || Y < 0 || X >= nx || Y >= ny) continue;
        const j = Y * nx + X;
        if (!blocked[j] && !core[j] && clear(j) >= r) { core[j] = nCore; stack.push(j); }
      }
    }
  }

  // Doors count as extra "areas" so a narrow lane to a door is caught.
  const doorId = new Map<string, number>();
  const ws = walls(room.corners);
  const doorCells: { id: number; p: Pt }[] = [];
  for (const o of room.openings) {
    if (o.kind !== 'door') continue;
    const w = ws[o.wall];
    if (!w) continue;
    const landing = wallPoint(w, o.offset + o.width / 2, 45);
    const li = Math.floor((landing.y - b.minY) / cell) * nx + Math.floor((landing.x - b.minX) / cell);
    // A landing that already sits in an open area needs no special treatment.
    if (li >= 0 && li < N && (core[li] || blocked[li])) continue;
    const id = nCore + 1 + doorId.size;
    doorId.set(o.id, id);
    doorCells.push({ id, p: landing });
  }
  const regionAt = (i: number): number => {
    if (core[i]) return core[i];
    const p = { x: cx(i), y: cy(i) };
    for (const dc of doorCells) if (Math.hypot(dc.p.x - p.x, dc.p.y - p.y) < 40) return dc.id;
    return 0;
  };

  // True when solid sits on both sides of the cell (so it is a lane, not a room corner).
  const solidAt = (x: number, y: number) => x < 0 || y < 0 || x >= nx || y >= ny || blocked[y * nx + x] === 1;
  const opposed = (x: number, y: number, c: number) => {
    const K = Math.ceil((c * 1.5) / cell) + 2;
    for (const [dx, dy] of [[1, 0], [0, 1]]) {
      let a = false, z = false;
      for (let k = 1; k <= K && !(a && z); k++) {
        if (!a && solidAt(x + dx * k, y + dy * k)) a = true;
        if (!z && solidAt(x - dx * k, y - dy * k)) z = true;
      }
      if (a && z) return true;
    }
    return false;
  };

  // Ridge cells: narrow free cells at a local clearance maximum across the passage.
  const ridge: number[] = [];
  for (let y = 1; y < ny - 1; y++) for (let x = 1; x < nx - 1; x++) {
    const i = y * nx + x;
    if (blocked[i]) continue;
    const c = clear(i);
    if (c >= r || c < minSqueeze) continue;
    const h = c >= clear(i - 1) && c >= clear(i + 1) && (c > clear(i - 1) || c > clear(i + 1));
    const v = c >= clear(i - nx) && c >= clear(i + nx) && (c > clear(i - nx) || c > clear(i + nx));
    if ((h || v) && opposed(x, y, c)) ridge.push(i);
  }

  // Group ridge cells (8-connected) and keep groups that touch two different regions.
  const isRidge = new Uint8Array(N);
  for (const i of ridge) isRidge[i] = 1;
  const seen = new Uint8Array(N);
  const narrow = new Set<number>();
  let count = 0;
  const reach = Math.ceil(r / cell) + 2; // ridge ends where the passage opens into the room
  for (const s of ridge) {
    if (seen[s]) continue;
    const comp: number[] = [];
    const regions = new Set<number>();
    seen[s] = 1; stack.push(s);
    while (stack.length) {
      const c = stack.pop()!;
      comp.push(c);
      const x = c % nx, y = (c / nx) | 0;
      for (let ay = -reach; ay <= reach; ay++) for (let ax = -reach; ax <= reach; ax++) {
        const X = x + ax, Y = y + ay;
        if (X < 0 || Y < 0 || X >= nx || Y >= ny) continue;
        const j = Y * nx + X;
        const reg = regionAt(j);
        if (reg) regions.add(reg);
        if (Math.abs(ax) <= 1 && Math.abs(ay) <= 1 && isRidge[j] && !seen[j]) { seen[j] = 1; stack.push(j); }
      }
    }
    if (regions.size < 1 || comp.length < 3) continue;
    count++;
    // Paint the gap itself: free cells within the passage half-width of the ridge.
    for (const c of comp) {
      const x = c % nx, y = (c / nx) | 0;
      const rad2 = Math.ceil(clear(c) / cell) + 1;
      for (let ay = -rad2; ay <= rad2; ay++) for (let ax = -rad2; ax <= rad2; ax++) {
        const X = x + ax, Y = y + ay;
        if (X < 0 || Y < 0 || X >= nx || Y >= ny) continue;
        const j = Y * nx + X;
        if (!blocked[j] && Math.hypot(ax, ay) * cell <= clear(c) + cell) narrow.add(j);
      }
    }
  }
  return { cell, narrow: [...narrow].map((i) => ({ x: cx(i), y: cy(i) })), count, doors };
}

/** Share of the floor covered by furniture (flat items excluded), 0..1. */
export function floorCoverage(room: Room, items: Furniture[]): number {
  let area = 0;
  for (const it of items) if (!it.flat) area += it.width * it.depth * (it.shape === 'round' ? Math.PI / 4 : 1);
  let a = 0;
  const c = room.corners;
  for (let i = 0; i < c.length; i++) { const q = c[(i + 1) % c.length]; a += c[i].x * q.y - q.x * c[i].y; }
  return Math.min(1, area / Math.abs(a / 2));
}
