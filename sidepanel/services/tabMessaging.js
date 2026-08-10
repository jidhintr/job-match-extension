export async function extractJobTextFromActiveTab(currentTabId) {
  let tab;
  if (currentTabId != null) {
    tab = await chrome.tabs.get(currentTabId).catch(() => null);
  }
  if (!tab) {
    [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  }
  if (!tab || !tab.id) throw new Error("No active tab found.");
  if (!/^https?:\/\//.test(tab.url || "")) {
    throw new Error("Open a job posting in this tab first.");
  }

  return new Promise((resolve, reject) => {
    let settled = false;

    const listener = (message, sender) => {
      if (message?.type === "JOB_MATCH_AI_EXTRACTED_TEXT" && sender.tab?.id === tab.id) {
        settled = true;
        chrome.runtime.onMessage.removeListener(listener);
        resolve({ text: message.text || "", company: message.company || "", url: message.url || tab.url || "" });
      }
    };
    chrome.runtime.onMessage.addListener(listener);

    chrome.scripting
      .executeScript({ target: { tabId: tab.id }, files: ["content/content.js"] })
      .catch((err) => {
        chrome.runtime.onMessage.removeListener(listener);
        reject(new Error(`Could not read this page: ${err.message}`));
      });

    setTimeout(() => {
      if (!settled) {
        chrome.runtime.onMessage.removeListener(listener);
        reject(new Error("Timed out reading the page content."));
      }
    }, 8000);
  });
}

function waitForStableDomInPage() {
  return new Promise((resolve) => {
    let settled = false;
    let quietTimer = null;
    const finish = () => {
      if (settled) return;
      settled = true;
      observer.disconnect();
      clearTimeout(quietTimer);
      resolve(true);
    };
    const observer = new MutationObserver(() => {
      clearTimeout(quietTimer);
      quietTimer = setTimeout(finish, 700);
    });
    observer.observe(document.documentElement, { childList: true, subtree: true });
    quietTimer = setTimeout(finish, 700);
    setTimeout(finish, 6000);
  });
}

export function extractJobTextFromUrl(url) {
  return new Promise((resolve, reject) => {
    let settled = false;
    let tabId = null;

    const cleanup = () => {
      chrome.runtime.onMessage.removeListener(listener);
      chrome.tabs.onUpdated.removeListener(updateListener);
      if (tabId != null) chrome.tabs.remove(tabId).catch(() => {});
    };
    const fail = (err) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(err);
    };

    const listener = (message, sender) => {
      if (message?.type === "JOB_MATCH_AI_EXTRACTED_TEXT" && sender.tab?.id === tabId) {
        settled = true;
        cleanup();
        resolve({ text: message.text || "", company: message.company || "", url: message.url || url });
      }
    };
    chrome.runtime.onMessage.addListener(listener);

    const updateListener = (updatedTabId, changeInfo) => {
      if (updatedTabId !== tabId || changeInfo.status !== "complete") return;
      chrome.scripting
        .executeScript({ target: { tabId }, func: waitForStableDomInPage })
        .then(() => chrome.scripting.executeScript({ target: { tabId }, files: ["content/content.js"] }))
        .catch((err) => fail(new Error(`Could not read this page: ${err.message}`)));
    };
    chrome.tabs.onUpdated.addListener(updateListener);

    chrome.tabs.create({ url, active: false }, (tab) => {
      if (!tab?.id) {
        fail(new Error("Could not open a background tab."));
        return;
      }
      tabId = tab.id;
    });

    setTimeout(() => fail(new Error("Timed out reading the page content.")), 16000);
  });
}

