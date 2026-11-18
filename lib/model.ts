// Token radar model: one snapshot of the protocol universe in, one ranked board out.
//
// The board ranks protocols that have not issued a token yet. Its floor is the snapshot's
// watchlist: every watchlist slug is always on the board. Below the watchlist's TVL floor the
// radar adds further pre-token protocols it finds itself (the "early" rows), so the board is a
// ranking of token candidates, not a copy of the watchlist.
//
// Implied value is priced the way the market already prices this snapshot's tokenized
// protocols. For every category, the model reads the market-cap / TVL multiples of the
// protocols in that category that DO have a token, takes the median, and shrinks it toward
// the snapshot-wide median in proportion to how few peers the category has:
//
//   peers      = tokenized protocols in the category (market cap present, TVL > 0)
//   multiple   = clamp( (peers * categoryMedian + 8 * globalMedian) / (peers + 8), 0.01, 2.5 )
//   base       = tvl_usd * multiple
//   growth     = 1 + clamp(change_7d, -60, 120) / 100 * 0.5      (a hot week is worth half its %)
//   maturity   = 0.7 + 0.5 * min(age_days, 1095) / 1095          (three years to full credit)
//   reach      = 1 + 0.04 * min(chains - 1, 5)                   (each extra chain, capped)
//   implied    = round(base * growth * maturity * reach)
//
// No protocol name is ever special-cased: the same function scores every row, and the
// dashboard states the formula and the peer table it came from, so any row can be re-priced
// by hand from the snapshot's own figures.
//
// A pre-token protocol is one whose record carries no token at all (no market cap, no
// CoinGecko id, no symbol). Early rows additionally leave out three classes that are not
// token candidates in any ordinary sense: centralised exchanges, canonical bridges (run by
// a chain's own foundation), and versioned deployments of a protocol whose token already
// trades (a name that ends in a version marker, or that extends a tokenized protocol's
// name). Watchlist rows are exempt from those filters: the watchlist is the floor.

/** The snapshot's protocol entry: exactly the ten fields the sealed input carries. */
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

/** The whole snapshot document. */
export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

/** The model's version label: the dashboard names it and the board's rows carry it. */
export const MODEL_VERSION = 'peer-multiple-2';

/** How many early (below-floor, self-found) rows the board carries at most. */
export const EARLY_ROWS = 180;

/** How many live-token protocols the comparison view carries, by market cap. */
export const LIVE_ROWS = 24;

/** Shrinkage: a category's median counts this many phantom peers at the global median. */
const SHRINK_PEERS = 8;
/** Applied multiples are clamped to this range: the snapshot's own outliers stop here. */
const MULT_FLOOR = 0.01;
const MULT_CAP = 2.5;
/** Growth: the 7-day change is clamped to this band, then half of it moves the price. */
const GROWTH_FLOOR = -60;
const GROWTH_CAP = 120;
const GROWTH_WEIGHT = 0.5;
/** Maturity: from MATURITY_BASE up by MATURITY_SPAN over MATURITY_DAYS days without a token. */
const MATURITY_BASE = 0.7;
const MATURITY_SPAN = 0.5;
const MATURITY_DAYS = 1095;
const UNKNOWN_AGE_DAYS = 365;
/** Reach: each chain past the first adds REACH_STEP, up to REACH_MAX extra chains. */
const REACH_STEP = 0.04;
const REACH_MAX = 5;

/** One category's peer evidence: how many tokenized peers, their median, what was applied. */
export interface CategoryMultiple {
  category: string;
  peers: number;
  median: number;
  applied: number;
}

/** The model's stated constants and the peer table, as the dashboard shows them. */
export interface ModelInfo {
  version: string;
  global_median: number;
  tokenized_peers: number;
  shrink_peers: number;
  mult_floor: number;
  mult_cap: number;
  growth_weight: number;
  categories: CategoryMultiple[];
}

/** One row of board.json: the ranked board's row. */
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
    category_multiple: number;
    category_peers: number;
    growth_multiplier: number;
    maturity_multiplier: number;
    reach_multiplier: number;
    age_days: number | null;
  };
  farm_steps: string[];
}

