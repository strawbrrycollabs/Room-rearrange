import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { create } from 'zustand';
import { useStore } from './store';
import type { Room } from './types';

const url = import.meta.env.VITE_SUPABASE_URL;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY;

/** False when the build has no Supabase credentials: the app then runs as a local-only guest app. */
export const cloudEnabled = Boolean(url && key);

export const supabase: SupabaseClient | null = cloudEnabled
  ? createClient(url!, key!, { auth: { flowType: 'pkce', persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } })
  : null;

export type CloudUser = { id: string; email: string; name: string; avatar?: string };
type Status = 'idle' | 'syncing' | 'synced' | 'offline' | 'error';

export const useCloud = create<{ user: CloudUser | null; ready: boolean; status: Status; lastSync: number | null; error: string }>(() => ({
  user: null, ready: !cloudEnabled, status: 'idle', lastSync: null, error: '',
}));

const set = useCloud.setState;

/* ---------------- Auth ---------------- */

export async function signInWithGoogle() {
  if (!supabase) throw new Error('Cloud sync is not configured');
  const { error } = await supabase.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: location.origin + location.pathname } });
  if (error) throw error;
}

export async function signInWithPassword(email: string, password: string) {
  const { error } = await supabase!.auth.signInWithPassword({ email, password });
  if (error) throw error;
}

/** Returns true when the user must confirm their email before signing in. */
export async function signUpWithPassword(email: string, password: string): Promise<boolean> {
  const { data, error } = await supabase!.auth.signUp({ email, password, options: { emailRedirectTo: location.origin + location.pathname } });
  if (error) throw error;
  return !data.session;
}

export async function sendMagicLink(email: string) {
  const { error } = await supabase!.auth.signInWithOtp({ email, options: { emailRedirectTo: location.origin + location.pathname } });
  if (error) throw error;
}

export async function signOut(clearDevice: boolean) {
  await supabase?.auth.signOut();
  known.clear();
  if (clearDevice) useStore.getState().clearLocalData();
}

/* ---------------- Sync (local-first, last write wins per room) ---------------- */

export type Remote = { id: string; client_updated_at: number; deleted: boolean };
/** id -> client_updated_at as last seen in the cloud. */
const known = new Map<string, number>();
let syncing: Promise<void> | null = null;
let again = false;

export function syncNow(): Promise<void> {
  if (!supabase || !useCloud.getState().user) return Promise.resolve();
  if (syncing) { again = true; return syncing; }
  syncing = run().finally(() => {
    syncing = null;
    if (again) { again = false; void syncNow(); }
  });
  return syncing;
}

async function run() {
  const db = supabase!;
  const user = useCloud.getState().user!;
  set({ status: 'syncing', error: '' });
  try {
    const { data: remoteRows, error: e1 } = await db.from('rooms').select('id, client_updated_at, deleted');
    if (e1) throw e1;
    const remote = new Map((remoteRows as Remote[]).map((r) => [r.id, r]));
    const st = useStore.getState();
    const now = Date.now();

    // 1. Deletions made on this device.
    const clearDeleted: string[] = [];
    const tombstones = st.deletedIds.filter((id) => remote.has(id) && !remote.get(id)!.deleted);
    if (tombstones.length) {
      const { error } = await db.from('rooms').update({ deleted: true, client_updated_at: now }).in('id', tombstones);
      if (error) throw error;
    }
    for (const id of st.deletedIds) { clearDeleted.push(id); known.set(id, now); }

    // 2. Decide what to pull / push.
    const plan = planSync(st.rooms, remote, st.deletedIds);
    const { pullIds, removeIds, push } = plan;
    for (const [id, t] of plan.seen) known.set(id, t);

    // 3. Pull.
    let pulled: Room[] = [];
    if (pullIds.length) {
      const { data, error } = await db.from('rooms').select('id, data, client_updated_at').in('id', pullIds);
      if (error) throw error;
      pulled = (data ?? []).map((row) => ({ ...(row.data as Room), id: row.id as string, updatedAt: row.client_updated_at as number }));
      for (const r of pulled) known.set(r.id, r.updatedAt);
    }

    // 4. Push.
    if (push.length) {
      const { error } = await db.from('rooms').upsert(
        push.map((r) => ({ id: r.id, owner: user.id, name: r.name, data: r, client_updated_at: r.updatedAt, deleted: false })),
        { onConflict: 'id' },
      );
      if (error) throw error;
      for (const r of push) known.set(r.id, r.updatedAt);
    }

    st.applyRemote(pulled, removeIds, clearDeleted);
    set({ status: 'synced', lastSync: Date.now() });
  } catch (e) {
    const offline = !navigator.onLine || (e instanceof TypeError && /fetch|network/i.test(e.message));
    set({ status: offline ? 'offline' : 'error', error: e instanceof Error ? e.message : (e as { message?: string })?.message ?? 'Sync failed' });
  }
}

