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
    var choices = document.querySelectorAll("[data-theme-choice]");
    var mark = function () {
      var now = html.getAttribute("data-theme") || "system";
      for (var c = 0; c < choices.length; c++) choices[c].setAttribute("aria-checked", choices[c].getAttribute("data-theme-choice") === now ? "true" : "false");
    };
    mark();
    for (var i = 0; i < choices.length; i++) {
      choices[i].addEventListener("click", function (event) {
        var pick = event.currentTarget.getAttribute("data-theme-choice");
        if (pick === "system") html.removeAttribute("data-theme");
        else html.setAttribute("data-theme", pick);
        store("yokoten.theme", pick);
        mark();
      });
    }
    var menus = document.querySelectorAll("[data-menu]");
    var closeAll = function (except) {
      for (var m = 0; m < menus.length; m++) if (menus[m] !== except) setOpen(menus[m], false, false);
    };
    var itemsOf = function (menu) {
      return menu.querySelectorAll('[role="menuitemradio"], [role="menuitem"]');
    };
    var setOpen = function (menu, open, focus) {
      var button = menu.querySelector("button[aria-haspopup]");
      var list = menu.querySelector('[role="menu"]');
      button.setAttribute("aria-expanded", open ? "true" : "false");
      list.hidden = !open;
      if (open) {
        var items = itemsOf(menu);
        var at = 0;
        for (var n = 0; n < items.length; n++) if (items[n].getAttribute("aria-checked") === "true") at = n;
        if (items[at]) items[at].focus();
      } else if (focus) button.focus();
    };
    for (var mi = 0; mi < menus.length; mi++) {
      (function (menu) {
        var button = menu.querySelector("button[aria-haspopup]");
        button.addEventListener("click", function () {
          var open = button.getAttribute("aria-expanded") !== "true";
          closeAll(menu);
          setOpen(menu, open, false);
        });
        button.addEventListener("keydown", function (event) {
          if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault();
            closeAll(menu);
            setOpen(menu, true, false);
          }
        });
        menu.querySelector('[role="menu"]').addEventListener("keydown", function (event) {
          var items = itemsOf(menu);
          var now = Array.prototype.indexOf.call(items, document.activeElement);
          var to = { ArrowDown: (now + 1) % items.length, ArrowUp: (now - 1 + items.length) % items.length, Home: 0, End: items.length - 1 }[event.key];
          if (to !== undefined) {
            event.preventDefault();
            items[to].focus();
          } else if (event.key === "Escape") {
            event.preventDefault();
            setOpen(menu, false, true);
          } else if (event.key === "Tab") setOpen(menu, false, false);
        });
        var items = itemsOf(menu);
        for (var it = 0; it < items.length; it++) items[it].addEventListener("click", function () {
          setOpen(menu, false, true);
        });
      })(menus[mi]);
    }
    document.addEventListener("pointerdown", function (event) {
      for (var m = 0; m < menus.length; m++) if (!menus[m].contains(event.target)) setOpen(menus[m], false, false);
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