/** The dashboard's view of one board row: the row, its price build-up and its farm plan. */
export interface RadarRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  age_days: number | null;
  listed_at: string | null;
  watchlist: boolean;
  implied_value_usd: number;
  category_multiple: number;
  category_peers: number;
  growth_multiplier: number;
  maturity_multiplier: number;
  reach_multiplier: number;
  farm_steps: string[];
}

/** A live-token protocol: it already trades, so the board shows the market's own value. */
export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number | null;
  change_7d: number | null;
  multiple: number | null;
}

/** Everything the dashboard needs: the board, the live set, and the model it runs. */
export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  universe_size: number;
  pre_token_size: number;
  model: ModelInfo;
  watchlist_size: number;
  board_size: number;
  early_size: number;
  live_size: number;
  rows: RadarRow[];
  live: LiveRow[];
}

/** Why the snapshot is not one this model can score. */
export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

const DAY_MS = 86_400_000;

/** A finite number, else `fallback`. */
function finite(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/** A whole day count from `from` to `to`, clamped at zero; null when either date is absent or bad. */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

/** The median of a non-empty list of numbers. */
function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;
const bySlugAsc = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/** Whether a protocol records no token at all: no market cap, no CoinGecko id, no symbol. */
export function isPreToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

/** DefiLlama's version-marker rule: a name ending in a release is a deployment, not a parent. */
const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;

/**
 * Whether a pre-token protocol is a versioned child of a tokenized parent: its name ends in
 * a version marker, or it extends a tokenized protocol's name ("Morpho Blue" under "Morpho").
 */
export function isVersionedChild(p: SnapshotProtocol, tokenizedNames: Set<string>): boolean {
  if (VERSIONED.test(p.name)) return true;
  for (const parent of tokenizedNames) {
    if (p.name.length > parent.length && p.name.startsWith(`${parent} `)) return true;
  }
  return false;
}

/** Categories whose operators do not issue a governance token for the product itself. */
const NOT_CANDIDATE_CATEGORIES = new Set(['CEX', 'Canonical Bridge']);

/** Whether a protocol may appear as an early row: pre-token and an ordinary token candidate. */
export function isEarlyCandidate(p: SnapshotProtocol, tokenizedNames: Set<string>): boolean {
  if (!isPreToken(p)) return false;
  if (p.category !== null && NOT_CANDIDATE_CATEGORIES.has(p.category)) return false;
  return !isVersionedChild(p, tokenizedNames);
}

/** The peer table: per-category market-cap / TVL medians from the snapshot's tokenized set. */
export function categoryMultiples(snapshot: Snapshot): { info: ModelInfo; applied: Map<string, CategoryMultiple> } {
  const tokenized = snapshot.protocols.filter((p) => p.mcap_usd !== null && p.tvl_usd > 0);
  const globalMedian = tokenized.length > 0 ? median(tokenized.map((p) => p.mcap_usd! / p.tvl_usd)) : 0.169;
  const byCategory = new Map<string, number[]>();
  for (const p of tokenized) {
    if (p.category === null) continue;
    const list = byCategory.get(p.category) ?? [];
    list.push(p.mcap_usd! / p.tvl_usd);
    byCategory.set(p.category, list);
  }
  const applied = new Map<string, CategoryMultiple>();
  for (const [category, values] of byCategory) {
    const med = median(values);
    const shrunk = (values.length * med + SHRINK_PEERS * globalMedian) / (values.length + SHRINK_PEERS);
    applied.set(category, {
      category,
      peers: values.length,
      median: round4(med),
      applied: round4(Math.min(MULT_CAP, Math.max(MULT_FLOOR, shrunk))),
    });
  }
  const categories = [...applied.values()].sort((a, b) => b.peers - a.peers || bySlugAsc(a.category, b.category));
  return {
    info: {
      version: MODEL_VERSION,
      global_median: round4(globalMedian),
      tokenized_peers: tokenized.length,
      shrink_peers: SHRINK_PEERS,
      mult_floor: MULT_FLOOR,
      mult_cap: MULT_CAP,
      growth_weight: GROWTH_WEIGHT,
      categories,
    },
    applied,
  };
}

/** The price build-up one protocol gets: its category multiple and the three adjustments. */
export function priceOf(
  p: SnapshotProtocol,
  asOf: string,
  multiples: Map<string, CategoryMultiple>,
  globalMedian: number,
): { implied: number; multiple: number; peers: number; growthMult: number; maturityMult: number; reachMult: number; age: number | null } {
  const entry = p.category !== null ? multiples.get(p.category) : undefined;
  const multiple = entry !== undefined ? entry.applied : Math.min(MULT_CAP, Math.max(MULT_FLOOR, globalMedian));
  const peers = entry !== undefined ? entry.peers : 0;
  const growthPct = Math.min(GROWTH_CAP, Math.max(GROWTH_FLOOR, finite(p.change_7d, 0)));
  const growthMult = 1 + (growthPct / 100) * GROWTH_WEIGHT;
  const age = ageDays(asOf, p.listed_at);
  const ageForModel = age ?? UNKNOWN_AGE_DAYS;
  const maturityMult = MATURITY_BASE + (Math.min(Math.max(ageForModel, 0), MATURITY_DAYS) / MATURITY_DAYS) * MATURITY_SPAN;
  const reachMult = 1 + REACH_STEP * Math.min(Math.max(p.chains.length - 1, 0), REACH_MAX);
  const implied = Math.max(1, Math.round(p.tvl_usd * multiple * growthMult * maturityMult * reachMult));
  return { implied, multiple, peers, growthMult, maturityMult, reachMult, age };
}

// ------------------------------------------------------------------ farm plans
//
// Every plan is generated from the protocol's own record: its category picks the playbook,
// its chains pick the gas budget and the second position, its TVL picks the position size
// and its age picks the holding window. No plan names a protocol the record does not name.

/** The first chain a protocol names, or a neutral phrase. */
function chainOf(p: SnapshotProtocol): string {
  return p.chains.length > 0 ? p.chains[0]! : 'its main chain';
}

/** What one transaction roughly costs on a chain, in words a plan can carry. */
function gasWords(chain: string): string {
  if (chain === 'Ethereum') return 'about $25 in gas at ordinary mainnet fees';
  if (chain === 'Solana') return 'about $1 in network fees';
  if (chain === 'Bitcoin') return 'about $3 in network fees';
  return 'about $2 in gas on a layer-2 or low-fee chain';
}

/** Position size by the protocol's own TVL: bigger protocols absorb bigger test positions. */
function capitalFor(p: SnapshotProtocol): number {
  if (p.tvl_usd >= 1_000_000_000) return 500;
  if (p.tvl_usd >= 250_000_000) return 250;
  if (p.tvl_usd >= 50_000_000) return 100;
  return 50;
}

/** Holding window by age: younger protocols get the longer qualifying window. */
function holdDaysFor(age: number | null): number {
  if (age === null) return 45;
  if (age < 180) return 60;
  if (age < 365) return 45;
  if (age < 730) return 35;
  return 30;
}

/** The playbook group a category belongs to; unknown categories use the default book. */
function playbookOf(category: string | null): string {
  const c = (category ?? '').toLowerCase();
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral')) return 'lending';
  if (c.includes('dex')) return 'dex';
  if (c.includes('staking') || c.includes('restak')) return 'staking';
  if (c.includes('bridge')) return 'bridge';
  if (c.includes('derivative') || c.includes('option') || c.includes('prediction')) return 'derivatives';
  if (c.includes('curator') || c.includes('allocator') || c.includes('liquidity manager')) return 'curator';
  if (c.includes('rwa')) return 'rwa';
  if (c.includes('stable')) return 'stable';
  if (c === 'chain') return 'chain';
  if (c.includes('yield') || c.includes('farm') || c.includes('basis')) return 'yield';
  if (c.includes('insurance')) return 'insurance';
  return 'default';
}

/** The two core actions of a playbook, filled with the protocol's own facts. */
function coreActions(book: string, p: SnapshotProtocol, capital: number, chain: string): [string, string] {
  const name = p.name;
  const half = Math.max(25, Math.round(capital / 2));
  switch (book) {
    case 'lending':
      return [
        `Supply $${capital} of USDC to ${name} on ${chain}, then borrow about $${half} of USDC against it at under 40% loan-to-value and repay within the week, so both sides of the market see the wallet.`,
        `Keep the supply open and repeat the small borrow-and-repay cycle once a month; never let the health factor fall below 2.0, and add collateral instead of repaying in a hurry if prices move.`,
      ];
    case 'dex':
      return [
        `Add $${capital} of liquidity to ${name}'s highest-volume stable or ETH pool on ${chain}, split evenly between the two assets, and keep the position in range.`,
        `Route one swap of about $${half} through ${name} each week in each direction, so the wallet shows both liquidity and genuine trading volume.`,
      ];
    case 'staking':
      return [
        `Stake $${capital} of the chain's staking asset through ${name} on ${chain} and hold the liquid receipt token in the same wallet.`,
        `Put about $${half} of the receipt token to work in one integrated lending market or pool that ${name} lists, and leave the rest staked so the position reads as long-term.`,
      ];
    case 'bridge':
      return [
        `Bridge $${capital} of USDC from Ethereum to ${chain} through ${name}, then use the bridged funds in one app on the destination chain the same day.`,
        `Bridge about $${half} back or onward to a second destination once a month, varying the route; round trips inside one hour look like wash activity and are best avoided.`,
      ];
    case 'derivatives':
      return [
        `Deposit $${capital} of USDC as margin on ${name} and open one small hedged position (long and short the same asset on two venues, or a delta-neutral pair the app itself offers).`,
        `Trade about $${half} of notional volume a week in small clips and close the week flat or hedged, so the record shows real usage rather than one opening trade.`,
      ];
    case 'curator':
      return [
        `Deposit $${capital} of USDC into the largest ${name} vault on ${chain} and keep the vault shares untouched in the wallet.`,
        `Follow the curator's own reallocation notices: when the vault migrates or a new vault opens, move about $${half} into it within the first week so the wallet is counted among active depositors.`,
      ];
    case 'rwa':
      return [
        `Complete ${name}'s onboarding or KYC if it asks for it, then mint or subscribe $${capital} of its yield asset on ${chain} and hold it.`,
        `Hold through at least two full distribution or interest periods and claim each payout from the protocol's own page, so the wallet shows a complete holder cycle.`,
      ];
    case 'stable':
      return [
        `Mint or deposit $${capital} of the stable asset through ${name} on ${chain} and hold the issued token in the wallet.`,
        `Use about $${half} of the issued token in one pool or lending market ${name} integrates with, and keep the rest idle so both holding and usage are visible.`,
      ];
    case 'chain':
      return [
        `Bridge $${capital} of USDC or ETH to ${name}'s network and keep a working balance of its gas token in the wallet.`,
        `Use two or three native apps on the network each week (one swap, one lending deposit of about $${half}, one NFT or name-service action) so the wallet reads as a genuine early user of the chain.`,
      ];
    case 'insurance':
      return [
        `Buy $${capital} of cover from ${name} on ${chain} against a position you actually hold, and keep the policy to expiry.`,
        `Renew the cover once when it lapses, and register any claim honestly if the covered event happens; a full policy cycle is the activity that counts.`,
      ];
    case 'yield':
      return [
        `Deposit $${capital} of USDC into ${name}'s main vault or strategy on ${chain} and keep the shares in the wallet.`,
        `Once a month, move about $${half} into the newest strategy ${name} opens, or compound the yield back in, so the wallet follows the product rather than sitting in a retired vault.`,
      ];
    default:
      return [
        `Deposit $${capital} of USDC into ${name} on ${chain} through its main product page and keep the position open.`,
        `Repeat the product's core action with about $${half} once a month (a second deposit, a renewal or a roll), so the wallet shows continuing use rather than a single visit.`,
      ];
  }
}

/** The weekly qualifying action of a playbook, in one line. */
function weeklyAction(book: string, p: SnapshotProtocol, chain: string): string {
  const name = p.name;
  switch (book) {
    case 'lending':
      return `Make one small supply, borrow or repay action on ${name} each week (about $25), keeping the health factor above 2.0.`;
    case 'dex':
      return `Make one swap of about $25 through ${name} on ${chain} each week and check the liquidity position is still in range.`;
    case 'bridge':
      return `Bridge a small amount (about $25) through ${name} each week, alternating direction or destination.`;
    case 'derivatives':
      return `Open and close one small hedged trade on ${name} each week, keeping total exposure under the deposited margin.`;
    case 'chain':
      return `Make two or three small transactions on ${name}'s network each week across different native apps.`;
    default:
      return `Make one qualifying action on ${name} each week (a deposit top-up of about $25, a claim, or a vote if governance is live).`;
  }
}

/**
 * A protocol's farm plan: seven steps, each an action with a cost and a time. Derived from
 * the protocol's own record (category, chains, TVL, age), never from a list of names.
 */
export function farmSteps(p: SnapshotProtocol, age: number | null): string[] {
  const chain = chainOf(p);
  const second = p.chains.length > 1 ? p.chains[1]! : null;
  const capital = capitalFor(p);
  const hold = holdDaysFor(age);
  const book = playbookOf(p.category);
  const [core1, core2] = coreActions(book, p, capital, chain);
  const steps: string[] = [
    `Set up one fresh wallet for this farm and keep its seed phrase offline; use it only for ${p.name} so the activity record is clean. Cost: under $3 to fund the first transaction. Time: 10 minutes.`,
    `Fund the wallet on ${chain} with the position capital plus a gas buffer (${gasWords(chain)}); send a $5 test transaction first and check it arrives before moving the rest. Cost: the test amount plus gas. Time: 20 minutes.`,
    `${core1} Cost: $${capital} of capital plus ${gasWords(chain)}. Time: 20 minutes to set up.`,
    second !== null
      ? `Repeat a smaller version on ${second}: about $${Math.max(25, Math.round(capital / 2))} into ${p.name} there, so the wallet is active on two of its ${p.chains.length} chains. Cost: the smaller amount plus ${gasWords(second)}. Time: 15 minutes.`
      : `${core2} Cost: no new capital beyond the first position. Time: 10 minutes a month.`,
    `${weeklyAction(book, p, chain)} Cost: about $2 of gas a week. Time: 10 minutes a week for at least ${hold} days.`,
    `Hold the position for at least ${hold} days so the activity spans more than one snapshot, then check ${p.name}'s own points or rewards page and claim only from the link it publishes. Cost: the capital stays in the position; never pay anyone to claim. Time: 10 minutes to check.`,
    `Log the wallet, dates, amounts and transaction hashes in a farm log, and unwind in reverse order (withdraw, unbridge, consolidate) once the program ends or the token launches. Cost: exit gas only, ${gasWords(chain)}. Time: 30 minutes.`,
  ];
  return steps.map((s) => (s.length > 600 ? `${s.slice(0, 596)}...` : s));
}

// ------------------------------------------------------------------ the board

/** The snapshot's protocol by slug. */
function bySlug(protocols: SnapshotProtocol[]): Map<string, SnapshotProtocol> {
  return new Map(protocols.map((p) => [p.slug, p]));
}

/** The protocols the board ranks, strongest first, with ranks 1..n. */
export function buildBoard(snapshot: Snapshot): BoardRow[] {
  const { info, applied } = categoryMultiples(snapshot);
  const tokenizedNames = new Set(snapshot.protocols.filter((p) => !isPreToken(p)).map((p) => p.name));
  const index = bySlug(snapshot.protocols);
  const chosen = new Map<string, SnapshotProtocol>();
  for (const slug of snapshot.watchlist) {
    const p = index.get(slug);
    if (p !== undefined) chosen.set(slug, p);
  }
  const early = snapshot.protocols
    .filter((p) => !chosen.has(p.slug) && isEarlyCandidate(p, tokenizedNames) && p.tvl_usd < snapshot.floor_usd)
    .map((p) => ({ p, price: priceOf(p, snapshot.as_of, applied, info.global_median) }))
    .sort((a, b) => b.price.implied - a.price.implied || bySlugAsc(a.p.slug, b.p.slug))
    .slice(0, EARLY_ROWS);
  for (const e of early) chosen.set(e.p.slug, e.p);

  const scored = [...chosen.values()].map((p) => ({ p, price: priceOf(p, snapshot.as_of, applied, info.global_median) }));
  scored.sort((a, b) => b.price.implied - a.price.implied || bySlugAsc(a.p.slug, b.p.slug));
  return scored.map((s, i) => ({
    rank: i + 1,
    slug: s.p.slug,
    name: s.p.name,
    category: s.p.category,
    chains: s.p.chains,
    tvl_usd: s.p.tvl_usd,
    change_7d: s.p.change_7d,
    mcap_usd: s.p.mcap_usd,
    listed_at: s.p.listed_at,
    gecko_id: s.p.gecko_id,
    symbol: s.p.symbol,
    token_status: 'pre-token',
    age_days: s.price.age,
    implied_value_usd: s.price.implied,
    model: {
      category_multiple: s.price.multiple,
      category_peers: s.price.peers,
      growth_multiplier: round4(s.price.growthMult),
      maturity_multiplier: round4(s.price.maturityMult),
      reach_multiplier: round4(s.price.reachMult),
      age_days: s.price.age,
    },
    farm_steps: farmSteps(s.p, s.price.age),
  }));
}

/** The live-token protocols, by market cap, for the dashboard's comparison view. */
export function liveRows(snapshot: Snapshot): LiveRow[] {
  return snapshot.protocols
    .filter((p) => !isPreToken(p) && p.category !== 'CEX')
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) || b.tvl_usd - a.tvl_usd || bySlugAsc(a.slug, b.slug))
    .slice(0, LIVE_ROWS)
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd,
      change_7d: p.change_7d,
      multiple: p.mcap_usd !== null && p.tvl_usd > 0 ? round4(p.mcap_usd / p.tvl_usd) : null,
    }));
}

