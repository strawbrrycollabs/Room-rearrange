import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import type { Pt } from '../types';
import { OPENING_DEFAULTS, type ScanOpening, type ScanResult } from './geometry';

export async function arSupported(): Promise<boolean> {
  try {
    return !!navigator.xr && (await navigator.xr.isSessionSupported('immersive-ar'));
  } catch {
    return false;
  }
}

type Phase = 'corners' | 'openings';

/**
 * WebXR scan: point the reticle at each floor corner and tap. Uses hit-testing against the
 * real floor, so distances are measured by the phone (ARCore) instead of estimated.
 */
export function ARScan({ onResult, onCancel }: { onResult: (r: ScanResult) => void; onCancel: () => void }) {
  const overlay = useRef<HTMLDivElement>(null);
  const [running, setRunning] = useState(false);
  const [err, setErr] = useState('');
  const [phase, setPhase] = useState<Phase>('corners');
  const [kind, setKind] = useState<'door' | 'window'>('door');
  const [counts, setCounts] = useState({ corners: 0, openings: 0, pending: false, tracking: false });

  const api = useRef<{ add: () => void; undo: () => void; finish: () => void; setPhase: (p: Phase) => void; setKind: (k: 'door' | 'window') => void } | null>(null);

  useEffect(() => () => { api.current?.finish(); }, []);

  const start = async () => {
    setErr('');
    try {
      const session = await navigator.xr!.requestSession('immersive-ar', {
        requiredFeatures: ['hit-test'],
        optionalFeatures: ['dom-overlay', 'local-floor'],
        domOverlay: { root: overlay.current! },
      });

      const canvas = document.createElement('canvas');
      canvas.style.cssText = 'position:fixed;left:0;top:0;width:1px;height:1px;opacity:0;pointer-events:none';
      document.body.appendChild(canvas);
      const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true });
      renderer.xr.enabled = true;
      renderer.xr.setReferenceSpaceType('local-floor');
      await renderer.xr.setSession(session);

      const scene = new THREE.Scene();
      const camera = new THREE.PerspectiveCamera();
      const reticle = new THREE.Mesh(
        new THREE.RingGeometry(0.06, 0.08, 32).rotateX(-Math.PI / 2),
        new THREE.MeshBasicMaterial({ color: 0x4f46e5, side: THREE.DoubleSide }),
      );
      reticle.matrixAutoUpdate = false;
      reticle.visible = false;
      scene.add(reticle);
      const markers = new THREE.Group();
      scene.add(markers);
      const outline = new THREE.Line(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color: 0x4f46e5 }));
      scene.add(outline);

      const corners: THREE.Vector3[] = [];
      const openingPts: { kind: 'door' | 'window'; a: THREE.Vector3; b: THREE.Vector3 }[] = [];
      let pendingPt: THREE.Vector3 | null = null;
      let hit: THREE.Vector3 | null = null;
      let curPhase: Phase = 'corners';
      let curKind: 'door' | 'window' = 'door';
      let ended = false;

      const dot = (p: THREE.Vector3, color: number) => {
        const m = new THREE.Mesh(new THREE.SphereGeometry(0.03, 12, 12), new THREE.MeshBasicMaterial({ color }));
        m.position.copy(p);
        markers.add(m);
        return m;
      };
      const redraw = () => {
        markers.clear();
        corners.forEach((c) => dot(c, 0x4f46e5));
        openingPts.forEach((o) => { dot(o.a, o.kind === 'door' ? 0xf59e0b : 0x38bdf8); dot(o.b, o.kind === 'door' ? 0xf59e0b : 0x38bdf8); });
        if (pendingPt) dot(pendingPt, 0xffffff);
        outline.geometry.dispose();
        outline.geometry = new THREE.BufferGeometry().setFromPoints(corners.length > 1 ? [...corners, corners[0]].map((c) => c.clone().setY(c.y + 0.01)) : []);
        setCounts((s) => ({ ...s, corners: corners.length, openings: openingPts.length, pending: !!pendingPt }));
      };

      const viewer = await session.requestReferenceSpace('viewer');
      const source = await session.requestHitTestSource!({ space: viewer });
      let wasTracking = false;
      renderer.setAnimationLoop((_t, frame) => {
        if (frame && source) {
          const ref = renderer.xr.getReferenceSpace();
          const results = frame.getHitTestResults(source);
          const pose = ref && results.length ? results[0].getPose(ref) : null;
          if (pose) {
            reticle.visible = true;
            reticle.matrix.fromArray(pose.transform.matrix);
            hit = new THREE.Vector3().setFromMatrixPosition(reticle.matrix);
          } else { reticle.visible = false; hit = null; }
          if (wasTracking !== !!hit) { wasTracking = !!hit; setCounts((s) => ({ ...s, tracking: wasTracking })); }
        }
        renderer.render(scene, camera);
      });

      const finish = () => {
        if (ended) return;
        ended = true;
        renderer.setAnimationLoop(null);
        void source?.cancel();
        canvas.remove();
        const toPlan = (v: THREE.Vector3): Pt => ({ x: v.x * 100, y: v.z * 100 }); // metres -> cm; x right, z towards you = plan y down
        const openings: ScanOpening[] = openingPts.map((o) => ({ kind: o.kind, a: toPlan(o.a), b: toPlan(o.b), ...OPENING_DEFAULTS[o.kind] }));
        const result: ScanResult = { corners: corners.map(toPlan), openings, source: 'ar' };
        try { void session.end(); } catch { /* already ended */ }
        setRunning(false);
        if (corners.length >= 3) onResult(result);
      };
      session.addEventListener('end', finish);

      api.current = {
        add: () => {
          if (!hit) return;
          const p = hit.clone();
          if (curPhase === 'corners') corners.push(p);
          else if (!pendingPt) pendingPt = p;
          else { openingPts.push({ kind: curKind, a: pendingPt, b: p }); pendingPt = null; }
          redraw();
        },
        undo: () => {
          if (curPhase === 'corners') corners.pop();
          else if (pendingPt) pendingPt = null;
          else openingPts.pop();
          redraw();
        },
        finish: () => { if (!ended) { if (corners.length < 3) { ended = true; renderer.setAnimationLoop(null); canvas.remove(); try { void session.end(); } catch { /* */ } setRunning(false); } else finish(); } },
        setPhase: (p) => { curPhase = p; pendingPt = null; redraw(); },
        setKind: (k) => { curKind = k; },
      };
      setRunning(true);
    } catch (e) {
      setErr((e as Error).message || 'Could not start AR.');
    }
  };

  // Overlay buttons must not also trigger an XR "select" in the scene behind them.
  useEffect(() => {
    const el = overlay.current;
    if (!el) return;
    const stop = (e: Event) => e.preventDefault();
    el.addEventListener('beforexrselect', stop);
    return () => el.removeEventListener('beforexrselect', stop);
  }, []);

  const info = counts.tracking ? 'Floor found' : 'Move the phone slowly to find the floor…';
  return (
    <div ref={overlay} className={running ? 'ar-overlay running' : 'screen'}>
      {!running ? (
        <>
          <header className="topbar"><button className="btn icon" onClick={onCancel} aria-label="Back">←</button><h2>AR scan</h2></header>
          <div className="form">
            <ol className="steps">
              <li>Point the phone at the floor and wait for the ring to appear.</li>
              <li>Put the ring on each floor corner and tap <b>Add corner</b>, going around the room.</li>
              <li>Then mark doors and windows by tapping the floor at both edges.</li>
            </ol>
            <p className="note">Tip: keep the ring on the floor, not on furniture, and stand a little away from each corner.</p>
            {err && <p className="error">{err}</p>}
            <button className="btn primary big" onClick={start}>Start AR</button>
          </div>
        </>
      ) : (
        <>
          <div className="aim-top">
            <button className="btn icon" aria-label="Cancel" onClick={() => { api.current?.finish(); onCancel(); }}>✕</button>
            <div className="aim-status">{phase === 'corners' ? `Corner ${counts.corners + 1}` : `${kind === 'door' ? 'Door' : 'Window'}: ${counts.pending ? 'right' : 'left'} edge`}</div>
            <button className="btn" disabled={counts.corners < 3} onClick={() => api.current?.finish()}>Done</button>
          </div>
          <div className="aim-hud"><b>{info}</b><small>{counts.corners} corners · {counts.openings} openings</small></div>
          <div className="aim-bottom">
            <div className="seg aim-modes">
              <button className={phase === 'corners' ? 'on' : ''} onClick={() => { setPhase('corners'); api.current?.setPhase('corners'); }}>Corners</button>
              <button className={phase === 'openings' ? 'on' : ''} disabled={counts.corners < 3} onClick={() => { setPhase('openings'); api.current?.setPhase('openings'); }}>Doors &amp; windows</button>
            </div>
            {phase === 'openings' && (
              <div className="seg"><button className={kind === 'door' ? 'on' : ''} onClick={() => { setKind('door'); api.current?.setKind('door'); }}>Door</button><button className={kind === 'window' ? 'on' : ''} onClick={() => { setKind('window'); api.current?.setKind('window'); }}>Window</button></div>
            )}
            <div className="aim-actions">
              <button className="btn" onClick={() => api.current?.undo()}>Undo</button>
              <button className="btn primary big" disabled={!counts.tracking} onClick={() => api.current?.add()}>{phase === 'corners' ? 'Add corner' : 'Add point'}</button>
              <span style={{ width: 72 }} />
            </div>
          </div>
        </>
      )}
    </div>
  );
}
