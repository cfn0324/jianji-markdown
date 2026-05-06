const STORAGE_KEY = "simple-mobile-markdown:draft:v1";
const VIEW_KEY = "simple-mobile-markdown:view:v1";

const editor = document.querySelector("#editor");
const preview = document.querySelector("#preview");
const workspace = document.querySelector("#workspace");
const fileInput = document.querySelector("#fileInput");
const saveState = document.querySelector("#saveState");
const toast = document.querySelector("#toast");

const defaultDraft = "# 未命名\n\n";
let toastTimer = 0;
let renderTimer = 0;
let saveTimer = 0;

const md = createMarkdownRenderer();

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
  document.querySelector("[data-action='open']").addEventListener("click", () => fileInput.click());
  document.querySelector("[data-action='save']").addEventListener("click", exportDocument);

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
    showToast("Mermaid 渲染失败");
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

async function importDocument() {
  const file = fileInput.files?.[0];
  if (!file) {
    return;
  }

  editor.value = await file.text();
  fileInput.value = "";
  saveDraft();
  renderNow();
  setView("edit");
  focusEditor();
  showToast("已打开");
}

async function exportDocument() {
  saveDraft();
  const fileName = `${getDocumentTitle()}.md`;
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
  showToast("已导出");
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
  insertPlain("\n| 项目 | 内容 |\n| --- | --- |\n|  |  |\n");
}

function insertPlain(text) {
  const start = editor.selectionStart;
  editor.setRangeText(text, editor.selectionStart, editor.selectionEnd, "end");
  editor.selectionStart = editor.selectionEnd = start + text.length;
  focusEditor();
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

function focusEditor() {
  editor.focus({ preventScroll: true });
}

function showToast(message) {
  window.clearTimeout(toastTimer);
  toast.textContent = message;
  toast.classList.add("is-visible");
  toastTimer = window.setTimeout(() => {
    toast.classList.remove("is-visible");
  }, 1600);
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
