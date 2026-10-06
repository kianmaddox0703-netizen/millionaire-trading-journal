import path from "node:path";

export function dataDir() {
  // Runtime location chosen by env; not part of the build output.
  return path.resolve(/*turbopackIgnore: true*/ process.env.DATA_DIR || "./data");
}

export const config = {
  appUrl: () => process.env.APP_URL || "http://localhost:3000",
  cookieSecure: () => process.env.COOKIE_SECURE === "true",
  allowRegistration: () => process.env.ALLOW_REGISTRATION !== "false",
  anthropicKey: () => process.env.ANTHROPIC_API_KEY || "",
  anthropicModel: () => process.env.ANTHROPIC_MODEL || "claude-opus-5-5",
  marketDataProvider: () => {
    const v = process.env.MARKET_DATA_PROVIDER || "none";
    return (v === "oanda" || v === "twelvedata" ? v : "none") as "none" | "oanda" | "twelvedata";
  },
  oandaToken: () => process.env.OANDA_API_TOKEN || "",
  oandaEnv: () => (process.env.OANDA_ENV === "live" ? "live" : "practice") as "practice" | "live",
  twelveDataKey: () => process.env.TWELVEDATA_API_KEY || "",
};
