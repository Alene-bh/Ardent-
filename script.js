const canvas = document.getElementById("gameCanvas");
const ctx = canvas.getContext("2d");

// Tamaño lógico del juego: NO cambia gameplay, colisiones, rangos ni posiciones.
// El canvas ahora renderiza a la resolución REAL en pantalla para evitar el efecto
// de imagen agrandada/borrosa en monitores grandes.
const GAME_WIDTH = 900;
const GAME_HEIGHT = 450;
// Modo Fortaleza: mundo grande con cámara, construcción libre y minimapa.
const WORLD_WIDTH = 3400;
const WORLD_HEIGHT = 2300;
const BUILD_GRID_SIZE = 25;
const TOWER_COLLISION_RADIUS = 26;
const BARRICADE_LENGTH = 110;
const BARRICADE_THICKNESS = 24;
const BASE_RADIUS = 34;
const PLAYER_SURVIVAL_SPEED = 1.75;
const ENEMY_SURVIVAL_SPEED_MULTIPLIER = 0.72;
let camera = { x: 0, y: 0 };
let baseCore = null;
let basePlaced = false;
let pendingBasePlacement = false;
let pendingBarricadePlacement = null;
let barricadeBuildOrientation = "horizontal";
let canvasPixelRatio = 1;

function resizeCanvasForDisplay() {
    const dpr = Math.max(1, Math.min(window.devicePixelRatio || 1, 2.5));
    canvasPixelRatio = dpr;

    // Usamos el tamaño CSS real del canvas, no el tamaño lógico fijo.
    // Así, si el canvas se ve grande en pantalla, también tiene más píxeles internos.
    const cssWidth = Math.max(1, Math.round(canvas.clientWidth || GAME_WIDTH));
    const cssHeight = Math.max(1, Math.round(canvas.clientHeight || GAME_HEIGHT));

    const displayWidth = Math.round(cssWidth * dpr);
    const displayHeight = Math.round(cssHeight * dpr);

    if (canvas.width !== displayWidth || canvas.height !== displayHeight) {
        canvas.width = displayWidth;
        canvas.height = displayHeight;
    }

    // Todo el juego sigue dibujando en coordenadas 900x450.
    // Solo escalamos el dibujo a la resolución real del canvas.
    ctx.setTransform(displayWidth / GAME_WIDTH, 0, 0, displayHeight / GAME_HEIGHT, 0, 0);
    ctx.imageSmoothingEnabled = true;
    ctx.textRendering = "geometricPrecision";
}

resizeCanvasForDisplay();
window.addEventListener("resize", resizeCanvasForDisplay);

const sounds = {
    music: new Audio("assets/audio/battle-theme.mp3"),
    shoot: "assets/audio/shoot.mp3",
    hit: "assets/audio/hit.mp3"
};

sounds.music.loop = true;

let soundEnabled = false;

let audioSettings = {
    musicEnabled: localStorage.getItem("tdMusicEnabled") !== "false",
    sfxEnabled: localStorage.getItem("tdSfxEnabled") !== "false",
    musicVolume: Number(localStorage.getItem("tdMusicVolume")) || 0.28,
    sfxVolume: Number(localStorage.getItem("tdSfxVolume")) || 0.28
};

const defaultControlBindings = {
    moveUp: "KeyW",
    moveDown: "KeyS",
    moveLeft: "KeyA",
    moveRight: "KeyD",
    bomb: "Digit1",
    freeze: "Digit2",
    tsunami: "Digit3",
    lightning: "Digit4",
    meteor: "Digit5",
    eclipse: "Digit6"
};

function loadControlBindings() {
    try {
        const saved = JSON.parse(localStorage.getItem("tdControlBindings") || "{}");
        return { ...defaultControlBindings, ...saved };
    } catch (error) {
        return { ...defaultControlBindings };
    }
}

let controlBindings = loadControlBindings();
let listeningForControl = null;
const pressedKeys = new Set();

function saveControlBindings() {
    localStorage.setItem("tdControlBindings", JSON.stringify(controlBindings));
}

function codeToLabel(code) {
    if (!code) return "?";
    if (code.startsWith("Key")) return code.replace("Key", "");
    if (code.startsWith("Digit")) return code.replace("Digit", "");
    if (code.startsWith("Numpad")) return `Num ${code.replace("Numpad", "")}`;
    if (code.startsWith("Arrow")) return `Flecha ${code.replace("Arrow", "")}`;
    if (code === "Space") return "Space";
    if (code === "ShiftLeft" || code === "ShiftRight") return "Shift";
    if (code === "ControlLeft" || code === "ControlRight") return "Ctrl";
    if (code === "AltLeft" || code === "AltRight") return "Alt";
    return code;
}

function getAbilityIdByCode(code) {
    return ["bomb", "freeze", "tsunami", "lightning", "meteor", "eclipse"].find(id => controlBindings[id] === code) || null;
}

function isControlCode(code) {
    return Object.values(controlBindings).includes(code);
}

function applyControlsToAbilities() {
    if (!abilities) return;

    ["bomb", "freeze", "tsunami", "lightning", "meteor", "eclipse"].forEach(id => {
        if (abilities[id]) abilities[id].key = codeToLabel(controlBindings[id]);
    });
}

function updateControlsUI() {
    document.querySelectorAll(".controlKeyButton").forEach(button => {
        const action = button.dataset.control;
        button.textContent = listeningForControl === action ? "Presioná..." : codeToLabel(controlBindings[action]);
        button.classList.toggle("listening", listeningForControl === action);
    });

    const keyTexts = {
        bomb: document.getElementById("bombKeyText"),
        freeze: document.getElementById("freezeKeyText"),
        tsunami: document.getElementById("tsunamiKeyText"),
        lightning: document.getElementById("lightningKeyText"),
        meteor: document.getElementById("meteorKeyText"),
        eclipse: document.getElementById("eclipseKeyText")
    };

    Object.keys(keyTexts).forEach(id => {
        if (keyTexts[id]) keyTexts[id].textContent = codeToLabel(controlBindings[id]);
    });

    applyControlsToAbilities();
}

function setControlBinding(action, newCode) {
    const oldCode = controlBindings[action];
    const existingAction = Object.keys(controlBindings).find(key => key !== action && controlBindings[key] === newCode);

    controlBindings[action] = newCode;

    if (existingAction) {
        controlBindings[existingAction] = oldCode;
    }

    saveControlBindings();
    updateControlsUI();
    updateHud();
}

function resetControlBindings() {
    controlBindings = { ...defaultControlBindings };
    listeningForControl = null;
    saveControlBindings();
    pressedKeys.clear();
    isSpaceDown = false;
    isShiftDown = false;
    updateControlsUI();
    updateHud();
}

function getGameTime() {
    return gameTime;
}

function enableSound() {
    soundEnabled = true;
}

function saveAudioSettings() {
    localStorage.setItem("tdMusicEnabled", audioSettings.musicEnabled);
    localStorage.setItem("tdSfxEnabled", audioSettings.sfxEnabled);
    localStorage.setItem("tdMusicVolume", audioSettings.musicVolume);
    localStorage.setItem("tdSfxVolume", audioSettings.sfxVolume);
}

function applyAudioSettingsToUI() {
    menuMusicToggle.checked = audioSettings.musicEnabled;
    pauseMusicToggle.checked = audioSettings.musicEnabled;

    menuSfxToggle.checked = audioSettings.sfxEnabled;
    pauseSfxToggle.checked = audioSettings.sfxEnabled;

    menuMusicVolume.value = audioSettings.musicVolume;
    pauseMusicVolume.value = audioSettings.musicVolume;

    menuSfxVolume.value = audioSettings.sfxVolume;
    pauseSfxVolume.value = audioSettings.sfxVolume;

    sounds.music.volume = audioSettings.musicEnabled ? audioSettings.musicVolume : 0;

    syncMusicState();
}

function shouldMusicBePlaying() {
    return (
        soundEnabled &&
        audioSettings.musicEnabled &&
        gameStarted &&
        gameRunning &&
        waveInProgress &&
        !isPaused &&
        !document.hidden
    );
}

function syncMusicState() {
    sounds.music.volume = audioSettings.musicEnabled ? audioSettings.musicVolume : 0;

    if (shouldMusicBePlaying()) {
        sounds.music.play().catch(error => {
            console.log("Music error:", error);
        });
    } else {
        sounds.music.pause();
    }
}

function stopMusicAndReset() {
    sounds.music.pause();
    sounds.music.currentTime = 0;
}

function playSfx(src, baseVolume = 1) {
    if (!soundEnabled) return;
    if (!audioSettings.sfxEnabled) return;

    const sfx = new Audio(src);
    sfx.volume = audioSettings.sfxVolume * baseVolume;

    sfx.play().catch(error => {
        console.log("SFX error:", error);
    });
}

function playShootSound() {
    playSfx(sounds.shoot, 0.75);
}

function playHitSound() {
    playSfx(sounds.hit, 0.9);
}

const menu = document.getElementById("menu");
const gameArea = document.getElementById("gameArea");
const startGameBtn = document.getElementById("startGameBtn");
const playerNameInput = document.getElementById("playerNameInput");

const waveText = document.getElementById("waveText");
const hpText = document.getElementById("hpText");
const barricadeText = document.getElementById("barricadeText");
const coinsText = document.getElementById("coinsText");
const scoreText = document.getElementById("scoreText");

const abilitySlots = {
    bomb: document.getElementById("abilityBombSlot"),
    freeze: document.getElementById("abilityFreezeSlot"),
    tsunami: document.getElementById("abilityTsunamiSlot"),
    lightning: document.getElementById("abilityLightningSlot"),
    meteor: document.getElementById("abilityMeteorSlot"),
    eclipse: document.getElementById("abilityEclipseSlot")
};

const inventorySlotsPanel = document.getElementById("inventorySlots");
const inventoryCooldownText = document.getElementById("inventoryCooldownText");

const redFlash = document.getElementById("redFlash");
const bossBarBox = document.getElementById("bossBarBox");
const bossBarFill = document.getElementById("bossBarFill");
const bossNameText = document.getElementById("bossNameText");
const centerMessage = document.getElementById("centerMessage");

const waveSummaryPanel = document.getElementById("waveSummaryPanel");
const openShopBtn = document.getElementById("openShopBtn");
const openShopHudBtn = document.getElementById("openShopHudBtn");
const closeShopBtn = document.getElementById("closeShopBtn");
const constructionBtn = document.getElementById("constructionBtn");
const cancelBuildBtn = document.getElementById("cancelBuildBtn");
const structurePanel = document.getElementById("structurePanel");
const structurePanelTitle = document.getElementById("structurePanelTitle");
const structurePanelInfo = document.getElementById("structurePanelInfo");
const structurePanelActions = document.getElementById("structurePanelActions");
const closeStructurePanelBtn = document.getElementById("closeStructurePanelBtn");
const shopTitle = document.getElementById("shopTitle");

const summaryKillsText = document.getElementById("summaryKillsText");
const summaryGoldText = document.getElementById("summaryGoldText");
const summaryScoreText = document.getElementById("summaryScoreText");
const summaryHpText = document.getElementById("summaryHpText");
const summaryBarricadeText = document.getElementById("summaryBarricadeText");
const summaryBonusText = document.getElementById("summaryBonusText");

const shop = document.getElementById("shop");
const shopTabButtons = document.querySelectorAll(".shopTabButton");
const shopSections = document.querySelectorAll(".shopSection");
const gameOverScreen = document.getElementById("gameOverScreen");

const deathMessageText = document.getElementById("deathMessageText");
const finalScoreText = document.getElementById("finalScoreText");
const bestScoreText = document.getElementById("bestScoreText");
const bestScoreMenuText = document.getElementById("bestScoreMenuText");

const refreshLeaderboardBtn = document.getElementById("refreshLeaderboardBtn");
const refreshLeaderboardGameBtn = document.getElementById("refreshLeaderboardGameBtn");
const leaderboardStatusText = document.getElementById("leaderboardStatusText");
const leaderboardGameStatusText = document.getElementById("leaderboardGameStatusText");
const leaderboardList = document.getElementById("leaderboardList");
const leaderboardGameList = document.getElementById("leaderboardGameList");

const upgradeDamageBtn = document.getElementById("upgradeDamageBtn");
const upgradeFireRateBtn = document.getElementById("upgradeFireRateBtn");
const upgradeMaxHpBtn = document.getElementById("upgradeMaxHpBtn");
const upgradeCritBtn = document.getElementById("upgradeCritBtn");

const buySmallPotionBtn = document.getElementById("buySmallPotionBtn");
const buyMediumPotionBtn = document.getElementById("buyMediumPotionBtn");
const buyLargePotionBtn = document.getElementById("buyLargePotionBtn");
const buyShieldPotionBtn = document.getElementById("buyShieldPotionBtn");
const buyAttackSpeedPotionBtn = document.getElementById("buyAttackSpeedPotionBtn");
const buyDoubleShotPotionBtn = document.getElementById("buyDoubleShotPotionBtn");
const buyLifeStealPotionBtn = document.getElementById("buyLifeStealPotionBtn");
const repairBarricadeBtn = document.getElementById("repairBarricadeBtn");
const upgradeBarricadeBtn = document.getElementById("upgradeBarricadeBtn");
const buyRegenBarricadeBtn = document.getElementById("buyRegenBarricadeBtn");
const buyExplosiveBarricadeBtn = document.getElementById("buyExplosiveBarricadeBtn");
const buyThornsBarricadeBtn = document.getElementById("buyThornsBarricadeBtn");
const barricadeSlot1Btn = document.getElementById("barricadeSlot1Btn");
const barricadeSlot2Btn = document.getElementById("barricadeSlot2Btn");

const buyTower1Btn = document.getElementById("buyTower1Btn");
const upgradeTower1Btn = document.getElementById("upgradeTower1Btn");
const buyTower2Btn = document.getElementById("buyTower2Btn");
const upgradeTower2Btn = document.getElementById("upgradeTower2Btn");
const buyTower3Btn = document.getElementById("buyTower3Btn");
const upgradeTower3Btn = document.getElementById("upgradeTower3Btn");
const buyTower4Btn = document.getElementById("buyTower4Btn");
const upgradeTower4Btn = document.getElementById("upgradeTower4Btn");
const buyTower5Btn = document.getElementById("buyTower5Btn");
const upgradeTower5Btn = document.getElementById("upgradeTower5Btn");
const buyTower6Btn = document.getElementById("buyTower6Btn");
const upgradeTower6Btn = document.getElementById("upgradeTower6Btn");
const buyTower7Btn = document.getElementById("buyTower7Btn");
const buyTower8Btn = document.getElementById("buyTower8Btn");
const buyTower9Btn = document.getElementById("buyTower9Btn");
const buyTower10Btn = document.getElementById("buyTower10Btn");
const towerSlotsPanel = document.getElementById("towerSlotsPanel");
const towerLimitText = document.getElementById("towerLimitText");
const buyTowerSlotBtn = document.getElementById("buyTowerSlotBtn");
const towerSlotCostText = document.getElementById("towerSlotCostText");

const tower1BuyBox = document.getElementById("tower1BuyBox");
const tower1UpgradeBox = document.getElementById("tower1UpgradeBox");
const tower2BuyBox = document.getElementById("tower2BuyBox");
const tower2UpgradeBox = document.getElementById("tower2UpgradeBox");
const tower3BuyBox = document.getElementById("tower3BuyBox");
const tower3UpgradeBox = document.getElementById("tower3UpgradeBox");
const tower4BuyBox = document.getElementById("tower4BuyBox");
const tower4UpgradeBox = document.getElementById("tower4UpgradeBox");
const tower5BuyBox = document.getElementById("tower5BuyBox");
const tower5UpgradeBox = document.getElementById("tower5UpgradeBox");
const tower6BuyBox = document.getElementById("tower6BuyBox");
const tower6UpgradeBox = document.getElementById("tower6UpgradeBox");

const buyBombBtn = document.getElementById("buyBombBtn");
const buyFreezeBtn = document.getElementById("buyFreezeBtn");
const buyTsunamiBtn = document.getElementById("buyTsunamiBtn");
const buyLightningBtn = document.getElementById("buyLightningBtn");
const buyMeteorBtn = document.getElementById("buyMeteorBtn");
const buyEclipseBtn = document.getElementById("buyEclipseBtn");

const nextWaveBtn = document.getElementById("nextWaveBtn");
const repeatWaveBtn = document.getElementById("repeatWaveBtn");
const autoRepeatWaveBtn = document.getElementById("autoRepeatWaveBtn");
const newRunBtn = document.getElementById("newRunBtn");

const playerDamageText = document.getElementById("playerDamageText");
const playerFireDelayText = document.getElementById("playerFireDelayText");
const playerMaxHpText = document.getElementById("playerMaxHpText");
const critChanceText = document.getElementById("critChanceText");

const damageCostText = document.getElementById("damageCostText");
const fireRateCostText = document.getElementById("fireRateCostText");
const maxHpCostText = document.getElementById("maxHpCostText");
const critCostText = document.getElementById("critCostText");

const smallPotionCostText = document.getElementById("smallPotionCostText");
const mediumPotionCostText = document.getElementById("mediumPotionCostText");
const largePotionCostText = document.getElementById("largePotionCostText");
const shieldPotionCostText = document.getElementById("shieldPotionCostText");
const attackSpeedPotionCostText = document.getElementById("attackSpeedPotionCostText");
const doubleShotPotionCostText = document.getElementById("doubleShotPotionCostText");
const lifeStealPotionCostText = document.getElementById("lifeStealPotionCostText");
const repairBarricadeCostText = document.getElementById("repairBarricadeCostText");
const upgradeBarricadeCostText = document.getElementById("upgradeBarricadeCostText");
const regenBarricadeCostText = document.getElementById("regenBarricadeCostText");
const explosiveBarricadeCostText = document.getElementById("explosiveBarricadeCostText");
const thornsBarricadeCostText = document.getElementById("thornsBarricadeCostText");
const barricadeTierText = document.getElementById("barricadeTierText");

const tower1CostText = document.getElementById("tower1CostText");
const tower1UpgradeCostText = document.getElementById("tower1UpgradeCostText");
const tower1LevelText = document.getElementById("tower1LevelText");

const tower2CostText = document.getElementById("tower2CostText");
const tower2UpgradeCostText = document.getElementById("tower2UpgradeCostText");
const tower2LevelText = document.getElementById("tower2LevelText");

const tower3CostText = document.getElementById("tower3CostText");
const tower3UpgradeCostText = document.getElementById("tower3UpgradeCostText");
const tower3LevelText = document.getElementById("tower3LevelText");

const tower4CostText = document.getElementById("tower4CostText");
const tower4UpgradeCostText = document.getElementById("tower4UpgradeCostText");
const tower4LevelText = document.getElementById("tower4LevelText");

const tower5CostText = document.getElementById("tower5CostText");
const tower5UpgradeCostText = document.getElementById("tower5UpgradeCostText");
const tower5LevelText = document.getElementById("tower5LevelText");

const tower6CostText = document.getElementById("tower6CostText");
const tower6UpgradeCostText = document.getElementById("tower6UpgradeCostText");
const tower6LevelText = document.getElementById("tower6LevelText");
const tower7CostText = document.getElementById("tower7CostText");
const tower8CostText = document.getElementById("tower8CostText");
const tower9CostText = document.getElementById("tower9CostText");
const tower10CostText = document.getElementById("tower10CostText");

const bombCostText = document.getElementById("bombCostText");
const freezeCostText = document.getElementById("freezeCostText");
const tsunamiCostText = document.getElementById("tsunamiCostText");
const lightningCostText = document.getElementById("lightningCostText");
const meteorCostText = document.getElementById("meteorCostText");
const eclipseCostText = document.getElementById("eclipseCostText");

const pauseBtn = document.getElementById("pauseBtn");
const pausePanel = document.getElementById("pausePanel");
const resumeBtn = document.getElementById("resumeBtn");
const backToMenuBtn = document.getElementById("backToMenuBtn");
const restartRunBtn = document.getElementById("restartRunBtn");

const confirmRestartBox = document.getElementById("confirmRestartBox");
const confirmRestartBtn = document.getElementById("confirmRestartBtn");
const cancelRestartBtn = document.getElementById("cancelRestartBtn");

const menuMusicToggle = document.getElementById("menuMusicToggle");
const menuMusicVolume = document.getElementById("menuMusicVolume");
const menuSfxToggle = document.getElementById("menuSfxToggle");
const menuSfxVolume = document.getElementById("menuSfxVolume");

const pauseMusicToggle = document.getElementById("pauseMusicToggle");
const pauseMusicVolume = document.getElementById("pauseMusicVolume");
const pauseSfxToggle = document.getElementById("pauseSfxToggle");
const pauseSfxVolume = document.getElementById("pauseSfxVolume");

const speedBtn = document.getElementById("speedBtn");
const autoModeBtn = document.getElementById("autoModeBtn");
const consoleBtn = document.getElementById("consoleBtn");
const consolePanel = document.getElementById("consolePanel");
const closeConsoleBtn = document.getElementById("closeConsoleBtn");
const consoleInput = document.getElementById("consoleInput");
const consoleRunBtn = document.getElementById("consoleRunBtn");
const consoleLog = document.getElementById("consoleLog");
const controlKeyButtons = document.querySelectorAll(".controlKeyButton");
const resetControlsButtons = document.querySelectorAll(".resetControlsBtn");

let gameStarted = false;
let gameRunning = false;
let waveInProgress = false;
let loopStarted = false;

let isPaused = false;
let hasActiveRun = false;
let isInMainMenu = true;

let isMouseDown = false;
let isSpaceDown = false;
let isShiftDown = false;

let gameSpeed = 1;
let speedOptions = [1, 2, 2.5, 4];
let speedIndex = 0;

let autoMode = false;
let autoRepeatWaveMode = false;

let gameTime = 0;
let lastFrameTime = performance.now();

// Compensa PCs con menos FPS sin cambiar el feel en PCs que ya van fluidas.
let frameScale = 1;

let bestScore = Number(localStorage.getItem("towerDefenseBestScore")) || 0;
let playerName = localStorage.getItem("ardentPlayerName") || "Jugador";
let alphaTesterName = localStorage.getItem("ardentAlphaTesterName") || "";
let developerName = localStorage.getItem("ardentDeveloperName") || "";

const SAVE_KEY = "ardentTowerDefenseSavedRunV3";
const SAVE_VERSION = 3;
const AUTO_SAVE_INTERVAL = 1500;
const HUD_REFRESH_INTERVAL = 120;
const MAX_DAMAGE_TEXTS = 80;
const MAX_PARTICLES = 260;
const MAX_EFFECTS = 80;
let lastAutoSaveAt = 0;
let lastHudUpdateAt = 0;
let towerSlotsRenderSignature = "";
let inventoryRenderSignature = "";
let selectedBarricadeSlotIndex = 0;
let savedRunAvailable = false;
let runDisqualifiedFromLeaderboard = false;
let leaderboardDisqualificationReason = "";

const alphaTesterCommands = {
    aza: "Aza",
    saki: "Saki",
    valen: "Valen",
    lio: "Lio",
    ema: "Ema",
    lal: "Lal",
    dylan: "Dylan"
};

let wave;
let coins;
let score;
let player;
let barricade;
let barricades;
let towers;
let abilities;
let costs;
let enemies;
let projectiles;
let bossProjectiles;
let slowZones;
let poisonZones;
let fireZones;
let damageTexts;
let particles;
let effects;
let inventory;
let inventoryCooldownUntil;

let enemiesToSpawn;
let enemiesSpawned;
let spawnInterval;
let lastSpawnTime;

let redFlashAlpha = 0;

let waveStats;

let mousePosition = {
    x: GAME_WIDTH / 2,
    y: GAME_HEIGHT / 2
};

if (playerNameInput) {
    playerNameInput.value = playerName === "Jugador" ? "" : playerName;
}

const barricadeTiers = [
    { name: "Madera", color: "#8b5a2b", hpBonus: 25 },
    { name: "Roca", color: "#777777", hpBonus: 40 },
    { name: "Metal", color: "#a9b4bd", hpBonus: 60 },
    { name: "Cristal", color: "#4aa3ff", hpBonus: 85 },
    { name: "Obsidiana", color: "#302038", hpBonus: 120 }
];

const INITIAL_TOWER_LIMIT = 12;
const MAX_TOWER_LIMIT = 20;
const FIRST_TOWER_SLOT_COST = 850;
const TOWER_SLOT_COST_MULTIPLIER = 1.58;
const TOWER_SELL_REFUND = 0.7;
const REPEAT_LIMIT_PER_WAVE = 3;
const BOSS_BARRICADE_DAMAGE_MULTIPLIER = 1.2;
let repeatCountsByWave = {};
let isRepeatingWave = false;
let currentGoldMultiplier = 1;
let doomSpawnedThisWave = false;
let lastDoomWave = -999;

const TOWER_TILE_SIZE = 50;
const TOWER_TILE_HALF = TOWER_TILE_SIZE / 2;

const INVENTORY_SLOT_COUNT = 5;
const INVENTORY_STACK_SIZE = 5;
const INVENTORY_GLOBAL_COOLDOWN = 5000;

const consumableDefinitions = {
    smallPotion: { name: "Poción chica", shortName: "Chica", color: "#57d7ff", effect: "heal", heal: 6, duration: 2500, message: "Poción chica" },
    mediumPotion: { name: "Poción mediana", shortName: "Mediana", color: "#ff74b8", effect: "heal", heal: 14, duration: 3500, message: "Poción mediana" },
    largePotion: { name: "Poción grande", shortName: "Grande", color: "#ff4e64", effect: "heal", heal: 30, duration: 5000, message: "Poción grande" },
    shieldPotion: { name: "Amuleto protector", shortName: "Escudo", color: "#8fa8ff", effect: "shield", message: "¡Escudo listo!" },
    attackSpeedPotion: { name: "Poción de rapidez", shortName: "Rapidez", color: "#ffe35c", effect: "attackSpeed", duration: 10000, message: "¡Rapidez!" },
    doubleShotPotion: { name: "Poción de doble disparo", shortName: "Doble", color: "#c97cff", effect: "doubleShot", duration: 9000, message: "¡Doble disparo!" },
    lifeStealPotion: { name: "Poción vampírica", shortName: "Vampírica", color: "#d71945", effect: "lifeSteal", duration: 10000, message: "¡Vampirismo!" }
};

// Línea reservada para la segunda barricada.
// No se pueden colocar torretas en esta columna, así la barricada avanzada
// queda ordenada y no se mezcla visualmente con las torres.
const ADVANCED_BARRICADE_X = 335;
const RESERVED_BARRICADE_LANE_X = ADVANCED_BARRICADE_X;
const RESERVED_BARRICADE_TILES = createReservedBarricadeLaneTiles();
const towerSlots = createTowerPlacementTiles();

let pendingTowerPurchase = null;
let pendingTowerMoveIndex = null;
let selectedStructureIds = [];
let selectedStructureType = null;

const BARRICADE_BUILD_COSTS = {
    standard: 100,
    regen: 180,
    explosive: 220,
    thorns: 130
};


function createReservedBarricadeLaneTiles() {
    return [];
}

function createTowerPlacementTiles() {
    return [];
}

function clampWorldX(x, radius = 0) {
    return Math.max(radius, Math.min(WORLD_WIDTH - radius, x));
}

function clampWorldY(y, radius = 0) {
    return Math.max(radius, Math.min(WORLD_HEIGHT - radius, y));
}

function snapToBuildGrid(value) {
    return Math.round(value / BUILD_GRID_SIZE) * BUILD_GRID_SIZE;
}

function getSnappedBuildPoint(x = mousePosition.x, y = mousePosition.y) {
    return {
        x: clampWorldX(snapToBuildGrid(x), 20),
        y: clampWorldY(snapToBuildGrid(y), 20)
    };
}

function getBarricadeDimensions(orientation = barricadeBuildOrientation) {
    return orientation === "vertical"
        ? { width: BARRICADE_THICKNESS, height: BARRICADE_LENGTH }
        : { width: BARRICADE_LENGTH, height: BARRICADE_THICKNESS };
}

function getBarricadeBaseCost(kind = "standard") {
    return BARRICADE_BUILD_COSTS[kind] || BARRICADE_BUILD_COSTS.standard;
}

function getBarricadeKindLabel(kind = "standard") {
    if (kind === "regen") return "Regenerativa";
    if (kind === "explosive") return "Explosiva";
    if (kind === "thorns") return "Espinas";
    return "Estándar";
}

function ensureBarricadeEconomy(b) {
    if (!b) return b;
    const baseCost = getBarricadeBaseCost(b.kind);
    b.buildCost = Number(b.buildCost) || baseCost;
    b.spent = Number(b.spent) || b.buildCost;
    b.upgradeCost = Number(b.upgradeCost) || scaleBarricadeCost(baseCost, b.kind === "standard" ? 1.42 : 1.34);
    return b;
}

