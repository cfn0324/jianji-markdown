const STORAGE_KEY = "simple-mobile-markdown:draft:v1";
const VIEW_KEY = "simple-mobile-markdown:view:v1";
const GITHUB_CONFIG_KEY = "simple-mobile-markdown:github:v1";

const editor = document.querySelector("#editor");
const preview = document.querySelector("#preview");
const workspace = document.querySelector("#workspace");
const fileInput = document.querySelector("#fileInput");
const saveState = document.querySelector("#saveState");
const toast = document.querySelector("#toast");
const settingsPanel = document.querySelector("#settingsPanel");
const settingsBackdrop = document.querySelector("#settingsBackdrop");

const githubFields = {
  token: document.querySelector("#githubToken"),
  url: document.querySelector("#githubUrl"),
  fileList: document.querySelector("#githubFileList")
};

const githubPicker = {
  backdrop: document.querySelector("#githubPickerBackdrop"),
  panel: document.querySelector("#githubPickerPanel"),
  title: document.querySelector("#githubPickerTitle"),
  selectLabel: document.querySelector("#githubPickerSelectLabel"),
  select: document.querySelector("#githubPickerSelect"),
  newPathField: document.querySelector("#githubNewPathField"),
  newPath: document.querySelector("#githubNewPath"),
  note: document.querySelector("#githubPickerNote")
};

const defaultDraft = "# 未命名\n\n";
let toastTimer = 0;
let renderTimer = 0;
let saveTimer = 0;
let githubPickerState = null;

const md = createMarkdownRenderer();

window.receiveNativeMarkdown = receiveNativeMarkdown;
window.receiveNativeSaveResult = receiveNativeSaveResult;

init();

function init() {
  editor.value = localStorage.getItem(STORAGE_KEY) ?? defaultDraft;
  setView(localStorage.getItem(VIEW_KEY) || "edit");
  bindUI();
  bindKeyboardOffset();
  registerServiceWorker();
  renderNow();
}

function createMarkdownRenderer() {
  if (!window.markdownit) {
    return null;
  }

  const instance = window.markdownit({
    html: false,
    linkify: true,
    breaks: true,
    typographer: true
  });

  instance.renderer.rules.list_item_open = (tokens, idx, options, env, self) => {
    const token = tokens[idx];
    const nextToken = tokens[idx + 2];
    const contentToken = nextToken?.type === "inline" ? nextToken : null;
    const content = contentToken?.content || "";
    const match = content.match(/^\[( |x|X)\]\s+/);

    if (!match) {
      return self.renderToken(tokens, idx, options);
    }

    token.attrJoin("class", "task-list-item");
    contentToken.content = content.replace(/^\[( |x|X)\]\s+/, "");
    contentToken.children = contentToken.children || [];

    if (contentToken.children[0]?.type === "text") {
      contentToken.children[0].content = contentToken.children[0].content.replace(/^\[( |x|X)\]\s+/, "");
    }

    const checked = match[1].toLowerCase() === "x" ? " checked" : "";
    return `${self.renderToken(tokens, idx, options)}<input class="task-list-checkbox" type="checkbox" disabled${checked}>`;
  };

  if (window.texmath && window.katex) {
    instance.use(window.texmath, {
      engine: window.katex,
      delimiters: "dollars",
      katexOptions: {
        throwOnError: false,
        output: "htmlAndMathml"
      }
    });
  }

  const defaultFence = instance.renderer.rules.fence;
  instance.renderer.rules.fence = (tokens, idx, options, env, self) => {
    const token = tokens[idx];
    const language = token.info.trim().split(/\s+/)[0].toLowerCase();

    if (language === "mermaid") {
      return `<div class="mermaid">${escapeHtml(token.content)}</div>`;
    }

    return defaultFence(tokens, idx, options, env, self);
  };

  return instance;
}

