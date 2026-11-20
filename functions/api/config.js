import { json } from "../_middleware.js";

// Public config: everything needed by the guest client (no admin secrets).
export async function onRequest(context) {
  const config = await context.data.getConfig();
  return json({
    googleReviewsUrl: config.googleReviewsUrl || "",
    couponLifetimeMinutes: config.couponLifetimeMinutes ?? 15,
    prizeRevealSeconds: config.prizeRevealSeconds ?? 4.1,
    dailySpinLimitPerUser: config.dailySpinLimitPerUser ?? 0,
    enforceUserLimit: config.enforceUserLimit !== false
  });
}