function ensureTowerEconomy(t) {
    if (!t) return t;
    t.spent = Number(t.spent) || Number(t.cost) || 0;
    t.upgradeCost = Number(t.upgradeCost) || Math.floor((Number(t.cost) || 100) * 1.35);
    return t;
}

function getEntityRect(entity) {
    if (!entity) return null;
    if (entity.kind === "barricade" || entity.isBuildBarricade) {
        const dims = getBarricadeDimensions(entity.orientation || "horizontal");
        return { left: entity.x - dims.width / 2, right: entity.x + dims.width / 2, top: entity.y - dims.height / 2, bottom: entity.y + dims.height / 2 };
    }
    const r = entity.radius || TOWER_COLLISION_RADIUS;
    return { left: entity.x - r, right: entity.x + r, top: entity.y - r, bottom: entity.y + r };
}

function rectsOverlap(a, b, padding = 0) {
    return a.left - padding < b.right && a.right + padding > b.left && a.top - padding < b.bottom && a.bottom + padding > b.top;
}

function isBuildRectInsideWorld(rect) {
    return rect.left >= 0 && rect.right <= WORLD_WIDTH && rect.top >= 0 && rect.bottom <= WORLD_HEIGHT;
}

function isTowerPositionOccupied(x, y, ignoredTower = null) {
    const towerRect = getEntityRect({ x, y, radius: TOWER_COLLISION_RADIUS });
    if (!isBuildRectInsideWorld(towerRect)) return true;
    if (baseCore && Math.hypot(x - baseCore.x, y - baseCore.y) < BASE_RADIUS + TOWER_COLLISION_RADIUS + 18) return true;
    if (player && Math.hypot(x - player.x, y - player.y) < 38) return true;
    if ((towers || []).some(t => t !== ignoredTower && rectsOverlap(towerRect, getEntityRect({ x: t.x, y: t.y, radius: TOWER_COLLISION_RADIUS }), 6))) return true;
    if ((barricades || []).some(b => b.active && b.hp > 0 && rectsOverlap(towerRect, getEntityRect({ ...b, isBuildBarricade: true }), 6))) return true;
    return false;
}

function isBarricadePositionValid(x, y, orientation = barricadeBuildOrientation, ignoredBarricade = null) {
    const rect = getEntityRect({ x, y, orientation, isBuildBarricade: true });
    if (!isBuildRectInsideWorld(rect)) return false;
    if (baseCore && rectsOverlap(rect, getEntityRect({ x: baseCore.x, y: baseCore.y, radius: BASE_RADIUS }), 10)) return false;
    if (player && rectsOverlap(rect, getEntityRect({ x: player.x, y: player.y, radius: 22 }), 8)) return false;
    if ((towers || []).some(t => rectsOverlap(rect, getEntityRect({ x: t.x, y: t.y, radius: TOWER_COLLISION_RADIUS }), 6))) return false;
    if ((barricades || []).some(b => b !== ignoredBarricade && b.active && b.hp > 0 && rectsOverlap(rect, getEntityRect({ ...b, isBuildBarricade: true }), 4))) return false;
    return true;
}

function getTowerTileAt(x, y) {
    const point = getSnappedBuildPoint(x, y);
    return { x: point.x, y: point.y, size: TOWER_TILE_SIZE };
}

function isTowerTileOccupied(tile, ignoredTower = null) {
    return !tile || isTowerPositionOccupied(tile.x, tile.y, ignoredTower);
}

const towerDefinitions = [
    { key: "tower1", name: "Básica", type: "basic", cost: 70, upgradeCost: 100, damage: 0.75, range: 230, fireDelay: 900, color: "cyan", label: "B" },
    { key: "tower2", name: "Rápida", type: "rapid", cost: 105, upgradeCost: 145, damage: 0.42, range: 215, fireDelay: 360, color: "#b9ff7a", label: "R" },
    { key: "tower3", name: "Perforante", type: "pierce", cost: 160, upgradeCost: 180, damage: 2.2, range: 250, fireDelay: 1200, color: "#ffdf6b", label: "P" },
    { key: "tower4", name: "Hielo", type: "slow", cost: 220, upgradeCost: 240, damage: 0, range: 260, fireDelay: 2600, color: "#9be7ff", label: "H", slowAmount: 0.45, slowDuration: 1600, areaRadius: 58 },
    { key: "tower5", name: "Doble", type: "double", cost: 260, upgradeCost: 300, damage: 0.65, range: 235, fireDelay: 1050, color: "#ff8bd1", label: "D" },
    { key: "tower6", name: "Veneno", type: "poison", cost: 310, upgradeCost: 350, damage: 2.45, range: 248, fireDelay: 2850, color: "#8cff4a", label: "V", areaRadius: 58, poisonDuration: 3200, tickDelay: 650 },
    { key: "tower7", name: "Ballesta", type: "ballista", cost: 360, upgradeCost: 420, damage: 9.5, range: 320, fireDelay: 2850, color: "#c58b4b", label: "X" },
    { key: "tower8", name: "Sanguijuela", type: "siphon", cost: 420, upgradeCost: 460, damage: 0.55, drainAmount: 2.2, range: 245, fireDelay: 850, color: "#b81444", label: "S" },
    { key: "tower9", name: "Buffer", type: "buffer", cost: 620, upgradeCost: 600, damage: 0, range: 180, fireDelay: 999999, color: "#b78cff", label: "+", buffDamage: 0.10, buffSpeed: 0.10 },
    { key: "tower10", name: "Lucky Block", type: "lucky", cost: 240, upgradeCost: 0, damage: 0, range: 0, fireDelay: 999999, color: "#ffe28a", label: "?" }
];

const enemyTypes = [
    {
        name: "Bicho Verde",
        color: "limegreen",
        hp: 1,
        speed: 0.82,
        reward: 3,
        score: 5,
        damageToDefense: 1,
        attackDelay: 900
    },
    {
        name: "Bicho Azul",
        color: "dodgerblue",
        hp: 3,
        speed: 0.68,
        reward: 5,
        score: 9,
        damageToDefense: 1,
        attackDelay: 1000
    },
    {
        name: "Bicho Rojo",
        color: "crimson",
        hp: 2,
        speed: 1.15,
        reward: 6,
        score: 11,
        damageToDefense: 1,
        attackDelay: 850
    },
    {
        name: "Bicho Amarillo",
        color: "gold",
        hp: 5,
        speed: 0.58,
        reward: 9,
        score: 17,
        damageToDefense: 2,
        attackDelay: 1050
    },
    {
        name: "Bicho Violeta",
        color: "violet",
        hp: 8,
        speed: 0.45,
        reward: 13,
        score: 25,
        damageToDefense: 3,
        attackDelay: 1200
    }
];

const specialEnemyTypes = [
    {
        name: "Clérigo Verde",
        color: "#73ff9f",
        hp: 7,
        speed: 0.48,
        reward: 14,
        score: 30,
        damageToDefense: 1,
        attackDelay: 1200,
        special: "healer",
        unlockWave: 8,
        healRadius: 135,
        healAmount: 2,
        healDelay: 1600
    },
    {
        name: "Kamikaze Carmesí",
        color: "#ff4747",
        hp: 3,
        speed: 1.45,
        reward: 10,
        score: 24,
        damageToDefense: 4,
        attackDelay: 700,
        special: "exploder",
        unlockWave: 11,
        explosionRadius: 78,
        explosionDamage: 13
    },
    {
        name: "Parpadeante",
        color: "#d58cff",
        hp: 6,
        speed: 0.76,
        reward: 16,
        score: 34,
        damageToDefense: 2,
        attackDelay: 950,
        special: "teleporter",
        unlockWave: 14,
        teleportDelay: 2600
    },
    {
        name: "Hechicero Blanco",
        color: "#ece6ff",
        hp: 10,
        speed: 0.34,
        reward: 24,
        score: 48,
        damageToDefense: 2,
        attackDelay: 1250,
        special: "summoner",
        unlockWave: 17,
        summonDelay: 4300
    },
    {
        name: "Inmune al hielo",
        color: "#6ffff4",
        hp: 7,
        speed: 0.84,
        reward: 17,
        score: 38,
        damageToDefense: 2,
        attackDelay: 900,
        special: "slowImmune",
        unlockWave: 20,
        slowImmune: true
    },
    {
        name: "Rabioso",
        color: "#ff9d00",
        hp: 12,
        speed: 0.44,
        reward: 22,
        score: 52,
        damageToDefense: 2,
        attackDelay: 1150,
        special: "frenzy",
        unlockWave: 23
    },
    {
        name: "Ancla Abisal",
        color: "#4aa3ff",
        hp: 14,
        speed: 0.5,
        reward: 25,
        score: 58,
        damageToDefense: 2,
        attackDelay: 1100,
        special: "tsunamiImmune",
        unlockWave: 26,
        tsunamiImmune: true
    },
    {
        name: "Fractal",
        color: "#ffb86b",
        hp: 7,
        speed: 0.62,
        reward: 18,
        score: 42,
        damageToDefense: 1,
        attackDelay: 920,
        special: "splitter",
        unlockWave: 15,
        splitLevel: 0
    },
    {
        name: "Sombra Velada",
        color: "rgba(180, 180, 210, 0.45)",
        hp: 8,
        speed: 0.74,
        reward: 20,
        score: 46,
        damageToDefense: 2,
        attackDelay: 980,
        special: "invisible",
        unlockWave: 18,
        invisDelay: 3600,
        invisDuration: 1700
    },
    {
        name: "Titán Negro",
        color: "#050505",
        hp: 140,
        speed: 0.22,
        reward: 90,
        score: 240,
        damageToDefense: 999,
        attackDelay: 99999,
        special: "doombringer",
        unlockWave: 30,
        rare: true
    }
];

const bossTypes = [
    // Los jefes ahora importan más: más vida, más oro y variantes más agresivas.
    { name: "Jefe del Abismo", variant: "barrage", color: "#ff7b00", hp: 92, speed: 0.31, reward: 125, score: 260, damageToDefense: 5, attackDelay: 1120, specialCooldown: 2050, burstShots: 8, burstDelay: 125 },
    { name: "Parpadeo Mayor", variant: "blink", color: "#d58cff", hp: 86, speed: 0.36, reward: 130, score: 270, damageToDefense: 5, attackDelay: 1120, specialCooldown: 1450 },
    { name: "Orbe Rebotante", variant: "dvd", color: "#9be7ff", hp: 145, speed: 0.42, reward: 150, score: 310, damageToDefense: 7, attackDelay: 760, specialCooldown: 1850, dvdVy: 1.85 },
    { name: "Mortero Carmesí", variant: "mortar", color: "#ff4747", hp: 104, speed: 0.27, reward: 140, score: 295, damageToDefense: 6, attackDelay: 1180, specialCooldown: 2000 },
    { name: "Corona de Espinas", variant: "spiral", color: "#73ff9f", hp: 98, speed: 0.30, reward: 145, score: 305, damageToDefense: 5, attackDelay: 1080, specialCooldown: 1700 }
];

function getBossTypeForWave() {
    return bossTypes[Math.floor((wave / 10 - 1) % bossTypes.length)];
}


function createBarricadeSlot(name, x) {
    return {
        id: Date.now() + Math.random(),
        name,
        active: false,
        x,
        tier: -1,
        maxHp: 0,
        hp: 0,
        color: "#8b5a2b",
        kind: "standard",
        regenPerSecond: 0,
        explosive: false,
        thorns: false,
        lastRegenTime: 0,
        level: 0
    };
}


function createFreeBarricade(kind = "standard", x = player ? player.x + 85 : WORLD_WIDTH / 2, y = player ? player.y : WORLD_HEIGHT / 2, orientation = barricadeBuildOrientation) {
    const b = createBarricadeSlot(kind === "standard" ? "Muro" : kind, x);
    b.kind = kind;
    b.y = y;
    b.orientation = orientation;
    b.isBuildBarricade = true;
    b.buildCost = getBarricadeBaseCost(kind);
    b.spent = b.buildCost;
    b.upgradeCost = scaleBarricadeCost(b.buildCost, kind === "standard" ? 1.42 : 1.34);
    return b;
}

function getNearestActiveBarricadeTo(x, y) {
    let best = null;
    let bestDist = Infinity;
    (barricades || []).forEach(b => {
        if (!b.active || b.hp <= 0) return;
        const d = Math.hypot((b.x || 0) - x, (b.y || 0) - y);
        if (d < bestDist) { best = b; bestDist = d; }
    });
    return best;
}

function getEnemyMainTarget(enemy) {
    // Modo supervivencia: el objetivo real sos vos. Sin núcleo/base.
    return { type: "player", x: player.x, y: player.y, radius: 23, object: player };
}

function getBlockingBarricadeForEnemy(enemy, targetX, targetY) {
    let best = null;
    let bestDist = Infinity;
    (barricades || []).forEach(b => {
        if (!b.active || b.hp <= 0) return;
        const rect = getEntityRect({ ...b, isBuildBarricade: true });
        const closestX = Math.max(rect.left, Math.min(rect.right, enemy.x));
        const closestY = Math.max(rect.top, Math.min(rect.bottom, enemy.y));
        const d = Math.hypot(enemy.x - closestX, enemy.y - closestY);
        if (d <= enemy.radius + 7) {
            const targetDist = Math.hypot(targetX - b.x, targetY - b.y);
            if (targetDist < bestDist) { best = b; bestDist = targetDist; }
        }
    });
    return best;
}

function damageBase(amount, x = baseCore ? baseCore.x : 0, y = baseCore ? baseCore.y : 0) {
    if (!baseCore || !basePlaced) return false;
    baseCore.hp -= amount;
    triggerRedFlash();
    createImpactParticles(x, y, "#ff7777");
    addDamageText(x, y - 24, amount, false, "#ff7777");
    if (baseCore.hp <= 0) {
        baseCore.hp = 0;
        showCenterMessage("¡NÚCLEO DESTRUIDO!", 1200);
        endRun();
        return true;
    }
    return false;
}

function updateCamera() {
    if (!player) return;
    camera.x = Math.max(0, Math.min(WORLD_WIDTH - GAME_WIDTH, player.x - GAME_WIDTH / 2));
    camera.y = Math.max(0, Math.min(WORLD_HEIGHT - GAME_HEIGHT, player.y - GAME_HEIGHT / 2));
}

function getActiveBarricades() {
    return (barricades || []).filter(b => b.active && b.hp > 0);
}

function getCurrentDefenseBarricade() {
    const active = getActiveBarricades();
    if (active.length === 0) return null;
    const tx = baseCore?.x ?? player?.x ?? WORLD_WIDTH / 2;
    const ty = baseCore?.y ?? player?.y ?? WORLD_HEIGHT / 2;
    return active.reduce((best, b) => {
        const db = Math.hypot(b.x - tx, b.y - ty);
        const da = Math.hypot(best.x - tx, best.y - ty);
        return db < da ? b : best;
    }, active[0]);
}


function getTotalBarricadeHp() {
    return (barricades || []).reduce((sum, b) => sum + Math.max(0, b.hp), 0);
}

function getTotalBarricadeMaxHp() {
    return (barricades || []).reduce((sum, b) => sum + Math.max(0, b.maxHp), 0);
}

function healDefensesAndPlayer(amount) {
    let remaining = amount;
    const damagedBarricades = (barricades || []).filter(b => b.active && b.hp > 0 && b.hp < b.maxHp).sort((a, b) => (a.hp / a.maxHp) - (b.hp / b.maxHp));

    for (const b of damagedBarricades) {
        if (remaining <= 0) break;
        const missing = b.maxHp - b.hp;
        const heal = Math.min(missing, remaining * 0.65);
        b.hp += heal;
        remaining -= heal;
    }

    if (player && remaining > 0 && player.hp < player.maxHp) {
        player.hp = Math.min(player.maxHp, player.hp + remaining);
    }
}

function damageBarricade(b, amount, sourceEnemy = null) {
    if (!b || !b.active || b.hp <= 0) return;

    if (player && player.immortal) {
        createImpactParticles(b.x, sourceEnemy ? sourceEnemy.y : GAME_HEIGHT / 2, "#ffe28a");
        return;
    }

    const isBossDamage = !!(sourceEnemy && (sourceEnemy.isBoss || sourceEnemy.isBossProjectile));
    const finalAmount = isBossDamage ? amount * BOSS_BARRICADE_DAMAGE_MULTIPLIER : amount;

    b.hp -= finalAmount;

    if (b.thorns && sourceEnemy && !sourceEnemy.isBossProjectile) {
        const reflected = Math.max(1, finalAmount * 0.5);
        damageEnemy(sourceEnemy, reflected, false, "#ff9f55", "thorns");
    }

    if (b.hp <= 0) {
        b.hp = 0;
        b.active = false;

        if (b.explosive) {
            explodeBarricade(b);
        }

        showCenterMessage(`¡${b.name} rota!`, 1000);
    }
}

function damagePlayer(amount, sourceEnemy = null, impactX = player ? player.x : 35, impactY = player ? player.y : GAME_HEIGHT / 2, blockedMessage = "¡Golpe bloqueado!") {
    if (!player || player.hp <= 0) return false;

    if (player.shieldCharges > 0) {
        player.shieldCharges--;
        createImpactParticles(impactX, impactY, "#9be7ff");
        showCenterMessage(blockedMessage, 600);
        updateHud();
        return false;
    }

    if (player.immortal) {
        createImpactParticles(impactX, impactY, "#ffe28a");
        showCenterMessage("¡Inmortal!", 450);
        return false;
    }

    player.hp -= amount;
    triggerRedFlash();
    createImpactParticles(impactX, impactY, sourceEnemy && sourceEnemy.color ? sourceEnemy.color : "#ff4444");

    if (player.hp <= 0) {
        player.hp = 0;
        endRun();
        return true;
    }

    return false;
}

function explodeBarricade(b) {
    const radius = 120;
    const damage = 10 + wave * 0.6;

    effects.push({ type: "circle", x: b.x, y: b.y || (baseCore?.y || player?.y || WORLD_HEIGHT / 2), radius: 14, maxRadius: radius, life: 34, color: "#ff8d2a" });

    enemies.forEach(enemy => {
        if (Math.abs(enemy.x - b.x) <= radius) {
            enemy.knockbackX += enemy.isBoss ? 15 : 55;
            damageEnemy(enemy, damage, false, "#ff8d2a", "barricade");
        }
    });

    for (let i = enemies.length - 1; i >= 0; i--) {
        if (enemies[i].hp <= 0) killEnemy(i);
    }
}

function regenerateBarricades() {
    const now = getGameTime();
    (barricades || []).forEach(b => {
        if (!b.active || b.hp <= 0 || b.regenPerSecond <= 0 || b.hp >= b.maxHp) return;
        if (!b.lastRegenTime) b.lastRegenTime = now;
        const elapsed = now - b.lastRegenTime;
        if (elapsed < 250) return;
        b.lastRegenTime = now;
        b.hp = Math.min(b.maxHp, b.hp + b.regenPerSecond * (elapsed / 1000));
    });
}


function scaleShopCost(currentCost, earlyMultiplier, lateMultiplier = 1.14, softCap = 900, hardCap = Number.MAX_SAFE_INTEGER) {
    const current = Math.max(1, Math.min(Number.MAX_SAFE_INTEGER, Number(currentCost) || 1));

    if (current < softCap) {
        return Math.min(hardCap, Number.MAX_SAFE_INTEGER, Math.ceil(current * earlyMultiplier));
    }

    const blend = Math.min(1, Math.pow(softCap / current, 0.65));
    const multiplier = lateMultiplier + (earlyMultiplier - lateMultiplier) * blend;
    const next = Math.ceil(current * multiplier);

    return Math.min(hardCap, Number.MAX_SAFE_INTEGER, Math.max(next, current + 1));
}

function formatCompactNumber(value, decimals = 1) {
    const number = Number(value) || 0;
    const sign = number < 0 ? "-" : "";
    const abs = Math.abs(number);

    if (abs < 1000) return sign + Math.floor(abs).toString();

    const units = [
        { value: 1e15, suffix: "q" },
        { value: 1e12, suffix: "t" },
        { value: 1e9, suffix: "b" },
        { value: 1e6, suffix: "m" },
        { value: 1e3, suffix: "k" }
    ];

    const unit = units.find(item => abs >= item.value) || units[units.length - 1];
    const scaled = abs / unit.value;
    const fixed = scaled >= 100 ? scaled.toFixed(0) : scaled.toFixed(decimals);
    return sign + fixed.replace(/\.0$/, "") + unit.suffix;
}

function formatMoney(value) {
    return formatCompactNumber(value);
}

function formatMissingMoney(value) {
    return formatMoney(Math.max(0, value));
}

function scaleStatCost(currentCost, earlyMultiplier) {
    return scaleShopCost(currentCost, earlyMultiplier, 1.10, 1200);
}

function scaleConsumableCost(currentCost, earlyMultiplier) {
    return scaleShopCost(currentCost, earlyMultiplier, 1.08, 850);
}

function scaleBarricadeCost(currentCost, earlyMultiplier) {
    return scaleShopCost(currentCost, earlyMultiplier, 1.10, 1000);
}

function scaleTowerUpgradeCost(currentCost) {
    return scaleShopCost(currentCost, 1.42, 1.12, 950);
}

function clampTowerSlotLimit(value) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return INITIAL_TOWER_LIMIT;
    return Math.max(INITIAL_TOWER_LIMIT, Math.min(MAX_TOWER_LIMIT, Math.floor(parsed)));
}

function getTowerSlotCostForLimit(limit) {
    const clampedLimit = clampTowerSlotLimit(limit);
    if (clampedLimit >= MAX_TOWER_LIMIT) return 0;
    const purchasedSlots = clampedLimit - INITIAL_TOWER_LIMIT;
    return Math.ceil((FIRST_TOWER_SLOT_COST * Math.pow(TOWER_SLOT_COST_MULTIPLIER, purchasedSlots)) / 10) * 10;
}

function getNextTowerSlotCost(currentCost) {
    const parsed = Number(currentCost);
    const base = Number.isFinite(parsed) && parsed > 0 ? parsed : FIRST_TOWER_SLOT_COST;
    return Math.ceil((base * TOWER_SLOT_COST_MULTIPLIER) / 10) * 10;
}

function getTowerDefinition(keyOrType) {
    return towerDefinitions.find(def => def.key === keyOrType || def.type === keyOrType);
}

function isTowerTileOccupied(tile, ignoredTower = null) {
    return towers.some(tower => tower !== ignoredTower && Math.hypot(tower.x - tile.x, tower.y - tile.y) < 2);
}

function getTowerTileAt(x, y) {
    const point = getSnappedBuildPoint(x, y);
    return { x: point.x, y: point.y, size: TOWER_TILE_SIZE };
}

function isTowerTileAvailable(tile, ignoredTower = null) {
    return !!tile && !isTowerPositionOccupied(tile.x, tile.y, ignoredTower);
}

function createTowerFromDefinition(def, paidCost = def.cost, tile = null) {
    if (!tile || !isTowerTileAvailable(tile)) return null;

    return {
        ...def,
        id: Date.now() + Math.random(),
        owned: true,
        x: tile.x,
        y: tile.y,
        slotIndex: towers.length,
        level: 1,
        lastShotTime: 0,
        spent: paidCost,
        upgradeCost: def.upgradeCost || Math.floor(def.cost * 1.35),
        damageMultiplier: 1,
        fireDelayMultiplier: 1,
        activePoisonZoneExpiresAt: 0,
        activeSlowZoneNextShotAt: 0
    };
}

function beginTowerPlacement(defKey) {
    if (towers.length >= towerSlotLimit) {
        showCenterMessage("Límite de slots de torre alcanzado", 900);
        return;
    }

    const def = getTowerDefinition(defKey);
    if (!def) return;

    const price = costs[def.key] ?? def.cost;
    if (coins < price) {
        showCenterMessage("Monedas insuficientes", 800);
        return;
    }

    clearStructureSelection();
    pendingTowerPurchase = { defKey, price };
    pendingBarricadePlacement = null;
    closeShop();
    waveSummaryPanel.classList.add("hidden");
    showCenterMessage(`Colocá: ${def.name} · podés seguir colocando hasta quedarte sin monedas`, 1300);
    updateBuildCancelUI();
    updateHud();
}

function cancelTowerPlacement(showShopAgain = false) {
    if (!pendingTowerPurchase) return;
    pendingTowerPurchase = null;
    updateBuildCancelUI();
    if (showShopAgain && hasActiveRun) {
        openConstruction("towers");
    }
    updateHud(true);
}

function beginTowerMove(index) {
    const tower = towers[index];
    if (!tower) return;

    pendingTowerPurchase = null;
    pendingTowerMoveIndex = index;
    closeShop();
    waveSummaryPanel.classList.add("hidden");
    showCenterMessage(`Mové: ${tower.name}`, 1100);
    updateHud();
}

function cancelTowerMove(showShopAgain = false) {
    if (pendingTowerMoveIndex === null) return;
    pendingTowerMoveIndex = null;
    updateBuildCancelUI();
    if (showShopAgain && hasActiveRun) {
        openConstruction("towers");
    }
    updateHud(true);
}

function finishTowerMove(tile) {
    const tower = towers[pendingTowerMoveIndex];

    if (!tower) {
        cancelTowerMove(false);
        return;
    }

    if (!tile || !isTowerTileAvailable(tile, tower)) {
        showCenterMessage("Lugar ocupado o inválido", 700);
        return;
    }

    tower.x = tile.x;
    tower.y = tile.y;
    pendingTowerMoveIndex = null;
    updateBuildCancelUI();
    showCenterMessage(`${tower.name} movida`, 750);
    updateHud(true);
    autoSaveRun(true);
}

function finishTowerPlacement(tile) {
    if (!pendingTowerPurchase || !isTowerTileAvailable(tile)) {
        showCenterMessage("Lugar ocupado o inválido", 700);
        return;
    }

    const originalDefKey = pendingTowerPurchase.defKey;
    let def = getTowerDefinition(originalDefKey);
    if (!def) {
        cancelTowerPlacement(false);
        return;
    }

    const price = costs[originalDefKey] ?? def.cost;
    if (coins < price) {
        showCenterMessage("Monedas insuficientes", 800);
        cancelTowerPlacement(false);
        return;
    }

    if (towers.length >= towerSlotLimit) {
        showCenterMessage("Límite de slots de torre alcanzado", 900);
        cancelTowerPlacement(false);
        return;
    }

    coins -= price;

    if (def.type === "lucky") {
        const options = towerDefinitions.filter(t => t.type !== "lucky");
        def = options[Math.floor(Math.random() * options.length)];
        showCenterMessage(`Lucky Block: ${def.name}`, 900);
    } else {
        showCenterMessage(`${def.name} colocada · seguí colocando o cancelá`, 900);
    }

    const tower = createTowerFromDefinition(def, price, tile);
    if (!tower) {
        coins += price;
        showCenterMessage("No se pudo colocar", 800);
        return;
    }

    towers.push(tower);

    const nextPrice = costs[originalDefKey] ?? getTowerDefinition(originalDefKey)?.cost ?? price;
    if (towers.length >= towerSlotLimit || coins < nextPrice) {
        pendingTowerPurchase = null;
        showCenterMessage(towers.length >= towerSlotLimit ? "Límite de torres alcanzado" : "Sin monedas para otra torre", 900);
    } else {
        pendingTowerPurchase = { defKey: originalDefKey, price: nextPrice };
    }

    updateBuildCancelUI();
    updateHud(true);
    autoSaveRun(true);
}

function getLateGameGoldMultiplier() {
    if (wave <= 45) return 1;

    // Acompaña el escalado de precios sin regalar el early-game.
    // En late sube de forma suave para que las mejoras no pidan 4+ oleadas completas.
    const lateProgress = (wave - 45) / 55;
    return Math.min(6.5, 1 + Math.pow(lateProgress, 1.22));
}

function getGoldAmount(amount) {
    return Math.ceil(amount * currentGoldMultiplier * getLateGameGoldMultiplier());
}

function clampRepeatCount(value) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return 0;
    return Math.max(0, Math.min(REPEAT_LIMIT_PER_WAVE, Math.floor(parsed)));
}

function normalizeRepeatCountsByWave(counts) {
    const normalized = {};
    Object.keys(counts || {}).forEach(key => {
        normalized[key] = clampRepeatCount(counts[key]);
    });
    return normalized;
}

function getRepeatCountForCurrentWave() {
    const clamped = clampRepeatCount(repeatCountsByWave[wave]);
    repeatCountsByWave[wave] = clamped;
    return clamped;
}

function applyTowerBuffs() {
    towers.forEach(t => {
        t.damageMultiplier = 1;
        t.fireDelayMultiplier = 1;
    });

    towers.forEach(buffer => {
        if (buffer.type !== "buffer") return;
        towers.forEach(t => {
            if (t === buffer || t.type === "buffer") return;
            const dist = Math.hypot(t.x - buffer.x, t.y - buffer.y);
            if (dist <= buffer.range) {
                t.damageMultiplier *= 1 + (buffer.buffDamage || 0);
                t.fireDelayMultiplier *= Math.max(0.55, 1 - (buffer.buffSpeed || 0));
            }
        });
    });
}

