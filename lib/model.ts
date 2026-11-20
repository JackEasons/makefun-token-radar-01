// radar-3 model: log-log regression fit on launched tokens, out-of-sample tested.
// Every number the board shows is computed here from the snapshot at run time:
// no protocol name, multiple or total is typed in. The regression is fit on the
// 128 tokenised protocols with a positive market cap and TVL; the leave-one-out
// and walk-forward backtests refit it without the protocol being scored, so the
// error the dashboard prints is measured, not asserted.

export interface SnapshotProtocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

export interface Row {
  rank: number;
  slug: string;
  name: string;
  category: string;
  chain: string;
  tvl: number;
  change7d: number | null;
  ageYears: number;
  fitted: number;
  growth: number;
  ageFactor: number;
  implied: number;
  low: number;
  high: number;
  odds: number;
  verdict: "FARM" | "MARGINAL" | "SKIP";
  sliceUsd: number;
  farmers: number;
  feesUsd: number;
  netUsd: number;
  hours: number;
  netHour: number;
  steps: string[];
}

export interface Backtest {
  fitA: number;
  fitB: number;
  fitN: number;
  looMiss: number;
  looMedianRatio: number;
  looKept: number;
  looNotKept: number;
  intervalHit: number;
  wfMiss: number;
  wfFlat: number;
  wfTrain: number;
  wfTest: number;
  wfNotKept: number;
  brierFlat: number;
  brierCategory: number;
  flatRate: number;
  altMedianMiss: number;
  altP25Miss: number;
}

export interface Ledger {
  ranked: number;
  tokenRecorded: number;
  excludedCategory: number;
  versionMarker: number;
  wrappedName: number;
  belowFloor: number;
  belowCutoff: number;
  total: number;
}

export interface Board {
  rows: Row[];
  ledger: Ledger;
  backtest: Backtest;
  totalImplied: number;
  checksum: string;
  farmCount: number;
  bestNetHour: number;
}

const EXCLUDED_CATEGORIES = new Set([
  "CEX",
  "Bridge",
  "Canonical Bridge",
  "Liquid Staking",
  "Liquid Restaking",
  "Restaked BTC",
]);

const EXCHANGE_PREFIXES = [
  "binance",
  "coinbase",
  "bybit",
  "kraken",
  "bitget",
  "okx",
  "bitfinex",
  "gemini",
];

const VERSION_MARKER = /\s(v2|v3|2\.0|3\.0)$/i;
const STEPS_PER_ROW = 8;
const AIRDROP_SLICE = 0.05;
const FEE_BASE_USD = 20;
const FEE_PER_STEP_USD = 4;
const HOURS_PER_STEP = 1.5;

export function ageYearsOf(p: SnapshotProtocol, asOf: string): number {
  if (!p.listed_at) return 0;
  const start = Date.parse(p.listed_at + "T00:00:00Z");
  const end = Date.parse(asOf + "T00:00:00Z");
  if (Number.isNaN(start) || Number.isNaN(end) || end <= start) return 0;
  return (end - start) / (365 * 86400000);
}

export function growthFactorOf(p: SnapshotProtocol): number {
  if (p.change_7d === null || p.change_7d === undefined) return 1;
  const c = Math.max(-20, Math.min(20, p.change_7d));
  return 1 + c / 100;
}

export function ageFactorOf(p: SnapshotProtocol, asOf: string): number {
  return 0.6 + (0.4 * Math.min(ageYearsOf(p, asOf), 3)) / 3;
}

export function isPriced(p: SnapshotProtocol): boolean {
  return (
    p.mcap_usd !== null &&
    p.mcap_usd !== undefined &&
    p.mcap_usd > 0 &&
    p.tvl_usd !== null &&
    p.tvl_usd !== undefined &&
    p.tvl_usd > 0
  );
}

/** Ordinary least squares for ln(mcap) = a + b * ln(tvl). */
export function fitRegression(rows: SnapshotProtocol[]): { a: number; b: number } {
  let n = 0;
  let sx = 0;
  let sy = 0;
  let sxx = 0;
  let sxy = 0;
  for (const p of rows) {
    const x = Math.log(p.tvl_usd);
    const y = Math.log(p.mcap_usd as number);
    n += 1;
    sx += x;
    sy += y;
    sxx += x * x;
    sxy += x * y;
  }
  const mx = sx / n;
  const my = sy / n;
  const b = (sxy - n * mx * my) / (sxx - n * mx * mx);
  return { a: my - b * mx, b };
}

