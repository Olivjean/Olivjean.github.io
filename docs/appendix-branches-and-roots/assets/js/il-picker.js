const IlPicker = (() => {
  const dataPath = window.OA_DATA_PATH || "data";
  const LIMIT = 100;
  let rows = [];
  let indexPromise = null;
  let ufs = [];
  const activeUFs = new Set();
  let query = "";
  let currentSlug = null;
  let options = [];
  let active = -1;
  let input, panel, list, states, field, sw;

  const scalar = v => Array.isArray(v) ? v[0] : v;
  const flatUfs = u => {
    if (!u) return [];
    if (!Array.isArray(u)) return [String(u)];
    const out = [];
    for (const x of u) {
      if (Array.isArray(x)) out.push(...x.map(String));
      else out.push(String(x));
    }
    return out;
  };
  const normalize = s => (s || "").toString().toLowerCase().normalize("NFD").replace(/\p{M}/gu, "");

  function index() {
    if (!indexPromise) {
      indexPromise = fetch(`${dataPath}/il_attrs.json${window.OA_VERSION ? `?v=${window.OA_VERSION}` : ""}`)
        .then(r => r.json())
        .then(data => {
          rows = (data || []).filter(r => r && (r.slug || r.terrai_cod)).map(r => ({
            cod: scalar(r.terrai_cod),
            slug: String(scalar(r.slug) || scalar(r.terrai_cod)),
            name: String(scalar(r.name_pt) || ""),
            key: normalize(scalar(r.name_pt)),
            ufs: flatUfs(r.ufs),
          }));
          rows.sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
          return rows;
        })
        .catch(e => { console.warn("il-picker: failed to load il_attrs.json", e); rows = []; return rows; });
    }
    return indexPromise;
  }

  function matches() {
    const q = normalize(query.trim());
    const pool = activeUFs.size ? rows.filter(r => r.ufs.some(u => activeUFs.has(u))) : rows;
    if (!q) return pool;
    const starts = [], contains = [];
    for (const r of pool) {
      if (r.key.startsWith(q)) starts.push(r);
      else if (r.key.includes(q)) contains.push(r);
    }
    return starts.concat(contains);
  }

  function renderStates() {
    states.textContent = "";
    const label = document.createElement("span");
    label.className = "picker-states-label";
    label.textContent = I18N.t("picker.uf_label");
    states.appendChild(label);
    const strip = document.createElement("span");
    strip.className = "state-strip";
    strip.setAttribute("role", "group");
    strip.setAttribute("aria-label", I18N.t("picker.uf_label").replace(/:\s*$/, ""));
    states.appendChild(strip);
    for (const u of ufs) {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "state";
      b.textContent = u;
      b.setAttribute("aria-pressed", activeUFs.has(u) ? "true" : "false");
      b.addEventListener("click", () => {
        if (activeUFs.has(u)) activeUFs.delete(u); else activeUFs.add(u);
        b.setAttribute("aria-pressed", activeUFs.has(u) ? "true" : "false");
        renderList();
        input.focus();
      });
      strip.appendChild(b);
    }
  }

  function renderList() {
    const found = matches();
    list.textContent = "";
    options = [];
    active = -1;
    input.removeAttribute("aria-activedescendant");
    if (found.length === 0) {
      const p = document.createElement("p");
      p.className = "picker-empty";
      p.textContent = I18N.t("picker.no_results");
      list.appendChild(p);
      return;
    }
    found.slice(0, LIMIT).forEach((r, i) => {
      const a = document.createElement("a");
      a.className = "picker-option";
      a.id = `il-opt-${i}`;
      a.href = `#il=${r.slug}`;
      a.setAttribute("role", "option");
      a.tabIndex = -1;
      if (r.slug === currentSlug) a.setAttribute("aria-current", "true");
      const name = document.createElement("span");
      name.className = "picker-name";
      name.textContent = r.name || "–";
      const uf = document.createElement("span");
      uf.className = "picker-uf";
      uf.textContent = r.ufs.join(", ");
      a.append(name, uf);
      a.addEventListener("click", () => { reset(); close(); input.blur(); });
      list.appendChild(a);
      options.push(a);
    });
    if (found.length > LIMIT) {
      const p = document.createElement("p");
      p.className = "picker-more";
      p.textContent = I18N.t("picker.more").replace("{n}", found.length - LIMIT);
      list.appendChild(p);
    }
  }

  function setActive(i) {
    if (!options.length) return;
    if (active >= 0 && options[active]) options[active].removeAttribute("aria-selected");
    active = (i + options.length) % options.length;
    const el = options[active];
    el.setAttribute("aria-selected", "true");
    input.setAttribute("aria-activedescendant", el.id);
    el.scrollIntoView({ block: "nearest" });
  }

  function open() {
    if (!panel.hidden) return;
    renderList();
    panel.hidden = false;
    input.setAttribute("aria-expanded", "true");
    if (sw) sw.setAttribute("aria-expanded", "true");
  }

  function close() {
    panel.hidden = true;
    input.setAttribute("aria-expanded", "false");
    if (sw) sw.setAttribute("aria-expanded", "false");
    input.removeAttribute("aria-activedescendant");
  }

  function reset() {
    input.value = "";
    query = "";
  }

  function go(slug) {
    reset();
    close();
    input.blur();
    if (slug) window.location.hash = `#il=${slug}`;
  }

  function onKey(e) {
    if (e.key === "ArrowDown") { e.preventDefault(); open(); setActive(active + 1); }
    else if (e.key === "ArrowUp") { e.preventDefault(); open(); setActive(active - 1); }
    else if (e.key === "Enter") {
      const el = options[active >= 0 ? active : 0];
      if (!panel.hidden && el) { e.preventDefault(); go(el.getAttribute("href").replace("#il=", "")); }
    } else if (e.key === "Escape") {
      if (input.value) { reset(); renderList(); }
      else { close(); if (sw) sw.focus(); else input.blur(); }
    }
  }

  function setCurrent(slug) {
    currentSlug = slug;
    if (!panel.hidden) renderList();
  }

  async function init() {
    field = document.querySelector(".picker-field");
    input = document.getElementById("il-picker-input");
    panel = document.getElementById("il-picker-panel");
    list = document.getElementById("il-picker-list");
    states = document.getElementById("state-filters");
    if (!field || !input || !panel || !list || !states) return;

    await I18N.load();
    await index();
    const all = new Set();
    rows.forEach(r => r.ufs.forEach(u => all.add(u)));
    ufs = Array.from(all).sort();
    renderStates();

    panel.addEventListener("mousedown", e => { if (!e.target.closest("a") && e.target !== input) e.preventDefault(); });
    sw = document.getElementById("land-switch");
    if (sw) sw.addEventListener("click", () => {
      if (panel.hidden) { open(); input.focus(); }
      else { close(); }
    });
    input.addEventListener("focus", open);
    input.addEventListener("click", open);
    input.addEventListener("input", () => { query = input.value; open(); renderList(); });
    input.addEventListener("keydown", onKey);
    field.addEventListener("focusout", e => {
      if (!field.contains(e.relatedTarget)) setTimeout(() => { if (!field.contains(document.activeElement)) close(); }, 120);
    });
    window.addEventListener("oa:langchange", () => { renderStates(); if (!panel.hidden) renderList(); });
  }

  return { init, index, setCurrent };
})();
