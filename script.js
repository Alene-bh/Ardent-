const STORAGE_PROFILE = "loopforge_profile_v14";
const STORAGE_RUN = "loopforge_active_run_v14";

const PLACEMENT_MATCHES = 5;
const PLACEMENT_MIN_ELO = 100;
const PLACEMENT_MAX_ELO = 1099; // techo: como máximo Platino al terminar posicionamiento
const ONE_TIME_RANK_RESET_VERSION = "season_1_balance_reset";
const ONE_TIME_RANK_RESET_QUERY = "resetRankOnce";

const PARTS = {
  generator: {
    name: "Generador",
    short: "GEN",
    desc: "Suma 3 a la bolita.",
    className: "generator",
    unlockElo: 100,
    apply: (v, ctx) => v + 3,
    log: (a, b) => `${a} + 3 = ${b}`
  },
  duplicator: {
    name: "Duplicador",
    short: "DUP",
    desc: "Duplica el valor actual.",
    className: "duplicator",
    unlockElo: 100,
    apply: (v, ctx) => v * 2,
    log: (a, b) => `${a} x 2 = ${b}`
  },
  filter: {
    name: "Filtro par",
    short: "PAR",
    desc: "Impares quedan en 0.",
    className: "filter",
    unlockElo: 100,
    apply: (v, ctx) => v % 2 === 0 ? v : 0,
    log: (a, b) => a % 2 === 0 ? `${a} es par, pasa` : `${a} es impar, queda 0`
  },
  subtractor: {
    name: "Restador",
    short: "RES",
    desc: "Resta 5 al valor.",
    className: "subtractor",
    unlockElo: 100,
    apply: (v, ctx) => v - 5,
    log: (a, b) => `${a} - 5 = ${b}`
  },
  compressor: {
    name: "Compresor",
    short: "CMP",
    desc: "Cada 10 se vuelve 2 y conserva el resto.",
    className: "compressor",
    unlockElo: 100,
    apply: (v, ctx) => {
      if (v < 10) return v;
      return Math.floor(v / 10) * 2 + (v % 10);
    },
    log: (a, b) => a < 10 ? `${a} no llega a 10, queda ${b}` : `cada 10 de ${a} se comprime y queda ${b}`
  },
  stabilizer: {
    name: "Estabilizador",
    short: "EST",
    desc: "Negativos vuelven a 0.",
    className: "stabilizer",
    unlockElo: 100,
    apply: (v, ctx) => Math.max(0, v),
    log: (a, b) => a < 0 ? `${a} se estabiliza en 0` : `${a} ya es estable`
  },
  amplifier: {
    name: "Amplificador",
    short: "AMP",
    desc: "Aumenta 50%, redondea.",
    className: "amplifier",
    unlockElo: 180,
    apply: (v, ctx) => Math.floor(v * 1.5),
    log: (a, b) => `${a} x 1.5 = ${b}`
  },
  inverter: {
    name: "Inversor",
    short: "INV",
    desc: "Cambia el signo.",
    className: "inverter",
    unlockElo: 260,
    apply: (v, ctx) => -v,
    log: (a, b) => `${a} cambia de signo: ${b}`
  },
  bank: {
    name: "Banco",
    short: "BNK",
    desc: "Agrega +2 al total.",
    className: "bank",
    unlockElo: 340,
    apply: (v, ctx) => {
      ctx.bonus += 2;
      return v;
    },
    log: (a, b) => `mantiene ${a} y guarda +2 extra`
  },
  limiter: {
    name: "Limitador",
    short: "LIM",
    desc: "Máximo 20.",
    className: "stabilizer",
    unlockElo: 460,
    apply: (v, ctx) => Math.min(v, 20),
    log: (a, b) => a > 20 ? `${a} se limita a 20` : `${a} no supera 20`
  },
  oddBoost: {
    name: "Imantador",
    short: "IMP",
    desc: "Si es impar, suma 7.",
    className: "amplifier",
    unlockElo: 560,
    apply: (v, ctx) => v % 2 !== 0 ? v + 7 : v,
    log: (a, b) => a % 2 !== 0 ? `${a} es impar: +7 = ${b}` : `${a} es par, no cambia`
  }
};

const RANKS = [
  { name: "Hierro", cls: "rank-iron", key: "iron", min: 100, max: 199 },
  { name: "Bronce", cls: "rank-bronze", key: "bronze", min: 200, max: 349 },
  { name: "Plata", cls: "rank-silver", key: "silver", min: 350, max: 549 },
  { name: "Oro", cls: "rank-gold", key: "gold", min: 550, max: 799 },
  { name: "Platino", cls: "rank-platinum", key: "platinum", min: 800, max: 1099 },
  { name: "Diamante", cls: "rank-diamond", key: "diamond", min: 1100, max: 1499 },
  { name: "Maestro", cls: "rank-master", key: "master", min: 1500, max: 1999 },
  { name: "Arconte", cls: "rank-archon", key: "archon", min: 2000, max: 2699 },
  { name: "Loopforger", cls: "rank-loopforger", key: "loopforger", min: 2700, max: 99999 }
];

let GRID_W = 20;
let GRID_H = 13;
const CELL = 42;
let INPUT = { x: 1, y: 1 };
let OUTPUT = { x: 18, y: 11 };

const ALL_BASIC = ["generator", "duplicator", "filter", "subtractor", "compressor", "stabilizer"];
const ALL_ADVANCED = ["amplifier", "inverter", "bank", "limiter", "oddBoost"];

const TUTORIALS = [
  {
    name: "1. Camino básico",
    short: "Cinta e IN/OUT",
    title: "Tutorial 1 — Construir el camino",
    description: "Aprendé lo más importante: la bolita solo puede viajar si existe una cinta conectada desde IN hasta OUT.",
    goals: ["Elegí Cinta.", "Dibujá un camino desde IN hasta OUT.", "Cuando el camino diga listo, tocá Simular."],
    target: 0,
    cycles: 3,
    start: 0,
    gridW: 12,
    gridH: 8,
    input: { x: 1, y: 1 },
    output: { x: 10, y: 6 },
    available: [],
    prebuild: "empty",
    required: { path: true },
    modifiers: [],
    message: "Objetivo: construí vos la cinta desde IN hasta OUT. No viene resuelto."
  },
  {
    name: "2. Generador",
    short: "+3 energía",
    title: "Tutorial 2 — Generador",
    description: "El Generador suma 3 a cada bolita. Si hay 5 ciclos, un generador produce 15 en total.",
    goals: ["Creá el camino.", "Colocá un Generador sobre la cinta.", "Llegá a 15 energía."],
    target: 15,
    cycles: 5,
    start: 0,
    gridW: 12,
    gridH: 8,
    input: { x: 1, y: 1 },
    output: { x: 10, y: 6 },
    available: ["generator"],
    prebuild: "empty",
    required: { path: true, machine: "generator" },
    modifiers: [],
    message: "Objetivo: creá el camino y colocá un Generador sobre la cinta. Luego simulá."
  },
  {
    name: "3. Orden de máquinas",
    short: "Duplicador",
    title: "Tutorial 3 — El orden importa",
    description: "El Duplicador multiplica el valor actual. No es lo mismo duplicar antes o después de sumar.",
    goals: ["Usá Generador + Duplicador.", "Probá cambiar el orden.", "Buscá 30 energía en 5 ciclos."],
    target: 30,
    cycles: 5,
    start: 0,
    gridW: 13,
    gridH: 8,
    input: { x: 1, y: 1 },
    output: { x: 11, y: 6 },
    available: ["generator", "duplicator"],
    prebuild: "empty",
    required: { path: true, machines: ["generator", "duplicator"] },
    modifiers: [],
    message: "Objetivo: creá el camino y colocá Generador + Duplicador. El orden importa."
  },
  {
    name: "4. Filtro y control",
    short: "Pares/impares",
    title: "Tutorial 4 — Controlar valores",
    description: "El Filtro par deja pasar números pares. Si la bolita es impar, la convierte en 0.",
    goals: ["Usá el Filtro par.", "Evitá que bloquee mal la energía.", "Aprendé a controlar números."],
    target: 30,
    cycles: 5,
    start: 0,
    gridW: 14,
    gridH: 9,
    input: { x: 1, y: 1 },
    output: { x: 12, y: 7 },
    available: ["generator", "duplicator", "filter"],
    prebuild: "empty",
    required: { path: true, machines: ["generator", "duplicator", "filter"] },
    modifiers: [],
    message: "Objetivo: construí un camino y usá el Filtro par sin bloquear mal la energía."
  },
  {
    name: "5. Fábrica completa",
    short: "Modo real",
    title: "Tutorial 5 — Resolver una fábrica",
    description: "Ahora combiná varias máquinas. Este es el tipo de puzzle que después aparece en ranked.",
    goals: ["Construí o editá el camino.", "Usá varias máquinas.", "Llegá al objetivo exacto."],
    target: 50,
    cycles: 5,
    start: 0,
    gridW: 15,
    gridH: 9,
    input: { x: 1, y: 1 },
    output: { x: 13, y: 7 },
    available: ["generator", "duplicator", "filter", "subtractor", "stabilizer", "bank"],
    prebuild: "empty",
    required: { path: true, machines: ["generator", "duplicator"] },
    modifiers: [],
    message: "Objetivo: resolvé una fábrica desde cero usando todo lo aprendido."
  }
];

let profile = loadProfile();

let currentLevel = null;
let currentMode = "infinite";
let tutorialIndex = 0;
let tutorialDone = new Set(profile.tutorialDone || []);

let elo = profile.elo || 100;
let lives = 3;
let streak = 0;
let challengeNumber = 1;
let resetUses = 0;
const MAX_RESET_USES = 2;
const STREAK_ELO_CAP = 28;

let gridState = [];
let selectedTool = "belt";
let cycle = 0;
let total = 0;
let lastOrbValue = 0;
let running = false;
let stopRequested = false;
let forcedFailureReason = null;
let speedIndex = 0;
let speedMultiplier = 1;
let mouseDown = false;
let currentPath = [];
let tutorialCoachDismissed = false;
let pendingUnlocks = [];

const screens = document.querySelectorAll(".screen");
const playBtn = document.getElementById("playBtn");
const tutorialBtn = document.getElementById("tutorialBtn");
const ranksBtn = document.getElementById("ranksBtn");
const accountBtn = document.getElementById("accountBtn");
const leaderboardBtn = document.getElementById("leaderboardBtn");
const optionsBtn = document.getElementById("optionsBtn");
const backToMenuBtn = document.getElementById("backToMenuBtn");

const tutorialList = document.getElementById("tutorialList");
const tutorialTitle = document.getElementById("tutorialTitle");
const tutorialDescription = document.getElementById("tutorialDescription");
const tutorialGoals = document.getElementById("tutorialGoals");
const startTutorialBtn = document.getElementById("startTutorialBtn");

const ranksList = document.getElementById("ranksList");
const accountContent = document.getElementById("accountContent");
const leaderboardContent = document.getElementById("leaderboardContent");
const currentRankShowcase = document.getElementById("currentRankShowcase");
const menuParticles = document.getElementById("menuParticles");
const hudRankBadge = document.getElementById("hudRankBadge");
const showcaseRankBadge = document.getElementById("showcaseRankBadge");
const showcaseRankName = document.getElementById("showcaseRankName");
const showcaseElo = document.getElementById("showcaseElo");
const showcaseRankFill = document.getElementById("showcaseRankFill");
const showcaseRankText = document.getElementById("showcaseRankText");

const grid = document.getElementById("grid");
const energyLayer = document.getElementById("energyLayer");
const scoreFlyLayer = document.getElementById("scoreFlyLayer");
const log = document.getElementById("log");
const machinePalette = document.getElementById("machinePalette");

const hudLevel = document.getElementById("hudLevel");
const hudObjective = document.getElementById("hudObjective");
const eloText = document.getElementById("eloText");
const rankCard = document.getElementById("rankCard");
const rankName = document.getElementById("rankName");
const rankFill = document.getElementById("rankFill");
const rankProgressText = document.getElementById("rankProgressText");
const livesText = document.getElementById("livesText");
const totalText = document.getElementById("totalText");
const cycleText = document.getElementById("cycleText");
const lastOrbText = document.getElementById("lastOrbText");
const diffText = document.getElementById("diffText");
const pathText = document.getElementById("pathText");
const gameStatus = document.getElementById("gameStatus");
const factoryName = document.getElementById("factoryName");
const sampleBtn = document.getElementById("sampleBtn"); // removed from UI in v20, kept for compatibility
const modifierBox = document.getElementById("modifierBox");
const quickStartText = document.getElementById("quickStartText");
const quickCyclesText = document.getElementById("quickCyclesText");
const quickTargetText = document.getElementById("quickTargetText");

