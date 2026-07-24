// ── 100 Albums app ───────────────────────────────────────────────────────────
// Data lives in Firebase Firestore when FIREBASE_CONFIG is set (see config.js),
// otherwise in this browser's localStorage (local test mode).

const ALBUM_BY_NUM = Object.fromEntries(ALBUMS.map(a => [a.num, a]));

// The 7 albums rolled before this app existed, in roll order.
const SEED_ROLLS = [
  { num: 91, rating: 85 }, // Fleetwood Mac - Rumors
  { num: 55, rating: 71 }, // Jean Dawson - PIXEL BATH
  { num: 13, rating: 75 }, // Ann Peebles - Straight From The Heart
  { num: 86, rating: 48 }, // Kendrick Lamar - To Pimp a Butterfly
  { num: 62, rating: 79 }, // Jeff Buckley - Grace
  { num: 53, rating: 80 }, // Talking Heads - Remain in Light
  { num: 7,  rating: 91 }, // Spanish Love Songs - Brave Faces Everyone
];

const state = { rolls: [], reviews: [], ready: false };
let tab = "today";
let pastTab = "history";
let spinning = false;
let showRateForm = false; // pending album: rating form stays hidden until "Rate it"
let flash = null; // one-shot {kind, text} message shown after re-render

// ── Storage backends ─────────────────────────────────────────────────────────

// One-time cleanup of an accidental test roll of #19 (Fever To Tell).
// Only removes it if it was never rated, and only runs once per browser.
if (!localStorage.getItem("a100_fix19")) {
  const rolls = JSON.parse(localStorage.getItem("a100_rolls") || "[]");
  if (rolls.some(r => r.num === 19 && (r.rating === null || r.rating === undefined))) {
    localStorage.setItem("a100_rolls", JSON.stringify(rolls.filter(r => r.num !== 19)));
    const reviews = JSON.parse(localStorage.getItem("a100_reviews") || "[]");
    localStorage.setItem("a100_reviews", JSON.stringify(reviews.filter(r => r.num !== 19)));
  }
  localStorage.setItem("a100_fix19", "1");
}

function makeLocalStore() {
  const read = (k) => JSON.parse(localStorage.getItem(k) || "[]");
  const write = (k, v) => localStorage.setItem(k, JSON.stringify(v));
  let notify = () => {};
  const reload = () => {
    state.rolls = read("a100_rolls").sort((a, b) => a.seq - b.seq);
    state.reviews = read("a100_reviews");
    notify();
  };
  return {
    async init(onChange) { notify = onChange; reload(); },
    async addRoll(r) { write("a100_rolls", [...read("a100_rolls"), r]); reload(); },
    async rateRoll(num, rating, comment) {
      write("a100_rolls", read("a100_rolls").map(r => r.num === num ? { ...r, rating, comment } : r));
      reload();
    },
    async addReview(rv) {
      write("a100_reviews", [...read("a100_reviews"), { ...rv, id: String(Date.now()) }]);
      reload();
    },
    async removeReview(id) {
      write("a100_reviews", read("a100_reviews").filter(rv => rv.id !== id));
      reload();
    },
    async importData(data) {
      write("a100_rolls", data.rolls);
      write("a100_reviews", data.reviews.map((rv, i) => ({ ...rv, id: rv.id || String(Date.now() + i) })));
      reload();
    },
  };
}

async function makeFirestoreStore() {
  const { initializeApp } = await import("https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js");
  const fs = await import("https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js");
  const db = fs.getFirestore(initializeApp(FIREBASE_CONFIG));
  return {
    async init(onChange) {
      fs.onSnapshot(fs.collection(db, "rolls"), snap => {
        state.rolls = snap.docs.map(d => d.data()).sort((a, b) => a.seq - b.seq);
        onChange();
      });
      fs.onSnapshot(fs.collection(db, "reviews"), snap => {
        state.reviews = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        onChange();
      });
    },
    async addRoll(r) { await fs.setDoc(fs.doc(db, "rolls", String(r.num)), r); },
    async rateRoll(num, rating, comment) {
      await fs.updateDoc(fs.doc(db, "rolls", String(num)), { rating, comment });
    },
    async addReview(rv) { await fs.addDoc(fs.collection(db, "reviews"), rv); },
    async removeReview(id) { await fs.deleteDoc(fs.doc(db, "reviews", id)); },
    async importData(data) {
      await Promise.all([
        ...data.rolls.map(r => fs.setDoc(fs.doc(db, "rolls", String(r.num)), r)),
        ...data.reviews.map(rv => {
          const { id, ...rest } = rv;
          return id ? fs.setDoc(fs.doc(db, "reviews", id), rest)
                    : fs.addDoc(fs.collection(db, "reviews"), rest);
        }),
      ]);
    },
  };
}

