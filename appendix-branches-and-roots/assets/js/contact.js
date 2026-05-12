// Tiny controller for the banner contact popover.
// The popover content is rendered by i18n.apply() based on data-i18n attributes.
// This script only wires up open/close behaviour.
(() => {
  function init() {
    const btn = document.getElementById("contact-btn");
    const pop = document.getElementById("contact-popover");
    if (!btn || !pop) return;
    function open()  { pop.classList.add("open");  btn.setAttribute("aria-expanded", "true");  }
    function close() { pop.classList.remove("open"); btn.setAttribute("aria-expanded", "false"); }
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      pop.classList.contains("open") ? close() : open();
    });
    document.addEventListener("click", (e) => {
      if (!pop.contains(e.target) && e.target !== btn) close();
    });
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape") close();
    });
  }
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else { init(); }
})();
