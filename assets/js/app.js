/* ============================================================================
   Voice Club — Guest App
   Handles: language, video, spin flow, coupon state, redeem, localStorage.
   ============================================================================ */
(function () {
  "use strict";

  const STORAGE_KEY = "voice_offer_state";
  const REDEEMED_LOCK_KEY = "voice_offer_redeemed_lock";
  const LANG_KEY = "voice_offer_lang";

  // ---------- i18n dictionaries ----------
  const I18N = {
    ro: {
      title: "Compliment de la barmanul Voice Club",
      subtitle: "Scutură shaker-ul și află cadoul tău pentru un review în Google",
      shake: "Scutură shaker-ul",
      hint: "sau scutură telefonul 📱",
      prizeLabel: "Câștigătorul tău",
      couponTitle: "Cupon de bar pentru",
      couponValid: "Valabil pentru",
      claim: "Primește cadoul (Lasă review în Google)",
      redeem: "Răscumpără la barman",
      confirmRedeem: "Confirmă că barmanul a emis premiul?",
      redeemedToast: "✔ Barmanul a confirmat. Cuplone consumat. Reveniți mâine!",
      allExhausted: "Toate cadourile de azi au fost distribuite. Vino mâine!",
      errorSpin: "A apărut o eroare. Încearcă din nou.",
      offline: "Fără conexiune. Pornește video-ul și încearcă din nou.",
      redeemError: "Nu am putut confirma cuponul. Încearcă din nou.",
      locked: "Ai primit deja cadoul tău astăzi. Revino mâine!",
      expired: "Cuponul a expirat.",
      gotIt: "Înțeles"
    },
    ru: {
      title: "Комплимент от бармена Voice Club",
      subtitle: "Встряхни шейкер и узнай свой подарок за отзыв в Google",
      shake: "Встряхнуть шейкер",
      hint: "или встряхни телефон 📱",
      prizeLabel: "Твой выигрыш",
      couponTitle: "Купон на выдачу",
      couponValid: "Действителен в течение",
      claim: "Забрать подарок (Оставить отзыв в Google)",
      redeem: "Погасить у бармена",
      confirmRedeem: "Подтвердить, что бармен выдал приз?",
      redeemedToast: "✔ Бармен подтвердил. Купон погашен. До встречи завтра!",
      allExhausted: "Сегодня все подарки разыграны. Возвращайся завтра!",
      errorSpin: "Что-то пошло не так. Попробуй ещё раз.",
      offline: "Нет связи. Запусти видео и попробуй ещё раз.",
      redeemError: "Не смогли подтвердить купон. Попробуй ещё раз.",
      locked: "Ты уже получил свой подарок сегодня. Приходи завтра!",
      expired: "Купон истёк.",
      gotIt: "Понятно"
    },
    en: {
      title: "Compliment from the Voice Club bartender",
      subtitle: "Shake the shaker and find out your gift for a Google review",
      shake: "Shake the shaker",
      hint: "or shake your phone 📱",
      prizeLabel: "Your prize",
      couponTitle: "Bar coupon for",
      couponValid: "Valid for",
      claim: "Claim your gift (Leave a Google review)",
      redeem: "Redeem at the bartender",
      confirmRedeem: "Confirm that the bartender issued the prize?",
      redeemedToast: "✔ Bartender confirmed. Coupon used. See you tomorrow!",
      allExhausted: "All prizes for today are gone. Come back tomorrow!",
      errorSpin: "Something went wrong. Try again.",
      offline: "No connection. Play the video and try again.",
      redeemError: "Could not confirm the coupon. Try again.",
      locked: "You already got your gift today. Come back tomorrow!",
      expired: "Coupon has expired.",
      gotIt: "Got it"
    }
  };

  // ---------- DOM refs ----------
  const $ = (id) => document.getElementById(id);
  const video = $("bartender-video");
  const screenStart = $("screen-start");
  const screenReveal = $("screen-reveal");
  const btnSpin = $("btn-spin");
  const btnGoogle = $("btn-google");
  const btnRedeem = $("btn-redeem");
  const prizePopup = $("prize-pop");
  const prizeIcon = $("prize-icon");
  const prizeName = $("prize-name");
  const couponWrap = $("coupon-wrap");
  const couponIcon = $("coupon-icon");
  const couponName = $("coupon-name");
  const couponIdEl = $("coupon-id");
  const couponTimer = $("coupon-timer");
  const toast = $("toast");
  const hintEl = $("t-hint");

  // ---------- state ----------
  let config = {
    googleReviewsUrl: "",
    couponLifetimeMinutes: 15,
    prizeRevealSeconds: 4.1,
    enforceUserLimit: true
  };
  let lang = localStorage.getItem(LANG_KEY) || "ro";
  let currentPrize = null;
  let couponDeadline = 0;
  let timerInterval = null;
  let spinInFlight = false;
  let videoStarted = false;
// ---------- i18n helpers ----------
  function t(key) {
    return (I18N[lang] && I18N[lang][key]) || key;
  }
  function applyTexts() {
    document.documentElement.lang = lang;
    document.querySelectorAll("[data-i18n]").forEach((el) => {
      el.textContent = t(el.getAttribute("data-i18n"));
    });
    $("t-title").textContent = t("title");
    $("t-subtitle").textContent = t("subtitle");
    hintEl.textContent = t("hint");
    if (currentPrize) prizeName.textContent = prizeNameOf(currentPrize);
  }
  function applyLangButtons() {
    document.querySelectorAll(".lang-btn").forEach((b) => {
      b.classList.toggle("active", b.getAttribute("data-lang") === lang);
    });
  }

  // ---------- storage ----------
  function loadState() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (e) {
      return null;
    }
  }
  function saveState(s) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
    } catch (e) {}
  }
  function redeemedLock() {
    return localStorage.getItem(REDEEMED_LOCK_KEY) === "1";
  }
  function setRedeemedLock() {
    localStorage.setItem(REDEEMED_LOCK_KEY, "1");
  }

  function prizeNameOf(prize) {
    if (!prize) return "";
    const n = (prize.name || {})[lang] || prize.name?.en || prize.name?.ro || prize.name?.ru || "";
    return n;
  }

  // Render a prize's visual: photo if present, otherwise the emoji icon.
  // `el` is the container element (e.g. #prize-icon or #coupon-icon).
  function setPrizeMedia(el, prize, imgClass) {
    if (!el) return;
    const image = prize && prize.image;
    el.innerHTML = "";
    if (image) {
      const img = document.createElement("img");
      img.className = imgClass || "prize-img";
      img.src = image;
      img.alt = prizeNameOf(prize) || "premiu";
      el.appendChild(img);
    } else {
      el.textContent = (prize && prize.icon) || "🎁";
    }
  }

  // Whether repeated-winner control is currently enabled (config).
  function isUserLimitEnabled() {
    return config.enforceUserLimit !== false;
  }

  // ---------- UI helpers ----------
  let toastTimeout = null;
  function showToast(msg, ms = 3200) {
    toast.textContent = msg;
    toast.hidden = false;
    if (toastTimeout) clearTimeout(toastTimeout);
    toastTimeout = setTimeout(() => { toast.hidden = true; }, ms);
  }
  function formatTime(totalSec) {
    const m = Math.floor(totalSec / 60);
    const s = Math.floor(totalSec % 60);
    return String(m).padStart(2, "0") + ":" + String(s).padStart(2, "0");
  }

  function launchConfetti(container) {
    const colors = ["#d4af37", "#e94560", "#f4f1ea", "#e77d2c", "#50c1e9"];
    for (let i = 0; i < 40; i++) {
      const p = document.createElement("div");
      p.className = "confetti-piece";
      p.style.background = colors[i % colors.length];
      p.style.left = (20 + Math.random() * 60) + "%";
      p.style.top = (10 + Math.random() * 30) + "%";
      const dx = (Math.random() - 0.5) * 200;
      const rot = (Math.random() - 0.5) * 720;
      p.style.setProperty("--dx", dx + "px");
      p.style.setProperty("--dy", (150 + Math.random() * 200) + "px");
      p.style.setProperty("--rot", rot + "deg");
      container.appendChild(p);
      setTimeout(() => p.remove(), 2600);
    }
  }

  function setScreens(showStart, showReveal) {
    screenStart.classList.toggle("active", showStart);
    screenReveal.classList.toggle("active", showReveal);
  }

  // ==================================================================
  //  VIDEO
  // ==================================================================
  async function ensureVideoPlaying() {
    if (videoStarted) return;
    videoStarted = true;
    try {
      video.currentTime = 0;
      await video.play();
    } catch (e) {
      /* autoplay may be blocked until user interacts */
    }
  }
  function playVideoFrom(seconds) {
    try {
      video.currentTime = seconds || 0;
      video.play().catch(() => {});
    } catch (e) {}
  }
  function pauseVideo() {
    try { video.pause(); } catch (e) {}
  }
