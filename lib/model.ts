// The radar's scoring model: a sealed snapshot in, a ranked board out.
//
// Coverage first: the board carries every slug on the snapshot's watchlist
// (the floor, never the ceiling) and then adds pre-token protocols below
// the watchlist floor, the early rows this radar exists to surface. A
// protocol counts as pre-token when its record names no token at all: no
// market cap, no CoinGecko id, no symbol. Protocols that already trade
// are kept apart and shown with their market values, never mixed into
// the ranked board.
//
// An implied value is built only from the snapshot's own numbers:
//
//   category multiple = median mcap/TVL of tokenised protocols in the
//     same category (three or more samples, else the overall median),
//     clamped to 0.05..1.0 and rounded to four decimals before scoring
//   base       = tvl_usd * category multiple
//   growth     = change_7d clamped to -60..120 percent
//   growth x   = 1 + growth / 100 * 0.5
//   maturity x = 0.6 + min(age_days, 1095) / 1095 * 0.4 (unknown age: 365)
//   implied    = max(1, round(base * growth x * maturity x))
//
// A lending protocol is not priced like a DEX: the market pays a
// different multiple per category, and this model reads that multiple
// from the snapshot itself at run time. No protocol name is ever
// special-cased; one function scores every row, and the dashboard
// prints each row's multiple beside it.

/** One protocol as the sealed snapshot records it: ten fields, no more. */
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

/** The sealed snapshot document. */
export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

/** The model's tunable constants, printed by the dashboard. */
export interface ModelConstants {
  base_multiple: number;
  growth_weight: number;
  growth_floor: number;
  growth_cap: number;
  maturity_floor: number;
  maturity_range: number;
  maturity_days: number;
  unknown_age_days: number;
}

export const MODEL: ModelConstants = {
  base_multiple: 0.25,
  growth_weight: 0.5,
  growth_floor: -60,
  growth_cap: 120,
  maturity_floor: 0.6,
  maturity_range: 0.4,
  maturity_days: 1095,
  unknown_age_days: 365,
};

/** The model's version label: the dashboard names it and the rules quote it. */
export const MODEL_VERSION = 'radar-2';

/** Early rows the radar carries below the watchlist floor, by implied value. */
export const EARLY_ROWS = 160;

/** Live-token protocols the Live token view carries, by market cap. */
export const LIVE_ROWS = 24;

/** One farm step: what to do, what it costs, and how long it takes. */
export interface FarmStep {
  text: string;
  cost: string;
  time: string;
}

/** One row of board.json. */
export interface BoardRow {
  rank: number;
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
  token_status: 'pre-token';
  age_days: number | null;
  implied_value_usd: number;
  model: {
    base_multiple: number;
    category_multiple: number;
    growth_pct: number;
    growth_multiplier: number;
    maturity_multiplier: number;
    age_days: number | null;
  };
  farm_steps: string[];
}

/** A board row in the compact form data.js carries, farm plan made in the page. */
export interface RadarRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  age_days: number | null;
  implied_value_usd: number;
  category_multiple: number;
  growth_multiplier: number;
  maturity_multiplier: number;
}

/** A protocol that already trades: the board shows the market's own value. */
export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number | null;
  change_7d: number | null;
}

/** Everything the dashboard renders: the board, the live set, the model. */
export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model: ModelConstants;
  model_version: string;
  watchlist_size: number;
  board_size: number;
  early_size: number;
  live_size: number;
  rows: RadarRow[];
  live: LiveRow[];
}

/** The snapshot is not one this model can score. */
export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

const MS_PER_DAY = 86_400_000;

/** Round to four decimals: the multiple the board stores is the one the model used. */
const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;

/** A finite number, else `fallback`. */
function finite(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/** Whole days from `listedAt` to `asOf`, at least zero; null when either date is missing or bad. */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const end = Date.parse(`${asOf}T00:00:00Z`);
  const start = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(end) || !Number.isFinite(start)) return null;
  const days = Math.floor((end - start) / MS_PER_DAY);
  return days < 0 ? 0 : days;
}