const tutorialCoach = document.getElementById("tutorialCoach");
const coachCloseBtn = document.getElementById("coachCloseBtn");
const coachTitle = document.getElementById("coachTitle");
const coachText = document.getElementById("coachText");
const coachSteps = document.getElementById("coachSteps");

const runBtn = document.getElementById("runBtn");
const stopBtn = document.getElementById("stopBtn");
const speedBtn = document.getElementById("speedBtn");
const stepBtn = document.getElementById("stepBtn");
const resetBtn = document.getElementById("resetBtn");
const clearBtn = document.getElementById("clearBtn");

const unlockModal = document.getElementById("unlockModal");
const unlockMachineSprite = document.getElementById("unlockMachineSprite");
const unlockMachineName = document.getElementById("unlockMachineName");
const unlockMachineText = document.getElementById("unlockMachineText");
const unlockCloseBtn = document.getElementById("unlockCloseBtn");

const rankUpModal = document.getElementById("rankUpModal");
const rankUpBadge = document.getElementById("rankUpBadge");
const rankUpTitle = document.getElementById("rankUpTitle");
const rankUpText = document.getElementById("rankUpText");
const rankUpContinueBtn = document.getElementById("rankUpContinueBtn");

const modal = document.getElementById("modal");
const modalTitle = document.getElementById("modalTitle");
const modalText = document.getElementById("modalText");
const modalNextBtn = document.getElementById("modalNextBtn");
const modalRetryBtn = document.getElementById("modalRetryBtn");

const optionsModal = document.getElementById("optionsModal");
const optionsCloseBtn = document.getElementById("optionsCloseBtn");
const menuMusicToggle = document.getElementById("menuMusicToggle");
const gameMusicToggle = document.getElementById("gameMusicToggle");
const volumeSlider = document.getElementById("volumeSlider");
const volumeValue = document.getElementById("volumeValue");
const resumeBtn = document.getElementById("resumeBtn");
const optionsMenuBtn = document.getElementById("optionsMenuBtn");

const AUDIO_STORAGE = "loopforge_audio_settings_v1";
const menuMusic = new Audio("assets/audio/menu.mp3");
const gameMusic = new Audio("assets/audio/game.mp3");
menuMusic.loop = true;
gameMusic.loop = true;

const sfx = {
  place: new Audio("assets/sfx/place.mp3"),
  complete: new Audio("assets/sfx/complete.wav"),
  hurt: new Audio("assets/sfx/hurt.wav"),
  death: new Audio("assets/sfx/death.wav"),
  popup: new Audio("assets/sfx/popup.wav"),
  button: new Audio("assets/sfx/button.mp3"),
  rankup: new Audio("assets/sfx/rankup.mp3")
};

Object.values(sfx).forEach(sound => {
  sound.preload = "auto";
});

let audioUnlocked = false;
let audioSettings = loadAudioSettings();
let currentScreenId = "mainMenu";
let pendingRankUps = [];

function loadProfile() {
  const defaults = {
    elo: 100,
    bestElo: 100,
    tutorialDone: [],
    seenUnlocks: ALL_BASIC.slice(),
    recentTargets: [],
    placementComplete: false,
    placementsDone: 0,
    placementResults: [],
    placementOrder: [],
    lossStreak: 0,
    discordUser: null,
    stats: {
      wins: 0,
      losses: 0,
      matches: 0,
      machineUsage: {}
    }
  };

  try {
    const raw = localStorage.getItem(STORAGE_PROFILE);
    if (raw) {
      const data = JSON.parse(raw);
      return { ...defaults, ...data };
    }
  } catch {}

  return defaults;
}


function normalizeStats(stats = {}) {
  return {
    wins: Number(stats.wins) || 0,
    losses: Number(stats.losses) || 0,
    matches: Number(stats.matches) || 0,
    machineUsage: stats.machineUsage && typeof stats.machineUsage === "object" ? stats.machineUsage : {}
  };
}

function getDiscordUser() {
  return profile.discordUser || null;
}

function isLoggedIn() {
  return !!getDiscordUser();
}

function loginWithDiscord() {
  window.location.href = "/api/auth/login";
}

async function logoutDiscord() {
  try {
    await fetch("/api/logout", { method: "POST" });
  } catch {}
  profile.discordUser = null;
  saveProfile();
  renderAccountMenu();
  renderLeaderboardMenu();
}

function getWinrate(stats = profile.stats) {
  stats = normalizeStats(stats);
  if (!stats.matches) return 0;
  return Math.round((stats.wins / stats.matches) * 100);
}

function getFavoriteMachine(stats = profile.stats) {
  stats = normalizeStats(stats);
  const entries = Object.entries(stats.machineUsage || {});
  if (!entries.length) return "Sin datos";
  entries.sort((a, b) => b[1] - a[1]);
  const id = entries[0][0];
  return PARTS[id]?.name || id;
}

function countPlacedMachinesByType() {
  const usage = {};
  if (!gridState || !gridState.length) return usage;
  for (let y = 0; y < GRID_H; y++) {
    for (let x = 0; x < GRID_W; x++) {
      const id = gridState[y]?.[x]?.machine;
      if (id) usage[id] = (usage[id] || 0) + 1;
    }
  }
  return usage;
}

function recordRankedResult(win) {
  if (currentMode === "tutorial") return;
  profile.stats = normalizeStats(profile.stats);
  profile.stats.matches += 1;
  if (win) profile.stats.wins += 1;
  else profile.stats.losses += 1;

  const usage = countPlacedMachinesByType();
  for (const [id, amount] of Object.entries(usage)) {
    profile.stats.machineUsage[id] = (profile.stats.machineUsage[id] || 0) + amount;
  }
  saveProfile();
  scheduleAccountSync();
}

function getAccountRank() {
  if (!profile.placementComplete) return { name: "Unranked", cls: "rank-unranked", key: "unranked", min: 0, max: 0 };
  return getRankInfo(profile.elo || 100);
}

function avatarHtml(user, sizeClass = "discord-avatar") {
  const src = user?.avatar || "assets/discord-placeholder.svg";
  const alt = user?.username || "Discord";
  return `<img class="${sizeClass}" src="${src}" alt="${alt}">`;
}

function renderLoginGate(title, text) {
  return `
    <div class="account-gate">
      <div class="discord-orb">⌁</div>
      <h2>${title}</h2>
      <p>${text}</p>
      <button class="menu-btn primary discord-login-btn" type="button">INICIAR SESIÓN CON DISCORD</button>
      <span class="auth-note">Usa Discord OAuth real y guarda tus stats en Vercel/Redis.</span>
    </div>
  `;
}

function renderAccountMenu() {
  if (!accountContent) return;
  const user = getDiscordUser();
  if (!user) {
    accountContent.innerHTML = renderLoginGate("Conectá tu cuenta", "Iniciá sesión con Discord para ver tus stats, rango y progreso de ranked.");
    accountContent.querySelector(".discord-login-btn")?.addEventListener("click", loginWithDiscord);
    return;
  }

  const stats = normalizeStats(profile.stats);
  const rank = getAccountRank();
  const winrate = getWinrate(stats);
  const favMachine = getFavoriteMachine(stats);

  accountContent.innerHTML = `
    <div class="account-hero ${rank.cls}">
      ${avatarHtml(user, "account-avatar")}
      <div class="account-main-info">
        <div class="account-kicker">CUENTA DISCORD</div>
        <h2>${user.username}</h2>
        <p>Tu cuenta conecta la forja con tu progreso: guardá tus estadísticas, subí de rango y competí en el leaderboard.
</p>
      </div>
      <button id="logoutDiscordBtn" class="small-btn" type="button">CERRAR SESIÓN</button>
    </div>

    <div class="account-stats-grid">
      <div class="account-stat-card"><span>Winrate</span><b>${winrate}%</b></div>
      <div class="account-stat-card"><span>Rango</span><b>${rank.name}</b></div>
      <div class="account-stat-card"><span>Partidas jugadas</span><b>${stats.matches}</b></div>
      <div class="account-stat-card"><span>Máquina preferida</span><b>${favMachine}</b></div>
    </div>
  `;

  document.getElementById("logoutDiscordBtn")?.addEventListener("click", logoutDiscord);
}

function renderLeaderboardRows(rows) {
  return rows.map(row => `
    <div class="leaderboard-row ${row.isYou ? "you" : ""}">
      <div class="leaderboard-player">
        ${avatarHtml(row, "leaderboard-avatar")}
        <strong>${row.name}</strong>
      </div>
      ${leaderboardRankHtml(row)}
      <b>${row.winrate}%</b>
    </div>
  `).join("");
}

function leaderboardRankHtml(row) {
  const numericElo = Number(row.elo || row.rating || row.score || 0);
  const rank = numericElo ? getRankInfo(numericElo) : getRankFromName(row.rank);
  const eloLine = rank.key === "loopforger" && numericElo ? `<small>${numericElo} ELO</small>` : "";
  return `
    <span class="leaderboard-rank-icon ${rank.cls}" title="${rank.name}">
      <img src="${getRankBadgeSrc(rank)}" alt="${rank.name}">
      ${eloLine}
    </span>
  `;
}

function getRankFromName(name = "") {
  const normalized = String(name).toLowerCase();
  return RANKS.find(r => r.name.toLowerCase() === normalized || r.key === normalized) || RANKS[0];
}

async function renderLeaderboardMenu() {
  if (!leaderboardContent) return;
  if (!isLoggedIn()) {
    leaderboardContent.innerHTML = renderLoginGate("Leaderboard bloqueado", "Para entrar al leaderboard tenés que iniciar sesión con Discord.");
    leaderboardContent.querySelector(".discord-login-btn")?.addEventListener("click", loginWithDiscord);
    return;
  }

  leaderboardContent.innerHTML = `
    <div class="leaderboard-header-card">
      <div>
        <div class="account-kicker">RANKED GLOBAL</div>
        <h2>Leaderboard</h2>
        <p>Cargando jugadores conectados...</p>
      </div>
    </div>
  `;

  try {
    const res = await fetch("/api/leaderboard", { credentials: "include" });
    if (res.status === 401) {
      profile.discordUser = null;
      saveProfile();
      renderLeaderboardMenu();
      return;
    }
    const data = await res.json();
    const rows = Array.isArray(data.players) ? data.players : [];
    leaderboardContent.innerHTML = `
      <div class="leaderboard-header-card">
        <div>
          <div class="account-kicker">RANKED GLOBAL</div>
          <h2>Leaderboard</h2>
          <p>Mostrando lista de los eruditos de Loopforge.</p>
        </div>
      </div>

      <div class="leaderboard-table">
        <div class="leaderboard-row leaderboard-head">
          <span>Jugador</span>
          <span>Rango</span>
          <span>Winrate</span>
        </div>
        ${rows.length ? renderLeaderboardRows(rows) : `<div class="leaderboard-empty">Todavía no hay jugadores con stats. Jugá una ranked y aparecés acá.</div>`}
      </div>
    `;
  } catch {
    leaderboardContent.innerHTML = `
      <div class="account-gate">
        <div class="discord-orb">!</div>
        <h2>No pude cargar el leaderboard</h2>
        <p>Revisá que las API routes estén deployadas y que Redis esté conectado en Vercel.</p>
      </div>
    `;
  }
}

let accountSyncTimer = null;
function scheduleAccountSync() {
  if (!isLoggedIn()) return;
  clearTimeout(accountSyncTimer);
  accountSyncTimer = setTimeout(syncAccountStats, 600);
}

async function syncAccountStats() {
  if (!isLoggedIn()) return;
  try {
    await fetch("/api/stats", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        elo: profile.elo || elo || 100,
        placementComplete: !!profile.placementComplete,
        stats: normalizeStats(profile.stats)
      })
    });
  } catch {}
}

function getRankResetUsageMap() {
  try {
    return JSON.parse(localStorage.getItem(`${STORAGE_PROFILE}_${ONE_TIME_RANK_RESET_VERSION}`) || "{}");
  } catch {
    return {};
  }
}

function saveRankResetUsageMap(map) {
  localStorage.setItem(`${STORAGE_PROFILE}_${ONE_TIME_RANK_RESET_VERSION}`, JSON.stringify(map || {}));
}

function getRankResetKey(user) {
  return user?.id || user?.username || "local";
}

function hasUsedOneTimeRankReset(user) {
  const map = getRankResetUsageMap();
  return !!map[getRankResetKey(user)];
}

function markOneTimeRankResetUsed(user) {
  const map = getRankResetUsageMap();
  map[getRankResetKey(user)] = Date.now();
  saveRankResetUsageMap(map);
}

function isRankResetRequested() {
  try {
    const params = new URLSearchParams(window.location.search);
    return params.get(ONE_TIME_RANK_RESET_QUERY) === "1" || localStorage.getItem("loopforge_pending_rank_reset") === "1";
  } catch {
    return false;
  }
}

