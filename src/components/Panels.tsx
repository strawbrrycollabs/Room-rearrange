import { useState } from 'react';
import { CATALOG, CATEGORIES, SWATCHES, makeFurniture, uid } from '../catalog';
import { addOpening, activeLayout, removeCorner, replaceShape, reclamp, setRoomName, updateOpening, useRoom, useStore } from '../store';
import { bounds, findProblems, lShapeCorners, rectCorners, setWallLength, walls } from '../geometry';
import type { Category, Furniture, Material, OpeningKind } from '../types';
import { LenInput, NumInput } from './LenInput';
import { fmtLen } from '../units';

/* ---------------- Furniture library ---------------- */

export function LibraryPanel({ onAdded }: { onAdded?: () => void }) {
  const room = useRoom()!;
  const [cat, setCat] = useState<Category | 'all'>('all');
  const [custom, setCustom] = useState(false);
  const unit = useStore((s) => s.unit);
  const list = CATALOG.filter((c) => cat === 'all' || c.category === cat);

  const place = (make: (x: number, y: number) => Furniture) => {
    const b = bounds(room.corners);
    const items = activeLayout(room).items;
    const cx = b.minX + b.w / 2, cy = b.minY + b.h / 2;
    // Spiral outwards from the centre to the first spot that fits without collisions.
    let f = make(cx, cy);
    search: for (let ring = 0; ring <= 12; ring++) {
      for (let a = 0; a < Math.max(1, ring * 8); a++) {
        const ang = (a / Math.max(1, ring * 8)) * Math.PI * 2;
        const cand = { ...f, x: cx + Math.cos(ang) * ring * 30, y: cy + Math.sin(ang) * ring * 30 };
        if (!findProblems([...items, cand], room.corners).has(cand.id)) { f = cand; break search; }
      }
    }
    useStore.getState().addItem(f);
    onAdded?.();
  };

  return (
    <div className="panel-body">
      <div className="chips">
        <button className={`chip${cat === 'all' ? ' on' : ''}`} onClick={() => setCat('all')}>All</button>
        {CATEGORIES.map((c) => (
          <button key={c.id} className={`chip${cat === c.id ? ' on' : ''}`} onClick={() => setCat(c.id)}>{c.label}</button>
        ))}
      </div>
      <button className="btn ghost wide" onClick={() => setCustom((v) => !v)}>{custom ? 'Close custom item' : '＋ Custom item'}</button>
      {custom && <CustomForm onCreate={(f) => place((x, y) => ({ ...f, x, y }))} />}
      <div className="lib-grid">
        {list.map((c) => (
          <button key={c.id} className="lib-item" onClick={() => place((x, y) => makeFurniture(c, x, y))}>
            <span className="lib-shape" style={{ background: c.color, borderRadius: c.shape === 'round' ? '50%' : 6, aspectRatio: `${c.width} / ${c.depth}` }} />
            <strong>{c.name}</strong>
            <small>{fmtLen(c.width, unit)} × {fmtLen(c.depth, unit)}</small>
          </button>
        ))}
      </div>
    </div>
  );
}

function CustomForm({ onCreate }: { onCreate: (f: Furniture) => void }) {
  const [name, setName] = useState('Custom item');
  const [shape, setShape] = useState<'box' | 'round'>('box');
  const [w, setW] = useState(100);
  const [d, setD] = useState(60);
  const [h, setH] = useState(75);
  return (
    <div className="card">
      <label className="lbl"><span>Name</span><input className="field" value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.stopPropagation()} /></label>
      <div className="seg">
        <button className={shape === 'box' ? 'on' : ''} onClick={() => setShape('box')}>Box</button>
        <button className={shape === 'round' ? 'on' : ''} onClick={() => setShape('round')}>Round</button>
      </div>
      <div className="row3">
        <LenInput label="Width" value={w} onChange={setW} min={1} />
        <LenInput label="Depth" value={d} onChange={setD} min={1} />
        <LenInput label="Height" value={h} onChange={setH} min={1} />
      </div>
      <button className="btn primary wide" onClick={() => onCreate({
        id: uid('f'), name: name.trim() || 'Custom item', category: 'other', shape, x: 0, y: 0,
        width: w, depth: shape === 'round' ? w : d, height: h, rotation: 0, color: '#cbd5e1', material: 'matte', locked: false, flat: false,
      })}>Add to room</button>
    </div>
  );
}

/* ---------------- Furniture properties ---------------- */

const MATERIALS: Material[] = ['matte', 'wood', 'metal', 'fabric', 'glass'];

