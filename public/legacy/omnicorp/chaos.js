/*
 * OmniCorp "weekend release" simulator. Seeded, so the same seed always
 * breaks the page the same way.
 *   URL:          ?chaos=<seed>&types=ids,labels,reorder,nesting,interstitial,latency,strip-labels
 *   postMessage:  { type: "omnicorp:chaos", seed, types }  (same origin only)
 *   Clear:        ?chaos=off  or  { type: "omnicorp:chaos", clear: true }
 * The config is kept in sessionStorage so it survives navigation between pages.
 */
(function () {
  "use strict";
  var KEY = "omnicorp.v42.chaos";
  var SHOWN_KEY = "omnicorp.v42.interstitial";
  var ALL = ["ids", "labels", "reorder", "nesting", "interstitial", "latency", "strip-labels"];
  var page = document.body.getAttribute("data-page") || "index";

  function readStored() {
    try {
      var raw = window.sessionStorage.getItem(KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (e) {
      return null;
    }
  }
  function store(cfg) {
    try {
      window.sessionStorage.setItem(KEY, JSON.stringify(cfg));
      window.sessionStorage.removeItem(SHOWN_KEY);
    } catch (e) {
      /* ignore */
    }
  }
  function clear() {
    try {
      window.sessionStorage.removeItem(KEY);
      window.sessionStorage.removeItem(SHOWN_KEY);
    } catch (e) {
      /* ignore */
    }
  }

  var qs = new URLSearchParams(window.location.search);
  if (qs.get("chaos") === "off") clear();
  else if (qs.get("chaos") !== null) {
    var types = (qs.get("types") || ALL.join(",")).split(",").filter(function (t) {
      return ALL.indexOf(t) >= 0;
    });
    store({ seed: Number(qs.get("chaos")) >>> 0, types: types });
  }

  window.addEventListener("message", function (e) {
    if (e.origin !== window.location.origin) return;
    var d = e.data;
    if (!d || d.type !== "omnicorp:chaos") return;
    if (d.clear) clear();
    else
      store({
        seed: Number(d.seed) >>> 0,
        types: (d.types || []).filter(function (t) {
          return ALL.indexOf(t) >= 0;
        }),
      });
    if (d.reload !== false) window.location.reload();
  });

  var cfg = readStored();
  var active = !!(cfg && cfg.types && cfg.types.length);
  var open = false;
  var api = {
    active: active,
    seed: cfg ? cfg.seed : null,
    types: active ? cfg.types.slice() : [],
    applied: {},
    latency: function () {
      return 0;
    },
    modalOpen: function () {
      return open;
    },
  };
  window.OmniChaos = api;
  if (!active) return;

  // mulberry32 seeded per page so each page breaks the same way every time.
  function fnv(s) {
    var h = 0x811c9dc5;
    for (var i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 0x01000193);
    }
    return h >>> 0;
  }
  var state = (cfg.seed ^ fnv(page)) >>> 0;
  function rnd() {
    state = (state + 0x6d2b79f5) >>> 0;
    var t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  function pick(list) {
    return list[Math.floor(rnd() * list.length)];
  }
  function has(t) {
    return api.types.indexOf(t) >= 0;
  }
  function rid(prefix) {
    return prefix + "_" + Math.floor(1000 + rnd() * 9000) + String.fromCharCode(97 + Math.floor(rnd() * 26));
  }
  var root = document.querySelector("[data-ui=content]") || document.body;

  // Ground truth for benchmarks: remember every element's original id (not visible to the distiller).
  Array.prototype.forEach.call(document.querySelectorAll("[id]"), function (el) {
    el.__omniTruth = el.id;
  });

  // strip-labels: remove <label for> links, leaving only the table-cell text.
  if (has("strip-labels")) {
    var stripped = 0;
    Array.prototype.forEach.call(root.querySelectorAll("label[for]"), function (label) {
      var txt = document.createTextNode(label.textContent);
      label.parentNode.replaceChild(txt, label);
      stripped++;
    });
    api.applied["strip-labels"] = stripped;
  }

  // labels: small rewordings a release might ship.
  if (has("labels")) {
    var MAP = {
      "Vendor ID": ["Vendor No.", "Supplier ID"],
      "PO Number": ["Purchase Order #", "PO No."],
      "Invoice Number": ["Inv. Reference", "Invoice No."],
      "Invoice Date": ["Date of Invoice", "Inv. Date"],
      "Cost Center / GL Account": ["GL Cost Centre", "Cost Ctr / GL Acct"],
      "Invoice Total (USD)": ["Total Amt (USD)", "Invoice Amount (USD)"],
      "Tax Rate (%)": ["VAT/Tax %", "Tax Pct"],
      "Line Items": ["Line Item Count", "No. of Lines"],
      "Payee IBAN": ["Beneficiary Account (IBAN)", "Remit-to IBAN"],
      "Override code": ["Supervisor override", "Override No."],
      "Post to General Ledger": ["Submit to GL", "Post Invoice"],
      "Search": ["Find", "Lookup"],
      "User name": ["Username", "User ID"],
      "Password": ["Logon password", "Password"],
      "Log On": ["Sign In", "Login"],
    };
    var changed = [];
    var nodes = root.querySelectorAll("label, button, td[data-ui=lbl]");
    Array.prototype.forEach.call(nodes, function (el) {
      if (el.getAttribute("role") === "tab") return;
      // Only rewrite elements whose own text is a known label.
      var txt = el.textContent.replace(/\s+/g, " ").trim();
      if (MAP[txt] && el.children.length === 0) {
        var next = pick(MAP[txt]);
        el.textContent = next;
        changed.push(txt + " -> " + next);
      }
    });
    api.applied.labels = changed;
  }

  // reorder: shuffle the field rows inside each form table.
  if (has("reorder")) {
    var shuffled = 0;
    Array.prototype.forEach.call(root.querySelectorAll("[role=tabpanel] table[data-ui=form] > tbody"), function (tbody) {
      var rows = Array.prototype.slice.call(tbody.children);
      for (var i = rows.length - 1; i > 0; i--) {
        var j = Math.floor(rnd() * (i + 1));
        var tmp = rows[i];
        rows[i] = rows[j];
        rows[j] = tmp;
      }
      rows.forEach(function (r) {
        tbody.appendChild(r);
      });
      shuffled++;
    });
    api.applied.reorder = shuffled;
  }

  // nesting: move action buttons into nested table cells.
  if (has("nesting")) {
    var moved = 0;
    Array.prototype.forEach.call(root.querySelectorAll("button[type=submit]"), function (btn) {
      var outer = document.createElement("table");
      var depth = 1 + Math.floor(rnd() * 2);
      var cell = null;
      var t = outer;
      for (var d = 0; d <= depth; d++) {
        var tb = document.createElement("tbody");
        var tr = document.createElement("tr");
        var spacer = document.createElement("td");
        spacer.textContent = " ";
        var td = document.createElement("td");
        tr.appendChild(spacer);
        tr.appendChild(td);
        tb.appendChild(tr);
        t.appendChild(tb);
        cell = td;
        if (d < depth) {
          t = document.createElement("table");
          td.appendChild(t);
        }
      }
      btn.parentNode.insertBefore(outer, btn);
      cell.appendChild(btn);
      moved++;
    });
    api.applied.nesting = moved;
  }

  // ids: randomize every id, name and class, keeping label/aria references consistent.
  if (has("ids")) {
    var map = {};
    Array.prototype.forEach.call(document.body.querySelectorAll("[id]"), function (el) {
      var next = rid("fld");
      map[el.id] = next;
      el.id = next;
    });
    Array.prototype.forEach.call(document.body.querySelectorAll("[name]"), function (el) {
      el.setAttribute("name", rid("f"));
    });
    Array.prototype.forEach.call(document.body.querySelectorAll("[class]"), function (el) {
      el.setAttribute("class", rid("c"));
    });
    ["for", "aria-controls", "aria-labelledby", "aria-describedby"].forEach(function (attr) {
      Array.prototype.forEach.call(document.body.querySelectorAll("[" + attr + "]"), function (el) {
        var v = el.getAttribute(attr)
          .split(/\s+/)
          .map(function (x) {
            return map[x] || x;
          })
          .join(" ");
        el.setAttribute(attr, v);
      });
    });
    api.applied.ids = Object.keys(map).length;
  }

  // latency: responses take 300 to 1500 ms.
  if (has("latency")) {
    // Benchmarks may compress time; the delays stay seeded either way.
    var scale = typeof window.__OMNICORP_LATENCY_SCALE__ === "number" ? window.__OMNICORP_LATENCY_SCALE__ : 1;
    api.latency = function () {
      return Math.round((300 + Math.floor(rnd() * 1200)) * scale);
    };
    api.applied.latency = true;
  }

  // interstitial: a session notice interrupts at a random step (once per session).
  if (has("interstitial") && (page === "invoice-entry" || page === "po-search")) {
    var trigger = 1 + Math.floor(rnd() * 4);
    var count = 0;
    var already = window.sessionStorage.getItem(SHOWN_KEY) === "1";
    api.applied.interstitial = already ? "already shown this session" : "after interaction " + trigger;
    if (!already) {
      var disabled = [];
      var showModal = function () {
        if (open) return;
        open = true;
        window.sessionStorage.setItem(SHOWN_KEY, "1");
        Array.prototype.forEach.call(root.querySelectorAll("input, select, textarea, button"), function (el) {
          if (!el.disabled) {
            el.disabled = true;
            disabled.push(el);
          }
        });
        var overlay = document.createElement("div");
        overlay.setAttribute("data-ui", "overlay");
        var dlg = document.createElement("div");
        dlg.setAttribute("role", "dialog");
        dlg.setAttribute("aria-modal", "true");
        dlg.setAttribute("data-ui", "modal");
        var titleId = rid("dlg");
        dlg.setAttribute("aria-labelledby", titleId);
        var title = document.createElement("div");
        title.id = titleId;
        title.setAttribute("data-ui", "modal-title");
        title.textContent = "Session will expire";
        var p = document.createElement("p");
        p.textContent = "Your session will expire in 60 seconds. Click Continue to stay signed in.";
        var actions = document.createElement("div");
        actions.setAttribute("data-ui", "modal-actions");
        var btn = document.createElement("button");
        btn.type = "button";
        btn.textContent = "Continue";
        actions.appendChild(btn);
        dlg.appendChild(title);
        dlg.appendChild(p);
        dlg.appendChild(actions);
        document.body.appendChild(overlay);
        document.body.appendChild(dlg);
        btn.addEventListener("click", function () {
          open = false;
          disabled.forEach(function (el) {
            el.disabled = false;
          });
          disabled = [];
          overlay.parentNode.removeChild(overlay);
          dlg.parentNode.removeChild(dlg);
        });
        btn.focus();
      };
      var onInteract = function (e) {
        if (open || !root.contains(e.target)) return;
        count++;
        if (count >= trigger) {
          document.removeEventListener("change", onInteract, true);
          document.removeEventListener("click", onInteract, true);
          window.setTimeout(showModal, 0);
        }
      };
      document.addEventListener("change", onInteract, true);
      document.addEventListener("click", onInteract, true);
    }
  }
})();