// ==================================================================
  //  FLOW: spin
  // ==================================================================
  async function startSpin() {
    if (spinInFlight) return;
    if (isUserLimitEnabled() && redeemedLock()) {
      setScreens(false, true);
      showToast(t("locked"), 4000);
      return;
    }
    // Already have an unredeemed coupon? Restore it (can't re-spin).
    const st = loadState();
    if (st && !st.redeemed && st.couponId) {
      restoreCoupon(st);
      return;
    }

    spinInFlight = true;
    btnSpin.disabled = true;
    ensureVideoPlaying();
    playVideoFrom(0);

    setScreens(false, true);
    prizePopup.classList.remove("revealed");
    btnGoogle.hidden = false;
    btnRedeem.hidden = true;
    couponWrap.hidden = true;

    try {
      const res = await fetch("/api/spin", { method: "POST" });
      const data = await res.json().catch(() => ({}));
      // Server returns a clean, non-500 body for exhausted/degenerate states.
      if (data && data.ok === false) {
        const msg =
          data.error === "all_exhausted" ? t("allExhausted") : t("errorSpin");
        showToast(msg, 4000);
        setTimeout(() => setScreens(true, false), 2500);
        return;
      }
      if (!data || !data.ok || !data.prize) {
        throw new Error(data && data.error ? data.error : "bad");
      }
      currentPrize = data.prize;
      // Update config with server values.
      config.prizeRevealSeconds = data.prize.revealSeconds ?? config.prizeRevealSeconds;
      config.couponLifetimeMinutes = data.prize.couponLifetimeMinutes ?? config.couponLifetimeMinutes;
      const revealSec = Number(config.prizeRevealSeconds || 4.1);

      // Primary: reveal on the configured second (matched to the flash).
      scheduleReveal(revealSec);
      // Fallback: if the video ends (or time-threshold is crossed) before the
      // timer fires, reveal immediately so the card is never missed.
      armVideoRevealFallback(revealSec);
    } catch (err) {
      // Non-2xx or network error: show the backend error message if present.
      const msg = navigator.onLine === false ? t("offline") : (t("errorSpin"));
      showToast(msg, 3500);
      setTimeout(() => { setScreens(true, false); }, 2800);
    } finally {
      spinInFlight = false;
      btnSpin.disabled = false;
    }
  }

  // Reveal once per spin (idempotent), then launch confetti.
  function revealPrizeOnce(prize) {
    if (revealDone) return;
    revealDone = true;
    revealPrize(prize);
    launchConfetti($("confetti"));
    disarmVideoRevealFallback();
  }

  let revealTimer = null;
  let revealDone = false;
  function scheduleReveal(seconds) {
    revealDone = false;
    if (revealTimer) clearTimeout(revealTimer);
    revealTimer = setTimeout(() => {
      revealPrizeOnce(currentPrize);
    }, Math.max(0, seconds) * 1000);
  }

  function armVideoRevealFallback(seconds) {
    // A single 'timeupdate' listener that triggers reveal when the video passes
    // the reveal second OR reaches the end ('ended'). Works even if the timer
    // was delayed because the video started a fraction later.
    const onTick = () => {
      if (video && video.currentTime >= Math.max(seconds, 0.001)) {
        revealPrizeOnce(currentPrize);
      }
    };
    const onEnd = () => revealPrizeOnce(currentPrize);
    video._voRevealTick = onTick;
    video._voRevealEnd = onEnd;
    video.addEventListener("timeupdate", onTick);
    video.addEventListener("ended", onEnd);
  }

  function disarmVideoRevealFallback() {
    if (revealTimer) { clearTimeout(revealTimer); revealTimer = null; }
    if (video && video._voRevealTick) {
      video.removeEventListener("timeupdate", video._voRevealTick);
      video.removeEventListener("ended", video._voRevealEnd);
      video._voRevealTick = null;
      video._voRevealEnd = null;
    }
  }

  function revealPrize(prize) {
    setPrizeMedia(prizeIcon, prize, "prize-img");
    prizeName.textContent = prizeNameOf(prize);
    prizePopup.classList.add("revealed");
    applyTexts();
  }

  // ==================================================================
  //  FLOW: claim -> coupon
  // ==================================================================
  async function claimPrize() {
    if (!currentPrize || !currentPrize.couponId) return;
    if (config.googleReviewsUrl) {
      try { window.open(config.googleReviewsUrl, "_blank", "noopener"); }
      catch (e) { window.location.href = config.googleReviewsUrl; }
    }
    enterCouponMode(currentPrize);
  }

  function enterCouponMode(prize) {
    setPrizeMedia(couponIcon, prize, "coupon-img");
    couponName.textContent = prizeNameOf(prize);
    couponIdEl.textContent = "#" + String(prize.couponId).replace(/[^a-z0-9]/gi, "").slice(0, 8);
    $("t-coupon-title").textContent = t("couponTitle") + " " + (prize.icon || "");
    couponWrap.hidden = false;
    btnGoogle.hidden = true;
    btnRedeem.hidden = false;
    if (!couponDeadline) couponDeadline = Date.now() + (config.couponLifetimeMinutes || 15) * 60 * 1000;

    if (!loadState() || loadState().redeemed) {
      saveState({
        couponId: prize.couponId,
        prize: { id: prize.id, icon: prize.icon, image: prize.image || "", name: prize.name },
        redeemed: false,
        issuedAt: Date.now()
      });
    }

    startCouponTimer();
  }

  function startCouponTimer() {
    if (timerInterval) clearInterval(timerInterval);
    timerInterval = setInterval(() => {
      const remain = couponDeadline - Date.now();
      if (remain <= 0) {
        couponTimer.textContent = "00:00";
        clearInterval(timerInterval);
        return;
      }
      couponTimer.textContent = formatTime(remain / 1000);
    }, 1000);
  }

  function restoreCoupon(st) {
    currentPrize = {
      couponId: st.couponId,
      icon: (st.prize && st.prize.icon) || "🎁",
      image: (st.prize && st.prize.image) || "",
      name: (st.prize && st.prize.name) || {},
      id: st.prize && st.prize.id
    };
    const issuedAt = st.issuedAt || Date.now();
    couponDeadline = issuedAt + (config.couponLifetimeMinutes || 15) * 60 * 1000;
    setScreens(false, true);
    ensureVideoPlaying();
    playVideoFrom(0.1);
    prizePopup.classList.remove("revealed");
    enterCouponMode(currentPrize);
  }
