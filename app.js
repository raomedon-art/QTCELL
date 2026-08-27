const KEYS = {
  session: "malsseumgyeol.private.session.v1",
  records: "malsseumgyeol.private.records.v1",
  rememberedName: "malsseumgyeol.private.remembered-name.v1",
  members: "malsseumgyeol.private.members.v1",
  adminPassword: "malsseumgyeol.private.admin-password.v1",
};

// Publishable keys are designed for browser use. Keeping a built-in fallback means
// replacing the static site files cannot accidentally switch the site back to
// device-only storage when cloud-config.js is omitted or left blank.
const DEFAULT_CLOUD_CONFIG = Object.freeze({
  supabaseUrl: "https://pevpdhrjlmdpgbilquwe.supabase.co",
  supabaseAnonKey: "sb_publishable_jKkqBIEpTjMGMxObZttP-g_FheNzmHO",
  bucket: "qtcell-files",
});
const pageCloudConfig = window.QTCELL_CLOUD || {};
const CLOUD_CONFIG = Object.freeze({
  supabaseUrl: String(pageCloudConfig.supabaseUrl || DEFAULT_CLOUD_CONFIG.supabaseUrl).trim(),
  supabaseAnonKey: String(pageCloudConfig.supabaseAnonKey || DEFAULT_CLOUD_CONFIG.supabaseAnonKey).trim(),
  bucket: String(pageCloudConfig.bucket || DEFAULT_CLOUD_CONFIG.bucket).trim(),
});
const CLOUD_TABLES = { records: "qtcell_records", members: "qtcell_members" };
const cloudEnabled = Boolean(
  window.supabase?.createClient
  && /^https:\/\/.+\.supabase\.co$/i.test(String(CLOUD_CONFIG.supabaseUrl || "").trim())
  && String(CLOUD_CONFIG.supabaseAnonKey || "").trim()
);
const cloudClient = cloudEnabled
  ? window.supabase.createClient(CLOUD_CONFIG.supabaseUrl.trim(), CLOUD_CONFIG.supabaseAnonKey.trim())
  : null;
const cloudBucket = String(CLOUD_CONFIG.bucket || "qtcell-files");
const cloudMigrationKey = `${KEYS.records}.migrated:${String(CLOUD_CONFIG.supabaseUrl || "local")}`;

const DEFAULT_MEMBERS = [
  { id: "member-kim-gyeongrae", name: "김경래", role: "admin", createdAt: "2026-08-14T00:00:00.000Z" },
];

const MEMBER_ROLE_LABELS = { member: "일반 멤버", admin: "관리자" };

const VISIBILITY_LABELS = {
  church: "교회 전체",
  leaders: "리더 모임",
  youth: "청년부",
  smallgroup: "우리 소그룹",
};

const loginScreen = document.querySelector("#login-screen");
const appShell = document.querySelector("#app-shell");
const loginForm = document.querySelector("#login-form");
const uploadForm = document.querySelector("#upload-form");
const recordList = document.querySelector("#record-list");
const searchInput = document.querySelector("#search-input");
const searchScope = document.querySelector("#search-scope");
const sortOrder = document.querySelector("#sort-order");
const resultCount = document.querySelector("#result-count");
const toast = document.querySelector("#toast");
const fileInput = document.querySelector("#file-input");
const submitWithoutFileButton = document.querySelector("#submit-without-file");
const selectedFile = document.querySelector("#selected-file");
const dropZone = document.querySelector("#drop-zone");
const richEditor = document.querySelector("#rich-editor");
const editorToolbar = document.querySelector("#editor-toolbar");
const editorImageInput = document.querySelector("#editor-image-input");
const insertEditorImageButton = document.querySelector("#insert-editor-image");
const detailSummary = document.querySelector("#detail-summary");
const detailEditForm = document.querySelector("#detail-edit-form");
const detailEditButton = document.querySelector("#detail-edit-button");
const detailDeleteButton = document.querySelector("#detail-delete-button");
const detailDownloadButton = document.querySelector("#detail-download-button");
const detailEditDate = document.querySelector("#detail-edit-date");
const detailEditPassage = document.querySelector("#detail-edit-passage");
const detailEditFile = document.querySelector("#detail-edit-file");
const detailRichEditor = document.querySelector("#detail-rich-editor");
const detailEditorToolbar = document.querySelector("#detail-editor-toolbar");
const detailEditorImageInput = document.querySelector("#detail-editor-image-input");
const detailInsertEditorImageButton = document.querySelector("#detail-insert-editor-image");
const deleteRecordDialog = document.querySelector("#delete-record-dialog");
const deleteRecordForm = document.querySelector("#delete-record-form");
const memberForm = document.querySelector("#member-form");
const memberList = document.querySelector("#member-list");
const adminPasswordDialog = document.querySelector("#admin-password-dialog");
const adminAccessForm = document.querySelector("#admin-access-form");
const adminAccessPassword = document.querySelector("#admin-access-password");
const adminPasswordError = document.querySelector("#admin-password-error");
const backToTopButton = document.querySelector("#back-to-top");
const cloudSyncStatus = document.querySelector("#cloud-sync-status");
const migrateCloudDataButton = document.querySelector("#migrate-cloud-data");
const syncIndicator = document.querySelector("#sync-indicator");
const syncStatusText = document.querySelector("#sync-status-text");
const syncRefreshButton = document.querySelector("#sync-refresh-button");

let session = readJson(sessionStorage, KEYS.session, null);
const localRecordsAtStartup = readJson(localStorage, KEYS.records, []);
const localMembersAtStartup = readJson(localStorage, KEYS.members, DEFAULT_MEMBERS);
const hasLocalSnapshotAtStartup = localStorage.getItem(KEYS.records) !== null
  || localStorage.getItem(KEYS.members) !== null;
let records = Array.isArray(localRecordsAtStartup) ? [...localRecordsAtStartup] : [];
let members = Array.isArray(localMembersAtStartup) ? [...localMembersAtStartup] : [...DEFAULT_MEMBERS];
let toastTimer;
let adminUnlocked = false;
let protectedViewTarget = "admin";
let protectedActionTarget = null;
let savedEditorRange = null;
let activeEditor = richEditor;
let currentDetailRecordId = null;
let pendingDeleteRecordId = null;
let cloudRefreshPromise = null;
let uploadFormDirty = false;

if (!Array.isArray(members) || !members.length) members = [...DEFAULT_MEMBERS];
if (!localStorage.getItem(KEYS.members)) writeJson(localStorage, KEYS.members, members);

function readJson(storage, key, fallback) {
  try {
    const value = storage.getItem(key);
    return value ? JSON.parse(value) : fallback;
  } catch {
    return fallback;
  }
}

function writeJson(storage, key, value) {
  storage.setItem(key, JSON.stringify(value));
}

function setRecordContentHtml(record, contentHtml = "") {
  if (cloudEnabled) {
    record.contentHtml = contentHtml;
    return;
  }
  Object.defineProperty(record, "contentHtml", {
    value: contentHtml,
    configurable: true,
    enumerable: false,
    writable: true,
  });
}

