/* =============================================================
   poring.js  ·  趣味彩蛋：滑鼠掉蘋果 → 波利撿取生態
   - 滑鼠移動會偶爾掉一顆蘋果（節流）
   - 蘋果有重力，掉到地面後靜止
   - 波利從邊緣登場，找最近的蘋果走過去吃掉
   - 吃完繼續找；無蘋果 5 秒就跑掉；最多活 30 秒
   性能：純 transform translate3d (GPU)，每隻 / 每顆一個 rAF
   ============================================================= */
(function () {
  // 觸控裝置不啟用
  if (window.matchMedia &&
      (window.matchMedia("(hover: none)").matches ||
       window.matchMedia("(pointer: coarse)").matches)) return;

  // ---- 可調參數 ----
  // 進站後統一延遲（波利 + 蘋果都等 30 秒才開始）
  const START_DELAY_MS  = 30 * 1000;
  const SPAWN_MIN_MS    = 30 * 1000;     // 每 30 秒一波
  const SPAWN_MAX_MS    = 30 * 1000;
  const GROUP_MIN = 1;                   // 一波 1-2 隻
  const GROUP_MAX = 2;
  const STAGGER_MIN = 400;
  const STAGGER_MAX = 1200;

  // 蘋果
  const APPLE_START_DELAY_MS   = START_DELAY_MS; // 同 30 秒延遲
  const APPLE_DROP_INTERVAL_MS = 15 * 1000;      // 每 15 秒掉一顆
  const APPLE_LIFETIME_MS = 15000;
  const APPLE_MAX         = 40;
  const GRAVITY           = 380;
  const APPLE_FALL_MIN    = 25;
  const APPLE_FALL_MAX    = 55;

  // 波利壽命機制：基礎 15s，每吃一顆 +10s
  const POR_BASE_LIFETIME_MS = 15 * 1000;
  const POR_LIFE_BONUS_MS    = 10 * 1000;
  // 速度（px/s）
  const SPEED_HUNT   = 180;
  const SPEED_FOLLOW = 130;
  const SPEED_DEPART = 80;
  const EAT_DISTANCE       = 22;         // 距蘋果多近算吃到
  const POR_HP             = 6;          // 點 N 次死亡
  const CRIT_BASE          = 0.10;       // 基礎暴擊率
  const CRIT_PER_APPLE     = 0.10;       // 每顆撿到的蘋果 +10% 暴擊
  const CRIT_MAX           = 1.00;       // 暴擊率上限 100%
  const MISS_CHANCE        = 0.15;       // 15% Miss（0 傷害、無受傷停頓）

  // ---- 玩家狀態（撿蘋果累積） ----
  const player = {
    apples: 0,                          // 總撿到顆數 = $
    get critChance() {
      return Math.min(CRIT_MAX, CRIT_BASE + this.apples * CRIT_PER_APPLE);
    },
  };

  // ---- 全域 ----
  const apples = [];
  const porings = [];
  let mouseX = window.innerWidth / 2;
  let mouseY = window.innerHeight / 2;
  const pageStartAt = Date.now();   // 進站時間
  let lastDropAt = 0;                // 上次掉蘋果的時間
  let lastTime = performance.now();

  function rand(min, max) { return min + Math.random() * (max - min); }
  function randInt(min, max) { return Math.floor(rand(min, max + 1)); }

  // 預載
  ["walk-1", "walk-2", "walk-3", "walk-4"].forEach(function (n) {
    const img = new Image();
    img.src = "./poring/" + n + ".png";
  });

  // 預載蘋果圖（item 501，從 divine-pride 抓的）
  (function () { const i = new Image(); i.src = "./poring/apple.png"; })();

  // ---- 滑鼠追蹤 ----
  document.addEventListener("mousemove", function (e) {
    mouseX = e.clientX;
    mouseY = e.clientY;
    maybeDropApple();
  }, { passive: true });

  function maybeDropApple() {
    if (apples.length >= APPLE_MAX) return;
    const now = Date.now();
    // 進站後前 10 秒不掉蘋果
    if (now - pageStartAt < APPLE_START_DELAY_MS) return;
    if (now - lastDropAt < APPLE_DROP_INTERVAL_MS) return;
    dropApple(mouseX, mouseY);
    lastDropAt = now;
  }

  function dropApple(sx, sy) {
    const el = document.createElement("div");
    el.className = "apple";
    document.body.appendChild(el);

    // 隨機位置：水平 ±40px，垂直 25–80px 任意落點
    const jitterX = (Math.random() - 0.5) * 80;
    const fallDist = APPLE_FALL_MIN + Math.random() * (APPLE_FALL_MAX - APPLE_FALL_MIN);
    const startX = sx + jitterX;
    const startY = sy;

    const apple = {
      el: el,
      x: startX,
      y: startY,
      vy: 0,
      groundY: startY + fallDist,
      grounded: false,
      claimedBy: null,
      eaten: false,
      bornAt: Date.now(),
    };
    // 不能掉到視窗外（防呆）
    if (apple.groundY > window.innerHeight - 14) apple.groundY = window.innerHeight - 14;
    if (apple.x < 12) apple.x = 12;
    if (apple.x > window.innerWidth - 12) apple.x = window.innerWidth - 12;
    apples.push(apple);
    el.style.transform = "translate3d(" + Math.round(apple.x - 12) + "px," + Math.round(apple.y - 12) + "px,0)";

    // 玩家可以撿
    el.addEventListener("click", function (e) {
      if (apple.eaten) return;
      spawnPickupText(apple.x, apple.y);
      removeApple(apple);
      e.stopPropagation();
    });

    // 自動過期
    setTimeout(function () {
      if (!apple.eaten) removeApple(apple);
    }, APPLE_LIFETIME_MS);
  }

  function removeApple(apple) {
    apple.eaten = true;
    if (apple.claimedBy) apple.claimedBy.target = null;
    const idx = apples.indexOf(apple);
    if (idx >= 0) apples.splice(idx, 1);
    apple.el.remove();
  }

  // ---- 波利 ----
  function PoringPet(side) {
    const el = document.createElement("div");
    el.className = "poring-wrapper";
    const sprite = document.createElement("div");
    sprite.className = "poring";
    // 從左邊出生 → 朝右走 → 立刻翻轉（原圖朝左）
    if (side === "left") sprite.classList.add("poring--flip");
    el.appendChild(sprite);
    document.body.appendChild(el);

    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const pet = {
      el: el,
      sprite: sprite,
      x: side === "left" ? -50 : vw + 50,
      y: vh - 60 + (Math.random() - 0.5) * 30,
      facingLeft: side !== "left",
      // HUNT → FOLLOW → DEPART → DYING
      state: apples.length > 0 ? "HUNT" : "DEPART",
      target: null,
      followOffsetX: (Math.random() - 0.5) * 80,
      followOffsetY: 30 + Math.random() * 20,
      exitX: side === "left" ? vw + 120 : -120,
      bornAt: Date.now(),
      diesAt: Date.now() + POR_BASE_LIFETIME_MS,   // 個人壽命：到時就 DEPART
      everAte: false,                               // 有沒有吃過蘋果
      hp: POR_HP,
      dying: false,
      dead: false,
    };

    // 點擊 → 扣血
    el.addEventListener("click", function (e) {
      if (pet.dead || pet.dying) return;
      hurtPoring(pet);
      e.stopPropagation();
    });

    porings.push(pet);
    return pet;
  }

  // 玩家撿蘋果浮 $+1
  function spawnPickupText(x, y) {
    const el = document.createElement("div");
    el.className = "pickup-text";
    el.textContent = "$+1";
    el.style.left = Math.round(x - 12) + "px";
    el.style.top = Math.round(y - 28) + "px";
    document.body.appendChild(el);
    setTimeout(function () { el.remove(); }, 850);

    player.apples += 1;
    updateHUD();
  }

  function spawnCritSpendText(x, y, amount) {
    const el = document.createElement("div");
    el.className = "pickup-text pickup-text--spend";
    el.textContent = "$-" + amount;
    el.style.left = Math.round(x - 12) + "px";
    el.style.top = Math.round(y - 32) + "px";
    document.body.appendChild(el);
    setTimeout(function () { el.remove(); }, 950);
  }

  // ---- HUD ----
  let hud;
  function ensureHUD() {
    if (hud) return;
    hud = document.createElement("div");
    hud.className = "ro-hud";
    document.body.appendChild(hud);
    updateHUD();
  }
  function updateHUD() {
    if (!hud) return;
    const pct = Math.round(player.critChance * 100);
    hud.innerHTML =
      '<span class="ro-hud__row"><span class="ro-hud__label">$</span><span class="ro-hud__val">' + player.apples + '</span></span>' +
      '<span class="ro-hud__row"><span class="ro-hud__label">CRI</span><span class="ro-hud__val">' + pct + '%</span></span>';
  }
  ensureHUD();

  // 浮動數字（type: "normal" | "crit" | "miss"）
  function spawnDamageText(pet, text, type) {
    const el = document.createElement("div");
    el.className = "damage-text damage-text--" + (type || "normal");
    el.style.left = Math.round(pet.x) + "px";
    el.style.top = Math.round(pet.y - 50) + "px";

    if (type === "crit") {
      // 紅星爆擊背景 + Critical!! sprite + 數字疊在中間
      const burst = document.createElement("div");
      burst.className = "crit-burst";
      el.appendChild(burst);

      const critText = document.createElement("div");
      critText.className = "crit-text";
      el.appendChild(critText);

      const num = document.createElement("div");
      num.className = "crit-num";
      num.textContent = text;
      el.appendChild(num);
    } else if (type === "miss") {
      // 用 RO 原圖的 Miss sprite
      const miss = document.createElement("div");
      miss.className = "miss-sprite";
      el.appendChild(miss);
    } else {
      el.textContent = text;
    }

    document.body.appendChild(el);
    setTimeout(function () { el.remove(); }, type === "crit" ? 1100 : 850);
  }

  function hurtPoring(pet) {
    // 骰子：Miss / Crit / Normal（暴擊率取決於 player.critChance）
    const roll = Math.random();
    const effectiveCrit = player.critChance;
    let damage, kind;
    if (roll < MISS_CHANCE) {
      damage = 0;
      kind = "miss";
    } else if (roll < MISS_CHANCE + effectiveCrit) {
      damage = 2;
      kind = "crit";
    } else {
      damage = 1;
      kind = "normal";
    }

    spawnDamageText(pet, "-" + damage, kind);

    // 觸發 CRI → 累積的 $ 全部歸零（all-in 機制）
    if (kind === "crit" && player.apples > 0) {
      const spent = player.apples;
      player.apples = 0;
      spawnCritSpendText(pet.x + 24, pet.y, spent);
      updateHUD();
    }

    if (kind === "miss") {
      // Miss 沒打到 → 沒扣血、沒受傷停頓
      return;
    }

    pet.hp -= damage;

    if (pet.hp <= 0) { killPoring(pet); return; }

    // 受傷中：停止走路 0.5 秒
    pet.hurting = true;
    pet.sprite.style.animation = "none";
    pet.sprite.style.backgroundImage = "url('./poring/hurt-1.png')";
    pet.sprite.style.filter = kind === "crit"
      ? "brightness(3) saturate(2.5) sepia(0.6)"
      : "brightness(2.6) saturate(2) sepia(0.5)";

    setTimeout(function () {
      if (pet.dead || pet.dying) return;
      pet.sprite.style.backgroundImage = "url('./poring/hurt-2.png')";
      pet.sprite.style.filter = "brightness(1.5) saturate(1.5)";
    }, 250);

    setTimeout(function () {
      if (pet.dead || pet.dying) return;
      pet.hurting = false;
      pet.sprite.style.animation = "";
      pet.sprite.style.backgroundImage = "";
      pet.sprite.style.filter = "";
    }, 500);
  }

  function killPoring(pet) {
    pet.dying = true;
    pet.hurting = false;
    if (pet.target) { pet.target.claimedBy = null; pet.target = null; }
    pet.el.classList.add("poring-wrapper--dying");

    // 同樣明確停 hop，逐格切 die sprite
    pet.sprite.style.animation = "none";
    pet.sprite.style.filter = "";
    pet.sprite.style.backgroundImage = "url('./poring/die-1.png')";

    setTimeout(function () { pet.sprite.style.backgroundImage = "url('./poring/die-2.png')"; }, 175);
    setTimeout(function () { pet.sprite.style.backgroundImage = "url('./poring/die-3.png')"; }, 350);
    setTimeout(function () { pet.sprite.style.backgroundImage = "url('./poring/die-4.png')"; }, 525);
    setTimeout(function () { pet.sprite.style.opacity = "0"; }, 600);
    setTimeout(function () { destroyPoring(pet); }, 720);
  }

  function findNearestApple(pet) {
    // 不過濾 claimedBy → 所有波利都能看到所有蘋果，誰先到誰吃
    let nearest = null;
    let minDist = Infinity;
    for (let i = 0; i < apples.length; i++) {
      const a = apples[i];
      if (a.eaten) continue;
      const dx = a.x - pet.x;
      const dy = a.y - pet.y;
      const d = dx * dx + dy * dy;
      if (d < minDist) { minDist = d; nearest = a; }
    }
    return nearest;
  }

  function eatApple(pet, apple) {
    pet.sprite.style.animation = "poring-munch 0.28s ease-out";
    setTimeout(function () { if (pet.sprite) pet.sprite.style.animation = ""; }, 290);
    removeApple(apple);
    pet.everAte = true;
    pet.diesAt += POR_LIFE_BONUS_MS;   // 每顆 +10 秒
  }

  function updatePoring(pet, dt) {
    if (pet.dead || pet.dying) return;
    if (pet.hurting) return;        // 受傷期間定住不走

    // ---- 壽命到期 → 強制 DEPART ----
    if (pet.state !== "DEPART" && Date.now() > pet.diesAt) {
      pet.state = "DEPART";
      pet.target = null;
    }

    // ---- 看到新蘋果（FOLLOW 或 DEPART 中）→ 切回 HUNT ----
    if (pet.state !== "HUNT" && pet.state !== "DEPART") {
      const newApple = findNearestApple(pet);
      if (newApple) {
        pet.state = "HUNT";
        pet.target = newApple;
      }
    } else if (pet.state === "DEPART" && Date.now() <= pet.diesAt) {
      // DEPART 但還沒到壽命（純粹是沒蘋果先離場）→ 看到蘋果回頭
      const newApple = findNearestApple(pet);
      if (newApple) {
        pet.state = "HUNT";
        pet.target = newApple;
      }
    }

    // ---- HUNT 狀態 ----
    if (pet.state === "HUNT") {
      // 每一幀都重新找最近蘋果
      const nearest = findNearestApple(pet);
      if (!nearest) {
        // 沒蘋果可追：吃過 → FOLLOW；沒吃過 → DEPART
        pet.target = null;
        pet.state = pet.everAte ? "FOLLOW" : "DEPART";
      } else if (!pet.target || pet.target.eaten) {
        pet.target = nearest;
      } else if (nearest !== pet.target) {
        // 新的明顯更近（< 0.65 倍）就換
        const dT = Math.hypot(pet.target.x - pet.x, pet.target.y - pet.y);
        const dN = Math.hypot(nearest.x - pet.x, nearest.y - pet.y);
        if (dN < dT * 0.65) pet.target = nearest;
      }
    }

    // ---- 計算目標位置 + 速度 ----
    let tx, ty, speed;
    if (pet.state === "HUNT" && pet.target) {
      tx = pet.target.x;
      ty = pet.target.y - 4;
      speed = SPEED_HUNT;

      // 距離夠近 → 吃掉，進入 FOLLOW（diesAt 已經在 eatApple 內 +10s）
      const ddx = tx - pet.x;
      const ddy = ty - pet.y;
      if (ddx * ddx + ddy * ddy < EAT_DISTANCE * EAT_DISTANCE) {
        eatApple(pet, pet.target);
        pet.target = null;
        pet.state = "FOLLOW";
      }
    } else if (pet.state === "FOLLOW") {
      // 跟著游標（含個人偏移） — 步速設定 < 滑鼠移動速度，看起來像在追
      tx = mouseX + pet.followOffsetX;
      ty = mouseY + pet.followOffsetY;
      speed = SPEED_FOLLOW;
    } else {
      // DEPART：對面側邊
      tx = pet.exitX;
      ty = pet.y;
      speed = SPEED_DEPART;
    }

    // 用最大步速移動，避免「黏」效果
    const dx = tx - pet.x;
    const dy = ty - pet.y;
    const dist = Math.hypot(dx, dy);
    if (dist > 0.5) {
      const step = Math.min(speed * dt, dist);
      pet.x += (dx / dist) * step;
      pet.y += (dy / dist) * step;

      // 朝向（依水平方向）
      const facingLeft = dx < 0;
      if (facingLeft !== pet.facingLeft) {
        if (facingLeft) pet.sprite.classList.remove("poring--flip");
        else pet.sprite.classList.add("poring--flip");
        pet.facingLeft = facingLeft;
      }
    }

    pet.el.style.transform =
      "translate3d(" + Math.round(pet.x - 25) + "px," + Math.round(pet.y - 30) + "px,0)";

    // DEPART 完成
    if (pet.state === "DEPART" &&
        (pet.x < -100 || pet.x > window.innerWidth + 100)) {
      destroyPoring(pet);
    }
  }

  function destroyPoring(pet) {
    pet.dead = true;
    pet.el.remove();
    const idx = porings.indexOf(pet);
    if (idx >= 0) porings.splice(idx, 1);
  }

  // ---- 蘋果重力（緩降，掉一小段就停） ----
  function updateApple(apple, dt) {
    if (apple.eaten) return;
    if (!apple.grounded) {
      apple.vy += GRAVITY * dt;
      apple.y += apple.vy * dt;
      if (apple.y >= apple.groundY) {
        apple.y = apple.groundY;
        apple.vy = 0;
        apple.grounded = true;
      }
      apple.el.style.transform =
        "translate3d(" + Math.round(apple.x - 12) + "px," + Math.round(apple.y - 12) + "px,0)";
    }
  }

  // ---- 主迴圈 ----
  function tick(now) {
    const dt = Math.min(0.05, (now - lastTime) / 1000);
    lastTime = now;

    if (!document.hidden) {
      for (let i = apples.length - 1; i >= 0; i--) updateApple(apples[i], dt);
      for (let i = porings.length - 1; i >= 0; i--) updatePoring(porings[i], dt);
    }
    requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);

  // ---- 召喚 ----
  function spawnGroup() {
    if (document.hidden) { schedule(30 * 1000); return; }
    const count = randInt(GROUP_MIN, GROUP_MAX);
    const side = Math.random() < 0.5 ? "left" : "right";
    let cumulativeDelay = 0;
    for (let i = 0; i < count; i++) {
      setTimeout(function () { if (!document.hidden) PoringPet(side); }, cumulativeDelay);
      cumulativeDelay += rand(STAGGER_MIN, STAGGER_MAX);
    }
    schedule();
  }

  function schedule(customMs) {
    const delay = customMs != null ? customMs : rand(SPAWN_MIN_MS, SPAWN_MAX_MS);
    setTimeout(spawnGroup, delay);
  }

  // 進站後 30 秒才開始（與蘋果同步）
  setTimeout(spawnGroup, START_DELAY_MS);
})();
