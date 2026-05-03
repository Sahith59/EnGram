/**
 * Robust clipboard write that works even when the modern Clipboard API is
 * blocked (e.g. focus stolen by a window.open call). Falls back to a hidden
 * textarea + document.execCommand("copy"), which is synchronous and doesn't
 * require ongoing user activation.
 *
 * MUST be called inside a synchronous user gesture handler (no awaits before).
 */
export function copyToClipboard(text: string): boolean {
  // Try the modern API synchronously (returns a promise but we don't await).
  // If it works, great. If it rejects later, the legacy fallback already ran.
  let asyncWorked = false;
  try {
    if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
      navigator.clipboard
        .writeText(text)
        .then(() => {
          asyncWorked = true;
        })
        .catch(() => {
          // ignored — fallback already wrote
        });
    }
  } catch {
    // ignored
  }

  // Always run the synchronous fallback so we don't depend on async resolution.
  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.setAttribute("readonly", "");
    ta.style.position = "fixed";
    ta.style.top = "0";
    ta.style.left = "0";
    ta.style.width = "1px";
    ta.style.height = "1px";
    ta.style.opacity = "0";
    ta.style.pointerEvents = "none";
    document.body.appendChild(ta);
    ta.select();
    ta.setSelectionRange(0, text.length);
    const ok = document.execCommand("copy");
    document.body.removeChild(ta);
    return ok || asyncWorked;
  } catch {
    return asyncWorked;
  }
}
