const canvas = document.getElementById("gameCanvas");
const ctx = canvas.getContext("2d");

// Tamaño lógico del juego: NO cambia gameplay, colisiones, rangos ni posiciones.
// El canvas ahora renderiza a la resolución REAL en pantalla para evitar el efecto
// de imagen agrandada/borrosa en monitores grandes.
const GAME_WIDTH = 900;
const GAME_HEIGHT = 450;
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

const redFlash = document.getElementById("redFlash");
const bossBarBox = document.getElementById("bossBarBox");
const bossBarFill = document.getElementById("bossBarFill");
const bossNameText = document.getElementById("bossNameText");
const centerMessage = document.getElementById("centerMessage");

const waveSummaryPanel = document.getElementById("waveSummaryPanel");
const openShopBtn = document.getElementById("openShopBtn");

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

let gameSpeed = 1;
let speedOptions = [1, 2, 2.5];
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

const alphaTesterCommands = {
    aza: "Aza",
    saki: "Saki",
    valen: "Valen",
    lio: "Lio",
    ema: "Ema",
    lal: "Lal"
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

const MAX_TOWERS = 12;
const TOWER_SELL_REFUND = 0.7;
const REPEAT_LIMIT_PER_WAVE = 5;
let repeatCountsByWave = {};
let isRepeatingWave = false;
let currentGoldMultiplier = 1;
let doomSpawnedThisWave = false;
let lastDoomWave = -999;

const TOWER_TILE_SIZE = 50;
const TOWER_TILE_HALF = TOWER_TILE_SIZE / 2;
const towerSlots = createTowerPlacementTiles();

let pendingTowerPurchase = null;

function createTowerPlacementTiles() {
    const tiles = [];
    const xPositions = [185, 245, 305, 365, 425, 485, 545, 605, 665, 725, 785];
    const yPositions = [70, 130, 190, 310, 370];

    yPositions.forEach(y => {
        xPositions.forEach(x => {
            tiles.push({ x, y, size: TOWER_TILE_SIZE });
        });
    });

    return tiles;
}

const towerDefinitions = [
    { key: "tower1", name: "Básica", type: "basic", cost: 70, upgradeCost: 100, damage: 1, range: 230, fireDelay: 900, color: "cyan", label: "B" },
    { key: "tower2", name: "Rápida", type: "rapid", cost: 105, upgradeCost: 145, damage: 0.65, range: 215, fireDelay: 360, color: "#b9ff7a", label: "R" },
    { key: "tower3", name: "Perforante", type: "pierce", cost: 160, upgradeCost: 180, damage: 3, range: 250, fireDelay: 1200, color: "#ffdf6b", label: "P" },
    { key: "tower4", name: "Hielo", type: "slow", cost: 220, upgradeCost: 240, damage: 0, range: 260, fireDelay: 2600, color: "#9be7ff", label: "H", slowAmount: 0.45, slowDuration: 1600, areaRadius: 58 },
    { key: "tower5", name: "Doble", type: "double", cost: 260, upgradeCost: 300, damage: 1, range: 235, fireDelay: 1050, color: "#ff8bd1", label: "D" },
    { key: "tower6", name: "Veneno", type: "poison", cost: 310, upgradeCost: 350, damage: 5, range: 250, fireDelay: 2400, color: "#8cff4a", label: "V", areaRadius: 62, poisonDuration: 3300, tickDelay: 550 },
    { key: "tower7", name: "Ballesta", type: "ballista", cost: 360, upgradeCost: 420, damage: 14, range: 320, fireDelay: 2850, color: "#c58b4b", label: "X" },
    { key: "tower8", name: "Sanguijuela", type: "siphon", cost: 420, upgradeCost: 460, damage: 1, drainAmount: 2.8, range: 245, fireDelay: 850, color: "#b81444", label: "S" },
    { key: "tower9", name: "Buffer", type: "buffer", cost: 620, upgradeCost: 600, damage: 0, range: 180, fireDelay: 999999, color: "#b78cff", label: "+", buffDamage: 0.16, buffSpeed: 0.12 },
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
        healRadius: 95,
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
        hp: 95,
        speed: 0.16,
        reward: 70,
        score: 180,
        damageToDefense: 999,
        attackDelay: 99999,
        special: "doombringer",
        unlockWave: 22,
        rare: true
    }
];

const bossTypes = [
    { name: "Jefe del Abismo", variant: "barrage", color: "#ff7b00", hp: 58, speed: 0.30, reward: 60, score: 170, damageToDefense: 4, attackDelay: 1250 },
    { name: "Parpadeo Mayor", variant: "blink", color: "#d58cff", hp: 52, speed: 0.34, reward: 62, score: 175, damageToDefense: 4, attackDelay: 1300 },
    { name: "Orbe Rebotante", variant: "dvd", color: "#9be7ff", hp: 55, speed: 0.38, reward: 64, score: 180, damageToDefense: 4, attackDelay: 1200 },
    { name: "Mortero Carmesí", variant: "mortar", color: "#ff4747", hp: 64, speed: 0.24, reward: 66, score: 190, damageToDefense: 5, attackDelay: 1400 },
    { name: "Corona de Espinas", variant: "spiral", color: "#73ff9f", hp: 60, speed: 0.28, reward: 68, score: 195, damageToDefense: 4, attackDelay: 1300 }
];

function getBossTypeForWave() {
    return bossTypes[Math.floor((wave / 10 - 1) % bossTypes.length)];
}


function createBarricadeSlot(name, x) {
    return {
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
        lastRegenTime: 0
    };
}

function getActiveBarricades() {
    return (barricades || []).filter(b => b.active && b.hp > 0);
}

