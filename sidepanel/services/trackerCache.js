import { sanitizeCacheTtlHours } from "../../shared/settingsSchema.js";
export { sanitizeCacheTtlHours };

const CACHE_KEY = "trackerCache";

export async function readTrackerCache() {
  const stored = await chrome.storage.local.get(CACHE_KEY);
  const cache = stored[CACHE_KEY];
  if (!cache || !Array.isArray(cache.items) || !cache.savedAt) return null;
  return cache;
}

export async function writeTrackerCache(items, savedAt = Date.now()) {
  await chrome.storage.local.set({ [CACHE_KEY]: { items, savedAt } });
  return savedAt;
}

export async function clearTrackerCache() {
  await chrome.storage.local.remove(CACHE_KEY);
}

export function isCacheFresh(cache, ttlHours) {
  if (!cache) return false;
  return Date.now() - cache.savedAt < sanitizeCacheTtlHours(ttlHours) * 3600000;
}

export function cacheAgeLabel(savedAt) {
  if (!savedAt) return "";
  const minutes = Math.floor((Date.now() - savedAt) / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}
