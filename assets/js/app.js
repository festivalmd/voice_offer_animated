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
  // Two identical players stacked in #bartender-video-stage. In idle mode they
  // crossfade into each other (forward-only seamless loop); during the spin the
  // main player runs from 0.0 to the end of the clip.
  const videoA = $("bartender-video-a");
  const videoB = $("bartender-video-b");
  // The main player (video A); `backgroundVideo` is the one fading in behind it.
  const video = videoA;
  const backgroundVideo = videoB;
  const screenStart = $("screen-start");
  const screenReveal = $("screen-reveal");
  const btnSpin = $("btn-spin");
  const btnGoogle = $("btn-google");
  const btnRedeem = $("btn-redeem");
  // Wrapper around the claim button: it is the element that is hidden during
  // the video and fades in only after the prize card has landed.
  const claimWrap = $("claim-wrap");
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
    // Idle crossfade loop of the closed shaker (seconds inside the video).
    idleLoopStart: 0.2,
    idleLoopEnd: 2.4,
    enforceUserLimit: true,
    prizeLabel: { ro: "Premiu", ru: "ПРИЗ", en: "PRIZE" },
    prizeLabelColor: "#d4af37",
    // Start screen texts + colors (server values override these on load).
    startTitle: { ro: "", ru: "", en: "" },
    startTitleColor: "#ffffff",
    startSubtitle: { ro: "", ru: "", en: "" },
    startSubtitleColor: "#cbd5e1",
    startButtonText: { ro: "", ru: "", en: "" },
    startButtonTextColor: "#ffffff",
    startButtonBgColor: "#e94560"
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
    // Start screen: admin-configured text wins over the built-in dictionary.
    $("t-title").textContent = startText("startTitle", "title");
    $("t-subtitle").textContent = startText("startSubtitle", "subtitle");
    const shakeLabel = btnSpin.querySelector('[data-i18n="shake"]');
    if (shakeLabel) shakeLabel.textContent = startText("startButtonText", "shake");
    hintEl.textContent = t("hint");
    if (currentPrize) prizeName.textContent = prizeNameOf(currentPrize);
    applyStartColors();
    applyPrizeLabel();
  }

  // Text for a start-screen element in the active language: the configured
  // value (config.startTitle / startSubtitle / startButtonText) or the i18n
  // dictionary fallback when the admin left it empty.
  function startText(configKey, fallbackKey) {
    const dict = config && config[configKey];
    const value = dict && typeof dict === "object" ? dict[lang] : "";
    return String(value || "").trim() || t(fallbackKey);
  }

  // Hex -> rgba() string, used to build translucent gradients/glows from the
  // admin-chosen accent color.
  function hexToRgba(hex, alpha) {
    let v = String(hex || "").trim();
    if (/^#[0-9a-fA-F]{3}$/.test(v)) {
      v = "#" + v[1] + v[1] + v[2] + v[2] + v[3] + v[3];
    }
    if (!/^#[0-9a-fA-F]{6}$/.test(v)) return "rgba(233, 69, 96, " + alpha + ")";
    const r = parseInt(v.slice(1, 3), 16);
    const g = parseInt(v.slice(3, 5), 16);
    const b = parseInt(v.slice(5, 7), 16);
    return "rgba(" + r + ", " + g + ", " + b + ", " + alpha + ")";
  }

  // Shift a hex color towards black (amount < 0) or white (amount > 0).
  function shadeHex(hex, amount) {
    const v = /^#[0-9a-fA-F]{6}$/.test(String(hex || "")) ? String(hex) : "#e94560";
    const mix = (c) => {
      const target = amount < 0 ? 0 : 255;
      const k = Math.abs(amount);
      return Math.round(c + (target - c) * k).toString(16).padStart(2, "0");
    };
    const r = parseInt(v.slice(1, 3), 16);
    const g = parseInt(v.slice(3, 5), 16);
    const b = parseInt(v.slice(5, 7), 16);
    return "#" + mix(r) + mix(g) + mix(b);
  }

  // Apply the start-screen colors (heading, subtitle, spin button text +
  // background with an automatic gradient and glow built from the accent).
  function applyStartColors() {
    const titleEl = $("t-title");
    const subtitleEl = $("t-subtitle");
    if (titleEl) titleEl.style.color = config.startTitleColor || "#ffffff";
    if (subtitleEl) subtitleEl.style.color = config.startSubtitleColor || "#cbd5e1";
    if (btnSpin) {
      const bg = config.startButtonBgColor || "#e94560";
      btnSpin.style.background = "linear-gradient(135deg, " + bg + ", " + shadeHex(bg, -0.3) + ")";
      btnSpin.style.color = config.startButtonTextColor || "#ffffff";
      btnSpin.style.boxShadow =
        "0 10px 30px " + hexToRgba(bg, 0.45) + ", 0 0 22px " + hexToRgba(bg, 0.28);
      // The idle pulse keyframe keeps its own box-shadow; re-derive it from the
      // accent color so the glow matches the chosen background.
      btnSpin.style.setProperty("--spin-glow-soft", hexToRgba(bg, 0.4));
      btnSpin.style.setProperty("--spin-glow-strong", hexToRgba(bg, 0.65));
    }
  }

  // Badge/heading shown above the prize (config.prizeLabel on RO/RU/EN) with
  // its configured color on the reveal card and on the coupon header.
  function applyPrizeLabel() {
    const label = (config.prizeLabel && config.prizeLabel[lang]) || "";
    const color = config.prizeLabelColor || "#d4af37";
    const el = $("t-prize-label");
    if (el) {
      el.textContent = label;
      el.style.color = color;
    }
    const labelEl = $("t-coupon-title");
    if (labelEl && currentPrize) {
      labelEl.textContent = label + " " + ((currentPrize && currentPrize.icon) || "");
      labelEl.style.color = color;
    }
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

  // Text color of a prize's name (configurable per prize, defaults to white).
  function prizeColorOf(prize) {
    const c = prize && prize.color;
    return c || "#ffffff";
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

  // ---------- claim button visibility ----------
  // The "Забрать подарок" CTA must be COMPLETELY hidden while the bartender
  // shakes the shaker and opens it (the whole video), and it may only fade in
  // exactly 1.2 s after the prize card has flown on screen, so the guest gets
  // a clear two-step accent: first the prize card, then the call to action.
  // `claimDelayTimer` also cancels a pending reveal when the flow is reset or
  // the claim button is replaced by the coupon.
  const CLAIM_REVEAL_DELAY_MS = 1200;
  let claimDelayTimer = null;

  function hideClaimButton() {
    if (claimDelayTimer) { clearTimeout(claimDelayTimer); claimDelayTimer = null; }
    if (claimWrap) claimWrap.classList.remove("is-visible");
    btnGoogle.hidden = true;
    btnGoogle.disabled = true;
    btnGoogle.style.display = "none";
    btnGoogle.style.pointerEvents = "none";
  }

  function showClaimButton() {
    if (claimDelayTimer) { clearTimeout(claimDelayTimer); claimDelayTimer = null; }
    btnGoogle.hidden = false;
    btnGoogle.disabled = false;
    btnGoogle.style.display = "";
    // Hidden wrapper = no hit area until the reveal actually starts.
    btnGoogle.style.pointerEvents = "none";
    if (!claimWrap) return;
    // Restart the fade/rise from the hidden state every time (also on replay):
    // the class is removed, the browser is forced to commit that style with a
    // reflow, and only then is "is-visible" added so the transition always runs.
    claimWrap.classList.remove("is-visible");
    void claimWrap.offsetWidth;
    claimWrap.classList.add("is-visible");
    btnGoogle.style.pointerEvents = "";
  }

  // Reveal the CTA 1.2 s after the prize card appeared.
  function scheduleClaimButton() {
    if (claimDelayTimer) clearTimeout(claimDelayTimer);
    claimDelayTimer = setTimeout(() => {
      claimDelayTimer = null;
      // Never resurrect the CTA if the guest already moved on to the coupon.
      if (!prizePopup.classList.contains("revealed")) return;
      if (!couponWrap.hidden) return;
      showClaimButton();
    }, CLAIM_REVEAL_DELAY_MS);
  }

  // ==================================================================
  //  VIDEO
  // ==================================================================
  // ---------- idle seamless loop (dual-video crossfade) ----------
  // While the guest has not pressed "Shake the shaker" the opening segment of
  // bartender.mp4 (idleLoopStart -> idleLoopEnd) is played forwards, forever.
  // A jump back to idleLoopStart would cut the motion with a visible snap, so
  // instead a second, identical player is started at idleLoopStart slightly
  // BEFORE the active one reaches idleLoopEnd and fades in over it. The old
  // player is then paused and reset, ready to be used for the next hop.
  const IDLE_DEFAULT_START = 0.2;
  const IDLE_DEFAULT_END = 2.4;
  const CROSSFADE_SECONDS = 0.35; // CSS: transition: opacity 0.35s linear
  let idleActive = false;
  let idleFront = videoA; // player currently visible (plays forwards only)
  let idleBack = backgroundVideo; // pre-rolled player fading in
  let idleFading = false; // crossfade hop in progress
  let idleRaf = null;

  function safePlay(el) {
    try {
      const p = el.play();
      if (p && typeof p.catch === "function") p.catch(() => {});
    } catch (e) {}
  }
  function safePause(el) {
    try { el.pause(); } catch (e) {}
  }
  function safeSeek(el, seconds) {
    try { el.currentTime = Math.max(0, Number(seconds) || 0); } catch (e) {}
  }
  function videoDuration(el) {
    return Number.isFinite(el.duration) && el.duration > 0 ? el.duration : Infinity;
  }

  // Idle loop bounds, clamped inside the real clip: the last 0.3 s are never
  // used, otherwise the video hits its final frame and freezes.
  function idleBounds() {
    const dur = Math.min(videoDuration(videoA), videoDuration(backgroundVideo));
    const maxEnd = isFinite(dur) ? Math.max(0, dur - 0.3) : Infinity;
    let start = Number(config.idleLoopStart);
    let end = Number(config.idleLoopEnd);
    if (!isFinite(start) || start < 0) start = IDLE_DEFAULT_START;
    if (!isFinite(end) || end <= 0) end = IDLE_DEFAULT_END;
    // Never let the loop run into the end of the clip.
    if (end > maxEnd) end = maxEnd;
    // A degenerate/empty range (end <= start) would freeze the video: nothing
    // to loop. Report it so the caller can fall back to normal playback.
    if (end - start < 0.1) {
      start = Math.max(0, end - 0.1);
      if (end - start < 0.1) return null;
    }
    return { start, end };
  }

  // Show a player (CSS opacity 0 -> 1 over 0.35 s) and put it on top.
  function showPlayer(el, onTop) {
    el.classList.add("is-active");
    el.classList.toggle("is-front", !!onTop);
  }
  // Fade a player out (CSS opacity -> 0 over 0.35 s).
  function hidePlayer(el) {
    el.classList.remove("is-active");
  }

  // Pause the crossfade machinery; both players keep their current frame.
  function stopIdleLoop() {
    idleActive = false;
    idleFading = false;
    if (idleRaf) {
      cancelAnimationFrame(idleRaf);
      idleRaf = null;
    }
  }

  // Bring the main player to the front (used by the spin / fallback playback).
  function focusMainVideo() {
    showPlayer(videoA, true);
    backgroundVideo.classList.remove("is-active", "is-front");
    safePause(backgroundVideo);
  }

  // One hop: the pre-rolled back player fades in over the active one (CSS
  // opacity 0 -> 1), then the old active player is paused and reset to
  // idleLoopStart, ready for the next hop.
  function swapIdlePlayers(bounds) {
    const old = idleFront;
    const next = idleBack;
    idleFront = next;
    idleBack = old;
    idleFading = false;
    safePlay(next);
    showPlayer(next, true);
    // Let the 0.35 s opacity transition finish before parking the old player.
    setTimeout(() => {
      hidePlayer(old);
      safePause(old);
      safeSeek(old, bounds.start);
    }, CROSSFADE_SECONDS * 1000);
  }

  // Called 0.35 s before idleLoopEnd: start the second player at idleLoopStart
  // and crossfade to it, so the motion never rewinds or freezes.
  function startIdleCrossfade(bounds) {
    if (!idleActive || idleFading) return;
    const b = bounds || idleBounds();
    if (!b) return;
    idleFading = true;
    const next = idleBack;
    safePause(next);
    safeSeek(next, b.start);
    safePlay(next);
    // Wait until the new player really has frames, then fade it in. The old
    // player keeps playing forwards meanwhile, so the seam is invisible.
    let revealed = false;
    const reveal = () => {
      if (revealed) return;
      revealed = true;
      next.removeEventListener("canplay", reveal);
      next.removeEventListener("playing", reveal);
      if (!idleActive || !idleFading || next !== idleBack) return;
      swapIdlePlayers(b);
    };
    if (next.readyState >= 2) {
      reveal();
    } else {
      next.addEventListener("canplay", reveal);
      next.addEventListener("playing", reveal);
      // Safety net for slow devices: never stall the loop.
      setTimeout(reveal, 120);
    }
  }

  function startIdleLoop() {
    const bounds = idleBounds();
    if (!bounds) return false;
    stopIdleLoop();
    idleActive = true;
    idleFading = false;
    // Fresh start: the leading player begins at idleLoopStart (visible), the
    // second one is parked on idleLoopStart behind it.
    idleFront = videoA;
    idleBack = backgroundVideo;
    backgroundVideo.classList.remove("is-active", "is-front");
    safePause(backgroundVideo);
    safeSeek(backgroundVideo, bounds.start);
    showPlayer(videoA, true);
    // Start at the beginning of the loop so the shaker moves right away.
    if (!(videoA.currentTime >= bounds.start && videoA.currentTime < bounds.end - 0.05)) {
      safeSeek(videoA, bounds.start);
    }
    safePlay(videoA);
    armIdleEvents();
    idleRaf = requestAnimationFrame(idleMonitor);
    return true;
  }

  // Watchdog: some mobile browsers pause an off-screen/background player or
  // emit very few `timeupdate` events. Restart the idle loop if it stopped.
  function ensureIdleRunning() {
    if (!idleActive || idleFading || document.hidden) return;
    const b = idleBounds();
    if (!b) return;
    const front = idleFront;
    // Front player already ran into the end of the segment without a hop
    // (e.g. timers were throttled) -> hop right away.
    if (front.currentTime >= b.end - CROSSFADE_SECONDS) {
      startIdleCrossfade(b);
      return;
    }
    // Front player paused itself (buffering/autoplay blocked) -> resume it.
    if (front.paused && front.readyState >= 2) {
      if (!(front.currentTime >= b.start && front.currentTime < b.end)) safeSeek(front, b.start);
      safePlay(front);
    }
  }

  // Time monitor: schedules the hop 0.35 s before idleLoopEnd. requestAnimation
  // Frame gives the smooth path, `timeupdate` (see armIdleEvents) covers tabs
  // where rAF is throttled.
  function idleMonitor() {
    if (!idleActive) {
      idleRaf = null;
      return;
    }
    idleRaf = requestAnimationFrame(idleMonitor);
    if (idleFading) return;
    const b = idleBounds();
    if (!b) return;
    if (idleFront.currentTime >= b.end - CROSSFADE_SECONDS) {
      startIdleCrossfade(b);
    }
  }

  function armIdleEvents() {
    // `timeupdate` fires ~4x/s: fine-grained enough to catch the fade point
    // even when requestAnimationFrame is throttled.
    [videoA, videoB].forEach((el) => {
      if (el._voIdleTick) el.removeEventListener("timeupdate", el._voIdleTick);
      el._voIdleTick = () => {
        if (!idleActive || idleFading || el !== idleFront) return;
        const b = idleBounds();
        if (b && el.currentTime >= b.end - CROSSFADE_SECONDS) startIdleCrossfade(b);
      };
      el.addEventListener("timeupdate", el._voIdleTick);
    });
    if (!window._voIdleWatchdog) {
      window._voIdleWatchdog = setInterval(ensureIdleRunning, 500);
    }
  }

  // Leave the idle loop and play the FULL clip from the very beginning (spin):
  // the helper player is faded out and paused, the main player restarts at
  // 0.0 so the guest sees the whole animation and the prize card lands on
  // prizeRevealSeconds.
  function exitIdleLoopForward() {
    stopIdleLoop();
    // Fade the helper player out (opacity -> 0) and park it at idleLoopStart.
    hidePlayer(backgroundVideo);
    backgroundVideo.classList.remove("is-front");
    safePause(backgroundVideo);
    // While the helper fades out (0.35 s) the main player is on screen: start
    // playing it first (it may be parked on its last frame), then normalize
    // the position to the very beginning of the clip.
    showPlayer(videoA, true);
    safePlay(videoA);
    safeSeek(videoA, 0);
    restartMainFromZero();
    videoStarted = true;
  }

  // Force the main player to the very first frame (0.0 s) of the clip.
  function restartMainFromZero() {
    const normalize = () => {
      if (videoA.currentTime > 0.1) safeSeek(videoA, 0);
    };
    // 'seeked' -> re-assert 0 if the player had already advanced or the seek
    // happened while the element was paused; 'playing' -> re-assert once real
    // playback starts so no later resume can drift.
    videoA.addEventListener("seeked", normalize, { once: true });
    if (videoA.readyState >= 2) setTimeout(normalize, 120);
  }

  function ensureVideoPlaying() {
    if (videoStarted && idleActive) return;
    videoStarted = true;
    // Idle mode keeps the closed shaker shaking between idleLoopStart and
    // idleLoopEnd (forward only, seamless crossfade) instead of freezing.
    if (startIdleLoop()) return;
    // Degenerate idle range: plain playback from the start.
    stopIdleLoop();
    focusMainVideo();
    safeSeek(videoA, 0);
    safePlay(videoA);
  }
  // Non-idle playback helper (locked state / coupon restore). The spin itself
  // always starts the full clip via exitIdleLoopForward().
  function playVideoFrom(seconds) {
    stopIdleLoop();
    focusMainVideo();
    safePause(videoA);
    safeSeek(videoA, seconds || 0);
    safePlay(videoA);
  }
  function pauseVideo() {
    safePause(videoA);
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
    // Idle crossfade loop is cancelled instantly: the helper player is hidden
    // and paused, the main player restarts from the very beginning of the clip
    // (0.0 s) so the guest sees the full animation and the prize card lands on
    // prizeRevealSeconds.
    exitIdleLoopForward();

    setScreens(false, true);
    prizePopup.classList.remove("revealed");
    // Strictly hidden for the whole video (shaking + opening the shaker).
    hideClaimButton();
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
        // Return to the start screen: the closed shaker resumes its idle loop.
        setTimeout(() => {
          setScreens(true, false);
          videoStarted = false;
          ensureVideoPlaying();
        }, 2500);
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

      // The spin always restarts the clip at 0.0 s, so both the timer and the
      // frame fallback are armed once the main player really is back at the
      // beginning (otherwise the reveal could fire too early).
      const armReveal = () => {
        scheduleReveal(revealSec);
        armVideoRevealFallback(revealSec);
      };
      if (videoA.currentTime <= 0.05) {
        armReveal();
      } else {
        let armed = false;
        const onSeeked = () => {
          if (armed) return;
          armed = true;
          videoA.removeEventListener("seeked", onSeeked);
          armReveal();
        };
        videoA.addEventListener("seeked", onSeeked);
        // Safety net: never lose the reveal if 'seeked' does not fire.
        setTimeout(() => { if (!armed) onSeeked(); }, 400);
      }
    } catch (err) {
      // Non-2xx or network error: show the backend error message if present.
      const msg = navigator.onLine === false ? t("offline") : (t("errorSpin"));
      showToast(msg, 3500);
      setTimeout(() => {
        setScreens(true, false);
        videoStarted = false;
        ensureVideoPlaying();
      }, 2800);
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
    // A single 'timeupdate' listener that triggers reveal when the main player
    // passes the reveal second OR reaches the end ('ended'). Works even if the
    // timer was delayed because the video started a fraction later.
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
    prizeName.style.color = prizeColorOf(prize);
    prizePopup.classList.add("revealed");
    applyTexts();
    // The CTA fades in only after the card has flown in (+0.4 s).
    scheduleClaimButton();
  }

  // ==================================================================
  //  FLOW: claim -> coupon
  // ==================================================================
  async function claimPrize() {
    if (!currentPrize || !currentPrize.couponId) return;
    // Ignore taps that somehow reach the still hidden/animating CTA.
    if (btnGoogle.hidden || btnGoogle.disabled) return;
    if (config.googleReviewsUrl) {
      try { window.open(config.googleReviewsUrl, "_blank", "noopener"); }
      catch (e) { window.location.href = config.googleReviewsUrl; }
    }
    enterCouponMode(currentPrize);
  }

  function enterCouponMode(prize) {
    setPrizeMedia(couponIcon, prize, "coupon-img");
    couponName.textContent = prizeNameOf(prize);
    couponName.style.color = prizeColorOf(prize);
    couponIdEl.textContent = "#" + String(prize.couponId).replace(/[^a-z0-9]/gi, "").slice(0, 8);
    const label = (config.prizeLabel && config.prizeLabel[lang]) || "";
    const labelEl = $("t-coupon-title");
    labelEl.textContent = label + " " + (prize.icon || "");
    labelEl.style.color = config.prizeLabelColor || "#d4af37";
    couponWrap.hidden = false;
    hideClaimButton();
    btnRedeem.hidden = false;
    if (!couponDeadline) couponDeadline = Date.now() + (config.couponLifetimeMinutes || 15) * 60 * 1000;

    if (!loadState() || loadState().redeemed) {
      saveState({
        couponId: prize.couponId,
        prize: { id: prize.id, icon: prize.icon, image: prize.image || "", name: prize.name, color: prize.color },
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
      color: (st.prize && st.prize.color) || "#ffffff",
      id: st.prize && st.prize.id
    };
    const issuedAt = st.issuedAt || Date.now();
    couponDeadline = issuedAt + (config.couponLifetimeMinutes || 15) * 60 * 1000;
    setScreens(false, true);
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
    // Back on the start screen the claim CTA is hidden again (it only ever
    // appears once the prize card is on screen).
    hideClaimButton();
    btnRedeem.hidden = true;
    setScreens(true, false);
    videoStarted = false;
    // Back on the start screen: resume the seamless idle crossfade loop.
    ensureVideoPlaying();
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
        if (Number.isFinite(Number(data.idleLoopStart))) config.idleLoopStart = Number(data.idleLoopStart);
        if (Number.isFinite(Number(data.idleLoopEnd))) config.idleLoopEnd = Number(data.idleLoopEnd);
        config.enforceUserLimit = data.enforceUserLimit !== false;
        if (data.prizeLabel && typeof data.prizeLabel === "object") {
          config.prizeLabel = {
            ro: data.prizeLabel.ro || "",
            ru: data.prizeLabel.ru || "",
            en: data.prizeLabel.en || ""
          };
        }
        config.prizeLabelColor = data.prizeLabelColor || "#d4af37";
        // Start screen texts (per language) + colors.
        ["startTitle", "startSubtitle", "startButtonText"].forEach((key) => {
          if (data[key] && typeof data[key] === "object") {
            config[key] = {
              ro: data[key].ro || "",
              ru: data[key].ru || "",
              en: data[key].en || ""
            };
          }
        });
        if (data.startTitleColor) config.startTitleColor = data.startTitleColor;
        if (data.startSubtitleColor) config.startSubtitleColor = data.startSubtitleColor;
        if (data.startButtonTextColor) config.startButtonTextColor = data.startButtonTextColor;
        if (data.startButtonBgColor) config.startButtonBgColor = data.startButtonBgColor;
      }
    } catch (e) {}

    // When the admin disabled user control, clear any previously stored
    // "already got the gift" lock so the shaker can be spun again right away.
    if (config.enforceUserLimit === false) {
      try { localStorage.removeItem(REDEEMED_LOCK_KEY); } catch (e) {}
    }

    // Apply the freshly loaded badge text/colors (config may have changed).
    applyTexts();

    // If already redeemed today -> show locked state but keep video.
    // Lock is skipped entirely when the admin has disabled user control.
    if (isUserLimitEnabled() && redeemedLock()) {
      setScreens(false, true);
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