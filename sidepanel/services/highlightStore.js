import { canonicalJobUrl } from "../ui/format.js";

const STORE_KEY = "mrHighlights";

async function readAll() {
  const data = await chrome.storage.local.get(STORE_KEY);
  return data[STORE_KEY] || {};
}

export async function getHighlights(url) {
  const key = canonicalJobUrl(url);
  return key ? (await readAll())[key] || [] : [];
}

async function save(url, items) {
  const key = canonicalJobUrl(url);
  if (!key) return;
  const all = await readAll();
  if (items.length) all[key] = items;
  else delete all[key];
  await chrome.storage.local.set({ [STORE_KEY]: all });
}

export async function removeHighlight(url, id) {
  const items = await getHighlights(url);
  await save(url, items.filter((item) => item.id !== id));
}

export async function clearHighlights(url, group = "all") {
  if (group === "all") return save(url, []);
  const items = await getHighlights(url);
  await save(url, items.filter((item) => (group === "colors" ? item.note : !item.note)));
}

export async function setNote(url, id, note) {
  const items = await getHighlights(url);
  const item = items.find((entry) => entry.id === id);
  if (!item || item.note === note) return;
  item.note = note;
  await save(url, items);
}

export async function reorderHighlights(url, order) {
  const items = await getHighlights(url);
  const byId = new Map(items.map((item) => [item.id, item]));
  const queues = { notes: [...order.notes], colors: [...order.colors] };
  const next = items.map((item) => byId.get(queues[item.note ? "notes" : "colors"].shift()));
  if (next.some((item) => !item)) return;
  await save(url, next);
}

export function onHighlightsChanged(callback) {
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && changes[STORE_KEY]) callback();
  });
}
