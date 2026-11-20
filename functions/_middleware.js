// Defaults are mirrored from /config.json so /api/spin can never explode on an
// empty KV. If the admin never saved anything, these prizes are used as-is.
const DEFAULT_CONFIG = {
  googleReviewsUrl: "https://www.google.com/search?q=Voice+Club",
  couponLifetimeMinutes: 15,
  prizeRevealSeconds: 4.1,
  // Idle "shaking" loop of the closed shaker: the guest video ping-pongs
  // between these two seconds until the guest presses the spin button.
  idleLoopStart: 0.2,
  idleLoopEnd: 2.4,
  dailySpinLimitPerUser: 0,
  enforceUserLimit: true,
  prizeLabel: { ro: "Premiu", ru: "ПРИЗ", en: "PRIZE" },
  prizeLabelColor: "#d4af37",
  // Start screen (index.html): heading, subtitle and spin button texts per
  // language + their colors. The button background is an accent color from
  // which the client builds the gradient and the glow.
  startTitle: {
    ro: "Compliment de la barmanul Voice Club",
    ru: "Комплимент от бармена Voice Club",
    en: "Compliment from the Voice Club bartender"
  },
  startTitleColor: "#ffffff",
  startSubtitle: {
    ro: "Scutură shaker-ul și află cadoul tău pentru un review în Google",
    ru: "Встряхни шейкер и узнай свой подарок за отзыв в Google",
    en: "Shake the shaker and find out your gift for a Google review"
  },
  startSubtitleColor: "#cbd5e1",
  startButtonText: {
    ro: "Scutură shaker-ul",
    ru: "Встряхнуть шейкер",
    en: "Shake the shaker"
  },
  startButtonTextColor: "#ffffff",
  startButtonBgColor: "#e94560",
  prizes: [
    {
      id: "shot-mojito",
      active: true,
      icon: "🍹",
      image: "",
      weight: 40,
      dailyLimit: 20,
      color: "#ffffff",
      name: { ro: "Shot de Mojito", ru: "Шот Мохито", en: "Mojito Shot" }
    },
    {
      id: "cocktail-stage",
      active: true,
      icon: "🍸",
      image: "",
      weight: 25,
      dailyLimit: 12,
      color: "#ffffff",
      name: { ro: "Cocktail din stage", ru: "Коктейль со сцены", en: "Stage Cocktail" }
    },
    {
      id: "dance-lesson",
      active: true,
      icon: "💃",
      image: "",
      weight: 15,
      dailyLimit: 10,
      color: "#ffffff",
      name: { ro: "Lecție de dans", ru: "Урок танцев", en: "Dance Lesson" }
    },
    {
      id: "vip-booth",
      active: true,
      icon: "🛋️",
      image: "",
      weight: 12,
      dailyLimit: 5,
      color: "#ffffff",
      name: { ro: "Ridicare la VIP", ru: "Подъём в VIP", en: "VIP Upgrade" }
    },
    {
      id: "private-bartender",
      active: true,
      icon: "🥃",
      image: "",
      weight: 8,
      dailyLimit: 3,
      color: "#ffffff",
      name: { ro: "Bartender personal", ru: "Личный бармен", en: "Private Bartender" }
    }
  ]
};

export const onRequest = async (context) => {
  // Expose helpers used by every route. Wrapped so a missing KV or a malformed
  // stored config can never turn a guest request into a 500.
  // Helpers are attached to context.data so they propagate through the
  // middleware chain to the downstream handler (Cloudflare Pages shares the
  // context.data object across functions). Direct props are lost.
  context.data.configDefaults = DEFAULT_CONFIG;
  context.data.getConfig = async () => {
    // A KV binding (or a local dev shim) may hand back a JSON *string* even when
    // `type = "json"` is requested. Accept both shapes so the saved values are
    // always read back instead of silently falling through to the defaults.
    let raw = await safeKVGet(context.env.OFFER_CONFIG, "config", "json");
    if (typeof raw === "string") {
      try { raw = JSON.parse(raw); } catch (e) { raw = null; }
    }
    if (raw && typeof raw === "object") {
      return normalizeConfig(raw);
    }
    // KV missing/empty/unavailable -> fall back to bundled defaults AND make
    // sure those defaults exist in KV. Without the write, a fresh local dev
    // binding had nothing persisted, so a PUT plus reload always came back to
    // the in-code defaults (the saved file was never read, never re-written).
    await safeKVPut(context.env.OFFER_CONFIG, "config", JSON.stringify(DEFAULT_CONFIG));
    return normalizeConfig(DEFAULT_CONFIG);
  };

  // Generic middleware: do NOT abort based on method. PUT/POST/GET all reach
  // the targeted function below. Auth is enforced per-route via requireAdmin().
  return await context.next();
};