function cleanRankResetUrl() {
  try {
    const url = new URL(window.location.href);
    if (!url.searchParams.has(ONE_TIME_RANK_RESET_QUERY)) return;
    url.searchParams.delete(ONE_TIME_RANK_RESET_QUERY);
    window.history.replaceState({}, document.title, url.pathname + url.search + url.hash);
  } catch {}
}

function applyOneTimeRankReset(user) {
  if (!isRankResetRequested()) return false;

  if (!user) {
    localStorage.setItem("loopforge_pending_rank_reset", "1");
    alert("Reset de rango pendiente: iniciá sesión con Discord y volvé al juego para aplicarlo.");
    return false;
  }

  if (hasUsedOneTimeRankReset(user)) {
    localStorage.removeItem("loopforge_pending_rank_reset");
    cleanRankResetUrl();
    alert("Este reset de rango ya fue usado en esta cuenta.");
    return false;
  }

  markOneTimeRankResetUsed(user);
  localStorage.removeItem("loopforge_pending_rank_reset");
  clearSavedRun();

  elo = PLACEMENT_MIN_ELO;
  streak = 0;
  lives = 3;
  resetUses = 0;

  profile.elo = PLACEMENT_MIN_ELO;
  profile.bestElo = PLACEMENT_MIN_ELO;
  profile.placementComplete = false;
  profile.placementsDone = 0;
  profile.placementResults = [];
  profile.placementOrder = [];
  profile.lossStreak = 0;
  profile.stats = normalizeStats(profile.stats);

  saveProfile();
  syncAccountStats();
  updateHud();
  renderAccountMenu();
  renderLeaderboardMenu();
  cleanRankResetUrl();
  alert("Reset aplicado: esta cuenta volvió a Unranked y tendrá que jugar posicionamiento otra vez.");
  return true;
}

function mergeRemoteProfile(user) {
  if (!user) return;
  profile.discordUser = {
    id: user.id,
    username: user.username,
    avatar: user.avatar || "assets/discord-placeholder.svg"
  };

  if (applyOneTimeRankReset(profile.discordUser)) {
    return;
  }

  const remoteStats = normalizeStats(user.stats);
  const localStats = normalizeStats(profile.stats);
  if (remoteStats.matches > localStats.matches) {
    profile.stats = remoteStats;
    profile.elo = Number(user.elo) || profile.elo;
    elo = profile.elo;
    profile.placementComplete = !!user.placementComplete;
  }

  saveProfile();
}

async function fetchCurrentUser() {
  try {
    const res = await fetch("/api/me", { credentials: "include" });
    if (!res.ok) return;
    const data = await res.json();
    if (data.authenticated && data.user) {
      mergeRemoteProfile(data.user);
      scheduleAccountSync();
      renderAccountMenu();
    }
  } catch {}
}

function saveProfile() {
  profile.elo = Math.max(100, Math.floor(elo));
  profile.bestElo = Math.max(profile.bestElo || 100, profile.elo);
  profile.tutorialDone = Array.from(tutorialDone);
  profile.recentTargets = profile.recentTargets || [];
  profile.placementResults = profile.placementResults || [];
  profile.placementOrder = profile.placementOrder || [];
  profile.lossStreak = profile.lossStreak || 0;
  profile.stats = normalizeStats(profile.stats);
  localStorage.setItem(STORAGE_PROFILE, JSON.stringify(profile));
  if (typeof scheduleAccountSync === "function") scheduleAccountSync();
}

function saveRun() {
  if (!currentLevel) return;
  if (!["infinite", "placement"].includes(currentMode)) return;
  if (lives <= 0) return;

  const state = {
    currentMode,
    elo,
    lives,
    streak,
    challengeNumber,
    currentLevel,
    gridState,
    cycle,
    total,
    lastOrbValue,
    selectedTool,
    resetUses
  };

  localStorage.setItem(STORAGE_RUN, JSON.stringify(state));
  saveProfile();
}

function clearSavedRun() {
  localStorage.removeItem(STORAGE_RUN);
}

