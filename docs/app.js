(() => {
  const $ = (id) => document.getElementById(id);

  const CONFIG = window.APP_CONFIG || {};
  const DATA_URL = CONFIG.DATA_URL || "data.json";

  const state = {
    data: null,
    topic: null,
    currentVideoId: null
  };

  // ---------- Safe storage ----------
  // getItem คืน null ได้ถ้ายังไม่มี key (ปกติ) → ต้องกันไว้ไม่ให้หน้าพัง
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

  // ---------- LIFF param helper ----------
  // ใน LIFF: additional info อาจมาใน liff.state (urlencoded) เลยต้อง decode แล้วดึง query ออก
  function parseParam(name) {
    const u = new URL(window.location.href);

    const direct = u.searchParams.get(name);
    if (direct) return direct;

    const liffStateEnc = u.searchParams.get("liff.state");
    if (!liffStateEnc) return null;

    let decoded = liffStateEnc;
    try { decoded = decodeURIComponent(liffStateEnc); } catch (e) {}

    // decoded อาจเป็น "path_A/?topic=home&v=home-01#fragment"
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

  // ---------- Drive URLs ----------
  function drivePreview(driveId) {
    return "https://drive.google.com/file/d/" + encodeURIComponent(driveId) + "/preview";
  }
  function driveView(driveId) {
    return "https://drive.google.com/file/d/" + encodeURIComponent(driveId) + "/view";
  }

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
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

  function buildBadges(video, watchedSet) {
    const out = [];
    if (video.mustWatch) out.push('<span class="badge badge--must">ต้องดู</span>');
    if (watchedSet.has(video.id)) out.push('<span class="badge badge--watched">ดูแล้ว</span>');
    if (video.badge) out.push('<span class="badge">' + escapeHtml(video.badge) + "</span>");
    return out.join("");
  }

  // ---------- WOW UI render ----------
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

  function renderTabsAndSummary() {
    const cats = getCategories();
    const progress = loadProgress();
    const watchedSet = new Set(Array.isArray(progress.watched) ? progress.watched : []);

    // tabs
    const tabs = $("categoryTabs");
    if (tabs) {
      tabs.innerHTML = "";
      cats.forEach((c) => {
        const vids = getTopicVideos(c.key);
        const total = vids.length;
        const watched = vids.filter(v => watchedSet.has(v.id)).length;

        const btn = document.createElement("button");
        btn.className = "tab" + (c.key === state.topic ? " is-active" : "");
        btn.setAttribute("role", "tab");
        btn.setAttribute("aria-selected", c.key === state.topic ? "true" : "false");
        btn.innerHTML = `
          <span class="tab__left">
            <span class="tab__emoji">${escapeHtml(c.emoji || "")}</span>
            <span class="tab__label">${escapeHtml(c.label)}</span>
          </span>
          <span class="tab__count">${watched}/${total}</span>
        `;
        btn.onclick = () => {
          state.topic = c.key;
          closeVideo();
          updateUrlParams({ topic: state.topic, v: null });
          renderAll();
        };
        tabs.appendChild(btn);
      });
    }

    // summary + ring
    const topicObj = cats.find(x => x.key === state.topic) || cats[0] || null;
    const topicVideos = topicObj ? getTopicVideos(topicObj.key) : [];
    const total = topicVideos.length;
    const watched = topicVideos.filter(v => watchedSet.has(v.id)).length;
    const percent = total ? Math.round((watched / total) * 100) : 0;
    const deg = Math.round((percent / 100) * 360);

    const ring = $("progressRing");
    if (ring) {
      ring.style.background = `conic-gradient(var(--accent) 0deg ${deg}deg, var(--ringTrack) ${deg}deg 360deg)`;
    }
    const ringValue = $("ringValue");
    if (ringValue) ringValue.textContent = percent + "%";

    const progressText = $("progressText");
    if (progressText) progressText.textContent = `ดูแล้ว ${watched}/${total} คลิป`;

    const hint = $("progressHint");
    if (hint) hint.textContent = (topicObj && topicObj.tip) ? topicObj.tip : "เลือกหัวข้อ แล้วกดดูคลิปตามลำดับ";

    // buttons start/continue
    const btnStart = $("btnStart");
    const btnContinue = $("btnContinue");

    const startVideo = pickStartVideo(topicVideos);
    const lastId = (progress.lastByTopic && state.topic) ? progress.lastByTopic[state.topic] : null;

    if (btnStart) {
      btnStart.onclick = () => {
        if (!startVideo) return;
        openVideo(startVideo.id);
      };
    }
    if (btnContinue) {
      btnContinue.onclick = () => {
        if (lastId) openVideo(lastId);
        else if (startVideo) openVideo(startVideo.id);
        else setStatus("ยังไม่มีคลิปในหัวข้อนี้");
      };
    }
  }

  function pickStartVideo(topicVideos) {
    if (!topicVideos || topicVideos.length === 0) return null;

    // 1) badge = เริ่มที่นี่
    const byBadge = topicVideos.find(v => String(v.badge || "").includes("เริ่มที่นี่"));
    if (byBadge) return byBadge;

    // 2) mustWatch ตัวแรก
    const byMust = topicVideos.find(v => v.mustWatch);
    if (byMust) return byMust;

    // 3) ตัวแรกตาม order
    return topicVideos[0];
  }

  function renderList() {
    const cats = getCategories();
    const topicObj = cats.find(x => x.key === state.topic) || cats[0] || null;

    const subtitle = $("subtitle");
    if (subtitle) subtitle.textContent = "หัวข้อ: " + (topicObj ? topicObj.label : (state.topic || ""));

    const tipBox = $("tipBox");
    if (tipBox) tipBox.textContent = (topicObj && topicObj.tip) ? topicObj.tip : "";

    const progress = loadProgress();
    const watchedSet = new Set(Array.isArray(progress.watched) ? progress.watched : []);

    const videos = topicObj ? getTopicVideos(topicObj.key) : [];

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

      card.innerHTML = `
        <div class="step">${idx + 1}</div>
        <div class="cardBody">
          <div class="cardTop">
            <div class="cardTitle">${escapeHtml(v.title)}</div>
            <div class="badges">${buildBadges(v, watchedSet)}</div>
          </div>
          ${v.note ? `<div class="cardNote">${escapeHtml(v.note)}</div>` : ""}
          <div class="playRow">
            <div class="playBtn" role="button" aria-label="ดูคลิป"><b>▶</b> ดูคลิป</div>
          </div>
        </div>
      `;

      // คลิกทั้งการ์ดเปิดคลิป
      card.onclick = () => openVideo(v.id);

      list.appendChild(card);
    });
  }

  function renderAll() {
    renderTabsAndSummary();
    renderList();
  }

  // ---------- Video modal ----------
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
    if (titleEl) titleEl.textContent = v.title;

    const idx = vids.findIndex(x => x.id === v.id);
    const total = vids.length;

    const metaEl = $("videoMeta");
    if (metaEl) {
      const parts = [];
      if (idx >= 0 && total > 0) parts.push(`ขั้น ${idx + 1}/${total}`);
      if (v.duration) parts.push(`⏱ ${v.duration}`);
      metaEl.textContent = parts.join(" • ");
    }

    const noteEl = $("videoNote");
    if (noteEl) noteEl.textContent = v.note || "";

    const player = $("player");
    if (player) player.src = drivePreview(v.driveId);

    const openDrive = $("btnOpenDrive");
    if (openDrive) openDrive.href = driveView(v.driveId);

    // watched toggle
    const btnToggle = $("btnToggleWatched");
    if (btnToggle) {
      const watchedSet = new Set((loadProgress().watched || []));
      btnToggle.textContent = watchedSet.has(v.id) ? "ยกเลิกทำเครื่องหมายดูแล้ว" : "ทำเครื่องหมายดูแล้ว";

      btnToggle.onclick = () => {
        const pp = loadProgress();
        const w = new Set(Array.isArray(pp.watched) ? pp.watched : []);
        if (w.has(v.id)) w.delete(v.id);
        else w.add(v.id);
        pp.watched = Array.from(w);
        pp.lastByTopic = pp.lastByTopic || {};
        pp.lastByTopic[state.topic] = v.id;
        saveProgress(pp);

        btnToggle.textContent = w.has(v.id) ? "ยกเลิกทำเครื่องหมายดูแล้ว" : "ทำเครื่องหมายดูแล้ว";
        renderAll();
      };
    }

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

    const modal = $("videoModal");
    if (modal) modal.classList.remove("hidden");
  }

  function closeVideo() {
    const modal = $("videoModal");
    if (modal) modal.classList.add("hidden");

    const player = $("player");
    if (player) player.src = "";

    updateUrlParams({ v: null });
  }

  // ---------- Help ----------
  function openHelp() {
    const m = $("helpModal");
    if (m) m.classList.remove("hidden");
  }
  function closeHelp() {
    const m = $("helpModal");
    if (m) m.classList.add("hidden");
  }

  function wireEvents() {
    const btnHelp = $("btnHelp");
    if (btnHelp) btnHelp.onclick = openHelp;

    const helpClose = $("helpClose");
    if (helpClose) helpClose.onclick = closeHelp;

    const helpModal = $("helpModal");
    if (helpModal) {
      helpModal.addEventListener("click", (e) => {
        if (e.target && e.target.id === "helpModal") closeHelp();
      });
    }

    const videoClose = $("videoClose");
    if (videoClose) videoClose.onclick = closeVideo;

    const videoModal = $("videoModal");
    if (videoModal) {
      videoModal.addEventListener("click", (e) => {
        if (e.target && e.target.id === "videoModal") closeVideo();
      });
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

    const appTitle = $("appTitle");
    if (appTitle) appTitle.textContent = title;

    const cats = getCategories();
    state.topic = parseParam("topic") || (cats[0] ? cats[0].key : "preop");

    renderAll();
    setStatus("");

    const vParam = parseParam("v");
    if (vParam) openVideo(vParam);
  }

  main();
})();
