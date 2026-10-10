import { describe, expect, it } from 'vitest';
import { buildRoom, ceilingHeightFrom, floorHit, lookDirection, straighten, type ScanResult } from './scan/geometry';
import { bounds, polygonArea, walls } from './geometry';
import type { Pt } from './types';

/** Orientation angles for a phone held upright at compass heading `h` (deg clockwise from north), looking `el` deg above the horizon. */
const aim = (heading: number, el: number) => lookDirection(-heading, 90 + el, 0);

/** What the phone reads when standing at `from` aiming at floor point `to` (plan coords: x east, y south). */
function aimAt(from: Pt, to: Pt, camH: number) {
  const dx = to.x - from.x, dnorth = -(to.y - from.y);
  const d = Math.hypot(dx, dnorth);
  return aim((Math.atan2(dx, dnorth) * 180) / Math.PI, -(Math.atan2(camH, d) * 180) / Math.PI);
}

describe('orientation maths', () => {
  it('upright phone looks at the horizon along the heading', () => {
    const d = aim(90, 0);
    expect(d.east).toBeCloseTo(1); expect(d.north).toBeCloseTo(0); expect(d.up).toBeCloseTo(0);
  });
  it('phone lying flat looks straight down', () => {
    expect(lookDirection(0, 0, 0).up).toBeCloseTo(-1);
  });
  it('recovers a floor point from the aim direction', () => {
    const p = floorHit(aimAt({ x: 0, y: 0 }, { x: 200, y: -150 }, 140), 140)!;
    expect(p.x).toBeCloseTo(200, 0); expect(p.y).toBeCloseTo(-150, 0);
  });
  it('rejects aims that are too level or straight down', () => {
    expect(floorHit(aim(0, -2), 140)).toBeNull();
    expect(floorHit(aim(0, -89), 140)).toBeNull();
  });
  it('measures ceiling height from the wall/ceiling line above a corner', () => {
    const dist = 300, h = 140, ceil = 250;
    const el = (Math.atan2(ceil - h, dist) * 180) / Math.PI;
    expect(ceilingHeightFrom(aim(0, el), h, dist)).toBeCloseTo(ceil, 0);
  });
});

describe('scan to room', () => {
  const rect: Pt[] = [{ x: 0, y: 0 }, { x: 400, y: 0 }, { x: 400, y: 300 }, { x: 0, y: 300 }];
  const station = { x: 150, y: 120 };
  const scanFrom = (corners: Pt[]): ScanResult => ({
    source: 'aim', openings: [],
    corners: corners.map((c) => floorHit(aimAt(station, c, 140), 140)!).map((p) => ({ x: p.x + station.x, y: p.y + station.y })),
  });

  it('rebuilds a rectangle exactly from perfect readings', () => {
    const r = buildRoom(scanFrom(rect), { name: 't', straighten: true });
    const b = bounds(r.corners);
    expect(Math.round(b.w)).toBe(400); expect(Math.round(b.h)).toBe(300);
  });

  it('straightens wobbly corners to right angles', () => {
    const wobbly = rect.map((p, i) => ({ x: p.x + [6, -9, 7, -5][i], y: p.y + [-8, 5, 9, -6][i] }));
    const r = buildRoom({ corners: wobbly, openings: [], source: 'aim' }, { name: 't', straighten: true });
    const ws = walls(r.corners);
    for (const w of ws) expect(Math.min(Math.abs(w.dir.x), Math.abs(w.dir.y))).toBeLessThan(1e-9);
    expect(polygonArea(r.corners)).toBeGreaterThan(110000);
  });

  it('keeps an L-shape as an L-shape', () => {
    const l: Pt[] = [{ x: 3, y: -4 }, { x: 205, y: 5 }, { x: 198, y: 110 }, { x: 410, y: 104 }, { x: 405, y: 300 }, { x: -4, y: 296 }];
    const r = buildRoom({ corners: l, openings: [], source: 'ar' }, { name: 'L', straighten: true });
    expect(r.corners).toHaveLength(6);
    expect(straighten(l)).not.toBeNull();
  });

  it('leaves angled rooms alone', () => {
    const hex: Pt[] = [{ x: 100, y: 0 }, { x: 300, y: 0 }, { x: 400, y: 170 }, { x: 300, y: 340 }, { x: 100, y: 340 }, { x: 0, y: 170 }];
    expect(straighten(hex)).toBeNull();
    expect(buildRoom({ corners: hex, openings: [], source: 'ar' }, { name: 'h', straighten: true }).corners).toHaveLength(6);
  });

  it('places doors and windows on the nearest wall', () => {
    const scan: ScanResult = {
      corners: rect, source: 'aim',
      openings: [
        { kind: 'window', a: { x: 100, y: 3 }, b: { x: 220, y: -2 }, height: 130, sill: 90 },
        { kind: 'door', a: { x: 398, y: 80 }, b: { x: 402, y: 170 }, height: 205, sill: 0 },
        { kind: 'door', a: { x: 200, y: 150 }, b: { x: 260, y: 150 }, height: 205, sill: 0 }, // floating in the room: dropped
      ],
    };
    const r = buildRoom(scan, { name: 't', straighten: true });
    expect(r.openings).toHaveLength(2);
    const win = r.openings.find((o) => o.kind === 'window')!;
    expect(win.wall).toBe(0); expect(win.offset).toBe(100); expect(win.width).toBe(120);
    const door = r.openings.find((o) => o.kind === 'door')!;
    expect(door.wall).toBe(1); expect(door.offset).toBe(80); expect(door.width).toBe(90);
  });

  it('keeps clockwise order whichever way the user walked', () => {
    const r = buildRoom({ corners: [...rect].reverse(), openings: [], source: 'aim' }, { name: 't', straighten: false });
    expect(r.corners).toHaveLength(4);
    expect(polygonArea(r.corners)).toBe(120000);
  });
});
