import {
  json,
  pickPrize,
  todayKey,
  normalizePrizes,
  randomUUID,
  safeKVGet,
  safeKVPut
} from "../_middleware.js";

// body is wrapped so any unexpected runtime error is reported in the response
// body as { error } with status 500 instead of an opaque Cloudflare error page.
export const onRequestPost = async (context) => {
  const { OFFER_CONFIG } = context.env;

  try {
    // config is always a full, deep-merged shape (getConfig() never throws),
    // even when KV is empty or the stored blob is slightly malformed.
    const config = await context.data.getConfig();

    // Normalise prizes once: id/active/icon/weight/dailyLimit/name always exist.
    const prizes = normalizePrizes(config.prizes);
    const active = prizes.filter((p) => p.active);

    if (active.length === 0) {
      return json(
        { ok: false, error: "no_active_prizes", message: "No active prizes configured" },
        200
      );
    }

    // Weighted draw needs a strictly positive total; guard against zero-weight
    // misconfiguration so we never break on a degenerate prize list.
    const totalWeight = active.reduce((s, p) => s + (p.weight || 0), 0);

    // Read today's redeemed-per-prize counts so daily limits are respected.
    const today = todayKey();
    const statsNow = await readStatsSafe(OFFER_CONFIG);
    const todaysByPrize =
      (statsNow.daily[today] && statsNow.daily[today].byPrize) || {};

    let winner;
    if (totalWeight <= 0) {
      // Uniform fallback over active prizes.
      winner = active[Math.floor(Math.random() * active.length)];
    } else {
      winner = pickPrize(prizes, todaysByPrize, undefined);
      if (!winner) {
        // All active prizes have hit their daily limit / are out of budget.
        await bumpSpinStats(OFFER_CONFIG);
        return json(
          { ok: false, error: "all_exhausted", message: "All prizes for today are gone" },
          200
        );
      }
    }

    return issueWinner(context, config, winner);
  } catch (error) {
    return json({ ok: false, error: error ? error.message : String(error) }, 500);
  }
};

async function issueWinner(context, config, winner) {
  const { OFFER_CONFIG } = context.env;
  const today = todayKey();

  let stats = await readStatsSafe(OFFER_CONFIG);
  stats.totalOpens = (stats.totalOpens || 0) + 1;
  stats.totalSpins = (stats.totalSpins || 0) + 1;
  if (!stats.daily[today]) stats.daily[today] = { opens: 0, spins: 0, redeems: 0, byPrize: {} };
  stats.daily[today].opens = (stats.daily[today].opens || 0) + 1;
  stats.daily[today].spins = (stats.daily[today].spins || 0) + 1;

  const couponId = randomUUID();
  const entry = { id: couponId, prizeId: winner.id, createdAt: Date.now(), status: "issued" };

  let coupons = [];
  const couponsRaw = await safeKVGet(OFFER_CONFIG, "coupons", "json");
  coupons = Array.isArray(couponsRaw) ? couponsRaw : [];
  coupons.push(entry);
  if (coupons.length > 5000) coupons = coupons.slice(-5000);

  // Never throw if the KV binding is missing/unavailable.
  await safeKVPut(OFFER_CONFIG, "coupons", JSON.stringify(coupons));
  await safeKVPut(OFFER_CONFIG, "stats", JSON.stringify(stats));

  return json({
    ok: true,
    prize: {
      id: winner.id,
      icon: winner.icon || "🎁",
      image: winner.image || "",
      name: winner.name || {},
      color: winner.color || "#ffffff",
      couponId,
      revealSeconds: config.prizeRevealSeconds ?? 4.1,
      couponLifetimeMinutes: config.couponLifetimeMinutes ?? 15
    },
    stats: {
      totalOpens: stats.totalOpens,
      totalSpins: stats.totalSpins,
      todayOpens: stats.daily[today] ? stats.daily[today].opens : 0,
      todaySpins: stats.daily[today] ? stats.daily[today].spins : 0
    }
  });
}

// Never throw on stats: normalise absent/malformed values into a fixed shape and
// migrate the legacy { days } layout into { total*, byPrize, daily }.
async function readStatsSafe(OFFER_CONFIG) {
  const raw = await safeKVGet(OFFER_CONFIG, "stats", "json");
  return normalizeStats(raw);
}

function normalizeStats(raw) {
  const s = {
    totalOpens: 0,
    totalSpins: 0,
    totalRedeems: 0,
    byPrize: {},
    daily: {}
  };
  if (!raw || typeof raw !== "object") return s;

  s.totalOpens = Number(raw.totalOpens) || 0;
  s.totalSpins = Number(raw.totalSpins) || 0;
  s.totalRedeems = Number(raw.totalRedeems) || 0;
  s.byPrize = raw.byPrize || {};
  s.daily = raw.daily || {};

  // Migrate the older { days: {...} } shape, if present.
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

async function bumpSpinStats(OFFER_CONFIG) {
  const today = todayKey();
  let stats = await readStatsSafe(OFFER_CONFIG);
  stats.totalSpins = (stats.totalSpins || 0) + 1;
  if (!stats.daily[today]) stats.daily[today] = { opens: 0, spins: 0, redeems: 0, byPrize: {} };
  stats.daily[today].spins = (stats.daily[today].spins || 0) + 1;
  await safeKVPut(OFFER_CONFIG, "stats", JSON.stringify(stats));
}

// Cloudflare Pages resolves the verb-specific export if present; we keep a
// catch-all so a non-POST request still gets a clean JSON 405 instead of 500.
export async function onRequest(context) {
  if (context.request.method === "POST") {
    return onRequestPost(context);
  }
  return json({ ok: false, error: "method_not_allowed" }, 405);
}