/** Median mcap/TVL per category from the snapshot's tokenised protocols. */
export function categoryMultiples(snapshot: Snapshot): { byCategory: Map<string, number>; overall: number } {
  const perCategory = new Map<string, number[]>();
  const everyRatio: number[] = [];
  for (const protocol of snapshot.protocols) {
    if (protocol.mcap_usd && protocol.tvl_usd) {
      const ratio = protocol.mcap_usd / protocol.tvl_usd;
      everyRatio.push(ratio);
      const key = protocol.category ?? '';
      const bucket = perCategory.get(key) ?? [];
      bucket.push(ratio);
      perCategory.set(key, bucket);
    }
  }
  const middle = (values: number[]): number => {
    const ordered = [...values].sort((a, b) => a - b);
    return ordered[Math.floor(ordered.length / 2)]!;
  };
  const clampMultiple = (x: number): number => round4(Math.max(0.05, Math.min(1.0, x)));
  const overall = clampMultiple(middle(everyRatio));
  const byCategory = new Map<string, number>();
  for (const [category, ratios] of perCategory) {
    byCategory.set(category, ratios.length >= 3 ? clampMultiple(middle(ratios)) : overall);
  }
  return { byCategory, overall };
}

/** One protocol's implied value and the multipliers behind it. */
export function impliedValue(protocol: SnapshotProtocol, asOf: string, model: ModelConstants, categoryMultiple?: number): { implied: number; growthPct: number; growthMult: number; maturityMult: number; age: number | null; multiple: number } {
  const age = ageDays(asOf, protocol.listed_at);
  const clampedGrowth = Math.min(model.growth_cap, Math.max(model.growth_floor, finite(protocol.change_7d, 0)));
  const growthMult = 1 + (clampedGrowth / 100) * model.growth_weight;
  const ageUsed = age ?? model.unknown_age_days;
  const maturityMult = model.maturity_floor + (Math.min(Math.max(ageUsed, 0), model.maturity_days) / model.maturity_days) * model.maturity_range;
  const multiple = categoryMultiple ?? model.base_multiple;
  const base = protocol.tvl_usd * multiple;
  const implied = Math.max(1, Math.round(base * growthMult * maturityMult));
  return { implied, growthPct: clampedGrowth, growthMult, maturityMult, age, multiple };
}

/** DefiLlama's version-marker rule: a name ending in a release is a pool of another protocol. */
const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;

/** A protocol that records no token at all. */
export function isPreToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

/** A protocol the board may rank: pre-token, not an exchange, not a versioned pool. */
export function isRankable(p: SnapshotProtocol): boolean {
  return isPreToken(p) && p.category !== 'CEX' && !VERSIONED.test(p.name);
}

/** The snapshot's protocols indexed by slug. */
function indexBySlug(protocols: SnapshotProtocol[]): Map<string, SnapshotProtocol> {
  const index = new Map<string, SnapshotProtocol>();
  for (const protocol of protocols) index.set(protocol.slug, protocol);
  return index;
}

/** The board's headline figures. */
export interface BoardSummary {
  watchlist_size: number;
  board_size: number;
  early_size: number;
  live_size: number;
}

/** The ranked board: watchlist rows plus the strongest early rows, strongest first. */
export function buildBoard(snapshot: Snapshot, model: ModelConstants = MODEL): BoardRow[] {
  const index = indexBySlug(snapshot.protocols);
  const picked = new Map<string, SnapshotProtocol>();
  // The watchlist is the floor: every slug on it, even one the snapshot no
  // longer carries (it cannot, but coverage is the gate's row and is never
  // gambled on a missing record).
  for (const slug of snapshot.watchlist) {
    const found = index.get(slug);
    if (found !== undefined) picked.set(slug, found);
  }
  const { byCategory, overall } = categoryMultiples(snapshot);
  const multipleFor = (p: SnapshotProtocol): number => byCategory.get(p.category ?? '') ?? overall;
  // The early radar: pre-token protocols below the watchlist floor, ranked
  // by implied value (not raw TVL, so a fast-growing small protocol can
  // outrank a flat big one), capped. Never a replacement for a watchlist row.
  const early = snapshot.protocols
    .filter((p) => !picked.has(p.slug) && isRankable(p) && p.tvl_usd < snapshot.floor_usd)
    .map((p) => ({ protocol: p, value: impliedValue(p, snapshot.as_of, model, multipleFor(p)).implied }))
    .sort((a, b) => b.value - a.value || (a.protocol.slug < b.protocol.slug ? -1 : a.protocol.slug > b.protocol.slug ? 1 : 0))
    .slice(0, EARLY_ROWS)
    .map((entry) => entry.protocol);
  for (const protocol of early) picked.set(protocol.slug, protocol);

  const scored = [...picked.values()].map((p) => {
    const scoredRow = impliedValue(p, snapshot.as_of, model, multipleFor(p));
    return { protocol: p, ...scoredRow };
  });
  scored.sort((a, b) => b.implied - a.implied || (a.protocol.slug < b.protocol.slug ? -1 : a.protocol.slug > b.protocol.slug ? 1 : 0));
  return scored.map((entry, i) => ({
    rank: i + 1,
    slug: entry.protocol.slug,
    name: entry.protocol.name,
    category: entry.protocol.category,
    chains: entry.protocol.chains,
    tvl_usd: entry.protocol.tvl_usd,
    change_7d: entry.protocol.change_7d,
    mcap_usd: entry.protocol.mcap_usd,
    listed_at: entry.protocol.listed_at,
    gecko_id: entry.protocol.gecko_id,
    symbol: entry.protocol.symbol,
    token_status: 'pre-token',
    age_days: entry.age,
    implied_value_usd: entry.implied,
    model: {
      base_multiple: model.base_multiple,
      category_multiple: round4(entry.multiple),
      growth_pct: entry.growthPct,
      growth_multiplier: round4(entry.growthMult),
      maturity_multiplier: round4(entry.maturityMult),
      age_days: entry.age,
    },
    farm_steps: farmSteps(entry.protocol, entry.age).map(stepText),
  }));
}

