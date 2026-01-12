const $ = (id) => document.getElementById(id);

const state = {
  data: null,
  topic: null,
  q: "",
  lastOpenedVideoId: null,
  currentVideoId: null
};

function safeJsonParse(s, fallback) {
  try { return JSON.parse(s); } catch { return fallback; }
}

function loadProgress() {
  return safeJsonParse(localStorage.getItem("videoProgress"), { watched: [], lastByTopic: {} });
}
function saveProgress(p) {
  localStorage.setItem("videoProgress", JSON.stringify(p));
}

function parseParam(name) {
  const u = new URL(window.location.href);
  const params = u.searchParams;

  // Normal query: ?topic=preop
  let val = params.get(name);
  if (val) return val;

  // LIFF sometimes adds liff.state
  const liffState = params.get("liff.state");
  if (liffState) {
    const normalized =
      liffState.startsWith("/") ? liffState :
      liffState.startsWith("?") ? ("/" + liffState) :
      ("/?" + liffState);

    const qs = normalized.split("?")[1] || "";
    const v = new URLSearchParams(qs).get(name);
    if (v) return v;
  }
  return null;
}

function getDrivePreviewUrl(driveId) {
  return `https://drive.google.com/file/d/${driveId}/preview`;
}
function getDriveViewUrl(driveId) {
  return `https://drive.google.com/file/d/${driveId}/view`;
}

function encodeOAId(oaLineId) {
  // Expect "@something". LINE doc recommends percent-encoding in UTF-8, so "@" -> "%40".
  // We'll just use encodeURIComponent which handles it.
  return encodeURIComponent(oaLineId);
}

function setTopActions() {
  const phone = state.data?.contacts?.nursePhone || "";
  $("btnCall").href = phone ? `tel:${phone}` : "#";

  const oa = state.data?.contacts?.oaLineId || "";
  const preset = state.data?.contacts?.presetChatText || "ขอปรึกษาอาการ/การดูแลค่ะ/ครับ";
  if (oa) {
    $("btnChat").href = `https://line.me/R/oaMessage/${encodeOAId(oa)}/?${encodeURIComponent(preset)}`;
  } else {
    $("btnChat").href = "#";
  }
}

function renderCategorySelect() {
  const sel = $("categorySelect");
  sel.innerHTML = "";

  (state.data.categories || []).forEach((c) => {
    const opt = document.createElement("option");
    opt.value = c.key;
    opt.textContent = `${c.emoji ? c.emoji + " " : ""}${c.label}`;
    sel.appendChild(opt);
  });

  sel.value = state.topic;
  sel.addEventListener("change", () => {
    state.topic = sel.value;
    const u = new URL(window.location.href);
    u.searchParams.set("topic", state.topic);
    u.searchParams.delete("v");
    history.replaceState({}, "", u.toString());
    render();
  });
}

function buildBadges(video, watchedSet) {
  const badges = [];
  if (video.mustWatch || video.featured || video.level === "must") {
    badges.push(`<span class="badge badge--must">ต้องดู</span>`);
  }
  if (watchedSet.has(video.id)) {
    badges.push(`<span class="badge badge--watched">ดูแล้ว</span>`);
  }
  if (video.badge && typeof video.badge === "string") {
    badges.push(`<span class="badge">${escapeHtml(video.badge)}</span>`);
  }
  return badges.join("");
}

function escapeHtml(s) {
  return String(s)
    .replaceAll("&","&amp;")
    .replaceAll("<","&lt;")
    .replaceAll(">","&gt;")
    .replaceAll('"',"&quot;")
    .replaceAll("'","&#39;");
}

