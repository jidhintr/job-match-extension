export function createStatusLine(element) {
  return function setLineStatus(message, kind) {
    element.textContent = message || "";
    element.classList.remove("err", "ok");
    if (kind) element.classList.add(kind);
  };
}
