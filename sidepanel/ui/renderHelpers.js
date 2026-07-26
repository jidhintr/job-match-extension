export function makeQBadge(text, variant) {
  const badge = document.createElement("span");
  badge.className = `prep-q-badge ${variant}`;
  badge.textContent = text;
  return badge;
}

export function fillList(el, items, emptyText) {
  el.innerHTML = "";
  const values = Array.isArray(items) ? items.filter(Boolean) : [];
  if (values.length === 0) {
    const li = document.createElement("li");
    li.textContent = emptyText || "None noted.";
    el.appendChild(li);
    return;
  }
  for (const item of values) {
    const li = document.createElement("li");
    li.textContent = item;
    el.appendChild(li);
  }
}

export function fillPills(el, items, className) {
  el.innerHTML = "";
  const values = Array.isArray(items) ? items.filter(Boolean) : [];
  if (values.length === 0) {
    const span = document.createElement("span");
    span.className = "pill";
    span.textContent = "None";
    el.appendChild(span);
    return;
  }
  for (const item of values) {
    const span = document.createElement("span");
    span.className = `pill ${className}`;
    span.textContent = item;
    el.appendChild(span);
  }
}

export function fillTechGapTable(rows) {
  const tbody = document.getElementById("techGapTableBody");
  tbody.innerHTML = "";
  const values = Array.isArray(rows) ? rows : [];
  if (values.length === 0) {
    const tr = document.createElement("tr");
    const td = document.createElement("td");
    td.colSpan = 3;
    td.textContent = "No significant technical gaps found.";
    tr.appendChild(td);
    tbody.appendChild(tr);
    return;
  }
  for (const row of values) {
    const tr = document.createElement("tr");

    const techTd = document.createElement("td");
    techTd.textContent = row.technology || "—";

    const contextTd = document.createElement("td");
    contextTd.textContent = row.context || "—";

    const sevTd = document.createElement("td");
    const badge = document.createElement("span");
    const severity = (row.severity || "Low").toString();
    badge.className = `severity-badge ${severity.toLowerCase()}`;
    badge.textContent = severity;
    sevTd.appendChild(badge);

    tr.append(techTd, contextTd, sevTd);
    tbody.appendChild(tr);
  }
}