function getTowerDamage(tower) {
    return (tower.damage || 0) * (tower.damageMultiplier || 1);
}

function getTowerDelay(tower) {
    return (tower.fireDelay || 999999) * (tower.fireDelayMultiplier || 1);
}

function updateTowerSlotIndexes() {
    towers.forEach((tower, index) => {
        tower.slotIndex = index;
    });
}

function applyPlayerLifeSteal(damageDone, source = "player") {
    if (!player || source !== "player") return;
    if (getGameTime() > player.lifeStealUntil) return;
    const heal = Math.max(0, damageDone * (player.lifeStealPercent || 0));
    if (heal > 0) healDefensesAndPlayer(heal);
}

function createDefaultState() {
    wave = 1;
    coins = 0;
    score = 0;
    runDisqualifiedFromLeaderboard = false;
    leaderboardDisqualificationReason = "";

    player = {
        x: WORLD_WIDTH / 2,
        y: WORLD_HEIGHT / 2,
        damage: 1,
        fireDelay: 550,
        lastShotTime: 0,
        maxHp: 20,
        hp: 20,
        critChance: 0,
        critMultiplier: 2,
        moveSpeed: PLAYER_SURVIVAL_SPEED,
        aimX: WORLD_WIDTH / 2 + 1,
        aimY: WORLD_HEIGHT / 2,
        shieldCharges: 0,
        doubleShotUntil: 0,
        attackSpeedUntil: 0,
        lifeStealUntil: 0,
        lifeStealPercent: 0,
        immortal: false,
        alphaTester: Boolean(alphaTesterName),
        developer: Boolean(developerName),
        name: developerName || alphaTesterName || playerName

    };
    gameSpeed = 1;
    speedIndex = 0;
    autoMode = false;
    autoRepeatWaveMode = false;

    if (speedBtn) speedBtn.textContent = "Velocidad x1";

    if (autoModeBtn) {
        autoModeBtn.textContent = "Auto OFF";
        autoModeBtn.classList.remove("autoActive");
    }


    pressedKeys.clear();
    isSpaceDown = false;
    repeatCountsByWave = {};
    isRepeatingWave = false;
    currentGoldMultiplier = 1;
    doomSpawnedThisWave = false;
    lastDoomWave = -999;
    selectedBarricadeSlotIndex = 0;
    baseCore = null;
    basePlaced = false;
    pendingBasePlacement = false;

    barricades = [];
    barricade = null;

    towers = [];
    towerSlotLimit = INITIAL_TOWER_LIMIT;

    abilities = {
        bomb: {
            name: "Bomba",
            key: codeToLabel(controlBindings.bomb),
            owned: false,
            cost: 180,
            cooldown: 8000,
            lastUsed: -Infinity
        },
        freeze: {
            name: "Congelar",
            key: codeToLabel(controlBindings.freeze),
            owned: false,
            cost: 280,
            cooldown: 14000,
            lastUsed: -Infinity
        },
        tsunami: {
            name: "Tsunami",
            key: codeToLabel(controlBindings.tsunami),
            owned: false,
            cost: 560,
            cooldown: 24000,
            lastUsed: -Infinity
        },
        lightning: {
            name: "Rayo",
            key: codeToLabel(controlBindings.lightning),
            owned: false,
            cost: 650,
            cooldown: 22000,
            lastUsed: -Infinity
        },
        meteor: {
            name: "Meteorito",
            key: codeToLabel(controlBindings.meteor),
            owned: false,
            cost: 950,
            cooldown: 30000,
            lastUsed: -Infinity
        },
        eclipse: {
            name: "Eclipse",
            key: codeToLabel(controlBindings.eclipse),
            owned: false,
            cost: 1350,
            cooldown: 42000,
            lastUsed: -Infinity
        }
    };

    costs = {
        damage: 35,
        fireRate: 50,
        maxHp: 80,
        crit: 120,

        smallPotion: 15,
        mediumPotion: 35,
        largePotion: 70,
        shieldPotion: 110,
        attackSpeedPotion: 260,
        doubleShotPotion: 620,
        lifeStealPotion: 520,
        repairBarricade: 45,
        upgradeBarricade: 100,
        regenBarricade: 180,
        explosiveBarricade: 220,
        thornsBarricade: 130,
        towerSlot: FIRST_TOWER_SLOT_COST,

        tower1: 70,
        tower2: 105,
        tower3: 160,
        tower4: 220,
        tower5: 260,
        tower6: 310,
        tower7: 360,
        tower8: 420,
        tower9: 620,
        tower10: 240
    };

    enemies = [];
    projectiles = [];
    bossProjectiles = [];
    slowZones = [];
    poisonZones = [];
    fireZones = [];
    damageTexts = [];
    particles = [];
    effects = [];
    inventory = createEmptyInventory();
    inventoryCooldownUntil = 0;

    enemiesToSpawn = 0;
    enemiesSpawned = 0;
    spawnInterval = 900;
    lastSpawnTime = 0;

    resetWaveStats();
}

function resetWaveStats() {
    waveStats = {
        kills: 0,
        gold: 0,
        score: 0,
        bonus: 0
    };
}

function getSerializableProjectile(projectile) {
    if (!projectile) return projectile;
    const copy = { ...projectile };
    copy.sourceTowerId = projectile.sourceTower ? projectile.sourceTower.id : projectile.sourceTowerId || null;
    copy.sourceTower = null;
    copy.hitEnemies = [];
    return copy;
}

function getSerializableZone(zone) {
    if (!zone) return zone;
    const copy = { ...zone };
    copy.sourceTowerId = zone.sourceTower ? zone.sourceTower.id : zone.sourceTowerId || null;
    copy.sourceTower = null;
    return copy;
}

function buildSavePayload() {
    if (!hasActiveRun || !player) return null;

    return {
        version: SAVE_VERSION,
        savedAt: Date.now(),
        wave,
        coins,
        score,
        runDisqualifiedFromLeaderboard,
        leaderboardDisqualificationReason,
        gameTime,
        gameSpeed,
        speedIndex,
        autoMode,
        autoRepeatWaveMode: false,
        waveInProgress,
        gameRunning: Boolean(gameRunning && waveInProgress),
        enemiesToSpawn,
        enemiesSpawned,
        spawnInterval,
        lastSpawnTime,
        repeatCountsByWave,
        isRepeatingWave,
        currentGoldMultiplier,
        doomSpawnedThisWave,
        lastDoomWave,
        selectedBarricadeSlotIndex,
        baseCore,
        basePlaced,
        player,
        barricades,
        towers,
        towerSlotLimit,
        abilities,
        costs,
        enemies,
        projectiles: (projectiles || []).map(getSerializableProjectile),
        bossProjectiles,
        slowZones: (slowZones || []).map(getSerializableZone),
        poisonZones: (poisonZones || []).map(getSerializableZone),
        fireZones,
        damageTexts,
        particles,
        effects,
        inventory,
        inventoryCooldownUntil,
        waveStats,
        uiMode: waveInProgress ? "wave" : (!shop.classList.contains("hidden") ? "shop" : (!waveSummaryPanel.classList.contains("hidden") ? "summary" : "shop"))
    };
}

function saveRunNow() {
    try {
        const payload = buildSavePayload();
        if (!payload) return;
        localStorage.setItem(SAVE_KEY, JSON.stringify(payload));
        savedRunAvailable = true;
        updateStartButtonSavedState();
    } catch (error) {
        console.log("Save error:", error);
    }
}

function autoSaveRun(force = false) {
    if (!hasActiveRun || !player) return;
    const now = performance.now();
    if (!force && now - lastAutoSaveAt < AUTO_SAVE_INTERVAL) return;
    lastAutoSaveAt = now;
    saveRunNow();
}

function clearSavedRun() {
    localStorage.removeItem(SAVE_KEY);
    savedRunAvailable = false;
    updateStartButtonSavedState();
}

function hasSavedRun() {
    try {
        return Boolean(localStorage.getItem(SAVE_KEY));
    } catch (error) {
        return false;
    }
}

function relinkSavedReferences() {
    const towerById = new Map((towers || []).map(tower => [tower.id, tower]));

    (projectiles || []).forEach(projectile => {
        projectile.hitEnemies = Array.isArray(projectile.hitEnemies) ? projectile.hitEnemies : [];
        projectile.sourceTower = projectile.sourceTowerId ? towerById.get(projectile.sourceTowerId) || null : null;
    });

    (slowZones || []).forEach(zone => {
        zone.sourceTower = zone.sourceTowerId ? towerById.get(zone.sourceTowerId) || null : null;
    });

    (poisonZones || []).forEach(zone => {
        zone.sourceTower = zone.sourceTowerId ? towerById.get(zone.sourceTowerId) || null : null;
    });
}

function restoreSavedRun() {
    try {
        const raw = localStorage.getItem(SAVE_KEY);
        if (!raw) return false;

        const data = JSON.parse(raw);
        if (!data || data.version !== SAVE_VERSION || !data.player || !Array.isArray(data.towers)) {
            clearSavedRun();
            return false;
        }

        wave = Number(data.wave) || 1;
        coins = Number(data.coins) || 0;
        score = Number(data.score) || 0;
        runDisqualifiedFromLeaderboard = Boolean(data.runDisqualifiedFromLeaderboard);
        leaderboardDisqualificationReason = String(data.leaderboardDisqualificationReason || "").slice(0, 80);
        gameTime = Number(data.gameTime) || 0;
        gameSpeed = Number(data.gameSpeed) || 1;
        speedIndex = Number(data.speedIndex) || 0;
        autoMode = Boolean(data.autoMode);
        autoRepeatWaveMode = false;
        waveInProgress = Boolean(data.waveInProgress);
        gameRunning = Boolean(data.gameRunning && data.waveInProgress);
        enemiesToSpawn = Number(data.enemiesToSpawn) || 0;
        enemiesSpawned = Number(data.enemiesSpawned) || 0;
        spawnInterval = Number(data.spawnInterval) || 900;
        lastSpawnTime = Number(data.lastSpawnTime) || getGameTime();
        repeatCountsByWave = normalizeRepeatCountsByWave(data.repeatCountsByWave || {});
        isRepeatingWave = Boolean(data.isRepeatingWave);
        currentGoldMultiplier = Number(data.currentGoldMultiplier) || 1;
        doomSpawnedThisWave = Boolean(data.doomSpawnedThisWave);
        lastDoomWave = Number.isFinite(Number(data.lastDoomWave)) ? Number(data.lastDoomWave) : -999;
        selectedBarricadeSlotIndex = Number.isInteger(data.selectedBarricadeSlotIndex) ? Math.max(0, Math.min(1, data.selectedBarricadeSlotIndex)) : 0;
        baseCore = null;
        basePlaced = false;
        pendingBasePlacement = false;

        player = data.player;
        player.x = clampWorldX(Number(player.x) || WORLD_WIDTH / 2, 32);
        player.y = clampWorldY(Number(player.y) || WORLD_HEIGHT / 2, 32);
        player.moveSpeed = Number(player.moveSpeed) || PLAYER_SURVIVAL_SPEED;
        player.name = developerName || alphaTesterName || playerName;
        player.alphaTester = Boolean(alphaTesterName);
        player.developer = Boolean(developerName);

        barricades = Array.isArray(data.barricades) ? data.barricades : [createBarricadeSlot("Inicio", 120), createBarricadeSlot("Avanzada", ADVANCED_BARRICADE_X)];
        barricades.forEach((b, index) => { if (!b.id) b.id = Date.now() + Math.random() + index; ensureBarricadeEconomy(b); });
        barricade = barricades[0];
        towers = Array.isArray(data.towers) ? data.towers : [];
        towers.forEach((t, index) => { if (!t.id) t.id = Date.now() + Math.random() + index; ensureTowerEconomy(t); });
        selectedStructureIds = [];
        selectedStructureType = null;
        towerSlotLimit = clampTowerSlotLimit(data.towerSlotLimit || INITIAL_TOWER_LIMIT);
        updateTowerSlotIndexes();

        abilities = data.abilities || abilities;
        costs = data.costs || costs;
        if (!Number.isFinite(Number(costs.towerSlot))) costs.towerSlot = getTowerSlotCostForLimit(towerSlotLimit);
        applyControlsToAbilities();

        enemies = Array.isArray(data.enemies) ? data.enemies : [];
        projectiles = Array.isArray(data.projectiles) ? data.projectiles : [];
        bossProjectiles = Array.isArray(data.bossProjectiles) ? data.bossProjectiles : [];
        slowZones = Array.isArray(data.slowZones) ? data.slowZones : [];
        poisonZones = Array.isArray(data.poisonZones) ? data.poisonZones : [];
        fireZones = Array.isArray(data.fireZones) ? data.fireZones : [];
        damageTexts = Array.isArray(data.damageTexts) ? data.damageTexts : [];
        particles = Array.isArray(data.particles) ? data.particles : [];
        effects = Array.isArray(data.effects) ? data.effects : [];
        inventory = normalizeInventory(data.inventory);
        inventoryCooldownUntil = Number(data.inventoryCooldownUntil) || 0;
        waveStats = data.waveStats || { kills: 0, gold: 0, score: 0, bonus: 0 };

        relinkSavedReferences();

        hasActiveRun = true;
        isPaused = false;
        pendingTowerPurchase = null;
        pendingTowerMoveIndex = null;
        towerSlotsRenderSignature = "";
        inventoryRenderSignature = "";
        lastFrameTime = performance.now();
        frameScale = 1;

        if (speedBtn) speedBtn.textContent = `Velocidad x${gameSpeed}`;
        if (autoModeBtn) {
            autoModeBtn.textContent = autoMode ? "Auto ON" : "Auto OFF";
            autoModeBtn.classList.toggle("autoActive", autoMode);
        }

        shop.classList.add("hidden");
        waveSummaryPanel.classList.add("hidden");
        gameOverScreen.classList.add("hidden");
        pausePanel.classList.add("hidden");

        if (!waveInProgress) {
            gameRunning = false;
            if (data.uiMode === "summary") {
                showWaveSummary();
            } else {
                shop.classList.remove("hidden");
                setShopSection("stats");
            }
        }

        updateHud(true);
        return true;
    } catch (error) {
        console.log("Load save error:", error);
        clearSavedRun();
        return false;
    }
}

function updateStartButtonSavedState() {
    savedRunAvailable = hasSavedRun();
    if (startGameBtn && !gameStarted) {
        startGameBtn.textContent = savedRunAvailable ? "Continuar partida" : "Jugar";
        startGameBtn.title = savedRunAvailable ? "Hay una partida guardada en este navegador." : "";
    }
}

function startGame() {
    if (playerNameInput) {
        const typedName = playerNameInput.value.trim();
        playerName = typedName || "Jugador";
        localStorage.setItem("ardentPlayerName", playerName);
    }

    enableSound();

    gameStarted = true;
    isInMainMenu = false;

    menu.classList.add("hidden");
    gameArea.classList.remove("hidden");
    resizeCanvasForDisplay();

    if (!hasActiveRun) {
        const restored = restoreSavedRun();
        if (!restored) {
            createDefaultState();
            hasActiveRun = true;
            gameRunning = true;
            waveInProgress = false;
            pendingBasePlacement = false;
            startWave();
            showCenterMessage("¡SOBREVIVÍ!", 1200);
        } else {
            // Si la partida se guardó justo al pausar/cambiar de pantalla,
            // al continuar una oleada debe arrancar limpia: sin pausa y corriendo.
            isPaused = false;
            pausePanel.classList.add("hidden");
            confirmRestartBox.classList.add("hidden");
            if (waveInProgress) {
                gameRunning = true;
                shop.classList.add("hidden");
                waveSummaryPanel.classList.add("hidden");
            }
        }
    } else {
        isPaused = false;
        pausePanel.classList.add("hidden");

        if (waveInProgress) {
            gameRunning = true;
        }

        syncMusicState();
    }

    if (!loopStarted) {
        loopStarted = true;
        gameLoop();
    }

    updateHud();
}

function startWave() {
    cancelTowerPlacement(false);
    cancelBarricadePlacement(false);
    waveInProgress = true;
    gameRunning = true;

    enemies = [];
    projectiles = [];
    bossProjectiles = [];
    slowZones = [];
    poisonZones = [];
    fireZones = [];
    damageTexts = [];
    particles = [];
    effects = [];

    resetWaveStats();

    enemiesToSpawn = getEnemiesAmountForWave();
    enemiesSpawned = 0;

    spawnInterval = Math.max(260, 900 - wave * 16);
    lastSpawnTime = getGameTime();
    doomSpawnedThisWave = false;

    closeShop();
    waveSummaryPanel.classList.add("hidden");
    gameOverScreen.classList.add("hidden");
    pausePanel.classList.add("hidden");
    consolePanel.classList.add("hidden");
    confirmRestartBox.classList.add("hidden");

    if (isBossWave()) {
        showCenterMessage("¡BOSS!", 1800);
    }

    isPaused = false;
    lastFrameTime = performance.now();
    frameScale = 1;
    syncMusicState();
    updateHud(true);
    autoSaveRun(true);
}

function getEnemiesAmountForWave() {
    if (isBossWave()) return 10 + wave * 2;
    return 12 + wave * 4;
}

function isBossWave() {
    return wave % 10 === 0;
}

function getUnlockedEnemyCount() {
    if (wave < 5) return 1;
    if (wave < 10) return 2;
    if (wave < 15) return 2;
    if (wave < 20) return 3;
    if (wave < 25) return 4;
    return 5;
}

function getEnemyTypeForWave() {
    const unlockedTypes = getUnlockedEnemyCount();
    const normalPool = enemyTypes.slice(0, unlockedTypes);
    const specialPool = specialEnemyTypes.filter(type => wave >= type.unlockWave);

    if (specialPool.length > 0 && Math.random() < getSpecialEnemyChance()) {
        return specialPool[Math.floor(Math.random() * specialPool.length)];
    }

    return normalPool[Math.floor(Math.random() * normalPool.length)];
}

function getSpecialEnemyChance() {
    return Math.min(0.38, 0.13 + wave * 0.008);
}

function getRandomSpawnPoint() {
    const side = Math.floor(Math.random() * 4);
    const margin = 55;
    if (side === 0) return { x: Math.random() * WORLD_WIDTH, y: -margin };
    if (side === 1) return { x: WORLD_WIDTH + margin, y: Math.random() * WORLD_HEIGHT };
    if (side === 2) return { x: Math.random() * WORLD_WIDTH, y: WORLD_HEIGHT + margin };
    return { x: -margin, y: Math.random() * WORLD_HEIGHT };
}

function createEnemyFromType(type, options = {}) {
    const hpScaling = options.ignoreScaling ? 1 : 1 + wave * 0.13;
    const speedScaling = options.ignoreScaling ? 0 : wave * 0.012;
    const maxHp = Math.max(1, Math.ceil(type.hp * hpScaling));
    const speed = (type.speed + speedScaling) * ENEMY_SURVIVAL_SPEED_MULTIPLIER;
    const spawnPoint = options.spawnPoint || getRandomSpawnPoint();

    return {
        x: options.x ?? spawnPoint.x,
        y: options.y ?? spawnPoint.y,
        radius: options.radius ?? 18,
        color: type.color,
        hp: maxHp,
        maxHp,
        baseSpeed: speed,
        originalBaseSpeed: speed,
        speed,
        reward: options.reward ?? type.reward + Math.floor(wave * 0.45),
        scoreValue: options.scoreValue ?? type.score + wave,
        damageToDefense: type.damageToDefense,
        attackDelay: type.attackDelay,
        originalAttackDelay: type.attackDelay,
        lastAttackTime: 0,
        isAttacking: false,
        target: null,
        slowUntil: 0,
        slowMultiplier: 1,
        hitFlash: 0,
        knockbackX: 0,
        isBoss: false,
        name: type.name,
        special: type.special || null,
        slowImmune: Boolean(type.slowImmune),
        tsunamiImmune: Boolean(type.tsunamiImmune),
        healRadius: type.healRadius || 0,
        healAmount: type.healAmount || 0,
        healDelay: type.healDelay || 0,
        lastHealTime: getGameTime() + Math.random() * 600,
        explosionRadius: type.explosionRadius || 0,
        explosionDamage: type.explosionDamage || 0,
        teleportDelay: type.teleportDelay || 0,
        lastTeleportTime: getGameTime() + Math.random() * 800,
        summonDelay: type.summonDelay || 0,
        lastSummonTime: getGameTime() + Math.random() * 900,
        splitLevel: options.splitLevel ?? type.splitLevel ?? 0,
        invisDelay: type.invisDelay || 0,
        invisDuration: type.invisDuration || 0,
        lastInvisTime: getGameTime() + Math.random() * 1400,
        invisibleUntil: 0,
        untargetable: false,
        isMini: Boolean(options.isMini)
    };
}

function shouldSpawnDoomEnemy() {
    if (doomSpawnedThisWave) return false;
    if (wave < 30) return false;
    // Nunca aparece en dos oleadas consecutivas. Desde late-game se vuelve
    // más probable, pero sigue siendo una amenaza rara y especial.
    if (lastDoomWave === wave - 1) return false;
    return Math.random() < Math.min(0.12, 0.018 + (wave - 30) * 0.0025);
}

function spawnEnemy() {
    if (isBossWave() && enemiesSpawned === enemiesToSpawn - 1) {
        spawnBoss();
        enemiesSpawned++;
        return;
    }

    let type;
    if (shouldSpawnDoomEnemy()) {
        type = specialEnemyTypes.find(t => t.special === "doombringer");
        doomSpawnedThisWave = true;
        lastDoomWave = wave;
        showCenterMessage("¡TITÁN NEGRO!", 1100);
    } else {
        type = getEnemyTypeForWave();
        if (type && type.special === "doombringer") type = enemyTypes[Math.floor(Math.random() * getUnlockedEnemyCount())];
    }

    enemies.push(createEnemyFromType(type));
    enemiesSpawned++;
}

function spawnMiniEnemy(x, y) {
    const miniType = {
        name: "Bichito Invocado",
        color: "#ffffff",
        hp: 1 + Math.floor(wave / 10),
        speed: (1.22 + wave * 0.006) * ENEMY_SURVIVAL_SPEED_MULTIPLIER,
        reward: 1,
        score: 2,
        damageToDefense: 1,
        attackDelay: 760
    };

    enemies.push(createEnemyFromType(miniType, {
        x,
        y: clampWorldY(y, 45),
        radius: 11,
        reward: 1,
        scoreValue: 3 + Math.floor(wave / 4),
        ignoreScaling: true,
        isMini: true
    }));
}

function spawnBoss() {
    const type = getBossTypeForWave();
    const hpScaling = 1 + wave * 0.28;
    const maxHp = Math.ceil(type.hp * hpScaling);
    const speed = (type.speed + wave * 0.0045) * ENEMY_SURVIVAL_SPEED_MULTIPLIER;

    const spawn = getRandomSpawnPoint();
    enemies.push({
        x: spawn.x,
        y: spawn.y,
        radius: 42,
        color: type.color,
        hp: maxHp,
        maxHp,
        baseSpeed: speed,
        originalBaseSpeed: speed,
        speed,
        reward: type.reward + wave * 7,
        scoreValue: type.score + wave * 16,
        damageToDefense: type.damageToDefense,
        attackDelay: type.attackDelay,
        originalAttackDelay: type.attackDelay,
        lastAttackTime: 0,
        isAttacking: false,
        target: null,
        slowUntil: 0,
        slowMultiplier: 1,
        hitFlash: 0,
        knockbackX: 0,
        isBoss: true,
        bossVariant: type.variant,
        name: type.name,
        lastBossSpecialTime: getGameTime() + 900,
        bossBurstLeft: 0,
        nextBurstShotAt: 0,
        bossSpecialCooldown: type.specialCooldown || 2200,
        bossBurstShots: type.burstShots || 5,
        bossBurstDelay: type.burstDelay || 180,
        dvdVy: (Math.random() < 0.5 ? 1 : -1) * (type.dvdVy || 1.05) * ENEMY_SURVIVAL_SPEED_MULTIPLIER,
        spiralAngle: 0
    });
}

function addTowerProjectile(tower, targetX, targetY, options = {}) {
    const angle = Math.atan2(targetY - tower.y, targetX - tower.x) + (options.angleOffset || 0);

    projectiles.push({
        x: tower.x,
        y: tower.y,
        radius: options.radius ?? 5,
        speed: options.speed ?? 6.5,
        damage: options.damage ?? getTowerDamage(tower),
        owner: options.owner ?? "tower",
        isCrit: false,
        dx: Math.cos(angle),
        dy: Math.sin(angle),
        angle,
        color: options.color ?? tower.color,
        type: options.type ?? "normal",
        hitsLeft: options.hitsLeft ?? 1,
        hitEnemies: [],
        slowAmount: options.slowAmount,
        slowDuration: options.slowDuration,
        areaRadius: options.areaRadius,
        poisonDuration: options.poisonDuration,
        tickDelay: options.tickDelay,
        sourceTower: tower
    });
}

function shoot(targetX, targetY, owner = "player", tower = null) {
    const now = getGameTime();

    if (owner === "player") {
        const attackMultiplier = now < player.attackSpeedUntil ? 0.55 : 1;
        if (now - player.lastShotTime < player.fireDelay * attackMultiplier) return;

        player.lastShotTime = now;
        playShootSound();
        const baseAngle = Math.atan2(targetY - player.y, targetX - player.x);
        const isCrit = Math.random() < player.critChance;
        const damage = isCrit ? player.damage * player.critMultiplier : player.damage;
        const doubleShotActive = now < player.doubleShotUntil;
        const offsets = doubleShotActive ? [-0.085, 0.085] : [0];

        offsets.forEach(offset => {
            const angle = baseAngle + offset;
            projectiles.push({
                x: player.x,
                y: player.y,
                radius: 6,
                speed: 7,
                damage,
                owner: "player",
                isCrit,
                dx: Math.cos(angle),
                dy: Math.sin(angle),
                color: isCrit ? "#ffe28a" : "white",
                type: "normal",
                hitsLeft: 1,
                hitEnemies: []
            });
        });
    }

    if (owner === "tower") {
        if (!tower || !tower.owned) return;
        if (tower.type === "buffer") return;
        if (tower.type === "poison" && now < (tower.activePoisonZoneExpiresAt || 0)) return;
        if (tower.type === "slow" && now < (tower.activeSlowZoneNextShotAt || 0)) return;
        if (now - tower.lastShotTime < getTowerDelay(tower)) return;

        tower.lastShotTime = now;
        playShootSound();

        if (tower.type === "basic") {
            addTowerProjectile(tower, targetX, targetY);
        }

        if (tower.type === "rapid") {
            addTowerProjectile(tower, targetX, targetY, {
                radius: 4,
                speed: 8.2,
                damage: getTowerDamage(tower),
                color: tower.color
            });
        }

        if (tower.type === "pierce") {
            addTowerProjectile(tower, targetX, targetY, {
                radius: 6,
                speed: 7,
                type: "pierce",
                hitsLeft: 2
            });
        }

        if (tower.type === "slow") {
            addTowerProjectile(tower, targetX, targetY, {
                radius: 7,
                speed: 5.5,
                damage: 0,
                type: "slow",
                slowAmount: tower.slowAmount,
                slowDuration: tower.slowDuration,
                areaRadius: tower.areaRadius
            });
        }

        if (tower.type === "double") {
            addTowerProjectile(tower, targetX, targetY, { angleOffset: -0.09, radius: 5, speed: 6.7 });
            addTowerProjectile(tower, targetX, targetY, { angleOffset: 0.09, radius: 5, speed: 6.7 });
        }

        if (tower.type === "ballista") {
            addTowerProjectile(tower, targetX, targetY, {
                radius: 4,
                speed: 10,
                damage: getTowerDamage(tower),
                type: "ballista",
                color: tower.color
            });
        }

        if (tower.type === "poison") {
            addTowerProjectile(tower, targetX, targetY, {
                radius: 7,
                speed: 5.7,
                damage: getTowerDamage(tower),
                type: "poison",
                areaRadius: tower.areaRadius,
                poisonDuration: tower.poisonDuration,
                tickDelay: tower.tickDelay
            });
        }

        if (tower.type === "siphon") {
            const target = findClosestEnemy(tower.x, tower.y, tower.range);
            if (target) {
                damageEnemy(target, getTowerDamage(tower), false, "#ff5d86", "tower");
                healDefensesAndPlayer(tower.drainAmount || 2);
                effects.push({ type: "line", x1: tower.x, y1: tower.y, x2: target.x, y2: target.y, life: 10, color: "#ff2f68" });
                if (target.hp <= 0) {
                    const idx = enemies.indexOf(target);
                    if (idx >= 0) killEnemy(idx);
                }
            }
        }
    }
}

function autoShootPlayer() {
    if (!isMouseDown && !isSpaceDown) return;
    shoot(mousePosition.x, mousePosition.y, "player");
}

function getPlayerRightBoundaryX() {
    return WORLD_WIDTH - 32;
}