export function PropertiesPanel() {
  const room = useRoom()!;
  const selectedId = useStore((s) => s.selectedId);
  const { updateItem, removeItem, duplicateItem } = useStore.getState();
  const item = activeLayout(room).items.find((i) => i.id === selectedId);
  if (!item) return <div className="panel-body empty">Select a piece of furniture to edit it.</div>;
  const set = (p: Partial<Furniture>, key?: string) => updateItem(item.id, p, key);
  const rotate = (by: number) => set({ rotation: (((item.rotation + by) % 360) + 360) % 360 });

  return (
    <div className="panel-body">
      <label className="lbl"><span>Name</span>
        <input className="field" value={item.name} onChange={(e) => set({ name: e.target.value }, `name:${item.id}`)} onKeyDown={(e) => e.stopPropagation()} />
      </label>
      <div className="row3">
        <LenInput label="Width" value={item.width} min={1} onChange={(v) => set({ width: v })} />
        <LenInput label="Depth" value={item.depth} min={1} onChange={(v) => set({ depth: v })} />
        <LenInput label="Height" value={item.height} min={1} onChange={(v) => set({ height: v })} />
      </div>
      <div className="row2">
        <LenInput label="X" value={item.x} min={-100000} onChange={(v) => set({ x: v })} />
        <LenInput label="Y" value={item.y} min={-100000} onChange={(v) => set({ y: v })} />
      </div>
      <div className="lbl">
        <span>Rotation</span>
        <div className="rot-row">
          <button className="btn icon" aria-label="Rotate -90°" onClick={() => rotate(-90)}>↺ 90</button>
          <NumInput value={item.rotation} min={0} max={360} suffix="°" onChange={(v) => set({ rotation: v % 360 })} />
          <button className="btn icon" aria-label="Rotate +90°" onClick={() => rotate(90)}>↻ 90</button>
        </div>
      </div>
      <div className="lbl">
        <span>Colour</span>
        <div className="swatches">
          {SWATCHES.map((c) => (
            <button key={c} aria-label={c} className={`sw${item.color === c ? ' on' : ''}`} style={{ background: c }} onClick={() => set({ color: c })} />
          ))}
          <input type="color" aria-label="Custom colour" value={item.color} onChange={(e) => set({ color: e.target.value }, `color:${item.id}`)} />
        </div>
      </div>
      <div className="lbl">
        <span>Material</span>
        <div className="seg">
          {MATERIALS.map((m) => <button key={m} className={item.material === m ? 'on' : ''} onClick={() => set({ material: m })}>{m}</button>)}
        </div>
      </div>
      <div className="actions">
        <button className="btn" onClick={() => set({ locked: !item.locked })}>{item.locked ? '🔓 Unlock' : '🔒 Lock'}</button>
        <button className="btn" onClick={() => duplicateItem(item.id)}>⧉ Duplicate</button>
        <button className="btn danger" onClick={() => removeItem(item.id)}>🗑 Delete</button>
      </div>
    </div>
  );
}

/* ---------------- Room panel ---------------- */

