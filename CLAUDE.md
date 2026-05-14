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

The app is hosted on **GitHub Pages**, served from the `main` branch — live at
https://merkleylogan-311.github.io/stacks/. There is no build or CI step: any commit
pushed to `main` goes live to all users automatically. There is no staging environment.

Bump the cache version in `sw.js` when deploying asset changes, or returning users
may keep serving stale cached files.

The Firebase backend (`stacks-7fbea`) is managed separately via the Firebase console —
it is not deployed from this repo.
