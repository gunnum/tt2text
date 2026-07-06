const toastTimers = new WeakMap();

export function setStatus(statusEl, message) {
  if (statusEl) {
    statusEl.textContent = message;
  }
}

export function showToast(toastEl, message, timeoutMs = 2800) {
  if (!toastEl) return;
  toastEl.textContent = message;
  toastEl.hidden = false;
  const existingTimer = toastTimers.get(toastEl);
  if (existingTimer) {
    window.clearTimeout(existingTimer);
  }
  const nextTimer = window.setTimeout(() => {
    toastEl.hidden = true;
    toastTimers.delete(toastEl);
  }, timeoutMs);
  toastTimers.set(toastEl, nextTimer);
}
