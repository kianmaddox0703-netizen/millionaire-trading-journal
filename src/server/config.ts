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
  anthropicModel: () => process.env.ANTHROPIC_MODEL || "claude-sonnet-5-5",
  marketDataProvider: () => (process.env.MARKET_DATA_PROVIDER || "none") as "none" | "oanda" | "twelvedata",
};
