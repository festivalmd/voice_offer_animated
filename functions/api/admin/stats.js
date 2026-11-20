import { json, requireAdmin, readStats, todayKey } from "../../_middleware.js";

export async function onRequest(context) {
  const guard = await requireAdmin(context);
  if (guard) return guard;

  const { OFFER_CONFIG } = context.env;
  // readStats() never throws and always migrates legacy layouts into the
  // canonical shape { totalOpens, totalSpins, totalRedeems, byPrize, daily }.
  const stats = await readStats(OFFER_CONFIG);
  const config = await context.data.getConfig();

  return json({
    totals: {
      opens: stats.totalOpens,
      spins: stats.totalSpins,
      redeemed: stats.totalRedeems,
      byPrize: stats.byPrize || {}
    },
    daily: stats.daily || {},
    today: todayKey(),
    prizes: config.prizes || []
  });
}