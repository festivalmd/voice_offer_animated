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
    if (options.body && typeof options.body !== "string") {
      headers["Content-Type"] = "application/json";
      options.body = JSON.stringify(options.body);
    }
    const res = await fetch(path, Object.assign({}, options, { headers }));
    return { status: res.status, body: await res.json().catch(() => ({})) };
  }

  function toast(msg) {
    const el = $("admin-toast");
    el.textContent = msg;
    el.hidden = false;
    clearTimeout(el._t);
    el._t = setTimeout(() => { el.hidden = true; }, 3000);
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
  let settings = {
    googleReviewsUrl: "",
    couponLifetimeMinutes: 15,
    prizeRevealSeconds: 4.1,
    dailySpinLimitPerUser: 0,
    enforceUserLimit: true
  };

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
      toggle.className = "toggle" + (p.active ? " on" : "");
      toggle.title = "Activ / Inactiv";
      toggle.addEventListener("click", () => {
        p.active = !p.active;
        renderPrizes();
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
      del.className = "del-btn";
      del.textContent = "✕";
      del.addEventListener("click", () => {
        prizes.splice(idx, 1);
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
      name: { ro: "", ru: "", en: "" }
    });
    renderPrizes();
  }
// ---------- load / save ----------
  function fillSettings(res) {
    if (res && res.googleReviewsUrl !== undefined) settings.googleReviewsUrl = res.googleReviewsUrl;
    if (res && res.couponLifetimeMinutes !== undefined) settings.couponLifetimeMinutes = res.couponLifetimeMinutes;
    if (res && res.prizeRevealSeconds !== undefined) settings.prizeRevealSeconds = res.prizeRevealSeconds;
    if (res && res.dailySpinLimitPerUser !== undefined) settings.dailySpinLimitPerUser = res.dailySpinLimitPerUser;
    if (res && res.enforceUserLimit !== undefined) settings.enforceUserLimit = !!res.enforceUserLimit;
    $("cfg-google").value = settings.googleReviewsUrl || "";
    $("cfg-lifetime").value = settings.couponLifetimeMinutes;
    $("cfg-reveal").value = settings.prizeRevealSeconds;
    $("cfg-daily-spin").value = settings.dailySpinLimitPerUser;
    $("cfg-enforce-user-limit").checked = settings.enforceUserLimit !== false;
  }

  async function loadAll() {
    const res = await api("/api/admin/config");
    if (res.status === 401) { showAuth(); return false; }
    if (res.status === 200 && res.body) {
      prizes = Array.isArray(res.body.prizes) ? res.body.prizes : [];
      fillSettings(res.body);
      renderPrizes();
    }
    await loadStats();
    return true;
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

  // ---------- auth ----------
  function showAuth() {
    $("admin-auth").style.display = "flex";
    $("admin-app").hidden = true;
  }
  function showApp() {
    $("admin-auth").style.display = "none";
    $("admin-app").hidden = false;
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
  async function doSave() {
    const payload = {
      googleReviewsUrl: $("cfg-google").value.trim(),
      couponLifetimeMinutes: Math.max(1, Math.floor(Number($("cfg-lifetime").value) || 15)),
      prizeRevealSeconds: Math.max(0, Number($("cfg-reveal").value) || 4.1),
      dailySpinLimitPerUser: Math.max(0, Math.floor(Number($("cfg-daily-spin").value) || 0)),
      enforceUserLimit: $("cfg-enforce-user-limit").checked !== false,
      prizes: prizes.map((p) => ({
        id: p.id,
        active: !!p.active,
        icon: p.icon || "🎁",
        image: p.image || "",
        weight: Math.max(0, Number(p.weight) || 0),
        dailyLimit: Math.max(0, Math.floor(Number(p.dailyLimit) || 0)),
        name: {
          ro: (p.name && p.name.ro) || "",
          ru: (p.name && p.name.ru) || "",
          en: (p.name && p.name.en) || ""
        }
      }))
    };
    const res = await api("/api/admin/config", { method: "PUT", body: payload });
    if (res.status === 200) {
      toast("Salvat ✓");
      await loadStats();
    } else {
      toast("Eroare la salvare");
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
  function boot() {
    $("btn-login").addEventListener("click", doLogin);
    $("auth-pass").addEventListener("keydown", (e) => {
      if (e.key === "Enter") doLogin();
    });
    $("btn-save").addEventListener("click", doSave);
    $("btn-reset").addEventListener("click", doReset);
    $("btn-add-prize").addEventListener("click", addPrize);

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

  document.addEventListener("DOMContentLoaded", boot);
})();