function escapeHtml(value = "") {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function sanitizeEditorHtml(html = "") {
  const template = document.createElement("template");
  template.innerHTML = String(html);
  template.content.querySelectorAll("script, style, iframe, object, embed, link, meta, form, input, button, textarea, select, video, audio").forEach((element) => element.remove());
  const commentWalker = document.createTreeWalker(template.content, NodeFilter.SHOW_COMMENT);
  const comments = [];
  while (commentWalker.nextNode()) comments.push(commentWalker.currentNode);
  comments.forEach((comment) => comment.remove());

  const allowedTags = new Set([
    "P", "DIV", "BR", "STRONG", "B", "I", "EM", "U", "S", "UL", "OL", "LI", "BLOCKQUOTE",
    "H1", "H2", "H3", "H4", "H5", "H6", "IMG", "A", "SPAN", "FONT", "HR", "FIGURE", "FIGCAPTION",
    "TABLE", "THEAD", "TBODY", "TFOOT", "TR", "TH", "TD", "CAPTION", "COLGROUP", "COL",
    "SVG", "G", "PATH", "RECT", "CIRCLE", "ELLIPSE", "LINE", "POLYLINE", "POLYGON", "TEXT", "TSPAN",
  ]);
  const styleProperties = [
    "color", "background-color", "background-image", "background-size", "background-position", "background-repeat",
    "font-family", "font-size", "font-weight", "font-style", "line-height",
    "letter-spacing", "text-align", "text-decoration", "vertical-align", "white-space", "list-style-type",
    "border", "border-top", "border-right", "border-bottom", "border-left", "border-color", "border-style",
    "border-width", "border-collapse", "border-spacing", "border-radius", "padding", "padding-top", "padding-right",
    "padding-bottom", "padding-left", "margin", "margin-top", "margin-right", "margin-bottom", "margin-left",
    "width", "min-width", "max-width", "height", "min-height", "max-height", "object-fit", "float",
  ];
  const tagAttributes = {
    A: new Set(["href", "target", "title"]),
    IMG: new Set(["src", "alt", "width", "height", "title"]),
    TABLE: new Set(["width", "height", "cellpadding", "cellspacing"]),
    TD: new Set(["colspan", "rowspan", "scope", "width", "height"]),
    TH: new Set(["colspan", "rowspan", "scope", "width", "height"]),
    COL: new Set(["span", "width"]),
    OL: new Set(["start", "type"]),
    LI: new Set(["value"]),
    FONT: new Set(["face", "size", "color"]),
    SVG: new Set(["viewbox", "width", "height", "xmlns", "fill", "stroke"]),
    G: new Set(["fill", "stroke", "stroke-width", "transform", "opacity"]),
    PATH: new Set(["d", "fill", "stroke", "stroke-width", "transform", "opacity"]),
    RECT: new Set(["x", "y", "width", "height", "rx", "ry", "fill", "stroke", "stroke-width", "transform", "opacity"]),
    CIRCLE: new Set(["cx", "cy", "r", "fill", "stroke", "stroke-width", "transform", "opacity"]),
    ELLIPSE: new Set(["cx", "cy", "rx", "ry", "fill", "stroke", "stroke-width", "transform", "opacity"]),
    LINE: new Set(["x1", "y1", "x2", "y2", "stroke", "stroke-width", "transform", "opacity"]),
    POLYLINE: new Set(["points", "fill", "stroke", "stroke-width", "transform", "opacity"]),
    POLYGON: new Set(["points", "fill", "stroke", "stroke-width", "transform", "opacity"]),
    TEXT: new Set(["x", "y", "dx", "dy", "fill", "stroke", "font-size", "font-family", "text-anchor", "transform", "opacity"]),
    TSPAN: new Set(["x", "y", "dx", "dy", "fill", "font-size", "font-family", "text-anchor"]),
  };
  [...template.content.querySelectorAll("*")].forEach((element) => {
    const tagName = element.tagName.toUpperCase();
    if (!allowedTags.has(tagName)) {
      element.replaceWith(...element.childNodes);
      return;
    }
    const safeStyles = styleProperties.flatMap((property) => {
      const value = element.style.getPropertyValue(property).trim();
      if (!value || /(?:javascript:|expression\s*\()/i.test(value) || !CSS.supports(property, value)) return [];
      if (/url\s*\(/i.test(value)) {
        const safeBackground = property === "background-image"
          && /^url\(["']?(?:https?:\/\/|data:image\/(?:png|jpe?g|gif|webp|bmp|avif);base64,)/i.test(value);
        if (!safeBackground || value.length > 36 * 1024 * 1024) return [];
      }
      return [[property, value, element.style.getPropertyPriority(property)]];
    });
    const allowedAttributes = tagAttributes[tagName] || new Set();
    [...element.attributes].forEach((attribute) => {
      if (!allowedAttributes.has(attribute.name.toLowerCase())) element.removeAttribute(attribute.name);
    });
    element.removeAttribute("style");
    safeStyles.forEach(([property, value, priority]) => element.style.setProperty(property, value, priority));

    if (["TD", "TH"].includes(tagName)) {
      ["colspan", "rowspan"].forEach((attribute) => {
        const value = element.getAttribute(attribute);
        if (value && (!/^\d{1,3}$/.test(value) || Number(value) < 1)) element.removeAttribute(attribute);
      });
    }
    if (tagName === "IMG") {
      const src = element.getAttribute("src") || "";
      const isSafeImage = /^(?:https?:\/\/|data:image\/(?:png|jpe?g|gif|webp|bmp|svg\+xml|avif);base64,)/i.test(src);
      if (!isSafeImage || src.length > 36 * 1024 * 1024) element.remove();
    }
    if (tagName === "A") {
      if (!/^(https?:\/\/|mailto:)/i.test(element.getAttribute("href") || "")) element.removeAttribute("href");
      if (!["_blank", "_self"].includes(element.getAttribute("target") || "")) element.removeAttribute("target");
      if (element.getAttribute("target") === "_blank") element.setAttribute("rel", "noopener noreferrer");
    }
    if (tagName === "FONT") {
      if (!/^[1-7]$/.test(element.getAttribute("size") || "")) element.removeAttribute("size");
      if (!CSS.supports("color", element.getAttribute("color") || "")) element.removeAttribute("color");
    }
    if (["SVG", "G", "PATH", "RECT", "CIRCLE", "ELLIPSE", "LINE", "POLYLINE", "POLYGON", "TEXT", "TSPAN"].includes(tagName)) {
      [...element.attributes].forEach((attribute) => {
        if (/(?:javascript:|data:|https?:|url\s*\()/i.test(attribute.value)) element.removeAttribute(attribute.name);
      });
    }
  });
  return template.innerHTML;
}

function showToast(message) {
  clearTimeout(toastTimer);
  toast.textContent = message;
  toast.classList.add("is-visible");
  toastTimer = setTimeout(() => toast.classList.remove("is-visible"), 2600);
}

function setButtonBusy(button, isBusy, busyLabel = "처리 중…") {
  if (!button) return;
  if (isBusy) {
    button.dataset.idleHtml = button.innerHTML;
    button.textContent = busyLabel;
    button.disabled = true;
    button.setAttribute("aria-busy", "true");
    return;
  }
  if (button.dataset.idleHtml) button.innerHTML = button.dataset.idleHtml;
  delete button.dataset.idleHtml;
  button.disabled = false;
  button.removeAttribute("aria-busy");
}

function syncTimeLabel(date = new Date()) {
  return new Intl.DateTimeFormat("ko-KR", { hour: "2-digit", minute: "2-digit" }).format(date);
}

function setSyncState(state, message) {
  if (!syncIndicator || !syncStatusText || !syncRefreshButton) return;
  syncIndicator.dataset.state = state;
  syncStatusText.textContent = message;
  const refreshing = state === "syncing";
  syncRefreshButton.disabled = refreshing || !cloudEnabled || !navigator.onLine;
  syncRefreshButton.setAttribute("aria-busy", String(refreshing));
}

function cloudErrorMessage(error) {
  const code = String(error?.code || "");
  const message = String(error?.message || "");
  if (code === "PGRST205" || /qtcell_records|schema cache/i.test(message)) return "공유 테이블 설정 필요";
  if (/401|403|JWT|API key/i.test(`${code} ${message}`)) return "공유 저장소 권한 오류";
  return "동기화 연결 오류";
}

async function refreshCloudData({ announce = false } = {}) {
  if (!cloudEnabled) {
    setSyncState("local", "이 기기에 저장 중");
    return false;
  }
  if (!navigator.onLine) {
    setSyncState("offline", "오프라인");
    return false;
  }
  if (cloudRefreshPromise) return cloudRefreshPromise;

  recordList.setAttribute("aria-busy", "true");
  setSyncState("syncing", "동기화 중…");
  cloudRefreshPromise = (async () => {
    try {
      await loadCloudState();
      renderRecords();
      renderMembers();
      updateCloudSyncPanel();
      setSyncState("synced", `동기화됨 · ${syncTimeLabel()}`);
      if (announce) showToast("최신 공유 자료를 불러왔습니다.");
      return true;
    } catch (error) {
      console.error("Cloud refresh failed", error?.message || error, error);
      setSyncState("error", cloudErrorMessage(error));
      if (announce) showToast("공유 자료를 불러오지 못했습니다. 잠시 후 다시 시도해주세요.");
      return false;
    } finally {
      recordList.setAttribute("aria-busy", "false");
      cloudRefreshPromise = null;
    }
  })();
  return cloudRefreshPromise;
}

function updateBackToTopVisibility() {
  backToTopButton.hidden = window.scrollY < 320 || appShell.hidden;
}

function hasUploadPermission() {
  return session?.role === "admin";
}

function getAdminPassword() {
  return localStorage.getItem(KEYS.adminPassword) || "1004";
}

function applyRoleVisibility() {
  document.querySelectorAll(".admin-only").forEach((element) => {
    element.hidden = !hasUploadPermission();
  });
}

function enterApp() {
  if (!session) return;
  const registeredMember = members.find((member) => member.name === session.name);
  if (!registeredMember) {
    leaveApp();
    showToast("등록되지 않은 이름입니다. 관리자에게 등록을 요청해주세요.");
    return;
  }
  session = { name: registeredMember.name, role: registeredMember.role };
  writeJson(sessionStorage, KEYS.session, session);
  loginScreen.hidden = true;
  appShell.hidden = false;
  document.querySelector("#user-name").textContent = session.name;
  document.querySelector("#user-initial").textContent = session.name.slice(0, 1);
  applyRoleVisibility();
  switchView("library");
  renderRecords();
  renderMembers();
}

function leaveApp() {
  sessionStorage.removeItem(KEYS.session);
  session = null;
  adminUnlocked = false;
  appShell.hidden = true;
  loginScreen.hidden = false;
  loginForm.reset();
  restoreRememberedName();
  history.replaceState(null, "", "#");
}

function login(name, role) {
  session = { name: name.trim() || "체험 사용자", role };
  writeJson(sessionStorage, KEYS.session, session);
  enterApp();
  showToast(`${session.name}님, 안전한 자료실에 입장했어요.`);
}

function restoreRememberedName() {
  const rememberedName = localStorage.getItem(KEYS.rememberedName) || "";
  loginForm.elements.name.value = rememberedName;
  loginForm.elements.rememberName.checked = Boolean(rememberedName);
}

function switchView(viewName) {
  if (viewName === "upload" && !hasUploadPermission()) {
    showToast("자료 등록은 관리자만 할 수 있어요.");
    viewName = "library";
  }
  if (viewName === "admin" && !hasUploadPermission()) {
    showToast("관리자만 이용할 수 있는 페이지입니다.");
    viewName = "library";
  }
  if (["admin", "upload"].includes(viewName) && !adminUnlocked) return;
  if (!["admin", "upload"].includes(viewName)) adminUnlocked = false;
  document.querySelectorAll("[data-view]").forEach((view) => {
    view.classList.toggle("is-active", view.dataset.view === viewName);
  });
  document.querySelectorAll("[data-view-link]").forEach((button) => {
    button.classList.toggle("is-active", button.dataset.viewLink === viewName);
  });
  history.replaceState(null, "", `#${viewName}`);
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function openDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open("malsseumgyeol-private-files", 1);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains("files")) database.createObjectStore("files", { keyPath: "id" });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function saveLocalAsset(id, file, contentHtml = "") {
  const database = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction("files", "readwrite");
    transaction.objectStore("files").put({ id, file, contentHtml });
    transaction.oncomplete = () => { database.close(); resolve(); };
    transaction.onerror = () => { database.close(); reject(transaction.error); };
  });
}

async function getLocalRecordAsset(id) {
  const database = await openDatabase();
  return new Promise((resolve, reject) => {
    const request = database.transaction("files", "readonly").objectStore("files").get(id);
    request.onsuccess = () => { database.close(); resolve(request.result || null); };
    request.onerror = () => { database.close(); reject(request.error); };
  });
}

async function getLocalFile(id) {
  const asset = await getLocalRecordAsset(id);
  return asset?.file || null;
}

async function removeLocalAsset(id) {
  const database = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction("files", "readwrite");
    transaction.objectStore("files").delete(id);
    transaction.oncomplete = () => { database.close(); resolve(); };
    transaction.onerror = () => { database.close(); reject(transaction.error); };
  });
}

function cloudRecordFromRow(row) {
  return {
    id: row.id,
    title: row.title || "",
    meetingDate: row.meeting_date || "",
    speaker: row.speaker || "",
    passage: row.passage || "",
    visibility: row.visibility || "church",
    summary: row.summary || "",
    contentHtml: row.content_html || "",
    fileName: row.file_name || "",
    fileType: row.file_type || "",
    fileSize: Number(row.file_size) || 0,
    filePath: row.file_path || "",
    owner: row.owner || "",
    createdAt: row.created_at,
    viewCount: Math.max(0, Number(row.view_count) || 0),
  };
}

function cloudRecordToRow(record, contentHtml = record.contentHtml || "") {
  return {
    id: record.id,
    title: record.title || "",
    meeting_date: record.meetingDate || null,
    speaker: record.speaker || "",
    passage: record.passage || "",
    visibility: record.visibility || "church",
    summary: record.summary || "",
    content_html: contentHtml || "",
    file_name: record.fileName || null,
    file_type: record.fileType || null,
    file_size: Number(record.fileSize) || null,
    file_path: record.filePath || null,
    owner: record.owner || "",
    created_at: record.createdAt || new Date().toISOString(),
    view_count: Math.max(0, Number(record.viewCount) || 0),
  };
}

function cloudMemberFromRow(row) {
  return {
    id: row.id,
    name: row.name,
    role: row.role === "admin" ? "admin" : "member",
    createdAt: row.created_at,
  };
}

function cloudMemberToRow(member) {
  return {
    id: member.id,
    name: member.name,
    role: member.role === "admin" ? "admin" : "member",
    created_at: member.createdAt || new Date().toISOString(),
  };
}

function cloudFilePath(recordId, filename = "") {
  const extension = filename.includes(".")
    ? filename.split(".").pop().toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 10)
    : "";
  return `${recordId}/attachment${extension ? `.${extension}` : ""}`;
}

function updateCloudSyncPanel(message = "") {
  if (!cloudSyncStatus || !migrateCloudDataButton) return;
  if (!cloudEnabled) {
    cloudSyncStatus.textContent = "현재 브라우저에만 저장됩니다. cloud-config.js를 설정하면 여러 기기에서 함께 볼 수 있습니다.";
    migrateCloudDataButton.hidden = true;
    return;
  }
  cloudSyncStatus.textContent = message || "공유 저장소에 연결되었습니다. 새 자료는 모든 기기에 동기화됩니다.";
  const migrationDone = localStorage.getItem(cloudMigrationKey) === "done";
  migrateCloudDataButton.hidden = migrationDone || !hasLocalSnapshotAtStartup;
}

async function loadCloudState() {
  const [recordResult, memberResult] = await Promise.all([
    cloudClient.from(CLOUD_TABLES.records).select("*").order("created_at", { ascending: false }),
    cloudClient.from(CLOUD_TABLES.members).select("*").order("created_at", { ascending: true }),
  ]);
  if (recordResult.error) throw recordResult.error;
  if (memberResult.error) throw memberResult.error;
  records = (recordResult.data || []).map(cloudRecordFromRow);
  members = (memberResult.data || []).map(cloudMemberFromRow);
  if (!members.length) members = [...DEFAULT_MEMBERS];
  // This is a recovery cache, not the source of truth. Supabase remains the
  // shared store, while the cache keeps the latest list visible during a brief
  // connection failure or immediately after static files are replaced.
  writeJson(localStorage, KEYS.records, records);
  writeJson(localStorage, KEYS.members, members);
}

async function saveCloudRecord(record, file, contentHtml = "") {
  const previousPath = record.filePath || "";
  let nextPath = previousPath;
  if (file) {
    nextPath = cloudFilePath(record.id, file.name);
    const uploadResult = await cloudClient.storage.from(cloudBucket).upload(nextPath, file, {
      cacheControl: "3600",
      contentType: file.type || undefined,
      upsert: true,
    });
    if (uploadResult.error) throw uploadResult.error;
  }

  const nextRecord = { ...record, contentHtml, filePath: nextPath };
  const saveResult = await cloudClient.from(CLOUD_TABLES.records).upsert(cloudRecordToRow(nextRecord, contentHtml));
  if (saveResult.error) throw saveResult.error;
  Object.assign(record, nextRecord);

  if (file && previousPath && previousPath !== nextPath) {
    await cloudClient.storage.from(cloudBucket).remove([previousPath]);
  }
}

async function saveRecordData(record, file, contentHtml = "", { isNew = false } = {}) {
  if (cloudEnabled) {
    await saveCloudRecord(record, file, contentHtml);
  } else {
    await saveLocalAsset(record.id, file, contentHtml);
    setRecordContentHtml(record, contentHtml);
  }
  if (isNew && !records.some((item) => item.id === record.id)) records.unshift(record);
  writeJson(localStorage, KEYS.records, records);
}

async function getRecordAsset(id) {
  const record = records.find((item) => item.id === id);
  if (!cloudEnabled) {
    const localAsset = await getLocalRecordAsset(id);
    if (localAsset?.contentHtml || !record?.contentHtml) return localAsset;
    return { ...(localAsset || { id, file: null }), contentHtml: record.contentHtml };
  }
  return record ? { id, file: null, contentHtml: record.contentHtml || "" } : null;
}

async function getFile(id) {
  if (!cloudEnabled) return getLocalFile(id);
  const record = records.find((item) => item.id === id);
  if (!record?.filePath) return null;
  const downloadResult = await cloudClient.storage.from(cloudBucket).download(record.filePath);
  if (downloadResult.error) throw downloadResult.error;
  return new File([downloadResult.data], record.fileName || "묵상-자료", { type: record.fileType || downloadResult.data.type });
}

async function removeRecordData(record) {
  if (!cloudEnabled) {
    await removeLocalAsset(record.id);
    records = records.filter((item) => item.id !== record.id);
    writeJson(localStorage, KEYS.records, records);
    return;
  }
  const deleteResult = await cloudClient.from(CLOUD_TABLES.records).delete().eq("id", record.id);
  if (deleteResult.error) throw deleteResult.error;
  records = records.filter((item) => item.id !== record.id);
  writeJson(localStorage, KEYS.records, records);
  if (record.filePath) await cloudClient.storage.from(cloudBucket).remove([record.filePath]);
}

async function persistViewCount(record) {
  if (!cloudEnabled) {
    writeJson(localStorage, KEYS.records, records);
    return;
  }
  const result = await cloudClient.rpc("increment_qtcell_view_count", { p_record_id: record.id });
  if (result.error) throw result.error;
  if (Number.isFinite(Number(result.data))) record.viewCount = Number(result.data);
  writeJson(localStorage, KEYS.records, records);
}

async function addMemberData(member) {
  if (cloudEnabled) {
    const result = await cloudClient.from(CLOUD_TABLES.members).insert(cloudMemberToRow(member));
    if (result.error) throw result.error;
  }
  members.push(member);
  writeJson(localStorage, KEYS.members, members);
}

async function migrateLocalDataToCloud({ silent = false } = {}) {
  if (!cloudEnabled) return;
  if (!silent) {
    setButtonBusy(migrateCloudDataButton, true, "자료 이전 중…");
    updateCloudSyncPanel("기존 자료와 첨부 파일을 공유 저장소로 옮기는 중입니다…");
  }
  try {
    const [existingMemberResult, existingRecordResult] = await Promise.all([
      cloudClient.from(CLOUD_TABLES.members).select("name"),
      cloudClient.from(CLOUD_TABLES.records).select("id"),
    ]);
    if (existingMemberResult.error) throw existingMemberResult.error;
    if (existingRecordResult.error) throw existingRecordResult.error;

    if (localMembersAtStartup.length) {
      const existingMemberNames = new Set(
        (existingMemberResult.data || []).map((member) => String(member.name || "").trim()),
      );
      const newMembers = localMembersAtStartup
        .filter((member) => !existingMemberNames.has(String(member.name || "").trim()))
        .map(cloudMemberToRow);

      if (newMembers.length) {
        const memberResult = await cloudClient
          .from(CLOUD_TABLES.members)
          .insert(newMembers);
        if (memberResult.error) throw memberResult.error;
      }
    }

    const existingRecordIds = new Set((existingRecordResult.data || []).map((record) => record.id));
    const missingLocalRecords = localRecordsAtStartup.filter((record) => !existingRecordIds.has(record.id));
    for (const localRecord of missingLocalRecords) {
      const asset = await getLocalRecordAsset(localRecord.id);
      await saveCloudRecord({ ...localRecord }, asset?.file || null, asset?.contentHtml || localRecord.contentHtml || "");
    }
    await loadCloudState();
    renderRecords();
    renderMembers();
    localStorage.setItem(cloudMigrationKey, "done");
    migrateCloudDataButton.hidden = true;
    updateCloudSyncPanel("이 브라우저의 기존 자료까지 공유 저장소로 옮겼습니다.");
    setSyncState("synced", `동기화됨 · ${syncTimeLabel()}`);
    if (!silent && missingLocalRecords.length) showToast("기존 자료를 공유 저장소로 옮겼습니다.");
    return true;
  } catch (error) {
    console.error("Cloud migration failed", error?.message || error, error);
    if (!silent) {
      updateCloudSyncPanel("자료 이전에 실패했습니다. Supabase 설정과 정책을 확인해주세요.");
      showToast("자료 이전에 실패했습니다. 설정을 확인해주세요.");
    }
    return false;
  } finally {
    if (!silent) setButtonBusy(migrateCloudDataButton, false);
  }
}

function fileExtension(filename) {
  return filename.includes(".") ? filename.split(".").pop().toUpperCase().slice(0, 5) : "FILE";
}

function formatSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDate(value) {
  if (!value) return "일시 미지정";
  const dateOnly = value.slice(0, 10);
  return new Intl.DateTimeFormat("ko-KR", { year: "numeric", month: "long", day: "numeric" }).format(new Date(`${dateOnly}T12:00:00`));
}

function formatUploadedDate(record) {
  if (record.createdAt) {
    return new Intl.DateTimeFormat("ko-KR", { year: "numeric", month: "long", day: "numeric" }).format(new Date(record.createdAt));
  }
  return formatDate(record.meetingDate);
}

function formatMeditationRange(record) {
  return `${formatDate(record.meetingDate)} · ${record.passage || "범위 미지정"}`;
}

function isNewRecord(record) {
  if (!record.createdAt) return false;
  const age = Date.now() - new Date(record.createdAt).getTime();
  return Number.isFinite(age) && age >= 0 && age < 48 * 60 * 60 * 1000;
}

function canDelete(record) {
  return session?.role === "admin" || (session?.role === "uploader" && record.owner === session.name);
}

function compareRecordsByUploadOrder(left, right) {
  const leftTime = new Date(left.createdAt || 0).getTime();
  const rightTime = new Date(right.createdAt || 0).getTime();
  const safeLeftTime = Number.isFinite(leftTime) ? leftTime : 0;
  const safeRightTime = Number.isFinite(rightTime) ? rightTime : 0;
  if (safeLeftTime !== safeRightTime) return safeLeftTime - safeRightTime;
  return String(left.id || "").localeCompare(String(right.id || ""));
}

function createRecordSequenceMap() {
  const orderedRecords = [...records].sort(compareRecordsByUploadOrder);

  return new Map(orderedRecords.map((record, index) => [record.id, index + 1]));
}

function recordCard(record, sequenceNumber) {
  const viewCount = Math.max(0, Number(record.viewCount) || 0);
  const newBadge = isNewRecord(record) ? `<span class="record-new-badge">NEW</span>` : "";
  return `
    <article class="record-card" data-record-id="${escapeHtml(record.id)}" role="button" tabindex="0" aria-label="${escapeHtml(formatMeditationRange(record))} 상세 보기">
      <div class="record-cell record-index" data-label="구분">${String(sequenceNumber).padStart(2, "0")}</div>
      <div class="record-cell record-date" data-label="올린 날짜">${escapeHtml(formatUploadedDate(record))}</div>
      <div class="record-cell record-passage" data-label="묵상일시 및 범위">${escapeHtml(formatMeditationRange(record))}</div>
      <div class="record-cell record-owner" data-label="등록자">${escapeHtml(record.owner || "관리자")}</div>
      <div class="record-cell record-status" data-label="조회수"><span class="record-view-count">${viewCount}</span>${newBadge}</div>
    </article>`;
}

function renderRecords() {
  const query = searchInput.value.trim().toLowerCase();
  const scope = searchScope.value;
  const direction = sortOrder?.value === "newest" ? -1 : 1;
  const sequenceById = createRecordSequenceMap();
  const visible = records.filter((record) => {
    const titleText = [record.title, record.passage, formatMeditationRange(record)]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();
    const bodyText = String(record.summary || "").toLowerCase();
    const text = scope === "title" ? titleText : scope === "body" ? bodyText : `${titleText} ${bodyText}`;
    return !query || text.includes(query);
  }).sort((left, right) => compareRecordsByUploadOrder(left, right) * direction);
  if (resultCount) {
    resultCount.innerHTML = query
      ? `<b>${visible.length}</b> / ${records.length}건`
      : `<b>${visible.length}</b>건`;
  }
  recordList.innerHTML = visible.length
    ? visible.map((record) => recordCard(record, sequenceById.get(record.id) || 1)).join("")
    : `<div class="empty-state"><strong>${records.length ? "조건에 맞는 자료가 없어요" : "아직 등록된 묵상 자료가 없어요"}</strong>${records.length ? "검색어나 검색 범위를 바꿔보세요." : "관리자가 첫 번째 묵상 자료를 등록하면 여기에 표시됩니다."}</div>`;
}

function closeDetailEditor() {
  detailEditForm.hidden = true;
  detailSummary.hidden = false;
  detailEditButton.hidden = false;
  detailEditFile.value = "";
}

function normalizeDateInput(value) {
  if (!value) return localDateValue();
  return value.slice(0, 10);
}

async function openRecordDetail(recordId, { countView = true } = {}) {
  const record = records.find((item) => item.id === recordId);
  if (!record) return;
  if (countView) {
    record.viewCount = Math.max(0, Number(record.viewCount) || 0) + 1;
    try {
      await persistViewCount(record);
    } catch (error) {
      console.error("View count sync failed", error);
    }
    renderRecords();
  }
  currentDetailRecordId = record.id;
  closeDetailEditor();
  document.querySelector("#detail-date").textContent = formatUploadedDate(record);
  document.querySelector("#detail-passage").textContent = `${formatDate(record.meetingDate)}\n${record.passage || "범위 미지정"}`;
  document.querySelector("#detail-owner").textContent = record.owner || "관리자";
  document.querySelector("#detail-file").textContent = record.fileName || "등록 파일 없음";
  detailDownloadButton.disabled = !record.fileName;
  detailDownloadButton.setAttribute("aria-label", record.fileName ? `${record.fileName} 다운로드` : "등록 파일 없음");
  try {
    const asset = await getRecordAsset(record.id);
    const savedHtml = asset?.contentHtml || record.contentHtml || "";
    if (savedHtml) detailSummary.innerHTML = sanitizeEditorHtml(savedHtml);
    else detailSummary.textContent = record.summary || "묵상 나눔 내용이 없습니다. ‘수정’을 눌러 내용을 작성해주세요.";
  } catch {
    if (record.contentHtml) detailSummary.innerHTML = sanitizeEditorHtml(record.contentHtml);
    else detailSummary.textContent = record.summary || "묵상 나눔 내용이 없습니다. ‘수정’을 눌러 내용을 작성해주세요.";
  }
  switchView("detail");
}

async function openDetailEditor() {
  const record = records.find((item) => item.id === currentDetailRecordId);
  if (!record || !hasUploadPermission()) return;
  detailEditDate.value = normalizeDateInput(record.meetingDate);
  detailEditPassage.value = record.passage || "";
  detailEditFile.value = "";
  try {
    const asset = await getRecordAsset(record.id);
    const savedHtml = asset?.contentHtml || record.contentHtml || "";
    detailRichEditor.innerHTML = savedHtml
      ? sanitizeEditorHtml(savedHtml)
      : (record.summary ? `<p>${escapeHtml(record.summary).replaceAll("\n", "<br>")}</p>` : "");
  } catch {
    detailRichEditor.innerHTML = record.contentHtml
      ? sanitizeEditorHtml(record.contentHtml)
      : (record.summary ? `<p>${escapeHtml(record.summary).replaceAll("\n", "<br>")}</p>` : "");
  }
  detailSummary.hidden = true;
  detailEditForm.hidden = false;
  detailEditButton.hidden = true;
  detailRichEditor.focus();
}

function formatMemberDate(value) {
  return new Intl.DateTimeFormat("ko-KR", { year: "numeric", month: "long", day: "numeric" }).format(new Date(value));
}

function renderMembers() {
  document.querySelector("#member-count").textContent = members.length;
  memberList.innerHTML = members.map((member, index) => `
    <article class="member-row">
      <span class="member-index" data-label="순번">${String(index + 1).padStart(2, "0")}</span>
      <strong data-label="이름">${escapeHtml(member.name)}</strong>
      <span class="member-role ${member.role === "admin" ? "is-admin" : ""}" data-label="권한">${MEMBER_ROLE_LABELS[member.role] || "일반 멤버"}</span>
      <span class="member-date" data-label="등록일">${escapeHtml(formatMemberDate(member.createdAt))}</span>
    </article>`).join("");
}

function validateUpload(file) {
  const allowed = ["pdf", "ppt", "pptx", "hwp", "hwpx", "doc", "docx", "txt", "md", "jpg", "jpeg", "jfif", "png", "gif", "webp", "bmp", "tif", "tiff", "svg", "svgz", "avif", "heic", "heif", "ico"];
  const extension = file.name.split(".").pop().toLowerCase();
  if (!allowed.includes(extension) && !file.type.startsWith("image/")) {
    showToast("PDF, PPT, 한글, Word, 문서 또는 이미지 파일을 선택해주세요.");
    return false;
  }
  if (file.size > 25 * 1024 * 1024) {
    showToast("파일은 25MB 이하로 올려주세요.");
    return false;
  }
  return true;
}

function showSelectedFile(file) {
  selectedFile.textContent = file ? `${file.name} · ${formatSize(file.size)}` : "";
}

function rememberEditorSelection(editor = activeEditor) {
  const selection = window.getSelection();
  if (selection.rangeCount && editor.contains(selection.anchorNode)) {
    activeEditor = editor;
    savedEditorRange = selection.getRangeAt(0).cloneRange();
  }
}

function restoreEditorSelection(editor = activeEditor) {
  activeEditor = editor;
  editor.focus();
  const selection = window.getSelection();
  selection.removeAllRanges();
  if (savedEditorRange && editor.contains(savedEditorRange.commonAncestorContainer)) {
    selection.addRange(savedEditorRange);
    return;
  }
  const range = document.createRange();
  range.selectNodeContents(editor);
  range.collapse(false);
  selection.addRange(range);
  savedEditorRange = range.cloneRange();
}

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

async function makeContainerImagesPersistent(container) {
  const images = [...container.querySelectorAll("img")];
  for (const image of images) {
    const src = image.getAttribute("src") || "";
    if (!src.startsWith("blob:")) continue;
    try {
      const response = await fetch(src);
      if (!response.ok) throw new Error("이미지를 읽지 못했습니다.");
      image.setAttribute("src", await readFileAsDataUrl(await response.blob()));
    } catch {
      image.removeAttribute("src");
    }
  }

  const backgroundElements = [...container.querySelectorAll("[style]")];
  for (const element of backgroundElements) {
    const backgroundImage = element.style.backgroundImage || "";
    const match = backgroundImage.match(/url\(["']?(blob:[^)"']+)/i);
    if (!match) continue;
    try {
      const response = await fetch(match[1]);
      if (!response.ok) throw new Error("배경 이미지를 읽지 못했습니다.");
      const dataUrl = await readFileAsDataUrl(await response.blob());
      element.style.backgroundImage = `url("${dataUrl}")`;
    } catch {
      element.style.removeProperty("background-image");
    }
  }
}

async function prepareEditorHtmlForSave(editor) {
  const clone = editor.cloneNode(true);
  const sourceCanvases = [...editor.querySelectorAll("canvas")];
  [...clone.querySelectorAll("canvas")].forEach((canvas, index) => {
    try {
      const image = document.createElement("img");
      image.src = sourceCanvases[index].toDataURL("image/png");
      image.alt = sourceCanvases[index].getAttribute("aria-label") || "붙여넣은 도형";
      image.width = sourceCanvases[index].width;
      image.height = sourceCanvases[index].height;
      canvas.replaceWith(image);
    } catch {
      canvas.remove();
    }
  });
  await makeContainerImagesPersistent(clone);
  return sanitizeEditorHtml(clone.innerHTML);
}

async function preparePastedHtml(html = "") {
  const template = document.createElement("template");
  template.innerHTML = String(html);
  await makeContainerImagesPersistent(template.content);
  return sanitizeEditorHtml(template.innerHTML);
}

async function insertImagesIntoEditor(files, editor = activeEditor) {
  const images = [...files].filter((file) => file.type.startsWith("image/"));
  if (!images.length) {
    showToast("이미지 파일을 선택해주세요.");
    return;
  }
  restoreEditorSelection(editor);
  for (const image of images) {
    if (image.size > 25 * 1024 * 1024) {
      showToast(`${image.name} 파일은 25MB 이하로 선택해주세요.`);
      continue;
    }
    const dataUrl = await readFileAsDataUrl(image);
    document.execCommand("insertHTML", false, `<img src="${dataUrl}" alt="${escapeHtml(image.name)}"><p><br></p>`);
  }
  rememberEditorSelection(editor);
}

function plainTextToEditorHtml(text = "") {
  return String(text)
    .split(/\r?\n/)
    .map((line) => `<p>${line ? escapeHtml(line) : "<br>"}</p>`)
    .join("");
}

function insertHtmlIntoEditor(html, editor = activeEditor) {
  if (!html) return;
  restoreEditorSelection(editor);
  document.execCommand("insertHTML", false, html);
  rememberEditorSelection(editor);
}

function clipboardImages(clipboardData) {
  const itemFiles = [...(clipboardData?.items || [])]
    .filter((item) => item.kind === "file" && item.type.startsWith("image/"))
    .map((item) => item.getAsFile())
    .filter(Boolean);
  if (itemFiles.length) return itemFiles;
  return [...(clipboardData?.files || [])].filter((file) => file.type.startsWith("image/"));
}

async function handleEditorPaste(event, editor) {
  const clipboardData = event.clipboardData;
  if (!clipboardData) return;
  const sourceHtml = clipboardData.getData("text/html");
  const sourceText = clipboardData.getData("text/plain");
  const pastedImages = clipboardImages(clipboardData);
  if (!sourceHtml && !pastedImages.length) return;

  event.preventDefault();
  const safeHtml = sourceHtml ? await preparePastedHtml(sourceHtml) : plainTextToEditorHtml(sourceText);
  if (safeHtml) insertHtmlIntoEditor(safeHtml, editor);

  const htmlAlreadyContainsVisual = /<(?:img|svg)\b/i.test(safeHtml);
  if (pastedImages.length && !htmlAlreadyContainsVisual) await insertImagesIntoEditor(pastedImages, editor);
  if (/<table\b/i.test(safeHtml) || htmlAlreadyContainsVisual || pastedImages.length) {
    showToast("표와 이미지 형식을 유지해 붙여넣었습니다.");
  }
}

function setupRichEditor(editor, toolbar, imageInput, insertImageButton) {
  ["keyup", "mouseup", "input"].forEach((eventName) => {
    editor.addEventListener(eventName, () => rememberEditorSelection(editor));
  });
  editor.addEventListener("blur", () => {
    if (!editor.textContent.trim() && !editor.querySelector("img")) editor.innerHTML = "";
  });
  toolbar.addEventListener("mousedown", (event) => {
    if (event.target.closest("button")) event.preventDefault();
  });
  toolbar.addEventListener("click", (event) => {
    const button = event.target.closest("[data-editor-command]");
    if (!button) return;
    restoreEditorSelection(editor);
    document.execCommand(button.dataset.editorCommand, false);
    rememberEditorSelection(editor);
  });
  toolbar.addEventListener("change", (event) => {
    const control = event.target;
    let command = "";
    if (control.matches("[data-editor-font]")) command = "fontName";
    if (control.matches("[data-editor-size]")) command = "fontSize";
    if (control.matches("[data-editor-color]")) command = "foreColor";
    if (!command || !control.value) return;
    restoreEditorSelection(editor);
    document.execCommand("styleWithCSS", false, false);
    document.execCommand(command, false, control.value);
    rememberEditorSelection(editor);
    if (control.matches("select")) control.value = "";
  });
  insertImageButton.addEventListener("click", () => {
    rememberEditorSelection(editor);
    imageInput.click();
  });
  imageInput.addEventListener("change", async () => {
    await insertImagesIntoEditor(imageInput.files, editor);
    imageInput.value = "";
  });
  editor.addEventListener("paste", (event) => handleEditorPaste(event, editor));
}

function localDateValue(date = new Date()) {
  const localDate = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return localDate.toISOString().slice(0, 10);
}

loginForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const data = new FormData(loginForm);
  const name = String(data.get("name") || "").trim();
  const registeredMember = members.find((member) => member.name === name);
  if (!registeredMember) {
    showToast("등록되지 않은 이름입니다. 관리자에게 등록을 요청해주세요.");
    return;
  }
  if (data.get("rememberName")) localStorage.setItem(KEYS.rememberedName, name);
  else localStorage.removeItem(KEYS.rememberedName);
  login(registeredMember.name, registeredMember.role);
});

memberForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!hasUploadPermission()) return;
  const data = new FormData(memberForm);
  const name = String(data.get("memberName") || "").trim();
  const role = String(data.get("memberRole") || "member");
  if (members.some((member) => member.name === name)) {
    showToast("이미 등록된 멤버입니다.");
    return;
  }
  const member = {
    id: crypto.randomUUID ? crypto.randomUUID() : `member-${Date.now()}`,
    name,
    role: role === "admin" ? "admin" : "member",
    createdAt: new Date().toISOString(),
  };
  const submitButton = memberForm.querySelector('button[type="submit"]');
  setButtonBusy(submitButton, true, "등록 중…");
  try {
    await addMemberData(member);
    memberForm.reset();
    renderMembers();
    setSyncState(cloudEnabled ? "synced" : "local", cloudEnabled ? `동기화됨 · ${syncTimeLabel()}` : "이 기기에 저장 중");
    showToast(`${name}님을 새 멤버로 등록했습니다.`);
  } catch (error) {
    console.error("Member save failed", error);
    showToast("멤버를 등록하지 못했습니다. 다시 시도해주세요.");
  } finally {
    setButtonBusy(submitButton, false);
  }
});

