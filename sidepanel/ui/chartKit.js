const SVG_NS = "http://www.w3.org/2000/svg";

export function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

export function svg(tag, attrs) {
  const node = document.createElementNS(SVG_NS, tag);
  Object.entries(attrs).forEach(([k, v]) => node.setAttribute(k, String(v)));
  return node;
}

export function createChartTooltip(container) {
  const tooltip = el("div", "kpi-tip hidden");
  container.appendChild(tooltip);

  function move(event) {
    const bounds = container.getBoundingClientRect();
    const x = event.clientX - bounds.left;
    const y = event.clientY - bounds.top;
    tooltip.style.left = `${Math.min(Math.max(8, x + 12), bounds.width - tooltip.offsetWidth - 8)}px`;
    tooltip.style.top = `${Math.max(8, y - tooltip.offsetHeight - 12)}px`;
  }

  function show(title, rows, hint) {
    tooltip.innerHTML = "";
    tooltip.appendChild(el("div", "kpi-tip-title", title));
    rows.filter(Boolean).forEach((row) => tooltip.appendChild(el("div", "kpi-tip-row", row)));
    if (hint) tooltip.appendChild(el("div", "kpi-tip-hint", hint));
    tooltip.classList.remove("hidden");
  }

  function hide() {
    tooltip.classList.add("hidden");
  }

  function interactive(node, { title, rows, hint, onClick, peers = [] }) {
    node.classList.add("kpi-interactive");
    if (onClick) node.classList.add("kpi-clickable");

    const setActive = (active) => {
      node.classList.toggle("is-active", active);
      peers.forEach((p) => p.classList.toggle("is-active", active));
    };

    node.addEventListener("mouseenter", (event) => {
      show(title, rows, hint);
      move(event);
      setActive(true);
    });
    node.addEventListener("mousemove", move);
    node.addEventListener("mouseleave", () => {
      hide();
      setActive(false);
    });

    if (onClick) {
      node.addEventListener("click", () => {
        hide();
        onClick();
      });
    }
  }

  return { interactive, hide };
}
