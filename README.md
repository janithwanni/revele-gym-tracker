# Relevé — workout tracker for dancers

An offline-capable web app (PWA) for unilateral strength, plyometrics and functional training.
Built with **Vite**, hosted on **Cloudflare Pages**, with optional cloud sync stored in **Cloudflare KV**.

```
index.html            app shell (Vite entry)
src/app.js            the app (views, workout logic, timers, progress charts)
src/sync.js           background sync with /api/data
src/merge.js          merge rules for combining two devices' data
src/sw.js             service worker template (offline cache, versioned at build)
public/               manifest + icons, copied as-is
functions/api/data.js Cloudflare Pages Function — reads/writes KV
wrangler.toml         Pages project name + KV binding (RELEVE_KV)
scripts/              setup and dev helpers
tests/                merge tests (npm test)
```

## First-time setup

Requires Node 20+ and a (free) Cloudflare account.

```sh
npm install
npm run setup     # logs in to Cloudflare, creates the KV namespace + Pages project
npm run deploy    # builds and deploys → https://releve.pages.dev
```

`npm run setup` writes the KV namespace id into `wrangler.toml`; commit that change.
To use a different project name (and URL), change `name` in `wrangler.toml` before running setup.

## Scripts

| Command | What it does |
| --- | --- |
| `npm run dev` | Vite with hot reload on :5173 + Pages Functions with a local KV on :8788 (`/api` is proxied) |
| `npm run build` | Production build into `dist/` (also generates `sw.js`) |
| `npm run preview` | Build, then serve `dist/` + Functions exactly like Cloudflare does, on :8788 |
| `npm run deploy` | Build and deploy to production |
| `npm run deploy:preview` | Build and deploy to a preview URL (`preview.releve.pages.dev`) |
| `npm test` | Run the sync-merge tests |

Local dev keeps KV data in `.wrangler/` — it never touches the production namespace.

### Deploying from Git instead (optional)
In the Cloudflare dashboard → Workers & Pages → your project → Settings, connect the GitHub repo with
build command `npm run build` and output directory `dist`. The KV binding from `wrangler.toml` is used automatically.

## Cloud sync

Sync is off until you turn it on in **Settings → Cloud sync**. That generates a private **sync code**;
enter it on your other devices with **"I have a code"**.

- Data is always saved on the device first, so the app works fully offline; it syncs when online,
  when the app is reopened, and a couple of seconds after each change.
- Changes from different devices are merged: workouts and templates from both are kept, the newer edit
  of the same template wins, and deletions carry over. The workout in progress stays on the device it was started on.
- The server stores one document per sync code under `user:<sha256(code)>` in KV, with version checks
  so two devices saving at once don't overwrite each other.
- **The sync code is the only key.** Anyone who has it can read and change that data — treat it like a password.
  For extra protection you can put the site behind [Cloudflare Access](https://developers.cloudflare.com/cloudflare-one/applications/) (free for up to 50 users).

## Install on your phone

Open the deployed URL, then:
- **iPhone:** Safari → Share → **Add to Home Screen**
- **Android:** Chrome menu → **Install app**

With sync on, the separate storage of Safari vs. the home-screen app doesn't matter — both pull from the cloud.

## Pasting a plan as text

```
Session 1
A) Squat 8-10rep x3 Rest120s
B1) Bulgarian split squat 6-8rep x3
B2) SL pogo hops 15s x3 Rest90s
C) Copenhagen plank 20-30s x3 each side Rest60s
```
Letters = blocks, numbers = supersets, `s` = timed, `SL` / `each side` / `single-leg` = unilateral.
