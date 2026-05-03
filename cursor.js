/* =============================================================
   ro-cursor.js
   Custom RO-style cursor (idle cat 2-frame · active arrow 5-frame · pressed)
   - rAF-throttled mousemove (GPU-friendly transform translate3d only)
   - Skips on touch / coarse-pointer devices
   - Hidden when window not focused
   ============================================================= */
(function () {
  // Bail on touch / coarse pointer
  const isTouch =
    !window.matchMedia ||
    window.matchMedia("(hover: none)").matches ||
    window.matchMedia("(pointer: coarse)").matches;
  if (isTouch) return;

  // Bail on reduced motion preference's strictest case (still show, no anim CSS handles it)
  // (we still render cursor div; CSS @media handles animation freeze)

  const cursor = document.createElement("div");
  cursor.className = "ro-cursor";
  cursor.setAttribute("aria-hidden", "true");
  document.body.appendChild(cursor);

  // Pre-load all frames so first paint is sharp
  [
    "./cursors/idle-1.png",
    "./cursors/idle-2.png",
    "./cursors/active-1.png",
    "./cursors/active-2.png",
    "./cursors/active-3.png",
    "./cursors/active-4.png",
    "./cursors/active-5.png",
  ].forEach((src) => {
    const img = new Image();
    img.src = src;
  });

  // ---- Position tracking (rAF throttled) ----
  let mx = -100;
  let my = -100;
  let pending = false;

  function applyTransform() {
    pending = false;
    // Hotspot offset: cat ~3,2; arrow tip ~1,1. Use small consistent offset.
    const offsetX = -2;
    const offsetY = -2;
    cursor.style.setProperty("--x", `${mx + offsetX}px`);
    cursor.style.setProperty("--y", `${my + offsetY}px`);
    cursor.style.transform = `translate3d(${mx + offsetX}px, ${my + offsetY}px, 0)`;
  }

  document.addEventListener(
    "mousemove",
    function (e) {
      mx = e.clientX;
      my = e.clientY;
      if (!pending) {
        pending = true;
        requestAnimationFrame(applyTransform);
      }
    },
    { passive: true }
  );

  // ---- Hover state: idle ↔ active / attack / pickup ----
  // 一般可點 → cat
  // 波利 → 攻擊圖示
  // 蘋果 → 撿取圖示
  const ACTIVE_SELECTOR =
    'a, button, [role="button"], [type="submit"], .tool-row a, .link-tile:not(.link-tile--soon), .donate-cta, .meta-link, .back-link';
  const ATTACK_SELECTOR = '.poring-wrapper';
  const PICKUP_SELECTOR = '.apple';

  function applyHoverState(target) {
    if (!target) {
      cursor.classList.remove("is-active", "is-attack", "is-pickup");
      return;
    }
    const isAttack = !!target.closest(ATTACK_SELECTOR);
    const isPickup = !!target.closest(PICKUP_SELECTOR);
    const isActive = !!target.closest(ACTIVE_SELECTOR);
    cursor.classList.toggle("is-attack", isAttack);
    cursor.classList.toggle("is-pickup", !isAttack && isPickup);
    cursor.classList.toggle("is-active", !isAttack && !isPickup && isActive);
  }

  document.addEventListener(
    "mouseover",
    function (e) { applyHoverState(e.target); },
    { passive: true }
  );

  document.addEventListener(
    "mouseout",
    function (e) {
      // 離開時依新位置重新判定
      applyHoverState(e.relatedTarget);
    },
    { passive: true }
  );

  // ---- Pressed state ----
  document.addEventListener(
    "mousedown",
    function () {
      cursor.classList.add("is-pressed");
    },
    { passive: true }
  );
  document.addEventListener(
    "mouseup",
    function () {
      cursor.classList.remove("is-pressed");
    },
    { passive: true }
  );

  // ---- Hide while window unfocused / cursor leaves viewport ----
  document.addEventListener("mouseleave", function () {
    cursor.style.opacity = "0";
  });
  document.addEventListener("mouseenter", function () {
    cursor.style.opacity = "1";
  });
})();