function loadSavedRun() {
  try {
    const raw = localStorage.getItem(STORAGE_RUN);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function showScreen(id) {
  const previousScreenId = currentScreenId;
  screens.forEach(screen => screen.classList.remove("active"));
  document.getElementById(id).classList.add("active");
  currentScreenId = id;

  if (id === "mainMenu" && previousScreenId !== "mainMenu") {
    stopAudio(menuMusic);
  }

  updateMusicForScreen();
}

function loadAudioSettings() {
  const defaults = {
    menuMusic: true,
    gameMusic: true,
    volume: 0.7
  };

  try {
    const raw = localStorage.getItem(AUDIO_STORAGE);
    if (raw) return { ...defaults, ...JSON.parse(raw) };
  } catch {}

  return defaults;
}

function saveAudioSettings() {
  localStorage.setItem(AUDIO_STORAGE, JSON.stringify(audioSettings));
}

function unlockAudio() {
  if (audioUnlocked) return;
  audioUnlocked = true;
  updateMusicForScreen();
}

function safePlay(audio) {
  if (!audioUnlocked) return;
  audio.play().catch(() => {});
}

function playSfx(name) {
  if (!audioUnlocked) return;
  const sound = sfx[name];
  if (!sound) return;
  sound.volume = Math.max(0, Math.min(1, Number(audioSettings.volume) || 0));
  try {
    sound.currentTime = 0;
  } catch {}
  sound.play().catch(() => {});
}

function stopAudio(audio) {
  audio.pause();
  audio.currentTime = 0;
}

function updateAudioVolumes() {
  const volume = Math.max(0, Math.min(1, Number(audioSettings.volume) || 0));
  menuMusic.volume = volume;
  gameMusic.volume = volume;
  Object.values(sfx).forEach(sound => {
    sound.volume = volume;
  });
  if (volumeSlider) volumeSlider.value = Math.round(volume * 100);
  if (volumeValue) volumeValue.textContent = `${Math.round(volume * 100)}%`;
}

function updateMusicToggles() {
  if (menuMusicToggle) menuMusicToggle.classList.toggle("active", !!audioSettings.menuMusic);
  if (gameMusicToggle) gameMusicToggle.classList.toggle("active", !!audioSettings.gameMusic);
}

function isGameScreenActive() {
  return currentScreenId === "gameScreen";
}

function updateMusicForScreen() {
  updateAudioVolumes();
  updateMusicToggles();

  if (isGameScreenActive()) {
    menuMusic.pause();
    if (audioSettings.gameMusic) safePlay(gameMusic);
    else gameMusic.pause();
    return;
  }

  gameMusic.pause();
  if (audioSettings.menuMusic) safePlay(menuMusic);
  else menuMusic.pause();
}

function openOptions() {
  optionsModal.classList.remove("hidden");
  updateAudioVolumes();
  updateMusicToggles();
}

function closeOptions() {
  optionsModal.classList.add("hidden");
}

function goToMainMenuFromOptions() {
  closeOptions();
  saveRun();
  showScreen("mainMenu");
}

function toggleMenuMusic() {
  audioSettings.menuMusic = !audioSettings.menuMusic;
  saveAudioSettings();
  updateMusicForScreen();
}

function toggleGameMusic() {
  audioSettings.gameMusic = !audioSettings.gameMusic;
  saveAudioSettings();
  updateMusicForScreen();
}

function configureGrid(level) {
  GRID_W = level.gridW || 20;
  GRID_H = level.gridH || 13;
  INPUT = level.input || { x: 1, y: 1 };
  OUTPUT = level.output || { x: GRID_W - 2, y: GRID_H - 2 };

  document.documentElement.style.setProperty("--grid-w", GRID_W);
  document.documentElement.style.setProperty("--grid-h", GRID_H);
}

function emptyGrid() {
  const arr = [];
  for (let y = 0; y < GRID_H; y++) {
    const row = [];
    for (let x = 0; x < GRID_W; x++) {
      row.push({ belt: false, machine: null, blocked: false, gate: null });
    }
    arr.push(row);
  }
  arr[INPUT.y][INPUT.x].belt = true;
  arr[OUTPUT.y][OUTPUT.x].belt = true;
  return arr;
}

function applyBlockedCells(level) {
  if (!level.blockedCells) return;
  for (const p of level.blockedCells) {
    if (inside(p.x, p.y) && !(p.x === INPUT.x && p.y === INPUT.y) && !(p.x === OUTPUT.x && p.y === OUTPUT.y)) {
      gridState[p.y][p.x].blocked = true;
      gridState[p.y][p.x].belt = false;
      gridState[p.y][p.x].machine = null;
      gridState[p.y][p.x].gate = null;
    }
  }
}

function applyEnergyGates(level) {
  const gate = level.energyGate;
  if (!gate || !inside(gate.x, gate.y)) return;
  if (gate.x === INPUT.x && gate.y === INPUT.y) return;
  if (gate.x === OUTPUT.x && gate.y === OUTPUT.y) return;
  const cell = gridState[gate.y][gate.x];
  if (cell.blocked) return;
  cell.gate = gate;
}


function ensurePlacementOrder() {
  if (!profile.placementOrder || profile.placementOrder.length !== 5) {
    const probes = [120, 260, 430, 700, 1000];
    for (let i = probes.length - 1; i > 0; i--) {
      const j = rand(0, i);
      [probes[i], probes[j]] = [probes[j], probes[i]];
    }
    profile.placementOrder = probes;
    saveProfile();
  }
  return profile.placementOrder;
}

function calculatePlacementElo() {
  const results = profile.placementResults || [];
  const wins = results.filter(r => r.win).length;
  const totalProbe = results.reduce((sum, r) => sum + r.probe, 0) || 1;
  const earnedProbe = results.filter(r => r.win).reduce((sum, r) => sum + r.probe, 0);
  const weightedRatio = earnedProbe / totalProbe;

  // El posicionamiento ubica fuerte, pero no corona.
  // Aunque ganes las 5, el máximo inicial es Platino. Diamante+ se gana en ranked real.
  const winBonus = wins * 44;
  const raw = Math.round(PLACEMENT_MIN_ELO + weightedRatio * 790 + winBonus);
  return Math.max(PLACEMENT_MIN_ELO, Math.min(PLACEMENT_MAX_ELO, raw));
}

function startPlacementMatch() {
  currentMode = "placement";
  const order = ensurePlacementOrder();
  const index = Math.max(0, profile.placementsDone || 0);
  const probeElo = order[index] || order[order.length - 1] || 120;

  elo = probeElo;
  lives = 3;
  resetUses = 0;
  streak = 0;
  challengeNumber = index + 1;

  currentLevel = generateChallengeForValue(probeElo, {
    name: `Posicionamiento ${index + 1}/${PLACEMENT_MATCHES}`,
    placement: true,
    placementIndex: index + 1
  });

  startLevel(currentLevel);
}

function startInfiniteRun() {
  const saved = loadSavedRun();
  if (saved && saved.lives > 0) {
    currentMode = saved.currentMode || "infinite";
    elo = saved.elo;
    lives = saved.lives;
    streak = saved.streak || 0;
    challengeNumber = saved.challengeNumber || 1;
    currentLevel = saved.currentLevel;
    configureGrid(currentLevel);
    gridState = saved.gridState;
    cycle = saved.cycle || 0;
    total = saved.total || 0;
    lastOrbValue = saved.lastOrbValue || 0;
    selectedTool = saved.selectedTool || "belt";
    resetUses = saved.resetUses || 0;
    running = false;
    stopRequested = false;
    forcedFailureReason = null;
    showScreen("gameScreen");
    renderGame();
    clearLog();
    addLog(currentMode === "placement" ? "Partida de posicionamiento recuperada." : "Run recuperada. Seguís donde estabas.");
    return;
  }

  if (!profile.placementComplete) {
    startPlacementMatch();
    return;
  }

  currentMode = "infinite";
  elo = profile.elo || 100;
  lives = 3;
  resetUses = 0;
  streak = 0;
  challengeNumber = 1;
  currentLevel = generateInfiniteLevel();
  startLevel(currentLevel);
}

function generateChallengeForValue(sourceElo, options = {}) {
  const difficulty = Math.floor(sourceElo / 100);
  const rankIndex = Math.max(0, RANKS.findIndex(r => sourceElo >= r.min && sourceElo <= r.max));

  const minCycles = Math.min(18, 4 + Math.floor(difficulty / 3));
  const maxCycles = Math.min(18, minCycles + 2 + Math.floor(rankIndex / 3));
  const cycles = rand(minCycles, maxCycles);

  let available = [...ALL_BASIC];
  for (const id of ALL_ADVANCED) {
    if (sourceElo >= PARTS[id].unlockElo) available.push(id);
  }

  const layout = getLayoutForElo(sourceElo);
  const specialRules = createSpecialRulesForElo(sourceElo, available);
  const machineLimit = getMachineLimitForElo(sourceElo);

  const baseMax = 3 + Math.floor(sourceElo / 170) + Math.floor((options.challengeNumber || challengeNumber || 1) / 5);
  const maxMachines = Math.max(2, Math.min(machineLimit, 12, baseMax));
  const minMachines = Math.min(maxMachines, sourceElo < 350 ? 2 : sourceElo < 800 ? 3 : sourceElo < 1100 ? 3 : 4);

  const startPool = getStartEnergyPool(sourceElo);
  const generated = buildVariedChallenge(available, minMachines, maxMachines, startPool, cycles, specialRules, sourceElo);

  const minimum = findMinimumMachineCount({
    available,
    start: generated.start,
    targetPerCycle: generated.perCycle,
    maxMachines,
    specialRules
  }) || generated.solution.length;

  const energyGate = layout.energyGate ? makeEnergyGate(layout.energyGate, generated.solution, generated.start, sourceElo) : null;
  const modifiers = getModifiersForElo(sourceElo, layout, specialRules, machineLimit, energyGate, minimum);

  return {
    name: options.name || `Reto ${challengeNumber}`,
    target: generated.target,
    cycles,
    start: generated.start,
    available,
    gridW: layout.w,
    gridH: layout.h,
    input: layout.input,
    output: layout.output,
    blockedCells: layout.blockedCells,
    energyGate,
    modifiers,
    specialRules,
    maxMachines,
    minMachines: minimum,
    message: options.placement
      ? `Partida de posicionamiento ${options.placementIndex || 1}/${PLACEMENT_MATCHES}.`
      : `Reto ranked. ELO ${sourceElo}. Energía inicial: ${generated.start}.`,
    generatedSolution: generated.solution,
    placement: !!options.placement
  };
}

function generateInfiniteLevel() {
  return generateChallengeForValue(elo, { name: `Reto ${challengeNumber}` });
}

function getStartEnergyPool(value) {
  if (value >= 1500) return [0, 1, 2, 3, 4, 5, 6, 7, 8, 10];
  if (value >= 800) return [0, 1, 2, 3, 4, 5, 6];
  if (value >= 350) return [0, 1, 2, 3, 4, 5];
  return [0, 1, 2, 3];
}

function buildVariedChallenge(available, minMachines, maxMachines, startPool, cycles, specialRules = {}, sourceElo = elo) {
  const recent = profile.recentTargets || [];
  let best = null;
  let bestScore = -Infinity;

  for (let attempt = 0; attempt < 260; attempt++) {
    const start = startPool[rand(0, startPool.length - 1)];
    const solution = buildRandomSolution(available, minMachines, maxMachines, start, specialRules, sourceElo);
    const evaluated = evaluateSolution(solution, start);
    const perCycle = evaluated.total;
    const target = perCycle * cycles;

    if (perCycle <= 0 || target <= 0) continue;
    if (!solutionSatisfiesSpecialRules(solution, specialRules)) continue;

    const repeatedTargetPenalty = recent.includes(target) ? -80 : 0;
    const boringPenalty = isBoringSolution(solution, start, perCycle) ? -60 : 0;
    const compactBonus = sourceElo >= 1100 ? 20 : 0;
    const complexityScore = solution.length * 8;
    const valueScore = Math.min(60, Math.abs(target - 15));
    const score = complexityScore + compactBonus + valueScore + repeatedTargetPenalty + boringPenalty + Math.random() * 12;

    if (score > bestScore) {
      bestScore = score;
      best = { start, solution, target, perCycle };
    }
  }

  if (!best) {
    const fallback = enforceSpecialRulesInSolution(["generator", "duplicator"], specialRules, available, maxMachines);
    const evaluated = evaluateSolution(fallback, 0);
    best = {
      start: 0,
      solution: fallback,
      perCycle: Math.max(1, evaluated.total),
      target: Math.max(1, evaluated.total) * cycles
    };
  }

  profile.recentTargets = [...(profile.recentTargets || []), best.target].slice(-8);
  saveProfile();

  return best;
}

function isBoringSolution(solution, start, perCycle) {
  if (solution.length <= 1) return true;
  if (start === 0 && solution.length === 2 && solution.includes("generator") && perCycle === 3) return true;
  if (start === 0 && solution.length === 1 && perCycle === 3) return true;
  return false;
}

function buildRandomSolution(available, minMachines, maxMachines, start, specialRules = {}, sourceElo = elo) {
  const safeFirst = available.filter(id => id !== "inverter" && id !== "compressor");
  let best = enforceSpecialRulesInSolution(["generator", "duplicator"], specialRules, available, maxMachines);

  for (let attempt = 0; attempt < 140; attempt++) {
    const len = rand(Math.max(minMachines, getMinimumRuleLength(specialRules)), maxMachines);
    const sol = [];

    for (let i = 0; i < len; i++) {
      let pool = available;

      if (i === 0) pool = safeFirst;
      if (start === 0 && i === 0) {
        pool = pool.filter(id => !["filter", "compressor", "subtractor"].includes(id));
      }

      if (sourceElo < 350) {
        pool = pool.filter(id => !["inverter", "limiter", "oddBoost"].includes(id));
      }

      if (!pool.length) pool = available;
      sol.push(pool[rand(0, pool.length - 1)]);
    }

    const fixed = enforceSpecialRulesInSolution(sol, specialRules, available, maxMachines);

    if (!fixed.includes("generator") && !fixed.includes("bank") && start <= 1) {
      const replaceIndex = Math.min(fixed.length - 1, Math.max(getMinimumRuleLength(specialRules) - 1, rand(0, fixed.length - 1)));
      fixed[replaceIndex] = "generator";
    }

    const result = evaluateSolution(fixed, start).total;
    const maxResult = sourceElo >= 2000 ? 300 : sourceElo >= 1500 ? 230 : sourceElo >= 800 ? 155 : 95;

    if (result > 0 && result < maxResult && solutionSatisfiesSpecialRules(fixed, specialRules)) {
      best = fixed.slice(0, maxMachines);
      break;
    }
  }

  return best.slice(0, maxMachines);
}

function getMinimumRuleLength(rules = {}) {
  let min = 0;
  if (rules.startWithMachine) min = Math.max(min, 1);
  if (rules.adjacentPair) min = Math.max(min, 2);
  if (rules.requiredMachines) min = Math.max(min, rules.requiredMachines.length);
  return min || 1;
}

function enforceSpecialRulesInSolution(solution, rules = {}, available = [], maxMachines = 12) {
  let sol = [...solution];

  if (rules.startWithMachine) {
    if (!sol.length) sol.push(rules.startWithMachine);
    sol[0] = rules.startWithMachine;
  }

  if (rules.adjacentPair) {
    const [a, b] = rules.adjacentPair;
    const pos = rules.startWithMachine ? 1 : rand(0, Math.max(0, Math.min(sol.length - 2, maxMachines - 2)));
    while (sol.length < pos + 2) sol.push(available[rand(0, available.length - 1)] || "generator");
    sol[pos] = a;
    sol[pos + 1] = b;
  }

  for (const id of rules.requiredMachines || []) {
    if (!sol.includes(id)) {
      if (sol.length < maxMachines) sol.push(id);
      else sol[Math.max(0, sol.length - 1)] = id;
    }
  }

  return sol.slice(0, maxMachines);
}

function solutionSatisfiesSpecialRules(solution, rules = {}) {
  if (rules.startWithMachine && solution[0] !== rules.startWithMachine) return false;
  if (rules.adjacentPair) {
    const [a, b] = rules.adjacentPair;
    let ok = false;
    for (let i = 0; i < solution.length - 1; i++) {
      if (solution[i] === a && solution[i + 1] === b) ok = true;
    }
    if (!ok) return false;
  }
  for (const id of rules.requiredMachines || []) {
    if (!solution.includes(id)) return false;
  }
  return true;
}

function getMachineLimitForElo(value) {
  if (value >= 1500) return 8;
  if (value >= 1100) return 9;
  if (value >= 800) return 10;
  return 12;
}

function createSpecialRulesForElo(value, available) {
  const rules = { requiredMachines: [] };

  if (value >= 550) {
    const pool = available.filter(id => !["stabilizer"].includes(id));
    const requiredCount = value >= 1500 ? 2 : 1;
    while (rules.requiredMachines.length < requiredCount && pool.length > 0) {
      const id = pool.splice(rand(0, pool.length - 1), 1)[0];
      rules.requiredMachines.push(id);
    }
  }

  if (value >= 800 && available.includes("generator") && Math.random() < 0.45) {
    rules.startWithMachine = "generator";
    if (!rules.requiredMachines.includes("generator")) rules.requiredMachines.push("generator");
  }

  if (value >= 1100 && available.includes("oddBoost") && Math.random() < 0.55) {
    rules.adjacentPair = ["generator", "oddBoost"];
    for (const id of rules.adjacentPair) {
      if (!rules.requiredMachines.includes(id)) rules.requiredMachines.push(id);
    }
  }

  return rules;
}

function makeEnergyGate(pos, solution, start, sourceElo) {
  // Casilla opcional de energía: no es condición de victoria.
  // Sirve como recurso táctico: si el camino pasa por acá, suma energía a la bolita.
  const base = sourceElo >= 2000 ? 7 : sourceElo >= 1500 ? 6 : sourceElo >= 1100 ? 5 : sourceElo >= 800 ? 4 : 3;
  const swing = sourceElo >= 1500 ? rand(0, 3) : rand(0, 2);
  const value = base + swing;
  return { x: pos.x, y: pos.y, value, label: `+${value}` };
}

function findMinimumMachineCount({ available, start, targetPerCycle, maxMachines, specialRules = {} }) {
  const limit = Math.min(maxMachines || 8, 8);
  const maxAbs = 360;
  let states = [{ value: start, bonus: 0, seq: [] }];

  for (let depth = 0; depth <= limit; depth++) {
    for (const st of states) {
      if (st.seq.length === depth && st.value + st.bonus === targetPerCycle && solutionSatisfiesSpecialRules(st.seq, specialRules)) {
        return depth;
      }
    }
    if (depth === limit) break;

    const next = [];
    const seen = new Set();
    for (const st of states) {
      if (st.seq.length !== depth) continue;
      for (const id of available) {
        const ctx = { bonus: st.bonus };
        const value = PARTS[id].apply(st.value, ctx);
        if (Math.abs(value) > maxAbs || Math.abs(ctx.bonus) > 80) continue;
        const seq = [...st.seq, id];
        if (specialRules.startWithMachine && seq.length === 1 && seq[0] !== specialRules.startWithMachine) continue;
        const k = `${value}|${ctx.bonus}|${seq.join(",")}`;
        if (seen.has(k)) continue;
        seen.add(k);
        next.push({ value, bonus: ctx.bonus, seq });
      }
    }
    states = next.slice(0, 12000);
  }

  return null;
}

function getLayoutForElo(value) {
  // Menos espacio desde rangos medios; Diamante+ ya empieza la curva heavy.
  if (value >= 2000) {
    return makeLayout(10, 7, { x: 1, y: 1 }, { x: 8, y: 5 }, 14, true);
  }
  if (value >= 1500) {
    return makeLayout(11, 8, { x: 1, y: 1 }, { x: 9, y: 6 }, 11, true);
  }
  if (value >= 1100) {
    return makeLayout(12, 8, { x: 1, y: 1 }, { x: 10, y: 6 }, 8, true);
  }
  if (value >= 800) {
    return makeLayout(14, 9, { x: 1, y: 1 }, { x: 12, y: 7 }, 5, false);
  }
  if (value >= 550) {
    return makeLayout(15, 9, { x: 1, y: 1 }, { x: 13, y: 7 }, 3, false);
  }
  if (value >= 350) {
    return makeLayout(16, 10, { x: 1, y: 1 }, { x: 14, y: 8 }, 1, false);
  }
  return makeLayout(17, 11, { x: 1, y: 1 }, { x: 15, y: 9 }, 0, false);
}

function makeLayout(w, h, input, output, blockCount, useGate = false) {
  const lPath = buildGuaranteedPath(input, output);
  const pathKeys = new Set(lPath.map(p => `${p.x},${p.y}`));
  const blockedCells = [];
  const forbidden = new Set([`${input.x},${input.y}`, `${output.x},${output.y}`, ...pathKeys]);

  const candidates = [];
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const k = `${x},${y}`;
      if (forbidden.has(k)) continue;
      const distToPath = Math.min(...lPath.map(p => Math.abs(p.x - x) + Math.abs(p.y - y)));
      candidates.push({ x, y, score: distToPath + Math.random() * 1.4 });
    }
  }

  candidates.sort((a, b) => a.score - b.score);
  for (const c of candidates) {
    if (blockedCells.length >= blockCount) break;
    blockedCells.push({ x: c.x, y: c.y });
  }

  const gate = useGate ? lPath[Math.max(2, Math.floor(lPath.length * 0.52))] : null;
  return { w, h, input, output, blockedCells, energyGate: gate ? { x: gate.x, y: gate.y } : null };
}

