import { useEffect, useState } from 'react';
import { cloudEnabled, createShare, listShares, revokeShare, sendMagicLink, signInWithGoogle, signInWithPassword, signOut, signUpWithPassword, syncNow, useCloud } from '../cloud';
import { Dialog } from './Dialogs';

export function AccountButton({ onClick }: { onClick: () => void }) {
  const { user, status } = useCloud();
  const label = user ? (user.name || user.email || '?').slice(0, 1).toUpperCase() : '👤';
  return (
    <button className="btn icon account-btn" aria-label={user ? 'Account' : 'Sign in'} onClick={onClick}>
      {user?.avatar ? <img src={user.avatar} alt="" referrerPolicy="no-referrer" /> : label}
      {user && <i className={`dot ${status}`} />}
    </button>
  );
}

const statusText = { idle: 'Waiting', syncing: 'Syncing…', synced: 'Up to date', offline: 'Offline — will sync when you are back online', error: 'Sync problem' } as const;

export function AccountDialog({ onClose }: { onClose: () => void }) {
  const { user, ready, status, lastSync, error } = useCloud();
  if (!cloudEnabled) {
    return (
      <Dialog title="Account" onClose={onClose}>
        <p>You're using RoomShift as a guest: everything is saved on this device only.</p>
        <p className="note">Cloud sync and sharing aren't switched on in this build. (Whoever hosts the app needs to add the Supabase keys — see <code>SETUP.md</code>.)</p>
      </Dialog>
    );
  }
  if (!ready) return <Dialog title="Account" onClose={onClose}><p className="note">Loading…</p></Dialog>;
  if (user) return <SignedIn onClose={onClose} email={user.email} name={user.name} status={status} lastSync={lastSync} error={error} />;
  return <SignIn onClose={onClose} />;
}

function SignIn({ onClose }: { onClose: () => void }) {
  const [mode, setMode] = useState<'in' | 'up'>('in');
  const [email, setEmail] = useState('');
  const [pw, setPw] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const user = useCloud((s) => s.user);
  useEffect(() => { if (user) onClose(); }, [user, onClose]);

  const wrap = async (fn: () => Promise<void>) => {
    setBusy(true); setMsg(null);
    try { await fn(); } catch (e) { setMsg({ ok: false, text: (e as Error).message }); } finally { setBusy(false); }
  };
  const valid = /\S+@\S+\.\S+/.test(email);

  return (
    <Dialog title="Sign in to sync" onClose={onClose}>
      <p className="note" style={{ marginTop: 0 }}>Optional. Your rooms sync across devices and you can share view-only links. Rooms you already made on this device are added to your account.</p>
      <button className="btn wide" disabled={busy} onClick={() => wrap(signInWithGoogle)}>
        <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden><path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9.1 3.6l6.8-6.8C35.8 2.4 30.3 0 24 0 14.6 0 6.5 5.4 2.6 13.2l7.9 6.1C12.4 13.6 17.7 9.5 24 9.5z"/><path fill="#4285F4" d="M46.5 24.5c0-1.6-.1-3.1-.4-4.5H24v9h12.7c-.6 3-2.2 5.5-4.7 7.2l7.6 5.9c4.4-4.1 6.9-10.1 6.9-17.6z"/><path fill="#FBBC05" d="M10.5 28.7c-.5-1.4-.8-3-.8-4.7s.3-3.2.8-4.7l-7.9-6.1C.9 16.4 0 20.100 0 24s.9 7.600 2.600 10.800l7.900-6.100z"/><path fill="#34A853" d="M24 48c6.500 0 11.900-2.100 15.900-5.800l-7.600-5.900c-2.100 1.400-4.900 2.300-8.300 2.300-6.300 0-11.600-4.100-13.500-9.800l-7.900 6.100C6.500 42.600 14.600 48 24 48z"/></svg>
        Continue with Google
      </button>
      <div className="or"><span>or use email</span></div>
      <label className="lbl"><span>Email</span><input className="field" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} /></label>
      <label className="lbl"><span>Password</span><input className="field" type="password" autoComplete={mode === 'up' ? 'new-password' : 'current-password'} value={pw} onChange={(e) => setPw(e.target.value)} /></label>
      <button
        className="btn primary wide"
        disabled={busy || !valid || pw.length < 6}
        onClick={() => wrap(async () => {
          if (mode === 'in') await signInWithPassword(email, pw);
          else if (await signUpWithPassword(email, pw)) setMsg({ ok: true, text: 'Check your inbox and confirm your email, then sign in.' });
        })}
      >
        {mode === 'in' ? 'Sign in' : 'Create account'}
      </button>
      <div className="row2">
        <button className="link" onClick={() => { setMode(mode === 'in' ? 'up' : 'in'); setMsg(null); }}>{mode === 'in' ? 'New here? Create account' : 'Have an account? Sign in'}</button>
        <button className="link" disabled={busy || !valid} onClick={() => wrap(async () => { await sendMagicLink(email); setMsg({ ok: true, text: 'Link sent. Open it on this device.' }); })}>Email me a sign-in link</button>
      </div>
      {msg && <p className={msg.ok ? 'note' : 'error'}>{msg.text}</p>}
    </Dialog>
  );
}

