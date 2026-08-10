export const setupBanner = document.getElementById("setupBanner");
export const setupBannerBtn = document.getElementById("setupBannerBtn");
export const openOptionsBtn = document.getElementById("openOptions");

export const analyzeBtn = document.getElementById("analyzeBtn");
export const uploadResumeBtn = document.getElementById("uploadResumeBtn");
export const resumeFileInput = document.getElementById("resumeFileInput");
export const resumeSourceLine = document.getElementById("resumeSourceLine");
export const resumeSourceText = document.getElementById("resumeSourceText");
export const clearResumeOverrideBtn = document.getElementById("clearResumeOverrideBtn");
export const statusLine = document.getElementById("statusLine");

export const drawerToggle = document.getElementById("drawerToggle");
export const drawerBody = document.getElementById("drawerBody");
export const drawerChevron = document.getElementById("drawerChevron");
export const resumeQuickEdit = document.getElementById("resumeQuickEdit");
export const saveResumeQuickBtn = document.getElementById("saveResumeQuick");
export const resumeSavedTag = document.getElementById("resumeSavedTag");

export const saveGuardModal = document.getElementById("saveGuardModal");
export const saveGuardReasons = document.getElementById("saveGuardReasons");
export const saveGuardConfirmBtn = document.getElementById("saveGuardConfirmBtn");
export const saveGuardDiscardBtn = document.getElementById("saveGuardDiscardBtn");

export const dashboard = document.getElementById("dashboard");
export const glitterLayer = document.getElementById("glitterLayer");
export const gaugeTip = document.getElementById("gaugeTip");

export const atsGauge = {
  card: document.getElementById("atsGaugeCard"),
  arc: document.getElementById("atsGaugeArc"),
  needle: document.getElementById("atsGaugeNeedle"),
  value: document.getElementById("atsScoreValue")
};
export const chanceGauge = {
  card: document.getElementById("chanceGaugeCard"),
  arc: document.getElementById("chanceGaugeArc"),
  needle: document.getElementById("chanceGaugeNeedle"),
  value: document.getElementById("chanceValue")
};

export const jobIdentity = document.getElementById("jobIdentity");
export const jobRoleTitle = document.getElementById("jobRoleTitle");
export const jobCompanyName = document.getElementById("jobCompanyName");

export const goodFitList = document.getElementById("goodFitList");
export const goodFitListMore = document.getElementById("goodFitListMore");
export const goodFitToggle = document.getElementById("goodFitToggle");

export const report = document.getElementById("report");
export const emptyState = document.getElementById("emptyState");
export const warningsBanner = document.getElementById("warningsBanner");

export const tabButtons = document.querySelectorAll(".tab-btn");
export const matcherView = document.getElementById("matcherView");
export const prepView = document.getElementById("prepView");
export const scanView = document.getElementById("scanView");
export const trackerView = document.getElementById("trackerView");
export const kpiView = document.getElementById("kpiView");
export const tabViewsByName = { matcher: matcherView, prep: prepView, scan: scanView, tracker: trackerView, kpi: kpiView };
export const tabButtonsByName = {};
tabButtons.forEach((btn) => { tabButtonsByName[btn.dataset.tab] = btn; });
export const scanAndFilterBtn = document.getElementById("scanAndFilterBtn");
export const saveScanBtn = document.getElementById("saveScanBtn");
export const scanStatusLine = document.getElementById("scanStatusLine");
export const scanResultsList = document.getElementById("scanResultsList");

export const trackerSearchInput = document.getElementById("trackerSearchInput");
export const trackerStatusFilter = document.getElementById("trackerStatusFilter");
export const trackerRangeSelect = document.getElementById("trackerRangeSelect");
export const trackerSortSelect = document.getElementById("trackerSortSelect");
export const refreshTrackerBtn = document.getElementById("refreshTrackerBtn");
export const trackerStatusLine = document.getElementById("trackerStatusLine");
export const trackerList = document.getElementById("trackerList");
export const trackerEmptyState = document.getElementById("trackerEmptyState");

export const kpiRangeSelect = document.getElementById("kpiRangeSelect");
export const refreshKpiBtn = document.getElementById("refreshKpiBtn");
export const kpiGmailBtn = document.getElementById("kpiGmailBtn");
export const kpiStatusLine = document.getElementById("kpiStatusLine");
export const kpiBody = document.getElementById("kpiBody");
export const kpiEmptyState = document.getElementById("kpiEmptyState");

export const generatePrepBtn = document.getElementById("generatePrepBtn");
export const prepStatusLine = document.getElementById("prepStatusLine");
export const prepDashboard = document.getElementById("prepDashboard");
export const prepProgressValue = document.getElementById("prepProgressValue");
export const prepProgressFill = document.getElementById("prepProgressFill");
export const prepDonutSvg = document.getElementById("prepDonutSvg");
export const prepDonutLegend = document.getElementById("prepDonutLegend");
export const prepAreasList = document.getElementById("prepAreasList");
export const prepRecruiterInsights = document.getElementById("prepRecruiterInsights");
export const updateFocusBtn = document.getElementById("updateFocusBtn");
export const prepJobIdentity = document.getElementById("prepJobIdentity");
export const prepJobTitleEl = document.getElementById("prepJobTitleValue");
export const prepCompanyNameEl = document.getElementById("prepCompanyNameValue");
export const prepSourcePickerSummary = document.getElementById("prepSourcePickerSummary");
export const sourceCheckboxes = {
  gemini: document.getElementById("srcGemini"),
  tavily: document.getElementById("srcTavily"),
  deepseek: document.getElementById("srcDeepseek"),
  openai: document.getElementById("srcOpenai"),
  perplexity: document.getElementById("srcPerplexity")
};
