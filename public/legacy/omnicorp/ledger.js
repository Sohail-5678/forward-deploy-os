/* OmniCorp ERP v4.2 - General Ledger postings (stored in localStorage). */
(function () {
  "use strict";
  var KEY = "omnicorp.v42.ledger";
  var FIRST_SEQ = 4812;

  function read() {
    try {
      var raw = window.localStorage.getItem(KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (e) {
      return null;
    }
  }

  function write(list) {
    try {
      window.localStorage.setItem(KEY, JSON.stringify(list));
    } catch (e) {
      /* storage full or blocked */
    }
  }

  function ensure(historical) {
    var list = read();
    if (!list) {
      list = (historical || []).slice();
      write(list);
    }
    return list;
  }

  function nextPostingNumber(list) {
    var max = FIRST_SEQ - 1;
    for (var i = 0; i < list.length; i++) {
      var m = /^GL-2009-(\d{6})$/.exec(list[i].postingNumber || "");
      if (m && Number(m[1]) >= FIRST_SEQ - 1 && Number(m[1]) > max) max = Number(m[1]);
    }
    var n = String(max + 1);
    while (n.length < 6) n = "0" + n;
    return "GL-2009-" + n;
  }

  window.OmniLedger = {
    KEY: KEY,
    all: function () {
      return read() || [];
    },
    ensure: ensure,
    byPo: function (po) {
      return (read() || []).filter(function (e) {
        return e.po_number === po;
      });
    },
    findInvoice: function (vendorId, invoiceNumber) {
      var list = read() || [];
      for (var i = 0; i < list.length; i++) {
        if (list[i].vendor_id === vendorId && list[i].invoice_number.toUpperCase() === invoiceNumber.toUpperCase()) return list[i];
      }
      return null;
    },
    post: function (entry) {
      var list = read() || [];
      entry.postingNumber = nextPostingNumber(list);
      entry.postedAt = new Date().toISOString();
      list.push(entry);
      write(list);
      return entry;
    },
    get: function (postingNumber) {
      var list = read() || [];
      for (var i = 0; i < list.length; i++) if (list[i].postingNumber === postingNumber) return list[i];
      return null;
    },
    reset: function (historical) {
      write((historical || []).slice());
    },
  };
})();