export function fittedMcap(
  p: SnapshotProtocol,
  fit: { a: number; b: number },
): number {
  return Math.exp(fit.a + fit.b * Math.log(Math.max(p.tvl_usd, 1)));
}

export function impliedValue(
  p: SnapshotProtocol,
  fit: { a: number; b: number },
  asOf: string,
): number {
  return fittedMcap(p, fit) * growthFactorOf(p) * ageFactorOf(p, asOf);
}

function median(values: number[]): number {
  const sorted = [...values].sort((x, y) => x - y);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? sorted[mid]!
    : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

function quantile(values: number[], q: number): number {
  const sorted = [...values].sort((x, y) => x - y);
  return sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))]!;
}

export function backtest(snapshot: Snapshot): Backtest {
  const priced = snapshot.protocols.filter(isPriced);
  const fit = fitRegression(priced);
  const flatRate =
    snapshot.protocols.filter((p) => p.mcap_usd !== null).length /
    snapshot.protocols.length;

  // Leave-one-out: refit without the protocol being scored, then predict it.
  const looErrors: number[] = [];
  const looRatios: number[] = [];
  for (let i = 0; i < priced.length; i++) {
    const rest = priced.filter((_, j) => j !== i);
    const f = fitRegression(rest);
    const p = priced[i]!;
    const pred = impliedValue(p, f, snapshot.as_of);
    looErrors.push(Math.abs(Math.log(pred / (p.mcap_usd as number))));
    looRatios.push(pred / (p.mcap_usd as number));
  }
  const looMiss = Math.exp(median(looErrors));
  const looMedianRatio = median(looRatios);
  const intervalHit =
    priced.filter((p) => {
      const v = impliedValue(p, fit, snapshot.as_of);
      return v / looMiss <= (p.mcap_usd as number) && (p.mcap_usd as number) <= v * looMiss;
    }).length / priced.length;

  // Walk-forward: fit on protocols listed before 2025-06-01, test the rest.
  const dated = priced.filter((p) => p.listed_at);
  const train = dated.filter((p) => (p.listed_at as string) < "2025-06-01");
  const test = dated.filter((p) => (p.listed_at as string) >= "2025-06-01");
  const trainFit = fitRegression(train);
  const trainMedian =
    median(train.map((p) => (p.mcap_usd as number) / p.tvl_usd)) || 0;
  const wfErrors: number[] = [];
  const wfFlatErrors: number[] = [];
  for (const p of test) {
    const pred = impliedValue(p, trainFit, snapshot.as_of);
    wfErrors.push(Math.abs(Math.log(pred / (p.mcap_usd as number))));
    wfFlatErrors.push(
      Math.abs(Math.log((p.tvl_usd * trainMedian) / (p.mcap_usd as number))),
    );
  }
  const wfMiss = wfErrors.length > 0 ? Math.exp(median(wfErrors)) : 0;
  const wfFlat = wfFlatErrors.length > 0 ? Math.exp(median(wfFlatErrors)) : 0;

  // Brier score for "does this protocol record a token": flat base rate vs
  // the leave-one-out rate of its own category. Neither is used for ranking.
  const byCategory = new Map<string, SnapshotProtocol[]>();
  for (const p of snapshot.protocols) {
    const key = p.category ?? "(none)";
    const list = byCategory.get(key) ?? [];
    list.push(p);
    byCategory.set(key, list);
  }
  let brierFlatSum = 0;
  let brierCategorySum = 0;
  for (const p of snapshot.protocols) {
    const y = p.mcap_usd !== null ? 1 : 0;
    brierFlatSum += (flatRate - y) * (flatRate - y);
    const peers = (byCategory.get(p.category ?? "(none)") ?? []).filter(
      (q) => q !== p,
    );
    const rate =
      peers.length > 0
        ? peers.filter((q) => q.mcap_usd !== null).length / peers.length
        : flatRate;
    brierCategorySum += (rate - y) * (rate - y);
  }
  const n = snapshot.protocols.length;

  // Same leave-one-out loop with the two multiple estimators the radar-2
  // model used (category median and lower quartile, clamped 0.05-1.0), so the
  // dashboard can show why the regression won instead of asserting it.
  const allRatios = priced
    .map((p) => (p.mcap_usd as number) / p.tvl_usd)
    .sort((x, y) => x - y);
  const overallMedian = median(allRatios);
  const overallP25 = allRatios[Math.floor(allRatios.length / 4)]!;
  const looMissFor = (kind: "median" | "p25"): number => {
    const errs: number[] = [];
    for (let i = 0; i < priced.length; i++) {
      const p = priced[i]!;
      const others = priced
        .filter((_, j) => j !== i && _.category === p.category)
        .map((q) => (q.mcap_usd as number) / q.tvl_usd)
        .sort((x, y) => x - y);
      let m: number;
      if (others.length >= 3) {
        m =
          kind === "median"
            ? median(others)
            : others[Math.floor(others.length / 4)]!;
      } else {
        m = kind === "median" ? overallMedian : overallP25;
      }
      m = Math.min(Math.max(m, 0.05), 1.0);
      const pred =
        p.tvl_usd * m * growthFactorOf(p) * ageFactorOf(p, snapshot.as_of);
      errs.push(Math.abs(Math.log(pred / (p.mcap_usd as number))));
    }
    return Math.exp(median(errs));
  };
  const altMedianMiss = looMissFor("median");
  const altP25Miss = looMissFor("p25");

  return {
    fitA: fit.a,
    fitB: fit.b,
    fitN: priced.length,
    looMiss,
    looMedianRatio,
    looKept: priced.length,
    looNotKept:
      snapshot.protocols.filter((p) => p.mcap_usd !== null).length -
      priced.length,
    intervalHit,
    wfMiss,
    wfFlat,
    wfTrain: train.length,
    wfTest: test.length,
    wfNotKept: priced.length - train.length - test.length,
    brierFlat: brierFlatSum / n,
    brierCategory: brierCategorySum / n,
    flatRate,
    altMedianMiss,
    altP25Miss,
  };
}

