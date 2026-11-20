/* ============================================================================
   Voice Club — Admin Panel (pad.html)
   Basic Auth is handled by the server; the panel stores creds and sends
   an Authorization header on every request.
   ============================================================================ */
(function () {
  "use strict";

  const $ = (id) => document.getElementById(id);
  const AUTH_KEY = "voice_offer_admin_auth";
  let auth = null;

  // ---------- helpers ----------
  async function api(path, options = {}) {
    const headers = Object.assign({}, options.headers || {});
    if (auth) headers["Authorization"] = "Basic " + btoa(auth.user + ":" + auth.pass);
    const method = String(options.method || "GET").toUpperCase();
    // GET /api/admin/config could be answered from the HTTP cache with the
    // pre-save body (old values re-rendered and re-sent), and a cached response
    // to a write is equally wrong — so both are always revalidated.
    headers["Cache-Control"] = method === "GET" ? "no-cache" : "no-store";
    if (options.body && typeof options.body !== "string") {
      headers["Content-Type"] = "application/json";
      options.body = JSON.stringify(options.body);
    }
    let res;
    try {
      res = await fetch(path, Object.assign({}, options, { headers, cache: "no-store" }));
    } catch (e) {
      // Network/proxy failure: never leave the UI silent about it.
      return { status: 0, body: { error: "network_error" } };
    }
    return { status: res.status, body: await res.json().catch(() => ({})) };
  }

  // Visual feedback. `kind` is "ok" (gold, default) or "error" (red) so the
  // admin can tell a successful save from a server error at a glance.
  function toast(msg, kind) {
    const el = $("admin-toast");
    if (!el) return;
    el.textContent = msg;
    el.classList.toggle("error", kind === "error");
    // `.admin-toast` sets position/z-index, so we must NOT rely on the default
    // `hidden` attribute alone (author styles can beat it) — drive display too.
    el.hidden = false;
    el.style.display = "block";
    clearTimeout(el._t);
    el._t = setTimeout(() => {
      el.hidden = true;
      el.style.display = "";
    }, 3000);
  }

  // Human-readable reason for a failed admin API call.
  function errorText(res) {
    const body = (res && res.body) || {};
    if (res && res.status === 401) return "Autentificare expirată — reautentifică-te";
    if (res && res.status === 0) return "Server inaccesibil (verifică conexiunea)";
    if (body.error) return "Eroare: " + String(body.error);
    return "Eroare la salvare (HTTP " + (res ? res.status : "?") + ")";
  }

  // -------- photo compression (client-side via <canvas>) --------
  const PHOTO_MAX = 320; // keep images square-ish, bounded to 320x320
  const PHOTO_QUALITY = 0.82;

  // Downscale + re-encode a File into a data:image/* string (max 320x320).
  function compressImage(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(new Error("read_error"));
      reader.onload = () => {
        const img = new Image();
        img.onerror = () => reject(new Error("decode_error"));
        img.onload = () => {
          const scale = Math.min(1, PHOTO_MAX / Math.max(img.width, img.height));
          const w = Math.max(1, Math.round(img.width * scale));
          const h = Math.max(1, Math.round(img.height * scale));
          const canvas = document.createElement("canvas");
          canvas.width = w;
          canvas.height = h;
          const ctx = canvas.getContext("2d");
          if (!ctx) { reject(new Error("no_canvas")); return; }
          ctx.drawImage(img, 0, 0, w, h);
          // Prefer WebP, fall back to JPEG when the browser can't encode it.
          let dataUrl = "";
          try {
            dataUrl = canvas.toDataURL("image/webp", PHOTO_QUALITY);
          } catch (e) { dataUrl = ""; }
          if (!dataUrl || (dataUrl.indexOf("data:image/webp") !== 0 && dataUrl === "data:,")) {
            dataUrl = canvas.toDataURL("image/jpeg", PHOTO_QUALITY);
          }
          resolve(dataUrl);
        };
        img.src = reader.result;
      };
      reader.readAsDataURL(file);
    });
  }

  // ---------- state ----------
  let prizes = [];
  // Last config received from the server. Used as a base for PUT so every
  // field (including ones this UI does not edit) is always sent back.
  let serverConfig = null;
  let settings = {
    googleReviewsUrl: "",
    couponLifetimeMinutes: 15,
    prizeRevealSeconds: 4.1,
    idleLoopStart: 0.2,
    idleLoopEnd: 2.4,
    dailySpinLimitPerUser: 0,
    enforceUserLimit: true,
    prizeLabel: { ro: "", ru: "", en: "" },
    prizeLabelColor: "#d4af37",
    // Start screen (index.html): texts per language + colors.
    startTitle: { ro: "", ru: "", en: "" },
    startTitleColor: "#ffffff",
    startSubtitle: { ro: "", ru: "", en: "" },
    startSubtitleColor: "#cbd5e1",
    startButtonText: { ro: "", ru: "", en: "" },
    startButtonTextColor: "#ffffff",
    startButtonBgColor: "#e94560"
  };

  // Start-screen text fields: [settings key, input id prefix].
  const START_TEXT_FIELDS = [
    ["startTitle", "cfg-start-title"],
    ["startSubtitle", "cfg-start-subtitle"],
    ["startButtonText", "cfg-start-button"]
  ];
  // Start-screen color swatches: [settings key, swatch id, default color].
  const START_COLOR_FIELDS = [
    ["startTitleColor", "cfg-start-title-color-swatch", "#ffffff"],
    ["startSubtitleColor", "cfg-start-subtitle-color-swatch", "#cbd5e1"],
    ["startButtonTextColor", "cfg-start-button-color-swatch", "#ffffff"],
    ["startButtonBgColor", "cfg-start-button-bg-swatch", "#e94560"]
  ];

  // ---------- render prizes ----------
  const PRIZE_COLS = ["icon", "ro", "ru", "en", "weight", "dailyLimit", "active"];

  function renderPrizes() {
    const list = $("prizes-list");
    list.innerHTML = "";
    prizes.forEach((p, idx) => {
      const row = document.createElement("div");
      row.className = "prize-row";
      row.dataset.idx = idx;

      const activeCol = document.createElement("div");
      const toggle = document.createElement("button");
      toggle.type = "button";
      toggle.className = "toggle" + (p.active ? " on" : "");
      toggle.title = "Activ / Inactiv";
      toggle.addEventListener("click", () => {
        p.active = !p.active;
        toggle.className = "toggle" + (p.active ? " on" : "");
      });
      activeCol.appendChild(toggle);

      const nm = p.name || {};
      const nameFields = document.createElement("div");
      nameFields.className = "name-fields";
      [["ro", nm.ro || ""], ["ru", nm.ru || ""], ["en", nm.en || ""]].forEach(([k, v]) => {
        const inp = document.createElement("input");
        inp.placeholder = k.toUpperCase();
        inp.value = v;
        inp.addEventListener("input", () => { p.name = p.name || {}; p.name[k] = inp.value; });
        nameFields.appendChild(inp);
      });

      const iconInp = document.createElement("input");
      iconInp.className = "icon-input";
      iconInp.value = p.icon || "";
      iconInp.addEventListener("input", () => { p.icon = iconInp.value; });

      // Photo upload (auto-compressed on the client) + preview + clear.
      const photoBox = document.createElement("div");
      photoBox.className = "prize-photo";
      const photoPreview = document.createElement("img");
      photoPreview.className = "prize-photo-preview";
      photoPreview.alt = "";
      const photoClear = document.createElement("button");
      photoClear.type = "button";
      photoClear.className = "photo-clear";
      photoClear.textContent = "✕";
      photoClear.title = "Șterge fotografia";
      const photoLabel = document.createElement("label");
      photoLabel.className = "photo-upload";
      photoLabel.textContent = "⬆ Photo";
      const photoInput = document.createElement("input");
      photoInput.type = "file";
      photoInput.accept = "image/*";
      photoInput.style.display = "none";
      photoInput.addEventListener("change", async () => {
        const file = photoInput.files && photoInput.files[0];
        if (!file) return;
        try {
          const dataUrl = await compressImage(file);
          p.image = dataUrl;
          refreshPhotoUI();
        } catch (e) {
          toast("Imagine invalidă");
        }
        photoInput.value = "";
      });
      photoClear.addEventListener("click", () => {
        p.image = "";
        refreshPhotoUI();
      });
      photoLabel.appendChild(photoInput);

      function refreshPhotoUI() {
        const has = !!p.image;
        photoPreview.src = has ? p.image : "";
        photoPreview.hidden = !has;
        photoClear.hidden = !has;
        photoPreview.title = has ? "Fotografie" : "";
      }
      refreshPhotoUI();

      const weightInp = document.createElement("input");
      weightInp.className = "num-input";
      weightInp.type = "number";
      weightInp.min = "0";
      weightInp.value = p.weight != null ? p.weight : 0;
      weightInp.addEventListener("input", () => { p.weight = Number(weightInp.value) || 0; });

      const limitInp = document.createElement("input");
      limitInp.className = "num-input";
      limitInp.type = "number";
      limitInp.min = "0";
      limitInp.value = p.dailyLimit != null ? p.dailyLimit : 0;
      limitInp.addEventListener("input", () => { p.dailyLimit = Number(limitInp.value) || 0; });

      const del = document.createElement("button");
      del.type = "button";
      del.className = "del-btn";
      del.textContent = "✕";
      del.addEventListener("click", () => {
        const i = prizes.indexOf(p);
        if (i >= 0) prizes.splice(i, 1);
        renderPrizes();
      });

      row.appendChild(activeCol);
      row.appendChild(nameFields);
      // icon + photo share the same grid cell (icon field, then photo below it).
      const mediaWrap = document.createElement("div");
      mediaWrap.className = "prize-media";
      mediaWrap.appendChild(iconInp);
      mediaWrap.appendChild(photoBox);
      row.appendChild(mediaWrap);

      // Prize name color swatch with compact popup palette.
      const colorWrap = document.createElement("div");
      colorWrap.className = "color-picker-wrap prize-color-wrap";
      const colorSwatch = document.createElement("button");
      colorSwatch.type = "button";
      colorSwatch.className = "color-swatch";
      colorSwatch.title = "Culoare nume premiu";
      colorSwatch.style.background = p.color || "#ffffff";
      colorWrap.appendChild(colorSwatch);
      attachColorPicker(colorWrap, colorSwatch, p.color || "#ffffff", (hex) => { p.color = hex; });
      row.appendChild(colorWrap);

      row.appendChild(weightInp);
      row.appendChild(limitInp);
      row.appendChild(del);
      list.appendChild(row);
    });
  }

  function addPrize() {
    prizes.push({
      id: "prize-" + Date.now().toString(36),
      active: true,
      icon: "🎁",
      image: "",
      weight: 10,
      dailyLimit: 10,
      color: "#ffffff",
      name: { ro: "", ru: "", en: "" }
    });
    renderPrizes();
  }