document.querySelectorAll(".protected-view-trigger").forEach((button) => {
  button.addEventListener("click", () => {
    if (!hasUploadPermission()) return;
    protectedActionTarget = null;
    protectedViewTarget = button.dataset.protectedView || "admin";
    adminAccessForm.reset();
    adminPasswordError.textContent = "";
    adminPasswordDialog.showModal();
  });
});

adminAccessForm.addEventListener("submit", (event) => {
  event.preventDefault();
  if (adminAccessPassword.value !== getAdminPassword()) {
    adminPasswordError.textContent = "비밀번호가 올바르지 않습니다.";
    adminAccessPassword.select();
    return;
  }
  adminUnlocked = true;
  adminPasswordDialog.close();
  if (protectedActionTarget) {
    const action = protectedActionTarget;
    protectedActionTarget = null;
    adminUnlocked = false;
    if (action === "edit-record") openDetailEditor();
    if (action === "delete-record" && currentDetailRecordId) {
      pendingDeleteRecordId = currentDetailRecordId;
      deleteRecordDialog.showModal();
    }
    return;
  }
  switchView(protectedViewTarget);
});

document.querySelector("#close-admin-dialog").addEventListener("click", () => {
  protectedActionTarget = null;
  adminPasswordDialog.close();
});

document.querySelector("#change-admin-password").addEventListener("click", () => {
  const currentPassword = document.querySelector("#current-admin-password");
  const newPassword = document.querySelector("#new-admin-password");
  const confirmPassword = document.querySelector("#confirm-admin-password");
  if (currentPassword.value !== getAdminPassword()) {
    showToast("현재 비밀번호가 올바르지 않습니다.");
    currentPassword.focus();
    return;
  }
  if (newPassword.value.length < 4) {
    showToast("새 비밀번호는 4자리 이상으로 입력해주세요.");
    newPassword.focus();
    return;
  }
  if (newPassword.value !== confirmPassword.value) {
    showToast("새 비밀번호가 서로 일치하지 않습니다.");
    confirmPassword.focus();
    return;
  }
  localStorage.setItem(KEYS.adminPassword, newPassword.value);
  currentPassword.value = "";
  newPassword.value = "";
  confirmPassword.value = "";
  showToast("관리자 비밀번호를 변경했습니다.");
});