export function scanJobListOnActiveTab(currentTabId) {
  return new Promise((resolve, reject) => {
    let tab;
    let settled = false;

    const run = async () => {
      if (currentTabId != null) tab = await chrome.tabs.get(currentTabId).catch(() => null);

      if (!tab || !/^https?:\/\//.test(tab.url || "")) {
        [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      }
      if (!tab?.id || !/^https?:\/\//.test(tab.url || "")) {
        reject(new Error("Open a job listings page in this tab first."));
        return;
      }

      const listener = (message, sender) => {
        if (message?.type === "JOB_MATCH_LIST_SCAN_RESULT" && sender.tab?.id === tab.id) {
          settled = true;
          chrome.runtime.onMessage.removeListener(listener);
          resolve(Array.isArray(message.jobs) ? message.jobs : []);
        }
      };
      chrome.runtime.onMessage.addListener(listener);

      chrome.scripting
        .executeScript({ target: { tabId: tab.id }, files: ["content/jobListScan.js"] })
        .catch((err) => {
          chrome.runtime.onMessage.removeListener(listener);
          reject(new Error(`Could not read this page: ${err.message}`));
        });

      setTimeout(() => {
        if (!settled) {
          chrome.runtime.onMessage.removeListener(listener);
          reject(new Error("Timed out scanning the page — the list may not have loaded, or this site isn't supported yet."));
        }
      }, 20000);
    };

    run();
  });
}

export const ANSWER_PROVIDER_URLS = {
  gemini: "https://gemini.google.com/app",
  deepseek: "https://chat.deepseek.com/",
  openai: "https://chatgpt.com/",
  perplexity: "https://www.perplexity.ai/search"
};

function fillAndSubmitPrompt(promptText) {
  function setNativeValue(el, value) {
    const proto = el.tagName === "TEXTAREA" ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
    if (setter) setter.call(el, value);
    else el.value = value;
    el.dispatchEvent(new Event("input", { bubbles: true }));
  }

  function findFirst(selectors) {
    for (const sel of selectors) {
      const el = document.querySelector(sel);
      if (el) return el;
    }
    return null;
  }

  function pressEnter(el) {
    ["keydown", "keypress", "keyup"].forEach((type) => {
      el.dispatchEvent(new KeyboardEvent(type, { key: "Enter", code: "Enter", keyCode: 13, which: 13, bubbles: true }));
    });
  }

  function tryFill(attempt) {
    const host = location.hostname;
    let input = null;
    let contentEditable = false;

    if (host.includes("chatgpt.com") || host.includes("chat.openai.com")) {
      input = findFirst(["#prompt-textarea", "textarea[data-id]", "textarea"]);
    } else if (host.includes("gemini.google.com")) {
      input = findFirst(['div.ql-editor[contenteditable="true"]', 'rich-textarea div[contenteditable="true"]', 'div[contenteditable="true"]']);
      contentEditable = true;
    } else if (host.includes("chat.deepseek.com") || host.includes("perplexity.ai")) {
      input = findFirst(["textarea", 'div[contenteditable="true"]']);
      contentEditable = !!input && input.tagName !== "TEXTAREA";
    }

    if (!input) {
      if (attempt < 25) setTimeout(() => tryFill(attempt + 1), 400);
      return;
    }

    input.focus();
    if (contentEditable) {
      input.textContent = promptText;
      input.dispatchEvent(new InputEvent("input", { bubbles: true, data: promptText, inputType: "insertText" }));
    } else {
      setNativeValue(input, promptText);
    }

    setTimeout(() => {
      const sendBtn = findFirst([
        'button[data-testid="send-button"]',
        'button[aria-label="Send message"]',
        'button[aria-label="Send"]',
        'button[aria-label="Submit"]',
        'button[type="submit"]'
      ]);
      if (sendBtn && !sendBtn.disabled) sendBtn.click();
      else pressEnter(input);
    }, 400);
  }

  tryFill(0);
}

export function askInTab(url, promptText) {
  chrome.tabs.create({ url, active: true }, (tab) => {
    if (!tab?.id) return;
    const tabId = tab.id;
    const listener = (updatedTabId, changeInfo) => {
      if (updatedTabId !== tabId || changeInfo.status !== "complete") return;
      chrome.tabs.onUpdated.removeListener(listener);

      setTimeout(() => {
        chrome.scripting.executeScript({
          target: { tabId },
          func: fillAndSubmitPrompt,
          args: [promptText]
        }).catch(() => {});
      }, 900);
    };
    chrome.tabs.onUpdated.addListener(listener);
  });
}