function resolvePlayerBarricadeCollision(oldX, oldY) {
    if (!player) return;
    const playerRect = getEntityRect({ x: player.x, y: player.y, radius: 22 });
    for (const b of (barricades || [])) {
        if (!b.active || b.hp <= 0) continue;
        const rect = getEntityRect({ ...b, isBuildBarricade: true });
        if (rectsOverlap(playerRect, rect, 2)) {
            player.x = oldX;
            player.y = oldY;
            return;
        }
    }
}

function clampPlayerToPlayableArea() {
    if (!player) return;
    player.x = clampWorldX(player.x, 32);
    player.y = clampWorldY(player.y, 32);
}

function updatePlayerMovement() {
    if (!gameRunning || isPaused || !player || !waveInProgress) return;

    let dx = 0;
    let dy = 0;

    if (pressedKeys.has(controlBindings.moveLeft)) dx -= 1;
    if (pressedKeys.has(controlBindings.moveRight)) dx += 1;
    if (pressedKeys.has(controlBindings.moveUp)) dy -= 1;
    if (pressedKeys.has(controlBindings.moveDown)) dy += 1;

    if (dx === 0 && dy === 0) return;

    const oldX = player.x;
    const oldY = player.y;
    const length = Math.hypot(dx, dy) || 1;
    dx /= length;
    dy /= length;

    const movementSpeedMultiplier = Math.min(1.12, Math.sqrt(gameSpeed) * 0.82);
    const speed = player.moveSpeed * movementSpeedMultiplier * frameScale;

    player.x += dx * speed;
    player.y += dy * speed;
    clampPlayerToPlayableArea();
    resolvePlayerBarricadeCollision(oldX, oldY);
}

function updateTowers() {
    applyTowerBuffs();

    towers.forEach(tower => {
        if (!tower.owned || tower.type === "buffer") return;

        let closestEnemy = null;
        let closestDistanceSq = Infinity;
        const rangeSq = tower.range * tower.range;

        enemies.forEach(enemy => {
            if (enemy.untargetable) return;
            const dx = enemy.x - tower.x;
            const dy = enemy.y - tower.y;
            const distanceSq = dx * dx + dy * dy;

            if (distanceSq < closestDistanceSq && distanceSq <= rangeSq) {
                closestDistanceSq = distanceSq;
                closestEnemy = enemy;
            }
        });

        if (closestEnemy) {
            shoot(closestEnemy.x, closestEnemy.y, "tower", tower);
        }
    });
}

function getDefenseLineX() {
    const targetBarricade = getCurrentDefenseBarricade();
    if (targetBarricade) return targetBarricade.x;
    return player ? player.x : 35;
}

function updateEnemySpecials(now, defenseLineX) {
    enemies.forEach(enemy => {
        if (enemy.special === "frenzy") {
            const hpPercent = enemy.hp / enemy.maxHp;
            let multiplier = 1;
            let attackMultiplier = 1;

            if (hpPercent <= 0.25) {
                multiplier = 2.25;
                attackMultiplier = 0.55;
            } else if (hpPercent <= 0.5) {
                multiplier = 1.55;
                attackMultiplier = 0.75;
            }

            enemy.baseSpeed = enemy.originalBaseSpeed * multiplier;
            enemy.attackDelay = Math.max(360, enemy.originalAttackDelay * attackMultiplier);
        }

        if (enemy.special === "healer" && now - enemy.lastHealTime >= enemy.healDelay) {
            enemy.lastHealTime = now;
            let healedSomeone = false;

            enemies.forEach(other => {
                if (other === enemy || other.hp <= 0 || other.hp >= other.maxHp) return;
                const dist = Math.hypot(other.x - enemy.x, other.y - enemy.y);

                if (dist <= enemy.healRadius) {
                    other.hp = Math.min(other.maxHp, other.hp + enemy.healAmount + Math.floor(wave / 12));
                    other.hitFlash = 0.6;
                    healedSomeone = true;
                    addDamageText(other.x, other.y - other.radius - 8, `+${enemy.healAmount}`, false, "#73ff9f");
                }
            });

            if (healedSomeone) {
                effects.push({
                    type: "circle",
                    x: enemy.x,
                    y: enemy.y,
                    radius: 8,
                    maxRadius: enemy.healRadius,
                    life: 24,
                    color: "#73ff9f"
                });
            }
        }

        if (enemy.special === "teleporter" && !enemy.isAttacking && enemy.x - enemy.radius > defenseLineX + 120 && now - enemy.lastTeleportTime >= enemy.teleportDelay) {
            enemy.lastTeleportTime = now;
            const oldX = enemy.x;
            const oldY = enemy.y;
            enemy.x = Math.max(defenseLineX + 80, enemy.x - (78 + Math.random() * 62));
            enemy.y = clampWorldY(enemy.y + (Math.random() - 0.5) * 120, 45);

            effects.push({ type: "line", x1: oldX, y1: oldY, x2: enemy.x, y2: enemy.y, life: 18, color: "#d58cff" });
            effects.push({ type: "circle", x: enemy.x, y: enemy.y, radius: 6, maxRadius: 40, life: 18, color: "#d58cff" });
        }

        if (enemy.special === "summoner" && !enemy.isAttacking && enemies.length < 85 && now - enemy.lastSummonTime >= enemy.summonDelay) {
            enemy.lastSummonTime = now;

            for (let i = 0; i < 3; i++) {
                spawnMiniEnemy(enemy.x + 18 + i * 14, enemy.y + (i - 1) * 24);
            }

            effects.push({
                type: "circle",
                x: enemy.x,
                y: enemy.y,
                radius: 6,
                maxRadius: 58,
                life: 26,
                color: "#ffffff"
            });
        }

        if (enemy.special === "invisible") {
            if (enemy.invisibleUntil > now) {
                enemy.untargetable = true;
            } else {
                enemy.untargetable = false;
                if (!enemy.isAttacking && now - enemy.lastInvisTime >= enemy.invisDelay) {
                    enemy.lastInvisTime = now;
                    enemy.invisibleUntil = now + enemy.invisDuration;
                    enemy.untargetable = true;
                    effects.push({ type: "circle", x: enemy.x, y: enemy.y, radius: 8, maxRadius: 46, life: 18, color: "#cfcfff" });
                }
            }
        }
    });
}

function fireBossProjectile(x, y, targetX, targetY, options = {}) {
    const angle = Math.atan2(targetY - y, targetX - x) + (options.angleOffset || 0);
    bossProjectiles.push({
        x,
        y,
        dx: Math.cos(angle),
        dy: Math.sin(angle),
        speed: options.speed ?? 3.2,
        radius: options.radius ?? 8,
        damage: options.damage ?? Math.max(2, Math.ceil(2 + wave * 0.12)),
        color: options.color ?? "#ffb36b",
        life: options.life ?? 4200,
        isBossProjectile: true
    });
}

function getBossProjectileBarricadeHit(projectile) {
    return (barricades || []).find(b => {
        if (!b.active || b.hp <= 0) return false;
        const rect = getEntityRect({ ...b, isBuildBarricade: true });
        const cx = Math.max(rect.left, Math.min(rect.right, projectile.x));
        const cy = Math.max(rect.top, Math.min(rect.bottom, projectile.y));
        return Math.hypot(projectile.x - cx, projectile.y - cy) <= projectile.radius + 3;
    });
}

function updateBossSpecials(now, defenseLineX) {
    enemies.forEach(enemy => {
        if (!enemy.isBoss) return;

        if (enemy.bossVariant === "dvd") {
            enemy.y += enemy.dvdVy * gameSpeed * frameScale;
            if (enemy.y < 55 || enemy.y > WORLD_HEIGHT - 55) {
                enemy.dvdVy *= -1;
                enemy.y = clampWorldY(enemy.y, 55);
                fireBossProjectile(enemy.x, enemy.y, player.x, player.y, { speed: 4.2, radius: 8, damage: 4, color: "#9be7ff" });
            }
        }

        if (enemy.bossBurstLeft > 0 && now >= enemy.nextBurstShotAt) {
            enemy.bossBurstLeft--;
            enemy.nextBurstShotAt = now + (enemy.bossBurstDelay || 150);
            fireBossProjectile(enemy.x - 20, enemy.y, player.x, player.y, { speed: 4.8, radius: 7, damage: 4, color: enemy.color, angleOffset: (Math.random() - 0.5) * 0.24 });
        }

        if (now - enemy.lastBossSpecialTime < (enemy.bossSpecialCooldown || 2200)) return;
        enemy.lastBossSpecialTime = now;

        if (enemy.bossVariant === "blink") {
            const oldX = enemy.x;
            const oldY = enemy.y;
            enemy.x = Math.max(defenseLineX + 80, enemy.x - 135);
            enemy.y = clampWorldY(player.y + (Math.random() - 0.5) * 150, 55);
            fireBossProjectile(enemy.x, enemy.y, player.x, player.y, { speed: 5.0, radius: 8, damage: 5, color: "#d58cff" });
            fireBossProjectile(enemy.x, enemy.y, player.x, player.y, { speed: 4.6, radius: 7, damage: 4, color: "#d58cff", angleOffset: 0.18 });
            fireBossProjectile(enemy.x, enemy.y, player.x, player.y, { speed: 4.6, radius: 7, damage: 4, color: "#d58cff", angleOffset: -0.18 });
            enemy.x = clampWorldX(enemy.x + 42, 42);
            effects.push({ type: "line", x1: oldX, y1: oldY, x2: enemy.x, y2: enemy.y, life: 18, color: "#d58cff" });
            effects.push({ type: "circle", x: enemy.x, y: enemy.y, radius: 8, maxRadius: 58, life: 20, color: "#d58cff" });
        }

        if (enemy.bossVariant === "barrage") {
            enemy.bossBurstLeft = enemy.bossBurstShots || 8;
            enemy.nextBurstShotAt = now;
        }

        if (enemy.bossVariant === "mortar") {
            // Mortero mejorado: una lluvia pesada en abanico + dos tiros laterales rápidos.
            for (let i = -2; i <= 2; i++) {
                fireBossProjectile(enemy.x, enemy.y, player.x, player.y + i * 42, { speed: 2.65, radius: 12, damage: 7, color: "#ff4747", life: 5200 });
            }
            fireBossProjectile(enemy.x, enemy.y, player.x, player.y, { speed: 3.45, radius: 8, damage: 4, color: "#ff8a47", angleOffset: 0.32 });
            fireBossProjectile(enemy.x, enemy.y, player.x, player.y, { speed: 3.45, radius: 8, damage: 4, color: "#ff8a47", angleOffset: -0.32 });
            effects.push({ type: "circle", x: player.x, y: player.y, radius: 12, maxRadius: 70, life: 18, color: "#ff4747" });
        }

        if (enemy.bossVariant === "spiral") {
            for (let i = 0; i < 12; i++) {
                const angle = enemy.spiralAngle + (Math.PI * 2 / 12) * i;
                bossProjectiles.push({
                    x: enemy.x, y: enemy.y,
                    dx: Math.cos(angle), dy: Math.sin(angle),
                    speed: 3.2, radius: 7, damage: 4, color: "#73ff9f", life: 3900, isBossProjectile: true
                });
            }
            for (let i = 0; i < 6; i++) {
                const angle = -enemy.spiralAngle + (Math.PI * 2 / 6) * i;
                bossProjectiles.push({
                    x: enemy.x, y: enemy.y,
                    dx: Math.cos(angle), dy: Math.sin(angle),
                    speed: 2.35, radius: 6, damage: 3, color: "#b8ff73", life: 4300, isBossProjectile: true
                });
            }
            enemy.spiralAngle += 0.62;
        }
    });
}

function updateBossProjectiles() {
    for (let i = bossProjectiles.length - 1; i >= 0; i--) {
        const p = bossProjectiles[i];
        p.x += p.dx * p.speed * gameSpeed * frameScale;
        p.y += p.dy * p.speed * gameSpeed * frameScale;
        p.life -= 16.666 * frameScale;

        if (p.x < -80 || p.x > WORLD_WIDTH + 80 || p.y < -80 || p.y > WORLD_HEIGHT + 80 || p.life <= 0) {
            bossProjectiles.splice(i, 1);
            continue;
        }

        const hitBarricade = getBossProjectileBarricadeHit(p);
        if (hitBarricade) {
            if (player && player.shieldCharges > 0) {
                player.shieldCharges--;
                createImpactParticles(hitBarricade.x, p.y, "#9be7ff");
                showCenterMessage("¡Proyectil bloqueado!", 550);
            } else {
                damageBarricade(hitBarricade, p.damage, p);
                createImpactParticles(hitBarricade.x, p.y, p.color);
                addDamageText(hitBarricade.x + 20, p.y - 18, p.damage * BOSS_BARRICADE_DAMAGE_MULTIPLIER, false, "#ffb36b");
            }
            bossProjectiles.splice(i, 1);
            continue;
        }

        if (false && basePlaced && baseCore && Math.hypot(p.x - baseCore.x, p.y - baseCore.y) <= p.radius + BASE_RADIUS) {
            damageBase(p.damage, p.x, p.y);
            bossProjectiles.splice(i, 1);
            continue;
        }

        if (player && Math.hypot(p.x - player.x, p.y - player.y) <= p.radius + 18) {
            if (player.immortal) {
                createImpactParticles(player.x, player.y, "#ffe28a");
            } else {
                player.hp -= p.damage;
                triggerRedFlash();
                createImpactParticles(player.x, player.y, p.color);
                addDamageText(player.x, player.y - 28, p.damage, false, "#ff7777");
                if (player.hp <= 0) {
                    player.hp = 0;
                    endRun();
                }
            }
            bossProjectiles.splice(i, 1);
        }
    }
}

function updateEnemies() {
    const now = getGameTime();
    const defenseLineX = getDefenseLineX();

    updateEnemySpecials(now, defenseLineX);
    updateBossSpecials(now, defenseLineX);

    enemies.forEach(enemy => {
        if (enemy.slowImmune) {
            enemy.speed = enemy.baseSpeed;
            enemy.slowMultiplier = 1;
            enemy.slowUntil = 0;
        } else if (enemy.slowUntil > now) {
            enemy.speed = enemy.baseSpeed * enemy.slowMultiplier;
        } else {
            enemy.speed = enemy.baseSpeed;
            enemy.slowMultiplier = 1;
        }

        if (enemy.hitFlash > 0) enemy.hitFlash -= 0.08 * frameScale;
        if (enemy.knockbackX > 0) {
            const awayX = enemy.x < player.x ? -1 : 1;
            enemy.x += awayX * enemy.knockbackX * gameSpeed * frameScale;
            enemy.knockbackX *= Math.pow(0.75, frameScale);
            if (enemy.knockbackX < 0.1) enemy.knockbackX = 0;
        }
    });

    for (let i = enemies.length - 1; i >= 0; i--) {
        const enemy = enemies[i];
        const mainTarget = getEnemyMainTarget(enemy);
        const blockingBarricade = getBlockingBarricadeForEnemy(enemy, mainTarget.x, mainTarget.y);

        if (blockingBarricade) {
            enemy.isAttacking = true;
            enemy.target = "barricade";

            if (enemy.bossVariant === "dvd") {
                if (now - enemy.lastAttackTime >= enemy.attackDelay) {
                    if (player.shieldCharges > 0) {
                        player.shieldCharges--;
                        createImpactParticles(blockingBarricade.x, blockingBarricade.y, "#9be7ff");
                        showCenterMessage("¡Rebote bloqueado!", 600);
                    } else {
                        damageBarricade(blockingBarricade, enemy.damageToDefense, enemy);
                        createImpactParticles(blockingBarricade.x, blockingBarricade.y, "#9be7ff");
                    }
                    enemy.lastAttackTime = now;
                    enemy.x += (enemy.x < mainTarget.x ? -1 : 1) * 120;
                    enemy.dvdVy *= -1;
                    enemy.isAttacking = false;
                    effects.push({ type: "circle", x: enemy.x, y: enemy.y, radius: 10, maxRadius: 62, life: 18, color: "#9be7ff" });
                }
                continue;
            }

            if (enemy.special === "doombringer") {
                enemy.damageToDefense = Math.min(enemy.damageToDefense || 0, 8);
                enemy.attackDelay = Math.min(enemy.attackDelay || 1600, 1600);
            }

            if (now - enemy.lastAttackTime >= enemy.attackDelay) {
                if (player.shieldCharges > 0) {
                    player.shieldCharges--;
                    createImpactParticles(blockingBarricade.x, blockingBarricade.y, "#9be7ff");
                    showCenterMessage("¡Golpe bloqueado!", 600);
                } else {
                    damageBarricade(blockingBarricade, enemy.damageToDefense, enemy);
                    createImpactParticles(blockingBarricade.x, blockingBarricade.y, "#d6a05f");
                }
                enemy.lastAttackTime = now;
            }
            continue;
        }

        enemy.target = mainTarget.type;
        const dx = mainTarget.x - enemy.x;
        const dy = mainTarget.y - enemy.y;
        const distance = Math.hypot(dx, dy);
        const attackDistance = enemy.radius + mainTarget.radius;

        if (distance > attackDistance) {
            const nx = dx / (distance || 1);
            const ny = dy / (distance || 1);
            enemy.x += nx * enemy.speed * gameSpeed * frameScale;
            enemy.y += ny * enemy.speed * gameSpeed * frameScale;
            enemy.x = clampWorldX(enemy.x, enemy.radius + 3);
            enemy.y = clampWorldY(enemy.y, enemy.radius + 3);
            enemy.isAttacking = false;
            continue;
        }

        enemy.isAttacking = true;

        if (enemy.bossVariant === "dvd") {
            if (now - enemy.lastAttackTime >= enemy.attackDelay) {
                const ended = mainTarget.type === "base"
                    ? damageBase(enemy.damageToDefense, enemy.x, enemy.y)
                    : damagePlayer(enemy.damageToDefense, enemy, enemy.x, enemy.y, "¡Rebote bloqueado!");
                if (ended) return;
                enemy.lastAttackTime = now;
                enemy.x += (enemy.x < mainTarget.x ? -1 : 1) * 120;
                enemy.dvdVy *= -1;
                enemy.isAttacking = false;
                effects.push({ type: "circle", x: enemy.x, y: enemy.y, radius: 10, maxRadius: 62, life: 18, color: "#9be7ff" });
            }
            continue;
        }

        if (enemy.special === "doombringer") {
            if (player && player.immortal) {
                createImpactParticles(enemy.x, enemy.y, "#ffe28a");
                enemies.splice(i, 1);
                showCenterMessage("Titán anulado", 800);
                continue;
            }
            showCenterMessage(mainTarget.type === "base" ? "EL TITÁN DESTRUYÓ EL NÚCLEO" : "EL TITÁN TE ALCANZÓ", 1200);
            if (mainTarget.type === "base") damageBase(9999, enemy.x, enemy.y); else { player.hp = 0; endRun(); }
            return;
        }

        if (now - enemy.lastAttackTime >= enemy.attackDelay) {
            const ended = mainTarget.type === "base"
                ? damageBase(enemy.damageToDefense, enemy.x, enemy.y)
                : damagePlayer(enemy.damageToDefense, enemy, enemy.x, enemy.y, "¡Golpe bloqueado!");
            enemy.lastAttackTime = now;
            if (ended) return;
        }
    }
}

function updateProjectiles() {
    for (let i = projectiles.length - 1; i >= 0; i--) {
        const p = projectiles[i];

        p.x += p.dx * p.speed * gameSpeed * frameScale;
        p.y += p.dy * p.speed * gameSpeed * frameScale;

        if (p.x < -80 || p.x > WORLD_WIDTH + 80 || p.y < -80 || p.y > WORLD_HEIGHT + 80) {
            projectiles.splice(i, 1);
            continue;
        }

        for (let j = enemies.length - 1; j >= 0; j--) {
            const e = enemies[j];

            if (e.untargetable) continue;
            if (p.hitEnemies.includes(e)) continue;

            const dist = Math.hypot(p.x - e.x, p.y - e.y);

            if (dist < p.radius + e.radius) {
                if (p.type === "slow") {
                    createSlowZone(p.x, p.y, p.areaRadius, p.slowAmount, p.slowDuration, p.sourceTower);
                    createImpactParticles(p.x, p.y, p.color);
                    projectiles.splice(i, 1);
                    break;
                }

                if (p.type === "poison") {
                    createPoisonZone(p.x, p.y, p.areaRadius, p.damage || 5, p.poisonDuration, p.tickDelay, p.sourceTower);
                    createImpactParticles(p.x, p.y, p.color);
                    projectiles.splice(i, 1);
                    break;
                }

                let finalDamage = p.damage;

                if (p.type === "pierce" && p.hitsLeft === 1) {
                    finalDamage = p.damage * 0.5;
                }

                if (p.type === "ballista") {
                    e.knockbackX += e.isBoss ? 4 : 12;
                }

                if (e.poisonedUntil && e.poisonedUntil > getGameTime() && p.owner === "tower") {
                    finalDamage *= 1.18;
                }

                damageEnemy(e, finalDamage, p.isCrit, null, p.owner || "unknown");
                applyPlayerLifeSteal(finalDamage, p.owner || "unknown");
                createImpactParticles(p.x, p.y, p.color);

                p.hitEnemies.push(e);
                p.hitsLeft--;

                if (e.hp <= 0) {
                    killEnemy(j);
                }

                if (p.hitsLeft <= 0) {
                    projectiles.splice(i, 1);
                }

                break;
            }
        }
    }
}

function damageEnemy(enemy, amount, isCrit = false, textColor = null, source = "unknown") {
    if (enemy.untargetable) return;
    enemy.hp -= amount;
    enemy.hitFlash = 1;

    playHitSound();

    addDamageText(enemy.x, enemy.y - enemy.radius, amount, isCrit, textColor);
}

function killEnemy(index) {
    const enemy = enemies[index];

    const goldReward = getGoldAmount(enemy.reward);
    coins += goldReward;
    score += enemy.scoreValue;

    waveStats.kills++;
    waveStats.gold += goldReward;
    waveStats.score += enemy.scoreValue;

    createDeathExplosion(enemy.x, enemy.y, enemy.color, enemy.isBoss ? 28 : 14);

    if (enemy.special === "exploder") {
        explodeEnemyOnDeath(enemy);
    }

    if (enemy.special === "splitter" && (enemy.splitLevel || 0) < 2) {
        splitEnemy(enemy);
    }

    enemies.splice(index, 1);
}

function splitEnemy(enemy) {
    const nextLevel = (enemy.splitLevel || 0) + 1;
    const childType = {
        name: nextLevel >= 2 ? "Fractal Chico" : "Fractal Partido",
        color: enemy.color,
        hp: Math.max(1, Math.ceil(enemy.maxHp * 0.48)),
        speed: enemy.originalBaseSpeed * 1.18,
        reward: Math.max(1, Math.floor(enemy.reward * 0.35)),
        score: Math.max(2, Math.floor(enemy.scoreValue * 0.35)),
        damageToDefense: 1,
        attackDelay: Math.max(620, enemy.originalAttackDelay * 0.85),
        special: "splitter",
        splitLevel: nextLevel
    };

    for (let i = 0; i < 2; i++) {
        enemies.push(createEnemyFromType(childType, {
            x: enemy.x + 18,
            y: clampWorldY(enemy.y + (i === 0 ? -22 : 22), 42),
            radius: Math.max(10, enemy.radius * 0.78),
            ignoreScaling: true,
            splitLevel: nextLevel
        }));
    }
}

function createSlowZone(x, y, radius, slowAmount, duration, sourceTower = null) {
    const now = getGameTime();
    const expiresAt = now + duration;

    slowZones.push({
        x,
        y,
        radius,
        createdAt: now,
        expiresAt,
        slowAmount,
        sourceTower
    });

    if (sourceTower) {
        // La torre de hielo puede volver a castear recién cuando a su propia zona
        // le quede la mitad de duración. Esto evita el spam infinito al mejorarla.
        sourceTower.activeSlowZoneNextShotAt = now + duration / 2;
    }

    enemies.forEach(enemy => {
        const dist = Math.hypot(enemy.x - x, enemy.y - y);

        if (dist <= radius && !enemy.slowImmune) {
            enemy.slowMultiplier = slowAmount;
            enemy.slowUntil = expiresAt;
        }
    });
}


function createPoisonZone(x, y, radius, damage, duration, tickDelay, sourceTower = null) {
    const now = getGameTime();
    const expiresAt = now + duration;

    poisonZones.push({
        x,
        y,
        radius,
        damage,
        tickDelay,
        nextTickAt: now,
        expiresAt,
        sourceTower
    });

    if (sourceTower) {
        // La torre de veneno no puede crear otra zona hasta que termine
        // la zona activa que generó esta misma torre.
        sourceTower.activePoisonZoneExpiresAt = expiresAt;
    }

    effects.push({
        type: "circle",
        x,
        y,
        radius: 8,
        maxRadius: radius,
        life: 28,
        color: "#8cff4a"
    });
}

function updatePoisonZones() {
    const now = getGameTime();

    for (let i = poisonZones.length - 1; i >= 0; i--) {
        const zone = poisonZones[i];

        if (zone.expiresAt <= now) {
            poisonZones.splice(i, 1);
            continue;
        }

        if (now >= zone.nextTickAt) {
            zone.nextTickAt += zone.tickDelay;

            enemies.forEach(enemy => {
                const dist = Math.hypot(enemy.x - zone.x, enemy.y - zone.y);

                if (dist <= zone.radius) {
                    enemy.poisonedUntil = now + 1400;
                    damageEnemy(enemy, zone.damage, false, "#8cff4a", "poison");
                }
            });

            for (let j = enemies.length - 1; j >= 0; j--) {
                if (enemies[j].hp <= 0) killEnemy(j);
            }
        }
    }
}


function createFireZone(x, y, radius, damage, duration, tickDelay) {
    const now = getGameTime();

    fireZones.push({
        x,
        y,
        radius,
        damage,
        tickDelay,
        nextTickAt: now,
        expiresAt: now + duration
    });

    effects.push({
        type: "circle",
        x,
        y,
        radius: 10,
        maxRadius: radius,
        life: 24,
        color: "#ff8d2a"
    });
}

function updateFireZones() {
    const now = getGameTime();

    for (let i = fireZones.length - 1; i >= 0; i--) {
        const zone = fireZones[i];

        if (zone.expiresAt <= now) {
            fireZones.splice(i, 1);
            continue;
        }

        if (now >= zone.nextTickAt) {
            zone.nextTickAt += zone.tickDelay;

            enemies.forEach(enemy => {
                const dist = Math.hypot(enemy.x - zone.x, enemy.y - zone.y);

                if (dist <= zone.radius) {
                    damageEnemy(enemy, zone.damage, false, "#ffb36b", "fire");
                }
            });

            for (let j = enemies.length - 1; j >= 0; j--) {
                if (enemies[j].hp <= 0) killEnemy(j);
            }
        }
    }
}

function updateEclipseEffects() {
    const now = getGameTime();

    effects.forEach(effect => {
        if (effect.type !== "eclipse" || effect.finalDone) return;

        if (now < effect.expiresAt && now >= effect.nextPulseAt) {
            effect.nextPulseAt += 520;
            effect.pulseRadius = 20;

            enemies.forEach(enemy => {
                const dist = Math.hypot(enemy.x - effect.x, enemy.y - effect.y);

                if (dist <= effect.radius) {
                    if (!enemy.slowImmune) {
                        enemy.slowMultiplier = 0.22;
                        enemy.slowUntil = now + 850;
                    }
                    damageEnemy(enemy, effect.pulseDamage, false, "#b78cff", "eclipse");
                }
            });

            for (let j = enemies.length - 1; j >= 0; j--) {
                if (enemies[j].hp <= 0) killEnemy(j);
            }
        }

        if (now >= effect.expiresAt) {
            effect.finalDone = true;
            effects.push({ type: "circle", x: effect.x, y: effect.y, radius: 18, maxRadius: effect.radius + 35, life: 32, color: "#d7c2ff" });

            enemies.forEach(enemy => {
                const dist = Math.hypot(enemy.x - effect.x, enemy.y - effect.y);
                if (dist <= effect.radius && !enemy.isBoss && enemy.hp <= enemy.maxHp * effect.executePercent) {
                    enemy.hp = 0;
                    addDamageText(enemy.x, enemy.y - enemy.radius - 10, "EJEC", true, "#d7c2ff");
                }
            });

            for (let j = enemies.length - 1; j >= 0; j--) {
                if (enemies[j].hp <= 0) killEnemy(j);
            }
        }
    });
}