// ==================================================================
  //  FLOW: redeem (bartender)
  // ==================================================================
  async function redeemCoupon() {
    if (!currentPrize || !currentPrize.couponId) return;
    if (!window.confirm(t("confirmRedeem"))) return;
    try {
      const res = await fetch("/api/redeem", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ couponId: currentPrize.couponId })
      });
      const data = await res.json().catch(() => ({}));
      if (data.ok || data.error === "already_redeemed") {
        // Mark redeemed locally + lock for 24h.
        const st = loadState();
        if (st) { st.redeemed = true; saveState(st); }
        // Only persist the 24h lock when repeated-winner control is enabled.
        if (isUserLimitEnabled()) setRedeemedLock();
        couponTimer.textContent = "00:00";
        if (timerInterval) clearInterval(timerInterval);
        showToast(t("redeemedToast"), 5000);
        setTimeout(() => {
          resetToStartState();
        }, 2200);
      } else if (data.error === "expired") {
        showToast(t("expired"), 4000);
        setTimeout(() => resetToStartState(), 2200);
      } else {
        showToast(t("redeemError"), 4000);
      }
    } catch (e) {
      showToast(t("redeemError"), 4000);
    }
  }

  function resetToStartState() {
    if (timerInterval) clearInterval(timerInterval);
    timerInterval = null;
    couponDeadline = 0;
    currentPrize = null;
    disarmVideoRevealFallback();
    revealDone = false;
    prizePopup.classList.remove("revealed");
    couponWrap.hidden = true;
    btnGoogle.hidden = false;
    btnRedeem.hidden = true;
    setScreens(true, false);
    pauseVideo();
    videoStarted = false;
    // Do NOT clear redeemedLock here (reset only when user explicitly
    // resets test state via admin). Guest returns tomorrow.
    applyTexts();
  }

  // ==================================================================
  //  SHAKE DETECTION (DeviceMotionEvent)
  // ==================================================================
  function requestShakePermission() {
    if (typeof DeviceMotionEvent !== "undefined" && typeof DeviceMotionEvent.requestPermission === "function") {
      DeviceMotionEvent.requestPermission().catch(() => {});
    }
  }
  let lastX = 0, lastY = 0, lastZ = 0, shakeStart = 0;
  function handleMotion(e) {
    const a = e.accelerationIncludingGravity;
    if (!a) return;
    const now = Date.now();
    if (now - shakeStart < 400) return; // debounce
    const delta = Math.abs(a.x - lastX) + Math.abs(a.y - lastY) + Math.abs(a.z - lastZ);
    lastX = a.x; lastY = a.y; lastZ = a.z;
    if (delta > 60) {
      shakeStart = now;
      vibrate();
      if (screenStart.classList.contains("active")) startSpin();
    }
  }
  function vibrate() {
    if (navigator.vibrate) {
      try { navigator.vibrate(120); } catch (e) {}
    }
  }

  // ==================================================================
  //  INIT
  // ==================================================================
  async function init() {
    applyLangButtons();
    applyTexts();

    // Load public config.
    try {
      const res = await fetch("/api/config");
      const data = await res.json();
      if (data) {
        config.googleReviewsUrl = data.googleReviewsUrl || "";
        config.couponLifetimeMinutes = data.couponLifetimeMinutes || 15;
        config.prizeRevealSeconds = data.prizeRevealSeconds || 4.1;
        config.enforceUserLimit = data.enforceUserLimit !== false;
      }
    } catch (e) {}

    // If already redeemed today -> show locked state but keep video.
    // Lock is skipped entirely when the admin has disabled user control.
    if (isUserLimitEnabled() && redeemedLock()) {
      setScreens(false, true);
      ensureVideoPlaying();
      playVideoFrom(0.1);
      showToast(t("locked"), 4000);
      return;
    }

    // Restore an unredeemed coupon if the guest reloaded.
    const st = loadState();
    if (st && !st.redeemed && st.couponId) {
      restoreCoupon(st);
      return;
    }

    // Otherwise show start screen over a softly playing poster.
    setScreens(true, false);
    ensureVideoPlaying();
  }

  // ---------- event wiring ----------
  btnSpin.addEventListener("click", () => { requestShakePermission(); startSpin(); });
  btnGoogle.addEventListener("click", claimPrize);
  btnRedeem.addEventListener("click", redeemCoupon);

  document.querySelectorAll(".lang-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      lang = btn.getAttribute("data-lang");
      localStorage.setItem(LANG_KEY, lang);
      applyLangButtons();
      applyTexts();
    });
  });

  window.addEventListener("devicemotion", handleMotion, false);

  // Make sure user gesture unlocks audio/video on iOS.
  window.addEventListener("touchstart", () => {
    ensureVideoPlaying();
  }, { once: true, passive: true });

  init();
})();