/** The house watchlist rule, re-applied so the ledger can name every protocol. */
export function exclusionReason(
  p: SnapshotProtocol,
): "category" | "version" | "wrapped" | null {
  if (EXCLUDED_CATEGORIES.has(p.category ?? "")) return "category";
  const name = p.name.toLowerCase();
  if (
    name.includes("wrapped") ||
    name.includes("staked") ||
    name.includes("staking") ||
    EXCHANGE_PREFIXES.some((prefix) => name.startsWith(prefix))
  ) {
    return "wrapped";
  }
  if (VERSION_MARKER.test(p.name)) return "version";
  return null;
}

const FAMILY_ACTIONS: Record<string, [string, string]> = {
  Lending: [
    "Supply $100-$500 of USDC and ETH as collateral in the lending market, then borrow a small amount against it and repay it in full to log a complete borrow cycle",
    "Leave the supply position open for at least 4 weeks and top it up once; lenders that stay supplied through a full month score better than one-day deposits",
  ],
  Dexs: [
    "Swap $50-$100 through the pool on the main chain, then add the same pair as liquidity for at least 2 weeks and collect the fees",
    "Route a second swap a week later from a different token so the address shows repeat trading, not a single pass-through",
  ],
  Yield: [
    "Deposit $100-$300 into the highest-TVL vault and let it compound for 4-8 weeks without withdrawing",
    "Harvest or restake the yield once mid-way through the period so the address shows an active claim, not a dormant deposit",
  ],
  "Yield Aggregator": [
    "Deposit $100-$300 into the highest-TVL vault and let it compound for 4-8 weeks without withdrawing",
    "Harvest or restake the yield once mid-way through the period so the address shows an active claim, not a dormant deposit",
  ],
  RWA: [
    "Buy $100-$250 of the tokenised asset on the main chain and hold it for at least a month",
    "Reinvest one payout or coupon back into the same asset so the address shows compounding rather than a single purchase",
  ],
  Derivatives: [
    "Open a small $25-$75 perpetual position with low leverage, close it, then open a second one a week later",
    "Keep total exposure under $200 while learning the market; the point is repeated use, not size",
  ],
  CDP: [
    "Lock $150-$400 of collateral and mint a small amount of the stablecoin against it, then repay part of the debt",
    "Keep the collateral ratio comfortably above the liquidation line for the whole month",
  ],
  "Basis Trading": [
    "Mint or buy $100-$250 of the yield-bearing dollar on the main chain and hold it for 4-8 weeks",
    "Stake it in the official staking contract if one is listed, and claim the yield once mid-way",
  ],
  "Risk Curators": [
    "Allocate $100-$300 to the curator vault with the largest TVL and leave it for 4-8 weeks",
    "Reallocate a small slice to a second vault mid-way so the address shows active curation, not a single deposit",
  ],
  Restaking: [
    "Restake $100-$300 of liquid staking tokens through the protocol and hold the position for a month",
    "Delegate to a second operator once, then leave both positions untouched for the rest of the period",
  ],
  "Liquid Restaking": [
    "Restake $100-$300 of liquid staking tokens through the protocol and hold the position for a month",
    "Delegate to a second operator once, then leave both positions untouched for the rest of the period",
  ],
  Bridge: [
    "Bridge $25-$75 to a second chain through the official bridge and bridge a smaller amount back a week later",
    "Use the bridge at least three times across the month on different days",
  ],
  "Cross Chain Bridge": [
    "Bridge $25-$75 to a second chain through the official bridge and bridge a smaller amount back a week later",
    "Use the bridge at least three times across the month on different days",
  ],
  "Onchain Capital Allocator": [
    "Allocate $100-$300 to the largest vault and leave it for 4-8 weeks",
    "Reallocate a small slice to a second vault mid-way so the address shows active allocation, not a single deposit",
  ],
};