function bindUI() {
  document.querySelectorAll("[data-view]").forEach((button) => {
    button.addEventListener("click", () => setView(button.dataset.view));
  });

  document.querySelectorAll("[data-insert]").forEach((button) => {
    button.addEventListener("click", () => {
      insertMarkdown(button.dataset.insert);
    });
  });

  document.querySelector("[data-action='new']").addEventListener("click", newDocument);
  document.querySelector("[data-action='open']").addEventListener("click", openDocument);
  document.querySelector("[data-action='save']").addEventListener("click", exportDocument);
  document.querySelector("[data-action='settings']").addEventListener("click", openSettings);
  document.querySelector("[data-action='closeSettings']").addEventListener("click", closeSettings);
  settingsBackdrop.addEventListener("click", closeSettings);
  githubPicker.backdrop.addEventListener("click", cancelGithubPicker);

  document.querySelectorAll("[data-github]").forEach((button) => {
    button.addEventListener("click", () => handleGithubAction(button.dataset.github));
  });
  githubFields.fileList.addEventListener("change", () => {
    if (githubFields.fileList.value) {
      saveGithubConfigFromFields(githubFields.fileList.value);
    }
  });
  document.querySelectorAll("[data-picker]").forEach((button) => {
    const action = button.dataset.picker;
    button.addEventListener("click", () => {
      if (action === "confirm") {
        confirmGithubPicker();
        return;
      }

      cancelGithubPicker();
    });
  });

  fileInput.addEventListener("change", importDocument);

  editor.addEventListener("input", () => {
    saveState.textContent = "保存中";
    window.clearTimeout(saveTimer);
    saveTimer = window.setTimeout(saveDraft, 160);
    scheduleRender();
  });

  window.addEventListener("beforeunload", saveDraft);
}

function bindKeyboardOffset() {
  if (!window.visualViewport) {
    return;
  }

  const sync = () => {
    const viewport = window.visualViewport;
    const inset = Math.max(0, window.innerHeight - viewport.height - viewport.offsetTop);
    document.documentElement.style.setProperty("--keyboard-inset", `${Math.round(inset)}px`);
  };

  window.visualViewport.addEventListener("resize", sync);
  window.visualViewport.addEventListener("scroll", sync);
  sync();
}

function registerServiceWorker() {
  if ("serviceWorker" in navigator && ["http:", "https:"].includes(location.protocol)) {
    navigator.serviceWorker.register("./sw.js").catch(() => {});
  }
}

function setView(view) {
  const nextView = ["edit", "preview", "split"].includes(view) ? view : "edit";
  workspace.dataset.view = nextView;
  document.body.dataset.mode = nextView === "preview" ? "preview" : "edit";
  localStorage.setItem(VIEW_KEY, nextView);

  document.querySelectorAll("[data-view]").forEach((button) => {
    const active = button.dataset.view === nextView;
    button.classList.toggle("is-active", active);
    button.setAttribute("aria-selected", String(active));
  });

  if (nextView !== "edit") {
    renderNow();
  }
}

function scheduleRender() {
  window.clearTimeout(renderTimer);
  renderTimer = window.setTimeout(renderNow, 120);
}

async function renderNow() {
  if (!md) {
    preview.innerHTML = `<p>${escapeHtml("缺少本地 Markdown 渲染库，请先运行 npm install。")}</p>`;
    return;
  }

  preview.innerHTML = md.render(editor.value);
  preview.querySelectorAll("a[href]").forEach((link) => {
    link.target = "_blank";
    link.rel = "noopener noreferrer";
  });

  const diagrams = Array.from(preview.querySelectorAll(".mermaid"));
  if (!diagrams.length || !window.mermaid) {
    return;
  }

  window.mermaid.initialize({
    startOnLoad: false,
    securityLevel: "strict",
    theme: "neutral"
  });

  diagrams.forEach((node) => node.removeAttribute("data-processed"));

  try {
    await window.mermaid.run({ nodes: diagrams });
  } catch (error) {
    console.warn(error);
    showToast("Mermaid 渲染失败", "error");
  }
}

function saveDraft() {
  localStorage.setItem(STORAGE_KEY, editor.value);
  saveState.textContent = "已保存";
}

function newDocument() {
  if (editor.value.trim() && !window.confirm("清空当前内容？")) {
    return;
  }

  editor.value = defaultDraft;
  saveDraft();
  renderNow();
  focusEditor();
}

function openDocument() {
  if (hasNativeBridge()) {
    window.NativeMarkdown.openMarkdown();
    return;
  }

  fileInput.click();
}

async function importDocument() {
  const file = fileInput.files?.[0];
  if (!file) {
    return;
  }

  receiveDocument(await file.text(), file.name);
  fileInput.value = "";
}

function receiveNativeMarkdown(name, content) {
  receiveDocument(String(content || ""), name || "文档");
}

