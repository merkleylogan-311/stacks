# Stacks App

A single-file PWA book discovery app — like Tinder for books.

## Project structure

```
index.html     — entire app (CSS + HTML + JS, ~3550 lines)
manifest.json  — PWA manifest
sw.js          — service worker (cache-first assets, network-first Open Library API)
icon.svg       — source app icon
icon-192.png   — app icon
icon-512.png   — app icon
```

## Architecture

Everything lives in `index.html` — no build step, no dependencies, no bundler. Firebase SDKs are loaded from a CDN. The app runs directly in the browser as a PWA installable on iOS/Android.

**Auth**: Firebase Auth (project `stacks-7fbea`) — Google sign-in popup and email/password. There is also a "Continue as Guest" mode. Auth state drives `currentUser`.

**Data layer**: Per-user state is `savedBooks`, `readBooks`, `stats`, `seenKeys`.
- **Signed-in users**: synced to Firestore at `users/{uid}` — `pushToFirestore()` (debounced 2s via `scheduleFirestoreSave()`) on writes, `loadFromFirestore()` on sign-in. `localStorage` is kept as an offline cache.
- **Guest mode / offline**: state persisted only to `localStorage`, namespaced by profile via `profileKey(k)` → `stacks_<k>_<uid|profileId>`.

**API**: Open Library (`openlibrary.org`) for book data and covers.

## Screens (bottom nav)

- **Discover** — swipeable card stack by genre category
- **Search** — search Open Library by title/author
- **Library** — saved books, filterable by genre
- **Read** — books marked as read, filterable by rating + genre
- **Stats** — swipe stats + genre breakdown

## Key features

- Swipe right to save, swipe left to pass, undo last swipe
- "For You" category with personalized recommendations based on saved books
- Detail modal with book info, subjects, description, audiobook narration suggestions
- Rate modal: star rating (1-5), date read, format (physical/audiobook/ebook)
- Summary/non-original book filter (`SUMMARY_PATTERNS`) to exclude abridged/study-guide books
- Hardcoded audiobook narration data for ~40 well-known books

## Development

Open `index.html` in a browser directly — no server needed for most work. For PWA features (service worker, install prompt), serve via a local HTTP server:

```sh
python3 -m http.server 8080
# then open http://localhost:8080
```

## Deployment

Two deployment paths are configured. There is no build or CI step in either; any
asset change must be paired with a `CACHE_NAME` bump in `sw.js` or returning users
will keep serving stale cached files.

**GitHub Pages (currently live):** served from the `main` branch at
https://merkleylogan-311.github.io/stacks/. Pushing to `main` deploys to all users.
There is no staging environment.

**Firebase Hosting (configured, not yet deployed):** `firebase.json` includes a
hosting block targeting the `stacks-7fbea` project. To deploy:

```sh
~/bin/firebase deploy --only hosting
```

This would publish to `https://stacks-7fbea.web.app/` — a different URL than the
GitHub Pages site. Running both simultaneously means users on the old URL keep
hitting GitHub Pages; only new shares of the Firebase URL go there. Pick one as
canonical (e.g. update PWA manifest + shared URLs) before fully switching.

**Firestore rules** are deployed separately with:

```sh
~/bin/firebase deploy --only firestore:rules
```

The Firebase backend itself (Auth providers, Firestore database creation) is
managed via the Firebase console — only rules and hosting are deployable from
this repo.
