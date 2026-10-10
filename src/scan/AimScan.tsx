import { useCallback, useEffect, useRef, useState } from 'react';
import type { Pt } from '../types';
import { LenInput } from '../components/LenInput';
import { fmtLen } from '../units';
import { useStore } from '../store';
import { dist } from '../geometry';
import {
  OPENING_DEFAULTS, averageDirections, ceilingHeightFrom, elevationDeg, floorHit, floorHitError, lookDirection,
  type Dir, type ScanOpening, type ScanResult,
} from './geometry';

type Mode = 'corners' | 'openings' | 'ceiling' | 'anchor';

const toast = (set: (s: string) => void, msg: string) => { set(msg); setTimeout(() => set(''), 2200); };

/**
 * Works on any phone with a camera and motion sensors (including iPhone): stand in the room,
 * aim the crosshair at each floor corner and tap. Distance comes from the camera height and
 * the angle below the horizon, direction from the gyroscope.
 */
export function AimScan({ onResult, onCancel }: { onResult: (r: ScanResult) => void; onCancel: () => void }) {
  const unit = useStore((s) => s.unit);
  const [phase, setPhase] = useState<'setup' | 'live'>('setup');
  const [camH, setCamH] = useState(() => { try { return Number(localStorage.getItem('roomshift:camh')) || 140; } catch { return 140; } });
  const [err, setErr] = useState('');
  const [msg, setMsg] = useState('');
  const [mode, setMode] = useState<Mode>('corners');
  const [corners, setCorners] = useState<Pt[]>([]);
  const [openings, setOpenings] = useState<ScanOpening[]>([]);
  const [pending, setPending] = useState<Pt | null>(null);
  const [openKind, setOpenKind] = useState<'door' | 'window'>('door');
  const [ceiling, setCeiling] = useState<number | null>(null);
  const [station, setStation] = useState<Pt>({ x: 0, y: 0 });
  const [anchorK, setAnchorK] = useState(0);
  const [noMotion, setNoMotion] = useState(false);
  const [hud, setHud] = useState<{ el: number; d: number | null; err: number | null } | null>(null);

  const video = useRef<HTMLVideoElement>(null);
  const stream = useRef<MediaStream | null>(null);
  const buf = useRef<Dir[]>([]);
  const lastHud = useRef(0);
  const camRef = useRef(camH);
  camRef.current = camH;

  const stop = useCallback(() => { stream.current?.getTracks().forEach((t) => t.stop()); stream.current = null; }, []);
  useEffect(() => stop, [stop]);

  const onOrient = useCallback((e: DeviceOrientationEvent) => {
    if (e.alpha === null || e.beta === null || e.gamma === null) return;
    const d = lookDirection(e.alpha, e.beta, e.gamma);
    buf.current.push(d);
    if (buf.current.length > 8) buf.current.shift();
    const now = performance.now();
    if (now - lastHud.current > 100) {
      lastHud.current = now;
      const avg = averageDirections(buf.current)!;
      const hit = floorHit(avg, camRef.current);
      setHud({ el: elevationDeg(avg), d: hit ? Math.hypot(hit.x, hit.y) : null, err: floorHitError(avg, camRef.current) });
    }
  }, []);

  useEffect(() => {
    if (phase !== 'live') return;
    window.addEventListener('deviceorientation', onOrient);
    // If nothing arrives, the sensors are blocked (preview frames, in-app browsers) or missing.
    const t = setTimeout(() => { if (!buf.current.length) setNoMotion(true); }, 3000);
    return () => { window.removeEventListener('deviceorientation', onOrient); clearTimeout(t); };
  }, [phase, onOrient]);

  const start = async () => {
    setErr('');
    try { localStorage.setItem('roomshift:camh', String(camH)); } catch { /* ignore */ }
    try {
      // iOS asks for motion access, and only inside a tap.
      const DOE = (window as unknown as { DeviceOrientationEvent?: { requestPermission?: () => Promise<string> } }).DeviceOrientationEvent;
      if (DOE?.requestPermission && (await DOE.requestPermission()) !== 'granted') {
        throw new Error('Motion access was not allowed. On iPhone there is no setting to switch on: Safari asks each time you open the page. Close this tab, open the page again, tap Start camera and choose Allow.');
      }
      stream.current = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false });
      setPhase('live');
      requestAnimationFrame(() => { if (video.current) { video.current.srcObject = stream.current; void video.current.play(); } });
    } catch (e) {
      setErr((e as Error).message || 'Could not start the camera.');
    }
  };

  const sample = (): Dir | null => averageDirections(buf.current);

  const mark = () => {
    const dir = sample();
    if (!dir) return toast(setMsg, 'No motion data yet — move the phone a little.');
    if (mode === 'ceiling') {
      const last = corners[corners.length - 1];
      if (!last) return toast(setMsg, 'Mark a corner first.');
      const h = ceilingHeightFrom(dir, camH, dist(last, station));
      if (h === null) return toast(setMsg, 'Aim up at the wall/ceiling line above the last corner.');
      if (h < 190 || h > 500) return toast(setMsg, `${fmtLen(h, unit)} looks wrong — aim right above the last corner.`);
      setCeiling(Math.round(h));
      setMode('corners');
      return toast(setMsg, `Ceiling ${fmtLen(h, unit)}`);
    }
    const hit = floorHit(dir, camH);
    if (!hit) return toast(setMsg, 'Aim lower, at the spot where the floor meets the wall.');
    if (mode === 'anchor') {
      const t = corners[anchorK];
      setStation({ x: t.x - hit.x, y: t.y - hit.y });
      setMode('corners');
      return toast(setMsg, `Position updated from corner ${anchorK + 1}. Continue marking corners.`);
    }
    const p = { x: station.x + hit.x, y: station.y + hit.y };
    if (mode === 'corners') {
      setCorners((c) => [...c, p]);
      return toast(setMsg, `Corner ${corners.length + 1} marked`);
    }
    // openings: left edge, then right edge, on the floor at the foot of the wall
    if (!pending) { setPending(p); return toast(setMsg, 'Now aim at the other edge.'); }
    const d = OPENING_DEFAULTS[openKind];
    setOpenings((o) => [...o, { kind: openKind, a: pending, b: p, height: d.height, sill: d.sill }]);
    setPending(null);
    toast(setMsg, `${openKind} added`);
  };

  const finish = () => onResult({ corners, openings, ceilingHeight: ceiling ?? undefined, source: 'aim' });
  const undo = () => {
    if (mode === 'openings') { if (pending) setPending(null); else setOpenings((o) => o.slice(0, -1)); }
    else setCorners((c) => c.slice(0, -1));
  };

  if (phase === 'setup') {
    return (
      <div className="screen">
        <header className="topbar"><button className="btn icon" onClick={onCancel} aria-label="Back">←</button><h2>Aim &amp; tap scan</h2></header>
        <div className="form">
          <ol className="steps">
            <li>Stand in the middle of the room, holding the phone upright at chest height.</li>
            <li>Aim the crosshair at each floor corner (where wall meets floor) and tap <b>Mark</b>, going around the room.</li>
            <li>Then mark doors and windows by aiming at the foot of each edge.</li>
          </ol>
          <LenInput label="Height of the phone above the floor" value={camH} min={80} max={200} onChange={setCamH} />
          <p className="note">Measure from the floor to the phone while you hold it. The scan is only as accurate as this number and how steadily you aim — you can fix any measurement afterwards.</p>
          {err && <p className="error">{err}</p>}
          <button className="btn primary big" onClick={start}>Start camera</button>
        </div>
      </div>
    );
  }

  const bad = hud && (hud.el > -MIN_ANGLE_WARN);
  const status = mode === 'corners' ? `Corner ${corners.length + 1}` : mode === 'openings' ? `${openKind === 'door' ? 'Door' : 'Window'}: ${pending ? 'right' : 'left'} edge` : mode === 'ceiling' ? 'Aim at ceiling line above last corner' : `Aim at corner ${anchorK + 1} again`;

  return (
    <div className="aim">
      <video ref={video} playsInline muted autoPlay className="aim-video" />
      <div className="aim-cross" />
      <div className="aim-top">
        <button className="btn icon" onClick={() => { stop(); onCancel(); }} aria-label="Cancel">✕</button>
        <div className="aim-status">{status}</div>
        <button className="btn" disabled={corners.length < 3} onClick={() => { stop(); finish(); }}>Done</button>
      </div>
      <div className="aim-hud">
        {hud ? (
          <>
            <b>{hud.d !== null ? `≈ ${fmtLen(hud.d, unit)} away` : bad ? 'Aim lower, at the floor' : '…'}</b>
            {hud.d !== null && hud.err !== null && <small>{hud.err > 25 ? `⚠ ±${fmtLen(hud.err, unit)} — move closer to this corner` : `±${fmtLen(hud.err, unit)}`}</small>}
            <small>{corners.length} corners · {openings.length} openings{ceiling ? ` · ceiling ${fmtLen(ceiling, unit)}` : ''}</small>
          </>
        ) : noMotion ? (
          <><b>No motion data</b><small>Open this page directly in Safari or Chrome (not inside another app or a preview) and allow motion access when asked.</small></>
        ) : <b>Move the phone slightly to wake the motion sensors…</b>}
      </div>
      {msg && <div className="hint aim-toast">{msg}</div>}
      <div className="aim-bottom">
        <div className="seg aim-modes">
          <button className={mode === 'corners' ? 'on' : ''} onClick={() => { setMode('corners'); setPending(null); }}>Corners</button>
          <button className={mode === 'openings' ? 'on' : ''} disabled={corners.length < 3} onClick={() => setMode('openings')}>Doors &amp; windows</button>
          <button className={mode === 'ceiling' ? 'on' : ''} disabled={!corners.length} onClick={() => setMode('ceiling')}>Ceiling</button>
          <button className={mode === 'anchor' ? 'on' : ''} disabled={!corners.length} onClick={() => setMode('anchor')}>I moved</button>
        </div>
        {mode === 'openings' && (
          <div className="seg"><button className={openKind === 'door' ? 'on' : ''} onClick={() => setOpenKind('door')}>Door</button><button className={openKind === 'window' ? 'on' : ''} onClick={() => setOpenKind('window')}>Window</button></div>
        )}
        {mode === 'anchor' && (
          <div className="chips">{corners.map((_, i) => <button key={i} className={`chip${anchorK === i ? ' on' : ''}`} onClick={() => setAnchorK(i)}>Corner {i + 1}</button>)}</div>
        )}
        <div className="aim-actions">
          <button className="btn" disabled={!corners.length && !openings.length && !pending} onClick={undo}>Undo</button>
          <button className="shutter" aria-label="Mark" onClick={mark} />
          <span style={{ width: 72 }} />
        </div>
      </div>
    </div>
  );
}

const MIN_ANGLE_WARN = 5;
