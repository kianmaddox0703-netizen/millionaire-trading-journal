/**
 * FXAlexG methodology knowledge base.
 *
 * Built from docs/01-research.md. Only what a source supports is stated as his;
 * everything else is labelled "Not established from available source material".
 * NO YouTube video was watched or transcribed (blocked from the research environment),
 * so no concept cites a video. Add concepts here (with sources) as more material
 * becomes accessible; the seed script upserts by slug.
 */

export type KbCategory =
  | "core_rule" | "optional_confirmation" | "personal_preference" | "psychology"
  | "context_dependent" | "example" | "third_party" | "not_established";
export type KbConfidence = "high" | "medium" | "low" | "none";

export interface KbSource {
  kind: "primary" | "secondary" | "third_party";
  title: string;
  url: string;
  locator?: string;
  summary: string;
}

export interface KbConcept {
  slug: string;
  name: string;
  area: string;
  category: KbCategory;
  definition: string;
  confidence: KbConfidence;
  related?: string[];
  exceptions?: string;
  examples?: string;
  sources: KbSource[];
}

const TG = "https://t.me/s/alexsetandforget";
const SITE = "https://fxalexg.com/";
const POD = "https://podcasts.apple.com/us/podcast/set-and-forget/id1617481269";
const FXINRS = "https://www.forex.in.rs/miami-trader-strategy-4/";
const COINSPOT = "https://coinspot.io/en/reviews/swingtradinglab/";

export const NOT_ESTABLISHED = "Not established from available source material.";

export const KB_AREAS = [
  "Core Methodology", "Market Context", "Setup Identification", "Entry Confirmation",
  "Risk Management", "Trade Management", "Exit Conditions", "Psychology", "Session Timing", "Common Mistakes",
] as const;

