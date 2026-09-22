(() => {
  if (window.__mrHighlighter) return;
  window.__mrHighlighter = true;

  const STORE_KEY = "mrHighlights";
  const COLORS = ["#fff3a3", "#ffcf8b", "#b6f0c4", "#ffb3c7", "#d9b8ff", "#a9d8ff", "#9fe8e0", "#ffb4a2", "#e4f5a3"];
  const NOTE_COLOR = "#cfe0ff";
  const TRACKING_PARAM =
    /^(utm_.*|ga_.*|fbclid|gclid|msclkid|mc_cid|mc_eid|igshid|ref|referrer|source|src|trk|trackingid|origin|position|refid|pagenum|lipi|eBP)$/i;

  function pageKey() {
    try {
      const url = new URL(location.href);
      if (url.protocol !== "http:" && url.protocol !== "https:") return "";
      url.protocol = "https:";
      url.hostname = url.hostname.replace(/^www\./i, "").toLowerCase();
      url.hash = "";
      [...url.searchParams.keys()].forEach((key) => {
        if (TRACKING_PARAM.test(key)) url.searchParams.delete(key);
      });
      url.pathname = url.pathname.replace(/\/+$/, "");
      return url.toString().replace(/\/$/, "");
    } catch {
      return "";
    }
  }

  const host = document.createElement("div");
  const shadow = host.attachShadow({ mode: "open" });
  const style = document.createElement("style");
  style.textContent = `
    .pop {
      position: fixed;
      z-index: 2147483647;
      display: flex;
      flex-direction: column;
      gap: 6px;
      padding: 7px;
      width: 260px;
      border-radius: 10px;
      background: #1a1d27;
      border: 1px solid #2c3040;
      box-shadow: 0 8px 24px rgba(0, 0, 0, 0.45);
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    }
    .pop.hidden { display: none; }
    .row { display: flex; flex-wrap: wrap; gap: 5px; }
    .note {
      width: 100%;
      box-sizing: border-box;
      padding: 5px 7px;
      border-radius: 6px;
      border: 1px solid #2c3040;
      background: #12141c;
      color: #e6e8ef;
      font-size: 12px;
      font-family: inherit;
      outline: none;
    }
    .note:focus { border-color: #4c8dff; }
    .swatch {
      width: 20px;
      height: 20px;
      border-radius: 6px;
      border: 1px solid rgba(255, 255, 255, 0.25);
      cursor: pointer;
      padding: 0;
    }
    .swatch:hover { transform: scale(1.12); }
    .remove {
      width: 20px;
      height: 20px;
      border-radius: 6px;
      border: 1px solid #2c3040;
      background: #20232f;
      color: #e6e8ef;
      cursor: pointer;
      font-size: 13px;
      line-height: 1;
      padding: 0;
    }
    .remove:hover { background: #e5484d; border-color: #e5484d; }
  `;
  const pop = document.createElement("div");
  pop.className = "pop hidden";
  shadow.append(style, pop);
  document.documentElement.appendChild(host);

  function hidePopup() {
    pop.classList.add("hidden");
  }

  function showPopup(rect, { note = "", onApply, onRemove, focusNote = false }) {
    pop.replaceChildren();

    const input = document.createElement("input");
    input.className = "note";
    input.value = note;
    input.placeholder = "Note or question";
    input.addEventListener("keydown", (event) => {
      event.stopPropagation();
      if (event.key === "Escape") hidePopup();
      if (event.key !== "Enter") return;
      hidePopup();
      onApply("", input.value.trim());
    });

    const row = document.createElement("div");
    row.className = "row";
    COLORS.forEach((color) => {
      const btn = document.createElement("button");
      btn.className = "swatch";
      btn.style.background = color;
      btn.addEventListener("mousedown", (e) => e.preventDefault());
      btn.addEventListener("click", () => {
        hidePopup();
        onApply(color, input.value.trim());
      });
      row.appendChild(btn);
    });
    if (onRemove) {
      const btn = document.createElement("button");
      btn.className = "remove";
      btn.textContent = "✕";
      btn.addEventListener("mousedown", (e) => e.preventDefault());
      btn.addEventListener("click", () => {
        hidePopup();
        onRemove();
      });
      row.appendChild(btn);
    }

    pop.append(row, input);
    pop.classList.remove("hidden");
    const width = pop.offsetWidth;
    const above = rect.top - pop.offsetHeight - 8;
    const left = Math.min(Math.max(8, rect.left + rect.width / 2 - width / 2), window.innerWidth - width - 8);
    pop.style.left = `${left}px`;
    pop.style.top = `${above > 8 ? above : rect.bottom + 8}px`;
    if (focusNote) input.focus({ preventScroll: true });
  }

  function textBuffer() {
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        const tag = node.parentNode?.nodeName;
        if (!node.nodeValue || tag === "SCRIPT" || tag === "STYLE" || tag === "NOSCRIPT") return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      }
    });
    const nodes = [];
    let text = "";
    let node;
    while ((node = walker.nextNode())) {
      nodes.push({ node, start: text.length });
      text += node.nodeValue;
    }
    return { nodes, text };
  }

  function rangeOffsets(buffer, range) {
    let start = -1;
    let end = -1;
    for (const entry of buffer.nodes) {
      if (!range.intersectsNode(entry.node)) continue;
      const from = entry.node === range.startContainer ? range.startOffset : 0;
      const to = entry.node === range.endContainer ? range.endOffset : entry.node.nodeValue.length;
      if (start === -1) start = entry.start + from;
      end = entry.start + to;
    }
    return { start, end };
  }

  function locate(buffer, offset) {
    for (const entry of buffer.nodes) {
      if (offset <= entry.start + entry.node.nodeValue.length) {
        return { node: entry.node, offset: Math.max(0, offset - entry.start) };
      }
    }
    return null;
  }

  function styleMark(mark, item) {
    mark.style.backgroundColor = item.color;
    mark.style.color = "#1a1a1a";
    mark.style.borderRadius = "2px";
    mark.style.cursor = "pointer";
    mark.style.borderBottom = item.note ? "2px dashed rgba(0, 0, 0, 0.45)" : "none";
    if (item.note) mark.title = item.note;
    else mark.removeAttribute("title");
  }

  function wrapRange(range, item) {
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, null);
    const targets = [];
    let node;
    while ((node = walker.nextNode())) {
      if (!node.nodeValue || !range.intersectsNode(node)) continue;
      if (node.parentNode?.classList?.contains("mr-hl")) continue;
      const from = node === range.startContainer ? range.startOffset : 0;
      const to = node === range.endContainer ? range.endOffset : node.nodeValue.length;
      if (to > from) targets.push({ node, from, to });
    }

    targets.forEach(({ node, from, to }) => {
      let target = from > 0 ? node.splitText(from) : node;
      if (to - from < target.nodeValue.length) target.splitText(to - from);
      const mark = document.createElement("mark");
      mark.className = "mr-hl";
      mark.dataset.mrId = item.id;
      styleMark(mark, item);
      target.parentNode.replaceChild(mark, target);
      mark.appendChild(target);
    });

    return targets.length > 0;
  }

  function marksFor(id) {
    return document.querySelectorAll(`mark.mr-hl[data-mr-id="${id}"]`);
  }

  function unwrap(id) {
    marksFor(id).forEach((mark) => {
      const parent = mark.parentNode;
      while (mark.firstChild) parent.insertBefore(mark.firstChild, mark);
      parent.removeChild(mark);
      parent.normalize();
    });
  }

  function applyItem(item) {
    if (marksFor(item.id).length) return;
    const buffer = textBuffer();
    let index = -1;
    let from = 0;
    for (let i = 0; i <= item.occurrence; i++) {
      index = buffer.text.indexOf(item.text, from);
      if (index === -1) return;
      from = index + 1;
    }
    const start = locate(buffer, index);
    const end = locate(buffer, index + item.text.length);
    if (!start || !end) return;
    const range = document.createRange();
    range.setStart(start.node, start.offset);
    range.setEnd(end.node, end.offset);
    wrapRange(range, item);
  }

  async function readAll() {
    const data = await chrome.storage.local.get(STORE_KEY);
    return data[STORE_KEY] || {};
  }

  async function readItems() {
    const all = await readAll();
    return all[pageKey()] || [];
  }

  async function writeItems(items) {
    const key = pageKey();
    if (!key) return;
    const all = await readAll();
    if (items.length) all[key] = items;
    else delete all[key];
    await chrome.storage.local.set({ [STORE_KEY]: all });
  }

  async function addHighlight(range, color, note) {
    const buffer = textBuffer();
    const { start, end } = rangeOffsets(buffer, range);
    if (start < 0 || end <= start) return;

    const text = buffer.text.slice(start, end);
    if (!text.trim()) return;

    let occurrence = 0;
    let from = 0;
    let index;
    while ((index = buffer.text.indexOf(text, from)) !== -1 && index < start) {
      occurrence++;
      from = index + 1;
    }

    const item = { id: `${Date.now()}${Math.random().toString(36).slice(2, 7)}`, text, color, note, occurrence };
    if (!wrapRange(range, item)) return;
    const items = await readItems();
    items.push(item);
    await writeItems(items);
  }

  async function updateItem(id, color, note) {
    const items = await readItems();
    const item = items.find((i) => i.id === id);
    if (!item) return;
    if (color) item.color = color;
    item.note = note;
    marksFor(id).forEach((mark) => styleMark(mark, item));
    await writeItems(items);
  }

  async function removeHighlight(id) {
    unwrap(id);
    const items = await readItems();
    await writeItems(items.filter((i) => i.id !== id));
  }

  async function render() {
    const items = await readItems();
    const byId = new Map(items.map((i) => [i.id, i]));
    document.querySelectorAll("mark.mr-hl").forEach((mark) => {
      const item = byId.get(mark.dataset.mrId);
      if (item) styleMark(mark, item);
      else unwrap(mark.dataset.mrId);
    });
    items.forEach(applyItem);
  }

  document.addEventListener("mouseup", (event) => {
    if (event.target === host) return;
    const onMark = !!event.target?.closest?.("mark.mr-hl");
    setTimeout(() => {
      const selection = window.getSelection();
      if (!selection || selection.isCollapsed || !selection.rangeCount || !selection.toString().trim()) {
        if (!onMark) hidePopup();
        return;
      }
      const saved = selection.getRangeAt(0).cloneRange();
      showPopup(saved.getBoundingClientRect(), {
        focusNote: true,
        onApply: (color, note) => {
          if (!color && !note) return;
          selection.removeAllRanges();
          addHighlight(saved, color || NOTE_COLOR, note);
        }
      });
    }, 0);
  });

  document.addEventListener(
    "click",
    (event) => {
      const mark = event.target?.closest?.("mark.mr-hl");
      if (!mark) {
        if (event.target !== host) hidePopup();
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      const id = mark.dataset.mrId;
      showPopup(mark.getBoundingClientRect(), {
        note: mark.title,
        focusNote: true,
        onApply: (color, note) => updateItem(id, color, note),
        onRemove: () => removeHighlight(id)
      });
      chrome.runtime.sendMessage({ type: "MR_HL_OPEN_PANEL" }).catch(() => {});
    },
    true
  );

  document.addEventListener("scroll", hidePopup, true);
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") hidePopup();
  });

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && changes[STORE_KEY]) render();
  });

  chrome.runtime.onMessage.addListener((message) => {
    if (message?.type !== "MR_HL_SCROLL") return;
    const mark = marksFor(message.id)[0];
    if (!mark) return;
    mark.scrollIntoView({ behavior: "smooth", block: "center" });
    mark.animate([{ filter: "brightness(1)" }, { filter: "brightness(1.5)" }, { filter: "brightness(1)" }], { duration: 900 });
  });

  let lastKey = pageKey();
  setInterval(() => {
    const key = pageKey();
    if (key === lastKey) return;
    lastKey = key;
    document.querySelectorAll("mark.mr-hl").forEach((mark) => unwrap(mark.dataset.mrId));
    render();
  }, 1500);

  [0, 800, 2500].forEach((delay) => setTimeout(render, delay));
})();
