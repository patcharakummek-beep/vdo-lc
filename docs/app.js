(() => {
  const $ = (id) => document.getElementById(id);

  const CONFIG = window.APP_CONFIG || {};
  const DATA_URL = CONFIG.DATA_URL || "data.json";

  const state = {
    data: null,
    topic: null,
    currentVideoId: null
  };

  // ---- Safe storage (กันพัง: getItem คืน null ได้ตามสเปก) ----
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

  // ---- LIFF URL param helper (topic อาจอยู่ใน liff.state) ----
  function parseParam(name) {
    const u = new URL(window.location.href);

    const direct = u.searchParams.get(name);
    if (direct) return direct;

    const liffState = u.searchParams.get("liff.state");
    if (!liffState) return null;

    // liff.state อาจเป็น "/?topic=preop&v=preop-01" หรือ "?topic=preop"
    let s = liffState.trim();
    if (s.startsWith("/")) s = s.slice(1);
    if (s.startsWith("?")) s = s.slice(1);

    // ตัด fragment ออก
    s = s.split("#")[0];

    // ถ้ามี path?query ให้เอาเฉพาะ query
    const parts = s.split("?");
    const qs = (parts.length >= 2) ? parts.slice(1).join("?") : parts[0];

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

  // ---- Drive helpers ----
  function drivePreview(driveId) {
    return "https://drive.google.com/file/d/" + encodeURIComponent(driveId) + "/preview";
  }
  function driveView(driveId) {
    return "https://drive.google.com/file/d/" + encodeURIComponent(driveId) + "/view";
  }

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
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

  function renderCategorySelect() {
    const sel = $("categorySelect");
    if (!sel) return;

    sel.innerHTML = "";

    const cats = Array.isArray(state.data.categories) ? state.data.categories : [];
    cats.forEach((c) => {
      const opt = document.createElement("option");
      opt.value = c.key;
      opt.textContent = (c.emoji ? c.emoji + " " : "") + c.label;
      sel.appendChild(opt);
    });

    sel.value = state.topic || (cats[0] ? cats[0].key : "");

    sel.addEventListener("change", () => {
      state.topic = sel.value;
      closeVideo();
      updateUrlParams({ topic: state.topic, v: null });
      render();
    });
  }

  function render() {
    const cats = Array.isArray(state.data.categories) ? state.data.categories : [];
    const all = Array.isArray(state.data.videos) ? state.data.videos : [];

    const topicObj = cats.find((c) => c.key === state.topic) || cats[0] || null;

    const subtitle = $("subtitle");
    if (subtitle) subtitle.textContent = "หัวข้อ: " + (topicObj ? topicObj.label : (state.topic || ""));

    const tip = $("tipBox");
    if (tip) tip.textContent = (topicObj && topicObj.tip) ? topicObj.tip : "";

    const progress = loadProgress();
    const watchedSet = new Set(Array.isArray(progress.watched) ? progress.watched : []);
    const lastId = (progress.lastByTopic && state.topic) ? progress.lastByTopic[state.topic] : null;

    const btnContinue = $("btnContinue");
    if (btnContinue) {
      btnContinue.onclick = () => {
        if (!lastId) {
          setStatus("ยังไม่มีคลิปล่าสุดของหัวข้อนี้");
          return;
        }
        openVideo(lastId);
      };
    }

    let videos = all
      .filter((v) => v.category === state.topic)
      .sort((a, b) => (a.order || 999) - (b.order || 999));

    const countLabel = $("countLabel");
    if (countLabel) countLabel.textContent = videos.length + " คลิป";

    const list = $("videoList");
    if (!list) return;

    list.innerHTML = "";

    if (videos.length === 0) {
      setStatus("ยังไม่มีคลิปในหัวข้อนี้");
      return;
    }
    setStatus("");

    videos.forEach((v) => {
      const card = document.createElement("div");
      card.className = "card";

      // ✅ ไม่มีแท็กชิป, ไม่มีแชร์, ไม่มีเปิดใน Drive ที่หน้า list
      card.innerHTML = `
        <div class="card__top">
          <div class="card__title">${escapeHtml(v.title)}</div>
          <div class="badges">${buildBadges(v, watchedSet)}</div>
        </div>
        ${v.note ? `<div class="card__note">${escapeHtml(v.note)}</div>` : ""}
        <div class="card__actions">
          <button class="btn" data-open="${escapeHtml(v.id)}" type="button">ดูคลิป</button>
        </div>
      `;

      list.appendChild(card);
    });

    list.querySelectorAll("[data-open]").forEach((btn) => {
      btn.addEventListener("click", () => openVideo(btn.getAttribute("data-open")));
    });
  }

  function openVideo(videoId) {
    const all = Array.isArray(state.data.videos) ? state.data.videos : [];
    const v = all.find((x) => x.id === videoId);
    if (!v) return;

    state.currentVideoId = videoId;

    // บันทึกล่าสุด
    const p = loadProgress();
    p.lastByTopic = p.lastByTopic || {};
    p.lastByTopic[state.topic] = videoId;
    saveProgress(p);

    updateUrlParams({ topic: state.topic, v: videoId });

    const titleEl = $("videoTitle");
    if (titleEl) titleEl.textContent = v.title;

    // ✅ เอา meta ที่เป็น tags ออก ให้เหลือแค่ duration (ถ้ามี)
    const metaEl = $("videoMeta");
    if (metaEl) metaEl.textContent = v.duration ? ("⏱ " + v.duration) : "";

    const noteEl = $("videoNote");
    if (noteEl) noteEl.textContent = v.note || "";

    const player = $("player");
    if (player) player.src = drivePreview(v.driveId);

    const openDrive = $("btnOpenDrive");
    if (openDrive) openDrive.href = driveView(v.driveId);

    // toggle watched
    const btnToggle = $("btnToggleWatched");
    if (btnToggle) {
      const watched = new Set((loadProgress().watched || []));
      const isWatched = watched.has(videoId);
      btnToggle.textContent = isWatched ? "ยกเลิกทำเครื่องหมายดูแล้ว" : "ทำเครื่องหมายดูแล้ว";

      btnToggle.onclick = () => {
        const pp = loadProgress();
        const w = new Set(Array.isArray(pp.watched) ? pp.watched : []);
        if (w.has(videoId)) w.delete(videoId);
        else w.add(videoId);

        pp.watched = Array.from(w);
        pp.lastByTopic = pp.lastByTopic || {};
        pp.lastByTopic[state.topic] = videoId;

        saveProgress(pp);
        btnToggle.textContent = w.has(videoId) ? "ยกเลิกทำเครื่องหมายดูแล้ว" : "ทำเครื่องหมายดูแล้ว";
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

  function wireEvents() {
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
  }

  async function main() {
    wireEvents();
    setStatus("กำลังโหลดข้อมูล…");

    let res;
    try {
      res = await fetch(DATA_URL, { cache: "no-store" });
    } catch (e) {
      setStatus("โหลดข้อมูลไม่สำเร็จ: ตรวจสอบว่า data.json อยู่ในโฟลเดอร์ docs และ GitHub Pages ปล่อยจาก /docs");
      return;
    }

    if (!res.ok) {
      setStatus("โหลด data.json ไม่ได้ (HTTP " + res.status + "): ตรวจสอบ GitHub Pages");
      return;
    }

    try {
      state.data = await res.json();
    } catch (e) {
      setStatus("data.json อ่านไม่ได้ (JSON ผิดรูปแบบ)");
      return;
    }

    const title = (state.data && state.data.appTitle) ? state.data.appTitle : "คลังคลิป";
    document.title = title;
    const appTitle = $("appTitle");
    if (appTitle) appTitle.textContent = title;

    const cats = Array.isArray(state.data.categories) ? state.data.categories : [];
    state.topic = parseParam("topic") || (cats[0] ? cats[0].key : "");

    renderCategorySelect();
    render();

    const vParam = parseParam("v");
    if (vParam) openVideo(vParam);

    setStatus("");
  }

  main();
})();
