(() => {
  const $ = (id) => document.getElementById(id);

  const CONFIG = (window.APP_CONFIG || {});
  const LIFF_ID = CONFIG.LIFF_ID || "";
  const DATA_URL = CONFIG.DATA_URL || "data.json";

  const state = {
    data: null,
    topic: null,
    q: "",
    currentVideoId: null,
    liffReady: false
  };

  // ---------- Safe JSON + Safe Storage ----------
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

  // ---------- URL helpers (รองรับ liff.state) ----------
  function parseParam(name) {
    const u = new URL(window.location.href);

    // 1) query ปกติ: ?topic=preop
    const direct = u.searchParams.get(name);
    if (direct) return direct;

    // 2) ใน LIFF: ค่าอาจอยู่ใน liff.state
    const liffState = u.searchParams.get("liff.state");
    if (!liffState) return null;

    // liff.state มักเป็น "/?topic=home&v=home-01" หรือ "?topic=home"
    const normalized =
      liffState.startsWith("/") ? liffState :
      liffState.startsWith("?") ? ("/" + liffState) :
      ("/?" + liffState);

    const qs = normalized.split("?")[1] || "";
    return new URLSearchParams(qs).get(name);
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

  // ---------- Drive helpers ----------
  function getDrivePreviewUrl(driveId) {
    return "https://drive.google.com/file/d/" + encodeURIComponent(driveId) + "/preview";
  }
  function getDriveViewUrl(driveId) {
    return "https://drive.google.com/file/d/" + encodeURIComponent(driveId) + "/view";
  }

  // ---------- HTML escape ----------
  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  // ---------- LIFF (optional) ----------
  async function initLiffIfPossible() {
    if (!window.liff) return false;
    if (!LIFF_ID || LIFF_ID.indexOf("PASTE_") !== -1) return false;

    try {
      await liff.init({ liffId: LIFF_ID });
      return true;
    } catch (e) {
      console.log("LIFF init failed (works as normal web)", e);
      return false;
    }
  }

  // ---------- UI helpers ----------
  function setStatus(text, isError) {
    const box = $("statusBox");
    if (!box) return;
    if (!text) {
      box.classList.add("hidden");
      box.textContent = "";
      return;
    }
    box.classList.remove("hidden");
    box.textContent = text;
    box.style.borderColor = isError ? "rgba(229,57,53,.55)" : "rgba(6,199,85,.35)";
  }

  function setTopActions() {
    const contacts = (state.data && state.data.contacts) ? state.data.contacts : {};
    const phone = contacts.nursePhone || "";
    const oa = contacts.oaLineId || "";
    const preset = contacts.presetChatText || "ขอปรึกษาอาการ/การดูแลค่ะ/ครับ";

    const btnCall = $("btnCall");
    if (btnCall) btnCall.href = phone ? ("tel:" + phone) : "#";

    const btnChat = $("btnChat");
    if (btnChat) {
      // LINE OA message URL scheme
      // ต้อง percent-encode @ และข้อความ
      if (oa) {
        btnChat.href =
          "https://line.me/R/oaMessage/" +
          encodeURIComponent(oa) +
          "/?" +
          encodeURIComponent(preset);
      } else {
        btnChat.href = "#";
      }
    }
  }

  function renderCategorySelect() {
    const sel = $("categorySelect");
    if (!sel) return;

    sel.innerHTML = "";

    const categories = (state.data && Array.isArray(state.data.categories)) ? state.data.categories : [];
    categories.forEach((c) => {
      const opt = document.createElement("option");
      opt.value = c.key;
      opt.textContent = (c.emoji ? (c.emoji + " ") : "") + c.label;
      sel.appendChild(opt);
    });

    sel.value = state.topic || (categories[0] ? categories[0].key : "");

    sel.addEventListener("change", () => {
      state.topic = sel.value;

      // เปลี่ยนหมวดแล้วปิดคลิป (ถ้าเปิดอยู่) + ลบ v ออกจาก URL
      closeVideo();
      updateUrlParams({ topic: state.topic, v: null });

      render();
    });
  }

  function buildBadges(video, watchedSet) {
    const parts = [];

    if (video.mustWatch) {
      parts.push('<span class="badge badge--must">ต้องดู</span>');
    }
    if (watchedSet.has(video.id)) {
      parts.push('<span class="badge badge--watched">ดูแล้ว</span>');
    }
    if (video.badge) {
      parts.push('<span class="badge">' + escapeHtml(video.badge) + "</span>");
    }

    return parts.join("");
  }

  function render() {
    if (!state.data) return;

    const categories = Array.isArray(state.data.categories) ? state.data.categories : [];
    const videosAll = Array.isArray(state.data.videos) ? state.data.videos : [];

    const topicObj = categories.find((c) => c.key === state.topic) || categories[0] || null;
    const topicLabel = topicObj ? topicObj.label : (state.topic || "");

    const subtitle = $("subtitle");
    if (subtitle) subtitle.textContent = "หัวข้อ: " + topicLabel;

    const tip = $("tipBox");
    if (tip) tip.textContent = (topicObj && topicObj.tip) ? topicObj.tip : "";

    const progress = loadProgress();
    const watchedSet = new Set(Array.isArray(progress.watched) ? progress.watched : []);
    const lastByTopic = progress.lastByTopic || {};
    const lastId = lastByTopic[state.topic] || null;

    // ปุ่มดูต่อ
    const btnContinue = $("btnContinue");
    if (btnContinue) {
      btnContinue.onclick = () => {
        if (!lastId) {
          alert("ยังไม่มีคลิปล่าสุดของหัวข้อนี้");
          return;
        }
        openVideo(lastId);
      };
    }

    let videos = videosAll
      .filter((v) => v.category === state.topic)
      .sort((a, b) => (a.order || 999) - (b.order || 999));

    const q = (state.q || "").trim().toLowerCase();
    if (q) {
      videos = videos.filter((v) => {
        const tags = Array.isArray(v.tags) ? v.tags.join(" ") : "";
        const hay = (v.title + " " + (v.note || "") + " " + tags).toLowerCase();
        return hay.indexOf(q) !== -1;
      });
    }

    const countLabel = $("countLabel");
    if (countLabel) countLabel.textContent = videos.length + " คลิป";

    const list = $("videoList");
    if (!list) return;

    list.innerHTML = "";

    if (videos.length === 0) {
      setStatus("ยังไม่มีคลิปในหัวข้อนี้ หรือไม่ตรงกับคำค้นหา", false);
      return;
    }
    setStatus("", false);

    videos.forEach((v) => {
      const tags = Array.isArray(v.tags) ? v.tags.slice(0, 6) : [];
      const tagsHtml = tags.map((t) => '<span class="tag">' + escapeHtml(t) + "</span>").join("");

      const metaParts = [];
      if (v.duration) metaParts.push("⏱ " + escapeHtml(v.duration));
      if (tagsHtml) metaParts.push(tagsHtml);

      const card = document.createElement("div");
      card.className = "card";

      // ✅ ตัดปุ่ม แชร์ + เปิดใน Drive ออกจากการ์ด เหลือแค่ "ดูคลิป"
      card.innerHTML = `
        <div class="card__top">
          <div class="card__title">${escapeHtml(v.title)}</div>
          <div class="badges">${buildBadges(v, watchedSet)}</div>
        </div>
        ${v.note ? `<div class="card__note">${escapeHtml(v.note)}</div>` : ""}
        <div class="card__meta">${metaParts.join(" ")}</div>
        <div class="card__actions">
          <button class="btn btnSmall" data-open="${escapeHtml(v.id)}" type="button">ดูคลิป</button>
        </div>
      `;

      list.appendChild(card);
    });

    // bind open
    const buttons = list.querySelectorAll("[data-open]");
    buttons.forEach((btn) => {
      btn.addEventListener("click", () => {
        const id = btn.getAttribute("data-open");
        openVideo(id);
      });
    });
  }

  function openVideo(videoId) {
    const videosAll = (state.data && Array.isArray(state.data.videos)) ? state.data.videos : [];
    const v = videosAll.find((x) => x.id === videoId);
    if (!v) return;

    state.currentVideoId = videoId;

    // บันทึกล่าสุด
    const progress = loadProgress();
    progress.lastByTopic = progress.lastByTopic || {};
    progress.lastByTopic[state.topic] = videoId;
    saveProgress(progress);

    // update URL deep link
    updateUrlParams({ topic: state.topic, v: videoId });

    const titleEl = $("videoTitle");
    if (titleEl) titleEl.textContent = v.title;

    const metaEl = $("videoMeta");
    if (metaEl) {
      const tags = Array.isArray(v.tags) ? v.tags.slice(0, 5).join(" · ") : "";
      const metaParts = [];
      if (v.duration) metaParts.push("⏱ " + v.duration);
      if (tags) metaParts.push("🏷 " + tags);
      metaEl.textContent = metaParts.join("   ");
    }

    const noteEl = $("videoNote");
    if (noteEl) noteEl.textContent = v.note || "";

    const player = $("player");
    if (player) player.src = getDrivePreviewUrl(v.driveId);

    const openDrive = $("btnOpenDrive");
    if (openDrive) openDrive.href = getDriveViewUrl(v.driveId);

    // ปุ่มดูแล้ว (toggle)
    const btnToggle = $("btnToggleWatched");
    if (btnToggle) {
      const watchedSet = new Set((loadProgress().watched || []));
      const isWatched = watchedSet.has(videoId);
      btnToggle.textContent = isWatched ? "ยกเลิกทำเครื่องหมายดูแล้ว" : "ทำเครื่องหมายดูแล้ว";

      btnToggle.onclick = () => {
        const p = loadProgress();
        const watched = new Set(Array.isArray(p.watched) ? p.watched : []);
        if (watched.has(videoId)) watched.delete(videoId);
        else watched.add(videoId);

        p.watched = Array.from(watched);
        p.lastByTopic = p.lastByTopic || {};
        p.lastByTopic[state.topic] = videoId;

        saveProgress(p);

        // อัปเดตปุ่ม + รีเรนเดอร์รายการให้ badge เปลี่ยน
        const nowWatched = watched.has(videoId);
        btnToggle.textContent = nowWatched ? "ยกเลิกทำเครื่องหมายดูแล้ว" : "ทำเครื่องหมายดูแล้ว";
        render();
      };
    }

    const modal = $("videoModal");
    if (modal) modal.classList.remove("hidden");
  }

  function closeVideo() {
    const modal = $("videoModal");
    if (modal) modal.classList.add("hidden");

    const player = $("player");
    if (player) player.src = "";

    // ลบ v ออกจาก URL แต่เก็บ topic ไว้
    updateUrlParams({ v: null });
  }

  function openHelp() {
    const m = $("helpModal");
    if (m) m.classList.remove("hidden");
  }
  function closeHelp() {
    const m = $("helpModal");
    if (m) m.classList.add("hidden");
  }

  // ---------- Event wiring ----------
  function wireStaticEvents() {
    const btnHelp = $("btnHelp");
    if (btnHelp) btnHelp.addEventListener("click", openHelp);

    const helpClose = $("helpClose");
    if (helpClose) helpClose.addEventListener("click", closeHelp);

    const helpModal = $("helpModal");
    if (helpModal) {
      helpModal.addEventListener("click", (e) => {
        if (e.target && e.target.id === "helpModal") closeHelp();
      });
    }

    const videoClose = $("videoClose");
    if (videoClose) videoClose.addEventListener("click", closeVideo);

    const videoModal = $("videoModal");
    if (videoModal) {
      videoModal.addEventListener("click", (e) => {
        if (e.target && e.target.id === "videoModal") closeVideo();
      });
    }

    const search = $("searchInput");
    if (search) {
      search.addEventListener("input", (e) => {
        state.q = e.target.value || "";
        render();
      });
    }
  }

  async function main() {
    wireStaticEvents();

    setStatus("กำลังโหลดข้อมูล…", false);

    let res;
    try {
      res = await fetch(DATA_URL, { cache: "no-store" });
    } catch (e) {
      setStatus("โหลดข้อมูลไม่สำเร็จ: ตรวจสอบว่า data.json อยู่ในโฟลเดอร์ docs และ URL ถูกต้อง", true);
      return;
    }

    if (!res.ok) {
      setStatus("โหลด data.json ไม่ได้ (HTTP " + res.status + "): ตรวจสอบ GitHub Pages ว่าปล่อยจาก /docs", true);
      return;
    }

    try {
      state.data = await res.json();
    } catch (e) {
      setStatus("data.json อ่านไม่ได้ (JSON ผิดรูปแบบ): ตรวจสอบจุลภาค/วงเล็บ", true);
      return;
    }

    document.title = (state.data && state.data.appTitle) ? state.data.appTitle : document.title;

    const titleEl = $("appTitle");
    if (titleEl) titleEl.textContent = (state.data && state.data.appTitle) ? state.data.appTitle : "คลังคลิป";

    // topic เริ่มต้น
    const categories = (state.data && Array.isArray(state.data.categories)) ? state.data.categories : [];
    const topicParam = parseParam("topic");
    state.topic = topicParam || (categories[0] ? categories[0].key : "");

    // init LIFF (optional)
    state.liffReady = await initLiffIfPossible();

    setTopActions();
    renderCategorySelect();
    render();

    // deep link เปิดคลิปทันทีถ้ามี v=
    const vParam = parseParam("v");
    if (vParam) openVideo(vParam);

    setStatus("", false);
  }

  main();
})();
