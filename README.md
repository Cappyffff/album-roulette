# 100 Albums to Listen To

A little website for working through the 100-albums chart: spin a random album
each day (a slot-machine reel of covers), rate it out of 100, leave comments,
and browse your history, leaderboard, and the full chart. Anyone with the link
can review the current album — only you (with the owner code) can spin, set
the official rating, edit it later, and delete other people's reviews.

## Files

| File | What it is |
|---|---|
| `index.html` | The page (icon + cache-version tags live here) |
| `style.css` | Styling |
| `app.js` | All the logic |
| `albums.js` | The 100 albums with cover-art URLs and gradient colors |
| `config.js` | Your Firebase config + owner code |
| `icon.png` | Browser-tab favicon and iPhone home-screen icon |

## Run it locally

Open the folder in a terminal and run:

```
python3 -m http.server 8080
```

Then open http://localhost:8080. With Firebase configured this uses the real
shared database — add **`?local=1`** to the URL to use browser-only test
storage instead (nothing you do there touches the real data).

## One-time setup

### Firebase (the shared database)

1. Go to https://console.firebase.google.com, create a project.
2. **Build → Firestore Database → Create database** (production mode).
3. **Rules** tab — paste and Publish:

   ```
   rules_version = '2';
   service cloud.firestore {
     match /databases/{database}/documents {
       match /rolls/{doc} {
         allow read, write: if true;
       }
       match /reviews/{doc} {
         allow read, create, delete: if true;
       }
     }
   }
   ```

   (Writable by anyone who has the link — fine for a hobby page shared with
   friends. The owner code hides the controls, but it isn't bank-vault
   security.)
4. **Project settings (⚙️) → Your apps → `</>`** — register a web app and copy
   the `firebaseConfig = { ... }` object into `config.js`.
5. Set your own `OWNER_CODE` in `config.js`.

### GitHub Pages (the website host)

1. Create a **public** repo on https://github.com and upload all seven files.
2. **Settings → Pages** → Branch `main`, folder `/ (root)` → Save.
3. Your site: `https://<username>.github.io/<repo>/`. On your phone, use
   "Add to Home Screen" — it picks up `icon.png`.

First visit: tap the 🔒, enter your owner code, and press
**"Import my first 7 albums"** once (only appears while history is empty).

## Day to day

- **Today** — 🎲 Spin rolls a random album that's never been rolled (repeats
  are impossible), with a cover reel that lands on the winner. Or type a
  number 1–100 someone gave you. Rate 0–100 + comment after listening. The
  page background takes its colors from the current album's cover. Below,
  anyone can submit their own name + rating + comment.
- **Past** — History ("Day 1, 2, 3…"), Leaderboard (ranked by your official
  rating), and The Chart (the full 10×10 grid; tap any album for a popup with
  its cover, day, scores, and everyone's reviews).
- **Thoughts** — everyone's reviews grouped by album.
- **Owner tools** (after unlocking with the 🔒): "✎ Edit rating" in an
  album's popup changes your official score/comment; the ✕ next to any
  review (popup or Thoughts tab) deletes it.

## Updating the site later

Re-upload the changed files to the GitHub repo. The **Actions** tab shows a
green check when the deploy is live (usually under a minute); browsers can
cache the old page for up to ~10 minutes, so hard-refresh to see it sooner.
When `app.js`, `style.css`, `albums.js`, or `config.js` change, also bump the
`?v=` number on the four tags in `index.html` so everyone's browser fetches
the fresh files.

## Changing an album or its cover

Each entry in `albums.js` has `artist`, `title`, `cover` (any image URL), and
`colors` (two hex colors used for the page gradient when that album is up).
Edit and re-upload `albums.js` (and bump `?v=`).
