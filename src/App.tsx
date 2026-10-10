import { useEffect, useState } from 'react';
import { useStore } from './store';
import { Editor } from './components/Editor';
import { CreateRoom, Home, Onboarding } from './components/Screens';
import { ShareView } from './components/ShareView';

export default function App() {
  const onboarded = useStore((s) => s.onboarded);
  const currentId = useStore((s) => s.currentId);
  const hasRoom = useStore((s) => s.rooms.some((r) => r.id === s.currentId));
  const theme = useStore((s) => s.theme);
  const [creating, setCreating] = useState(false);
  const [hash, setHash] = useState(location.hash);
  useEffect(() => {
    const f = () => setHash(location.hash);
    addEventListener('hashchange', f);
    return () => removeEventListener('hashchange', f);
  }, []);

  useEffect(() => { document.documentElement.dataset.theme = theme; }, [theme]);
  useEffect(() => { if (currentId) setCreating(false); }, [currentId]);

  const share = hash.match(/^#\/s\/([\w-]{16,})$/);
  if (share) return <ShareView token={share[1]} />;
  if (!onboarded) return <Onboarding />;
  if (hasRoom) return <Editor />;
  if (creating) return <CreateRoom onCancel={() => setCreating(false)} />;
  return <Home onCreate={() => setCreating(true)} />;
}
