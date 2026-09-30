SPRINGBOARD COMPLETION HELPER v5.1

Priority: NEVER click Next unless the current lesson completion is verified.

State machine:
  IDLE
  → FIND_CURRENT_LESSON
  → FIND_INITIAL_COMPLETE
  → CLICK_INITIAL_COMPLETE
  → WAIT_FOR_CONFIRMATION
  → FIND_MODAL_COMPLETE
  → CLICK_MODAL_COMPLETE
  → WAIT_FOR_COMPLETION
  → VERIFY_COMPLETED
  → FIND_NEXT_LESSON
  → CLICK_NEXT
  → WAIT_FOR_NEXT_LESSON
  → FIND_CURRENT_LESSON (repeat)

Completion is verified by:
- confirmation modal disappearing
- current lesson sidebar/item showing completed/check cues (classes, aria, icons)
- MutationObserver-assisted waits (not fixed blind sleeps alone)

Install:
1. chrome://extensions
2. Remove any old Springboard Helper
3. Developer mode ON
4. Load unpacked → select this folder
5. Open/reload a Springboard lesson on *.onwingspan.com
6. Click the extension icon → Start Auto Complete
7. Watch the page console for [Springboard Helper] logs

Stop anytime with the Stop button. Start/Stop persists in chrome.storage.
