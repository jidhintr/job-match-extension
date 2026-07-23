// Injected on demand (via chrome.scripting.executeScript) when the user clicks
// "Scan and Filter". Scans a job LIST page (not a single posting) and sends
// back {title, company, url, applyUrl, description} per job found.
//
// Deliberately read-only: this never clicks, navigates, or triggers any
// request beyond what the page already loaded on its own. On LinkedIn in
// particular, clicking through cards to preview each one is exactly the kind
// of fast, regular, automated interaction pattern anti-bot heuristics flag —
// so instead of clicking anything, we only read whatever's already rendered
// in the list DOM. That means no full job description for list-only sites
// like LinkedIn (its cards show title/company/location, not a blurb), so the
// match score leans more on title/company semantics than a generic site with
// visible list-item descriptions — a real accuracy trade-off, made
// deliberately in favor of never touching your account's standing.
(function scanJobList() {
  const MAX_JOBS = 10;
  const isLinkedIn = location.hostname.includes("linkedin.com");

  function cleanText(el) {
    if (!el) return "";
    return (el.innerText || el.textContent || "").replace(/[ \t]+/g, " ").replace(/\n{2,}/g, "\n").trim();
  }

  // LinkedIn ships several different DOM structures for job lists depending
  // on the surface (dedicated /jobs/search/ results vs. the homepage "Top
  // picks for you" feed vs. others), and changes them without notice — these
  // selectors cover the known ones, but card matching may still miss on a
  // layout we haven't seen. scanGeneric() below is the safety net either way.
  // Two different URL schemes carry a LinkedIn job link depending on the
  // surface: a direct /jobs/view/<id> path, or the current search/collections
  // list's own URL with a ?currentJobId=<id> query param (used on e.g.
  // /jobs/search-results/). Both need to be recognized as "this is a job".
  const JOB_LINK_SELECTOR = 'a[href*="/jobs/view/"], a[href*="currentJobId="]';

  // currentJobId-style links all share the SAME base path (only the query
  // param differs), so naively stripping "?..." to dedupe/normalize would
  // collapse every job on the page into one. Extract the real id instead and
  // rebuild a stable, standalone /jobs/view/ URL that works clicked out of
  // context (not dependent on this page's list state being loaded).
  function normalizeJobUrl(href) {
    try {
      const u = new URL(href, location.href);
      const viewMatch = u.pathname.match(/\/jobs\/view\/(\d+)/);
      const id = viewMatch ? viewMatch[1] : u.searchParams.get("currentJobId");
      if (id) return `https://www.linkedin.com/jobs/view/${id}/`;
    } catch {
      // fall through
    }
    return href.split("?")[0];
  }

  function scanLinkedIn() {
    const cardSelectors = [
      "li.jobs-search-results__list-item",
      "div.job-card-container",
      "li[data-occludable-job-id]",
      "div.job-card-job-posting-card-wrapper",
      '[data-view-name="job-card"]'
    ];
    const cards = Array.from(document.querySelectorAll(cardSelectors.join(","))).slice(0, MAX_JOBS);

    const results = [];
    for (const card of cards) {
      const titleEl = card.querySelector(`${JOB_LINK_SELECTOR}, a.job-card-list__title, a.job-card-container__link`);
      const companyEl = card.querySelector(
        '.artdeco-entity-lockup__subtitle, .job-card-container__primary-description, .job-card-container__company-name'
      );
      const metaEl = card.querySelector('.artdeco-entity-lockup__caption, .job-card-container__metadata-wrapper');
      const title = cleanText(titleEl);
      const company = cleanText(companyEl);
      const meta = cleanText(metaEl);
      if (!title || !titleEl?.href) continue;
      const url = normalizeJobUrl(titleEl.href);

      // No detail-pane description available without clicking (see header
      // note) — matching falls back to title + company + visible metadata.
      results.push({ title, company, url, applyUrl: url, description: [title, company, meta].filter(Boolean).join(" — ") });
    }
    return results;
  }

  // LinkedIn-specific second tier: when the structured card selectors above
  // miss (different page/layout), fall back to hunting job links directly by
  // URL pattern rather than giving up. Deliberately never falls through to
  // the generic "any visible link" scanner on LinkedIn: that's what
  // previously picked up feed posts, reaction counts, and "people you may
  // know" cards from sidebar/feed widgets sharing the same design-system
  // classes as real job cards.
  function scanLinkedInByJobLinks() {
    const EXCLUDE_ANCESTOR = 'aside, [class*="feed" i], [class*="update" i], [data-view-name*="feed" i], [class*="follow" i]';
    const links = Array.from(document.querySelectorAll(JOB_LINK_SELECTOR)).filter((a) => {
      const text = cleanText(a);
      return text.length > 3 && !a.closest(EXCLUDE_ANCESTOR);
    });

    const seenUrls = new Set();
    const results = [];
    for (const a of links) {
      if (results.length >= MAX_JOBS) break;
      const url = normalizeJobUrl(a.href);
      if (seenUrls.has(url)) continue;
      seenUrls.add(url);

      const title = cleanText(a);
      const card = a.closest("li, div[data-occludable-job-id]") || a.parentElement;
      const companyEl = card?.querySelector(".artdeco-entity-lockup__subtitle, .job-card-container__company-name");
      const company = cleanText(companyEl);

      results.push({ title, company, url, applyUrl: url, description: [title, company].filter(Boolean).join(" — ") });
    }
    return results;
  }

  // Site-agnostic fallback for non-LinkedIn sites only: any visible link
  // whose href looks like a job posting. Preferred over a plain text-length
  // heuristic because it filters out nav bar / footer / unrelated links.
  const JOB_URL_HINT = /\/(jobs?|careers?|positions?|openings?)\b.*\/(view|apply|\d)|job[-_]?id=|gh_jid=|greenhouse\.io|lever\.co|workday/i;

  function scanGeneric() {
    let anchors = Array.from(document.querySelectorAll("a[href]")).filter((a) => {
      const text = cleanText(a);
      const rect = a.getBoundingClientRect();
      return text.length > 6 && text.length < 120 && rect.width > 0 && rect.height > 0;
    });

    const jobLike = anchors.filter((a) => JOB_URL_HINT.test(a.href));
    if (jobLike.length > 0) anchors = jobLike;

    const seenTitles = new Set();
    const results = [];
    for (const a of anchors) {
      if (results.length >= MAX_JOBS) break;
      const title = cleanText(a);
      if (seenTitles.has(title)) continue;
      seenTitles.add(title);

      const container = a.closest("li, article") || a.parentElement;
      const containerText = cleanText(container);
      const company = containerText.replace(title, "").split(/\n|·|\|/)[0].trim().slice(0, 80);

      results.push({ title, company, url: a.href, applyUrl: a.href, description: containerText.slice(0, 2000) });
    }
    return results;
  }

  let jobs = [];
  try {
    if (isLinkedIn) {
      jobs = scanLinkedIn();
      if (jobs.length === 0) jobs = scanLinkedInByJobLinks();
    } else {
      jobs = scanGeneric();
    }
  } catch {
    jobs = [];
  }
  chrome.runtime.sendMessage({ type: "JOB_MATCH_LIST_SCAN_RESULT", jobs, siteUrl: location.href });
})();
