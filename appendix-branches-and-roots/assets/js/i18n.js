// Minimal i18n module: loads en.json + pt.json, swaps all data-i18n texts.
const I18N = (() => {
  let current = "en";
  const dicts = {};

  async function load() {
    const base = window.OA_BASE_PATH || "../assets/lang";
    const [en, pt] = await Promise.all([
      fetch(`${base}/en.json`).then(r => r.json()),
      fetch(`${base}/pt.json`).then(r => r.json()),
    ]);
    dicts.en = en;
    dicts.pt = pt;
    current = localStorage.getItem("oa.lang") || "en";
  }

  function t(key) {
    return (dicts[current] && dicts[current][key]) || key;
  }

  function apply(root = document) {
    root.querySelectorAll("[data-i18n]").forEach(el => {
      const key = el.dataset.i18n;
      el.textContent = t(key);
    });
    root.querySelectorAll("[data-i18n-title]").forEach(el => {
      el.title = t(el.dataset.i18nTitle);
    });
    root.querySelectorAll("[data-i18n-placeholder]").forEach(el => {
      el.placeholder = t(el.dataset.i18nPlaceholder);
    });
    // Update language toggle buttons
    root.querySelectorAll(".lang-switcher button").forEach(b => {
      b.classList.toggle("active", b.dataset.lang === current);
    });
    document.documentElement.lang = current === "pt" ? "pt-BR" : "en";
  }

  function set(lang) {
    if (!dicts[lang]) return;
    current = lang;
    localStorage.setItem("oa.lang", lang);
    apply();
    window.dispatchEvent(new CustomEvent("oa:langchange", { detail: { lang } }));
  }

  function bind() {
    document.querySelectorAll(".lang-switcher button").forEach(btn => {
      btn.addEventListener("click", () => set(btn.dataset.lang));
    });
  }

  return { load, t, apply, set, bind, get current() { return current; } };
})();