document.querySelectorAll("[data-view-link]").forEach((button) => {
  button.addEventListener("click", (event) => {
    event.preventDefault();
    switchView(button.dataset.viewLink);
  });
});

document.querySelector("#logout-button").addEventListener("click", leaveApp);
searchInput.addEventListener("input", renderRecords);
searchScope.addEventListener("change", renderRecords);
sortOrder.addEventListener("change", renderRecords);
window.addEventListener("scroll", updateBackToTopVisibility, { passive: true });
backToTopButton.addEventListener("click", () => window.scrollTo({ top: 0, behavior: "smooth" }));

function requestRecordAdminAction(action) {
  if (!currentDetailRecordId || !hasUploadPermission()) return;
  protectedActionTarget = action;
  adminAccessForm.reset();
  adminPasswordError.textContent = "";
  adminPasswordDialog.showModal();
}

detailEditButton.addEventListener("click", () => requestRecordAdminAction("edit-record"));
document.querySelector("#detail-edit-cancel").addEventListener("click", closeDetailEditor);

detailDownloadButton.addEventListener("click", async () => {
  const record = records.find((item) => item.id === currentDetailRecordId);
  if (!record) return;
  setButtonBusy(detailDownloadButton, true, "다운로드 중…");
  try {
    const file = await getFile(record.id);
    if (!file) {
      showToast("저장된 파일을 찾을 수 없습니다.");
      return;
    }
    const downloadUrl = URL.createObjectURL(file);
    const link = document.createElement("a");
    link.href = downloadUrl;
    link.download = record.fileName || file.name || "묵상-자료";
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(downloadUrl), 1000);
    showToast("파일 다운로드를 시작했습니다.");
  } catch (error) {
    console.error("File download failed", error);
    showToast("파일을 다운로드하지 못했습니다. 다시 시도해주세요.");
  } finally {
    setButtonBusy(detailDownloadButton, false);
  }
});

