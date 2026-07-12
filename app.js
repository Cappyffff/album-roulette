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

const lockBtn = document.getElementById("lockBtn");
if (lockEnabled) {
  lockBtn.hidden = false;
  const syncLockBtn = () => { lockBtn.textContent = isOwner() ? "🔓" : "🔒"; };
  syncLockBtn();
  lockBtn.onclick = () => {
    if (isOwner()) {
      localStorage.removeItem("a100_owner");
    } else {
      const code = prompt("Enter owner code:");
      if (code === OWNER_CODE) localStorage.setItem("a100_owner", "1");
      else if (code !== null) alert("Wrong code");
    }
    syncLockBtn();
    render();
  };
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
    const pool = ALBUMS.filter(a => !rolled.has(a.num)).map(a => a.num);
    if (!pool.length) {
      flash = { kind: "ok", text: "All 100 albums are done. Incredible." };
      return render();
    }
    num = pool[Math.floor(Math.random() * pool.length)];
  }

  // Slot-machine reel of covers that eases to a stop on the winner.
  spinning = true;
  render();
  const stage = document.getElementById("spinStage");
  if (stage) {
    const decoys = ALBUMS.filter(a => !rolled.has(a.num) && a.num !== num);
    const picks = [];
    for (let i = 0; i < 11; i++) {
      picks.push(decoys.length ? decoys[Math.floor(Math.random() * decoys.length)] : ALBUM_BY_NUM[num]);
    }
    picks.push(ALBUM_BY_NUM[num]); // reel always lands on the rolled album
    stage.innerHTML = `<div class="reel"><div class="reel-strip" id="reelStrip">
      ${picks.map(a => coverHTML(a, "reel-cover")).join("")}
    </div></div>`;
    // wait for covers (or 1.8s, whichever comes first) so the reel isn't blank
    await Promise.race([
      Promise.all([...stage.querySelectorAll("img")].map(i =>
        i.complete ? 1 : new Promise(r => { i.onload = i.onerror = r; }))),
      new Promise(r => setTimeout(r, 1800)),
    ]);
    const strip = document.getElementById("reelStrip");
    const reelH = strip.parentElement.clientHeight;
    strip.getBoundingClientRect(); // flush layout so the transition animates
    strip.style.transform = `translateY(-${(picks.length - 1) * reelH}px)`;
    await new Promise(r => {
      strip.addEventListener("transitionend", r, { once: true });
      setTimeout(r, 3200); // safety net if the event never fires
    });
    await new Promise(r => setTimeout(r, 350)); // a beat before the reveal
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

function ratingInputs(rangeId, numId, value = 75) {
  return `<div class="rate-row">
    <input type="range" id="${rangeId}" min="0" max="100" value="${value}">
    <input type="number" id="${numId}" min="0" max="100" value="${value}">
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
    const rateUI = owner ? `
      <div class="rate-form">
        ${ratingInputs("rateRange", "rateNum")}
        <textarea id="rateComment" placeholder="Your thoughts on the album…"></textarea>
        <button class="primary" id="saveRatingBtn">Save rating</button>
      </div>` : `<p class="hint">Official rating still cooking — add your own take below.</p>`;
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
  } else if (owner) {
    const remaining = 100 - rolled.size;
    html += `<div class="card spin-stage">
      <h2>Roll today's album</h2>
      <button class="primary big-spin" id="spinBtn" ${remaining ? "" : "disabled"}>🎲 Spin (${remaining} left)</button>
      <div class="row" style="justify-content:center">
        <input type="number" id="manualNum" min="1" max="100" placeholder="1–100" style="width:90px">
        <button class="secondary" id="manualBtn">Roll this number</button>
      </div>
      <p class="hint">Manual entry is for when someone gives you a number.</p>
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
  const sub = { history: renderHistory, leaderboard: renderLeaderboard, chart: renderChart }[pastTab];
  return `
    <div class="subtabs">
      ${["history", "leaderboard", "chart"].map(t =>
        `<button class="subtab ${t === pastTab ? "active" : ""}" data-subtab="${t}">
          ${{ history: "History", leaderboard: "Leaderboard", chart: "The Chart" }[t]}
        </button>`).join("")}
    </div>
    ${sub()}`;
}

function entryHTML(r, { rank } = {}) {
  const a = ALBUM_BY_NUM[r.num];
  return `<div class="entry ${rank !== undefined && rank <= 3 ? "podium-" + rank : ""}">
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
  return `<div class="list">${rated.map((r, i) => entryHTML(r, { rank: i + 1 })).join("")}</div>`;
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

function renderThoughts() {
  if (!state.reviews.length) {
    return `<div class="card"><h2>Thoughts</h2>
      <p class="hint">No reviews yet — be the first! Add yours from the Today tab.</p></div>`;
  }
  const byNum = {};
  state.reviews.forEach(rv => (byNum[rv.num] ||= []).push(rv));
  const rollsDesc = [...state.rolls].sort((a, b) => b.seq - a.seq).filter(r => byNum[r.num]);
  return rollsDesc.map(r => {
    const a = ALBUM_BY_NUM[r.num];
    const reviews = byNum[r.num].sort((x, y) => (x.createdAt || "").localeCompare(y.createdAt || ""));
    return `<div class="album-section">
      <div class="head">
        ${coverHTML(a, "thumb")}
        <div style="flex:1;min-width:0">
          <div class="t">#${a.num} · ${esc(a.title)}</div>
          <div class="a">${esc(a.artist)}</div>
        </div>
        ${isRated(r) ? `<div class="score" style="font-weight:900">${scoreHTML(r.rating)}</div>` : ""}
      </div>
      ${reviews.map(rv => `<div class="review">
        <span class="who">${esc(rv.name)}</span>
        <span class="what">${esc(rv.comment || "")}</span>
        <span class="sc">${scoreHTML(rv.rating)}</span>
      </div>`).join("")}
    </div>`;
  }).join("");
}

// ── Album popup (opened by tapping a chart tile) ─────────────────────────────
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
        ${roll.comment ? `<div class="modal-comment">“${esc(roll.comment)}”</div>` : ""}`
        : roll ? `<div class="modal-score modal-pending">currently listening…</div>`
        : `<div class="modal-score modal-unrolled">not rolled yet</div>`}
      <div class="modal-reviews">
        ${reviews.length ? reviews.map(rv => `<div class="review">
            <span class="who">${esc(rv.name)}</span>
            <span class="what">${esc(rv.comment || "")}</span>
            <span class="sc">${scoreHTML(rv.rating)}</span>
          </div>`).join("")
        : `<p class="hint">No reviews for this one yet.</p>`}
      </div>
    </div>`;
  overlay.onclick = (e) => { if (e.target === overlay) closeAlbumModal(); };
  overlay.querySelector(".modal-close").onclick = closeAlbumModal;
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
    : { today: renderToday, past: renderPast, thoughts: renderThoughts }[tab]();

  wire();
  updateBackground();
}

function wire() {
  const on = (id, fn) => { const el = document.getElementById(id); if (el) el.onclick = fn; };
  on("spinBtn", () => doRoll());
  on("manualBtn", () => doRoll(parseInt(document.getElementById("manualNum").value, 10)));
  on("seedBtn", importSeeds);
  on("saveRatingBtn", saveRating);
  on("revBtn", submitReview);
  document.querySelectorAll(".subtab").forEach(b => b.onclick = () => { pastTab = b.dataset.subtab; render(); });
  document.querySelectorAll(".chart-cell").forEach(c => c.onclick = () => openAlbumModal(+c.dataset.num));

  const syncPair = (rangeId, numId) => {
    const range = document.getElementById(rangeId);
    const numIn = document.getElementById(numId);
    if (range && numIn) {
      range.oninput = () => { numIn.value = range.value; };
      numIn.oninput = () => { range.value = Math.max(0, Math.min(100, +numIn.value || 0)); };
    }
  };
  syncPair("rateRange", "rateNum");
  syncPair("revRange", "revNum");

  const manual = document.getElementById("manualNum");
  if (manual) manual.onkeydown = (e) => { if (e.key === "Enter") document.getElementById("manualBtn").click(); };
}

document.querySelectorAll(".tab").forEach(b => b.onclick = () => { tab = b.dataset.tab; render(); });

document.getElementById("modeNote").textContent = usingFirebase
  ? "synced via Firebase"
  : "local test mode — data is saved only in this browser (set up Firebase to sync, see README)";

await store.init(() => { state.ready = true; render(); });
render();