export const FXALEXG_KB: KbConcept[] = [
  {
    slug: "set-and-forget",
    name: "Set and forget",
    area: "Core Methodology",
    category: "core_rule",
    confidence: "high",
    definition: "Plan the entry, stop loss and take profit before entering; once the order is placed, do not interfere. The trade ends at the stop or the target.",
    related: ["patience", "no-interference", "greed-fear"],
    sources: [
      { kind: "primary", title: "fxalexg.com (about)", url: SITE, summary: "Origin story: kept cutting profits short from greed until he fell asleep in a trade and woke to a much larger winner." },
      { kind: "primary", title: "Swingtradinglab Telegram", url: TG, locator: "post 1285", summary: "\"you have to be PATIENT AND JUST #SETANDFORGET\"" },
      { kind: "primary", title: "Swingtradinglab Telegram", url: TG, locator: "posts 993, 1561–1565, latest", summary: "#setandforget used repeatedly across 2022–2025." },
    ],
  },
  {
    slug: "swing-higher-timeframe",
    name: "Swing trading from higher timeframes",
    area: "Core Methodology",
    category: "core_rule",
    confidence: "medium",
    definition: "Trades are swing trades planned on higher timeframes; decisions reference the daily chart and daily closes.",
    related: ["ltf-confirmation"],
    exceptions: "Exact analysis/entry timeframe split is not established (see Lower-timeframe confirmation).",
    sources: [
      { kind: "primary", title: "Swingtradinglab Telegram", url: TG, locator: "latest page", summary: "Awaiting daily close before re-entry." },
      { kind: "secondary", title: "coinspot.io review", url: COINSPOT, summary: "Describes a swing bias on the daily timeframe." },
    ],
  },
  {
    slug: "market-structure",
    name: "Price action & market structure",
    area: "Core Methodology",
    category: "core_rule",
    confidence: "high",
    definition: "Analysis is price-action based: trend structure (highs/lows), levels and breaks of structure, rather than indicator signals.",
    related: ["break-of-structure", "aoi"],
    sources: [
      { kind: "primary", title: "Swingtradinglab Telegram", url: TG, locator: "post 477", summary: "\"capitalize off these simple market structures\"" },
    ],
  },
  {
    slug: "trend-alignment",
    name: "Trade with the trend (no counter-trend)",
    area: "Market Context",
    category: "core_rule",
    confidence: "medium",
    definition: "Take trades in the direction of the prevailing trend; counter-trend trades are discouraged.",
    related: ["market-structure"],
    sources: [{ kind: "primary", title: "Swingtradinglab Telegram", url: TG, locator: "post 490", summary: "\"DONT TAKE COUNTER TREND TRADE SHORTS\" with the outcome shown." }],
  },
  {
    slug: "aoi",
    name: "Area of Interest (AOI)",
    area: "Market Context",
    category: "core_rule",
    confidence: "medium",
    definition: "A price zone (not a single line) where he expects a reaction. Setups form when price pulls back to, or breaks and retests, an AOI. He distinguishes major and \"minor\" AOIs.",
    exceptions: "How an AOI is drawn (touch count, timeframe, zone width) is not established.",
    related: ["pullback-to-aoi", "break-and-retest"],
    sources: [
      { kind: "primary", title: "Swingtradinglab Telegram", url: TG, locator: "post 989", summary: "\"THIS week I am expecting a pull back to AOI\"" },
      { kind: "primary", title: "Swingtradinglab Telegram", url: TG, locator: "latest page", summary: "Waiting for a break and retest of a minor area of interest." },
    ],
  },
  {
    slug: "weekly-pair-shortlist",
    name: "Weekly pair shortlist",
    area: "Market Context",
    category: "personal_preference",
    confidence: "medium",
    definition: "Prepares a short list of the best 3–5 pairs for the week ahead (\"Sunday Swings\") and focuses on those.",
    sources: [{ kind: "primary", title: "Swingtradinglab Telegram", url: TG, locator: "posts 1563, 1566", summary: "\"give them my top 3-5 pairs for the week\"" }],
  },
  {
    slug: "instruments",
    name: "Instruments traded",
    area: "Market Context",
    category: "example",
    confidence: "high",
    definition: "Trade ideas cover FX majors and crosses and gold (e.g. EURAUD, GBPCAD, GBPUSD, EURUSD, AUDUSD, XAUUSD). This describes what he trades, not a rule.",
    sources: [{ kind: "primary", title: "Swingtradinglab Telegram", url: TG, locator: "posts 988, 1285, 1444–1449, 1568", summary: "Trade ideas on these symbols." }],
  },
  {
    slug: "liquidity",
    name: "Liquidity",
    area: "Market Context",
    category: "not_established",
    confidence: "none",
    definition: NOT_ESTABLISHED + " A third-party write-up mentions liquidity sweeps before a structure shift, but no primary source does.",
    sources: [{ kind: "third_party", title: "forex.in.rs article (uncited)", url: FXINRS, summary: "Claims a liquidity sweep is expected before the structure shift." }],
  },
  {
    slug: "pullback-to-aoi",
    name: "Setup A: Pullback to AOI with trend",
    area: "Setup Identification",
    category: "core_rule",
    confidence: "medium",
    definition: "In a trending market, wait for price to pull back into an AOI, then look for the entry confirmation.",
    related: ["aoi", "trend-alignment", "break-and-retest", "engulfing"],
    sources: [{ kind: "primary", title: "Swingtradinglab Telegram", url: TG, locator: "posts 989, 992", summary: "Expecting a pullback to AOI; base forming before continuation." }],
  },
  {
    slug: "break-of-structure",
    name: "Setup B: Break of structure → retest",
    area: "Setup Identification",
    category: "core_rule",
    confidence: "medium",
    definition: "Price breaks a previous swing high/low (structure); the trade is taken on the retest of the broken level.",
    related: ["break-and-retest", "market-structure"],
    sources: [{ kind: "primary", title: "Swingtradinglab Telegram", url: TG, locator: "latest page", summary: "London session setup waiting for a break of structure from the previous high." }],
  },
  {
    slug: "head-and-shoulders",
    name: "Setup C: Head and shoulders",
    area: "Setup Identification",
    category: "context_dependent",
    confidence: "low",
    definition: "Head-and-shoulders patterns are identified as trade setups. No specific rules for trading them were found.",
    sources: [{ kind: "primary", title: "Swingtradinglab Telegram", url: TG, locator: "latest page", summary: "Head and shoulders identified on a chart post." }],
  },
  {
    slug: "break-and-retest",
    name: "Break and retest (\"BR\") required",
    area: "Entry Confirmation",
    category: "core_rule",
    confidence: "high",
    definition: "No entry until the level breaks and price retests it. If the BR does not happen, there is no trade, even if the directional idea was right or wrong.",
    related: ["aoi", "break-of-structure", "engulfing"],
    examples: "EURAUD idea was wrong, but no loss was taken because the BR never formed.",
    sources: [
      { kind: "primary", title: "Swingtradinglab Telegram", url: TG, locator: "post 1568", summary: "\"no loss taken because I didn't get the BR I was looking for\"" },
      { kind: "primary", title: "Swingtradinglab Telegram", url: TG, locator: "latest page", summary: "Awaiting break and retest of a minor AOI; waited for a strong break." },
    ],
  },
  {
    slug: "engulfing",
    name: "Engulfing candle confirmation",
    area: "Entry Confirmation",
    category: "optional_confirmation",
    confidence: "medium",
    definition: "An engulfing candle at the retest confirms the entry; without it he skipped a break-and-retest.",
    exceptions: "Whether engulfing is always required or one of several acceptable confirmations is not established.",
    related: ["break-and-retest"],
    sources: [{ kind: "primary", title: "Swingtradinglab Telegram", url: TG, locator: "latest page", summary: "Skipped a minor-AOI break/retest because there was no engulfing pattern." }],
  },
  {
    slug: "strong-break",
    name: "Strong break",
    area: "Entry Confirmation",
    category: "optional_confirmation",
    confidence: "medium",
    definition: "Waits for a decisive break of the level before considering the retest; weak breaks are not traded.",
    sources: [{ kind: "primary", title: "Swingtradinglab Telegram", url: TG, locator: "latest page", summary: "Avoided a loss by waiting for a strong break." }],
  },
  {
    slug: "ltf-confirmation",
    name: "Lower-timeframe confirmation (4H / 1H)",
    area: "Entry Confirmation",
    category: "context_dependent",
    confidence: "low",
    definition: "Posts mark \"1 hour chart time\" and reference a 4H EMA, suggesting daily analysis with 4H/1H entry timing. The exact timeframe and EMA length are not established.",
    sources: [
      { kind: "primary", title: "Swingtradinglab Telegram", url: TG, locator: "posts 1285–1297", summary: "\"1 hour chart time ✅\"" },
      { kind: "primary", title: "Swingtradinglab Telegram", url: TG, locator: "posts 979–999", summary: "Reference to a 4hr EMA." },
      { kind: "third_party", title: "\"Snake of fxalexg\" TradingView indicator (community)", url: "https://www.tradingview.com/script/qAMvHkku-Snake-of-fxalexg/", summary: "Community indicator uses a 50 EMA filter and W/D/4H/2H/1H structure; the author's choice, not confirmed as his." },
    ],
  },
  {
    slug: "risk-per-trade",
    name: "Risk per trade",
    area: "Risk Management",
    category: "not_established",
    confidence: "none",
    definition: NOT_ESTABLISHED + " Set your own max risk per trade in Settings → Risk rules.",
    sources: [],
  },
  {
    slug: "reward-to-risk",
    name: "Reward-to-risk",
    area: "Risk Management",
    category: "example",
    confidence: "low",
    definition: "Minimum R:R: " + NOT_ESTABLISHED + " Documented example: a 1:4.5 winner. He teaches using the R:R tool.",
    sources: [
      { kind: "primary", title: "Swingtradinglab Telegram", url: TG, locator: "post 1288", summary: "\"TP hit for a 1:4.5 RR\"" },
      { kind: "primary", title: "Swingtradinglab Telegram", url: TG, locator: "post 490", summary: "R:R tool referenced in a lesson." },
    ],
  },
  {
    slug: "no-interference",
    name: "No management after entry",
    area: "Trade Management",
    category: "core_rule",
    confidence: "high",
    definition: "After entry the trade is left alone: no moving the stop, no closing early. Follows directly from set and forget.",
    related: ["set-and-forget"],
    sources: [{ kind: "primary", title: "fxalexg.com (about)", url: SITE, summary: "Cutting profits short out of greed is the problem set and forget solves." }],
  },
  {
    slug: "partials-breakeven",
    name: "Partials / break-even moves",
    area: "Trade Management",
    category: "third_party",
    confidence: "low",
    definition: "A third-party article claims first partial at 1–1.5R and moving the stop to break-even. This conflicts with set and forget and is not supported by his own posts.",
    related: ["no-interference"],
    sources: [{ kind: "third_party", title: "forex.in.rs article (uncited)", url: FXINRS, summary: "Partials at 1R–1.5R, stop to BE/channel middle line, 'G-Channel' indicator." }],
  },
  {
    slug: "stop-placement",
    name: "Stop-loss placement",
    area: "Exit Conditions",
    category: "not_established",
    confidence: "none",
    definition: NOT_ESTABLISHED,
    sources: [{ kind: "third_party", title: "forex.in.rs article (uncited)", url: FXINRS, summary: "Claims stop beyond the swept extreme or origin of the break; unverified." }],
  },
  {
    slug: "take-profit-placement",
    name: "Take-profit placement",
    area: "Exit Conditions",
    category: "not_established",
    confidence: "none",
    definition: NOT_ESTABLISHED + " Exits are the pre-set SL or TP only (see Set and forget).",
    sources: [],
  },
  {
    slug: "patience",
    name: "Patience",
    area: "Psychology",
    category: "psychology",
    confidence: "high",
    definition: "Wait for the setup to fully form; sitting on your hands is part of the job.",
    sources: [
      { kind: "primary", title: "Swingtradinglab Telegram", url: TG, locator: "post 983", summary: "\"PATIENCE PAYS… learn how to sit your hands and only trade when…\"" },
      { kind: "primary", title: "Swingtradinglab Telegram", url: TG, locator: "latest page", summary: "\"PATIENCE!!!!\"" },
    ],
  },
  {
    slug: "less-is-more",
    name: "Selectivity: textbook trades only",
    area: "Psychology",
    category: "psychology",
    confidence: "high",
    definition: "Take only textbook setups. A week with zero trades is acceptable and even good.",
    sources: [
      { kind: "primary", title: "Swingtradinglab Telegram", url: TG, locator: "post 297", summary: "\"Textbook trades only, Less is more\"" },
      { kind: "primary", title: "Swingtradinglab Telegram", url: TG, locator: "posts 1570, 1573", summary: "\"Not 1 single trade this week… Such a lovely week\"" },
    ],
  },
  {
    slug: "greed-fear",
    name: "Greed and fear",
    area: "Psychology",
    category: "psychology",
    confidence: "medium",
    definition: "Greed (cutting winners, forcing trades) and fear are the main threats to execution; set and forget exists to remove them.",
    sources: [
      { kind: "primary", title: "SET AND FORGET podcast", url: POD, locator: "EP 26", summary: "\"How to over come Greed and Fear in trading\" (title/description only)." },
      { kind: "primary", title: "fxalexg.com (about)", url: SITE, summary: "Greed made him cut profits short." },
    ],
  },
  {
    slug: "learn-from-losses",
    name: "Learn from losses",
    area: "Psychology",
    category: "psychology",
    confidence: "medium",
    definition: "Losses and mistakes are reviewed for lessons.",
    sources: [{ kind: "primary", title: "Swingtradinglab Telegram", url: TG, locator: "posts 477, 1570", summary: "\"learn from my mistakes\", \"Learning from my L's\"" }],
  },
  {
    slug: "session-timing",
    name: "Session timing",
    area: "Session Timing",
    category: "context_dependent",
    confidence: "low",
    definition: "A London-session setup is referenced and a review describes a London focus. No session rule is established. (Third-party ±90 min London/NY windows are unverified.)",
    sources: [
      { kind: "primary", title: "Swingtradinglab Telegram", url: TG, locator: "latest page", summary: "London session setup." },
      { kind: "secondary", title: "coinspot.io review", url: COINSPOT, summary: "\"London session focus\"" },
      { kind: "third_party", title: "forex.in.rs article (uncited)", url: FXINRS, summary: "London/NY open ±90 minutes." },
    ],
  },
  {
    slug: "mistake-no-confirmation",
    name: "Mistake: entering without the BR / confirmation",
    area: "Common Mistakes",
    category: "core_rule",
    confidence: "high",
    definition: "Entering on the idea alone, before the break and retest (and confirmation candle) completes.",
    related: ["break-and-retest", "engulfing"],
    sources: [{ kind: "primary", title: "Swingtradinglab Telegram", url: TG, locator: "post 1568, latest", summary: "Skipped trades without the BR/engulfing." }],
  },
  {
    slug: "mistake-cutting-winners",
    name: "Mistake: cutting winners short",
    area: "Common Mistakes",
    category: "core_rule",
    confidence: "high",
    definition: "Closing a winner before the target out of greed or fear.",
    related: ["set-and-forget", "no-interference"],
    sources: [{ kind: "primary", title: "fxalexg.com (about)", url: SITE, summary: "Origin story of set and forget." }],
  },
  {
    slug: "mistake-counter-trend",
    name: "Mistake: counter-trend trades",
    area: "Common Mistakes",
    category: "core_rule",
    confidence: "medium",
    definition: "Taking trades against the trend.",
    related: ["trend-alignment"],
    sources: [{ kind: "primary", title: "Swingtradinglab Telegram", url: TG, locator: "post 490", summary: "\"DONT TAKE COUNTER TREND TRADE SHORTS\"" }],
  },
  {
    slug: "mistake-overtrading",
    name: "Mistake: overtrading / forcing trades",
    area: "Common Mistakes",
    category: "psychology",
    confidence: "medium",
    definition: "Taking non-textbook trades to be active.",
    related: ["less-is-more"],
    sources: [{ kind: "primary", title: "Swingtradinglab Telegram", url: TG, locator: "posts 297, 1570", summary: "\"Less is more\"" }],
  },
];

