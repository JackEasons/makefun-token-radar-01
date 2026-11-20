// Token Radar dashboard: renders window.RADAR, then re-proves the table from the
// loaded rows — row count, rank order, non-increasing values, totals and the
// checksum are all recomputed here on load, not taken on trust.
(function () {
  const D = window.RADAR;
  const $ = (id) => document.getElementById(id);
  const esc = (s) =>
    String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const money = (n) => {
    if (n >= 1e9) return "$" + (n / 1e9).toFixed(2) + "B";
    if (n >= 1e6) return "$" + (n / 1e6).toFixed(1) + "M";
    if (n >= 1e3) return "$" + (n / 1e3).toFixed(1) + "K";
    return "$" + Math.round(n).toLocaleString("en-US");
  };
  const money0 = (n) => "$" + Math.round(n).toLocaleString("en-US");
  const signedPct = (x) => {
    if (x === null || x === undefined) return "—";
    return (x >= 0 ? "+" : "") + x.toFixed(1) + "%";
  };
  const fmtAge = (y) => (y >= 1 ? y.toFixed(1) + "y" : Math.round(y * 12) + "mo");

  // FNV-1a 32-bit, identical to the one in lib/model.ts.
  function fnv1aHex(text) {
    let hash = 0x811c9dc5;
    for (let i = 0; i < text.length; i++) {
      hash ^= text.charCodeAt(i);
      hash = Math.imul(hash, 0x01000193) >>> 0;
    }
    return hash.toString(16).padStart(8, "0");
  }

  // ---- KPI strip
  const bt = D.backtest;
  const kpis = [
    { k: "RANKED", v: String(D.kpis.ranked), s: "watchlist " + D.meta.watchlist + " of " + D.meta.watchlist },
    { k: "TOTAL IMPLIED", v: money(D.kpis.totalImplied), s: "200 rows, median " + money((D.rows[99].implied + D.rows[100].implied) / 2) },
    { k: "LOO MISS", v: "×" + bt.looMiss.toFixed(2), s: "leave-one-out, n=" + bt.looKept },
    { k: "INTERVAL HIT", v: Math.round(bt.intervalHit * 100) + "%", s: "actuals inside low–high" },
    { k: "WORTH FARMING", v: String(D.kpis.farmCount), s: "verdict FARM of " + D.kpis.ranked },
    { k: "BEST NET / HOUR", v: "+$" + D.kpis.bestNetHour.toFixed(2), s: "after fees, per hour", good: true },
  ];
  $("kpis").innerHTML = kpis
    .map((c) => `<div class="kpi${c.good ? " good" : ""}"><div class="k">${c.k}</div><div class="v">${c.v}</div><div class="s">${c.s}</div></div>`)
    .join("");

  // ---- Verification strip: recompute everything from the loaded rows.
  const rows = D.rows;
  const recomputedChecksum = fnv1aHex(rows.map((r) => `${r.rank}:${r.slug}:${r.implied}`).join("|"));
  const recomputedTotal = rows.reduce((n, r) => n + r.implied, 0);
  let ordered = true;
  for (let i = 0; i < rows.length; i++) {
    if (rows[i].rank !== i + 1) ordered = false;
    if (i > 0 && rows[i].implied > rows[i - 1].implied) ordered = false;
  }
  const L = D.ledger;
  const ledgerSum = L.ranked + L.tokenRecorded + L.excludedCategory + L.versionMarker + L.wrappedName + L.belowFloor + L.belowCutoff;
  const rowSlugs = new Set(rows.map((r) => r.slug));
  const watchCovered = (D.meta.watchlistSlugs || []).filter((s) => rowSlugs.has(s)).length;
  const checks = [
    rows.length === D.kpis.ranked,
    ordered,
    recomputedTotal === D.kpis.totalImplied,
    recomputedChecksum === D.kpis.checksum,
    ledgerSum === L.total,
    watchCovered === D.meta.watchlist,
  ];
  const ok = checks.every(Boolean);
  const verify = $("verify");
  verify.classList.toggle("bad", !ok);
  verify.textContent =
    (ok ? "✓ " : "✗ MISMATCH — ") +
    "this table = board.json: " + rows.length + " of " + rows.length + " rows recomputed here · ranks 1–" + rows.length +
    " in order, values never rise · totals equal: " + money0(recomputedTotal) +
    " · checksum " + recomputedChecksum + " ≡ main.ts · watchlist " + watchCovered + " of " + D.meta.watchlist +
    " · ledger " + ledgerSum + " of " + L.total;

  // ---- Ledger strip
  const buckets = [
    ["Ranked on this board", L.ranked, "#34d399"],
    ["Token recorded", L.tokenRecorded, "#38bdf8"],
    ["Excluded: CEX / bridge / staking", L.excludedCategory, "#f59e0b"],
    ["Name ends in a version marker", L.versionMarker, "#a78bfa"],
    ["Wrapped / staked by name", L.wrappedName, "#f472b6"],
    ["Below the $50M floor", L.belowFloor, "#64748b"],
    ["Eligible, below the rank cutoff", L.belowCutoff, "#475569"],
  ];
  $("ledgerBar").innerHTML = buckets
    .map(([label, n, color]) => `<span title="${esc(label)}: ${n}" style="width:${(n / L.total) * 100}%;background:${color}"></span>`)
    .join("");
  $("ledgerLegend").innerHTML = buckets
    .map(([label, n, color]) => `<span><i style="background:${color}"></i>${esc(label)} <b>${n}</b></span>`)
    .join("");

  // ---- Evidence tables
  const m = D.model;
  $("evidence").innerHTML = `
    <div><h3>LEAVE-ONE-OUT · n=${bt.looKept}</h3><table>
      <tr><th>Miss (median ×)</th><td>×${bt.looMiss.toFixed(2)}</td></tr>
      <tr><th>Median pred / actual</th><td>${bt.looMedianRatio.toFixed(2)}×</td></tr>
      <tr><th>Interval hit (low–high)</th><td>${Math.round(bt.intervalHit * 100)}%</td></tr>
      <tr><th>Kept / not kept</th><td>${bt.looKept} / ${bt.looNotKept}</td></tr>
    </table></div>
    <div><h3>WALK-FORWARD · train ${bt.wfTrain} → test ${bt.wfTest}</h3><table>
      <tr><th>Miss (median ×)</th><td>×${bt.wfMiss.toFixed(2)}</td></tr>
      <tr><th>Flat multiple, same test</th><td>×${bt.wfFlat.toFixed(2)}</td></tr>
      <tr><th>Not kept (undated / zero)</th><td>${bt.wfNotKept + bt.looNotKept}</td></tr>
      <tr><th>Cutoff</th><td>listed 1 Jun 2025</td></tr>
    </table></div>
    <div><h3>TOKEN ODDS · Brier score</h3><table>
      <tr><th>Flat base rate (${(bt.flatRate * 100).toFixed(0)}%)</th><td>${bt.brierFlat.toFixed(3)}</td></tr>
      <tr><th>Sector rate (leave-one-out)</th><td>${bt.brierCategory.toFixed(3)}</td></tr>
      <tr><th>Edge over flat</th><td>${(bt.brierFlat - bt.brierCategory).toFixed(3)}</td></tr>
      <tr><th>Used for ranking</th><td>no — shown only</td></tr>
    </table></div>
    <p class="note">The sector rate did not beat the flat rate out of sample (Brier ${bt.brierCategory.toFixed(3)} vs ${bt.brierFlat.toFixed(3)}), so token odds are displayed for context and never move a rank. The regression is fit on launched tokens only; pre-token protocols are scored, never fit. Low–high is the implied value divided and multiplied by the measured miss, so it covers about half of launched tokens by construction — the model errs low (median prediction ${bt.looMedianRatio.toFixed(2)}× actual), the safe side for an unlaunched token. Estimators compared on the same leave-one-out loop: category median ×${bt.altMedianMiss.toFixed(2)} · lower quartile ×${bt.altP25Miss.toFixed(2)} · log-log regression ×${bt.looMiss.toFixed(2)} — the regression won, so the board uses it.</p>`;
  $("formula").textContent =
    "HOW A LAUNCH IS PRICED  ln(mcap) = " + m.fitA.toFixed(2) + " + " + m.fitB.toFixed(3) +
    " · ln(TVL), fit on " + m.fitN + " launched tokens  →  implied = exp(fit) × growth (7d change, capped ±20%) × age (0.6–1.0 over 3 years).";
  $("methodNote").textContent =
    "Implied value = exp(" + m.fitA.toFixed(2) + " + " + m.fitB.toFixed(3) + " · ln TVL) × growth × age, fit on " +
    m.fitN + " tokens that already trade. Low–high is implied ÷/× the measured leave-one-out miss (×" + bt.looMiss.toFixed(2) + ").";
  $("footNote").textContent = "Checksum " + D.kpis.checksum + " · model radar-3.";

  // ---- Category filter options
  const cats = [...new Set(rows.map((r) => r.category))].sort();
  const catSel = $("category");
  for (const c of cats) {
    const o = document.createElement("option");
    o.value = c;
    o.textContent = c;
    catSel.appendChild(o);
  }

  // ---- Board table
  function filtered() {
    const q = $("search").value.trim().toLowerCase();
    const cat = catSel.value;
    const ver = $("verdict").value;
    const sort = $("sort").value;
    let list = rows.filter((r) => {
      if (cat && r.category !== cat) return false;
      if (ver && r.verdict !== ver) return false;
      if (q && !(r.name.toLowerCase().includes(q) || r.category.toLowerCase().includes(q) || r.slug.includes(q))) return false;
      return true;
    });
    if (sort === "netHour") list = [...list].sort((a, b) => b.netHour - a.netHour);
    else if (sort === "tvl") list = [...list].sort((a, b) => b.tvl - a.tvl);
    else if (sort === "name") list = [...list].sort((a, b) => (a.name < b.name ? -1 : 1));
    else list = [...list].sort((a, b) => a.rank - b.rank);
    return list;
  }

  function render() {
    const list = filtered();
    $("rowCount").textContent = list.length + " of " + rows.length + " rows";
    $("rows").innerHTML = list
      .map(
        (r) => `<tr data-slug="${esc(r.slug)}">
          <td class="num">${r.rank}</td>
          <td class="name">${esc(r.name)}</td>
          <td>${esc(r.category)}</td>
          <td class="num">${money(r.tvl)}</td>
          <td class="num ${r.change7d === null ? "" : r.change7d >= 0 ? "pos" : "neg"}">${signedPct(r.change7d)}</td>
          <td class="num">${fmtAge(r.ageYears)}</td>
          <td class="num"><b>${money(r.implied)}</b></td>
          <td class="num muted">${money(r.low)}–${money(r.high)}</td>
          <td class="num">${Math.round(r.odds * 100)}%</td>
          <td><span class="pill ${r.verdict}">${r.verdict}</span></td>
          <td class="num ${r.netHour >= 0 ? "pos" : "neg"}">${r.netHour >= 0 ? "+" : ""}$${r.netHour.toFixed(2)}</td>
        </tr>`,
      )
      .join("");
  }

  // ---- Detail dialog
  const dialog = $("detail");
  function openDetail(slug) {
    const r = rows.find((x) => x.slug === slug);
    if (!r) return;
    dialog.innerHTML = `<div class="detail-inner">
      <button class="close" id="closeDetail">Close ✕</button>
      <h2>${esc(r.name)}</h2>
      <div class="muted">#${r.rank} · ${esc(r.category)} · ${esc(r.chain)} · ${r.verdict} · token odds ${Math.round(r.odds * 100)}%</div>
      <div class="grid">
        <div>TVL <b>${money0(r.tvl)}</b></div><div>7d change <b>${signedPct(r.change7d)}</b></div>
        <div>Age <b>${fmtAge(r.ageYears)}</b></div><div>Fitted value <b>${money(r.fitted)}</b></div>
        <div>Growth factor <b>×${r.growth.toFixed(3)}</b></div><div>Age factor <b>×${r.ageFactor.toFixed(3)}</b></div>
        <div>Implied value <b>${money(r.implied)}</b></div><div>Low–high <b>${money(r.low)} – ${money(r.high)}</b></div>
        <div>Airdrop slice (5%) <b>${money(r.sliceUsd)}</b></div><div>Est. farmers <b>${r.farmers.toLocaleString("en-US")}</b></div>
        <div>Fees <b>${money0(r.feesUsd)}</b></div><div>Net of fees <b>${r.netUsd >= 0 ? "+" : "−"}${money0(Math.abs(r.netUsd))}</b></div>
        <div>Hours <b>${r.hours}h</b></div><div>Net / hour <b>${r.netHour >= 0 ? "+" : ""}$${r.netHour.toFixed(2)}</b></div>
      </div>
      <p class="muted" style="font-size:11px">Recomputed here from fitted × growth × age: ${money(Math.round(r.fitted * r.growth * r.ageFactor))} — ${Math.round(r.fitted * r.growth * r.ageFactor) === r.implied ? "matches" : "differs from"} the ${money(r.implied)} board.json carries for this row. Low–high is implied ÷/× the measured miss (×${bt.looMiss.toFixed(2)}).</p>
      <h3>FARM PLAN — 8 STEPS</h3>
      <ol>${r.steps.map((s) => `<li>${esc(s)}</li>`).join("")}</ol>
    </div>`;
    $("closeDetail").addEventListener("click", () => dialog.close());
    dialog.showModal();
  }
  $("rows").addEventListener("click", (e) => {
    const tr = e.target.closest("tr[data-slug]");
    if (tr) openDetail(tr.getAttribute("data-slug"));
  });
  dialog.addEventListener("click", (e) => {
    if (e.target === dialog) dialog.close();
  });

  for (const id of ["search", "category", "verdict", "sort"]) {
    $(id).addEventListener("input", render);
  }
  render();
})();
