function safeJsonParse(s, fallback) {
  try {
    // ถ้าเป็น null/ว่าง ให้คืนค่า fallback ทันที
    if (s === null || s === undefined || s === "") return fallback;

    const v = JSON.parse(s);
    // ถ้า parse ได้ null ให้ fallback (กันพัง)
    return (v === null || v === undefined) ? fallback : v;
  } catch {
    return fallback;
  }
}

function loadProgress() {
  // กันกรณีบางเครื่อง/บางโหมด block storage แล้ว throw error
  let raw = null;
  try {
    raw = localStorage.getItem("videoProgress");
  } catch {
    raw = null;
  }

  return safeJsonParse(raw, { watched: [], lastByTopic: {} });
}

function saveProgress(p) {
  try {
    localStorage.setItem("videoProgress", JSON.stringify(p));
  } catch {
    // ถ้าบันทึกไม่ได้ก็ไม่เป็นไร แค่จะจำ "ดูแล้ว" ไม่ได้ในเครื่องนั้น
  }
}
