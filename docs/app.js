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

  // LC-UI-LOCK-R3: behavior-only patch. Existing render functions/styles/text are preserved.
  const runtime = {
    build: "LC-UI-LOCK-R3-MOBILE",
    liffStatus: "not-started",
    canWriteUrl: false,
    pendingParams: {},
    fullPending: false,
    fullResult: "not-requested"
  };

  // Diagnostics are console-only: no token, profile, phone or Drive link is exposed here.
  window.LC_PLAYER_DIAGNOSTICS = () => ({
    build: runtime.build,
    liffStatus: runtime.liffStatus,
    canWriteUrl: runtime.canWriteUrl,
    fullResult: runtime.fullResult,
    topic: state.topic,
    catalogCount: getAllVideos().length,
    videoOpen: !!state.currentVideoId,
    progressMode: "legacy-10-second-page-open-not-verified-playback"
  });

  function hasLiffContext() {
    try {
      const u = new URL(window.location.href);
      return u.searchParams.has("liff.state") || u.searchParams.has("liff.referrer") ||
        /Line\//i.test(navigator.userAgent) ||
        !!(window.liff && typeof window.liff.isInClient === "function" && window.liff.isInClient());
    } catch (e) { return false; }
  }

  async function initializeLiff() {
    const id = String(CONFIG.LIFF_ID || "");
    if (!window.liff || typeof window.liff.init !== "function" || !id || /PASTE_/i.test(id)) {
      runtime.liffStatus = "unavailable";
      runtime.canWriteUrl = !hasLiffContext();
      return;
    }
    runtime.liffStatus = "pending";
    let timeout;
    const initialization = (async () => {
      try {
        await window.liff.init({ liffId: id, withLoginOnExternalBrowser: false });
        runtime.liffStatus = "ready";
        runtime.canWriteUrl = true;
        const pending = runtime.pendingParams;
        runtime.pendingParams = {};
        if (Object.keys(pending).length) updateUrlParams(pending);
      } catch (e) {
        runtime.liffStatus = "failed";
        runtime.canWriteUrl = false;
        console.warn("[LC-UI-LOCK-R3] LIFF initialization failed; local UI remains available.");
      }
    })();
    // Don't leave the catalog indefinitely blocked by a third-party initialization.
    // A timeout NEVER authorizes URL rewriting. A late successful init may do so.
    await Promise.race([
      initialization,
      new Promise(resolve => { timeout = setTimeout(() => {
        if (runtime.liffStatus === "pending") runtime.liffStatus = "timeout";
        resolve();
      }, 8000); })
    ]);
    clearTimeout(timeout);
  }

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
    const parsed = safeJsonParse(storageGet("videoProgress"), {});
    const p = parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
    const last = p.lastByTopic && typeof p.lastByTopic === "object" && !Array.isArray(p.lastByTopic)
      ? p.lastByTopic : {};
    const safeLast = {};
    Object.keys(last).forEach(key => {
      if (key !== "__proto__" && key !== "constructor" && key !== "prototype" && typeof last[key] === "string") {
        safeLast[key] = last[key];
      }
    });
    return {
      watched: Array.isArray(p.watched) ? p.watched.filter(id => typeof id === "string") : [],
      lastByTopic: safeLast
    };
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
    if (direct !== null && direct !== "") return direct;
    let nested = u.searchParams.get("liff.state");
    if (!nested) return null;
    // URLSearchParams already decoded the outer query once. Do not double-decode
    // query VALUES (e.g. an encoded ampersand) into new query parameters.
    if (!/[?=]/.test(nested) && /%[0-9a-f]{2}/i.test(nested)) {
      try { nested = decodeURIComponent(nested); } catch (e) { return null; }
    }
    const queryStart = nested.indexOf("?");
    const query = queryStart >= 0 ? nested.slice(queryStart + 1) : nested.replace(/^\//, "");
    return new URLSearchParams(query.split("#")[0]).get(name);
  }

  function updateUrlParams(params) {
    const own = {};
    ["topic", "v"].forEach(key => {
      if (Object.prototype.hasOwnProperty.call(params, key)) own[key] = params[key];
    });
    if (!runtime.canWriteUrl) {
      Object.assign(runtime.pendingParams, own);
      return;
    }
    try {
      const u = new URL(window.location.href);
      Object.keys(own).forEach(key => {
        const value = own[key];
        if (value === null || value === undefined || value === "") u.searchParams.delete(key);
        else u.searchParams.set(key, String(value));
      });
      // Leave all liff.* parameters untouched. No navigation or page reload.
      history.replaceState(history.state, "", u.toString());
    } catch (e) {
      console.warn("[LC-UI-LOCK-R3] URL update unavailable; playback selection is kept in memory.");
    }
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
    preop:  { accent: "#F97316", accentSoft: "rgba(249,115,22,.18)", accentGlow: "rgba(249,115,22,.30)" },
    postop: { accent: "#3B82F6", accentSoft: "rgba(59,130,246,.18)", accentGlow: "rgba(59,130,246,.30)" },
    home:   { accent: "#06C755", accentSoft: "rgba(6,199,85,.18)",  accentGlow: "rgba(6,199,85,.30)" }
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

  function validDriveId(id) {
    return typeof id === "string" && /^[A-Za-z0-9_-]{10,200}$/.test(id);
  }

  function stopPlayer() {
    const player = $("player");
    if (!player) return;
    player.removeAttribute("data-mobile-pending");
    player.src = "about:blank";
  }

  function isSmallPlayerViewport() {
    const vv = window.visualViewport;
    const width = vv && Number.isFinite(vv.width) ? vv.width : window.innerWidth;
    return Number(width || 0) <= 700;
  }

  function loadDrivePreviewForCurrentVideo(player, preview, videoId) {
    if (!player) return;

    // Desktop/tablet stays on the original R3 loading path.
    if (!isSmallPlayerViewport()) {
      if (player.getAttribute("src") !== preview) player.src = preview;
      return;
    }

    // MOBILE ONLY:
    // Drive's embedded player has a known mobile control-layout regression.
    // Avoid navigating the iframe while its modal is display:none. First expose
    // the existing modal, let WebKit calculate its real size, then navigate the
    // SAME iframe to /preview. No visible UI/CSS is changed.
    const modal = $("videoModal");
    if (!modal) {
      if (player.getAttribute("src") !== preview) player.src = preview;
      return;
    }

    modal.classList.remove("hidden");
    player.setAttribute("data-mobile-pending", videoId);
    player.src = "about:blank";

    const commitLoad = () => {
      if (state.currentVideoId !== videoId) return;
      if (modal.classList.contains("hidden")) return;
      if (player.getAttribute("data-mobile-pending") !== videoId) return;

      const rect = player.getBoundingClientRect();
      if (rect.width < 2 || rect.height < 2) {
        setTimeout(commitLoad, 40);
        return;
      }

      player.removeAttribute("data-mobile-pending");
      player.src = preview;
    };

    requestAnimationFrame(() => {
      requestAnimationFrame(commitLoad);
    });
  }

  function openOutsideLine(videoId) {
    const v = getTopicVideos(state.topic).find(item => item.id === videoId);
    if (!v || !validDriveId(v.driveId) || state.currentVideoId !== videoId ||
        $("videoModal")?.classList.contains("hidden")) return;
    // A normal authenticated Drive viewer, NOT a download URL, proxy or public copy.
    const url = "https://drive.google.com/file/d/" + encodeURIComponent(v.driveId) + "/view";
    try {
      if (runtime.liffStatus === "ready" && window.liff &&
          typeof window.liff.isInClient === "function" && window.liff.isInClient() &&
          typeof window.liff.openWindow === "function") {
        window.liff.openWindow({ url, external: true });
        runtime.fullResult = "external-requested";
        return;
      }
    } catch (e) {
      console.warn("[LC-UI-LOCK-R3] External handoff unavailable; using the existing link destination.");
    }
    // This occurs only after the user presses the EXISTING full-screen control.
    // Same-tab navigation avoids silently losing an async window.open to popup blocking.
    runtime.fullResult = "drive-view-navigation";
    window.location.assign(url);
  }

  function fullScreenFromExistingButton(event) {
    if (event && (event.ctrlKey || event.metaKey || event.shiftKey || event.altKey)) return;
    if (event) event.preventDefault();
    if (runtime.fullPending) return;
    const id = state.currentVideoId;
    const box = $("player")?.parentElement;
    if (!id || !box || $("videoModal")?.classList.contains("hidden")) return;
    const standard = typeof box.requestFullscreen === "function" && document.fullscreenEnabled !== false;
    const webkit = typeof box.webkitRequestFullscreen === "function" && document.webkitFullscreenEnabled !== false;
    if (!standard && !webkit) {
      runtime.fullResult = "native-unavailable";
      openOutsideLine(id);
      return;
    }
    runtime.fullPending = true;
    try {
      // Request the SAME wrapper and iframe, including the existing watermark.
      // Never change styles, dimensions, labels, or recreate the iframe here.
      const result = standard ? box.requestFullscreen() : box.webkitRequestFullscreen();
      Promise.resolve(result).then(() => {
        runtime.fullResult = "native-request-resolved";
      }).catch(() => {
        runtime.fullResult = "native-rejected";
        openOutsideLine(id);
      }).finally(() => { runtime.fullPending = false; });
    } catch (e) {
      runtime.fullPending = false;
      runtime.fullResult = "native-error";
      openOutsideLine(id);
    }
  }

  // ---------- UI helpers ----------
  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }

  // Remove "คลิปที่ 5.2 " prefix
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

    return { total, watched, percent, watchedSet };
  }

  function pickStartVideo(topicVideos) {
    if (!topicVideos || topicVideos.length === 0) return null;

    const byBadge = topicVideos.find(v => String(v.badge || "").includes("เริ่มที่นี่"));
    if (byBadge) return byBadge;

    // if no "เริ่มที่นี่" badge, pick first
    return topicVideos[0];
  }

  // ---------- Render ----------
  function renderHero() {
    const cats = getCategories();
    const topicObj = cats.find(x => x.key === state.topic) || cats[0] || null;

    // topic chip
    const topicEmoji = $("topicEmoji");
    const topicLabel = $("topicLabel");
    if (topicEmoji) topicEmoji.textContent = topicObj?.emoji || "🎬";
    if (topicLabel) topicLabel.textContent = topicObj?.label || state.topic || "หัวข้อ";

    // bg icon
    const heroBgIcon = $("heroBgIcon");
    if (heroBgIcon) heroBgIcon.textContent = topicObj?.emoji || "🎬";

    // subtitle
    const subtitle = $("subtitle");
    if (subtitle) subtitle.textContent = "หัวข้อ: " + (topicObj?.label || state.topic || "");

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
    const v = vids.find(x => x.id === videoId);
    // Lock the selection to this topic; do not open another category via v=.
    if (!v || !validDriveId(v.driveId)) return;

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
    if (player) {
      const preview = drivePreview(v.driveId);
      // This permission applies to the iframe; it does not force video autoplay.
      player.setAttribute("allow", "autoplay; encrypted-media; fullscreen");
      loadDrivePreviewForCurrentVideo(player, preview, v.id);
    }

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
    stopPlayer();
    state.currentVideoId = null;

    updateUrlParams({ v: null });

    renderAll();
  }

  // ---------- Help modal ----------
  function openHelp() { $("helpModal")?.classList.remove("hidden"); }
  function closeHelp() { $("helpModal")?.classList.add("hidden"); }

  function wireEvents() {
    $("btnOpenFull")?.addEventListener("click", fullScreenFromExistingButton);
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

  // skeleton
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

    // SDK initialization finishes before normal route reads/history changes.
    await initializeLiff();
    const topicParam = parseParam("topic");
    state.topic = cats.some(c => c.key === topicParam)
      ? topicParam : (cats[0] ? cats[0].key : "preop");

    applyTheme(state.topic);

    const vParam = parseParam("v");

    renderAll();
    setStatus("");

    if (vParam) openVideo(vParam);
  }

  main();
})();
