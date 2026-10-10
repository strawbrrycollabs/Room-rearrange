import { useEffect, useRef, useState } from 'react';
import { newRoom, useStore } from '../store';
import { bounds, ensureClockwise, lShapeCorners, rectCorners, dist } from '../geometry';
import type { Pt } from '../types';
import { LenInput } from './LenInput';
import { fmtLen } from '../units';
import { useViewport } from '../useViewport';
import { AccountButton, AccountDialog } from './Account';

/* ---------------- Onboarding (3 screens) ---------------- */

const SLIDES = [
  { icon: '📐', title: 'Build your room', text: 'Type in exact wall lengths, draw it on a grid, or scan it with your phone.' },
  { icon: '🛋️', title: 'Arrange the furniture', text: 'Drag, rotate and resize real-size pieces. Overlaps turn red so nothing is a surprise.' },
  { icon: '✨', title: 'Compare before you lift', text: 'Save layouts, flip between 2D and 3D, and share the plan. No heavy lifting required.' },
];

export function Onboarding() {
  const [i, setI] = useState(0);
  const finish = useStore((s) => s.finishOnboarding);
  const last = i === SLIDES.length - 1;
  const s = SLIDES[i];
  return (
    <div className="screen center onboard">
      <button className="link skip" onClick={finish}>Skip</button>
      <div className="onboard-art">{s.icon}</div>
      <h1>{s.title}</h1>
      <p className="lead">{s.text}</p>
      <div className="dots">{SLIDES.map((_, j) => <span key={j} className={j === i ? 'on' : ''} />)}</div>
      <button className="btn primary big" onClick={() => (last ? finish() : setI(i + 1))}>{last ? 'Get started' : 'Next'}</button>
    </div>
  );
}

/* ---------------- Home ---------------- */

export function Home({ onCreate }: { onCreate: () => void }) {
  const rooms = useStore((s) => s.rooms);
  const unit = useStore((s) => s.unit);
  const { openRoom, deleteRoom, setUnit, setTheme } = useStore.getState();
  const theme = useStore((s) => s.theme);
  const [account, setAccount] = useState(false);
  return (
    <div className="screen home">
      <header className="topbar">
        <h2>RoomShift</h2>
        <div className="grow" />
        <button className="btn icon" aria-label="Toggle units" onClick={() => setUnit(unit === 'metric' ? 'imperial' : 'metric')}>{unit === 'metric' ? 'm' : 'ft'}</button>
        <button className="btn icon" aria-label="Theme" onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}>{theme === 'dark' ? '☀️' : '🌙'}</button>
        <AccountButton onClick={() => setAccount(true)} />
      </header>
      {account && <AccountDialog onClose={() => setAccount(false)} />}
      {rooms.length === 0 ? (
        <div className="center grow">
          <div className="onboard-art">🏠</div>
          <h1>Create your first room</h1>
          <p className="lead">Start with exact measurements or draw it on a grid.</p>
          <button className="btn primary big" onClick={onCreate}>Create room</button>
        </div>
      ) : (
        <>
          <div className="room-grid">
            {rooms.map((r) => {
              const b = bounds(r.corners);
              const lay = r.layouts.find((l) => l.id === r.activeLayoutId) ?? r.layouts[0];
              return (
                <div key={r.id} className="room-card" onClick={() => openRoom(r.id)} role="button" tabIndex={0} onKeyDown={(e) => e.key === 'Enter' && openRoom(r.id)}>
                  <svg viewBox={`${b.minX - 20} ${b.minY - 20} ${b.w + 40} ${b.h + 40}`} preserveAspectRatio="xMidYMid meet">
                    <polygon points={r.corners.map((p) => `${p.x},${p.y}`).join(' ')} fill="var(--floor)" stroke="var(--wall)" strokeWidth={Math.max(b.w, b.h) / 40} />
                    {lay.items.map((i) => (
                      <rect key={i.id} x={i.x - i.width / 2} y={i.y - i.depth / 2} width={i.width} height={i.depth} fill={i.color} stroke="var(--item-stroke)" strokeWidth={Math.max(b.w, b.h) / 300} transform={`rotate(${i.rotation} ${i.x} ${i.y})`} />
                    ))}
                  </svg>
                  <div className="room-meta">
                    <strong>{r.name}</strong>
                    <small>{fmtLen(b.w, unit)} × {fmtLen(b.h, unit)} · {lay.items.length} items</small>
                  </div>
                  <button className="btn icon del" aria-label="Delete room" onClick={(e) => { e.stopPropagation(); if (confirm(`Delete “${r.name}”?`)) deleteRoom(r.id); }}>🗑</button>
                </div>
              );
            })}
          </div>
          <div className="fab-wrap"><button className="btn primary big" onClick={onCreate}>＋ Create room</button></div>
        </>
      )}
    </div>
  );
}

