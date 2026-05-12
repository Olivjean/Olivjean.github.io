// IL card controller — orchestrates map, year slider, toggles, and plot.
// Expects window.OA_IL_CODE to be set before this script loads.

const Card = (() => {
  let attrs = null;
  let series = null;
  let geo = null;
  let defor = null;
  let map = null;
  let tileLayer = null;
  let layers = {};
  let deforLayer = null;
  let currentYear = 2024;
  let view = "il";  // "il" or "iltf"
  let mapMode = "focused";  // "focused" or "context"
  let playInterval = null;

  // Default + hover styles for ILTF municipalities (used both at init and on hover).
  const ILTF_DEFAULT_STYLE = { fillColor: "#888888", fillOpacity: 0.5,
                               color: "#cfd8e3", weight: 0.6, opacity: 0.55 };
  const ILTF_HOVER_STYLE   = { fillColor: "#6bd5b4", fillOpacity: 0.55,
                               color: "#ffd166", weight: 2.5, opacity: 1 };

  const dataPath = (window.OA_DATA_PATH || "../data");

  let legalAmazon = null;
  let plotMode = "yearly";   // "yearly" or "cumulative"
  let ilIndex = null;        // il_attrs.json (used for slug → cod lookup)

  function slugToCod(slug) {
    if (!ilIndex || !slug) return null;
    const s = String(slug);
    const hit = ilIndex.find(r => String(r.slug) === s || String(r.terrai_cod) === s);
    return hit ? (Array.isArray(hit.terrai_cod) ? hit.terrai_cod[0] : hit.terrai_cod) : null;
  }
  function codFromHash() {
    const m = (window.location.hash || "").match(/[#&?]il=([^&]+)/);
    if (!m) return null;
    return slugToCod(decodeURIComponent(m[1]));
  }
  function codToSlug(cod) {
    if (!ilIndex) return null;
    const c = String(cod);
    const hit = ilIndex.find(r => String(Array.isArray(r.terrai_cod) ? r.terrai_cod[0] : r.terrai_cod) === c);
    return hit ? (Array.isArray(hit.slug) ? hit.slug[0] : hit.slug) : null;
  }

  async function loadData(code) {
    const [a, s, g, d, la] = await Promise.all([
      fetch(`${dataPath}/attrs/${code}.json`).then(r => r.json()),
      fetch(`${dataPath}/series/${code}.json`).then(r => r.json()),
      fetch(`${dataPath}/geo/${code}.geojson`).then(r => r.json()),
      fetch(`${dataPath}/defor/${code}.geojson`).then(r => r.json()),
      fetch(`${dataPath}/legal_amazon.geojson`).then(r => r.json())
        .catch(() => null),
    ]);
    attrs = a; series = s; geo = g; defor = d; legalAmazon = la;
    currentYear = series.years[series.years.length - 1];
  }

  // ---- Map ----
  function initMap() {
    map = L.map("map", {
      zoomControl: true,
      attributionControl: true,
      preferCanvas: true,
    });

    // Tile layer (only added in "context" mode)
    tileLayer = L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
      maxZoom: 14,
      opacity: 0.65,
    });

    const styles = {
      iltf: ILTF_DEFAULT_STYLE,
      il:   { fillColor: "#4fc784", fillOpacity: 0.6,
              color: "#ffffff", weight: 2.0 },
    };

    // Order: iltf (under), il (top). Outer ring is intentionally not rendered.
    for (const layerName of ["iltf", "il"]) {
      const feats = geo.features.filter(f => f.properties.layer === layerName);
      if (feats.length === 0) continue;
      const layer = L.geoJSON({ type: "FeatureCollection", features: feats }, {
        style: styles[layerName],
      }).addTo(map);
      layers[layerName] = layer;
    }

    // Defor "dots": render one circleMarker at the centroid of every feature.
    // This is robust to whatever geometry type the GeoJSON serializer produced
    // (Polygon / MultiPolygon / GeometryCollection alike) and stays visible at any zoom.
    deforLayer = L.layerGroup().addTo(map);

    updateDeforYear(currentYear);
    applyMapMode();  // sets initial bounds, interaction state, and tile visibility
  }

  function fitToBounds(targetLayers, padding = 20) {
    let b = null;
    for (const k of targetLayers) {
      if (layers[k]) {
        const lb = layers[k].getBounds();
        b = b ? b.extend(lb) : lb;
      }
    }
    if (b) map.fitBounds(b, { padding: [padding, padding] });
  }

  function applyMapMode() {
    const focused = mapMode === "focused";
    if (focused) {
      if (map.hasLayer(tileLayer)) map.removeLayer(tileLayer);
      // Allow zooming/panning within the ILTF only.
      // 1. Compute the ILTF extent (fallback to IL if ILTF missing).
      const iltfLayer = layers.iltf || layers.il;
      if (iltfLayer) {
        const iltfBounds = iltfLayer.getBounds();
        // Min zoom = the zoom level where the ILTF just fits the viewport.
        // setMaxBounds keeps panning constrained to the ILTF rectangle.
        map.setMaxBounds(iltfBounds.pad(0.04));
        map.setMinZoom(map.getBoundsZoom(iltfBounds, true));
        // No artificial maxZoom — let users zoom into deforestation dots.
        map.setMaxZoom(18);
      }
      // Re-enable interactions (zoom + pan are now naturally clamped).
      map.dragging.enable();
      map.scrollWheelZoom.enable();
      map.doubleClickZoom.enable();
      map.touchZoom.enable();
      map.boxZoom.enable();
      map.keyboard.enable();
      if (!map.zoomControl) map.zoomControl = L.control.zoom().addTo(map);
      // Default view: IL fills the frame.
      fitToBounds(["il"], 18);
    } else {
      if (!map.hasLayer(tileLayer)) tileLayer.addTo(map);
      // Context mode: free zoom + pan.
      map.setMaxBounds(null);
      map.setMinZoom(0);
      map.setMaxZoom(18);
      map.dragging.enable();
      map.scrollWheelZoom.enable();
      map.doubleClickZoom.enable();
      map.touchZoom.enable();
      map.boxZoom.enable();
      map.keyboard.enable();
      if (!map.zoomControl) map.zoomControl = L.control.zoom().addTo(map);
      // Context: zoom out to IL + full ILTF so the territorial footprint is visible.
      fitToBounds(["iltf", "il"], 40);
    }
    // Update the toggle button labels
    document.querySelectorAll(".map-mode-toggle button").forEach(b =>
      b.classList.toggle("active", b.dataset.mode === mapMode));
  }

  // Compute bbox-centroid (lng, lat) of any GeoJSON geometry.
  function geomCentroid(geom) {
    if (!geom) return null;
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    function walk(node) {
      if (Array.isArray(node)) {
        if (node.length > 0 && typeof node[0] === "number" && typeof node[1] === "number") {
          if (node[0] < minX) minX = node[0];
          if (node[0] > maxX) maxX = node[0];
          if (node[1] < minY) minY = node[1];
          if (node[1] > maxY) maxY = node[1];
        } else {
          for (const x of node) walk(x);
        }
      } else if (node && Array.isArray(node.coordinates)) {
        walk(node.coordinates);
      } else if (node && Array.isArray(node.geometries)) {
        for (const g of node.geometries) walk(g);
      }
    }
    walk(geom);
    if (!isFinite(minX)) return null;
    return [(minX + maxX) / 2, (minY + maxY) / 2];
  }

  function updateDeforYear(year) {
    currentYear = year;
    deforLayer.clearLayers();
    for (const f of (defor.features || [])) {
      if ((f.properties && f.properties.year || 0) > year) continue;
      const c = geomCentroid(f.geometry);
      if (!c) continue;
      L.circleMarker([c[1], c[0]], {
        radius: 2.5, color: "#ff4d4d", fillColor: "#ff4d4d",
        fillOpacity: 0.85, weight: 0,
      }).addTo(deforLayer);
    }
  }

  // ---- Slider ----
  function initSlider() {
    const slider = document.getElementById("year-slider");
    const display = document.getElementById("year-display");
    const playBtn = document.getElementById("play-btn");
    const years = series.years;
    slider.min = years[0];
    slider.max = years[years.length - 1];
    slider.value = currentYear;
    display.textContent = currentYear;

    slider.addEventListener("input", () => {
      const y = parseInt(slider.value, 10);
      display.textContent = y;
      updateDeforYear(y);
    });

    playBtn.addEventListener("click", () => {
      if (playInterval) {
        clearInterval(playInterval);
        playInterval = null;
        playBtn.classList.remove("playing");
        playBtn.textContent = I18N.t("map.play");
      } else {
        playBtn.classList.add("playing");
        playBtn.textContent = I18N.t("map.pause");
        let y = parseInt(slider.value, 10);
        if (y >= parseInt(slider.max, 10)) y = parseInt(slider.min, 10);
        playInterval = setInterval(() => {
          y += 1;
          if (y > parseInt(slider.max, 10)) {
            clearInterval(playInterval);
            playInterval = null;
            playBtn.classList.remove("playing");
            playBtn.textContent = I18N.t("map.play");
            return;
          }
          slider.value = y;
          display.textContent = y;
          updateDeforYear(y);
        }, 800);
      }
    });
  }

  // ---- Info block ----
  function fmtList(items, lang) {
    if (!items || items.length === 0) return "—";
    const labelOf = x => typeof x === "string" ? x : (x[lang] || x.en || x.name || x.pt) || "";
    const tagged = [];
    let isoladosCount = 0;
    let firstIsolado = null;
    const seen = new Set();
    for (const x of items) {
      const text = labelOf(x);
      if (!text) continue;
      if (/^isolados?\b/i.test(text)) {
        isoladosCount += 1;
        if (!firstIsolado) firstIsolado = text;
        continue;
      }
      if (seen.has(text)) continue;
      seen.add(text);
      tagged.push(text);
    }
    if (isoladosCount > 0 && isoladosCount <= 3) {
      // 1–3 isolados: keep each as its own tag
      for (const x of items) {
        const text = labelOf(x);
        if (/^isolados?\b/i.test(text) && !seen.has(text)) {
          seen.add(text);
          tagged.push(text);
        }
      }
    } else if (isoladosCount > 3) {
      tagged.push(lang === "pt" ? "Isolados (vários)" : "Isolados (various)");
    }
    return tagged.map(t => `<span class="tag">${t}</span>`).join("");
  }

  function auditBadge(score) {
    if (score == null || isNaN(score)) {
      return `<span class="audit-pill audit-unknown">${I18N.t("audit.unknown")}</span>`;
    }
    if (score >= 8) return `<span class="audit-pill audit-high">${score.toFixed(1)} — ${I18N.t("audit.high")}</span>`;
    if (score >= 5) return `<span class="audit-pill audit-medium">${score.toFixed(1)} — ${I18N.t("audit.medium")}</span>`;
    return `<span class="audit-pill audit-low">${score.toFixed(1)} — ${I18N.t("audit.low")}</span>`;
  }

  function renderNarrative() {
    const host = document.getElementById("narrative");
    if (!host) return;
    const lang = I18N.current;
    const name = (lang === "pt" ? attrs.name_pt : attrs.name_en) || "";
    const area = (typeof attrs.area_km2 === "number")
      ? attrs.area_km2.toLocaleString(undefined, { maximumFractionDigits: 0 }) + " km²"
      : "";
    const ufs = (attrs.ufs || []).map(u => Array.isArray(u) ? u[0] : u).join(", ");
    const peoples = (attrs.ethnicities || []).map(e => {
      if (typeof e === "string") return e;
      return e[lang] || e.en || e.pt || e.name || "";
    }).filter(Boolean).join(", ") || "—";
    const homDate = attrs.phases && attrs.phases.homologada && attrs.phases.homologada.date;
    const homYear = homDate ? String(homDate).slice(0, 4) : null;
    const last = series.years[series.years.length - 1];
    const total = (series.defor_km2 || []).reduce((a, b) => a + (Number(b) || 0), 0);
    const totalStr = total.toFixed(1);
    let s;
    if (lang === "pt") {
      const homClause = homYear ? `, homologada em ${homYear}` : "";
      s = `${name} é uma terra indígena de ${area} do povo ${peoples}, em ${ufs}${homClause}. ` +
          `O PRODES registrou ${totalStr} km² de desmatamento por corte raso em seus limites entre 2008 e ${last}.`;
    } else {
      const homClause = homYear ? `, homologated in ${homYear}` : "";
      s = `${name} is a ${area} territory of the ${peoples} people in ${ufs}${homClause}. ` +
          `PRODES recorded ${totalStr} km² of clear-cut forest loss inside it between 2008 and ${last}.`;
    }
    host.textContent = s;
  }

  function renderPhaseTimeline() {
    const host = document.getElementById("phase-timeline");
    if (!host) return;
    const t = (k) => I18N.t(k);
    const phases = [
      ["em_estudo",    "phases.em_estudo"],
      ["delimitada",   "phases.delimitada"],
      ["declarada",    "phases.declarada"],
      ["homologada",   "phases.homologada"],
      ["regularizada", "phases.regularizada"],
    ];
    // Current phase index (so steps before/equal-to current are "filled")
    const currentMap = { "em estudo": 0, "delimitada": 1, "declarada": 2,
                         "homologada": 3, "regularizada": 4 };
    const curIdx = (attrs.current_phase || "").toLowerCase().normalize("NFD")
                   .replace(/[̀-ͯ]/g, "");
    const curRank = currentMap[curIdx];
    host.innerHTML = phases.map(([key, i18nKey], i) => {
      const date = attrs.phases && attrs.phases[key] && attrs.phases[key].date;
      const dateStr = date ? String(date).slice(0, 10) : "—";
      const reached = (typeof curRank === "number" && i <= curRank) || !!date;
      const klass = "phase-step" + (reached ? " reached" : "") +
                    (date ? " has-date" : "");
      return `<div class="${klass}">
        <div class="phase-dot"></div>
        <div class="phase-meta">
          <div class="phase-label">${t(i18nKey)}</div>
          <div class="phase-date">${dateStr}</div>
        </div>
      </div>`;
    }).join('<div class="phase-line"></div>');
  }

  function renderInset() {
    const host = document.getElementById("inset-map");
    if (!host || !legalAmazon || !attrs.centroid) return;
    BrazilMap.renderInset(host, legalAmazon, attrs.centroid, { W: 110, H: 90 });
  }

  function renderInfo() {
    const lang = I18N.current;
    const t = (k) => I18N.t(k);
    const yes = t("info.yes"), no = t("info.no");
    const titleEl = document.getElementById("right-pane-title");
    const infoEl = document.getElementById("info-block");
    const name = lang === "pt" ? attrs.name_pt : attrs.name_en;
    titleEl.textContent = name;

    if (view === "il") {
      // Translate the current_phase using the phases.* i18n keys.
      const phaseRaw = attrs.current_phase || "";
      const phaseKey = "phases." + phaseRaw.toLowerCase()
        .normalize("NFD").replace(/[̀-ͯ]/g, "")
        .replace(/\s+/g, "_");
      const phaseTranslated = t(phaseKey);
      const phaseLabel = (phaseTranslated === phaseKey) ? (phaseRaw || "—") : phaseTranslated;
      const infoUrl = t("phases.info_url");
      const infoTooltip = t("phases.info_tooltip");
      infoEl.innerHTML = `
        <div class="info-row"><span class="label" data-i18n="info.ethnicities">${t("info.ethnicities")}</span>
          <span class="value">${fmtList(attrs.ethnicities, lang)}</span></div>
        <div class="info-row"><span class="label" data-i18n="info.languages">${t("info.languages")}</span>
          <span class="value">${fmtList(attrs.languages, lang)}</span></div>
        <div class="info-row"><span class="label" data-i18n="info.ufs">${t("info.ufs")}</span>
          <span class="value">${(attrs.ufs || []).join(", ") || "—"}</span></div>
        <div class="info-row"><span class="label" data-i18n="info.area_km2">${t("info.area_km2")}</span>
          <span class="value">${attrs.area_km2 ? attrs.area_km2.toLocaleString() + " " + t("info.area_unit") : "—"}</span></div>
        <div class="info-row phase-row">
          <span class="label" data-i18n="info.phase">${t("info.phase")}</span>
          <span class="value phase-value">
            <span>${phaseLabel}</span>
            <a class="phase-info" href="${infoUrl}" target="_blank" rel="noopener"
               title="${infoTooltip}" aria-label="${infoTooltip}">ⓘ</a>
          </span></div>
`;
    } else {
      // ILTF view
      const munis = attrs.iltf_munis || [];
      const muniHtml = munis.length > 0
        ? `<div class="iltf-muni-list">${munis.map(m => {
            const label = m.name || m.id_municipio;
            return `<span class="muni" data-muni-name="${label}">${label}</span>`;
          }).join("")}</div>`
        : `<em style="color:var(--text-dim)">${t("info.n_munis")}: ${munis.length}</em>`;
      infoEl.innerHTML = `
        <div class="info-row"><span class="label" data-i18n="info.iltf_intro_short">ILTF</span>
          <span class="value" style="font-style:italic; color:var(--text-dim); font-size:0.85rem;">
            ${t("info.iltf_intro")}</span></div>
        <div class="info-row"><span class="label" data-i18n="info.n_munis">${t("info.n_munis")}</span>
          <span class="value">${munis.length}</span></div>
        <div class="info-row"><span class="label" data-i18n="info.iltf_munis_label">${t("info.iltf_munis_label")}</span>
          <span class="value">${muniHtml}</span></div>`;
    }
  }

  // ---- Plot ----
  function renderPlot() {
    const t = (k) => I18N.t(k);
    const x = series.years;
    let y, title, ylabel, caption, color, plotType;
    // Toggle visibility of the cumulative pill (only meaningful for the IL view)
    const cumWrap = document.querySelector(".plot-mode-toggle");
    if (cumWrap) cumWrap.style.display = (view === "il") ? "inline-flex" : "none";

    if (view === "il") {
      const isCum = plotMode === "cumulative";
      y = isCum ? (series.defor_cumulative_km2 || []) : (series.defor_km2 || []);
      title   = isCum ? t("plot.defor_cum.title")  : t("plot.defor.title");
      ylabel  = isCum ? t("plot.defor_cum.y")      : t("plot.defor.y");
      caption = isCum ? t("plot.defor_cum.caption"): t("plot.defor.caption");
      color   = "#ff4d4d";
      plotType = isCum ? "scatter" : "bar";
    } else {
      y = series.branches_iltf;
      title   = t("plot.branches.title");
      ylabel  = t("plot.branches.y");
      caption = t("plot.branches.caption");
      color   = "#6bd5b4";
      plotType = "bar";
    }
    document.getElementById("plot-caption").textContent = caption;

    const trace = plotType === "scatter" ? {
      x, y, type: "scatter", mode: "lines+markers",
      line: { color, width: 2.5 },
      marker: { color, size: 6 },
      fill: "tozeroy",
      fillcolor: "rgba(255,77,77,0.15)",
      hovertemplate: "%{x}: %{y:.2f} km²<extra></extra>",
    } : {
      x, y, type: "bar",
      marker: { color },
      hovertemplate: "%{x}: %{y:.2f}<extra></extra>",
    };
    const yMax = Math.max(0, ...((y || []).map(v => Number(v) || 0))) * 1.10 + 0.5;
    const layout = {
      margin: { l: 50, r: 16, t: 36, b: 40 },
      paper_bgcolor: "transparent",
      plot_bgcolor: "transparent",
      font: { color: "#e8eef5", family: "-apple-system, sans-serif", size: 11 },
      title: { text: title, font: { size: 13 }, x: 0.02 },
      xaxis: { gridcolor: "#355577", tickcolor: "#355577", color: "#a8b8cc", dtick: 2 },
      yaxis: { title: ylabel, gridcolor: "#355577", tickcolor: "#355577",
               color: "#a8b8cc", rangemode: "tozero", range: [0, yMax] },
      shapes: [{
        type: "line",
        x0: currentYear, x1: currentYear, yref: "paper", y0: 0, y1: 1,
        line: { color: "#ffd166", width: 1.5, dash: "dot" },
      }],
    };
    Plotly.react("plot", [trace], layout, { displayModeBar: false, responsive: true });
    // Sync the active state of the yearly/cumulative pill
    document.querySelectorAll(".plot-mode-toggle button").forEach(b =>
      b.classList.toggle("active", b.dataset.mode === plotMode));
  }

  function initPlotModeToggle() {
    document.querySelectorAll(".plot-mode-toggle button").forEach(btn => {
      btn.addEventListener("click", () => {
        plotMode = btn.dataset.mode;
        renderPlot();
      });
    });
  }

  // ---- View toggle ----
  function initToggle() {
    document.querySelectorAll(".view-toggle button").forEach(btn => {
      btn.addEventListener("click", () => {
        view = btn.dataset.view;
        document.querySelectorAll(".view-toggle button").forEach(b =>
          b.classList.toggle("active", b.dataset.view === view));
        renderInfo();
        renderPlot();
      });
    });
  }

  // ---- Highlight a single ILTF muni polygon on hover ----
  function setMuniStyle(name, style) {
    if (!layers.iltf) return;
    layers.iltf.eachLayer(l => {
      if (l.feature && l.feature.properties && l.feature.properties.name === name) {
        l.setStyle(style);
      }
    });
  }

  function initMuniHover() {
    const infoEl = document.getElementById("info-block");
    if (!infoEl) return;
    // Event delegation — info-block is re-rendered on view/lang change, so the
    // bind has to be on the stable parent. The handler checks data-muni-name.
    infoEl.addEventListener("mouseover", (e) => {
      const t = e.target.closest && e.target.closest(".muni");
      if (t && t.dataset.muniName) setMuniStyle(t.dataset.muniName, ILTF_HOVER_STYLE);
    });
    infoEl.addEventListener("mouseout", (e) => {
      const t = e.target.closest && e.target.closest(".muni");
      if (t && t.dataset.muniName) setMuniStyle(t.dataset.muniName, ILTF_DEFAULT_STYLE);
    });
  }

  // ---- Map-mode toggle (focused / context) ----
  function initMapModeToggle() {
    document.querySelectorAll(".map-mode-toggle button").forEach(btn => {
      btn.addEventListener("click", () => {
        mapMode = btn.dataset.mode;
        applyMapMode();
      });
    });
  }

  // ---- Citation actions in the header ----
  function initFooter() {
    const flash = (btn, originalKey) => {
      const original = btn.textContent;
      btn.textContent = "✓";
      btn.classList.add("copied");
      setTimeout(() => {
        btn.textContent = originalKey ? I18N.t(originalKey) : original;
        btn.classList.remove("copied");
      }, 1500);
    };
    const urlBtn = document.getElementById("copy-url");
    if (urlBtn) urlBtn.addEventListener("click", () => {
      navigator.clipboard.writeText(window.location.href);
      flash(urlBtn, "footer.copy_url");
    });
    const bibBtn = document.getElementById("copy-bib");
    if (bibBtn) bibBtn.addEventListener("click", () => {
      const bib = `@unpublished{araujoDeOliveira2026branches,
  author = {Araujo, Douglas K.G. and de Oliveira, Jean G.},
  title  = {Branches and Roots: Banking Presence and Deforestation in Amazonian Indigenous Lands},
  year   = {2026},
  note   = {Working paper. Online appendix entry for {${attrs.name_pt}} (terrai\\_cod ${attrs.terrai_cod}): \\url{${window.location.href}}},
}`;
      navigator.clipboard.writeText(bib);
      flash(bibBtn, "footer.copy_bib");
    });
  }

  async function loadIL(code) {
    if (!code) return;
    // Tear down any previous Leaflet instance + animation timer
    if (playInterval) { clearInterval(playInterval); playInterval = null; }
    if (map) { try { map.remove(); } catch (e) {} map = null; }
    layers = {};
    deforLayer = null;

    await loadData(code);

    // Reset slider DOM state (initSlider re-binds listeners)
    const slider = document.getElementById("year-slider");
    const display = document.getElementById("year-display");
    const playBtn = document.getElementById("play-btn");
    if (playBtn) {
      playBtn.classList.remove("playing");
      playBtn.textContent = I18N.t("map.play");
    }

    initMap();
    initSlider();
    I18N.apply();
    renderInset();
    renderInfo();
    renderPlot();

    // Keep URL hash in sync (so browser back/forward works + sharing is stable)
    const slug = codToSlug(code);
    if (slug) {
      const want = `#il=${slug}`;
      if (window.location.hash !== want) {
        history.replaceState(null, "", want);
      }
    }
  }

  // No IL selected → empty card-grid + a pulsing highlight on the selector
  // input to make it obvious that's the entry point.
  function showEmpty() {
    const card = document.querySelector(".card-grid");
    if (card) {
      card.classList.add("empty");
      const firstPane = card.querySelector(".pane");
      if (firstPane) firstPane.dataset.emptyMsg = I18N.t("empty.message");
    }
    const input = document.getElementById("il-picker-input");
    if (input) input.classList.add("attention");
    if (playInterval) { clearInterval(playInterval); playInterval = null; }
    if (map) { try { map.remove(); } catch (e) {} map = null; }
    layers = {};
    attrs = null;
  }
  function showCard() {
    const card = document.querySelector(".card-grid");
    if (card) card.classList.remove("empty");
    const input = document.getElementById("il-picker-input");
    if (input) input.classList.remove("attention");
  }

  async function init(initialCode) {
    await I18N.load();
    I18N.bind();
    I18N.apply();

    try {
      ilIndex = await fetch(`${dataPath}/il_attrs.json`).then(r => r.json());
    } catch (e) {
      console.warn("Card: failed to load il_attrs.json", e);
      ilIndex = [];
    }

    initToggle();
    initMapModeToggle();
    initPlotModeToggle();
    initMuniHover();
    initFooter();

    // Random-IL button: jump to a uniformly-random IL.
    // The click handler is lazy: if il_attrs.json hasn't finished loading yet
    // when the user clicks, the handler fetches it on demand.
    const randomBtn = document.getElementById("random-il-btn");
    if (randomBtn) {
      randomBtn.addEventListener("click", async () => {
        if (!ilIndex || ilIndex.length === 0) {
          try {
            ilIndex = await fetch(`${dataPath}/il_attrs.json`).then(r => r.json());
          } catch (e) { console.warn("random: failed to load il_attrs", e); return; }
        }
        const pool = (ilIndex || []).filter(r => r && (r.slug || r.terrai_cod));
        if (pool.length === 0) return;
        let pick;
        // Avoid landing on the same IL the user is already viewing
        const cur = codFromHash();
        for (let i = 0; i < 5; i++) {
          pick = pool[Math.floor(Math.random() * pool.length)];
          const codNum = Array.isArray(pick.terrai_cod) ? pick.terrai_cod[0] : pick.terrai_cod;
          if (codNum !== cur) break;
        }
        const slug = Array.isArray(pick.slug) ? pick.slug[0] : (pick.slug || String(pick.terrai_cod));
        window.location.hash = `#il=${slug}`;
      });
    }

    // "Home" click: title in the banner clears the hash and resets to empty.
    document.querySelectorAll(".home-link").forEach(a => {
      a.addEventListener("click", (e) => {
        e.preventDefault();
        history.pushState(null, "", window.location.pathname + window.location.search);
        showEmpty();
      });
    });

    // Initial state: URL hash wins; otherwise default to Andirá-Marau as the
    // example IL so first-time visitors land on a complete card.
    let code = initialCode || codFromHash();
    if (!code && ilIndex && ilIndex.length > 0) {
      const def = ilIndex.find(r => {
        const s = Array.isArray(r.slug) ? r.slug[0] : r.slug;
        return s === "andira-marau";
      });
      if (def) {
        code = Array.isArray(def.terrai_cod) ? def.terrai_cod[0] : def.terrai_cod;
      }
    }
    if (code) {
      showCard();
      await loadIL(code);
    } else {
      showEmpty();
    }

    window.addEventListener("hashchange", () => {
      const c = codFromHash();
      if (c) {
        showCard();
        loadIL(c);
      } else {
        showEmpty();
      }
    });

    window.addEventListener("oa:langchange", () => {
      I18N.apply();
      // Only re-render the card pieces if an IL is actually loaded
      if (attrs) {
        renderInfo();
        renderPlot();
      }
      const playBtn = document.getElementById("play-btn");
      if (playBtn && !playInterval) playBtn.textContent = I18N.t("map.play");
    });
  }

  return { init, loadIL };
})();