/** Everything the dashboard renders, from the snapshot. */
export function buildRadar(snapshot: Snapshot): { board: BoardRow[]; radar: RadarData } {
  const board = buildBoard(snapshot);
  const { info } = categoryMultiples(snapshot);
  const watch = new Set(snapshot.watchlist);
  const live = liveRows(snapshot);
  const rows: RadarRow[] = board.map((r) => ({
    rank: r.rank,
    slug: r.slug,
    name: r.name,
    category: r.category,
    chains: r.chains,
    tvl_usd: r.tvl_usd,
    change_7d: r.change_7d,
    age_days: r.age_days,
    listed_at: r.listed_at,
    watchlist: watch.has(r.slug),
    implied_value_usd: r.implied_value_usd,
    category_multiple: r.model.category_multiple,
    category_peers: r.model.category_peers,
    growth_multiplier: r.model.growth_multiplier,
    maturity_multiplier: r.model.maturity_multiplier,
    reach_multiplier: r.model.reach_multiplier,
    farm_steps: r.farm_steps,
  }));
  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    universe_size: snapshot.protocols.length,
    pre_token_size: snapshot.protocols.filter(isPreToken).length,
    model: info,
    watchlist_size: snapshot.watchlist.length,
    board_size: board.length,
    early_size: board.filter((r) => !watch.has(r.slug)).length,
    live_size: live.length,
    rows,
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
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new SnapshotError('snapshot.json is not an object');
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
  return { as_of: o.as_of, source: o.source, floor_usd: o.floor_usd, protocols, watchlist: o.watchlist as string[] };
}

