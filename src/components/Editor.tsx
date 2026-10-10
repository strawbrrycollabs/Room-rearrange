import { useEffect, useState } from 'react';
import { activeLayout, useRoom, useStore } from '../store';
import { Plan2D, type Tool } from './Plan2D';
import { LibraryPanel, PropertiesPanel, RoomPanel } from './Panels';

type Sheet = null | 'library' | 'room' | 'props';

function useDesktop() {
  const q = '(min-width: 900px)';
  const [d, setD] = useState(() => matchMedia(q).matches);
  useEffect(() => {
    const m = matchMedia(q);
    const f = () => setD(m.matches);
    m.addEventListener('change', f);
    return () => m.removeEventListener('change', f);
  }, []);
  return d;
}

export function Editor() {
  const room = useRoom()!;
  const desktop = useDesktop();
  const unit = useStore((s) => s.unit);
  const theme = useStore((s) => s.theme);
  const selectedId = useStore((s) => s.selectedId);
  const canUndo = useStore((s) => s.past.length > 0);
  const canRedo = useStore((s) => s.future.length > 0);
  const [tool, setTool] = useState<Tool>('select');
  const [snapOn, setSnapOn] = useState(true);
  const [sheet, setSheet] = useState<Sheet>(null);
  const [tab, setTab] = useState<'library' | 'room'>('library');
  const items = activeLayout(room).items;
  const selected = items.find((i) => i.id === selectedId);

  // Selecting something on mobile opens the properties sheet.
  useEffect(() => {
    if (desktop) return;
    if (selectedId) setSheet('props');
    else setSheet((s) => (s === 'props' ? null : s));
  }, [selectedId, desktop]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t.closest('input, textarea, select')) return;
      const st = useStore.getState();
      const mod = e.metaKey || e.ctrlKey;
      const sel = st.selectedId;
      const cur = st.rooms.find((r) => r.id === st.currentId);
      const item = cur && activeLayout(cur).items.find((i) => i.id === sel);
      if (mod && e.key.toLowerCase() === 'z') { e.preventDefault(); e.shiftKey ? st.redo() : st.undo(); return; }
      if (mod && e.key.toLowerCase() === 'y') { e.preventDefault(); st.redo(); return; }
      if (mod && e.key.toLowerCase() === 'd' && item) { e.preventDefault(); st.duplicateItem(item.id); return; }
      if (e.key === 'Escape') { st.select(null); setTool('select'); return; }
      if (!item) return;
      if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); st.removeItem(item.id); return; }
      if (e.key.toLowerCase() === 'r') { st.updateItem(item.id, { rotation: (item.rotation + (e.shiftKey ? -15 : 15) + 360) % 360 }, ''); return; }
      if (e.key.toLowerCase() === 'l') { st.updateItem(item.id, { locked: !item.locked }, ''); return; }
      const step = e.shiftKey ? 10 : 1;
      const d = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[e.key];
      if (d && !item.locked) { e.preventDefault(); st.updateItem(item.id, { x: item.x + d[0], y: item.y + d[1] }, `nudge:${item.id}`); }
    };
    addEventListener('keydown', onKey);
    return () => removeEventListener('keydown', onKey);
  }, []);

  const { undo, redo, setUnit, setTheme, openRoom } = useStore.getState();
  const dark = theme === 'dark' || (theme === 'system' && matchMedia('(prefers-color-scheme: dark)').matches);

  const top = (
    <header className="topbar">
      <button className="btn icon" aria-label="Back to rooms" onClick={() => openRoom(null)}>←</button>
      <h2 className="ellipsis">{room.name}</h2>
      <div className="grow" />
      <button className="btn icon" aria-label="Undo" disabled={!canUndo} onClick={undo}>↶</button>
      <button className="btn icon" aria-label="Redo" disabled={!canRedo} onClick={redo}>↷</button>
      <button className="btn icon" aria-label="Toggle units" onClick={() => setUnit(unit === 'metric' ? 'imperial' : 'metric')}>{unit === 'metric' ? 'm' : 'ft'}</button>
      <button className="btn icon" aria-label="Toggle theme" onClick={() => setTheme(dark ? 'light' : 'dark')}>{dark ? '☀️' : '🌙'}</button>
    </header>
  );

  const toolbar = (
    <div className={desktop ? 'toolrail' : 'bottombar'}>
      {!desktop && <button className={`tb${sheet === 'library' ? ' on' : ''}`} onClick={() => setSheet(sheet === 'library' ? null : 'library')}><i>＋</i>Furniture</button>}
      {!desktop && <button className={`tb${sheet === 'room' ? ' on' : ''}`} onClick={() => setSheet(sheet === 'room' ? null : 'room')}><i>⌂</i>Room</button>}
      <button className={`tb${tool === 'measure' ? ' on' : ''}`} onClick={() => setTool(tool === 'measure' ? 'select' : 'measure')}><i>📏</i>Measure</button>
      <button className={`tb${tool === 'corners' ? ' on' : ''}`} onClick={() => setTool(tool === 'corners' ? 'select' : 'corners')}><i>✥</i>Corners</button>
      <button className={`tb${snapOn ? ' on' : ''}`} onClick={() => setSnapOn(!snapOn)}><i>🧲</i>Snap</button>
      {!desktop && <button className="tb" disabled={!selected} onClick={() => setSheet('props')}><i>✎</i>Edit</button>}
    </div>
  );

  if (desktop) {
    return (
      <div className="editor desktop">
        {top}
        <div className="desk-body">
          <aside className="side left">
            <div className="seg tabs">
              <button className={tab === 'library' ? 'on' : ''} onClick={() => setTab('library')}>Furniture</button>
              <button className={tab === 'room' ? 'on' : ''} onClick={() => setTab('room')}>Room</button>
            </div>
            {tab === 'library' ? <LibraryPanel /> : <RoomPanel cornerMode={tool === 'corners'} onCornerMode={(v) => setTool(v ? 'corners' : 'select')} />}
          </aside>
          <main className="stage">
            <Plan2D tool={tool} snapOn={snapOn} />
            {toolbar}
          </main>
          <aside className="side right">
            <h3>{selected ? selected.name : 'Properties'}</h3>
            <PropertiesPanel />
            <p className="note keys">Shortcuts: Del delete · R rotate (Shift reverse) · arrows nudge (Shift ×10) · Ctrl+Z / Ctrl+Shift+Z undo / redo · Ctrl+D duplicate · L lock · Alt-drag disables snap</p>
          </aside>
        </div>
      </div>
    );
  }

  return (
    <div className="editor mobile">
      {top}
      <main className="stage">
        <Plan2D tool={tool} snapOn={snapOn} />
      </main>
      {toolbar}
      {sheet && (
        <div className={`sheet${sheet === 'props' ? ' props' : ''}`} role="dialog">
          <div className="sheet-handle" onClick={() => setSheet(null)} />
          <div className="sheet-head">
            <strong>{sheet === 'library' ? 'Add furniture' : sheet === 'room' ? 'Room' : selected?.name ?? 'Edit'}</strong>
            <button className="btn icon" aria-label="Close" onClick={() => { setSheet(null); if (sheet === 'props') useStore.getState().select(null); }}>✕</button>
          </div>
          <div className="sheet-scroll">
            {sheet === 'library' && <LibraryPanel onAdded={() => setSheet(null)} />}
            {sheet === 'room' && <RoomPanel cornerMode={tool === 'corners'} onCornerMode={(v) => { setTool(v ? 'corners' : 'select'); if (v) setSheet(null); }} />}
            {sheet === 'props' && <PropertiesPanel />}
          </div>
        </div>
      )}
    </div>
  );
}
