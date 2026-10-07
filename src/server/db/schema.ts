import { sqliteTable, text, integer, real, uniqueIndex, index } from "drizzle-orm/sqlite-core";
import { relations, sql } from "drizzle-orm";

const id = () => text("id").primaryKey();
const createdAt = () =>
  integer("created_at", { mode: "timestamp_ms" }).notNull().default(sql`(unixepoch() * 1000)`);
const updatedAt = () =>
  integer("updated_at", { mode: "timestamp_ms" }).notNull().default(sql`(unixepoch() * 1000)`);
const ts = (name: string) => integer(name, { mode: "timestamp_ms" });
const bool = (name: string) => integer(name, { mode: "boolean" });
const userId = () => text("user_id").notNull().references(() => users.id, { onDelete: "cascade" });

// ───────────── identity ─────────────

export const users = sqliteTable("users", {
  id: id(),
  email: text("email").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  name: text("name").notNull().default(""),
  timezone: text("timezone").notNull().default("UTC"),
  baseCurrency: text("base_currency").notNull().default("USD"),
  // generate an AI review once when a trade is first closed (only when an AI key is configured)
  aiAutoReview: bool("ai_auto_review").notNull().default(true),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const sessions = sqliteTable("sessions", {
  id: id(),
  userId: userId(),
  tokenHash: text("token_hash").notNull().unique(),
  expiresAt: ts("expires_at").notNull(),
  createdAt: createdAt(),
});

// ───────────── accounts & rules ─────────────

export const accounts = sqliteTable("accounts", {
  id: id(),
  userId: userId(),
  name: text("name").notNull(),
  kind: text("kind", { enum: ["live", "prop", "demo", "backtest"] }).notNull().default("live"),
  broker: text("broker"),
  currency: text("currency").notNull().default("USD"),
  startingBalance: real("starting_balance").notNull().default(0),
  isArchived: bool("is_archived").notNull().default(false),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const riskRules = sqliteTable("risk_rules", {
  id: id(),
  userId: userId(),
  accountId: text("account_id").references(() => accounts.id, { onDelete: "cascade" }),
  maxRiskPct: real("max_risk_pct"),
  maxDailyLossPct: real("max_daily_loss_pct"),
  maxWeeklyLossPct: real("max_weekly_loss_pct"),
  maxTradesPerDay: integer("max_trades_per_day"),
  maxConsecutiveLosses: integer("max_consecutive_losses"),
  minRr: real("min_rr"),
  tradingHoursStart: text("trading_hours_start"), // "HH:MM" in user timezone
  tradingHoursEnd: text("trading_hours_end"),
  restrictedDays: text("restricted_days"), // comma-separated 0-6 (Sun=0)
  requireChecklist: bool("require_checklist").notNull().default(false),
  updatedAt: updatedAt(),
});

// ───────────── strategies ─────────────

export const strategies = sqliteTable("strategies", {
  id: id(),
  userId: userId(),
  name: text("name").notNull(),
  description: text("description").notNull().default(""),
  source: text("source", { enum: ["user", "fxalexg_template"] }).notNull().default("user"),
  preferredSessions: text("preferred_sessions").notNull().default(""),
  preferredPairs: text("preferred_pairs").notNull().default(""),
  preferredConditions: text("preferred_conditions").notNull().default(""),
  isActive: bool("is_active").notNull().default(true),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const strategyRules = sqliteTable("strategy_rules", {
  id: id(),
  strategyId: text("strategy_id").notNull().references(() => strategies.id, { onDelete: "cascade" }),
  kind: text("kind", { enum: ["rule", "confirmation", "invalidation", "checklist"] }).notNull(),
  text: text("text").notNull(),
  isRequired: bool("is_required").notNull().default(true),
  sort: integer("sort").notNull().default(0),
  kbConceptSlug: text("kb_concept_slug"),
});

export const setups = sqliteTable("setups", {
  id: id(),
  userId: userId(),
  strategyId: text("strategy_id").references(() => strategies.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  description: text("description").notNull().default(""),
  createdAt: createdAt(),
});

export const scoreFactors = sqliteTable(
  "score_factors",
  {
    id: id(),
    userId: userId(),
    key: text("key").notNull(),
    label: text("label").notNull(),
    weight: real("weight").notNull(),
    sort: integer("sort").notNull().default(0),
  },
  (t) => [uniqueIndex("score_factors_user_key").on(t.userId, t.key)],
);

// ───────────── trades ─────────────

export const trades = sqliteTable(
  "trades",
  {
    id: id(),
    userId: userId(),
    accountId: text("account_id").notNull().references(() => accounts.id, { onDelete: "cascade" }),
    strategyId: text("strategy_id").references(() => strategies.id, { onDelete: "set null" }),
    setupId: text("setup_id").references(() => setups.id, { onDelete: "set null" }),
    seq: integer("seq").notNull(), // human-readable trade number per user
    externalRef: text("external_ref"), // e.g. MT5 position id
    source: text("source", { enum: ["manual", "csv", "mt5_report", "mt5_bridge"] }).notNull().default("manual"),

    symbol: text("symbol").notNull(),
    direction: text("direction", { enum: ["long", "short"] }).notNull(),
    status: text("status", { enum: ["open", "closed"] }).notNull().default("closed"),
    openedAt: ts("opened_at").notNull(),
    closedAt: ts("closed_at"),

    entryPrice: real("entry_price").notNull(),
    initialStop: real("initial_stop"),
    takeProfit: real("take_profit"),
    exitPrice: real("exit_price"),
    sizeLots: real("size_lots"),

    riskAmount: real("risk_amount"),
    riskPct: real("risk_pct"),
    grossPnl: real("gross_pnl"),
    commission: real("commission").notNull().default(0),
    swap: real("swap").notNull().default(0),
    fees: real("fees").notNull().default(0),
    netPnl: real("net_pnl"),
    pnlPct: real("pnl_pct"),
    rMultiple: real("r_multiple"),
    plannedRr: real("planned_rr"),

    session: text("session"),
    timeframe: text("timeframe"),
    marketCondition: text("market_condition"),
    trend: text("trend"),
    htfBias: text("htf_bias"),
    setupQuality: text("setup_quality", { enum: ["A+", "A", "B", "C"] }),
    entryConfirmation: text("entry_confirmation"),
    confluences: text("confluences").notNull().default(""), // comma-separated tags
    setupScore: real("setup_score"),
    chartUrl: text("chart_url"),

    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("trades_user_opened").on(t.userId, t.openedAt),
    uniqueIndex("trades_user_seq").on(t.userId, t.seq),
    uniqueIndex("trades_account_external").on(t.accountId, t.externalRef),
  ],
);

export const tradeNotes = sqliteTable("trade_notes", {
  tradeId: text("trade_id").primaryKey().references(() => trades.id, { onDelete: "cascade" }),
  userId: userId(),
  why: text("why").notNull().default(""),
  observed: text("observed").notNull().default(""),
  thesis: text("thesis").notNull().default(""),
  whatHappened: text("what_happened").notNull().default(""),
  didWell: text("did_well").notNull().default(""),
  didPoorly: text("did_poorly").notNull().default(""),
  wouldChange: text("would_change").notNull().default(""),
  lesson: text("lesson").notNull().default(""),
  updatedAt: updatedAt(),
});

export const tradePsychology = sqliteTable("trade_psychology", {
  tradeId: text("trade_id").primaryKey().references(() => trades.id, { onDelete: "cascade" }),
  userId: userId(),
  confidence: integer("confidence"), // 1-10
  discipline: integer("discipline"), // 1-10
  followedPlan: bool("followed_plan"),
  fomo: bool("fomo").notNull().default(false),
  revenge: bool("revenge").notNull().default(false),
  movedStop: bool("moved_stop").notNull().default(false),
  exitedEarly: bool("exited_early").notNull().default(false),
  overtraded: bool("overtraded").notNull().default(false),
  lateEntry: bool("late_entry").notNull().default(false),
  oversized: bool("oversized").notNull().default(false),
});

export const EMOTIONS = [
  "calm", "confident", "fear", "greed", "fomo", "frustration", "revenge", "boredom", "hesitation", "excitement", "anxiety",
] as const;

export const psychologyEntries = sqliteTable(
  "psychology_entries",
  {
    id: id(),
    tradeId: text("trade_id").notNull().references(() => trades.id, { onDelete: "cascade" }),
    userId: userId(),
    phase: text("phase", { enum: ["before", "during", "after"] }).notNull(),
    emotion: text("emotion").notNull(),
    intensity: integer("intensity"), // 1-10
  },
  (t) => [uniqueIndex("psych_trade_phase").on(t.tradeId, t.phase)],
);

export const tradeImages = sqliteTable("trade_images", {
  id: id(),
  tradeId: text("trade_id").notNull().references(() => trades.id, { onDelete: "cascade" }),
  userId: userId(),
  kind: text("kind", { enum: ["before", "entry", "during", "exit", "tradingview", "mt5", "other"] }).notNull().default("other"),
  storageKey: text("storage_key").notNull(),
  thumbKey: text("thumb_key").notNull(),
  mime: text("mime").notNull(),
  width: integer("width").notNull(),
  height: integer("height").notNull(),
  bytes: integer("bytes").notNull(),
  caption: text("caption").notNull().default(""),
  sort: integer("sort").notNull().default(0),
  createdAt: createdAt(),
});

export const mistakeTypes = sqliteTable("mistake_types", {
  id: id(),
  userId: text("user_id").references(() => users.id, { onDelete: "cascade" }), // null = system
  key: text("key").notNull(),
  label: text("label").notNull(),
  description: text("description").notNull().default(""),
});

export const tradeMistakes = sqliteTable(
  "trade_mistakes",
  {
    id: id(),
    tradeId: text("trade_id").notNull().references(() => trades.id, { onDelete: "cascade" }),
    userId: userId(),
    mistakeKey: text("mistake_key").notNull(),
    source: text("source", { enum: ["user", "rule", "ai"] }).notNull().default("user"),
    costR: real("cost_r"),
    note: text("note").notNull().default(""),
  },
  (t) => [uniqueIndex("trade_mistake_unique").on(t.tradeId, t.mistakeKey)],
);

export const checklistResponses = sqliteTable("checklist_responses", {
  id: id(),
  tradeId: text("trade_id").notNull().references(() => trades.id, { onDelete: "cascade" }),
  userId: userId(),
  phase: text("phase", { enum: ["pre", "post"] }).notNull(),
  item: text("item").notNull(),
  checked: bool("checked"),
  answer: text("answer"),
  sort: integer("sort").notNull().default(0),
});

export const marketContext = sqliteTable("market_context", {
  tradeId: text("trade_id").primaryKey().references(() => trades.id, { onDelete: "cascade" }),
  userId: userId(),
  provider: text("provider").notNull(),
  trend: text("trend"),
  htfBias: text("htf_bias"),
  session: text("session"),
  volatility: text("volatility"),
  atr: real("atr"),
  nearKeyLevel: bool("near_key_level"),
  details: text("details"), // JSON: definitions, levels, data range; never raw credentials
  status: text("status", { enum: ["ok", "error", "unsupported", "pending"] }).notNull().default("ok"),
  error: text("error"),
  instrument: text("instrument"),
  computedAt: createdAt(),
});

// ───────────── reviews ─────────────

export const weeklyReviews = sqliteTable(
  "weekly_reviews",
  {
    id: id(),
    userId: userId(),
    weekStart: text("week_start").notNull(), // YYYY-MM-DD (Monday)
    followedRules: text("followed_rules").notNull().default(""),
    overtraded: text("overtraded").notNull().default(""),
    forcedSetups: text("forced_setups").notNull().default(""),
    respectedRisk: text("respected_risk").notNull().default(""),
    followedPlan: text("followed_plan").notNull().default(""),
    emotions: text("emotions").notNull().default(""),
    lostDiscipline: text("lost_discipline").notNull().default(""),
    triggers: text("triggers").notNull().default(""),
    keepDoing: text("keep_doing").notNull().default(""),
    stopDoing: text("stop_doing").notNull().default(""),
    change: text("change").notNull().default(""),
    focusNextWeek: text("focus_next_week").notNull().default(""),
    aiSummary: text("ai_summary"),
    completedAt: ts("completed_at"),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("weekly_user_week").on(t.userId, t.weekStart)],
);

export const monthlyReviews = sqliteTable(
  "monthly_reviews",
  {
    id: id(),
    userId: userId(),
    month: text("month").notNull(), // YYYY-MM
    notes: text("notes").notNull().default(""),
    biggestImprovement: text("biggest_improvement").notNull().default(""),
    focusNextMonth: text("focus_next_month").notNull().default(""),
    aiSummary: text("ai_summary"),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("monthly_user_month").on(t.userId, t.month)],
);

export const performanceSnapshots = sqliteTable("performance_snapshots", {
  id: id(),
  userId: userId(),
  accountId: text("account_id").notNull().references(() => accounts.id, { onDelete: "cascade" }),
  asOf: ts("as_of").notNull(),
  balance: real("balance").notNull(),
  equity: real("equity"),
  source: text("source").notNull().default("computed"),
});

// ───────────── integrations ─────────────

export const brokerConnections = sqliteTable("broker_connections", {
  id: id(),
  userId: userId(),
  accountId: text("account_id").notNull().references(() => accounts.id, { onDelete: "cascade" }),
  kind: text("kind", { enum: ["mt5_bridge"] }).notNull(),
  label: text("label").notNull().default(""),
  apiKeyHash: text("api_key_hash").notNull().unique(),
  lastSeenAt: ts("last_seen_at"),
  createdAt: createdAt(),
});

export const mt5Deals = sqliteTable(
  "mt5_deals",
  {
    id: id(),
    userId: userId(),
    accountId: text("account_id").notNull().references(() => accounts.id, { onDelete: "cascade" }),
    ticket: text("ticket").notNull(),
    positionId: text("position_id").notNull(),
    orderId: text("order_id"),
    time: ts("time").notNull(),
    type: text("type").notNull(), // buy|sell
    entry: text("entry").notNull(), // in|out|inout|out_by
    symbol: text("symbol").notNull(),
    volume: real("volume").notNull(),
    price: real("price").notNull(),
    sl: real("sl"),
    tp: real("tp"),
    commission: real("commission").notNull().default(0),
    swap: real("swap").notNull().default(0),
    profit: real("profit").notNull().default(0),
    magic: integer("magic"),
    comment: text("comment"),
  },
  (t) => [uniqueIndex("mt5_deal_account_ticket").on(t.accountId, t.ticket)],
);

export const webhookTokens = sqliteTable("webhook_tokens", {
  id: id(),
  userId: userId(),
  kind: text("kind", { enum: ["tradingview"] }).notNull(),
  tokenHash: text("token_hash").notNull().unique(),
  createdAt: createdAt(),
});

export const tradingviewAlerts = sqliteTable("tradingview_alerts", {
  id: id(),
  userId: userId(),
  receivedAt: createdAt(),
  symbol: text("symbol"),
  timeframe: text("timeframe"),
  price: real("price"),
  side: text("side"),
  setup: text("setup"),
  alertTime: ts("alert_time"),
  message: text("message"),
  raw: text("raw").notNull(),
});

export const tradeLinks = sqliteTable(
  "trade_links",
  {
    id: id(),
    tradeId: text("trade_id").notNull().references(() => trades.id, { onDelete: "cascade" }),
    userId: userId(),
    kind: text("kind", { enum: ["tv_alert"] }).notNull(),
    refId: text("ref_id").notNull(),
    score: real("score"),
    status: text("status", { enum: ["suggested", "confirmed", "rejected"] }).notNull().default("suggested"),
  },
  (t) => [uniqueIndex("trade_link_unique").on(t.tradeId, t.kind, t.refId)],
);

// ───────────── knowledge base & AI ─────────────

export const kbConcepts = sqliteTable("kb_concepts", {
  slug: text("slug").primaryKey(),
  name: text("name").notNull(),
  area: text("area").notNull(), // framework branch, e.g. "Entry Confirmation"
  category: text("category", {
    enum: ["core_rule", "optional_confirmation", "personal_preference", "psychology", "context_dependent", "example", "third_party", "not_established"],
  }).notNull(),
  definition: text("definition").notNull(),
  confidence: text("confidence", { enum: ["high", "medium", "low", "none"] }).notNull(),
  related: text("related").notNull().default(""),
  exceptions: text("exceptions").notNull().default(""),
  examples: text("examples").notNull().default(""),
});

export const kbSources = sqliteTable("kb_sources", {
  id: id(),
  conceptSlug: text("concept_slug").notNull().references(() => kbConcepts.slug, { onDelete: "cascade" }),
  kind: text("kind", { enum: ["primary", "secondary", "third_party"] }).notNull(),
  title: text("title").notNull(),
  url: text("url").notNull(),
  locator: text("locator").notNull().default(""),
  summary: text("summary").notNull().default(""),
});

export const aiAnalysis = sqliteTable("ai_analysis", {
  id: id(),
  userId: userId(),
  tradeId: text("trade_id").references(() => trades.id, { onDelete: "cascade" }),
  imageId: text("image_id").references(() => tradeImages.id, { onDelete: "cascade" }),
  kind: text("kind", { enum: ["screenshot", "trade_review", "weekly", "monthly", "coach"] }).notNull(),
  // weekly: "YYYY-MM-DD|<accountId or all>" (Monday), monthly: "YYYY-MM|<accountId or all>"
  periodKey: text("period_key"),
  model: text("model").notNull(),
  status: text("status", { enum: ["ok", "error"] }).notNull().default("ok"),
  error: text("error"),
  output: text("output").notNull().default(""), // JSON validated against the kind's zod schema
  inputTokens: integer("input_tokens"),
  outputTokens: integer("output_tokens"),
  createdAt: createdAt(),
}, (t) => [index("ai_analysis_trade").on(t.tradeId, t.kind), index("ai_analysis_period").on(t.userId, t.kind, t.periodKey)]);

// A secret the user saved inside the app (today only their Anthropic API key). The value is AES-256-GCM
// ciphertext bound to the user and kind (src/server/secrets.ts); the plaintext is never stored. hint = last 4 characters.
export const userSecrets = sqliteTable("user_secrets", {
  id: id(),
  userId: userId(),
  kind: text("kind", { enum: ["anthropic"] }).notNull(),
  ciphertext: text("ciphertext").notNull(),
  hint: text("hint").notNull().default(""),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [uniqueIndex("user_secrets_user_kind").on(t.userId, t.kind)]);

export const coachConversations = sqliteTable("coach_conversations", {
  id: id(),
  userId: userId(),
  title: text("title").notNull().default(""),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [index("coach_conv_user").on(t.userId, t.updatedAt)]);

export const coachMessages = sqliteTable("coach_messages", {
  id: id(),
  conversationId: text("conversation_id").notNull().references(() => coachConversations.id, { onDelete: "cascade" }),
  userId: userId(),
  role: text("role", { enum: ["user", "assistant"] }).notNull(),
  content: text("content").notNull(),
  tools: text("tools").notNull().default(""), // comma-separated names of the data tools used for this answer
  model: text("model"),
  inputTokens: integer("input_tokens"),
  outputTokens: integer("output_tokens"),
  createdAt: createdAt(),
}, (t) => [index("coach_msg_conv").on(t.conversationId, t.createdAt)]);

// ───────────── relations ─────────────

export const tradesRelations = relations(trades, ({ one, many }) => ({
  account: one(accounts, { fields: [trades.accountId], references: [accounts.id] }),
  strategy: one(strategies, { fields: [trades.strategyId], references: [strategies.id] }),
  setup: one(setups, { fields: [trades.setupId], references: [setups.id] }),
  notes: one(tradeNotes, { fields: [trades.id], references: [tradeNotes.tradeId] }),
  psychology: one(tradePsychology, { fields: [trades.id], references: [tradePsychology.tradeId] }),
  emotions: many(psychologyEntries),
  images: many(tradeImages),
  mistakes: many(tradeMistakes),
  checklist: many(checklistResponses),
  factors: many(tradeFactorRatings),
}));
export const tradeNotesRelations = relations(tradeNotes, ({ one }) => ({
  trade: one(trades, { fields: [tradeNotes.tradeId], references: [trades.id] }),
}));
export const tradePsychologyRelations = relations(tradePsychology, ({ one }) => ({
  trade: one(trades, { fields: [tradePsychology.tradeId], references: [trades.id] }),
}));
export const psychologyEntriesRelations = relations(psychologyEntries, ({ one }) => ({
  trade: one(trades, { fields: [psychologyEntries.tradeId], references: [trades.id] }),
}));
export const tradeImagesRelations = relations(tradeImages, ({ one }) => ({
  trade: one(trades, { fields: [tradeImages.tradeId], references: [trades.id] }),
}));
export const tradeMistakesRelations = relations(tradeMistakes, ({ one }) => ({
  trade: one(trades, { fields: [tradeMistakes.tradeId], references: [trades.id] }),
}));
export const checklistResponsesRelations = relations(checklistResponses, ({ one }) => ({
  trade: one(trades, { fields: [checklistResponses.tradeId], references: [trades.id] }),
}));
export const strategiesRelations = relations(strategies, ({ many }) => ({
  rules: many(strategyRules),
  setups: many(setups),
}));
export const strategyRulesRelations = relations(strategyRules, ({ one }) => ({
  strategy: one(strategies, { fields: [strategyRules.strategyId], references: [strategies.id] }),
}));
export const setupsRelations = relations(setups, ({ one }) => ({
  strategy: one(strategies, { fields: [setups.strategyId], references: [strategies.id] }),
}));
export const kbConceptsRelations = relations(kbConcepts, ({ many }) => ({
  sources: many(kbSources),
}));
export const kbSourcesRelations = relations(kbSources, ({ one }) => ({
  concept: one(kbConcepts, { fields: [kbSources.conceptSlug], references: [kbConcepts.slug] }),
}));

/** Per-trade rating of each configurable setup-score factor: 0 = absent, 1 = partial, 2 = clear. */
export const tradeFactorRatings = sqliteTable(
  "trade_factor_ratings",
  {
    id: id(),
    tradeId: text("trade_id").notNull().references(() => trades.id, { onDelete: "cascade" }),
    userId: userId(),
    factorKey: text("factor_key").notNull(),
    rating: integer("rating").notNull(),
  },
  (t) => [uniqueIndex("trade_factor_unique").on(t.tradeId, t.factorKey)],
);
export const tradeFactorRatingsRelations = relations(tradeFactorRatings, ({ one }) => ({
  trade: one(trades, { fields: [tradeFactorRatings.tradeId], references: [trades.id] }),
}));
