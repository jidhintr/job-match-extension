const DEFAULT_MATCHER_INSTRUCTIONS = `The candidate speaks only English. If the job posting states fluency in another language (German, Dutch, French, Polish, etc.) as a MANDATORY/REQUIRED qualification — not merely a "nice to have" or an incidental mention like "collaborates with our Berlin office" — this is a hard disqualifying blocker.
The candidate holds an EU Blue Card and is legally authorized to work in Poland without any visa or employer sponsorship, and is open to the general labor market (not tied to a single employer). For roles based outside Poland, the candidate can generally transfer their Blue Card to another EU country with minimal paperwork under EU intra-mobility rules. Do NOT treat "role is outside Poland" as a negative factor by itself, and do NOT lower chance_of_getting_job for it. ONLY flag it if the job posting explicitly states something like "no visa sponsorship," "must already be authorized to work locally," or "no relocation support" for a role outside Poland.`;

export const state = {
  settings: {
    apiKey: "",
    masterResume: "",
    sheetsWebhookUrl: "",
    tavilyKey: "",
    deepseekKey: "",
    deepseekModel: "",
    openaiKey: "",
    openaiModel: "",
    perplexityKey: "",
    perplexityModel: "",
    prepSourceSelection: { gemini: true, tavily: true, deepseek: true, openai: true, perplexity: true },
    resumeSectionOrder: [],
    customInstructions: { matcher: DEFAULT_MATCHER_INSTRUCTIONS, prep: "", scan: "" },
    trackerStatusOptions: [],
    cacheTtlHours: 2,
    guardMinAts: 50,
    guardMinChance: 40,
    guardKeywords: ".net"
  },
  tab: {
    currentTabId: null,
    resumeOverride: null,
    resumeFileName: ""
  },
  matcher: {
    lastJobText: "",
    lastJobUrl: "",
    lastCompanyGuess: "",
    lastResult: null,
    savedToSheets: false
  },
  prep: {
    areas: [],
    jobUrl: "",
    companyName: "",
    jobTitle: "",
    recruiterNotes: ""
  },
  scan: {
    results: []
  },
  tracker: {
    items: [],
    loaded: false,
    loading: false,
    cachedAt: null,
    statusFilter: "All",
    searchQuery: "",
    range: "30",
    sortBy: "date-desc"
  },
  kpi: {
    range: "30"
  }
};
