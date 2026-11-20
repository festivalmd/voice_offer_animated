import { json } from "../_middleware.js";

// Public config: everything needed by the guest client (no admin secrets).
export async function onRequest(context) {
  const config = await context.data.getConfig();
  return json({
    googleReviewsUrl: config.googleReviewsUrl || "",
    couponLifetimeMinutes: config.couponLifetimeMinutes ?? 15,
    prizeRevealSeconds: config.prizeRevealSeconds ?? 4.1,
    // Idle ping-pong loop of the closed shaker (before the guest presses spin).
    idleLoopStart: config.idleLoopStart ?? 0.2,
    idleLoopEnd: config.idleLoopEnd ?? 2.4,
    dailySpinLimitPerUser: config.dailySpinLimitPerUser ?? 0,
    enforceUserLimit: config.enforceUserLimit !== false,
    prizeLabel: config.prizeLabel || { ro: "Premiu", ru: "ПРИЗ", en: "PRIZE" },
    prizeLabelColor: config.prizeLabelColor || "#d4af37",
    // Start screen texts + colors (editable in the admin panel).
    startTitle: config.startTitle || null,
    startTitleColor: config.startTitleColor || "#ffffff",
    startSubtitle: config.startSubtitle || null,
    startSubtitleColor: config.startSubtitleColor || "#cbd5e1",
    startButtonText: config.startButtonText || null,
    startButtonTextColor: config.startButtonTextColor || "#ffffff",
    startButtonBgColor: config.startButtonBgColor || "#e94560",
    // Prizes were missing here: the guest page silently fell back to its
    // hard-coded defaults, so admin edits to prizes never showed up.
    prizes: Array.isArray(config.prizes) ? config.prizes : []
  }, 200, {
    // Admin edits must show up on the next /pad load, never from an HTTP cache.
    "Cache-Control": "no-store"
  });
}