// Add ?local=1 to the URL to force browser-only storage (handy for testing
// without touching the shared database).
const forceLocal = new URLSearchParams(location.search).has("local");
const usingFirebase = !forceLocal && typeof FIREBASE_CONFIG !== "undefined" && !!FIREBASE_CONFIG;
const store = usingFirebase ? await makeFirestoreStore() : makeLocalStore();

// ── Owner lock (UI gate: only you can spin and set the official rating) ─────

const lockEnabled = typeof OWNER_CODE !== "undefined" && OWNER_CODE !== "";
const isOwner = () => !lockEnabled || localStorage.getItem("a100_owner") === "1";

// A number the owner queued: the next spin lands on it instead of random.
const getQueued = () => {
  const n = parseInt(localStorage.getItem("a100_next"), 10);
  return Number.isInteger(n) && n >= 1 && n <= 100 ? n : null;
};
const setQueued = (n) => n === null
  ? localStorage.removeItem("a100_next")
  : localStorage.setItem("a100_next", String(n));

const lockBtn = document.getElementById("lockBtn");
const syncLockBtn = () => { lockBtn.textContent = isOwner() ? "🔓" : "🔒"; };

function closeOwnerMenu() {
  const m = document.getElementById("ownerMenu");
  if (m) m.remove();
  document.removeEventListener("click", ownerMenuOutside);
}
function ownerMenuOutside(e) {
  const m = document.getElementById("ownerMenu");
  if (m && !m.contains(e.target) && e.target !== lockBtn) closeOwnerMenu();
}

function openOwnerMenu() {
  closeOwnerMenu();
  const q = getQueued();
  const menu = document.createElement("div");
  menu.id = "ownerMenu";
  menu.innerHTML = `
    <div class="om-title">Owner tools</div>
    <div class="om-row">
      <input type="number" id="omNum" min="1" max="100" placeholder="1–100">
      <button class="secondary" id="omQueue">Set next roll</button>
    </div>
    ${q ? `<div class="om-note">Next roll: #${q} · ${esc(ALBUM_BY_NUM[q].title)} <button class="om-x" id="omClear">clear</button></div>`
        : `<div class="om-note om-muted">Next spin is random unless you set a number.</div>`}
    <button class="secondary om-full" id="omExport">⬇︎ Backup data</button>
    <button class="secondary om-full" id="omImport">⬆︎ Restore backup</button>
    <input type="file" id="omImportFile" accept=".json,application/json" hidden>
    <button class="secondary om-full" id="omLock">🔒 Lock owner mode</button>`;
  document.body.appendChild(menu);

  menu.querySelector("#omQueue").onclick = () => {
    const n = parseInt(menu.querySelector("#omNum").value, 10);
    if (!Number.isInteger(n) || n < 1 || n > 100) return alert("Enter a whole number between 1 and 100.");
    if (rolledSet().has(n)) {
      const a = ALBUM_BY_NUM[n];
      return alert(`#${n} (${a.artist} – ${a.title}) was already rolled — pick another.`);
    }
    setQueued(n);
    openOwnerMenu(); // refresh the menu to show it
    render();
  };
  const clearBtn = menu.querySelector("#omClear");
  if (clearBtn) clearBtn.onclick = () => { setQueued(null); openOwnerMenu(); render(); };
  menu.querySelector("#omExport").onclick = () => { closeOwnerMenu(); downloadBackup(); };
  const fileInput = menu.querySelector("#omImportFile");
  menu.querySelector("#omImport").onclick = () => fileInput.click();
  fileInput.onchange = () => {
    if (fileInput.files[0]) { closeOwnerMenu(); importBackup(fileInput.files[0]); }
    fileInput.value = "";
  };
  menu.querySelector("#omLock").onclick = () => {
    closeOwnerMenu();
    localStorage.removeItem("a100_owner");
    syncLockBtn();
    render();
  };

  setTimeout(() => document.addEventListener("click", ownerMenuOutside), 0);
}