function render() {
  const subtitle = $("subtitle");
  const topicLabel = (state.data.categories || []).find(c => c.key === state.topic)?.label || state.topic;
  subtitle.textContent = `หัวข้อ: ${topicLabel}`;

  const tip = $("tipBox");
  const topicTip = (state.data.categories || []).find(c => c.key === state.topic)?.tip;
  tip.textContent = topicTip || "ทิป: ถ้าคลิปเปิดไม่ได้ ให้เช็คว่าไฟล์ใน Google Drive ตั้งเป็น Anyone with the link → Viewer แล้ว";

  const progress = loadProgress();
  const watched = new Set(progress.watched || []);
  const lastByTopic = progress.lastByTopic || {};
  state.lastOpenedVideoId = lastByTopic[state.topic] || null;

  let videos = (state.data.videos || [])
    .filter(v => v.category === state.topic)
    .sort((a, b) => (a.order ?? 999) - (b.order ?? 999));

  if (state.q.trim()) {
    const q = state.q.trim().toLowerCase();
    videos = videos.filter(v => {
      const hay = (v.title + " " + (v.note || "") + " " + (v.tags || []).join(" ")).toLowerCase();
      return hay.includes(q);
    });
  }

  $("countLabel").textContent = `${videos.length} คลิป`;

  const list = $("videoList");
  list.innerHTML = "";

  videos.forEach(v => {
    const tags = (v.tags || []).slice(0, 4).map(t => `<span class="tag">${escapeHtml(t)}</span>`).join("");
    const metaParts = [];
    if (v.duration) metaParts.push(`⏱ ${escapeHtml(v.duration)}`);
    if ((v.tags || []).length) metaParts.push(tags);

    const card = document.createElement("div");
    card.className = "card";
    card.innerHTML = `
      <div class="card__top">
        <div class="card__title">${escapeHtml(v.title)}</div>
        <div class="badges">${buildBadges(v, watched)}</div>
      </div>
      ${v.note ? `<div class="card__note">${escapeHtml(v.note)}</div>` : ``}
      <div class="card__meta">${metaParts.join(" ")}</div>
      <div class="card__actions">
        <button class="btn btnSmall" data-open="${escapeHtml(v.id)}" type="button">ดูคลิป</button>
        <button class="btn btnSmall" data-share="${escapeHtml(v.id)}" type="button">แชร์</button>
        <a class="btn btnSmall" href="${getDriveViewUrl(escapeHtml(v.driveId))}" target="_blank" rel="noopener">เปิดใน Drive</a>
      </div>
    `;
    list.appendChild(card);
  });

  list.querySelectorAll("[data-open]").forEach(btn => {
    btn.addEventListener("click", () => openVideo(btn.getAttribute("data-open")));
  });
  list.querySelectorAll("[data-share]").forEach(btn => {
    btn.addEventListener("click", () => shareVideo(btn.getAttribute("data-share")));
  });

  $("btnContinue").onclick = () => {
    if (!state.lastOpenedVideoId) {
      alert("ยังไม่มีคลิปล่าสุดของหัวข้อนี้");
      return;
    }
    openVideo(state.lastOpenedVideoId);
  };

  $("btnShareTopic").onclick = () => shareTopic();
}

function openVideo(videoId) {
  const v = (state.data.videos || []).find(x => x.id === videoId);
  if (!v) return;

  state.currentVideoId = videoId;

  // Save last opened
  const progress = loadProgress();
  progress.lastByTopic = progress.lastByTopic || {};
  progress.lastByTopic[state.topic] = videoId;
  saveProgress(progress);

  // Update URL deep link
  const u = new URL(window.location.href);
  u.searchParams.set("topic", state.topic);
  u.searchParams.set("v", videoId);
  history.replaceState({}, "", u.toString());

  $("videoTitle").textContent = v.title;
  const meta = [];
  if (v.duration) meta.push(`⏱ ${v.duration}`);
  if ((v.tags || []).length) meta.push(`🏷 ${(v.tags || []).slice(0, 5).join(" · ")}`);
  $("videoMeta").textContent = meta.join("   ");

  $("videoNote").textContent = v.note || "";

  $("player").src = getDrivePreviewUrl(v.driveId);
  $("btnOpenDrive").href = getDriveViewUrl(v.driveId);

  $("videoModal").classList.remove("hidden");

  $("btnMarkWatched").onclick = () => {
    const p = loadProgress();
    p.watched = Array.from(new Set([...(p.watched || []), videoId]));
    p.lastByTopic = p.lastByTopic || {};
    p.lastByTopic[state.topic] = videoId;
    saveProgress(p);
    render();
    alert("บันทึกว่า ‘ดูแล้ว’ เรียบร้อย");
  };

  $("btnCopyLink").onclick = async () => {
    const url = getDriveViewUrl(v.driveId);
    try {
      await navigator.clipboard.writeText(url);
      alert("คัดลอกลิงก์แล้ว");
    } catch {
      prompt("คัดลอกลิงก์นี้", url);
    }
  };

  $("btnShareVideo").onclick = () => shareVideo(videoId);
}

function closeVideo() {
  $("videoModal").classList.add("hidden");
  $("player").src = "";
  const u = new URL(window.location.href);
  u.searchParams.delete("v");
  history.replaceState({}, "", u.toString());
}

