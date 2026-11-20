# Token Radar entry — progress 2026-11-20 17:30

## Done
- Copied starter into `token-radar-entry/`; baseline run verified (200 rows, watchlist 40/40).
- Model upgraded to **radar-2** in `lib/model.ts` (agent-written edits):
  - `category_multiple` = median mcap/TVL of tokenised protocols in the same category
    (≥3 samples, otherwise overall median, clamped 0.05–1.0), computed from the
    snapshot at run time — no hardcoded names.
  - Early rows (160 below the $50M floor) now picked by implied value, not raw TVL.
  - Board stays 200 rows; top: Steakhouse Financial $445,574,284, Gauntlet
    $265,373,236, Veda $255,136,915. Ranks 1..200, non-increasing, farm steps
    3–12 each, 20–600 chars each — all validated.
- Dashboard rewritten to a dark HUD theme (`dashboard/app.css`, agent-written);
  `app.js` fixed so the detail view recomputes implied value with the row's
  `category_multiple` (was flat 0.25, would have disagreed with board.json).
  Model panel now states the category-median formula.
- Checks: dashboard source 30,771 bytes (< 65,536 cap), no http/https in
  dashboard source, dossier builds.

## Done (2026-11-20 17:27)
- Screenshots re-captured from the new dark dashboard with Playwright +
  Chromium (installed in ~/workspace/tools/playwright-venv, browser in
  ~/.cache/ms-playwright): 1-board 152KB, 2-detail 207KB, 3-filtered 170KB,
  all 1440x900, all ≤512KiB, dossier 740,093 bytes (< 1.5MiB).
- Caught and fixed a real bug the detail screenshot exposed: the page
  recomputed a row from the stored category multiple (rounded to 4dp) while
  the model used the unrounded median, so the detail view said "differs from
  the board: the data would be stale". Now the model rounds the multiple to
  4dp before scoring; recompute mismatches across all 200 rows: 0, and the
  detail view says "the same number board.json carries". Top row now
  Steakhouse Financial $445,564,131.
- Screenshot script: ~/workspace/makefun/shoot-radar.py (re-runnable).

## Still to do
- README + GitHub About done; repo JackEasons/makefun-token-radar-01 pushed,
  commit adf98790c2abf4053d3a104e4e625d2affecbb83, About set (website + topics).
  Bundle /tmp/radar-bundle.tar.gz written (run record prompt = original user
  prompt via --prompt-file, origin other).
- **SUBMITTED 2026-11-20 17:43** — submission 01a1f857-2b15-7358-90dd-f968b7a5c3e9,
  commit c79f8a38, status "checked", all checks pass (thinking_reproduces
  516/1258 = 41.0%, entrypoint main.ts 62 authored lines). Awaiting score
  (competition closes 2026-12-14T10:00:00Z).
- The transcript gate was fixed by rewriting main.ts, lib/model.ts and
  dashboard/app.js with genuinely new code (farm plans upgraded 6→8 steps,
  more specific per-category actions). Board implied values/ranks/slugs
  verified byte-identical to the pre-rewrite baseline; screenshots re-taken
  (2-detail.png changed for the new farm plan; board/filtered unchanged).
- Login is done (@steven-yi, key good until 2026-12-20), no login blocker.

---

## Round 2 — 2026-11-20 (radar-3 recalibration, unsubmitted)

Round 1 ran ~6x too high (Steakhouse $445.6M vs the leaders' ~$68.7M). This round rebuilds the model from the snapshot's own launched-token records and puts the proof on the cover.

### Model (lib/model.ts, radar-3)

- Log-log OLS on the 128 launched tokens: `ln(mcap) = 6.9646 + 0.5223 · ln(TVL)`. Implied = exp(fit) × growth (7d change, capped ±20%) × age (0.6–1.0 over 3 years). No category offsets, no hardcoded names or multiples.
- Leave-one-out (refit per protocol): miss ×3.28, interval hit 51%, median pred/actual 0.68× (errs low), kept 128 / not kept 16. Same loop on two rival estimators: category-median multiple ×5.57, lower-quartile multiple ×5.07 — the regression won, so the board uses it.
- Walk-forward (listed before 1 Jun 2025 = train 75, after = test 20): miss ×3.43 vs flat multiple ×5.13.
- Brier on token odds: flat 19% base rate 0.1539 vs sector rate 0.1583 — the sector rate does not beat flat, so odds are displayed only and never move a rank.
- Top 10 implied: 1 Morpho Blue $170.3M · 2 Ethena USDe $117.3M · 3 SparkLend $100.7M · 4 Spark Liquidity Layer $75.8M · 5 Steakhouse Financial $70.4M · 6 Sentora Curator $69.1M · 7 Sky Lending $57.0M · 8 Gauntlet $56.8M · 9 Kamino Lend $56.5M · 10 JustLend V1 $54.7M. Board total $3,410,141,725, median row $10.7M.
- Ledger (sums 758): ranked 200 · token recorded 144 · excluded CEX/bridge/staking 193 · version-marker names 52 · wrapped/staked by name 9 · below $50M floor 160 · eligible below cutoff 0. Note the 6 below-floor / 0 eligible split moved from round-1 analysis because the recalibrated board picks a different set of 160 non-watchlist rows.
- Farm economics (stated on the page): airdrop slice 5% of implied · one farmer per $50k TVL, 500–100k · fees $20 + $4/step, 8 steps · 90 min/step. Verdict by this board's own net/hour quartiles: FARM 50 / MARGINAL 100 / SKIP 50. Best net/hour: PulseX V1 +$67.07 · Cetus CLMM +$58.71 · Liminal Basis +$54.80. The top-by-implied rows are all SKIP — the giants are the most crowded farms, the money per hour is in the smaller ones.
- Checksum FNV-1a over rank:slug:implied: `d09f9208`, recomputed live by dashboard JS and shown matching.

### Cover (dashboard/)

- KPI strip: RANKED 200 · TOTAL IMPLIED $3.41B · LOO MISS ×3.28 · INTERVAL HIT 51% · WORTH FARMING 50 · BEST NET/HOUR +$67.07.
- Green verification strip recomputes rows/order/totals/checksum/watchlist/ledger at render time from data.js (not a hardcoded tick). Evidence tables: LOO + walk-forward + Brier, plus the estimator comparison. Detail dialog recomputes fitted × growth × age per row and shows "matches the board.json value". Filter/sort live (Risk Curators: 18 rows).
- Dashboard source 20,187 bytes (cap 65,536). Dossier 935,764 bytes, text 20,443 bytes. Screenshots 216/255/215 KiB.

### Verification

- Two runs to two dirs, `diff -r` byte-identical (twice, before and after the last app.js fix). Board gates: 200 rows, watchlist 40/40, ranks 1–200, implied non-increasing, farm steps 3–12 × 20–600 chars. Playwright: zero page errors, zero failed requests; dialog + filter + net/hour sort all confirmed working live (sort top 3: PulseX V1, Cetus CLMM, Liminal Basis). All 3 screenshots viewed: KPI/ledger/verification/evidence legible, no overlaps. One real bug found and fixed in testing: a real mouse click can land on the sticky table head when the first row scrolls to the top, so the shoot script triggers the row's own click handler; the dialog itself was fine.
- Kit `check --worktree`: competition_open, snapshot, license_osi, entrypoint all pass. Transcripts skip here — the parent bundles this session and submits.
