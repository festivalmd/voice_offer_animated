// Defaults are mirrored from /config.json so /api/spin can never explode on an
// empty KV. If the admin never saved anything, these prizes are used as-is.
const DEFAULT_CONFIG = {
  googleReviewsUrl: "https://www.google.com/search?q=Voice+Club",
  couponLifetimeMinutes: 15,
  prizeRevealSeconds: 4.1,
  dailySpinLimitPerUser: 0,
  enforceUserLimit: true,
  prizes: [
    {
      id: "shot-mojito",
      active: true,
      icon: "🍹",
      image: "",
      weight: 40,
      dailyLimit: 20,
      name: { ro: "Shot de Mojito", ru: "Шот Мохито", en: "Mojito Shot" }
    },
    {
      id: "cocktail-stage",
      active: true,
      icon: "🍸",
      image: "",
      weight: 25,
      dailyLimit: 12,
      name: { ro: "Cocktail din stage", ru: "Коктейль со сцены", en: "Stage Cocktail" }
    },
    {
      id: "dance-lesson",
      active: true,
      icon: "💃",
      image: "",
      weight: 15,
      dailyLimit: 10,
      name: { ro: "Lecție de dans", ru: "Урок танцев", en: "Dance Lesson" }
    },
    {
      id: "vip-booth",
      active: true,
      icon: "🛋️",
      image: "",
      weight: 12,
      dailyLimit: 5,
      name: { ro: "Ridicare la VIP", ru: "Подъём в VIP", en: "VIP Upgrade" }
    },
    {
      id: "private-bartender",
      active: true,
      icon: "🥃",
      image: "",
      weight: 8,
      dailyLimit: 3,
      name: { ro: "Bartender personal", ru: "Личный бармен", en: "Private Bartender" }
    }
  ]
};

export const onRequest = async (context) => {
  // Expose helpers used by every route. Wrapped so a missing KV or a malformed
  // stored config can never turn a guest request into a 500.
  // Helpers are attached to context.data so they propagate through the
  // middleware chain to the downstream handler (Cloudflare Pages shares the
  // context.data object across functions). Direct context props are lost.
  context.data.configDefaults = DEFAULT_CONFIG;
  context.data.getConfig = async () => {
    const raw = await safeKVGet(context.env.OFFER_CONFIG, "config", "json");
    if (raw && typeof raw === "object") {
      return normalizeConfig(raw);
    }
    // KV missing/empty/unavailable -> fall back to bundled defaults.
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
    dailySpinLimitPerUser:
      typeof raw.dailySpinLimitPerUser === "number"
        ? raw.dailySpinLimitPerUser
        : base.dailySpinLimitPerUser,
    enforceUserLimit:
      typeof raw.enforceUserLimit === "boolean"
        ? raw.enforceUserLimit
        : base.enforceUserLimit,
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
      name: normalizeName(p.name || p.names)
    }));
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

// Shared authentication guard for admin-only routes.
export async function requireAdmin(context) {
  const { ADMIN_USER, ADMIN_PASS } = context.env;
  const auth = context.request.headers.get("Authorization") || "";
  const expected = "Basic " + btoa(`${ADMIN_USER}:${ADMIN_PASS}`);

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

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" }
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