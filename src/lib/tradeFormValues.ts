/** Shape of the trade form state (strings as typed by the user). Shared by server pages and the client form. */
export interface TradeFormValues {
  accountId: string; strategyId: string; setupId: string; symbol: string; direction: "long" | "short"; status: "open" | "closed";
  openedAt: string; closedAt: string; entryPrice: string; initialStop: string; takeProfit: string; exitPrice: string; sizeLots: string;
  riskAmount: string; netPnl: string; commission: string; swap: string; fees: string;
  session: string; timeframe: string; marketCondition: string; trend: string; htfBias: string; setupQuality: string; entryConfirmation: string; confluences: string; chartUrl: string;
  notes: Record<string, string>;
  psych: { confidence: string; discipline: string; followedPlan: string; fomo: boolean; revenge: boolean; movedStop: boolean; exitedEarly: boolean; overtraded: boolean; lateEntry: boolean; oversized: boolean };
  emotions: { before: string; during: string; after: string };
  mistakes: string[];
  factors: Record<string, number | null>;
  checklist: { phase: "pre" | "post"; item: string; checked: boolean | null; answer: string | null }[];
}

const nowLocal = () => {
  const d = new Date();
  d.setSeconds(0, 0);
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
};

export function emptyValues(accountId: string): TradeFormValues {
  return {
    accountId, strategyId: "", setupId: "", symbol: "", direction: "long", status: "closed", openedAt: nowLocal(), closedAt: nowLocal(),
    entryPrice: "", initialStop: "", takeProfit: "", exitPrice: "", sizeLots: "", riskAmount: "", netPnl: "", commission: "", swap: "", fees: "",
    session: "", timeframe: "", marketCondition: "", trend: "", htfBias: "", setupQuality: "", entryConfirmation: "", confluences: "", chartUrl: "",
    notes: {}, psych: { confidence: "", discipline: "", followedPlan: "", fomo: false, revenge: false, movedStop: false, exitedEarly: false, overtraded: false, lateEntry: false, oversized: false },
    emotions: { before: "", during: "", after: "" }, mistakes: [], factors: {}, checklist: [],
  };
}

