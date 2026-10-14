/**
 * Three large, deterministic fixture pages for the distillation suite: the
 * kinds of enterprise pages where raw HTML is mostly noise (inline styles,
 * scripts, SVG, deep wrappers) and the interactive surface is small.
 */
import { createRng } from "../../seed";

function erpGrid(): string {
  const rng = createRng(101);
  const rows: string[] = [];
  for (let i = 0; i < 220; i++) {
    const style = `style="font-family:Tahoma;font-size:11px;padding:2px 4px;border-bottom:1px solid #ccc;background:${i % 2 ? "#f4f7fb" : "#ffffff"}"`;
    rows.push(
      `<tr onmouseover="this.style.background='#ffffcc'" onmouseout="this.style.background=''"><td ${style}><img src="data:image/gif;base64,R0lGODlhAQABAAAAACw=" width="1" height="1" alt="">${10000 + i}</td><td ${style}>PO-${rng.int(10000, 99999)}</td><td ${style}>V-${rng.int(1000, 9999)}</td><td ${style} align="right">${rng.int(100, 99999)}.${String(rng.int(0, 99)).padStart(2, "0")}</td><td ${style}><font color="#336699">OPEN</font></td></tr>`,
    );
  }
  const script = Array.from({ length: 60 }, (_, i) => `function grid_handler_${i}(e){var t=e||window.event;if(t&&t.keyCode==${i % 40}){document.forms[0].elements[${i % 4}].focus();return false;}return true;}`).join("\n");
  return `<!DOCTYPE html><html><head><title>ERP Grid</title><script>${script}</script><style>${".g td{font:11px Tahoma}".repeat(80)}</style></head><body>
<form id="grid_search"><table><tr><td><label for="q_po">PO Number</label></td><td><input id="q_po" name="q_po"></td><td><label for="q_vendor">Vendor</label></td><td><input id="q_vendor" name="q_vendor"></td><td><button type="submit">Search</button></td></tr></table></form>
<table class="g" width="100%" cellpadding="0" cellspacing="0"><tbody>${rows.join("")}</tbody></table></body></html>`;
}

function enterpriseForm(): string {
  const fields: string[] = [];
  for (let i = 0; i < 48; i++) {
    const id = `ctl00_PlaceHolderMain_ctl${String(i).padStart(2, "0")}_TextField`;
    let html = `<label for="${id}" class="ms-formlabel ms-standardheader ms-ellipsis">Field ${i + 1} name</label><input type="text" id="${id}" name="${id}" class="ms-long ms-spellcheck-true ms-input-${i}" aria-describedby="${id}_desc"><span id="${id}_desc" class="ms-metadata">Help text for field ${i + 1}</span>`;
    for (let d = 0; d < 8; d++) html = `<div class="ms-wrapper-level-${d} ms-flex ms-grid-col-${d} ms-pad-${d}"><span class="ms-inner">${html}</span></div>`;
    fields.push(html);
  }
  const icon = `<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path d="${"M12 2 L22 12 L12 22 L2 12 Z ".repeat(6)}" fill="#0078d4"/></svg>`;
  return `<!DOCTYPE html><html><head><title>Enterprise Form</title><style>${".ms-wrapper{display:flex}".repeat(120)}</style></head><body>
<nav>${Array.from({ length: 30 }, (_, i) => `<a href="/site/page-${i}">${icon}Section ${i + 1}</a>`).join("")}</nav>
<form id="aspnetForm">${fields.join("")}<button type="submit">Save</button><button type="button">Cancel</button></form></body></html>`;
}

function dashboard(): string {
  const rng = createRng(303);
  const path = Array.from({ length: 400 }, (_, i) => `${i * 2},${rng.int(0, 200)}`).join(" L");
  const charts = Array.from({ length: 6 }, () => `<svg viewBox="0 0 800 200" width="100%" height="200"><path d="M${path}" stroke="#3b0a6b" fill="none"/></svg>`).join("");
  const cards = Array.from({ length: 24 }, (_, i) => `<div class="card shadow-sm rounded p-3 m-2"><div class="card-body"><h5 class="card-title">Metric ${i}</h5><p class="card-text">${rng.int(1000, 99999)}</p><a href="/report/${i}" class="btn btn-link">Open report ${i}</a></div></div>`).join("");
  return `<!DOCTYPE html><html><head><title>Ops Dashboard</title><style>${".card{border:1px solid #ddd;padding:12px}".repeat(150)}</style><script>${"window.__data=window.__data||[];__data.push(" + JSON.stringify(Array.from({ length: 200 }, (_, i) => ({ id: i, v: i * 3 }))) + ");"}</script></head><body>
<header><input type="search" aria-label="Search reports"><button type="button" aria-label="Notifications">!</button></header>
<main>${charts}${cards}</main></body></html>`;
}

export const FIXTURE_PAGES: { id: string; title: string; html: () => string }[] = [
  { id: "erp-grid", title: "ERP grid (220 rows, inline styles and handlers)", html: erpGrid },
  { id: "enterprise-form", title: "Enterprise form (48 fields in deep wrappers)", html: enterpriseForm },
  { id: "dashboard", title: "Dashboard (inline SVG charts and data)", html: dashboard },
];
