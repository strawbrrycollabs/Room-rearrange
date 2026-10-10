import { create } from 'zustand';
import type { Furniture, Layout, Opening, OpeningKind, Pt, Room, Theme, Unit } from './types';
import { uid } from './catalog';
import { bounds, clampOpening, dist, ensureClockwise, rectCorners } from './geometry';

const KEY = 'roomshift:v1';
const MAX_HISTORY = 100;

type Persisted = { rooms: Room[]; unit: Unit; theme: Theme; onboarded: boolean; walkWidth: number; deletedIds: string[] };

function load(): Persisted {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return { rooms: [], unit: 'metric', theme: 'system', onboarded: false, walkWidth: 70, deletedIds: [], ...JSON.parse(raw) };
  } catch { /* storage unavailable */ }
  return { rooms: [], unit: 'metric', theme: 'system', onboarded: false, walkWidth: 70, deletedIds: [] };
}

export function newRoom(name: string, corners: Pt[], ceilingHeight = 250): Room {
  const layout: Layout = { id: uid('l'), name: 'Layout A', items: [] };
  return {
    id: uid('r'),
    name,
    corners: ensureClockwise(corners),
    ceilingHeight,
    openings: [],
    layouts: [layout],
    activeLayoutId: layout.id,
    updatedAt: Date.now(),
  };
}

export const activeLayout = (r: Room): Layout => r.layouts.find((l) => l.id === r.activeLayoutId) ?? r.layouts[0];

export function defaultOpening(kind: OpeningKind, wall: number): Opening {
  const d = {
    door: { width: 90, height: 205, sill: 0 },
    window: { width: 120, height: 130, sill: 90 },
    radiator: { width: 80, height: 60, sill: 15 },
  }[kind];
  return { id: uid('o'), kind, wall, offset: 30, swing: 'in', hinge: 'start', ...d };
}

type State = Persisted & {
  currentId: string | null;
  selectedId: string | null;
  past: Room[];
  future: Room[];
  lastKey: string;
  lastAt: number;

  setWalkWidth(n: number): void;
  setActiveLayout(id: string): void;
  addLayout(copy: boolean): void;
  renameLayout(id: string, name: string): void;
  deleteLayout(id: string): void;
  /** Applies changes pulled from the cloud without touching updatedAt or undo history of other rooms. */
  applyRemote(upsert: Room[], removeIds: string[], clearDeleted: string[]): void;
  clearLocalData(): void;
  setUnit(u: Unit): void;
  setTheme(t: Theme): void;
  finishOnboarding(): void;
  select(id: string | null): void;

  addRoom(r: Room): void;
  openRoom(id: string | null): void;
  deleteRoom(id: string): void;
  renameRoom(id: string, name: string): void;

  /** Records an undo step (coalescing rapid edits sharing a key), then applies fn. */
  edit(fn: (r: Room) => Room, key?: string): void;
  /** Applies fn without recording history (use after checkpoint() during drags). */
  live(fn: (r: Room) => Room): void;
  checkpoint(): void;
  undo(): void;
  redo(): void;

  // Convenience helpers on the active layout.
  updateItem(id: string, patch: Partial<Furniture>, key?: string): void;
  addItem(f: Furniture): void;
  removeItem(id: string): void;
  duplicateItem(id: string): void;
};

const mapLayout = (r: Room, fn: (items: Furniture[]) => Furniture[]): Room => ({
  ...r,
  layouts: r.layouts.map((l) => (l.id === r.activeLayoutId ? { ...l, items: fn(l.items) } : l)),
});