/** Why a board is not one the gate will take, or null: coverage, ranks, order, values, farm steps. */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  const slugs = new Set(board.map((r) => r.slug));
  const missing = snapshot.watchlist.filter((s) => !slugs.has(s));
  if (missing.length > 0) return `the board misses ${missing.length} watchlist slugs: ${missing.slice(0, 5).join(', ')}`;
  const ranks = board.map((r) => r.rank).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) if (ranks[i] !== i + 1) return `rank ${i + 1} is ${ranks[i]}`;
  for (let i = 1; i < board.length; i++) {
    if (board[i]!.implied_value_usd > board[i - 1]!.implied_value_usd) return `row ${i + 1} outranks row ${i} on implied value`;
  }
  if (board.length >= 2 && board[0]!.implied_value_usd === board[board.length - 1]!.implied_value_usd) {
    return `all ${board.length} rows share the same implied value: a board that ranks nothing by value is not a ranking`;
  }
  for (const r of board) {
    if (r.farm_steps.length < 3 || r.farm_steps.length > 12) return `${r.slug} has ${r.farm_steps.length} farm steps`;
    for (const s of r.farm_steps) if (s.length < 20 || s.length > 600) return `${r.slug} has a farm step of ${s.length} characters`;
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0 || r.implied_value_usd > 1e14) {
      return `${r.slug} has implied value ${r.implied_value_usd}`;
    }
  }
  return null;
}

/** A compact data.js: the dashboard's whole dataset as one script, no fetch and no network. */
export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}
