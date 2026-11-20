import { json, requireAdmin, safeKVPut } from "../../_middleware.js";

// Cloudflare Pages Functions route by export NAME: onRequestGet / onRequestPut.
export async function onRequestGet(context) {
  const guard = await requireAdmin(context);
  if (guard) return guard;
  const config = await context.data.getConfig();
  return json(config);
}

export async function onRequestPut(context) {
  const guard = await requireAdmin(context);
  if (guard) return guard;

  let body = {};
  try {
    body = await context.request.json();
  } catch (e) {
    return json({ error: "invalid_json" }, 400);
  }

  const next = sanitizeConfig(body);
  // Never throw if the KV binding is missing (e.g. fresh local dev).
  await safeKVPut(context.env.OFFER_CONFIG, "config", JSON.stringify(next));
  return json({ ok: true, config: next });
}

function sanitizeConfig(body) {
  const prizes = Array.isArray(body.prizes)
    ? body.prizes.map((p) => ({
        id: String(p.id || Math.random().toString(36).slice(2)),
        active: !!p.active,
        icon: String(p.icon || "🎁"),
        image: String(p.image != null ? p.image : ""),
        weight: Math.max(0, Number(p.weight) || 0),
        dailyLimit: Math.max(0, Math.floor(Number(p.dailyLimit) || 0)),
        name: {
          ro: String((p.name && p.name.ro) || ""),
          ru: String((p.name && p.name.ru) || ""),
          en: String((p.name && p.name.en) || "")
        }
      }))
    : [];

  return {
    googleReviewsUrl:
      typeof body.googleReviewsUrl === "string"
        ? body.googleReviewsUrl
        : "",
    couponLifetimeMinutes: Math.max(1, Math.floor(Number(body.couponLifetimeMinutes) || 15)),
    prizeRevealSeconds: Math.max(0, Number(body.prizeRevealSeconds) || 4.1),
    dailySpinLimitPerUser: Math.max(0, Math.floor(Number(body.dailySpinLimitPerUser) || 0)),
    enforceUserLimit: body.enforceUserLimit !== false,
    prizes
  };
}