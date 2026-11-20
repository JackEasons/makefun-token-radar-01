// Token Radar entrypoint: reads the sealed snapshot, builds the ranked board
// with the radar-3 model, and writes /output/board.json, data.js, the dashboard,
// the screenshots and dossier.json. Two runs write the same bytes: no clock,
// no randomness, every sort has a slug tiebreak, every float is rounded before
// it is written out.

import { readFileSync, writeFileSync, mkdirSync, cpSync, existsSync } from "node:fs";
import { join } from "node:path";
import { buildBoard, boardChecksum, type Snapshot, type Row } from "./lib/model.ts";
import { buildDossier } from "./vendor/makefun-board.ts";

function argValue(flag: string, fallback: string): string {
  const i = process.argv.indexOf(flag);
  return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1]! : fallback;
}

function fail(message: string): never {
  throw new Error(`token-radar: ${message}`);
}

function main(): void {
  const inputPath = argValue("--input", "/input/snapshot.json");
  const outDir = process.env.MAKEFUN_OUTPUT_DIR ?? "/output";
  const snapshot = JSON.parse(readFileSync(inputPath, "utf8")) as Snapshot;
  if (!Array.isArray(snapshot.protocols) || !Array.isArray(snapshot.watchlist)) {
    fail("snapshot is not the expected shape");
  }

  const board = buildBoard(snapshot);
  const rows = board.rows;
  const bt = board.backtest;

  // Gate checks, run here so a bad board never reaches the dossier.
  if (rows.length < 100 || rows.length > 4000) {
    fail(`board has ${rows.length} rows, needs 100-4000`);
  }
  const watch = new Set(snapshot.watchlist);
  const seen = new Set<string>();
  let prev = Number.POSITIVE_INFINITY;
  rows.forEach((r, i) => {
    if (r.rank !== i + 1) fail(`row ${r.slug} has rank ${r.rank}, expected ${i + 1}`);
    if (seen.has(r.slug)) fail(`duplicate slug ${r.slug}`);
    seen.add(r.slug);
    if (r.implied > prev) fail(`implied value rises at rank ${r.rank}`);
    prev = r.implied;
    if (r.implied <= 0) fail(`row ${r.slug} has non-positive implied value`);
    if (r.steps.length < 3 || r.steps.length > 12) {
      fail(`row ${r.slug} has ${r.steps.length} farm steps, needs 3-12`);
    }
    for (const step of r.steps) {
      const len = step.trim().length;
      if (len < 20 || len > 600) {
        fail(`row ${r.slug} has a farm step of ${len} chars, needs 20-600`);
      }
    }
  });
  for (const slug of watch) {
    if (!seen.has(slug)) fail(`watchlist slug ${slug} is missing from the board`);
  }
  const ledgerSum =
    board.ledger.ranked +
    board.ledger.tokenRecorded +
    board.ledger.excludedCategory +
    board.ledger.versionMarker +
    board.ledger.wrappedName +
    board.ledger.belowFloor +
    board.ledger.belowCutoff;
  if (ledgerSum !== board.ledger.total) {
    fail(`ledger sums to ${ledgerSum}, snapshot holds ${board.ledger.total}`);
  }
  if (boardChecksum(rows) !== board.checksum) {
    fail("checksum recomputation disagrees with the board");
  }

  mkdirSync(outDir, { recursive: true });
  mkdirSync(join(outDir, "dashboard"), { recursive: true });
  mkdirSync(join(outDir, "screenshots"), { recursive: true });

  // board.json: the gate's fields first, then the dashboard's detail fields.
  const boardJson = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    model: "radar-3 log-log regression on launched tokens, growth and age factors",
    rows: rows.map((r: Row) => ({
      slug: r.slug,
      name: r.name,
      rank: r.rank,
      implied_value_usd: r.implied,
      farm_steps: r.steps,
      category: r.category,
      chain: r.chain,
      tvl_usd: r.tvl,
      change_7d: r.change7d,
      age_years: r.ageYears,
      fitted_value_usd: r.fitted,
      growth_factor: r.growth,
      age_factor: r.ageFactor,
      implied_low_usd: r.low,
      implied_high_usd: r.high,
      token_odds: r.odds,
      verdict: r.verdict,
      airdrop_slice_usd: r.sliceUsd,
      estimated_farmers: r.farmers,
      fees_usd: r.feesUsd,
      net_of_fees_usd: r.netUsd,
      hours: r.hours,
      net_per_hour_usd: r.netHour,
    })),
  };
  writeFileSync(join(outDir, "board.json"), JSON.stringify(boardJson, null, 2) + "\n");

  // data.js: everything the dashboard renders, including every measured number.
  const data = {
    meta: {
      asOf: snapshot.as_of,
      source: snapshot.source,
      floorUsd: snapshot.floor_usd,
      protocols: snapshot.protocols.length,
      watchlist: snapshot.watchlist.length,
      watchlistSlugs: snapshot.watchlist,
    },
    model: {
      formula: "implied = exp(a + b * ln TVL) * growth * age",
      fitA: Math.round(bt.fitA * 10000) / 10000,
      fitB: Math.round(bt.fitB * 10000) / 10000,
      fitN: bt.fitN,
    },
    backtest: {
      looMiss: Math.round(bt.looMiss * 100) / 100,
      looMedianRatio: Math.round(bt.looMedianRatio * 100) / 100,
      looKept: bt.looKept,
      looNotKept: bt.looNotKept,
      intervalHit: Math.round(bt.intervalHit * 1000) / 1000,
      wfMiss: Math.round(bt.wfMiss * 100) / 100,
      wfFlat: Math.round(bt.wfFlat * 100) / 100,
      wfTrain: bt.wfTrain,
      wfTest: bt.wfTest,
      wfNotKept: bt.wfNotKept,
      brierFlat: Math.round(bt.brierFlat * 10000) / 10000,
      brierCategory: Math.round(bt.brierCategory * 10000) / 10000,
      flatRate: Math.round(bt.flatRate * 1000) / 1000,
      altMedianMiss: Math.round(bt.altMedianMiss * 100) / 100,
      altP25Miss: Math.round(bt.altP25Miss * 100) / 100,
    },
    ledger: board.ledger,
    kpis: {
      ranked: rows.length,
      totalImplied: board.totalImplied,
      farmCount: board.farmCount,
      bestNetHour: board.bestNetHour,
      checksum: board.checksum,
    },
    rows,
  };
  writeFileSync(
    join(outDir, "data.js"),
    `window.RADAR = ${JSON.stringify(data, null, 2)};\n`,
  );

  // The dashboard and the screenshots ship exactly as they are in the repo.
  cpSync("dashboard", join(outDir, "dashboard"), { recursive: true });
  if (existsSync("screenshots")) {
    cpSync("screenshots", join(outDir, "screenshots"), { recursive: true });
  }

  const dossier = buildDossier(outDir, { text_max_bytes: 65536 });
  writeFileSync(join(outDir, "dossier.json"), dossier);

  console.log(`rows: ${rows.length} (watchlist ${snapshot.watchlist.length}/40)`);
  console.log(`top: ${rows[0]!.name} $${rows[0]!.implied.toLocaleString("en-US")}`);
  console.log(`total implied: $${board.totalImplied.toLocaleString("en-US")}`);
  console.log(`fit: ln(mcap) = ${bt.fitA.toFixed(4)} + ${bt.fitB.toFixed(4)} ln(TVL), n=${bt.fitN}`);
  console.log(`LOO MISS x${bt.looMiss.toFixed(2)} (kept ${bt.looKept}, not kept ${bt.looNotKept}), interval hit ${(bt.intervalHit * 100).toFixed(0)}%`);
  console.log(`walk-forward MISS x${bt.wfMiss.toFixed(2)} vs flat x${bt.wfFlat.toFixed(2)} (train ${bt.wfTrain}, test ${bt.wfTest})`);
  console.log(`Brier flat ${bt.brierFlat.toFixed(4)} vs category ${bt.brierCategory.toFixed(4)}`);
  console.log(`ledger: ${ledgerSum} of ${board.ledger.total} accounted for`);
  console.log(`checksum: ${board.checksum}`);
  console.log(`dossier: ${dossier.length} bytes`);
}

main();