export function RoomPanel({ cornerMode, onCornerMode }: { cornerMode: boolean; onCornerMode: (v: boolean) => void }) {
  const room = useRoom()!;
  const unit = useStore((s) => s.unit);
  const { edit } = useStore.getState();
  const ws = walls(room.corners);
  const b = bounds(room.corners);

  const applyShape = (kind: 'rect' | 'l') => {
    const w = b.w || 400, l = b.h || 300;
    edit((r) => replaceShape(r, kind === 'rect' ? rectCorners(w, l) : lShapeCorners(w, l, Math.round(w * 0.4), Math.round(l * 0.4))));
  };
  const isRect = room.corners.length === 4;

  return (
    <div className="panel-body">
      <label className="lbl"><span>Room name</span>
        <input className="field" value={room.name} onChange={(e) => edit((r) => setRoomName(r, e.target.value), 'rname')} onKeyDown={(e) => e.stopPropagation()} />
      </label>
      <LenInput label="Ceiling height" value={room.ceilingHeight} min={150} max={600} onChange={(v) => edit((r) => ({ ...r, ceilingHeight: v }), 'ceil')} />

      <h4>Shape</h4>
      <div className="seg">
        <button className={isRect ? 'on' : ''} onClick={() => applyShape('rect')}>Rectangle</button>
        <button className={room.corners.length === 6 ? 'on' : ''} onClick={() => applyShape('l')}>L-shape</button>
      </div>
      <button className={`btn wide${cornerMode ? ' primary' : ''}`} onClick={() => onCornerMode(!cornerMode)}>
        {cornerMode ? '✓ Done editing corners' : '✥ Move / add corners on plan'}
      </button>

      <h4>Walls</h4>
      <div className="list">
        {ws.map((w) => (
          <div className="list-row" key={w.index}>
            <span className="badge">{w.index + 1}</span>
            <LenInput value={w.length} min={30} onChange={(v) => edit((r) => reclamp({ ...r, corners: setWallLength(r.corners, w.index, v) }), `wall${w.index}`)} />
            <button className="btn icon" aria-label="Remove corner" disabled={room.corners.length <= 3} onClick={() => edit((r) => removeCorner(r, (w.index + 1) % r.corners.length))}>✕</button>
          </div>
        ))}
      </div>
      <p className="note">Walls run clockwise: wall 1 goes from corner 1 to corner 2, and so on. ✕ removes the corner at the end of that wall.</p>

      <h4>Doors, windows &amp; radiators</h4>
      <div className="actions">
        {(['door', 'window', 'radiator'] as OpeningKind[]).map((k) => (
          <button key={k} className="btn" onClick={() => edit((r) => addOpening(r, k, 0))}>＋ {k}</button>
        ))}
      </div>
      <div className="list">
        {room.openings.map((o) => (
          <div className="card" key={o.id}>
            <div className="card-head">
              <strong style={{ textTransform: 'capitalize' }}>{o.kind}</strong>
              <button className="btn icon" aria-label="Delete" onClick={() => edit((r) => ({ ...r, openings: r.openings.filter((x) => x.id !== o.id) }))}>🗑</button>
            </div>
            <div className="row2">
              <label className="lbl"><span>On wall</span>
                <select className="field" value={o.wall} onChange={(e) => edit((r) => updateOpening(r, o.id, { wall: Number(e.target.value) }))}>
                  {ws.map((w) => <option key={w.index} value={w.index}>Wall {w.index + 1} ({fmtLen(w.length, unit)})</option>)}
                </select>
              </label>
              <LenInput label={`From corner ${o.wall + 1}`} value={o.offset} onChange={(v) => edit((r) => updateOpening(r, o.id, { offset: v }), `o${o.id}off`)} />
            </div>
            <div className={o.kind === 'door' ? 'row2' : 'row3'}>
              <LenInput label="Width" value={o.width} min={10} onChange={(v) => edit((r) => updateOpening(r, o.id, { width: v }), `o${o.id}w`)} />
              <LenInput label="Height" value={o.height} min={10} onChange={(v) => edit((r) => updateOpening(r, o.id, { height: v }), `o${o.id}h`)} />
              {o.kind !== 'door' && <LenInput label="Above floor" value={o.sill} onChange={(v) => edit((r) => updateOpening(r, o.id, { sill: v }), `o${o.id}s`)} />}
            </div>
            {o.kind === 'door' && (
              <div className="row2">
                <div className="seg"><button className={o.swing === 'in' ? 'on' : ''} onClick={() => edit((r) => updateOpening(r, o.id, { swing: 'in' }))}>Opens in</button><button className={o.swing === 'out' ? 'on' : ''} onClick={() => edit((r) => updateOpening(r, o.id, { swing: 'out' }))}>Opens out</button></div>
                <div className="seg"><button className={o.hinge === 'start' ? 'on' : ''} onClick={() => edit((r) => updateOpening(r, o.id, { hinge: 'start' }))}>Hinge left</button><button className={o.hinge === 'end' ? 'on' : ''} onClick={() => edit((r) => updateOpening(r, o.id, { hinge: 'end' }))}>Hinge right</button></div>
              </div>
            )}
          </div>
        ))}
        {room.openings.length === 0 && <p className="note">None yet. Add one, then set its exact width, position and height above the floor.</p>}
      </div>

      <h4>Corners</h4>
      <div className="list">
        {room.corners.map((c, i) => (
          <div className="list-row" key={i}>
            <span className="badge">{i + 1}</span>
            <LenInput value={c.x} min={-100000} onChange={(v) => edit((r) => reclamp({ ...r, corners: r.corners.map((p, j) => (j === i ? { ...p, x: v } : p)) }), `cx${i}`)} />
            <LenInput value={c.y} min={-100000} onChange={(v) => edit((r) => reclamp({ ...r, corners: r.corners.map((p, j) => (j === i ? { ...p, y: v } : p)) }), `cy${i}`)} />
          </div>
        ))}
      </div>
    </div>
  );
}
