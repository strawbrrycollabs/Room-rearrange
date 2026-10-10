import { useEffect, useState, type ReactNode } from 'react';
import { activeLayout, useRoom, useStore } from '../store';
import { capture3d } from '../capture3d';
import { download, exportPdf, fileSafe, planToPng } from '../exports';
import { StaticPlan } from './StaticPlan';
import { analyzeWalkways, floorCoverage } from '../analysis';
import { findProblems } from '../geometry';
import { fmtLen } from '../units';
import type { Layout } from '../types';
import { ShareSection } from './Account';

export function Dialog({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    addEventListener('keydown', k);
    return () => removeEventListener('keydown', k);
  }, [onClose]);
  return (
    <div className="scrim" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="dialog" role="dialog" aria-label={title}>
        <div className="sheet-handle" />
        <div className="sheet-head"><strong>{title}</strong><button className="btn icon" aria-label="Close" onClick={onClose}>✕</button></div>
        <div className="dialog-body">{children}</div>
      </div>
    </div>
  );
}

/* ---------------- Layout tabs ---------------- */

export function LayoutBar({ onCompare }: { onCompare: () => void }) {
  const room = useRoom()!;
  const { setActiveLayout, addLayout } = useStore.getState();
  const [manage, setManage] = useState<Layout | null>(null);
  return (
    <div className="layoutbar">
      <div className="layout-chips">
        {room.layouts.map((l) => {
          const on = l.id === room.activeLayoutId;
          return (
            <button key={l.id} className={`chip${on ? ' on' : ''}`} onClick={() => (on ? setManage(l) : setActiveLayout(l.id))} title={on ? 'Rename, duplicate or delete' : 'Switch layout'}>
              {l.name}{on ? ' ⋯' : ''}
            </button>
          );
        })}
        <button className="chip" aria-label="New layout from current" onClick={() => addLayout(true)}>＋</button>
      </div>
      <button className="btn" disabled={room.layouts.length < 2} onClick={onCompare}>⇄ Compare</button>
      {manage && <ManageLayout layoutId={manage.id} onClose={() => setManage(null)} />}
    </div>
  );
}

function ManageLayout({ layoutId, onClose }: { layoutId: string; onClose: () => void }) {
  const room = useRoom()!;
  const l = room.layouts.find((x) => x.id === layoutId);
  const { renameLayout, deleteLayout, addLayout } = useStore.getState();
  if (!l) return null;
  return (
    <Dialog title="Layout" onClose={onClose}>
      <label className="lbl"><span>Name</span>
        <input className="field" value={l.name} onChange={(e) => renameLayout(l.id, e.target.value)} onKeyDown={(e) => e.key === 'Enter' && onClose()} />
      </label>
      <div className="actions">
        <button className="btn" onClick={() => { addLayout(true); onClose(); }}>⧉ Duplicate</button>
        <button className="btn" onClick={() => { addLayout(false); onClose(); }}>＋ New empty</button>
        <button className="btn danger" disabled={room.layouts.length <= 1} onClick={() => { if (confirm(`Delete “${l.name}”?`)) { deleteLayout(l.id); onClose(); } }}>🗑 Delete</button>
      </div>
    </Dialog>
  );
}

/* ---------------- Export ---------------- */

