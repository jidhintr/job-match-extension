(function scanJobList() {
  const MAX_JOBS = 60;

  function cleanText(el) {
    if (!el) return "";
    return (el.innerText || el.textContent || "").replace(/[ \t]+/g, " ").replace(/\n{2,}/g, "\n").trim();
  }

  function normalizeUrl(href) {
    try {
      const u = new URL(href, location.href);
      u.hash = "";
      return u.href;
    } catch {
      return href;
    }
  }

  const JOB_URL_HINT = /\/(jobs?|careers?|vacanc(?:y|ies)|positions?|openings?|roles?)\b.*\/(view|apply|detail|\d)|job[-_]?id=|gh_jid=|greenhouse\.io|lever\.co|workday|myworkdayjobs|icims\.com|smartrecruiters\.com|taleo\.net|bamboohr\.com|breezy\.hr|personio\.|recruitee\.com|teamtailor\.com|ashbyhq\.com|jobvite\.com|currentJobId=/i;

  const JUNK_TEXT_HINT = /^(cookie|privacy|terms|imprint|legal|faq|about( us)?|contact( us)?|home|log ?in|sign ?in|log ?out|sign ?up|register|create account|my account|newsletter|subscribe|talent network|talent community|job alert|saved jobs|job cart|search|filter|show \d+ more|load more|see more|next|previous|back to (search|results|top)|share|print|apply now)$/i;
  const JUNK_URL_HINT = /cookie|privacy|\/login|\/signin|\/signup|\/register|newsletter|subscribe|talent-?network|talent-?community|job-?alert|jobcart|mailto:|tel:|javascript:/i;

  // Most career listing pages belong to a single employer, so this is a reliable fallback for
  // any job card whose own container text didn't yield a usable company name.
  function guessSiteCompany() {
    const metaNames = ['meta[property="og:site_name"]', 'meta[name="application-name"]', 'meta[name="author"]'];
    for (const sel of metaNames) {
      const val = document.querySelector(sel)?.content?.trim();
      if (val && val.length > 1 && val.length < 60) return val;
    }

    const titleParts = (document.title || "").split(/[|\-–—]/).map((p) => p.trim()).filter(Boolean);
    if (titleParts.length > 1) {
      const last = titleParts[titleParts.length - 1];
      if (last.length > 1 && last.length < 60 && !/careers?|jobs?|vacanc/i.test(last)) return last;
    }

    const host = location.hostname.replace(/^(www|careers?|jobs?|kariera|talent|hiring|apply)\./i, "");
    const name = host.split(".")[0];
    return name ? name.charAt(0).toUpperCase() + name.slice(1) : "";
  }

  function scanGeneric() {
    let anchors = Array.from(document.querySelectorAll("a[href]")).filter((a) => {
      const text = cleanText(a);
      const rect = a.getBoundingClientRect();
      if (text.length <= 3 || text.length >= 120 || rect.width <= 0 || rect.height <= 0) return false;
      if (JUNK_TEXT_HINT.test(text.replace(/\n/g, " ").trim())) return false;
      if (JUNK_URL_HINT.test(a.href)) return false;
      return true;
    });

    const jobLike = anchors.filter((a) => JOB_URL_HINT.test(a.href));
    if (jobLike.length > 0) anchors = jobLike;

    const siteCompany = guessSiteCompany();
    const seenUrls = new Set();
    const results = [];
    for (const a of anchors) {
      if (results.length >= MAX_JOBS) break;
      const url = normalizeUrl(a.href);
      if (seenUrls.has(url)) continue;
      seenUrls.add(url);

      const title = cleanText(a);
      const container = a.closest("li, article, [class*='job' i], [class*='card' i]") || a.parentElement;
      const containerText = cleanText(container);
      const company = containerText.replace(title, "").split(/\n|·|\|/)[0].trim().slice(0, 80);

      results.push({ title, company, companyFallback: siteCompany, url, applyUrl: url, description: containerText.slice(0, 2000) });
    }
    return results;
  }

  const SETTLE_QUIET_MS = 700;
  const MAX_WAIT_MS = 8000;

  function waitForStableDom() {
    return new Promise((resolve) => {
      let settled = false;
      let quietTimer = null;
      const finish = () => {
        if (settled) return;
        settled = true;
        observer.disconnect();
        clearTimeout(quietTimer);
        resolve();
      };
      const observer = new MutationObserver(() => {
        clearTimeout(quietTimer);
        quietTimer = setTimeout(finish, SETTLE_QUIET_MS);
      });
      observer.observe(document.documentElement, { childList: true, subtree: true });
      quietTimer = setTimeout(finish, SETTLE_QUIET_MS);
      setTimeout(finish, MAX_WAIT_MS);
    });
  }

  (async () => {
    let jobs = [];
    try {
      await waitForStableDom();
      jobs = scanGeneric();
    } catch {
      jobs = [];
    }
    chrome.runtime.sendMessage({ type: "JOB_MATCH_LIST_SCAN_RESULT", jobs, siteUrl: location.href });
  })();
})();