detailDeleteButton.addEventListener("click", () => {
  requestRecordAdminAction("delete-record");
});

document.querySelector("#cancel-record-delete").addEventListener("click", () => {
  pendingDeleteRecordId = null;
  deleteRecordDialog.close();
});

deleteRecordForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!pendingDeleteRecordId || !hasUploadPermission()) return;
  const recordId = pendingDeleteRecordId;
  const record = records.find((item) => item.id === recordId);
  if (!record) return;
  const submitButton = deleteRecordForm.querySelector('button[type="submit"]');
  setButtonBusy(submitButton, true, "삭제 중…");
  try {
    await removeRecordData(record);
    pendingDeleteRecordId = null;
    currentDetailRecordId = null;
    deleteRecordDialog.close();
    renderRecords();
    switchView("library");
    setSyncState(cloudEnabled ? "synced" : "local", cloudEnabled ? `동기화됨 · ${syncTimeLabel()}` : "이 기기에 저장 중");
    showToast("자료를 삭제했습니다.");
  } catch (error) {
    console.error("Record delete failed", error);
    showToast("자료를 삭제하지 못했습니다. 다시 시도해주세요.");
  } finally {
    setButtonBusy(submitButton, false);
  }
});

detailEditFile.addEventListener("change", () => {
  const file = detailEditFile.files[0];
  if (file && !validateUpload(file)) detailEditFile.value = "";
});

detailEditForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!currentDetailRecordId || !hasUploadPermission()) return;
  const record = records.find((item) => item.id === currentDetailRecordId);
  if (!record) return;
  const replacementFile = detailEditFile.files[0];
  if (replacementFile && !validateUpload(replacementFile)) return;
  const meetingDate = detailEditDate.value;
  const passage = detailEditPassage.value.trim();
  const submitButton = detailEditForm.querySelector('button[type="submit"]');
  setButtonBusy(submitButton, true, "저장 중…");
  try {
    const contentHtml = await prepareEditorHtmlForSave(detailRichEditor);
    const existingAsset = await getRecordAsset(record.id);
    record.meetingDate = meetingDate;
    record.passage = passage;
    record.title = `${passage || "묵상 나눔"} · ${formatDate(meetingDate)}`;
    record.summary = detailRichEditor.innerText.trim().slice(0, 50000);
    if (replacementFile) {
      record.fileName = replacementFile.name;
      record.fileType = replacementFile.type;
      record.fileSize = replacementFile.size;
    }
    await saveRecordData(record, replacementFile || existingAsset?.file || null, contentHtml);
    renderRecords();
    await openRecordDetail(record.id, { countView: false });
    setSyncState(cloudEnabled ? "synced" : "local", cloudEnabled ? `동기화됨 · ${syncTimeLabel()}` : "이 기기에 저장 중");
    showToast("수정 내용을 저장했습니다.");
  } catch (error) {
    console.error("Record update failed", error);
    showToast("수정 내용을 저장하지 못했습니다. 다시 시도해주세요.");
  } finally {
    setButtonBusy(submitButton, false);
  }
});