function SignedIn({ onClose, email, name, status, lastSync, error }: { onClose: () => void; email: string; name: string; status: keyof typeof statusText; lastSync: number | null; error: string }) {
  const [confirm, setConfirm] = useState(false);
  return (
    <Dialog title="Account" onClose={onClose}>
      <div className="who"><strong>{name}</strong><small>{email}</small></div>
      <div className="card">
        <div className="card-head"><span><i className={`dot inline ${status}`} /> {statusText[status]}</span>
          <button className="btn" disabled={status === 'syncing'} onClick={() => void syncNow()}>Sync now</button></div>
        {lastSync && <small className="note">Last synced {new Date(lastSync).toLocaleTimeString()}</small>}
        {status === 'error' && <p className="error">{error}</p>}
      </div>
      {!confirm ? (
        <button className="btn wide" onClick={() => setConfirm(true)}>Sign out</button>
      ) : (
        <div className="card">
          <p style={{ marginTop: 0 }}>Keep your rooms on this device?</p>
          <div className="actions">
            <button className="btn" onClick={async () => { await signOut(false); onClose(); }}>Keep rooms</button>
            <button className="btn danger" onClick={async () => { await signOut(true); onClose(); }}>Remove from this device</button>
          </div>
          <p className="note">Rooms are always safe in your account. Use “Remove” on shared computers.</p>
        </div>
      )}
    </Dialog>
  );
}

/* ---------------- Share section (used in the export dialog) ---------------- */

export function ShareSection({ roomId, onNeedAccount }: { roomId: string; onNeedAccount: () => void }) {
  const user = useCloud((s) => s.user);
  const [links, setLinks] = useState<{ token: string; url: string }[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [copied, setCopied] = useState('');

  useEffect(() => {
    if (!user) return;
    listShares(roomId).then(setLinks).catch(() => undefined);
  }, [user, roomId]);

  if (!cloudEnabled) return null;
  if (!user) {
    return (
      <button className="method" onClick={onNeedAccount}>
        <span className="m-icon">🔗</span><span><strong>Share view-only link</strong><small>Sign in to create a link</small></span>
      </button>
    );
  }
  const copy = async (url: string) => {
    try { await navigator.clipboard.writeText(url); setCopied(url); setTimeout(() => setCopied(''), 1800); }
    catch { prompt('Copy this link', url); }
  };
  const create = async () => {
    setBusy(true); setErr('');
    try { const url = await createShare(roomId); setLinks(await listShares(roomId)); await copy(url); }
    catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  };
  return (
    <div className="card">
      <div className="card-head"><strong>🔗 Share view-only link</strong></div>
      <p className="note" style={{ marginTop: 4 }}>Anyone with the link can look around in 2D and 3D, but not edit. It always shows your latest synced version.</p>
      {links.map((l) => (
        <div key={l.token} className="list-row" style={{ gridTemplateColumns: '1fr auto auto' }}>
          <input className="field" readOnly value={l.url} onFocus={(e) => e.currentTarget.select()} />
          <button className="btn" onClick={() => copy(l.url)}>{copied === l.url ? 'Copied' : 'Copy'}</button>
          <button className="btn icon danger" aria-label="Stop sharing" onClick={async () => { await revokeShare(l.token).catch((e) => setErr(e.message)); setLinks(links.filter((x) => x.token !== l.token)); }}>✕</button>
        </div>
      ))}
      <button className="btn wide" disabled={busy} onClick={create}>{busy ? 'Creating…' : links.length ? '＋ New link' : 'Create link'}</button>
      {err && <p className="error">{err}</p>}
    </div>
  );
}