// ---------- load / save ----------
  function fillSettings(res) {
    if (res && res.googleReviewsUrl !== undefined) settings.googleReviewsUrl = res.googleReviewsUrl;
    if (res && res.couponLifetimeMinutes !== undefined) settings.couponLifetimeMinutes = res.couponLifetimeMinutes;
    if (res && res.prizeRevealSeconds !== undefined) settings.prizeRevealSeconds = res.prizeRevealSeconds;
    if (res && res.idleLoopStart !== undefined) settings.idleLoopStart = res.idleLoopStart;
    if (res && res.idleLoopEnd !== undefined) settings.idleLoopEnd = res.idleLoopEnd;
    if (res && res.dailySpinLimitPerUser !== undefined) settings.dailySpinLimitPerUser = res.dailySpinLimitPerUser;
    if (res && res.enforceUserLimit !== undefined) settings.enforceUserLimit = !!res.enforceUserLimit;
    if (res && res.prizeLabel !== undefined) settings.prizeLabel = Object.assign({ ro: "", ru: "", en: "" }, res.prizeLabel || {});
    if (res && res.prizeLabelColor !== undefined) settings.prizeLabelColor = res.prizeLabelColor;
    // Start screen texts + colors (missing fields keep the current value).
    START_TEXT_FIELDS.forEach(([key]) => {
      if (res && res[key] !== undefined) {
        settings[key] = Object.assign({ ro: "", ru: "", en: "" }, res[key] || {});
      }
    });
    START_COLOR_FIELDS.forEach(([key, , fallback]) => {
      if (res && res[key] !== undefined) settings[key] = res[key] || fallback;
    });
    $("cfg-google").value = settings.googleReviewsUrl || "";
    $("cfg-lifetime").value = settings.couponLifetimeMinutes;
    $("cfg-reveal").value = settings.prizeRevealSeconds;
    const idleStartEl = $("cfg-idle-start");
    if (idleStartEl) idleStartEl.value = settings.idleLoopStart ?? 0.2;
    const idleEndEl = $("cfg-idle-end");
    if (idleEndEl) idleEndEl.value = settings.idleLoopEnd ?? 2.4;
    $("cfg-daily-spin").value = settings.dailySpinLimitPerUser;
    $("cfg-enforce-user-limit").checked = settings.enforceUserLimit !== false;
    $("cfg-prize-label-ro").value = settings.prizeLabel.ro || "";
    $("cfg-prize-label-ru").value = settings.prizeLabel.ru || "";
    $("cfg-prize-label-en").value = settings.prizeLabel.en || "";
    const swatch = $("cfg-prize-label-swatch");
    if (swatch) swatch.style.background = settings.prizeLabelColor || "#d4af37";
    // Start screen inputs + swatches.
    START_TEXT_FIELDS.forEach(([key, prefix]) => {
      ["ro", "ru", "en"].forEach((l) => {
        const inp = $(prefix + "-" + l);
        if (inp) inp.value = (settings[key] && settings[key][l]) || "";
      });
    });
    START_COLOR_FIELDS.forEach(([key, swatchId, fallback]) => {
      const el = $(swatchId);
      if (el) el.style.background = settings[key] || fallback;
    });
  }

  async function loadAll() {
    const res = await api("/api/admin/config");
    if (res.status === 401) { showAuth(); return false; }
    if (res.status === 200 && res.body) {
      serverConfig = res.body;
      prizes = Array.isArray(res.body.prizes) ? res.body.prizes : [];
      fillSettings(res.body);
      renderPrizes();
    }
    await loadStats();
    return true;
  }

  // Store the freshest config we have (from the last GET / login / save).
  async function refreshConfig() {
    const res = await api("/api/admin/config");
    if (res.status !== 200 || !res.body) return serverConfig || {};
    serverConfig = res.body;
    // Keep the UI bound to the stored prizes, but never drop local edits:
    // local prize ids that the server does not know yet are appended.
    // BUG FIX: a save/refresh that resolves with an older GET must not re-render
    // the list while the admin is editing (that wiped the typed values, so the
    // next buildConfigPayload() sent the old prize names back to the server).
    if (saving) return res.body;
    const remote = Array.isArray(res.body.prizes) ? res.body.prizes : [];
    const remoteIds = new Set(remote.map((p) => p.id));
    const pending = prizes.filter((p) => !remoteIds.has(p.id));
    prizes = remote.concat(pending);

    // Only re-render when the server list actually differs from the DOM state,
    // otherwise every refresh would rebuild the inputs and blur the focused one.
    const same =
      prizes.length === remote.length + pending.length &&
      remote.every((r, i) => {
        const local = prizes[i];
        return (
          local &&
          r.id === local.id &&
          r.icon === local.icon &&
          r.image === (local.image || "") &&
          r.weight === local.weight &&
          r.dailyLimit === local.dailyLimit &&
          !!r.active === !!local.active &&
          r.color === local.color &&
          (r.name || {}).ro === (local.name || {}).ro &&
          (r.name || {}).ru === (local.name || {}).ru &&
          (r.name || {}).en === (local.name || {}).en
        );
      });
    if (!same) renderPrizes();
    return res.body;
  }

  async function loadStats() {
    const res = await api("/api/admin/stats");
    if (res.status !== 200) return;
    const body = res.body;
    $("stat-opens").textContent = body.totals ? body.totals.opens : 0;
    $("stat-spins").textContent = body.totals ? body.totals.spins : 0;
    $("stat-redeemed").textContent = body.totals ? body.totals.redeemed : 0;

    const byPrize = (body.totals && body.totals.byPrize) || {};
    const prizeById = {};
    (body.prizes || []).forEach((p) => { prizeById[p.id] = p; });
    const out = $("stat-by-prize");
    out.innerHTML = "";
    entries(byPrize).forEach(([id, n]) => {
      const p = prizeById[id];
      const label = p ? (p.name.ro || p.name.en || id) : id;
      const row = document.createElement("div");
      row.className = "row";
      row.innerHTML = "<span>" + (p ? p.icon + " " : "") + escapeHtml(label) + "</span><span>" + n + "</span>";
      out.appendChild(row);
    });
    if (!entries(byPrize).length) {
      out.innerHTML = '<div class="row"><span>—</span><span>0</span></div>';
    }
  }

  function entries(obj) {
    return Object.entries(obj || {});
  }
  function escapeHtml(s) {
    const div = document.createElement("div");
    div.textContent = String(s);
    return div.innerHTML;
  }

  // ---------- reusable compact color picker (swatch + popup palette) ----------
  const CLUB_COLORS = [
    "#ffffff", "#d4af37", "#e94560", "#ff4d6d",
    "#40e0d0", "#7ef0a6", "#ffe066", "#ff9f43",
    "#50c1e9", "#b066ff", "#ff6ec7", "#9ba1ff"
  ];

  function normalizeHex(value) {
    const v = String(value || "").trim();
    if (/^#([0-9a-fA-F]{3})$/.test(v)) {
      const h = v.slice(1).split("").map((c) => c + c).join("");
      return "#" + h.toLowerCase();
    }
    if (/^#([0-9a-fA-F]{6})$/.test(v)) return v.toLowerCase();
    // Attempt to parse an rgb(...) produced by the browser.
    const m = v.match(/rgba?\((\d+)[,\s]+(\d+)[,\s]+(\d+)/);
    if (m) {
      const to = (n) => Math.max(0, Math.min(255, Number(n))).toString(16).padStart(2, "0");
      return "#" + to(m[1]) + to(m[2]) + to(m[3]);
    }
    return "#ffffff";
  }

  // Row / card selectors that get lifted (`.has-open-popover`) while a palette
  // is open. Anything that is not one of these syncs the `has-open-popover`
  // class; only the first match is lifted, so the row is raised inside its card
  // and the card is raised above the neighbouring cards.
  const POPOVER_HOSTS = [
    ".start-row",
    ".prize-row",
    ".cfg-prize-label-row",
    ".admin-panel",
    ".admin-details"
  ];
  const POPOVER_CLASS = "has-open-popover";

  // Collect every ancestor (inclusive) of `node` that is a popover host.
  function popoverHosts(node) {
    const out = [];
    let el = node;
    while (el && el !== document.body && el.nodeType === 1) {
      for (let i = 0; i < POPOVER_HOSTS.length; i++) {
        if (el.matches && el.matches(POPOVER_HOSTS[i])) {
          if (out.indexOf(el) < 0) out.push(el);
          break;
        }
      }
      el = el.parentElement;
    }
    return out;
  }

  // Lift the row + the card that contain the open palette above their siblings
  // (position: relative; z-index: 1000), and drop the class again on close.
  function setPopoverOpen(node, isOpen) {
    popoverHosts(node).forEach((el) => {
      el.classList.toggle(POPOVER_CLASS, !!isOpen);
    });
  }

  // Keep the palette inside the viewport: anchored to the right edge by default
  // (see `.color-picker-pop`), flipped to the left edge when that would still
  // push it off screen, nudged vertically if it does not fit below the swatch.
  function positionPopover(wrap, pop) {
    if (!wrap || !pop || !pop.getBoundingClientRect) return;
    pop.style.transform = "";
    pop.classList.remove("is-left");
    const host = wrap.getBoundingClientRect();
    const box = pop.getBoundingClientRect();
    const vw = window.innerWidth || document.documentElement.clientWidth || 0;
    const vh = window.innerHeight || document.documentElement.clientHeight || 0;
    const margin = 12;
    if (!vw || !vh) return;
    // Right-anchored popover starts left of the swatch: flip when it is cut off.
    if (box.left < margin && box.right > margin) {
      pop.classList.add("is-left");
    }
    // Too tall to open downwards: pull it up so the grid stays reachable.
    if (box.bottom > vh - margin && host.top > box.height + margin) {
      const shift = Math.min(
        box.bottom - (vh - margin),
        host.top - margin - box.height
      );
      if (shift > 0) pop.style.transform = "translateY(" + -Math.round(shift) + "px)";
    }
  }

  // `wrap` must be the `.color-picker-wrap` container; the popup is positioned
  // inside it (so it works in both the settings block and each prize row).
  function attachColorPicker(wrap, swatch, initial, onPick) {
    if (!wrap || !swatch || !wrap.appendChild) return;
    let color = normalizeHex(initial || "#ffffff");
    const apply = (hex) => {
      color = normalizeHex(hex);
      if (swatch.style) swatch.style.background = color;
      if (onPick) { try { onPick(color); } catch (e) {} }
    };
    apply(color);

    // `pop` only exists while the palette is open, so every listener bound to it
    // is attached inside open() — never on the null initial value.
    let pop = null;
    // Detach the viewport listeners installed by open(); they must not pile up
    // when the palette is opened and closed repeatedly.
    let detachViewport = null;
    const close = () => {
      if (detachViewport) { detachViewport(); detachViewport = null; }
      setPopoverOpen(wrap, false);
      if (pop) { pop.remove(); pop = null; }
    };
    const open = () => {
      close();
      pop = document.createElement("div");
      pop.className = "color-picker-pop";
      const grid = document.createElement("div");
      grid.className = "color-picker-grid";
      CLUB_COLORS.forEach((c) => {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "color-swatch color-preset";
        btn.style.background = c;
        btn.title = c;
        btn.setAttribute("aria-label", c);
        btn.addEventListener("click", (e) => { e.stopPropagation(); apply(c); close(); });
        grid.appendChild(btn);
      });
      pop.appendChild(grid);
      const custom = document.createElement("input");
      custom.type = "color";
      custom.className = "color-picker-custom";
      custom.value = color;
      custom.title = "Culoare personalizată";
      custom.addEventListener("input", () => { apply(custom.value); });
      pop.appendChild(custom);
      // Keep editing inside the popup: the "custom" <input type="color"> fires
      // `click`/`input`, and the document listener below would otherwise close the
      // popup on the very first palette interaction.
      pop.addEventListener("click", (e) => e.stopPropagation());
      wrap.appendChild(pop);
      // Lift the enclosing row + card and keep the palette inside the viewport
      // (also after the user scrolls or resizes the window while it is open).
      setPopoverOpen(wrap, true);
      positionPopover(wrap, pop);
      const onViewport = () => { if (pop) positionPopover(wrap, pop); };
      window.addEventListener("resize", onViewport);
      window.addEventListener("scroll", onViewport, true);
      detachViewport = () => {
        window.removeEventListener("resize", onViewport);
        window.removeEventListener("scroll", onViewport, true);
      };
    };

    swatch.addEventListener("click", (e) => {
      e.stopPropagation();
      if (pop) close(); else open();
    });
    swatch.addEventListener("keydown", (e) => {
      if (e.key === "Escape") close();
    });
    // Any Escape press closes the palette even when focus moved into the
    // <input type="color">, and the lifted row/card classes go with it.
    document.addEventListener("keydown", (e) => {
      if (pop && e.key === "Escape") { e.stopPropagation(); close(); }
    });
    document.addEventListener("click", (e) => {
      // Clicks inside the wrapper (the swatch toggles itself, the popover stops
      // propagation) must not close an unrelated open palette twice.
      if (pop && !wrap.contains(e.target)) close();
    });
  }

  // ---------- auth ----------
  // Toggle the modal via the `hidden` attribute (CSS: .admin-auth[hidden] ->
  // display:none !important). Setting only style.display left the card visible
  // when the stylesheet's display:flex won, so a 200 OK never opened the panel.
  function showAuth() {
    const authEl = $("admin-auth");
    if (authEl) { authEl.hidden = false; authEl.style.display = ""; }
    const appEl = $("admin-app");
    if (appEl) appEl.hidden = true;
  }
  function showApp() {
    const authEl = $("admin-auth");
    if (authEl) { authEl.hidden = true; authEl.style.display = "none"; }
    const appEl = $("admin-app");
    if (appEl) appEl.hidden = false;
  }

  async function doLogin() {
    const user = $("auth-user").value;
    const pass = $("auth-pass").value;
    if (!user || !pass) return;
    auth = { user, pass };
    const ok = await loadAll();
    if (ok) {
      try { localStorage.setItem(AUTH_KEY, JSON.stringify(auth)); } catch (e) {}
      showApp();
      toast("Conectat ✓");
    } else {
      auth = null;
      toast("Autentificare eșuată");
    }
  }

  // ---------- save ----------
  let saving = false;

  // Strictly read a checkbox as a boolean: false must survive the round trip.
  function checked(el) {
    return !!(el && el.checked);
  }

  // Build the exact config object sent to PUT /api/admin/config. Every field is
  // always present (enforceUserLimit keeps `false`, prizeLabel always has
  // ro/ru/en) so the server never has to guess. Field names are the CANONICAL
  // ones read by the guest app (assets/js/app.js) and by the server defaults in
  // functions/_middleware.js — the old shorter aliases (prizeLabel,
  // googleReviewUrl, couponMinutes) were silently ignored downstream.
  function buildConfigPayload(base) {
    const google = $("cfg-google");
    const lifetime = $("cfg-lifetime");
    const reveal = $("cfg-reveal");
    const idleStart = $("cfg-idle-start");
    const idleEnd = $("cfg-idle-end");
    const dailySpin = $("cfg-daily-spin");
    const labelRo = $("cfg-prize-label-ro");
    const labelRu = $("cfg-prize-label-ru");
    const labelEn = $("cfg-prize-label-en");

    // Start screen texts: read straight from the inputs (empty = keep the
    // previously loaded value, so a blank field never wipes a saved text).
    const startTexts = {};
    START_TEXT_FIELDS.forEach(([key, prefix]) => {
      const prev = settings[key] || {};
      const read = (l) => {
        const inp = $(prefix + "-" + l);
        const v = inp ? String(inp.value).trim() : "";
        return v || prev[l] || "";
      };
      startTexts[key] = { ro: read("ro"), ru: read("ru"), en: read("en") };
    });
    const startColors = {};
    START_COLOR_FIELDS.forEach(([key, , fallback]) => {
      startColors[key] = normalizeHex(settings[key] || fallback);
    });

    return {
      // Keep any extra field the server already stores (future-proof).
      ...(base && typeof base === "object" ? base : {}),
      googleReviewsUrl: google ? google.value.trim() : String(settings.googleReviewsUrl || ""),
      couponLifetimeMinutes: Math.max(1, Math.floor(Number(lifetime && lifetime.value) || 15)),
      prizeRevealSeconds: Math.max(0, Number(reveal && reveal.value) || 4.1),
      // Idle ping-pong loop (seconds inside the video). An empty field below
      // keeps the previous/base value instead of being reset to a default.
      idleLoopStart: readLoopSeconds(idleStart, settings.idleLoopStart, 0.2),
      idleLoopEnd: readLoopSeconds(idleEnd, settings.idleLoopEnd, 2.4),
      dailySpinLimitPerUser: Math.max(0, Math.floor(Number(dailySpin && dailySpin.value) || 0)),
      enforceUserLimit: checked($("cfg-enforce-user-limit")),
      prizeLabel: {
        ro: labelRo ? labelRo.value.trim() : "",
        ru: labelRu ? labelRu.value.trim() : "",
        en: labelEn ? labelEn.value.trim() : ""
      },
      prizeLabelColor: normalizeHex(settings.prizeLabelColor || "#d4af37"),
      // Start screen (index.html): texts per language + colors.
      startTitle: startTexts.startTitle,
      startTitleColor: startColors.startTitleColor,
      startSubtitle: startTexts.startSubtitle,
      startSubtitleColor: startColors.startSubtitleColor,
      startButtonText: startTexts.startButtonText,
      startButtonTextColor: startColors.startButtonTextColor,
      startButtonBgColor: startColors.startButtonBgColor,
      prizes: prizes.map((p) => ({
        id: p.id,
        active: !!p.active,
        icon: p.icon || "🎁",
        image: p.image || "",
        color: normalizeHex(p.color || "#ffffff"),
        weight: Math.max(0, Number(p.weight) || 0),
        dailyLimit: Math.max(0, Math.floor(Number(p.dailyLimit) || 0)),
        name: {
          ro: (p.name && p.name.ro) || "",
          ru: (p.name && p.name.ru) || "",
          en: (p.name && p.name.en) || ""
        }
      }))
    };
  }

  // Read an idle-loop bound (seconds) from an input. Empty/invalid keeps the
  // previously loaded value so a blank field never wipes the saved setting.
  function readLoopSeconds(input, fallback, hardDefault) {
    const raw = input ? String(input.value).trim() : "";
    const base = Number.isFinite(Number(fallback)) ? Number(fallback) : hardDefault;
    const n = raw === "" ? NaN : Number(raw.replace(",", "."));
    if (!isFinite(n)) return Math.max(0, base);
    return Math.max(0, Math.round(n * 1000) / 1000);
  }

  function flashField(el) {
    if (!el) return;
    el.classList.add("field-invalid");
    el.focus();
    setTimeout(() => { el.classList.remove("field-invalid"); }, 1500);
  }

  async function doSave() {
    if (saving) return;
    const btn = $("btn-save");
    const prevLabel = btn ? btn.textContent : "";

    // The Google link field is type="url": an empty value is allowed (the field
    // is optional) but a half-typed value would silently block a form submit.
    const google = $("cfg-google");
    if (google && google.value.trim()) {
      const url = google.value.trim();
      // Cheap explicit scheme check first (and a hard requirement: the guest
      // flow opens this link with window.open, a bare value would break it).
      let valid = /^https?:\/\/[^\s]+$/i.test(url);
      if (valid) {
        try { new URL(url); } catch (e) { valid = false; }
      }
      if (!valid) {
        flashField(google);
        toast("Link invalid — folosește https://...", "error");
        return;
      }
    }

    saving = true;
    if (btn) { btn.disabled = true; btn.textContent = "⏳ Se salvează…"; }

    try {
      // `serverConfig` is the config loaded on login / last save; sending it as
      // the base keeps unknown server fields. No extra GET is issued here so the
      // PUT is sent immediately after the click.
      const payload = buildConfigPayload(serverConfig);
      const res = await api("/api/admin/config", { method: "PUT", body: payload });

      if (res.status === 200) {
        if (res.body && res.body.config) {
          serverConfig = res.body.config;
        } else {
          serverConfig = payload;
        }
        toast("Salvat ✓", "ok");
        await loadStats();
      } else {
        toast(errorText(res), "error");
      }
    } catch (e) {
      // A JS error inside the handler must never look like "nothing happens".
      toast("Eroare la salvare: " + ((e && e.message) || e), "error");
    } finally {
      saving = false;
      if (btn) { btn.disabled = false; btn.textContent = prevLabel; }
    }
  }

  // ---------- reset ----------
  async function doReset() {
    if (!window.confirm("Resetează statisticile și config-ul la teste?")) return;
    const res = await api("/api/admin/reset", { method: "POST" });
    if (res.status === 200) {
      toast("Reset efectuat");
      await loadAll();
    } else {
      toast("Eroare la reset");
    }
  }

  // ---------- bootsrap ----------
  // Attach a listener only when the element exists, so a missing optional
  // element can never abort boot() and leave every later button (incl. Save)
  // without a handler and without any console error.
  function on(id, event, handler) {
    const el = $(id);
    if (!el) return null;
    el.addEventListener(event, handler);
    return el;
  }

  function boot() {
    on("btn-login", "click", doLogin);
    on("auth-pass", "keydown", (e) => {
      if (e.key === "Enter") doLogin();
    });
    // Save must also work from the keyboard (Enter / Space) and the whole
    // settings column is a plain <div>: nothing can block a click here.
    on("btn-save", "click", doSave);
    on("btn-reset", "click", doReset);
    on("btn-add-prize", "click", addPrize);

    // Belt and braces: even if a button ever defaults to type="submit", the
    // native form submit must not reload the page — it saves instead.
    const form = $("admin-form");
    if (form) {
      form.addEventListener("submit", (e) => {
        e.preventDefault();
        doSave();
      });
    }

    // Prize-label swatch picker in the general settings block (attached once).
    const labelSwatch = $("cfg-prize-label-swatch");
    if (labelSwatch && labelSwatch.parentElement) {
      try {
        attachColorPicker(
          labelSwatch.parentElement,
          labelSwatch,
          settings.prizeLabelColor || "#d4af37",
          (hex) => { settings.prizeLabelColor = hex; }
        );
      } catch (e) {}
    } else {
      settings.prizeLabelColor = settings.prizeLabelColor || "#d4af37";
    }

    // Start-screen color swatches (same compact popup palette as the prizes).
    START_COLOR_FIELDS.forEach(([key, swatchId, fallback]) => {
      const swatch = $(swatchId);
      if (!swatch || !swatch.parentElement) {
        settings[key] = settings[key] || fallback;
        return;
      }
      try {
        attachColorPicker(
          swatch.parentElement,
          swatch,
          settings[key] || fallback,
          (hex) => { settings[key] = hex; }
        );
      } catch (e) {}
    });

    // Try auto-login from stored creds.
    let saved = null;
    try { saved = JSON.parse(localStorage.getItem(AUTH_KEY) || "null"); } catch (e) {}
    if (saved && saved.user) {
      auth = saved;
      loadAll().then((ok) => {
        if (ok) showApp();
      });
    } else {
      showAuth();
    }
  }

  // Run boot() exactly once, even if the script is loaded after the document
  // has already been parsed (DOMContentLoaded would then never fire).
  let booted = false;
  function bootOnce() {
    if (booted) return;
    booted = true;
    boot();
  }
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", bootOnce);
  } else {
    bootOnce();
  }
})();