function familyActions(category: string): [string, string] {
  return (
    FAMILY_ACTIONS[category] ?? [
      "Use the protocol on its main chain with $50-$200: make the core action it exists for, then repeat it a week later",
      "Try a second feature of the same protocol in the same month so the address shows more than one interaction type",
    ]
  );
}

export function farmSteps(p: SnapshotProtocol): string[] {
  const chain = p.chains && p.chains.length > 0 ? p.chains[0]! : "Ethereum";
  const [act1, act2] = familyActions(p.category ?? "");
  return [
    `Create a fresh wallet for ${p.name} farming on ${chain}; fund it with $100-$500 plus gas, and keep it separate from your main holdings`,
    act1,
    act2,
    `Use ${p.name} at least once a week for 4-8 weeks; airdrops reward repeated use over a single deposit, so keep the position open`,
    `Move $25-$50 through ${p.name} on ${chain} each week to add distinct active days to the address history`,
    `Follow ${p.name} on its official channels and finish any listed quests; save screenshots of completed tasks`,
    `Record every deposit, date and transaction hash in a sheet; claim windows are usually 30-90 days and unclaimed drops expire`,
    `Before claiming, check gas on ${chain} and verify the claim contract on ${p.name} official channels; never sign a blind token approval`,
  ];
}