// Read a KV key without throwing. Returns null when the binding is missing.
export async function safeKVGet(binding, key, type) {
  if (!binding || typeof binding.get !== "function") return null;
  try {
    return await binding.get(key, type);
  } catch (e) {
    return null;
  }
}

// Write a KV key without throwing. No-op when the binding is missing.
export async function safeKVPut(binding, key, value) {
  if (!binding || typeof binding.put !== "function") return false;
  try {
    await binding.put(key, value);
    return true;
  } catch (e) {
    return false;
  }
}

// Deep-merge a stored config over the defaults so any single field the admin
// saved in a slightly different shape can never leave required pieces missing.
function normalizeConfig(raw) {
  const base = JSON.parse(JSON.stringify(DEFAULT_CONFIG));
  if (!raw || typeof raw !== "object") return base;

  const out = {
    googleReviewsUrl:
      typeof raw.googleReviewsUrl === "string" ? raw.googleReviewsUrl : base.googleReviewsUrl,
    couponLifetimeMinutes:
      typeof raw.couponLifetimeMinutes === "number"
        ? raw.couponLifetimeMinutes
        : base.couponLifetimeMinutes,
    prizeRevealSeconds:
      typeof raw.prizeRevealSeconds === "number" ? raw.prizeRevealSeconds : base.prizeRevealSeconds,
    idleLoopStart:
      typeof raw.idleLoopStart === "number"
        ? normalizeLoopTime(raw.idleLoopStart, base.idleLoopStart)
        : base.idleLoopStart,
    idleLoopEnd:
      typeof raw.idleLoopEnd === "number"
        ? normalizeLoopTime(raw.idleLoopEnd, base.idleLoopEnd)
        : base.idleLoopEnd,
    dailySpinLimitPerUser:
      typeof raw.dailySpinLimitPerUser === "number"
        ? raw.dailySpinLimitPerUser
        : base.dailySpinLimitPerUser,
    enforceUserLimit:
      typeof raw.enforceUserLimit === "boolean"
        ? raw.enforceUserLimit
        : base.enforceUserLimit,
    prizeLabel:
      raw.prizeLabel && typeof raw.prizeLabel === "object"
        ? normalizeName(raw.prizeLabel)
        : base.prizeLabel,
    prizeLabelColor: normalizeColor(raw.prizeLabelColor, base.prizeLabelColor),
    // Start screen texts + colors. A missing/blank language falls back to the
    // bundled default so the guest page never renders an empty heading.
    startTitle: normalizeText(raw.startTitle, base.startTitle),
    startTitleColor: normalizeColor(raw.startTitleColor, base.startTitleColor),
    startSubtitle: normalizeText(raw.startSubtitle, base.startSubtitle),
    startSubtitleColor: normalizeColor(raw.startSubtitleColor, base.startSubtitleColor),
    startButtonText: normalizeText(raw.startButtonText, base.startButtonText),
    startButtonTextColor: normalizeColor(raw.startButtonTextColor, base.startButtonTextColor),
    startButtonBgColor: normalizeColor(raw.startButtonBgColor, base.startButtonBgColor),
    prizes: Array.isArray(raw.prizes) ? normalizePrizes(raw.prizes) : base.prizes
  };
  return out;
}
// Make every prize carry a uniform shape {id, active, icon, image, weight,
// dailyLimit, name:{ro,ru,en}}. Tolerates `names` instead of `name`, a string
// name, or a flat icon property so prizes saved by the admin always survive.
export function normalizePrizes(prizes) {
  return (Array.isArray(prizes) ? prizes : [])
    .filter((p) => p && typeof p === "object")
    .map((p) => ({
      id: String(p.id != null ? p.id : "prize-" + Math.random().toString(36).slice(2)),
      active: !!p.active,
      icon: String(p.icon || p.emoji || "🎁"),
      image: String(p.image != null ? p.image : ""),
      weight: Math.max(0, Number(p.weight) || 0),
      dailyLimit: Math.max(0, Math.floor(Number(p.dailyLimit) || 0)),
      color: normalizeColor(p.color, "#ffffff"),
      name: normalizeName(p.name || p.names)
    }));
}

// Idle loop bounds are video timestamps in seconds: never negative, rounded to
// milliseconds (same precision as the admin fields, step 0.1 s).
function normalizeLoopTime(value, fallback) {
  const n = Number(value);
  if (!isFinite(n) || n < 0) return fallback;
  return Math.round(n * 1000) / 1000;
}