/* ---------------- Create room ---------------- */

type Method = 'choose' | 'manual' | 'draw';

export function CreateRoom({ onCancel }: { onCancel: () => void }) {
  const [m, setM] = useState<Method>('choose');
  if (m === 'manual') return <ManualForm onBack={() => setM('choose')} />;
  if (m === 'draw') return <DrawRoom onBack={() => setM('choose')} />;
  return (
    <div className="screen">
      <header className="topbar"><button className="btn icon" onClick={onCancel} aria-label="Back">←</button><h2>New room</h2></header>
      <div className="stack">
        <button className="method" disabled>
          <span className="m-icon">📱</span>
          <span><strong>Scan with phone</strong><small>Guided camera scan — coming in a later step</small></span>
        </button>
        <button className="method" onClick={() => setM('manual')}>
          <span className="m-icon">📏</span>
          <span><strong>Enter measurements</strong><small>Rectangular or L-shaped, exact wall lengths</small></span>
        </button>
        <button className="method" onClick={() => setM('draw')}>
          <span className="m-icon">✏️</span>
          <span><strong>Draw on a grid</strong><small>Tap to place corners</small></span>
        </button>
      </div>
    </div>
  );
}

function ManualForm({ onBack }: { onBack: () => void }) {
  const [name, setName] = useState('Living room');
  const [shape, setShape] = useState<'rect' | 'l'>('rect');
  const [w, setW] = useState(450);
  const [l, setL] = useState(350);
  const [nw, setNw] = useState(180);
  const [nl, setNl] = useState(140);
  const [notch, setNotch] = useState<'tl' | 'tr' | 'br' | 'bl'>('tr');
  const [ceil, setCeil] = useState(250);
  const addRoom = useStore((s) => s.addRoom);
  const valid = shape === 'rect' || (nw < w - 30 && nl < l - 30);
  const corners = shape === 'rect' ? rectCorners(w, l) : lShapeCorners(w, l, nw, nl, notch);
  const b = bounds(corners);
  return (
    <div className="screen">
      <header className="topbar"><button className="btn icon" onClick={onBack} aria-label="Back">←</button><h2>Measurements</h2></header>
      <div className="form">
        <label className="lbl"><span>Name</span><input className="field" value={name} onChange={(e) => setName(e.target.value)} /></label>
        <div className="seg">
          <button className={shape === 'rect' ? 'on' : ''} onClick={() => setShape('rect')}>Rectangle</button>
          <button className={shape === 'l' ? 'on' : ''} onClick={() => setShape('l')}>L-shape</button>
        </div>
        <div className="row2">
          <LenInput label="Width" value={w} min={100} onChange={setW} />
          <LenInput label="Length" value={l} min={100} onChange={setL} />
        </div>
        {shape === 'l' && (
          <>
            <div className="row2">
              <LenInput label="Cut-out width" value={nw} min={30} onChange={setNw} />
              <LenInput label="Cut-out length" value={nl} min={30} onChange={setNl} />
            </div>
            <div className="lbl"><span>Cut-out corner</span>
              <div className="seg">
                {([['tl', 'Top-left'], ['tr', 'Top-right'], ['bl', 'Bottom-left'], ['br', 'Bottom-right']] as const).map(([k, label]) => (
                  <button key={k} className={notch === k ? 'on' : ''} onClick={() => setNotch(k)}>{label}</button>
                ))}
              </div>
            </div>
            {!valid && <p className="error">The cut-out must be smaller than the room.</p>}
          </>
        )}
        <LenInput label="Ceiling height" value={ceil} min={150} max={600} onChange={setCeil} />
        <svg className="preview" viewBox={`${-20} ${-20} ${b.w + 40} ${b.h + 40}`}>
          <polygon points={corners.map((p) => `${p.x},${p.y}`).join(' ')} fill="var(--floor)" stroke="var(--wall)" strokeWidth={Math.max(b.w, b.h) / 50} />
        </svg>
        <button className="btn primary big" disabled={!valid} onClick={() => addRoom(newRoom(name.trim() || 'My room', corners, ceil))}>Create room</button>
      </div>
    </div>
  );
}

/* ---------------- Draw on a grid ---------------- */

