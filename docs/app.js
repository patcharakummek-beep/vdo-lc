(function () {
  "use strict";

  function $(id) { return document.getElementById(id); }

  var CONFIG = window.APP_CONFIG || {};
  var LIFF_ID = CONFIG.LIFF_ID || "";
  var DATA_URL = CONFIG.DATA_URL || "data.json";

  var state = {
    data: null,
    topic: null,
    q: "",
    currentVideoId: null,
    liffReady: false,
    storageAvailable: true
  };

  // --------------------------
  // Storage (safe)
  // --------------------------
  function storageGet(key) {
    try { return window.localStorage.getItem(key); }
    catch (e) { state.storageAvailable = false; return null; }
  }
  function storageSet(key, val) {
    try { window.localStorage.setItem(key, val); return true; }
    catch (e) { state.storageAvailable = false; return false; }
  }

  function safeJsonParse(s, fallback) {
    try {
      if (s === null || s === undefined || s === "") return fallback;
      var v = JSON.parse(s);
      return (v === null || v === undefined) ? fallback : v;
    } catch (e) {
      return fallback;
    }
  }

  function loadProgress() {
    var raw = storageGet("videoProgress");
    return safeJsonParse(raw, { watched: [], lastByTopic: {} });
  }
  function saveProgress(p) {
    storageSet("videoProgress", JSON.stringify(p));
  }

  // --------------------------
  // URL params (supports liff.state)
  // --------------------------
  function getParam(name) {
    var url = new URL(window.location.href);
    var v = url.searchParams.get(name);
    if (v !== null) return v;

    var liffState = url.searchParams.get("liff.state");
    if (!liffState) return null;

    // liff.state can be like "/?topic=preop&v=preop-01" or "?topic=preop"
    var qs = "";
    if (liffState.indexOf("?") >= 0) qs = liffState.split("?")[1] || "";
    else if (liffState.charAt(0) === "?") qs = liffState.slice(1);
    else qs = "";

    if (!qs) return null;
    var params = new URLSearchParams(qs);
    var vv = params.get(name);
    return vv !== null ? vv : null;
  }

  function setQuery(paramsObj) {
    // Update URL without reload (works in normal browser; in LIFF it also works)
    var url = new URL(window.location.href);

    // Avoid keeping liff.state from old links
    url.searchParams.delete("liff.state");

    Object.keys(paramsObj).forEach(function (k) {
      var val = paramsObj[k];
      if (val === null || val === undefined || val === "") url.searchParams.delete(k);
      else url.searchParams.set(k, String(val));
    });

    window.history.replaceState({}, "", url.toString());
  }

  // --------------------------
  // Drive URLs
  // --------------------------
  function drivePreviewUrl(driveId) {
    return "https://drive.google.com/file/d/" + driveId + "/preview";
  }
  function driveViewUrl(driveId) {
    return "https://drive.google.com/file/d/" + driveId + "/view";
  }

  // --------------------------
  // LINE URL scheme helpers
  // --------------------------
  function oaChatUrl(oaLineId, presetText) {
    if (!oaLineId) return "#";
    var id = encodeURIComponent(oaLineId); // @ -> %40
    if (presetText && presetText.trim()) {
      return "https://line.me/R/oaMessage/" + id + "/?" + encodeURIComponent(presetText);
    }
    return "https://line.me/R/oaMessage/" + id;
  }

  function shareUrl(text) {
    return "https://line.me/R/share?text=" + encodeURIComponent(text);
  }

  // --------------------------
  // LIFF
  // --------------------------
  function liffConfigured() {
    return LIFF_ID && LIFF_ID.indexOf("PASTE_") === -1 && LIFF_ID.indexOf("YOUR_") === -1;
  }

  function liffDeepLink(topic, videoId) {
    // Best: share LIFF URL so it opens inside LINE
    if (liffConfigured()) {
      var sp = new URLSearchParams();
      if (topic) sp.set("topic", topic);
      if (videoId) sp.set("v", videoId);
      return "https://liff.line.me/" + LIFF_ID + "?" + sp.toString();
    }
    // Fallback: current site URL
    var u = new URL(window.location.href);
    u.searchParams.set("topic", topic || "");
    if (videoId) u.searchParams.set("v", videoId);
    else u.searchParams.delete("v");
    u.searchParams.delete("liff.state");
    return u.toString();
  }

  function showStatus(msg) {
    var box = $("statusBox");
    if (!msg) { box.classList.add("hidden"); box.textContent = ""; return; }
    box.textContent = msg;
    box.classList.remove("hidden");
  }

  async function initLiffMaybe() {
    if (!liffConfigured()) return false;
    if (!window.liff) return false;

    try {
      await window.liff.init({ liffId: LIFF_ID });
      state.liffReady = true;
      return true;
    } catch (e) {
      state.liffReady = false;
      return false;
    }
  }

  async function tryShareTargetPicker(text) {
    if (!state.liffReady || !window.liff) return false;

    try {
      if (typeof liff.isApiAvailable === "function" && !liff.isApiAvailable("shareTargetPicker")) {
        return false;
      }

      if (typeof liff.isLoggedIn === "function" && !liff.isLoggedIn()) {
        // External browser may require login
        liff.login({ redirectUri: window.location.href });
        return true; // will redirect
      }

      await liff.shareTargetPicker([{ type: "text", text: text }]);
      return true;
    } catch (e) {
      return false;
    }
  }

  // --------------------------
  // Rendering
  // --------------------------
  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function currentCategoryObj() {
    var cats = (state.data && state.data.categories) ? state.data.categories : [];
    for (var i = 0; i < cats.length; i++) if (cats[i].key === state.topic) return cats[i];
    return null;
  }

  function renderCategorySelect() {
    var sel = $("categorySelect");
    sel.innerHTML = "";

    var cats = state.data.categories || [];
    cats.forEach(function (c) {
      var opt = document.createElement("option");
      opt.value = c.key;
      opt.textContent = (c.emoji ? (c.emoji + " ") : "") + c.label;
      sel.appendChild(opt);
    });

    sel.value = state.topic;
    sel.onchange = function () {
      state.topic = sel.value;
      setQuery({ topic: state.topic, v: null });
      render();
    };
  }

  function buildBadges(video, watchedSet) {
    var parts = [];
    if (video.mustWatch) parts.push('<span class="badge badge--must">ต้องดู</span>');
    if (watchedSet.has(video.id)) parts.push('<span class="badge badge--watched">ดูแล้ว</span>');
    if (video.badge) parts.push('<span class="badge">' + escapeHtml(video.badge) + "</span>");
    return parts.join("");
  }

  function render() {
    // Title/subtitle
    $("appTitle").textContent = state.data.appTitle || "คลังคลิป";
    var cat = currentCategoryObj();
    $("subtitle").textContent = cat ? ("หัวข้อ: " + cat.label) : "เลือกหัวข้อ";

    // Tip
    var tip = cat && cat.tip ? cat.tip : "ทิป: ถ้าคลิปเปิดไม่ได้ ให้เช็คว่าไฟล์ Drive ตั้งเป็น Anyone with the link → Viewer แล้ว";
    if (!state.storageAvailable) {
      tip += " • หมายเหตุ: อุปกรณ์นี้บล็อก storage จึงอาจจำสถานะ “ดูแล้ว/ดูต่อ” ไม่ได้";
    }
    $("tipBox").textContent = tip;

    // Top actions
    var phone = state.data.contacts && state.data.contacts.nursePhone ? state.data.contacts.nursePhone : "";
    $("btnCall").href = phone ? ("tel:" + phone) : "#";

    var oa = state.data.contacts && state.data.contacts.oaLineId ? state.data.contacts.oaLineId : "";
    var preset = state.data.contacts && state.data.contacts.presetChatText ? state.data.contacts.presetChatText : "";
    $("btnChat").href = oa ? oaChatUrl(oa, preset) : "#";

    // Progress
    var progress = loadProgress();
    var watched = new Set(progress.watched || []);
    var lastByTopic = progress.lastByTopic || {};
    var lastId = lastByTopic[state.topic] || null;

    // Filter videos
    var allVideos = Array.isArray(state.data.videos) ? state.data.videos : [];
    var videos = allVideos.filter(function (v) { return v.category === state.topic; });

    videos.sort(function (a, b) {
      var ao = (a.order === undefined || a.order === null) ? 9999 : a.order;
      var bo = (b.order === undefined || b.order === null) ? 9999 : b.order;
      return ao - bo;
    });

    var q = (state.q || "").trim().toLowerCase();
    if (q) {
      videos = videos.filter(function (v) {
        var hay = (v.title + " " + (v.note || "") + " " + (v.tags || []).join(" ")).toLowerCase();
        return hay.indexOf(q) >= 0;
      });
    }

    $("countLabel").textContent = videos.length + " คลิป";

    // List
    var list = $("videoList");
    list.innerHTML = "";

    if (videos.length === 0) {
      var empty = document.createElement("div");
      empty.className = "empty";
      empty.textContent = q ? "ไม่พบคลิปที่ตรงกับคำค้นหา" : "ยังไม่มีคลิปในหัวข้อนี้";
      list.appendChild(empty);
      return;
    }

    videos.forEach(function (v) {
      var card = document.createElement("div");
      card.className = "card";

      var tagHtml = "";
      (v.tags || []).slice(0, 6).forEach(function (t) {
        tagHtml += '<span class="tag">' + escapeHtml(t) + "</span>";
      });

      card.innerHTML =
        '<div class="card__top">' +
          '<div class="card__title">' + escapeHtml(v.title) + "</div>" +
          '<div class="badges">' + buildBadges(v, watched) + "</div>" +
        "</div>" +
        (v.note ? '<div class="card__note">' + escapeHtml(v.note) + "</div>" : "") +
        (tagHtml ? '<div class="tags">' + tagHtml + "</div>" : "") +
        '<div class="card__actions">' +
          '<button class="btn btnSmall" type="button" data-open="' + escapeHtml(v.id) + '">ดูคลิป</button>' +
          '<button class="btn btnSmall" type="button" data-share="' + escapeHtml(v.id) + '">แชร์</button>' +
          '<a class="btn btnSmall" href="' + driveViewUrl(escapeHtml(v.driveId)) + '" target="_blank" rel="noopener">เปิดใน Drive</a>' +
        "</div>";

      list.appendChild(card);
    });

    // Handlers
    Array.prototype.slice.call(list.querySelectorAll("[data-open]")).forEach(function (btn) {
      btn.onclick = function () { openVideo(btn.getAttribute("data-open")); };
    });
    Array.prototype.slice.call(list.querySelectorAll("[data-share]")).forEach(function (btn) {
      btn.onclick = function () { shareVideo(btn.getAttribute("data-share")); };
    });

    $("btnContinue").onclick = function () {
      if (!lastId) { alert("ยังไม่มีคลิปล่าสุดของหัวข้อนี้"); return; }
      openVideo(lastId);
    };

    $("btnShareTopic").onclick = function () { shareTopic(); };
  }

  // --------------------------
  // Video modal
  // --------------------------
  function openVideo(videoId) {
    var v = null;
    var vids = Array.isArray(state.data.videos) ? state.data.videos : [];
    for (var i = 0; i < vids.length; i++) if (vids[i].id === videoId) { v = vids[i]; break; }
    if (!v) return;

    state.currentVideoId = videoId;

    // Save last opened
    var p = loadProgress();
    p.lastByTopic = p.lastByTopic || {};
    p.lastByTopic[state.topic] = videoId;
    saveProgress(p);

    // Update URL
    setQuery({ topic: state.topic, v: videoId });

    $("videoTitle").textContent = v.title;
    $("videoMeta").textContent = (v.badge ? ("ป้าย: " + v.badge) : "");
    $("videoNote").textContent = v.note || "";

    $("player").src = drivePreviewUrl(v.driveId);
    $("btnOpenDrive").href = driveViewUrl(v.driveId);

    // Watched toggle label
    var watched = new Set((p.watched || []));
    $("btnToggleWatched").textContent = watched.has(videoId) ? "ยกเลิกเครื่องหมายดูแล้ว" : "ทำเครื่องหมายดูแล้ว";

    $("videoModal").classList.remove("hidden");

    $("btnToggleWatched").onclick = function () {
      var pp = loadProgress();
      var set = new Set(pp.watched || []);
      if (set.has(videoId)) set.delete(videoId);
      else set.add(videoId);
      pp.watched = Array.from(set);
      pp.lastByTopic = pp.lastByTopic || {};
      pp.lastByTopic[state.topic] = videoId;
      saveProgress(pp);
      render();
      $("btnToggleWatched").textContent = set.has(videoId) ? "ยกเลิกเครื่องหมายดูแล้ว" : "ทำเครื่องหมายดูแล้ว";
    };

    $("btnCopyLink").onclick = function () {
      var url = driveViewUrl(v.driveId);
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(url).then(function () {
          alert("คัดลอกลิงก์แล้ว");
        }).catch(function () {
          prompt("คัดลอกลิงก์นี้", url);
        });
      } else {
        prompt("คัดลอกลิงก์นี้", url);
      }
    };

    $("btnShareVideo").onclick = function () { shareVideo(videoId); };
  }

  function closeVideo() {
    $("videoModal").classList.add("hidden");
    $("player").src = ""; // stop audio
    setQuery({ topic: state.topic, v: null });
  }

  // --------------------------
  // Share
  // --------------------------
  async function shareTopic() {
    var cat = currentCategoryObj();
    var label = cat ? cat.label : state.topic;
    var link = liffDeepLink(state.topic, null);
    var text = "หัวข้อ: " + label + "\n" + link;

    var ok = await tryShareTargetPicker(text);
    if (ok) return;

    // Fallback: LINE URL scheme "Share with"
    window.location.href = shareUrl(text);
  }

  async function shareVideo(videoId) {
    var v = null;
    var vids = Array.isArray(state.data.videos) ? state.data.videos : [];
    for (var i = 0; i < vids.length; i++) if (vids[i].id === videoId) { v = vids[i]; break; }
    if (!v) return;

    var link = liffDeepLink(state.topic, videoId);
    var text = "แนะนำคลิป: " + v.title + "\n" + link;

    var ok = await tryShareTargetPicker(text);
    if (ok) return;

    window.location.href = shareUrl(text);
  }

  // --------------------------
  // Help modal + wiring
  // --------------------------
  function openHelp() { $("helpModal").classList.remove("hidden"); }
  function closeHelp() { $("helpModal").classList.add("hidden"); }

  function wireUi() {
    $("btnHelp").onclick = openHelp;
    $("helpClose").onclick = closeHelp;
    $("helpModal").onclick = function (e) { if (e.target && e.target.id === "helpModal") closeHelp(); };

    $("videoClose").onclick = closeVideo;
    $("videoModal").onclick = function (e) { if (e.target && e.target.id === "videoModal") closeVideo(); };

    $("searchInput").oninput = function (e) {
      state.q = e.target.value || "";
      render();
    };
  }

  // --------------------------
  // Boot
  // --------------------------
  async function loadData() {
    showStatus("");
    try {
      var res = await fetch(DATA_URL, { cache: "no-store" });
      if (!res.ok) throw new Error("HTTP " + res.status);
      var data = await res.json();

      // Basic validation
      if (!data || !Array.isArray(data.categories) || !Array.isArray(data.videos)) {
        throw new Error("Invalid data.json structure");
      }

      state.data = data;
      return true;
    } catch (e) {
      showStatus(
        "โหลดข้อมูลไม่สำเร็จ (data.json)\n" +
        "เช็คว่าไฟล์ data.json อยู่โฟลเดอร์ /docs และเปิดได้ที่ /data.json\n" +
        "รายละเอียด: " + (e && e.message ? e.message : "unknown")
      );
      return false;
    }
  }

  function pickInitialTopic() {
    var tp = getParam("topic");
    var cats = state.data.categories || [];
    if (!tp && cats.length) tp = cats[0].key;

    // Ensure exists
    var exists = false;
    for (var i = 0; i < cats.length; i++) if (cats[i].key === tp) { exists = true; break; }
    state.topic = exists ? tp : (cats[0] ? cats[0].key : "preop");
  }

  async function main() {
    wireUi();

    var ok = await loadData();
    if (!ok) return;

    pickInitialTopic();
    renderCategorySelect();

    // Init LIFF (optional)
    await initLiffMaybe();

    render();

    // Deep link open video
    var v = getParam("v");
    if (v) openVideo(v);
  }

  main();
})();
