import { json, requireAdmin, safeKVPut } from "../../_middleware.js";

// Cloudflare Pages Functions route by export NAME: onRequestGet / onRequestPut.
export async function onRequestGet(context) {
  const guard = await requireAdmin(context);
  if (guard) return guard;
  const config = await context.data.getConfig();
  return json(config);
}

// PUT /api/admin/config — the admin panel sends the whole config object.
export async function onRequestPut(context) {
  const guard = await requireAdmin(context);
  if (guard) return guard;
  return saveConfig(context);
}

// Same handler for POST so an older cached pad.html (or a client that can only
// POST) cannot silently fail with "method not allowed".
export async function onRequestPost(context) {
  const guard = await requireAdmin(context);
  if (guard) return guard;
  return saveConfig(context);
}

async function saveConfig(context) {
  let body = {};
  try {
    body = await context.request.json();
  } catch (e) {
    return json({ error: "invalid_json" }, 400);
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return json({ error: "invalid_body" }, 400);
  }

  // Merge over the stored config so a partial body never wipes fields.
  const current = await context.data.getConfig();
  const next = sanitizeConfig(Object.assign({}, current, body));
  // Never throw if the KV binding is missing, but never report a fake 200 either:
  // a failed/unbound write used to answer `{ ok: true }` while /pad kept reading
  // the bundled defaults after a reload.
  const stored = await safeKVPut(context.env.OFFER_CONFIG, "config", JSON.stringify(next));
  if (!stored) {
    return json({ ok: false, error: "kv_write_failed", config: next }, 500);
  }
  return json({ ok: true, config: next }, 200);
}

// Coerce a boolean flag while keeping an explicit `false` (the panel sends the
// unchecked checkbox as `false` and it must never be flipped back to `true`).
function toBool(value, fallback) {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  if (typeof value === "string") {
    const v = value.trim().toLowerCase();
    if (v === "false" || v === "0" || v === "off" || v === "no" || v === "") return false;
    if (v === "true" || v === "1" || v === "on" || v === "yes") return true;
  }
  return fallback;
}

function toStr(value, fallback) {
  if (typeof value === "string") return value.trim();
  if (value == null) return fallback;
  return String(value).trim();
}

function toNumber(value, fallback, { min = 0, int = false } = {}) {
  const n = typeof value === "number" ? value : parseFloat(String(value == null ? "" : value).replace(",", "."));
  if (!isFinite(n)) return fallback;
  const v = int ? Math.floor(n) : Math.round(n * 1000) / 1000;
  return Math.max(min, v);
}

// Link is optional: empty is fine, but when present it must be a real http(s)
// URL (the admin field is type="url", a bare value would break the guest flow).
function toUrl(value, fallback) {
  const raw = toStr(value, fallback);
  if (!raw) return "";
  // Require an explicit http(s) scheme: the guest app opens this link directly.
  if (!/^https?:\/\/[^\s]+$/i.test(raw)) return fallback;
  try {
    const u = new URL(raw);
    if (u.protocol === "http:" || u.protocol === "https:") return raw;
  } catch (e) {
    // fall through to the previous value
  }
  return fallback;
}

// Hex color (#rgb / #rrggbb) -> lowercase #rrggbb, otherwise the fallback.
function toColor(value, fallback) {
  const v = toStr(value, "");
  if (/^#[0-9a-fA-F]{6}$/.test(v)) return v.toLowerCase();
  if (/^#[0-9a-fA-F]{3}$/.test(v)) {
    const h = v.slice(1).toLowerCase();
    return "#" + h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
  }
  return fallback;
}

// Localized free text: one entry per language, trimmed. `fallback` is the
// previously stored value, so a blank language keeps what the guest saw before
// instead of turning into an empty heading.
function toLangText(value, fallback) {
  const fb = fallback && typeof fallback === "object" ? fallback : {};
  const src = value && typeof value === "object" ? value : {};
  return {
    ro: toStr(src.ro, toStr(fb.ro, "")),
    ru: toStr(src.ru, toStr(fb.ru, "")),
    en: toStr(src.en, toStr(fb.en, ""))
  };
}

function sanitizeConfig(body) {
  const src = body && typeof body === "object" ? body : {};
  const prizes = Array.isArray(src.prizes)
    ? src.prizes
        .filter((p) => p && typeof p === "object")
        .map((p, idx) => ({
          id: toStr(p.id, "") || "prize-" + Date.now().toString(36) + "-" + idx,
          active: toBool(p.active, true),
          icon: toStr(p.icon, "🎁") || "🎁",
          image: typeof p.image === "string" ? p.image : "",
          color: /^#[0-9a-fA-F]{6}$/.test(String(p.color || ""))
            ? String(p.color).toLowerCase()
            : "#ffffff",
          weight: toNumber(p.weight, 0),
          dailyLimit: toNumber(p.dailyLimit, 0, { int: true }),
          name: {
            ro: toStr(p.name && p.name.ro, ""),
            ru: toStr(p.name && p.name.ru, ""),
            en: toStr(p.name && p.name.en, "")
          }
        }))
    : [];

  return {
    googleReviewsUrl: toUrl(src.googleReviewsUrl, ""),
    couponLifetimeMinutes: toNumber(src.couponLifetimeMinutes, 15, { min: 1, int: true }),
    prizeRevealSeconds: toNumber(src.prizeRevealSeconds, 4.1),
    // Idle ping-pong loop bounds (seconds inside the guest video).
    idleLoopStart: toNumber(src.idleLoopStart, 0.2),
    idleLoopEnd: toNumber(src.idleLoopEnd, 2.4),
    dailySpinLimitPerUser: toNumber(src.dailySpinLimitPerUser, 0, { int: true }),
    // Explicit `false` is preserved (never coerced back to `true`).
    enforceUserLimit: toBool(src.enforceUserLimit, true),
    prizeLabel: {
      ro: toStr(src.prizeLabel && src.prizeLabel.ro, ""),
      ru: toStr(src.prizeLabel && src.prizeLabel.ru, ""),
      en: toStr(src.prizeLabel && src.prizeLabel.en, "")
    },
    prizeLabelColor: /^#[0-9a-fA-F]{6}$/.test(String(src.prizeLabelColor || ""))
      ? String(src.prizeLabelColor).toLowerCase()
      : "#d4af37",
    // Start screen texts + colors (index.html). Texts keep the previously saved
    // language values when a field comes back blank; colors must be valid hex.
    startTitle: toLangText(src.startTitle, {
      ro: "Compliment de la barmanul Voice Club",
      ru: "Комплимент от бармена Voice Club",
      en: "Compliment from the Voice Club bartender"
    }),
    startTitleColor: toColor(src.startTitleColor, "#ffffff"),
    startSubtitle: toLangText(src.startSubtitle, {
      ro: "Scutură shaker-ul și află cadoul tău pentru un review în Google",
      ru: "Встряхни шейкер и узнай свой подарок за отзыв в Google",
      en: "Shake the shaker and find out your gift for a Google review"
    }),
    startSubtitleColor: toColor(src.startSubtitleColor, "#cbd5e1"),
    startButtonText: toLangText(src.startButtonText, {
      ro: "Scutură shaker-ul",
      ru: "Встряхнуть шейкер",
      en: "Shake the shaker"
    }),
    startButtonTextColor: toColor(src.startButtonTextColor, "#ffffff"),
    startButtonBgColor: toColor(src.startButtonBgColor, "#e94560"),
    prizes
  };
}