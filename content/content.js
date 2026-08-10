(function extractAndSendJobText() {
  const CANDIDATE_SELECTORS = [

    ".jobs-description__content",
    ".jobs-description-content__text",
    ".jobs-box__html-content",

    "#jobDescriptionText",
    ".jobsearch-jobDescriptionText",

    '[data-test="jobDescription"]',
    ".JobDetails_jobDescription__uW_fK",

    ".posting-requirements",
    ".posting-description",

    "#content",
    ".app-body",
    "#job-application-container",

    '[data-automation-id="jobPostingDescription"]',

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

  const STRIP_SELECTORS = [
    "script", "style", "noscript", "svg", "iframe", "template",
    "nav", "header", "footer", "form",
    "button", "input", "select", "textarea", "label",
    '[aria-hidden="true"]', '[role="navigation"]', '[role="banner"]', '[role="contentinfo"]',
    '[class*="cookie" i]', '[class*="banner" i]', '[class*="advert" i]', '[class*="promo" i]',
    '[class*="related-jobs" i]', '[class*="similar-jobs" i]', '[class*="share" i]'
  ].join(",");

  const MAX_CHARS = 15000;

  function isUsableText(text) {
    return !!text && text.trim().length > 150;
  }

  function cleanElementText(root) {
    const clone = root.cloneNode(true);
    clone.querySelectorAll(STRIP_SELECTORS).forEach((el) => el.remove());

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

    if (!document.body) return "";
    return cleanElementText(document.body).slice(0, MAX_CHARS);
  }

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
