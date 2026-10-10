import { lazy, Suspense, useEffect, useMemo, useState } from 'react';
import { useStore } from '../store';
import { StaticPlan } from '../components/StaticPlan';
import { LenInput } from '../components/LenInput';
import { arSupported } from './ARScan';
import { buildRoom, type ScanResult } from './geometry';
import { fmtLen } from '../units';
import { polygonArea } from '../geometry';

const ARScan = lazy(() => import('./ARScan').then((m) => ({ default: m.ARScan })));
const AimScan = lazy(() => import('./AimScan').then((m) => ({ default: m.AimScan })));

type Step = 'choose' | 'ar' | 'aim' | 'review';

export function ScanFlow({ onBack, onManual }: { onBack: () => void; onManual: () => void }) {
  const [step, setStep] = useState<Step>('choose');
  const [result, setResult] = useState<ScanResult | null>(null);
  const [ar, setAr] = useState<boolean | null>(null);
  useEffect(() => { void arSupported().then(setAr); }, []);

  const done = (r: ScanResult) => { setResult(r); setStep('review'); };
  const cam = !!navigator.mediaDevices?.getUserMedia && 'DeviceOrientationEvent' in window && window.isSecureContext;

  if (step === 'ar') return <Suspense fallback={<div className="screen center">Loading…</div>}><ARScan onResult={done} onCancel={() => setStep('choose')} /></Suspense>;
  if (step === 'aim') return <Suspense fallback={<div className="screen center">Loading…</div>}><AimScan onResult={done} onCancel={() => setStep('choose')} /></Suspense>;
  if (step === 'review' && result) return <Review scan={result} onRescan={() => setStep('choose')} />;

  return (
    <div className="screen">
      <header className="topbar"><button className="btn icon" onClick={onBack} aria-label="Back">←</button><h2>Scan with phone</h2></header>
      <div className="stack">
        <button className="method" disabled={!ar} onClick={() => setStep('ar')}>
          <span className="m-icon">📡</span>
          <span><strong>AR scan {ar ? <em className="tag">Most accurate</em> : null}</strong>
            <small>{ar === null ? 'Checking your phone…' : ar ? 'Your phone measures the room itself' : 'Not supported by this browser or phone (needs Android with Chrome and ARCore)'}</small></span>
        </button>
        <button className="method" disabled={!cam} onClick={() => setStep('aim')}>
          <span className="m-icon">🎯</span>
          <span><strong>Aim &amp; tap</strong>
            <small>{cam ? 'Works on any phone, including iPhone. Aim at each corner; sizes are estimated' : window.isSecureContext ? 'Needs a camera and motion sensors (use a phone)' : 'Needs a secure (https) connection'}</small></span>
        </button>
        <button className="method" onClick={onManual}>
          <span className="m-icon">📏</span>
          <span><strong>Enter measurements instead</strong><small>Type the wall lengths with a tape measure</small></span>
        </button>
        <p className="note">Whatever method you pick, you review the result first and can adjust every wall, door and window afterwards.</p>
      </div>
    </div>
  );
}

function Review({ scan, onRescan }: { scan: ScanResult; onRescan: () => void }) {
  const unit = useStore((s) => s.unit);
  const addRoom = useStore((s) => s.addRoom);
  const [name, setName] = useState('Scanned room');
  const [straight, setStraight] = useState(true);
  const [ceil, setCeil] = useState(scan.ceilingHeight ?? 250);
  const [removed, setRemoved] = useState<number[]>([]);
  const kept = useMemo(() => ({ ...scan, openings: scan.openings.filter((_, i) => !removed.includes(i)) }), [scan, removed]);
  const room = useMemo(() => buildRoom(kept, { name, straighten: straight, ceilingHeight: ceil }), [kept, name, straight, ceil]);

  return (
    <div className="screen">
      <header className="topbar"><button className="btn icon" onClick={onRescan} aria-label="Back">←</button><h2>Review scan</h2></header>
      <div className="form">
        <StaticPlan room={room} items={[]} unit={unit} dims className="preview" />
        <p className="note">{room.corners.length} corners · {(polygonArea(room.corners) / 10000).toFixed(1)} m² · {room.openings.length} door/window{room.openings.length === 1 ? '' : 's'} found.
          {scan.source === 'aim' ? ' Aim & tap sizes are estimates — check them against a tape measure.' : ''}</p>
        <label className="lbl"><span>Name</span><input className="field" value={name} onChange={(e) => setName(e.target.value)} /></label>
        <label className="check"><input type="checkbox" checked={straight} onChange={(e) => setStraight(e.target.checked)} /> Straighten walls to right angles</label>
        <LenInput label={scan.ceilingHeight ? 'Ceiling height (measured)' : 'Ceiling height'} value={ceil} min={150} max={600} onChange={setCeil} />
        {scan.openings.length > 0 && (
          <div>
            <h4>Doors &amp; windows</h4>
            {scan.openings.map((o, i) => (
              <div key={i} className={`list-row${removed.includes(i) ? ' off' : ''}`} style={{ gridTemplateColumns: '1fr auto' }}>
                <span><b style={{ textTransform: 'capitalize', fontWeight: 600 }}>{o.kind}</b> · {fmtLen(Math.hypot(o.b.x - o.a.x, o.b.y - o.a.y), unit)} wide</span>
                <button className="btn" onClick={() => setRemoved((r) => (r.includes(i) ? r.filter((x) => x !== i) : [...r, i]))}>{removed.includes(i) ? 'Restore' : 'Remove'}</button>
              </div>
            ))}
            <p className="note">Heights and exact positions can be set in the room editor.</p>
          </div>
        )}
        <button className="btn primary big" onClick={() => addRoom(room)}>Create room</button>
        <button className="btn ghost" onClick={onRescan}>Scan again</button>
      </div>
    </div>
  );
}