export function ExportDialog({ onClose, view, goTo3d, onNeedAccount }: { onClose: () => void; view: '2d' | '3d'; goTo3d: () => void; onNeedAccount: () => void }) {
  const room = useRoom()!;
  const unit = useStore((s) => s.unit);
  const walkWidth = useStore((s) => s.walkWidth);
  const [busy, setBusy] = useState('');
  const [err, setErr] = useState('');
  const layout = activeLayout(room);
  const base = `${fileSafe(room.name)}_${fileSafe(layout.name)}`;

  const run = async (what: string, fn: () => Promise<void>) => {
    setBusy(what); setErr('');
    try { await fn(); onClose(); } catch (e) { setErr(e instanceof Error ? e.message : 'Export failed'); } finally { setBusy(''); }
  };

  const png2d = () => run('png2d', async () => {
    const r = await planToPng(room, layout.items, unit, { title: `${room.name} - ${layout.name}` });
    download(r.url, `${base}_2d.png`);
  });
  const png3d = () => run('png3d', async () => {
    if (view !== '3d') {
      goTo3d();
      for (let i = 0; i < 60 && !capture3d(); i++) await new Promise((r) => setTimeout(r, 100));
      await new Promise((r) => setTimeout(r, 600));
    }
    const url = capture3d();
    if (!url) throw new Error('3D view is not ready yet. Open the 3D view and try again.');
    download(url, `${base}_3d.png`);
  });
  const pdf = () => run('pdf', () => exportPdf(room, layout.name, layout.items, unit, walkWidth));

  return (
    <Dialog title="Export & share" onClose={onClose}>
      <div className="stack tight">
        <button className="method" disabled={!!busy} onClick={png2d}><span className="m-icon">🖼️</span><span><strong>PNG: 2D plan</strong><small>Top-down plan with dimensions</small></span></button>
        <button className="method" disabled={!!busy} onClick={png3d}><span className="m-icon">🧊</span><span><strong>PNG: 3D view</strong><small>{view === '3d' ? 'Current camera angle' : 'Switches to 3D and captures it'}</small></span></button>
        <button className="method" disabled={!!busy} onClick={pdf}><span className="m-icon">📄</span><span><strong>PDF with dimensions</strong><small>Plan, walls, openings and furniture list (A4)</small></span></button>
        <ShareSection roomId={room.id} onNeedAccount={onNeedAccount} />
        {busy && <p className="note">Preparing…</p>}
        {err && <p className="error">{err}</p>}
      </div>
    </Dialog>
  );
}

/* ---------------- Compare ---------------- */

export function Compare({ onClose }: { onClose: () => void }) {
  const room = useRoom()!;
  const unit = useStore((s) => s.unit);
  const walkWidth = useStore((s) => s.walkWidth);
  const [picked, setPicked] = useState<string[]>(() => {
    const ids = room.layouts.map((l) => l.id);
    return [room.activeLayoutId, ...ids.filter((i) => i !== room.activeLayoutId)].slice(0, 3);
  });
  const toggle = (id: string) => setPicked((p) => (p.includes(id) ? (p.length > 1 ? p.filter((x) => x !== id) : p) : p.length >= 3 ? [...p.slice(1), id] : [...p, id]));
  const chosen = picked.map((id) => room.layouts.find((l) => l.id === id)).filter(Boolean) as Layout[];

  return (
    <div className="compare">
      <header className="topbar">
        <button className="btn icon" aria-label="Close compare" onClick={onClose}>←</button>
        <h2>Compare layouts</h2>
      </header>
      <div className="chips pad">
        {room.layouts.map((l) => <button key={l.id} className={`chip${picked.includes(l.id) ? ' on' : ''}`} onClick={() => toggle(l.id)}>{l.name}</button>)}
      </div>
      <div className={`compare-grid n${chosen.length}`}>
        {chosen.map((l) => {
          const walk = analyzeWalkways(room, l.items, walkWidth);
          const probs = findProblems(l.items, room.corners).size;
          const cover = Math.round(floorCoverage(room, l.items) * 100);
          const blocked = walk.doors.filter((d) => d.blocked).length;
          return (
            <section key={l.id} className="cmp-card">
              <div className="cmp-head"><strong>{l.name}</strong>{l.id === room.activeLayoutId && <span className="badge-pill">Current</span>}</div>
              <StaticPlan room={room} items={l.items} unit={unit} walkways={walk} dims={false} itemLabels={chosen.length < 3} pad={50} className="cmp-svg" />
              <ul className="stats">
                <li><span>Items</span><b>{l.items.length}</b></li>
                <li><span>Floor covered</span><b>{cover}%</b></li>
                <li className={probs ? 'bad' : 'ok'}><span>Overlaps</span><b>{probs}</b></li>
                <li className={walk.count ? 'bad' : 'ok'}><span>Narrow paths (&lt; {fmtLen(walkWidth, unit)})</span><b>{walk.count}</b></li>
                <li className={blocked ? 'bad' : 'ok'}><span>Doors blocked</span><b>{blocked}</b></li>
              </ul>
              <button className="btn" disabled={l.id === room.activeLayoutId} onClick={() => { useStore.getState().setActiveLayout(l.id); onClose(); }}>
                {l.id === room.activeLayoutId ? 'Editing this layout' : 'Edit this layout'}
              </button>
            </section>
          );
        })}
      </div>
    </div>
  );
}
