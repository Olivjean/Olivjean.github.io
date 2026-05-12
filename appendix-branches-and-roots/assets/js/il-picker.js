// IL picker: searchable dropdown listing every IL in il_attrs.json,
// with multi-select UF filter chips. Selecting an IL navigates to its page.
//
// Mount points (must exist in the breadcrumb row):
//   #il-picker-input   <input type="text">
//   #il-picker-list    <div>            -- options drop down here
//   #state-filters     <div>            -- UF chips render here

const IlPicker = (() => {
  let all = [];        // array of attrs rows
  let activeUFs = new Set();   // empty set = no filter
  let activeQuery = "";
  let currentCod = null;

  const dataPath = (window.OA_DATA_PATH || "../data");

  // Helpers — il_attrs.json sometimes has scalar / sometimes array fields
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

  // Lowercase + strip accents so "andira" matches "Andirá".
  function normalize(s) {
    return (s || "").toString().toLowerCase()
      .normalize("NFD").replace(/\p{M}/gu, "");
  }

  function matchesFilters(row) {
    const ufs = flatUfs(row.ufs);
    if (activeUFs.size > 0 && !ufs.some(u => activeUFs.has(u))) return false;
    const q = normalize(activeQuery.trim());
    if (!q) return true;
    // Prefix match on the IL name — typing "g" returns names starting with g,
    // "go" narrows to names starting with go, etc.
    return normalize(scalar(row.name_pt)).startsWith(q);
  }

  function renderList() {
    const list = document.getElementById("il-picker-list");
    if (!list) return;
    const filtered = all.filter(matchesFilters);
    if (filtered.length === 0) {
      list.innerHTML = `<div class="il-picker-empty">${I18N.t("picker.no_results")}</div>`;
      return;
    }
    list.innerHTML = filtered.slice(0, 100).map(row => {
      const cod = scalar(row.terrai_cod);
      const slug = scalar(row.slug) || String(cod);
      const name = scalar(row.name_pt) || "—";
      const ufs = flatUfs(row.ufs).join(", ");
      const cur = (cod == currentCod) ? "current" : "";
      // SPA: navigate by URL hash. Card.js listens for hashchange.
      return `<a class="il-picker-option ${cur}" href="#il=${slug}" data-slug="${slug}">
        <span class="il-picker-name">${name}</span>
        <span class="il-picker-uf">${ufs}</span>
      </a>`;
    }).join("");
    // After click, close the list and update the input value
    list.querySelectorAll(".il-picker-option").forEach(a => {
      a.addEventListener("click", () => {
        const input = document.getElementById("il-picker-input");
        if (input) {
          input.value = "";
          activeQuery = "";
        }
        list.classList.remove("open");
      });
    });
    if (filtered.length > 100) {
      const tmpl = I18N.t("picker.more");
      const msg = tmpl.replace("{n}", filtered.length - 100);
      list.insertAdjacentHTML("beforeend",
        `<div class="il-picker-more">${msg}</div>`);
    }
  }

  function renderFilters() {
    const host = document.getElementById("state-filters");
    if (!host) return;
    const allUfs = new Set();
    for (const r of all) for (const u of flatUfs(r.ufs)) allUfs.add(u);
    const sorted = Array.from(allUfs).sort();
    host.innerHTML = `<span class="filter-label">${I18N.t("picker.uf_label")}</span>` +
      sorted.map(u =>
        `<button class="uf-chip ${activeUFs.has(u) ? 'active' : ''}" data-uf="${u}">${u}</button>`
      ).join("");
    host.querySelectorAll(".uf-chip").forEach(btn => {
      btn.addEventListener("click", () => {
        const u = btn.dataset.uf;
        if (activeUFs.has(u)) activeUFs.delete(u);
        else activeUFs.add(u);
        renderFilters();
        renderList();
      });
    });
  }

  async function init() {
    // Ensure the i18n dictionary is loaded BEFORE we render anything;
    // otherwise renderFilters() falls back to raw keys like "picker.uf_label".
    try { await I18N.load(); } catch (e) { /* already loaded */ }
    try {
      all = await fetch(`${dataPath}/il_attrs.json`).then(r => r.json());
    } catch (e) {
      console.warn("il-picker: failed to load il_attrs.json", e);
      return;
    }
    function readHashCod() {
      const m = (window.location.hash || "").match(/[#&?]il=([^&]+)/);
      if (!m) return null;
      const v = decodeURIComponent(m[1]);
      const hit = all.find(r => String(scalar(r.slug)) === v || String(scalar(r.terrai_cod)) === v);
      return hit ? scalar(hit.terrai_cod) : null;
    }
    currentCod = readHashCod() || window.OA_IL_CODE;
    window.addEventListener("hashchange", () => {
      currentCod = readHashCod() || currentCod;
      renderList();
    });

    const input = document.getElementById("il-picker-input");
    const list = document.getElementById("il-picker-list");
    if (!input || !list) return;

    // Show/hide list on focus/blur (with a small delay so option clicks fire first)
    input.addEventListener("focus", () => { list.classList.add("open"); });
    input.addEventListener("blur",  () => { setTimeout(() => list.classList.remove("open"), 150); });
    input.addEventListener("input", () => {
      activeQuery = input.value;
      list.classList.add("open");
      renderList();
    });
    // Esc clears query
    input.addEventListener("keydown", (e) => {
      if (e.key === "Escape") { input.value = ""; activeQuery = ""; renderList(); input.blur(); }
    });

    renderFilters();
    renderList();

    // Re-translate when language changes
    window.addEventListener("oa:langchange", () => {
      renderFilters();
      renderList();
      input.placeholder = I18N.t("picker.placeholder");
    });
    input.placeholder = I18N.t("picker.placeholder");
  }

  return { init };
})();