function buildGuaranteedPath(input, output) {
  const path = [];
  let x = input.x;
  let y = input.y;
  path.push({ x, y });

  while (x !== output.x) {
    x += x < output.x ? 1 : -1;
    path.push({ x, y });
  }

  while (y !== output.y) {
    y += y < output.y ? 1 : -1;
    path.push({ x, y });
  }

  return path;
}

function getUnlockedMachineIds(value) {
  const ids = [...ALL_BASIC];
  for (const id of ALL_ADVANCED) {
    if (value >= PARTS[id].unlockElo) ids.push(id);
  }
  return ids;
}

function getModifiersForElo(value, layout, specialRules = {}, machineLimit = getMachineLimitForElo(value), energyGate = null, minimum = null) {
  const mods = [];

  if (value >= 350) {
    const manhattan = Math.abs(layout.output.x - layout.input.x) + Math.abs(layout.output.y - layout.input.y) + 1;
    const extra = value >= 1500 ? 3 : value >= 1100 ? 4 : value >= 800 ? 5 : 7;
    mods.push({
      type: "maxBelts",
      value: manhattan + extra,
      name: `Máximo ${manhattan + extra} cintas`,
      desc: "El pasillo debe ir más justo: no sobra tanto mapa."
    });
  }

  if (value >= 550 && layout.blockedCells.length) {
    mods.push({
      type: "blockedCells",
      value: layout.blockedCells.length,
      name: `${layout.blockedCells.length} inhibidores activos`,
      desc: "Bloquean zonas cercanas al camino ideal para apretar la ruta."
    });
  }

  if (value >= 800) {
    mods.push({
      type: "maxMachines",
      value: machineLimit,
      name: `Máximo ${machineLimit} máquinas`,
      desc: "El generador del reto también respeta este límite real."
    });
  }

  if (specialRules.startWithMachine) {
    mods.push({
      type: "startWithMachine",
      value: specialRules.startWithMachine,
      name: `Empezar con ${PARTS[specialRules.startWithMachine].name}`,
      desc: "La primera máquina que toca la bolita después del IN debe ser esta."
    });
  }

  if (specialRules.adjacentPair) {
    const [a, b] = specialRules.adjacentPair;
    mods.push({
      type: "adjacentPair",
      value: specialRules.adjacentPair,
      name: `${PARTS[a].name} + ${PARTS[b].name} pegados`,
      desc: "Deben aparecer seguidos en el recorrido, sin otra máquina en el medio."
    });
  }

  if (specialRules.requiredMachines?.length) {
    const required = specialRules.requiredMachines;
    mods.push({
      type: "requiredMachines",
      value: required,
      name: required.length === 1 ? `Usar ${PARTS[required[0]].name}` : `Usar ${required.map(id => PARTS[id].name).join(" + ")}`,
      desc: "Tienen que afectar el recorrido real; no alcanza con ponerlas de adorno."
    });
  }

  if (energyGate) {
    mods.push({
      type: "energyGate",
      value: energyGate,
      name: `Casilla de energía ${energyGate.label || `+${energyGate.value || 0}`}`,
      desc: "Opcional: si la bolita pasa por esa casilla, suma esa energía. No es obligatoria para resolver."
    });
  }

  if (minimum) {
    mods.push({
      type: "minimumMachines",
      value: minimum,
      name: `Solución mínima: ${minimum}`,
      desc: "Resolver cerca de este mínimo da más ELO."
    });
  }

  if (value >= 2000) {
    mods.push({
      type: "tightPath",
      value: true,
      name: "Mapa compacto",
      desc: "Menos espacio, más precisión."
    });
  }

  return mods;
}

function getModifiersForElo(value, layout) {
  const mods = [];

  if (value >= 550) {
    const manhattan = Math.abs(layout.output.x - layout.input.x) + Math.abs(layout.output.y - layout.input.y) + 1;
    const extra = value >= 1500 ? 5 : value >= 1100 ? 7 : 9;
    mods.push({
      type: "maxBelts",
      value: manhattan + extra,
      name: `Máximo ${manhattan + extra} cintas`,
      desc: "El mapa se ajustó para que sea posible."
    });
  }

  if (value >= 800) {
    mods.push({
      type: "blockedCells",
      value: layout.blockedCells.length,
      name: `${layout.blockedCells.length} casillas bloqueadas`,
      desc: "No se puede construir ahí."
    });
  }

  if (value >= 1500) {
    mods.push({
      type: "maxMachines",
      value: 8,
      name: "Máximo 8 máquinas",
      desc: "Elegí bien qué colocar."
    });
  }

  if (value >= 550) {
    const pool = getUnlockedMachineIds(value).filter(id => !["stabilizer"].includes(id));
    const requiredCount = value >= 1500 ? 2 : 1;
    const required = [];

    while (required.length < requiredCount && pool.length > 0) {
      const id = pool.splice(rand(0, pool.length - 1), 1)[0];
      required.push(id);
    }

    if (required.length) {
      mods.push({
        type: "requiredMachines",
        value: required,
        name: required.length === 1 ? `Usar ${PARTS[required[0]].name}` : `Usar ${required.map(id => PARTS[id].name).join(" + ")}`,
        desc: "El reto exige incluir esta máquina en tu fábrica."
      });
    }
  }

  if (value >= 2000) {
    mods.push({
      type: "tightPath",
      value: true,
      name: "Mapa compacto",
      desc: "Menos espacio, más precisión."
    });
  }

  return mods;
}

function getModifier(type) {
  return (currentLevel.modifiers || []).find(m => m.type === type);
}

function countBelts() {
  let count = 0;
  for (let y = 0; y < GRID_H; y++) {
    for (let x = 0; x < GRID_W; x++) {
      if (gridState[y][x].belt) count++;
    }
  }
  return count;
}

function countMachines() {
  let count = 0;
  for (let y = 0; y < GRID_H; y++) {
    for (let x = 0; x < GRID_W; x++) {
      if (gridState[y][x].machine) count++;
    }
  }
  return count;
}


function evaluateSolution(solution, start) {
  let value = start;
  let ctx = { bonus: 0 };
  for (const id of solution) {
    value = PARTS[id].apply(value, ctx);
  }
  return { value, bonus: ctx.bonus, total: value + ctx.bonus };
}

