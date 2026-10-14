/*
 * OmniCorp Enterprise Resource Portal v4.2 - page behavior.
 * Plain browser JavaScript, no build step. Element references are captured
 * once at load, so the page keeps working when chaos mode renames things.
 */
(function () {
  "use strict";
  var BASE = "/legacy/omnicorp/";
  var SESSION = "omnicorp.v42.session";
  var DEMO_USER = "fde.demo";
  var DEMO_PASS = "omnicorp2009";
  var page = document.body.getAttribute("data-page") || "index";

  function byId(id) {
    return document.getElementById(id);
  }
  function go(target) {
    // Test harnesses without real navigation (jsdom) may provide a hook.
    if (typeof window.__OMNICORP_NAVIGATE__ === "function") window.__OMNICORP_NAVIGATE__(BASE + target);
    else window.location.href = BASE + target;
  }
  function params() {
    return new URLSearchParams(window.location.search);
  }
  function delay(fn) {
    var ms = window.OmniChaos && window.OmniChaos.latency ? window.OmniChaos.latency() : 0;
    window.setTimeout(fn, ms);
  }
  function fmtMoney(cents) {
    var neg = cents < 0;
    var abs = Math.abs(cents);
    var units = String(Math.floor(abs / 100)).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
    var frac = String(abs % 100);
    if (frac.length < 2) frac = "0" + frac;
    return (neg ? "-" : "") + units + "." + frac;
  }
  function parseMoney(s) {
    var t = String(s || "").replace(/[$,\s]/g, "").replace(/USD/i, "");
    if (!/^\d+(\.\d{1,2})?$/.test(t)) return null;
    var parts = t.split(".");
    var frac = (parts[1] || "") + "00";
    return Number(parts[0]) * 100 + Number(frac.slice(0, 2));
  }
  function usDate(iso) {
    var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || "");
    return m ? m[2] + "/" + m[3] + "/" + m[1] : iso;
  }
  function ibanValid(raw) {
    var iban = String(raw || "").replace(/\s+/g, "").toUpperCase();
    if (!/^[A-Z]{2}\d{2}[A-Z0-9]{10,30}$/.test(iban)) return false;
    var r = iban.slice(4) + iban.slice(0, 4);
    var rem = 0;
    for (var i = 0; i < r.length; i++) {
      var c = r.charCodeAt(i);
      var d = c >= 65 && c <= 90 ? String(c - 55) : r[i];
      for (var j = 0; j < d.length; j++) rem = (rem * 10 + (d.charCodeAt(j) - 48)) % 97;
    }
    return rem === 1;
  }

  // ERP tables (static JSON; tests may preload window.__OMNICORP_DATA__).
  var dataPromise = window.__OMNICORP_DATA__
    ? Promise.resolve(window.__OMNICORP_DATA__)
    : fetch(BASE + "data/erp.json", { credentials: "same-origin" }).then(function (r) {
        return r.json();
      });
  dataPromise.then(function (d) {
    window.OmniLedger.ensure(d.historicalLedger || []);
  });

  function requireSession() {
    if (page === "index") return true;
    if (window.sessionStorage.getItem(SESSION)) return true;
    go("index.html?next=" + encodeURIComponent(page + ".html"));
    return false;
  }

  function banner(el, text, tone) {
    if (!el) return;
    el.textContent = text;
    if (tone) el.setAttribute("data-tone", tone);
    else el.removeAttribute("data-tone");
    el.hidden = !text;
  }

  // Shared chrome: footer reset link and log off.
  var resetLink = byId("reset_demo");
  if (resetLink) {
    resetLink.addEventListener("click", function (e) {
      e.preventDefault();
      dataPromise.then(function (d) {
        window.OmniLedger.reset(d.historicalLedger || []);
        window.sessionStorage.removeItem(SESSION);
        window.sessionStorage.removeItem("omnicorp.v42.chaos");
        window.sessionStorage.removeItem("omnicorp.v42.interstitial");
        go("index.html");
      });
    });
  }
  var logoff = byId("nav_logoff");
  if (logoff) {
    logoff.addEventListener("click", function () {
      window.sessionStorage.removeItem(SESSION);
    });
  }

  function modalOpen() {
    return !!(window.OmniChaos && window.OmniChaos.modalOpen && window.OmniChaos.modalOpen());
  }

  // ---------------------------------------------------------------- Log on
  function initLogin() {
    var form = byId("login_form");
    var user = byId("username");
    var pass = byId("password");
    var msg = byId("msg_banner");
    if (window.sessionStorage.getItem(SESSION) && params().get("next")) {
      go(params().get("next"));
      return;
    }
    form.addEventListener("submit", function (e) {
      e.preventDefault();
      if (user.value.trim() === DEMO_USER && pass.value === DEMO_PASS) {
        window.sessionStorage.setItem(SESSION, DEMO_USER);
        var next = params().get("next");
        go(next && /^[a-z-]+\.html$/.test(next) ? next : "po-search.html");
      } else {
        banner(msg, "ERR-0001: Invalid user name or password.");
      }
    });
  }

  // ------------------------------------------------------------ PO search
  function initPoSearch() {
    var form = byId("po_search_form");
    var query = byId("po_query");
    var status = byId("search_status");
    var results = byId("po_results");
    var headerBody = byId("po_header_rows");
    var postedBody = byId("posted_rows");

    function row(cells) {
      var tr = document.createElement("tr");
      for (var i = 0; i < cells.length; i++) {
        var td = document.createElement("td");
        td.textContent = cells[i];
        tr.appendChild(td);
      }
      return tr;
    }

    function search(q) {
      results.hidden = true;
      status.textContent = "Loading";
      status.setAttribute("data-state", "loading");
      delay(function () {
        dataPromise.then(function (d) {
          status.removeAttribute("data-state");
          var po = null;
          for (var i = 0; i < d.purchaseOrders.length; i++) if (d.purchaseOrders[i].po_number === q) po = d.purchaseOrders[i];
          if (!po) {
            status.textContent = "No purchase order found for " + (q || "(blank)") + ".";
            return;
          }
          var vendorName = "";
          for (var v = 0; v < d.vendors.length; v++) if (d.vendors[v].vendor_id === po.vendor_id) vendorName = d.vendors[v].name;
          headerBody.textContent = "";
          headerBody.appendChild(row([po.po_number, po.vendor_id, vendorName, fmtMoney(po.authorized_cents), po.cost_center, po.status]));
          postedBody.textContent = "";
          var posted = window.OmniLedger.byPo(po.po_number);
          if (posted.length === 0) {
            var empty = document.createElement("tr");
            var td = document.createElement("td");
            td.colSpan = 4;
            td.textContent = "No invoices posted against this PO.";
            empty.appendChild(td);
            postedBody.appendChild(empty);
          } else {
            for (var p = 0; p < posted.length; p++) {
              postedBody.appendChild(row([posted[p].invoice_number, fmtMoney(posted[p].amount_cents), posted[p].postingNumber, usDate(posted[p].postedAt)]));
            }
          }
          results.hidden = false;
          status.textContent = "1 purchase order found: " + po.po_number + ".";
        });
      });
    }

    form.addEventListener("submit", function (e) {
      e.preventDefault();
      if (modalOpen()) return;
      search(query.value.trim().toUpperCase());
    });
    var preset = params().get("po");
    if (preset) {
      query.value = preset;
      search(preset.toUpperCase());
    }
  }

  // --------------------------------------------------------- Invoice entry
  function initInvoiceEntry() {
    var form = byId("invoice_form");
    var msg = byId("msg_banner");
    var status = byId("post_status");
    var tabs = [byId("tab_header"), byId("tab_amounts"), byId("tab_payment")];
    var panels = [byId("panel_header"), byId("panel_amounts"), byId("panel_payment")];
    var f = {
      vendor: byId("vendor_id"),
      po: byId("po_number"),
      invoice: byId("invoice_number"),
      date: byId("invoice_date"),
      cost: byId("cost_center"),
      amount: byId("gross_amount"),
      tax: byId("tax_rate"),
      lines: byId("line_items"),
      iban: byId("payee_iban"),
      override: byId("override_code"),
    };
    var overrideRow = byId("row_override");

    function selectTab(idx) {
      for (var i = 0; i < tabs.length; i++) {
        tabs[i].setAttribute("aria-selected", i === idx ? "true" : "false");
        tabs[i].tabIndex = i === idx ? 0 : -1;
        panels[i].hidden = i !== idx;
      }
    }
    tabs.forEach(function (t, i) {
      t.addEventListener("click", function () {
        selectTab(i);
      });
      t.addEventListener("keydown", function (e) {
        if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
          var n = (i + (e.key === "ArrowRight" ? 1 : tabs.length - 1)) % tabs.length;
          selectTab(n);
          tabs[n].focus();
        }
      });
    });
    var preset = params();
    if (preset.get("po")) f.po.value = preset.get("po");

    form.addEventListener("reset", function () {
      banner(msg, "");
      overrideRow.hidden = true;
      selectTab(0);
    });

    function fail(text) {
      banner(msg, text);
      status.textContent = "";
      status.removeAttribute("data-state");
    }

    form.addEventListener("submit", function (e) {
      e.preventDefault();
      if (modalOpen()) {
        banner(msg, "ERR-0020: Please respond to the session notice first.");
        return;
      }
      banner(msg, "");
      status.textContent = "Processing";
      status.setAttribute("data-state", "loading");
      delay(function () {
        dataPromise.then(function (d) {
          var vendor = f.vendor.value.trim().toUpperCase();
          var poNo = f.po.value.trim().toUpperCase();
          var invNo = f.invoice.value.trim().toUpperCase();
          var dateRaw = f.date.value.trim();
          var cost = f.cost.value;
          var cents = parseMoney(f.amount.value);
          var iban = f.iban.value.replace(/\s+/g, "").toUpperCase();
          var required = [
            [vendor, "Vendor ID"],
            [poNo, "PO Number"],
            [invNo, "Invoice Number"],
            [dateRaw, "Invoice Date"],
            [f.amount.value.trim(), "Invoice Total"],
            [iban, "Payee IBAN"],
          ];
          for (var r = 0; r < required.length; r++) if (!required[r][0]) return fail("ERR-0100: Required field missing: " + required[r][1] + ".");
          var dm = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(dateRaw);
          if (!dm || Number(dm[1]) < 1 || Number(dm[1]) > 12 || Number(dm[2]) < 1 || Number(dm[2]) > 31) return fail("ERR-0110: Invoice date must be MM/DD/YYYY.");
          var vendorRow = null;
          for (var v = 0; v < d.vendors.length; v++) if (d.vendors[v].vendor_id === vendor) vendorRow = d.vendors[v];
          if (!vendorRow) return fail("ERR-0120: Unknown vendor " + vendor + ".");
          var po = null;
          for (var p = 0; p < d.purchaseOrders.length; p++) if (d.purchaseOrders[p].po_number === poNo) po = d.purchaseOrders[p];
          if (!po || po.vendor_id !== vendor) return fail("ERR-0130: Purchase order " + poNo + " not found for vendor " + vendor + ".");
          if (po.status !== "OPEN") return fail("ERR-0131: Purchase order " + poNo + " is closed.");
          if (cost && cost !== po.cost_center) return fail("ERR-0140: Cost center " + cost + " does not match " + poNo + " (" + po.cost_center + ").");
          if (cents === null || cents <= 0) return fail("ERR-0150: Invoice total is not a valid amount.");
          if (!ibanValid(iban)) return fail("ERR-2210: IBAN check digits invalid. Verify the payee account.");
          var dup = window.OmniLedger.findInvoice(vendor, invNo);
          if (dup) return fail("ERR-1001: Duplicate invoice number " + invNo + " for vendor " + vendor + " (posted as " + dup.postingNumber + ").");
          var overrideCode = f.override.value.trim().toUpperCase();
          if (cents > po.authorized_cents) {
            if (!overrideCode) {
              overrideRow.hidden = false;
              selectTab(2);
              return fail("ERR-4471: Amount exceeds PO authorized amount ($" + fmtMoney(po.authorized_cents) + "). Enter supervisor override code.");
            }
            if (!/^OVR-[0-9A-F]{6}$/.test(overrideCode)) return fail("ERR-4472: Invalid override code.");
          }
          var entry = window.OmniLedger.post({
            vendor_id: vendor,
            po_number: poNo,
            invoice_number: invNo,
            amount_cents: cents,
            iban: iban,
            costCenter: cost || po.cost_center,
            invoiceDate: dateRaw,
            overrideCode: cents > po.authorized_cents ? overrideCode : undefined,
          });
          go("confirmation.html?posting=" + encodeURIComponent(entry.postingNumber));
        });
      });
    });
  }

  // ---------------------------------------------------------- Confirmation
  function initConfirmation() {
    var status = byId("confirm_status");
    var details = byId("confirm_rows");
    var posting = params().get("posting") || "";
    var entry = window.OmniLedger.get(posting);
    if (!entry) {
      status.textContent = "No posting found for " + (posting || "(none)") + ".";
      return;
    }
    status.textContent = "Posted. Posting number " + entry.postingNumber + ".";
    var rows = [
      ["Posting number", entry.postingNumber],
      ["Vendor", entry.vendor_id],
      ["PO number", entry.po_number],
      ["Invoice number", entry.invoice_number],
      ["Amount (USD)", fmtMoney(entry.amount_cents)],
      ["Posted at", entry.postedAt],
    ];
    if (entry.overrideCode) rows.push(["Override code", entry.overrideCode]);
    for (var i = 0; i < rows.length; i++) {
      var tr = document.createElement("tr");
      var th = document.createElement("th");
      th.textContent = rows[i][0];
      var td = document.createElement("td");
      td.textContent = rows[i][1];
      tr.appendChild(th);
      tr.appendChild(td);
      details.appendChild(tr);
    }
  }

  if (!requireSession()) return;
  if (page === "index") initLogin();
  else if (page === "po-search") initPoSearch();
  else if (page === "invoice-entry") initInvoiceEntry();
  else if (page === "confirmation") initConfirmation();

  window.OmniPortal = { version: "4.2", page: page, ready: dataPromise };
})();
