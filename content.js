(() => {
  if (window.__SBV5_HELPER__) return;
  window.__SBV5_HELPER__ = true;

  const LOG = (msg, extra) => {
    if (extra !== undefined) console.log(`[Springboard Helper] ${msg}`, extra);
    else console.log(`[Springboard Helper] ${msg}`);
  };

  const STATES = {
    IDLE: "IDLE",
    FIND_CURRENT_LESSON: "FIND_CURRENT_LESSON",
    FIND_INITIAL_COMPLETE: "FIND_INITIAL_COMPLETE",
    CLICK_INITIAL_COMPLETE: "CLICK_INITIAL_COMPLETE",
    WAIT_FOR_CONFIRMATION: "WAIT_FOR_CONFIRMATION",
    FIND_MODAL_COMPLETE: "FIND_MODAL_COMPLETE",
    CLICK_MODAL_COMPLETE: "CLICK_MODAL_COMPLETE",
    WAIT_FOR_COMPLETION: "WAIT_FOR_COMPLETION",
    VERIFY_COMPLETED: "VERIFY_COMPLETED",
    FIND_NEXT_LESSON: "FIND_NEXT_LESSON",
    CLICK_NEXT: "CLICK_NEXT",
    WAIT_FOR_NEXT_LESSON: "WAIT_FOR_NEXT_LESSON",
    DONE: "DONE",
    ERROR_HOLD: "ERROR_HOLD"
  };

  const CFG = {
    tickMs: 450,
    modalWaitMs: 14000,
    completionWaitMs: 18000,
    nextLessonWaitMs: 25000,
    completeButtonWaitMs: 45000,
    maxInitialClicks: 5,
    maxModalClicks: 5,
    maxCompletionRetries: 6,
    maxNextMisses: 8,
    settleAfterClickMs: 400,
    errorHoldMs: 6000
  };

  let running = false;
  let busy = false;
  let state = STATES.IDLE;
  let timer = null;
  let pageObserver = null;

  let currentLessonEl = null;
  let currentLessonKey = "";
  let preCompleteSnapshot = null;
  let initialBtn = null;
  let modalBtn = null;
  let nextControl = null;
  let pageFingerprintBeforeNext = "";
  let lessonKeyBeforeNext = "";
  let lessonsCompletedThisRun = 0;
  let nextMissCount = 0;
  let confirmedModalClickForLesson = false;

  let initialClickCount = 0;
  let modalClickCount = 0;
  let completionRetryCount = 0;
  let stateEnteredAt = 0;
  let lastActionAt = 0;

  function now() {
    return Date.now();
  }

  function setState(next, detail) {
    if (state === next) return;
    state = next;
    stateEnteredAt = now();
    LOG(`State → ${next}`, detail || "");
  }

  function resetLessonCounters() {
    initialClickCount = 0;
    modalClickCount = 0;
    completionRetryCount = 0;
    confirmedModalClickForLesson = false;
    initialBtn = null;
    modalBtn = null;
    nextControl = null;
  }

  function norm(s) {
    return (s || "").replace(/\s+/g, " ").trim().toLowerCase();
  }

  function isVisible(el) {
    if (!el || !(el instanceof Element)) return false;
    const style = getComputedStyle(el);
    if (style.display === "none" || style.visibility === "hidden" || Number(style.opacity) === 0) {
      return false;
    }
    const r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) return false;
    if (r.bottom < 0 || r.right < 0 || r.top > innerHeight || r.left > innerWidth) return false;
    return true;
  }

  function rawText(el) {
    return norm(el?.innerText || el?.textContent || "");
  }

  function labelText(el) {
    if (!el) return "";
    const parts = [
      el.getAttribute?.("aria-label"),
      el.getAttribute?.("title"),
      el.getAttribute?.("alt"),
      el.getAttribute?.("value"),
      el.getAttribute?.("data-tooltip"),
      el.getAttribute?.("placeholder")
    ];
    return norm(parts.filter(Boolean).join(" "));
  }

  function combinedText(el) {
    return norm(`${labelText(el)} ${rawText(el)}`);
  }

  function isDisabled(el) {
    if (!el) return true;
    if (el.disabled === true) return true;
    if (el.getAttribute("aria-disabled") === "true") return true;
    if (el.classList?.contains("disabled")) return true;
    if (/\bdisabled\b/i.test(el.className?.toString?.() || "")) return true;
    const style = getComputedStyle(el);
    return style.pointerEvents === "none";
  }

  function clickableAncestor(el) {
    let e = el;
    for (let i = 0; i < 8 && e; i++, e = e.parentElement) {
      if (!(e instanceof Element)) continue;
      if (
        e.matches(
          "button,a,[role='button'],[role='menuitem'],[role='option'],input[type='button'],input[type='submit'],[tabindex]"
        )
      ) {
        return e;
      }
      const style = getComputedStyle(e);
      if (style.cursor === "pointer" && isVisible(e)) return e;
      if (typeof e.onclick === "function" || e.getAttribute("onclick")) return e;
    }
    return el;
  }

  function isCompletePhrase(t) {
    if (!t) return false;
    if (/mark as complete[ds]?/.test(t)) return true;
    if (t === "complete" || t === "mark complete") return true;
    return false;
  }

  function isMostlyCompleteLabel(el) {
    const t = combinedText(el);
    if (!isCompletePhrase(t)) return false;
    if (t.length > 80) return false;
    return true;
  }

  function getModals() {
    const selectors = [
      "[role='dialog']",
      "[aria-modal='true']",
      "[class*='modal' i]",
      "[class*='Modal']",
      "[class*='popup' i]",
      "[class*='Popup']"
    ];
    const set = new Set();
    for (const sel of selectors) {
      try {
        document.querySelectorAll(sel).forEach((el) => {
          if (isVisible(el)) set.add(el);
        });
      } catch (_) {
        /* invalid selector in older engines */
      }
    }
    for (const el of document.querySelectorAll("div,section,aside")) {
      if (!isVisible(el)) continue;
      const t = rawText(el);
      if (
        t.includes("by clicking on the button") &&
        t.includes("mark as complete") &&
        t.length < 1200
      ) {
        set.add(el);
      }
    }
    return [...set];
  }

  function findConfirmationModal() {
    const modals = getModals();
    const scored = modals
      .map((m) => {
        const t = rawText(m);
        let score = 0;
        if (t.includes("mark as complete")) score += 3;
        if (t.includes("confirm")) score += 2;
        if (t.includes("viewed the learning content")) score += 4;
        if (t.includes("by clicking")) score += 2;
        if (m.getAttribute("role") === "dialog" || m.getAttribute("aria-modal") === "true") score += 2;
        return { m, score, t };
      })
      .filter((x) => x.score >= 3)
      .sort((a, b) => b.score - a.score || a.t.length - b.t.length);
    return scored[0]?.m || null;
  }

  function collectCandidates(root = document) {
    const sel =
      "button,a,[role='button'],[role='menuitem'],[role='option'],input[type='button'],input[type='submit'],div,span,p,li,label";
    return [...root.querySelectorAll(sel)].filter(isVisible);
  }

  function findCompleteControls({
    insideModalOnly = false,
    outsideModalOnly = false,
    allowDisabled = false
  } = {}) {
    const modal = findConfirmationModal();
    const roots = insideModalOnly ? (modal ? [modal] : []) : [document];
    const found = [];

    for (const root of roots) {
      for (const el of collectCandidates(root)) {
        if (!isMostlyCompleteLabel(el)) continue;
        const inModal = !!(
          el.closest("[role='dialog'],[aria-modal='true']") ||
          (modal && modal.contains(el))
        );
        if (insideModalOnly && !inModal) continue;
        if (outsideModalOnly && inModal) continue;
        const clickable = clickableAncestor(el);
        if (!isVisible(clickable)) continue;
        if (!allowDisabled && isDisabled(clickable)) continue;
        found.push({
          el,
          clickable,
          text: combinedText(el),
          len: combinedText(el).length,
          disabled: isDisabled(clickable)
        });
      }
    }

    const uniq = [];
    const seen = new Set();
    for (const item of found.sort((a, b) => a.len - b.len)) {
      if (seen.has(item.clickable)) continue;
      seen.add(item.clickable);
      uniq.push(item);
    }
    return uniq;
  }

  function findInitialCompleteButton({ allowDisabled = false } = {}) {
    const list = findCompleteControls({ outsideModalOnly: true, allowDisabled });
    const enabled = list.find((x) => !x.disabled);
    if (enabled) return enabled.clickable;
    if (allowDisabled) return list[0]?.clickable || null;
    return null;
  }

  function findModalCompleteButton() {
    const modal = findConfirmationModal();
    if (!modal) return null;
    const list = findCompleteControls({ insideModalOnly: true });
    const preferred = list.find((x) => /^mark as complete[ds]?$/.test(x.text)) || list[0];
    return preferred?.clickable || null;
  }

  function sidebarRoots() {
    const roots = [];
    const selectors = [
      "nav",
      "aside",
      "[role='navigation']",
      "[class*='sidebar' i]",
      "[class*='toc' i]",
      "[class*='curriculum' i]",
      "[class*='module' i]",
      "[class*='tree' i]",
      "[class*='outline' i]",
      "[class*='playlist' i]",
      "[class*='content-list' i]"
    ];
    for (const sel of selectors) {
      try {
        document.querySelectorAll(sel).forEach((el) => {
          if (isVisible(el) && el.getBoundingClientRect().width < innerWidth * 0.55) roots.push(el);
        });
      } catch (_) {}
    }
    if (!roots.length) {
      for (const el of document.querySelectorAll("div,section,aside,nav")) {
        if (!isVisible(el)) continue;
        const r = el.getBoundingClientRect();
        if (r.left < innerWidth * 0.4 && r.width > 120 && r.width < innerWidth * 0.5 && r.height > innerHeight * 0.35) {
          roots.push(el);
        }
      }
    }
    return roots;
  }

  /**
   * Strict completion detection — generic "check" icons alone are NOT enough.
   * Springboard often shows checkbox outlines on incomplete items; treating those
   * as complete caused the helper to skip work and stall after a few lessons.
   */
  function looksCompleted(el) {
    if (!el) return false;

    const ariaBits = norm(
      [
        el.getAttribute("aria-label"),
        el.getAttribute("title"),
        el.getAttribute("aria-checked"),
        el.getAttribute("aria-pressed")
      ]
        .filter(Boolean)
        .join(" ")
    );

    if (/\bincomplete\b|\bnot completed\b|\bnot complete\b|\buncompleted\b/.test(ariaBits)) {
      return false;
    }
    if (/\bcompleted\b|\bmarked as complete\b|\bfinished\b/.test(ariaBits)) return true;
    if (el.getAttribute("aria-checked") === "true") return true;

    const cls = norm(el.className?.toString?.() || "");
    if (/\bincomplete\b|\buncomplete\b|\bnot-complete\b|\bpending\b/.test(cls)) return false;
    // Require explicit completed/success tokens — not bare "complete" (too common).
    if (/\b(completed|is-completed|has-completed|status-completed|success-completed)\b/.test(cls)) {
      return true;
    }
    if (/\b(completed|iscompleted|lessoncompleted)\b/.test(cls.replace(/[-_]/g, ""))) return true;

    // Explicit completed icon classes only (not generic checkbox).
    const icons =
      el.querySelectorAll?.(
        "[class*='completed' i],[class*='Completed'],[aria-label*='completed' i],[title*='completed' i],svg[class*='done' i]"
      ) || [];
    for (const icon of icons) {
      const ic = norm(
        `${icon.className?.toString?.() || ""} ${icon.getAttribute?.("aria-label") || ""} ${
          icon.getAttribute?.("title") || ""
        }`
      );
      if (/\bincomplete\b/.test(ic)) continue;
      if (/\bcompleted\b|\bdone\b|\bfinished\b/.test(ic)) return true;
    }

    const t = combinedText(el);
    if (/\bincomplete\b/.test(t)) return false;
    if (/\bcompleted\b/.test(t) && t.length < 120) return true;
    return false;
  }

  function isSelectedLesson(el) {
    if (!el) return false;
    if (el.getAttribute("aria-current") === "page" || el.getAttribute("aria-current") === "true") return true;
    if (el.getAttribute("aria-selected") === "true") return true;
    const cls = norm(el.className?.toString?.() || "");
    if (/\b(active|selected|current|highlighted|playing)\b/.test(cls)) return true;
    if (el.querySelector?.("[aria-current='page'],[aria-selected='true']")) return true;
    return false;
  }

  function lessonItemCandidates(root) {
    const items = [];
    const nodes = root.querySelectorAll(
      "a,button,li,[role='treeitem'],[role='option'],[role='menuitem'],[role='button'],div,span"
    );
    for (const el of nodes) {
      if (!isVisible(el)) continue;
      const t = rawText(el);
      if (!t || t.length < 2 || t.length > 160) continue;
      if (isCompletePhrase(t)) continue;
      if (/^next$|^previous$|^back$|^continue$/.test(t)) continue;
      const r = el.getBoundingClientRect();
      if (r.height < 18 || r.height > 120) continue;
      items.push(el);
    }
    items.sort((a, b) => rawText(a).length - rawText(b).length);
    const uniq = [];
    const seen = new Set();
    for (const el of items) {
      const key = rawText(el);
      if (seen.has(key)) continue;
      seen.add(key);
      uniq.push(el);
    }
    return uniq;
  }

  function findCurrentLessonElement() {
    const roots = sidebarRoots();
    let best = null;
    let bestScore = -1;

    for (const root of roots) {
      for (const el of lessonItemCandidates(root)) {
        let score = 0;
        if (isSelectedLesson(el)) score += 8;
        if (isSelectedLesson(el.parentElement)) score += 4;
        const cls = norm(el.className?.toString?.() || "");
        if (/\b(active|selected|current)\b/.test(cls)) score += 3;
        const r = el.getBoundingClientRect();
        if (r.left < innerWidth * 0.45) score += 1;
        if (score > bestScore) {
          bestScore = score;
          best = el;
        }
      }
    }

    if (best && bestScore >= 3) return clickableAncestor(best) || best;

    const heading = [...document.querySelectorAll("h1,h2,h3,[class*='title' i]")]
      .filter(isVisible)
      .map((el) => ({ el, t: rawText(el) }))
      .filter((x) => x.t && x.t.length > 2 && x.t.length < 180)
      .sort((a, b) => a.t.length - b.t.length)[0];
    return heading?.el || null;
  }

  function lessonKey(el) {
    if (!el) return "";
    return norm(`${rawText(el)}|${el.getAttribute?.("href") || ""}|${el.id || ""}`);
  }

  function snapshotLesson(el) {
    if (!el) return null;
    const row = el.closest("li,a,button,[role='treeitem'],[role='option'],div") || el;
    return {
      key: lessonKey(el),
      text: rawText(el),
      completed: looksCompleted(row) || looksCompleted(el),
      html: row.outerHTML?.slice(0, 500) || "",
      aria: `${row.getAttribute?.("aria-label") || ""}|${row.getAttribute?.("class") || ""}`
    };
  }

  function pageFingerprint() {
    const title =
      rawText(document.querySelector("h1,h2,[class*='title' i]")) || document.title || "";
    const bodySlice = (document.body?.innerText || "").replace(/\s+/g, " ").slice(0, 500);
    return norm(`${location.href}||${title}||${bodySlice}`);
  }

  function contentReadySignal() {
    // New lesson is "ready" when we can see an initial complete control (even disabled)
    // or a clear selected sidebar item different from the previous key.
    const hasComplete = !!findInitialCompleteButton({ allowDisabled: true });
    const latest = findCurrentLessonElement();
    const key = lessonKey(latest);
    const keyChanged = !!(key && lessonKeyBeforeNext && key !== lessonKeyBeforeNext);
    const fpChanged = !!(pageFingerprintBeforeNext && pageFingerprint() !== pageFingerprintBeforeNext);
    return { hasComplete, keyChanged, fpChanged, key, latest };
  }

  function findNextControl() {
    const els = collectCandidates();
    const named = [];
    for (const el of els) {
      const s = combinedText(el);
      if (!s || s.length > 60) continue;
      if (/previous|back|prev/.test(s)) continue;
      // Prefer explicit next-lesson wording over generic "continue".
      if (/next lesson|next item|next content|next module/.test(s)) {
        named.push({ el: clickableAncestor(el), s, len: s.length, score: 3 });
      } else if (/^next$|\bnext\b/.test(s) && !/previous/.test(s)) {
        named.push({ el: clickableAncestor(el), s, len: s.length, score: 2 });
      } else if (/^continue$|\bcontinue\b/.test(s)) {
        named.push({ el: clickableAncestor(el), s, len: s.length, score: 1 });
      }
    }
    named.sort((a, b) => b.score - a.score || a.len - b.len);
    const uniq = [];
    const seen = new Set();
    for (const item of named) {
      if (!item.el || seen.has(item.el) || isDisabled(item.el)) continue;
      seen.add(item.el);
      uniq.push(item.el);
    }
    if (uniq.length) return uniq[0];

    // Sidebar: first incomplete item after the current lesson.
    const roots = sidebarRoots();
    for (const root of roots) {
      const items = lessonItemCandidates(root);
      let idx = -1;
      if (currentLessonEl) {
        idx = items.findIndex(
          (el) =>
            el === currentLessonEl || el.contains(currentLessonEl) || currentLessonEl.contains(el)
        );
      }
      if (idx < 0 && currentLessonKey) {
        idx = items.findIndex((el) => lessonKey(el) === currentLessonKey);
      }
      if (idx >= 0) {
        for (let i = idx + 1; i < items.length; i++) {
          const candidate = items[i];
          if (looksCompleted(candidate)) continue;
          return clickableAncestor(candidate);
        }
        // If all later items look completed, still try the immediate next row.
        if (idx + 1 < items.length) return clickableAncestor(items[idx + 1]);
      }
    }

    // Player right-side arrow-ish control.
    const vw = innerWidth;
    const vh = innerHeight;
    const right = els
      .filter((e) => {
        const r = e.getBoundingClientRect();
        const t = rawText(e);
        return (
          r.left > vw * 0.62 &&
          r.top > vh * 0.2 &&
          r.top < vh * 0.85 &&
          r.width <= 120 &&
          r.height <= 120 &&
          t.length < 24 &&
          !/prev|back|close|menu/.test(combinedText(e))
        );
      })
      .sort((a, b) => b.getBoundingClientRect().left - a.getBoundingClientRect().left);
    return right.length ? clickableAncestor(right[0]) : null;
  }

  async function humanClick(el) {
    if (!el) return false;
    try {
      el.scrollIntoView({ block: "center", inline: "center", behavior: "instant" });
    } catch (_) {
      el.scrollIntoView({ block: "center", inline: "center" });
    }
    await sleep(CFG.settleAfterClickMs);

    const opts = { bubbles: true, cancelable: true, view: window };
    try {
      el.dispatchEvent(new PointerEvent("pointerdown", opts));
      el.dispatchEvent(new MouseEvent("mousedown", opts));
      el.dispatchEvent(new PointerEvent("pointerup", opts));
      el.dispatchEvent(new MouseEvent("mouseup", opts));
      el.dispatchEvent(new MouseEvent("click", opts));
      if (typeof el.click === "function") el.click();
    } catch (_) {
      try {
        el.click();
      } catch (__) {}
    }
    lastActionAt = now();
    return true;
  }

  function sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
  }

  function waitFor(predicate, timeoutMs, { observe = true } = {}) {
    return new Promise((resolve) => {
      const start = now();
      let done = false;
      let obs = null;
      const finish = (val) => {
        if (done) return;
        done = true;
        if (obs) obs.disconnect();
        clearInterval(iv);
        resolve(val);
      };
      const check = () => {
        try {
          if (predicate()) return finish(true);
        } catch (_) {}
        if (now() - start >= timeoutMs) return finish(false);
      };
      const iv = setInterval(check, 200);
      if (observe && document.body) {
        obs = new MutationObserver(check);
        obs.observe(document.body, {
          childList: true,
          subtree: true,
          attributes: true,
          characterData: true
        });
      }
      check();
    });
  }

  function completionVerified() {
    if (findConfirmationModal()) return false;

    const latest = findCurrentLessonElement();
    if (latest) currentLessonEl = latest;
    const snap = snapshotLesson(currentLessonEl);

    if (snap?.completed || looksCompleted(currentLessonEl)) {
      return true;
    }

    // After a real modal confirm: modal gone + page "Mark as complete" gone
    // is a strong signal Springboard accepted completion (UI varies by lesson type).
    if (confirmedModalClickForLesson || modalClickCount > 0) {
      const initialGone = !findInitialCompleteButton({ allowDisabled: true });
      if (initialGone) {
        LOG("Completion inferred: confirmation accepted and complete control removed");
        return true;
      }
      if (preCompleteSnapshot && snap) {
        const rowChanged =
          snap.html !== preCompleteSnapshot.html || snap.aria !== preCompleteSnapshot.aria;
        if (rowChanged) {
          LOG("Completion inferred: confirmation accepted and lesson row updated");
          return true;
        }
      }
    }

    return false;
  }

  /**
   * Only treat as already-completed when we have a strict completed signal
   * AND there is no page-level Mark as complete control left.
   */
  function alreadyCompletedCurrent() {
    const el = findCurrentLessonElement();
    if (!el) return false;
    const snap = snapshotLesson(el);
    const strict = !!(snap && snap.completed);
    if (!strict) return false;
    const stillHasComplete = !!findInitialCompleteButton({ allowDisabled: true });
    if (stillHasComplete) {
      LOG("Sidebar looks completed but Mark as complete still present — will complete via UI");
      return false;
    }
    return true;
  }

  async function tick() {
    if (!running || busy) return;
    busy = true;
    try {
      await step();
    } catch (err) {
      LOG("Unexpected error in step", err);
      setState(STATES.ERROR_HOLD, String(err?.message || err));
    } finally {
      busy = false;
    }
  }

  async function step() {
    switch (state) {
      case STATES.IDLE:
        return;

      case STATES.FIND_CURRENT_LESSON: {
        currentLessonEl = findCurrentLessonElement();
        currentLessonKey = lessonKey(currentLessonEl);
        if (currentLessonEl) {
          LOG("Current lesson detected", {
            title: rawText(currentLessonEl).slice(0, 120),
            completedSoFar: lessonsCompletedThisRun
          });
          preCompleteSnapshot = snapshotLesson(currentLessonEl);
          if (alreadyCompletedCurrent()) {
            LOG("Current lesson already completed — moving to next");
            setState(STATES.FIND_NEXT_LESSON);
          } else {
            setState(STATES.FIND_INITIAL_COMPLETE);
          }
        } else if (now() - stateEnteredAt > 10000) {
          LOG("Current lesson sidebar item unclear — searching completion control anyway");
          setState(STATES.FIND_INITIAL_COMPLETE);
        }
        return;
      }

      case STATES.FIND_INITIAL_COMPLETE: {
        if (findConfirmationModal() && findModalCompleteButton()) {
          LOG("Confirmation modal already open");
          setState(STATES.FIND_MODAL_COMPLETE);
          return;
        }

        // Wait for enabled button; Springboard often enables it only after content loads.
        const disabledBtn = findInitialCompleteButton({ allowDisabled: true });
        initialBtn = findInitialCompleteButton({ allowDisabled: false });

        if (initialBtn) {
          LOG("Initial completion button found", combinedText(initialBtn).slice(0, 80));
          setState(STATES.CLICK_INITIAL_COMPLETE);
          return;
        }

        if (disabledBtn) {
          if (now() - lastActionAt > 5000) {
            LOG("Mark as complete present but disabled — waiting for it to enable");
            lastActionAt = now();
          }
          if (now() - stateEnteredAt > CFG.completeButtonWaitMs) {
            LOG("Complete button stayed disabled — NOT moving to next lesson");
            setState(STATES.ERROR_HOLD);
          }
          return;
        }

        if (now() - stateEnteredAt > 12000) {
          if (alreadyCompletedCurrent()) {
            LOG("No initial button; lesson appears completed");
            setState(STATES.FIND_NEXT_LESSON);
          } else if (now() - stateEnteredAt > CFG.completeButtonWaitMs) {
            LOG("Initial completion button not found after long wait — holding");
            setState(STATES.ERROR_HOLD);
          } else if (now() - lastActionAt > 5000) {
            LOG("Initial completion button not found yet — still waiting for SPA content");
            lastActionAt = now();
          }
        }
        return;
      }

      case STATES.CLICK_INITIAL_COMPLETE: {
        if (initialClickCount >= CFG.maxInitialClicks) {
          LOG("Could not open confirmation modal after retries — NOT moving to next lesson");
          setState(STATES.ERROR_HOLD);
          return;
        }
        initialBtn = findInitialCompleteButton({ allowDisabled: false }) || initialBtn;
        if (!initialBtn || isDisabled(initialBtn)) {
          setState(STATES.FIND_INITIAL_COMPLETE);
          return;
        }
        initialClickCount += 1;
        await humanClick(initialBtn);
        LOG("Initial completion clicked");
        setState(STATES.WAIT_FOR_CONFIRMATION);
        return;
      }

      case STATES.WAIT_FOR_CONFIRMATION: {
        const ok = await waitFor(() => !!findConfirmationModal(), Math.min(5000, CFG.modalWaitMs));
        if (ok) {
          LOG("Confirmation modal detected");
          setState(STATES.FIND_MODAL_COMPLETE);
        } else if (now() - stateEnteredAt > CFG.modalWaitMs) {
          LOG("Confirmation modal not detected — retrying initial click");
          setState(STATES.FIND_INITIAL_COMPLETE);
        }
        return;
      }

      case STATES.FIND_MODAL_COMPLETE: {
        modalBtn = findModalCompleteButton();
        if (modalBtn) {
          LOG("Confirmation button found", combinedText(modalBtn).slice(0, 80));
          setState(STATES.CLICK_MODAL_COMPLETE);
        } else if (now() - stateEnteredAt > 8000) {
          LOG("Confirmation button not found in modal — NOT moving to next lesson");
          setState(STATES.ERROR_HOLD);
        }
        return;
      }

      case STATES.CLICK_MODAL_COMPLETE: {
        if (modalClickCount >= CFG.maxModalClicks) {
          LOG("Could not verify completion — NOT moving to next lesson");
          setState(STATES.ERROR_HOLD);
          return;
        }
        const fresh = findModalCompleteButton();
        if (!fresh) {
          setState(STATES.FIND_MODAL_COMPLETE);
          return;
        }
        modalBtn = fresh;
        modalClickCount += 1;
        await humanClick(modalBtn);
        confirmedModalClickForLesson = true;
        LOG("Confirmation clicked");
        setState(STATES.WAIT_FOR_COMPLETION);
        return;
      }

      case STATES.WAIT_FOR_COMPLETION: {
        LOG("Waiting for completion state");
        const modalGone = await waitFor(() => !findConfirmationModal(), 10000);
        if (!modalGone && now() - stateEnteredAt < CFG.completionWaitMs) return;
        setState(STATES.VERIFY_COMPLETED);
        return;
      }

      case STATES.VERIFY_COMPLETED: {
        const verified = await waitFor(() => completionVerified(), 8000);
        if (verified) {
          lessonsCompletedThisRun += 1;
          LOG("Completion VERIFIED", { lessonsCompletedThisRun });
          resetLessonCounters();
          nextMissCount = 0;
          setState(STATES.FIND_NEXT_LESSON);
          return;
        }

        completionRetryCount += 1;
        if (completionRetryCount <= CFG.maxCompletionRetries) {
          LOG("Could not verify completion — retrying confirmation flow", {
            attempt: completionRetryCount
          });
          if (findConfirmationModal()) setState(STATES.FIND_MODAL_COMPLETE);
          else setState(STATES.FIND_INITIAL_COMPLETE);
          return;
        }

        LOG("Could not verify completion — NOT moving to next lesson");
        setState(STATES.ERROR_HOLD);
        return;
      }

      case STATES.FIND_NEXT_LESSON: {
        nextControl = findNextControl();
        if (nextControl) {
          LOG("Moving to next lesson", combinedText(nextControl).slice(0, 80));
          nextMissCount = 0;
          setState(STATES.CLICK_NEXT);
          return;
        }
        nextMissCount += 1;
        if (nextMissCount >= CFG.maxNextMisses || now() - stateEnteredAt > 20000) {
          // Do NOT stop the extension cold — recover and re-scan. Only DONE if
          // still nothing after recovery cycles.
          if (nextMissCount >= CFG.maxNextMisses * 2) {
            LOG("No next lesson control found after repeated scans — finished or blocked");
            setState(STATES.DONE);
          } else {
            LOG("Next control missing — recovering (will not stop yet)", { nextMissCount });
            setState(STATES.ERROR_HOLD);
          }
        }
        return;
      }

      case STATES.CLICK_NEXT: {
        pageFingerprintBeforeNext = pageFingerprint();
        lessonKeyBeforeNext = currentLessonKey || lessonKey(findCurrentLessonElement());
        await humanClick(nextControl);
        setState(STATES.WAIT_FOR_NEXT_LESSON);
        return;
      }

      case STATES.WAIT_FOR_NEXT_LESSON: {
        // Require an actual lesson/content change — do not proceed on a blind timer.
        const changed = await waitFor(() => {
          const sig = contentReadySignal();
          return sig.fpChanged || sig.keyChanged;
        }, 8000);

        if (!changed && now() - stateEnteredAt < CFG.nextLessonWaitMs) {
          if (now() - stateEnteredAt > 8000 && now() - stateEnteredAt < 8500) {
            LOG("Still waiting for next lesson content to change…");
          }
          return;
        }

        // After change (or long timeout), wait until complete control or new selection appears.
        const ready = await waitFor(() => {
          const sig = contentReadySignal();
          if (sig.hasComplete) return true;
          if (sig.keyChanged && sig.latest) return true;
          return false;
        }, 10000);

        if (ready || now() - stateEnteredAt > CFG.nextLessonWaitMs) {
          const sig = contentReadySignal();
          if (!changed && !ready) {
            LOG("Next lesson load unclear — re-clicking next once more");
            // Try next again rather than falsely restarting on same lesson.
            setState(STATES.FIND_NEXT_LESSON);
            return;
          }
          LOG("Next lesson loaded", {
            key: (sig.key || "").slice(0, 80),
            hasComplete: sig.hasComplete
          });
          currentLessonEl = null;
          currentLessonKey = "";
          preCompleteSnapshot = null;
          pageFingerprintBeforeNext = "";
          lessonKeyBeforeNext = "";
          resetLessonCounters();
          setState(STATES.FIND_CURRENT_LESSON);
        }
        return;
      }

      case STATES.DONE: {
        LOG("No more lessons detected — stopping", { lessonsCompletedThisRun });
        stop("done");
        return;
      }

      case STATES.ERROR_HOLD: {
        if (now() - stateEnteredAt > CFG.errorHoldMs) {
          LOG("Recovering from hold — re-detecting current lesson", {
            lessonsCompletedThisRun
          });
          resetLessonCounters();
          // If a complete button exists, go straight at it; else rediscover lesson.
          if (findInitialCompleteButton({ allowDisabled: false })) {
            setState(STATES.FIND_INITIAL_COMPLETE);
          } else if (alreadyCompletedCurrent()) {
            setState(STATES.FIND_NEXT_LESSON);
          } else {
            setState(STATES.FIND_CURRENT_LESSON);
          }
        }
        return;
      }

      default:
        setState(STATES.IDLE);
    }
  }

  function ensureObserver() {
    if (pageObserver || !document.body) return;
    pageObserver = new MutationObserver(() => {});
    pageObserver.observe(document.body, { childList: true, subtree: true, attributes: true });
  }

  function start(source = "message") {
    if (running) {
      LOG("Start ignored — already running", { source, state });
      return { ok: true, running: true, state, lessonsCompletedThisRun };
    }
    running = true;
    busy = false;
    lessonsCompletedThisRun = 0;
    nextMissCount = 0;
    pageFingerprintBeforeNext = "";
    lessonKeyBeforeNext = "";
    resetLessonCounters();
    chrome.storage.local.set({ sbv5_running: true });
    ensureObserver();
    setState(STATES.FIND_CURRENT_LESSON, source);
    LOG("Started");
    if (timer) clearInterval(timer);
    timer = setInterval(tick, CFG.tickMs);
    tick();
    return { ok: true, running: true, state, lessonsCompletedThisRun };
  }

  function stop(reason = "message") {
    running = false;
    busy = false;
    chrome.storage.local.set({ sbv5_running: false });
    if (timer) {
      clearInterval(timer);
      timer = null;
    }
    setState(STATES.IDLE, reason);
    LOG("Stopped", { reason, lessonsCompletedThisRun });
    return { ok: true, running: false, state, lessonsCompletedThisRun };
  }

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (!msg || !msg.action) return;
    if (msg.action === "start") {
      sendResponse(start("popup"));
      return true;
    }
    if (msg.action === "stop") {
      sendResponse(stop("popup"));
      return true;
    }
    if (msg.action === "status") {
      sendResponse({ ok: true, running, state, lessonsCompletedThisRun });
      return true;
    }
  });

  chrome.storage.local.get(["sbv5_running", "sbv5"], (r) => {
    const shouldRun = !!(r.sbv5_running ?? r.sbv5);
    if (shouldRun) start("storage");
  });

  LOG("Content script ready");
})();