function explodeEnemyOnDeath(enemy) {
    const radius = enemy.explosionRadius || 78;
    const damage = enemy.explosionDamage || 10;

    effects.push({
        type: "circle",
        x: enemy.x,
        y: enemy.y,
        radius: 10,
        maxRadius: radius,
        life: 30,
        color: "#ff4747"
    });

    enemies.forEach(other => {
        if (other === enemy || other.hp <= 0) return;
        const dist = Math.hypot(other.x - enemy.x, other.y - enemy.y);
        if (dist <= radius) damageEnemy(other, Math.max(1, Math.floor(damage * 0.45)), false, "#ff8a8a");
    });

    let hitBarricade = false;
    (barricades || []).forEach(b => {
        if (b.active && b.hp > 0 && Math.abs(enemy.x - b.x) <= radius) {
            hitBarricade = true;
            damageBarricade(b, damage, enemy);
            showCenterMessage("¡Barricada detonada!", 1000);
        }
    });

    if (!hitBarricade && enemy.x <= 35 + radius) {
        player.hp = Math.max(0, player.hp - Math.ceil(damage * 0.45));
        triggerRedFlash();
        if (player.hp <= 0) endRun();
    }
}

function updateSlowZones() {
    const now = getGameTime();

    for (let i = slowZones.length - 1; i >= 0; i--) {
        if (slowZones[i].expiresAt <= now) {
            slowZones.splice(i, 1);
        }
    }
}

function addDamageText(x, y, amount, isCrit = false, textColor = null) {
    const text = typeof amount === "string" ? amount : (isCrit ? `CRIT ${Math.round(amount)}` : `${Math.round(amount)}`);

    damageTexts.push({
        x,
        y,
        text,
        life: 60,
        color: textColor || (isCrit ? "#ffe28a" : "white"),
        size: isCrit ? 22 : 15
    });

    if (damageTexts.length > MAX_DAMAGE_TEXTS) {
        damageTexts.splice(0, damageTexts.length - MAX_DAMAGE_TEXTS);
    }
}

function createImpactParticles(x, y, color) {
    if (particles.length > MAX_PARTICLES) return;

    for (let i = 0; i < 5; i++) {
        particles.push({
            x,
            y,
            dx: (Math.random() - 0.5) * 3,
            dy: (Math.random() - 0.5) * 3,
            radius: 2 + Math.random() * 2,
            life: 24,
            color
        });
    }
}

function createDeathExplosion(x, y, color, count) {
    for (let i = 0; i < count; i++) {
        particles.push({
            x,
            y,
            dx: (Math.random() - 0.5) * 5,
            dy: (Math.random() - 0.5) * 5,
            radius: 2 + Math.random() * 3,
            life: 36,
            color
        });
    }

    effects.push({
        type: "circle",
        x,
        y,
        radius: 8,
        maxRadius: count > 20 ? 90 : 42,
        life: 26,
        color
    });

    if (particles.length > MAX_PARTICLES) particles.splice(0, particles.length - MAX_PARTICLES);
    if (effects.length > MAX_EFFECTS) effects.splice(0, effects.length - MAX_EFFECTS);
}

function updateVisualEffects() {
    for (let i = damageTexts.length - 1; i >= 0; i--) {
        const t = damageTexts[i];
        t.y -= 0.7 * frameScale;
        t.life -= frameScale;

        if (t.life <= 0) damageTexts.splice(i, 1);
    }

    for (let i = particles.length - 1; i >= 0; i--) {
        const p = particles[i];
        p.x += p.dx * frameScale;
        p.y += p.dy * frameScale;
        p.life -= frameScale;

        if (p.life <= 0) particles.splice(i, 1);
    }

    for (let i = effects.length - 1; i >= 0; i--) {
        const e = effects[i];
        e.life -= frameScale;

        if (e.type === "circle") {
            e.radius += (e.maxRadius - e.radius) * 0.18;
        }

        if (e.type === "tsunami") {
            e.x += 16 * gameSpeed * frameScale;
        }

        if (e.life <= 0) effects.splice(i, 1);
    }

    if (redFlashAlpha > 0) {
        redFlashAlpha -= 0.04 * frameScale;
        if (redFlashAlpha < 0) redFlashAlpha = 0;
    }

    redFlash.style.background = `rgba(255, 0, 0, ${redFlashAlpha})`;
}

function triggerRedFlash() {
    redFlashAlpha = 0.35;
}

function showCenterMessage(text, duration) {
    centerMessage.textContent = text;
    centerMessage.classList.remove("hidden");

    setTimeout(() => {
        centerMessage.classList.add("hidden");
    }, duration);
}

function checkWaveComplete() {
    if (
        enemiesSpawned >= enemiesToSpawn &&
        enemies.length === 0 &&
        waveInProgress
    ) {
        completeWave();
    }
}

function completeWave() {
    waveInProgress = false;
    gameRunning = false;

    const waveBonus = wave * 20;
    const goldBonus = getGoldAmount(8 + Math.floor(wave * 1.5));

    score += waveBonus;
    coins += goldBonus;

    waveStats.score += waveBonus;
    waveStats.gold += goldBonus;
    waveStats.bonus = waveBonus;

    autoSaveRun(true);


    if (autoMode) {
        showCenterMessage(`Wave ${wave} completada`, 700);

        setTimeout(() => {
            if (!autoMode) {
                showWaveSummary();
                return;
            }

            if (!hasActiveRun) return;

            wave++;
            isRepeatingWave = false;
            currentGoldMultiplier = 1;
            startWave();
        }, 900);

        return;
    }

    showWaveSummary();
}

function showWaveSummary() {
    syncMusicState();
    summaryKillsText.textContent = waveStats.kills;
    summaryGoldText.textContent = formatMoney(waveStats.gold);
    summaryScoreText.textContent = formatCompactNumber(waveStats.score);
    summaryHpText.textContent = `${Math.round(player.hp)}/${player.maxHp}`;
    summaryBarricadeText.textContent = `${Math.round(getTotalBarricadeHp())}/${Math.round(getTotalBarricadeMaxHp())}`;
    summaryBonusText.textContent = formatCompactNumber(waveStats.bonus);

    waveSummaryPanel.classList.remove("hidden");
    autoSaveRun(true);
}

function getLeaderboardPlayerName() {
    return String(developerName || alphaTesterName || playerName || "Jugador").trim().slice(0, 18) || "Jugador";
}

function formatLeaderboardNumber(value) {
    return formatCompactNumber(value);
}

function setLeaderboardStatus(message) {
    if (leaderboardStatusText) leaderboardStatusText.textContent = message;
    if (leaderboardGameStatusText) leaderboardGameStatusText.textContent = message;
}

function renderLeaderboard(scores = []) {
    const lists = [leaderboardList, leaderboardGameList].filter(Boolean);

    lists.forEach(list => {
        list.innerHTML = "";

        if (!scores.length) {
            const li = document.createElement("li");
            li.textContent = "Todavía no hay puntuaciones guardadas.";
            list.appendChild(li);
            return;
        }

        scores.forEach(entry => {
            const li = document.createElement("li");
            const waveText = entry.wave ? `Wave ${entry.wave}` : "Wave ?";
            const dateText = entry.date ? new Date(entry.date).toLocaleDateString("es-AR") : "";
            const name = String(entry.name || "Jugador").slice(0, 18);
            const scoreValue = formatLeaderboardNumber(entry.score);

            li.innerHTML = `
                <div class="leaderboardEntry">
                    <div>
                        <div class="leaderboardName"></div>
                        <div class="leaderboardMeta">${waveText}${dateText ? " · " + dateText : ""}</div>
                    </div>
                    <div class="leaderboardScore">${scoreValue}</div>
                </div>
            `;

            li.querySelector(".leaderboardName").textContent = name;
            list.appendChild(li);
        });
    });
}

async function loadLeaderboard() {
    try {
        setLeaderboardStatus("Cargando leaderboard...");
        const response = await fetch("/api/leaderboard", { cache: "no-store" });
        const data = await response.json();

        if (!response.ok) throw new Error(data.message || "No se pudo cargar el leaderboard.");

        renderLeaderboard(Array.isArray(data.scores) ? data.scores : []);

        if (data.configured === false) {
            setLeaderboardStatus("Leaderboard local listo. Falta configurar KV_REST_API_URL y KV_REST_API_TOKEN en Vercel.");
        } else {
            setLeaderboardStatus("Top global actualizado.");
        }
    } catch (error) {
        console.log("Leaderboard load error:", error);
        renderLeaderboard([]);
        setLeaderboardStatus("No se pudo conectar al leaderboard global todavía.");
    }
}

function disqualifyRunFromLeaderboard(commandName) {
    runDisqualifiedFromLeaderboard = true;
    leaderboardDisqualificationReason = commandName || "comando ilegal";
    appendConsoleLog(`Leaderboard desactivado para esta run por usar: ${leaderboardDisqualificationReason}.`);
    saveRunNow();
}

async function submitLeaderboardScore() {
    if (!score || score <= 0) {
        await loadLeaderboard();
        return;
    }

    if (runDisqualifiedFromLeaderboard) {
        await loadLeaderboard();
        const reason = leaderboardDisqualificationReason ? ` (${leaderboardDisqualificationReason})` : "";
        setLeaderboardStatus(`Run no enviada al leaderboard por uso de comando ilegal${reason}.`);
        return;
    }

    try {
        setLeaderboardStatus("Guardando puntuación...");

        const payload = {
            name: getLeaderboardPlayerName(),
            score: Math.max(0, Math.floor(score)),
            wave: Math.max(1, Math.floor(wave || 1)),
            version: "0.7.5.1"
        };

        const response = await fetch("/api/leaderboard", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload)
        });

        const data = await response.json();

        if (!response.ok) throw new Error(data.message || "No se pudo guardar la puntuación.");

        renderLeaderboard(Array.isArray(data.scores) ? data.scores : []);

        if (data.configured === false) {
            setLeaderboardStatus("Puntuación no guardada online: falta configurar Vercel KV.");
        } else {
            setLeaderboardStatus("Puntuación guardada en el leaderboard global.");
        }
    } catch (error) {
        console.log("Leaderboard submit error:", error);
        setLeaderboardStatus("No se pudo guardar online. Revisá la configuración de Vercel KV.");
        await loadLeaderboard();
    }
}

function endRun() {
    clearSavedRun();
    stopMusicAndReset();
    hasActiveRun = false;
    isPaused = false;
    gameRunning = false;
    waveInProgress = false;

    enemies = [];
    projectiles = [];
    bossProjectiles = [];
    slowZones = [];
    poisonZones = [];
    fireZones = [];

    const isNewRecord = score > bestScore;

    if (isNewRecord) {
        bestScore = score;
        localStorage.setItem("towerDefenseBestScore", bestScore);
        deathMessageText.textContent = "¡Nuevo récord! El jugador cayó, pero esta run fue la mejor hasta ahora.";
    } else {
        deathMessageText.textContent = "El jugador cayó. La run terminó y el progreso se reinició.";
    }

    finalScoreText.textContent = formatCompactNumber(score);
    bestScoreText.textContent = formatCompactNumber(bestScore);
    bestScoreMenuText.textContent = formatCompactNumber(bestScore);

    gameOverScreen.classList.remove("hidden");
    closeShop();
    waveSummaryPanel.classList.add("hidden");

    submitLeaderboardScore();
    updateHud();
}

function healOverTime(totalHeal, durationMs) {
    if (!gameStarted || !player || totalHeal <= 0) return;

    const ticks = 10;
    const tickDuration = durationMs / ticks;
    const startHp = player.hp;
    const maxFinalHp = Math.min(player.maxHp, startHp + totalHeal);
    let currentTick = 0;

    const interval = setInterval(() => {
        if (!gameStarted || !player) {
            clearInterval(interval);
            return;
        }

        currentTick++;
        const progress = Math.min(1, currentTick / ticks);

        // En vez de sumar decimales y redondear cada tick, calculamos contra
        // el HP inicial. Así la poción cura exactamente lo que promete, salvo
        // cuando choca contra la vida máxima.
        player.hp = Math.min(player.maxHp, startHp + (maxFinalHp - startHp) * progress);

        if (currentTick >= ticks || player.hp >= player.maxHp) {
            player.hp = maxFinalHp;
            clearInterval(interval);
        }

        updateHud();
    }, tickDuration);
}

function useAbility(id) {
    if (!gameRunning || !waveInProgress) return;

    const ability = abilities[id];
    if (!ability || !ability.owned) return;

    const now = getGameTime();

    if (now - ability.lastUsed < ability.cooldown) return;

    ability.lastUsed = now;

    if (id === "bomb") useBomb();
    if (id === "freeze") useFreeze();
    if (id === "tsunami") useTsunami();
    if (id === "lightning") useLightning();
    if (id === "meteor") useMeteor();
    if (id === "eclipse") useEclipse();

    updateHud();
}

function getAbilityDamage(base, waveScale = 1, playerScale = 1) {
    return base + wave * waveScale + player.damage * playerScale;
}

function useBomb() {
    const radius = 78 + Math.min(28, player.damage * 1.5);
    const damage = getAbilityDamage(12, 0.8, 2.8);

    effects.push({
        type: "circle",
        x: mousePosition.x,
        y: mousePosition.y,
        radius: 10,
        maxRadius: radius,
        life: 24,
        color: "#ff5555"
    });

    damageEnemiesInArea(mousePosition.x, mousePosition.y, radius, damage, false);
}

function useFreeze() {
    const now = getGameTime();

    enemies.forEach(enemy => {
        if (enemy.slowImmune) return;
        enemy.slowMultiplier = 0.25;
        enemy.slowUntil = now + 3500 + Math.min(1600, player.damage * 90);
    });

    effects.push({
        type: "circle",
        x: player.x,
        y: player.y,
        radius: 20,
        maxRadius: 480,
        life: 35,
        color: "#9be7ff"
    });

    showCenterMessage("¡CONGELAR!", 900);
}

function useTsunami() {
    const damage = getAbilityDamage(8, 0.62, 2.2);
    const push = 72 + Math.min(36, player.damage * 2.2);

    enemies.forEach(enemy => {
        if (enemy.tsunamiImmune) {
            addDamageText(enemy.x, enemy.y - enemy.radius - 8, "INMUNE", false, "#9be7ff");
            effects.push({ type: "circle", x: enemy.x, y: enemy.y, radius: 6, maxRadius: 34, life: 18, color: "#4aa3ff" });
            return;
        }

        enemy.x += enemy.isBoss ? push * 0.38 : push;
        damageEnemy(enemy, damage, false);
    });

    for (let i = enemies.length - 1; i >= 0; i--) {
        if (enemies[i].hp <= 0) killEnemy(i);
    }

    effects.push({
        type: "tsunami",
        x: -80,
        y: 0,
        width: 80,
        height: GAME_HEIGHT,
        life: 70,
        color: "#4aa3ff"
    });

    showCenterMessage("¡TSUNAMI!", 900);
}

function useLightning() {
    if (enemies.length === 0) return;

    const chains = [];
    let current = findClosestEnemy(mousePosition.x, mousePosition.y, Infinity);
    let damage = getAbilityDamage(20, 0.9, 4.1);
    const maxChains = player.damage >= 8 ? 5 : 4;

    for (let i = 0; i < maxChains; i++) {
        if (!current) break;

        chains.push(current);
        damageEnemy(current, damage, true);

        const next = findClosestEnemy(current.x, current.y, 150 + Math.min(55, player.damage * 3), chains);
        current = next;
        damage *= 0.75;
    }

    for (let i = enemies.length - 1; i >= 0; i--) {
        if (enemies[i].hp <= 0) killEnemy(i);
    }

    for (let i = 0; i < chains.length - 1; i++) {
        effects.push({
            type: "line",
            x1: chains[i].x,
            y1: chains[i].y,
            x2: chains[i + 1].x,
            y2: chains[i + 1].y,
            life: 14,
            color: "#f7ff61"
        });
    }

    if (chains.length > 0) {
        effects.push({
            type: "line",
            x1: mousePosition.x,
            y1: mousePosition.y,
            x2: chains[0].x,
            y2: chains[0].y,
            life: 14,
            color: "#f7ff61"
        });
    }
}

function useMeteor() {
    const radius = 128 + Math.min(34, player.damage * 1.8);
    const damage = getAbilityDamage(42, 1.3, 5);

    effects.push({
        type: "circle",
        x: mousePosition.x,
        y: mousePosition.y,
        radius: 12,
        maxRadius: radius,
        life: 34,
        color: "#ff8d2a"
    });

    damageEnemiesInArea(mousePosition.x, mousePosition.y, radius, damage, true);
    createFireZone(mousePosition.x, mousePosition.y, radius * 0.78, getAbilityDamage(4, 0.18, 0.9), 1500, 300);
    showCenterMessage("¡METEORITO!", 900);
}

function useEclipse() {
    const now = getGameTime();
    const radius = 185 + Math.min(50, player.damage * 2.2);

    effects.push({
        type: "eclipse",
        x: GAME_WIDTH / 2,
        y: GAME_HEIGHT / 2,
        radius,
        pulseRadius: 20,
        life: 240,
        maxLife: 240,
        nextPulseAt: now,
        expiresAt: now + 4200,
        pulseDamage: getAbilityDamage(5, 0.32, 1.7),
        executePercent: 0.18 + Math.min(0.08, player.damage * 0.004),
        finalDone: false,
        color: "#7d55ff"
    });

    showCenterMessage("¡ECLIPSE!", 900);
}

function damageEnemiesInArea(x, y, radius, damage, critText) {
    enemies.forEach(enemy => {
        const dist = Math.hypot(enemy.x - x, enemy.y - y);

        if (dist <= radius) {
            damageEnemy(enemy, damage, critText);
            enemy.knockbackX += enemy.isBoss ? 8 : 18;
        }
    });

    for (let i = enemies.length - 1; i >= 0; i--) {
        if (enemies[i].hp <= 0) killEnemy(i);
    }
}

function findClosestEnemy(x, y, maxDistance = Infinity, ignored = []) {
    let closest = null;
    let closestDistance = Infinity;

    enemies.forEach(enemy => {
        if (ignored.includes(enemy)) return;

        const distance = Math.hypot(enemy.x - x, enemy.y - y);

        if (distance < closestDistance && distance <= maxDistance) {
            closestDistance = distance;
            closest = enemy;
        }
    });

    return closest;
}

function drawPath() {
    // Camino visual desactivado: se mantiene la lógica del juego,
    // pero ya no se dibuja la franja gris horizontal.
}

function drawBase() {
    if (!basePlaced || !baseCore) return;
    ctx.save();
    ctx.fillStyle = "#ffe28a";
    ctx.beginPath();
    ctx.arc(baseCore.x, baseCore.y, BASE_RADIUS, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "rgba(0,0,0,0.65)";
    ctx.lineWidth = 4;
    ctx.stroke();
    ctx.fillStyle = "black";
    ctx.font = "bold 14px Arial";
    ctx.textAlign = "center";
    ctx.fillText("BASE", baseCore.x, baseCore.y + 5);
    const hpPercent = baseCore.maxHp > 0 ? Math.max(0, baseCore.hp / baseCore.maxHp) : 0;
    ctx.fillStyle = "red";
    ctx.fillRect(baseCore.x - 38, baseCore.y - 52, 76, 8);
    ctx.fillStyle = "lime";
    ctx.fillRect(baseCore.x - 38, baseCore.y - 52, 76 * hpPercent, 8);
    ctx.restore();
}

function drawBarricade() {
    (barricades || []).forEach(b => {
        if (!b.active || b.hp <= 0) return;
        const dims = getBarricadeDimensions(b.orientation || "horizontal");
        const rect = getEntityRect({ ...b, isBuildBarricade: true });
        ctx.fillStyle = b.color;
        ctx.fillRect(rect.left, rect.top, dims.width, dims.height);
        ctx.strokeStyle = isStructureSelected("barricade", b.id) ? "#ffe28a" : "rgba(0,0,0,0.7)";
        ctx.lineWidth = isStructureSelected("barricade", b.id) ? 4 : 2;
        ctx.strokeRect(rect.left, rect.top, dims.width, dims.height);

        if (b.thorns) {
            ctx.fillStyle = "#ff9f55";
            for (let i = 0; i < 5; i++) {
                const tx = rect.left + 10 + i * (dims.width / 5);
                const ty = rect.top + dims.height / 2;
                ctx.beginPath();
                ctx.moveTo(tx, ty);
                ctx.lineTo(tx + 10, ty - 9);
                ctx.lineTo(tx + 20, ty);
                ctx.fill();
            }
        }

        const hpPercent = b.maxHp > 0 ? Math.max(0, b.hp / b.maxHp) : 0;
        ctx.fillStyle = "red";
        ctx.fillRect(rect.left, rect.top - 9, dims.width, 5);
        ctx.fillStyle = "lime";
        ctx.fillRect(rect.left, rect.top - 9, dims.width * hpPercent, 5);
    });
}

function drawBuildPreview() {
    if (pendingBarricadePlacement) {
        const point = getSnappedBuildPoint();
        const dims = getBarricadeDimensions(barricadeBuildOrientation);
        const valid = isBarricadePositionValid(point.x, point.y, barricadeBuildOrientation);
        ctx.fillStyle = valid ? "rgba(115,255,159,0.35)" : "rgba(255,80,80,0.35)";
        ctx.fillRect(point.x - dims.width / 2, point.y - dims.height / 2, dims.width, dims.height);
        ctx.strokeStyle = valid ? "rgba(115,255,159,0.95)" : "rgba(255,80,80,0.95)";
        ctx.lineWidth = 3;
        ctx.strokeRect(point.x - dims.width / 2, point.y - dims.height / 2, dims.width, dims.height);
        ctx.fillStyle = "white";
        ctx.font = "bold 14px Arial";
        ctx.fillText("Click coloca · R rota · Click derecho/Esc cancela", point.x - 150, point.y - dims.height / 2 - 12);
    }
}

function drawPlayer() {
    if (player.immortal) {
        ctx.strokeStyle = "rgba(255, 226, 138, 0.8)";
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(player.x, player.y, 29, 0, Math.PI * 2);
        ctx.stroke();
    }

    ctx.fillStyle = "white";
    ctx.beginPath();
    ctx.arc(player.x, player.y, 22, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = "black";
    ctx.font = "14px Arial";
    ctx.fillText("P", player.x - 5, player.y + 5);

    if (player.name) {
        if (player.developer) {
            drawDeveloperName(player.name, player.x, player.y - 31);
        } else if (player.alphaTester) {
            drawAlphaTesterName(player.name, player.x, player.y - 31);
        } else {
            ctx.fillStyle = "white";
            ctx.font = "11px Arial";
            const textWidth = ctx.measureText(player.name).width;
            ctx.fillText(player.name, player.x - textWidth / 2, player.y - 31);
        }
    }
}

function drawAlphaTesterName(name, x, y) {
    ctx.save();

    ctx.textAlign = "center";
    ctx.font = "bold 9px Arial";
    ctx.lineWidth = 3;
    ctx.strokeStyle = "rgba(0, 0, 0, 0.85)";
    ctx.fillStyle = "#ff3333";
    ctx.strokeText("ALPHA TESTER", x, y - 13);
    ctx.fillText("ALPHA TESTER", x, y - 13);

    ctx.font = "bold 12px Arial";
    const chars = [...name];
    const widths = chars.map(char => ctx.measureText(char).width);
    const totalWidth = widths.reduce((sum, width) => sum + width, 0);
    let cursor = x - totalWidth / 2;
    const hueOffset = (getGameTime() * 0.08) % 360;

    ctx.textAlign = "left";
    chars.forEach((char, index) => {
        const charX = cursor;
        const hue = (hueOffset + index * 55) % 360;
        ctx.lineWidth = 3;
        ctx.strokeStyle = "rgba(0, 0, 0, 0.85)";
        ctx.fillStyle = `hsl(${hue}, 100%, 62%)`;
        ctx.strokeText(char, charX, y);
        ctx.fillText(char, charX, y);
        cursor += widths[index];
    });

    ctx.restore();
}

function drawDeveloperName(name, x, y) {
    ctx.save();

    ctx.textAlign = "center";
    ctx.font = "bold 9px Arial";
    ctx.lineWidth = 3;
    ctx.strokeStyle = "rgba(0, 0, 0, 0.9)";
    ctx.fillStyle = "#ff2b2b";
    ctx.strokeText("DEVELOPER", x, y - 13);
    ctx.fillText("DEVELOPER", x, y - 13);

    ctx.font = "bold 12px Arial";
    const pulse = 55 + Math.sin(getGameTime() * 0.008) * 18;
    const gradient = ctx.createLinearGradient(x - 42, y - 10, x + 42, y + 4);
    gradient.addColorStop(0, `hsl(42, 100%, ${pulse}%)`);
    gradient.addColorStop(0.5, `hsl(52, 100%, ${Math.min(78, pulse + 14)}%)`);
    gradient.addColorStop(1, `hsl(34, 100%, ${pulse}%)`);

    ctx.lineWidth = 4;
    ctx.strokeStyle = "rgba(0, 0, 0, 0.9)";
    ctx.fillStyle = gradient;
    ctx.strokeText(name, x, y);
    ctx.fillText(name, x, y);

    ctx.restore();
}

function activateDeveloperBadge(name = "Alene") {
    developerName = name;
    alphaTesterName = "";
    playerName = name;
    localStorage.setItem("ardentDeveloperName", developerName);
    localStorage.removeItem("ardentAlphaTesterName");
    localStorage.setItem("ardentPlayerName", playerName);

    if (player) {
        player.name = name;
        player.developer = true;
        player.alphaTester = false;
    }

    if (playerNameInput) playerNameInput.value = name;
}

function activateAlphaTesterBadge(name) {
    alphaTesterName = name;
    developerName = "";
    playerName = name;
    localStorage.setItem("ardentAlphaTesterName", alphaTesterName);
    localStorage.removeItem("ardentDeveloperName");
    localStorage.setItem("ardentPlayerName", playerName);

    if (player) {
        player.name = name;
        player.alphaTester = true;
        player.developer = false;
    }

    if (playerNameInput) playerNameInput.value = name;
}


function drawTowerPlacementTiles() {
    const movingTower = pendingTowerMoveIndex !== null ? towers[pendingTowerMoveIndex] : null;
    if (!pendingTowerPurchase && !movingTower) {
        drawBuildPreview();
        return;
    }

    const point = getSnappedBuildPoint();
    const def = pendingTowerPurchase ? getTowerDefinition(pendingTowerPurchase.defKey) : movingTower;
    const valid = !isTowerPositionOccupied(point.x, point.y, movingTower);

    ctx.fillStyle = valid ? "rgba(115,255,159,0.35)" : "rgba(255,80,80,0.35)";
    ctx.beginPath();
    ctx.arc(point.x, point.y, TOWER_COLLISION_RADIUS, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = valid ? "rgba(115,255,159,0.95)" : "rgba(255,80,80,0.95)";
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(point.x, point.y, TOWER_COLLISION_RADIUS, 0, Math.PI * 2);
    ctx.stroke();

    if (def) {
        ctx.strokeStyle = "rgba(255,255,255,0.28)";
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(point.x, point.y, def.range || 0, 0, Math.PI * 2);
        ctx.stroke();
    }

    ctx.fillStyle = "rgba(0,0,0,0.72)";
    ctx.fillRect(camera.x + 110, camera.y + 12, 680, 34);
    ctx.fillStyle = "white";
    ctx.font = "bold 15px Arial";
    const actionText = movingTower ? "Elegí dónde mover la torreta" : "Elegí dónde colocar la torreta";
    ctx.fillText(`${actionText} · Click derecho/Esc cancela`, camera.x + 125, camera.y + 34);
}

function drawTowers() {
    towers.forEach(tower => {
        if (!tower.owned) return;

        if (isStructureSelected("tower", tower.id)) {
            ctx.strokeStyle = "#ffe28a";
            ctx.lineWidth = 4;
            ctx.strokeRect(tower.x - 24, tower.y - 24, 48, 48);
        }

        ctx.fillStyle = tower.color;
        ctx.fillRect(tower.x - 18, tower.y - 18, 36, 36);

        ctx.fillStyle = tower.type === "buffer" ? "white" : "black";
        ctx.font = "bold 14px Arial";
        ctx.fillText(tower.label || tower.name[0], tower.x - 5, tower.y + 5);

        ctx.fillStyle = "white";
        ctx.font = "10px Arial";
        ctx.fillText(String(tower.slotIndex + 1), tower.x - 17, tower.y - 20);

        ctx.strokeStyle = tower.type === "buffer" ? "rgba(183,140,255,0.18)" : "rgba(255,255,255,0.08)";
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(tower.x, tower.y, tower.range, 0, Math.PI * 2);
        ctx.stroke();
    });
}

function drawSlowZones() {
    poisonZones.forEach(zone => {
        ctx.fillStyle = "rgba(140, 255, 74, 0.13)";
        ctx.beginPath();
        ctx.arc(zone.x, zone.y, zone.radius, 0, Math.PI * 2);
        ctx.fill();

        ctx.strokeStyle = "rgba(140, 255, 74, 0.42)";
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(zone.x, zone.y, zone.radius, 0, Math.PI * 2);
        ctx.stroke();
    });

    fireZones.forEach(zone => {
        const alpha = Math.max(0.05, (zone.expiresAt - getGameTime()) / 1500 * 0.22);
        ctx.fillStyle = `rgba(255, 141, 42, ${alpha})`;
        ctx.beginPath();
        ctx.arc(zone.x, zone.y, zone.radius, 0, Math.PI * 2);
        ctx.fill();

        ctx.strokeStyle = "rgba(255, 179, 107, 0.48)";
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(zone.x, zone.y, zone.radius, 0, Math.PI * 2);
        ctx.stroke();
    });

    slowZones.forEach(zone => {
        ctx.fillStyle = "rgba(155, 231, 255, 0.18)";
        ctx.beginPath();
        ctx.arc(zone.x, zone.y, zone.radius, 0, Math.PI * 2);
        ctx.fill();

        ctx.strokeStyle = "rgba(155, 231, 255, 0.5)";
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(zone.x, zone.y, zone.radius, 0, Math.PI * 2);
        ctx.stroke();
    });
}

function drawEnemies() {
    enemies.forEach(enemy => {
        let radius = enemy.radius;
        if (enemy.untargetable) ctx.globalAlpha = 0.28;

        if (enemy.hitFlash > 0) {
            radius += 3;
            ctx.fillStyle = "white";
        } else {
            ctx.fillStyle = enemy.color;
        }

        ctx.beginPath();
        ctx.arc(enemy.x, enemy.y, radius, 0, Math.PI * 2);
        ctx.fill();

        if (enemy.isBoss) {
            ctx.fillStyle = "white";
            ctx.font = "16px Arial";
            ctx.fillText("BOSS", enemy.x - 22, enemy.y + 5);
        } else if (enemy.special) {
            const icons = { healer: "+", exploder: "!", teleporter: "*", summoner: "S", slowImmune: "I", frenzy: "F", tsunamiImmune: "T", splitter: "2", invisible: "?", doombringer: "X" };
            ctx.fillStyle = (enemy.special === "slowImmune" || enemy.special === "tsunamiImmune") ? "black" : "white";
            ctx.font = enemy.isMini ? "10px Arial" : "bold 13px Arial";
            ctx.fillText(icons[enemy.special] || "?", enemy.x - 4, enemy.y + 5);
        }

        if (enemy.isAttacking) {
            ctx.strokeStyle = "white";
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.arc(enemy.x, enemy.y, enemy.radius + 4, 0, Math.PI * 2);
            ctx.stroke();
        }

        const hpBarWidth = enemy.isBoss ? 80 : 40;
        const hpPercent = enemy.hp / enemy.maxHp;

        ctx.fillStyle = "red";
        ctx.fillRect(enemy.x - hpBarWidth / 2, enemy.y - enemy.radius - 14, hpBarWidth, 6);

        ctx.fillStyle = "lime";
        ctx.fillRect(
            enemy.x - hpBarWidth / 2,
            enemy.y - enemy.radius - 14,
            hpBarWidth * hpPercent,
            6
        );
        ctx.globalAlpha = 1;
    });
}

function drawBossProjectiles() {
    bossProjectiles.forEach(p => {
        ctx.fillStyle = p.color;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.radius, 0, Math.PI * 2);
        ctx.fill();

        ctx.strokeStyle = "rgba(255,255,255,0.55)";
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.radius + 3, 0, Math.PI * 2);
        ctx.stroke();
    });
}

function drawProjectiles() {
    projectiles.forEach(p => {
        if (p.type === "ballista") {
            ctx.strokeStyle = p.color;
            ctx.lineWidth = 4;
            ctx.beginPath();
            ctx.moveTo(p.x - p.dx * 16, p.y - p.dy * 16);
            ctx.lineTo(p.x + p.dx * 12, p.y + p.dy * 12);
            ctx.stroke();

            ctx.fillStyle = p.color;
            ctx.beginPath();
            ctx.arc(p.x + p.dx * 12, p.y + p.dy * 12, 4, 0, Math.PI * 2);
            ctx.fill();
            return;
        }

        ctx.fillStyle = p.color;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.radius, 0, Math.PI * 2);
        ctx.fill();
    });
}

