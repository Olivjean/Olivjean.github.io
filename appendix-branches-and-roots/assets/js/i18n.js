const I18N = (() => {
  const dicts = {};
  const locales = { en: "en-US", pt: "pt-BR" };
  let current = "en";
  let loading = null;

  function stored() {
    try { return localStorage.getItem("oa.lang"); } catch (e) { return null; }
  }

  function load() {
    if (loading) return loading;
    const base = window.OA_BASE_PATH || "assets/lang";
    const v = window.OA_VERSION ? `?v=${window.OA_VERSION}` : "";
    loading = Promise.all([
      fetch(`${base}/en.json${v}`).then(r => r.json()),
      fetch(`${base}/pt.json${v}`).then(r => r.json()),
    ]).then(([en, pt]) => {
      dicts.en = en;
      dicts.pt = pt;
      const saved = stored();
      if (saved && dicts[saved]) current = saved;
    });
    return loading;
  }

  function t(key) {
    return (dicts[current] && dicts[current][key]) || (dicts.en && dicts.en[key]) || key;
  }

  function num(value, digits) {
    if (typeof value !== "number" || !isFinite(value)) return "–";
    return value.toLocaleString(locales[current], {
      minimumFractionDigits: digits,
      maximumFractionDigits: digits,
    });
  }

  function apply(root = document) {
    root.querySelectorAll("[data-i18n]").forEach(el => { el.textContent = t(el.dataset.i18n); });
    root.querySelectorAll("[data-i18n-title]").forEach(el => { el.title = t(el.dataset.i18nTitle); });
    root.querySelectorAll("[data-i18n-placeholder]").forEach(el => { el.placeholder = t(el.dataset.i18nPlaceholder); });
    root.querySelectorAll("[data-i18n-aria]").forEach(el => { el.setAttribute("aria-label", t(el.dataset.i18nAria)); });
    root.querySelectorAll(".lang [data-lang]").forEach(b => {
      b.setAttribute("aria-pressed", b.dataset.lang === current ? "true" : "false");
    });
    document.documentElement.lang = current === "pt" ? "pt-BR" : "en";
  }

  function set(lang) {
    if (!dicts[lang] || lang === current) return;
    current = lang;
    try { localStorage.setItem("oa.lang", lang); } catch (e) { }
    apply();
    window.dispatchEvent(new CustomEvent("oa:langchange", { detail: { lang } }));
  }

  function bind() {
    document.querySelectorAll(".lang [data-lang]").forEach(btn => {
      btn.addEventListener("click", () => set(btn.dataset.lang));
    });
  }

  return {
    load, t, num, apply, set, bind,
    get current() { return current; },
    get locale() { return locales[current]; },
  };
})();