function normalizeColor(value, fallback) {
  if (typeof value !== "string") return fallback;
  const v = value.trim();
  // Accept hex/there is a small set of simple forms we can trust without a DOM.
  if (/^#[0-9a-fA-F]{6}$/.test(v) || /^#[0-9a-fA-F]{3}$/.test(v)) return v;
  return fallback;
}

function normalizeName(name) {
  if (typeof name === "string") return { ro: name, ru: name, en: name };
  if (!name || typeof name !== "object") return { ro: "", ru: "", en: "" };
  return {
    ro: String(name.ro || name.Ro || ""),
    ru: String(name.ru || name.Ru || ""),
    en: String(name.en || name.En || "")
  };
}

// Localized free text (start screen headings etc.): every language falls back
// to the bundled default when the stored value is missing or blank, so the
// guest page can never show an empty title/subtitle/button.
function normalizeText(value, fallback) {
  const fb = fallback && typeof fallback === "object" ? fallback : { ro: "", ru: "", en: "" };
  const src = value && typeof value === "object" ? value : {};
  const pick = (l) => {
    const v = typeof src[l] === "string" ? src[l].trim() : "";
    return v || fb[l] || "";
  };
  return { ro: pick("ro"), ru: pick("ru"), en: pick("en") };
}

// Stats live under a single normalised shape that both current and older saved
// layouts can survive: { totalOpens, totalSpins, totalRedeems, byPrize, daily }.
export function emptyStats() {
  return { totalOpens: 0, totalSpins: 0, totalRedeems: 0, byPrize: {}, daily: {} };
}

// Read stats, migrating the legacy { days: {...} } layout into the flat shape.
export async function readStats(OFFER_CONFIG) {
  const raw = await safeKVGet(OFFER_CONFIG, "stats", "json");
  if (!raw || typeof raw !== "object") return emptyStats();

  const s = {
    totalOpens: Number(raw.totalOpens) || 0,
    totalSpins: Number(raw.totalSpins) || 0,
    totalRedeems: Number(raw.totalRedeems) || 0,
    byPrize: raw.byPrize || {},
    daily: raw.daily || {}
  };

  // Migrate legacy { days: { "YYYY-MM-DD": {...} } } if present.
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

export function todayKey(date = new Date()) {
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${m}-${d}`;
}

export function randomUUID() {
  const g = globalThis.crypto;
  if (g && typeof g.randomUUID === "function") return g.randomUUID();
  // Fallback for runtimes without crypto.randomUUID.
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

// Local-dev fallback: without .dev.vars / dashboard secrets ADMIN_USER and
// ADMIN_PASS are undefined, so btoa would compare against "undefined:undefined"
// and every login (including admin/1234) failed with 401. Production must set
// real values via `wrangler pages secret put`; locally admin/1234 always works.
const DEFAULT_ADMIN_USER = "admin";
const DEFAULT_ADMIN_PASS = "1234";

// Shared authentication guard for admin-only routes.
export async function requireAdmin(context) {
  const env = context.env || {};
  const adminUser = env.ADMIN_USER || DEFAULT_ADMIN_USER;
  const adminPass = env.ADMIN_PASS || DEFAULT_ADMIN_PASS;
  const auth = context.request.headers.get("Authorization") || "";
  const expected = "Basic " + btoa(`${adminUser}:${adminPass}`);

  if (auth !== expected) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: {
        "Content-Type": "application/json",
        "WWW-Authenticate": 'Basic realm="Voice Club Admin"'
      }
    });
  }
  return null;
}

function json(data, status = 200, extraHeaders) {
  return new Response(JSON.stringify(data), {
    status,
    headers: Object.assign({ "Content-Type": "application/json; charset=utf-8" }, extraHeaders || {})
  });
}

// Weighted random selection among active prizes that still have daily budget.
function pickPrize(prizes, todaysCountByPrizeId, dailyLimitPerPrizeToday) {
  const open = prizes.filter((p) => {
    if (!p.active) return false;
    const limit = dailyLimitPerPrizeToday !== undefined
      ? dailyLimitPerPrizeToday
      : (p.dailyLimit || 0);
    const used = todaysCountByPrizeId[p.id] || 0;
    // dailyLimit === 0 means unlimited
    return limit <= 0 || used < limit;
  });
  if (open.length === 0) return null;

  const total = open.reduce((s, p) => s + (p.weight || 0), 0);
  let roll = Math.random() * total;
  for (const p of open) {
    roll -= p.weight || 0;
    if (roll < 0) return p;
  }
  return open[open.length - 1];
}

export { json, pickPrize };