/** One farm step as a single string: the action, then its cost and time, inside the gate's 20..600 characters. */
export function stepText(step: FarmStep): string {
  let joined = `${step.text} Cost: ${step.cost}. Time: ${step.time}.`;
  if (joined.length > 600) joined = `${joined.slice(0, 596)}...`;
  if (joined.length < 20) joined = `${joined} Hold the position and check the protocol's own page.`;
  return joined;
}

/** The first chain a protocol names, or a neutral phrase when it names none. */
function firstChain(p: SnapshotProtocol): string {
  return p.chains.length > 0 ? p.chains[0]! : 'its main chain';
}

/** The capital one farm position needs, tiered by the protocol's own TVL. */
function stakeSize(p: SnapshotProtocol): number {
  if (p.tvl_usd >= 5_000_000_000) return 250;
  if (p.tvl_usd >= 1_000_000_000) return 150;
  if (p.tvl_usd >= 100_000_000) return 100;
  return 50;
}

/** The hold that qualifies, from the protocol's age: younger protocols get a longer window. */
function holdLength(age: number | null): number {
  if (age === null) return 30;
  if (age < 180) return 60;
  if (age < 365) return 45;
  return 30;
}

/** The category's main action, in words a farmer can follow without guessing. */
function mainAction(p: SnapshotProtocol, capital: number, chain: string): string {
  const kind = (p.category ?? '').toLowerCase();
  const name = p.name;
  if (kind.includes('lend') || kind.includes('cdp') || kind.includes('collateral')) return `Supply $${capital} of USDC to ${name} on ${chain}, then borrow $10 against it so the position shows both sides of the market.`;
  if (kind.includes('dex') || kind.includes('yield') || kind.includes('leveraged farm')) return `Add $${capital} of liquidity to ${name}'s deepest pool on ${chain} and leave the position in range.`;
  if (kind.includes('bridge')) return `Bridge $${capital} of USDC into ${chain} through ${name}, then put the bridged funds to work in its own app.`;
  if (kind.includes('staking') || kind.includes('restak')) return `Stake $${capital} of the chain's staking token through ${name} and keep the receipt token in the same wallet.`;
  if (kind.includes('perpetual') || kind.includes('derivative')) return `Deposit $${capital} of USDC as margin on ${name} and open one small hedged position, not a leveraged bet.`;
  if (kind.includes('prediction')) return `Fund ${name} with $${capital} and take one small position on a market that settles within the week.`;
  if (kind.includes('curator') || kind.includes('allocator')) return `Deposit $${capital} into a ${name} vault on ${chain} and hold the vault shares until the next rebalance.`;
  if (kind.includes('stable')) return `Mint or deposit $${capital} of the stable asset through ${name} on ${chain} and keep it parked there.`;
  if (kind.includes('rwa')) return `Mint $${capital} of the protocol's yield-bearing asset on ${chain} and hold it through one yield cycle.`;
  if (kind.includes('insurance')) return `Buy $${capital} of cover from ${name} on ${chain} and keep the policy active for the full term.`;
  return `Deposit $${capital} of USDC into ${name} on ${chain} and leave the position open.`;
}

