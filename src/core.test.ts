import { describe, expect, it } from 'vitest';
import { fmtLen, parseLen } from './units';
import { convexOverlap, findProblems, itemCorners, lShapeCorners, polygonArea, rectCorners, setWallLength, snapItem, walls } from './geometry';
import type { Furniture } from './types';

const item = (p: Partial<Furniture>): Furniture => ({
  id: 'a', name: 'a', category: 'other', shape: 'box', x: 100, y: 100, width: 100, depth: 50, height: 50,
  rotation: 0, color: '#fff', material: 'matte', locked: false, flat: false, ...p,
});

describe('units', () => {
  it('parses metric', () => {
    expect(parseLen('320', 'metric')).toBe(320);
    expect(parseLen('3,2 m', 'metric')).toBeCloseTo(320);
    expect(parseLen('abc', 'metric')).toBeNull();
  });
  it('parses imperial', () => {
    expect(parseLen(`8'6"`, 'imperial')).toBeCloseTo(259.08);
    expect(parseLen('102', 'imperial')).toBeCloseTo(259.08);
  });
  it('formats', () => {
    expect(fmtLen(320, 'metric')).toBe('3.2 m');
    expect(fmtLen(85, 'metric')).toBe('85 cm');
    expect(fmtLen(259.08, 'imperial')).toBe(`8'6"`);
  });
});

describe('geometry', () => {
  it('computes areas', () => {
    expect(polygonArea(rectCorners(400, 300))).toBe(120000);
    expect(polygonArea(lShapeCorners(400, 300, 100, 100))).toBe(110000);
  });
  it('detects overlap but not touching', () => {
    const a = itemCorners(item({ x: 50, y: 25 }));
    expect(convexOverlap(a, itemCorners(item({ x: 140, y: 25 })))).toBe(true);
    expect(convexOverlap(a, itemCorners(item({ x: 150, y: 25 })))).toBe(false);
  });
  it('flags items outside the room and ignores rugs', () => {
    const room = rectCorners(400, 300);
    const p = findProblems([item({ id: 'in', x: 200, y: 150 }), item({ id: 'out', x: 390, y: 150 }), item({ id: 'rug', x: 200, y: 150, flat: true })], room);
    expect(p.get('out')?.outside).toBe(true);
    expect(p.has('in')).toBe(false);
    expect(p.has('rug')).toBe(false);
  });
  it('snaps flush to a wall', () => {
    const r = snapItem(item({ x: 100, y: 30, rotation: 3 }), [], rectCorners(400, 300));
    expect(r.rotation).toBe(0);
    expect(r.y).toBeCloseTo(25);
  });
  it('keeps rectangles square when a wall length changes', () => {
    const c = setWallLength(rectCorners(400, 300), 0, 500);
    expect(c[1]).toEqual({ x: 500, y: 0 });
    expect(c[2]).toEqual({ x: 500, y: 300 });
    expect(walls(c)[2].length).toBeCloseTo(500);
  });
});

import { analyzeWalkways, checkDoors } from './analysis';
import type { Room } from './types';

const room = (over: Partial<Room> = {}): Room => ({
  id: 'r', name: 'r', corners: rectCorners(400, 300), ceilingHeight: 250, openings: [], layouts: [], activeLayoutId: '', updatedAt: 0, ...over,
});
const box = (id: string, x0: number, y0: number, x1: number, y1: number) =>
  item({ id, x: (x0 + x1) / 2, y: (y0 + y1) / 2, width: x1 - x0, depth: y1 - y0 });

describe('walkways', () => {
  it('flags a 50 cm gap between two wardrobes that divide the room', () => {
    const items = [box('a', 150, 0, 250, 125), box('b', 150, 175, 250, 300)];
    expect(analyzeWalkways(room(), items, 70).count).toBeGreaterThan(0);
  });
  it('flags a lane between a bed and a wardrobe in an open room', () => {
    const items = [box('a', 100, 10, 250, 70), box('b', 100, 116, 260, 316)];
    expect(analyzeWalkways(room(), items, 70).count).toBeGreaterThan(0);
  });
  it('does not flag room corners or furniture standing free', () => {
    expect(analyzeWalkways(room(), [box('a', 150, 100, 250, 200)], 70).count).toBe(0);
    expect(analyzeWalkways(room(), [box('a', 0, 0, 100, 60)], 70).count).toBe(0);
  });
  it('accepts an 90 cm gap and an empty room', () => {
    const items = [box('a', 150, 0, 250, 105), box('b', 150, 195, 250, 300)];
    expect(analyzeWalkways(room(), items, 70).count).toBe(0);
    expect(analyzeWalkways(room(), [], 70).count).toBe(0);
  });
  it('detects a door blocked by furniture', () => {
    const r = room({ openings: [{ id: 'd', kind: 'door', wall: 0, offset: 50, width: 90, height: 205, sill: 0, swing: 'in', hinge: 'start' }] });
    expect(checkDoors(r, [box('a', 60, 20, 140, 70)])[0].blocked).toBe(true);
    expect(checkDoors(r, [box('a', 250, 150, 330, 200)])[0].blocked).toBe(false);
  });
});

import { planSync } from './cloud';

describe('sync planning', () => {
  const R = (id: string, updatedAt: number) => room({ id, updatedAt });
  const rem = (rows: [string, number, boolean?][]) => new Map(rows.map(([id, t, d]) => [id, { id, client_updated_at: t, deleted: !!d }]));
  it('pushes new local rooms and pulls new remote rooms', () => {
    const p = planSync([R('a', 5)], rem([['b', 9]]), []);
    expect(p.push.map((r) => r.id)).toEqual(['a']);
    expect(p.pullIds).toEqual(['b']);
  });
  it('last write wins in both directions', () => {
    const p = planSync([R('a', 10), R('b', 5)], rem([['a', 7], ['b', 8]]), []);
    expect(p.push.map((r) => r.id)).toEqual(['a']);
    expect(p.pullIds).toEqual(['b']);
  });
  it('does nothing when in sync', () => {
    const p = planSync([R('a', 7)], rem([['a', 7]]), []);
    expect(p.push).toEqual([]); expect(p.pullIds).toEqual([]); expect(p.removeIds).toEqual([]);
  });
  it('applies remote deletions unless edited afterwards', () => {
    expect(planSync([R('a', 5)], rem([['a', 9, true]]), []).removeIds).toEqual(['a']);
    expect(planSync([R('a', 12)], rem([['a', 9, true]]), []).push.map((r) => r.id)).toEqual(['a']);
  });
  it('does not resurrect rooms deleted on this device', () => {
    const p = planSync([], rem([['a', 5]]), ['a']);
    expect(p.pullIds).toEqual([]);
  });
});