function openHelp() {
  $("helpModal").classList.remove("hidden");
}
function closeHelp() {
  $("helpModal").classList.add("hidden");
}

$("videoClose").addEventListener("click", closeVideo);
$("videoModal").addEventListener("click", (e) => {
  if (e.target.id === "videoModal") closeVideo();
});
$("btnHelp").addEventListener("click", openHelp);
$("helpClose").addEventListener("click", closeHelp);
$("helpModal").addEventListener("click", (e) => {
  if (e.target.id === "helpModal") closeHelp();
});

async function ensureLiffReady() {
  if (!window.liff || !window.LIFF_ID || window.LIFF_ID.includes("PASTE_")) return false;
  try {
    await liff.init({ liffId: window.LIFF_ID });
    return true;
  } catch (e) {
    console.log("LIFF init failed (maybe external browser)", e);
    return false;
  }
}

async function shareWithLiff(text) {
  // shareTargetPicker requires login and LINE app version >= 10.3.0 on mobile.
  if (!window.liff) return false;
  if (!liff.isApiAvailable || !liff.isApiAvailable("shareTargetPicker")) return false;

  try {
    if (!liff.isLoggedIn && typeof liff.isLoggedIn === "function" && !liff.isLoggedIn()) {
      // If opened in external browser, user might need login first
      liff.login({ redirectUri: window.location.href });
      return true; // will redirect
    }
  } catch (e) {}

  try {
    await liff.shareTargetPicker([{ type: "text", text }]);
    return true;
  } catch (e) {
    console.log(e);
    return false;
  }
}

async function getShareLink(extraParams = {}) {
  // Best effort: use permanentLink if available, else current URL
  const u = new URL(window.location.href);
  Object.entries(extraParams).forEach(([k,v]) => {
    if (v === null || v === undefined) u.searchParams.delete(k);
    else u.searchParams.set(k, String(v));
  });

  if (window.liff && liff.permanentLink && liff.permanentLink.createUrlBy) {
    try {
      return await liff.permanentLink.createUrlBy(u.toString());
    } catch (e) {
      console.log("permanentLink failed, fallback to normal URL", e);
    }
  }
  return u.toString();
}

async function shareTopic() {
  const topicLabel = (state.data.categories || []).find(c => c.key === state.topic)?.label || state.topic;
  const link = await getShareLink({ topic: state.topic, v: null });
  const text = `หัวข้อ: ${topicLabel}\n${link}`;
  const ok = await shareWithLiff(text);
  if (ok) return;

  // fallback: LINE URL scheme share (opens share sheet in LINE if available)
  // This works even without LIFF in many cases.
  const url = `https://line.me/R/share?text=${encodeURIComponent(text)}`;
  try {
    window.location.href = url;
  } catch {
    // final fallback: copy
    try { await navigator.clipboard.writeText(text); alert("คัดลอกข้อความให้แล้ว"); }
    catch { prompt("คัดลอกข้อความนี้", text); }
  }
}

async function shareVideo(videoId) {
  const v = (state.data.videos || []).find(x => x.id === videoId);
  if (!v) return;

  const link = await getShareLink({ topic: state.topic, v: videoId });
  const text = `แนะนำคลิป: ${v.title}\n${link}`;

  const ok = await shareWithLiff(text);
  if (ok) return;

  const url = `https://line.me/R/share?text=${encodeURIComponent(text)}`;
  try {
    window.location.href = url;
  } catch {
    try { await navigator.clipboard.writeText(text); alert("คัดลอกข้อความให้แล้ว"); }
    catch { prompt("คัดลอกข้อความนี้", text); }
  }
}

async function main() {
  // Load data
  const res = await fetch("data.json", { cache: "no-store" });
  state.data = await res.json();

  $("appTitle").textContent = state.data.appTitle || "คลังคลิปดูแลผู้ป่วย";

  // Topic from URL (default first category)
  const topicParam = parseParam("topic");
  state.topic = topicParam || (state.data.categories?.[0]?.key ?? "preop");

  // Init LIFF (optional; app still works in normal browser)
  await ensureLiffReady();

  setTopActions();
  renderCategorySelect();

  $("searchInput").addEventListener("input", (e) => {
    state.q = e.target.value;
    render();
  });

  render();

  // Deep link open video if v=...
  const vParam = parseParam("v");
  if (vParam) openVideo(vParam);
}

main();
