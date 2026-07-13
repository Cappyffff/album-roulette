# 100 Albums to Listen To

A little website for working through the 100-albums chart: spin a random album
each day, rate it out of 100, leave comments, and browse your history,
leaderboard, and the full chart. Anyone with the link can leave their own
review of the current album — only you (with the owner code) can spin and set
the official rating.

## Files

| File | What it is |
|---|---|
| `index.html` | The page |
| `style.css` | Styling |
| `app.js` | All the logic |
| `albums.js` | The 100 albums (edit `cover: ""` fields to add cover-art URLs) |
| `config.js` | Your Firebase config + owner code |

## Try it right now (no setup)

Open the folder in a terminal and run:

```
python3 -m http.server 8080
```

Then open http://localhost:8080 — it runs in **local test mode**
(data saved only in that browser). Click the 🔒 in the header and enter the
owner code (default `RLRY2JRG`) to unlock spinning, then use the
**"Import my first 7 albums"** button on the Today tab to load your existing
ratings.

## Step 1 — Firebase (free database, ~10 minutes)

This is what lets your phone, your computer, and your friends all see the
same data.

1. Go to https://console.firebase.google.com and sign in with a Google account.
2. **Create a project** (any name, e.g. `hundred-albums`). You can turn off
   Google Analytics when asked.
3. In the left sidebar: **Build → Firestore Database → Create database**.
   Choose a location near you, and pick **Start in production mode**.
4. Open the **Rules** tab of Firestore and replace the rules with:

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

   Click **Publish**. (This makes the data writable by anyone who has your
   site link — fine for a hobby page shared with friends; just don't post the
   link somewhere hugely public. The owner code hides the roll/rate buttons
   from visitors, but it isn't bank-vault security.)
5. Go to **Project settings** (gear icon) → **Your apps** → click the `</>`
   (Web) icon → register the app (any nickname, no hosting needed).
   Firebase shows you a `firebaseConfig = { ... }` object.
6. Copy that object into `config.js`, replacing `const FIREBASE_CONFIG = null;`:

   ```js
   const FIREBASE_CONFIG = {
     apiKey: "...",
     authDomain: "...",
     projectId: "...",
     storageBucket: "...",
     messagingSenderId: "...",
     appId: "...",
   };
   ```

7. **Change the owner code** in `config.js` (default is `RLRY2JRG`) to something
   only you know.

## Step 2 — Put it online with GitHub Pages (free)

1. Create a free account at https://github.com if you don't have one.
2. Click **+ → New repository**, name it e.g. `100-albums`, keep it
   **Public**, and create it.
3. On the repo page: **uploading an existing file** → drag in all five files
   (`index.html`, `style.css`, `app.js`, `albums.js`, `config.js`) →
   **Commit changes**.
4. Go to **Settings → Pages**, under "Branch" pick `main` and `/ (root)`,
   then **Save**.
5. After a minute your site is live at
   `https://<your-username>.github.io/100-albums/` — open it on your phone,
   add it to your home screen, and share it with friends.

## First run once it's online

Tap the 🔒 in the header and enter your owner code, then on the **Today**
tab press **"Import my first 7 albums"** once — that loads Rumors (85),
PIXEL BATH (71), Straight From The Heart (75), To Pimp a Butterfly (48),
Grace (79), Remain in Light (80), and Brave Faces Everyone (91).
(The button only appears while the history is empty.)

## How it works day to day

- **Today** — 🎲 Spin picks a random album that hasn't been rolled before
  (repeats are impossible). Or type a number 1–100 someone gave you and hit
  "Roll this number". After the reveal, rate it 0–100 and add your thoughts.
  The page background takes its colors from the current album. Below that,
  **anyone** can submit their own name + rating + comment for the current
  album.
- **Past** — History (every roll, newest first), Leaderboard (ranked by your
  official rating), and The Chart (all 100 with score badges on the ones
  you've done).
- **Thoughts** — everyone's reviews, grouped by album, next to your official
  score.

## Adding cover art later

Each entry in `albums.js` has a `cover: ""` field. Paste any image URL there
(or a relative path like `covers/1.jpg` if you upload image files to the repo)
and the tiles, reveal, and background gradient will use it. Until then the
site shows a colored placeholder tile with the album number, artist, and
title.
