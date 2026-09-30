const statusEl = document.getElementById("status");

function setStatus(text) {
  statusEl.textContent = text;
}

async function getActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

async function ensureContentScript(tabId) {
  await chrome.scripting.executeScript({
    target: { tabId },
    files: ["content.js"]
  });
  await new Promise((r) => setTimeout(r, 120));
}

function sendToTab(tabId, action) {
  return new Promise((resolve) => {
    chrome.tabs.sendMessage(tabId, { action }, (response) => {
      if (chrome.runtime.lastError) {
        resolve({ ok: false, error: chrome.runtime.lastError.message });
      } else {
        resolve(response || { ok: true });
      }
    });
  });
}

async function send(action) {
  const tab = await getActiveTab();
  if (!tab?.id) {
    setStatus("No active tab.");
    return;
  }
  if (!/onwingspan\.com/i.test(tab.url || "")) {
    setStatus("Open an Infosys Springboard lesson first (*.onwingspan.com).");
    return;
  }

  try {
    // Inject if content_scripts did not run yet (e.g. page open before install).
    await ensureContentScript(tab.id);
    let result = await sendToTab(tab.id, action);

    // One retry after reinject.
    if (!result.ok && /Receiving end does not exist|Could not establish connection/i.test(result.error || "")) {
      await ensureContentScript(tab.id);
      result = await sendToTab(tab.id, action);
    }

    if (!result.ok) {
      setStatus("Connection failed. Reload the page, then try again. Also check chrome://extensions.");
      return;
    }

    if (action === "start") {
      chrome.storage.local.set({ sbv5_running: true });
      setStatus(result.state ? `Running… (${result.state})` : "Running…");
    } else if (action === "stop") {
      chrome.storage.local.set({ sbv5_running: false });
      setStatus("Stopped.");
    } else if (action === "status") {
      setStatus(result.running ? `Running… (${result.state})` : "Stopped.");
    }
  } catch (e) {
    setStatus("Chrome blocked page access. Allow site access for *.onwingspan.com on this extension.");
  }
}

document.getElementById("start").onclick = () => send("start");
document.getElementById("stop").onclick = () => send("stop");

// Reflect persisted Start/Stop when popup opens.
chrome.storage.local.get(["sbv5_running", "sbv5"], async (r) => {
  const running = !!(r.sbv5_running ?? r.sbv5);
  if (!running) {
    setStatus("Ready.");
    return;
  }
  setStatus("Running…");
  const tab = await getActiveTab();
  if (tab?.id && /onwingspan\.com/i.test(tab.url || "")) {
    try {
      await ensureContentScript(tab.id);
      const result = await sendToTab(tab.id, "status");
      if (result.ok) {
        setStatus(result.running ? `Running… (${result.state})` : "Stored as running — click Start if idle.");
      }
    } catch (_) {
      /* ignore */
    }
  }
});
