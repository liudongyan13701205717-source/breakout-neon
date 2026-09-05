/* 霓虹砖块 · Neon Breakout —— 单文件离线实现（依赖同级 matter.min.js）
 * 渲染：画布只负责游戏画面；所有常驻 HUD 文字（分数/关卡/生命/连击/双倍/能量/激光）
 * 均通过 DOM 顶部栏显示，由 syncHud() 每帧同步，彻底避免画布文字与 DOM 文字互相遮挡。
 * 本版新增：元进度（霓虹币/永久升级/存档续玩）、穿甲与电磁脉冲道具、引力井/再生砖、
 * BOSS 突袭模式、Matter 物理碎片破碎、霓虹辉光/拖尾/闪光/命中停顿、每模式退出到主菜单。
 */
(function () {
  "use strict";

  const { Engine, Composite, Bodies, Body, Events } = Matter;
  const PI2 = Math.PI * 2;

  const LOGICAL_W = 900;
  const LOGICAL_H = 640;
  const STARTING_LIVES = 3;
  const LASER_CD = 2600;
  const SLOW_FACTOR = 0.55;
  const HIGH_KEY = "breakout_highscore";
  const ACH_KEY = "breakout_achievements";
  const MAP_KEY = "neon-breakout-map-v1";
  const META_KEY = "neon-breakout-meta-v2";
  const RUN_KEY = "neon-breakout-run-v1";
  const MUTE_KEY = "neon-breakout-mute";
  const DAILY_KEY = "neon-breakout-daily-v2";
  const CHRONO_PER = 40;
  const PERFECT_BONUS = 200;

  // ---------- DOM ----------
  const $ = (id) => document.getElementById(id);
  const canvas = $("game");
  const ctx = canvas.getContext("2d");

  const els = {
    score: $("score"), level: $("level"), lives: $("lives"),
    screenStart: $("screen-start"), screenOver: $("screen-over"),
    screenComplete: $("screen-complete"), screenPerk: $("screen-perk"),
    perkTitle: $("perk-title"), perkSubtitle: $("perk-subtitle"), perkCards: $("perk-cards"),
    screenHelp: $("screen-help"), bossBar: $("boss-bar"), bossFill: $("boss-fill"),
    completeStars: $("complete-stars"), overScore: $("over-score"),
    completeScore: $("complete-score"), startHigh: $("start-high"),
    startAch: $("start-ach"), overHigh: $("over-high"), completeHigh: $("complete-high"),
    screenPause: $("screen-pause"),
    editorBar: $("editor-bar"), editorPalette: $("editor-palette"), editorCode: $("editor-code"),
    hud: $("hud"),
    playHint: $("play-hint"),
    combo: $("combo"), doubleEl: $("double"),
    energyFill: $("energy-fill"), energyPct: $("energy-pct"),
    laser: $("laser"), laserTxt: $("laser-txt"),
    btnReturn: $("btn-return"),
    screenExit: $("screen-exit"), exitTitle: $("exit-title"), exitMsg: $("exit-msg"),
    btnExitSave: $("btn-exit-save"), btnExitDiscard: $("btn-exit-discard"),
    screenUpg: $("screen-upgrades"), upgList: $("upgrade-list"), upgCredits: $("upgrade-credits"),
    btnContinue: $("btn-continue"), btnUpgrades: $("btn-upgrades"),
    btnMute: $("btn-mute"),
  };

  function bindBtn(id, fn) {
    const el = $(id);
    if (el) el.addEventListener("click", () => { initAudio(); sfxUI(); fn(); });
  }

  // ---------- 状态 ----------
  const state = {
    mode: "start",
    gameMode: "classic",
    score: 0, level: 1, lives: STARTING_LIVES,
    combo: 0, comboExpire: 0,
    slowUntil: 0, bonusUntil: 0,
    laserCd: 0, laserKills: 0,
    energy: 0, pierceUntil: 0,
    levelStart: 0, levelTransitioning: false,
    bossActive: false, bossNextShot: 0,
    modPu: 0, modSpeed: 1, modTime: 1, modifierName: "",
    perks: null, customGrid: null,
    chronoBonus: 0, perfect: true,
    highScore: loadHighScore(),
    achievements: loadAchievements(),
  };

  let now = 0;
  let timeFreeze = 0;        // 命中停顿（毫秒），>0 时全局慢放
  let pendingLaser = null;   // 激光充能中：{ x }
  let laserChargeUntil = 0;
  let screenFlashA = 0, screenFlashColor = "#fff"; // 全屏闪光（电影感）
  let energyReadyNotified = false;
  let heartbeatAt = 0;
  let dailyBest = loadDailyBest();
  let exitContext = "playing";

  // ---------- 工具 ----------
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const rand = (a, b) => a + Math.random() * (b - a);

  // ---------- 砖块定义 ----------
  const BRICK_COLORS = ["#f87171","#fb923c","#fbbf24","#a3e635","#34d399","#22d3ee","#60a5fa","#a78bfa"];
  function brickSpec(code, r) {
    switch (code) {
      case 2: return { type: "hard", hp: 3, color: BRICK_COLORS[(r + 2) % BRICK_COLORS.length], points: 30 };
      case 3: return { type: "explosive", hp: 1, color: "#f43f5e", points: 20 };
      case 4: return { type: "indestructible", hp: Infinity, color: "#64748b", points: 0 };
      case 5: return { type: "boss", hp: 12 + state.level * 4, color: "#7c3aed", points: 200 };
      case 6: return { type: "phase", hp: 1, color: "#2dd4bf", points: 15 };
      case 7: return { type: "vortex", hp: 2, color: "#f472b6", points: 25 };
      case 8: return { type: "regen", hp: 1, color: "#a3e635", points: 18, regenLeft: 2 };
      case 9: return { type: "coin", hp: 1, color: "#fbbf24", points: 50, credits: 3 };
      case 10: return { type: "time", hp: 1, color: "#22d3ee", points: 20, chrono: 8 };
      case 11: return { type: "lightning", hp: 1, color: "#60a5fa", points: 25 };
      default: return { type: "normal", hp: 1, color: BRICK_COLORS[r % BRICK_COLORS.length], points: 10 };
    }
  }

  // ---------- 关卡 ----------
  const LEVELS = [
    [ // 1 涟漪
      [0,0,0,0,0,0,0,0,0,0,0,0,0],
      [0,0,0,1,1,1,1,1,1,1,0,0,0],
      [0,0,1,1,1,1,1,1,1,1,1,0,0],
      [0,1,1,1,2,2,2,2,2,1,1,1,0],
      [0,1,1,2,2,3,3,3,2,2,1,1,0],
      [0,1,1,1,2,2,2,2,2,1,1,1,0],
      [0,0,1,1,1,1,1,1,1,1,1,0,0],
      [0,0,0,1,1,1,1,1,1,1,0,0,0],
    ],
    [ // 2 棋盘
      [1,0,1,0,1,0,1,0,1,0,1,0,1],
      [0,1,0,1,0,1,0,1,0,1,0,1,0],
      [1,0,1,0,1,0,1,0,1,0,1,0,1],
      [0,1,0,1,0,1,0,1,0,1,0,1,0],
      [1,0,2,0,1,0,1,0,1,0,2,0,1],
      [0,1,0,1,0,1,0,1,0,1,0,1,0],
      [1,0,1,0,3,0,3,0,3,0,1,0,1],
      [0,4,0,4,0,4,0,4,0,4,0,4,0],
    ],
    [ // 3 要塞
      [4,4,4,4,4,4,4,4,4,4,4,4,4],
      [4,1,1,1,1,1,1,1,1,1,1,1,4],
      [4,1,2,2,2,2,2,2,2,2,2,1,4],
      [4,1,2,3,3,3,3,3,3,3,2,1,4],
      [4,1,2,3,1,1,5,1,1,3,2,1,4],
      [4,1,2,3,3,3,3,3,3,3,2,1,4],
      [4,1,2,2,2,2,2,2,2,2,2,1,4],
      [4,1,1,1,1,1,1,1,1,1,1,1,4],
      [4,4,4,4,4,4,4,4,4,4,4,4,4],
    ],
    [ // 4 漩涡
      [0,0,0,0,0,1,1,1,0,0,0,0,0],
      [0,0,0,1,1,2,2,2,1,1,0,0,0],
      [0,0,1,2,2,3,3,3,2,2,1,0,0],
      [0,1,2,3,3,4,4,4,3,3,2,1,0],
      [1,2,3,4,4,6,6,6,4,4,3,2,1],
      [0,1,2,3,3,4,4,4,3,3,2,1,0],
      [0,0,1,2,2,3,3,3,2,2,1,0,0],
      [0,0,0,1,1,2,2,2,1,1,0,0,0],
      [0,0,0,0,0,1,1,1,0,0,0,0,0],
    ],
    [ // 5 终焉·相位
      [5,5,5,5,5,5,5,5,5,5,5,5,5],
      [1,1,6,1,1,6,1,6,1,1,6,1,1],
      [1,2,6,2,3,6,3,6,3,2,6,2,1],
      [1,2,3,2,3,4,3,4,3,2,3,2,1],
      [1,1,3,3,1,4,1,4,1,3,3,1,1],
      [1,2,3,2,3,4,3,4,3,2,3,2,1],
      [1,2,6,2,3,6,3,6,3,2,6,2,1],
      [1,1,6,1,1,6,1,6,1,1,6,1,1],
    ],
  ];
  const TOTAL_LEVELS = LEVELS.length;

  // ---------- 强化 / 成就 / 元进度 ----------
  const PERK_DEFS = [
    { id: "wide",  name: "加宽挡板", icon: "🛡", desc: "挡板基础宽度 +18",     apply: (p) => { p.wide += 18; } },
    { id: "laser", name: "激光强化", icon: "⚡", desc: "激光冷却 -30%",          apply: (p) => { p.laserCdMul *= 0.7; } },
    { id: "balls", name: "多重小球", icon: "⚪", desc: "额外起始球 +1",          apply: (p) => { p.extraBalls += 1; } },
    { id: "combo", name: "连击增幅", icon: "🔥", desc: "连击倍率 +50%",          apply: (p) => { p.comboMul *= 1.5; } },
    { id: "pu",    name: "道具增益", icon: "🎁", desc: "道具掉落概率提升",      apply: (p) => { p.puChance = Math.min(0.5, p.puChance + 0.08); } },
    { id: "time",  name: "时间大师", icon: "⏱", desc: "时间奖励 ×1.5",          apply: (p) => { p.timeMul *= 1.5; } },
  ];
  function defaultPerks() {
    return { wide: 0, laserCdMul: 1, extraBalls: 0, comboMul: 1, puChance: 0.2, timeMul: 1, lifeBonus: 0, energyBonus: 0, comboBonus: 0 };
  }
  function laserCdMax() { return LASER_CD * state.perks.laserCdMul; }

  const META_DEFS = [
    { id: "life",   name: "强化装甲", icon: "❤", desc: "起始生命 +1",          max: 3, cost: (l) => 150 + l * 100 },
    { id: "wide",   name: "宽幅挡板", icon: "▭", desc: "挡板基础宽度 +8",      max: 3, cost: (l) => 120 + l * 80 },
    { id: "laser",  name: "速冷激光", icon: "⚡", desc: "激光冷却 -15%",        max: 3, cost: (l) => 120 + l * 80 },
    { id: "energy", name: "蓄能核芯", icon: "🔋", desc: "起始能量 +20",         max: 3, cost: (l) => 100 + l * 70 },
    { id: "combo",  name: "连击稳定", icon: "🔥", desc: "连击衰减更慢",         max: 3, cost: (l) => 100 + l * 70 },
    { id: "magnet", name: "磁吸力场", icon: "✸", desc: "道具掉落概率 +5%",      max: 3, cost: (l) => 90 + l * 60 },
  ];
  let meta = loadMeta();
  function loadMeta() {
    try { const o = JSON.parse(localStorage.getItem(META_KEY)); if (o && o.up) return o; } catch (e) {}
    return { credits: 0, up: {} };
  }
  function saveMeta() { try { localStorage.setItem(META_KEY, JSON.stringify(meta)); } catch (e) {} }
  function applyMeta(p) {
    p.wide += (meta.up.wide || 0) * 8;
    p.laserCdMul *= Math.pow(0.85, meta.up.laser || 0);
    p.puChance = Math.min(0.5, p.puChance + (meta.up.magnet || 0) * 0.05);
    p.lifeBonus = meta.up.life || 0;
    p.energyBonus = (meta.up.energy || 0) * 20;
    p.comboBonus = meta.up.combo || 0;
  }

  const ACH_DEFS = [
    { id: "first", name: "初次击碎" },
    { id: "combo", name: "连击大师" },
    { id: "laser", name: "激光杀手" },
    { id: "boss",  name: "击败BOSS" },
    { id: "shock", name: "电磁脉冲" },
    { id: "vortex", name: "深渊引力" },
  ];
  let unlocked = {};
  function loadAchievements() { try { return JSON.parse(localStorage.getItem(ACH_KEY)) || {}; } catch (e) { return {}; } }
  function unlock(id) {
    if (unlocked[id]) return;
    unlocked[id] = true;
    try { localStorage.setItem(ACH_KEY, JSON.stringify(unlocked)); } catch (e) {}
    updateAchievementDisplay();
    const def = ACH_DEFS.find(a => a.id === id);
    if (def) showToast("🏆 成就解锁：" + def.name, "achievement");
  }
  function updateAchievementDisplay() {
    const n = Object.keys(unlocked).filter((k) => unlocked[k]).length;
    if (els.startAch) els.startAch.textContent = "成就 " + n + "/" + ACH_DEFS.length;
  }

  function loadHighScore() { try { return parseInt(localStorage.getItem(HIGH_KEY)) || 0; } catch (e) { return 0; } }
  function saveHighScore() { try { localStorage.setItem(HIGH_KEY, String(state.highScore)); } catch (e) {} }
  function loadDailyBest() { try { return JSON.parse(localStorage.getItem(DAILY_KEY)) || {}; } catch (e) { return {}; } }
  function saveDailyBest() { try { localStorage.setItem(DAILY_KEY, JSON.stringify(dailyBest)); } catch (e) {} }
  function updateHighScoreDisplays() {
    const t = "最高分 " + state.highScore;
    if (els.startHigh) els.startHigh.textContent = t;
    if (els.overHigh) els.overHigh.textContent = t;
    if (els.completeHigh) els.completeHigh.textContent = t;
  }

  // ---------- 物理世界 ----------
  const engine = Engine.create();
  engine.gravity.x = 0; engine.gravity.y = 0;
  const world = engine.world;

  function createWalls() {
    const opts = { isStatic: true, restitution: 1, friction: 0 };
    Composite.add(world, [
      Bodies.rectangle(-10, LOGICAL_H / 2, 20, LOGICAL_H * 2, opts),
      Bodies.rectangle(LOGICAL_W + 10, LOGICAL_H / 2, 20, LOGICAL_H * 2, opts),
      Bodies.rectangle(LOGICAL_W / 2, -10, LOGICAL_W * 2, 20, opts),
    ]);
  }
  createWalls();

  let bricks = [];
  let balls = [];
  let powerups = [];
  let particles = [];
  let floats = [];
  let lasers = [];
  let bossShots = [];
  let shards = [];
  let flashes = [];

  const paddle = { x: LOGICAL_W / 2 - 65, y: LOGICAL_H - 36, w: 130, h: 16, baseW: 130, targetX: LOGICAL_W / 2 - 65, wideUntil: 0, body: null };

  function createPaddleBody() {
    if (paddle.body) Composite.remove(world, paddle.body);
    paddle.body = Bodies.rectangle(paddle.x + paddle.w / 2, paddle.y + paddle.h / 2, paddle.w, paddle.h, {
      isStatic: true, restitution: 1, friction: 0,
    });
    paddle.body.plugin = { type: "paddle" };
    Composite.add(world, paddle.body);
  }
  // 关键修复：任何导致 paddle.w 变化的时机都要重建物理体，确保“视觉宽 = 命中宽”
  function syncPaddleWidth() {
    const cur = paddle.body ? (paddle.body.bounds.max.x - paddle.body.bounds.min.x) : -1;
    if (Math.abs(cur - paddle.w) > 0.5) createPaddleBody();
  }

  function ballSpeed() { return 6 * (state.modSpeed || 1); }
  // 防卡死核心守卫（每帧在 Engine.update 之后再次调用，避免碰撞解算把 vy 重新压平）
  // 四重保险：零速/NaN 重发射 · 总速下限 · 最小垂直分量+最小反弹角 · 低幅随机微扰
  function clampBallVelocity(body) {
    const v = body.velocity;
    const std = ballSpeed();
    if (!isFinite(v.x) || !isFinite(v.y)) {
      const a = -Math.PI / 2 + (Math.random() - 0.5) * 0.8;
      Body.setVelocity(body, { x: Math.cos(a) * std, y: Math.sin(a) * std }); return;
    }
    let vx = v.x, vy = v.y, sp = Math.hypot(vx, vy);
    if (sp < 1e-4) {
      const a = -Math.PI / 2 + (Math.random() - 0.5) * 0.8;
      Body.setVelocity(body, { x: Math.cos(a) * std, y: Math.sin(a) * std }); return;
    }
    if (sp < std * 0.6) { const k = (std * 0.6) / sp; vx *= k; vy *= k; sp = std * 0.6; }
    // 总速硬上限：杜绝挡板"叠加速度"导致球速翻倍（P0，实机复现 6 → 12.4）
    if (sp > std * 1.6) { const k = (std * 1.6) / sp; vx *= k; vy *= k; sp = std * 1.6; }
    // 最小垂直分量（同时保证最小反弹角 ≥~21°），根绝纯水平死循环
    const minVy = Math.max(std * 0.30, sp * 0.36);
    if (Math.abs(vy) < minVy) {
      const dir = vy < 0 ? -1 : (vy > 0 ? 1 : (Math.random() < 0.5 ? -1 : 1));
      vy = dir * minVy;
      const k = sp / Math.hypot(vx, vy); vx *= k; vy *= k; sp = Math.hypot(vx, vy);
    }
    // 低幅随机微扰：打散任何共振 / 墙角死锁
    const a = Math.atan2(vy, vx) + (Math.random() - 0.5) * 0.05;
    vx = Math.cos(a) * sp; vy = Math.sin(a) * sp;
    Body.setVelocity(body, { x: vx, y: vy });
  }
  function spawnBall(x, y, vx, vy, stuck) {
    const body = Bodies.circle(x, y, 8, { restitution: 1, friction: 0, frictionAir: 0, inertia: Infinity });
    body.plugin = { type: "ball" };
    Composite.add(world, body);
    const b = { body, x, y, vx, vy, stuck: !!stuck, r: 8, trail: [] };
    balls.push(b);
    return b;
  }
  function clearBalls() {
    for (const b of balls) Composite.remove(world, b.body);
    balls = [];
  }
  function clearShards() {
    for (const s of shards) Composite.remove(world, s.body);
    shards = [];
    flashes = [];
  }
  function resetBall() {
    clearBalls();
    spawnBall(paddle.x + paddle.w / 2, paddle.y - 10, 0, 0, true);
  }
  function launchBall() {
    if (state.mode !== "playing") return;
    for (const b of balls) {
      if (b.stuck) {
        Body.setStatic(b.body, false);
        const angle = -Math.PI / 2 + (Math.random() * 0.5 - 0.25);
        const sp = ballSpeed();
        Body.setVelocity(b.body, { x: Math.cos(angle) * sp, y: Math.sin(angle) * sp });
        b.stuck = false;
      }
    }
  }

  // ---------- 砖块构建 ----------
  function clearBricks() {
    const old = Composite.allBodies(world).filter((b) => b.plugin && b.plugin.type === "brick");
    for (const b of old) Composite.remove(world, b);
    bricks = [];
  }
  function layoutFor(cols) {
    const padTop = 90, padSide = 30, gap = 8, brickH = 26;
    const brickW = (LOGICAL_W - padSide * 2 - gap * (cols - 1)) / cols;
    const totalW = cols * brickW + (cols - 1) * gap;
    const startX = (LOGICAL_W - totalW) / 2;
    return { cols, padTop, padSide, gap, brickH, brickW, startX };
  }
  function addBrick(L, r, c, code) {
    const spec = brickSpec(code, r);
    const x = L.startX + c * (L.brickW + L.gap);
    const y = L.padTop + r * (L.brickH + L.gap);
    const brick = {
      x, y, w: L.brickW, h: L.brickH, gx: c, gy: r,
      color: spec.color, type: spec.type,
      breakable: spec.type !== "indestructible" && spec.type !== "boss",
      points: spec.points, alive: true, pendingBreak: false, fromChain: false,
      hp: spec.hp, maxHp: spec.hp, phaseOffset: Math.random() * 2,
    };
    if (spec.type === "regen") brick.regenLeft = spec.regenLeft;
    if (spec.type === "vortex") { brick.spin = 0; }
    if (spec.type === "coin") brick.credits = spec.credits;
    if (spec.type === "time") brick.chrono = spec.chrono;
    const body = Bodies.rectangle(x + L.brickW / 2, y + L.brickH / 2, L.brickW, L.brickH, {
      isStatic: true, restitution: 1, friction: 0,
    });
    body.plugin = { type: "brick", ref: brick };
    Composite.add(world, body);
    brick.body = body;
    bricks.push(brick);
    return brick;
  }
  function buildLevel(levelIndex) {
    clearBricks();
    const grid = LEVELS[levelIndex] || LEVELS[LEVELS.length - 1];
    const cols = Math.max.apply(null, grid.map((row) => row.length));
    const L = layoutFor(cols);
    for (let r = 0; r < grid.length; r++)
      for (let c = 0; c < grid[r].length; c++) {
        const code = grid[r][c];
        if (!code) continue;
        addBrick(L, r, c, code);
      }
  }
  function buildEndlessWave(level) {
    clearBricks();
    const cols = 13;
    const L = layoutFor(cols);
    const rows = Math.min(11, 4 + Math.floor(level / 2));
    for (let r = 0; r < rows; r++)
      for (let c = 0; c < cols; c++) {
        if (Math.random() < 0.18) continue;
        let code = 1;
        const roll = Math.random();
        if (roll < 0.10) code = 2;
        else if (roll < 0.15) code = 3;
        else if (roll < 0.19) code = 6;
        else if (roll < 0.22) code = 7;
        else if (roll < 0.25) code = 8;
        else if (roll < 0.28) code = 4;
        else if (roll < 0.31) code = 9;
        else if (roll < 0.34) code = 10;
        else if (roll < 0.37) code = 11;
        addBrick(L, r, c, code);
      }
  }
  // 日期种子（YYYYMMDD）→ 唯一每日地图
  function dailySeed() {
    const d = new Date();
    return d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate();
  }
  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function buildDailyLevel() {
    clearBricks();
    const seed = dailySeed();
    const rng = mulberry32(seed);
    const cols = 13, rows = 7;
    const L = layoutFor(cols);
    const pattern = Math.floor(rng() * 4);
    for (let r = 0; r < rows; r++)
      for (let c = 0; c < cols; c++) {
        if (rng() < 0.15) continue;
        let code = 1;
        const roll = rng();
        if (roll < 0.10) code = 2;
        else if (roll < 0.15) code = 3;
        else if (roll < 0.19) code = 6;
        else if (roll < 0.22) code = 7;
        else if (roll < 0.25) code = 8;
        else if (roll < 0.30) code = 9;
        else if (roll < 0.34) code = 10;
        else if (roll < 0.38) code = 11;
        // 4 种图案布局：菱形 / 棋盘 / 条纹 / 随机
        if (pattern === 0) { const cx = (cols - 1) / 2, cy = (rows - 1) / 2; if (Math.abs(c - cx) + Math.abs(r - cy) > 4.5) continue; }
        else if (pattern === 1) { if ((r + c) % 2 === 0 && rng() < 0.5) continue; }
        else if (pattern === 2) { if (r % 2 === 0 && rng() < 0.4) continue; }
        addBrick(L, r, c, code);
      }
  }
  function buildCustomLevel(grid) {
    clearBricks();
    const cols = Math.max.apply(null, grid.map((row) => row.length));
    const L = layoutFor(cols);
    for (let r = 0; r < grid.length; r++)
      for (let c = 0; c < (grid[r] || []).length; c++) {
        const code = grid[r][c];
        if (!code) continue;
        addBrick(L, r, c, code);
      }
  }

  // ---------- BOSS ----------
  let boss = null;
  function bossHpFor(level, mode) {
    // 本轮：下调至“中等偏易”，配合弱点核心 2 倍伤害，纯技巧即可击破
    if (mode === "bossrush") return 8 + level * 2;
    return 6 + level * 2;
  }
  function spawnBoss(level) {
    const L = layoutFor(13);
    const w = 220, h = 40;
    const x = LOGICAL_W / 2 - w / 2, y = L.padTop;
    const spec = brickSpec(5, 0);
    const b = {
      x, y, w, h, gx: 0, gy: 0, color: spec.color, type: "boss",
      breakable: true, points: spec.points, alive: true, pendingBreak: false, fromChain: false,
      hp: bossHpFor(level, state.gameMode), maxHp: bossHpFor(level, state.gameMode), phaseOffset: 0, vx: 1.4,
      coreR: 19, flashUntil: 0, phase: 1,
    };
    const body = Bodies.rectangle(x + w / 2, y + h / 2, w, h, { isStatic: true, restitution: 1, friction: 0 });
    body.plugin = { type: "brick", ref: b };
    Composite.add(world, body);
    b.body = body;
    bricks.push(b);
    boss = b;
    state.bossActive = true;
    state.bossNextShot = now + 2600;
    if (els.bossBar) els.bossBar.classList.remove("hidden");
    updateBossBar();
  }
  function updateBossBar() {
    if (!boss || !els.bossFill) return;
    els.bossFill.style.width = Math.max(0, (boss.hp / boss.maxHp) * 100) + "%";
  }
  function removeBoss() {
    if (boss && boss.body) Composite.remove(world, boss.body);
    boss = null;
    state.bossActive = false;
    if (els.bossBar) els.bossBar.classList.add("hidden");
    if (els.bossFill) els.bossFill.style.width = "0%";
  }
  function bossHitFx(brick) {
    const cx = brick.x + brick.w / 2, cy = brick.y + brick.h / 2;
    spawnFlash(cx, cy, 40, "#a78bfa");
    addShake(7, 220);
  }
  // 弱点核心：命中核心造成 2 倍伤害 + 更强反馈；半血进入“狂暴”阶段（弹幕略密、略快）
  function bossDamageAt(boss, hx, hy, base) {
    const cx = boss.x + boss.w / 2, cy = boss.y + boss.h / 2;
    const crit = Math.hypot(hx - cx, hy - cy) < boss.coreR;
    boss.hp -= crit ? base * 2 : base;
    boss.flashUntil = now + (crit ? 120 : 80);
    sfxBossHit();
    if (crit) { spawnFlash(cx, cy, 64, "#fde68a"); addShake(9, 240); hitStop(50); }
    else bossHitFx(boss);
    updateBossBar();
    if (boss.hp <= 0) { breakBrick(boss, false); return; }
    if (boss.phase === 1 && boss.hp <= boss.maxHp / 2) {
      boss.phase = 2; boss.flashUntil = now + 220;
      spawnFlash(cx, cy, 130, "#a78bfa"); addShake(8, 300); sfxBossFire();
      spawnFloat(cx, cy, "狂暴阶段！");
    }
  }
  function bossFire() {
    if (!boss) return;
    const cx = boss.x + boss.w / 2, cy = boss.y + boss.h;
    const fast = boss.phase === 2;
    // 中等偏易：更低基础弹速与成长；狂暴阶段仅轻微提速
    const speed = (2.2 + Math.min(1.3, state.level * 0.1)) * (fast ? 1.1 : 1);
    const px = paddle.x + paddle.w / 2, py = paddle.y;
    const aim = Math.atan2(py - cy, px - cx);
    const spread = 0.28;
    // 仅 3 向瞄准扇形（稀疏、可读、可躲）
    for (let i = -1; i <= 1; i++)
      bossShots.push({ x: cx, y: cy, vx: Math.cos(aim + i * spread) * speed, vy: Math.sin(aim + i * spread) * speed, r: 6 });
    // 环形弹幕仅“狂暴阶段(半血)”出现，数量收敛为 6、速度更低 —— 正常阶段零环形，保证可躲
    if (fast) {
      const n = 6, rs = speed * 0.6;
      for (let i = 0; i < n; i++) {
        const a = PI2 * i / n + (now / 1000);
        bossShots.push({ x: cx, y: cy, vx: Math.cos(a) * rs, vy: Math.sin(a) * rs, r: 5 });
      }
    }
    if (bossShots.length > 120) bossShots.splice(0, bossShots.length - 120);
    sfxBossFire();
  }
  // ---------- 霓虹协议（Roguelike 每关随机增益） ----------
  function applyModifier() {
    state.modPu = 0; state.modSpeed = 1; state.modTime = 1; state.modifierName = "";
    if (state.gameMode === "daily" || (state.gameMode === "classic" && state.level === 1)) return;
    const pool = [
      { name: "疾速协议", apply: () => { state.modSpeed = 1.25; } },
      { name: "富源协议", apply: () => { state.modPu = 0.12; } },
      { name: "双倍时协议", apply: () => { state.modTime = 1.5; } },
    ];
    const m = pool[Math.floor(Math.random() * pool.length)];
    m.apply();
    state.modifierName = m.name;
    spawnFloat(LOGICAL_W / 2, LOGICAL_H / 2 - 50, "霓虹协议 · " + m.name);
  }

  // ---------- 分数 / 连击 / 能量 ----------
  function comboMult() { return Math.min(8, 1 + Math.floor(state.combo / 3)) * state.perks.comboMul; }
  function addScore(base) {
    let pts = Math.round(base * comboMult());
    if (now < state.bonusUntil) pts *= 2;
    state.score += pts;
  }
  function breakBrick(brick, fromChain) {
    if (!brick.alive) return;
    if (brick.type === "boss") sfxBossDeath(); else sfxBreak();
    brick.alive = false;
    brick.pendingBreak = true;
    if (brick.body) Composite.remove(world, brick.body);
    addScore(brick.points);
    spawnBreak(brick.x + brick.w / 2, brick.y + brick.h / 2, brick.color);
    spawnFloat(brick.x + brick.w / 2, brick.y, "+" + Math.round(brick.points * comboMult()));
    state.energy = Math.min(100, state.energy + 2 + Math.floor(state.combo / 3));
    if (state.energy >= 100 && !energyReadyNotified) {
      energyReadyNotified = true;
      showToast("⚡ 超载就绪！按 G 释放", "combo");
      screenFlashFx("#fde68a", 0.25);
      voice({ freq: 880, slideTo: 1320, type: "sine", dur: 0.15, vol: 0.06 });
    }
    if (!fromChain) {
      state.combo++;
      state.comboExpire = now + 1600 * state.perks.comboMul * (1 + 0.15 * state.perks.comboBonus);
      if (state.combo === 5) showToast("🔥 5 连击！", "combo");
      else if (state.combo === 10) showToast("🔥 10 连击！势不可挡", "combo");
      else if (state.combo === 20) showToast("🔥 20 连击！无人能挡", "combo");
      else if (state.combo >= 30 && state.combo % 10 === 0) showToast("🔥 " + state.combo + " 连击！", "combo");
      if (state.combo >= 4) unlock("combo");
    }
    maybeDropPowerup(brick.x + brick.w / 2, brick.y + brick.h / 2);
    if (brick.type === "boss") { unlock("boss"); removeBoss(); spawnFlash(brick.x + brick.w / 2, brick.y + brick.h / 2, 160, "#a78bfa"); }
    if (brick.type === "explosive") { timeFreeze = 90; chainExplode(brick); shockwaveRing(brick.x + brick.w / 2, brick.y + brick.h / 2, brick.color); }
    if (brick.type === "vortex") unlock("vortex");
    if (brick.type === "coin") { meta.credits += brick.credits || 3; saveMeta(); spawnFloat(brick.x + brick.w / 2, brick.y - 6, "💎+" + (brick.credits || 3)); if (els.upgCredits) els.upgCredits.textContent = "霓虹币 " + meta.credits; }
    if (brick.type === "time") { state.chronoBonus += brick.chrono || 8; spawnFloat(brick.x + brick.w / 2, brick.y - 6, "⏱+" + (brick.chrono || 8)); }
    if (brick.type === "lightning") { chainLightning(brick); }
  }
  function chainLightning(brick) {
    // 闪电链：击碎同行所有可破砖块（无视距离），附带小范围冲击
    const row = brick.gy;
    let chained = 0;
    for (const other of bricks) {
      if (!other.alive || other === brick || other.type === "indestructible") continue;
      if (other.gy !== row) continue;
      breakBrick(other, true);
      chained++;
      spawnFlash(other.x + other.w / 2, other.y + other.h / 2, 28, "#bfdbfe");
    }
    if (chained > 0) { addShake(6, 180); spawnFlash(brick.x + brick.w / 2, brick.y + brick.h / 2, 60, "#93c5fd"); }
  }
  function chainExplode(brick) {
    for (const other of bricks) {
      if (!other.alive || other.type === "indestructible" || other === brick) continue;
      const dx = (other.x + other.w / 2) - (brick.x + brick.w / 2);
      const dy = (other.y + other.h / 2) - (brick.y + brick.h / 2);
      if (Math.abs(dx) <= brick.w + 14 && Math.abs(dy) <= brick.h + 14) breakBrick(other, true);
    }
  }

  // ---------- 粒子 / 飘字 / 闪光 / 碎片 ----------
  function spawnBreak(x, y, color) {
    for (let i = 0; i < 26; i++) {
      const a = Math.random() * PI2;
      const sp = 1.5 + Math.random() * 5.5;
      particles.push({ x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 1, life: 1, color, size: 2 + Math.random() * 3.5 });
    }
    spawnShards(x, y, color, 7 + Math.floor(Math.random() * 4));
    spawnFlash(x, y, 44, color);
    addShake(7, 320);
  }
  function spawnShards(x, y, color, count) {
    if (shards.length > 240) return;
    for (let i = 0; i < count; i++) {
      const w = 5 + Math.random() * 7, h = 4 + Math.random() * 6;
      const ang = Math.random() * PI2;
      const sp = 2 + Math.random() * 4;
      const body = Bodies.rectangle(x, y, w, h, {
        isStatic: false, frictionAir: 0.04, restitution: 0.4,
        collisionFilter: { category: 0x0008, mask: 0x0000 },
      });
      body.plugin = { type: "shard" };
      Body.setVelocity(body, { x: Math.cos(ang) * sp, y: Math.sin(ang) * sp - 1 });
      Body.setAngularVelocity(body, (Math.random() - 0.5) * 0.4);
      Composite.add(world, body);
      shards.push({ body, color, w, h, life: 1 });
    }
  }
  function spawnFlash(x, y, maxR, color) { flashes.push({ x, y, r: 6, maxR, life: 1, color }); }
  function spawnFloat(x, y, text) { floats.push({ x, y, text, life: 1 }); }

  const POWERUP_TYPES = {
    wide:   { color: "#22d3ee", label: "宽" },
    multi:  { color: "#a78bfa", label: "球" },
    slow:   { color: "#34d399", label: "慢" },
    star:   { color: "#fbbf24", label: "★" },
    pierce: { color: "#fb7185", label: "穿" },
    shock:  { color: "#f472b6", label: "脉" },
  };
  function maybeDropPowerup(x, y) {
    if (Math.random() > Math.min(0.6, state.perks.puChance + (state.modPu || 0))) return;
    const types = Object.keys(POWERUP_TYPES);
    const type = types[Math.floor(Math.random() * types.length)];
    powerups.push({ x, y, r: 13, vy: 2.2, type, life: 1 });
  }
  function applyPowerup(p) {
    if (p.type === "wide") { paddle.w = Math.min(LOGICAL_W * 0.62, paddle.w + 26); paddle.wideUntil = now + 12000; syncPaddleWidth(); }
    else if (p.type === "multi") {
      const src = balls.find((b) => !b.stuck) || balls[0];
      if (src) for (let i = 0; i < 2; i++)
        spawnBall(src.body.position.x, src.body.position.y, (i ? 1 : -1) * 3, -4, false);
    }
    else if (p.type === "slow") { state.slowUntil = now + 6000; }
    else if (p.type === "star") { state.bonusUntil = now + 8000; }
    else if (p.type === "pierce") { state.pierceUntil = now + 7000; }
    else if (p.type === "shock") { triggerShock(); }
  }
  function triggerShock() {
    unlock("shock");
    const cx = paddle.x + paddle.w / 2, cy = LOGICAL_H / 2;
    spawnFlash(cx, cy, 170, "#f472b6");
    addShake(10, 320); timeFreeze = 90;
    // 重平衡：半径收敛（240→150）、冻结更短（140→90ms）、BOSS 伤害降低（8→5），保留“局部清场”实用性但不破难度
    for (const b of bricks) if (b.alive && b.breakable) {
      const bx = b.x + b.w / 2, by = b.y + b.h / 2;
      if (Math.hypot(bx - cx, by - cy) < 150) breakBrick(b, false);
    }
    if (boss && boss.alive) { bossDamageAt(boss, cx, cy, 5); }
    spawnFloat(cx, cy - 30, "电磁脉冲!");
  }

  // ---------- 激光 / 终极技 ----------
  function fireLaser() {
    if (now < state.laserCd) return;
    if (!balls.some((b) => !b.stuck)) return;
    state.laserCd = now + laserCdMax();
    sfxLaser();
    const lx = paddle.x + paddle.w / 2;
    // 充能：蓄能光环 + 微抖，短暂延迟后射出厚光束
    spawnFlash(lx, paddle.y - 10, 54, "#22d3ee");
    addShake(4, 120);
    pendingLaser = { x: lx };
    laserChargeUntil = now + 150;
    for (let i = 0; i < 12; i++) {
      const a = -Math.PI / 2 + (Math.random() - 0.5) * 0.7;
      const sp = 1 + Math.random() * 3;
      particles.push({ x: lx, y: paddle.y - 6, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: 1, color: "#22d3ee", size: 2 + Math.random() * 2 });
    }
  }
  function fireUltimate() {
    if (state.mode !== "playing" || state.levelTransitioning) return;
    if (state.energy < 100) return;
    state.energy = 0;
    energyReadyNotified = false;
    // 局部“超载脉冲”：以球（或挡板）为中心的小范围清除/削血，不秒杀全场，能量门控即长冷却
    hitStop(120);
    screenFlashFx("#a855f7", 0.32);
    addShake(18, 420);
    const src = balls.find((b) => !b.stuck);
    const cx = src ? src.body.position.x : paddle.x + paddle.w / 2;
    const cy = src ? src.body.position.y : paddle.y - 20;
    spawnFlash(cx, cy, 210, "#a855f7");
    spawnFloat(cx, cy - 30, "超载脉冲!");
    sfxUltimate();
    const R = 165;
    for (const b of bricks) if (b.alive && b.type !== "indestructible") {
      const bx = b.x + b.w / 2, by = b.y + b.h / 2;
      if (Math.hypot(bx - cx, by - cy) < R) {
        if (b.type === "boss") { bossDamageAt(b, b.x + b.w / 2, b.y + b.h / 2, 6); }
        else if (b.hp <= 3) breakBrick(b, false);
        else { b.hp -= 3; spawnBreak(bx, by, b.color); }
      }
    }
  }

  // ---------- 碰撞 ----------
  Events.on(engine, "collisionStart", (ev) => {
    for (const pair of ev.pairs) {
      const a = pair.bodyA, b = pair.bodyB;
      const ballBody = a.plugin && a.plugin.type === "ball" ? a : (b.plugin && b.plugin.type === "ball" ? b : null);
      const brickBody = a.plugin && a.plugin.type === "brick" ? a : (b.plugin && b.plugin.type === "brick" ? b : null);
      const paddleBody = a.plugin && a.plugin.type === "paddle" ? a : (b.plugin && b.plugin.type === "paddle" ? b : null);
      if (ballBody && brickBody) {
        const brick = brickBody.plugin.ref;
        if (!brick || !brick.alive || brick.type === "indestructible") continue;
        if (brick.type === "phase") {
          const ghost = Math.floor((now / 900) + brick.phaseOffset) % 2 === 1;
          if (ghost) continue;
        }
        // 穿甲：直接击穿，不改变球速
        if (now < state.pierceUntil) { breakBrick(brick, false); continue; }
        if (brick.type === "boss") { bossDamageAt(brick, ballBody.position.x, ballBody.position.y, 1); continue; }
        brick.hp--;
        sfxHit();
        if (brick.hp <= 0) {
          if (brick.type === "regen" && brick.regenLeft > 0) {
            brick.regenLeft--;
            brick.alive = false;
            if (brick.body) Composite.remove(world, brick.body);
            addScore(brick.points);
            spawnBreak(brick.x + brick.w / 2, brick.y + brick.h / 2, brick.color);
            brick.regenAt = now + 2500;
          } else {
            breakBrick(brick, false);
          }
        } else { brick.pendingBreak = false; addScore(2); }
      } else if (ballBody && paddleBody) {
        // 挡板反弹：始终回到设计球速，杜绝 solver 叠加速度翻倍（P0）
        const speed = ballSpeed();
        const off = clamp((ballBody.position.x - (paddle.x + paddle.w / 2)) / (paddle.w / 2), -1, 1);
        let ang = -Math.PI / 2 + off * (Math.PI / 3);
        ang += (Math.random() - 0.5) * 0.1;
        Body.setVelocity(ballBody, { x: Math.cos(ang) * speed, y: Math.sin(ang) * speed });
        // 反弹火花 VFX
        const bx = ballBody.position.x, by = ballBody.position.y;
        for (let i = 0; i < 8; i++) {
          const a = -Math.PI / 2 + (Math.random() - 0.5) * Math.PI * 0.8;
          const sp = 2 + Math.random() * 4;
          particles.push({ x: bx, y: by, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: 0.6, color: "#5eead4", size: 1.5 + Math.random() * 2 });
        }
        voice({ freq: 520 + off * 200, slideTo: 700, type: "triangle", dur: 0.04, vol: 0.04, attack: 0.002 });
      }
    }
  });

  // ---------- 输入 ----------
  function onMove(clientX) {
    const rect = canvas.getBoundingClientRect();
    const x = (clientX - rect.left) / rect.width * LOGICAL_W;
    paddle.targetX = clamp(x - paddle.w / 2, 0, LOGICAL_W - paddle.w);
  }
  canvas.addEventListener("mousemove", (e) => { if (state.mode === "playing" || state.mode === "editor") onMove(e.clientX); });
  canvas.addEventListener("click", () => { if (state.mode === "playing") launchBall(); });
  canvas.addEventListener("touchmove", (e) => { if (e.touches[0]) { onMove(e.touches[0].clientX); e.preventDefault(); } }, { passive: false });

  const keys = {};
  window.addEventListener("keydown", (e) => {
    if (e.key === "ArrowLeft") keys.left = true;
    if (e.key === "ArrowRight") keys.right = true;
    if (e.key === " " || e.key === "Spacebar") { if (state.mode === "playing") { launchBall(); e.preventDefault(); } }
    if (e.key === "f" || e.key === "F") { if (state.mode === "playing" && !e.repeat) fireLaser(); }
    if (e.key === "g" || e.key === "G") { if (state.mode === "playing" && !e.repeat) fireUltimate(); }
    if (e.key === "p" || e.key === "P") { togglePause(); }
    if (e.key === "m" || e.key === "M") { initAudio(); toggleMute(); }
    if (e.key === "Escape") {
      if (state.mode === "playing" || state.mode === "editor") requestExit();
      else if (state.mode === "paused") {
        if (els.screenExit && !els.screenExit.classList.contains("hidden")) cancelExit();
        else { state.mode = (els.editorBar && !els.editorBar.classList.contains("hidden")) ? "editor" : "playing"; requestExit(); }
      }
    }
  });
  window.addEventListener("keyup", (e) => {
    if (e.key === "ArrowLeft") keys.left = false;
    if (e.key === "ArrowRight") keys.right = false;
  });

  // ---------- 画面抖动 / 全屏闪光 / 命中停顿 ----------
  let shakeT = 0, shakeMag = 0;
  function addShake(mag, dur) { shakeMag = Math.max(shakeMag, mag); shakeT = Math.max(shakeT, dur); }
  function hitStop(ms) { timeFreeze = Math.max(timeFreeze, ms); }
  function screenFlashFx(color, a) { screenFlashColor = color; screenFlashA = Math.max(screenFlashA, a); }
  function shockwaveRing(x, y, color) {
    spawnFlash(x, y, 90, color);
    spawnFlash(x, y, 50, "#fff");
    voice({ freq: 180, slideTo: 60, type: "sawtooth", dur: 0.3, vol: 0.07, lp: 1200 });
    addShake(10, 320);
    hitStop(80);
  }

  // ---------- 关卡流程 ----------
  function startGame(mode) {
    initAudio();
    state.gameMode = mode || "classic";
    bgmStart(state.gameMode === "daily" ? "classic" : state.gameMode);
    els.hud.classList.remove("hidden");
    state.score = 0; state.level = 1;
    state.perks = defaultPerks();
    if (state.gameMode !== "daily") applyMeta(state.perks);
    state.lives = STARTING_LIVES + state.perks.lifeBonus;
    state.energy = state.perks.energyBonus;
    startLevel();
  }
  function startLevel() {
    paddle.baseW = Math.max(90, 130 - (state.level - 1) * 12) + state.perks.wide;
    paddle.w = paddle.baseW; paddle.wideUntil = 0; syncPaddleWidth();
    paddle.x = LOGICAL_W / 2 - paddle.w / 2; paddle.targetX = paddle.x;
    createPaddleBody();
    removeBoss();
    clearBricks();
    if (state.gameMode === "endless") buildEndlessWave(state.level);
    else if (state.gameMode === "custom") buildCustomLevel(state.customGrid);
    else if (state.gameMode === "daily") buildDailyLevel();
    else if (state.gameMode === "bossrush") spawnBoss(state.level);
    else buildLevel(state.level - 1);
    if (state.gameMode !== "bossrush" &&
        ((state.gameMode === "classic" && state.level >= 5) ||
         (state.gameMode === "endless" && state.level % 5 === 0))) {
      spawnBoss(state.level);
    }
    resetBall();
    for (let i = 0; i < state.perks.extraBalls; i++)
      spawnBall(paddle.x + paddle.w / 2 + (i % 2 ? 22 : -22), paddle.y - 12, 0, 0, true);
    particles = []; floats = []; powerups = []; lasers = []; bossShots = [];
    clearShards();
    state.combo = 0; state.slowUntil = 0; state.bonusUntil = 0; state.laserCd = 0; state.pierceUntil = 0;
    state.chronoBonus = 0; state.perfect = true;
    state.levelTransitioning = false;
    applyModifier();
    state.levelStart = performance.now();
    state.mode = "playing";
    hideAllScreens();
    showReturn(true);
  }
  function levelCleared() {
    const remaining = bricks.some((b) =>
      b.type === "boss" ? b.alive : (b.type === "regen" ? b.regenLeft > 0 : b.alive && b.breakable));
    if (remaining) return;
    state.levelTransitioning = true;
    sfxClear();
    const t = Math.max(0, (performance.now() - state.levelStart) / 1000 - state.chronoBonus);
    const bonus = Math.max(0, Math.round((Math.max(8, 60 - t)) * 10 * state.perks.timeMul * (state.modTime || 1)));
    if (bonus > 0) { state.score += bonus; spawnFloat(LOGICAL_W / 2, LOGICAL_H / 2, "时间奖励 +" + bonus); }
    if (state.perfect) {
      state.score += PERFECT_BONUS;
      spawnFloat(LOGICAL_W / 2, LOGICAL_H / 2 - 30, "PERFECT 无伤！+" + PERFECT_BONUS);
      showToast("PERFECT 无伤清场 +" + PERFECT_BONUS, "perfect");
      screenFlashFx("#a3e635", 0.3);
    }
    if (state.gameMode === "endless" || state.gameMode === "bossrush") { state.level++; startLevel(); return; }
    if (state.gameMode === "daily") { winGame(); return; }
    if (state.level >= TOTAL_LEVELS) { winGame(); return; }
    showPerk();
  }
  function updateDailyBestDisplay() {
    const today = new Date().toISOString().slice(0, 10);
    const best = dailyBest[today]?.score || 0;
    const seed = dailyBest[today]?.seed;
    const desc = document.getElementById("daily-desc");
    if (desc) desc.textContent = seed ? "每日地图 #" + seed + " · 挑战高分" : "每日唯一地图 · 挑战最高分";
    const el = document.getElementById("daily-best");
    if (el) el.textContent = "每日最佳 " + best;
  }
  function winGame() {
    state.mode = "complete";
    stopAudio();
    earnCredits();
    if (state.gameMode === "daily") {
      const today = new Date().toISOString().slice(0, 10);
      const prev = (dailyBest[today] && dailyBest[today].score) || 0;
      if (state.score > prev) { dailyBest[today] = { score: state.score, seed: dailySeed() }; saveDailyBest(); }
      meta.credits += state.score > prev ? 100 : 50;
      saveMeta();
      updateDailyBestDisplay();
    }
    if (state.score > state.highScore) { state.highScore = state.score; saveHighScore(); }
    const stars = computeStars();
    if (els.completeStars) els.completeStars.textContent = "★★★☆☆☆".slice(3 - stars, 6 - stars);
    if (els.completeScore) els.completeScore.textContent = "最终分数 " + state.score;
    updateHighScoreDisplays();
    clearRun();
    showReturn(false);
    if (els.screenComplete) els.screenComplete.classList.remove("hidden");
  }
  function computeStars() {
    let s = 1;
    if (state.score > 1500) s = 2;
    if (state.score > 3500) s = 3;
    return s;
  }
  function loseLife() {
    state.lives--;
    state.combo = 0;
    state.perfect = false;
    addShake(12, 400);
    if (state.lives <= 0) { gameOver(); return; }
    resetBall();
  }
  function gameOver() {
    state.mode = "over";
    stopAudio();
    removeBoss();
    if (state.gameMode === "daily") {
      const today = new Date().toISOString().slice(0, 10);
      const prev = (dailyBest[today] && dailyBest[today].score) || 0;
      if (state.score > prev) { dailyBest[today] = { score: state.score, seed: dailySeed() }; saveDailyBest(); }
      updateDailyBestDisplay();
    }
    earnCredits();
    if (state.score > state.highScore) { state.highScore = state.score; saveHighScore(); }
    if (els.overScore) els.overScore.textContent = "最终分数 " + state.score;
    updateHighScoreDisplays();
    clearRun();
    showReturn(false);
    if (els.screenOver) els.screenOver.classList.remove("hidden");
  }
  function showPerk() {
    state.mode = "perk";
    showReturn(false);
    const pool = PERK_DEFS.slice();
    const picks = [];
    while (picks.length < 3 && pool.length) picks.push(pool.splice(Math.floor(Math.random() * pool.length), 1)[0]);
    if (els.perkTitle) els.perkTitle.textContent = "选择一项强化";
    if (els.perkSubtitle) els.perkSubtitle.textContent = "通过第 " + state.level + " 关";
    if (els.perkCards) {
      els.perkCards.innerHTML = "";
      for (const p of picks) {
        const card = document.createElement("button");
        card.type = "button"; card.className = "perk-card";
        card.innerHTML = '<div class="perk-icon">' + p.icon + '</div><div class="perk-name">' + p.name + '</div><div class="perk-desc">' + p.desc + '</div>';
        card.addEventListener("click", () => {
          p.apply(state.perks);
          state.level++;
          startLevel();
        });
        els.perkCards.appendChild(card);
      }
    }
    if (els.screenPerk) els.screenPerk.classList.remove("hidden");
  }
  function hideAllScreens() {
    [els.screenStart, els.screenOver, els.screenComplete, els.screenPerk, els.screenHelp, els.screenPause, els.screenExit, els.screenUpg]
      .filter(Boolean).forEach((s) => s.classList.add("hidden"));
  }
  function togglePause() {
    if (state.mode === "playing") { state.mode = "paused"; showReturn(false); if (els.screenPause) els.screenPause.classList.remove("hidden"); }
    else if (state.mode === "paused" && (!els.screenExit || els.screenExit.classList.contains("hidden"))) { state.mode = "playing"; showReturn(true); if (els.screenPause) els.screenPause.classList.add("hidden"); }
  }
  function goMenu() {
    stopAudio(); // 离开任何模式：彻底静音并挂起音频上下文
    state.mode = "start";
    hideAllScreens();
    if (els.editorBar) els.editorBar.classList.add("hidden");
    if (els.screenStart) els.screenStart.classList.remove("hidden");
    updateHighScoreDisplays();
    updateAchievementDisplay();
    updateDailyBestDisplay();
    refreshContinue();
    showReturn(false);
  }
  function showReturn(v) { if (els.btnReturn) els.btnReturn.classList.toggle("hidden", !v); }

  // ---------- 退出到主菜单（含保存提示） ----------
  function requestExit() {
    if (state.mode !== "playing" && state.mode !== "editor") return;
    exitContext = state.mode;
    state.mode = "paused";
    const ed = exitContext === "editor";
    if (els.exitTitle) els.exitTitle.textContent = ed ? "保存地图草稿？" : "保存当前进度？";
    if (els.exitMsg) els.exitMsg.textContent = ed
      ? "可将地图保存到本机，下次打开自动载入；也可直接退出。"
      : "可保存进度以便稍后继续；也可直接退出当前游戏。";
    if (els.btnExitSave) els.btnExitSave.textContent = ed ? "保存草稿并退出" : "保存并退出";
    if (els.screenExit) els.screenExit.classList.remove("hidden");
  }
  function cancelExit() {
    if (els.screenExit) els.screenExit.classList.add("hidden");
    state.mode = exitContext;
    if (exitContext === "editor") { if (els.editorBar) els.editorBar.classList.remove("hidden"); }
    else showReturn(true);
  }
  function doExit() {
    if (els.screenExit) els.screenExit.classList.add("hidden");
    goMenu();
  }

  // ---------- 元进度：存档续玩 ----------
  function earnCredits() {
    const c = Math.floor(state.score / 100) + (state.mode === "complete" ? 200 : 0);
    meta.credits += c; saveMeta();
  }
  function saveRun() {
    try {
      const snap = {
        v: 1, mode: state.gameMode, score: state.score, level: state.level,
        lives: state.lives, perks: state.perks, energy: state.energy, customGrid: state.customGrid,
      };
      localStorage.setItem(RUN_KEY, JSON.stringify(snap));
    } catch (e) {}
  }
  function hasRun() { try { return !!localStorage.getItem(RUN_KEY); } catch (e) { return false; } }
  function clearRun() { try { localStorage.removeItem(RUN_KEY); } catch (e) {} }
  function refreshContinue() { if (els.btnContinue) els.btnContinue.classList.toggle("hidden", !hasRun()); }
  function continueRun() {
    let snap; try { snap = JSON.parse(localStorage.getItem(RUN_KEY)); } catch (e) { return; }
    if (!snap) return;
    initAudio();
    els.hud.classList.remove("hidden");
    state.gameMode = snap.mode; state.score = snap.score; state.level = snap.level;
    state.lives = snap.lives; state.perks = snap.perks || defaultPerks(); state.energy = snap.energy || 0;
    state.customGrid = snap.customGrid || null;
    startLevel();
  }

  function updateHUD() {
    els.score.textContent = state.score;
    els.level.textContent = state.level;
    els.lives.textContent = state.lives > 0 ? "♥".repeat(state.lives) : "—";
    syncHud();
  }
  function syncHud() {
    if (els.combo) {
      if (state.combo >= 2 && state.mode === "playing") {
        els.combo.textContent = "连击 x" + comboMult();
        els.combo.classList.remove("hidden");
      } else els.combo.classList.add("hidden");
    }
    if (els.doubleEl) {
      if (state.bonusUntil > now && state.mode === "playing") {
        els.doubleEl.textContent = "★ 双倍 " + Math.ceil((state.bonusUntil - now) / 1000) + "s";
        els.doubleEl.classList.remove("hidden");
      } else els.doubleEl.classList.add("hidden");
    }
    if (els.energyFill) {
      els.energyFill.style.width = clamp(state.energy, 0, 100) + "%";
      els.energyPct.textContent = Math.floor(state.energy) + "%";
    }
    if (els.laser && els.laserTxt) {
      const ready = state.laserCd <= now;
      els.laser.classList.toggle("cooling", !ready);
      els.laserTxt.textContent = ready ? "激光 就绪" : "激光 " + (Math.max(0, state.laserCd - now) / 1000).toFixed(1) + "s";
    }
    updatePlayHint();
  }
  // 情境操作提示：待发射时提示发射；开局数秒显示控制图例；其余时间自动淡出（无遮挡）
  let lastHint = "";
  function updatePlayHint() {
    if (!els.playHint) return;
    let txt = "";
    if (state.mode === "playing") {
      const stuck = balls.some((b) => b.stuck);
      if (stuck) txt = "点击 / 空格 发射小球";
      else if (now - (state.levelStart || 0) < 4500) txt = "←→ 或鼠标移动 · F 激光 · G 超载 · P 暂停";
    }
    if (txt !== lastHint) {
      lastHint = txt;
      els.playHint.textContent = txt;
      els.playHint.classList.toggle("show", !!txt);
    }
  }

  // ---------- 地图工坊（精简：画笔 + 试玩/保存/分享/下载/导入/上传/清空） ----------
  const ED = { cols: 13, rows: 11, padTop: 90, padSide: 30, gap: 8, brickH: 26 };
  const ED_TYPES = [
    { code: 0, name: "橡皮" }, { code: 1, name: "普通" }, { code: 2, name: "硬砖" },
    { code: 3, name: "爆炸" }, { code: 4, name: "坚壁" }, { code: 6, name: "相位" },
    { code: 7, name: "引力" }, { code: 8, name: "再生" }, { code: 9, name: "金币" },
    { code: 10, name: "时间" }, { code: 11, name: "闪电" },
  ];
  const editor = { grid: null, brush: 1, hoverC: -1, hoverR: -1 };
  function newEditorGrid() { const g = []; for (let r = 0; r < ED.rows; r++) g.push(new Array(ED.cols).fill(0)); return g; }
  function editorLayout() {
    const cols = ED.cols, gap = ED.gap, padSide = ED.padSide;
    const brickW = (LOGICAL_W - padSide * 2 - gap * (cols - 1)) / cols;
    const totalW = cols * brickW + (cols - 1) * gap;
    const startX = (LOGICAL_W - totalW) / 2;
    return { cols, rows: ED.rows, brickW, brickH: ED.brickH, gap, padTop: ED.padTop, startX };
  }
  function buildEditorPalette() {
    els.editorPalette.innerHTML = "";
    for (const t of ED_TYPES) {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "palette-swatch" + (t.code === editor.brush ? " active" : "");
      b.textContent = t.name;
      b.style.setProperty("--c", t.code === 0 ? "#64748b" : brickSpec(t.code, 0).color);
      b.addEventListener("click", () => { editor.brush = t.code; buildEditorPalette(); });
      els.editorPalette.appendChild(b);
    }
  }
  function canvasToCell(e) {
    const rect = canvas.getBoundingClientRect();
    const x = (e.clientX - rect.left) / rect.width * LOGICAL_W;
    const y = (e.clientY - rect.top) / rect.height * LOGICAL_H;
    const L = editorLayout();
    const c = Math.floor((x - L.startX) / (L.brickW + L.gap));
    const r = Math.floor((y - L.padTop) / (L.brickH + L.gap));
    if (c < 0 || c >= L.cols || r < 0 || r >= L.rows) return null;
    return { c, r };
  }
  function editorPaint(e, erase) {
    const cell = canvasToCell(e); if (!cell) return;
    editor.grid[cell.r][cell.c] = erase ? 0 : editor.brush;
  }
  function editorHover(e) {
    const cell = canvasToCell(e);
    if (cell) { editor.hoverC = cell.c; editor.hoverR = cell.r; }
    else { editor.hoverC = -1; editor.hoverR = -1; }
  }
  function drawEditor() {
    const L = editorLayout();
    for (let r = 0; r < L.rows; r++)
      for (let c = 0; c < L.cols; c++) {
        const code = editor.grid[r][c];
        const x = L.startX + c * (L.brickW + L.gap);
        const y = L.padTop + r * (L.brickH + L.gap);
        if (!code) {
          ctx.fillStyle = "rgba(120,160,255,0.05)";
          ctx.fillRect(x, y, L.brickW, L.brickH);
          ctx.strokeStyle = "rgba(140,180,255,0.28)"; ctx.lineWidth = 1;
          ctx.strokeRect(x + 0.5, y + 0.5, L.brickW - 1, L.brickH - 1);
          continue;
        }
        const spec = brickSpec(code, r);
        roundRect(x, y, L.brickW, L.brickH, 6);
        const grad = ctx.createLinearGradient(x, y, x, y + L.brickH);
        grad.addColorStop(0, lighten(spec.color, 0.25));
        grad.addColorStop(1, spec.color);
        ctx.fillStyle = grad; ctx.fill();
        if (code === 6) {
          ctx.globalAlpha = 0.5; ctx.fillStyle = "#e0fbff";
          ctx.beginPath(); ctx.arc(x + L.brickW / 2, y + L.brickH / 2, 4, 0, PI2); ctx.fill();
          ctx.globalAlpha = 1;
        }
      }
    if (editor.hoverC >= 0 && editor.hoverR >= 0) {
      const x = L.startX + editor.hoverC * (L.brickW + L.gap);
      const y = L.padTop + editor.hoverR * (L.brickH + L.gap);
      ctx.strokeStyle = "rgba(255,255,255,0.9)"; ctx.lineWidth = 2;
      ctx.strokeRect(x, y, L.brickW, L.brickH);
    }
  }
  function copyText(t) {
    try { if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(t); else { els.editorCode.value = t; els.editorCode.select(); document.execCommand("copy"); } } catch (e) {}
  }
  function exportCode() {
    const obj = { v: 1, cols: ED.cols, rows: ED.rows, grid: editor.grid };
    const code = btoa(JSON.stringify(obj));
    els.editorCode.value = code; copyText(code);
    spawnFloat(LOGICAL_W / 2, LOGICAL_H / 2, "分享码已生成并复制");
  }
  function importCode() {
    const raw = (els.editorCode.value || "").trim(); if (!raw) return;
    try {
      const obj = JSON.parse(atob(raw));
      if (!obj.grid || !Array.isArray(obj.grid)) throw new Error("bad");
      editor.grid = normalizeGrid(obj.grid);
    } catch (e) { alert("分享码无效，请检查后重试"); }
  }
  function normalizeGrid(grid) {
    const g = [];
    for (let r = 0; r < ED.rows; r++) {
      const row = grid[r] || []; const nr = [];
      for (let c = 0; c < ED.cols; c++) nr.push(Number(row[c]) || 0);
      g.push(nr);
    }
    return g;
  }
  function downloadCode() {
    const obj = { v: 1, cols: ED.cols, rows: ED.rows, grid: editor.grid };
    const code = btoa(JSON.stringify(obj));
    const blob = new Blob([code], { type: "text/plain" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob); a.download = "neon-breakout-map.txt"; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }
  function saveMapLocal() {
    try {
      localStorage.setItem(MAP_KEY, JSON.stringify({ v: 1, cols: ED.cols, rows: ED.rows, grid: editor.grid }));
      spawnFloat(LOGICAL_W / 2, LOGICAL_H / 2, "已保存到本机");
    } catch (e) { spawnFloat(LOGICAL_W / 2, LOGICAL_H / 2, "保存失败"); }
  }
  function loadMapLocal() {
    try {
      const raw = localStorage.getItem(MAP_KEY); if (!raw) return false;
      const obj = JSON.parse(raw); if (!obj.grid || !Array.isArray(obj.grid)) return false;
      editor.grid = normalizeGrid(obj.grid); return true;
    } catch (e) { return false; }
  }
  function uploadCode(file) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => { els.editorCode.value = String(reader.result || "").trim(); importCode(); };
    reader.readAsText(file);
  }
  function openEditor() {
    state.mode = "editor";
    hideAllScreens();
    els.hud.classList.add("hidden");
    if (!editor.grid) { if (!loadMapLocal()) editor.grid = newEditorGrid(); }
    if (els.editorBar) els.editorBar.classList.remove("hidden");
    buildEditorPalette();
    showReturn(true);
  }
  function playEditorMap() {
    state.customGrid = editor.grid.map((row) => row.slice());
    if (els.editorBar) els.editorBar.classList.add("hidden");
    startGame("custom");
  }

  // ---------- 绘制 ----------
  function roundRect(x, y, w, h, r) {
    r = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }
  function lighten(hex, amt) {
    const n = parseInt(hex.slice(1), 16);
    let r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
    r = Math.min(255, Math.round(r + (255 - r) * amt));
    g = Math.min(255, Math.round(g + (255 - g) * amt));
    b = Math.min(255, Math.round(b + (255 - b) * amt));
    return "rgb(" + r + "," + g + "," + b + ")";
  }
  function starfield() {
    ctx.fillStyle = "rgba(255,255,255,0.5)";
    for (let i = 0; i < 60; i++) {
      const x = (i * 137.5) % LOGICAL_W;
      const y = (i * 89.3) % LOGICAL_H;
      ctx.fillRect(x, y, 1.5, 1.5);
    }
  }
  function drawBrick(b) {
    if (!b.alive) return;
    let alpha = 1;
    if (b.type === "phase") {
      const ghost = Math.floor((now / 900) + b.phaseOffset) % 2 === 1;
      if (ghost) alpha = 0.32;
      if (b.body) b.body.isSensor = ghost;
    }
    ctx.globalAlpha = alpha;
    roundRect(b.x, b.y, b.w, b.h, 6);
    ctx.shadowBlur = 10; ctx.shadowColor = b.color;
    const grad = ctx.createLinearGradient(b.x, b.y, b.x, b.y + b.h);
    grad.addColorStop(0, lighten(b.color, 0.25));
    grad.addColorStop(1, b.color);
    ctx.fillStyle = grad; ctx.fill();
    ctx.shadowBlur = 0;
    if (b.type === "hard" && b.hp < b.maxHp) {
      ctx.globalAlpha = alpha * 0.5; ctx.fillStyle = "#000";
      ctx.fillRect(b.x, b.y + b.h - 4, b.w * (1 - b.hp / b.maxHp), 3);
    }
    if (b.type === "boss") {
      const cx = b.x + b.w / 2, cy = b.y + b.h / 2;
      const flashing = now < (b.flashUntil || 0);
      // 弱点核心：脉冲辉光，命中瞬间变亮放大 —— 明显的可瞄准弱点
      const pulse = 0.7 + 0.3 * Math.sin(now / 380);
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.shadowBlur = (flashing ? 26 : 18) * pulse; ctx.shadowColor = "#fde68a";
      ctx.fillStyle = flashing ? "#ffffff" : "#fde68a";
      ctx.beginPath();
      ctx.arc(cx, cy, (b.coreR || 16) * (flashing ? 1.15 : 0.85 + 0.15 * pulse), 0, PI2);
      ctx.fill();
      ctx.restore();
      if (flashing) { ctx.globalAlpha = 0.45 * alpha; ctx.fillStyle = "#fff"; ctx.fillRect(b.x, b.y, b.w, b.h); ctx.globalAlpha = 1; }
      ctx.globalAlpha = 1; ctx.fillStyle = "#fff";
      ctx.font = "bold 13px system-ui, sans-serif"; ctx.textAlign = "center";
      ctx.fillText(b.phase === 2 ? "BOSS · 狂暴" : "BOSS", cx, b.y + b.h - 6);
    }
    if (b.type === "vortex") {
      const cx = b.x + b.w / 2, cy = b.y + b.h / 2;
      b.spin = (b.spin || 0) + 0.05;
      ctx.save(); ctx.translate(cx, cy); ctx.rotate(b.spin);
      ctx.strokeStyle = "#fff"; ctx.lineWidth = 2; ctx.globalAlpha = alpha * 0.9;
      for (let k = 0; k < 3; k++) { ctx.rotate(PI2 / 3); ctx.beginPath(); ctx.arc(0, 0, b.w * 0.3, 0, Math.PI * 1.2); ctx.stroke(); }
      ctx.restore(); ctx.globalAlpha = 1;
    }
    if (b.type === "regen") {
      ctx.globalAlpha = alpha; ctx.fillStyle = "#fff"; ctx.font = "bold 11px system-ui"; ctx.textAlign = "center";
      ctx.fillText("↻" + (b.regenLeft > 0 ? b.regenLeft : ""), b.x + b.w / 2, b.y + b.h / 2 + 4);
    }
    if (b.type === "coin") {
      const cx = b.x + b.w / 2, cy = b.y + b.h / 2;
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.shadowBlur = 14; ctx.shadowColor = "#fbbf24";
      ctx.fillStyle = "#fbbf24";
      ctx.beginPath(); ctx.arc(cx, cy, b.w * 0.32, 0, PI2); ctx.fill();
      ctx.shadowBlur = 0; ctx.fillStyle = "#92400e"; ctx.font = "bold 12px system-ui"; ctx.textAlign = "center";
      ctx.fillText("💎", cx, cy + 4);
      ctx.restore();
    }
    if (b.type === "time") {
      const cx = b.x + b.w / 2, cy = b.y + b.h / 2;
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.shadowBlur = 12; ctx.shadowColor = "#22d3ee";
      ctx.strokeStyle = "#22d3ee"; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(cx, cy, b.w * 0.3, 0, PI2); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(cx, cy - b.w * 0.22);
      ctx.moveTo(cx, cy); ctx.lineTo(cx + b.w * 0.15, cy); ctx.stroke();
      ctx.restore();
    }
    if (b.type === "lightning") {
      const cx = b.x + b.w / 2, cy = b.y + b.h / 2;
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.shadowBlur = 14; ctx.shadowColor = "#60a5fa";
      ctx.strokeStyle = "#bfdbfe"; ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.moveTo(cx - 4, cy - b.h * 0.32);
      ctx.lineTo(cx + 1, cy - 4);
      ctx.lineTo(cx - 2, cy + 2);
      ctx.lineTo(cx + 4, cy + b.h * 0.32);
      ctx.stroke();
      ctx.restore();
    }
    ctx.globalAlpha = 1;
  }
  function drawPaddle() {
    if (state.mode === "editor") return;
    const pg = ctx.createLinearGradient(paddle.x, paddle.y, paddle.x, paddle.y + paddle.h);
    pg.addColorStop(0, "#5eead4"); pg.addColorStop(1, "#22d3ee");
    ctx.save();
    ctx.shadowBlur = 16; ctx.shadowColor = "#22d3ee";
    ctx.fillStyle = pg;
    roundRect(paddle.x, paddle.y, paddle.w, paddle.h, 8); ctx.fill();
    ctx.restore();
    ctx.globalAlpha = 0.35; ctx.fillStyle = "#fff";
    roundRect(paddle.x + 4, paddle.y + 3, paddle.w - 8, 4, 3); ctx.fill();
    ctx.globalAlpha = 1;
  }
  function drawBall(b) {
    const p = b.body.position;
    if (!b.stuck) {
      b.trail.push({ x: p.x, y: p.y });
      if (b.trail.length > 12) b.trail.shift();
    }
    for (let i = 0; i < b.trail.length; i++) {
      const t = b.trail[i]; const a = (i / b.trail.length) * 0.5;
      ctx.globalAlpha = a; ctx.fillStyle = now < state.pierceUntil ? "#fb7185" : "#22d3ee";
      ctx.beginPath(); ctx.arc(t.x, t.y, b.r * (0.4 + 0.6 * i / b.trail.length), 0, PI2); ctx.fill();
    }
    ctx.globalAlpha = 1;
    ctx.save();
    ctx.shadowBlur = 14; ctx.shadowColor = now < state.pierceUntil ? "#fb7185" : "#22d3ee";
    const g = ctx.createRadialGradient(p.x, p.y, 1, p.x, p.y, b.r + 4);
    g.addColorStop(0, "#fff"); g.addColorStop(1, now < state.pierceUntil ? "#fb7185" : "#22d3ee");
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(p.x, p.y, b.r, 0, PI2); ctx.fill();
    ctx.restore();
  }
  function drawStar(cx, cy, outer, inner, points) {
    ctx.beginPath();
    for (let i = 0; i < points * 2; i++) {
      const rad = (i % 2) ? inner : outer;
      const a = -Math.PI / 2 + i * Math.PI / points;
      const x = cx + Math.cos(a) * rad, y = cy + Math.sin(a) * rad;
      if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y);
    }
    ctx.closePath();
  }
  // 统一霓虹图标集（替代中文文字标签，避免遮挡、提升可读性）
  function drawPowerupIcon(type, x, y, r, color) {
    ctx.save();
    ctx.translate(x, y);
    ctx.strokeStyle = "#fff"; ctx.fillStyle = "#fff"; ctx.lineWidth = 2; ctx.lineJoin = "round"; ctx.lineCap = "round";
    ctx.shadowBlur = 8; ctx.shadowColor = color;
    const s = r * 0.68;
    if (type === "wide") {                 // 宽：左右双向箭头
      ctx.beginPath();
      ctx.moveTo(-s, 0); ctx.lineTo(-s * 0.3, -s * 0.5); ctx.moveTo(-s, 0); ctx.lineTo(-s * 0.3, s * 0.5);
      ctx.moveTo(s, 0); ctx.lineTo(s * 0.3, -s * 0.5); ctx.moveTo(s, 0); ctx.lineTo(s * 0.3, s * 0.5);
      ctx.moveTo(-s * 0.3, 0); ctx.lineTo(s * 0.3, 0); ctx.stroke();
    } else if (type === "multi") {         // 多球：三个小圆
      for (const o of [[-s * 0.5, 0], [s * 0.5, 0], [0, -s * 0.5]]) { ctx.beginPath(); ctx.arc(o[0], o[1], s * 0.3, 0, PI2); ctx.stroke(); }
    } else if (type === "slow") {          // 慢：时钟
      ctx.beginPath(); ctx.arc(0, 0, s * 0.72, 0, PI2); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(0, -s * 0.5); ctx.moveTo(0, 0); ctx.lineTo(s * 0.4, s * 0.12); ctx.stroke();
    } else if (type === "star") {          // 双倍分：星形
      drawStar(0, 0, s * 0.85, s * 0.36, 5); ctx.fill();
    } else if (type === "pierce") {        // 穿透：箭头
      ctx.beginPath(); ctx.moveTo(-s, s * 0.2); ctx.lineTo(s, -s * 0.2); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(s, -s * 0.2); ctx.lineTo(s * 0.4, -s * 0.2); ctx.moveTo(s, -s * 0.2); ctx.lineTo(s * 0.6, s * 0.2); ctx.stroke();
    } else if (type === "shock") {         // 电磁脉冲：闪电
      ctx.beginPath();
      ctx.moveTo(s * 0.2, -s * 0.7); ctx.lineTo(-s * 0.32, s * 0.08); ctx.lineTo(s * 0.04, s * 0.08);
      ctx.lineTo(-s * 0.2, s * 0.72); ctx.lineTo(s * 0.34, -s * 0.12); ctx.lineTo(0, -s * 0.12); ctx.closePath();
      ctx.fill();
    } else {
      ctx.beginPath(); ctx.arc(0, 0, s * 0.6, 0, PI2); ctx.stroke();
    }
    ctx.restore();
  }
  function drawPowerup(p) {
    const info = POWERUP_TYPES[p.type];
    ctx.save();
    ctx.shadowBlur = 14; ctx.shadowColor = info.color;
    const g = ctx.createRadialGradient(p.x, p.y, 2, p.x, p.y, p.r);
    g.addColorStop(0, lighten(info.color, 0.4)); g.addColorStop(1, info.color);
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, PI2); ctx.fill();
    ctx.restore();
    ctx.lineWidth = 2; ctx.strokeStyle = "rgba(255,255,255,0.85)";
    ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, PI2); ctx.stroke();
    drawPowerupIcon(p.type, p.x, p.y, p.r, info.color);
  }
  function drawShards() {
    for (const s of shards) {
      const p = s.body.position; const a = Math.max(0, s.life);
      ctx.save();
      ctx.globalAlpha = a; ctx.translate(p.x, p.y); ctx.rotate(s.body.angle);
      ctx.shadowBlur = 12; ctx.shadowColor = s.color;
      ctx.fillStyle = s.color;
      ctx.fillRect(-s.w / 2, -s.h / 2, s.w, s.h);
      ctx.restore();
    }
    ctx.shadowBlur = 0; ctx.globalAlpha = 1;
  }
  function drawFlashes() {
    for (const f of flashes) {
      ctx.save();
      ctx.globalAlpha = Math.max(0, f.life);
      ctx.strokeStyle = f.color; ctx.lineWidth = 3;
      ctx.shadowBlur = 16; ctx.shadowColor = f.color;
      ctx.beginPath(); ctx.arc(f.x, f.y, f.r, 0, PI2); ctx.stroke();
      ctx.restore();
    }
    ctx.shadowBlur = 0; ctx.globalAlpha = 1;
  }
  function draw() {
    ctx.clearRect(0, 0, LOGICAL_W, LOGICAL_H);
    ctx.save();
    if (shakeT > 0) {
      const m = shakeMag * (shakeT / 400);
      ctx.translate((Math.random() - 0.5) * m, (Math.random() - 0.5) * m);
    }
    starfield();

    if (state.mode === "editor") {
      drawEditor();
    } else {
      for (const b of bricks) if (b.alive) drawBrick(b);
      drawShards();
      for (const p of powerups) drawPowerup(p);
      for (const b of balls) if (!b.stuck) drawBall(b); else { const p = b.body.position; ctx.fillStyle = "#bff"; ctx.beginPath(); ctx.arc(p.x, p.y, b.r, 0, PI2); ctx.fill(); }
      drawPaddle();
      // 充能光环（激光发射前的蓄能）
      if (pendingLaser) {
        const t = clamp((now - (laserChargeUntil - 150)) / 150, 0, 1);
        ctx.save(); ctx.globalAlpha = 0.5 + 0.5 * t; ctx.shadowBlur = 22; ctx.shadowColor = "#22d3ee";
        ctx.strokeStyle = "#bff7ff"; ctx.lineWidth = 3;
        ctx.beginPath(); ctx.arc(pendingLaser.x, paddle.y - 10, 6 + t * 24, 0, PI2); ctx.stroke();
        ctx.restore();
      }
      // 厚光束（从挡板到命中点，带辉光核心）
      for (const L of lasers) {
        ctx.save();
        ctx.shadowBlur = 26; ctx.shadowColor = "#22d3ee";
        const grd = ctx.createLinearGradient(L.x, L.y, L.x, paddle.y);
        grd.addColorStop(0, "rgba(190,255,255,0.95)");
        grd.addColorStop(1, "rgba(34,211,238,0.18)");
        ctx.strokeStyle = grd; ctx.lineWidth = L.w || 14; ctx.lineCap = "round";
        ctx.beginPath(); ctx.moveTo(L.x, L.y); ctx.lineTo(L.x, paddle.y); ctx.stroke();
        ctx.strokeStyle = "rgba(255,255,255,0.95)"; ctx.lineWidth = (L.w || 14) * 0.4; ctx.shadowBlur = 10;
        ctx.beginPath(); ctx.moveTo(L.x, L.y); ctx.lineTo(L.x, paddle.y); ctx.stroke();
        ctx.restore();
      }
      for (const s of bossShots) {
        ctx.save(); ctx.shadowBlur = 12; ctx.shadowColor = "#f472b6";
        ctx.fillStyle = "#f472b6"; ctx.beginPath(); ctx.arc(s.x, s.y, s.r || 6, 0, PI2); ctx.fill();
        ctx.restore();
      }
      for (const p of particles) {
        ctx.globalAlpha = Math.max(0, p.life);
        ctx.fillStyle = p.color; ctx.fillRect(p.x, p.y, p.size, p.size);
      }
      ctx.globalAlpha = 1;
      drawFlashes();
      ctx.textAlign = "center"; ctx.font = "bold 18px system-ui, sans-serif";
      for (const f of floats) { ctx.globalAlpha = Math.max(0, f.life); ctx.fillStyle = "#fff"; ctx.fillText(f.text, f.x, f.y); }
      ctx.globalAlpha = 1;
      if (state.mode === "playing" && balls.every((b) => b.stuck)) {
        ctx.fillStyle = "rgba(34,211,238,0.7)"; ctx.font = "15px system-ui, sans-serif"; ctx.textAlign = "center";
        ctx.fillText("点击 / 空格 发射小球", LOGICAL_W / 2, paddle.y - 30);
      } else if (state.mode === "playing" && balls.some((b) => !b.stuck)) {
        ctx.fillStyle = "rgba(34,211,238,0.6)"; ctx.font = "14px system-ui, sans-serif"; ctx.textAlign = "center";
        ctx.fillText("F 发射激光 · G 超载", LOGICAL_W / 2, paddle.y - 26);
      }
    }
    ctx.restore();
    // 全屏闪光（电影感）
    if (screenFlashA > 0.001) {
      ctx.save(); ctx.globalAlpha = screenFlashA; ctx.fillStyle = screenFlashColor;
      ctx.fillRect(0, 0, LOGICAL_W, LOGICAL_H); ctx.restore();
    }
    syncHud();
  }

  // ---------- 更新 ----------
  function update(dt) {
    const speed = 14;
    if (keys.left) paddle.targetX -= speed;
    if (keys.right) paddle.targetX += speed;
    if (paddle.wideUntil && now > paddle.wideUntil) { paddle.w = paddle.baseW; paddle.wideUntil = 0; syncPaddleWidth(); }
    paddle.targetX = clamp(paddle.targetX, 0, LOGICAL_W - paddle.w);
    paddle.x += (paddle.targetX - paddle.x) * 0.4;
    syncPaddleWidth();
    if (paddle.body) {
      Body.setPosition(paddle.body, { x: paddle.x + paddle.w / 2, y: paddle.y + paddle.h / 2 });
      Body.setVelocity(paddle.body, { x: 0, y: 0 });
    }
    // 危险区警示：球接近底部时闪烁红光
    const dangerEl = document.getElementById("danger-zone");
    if (dangerEl) {
      let danger = false;
      for (const b of balls) {
        if (!b.stuck && b.body.position.y > LOGICAL_H - 120) { danger = true; break; }
      }
      dangerEl.classList.toggle("active", danger);
    }
    // 低生命心跳：1 命时触发心跳音 + 暗红 vignette
    if (state.lives === 1 && state.mode === "playing") {
      if (now - heartbeatAt > 800) {
        heartbeatAt = now;
        voice({ freq: 80, type: "sine", dur: 0.18, vol: 0.06, attack: 0.01 });
        voice({ freq: 60, type: "sine", dur: 0.25, vol: 0.05, attack: 0.06 });
      }
    }

    const slow = now < state.slowUntil ? SLOW_FACTOR : 1;

    for (const b of bricks) if (b.type === "phase" && b.alive) {
      const ghost = Math.floor((now / 900) + b.phaseOffset) % 2 === 1;
      if (b.body) b.body.isSensor = ghost;
    }
    // 引力井：吸引小球
    for (const b of bricks) if (b.type === "vortex" && b.alive) {
      const cx = b.x + b.w / 2, cy = b.y + b.h / 2;
      for (const ball of balls) {
        if (ball.stuck) continue;
        const v = ball.body.velocity;
        const dx = cx - ball.body.position.x, dy = cy - ball.body.position.y;
        const d = Math.hypot(dx, dy) || 1;
        const f = Math.min(0.5, 60 / d);
        Body.setVelocity(ball.body, { x: v.x + dx / d * f, y: v.y + dy / d * f });
      }
    }

    for (let i = balls.length - 1; i >= 0; i--) {
      const b = balls[i];
      if (b.stuck) {
        // A2：stuck 球不继承残余速度（否则 Matter 会把历史速度累加进下一次发射）
        Body.setVelocity(b.body, { x: 0, y: 0 });
        Body.setPosition(b.body, { x: paddle.x + paddle.w / 2, y: paddle.y - 10 });
        continue;
      }
      clampBallVelocity(b.body);
      const p = b.body.position;
      // A1 兜底：无论速度怎么变，小球都必须留在世界里（防穿墙/出界）
      const cx = clamp(p.x, b.r, LOGICAL_W - b.r);
      const cy = clamp(p.y, b.r, LOGICAL_H + 30);
      if (cx !== p.x || cy !== p.y) Body.setPosition(b.body, { x: cx, y: cy });
      if (!isFinite(p.x) || !isFinite(p.y) || p.y > LOGICAL_H + 30) { Composite.remove(world, b.body); balls.splice(i, 1); }
    }
    if (state.mode === "playing" && balls.length === 0 && !state.levelTransitioning) { loseLife(); }

    // 激光充能 → 射出厚光束
    if (pendingLaser && now >= laserChargeUntil) {
      lasers.push({ x: pendingLaser.x, y: paddle.y - 8, vy: -16, w: 16 });
      pendingLaser = null;
      screenFlashFx("#bff7ff", 0.22);
      addShake(10, 220); hitStop(70);
    }
    for (let i = lasers.length - 1; i >= 0; i--) {
      const L = lasers[i]; L.y += L.vy * slow;
      let hit = false;
      for (const br of bricks) {
        if (!br.alive || br.type === "indestructible") continue;
        if (L.x > br.x && L.x < br.x + br.w && L.y < br.y + br.h && L.y > br.y) {
          if (br.type === "boss") { bossDamageAt(br, L.x, L.y, 1); hit = true; break; }
          br.hp--;
          sfxHit();
          if (br.hp <= 0) breakBrick(br, false);
          hit = true; break;
        }
      }
      if (hit) {
        screenFlashFx("#bff7ff", 0.28); addShake(8, 200); hitStop(60);
        lasers.splice(i, 1); state.laserKills++; continue;
      }
      if (L.y < -30) lasers.splice(i, 1);
    }
    if (state.laserKills >= 10) unlock("laser");

    for (let i = powerups.length - 1; i >= 0; i--) {
      const p = powerups[i]; p.y += p.vy * slow;
      if (p.y > LOGICAL_H + 20) { powerups.splice(i, 1); continue; }
      if (p.y + p.r > paddle.y && p.y - p.r < paddle.y + paddle.h && p.x > paddle.x && p.x < paddle.x + paddle.w) {
        applyPowerup(p); powerups.splice(i, 1);
        spawnFloat(p.x, p.y, POWERUP_TYPES[p.type].label);
        sfxPower();
      }
    }

    if (boss && boss.alive) {
      boss.x += boss.vx;
      if (boss.x < 0 || boss.x + boss.w > LOGICAL_W) { boss.vx *= -1; boss.x = clamp(boss.x, 0, LOGICAL_W - boss.w); }
      if (boss.body) Body.setPosition(boss.body, { x: boss.x + boss.w / 2, y: boss.y + boss.h / 2 });
      if (now > state.bossNextShot) {
        bossFire();
        state.bossNextShot = now + Math.max(1500, 2800 - state.level * 90);
      }
    }
    for (let i = bossShots.length - 1; i >= 0; i--) {
      const s = bossShots[i]; s.x += s.vx * slow; s.y += s.vy * slow;
      if (s.y > LOGICAL_H + 14 || s.x < -14 || s.x > LOGICAL_W + 14) { bossShots.splice(i, 1); continue; }
      if (s.y + s.r > paddle.y && s.y - s.r < paddle.y + paddle.h && s.x > paddle.x && s.x < paddle.x + paddle.w) {
        bossShots.splice(i, 1); if (state.mode === "playing") loseLife();
      }
    }

    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i]; p.x += p.vx; p.y += p.vy; p.vy += 0.12; p.life -= 0.03;
      if (p.life <= 0) particles.splice(i, 1);
    }
    for (let i = floats.length - 1; i >= 0; i--) { floats[i].y -= 0.6; floats[i].life -= 0.02; if (floats[i].life <= 0) floats.splice(i, 1); }
    for (let i = flashes.length - 1; i >= 0; i--) { const f = flashes[i]; f.r += (f.maxR - f.r) * 0.2; f.life -= 0.04; if (f.life <= 0) flashes.splice(i, 1); }
    for (let i = shards.length - 1; i >= 0; i--) { shards[i].life -= 0.025; if (shards[i].life <= 0) { Composite.remove(world, shards[i].body); shards.splice(i, 1); } }

    // 再生砖：到时复活
    for (const b of bricks) if (b.type === "regen" && !b.alive && b.regenLeft > 0 && now > b.regenAt) {
      b.alive = true; b.hp = b.maxHp;
      const body = Bodies.rectangle(b.x + b.w / 2, b.y + b.h / 2, b.w, b.h, { isStatic: true, restitution: 1, friction: 0 });
      body.plugin = { type: "brick", ref: b };
      Composite.add(world, body); b.body = body;
      spawnFlash(b.x + b.w / 2, b.y + b.h / 2, 22, b.color);
    }

    if (shakeT > 0) shakeT -= dt;
    if (screenFlashA > 0) screenFlashA = Math.max(0, screenFlashA - dt * 0.006);

    if (state.mode === "playing" && !state.levelTransitioning) levelCleared();
    updateHUD();
  }

  function cleanupBricks() {
    for (let i = bricks.length - 1; i >= 0; i--) {
      const b = bricks[i];
      if (!b.alive && !(b.type === "regen" && b.regenLeft > 0)) bricks.splice(i, 1);
    }
  }

  // ---------- 主循环 ----------
  let last = performance.now();
  function loop() {
    now = performance.now();
    const dt = Math.min(40, now - last); last = now;
    bgmTick();
    if (state.mode === "playing" || state.mode === "editor") {
      const frozen = timeFreeze > 0;
      const scale = frozen ? 0.18 : 1;
      // 慢速道具：直接缩放物理步进，让小球真正变慢（原先只对激光/道具生效，球速不变）
      const slow = (state.mode === "playing" && now < state.slowUntil) ? SLOW_FACTOR : 1;
      Engine.update(engine, dt * scale * slow);
      update(dt * scale);
      cleanupBricks();
      if (frozen) timeFreeze -= dt;
    }
    draw();
    updatePlayHint();
    requestAnimationFrame(loop);
  }

  // ---------- 自适应缩放 ----------
  function resize() {
    const dpr = window.devicePixelRatio || 1;
    const margin = 24;
    const availW = window.innerWidth - margin;
    const availH = window.innerHeight - margin;
    const scale = Math.min(availW / LOGICAL_W, availH / LOGICAL_H);
    canvas.style.width = LOGICAL_W * scale + "px";
    canvas.style.height = LOGICAL_H * scale + "px";
    canvas.width = Math.round(LOGICAL_W * dpr);
    canvas.height = Math.round(LOGICAL_H * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  window.addEventListener("resize", resize);

  // ---------- 音效（WebAudio 合成，无外部文件，电影级质感） ----------
  let audioCtx = null, masterGain = null, reverbGain = null, muted = false, audioActive = false;
  try { muted = localStorage.getItem(MUTE_KEY) === "1"; } catch (e) {}
  function makeImpulse(dur, decay) {
    const n = Math.floor(audioCtx.sampleRate * dur);
    const buf = audioCtx.createBuffer(2, n, audioCtx.sampleRate);
    for (let c = 0; c < 2; c++) {
      const d = buf.getChannelData(c);
      for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / n, decay);
    }
    return buf;
  }
  function initAudio() {
    try {
      if (!audioCtx) {
        audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        const comp = audioCtx.createDynamicsCompressor();
        comp.threshold.value = -14; comp.knee.value = 22; comp.ratio.value = 4; comp.attack.value = 0.003; comp.release.value = 0.2;
        masterGain = audioCtx.createGain(); masterGain.gain.value = muted ? 0 : 0.8;
        // 霓虹空间感：程序化混响
        const conv = audioCtx.createConvolver(); conv.buffer = makeImpulse(1.5, 3.0);
        reverbGain = audioCtx.createGain(); reverbGain.gain.value = 0.2;
        conv.connect(reverbGain); reverbGain.connect(masterGain);
        masterGain.connect(comp); comp.connect(audioCtx.destination);
        audioCtx._reverb = conv;
      }
      if (audioCtx.state === "suspended") audioCtx.resume();
      audioActive = true;
      // 离开模式后可能已静音/挂起，恢复时把主增益拉回正常
      try { masterGain.gain.cancelScheduledValues(audioCtx.currentTime); masterGain.gain.linearRampToValueAtTime(muted ? 0.0001 : 0.8, audioCtx.currentTime + 0.08); } catch (e) {}
    } catch (e) {}
  }
  // 完全停止音频：先快速淡出，再挂起上下文，并停止后续所有声部（防止离开 BOSS 后仍漏声）
  function stopAudio() {
    if (!audioCtx) return;
    audioActive = false;
    bgmStop(); // 结束 BGM 调度（声部由 voice() 的 audioActive 门控自然收尾）
    try {
      const t = audioCtx.currentTime;
      masterGain.gain.cancelScheduledValues(t);
      masterGain.gain.setValueAtTime(masterGain.gain.value, t);
      masterGain.gain.linearRampToValueAtTime(0.0001, t + 0.1);
    } catch (e) {}
    setTimeout(() => { try { if (audioActive && audioCtx && audioCtx.state === "running") audioCtx.suspend(); } catch (e) {} }, 130);
  }
  // 单振荡器声部（带音高包络/滤波/混响送出）
  function voice(o) {
    if (!audioCtx || muted || !audioActive) return;
    const t0 = audioCtx.currentTime, dur = o.dur || 0.2;
    const osc = audioCtx.createOscillator();
    osc.type = o.type || "triangle";
    osc.frequency.setValueAtTime(o.freq, t0);
    if (o.slideTo) osc.frequency.exponentialRampToValueAtTime(Math.max(1, o.slideTo), t0 + dur);
    if (o.detune) osc.detune.value = o.detune;
    const g = audioCtx.createGain();
    const vol = o.vol || 0.1, atk = o.attack || 0.005;
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(vol, t0 + atk);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    let node = osc;
    if (o.lp || o.hp) {
      const f = audioCtx.createBiquadFilter(); f.type = o.lp ? "lowpass" : "highpass";
      f.frequency.value = o.lp || o.hp; osc.connect(f); node = f;
    }
    node.connect(g); g.connect(masterGain);
    if (audioCtx._reverb) g.connect(audioCtx._reverb);
    osc.start(t0); osc.stop(t0 + dur + 0.04);
  }
  // 噪声声部（带包络/滤波/混响送出）
  function noiseVoice(o) {
    if (!audioCtx || muted || !audioActive) return;
    const t0 = audioCtx.currentTime, dur = o.dur || 0.2;
    const n = Math.floor(audioCtx.sampleRate * dur);
    const buf = audioCtx.createBuffer(1, n, audioCtx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / n, o.decay || 1);
    const src = audioCtx.createBufferSource(); src.buffer = buf;
    const g = audioCtx.createGain(); g.gain.value = o.vol || 0.08;
    let node = src;
    if (o.lp || o.hp) {
      const f = audioCtx.createBiquadFilter(); f.type = o.lp ? "lowpass" : "highpass";
      f.frequency.value = o.lp || o.hp; src.connect(f); node = f;
    }
    node.connect(g); g.connect(masterGain);
    if (audioCtx._reverb) g.connect(audioCtx._reverb);
    src.start(t0);
  }
  // 五声音阶，保证悦耳不刺耳
  const NT = { C5: 523.25, E5: 659.25, G5: 783.99, A5: 880.0, B5: 987.77, C6: 1046.5, D6: 1174.66, E6: 1318.51 };
  function sfxHit() {
    voice({ freq: 880, slideTo: 1320, type: "triangle", dur: 0.07, vol: 0.05, attack: 0.003 });
    voice({ freq: 1320, type: "sine", dur: 0.05, vol: 0.028 });
    noiseVoice({ dur: 0.035, vol: 0.025, hp: 2600 });
  }
  function sfxBreak() {
    noiseVoice({ dur: 0.18, vol: 0.085, hp: 700, decay: 2.2 });
    voice({ freq: 320, slideTo: 130, type: "sawtooth", dur: 0.16, vol: 0.055, lp: 1500 });
    voice({ freq: NT.C6, type: "triangle", dur: 0.12, vol: 0.038 });
  }
  function sfxClear() {
    [NT.C5, NT.E5, NT.G5, NT.C6].forEach((f, i) => setTimeout(() => voice({ freq: f, type: "triangle", dur: 0.5, vol: 0.085 }), i * 90));
  }
  function sfxPower() {
    voice({ freq: 660, slideTo: 990, type: "sine", dur: 0.18, vol: 0.09 });
    voice({ freq: 1320, type: "sine", dur: 0.22, vol: 0.04 });
  }
  function sfxLaser() {
    voice({ freq: 1400, slideTo: 360, type: "sawtooth", dur: 0.22, vol: 0.075, lp: 3200 });
    noiseVoice({ dur: 0.18, vol: 0.045, hp: 1300, decay: 1.4 });
  }
  function sfxBossHit() {
    voice({ freq: 200, slideTo: 120, type: "square", dur: 0.12, vol: 0.07 });
    voice({ freq: 240, type: "sawtooth", dur: 0.1, vol: 0.05, detune: 14 });
    noiseVoice({ dur: 0.06, vol: 0.05, hp: 520 });
  }
  function sfxBossDeath() {
    voice({ freq: 180, slideTo: 40, type: "sawtooth", dur: 0.7, vol: 0.1, lp: 1300 });
    noiseVoice({ dur: 0.6, vol: 0.1, decay: 1.6 });
    setTimeout(() => voice({ freq: NT.C5, type: "triangle", dur: 0.6, vol: 0.07 }), 130);
  }
  function sfxBossFire() {
    voice({ freq: 260, slideTo: 150, type: "sawtooth", dur: 0.16, vol: 0.05, lp: 900 });
  }
  function sfxUltimate() {
    voice({ freq: 200, slideTo: 1400, type: "sawtooth", dur: 0.4, vol: 0.08, lp: 4200 });
    setTimeout(() => { voice({ freq: 90, slideTo: 48, type: "sine", dur: 0.5, vol: 0.1 }); noiseVoice({ dur: 0.4, vol: 0.08, decay: 1.4 }); }, 220);
  }
  function sfxUI() { voice({ freq: 760, type: "sine", dur: 0.05, vol: 0.04 }); }
  function setMuted(m) {
    muted = !!m;
    try { localStorage.setItem(MUTE_KEY, muted ? "1" : "0"); } catch (e) {}
    if (masterGain) masterGain.gain.value = muted ? 0 : 0.8;
    if (els.btnMute) els.btnMute.textContent = muted ? "🔇" : "🔊";
  }
  function toggleMute() { setMuted(!muted); }

  // ---------- Toast 通知系统 ----------
  function showToast(text, type) {
    const container = document.getElementById("toast-container");
    if (!container) return;
    const toast = document.createElement("div");
    toast.className = "toast" + (type ? " " + type : "");
    toast.textContent = text;
    container.appendChild(toast);
    setTimeout(() => { if (toast.parentNode) toast.parentNode.removeChild(toast); }, 2900);
  }

  // ---------- 程序化 BGM ----------
  // 无持久振荡器：每个音符都是一次 voice()（天然受 muted/audioActive 门控，无需手动清理）。
  const BGM = {
    classic: {
      tempo: 0.46, stepDur: 0.22,
      roots: [130.81, 98.00, 174.61, 98.00],
      arp: [523.25, 587.33, 659.25, 783.99, 880.00, 783.99, 659.25, 587.33],
      arpType: "triangle", arpVol: 0.045, rootVol: 0.05, hat: false,
    },
    endless: {
      tempo: 0.32, stepDur: 0.16,
      roots: [110.00, 87.31, 98.00, 110.00],
      arp: [440.00, 523.25, 587.33, 659.25, 783.99, 880.00, 659.25, 587.33],
      arpType: "square", arpVol: 0.03, rootVol: 0.045, hat: true,
    },
    bossrush: {
      tempo: 0.24, stepDur: 0.14,
      roots: [73.42, 87.31, 98.00, 65.41],
      arp: [587.33, 659.25, 698.46, 783.99, 880.00, 783.99, 698.46, 659.25],
      arpType: "square", arpVol: 0.028, rootVol: 0.05, hat: true,
    },
    custom: {
      tempo: 0.46, stepDur: 0.22,
      roots: [130.81, 98.00, 174.61, 98.00],
      arp: [523.25, 587.33, 659.25, 783.99, 880.00, 783.99, 659.25, 587.33],
      arpType: "triangle", arpVol: 0.045, rootVol: 0.05, hat: false,
    },
  };
  let bgm = { profile: null, step: 0, nextAt: 0, on: false };
  function bgmStart(key) {
    bgm.profile = BGM[key] || BGM.classic;
    bgm.step = 0;
    bgm.nextAt = (audioCtx ? audioCtx.currentTime : 0) + 0.1;
    bgm.on = true;
  }
  function bgmStop() { bgm.on = false; bgm.profile = null; }
  // 由主循环调用：按 audioCtx 时钟推进，一个 step 一个音符
  function bgmTick() {
    if (!bgm.on || !bgm.profile || state.mode !== "playing" || !audioCtx || muted || !audioActive) return;
    const t = audioCtx.currentTime;
    if (t < bgm.nextAt) return;
    const p = bgm.profile, s = bgm.step;
    // 低音打拍（每 4 步一个根音）
    if (s % 4 === 0) {
      const root = p.roots[Math.floor(s / 4) % p.roots.length];
      voice({ freq: root, type: "sine", dur: p.tempo * 1.6, vol: p.rootVol, attack: 0.02 });
      voice({ freq: root * 2, type: "sine", dur: p.tempo * 0.9, vol: p.rootVol * 0.5, attack: 0.02 });
    }
    // 琶音主旋律（8 步循环，高处回落）
    const n = p.arp[s % p.arp.length];
    voice({ freq: n, type: p.arpType, dur: p.stepDur * 1.4, vol: p.arpVol, attack: 0.004 });
    if (s % 8 === 7) voice({ freq: n / 2, type: "sine", dur: p.stepDur * 2, vol: p.arpVol * 0.6, attack: 0.01 });
    if (p.hat) noiseVoice({ dur: 0.03, vol: 0.018, hp: 8000, decay: 0.6 });
    bgm.step++;
    bgm.nextAt = t + p.tempo;
  }

  // ---------- 升级面板 ----------
  function buildUpgradesUI() {
    if (els.upgCredits) els.upgCredits.textContent = "霓虹币 " + meta.credits;
    if (!els.upgList) return;
    els.upgList.innerHTML = "";
    for (const d of META_DEFS) {
      const lvl = meta.up[d.id] || 0;
      const maxed = lvl >= d.max;
      const cost = d.cost(lvl);
      const card = document.createElement("div"); card.className = "upgrade-card";
      card.innerHTML = '<div class="upg-icon">' + d.icon + '</div><div class="upg-name">' + d.name + '</div><div class="upg-desc">' + d.desc + '</div><div class="upg-lvl">等级 ' + lvl + "/" + d.max + '</div>';
      const btn = document.createElement("button"); btn.type = "button"; btn.className = "btn primary";
      btn.textContent = maxed ? "已满级" : ("升级 (" + cost + ")");
      if (maxed || meta.credits < cost) btn.disabled = true;
      btn.addEventListener("click", () => {
        if (meta.credits >= cost && !maxed) { meta.credits -= cost; meta.up[d.id] = (meta.up[d.id] || 0) + 1; saveMeta(); buildUpgradesUI(); }
      });
      card.appendChild(btn);
      els.upgList.appendChild(card);
    }
  }
  function openUpgrades() { hideAllScreens(); buildUpgradesUI(); if (els.screenUpg) els.screenUpg.classList.remove("hidden"); }

  // ---------- 绑定 ----------
  bindBtn("btn-start-classic", () => { startGame("classic"); });
  bindBtn("btn-start-endless", () => { startGame("endless"); });
  bindBtn("btn-start-boss", () => { startGame("bossrush"); });
  bindBtn("btn-start-daily", () => { startGame("daily"); });
  bindBtn("btn-continue", continueRun);
  bindBtn("btn-upgrades", openUpgrades);
  bindBtn("btn-upg-close", goMenu);
  bindBtn("btn-editor", openEditor);
  bindBtn("btn-help", () => { if (els.screenHelp) els.screenHelp.classList.remove("hidden"); });
  bindBtn("btn-help-close", () => { if (els.screenHelp) els.screenHelp.classList.add("hidden"); });
  bindBtn("btn-pause-help", () => { if (els.screenHelp) els.screenHelp.classList.remove("hidden"); });
  bindBtn("btn-replay", () => { startGame("classic"); });
  bindBtn("btn-restart", () => { startGame(state.gameMode); });
  bindBtn("btn-ed-clear", () => { editor.grid = newEditorGrid(); });
  bindBtn("btn-ed-play", playEditorMap);
  bindBtn("btn-ed-share", exportCode);
  bindBtn("btn-ed-import", importCode);
  bindBtn("btn-ed-save", saveMapLocal);
  bindBtn("btn-return", requestExit);
  bindBtn("btn-mute", toggleMute);
  bindBtn("btn-exit-save", () => {
    if (exitContext === "editor") saveMapLocal(); else saveRun();
    doExit();
  });
  bindBtn("btn-exit-discard", () => { if (exitContext !== "editor") clearRun(); doExit(); });
  bindBtn("btn-exit-cancel", cancelExit);

  canvas.addEventListener("mousedown", (e) => {
    if (state.mode === "editor") { editorPaint(e, e.button === 2); }
  });
  canvas.addEventListener("contextmenu", (e) => { if (state.mode === "editor") { e.preventDefault(); editorPaint(e, true); } });
  canvas.addEventListener("mousemove", (e) => { if (state.mode === "editor") editorHover(e); });
  canvas.addEventListener("mouseleave", () => { editor.hoverC = -1; editor.hoverR = -1; });

  // ---------- 初始化 ----------
  resize();
  // 清理历史遗留的 API 配置（含密钥），确保移除一键生成模块后无残留
  try { ["neon_api_endpoint", "neon_api_key", "neon_api_model"].forEach((k) => localStorage.removeItem(k)); } catch (e) {}
  if (els.btnMute) els.btnMute.textContent = muted ? "🔇" : "🔊";
  unlocked = loadAchievements();
  updateHighScoreDisplays();
  updateAchievementDisplay();
  refreshContinue();
  goMenu();
  // 测试钩子（?test=1 时暴露内部状态，供自动化冒烟断言，正常游玩无影响）
  if (/[?&]test=1/.test(location.search)) {
    window.__neon = {
      getBallStates: () => balls.map((b) => ({
        x: b.body.position.x, y: b.body.position.y,
        vx: b.body.velocity.x, vy: b.body.velocity.y,
        stuck: b.stuck, r: b.r,
      })),
      getPaddle: () => ({ x: paddle.x, y: paddle.y, w: paddle.w, targetX: paddle.targetX }),
      getState: () => ({ mode: state.mode, level: state.level, lives: state.lives, score: state.score, combo: state.combo }),
      getBricks: () => bricks.filter((b) => b.alive).map((b) => ({ x: b.x, y: b.y, w: b.w, h: b.h, type: b.type, hp: b.hp })),
      getBgm: () => ({ on: bgm.on, step: bgm.step, profile: bgm.profile ? Object.keys(bgm.profile).length : 0 }),
      testToast: (text, type) => showToast(text, type),
      setEnergy: (v) => { state.energy = v; if (v >= 100 && !energyReadyNotified) { energyReadyNotified = true; showToast("⚡ 超载就绪！按 G 释放", "combo"); screenFlashFx("#fde68a", 0.25); voice({ freq: 880, slideTo: 1320, type: "sine", dur: 0.15, vol: 0.06 }); } },
      testPerfect: () => { state.perfect = true; state.score += PERFECT_BONUS; showToast("PERFECT 无伤清场 +" + PERFECT_BONUS, "perfect"); screenFlashFx("#a3e635", 0.3); },
      testAchievement: () => unlock("shock"),
      testComboToast: () => showToast("🔥 10 连击！势不可挡", "combo"),
      ballSpeed: () => ballSpeed(),
      launchBall: () => { const sb = balls.find((b) => b.stuck); if (sb) launchBall(); },
    };
  }
  requestAnimationFrame(loop);
})();
