import { lazy, Suspense, useEffect, useMemo, useState } from 'react';
import { fetchShared } from '../cloud';
import { newRoom, useStore } from '../store';
import { uid } from '../catalog';
import type { Room } from '../types';
import { StaticPlan } from './StaticPlan';
import { analyzeWalkways } from '../analysis';

const View3D = lazy(() => import('./View3D'));

/** Read-only page opened from a share link (#/s/<token>). */
export function ShareView({ token }: { token: string }) {
  const [room, setRoom] = useState<Room | null>(null);
  const [state, setState] = useState<'loading' | 'missing' | 'error'>('loading');
  const [layoutId, setLayoutId] = useState('');
  const [mode, setMode] = useState<'2d' | '3d'>('2d');
  const [walk, setWalk] = useState(false);
  const unit = useStore((s) => s.unit);
  const theme = useStore((s) => s.theme);
  const dark = theme === 'dark' || (theme === 'system' && matchMedia('(prefers-color-scheme: dark)').matches);

  useEffect(() => {
    fetchShared(token)
      .then((r) => { if (r) { setRoom(r); setLayoutId(r.activeLayoutId); } else setState('missing'); })
      .catch(() => setState('error'));
  }, [token]);

  const view = useMemo(() => (room ? { ...room, activeLayoutId: layoutId || room.activeLayoutId } : null), [room, layoutId]);
  const layout = view && (view.layouts.find((l) => l.id === view.activeLayoutId) ?? view.layouts[0]);
  const walkways = useMemo(() => (view && layout ? analyzeWalkways(view, layout.items) : null), [view, layout]);

  const copyToMine = () => {
    if (!room) return;
    const copy = newRoom(`${room.name} (copy)`, room.corners, room.ceilingHeight);
    const layouts = room.layouts.map((l) => ({ ...l, id: uid('l'), items: l.items.map((i) => ({ ...i, id: uid('f') })) }));
    useStore.getState().addRoom({ ...copy, openings: room.openings.map((o) => ({ ...o, id: uid('o') })), layouts, activeLayoutId: layouts[Math.max(0, room.layouts.findIndex((l) => l.id === layoutId))].id });
    location.hash = '';
  };

  if (!view || !layout) {
    return (
      <div className="screen center">
        <div className="onboard-art">{state === 'loading' ? '⏳' : '🔒'}</div>
        <h1>{state === 'loading' ? 'Opening room…' : state === 'missing' ? 'This link is no longer active' : 'Could not load the room'}</h1>
        {state !== 'loading' && <p className="lead">{state === 'missing' ? 'The owner may have stopped sharing it.' : 'Check your connection and try again.'}</p>}
        <a className="btn primary big" href={location.pathname} onClick={() => (location.hash = '')}>Open RoomShift</a>
      </div>
    );
  }

  return (
    <div className="editor shared">
      <header className="topbar">
        <h2 className="ellipsis">{view.name}</h2><span className="badge-pill">View only</span>
        <div className="grow" />
        <button className="btn" onClick={copyToMine}>Make my copy</button>
      </header>
      {view.layouts.length > 1 && (
        <div className="layoutbar"><div className="layout-chips">
          {view.layouts.map((l) => <button key={l.id} className={`chip${l.id === layout.id ? ' on' : ''}`} onClick={() => setLayoutId(l.id)}>{l.name}</button>)}
        </div></div>
      )}
      <main className="stage">
        {mode === '2d' ? (
          <div className="canvas-wrap shared-plan"><StaticPlan room={view} items={layout.items} unit={unit} walkways={walkways} className="shared-svg" /></div>
        ) : (
          <Suspense fallback={<div className="canvas-wrap loading">Loading 3D…</div>}>
            <View3D room={view} readOnly walk={walk} dark={dark} />
            {walk && <div className="hint">Drag to look · WASD / stick to move</div>}
          </Suspense>
        )}
        {walk ? (
          <div className="view-toggle"><button className="btn primary" onClick={() => setWalk(false)}>Exit walk</button></div>
        ) : (
          <div className="view-toggle seg">
            <button className={mode === '2d' ? 'on' : ''} onClick={() => setMode('2d')}>2D</button>
            <button className={mode === '3d' ? 'on' : ''} onClick={() => setMode('3d')}>3D</button>
            {mode === '3d' && <button onClick={() => setWalk(true)}>🚶 Walk</button>}
          </div>
        )}
      </main>
    </div>
  );
}
