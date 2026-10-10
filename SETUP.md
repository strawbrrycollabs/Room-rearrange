# Turning on accounts, sync and sharing (Supabase)

Without these steps RoomShift still works: everyone is a guest and rooms stay on their device.

## 1. Create the project
1. Create a free project at <https://supabase.com>.
2. **SQL Editor → New query**, paste the contents of `supabase/schema.sql`, run it.
   This creates the `rooms` and `shares` tables, row-level security (users only see their own rooms)
   and the `get_shared_room` function that powers view-only links.

## 2. Add the keys
Copy `.env.example` to `.env.local` and fill in **Project Settings → API**: the project URL and the `anon` public key.
(The anon key is safe to ship in the browser; row-level security protects the data.)
For hosting (Vercel/Netlify/…), set the same two variables in the host's environment settings and rebuild.

## 3. Sign-in methods
**Authentication → URL Configuration**
- *Site URL*: your app's URL (e.g. `https://roomshift.example.com`)
- *Redirect URLs*: add the same URL and `http://localhost:5173` for development.

**Email**: enabled by default. Decide under *Authentication → Providers → Email* whether to require email confirmation.

**Google** (*Authentication → Providers → Google*):
1. In <https://console.cloud.google.com> → APIs & Services → Credentials → *Create OAuth client ID* (type: Web application).
2. Add the **Callback URL** shown on Supabase's Google provider page as an *Authorized redirect URI*.
3. Paste the Client ID and secret into Supabase and enable the provider.

## How sync works
- Local-first: every change is saved on the device immediately and pushed to the cloud a couple of seconds later.
- Other devices pull on startup, when the tab becomes visible, when coming back online, and every minute.
- Conflicts are resolved per room by *last write wins* (the most recent edit replaces the other copy).
  If you edit the same room on two devices while offline, the later edit wins.
- Deleting a room removes it from all your devices.
- Signing in uploads the rooms you made as a guest to your account.

## Sharing
*Export & share → Create link* makes a long random link (`/#/s/<token>`). Anyone with it can view the room in 2D/3D and walk
through it, or save their own copy; they cannot edit yours. The link always shows your latest synced version.
Press ✕ next to a link to stop sharing.

## Phone scanning
Needs HTTPS (camera and motion sensors only work on secure pages; `localhost` is fine for development).
- **AR scan**: WebXR hit-testing. Works on Android phones with Chrome and Google Play Services for AR (ARCore). Not available on iPhone.
- **Aim & tap**: any phone with a camera and motion sensors, including iPhone (Safari asks for motion access).
  Distance is estimated from the phone's height above the floor and the angle to the floor corner, so accuracy is roughly
  ±5–10% for corners aimed at from 1.5–4 m away. The review screen can straighten walls to right angles.