if (lockEnabled) {
  lockBtn.hidden = false;
  syncLockBtn();
  lockBtn.onclick = () => {
    if (isOwner()) {
      openOwnerMenu();
    } else {
      const code = prompt("Enter owner code:");
      if (code === OWNER_CODE) localStorage.setItem("a100_owner", "1");
      else if (code !== null) alert("Wrong code");
      syncLockBtn();
      render();
    }
  };
} else {
  // No owner code configured: still show the menu (everyone is "owner").
  lockBtn.hidden = false;
  lockBtn.textContent = "⚙︎";
  lockBtn.onclick = openOwnerMenu;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

const esc = (s) => String(s ?? "").replace(/[&<>"']/g,
  c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

const rolledSet = () => new Set(state.rolls.map(r => r.num));
const pendingRoll = () => state.rolls.find(r => r.rating === null || r.rating === undefined) || null;
const latestRoll = () => state.rolls.length ? state.rolls[state.rolls.length - 1] : null;
const nextSeq = () => state.rolls.reduce((m, r) => Math.max(m, r.seq || 0), 0) + 1;
const isRated = (r) => r.rating !== null && r.rating !== undefined;

// 0 → red, 50 → yellow, 100 → green
const scoreColor = (rating) => `hsl(${Math.round(rating * 1.15)}, 75%, 62%)`;
const scoreHTML = (rating) =>
  `<span style="color:${scoreColor(rating)}">${rating}<span style="font-size:0.7em;opacity:0.7">/100</span></span>`;

function hashColors(album) {
  const h = (album.num * 47) % 360;
  return [`hsl(${h}, 55%, 34%)`, `hsl(${(h + 70) % 360}, 60%, 20%)`];
}

// Each album ships with two dominant cover colors precomputed in albums.js.
const albumColors = (album) => album.colors || hashColors(album);

function updateBackground() {
  const bg = document.getElementById("bg");
  const latest = latestRoll();
  const cols = latest ? albumColors(ALBUM_BY_NUM[latest.num]) : ["#472a68", "#14555a"];
  bg.style.background = `linear-gradient(160deg, ${cols[0]}, ${cols[1]} 60%, #0b0b0e)`;
}

function coverHTML(album, cls) {
  if (album.cover) {
    return `<img class="${cls}" src="${esc(album.cover)}" alt="${esc(album.title)} cover" loading="lazy">`;
  }
  const [c1, c2] = hashColors(album);
  return `<div class="${cls} ph" style="background:linear-gradient(135deg, ${c1}, ${c2})">
    <span class="ph-num">#${album.num}</span>
    <span class="ph-t">${esc(album.artist)}<br>${esc(album.title)}</span>
  </div>`;
}


// ── Actions ──────────────────────────────────────────────────────────────────

async function doRoll(forcedNum) {
  if (spinning || pendingRoll() || !isOwner()) return;
  const rolled = rolledSet();

  let num;
  if (forcedNum !== undefined) {
    num = forcedNum;
    if (!Number.isInteger(num) || num < 1 || num > 100) {
      flash = { kind: "error", text: "Enter a whole number between 1 and 100." };
      return render();
    }
    if (rolled.has(num)) {
      const a = ALBUM_BY_NUM[num];
      const r = state.rolls.find(x => x.num === num);
      flash = { kind: "error", text: `#${num} (${a.artist} – ${a.title}) was already rolled` +
        (isRated(r) ? ` and rated ${r.rating}/100.` : ".") };
      return render();
    }
  } else {
    const queued = getQueued();
    setQueued(null); // one-shot: consumed (or dropped, if stale) on this spin
    if (queued !== null && !rolled.has(queued)) {
      num = queued;
    } else {
      const pool = ALBUMS.filter(a => !rolled.has(a.num)).map(a => a.num);
      if (!pool.length) {
        flash = { kind: "ok", text: "All 100 albums are done. Incredible." };
        return render();
      }
      num = pool[Math.floor(Math.random() * pool.length)];
    }
  }

  // Rapid-fire cover shuffle that slows to a stop on the winner. A single
  // image element swapping between preloaded full-res covers — far cheaper to
  // render than the old sliding reel, with no downscaled images.
  spinning = true;
  render();
  const stage = document.getElementById("spinStage");
  if (stage) {
    const sleep = (ms) => new Promise(r => setTimeout(r, ms));
    const timeout = (ms) => new Promise(r => setTimeout(() => r(null), ms));
    const preload = (a) => new Promise(res => {
      const i = new Image();
      i.onload = () => res(a);
      i.onerror = () => res(null);
      i.src = a.cover;
    });
    const decoyPool = ALBUMS.filter(a => !rolled.has(a.num) && a.num !== num);
    const picks = [];
    while (picks.length < 10 && decoyPool.length) {
      picks.push(decoyPool.splice(Math.floor(Math.random() * decoyPool.length), 1)[0]);
    }
    const winner = ALBUM_BY_NUM[num];
    const winnerReady = preload(winner);
    // only shuffle covers that actually finished loading — nothing flashes blank
    const loaded = (await Promise.all(picks.map(a => Promise.race([preload(a), timeout(2200)]))))
      .filter(Boolean);
    stage.innerHTML = `<div class="flash-box" id="flashBox"><img id="flashImg" alt=""></div>`;
    const img = document.getElementById("flashImg");
    let delay = 90;
    while (delay < 480 && loaded.length) {
      img.src = loaded[Math.floor(Math.random() * loaded.length)].cover;
      await sleep(delay);
      delay *= 1.17;
    }
    await Promise.race([winnerReady, timeout(2500)]);
    img.src = winner.cover;
    document.getElementById("flashBox").classList.add("flash-final");
    await sleep(700);
  }
  spinning = false;

  await store.addRoll({ num, rating: null, comment: "", rolledAt: new Date().toISOString(), seq: nextSeq() });
  render();
}

async function saveRating() {
  const p = pendingRoll();
  if (!p || !isOwner()) return;
  const rating = parseInt(document.getElementById("rateNum").value, 10);
  if (!Number.isInteger(rating) || rating < 0 || rating > 100) {
    flash = { kind: "error", text: "Rating must be 0–100." };
    return render();
  }
  const comment = document.getElementById("rateComment").value.trim();
  await store.rateRoll(p.num, rating, comment);
  showRateForm = false;
  flash = { kind: "ok", text: "Saved. See you tomorrow 🎧" };
  render();
}

async function importSeeds() {
  for (let i = 0; i < SEED_ROLLS.length; i++) {
    await store.addRoll({ ...SEED_ROLLS[i], comment: "", rolledAt: null, seq: i + 1 });
  }
  flash = { kind: "ok", text: "Imported your first 7 albums." };
  render();
}

function downloadBackup() {
  const data = { exportedAt: new Date().toISOString(), rolls: state.rolls, reviews: state.reviews };
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `100-albums-backup-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(a.href);
  flash = { kind: "ok", text: "Backup downloaded — keep it somewhere safe." };
  render();
}

async function importBackup(file) {
  try {
    const data = JSON.parse(await file.text());
    if (!Array.isArray(data.rolls) || !Array.isArray(data.reviews)) throw new Error("wrong shape");
    if (!confirm(`Restore ${data.rolls.length} rolls and ${data.reviews.length} reviews from this backup?`)) return;
    await store.importData(data);
    flash = { kind: "ok", text: "Backup restored." };
  } catch {
    flash = { kind: "error", text: "That file doesn't look like a valid backup." };
  }
  render();
}

async function submitReview() {
  const latest = latestRoll();
  if (!latest) return;
  const name = document.getElementById("revName").value.trim();
  const rating = parseInt(document.getElementById("revNum").value, 10);
  if (!name) {
    flash = { kind: "error", text: "Add your name so we know whose opinion it is!" };
    return render();
  }
  if (!Number.isInteger(rating) || rating < 0 || rating > 100) {
    flash = { kind: "error", text: "Rating must be 0–100." };
    return render();
  }
  const comment = document.getElementById("revComment").value.trim();
  await store.addReview({ num: latest.num, name, rating, comment, createdAt: new Date().toISOString() });
  flash = { kind: "ok", text: "Thoughts recorded 📝" };
  render();
}

// ── Rendering ────────────────────────────────────────────────────────────────

const view = document.getElementById("view");

function flashHTML() {
  if (!flash) return "";
  const f = flash;
  flash = null;
  return `<p class="${f.kind}">${esc(f.text)}</p>`;
}

function ratingInputs(rangeId, numId, value = null) {
  const has = value !== null && value !== undefined;
  return `<div class="rate-row">
    <input type="range" id="${rangeId}" min="0" max="100" value="${has ? value : 50}" class="${has ? "" : "unset"}">
    <input type="number" id="${numId}" min="0" max="100" placeholder="?" ${has ? `value="${value}"` : ""}>
  </div>`;
}

function renderToday() {
  const owner = isOwner();
  const p = pendingRoll();
  const latest = latestRoll();
  const rolled = rolledSet();
  let html = "";

  if (spinning) {
    return `<div class="card spin-stage">
      <h2>Rolling…</h2>
      <div id="spinStage"></div>
    </div>`;
  }

  if (p) {
    // An album is rolled and waiting for the official rating.
    const a = ALBUM_BY_NUM[p.num];
    const rateUI = !owner
      ? `<div class="listening">listening…</div>
         <p class="hint">Official rating still cooking — add your own take below.</p>`
      : showRateForm ? `
      <div class="rate-form">
        ${ratingInputs("rateRange", "rateNum")}
        <textarea id="rateComment" placeholder="Your thoughts on the album…"></textarea>
        <button class="primary" id="saveRatingBtn">Save rating</button>
      </div>` : `
      <div class="listening">listening…</div>
      <button class="primary" id="rateNowBtn">Rate this album</button>`;
    const glow = albumColors(a)[0];
    html += `<div class="card">
      <h2>Today's album</h2>
      <div class="reveal" style="--glow:${glow}55">
        ${coverHTML(a, "cover-lg")}
        <div class="album-name">
          <div class="n">#${a.num}</div>
          <div class="t">${esc(a.title)}</div>
          <div class="a">${esc(a.artist)}</div>
        </div>
        ${rateUI}
      </div>
      ${flashHTML()}
    </div>`;
  } else if (rolled.size === 100) {
    // The chart is complete — replace the spin card with the finale.
    const top3 = state.rolls.filter(isRated).sort((a, b) => b.rating - a.rating || a.seq - b.seq).slice(0, 3);
    html += `<div class="card" style="text-align:center">
      <h2>🏆 All 100 albums, done.</h2>
      <p class="hint" style="margin-bottom:14px">The chart is complete. The final podium:</p>
      <div class="list" style="text-align:left">${top3.map((r, i) => entryHTML(r, { rank: i + 1 })).join("")}</div>
      ${flashHTML()}
    </div>`;
  } else if (owner) {
    const remaining = 100 - rolled.size;
    html += `<div class="card spin-stage">
      <h2>Roll today's album</h2>
      <button class="primary big-spin" id="spinBtn" ${remaining ? "" : "disabled"}>🎲 Spin (${remaining} left)</button>
      ${(() => { const q = getQueued(); return q && !rolled.has(q)
        ? `<p class="hint">Next roll is set to #${q} · ${esc(ALBUM_BY_NUM[q].title)}</p>` : ""; })()}
      ${state.rolls.length === 0 ? `<button class="secondary" id="seedBtn" style="margin-top:12px">Import my first 7 albums</button>` : ""}
      ${flashHTML()}
    </div>`;
  }

  // Most recent finished album (shown when nothing is pending).
  if (!p && latest) {
    const a = ALBUM_BY_NUM[latest.num];
    html += `<div class="card">
      <h2>Latest album</h2>
      <div class="now">
        ${coverHTML(a, "thumb")}
        <div class="info">
          <div class="t">#${a.num} · ${esc(a.title)}</div>
          <div class="a">${esc(a.artist)}</div>
        </div>
        <div class="score">${isRated(latest) ? scoreHTML(latest.rating) : ""}</div>
      </div>
      ${!owner ? flashHTML() : ""}
    </div>`;
  }

  // Everyone can add their take on the current album.
  if (latest) {
    const a = ALBUM_BY_NUM[latest.num];
    html += `<div class="card">
      <h2>What did YOU think of ${esc(a.title)}?</h2>
      <div class="rate-form" style="max-width:none">
        <input type="text" id="revName" placeholder="Your name">
        ${ratingInputs("revRange", "revNum")}
        <textarea id="revComment" placeholder="Your thoughts… (optional)"></textarea>
        <button class="primary" id="revBtn">Submit review</button>
      </div>
      ${flashHTML()}
    </div>`;
  }

  if (!html) {
    html = `<div class="card"><h2>Nothing rolled yet</h2>
      <p class="hint">The owner hasn't spun the first album yet. Check back soon!</p></div>`;
  }
  return html;
}

function renderPast() {
  const sub = { history: renderHistory, leaderboard: renderLeaderboard, chart: renderChart, stats: renderStats }[pastTab];
  return `
    <div class="subtabs">
      ${["history", "leaderboard", "chart", "stats"].map(t =>
        `<button class="subtab ${t === pastTab ? "active" : ""}" data-subtab="${t}">
          ${{ history: "History", leaderboard: "Leaderboard", chart: "The Chart", stats: "Stats" }[t]}
        </button>`).join("")}
    </div>
    ${sub()}
    ${flashHTML()}`;
}

function renderStats() {
  const done = state.rolls.filter(isRated);
  if (!done.length) return `<div class="card"><p class="hint">No finished albums yet.</p></div>`;
  const avg = done.reduce((s, r) => s + r.rating, 0) / done.length;
  const best = [...done].sort((a, b) => b.rating - a.rating || a.seq - b.seq)[0];
  const worst = [...done].sort((a, b) => a.rating - b.rating || a.seq - b.seq)[0];
  const counts = {};
  state.reviews.forEach(rv => { counts[rv.name] = (counts[rv.name] || 0) + 1; });
  const top = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
  return `
    <div class="stats-grid">
      <div class="stat"><div class="sv">${done.length}<span style="font-size:0.6em;opacity:0.7">/100</span></div><div class="sl">albums finished</div></div>
      <div class="stat"><div class="sv" style="color:${scoreColor(avg)}">${avg.toFixed(1)}</div><div class="sl">average score</div></div>
      <div class="stat"><div class="sv">${state.reviews.length}</div><div class="sl">friend reviews</div></div>
      <div class="stat"><div class="sv sv-text">${top ? esc(top[0]) : "—"}</div><div class="sl">top reviewer${top ? ` (${top[1]})` : ""}</div></div>
    </div>
    <div class="stats-h">Highest rated</div>
    <div class="list">${entryHTML(best)}</div>
    <div class="stats-h">Lowest rated</div>
    <div class="list">${entryHTML(worst)}</div>`;
}

function entryHTML(r, { rank } = {}) {
  const a = ALBUM_BY_NUM[r.num];
  return `<div class="entry ${rank !== undefined && rank <= 3 ? "podium-" + rank : ""}" data-num="${a.num}" title="Tap for details & everyone's reviews">
    ${rank !== undefined ? `<div class="rank ${rank <= 3 ? "top" : ""}">${rank <= 3 ? ["🥇", "🥈", "🥉"][rank - 1] : rank}</div>` : ""}
    ${coverHTML(a, "thumb")}
    <div class="info">
      <div class="t">${esc(a.title)}</div>
      <div class="a">${esc(a.artist)}</div>
      ${r.comment ? `<div class="c">“${esc(r.comment)}”</div>` : ""}
      ${rank === undefined ? `<div class="d">Day ${r.seq}</div>` : ""}
    </div>
    <div class="score ${isRated(r) ? "" : "unrated"}">${isRated(r) ? scoreHTML(r.rating) : "listening…"}</div>
  </div>`;
}

function renderHistory() {
  if (!state.rolls.length) return `<div class="card"><p class="hint">Nothing rolled yet.</p></div>`;
  const items = [...state.rolls].sort((a, b) => b.seq - a.seq);
  return `<div class="list">${items.map(r => entryHTML(r)).join("")}</div>`;
}

function renderLeaderboard() {
  const rated = state.rolls.filter(isRated).sort((a, b) => b.rating - a.rating || a.seq - b.seq);
  if (!rated.length) return `<div class="card"><p class="hint">No ratings yet.</p></div>`;
  return `<div class="list">${rated.map((r, i) => entryHTML(r, { rank: i + 1 })).join("")}</div>
    <div class="share-row"><button class="secondary" id="shareBoardBtn">📤 Share leaderboard</button></div>`;
}

async function shareLeaderboard() {
  const rated = state.rolls.filter(isRated).sort((a, b) => b.rating - a.rating || a.seq - b.seq);
  const medal = (i) => i === 0 ? "🥇" : i === 1 ? "🥈" : i === 2 ? "🥉" : `${i + 1}.`;
  const lines = rated.map((r, i) => {
    const a = ALBUM_BY_NUM[r.num];
    return `${medal(i)} ${a.title} — ${a.artist}: ${r.rating}/100`;
  });
  const text = `🎧 100 Albums leaderboard (${rated.length}/100 done)\n${lines.join("\n")}`;
  const url = location.origin + location.pathname;
  const btn = document.getElementById("shareBoardBtn");
  try {
    if (navigator.share) {
      await navigator.share({ text: `${text}\n${url}` });
    } else {
      await navigator.clipboard.writeText(`${text}\n${url}`);
      if (btn) {
        btn.textContent = "Copied!";
        setTimeout(() => { btn.textContent = "📤 Share leaderboard"; }, 1500);
      }
    }
  } catch { /* user closed the share sheet */ }
}

function renderChart() {
  const byNum = Object.fromEntries(state.rolls.map(r => [r.num, r]));
  return `<div class="chart-grid">
    ${ALBUMS.map(a => {
      const r = byNum[a.num];
      return `<div class="chart-cell ${r ? "rolled" : ""}" data-num="${a.num}" title="${esc(`${a.num}. ${a.artist} – ${a.title}`)}">
        ${coverHTML(a, "cover-sm")}
        ${r && isRated(r) ? `<span class="badge" style="background:${scoreColor(r.rating)}">${r.rating}</span>`
          : r ? `<span class="badge">🎧</span>` : ""}
      </div>`;
    }).join("")}
  </div>`;
}

// ── Album popup (opened by tapping a chart tile or a history/leaderboard row) ─
// Deliberately bare-bones markup: the classes below (.modal-*) are hooks for
// styling once the design is ready.

function closeAlbumModal() {
  const m = document.getElementById("albumModal");
  if (m) m.remove();
  document.removeEventListener("keydown", escToClose);
}

function escToClose(e) { if (e.key === "Escape") closeAlbumModal(); }

function openAlbumModal(num) {
  closeAlbumModal();
  const a = ALBUM_BY_NUM[num];
  const roll = state.rolls.find(r => r.num === num);
  const reviews = state.reviews
    .filter(rv => rv.num === num)
    .sort((x, y) => (x.createdAt || "").localeCompare(y.createdAt || ""));
  const owner = isOwner();

  const overlay = document.createElement("div");
  overlay.id = "albumModal";
  overlay.className = "modal-backdrop";
  overlay.innerHTML = `
    <div class="modal">
      <button class="modal-close" aria-label="Close">✕</button>
      ${coverHTML(a, "modal-cover")}
      <div class="modal-title">${esc(a.title)}</div>
      <div class="modal-artist">${esc(a.artist)}</div>
      ${roll ? `<div class="modal-day">Day ${roll.seq}</div>` : ""}
      ${roll && isRated(roll) ? `
        <div class="modal-score">${scoreHTML(roll.rating)}</div>
        ${roll.comment ? `<div class="modal-comment">“${esc(roll.comment)}”</div>` : ""}
        ${owner ? `<button class="secondary modal-edit" id="modalEditBtn">✎ Edit rating</button>
        <div class="rate-form modal-edit-form" id="modalEditForm" hidden>
          ${ratingInputs("mRange", "mNum", roll.rating)}
          <textarea id="mComment" placeholder="Your thoughts on the album…">${esc(roll.comment || "")}</textarea>
          <button class="primary" id="mSave">Save changes</button>
        </div>` : ""}
        <button class="secondary modal-edit" id="modalShareBtn">📤 Share</button>`
        : roll ? `<div class="modal-score modal-pending">currently listening…</div>`
        : `<div class="modal-score modal-unrolled">not rolled yet</div>`}
      ${reviews.length ? `<div class="modal-avg">friends' average: ${scoreHTML(Math.round(reviews.reduce((s, rv) => s + rv.rating, 0) / reviews.length))} across ${reviews.length} review${reviews.length > 1 ? "s" : ""}</div>` : ""}
      <div class="modal-reviews">
        ${reviews.length ? reviews.map(rv => `<div class="review">
            <span class="who">${esc(rv.name)}</span>
            <span class="what">${esc(rv.comment || "")}</span>
            <span class="sc">${scoreHTML(rv.rating)}</span>
            ${owner ? `<button class="rev-del" data-id="${esc(rv.id)}" data-who="${esc(rv.name)}" title="Delete this review">✕</button>` : ""}
          </div>`).join("")
        : `<p class="hint">No reviews for this one yet.</p>`}
      </div>
    </div>`;
  overlay.onclick = (e) => { if (e.target === overlay) closeAlbumModal(); };
  overlay.querySelector(".modal-close").onclick = closeAlbumModal;

  const editBtn = overlay.querySelector("#modalEditBtn");
  if (editBtn) {
    const form = overlay.querySelector("#modalEditForm");
    editBtn.onclick = () => { form.hidden = !form.hidden; };
    const range = overlay.querySelector("#mRange");
    const numIn = overlay.querySelector("#mNum");
    range.oninput = () => { numIn.value = range.value; };
    numIn.oninput = () => { range.value = Math.max(0, Math.min(100, +numIn.value || 0)); };
    overlay.querySelector("#mSave").onclick = async () => {
      const rating = parseInt(numIn.value, 10);
      if (!Number.isInteger(rating) || rating < 0 || rating > 100) return alert("Rating must be 0–100.");
      await store.rateRoll(num, rating, overlay.querySelector("#mComment").value.trim());
      setTimeout(() => openAlbumModal(num), 150);
    };
  }
  overlay.querySelectorAll(".rev-del").forEach(b => b.onclick = async () => {
    if (!confirm(`Delete ${b.dataset.who}'s review?`)) return;
    await store.removeReview(b.dataset.id);
    setTimeout(() => openAlbumModal(num), 150);
  });

  const shareBtn = overlay.querySelector("#modalShareBtn");
  if (shareBtn) shareBtn.onclick = async () => {
    const text = `Day ${roll.seq} · ${a.title} — ${a.artist}: ${roll.rating}/100 🎧`;
    const url = location.origin + location.pathname;
    try {
      if (navigator.share) {
        await navigator.share({ text, url });
      } else {
        await navigator.clipboard.writeText(`${text}\n${url}`);
        shareBtn.textContent = "Copied!";
        setTimeout(() => { shareBtn.textContent = "📤 Share"; }, 1500);
      }
    } catch { /* user closed the share sheet */ }
  };

  document.body.appendChild(overlay);
  document.addEventListener("keydown", escToClose);
}

