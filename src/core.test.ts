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
