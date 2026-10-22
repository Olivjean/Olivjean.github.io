const Card = (() => {
  const dataPath = window.OA_DATA_PATH || "data";
  const DEFAULT_SLUG = "andira-marau";
  const DEFAULT_COD = 2001;
  const PHASE_KEYS = ["em_estudo", "delimitada", "declarada", "homologada",
                      "regularizada", "reserva", "restricao_de_uso",
                      "dominial_indigena", "sem_processo"];
  const C = {
    ink: "#1a1a1a",
    ink2: "#4d4d4d",
    grid: "#e6e6e6",
    base: "#a6a6a6",
    il: "#cfe8c8",
    iltf: "#e8e8e8",
    iltfLine: "#a3a3a3",
    iltfHot: "#c9c9c9",
    defor: "#b22222",
    deforLater: "#ebcaca",
    band: "#8b1a1a",
  };
  const FONT = '"Source Serif 4", "Source Serif Pro", Georgia, serif';

  let rows = [];
  let legalAmazon = null;
  let current = null;
  let map, tiles, iltfLayer, ilLayer, ilEdge;
  let deforLayers = [];
  let year = 2024;
  let view = "il";
  let mapMode = "focused";
  let userMoved = false;   // set once the reader drags or zooms the map
  let plotMode = "yearly";
  let timer = null;
  let token = 0;
  const pending = new Map();

  const t = k => I18N.t(k);
  const $ = id => document.getElementById(id);
  const cap = s => s ? s.charAt(0).toLocaleUpperCase(I18N.locale) + s.slice(1) : s;
  const json = url => fetch(url).then(r => { if (!r.ok) throw new Error(`${r.status} ${url}`); return r.json(); });

  function fetchLand(cod) {
    const key = String(cod);
    if (!pending.has(key)) {
      const p = Promise.all([
        json(`${dataPath}/attrs/${key}.json`),
        json(`${dataPath}/series/${key}.json`),
        json(`${dataPath}/geo/${key}.geojson`),
        json(`${dataPath}/defor/${key}.geojson`),
      ]);
      pending.set(key, p);
      p.catch(() => pending.delete(key));
      if (pending.size > 6) pending.delete(pending.keys().next().value);
    }
    return pending.get(key);
  }

  function landName(a) {
    return (I18N.current === "pt" ? a.name_pt : a.name_en) || a.name_pt || a.name_en || "";
  }

  function slugFromHash() {
    const m = (window.location.hash || "").match(/[#&?]il=([^&]+)/);
    return m ? decodeURIComponent(m[1]) : null;
  }

  function find(key) {
    if (key == null) return null;
    const k = String(key);
    return rows.find(r => r.slug === k || String(r.cod) === k) || null;
  }

  function initMap() {
    map = L.map("map", {
      preferCanvas: true,
      zoomSnap: 0.25,
      zoomDelta: 0.5,
      wheelPxPerZoomLevel: 120,
    });
    map.attributionControl.setPrefix('<a href="https://leafletjs.com">Leaflet</a>');
    [["iltf", 410], ["il", 420], ["defor", 430], ["edge", 440]].forEach(([name, z]) => {
      map.createPane(name).style.zIndex = z;
    });
    tiles = L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
      maxZoom: 18,
      className: "basemap",
    });
    map.setView([-4, -60], 4);
  }

  function iltfStyle(hot) {
    if (mapMode === "focused") {
      return hot
        ? { fillColor: C.iltfHot, fillOpacity: 1, color: C.ink, weight: 1.2, opacity: 1 }
        : { fillColor: C.iltf, fillOpacity: 1, color: C.iltfLine, weight: 0.7, opacity: 1 };
    }
    return hot
      ? { fillColor: "#5c5c5c", fillOpacity: 0.28, color: C.ink, weight: 1.4, opacity: 1 }
      : { fillColor: "#7a7a7a", fillOpacity: 0.1, color: "#6b6b6b", weight: 0.8, opacity: 0.9 };
  }

  function ilStyle() {
    return mapMode === "focused"
      ? { stroke: false, fillColor: C.il, fillOpacity: 1 }
      : { stroke: false, fillColor: "#7fc070", fillOpacity: 0.32 };
  }

  const edgeStyle = { color: C.ink, weight: 1.3, opacity: 1, fill: false };
  const deforStyle = { color: C.defor, weight: 0.8, opacity: 1, fillColor: C.defor, fillOpacity: 1 };

  function clearLand() {
    [iltfLayer, ilLayer, ilEdge].forEach(l => { if (l) map.removeLayer(l); });
    deforLayers.forEach(d => map.removeLayer(d.layer));
    deforLayers = [];
  }

  function drawLand(geo, defor) {
    clearLand();
    const feats = (geo && geo.features) || [];
    const pick = name => ({ type: "FeatureCollection", features: feats.filter(f => f.properties && f.properties.layer === name) });
    iltfLayer = L.geoJSON(pick("iltf"), { pane: "iltf", interactive: false, style: () => iltfStyle(false) }).addTo(map);
    ilLayer = L.geoJSON(pick("il"), { pane: "il", interactive: false, style: ilStyle }).addTo(map);
    ilEdge = L.geoJSON(pick("il"), { pane: "edge", interactive: false, style: edgeStyle }).addTo(map);

    const byYear = new Map();
    for (const f of (defor && defor.features) || []) {
      const y = (f.properties && f.properties.year) || 0;
      if (!byYear.has(y)) byYear.set(y, []);
      byYear.get(y).push(f);
    }
    deforLayers = Array.from(byYear.keys()).sort((a, b) => a - b).map(y => ({
      year: y,
      layer: L.geoJSON({ type: "FeatureCollection", features: byYear.get(y) },
                       { pane: "defor", interactive: false, style: deforStyle }),
    }));
    showYear(year);
  }

  function showYear(y) {
    for (const d of deforLayers) {
      const on = d.year <= y;
      if (on && !map.hasLayer(d.layer)) d.layer.addTo(map);
      if (!on && map.hasLayer(d.layer)) map.removeLayer(d.layer);
    }
  }

  function bounds(layer) {
    return layer && layer.getLayers().length ? layer.getBounds() : null;
  }

  function frame() {
    const ilB = bounds(ilLayer) || bounds(iltfLayer);
    if (!ilB) return;
    userMoved = false;
    const outer = (bounds(iltfLayer) || ilB).extend(ilB);
    map.setMaxBounds(null);
    map.setMinZoom(0);
    iltfLayer.setStyle(() => iltfStyle(false));
    ilLayer.setStyle(ilStyle);
    if (mapMode === "focused") {
      if (map.hasLayer(tiles)) map.removeLayer(tiles);
      map.options.zoomSnap = 0.25;
      map.fitBounds(ilB, { padding: [22, 22], animate: false });
      const minZ = Math.min(map.getZoom(), map.getBoundsZoom(outer.pad(0.05), false) - 0.25);
      map.setMinZoom(Math.max(0, minZ));
      map.setMaxBounds(outer.pad(0.25));
    } else {
      if (!map.hasLayer(tiles)) tiles.addTo(map);
      map.options.zoomSnap = 0.5;
      map.fitBounds(outer, { padding: [28, 28], animate: false });
      map.setMinZoom(Math.min(3, map.getZoom()));
    }
    document.querySelectorAll("#map-mode button").forEach(b =>
      b.setAttribute("aria-pressed", b.dataset.mode === mapMode ? "true" : "false"));
  }

  function highlightMuni(name, hot) {
    if (!iltfLayer) return;
    iltfLayer.eachLayer(l => {
      if (l.feature && l.feature.properties && l.feature.properties.name === name) {
        l.setStyle(iltfStyle(hot));
        if (hot && l.bringToFront) l.bringToFront();
      }
    });
  }

  function renderInset() {
    const host = $("inset-map");
    if (!host || !legalAmazon || !current || !current.attrs.centroid) return;
    BrazilMap.renderInset(host, legalAmazon, current.attrs.centroid, { W: 112, H: 92 });
  }

  function names(items) {
    const lang = I18N.current;
    const out = [];
    const seen = new Set();
    const isolated = [];
    for (const x of items || []) {
      const raw = typeof x === "string" ? x : (x[lang] || x.en || x.name || x.pt || "");
      for (const part of String(raw).split(/\s*,\s*/)) {
        const n = part.trim();
        if (!n) continue;
        const key = n.toLocaleLowerCase("pt-BR");
        if (/^isolados?\b/i.test(n)) {
          if (!isolated.some(v => v.toLocaleLowerCase("pt-BR") === key)) isolated.push(n);
          continue;
        }
        if (seen.has(key)) continue;
        seen.add(key);
        out.push(n);
      }
    }
    if (isolated.length > 3) {
      const label = t("info.isolados");
      out.push(out.length ? label.charAt(0).toLocaleLowerCase(I18N.locale) + label.slice(1) : label);
    } else {
      out.push(...isolated);
    }
    return out;
  }

  function row(label, value) {
    const tr = document.createElement("tr");
    const th = document.createElement("th");
    th.scope = "row";
    th.textContent = label;
    const td = document.createElement("td");
    if (value instanceof Node) td.appendChild(value);
    else td.textContent = value;
    tr.append(th, td);
    return tr;
  }

  function listOrDash(list) {
    return list.length ? list.join(", ") : "–";
  }

  function renderInfo() {
    const body = $("info-block");
    const note = $("info-note");
    const a = current.attrs;
    body.textContent = "";
    if (view === "il") {
      note.hidden = true;
      note.textContent = "";
      const area = typeof a.area_km2 === "number" ? `${I18N.num(a.area_km2, 1)} ${t("info.area_unit")}` : "–";
      let status = document.createTextNode("–");
      if (PHASE_KEYS.includes(a.current_phase)) {
        status = document.createElement("a");
        status.href = `${t("phases.info_url")}#${a.current_phase === "sem_processo" ? "classification" : a.current_phase}`;
        status.title = t("phases.info_tooltip");
        status.textContent = t(`phases.${a.current_phase}`);
      }
      body.append(
        row(t("info.ethnicities"), listOrDash(names(a.ethnicities))),
        row(t("info.languages"), listOrDash(names(a.languages))),
        row(t("info.ufs"), listOrDash(a.ufs || [])),
        row(t("info.area_km2"), area),
        row(t("info.phase"), status),
      );
    } else {
      const munis = a.iltf_munis || [];
      const list = document.createElement("span");
      list.className = "munis";
      munis.forEach((m, i) => {
        const label = m.name || String(m.id_municipio);
        const s = document.createElement("span");
        s.className = "muni";
        s.tabIndex = 0;
        s.dataset.name = label;
        s.textContent = label;
        if (i) list.append(", ");
        list.appendChild(s);
      });
      body.append(
        row(cap(t("info.n_munis")), I18N.num(munis.length, 0)),
        row(t("info.iltf_munis_label"), munis.length ? list : "–"),
      );
      note.textContent = t("info.iltf_intro");
      note.hidden = false;
    }
    document.querySelectorAll("#view-tabs [role=tab]").forEach(b => {
      const on = b.dataset.view === view;
      b.setAttribute("aria-selected", on ? "true" : "false");
      b.tabIndex = on ? 0 : -1;
    });
  }

  function plotSpec() {
    const s = current.series;
    if (view === "il") {
      const cum = plotMode === "cumulative";
      return {
        y: (cum ? s.defor_cumulative_km2 : s.defor_km2) || [],
        kind: cum ? "line" : "bar",
        color: C.defor,
        unit: t(cum ? "plot.defor_cum.y" : "plot.defor.y"),
        title: t(cum ? "plot.defor_cum.title" : "plot.defor.title"),
        caption: t(cum ? "plot.defor_cum.caption" : "plot.defor.caption"),
        suffix: ` ${t("info.area_unit")}`,
      };
    }
    return {
      y: s.branches_iltf || [],
      kind: "line",
      color: C.ink,
      unit: t("plot.branches.y"),
      title: t("plot.branches.title"),
      caption: t("plot.branches.caption"),
      suffix: "",
    };
  }

  function emphasis(spec, x) {
    if (spec.kind === "bar") return { "marker.color": [x.map(v => v <= year ? spec.color : C.deforLater)] };
    return { "marker.size": [x.map(v => v === year ? 7 : 0)] };
  }

  function yearBand(x) {
    if (!x.length || year >= x[x.length - 1]) return [];
    return [{
      type: "line", xref: "x", yref: "paper", layer: "below",
      x0: year, x1: year, y0: 0, y1: 1,
      line: { color: C.band, width: 1.25, dash: "dot" },
    }];
  }

  function renderPlot() {
    const host = $("plot");
    const spec = plotSpec();
    // The description keeps the caption style. The source sits flush right, smaller.
    const cap = $("plot-caption");
    const parts = spec.caption.match(/^(.*?)\s*((?:Source|Fonte):.*)$/);
    cap.textContent = "";
    const desc = document.createElement("span");
    desc.className = "cap-desc";
    desc.textContent = parts ? parts[1] : spec.caption;
    cap.append(desc);
    if (parts) {
      const src = document.createElement("span");
      src.className = "cap-source";
      src.textContent = parts[2];
      cap.append(src);
    }
    const modes = $("plot-mode");
    modes.hidden = view !== "il";
    modes.querySelectorAll("button").forEach(b =>
      b.setAttribute("aria-pressed", b.dataset.mode === plotMode ? "true" : "false"));
    if (typeof Plotly === "undefined") return;
    const x = current.series.years;
    const ys = spec.y.map(v => Number(v) || 0);
    const top = Math.max(0, ...ys);
    const yMax = top > 0 ? top * 1.12 : 1;
    const trace = spec.kind === "bar"
      ? { x, y: ys, type: "bar", marker: { color: x.map(v => v <= year ? spec.color : C.deforLater) } }
      : { x, y: ys, type: "scatter", mode: "lines+markers",
          line: { color: spec.color, width: 2 },
          marker: { color: spec.color, size: x.map(v => v === year ? 7 : 0) } };
    trace.hovertemplate = `%{x}: %{y:,.2f}${spec.suffix}<extra></extra>`;
    const fine = window.matchMedia && window.matchMedia("(pointer: fine)").matches;
    const layout = {
      height: host.clientHeight || 250,
      margin: { l: 42, r: 6, t: 26, b: 28 },
      paper_bgcolor: "#ffffff",
      plot_bgcolor: "#ffffff",
      font: { family: FONT, size: 13, color: C.ink2 },
      separators: I18N.current === "pt" ? ",." : ".,",
      showlegend: false,
      bargap: 0.3,
      dragmode: fine ? "zoom" : false,
      hovermode: "x",
      xaxis: {
        type: "linear",
        range: [x[0] - 0.6, x[x.length - 1] + 0.6],
        tickmode: "array",
        tickvals: x.filter(v => (v - x[0]) % 4 === 0),
        tickformat: "d",
        hoverformat: "d",
        showgrid: false,
        zeroline: false,
        showline: false,
        ticks: "",
        fixedrange: !fine,
      },
      yaxis: {
        range: [0, yMax],
        nticks: 5,
        tickformat: ",.2~f",
        showgrid: true,
        gridcolor: C.grid,
        gridwidth: 1,
        zeroline: true,
        zerolinecolor: C.base,
        zerolinewidth: 1,
        showline: false,
        ticks: "",
        fixedrange: true,
      },
      shapes: yearBand(x),
      annotations: [{
        text: spec.unit, xref: "paper", yref: "paper", x: 0, y: 1,
        xanchor: "left", yanchor: "bottom", xshift: -42, yshift: 6,
        showarrow: false, font: { family: FONT, size: 13, color: C.ink2 },
      }],
      hoverlabel: {
        bgcolor: "#ffffff", bordercolor: "#bdbdbd",
        font: { family: FONT, size: 13, color: C.ink },
      },
    };
    Plotly.newPlot(host, [trace], layout, { displayModeBar: false, responsive: true, doubleClick: "reset" });
    host.setAttribute("aria-label", spec.title);
    host.on("plotly_click", ev => {
      const pt = ev && ev.points && ev.points[0];
      if (!pt || !current) return;
      const y = Math.round(Number(pt.x));
      if (!isFinite(y)) return;
      if (timer) stop();
      if (y !== year) setYear(y);
    });
  }

  function updatePlotYear() {
    const host = $("plot");
    if (!current || !host.data || typeof Plotly === "undefined") return;
    const spec = plotSpec();
    const x = current.series.years;
    Plotly.update(host, emphasis(spec, x), { shapes: yearBand(x) }, [0]);
  }

  function setYear(y) {
    year = y;
    const slider = $("year-slider");
    slider.value = String(y);
    const lo = Number(slider.min), hi = Number(slider.max);
    const frac = hi > lo ? (y - lo) / (hi - lo) : 1;
    $("scrub").style.setProperty("--frac", String(frac));
    $("year-display").textContent = String(y);
    $("year-ticks").querySelectorAll("[data-year]").forEach(el => {
      const v = Number(el.dataset.year);
      el.classList.toggle("is-later", v > y);
      el.classList.toggle("is-current", v === y);
    });
    showYear(y);
    updatePlotYear();
  }

  function buildTicks(lo, hi) {
    const host = $("year-ticks");
    if (host.dataset.range === `${lo}-${hi}`) return;
    host.dataset.range = `${lo}-${hi}`;
    host.textContent = "";
    const span = hi - lo || 1;
    for (let y = lo; y <= hi; y++) {
      const major = (y - lo) % 4 === 0 || y === hi;
      const left = `${((y - lo) / span) * 100}%`;
      const tick = document.createElement("span");
      tick.className = major ? "tick major" : "tick";
      tick.dataset.year = String(y);
      tick.style.left = left;
      host.appendChild(tick);
      if (major) {
        const label = document.createElement("span");
        label.className = "tick-label";
        label.dataset.year = String(y);
        label.style.left = left;
        label.textContent = String(y);
        host.appendChild(label);
      }
    }
  }

  function syncSlider() {
    const years = current.series.years;
    const slider = $("year-slider");
    slider.min = String(years[0]);
    slider.max = String(years[years.length - 1]);
    buildTicks(years[0], years[years.length - 1]);
    setYear(year);
  }

  function playLabel() {
    $("play-btn").setAttribute("aria-pressed", timer ? "true" : "false");
  }

  function stop() {
    if (timer) { clearInterval(timer); timer = null; }
    playLabel();
  }

  function play() {
    if (timer) { stop(); return; }
    const years = current.series.years;
    const last = years[years.length - 1];
    if (year >= last) setYear(years[0]);
    timer = setInterval(() => {
      if (year >= last) { stop(); return; }
      setYear(year + 1);
      if (year >= last) stop();
    }, 750);
    playLabel();
  }

  async function show(rowInfo) {
    const my = ++token;
    stop();
    $("land-name").textContent = rowInfo.name || " ";
    document.querySelector(".card").classList.add("is-loading");
    let a, s, g, d;
    try {
      [a, s, g, d] = await fetchLand(rowInfo.cod);
    } catch (e) {
      console.warn("card: failed to load", rowInfo.slug, e);
      if (my === token) document.querySelector(".card").classList.remove("is-loading");
      return;
    }
    if (my !== token) return;
    current = { slug: rowInfo.slug, attrs: a, series: s };
    year = s.years[s.years.length - 1];
    $("land-name").textContent = landName(a);
    drawLand(g, d);
    frame();
    syncSlider();
    renderInset();
    renderInfo();
    renderPlot();
    IlPicker.setCurrent(rowInfo.slug);
    document.querySelector(".card").classList.remove("is-loading");
  }

  async function route() {
    const wanted = slugFromHash();
    const target = find(wanted) || find(DEFAULT_SLUG) || rows[0];
    if (!target) return;
    if (window.location.hash !== `#il=${target.slug}`) {
      history.replaceState(null, "", `${window.location.pathname}${window.location.search}#il=${target.slug}`);
    }
    if (current && current.slug === target.slug) return;
    await show(target);
  }

  async function copyText(text) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch (e) {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.setAttribute("readonly", "");
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      let ok = false;
      try { ok = document.execCommand("copy"); } catch (err) { ok = false; }
      ta.remove();
      return ok;
    }
  }

  function flash(btn) {
    btn.classList.add("done");
    clearTimeout(btn._flash);
    btn._flash = setTimeout(() => btn.classList.remove("done"), 1600);
  }

  function bibtex() {
    const a = current && current.attrs;
    const entry = a
      ? `Online appendix entry for {${a.name_pt}} (terrai\\_cod ${a.terrai_cod})`
      : "Online appendix";
    return `@unpublished{araujoDeOliveira2026branches,
  author = {Araujo, Douglas K.G. and de Oliveira, Jean G.},
  title  = {Branches and roots: bank presence and forest preservation in {Amazonian} {Indigenous} lands},
  year   = {2026},
  note   = {Working paper. ${entry}: \\url{${window.location.href}}},
}`;
  }

  function bind() {
    $("copy-url").addEventListener("click", async () => {
      if (await copyText(window.location.href)) flash($("copy-url"));
    });
    $("copy-bib").addEventListener("click", async () => {
      if (await copyText(bibtex())) flash($("copy-bib"));
    });

    $("random-il-btn").addEventListener("click", () => {
      const pool = rows.filter(r => !current || r.slug !== current.slug);
      if (!pool.length) return;
      const pickRow = pool[Math.floor(Math.random() * pool.length)];
      window.location.hash = `#il=${pickRow.slug}`;
    });

    document.querySelectorAll("#map-mode button").forEach(b => b.addEventListener("click", () => {
      if (mapMode === b.dataset.mode) return;
      mapMode = b.dataset.mode;
      if (current) frame();
    }));

    const tabs = Array.from(document.querySelectorAll("#view-tabs [role=tab]"));
    tabs.forEach((b, i) => {
      b.addEventListener("click", () => {
        if (view === b.dataset.view) return;
        view = b.dataset.view;
        if (current) { renderInfo(); renderPlot(); }
      });
      b.addEventListener("keydown", e => {
        if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
        const next = tabs[(i + (e.key === "ArrowRight" ? 1 : tabs.length - 1)) % tabs.length];
        next.focus();
        next.click();
      });
    });

    document.querySelectorAll("#plot-mode button").forEach(b => b.addEventListener("click", () => {
      if (plotMode === b.dataset.mode) return;
      plotMode = b.dataset.mode;
      if (current) renderPlot();
    }));

    $("year-slider").addEventListener("input", e => {
      if (timer) stop();
      setYear(parseInt(e.target.value, 10));
    });
    $("play-btn").addEventListener("click", () => { if (current) play(); });

    $("year-ticks").addEventListener("pointerdown", e => {
      if (!current) return;
      const slider = $("year-slider");
      const box = e.currentTarget.getBoundingClientRect();
      const lo = Number(slider.min), hi = Number(slider.max);
      const f = Math.min(1, Math.max(0, (e.clientX - box.left) / (box.width || 1)));
      const y = Math.round(lo + f * (hi - lo));
      if (timer) stop();
      if (y !== year) setYear(y);
      slider.focus({ preventScroll: true });
      e.preventDefault();
    });

    const info = $("info-block");
    const hot = (e, on) => {
      const m = e.target.closest && e.target.closest(".muni");
      if (m) highlightMuni(m.dataset.name, on);
    };
    info.addEventListener("mouseover", e => hot(e, true));
    info.addEventListener("mouseout", e => hot(e, false));
    info.addEventListener("focusin", e => hot(e, true));
    info.addEventListener("focusout", e => hot(e, false));

    window.addEventListener("hashchange", route);
    window.addEventListener("oa:langchange", () => {
      playLabel();
      if (!current) return;
      $("land-name").textContent = landName(current.attrs);
      renderInfo();
      renderPlot();
    });
  }

  // Keep the map and the chart filling their boxes when the boxes change
  // height (the two columns are stretched to end on the same line).
  function watchSizes() {
    if (!window.ResizeObserver) return;
    const box = document.querySelector(".map-frame");
    if (box) {
      ["pointerdown", "wheel", "keydown"].forEach(ev =>
        map.getContainer().addEventListener(ev, () => { userMoved = true; }, { passive: true }));
      new ResizeObserver(() => {
        if (!map) return;
        map.invalidateSize({ pan: false });
        if (!userMoved && ilLayer) frame();
      }).observe(box);
    }
    const host = document.getElementById("plot");
    if (host) new ResizeObserver(() => {
      const h = host.clientHeight;
      if (h && host.layout && Math.abs((host.layout.height || 0) - h) > 1) Plotly.relayout(host, { height: h });
    }).observe(host);
  }

  async function init() {
    await I18N.load();
    I18N.bind();
    I18N.apply();
    playLabel();
    initMap();
    bind();
    watchSizes();
    const wanted = slugFromHash();
    if (!wanted || wanted === DEFAULT_SLUG) fetchLand(DEFAULT_COD).catch(() => null);
    const [list, la] = await Promise.all([
      IlPicker.index(),
      json(`${dataPath}/legal_amazon.geojson`).catch(() => null),
      document.fonts ? document.fonts.ready : Promise.resolve(),
    ]);
    rows = list;
    legalAmazon = la;
    await route();
  }

  return { init };
})();
