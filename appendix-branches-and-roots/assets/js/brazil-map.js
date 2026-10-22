const BrazilMap = (() => {
  function ringPath(ring, project) {
    return ring.map((pt, i) => {
      const [x, y] = project(pt[0], pt[1]);
      return (i === 0 ? "M" : "L") + x.toFixed(1) + " " + y.toFixed(1);
    }).join("") + "Z";
  }

  function geomPath(geom, project) {
    if (!geom) return "";
    if (geom.type === "Polygon") return geom.coordinates.map(r => ringPath(r, project)).join(" ");
    if (geom.type === "MultiPolygon") {
      return geom.coordinates.map(p => p.map(r => ringPath(r, project)).join(" ")).join(" ");
    }
    if (geom.type === "GeometryCollection") return geom.geometries.map(g => geomPath(g, project)).join(" ");
    return "";
  }

  function bbox(fc) {
    let xmin = Infinity, ymin = Infinity, xmax = -Infinity, ymax = -Infinity;
    function walk(node) {
      if (Array.isArray(node)) {
        if (typeof node[0] === "number" && typeof node[1] === "number") {
          if (node[0] < xmin) xmin = node[0];
          if (node[0] > xmax) xmax = node[0];
          if (node[1] < ymin) ymin = node[1];
          if (node[1] > ymax) ymax = node[1];
        } else node.forEach(walk);
      } else if (node && node.coordinates) walk(node.coordinates);
      else if (node && node.geometries) node.geometries.forEach(walk);
    }
    (fc.features || [fc]).forEach(f => walk(f.geometry || f));
    return [xmin, ymin, xmax, ymax];
  }

  function projection(b, W, H, margin) {
    const dx = b[2] - b[0], dy = b[3] - b[1];
    const s = Math.min((W - 2 * margin) / dx, (H - 2 * margin) / dy);
    const ox = margin + ((W - 2 * margin) - s * dx) / 2;
    const oy = margin + ((H - 2 * margin) - s * dy) / 2;
    return (lon, lat) => [ox + (lon - b[0]) * s, oy + (b[3] - lat) * s];
  }

  function renderInset(target, legalAmazon, centroid, opts = {}) {
    const W = opts.W || 112, H = opts.H || 92;
    const project = projection(bbox(legalAmazon), W, H, 6);
    const paths = (legalAmazon.features || []).map(f =>
      `<path d="${geomPath(f.geometry, project)}" fill="#ededed" stroke="#8c8c8c" stroke-width="0.6" stroke-linejoin="round"/>`
    ).join("");
    let dot = "";
    if (centroid && typeof centroid.lon === "number") {
      const [cx, cy] = project(centroid.lon, centroid.lat);
      dot = `<circle cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="3.2" fill="#1a1a1a" stroke="#ffffff" stroke-width="1"/>`;
    }
    target.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid meet">${paths}${dot}</svg>`;
  }

  return { renderInset };
})();