/**
 * Pure decision step of the sync (last write wins per room, by client_updated_at).
 * `seen` is what the cloud is known to hold after this sync, id -> timestamp.
 */
export function planSync(local: Room[], remote: Map<string, Remote>, deletedIds: string[]) {
  const byId = new Map(local.map((r) => [r.id, r]));
  const pullIds: string[] = [];
  const removeIds: string[] = [];
  const push: Room[] = [];
  const seen = new Map<string, number>();
  for (const [id, rr] of remote) {
    if (deletedIds.includes(id)) continue;
    const l = byId.get(id);
    if (rr.deleted) {
      if (l && l.updatedAt > rr.client_updated_at) push.push(l); // edited after it was deleted elsewhere: keep it
      else if (l) removeIds.push(id);
    } else if (!l) pullIds.push(id);
    else if (rr.client_updated_at > l.updatedAt) pullIds.push(id);
    else if (l.updatedAt > rr.client_updated_at) push.push(l);
    seen.set(id, Math.max(rr.client_updated_at, l?.updatedAt ?? 0));
  }
  for (const l of local) if (!remote.has(l.id)) push.push(l);
  return { pullIds, removeIds, push, seen };
}

function dirty() {
  const s = useStore.getState();
  return s.deletedIds.length > 0 || s.rooms.some((r) => known.get(r.id) !== r.updatedAt);
}

/* ---------------- Sharing ---------------- */

const shareUrl = (token: string) => `${location.origin}${location.pathname}#/s/${token}`;

export async function createShare(roomId: string): Promise<string> {
  await syncNow();
  const bytes = crypto.getRandomValues(new Uint8Array(18));
  const token = btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const { error } = await supabase!.from('shares').insert({ token, room_id: roomId });
  if (error) throw error;
  return shareUrl(token);
}

export async function listShares(roomId: string): Promise<{ token: string; url: string; created_at: string }[]> {
  const { data, error } = await supabase!.from('shares').select('token, created_at').eq('room_id', roomId).order('created_at', { ascending: false });
  if (error) throw error;
  return (data ?? []).map((d) => ({ ...d, url: shareUrl(d.token) }));
}

export async function revokeShare(token: string) {
  const { error } = await supabase!.from('shares').delete().eq('token', token);
  if (error) throw error;
}

/** Works without an account: anyone with the token can read that one room. */
export async function fetchShared(token: string): Promise<Room | null> {
  if (!supabase) throw new Error('Sharing is not available in this build');
  const { data, error } = await supabase.rpc('get_shared_room', { p_token: token });
  if (error) throw error;
  return (data as Room | null) ?? null;
}

/* ---------------- Boot ---------------- */

export function initCloud() {
  if (!supabase) return;
  const apply = (u: { id: string; email?: string; user_metadata?: Record<string, string> } | null | undefined) => {
    const prev = useCloud.getState().user?.id;
    if (!u) { set({ user: null, ready: true, status: 'idle' }); return; }
    set({
      user: { id: u.id, email: u.email ?? '', name: u.user_metadata?.full_name ?? u.user_metadata?.name ?? (u.email ?? '').split('@')[0], avatar: u.user_metadata?.avatar_url },
      ready: true,
    });
    if (prev !== u.id) void syncNow();
  };
  void supabase.auth.getSession().then(({ data }) => apply(data.session?.user));
  supabase.auth.onAuthStateChange((_e, session) => apply(session?.user));

  // Push local edits shortly after they happen.
  let timer: ReturnType<typeof setTimeout> | undefined;
  useStore.subscribe(() => {
    if (!useCloud.getState().user || !dirty()) return;
    clearTimeout(timer);
    timer = setTimeout(() => void syncNow(), 2500);
  });
  // Pull changes made on other devices.
  const pull = () => { if (document.visibilityState === 'visible') void syncNow(); };
  document.addEventListener('visibilitychange', pull);
  addEventListener('online', pull);
  setInterval(pull, 60_000);
}
