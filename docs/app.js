(() => {
  const $ = (id) => document.getElementById(id);

  const CONFIG = window.APP_CONFIG || {};
  const DATA_URL = CONFIG.DATA_URL || "data.json";

  const state = {
    data: null,
    topic: null,
    currentVideoId: null,
    watchTimer: null,
    openedAt: null
  };

  // ---------- Safe storage ----------
  function safeJsonParse(s, fallback) {
    try {
      if (s === null || s === undefined || s === "") return fallback;
      const v = JSON.parse(s);
      return (v === null || v === undefined) ? fallback : v;
    } catch (e) {
      return fallback;
    }
  }

  function storageGet(key) {
    try { return localStorage.getItem(key); } catch (e) { return null; }
  }
  function storageSet(key, value) {
    try { localStorage.setItem(key, value); return true; } catch (e) { return false; }
  }

  function loadProgress() {
    return safeJsonParse(storageGet("videoProgress"), { watched: [], lastByTopic: {} });
  }
  function saveProgress(p) {
    storageSet("videoProgress", JSON.stringify(p));
  }

  function markWatched(videoId) {
    const p = loadProgress();
    const w = new Set(Array.isArray(p.watched) ? p.watched : []);
    if (!w.has(videoId)) {
      w.add(videoId);
      p.watched = Array.from(w);
      saveProgress(p);
    }
  }

  // ---------- LIFF param helper ----------
  function parseParam(name) {
    const u = new URL(window.location.href);

    const direct = u.searchParams.get(name);
    if (direct) return direct;

    const liffStateEnc = u.searchParams.get("liff.state");
    if (!liffStateEnc) return null;

    let decoded = liffStateEnc;
    try { decoded = decodeURIComponent(liffStateEnc); } catch (e) {}

    const qIndex = decoded.indexOf("?");
    const qs = (qIndex >= 0) ? decoded.slice(qIndex + 1) : decoded;
    const qsNoFrag = qs.split("#")[0];

    return new URLSearchParams(qsNoFrag).get(name);
  }

  function updateUrlParams(params) {
    const u = new URL(window.location.href);
    Object.keys(params).forEach((k) => {
      const v = params[k];
      if (v === null || v === undefined || v === "") u.searchParams.delete(k);
      else u.searchParams.set(k, String(v));
    });
    history.replaceState({}, "", u.toString());
  }

  // ---------- Data helpers ----------
  function getCategories() {
    return (state.data && Array.isArray(state.data.categories)) ? state.data.categories : [];
  }
  function getAllVideos() {
    return (state.data && Array.isArray(state.data.videos)) ? state.data.videos : [];
  }
  function getTopicVideos(topicKey) {
    return getAllVideos()
      .filter((v) => v.category === topicKey)
      .sort((a, b) => (a.order || 999) - (b.order || 999));
  }

  // ---------- Theming ----------
  const THEMES = {
    preop:  { accent: "#F97316", accentSoft: "rgba(249,115,22,.18)", accentGlow: "rgba(249,115,22,.26)" },
    postop: { accent: "#3B82F6", accentSoft: "rgba(59,130,246,.18)", accentGlow: "rgba(59,130,246,.26)" },
    home:   { accent: "#06C755", accentSoft: "rgba(6,199,85,.18)",  accentGlow: "rgba(6,199,85,.26)" }
  };

  function applyTheme(topicKey) {
    const t = THEMES[topicKey] || THEMES.home;
    const root = document.documentElement;
    root.style.setProperty("--accent", t.accent);
    root.style.setProperty("--accentSoft", t.accentSoft);
    root.style.setProperty("--accentGlow", t.accentGlow);

    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute("content", t.accent);
  }

  // ---------- Drive URLs ----------
  function drivePreview(driveId) {
    return "https://drive.google.com/file/d/" + encodeURIComponent(driveId) + "/preview";
  }
  function drivePreviewFull(driveId) {
    return drivePreview(driveId);
  }

  // ---------- UI helpers ----------
  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }

  // Remove "คลิปที่ 5.2 " prefix (user request)
  function cleanTitle(title) {
    const t = String(title || "");
    return t.replace(/^\s*คลิปที่\s*\d+(?:\.\d+)?\s*/i, "").trim();
  }

  function setStatus(text) {
    const box = $("statusBox");
    if (!box) return;
    if (!text) {
      box.classList.add("hidden");
      box.textContent = "";
      return;
    }
    box.classList.remove("hidden");
    box.textContent = text;
  }

  function calcProgress(topicKey) {
    const vids = getTopicVideos(topicKey);
    const total = vids.length;

    const p = loadProgress();
    const watchedSet = new Set(Array.isArray(p.watched) ? p.watched : []);
    const watched = vids.filter(v => watchedSet.has(v.id)).length;

    const percent = total ? Math.round((watched / total) * 100) : 0;
    const mustTotal = vids.filter(v => v.mustWatch).length;
    const mustWatched = vids.filter(v => v.mustWatch && watchedSet.has(v.id)).length;

    return { total, watched, percent, mustTotal, mustWatched, watchedSet };
  }

  function pickStartVideo(topicVideos) {
    if (!topicVideos || topicVideos.length === 0) return null;

    const byBadge = topicVideos.find(v => String(v.badge || "").includes("เริ่มที่นี่"));
    if (byBadge) return byBadge;

    const byMust = topicVideos.find(v => v.mustWatch);
    if (byMust) return byMust;

    return topicVideos[0];
  }

  // ---------- Render ----------
  function renderHero() {
    const cats = getCategories();
    const topicObj = cats.find(x => x.key === state.topic) || cats[0] || null;

    const topicPill = $("topicPill");
    if (topicPill) {
      const emoji = topicObj?.emoji ? topicObj.emoji + " " : "";
      topicPill.textContent = emoji + (topicObj?.label || state.topic || "หัวข้อ");
    }

    const heroBgIcon = $("heroBgIcon");
    if (heroBgIcon) heroBgIcon.textContent = topicObj?.emoji || "🎬";

    const subtitle = $("subtitle");
    if (subtitle) subtitle.textContent = "หัวข้อ: " + (topicObj?.label || state.topic || "");

    const topicHint = $("topicHint");
    if (topicHint) topicHint.textContent = ""; // keep clean (user request)

    const info = calcProgress(state.topic);

    // ring
    const ring = $("progressRing");
    const ringValue = $("ringValue");
    const deg = Math.round((info.percent / 100) * 360);
    if (ring) ring.style.background = `conic-gradient(var(--accent) 0deg ${deg}deg, var(--ringTrack) ${deg}deg 360deg)`;
    if (ringValue) ringValue.textContent = info.percent + "%";

    // progress text
    const progressText = $("progressText");
    const remain = Math.max(0, info.total - info.watched);
    if (progressText) progressText.textContent = `ดูแล้ว ${info.watched}/${info.total} (เหลือ ${remain})`;

    // pills
    $("pillWatchedVal") && ($("pillWatchedVal").textContent = String(info.watched));
    $("pillRemainVal") && ($("pillRemainVal").textContent = String(remain));
    $("pillMustVal") && ($("pillMustVal").textContent = info.mustTotal ? `${info.mustWatched}/${info.mustTotal}` : "—");

    // bar
    const bar = $("progressBar");
    const fill = $("progressFill");
    if (bar) bar.setAttribute("aria-valuenow", String(info.percent));
    if (fill) fill.style.width = info.percent + "%";

    // actions
    const videos = getTopicVideos(state.topic);
    const p = loadProgress();
    const lastId = (p.lastByTopic && state.topic) ? p.lastByTopic[state.topic] : null;

    const startVideo = pickStartVideo(videos);

    const btnStart = $("btnStart");
    const btnContinue = $("btnContinue");

    if (btnStart) {
      btnStart.disabled = !startVideo;
      btnStart.onclick = () => { if (startVideo) openVideo(startVideo.id); };
    }
    if (btnContinue) {
      btnContinue.disabled = !lastId && !startVideo;
      btnContinue.onclick = () => {
        if (lastId) openVideo(lastId);
        else if (startVideo) openVideo(startVideo.id);
        else setStatus("ยังไม่มีคลิปในหัวข้อนี้");
      };
    }
  }

  function renderList() {
    const p = loadProgress();
    const watchedSet = new Set(Array.isArray(p.watched) ? p.watched : []);

    const videos = getTopicVideos(state.topic);

    const count = $("countLabel");
    if (count) count.textContent = videos.length + " คลิป";

    const list = $("videoList");
    if (!list) return;

    list.innerHTML = "";

    if (videos.length === 0) {
      setStatus("ยังไม่มีคลิปในหัวข้อนี้");
      return;
    }
    setStatus("");

    videos.forEach((v, idx) => {
      const watched = watchedSet.has(v.id);

      const card = document.createElement("div");
      card.className = "card" + (watched ? " is-watched" : "");
      card.setAttribute("data-open", v.id);

      const title = cleanTitle(v.title);

      card.innerHTML = `
        <div class="step">${idx + 1}</div>
        <div class="cardBody">
          <div class="cardTitle">${escapeHtml(title)}</div>
          ${v.note ? `<div class="cardNote">${escapeHtml(v.note)}</div>` : ""}
          <div class="playBtn" role="button" aria-label="ดูคลิป">
            <span class="tri">▶</span>
            <span>ดูคลิป</span>
          </div>
        </div>
      `;

      card.onclick = () => openVideo(v.id);
      list.appendChild(card);
    });
  }

  function renderAll() {
    renderHero();
    renderList();
  }

  // ---------- Video modal ----------
  function setWatermark(text) {
    const wm = $("watermark");
    if (!wm) return;
    wm.setAttribute("data-text", text || "CONFIDENTIAL • ห้ามส่งต่อ");
  }

  function clearWatchTimer() {
    if (state.watchTimer) {
      clearTimeout(state.watchTimer);
      state.watchTimer = null;
    }
    state.openedAt = null;
  }

  function startAutoWatchMark(videoId) {
    clearWatchTimer();
    state.openedAt = Date.now();

    // Auto-mark watched after user stays in video for 10 seconds.
    state.watchTimer = setTimeout(() => {
      markWatched(videoId);
      renderAll();
    }, 10000);
  }

  function openVideo(videoId) {
    const vids = getTopicVideos(state.topic);
    const v = vids.find(x => x.id === videoId) || getAllVideos().find(x => x.id === videoId);
    if (!v) return;

    state.currentVideoId = v.id;

    // save last
    const p = loadProgress();
    p.lastByTopic = p.lastByTopic || {};
    p.lastByTopic[state.topic] = v.id;
    saveProgress(p);

    updateUrlParams({ topic: state.topic, v: v.id });

    const titleEl = $("videoTitle");
    if (titleEl) titleEl.textContent = cleanTitle(v.title);

    const idx = vids.findIndex(x => x.id === v.id);
    const total = vids.length;

    const metaEl = $("videoMeta");
    if (metaEl) {
      const parts = [];
      if (idx >= 0 && total > 0) parts.push(`ขั้น ${idx + 1}/${total}`);
      metaEl.textContent = parts.join(" • ");
    }

    const noteEl = $("videoNote");
    if (noteEl) noteEl.textContent = v.note || "";

    const player = $("player");
    if (player) player.src = drivePreview(v.driveId);

    const topicLabel = (getCategories().find(c => c.key === state.topic)?.label) || state.topic || "";
    setWatermark(`CONFIDENTIAL • ${topicLabel} • ห้ามส่งต่อ`);

    startAutoWatchMark(v.id);

    // prev/next
    const btnPrev = $("btnPrev");
    const btnNext = $("btnNext");

    const prev = (idx > 0) ? vids[idx - 1] : null;
    const next = (idx >= 0 && idx < vids.length - 1) ? vids[idx + 1] : null;

    if (btnPrev) {
      btnPrev.disabled = !prev;
      btnPrev.onclick = () => { if (prev) openVideo(prev.id); };
    }
    if (btnNext) {
      btnNext.disabled = !next;
      btnNext.onclick = () => { if (next) openVideo(next.id); };
    }

    const openFull = $("btnOpenFull");
    if (openFull) openFull.href = drivePreviewFull(v.driveId);

    const modal = $("videoModal");
    if (modal) modal.classList.remove("hidden");
  }

  function closeVideo() {
    if (state.currentVideoId && state.openedAt) {
      const dt = Date.now() - state.openedAt;
      if (dt >= 10000) markWatched(state.currentVideoId);
    }
    clearWatchTimer();

    const modal = $("videoModal");
    if (modal) modal.classList.add("hidden");

    const player = $("player");
    if (player) player.src = "";

    updateUrlParams({ v: null });

    renderAll();
  }

  // ---------- Help modal ----------
  function openHelp() { $("helpModal")?.classList.remove("hidden"); }
  function closeHelp() { $("helpModal")?.classList.add("hidden"); }

  function wireEvents() {
    $("btnHelp")?.addEventListener("click", openHelp);
    $("helpClose")?.addEventListener("click", closeHelp);

    $("helpModal")?.addEventListener("click", (e) => {
      if (e.target && e.target.id === "helpModal") closeHelp();
    });

    $("videoClose")?.addEventListener("click", closeVideo);

    $("videoModal")?.addEventListener("click", (e) => {
      if (e.target && e.target.id === "videoModal") closeVideo();
    });

    document.addEventListener("keydown", (e) => {
      const videoOpen = !$("videoModal")?.classList.contains("hidden");
      const helpOpen = !$("helpModal")?.classList.contains("hidden");

      if (e.key === "Escape") {
        if (videoOpen) closeVideo();
        if (helpOpen) closeHelp();
      }

      if (videoOpen && (e.key === "ArrowLeft" || e.key === "ArrowRight")) {
        if (e.key === "ArrowLeft") $("btnPrev")?.click();
        if (e.key === "ArrowRight") $("btnNext")?.click();
      }
    });
  }

  async function main() {
    wireEvents();
    renderSkeleton();
    setStatus("กำลังโหลดข้อมูล…");

    let res;
    try {
      res = await fetch(DATA_URL, { cache: "no-store" });
    } catch (e) {
      setStatus("โหลดข้อมูลไม่สำเร็จ: ตรวจสอบว่า data.json อยู่ในโฟลเดอร์ docs และ GitHub Pages ปล่อยจาก /docs");
      return;
    }

    if (!res.ok) {
      setStatus("โหลด data.json ไม่ได้ (HTTP " + res.status + ")");
      return;
    }

    try {
      state.data = await res.json();
    } catch (e) {
      setStatus("data.json อ่านไม่ได้ (JSON ผิดรูปแบบ)");
      return;
    }

    const title = state.data.appTitle || "คลังคลิป";
    document.title = title;
    $("appTitle") && ($("appTitle").textContent = title);

    const cats = getCategories();

    const topicParam = parseParam("topic");
    state.topic = topicParam || (cats[0] ? cats[0].key : "preop");

    applyTheme(state.topic);

    const vParam = parseParam("v");

    renderAll();
    setStatus("");

    if (vParam) openVideo(vParam);
  }

  // skeleton from v3
  function renderSkeleton() {
    const list = $("videoList");
    if (!list) return;
    list.innerHTML = "";

    for (let i = 0; i < 6; i++) {
      const card = document.createElement("div");
      card.className = "card skel";
      card.innerHTML = `
        <div class="step"></div>
        <div class="cardBody">
          <div class="skelBar large"></div>
          <div class="skelBar medium"></div>
          <div class="skelBar small"></div>
        </div>
      `;
      list.appendChild(card);
    }
  }

  main();
})();
