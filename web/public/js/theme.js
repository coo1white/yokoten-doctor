(function () {
  var html = document.documentElement;
  var theme = null;
  try {
    theme = localStorage.getItem("yokoten.theme");
  } catch (e) {}
  if (theme === "light" || theme === "dark") html.setAttribute("data-theme", theme);
  var store = function (key, value) {
    try {
      localStorage.setItem(key, value);
    } catch (e) {}
  };
  document.addEventListener("DOMContentLoaded", function () {
    var order = ["system", "light", "dark"];
    var labels = { system: "system", light: "light", dark: "dark" };
    var current = html.getAttribute("data-theme") || "system";
    var buttons = document.querySelectorAll("[data-theme-next]");
    var apply = function (next) {
      if (next === "system") html.removeAttribute("data-theme");
      else html.setAttribute("data-theme", next);
      store("yokoten.theme", next);
      current = next;
      sync();
    };
    var sync = function () {
      for (var i = 0; i < buttons.length; i++) {
        buttons[i].setAttribute("aria-label", "Theme: " + labels[current] + ". Change it");
        buttons[i].setAttribute("title", "Theme: " + labels[current]);
      }
    };
    sync();
    for (var i = 0; i < buttons.length; i++) {
      buttons[i].addEventListener("click", function () {
        var idx = order.indexOf(current);
        var next = order[(idx + 1) % order.length];
        apply(next);
      });
    }
    document.addEventListener("click", function (event) {
      var button = event.target.closest("[data-copy], [data-copy-url]");
      if (!button) return;
      var text = button.hasAttribute("data-copy-url") ? location.href : button.getAttribute("data-copy");
      if (!text) return;
      var done = function (ok) {
        if (!button.dataset.label) button.dataset.label = button.textContent;
        button.textContent = ok ? "Copied" : "Press Ctrl+C";
        setTimeout(function () {
          button.textContent = button.dataset.label;
        }, 1600);
      };
      var selectFallback = function () {
        var code = null;
        var wrap = button.closest(".cmd, .hash");
        if (wrap) code = wrap.querySelector("code");
        if (code) {
          var details = code.closest("details");
          if (details && !details.open) details.open = true;
          var range = document.createRange();
          range.selectNodeContents(code);
          var sel = window.getSelection();
          if (sel) {
            sel.removeAllRanges();
            sel.addRange(range);
          }
        }
      };
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(function () {
          done(true);
        }, function () {
          selectFallback();
          done(false);
        });
      } else {
        selectFallback();
        done(false);
      }
    });
  });
})();

// Touch browsers don't all show :active, so a touch marks the control itself.
(() => {
  const SHORTEST_PRESS_MS = 120;
  const LONGEST_PRESS_MS = 3000;
  document.addEventListener("pointerdown", (event) => {
    if (event.pointerType === "mouse") return;
    const control = event.target.closest?.("a, button, summary, .ctl");
    if (!control) return;
    const pressedAt = Date.now();
    control.classList.add("is-pressed");
    const finishPress = () => {
      clearTimeout(stuckTimer);
      window.removeEventListener("pointerup", release);
      window.removeEventListener("pointercancel", release);
      const left = SHORTEST_PRESS_MS - (Date.now() - pressedAt);
      setTimeout(() => control.classList.remove("is-pressed"), Math.max(0, left));
    };
    const release = (releaseEvent) => {
      if (releaseEvent.pointerId === event.pointerId) finishPress();
    };
    // The browser can lose the release, so a press never outlasts this.
    const stuckTimer = setTimeout(finishPress, LONGEST_PRESS_MS);
    window.addEventListener("pointerup", release);
    window.addEventListener("pointercancel", release);
  }, { passive: true });
})();