/**
 * Default strategy template, built from high/medium-confidence concepts only.
 * Low-confidence items are optional and labelled. Nothing "not established" is a rule.
 */
export const FXALEXG_TEMPLATE = {
  name: "FXAlexG Set & Forget",
  description:
    "Trend-aligned swing trades from higher-timeframe AOIs, entered only after a break and retest, then left alone until SL or TP. Built from source-backed concepts in the Knowledge Base; risk % and minimum R:R are yours to set (not established from his material).",
  preferredSessions: "",
  preferredPairs: "",
  preferredConditions: "Trending market, price at a higher-timeframe AOI",
  rules: [
    { kind: "rule", text: "Trade in the direction of the higher-timeframe trend", slug: "trend-alignment", required: true },
    { kind: "rule", text: "Price is at a marked Area of Interest", slug: "aoi", required: true },
    { kind: "rule", text: "Entry, stop and target set before entry; no interference after", slug: "set-and-forget", required: true },
    { kind: "confirmation", text: "Break and retest of the level has happened", slug: "break-and-retest", required: true },
    { kind: "confirmation", text: "Engulfing candle at the retest", slug: "engulfing", required: false },
    { kind: "confirmation", text: "The break was strong/decisive", slug: "strong-break", required: false },
    { kind: "confirmation", text: "Lower-timeframe (4H/1H) confirmation (low confidence)", slug: "ltf-confirmation", required: false },
    { kind: "invalidation", text: "No break and retest formed → no trade", slug: "break-and-retest", required: true },
    { kind: "invalidation", text: "Setup is counter-trend", slug: "trend-alignment", required: true },
    { kind: "checklist", text: "Higher-timeframe trend identified", slug: "trend-alignment", required: true },
    { kind: "checklist", text: "Price at AOI", slug: "aoi", required: true },
    { kind: "checklist", text: "Break and retest confirmed", slug: "break-and-retest", required: true },
    { kind: "checklist", text: "Confirmation candle present", slug: "engulfing", required: false },
    { kind: "checklist", text: "SL and TP placed; risk within my limit", slug: null, required: true },
    { kind: "checklist", text: "This is a textbook trade, not a forced one", slug: "less-is-more", required: true },
  ] as { kind: "rule" | "confirmation" | "invalidation" | "checklist"; text: string; slug: string | null; required: boolean }[],
  setups: ["Pullback to AOI", "Break of structure retest", "Head and shoulders"],
};
