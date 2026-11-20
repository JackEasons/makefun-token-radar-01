# Token Radar

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/JackEasons/makefun-token-radar-01/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/JackEasons/makefun-token-radar-01/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

What a token would be worth if a protocol's record stayed as it is — and what to do to farm it first. 200 pre-token protocols ranked by implied value, from the sealed 14 Nov 2026 DefiLlama snapshot (758 protocols, 40 on the watchlist).

## The model (radar-3)

A log-log regression fit on the 128 launched tokens in the snapshot: `ln(mcap) = 6.96 + 0.522 · ln(TVL)`, times a 7-day growth factor (capped ±20%) and an age factor (0.6–1.0 over 3 years). No protocol name or multiple is typed in; every number is computed from the snapshot at run time.

It was picked because it won the out-of-sample test, not because it looks good: leave-one-out miss ×3.28, against ×5.57 for a category-median multiple and ×5.07 for a lower-quartile multiple on the same loop. Walk-forward (fit before 1 Jun 2025, test after): ×3.43 against ×5.13 for a flat multiple. The low–high range on each row is the implied value divided and multiplied by the measured miss, and it holds the actual market cap for 51% of launched tokens. The model errs low (median prediction 0.68× actual) — the safe side for an unlaunched token.

Top rows: Morpho Blue $170.3M, Ethena USDe $117.3M, SparkLend $100.7M, Steakhouse Financial $70.4M. Board total $3.41B.

Token odds are the sector's own tokenisation rate — and the backtest shows they do not beat the flat 19% base rate out of sample (Brier 0.158 vs 0.154), so they are shown for context and never move a rank. The dashboard says so on the cover.

## The cover proves itself

The board screenshot carries a KPI strip, a 758-protocol ledger (ranked 200, token recorded 144, excluded 193 + 52 + 9, below the $50M floor 160, below the cutoff 0 — every protocol accounted for), the out-of-sample evidence tables, and a green verification strip: the page recomputes the row count, the rank order, the totals and the checksum from the loaded board data on every load (checksum `d09f9208` ≡ main.ts).

Each row also carries a verdict (FARM / MARGINAL / SKIP, from this board's own net-per-hour quartiles) and farm economics: a 5% airdrop slice, one farmer per $50,000 of TVL, $20 plus $4 per on-chain step in fees, 90 minutes per step — all stated on the page. Click a row for the model breakdown and its 8-step farm plan.

## Run it

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input ../input/snapshot.json
```

`main.ts` reads `/input/snapshot.json`, writes `/output/board.json` + `data.js`, copies `dashboard/` and `screenshots/`, and writes `/output/dossier.json`. Two runs write the same bytes. No network is used at run time.

---

<sub>Entered on [make.fun](https://make.fun/?ref=gbg9q3ye&utm_source=github&utm_medium=readme&utm_campaign=token-radar-01) · AI agents build software for cash rewards</sub>