function getCurrentDefenseBarricade() {
    const active = getActiveBarricades();
    if (active.length === 0) return null;
    return active.reduce((best, b) => b.x > best.x ? b : best, active[0]);
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

    b.hp -= amount;

    if (b.thorns && sourceEnemy) {
        const reflected = Math.max(1, amount * 0.5);
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

function explodeBarricade(b) {
    const radius = 120;
    const damage = 10 + wave * 0.6;

    effects.push({ type: "circle", x: b.x, y: GAME_HEIGHT / 2, radius: 14, maxRadius: radius, life: 34, color: "#ff8d2a" });

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

function getTowerDefinition(keyOrType) {
    return towerDefinitions.find(def => def.key === keyOrType || def.type === keyOrType);
}

function isTowerTileOccupied(tile) {
    return towers.some(tower => Math.hypot(tower.x - tile.x, tower.y - tile.y) < 2);
}

function getTowerTileAt(x, y) {
    return towerSlots.find(tile => (
        Math.abs(x - tile.x) <= TOWER_TILE_HALF &&
        Math.abs(y - tile.y) <= TOWER_TILE_HALF
    ));
}

function isTowerTileAvailable(tile) {
    return !!tile && !isTowerTileOccupied(tile);
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
        fireDelayMultiplier: 1
    };
}

function beginTowerPlacement(defKey) {
    if (towers.length >= MAX_TOWERS) {
        showCenterMessage("Límite de torres alcanzado", 900);
        return;
    }

    const def = getTowerDefinition(defKey);
    if (!def) return;

    const price = costs[def.key] ?? def.cost;
    if (coins < price) {
        showCenterMessage("Monedas insuficientes", 800);
        return;
    }

    pendingTowerPurchase = { defKey, price };
    shop.classList.add("hidden");
    waveSummaryPanel.classList.add("hidden");
    showCenterMessage(`Colocá: ${def.name}`, 1100);
    updateHud();
}

function cancelTowerPlacement(showShopAgain = true) {
    if (!pendingTowerPurchase) return;
    pendingTowerPurchase = null;
    if (showShopAgain && !waveInProgress && hasActiveRun) {
        shop.classList.remove("hidden");
    }
    updateHud();
}

function finishTowerPlacement(tile) {
    if (!pendingTowerPurchase || !isTowerTileAvailable(tile)) {
        showCenterMessage("Tile ocupado o inválido", 700);
        return;
    }

    let def = getTowerDefinition(pendingTowerPurchase.defKey);
    if (!def) {
        cancelTowerPlacement(false);
        return;
    }

    const price = pendingTowerPurchase.price;
    if (coins < price) {
        showCenterMessage("Monedas insuficientes", 800);
        cancelTowerPlacement(true);
        return;
    }

    coins -= price;

    if (def.type === "lucky") {
        const options = towerDefinitions.filter(t => t.type !== "lucky");
        def = options[Math.floor(Math.random() * options.length)];
        showCenterMessage(`Lucky Block: ${def.name}`, 900);
    } else {
        showCenterMessage(`${def.name} colocada`, 750);
    }

    const tower = createTowerFromDefinition(def, price, tile);
    if (!tower) {
        coins += price;
        showCenterMessage("No se pudo colocar", 800);
        return;
    }

    towers.push(tower);
    pendingTowerPurchase = null;
    if (!waveInProgress && hasActiveRun) shop.classList.remove("hidden");
    updateHud();
}

function getGoldAmount(amount) {
    return Math.ceil(amount * currentGoldMultiplier);
}

function getRepeatCountForCurrentWave() {
    return repeatCountsByWave[wave] || 0;
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

    player = {
        x: 80,
        y: GAME_HEIGHT / 2,
        damage: 1,
        fireDelay: 550,
        lastShotTime: 0,
        maxHp: 20,
        hp: 20,
        critChance: 0,
        critMultiplier: 2,
        moveSpeed: 2.75,
        shieldCharges: 0,
        doubleShotUntil: 0,
        attackSpeedUntil: 0,
        lifeStealUntil: 0,
        lifeStealPercent: 0,
        immortal: false,
        alphaTester: Boolean(alphaTesterName),
        name: alphaTesterName || playerName

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

    if (autoRepeatWaveBtn) {
        autoRepeatWaveBtn.textContent = "Auto repetir OFF";
        autoRepeatWaveBtn.classList.remove("autoActive");
    }

    pressedKeys.clear();
    isSpaceDown = false;
    repeatCountsByWave = {};
    isRepeatingWave = false;
    currentGoldMultiplier = 1;

    barricades = [
        createBarricadeSlot("Inicio", 120),
        createBarricadeSlot("Avanzada", 315)
    ];
    barricade = barricades[0];

    towers = [];

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

    if (!hasActiveRun) {
        createDefaultState();
        hasActiveRun = true;
        startWave();
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

    shop.classList.add("hidden");
    waveSummaryPanel.classList.add("hidden");
    gameOverScreen.classList.add("hidden");

    if (isBossWave()) {
        showCenterMessage("¡BOSS!", 1800);
    }

    isPaused = false;
    lastFrameTime = performance.now();
    frameScale = 1;
    syncMusicState();
    updateHud();
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

function createEnemyFromType(type, options = {}) {
    const hpScaling = options.ignoreScaling ? 1 : 1 + wave * 0.13;
    const speedScaling = options.ignoreScaling ? 0 : wave * 0.012;
    const maxHp = Math.max(1, Math.ceil(type.hp * hpScaling));
    const speed = type.speed + speedScaling;

    return {
        x: options.x ?? GAME_WIDTH + 30,
        y: options.y ?? 70 + Math.random() * (GAME_HEIGHT - 140),
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
    if (wave < 22) return false;
    if (lastDoomWave === wave - 1) return false;
    return Math.random() < Math.min(0.08, 0.025 + wave * 0.0012);
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
        speed: 1.22 + wave * 0.006,
        reward: 1,
        score: 2,
        damageToDefense: 1,
        attackDelay: 760
    };

    enemies.push(createEnemyFromType(miniType, {
        x,
        y: Math.max(45, Math.min(GAME_HEIGHT - 45, y)),
        radius: 11,
        reward: 1,
        scoreValue: 3 + Math.floor(wave / 4),
        ignoreScaling: true,
        isMini: true
    }));
}

function spawnBoss() {
    const type = getBossTypeForWave();
    const hpScaling = 1 + wave * 0.22;
    const maxHp = Math.ceil(type.hp * hpScaling);
    const speed = type.speed + wave * 0.004;

    enemies.push({
        x: GAME_WIDTH + 70,
        y: GAME_HEIGHT / 2,
        radius: 42,
        color: type.color,
        hp: maxHp,
        maxHp,
        baseSpeed: speed,
        originalBaseSpeed: speed,
        speed,
        reward: type.reward + wave * 4,
        scoreValue: type.score + wave * 12,
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
        dvdVy: Math.random() < 0.5 ? 1.05 : -1.05,
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
        tickDelay: options.tickDelay
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
                damageEnemy(target, 1, false, "#ff5d86", "tower");
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

function updatePlayerMovement() {
    if (!gameRunning || !waveInProgress || isPaused || !player) return;

    let direction = 0;
    if (pressedKeys.has(controlBindings.moveUp)) direction -= 1;
    if (pressedKeys.has(controlBindings.moveDown)) direction += 1;

    if (direction === 0) return;

    // Movimiento vertical nerfeado: el jugador ya no escala 1:1 con la velocidad del juego.
    // Esto hace que esquivar proyectiles de bosses requiera más anticipación.
    const movementSpeedMultiplier = Math.min(1.25, Math.sqrt(gameSpeed));
    player.y += direction * player.moveSpeed * movementSpeedMultiplier * frameScale;
    player.y = Math.max(32, Math.min(GAME_HEIGHT - 32, player.y));
}

function updateTowers() {
    applyTowerBuffs();

    towers.forEach(tower => {
        if (!tower.owned || tower.type === "buffer") return;

        let closestEnemy = null;
        let closestDistance = Infinity;

        enemies.forEach(enemy => {
            if (enemy.untargetable) return;
            const distance = Math.hypot(enemy.x - tower.x, enemy.y - tower.y);

            if (distance < closestDistance && distance <= tower.range) {
                closestDistance = distance;
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
    return 35;
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
            enemy.y = Math.max(45, Math.min(GAME_HEIGHT - 45, enemy.y + (Math.random() - 0.5) * 120));

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
        life: options.life ?? 4200
    });
}

function updateBossSpecials(now, defenseLineX) {
    enemies.forEach(enemy => {
        if (!enemy.isBoss) return;

        if (enemy.bossVariant === "dvd") {
            enemy.y += enemy.dvdVy * gameSpeed * frameScale;
            if (enemy.y < 55 || enemy.y > GAME_HEIGHT - 55) {
                enemy.dvdVy *= -1;
                enemy.y = Math.max(55, Math.min(GAME_HEIGHT - 55, enemy.y));
                fireBossProjectile(enemy.x, enemy.y, player.x, player.y, { speed: 3.6, radius: 7, damage: 3, color: "#9be7ff" });
            }
        }

        if (enemy.bossBurstLeft > 0 && now >= enemy.nextBurstShotAt) {
            enemy.bossBurstLeft--;
            enemy.nextBurstShotAt = now + 180;
            fireBossProjectile(enemy.x - 20, enemy.y, player.x, player.y, { speed: 4.1, radius: 7, damage: 3, color: enemy.color, angleOffset: (Math.random() - 0.5) * 0.16 });
        }

        if (now - enemy.lastBossSpecialTime < 2400) return;
        enemy.lastBossSpecialTime = now;

        if (enemy.bossVariant === "blink") {
            const oldX = enemy.x;
            const oldY = enemy.y;
            enemy.x = Math.max(defenseLineX + 95, enemy.x - 105);
            enemy.y = Math.max(60, Math.min(GAME_HEIGHT - 60, player.y + (Math.random() - 0.5) * 110));
            fireBossProjectile(enemy.x, enemy.y, player.x, player.y, { speed: 4.3, radius: 8, damage: 4, color: "#d58cff" });
            enemy.x = Math.min(GAME_WIDTH + 60, enemy.x + 55);
            effects.push({ type: "line", x1: oldX, y1: oldY, x2: enemy.x, y2: enemy.y, life: 18, color: "#d58cff" });
            effects.push({ type: "circle", x: enemy.x, y: enemy.y, radius: 8, maxRadius: 52, life: 20, color: "#d58cff" });
        }

        if (enemy.bossVariant === "barrage") {
            enemy.bossBurstLeft = 5;
            enemy.nextBurstShotAt = now;
        }

        if (enemy.bossVariant === "mortar") {
            for (let i = -1; i <= 1; i++) {
                fireBossProjectile(enemy.x, enemy.y, player.x, player.y + i * 34, { speed: 2.35, radius: 10, damage: 5, color: "#ff4747" });
            }
        }

        if (enemy.bossVariant === "spiral") {
            for (let i = 0; i < 8; i++) {
                const angle = enemy.spiralAngle + (Math.PI * 2 / 8) * i;
                bossProjectiles.push({
                    x: enemy.x, y: enemy.y,
                    dx: Math.cos(angle), dy: Math.sin(angle),
                    speed: 2.8, radius: 7, damage: 3, color: "#73ff9f", life: 3600
                });
            }
            enemy.spiralAngle += 0.45;
        }
    });
}

function updateBossProjectiles() {
    for (let i = bossProjectiles.length - 1; i >= 0; i--) {
        const p = bossProjectiles[i];
        p.x += p.dx * p.speed * gameSpeed * frameScale;
        p.y += p.dy * p.speed * gameSpeed * frameScale;
        p.life -= 16.666 * frameScale;

        if (p.x < -40 || p.x > GAME_WIDTH + 40 || p.y < -40 || p.y > GAME_HEIGHT + 40 || p.life <= 0) {
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
            enemy.x += enemy.knockbackX * gameSpeed * frameScale;
            enemy.knockbackX *= Math.pow(0.75, frameScale);
            if (enemy.knockbackX < 0.1) enemy.knockbackX = 0;
        }
    });

    for (let i = enemies.length - 1; i >= 0; i--) {
        const enemy = enemies[i];
        const hasReachedDefense = enemy.x - enemy.radius <= defenseLineX;

        if (!hasReachedDefense) {
            enemy.x -= enemy.speed * gameSpeed * frameScale;
            enemy.isAttacking = false;
            enemy.target = null;
            continue;
        }

        enemy.isAttacking = true;

        if (enemy.special === "doombringer") {
            if (player && player.immortal) {
                createImpactParticles(enemy.x, enemy.y, "#ffe28a");
                enemies.splice(i, 1);
                showCenterMessage("Titán anulado", 800);
                continue;
            }
            showCenterMessage("EL TITÁN TOCÓ LA BASE", 1200);
            player.hp = 0;
            endRun();
            return;
        }

        const targetBarricade = getCurrentDefenseBarricade();

        if (targetBarricade) {
            enemy.target = "barricade";

            if (now - enemy.lastAttackTime >= enemy.attackDelay) {
                if (player.shieldCharges > 0) {
                    player.shieldCharges--;
                    enemy.lastAttackTime = now;
                    createImpactParticles(targetBarricade.x, enemy.y, "#9be7ff");
                    showCenterMessage("¡Golpe bloqueado!", 600);
                } else {
                    damageBarricade(targetBarricade, enemy.damageToDefense, enemy);
                    enemy.lastAttackTime = now;
                    createImpactParticles(targetBarricade.x, enemy.y, "#d6a05f");
                }
            }
        } else {
            enemy.target = "base";

            if (now - enemy.lastAttackTime >= enemy.attackDelay) {
                if (player.shieldCharges > 0) {
                    player.shieldCharges--;
                    enemy.lastAttackTime = now;
                    createImpactParticles(35, enemy.y, "#9be7ff");
                    showCenterMessage("¡Golpe bloqueado!", 600);
                    updateHud();
                    continue;
                }

                if (player.immortal) {
                    enemy.lastAttackTime = now;
                    createImpactParticles(35, enemy.y, "#ffe28a");
                    showCenterMessage("¡Inmortal!", 450);
                    continue;
                }

                player.hp -= enemy.damageToDefense;
                enemy.lastAttackTime = now;
                triggerRedFlash();
                createImpactParticles(35, enemy.y, "#ff4444");

                if (player.hp <= 0) {
                    player.hp = 0;
                    endRun();
                    return;
                }
            }
        }
    }
}

function updateProjectiles() {
    for (let i = projectiles.length - 1; i >= 0; i--) {
        const p = projectiles[i];

        p.x += p.dx * p.speed * gameSpeed * frameScale;
        p.y += p.dy * p.speed * gameSpeed * frameScale;

        if (p.x < 0 || p.x > GAME_WIDTH || p.y < 0 || p.y > GAME_HEIGHT) {
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
                    createSlowZone(p.x, p.y, p.areaRadius, p.slowAmount, p.slowDuration);
                    createImpactParticles(p.x, p.y, p.color);
                    projectiles.splice(i, 1);
                    break;
                }

                if (p.type === "poison") {
                    createPoisonZone(p.x, p.y, p.areaRadius, p.damage || 5, p.poisonDuration, p.tickDelay);
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
            y: Math.max(42, Math.min(GAME_HEIGHT - 42, enemy.y + (i === 0 ? -22 : 22))),
            radius: Math.max(10, enemy.radius * 0.78),
            ignoreScaling: true,
            splitLevel: nextLevel
        }));
    }
}

function createSlowZone(x, y, radius, slowAmount, duration) {
    const now = getGameTime();

    slowZones.push({
        x,
        y,
        radius,
        createdAt: now,
        expiresAt: now + duration,
        slowAmount
    });

    enemies.forEach(enemy => {
        const dist = Math.hypot(enemy.x - x, enemy.y - y);

        if (dist <= radius && !enemy.slowImmune) {
            enemy.slowMultiplier = slowAmount;
            enemy.slowUntil = now + duration;
        }
    });
}


function createPoisonZone(x, y, radius, damage, duration, tickDelay) {
    const now = getGameTime();

    poisonZones.push({
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
}

function createImpactParticles(x, y, color) {
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

    if (autoRepeatWaveMode) {
        const repeats = getRepeatCountForCurrentWave();

        if (repeats < REPEAT_LIMIT_PER_WAVE) {
            showCenterMessage(`Auto repetir ${repeats + 1}/${REPEAT_LIMIT_PER_WAVE}`, 700);

            setTimeout(() => {
                if (!autoRepeatWaveMode) {
                    showWaveSummary();
                    return;
                }

                if (!hasActiveRun) return;

                repeatCountsByWave[wave] = getRepeatCountForCurrentWave() + 1;
                isRepeatingWave = true;
                currentGoldMultiplier = 0.5;
                startWave();
            }, 900);

            return;
        }

        autoRepeatWaveMode = false;
        if (autoRepeatWaveBtn) {
            autoRepeatWaveBtn.textContent = "Auto repetir OFF";
            autoRepeatWaveBtn.classList.remove("autoActive");
        }
        showCenterMessage("Auto repetir: límite alcanzado", 900);
    }

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
    summaryGoldText.textContent = waveStats.gold;
    summaryScoreText.textContent = waveStats.score;
    summaryHpText.textContent = `${Math.round(player.hp)}/${player.maxHp}`;
    summaryBarricadeText.textContent = `${Math.round(getTotalBarricadeHp())}/${Math.round(getTotalBarricadeMaxHp())}`;
    summaryBonusText.textContent = waveStats.bonus;

    waveSummaryPanel.classList.remove("hidden");
}

function endRun() {
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
        deathMessageText.textContent = "¡Nuevo récord! La base cayó, pero esta run fue la mejor hasta ahora.";
    } else {
        deathMessageText.textContent = "Tu base cayó. La run terminó y el progreso se reinició.";
    }

    finalScoreText.textContent = score;
    bestScoreText.textContent = bestScore;
    bestScoreMenuText.textContent = bestScore;

    gameOverScreen.classList.remove("hidden");
    shop.classList.add("hidden");
    waveSummaryPanel.classList.add("hidden");

    updateHud();
}

function healOverTime(totalHeal, durationMs) {
    const ticks = 10;
    const healPerTick = totalHeal / ticks;
    const tickDuration = durationMs / ticks;
    let currentTick = 0;

    const interval = setInterval(() => {
        if (!gameStarted || !player) {
            clearInterval(interval);
            return;
        }

        if (player.hp >= player.maxHp) {
            clearInterval(interval);
            return;
        }

        player.hp = Math.min(player.maxHp, player.hp + healPerTick);
        player.hp = Math.round(player.hp);

        currentTick++;

        if (currentTick >= ticks) clearInterval(interval);

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
        x: GAME_WIDTH / 2,
        y: GAME_HEIGHT / 2,
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
    ctx.fillStyle = "#444";
    ctx.fillRect(0, 0, 35, GAME_HEIGHT);

    ctx.fillStyle = "white";
    ctx.font = "16px Arial";
    ctx.fillText("BASE", 3, 25);
}

function drawBarricade() {
    (barricades || []).forEach(b => {
        if (!b.active || b.hp <= 0) return;

        ctx.fillStyle = b.color;
        ctx.fillRect(b.x - 10, 45, 20, GAME_HEIGHT - 90);

        if (b.thorns) {
            ctx.fillStyle = "#ff9f55";
            for (let y = 60; y < GAME_HEIGHT - 60; y += 28) {
                ctx.beginPath();
                ctx.moveTo(b.x + 10, y);
                ctx.lineTo(b.x + 28, y + 8);
                ctx.lineTo(b.x + 10, y + 16);
                ctx.fill();
            }
        }

        ctx.fillStyle = "white";
        ctx.font = "11px Arial";
        ctx.fillText(b.name[0], b.x - 4, 38);

        const barHeight = GAME_HEIGHT - 90;
        const hpPercent = b.maxHp > 0 ? b.hp / b.maxHp : 0;

        ctx.fillStyle = "red";
        ctx.fillRect(b.x + 18, 45, 8, barHeight);

        ctx.fillStyle = "lime";
        ctx.fillRect(
            b.x + 18,
            45 + barHeight * (1 - hpPercent),
            8,
            barHeight * hpPercent
        );
    });
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
        if (player.alphaTester) {
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

function activateAlphaTesterBadge(name) {
    alphaTesterName = name;
    playerName = name;
    localStorage.setItem("ardentAlphaTesterName", alphaTesterName);
    localStorage.setItem("ardentPlayerName", playerName);

    if (player) {
        player.name = name;
        player.alphaTester = true;
    }

    if (playerNameInput) playerNameInput.value = name;
}


function drawTowerPlacementTiles() {
    if (!pendingTowerPurchase) return;

    const hoveredTile = getTowerTileAt(mousePosition.x, mousePosition.y);

    towerSlots.forEach(tile => {
        const occupied = isTowerTileOccupied(tile);
        const hovered = hoveredTile === tile;

        ctx.fillStyle = occupied
            ? "rgba(255, 80, 80, 0.16)"
            : hovered
                ? "rgba(115, 255, 159, 0.32)"
                : "rgba(115, 255, 159, 0.13)";
        ctx.fillRect(tile.x - TOWER_TILE_HALF, tile.y - TOWER_TILE_HALF, TOWER_TILE_SIZE, TOWER_TILE_SIZE);

        ctx.strokeStyle = occupied
            ? "rgba(255, 80, 80, 0.55)"
            : hovered
                ? "rgba(115, 255, 159, 0.9)"
                : "rgba(115, 255, 159, 0.45)";
        ctx.lineWidth = hovered ? 3 : 1.5;
        ctx.strokeRect(tile.x - TOWER_TILE_HALF, tile.y - TOWER_TILE_HALF, TOWER_TILE_SIZE, TOWER_TILE_SIZE);
    });

    const def = getTowerDefinition(pendingTowerPurchase.defKey);
    if (def && hoveredTile && isTowerTileAvailable(hoveredTile)) {
        ctx.strokeStyle = "rgba(255,255,255,0.35)";
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(hoveredTile.x, hoveredTile.y, def.range || 0, 0, Math.PI * 2);
        ctx.stroke();
    }

    ctx.fillStyle = "rgba(0,0,0,0.72)";
    ctx.fillRect(145, 12, 610, 34);
    ctx.fillStyle = "white";
    ctx.font = "bold 15px Arial";
    ctx.fillText("Elegí un tile verde para colocar la torreta · Click derecho o ESC cancela", 160, 34);
}

function drawTowers() {
    towers.forEach(tower => {
        if (!tower.owned) return;

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

function updateHud() {
    waveText.textContent = wave;
    hpText.textContent = `${Math.round(player.hp)}/${player.maxHp}${player.shieldCharges > 0 ? ` 🛡${player.shieldCharges}` : ""}`;
    barricadeText.textContent = `${Math.round(getTotalBarricadeHp())}/${Math.round(getTotalBarricadeMaxHp())}`;
    coinsText.textContent = coins;
    scoreText.textContent = score;

    playerDamageText.textContent = player.damage;
    playerFireDelayText.textContent = player.fireDelay;
    playerMaxHpText.textContent = player.maxHp;
    critChanceText.textContent = Math.round(player.critChance * 100);

    damageCostText.textContent = costs.damage;
    fireRateCostText.textContent = costs.fireRate;
    maxHpCostText.textContent = costs.maxHp;
    critCostText.textContent = costs.crit;

    smallPotionCostText.textContent = costs.smallPotion;
    mediumPotionCostText.textContent = costs.mediumPotion;
    largePotionCostText.textContent = costs.largePotion;
    if (shieldPotionCostText) shieldPotionCostText.textContent = costs.shieldPotion;
    if (attackSpeedPotionCostText) attackSpeedPotionCostText.textContent = costs.attackSpeedPotion;
    if (doubleShotPotionCostText) doubleShotPotionCostText.textContent = costs.doubleShotPotion;
    if (lifeStealPotionCostText) lifeStealPotionCostText.textContent = costs.lifeStealPotion;
    repairBarricadeCostText.textContent = costs.repairBarricade;
    upgradeBarricadeCostText.textContent = costs.upgradeBarricade;
    if (regenBarricadeCostText) regenBarricadeCostText.textContent = costs.regenBarricade;
    if (explosiveBarricadeCostText) explosiveBarricadeCostText.textContent = costs.explosiveBarricade;
    if (thornsBarricadeCostText) thornsBarricadeCostText.textContent = costs.thornsBarricade;

    const activeBarricades = getActiveBarricades().length;
    barricadeTierText.textContent = activeBarricades ? `${activeBarricades}/2 activas` : "Sin barricadas";

    towerDefinitions.forEach((def, index) => {
        const el = document.getElementById(`tower${index + 1}CostText`);
        if (el) el.textContent = costs[def.key] ?? def.cost;
    });

    bombCostText.textContent = abilities.bomb.cost;
    freezeCostText.textContent = abilities.freeze.cost;
    tsunamiCostText.textContent = abilities.tsunami.cost;
    lightningCostText.textContent = abilities.lightning.cost;
    meteorCostText.textContent = abilities.meteor.cost;
    if (eclipseCostText) eclipseCostText.textContent = abilities.eclipse.cost;

    updateTowerShopVisibility();
    updateAbilityShopVisibility();
    updateAbilityBar();
    updateBossBar();
    updateControlsUI();
}

function updateTowerShopVisibility() {
    const full = towers.length >= MAX_TOWERS;
    if (towerLimitText) towerLimitText.textContent = `${towers.length}/${MAX_TOWERS}`;

    towerDefinitions.forEach((def, index) => {
        const btn = document.getElementById(`buyTower${index + 1}Btn`);
        if (btn) btn.disabled = !!pendingTowerPurchase || full || coins < (costs[def.key] ?? def.cost);
    });

    if (repeatWaveBtn) {
        const repeats = getRepeatCountForCurrentWave();
        repeatWaveBtn.disabled = repeats >= REPEAT_LIMIT_PER_WAVE || autoRepeatWaveMode;
        repeatWaveBtn.textContent = repeats >= REPEAT_LIMIT_PER_WAVE
            ? "Repetir oleada: límite alcanzado"
            : `Repetir oleada (${repeats}/${REPEAT_LIMIT_PER_WAVE}) · 50% oro`;
    }

    if (autoRepeatWaveBtn) {
        const repeats = getRepeatCountForCurrentWave();
        autoRepeatWaveBtn.disabled = repeats >= REPEAT_LIMIT_PER_WAVE;
        autoRepeatWaveBtn.textContent = autoRepeatWaveMode
            ? `Auto repetir ON (${repeats}/${REPEAT_LIMIT_PER_WAVE})`
            : `Auto repetir OFF (${repeats}/${REPEAT_LIMIT_PER_WAVE})`;
        autoRepeatWaveBtn.classList.toggle("autoActive", autoRepeatWaveMode);
    }

    renderTowerSlotsPanel();
}

function renderTowerSlotsPanel() {
    if (!towerSlotsPanel) return;

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
                <small>Nivel ${tower.level} · Pos: ${Math.round(tower.x)},${Math.round(tower.y)} · Gastado: ${Math.round(tower.spent || 0)} · Venta: ${refund}</small>${buffText}<br>
                <button data-tower-action="upgrade" data-index="${index}">Mejorar (${tower.upgradeCost})</button>
                <button data-tower-action="sell" data-index="${index}" class="dangerMiniButton">Vender (${refund})</button>
            </div>`;
    }).join("");
}

function updateAbilityShopVisibility() {
    buyBombBtn.disabled = abilities.bomb.owned;
    buyFreezeBtn.disabled = abilities.freeze.owned;
    buyTsunamiBtn.disabled = abilities.tsunami.owned;
    buyLightningBtn.disabled = abilities.lightning.owned;
    buyMeteorBtn.disabled = abilities.meteor.owned;
    if (buyEclipseBtn) buyEclipseBtn.disabled = abilities.eclipse.owned;

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

function draw() {
    resizeCanvasForDisplay();
    ctx.clearRect(0, 0, GAME_WIDTH, GAME_HEIGHT);

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

    if (command === "greedisgood") {
        coins = 999999;
        appendConsoleLog("Easter egg activado: 999.999 monedas agregadas.");
        updateHud();
        return;
    }

    if (command === "canttouchme") {
        player.immortal = true;
        player.hp = player.maxHp;
        appendConsoleLog("Easter egg activado: modo inmortal ON.");
        showCenterMessage("MODO INMORTAL", 1000);
        updateHud();
        return;
    }

    if (command === "beginner") {
        coins += 500;
        appendConsoleLog("Comando activado: +500 monedas.");
        updateHud();
        return;
    }

    if (command === "add" || command.startsWith("add ")) {
        const parts = command.split(/\s+/);

        if (!parts[1]) {
            appendConsoleLog("Uso correcto: add 5000. Máximo: 100.000.000 monedas.");
            return;
        }

        const rawAmount = parts.slice(1).join("").replace(/[.,]/g, "");
        const amount = Math.floor(Number(rawAmount));

        if (!Number.isFinite(amount) || amount <= 0) {
            appendConsoleLog("Uso correcto: add 5000. La cantidad debe ser un número mayor a 0.");
            return;
        }

        const cappedAmount = Math.min(amount, 100000000);
        coins = Math.min(100000000, coins + cappedAmount);

        if (amount > 100000000) {
            appendConsoleLog("Comando activado: se aplicó el máximo permitido de 100.000.000 monedas.");
        } else {
            appendConsoleLog(`Comando activado: +${cappedAmount.toLocaleString("es-AR")} monedas.`);
        }

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

    appendConsoleLog(`Comando desconocido: ${command}`);
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

function updateMousePosition(event) {
    const rect = canvas.getBoundingClientRect();

    const scaleX = GAME_WIDTH / rect.width;
    const scaleY = GAME_HEIGHT / rect.height;

    mousePosition.x = (event.clientX - rect.left) * scaleX;
    mousePosition.y = (event.clientY - rect.top) * scaleY;
}

canvas.addEventListener("mousemove", event => {
    updateMousePosition(event);
});

canvas.addEventListener("mousedown", event => {
    updateMousePosition(event);

    if (pendingTowerPurchase) {
        event.preventDefault();
        if (event.button === 2) {
            cancelTowerPlacement(true);
            return;
        }

        const tile = getTowerTileAt(mousePosition.x, mousePosition.y);
        finishTowerPlacement(tile);
        return;
    }

    isMouseDown = true;
});

canvas.addEventListener("contextmenu", event => {
    if (pendingTowerPurchase) {
        event.preventDefault();
        cancelTowerPlacement(true);
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

    if (event.code === "Escape") {
        if (pendingTowerPurchase) {
            cancelTowerPlacement(true);
            return;
        }

        if (isPaused) {
            resumeGame();
        } else {
            pauseGame();
        }
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

    if (event.code === "Space") {
        event.preventDefault();
        isSpaceDown = false;
    }
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

startGameBtn.addEventListener("click", startGame);

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

openShopBtn.addEventListener("click", () => {
    waveSummaryPanel.classList.add("hidden");
    shop.classList.remove("hidden");
    setShopSection("stats");
    syncMusicState();
});

newRunBtn.addEventListener("click", () => {
    createDefaultState();
    hasActiveRun = true;
    startWave();
});

upgradeDamageBtn.addEventListener("click", () => {
    if (coins >= costs.damage) {
        coins -= costs.damage;
        player.damage += 1;
        costs.damage = Math.floor(costs.damage * 1.75);
        updateHud();
    }
});

upgradeFireRateBtn.addEventListener("click", () => {
    if (coins >= costs.fireRate) {
        coins -= costs.fireRate;
        player.fireDelay = Math.max(160, player.fireDelay - 40);
        costs.fireRate = Math.floor(costs.fireRate * 1.8);
        updateHud();
    }
});

upgradeMaxHpBtn.addEventListener("click", () => {
    if (coins >= costs.maxHp) {
        coins -= costs.maxHp;
        player.maxHp += 5;
        player.hp += 5;
        costs.maxHp = Math.floor(costs.maxHp * 1.7);
        updateHud();
    }
});

upgradeCritBtn.addEventListener("click", () => {
    if (coins >= costs.crit) {
        coins -= costs.crit;
        player.critChance = Math.min(0.6, player.critChance + 0.05);
        costs.crit = Math.floor(costs.crit * 1.85);
        updateHud();
    }
});

buySmallPotionBtn.addEventListener("click", () => {
    if (coins >= costs.smallPotion) {
        coins -= costs.smallPotion;
        healOverTime(6, 2500);
        costs.smallPotion = Math.floor(costs.smallPotion * 1.15);
        updateHud();
    }
});

buyMediumPotionBtn.addEventListener("click", () => {
    if (coins >= costs.mediumPotion) {
        coins -= costs.mediumPotion;
        healOverTime(14, 3500);
        costs.mediumPotion = Math.floor(costs.mediumPotion * 1.18);
        updateHud();
    }
});

buyLargePotionBtn.addEventListener("click", () => {
    if (coins >= costs.largePotion) {
        coins -= costs.largePotion;
        healOverTime(30, 5000);
        costs.largePotion = Math.floor(costs.largePotion * 1.22);
        updateHud();
    }
});

buyShieldPotionBtn?.addEventListener("click", () => {
    if (coins < costs.shieldPotion) return;
    coins -= costs.shieldPotion;
    player.shieldCharges += 1;
    costs.shieldPotion = Math.floor(costs.shieldPotion * 1.18);
    showCenterMessage("¡Escudo listo!", 700);
    updateHud();
});

buyAttackSpeedPotionBtn?.addEventListener("click", () => {
    if (coins < costs.attackSpeedPotion) return;
    coins -= costs.attackSpeedPotion;
    player.attackSpeedUntil = getGameTime() + 10000;
    costs.attackSpeedPotion = Math.floor(costs.attackSpeedPotion * 1.2);
    showCenterMessage("¡Rapidez!", 700);
    updateHud();
});

buyDoubleShotPotionBtn?.addEventListener("click", () => {
    if (coins < costs.doubleShotPotion) return;
    coins -= costs.doubleShotPotion;
    player.doubleShotUntil = getGameTime() + 9000;
    costs.doubleShotPotion = Math.floor(costs.doubleShotPotion * 1.18);
    showCenterMessage("¡Doble disparo!", 800);
    updateHud();
});

buyLifeStealPotionBtn?.addEventListener("click", () => {
    if (coins < costs.lifeStealPotion) return;
    coins -= costs.lifeStealPotion;
    player.lifeStealPercent = 0.22;
    player.lifeStealUntil = getGameTime() + 10000;
    costs.lifeStealPotion = Math.floor(costs.lifeStealPotion * 1.18);
    showCenterMessage("¡Vampirismo!", 800);
    updateHud();
});

repairBarricadeBtn.addEventListener("click", () => {
    const damaged = (barricades || []).filter(b => b.active && b.maxHp > 0 && b.hp < b.maxHp).sort((a, b) => (a.hp / a.maxHp) - (b.hp / b.maxHp))[0];
    if (!damaged || coins < costs.repairBarricade) return;

    coins -= costs.repairBarricade;
    damaged.hp = Math.min(damaged.maxHp, damaged.hp + Math.ceil(damaged.maxHp * 0.45));
    costs.repairBarricade = Math.floor(costs.repairBarricade * 1.25);
    updateHud();
});

upgradeBarricadeBtn.addEventListener("click", () => buyOrUpgradeBarricade("standard"));
buyRegenBarricadeBtn?.addEventListener("click", () => buyOrUpgradeBarricade("regen"));
buyExplosiveBarricadeBtn?.addEventListener("click", () => buyOrUpgradeBarricade("explosive"));
buyThornsBarricadeBtn?.addEventListener("click", () => buyOrUpgradeBarricade("thorns"));

function buyOrUpgradeBarricade(kind = "standard") {
    const costKey = kind === "regen" ? "regenBarricade" : kind === "explosive" ? "explosiveBarricade" : kind === "thorns" ? "thornsBarricade" : "upgradeBarricade";
    if (coins < costs[costKey]) return;

    const target = (barricades || []).find(b => !b.active || b.hp <= 0) || (barricades || []).sort((a, b) => a.maxHp - b.maxHp)[0];
    if (!target) return;

    coins -= costs[costKey];

    target.kind = kind;
    target.active = true;
    target.tier = Math.min((target.tier || -1) + 1, barricadeTiers.length - 1);

    let baseHp = kind === "regen" ? 38 : kind === "explosive" ? 45 : kind === "thorns" ? 34 : 55;
    const tier = barricadeTiers[Math.max(0, target.tier)];
    target.color = kind === "regen" ? "#8a5cff" : kind === "explosive" ? "#d9792b" : kind === "thorns" ? "#9c6b35" : tier.color;
    target.maxHp = baseHp + target.tier * (kind === "standard" ? 28 : 18);
    target.hp = target.maxHp;
    target.regenPerSecond = kind === "regen" ? 1.15 + target.tier * 0.25 : 0;
    target.explosive = kind === "explosive";
    target.thorns = kind === "thorns";
    target.lastRegenTime = getGameTime();

    costs[costKey] = Math.floor(costs[costKey] * (kind === "standard" ? 1.75 : 1.55));
    updateHud();
}

towerDefinitions.forEach((def, index) => {
    const btn = document.getElementById(`buyTower${index + 1}Btn`);
    btn?.addEventListener("click", () => buyTower(def.key));
});

towerSlotsPanel?.addEventListener("click", event => {
    const button = event.target.closest("button[data-tower-action]");
    if (!button) return;
    const index = Number(button.dataset.index);
    const action = button.dataset.towerAction;
    if (action === "upgrade") upgradeTower(index);
    if (action === "sell") sellTower(index);
});

function buyTower(defKey) {
    beginTowerPlacement(defKey);
}

function upgradeTower(index) {
    const tower = towers[index];
    if (!tower || coins < tower.upgradeCost) return;

    coins -= tower.upgradeCost;
    tower.spent += tower.upgradeCost;
    tower.level += 1;

    if (tower.type === "basic") {
        tower.damage += 1;
        tower.range += 10;
        tower.fireDelay = Math.max(300, tower.fireDelay - 50);
    }

    if (tower.type === "rapid") {
        tower.damage += 0.35;
        tower.range += 8;
        tower.fireDelay = Math.max(190, tower.fireDelay - 24);
    }

    if (tower.type === "pierce") {
        tower.damage += 1.5;
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
        tower.damage += 1;
        tower.range += 10;
        tower.fireDelay = Math.max(390, tower.fireDelay - 55);
    }

    if (tower.type === "ballista") {
        tower.damage += 5;
        tower.range += 16;
        tower.fireDelay = Math.max(1450, tower.fireDelay - 150);
    }

    if (tower.type === "poison") {
        tower.damage += 2.2;
        tower.range += 12;
        tower.areaRadius += 5;
        tower.poisonDuration += 350;
        tower.fireDelay = Math.max(1450, tower.fireDelay - 105);
    }

    if (tower.type === "siphon") {
        tower.drainAmount += 1.6;
        tower.range += 10;
        tower.fireDelay = Math.max(520, tower.fireDelay - 45);
    }

    if (tower.type === "buffer") {
        tower.range += 18;
        tower.buffDamage += 0.04;
        tower.buffSpeed += 0.025;
    }

    tower.upgradeCost = Math.floor(tower.upgradeCost * 1.62);
    updateHud();
}

function sellTower(index) {
    const tower = towers[index];
    if (!tower) return;
    const refund = Math.floor((tower.spent || 0) * TOWER_SELL_REFUND);
    coins += refund;
    towers.splice(index, 1);
    updateTowerSlotIndexes();
    updateHud();
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

    isPaused = true;
    gameRunning = false;

    pausePanel.classList.remove("hidden");
    confirmRestartBox.classList.add("hidden");

    syncMusicState();
    updateHud();
}

function resumeGame() {
    if (!gameStarted || !hasActiveRun) return;

    isPaused = false;

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
        updateHud();
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
    const repeats = getRepeatCountForCurrentWave();
    if (repeats >= REPEAT_LIMIT_PER_WAVE) {
        showCenterMessage("Límite de repeticiones", 900);
        updateHud();
        return;
    }

    repeatCountsByWave[wave] = repeats + 1;
    isRepeatingWave = true;
    currentGoldMultiplier = 0.5;
    startWave();
});

if (autoRepeatWaveBtn) autoRepeatWaveBtn.addEventListener("click", () => {
    const repeats = getRepeatCountForCurrentWave();
    if (repeats >= REPEAT_LIMIT_PER_WAVE) {
        autoRepeatWaveMode = false;
        showCenterMessage("Límite de repeticiones", 900);
        updateHud();
        return;
    }

    autoRepeatWaveMode = !autoRepeatWaveMode;
    showCenterMessage(autoRepeatWaveMode ? "Auto repetir ON" : "Auto repetir OFF", 700);
    updateHud();
});

nextWaveBtn.addEventListener("click", () => {
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

bestScoreMenuText.textContent = bestScore;
createDefaultState();
applyAudioSettingsToUI();
draw();
