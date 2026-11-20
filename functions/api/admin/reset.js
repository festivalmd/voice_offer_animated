import { json, requireAdmin, safeKVPut } from "../../_middleware.js";

// Clears stats & coupons and restores default test config (helper for QA).
// Cloudflare Pages Functions route by export NAME: onRequestPost.
export async function onRequestPost(context) {
  const guard = await requireAdmin(context);
  if (guard) return guard;

  const { OFFER_CONFIG } = context.env;
  const defaults = context.data.configDefaults || await context.data.getConfig();
  await safeKVPut(OFFER_CONFIG, "config", JSON.stringify(defaults));
  await safeKVPut(OFFER_CONFIG, "stats", JSON.stringify({ days: {} }));
  await safeKVPut(OFFER_CONFIG, "coupons", JSON.stringify([]));

  return json({ ok: true });
}