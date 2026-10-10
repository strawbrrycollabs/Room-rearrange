# RoomShift

Mobile-first PWA to visualize a room and rearrange furniture before moving anything.
Stack: Vite + React + TypeScript, zustand, SVG 2D plan (Three.js 3D and Supabase sync come in later steps).

```
npm install
npm run dev      # dev server
npm test         # unit tests (geometry, units)
npm run build    # typecheck + production build with service worker
```

## Status
- [x] Step 1: manual/draw room, 2D plan, furniture editing (local storage)
- [x] Step 2: 3D view synced with the plan (orbit, walk-through)
- [x] Step 3: layouts, compare, PNG/PDF export, walking-space + door-swing checks
- [ ] Step 4: Google login and cloud sync (Supabase)
- [ ] Step 5: phone scanning