function drawVisualEffects() {
    effects.forEach(e => {
        if (e.type === "circle") {
            ctx.strokeStyle = e.color;
            ctx.globalAlpha = Math.max(0, e.life / 34);
            ctx.lineWidth = 4;
            ctx.beginPath();
            ctx.arc(e.x, e.y, e.radius, 0, Math.PI * 2);
            ctx.stroke();
            ctx.globalAlpha = 1;
        }

        if (e.type === "tsunami") {
            ctx.fillStyle = "rgba(74, 163, 255, 0.35)";
            ctx.fillRect(e.x, e.y, e.width, e.height);
        }

        if (e.type === "eclipse") {
            const alpha = Math.max(0, Math.min(0.34, e.life / e.maxLife * 0.34));
            ctx.fillStyle = `rgba(25, 8, 45, ${alpha})`;
            ctx.beginPath();
            ctx.arc(e.x, e.y, e.radius, 0, Math.PI * 2);
            ctx.fill();

            ctx.strokeStyle = "rgba(183, 140, 255, 0.75)";
            ctx.globalAlpha = Math.max(0.2, e.life / e.maxLife);
            ctx.lineWidth = 4;
            ctx.beginPath();
            ctx.arc(e.x, e.y, e.radius, 0, Math.PI * 2);
            ctx.stroke();

            e.pulseRadius += 8 * frameScale;
            ctx.strokeStyle = "rgba(215, 194, 255, 0.7)";
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.arc(e.x, e.y, Math.min(e.radius, e.pulseRadius), 0, Math.PI * 2);
            ctx.stroke();
            ctx.globalAlpha = 1;
        }

        if (e.type === "line") {
            ctx.strokeStyle = e.color;
            ctx.globalAlpha = Math.max(0, e.life / 14);
            ctx.lineWidth = 4;
            ctx.beginPath();
            ctx.moveTo(e.x1, e.y1);
            ctx.lineTo(e.x2, e.y2);
            ctx.stroke();
            ctx.globalAlpha = 1;
        }
    });

    particles.forEach(p => {
        ctx.fillStyle = p.color;
        ctx.globalAlpha = Math.max(0, p.life / 36);
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.radius, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = 1;
    });

    damageTexts.forEach(t => {
        ctx.fillStyle = t.color;
        ctx.font = `bold ${t.size}px Arial`;
        ctx.fillText(t.text, t.x, t.y);
    });
}

function drawAimLine() {
    if (!waveInProgress) return;

    ctx.strokeStyle = "rgba(255,255,255,0.20)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(player.x, player.y);
    ctx.lineTo(mousePosition.x, mousePosition.y);
    ctx.stroke();
}

function updateBossBar() {
    const boss = enemies.find(enemy => enemy.isBoss);

    if (!boss || !waveInProgress) {
        bossBarBox.classList.add("hidden");
        return;
    }

    bossBarBox.classList.remove("hidden");
    bossNameText.textContent = boss.name;
    bossBarFill.style.width = `${Math.max(0, boss.hp / boss.maxHp) * 100}%`;
}

function getBarricadeStatusText() {
    const active = getActiveBarricades();
    if (!active.length) return "Sin barricadas";

    return active.map(b => {
        const kindLabel = b.kind === "regen" ? "Regen" : b.kind === "explosive" ? "Explosiva" : b.kind === "thorns" ? "Espinas" : "Estándar";
        const tierLabel = b.kind === "standard" ? ` ${barricadeTiers[Math.max(0, b.tier)]?.name || "Madera"}` : "";
        const levelLabel = b.level > 0 ? ` +${b.level}` : "";
        return `${b.name}: ${kindLabel}${tierLabel}${levelLabel}`;
    }).join(" · ");
}


function setShopButtonAffordability(button, cost, extraDisabled = false, extraTitle = "") {
    if (!button) return;

    const numericCost = Number(cost) || 0;
    const cantAfford = numericCost > coins;

    button.disabled = Boolean(extraDisabled) || cantAfford;
    button.classList.toggle("cantAfford", cantAfford);

    if (cantAfford) {
        button.title = `Faltan ${formatMissingMoney(numericCost - coins)} monedas`;
    } else {
        button.title = extraTitle || "";
    }
}

function markShopButtonAffordability(button, cost) {
    if (!button) return;
    const numericCost = Number(cost) || 0;
    const cantAfford = numericCost > coins;
    button.classList.toggle("cantAfford", cantAfford);
    if (cantAfford) button.title = `Faltan ${formatMissingMoney(numericCost - coins)} monedas`;
}


function createEmptyInventory() {
    return Array.from({ length: INVENTORY_SLOT_COUNT }, () => ({ itemKey: null, quantity: 0 }));
}

function normalizeInventory(savedInventory) {
    const normalized = createEmptyInventory();
    if (!Array.isArray(savedInventory)) return normalized;

    savedInventory.slice(0, INVENTORY_SLOT_COUNT).forEach((slot, index) => {
        if (!slot || !slot.itemKey || !consumableDefinitions[slot.itemKey]) return;
        const quantity = Math.max(0, Math.min(INVENTORY_STACK_SIZE, Math.floor(Number(slot.quantity) || 0)));
        if (quantity > 0) normalized[index] = { itemKey: slot.itemKey, quantity };
    });

    return normalized;
}

function getInventoryCount() {
    return (inventory || []).reduce((sum, slot) => sum + (Number(slot.quantity) || 0), 0);
}

function findInventorySlotForItem(itemKey) {
    if (!inventory) inventory = createEmptyInventory();

    const existingStackIndex = inventory.findIndex(slot => slot.itemKey === itemKey && slot.quantity < INVENTORY_STACK_SIZE);
    if (existingStackIndex >= 0) return existingStackIndex;

    return inventory.findIndex(slot => !slot.itemKey || slot.quantity <= 0);
}

function hasInventorySpaceFor(itemKey) {
    return findInventorySlotForItem(itemKey) >= 0;
}

function addConsumableToInventory(itemKey) {
    const slotIndex = findInventorySlotForItem(itemKey);
    if (slotIndex < 0) return false;

    const slot = inventory[slotIndex];
    if (!slot.itemKey || slot.quantity <= 0) {
        inventory[slotIndex] = { itemKey, quantity: 1 };
    } else {
        slot.quantity = Math.min(INVENTORY_STACK_SIZE, slot.quantity + 1);
    }

    return true;
}

function buyConsumableToInventory(itemKey, costKey, costMultiplier) {
    const def = consumableDefinitions[itemKey];
    if (!def || !costs || coins < costs[costKey]) return;

    if (!hasInventorySpaceFor(itemKey)) {
        showCenterMessage("Inventario lleno", 800);
        updateHud(true);
        return;
    }

    coins -= costs[costKey];
    addConsumableToInventory(itemKey);
    costs[costKey] = scaleConsumableCost(costs[costKey], costMultiplier);
    showCenterMessage(`${def.name} guardada`, 700);
    updateHud(true);
    autoSaveRun(true);
}

function applyConsumableEffect(itemKey) {
    const def = consumableDefinitions[itemKey];
    if (!def || !player) return false;

    if (def.effect === "heal") {
        if (!hasDamagedPlayerHp()) {
            showCenterMessage("Vida llena", 600);
            return false;
        }
        healOverTime(def.heal, def.duration);
    }

    if (def.effect === "shield") {
        player.shieldCharges += 1;
    }

    if (def.effect === "attackSpeed") {
        player.attackSpeedUntil = getGameTime() + def.duration;
    }

    if (def.effect === "doubleShot") {
        player.doubleShotUntil = getGameTime() + def.duration;
    }

    if (def.effect === "lifeSteal") {
        player.lifeStealPercent = 0.22;
        player.lifeStealUntil = getGameTime() + def.duration;
    }

    showCenterMessage(def.message, 750);
    return true;
}

function consumeInventorySlot(slotIndex) {
    if (!gameStarted || !player || !inventory || isPaused || !waveInProgress) return;

    const slot = inventory[slotIndex];
    if (!slot || !slot.itemKey || slot.quantity <= 0) return;

    const now = getGameTime();
    const remaining = inventoryCooldownUntil - now;
    if (remaining > 0) {
        showCenterMessage(`Cooldown ${Math.ceil(remaining / 1000)}s`, 550);
        return;
    }

    if (!applyConsumableEffect(slot.itemKey)) {
        updateHud(true);
        return;
    }

    slot.quantity -= 1;
    if (slot.quantity <= 0) {
        slot.itemKey = null;
        slot.quantity = 0;
    }

    inventoryCooldownUntil = now + INVENTORY_GLOBAL_COOLDOWN;
    updateHud(true);
    autoSaveRun(true);
}

function getInventoryRenderSignature() {
    if (!inventory) return "no-inventory";

    const itemSignature = inventory.map(slot => {
        if (!slot || !slot.itemKey || slot.quantity <= 0) return "empty";
        return `${slot.itemKey}:${slot.quantity}`;
    }).join("|");

    return `${itemSignature}|wave:${waveInProgress ? 1 : 0}|paused:${isPaused ? 1 : 0}|started:${gameStarted ? 1 : 0}`;
}

function updateInventoryCooldownVisual(cooldownRemaining, cooldownProgress) {
    if (!inventorySlotsPanel) return;

    const buttons = inventorySlotsPanel.querySelectorAll(".inventorySlotButton");
    buttons.forEach((button, index) => {
        const slot = inventory[index];
        const def = slot && slot.itemKey ? consumableDefinitions[slot.itemKey] : null;

        if (cooldownRemaining > 0) {
            button.classList.add("cooldown");
            button.style.setProperty("--cooldown", `${cooldownProgress * 360}deg`);
        } else {
            button.classList.remove("cooldown");
            button.style.removeProperty("--cooldown");
        }

        button.disabled = !waveInProgress || isPaused || !def || cooldownRemaining > 0;
    });
}

function renderInventory(force = false) {
    if (!inventorySlotsPanel) return;
    if (!inventory) inventory = createEmptyInventory();

    const now = getGameTime();
    const cooldownRemaining = Math.max(0, inventoryCooldownUntil - now);
    const cooldownProgress = cooldownRemaining > 0 ? Math.min(1, cooldownRemaining / INVENTORY_GLOBAL_COOLDOWN) : 0;
    const signature = getInventoryRenderSignature();

    // Importante: durante la oleada NO reconstruimos los botones cada refresh del HUD.
    // Antes se hacía innerHTML constante y, al tener el mouse encima, el slot se destruía/recreaba:
    // eso causaba titileo y podía comerse el click. Ahora solo recreamos si cambió el contenido real.
    if (force || signature !== inventoryRenderSignature || inventorySlotsPanel.children.length !== INVENTORY_SLOT_COUNT) {
        inventoryRenderSignature = signature;
        inventorySlotsPanel.innerHTML = "";

        inventory.forEach((slot, index) => {
            const button = document.createElement("button");
            button.type = "button";
            button.className = "inventorySlotButton";
            button.dataset.slotIndex = index;

            const def = slot && slot.itemKey ? consumableDefinitions[slot.itemKey] : null;
            if (def && slot.quantity > 0) {
                button.style.setProperty("--potion-color", def.color || "#9be7ff");
                button.innerHTML = `
                    <span class="inventoryPotionDot" aria-hidden="true"></span>
                    <span class="inventoryName">${def.shortName}</span>
                    <span class="inventoryQty">${slot.quantity}</span>
                `;
                button.title = `${def.name} · Click para consumir durante una oleada`;
            } else {
                button.classList.add("empty");
                button.style.removeProperty("--potion-color");
                button.innerHTML = `<span class="inventoryEmptyDot" aria-hidden="true"></span><span class="inventoryName">Vacío</span><span class="inventoryQty">0</span>`;
                button.title = "Slot vacío";
            }

            button.addEventListener("click", event => {
                event.preventDefault();
                event.stopPropagation();
                consumeInventorySlot(index);
            });

            inventorySlotsPanel.appendChild(button);
        });
    }

    updateInventoryCooldownVisual(cooldownRemaining, cooldownProgress);

    if (inventoryCooldownText) {
        const count = getInventoryCount();
        inventoryCooldownText.textContent = cooldownRemaining > 0
            ? `Cooldown global: ${Math.ceil(cooldownRemaining / 1000)}s · Inventario ${count}/${INVENTORY_SLOT_COUNT * INVENTORY_STACK_SIZE}`
            : `Listo · Inventario ${count}/${INVENTORY_SLOT_COUNT * INVENTORY_STACK_SIZE}`;
    }
}

function hasDamagedPlayerHp() {
    return player && player.hp < player.maxHp;
}

function selectBarricadeSlot(index) {
    selectedBarricadeSlotIndex = Math.max(0, Math.min(1, Number(index) || 0));
    updateBarricadeSlotChoiceUI();
    updateHud(true);
}

function updateBarricadeSlotChoiceUI() {
    const buttons = [barricadeSlot1Btn, barricadeSlot2Btn];
    buttons.forEach((button, index) => {
        if (!button) return;
        const slot = barricades && barricades[index];
        const active = slot && slot.active && slot.hp > 0;
        button.classList.toggle("active", selectedBarricadeSlotIndex === index);
        button.disabled = Boolean(active);
        button.title = active ? "Este slot ya tiene una barricada activa." : `La próxima barricada nueva se colocará en ${slot ? slot.name : `Slot ${index + 1}`}.`;
    });
}

function getBarricadeActionState(kind = "standard") {
    return { canBuyOrUpgrade: true, hasSameKind: (barricades || []).some(b => b.active && b.hp > 0 && b.kind === kind), hasBrokenSlot: true };
}

function updateBarricadeButtonState(button, kind, costKey) {
    if (!button) return;
    const cost = getBarricadeBaseCost(kind);
    setShopButtonAffordability(
        button,
        cost,
        Boolean(pendingBarricadePlacement),
        pendingBarricadePlacement ? "Ya estás colocando una barricada." : "Construir una barricada libre. Para mejorar/reparar/vender: clickeala en el mapa."
    );
}

function updateHud(force = false) {
    const hudNow = performance.now();
    if (!force && gameRunning && waveInProgress && hudNow - lastHudUpdateAt < HUD_REFRESH_INTERVAL) return;
    lastHudUpdateAt = hudNow;

    waveText.textContent = wave;
    hpText.textContent = `${Math.round(player.hp)}/${player.maxHp}${player.shieldCharges > 0 ? ` 🛡${player.shieldCharges}` : ""}`;
    barricadeText.textContent = `Muros ${Math.round(getTotalBarricadeHp())}/${Math.round(getTotalBarricadeMaxHp())}`;
    coinsText.textContent = formatMoney(coins);
    scoreText.textContent = formatCompactNumber(score);

    playerDamageText.textContent = player.damage;
    playerFireDelayText.textContent = player.fireDelay;
    playerMaxHpText.textContent = player.maxHp;
    critChanceText.textContent = Math.round(player.critChance * 100);

    damageCostText.textContent = formatMoney(costs.damage);
    fireRateCostText.textContent = formatMoney(costs.fireRate);
    maxHpCostText.textContent = formatMoney(costs.maxHp);
    critCostText.textContent = formatMoney(costs.crit);

    setShopButtonAffordability(upgradeDamageBtn, costs.damage);
    setShopButtonAffordability(upgradeFireRateBtn, costs.fireRate);
    setShopButtonAffordability(upgradeMaxHpBtn, costs.maxHp);
    setShopButtonAffordability(upgradeCritBtn, costs.crit);

    smallPotionCostText.textContent = formatMoney(costs.smallPotion);
    mediumPotionCostText.textContent = formatMoney(costs.mediumPotion);
    largePotionCostText.textContent = formatMoney(costs.largePotion);
    if (shieldPotionCostText) shieldPotionCostText.textContent = formatMoney(costs.shieldPotion);
    if (attackSpeedPotionCostText) attackSpeedPotionCostText.textContent = formatMoney(costs.attackSpeedPotion);
    if (doubleShotPotionCostText) doubleShotPotionCostText.textContent = formatMoney(costs.doubleShotPotion);
    if (lifeStealPotionCostText) lifeStealPotionCostText.textContent = formatMoney(costs.lifeStealPotion);

    renderInventory();

    const inventoryFullTitle = "Inventario lleno: 5 slots de x5 consumibles.";
    setShopButtonAffordability(buySmallPotionBtn, costs.smallPotion, !hasInventorySpaceFor("smallPotion"), hasInventorySpaceFor("smallPotion") ? "" : inventoryFullTitle);
    setShopButtonAffordability(buyMediumPotionBtn, costs.mediumPotion, !hasInventorySpaceFor("mediumPotion"), hasInventorySpaceFor("mediumPotion") ? "" : inventoryFullTitle);
    setShopButtonAffordability(buyLargePotionBtn, costs.largePotion, !hasInventorySpaceFor("largePotion"), hasInventorySpaceFor("largePotion") ? "" : inventoryFullTitle);
    setShopButtonAffordability(buyShieldPotionBtn, costs.shieldPotion, !hasInventorySpaceFor("shieldPotion"), hasInventorySpaceFor("shieldPotion") ? "" : inventoryFullTitle);
    setShopButtonAffordability(buyAttackSpeedPotionBtn, costs.attackSpeedPotion, !hasInventorySpaceFor("attackSpeedPotion"), hasInventorySpaceFor("attackSpeedPotion") ? "" : inventoryFullTitle);
    setShopButtonAffordability(buyDoubleShotPotionBtn, costs.doubleShotPotion, !hasInventorySpaceFor("doubleShotPotion"), hasInventorySpaceFor("doubleShotPotion") ? "" : inventoryFullTitle);
    setShopButtonAffordability(buyLifeStealPotionBtn, costs.lifeStealPotion, !hasInventorySpaceFor("lifeStealPotion"), hasInventorySpaceFor("lifeStealPotion") ? "" : inventoryFullTitle);

    repairBarricadeCostText.textContent = "Seleccionar";
    upgradeBarricadeCostText.textContent = formatMoney(getBarricadeBaseCost("standard"));
    if (regenBarricadeCostText) regenBarricadeCostText.textContent = formatMoney(getBarricadeBaseCost("regen"));
    if (explosiveBarricadeCostText) explosiveBarricadeCostText.textContent = formatMoney(getBarricadeBaseCost("explosive"));
    if (thornsBarricadeCostText) thornsBarricadeCostText.textContent = formatMoney(getBarricadeBaseCost("thorns"));

    setShopButtonAffordability(
        repairBarricadeBtn,
        0,
        true,
        "Ahora la reparación se hace clickeando una barricada en el mapa."
    );
    updateBarricadeButtonState(upgradeBarricadeBtn, "standard", "upgradeBarricade");
    updateBarricadeButtonState(buyRegenBarricadeBtn, "regen", "regenBarricade");
    updateBarricadeButtonState(buyExplosiveBarricadeBtn, "explosive", "explosiveBarricade");
    updateBarricadeButtonState(buyThornsBarricadeBtn, "thorns", "thornsBarricade");

    barricadeTierText.textContent = getBarricadeStatusText();
    updateBarricadeSlotChoiceUI();
    clampPlayerToPlayableArea();

    towerDefinitions.forEach((def, index) => {
        const el = document.getElementById(`tower${index + 1}CostText`);
        if (el) el.textContent = formatMoney(costs[def.key] ?? def.cost);
    });

    if (towerSlotCostText) towerSlotCostText.textContent = towerSlotLimit >= MAX_TOWER_LIMIT ? "MAX" : formatMoney(costs.towerSlot);

    bombCostText.textContent = formatMoney(abilities.bomb.cost);
    freezeCostText.textContent = formatMoney(abilities.freeze.cost);
    tsunamiCostText.textContent = formatMoney(abilities.tsunami.cost);
    lightningCostText.textContent = formatMoney(abilities.lightning.cost);
    meteorCostText.textContent = formatMoney(abilities.meteor.cost);
    if (eclipseCostText) eclipseCostText.textContent = formatMoney(abilities.eclipse.cost);

    updateTowerShopVisibility();
    updateAbilityShopVisibility();
    updateAbilityBar();
    updateBossBar();
    updateBuildCancelUI();
    updateStructurePanel();

    // Los controles casi nunca cambian durante una oleada. Evitamos recorrer
    // botones del DOM en cada frame para ganar fluidez en PCs chicas.
    if (force || !gameRunning || !waveInProgress) {
        updateControlsUI();
    }
}

function updateTowerShopVisibility() {
    const full = towers.length >= towerSlotLimit;
    if (towerLimitText) towerLimitText.textContent = `${towers.length}/${towerSlotLimit} slots · máx ${MAX_TOWER_LIMIT}`;

    if (buyTowerSlotBtn) {
        const atMaxSlots = towerSlotLimit >= MAX_TOWER_LIMIT;
        setShopButtonAffordability(
            buyTowerSlotBtn,
            costs.towerSlot,
            atMaxSlots,
            atMaxSlots ? "Ya alcanzaste el máximo de 20 slots de torres." : "Comprar un slot extra para poder colocar una torre más."
        );
        buyTowerSlotBtn.innerHTML = atMaxSlots
            ? `Slots de torres al máximo<br><small>Tenés ${towerSlotLimit}/${MAX_TOWER_LIMIT} slots disponibles</small><br><span id="towerSlotCostText">MAX</span>`
            : `Comprar slot de torre<br><small>Compra 1 slot extra · ${towerSlotLimit}/${MAX_TOWER_LIMIT}</small><br><span id="towerSlotCostText">${formatMoney(costs.towerSlot)}</span> monedas`;
    }

    towerDefinitions.forEach((def, index) => {
        const btn = document.getElementById(`buyTower${index + 1}Btn`);
        const price = costs[def.key] ?? def.cost;
        if (btn) {
            const extraDisabled = !!pendingTowerPurchase || full;
            const extraTitle = full ? "Límite de slots de torre alcanzado. Comprá un slot extra." : pendingTowerPurchase ? "Ya estás colocando una torre" : "";
            setShopButtonAffordability(btn, price, extraDisabled, extraTitle);
        }
    });

    if (repeatWaveBtn) {
        const repeats = getRepeatCountForCurrentWave();
        repeatWaveBtn.classList.toggle("hidden", waveInProgress);
        repeatWaveBtn.disabled = waveInProgress || repeats >= REPEAT_LIMIT_PER_WAVE;
        repeatWaveBtn.textContent = repeats >= REPEAT_LIMIT_PER_WAVE
            ? "Repetir oleada: límite alcanzado"
            : `Repetir oleada (${repeats}/${REPEAT_LIMIT_PER_WAVE}) · 50% oro`;
    }

    if (nextWaveBtn) {
        nextWaveBtn.classList.toggle("hidden", waveInProgress);
        nextWaveBtn.disabled = waveInProgress;
    }

    renderTowerSlotsPanel();
}

function renderTowerSlotsPanel() {
    if (!towerSlotsPanel) return;

    const signature = JSON.stringify({
        coins,
        towerSlotLimit,
        towerSlotCost: costs ? costs.towerSlot : 0,
        towers: (towers || []).map(tower => ({
            id: tower.id,
            name: tower.name,
            level: tower.level,
            x: Math.round(tower.x),
            y: Math.round(tower.y),
            spent: Math.round(tower.spent || 0),
            upgradeCost: tower.upgradeCost,
            buffDamage: tower.buffDamage,
            buffSpeed: tower.buffSpeed
        }))
    });

    if (signature === towerSlotsRenderSignature) return;
    towerSlotsRenderSignature = signature;

    if (towers.length === 0) {
        towerSlotsPanel.innerHTML = `<p class="towerSlotEmpty">No hay torres colocadas. Comprá una torre y elegí un tile verde en el mapa.</p>`;
        return;
    }

    towerSlotsPanel.innerHTML = towers.map((tower, index) => {
        const refund = Math.floor((tower.spent || 0) * TOWER_SELL_REFUND);
        const buffText = tower.type === "buffer" ? `<br><small>Buff: +${Math.round((tower.buffDamage || 0) * 100)}% daño / +${Math.round((tower.buffSpeed || 0) * 100)}% velocidad</small>` : "";
        return `
            <div class="towerSlotCard">
                <strong>Slot ${index + 1}: ${tower.name}</strong><br>
                <small>Nivel ${tower.level} · Pos: ${Math.round(tower.x)},${Math.round(tower.y)} · Gastado: ${formatMoney(tower.spent || 0)} · Venta: ${formatMoney(refund)}</small>${buffText}<br>
                <button type="button" data-tower-action="upgrade" data-index="${index}" class="${coins < tower.upgradeCost ? "cantAfford" : ""}" title="${coins < tower.upgradeCost ? `Faltan ${formatMissingMoney(tower.upgradeCost - coins)} monedas` : ""}" ${coins < tower.upgradeCost ? "disabled" : ""}>Mejorar (${formatMoney(tower.upgradeCost)})</button>
                <button type="button" data-tower-action="move" data-index="${index}">Mover</button>
                <button type="button" data-tower-action="sell" data-index="${index}" class="dangerMiniButton">Vender (${formatMoney(refund)})</button>
            </div>`;
    }).join("");
}