/** FNV-1a 32-bit, so the dashboard can recompute it from the loaded rows. */
export function fnv1aHex(text: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

export function boardChecksum(rows: Row[]): string {
  return fnv1aHex(rows.map((r) => `${r.rank}:${r.slug}:${r.implied}`).join("|"));
}

export function buildBoard(snapshot: Snapshot): Board {
  const asOf = snapshot.as_of;
  const fit = fitRegression(snapshot.protocols.filter(isPriced));
  const bt = backtest(snapshot);
  const watch = new Set(snapshot.watchlist);

  const scored = snapshot.protocols.filter((p) => p.mcap_usd === null);
  const bySlug = new Map(scored.map((p) => [p.slug, p]));
  const watchRows = snapshot.watchlist
    .map((slug) => bySlug.get(slug))
    .filter((p): p is SnapshotProtocol => p !== undefined);
  const rest = scored
    .filter((p) => !watch.has(p.slug) && exclusionReason(p) === null)
    .sort((x, y) => {
      const d = impliedValue(y, fit, asOf) - impliedValue(x, fit, asOf);
      return d !== 0 ? d : x.slug < y.slug ? -1 : 1;
    });
  const picked = [...watchRows, ...rest.slice(0, 200 - watchRows.length)];
  picked.sort((x, y) => {
    const d = impliedValue(y, fit, asOf) - impliedValue(x, fit, asOf);
    return d !== 0 ? d : x.slug < y.slug ? -1 : 1;
  });

  // Farm economics first, so verdict quartiles come from the board itself.
  const withEcon = picked.map((p) => {
    const fitted = fittedMcap(p, fit);
    const growth = growthFactorOf(p);
    const ageF = ageFactorOf(p, asOf);
    const implied = Math.round(fitted * growth * ageF);
    const steps = farmSteps(p);
    const farmers = Math.min(
      100000,
      Math.max(500, Math.round(p.tvl_usd / 50000)),
    );
    const sliceUsd = implied * AIRDROP_SLICE;
    const feesUsd = FEE_BASE_USD + FEE_PER_STEP_USD * STEPS_PER_ROW;
    const netUsd = sliceUsd / farmers - feesUsd;
    const hours = STEPS_PER_ROW * HOURS_PER_STEP;
    return {
      p,
      fitted,
      growth,
      ageF,
      implied,
      steps,
      farmers,
      sliceUsd,
      feesUsd,
      netUsd,
      hours,
      netHour: netUsd / hours,
    };
  });
  const netHours = withEcon.map((r) => r.netHour).sort((x, y) => x - y);
  const q25 = quantile(netHours, 0.25);
  const q75 = quantile(netHours, 0.75);

  // Token odds: the sector's own tokenisation rate, smoothed toward the flat
  // rate. The backtest shows it has no out-of-sample edge over flat, so the
  // dashboard says so and never uses odds for ranking.
  const byCategory = new Map<string, SnapshotProtocol[]>();
  for (const p of snapshot.protocols) {
    const key = p.category ?? "(none)";
    const list = byCategory.get(key) ?? [];
    list.push(p);
    byCategory.set(key, list);
  }

  const rows: Row[] = withEcon.map((r, i) => {
    const p = r.p;
    const peers = byCategory.get(p.category ?? "(none)") ?? [];
    const k = peers.filter((q) => q.mcap_usd !== null).length;
    const odds = (k + 5 * bt.flatRate) / (peers.length + 5);
    const verdict =
      r.netUsd > 0 && r.netHour >= q75
        ? "FARM"
        : r.netUsd > 0 && r.netHour >= q25
          ? "MARGINAL"
          : "SKIP";
    return {
      rank: i + 1,
      slug: p.slug,
      name: p.name,
      category: p.category ?? "(none)",
      chain: p.chains && p.chains.length > 0 ? p.chains[0]! : "Ethereum",
      tvl: p.tvl_usd,
      change7d: p.change_7d,
      ageYears: Math.round(ageYearsOf(p, asOf) * 10) / 10,
      fitted: r.fitted,
      growth: r.growth,
      ageFactor: r.ageF,
      implied: r.implied,
      low: Math.round(r.implied / bt.looMiss),
      high: Math.round(r.implied * bt.looMiss),
      odds: Math.round(odds * 1000) / 1000,
      verdict,
      sliceUsd: Math.round(r.sliceUsd),
      farmers: r.farmers,
      feesUsd: r.feesUsd,
      netUsd: Math.round(r.netUsd * 100) / 100,
      hours: r.hours,
      netHour: Math.round(r.netHour * 100) / 100,
      steps: r.steps,
    };
  });

  // The ledger: every one of the 758 protocols lands in exactly one bucket.
  const rankedSlugs = new Set(rows.map((r) => r.slug));
  const ledger: Ledger = {
    ranked: rows.length,
    tokenRecorded: 0,
    excludedCategory: 0,
    versionMarker: 0,
    wrappedName: 0,
    belowFloor: 0,
    belowCutoff: 0,
    total: snapshot.protocols.length,
  };
  for (const p of snapshot.protocols) {
    if (rankedSlugs.has(p.slug)) continue;
    if (p.mcap_usd !== null) {
      ledger.tokenRecorded += 1;
      continue;
    }
    const reason = exclusionReason(p);
    if (reason === "category") ledger.excludedCategory += 1;
    else if (reason === "version") ledger.versionMarker += 1;
    else if (reason === "wrapped") ledger.wrappedName += 1;
    else if (p.tvl_usd < snapshot.floor_usd) ledger.belowFloor += 1;
    else ledger.belowCutoff += 1;
  }

  const totalImplied = rows.reduce((n, r) => n + r.implied, 0);
  return {
    rows,
    ledger,
    backtest: bt,
    totalImplied,
    checksum: boardChecksum(rows),
    farmCount: rows.filter((r) => r.verdict === "FARM").length,
    bestNetHour: Math.max(...rows.map((r) => r.netHour)),
  };
}