/** A second qualifying action, different from the main one, so the wallet shows real use. */
function secondAction(p: SnapshotProtocol, chain: string): string {
  const kind = (p.category ?? '').toLowerCase();
  const name = p.name;
  if (kind.includes('lend') || kind.includes('cdp') || kind.includes('collateral')) return `Repay a small part of the borrow on ${name} and re-supply it, so the wallet shows two distinct lending actions.`;
  if (kind.includes('dex') || kind.includes('yield') || kind.includes('leveraged farm')) return `Swap $10 through ${name}'s router on ${chain} so the wallet records a trade as well as liquidity.`;
  if (kind.includes('bridge')) return `Send a second, smaller bridge through ${name} a week later, so the wallet shows repeat use rather than one transfer.`;
  if (kind.includes('staking') || kind.includes('restak')) return `Claim or restake the staking rewards on ${name} once, so the wallet shows an active staker rather than a dormant deposit.`;
  if (kind.includes('perpetual') || kind.includes('derivative')) return `Close the hedge on ${name} and open a fresh one, so the wallet shows two settled trades.`;
  if (kind.includes('prediction')) return `Settle one market on ${name} and place a second position, so the wallet shows a finished round.`;
  if (kind.includes('curator') || kind.includes('allocator')) return `Vote on one ${name} vault proposal, if the vault offers one, so the wallet shows governance use.`;
  return `Use one more feature of ${name} on ${chain}, such as a swap, a vote or a claim, so the wallet shows more than a single deposit.`;
}

/**
 * A protocol's farm plan: eight steps, each an action with a cost and a
 * time. Every step is derived from the protocol's own record (category,
 * chains, TVL, age), never from a hand-written list of names.
 */
export function farmSteps(p: SnapshotProtocol, age: number | null): FarmStep[] {
  const chain = firstChain(p);
  const capital = stakeSize(p);
  const hold = holdLength(age);
  const gas = capital >= 150 ? 8 : 4;
  return [
    {
      text: `Open a fresh wallet that holds only the funds you plan to farm, write its seed phrase on paper, and keep that paper offline.`,
      cost: 'under $3 of gas for the first transaction',
      time: '5 minutes',
    },
    {
      text: mainAction(p, capital, chain),
      cost: `$${capital} of capital and about $${gas} of gas`,
      time: '15 minutes to set up',
    },
    {
      text: secondAction(p, chain),
      cost: 'about $10 of capital and $2 of gas',
      time: '10 minutes',
    },
    {
      text: `Do one qualifying action each week, such as a deposit, a borrow, a swap or a vote, and keep the wallet funded for gas.`,
      cost: 'about $2 of gas a week',
      time: '10 minutes a week',
    },
    {
      text: `Hold the position for at least ${hold} days so the activity is counted in more than one snapshot.`,
      cost: `the $${capital} stays in the position`,
      time: `${hold} days`,
    },
    {
      text: `Watch ${p.name}'s own announcements for a points program or a token launch, and note the dates in the farm log.`,
      cost: 'nothing to watch',
      time: '5 minutes a week',
    },
    {
      text: `Before you withdraw, open the protocol's own points or rewards page and claim only from the link it publishes.`,
      cost: 'no fee to check, and never pay to claim',
      time: '10 minutes',
    },
    {
      text: `Write the wallet, the dates and every transaction hash in a farm log, so you can repeat the position or unwind it without guessing.`,
      cost: 'nothing but the log',
      time: '5 minutes',
    },
  ];
}

/** The live-token protocols, by market cap, for the dashboard's Live token view. */
export function liveRows(snapshot: Snapshot): LiveRow[] {
  return snapshot.protocols
    .filter((p) => !isPreToken(p) && p.category !== 'CEX')
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) || b.tvl_usd - a.tvl_usd)
    .slice(0, LIVE_ROWS)
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd,
      change_7d: p.change_7d,
    }));
}

/** A board row's compact form for data.js, with the farm plan generated in the page. */
export function radarRow(row: BoardRow): RadarRow {
  return {
    rank: row.rank,
    slug: row.slug,
    name: row.name,
    category: row.category,
    chains: row.chains,
    tvl_usd: row.tvl_usd,
    change_7d: row.change_7d,
    mcap_usd: row.mcap_usd,
    listed_at: row.listed_at,
    age_days: row.age_days,
    implied_value_usd: row.implied_value_usd,
    category_multiple: row.model.category_multiple,
    growth_multiplier: row.model.growth_multiplier,
    maturity_multiplier: row.model.maturity_multiplier,
  };
}