function receiveDocument(content, name) {
  editor.value = content;
  saveDraft();
  renderNow();
  setView("edit");
  focusEditor();
  showToast(`${name || "文档"}已打开`, "success");
}

function receiveNativeSaveResult(success, message) {
  showToast(message || (success ? "已导出" : "导出失败"), success ? "success" : "error");
}

async function exportDocument() {
  saveDraft();
  const fileName = `${getDocumentTitle()}.md`;

  if (hasNativeBridge()) {
    window.NativeMarkdown.saveMarkdown(fileName, editor.value);
    return;
  }

  const file = new File([editor.value], fileName, { type: "text/markdown;charset=utf-8" });

  if (navigator.canShare?.({ files: [file] }) && navigator.share) {
    try {
      await navigator.share({ files: [file], title: getDocumentTitle() });
      return;
    } catch (error) {
      if (error.name === "AbortError") {
        return;
      }
    }
  }

  const url = URL.createObjectURL(file);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
  showToast("已导出", "success");
}

function getDocumentTitle() {
  const firstHeading = editor.value
    .split(/\r?\n/)
    .map((line) => line.match(/^#\s+(.+)$/)?.[1]?.trim())
    .find(Boolean);

  return sanitizeFileName(firstHeading || "markdown-note");
}

function sanitizeFileName(name) {
  return name.replace(/[\\/:*?"<>|]/g, "").slice(0, 48) || "markdown-note";
}

function insertMarkdown(type) {
  const actions = {
    h1: () => setHeading(1),
    h2: () => setHeading(2),
    h3: () => setHeading(3),
    bold: () => wrapSelection("**", "**", "文本"),
    italic: () => wrapSelection("*", "*", "文本"),
    quote: () => transformSelectedLines((line) => togglePrefix(line, "> ")),
    list: () => transformSelectedLines((line) => togglePrefix(line, "- ")),
    task: () => transformSelectedLines((line) => togglePrefix(line, "- [ ] ")),
    inlineCode: () => wrapSelection("`", "`", "code"),
    codeBlock: () => insertBlock("```\n", "\n```", "code"),
    inlineMath: () => wrapSelection("$", "$", "x^2 + y^2 = z^2"),
    mathBlock: () => insertBlock("$$\n", "\n$$", "\\int_0^1 x^2 \\, dx = \\frac{1}{3}"),
    mermaid: () => insertBlock("```mermaid\n", "\n```", "graph TD\n  A[开始] --> B[完成]"),
    link: () => wrapSelection("[", "](https://)", "链接"),
    table: insertTable,
    tableRowAdd: () => editTable("addRow"),
    tableRowDelete: () => editTable("deleteRow"),
    tableColAdd: () => editTable("addColumn"),
    tableColDelete: () => editTable("deleteColumn"),
    hr: () => insertPlain("\n---\n")
  };

  actions[type]?.();
  saveDraft();
  renderNow();
}

function setHeading(level) {
  const prefix = `${"#".repeat(level)} `;
  transformSelectedLines((line) => {
    const text = line.replace(/^#{1,6}\s+/, "");
    return text ? `${prefix}${text}` : prefix;
  });
}

function wrapSelection(before, after, fallback) {
  const start = editor.selectionStart;
  const end = editor.selectionEnd;
  const selected = editor.value.slice(start, end) || fallback;
  const next = `${before}${selected}${after}`;
  editor.setRangeText(next, start, end, "end");

  if (start === end) {
    editor.selectionStart = start + before.length;
    editor.selectionEnd = start + before.length + selected.length;
  }

  focusEditor();
}

function insertBlock(before, after, fallback) {
  const start = editor.selectionStart;
  const end = editor.selectionEnd;
  const selected = editor.value.slice(start, end) || fallback;
  const prefix = start === 0 || editor.value[start - 1] === "\n" ? "" : "\n";
  const suffix = end === editor.value.length || editor.value[end] === "\n" ? "" : "\n";
  const text = `${prefix}${before}${selected}${after}${suffix}`;

  editor.setRangeText(text, start, end, "end");
  const selectionStart = start + prefix.length + before.length;
  editor.selectionStart = selectionStart;
  editor.selectionEnd = selectionStart + selected.length;
  focusEditor();
}

function insertTable() {
  insertPlain("\n| 列 1 | 列 2 |\n| --- | --- |\n|  |  |\n|  |  |\n");
}

function editTable(action) {
  const table = findTableAtCursor();

  if (!table) {
    showToast("先把光标放在表格内", "error");
    return;
  }

  const rows = table.lines.map(parseTableRow);
  const columnCount = Math.max(...rows.map((row) => row.length));
  const normalized = rows.map((row) => normalizeCells(row, columnCount));
  const currentColumn = getTableColumnIndex(table.lines[table.relativeLine], table.relativeColumn, columnCount);
  let targetRelativeLine = table.relativeLine;
  let targetColumn = currentColumn;
  let nextRows = normalized;

  if (action === "addRow") {
    const insertAt = table.relativeLine <= table.separatorIndex ? table.separatorIndex + 1 : table.relativeLine + 1;
    nextRows = [
      ...normalized.slice(0, insertAt),
      Array(columnCount).fill(""),
      ...normalized.slice(insertAt)
    ];
    targetRelativeLine = insertAt;
  }

  if (action === "deleteRow") {
    const bodyIndexes = normalized
      .map((_, index) => index)
      .filter((index) => index > table.separatorIndex);

    if (!bodyIndexes.length) {
      showToast("没有可删除的内容行", "error");
      return;
    }

    const deleteAt = table.relativeLine > table.separatorIndex ? table.relativeLine : bodyIndexes[0];

    if (bodyIndexes.length === 1) {
      nextRows = normalized.map((row, index) => (index === deleteAt ? Array(columnCount).fill("") : row));
      targetRelativeLine = deleteAt;
    } else {
      nextRows = normalized.filter((_, index) => index !== deleteAt);
      targetRelativeLine = Math.min(deleteAt, nextRows.length - 1);
    }
  }

  if (action === "addColumn") {
    const insertColumnAt = Math.min(currentColumn + 1, columnCount);
    nextRows = normalized.map((row, rowIndex) => [
      ...row.slice(0, insertColumnAt),
      rowIndex === 0 ? `列 ${columnCount + 1}` : "",
      ...row.slice(insertColumnAt)
    ]);
    targetColumn = insertColumnAt;
  }

  if (action === "deleteColumn") {
    if (columnCount <= 1) {
      showToast("至少保留一列", "error");
      return;
    }

    nextRows = normalized.map((row) => row.filter((_, index) => index !== currentColumn));
    targetColumn = Math.max(0, currentColumn - 1);
  }

  nextRows[table.separatorIndex] = Array(nextRows[0].length).fill("---");
  const formatted = nextRows.map((row, index) => (
    index === table.separatorIndex ? formatTableSeparator(row.length) : formatTableRow(row)
  ));

  replaceTable(table, formatted, targetRelativeLine, targetColumn);
}

function insertPlain(text) {
  const start = editor.selectionStart;
  editor.setRangeText(text, editor.selectionStart, editor.selectionEnd, "end");
  editor.selectionStart = editor.selectionEnd = start + text.length;
  focusEditor();
}

function findTableAtCursor() {
  const value = editor.value;
  const lines = value.split("\n");
  const lineStarts = getLineStarts(value);
  const cursor = editor.selectionStart;
  const lineIndex = getLineIndex(lineStarts, cursor);

  if (!isTableLine(lines[lineIndex])) {
    return null;
  }

  let start = lineIndex;
  let end = lineIndex;

  while (start > 0 && isTableLine(lines[start - 1])) {
    start -= 1;
  }

  while (end < lines.length - 1 && isTableLine(lines[end + 1])) {
    end += 1;
  }

  const block = lines.slice(start, end + 1);
  const separatorIndex = block.findIndex(isTableSeparator);

  if (separatorIndex < 1) {
    return null;
  }

  return {
    start,
    end,
    lines: block,
    lineStarts,
    relativeLine: lineIndex - start,
    relativeColumn: cursor - lineStarts[lineIndex],
    separatorIndex
  };
}

function isTableLine(line) {
  return line.includes("|") && line.trim().length > 0;
}

function isTableSeparator(line) {
  const cells = parseTableRow(line);
  return cells.length > 0 && cells.every((cell) => /^:?-{3,}:?$/.test(cell.trim()));
}

function parseTableRow(line) {
  let text = line.trim();

  if (text.startsWith("|")) {
    text = text.slice(1);
  }

  if (text.endsWith("|")) {
    text = text.slice(0, -1);
  }

  return text.split("|").map((cell) => cell.trim());
}

function normalizeCells(cells, count) {
  const normalized = cells.slice(0, count);

  while (normalized.length < count) {
    normalized.push("");
  }

  return normalized;
}

function formatTableRow(cells) {
  return `| ${cells.map((cell) => cell.trim()).join(" | ")} |`;
}

function formatTableSeparator(count) {
  return `| ${Array(count).fill("---").join(" | ")} |`;
}

function getTableColumnIndex(line, column, columnCount) {
  const beforeCursor = line.slice(0, Math.max(0, column));
  const pipeCount = beforeCursor.split("|").length - 1;
  const startsWithPipe = line.trimStart().startsWith("|");
  const index = startsWithPipe ? pipeCount - 1 : pipeCount;

  return Math.max(0, Math.min(columnCount - 1, index));
}

function replaceTable(table, lines, relativeLine, columnIndex) {
  const value = editor.value;
  const startOffset = table.lineStarts[table.start];
  const endOffset = table.end + 1 < table.lineStarts.length
    ? table.lineStarts[table.end + 1] - 1
    : value.length;
  const nextBlock = lines.join("\n");

  editor.setRangeText(nextBlock, startOffset, endOffset, "end");

  const targetLine = table.start + Math.min(relativeLine, lines.length - 1);
  const newLineStarts = getLineStarts(editor.value);
  const targetLineText = editor.value.slice(
    newLineStarts[targetLine],
    targetLine + 1 < newLineStarts.length ? newLineStarts[targetLine + 1] - 1 : editor.value.length
  );
  const targetOffset = getCellCursorOffset(targetLineText, columnIndex);
  editor.selectionStart = editor.selectionEnd = newLineStarts[targetLine] + targetOffset;
  focusEditor();
}

function getCellCursorOffset(line, columnIndex) {
  let seen = -1;

  for (let index = 0; index < line.length; index += 1) {
    if (line[index] === "|") {
      seen += 1;

      if (seen === columnIndex) {
        return Math.min(index + 2, line.length);
      }
    }
  }

  return line.length;
}

function getLineStarts(value) {
  const starts = [0];

  for (let index = 0; index < value.length; index += 1) {
    if (value[index] === "\n") {
      starts.push(index + 1);
    }
  }

  return starts;
}

function getLineIndex(lineStarts, offset) {
  let lineIndex = 0;

  for (let index = 0; index < lineStarts.length; index += 1) {
    if (lineStarts[index] <= offset) {
      lineIndex = index;
    } else {
      break;
    }
  }

  return lineIndex;
}

function transformSelectedLines(transform) {
  const value = editor.value;
  const start = editor.selectionStart;
  const end = editor.selectionEnd;
  const lineStart = value.lastIndexOf("\n", Math.max(0, start - 1)) + 1;
  const nextBreak = value.indexOf("\n", end);
  const lineEnd = nextBreak === -1 ? value.length : nextBreak;
  const block = value.slice(lineStart, lineEnd);
  const transformed = block.split("\n").map(transform).join("\n");

  editor.setRangeText(transformed, lineStart, lineEnd, "select");
  editor.selectionStart = lineStart;
  editor.selectionEnd = lineStart + transformed.length;
  focusEditor();
}

function togglePrefix(line, prefix) {
  return line.startsWith(prefix) ? line.slice(prefix.length) : `${prefix}${line}`;
}

function openSettings() {
  const config = readGithubConfig();
  githubFields.token.value = config.token || "";
  githubFields.url.value = config.url || buildGithubRepoUrl(config) || "";
  populateFileList(config.files || [], config.path || "");
  settingsBackdrop.hidden = false;
  settingsPanel.classList.add("is-open");
  settingsPanel.setAttribute("aria-hidden", "false");
}

function closeSettings() {
  cancelGithubPicker();
  settingsPanel.classList.remove("is-open");
  settingsPanel.setAttribute("aria-hidden", "true");
  settingsBackdrop.hidden = true;
}

async function handleGithubAction(action) {
  try {
    if (action === "save" || action === "refresh") {
      await refreshGithubFileList();
      return;
    }

    if (action === "pull") {
      await pullFromGithub();
    }

    if (action === "push") {
      await pushToGithub();
    }
  } catch (error) {
    console.error(error);
    showToast(error.message || "GitHub 操作失败", "error");
  }
}

function readGithubConfig() {
  try {
    const config = JSON.parse(localStorage.getItem(GITHUB_CONFIG_KEY) || "{}");

    if (!config.url && config.owner && config.repo) {
      config.url = buildGithubRepoUrl(config);
    }

    return config;
  } catch {
    return {};
  }
}

function saveGithubConfigFromFields(pathOverride) {
  const previous = readGithubConfig();
  const parsed = parseGithubUrl(githubFields.url.value);
  const sameRepo = previous.owner === parsed.owner && previous.repo === parsed.repo;
  const pathSource = pathOverride ?? (parsed.path || (sameRepo ? previous.path || "" : ""));
  const path = normalizeRepoPath(pathSource);
  const config = {
    token: githubFields.token.value.trim(),
    url: parsed.url,
    owner: parsed.owner,
    repo: parsed.repo,
    branch: parsed.branch || (sameRepo ? previous.branch : "") || "main",
    branchFromUrl: Boolean(parsed.branch),
    path,
    files: sameRepo ? previous.files || [] : []
  };

  localStorage.setItem(GITHUB_CONFIG_KEY, JSON.stringify(config));
  return config;
}

function validateGithubRepoConfig(config, requiresWrite = false) {
  if (!config.owner || !config.repo) {
    throw new Error("请填写 GitHub 仓库地址");
  }

  if (requiresWrite && !config.token) {
    throw new Error("上传需要填写 GitHub Token");
  }
}

function validateGithubFileConfig(config, requiresWrite = false) {
  validateGithubRepoConfig(config, requiresWrite);

  if (!config.path) {
    throw new Error("请选择 Markdown 文件");
  }
}

async function pullFromGithub() {
  let config = await prepareGithubConfig();
  const files = await refreshGithubFileListForConfig(config);
  const path = await pickGithubFile({
    mode: "pull",
    files,
    selectedPath: config.path
  });

  if (!path) {
    return;
  }

  config = saveGithubConfigFromFields(path);
  populateFileList(files, config.path);
  config = await ensureDefaultBranch(config);
  validateGithubFileConfig(config);
  showToast("正在拉取");
  const file = await getGithubFile(config);
  const content = await decodeBase64(file.content || "");
  receiveDocument(content, config.path);
  showToast("✓ 拉取成功", "success");
}

async function pushToGithub() {
  let config = await prepareGithubConfig(true);
  const files = await refreshGithubFileListForConfig(config);
  const path = await pickGithubFile({
    mode: "push",
    files,
    selectedPath: config.path,
    defaultNewPath: `${getDocumentTitle()}.md`
  });

  if (!path) {
    return;
  }

  config = saveGithubConfigFromFields(path);
  populateFileList(files, config.path);
  config = await ensureDefaultBranch(config);
  validateGithubFileConfig(config, true);
  saveDraft();
  showToast("正在上传");

  let sha = null;
  try {
    const existing = await getGithubFile(config);
    sha = existing.sha;
  } catch (error) {
    if (!String(error.message).includes("404")) {
      throw error;
    }
  }

  const body = {
    message: `${sha ? "Update" : "Create"} ${config.path}`,
    content: await encodeBase64(editor.value),
    branch: config.branch
  };

  if (sha) {
    body.sha = sha;
  }

  await githubRequest(config, {
    method: "PUT",
    body: JSON.stringify(body)
  });

  if (!config.files.includes(config.path)) {
    config.files = [...config.files, config.path].sort((a, b) => a.localeCompare(b));
    localStorage.setItem(GITHUB_CONFIG_KEY, JSON.stringify(config));
    populateFileList(config.files, config.path);
  }

  showToast("✓ 上传成功", "success");
}

async function getGithubFile(config) {
  return githubRequest(config, { method: "GET" });
}

async function prepareGithubConfig(requiresWrite = false) {
  let config = saveGithubConfigFromFields();
  validateGithubRepoConfig(config, requiresWrite);
  config = await ensureDefaultBranch(config);
  return config;
}

async function refreshGithubFileList() {
  const config = await prepareGithubConfig();
  await refreshGithubFileListForConfig(config);
}

async function refreshGithubFileListForConfig(config) {
  validateGithubRepoConfig(config);

  showToast("正在读取文件列表");
  const files = await listGithubFiles(config);
  config.files = files;
  localStorage.setItem(GITHUB_CONFIG_KEY, JSON.stringify(config));
  populateFileList(files, config.path);
  showToast(files.length ? "文件列表已更新" : "没有找到 Markdown 文件", files.length ? "success" : "error");
  return files;
}

function pickGithubFile(options) {
  return new Promise((resolve) => {
    const mode = options.mode;
    const files = options.files || [];
    const selectedPath = options.selectedPath || "";

    githubPickerState = {
      mode,
      resolve
    };

    githubPicker.title.textContent = mode === "pull" ? "选择拉取文件" : "选择上传位置";
    githubPicker.selectLabel.textContent = mode === "pull" ? "拉取文件" : "覆盖文件";
    githubPicker.select.textContent = "";
    githubPicker.select.disabled = !files.length;

    const empty = document.createElement("option");
    empty.value = "";
    empty.textContent = files.length ? "选择仓库文件" : "仓库中没有 Markdown 文件";
    githubPicker.select.append(empty);

    files.forEach((path) => {
      const option = document.createElement("option");
      option.value = path;
      option.textContent = path;
      option.selected = path === selectedPath;
      githubPicker.select.append(option);
    });

    const allowNew = mode === "push";
    githubPicker.newPathField.hidden = !allowNew;
    githubPicker.newPath.value = "";
    githubPicker.newPath.placeholder = options.defaultNewPath || `${getDocumentTitle()}.md`;
    githubPicker.note.textContent = allowNew
      ? "选择已有文件会覆盖；填写新文件名会新建。"
      : "选择后会覆盖当前编辑区内容。";

    githubPicker.backdrop.hidden = false;
    githubPicker.panel.classList.add("is-open");
    githubPicker.panel.setAttribute("aria-hidden", "false");

    if (allowNew && !files.length) {
      window.setTimeout(() => githubPicker.newPath.focus({ preventScroll: true }), 80);
    } else {
      window.setTimeout(() => githubPicker.select.focus({ preventScroll: true }), 80);
    }
  });
}

function confirmGithubPicker() {
  if (!githubPickerState) {
    return;
  }

  const mode = githubPickerState.mode;
  const newPath = mode === "push" ? normalizeNewGithubPath(githubPicker.newPath.value) : "";
  const selectedPath = normalizeRepoPath(githubPicker.select.value);
  const path = newPath || selectedPath;

  if (!path) {
    showToast(mode === "push" ? "请选择文件或输入新文件名" : "请选择要拉取的文件", "error");
    return;
  }

  closeGithubPicker(path);
}

function cancelGithubPicker() {
  closeGithubPicker("");
}

function closeGithubPicker(value) {
  if (!githubPickerState) {
    return;
  }

  const state = githubPickerState;
  githubPickerState = null;
  githubPicker.panel.classList.remove("is-open");
  githubPicker.panel.setAttribute("aria-hidden", "true");
  githubPicker.backdrop.hidden = true;
  state.resolve(value);
}

async function listGithubFiles(config) {
  const branch = encodeURIComponent(config.branch || "main");
  const url = `https://api.github.com/repos/${encodeURIComponent(config.owner)}/${encodeURIComponent(config.repo)}/git/trees/${branch}?recursive=1`;
  const payload = await githubFetch(config, url, { method: "GET" });
  const blobs = (payload.tree || [])
    .filter((item) => item.type === "blob")
    .map((item) => item.path)
    .filter(Boolean)
    .sort((a, b) => a.localeCompare(b));
  const markdownFiles = blobs.filter((path) => /\.(md|markdown|mdown)$/i.test(path));

  return markdownFiles;
}

async function ensureDefaultBranch(config) {
  if (config.branchFromUrl && config.branch) {
    return config;
  }

  const url = `https://api.github.com/repos/${encodeURIComponent(config.owner)}/${encodeURIComponent(config.repo)}`;
  const repo = await githubFetch(config, url, { method: "GET" });
  config.branch = repo.default_branch || config.branch || "main";
  localStorage.setItem(GITHUB_CONFIG_KEY, JSON.stringify(config));
  return config;
}

async function githubRequest(config, options) {
  const path = encodeRepoPath(config.path);
  const branch = encodeURIComponent(config.branch || "main");
  const url = `https://api.github.com/repos/${encodeURIComponent(config.owner)}/${encodeURIComponent(config.repo)}/contents/${path}${options.method === "GET" ? `?ref=${branch}` : ""}`;
  return githubFetch(config, url, options);
}

async function githubFetch(config, url, options) {
  const headers = {
    "Accept": "application/vnd.github+json",
    "Content-Type": "application/json",
    "X-GitHub-Api-Version": "2022-11-28"
  };

  if (config.token) {
    headers.Authorization = `Bearer ${config.token}`;
  }

  const response = await fetch(url, {
    method: options.method,
    headers,
    body: options.body
  });

  if (!response.ok) {
    let message = `GitHub ${response.status}`;
    try {
      const payload = await response.json();
      message = payload.message ? `${message}: ${payload.message}` : message;
    } catch {}
    throw new Error(message);
  }

  return response.json();
}

function parseGithubUrl(value) {
  const input = value.trim();

  if (!input) {
    throw new Error("请填写 GitHub 地址");
  }

  let url;
  try {
    url = new URL(/^https?:\/\//i.test(input) ? input : `https://${input}`);
  } catch {
    throw new Error("GitHub 地址格式不正确");
  }

  if (!/github\.com$/i.test(url.hostname)) {
    throw new Error("请填写 github.com 地址");
  }

  const parts = url.pathname.split("/").filter(Boolean);
  const owner = parts[0] || "";
  const repo = (parts[1] || "").replace(/\.git$/i, "");

  if (!owner || !repo) {
    throw new Error("GitHub 地址需要包含 owner/repo");
  }

  let branch = "";
  let path = "";

  if ((parts[2] === "blob" || parts[2] === "tree") && parts[3]) {
    branch = parts[3];
    path = parts.slice(4).join("/");
  }

  return {
    url: `https://github.com/${owner}/${repo}`,
    owner,
    repo,
    branch,
    path: normalizeRepoPath(path)
  };
}

function buildGithubRepoUrl(config) {
  if (!config.owner || !config.repo) {
    return "";
  }

  return `https://github.com/${config.owner}/${config.repo}`;
}

function populateFileList(files, selectedPath) {
  const select = githubFields.fileList;
  select.textContent = "";

  if (!files.length) {
    const option = document.createElement("option");
    option.value = "";
    option.textContent = "没有缓存的文件列表";
    select.append(option);
    return;
  }

  const empty = document.createElement("option");
  empty.value = "";
  empty.textContent = "选择仓库文件";
  select.append(empty);

  files.forEach((path) => {
    const option = document.createElement("option");
    option.value = path;
    option.textContent = path;
    option.selected = path === selectedPath;
    select.append(option);
  });
}

function normalizeRepoPath(path) {
  return path.trim().replace(/^\/+/, "").replace(/\/+$/, "");
}

function normalizeNewGithubPath(path) {
  const normalized = normalizeRepoPath(path);

  if (!normalized) {
    return "";
  }

  const fileName = normalized.split("/").pop() || "";
  return /\.[a-z0-9]+$/i.test(fileName) ? normalized : `${normalized}.md`;
}

function encodeRepoPath(path) {
  return normalizeRepoPath(path).split("/").map(encodeURIComponent).join("/");
}

async function decodeBase64(base64) {
  const clean = base64.replace(/\s/g, "");
  const response = await fetch(`data:application/octet-stream;base64,${clean}`);
  const buffer = await response.arrayBuffer();
  return new TextDecoder("utf-8").decode(buffer);
}

async function encodeBase64(value) {
  const bytes = new TextEncoder().encode(value);
  let binary = "";
  const chunkSize = 0x8000;

  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize));
  }

  return btoa(binary);
}

function hasNativeBridge() {
  return Boolean(window.NativeMarkdown);
}

function focusEditor() {
  editor.focus({ preventScroll: true });
}

function showToast(message, tone = "") {
  window.clearTimeout(toastTimer);
  toast.textContent = message;
  toast.classList.toggle("is-success", tone === "success");
  toast.classList.toggle("is-error", tone === "error");
  toast.classList.add("is-visible");
  toastTimer = window.setTimeout(() => {
    toast.classList.remove("is-visible");
    toast.classList.remove("is-success");
    toast.classList.remove("is-error");
  }, 1800);
}

function escapeHtml(value) {
  return value.replace(/[&<>"']/g, (char) => {
    const entities = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      "\"": "&quot;",
      "'": "&#39;"
    };
    return entities[char];
  });
}