function updateAbilityShopVisibility() {
    setShopButtonAffordability(buyBombBtn, abilities.bomb.cost, abilities.bomb.owned, abilities.bomb.owned ? "Ya compraste esta habilidad" : "");
    setShopButtonAffordability(buyFreezeBtn, abilities.freeze.cost, abilities.freeze.owned, abilities.freeze.owned ? "Ya compraste esta habilidad" : "");
    setShopButtonAffordability(buyTsunamiBtn, abilities.tsunami.cost, abilities.tsunami.owned, abilities.tsunami.owned ? "Ya compraste esta habilidad" : "");
    setShopButtonAffordability(buyLightningBtn, abilities.lightning.cost, abilities.lightning.owned, abilities.lightning.owned ? "Ya compraste esta habilidad" : "");
    setShopButtonAffordability(buyMeteorBtn, abilities.meteor.cost, abilities.meteor.owned, abilities.meteor.owned ? "Ya compraste esta habilidad" : "");
    setShopButtonAffordability(buyEclipseBtn, abilities.eclipse.cost, abilities.eclipse.owned, abilities.eclipse.owned ? "Ya compraste esta habilidad" : "");

    if (abilities.bomb.owned) buyBombBtn.innerHTML = `Bomba comprada<br><small>${abilities.bomb.key} para usar</small>`;
    if (abilities.freeze.owned) buyFreezeBtn.innerHTML = `Congelar comprado<br><small>${abilities.freeze.key} para usar</small>`;
    if (abilities.tsunami.owned) buyTsunamiBtn.innerHTML = `Tsunami comprado<br><small>${abilities.tsunami.key} para usar</small>`;
    if (abilities.lightning.owned) buyLightningBtn.innerHTML = `Rayo comprado<br><small>${abilities.lightning.key} para usar</small>`;
    if (abilities.meteor.owned) buyMeteorBtn.innerHTML = `Meteorito comprado<br><small>${abilities.meteor.key} para usar</small>`;
    if (buyEclipseBtn && abilities.eclipse.owned) buyEclipseBtn.innerHTML = `Eclipse comprado<br><small>${abilities.eclipse.key} para usar</small>`;
}

function updateAbilityBar() {
    const now = getGameTime();

    Object.keys(abilities).forEach(id => {
        const ability = abilities[id];
        const slot = abilitySlots[id];
        if (!slot) return;

        slot.classList.remove("locked", "ready", "cooldown");

        if (!ability.owned) {
            slot.classList.add("locked");
            slot.textContent = `${ability.key} · ${ability.name} bloqueada`;
            return;
        }

        const remaining = ability.cooldown - (now - ability.lastUsed);

        if (remaining > 0) {
            slot.classList.add("cooldown");
            slot.textContent = `${ability.key} · ${ability.name} ${Math.ceil(remaining / 1000)}s`;
        } else {
            slot.classList.add("ready");
            slot.textContent = `${ability.key} · ${ability.name} lista`;
        }
    });
}

function drawWorldGrid() {
    ctx.fillStyle = "#263426";
    ctx.fillRect(0, 0, WORLD_WIDTH, WORLD_HEIGHT);
    ctx.strokeStyle = "rgba(255,255,255,0.035)";
    ctx.lineWidth = 1;
    for (let x = 0; x <= WORLD_WIDTH; x += 100) {
        ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, WORLD_HEIGHT); ctx.stroke();
    }
    for (let y = 0; y <= WORLD_HEIGHT; y += 100) {
        ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(WORLD_WIDTH, y); ctx.stroke();
    }
}

function drawMinimap() {
    const w = 170;
    const h = 112;
    const x = GAME_WIDTH - w - 14;
    const y = GAME_HEIGHT - h - 14;
    ctx.save();
    ctx.setTransform(canvas.width / GAME_WIDTH, 0, 0, canvas.height / GAME_HEIGHT, 0, 0);
    ctx.fillStyle = "rgba(0,0,0,0.72)";
    ctx.fillRect(x, y, w, h);
    ctx.strokeStyle = "rgba(255,255,255,0.45)";
    ctx.strokeRect(x, y, w, h);
    const sx = w / WORLD_WIDTH;
    const sy = h / WORLD_HEIGHT;
    const dot = (wx, wy, color, r = 2) => {
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.arc(x + wx * sx, y + wy * sy, r, 0, Math.PI * 2);
        ctx.fill();
    };
    if (player) dot(player.x, player.y, "#66d9ff", 4);
    enemies.forEach(e => dot(e.x, e.y, e.isBoss ? "#ff55ff" : "#ff3333", e.isBoss ? 3.8 : 2));
    towers.forEach(t => dot(t.x, t.y, "#ffffff", 1.7));
    barricades.forEach(b => { if (b.active && b.hp > 0) dot(b.x, b.y, "#aaaaaa", 1.6); });
    ctx.strokeStyle = "rgba(115,255,159,0.7)";
    ctx.strokeRect(x + camera.x * sx, y + camera.y * sy, GAME_WIDTH * sx, GAME_HEIGHT * sy);
    ctx.restore();
}

function draw() {
    resizeCanvasForDisplay();
    updateCamera();
    ctx.clearRect(0, 0, GAME_WIDTH, GAME_HEIGHT);

    ctx.save();
    ctx.translate(-camera.x, -camera.y);
    drawWorldGrid();
    drawPath();
    drawBase();
    drawBarricade();
    drawPlayer();
    drawTowerPlacementTiles();
    drawTowers();
    drawAimLine();
    drawSlowZones();
    drawEnemies();
    drawProjectiles();
    drawBossProjectiles();
    drawVisualEffects();
    ctx.restore();

    drawMinimap();
}

function gameLoop() {
    const realNow = performance.now();
    const delta = realNow - lastFrameTime;
    lastFrameTime = realNow;

    // A 60 FPS frameScale ≈ 1.
    // Si una PC baja a 30 FPS, frameScale ≈ 2, entonces el movimiento compensa esa pérdida.
    // No baja de 1 para conservar el ritmo original en PCs que ya iban fluidas.
    // El límite evita saltos gigantes si el navegador se traba.
    frameScale = Math.max(1, Math.min(delta / 16.666, 2.5));

    recoverFrozenWaveState("loop");

    if (gameStarted && gameRunning && waveInProgress && !isPaused && !document.hidden) {
        gameTime += delta * gameSpeed;
    }

    if (!gameStarted) {
        requestAnimationFrame(gameLoop);
        return;
    }

    const now = getGameTime();

    if (gameRunning && waveInProgress && !isPaused) {
        if (enemiesSpawned < enemiesToSpawn && now - lastSpawnTime > spawnInterval) {
            spawnEnemy();
            lastSpawnTime = now;
        }

        updatePlayerMovement();
        autoShootPlayer();
        updateTowers();
        regenerateBarricades();
        updateEnemies();
        updateProjectiles();
        updateBossProjectiles();
        updatePoisonZones();
        updateFireZones();
        updateEclipseEffects();
        updateSlowZones();
        checkWaveComplete();
    }

    updateVisualEffects();
    updateHud();
    autoSaveRun();
    draw();

    requestAnimationFrame(gameLoop);
}


function appendConsoleLog(message) {
    if (!consoleLog) return;
    const time = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
    consoleLog.textContent += `\n[${time}] ${message}`;
    consoleLog.scrollTop = consoleLog.scrollHeight;
}

function openConsole() {
    if (!consolePanel) return;
    consolePanel.classList.remove("hidden");
    if (consoleInput) {
        consoleInput.focus();
        consoleInput.select();
    }
}

function closeConsole() {
    if (!consolePanel) return;
    consolePanel.classList.add("hidden");
    if (consoleInput) consoleInput.value = "";
}

function isElementVisible(element) {
    return !!element && !element.classList.contains("hidden");
}

function isWaveBlockingPanelOpen() {
    return (
        isElementVisible(shop) ||
        isElementVisible(waveSummaryPanel) ||
        isElementVisible(gameOverScreen)
    );
}

function recoverFrozenWaveState(reason = "auto") {
    if (!gameStarted || !hasActiveRun || !waveInProgress) return false;
    if (document.hidden || isWaveBlockingPanelOpen()) return false;

    const pausePanelVisible = isElementVisible(pausePanel);

    // Si el panel de pausa está oculto, la oleada no debería quedar ni pausada ni sin correr.
    // Esto evita el bug donde el juego queda congelado hasta tocar Escape varias veces.
    if (!pausePanelVisible && (isPaused || !gameRunning)) {
        isPaused = false;
        gameRunning = true;
        confirmRestartBox.classList.add("hidden");
        lastFrameTime = performance.now();
        syncMusicState();
        updateHud(true);
        return true;
    }

    return false;
}

function forceResumeWave() {
    if (!gameStarted || !hasActiveRun || !waveInProgress) return;
    if (isWaveBlockingPanelOpen()) return;

    isPaused = false;
    gameRunning = true;
    pausePanel.classList.add("hidden");
    confirmRestartBox.classList.add("hidden");
    lastFrameTime = performance.now();
    syncMusicState();
    updateHud(true);
}

function runConsoleCommand(rawCommand) {
    const command = (rawCommand || "").trim().toLowerCase();
    if (!command) return;

    appendConsoleLog(`> ${command}`);

    if (!player) {
        appendConsoleLog("No hay una run activa todavía.");
        return;
    }

    if (alphaTesterCommands[command]) {
        const testerName = alphaTesterCommands[command];
        activateAlphaTesterBadge(testerName);
        appendConsoleLog(`Easter egg activado: ${testerName} ahora es ALPHA TESTER.`);
        showCenterMessage("ALPHA TESTER", 1000);
        updateHud();
        return;
    }

    if (command === "alene") {
        activateDeveloperBadge("Alene");
        appendConsoleLog("Easter egg activado: Alene ahora es DEVELOPER.");
        showCenterMessage("DEVELOPER", 1000);
        updateHud();
        return;
    }

    if (command === "greedisgood") {
        disqualifyRunFromLeaderboard("greedisgood");
        coins = Math.min(Number.MAX_SAFE_INTEGER, coins + 999999999);
        appendConsoleLog(`Easter egg activado: +${formatMoney(999999999)} monedas agregadas.`);
        updateHud();
        return;
    }

    if (command === "canttouchme") {
        disqualifyRunFromLeaderboard("canttouchme");
        player.immortal = !player.immortal;

        if (player.immortal) {
            player.hp = player.maxHp;
            appendConsoleLog("Easter egg activado: modo inmortal ON.");
            showCenterMessage("MODO INMORTAL", 1000);
        } else {
            appendConsoleLog("Modo inmortal OFF.");
            showCenterMessage("INMORTAL OFF", 800);
        }

        updateHud();
        return;
    }

    if (command === "beginner") {
        coins += 500;
        appendConsoleLog(`Comando activado: +${formatMoney(500)} monedas.`);
        updateHud();
        return;
    }

    if (command === "add" || command.startsWith("add ")) {
        const parts = command.split(/\s+/);

        if (!parts[1]) {
            appendConsoleLog("Uso correcto: add 5000. Sin límite práctico de monedas.");
            return;
        }

        const rawAmount = parts.slice(1).join("").replace(/[.,]/g, "");
        const amount = Math.floor(Number(rawAmount));

        if (!Number.isFinite(amount) || amount <= 0) {
            appendConsoleLog("Uso correcto: add 5000. La cantidad debe ser un número mayor a 0.");
            return;
        }

        const safeAmount = Math.min(amount, Number.MAX_SAFE_INTEGER - coins);
        disqualifyRunFromLeaderboard("add");
        coins = Math.min(Number.MAX_SAFE_INTEGER, coins + safeAmount);
        appendConsoleLog(`Comando activado: +${formatMoney(safeAmount)} monedas.`);

        updateHud();
        return;
    }

    if (command === "waveskip" || command.startsWith("waveskip ")) {
        const parts = command.split(/\s+/);
        const targetWave = parts[1] ? Math.max(1, Math.floor(Number(parts[1]))) : wave + 1;

        if (!Number.isFinite(targetWave)) {
            appendConsoleLog("Uso correcto: waveskip o waveskip 25");
            return;
        }

        jumpToWave(targetWave);
        appendConsoleLog(`Comando activado: saltaste a la oleada ${wave}.`);
        return;
    }

    if (command === "killall") {
        const killed = killAllEnemiesFromConsole();
        appendConsoleLog(`Comando activado: ${killed} enemigos eliminados.`);
        showCenterMessage("KILL ALL", 800);
        updateHud();
        return;
    }

    if (command === "reset") {
        resetRunFromConsole();
        appendConsoleLog("Run reiniciada desde 0.");
        return;
    }

    appendConsoleLog(`Comando desconocido: ${command}`);
}

function killAllEnemiesFromConsole() {
    if (!enemies || enemies.length === 0) {
        if (bossProjectiles) bossProjectiles = [];
        return 0;
    }

    let killed = 0;

    while (enemies.length > 0) {
        const enemy = enemies.pop();
        if (!enemy) continue;

        const goldReward = getGoldAmount(enemy.reward || 0);
        coins += goldReward;
        score += enemy.scoreValue || 0;

        if (waveStats) {
            waveStats.kills++;
            waveStats.gold += goldReward;
            waveStats.score += enemy.scoreValue || 0;
        }

        createDeathExplosion(
            enemy.x || GAME_WIDTH / 2,
            enemy.y || GAME_HEIGHT / 2,
            enemy.color || "#ffffff",
            enemy.isBoss ? 28 : 14
        );

        killed++;
    }

    if (bossProjectiles) bossProjectiles = [];
    checkWaveComplete();
    return killed;
}

function resetRunFromConsole() {
    clearSavedRun();
    stopMusicAndReset();
    createDefaultState();

    hasActiveRun = true;
    gameStarted = true;
    isInMainMenu = false;
    isPaused = false;

    menu.classList.add("hidden");
    gameArea.classList.remove("hidden");
    shop.classList.add("hidden");
    waveSummaryPanel.classList.add("hidden");
    gameOverScreen.classList.add("hidden");
    pausePanel.classList.add("hidden");

    startWave();
    showCenterMessage("RUN REINICIADA", 900);
    updateHud();
}

function jumpToWave(targetWave) {
    wave = Math.max(1, Math.floor(targetWave));
    isRepeatingWave = false;
    currentGoldMultiplier = 1;
    repeatCountsByWave[wave] = repeatCountsByWave[wave] || 0;

    enemies = [];
    projectiles = [];
    bossProjectiles = [];
    slowZones = [];
    poisonZones = [];
    fireZones = [];
    eclipseEffects = [];
    damageTexts = [];
    particles = [];
    effects = [];

    shop.classList.add("hidden");
    waveSummaryPanel.classList.add("hidden");
    gameOverScreen.classList.add("hidden");
    pausePanel.classList.add("hidden");
    consolePanel.classList.add("hidden");

    isPaused = false;
    hasActiveRun = true;
    gameStarted = true;
    gameRunning = true;
    waveInProgress = false;

    startWave();
    showCenterMessage(`OLEADA ${wave}`, 900);
    updateHud();
}


function isInBuildPlacementMode() {
    return Boolean(pendingBarricadePlacement || pendingTowerPurchase || pendingTowerMoveIndex !== null);
}


function getStructureById(id, type = null) {
    if (type === "tower") return (towers || []).find(t => String(t.id) === String(id)) || null;
    if (type === "barricade") return (barricades || []).find(b => String(b.id) === String(id)) || null;
    return (towers || []).find(t => String(t.id) === String(id)) || (barricades || []).find(b => String(b.id) === String(id)) || null;
}

function getSelectedStructures() {
    const pool = selectedStructureType === "tower" ? (towers || []) : selectedStructureType === "barricade" ? (barricades || []) : [];
    return pool.filter(item => item && selectedStructureIds.includes(String(item.id)) && (selectedStructureType === "tower" || (item.active && item.hp > 0)));
}

function isStructureSelected(type, id) {
    return selectedStructureType === type && selectedStructureIds.includes(String(id));
}

function clearStructureSelection() {
    selectedStructureIds = [];
    selectedStructureType = null;
    updateStructurePanel();
}

function selectStructure(type, entity, multiSame = false) {
    if (!entity) { clearStructureSelection(); return; }
    if (type === "tower") {
        const sourceType = entity.type;
        selectedStructureType = "tower";
        selectedStructureIds = (multiSame ? (towers || []).filter(t => t.owned && t.type === sourceType) : [entity]).map(t => String(t.id));
    } else {
        const sourceKind = entity.kind || "standard";
        selectedStructureType = "barricade";
        selectedStructureIds = (multiSame ? (barricades || []).filter(b => b.active && b.hp > 0 && (b.kind || "standard") === sourceKind) : [entity]).map(b => String(b.id));
    }
    updateStructurePanel();
}

function findTowerAtWorldPoint(x, y) {
    for (let i = (towers || []).length - 1; i >= 0; i--) {
        const t = towers[i];
        if (!t || !t.owned) continue;
        if (Math.hypot(x - t.x, y - t.y) <= TOWER_COLLISION_RADIUS + 6) return t;
    }
    return null;
}

function findBarricadeAtWorldPoint(x, y) {
    for (let i = (barricades || []).length - 1; i >= 0; i--) {
        const b = barricades[i];
        if (!b || !b.active || b.hp <= 0) continue;
        const rect = getEntityRect({ ...b, isBuildBarricade: true });
        if (x >= rect.left - 6 && x <= rect.right + 6 && y >= rect.top - 6 && y <= rect.bottom + 6) return b;
    }
    return null;
}

function handleStructureClickSelection(event) {
    const tower = findTowerAtWorldPoint(mousePosition.x, mousePosition.y);
    if (tower) {
        selectStructure("tower", tower, event.ctrlKey || event.metaKey);
        showCenterMessage(event.ctrlKey || event.metaKey ? `Seleccionadas torres ${tower.name}` : `${tower.name} seleccionada`, 650);
        return true;
    }
    const b = findBarricadeAtWorldPoint(mousePosition.x, mousePosition.y);
    if (b) {
        ensureBarricadeEconomy(b);
        selectStructure("barricade", b, event.ctrlKey || event.metaKey);
        showCenterMessage(event.ctrlKey || event.metaKey ? `Seleccionadas barricadas ${getBarricadeKindLabel(b.kind)}` : `Barricada ${getBarricadeKindLabel(b.kind)} seleccionada`, 650);
        return true;
    }
    return false;
}

function getTowerUpgradePreview(tower) {
    if (!tower) return "";
    if (tower.type === "buffer") return `Nivel ${tower.level || 1} · buff ${Math.round((tower.buffDamage || 0) * 100)}% daño / ${Math.round((tower.buffSpeed || 0) * 100)}% vel.`;
    return `Nivel ${tower.level || 1} · daño ${formatCompactNumber(tower.damage || 0, 2)} · rango ${Math.round(tower.range || 0)} · delay ${Math.round(tower.fireDelay || 0)}ms`;
}

function getBarricadeInfoText(b) {
    ensureBarricadeEconomy(b);
    const hp = `${Math.ceil(b.hp || 0)}/${Math.ceil(b.maxHp || 0)}`;
    const level = b.kind === "standard" ? `Tier ${Math.max(0, (b.tier || 0) + 1)} · +${b.level || 0}` : `Nivel ${Math.max(1, (b.level || 0) + 1)}`;
    return `${getBarricadeKindLabel(b.kind)} · ${level} · HP ${hp}`;
}

function updateStructurePanel() {
    if (!structurePanel || !structurePanelTitle || !structurePanelInfo || !structurePanelActions) return;
    const selected = getSelectedStructures();
    selectedStructureIds = selected.map(item => String(item.id));
    if (!selected.length) {
        selectedStructureType = null;
        structurePanel.classList.add("hidden");
        return;
    }

    structurePanel.classList.remove("hidden");
    const multiple = selected.length > 1;

    if (selectedStructureType === "tower") {
        selected.forEach(ensureTowerEconomy);
        const first = selected[0];
        const upgradeTotal = selected.reduce((sum, t) => sum + (Number(t.upgradeCost) || 0), 0);
        const sellTotal = selected.reduce((sum, t) => sum + Math.floor((Number(t.spent) || 0) * TOWER_SELL_REFUND), 0);
        structurePanelTitle.textContent = multiple ? `${selected.length} torretas ${first.name}` : first.name;
        structurePanelInfo.innerHTML = `${multiple ? "Selección múltiple" : getTowerUpgradePreview(first)}<br><small>Ctrl+click selecciona todas las torres iguales.</small>`;
        structurePanelActions.innerHTML = `
            <button type="button" data-structure-action="upgrade" ${coins < upgradeTotal ? "disabled" : ""}>Mejorar ${multiple ? "todas" : ""} (${formatMoney(upgradeTotal)})</button>
            ${!multiple ? `<button type="button" data-structure-action="move">Mover</button>` : ""}
            <button type="button" data-structure-action="sell" class="dangerMiniButton">Vender ${multiple ? "todas" : ""} (${formatMoney(sellTotal)})</button>
        `;
        return;
    }

    selected.forEach(ensureBarricadeEconomy);
    const first = selected[0];
    const upgradeTotal = selected.reduce((sum, b) => sum + (Number(b.upgradeCost) || 0), 0);
    const damaged = selected.filter(b => b.hp < b.maxHp);
    const repairTotal = damaged.reduce((sum, b) => sum + getBarricadeRepairCost(b), 0);
    const sellTotal = selected.reduce((sum, b) => sum + getBarricadeSellRefund(b), 0);
    structurePanelTitle.textContent = multiple ? `${selected.length} barricadas ${getBarricadeKindLabel(first.kind)}` : `Barricada ${getBarricadeKindLabel(first.kind)}`;
    structurePanelInfo.innerHTML = `${multiple ? "Selección múltiple" : getBarricadeInfoText(first)}<br><small>Ctrl+click selecciona todas las barricadas iguales.</small>`;
    structurePanelActions.innerHTML = `
        <button type="button" data-structure-action="upgrade" ${coins < upgradeTotal ? "disabled" : ""}>Mejorar ${multiple ? "todas" : ""} (${formatMoney(upgradeTotal)})</button>
        <button type="button" data-structure-action="repair" ${damaged.length === 0 || coins < repairTotal ? "disabled" : ""}>Reparar ${multiple ? "dañadas" : ""} (${formatMoney(repairTotal)})</button>
        <button type="button" data-structure-action="sell" class="dangerMiniButton">Vender ${multiple ? "todas" : ""} (${formatMoney(sellTotal)})</button>
    `;
}

function getBarricadeRepairCost(b) {
    if (!b || b.hp >= b.maxHp) return 0;
    const missingRatio = Math.max(0, Math.min(1, (b.maxHp - b.hp) / Math.max(1, b.maxHp)));
    return Math.max(1, Math.ceil((Number(b.buildCost) || getBarricadeBaseCost(b.kind)) * 0.45 * missingRatio));
}

function getBarricadeSellRefund(b) {
    ensureBarricadeEconomy(b);
    return Math.floor((Number(b.spent) || 0) * TOWER_SELL_REFUND);
}

function upgradeBarricadeSelected() {
    const selected = getSelectedStructures();
    if (!selected.length || selectedStructureType !== "barricade") return;
    selected.forEach(ensureBarricadeEconomy);
    const total = selected.reduce((sum, b) => sum + Number(b.upgradeCost || 0), 0);
    if (coins < total) { showCenterMessage(`Faltan ${formatMissingMoney(total - coins)} monedas`, 850); updateStructurePanel(); return; }
    coins -= total;
    selected.forEach(b => {
        const paid = Number(b.upgradeCost) || 0;
        b.spent = (Number(b.spent) || 0) + paid;
        upgradeBarricadeInstance(b, b.kind || "standard", false);
        b.upgradeCost = scaleBarricadeCost(paid || getBarricadeBaseCost(b.kind), b.kind === "standard" ? 1.55 : 1.42);
    });
    showCenterMessage(selected.length > 1 ? `${selected.length} barricadas mejoradas` : "Barricada mejorada", 850);
    updateHud(true); updateStructurePanel(); autoSaveRun(true);
}

function repairBarricadeSelected() {
    const selected = getSelectedStructures().filter(b => selectedStructureType === "barricade" && b.hp < b.maxHp);
    if (!selected.length) return;
    const total = selected.reduce((sum, b) => sum + getBarricadeRepairCost(b), 0);
    if (coins < total) { showCenterMessage(`Faltan ${formatMissingMoney(total - coins)} monedas`, 850); updateStructurePanel(); return; }
    coins -= total;
    selected.forEach(b => { b.hp = b.maxHp; });
    showCenterMessage(selected.length > 1 ? `${selected.length} barricadas reparadas` : "Barricada reparada", 800);
    updateHud(true); updateStructurePanel(); autoSaveRun(true);
}

function sellBarricadeSelected() {
    const selected = getSelectedStructures();
    if (!selected.length || selectedStructureType !== "barricade") return;
    const ids = new Set(selected.map(b => String(b.id)));
    coins += selected.reduce((sum, b) => sum + getBarricadeSellRefund(b), 0);
    barricades = barricades.filter(b => !ids.has(String(b.id)));
    clearStructureSelection();
    showCenterMessage(selected.length > 1 ? `${selected.length} barricadas vendidas` : "Barricada vendida", 800);
    updateHud(true); autoSaveRun(true);
}

function upgradeTowerSelected() {
    const selected = getSelectedStructures();
    if (!selected.length || selectedStructureType !== "tower") return;
    selected.forEach(ensureTowerEconomy);
    const total = selected.reduce((sum, t) => sum + Number(t.upgradeCost || 0), 0);
    if (coins < total) { showCenterMessage(`Faltan ${formatMissingMoney(total - coins)} monedas`, 850); updateStructurePanel(); return; }
    selected.forEach(t => {
        const idx = towers.indexOf(t);
        if (idx >= 0) upgradeTower(idx, true);
    });
    showCenterMessage(selected.length > 1 ? `${selected.length} torretas mejoradas` : "Torre mejorada", 800);
    updateHud(true); updateStructurePanel(); autoSaveRun(true);
}

function sellTowerSelected() {
    const selected = getSelectedStructures();
    if (!selected.length || selectedStructureType !== "tower") return;
    const ids = new Set(selected.map(t => String(t.id)));
    coins += selected.reduce((sum, t) => sum + Math.floor((Number(t.spent) || 0) * TOWER_SELL_REFUND), 0);
    towers = towers.filter(t => !ids.has(String(t.id)));
    updateTowerSlotIndexes();
    clearStructureSelection();
    showCenterMessage(selected.length > 1 ? `${selected.length} torretas vendidas` : "Torre vendida", 800);
    updateHud(true); autoSaveRun(true);
}

function handleStructurePanelAction(action) {
    if (action === "upgrade") {
        if (selectedStructureType === "tower") upgradeTowerSelected();
        else upgradeBarricadeSelected();
    }
    if (action === "repair") repairBarricadeSelected();
    if (action === "sell") {
        if (selectedStructureType === "tower") sellTowerSelected();
        else sellBarricadeSelected();
    }
    if (action === "move") {
        const selected = getSelectedStructures();
        if (selectedStructureType === "tower" && selected.length === 1) beginTowerMove(towers.indexOf(selected[0]));
    }
}

function getCurrentBuildModeLabel() {
    if (pendingBarricadePlacement) return "Colocando barricadas · R rota";
    if (pendingTowerPurchase) {
        const def = getTowerDefinition(pendingTowerPurchase.defKey);
        return `Colocando ${def ? def.name : "torre"}`;
    }
    if (pendingTowerMoveIndex !== null) return "Moviendo torre";
    return "";
}

function updateBuildCancelUI() {
    if (!cancelBuildBtn) return;
    const active = isInBuildPlacementMode();
    cancelBuildBtn.classList.toggle("hidden", !active);
    if (active) cancelBuildBtn.textContent = `Cancelar · ${getCurrentBuildModeLabel()}`;
}

function updateMousePosition(event) {
    const rect = canvas.getBoundingClientRect();

    const scaleX = GAME_WIDTH / rect.width;
    const scaleY = GAME_HEIGHT / rect.height;

    mousePosition.x = camera.x + (event.clientX - rect.left) * scaleX;
    mousePosition.y = camera.y + (event.clientY - rect.top) * scaleY;
}

canvas.addEventListener("mousemove", event => {
    updateMousePosition(event);
});

function handleCanvasPlacementPointer(event) {
    updateMousePosition(event);

    if (pendingBarricadePlacement) {
        event.preventDefault();
        if (event.button === 2) {
            cancelBarricadePlacement(false);
            return;
        }
        finishBarricadePlacement();
        return;
    }

    if (pendingBarricadePlacement || pendingTowerPurchase || pendingTowerMoveIndex !== null) {
        event.preventDefault();
        if (event.button === 2) {
            cancelTowerPlacement(false);
            cancelTowerMove(false);
            return;
        }

        const tile = getTowerTileAt(mousePosition.x, mousePosition.y);
        if (pendingTowerPurchase) finishTowerPlacement(tile);
        else finishTowerMove(tile);
        return;
    }

    if (event.button === 0 && handleStructureClickSelection(event)) {
        event.preventDefault();
        isMouseDown = false;
        return;
    }

    isMouseDown = true;
}