export const useStore = create<State>((set, get) => ({
  ...load(),
  currentId: null,
  selectedId: null,
  past: [],
  future: [],
  lastKey: '',
  lastAt: 0,

  setWalkWidth: (walkWidth) => set({ walkWidth }),
  setActiveLayout: (id) => {
    get().live((r) => (r.layouts.some((l) => l.id === id) ? { ...r, activeLayoutId: id } : r));
    set({ selectedId: null });
  },
  addLayout: (copy) => {
    const id = uid('l');
    get().edit((r) => {
      const used = new Set(r.layouts.map((l) => l.name));
      let n = 0, name = '';
      do { name = `Layout ${String.fromCharCode(65 + (n % 26))}${n >= 26 ? Math.floor(n / 26) : ''}`; n++; } while (used.has(name));
      const src = activeLayout(r);
      const items = copy ? src.items.map((i) => ({ ...i, id: uid('f') })) : [];
      return { ...r, layouts: [...r.layouts, { id, name, items }], activeLayoutId: id };
    });
    set({ selectedId: null });
  },
  renameLayout: (id, name) => get().edit((r) => ({ ...r, layouts: r.layouts.map((l) => (l.id === id ? { ...l, name } : l)) }), `lname:${id}`),
  deleteLayout: (id) => {
    get().edit((r) => {
      if (r.layouts.length <= 1) return r;
      const layouts = r.layouts.filter((l) => l.id !== id);
      return { ...r, layouts, activeLayoutId: r.activeLayoutId === id ? layouts[0].id : r.activeLayoutId };
    });
    set({ selectedId: null });
  },
  applyRemote: (upsert, removeIds, clearDeleted) =>
    set((s) => {
      const byId = new Map(s.rooms.map((r) => [r.id, r]));
      for (const r of upsert) byId.set(r.id, r);
      for (const id of removeIds) byId.delete(id);
      const rooms = [...byId.values()].sort((a, b) => b.updatedAt - a.updatedAt);
      const cur = s.currentId;
      const replaced = cur !== null && (upsert.some((r) => r.id === cur) || removeIds.includes(cur));
      return {
        rooms,
        deletedIds: s.deletedIds.filter((id) => !clearDeleted.includes(id)),
        currentId: cur && removeIds.includes(cur) ? null : cur,
        ...(replaced ? { past: [], future: [], selectedId: null } : {}),
      };
    }),
  clearLocalData: () => set({ rooms: [], deletedIds: [], currentId: null, selectedId: null, past: [], future: [] }),
  setUnit: (unit) => set({ unit }),
  setTheme: (theme) => set({ theme }),
  finishOnboarding: () => set({ onboarded: true }),
  select: (selectedId) => set({ selectedId }),

  addRoom: (r) => set((s) => ({ rooms: [r, ...s.rooms], currentId: r.id, selectedId: null, past: [], future: [] })),
  openRoom: (id) => set({ currentId: id, selectedId: null, past: [], future: [] }),
  deleteRoom: (id) => set((s) => ({ rooms: s.rooms.filter((r) => r.id !== id), deletedIds: [...new Set([...s.deletedIds, id])], currentId: s.currentId === id ? null : s.currentId })),
  renameRoom: (id, name) => set((s) => ({ rooms: s.rooms.map((r) => (r.id === id ? { ...r, name } : r)) })),

  checkpoint: () => {
    const { rooms, currentId, past } = get();
    const cur = rooms.find((r) => r.id === currentId);
    if (!cur) return;
    set({ past: [...past, cur].slice(-MAX_HISTORY), future: [], lastKey: '' });
  },
  live: (fn) =>
    set((s) => ({
      rooms: s.rooms.map((r) => (r.id === s.currentId ? { ...fn(r), updatedAt: Date.now() } : r)),
    })),
  edit: (fn, key = '') => {
    const s = get();
    const now = Date.now();
    const coalesce = key !== '' && key === s.lastKey && now - s.lastAt < 1000;
    if (!coalesce) s.checkpoint();
    s.live(fn);
    set({ lastKey: key, lastAt: now });
  },
  undo: () => {
    const { past, future, rooms, currentId } = get();
    const prev = past[past.length - 1];
    const cur = rooms.find((r) => r.id === currentId);
    if (!prev || !cur) return;
    set({
      past: past.slice(0, -1),
      future: [cur, ...future],
      rooms: rooms.map((r) => (r.id === currentId ? prev : r)),
      lastKey: '',
    });
  },
  redo: () => {
    const { past, future, rooms, currentId } = get();
    const next = future[0];
    const cur = rooms.find((r) => r.id === currentId);
    if (!next || !cur) return;
    set({
      past: [...past, cur],
      future: future.slice(1),
      rooms: rooms.map((r) => (r.id === currentId ? next : r)),
      lastKey: '',
    });
  },

  updateItem: (id, patch, key) =>
    get().edit((r) => mapLayout(r, (items) => items.map((i) => (i.id === id ? { ...i, ...patch } : i))), key ?? `item:${id}:${Object.keys(patch).join()}`),
  addItem: (f) => {
    get().edit((r) => mapLayout(r, (items) => [...items, f]));
    set({ selectedId: f.id });
  },
  removeItem: (id) => {
    get().edit((r) => mapLayout(r, (items) => items.filter((i) => i.id !== id)));
    if (get().selectedId === id) set({ selectedId: null });
  },
  duplicateItem: (id) => {
    const r = get().rooms.find((x) => x.id === get().currentId);
    const src = r && activeLayout(r).items.find((i) => i.id === id);
    if (!src) return;
    const copy: Furniture = { ...src, id: uid('f'), x: src.x + 20, y: src.y + 20, locked: false, name: src.name };
    get().addItem(copy);
  },
}));