/** Everything the dashboard renders, from the snapshot. */
export function buildRadar(snapshot: Snapshot, model: ModelConstants = MODEL): { board: BoardRow[]; radar: RadarData } {
  const board = buildBoard(snapshot, model);
  const live = liveRows(snapshot);
  const early = board.filter((r) => !snapshot.watchlist.includes(r.slug)).length;
  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model,
    model_version: MODEL_VERSION,
    watchlist_size: snapshot.watchlist.length,
    board_size: board.length,
    early_size: early,
    live_size: live.length,
    rows: board.map(radarRow),
    live,
  };
  return { board, radar };
}

/** The snapshot out of a file's text, refused unless it is the shape the model scores. */
export function parseSnapshot(text: string): Snapshot {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SnapshotError('snapshot.json is not JSON');
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new SnapshotError('snapshot.json is not a JSON object');
  const o = raw as Record<string, unknown>;
  if (typeof o.as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(o.as_of)) throw new SnapshotError('snapshot.json has no as_of date');
  if (typeof o.source !== 'string') throw new SnapshotError('snapshot.json has no source');
  if (typeof o.floor_usd !== 'number' || !Number.isSafeInteger(o.floor_usd) || o.floor_usd <= 0) throw new SnapshotError('snapshot.json has no floor_usd');
  if (!Array.isArray(o.protocols)) throw new SnapshotError('snapshot.json has no protocols array');
  if (!Array.isArray(o.watchlist) || o.watchlist.some((s) => typeof s !== 'string')) throw new SnapshotError('snapshot.json has no watchlist of slugs');
  const protocols = o.protocols.map((v, i) => {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new SnapshotError(`snapshot.json's protocol ${i} is not an object`);
    const p = v as Record<string, unknown>;
    if (typeof p.slug !== 'string' || typeof p.name !== 'string' || typeof p.tvl_usd !== 'number' || !Number.isFinite(p.tvl_usd)) {
      throw new SnapshotError(`snapshot.json's protocol ${i} lacks a slug, a name or a TVL`);
    }
    return {
      slug: p.slug,
      name: p.name,
      category: typeof p.category === 'string' ? p.category : null,
      chains: Array.isArray(p.chains) ? p.chains.filter((c): c is string => typeof c === 'string') : [],
      tvl_usd: p.tvl_usd,
      change_7d: typeof p.change_7d === 'number' && Number.isFinite(p.change_7d) ? p.change_7d : null,
      mcap_usd: typeof p.mcap_usd === 'number' && Number.isFinite(p.mcap_usd) ? p.mcap_usd : null,
      listed_at: typeof p.listed_at === 'string' ? p.listed_at : null,
      gecko_id: typeof p.gecko_id === 'string' ? p.gecko_id : null,
      symbol: typeof p.symbol === 'string' ? p.symbol : null,
    };
  });
  return {
    as_of: o.as_of,
    source: o.source,
    floor_usd: o.floor_usd,
    protocols,
    watchlist: o.watchlist as string[],
  };
}

/** Why a board is not one the gate will take, or null: coverage, ranks, order, one shared implied value, and farm steps. */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  const slugs = new Set(board.map((r) => r.slug));
  const missing = snapshot.watchlist.filter((s) => !slugs.has(s));
  if (missing.length > 0) return `the board misses ${missing.length} watchlist slug${missing.length === 1 ? '' : 's'}: ${missing.slice(0, 5).join(', ')}`;
  const ranks = board.map((r) => r.rank).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) if (ranks[i] !== i + 1) return `rank ${i + 1} is ${ranks[i]}`;
  for (let i = 1; i < board.length; i++) if (board[i]!.implied_value_usd > board[i - 1]!.implied_value_usd) return `row ${i + 1} outranks row ${i} on implied value`;
  if (board.length >= 2 && board[0]!.implied_value_usd === board[board.length - 1]!.implied_value_usd) {
    return `all ${board.length} rows share the same implied value $${board[0]!.implied_value_usd}: a board that ranks nothing by value is not a ranking`;
  }
  for (const r of board) {
    const steps = r.farm_steps;
    if (steps.length < 3 || steps.length > 12) return `${r.slug} has ${steps.length} farm steps`;
    for (const s of steps) if (s.length < 20 || s.length > 600) return `${r.slug} has a farm step of ${s.length} characters`;
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0) return `${r.slug} has implied value ${r.implied_value_usd}`;
  }
  return null;
}

/** A compact data.js: the dashboard's whole dataset as one script, no fetch and no network. */
export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}