setupRichEditor(richEditor, editorToolbar, editorImageInput, insertEditorImageButton);
setupRichEditor(detailRichEditor, detailEditorToolbar, detailEditorImageInput, detailInsertEditorImageButton);

uploadForm.addEventListener("input", () => { uploadFormDirty = true; });
uploadForm.addEventListener("change", () => { uploadFormDirty = true; });

fileInput.addEventListener("change", () => {
  const file = fileInput.files[0];
  if (file && !validateUpload(file)) fileInput.value = "";
  showSelectedFile(fileInput.files[0]);
});

// Guard against stale markup or restored browser form state accidentally
// marking the attachment as required. This field must always remain optional.
fileInput.required = false;
fileInput.removeAttribute("required");

submitWithoutFileButton.addEventListener("click", () => {
  fileInput.value = "";
  showSelectedFile(null);
  uploadForm.requestSubmit();
});

["dragenter", "dragover"].forEach((eventName) => {
  dropZone.addEventListener(eventName, (event) => { event.preventDefault(); dropZone.classList.add("is-dragging"); });
});
["dragleave", "drop"].forEach((eventName) => {
  dropZone.addEventListener(eventName, (event) => { event.preventDefault(); dropZone.classList.remove("is-dragging"); });
});
dropZone.addEventListener("drop", (event) => {
  const file = event.dataTransfer.files[0];
  if (!file || !validateUpload(file)) return;
  const transfer = new DataTransfer();
  transfer.items.add(file);
  fileInput.files = transfer.files;
  showSelectedFile(file);
});

uploadForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!hasUploadPermission()) return;
  const data = new FormData(uploadForm);
  // Attachments are always optional. The record is saved from its meditation
  // range or editor content even when no file has been selected.
  const file = fileInput.files[0] || null;
  if (file && !validateUpload(file)) return;

  const id = crypto.randomUUID ? crypto.randomUUID() : String(Date.now());
  const meetingDate = String(data.get("meetingDate") || "");
  const passage = String(data.get("passage") || "").trim();
  const summaryText = richEditor.innerText.trim();
  const hasVisualContent = Boolean(richEditor.querySelector("img, table, svg"));
  if (!passage && !summaryText && !hasVisualContent) {
    showToast("나눔범위나 본문 내용을 입력해주세요.");
    richEditor.focus();
    return;
  }
  const record = {
    id,
    title: `${passage || "묵상 나눔"} · ${formatDate(meetingDate)}`,
    meetingDate,
    speaker: session.name,
    passage,
    visibility: "church",
    summary: summaryText.slice(0, 50000),
    fileName: file?.name || "",
    fileType: file?.type || "",
    fileSize: file?.size || 0,
    owner: session.name,
    createdAt: new Date().toISOString(),
    viewCount: 0,
  };

  const submitButton = uploadForm.querySelector('button[type="submit"]');
  setButtonBusy(submitButton, true, "등록 중…");
  try {
    const contentHtml = await prepareEditorHtmlForSave(richEditor);
    await saveRecordData(record, file, contentHtml, { isNew: true });
    uploadForm.reset();
    richEditor.innerHTML = "";
    uploadForm.elements.meetingDate.value = localDateValue();
    showSelectedFile(null);
    uploadFormDirty = false;
    renderRecords();
    switchView("library");
    setSyncState(cloudEnabled ? "synced" : "local", cloudEnabled ? `동기화됨 · ${syncTimeLabel()}` : "이 기기에 저장 중");
    showToast("승인된 구성원이 볼 수 있도록 자료를 등록했어요.");
  } catch (error) {
    console.error("Record save failed", error);
    showToast("자료 저장 중 문제가 생겼어요. 다시 시도해주세요.");
  } finally {
    setButtonBusy(submitButton, false);
  }
});

recordList.addEventListener("click", (event) => {
  const card = event.target.closest("[data-record-id]");
  if (card) openRecordDetail(card.dataset.recordId);
});

recordList.addEventListener("keydown", (event) => {
  if (!["Enter", " "].includes(event.key)) return;
  const card = event.target.closest("[data-record-id]");
  if (!card) return;
  event.preventDefault();
  openRecordDetail(card.dataset.recordId);
});

migrateCloudDataButton.addEventListener("click", migrateLocalDataToCloud);
syncRefreshButton.addEventListener("click", () => refreshCloudData({ announce: true }));

window.addEventListener("focus", () => {
  if (session && document.visibilityState === "visible") refreshCloudData();
});
document.addEventListener("visibilitychange", () => {
  if (session && document.visibilityState === "visible") refreshCloudData();
});
window.addEventListener("online", () => refreshCloudData({ announce: Boolean(session) }));
window.addEventListener("offline", () => setSyncState("offline", "오프라인"));
window.addEventListener("beforeunload", (event) => {
  if (!uploadFormDirty) return;
  event.preventDefault();
  event.returnValue = "";
});

async function initializeApp() {
  uploadForm.elements.meetingDate.value = localDateValue();
  updateCloudSyncPanel();
  if (cloudEnabled) {
    const migrationDone = localStorage.getItem(cloudMigrationKey) === "done";
    if (!migrationDone && hasLocalSnapshotAtStartup) {
      await migrateLocalDataToCloud({ silent: true });
    }
    const connected = await refreshCloudData();
    if (!connected) {
      updateCloudSyncPanel("공유 저장소에 연결하지 못했습니다. 네트워크와 Supabase 설정을 확인해주세요.");
      showToast("공유 저장소 연결에 실패해 자료를 불러오지 못했습니다.");
    }
  } else {
    setSyncState("local", "이 기기에 저장 중");
  }
  restoreRememberedName();
  if (session) enterApp();
}

initializeApp();