function DrawRoom({ onBack }: { onBack: () => void }) {
  const unit = useStore((s) => s.unit);
  const addRoom = useStore((s) => s.addRoom);
  const { ref, view, toWorld, setView, fit } = useViewport();
  const [pts, setPts] = useState<Pt[]>([]);
  const [hover, setHover] = useState<Pt | null>(null);
  const [name, setName] = useState('My room');
  const drag = useRef<{ x: number; y: number; tx: number; ty: number; moved: boolean } | null>(null);
  const k = view.k;
  useEffect(() => { fit({ minX: 0, minY: 0, w: 600, h: 450 }, 10); }, [fit]);

  const snap = (p: Pt): Pt => ({ x: Math.round(p.x / 10) * 10, y: Math.round(p.y / 10) * 10 });
  const closeEnough = (p: Pt) => pts.length >= 3 && dist(p, pts[0]) * k < 18;

  const down = (e: React.PointerEvent) => {
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
    drag.current = { x: e.clientX, y: e.clientY, tx: view.tx, ty: view.ty, moved: false };
  };
  const move = (e: React.PointerEvent) => {
    const d = drag.current;
    if (d && (Math.abs(e.clientX - d.x) + Math.abs(e.clientY - d.y) > 6 || d.moved)) {
      d.moved = true;
      setView((v) => ({ ...v, tx: d.tx + e.clientX - d.x, ty: d.ty + e.clientY - d.y }));
    }
    setHover(snap(toWorld(e.clientX, e.clientY)));
  };
  const up = (e: React.PointerEvent) => {
    const d = drag.current;
    drag.current = null;
    if (!d || d.moved) return;
    const p = snap(toWorld(e.clientX, e.clientY));
    if (closeEnough(p)) return finish();
    if (pts.length && pts[pts.length - 1].x === p.x && pts[pts.length - 1].y === p.y) return;
    setPts([...pts, p]);
  };

  const finish = () => {
    if (pts.length < 3) return;
    const cw = ensureClockwise(pts);
    const b = bounds(cw);
    addRoom(newRoom(name.trim() || 'My room', cw.map((p) => ({ x: p.x - b.minX, y: p.y - b.minY }))));
  };

  const preview = hover && pts.length ? [...pts, hover] : pts;
  const lenLabels = (preview.length > 1 ? preview.slice(1).map((p, i) => ({ a: preview[i], b: p })) : []);

  return (
    <div className="screen draw">
      <header className="topbar">
        <button className="btn icon" onClick={onBack} aria-label="Back">←</button>
        <input className="field title" value={name} onChange={(e) => setName(e.target.value)} />
      </header>
      <div className="canvas-wrap grow">
        <svg ref={ref} className="plan" onPointerDown={down} onPointerMove={move} onPointerUp={up}>
          <defs>
            <pattern id="d10" width="10" height="10" patternUnits="userSpaceOnUse"><path d="M10 0H0V10" fill="none" stroke="var(--grid)" strokeWidth="1" vectorEffect="non-scaling-stroke" /></pattern>
            <pattern id="d100" width="100" height="100" patternUnits="userSpaceOnUse"><path d="M100 0H0V100" fill="none" stroke="var(--grid-major)" strokeWidth="1" vectorEffect="non-scaling-stroke" /></pattern>
          </defs>
          <g transform={`translate(${view.tx} ${view.ty}) scale(${k})`}>
            <rect x={-20000} y={-20000} width={40000} height={40000} fill="url(#d100)" />
            {k * 10 >= 7 && <rect x={-20000} y={-20000} width={40000} height={40000} fill="url(#d10)" />}
            {pts.length >= 3 && <polygon points={pts.map((p) => `${p.x},${p.y}`).join(' ')} fill="var(--accent-soft)" />}
            {preview.length > 1 && <polyline points={preview.map((p) => `${p.x},${p.y}`).join(' ')} fill="none" stroke="var(--accent)" strokeWidth={2.5} vectorEffect="non-scaling-stroke" />}
            {lenLabels.map((s, i) => (
              <text key={i} x={(s.a.x + s.b.x) / 2} y={(s.a.y + s.b.y) / 2 - 10 / k} textAnchor="middle" fontSize={12 / k} fill="var(--muted)" className="halo">{fmtLen(dist(s.a, s.b), unit)}</text>
            ))}
            {pts.map((p, i) => (
              <circle key={i} cx={p.x} cy={p.y} r={(i === 0 && pts.length >= 3 ? 9 : 5) / k} fill={i === 0 ? 'var(--accent)' : 'var(--bg)'} stroke="var(--accent)" strokeWidth={2} vectorEffect="non-scaling-stroke" />
            ))}
            {hover && <circle cx={hover.x} cy={hover.y} r={4 / k} fill="var(--accent)" opacity={0.5} />}
          </g>
        </svg>
        <div className="hint">{pts.length < 3 ? 'Tap to place corners (10 cm grid). Drag to pan.' : 'Tap the first point or press Done to close the room.'}</div>
      </div>
      <div className="bottombar">
        <button className="btn" disabled={!pts.length} onClick={() => setPts(pts.slice(0, -1))}>Undo point</button>
        <button className="btn" disabled={!pts.length} onClick={() => setPts([])}>Clear</button>
        <button className="btn primary" disabled={pts.length < 3} onClick={finish}>Done</button>
      </div>
    </div>
  );
}
