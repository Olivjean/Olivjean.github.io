// Index page controller: language, search, overview map, multi-faceted filters.
(async () => {
  await I18N.load();
  I18N.bind();
  I18N.apply();

  const dataPath = window.OA_DATA_PATH || "data";

  // ---- Load shared data ----
  const [legalAmazon, ilAttrs] = await Promise.all([
    fetch(`${dataPath}/legal_amazon.geojson`).then(r => r.json()).catch(() => null),
    fetch(`${dataPath}/il_attrs.json`).then(r => r.json()).catch(() => []),
  ]);
  const scalar = v => Array.isArray(v) ? v[0] : v;
  const flatUfs = u => {
    if (!u) return [];
    if (!Array.isArray(u)) return [String(u)];
    const out = [];
    for (const x of u) {
      if (Array.isArray(x)) out.push(...x);
      else out.push(String(x));
    }
    return out;
  };

  // ---- Filter state ----
  const state = {
    query: "",
    ufs: new Set(),
    phases: new Set(),
    flags: new Set(),  // "isolados", "injmp"
  };

  // ---- Render the overview map (Legal Amazon + dots) ----
  const overviewHost = document.getElementById("overview-map");
  let projection = null;
  let dotsHost = null;
  if (overviewHost && legalAmazon) {
    const result = BrazilMap.renderOverview(overviewHost, legalAmazon, ilAttrs,
      (slug) => { window.location.href = `il/${slug}.html`; });
    projection = result.project;
    dotsHost = result.dotsHost;
  }

  // ---- Render filter chips ----
  function renderUfChips() {
    const host = document.getElementById("overview-uf-chips");
    if (!host) return;
    const allUfs = new Set();
    for (const r of ilAttrs) for (const u of flatUfs(r.ufs)) allUfs.add(u);
    const sorted = Array.from(allUfs).sort();
    host.innerHTML = sorted.map(u =>
      `<button class="uf-chip ${state.ufs.has(u) ? 'active' : ''}" data-uf="${u}">${u}</button>`
    ).join("");
    host.querySelectorAll(".uf-chip").forEach(b => {
      b.addEventListener("click", () => {
        const u = b.dataset.uf;
        state.ufs.has(u) ? state.ufs.delete(u) : state.ufs.add(u);
        renderUfChips();
        applyFilters();
      });
    });
  }
  function renderPhaseChips() {
    const host = document.getElementById("overview-phase-chips");
    if (!host) return;
    const all = new Set();
    for (const r of ilAttrs) {
      const p = scalar(r.current_phase);
      if (p) all.add(p);
    }
    const sorted = Array.from(all).sort();
    host.innerHTML = sorted.map(p =>
      `<button class="uf-chip ${state.phases.has(p) ? 'active' : ''}" data-phase="${p}">${p}</button>`
    ).join("");
    host.querySelectorAll(".uf-chip").forEach(b => {
      b.addEventListener("click", () => {
        const p = b.dataset.phase;
        state.phases.has(p) ? state.phases.delete(p) : state.phases.add(p);
        renderPhaseChips();
        applyFilters();
      });
    });
  }
  function renderFlagChips() {
    const host = document.getElementById("overview-flag-chips");
    if (!host) return;
    const flags = [];
    host.innerHTML = flags.map(f =>
      `<button class="uf-chip ${state.flags.has(f.key) ? 'active' : ''}" data-flag="${f.key}">${f.label}</button>`
    ).join("");
    host.querySelectorAll(".uf-chip").forEach(b => {
      b.addEventListener("click", () => {
        const k = b.dataset.flag;
        state.flags.has(k) ? state.flags.delete(k) : state.flags.add(k);
        renderFlagChips();
        applyFilters();
      });
    });
  }

  // ---- Filter predicate ----
  function passesFilters(row) {
    // text query
    const q = state.query.trim().toLowerCase();
    if (q) {
      const hay = [
        scalar(row.name_pt) || "",
        flatUfs(row.ufs).join(","),
        (row.ethnicities || []).map(e =>
          typeof e === "string" ? e : (e.pt || e.en || e.name || "")
        ).join(","),
      ].join(" ").toLowerCase();
      if (!hay.includes(q)) return false;
    }
    // UF
    if (state.ufs.size > 0) {
      const ufs = flatUfs(row.ufs);
      if (!ufs.some(u => state.ufs.has(u))) return false;
    }
    // phase
    if (state.phases.size > 0) {
      const p = scalar(row.current_phase) || "";
      if (!state.phases.has(p)) return false;
    }
    // flags
    if (state.flags.has("isolados")) {
      const v = scalar(row.has_isolados);
      if (!v) return false;
    }
    return true;
  }

  function applyFilters() {
    const filteredAttrs = ilAttrs.filter(passesFilters);
    // 1. Filter grid cards
    let visible = 0;
    document.querySelectorAll(".il-card").forEach(c => {
      const cod = String(c.dataset.cod);
      const keep = filteredAttrs.some(r => String(scalar(r.terrai_cod)) === cod);
      c.style.display = keep ? "" : "none";
      if (keep) visible++;
    });
    const count = document.querySelector(".index-count");
    if (count) count.textContent = state.query || state.ufs.size || state.phases.size || state.flags.size
      ? `${visible} / ${ilAttrs.length}`
      : `${ilAttrs.length} Indigenous Lands`;
    // 2. Filter overview-map dots
    if (dotsHost && projection) {
      BrazilMap.redrawDots(dotsHost, filteredAttrs, projection,
        (slug) => { window.location.href = `il/${slug}.html`; });
    }
  }

  // ---- Search input ----
  const search = document.getElementById("il-search");
  if (search) {
    search.addEventListener("input", () => {
      state.query = search.value;
      applyFilters();
    });
  }

  renderUfChips();
  renderPhaseChips();
  renderFlagChips();
  applyFilters();

  window.addEventListener("oa:langchange", () => {
    if (search) {
      const ph = I18N.t("index.search_placeholder");
      if (ph) search.placeholder = ph;
    }
    renderFlagChips();
  });
  if (search) {
    const ph = I18N.t("index.search_placeholder");
    if (ph && ph !== "index.search_placeholder") search.placeholder = ph;
  }
})();
