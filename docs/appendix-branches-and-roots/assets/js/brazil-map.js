// Lightweight SVG renderer for the Legal Amazon outline + IL centroid dots.
// Used by:
//   - the index overview map (all 392 ILs as dots with filters)
//   - each card's "you-are-here" inset (one highlighted dot)
//
// Why SVG instead of Leaflet for this: the panel is small, static, and used
// many times. SVG is a few KB and zero JS overhead.

const BrazilMap = (() => {

  // Compute polygon path string from a Legal Amazon GeoJSON FeatureCollection.
  // bbox is precomputed (the same projection has to be used for dots).
  function ringPath(ring, project) {
    return ring.map((pt, i) => {
      const [x, y] = project(pt[0], pt[1]);
      return (i === 0 ? "M" : "L") + x.toFixed(1) + " " + y.toFixed(1);
    }).join("") + "Z";
  }
  function polyPath(coords, project) {
    // coords is an array of rings
    return coords.map(r => ringPath(r, project)).join(" ");
  }
  function geomPath(geom, project) {
    if (!geom) return "";
    if (geom.type === "Polygon") return polyPath(geom.coordinates, project);
    if (geom.type === "MultiPolygon") {
      return geom.coordinates.map(p => polyPath(p, project)).join(" ");
    }
    if (geom.type === "GeometryCollection") {
      return geom.geometries.map(g => geomPath(g, project)).join(" ");
    }
    return "";
  }

  function geomBBox(fc) {
    let xmin = Infinity, ymin = Infinity, xmax = -Infinity, ymax = -Infinity;
    function walk(node) {
      if (Array.isArray(node)) {
        if (typeof node[0] === "number" && typeof node[1] === "number") {
          if (node[0] < xmin) xmin = node[0];
          if (node[0] > xmax) xmax = node[0];
          if (node[1] < ymin) ymin = node[1];
          if (node[1] > ymax) ymax = node[1];
        } else for (const c of node) walk(c);
      } else if (node && node.coordinates) walk(node.coordinates);
      else if (node && node.geometries) for (const g of node.geometries) walk(g);
    }
    for (const f of (fc.features || [fc])) walk(f.geometry || f);
    return [xmin, ymin, xmax, ymax];
  }

  function makeProjection(bbox, W, H, margin = 6) {
    const dx = bbox[2] - bbox[0], dy = bbox[3] - bbox[1];
    // Equal-aspect scale so Brazil doesn't squish
    const sx = (W - 2 * margin) / dx;
    const sy = (H - 2 * margin) / dy;
    const s = Math.min(sx, sy);
    const ox = margin + ((W - 2 * margin) - s * dx) / 2;
    const oy = margin + ((H - 2 * margin) - s * dy) / 2;
    return (lon, lat) => [ox + (lon - bbox[0]) * s, oy + (bbox[3] - lat) * s];
  }

  /**
   * Render a small "you-are-here" inset SVG.
   *   target: HTMLElement to receive the SVG
   *   legalAmazon: parsed GeoJSON FeatureCollection
   *   centroid: { lon, lat } of the focal IL
   *   opts: { W, H }
   */
  function renderInset(target, legalAmazon, centroid, opts = {}) {
    const W = opts.W || 110, H = opts.H || 90;
    const bbox = geomBBox(legalAmazon);
    const project = makeProjection(bbox, W, H);
    const paths = (legalAmazon.features || []).map(f =>
      `<path d="${geomPath(f.geometry, project)}"
              fill="rgba(107,213,180,0.18)"
              stroke="#6bd5b4"
              stroke-width="0.7"/>`
    ).join("");
    let dot = "";
    if (centroid && typeof centroid.lon === "number") {
      const [cx, cy] = project(centroid.lon, centroid.lat);
      dot = `
        <circle cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="6"
                fill="rgba(255,77,77,0.25)"/>
        <circle cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="3"
                fill="#ff4d4d" stroke="#fff" stroke-width="0.8"/>`;
    }
    target.innerHTML = `
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}"
           preserveAspectRatio="xMidYMid meet" class="inset-svg">
        ${paths}${dot}
      </svg>`;
  }

  /**
   * Render the full overview map for the index page.
   *   target: HTMLElement to receive the SVG
   *   legalAmazon: parsed GeoJSON FeatureCollection
   *   ils: array of { terrai_cod, name_pt, centroid, ... } entries
   *   onClick: function(il) called when a dot is clicked
   */
  function renderOverview(target, legalAmazon, ils, onClick) {
    const W = 760, H = 520;
    const bbox = geomBBox(legalAmazon);
    const project = makeProjection(bbox, W, H, 12);
    const paths = (legalAmazon.features || []).map(f =>
      `<path d="${geomPath(f.geometry, project)}"
              fill="rgba(107,213,180,0.10)"
              stroke="#6bd5b4"
              stroke-width="0.8"/>`
    ).join("");
    target.innerHTML = `
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}"
           preserveAspectRatio="xMidYMid meet" class="overview-svg" role="img" aria-label="Legal Amazon map">
        <g class="la-outline">${paths}</g>
        <g class="overview-dots"></g>
      </svg>`;
    const dotsHost = target.querySelector(".overview-dots");
    redrawDots(dotsHost, ils, project, onClick);
    return { project, dotsHost };
  }

  function redrawDots(host, ils, project, onClick) {
    const scalar = v => Array.isArray(v) ? v[0] : v;
    host.innerHTML = ils.map(il => {
      const c = il.centroid;
      if (!c || typeof c.lon !== "number") return "";
      const [x, y] = project(c.lon, c.lat);
      const cod = scalar(il.terrai_cod);
      const slug = scalar(il.slug) || String(cod);
      const name = scalar(il.name_pt) || "";
      return `<circle class="overview-dot" data-cod="${cod}" data-slug="${slug}"
                      cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="3.5"
                      fill="#ff4d4d" fill-opacity="0.85" stroke="#fff"
                      stroke-width="0.6"><title>${name}</title></circle>`;
    }).join("");
    if (onClick) {
      host.querySelectorAll(".overview-dot").forEach(d => {
        d.addEventListener("click", () => onClick(d.dataset.slug || d.dataset.cod));
      });
    }
  }

  return { renderInset, renderOverview, redrawDots };
})();
