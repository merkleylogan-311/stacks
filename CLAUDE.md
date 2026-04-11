# Stacks App

A single-file PWA book discovery app — like Tinder for books.

## Project structure

```
index.html     — entire app (CSS + HTML + JS, ~1850 lines)
manifest.json  — PWA manifest
sw.js          — service worker (cache-first assets, network-first Open Library API)
icon-192.png   — app icon
icon-512.png   — app icon
```

## Architecture

Everything lives in `index.html` — no build step, no dependencies, no bundler. The app runs directly in the browser as a PWA installable on iOS/Android.

**Data layer**: All state persisted to `localStorage` (`stacks_saved`, `stacks_read`, `stacks_stats`, `stacks_seen`).

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