canvas.addEventListener("mousedown", handleCanvasPlacementPointer);
canvas.addEventListener("pointerdown", event => {
    if (event.pointerType !== "mouse") {
        handleCanvasPlacementPointer(event);
    }
});

canvas.addEventListener("contextmenu", event => {
    if (pendingBarricadePlacement || pendingTowerPurchase || pendingTowerMoveIndex !== null) {
        event.preventDefault();
        cancelBarricadePlacement(false);
        cancelTowerPlacement(false);
        cancelTowerMove(false);
    }
});

window.addEventListener("mouseup", () => {
    isMouseDown = false;
});

window.addEventListener("keydown", event => {
    const tagName = event.target && event.target.tagName ? event.target.tagName.toLowerCase() : "";
    const isTypingField = tagName === "input" || tagName === "textarea";

    if (isTypingField && !listeningForControl) {
        return;
    }

    if (listeningForControl) {
        event.preventDefault();

        if (event.code !== "Escape") {
            setControlBinding(listeningForControl, event.code);
        }

        listeningForControl = null;
        updateControlsUI();
        return;
    }

    if (event.code === "ShiftLeft" || event.code === "ShiftRight") isShiftDown = true;

    if (event.code === "Escape") {
        event.preventDefault();

        if (pendingBarricadePlacement) {
            cancelBarricadePlacement(false);
            return;
        }

        if (pendingTowerPurchase || pendingTowerMoveIndex !== null) {
            cancelTowerPlacement(false);
            cancelTowerMove(false);
            return;
        }

        // Si la oleada quedó en un estado raro (sin correr, pero sin panel de pausa),
        // Escape primero la destraba en vez de meter otra pausa encima.
        if (waveInProgress && !isWaveBlockingPanelOpen() && !isElementVisible(pausePanel) && (isPaused || !gameRunning)) {
            forceResumeWave();
            return;
        }

        if (isPaused || isElementVisible(pausePanel)) {
            resumeGame();
        } else {
            pauseGame();
        }
        return;
    }

    if (event.code === "KeyR" && pendingBarricadePlacement) {
        event.preventDefault();
        barricadeBuildOrientation = barricadeBuildOrientation === "horizontal" ? "vertical" : "horizontal";
        showCenterMessage(`Barricada ${barricadeBuildOrientation === "horizontal" ? "horizontal" : "vertical"}`, 550);
        return;
    }

    if (isControlCode(event.code)) {
        event.preventDefault();
        pressedKeys.add(event.code);
    }

    if (event.code === "Space" && !isControlCode("Space")) {
        event.preventDefault();
        isSpaceDown = true;
    }

    const abilityId = getAbilityIdByCode(event.code);
    if (abilityId && !event.repeat) useAbility(abilityId);
});

window.addEventListener("keyup", event => {
    pressedKeys.delete(event.code);
    if (event.code === "ShiftLeft" || event.code === "ShiftRight") isShiftDown = false;

    if (event.code === "Space") {
        event.preventDefault();
        isSpaceDown = false;
    }
});

window.addEventListener("blur", () => {
    // Evita que queden teclas/mouse virtualmente apretados si la ventana pierde foco.
    pressedKeys.clear();
    isMouseDown = false;
    isSpaceDown = false;
    isShiftDown = false;
});

document.addEventListener("visibilitychange", () => {
    pressedKeys.clear();
    isMouseDown = false;
    isSpaceDown = false;
    isShiftDown = false;
    lastFrameTime = performance.now();

    if (document.hidden) {
        saveRunNow();
    } else {
        recoverFrozenWaveState("visibility");
    }

    syncMusicState();
});

window.addEventListener("focus", () => {
    lastFrameTime = performance.now();
    recoverFrozenWaveState("focus");
});

controlKeyButtons.forEach(button => {
    button.addEventListener("click", () => {
        listeningForControl = button.dataset.control;
        updateControlsUI();
    });
});

resetControlsButtons.forEach(button => {
    button.addEventListener("click", resetControlBindings);
});

updateControlsUI();

window.addEventListener("beforeunload", () => {
    saveRunNow();
});

window.addEventListener("pagehide", () => {
    saveRunNow();
});

updateStartButtonSavedState();

startGameBtn.addEventListener("click", startGame);

if (refreshLeaderboardBtn) refreshLeaderboardBtn.addEventListener("click", loadLeaderboard);
if (refreshLeaderboardGameBtn) refreshLeaderboardGameBtn.addEventListener("click", loadLeaderboard);
loadLeaderboard();

if (consoleBtn) consoleBtn.addEventListener("click", openConsole);
if (closeConsoleBtn) closeConsoleBtn.addEventListener("click", closeConsole);
if (consoleRunBtn) consoleRunBtn.addEventListener("click", () => {
    runConsoleCommand(consoleInput ? consoleInput.value : "");
    if (consoleInput) {
        consoleInput.value = "";
        consoleInput.focus();
    }
});
if (consoleInput) consoleInput.addEventListener("keydown", event => {
    if (event.key === "Enter") {
        event.preventDefault();
        runConsoleCommand(consoleInput.value);
        consoleInput.value = "";
    }
});



function openShop(sectionId = "stats") {
    if (!shop || !hasActiveRun) return;
    cancelBarricadePlacement(false);
    cancelTowerPlacement(false);
    waveSummaryPanel.classList.add("hidden");
    pausePanel.classList.add("hidden");
    shop.classList.remove("constructionMode");
    shop.classList.remove("hidden");
    if (shopTitle) shopTitle.textContent = "Tienda";
    setShopSection(sectionId);
    if (openShopHudBtn) {
        openShopHudBtn.textContent = "Cerrar tienda";
        openShopHudBtn.classList.add("shopOpen");
    }
    if (constructionBtn) {
        constructionBtn.textContent = "Construcción";
        constructionBtn.classList.remove("constructionOpen");
    }
    updateHud(true);
}

function openConstruction(sectionId = "towers") {
    if (!shop || !hasActiveRun) return;
    cancelBarricadePlacement(false);
    cancelTowerPlacement(false);
    waveSummaryPanel.classList.add("hidden");
    pausePanel.classList.add("hidden");
    shop.classList.add("constructionMode");
    shop.classList.remove("hidden");
    if (shopTitle) shopTitle.textContent = "Construcción";
    setShopSection(sectionId);
    if (constructionBtn) {
        constructionBtn.textContent = "Cerrar construcción";
        constructionBtn.classList.add("constructionOpen");
    }
    if (openShopHudBtn) {
        openShopHudBtn.textContent = "Tienda";
        openShopHudBtn.classList.remove("shopOpen");
    }
    updateHud(true);
}

function closeShop() {
    if (!shop) return;
    shop.classList.add("hidden");
    shop.classList.remove("constructionMode");
    if (shopTitle) shopTitle.textContent = "Tienda";
    if (openShopHudBtn) {
        openShopHudBtn.textContent = "Tienda";
        openShopHudBtn.classList.remove("shopOpen");
    }
    if (constructionBtn) {
        constructionBtn.textContent = "Construcción";
        constructionBtn.classList.remove("constructionOpen");
    }
    updateHud(true);
}

function toggleShop(sectionId = "stats") {
    if (!shop || shop.classList.contains("hidden") || shop.classList.contains("constructionMode")) openShop(sectionId);
    else closeShop();
}

function toggleConstruction(sectionId = "towers") {
    if (!shop || shop.classList.contains("hidden") || !shop.classList.contains("constructionMode")) openConstruction(sectionId);
    else closeShop();
}

function setShopSection(sectionId) {
    shopTabButtons.forEach(button => {
        button.classList.toggle("active", button.dataset.shopTab === sectionId);
    });

    shopSections.forEach(section => {
        section.classList.toggle("active", section.dataset.shopSection === sectionId);
    });
}

shopTabButtons.forEach(button => {
    button.addEventListener("click", () => setShopSection(button.dataset.shopTab));
});

if (openShopBtn) openShopBtn.addEventListener("click", () => {
    openShop("stats");
    syncMusicState();
    autoSaveRun(true);
});

if (openShopHudBtn) openShopHudBtn.addEventListener("click", () => {
    toggleShop("stats");
    syncMusicState();
    autoSaveRun(true);
});

if (constructionBtn) constructionBtn.addEventListener("click", () => {
    toggleConstruction("towers");
    syncMusicState();
    autoSaveRun(true);
});

if (cancelBuildBtn) cancelBuildBtn.addEventListener("click", () => {
    cancelBarricadePlacement(false);
    cancelTowerPlacement(false);
    cancelTowerMove(false);
    showCenterMessage("Construcción cancelada", 650);
    autoSaveRun(true);
});

if (closeShopBtn) closeShopBtn.addEventListener("click", () => {
    closeShop();
    syncMusicState();
    autoSaveRun(true);
});

if (closeStructurePanelBtn) closeStructurePanelBtn.addEventListener("click", () => clearStructureSelection());
if (structurePanelActions) structurePanelActions.addEventListener("click", event => {
    const button = event.target.closest("button[data-structure-action]");
    if (!button) return;
    event.preventDefault();
    handleStructurePanelAction(button.dataset.structureAction);
});

newRunBtn.addEventListener("click", () => {
    clearSavedRun();
    createDefaultState();
    hasActiveRun = true;
    startWave();
});

upgradeDamageBtn.addEventListener("click", () => {
    if (coins >= costs.damage) {
        coins -= costs.damage;
        player.damage += 1;
        costs.damage = scaleStatCost(costs.damage, 1.75);
        updateHud();
    }
});

upgradeFireRateBtn.addEventListener("click", () => {
    if (coins >= costs.fireRate) {
        coins -= costs.fireRate;
        player.fireDelay = Math.max(160, player.fireDelay - 40);
        costs.fireRate = scaleStatCost(costs.fireRate, 1.8);
        updateHud();
    }
});

upgradeMaxHpBtn.addEventListener("click", () => {
    if (coins >= costs.maxHp) {
        coins -= costs.maxHp;
        player.maxHp += 5;
        player.hp += 5;
        costs.maxHp = scaleStatCost(costs.maxHp, 1.7);
        updateHud();
    }
});

upgradeCritBtn.addEventListener("click", () => {
    if (coins >= costs.crit) {
        coins -= costs.crit;
        player.critChance = Math.min(0.6, player.critChance + 0.05);
        costs.crit = scaleStatCost(costs.crit, 1.85);
        updateHud();
    }
});

if (barricadeSlot1Btn) barricadeSlot1Btn.addEventListener("click", () => selectBarricadeSlot(0));
if (barricadeSlot2Btn) barricadeSlot2Btn.addEventListener("click", () => selectBarricadeSlot(1));

buySmallPotionBtn.addEventListener("click", () => buyConsumableToInventory("smallPotion", "smallPotion", 1.15));

buyMediumPotionBtn.addEventListener("click", () => buyConsumableToInventory("mediumPotion", "mediumPotion", 1.18));

buyLargePotionBtn.addEventListener("click", () => buyConsumableToInventory("largePotion", "largePotion", 1.22));

buyShieldPotionBtn?.addEventListener("click", () => buyConsumableToInventory("shieldPotion", "shieldPotion", 1.18));

buyAttackSpeedPotionBtn?.addEventListener("click", () => buyConsumableToInventory("attackSpeedPotion", "attackSpeedPotion", 1.2));

buyDoubleShotPotionBtn?.addEventListener("click", () => buyConsumableToInventory("doubleShotPotion", "doubleShotPotion", 1.18));

buyLifeStealPotionBtn?.addEventListener("click", () => buyConsumableToInventory("lifeStealPotion", "lifeStealPotion", 1.18));

repairBarricadeBtn.addEventListener("click", () => {
    showCenterMessage("Clickeá una barricada para repararla desde su panel", 900);
});

upgradeBarricadeBtn.addEventListener("click", () => buyOrUpgradeBarricade("standard"));
buyRegenBarricadeBtn?.addEventListener("click", () => buyOrUpgradeBarricade("regen"));
buyExplosiveBarricadeBtn?.addEventListener("click", () => buyOrUpgradeBarricade("explosive"));
buyThornsBarricadeBtn?.addEventListener("click", () => buyOrUpgradeBarricade("thorns"));

function getBarricadeUpgradeTarget(kind) {
    const activeBarricades = (barricades || []).filter(b => b.active && b.hp > 0 && b.kind === kind);
    const weakest = activeBarricades.sort((a, b) => (a.level || 0) - (b.level || 0) || a.maxHp - b.maxHp)[0];
    return weakest ? { target: weakest, isNew: false } : null;
}

function beginBarricadePlacement(kind = "standard", costKey = "upgradeBarricade") {
    if (pendingBarricadePlacement) return;
    const price = getBarricadeBaseCost(kind);
    if (coins < price) {
        showCenterMessage(`Faltan ${formatMissingMoney(price - coins)} monedas`, 800);
        return;
    }
    clearStructureSelection();
    pendingBarricadePlacement = { kind, costKey, price };
    pendingTowerPurchase = null;
    closeShop();
    waveSummaryPanel.classList.add("hidden");
    showCenterMessage("Colocá barricadas · R rota · seguí colocando hasta quedarte sin monedas", 1400);
    updateBuildCancelUI();
    updateHud(true);
}

function cancelBarricadePlacement(showShopAgain = false) {
    if (!pendingBarricadePlacement) return;
    pendingBarricadePlacement = null;
    updateBuildCancelUI();
    if (showShopAgain && hasActiveRun) {
        openConstruction("barricades");
    }
    updateHud(true);
}

function finishBarricadePlacement() {
    if (!pendingBarricadePlacement) return;
    const point = getSnappedBuildPoint();
    if (!isBarricadePositionValid(point.x, point.y, barricadeBuildOrientation)) {
        showCenterMessage("No se puede colocar ahí", 750);
        return;
    }
    const { kind, costKey } = pendingBarricadePlacement;
    const price = getBarricadeBaseCost(kind);
    if (coins < price) {
        showCenterMessage("Monedas insuficientes", 800);
        cancelBarricadePlacement(false);
        return;
    }
    coins -= price;
    const b = createFreeBarricade(kind, point.x, point.y, barricadeBuildOrientation);
    upgradeBarricadeInstance(b, kind, true);
    b.x = point.x;
    b.y = point.y;
    b.orientation = barricadeBuildOrientation;
    b.isBuildBarricade = true;
    barricades.push(b);
    // Comprar barricadas nuevas mantiene precio fijo.
    // El precio que escala ahora es el de mejora de cada barricada individual.
    const nextPrice = getBarricadeBaseCost(kind);
    if (coins < nextPrice) {
        pendingBarricadePlacement = null;
        showCenterMessage("Barricada colocada · sin monedas para otra", 900);
    } else {
        pendingBarricadePlacement = { kind, costKey, price: nextPrice };
        showCenterMessage("Barricada colocada · seguí construyendo o cancelá", 900);
    }

    updateBuildCancelUI();
    updateHud(true);
    autoSaveRun(true);
}

function buyOrUpgradeBarricade(kind = "standard") {
    const costKey = kind === "regen" ? "regenBarricade" : kind === "explosive" ? "explosiveBarricade" : kind === "thorns" ? "thornsBarricade" : "upgradeBarricade";
    beginBarricadePlacement(kind, costKey);
}



function upgradeBarricadeInstance(target, kind, resetKind = false) {
    const wasInactive = !target.active || target.hp <= 0;

    if (wasInactive || resetKind || target.kind !== kind) {
        target.kind = kind;
        target.active = true;
        target.tier = -1;
        target.level = 0;
    }

    if (kind === "standard") {
        if (target.tier < barricadeTiers.length - 1) {
            target.tier += 1;
        } else {
            target.level = (target.level || 0) + 1;
        }
    } else {
        if (wasInactive || resetKind || target.kind !== kind) {
            target.level = 0;
        } else {
            target.level = (target.level || 0) + 1;
        }
        target.tier = Math.max(0, target.tier || 0);
    }

    const tier = barricadeTiers[Math.max(0, target.tier)];
    const level = Math.max(0, target.level || 0);
    const baseHp = kind === "regen" ? 38 : kind === "explosive" ? 45 : kind === "thorns" ? 34 : 55;
    const tierHp = kind === "standard" ? Math.max(0, target.tier) * 32 : 0;
    const levelHp = level * (kind === "standard" ? 38 : kind === "regen" ? 24 : kind === "explosive" ? 28 : 22);

    target.color = kind === "regen" ? "#8a5cff" : kind === "explosive" ? "#d9792b" : kind === "thorns" ? "#9c6b35" : tier.color;
    target.maxHp = baseHp + tierHp + levelHp;
    target.hp = target.maxHp;
    target.regenPerSecond = kind === "regen" ? 1.15 + level * 0.28 : 0;
    target.explosive = kind === "explosive";
    target.thorns = kind === "thorns";
    target.lastRegenTime = getGameTime();

    const kindLabel = kind === "regen" ? "regenerativa" : kind === "explosive" ? "explosiva" : kind === "thorns" ? "con espinas" : "estándar";
    const tierLabel = kind === "standard" ? ` ${tier.name}` : "";
    const levelLabel = level > 0 ? ` +${level}` : "";
    showCenterMessage(`Barricada ${kindLabel}${tierLabel}${levelLabel}`, 850);
}

let lastTowerSlotPointerPurchaseAt = 0;

function handleBuyTowerSlotPointer(event) {
    event.preventDefault();
    event.stopPropagation();
    lastTowerSlotPointerPurchaseAt = performance.now();
    buyTowerSlot();
}

function handleBuyTowerSlotClick(event) {
    // Si ya resolvimos la compra en pointerdown, evitamos doble compra
    // cuando el navegador emite también el click.
    if (performance.now() - lastTowerSlotPointerPurchaseAt < 350) {
        event.preventDefault();
        return;
    }

    buyTowerSlot();
}

buyTowerSlotBtn?.addEventListener("pointerdown", handleBuyTowerSlotPointer);
buyTowerSlotBtn?.addEventListener("click", handleBuyTowerSlotClick);

towerDefinitions.forEach((def, index) => {
    const btn = document.getElementById(`buyTower${index + 1}Btn`);
    btn?.addEventListener("click", () => buyTower(def.key));
});

function handleTowerSlotActionClick(event) {
    const button = event.target.closest("button[data-tower-action]");
    if (!button) return;

    event.preventDefault();
    event.stopPropagation();

    const index = Number(button.dataset.index);
    const action = button.dataset.towerAction;

    if (!Number.isInteger(index)) return;
    if (action === "upgrade") upgradeTower(index);
    if (action === "move") beginTowerMove(index);
    if (action === "sell") sellTower(index);
}

// El panel de torres se re-renderiza constantemente desde updateHud/gameLoop.
// Si esperamos al evento click, el botón puede ser reemplazado entre mousedown y mouseup
// y el navegador nunca llega a emitir el click. Por eso resolvemos la acción en pointerdown.
function handleTowerSlotActionPointer(event) {
    if (!shop || shop.classList.contains("hidden")) return;
    if (!event.target.closest("#towerSlotsPanel")) return;
    handleTowerSlotActionClick(event);
}

towerSlotsPanel?.addEventListener("pointerdown", handleTowerSlotActionPointer);
document.addEventListener("pointerdown", handleTowerSlotActionPointer);

// Fallback para navegadores viejos o eventos disparados por teclado.
towerSlotsPanel?.addEventListener("click", handleTowerSlotActionClick);


function buyTowerSlot() {
    if (towerSlotLimit >= MAX_TOWER_LIMIT) {
        showCenterMessage("Ya tenés el máximo de slots", 850);
        return;
    }

    const price = Number(costs.towerSlot) || getTowerSlotCostForLimit(towerSlotLimit);

    if (coins < price) {
        showCenterMessage(`Faltan ${formatMissingMoney(price - coins)} monedas`, 850);
        updateHud(true);
        return;
    }

    coins -= price;
    towerSlotLimit = clampTowerSlotLimit(towerSlotLimit + 1);
    costs.towerSlot = towerSlotLimit >= MAX_TOWER_LIMIT ? 0 : getNextTowerSlotCost(price);

    towerSlotsRenderSignature = "";
    showCenterMessage(`+1 slot de torre · ${towerSlotLimit}/${MAX_TOWER_LIMIT}`, 900);
    updateHud(true);
    autoSaveRun(true);
}

function buyTower(defKey) {
    beginTowerPlacement(defKey);
}

function upgradeTower(index, silent = false) {
    const tower = towers[index];
    if (!tower) return;

    tower.upgradeCost = Number(tower.upgradeCost) || Math.floor((tower.cost || 100) * 1.35);

    if (coins < tower.upgradeCost) {
        if (!silent) showCenterMessage(`Faltan ${formatMissingMoney(tower.upgradeCost - coins)} monedas`, 800);
        return;
    }

    coins -= tower.upgradeCost;
    tower.spent = (Number(tower.spent) || 0) + tower.upgradeCost;
    tower.level = (Number(tower.level) || 1) + 1;

    if (tower.type === "basic") {
        tower.damage += 0.65;
        tower.range += 10;
        tower.fireDelay = Math.max(300, tower.fireDelay - 50);
    }

    if (tower.type === "rapid") {
        tower.damage += 0.24;
        tower.range += 8;
        tower.fireDelay = Math.max(190, tower.fireDelay - 24);
    }

    if (tower.type === "pierce") {
        tower.damage += 1.05;
        tower.range += 12;
        tower.fireDelay = Math.max(420, tower.fireDelay - 55);
    }

    if (tower.type === "slow") {
        tower.range += 14;
        tower.areaRadius += 5;
        tower.slowDuration += 180;
        tower.fireDelay = Math.max(1500, tower.fireDelay - 120);
    }

    if (tower.type === "double") {
        tower.damage += 0.6;
        tower.range += 10;
        tower.fireDelay = Math.max(390, tower.fireDelay - 55);
    }

    if (tower.type === "ballista") {
        tower.damage += 3.4;
        tower.range += 16;
        tower.fireDelay = Math.max(1450, tower.fireDelay - 150);
    }

    if (tower.type === "poison") {
        // Buff ligero: el veneno ahora puede sostener una build propia sin
        // convertirse en la opción dominante del juego.
        tower.damage += 0.9;
        tower.range += 10;
        tower.areaRadius += 3;
        tower.poisonDuration += 220;
        tower.tickDelay = Math.max(520, (tower.tickDelay || 650) - 15);
        tower.fireDelay = Math.max(2250, tower.fireDelay - 95);
    }

    if (tower.type === "siphon") {
        tower.damage += 0.35;
        tower.drainAmount += 1.05;
        tower.range += 10;
        tower.fireDelay = Math.max(520, tower.fireDelay - 45);
    }

    if (tower.type === "buffer") {
        tower.range += 18;
        tower.buffDamage += 0.025;
        tower.buffSpeed += 0.018;
    }

    tower.upgradeCost = scaleTowerUpgradeCost(tower.upgradeCost);
    if (!silent) {
        updateHud(true);
        updateStructurePanel();
        autoSaveRun(true);
    }
}

function sellTower(index) {
    const tower = towers[index];
    if (!tower) return;
    const refund = Math.floor((tower.spent || 0) * TOWER_SELL_REFUND);
    coins += refund;
    const soldId = String(tower.id);
    towers.splice(index, 1);
    selectedStructureIds = selectedStructureIds.filter(id => id !== soldId);
    updateTowerSlotIndexes();
    updateHud(true);
    autoSaveRun(true);
}

buyBombBtn.addEventListener("click", () => buyAbility("bomb"));
buyFreezeBtn.addEventListener("click", () => buyAbility("freeze"));
buyTsunamiBtn.addEventListener("click", () => buyAbility("tsunami"));
buyLightningBtn.addEventListener("click", () => buyAbility("lightning"));
buyMeteorBtn.addEventListener("click", () => buyAbility("meteor"));
if (buyEclipseBtn) buyEclipseBtn.addEventListener("click", () => buyAbility("eclipse"));

function pauseGame() {
    if (!gameStarted || !hasActiveRun) return;
    if (!waveInProgress) return;
    if (isPaused && isElementVisible(pausePanel)) return;

    isPaused = true;
    gameRunning = false;
    lastFrameTime = performance.now();

    pausePanel.classList.remove("hidden");
    confirmRestartBox.classList.add("hidden");

    syncMusicState();
    updateHud();
}

function resumeGame() {
    if (!gameStarted || !hasActiveRun) return;

    isPaused = false;
    lastFrameTime = performance.now();

    if (waveInProgress) {
        gameRunning = true;
    }

    pausePanel.classList.add("hidden");
    confirmRestartBox.classList.add("hidden");

    syncMusicState();
    updateHud();
}

function backToMainMenuWithoutLosingProgress() {
    isPaused = true;
    isInMainMenu = true;
    gameRunning = false;

    pausePanel.classList.add("hidden");
    confirmRestartBox.classList.add("hidden");

    gameArea.classList.add("hidden");
    menu.classList.remove("hidden");

    syncMusicState();
}

function restartRunFromPause() {
    clearSavedRun();
    stopMusicAndReset();

    createDefaultState();

    hasActiveRun = true;
    isPaused = false;
    isInMainMenu = false;

    pausePanel.classList.add("hidden");
    confirmRestartBox.classList.add("hidden");

    startWave();
}

function buyAbility(id) {
    const ability = abilities[id];

    if (ability.owned) return;

    if (coins >= ability.cost) {
        coins -= ability.cost;
        ability.owned = true;
        updateHud(true);
        autoSaveRun(true);
    }
}

pauseBtn.addEventListener("click", pauseGame);

resumeBtn.addEventListener("click", resumeGame);

backToMenuBtn.addEventListener("click", backToMainMenuWithoutLosingProgress);

restartRunBtn.addEventListener("click", () => {
    confirmRestartBox.classList.remove("hidden");
});

cancelRestartBtn.addEventListener("click", () => {
    confirmRestartBox.classList.add("hidden");
});

confirmRestartBtn.addEventListener("click", () => {
    restartRunFromPause();
});

window.addEventListener("blur", () => {
    syncMusicState();
});

window.addEventListener("resize", resizeCanvasForDisplay);

document.addEventListener("visibilitychange", () => {
    syncMusicState();
});

function updateMusicEnabled(value) {
    audioSettings.musicEnabled = value;
    saveAudioSettings();
    applyAudioSettingsToUI();
}

function updateSfxEnabled(value) {
    audioSettings.sfxEnabled = value;
    saveAudioSettings();
    applyAudioSettingsToUI();
}

function updateMusicVolume(value) {
    audioSettings.musicVolume = Number(value);
    saveAudioSettings();
    applyAudioSettingsToUI();
}

function updateSfxVolume(value) {
    audioSettings.sfxVolume = Number(value);
    saveAudioSettings();
    applyAudioSettingsToUI();
}

menuMusicToggle.addEventListener("change", () => {
    updateMusicEnabled(menuMusicToggle.checked);
});

pauseMusicToggle.addEventListener("change", () => {
    updateMusicEnabled(pauseMusicToggle.checked);
});

menuSfxToggle.addEventListener("change", () => {
    updateSfxEnabled(menuSfxToggle.checked);
});

pauseSfxToggle.addEventListener("change", () => {
    updateSfxEnabled(pauseSfxToggle.checked);
});

menuMusicVolume.addEventListener("input", () => {
    updateMusicVolume(menuMusicVolume.value);
});

pauseMusicVolume.addEventListener("input", () => {
    updateMusicVolume(pauseMusicVolume.value);
});

menuSfxVolume.addEventListener("input", () => {
    updateSfxVolume(menuSfxVolume.value);
});

pauseSfxVolume.addEventListener("input", () => {
    updateSfxVolume(pauseSfxVolume.value);
});

repeatWaveBtn.addEventListener("click", () => {
    if (waveInProgress) return;
    const repeats = getRepeatCountForCurrentWave();
    if (repeats >= REPEAT_LIMIT_PER_WAVE) {
        showCenterMessage("Límite de repeticiones", 900);
        updateHud();
        return;
    }

    repeatCountsByWave[wave] = Math.min(REPEAT_LIMIT_PER_WAVE, repeats + 1);
    isRepeatingWave = true;
    currentGoldMultiplier = 0.5;
    startWave();
});


nextWaveBtn.addEventListener("click", () => {
    if (waveInProgress) return;
    wave++;
    autoRepeatWaveMode = false;
    isRepeatingWave = false;
    currentGoldMultiplier = 1;
    startWave();
});

speedBtn.addEventListener("click", () => {
    speedIndex++;

    if (speedIndex >= speedOptions.length) {
        speedIndex = 0;
    }

    gameSpeed = speedOptions[speedIndex];
    speedBtn.textContent = `Velocidad x${gameSpeed}`;
});

autoModeBtn.addEventListener("click", () => {
    autoMode = !autoMode;

    if (autoMode) {
        autoModeBtn.textContent = "Auto ON";
        autoModeBtn.classList.add("autoActive");
    } else {
        autoModeBtn.textContent = "Auto OFF";
        autoModeBtn.classList.remove("autoActive");
    }
});

bestScoreMenuText.textContent = formatCompactNumber(bestScore);
createDefaultState();
applyAudioSettingsToUI();
draw();