function rand(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function startTutorial(index = 0) {
  currentMode = "tutorial";
  tutorialIndex = index;
  currentLevel = TUTORIALS[tutorialIndex];
  lives = 3;
  tutorialCoachDismissed = false;
  startLevel(currentLevel);
}

function startLevel(level) {
  configureGrid(level);
  gridState = emptyGrid();
  applyBlockedCells(level);
  applyEnergyGates(level);

  selectedTool = "belt";
  cycle = 0;
  total = 0;
  lastOrbValue = 0;
  currentPath = [];
  resetUses = 0;
  running = false;
  stopRequested = false;
  forcedFailureReason = null;
  modal.classList.add("hidden");
  if (currentMode === "tutorial") tutorialCoachDismissed = false;

  applyPrebuild(level.prebuild || "empty");

  showScreen("gameScreen");
  renderGame();
  clearLog();

  addLog(level.message || "Construí una cinta desde IN hasta OUT.");
  saveRun();
}

function applyPrebuild(type) {
  if (type === "line") {
    for (let x = INPUT.x; x <= OUTPUT.x; x++) gridState[INPUT.y][x].belt = true;
    for (let y = INPUT.y; y <= OUTPUT.y; y++) gridState[y][OUTPUT.x].belt = true;
  }
}

function renderGame() {
  updateControlButtons();
  renderTools();
  renderPalette();
  renderGrid();
  renderModifiers();

  const path = findPath();
  currentPath = path || [];

  pathText.textContent = currentPath.length;
  gameStatus.textContent = path ? `Camino listo: ${path.length} casillas` : "Construí un camino de IN a OUT";

  if (currentMode === "tutorial") {
    hudLevel.textContent = currentLevel.name;
    factoryName.textContent = "Tutorial de fábrica";
  } else if (currentMode === "placement") {
    hudLevel.textContent = currentLevel.name;
    factoryName.textContent = "Posicionamiento";
  } else {
    hudLevel.textContent = `${currentLevel.name}`;
    factoryName.textContent = "Ranked";
  }

  hudObjective.textContent = `${currentLevel.target} ENERGÍA / ${currentLevel.cycles} CICLOS`;
  if (quickStartText) quickStartText.textContent = currentLevel.start;
  if (quickCyclesText) quickCyclesText.textContent = currentLevel.cycles;
  if (quickTargetText) quickTargetText.textContent = currentLevel.target;
  if (sampleBtn) sampleBtn.style.display = currentMode === "tutorial" ? "none" : "inline-block";

  updateHud();
  updateTutorialCoach();
}

function renderModifiers() {
  if (!modifierBox) return;

  const rankedLike = currentMode === "infinite" || currentMode === "placement";

  const core = rankedLike
    ? [
        `<div class="modifier-chip core-info"><b>Energía inicial</b><br>${currentLevel.start}</div>`,
        `<div class="modifier-chip core-info"><b>Ciclos</b><br>${currentLevel.cycles}</div>`,
        `<div class="modifier-chip core-info"><b>Mínimo ideal</b><br>${currentLevel.minMachines || currentLevel.generatedSolution?.length || "?"} máquinas</div>`
      ]
    : [];

  if (!rankedLike) {
    modifierBox.innerHTML = `<div class="modifier-chip empty">Tutorial activo.</div>`;
    return;
  }

  const mods = currentLevel.modifiers && currentLevel.modifiers.length
    ? currentLevel.modifiers.map(m => `<div class="modifier-chip ${["requiredMachines", "startWithMachine", "adjacentPair"].includes(m.type) ? "required" : ""}"><b>${m.name}</b><br>${m.desc}</div>`)
    : [`<div class="modifier-chip empty">Sin modificadores especiales.</div>`];

  modifierBox.innerHTML = [...core, ...mods].join("");
}

function renderTools() {
  document.querySelectorAll(".tool-card").forEach(card => {
    card.classList.toggle("selected", card.dataset.tool === selectedTool);
  });
}

function renderPalette() {
  machinePalette.innerHTML = "";

  currentLevel.available.forEach(id => {
    const part = PARTS[id];
    const card = document.createElement("div");
    card.className = "machine-card";
    if (selectedTool === id) card.classList.add("selected");
    card.dataset.tool = id;
    card.innerHTML = `
      <div class="machine-preview">${machineSprite(id)}</div>
      <div>
        <strong>${part.name}</strong>
        <span>${part.desc}</span>
      </div>
    `;

    card.addEventListener("click", () => {
      selectedTool = id;
      renderGame();
    });

    machinePalette.appendChild(card);
  });

  if (currentLevel.available.length === 0) {
    machinePalette.innerHTML = `<div class="empty-machines">Este tutorial todavía no usa máquinas.</div>`;
  }
}

function renderGrid() {
  grid.innerHTML = "";

  for (let y = 0; y < GRID_H; y++) {
    for (let x = 0; x < GRID_W; x++) {
      const state = gridState[y][x];
      const cell = document.createElement("div");
      cell.className = "cell";
      cell.dataset.x = x;
      cell.dataset.y = y;

      const isInput = x === INPUT.x && y === INPUT.y;
      const isOutput = x === OUTPUT.x && y === OUTPUT.y;

      if (state.blocked) cell.classList.add("blocked");
      if (state.gate) {
        cell.classList.add("energy-gate");
        const gateValue = Number(state.gate.value ?? state.gate.bonus ?? 0);
        cell.dataset.gateLabel = `⚡ ${gateValue >= 0 ? "+" : ""}${gateValue}`;
      }
      if (state.belt) cell.classList.add("belt");
      if (state.machine) cell.classList.add("machine-cell");
      if (isInput) {
        cell.classList.add("input");
        cell.innerHTML = `<div class="port-core"></div>`;
      }
      if (isOutput) {
        cell.classList.add("output");
        cell.innerHTML = `<div class="port-core"></div>`;
      }

      if (currentMode === "tutorial" && (isInput || isOutput)) {
        cell.classList.add("tutorial-target");
      }

      if (state.machine && !isInput && !isOutput) {
        cell.innerHTML += `<div class="placed-machine">${machineSprite(state.machine)}</div>`;
      }

      cell.addEventListener("mousedown", () => {
        mouseDown = true;
        applyTool(x, y);
      });

      cell.addEventListener("mouseenter", () => {
        if (mouseDown && (selectedTool === "belt" || selectedTool === "eraser")) {
          applyTool(x, y, true);
        }
      });

      cell.addEventListener("click", () => applyTool(x, y));

      grid.appendChild(cell);
    }
  }

  document.body.onmouseup = () => {
    mouseDown = false;
  };
}

function applyTool(x, y, silent = false) {
  if (running) return;

  const isInput = x === INPUT.x && y === INPUT.y;
  const isOutput = x === OUTPUT.x && y === OUTPUT.y;
  const cell = gridState[y][x];

  if (cell.blocked) {
    if (!silent) addLog("Esa casilla está bloqueada.", "bad");
    return;
  }

  if (selectedTool === "belt") {
    if (!cell.belt) {
      const maxBelts = getModifier("maxBelts");
      if (maxBelts && countBelts() >= maxBelts.value) {
        if (!silent) addLog(`Límite de cintas alcanzado: ${maxBelts.value}.`, "bad");
        return;
      }
    }
    cell.belt = true;
    if (!silent) addLog("Cinta colocada.");
  } else if (selectedTool === "eraser") {
    if (!isInput && !isOutput) {
      if (cell.machine) {
        cell.machine = null;
        if (!silent) addLog("Máquina borrada. La cinta queda puesta.");
      } else if (cell.belt) {
        cell.belt = false;
        if (!silent) addLog("Cinta borrada.");
      } else if (!silent) {
        addLog("La casilla ya está vacía.");
      }
    }
  } else if (PARTS[selectedTool]) {
    if (!isInput && !isOutput) {
      if (!cell.belt) {
        if (!silent) addLog("Primero colocá una cinta: las máquinas ahora solo se apoyan sobre cintas.", "bad");
        return;
      }
      const maxMachines = getModifier("maxMachines");
      if (!cell.machine && maxMachines && countMachines() >= maxMachines.value) {
        if (!silent) addLog(`Límite de máquinas alcanzado: ${maxMachines.value}.`, "bad");
        return;
      }
      const previousMachine = cell.machine;
      cell.machine = selectedTool;
      if (!silent) {
        addLog(`${PARTS[selectedTool].name} colocada.`);
        if (previousMachine !== selectedTool) playSfx("place");
      }
    }
  }

  renderGridOnly();
  saveRun();
}

function renderGridOnly() {
  renderGrid();
  const path = findPath();
  currentPath = path || [];
  pathText.textContent = currentPath.length;
  gameStatus.textContent = path ? `Camino listo: ${path.length} casillas` : "Camino incompleto";
  updateTutorialCoach();
}

function machineSprite(id) {
  const p = PARTS[id];
  return `
    <div class="sprite ${p.className}">
      <div class="pipe-l"></div>
      <div class="pipe-r"></div>
      <div class="body"></div>
      <div class="screen"></div>
      <div class="label">${p.short}</div>
    </div>
  `;
}

function findPath() {
  const startKey = key(INPUT.x, INPUT.y);
  const endKey = key(OUTPUT.x, OUTPUT.y);
  const queue = [{ x: INPUT.x, y: INPUT.y }];
  const visited = new Set([startKey]);
  const parent = new Map();

  while (queue.length) {
    const current = queue.shift();

    if (key(current.x, current.y) === endKey) {
      return rebuildPath(parent, current);
    }

    for (const n of neighbors(current.x, current.y)) {
      if (!inside(n.x, n.y)) continue;
      if (!gridState[n.y][n.x].belt) continue;
      if (gridState[n.y][n.x].blocked) continue;

      const nk = key(n.x, n.y);
      if (visited.has(nk)) continue;

      visited.add(nk);
      parent.set(nk, current);
      queue.push(n);
    }
  }

  return null;
}

function rebuildPath(parent, end) {
  const path = [end];
  let current = end;

  while (!(current.x === INPUT.x && current.y === INPUT.y)) {
    current = parent.get(key(current.x, current.y));
    if (!current) return null;
    path.push(current);
  }

  return path.reverse();
}

function neighbors(x, y) {
  return [
    { x: x + 1, y },
    { x, y: y + 1 },
    { x: x - 1, y },
    { x, y: y - 1 }
  ];
}

function inside(x, y) {
  return x >= 0 && y >= 0 && x < GRID_W && y < GRID_H;
}

function key(x, y) {
  return `${x},${y}`;
}

function clearLog() {
  log.innerHTML = "";
}

function addLog(text, type = "") {
  const line = document.createElement("div");
  line.className = `log-line ${type}`;
  line.textContent = text;
  log.appendChild(line);
  log.scrollTop = log.scrollHeight;
}



function isEliteRank(rank) {
  return ["master", "archon", "loopforger"].includes(rank.key);
}

function spawnMenuParticles() {
  if (!menuParticles) return;
  menuParticles.innerHTML = "";
  const colors = ["rgba(66,255,224,.52)", "rgba(255,79,134,.36)", "rgba(74,163,255,.34)", "rgba(255,179,71,.30)"];
  const count = 28;

  for (let i = 0; i < count; i++) {
    const p = document.createElement("span");
    p.className = "menu-particle";
    const size = 3 + Math.random() * 7;
    p.style.width = `${size}px`;
    p.style.height = `${size}px`;
    p.style.left = `${Math.random() * 100}%`;
    p.style.top = `${10 + Math.random() * 86}%`;
    p.style.background = colors[Math.floor(Math.random() * colors.length)];
    p.style.animationDuration = `${7 + Math.random() * 8}s`;
    p.style.animationDelay = `${-Math.random() * 10}s`;
    menuParticles.appendChild(p);
  }
}

function getRankBadgeSrc(rank) {
  return `assets/ranks/${rank.key}.png`;
}

function getRankInfo(value) {
  return RANKS.find(r => value >= r.min && value <= r.max) || RANKS[0];
}

function updateRankUI() {
  let rank;

  if (currentMode === "tutorial") {
    rank = { name: "Tutorial", cls: "rank-diamond", key: "diamond", min: 0, max: 100 };
  } else if (currentMode === "placement" || !profile.placementComplete) {
    rank = { name: "Unranked", cls: "rank-unranked", key: "unranked", min: 0, max: 5 };
  } else {
    rank = getRankInfo(elo);
  }

  rankCard.className = `rank-card ${rank.cls}`;
  rankName.textContent = rank.name;
  if (hudRankBadge) hudRankBadge.src = getRankBadgeSrc(rank);
  eloText.textContent = currentMode === "tutorial" ? "TUT" : currentMode === "placement" || !profile.placementComplete ? "?" : (rank.key === "loopforger" ? "∞" : elo);

  if (currentMode === "tutorial") {
    rankFill.style.width = "100%";
    rankProgressText.textContent = "aprendizaje";
    return;
  }

  if (currentMode === "placement" || !profile.placementComplete) {
    const done = profile.placementsDone || 0;
    rankFill.style.width = `${Math.min(100, (done / PLACEMENT_MATCHES) * 100)}%`;
    rankProgressText.textContent = `${done}/${PLACEMENT_MATCHES} posicionamiento`;
    return;
  }

  if (rank.key === "loopforger") {
    rankFill.style.width = "0%";
    rankProgressText.textContent = `${elo} ELO`;
    return;
  }

  const span = rank.max - rank.min + 1;
  const inside = Math.max(0, Math.min(span, elo - rank.min));
  const pct = Math.max(4, Math.min(100, Math.floor((inside / span) * 100)));
  rankFill.style.width = `${pct}%`;
  rankProgressText.textContent = `${inside} / ${span}`;
}

function heartMarkup(current, max = 3) {
  return `<span class="lives-display">` +
    Array.from({ length: max }, (_, i) => `<span class="life-heart ${i < current ? "" : "off"}"></span>`).join("") +
    `</span>`;
}

function updateHud(status = null) {
  cycleText.textContent = `${cycle}/${currentLevel.cycles}`;
  totalText.textContent = total;
  lastOrbText.textContent = lastOrbValue;
  diffText.textContent = cycle === 0 ? "-" : total - currentLevel.target;

  if (currentMode === "tutorial") {
    livesText.innerHTML = `<span class="life-heart-label">∞</span>`;
  } else if (currentMode === "placement") {
    const done = profile.placementsDone || 0;
    livesText.innerHTML = `${heartMarkup(lives, 3)}<span class="life-heart-label placement-small"> ${done}/${PLACEMENT_MATCHES}</span>`;
  } else {
    livesText.innerHTML = heartMarkup(lives, 3);
  }

  updateRankUI();
  if (status) gameStatus.textContent = status;
}


function getPlacedMachineSequence(path = findPath()) {
  if (!path) return [];
  const sequence = [];
  for (const pos of path) {
    const id = gridState[pos.y]?.[pos.x]?.machine;
    if (id) sequence.push({ id, x: pos.x, y: pos.y });
  }
  return sequence;
}

function getMissingRequiredMachines(sequence = getPlacedMachineSequence()) {
  const mod = getModifier("requiredMachines");
  if (!mod) return [];

  const placed = new Set(sequence.map(item => item.id));
  return mod.value.filter(id => !placed.has(id));
}

function hasAdjacentPair(sequence, pair) {
  if (!pair) return true;
  for (let i = 0; i < sequence.length - 1; i++) {
    if (sequence[i].id === pair[0] && sequence[i + 1].id === pair[1]) return true;
  }
  return false;
}

function requiredMachinesAreMeaningful(sequence) {
  const mod = getModifier("requiredMachines");
  if (!mod) return true;

  const ids = mod.value || [];
  const hasTrickyInverter = ids.includes("inverter");
  if (hasTrickyInverter) {
    const count = sequence.filter(item => item.id === "inverter").length;
    if (count % 2 === 0) {
      addLog("El Inversor requerido debe afectar el resultado: no puede quedar cancelado por otro inversor.", "bad");
      updateHud("Inversor cancelado");
      return false;
    }
  }

  const full = sequence.map(item => item.id);
  const fullResult = evaluateSolution(full, currentLevel.start).total;
  for (const id of ids) {
    const without = full.filter(machineId => machineId !== id);
    if (without.length && evaluateSolution(without, currentLevel.start).total === fullResult) {
      addLog(`${PARTS[id].name} está puesto, pero no cambia el resultado real. Tiene que importar.`, "bad");
      updateHud("Máquina requerida de adorno");
      return false;
    }
  }

  return true;
}

function pathIncludesEnergyGate(path) {
  // Las casillas de energía son bonus opcionales, no condiciones obligatorias.
  return true;
}

function validateRankedConditions() {
  const path = findPath();
  const sequence = getPlacedMachineSequence(path);
  const rules = currentLevel.specialRules || {};

  if (!pathIncludesEnergyGate(path)) return false;

  const missing = getMissingRequiredMachines(sequence);
  if (missing.length) {
    addLog(`Falta usar en el recorrido: ${missing.map(id => PARTS[id].name).join(", ")}.`, "bad");
    updateHud("Falta máquina requerida");
    return false;
  }

  if (rules.startWithMachine && sequence[0]?.id !== rules.startWithMachine) {
    addLog(`La primera máquina después del IN debe ser ${PARTS[rules.startWithMachine].name}.`, "bad");
    updateHud("Orden obligatorio");
    return false;
  }

  if (rules.adjacentPair && !hasAdjacentPair(sequence, rules.adjacentPair)) {
    const [a, b] = rules.adjacentPair;
    addLog(`${PARTS[a].name} y ${PARTS[b].name} deben ir pegados en el recorrido.`, "bad");
    updateHud("Pareja obligatoria");
    return false;
  }

  return requiredMachinesAreMeaningful(sequence);
}

function getEfficiencyEloBonus() {
  if (!currentLevel || currentMode !== "infinite") return 0;
  const path = findPath();
  const used = getPlacedMachineSequence(path).length;
  const min = currentLevel.minMachines || currentLevel.generatedSolution?.length || used;
  if (!used || !min) return 0;

  const excess = Math.max(0, used - min);
  const tightBonus = Math.max(0, 18 - excess * 4);
  const perfectBonus = used <= min ? 8 : 0;
  return Math.min(26, tightBonus + perfectBonus);
}

function resetCurrentWithLifeCost() {
  if (running) return;

  const rankedLike = currentMode === "infinite" || currentMode === "placement";
  if (rankedLike) {
    if (resetUses >= MAX_RESET_USES || lives <= 1) {
      addLog("No podés reiniciar más esta partida: ya consumiste las 2 vidas permitidas.", "bad");
      updateHud("Sin reinicios");
      return;
    }
    resetUses++;
    lives--;
    playSfx("hurt");
    addLog(`Reiniciar costó 1 vida. Reinicios usados: ${resetUses}/${MAX_RESET_USES}.`, "bad");
  }

  resetCurrent();
}

async function runFull() {
  if (running) return;

  if (!validateRankedConditions()) return;

  const path = findPath();
  if (!path) {
    addLog("No hay camino válido de IN a OUT.", "bad");
    updateHud("Camino incompleto");
    return;
  }

  resetCountersForRun();
  currentPath = path;
  running = true;
  stopRequested = false;
  forcedFailureReason = null;
  updateControlButtons();
  updateHud("Simulando...");

  while (cycle < currentLevel.cycles && !stopRequested) {
    await runCycle(path);
    if (!stopRequested) await waitScaled(160);
  }

  running = false;
  updateControlButtons();

  if (stopRequested) {
    stopRequested = false;
    if (forcedFailureReason) {
      addLog(forcedFailureReason, "bad");
      forcedFailureReason = null;
      finishLevel();
      return;
    }
    updateHud("Simulación detenida");
    addLog("Simulación detenida por el jugador.", "bad");
    saveRun();
    return;
  }

  finishLevel();
}

async function runStep() {
  if (running) return;

  if (!validateRankedConditions()) return;

  const path = findPath();
  if (!path) {
    addLog("No hay camino válido de IN a OUT.", "bad");
    updateHud("Camino incompleto");
    return;
  }

  if (cycle >= currentLevel.cycles) {
    finishLevel();
    return;
  }

  running = true;
  stopRequested = false;
  currentPath = path;
  updateControlButtons();
  updateHud("Simulando 1 ciclo...");
  await runCycle(path);
  running = false;
  updateControlButtons();

  if (cycle >= currentLevel.cycles) finishLevel();
  else {
    updateHud("Esperando próximo ciclo");
    saveRun();
  }
}

function resetCountersForRun() {
  cycle = 0;
  total = 0;
  lastOrbValue = 0;
  clearLog();
  updateHud("Simulación reiniciada");
}

async function runCycle(path) {
  cycle++;
  let value = currentLevel.start;
  let ctx = { bonus: 0 };

  addLog(`--- Ciclo ${cycle} ---`);
  addLog(`Bolita creada con valor ${value}`);

  const orb = createOrb(value);

  for (let i = 0; i < path.length; i++) {
    if (stopRequested) break;

    const pos = path[i];
    const cell = gridState[pos.y][pos.x];

    await moveOrbToCell(orb, pos.x, pos.y, value + ctx.bonus);
    activateCell(pos.x, pos.y);

    if (cell.gate) {
      const gateBonus = Number(cell.gate.value ?? cell.gate.bonus ?? 0);
      if (gateBonus) {
        const beforeGate = value;
        value += gateBonus;
        orb.textContent = value + ctx.bonus;
        orb.classList.add("hit");
        setTimeout(() => orb.classList.remove("hit"), 120);
        addLog(`Casilla de energía: ${beforeGate} ${gateBonus >= 0 ? "+" : ""}${gateBonus} = ${value}`);
        await waitScaled(120);
      }
    }

    if (cell.machine) {
      const machine = PARTS[cell.machine];
      const before = value;
      value = machine.apply(value, ctx);
      orb.textContent = value + ctx.bonus;
      orb.classList.add("hit");
      setTimeout(() => orb.classList.remove("hit"), 120);
      addLog(`${machine.name}: ${machine.log(before, value)}`);
      await waitScaled(140);
    }

    clearActiveCells();
  }

  lastOrbValue = value + ctx.bonus;
  total += value + ctx.bonus;
  orb.textContent = value + ctx.bonus;

  if (ctx.bonus) addLog(`Bonus de banco: +${ctx.bonus} al total`);

  addLog(`Salida real: ${value + ctx.bonus}. Total acumulado: ${total}`);
  updateHud("Simulando...");
  animateScoreToTotal(value + ctx.bonus, orb);
  await waitScaled(260);
  orb.remove();
}

function animateScoreToTotal(value, orb) {
  if (!orb || !scoreFlyLayer) return;

  const from = orb.getBoundingClientRect();
  const to = totalText.getBoundingClientRect();

  const fly = document.createElement("div");
  fly.className = "score-fly";
  fly.textContent = `${value >= 0 ? "+" : ""}${value}`;
  fly.style.left = `${from.left + from.width / 2}px`;
  fly.style.top = `${from.top + from.height / 2}px`;
  scoreFlyLayer.appendChild(fly);

  requestAnimationFrame(() => {
    fly.style.left = `${to.left + to.width / 2}px`;
    fly.style.top = `${to.top + to.height / 2}px`;
    fly.classList.add("arrive");
  });

  totalText.classList.remove("total-pop");
  void totalText.offsetWidth;
  setTimeout(() => totalText.classList.add("total-pop"), 520);

  setTimeout(() => fly.remove(), 900);
}

function createOrb(value) {
  const orb = document.createElement("div");
  orb.className = "energy-orb";
  orb.textContent = value;
  energyLayer.appendChild(orb);
  return orb;
}

function moveOrbToCell(orb, x, y, value) {
  orb.style.left = `${x * CELL + CELL / 2}px`;
  orb.style.top = `${y * CELL + CELL / 2}px`;
  orb.textContent = value;
  return waitScaled(155);
}

function activateCell(x, y) {
  document.querySelectorAll(".cell").forEach(cell => cell.classList.remove("active"));
  const cell = document.querySelector(`.cell[data-x="${x}"][data-y="${y}"]`);
  if (cell) cell.classList.add("active");
}

function clearActiveCells() {
  document.querySelectorAll(".cell").forEach(cell => cell.classList.remove("active"));
}


function setModalActions(primaryText, options = {}) {
  const secondaryText = options.secondaryText || "REINTENTAR";
  const showSecondary = !!options.showSecondary;

  modalNextBtn.textContent = primaryText;
  modalNextBtn.style.display = "block";
  modalRetryBtn.textContent = secondaryText;
  modalRetryBtn.style.display = showSecondary ? "block" : "none";

  const buttons = modal.querySelector(".modal-buttons");
  if (buttons) buttons.classList.toggle("single-action", !showSecondary);
}

function resetModalActions() {
  const buttons = modal.querySelector(".modal-buttons");
  if (buttons) buttons.classList.remove("single-action");
  modalRetryBtn.style.display = "block";
  modalRetryBtn.textContent = "REINTENTAR";
}

function finishLevel() {
  const diff = total - currentLevel.target;

  if (diff === 0) {
    playSfx("complete");
    addLog(`OBJETIVO CUMPLIDO: ${total}`, "good");
    recordRankedResult(true);

    if (currentMode === "tutorial") {
      tutorialDone.add(tutorialIndex);
      saveProfile();

      modalTitle.textContent = tutorialIndex < TUTORIALS.length - 1
        ? "⚡ TUTORIAL COMPLETADO"
        : "🎓 TUTORIAL FINALIZADO";
      modalText.textContent = tutorialIndex < TUTORIALS.length - 1
        ? "Perfecto. Pasemos a la siguiente parte del tutorial."
        : "Ya completaste el tutorial. Podés volver al menú o probar tu ingenio en ranked.";
      setModalActions(
        tutorialIndex < TUTORIALS.length - 1 ? "SIGUIENTE" : "PROBAR TU INGENIO",
        {
          showSecondary: true,
          secondaryText: tutorialIndex < TUTORIALS.length - 1 ? "REINTENTAR" : "VOLVER AL MENÚ"
        }
      );
    } else if (currentMode === "placement") {
      const order = ensurePlacementOrder();
      profile.placementResults.push({ probe: order[profile.placementsDone] || elo, win: true });
      profile.placementsDone = (profile.placementsDone || 0) + 1;
      saveProfile();
      clearSavedRun();

      if (profile.placementsDone >= PLACEMENT_MATCHES) {
        profile.placementComplete = true;
        elo = calculatePlacementElo();
        profile.elo = elo;
        profile.bestElo = Math.max(profile.bestElo || 100, elo);
        profile.lossStreak = 0;
        saveProfile();

        modalTitle.textContent = "🏁 POSICIONAMIENTO COMPLETO";
        modalText.textContent = `Ganaste tu última partida de posicionamiento. Tu rango inicial quedó definido con ${elo} ELO. El posicionamiento tiene techo en Oro; los rangos altos se ganan en ranked.`;
        setModalActions("ENTRAR A RANKED", { showSecondary: true, secondaryText: "VOLVER AL MENÚ" });
      } else {
        modalTitle.textContent = "⚡ PARTIDA DE POSICIONAMIENTO GANADA";
        modalText.textContent = `Completaste la partida ${profile.placementsDone}/5. Todavía faltan ${PLACEMENT_MATCHES - profile.placementsDone}.`;
        setModalActions("SIGUIENTE PARTIDA");
      }
    } else {
      const oldElo = elo;
      const efficiencyBonus = getEfficiencyEloBonus();
      const streakBonus = Math.min(STREAK_ELO_CAP, streak * 4);
      const gain = 24 + Math.floor(elo / 120) + streakBonus + efficiencyBonus;
      elo += gain;
      streak++;
      challengeNumber++;
      profile.elo = elo;
      profile.bestElo = Math.max(profile.bestElo || 100, elo);
      profile.lossStreak = 0;
      saveProfile();
      clearSavedRun();

      const oldRank = getRankInfo(oldElo);
      const newRank = getRankInfo(elo);
      if (oldRank.key !== newRank.key) {
        pendingRankUps.push({ oldRank, newRank, elo });
      }

      const newlyUnlocked = getNewUnlocks(oldElo, elo);
      pendingUnlocks.push(...newlyUnlocked);

      modalTitle.textContent = oldRank.key !== newRank.key ? "🏆 RANGO ASCENDIDO" : "⚡ ELO AUMENTADO";
      modalText.textContent = `Reto superado. Ganaste +${gain} ELO (${efficiencyBonus > 0 ? `+${efficiencyBonus} por eficiencia, ` : ""}racha limitada a +${streakBonus}). Nuevo ELO: ${elo}.`;
      setModalActions("SIGUIENTE RETO");
    }

    updateHud("Sistema perfecto");
    modal.classList.remove("hidden");
    renderTutorialMenu();
  } else {
    addLog(`FALLÓ: ${total}/${currentLevel.target}. Diferencia: ${diff}`, "bad");
    recordRankedResult(false);

    if (currentMode === "placement") {
      lives--;
      playSfx(lives > 0 ? "hurt" : "death");
      if (lives > 0) {
        saveRun();
        modalTitle.textContent = "⚠ VIDA PERDIDA";
        modalText.textContent = `Terminaste en ${total}. Objetivo: ${currentLevel.target}. Te quedan ${lives} vidas para esta partida de posicionamiento.`;
        setModalActions("REINTENTAR PARTIDA");
      } else {
        const order = ensurePlacementOrder();
        profile.placementResults.push({ probe: order[profile.placementsDone] || elo, win: false });
        profile.placementsDone = (profile.placementsDone || 0) + 1;
        saveProfile();
        clearSavedRun();

        if (profile.placementsDone >= PLACEMENT_MATCHES) {
          profile.placementComplete = true;
          elo = calculatePlacementElo();
          profile.elo = elo;
          profile.bestElo = Math.max(profile.bestElo || 100, elo);
          profile.lossStreak = 0;
          saveProfile();

          modalTitle.textContent = "🏁 POSICIONAMIENTO COMPLETO";
          modalText.textContent = `Terminaste tus ${PLACEMENT_MATCHES} partidas de posicionamiento. Tu ELO inicial quedó en ${elo}.`;
          setModalActions("ENTRAR A RANKED", { showSecondary: true, secondaryText: "VOLVER AL MENÚ" });
        } else {
          modalTitle.textContent = "⚠ PARTIDA DE POSICIONAMIENTO PERDIDA";
          modalText.textContent = `Perdiste esta partida. Vas ${profile.placementsDone}/${PLACEMENT_MATCHES}. Seguimos con la siguiente.`;
          setModalActions("SIGUIENTE PARTIDA");
        }
      }
    } else if (currentMode === "infinite") {
      lives--;
      playSfx(lives > 0 ? "hurt" : "death");
      streak = 0;
      saveRun();

      modalTitle.textContent = lives > 0 ? "⚠ VIDA PERDIDA" : "☠ RUN TERMINADA";
      modalText.textContent = lives > 0
        ? `Terminaste en ${total}. Objetivo: ${currentLevel.target}. Te quedan ${lives} vidas.`
        : endRunAndLoseElo();
      setModalActions(lives > 0 ? "REINTENTAR RETO" : "VOLVER AL MENÚ");
    } else {
      modalTitle.textContent = "⚠ INTENTALO DE NUEVO";
      modalText.textContent = `Terminaste en ${total}. Objetivo: ${currentLevel.target}. Probá otro orden o agregá máquinas.`;
      modalNextBtn.style.display = "none";
      modalRetryBtn.style.display = "block";
      const buttons = modal.querySelector(".modal-buttons");
      if (buttons) buttons.classList.remove("single-action");
    }

    updateHud(diff > 0 ? "Exceso de energía" : "Energía insuficiente");
    modal.classList.remove("hidden");
  }
}

function endRunAndLoseElo() {
  profile.lossStreak = (profile.lossStreak || 0) + 1;
  const lossPct = 0.06 + (profile.lossStreak - 1) * 0.025;
  const loss = Math.max(10, Math.floor(elo * lossPct));
  const old = elo;
  elo = Math.max(100, elo - loss);
  profile.elo = elo;
  saveProfile();
  clearSavedRun();

  return `Te quedaste sin vidas. Bajaste ${old - elo} ELO. Racha de derrotas: ${profile.lossStreak}. Nuevo ELO: ${elo}.`;
}

function getNewUnlocks(oldElo, newElo) {
  const out = [];
  for (const id of Object.keys(PARTS)) {
    const p = PARTS[id];
    if (p.unlockElo && oldElo < p.unlockElo && newElo >= p.unlockElo) {
      if (!profile.seenUnlocks.includes(id)) {
        profile.seenUnlocks.push(id);
        out.push(id);
      }
    }
  }
  saveProfile();
  return out;
}

function showNextRankUpIfAny(callback) {
  if (pendingRankUps.length === 0) {
    callback?.();
    return;
  }

  const data = pendingRankUps.shift();
  if (rankUpBadge) rankUpBadge.src = getRankBadgeSrc(data.newRank);
  if (rankUpTitle) rankUpTitle.textContent = `${data.oldRank.name} → ${data.newRank.name}`;
  if (rankUpText) rankUpText.textContent = `Ascendiste a ${data.newRank.name}. Nuevo ELO: ${data.elo}.`;

  playSfx("rankup");
  rankUpModal.classList.remove("hidden");

  rankUpContinueBtn.onclick = () => {
    rankUpModal.classList.add("hidden");
    showNextRankUpIfAny(callback);
  };
}

function showNextUnlockIfAny(callback) {
  if (pendingUnlocks.length === 0) {
    callback?.();
    return;
  }

  const id = pendingUnlocks.shift();
  const p = PARTS[id];

  unlockMachineSprite.innerHTML = machineSprite(id);
  unlockMachineName.textContent = p.name;
  unlockMachineText.textContent = `${p.desc} Se desbloquea desde ${p.unlockElo} ELO.`;
  unlockModal.classList.remove("hidden");

  unlockCloseBtn.onclick = () => {
    unlockModal.classList.add("hidden");
    showNextUnlockIfAny(callback);
  };
}

function resetCurrent() {
  if (running) return;
  cycle = 0;
  total = 0;
  lastOrbValue = 0;
  clearLog();
  updateHud("Reiniciado");
  addLog("Contadores reiniciados. La fábrica sigue armada.");
  saveRun();
}

function clearFactory() {
  if (running) return;
  gridState = emptyGrid();
  applyBlockedCells(currentLevel);
  applyEnergyGates(currentLevel);
  resetCurrent();
  renderGame();
  addLog("Fábrica vaciada.");
  saveRun();
}

function buildSample() {
  if (running) return;
  gridState = emptyGrid();
  applyBlockedCells(currentLevel);
  applyEnergyGates(currentLevel);

  let x = INPUT.x;
  let y = INPUT.y;
  gridState[y][x].belt = true;

  while (x !== OUTPUT.x) {
    x += x < OUTPUT.x ? 1 : -1;
    if (!gridState[y][x].blocked) gridState[y][x].belt = true;
  }

  while (y !== OUTPUT.y) {
    y += y < OUTPUT.y ? 1 : -1;
    if (!gridState[y][x].blocked) gridState[y][x].belt = true;
  }

  const path = findPath();
  if (path) {
    const machines = currentLevel.available.slice(0, 5);
    machines.forEach((id, i) => {
      const pos = path[2 + i * 2];
      if (pos && !(pos.x === INPUT.x && pos.y === INPUT.y) && !(pos.x === OUTPUT.x && pos.y === OUTPUT.y)) {
        gridState[pos.y][pos.x].machine = id;
      }
    });
  }

  resetCurrent();
  renderGame();
  addLog("Ejemplo cargado. Modificalo para resolver el objetivo.");
  saveRun();
}

function requestStop() {
  if (!running) return;
  stopRequested = true;
  updateHud("Deteniendo...");
}

function cycleSpeed() {
  const speeds = [1, 2, 4];
  speedIndex = (speedIndex + 1) % speeds.length;
  speedMultiplier = speeds[speedIndex];
  speedBtn.textContent = `VEL x${speedMultiplier}`;
  addLog(`Velocidad de simulación: x${speedMultiplier}.`);
}

function updateControlButtons() {
  if (!runBtn || !stopBtn || !resetBtn || !clearBtn) return;

  runBtn.disabled = running;
  if (stepBtn) stepBtn.disabled = running;
  resetBtn.disabled = running;
  clearBtn.disabled = running;
  if (sampleBtn) sampleBtn.disabled = running;
  stopBtn.disabled = !running;
}

function wait(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function waitScaled(ms) {
  return wait(Math.max(25, Math.floor(ms / speedMultiplier)));
}

function getTutorialState() {
  const path = findPath();
  const machines = [];

  for (let y = 0; y < GRID_H; y++) {
    for (let x = 0; x < GRID_W; x++) {
      if (gridState[y][x].machine) machines.push(gridState[y][x].machine);
    }
  }

  return { path, machines };
}

function updateTutorialCoach() {
  if (currentMode !== "tutorial" || tutorialCoachDismissed) {
    tutorialCoach.classList.add("hidden");
    return;
  }

  const wasHidden = tutorialCoach.classList.contains("hidden");
  tutorialCoach.classList.remove("hidden");
  if (wasHidden) playSfx("popup");

  const tut = currentLevel;
  const state = getTutorialState();
  const req = tut.required || {};
  const steps = [];

  if (req.path) {
    steps.push({
      text: state.path ? "Camino conectado de IN a OUT." : "Construí una cinta continua desde IN hasta OUT.",
      done: !!state.path
    });
  }

  if (req.machine) {
    steps.push({
      text: state.machines.includes(req.machine)
        ? `${PARTS[req.machine].name} colocado.`
        : `Colocá un ${PARTS[req.machine].name} sobre la cinta.`,
      done: state.machines.includes(req.machine)
    });
  }

  if (req.machines) {
    req.machines.forEach(id => {
      steps.push({
        text: state.machines.includes(id)
          ? `${PARTS[id].name} colocado.`
          : `Colocá ${PARTS[id].name} sobre la cinta.`,
        done: state.machines.includes(id)
      });
    });
  }

  steps.push({
    text: "Cuando los pasos estén listos, tocá SIMULAR.",
    done: steps.length > 0 && steps.every(s => s.done)
  });

  coachTitle.textContent = tut.title.replace("Tutorial ", "");
  coachText.textContent = tut.message || tut.description;
  coachSteps.innerHTML = steps
    .map(step => `<div class="coach-step ${step.done ? "done" : ""}">${step.text}</div>`)
    .join("");
}

function renderTutorialMenu() {
  tutorialList.innerHTML = "";

  TUTORIALS.forEach((tut, index) => {
    const item = document.createElement("div");
    item.className = "tutorial-item";
    if (index === tutorialIndex) item.classList.add("active");
    if (tutorialDone.has(index)) item.classList.add("done");

    item.innerHTML = `
      <strong>${tutorialDone.has(index) ? "✓ " : ""}${tut.name}</strong>
      <span>${tut.short}</span>
    `;

    item.addEventListener("click", () => {
      tutorialIndex = index;
      renderTutorialMenu();
    });

    tutorialList.appendChild(item);
  });

  const tut = TUTORIALS[tutorialIndex];
  tutorialTitle.textContent = tut.title;
  tutorialDescription.textContent = tut.description;
  tutorialGoals.innerHTML = tut.goals.map(goal => `<div class="tutorial-goal">${goal}</div>`).join("");
}

function renderRanksMenu() {
  ranksList.innerHTML = RANKS.map((r, index) => {
    const rangeText = r.max > 90000 ? `${r.min}+` : `${r.min}-${r.max}`;
    const label = r.name === "Loopforger"
      ? "Rango final"
      : index < RANKS.length - 1
        ? `Hacia ${RANKS[index + 1].name}`
        : "Final";

    return `
      <div class="rank-row ${r.cls} ${isEliteRank(r) ? "elite-rank" : ""}">
        <img class="rank-badge-thumb" src="${getRankBadgeSrc(r)}" alt="${r.name}">
        <strong>
          <span>${r.name}</span>
          <span>${rangeText}</span>
        </strong>
        <span>${label}</span>
      </div>
    `;
  }).join("");
}

document.querySelectorAll(".tool-card").forEach(card => {
  card.addEventListener("click", () => {
    selectedTool = card.dataset.tool;
    renderGame();
  });
});

playBtn.addEventListener("click", () => {
  unlockAudio();
  startInfiniteRun();
});

optionsBtn.addEventListener("click", () => {
  unlockAudio();
  openOptions();
});

tutorialBtn.addEventListener("click", () => {
  unlockAudio();
  tutorialIndex = 0;
  renderTutorialMenu();
  showScreen("tutorialMenu");
});

ranksBtn.addEventListener("click", () => {
  unlockAudio();
  renderRanksMenu();
  showScreen("ranksMenu");
});

accountBtn.addEventListener("click", () => {
  unlockAudio();
  renderAccountMenu();
  showScreen("accountMenu");
});

leaderboardBtn.addEventListener("click", () => {
  unlockAudio();
  renderLeaderboardMenu();
  showScreen("leaderboardMenu");
});

startTutorialBtn.addEventListener("click", () => {
  unlockAudio();
  startTutorial(tutorialIndex);
});
backToMenuBtn.addEventListener("click", () => showScreen("mainMenu"));

document.querySelectorAll("[data-screen]").forEach(btn => {
  btn.addEventListener("click", () => {
    unlockAudio();
    showScreen(btn.dataset.screen);
  });
});

optionsCloseBtn.addEventListener("click", closeOptions);
resumeBtn.addEventListener("click", closeOptions);
optionsMenuBtn.addEventListener("click", goToMainMenuFromOptions);
menuMusicToggle.addEventListener("click", toggleMenuMusic);
gameMusicToggle.addEventListener("click", toggleGameMusic);

volumeSlider.addEventListener("input", () => {
  audioSettings.volume = Number(volumeSlider.value) / 100;
  saveAudioSettings();
  updateMusicForScreen();
});

document.addEventListener("click", (event) => {
  if (event.target.closest("button")) playSfx("button");
});

document.addEventListener("pointerdown", unlockAudio, { once: true });

document.addEventListener("keydown", (event) => {
  if (event.key !== "Escape") return;

  // En el menú principal, Escape no abre nada.
  // Si Opciones ya está abierto, sí permite cerrarlo.
  if (currentScreenId === "mainMenu" && optionsModal.classList.contains("hidden")) {
    return;
  }

  event.preventDefault();
  unlockAudio();

  if (!optionsModal.classList.contains("hidden")) {
    closeOptions();
    return;
  }

  openOptions();
});

runBtn.addEventListener("click", runFull);
stopBtn.addEventListener("click", requestStop);
speedBtn.addEventListener("click", cycleSpeed);
if (stepBtn) stepBtn.addEventListener("click", runStep);
resetBtn.addEventListener("click", resetCurrentWithLifeCost);
clearBtn.addEventListener("click", clearFactory);
if (sampleBtn) sampleBtn.addEventListener("click", buildSample);

coachCloseBtn.addEventListener("click", () => {
  tutorialCoachDismissed = true;
  updateTutorialCoach();
});

modalRetryBtn.addEventListener("click", () => {
  modal.classList.add("hidden");

  if (currentMode === "tutorial" && tutorialIndex >= TUTORIALS.length - 1 && tutorialDone.has(tutorialIndex)) {
    modalRetryBtn.textContent = "REINTENTAR";
    showScreen("mainMenu");
    return;
  }

  if (currentMode === "placement" && profile.placementComplete) {
    showScreen("mainMenu");
    return;
  }

  modalRetryBtn.style.display = "block";
  modalRetryBtn.textContent = "REINTENTAR";
  resetCurrent();
});

modalNextBtn.addEventListener("click", () => {
  modal.classList.add("hidden");
  resetModalActions();

  if (currentMode === "tutorial") {
    if (tutorialIndex < TUTORIALS.length - 1) {
      tutorialIndex++;
      startTutorial(tutorialIndex);
    } else {
      startInfiniteRun();
    }
    return;
  }

  if (currentMode === "placement") {
    if (profile.placementComplete) {
      currentMode = "infinite";
      startInfiniteRun();
    } else {
      startPlacementMatch();
    }
    return;
  }

  if (lives <= 0) {
    showScreen("mainMenu");
    return;
  }

  if (modalNextBtn.textContent === "REINTENTAR RETO") {
    resetCurrent();
    return;
  }

  showNextRankUpIfAny(() => {
    showNextUnlockIfAny(() => {
      currentLevel = generateInfiniteLevel();
      startLevel(currentLevel);
    });
  });
});

window.addEventListener("beforeunload", () => {
  saveRun();
  saveProfile();
});

spawnMenuParticles();
renderTutorialMenu();
updateControlButtons();
updateMusicForScreen();
saveProfile();
fetchCurrentUser();