function render() {
  document.querySelectorAll(".tab").forEach(b => b.classList.toggle("active", b.dataset.tab === tab));
  document.body.classList.toggle("dim", tab !== "today");
  const rated = state.rolls.filter(isRated).length;
  document.getElementById("progress").textContent = `${rated}/100 listened`;
  document.querySelector("#pbar > div").style.width = `${rated}%`;

  view.innerHTML = !state.ready
    ? `<div class="card"><p class="hint">Loading…</p></div>`
    : { today: renderToday, past: renderPast }[tab]();

  wire();
  updateBackground();
}

function wire() {
  const on = (id, fn) => { const el = document.getElementById(id); if (el) el.onclick = fn; };
  on("spinBtn", () => doRoll());
  on("seedBtn", importSeeds);
  on("rateNowBtn", () => { showRateForm = true; render(); });
  on("saveRatingBtn", saveRating);
  on("shareBoardBtn", shareLeaderboard);
  on("revBtn", submitReview);
  document.querySelectorAll(".subtab").forEach(b => b.onclick = () => { pastTab = b.dataset.subtab; render(); });
  document.querySelectorAll(".chart-cell").forEach(c => c.onclick = () => openAlbumModal(+c.dataset.num));
  document.querySelectorAll(".entry[data-num]").forEach(e => e.onclick = () => openAlbumModal(+e.dataset.num));

  const syncPair = (rangeId, numId) => {
    const range = document.getElementById(rangeId);
    const numIn = document.getElementById(numId);
    if (range && numIn) {
      range.oninput = () => { numIn.value = range.value; range.classList.remove("unset"); };
      numIn.oninput = () => {
        range.value = Math.max(0, Math.min(100, +numIn.value || 0));
        range.classList.remove("unset");
      };
    }
  };
  syncPair("rateRange", "rateNum");
  syncPair("revRange", "revNum");

}

document.querySelectorAll(".tab").forEach(b => b.onclick = () => { tab = b.dataset.tab; render(); });

document.getElementById("modeNote").textContent = usingFirebase
  ? "synced via Firebase"
  : "local test mode — data is saved only in this browser (set up Firebase to sync, see README)";

await store.init(() => { state.ready = true; render(); });
render();
