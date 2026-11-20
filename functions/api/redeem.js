import { json, todayKey, safeKVGet, safeKVPut } from "../_middleware.js";

// body is wrapped so any unexpected runtime error is reported in the response
// body as { error } with status 500 instead of an opaque Cloudflare error page.
export const onRequestPost = async (context) => {
  try {
    if (context.request.method !== "POST") {
      return json({ error: "method_not_allowed" }, 405);
    }

    let body = {};
    try {
      body = await context.request.json();
    } catch (e) {}

    const couponId = body.couponId;
    if (!couponId) return json({ error: "missing_coupon" }, 400);

    const { OFFER_CONFIG } = context.env;
    const config = await context.data.getConfig();

    let coupons = [];
    const couponsRaw = await safeKVGet(OFFER_CONFIG, "coupons", "json");
    coupons = Array.isArray(couponsRaw) ? couponsRaw : [];

    const idx = coupons.findIndex((c) => c.id === couponId);
    if (idx === -1) return json({ error: "coupon_not_found" }, 404);

    const coupon = coupons[idx];
    if (coupon.status === "redeemed") {
      return json({ error: "already_redeemed", status: "redeemed" }, 409);
    }

    const lifetimeMs = (config.couponLifetimeMinutes ?? 15) * 60 * 1000;
    if (Date.now() - coupon.createdAt > lifetimeMs) {
      coupon.status = "expired";
      await safeKVPut(OFFER_CONFIG, "coupons", JSON.stringify(coupons));
      return json({ error: "expired", status: "expired" }, 410);
    }

    coupon.status = "redeemed";
    coupon.redeemedAt = Date.now();

    // Update normalised stats shape.
    const today = todayKey();
    let stats = await readStatsSafe(OFFER_CONFIG);
    stats.totalRedeems = (stats.totalRedeems || 0) + 1;
    if (!stats.daily[today]) stats.daily[today] = { opens: 0, spins: 0, redeems: 0, byPrize: {} };
    stats.daily[today].redeems = (stats.daily[today].redeems || 0) + 1;
    stats.daily[today].byPrize = stats.daily[today].byPrize || {};
    stats.daily[today].byPrize[coupon.prizeId] =
      (stats.daily[today].byPrize[coupon.prizeId] || 0) + 1;
    stats.byPrize[coupon.prizeId] = (stats.byPrize[coupon.prizeId] || 0) + 1;

    await safeKVPut(OFFER_CONFIG, "coupons", JSON.stringify(coupons));
    await safeKVPut(OFFER_CONFIG, "stats", JSON.stringify(stats));

    return json({
      ok: true,
      status: "redeemed",
      coupon
    });
  } catch (error) {
    return json({ ok: false, error: error ? error.message : String(error) }, 500);
  }
};

// Never throw on stats: normalise absent/malformed values and migrate legacy
// { days } layout into the flat shape.
async function readStatsSafe(OFFER_CONFIG) {
  const raw = await safeKVGet(OFFER_CONFIG, "stats", "json");
  const s = { totalOpens: 0, totalSpins: 0, totalRedeems: 0, byPrize: {}, daily: {} };
  if (!raw || typeof raw !== "object") return s;

  s.totalOpens = Number(raw.totalOpens) || 0;
  s.totalSpins = Number(raw.totalSpins) || 0;
  s.totalRedeems = Number(raw.totalRedeems) || 0;
  s.byPrize = raw.byPrize || {};
  s.daily = raw.daily || {};

  if (raw.days && typeof raw.days === "object") {
    for (const [day, d] of Object.entries(raw.days)) {
      if (!d || typeof d !== "object") continue;
      const slot = s.daily[day] || { opens: 0, spins: 0, redeems: 0, byPrize: {} };
      slot.opens += d.opens || 0;
      slot.spins += d.spins || 0;
      slot.redeems += typeof d.redeems === "number" ? d.redeems : 0;
      if (d.redeemed && typeof d.redeemed === "object") {
        for (const [pid, n] of Object.entries(d.redeemed)) {
          slot.byPrize[pid] = (slot.byPrize[pid] || 0) + (Number(n) || 0);
          s.byPrize[pid] = (s.byPrize[pid] || 0) + (Number(n) || 0);
        }
      }
      s.daily[day] = slot;
    }
  }
  return s;
}

// Cloudflare Pages resolves the verb-specific export if present; keep a
// catch-all so a non-POST request still gets a clean JSON 405 instead of 500.
export async function onRequest(context) {
  if (context.request.method === "POST") {
    return onRequestPost(context);
  }
  return json({ ok: false, error: "method_not_allowed" }, 405);
}