// Injected on demand by sidepanel.js (via chrome.scripting.executeScript) when the
// user clicks "Analyze Current Page". Extracts the visible job description text
// from the active tab and sends it back to the side panel.
(function extractAndSendJobText() {
  const CANDIDATE_SELECTORS = [
    // LinkedIn
    ".jobs-description__content",
    ".jobs-description-content__text",
    ".jobs-box__html-content",
    // Indeed
    "#jobDescriptionText",
    ".jobsearch-jobDescriptionText",
    // Glassdoor
    '[data-test="jobDescription"]',
    ".JobDetails_jobDescription__uW_fK",
    // Lever
    ".posting-requirements",
    ".posting-description",
    // Greenhouse
    "#content",
    ".app-body",
    "#job-application-container",
    // Workday / generic ATS fallbacks
    '[data-automation-id="jobPostingDescription"]',
    // Generic fallbacks
    "article",
    "main"
  ];

  const COMPANY_SELECTORS = [
    "[data-company-name]",
    ".jobs-unified-top-card__company-name",
    ".job-details-jobs-unified-top-card__company-name",
    ".jobsearch-CompanyInfoContainer a",
    ".jobsearch-InlineCompanyRating div a",
    '[data-test="employerName"]',
    ".employerName",
    '[itemprop="hiringOrganization"] [itemprop="name"]',
    ".company-name",
    ".posting-headline .company-name"
  ];

  // Elements that never carry job-description content but routinely get
  // swept up by loosely-matched containers (article/main/body fallback) —
  // stripped before reading text so Gemini isn't billed to read nav links,
  // cookie banners, share widgets, etc.
  const STRIP_SELECTORS = [
    "script", "style", "noscript", "svg", "iframe", "template",
    "nav", "header", "footer", "form",
    "button", "input", "select", "textarea", "label",
    '[aria-hidden="true"]', '[role="navigation"]', '[role="banner"]', '[role="contentinfo"]',
    '[class*="cookie" i]', '[class*="banner" i]', '[class*="advert" i]', '[class*="promo" i]',
    '[class*="related-jobs" i]', '[class*="similar-jobs" i]', '[class*="share" i]'
  ].join(",");

  // Hard cap on characters sent to Gemini as a cost/safety net against
  // pathologically large pages slipping past the selectors above.
  const MAX_CHARS = 15000;

  function isUsableText(text) {
    return !!text && text.trim().length > 150;
  }

  function cleanElementText(root) {
    const clone = root.cloneNode(true);
    clone.querySelectorAll(STRIP_SELECTORS).forEach((el) => el.remove());

    // innerText needs a real layout box to compute correctly — a detached
    // clone has none and silently reads back empty in Chrome. Mount it
    // off-screen just long enough to read it, then remove it immediately;
    // the live page is never visibly touched.
    clone.style.position = "fixed";
    clone.style.top = "-99999px";
    clone.style.left = "-99999px";
    clone.style.maxWidth = "none";
    document.body.appendChild(clone);
    const text = clone.innerText || clone.textContent || "";
    clone.remove();

    return text.replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  }

  function extractJobText() {
    for (const selector of CANDIDATE_SELECTORS) {
      const el = document.querySelector(selector);
      if (!el) continue;
      const cleaned = cleanElementText(el);
      if (isUsableText(cleaned)) {
        return cleaned.slice(0, MAX_CHARS);
      }
    }
    // Fallback: whole page body, stripped of chrome/boilerplate.
    if (!document.body) return "";
    return cleanElementText(document.body).slice(0, MAX_CHARS);
  }

  // Best-effort only — used to show a friendlier "Asking Gemini about X..."
  // status line while waiting on the real answer. The authoritative company
  // name/title come back from Gemini itself, which reads the full posting.
  function extractCompanyGuess() {
    for (const selector of COMPANY_SELECTORS) {
      const text = document.querySelector(selector)?.textContent?.trim();
      if (text && text.length > 1 && text.length < 80) return text;
    }
    const ogSiteName = document.querySelector('meta[property="og:site_name"]')?.content?.trim();
    if (ogSiteName) return ogSiteName;
    const atMatch = (document.title || "").match(/\bat\s+([A-Z][\w&.,'\- ]{1,60})/);
    if (atMatch) return atMatch[1].trim();
    return "";
  }

  const text = extractJobText();
  const company = extractCompanyGuess();

  chrome.runtime.sendMessage({
    type: "JOB_MATCH_AI_EXTRACTED_TEXT",
    text,
    company,
    url: window.location.href,
    title: document.title
  });
})();