// Persist (rooms are small; debounce to keep drags smooth).
let timer: ReturnType<typeof setTimeout> | undefined;
useStore.subscribe((s) => {
  clearTimeout(timer);
  timer = setTimeout(() => {
    const data: Persisted = { rooms: s.rooms, unit: s.unit, theme: s.theme, onboarded: s.onboarded, walkWidth: s.walkWidth, deletedIds: s.deletedIds };
    try { localStorage.setItem(KEY, JSON.stringify(data)); } catch { /* quota or private mode */ }
  }, 200);
});

export const useRoom = (): Room | null => useStore((s) => s.rooms.find((r) => r.id === s.currentId) ?? null);

/* ---------- Room mutations (pure, used with store.edit) ---------- */

export function addOpening(r: Room, kind: OpeningKind, wall = 0): Room {
  const o = clampOpening(r, defaultOpening(kind, wall));
  return { ...r, openings: [...r.openings, o] };
}

export function updateOpening(r: Room, id: string, patch: Partial<Opening>): Room {
  return { ...r, openings: r.openings.map((o) => (o.id === id ? clampOpening(r, { ...o, ...patch }) : o)) };
}

/** Re-clamps every opening after the geometry changed. */
export function reclamp(r: Room): Room {
  return { ...r, openings: r.openings.map((o) => clampOpening(r, o)) };
}

export function splitWall(r: Room, wall: number): Room {
  const c = r.corners;
  const a = c[wall], b = c[(wall + 1) % c.length];
  const mid = { x: Math.round((a.x + b.x) / 2), y: Math.round((a.y + b.y) / 2) };
  const half = dist(a, b) / 2;
  const corners = [...c.slice(0, wall + 1), mid, ...c.slice(wall + 1)];
  const openings = r.openings.map((o) => {
    if (o.wall < wall) return o;
    if (o.wall > wall) return { ...o, wall: o.wall + 1 };
    return o.offset + o.width <= half ? o : { ...o, wall: wall + 1, offset: Math.max(0, o.offset - half) };
  });
  return reclamp({ ...r, corners, openings });
}

export function removeCorner(r: Room, idx: number): Room {
  if (r.corners.length <= 3) return r;
  const n = r.corners.length;
  const prev = (idx - 1 + n) % n;
  const prevLen = dist(r.corners[prev], r.corners[idx]);
  const corners = r.corners.filter((_, i) => i !== idx);
  // Wall `prev` (prev->idx) and wall `idx` (idx->next) merge into the wall that starts at `prev`.
  const openings = r.openings
    .map((o) => {
      if (o.wall === idx) return { ...o, wall: prev > idx ? prev - 1 : prev, offset: o.offset + prevLen };
      if (o.wall > idx) return { ...o, wall: o.wall - 1 };
      return o;
    })
    .map((o) => ({ ...o, wall: Math.min(o.wall, corners.length - 1) }));
  return reclamp({ ...r, corners, openings });
}

export function replaceShape(r: Room, corners: Pt[]): Room {
  const cw = ensureClockwise(corners);
  const b = bounds(cw);
  const shifted = cw.map((p) => ({ x: p.x - b.minX, y: p.y - b.minY }));
  return reclamp({ ...r, corners: shifted });
}

export const defaultRectangle = () => rectCorners(400, 300);

export const setRoomName = (r: Room, name: string): Room => ({ ...r, name });
