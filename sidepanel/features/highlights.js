import { state } from "../state/store.js";
import {
  tabButtons,
  tabButtonsByName,
  highlightsCount,
  colorGroup,
  colorList,
  noteGroup,
  noteList,
  clearColorsBtn,
  clearNotesBtn,
  clearHighlightsBtn
} from "../ui/dom.js";
import {
  getHighlights,
  removeHighlight,
  clearHighlights,
  setNote,
  reorderHighlights,
  onHighlightsChanged
} from "../services/highlightStore.js";

let tabWasVisible = false;

function navigate(tab) {
  window.dispatchEvent(new CustomEvent("app:navigate", { detail: { tab } }));
}

async function currentTabUrl() {
  if (state.tab.currentTabId == null) return "";
  const tab = await chrome.tabs.get(state.tab.currentTabId).catch(() => null);
  return tab?.url || "";
}

function scrollToHighlight(id) {
  if (state.tab.currentTabId == null) return;
  chrome.tabs.sendMessage(state.tab.currentTabId, { type: "MR_HL_SCROLL", id }).catch(() => {});
}

function buildCard(url, item) {
  const card = document.createElement("div");
  card.className = "highlight-card";
  card.draggable = true;
  card.dataset.id = item.id;
  card.style.borderLeftColor = item.color;

  const body = document.createElement("div");
  body.className = "highlight-body";

  const text = document.createElement("span");
  text.className = "highlight-text";
  text.textContent = item.text.trim();
  text.addEventListener("click", () => scrollToHighlight(item.id));
  body.appendChild(text);

  if (item.note) {
    const note = document.createElement("input");
    note.className = "highlight-note";
    note.value = item.note;
    note.addEventListener("mousedown", () => { card.draggable = false; });
    note.addEventListener("keydown", (event) => {
      if (event.key === "Enter") note.blur();
    });
    note.addEventListener("blur", () => {
      card.draggable = true;
      setNote(url, item.id, note.value.trim());
    });
    body.appendChild(note);
  }

  const remove = document.createElement("button");
  remove.className = "highlight-remove";
  remove.type = "button";
  remove.textContent = "✕";
  remove.addEventListener("click", () => removeHighlight(url, item.id));

  card.append(body, remove);
  return card;
}

function cardAfter(list, y) {
  return Array.from(list.querySelectorAll(".highlight-card:not(.dragging)")).find((card) => {
    const box = card.getBoundingClientRect();
    return y < box.top + box.height / 2;
  });
}

function idsIn(list) {
  return Array.from(list.children).map((card) => card.dataset.id);
}

async function persistOrder() {
  const url = await currentTabUrl();
  if (url) await reorderHighlights(url, { colors: idsIn(colorList), notes: idsIn(noteList) });
}

function wireDrag(list) {
  list.addEventListener("dragstart", (event) => {
    const card = event.target.closest?.(".highlight-card");
    if (!card) return;
    card.classList.add("dragging");
    event.dataTransfer.effectAllowed = "move";
  });

  list.addEventListener("dragover", (event) => {
    event.preventDefault();
    const dragging = list.querySelector(".dragging");
    if (!dragging) return;
    const next = cardAfter(list, event.clientY);
    if (next) list.insertBefore(dragging, next);
    else list.appendChild(dragging);
  });

  list.addEventListener("dragend", () => {
    list.querySelector(".dragging")?.classList.remove("dragging");
    persistOrder();
  });
}

export async function renderHighlights({ focus = false } = {}) {
  const url = await currentTabUrl();
  const items = url ? await getHighlights(url) : [];
  const notes = items.filter((item) => item.note);
  const colors = items.filter((item) => !item.note);
  const button = tabButtonsByName.highlights;
  const mixed = colors.length > 0 && notes.length > 0;

  button.classList.toggle("hidden", items.length === 0);
  highlightsCount.textContent = items.length === 1 ? "1 highlight" : `${items.length} highlights`;
  colorGroup.classList.toggle("hidden", colors.length === 0);
  noteGroup.classList.toggle("hidden", notes.length === 0);
  clearColorsBtn.classList.toggle("hidden", !mixed);
  clearNotesBtn.classList.toggle("hidden", !mixed);
  colorList.replaceChildren(...colors.map((item) => buildCard(url, item)));
  noteList.replaceChildren(...notes.map((item) => buildCard(url, item)));

  if (items.length && (focus || !tabWasVisible)) navigate("highlights");
  if (!items.length && button.classList.contains("active")) {
    const fallback = Array.from(tabButtons).find((b) => !b.classList.contains("hidden"));
    if (fallback) navigate(fallback.dataset.tab);
  }
  tabWasVisible = items.length > 0;
}

[colorList, noteList].forEach(wireDrag);

function wireClear(button, group) {
  button.addEventListener("click", async () => {
    const url = await currentTabUrl();
    if (url) await clearHighlights(url, group);
  });
}

wireClear(clearColorsBtn, "colors");
wireClear(clearNotesBtn, "notes");
wireClear(clearHighlightsBtn, "all");

onHighlightsChanged(renderHighlights);

chrome.runtime.onMessage.addListener((message, sender) => {
  if (message?.type !== "MR_HL_OPEN_PANEL") return;
  if (sender.tab?.id === state.tab.currentTabId) renderHighlights({ focus: true });
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (tabId === state.tab.currentTabId && changeInfo.url) renderHighlights();
});
