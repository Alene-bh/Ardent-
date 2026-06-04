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
const BUILD_PHASE_DURATION = 120000;
const BOSS_SPAWN_ZONE = {
    x: WORLD_WIDTH / 2,
    y: WORLD_HEIGHT / 2,
    // Zona central de jefes: cuadrada, aprox. 2 barricadas por lado.
    width: BARRICADE_LENGTH * 2,
    height: BARRICADE_LENGTH * 2
};
const TRAP_COLLISION_RADIUS = 18;
const MINE_COLLISION_RADIUS = 24;
const MINE_MAX_HP = 120;
const TOWER_ROTATION_STEP = Math.PI / 2;

// Balance infinito: las oleadas deben volverse más intensas, no más largas.
// El último enemigo debería spawnear siempre dentro de esta ventana aproximada.
const MAX_WAVE_SPAWN_DURATION = 58000;
const MIN_WAVE_SPAWN_INTERVAL = 85;
const MAX_LATE_WAVE_ENEMIES = 430;
const MAX_BOSS_WAVE_ENEMIES = 300;
let buildPhaseActive = false;
let buildPhaseEndsAt = 0;
let pausedBuildPhaseRemainingMs = 0;
let buildPhaseStartingWave = false;
const CAMERA_MIN_ZOOM = 0.62;
const CAMERA_MAX_ZOOM = 1.65;
const CAMERA_ZOOM_STEP = 0.12;
let camera = {
    x: 0,
    y: 0,
    zoom: Math.max(CAMERA_MIN_ZOOM, Math.min(CAMERA_MAX_ZOOM, Number(localStorage.getItem("tdCameraZoom")) || 1))
};
let baseCore = null;
let basePlaced = false;
let pendingBasePlacement = false;
let pendingBarricadePlacement = null;
let pendingTrapPlacement = null;
let pendingMinePlacement = null;
// Ciclo de rotación de barricadas: | → / → - → \ → |.
// En canvas, diagonalUp = / y diagonalDown = \.
const BARRICADE_BUILD_ORIENTATIONS = ["vertical", "diagonalUp", "horizontal", "diagonalDown"];
let barricadeBuildOrientationIndex = 0;
let barricadeBuildOrientation = BARRICADE_BUILD_ORIENTATIONS[barricadeBuildOrientationIndex];
let towerBuildRotation = 0;
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

// Sprites del jugador: poné tus PNG en assets/sprites.
// Este pack usa sprite sheets en GRILLA de 32x32 por frame.
// Ejemplos de tus archivos:
// idle.png  64x96  -> 2 columnas x 3 filas
// walk.png  128x96 -> 4 columnas x 3 filas
// hurt.png  64x96  -> 2 columnas x 3 filas
// death.png 96x96  -> 3 columnas x 3 filas
const playerSpritePaths = {
    idle: "assets/sprites/idle.png",
    walk: "assets/sprites/walk.png",
    hurt: "assets/sprites/hurt.png",
    death: "assets/sprites/death.png"
};

const PLAYER_SPRITE_TILE_SIZE = 32;
const PLAYER_SPRITE_DRAW_SIZE = 72;
const playerSprites = {};
const tintedPlayerSpriteCache = new Map();
const playerSpriteSourceCache = new WeakMap();

function getImageSourceCanvas(img) {
    if (!img || !img.complete || !img.naturalWidth || !img.naturalHeight) return null;
    if (playerSpriteSourceCache.has(img)) return playerSpriteSourceCache.get(img);
    const source = document.createElement("canvas");
    source.width = img.naturalWidth;
    source.height = img.naturalHeight;
    const sctx = source.getContext("2d");
    sctx.imageSmoothingEnabled = false;
    sctx.drawImage(img, 0, 0);
    playerSpriteSourceCache.set(img, source);
    return source;
}

function getTintedPlayerSprite(animation, img, color) {
    if (!img || !img.complete || !img.naturalWidth || !img.naturalHeight) return img;
    const tintColor = color || "#ffffff";
    if (tintColor === "#ffffff") return img;
    const key = `${animation || "idle"}:${tintColor}:${img.naturalWidth}x${img.naturalHeight}`;
    if (tintedPlayerSpriteCache.has(key)) return tintedPlayerSpriteCache.get(key);
    const source = getImageSourceCanvas(img);
    if (!source) return img;
    const target = getCssColorRgb(tintColor);
    const canvasCopy = document.createElement("canvas");
    canvasCopy.width = source.width;
    canvasCopy.height = source.height;
    const cctx = canvasCopy.getContext("2d");
    const imageData = source.getContext("2d").getImageData(0, 0, source.width, source.height);
    const data = imageData.data;
    for (let i = 0; i < data.length; i += 4) {
        const a = data[i + 3];
        if (a <= 8) continue;
        const r = data[i];
        const g = data[i + 1];
        const b = data[i + 2];
        const brightness = (r + g + b) / 3;
        if (brightness < 28 || brightness > 235) continue;
        const shade = Math.max(0.28, Math.min(1.15, brightness / 150));
        data[i] = Math.round(target.r * shade);
        data[i + 1] = Math.round(target.g * shade);
        data[i + 2] = Math.round(target.b * shade);
    }
    cctx.putImageData(imageData, 0, 0);
    tintedPlayerSpriteCache.set(key, canvasCopy);
    return canvasCopy;
}

function loadPlayerSprites() {
    Object.entries(playerSpritePaths).forEach(([key, src]) => {
        const img = new Image();
        img.src = src;
        playerSprites[key] = img;
    });
}

function getSpriteFrameData(img) {
    if (!img || !img.complete || !img.naturalWidth || !img.naturalHeight) return null;

    const frameWidth = PLAYER_SPRITE_TILE_SIZE;
    const frameHeight = PLAYER_SPRITE_TILE_SIZE;
    const columns = Math.max(1, Math.floor(img.naturalWidth / frameWidth));
    const rows = Math.max(1, Math.floor(img.naturalHeight / frameHeight));
    const frameCount = Math.max(1, columns * rows);

    return { frameWidth, frameHeight, columns, rows, frameCount };
}

function getPlayerSpriteAnimation() {
    if (!player) return "idle";
    if (player.hp <= 0) return "death";
    if ((player.hurtUntil || 0) > getGameTime()) return "hurt";
    if (player.isMoving) return "walk";
    return "idle";
}

function getPlayerSpriteDirectionRow(rows = 1) {
    if (!player || rows <= 1) return 0;
    const lastX = Number(player.lastMoveX) || 0;
    const lastY = Number(player.lastMoveY) || 0;

    // Packs comunes 32x32: fila 0 = frente/abajo, fila 1 = costado, fila 2 = espalda/arriba.
    // Usamos la última dirección de movimiento, no la mira, para que al quedarse quieto
    // no parezca que el personaje gira solo mirando hacia todos lados.
    if (Math.abs(lastX) > Math.abs(lastY) && rows >= 2) return 1;
    if (lastY < -0.25 && rows >= 3) return 2;
    return 0;
}

function drawPlayerSprite() {
    if (!player) return false;

    const animation = getPlayerSpriteAnimation();
    let img = playerSprites[animation];
    let frameData = getSpriteFrameData(img);

    // Fallback: si falta hurt/death/walk, usa idle. Si no hay sprites, vuelve al dibujo viejo.
    if (!frameData && animation !== "idle") {
        img = playerSprites.idle;
        frameData = getSpriteFrameData(img);
    }
    if (!frameData) return false;

    const { frameWidth, frameHeight, columns, rows, frameCount } = frameData;
    const fpsByAnimation = { idle: 4, walk: 10, hurt: 9, death: 7 };
    const fps = fpsByAnimation[animation] || 8;
    let frameIndex = 0;

    if (animation === "death") {
        if (!player.deathStartedAt) player.deathStartedAt = getGameTime();
        frameIndex = Math.min(frameCount - 1, Math.floor((getGameTime() - player.deathStartedAt) / (1000 / fps)));
    } else {
        // Para idle/walk/hurt, no recorremos toda la grilla completa.
        // Elegimos UNA fila de dirección y animamos solo sus columnas.
        const row = getPlayerSpriteDirectionRow(rows);
        const frameInRow = animation === "idle"
            ? 0
            : Math.floor(getGameTime() / (1000 / fps)) % Math.max(1, columns);
        frameIndex = row * columns + frameInRow;
    }

    const sx = (frameIndex % columns) * frameWidth;
    const sy = Math.floor(frameIndex / columns) * frameHeight;
    const drawSize = PLAYER_SPRITE_DRAW_SIZE;
    const shouldFlip = (Number(player.lastMoveX) || 0) < -0.15;
    img = getTintedPlayerSprite(animation, img, player.classColor || player.color || activeClass?.color || "#ffffff");

    ctx.save();
    ctx.translate(player.x, player.y);
    if (shouldFlip) ctx.scale(-1, 1);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(
        img,
        sx,
        sy,
        frameWidth,
        frameHeight,
        -drawSize / 2,
        -drawSize / 2,
        drawSize,
        drawSize
    );
    ctx.restore();
    return true;
}

function getEntitySpriteDirectionRow(entity, rows = 1) {
    if (!entity || rows <= 1) return 0;
    const lastX = Number(entity.lastMoveX) || Number(entity.dx) || 0;
    const lastY = Number(entity.lastMoveY) || Number(entity.dy) || 0;
    if (Math.abs(lastX) > Math.abs(lastY) && rows >= 2) return 1;
    if (lastY < -0.25 && rows >= 3) return 2;
    return 0;
}

function drawHumanoidSpriteEntity(entity, options = {}) {
    if (!entity) return false;
    const animation = options.animation || (entity.hp <= 0 ? "death" : entity.isMoving ? "walk" : "idle");
    let img = playerSprites[animation] || playerSprites.idle;
    let frameData = getSpriteFrameData(img);
    if (!frameData && animation !== "idle") {
        img = playerSprites.idle;
        frameData = getSpriteFrameData(img);
    }
    if (!frameData) return false;

    const { frameWidth, frameHeight, columns, rows, frameCount } = frameData;
    const fpsByAnimation = { idle: 4, walk: 10, hurt: 9, death: 7 };
    const fps = fpsByAnimation[animation] || 8;
    let frameIndex = 0;

    if (animation === "death") {
        frameIndex = Math.min(frameCount - 1, Math.floor(getGameTime() / (1000 / fps)));
    } else {
        const row = getEntitySpriteDirectionRow(entity, rows);
        const frameInRow = animation === "idle" ? 0 : Math.floor(getGameTime() / (1000 / fps)) % Math.max(1, columns);
        frameIndex = row * columns + frameInRow;
    }

    const sx = (frameIndex % columns) * frameWidth;
    const sy = Math.floor(frameIndex / columns) * frameHeight;
    const drawSize = options.drawSize || PLAYER_SPRITE_DRAW_SIZE;
    const shouldFlip = (Number(entity.lastMoveX) || 0) < -0.15;
    img = getTintedPlayerSprite(animation, img, options.color || entity.color || "#ffffff");

    ctx.save();
    ctx.translate(entity.x, entity.y);
    if (shouldFlip) ctx.scale(-1, 1);
    ctx.imageSmoothingEnabled = false;
    if (options.shadow) {
        ctx.shadowColor = options.shadow;
        ctx.shadowBlur = options.shadowBlur || 10;
    }
    ctx.drawImage(img, sx, sy, frameWidth, frameHeight, -drawSize / 2, -drawSize / 2, drawSize, drawSize);
    ctx.restore();
    return true;
}

function drawVisitorSprite(visitor) {
    return drawHumanoidSpriteEntity(visitor, {
        animation: visitor?.isMoving ? "walk" : "idle",
        color: visitor?.visitorTint || "#20232d",
        drawSize: 72,
        shadow: "rgba(0,0,0,0.85)",
        shadowBlur: 14
    });
}


loadPlayerSprites();

// Sprite base para enemigos comunes/especiales.
// Usamos una sola spritesheet y la teñimos por código con el color original
// que ya tenía cada enemigo cuando era círculo. Bosses y Titán Negro quedan aparte.
const enemySpritePath = "assets/sprites/enemies/devil_guy_spritesheet.png";
const ENEMY_SPRITE_TILE_SIZE = 32;
const ENEMY_SPRITE_BASE_DRAW_SIZE = 54;
const enemySpriteImage = new Image();
enemySpriteImage.src = enemySpritePath;
const tintedEnemySpriteCache = new Map();
let enemySpriteSourceCanvas = null;
let enemySpriteFrameDataCache = null;

// Moneda del HUD y monedas voladoras al matar enemigos.
// Poné el gif en: assets/sprites/coin.gif
const coinSpritePath = "assets/sprites/coin.gif";
const coinImage = new Image();
coinImage.src = coinSpritePath;
let coinImageAvailable = false;
coinImage.onload = () => { coinImageAvailable = true; };
coinImage.onerror = () => { coinImageAvailable = false; };
let flyingCoins = [];

function getCssColorRgb(color) {
    const helper = getCssColorRgb.canvas || (getCssColorRgb.canvas = document.createElement("canvas"));
    helper.width = helper.height = 1;
    const hctx = helper.getContext("2d");
    hctx.clearRect(0, 0, 1, 1);
    hctx.fillStyle = "#ffffff";
    hctx.fillStyle = color || "#ffffff";
    hctx.fillRect(0, 0, 1, 1);
    const data = hctx.getImageData(0, 0, 1, 1).data;
    return { r: data[0], g: data[1], b: data[2], a: data[3] };
}

function getEnemySpriteFrameData() {
    if (enemySpriteFrameDataCache) return enemySpriteFrameDataCache;
    const img = enemySpriteImage;
    if (!img || !img.complete || !img.naturalWidth || !img.naturalHeight) return null;

    const frameWidth = ENEMY_SPRITE_TILE_SIZE;
    const frameHeight = ENEMY_SPRITE_TILE_SIZE;
    const columns = Math.max(1, Math.floor(img.naturalWidth / frameWidth));
    const rows = Math.max(1, Math.floor(img.naturalHeight / frameHeight));
    const frameCount = columns * rows;
    const validFrames = [];
    const frameBounds = {};

    // Algunas sheets tienen celdas vacías. Las detectamos para que el enemigo
    // no "desaparezca" durante un frame de animación.
    // Además calculamos el recorte real de píxeles visibles: la sheet tiene mucho
    // padding transparente, y si dibujamos el tile completo el bicho se ve más
    // chico que su hitbox. Con este recorte, el sprite se escala acorde al radio real.
    const source = getEnemySpriteSourceCanvas();
    if (source) {
        const sctx = source.getContext("2d");
        for (let index = 0; index < frameCount; index++) {
            const sx = (index % columns) * frameWidth;
            const sy = Math.floor(index / columns) * frameHeight;
            const data = sctx.getImageData(sx, sy, frameWidth, frameHeight).data;
            let opaquePixels = 0;
            let minX = frameWidth;
            let minY = frameHeight;
            let maxX = -1;
            let maxY = -1;

            for (let py = 0; py < frameHeight; py++) {
                for (let px = 0; px < frameWidth; px++) {
                    const alpha = data[(py * frameWidth + px) * 4 + 3];
                    if (alpha > 16) {
                        opaquePixels++;
                        minX = Math.min(minX, px);
                        minY = Math.min(minY, py);
                        maxX = Math.max(maxX, px);
                        maxY = Math.max(maxY, py);
                    }
                }
            }

            if (opaquePixels > 10) {
                validFrames.push(index);
                frameBounds[index] = {
                    x: minX,
                    y: minY,
                    width: Math.max(1, maxX - minX + 1),
                    height: Math.max(1, maxY - minY + 1)
                };
            }
        }
    }

    if (!validFrames.length) {
        for (let i = 0; i < frameCount; i++) {
            validFrames.push(i);
            frameBounds[i] = { x: 0, y: 0, width: frameWidth, height: frameHeight };
        }
    }

    enemySpriteFrameDataCache = { frameWidth, frameHeight, columns, rows, frameCount, validFrames, frameBounds };
    return enemySpriteFrameDataCache;
}
function getEnemySpriteSourceCanvas() {
    if (enemySpriteSourceCanvas) return enemySpriteSourceCanvas;
    if (!enemySpriteImage.complete || !enemySpriteImage.naturalWidth) return null;
    const source = document.createElement("canvas");
    source.width = enemySpriteImage.naturalWidth;
    source.height = enemySpriteImage.naturalHeight;
    const sctx = source.getContext("2d");
    sctx.imageSmoothingEnabled = false;
    sctx.drawImage(enemySpriteImage, 0, 0);
    enemySpriteSourceCanvas = source;
    return source;
}

function getTintedEnemySprite(color) {
    const key = String(color || "#ffffff");
    if (tintedEnemySpriteCache.has(key)) return tintedEnemySpriteCache.get(key);

    const source = getEnemySpriteSourceCanvas();
    if (!source) return null;

    const target = getCssColorRgb(key);
    const canvasCopy = document.createElement("canvas");
    canvasCopy.width = source.width;
    canvasCopy.height = source.height;
    const cctx = canvasCopy.getContext("2d");
    const imageData = source.getContext("2d").getImageData(0, 0, source.width, source.height);
    const data = imageData.data;

    for (let i = 0; i < data.length; i += 4) {
        const a = data[i + 3];
        if (a <= 8) continue;
        const r = data[i];
        const g = data[i + 1];
        const b = data[i + 2];
        const brightness = (r + g + b) / 3;
        const looksLikeBody = r > 35 && r > g * 1.18 && r > b * 1.18;

        // Conservamos ojos/sombras negras del sprite base. Solo cambiamos la piel roja.
        if (looksLikeBody || brightness > 70) {
            const shade = Math.max(0.35, Math.min(1, r / 215));
            data[i] = Math.round(target.r * shade);
            data[i + 1] = Math.round(target.g * shade);
            data[i + 2] = Math.round(target.b * shade);
        }
    }

    cctx.putImageData(imageData, 0, 0);
    tintedEnemySpriteCache.set(key, canvasCopy);
    return canvasCopy;
}

function drawEnemySprite(enemy, drawRadius) {
    if (!enemy || enemy.isBoss || enemy.special === "doombringer") return false;
    const frameData = getEnemySpriteFrameData();
    if (!frameData) return false;

    const sprite = enemy.hitFlash > 0 ? getTintedEnemySprite("#ffffff") : getTintedEnemySprite(enemy.color);
    if (!sprite) return false;

    const { frameWidth, frameHeight, columns, validFrames, frameBounds } = frameData;
    const usableFrames = validFrames && validFrames.length ? validFrames : [0];
    const fps = enemy.isMini ? 7 : 8;
    const animIndex = Math.floor((getGameTime() * fps / 1000) + ((enemy.id || 0) % usableFrames.length)) % usableFrames.length;
    const frameIndex = usableFrames[animIndex];
    const frameBaseX = (frameIndex % columns) * frameWidth;
    const frameBaseY = Math.floor(frameIndex / columns) * frameHeight;
    const bounds = frameBounds?.[frameIndex] || { x: 0, y: 0, width: frameWidth, height: frameHeight };
    const sx = frameBaseX + bounds.x;
    const sy = frameBaseY + bounds.y;
    const sw = bounds.width;
    const sh = bounds.height;

    // El sprite base tiene padding transparente, por eso dibujamos solo la silueta real.
    // Ojo: la silueta recortada se ve MUCHO más grande que un tile completo con aire,
    // así que el tamaño visual debe ser bajo para quedar parecido al jugador.
    // Los minions invocados por summoner quedan todavía más chicos para que no tapen todo.
    const hitboxRadius = drawRadius || enemy.radius || 18;
    const normalScale = Math.max(0.78, Math.min(1.05, hitboxRadius / 18));
    const drawHeight = enemy.isMini ? 16 : 24 * normalScale;
    const drawWidth = drawHeight * (sw / Math.max(1, sh));

    const targetX = enemy.targetX ?? player?.x ?? enemy.x + 1;
    const shouldFlip = targetX < enemy.x;

    ctx.save();
    ctx.translate(enemy.x, enemy.y);
    if (shouldFlip) ctx.scale(-1, 1);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(sprite, sx, sy, sw, sh, -drawWidth / 2, -drawHeight / 2, drawWidth, drawHeight);
    ctx.restore();
    return true;
}


function getCoinHudTargetPoint() {
    const stage = document.getElementById("playStage");
    const coinBox = document.getElementById("coinsHudBox") || coinsText;
    if (!stage || !coinBox) return { x: GAME_WIDTH - 120, y: 24 };

    const stageRect = stage.getBoundingClientRect();
    const coinRect = coinBox.getBoundingClientRect();
    if (!stageRect.width || !stageRect.height) return { x: GAME_WIDTH - 120, y: 24 };

    return {
        x: ((coinRect.left + coinRect.width / 2 - stageRect.left) / stageRect.width) * GAME_WIDTH,
        y: ((coinRect.top + coinRect.height / 2 - stageRect.top) / stageRect.height) * GAME_HEIGHT
    };
}

function spawnFlyingCoin(worldX, worldY, amount = 0) {
    if (!Number.isFinite(worldX) || !Number.isFinite(worldY)) return;
    const screenPoint = getWorldToScreenPoint(worldX, worldY);
    flyingCoins.push({
        x: screenPoint.x,
        y: screenPoint.y,
        startX: screenPoint.x,
        startY: screenPoint.y,
        amount,
        age: 0,
        duration: 42,
        wobble: Math.random() * Math.PI * 2
    });

    if (flyingCoins.length > 60) flyingCoins.splice(0, flyingCoins.length - 60);
}

function updateFlyingCoins() {
    if (!flyingCoins.length) return;
    const target = getCoinHudTargetPoint();
    for (let i = flyingCoins.length - 1; i >= 0; i--) {
        const coin = flyingCoins[i];
        coin.age += frameScale;
        const t = Math.max(0, Math.min(1, coin.age / coin.duration));
        const eased = 1 - Math.pow(1 - t, 3);
        const arc = Math.sin(t * Math.PI) * 42;
        coin.x = coin.startX + (target.x - coin.startX) * eased + Math.sin(coin.wobble + t * 8) * 7 * (1 - t);
        coin.y = coin.startY + (target.y - coin.startY) * eased - arc;
        if (t >= 1) flyingCoins.splice(i, 1);
    }
}

function drawCoinIcon(x, y, size = 18) {
    ctx.save();
    if (coinImageAvailable && coinImage.complete && coinImage.naturalWidth) {
        ctx.imageSmoothingEnabled = false;
        ctx.drawImage(coinImage, x - size / 2, y - size / 2, size, size);
    } else {
        ctx.fillStyle = "#ffd84a";
        ctx.beginPath();
        ctx.arc(x, y, size / 2, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = "#a86600";
        ctx.lineWidth = 2;
        ctx.stroke();
        ctx.fillStyle = "#7a4700";
        ctx.font = `bold ${Math.max(10, size * 0.58)}px Arial`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText("$", x, y + 1);
    }
    ctx.restore();
}

function drawFlyingCoins() {
    if (!flyingCoins.length) return;
    flyingCoins.forEach(coin => {
        const t = Math.max(0, Math.min(1, coin.age / coin.duration));
        const size = 14 + Math.sin(t * Math.PI) * 5;
        ctx.globalAlpha = Math.max(0, Math.min(1, 1 - Math.max(0, t - 0.86) / 0.14));
        drawCoinIcon(coin.x, coin.y, size);
        ctx.globalAlpha = 1;
    });
}

let soundEnabled = false;

let audioSettings = {
    musicEnabled: localStorage.getItem("tdMusicEnabled") !== "false",
    sfxEnabled: localStorage.getItem("tdSfxEnabled") !== "false",
    musicVolume: Number(localStorage.getItem("tdMusicVolume")) || 0.28,
    sfxVolume: Number(localStorage.getItem("tdSfxVolume")) || 0.28
};

let visualSettings = {
    minimapScale: Math.max(0.65, Math.min(1.35, Number(localStorage.getItem("tdMinimapScale")) || 0.82))
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
    eclipse: "Digit6",
    blink: "KeyE"
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
    return ["bomb", "freeze", "tsunami", "lightning", "meteor", "eclipse", "blink"].find(id => controlBindings[id] === code) || null;
}

function isControlCode(code) {
    return Object.values(controlBindings).includes(code);
}

function applyControlsToAbilities() {
    if (!abilities) return;

    ["bomb", "freeze", "tsunami", "lightning", "meteor", "eclipse", "blink"].forEach(id => {
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
        eclipse: document.getElementById("eclipseKeyText"),
        blink: document.getElementById("blinkKeyText")
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


function saveVisualSettings() {
    localStorage.setItem("tdMinimapScale", visualSettings.minimapScale);
}

function formatMinimapScaleLabel(value = visualSettings.minimapScale) {
    return `${Math.round(Number(value) * 100)}%`;
}

function applyVisualSettingsToUI() {
    const value = String(visualSettings.minimapScale);
    if (menuMinimapSize) menuMinimapSize.value = value;
    if (pauseMinimapSize) pauseMinimapSize.value = value;
    if (menuMinimapSizeText) menuMinimapSizeText.textContent = formatMinimapScaleLabel();
    if (pauseMinimapSizeText) pauseMinimapSizeText.textContent = formatMinimapScaleLabel();
}

function updateMinimapScale(value) {
    const next = Math.max(0.65, Math.min(1.35, Number(value) || 0.82));
    visualSettings.minimapScale = next;
    saveVisualSettings();
    applyVisualSettingsToUI();
}

function getBottomUiGameHeight() {
    const bottomUi = document.getElementById("bottomGameUi");
    const stage = document.getElementById("playStage");
    if (!bottomUi || !stage || bottomUi.classList.contains("hidden")) return 76;
    const stageRect = stage.getBoundingClientRect();
    const uiRect = bottomUi.getBoundingClientRect();
    if (!stageRect.height || !uiRect.height) return 76;
    return Math.max(58, Math.min(135, (uiRect.height / stageRect.height) * GAME_HEIGHT));
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
    eclipse: document.getElementById("abilityEclipseSlot"),
    blink: document.getElementById("abilityBlinkSlot")
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
const skipBuildPhaseBtn = document.getElementById("skipBuildPhaseBtn");
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
const copyRunSummaryBtn = document.getElementById("copyRunSummaryBtn");
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
const buyDoorBarricadeBtn = document.getElementById("buyDoorBarricadeBtn");
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
const buyTower11Btn = document.getElementById("buyTower11Btn");
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
const buyBlinkBtn = document.getElementById("buyBlinkBtn");

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
const doorBarricadeCostText = document.getElementById("doorBarricadeCostText");
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
const tower11CostText = document.getElementById("tower11CostText");
const tower12CostText = document.getElementById("tower12CostText");
const tower13CostText = document.getElementById("tower13CostText");
const trapSnareCostText = document.getElementById("trapSnareCostText");
const trapBleedCostText = document.getElementById("trapBleedCostText");
const mineGoldCostText = document.getElementById("mineGoldCostText");
const mineLimitText = document.getElementById("mineLimitText");
const buyTrapSnareBtn = document.getElementById("buyTrapSnareBtn");
const buyTrapBleedBtn = document.getElementById("buyTrapBleedBtn");
const buyMineGoldBtn = document.getElementById("buyMineGoldBtn");

const bombCostText = document.getElementById("bombCostText");
const freezeCostText = document.getElementById("freezeCostText");
const tsunamiCostText = document.getElementById("tsunamiCostText");
const lightningCostText = document.getElementById("lightningCostText");
const meteorCostText = document.getElementById("meteorCostText");
const eclipseCostText = document.getElementById("eclipseCostText");
const blinkCostText = document.getElementById("blinkCostText");

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

const menuMinimapSize = document.getElementById("menuMinimapSize");
const menuMinimapSizeText = document.getElementById("menuMinimapSizeText");
const pauseMinimapSize = document.getElementById("pauseMinimapSize");
const pauseMinimapSizeText = document.getElementById("pauseMinimapSizeText");

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

const classSelectionPanel = document.getElementById("classSelectionPanel");
const classCardsBox = document.getElementById("classCardsBox");
const selectedClassInfo = document.getElementById("selectedClassInfo");
const relicChoicePanel = document.getElementById("relicChoicePanel");
const relicChoiceOptions = document.getElementById("relicChoiceOptions");
const relicChoiceTitle = document.getElementById("relicChoiceTitle");
const relicChoiceHint = document.getElementById("relicChoiceHint");
const sideMissionBox = document.getElementById("sideMissionBox");
const sideMissionTitle = document.getElementById("sideMissionTitle");
const sideMissionDesc = document.getElementById("sideMissionDesc");
const sideMissionProgress = document.getElementById("sideMissionProgress");


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

const SAVE_KEY = "ardentTowerDefenseSavedRunV4";
const SAVE_VERSION = 4;
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
let beginnerCommandUsed = false;
let lastDeathCause = "desconocido";
let selectedClassKey = localStorage.getItem("ardentSelectedClass") || "errante";
let activeClass = null;
let activeRelics = [];
let relicFamilyWeights = { constructor: 1, sangre: 1, codicia: 1, arcana: 1, neutral: 1 };
let pendingRelicChoice = null;
let activeWaveEvent = null;
let lastWaveEventWave = -999;
let activeSideMission = null;
let runStats = null;
let totalRunTimeMs = 0;
let waveStartedAt = 0;
let bossPressureSpawned = 0;
let bossPressureLastSpawnAt = 0;
let bossSpawnedThisWave = false;
let visitorSpawnedThisWave = false;
let lastVisitorWave = -999;
let lastVisitorDeathWave = -999;
let visitorAlertUntil = 0;


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
let traps;
let mines;
let titanShards;
let pendingTitanReward = null;
let inventory;
let inventoryCooldownUntil;

let enemiesToSpawn;
let enemiesSpawned;
let spawnInterval;
let lastSpawnTime;

let redFlashAlpha = 0;
let lastHitSfxAt = -Infinity;

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
    { name: "Obsidiana", color: "#302038", hpBonus: 120 },
    { name: "Aetherita", color: "#7c5cff", hpBonus: 168, architectOnly: true, particleColor: "#bfa7ff" }
];

const INITIAL_TOWER_LIMIT = 12;
const MAX_TOWER_LIMIT = 20;
const FIRST_TOWER_SLOT_COST = 850;
const TOWER_SLOT_COST_MULTIPLIER = 1.58;
const TOWER_SELL_REFUND = 0.7;
const REPEAT_LIMIT_PER_WAVE = 3;
// Repetir oleada: desafío leve y recompensa reducida, sin acumulación por repetición.
const REPEAT_ENEMY_STRENGTH_MULTIPLIER = 1.2;
const REPEAT_GOLD_MULTIPLIER = 0.6;
const BOSS_BARRICADE_DAMAGE_MULTIPLIER = 0.85;
const PLAYER_WALK_SPEED_MULTIPLIER = 0.82;
const PLAYER_SPRINT_SPEED_MULTIPLIER = 1.65;
const PLAYER_STAMINA_MAX = 100;
const PLAYER_STAMINA_DRAIN_PER_SECOND = 34;
const PLAYER_STAMINA_REGEN_PER_SECOND = 24;
const PLAYER_STAMINA_MIN_TO_SPRINT = 8;
const BLINK_DISTANCE = 138;
// Control anti-lag: cada summoner puede sostener como máximo
// 2 tandas activas de 3 bichitos invocados.
const SUMMONER_BATCH_SIZE = 3;
const SUMMONER_MAX_ACTIVE_BATCHES = 2;
const SUMMONER_MAX_ACTIVE_MINIONS = SUMMONER_BATCH_SIZE * SUMMONER_MAX_ACTIVE_BATCHES;
let repeatCountsByWave = {};
let isRepeatingWave = false;
let currentGoldMultiplier = 1;
const PLAYER_ECONOMY_GOLD_MULTIPLIER = 1.15; // Hotfix 1.0.4.7: más oro para que las builds puedan crecer.
let doomSpawnedThisWave = false;
let lastDoomWave = -999;
let titanRewardedWaves = {};

const TOWER_TILE_SIZE = 50;
const TOWER_TILE_HALF = TOWER_TILE_SIZE / 2;

const INVENTORY_SLOT_COUNT = 5;
const INVENTORY_STACK_SIZE = 5;
const INVENTORY_GLOBAL_COOLDOWN = 5000;

const CLASS_DEFINITIONS = {
    cazador: {
        name: "Cazador", color: "#ff6b5f", short: "Vive de perseguir al peligro.",
        lore: "El Cazador no espera detrás de los muros: sale a buscar a la horda antes de que la horda llegue a casa.",
        grants: "Pega más fuerte, dispara más rápido y mejora daño/crítico con más facilidad.",
        drawback: "Confía menos en las máquinas: las torres le salen un poco más caras.",
        apply() { player.damage *= 1.4; player.fireDelay *= 0.85; player.classCostMultipliers.damage = 0.8; player.classCostMultipliers.crit = 0.8; player.classCostMultipliers.towers = 1.1; }
    },
    ingeniero: {
        name: "Ingeniero", color: "#73ff9f", short: "Convierte chatarra en defensa.",
        lore: "El Ingeniero mira un campo vacío y ya ve líneas de fuego, engranajes y una fortaleza naciendo entre el humo.",
        grants: "Sus torres son más accesibles y golpean mejor. Empieza con una torre rápida gratis.",
        drawback: "Como peleador directo es menos feroz.",
        apply() { player.damage *= 0.9; player.classCostMultipliers.towers = 0.8; player.towerDamageMultiplier = 1.1; grantFreeTower("tower2", 1); }
    },
    alquimista: {
        name: "Alquimista", color: "#ff8bd1", short: "Sobrevive a base de frascos imposibles.",
        lore: "El Alquimista nunca entra limpio a una batalla: lleva bolsillos llenos de mezclas raras, humo dulce y soluciones de último segundo.",
        grants: "Sus consumibles rinden mucho más, tiene más espacio y empieza con una poción chica y una de doble disparo.",
        drawback: "Su daño directo arranca más bajo.",
        apply() { player.damage *= 0.9; player.consumablePowerMultiplier = 1.75; player.extraInventorySlots = 5; inventory = createEmptyInventory(); addConsumableToInventory("doubleShotPotion"); addConsumableToInventory("smallPotion"); }
    },
    arquitecto: {
        name: "Arquitecto", color: "#a987ff", short: "Levanta murallas donde otros ven ruinas.",
        lore: "El Arquitecto no corre del asedio: lo dibuja, lo mide y lo encierra dentro de una fortaleza cada vez más absurda.",
        grants: "Sus barricadas resisten más, empieza con tres barricadas gratis y puede llegar a un tier superior.",
        drawback: "Mejorar su daño personal le cuesta más.",
        apply() { player.classCostMultipliers.damage = 1.1; player.barricadeHpMultiplier = 1.25; player.unlockDeepObsidian = true; grantFreeBarricades(3); }
    },
    mago: {
        name: "Mago", color: "#9be7ff", short: "Le pide favores peligrosos al Abismo.",
        lore: "El Mago no construye una defensa: abre grietas, prende el aire y convierte una oleada en un accidente arcano.",
        grants: "Empieza con Bomba. Sus habilidades son más fuertes, más baratas y vuelven antes.",
        drawback: "Tiene menos vida máxima.",
        apply() { player.maxHp = Math.max(1, Math.floor(player.maxHp * 0.75)); player.hp = player.maxHp; player.abilityPowerMultiplier = 1.25; player.abilityCooldownMultiplier = 0.85; player.classCostMultipliers.abilities = 0.85; if (abilities.bomb) abilities.bomb.owned = true; }
    },
    novato: {
        name: "Novato", color: "#ffe28a", short: "La puerta amable al infierno.",
        lore: "El Novato todavía no sabe cuánto odia el Abismo a los confiados. Por suerte, el mundo le da una mano.",
        grants: "Gana más oro y los enemigos arrancan más suaves.",
        drawback: "Su puntaje queda marcado como modo Novato y no compite igual en récords.",
        apply() { player.goldBonusMultiplier *= 1.2; player.enemyHpMultiplier = 0.85; player.scoreMultiplier = 0.65; runDisqualifiedFromLeaderboard = true; leaderboardDisqualificationReason = "Clase Novato"; }
    },
    minero: {
        name: "Minero", color: "#d8a447", short: "Escarba oro donde otros ven muerte.",
        lore: "El Minero no llegó a Ardent para rezar por una defensa: llegó con pico, codicia medida y una fe rara en que hasta el Abismo tiene vetas.",
        grants: "Empieza con oro extra, una mina gratis y hace rendir mejor su economía minera.",
        drawback: "Su daño personal arranca más bajo y las torres ofensivas le cuestan un poco más.",
        apply() {
            coins += 150;
            player.damage *= 0.9;
            player.classCostMultipliers.towers = 1.08;
            player.classCostMultipliers.mines = 0.85;
            player.mineIncomeMultiplier *= 1.1;
            grantFreeMine(1);
        }
    },
    errante: {
        name: "Errante", color: "#ffffff", short: "Nada regalado. Nada maldito.",
        lore: "El Errante no trae promesas, herramientas ni pactos. Solo una voluntad terca y una noche demasiado larga.",
        grants: "No recibe ventajas ni penalizaciones.",
        drawback: "La run base de Ardent, pura y honesta.",
        apply() {}
    },
    demente: {
        name: "Demente", color: "#ff2d2d", short: "Entró al Abismo riéndose.",
        lore: "El Demente no busca sobrevivir: busca demostrar que la horda todavía no inventó una muerte suficientemente convincente.",
        grants: "Puede lograr más puntaje y encontrar mejores recompensas.",
        drawback: "Todo viene más difícil: enemigos más duros, más rápidos y menos margen económico.",
        hard: true,
        apply() { player.scoreMultiplier = 1.5; player.enemyHpMultiplier = 1.25; player.enemySpeedMultiplier = 1.15; player.goldBonusMultiplier *= 0.85; player.relicRareBias = 1.25; }
    }
};
function grantFreeTower(defKey, count = 1) {
    if (!player) return;
    if (!player.freeTowerPlacements) player.freeTowerPlacements = {};
    player.freeTowerPlacements[defKey] = (player.freeTowerPlacements[defKey] || 0) + Math.max(0, Math.floor(count));
}

function getFreeTowerCount(defKey) {
    return Math.max(0, Math.floor(Number(player?.freeTowerPlacements?.[defKey]) || 0));
}

function consumeFreeTower(defKey) {
    if (!player?.freeTowerPlacements || getFreeTowerCount(defKey) <= 0) return false;
    player.freeTowerPlacements[defKey] -= 1;
    return true;
}

function grantFreeBarricades(count = 1) {
    if (!player) return;
    player.freeBarricadePlacements = (Number(player.freeBarricadePlacements) || 0) + Math.max(0, Math.floor(count));
}

function getFreeBarricadeCount() {
    return Math.max(0, Math.floor(Number(player?.freeBarricadePlacements) || 0));
}

function consumeFreeBarricade() {
    if (!player || getFreeBarricadeCount() <= 0) return false;
    player.freeBarricadePlacements -= 1;
    return true;
}

function grantFreeMine(count = 1) {
    if (!player) return;
    player.freeMinePlacements = (Number(player.freeMinePlacements) || 0) + Math.max(0, Math.floor(count));
}

function getFreeMineCount() {
    return Math.max(0, Math.floor(Number(player?.freeMinePlacements) || 0));
}

function consumeFreeMine() {
    if (!player || getFreeMineCount() <= 0) return false;
    player.freeMinePlacements -= 1;
    return true;
}

function grantFreeAnyConstruction(count = 1) {
    if (!player) return;
    player.freeAnyConstructionPlacements = (Number(player.freeAnyConstructionPlacements) || 0) + Math.max(0, Math.floor(count));
}

function getFreeAnyConstructionCount() {
    return Math.max(0, Math.floor(Number(player?.freeAnyConstructionPlacements) || 0));
}

function consumeFreeAnyConstruction() {
    if (!player || getFreeAnyConstructionCount() <= 0) return false;
    player.freeAnyConstructionPlacements -= 1;
    return true;
}

function hasFreeConstructionCharge(kind = "any", defKey = "") {
    if (kind === "tower" && getFreeTowerCount(defKey) > 0) return true;
    if (kind === "barricade" && getFreeBarricadeCount() > 0) return true;
    if (kind === "mine" && getFreeMineCount() > 0) return true;
    return getFreeAnyConstructionCount() > 0;
}

function consumeFreeConstructionCharge(kind = "any", defKey = "") {
    if (kind === "tower" && consumeFreeTower(defKey)) return true;
    if (kind === "barricade" && consumeFreeBarricade()) return true;
    if (kind === "mine" && consumeFreeMine()) return true;
    return consumeFreeAnyConstruction();
}

const RELIC_DEFINITIONS = [
    { id:"worker", name:"Obrero Determinado", family:"constructor", desc:"Construcciones 25% más baratas.", downside:"Stats del jugador al 50%, incluso mejoras futuras.", apply(){ player.structureCostMultiplier *= 0.75; player.statPowerMultiplier *= 0.5; player.damage *= 0.5; player.maxHp = Math.max(1, Math.floor(player.maxHp * 0.5)); player.hp = Math.min(player.hp, player.maxHp); } },
    { id:"blood_thirst", name:"Sed de Sangre", family:"sangre", desc:"Matar cerca del jugador cura 0.2 HP; exceso = escudo temporal.", downside:"Aparecen 10% más enemigos.", apply(){ player.bloodThirst = (player.bloodThirst || 0) + 0.2; player.enemyCountMultiplier *= 1.10; } },
    { id:"greed_curse", name:"Maldición del Codicioso", family:"codicia", desc:"Las minas generan el doble de oro.", downside:"Atraen ladrones y enemigos especiales priorizan minas.", apply(){ player.mineIncomeMultiplier *= 2; player.minesAttractEnemies = true; } },
    { id:"crystal_pact", name:"Pacto de Cristal", family:"arcana", desc:"Habilidades +35% daño y -15% cooldown.", downside:"Vida máxima -25%.", apply(){ player.abilityPowerMultiplier *= 1.35; player.abilityCooldownMultiplier *= 0.85; player.maxHp = Math.max(1, Math.floor(player.maxHp * 0.75)); player.hp = Math.min(player.hp, player.maxHp); } },
    { id:"hungry_wall", name:"Muralla Hambrienta", family:"constructor", desc:"Barricadas +40% vida y reflejan daño.", downside:"Repararlas cuesta 35% más.", apply(){ player.barricadeHpMultiplier *= 1.4; player.barricadeReflectPercent = (player.barricadeReflectPercent || 0) + 0.12; player.repairCostMultiplier *= 1.35; buffExistingBarricades(1.4); } },
    { id:"compound", name:"Interés Compuesto", family:"codicia", desc:"Al terminar oleada ganás interés por oro no gastado.", downside:"Enemigos +8% vida.", apply(){ player.compoundInterest = true; player.enemyHpMultiplier *= 1.08; } },
    { id:"obsidian_heart", name:"Corazón de Obsidiana", family:"sangre", desc:"Bajo 35% vida ganás daño y movimiento.", downside:"Curaciones 30% menos efectivas.", apply(){ player.obsidianHeart = true; player.healingMultiplier *= 0.7; } },
    { id:"cursed_architecture", name:"Arquitectura Maldita", family:"constructor", desc:"Torres cerca de barricadas ganan rango y daño.", downside:"Si cae esa barricada, esas torres se debilitan esa oleada.", apply(){ player.cursedArchitecture = true; } },
    { id:"abyss_tithe", name:"Diezmo del Abismo", family:"arcana", desc:"Habilidades dan oro por enemigos golpeados.", downside:"Usarlas cuesta un poco de vida.", apply(){ player.abyssTithe = true; } },
    { id:"siege_crown", name:"Corona del Asedio", family:"neutral", desc:"Bosses dan recompensa extra.", downside:"Mientras vivan, la oleada sigue presionando.", apply(){ player.siegeCrown = true; } }
];

const VISITOR_RELICS = [
    { id:"visitor_eye", name:"Ojo del Visitante", family:"visitante", desc:"Ves mejor a los especiales y les hacés +10% daño.", downside:"El Abismo te recuerda.", apply(){ player.specialDamageMultiplier *= 1.1; } },
    { id:"stolen_hand", name:"Mano Robada", family:"visitante", desc:"Tu próxima construcción cuesta 0; luego vuelve cada 3 oleadas.", downside:"Solo una carga por ciclo.", apply(){ player.freeBuildEvery = 3; grantFreeAnyConstruction(1); } },
    { id:"broken_contract", name:"Contrato Roto", family:"visitante", desc:"Una vez por run, al morir quedás en 1 HP y explotás alrededor.", downside:"Luego el pacto se rompe.", apply(){ player.deathSaveAvailable = true; } }
];

const WAVE_EVENTS = [
    { id:"siege", name:"Asedio", title:"LA MARCHA ROJA", desc:"La horda eligió un solo frente. Aguantá la línea o mirá cómo se parte.", minWave:4, messageType:"event-siege" },
    { id:"midas", name:"Bendición de Midas", title:"BENDICIÓN DE MIDAS", desc:"La codicia doró a los enemigos: corren más, pero cargan más oro.", minWave:5, messageType:"event-midas" },
    { id:"blindness", name:"Ceguera del Abismo", title:"CEGUERA DEL ABISMO", desc:"El mapa pierde sus ojos. Ahora vas a tener que defender con instinto.", minWave:7, messageType:"event-blindness" },
    { id:"blood_rain", name:"Lluvia Carmesí", title:"LLUVIA CARMESÍ", desc:"La sangre cae del cielo. Ellos golpean más fuerte, pero también sangran más rápido.", minWave:8, messageType:"event-blood" },
    { id:"titan_hunger", name:"Hambre del Titán", title:"EL HAMBRE DEL TITÁN", desc:"Algo enorme respira debajo de la oleada. Los especiales escucharon el llamado.", minWave:12, messageType:"event-titan-hunger" },
    { id:"mana_calm", name:"Calma de Maná", title:"CALMA DE MANÁ", desc:"La magia se aquieta. Las habilidades tardan, pero las torres afinan el pulso.", minWave:10, messageType:"event-mana" }
];

const SIDE_MISSIONS = [
    { id:"player_kills", title:"Cazador eficiente", desc:"Matá enemigos con el jugador", type:"playerKills", target:25 },
    { id:"tower_kills", title:"Defensa automática", desc:"Matá enemigos con torres", type:"towerKills", target:30 },
    { id:"no_magic", title:"Sin magia", desc:"Completá la oleada sin usar habilidades", type:"noAbilities", target:1 },
    { id:"no_potions", title:"Sin pociones", desc:"Completá la oleada sin usar consumibles", type:"noConsumables", target:1 },
    { id:"protect_mines", title:"Protegé la mina", desc:"Ninguna mina debe recibir daño", type:"minesSafe", target:1 },
    { id:"wall_intact", title:"Muralla intacta", desc:"No pierdas barricadas esta oleada", type:"barricadesSafe", target:1 },
    { id:"special_priority", title:"Prioridad especial", desc:"Matá enemigos especiales", type:"specialKills", target:3 },
    { id:"trapper", title:"Trampero", desc:"Matá enemigos con trampas/sangrado", type:"trapKills", target:15 },
    { id:"boss_duel", title:"Duelo personal", desc:"Hacé daño directo al boss con el jugador", type:"bossPlayerDamage", target:80 },
    { id:"clean_wave", title:"Oleada limpia", desc:"Terminá con más del 75% de vida", type:"highHpEnd", target:1 },
    { id:"save_gold", title:"Ahorro peligroso", desc:"Terminá con oro guardado", type:"saveGold", target:1 },
    { id:"crowd_control", title:"Control de masas", desc:"Afectá enemigos con control", type:"ccHits", target:20 },
    { id:"ram_punish", title:"Castigo al Carnero", desc:"Matá un Carnero antes de que rompa estructuras", type:"ramKills", target:1 },
    { id:"near_base", title:"Zona segura", desc:"Evitá invasiones cerca del núcleo", type:"baseSafe", target:1 },
    { id:"fast_clear", title:"Limpieza total", desc:"Matá rápido durante la oleada", type:"fastKills", target:50 },
    { id:"low_hp_kills", title:"Sangre fría", desc:"Matá con menos del 50% de vida", type:"lowHpKills", target:10 },
    { id:"mine_income", title:"Economía viva", desc:"Generá oro con minas y no pierdas ninguna", type:"mineIncomeSafe", target:1 },
    { id:"last_spell", title:"Último golpe", desc:"Matá al boss con una habilidad", type:"bossAbilityKill", target:1 },
    { id:"build_phase", title:"Ingeniería rápida", desc:"Construí o mejorá algo antes de la próxima oleada", type:"buildAction", target:1 },
    { id:"survive_no_damage", title:"No retrocedas", desc:"No recibas daño durante esta oleada", type:"noPlayerDamage", target:1 }
];



const FINAL_DEATH_LINES = {
    record: [
        "¡Récord superado! El Abismo tuvo que esforzarse más esta vez.", "Nuevo récord. Ardent recuerda esta defensa.", "Tu caída rompió una marca. Eso también es una victoria.", "El Abismo ganó, pero hoy tuvo que pagar caro.", "Tu nombre quedó grabado entre cenizas y barricadas.", "La horda avanzó, sí, pero primero aprendió a temerte.", "Nuevo récord: tu fortaleza duró más que la esperanza de muchos.", "El récord anterior quedó enterrado bajo tus ruinas.", "Caíste más lejos que nunca. El Abismo tomó nota.", "Ardent no te salvó, pero esta vez te honró."
    ],
    low: [
        "El Abismo apenas tuvo que mirarte.", "Tu fortaleza fue una promesa demasiado corta.", "Ni las sombras llegaron a aprender tu nombre.", "La horda preguntó si eso era todo.", "Ardent prendió una vela. Se apagó enseguida.", "El primer muro fue más una sugerencia que una defensa.", "El Abismo bostezó. Después avanzó.", "La run murió antes de tener leyenda.", "La horda pasó y ni bajó la velocidad.", "Tu plan era valiente. Cortito, pero valiente."
    ],
    mid: [
        "Resististe más de lo esperado, pero Ardent todavía no perdona.", "Tu defensa ardió fuerte, aunque no lo suficiente.", "El Abismo empezó a tomarte en serio.", "La horda tuvo que empujar un poco más para romperte.", "Tus torres cantaron. Las ruinas respondieron.", "No fue una caída: fue una advertencia para la próxima run.", "Aguantaste lo bastante como para molestar al Abismo.", "Tu base tuvo forma, furia y final.", "Las sombras ganaron, pero ya saben dónde te escondés.", "Ardent vio una chispa. Todavía falta incendio."
    ],
    high: [
        "Caíste, pero dejaste una cicatriz en el Abismo.", "Tu nombre será recordado entre las ruinas de Ardent.", "La horda ganó, pero no salió ilesa.", "Tus muros no sobrevivieron, pero tu leyenda sí.", "El Abismo tuvo que romperte por partes.", "No defendiste una base: defendiste una historia.", "La última barricada cayó con honor.", "La horda cruzó, pero cruzó temblando.", "Ardent perdió terreno, no memoria.", "Tu caída sonó como metal contra el fin del mundo."
    ],
    legendary: [
        "El Abismo ganó por cansancio, no por gloria.", "Tu defensa fue una cicatriz enorme sobre la oscuridad.", "La horda tardó tanto que casi pareció dudar.", "Ardent no olvidará esta run. Nadie debería.", "Caíste donde otros ni siquiera llegaron a mirar.", "Los enemigos pasaron sobre ruinas sagradas.", "Tu fortaleza se volvió mito antes de caer.", "El Abismo necesitó paciencia, sangre y demasiados cuerpos.", "Perdiste la run, pero ganaste una leyenda.", "Que la horda celebre: sobrevivió a vos."
    ],
    boss: [
        "El jefe reclamó tu fortaleza en la wave {wave}.", "El Abismo mandó un nombre propio, y ese nombre te quebró.", "Caíste ante {cause}; la horda siguió caminando.", "El jefe no solo te mató: firmó el final de la defensa.", "{cause} encontró la grieta y la convirtió en tumba.", "Tu run terminó bajo la sombra de {cause}.", "El duelo fue digno. El resultado, cruel.", "{cause} apagó las luces de Ardent.", "No fue una oleada cualquiera: fue una sentencia con vida propia.", "El jefe cruzó tus defensas como si fueran recuerdos viejos."
    ],
    titan: [
        "Caíste ante el Titán Negro en la wave {wave}.", "El Titán caminó sobre los restos de tu fortaleza.", "El suelo tembló, tus torres gritaron y el Titán siguió avanzando.", "El Titán no te venció rápido. Te borró con paciencia.", "La wave {wave} será recordada por el paso del Titán.", "El Titán Negro no atacó tu base: la declaró ruina.", "Tus muros aprendieron el peso de un dios oscuro.", "El Titán llegó tarde, pero llegó como final.", "Ardent guardó silencio cuando el Titán te alcanzó.", "Contra el Titán, hasta las sombras parecían pequeñas."
    ]
};

function pickRandomLine(list = []) {
    if (!Array.isArray(list) || !list.length) return "El Abismo reclamó tu run.";
    return list[Math.floor(Math.random() * list.length)];
}
function formatFinalLine(template, context = {}) {
    return String(template || "").replaceAll("{wave}", String(context.wave ?? wave ?? "?")).replaceAll("{cause}", String(context.cause || "el Abismo"));
}

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
    standard: 62,
    regen: 112,
    explosive: 135,
    thorns: 85,
    door: 48
};

// Ajuste de economía para el modo base/survival infinito:
// un poquito más de oro para poder levantar defensas, pero muros más caros de escalar.
const BUILD_ECONOMY_GOLD_MULTIPLIER = 1.16;
const BARRICADE_STANDARD_UPGRADE_MULTIPLIER = 1.74;
const BARRICADE_SPECIAL_UPGRADE_MULTIPLIER = 1.56;
const BARRICADE_DOOR_UPGRADE_MULTIPLIER = 1.48;
const trapDefinitions = {
    snare: { key: "trapSnare", name: "Trampa de agarre", cost: 55, color: "#9be7ff", radius: 24, duration: 1500 },
    bleed: { key: "trapBleed", name: "Trampa serrada", cost: 75, color: "#ff6b6b", radius: 26, slowAmount: 0.45, slowDuration: 500, bleedDuration: 3000 }
};

// Minas: economía estable por oleada, no por segundo.
// Esto evita abusos en oleadas largas, repeat y late game infinito.
const MINE_LIMIT = 5;
const FIRST_MINE_COST = 220;
const MINE_COST_MULTIPLIER = 1.62;
const mineDefinitions = {
    gold: { key: "mineGold", name: "Mina de eco", cost: FIRST_MINE_COST, color: "#ffd76a", radius: MINE_COLLISION_RADIUS }
};
const BARRICADE_UNLOCK_WAVE = 1;
const TOWER_REPAIR_COST_FACTOR = 0.28;
const TITAN_SHARD_RADIUS = 15;
const TITAN_REWARD_OPTION_COUNT = 3;
const TITAN_VARIANTS = [
    // Hotfix 1.0.4.8: mantienen la fantasía de amenaza mítica, pero escalan más justo en waves tempranas.
    { key: "burn", name: "Titán Ígneo", color: "#18040a", hpMultiplier: 0.82, speedMultiplier: 0.86, cooldown: 3200, intro: "El suelo se quema bajo una sombra imposible." },
    { key: "dash", name: "Titán Embestida", color: "#050505", hpMultiplier: 1.12, speedMultiplier: 0.70, cooldown: 4300, intro: "La oscuridad no camina: embiste." },
    { key: "split", name: "Titán Trino", color: "#160016", hpMultiplier: 0.84, speedMultiplier: 0.82, cooldown: 2300, intro: "Una sola sombra aprende a ser multitud." }
];

function pickTitanVariant() {
    return TITAN_VARIANTS[Math.floor(Math.random() * TITAN_VARIANTS.length)];
}


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


function normalizeBarricadeBuildOrientation() {
    const index = BARRICADE_BUILD_ORIENTATIONS.indexOf(barricadeBuildOrientation);
    if (index >= 0) {
        barricadeBuildOrientationIndex = index;
        return barricadeBuildOrientation;
    }

    barricadeBuildOrientationIndex = 0;
    barricadeBuildOrientation = BARRICADE_BUILD_ORIENTATIONS[0];
    return barricadeBuildOrientation;
}

function getBarricadeOrientationLabel(orientation = barricadeBuildOrientation) {
    if (orientation === "vertical") return "vertical |";
    if (orientation === "diagonalUp") return "diagonal /";
    if (orientation === "diagonalDown") return "diagonal \\";
    return "horizontal -";
}

function rotateBarricadeBuildOrientation() {
    normalizeBarricadeBuildOrientation();
    barricadeBuildOrientationIndex = (barricadeBuildOrientationIndex + 1) % BARRICADE_BUILD_ORIENTATIONS.length;
    barricadeBuildOrientation = BARRICADE_BUILD_ORIENTATIONS[barricadeBuildOrientationIndex];
    return barricadeBuildOrientation;
}

function getBarricadeDimensions(orientation = barricadeBuildOrientation) {
    orientation = BARRICADE_BUILD_ORIENTATIONS.includes(orientation) ? orientation : "horizontal";
    const isDiagonal = orientation === "diagonalDown" || orientation === "diagonalUp";
    if (isDiagonal) {
        const bound = Math.abs(Math.cos(Math.PI / 4)) * BARRICADE_LENGTH + Math.abs(Math.sin(Math.PI / 4)) * BARRICADE_THICKNESS;
        return { width: bound, height: bound };
    }
    return orientation === "vertical"
        ? { width: BARRICADE_THICKNESS, height: BARRICADE_LENGTH }
        : { width: BARRICADE_LENGTH, height: BARRICADE_THICKNESS };
}

function getBarricadeAngle(orientation = "horizontal") {
    orientation = BARRICADE_BUILD_ORIENTATIONS.includes(orientation) ? orientation : "horizontal";
    if (orientation === "vertical") return Math.PI / 2;
    if (orientation === "diagonalDown") return Math.PI / 4;
    if (orientation === "diagonalUp") return -Math.PI / 4;
    return 0;
}

function isDiagonalBarricade(orientation = "horizontal") {
    return orientation === "diagonalDown" || orientation === "diagonalUp";
}

function getBarricadeSegment(barricade) {
    const angle = getBarricadeAngle(barricade.orientation || "horizontal");
    const hx = Math.cos(angle) * BARRICADE_LENGTH / 2;
    const hy = Math.sin(angle) * BARRICADE_LENGTH / 2;
    return {
        x1: barricade.x - hx,
        y1: barricade.y - hy,
        x2: barricade.x + hx,
        y2: barricade.y + hy,
        angle
    };
}

function distancePointToSegment(px, py, x1, y1, x2, y2) {
    const vx = x2 - x1;
    const vy = y2 - y1;
    const lengthSq = vx * vx + vy * vy || 1;
    const t = Math.max(0, Math.min(1, ((px - x1) * vx + (py - y1) * vy) / lengthSq));
    const cx = x1 + vx * t;
    const cy = y1 + vy * t;
    return { distance: Math.hypot(px - cx, py - cy), closestX: cx, closestY: cy, t };
}

function pointToRectDistance(px, py, rect) {
    const closestX = Math.max(rect.left, Math.min(rect.right, px));
    const closestY = Math.max(rect.top, Math.min(rect.bottom, py));
    return Math.hypot(px - closestX, py - closestY);
}

function segmentIntersectsRect(x1, y1, x2, y2, rect) {
    let t0 = 0;
    let t1 = 1;
    const dx = x2 - x1;
    const dy = y2 - y1;
    const checks = [
        [-dx, x1 - rect.left],
        [dx, rect.right - x1],
        [-dy, y1 - rect.top],
        [dy, rect.bottom - y1]
    ];

    for (const [p, q] of checks) {
        if (Math.abs(p) < 0.000001) {
            if (q < 0) return false;
            continue;
        }
        const r = q / p;
        if (p < 0) t0 = Math.max(t0, r);
        else t1 = Math.min(t1, r);
        if (t0 > t1) return false;
    }
    return true;
}

function distanceSegmentToRect(x1, y1, x2, y2, rect) {
    if (segmentIntersectsRect(x1, y1, x2, y2, rect)) return 0;
    let best = Math.min(pointToRectDistance(x1, y1, rect), pointToRectDistance(x2, y2, rect));
    const corners = [
        [rect.left, rect.top], [rect.right, rect.top], [rect.right, rect.bottom], [rect.left, rect.bottom]
    ];
    for (const [cx, cy] of corners) {
        best = Math.min(best, distancePointToSegment(cx, cy, x1, y1, x2, y2).distance);
    }
    return best;
}

function segmentsIntersectFinite(a1x, a1y, a2x, a2y, b1x, b1y, b2x, b2y) {
    // Intersección REAL entre segmentos finitos.
    // El bug anterior trataba dos líneas colineales como si se tocaran aunque
    // estuvieran separadas, por eso una barricada horizontal bloqueaba toda la fila
    // y una vertical bloqueaba toda la columna durante construcción.
    const EPS = 0.000001;
    const cross = (ax, ay, bx, by, cx, cy) => (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
    const onSegment = (ax, ay, bx, by, px, py) => (
        px >= Math.min(ax, bx) - EPS && px <= Math.max(ax, bx) + EPS &&
        py >= Math.min(ay, by) - EPS && py <= Math.max(ay, by) + EPS &&
        Math.abs(cross(ax, ay, bx, by, px, py)) <= EPS
    );

    const d1 = cross(a1x, a1y, a2x, a2y, b1x, b1y);
    const d2 = cross(a1x, a1y, a2x, a2y, b2x, b2y);
    const d3 = cross(b1x, b1y, b2x, b2y, a1x, a1y);
    const d4 = cross(b1x, b1y, b2x, b2y, a2x, a2y);

    if (((d1 > EPS && d2 < -EPS) || (d1 < -EPS && d2 > EPS)) &&
        ((d3 > EPS && d4 < -EPS) || (d3 < -EPS && d4 > EPS))) {
        return true;
    }

    if (Math.abs(d1) <= EPS && onSegment(a1x, a1y, a2x, a2y, b1x, b1y)) return true;
    if (Math.abs(d2) <= EPS && onSegment(a1x, a1y, a2x, a2y, b2x, b2y)) return true;
    if (Math.abs(d3) <= EPS && onSegment(b1x, b1y, b2x, b2y, a1x, a1y)) return true;
    if (Math.abs(d4) <= EPS && onSegment(b1x, b1y, b2x, b2y, a2x, a2y)) return true;
    return false;
}

function distanceSegmentToSegment(a1x, a1y, a2x, a2y, b1x, b1y, b2x, b2y) {
    // Si los segmentos finitos se cruzan o se superponen, la distancia real es 0.
    if (segmentsIntersectFinite(a1x, a1y, a2x, a2y, b1x, b1y, b2x, b2y)) return 0;

    return Math.min(
        distancePointToSegment(a1x, a1y, b1x, b1y, b2x, b2y).distance,
        distancePointToSegment(a2x, a2y, b1x, b1y, b2x, b2y).distance,
        distancePointToSegment(b1x, b1y, a1x, a1y, a2x, a2y).distance,
        distancePointToSegment(b2x, b2y, a1x, a1y, a2x, a2y).distance
    );
}

function getClosestPointOnBarricade(px, py, barricade) {
    // Todas las barricadas usan el mismo modelo de colisión: una cápsula fina
    // alineada con su orientación real. Así |, /, - y \ no comparten
    // una hitbox diagonal ni una caja invisible grande.
    const seg = getBarricadeSegment(barricade);
    const hit = distancePointToSegment(px, py, seg.x1, seg.y1, seg.x2, seg.y2);
    return { x: hit.closestX, y: hit.closestY };
}

function barricadesIntersect(a, b, padding = 0) {
    const sa = getBarricadeSegment(a);
    const sb = getBarricadeSegment(b);
    // Dos cápsulas chocan cuando sus segmentos centrales están más cerca que
    // la suma de sus medios grosores. Funciona para vertical, horizontal y diagonales.
    return distanceSegmentToSegment(sa.x1, sa.y1, sa.x2, sa.y2, sb.x1, sb.y1, sb.x2, sb.y2) <= BARRICADE_THICKNESS + padding;
}

function circleIntersectsBarricade(cx, cy, radius, barricade, padding = 0) {
    const seg = getBarricadeSegment(barricade);
    const info = distancePointToSegment(cx, cy, seg.x1, seg.y1, seg.x2, seg.y2);
    return info.distance <= radius + BARRICADE_THICKNESS / 2 + padding;
}

function barricadeIntersectsRect(barricade, rect, padding = 0) {
    // Colisión real de barricada: cápsula fina siguiendo la madera en la
    // orientación guardada al colocarla: |, /, - o \.
    const seg = getBarricadeSegment(barricade);
    return distanceSegmentToRect(seg.x1, seg.y1, seg.x2, seg.y2, rect) <= BARRICADE_THICKNESS / 2 + padding;
}

function getBarricadeBaseCost(kind = "standard") {
    return BARRICADE_BUILD_COSTS[kind] || BARRICADE_BUILD_COSTS.standard;
}

function getBarricadeKindLabel(kind = "standard") {
    if (kind === "regen") return "Regenerativa";
    if (kind === "explosive") return "Explosiva";
    if (kind === "thorns") return "Espinas";
    if (kind === "door") return "Puerta";
    return "Estándar";
}

function getBarricadeUpgradeMultiplier(kind = "standard") {
    if (kind === "door") return BARRICADE_DOOR_UPGRADE_MULTIPLIER;
    if (kind === "standard") return BARRICADE_STANDARD_UPGRADE_MULTIPLIER;
    return BARRICADE_SPECIAL_UPGRADE_MULTIPLIER;
}

function getMinimumBarricadeUpgradeCost(b) {
    const baseCost = getBarricadeBaseCost(b?.kind || "standard");
    const level = Math.max(0, Number(b?.level) || 0);
    const tier = Math.max(0, Number(b?.tier) || 0);
    const steps = (b?.kind === "standard" ? tier + level : level) + 1;
    const multiplier = getBarricadeUpgradeMultiplier(b?.kind || "standard");
    return Math.ceil((baseCost * Math.pow(multiplier, Math.max(0, steps - 1))) / 5) * 5;
}

function ensureBarricadeEconomy(b) {
    if (!b) return b;
    const baseCost = getBarricadeBaseCost(b.kind);
    b.buildCost = Number(b.buildCost) || baseCost;
    b.spent = Number(b.spent) || b.buildCost;
    const minimumUpgradeCost = getMinimumBarricadeUpgradeCost(b);
    const currentUpgradeCost = Number(b.upgradeCost) || 0;
    b.upgradeCost = Math.max(currentUpgradeCost, minimumUpgradeCost);
    return b;
}

function getTowerBaseMaxHp(t) {
    if (!t) return 36;
    if (t.type === "blade") return 60;
    if (t.type === "spear") return 44;
    if (t.type === "laser") return 52;
    if (t.type === "rapid") return 22;
    if (t.type === "ballista") return 48;
    if (t.type === "buffer") return 34;
    if (t.type === "lucky") return 28;
    if (t.type === "slow" || t.type === "poison") return 40;
    return 36;
}

function ensureTowerEconomy(t) {
    if (!t) return t;
    t.spent = Number(t.spent) || Number(t.cost) || 0;
    t.upgradeCost = Number(t.upgradeCost) || Math.floor((Number(t.cost) || 100) * 1.35);
    const fallbackMaxHp = getTowerBaseMaxHp(t) + Math.max(0, (Number(t.level) || 1) - 1) * (t.type === "blade" ? 8 : t.type === "spear" ? 7 : t.type === "laser" ? 8 : t.type === "ballista" ? 7 : 5);
    if (!Number.isFinite(Number(t.maxHp)) || Number(t.maxHp) <= 0) {
        t.maxHp = fallbackMaxHp;
    } else if (Number(t.maxHp) > fallbackMaxHp * 1.35) {
        const hpRatio = Math.max(0.05, Math.min(1, (Number(t.hp) || Number(t.maxHp)) / Math.max(1, Number(t.maxHp))));
        t.maxHp = fallbackMaxHp;
        t.hp = Math.max(1, t.maxHp * hpRatio);
    }
    if (!Number.isFinite(Number(t.hp)) || Number(t.hp) <= 0) t.hp = t.maxHp;
    t.hp = Math.min(t.maxHp, t.hp);
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

function getBossSpawnRect(padding = 0) {
    return {
        left: BOSS_SPAWN_ZONE.x - BOSS_SPAWN_ZONE.width / 2 - padding,
        right: BOSS_SPAWN_ZONE.x + BOSS_SPAWN_ZONE.width / 2 + padding,
        top: BOSS_SPAWN_ZONE.y - BOSS_SPAWN_ZONE.height / 2 - padding,
        bottom: BOSS_SPAWN_ZONE.y + BOSS_SPAWN_ZONE.height / 2 + padding
    };
}

function isRectInBossSpawnZone(rect, padding = 0) {
    return rectsOverlap(rect, getBossSpawnRect(padding), 0);
}

function isCircleInBossSpawnZone(x, y, radius = 0, padding = 0) {
    return circleIntersectsRect(x, y, radius, getBossSpawnRect(padding), 0);
}

function canStartBuildPlacement(kindLabel = "construir") {
    if (!buildPhaseActive) {
        showCenterMessage(`Solo podés ${kindLabel} durante el descanso antes de la próxima oleada`, 1200);
        return false;
    }
    return true;
}

function getDirectionVector(rotation = 0) {
    return { x: Math.cos(rotation || 0), y: Math.sin(rotation || 0) };
}

function rotateTowerObject(tower) {
    if (!tower) return;
    tower.rotation = ((Number(tower.rotation) || 0) + TOWER_ROTATION_STEP) % (Math.PI * 2);
}

function getRotationLabel(rotation = 0) {
    const normalized = ((rotation % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
    const index = Math.round(normalized / TOWER_ROTATION_STEP) % 4;
    return ["derecha", "abajo", "izquierda", "arriba"][index];
}


function circleIntersectsRect(cx, cy, radius, rect, padding = 0) {
    const closestX = Math.max(rect.left - padding, Math.min(rect.right + padding, cx));
    const closestY = Math.max(rect.top - padding, Math.min(rect.bottom + padding, cy));
    return Math.hypot(cx - closestX, cy - closestY) <= radius;
}

function buildRectOverlapsEnemy(rect, padding = 10) {
    return (enemies || []).some(enemy => enemy.hp > 0 && circleIntersectsRect(enemy.x, enemy.y, (enemy.radius || 12) + padding, rect, 0));
}

function buildBarricadeOverlapsEnemy(x, y, orientation = barricadeBuildOrientation, padding = 10) {
    const testBarricade = { x, y, orientation, isBuildBarricade: true };
    return (enemies || []).some(enemy => enemy.hp > 0 && circleIntersectsBarricade(enemy.x, enemy.y, (enemy.radius || 12) + padding, testBarricade, 0));
}

function buildCircleOverlapsEnemy(x, y, radius, padding = 10) {
    return (enemies || []).some(enemy => enemy.hp > 0 && Math.hypot(enemy.x - x, enemy.y - y) < (enemy.radius || 12) + radius + padding);
}

function isTowerPositionOccupied(x, y, ignoredTower = null) {
    const towerRect = getEntityRect({ x, y, radius: TOWER_COLLISION_RADIUS });
    if (!isBuildRectInsideWorld(towerRect)) return true;
    if (isRectInBossSpawnZone(towerRect, 8)) return true;
    if (baseCore && Math.hypot(x - baseCore.x, y - baseCore.y) < BASE_RADIUS + TOWER_COLLISION_RADIUS + 18) return true;
    if (player && Math.hypot(x - player.x, y - player.y) < 38) return true;
    if (buildCircleOverlapsEnemy(x, y, TOWER_COLLISION_RADIUS, 10)) return true;
    if ((towers || []).some(t => t !== ignoredTower && rectsOverlap(towerRect, getEntityRect({ x: t.x, y: t.y, radius: TOWER_COLLISION_RADIUS }), 6))) return true;
    if ((barricades || []).some(b => b.active && b.hp > 0 && !b.isOpen && circleIntersectsBarricade(x, y, TOWER_COLLISION_RADIUS, b, 6))) return true;
    if ((traps || []).some(trap => Math.hypot(trap.x - x, trap.y - y) < TRAP_COLLISION_RADIUS + TOWER_COLLISION_RADIUS + 6)) return true;
    if ((mines || []).some(mine => Math.hypot(mine.x - x, mine.y - y) < MINE_COLLISION_RADIUS + TOWER_COLLISION_RADIUS + 8)) return true;
    return false;
}

function isBarricadePositionValid(x, y, orientation = barricadeBuildOrientation, ignoredBarricade = null) {
    const testBarricade = { x, y, orientation, isBuildBarricade: true };
    const rect = getEntityRect(testBarricade);
    if (!isBuildRectInsideWorld(rect)) return false;
    if (isRectInBossSpawnZone(rect, 8)) return false;
    if (baseCore && circleIntersectsBarricade(baseCore.x, baseCore.y, BASE_RADIUS + 10, testBarricade, 0)) return false;
    if (player && circleIntersectsBarricade(player.x, player.y, 30, testBarricade, 0)) return false;
    if (buildBarricadeOverlapsEnemy(x, y, orientation, 10)) return false;
    // Las barricadas NO consumen slots de torre.
    // Usamos la forma real de la barricada —también en diagonal— para evitar paredes invisibles.
    if ((towers || []).some(t => barricadeIntersectsRect(testBarricade, getEntityRect({ x: t.x, y: t.y, radius: TOWER_COLLISION_RADIUS + 2 }), 0))) return false;
    if ((barricades || []).some(b => b !== ignoredBarricade && b.active && b.hp > 0 && !b.isOpen && barricadesIntersect(testBarricade, b, 2))) return false;
    if ((traps || []).some(trap => circleIntersectsBarricade(trap.x, trap.y, TRAP_COLLISION_RADIUS + 6, testBarricade, 0))) return false;
    if ((mines || []).some(mine => circleIntersectsBarricade(mine.x, mine.y, MINE_COLLISION_RADIUS + 8, testBarricade, 0))) return false;
    return true;
}

function isTrapPositionValid(x, y) {
    const trapRect = getEntityRect({ x, y, radius: TRAP_COLLISION_RADIUS });
    if (!isBuildRectInsideWorld(trapRect)) return false;
    if (isCircleInBossSpawnZone(x, y, TRAP_COLLISION_RADIUS, 8)) return false;
    if (player && Math.hypot(x - player.x, y - player.y) < TRAP_COLLISION_RADIUS + 24) return false;
    if (buildCircleOverlapsEnemy(x, y, TRAP_COLLISION_RADIUS, 8)) return false;
    if ((towers || []).some(t => Math.hypot(t.x - x, t.y - y) < TOWER_COLLISION_RADIUS + TRAP_COLLISION_RADIUS + 6)) return false;
    if ((barricades || []).some(b => b.active && b.hp > 0 && !b.isOpen && circleIntersectsBarricade(x, y, TRAP_COLLISION_RADIUS + 4, b, 0))) return false;
    if ((traps || []).some(trap => Math.hypot(trap.x - x, trap.y - y) < TRAP_COLLISION_RADIUS * 2 + 4)) return false;
    if ((mines || []).some(mine => Math.hypot(mine.x - x, mine.y - y) < MINE_COLLISION_RADIUS + TRAP_COLLISION_RADIUS + 6)) return false;
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
    { key: "tower2", name: "Rápida", type: "rapid", cost: 40, upgradeCost: 80, damage: 0.30, range: 205, fireDelay: 315, color: "#b9ff7a", label: "R", maxHp: 22 },
    { key: "tower3", name: "Perforante", type: "pierce", cost: 160, upgradeCost: 180, damage: 2.2, range: 250, fireDelay: 1200, color: "#ffdf6b", label: "P" },
    { key: "tower4", name: "Hielo", type: "slow", cost: 220, upgradeCost: 240, damage: 0, range: 260, fireDelay: 2600, color: "#9be7ff", label: "H", slowAmount: 0.45, slowDuration: 1600, areaRadius: 58 },
    { key: "tower5", name: "Doble", type: "double", cost: 260, upgradeCost: 300, damage: 0.65, range: 235, fireDelay: 1050, color: "#ff8bd1", label: "D" },
    { key: "tower6", name: "Veneno", type: "poison", cost: 310, upgradeCost: 350, damage: 2.45, range: 248, fireDelay: 2850, color: "#8cff4a", label: "V", areaRadius: 58, poisonDuration: 3200, tickDelay: 650 },
    { key: "tower7", name: "Ballesta", type: "ballista", cost: 360, upgradeCost: 420, damage: 9.5, range: 320, fireDelay: 2850, color: "#c58b4b", label: "X" },
    { key: "tower8", name: "Sanguijuela", type: "siphon", cost: 420, upgradeCost: 460, damage: 0.12, drainAmount: 3.2, range: 245, fireDelay: 850, color: "#b81444", label: "S" },
    { key: "tower9", name: "Buffer", type: "buffer", cost: 620, upgradeCost: 600, damage: 0, range: 180, fireDelay: 999999, color: "#b78cff", label: "+", buffDamage: 0.10, buffSpeed: 0.10 },
    { key: "tower10", name: "Lucky Block", type: "lucky", cost: 240, upgradeCost: 0, damage: 0, range: 0, fireDelay: 999999, color: "#ffe28a", label: "?" },
    { key: "tower11", name: "Cuchilla", type: "blade", cost: 90, upgradeCost: 120, damage: 0.55, range: 62, fireDelay: 620, color: "#d9d9d9", label: "C", maxHp: 60 },
    { key: "tower12", name: "Lancera", type: "spear", cost: 135, upgradeCost: 165, damage: 1.05, range: 310, fireDelay: 1650, color: "#d7b06a", label: "L", maxHp: 44, laneWidth: 38 },
    { key: "tower13", name: "Láser", type: "laser", cost: 1450, upgradeCost: 950, damage: 14, range: 255, fireDelay: 120, color: "#ff4fd8", label: "⚡", maxHp: 52, beamWidth: 5 }
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
        hp: 12,
        speed: 0.50,
        reward: 18,
        score: 30,
        damageToDefense: 1,
        attackDelay: 1200,
        special: "healer",
        unlockWave: 8,
        healRadius: 220,
        healAmount: 3,
        healDelay: 1350
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
        hp: 15,
        speed: 0.22,
        reward: 30,
        score: 48,
        damageToDefense: 2,
        attackDelay: 1250,
        special: "summoner",
        unlockWave: 17,
        summonDelay: 5200
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
        name: "Ladrón de Minas",
        color: "#ffd84a",
        hp: 8,
        speed: 1.32,
        reward: 20,
        score: 42,
        damageToDefense: 1,
        attackDelay: 850,
        special: "thief",
        unlockWave: 9
    },
    {
        name: "Carnero",
        color: "#b06b3a",
        hp: 18,
        speed: 0.48,
        reward: 28,
        score: 58,
        damageToDefense: 8,
        attackDelay: 1200,
        special: "ram",
        unlockWave: 12
    },
    {
        name: "Bicho Espejo",
        color: "#e7e7ff",
        hp: 13,
        speed: 0.58,
        reward: 31,
        score: 68,
        damageToDefense: 2,
        attackDelay: 980,
        special: "mirror",
        reflectPercent: 0.18,
        unlockWave: 16
    },
    {
        name: "Lanzador",
        color: "#ffb36b",
        hp: 7,
        speed: 0.44,
        reward: 26,
        score: 62,
        damageToDefense: 2,
        attackDelay: 1250,
        special: "ranged",
        rangedCooldown: 2600,
        unlockWave: 18
    },
    {
        name: "Heraldo Carmesí",
        color: "#ff4fd8",
        hp: 16,
        speed: 0.52,
        reward: 34,
        score: 78,
        damageToDefense: 2,
        attackDelay: 1200,
        special: "herald",
        auraRadius: 170,
        auraPower: 0.22,
        unlockWave: 21
    },
    {
        name: "Guardia Frontal",
        color: "#8fa8ff",
        hp: 15,
        shieldHp: 20,
        speed: 0.50,
        reward: 36,
        score: 82,
        damageToDefense: 3,
        attackDelay: 1100,
        special: "shielded",
        unlockWave: 24
    },
    {
        name: "El Visitante",
        color: "#f2f2f2",
        hp: 120,
        speed: 0.92,
        reward: 250,
        score: 520,
        damageToDefense: 3,
        attackDelay: 1250,
        special: "visitor",
        unlockWave: 9999,
        rangedCooldown: 1250,
        visitor: true
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
        unlockWave: 20,
        rare: true
    }
];

const bossTypes = [
    { name: "Jefe del Abismo", variant: "barrage", color: "#ff7b00", hp: 92, speed: 0.31, reward: 125, score: 260, damageToDefense: 4, attackDelay: 1220, specialCooldown: 2150, burstShots: 7, burstDelay: 135 },
    { name: "Parpadeo Mayor", variant: "blink", color: "#d58cff", hp: 86, speed: 0.35, reward: 130, score: 270, damageToDefense: 4, attackDelay: 1220, specialCooldown: 1600 },
    { name: "Orbe Rebotante", variant: "dvd", color: "#9be7ff", hp: 145, speed: 0.39, reward: 150, score: 310, damageToDefense: 5, attackDelay: 920, specialCooldown: 2050, dvdVy: 1.65 },
    { name: "Mortero Carmesí", variant: "mortar", color: "#ff4747", hp: 104, speed: 0.27, reward: 140, score: 295, damageToDefense: 4, attackDelay: 1280, specialCooldown: 2200 },
    { name: "Corona de Espinas", variant: "spiral", color: "#73ff9f", hp: 98, speed: 0.30, reward: 145, score: 305, damageToDefense: 4, attackDelay: 1180, specialCooldown: 1900 },
    { name: "Carcelero del Abismo", variant: "jailer", color: "#b78cff", hp: 118, speed: 0.29, reward: 155, score: 335, damageToDefense: 4, attackDelay: 1240, specialCooldown: 3900 },
    { name: "Devoramuros", variant: "wallEater", color: "#b06b3a", hp: 135, speed: 0.31, reward: 165, score: 355, damageToDefense: 7, attackDelay: 1120, specialCooldown: 2900 },
    { name: "Oráculo Carmesí", variant: "oracle", color: "#ff4fd8", hp: 108, speed: 0.28, reward: 160, score: 345, damageToDefense: 4, attackDelay: 1220, specialCooldown: 2550 },
    { name: "Comandante de la Horda", variant: "commander", color: "#ffe28a", hp: 126, speed: 0.30, reward: 175, score: 375, damageToDefense: 4, attackDelay: 1180, specialCooldown: 2450 },
    { name: "Recolector", variant: "collector", color: "#ffd84a", hp: 112, speed: 0.33, reward: 180, score: 390, damageToDefense: 4, attackDelay: 1160, specialCooldown: 2700 }
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
    b.upgradeCost = scaleBarricadeCost(b.buildCost, getBarricadeUpgradeMultiplier(kind));
    b.isDoor = kind === "door";
    b.isOpen = false;
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


function getBestMineTargetForThief(enemy) {
    let best = null;
    let bestScore = Infinity;
    (mines || []).forEach(mine => {
        if (!mine || mine.hp <= 0) return;
        const score = Math.hypot(enemy.x - mine.x, enemy.y - mine.y) - (mine.totalGold || 0) * 0.5;
        if (score < bestScore) { best = mine; bestScore = score; }
    });
    return best;
}
function getEnemyMainTarget(enemy) {
    if (enemy && enemy.special === "thief") {
        const mine = getBestMineTargetForThief(enemy);
        if (mine) return { type: "mine", x: mine.x, y: mine.y, radius: mine.radius || MINE_COLLISION_RADIUS, object: mine, score: 0 };
    }
    if (enemy && enemy.special === "ram") {
        const b = getNearestActiveBarricadeTo(enemy.x, enemy.y);
        if (b) {
            const c = getClosestPointOnBarricade(enemy.x, enemy.y, b);
            return { type: "barricade", x: c.x, y: c.y, radius: 12, object: b, score: 0 };
        }
    }

    // El sanador prioriza seguir aliados heridos o grupos de enemigos; no busca destruir estructuras.
    if (enemy && enemy.special === "healer") {
        const supportTarget = getHealerSupportTarget(enemy);
        if (supportTarget) return supportTarget;
    }

    // Supervivencia sandbox: los enemigos quieren destruir todo lo nuestro.
    // El jugador sigue teniendo prioridad, pero una torre/muro en la cara no se ignora.
    const candidates = [];
    if (player && player.hp > 0) {
        const d = Math.hypot(enemy.x - player.x, enemy.y - player.y);
        candidates.push({ type: "player", x: player.x, y: player.y, radius: 23, object: player, score: d * 0.72 });
    }

    (towers || []).forEach(tower => {
        if (!tower || !tower.owned || tower.hp <= 0) return;
        const d = Math.hypot(enemy.x - tower.x, enemy.y - tower.y);
        // Las torres cercanas son comida fácil, pero no reemplazan siempre al jugador.
        const proximityBonus = d < 150 ? 95 : d < 260 ? 45 : 0;
        const dangerBonus = tower.type === "blade" || tower.type === "spear" ? 18 : 0;
        candidates.push({ type: "tower", x: tower.x, y: tower.y, radius: TOWER_COLLISION_RADIUS, object: tower, score: d - proximityBonus - dangerBonus });
    });

    (barricades || []).forEach(b => {
        if (!b || !b.active || b.hp <= 0 || b.isOpen) return;
        const closest = getClosestPointOnBarricade(enemy.x, enemy.y, b);
        const d = Math.hypot(enemy.x - closest.x, enemy.y - closest.y);
        const proximityBonus = d < 120 ? 85 : d < 220 ? 38 : 0;
        candidates.push({ type: "barricade", x: closest.x, y: closest.y, radius: 12, object: b, score: d - proximityBonus });
    });

    (mines || []).forEach(mine => {
        if (!mine || mine.hp <= 0) return;
        const d = Math.hypot(enemy.x - mine.x, enemy.y - mine.y);
        // Las minas importan si el enemigo las tiene cerca, pero no reemplazan siempre al jugador/base.
        const proximityBonus = d < 125 ? 78 : d < 220 ? 34 : 0;
        const greedBonus = player?.minesAttractEnemies && enemy.special ? 110 : 0;
        candidates.push({ type: "mine", x: mine.x, y: mine.y, radius: mine.radius || MINE_COLLISION_RADIUS, object: mine, score: d - proximityBonus - greedBonus });
    });

    if (!candidates.length) return { type: "player", x: player.x, y: player.y, radius: 23, object: player };
    candidates.sort((a, b) => a.score - b.score);
    return candidates[0];
}

function getHealerSupportTarget(healer) {
    let best = null;
    let bestScore = -Infinity;

    (enemies || []).forEach(other => {
        if (!other || other === healer || other.hp <= 0 || other.special === "healer") return;
        const dist = Math.hypot(other.x - healer.x, other.y - healer.y);
        const missingRatio = Math.max(0, 1 - other.hp / Math.max(1, other.maxHp || 1));
        const allyWeight = other.isBoss ? 5 : other.special ? 2.2 : 1;
        const score = missingRatio * 120 * allyWeight - dist * 0.12 + Math.min(35, (healer.healRadius || 180) / Math.max(1, dist));
        if (score > bestScore) {
            bestScore = score;
            best = other;
        }
    });

    if (!best) {
        (enemies || []).forEach(other => {
            if (!other || other === healer || other.hp <= 0 || other.special === "healer") return;
            const dist = Math.hypot(other.x - healer.x, other.y - healer.y);
            const score = -dist + (other.isBoss ? 350 : other.special ? 120 : 0);
            if (score > bestScore) {
                bestScore = score;
                best = other;
            }
        });
    }

    if (!best) return null;
    return { type: "ally", x: best.x, y: best.y, radius: Math.max(70, (healer.healRadius || 180) * 0.42), object: best };
}

function updateHealerMovementOnly(enemy, mainTarget) {
    // El clérigo/sanador es 100% soporte: sigue aliados y cura, pero nunca ataca
    // al jugador, torres, murallas ni base. Esto evita daño fantasma cuando llega
    // al radio de su objetivo aliado.
    enemy.target = "ally";
    enemy.isAttacking = false;

    if (!mainTarget || mainTarget.type !== "ally") return false;

    const dx = mainTarget.x - enemy.x;
    const dy = mainTarget.y - enemy.y;
    const distance = Math.hypot(dx, dy);
    const keepDistance = Math.max(42, Math.min(95, (enemy.healRadius || 180) * 0.36));

    if (distance > keepDistance) {
        const nx = dx / (distance || 1);
        const ny = dy / (distance || 1);
        enemy.x += nx * enemy.speed * gameSpeed * frameScale;
        enemy.y += ny * enemy.speed * gameSpeed * frameScale;
        enemy.x = clampWorldX(enemy.x, enemy.radius + 3);
        enemy.y = clampWorldY(enemy.y, enemy.radius + 3);
    }

    return true;
}

function getBlockingBarricadeForEnemy(enemy, targetX, targetY) {
    let best = null;
    let bestDist = Infinity;
    (barricades || []).forEach(b => {
        if (!b.active || b.hp <= 0 || b.isOpen) return;
        if (circleIntersectsBarricade(enemy.x, enemy.y, (enemy.radius || 18) + 7, b, 0)) {
            const contact = getBarricadeContactInfo(enemy, b);
            const targetDist = Math.hypot(targetX - (contact?.closestX ?? b.x), targetY - (contact?.closestY ?? b.y));
            if (targetDist < bestDist) { best = b; bestDist = targetDist; }
        }
    });
    return best;
}


function getBarricadeContactInfo(enemy, barricade) {
    if (!enemy || !barricade) return null;
    if (isDiagonalBarricade(barricade.orientation || "horizontal")) {
        const seg = getBarricadeSegment(barricade);
        const hit = distancePointToSegment(enemy.x, enemy.y, seg.x1, seg.y1, seg.x2, seg.y2);
        const dx = enemy.x - hit.closestX;
        const dy = enemy.y - hit.closestY;
        return { rect: getEntityRect({ ...barricade, isBuildBarricade: true }), closestX: hit.closestX, closestY: hit.closestY, dx, dy, distance: hit.distance, isCorner: hit.t <= 0.05 || hit.t >= 0.95 };
    }
    const rect = getEntityRect({ ...barricade, isBuildBarricade: true });
    const closestX = Math.max(rect.left, Math.min(rect.right, enemy.x));
    const closestY = Math.max(rect.top, Math.min(rect.bottom, enemy.y));
    const dx = enemy.x - closestX;
    const dy = enemy.y - closestY;
    const distance = Math.hypot(dx, dy);
    const onVerticalEdge = closestX === rect.left || closestX === rect.right;
    const onHorizontalEdge = closestY === rect.top || closestY === rect.bottom;
    return { rect, closestX, closestY, dx, dy, distance, isCorner: onVerticalEdge && onHorizontalEdge };
}

function isEnemyPositionBlockedBySolid(enemy, x, y, ignoredBarricade = null) {
    if (!enemy) return true;
    const radius = (enemy.radius || 18) + 3;

    if ((barricades || []).some(b => {
        if (!b || b === ignoredBarricade || !b.active || b.hp <= 0 || b.isOpen) return false;
        return circleIntersectsBarricade(x, y, radius, b, 0);
    })) return true;

    if ((towers || []).some(t => t && t.owned && t.hp > 0 && Math.hypot(t.x - x, t.y - y) < TOWER_COLLISION_RADIUS + radius)) return true;
    if ((mines || []).some(m => m && m.hp > 0 && Math.hypot(m.x - x, m.y - y) < (m.radius || MINE_COLLISION_RADIUS) + radius)) return true;
    if (baseCore && basePlaced && baseCore.hp > 0 && Math.hypot(baseCore.x - x, baseCore.y - y) < BASE_RADIUS + radius) return true;

    return false;
}

function getPlayerBaseProtectedRadius() {
    // Zona de respeto de la base: los enemigos míticos pueden asediar desde fuera,
    // pero no deben teletransportarse ni aparecer adentro de la fortaleza.
    if (!baseCore || !basePlaced || baseCore.hp <= 0) return 0;
    let radius = 245;

    (barricades || []).forEach(b => {
        if (!b || !b.active || b.hp <= 0) return;
        const dist = Math.hypot(b.x - baseCore.x, b.y - baseCore.y);
        if (dist < 430) radius = Math.max(radius, dist + 72);
    });

    (towers || []).forEach(t => {
        if (!t || !t.owned || t.hp <= 0) return;
        const dist = Math.hypot(t.x - baseCore.x, t.y - baseCore.y);
        if (dist < 380) radius = Math.max(radius, dist + 76);
    });

    (mines || []).forEach(m => {
        if (!m || m.hp <= 0) return;
        const dist = Math.hypot(m.x - baseCore.x, m.y - baseCore.y);
        if (dist < 360) radius = Math.max(radius, dist + 72);
    });

    return Math.min(520, radius);
}

function isInsidePlayerBaseProtectedZone(x, y, extra = 0) {
    if (!baseCore || !basePlaced || baseCore.hp <= 0) return false;
    return Math.hypot(x - baseCore.x, y - baseCore.y) < getPlayerBaseProtectedRadius() + extra;
}

function pushPointOutsidePlayerBaseZone(x, y, extra = 0) {
    if (!baseCore || !basePlaced || baseCore.hp <= 0) return { x, y };
    const safeRadius = getPlayerBaseProtectedRadius() + extra;
    const dx = x - baseCore.x;
    const dy = y - baseCore.y;
    const dist = Math.hypot(dx, dy) || 1;
    if (dist >= safeRadius) return { x, y };
    const nx = dx / dist;
    const ny = dy / dist;
    return {
        x: clampWorldX(baseCore.x + nx * safeRadius, 46),
        y: clampWorldY(baseCore.y + ny * safeRadius, 46)
    };
}

function isMythicTeleportForbidden(enemy, x, y) {
    if (isInsidePlayerBaseProtectedZone(x, y, (enemy?.radius || 28) + 18)) return true;
    return isEnemyPositionBlockedBySolid(enemy || { radius: 28 }, x, y);
}

function getSafeMythicTeleportPoint(enemy, wantedX, wantedY, oldX = null, oldY = null) {
    let point = pushPointOutsidePlayerBaseZone(wantedX, wantedY, (enemy?.radius || 28) + 42);
    point.x = clampWorldX(point.x, (enemy?.radius || 28) + 6);
    point.y = clampWorldY(point.y, (enemy?.radius || 28) + 6);

    if (!isMythicTeleportForbidden(enemy, point.x, point.y)) return point;

    const originX = Number.isFinite(oldX) ? oldX : (enemy?.x || point.x);
    const originY = Number.isFinite(oldY) ? oldY : (enemy?.y || point.y);
    const baseAngle = Math.atan2(point.y - originY, point.x - originX);
    const attempts = [0, 0.45, -0.45, 0.9, -0.9, Math.PI, Math.PI * 0.65, -Math.PI * 0.65];

    for (const offset of attempts) {
        const angle = baseAngle + offset;
        for (const dist of [70, 120, 180, 250]) {
            const candidate = pushPointOutsidePlayerBaseZone(
                originX + Math.cos(angle) * dist,
                originY + Math.sin(angle) * dist,
                (enemy?.radius || 28) + 42
            );
            candidate.x = clampWorldX(candidate.x, (enemy?.radius || 28) + 6);
            candidate.y = clampWorldY(candidate.y, (enemy?.radius || 28) + 6);
            if (!isMythicTeleportForbidden(enemy, candidate.x, candidate.y)) return candidate;
        }
    }

    return { x: originX, y: originY };
}

function enforceTitanOutsidePlayerBase(enemy) {
    if (!enemy || enemy.special !== "doombringer" || enemy.hp <= 0) return;
    if (!isInsidePlayerBaseProtectedZone(enemy.x, enemy.y, (enemy.radius || 34) + 8)) return;
    const safe = pushPointOutsidePlayerBaseZone(enemy.x, enemy.y, (enemy.radius || 34) + 54);
    if (!isEnemyPositionBlockedBySolid(enemy, safe.x, safe.y)) {
        effects.push({ type: "line", x1: enemy.x, y1: enemy.y, x2: safe.x, y2: safe.y, life: 14, color: "#111111" });
        enemy.x = safe.x;
        enemy.y = safe.y;
        enemy.knockbackX = 0;
    }
}


function trySlideEnemyAlongBarricade(enemy, barricade, targetX, targetY) {
    if (!enemy || !barricade) return false;
    const info = getBarricadeContactInfo(enemy, barricade);
    if (!info || !info.isCorner) return false;

    const normalLength = Math.hypot(info.dx, info.dy) || 1;
    const nx = info.dx / normalLength;
    const ny = info.dy / normalLength;
    const moveAmount = Math.max(0.4, enemy.speed * gameSpeed * frameScale * 1.05);

    const candidates = [
        { x: -ny, y: nx },
        { x: ny, y: -nx },
        { x: Math.sign(targetX - enemy.x) || 0, y: 0 },
        { x: 0, y: Math.sign(targetY - enemy.y) || 0 }
    ].filter(v => v.x || v.y);

    candidates.sort((a, b) => {
        const ax = enemy.x + a.x * moveAmount;
        const ay = enemy.y + a.y * moveAmount;
        const bx = enemy.x + b.x * moveAmount;
        const by = enemy.y + b.y * moveAmount;
        return Math.hypot(targetX - ax, targetY - ay) - Math.hypot(targetX - bx, targetY - by);
    });

    for (const candidate of candidates) {
        const len = Math.hypot(candidate.x, candidate.y) || 1;
        let nextX = clampWorldX(enemy.x + (candidate.x / len) * moveAmount, enemy.radius + 3);
        let nextY = clampWorldY(enemy.y + (candidate.y / len) * moveAmount, enemy.radius + 3);

        // Mantiene al enemigo afuera de la muralla mientras resbala por la esquina.
        const nextInfo = getBarricadeContactInfo({ ...enemy, x: nextX, y: nextY }, barricade);
        const minDistance = (enemy.radius || 18) + 6;
        if (nextInfo && nextInfo.distance < minDistance) {
            const pushLength = Math.hypot(nextInfo.dx, nextInfo.dy) || 1;
            nextX += (nextInfo.dx / pushLength) * (minDistance - nextInfo.distance);
            nextY += (nextInfo.dy / pushLength) * (minDistance - nextInfo.distance);
            nextX = clampWorldX(nextX, enemy.radius + 3);
            nextY = clampWorldY(nextY, enemy.radius + 3);
        }

        if (!isEnemyPositionBlockedBySolid(enemy, nextX, nextY, barricade)) {
            enemy.x = nextX;
            enemy.y = nextY;
            enemy.isAttacking = false;
            enemy.target = "sliding";
            return true;
        }
    }

    return false;
}

function getBlockingMineForEnemy(enemy) {
    let best = null;
    let bestDist = Infinity;
    (mines || []).forEach(mine => {
        if (!mine || mine.hp <= 0) return;
        const d = Math.hypot(enemy.x - mine.x, enemy.y - mine.y);
        const touchDistance = (enemy.radius || 12) + (mine.radius || MINE_COLLISION_RADIUS) + 5;
        if (d <= touchDistance && d < bestDist) {
            best = mine;
            bestDist = d;
        }
    });
    return best;
}


function stealFromMine(enemy, mine) {
    if (!enemy || !mine || mine.hp <= 0) return;
    const stolen = Math.min(coins, Math.max(1, Math.ceil(2 + wave * 0.12)));
    coins -= stolen;
    enemy.robbedGold = (enemy.robbedGold || 0) + stolen;
    mine.lastHitAt = getGameTime();
    if (runStats) runStats.minesDamagedThisWave++;
    updateMissionFailure("minesSafe");
    addDamageText(mine.x, mine.y - 28, `-${formatMoney(stolen)} oro`, false, "#ffd84a");
    createImpactParticles(mine.x, mine.y, "#ffd84a");
    updateMissionFailure("minesSafe");
    updateHud(true);
}
function damageMine(mine, amount, sourceEnemy = null) {
    if (!mine || mine.hp <= 0) return;

    if (player && player.immortal) {
        createImpactParticles(mine.x, mine.y, "#ffe28a");
        return;
    }

    const isVisitorProjectile = !!(sourceEnemy && (sourceEnemy.isVisitorProjectile || sourceEnemy.sourceSpecial === "visitor"));
    const finalAmount = isVisitorProjectile ? amount * 0.75 : ((sourceEnemy && (sourceEnemy.isBoss || sourceEnemy.isBossProjectile)) ? amount * 1.15 : amount);
    mine.hp -= finalAmount;
    awardVisitorGold(finalAmount);
    mine.lastHitAt = getGameTime();
    createImpactParticles(mine.x, mine.y, sourceEnemy && sourceEnemy.color ? sourceEnemy.color : "#ff7777");
    addDamageText(mine.x, mine.y - 24, finalAmount, false, "#ff7777");

    if (mine.hp <= 0) {
        mine.hp = 0;
        const name = mine.name || "Mina";
        mines = (mines || []).filter(m => m !== mine);
        costs.mineGold = getMineCostForCount((mines || []).length);
        showCenterMessage(`¡${name} destruida!`, 900);
        updateHud(true);
        autoSaveRun(true);
    }
}

function damageBase(amount, x = baseCore ? baseCore.x : 0, y = baseCore ? baseCore.y : 0) {
    if (!baseCore || !basePlaced) return false;
    baseCore.hp -= amount;
    awardVisitorGold(amount);
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

function getCameraZoom() {
    return Math.max(CAMERA_MIN_ZOOM, Math.min(CAMERA_MAX_ZOOM, Number(camera?.zoom) || 1));
}

function getCameraVisibleWidth() {
    return GAME_WIDTH / getCameraZoom();
}

function getCameraVisibleHeight() {
    return GAME_HEIGHT / getCameraZoom();
}

function clampCameraToWorld() {
    const visibleWidth = getCameraVisibleWidth();
    const visibleHeight = getCameraVisibleHeight();
    camera.x = Math.max(0, Math.min(Math.max(0, WORLD_WIDTH - visibleWidth), camera.x));
    camera.y = Math.max(0, Math.min(Math.max(0, WORLD_HEIGHT - visibleHeight), camera.y));
}

function setCameraZoom(nextZoom, anchorScreenX = GAME_WIDTH / 2, anchorScreenY = GAME_HEIGHT / 2) {
    const oldZoom = getCameraZoom();
    const zoom = Math.max(CAMERA_MIN_ZOOM, Math.min(CAMERA_MAX_ZOOM, Number(nextZoom) || oldZoom));
    if (Math.abs(zoom - oldZoom) < 0.001) return;

    // Mantiene el punto bajo el mouse lo más estable posible al cambiar zoom.
    const worldAnchorX = camera.x + anchorScreenX / oldZoom;
    const worldAnchorY = camera.y + anchorScreenY / oldZoom;
    camera.zoom = zoom;
    camera.x = worldAnchorX - anchorScreenX / zoom;
    camera.y = worldAnchorY - anchorScreenY / zoom;
    clampCameraToWorld();
    localStorage.setItem("tdCameraZoom", String(camera.zoom));
}

function getWorldToScreenPoint(worldX, worldY) {
    const zoom = getCameraZoom();
    return {
        x: (worldX - camera.x) * zoom,
        y: (worldY - camera.y) * zoom
    };
}

function updateCamera() {
    if (!player) return;
    camera.zoom = getCameraZoom();
    const visibleWidth = getCameraVisibleWidth();
    const visibleHeight = getCameraVisibleHeight();
    camera.x = player.x - visibleWidth / 2;
    camera.y = player.y - visibleHeight / 2;
    clampCameraToWorld();
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

function healDefensesAndPlayer(amount, sourceX = null, sourceY = null) {
    let remaining = amount;
    const sx = Number.isFinite(sourceX) ? sourceX : (player ? player.x : WORLD_WIDTH / 2);
    const sy = Number.isFinite(sourceY) ? sourceY : (player ? player.y : WORLD_HEIGHT / 2);
    const candidates = [];

    (barricades || []).forEach(b => {
        if (b.active && b.hp > 0 && b.hp < b.maxHp) candidates.push({ kind: "barricade", object: b, x: b.x, y: b.y, missing: b.maxHp - b.hp });
    });
    (towers || []).forEach(t => {
        if (t.owned && t.hp > 0 && t.hp < t.maxHp) candidates.push({ kind: "tower", object: t, x: t.x, y: t.y, missing: t.maxHp - t.hp });
    });
    if (baseCore && basePlaced && baseCore.hp > 0 && baseCore.hp < baseCore.maxHp) candidates.push({ kind: "base", object: baseCore, x: baseCore.x, y: baseCore.y, missing: baseCore.maxHp - baseCore.hp });
    if (player && player.hp < player.maxHp) candidates.push({ kind: "player", object: player, x: player.x, y: player.y, missing: player.maxHp - player.hp });

    candidates.sort((a, b) => Math.hypot(a.x - sx, a.y - sy) - Math.hypot(b.x - sx, b.y - sy));

    for (const candidate of candidates) {
        if (remaining <= 0) break;
        const heal = Math.min(candidate.missing, remaining);
        if (candidate.kind === "player") candidate.object.hp = Math.min(candidate.object.maxHp, candidate.object.hp + heal);
        else candidate.object.hp = Math.min(candidate.object.maxHp, candidate.object.hp + heal);
        remaining -= heal;
        effects.push({ type: "line", x1: sx, y1: sy, x2: candidate.x, y2: candidate.y, life: 9, color: "#ff5d86" });
    }
}

function damageBarricade(b, amount, sourceEnemy = null) {
    if (!b || !b.active || b.hp <= 0) return;

    if (player && player.immortal) {
        createImpactParticles(b.x, sourceEnemy ? sourceEnemy.y : GAME_HEIGHT / 2, "#ffe28a");
        return;
    }

    const isVisitorProjectile = !!(sourceEnemy && (sourceEnemy.isVisitorProjectile || sourceEnemy.sourceSpecial === "visitor"));
    const isBossDamage = !!(sourceEnemy && (sourceEnemy.isBoss || sourceEnemy.isBossProjectile));
    const finalAmount = isVisitorProjectile ? amount * 0.72 : (isBossDamage ? amount * BOSS_BARRICADE_DAMAGE_MULTIPLIER : amount);

    b.hp -= finalAmount;
    awardVisitorGold(finalAmount);

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
        if (runStats) runStats.barricadesLostThisWave++;
        updateMissionFailure("barricadesSafe");
    }
}

function getDamageSourceName(sourceEnemy = null, fallback = "daño desconocido") {
    if (!sourceEnemy) return fallback;
    if (sourceEnemy.deathName) return sourceEnemy.deathName;
    if (sourceEnemy.name) return sourceEnemy.name;
    if (sourceEnemy.isBossProjectile) return sourceEnemy.burn ? "proyectil ardiente de jefe" : "proyectil de jefe";
    if (sourceEnemy.special === "doombringer") return "Titán Negro";
    if (sourceEnemy.special) return sourceEnemy.special;
    return fallback;
}

function setLastDeathCause(sourceEnemy = null, fallback = "daño desconocido") {
    lastDeathCause = getDamageSourceName(sourceEnemy, fallback);
}

function damagePlayer(amount, sourceEnemy = null, impactX = player ? player.x : 35, impactY = player ? player.y : GAME_HEIGHT / 2, blockedMessage = "¡Golpe bloqueado!") {
    if (!player || player.hp <= 0) return false;
    if ((player.bloodShield || 0) > 0) { const blocked = Math.min(player.bloodShield, amount); player.bloodShield -= blocked; amount -= blocked; if (amount <= 0) { addDamageText(player.x, player.y - 28, "escudo", false, "#d71945"); return false; } }

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
    awardVisitorGold(amount);
    if (runStats) runStats.playerDamageTakenThisWave += amount;
    updateMissionFailure("noPlayerDamage");
    player.hurtUntil = getGameTime() + 280;
    triggerRedFlash();
    createImpactParticles(impactX, impactY, sourceEnemy && sourceEnemy.color ? sourceEnemy.color : "#ff4444");

    if (player.hp <= 0) {
        if (player.deathSaveAvailable) {
            player.deathSaveAvailable = false;
            player.hp = 1;
            effects.push({ type: "circle", x: player.x, y: player.y, radius: 10, maxRadius: 180, life: 36, color: "#ffffff" });
            enemies.forEach(enemy => damageEnemy(enemy, 25 + wave * 1.2, false, "#ffffff", "ability"));
            showCenterMessage("Contrato Roto", 1200);
            return false;
        }
        player.hp = 0;
        player.deathStartedAt = getGameTime();
        setLastDeathCause(sourceEnemy, "daño enemigo");
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

function setCostText(element, value, isFree = false) {
    if (!element) return;
    element.textContent = isFree ? "Gratis" : formatMoney(value);
    element.classList.toggle("freeCost", Boolean(isFree));

    const currencyLabel = element.nextElementSibling;
    if (currencyLabel && currencyLabel.classList && currencyLabel.classList.contains("currencyLabel")) {
        currencyLabel.classList.toggle("hiddenCurrency", Boolean(isFree));
    }
}

function hasFreeTowerPurchase(defKey) {
    return getFreeTowerCount(defKey) > 0 || getFreeAnyConstructionCount() > 0;
}

function hasFreeBarricadePurchase(kind = "standard") {
    return (kind === "standard" && getFreeBarricadeCount() > 0) || getFreeAnyConstructionCount() > 0;
}

function hasFreeTrapPurchase() {
    return getFreeAnyConstructionCount() > 0;
}

function hasFreeMinePurchase() {
    return getFreeMineCount() > 0 || getFreeAnyConstructionCount() > 0;
}

function formatMissingMoney(value) {
    return formatMoney(Math.max(0, value));
}

function ensureOverlayCoinsPanel() {
    if (!shop) return null;
    let panel = document.getElementById("overlayCoinsPanel");
    if (!panel) {
        panel = document.createElement("div");
        panel.id = "overlayCoinsPanel";
        panel.className = "overlayCoinsPanel";
        panel.innerHTML = `<img src="assets/sprites/coin.gif" alt="Monedas" onerror="this.style.display='none'"><strong>0</strong>`;
        shop.appendChild(panel);
    }
    return panel;
}

function scaleStatCost(currentCost, earlyMultiplier) {
    // Early mantiene el precio actual, late suaviza fuerte para que el juego pueda escalar a miles de oleadas.
    return scaleShopCost(currentCost, earlyMultiplier, 1.055, 1600);
}

function scaleConsumableCost(currentCost, earlyMultiplier) {
    return scaleShopCost(currentCost, earlyMultiplier, 1.035, 1200);
}

function scaleBarricadeCost(currentCost, earlyMultiplier) {
    // Los muros escalan más fuerte que otros upgrades para que llegar a Obsidiana
    // sea una decisión de inversión, no algo automático en pocas rondas.
    return scaleShopCost(currentCost, earlyMultiplier, 1.085, 2200);
}

function scaleTowerUpgradeCost(currentCost) {
    return scaleShopCost(currentCost, 1.42, 1.055, 1500);
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

function isTrapPositionValid(x, y) {
    const trapRect = getEntityRect({ x, y, radius: TRAP_COLLISION_RADIUS });
    if (!isBuildRectInsideWorld(trapRect)) return false;
    if (isCircleInBossSpawnZone(x, y, TRAP_COLLISION_RADIUS, 8)) return false;
    if (player && Math.hypot(x - player.x, y - player.y) < TRAP_COLLISION_RADIUS + 24) return false;
    if (buildCircleOverlapsEnemy(x, y, TRAP_COLLISION_RADIUS, 8)) return false;
    if ((towers || []).some(t => Math.hypot(t.x - x, t.y - y) < TOWER_COLLISION_RADIUS + TRAP_COLLISION_RADIUS + 6)) return false;
    if ((barricades || []).some(b => b.active && b.hp > 0 && !b.isOpen && circleIntersectsBarricade(x, y, TRAP_COLLISION_RADIUS + 4, b, 0))) return false;
    if ((traps || []).some(trap => Math.hypot(trap.x - x, trap.y - y) < TRAP_COLLISION_RADIUS * 2 + 4)) return false;
    if ((mines || []).some(mine => Math.hypot(mine.x - x, mine.y - y) < MINE_COLLISION_RADIUS + TRAP_COLLISION_RADIUS + 6)) return false;
    return true;
}

function getMineCostForCount(count = (mines || []).length) {
    const safeCount = Math.max(0, Math.min(MINE_LIMIT, Math.floor(Number(count) || 0)));
    if (safeCount >= MINE_LIMIT) return 0;
    return Math.ceil((FIRST_MINE_COST * Math.pow(MINE_COST_MULTIPLIER, safeCount)) / 10) * 10;
}

function getMineIncomeForWave(targetWave = wave) {
    const safeWave = Math.max(1, Number(targetWave) || 1);
    // Mina estable: más retorno temprano/medio, curva plana en late.
    // Importante: no usa currentGoldMultiplier, el multiplicador late-game global
    // ni el nerf de oro por repetir. Las minas son inversión fija y siempre pagan normal.
    const baseIncome = 28 + Math.floor(Math.sqrt(safeWave) * 5);
    return Math.ceil(baseIncome * BUILD_ECONOMY_GOLD_MULTIPLIER);
}

function isMinePositionValid(x, y) {
    const mineRect = getEntityRect({ x, y, radius: MINE_COLLISION_RADIUS });
    if (!isBuildRectInsideWorld(mineRect)) return false;
    if (isCircleInBossSpawnZone(x, y, MINE_COLLISION_RADIUS, 8)) return false;
    if (player && Math.hypot(x - player.x, y - player.y) < MINE_COLLISION_RADIUS + 24) return false;
    if (baseCore && Math.hypot(x - baseCore.x, y - baseCore.y) < BASE_RADIUS + MINE_COLLISION_RADIUS + 18) return false;
    if (buildCircleOverlapsEnemy(x, y, MINE_COLLISION_RADIUS, 10)) return false;
    if ((towers || []).some(t => Math.hypot(t.x - x, t.y - y) < TOWER_COLLISION_RADIUS + MINE_COLLISION_RADIUS + 8)) return false;
    if ((barricades || []).some(b => b.active && b.hp > 0 && !b.isOpen && circleIntersectsBarricade(x, y, MINE_COLLISION_RADIUS + 6, b, 0))) return false;
    if ((traps || []).some(trap => Math.hypot(trap.x - x, trap.y - y) < TRAP_COLLISION_RADIUS + MINE_COLLISION_RADIUS + 6)) return false;
    if ((mines || []).some(mine => Math.hypot(mine.x - x, mine.y - y) < MINE_COLLISION_RADIUS * 2 + 10)) return false;
    return true;
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
        rotation: Number(def.rotation) || towerBuildRotation || 0,
        slotIndex: towers.length,
        level: 1,
        lastShotTime: 0,
        spent: paidCost,
        upgradeCost: def.upgradeCost || Math.floor(def.cost * 1.35),
        maxHp: def.maxHp || getTowerBaseMaxHp(def),
        hp: def.maxHp || getTowerBaseMaxHp(def),
        damageMultiplier: 1,
        fireDelayMultiplier: 1,
        activePoisonZoneExpiresAt: 0,
        activeSlowZoneNextShotAt: 0
    };
}

function beginTowerPlacement(defKey) {
    if (!canStartBuildPlacement("construir torres")) return;
    if (towers.length >= towerSlotLimit) {
        showCenterMessage("Límite de slots de torre alcanzado", 900, "minor");
        return;
    }

    const def = getTowerDefinition(defKey);
    if (!def) return;

    const hasFreeStarter = hasFreeTowerPurchase(def.key);
    const price = hasFreeStarter ? 0 : getEffectiveCost(costs[def.key] ?? def.cost, "towers");
    if (coins < price) {
        showCenterMessage("Monedas insuficientes", 800, "minor");
        return;
    }

    clearStructureSelection();
    pendingTowerPurchase = { defKey, price, freeStarter: hasFreeStarter };
    towerBuildRotation = 0;
    pendingBarricadePlacement = null;
    pendingMinePlacement = null;
    closeShop();
    waveSummaryPanel.classList.add("hidden");
    showCenterMessage(`Colocá: ${def.name} · seguí colocando o cancelá`, 1100, "minor");
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
    showCenterMessage(`Mové: ${tower.name}`, 900, "minor");
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
        showCenterMessage("Lugar ocupado o inválido", 700, "minor");
        return;
    }

    tower.x = tile.x;
    tower.y = tile.y;
    pendingTowerMoveIndex = null;
    updateBuildCancelUI();
    showCenterMessage(`${tower.name} movida`, 750, "minor");
    updateHud(true);
    autoSaveRun(true);
}

function finishTowerPlacement(tile) {
    if (!pendingTowerPurchase || !isTowerTileAvailable(tile)) {
        showCenterMessage("Lugar ocupado o inválido", 700, "minor");
        return;
    }

    const originalDefKey = pendingTowerPurchase.defKey;
    let def = getTowerDefinition(originalDefKey);
    if (!def) {
        cancelTowerPlacement(false);
        return;
    }

    const hasFreeStarter = getFreeTowerCount(originalDefKey) > 0 || getFreeAnyConstructionCount() > 0;
    const price = hasFreeStarter ? 0 : getEffectiveCost(costs[originalDefKey] ?? def.cost, "towers");
    if (coins < price) {
        showCenterMessage("Monedas insuficientes", 800, "minor");
        cancelTowerPlacement(false);
        return;
    }

    if (towers.length >= towerSlotLimit) {
        showCenterMessage("Límite de slots de torre alcanzado", 900, "minor");
        cancelTowerPlacement(false);
        return;
    }

    if (hasFreeStarter) consumeFreeConstructionCharge("tower", originalDefKey);
    else coins -= price;

    if (def.type === "lucky") {
        const options = towerDefinitions.filter(t => t.type !== "lucky");
        def = options[Math.floor(Math.random() * options.length)];
        showCenterMessage(`Lucky Block: te tocó ${def.name}`, 1300, "lucky");
    } else {
        showCenterMessage(`${def.name} colocada · seguí colocando o cancelá`, 900, "minor");
    }

    def = { ...def, rotation: towerBuildRotation };
    const tower = createTowerFromDefinition(def, price, tile);
    if (!tower) {
        coins += price;
        showCenterMessage("No se pudo colocar", 800, "minor");
        return;
    }

    towers.push(tower);
    if (runStats) runStats.structuresBuiltThisWave++;
    if (activeSideMission?.type === "buildAction") addMissionProgress(1);

    const nextHasFreeStarter = getFreeTowerCount(originalDefKey) > 0 || getFreeAnyConstructionCount() > 0;
    const nextPrice = nextHasFreeStarter ? 0 : getEffectiveCost(costs[originalDefKey] ?? getTowerDefinition(originalDefKey)?.cost ?? price, "towers");
    if (towers.length >= towerSlotLimit || coins < nextPrice) {
        pendingTowerPurchase = null;
        showCenterMessage(towers.length >= towerSlotLimit ? "Límite de torres alcanzado" : "Sin monedas para otra torre", 900, "minor");
    } else {
        pendingTowerPurchase = { defKey: originalDefKey, price: nextPrice, freeStarter: nextHasFreeStarter };
    }

    updateBuildCancelUI();
    updateHud(true);
    autoSaveRun(true);
}

function getLateGameGoldMultiplier() {
    if (wave <= 45) return 1;

    // Curva infinita suave: no explota en early, pero en oleadas muy altas acompaña upgrades largos.
    const lateWave = wave - 45;
    const logBoost = Math.log10(lateWave + 10);
    const rootBoost = Math.pow(lateWave / 55, 0.42);
    return 1 + logBoost * 0.62 + rootBoost * 1.25;
}

function getWaveRewardBonus() {
    // Hotfix economía: el bonus de wave acompaña mejor el costo de torres, barricadas y reparaciones.
    // completeWave() suma 8 + este valor, así que en early queda parecido a: 8 + wave * 3.
    if (wave < 40) return Math.floor(wave * 3);
    return Math.floor(40 * 3 + Math.pow(wave - 39, 0.78) * 4.2);
}

function getEnemyRewardForWave(baseReward) {
    if (wave < 40) return baseReward + Math.floor(wave * 0.52);
    return baseReward + Math.floor(21 + Math.pow(wave - 39, 0.74) * 1.08);
}

function getBossRewardForWave(baseReward) {
    // Bosses ahora pagan mejor: siguen siendo amenaza, pero también una oportunidad real de recuperarse.
    const reward = wave < 40
        ? baseReward + wave * 9
        : baseReward + Math.floor(285 + Math.pow(wave, 0.80) * 8.4);
    return Math.ceil(reward * 1.12);
}

function getGoldAmount(amount) {
    return Math.ceil(amount * BUILD_ECONOMY_GOLD_MULTIPLIER * PLAYER_ECONOMY_GOLD_MULTIPLIER * currentGoldMultiplier * getLateGameGoldMultiplier() * (player?.goldBonusMultiplier || 1));
}

function getPlayerCostMultiplier(category) {
    if (!player) return 1;
    const classMult = player.classCostMultipliers?.[category] || 1;
    const structureMult = ["towers", "barricades", "traps", "mines"].includes(category) ? (player.structureCostMultiplier || 1) : 1;
    return classMult * structureMult;
}

function getEffectiveCost(rawCost, category = "general") {
    return Math.max(0, Math.ceil((Number(rawCost) || 0) * getPlayerCostMultiplier(category)));
}

function spendCoins(rawCost, category = "general") {
    const cost = getEffectiveCost(rawCost, category);
    if (coins < cost) return false;
    coins -= cost;
    return true;
}


function getRepeatEnemyStrengthMultiplier() {
    return isRepeatingWave ? REPEAT_ENEMY_STRENGTH_MULTIPLIER : 1;
}

function scaleEnemyDamageForRepeat(damage) {
    const base = Number(damage) || 0;
    if (!isRepeatingWave) return base;
    return Math.max(1, Math.ceil(base * REPEAT_ENEMY_STRENGTH_MULTIPLIER));
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

function getRepeatTargetWave() {
    if (buildPhaseActive) return Math.max(1, (Number(wave) || 1) - 1);
    return Math.max(1, Number(wave) || 1);
}

function getRepeatCountForWave(targetWave = getRepeatTargetWave()) {
    const key = Math.max(1, Math.floor(Number(targetWave) || 1));
    const clamped = clampRepeatCount(repeatCountsByWave[key]);
    repeatCountsByWave[key] = clamped;
    return clamped;
}

function getRepeatCountForCurrentWave() {
    return getRepeatCountForWave(getRepeatTargetWave());
}

function updateAutoRepeatWaveButton() {
    if (!autoRepeatWaveBtn) return;
    const targetWave = getRepeatTargetWave();
    const repeats = getRepeatCountForWave(targetWave);
    const atLimit = repeats >= REPEAT_LIMIT_PER_WAVE;

    if (atLimit && autoRepeatWaveMode) {
        autoRepeatWaveMode = false;
    }

    autoRepeatWaveBtn.textContent = autoRepeatWaveMode
        ? `Auto repetir ON (${repeats}/${REPEAT_LIMIT_PER_WAVE})`
        : `Auto repetir OFF`;
    autoRepeatWaveBtn.classList.toggle("autoActive", autoRepeatWaveMode);
    autoRepeatWaveBtn.disabled = atLimit && !waveInProgress && buildPhaseActive;
    autoRepeatWaveBtn.title = atLimit
        ? "Esta oleada ya alcanzó el máximo de 3 repeticiones."
        : "Repite automáticamente la misma oleada durante el descanso: enemigos +20% y 60% de oro. Máximo 3 veces por oleada.";
}

function canAutoRepeatTargetWave(targetWave = getRepeatTargetWave()) {
    return autoRepeatWaveMode && getRepeatCountForWave(targetWave) < REPEAT_LIMIT_PER_WAVE;
}

function prepareRepeatWave(targetWave, source = "manual") {
    const normalizedWave = Math.max(1, Math.floor(Number(targetWave) || 1));
    const repeats = getRepeatCountForWave(normalizedWave);
    if (repeats >= REPEAT_LIMIT_PER_WAVE) {
        if (source === "auto") {
            autoRepeatWaveMode = false;
            updateAutoRepeatWaveButton();
        }
        return false;
    }

    repeatCountsByWave[normalizedWave] = Math.min(REPEAT_LIMIT_PER_WAVE, repeats + 1);
    isRepeatingWave = true;
    currentGoldMultiplier = REPEAT_GOLD_MULTIPLIER;
    buildPhaseActive = false;
    buildPhaseEndsAt = 0;
    pausedBuildPhaseRemainingMs = 0;
    wave = normalizedWave;
    closeShop();
    clearStructureSelection();
    cancelBarricadePlacement(false);
    cancelTrapPlacement(false);
    cancelMinePlacement(false);
    cancelTowerPlacement(false);
    showCenterMessage(`${source === "auto" ? "Auto repitiendo" : "Repitiendo"} oleada ${normalizedWave}`, 900);
    startWave();
    return true;
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
    let mult = (tower.damageMultiplier || 1) * (player?.towerDamageMultiplier || 1);
    if (activeWaveEvent?.id === "mana_calm") mult *= 1.15;
    if (player?.cursedArchitecture && isTowerNearActiveBarricade(tower)) mult *= 1.18;
    return (tower.damage || 0) * mult;
}

function isTowerNearActiveBarricade(tower) {
    return (barricades || []).some(b => b && b.active && b.hp > 0 && Math.hypot((b.x||0)-tower.x, (b.y||0)-tower.y) < 155);
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
    const activePotionSteal = getGameTime() <= (player.lifeStealUntil || 0) ? (player.lifeStealPercent || 0) : 0;
    const permanentSteal = player.permanentLifeStealPercent || 0;
    const totalSteal = activePotionSteal + permanentSteal;
    if (totalSteal <= 0) return;
    const heal = Math.max(0, damageDone * totalSteal);
    if (heal > 0) healDefensesAndPlayer(heal);
}


function createEmptyRunStats() {
    return {
        damageDealt: 0, goldEarned: 0, kills: 0, bossKills: 0, missionsCompleted: 0,
        playerKills: 0, towerKills: 0, trapKills: 0, abilityKills: 0, specialKills: 0,
        bossPlayerDamage: 0, ccHits: 0, lowHpKills: 0, ramKills: 0,
        abilitiesUsedThisWave: 0, consumablesUsedThisWave: 0, playerDamageTakenThisWave: 0,
        minesDamagedThisWave: 0, barricadesLostThisWave: 0, structuresBuiltThisWave: 0,
        lastKillSource: "unknown", survivedEvents: []
    };
}

function getEffectiveInventorySlotCount() {
    return INVENTORY_SLOT_COUNT + Math.max(0, Number(player?.extraInventorySlots) || 0);
}

function applySelectedClassToRun() {
    activeClass = CLASS_DEFINITIONS[selectedClassKey] || CLASS_DEFINITIONS.errante;
    if (!player || !activeClass) return;
    activeClass.apply?.();
    player.color = activeClass.color;
    player.classColor = activeClass.color;
    player.classKey = selectedClassKey;
    player.name = `${player.name || playerName} · ${activeClass.name}`;
    updateClassSelectionUI();
}

function renderClassSelection() {
    if (!classCardsBox) return;
    classCardsBox.innerHTML = Object.entries(CLASS_DEFINITIONS).map(([key, def]) => `
        <button type="button" class="classCard ${key === selectedClassKey ? "selected" : ""} ${def.hard ? "hard" : ""}" data-class-key="${key}">
            <span class="classColor" style="--class-color:${def.color}"></span>
            <strong>${def.name}</strong>
            <small>${def.short}</small>
        </button>`).join("");
    updateClassSelectionUI();
}

function updateClassSelectionUI() {
    if (!classCardsBox) return;
    classCardsBox.querySelectorAll(".classCard").forEach(btn => btn.classList.toggle("selected", btn.dataset.classKey === selectedClassKey));
    const def = CLASS_DEFINITIONS[selectedClassKey] || CLASS_DEFINITIONS.errante;
    if (selectedClassInfo) selectedClassInfo.innerHTML = `
        <strong style="color:${def.color}">${def.name}</strong>
        <span class="classLore">${def.lore || def.short || ""}</span>
        <span class="classGrants"><b>Te da:</b> ${def.grants || "Sin ventajas especiales."}</span>
        <span class="classDrawback"><b>Pero:</b> ${def.drawback || "Sin desventajas."}</span>
    `;
}

function chooseClass(key) {
    if (!CLASS_DEFINITIONS[key]) return;
    if (gameStarted || hasActiveRun) {
        showCenterMessage("La clase se elige antes de iniciar", 900);
        return;
    }
    selectedClassKey = key;
    localStorage.setItem("ardentSelectedClass", selectedClassKey);
    updateClassSelectionUI();
}

function giveStartingTower(defKey) {
    const def = towerDefinitions.find(t => t.key === defKey);
    if (!def || !Array.isArray(towers)) return;
    const tile = getTowerTileAt(baseCore?.x ? baseCore.x + 95 : WORLD_WIDTH / 2 + 95, baseCore?.y || WORLD_HEIGHT / 2);
    if (!isTowerTileAvailable(tile)) return;
    const tower = createTowerFromDefinition(def, 0, tile);
    if (!tower) return;
    tower.freeStarter = true;
    tower.spent = 0;
    towers.push(tower);
}

function giveStartingBarricades(count = 1) {
    if (!Array.isArray(barricades)) return;
    for (let i = 0; i < count; i++) {
        const b = createFreeBarricade("standard", WORLD_WIDTH / 2 - 90 + i * 90, WORLD_HEIGHT / 2 + 95, i === 1 ? "horizontal" : "vertical");
        b.active = true;
        b.tier = 0;
        const tier = barricadeTiers[0];
        b.maxHp = Math.round((tier.hpBonus || 25) * (player?.barricadeHpMultiplier || 1));
        b.hp = b.maxHp;
        b.color = tier.color;
        b.spent = 0;
        barricades.push(b);
    }
}

function buffExistingBarricades(multiplier) {
    (barricades || []).forEach(b => {
        if (!b || !b.active) return;
        const oldMax = b.maxHp || 1;
        b.maxHp = Math.ceil(oldMax * multiplier);
        b.hp = Math.min(b.maxHp, b.hp + (b.maxHp - oldMax));
    });
}

function createDefaultState() {
    wave = 1;
    coins = 0;
    score = 0;
    runDisqualifiedFromLeaderboard = false;
    leaderboardDisqualificationReason = "";
    updateDebugRunIndicator();
    beginnerCommandUsed = false;
    lastDeathCause = "desconocido";

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
        moveSpeed: PLAYER_SURVIVAL_SPEED * PLAYER_WALK_SPEED_MULTIPLIER,
        stamina: PLAYER_STAMINA_MAX,
        maxStamina: PLAYER_STAMINA_MAX,
        sprinting: false,
        aimX: WORLD_WIDTH / 2 + 1,
        aimY: WORLD_HEIGHT / 2,
        shieldCharges: 0,
        doubleShotUntil: 0,
        attackSpeedUntil: 0,
        lifeStealUntil: 0,
        lifeStealPercent: 0,
        permanentLifeStealPercent: 0,
        goldBonusMultiplier: 1,
        bleedPowerMultiplier: 1,
        classCostMultipliers: { damage: 1, fireRate: 1, maxHp: 1, crit: 1, towers: 1, abilities: 1, consumables: 1, mines: 1 },
        statPowerMultiplier: 1,
        structureCostMultiplier: 1,
        towerDamageMultiplier: 1,
        abilityPowerMultiplier: 1,
        abilityCooldownMultiplier: 1,
        consumablePowerMultiplier: 1,
        healingMultiplier: 1,
        enemyHpMultiplier: 1,
        enemySpeedMultiplier: 1,
        enemyCountMultiplier: 1,
        mineIncomeMultiplier: 1,
        repairCostMultiplier: 1,
        scoreMultiplier: 1,
        specialDamageMultiplier: 1,
        barricadeHpMultiplier: 1,
        extraInventorySlots: 0,
        freeTowerPlacements: {},
        freeBarricadePlacements: 0,
        freeMinePlacements: 0,
        freeAnyConstructionPlacements: 0,
        bloodShield: 0,
        bloodShieldMax: 8,
        bleedPowerMultiplier: 1,
        passiveDoubleShotChance: 0,
        immortal: false,
        isMoving: false,
        lastMoveX: 1,
        lastMoveY: 0,
        hurtUntil: 0,
        deathStartedAt: 0,
        alphaTester: Boolean(alphaTesterName),
        developer: Boolean(developerName),
        name: developerName || alphaTesterName || playerName,
        classKey: selectedClassKey,
        classColor: "#ffffff",
        color: "#ffffff"

    };
    gameSpeed = 1;
    speedIndex = 0;
    autoMode = false;
    autoRepeatWaveMode = false;
    buildPhaseActive = false;
    buildPhaseEndsAt = 0;

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
    visitorSpawnedThisWave = false;
    lastVisitorWave = -999;
    lastVisitorDeathWave = -999;
    titanRewardedWaves = {};
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
            cost: 980,
            cooldown: 22000,
            lastUsed: -Infinity
        },
        meteor: {
            name: "Meteorito",
            key: codeToLabel(controlBindings.meteor),
            owned: false,
            cost: 1750,
            cooldown: 30000,
            lastUsed: -Infinity
        },
        eclipse: {
            name: "Eclipse",
            key: codeToLabel(controlBindings.eclipse),
            owned: false,
            cost: 2800,
            cooldown: 42000,
            lastUsed: -Infinity
        },
        blink: {
            name: "Blink",
            key: codeToLabel(controlBindings.blink),
            owned: false,
            cost: 800,
            cooldown: 5000,
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
        doorBarricade: 48,
        towerSlot: FIRST_TOWER_SLOT_COST,

        tower1: 70,
        tower2: 40,
        tower3: 160,
        tower4: 220,
        tower5: 260,
        tower6: 310,
        tower7: 360,
        tower8: 420,
        tower9: 620,
        tower10: 240,
        tower11: 90,
        tower12: 135,
        tower13: 1450,
        trapSnare: 55,
        trapBleed: 75,
        mineGold: FIRST_MINE_COST
    };

    const persistentVisitors = (enemies || []).filter(e => e && e.special === "visitor" && e.hp > 0);
    enemies = persistentVisitors;
    projectiles = [];
    bossProjectiles = [];
    slowZones = [];
    poisonZones = [];
    fireZones = [];
    damageTexts = [];
    particles = [];
    effects = [];
    traps = [];
    mines = [];
    titanShards = [];
    pendingTitanReward = null;
    inventory = createEmptyInventory();
    inventoryCooldownUntil = 0;
    activeRelics = [];
    relicFamilyWeights = { constructor: 1, sangre: 1, codicia: 1, arcana: 1, neutral: 1 };
    pendingRelicChoice = null;
    activeWaveEvent = null;
    activeSideMission = null;
    totalRunTimeMs = 0;
    runStats = createEmptyRunStats();
    applySelectedClassToRun();

    enemiesToSpawn = 0;
    enemiesSpawned = 0;
    spawnInterval = 900;
    lastSpawnTime = 0;

    resetWaveStats();
    if (runStats) { Object.assign(runStats, { abilitiesUsedThisWave:0, consumablesUsedThisWave:0, playerDamageTakenThisWave:0, minesDamagedThisWave:0, barricadesLostThisWave:0, structuresBuiltThisWave:0, bossPlayerDamage:0, ccHits:0, lastKillSource:"unknown" }); }
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
        beginnerCommandUsed,
        lastDeathCause,
        selectedClassKey,
        activeRelics,
        relicFamilyWeights,
        runStats,
        totalRunTimeMs,
        gameTime,
        gameSpeed,
        speedIndex,
        autoMode,
        autoRepeatWaveMode,
        buildPhaseActive,
        buildPhaseRemainingMs: buildPhaseActive ? Math.max(0, buildPhaseEndsAt - performance.now()) : 0,
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
        visitorSpawnedThisWave,
        lastVisitorWave,
        lastVisitorDeathWave,
        titanRewardedWaves,
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
        traps,
        mines,
        titanShards,
        pendingTitanReward,
        inventory,
        inventoryCooldownUntil,
        waveStats,
        uiMode: waveInProgress ? "wave" : (buildPhaseActive ? "build" : (!shop.classList.contains("hidden") ? "shop" : (!waveSummaryPanel.classList.contains("hidden") ? "summary" : "shop")))
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
        updateDebugRunIndicator();
        beginnerCommandUsed = Boolean(data.beginnerCommandUsed);
        lastDeathCause = String(data.lastDeathCause || "desconocido").slice(0, 80);
        selectedClassKey = CLASS_DEFINITIONS[data.selectedClassKey] ? data.selectedClassKey : (CLASS_DEFINITIONS[data.player?.classKey] ? data.player.classKey : (localStorage.getItem("ardentSelectedClass") || "errante"));
        activeClass = CLASS_DEFINITIONS[selectedClassKey] || CLASS_DEFINITIONS.errante;
        activeRelics = Array.isArray(data.activeRelics) ? data.activeRelics : [];
        relicFamilyWeights = data.relicFamilyWeights && typeof data.relicFamilyWeights === "object"
            ? { constructor: 1, sangre: 1, codicia: 1, arcana: 1, neutral: 1, ...data.relicFamilyWeights }
            : { constructor: 1, sangre: 1, codicia: 1, arcana: 1, neutral: 1 };
        runStats = data.runStats && typeof data.runStats === "object" ? { ...createEmptyRunStats(), ...data.runStats } : createEmptyRunStats();
        totalRunTimeMs = Number(data.totalRunTimeMs) || Number(data.gameTime) || 0;
        gameTime = Number(data.gameTime) || 0;
        gameSpeed = Number(data.gameSpeed) || 1;
        speedIndex = Number(data.speedIndex) || 0;
        autoMode = Boolean(data.autoMode);
        autoRepeatWaveMode = Boolean(data.autoRepeatWaveMode);
        buildPhaseActive = Boolean(data.buildPhaseActive);
        buildPhaseEndsAt = buildPhaseActive ? performance.now() + Math.max(1000, Math.min(BUILD_PHASE_DURATION, Number(data.buildPhaseRemainingMs) || BUILD_PHASE_DURATION)) : 0;
        pausedBuildPhaseRemainingMs = 0;
        waveInProgress = buildPhaseActive ? false : Boolean(data.waveInProgress);
        gameRunning = Boolean(!buildPhaseActive && data.gameRunning && data.waveInProgress);
        enemiesToSpawn = Number(data.enemiesToSpawn) || 0;
        enemiesSpawned = Number(data.enemiesSpawned) || 0;
        spawnInterval = Number(data.spawnInterval) || 900;
        lastSpawnTime = Number(data.lastSpawnTime) || getGameTime();
        repeatCountsByWave = normalizeRepeatCountsByWave(data.repeatCountsByWave || {});
        isRepeatingWave = Boolean(data.isRepeatingWave);
        currentGoldMultiplier = Number(data.currentGoldMultiplier) || 1;
        if (isRepeatingWave) currentGoldMultiplier = REPEAT_GOLD_MULTIPLIER;
        doomSpawnedThisWave = Boolean(data.doomSpawnedThisWave);
        lastDoomWave = Number.isFinite(Number(data.lastDoomWave)) ? Number(data.lastDoomWave) : -999;
        visitorSpawnedThisWave = Boolean(data.visitorSpawnedThisWave);
        lastVisitorWave = Number.isFinite(Number(data.lastVisitorWave)) ? Number(data.lastVisitorWave) : -999;
        lastVisitorDeathWave = Number.isFinite(Number(data.lastVisitorDeathWave)) ? Number(data.lastVisitorDeathWave) : -999;
        titanRewardedWaves = data.titanRewardedWaves && typeof data.titanRewardedWaves === "object" ? data.titanRewardedWaves : {};
        selectedBarricadeSlotIndex = Number.isInteger(data.selectedBarricadeSlotIndex) ? Math.max(0, Math.min(1, data.selectedBarricadeSlotIndex)) : 0;
        baseCore = null;
        basePlaced = false;
        pendingBasePlacement = false;

        player = data.player;
        player.moveSpeed = PLAYER_SURVIVAL_SPEED * PLAYER_WALK_SPEED_MULTIPLIER;
        player.maxStamina = Number(player.maxStamina) || PLAYER_STAMINA_MAX;
        player.stamina = Math.max(0, Math.min(player.maxStamina, Number(player.stamina ?? player.maxStamina)));
        player.sprinting = false;
        player.x = clampWorldX(Number(player.x) || WORLD_WIDTH / 2, 32);
        player.y = clampWorldY(Number(player.y) || WORLD_HEIGHT / 2, 32);
        player.moveSpeed = Number(player.moveSpeed) || PLAYER_SURVIVAL_SPEED;
        player.name = developerName || alphaTesterName || playerName;
        player.alphaTester = Boolean(alphaTesterName);
        player.developer = Boolean(developerName);
        player.classKey = selectedClassKey;
        player.classColor = activeClass?.color || player.classColor || "#ffffff";
        player.color = activeClass?.color || player.color || "#ffffff";

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
        if (abilities.lightning) abilities.lightning.cost = Math.max(Number(abilities.lightning.cost) || 0, 980);
        if (abilities.meteor) abilities.meteor.cost = Math.max(Number(abilities.meteor.cost) || 0, 1750);
        if (abilities.eclipse) abilities.eclipse.cost = Math.max(Number(abilities.eclipse.cost) || 0, 2800);
        if (!abilities.blink) abilities.blink = { name: "Blink", key: codeToLabel(controlBindings.blink), owned: false, cost: 800, cooldown: 5000, lastUsed: -Infinity };
        abilities.blink.key = codeToLabel(controlBindings.blink);
        abilities.blink.cost = Math.max(Number(abilities.blink.cost) || 0, 800);
        abilities.blink.cooldown = Number(abilities.blink.cooldown) || 5000;
        costs = data.costs || costs;
        if (!Number.isFinite(Number(costs.tower11))) costs.tower11 = 90;
        if (!Number.isFinite(Number(costs.tower12))) costs.tower12 = 135;
        if (!Number.isFinite(Number(costs.tower13))) costs.tower13 = 1450;
        if (!Number.isFinite(Number(costs.doorBarricade))) costs.doorBarricade = getBarricadeBaseCost("door");
        if (!Number.isFinite(Number(costs.trapSnare))) costs.trapSnare = trapDefinitions.snare.cost;
        if (!Number.isFinite(Number(costs.trapBleed))) costs.trapBleed = trapDefinitions.bleed.cost;
        if (!Number.isFinite(Number(costs.mineGold))) costs.mineGold = getMineCostForCount(Array.isArray(data.mines) ? data.mines.length : 0);
        if (!Number.isFinite(Number(costs.towerSlot))) costs.towerSlot = getTowerSlotCostForLimit(towerSlotLimit);
        applyControlsToAbilities();

        enemies = Array.isArray(data.enemies) ? data.enemies : [];
        enemies.forEach((enemy, index) => {
            if (!enemy.id) enemy.id = Date.now() + Math.random() + index;
            if (!enemy.isMini) {
                enemy.summonedById = null;
                enemy.summonBatchId = null;
            }
        });
        projectiles = Array.isArray(data.projectiles) ? data.projectiles : [];
        projectiles.forEach(p => { p.bornAt = Number(p.bornAt) || getGameTime(); p.maxAge = Number(p.maxAge) || 5200; });
        bossProjectiles = Array.isArray(data.bossProjectiles) ? data.bossProjectiles : [];
        slowZones = Array.isArray(data.slowZones) ? data.slowZones : [];
        poisonZones = Array.isArray(data.poisonZones) ? data.poisonZones : [];
        fireZones = Array.isArray(data.fireZones) ? data.fireZones : [];
        damageTexts = Array.isArray(data.damageTexts) ? data.damageTexts : [];
        particles = Array.isArray(data.particles) ? data.particles : [];
        effects = Array.isArray(data.effects) ? data.effects : [];
        traps = Array.isArray(data.traps) ? data.traps : [];
        mines = Array.isArray(data.mines) ? data.mines : [];
        mines.forEach((mine, index) => {
            if (!mine.id) mine.id = Date.now() + Math.random() + index;
            mine.radius = mine.radius || MINE_COLLISION_RADIUS;
            mine.name = mine.name || mineDefinitions.gold.name;
            mine.maxHp = Number(mine.maxHp) || MINE_MAX_HP;
            mine.hp = Number.isFinite(Number(mine.hp)) ? Math.max(0, Math.min(mine.maxHp, Number(mine.hp))) : mine.maxHp;
        });
        mines = mines.filter(mine => mine && mine.hp > 0);
        titanShards = Array.isArray(data.titanShards) ? data.titanShards : [];
        pendingTitanReward = data.pendingTitanReward || null;
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
            if (buildPhaseActive) {
                shop.classList.add("hidden");
                waveSummaryPanel.classList.add("hidden");
                const remainingSeconds = Math.max(1, Math.ceil(getBuildPhaseRemainingMs() / 1000));
                showCenterMessage(`${remainingSeconds} segundos antes de la próxima oleada`, 900);
            } else if (data.uiMode === "summary") {
                showWaveSummary();
            } else if (data.uiMode === "shop") {
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

function updateClassSelectionVisibility() {
    if (!classSelectionPanel) return;
    const shouldHide = Boolean(hasActiveRun || hasSavedRun() || gameStarted);
    classSelectionPanel.classList.toggle("hidden", shouldHide);
}

function updateStartButtonSavedState() {
    savedRunAvailable = hasSavedRun();
    const continuing = Boolean(savedRunAvailable || hasActiveRun);
    if (startGameBtn) {
        startGameBtn.textContent = continuing ? "Continuar partida" : "Jugar";
        startGameBtn.title = continuing ? "Hay una partida en progreso. La clase ya quedó fijada para esta run." : "";
    }
    updateClassSelectionVisibility();
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
    updateClassSelectionVisibility();

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


function maybeStartSideMission() {
    activeSideMission = null;
    if (!sideMissionBox || wave < 4 || Math.random() > 0.38) { updateSideMissionUI(); return; }
    const pool = SIDE_MISSIONS.filter(m => {
        if (["protect_mines", "mine_income"].includes(m.id) && !(mines || []).some(x => x && x.hp > 0)) return false;
        if (m.id === "last_spell" && !isBossWave()) return false;
        return true;
    });
    const base = pool[Math.floor(Math.random() * pool.length)];
    if (!base) return;
    activeSideMission = { ...base, progress: 0, failed: false, reward: getSideMissionReward() };
    updateSideMissionUI();
}

function getSideMissionReward() { return getGoldAmount(22 + wave * 4); }
function addMissionProgress(amount = 1) {
    if (!activeSideMission || activeSideMission.failed) return;
    activeSideMission.progress = Math.min(activeSideMission.target, (activeSideMission.progress || 0) + amount);
    updateSideMissionUI();
}
function updateMissionFailure(type) {
    if (activeSideMission?.type === type && !activeSideMission.failed) {
        activeSideMission.failed = true;
        showMissionToast(false, activeSideMission);
        updateSideMissionUI();
    }
}
function showMissionToast(completed, mission = activeSideMission) {
    if (!mission) return;
    if (completed) showCenterMessage(`MISIÓN COMPLETADA — ${mission.title} · +${formatMoney(mission.reward)} oro`, 1500, "mission-success");
    else showCenterMessage(`MISIÓN FALLIDA — ${mission.title}`, 1250, "mission-fail");
}
function updateMissionOnKill(enemy, source) {
    if (!activeSideMission || activeSideMission.failed) return;
    if (activeSideMission.type === "playerKills" && source === "player") addMissionProgress(1);
    if (activeSideMission.type === "towerKills" && source === "tower") addMissionProgress(1);
    if (activeSideMission.type === "trapKills" && (source === "trap" || source === "barricade")) addMissionProgress(1);
    if (activeSideMission.type === "specialKills" && enemy.special) addMissionProgress(1);
    if (activeSideMission.type === "ramKills" && enemy.special === "ram") addMissionProgress(1);
    if (activeSideMission.type === "lowHpKills" && player && player.hp <= player.maxHp * 0.5) addMissionProgress(1);
    if (activeSideMission.type === "fastKills" && getGameTime() - waveStartedAt < 45000) addMissionProgress(1);
    if (activeSideMission.type === "bossAbilityKill" && enemy.isBoss && source === "ability") addMissionProgress(1);
}
function finishSideMission() {
    if (!activeSideMission) { updateSideMissionUI(); return; }
    if (activeSideMission.failed) { activeSideMission = null; updateSideMissionUI(); return; }
    if (activeSideMission.type === "noAbilities" && runStats.abilitiesUsedThisWave === 0) activeSideMission.progress = 1;
    if (activeSideMission.type === "noConsumables" && runStats.consumablesUsedThisWave === 0) activeSideMission.progress = 1;
    if (activeSideMission.type === "minesSafe" && runStats.minesDamagedThisWave === 0) activeSideMission.progress = 1;
    if (activeSideMission.type === "barricadesSafe" && runStats.barricadesLostThisWave === 0) activeSideMission.progress = 1;
    if (activeSideMission.type === "highHpEnd" && player.hp >= player.maxHp * 0.75) activeSideMission.progress = 1;
    if (activeSideMission.type === "saveGold" && coins >= Math.max(80, wave * 18)) activeSideMission.progress = 1;
    if (activeSideMission.type === "mineIncomeSafe" && runStats.minesDamagedThisWave === 0 && (mines || []).some(m => m.hp > 0)) activeSideMission.progress = 1;
    if (activeSideMission.type === "baseSafe") activeSideMission.progress = 1;
    if (activeSideMission.type === "survive_no_damage" && runStats.playerDamageTakenThisWave === 0) activeSideMission.progress = 1;
    if ((activeSideMission.progress || 0) >= activeSideMission.target) {
        coins += activeSideMission.reward;
        waveStats.gold += activeSideMission.reward;
        if (runStats) { runStats.goldEarned += activeSideMission.reward; runStats.missionsCompleted++; }
        showMissionToast(true, activeSideMission);
    } else {
        showMissionToast(false, activeSideMission);
    }
    activeSideMission = null;
    updateSideMissionUI();
}
function updateSideMissionUI() {
    if (!sideMissionBox) return;
    sideMissionBox.classList.toggle("hidden", !activeSideMission);
    if (!activeSideMission) return;
    sideMissionTitle.textContent = activeSideMission.title;
    sideMissionDesc.textContent = `${activeSideMission.desc} · Premio ${formatMoney(activeSideMission.reward)} oro`;
    sideMissionProgress.textContent = activeSideMission.failed ? "Fallida" : `${Math.floor(activeSideMission.progress || 0)}/${activeSideMission.target}`;
    sideMissionBox.classList.toggle("failed", Boolean(activeSideMission.failed));
}
function startWave() {
    buildPhaseActive = false;
    buildPhaseEndsAt = 0;
    updateBuildPhaseUI();
    cancelTowerPlacement(false);
    cancelTowerMove(false);
    cancelBarricadePlacement(false);
    cancelTrapPlacement(false);
    cancelMinePlacement(false);
    if (structurePanel) structurePanel.classList.add("hidden");
    selectedStructureIds = [];
    selectedStructureType = null;
    waveInProgress = true;
    gameRunning = true;

    const persistentVisitors = (enemies || []).filter(e => e && e.special === "visitor" && e.hp > 0);
    persistentVisitors.forEach(v => {
        v.retreating = false;
        v.untargetable = false;
        v.retreatX = null;
        v.retreatY = null;
        v.lastVisitorShotAt = getGameTime() + 650;
        v.visitorStrafeUntil = getGameTime() + 900;
    });
    enemies = persistentVisitors;
    projectiles = [];
    bossProjectiles = [];
    slowZones = [];
    poisonZones = [];
    fireZones = [];
    damageTexts = [];
    particles = [];
    effects = [];

    resetWaveStats();
    eventSiegeSide = null;
    waveStartedAt = getGameTime();
    bossPressureSpawned = 0;
    bossPressureLastSpawnAt = 0;
    bossSpawnedThisWave = false;
    visitorSpawnedThisWave = false;
    startWaveEvent();
    maybeStartSideMission();

    enemiesToSpawn = getEnemiesAmountForWave();
    enemiesSpawned = 0;

    spawnInterval = getSpawnIntervalForWave(enemiesToSpawn);
    lastSpawnTime = getGameTime() - spawnInterval;
    doomSpawnedThisWave = false;

    closeShop();
    waveSummaryPanel.classList.add("hidden");
    gameOverScreen.classList.add("hidden");
    pausePanel.classList.add("hidden");
    consolePanel.classList.add("hidden");
    confirmRestartBox.classList.add("hidden");

    if (isBossWave()) {
        spawnBoss();
        showCenterMessage(`¡BOSS!\nLa horda retrocede. Algo más pesado entró al campo.`, 1900, "boss");
    }

    isPaused = false;
    lastFrameTime = performance.now();
    frameScale = 1;
    syncMusicState();
    updateHud(true);
    autoSaveRun(true);
}

function getEnemiesAmountForWave() {
    // La cantidad sube hasta cierto punto y luego se vuelve densidad/calidad, no duración infinita.
    const earlyCount = 12 + wave * 4;
    if (wave <= 35) return isBossWave() ? Math.max(18, Math.floor(earlyCount * 0.75)) : earlyCount;

    const lateCount = Math.floor(150 + Math.log10(wave + 1) * 42 + Math.pow(wave - 35, 0.36) * 18);
    const capped = Math.min(MAX_LATE_WAVE_ENEMIES, lateCount);

    if (isBossWave()) {
        return Math.min(MAX_BOSS_WAVE_ENEMIES, Math.max(65, Math.floor(capped * 0.72)));
    }

    return Math.max(1, Math.floor(capped * (player?.enemyCountMultiplier || 1)));
}

function getSpawnIntervalForWave(amount) {
    const naturalInterval = Math.max(MIN_WAVE_SPAWN_INTERVAL, 900 - wave * 16);
    const maxDurationInterval = Math.max(MIN_WAVE_SPAWN_INTERVAL, Math.floor(MAX_WAVE_SPAWN_DURATION / Math.max(1, amount)));
    return Math.min(naturalInterval, maxDurationInterval);
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


function getWaveEventSpecialBonus() {
    return activeWaveEvent?.id === "titan_hunger" ? 0.18 : 0;
}

function pickWaveEvent() {
    if (isRepeatingWave || wave < 4 || wave - lastWaveEventWave < 4) return null;
    if (Math.random() > 0.32) return null;
    const pool = WAVE_EVENTS.filter(e => wave >= (e.minWave || 1) && e.id !== activeWaveEvent?.id);
    return pool[Math.floor(Math.random() * pool.length)] || null;
}

function startWaveEvent() {
    activeWaveEvent = pickWaveEvent();
    if (!activeWaveEvent) return;
    lastWaveEventWave = wave;
    showCenterMessage(`${activeWaveEvent.title} — ${activeWaveEvent.desc}`, 2600, activeWaveEvent.messageType || "event");
}

function endWaveEvent(completedWave) {
    if (activeWaveEvent && runStats) runStats.survivedEvents.push(activeWaveEvent.name);
    activeWaveEvent = null;
}

function getEventGoldMultiplierForEnemy() {
    return activeWaveEvent?.id === "midas" ? 1.35 : 1;
}

function getEventEnemySpeedMultiplier() {
    if (activeWaveEvent?.id === "midas") return 1.20;
    return 1;
}

function getEventEnemyDamageMultiplier() {
    if (activeWaveEvent?.id === "blood_rain") return 1.15;
    return 1;
}

function getEventEnemyTakenDamageMultiplier() {
    if (activeWaveEvent?.id === "blood_rain") return 1.10;
    return 1;
}

let eventSiegeSide = null;
function getEnemyTypeForWave() {
    const unlockedTypes = getUnlockedEnemyCount();
    const normalPool = enemyTypes.slice(0, unlockedTypes);
    const specialPool = specialEnemyTypes.filter(type => wave >= type.unlockWave);
    const filteredSpecialPool = specialPool.filter(type => type.special !== "thief" || (mines || []).some(m => m && m.hp > 0));


    if (filteredSpecialPool.length > 0 && Math.random() < getSpecialEnemyChance() + getWaveEventSpecialBonus()) {
        const weighted = [];
        filteredSpecialPool.forEach(type => {
            const weight = type.special === "healer" ? 0.38 : type.special === "summoner" ? 0.32 : 1;
            const count = Math.max(1, Math.round(weight * 10));
            for (let i = 0; i < count; i++) weighted.push(type);
        });
        return weighted[Math.floor(Math.random() * weighted.length)];
    }

    return normalPool[Math.floor(Math.random() * normalPool.length)];
}

function getSpecialEnemyChance() {
    if (wave < 35) return Math.min(0.38, 0.13 + wave * 0.008);
    if (wave < 100) return Math.min(0.62, 0.34 + (wave - 35) * 0.0042);
    if (wave < 350) return Math.min(0.82, 0.62 + (wave - 100) * 0.0008);
    return 0.90;
}

function getRandomSpawnPoint() {
    if (activeWaveEvent?.id === "siege") {
        if (eventSiegeSide == null) eventSiegeSide = Math.floor(Math.random() * 4);
        return getSpawnPointForSide(eventSiegeSide);
    }
    return getSpawnPointForSide(Math.floor(Math.random() * 4));
}

function getSpawnPointForSide(side) {
    const margin = 55;
    if (side === 0) return { x: Math.random() * WORLD_WIDTH, y: -margin };
    if (side === 1) return { x: WORLD_WIDTH + margin, y: Math.random() * WORLD_HEIGHT };
    if (side === 2) return { x: Math.random() * WORLD_WIDTH, y: WORLD_HEIGHT + margin };
    return { x: -margin, y: Math.random() * WORLD_HEIGHT };
}

function getBossSpawnPoint() {
    return {
        x: BOSS_SPAWN_ZONE.x + (Math.random() - 0.5) * BOSS_SPAWN_ZONE.width * 0.35,
        y: BOSS_SPAWN_ZONE.y + (Math.random() - 0.5) * BOSS_SPAWN_ZONE.height * 0.35
    };
}

function getEnemyHpScaling() {
    if (wave <= 45) return 1 + wave * 0.13;

    // Late infinito: vida sube mucho, pero con curva sublineal para evitar números absurdos demasiado pronto.
    const earlyPart = 1 + 45 * 0.13;
    const latePart = Math.pow(wave - 45, 0.78) * 0.34;
    const deepLatePart = Math.log10(wave + 1) * Math.max(0, wave - 300) * 0.0009;
    return earlyPart + latePart + deepLatePart;
}

function getEnemySpeedScaling() {
    if (wave <= 60) return wave * 0.012;
    return 60 * 0.012 + Math.min(1.15, Math.log10(wave - 50) * 0.16);
}

function getWaveScoreBonus() {
    if (wave < 40) return wave;
    return Math.floor(40 + Math.pow(wave - 39, 0.78) * 4);
}

function createEnemyFromType(type, options = {}) {
    const hpScaling = options.ignoreScaling ? 1 : getEnemyHpScaling();
    const speedScaling = options.ignoreScaling ? 0 : getEnemySpeedScaling();
    const repeatStrength = getRepeatEnemyStrengthMultiplier();
    const classHpMult = player?.enemyHpMultiplier || 1;
    const maxHp = Math.max(1, Math.ceil(type.hp * hpScaling * repeatStrength * classHpMult));
    const speed = (type.speed + speedScaling) * ENEMY_SURVIVAL_SPEED_MULTIPLIER * (player?.enemySpeedMultiplier || 1) * getEventEnemySpeedMultiplier();
    const spawnPoint = options.spawnPoint || getRandomSpawnPoint();

    const enemy = {
        id: options.id ?? Date.now() + Math.random(),
        x: options.x ?? spawnPoint.x,
        y: options.y ?? spawnPoint.y,
        radius: options.radius ?? 18,
        color: options.colorOverride || (type.special === "exploder" ? "#ff2d1f" : type.color),
        hp: maxHp,
        maxHp,
        baseSpeed: speed,
        originalBaseSpeed: speed,
        speed,
        reward: options.reward ?? Math.ceil(getEnemyRewardForWave(type.reward) * getEventGoldMultiplierForEnemy()),
        scoreValue: options.scoreValue ?? type.score + getWaveScoreBonus(),
        damageToDefense: Math.ceil(scaleEnemyDamageForRepeat(type.damageToDefense) * getEventEnemyDamageMultiplier()),
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
        isMini: Boolean(options.isMini),
        summonedById: options.summonedById || null,
        summonBatchId: options.summonBatchId || null,
        healerFollowTargetId: null,
        spawnWave: options.spawnWave ?? wave,
        rangedCooldown: type.rangedCooldown || 0,
        lastRangedShotAt: getGameTime() + Math.random() * 1200,
        reflectPercent: type.special === "shielded" ? 0 : (type.reflectPercent || 0),
        shieldHp: type.shieldHp ? Math.ceil(type.shieldHp * hpScaling) : 0,
        maxShieldHp: type.shieldHp ? Math.ceil(type.shieldHp * hpScaling) : 0,
        auraRadius: type.auraRadius || 0,
        auraPower: type.auraPower || 0,
        robbedGold: 0
    };

    if (enemy.special === "visitor") {
        enemy.name = "El Visitante";
        enemy.radius = options.radius ?? 22;
        enemy.maxHp = options.maxHp ?? Math.ceil(maxHp * 1.45);
        enemy.hp = options.hp ?? enemy.maxHp;
        enemy.baseSpeed = options.baseSpeed ?? Math.max(enemy.baseSpeed, 0.94);
        enemy.originalBaseSpeed = enemy.baseSpeed;
        enemy.speed = enemy.baseSpeed;
        enemy.color = "#151722";
        enemy.visitorTint = options.visitorTint || "#20232d";
        enemy.retreating = Boolean(options.retreating);
        enemy.retreatX = Number.isFinite(options.retreatX) ? options.retreatX : null;
        enemy.retreatY = Number.isFinite(options.retreatY) ? options.retreatY : null;
        enemy.visitorGold = Number(options.visitorGold) || 0;
        enemy.visitorLevel = Number(options.visitorLevel) || 1;
        // El Visitante empieza amenazante, pero no debe borrar la base antes de mejorarse.
        enemy.visitorDamage = Number(options.visitorDamage) || Math.ceil(2.6 + wave * 0.045);
        enemy.visitorShotCooldown = Number(options.visitorShotCooldown) || 1450;
        enemy.lastVisitorShotAt = getGameTime() + 600;
        enemy.lastVisitorUpgradeAt = getGameTime() + 1800;
        enemy.visitorStrafeDir = Math.random() < 0.5 ? -1 : 1;
        enemy.visitorStrafeUntil = getGameTime() + 1400;
        enemy.deathName = "El Visitante";
    }

    if (enemy.special === "doombringer") {
        const variant = options.titanVariant || pickTitanVariant();
        enemy.titanVariant = variant.key;
        enemy.name = variant.name;
        enemy.color = variant.color;
        enemy.maxHp = Math.ceil(enemy.maxHp * variant.hpMultiplier * (options.titanCopy ? 0.62 : 1));
        enemy.hp = enemy.maxHp;
        enemy.baseSpeed *= variant.speedMultiplier;
        enemy.originalBaseSpeed = enemy.baseSpeed;
        enemy.speed = enemy.baseSpeed;
        enemy.radius = options.radius ?? (options.titanCopy ? 28 : 34);
        enemy.lastTitanSpecialAt = getGameTime() + 1200 + Math.random() * 900;
        enemy.titanSpecialCooldown = variant.cooldown;
        enemy.titanSplitDone = Boolean(options.titanCopy);
        enemy.titanCopy = Boolean(options.titanCopy);
        const earlyTitanDamageScale = wave < 35 ? 0.72 : wave < 50 ? 0.84 : 1;
        enemy.damageToDefense = Math.max(3, Math.ceil((options.titanCopy ? 4 : 6) * earlyTitanDamageScale));
        enemy.attackDelay = options.titanCopy ? 1850 : 1650;
        enemy.originalAttackDelay = enemy.attackDelay;
    }

    return enemy;
}


function hasLivingVisitor() {
    return (enemies || []).some(e => e && e.special === "visitor" && e.hp > 0);
}

function shouldSpawnVisitor() {
    if (visitorSpawnedThisWave) return false;
    if (isRepeatingWave) return false;
    if (wave < 25) return false;
    if (hasLivingVisitor()) return false;
    if (wave - lastVisitorWave < 12) return false;
    if (wave - lastVisitorDeathWave < 14) return false;
    const chance = Math.min(0.055, 0.012 + Math.max(0, wave - 25) * 0.00065);
    return Math.random() < chance;
}

function spawnVisitor(options = {}) {
    if (!enemies) enemies = [];
    if (!options.force && hasLivingVisitor()) return null;
    const type = specialEnemyTypes.find(t => t.special === "visitor");
    if (!type) return null;
    const spawnPoint = options.spawnPoint || getSpawnPointForSide(Math.floor(Math.random() * 4));
    const visitor = createEnemyFromType(type, { spawnPoint, ignoreScaling: false });
    visitor.special = "visitor";
    visitor.name = "El Visitante";
    visitor.deathName = "El Visitante";
    enemies.push(visitor);
    visitorSpawnedThisWave = true;
    lastVisitorWave = wave;
    showCenterMessage(`EL VISITANTE\nAlgo parecido a vos cruzó la niebla. No vino a morir rápido.`, 2500, "visitor");
    showVisitorAlert("El Visitante entró a la partida.");
    return visitor;
}

function showVisitorAlert(message) {
    let box = document.getElementById("visitorAlertText");
    if (!box) {
        box = document.createElement("div");
        box.id = "visitorAlertText";
        document.body.appendChild(box);
    }
    box.textContent = message || "El Visitante se está haciendo más fuerte.";
    box.classList.remove("hidden");
    box.classList.remove("visitorAlertPulse");
    void box.offsetWidth;
    box.classList.add("visitorAlertPulse");
    visitorAlertUntil = getGameTime() + 2300;
}

function updateVisitorAlert() {
    const box = document.getElementById("visitorAlertText");
    if (!box) return;
    box.classList.toggle("hidden", getGameTime() > visitorAlertUntil);
}

function awardVisitorGold(amount = 0) {
    const visitor = (enemies || []).find(e => e && e.special === "visitor" && e.hp > 0);
    if (!visitor) return;
    visitor.visitorGold = (Number(visitor.visitorGold) || 0) + Math.max(0, amount) * 0.42;
}

function getVisitorTarget(visitor) {
    const candidates = [];
    if (player && player.hp > 0) candidates.push({ type:"player", object:player, x:player.x, y:player.y, radius:23, score: Math.hypot(visitor.x-player.x, visitor.y-player.y) * 0.62 });
    (towers || []).forEach(t => { if (t && t.owned && t.hp > 0) candidates.push({ type:"tower", object:t, x:t.x, y:t.y, radius:TOWER_COLLISION_RADIUS, score: Math.hypot(visitor.x-t.x, visitor.y-t.y) - (1 - (t.hp / Math.max(1, t.maxHp || t.hp))) * 110 }); });
    (mines || []).forEach(m => { if (m && m.hp > 0) candidates.push({ type:"mine", object:m, x:m.x, y:m.y, radius:m.radius || MINE_COLLISION_RADIUS, score: Math.hypot(visitor.x-m.x, visitor.y-m.y) - 55 }); });
    (barricades || []).forEach(b => {
        if (!b || !b.active || b.hp <= 0 || b.isOpen) return;
        const c = getClosestPointOnBarricade(visitor.x, visitor.y, b);
        candidates.push({ type:"barricade", object:b, x:c.x, y:c.y, radius:12, score: Math.hypot(visitor.x-c.x, visitor.y-c.y) - 25 });
    });
    if (basePlaced && baseCore && baseCore.hp > 0) candidates.push({ type:"base", object:baseCore, x:baseCore.x, y:baseCore.y, radius:BASE_RADIUS, score: Math.hypot(visitor.x-baseCore.x, visitor.y-baseCore.y) + 160 });
    candidates.sort((a,b)=>a.score-b.score);
    return candidates[0] || null;
}

function maybeUpgradeVisitor(visitor, now) {
    if (!visitor || now - (visitor.lastVisitorUpgradeAt || 0) < 1200) return;
    const level = Number(visitor.visitorLevel) || 1;
    const cost = Math.ceil(18 + level * 12 + wave * 0.8);
    if ((visitor.visitorGold || 0) < cost) return;
    visitor.visitorGold -= cost;
    visitor.visitorLevel = level + 1;
    visitor.lastVisitorUpgradeAt = now;
    const roll = Math.random();
    if (roll < 0.38) {
        visitor.visitorDamage = (visitor.visitorDamage || 3) + 0.75;
        showVisitorAlert("El Visitante se está haciendo más fuerte: daño aumentado.");
    } else if (roll < 0.72) {
        const gain = Math.ceil(10 + wave * 0.25);
        visitor.maxHp += gain;
        visitor.hp = Math.min(visitor.maxHp, visitor.hp + gain);
        showVisitorAlert("El Visitante se está haciendo más fuerte: vida aumentada.");
    } else {
        visitor.baseSpeed = Math.min(1.75, (visitor.baseSpeed || 1) + 0.035);
        visitor.speed = visitor.baseSpeed;
        showVisitorAlert("El Visitante se está haciendo más fuerte: velocidad aumentada.");
    }
}

function updateVisitorAI(visitor, now) {
    if (!visitor || visitor.hp <= 0) return;
    if (visitor.retreating) {
        visitor.retreating = false;
        visitor.untargetable = false;
        visitor.retreatX = null;
        visitor.retreatY = null;
        visitor.visitorPlanningCenterX = null;
        visitor.visitorPlanningCenterY = null;
    }
    maybeUpgradeVisitor(visitor, now);
    const target = getVisitorTarget(visitor);
    if (!target) return;
    visitor.targetX = target.x;
    visitor.targetY = target.y;
    const dx = target.x - visitor.x;
    const dy = target.y - visitor.y;
    const dist = Math.hypot(dx, dy) || 1;
    const nx = dx / dist;
    const ny = dy / dist;
    if (now > (visitor.visitorStrafeUntil || 0)) {
        visitor.visitorStrafeDir = Math.random() < 0.5 ? -1 : 1;
        visitor.visitorStrafeUntil = now + 900 + Math.random() * 1300;
    }
    let mx = 0;
    let my = 0;
    const preferred = target.type === "player" ? 300 : 255;
    if (dist < preferred - 85) { mx -= nx; my -= ny; }
    else if (dist > preferred + 105) { mx += nx; my += ny; }
    mx += -ny * 0.62 * (visitor.visitorStrafeDir || 1);
    my += nx * 0.62 * (visitor.visitorStrafeDir || 1);

    let nearestProjectile = null;
    let nearestProjectileDist = 9999;
    (projectiles || []).forEach(p => {
        if (!p || (p.owner !== "player" && p.owner !== "tower")) return;
        const d = Math.hypot(p.x - visitor.x, p.y - visitor.y);
        if (d < nearestProjectileDist) { nearestProjectileDist = d; nearestProjectile = p; }
    });
    if (nearestProjectile && nearestProjectileDist < 95) {
        mx += -(nearestProjectile.dy || 0) * 1.25;
        my += (nearestProjectile.dx || 0) * 1.25;
    }
    const len = Math.hypot(mx, my) || 1;
    const move = (visitor.speed || visitor.baseSpeed || 1) * gameSpeed * frameScale;
    const nextX = clampWorldX(visitor.x + (mx / len) * move, visitor.radius + 4);
    const nextY = clampWorldY(visitor.y + (my / len) * move, visitor.radius + 4);
    const oldX = visitor.x;
    const oldY = visitor.y;
    if (!isEnemyPositionBlockedBySolid(visitor, nextX, nextY)) {
        visitor.x = nextX; visitor.y = nextY;
    } else if (!isEnemyPositionBlockedBySolid(visitor, nextX, visitor.y)) {
        visitor.x = nextX;
    } else if (!isEnemyPositionBlockedBySolid(visitor, visitor.x, nextY)) {
        visitor.y = nextY;
    }
    visitor.lastMoveX = visitor.x - oldX;
    visitor.lastMoveY = visitor.y - oldY;
    visitor.isMoving = Math.hypot(visitor.lastMoveX || 0, visitor.lastMoveY || 0) > 0.04;

    if (dist < 470 && now - (visitor.lastVisitorShotAt || 0) >= (visitor.visitorShotCooldown || 1250)) {
        visitor.lastVisitorShotAt = now;
        fireEnemyProjectile(visitor, target.x, target.y, { damage: Math.max(2, visitor.visitorDamage || 4), color: "#f2f2f2", speed: 5.2, radius: 6 });
    }
}

function getPlayerStructureAvoidPoints() {
    const points = [];
    if (basePlaced && baseCore && baseCore.hp > 0) points.push({ x: baseCore.x, y: baseCore.y, radius: 390, kind: "base" });
    (towers || []).forEach(t => { if (t && t.owned && t.hp > 0) points.push({ x: t.x, y: t.y, radius: 120, kind: "tower" }); });
    (mines || []).forEach(m => { if (m && m.hp > 0) points.push({ x: m.x, y: m.y, radius: 125, kind: "mine" }); });
    (barricades || []).forEach(b => {
        if (!b || !b.active || b.hp <= 0) return;
        points.push({ x: b.x, y: b.y, radius: 145, kind: "barricade" });
    });
    return points;
}

function isVisitorBuildPhaseForbiddenPosition(x, y, extra = 0) {
    if (!Number.isFinite(x) || !Number.isFinite(y)) return true;
    if (x < 90 || x > WORLD_WIDTH - 90 || y < 90 || y > WORLD_HEIGHT - 90) return true;
    return getPlayerStructureAvoidPoints().some(p => Math.hypot(x - p.x, y - p.y) < (p.radius + extra));
}

function scoreVisitorPlanningPoint(point, visitor = null) {
    const avoidPoints = getPlayerStructureAvoidPoints();
    const structureDistance = avoidPoints.length
        ? Math.min(...avoidPoints.map(p => Math.hypot(point.x - p.x, point.y - p.y) - p.radius))
        : 999;
    const baseDistance = baseCore ? Math.hypot(point.x - baseCore.x, point.y - baseCore.y) : structureDistance;
    const visitorDistance = visitor ? Math.hypot(point.x - visitor.x, point.y - visitor.y) : 0;
    // Queremos una zona lejos de tu base, pero no una carrera absurda de esquina a esquina.
    return structureDistance * 1.4 + baseDistance * 0.6 - visitorDistance * 0.18 + Math.random() * 80;
}

function getVisitorRetreatPoint(visitor) {
    const margin = 230;
    const candidates = [
        { x: margin, y: margin },
        { x: WORLD_WIDTH - margin, y: margin },
        { x: margin, y: WORLD_HEIGHT - margin },
        { x: WORLD_WIDTH - margin, y: WORLD_HEIGHT - margin },
        { x: WORLD_WIDTH / 2, y: margin },
        { x: WORLD_WIDTH / 2, y: WORLD_HEIGHT - margin },
        { x: margin, y: WORLD_HEIGHT / 2 },
        { x: WORLD_WIDTH - margin, y: WORLD_HEIGHT / 2 },
        { x: WORLD_WIDTH * 0.27, y: WORLD_HEIGHT * 0.22 },
        { x: WORLD_WIDTH * 0.73, y: WORLD_HEIGHT * 0.22 },
        { x: WORLD_WIDTH * 0.27, y: WORLD_HEIGHT * 0.78 },
        { x: WORLD_WIDTH * 0.73, y: WORLD_HEIGHT * 0.78 }
    ].filter(p => !isVisitorBuildPhaseForbiddenPosition(p.x, p.y, 120));

    const pool = candidates.length ? candidates : [
        { x: margin, y: margin },
        { x: WORLD_WIDTH - margin, y: WORLD_HEIGHT - margin }
    ];
    pool.sort((a, b) => scoreVisitorPlanningPoint(b, visitor) - scoreVisitorPlanningPoint(a, visitor));
    return pool[0];
}

function getVisitorPlanningWanderPoint(visitor) {
    const centerX = Number.isFinite(visitor.visitorPlanningCenterX) ? visitor.visitorPlanningCenterX : visitor.retreatX;
    const centerY = Number.isFinite(visitor.visitorPlanningCenterY) ? visitor.visitorPlanningCenterY : visitor.retreatY;
    const radius = 210;
    for (let i = 0; i < 18; i++) {
        const angle = Math.random() * Math.PI * 2;
        const distance = 45 + Math.random() * radius;
        const x = clampWorldX(centerX + Math.cos(angle) * distance, (visitor.radius || 22) + 8);
        const y = clampWorldY(centerY + Math.sin(angle) * distance, (visitor.radius || 22) + 8);
        if (!isVisitorBuildPhaseForbiddenPosition(x, y, 85) && !isEnemyPositionBlockedBySolid(visitor, x, y)) {
            return { x, y };
        }
    }
    return { x: centerX, y: centerY };
}

function beginVisitorRetreat() {
    (enemies || []).forEach(visitor => {
        if (!visitor || visitor.special !== "visitor" || visitor.hp <= 0) return;
        const point = getVisitorRetreatPoint(visitor);
        visitor.retreating = true;
        visitor.untargetable = true;
        visitor.visitorPlanningCenterX = point.x;
        visitor.visitorPlanningCenterY = point.y;
        const wander = getVisitorPlanningWanderPoint({ ...visitor, visitorPlanningCenterX: point.x, visitorPlanningCenterY: point.y, retreatX: point.x, retreatY: point.y });
        visitor.retreatX = wander.x;
        visitor.retreatY = wander.y;
        visitor.targetX = wander.x;
        visitor.targetY = wander.y;
        visitor.visitorNextPlanningMoveAt = getGameTime() + 900 + Math.random() * 1300;
        visitor.isMoving = true;
    });
}

function updateVisitorRetreat(visitor) {
    if (!visitor || visitor.hp <= 0) return;
    if (!visitor.retreating) return;

    if (!Number.isFinite(visitor.visitorPlanningCenterX) || !Number.isFinite(visitor.visitorPlanningCenterY) ||
        isVisitorBuildPhaseForbiddenPosition(visitor.visitorPlanningCenterX, visitor.visitorPlanningCenterY, 100)) {
        const point = getVisitorRetreatPoint(visitor);
        visitor.visitorPlanningCenterX = point.x;
        visitor.visitorPlanningCenterY = point.y;
    }

    if (!Number.isFinite(visitor.retreatX) || !Number.isFinite(visitor.retreatY) ||
        isVisitorBuildPhaseForbiddenPosition(visitor.retreatX, visitor.retreatY, 75) ||
        getGameTime() >= (visitor.visitorNextPlanningMoveAt || 0)) {
        const point = getVisitorPlanningWanderPoint(visitor);
        visitor.retreatX = point.x;
        visitor.retreatY = point.y;
        visitor.targetX = point.x;
        visitor.targetY = point.y;
        visitor.visitorNextPlanningMoveAt = getGameTime() + 1400 + Math.random() * 2400;
    }

    const dx = visitor.retreatX - visitor.x;
    const dy = visitor.retreatY - visitor.y;
    const dist = Math.hypot(dx, dy) || 1;

    if (isVisitorBuildPhaseForbiddenPosition(visitor.x, visitor.y, 35)) {
        const point = getVisitorRetreatPoint(visitor);
        visitor.visitorPlanningCenterX = point.x;
        visitor.visitorPlanningCenterY = point.y;
        visitor.retreatX = point.x;
        visitor.retreatY = point.y;
    }

    const nx = dx / dist;
    const ny = dy / dist;
    const oldX = visitor.x;
    const oldY = visitor.y;

    // Movimiento de planificación: más humano y sutil, no bolita de DVD.
    const move = Math.max(0.65, Math.min(1.35, (visitor.speed || visitor.baseSpeed || 1) * 0.72)) * gameSpeed * frameScale;
    let nextX = clampWorldX(visitor.x + nx * move, visitor.radius + 8);
    let nextY = clampWorldY(visitor.y + ny * move, visitor.radius + 8);

    if (dist <= 12 || isEnemyPositionBlockedBySolid(visitor, nextX, nextY) || isVisitorBuildPhaseForbiddenPosition(nextX, nextY, 25)) {
        const point = getVisitorPlanningWanderPoint(visitor);
        visitor.retreatX = point.x;
        visitor.retreatY = point.y;
        visitor.targetX = point.x;
        visitor.targetY = point.y;
        visitor.visitorNextPlanningMoveAt = getGameTime() + 1000 + Math.random() * 1900;
    } else {
        visitor.x = nextX;
        visitor.y = nextY;
    }

    visitor.lastMoveX = visitor.x - oldX;
    visitor.lastMoveY = visitor.y - oldY;
    visitor.isMoving = Math.hypot(visitor.lastMoveX || 0, visitor.lastMoveY || 0) > 0.015;
}

function updateVisitorsDuringBuildPhase() {
    (enemies || []).forEach(visitor => {
        if (visitor && visitor.special === "visitor" && visitor.hp > 0) updateVisitorRetreat(visitor);
    });
}

function shouldSpawnDoomEnemy() {
    if (doomSpawnedThisWave) return false;
    if (isRepeatingWave) return false;
    if (wave < 20) return false;
    // Titán Negro: evento raro, no consecutivo y con descanso real entre apariciones.
    // Así no puede aparecer en 30/31 ni encadenarse demasiado seguido en late.
    const minGap = 6;
    if (wave - lastDoomWave < minGap) return false;

    const chance = Math.min(0.075, 0.018 + Math.max(0, wave - 20) * 0.00055);
    return Math.random() < chance;
}

function spawnEnemy() {
    let type;
    if (shouldSpawnVisitor()) {
        spawnVisitor({ force: false });
        enemiesSpawned++;
        return;
    }
    let forcedTitanVariant = null;
    if (shouldSpawnDoomEnemy()) {
        type = specialEnemyTypes.find(t => t.special === "doombringer");
        forcedTitanVariant = pickTitanVariant();
        doomSpawnedThisWave = true;
        lastDoomWave = wave;
        showCenterMessage(`${forcedTitanVariant.name.toUpperCase()}
${forcedTitanVariant.intro || "La tierra se abre. Algo imposible está caminando hacia vos."}`, 2700, "titan");
    } else {
        type = getEnemyTypeForWave();
        if (type && type.special === "doombringer") type = enemyTypes[Math.floor(Math.random() * getUnlockedEnemyCount())];
    }


    if (type && type.special === "summoner") {
        const maxSummoners = Math.max(1, Math.min(3, Math.floor(enemiesToSpawn / 55)));
        const currentSummoners = enemies.filter(e => e.special === "summoner" && e.hp > 0).length;
        if (currentSummoners >= maxSummoners) {
            type = enemyTypes[Math.floor(Math.random() * getUnlockedEnemyCount())];
        }
    }

    if (type && type.special === "healer") {
        const maxHealers = Math.max(1, Math.min(2, Math.floor(enemiesToSpawn / 32)));
        const currentHealers = enemies.filter(e => e.special === "healer").length;
        if (currentHealers >= maxHealers) {
            type = enemyTypes[Math.floor(Math.random() * getUnlockedEnemyCount())];
        }
    }

    const spawnOptions = {};
    if (type && type.special === "doombringer") {
        // El Titán Negro también aparece en la zona central de jefes,
        // no desde los bordes del mapa.
        spawnOptions.spawnPoint = getBossSpawnPoint();
        if (forcedTitanVariant) spawnOptions.titanVariant = forcedTitanVariant;
    }

    enemies.push(createEnemyFromType(type, spawnOptions));
    enemiesSpawned++;
}

function getBossHpScaling() {
    if (wave <= 45) return 1 + wave * 0.28;
    return 1 + 45 * 0.28 + Math.pow(wave - 45, 0.82) * 0.72;
}

function getBossSpeedScaling() {
    if (wave <= 80) return wave * 0.0045;
    return 80 * 0.0045 + Math.min(0.75, Math.log10(wave - 70) * 0.08);
}

function spawnMiniEnemy(x, y, options = {}) {
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
        isMini: true,
        summonedById: options.summonedById || null,
        summonBatchId: options.summonBatchId || null
    }));
}

function getActiveSummonedMinionsFor(summoner) {
    if (!summoner || !summoner.id) return [];
    return (enemies || []).filter(enemy => (
        enemy &&
        enemy.hp > 0 &&
        enemy.isMini &&
        enemy.summonedById === summoner.id
    ));
}

function canSummonerCreateBatch(summoner) {
    return getActiveSummonedMinionsFor(summoner).length <= SUMMONER_MAX_ACTIVE_MINIONS - SUMMONER_BATCH_SIZE;
}


function createBossFromType(type) {
    const spawnPoint = getBossSpawnPoint();
    const hpScaling = getBossHpScaling();
    const speedScaling = getBossSpeedScaling();
    const boss = {
        id: Date.now() + Math.random(),
        x: spawnPoint.x,
        y: spawnPoint.y,
        radius: 30,
        color: type.color,
        hp: Math.ceil(type.hp * hpScaling),
        maxHp: Math.ceil(type.hp * hpScaling),
        baseSpeed: (type.speed + speedScaling) * ENEMY_SURVIVAL_SPEED_MULTIPLIER,
        originalBaseSpeed: (type.speed + speedScaling) * ENEMY_SURVIVAL_SPEED_MULTIPLIER,
        speed: (type.speed + speedScaling) * ENEMY_SURVIVAL_SPEED_MULTIPLIER,
        reward: getEnemyRewardForWave(type.reward),
        scoreValue: type.score + getWaveScoreBonus(),
        damageToDefense: Math.ceil(scaleEnemyDamageForRepeat(type.damageToDefense) * getEventEnemyDamageMultiplier()),
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
    };
    return boss;
}

function spawnBoss() {
    bossSpawnedThisWave = true;
    const type = getBossTypeForWave();
    const hpScaling = getBossHpScaling();
    const repeatStrength = getRepeatEnemyStrengthMultiplier();
    const maxHp = Math.ceil(type.hp * hpScaling * repeatStrength);
    const speed = (type.speed + getBossSpeedScaling()) * ENEMY_SURVIVAL_SPEED_MULTIPLIER;

    const spawn = getBossSpawnPoint();
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
        reward: getBossRewardForWave(type.reward),
        scoreValue: type.score + getWaveScoreBonus() * 10,
        damageToDefense: Math.ceil(scaleEnemyDamageForRepeat(type.damageToDefense) * getEventEnemyDamageMultiplier()),
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
        sourceTower: tower,
        bornAt: getGameTime(),
        maxAge: options.maxAge ?? 6500
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
        const doubleShotActive = now < player.doubleShotUntil || Math.random() < (player.passiveDoubleShotChance || 0);
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
                hitEnemies: [],
                bornAt: getGameTime(),
                maxAge: 5200
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
                healDefensesAndPlayer(tower.drainAmount || 2, tower.x, tower.y);
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

function getPlayerBarricadeBlockAt(x, y, ignoredBarricade = null) {
    if (!player) return null;
    for (const b of (barricades || [])) {
        if (b === ignoredBarricade) continue;
        if (!b.active || b.hp <= 0 || b.isOpen) continue;
        if (circleIntersectsBarricade(x, y, 22, b, 2)) return b;
    }
    return null;
}

function isPlayerBarricadeBlockedAt(x, y, ignoredBarricade = null) {
    return !!getPlayerBarricadeBlockAt(x, y, ignoredBarricade);
}

function resolvePlayerBarricadeCollision(oldX, oldY) {
    if (!player) return false;
    const blocker = getPlayerBarricadeBlockAt(player.x, player.y);
    if (blocker) {
        player.x = oldX;
        player.y = oldY;
        return true;
    }
    return false;
}

function tryMovePlayerWithBarricadeSlide(moveX, moveY) {
    if (!player) return;
    const oldX = player.x;
    const oldY = player.y;
    let targetX = clampWorldX(oldX + moveX, 32);
    let targetY = clampWorldY(oldY + moveY, 32);
    const firstBlocker = getPlayerBarricadeBlockAt(targetX, targetY);

    if (!firstBlocker) {
        player.x = targetX;
        player.y = targetY;
        return;
    }

    // Si el movimiento completo choca, proyectamos el movimiento sobre la línea real
    // de la barricada. Esto permite resbalar sobre muros verticales, horizontales y
    // diagonales sin crear una caja invisible ni frenar al jugador en seco.
    const seg = getBarricadeSegment(firstBlocker);
    const wallDx = seg.x2 - seg.x1;
    const wallDy = seg.y2 - seg.y1;
    const wallLength = Math.hypot(wallDx, wallDy) || 1;
    const tangentX = wallDx / wallLength;
    const tangentY = wallDy / wallLength;
    const dot = moveX * tangentX + moveY * tangentY;
    const slideX = tangentX * dot;
    const slideY = tangentY * dot;

    const slideTargetX = clampWorldX(oldX + slideX, 32);
    const slideTargetY = clampWorldY(oldY + slideY, 32);
    if ((Math.abs(slideX) > 0.01 || Math.abs(slideY) > 0.01) && !isPlayerBarricadeBlockedAt(slideTargetX, slideTargetY)) {
        player.x = slideTargetX;
        player.y = slideTargetY;
        return;
    }

    // Fallback clásico por ejes: ayuda mucho en esquinas y contra los extremos de las
    // barricadas cuando el jugador llega con movimiento diagonal.
    const xOnly = clampWorldX(oldX + moveX, 32);
    if (Math.abs(moveX) > 0.01 && !isPlayerBarricadeBlockedAt(xOnly, oldY)) {
        player.x = xOnly;
        player.y = oldY;
        return;
    }

    const yOnly = clampWorldY(oldY + moveY, 32);
    if (Math.abs(moveY) > 0.01 && !isPlayerBarricadeBlockedAt(oldX, yOnly)) {
        player.x = oldX;
        player.y = yOnly;
        return;
    }

    player.x = oldX;
    player.y = oldY;
}

function clampPlayerToPlayableArea() {
    if (!player) return;
    player.x = clampWorldX(player.x, 32);
    player.y = clampWorldY(player.y, 32);
}

function updatePlayerMovement() {
    if (isPaused || !player || (!waveInProgress && !buildPhaseActive)) {
        if (player) player.isMoving = false;
        return;
    }

    let dx = 0;
    let dy = 0;

    if (pressedKeys.has(controlBindings.moveLeft)) dx -= 1;
    if (pressedKeys.has(controlBindings.moveRight)) dx += 1;
    if (pressedKeys.has(controlBindings.moveUp)) dy -= 1;
    if (pressedKeys.has(controlBindings.moveDown)) dy += 1;

    player.isMoving = dx !== 0 || dy !== 0;
    if (dx === 0 && dy === 0) {
        player.sprinting = false;
        player.stamina = Math.min(player.maxStamina || PLAYER_STAMINA_MAX, (player.stamina ?? PLAYER_STAMINA_MAX) + (PLAYER_STAMINA_REGEN_PER_SECOND / 60) * frameScale);
        return;
    }

    const oldX = player.x;
    const oldY = player.y;
    const length = Math.hypot(dx, dy) || 1;
    dx /= length;
    dy /= length;
    player.lastMoveX = dx;
    player.lastMoveY = dy;

    // La velocidad x2/x4 debe acelerar al jugador en la misma proporción que al resto
    // del juego. Antes el jugador solo escalaba con sqrt(gameSpeed), pero los enemigos
    // escalaban linealmente, entonces en x4 los bichos pasaban a ser mucho más rápidos
    // que el jugador aunque en x1 fueran más lentos.
    const wantsSprint = isShiftDown && (player.stamina ?? PLAYER_STAMINA_MAX) > PLAYER_STAMINA_MIN_TO_SPRINT;
    player.sprinting = wantsSprint;
    if (wantsSprint) {
        player.stamina = Math.max(0, (player.stamina ?? PLAYER_STAMINA_MAX) - (PLAYER_STAMINA_DRAIN_PER_SECOND / 60) * frameScale);
    } else {
        player.stamina = Math.min(player.maxStamina || PLAYER_STAMINA_MAX, (player.stamina ?? PLAYER_STAMINA_MAX) + (PLAYER_STAMINA_REGEN_PER_SECOND / 60) * frameScale);
    }
    const speed = player.moveSpeed * (wantsSprint ? PLAYER_SPRINT_SPEED_MULTIPLIER : 1) * gameSpeed * frameScale;

    tryMovePlayerWithBarricadeSlide(dx * speed, dy * speed);
    clampPlayerToPlayableArea();
    resolvePlayerEnemyCollision(oldX, oldY);
}

function updateSpearTower(tower) {
    const now = getGameTime();
    const delay = getTowerDelay(tower);
    if (now - tower.lastShotTime < delay) return;

    const dir = getDirectionVector(tower.rotation || 0);
    const range = tower.range || 150;
    const laneWidth = tower.laneWidth || 38;
    let bestEnemy = null;
    let bestForward = Infinity;

    enemies.forEach(enemy => {
        if (enemy.untargetable || enemy.hp <= 0) return;
        const rx = enemy.x - tower.x;
        const ry = enemy.y - tower.y;
        const forward = rx * dir.x + ry * dir.y;
        if (forward < 0 || forward > range + enemy.radius) return;
        const side = Math.abs(rx * -dir.y + ry * dir.x);
        if (side <= laneWidth / 2 + enemy.radius && forward < bestForward) {
            bestEnemy = enemy;
            bestForward = forward;
        }
    });

    if (!bestEnemy) return;

    tower.lastShotTime = now;
    const damage = getTowerDamage(tower);
    enemies.forEach(enemy => {
        if (enemy.untargetable || enemy.hp <= 0) return;
        const rx = enemy.x - tower.x;
        const ry = enemy.y - tower.y;
        const forward = rx * dir.x + ry * dir.y;
        if (forward < 0 || forward > range + enemy.radius) return;
        const side = Math.abs(rx * -dir.y + ry * dir.x);
        if (side <= laneWidth / 2 + enemy.radius) {
            damageEnemy(enemy, damage, false, tower.color, "tower");
            enemy.hitFlash = 0.75;
        }
    });

    effects.push({ type: "spear", x: tower.x, y: tower.y, dx: dir.x, dy: dir.y, length: range, width: laneWidth, life: 10, color: tower.color });
    for (let i = enemies.length - 1; i >= 0; i--) {
        if (enemies[i].hp <= 0) killEnemy(i);
    }
}


function updateLaserTower(tower) {
    const now = getGameTime();
    const range = tower.range || 0;
    let target = tower.laserTarget;

    if (!target || target.hp <= 0 || target.untargetable || Math.hypot(target.x - tower.x, target.y - tower.y) > range + (target.radius || 0)) {
        target = findClosestEnemy(tower.x, tower.y, range);
        tower.laserTarget = target;
    }

    if (!target) {
        tower.laserCharge = Math.max(0, (tower.laserCharge || 0) - 0.08 * frameScale);
        return;
    }

    const tickDelay = Math.max(55, tower.fireDelay || 120);
    if (!tower.lastShotTime) tower.lastShotTime = now - tickDelay;
    const elapsed = Math.max(0, now - tower.lastShotTime);

    if (elapsed >= tickDelay) {
        const ticks = Math.min(4, Math.floor(elapsed / tickDelay));
        const damagePerSecond = getTowerDamage(tower);
        const tickDamage = damagePerSecond * (tickDelay / 1000) * ticks;
        tower.lastShotTime += tickDelay * ticks;
        target.hp -= tickDamage;
        target.hitFlash = 1;
        tower.laserCharge = Math.min(1, (tower.laserCharge || 0) + 0.16 * ticks);

        if (now - (tower.lastLaserTextAt || 0) >= 360) {
            tower.lastLaserTextAt = now;
            addDamageText(target.x, target.y - (target.radius || 12), damagePerSecond * 0.36, false, tower.color);
            playHitSound();
        }

        if (target.hp <= 0) {
            const idx = enemies.indexOf(target);
            tower.laserTarget = null;
            if (idx >= 0) killEnemy(idx);
        }
    }
}

function updateTowers() {
    applyTowerBuffs();

    towers.forEach(tower => {
        ensureTowerEconomy(tower);
        if (!tower.owned || tower.hp <= 0 || tower.type === "buffer") return;

        if (tower.type === "spear") {
            updateSpearTower(tower);
            return;
        }

        if (tower.type === "laser") {
            updateLaserTower(tower);
            return;
        }

        if (tower.type === "blade") {
            const now = getGameTime();
            const delay = getTowerDelay(tower);
            if (now - tower.lastShotTime >= delay) {
                let hitCount = 0;
                enemies.forEach(enemy => {
                    if (enemy.untargetable || enemy.hp <= 0) return;
                    const dist = Math.hypot(enemy.x - tower.x, enemy.y - tower.y);
                    if (dist <= tower.range + enemy.radius) {
                        damageEnemy(enemy, getTowerDamage(tower), false, tower.color, "tower");
                        enemy.hitFlash = 0.8;
                        hitCount++;
                    }
                });
                if (hitCount > 0) {
                    tower.lastShotTime = now;
                    effects.push({ type: "circle", x: tower.x, y: tower.y, radius: 10, maxRadius: tower.range, life: 12, color: tower.color });
                    for (let i = enemies.length - 1; i >= 0; i--) {
                        if (enemies[i].hp <= 0) killEnemy(i);
                    }
                }
            }
            return;
        }

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


function updateTitanVariantSpecials(enemy, now) {
    if (!enemy || enemy.special !== "doombringer" || enemy.hp <= 0) return;
    if (now - (enemy.lastTitanSpecialAt || 0) < (enemy.titanSpecialCooldown || 2800)) return;
    enemy.lastTitanSpecialAt = now;

    if (enemy.titanVariant === "burn") {
        const tx = player ? player.x : enemy.x;
        const ty = player ? player.y : enemy.y;
        fireBossProjectile(enemy.x, enemy.y, tx, ty, {
            speed: 3.35,
            radius: 9,
            damage: Math.max(3, Math.ceil(3 + wave * 0.055)),
            color: "#8b42ff",
            life: 4600,
            burn: true
        });
        effects.push({ type: "circle", x: enemy.x, y: enemy.y, radius: 8, maxRadius: 48, life: 16, color: "#8b42ff" });
        return;
    }

    if (enemy.titanVariant === "dash") {
        const tx = player ? player.x : enemy.x;
        const ty = player ? player.y : enemy.y;
        const angle = Math.atan2(ty - enemy.y, tx - enemy.x);
        const distance = enemy.titanCopy ? 85 : 135;
        const oldX = enemy.x;
        const oldY = enemy.y;
        const wantedX = clampWorldX(enemy.x + Math.cos(angle) * distance, enemy.radius + 4);
        const wantedY = clampWorldY(enemy.y + Math.sin(angle) * distance, enemy.radius + 4);
        const safePoint = getSafeMythicTeleportPoint(enemy, wantedX, wantedY, oldX, oldY);
        enemy.x = safePoint.x;
        enemy.y = safePoint.y;
        enemy.knockbackX = 0;
        effects.push({ type: "line", x1: oldX, y1: oldY, x2: enemy.x, y2: enemy.y, life: 22, color: "#222222" });
        effects.push({ type: "circle", x: enemy.x, y: enemy.y, radius: 14, maxRadius: 82, life: 22, color: "#050505" });
        return;
    }

    if (enemy.titanVariant === "split" && !enemy.titanSplitDone && !enemy.titanCopy) {
        enemy.titanSplitDone = true;
        showCenterMessage(`EL TITÁN SE TRIPLICA
La sombra aprendió a dividirse.`, 1700, "titan");
        for (let i = 0; i < 2; i++) {
            const angle = Math.PI * 2 * (i / 2) + Math.random() * 0.55;
            const cloneType = specialEnemyTypes.find(t => t.special === "doombringer");
            enemies.push(createEnemyFromType(cloneType, {
                x: clampWorldX(enemy.x + Math.cos(angle) * 72, 44),
                y: clampWorldY(enemy.y + Math.sin(angle) * 72, 44),
                titanVariant: TITAN_VARIANTS.find(v => v.key === "split"),
                titanCopy: true,
                ignoreScaling: false,
                reward: Math.max(8, Math.floor(enemy.reward * 0.25)),
                scoreValue: Math.max(30, Math.floor(enemy.scoreValue * 0.25))
            }));
        }
        effects.push({ type: "circle", x: enemy.x, y: enemy.y, radius: 18, maxRadius: 120, life: 34, color: "#b64dff" });
    }
}

function updateEnemySpecials(now, defenseLineX) {
    enemies.forEach(enemy => {
        updateTitanVariantSpecials(enemy, now);
        enforceTitanOutsidePlayerBase(enemy);

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

        if (enemy.special === "summoner" && !enemy.isAttacking && enemies.length < 120 && now - enemy.lastSummonTime >= enemy.summonDelay) {
            enemy.lastSummonTime = now;

            if (canSummonerCreateBatch(enemy)) {
                const batchId = `${enemy.id}-${now}`;

                for (let i = 0; i < SUMMONER_BATCH_SIZE; i++) {
                    const angle = (Math.PI * 2 / SUMMONER_BATCH_SIZE) * i;
                    spawnMiniEnemy(enemy.x + Math.cos(angle) * 28, enemy.y + Math.sin(angle) * 28, {
                        summonedById: enemy.id,
                        summonBatchId: batchId
                    });
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
            } else {
                effects.push({
                    type: "circle",
                    x: enemy.x,
                    y: enemy.y,
                    radius: 6,
                    maxRadius: 34,
                    life: 14,
                    color: "#8f8f8f"
                });
            }
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
        isBossProjectile: true,
        burn: Boolean(options.burn)
    });
}

function getBossProjectileBarricadeHit(projectile) {
    return (barricades || []).find(b => {
        if (!b.active || b.hp <= 0 || b.isOpen) return false;
        // Usa la misma colisión real de barricadas que usan los enemigos.
        // Esto incluye las diagonales, evitando que las balas de jefe las atraviesen.
        return circleIntersectsBarricade(projectile.x, projectile.y, (projectile.radius || 8) + 3, b, 0);
    });
}

function getBossProjectileBarricadeImpactPoint(projectile, barricade) {
    if (!projectile || !barricade) return { x: projectile?.x || 0, y: projectile?.y || 0 };
    if (isDiagonalBarricade(barricade.orientation || "horizontal")) {
        const seg = getBarricadeSegment(barricade);
        const info = distancePointToSegment(projectile.x, projectile.y, seg.x1, seg.y1, seg.x2, seg.y2);
        return { x: info.closestX, y: info.closestY };
    }
    const rect = getEntityRect({ ...barricade, isBuildBarricade: true });
    return {
        x: Math.max(rect.left, Math.min(rect.right, projectile.x)),
        y: Math.max(rect.top, Math.min(rect.bottom, projectile.y))
    };
}

function getBossProjectileMineHit(projectile) {
    return (mines || []).find(mine => {
        if (!mine || mine.hp <= 0) return false;
        return Math.hypot(projectile.x - mine.x, projectile.y - mine.y) <= projectile.radius + (mine.radius || MINE_COLLISION_RADIUS);
    });
}

function getBossProjectileTowerHit(projectile) {
    return (towers || []).find(tower => {
        if (!tower || !tower.owned || tower.hp <= 0) return false;
        return Math.hypot(projectile.x - tower.x, projectile.y - tower.y) <= (projectile.radius || 8) + TOWER_COLLISION_RADIUS;
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
            const wantedX = clampWorldX(Math.max(defenseLineX + 80, enemy.x - 135) + 42, 42);
            const wantedY = clampWorldY(player.y + (Math.random() - 0.5) * 150, 55);
            const safePoint = getSafeMythicTeleportPoint(enemy, wantedX, wantedY, oldX, oldY);
            enemy.x = safePoint.x;
            enemy.y = safePoint.y;
            fireBossProjectile(enemy.x, enemy.y, player.x, player.y, { speed: 5.0, radius: 8, damage: 5, color: "#d58cff" });
            fireBossProjectile(enemy.x, enemy.y, player.x, player.y, { speed: 4.6, radius: 7, damage: 4, color: "#d58cff", angleOffset: 0.18 });
            fireBossProjectile(enemy.x, enemy.y, player.x, player.y, { speed: 4.6, radius: 7, damage: 4, color: "#d58cff", angleOffset: -0.18 });
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


function applyExtraBossVariantBehavior(enemy, now) {
    if (!enemy || !enemy.isBoss || enemy.hp <= 0) return;
    if (enemy.bossVariant === "jailer" && now - enemy.lastBossSpecialTime > enemy.bossSpecialCooldown) {
        enemy.lastBossSpecialTime = now;
        const angle = Math.random() * Math.PI * 2;
        const x = clampWorldX(player.x + Math.cos(angle) * 70, 40);
        const y = clampWorldY(player.y + Math.sin(angle) * 70, 40);
        const b = createFreeBarricade("standard", x, y, Math.random() < 0.5 ? "horizontal" : "vertical");
        b.name = "Jaula del Carcelero"; b.active = true; b.tier = 0; b.maxHp = 18 + wave * 0.7; b.hp = b.maxHp; b.color = enemy.color; b.enemyMade = true;
        barricades.push(b);
        showCenterMessage("¡Jaula del Carcelero!", 700);
    }
    if (enemy.bossVariant === "oracle" && now - enemy.lastBossSpecialTime > enemy.bossSpecialCooldown) {
        enemy.lastBossSpecialTime = now;
        createFireZone(player.x, player.y, 74, 2.2 + wave * 0.02, 1900, 430);
        showCenterMessage("El Oráculo marcó tu posición", 700);
    }
    if (enemy.bossVariant === "commander") {
        (enemies || []).forEach(other => { if (other !== enemy && other.hp > 0 && Math.hypot(other.x-enemy.x, other.y-enemy.y)<230) other.speed = Math.max(other.speed, other.baseSpeed * 1.18); });
    }
    if (enemy.bossVariant === "collector" && now - enemy.lastBossSpecialTime > enemy.bossSpecialCooldown) {
        enemy.lastBossSpecialTime = now;
        const tax = Math.min(coins, Math.ceil(8 + wave * 0.8));
        if (tax > 0) { coins -= tax; addDamageText(enemy.x, enemy.y - 60, `-${formatMoney(tax)} oro`, false, "#ffd84a"); }
    }
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
            // Las balas de jefe ahora se consumen al pegar contra defensas.
            // Así las barricadas/torres funcionan como escudo real para el jugador.
            const impact = getBossProjectileBarricadeImpactPoint(p, hitBarricade);
            damageBarricade(hitBarricade, p.damage, p);
            if (p.burn) createFireZone(impact.x, impact.y, 54, Math.max(1.2, p.damage * 0.28), 1800, 450);
            createImpactParticles(impact.x, impact.y, p.color);
            addDamageText(impact.x + 20, impact.y - 18, p.damage * BOSS_BARRICADE_DAMAGE_MULTIPLIER, false, "#ffb36b");
            bossProjectiles.splice(i, 1);
            continue;
        }

        const hitTower = getBossProjectileTowerHit(p);
        if (hitTower) {
            damageTower(hitTower, p.damage, p);
            if (p.burn) createFireZone(hitTower.x, hitTower.y, 54, Math.max(1.2, p.damage * 0.28), 1800, 450);
            createImpactParticles(hitTower.x, hitTower.y, p.color);
            bossProjectiles.splice(i, 1);
            continue;
        }

        const hitMine = getBossProjectileMineHit(p);
        if (hitMine) {
            damageMine(hitMine, p.damage, p);
            if (p.burn) createFireZone(hitMine.x, hitMine.y, 54, Math.max(1.2, p.damage * 0.28), 1800, 450);
            bossProjectiles.splice(i, 1);
            continue;
        }

        if (player && Math.hypot(p.x - player.x, p.y - player.y) <= p.radius + 18) {
            if (player.immortal) {
                createImpactParticles(player.x, player.y, "#ffe28a");
            } else {
                const ended = damagePlayer(p.damage, p, player.x, player.y, "¡Te alcanzó un proyectil!");
                if (p.burn) { createFireZone(player.x, player.y, 60, Math.max(1.2, p.damage * 0.25), 1800, 450); }
                if (ended) return;
            }
            bossProjectiles.splice(i, 1);
        }
    }
}

function resolveEnemyCollisions() {
    if (!enemies || enemies.length < 2) return;

    const cellSize = 54;
    const grid = new Map();

    enemies.forEach((enemy, index) => {
        if (!enemy || enemy.hp <= 0) return;
        const cx = Math.floor(enemy.x / cellSize);
        const cy = Math.floor(enemy.y / cellSize);
        const key = `${cx},${cy}`;
        if (!grid.has(key)) grid.set(key, []);
        grid.get(key).push(index);
    });

    const checked = new Set();
    enemies.forEach((a, i) => {
        if (!a || a.hp <= 0) return;
        const cx = Math.floor(a.x / cellSize);
        const cy = Math.floor(a.y / cellSize);

        for (let gx = cx - 1; gx <= cx + 1; gx++) {
            for (let gy = cy - 1; gy <= cy + 1; gy++) {
                const bucket = grid.get(`${gx},${gy}`);
                if (!bucket) continue;

                bucket.forEach(j => {
                    if (j <= i) return;
                    const key = `${i}:${j}`;
                    if (checked.has(key)) return;
                    checked.add(key);

                    const b = enemies[j];
                    if (!b || b.hp <= 0) return;
                    const minDist = (a.radius || 12) + (b.radius || 12) + 3;
                    let dx = b.x - a.x;
                    let dy = b.y - a.y;
                    let dist = Math.hypot(dx, dy);
                    if (dist >= minDist) return;

                    if (dist < 0.001) {
                        const angle = ((i * 73 + j * 41) % 360) * Math.PI / 180;
                        dx = Math.cos(angle);
                        dy = Math.sin(angle);
                        dist = 1;
                    }

                    const overlap = (minDist - dist) * 0.5;
                    const nx = dx / dist;
                    const ny = dy / dist;
                    const aMass = a.isBoss ? 2.6 : 1;
                    const bMass = b.isBoss ? 2.6 : 1;
                    const totalMass = aMass + bMass;

                    a.x -= nx * overlap * (bMass / totalMass) * 1.4;
                    a.y -= ny * overlap * (bMass / totalMass) * 1.4;
                    b.x += nx * overlap * (aMass / totalMass) * 1.4;
                    b.y += ny * overlap * (aMass / totalMass) * 1.4;

                    a.x = clampWorldX(a.x, (a.radius || 12) + 3);
                    a.y = clampWorldY(a.y, (a.radius || 12) + 3);
                    b.x = clampWorldX(b.x, (b.radius || 12) + 3);
                    b.y = clampWorldY(b.y, (b.radius || 12) + 3);
                });
            }
        }
    });
}


function damageTower(tower, amount, sourceEnemy = null) {
    if (!tower || tower.hp <= 0) return;
    ensureTowerEconomy(tower);
    const isVisitorProjectile = !!(sourceEnemy && (sourceEnemy.isVisitorProjectile || sourceEnemy.sourceSpecial === "visitor"));
    const finalAmount = isVisitorProjectile ? amount * 0.78 : ((sourceEnemy && (sourceEnemy.isBoss || sourceEnemy.isBossProjectile)) ? amount * 1.15 : amount);
    tower.hp -= finalAmount;
    awardVisitorGold(finalAmount);
    createImpactParticles(tower.x, tower.y, sourceEnemy && sourceEnemy.color ? sourceEnemy.color : "#ff7777");
    addDamageText(tower.x, tower.y - 24, finalAmount, false, "#ff7777");
    if (tower.hp <= 0) {
        const name = tower.name || "Torre";
        towers = towers.filter(t => t !== tower);
        updateTowerSlotIndexes();
        selectedStructureIds = selectedStructureIds.filter(id => String(id) !== String(tower.id));
        showCenterMessage(`¡${name} destruida!`, 900);
        updateHud(true);
    }
}

function getBlockingTowerForEnemy(enemy) {
    let best = null;
    let bestDist = Infinity;
    (towers || []).forEach(tower => {
        if (!tower || !tower.owned || tower.hp <= 0) return;
        const d = Math.hypot(enemy.x - tower.x, enemy.y - tower.y);
        const touchDistance = (enemy.radius || 12) + TOWER_COLLISION_RADIUS + 5;
        if (d <= touchDistance && d < bestDist) {
            best = tower;
            bestDist = d;
        }
    });
    return best;
}

function resolvePlayerEnemyCollision(oldX = player ? player.x : 0, oldY = player ? player.y : 0) {
    if (!player || !enemies || enemies.length === 0) return;
    let blocked = false;
    enemies.forEach(enemy => {
        if (!enemy || enemy.hp <= 0 || enemy.untargetable) return;
        const minDist = (enemy.radius || 12) + 22;
        let dx = player.x - enemy.x;
        let dy = player.y - enemy.y;
        let dist = Math.hypot(dx, dy);
        if (dist >= minDist) return;
        blocked = true;
        if (dist < 0.001) {
            dx = player.x >= oldX ? 1 : -1;
            dy = 0;
            dist = 1;
        }
        const nx = dx / dist;
        const ny = dy / dist;
        const overlap = minDist - dist;
        player.x += nx * overlap * 0.72;
        player.y += ny * overlap * 0.72;
        // El enemigo también cede un poquito para que no sea una pared perfecta.
        enemy.x -= nx * overlap * (enemy.isBoss ? 0.08 : 0.18);
        enemy.y -= ny * overlap * (enemy.isBoss ? 0.08 : 0.18);
        enemy.x = clampWorldX(enemy.x, (enemy.radius || 12) + 3);
        enemy.y = clampWorldY(enemy.y, (enemy.radius || 12) + 3);
    });
    if (blocked) {
        clampPlayerToPlayableArea();
        resolvePlayerBarricadeCollision(oldX, oldY);
    }
}

function getBleedTickDamage(enemy, sourcePower = 1) {
    const hpPart = (enemy.maxHp || 1) * (enemy.isBoss ? 0.006 : 0.014);
    const wavePart = Math.pow(Math.max(1, wave), 0.45) * 0.035;
    return Math.max(0.45, (hpPart + wavePart) * sourcePower * (player?.bleedPowerMultiplier || 1));
}

function applyBleed(enemy, sourcePower = 1, duration = 3000) {
    if (!enemy || enemy.hp <= 0) return;
    const now = getGameTime();
    const tickDamage = getBleedTickDamage(enemy, sourcePower);
    enemy.bleedUntil = Math.max(enemy.bleedUntil || 0, now + duration);
    enemy.bleedTickDamage = Math.max(enemy.bleedTickDamage || 0, tickDamage);
    enemy.nextBleedTickAt = Math.min(enemy.nextBleedTickAt || now, now + 500);
}

function updateBleeds(now = getGameTime()) {
    enemies.forEach(enemy => {
        if (!enemy.bleedUntil || enemy.bleedUntil <= now || enemy.hp <= 0) return;
        if (!enemy.nextBleedTickAt || now >= enemy.nextBleedTickAt) {
            enemy.nextBleedTickAt = now + 500;
            damageEnemy(enemy, enemy.bleedTickDamage || 0.5, false, "#ff6b6b", "bleed");
            enemy.hitFlash = 0.55;
        }
    });
    for (let i = enemies.length - 1; i >= 0; i--) {
        if (enemies[i].hp <= 0) killEnemy(i);
    }
}

function createTrap(typeKey, x, y) {
    const def = trapDefinitions[typeKey];
    if (!def) return null;
    return { id: Date.now() + Math.random(), type: typeKey, x, y, radius: def.radius, color: def.color, name: def.name, cost: def.cost };
}

function triggerTrap(trap, enemy) {
    if (!trap || !enemy) return;
    if (trap.type === "snare") {
        enemy.slowMultiplier = 0;
        enemy.slowUntil = getGameTime() + trapDefinitions.snare.duration;
        effects.push({ type: "circle", x: trap.x, y: trap.y, radius: 8, maxRadius: 58, life: 18, color: trap.color });
        showCenterMessage("¡Enemigo atrapado!", 550);
    }
    if (trap.type === "bleed") {
        const def = trapDefinitions.bleed;
        enemy.slowMultiplier = Math.min(enemy.slowMultiplier || 1, def.slowAmount);
        enemy.slowUntil = Math.max(enemy.slowUntil || 0, getGameTime() + def.slowDuration);
        applyBleed(enemy, 1.15, def.bleedDuration);
        effects.push({ type: "circle", x: trap.x, y: trap.y, radius: 8, maxRadius: 54, life: 16, color: trap.color });
    }
}

function updateTraps() {
    if (!traps || !traps.length || !enemies || !enemies.length) return;
    for (let i = traps.length - 1; i >= 0; i--) {
        const trap = traps[i];
        const enemy = enemies.find(e => e.hp > 0 && !e.untargetable && Math.hypot(e.x - trap.x, e.y - trap.y) <= (trap.radius || TRAP_COLLISION_RADIUS) + e.radius);
        if (!enemy) continue;
        triggerTrap(trap, enemy);
        traps.splice(i, 1);
    }
}


function tryDropTitanShard(enemy) {
    if (!enemy || enemy.special !== "doombringer") return false;
    const rewardWave = Math.max(1, Math.floor(Number(enemy.spawnWave) || Number(wave) || 1));

    // Las copias del Titán Trino no dan recompensa: la variante completa entrega solo 1 mejora.
    if (enemy.titanCopy) return false;

    // Repetir una oleada con Titán no permite farmear mejoras.
    if (isRepeatingWave) return false;
    if (titanRewardedWaves && titanRewardedWaves[rewardWave]) return false;

    titanRewardedWaves = titanRewardedWaves || {};
    titanRewardedWaves[rewardWave] = true;
    dropTitanShard(enemy.x, enemy.y, rewardWave);
    return true;
}

function dropTitanShard(x, y, rewardWave = wave) {
    titanShards = titanShards || [];
    titanShards.push({ id: Date.now() + Math.random(), x, y, rewardWave, radius: TITAN_SHARD_RADIUS, color: "#b64dff" });
    showCenterMessage(`FRAGMENTO DEL TITÁN
Una astilla del Abismo quedó en el suelo.`, 1700, "titan-reward");
}

function updateTitanShards() {
    if (!player || !titanShards || !titanShards.length || pendingTitanReward) return;
    for (let i = titanShards.length - 1; i >= 0; i--) {
        const shard = titanShards[i];
        if (Math.hypot(player.x - shard.x, player.y - shard.y) <= 28 + (shard.radius || TITAN_SHARD_RADIUS)) {
            titanShards.splice(i, 1);
            openTitanRewardChoice();
            autoSaveRun(true);
            break;
        }
    }
}

function getTitanRewardPool() {
    const lockedAbilityKeys = Object.keys(abilities || {}).filter(key => abilities[key] && !abilities[key].owned);
    const pool = [
        { type: "crit", title: "+2% crítico", desc: "Aumenta permanentemente la chance crítica.", apply: () => { player.critChance = Math.min(0.75, (player.critChance || 0) + 0.02); } },
        { type: "lifesteal", title: "+2% robo de vida", desc: "Robo de vida permanente para disparos del jugador.", apply: () => { player.permanentLifeStealPercent = Math.min(0.35, (player.permanentLifeStealPercent || 0) + 0.02); } },
        { type: "bleedGold", title: "Sangrado + oro", desc: "+8% oro y +10% potencia de sangrado.", apply: () => { player.goldBonusMultiplier = (player.goldBonusMultiplier || 1) + 0.08; player.bleedPowerMultiplier = (player.bleedPowerMultiplier || 1) + 0.10; } },
        { type: "double", title: "+3% doble disparo", desc: "Chance permanente de doble disparo pasivo.", apply: () => { player.passiveDoubleShotChance = Math.min(0.35, (player.passiveDoubleShotChance || 0) + 0.03); } },
        { type: "towerSlot", title: "+1 slot de torre", desc: "Aumenta la capacidad máxima si todavía hay lugar.", apply: () => { towerSlotLimit = clampTowerSlotLimit(towerSlotLimit + 1); } },
        { type: "gold", title: "Bolsa violeta", desc: "Gana oro escalado por oleada.", apply: () => { coins += getGoldAmount(450 + wave * 28); } },
        { type: "items", title: "Pack de consumibles", desc: "Recibís pociones útiles al inventario.", apply: () => { addConsumableToInventory("shieldPotion"); addConsumableToInventory("attackSpeedPotion"); addConsumableToInventory("mediumPotion"); } },
        { type: "freeRapid", title: "Torre rápida gratis", desc: "Te coloca una torre rápida en la mochila de construcción como reembolso en oro.", apply: () => { coins += costs.tower2 || 40; showCenterMessage("Oro para torre rápida recibido", 800); } },
        { type: "maxhp", title: "+8 vida máxima", desc: "Más margen para sobrevivir.", apply: () => { player.maxHp += 8; player.hp = Math.min(player.maxHp, player.hp + 8); } }
    ];
    lockedAbilityKeys.forEach(key => {
        pool.push({ type: "ability_" + key, title: `Habilidad: ${abilities[key].name}`, desc: "Desbloquea una habilidad que todavía no tenías.", apply: () => { abilities[key].owned = true; } });
    });
    return pool;
}

function pickTitanRewardOptions() {
    const pool = getTitanRewardPool();
    const picked = [];
    while (pool.length && picked.length < TITAN_REWARD_OPTION_COUNT) {
        const idx = Math.floor(Math.random() * pool.length);
        picked.push(pool.splice(idx, 1)[0]);
    }
    return picked.map((r, index) => ({ id: Date.now() + Math.random() + index, type: r.type, title: r.title, desc: r.desc }));
}

function openTitanRewardChoice() {
    pendingTitanReward = { options: pickTitanRewardOptions() };
    updateTitanRewardPanel();
}

function applyTitanRewardOption(option) {
    const reward = getTitanRewardPool().find(r => r.type === option.type);
    if (!reward) return;
    reward.apply();
    showCenterMessage(`Recompensa: ${reward.title}`, 1200);
    pendingTitanReward = null;
    updateTitanRewardPanel();
    updateHud(true);
    autoSaveRun(true);
}

function ensureTitanRewardPanel() {
    let panel = document.getElementById("titanRewardPanel");
    if (panel) return panel;
    panel = document.createElement("div");
    panel.id = "titanRewardPanel";
    panel.className = "titanRewardPanel hidden";
    document.body.appendChild(panel);
    panel.addEventListener("click", event => {
        const btn = event.target.closest("button[data-titan-reward-index]");
        if (!btn || !pendingTitanReward) return;
        const option = pendingTitanReward.options[Number(btn.dataset.titanRewardIndex)];
        if (option) applyTitanRewardOption(option);
    });
    return panel;
}

function updateTitanRewardPanel() {
    const panel = ensureTitanRewardPanel();
    if (!pendingTitanReward || !pendingTitanReward.options || !pendingTitanReward.options.length) {
        panel.classList.add("hidden");
        panel.innerHTML = "";
        return;
    }
    panel.classList.remove("hidden");
    panel.innerHTML = `<h2>Fragmento del Titán</h2><p>Elegí 1 recompensa</p><div class="titanRewardOptions">${pendingTitanReward.options.map((o, i) => `<button type="button" data-titan-reward-index="${i}"><strong>?</strong><span>${o.title}</span><small>${o.desc}</small></button>`).join("")}</div>`;
}


function updateNewEnemyBehaviors(now) {
    updateVisitorAlert();
    (enemies || []).forEach(enemy => {
        if (!enemy || enemy.hp <= 0) return;
        if (enemy.isBoss) applyExtraBossVariantBehavior(enemy, now);
        if (enemy.special === "ranged" && player && Math.hypot(enemy.x - player.x, enemy.y - player.y) < 520 && now - enemy.lastRangedShotAt >= (enemy.rangedCooldown || 2600)) {
            enemy.lastRangedShotAt = now;
            fireEnemyProjectile(enemy, player.x, player.y, { damage: Math.max(2, Math.ceil(2 + wave * 0.05)), color: enemy.color, speed: 3.8, radius: 5 });
        }
        if (enemy.special === "herald") {
            (enemies || []).forEach(other => {
                if (!other || other === enemy || other.hp <= 0) return;
                if (Math.hypot(other.x - enemy.x, other.y - enemy.y) <= (enemy.auraRadius || 160)) {
                    other.speed = Math.max(other.speed || 0, (other.baseSpeed || other.speed || 0) * (1 + (enemy.auraPower || 0.2)));
                    other.attackDelay = Math.max(420, (other.originalAttackDelay || other.attackDelay || 1000) * (1 - (enemy.auraPower || 0.2) * 0.55));
                }
            });
        }
    });
}

function clearVisitorProjectiles() {
    bossProjectiles = (bossProjectiles || []).filter(p => !(p && (p.isVisitorProjectile || p.sourceSpecial === "visitor")));
}

function fireEnemyProjectile(enemy, targetX, targetY, options = {}) {
    const angle = Math.atan2(targetY - enemy.y, targetX - enemy.x);
    bossProjectiles.push({
        x: enemy.x, y: enemy.y, radius: options.radius || 5, speed: options.speed || 4,
        dx: Math.cos(angle), dy: Math.sin(angle), color: options.color || "#ffb36b",
        damage: options.damage || 2, bornAt: getGameTime(), maxAge: 5200, life: options.life || 5200,
        isBossProjectile: true, sourceName: enemy.name, deathName: enemy.name,
        sourceSpecial: enemy.special || null,
        isVisitorProjectile: enemy.special === "visitor"
    });
}
function updateEnemies() {
    const now = getGameTime();
    const defenseLineX = getDefenseLineX();

    updateEnemySpecials(now, defenseLineX);
    updateBossSpecials(now, defenseLineX);
    updateBleeds(now);
    updateTraps();
    updateTitanShards();
    updateNewEnemyBehaviors(now);

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
        if (enemy.special === "visitor") {
            updateVisitorAI(enemy, now);
            continue;
        }
        const mainTarget = getEnemyMainTarget(enemy);

        if (enemy.special === "healer" && updateHealerMovementOnly(enemy, mainTarget)) {
            continue;
        }

        const blockingBarricade = enemy.special === "healer" ? null : getBlockingBarricadeForEnemy(enemy, mainTarget.x, mainTarget.y);

        if (blockingBarricade) {
            if (trySlideEnemyAlongBarricade(enemy, blockingBarricade, mainTarget.x, mainTarget.y)) {
                continue;
            }

            enemy.isAttacking = true;
            enemy.target = "barricade";

            if (enemy.bossVariant === "dvd") {
                if (now - enemy.lastAttackTime >= enemy.attackDelay) {
                    damageBarricade(blockingBarricade, enemy.damageToDefense, enemy);
                    createImpactParticles(blockingBarricade.x, blockingBarricade.y, "#9be7ff");
                    enemy.lastAttackTime = now;
                    enemy.x += (enemy.x < mainTarget.x ? -1 : 1) * 120;
                    enemy.dvdVy *= -1;
                    enemy.isAttacking = false;
                    effects.push({ type: "circle", x: enemy.x, y: enemy.y, radius: 10, maxRadius: 62, life: 18, color: "#9be7ff" });
                }
                continue;
            }

            if (enemy.special === "doombringer") {
            // marker inserted below after original titan styling

                enemy.damageToDefense = Math.min(enemy.damageToDefense || 0, 8);
                enemy.attackDelay = Math.min(enemy.attackDelay || 1600, 1600);
            }

            if (now - enemy.lastAttackTime >= enemy.attackDelay) {
                // Si el enemigo está pegando a una barricada, no debe consumir escudo ni contar como golpe al jugador.
                damageBarricade(blockingBarricade, enemy.damageToDefense, enemy);
                createImpactParticles(blockingBarricade.x, blockingBarricade.y, "#d6a05f");
                enemy.lastAttackTime = now;
            }
            continue;
        }

        const blockingTower = enemy.special === "healer" ? null : getBlockingTowerForEnemy(enemy);
        if (blockingTower) {
            enemy.isAttacking = true;
            enemy.target = "tower";
            if (now - enemy.lastAttackTime >= enemy.attackDelay) {
                damageTower(blockingTower, enemy.damageToDefense || 1, enemy);
                enemy.lastAttackTime = now;
            }
            continue;
        }

        const blockingMine = enemy.special === "healer" ? null : getBlockingMineForEnemy(enemy);
        if (blockingMine) {
            enemy.isAttacking = true;
            enemy.target = "mine";
            if (now - enemy.lastAttackTime >= enemy.attackDelay) {
                if (enemy.special === "thief") { stealFromMine(enemy, blockingMine); } else { damageMine(blockingMine, enemy.damageToDefense || 1, enemy); }
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
            const moveAmount = enemy.speed * gameSpeed * frameScale;
            const nextX = clampWorldX(enemy.x + nx * moveAmount, enemy.radius + 3);
            const nextY = clampWorldY(enemy.y + ny * moveAmount, enemy.radius + 3);

            if (!isEnemyPositionBlockedBySolid(enemy, nextX, nextY)) {
                enemy.x = nextX;
                enemy.y = nextY;
            } else {
                const slideX = clampWorldX(enemy.x + nx * moveAmount, enemy.radius + 3);
                const slideY = clampWorldY(enemy.y + ny * moveAmount, enemy.radius + 3);
                if (!isEnemyPositionBlockedBySolid(enemy, slideX, enemy.y)) {
                    enemy.x = slideX;
                } else if (!isEnemyPositionBlockedBySolid(enemy, enemy.x, slideY)) {
                    enemy.y = slideY;
                }
            }

            enemy.isAttacking = false;
            continue;
        }

        enemy.isAttacking = true;

        if (enemy.bossVariant === "dvd") {
            if (now - enemy.lastAttackTime >= enemy.attackDelay) {
                let ended = false;
                if (mainTarget.type === "base") {
                    ended = damageBase(enemy.damageToDefense, enemy.x, enemy.y);
                } else if (mainTarget.type === "tower" && mainTarget.object) {
                    damageTower(mainTarget.object, enemy.damageToDefense || 1, enemy);
                } else if (mainTarget.type === "barricade" && mainTarget.object) {
                    damageBarricade(mainTarget.object, enemy.damageToDefense || 1, enemy);
                } else if (mainTarget.type === "mine" && mainTarget.object) {
                    if (enemy.special === "thief") { stealFromMine(enemy, mainTarget.object); } else { damageMine(mainTarget.object, enemy.damageToDefense || 1, enemy); }
                } else {
                    ended = damagePlayer(enemy.damageToDefense, enemy, enemy.x, enemy.y, "¡Rebote bloqueado!");
                }
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
                showCenterMessage(`TITÁN ANULADO
El Abismo perdió el pulso por un instante.`, 1200, "titan-reward");
                continue;
            }
            if (now - enemy.lastAttackTime >= enemy.attackDelay) {
                const titanHit = enemy.titanVariant === "dash" ? 14 : enemy.titanVariant === "burn" ? 9 : 11;
                const ended = damagePlayer(titanHit, enemy, enemy.x, enemy.y, "¡Golpe del Titán bloqueado!");
                if (enemy.titanVariant === "burn") createFireZone(player.x, player.y, 62, 1.8 + wave * 0.015, 1800, 450);
                enemy.lastAttackTime = now;
                if (ended) return;
            }
            continue;
        }

        if (now - enemy.lastAttackTime >= enemy.attackDelay) {
            let ended = false;
            if (mainTarget.type === "base") {
                ended = damageBase(enemy.damageToDefense, enemy.x, enemy.y);
            } else if (mainTarget.type === "tower" && mainTarget.object) {
                damageTower(mainTarget.object, enemy.damageToDefense || 1, enemy);
                createImpactParticles(mainTarget.object.x, mainTarget.object.y, enemy.color || "#ff7777");
            } else if (mainTarget.type === "barricade" && mainTarget.object) {
                damageBarricade(mainTarget.object, enemy.damageToDefense || 1, enemy);
                createImpactParticles(mainTarget.x, mainTarget.y, enemy.color || "#d6a05f");
            } else if (mainTarget.type === "mine" && mainTarget.object) {
                damageMine(mainTarget.object, enemy.damageToDefense || 1, enemy);
                createImpactParticles(mainTarget.x, mainTarget.y, enemy.color || "#d6a05f");
            } else {
                if (enemy.special === "shielded" && (enemy.shieldHp || 0) > 0) {
                    enemy.lastAttackTime = now;
                    enemy.hitFlash = 1;
                    addDamageText(enemy.x, enemy.y - enemy.radius - 12, "ESCUDO", false, "#8fa8ff");
                } else {
                    ended = damagePlayer(enemy.damageToDefense, enemy, enemy.x, enemy.y, "¡Golpe bloqueado!");
                }
            }
            enemy.lastAttackTime = now;
            if (ended) return;
        }
    }

    resolveEnemyCollisions();
}

function updateProjectiles() {
    for (let i = projectiles.length - 1; i >= 0; i--) {
        const p = projectiles[i];

        if (!Number.isFinite(p.x) || !Number.isFinite(p.y) || !Number.isFinite(p.dx) || !Number.isFinite(p.dy) || (p.maxAge && getGameTime() - (p.bornAt || getGameTime()) > p.maxAge)) {
            projectiles.splice(i, 1);
            continue;
        }

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

                if (runStats) runStats.lastKillSource = p.owner || "unknown";
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
    let finalAmount = amount * getEventEnemyTakenDamageMultiplier();
    if (enemy.special && source === "player") finalAmount *= (player?.specialDamageMultiplier || 1);

    if (enemy.special === "shielded" && (enemy.shieldHp || 0) > 0 && source !== "ability") {
        enemy.shieldHp -= finalAmount;
        enemy.hitFlash = 1;
        enemy.lastShieldBlockAt = getGameTime();
        addDamageText(enemy.x, enemy.y - enemy.radius - 8, finalAmount, isCrit, "#8fa8ff");
        if (enemy.shieldHp <= 0) {
            enemy.shieldHp = 0;
            effects.push({ type: "circle", x: enemy.x, y: enemy.y, radius: 8, maxRadius: 48, life: 18, color: "#8fa8ff" });
        }
        return;
    }

    enemy.hp -= finalAmount;
    enemy.hitFlash = 1;
    if (runStats) runStats.damageDealt += Math.max(0, finalAmount);
    if (activeSideMission?.type === "bossPlayerDamage" && enemy.isBoss && source === "player") addMissionProgress(finalAmount);

    if (enemy.special === "mirror" && enemy.reflectPercent && finalAmount > 0) {
        const reflected = Math.max(0.1, finalAmount * enemy.reflectPercent);
        if (source === "player") damagePlayer(reflected, { name: "reflejo del Bicho Espejo", color: enemy.color, deathName: "reflejo del Bicho Espejo" }, enemy.x, enemy.y, "¡Reflejo bloqueado!");
        if (source === "tower") damageNearestTower(enemy, reflected);
    }

    const now = getGameTime();
    if (now - lastHitSfxAt > 36) {
        playHitSound();
        lastHitSfxAt = now;
    }

    addDamageText(enemy.x, enemy.y - enemy.radius, finalAmount, isCrit, textColor);
}


function damageNearestTower(enemy, amount) {
    let best = null;
    let bestDist = Infinity;
    (towers || []).forEach(t => {
        if (!t || !t.owned || t.hp <= 0) return;
        const d = Math.hypot(t.x - enemy.x, t.y - enemy.y);
        if (d < bestDist) { best = t; bestDist = d; }
    });
    if (best) damageTower(best, amount, { name: "reflejo del Bicho Espejo", color: enemy.color });
}

function offerRelicChoice(source = "boss") {
    if (isRepeatingWave || pendingRelicChoice || !relicChoicePanel) return;
    const pool = source === "visitor" ? VISITOR_RELICS : RELIC_DEFINITIONS.filter(r => !activeRelics.some(a => a.id === r.id));
    if (!pool.length) return;
    const options = pickWeightedRelics(pool, 3);
    pendingRelicChoice = { source, options };
    if (relicChoiceTitle) relicChoiceTitle.textContent = source === "visitor" ? "Reliquia del Visitante" : "Reliquia del Abismo";
    if (relicChoiceHint) relicChoiceHint.textContent = "Elegí 1. Todas tienen poder, todas tienen precio.";
    relicChoiceOptions.innerHTML = options.map((r, i) => `<button type="button" data-relic-index="${i}" class="relicOption family-${r.family}"><strong>${r.name}</strong><span>${r.desc}</span><small>Pero: ${r.downside}</small><em>${getRelicFamilyLabel(r.family)}</em></button>`).join("");
    relicChoicePanel.classList.remove("hidden");
    gameRunning = false;
}

function pickWeightedRelics(pool, count) {
    const result = [];
    const temp = [...pool];
    while (result.length < count && temp.length) {
        const total = temp.reduce((sum, r) => sum + (relicFamilyWeights[r.family] || 1), 0);
        let roll = Math.random() * total;
        let idx = 0;
        for (; idx < temp.length; idx++) {
            roll -= (relicFamilyWeights[temp[idx].family] || 1);
            if (roll <= 0) break;
        }
        result.push(temp.splice(Math.min(idx, temp.length - 1), 1)[0]);
    }
    return result;
}

function getRelicFamilyLabel(family) {
    return ({ constructor:"Constructor", sangre:"Sangre", codicia:"Codicia", arcana:"Arcana", neutral:"Neutral", visitante:"Visitante" })[family] || family;
}

function chooseRelic(index) {
    if (!pendingRelicChoice) return;
    const relic = pendingRelicChoice.options[index];
    if (!relic) return;
    activeRelics.push({ id: relic.id, name: relic.name, family: relic.family });
    relic.apply?.();
    if (relic.family && relicFamilyWeights[relic.family] != null) relicFamilyWeights[relic.family] += 1.35;
    pendingRelicChoice = null;
    relicChoicePanel?.classList.add("hidden");
    gameRunning = waveInProgress;
    showCenterMessage(`Reliquia: ${relic.name}`, 1100);
    updateHud(true);
    autoSaveRun(true);
}
function killEnemy(index) {
    const enemy = enemies[index];
    const killSource = runStats?.lastKillSource || "unknown";

    const goldReward = getGoldAmount(enemy.reward);
    coins += goldReward;
    score += enemy.scoreValue;

    waveStats.kills++;
    if (runStats) { runStats.kills++; runStats.goldEarned += goldReward; if (killSource === "player") runStats.playerKills++; if (killSource === "tower") runStats.towerKills++; if (killSource === "trap" || killSource === "barricade") runStats.trapKills++; if (killSource === "ability") runStats.abilityKills++; if (enemy.special) runStats.specialKills++; if (enemy.special === "ram") runStats.ramKills++; }
    updateMissionOnKill(enemy, killSource);
    waveStats.gold += goldReward;
    waveStats.score += enemy.scoreValue;

    if (goldReward > 0 && !enemy.isBoss && enemy.special !== "doombringer") {
        spawnFlyingCoin(enemy.x, enemy.y, goldReward);
    }

    createDeathExplosion(enemy.x, enemy.y, enemy.color, enemy.isBoss ? 28 : 14);

    if (enemy.isBoss) {
        // Al morir un jefe, sus balas activas desaparecen para que no queden flotando
        if (runStats) runStats.bossKills++;
        offerRelicChoice("boss");
        // ni sigan dañando después de derrotarlo.
        bossProjectiles = [];
    }

    if (enemy.special === "exploder") {
        explodeEnemyOnDeath(enemy);
    }

    if (enemy.special === "splitter" && (enemy.splitLevel || 0) < 2) {
        splitEnemy(enemy);
    }

    if (enemy.special === "doombringer") {
        tryDropTitanShard(enemy);
    }

    if (enemy.special === "visitor") {
        lastVisitorDeathWave = wave;
        visitorSpawnedThisWave = false;
        showVisitorAlert("El Visitante cayó. El Abismo dejó una reliquia imposible.");
        offerRelicChoice("visitor");
    }

    applyBloodThirstOnKill(enemy);
    enemies.splice(index, 1);
}


function applyBloodThirstOnKill(enemy) {
    if (!player?.bloodThirst || !enemy || !player) return;
    if (Math.hypot(enemy.x - player.x, enemy.y - player.y) > 190) return;
    const heal = player.bloodThirst * (player.healingMultiplier || 1);
    const missing = Math.max(0, player.maxHp - player.hp);
    const applied = Math.min(missing, heal);
    player.hp += applied;
    const overflow = heal - applied;
    if (overflow > 0) player.bloodShield = Math.min(player.bloodShieldMax || 8, (player.bloodShield || 0) + overflow);
}
function getSignedDistanceToBarricadeLine(px, py, barricade) {
    const seg = getBarricadeSegment(barricade);
    const vx = seg.x2 - seg.x1;
    const vy = seg.y2 - seg.y1;
    const length = Math.hypot(vx, vy) || 1;
    return (vx * (py - seg.y1) - vy * (px - seg.x1)) / length;
}

function getNearestSplitBarricadeNormal(enemy, childRadius) {
    let best = null;
    let bestDistance = Infinity;
    (barricades || []).forEach(b => {
        if (!b || !b.active || b.hp <= 0 || b.isOpen) return;
        const seg = getBarricadeSegment(b);
        const hit = distancePointToSegment(enemy.x, enemy.y, seg.x1, seg.y1, seg.x2, seg.y2);
        const distance = hit.distance - BARRICADE_THICKNESS / 2 - (enemy.radius || childRadius || 12);
        if (distance < bestDistance) {
            let nx = enemy.x - hit.closestX;
            let ny = enemy.y - hit.closestY;
            let len = Math.hypot(nx, ny);
            if (len < 0.0001) {
                const angle = getBarricadeAngle(b.orientation || "horizontal") - Math.PI / 2;
                nx = Math.cos(angle);
                ny = Math.sin(angle);
                len = 1;
            }
            best = { barricade: b, nx: nx / len, ny: ny / len, distance };
            bestDistance = distance;
        }
    });
    return bestDistance <= childRadius + 18 ? best : null;
}

function isValidSplitSpawnPosition(sourceX, sourceY, x, y, childRadius) {
    const probe = { radius: childRadius };
    if (isEnemyPositionBlockedBySolid(probe, x, y)) return false;

    for (const b of (barricades || [])) {
        if (!b || !b.active || b.hp <= 0 || b.isOpen) continue;
        const seg = getBarricadeSegment(b);
        const sourceSide = getSignedDistanceToBarricadeLine(sourceX, sourceY, b);
        const childSide = getSignedDistanceToBarricadeLine(x, y, b);
        const safeSideMargin = BARRICADE_THICKNESS / 2 + 2;

        // Si al nacer el hijo quedaría del otro lado de la pared, no lo aceptamos.
        // Este era el bug: el splitter moría pegado a la barricada y generaba hijos
        // con offset radial, entonces alguno aparecía detrás de la muralla.
        if (
            sourceSide * childSide < 0 &&
            Math.abs(sourceSide) > safeSideMargin &&
            Math.abs(childSide) > safeSideMargin &&
            segmentsIntersectFinite(sourceX, sourceY, x, y, seg.x1, seg.y1, seg.x2, seg.y2)
        ) {
            return false;
        }

        // Además revisamos el recorrido entre el cadáver y el punto de spawn para que
        // no atraviese una cápsula de barricada, incluso en diagonales.
        for (let step = 0.35; step <= 1; step += 0.2) {
            const px = sourceX + (x - sourceX) * step;
            const py = sourceY + (y - sourceY) * step;
            if (circleIntersectsBarricade(px, py, Math.max(5, childRadius * 0.55), b, 0)) return false;
        }
    }

    return true;
}

function findSplitChildSpawnPosition(enemy, childRadius, childIndex, childCount) {
    const wallNormal = getNearestSplitBarricadeNormal(enemy, childRadius);
    const candidates = [];

    if (wallNormal) {
        const awayAngle = Math.atan2(wallNormal.ny, wallNormal.nx);
        const baseSpread = childCount <= 1 ? 0 : (childIndex - (childCount - 1) / 2) * 0.62;
        const angleOffsets = [baseSpread, baseSpread - 0.42, baseSpread + 0.42, baseSpread - 0.86, baseSpread + 0.86, baseSpread - 1.22, baseSpread + 1.22];
        const distances = [childRadius + 24, childRadius + 36, childRadius + 52, childRadius + 72, childRadius + 96];
        distances.forEach(distance => {
            angleOffsets.forEach(offset => {
                candidates.push({
                    x: clampWorldX(enemy.x + Math.cos(awayAngle + offset) * distance, childRadius + 6),
                    y: clampWorldY(enemy.y + Math.sin(awayAngle + offset) * distance, childRadius + 6)
                });
            });
        });
    }

    const radialBase = (Math.PI * 2 / childCount) * childIndex + Math.random() * 0.28;
    const radialOffsets = [0, -0.45, 0.45, -0.9, 0.9, Math.PI / 2, -Math.PI / 2, Math.PI];
    const radialDistances = [childRadius + 24, childRadius + 38, childRadius + 56, childRadius + 78, childRadius + 104];
    radialDistances.forEach(distance => {
        radialOffsets.forEach(offset => {
            candidates.push({
                x: clampWorldX(enemy.x + Math.cos(radialBase + offset) * distance, childRadius + 6),
                y: clampWorldY(enemy.y + Math.sin(radialBase + offset) * distance, childRadius + 6)
            });
        });
    });

    let bestFallback = null;
    let bestFallbackScore = Infinity;
    for (const candidate of candidates) {
        if (isValidSplitSpawnPosition(enemy.x, enemy.y, candidate.x, candidate.y, childRadius)) return candidate;

        // Fallback seguro: si no hay lugar perfecto, al menos elegimos un punto no bloqueado
        // y lo más cerca posible. No permitimos puntos bloqueados dentro de murallas.
        if (!isEnemyPositionBlockedBySolid({ radius: childRadius }, candidate.x, candidate.y)) {
            const score = Math.hypot(candidate.x - enemy.x, candidate.y - enemy.y);
            if (score < bestFallbackScore) {
                bestFallback = candidate;
                bestFallbackScore = score;
            }
        }
    }

    return bestFallback;
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

    const childCount = 3;
    const childRadius = Math.max(9, enemy.radius * 0.72);
    const spawnedPositions = [];

    for (let i = 0; i < childCount; i++) {
        const position = findSplitChildSpawnPosition(enemy, childRadius, i, childCount);
        if (!position) continue;

        // Evita que los hijos nazcan apilados y se empujen atravesando la barricada.
        const overlapsSibling = spawnedPositions.some(p => Math.hypot(p.x - position.x, p.y - position.y) < childRadius * 2.1);
        if (overlapsSibling) {
            const retry = findSplitChildSpawnPosition({ ...enemy, x: position.x, y: position.y }, childRadius, i + 1, childCount + 1);
            if (retry && !spawnedPositions.some(p => Math.hypot(p.x - retry.x, p.y - retry.y) < childRadius * 2.1)) {
                position.x = retry.x;
                position.y = retry.y;
            }
        }

        if (isEnemyPositionBlockedBySolid({ radius: childRadius }, position.x, position.y)) continue;
        spawnedPositions.push({ x: position.x, y: position.y });
        enemies.push(createEnemyFromType(childType, {
            x: position.x,
            y: position.y,
            radius: childRadius,
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
        if (effect.type === "spear") {
            const alpha = Math.max(0, effect.life / 10);
            ctx.strokeStyle = `rgba(255,226,138,${alpha})`;
            ctx.lineWidth = effect.width || 22;
            ctx.beginPath();
            ctx.moveTo(effect.x, effect.y);
            ctx.lineTo(effect.x + effect.dx * effect.length, effect.y + effect.dy * effect.length);
            ctx.stroke();
            return;
        }
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
        if (b.active && b.hp > 0 && circleIntersectsBarricade(enemy.x, enemy.y, radius, b, 0)) {
            hitBarricade = true;
            damageBarricade(b, damage, enemy);
            createImpactParticles(enemy.x, enemy.y, "#ff8d2a");
        }
    });

    if (!hitBarricade && enemy.x <= 35 + radius) {
        player.hp = Math.max(0, player.hp - Math.ceil(damage * 0.45));
        triggerRedFlash();
        if (player.hp <= 0) {
            setLastDeathCause(enemy, "explosión enemiga");
            endRun();
        }
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
            const speed = 18 * gameSpeed * frameScale;
            e.x += (e.dx || 1) * speed;
            e.y += (e.dy || 0) * speed;
            e.length = Math.min(e.maxLength || e.length || 120, (e.length || 120) + 18 * frameScale);
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

let centerMessageToken = 0;
function showCenterMessage(text, duration = 1600, type = "default") {
    if (!centerMessage) return;
    const token = ++centerMessageToken;
    const raw = String(text || "");
    const canUseBody = ["boss", "titan", "titan-reward", "visitor"].includes(type);
    const [firstLine, ...bodyParts] = raw.split("\n");
    const title = canUseBody ? firstLine : raw.replace(/\s*\n\s*/g, " — ");
    const body = canUseBody ? bodyParts.join(" ").trim() : "";
    centerMessage.className = "centerMessageToast";
    centerMessage.classList.add(`centerMessage-${type}`);
    if (!canUseBody) centerMessage.classList.add("centerMessageSingleLine");
    if (type === "minor") centerMessage.classList.add("centerMessageMinor");
    centerMessage.innerHTML = `<strong>${escapeHtml(title || "")}</strong>${body ? `<span>${escapeHtml(body)}</span>` : ""}`;
    centerMessage.classList.remove("hidden", "fadeOut");
    void centerMessage.offsetWidth;
    centerMessage.classList.add("showing");
    const fadeAt = Math.max(250, Number(duration) - 450);
    setTimeout(() => { if (token === centerMessageToken) centerMessage.classList.add("fadeOut"); }, fadeAt);
    setTimeout(() => {
        if (token !== centerMessageToken) return;
        centerMessage.classList.add("hidden");
        centerMessage.classList.remove("showing", "fadeOut");
    }, Math.max(300, Number(duration)));
}


function ensureBossWaveSpawned() {
    if (!waveInProgress || !gameRunning || isPaused) return;
    if (!isBossWave()) return;
    if (bossSpawnedThisWave) return;
    if (enemies.some(e => e && e.isBoss && e.hp > 0)) {
        bossSpawnedThisWave = true;
        return;
    }
    spawnBoss();
    showCenterMessage(`¡BOSS!\nEl Abismo corrigió la ausencia. Ahora peleá.`, 1900, "boss");
}

function updateBossPressureSpawns(now) {
    if (!isBossWave() || !enemies.some(e => e.isBoss && e.hp > 0)) return;
    if (now - bossPressureLastSpawnAt < 2600) return;
    const maxExtra = player?.siegeCrown ? 42 : 24;
    if (bossPressureSpawned >= maxExtra) return;
    bossPressureLastSpawnAt = now;
    bossPressureSpawned++;
    const type = getEnemyTypeForWave();
    enemies.push(createEnemyFromType(type));
}
function checkWaveComplete() {
    if (
        enemiesSpawned >= enemiesToSpawn &&
        enemies.filter(e => !(e && e.special === "visitor" && e.hp > 0)).length === 0 &&
        waveInProgress
    ) {
        completeWave();
    }
}

function awardMineIncome(completedWave = wave) {
    const activeMines = (mines || []).filter(mine => mine && mine.hp > 0);
    if (!activeMines.length) return 0;
    const perMine = getMineIncomeForWave(completedWave);
    const total = Math.ceil(perMine * activeMines.length * (player?.mineIncomeMultiplier || 1));
    if (total <= 0) return 0;

    coins = Math.min(Number.MAX_SAFE_INTEGER, coins + total);
    waveStats.gold += total;
    if (runStats) runStats.goldEarned += total;
    activeMines.forEach(mine => {
        mine.totalGold = (Number(mine.totalGold) || 0) + perMine;
        mine.lastIncome = perMine;
        mine.pulseUntil = getGameTime() + 1200;
    });
    addDamageText(player.x, player.y - 42, `+${formatMoney(total)} minas`, false, "#ffd76a");
    return total;
}

function completeWave() {
    waveInProgress = false;
    gameRunning = false;

    const completedWave = wave;
    const waveBonus = Math.floor(wave * 20 + Math.pow(Math.max(0, wave - 40), 0.82) * 35);
    const goldBonus = getGoldAmount(8 + getWaveRewardBonus());

    score += waveBonus;
    coins += goldBonus;

    waveStats.score += waveBonus;
    waveStats.gold += goldBonus;
    waveStats.bonus = waveBonus;
    if (runStats) runStats.goldEarned += goldBonus;

    const mineGold = awardMineIncome(completedWave);
    finishSideMission();
    applyCompoundInterestBonus();
    endWaveEvent(completedWave);

    waveSummaryPanel.classList.add("hidden");
    autoSaveRun(true);
    enterBuildPhase(completedWave, goldBonus + mineGold);
}


function applyCompoundInterestBonus() {
    if (!player?.compoundInterest) return 0;
    const bonus = Math.min(getGoldAmount(250 + wave * 8), Math.floor(coins * 0.08));
    if (bonus > 0) {
        coins += bonus;
        waveStats.gold += bonus;
        if (runStats) runStats.goldEarned += bonus;
        addDamageText(player.x, player.y - 58, `+${formatMoney(bonus)} interés`, false, "#ffd84a");
    }
    return bonus;
}
function enterBuildPhase(completedWave, goldBonus = 0) {
    clearVisitorProjectiles();
    beginVisitorRetreat();
    if (hasLivingVisitor()) showVisitorAlert("El Visitante se retira a preparar otro plan...");
    buildPhaseActive = true;
    buildPhaseEndsAt = performance.now() + BUILD_PHASE_DURATION;
    pausedBuildPhaseRemainingMs = 0;
    gameRunning = false;
    waveInProgress = false;
    isRepeatingWave = false;
    currentGoldMultiplier = 1;
    wave = completedWave + 1;
    resetWaveStats();
    closeShop();
    updateBuildPhaseUI();
    showCenterMessage(`Wave ${completedWave} completada · +${formatMoney(goldBonus)} oro · 2 minutos antes`, 1700, "minor");
    autoSaveRun(true);
}

function getBuildPhaseRemainingMs() {
    if (!buildPhaseActive) return 0;
    if (isPaused && pausedBuildPhaseRemainingMs > 0) return pausedBuildPhaseRemainingMs;
    if (!Number.isFinite(buildPhaseEndsAt) || buildPhaseEndsAt <= 0) {
        buildPhaseEndsAt = performance.now() + BUILD_PHASE_DURATION;
    }
    return Math.max(0, buildPhaseEndsAt - performance.now());
}

function beginNextWaveFromBuildPhase(source = "timer") {
    if (!buildPhaseActive || buildPhaseStartingWave) return;

    // Importante: calcular el objetivo ANTES de apagar buildPhaseActive.
    // Si no, auto-repetir tomaba la próxima oleada y parecía que los bichos
    // escalaban muchísimo más de lo esperado.
    const repeatTargetWave = getRepeatTargetWave();

    buildPhaseStartingWave = true;
    buildPhaseActive = false;
    buildPhaseEndsAt = 0;
    pausedBuildPhaseRemainingMs = 0;
    isPaused = false;
    gameRunning = false;
    waveInProgress = false;

    if (canAutoRepeatTargetWave(repeatTargetWave)) {
        updateBuildPhaseUI();
        prepareRepeatWave(repeatTargetWave, "auto");
        buildPhaseStartingWave = false;
        autoSaveRun(true);
        return;
    }

    updateBuildPhaseUI();
    showCenterMessage(`Oleada ${wave}`, 900, "minor");
    startWave();
    buildPhaseStartingWave = false;
    autoSaveRun(true);
}

function skipBuildPhase() {
    beginNextWaveFromBuildPhase("skip");
}

function updateBuildPhase() {
    if (!buildPhaseActive) return;
    if (isPaused) {
        updateBuildPhaseUI();
        return;
    }

    const remainingMs = getBuildPhaseRemainingMs();
    if (remainingMs <= 0) {
        beginNextWaveFromBuildPhase("timer");
        return;
    }

    updateBuildPhaseUI();
}

function formatBuildPhaseTime(ms) {
    const totalSeconds = Math.max(1, Math.ceil(ms / 1000));
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    if (minutes <= 0) return `${seconds}s`;
    return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

function updateBuildPhaseUI() {
    if (!skipBuildPhaseBtn) return;
    skipBuildPhaseBtn.classList.toggle("hidden", !buildPhaseActive);
    if (buildPhaseActive) {
        const targetWave = getRepeatTargetWave();
        const repeats = getRepeatCountForWave(targetWave);
        const nextLabel = canAutoRepeatTargetWave(targetWave)
            ? `Auto repetir ${targetWave} (${repeats}/${REPEAT_LIMIT_PER_WAVE})`
            : `Próxima oleada en ${formatBuildPhaseTime(getBuildPhaseRemainingMs())}`;
        skipBuildPhaseBtn.textContent = `${nextLabel} · Saltar`;
    }
    updateAutoRepeatWaveButton();
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

function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" }[ch] || ch));
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
            const isBeginner = Boolean(entry.beginner || entry.beginnerCommandUsed);
            const killedBy = String(entry.killedBy || entry.deathCause || "").slice(0, 80);
            const deathText = killedBy ? ` · mató: ${escapeHtml(killedBy)}` : "";

            li.innerHTML = `
                <div class="leaderboardEntry">
                    <div>
                        <div class="leaderboardName"><span class="leaderboardNameText"></span>${isBeginner ? ' <span class="leaderboardBeginnerTag">(beginner)</span>' : ''}</div>
                        <div class="leaderboardMeta">${waveText}${dateText ? " · " + dateText : ""}${deathText}</div>
                    </div>
                    <div class="leaderboardScore">${scoreValue}</div>
                </div>
            `;

            li.querySelector(".leaderboardNameText").textContent = name;
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

function updateDebugRunIndicator() {
    let badge = document.getElementById("debugRunBadge");
    if (!badge) {
        badge = document.createElement("div");
        badge.id = "debugRunBadge";
        badge.style.position = "fixed";
        badge.style.right = "14px";
        badge.style.bottom = "14px";
        badge.style.zIndex = "9999";
        badge.style.padding = "7px 10px";
        badge.style.border = "1px solid rgba(255,90,90,0.85)";
        badge.style.borderRadius = "10px";
        badge.style.background = "rgba(25,0,0,0.82)";
        badge.style.color = "#ffb0b0";
        badge.style.font = "bold 12px Arial, sans-serif";
        badge.style.textShadow = "0 1px 2px #000";
        badge.style.pointerEvents = "none";
        document.body.appendChild(badge);
    }
    const reason = leaderboardDisqualificationReason ? ` · ${leaderboardDisqualificationReason}` : "";
    badge.textContent = `RUN DEBUG${reason}`;
    badge.style.display = runDisqualifiedFromLeaderboard && hasActiveRun ? "block" : "none";
}

function disqualifyRunFromLeaderboard(commandName) {
    runDisqualifiedFromLeaderboard = true;
    leaderboardDisqualificationReason = commandName || "comando ilegal";
    appendConsoleLog(`Leaderboard desactivado para esta run por usar: ${leaderboardDisqualificationReason}.`);
    showCenterMessage("RUN DEBUG · Leaderboard desactivado", 1300, "minor");
    updateDebugRunIndicator();
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
            version: "0.7.6.0",
            beginner: Boolean(beginnerCommandUsed),
            beginnerCommandUsed: Boolean(beginnerCommandUsed),
            killedBy: String(lastDeathCause || "desconocido").slice(0, 80),
            deathCause: String(lastDeathCause || "desconocido").slice(0, 80),
            className: activeClass?.name || "Errante"
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
    updateDebugRunIndicator();
    isPaused = false;
    gameRunning = false;
    waveInProgress = false;

    enemies = [];
    projectiles = [];
    bossProjectiles = [];
    slowZones = [];
    poisonZones = [];
    fireZones = [];

    const rawScore = score;
    score = Math.floor(score * (player?.scoreMultiplier || 1));
    const isNewRecord = score > bestScore;
    const survivalText = formatSurvivalTime(totalRunTimeMs || getGameTime());
    const buildName = detectMainBuild();
    const deathLine = getDeathFlavorLine(isNewRecord, wave, lastDeathCause);

    if (isNewRecord) {
        bestScore = score;
        localStorage.setItem("towerDefenseBestScore", bestScore);
        deathMessageText.innerHTML = `<strong>¡RÉCORD SUPERADO!</strong><br>${deathLine}<br><small>Clase: ${activeClass?.name || "Errante"} · Build: ${buildName} · Tiempo vivo: ${survivalText}</small>`;
    } else {
        deathMessageText.innerHTML = `${deathLine}<br><small>Clase: ${activeClass?.name || "Errante"} · Build: ${buildName} · Tiempo vivo: ${survivalText}</small>`;
    }
    renderFinalRunDetails(rawScore);

    finalScoreText.textContent = formatCompactNumber(score);
    bestScoreText.textContent = formatCompactNumber(bestScore);
    bestScoreMenuText.textContent = formatCompactNumber(bestScore);

    gameOverScreen.classList.remove("hidden");
    closeShop();
    waveSummaryPanel.classList.add("hidden");

    submitLeaderboardScore();
    updateHud();
}


function formatSurvivalTime(ms) {
    const total = Math.max(0, Math.floor(ms / 1000));
    const m = Math.floor(total / 60), s = total % 60;
    return `${m}m ${String(s).padStart(2,"0")}s`;
}
function getDeathFlavorLine(isRecord, w, cause) {
    const cleanCause = String(cause || "el Abismo");
    const context = { wave: w, cause: cleanCause };
    let pool = FINAL_DEATH_LINES.low;
    if (/tit[aá]n/i.test(cleanCause)) pool = FINAL_DEATH_LINES.titan;
    else if (/jefe|boss|abismo|parpadeo|orbe|mortero|corona|carcelero|devoramuros|or[aá]culo|comandante|recolector/i.test(cleanCause)) pool = FINAL_DEATH_LINES.boss;
    else if (isRecord) pool = FINAL_DEATH_LINES.record;
    else if (w < 10) pool = FINAL_DEATH_LINES.low;
    else if (w < 35) pool = FINAL_DEATH_LINES.mid;
    else if (w < 75) pool = FINAL_DEATH_LINES.high;
    else pool = FINAL_DEATH_LINES.legendary;
    let line = formatFinalLine(pickRandomLine(pool), context);
    if (!/wave/i.test(line) && !isRecord) line += ` Caíste ante ${cleanCause} en la wave ${w}.`;
    if (isRecord && !/r[eé]cord/i.test(line)) line = `¡Récord superado! ${line}`;
    return line;
}
function detectMainBuild() {
    if (!runStats) return "Errante";
    const scores = [
        ["Build Cazador", (runStats.playerKills || 0) * 3 + Math.floor((runStats.bossPlayerDamage || 0) / 20)],
        ["Build Ingeniero", (runStats.towerKills || 0) * 3 + (towers || []).length * 12],
        ["Build Fortaleza", (barricades || []).length * 18 + (runStats.barricadesLostThisWave || 0) * 2],
        ["Build Codiciosa", (mines || []).length * 24 + Math.floor((runStats.goldEarned || 0) / 120)],
        ["Build Arcana", (runStats.abilityKills || 0) * 4 + (runStats.abilitiesUsedThisWave || 0) * 8],
        ["Build Trampera", (runStats.trapKills || 0) * 4 + (traps || []).length * 14],
        ["Build Alquimista", (runStats.consumablesUsedThisWave || 0) * 18]
    ];
    scores.sort((a,b)=>b[1]-a[1]);
    return scores[0]?.[1] > 0 ? scores[0][0] : (activeClass?.name || "Errante");
}
let lastRunSummaryText = "";
function renderFinalRunDetails(rawScore) {
    const box = document.getElementById("finalRunDetails");
    if (!box) return;
    const relicText = activeRelics.length ? activeRelics.map(r=>r.name).join(", ") : "Ninguna";
    const survivedEventsText = runStats?.survivedEvents?.length ? runStats.survivedEvents.slice(-3).join(", ") : "Ninguno";
    const buildName = detectMainBuild();
    const survivalText = formatSurvivalTime(totalRunTimeMs || getGameTime());
    box.innerHTML = `
        <div><strong>Clase</strong><span>${activeClass?.name || "Errante"}</span></div>
        <div><strong>Build</strong><span>${buildName}</span></div>
        <div><strong>Tiempo vivo</strong><span>${survivalText}</span></div>
        <div><strong>Daño total</strong><span>${formatCompactNumber(Math.floor(runStats?.damageDealt || 0))}</span></div>
        <div><strong>Oro ganado</strong><span>${formatMoney(Math.floor(runStats?.goldEarned || 0))}</span></div>
        <div><strong>Reliquias</strong><span>${escapeHtml(relicText)}</span></div>
        <div><strong>Misiones</strong><span>${runStats?.missionsCompleted || 0} completadas</span></div>
        <div><strong>Eventos sobrevividos</strong><span>${escapeHtml(survivedEventsText)}</span></div>
        <div><strong>Puntaje base</strong><span>${formatCompactNumber(rawScore)}</span></div>`;
    lastRunSummaryText = `Ardent Tower Defense
Wave: ${wave}
Clase: ${activeClass?.name || "Errante"}
Build: ${buildName}
Tiempo vivo: ${survivalText}
Puntaje: ${formatCompactNumber(score)}
Daño total: ${formatCompactNumber(Math.floor(runStats?.damageDealt || 0))}
Oro ganado: ${formatMoney(Math.floor(runStats?.goldEarned || 0))}
Reliquias: ${relicText}
Misiones: ${runStats?.missionsCompleted || 0}
Causa de muerte: ${lastDeathCause || "desconocida"}`;
}
async function copyLastRunSummary() {
    if (!lastRunSummaryText) return;
    try {
        await navigator.clipboard.writeText(lastRunSummaryText);
        showCenterMessage(`RESUMEN COPIADO
Pegalo en Discord y presumí la run.`, 1300, "mission-success");
    } catch (error) {
        console.log("Copy summary error:", error);
        showCenterMessage(`NO SE PUDO COPIAR
El navegador bloqueó el portapapeles.`, 1300, "mission-fail");
    }
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

    if (now - ability.lastUsed < ability.cooldown * (player?.abilityCooldownMultiplier || 1) * (activeWaveEvent?.id === "mana_calm" ? 1.35 : 1)) return;

    ability.lastUsed = now;
    if (runStats) runStats.abilitiesUsedThisWave++;
    if (player?.abyssTithe) applyAbyssTitheCostAndGold();

    if (id === "bomb") useBomb();
    if (id === "freeze") useFreeze();
    if (id === "tsunami") useTsunami();
    if (id === "lightning") useLightning();
    if (id === "meteor") useMeteor();
    if (id === "eclipse") useEclipse();
    if (id === "blink") useBlink();

    updateHud();
}

function getAbilityDamage(base, waveScale = 1, playerScale = 1) {
    return (base + wave * waveScale + player.damage * playerScale) * (player?.abilityPowerMultiplier || 1);
}


function applyAbyssTitheCostAndGold() {
    const touched = Math.min(18, (enemies || []).length);
    const gold = Math.ceil(touched * (1 + wave * 0.025));
    if (gold > 0) { coins += gold; if (runStats) runStats.goldEarned += gold; }
    const lifeCost = Math.max(0.2, player.maxHp * 0.015);
    if (player.hp > lifeCost + 1) player.hp -= lifeCost;
}
function useBlink() {
    const dirX = Number(player.lastMoveX) || 1;
    const dirY = Number(player.lastMoveY) || 0;
    const len = Math.hypot(dirX, dirY) || 1;
    const startX = player.x;
    const startY = player.y;
    player.x = clampWorldX(player.x + (dirX / len) * BLINK_DISTANCE, 32);
    player.y = clampWorldY(player.y + (dirY / len) * BLINK_DISTANCE, 32);
    // Blink atraviesa barricadas, pero no debe terminar dentro de torres, minas, base o enemigos.
    const blinkBlocked = (towers || []).some(t => t && t.owned && t.hp > 0 && Math.hypot(t.x - player.x, t.y - player.y) < TOWER_COLLISION_RADIUS + 18)
        || (mines || []).some(m => m && m.hp > 0 && Math.hypot(m.x - player.x, m.y - player.y) < (m.radius || MINE_COLLISION_RADIUS) + 18)
        || (baseCore && basePlaced && baseCore.hp > 0 && Math.hypot(baseCore.x - player.x, baseCore.y - player.y) < BASE_RADIUS + 18)
        || (enemies || []).some(e => e && e.hp > 0 && Math.hypot(e.x - player.x, e.y - player.y) < (e.radius || 18) + 18);
    if (blinkBlocked) {
        player.x = clampWorldX(startX + (dirX / len) * (BLINK_DISTANCE * 0.62), 32);
        player.y = clampWorldY(startY + (dirY / len) * (BLINK_DISTANCE * 0.62), 32);
    }
    effects.push({ type: "line", x1: startX, y1: startY, x2: player.x, y2: player.y, life: 16, color: "#9be7ff" });
    effects.push({ type: "circle", x: player.x, y: player.y, radius: 8, maxRadius: 34, life: 18, color: "#9be7ff" });
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
    const dxRaw = mousePosition.x - player.x;
    const dyRaw = mousePosition.y - player.y;
    const len = Math.hypot(dxRaw, dyRaw) || 1;
    const dx = dxRaw / len;
    const dy = dyRaw / len;
    const waveLength = 620 + Math.min(180, player.damage * 10);
    const waveWidth = 135 + Math.min(55, player.damage * 3);
    const startX = player.x + dx * 42;
    const startY = player.y + dy * 42;

    enemies.forEach(enemy => {
        const relX = enemy.x - startX;
        const relY = enemy.y - startY;
        const forward = relX * dx + relY * dy;
        const side = Math.abs(relX * -dy + relY * dx);
        const hitRadius = (enemy.radius || 16) + waveWidth * 0.5;

        if (forward < -35 || forward > waveLength || side > hitRadius) return;

        if (enemy.tsunamiImmune) {
            addDamageText(enemy.x, enemy.y - enemy.radius - 8, "INMUNE", false, "#9be7ff");
            effects.push({ type: "circle", x: enemy.x, y: enemy.y, radius: 6, maxRadius: 34, life: 18, color: "#4aa3ff" });
            return;
        }

        const enemyPush = enemy.isBoss ? push * 0.38 : push;
        enemy.x += dx * enemyPush;
        enemy.y += dy * enemyPush;
        damageEnemy(enemy, damage, false, "#9be7ff", "tsunami");
    });

    for (let i = enemies.length - 1; i >= 0; i--) {
        if (enemies[i].hp <= 0) killEnemy(i);
    }

    effects.push({
        type: "tsunami",
        x: startX,
        y: startY,
        dx,
        dy,
        width: waveWidth,
        length: 115,
        maxLength: waveLength,
        life: 58,
        maxLife: 58,
        color: "#4aa3ff",
        foamOffset: Math.random() * 1000
    });

    showCenterMessage("¡TSUNAMI!", 900);
}

function useLightning() {
    if (enemies.length === 0) return;

    const chains = [];
    const originX = mousePosition.x;
    const originY = mousePosition.y;
    let current = findClosestEnemy(originX, originY, Infinity);
    let damage = getAbilityDamage(20, 0.9, 4.1);
    const maxChains = player.damage >= 8 ? 5 : 4;

    for (let i = 0; i < maxChains; i++) {
        if (!current) break;

        chains.push(current);
        damageEnemy(current, damage, true, "#60c8ff", "lightning");

        const next = findClosestEnemy(current.x, current.y, 150 + Math.min(55, player.damage * 3), chains);
        current = next;
        damage *= 0.75;
    }

    for (let i = enemies.length - 1; i >= 0; i--) {
        if (enemies[i].hp <= 0) killEnemy(i);
    }

    chains.forEach((enemy, index) => {
        const from = index === 0 ? { x: originX, y: originY } : chains[index - 1];
        effects.push({
            type: "lightning",
            x1: from.x,
            y1: from.y,
            x2: enemy.x,
            y2: enemy.y,
            life: 18,
            maxLife: 18,
            color: "#4bc3ff",
            seed: Math.random() * 1000
        });

        // Ramitas visuales extra para que se lea como rayo encadenado azul.
        const branches = Math.min(2, chains.length - 1);
        for (let b = 0; b < branches; b++) {
            const angle = Math.atan2(enemy.y - from.y, enemy.x - from.x) + (Math.random() < 0.5 ? -1 : 1) * (0.7 + Math.random() * 0.45);
            const branchLength = 22 + Math.random() * 32;
            effects.push({
                type: "lightning",
                x1: enemy.x,
                y1: enemy.y,
                x2: enemy.x + Math.cos(angle) * branchLength,
                y2: enemy.y + Math.sin(angle) * branchLength,
                life: 12,
                maxLife: 12,
                color: "#8ee9ff",
                seed: Math.random() * 1000,
                branch: true
            });
        }
    });
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
        x: mousePosition.x,
        y: mousePosition.y,
        radius,
        pulseRadius: 20,
        life: 240,
        maxLife: 240,
        nextPulseAt: now,
        expiresAt: now + 4200,
        pulseDamage: getAbilityDamage(5, 0.32, 1.7),
        executePercent: 0.18 + Math.min(0.08, player.damage * 0.004),
        finalDone: false,
        color: "#7d55ff",
        rotation: Math.random() * Math.PI * 2
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
        if (enemy.untargetable || enemy.hp <= 0) return;

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

function drawBarricadeThornsLocal(width, height) {
    // Se dibuja en coordenadas LOCALES de la barricada.
    // Como drawBarricade() ya hizo translate + rotate, los pinchos acompañan
    // exactamente la orientación real: |, /, - o \.
    ctx.save();
    ctx.fillStyle = "#ff9f55";
    const count = Math.max(4, Math.floor(width / 16));
    const step = width / count;
    const centerY = 0;
    const spikeLength = Math.min(13, Math.max(8, height * 0.62));
    const halfBase = Math.min(7, step * 0.32);

    for (let i = 0; i < count; i++) {
        const x = -width / 2 + step * (i + 0.5);

        // Pinchos hacia un lado de la barricada.
        ctx.beginPath();
        ctx.moveTo(x - halfBase, centerY - height / 2 + 1);
        ctx.lineTo(x, centerY - height / 2 - spikeLength);
        ctx.lineTo(x + halfBase, centerY - height / 2 + 1);
        ctx.fill();

        // Pinchos hacia el lado contrario.
        ctx.beginPath();
        ctx.moveTo(x - halfBase, centerY + height / 2 - 1);
        ctx.lineTo(x, centerY + height / 2 + spikeLength);
        ctx.lineTo(x + halfBase, centerY + height / 2 - 1);
        ctx.fill();
    }

    ctx.restore();
}

function drawBarricadeHealthBar(b, hpPercent) {
    if (!b) return;
    const angle = getBarricadeAngle(b.orientation || "horizontal");
    const barWidth = BARRICADE_LENGTH;
    const barHeight = 5;
    const offset = BARRICADE_THICKNESS / 2 + 11;

    ctx.save();
    ctx.translate(b.x, b.y);
    ctx.rotate(angle);
    ctx.fillStyle = "red";
    ctx.fillRect(-barWidth / 2, -offset, barWidth, barHeight);
    ctx.fillStyle = "lime";
    ctx.fillRect(-barWidth / 2, -offset, barWidth * hpPercent, barHeight);
    ctx.restore();
}

function drawAetheriteBarricadeParticles(b, width, height) {
    const now = getGameTime();
    const seed = Number(b.id || 1) % 997;
    ctx.save();
    ctx.shadowColor = "#bfa7ff";
    ctx.shadowBlur = 10;
    const count = 9;
    for (let i = 0; i < count; i++) {
        const phase = (now * 0.0012 + i * 0.73 + seed * 0.013) % 1;
        const x = -width / 2 + ((i + 0.5) / count) * width + Math.sin(now * 0.002 + i + seed) * 3;
        const side = i % 2 === 0 ? -1 : 1;
        const y = side * (height / 2 + 4 + Math.sin(now * 0.003 + i * 2) * 5);
        const alpha = 0.25 + Math.sin(phase * Math.PI) * 0.55;
        ctx.globalAlpha = Math.max(0.18, Math.min(0.82, alpha));
        ctx.fillStyle = i % 3 === 0 ? "#ffffff" : "#cdbbff";
        ctx.beginPath();
        ctx.arc(x, y, 1.5 + Math.sin(phase * Math.PI) * 1.2, 0, Math.PI * 2);
        ctx.fill();
    }
    ctx.globalAlpha = 1;
    ctx.restore();
}

function drawBarricade() {
    (barricades || []).forEach(b => {
        if (!b.active || b.hp <= 0) return;
        const dims = getBarricadeDimensions(b.orientation || "horizontal");
        const rect = getEntityRect({ ...b, isBuildBarricade: true });
        const angle = getBarricadeAngle(b.orientation || "horizontal");
        // Siempre dibujamos la barricada como una barra local horizontal
        // y la rotamos por orientación. Antes la vertical usaba dims rotados
        // y visualmente volvía a quedar horizontal.
        const drawWidth = BARRICADE_LENGTH;
        const drawHeight = BARRICADE_THICKNESS;

        ctx.save();
        ctx.translate(b.x, b.y);
        ctx.rotate(angle);
        ctx.globalAlpha = b.isOpen ? 0.28 : 1;
        ctx.fillStyle = b.color;
        ctx.fillRect(-drawWidth / 2, -drawHeight / 2, drawWidth, drawHeight);
        ctx.globalAlpha = 1;
        ctx.strokeStyle = isStructureSelected("barricade", b.id) ? "#ffe28a" : "rgba(0,0,0,0.7)";
        ctx.lineWidth = isStructureSelected("barricade", b.id) ? 4 : 2;
        ctx.strokeRect(-drawWidth / 2, -drawHeight / 2, drawWidth, drawHeight);
        if (b.kind === "door") {
            ctx.fillStyle = b.isOpen ? "rgba(255,255,255,0.7)" : "rgba(0,0,0,0.35)";
            ctx.font = "bold 12px Arial";
            ctx.fillText(b.isOpen ? "ABIERTA" : "PUERTA", -drawWidth / 2 + 6, 4);
        }
        if (b.thorns) {
            drawBarricadeThornsLocal(drawWidth, drawHeight);
        }
        if (isAetheriteBarricade(b)) {
            drawAetheriteBarricadeParticles(b, drawWidth, drawHeight);
        }
        ctx.restore();

        const hpPercent = b.maxHp > 0 ? Math.max(0, b.hp / b.maxHp) : 0;
        drawBarricadeHealthBar(b, hpPercent);
    });
}

function drawBuildPreview() {
    if (pendingBarricadePlacement) {
        const point = getSnappedBuildPoint();
        const dims = getBarricadeDimensions(barricadeBuildOrientation);
        const valid = isBarricadePositionValid(point.x, point.y, barricadeBuildOrientation);
        ctx.save();
        ctx.translate(point.x, point.y);
        ctx.rotate(getBarricadeAngle(barricadeBuildOrientation));
        const previewWidth = BARRICADE_LENGTH;
        const previewHeight = BARRICADE_THICKNESS;
        ctx.fillStyle = valid ? "rgba(115,255,159,0.35)" : "rgba(255,80,80,0.35)";
        ctx.fillRect(-previewWidth / 2, -previewHeight / 2, previewWidth, previewHeight);
        ctx.strokeStyle = valid ? "rgba(115,255,159,0.95)" : "rgba(255,80,80,0.95)";
        ctx.lineWidth = 3;
        ctx.strokeRect(-previewWidth / 2, -previewHeight / 2, previewWidth, previewHeight);
        ctx.restore();
        ctx.fillStyle = "white";
        ctx.font = "bold 14px Arial";
        ctx.fillText(`Click coloca · R rota (${getBarricadeOrientationLabel(barricadeBuildOrientation)}) · Click derecho/Esc cancela`, point.x - 205, point.y - dims.height / 2 - 12);
    }

    if (pendingTrapPlacement) {
        const point = getSnappedBuildPoint();
        const def = trapDefinitions[pendingTrapPlacement.typeKey];
        const valid = isTrapPositionValid(point.x, point.y);
        const radius = def ? def.radius : TRAP_COLLISION_RADIUS;
        ctx.fillStyle = valid ? "rgba(115,255,159,0.35)" : "rgba(255,80,80,0.35)";
        ctx.beginPath();
        ctx.arc(point.x, point.y, radius, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = valid ? "rgba(115,255,159,0.95)" : "rgba(255,80,80,0.95)";
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(point.x, point.y, radius, 0, Math.PI * 2);
        ctx.stroke();
        ctx.fillStyle = "white";
        ctx.font = "bold 14px Arial";
        ctx.fillText(`${def ? def.name : "Trampa"} · click coloca · Esc/click derecho cancela`, point.x - 160, point.y - radius - 12);
    }

    if (pendingMinePlacement) {
        const point = getSnappedBuildPoint();
        const valid = isMinePositionValid(point.x, point.y);
        const radius = MINE_COLLISION_RADIUS;
        ctx.fillStyle = valid ? "rgba(255,215,106,0.38)" : "rgba(255,80,80,0.35)";
        ctx.beginPath();
        ctx.arc(point.x, point.y, radius, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = valid ? "rgba(255,215,106,0.95)" : "rgba(255,80,80,0.95)";
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(point.x, point.y, radius, 0, Math.PI * 2);
        ctx.stroke();
        ctx.fillStyle = "white";
        ctx.font = "bold 14px Arial";
        ctx.fillText(`Mina · +${formatMoney(getMineIncomeForWave())}/oleada · click coloca`, point.x - 150, point.y - radius - 12);
    }
}

function drawPlayer() {
    const classColor = player?.classColor || player?.color || activeClass?.color || "white";

    if (player.immortal) {
        ctx.strokeStyle = "rgba(255, 226, 138, 0.8)";
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(player.x, player.y, 29, 0, Math.PI * 2);
        ctx.stroke();
    }

    const spriteDrawn = drawPlayerSprite();

    // Si los PNG todavía no cargaron o faltan, usa el dibujo viejo como fallback.
    if (!spriteDrawn) {
        ctx.fillStyle = classColor || "white";
        ctx.beginPath();
        ctx.arc(player.x, player.y, 22, 0, Math.PI * 2);
        ctx.fill();

        ctx.fillStyle = "black";
        ctx.font = "14px Arial";
        ctx.fillText("P", player.x - 5, player.y + 5);
    }

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

    drawPlayerMiniHealthBar();
}

function drawPlayerMiniHealthBar() {
    if (!player) return;
    const width = 46;
    const height = 5;
    const x = player.x - width / 2;
    const y = player.y - 25;
    const pct = Math.max(0, Math.min(1, player.hp / Math.max(1, player.maxHp)));

    ctx.fillStyle = "rgba(0, 0, 0, 0.82)";
    ctx.fillRect(x, y, width, height);
    ctx.fillStyle = "#f48d96";
    ctx.fillRect(x + 1, y + 1, Math.max(0, (width - 2) * pct), Math.max(0, height - 2));
    ctx.strokeStyle = "rgba(255,255,255,0.22)";
    ctx.lineWidth = 1;
    ctx.strokeRect(x, y, width, height);
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
    ctx.fillText(`${actionText} · R rota · Click derecho/Esc cancela`, camera.x + 125, camera.y + 34);

    const rotation = movingTower ? (movingTower.rotation || 0) : towerBuildRotation;
    const dir = getDirectionVector(rotation);
    ctx.strokeStyle = "rgba(255,226,138,0.9)";
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(point.x, point.y);
    ctx.lineTo(point.x + dir.x * 45, point.y + dir.y * 45);
    ctx.stroke();
    if (def && def.type === "spear") {
        ctx.strokeStyle = "rgba(255,226,138,0.35)";
        ctx.lineWidth = def.laneWidth || 38;
        ctx.beginPath();
        ctx.moveTo(point.x, point.y);
        ctx.lineTo(point.x + dir.x * (def.range || 155), point.y + dir.y * (def.range || 155));
        ctx.stroke();
    }
}

function drawTowers() {
    towers.forEach(tower => {
        if (!tower.owned) return;

        if (isStructureSelected("tower", tower.id)) {
            ctx.strokeStyle = "#ffe28a";
            ctx.lineWidth = 4;
            ctx.strokeRect(tower.x - 24, tower.y - 24, 48, 48);
        }

        ensureTowerEconomy(tower);
        ctx.fillStyle = tower.color;
        ctx.fillRect(tower.x - 18, tower.y - 18, 36, 36);

        if (tower.type === "spear") {
            const dir = getDirectionVector(tower.rotation || 0);
            // La lanza visible escala con el rango real de la torre.
            // Así puede colocarse detrás de una barricada y verse claramente
            // cómo atraviesa hacia afuera en la dirección elegida.
            const spearLength = Math.max(42, tower.range || 155);
            const baseOffset = 11;
            const tipX = tower.x + dir.x * spearLength;
            const tipY = tower.y + dir.y * spearLength;
            const startX = tower.x + dir.x * baseOffset;
            const startY = tower.y + dir.y * baseOffset;
            const perpX = -dir.y;
            const perpY = dir.x;
            const headLength = Math.min(22, Math.max(13, spearLength * 0.07));
            const headWidth = 8;

            ctx.strokeStyle = "rgba(255,226,138,0.34)";
            ctx.lineWidth = Math.max(10, Math.min(18, (tower.laneWidth || 38) * 0.38));
            ctx.beginPath();
            ctx.moveTo(startX, startY);
            ctx.lineTo(tipX, tipY);
            ctx.stroke();

            ctx.strokeStyle = "rgba(255,246,190,0.92)";
            ctx.lineWidth = 4;
            ctx.beginPath();
            ctx.moveTo(startX, startY);
            ctx.lineTo(tipX, tipY);
            ctx.stroke();

            ctx.fillStyle = "rgba(255,246,190,0.95)";
            ctx.beginPath();
            ctx.moveTo(tipX, tipY);
            ctx.lineTo(tipX - dir.x * headLength + perpX * headWidth, tipY - dir.y * headLength + perpY * headWidth);
            ctx.lineTo(tipX - dir.x * headLength - perpX * headWidth, tipY - dir.y * headLength - perpY * headWidth);
            ctx.closePath();
            ctx.fill();
        }

        if (tower.type === "laser") {
            const target = tower.laserTarget;
            const charge = Math.max(0.25, Math.min(1, tower.laserCharge || 0.35));
            ctx.strokeStyle = "rgba(255,79,216,0.55)";
            ctx.lineWidth = 3;
            ctx.beginPath();
            ctx.arc(tower.x, tower.y, 22 + charge * 4, 0, Math.PI * 2);
            ctx.stroke();

            ctx.fillStyle = "rgba(255,235,252,0.9)";
            ctx.beginPath();
            ctx.arc(tower.x, tower.y, 7 + charge * 2, 0, Math.PI * 2);
            ctx.fill();

            if (target && target.hp > 0) {
                const wobble = Math.sin(getGameTime() / 38 + (tower.id || 0)) * 1.7;
                ctx.save();
                ctx.shadowColor = tower.color || "#ff4fd8";
                ctx.shadowBlur = 16;
                ctx.strokeStyle = "rgba(255,79,216,0.22)";
                ctx.lineWidth = Math.max(12, (tower.beamWidth || 5) * 2.6);
                ctx.beginPath();
                ctx.moveTo(tower.x, tower.y);
                ctx.lineTo(target.x, target.y);
                ctx.stroke();

                ctx.strokeStyle = "rgba(255,235,252,0.96)";
                ctx.lineWidth = Math.max(3, (tower.beamWidth || 5) * 0.72);
                ctx.beginPath();
                ctx.moveTo(tower.x, tower.y);
                ctx.lineTo(target.x + wobble, target.y - wobble);
                ctx.stroke();

                ctx.strokeStyle = "rgba(255,79,216,0.82)";
                ctx.lineWidth = 1.35;
                ctx.setLineDash([6, 4]);
                ctx.beginPath();
                ctx.moveTo(tower.x, tower.y);
                ctx.lineTo(target.x - wobble, target.y + wobble);
                ctx.stroke();
                ctx.restore();

                ctx.strokeStyle = "rgba(255,245,255,0.95)";
                ctx.lineWidth = tower.beamWidth || 5;
                ctx.beginPath();
                ctx.moveTo(tower.x, tower.y);
                ctx.lineTo(target.x, target.y);
                ctx.stroke();

                ctx.fillStyle = "rgba(255,79,216,0.8)";
                ctx.beginPath();
                ctx.arc(target.x, target.y, 7 + charge * 3, 0, Math.PI * 2);
                ctx.fill();
            }
        }

        if (tower.type === "blade") {
            ctx.strokeStyle = "rgba(255,255,255,0.65)";
            ctx.lineWidth = 3;
            ctx.beginPath();
            ctx.arc(tower.x, tower.y, 23, 0, Math.PI * 2);
            ctx.stroke();
        }

        const hpPct = Math.max(0, Math.min(1, (tower.hp || tower.maxHp || 1) / Math.max(1, tower.maxHp || 1)));
        ctx.fillStyle = "rgba(0,0,0,0.72)";
        ctx.fillRect(tower.x - 20, tower.y + 23, 40, 5);
        ctx.fillStyle = hpPct > 0.45 ? "#73ff9f" : hpPct > 0.22 ? "#ffe28a" : "#ff5d5d";
        ctx.fillRect(tower.x - 20, tower.y + 23, 40 * hpPct, 5);

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

function drawTitanShards() {
    (titanShards || []).forEach(shard => {
        ctx.fillStyle = "rgba(182,77,255,0.85)";
        ctx.beginPath();
        ctx.moveTo(shard.x, shard.y - 16);
        ctx.lineTo(shard.x + 15, shard.y + 12);
        ctx.lineTo(shard.x - 15, shard.y + 12);
        ctx.closePath();
        ctx.fill();
        ctx.strokeStyle = "rgba(255,255,255,0.85)";
        ctx.lineWidth = 2;
        ctx.stroke();
    });
}

function drawMines() {
    (mines || []).forEach(mine => {
        if (!mine || mine.hp <= 0) return;
        const radius = mine.radius || MINE_COLLISION_RADIUS;
        const pulse = mine.pulseUntil && mine.pulseUntil > getGameTime();

        ctx.save();
        ctx.shadowColor = pulse ? "rgba(255, 208, 120, 0.95)" : "rgba(255, 149, 0, 0.55)";
        ctx.shadowBlur = pulse ? 18 : 8;

        ctx.fillStyle = pulse ? "#ffb347" : "#ff9b21";
        ctx.beginPath();
        ctx.arc(mine.x, mine.y, radius, 0, Math.PI * 2);
        ctx.fill();

        ctx.strokeStyle = pulse ? "#ffd78a" : "#ffcf80";
        ctx.lineWidth = pulse ? 3 : 2;
        ctx.beginPath();
        ctx.arc(mine.x, mine.y, radius, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();

        ctx.fillStyle = "#fff4cc";
        ctx.font = "bold 15px Arial";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText("$", mine.x, mine.y + 1);
        ctx.textAlign = "left";
        ctx.textBaseline = "alphabetic";

        const maxHp = Math.max(1, mine.maxHp || MINE_MAX_HP);
        const hpPercent = Math.max(0, Math.min(1, (mine.hp ?? maxHp) / maxHp));
        ctx.fillStyle = "rgba(0,0,0,0.72)";
        ctx.fillRect(mine.x - 24, mine.y + radius + 10, 48, 6);
        ctx.fillStyle = hpPercent > 0.45 ? "#73ff9f" : hpPercent > 0.22 ? "#ffe28a" : "#ff6262";
        ctx.fillRect(mine.x - 24, mine.y + radius + 10, 48 * hpPercent, 6);
        ctx.strokeStyle = "rgba(255,255,255,0.55)";
        ctx.lineWidth = 1;
        ctx.strokeRect(mine.x - 24, mine.y + radius + 10, 48, 6);

        if (mine.lastIncome) {
            ctx.fillStyle = "rgba(255,255,255,0.9)";
            ctx.font = "bold 10px Arial";
            ctx.fillText(`+${formatMoney(mine.lastIncome)}`, mine.x - 16, mine.y - radius - 12);
        }
    });
}

function drawTraps() {
    (traps || []).forEach(trap => {
        ctx.fillStyle = trap.type === "snare" ? "rgba(155,231,255,0.55)" : "rgba(255,107,107,0.55)";
        ctx.beginPath();
        ctx.arc(trap.x, trap.y, trap.radius || TRAP_COLLISION_RADIUS, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = trap.color || "white";
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(trap.x, trap.y, (trap.radius || TRAP_COLLISION_RADIUS) + 3, 0, Math.PI * 2);
        ctx.stroke();
        ctx.fillStyle = "white";
        ctx.font = "bold 12px Arial";
        ctx.fillText(trap.type === "snare" ? "A" : "S", trap.x - 4, trap.y + 4);
    });
}

function drawTitanShards() {
    if (!titanShards || !titanShards.length) return;
    const now = getGameTime();

    titanShards.forEach(shard => {
        if (!shard) return;
        const radius = shard.radius || TITAN_SHARD_RADIUS;
        const pulse = Math.sin(now * 0.006 + (shard.id || 0)) * 0.5 + 0.5;
        const glow = radius + 8 + pulse * 8;
        const bob = Math.sin(now * 0.004 + (shard.id || 0)) * 3;
        const x = shard.x;
        const y = shard.y + bob;

        ctx.save();

        // Aura grande para que no se pierda entre enemigos/torres.
        ctx.globalAlpha = 0.32 + pulse * 0.22;
        ctx.fillStyle = "#b64dff";
        ctx.beginPath();
        ctx.arc(x, y, glow, 0, Math.PI * 2);
        ctx.fill();

        ctx.globalAlpha = 1;
        ctx.shadowColor = "#d58cff";
        ctx.shadowBlur = 18 + pulse * 10;

        // Cristal violeta visible en el mundo.
        ctx.fillStyle = "#9b35ff";
        ctx.beginPath();
        ctx.moveTo(x, y - radius - 4);
        ctx.lineTo(x + radius * 0.78, y - radius * 0.08);
        ctx.lineTo(x + radius * 0.52, y + radius + 5);
        ctx.lineTo(x - radius * 0.52, y + radius + 5);
        ctx.lineTo(x - radius * 0.78, y - radius * 0.08);
        ctx.closePath();
        ctx.fill();

        ctx.strokeStyle = "#f0d4ff";
        ctx.lineWidth = 2;
        ctx.stroke();

        // Brillo interno tipo gema.
        ctx.shadowBlur = 0;
        ctx.fillStyle = "rgba(255,255,255,0.78)";
        ctx.beginPath();
        ctx.moveTo(x - radius * 0.18, y - radius * 0.58);
        ctx.lineTo(x + radius * 0.12, y - radius * 0.18);
        ctx.lineTo(x - radius * 0.08, y + radius * 0.18);
        ctx.lineTo(x - radius * 0.36, y - radius * 0.12);
        ctx.closePath();
        ctx.fill();

        // Indicador sutil de recogible.
        ctx.fillStyle = "rgba(255,255,255,0.92)";
        ctx.font = "bold 10px Arial";
        ctx.textAlign = "center";
        ctx.fillText("FRAGMENTO", x, y - radius - 13);
        ctx.textAlign = "left";

        ctx.restore();
    });
}

function drawEnemies() {
    enemies.forEach(enemy => {
        let radius = enemy.radius;
        if (enemy.untargetable && enemy.special !== "visitor") ctx.globalAlpha = 0.28;

        if (enemy.hitFlash > 0) {
            radius += 3;
        }

        const spriteDrawn = enemy.special === "visitor" ? drawVisitorSprite(enemy) : drawEnemySprite(enemy, radius);
        if (!spriteDrawn) {
            ctx.fillStyle = enemy.hitFlash > 0 ? "white" : enemy.color;
            ctx.beginPath();
            ctx.arc(enemy.x, enemy.y, radius, 0, Math.PI * 2);
            ctx.fill();
        }

        if (enemy.special === "healer") {
            ctx.strokeStyle = "rgba(115,255,159,0.35)";
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.arc(enemy.x, enemy.y, Math.min(enemy.healRadius || 0, 90), 0, Math.PI * 2);
            ctx.stroke();
        }
        // Círculo decorativo del Titán removido: el nombre/barra y sus ataques ya comunican la amenaza.


        if (enemy.special === "exploder") {
            const pulse = 0.5 + Math.sin(getGameTime() * 0.012 + (enemy.id || 0)) * 0.5;
            ctx.strokeStyle = `rgba(255,190,60,${0.45 + pulse * 0.45})`;
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.arc(enemy.x, enemy.y, enemy.radius + 6 + pulse * 3, 0, Math.PI * 2);
            ctx.stroke();
            ctx.fillStyle = "#ffe28a";
            ctx.font = "bold 18px Arial";
            ctx.textAlign = "center";
            ctx.fillText("!", enemy.x, enemy.y - enemy.radius - 20 - pulse * 3);
            ctx.textAlign = "left";
        }


        if (enemy.special === "herald") {
            ctx.strokeStyle = "rgba(255,79,216,0.28)";
            ctx.lineWidth = 2;
            ctx.beginPath(); ctx.arc(enemy.x, enemy.y, Math.min(enemy.auraRadius || 0, 90), 0, Math.PI * 2); ctx.stroke();
        }
        if (enemy.special === "shielded" && (enemy.shieldHp || 0) > 0) {
            ctx.strokeStyle = "#8fa8ff"; ctx.lineWidth = 4;
            ctx.beginPath(); ctx.arc(enemy.x, enemy.y, enemy.radius + 6, -Math.PI/2, Math.PI/2); ctx.stroke();
        }
        // Círculo decorativo del Espejo removido; su reflect queda en la lógica de daño.
        if (enemy.special === "visitor" && !enemy.retreating) {
            ctx.save();
            ctx.textAlign = "center";
            ctx.font = "bold 13px Arial";
            ctx.lineWidth = 4;
            ctx.strokeStyle = "rgba(0,0,0,0.92)";
            ctx.fillStyle = "#ffffff";
            const label = "EL VISITANTE";
            ctx.strokeText(label, enemy.x, enemy.y - enemy.radius - 36);
            ctx.fillText(label, enemy.x, enemy.y - enemy.radius - 36);
            const visitorBarWidth = 68;
            const visitorBarY = enemy.y - enemy.radius - 29;
            const visitorPct = Math.max(0, Math.min(1, enemy.hp / Math.max(1, enemy.maxHp)));
            ctx.fillStyle = "rgba(0,0,0,0.82)";
            ctx.fillRect(enemy.x - visitorBarWidth / 2, visitorBarY, visitorBarWidth, 6);
            ctx.fillStyle = "#ffffff";
            ctx.fillRect(enemy.x - visitorBarWidth / 2 + 1, visitorBarY + 1, (visitorBarWidth - 2) * visitorPct, 4);
            ctx.strokeStyle = "rgba(255,40,40,0.95)";
            ctx.lineWidth = 1;
            ctx.strokeRect(enemy.x - visitorBarWidth / 2, visitorBarY, visitorBarWidth, 6);
            ctx.restore();
        }
        if (enemy.special !== "visitor") {
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
        }
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

function drawLightningEffect(e) {
    const alpha = Math.max(0, e.life / (e.maxLife || 18));
    const segments = 9;
    const dx = e.x2 - e.x1;
    const dy = e.y2 - e.y1;
    const len = Math.hypot(dx, dy) || 1;
    const nx = -dy / len;
    const ny = dx / len;
    const jitter = e.branch ? 8 : 15;
    const points = [];

    for (let i = 0; i <= segments; i++) {
        const t = i / segments;
        const noise = i === 0 || i === segments ? 0 : Math.sin((e.seed || 0) + i * 12.989 + e.life * 0.7) * jitter * (0.45 + Math.sin(t * Math.PI));
        points.push({
            x: e.x1 + dx * t + nx * noise,
            y: e.y1 + dy * t + ny * noise
        });
    }

    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    ctx.lineCap = "round";
    ctx.lineJoin = "round";

    ctx.strokeStyle = `rgba(50,130,255,${0.22 * alpha})`;
    ctx.lineWidth = e.branch ? 7 : 11;
    ctx.beginPath();
    points.forEach((p, i) => i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y));
    ctx.stroke();

    ctx.strokeStyle = `rgba(75,195,255,${0.75 * alpha})`;
    ctx.lineWidth = e.branch ? 3 : 5;
    ctx.beginPath();
    points.forEach((p, i) => i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y));
    ctx.stroke();

    ctx.strokeStyle = `rgba(235,252,255,${0.95 * alpha})`;
    ctx.lineWidth = e.branch ? 1.4 : 2.2;
    ctx.beginPath();
    points.forEach((p, i) => i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y));
    ctx.stroke();

    ctx.restore();
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
            const alpha = Math.max(0, Math.min(0.48, (e.life / (e.maxLife || 58)) * 0.48));
            const dx = e.dx || 1;
            const dy = e.dy || 0;
            const length = e.length || 120;
            const width = e.width || 120;
            const angle = Math.atan2(dy, dx);

            ctx.save();
            ctx.translate(e.x, e.y);
            ctx.rotate(angle);

            const gradient = ctx.createLinearGradient(0, 0, length, 0);
            gradient.addColorStop(0, `rgba(155,231,255,${alpha * 0.15})`);
            gradient.addColorStop(0.35, `rgba(74,163,255,${alpha})`);
            gradient.addColorStop(1, `rgba(155,231,255,${alpha * 0.15})`);
            ctx.fillStyle = gradient;
            ctx.beginPath();
            ctx.roundRect ? ctx.roundRect(0, -width / 2, length, width, width * 0.35) : ctx.rect(0, -width / 2, length, width);
            ctx.fill();

            ctx.strokeStyle = `rgba(210,248,255,${Math.min(0.95, alpha + 0.22)})`;
            ctx.lineWidth = 3;
            for (let i = -2; i <= 2; i++) {
                const y = i * width / 6;
                ctx.beginPath();
                for (let x = 0; x <= length; x += 18) {
                    const wave = Math.sin((x + (e.foamOffset || 0) + e.life * 5) * 0.045 + i) * 8;
                    if (x === 0) ctx.moveTo(x, y + wave);
                    else ctx.lineTo(x, y + wave);
                }
                ctx.stroke();
            }

            ctx.fillStyle = `rgba(230,252,255,${Math.min(0.9, alpha + 0.25)})`;
            for (let i = 0; i < 9; i++) {
                const px = (i / 9) * length + ((e.foamOffset || 0) % 18);
                const py = Math.sin(i * 1.7 + e.life * 0.18) * width * 0.32;
                ctx.beginPath();
                ctx.arc(px, py, 3 + (i % 3), 0, Math.PI * 2);
                ctx.fill();
            }

            ctx.restore();
        }

        if (e.type === "eclipse") {
            const lifeRatio = Math.max(0, Math.min(1, e.life / (e.maxLife || 240)));
            const alpha = Math.max(0.12, Math.min(0.58, lifeRatio * 0.58));

            ctx.save();
            ctx.globalCompositeOperation = "source-over";
            ctx.fillStyle = `rgba(9, 2, 18, ${alpha})`;
            ctx.beginPath();
            ctx.arc(e.x, e.y, e.radius, 0, Math.PI * 2);
            ctx.fill();

            const glow = ctx.createRadialGradient(e.x, e.y, Math.max(8, e.radius * 0.08), e.x, e.y, e.radius);
            glow.addColorStop(0, `rgba(190,120,255,${0.18 * lifeRatio})`);
            glow.addColorStop(0.58, `rgba(92,40,150,${0.30 * lifeRatio})`);
            glow.addColorStop(1, `rgba(180,110,255,0)`);
            ctx.fillStyle = glow;
            ctx.beginPath();
            ctx.arc(e.x, e.y, e.radius, 0, Math.PI * 2);
            ctx.fill();

            ctx.globalCompositeOperation = "lighter";
            ctx.strokeStyle = `rgba(207,168,255,${0.95 * lifeRatio})`;
            ctx.lineWidth = 5;
            ctx.beginPath();
            ctx.arc(e.x, e.y, e.radius, 0, Math.PI * 2);
            ctx.stroke();

            e.pulseRadius += 8 * frameScale;
            ctx.strokeStyle = `rgba(232,214,255,${0.85 * lifeRatio})`;
            ctx.lineWidth = 2.5;
            ctx.beginPath();
            ctx.arc(e.x, e.y, Math.min(e.radius, e.pulseRadius), 0, Math.PI * 2);
            ctx.stroke();

            const moonRadius = Math.max(22, e.radius * 0.19);
            const spin = (e.rotation || 0) + (e.maxLife - e.life) * 0.01;
            const moonX = e.x + Math.cos(spin) * e.radius * 0.18;
            const moonY = e.y + Math.sin(spin) * e.radius * 0.10;
            ctx.fillStyle = `rgba(225,205,255,${0.95 * lifeRatio})`;
            ctx.beginPath();
            ctx.arc(moonX, moonY, moonRadius, 0, Math.PI * 2);
            ctx.fill();
            ctx.globalCompositeOperation = "source-over";
            ctx.fillStyle = `rgba(20,6,38,${0.96 * lifeRatio})`;
            ctx.beginPath();
            ctx.arc(moonX + moonRadius * 0.38, moonY - moonRadius * 0.08, moonRadius * 0.92, 0, Math.PI * 2);
            ctx.fill();

            ctx.restore();
        }

        if (e.type === "lightning") {
            drawLightningEffect(e);
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
    // Línea de apuntado desactivada: molestaba visualmente y podía bugearse.
    // El disparo sigue usando mousePosition/crosshair normalmente.
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
    return Array.from({ length: getEffectiveInventorySlotCount() }, () => ({ itemKey: null, quantity: 0 }));
}

function normalizeInventory(savedInventory) {
    const normalized = createEmptyInventory();
    if (!Array.isArray(savedInventory)) return normalized;

    savedInventory.slice(0, getEffectiveInventorySlotCount()).forEach((slot, index) => {
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
    if (!def || !costs || coins < getEffectiveCost(costs[costKey], "consumables")) return;

    if (!hasInventorySpaceFor(itemKey)) {
        showCenterMessage("Inventario lleno", 800);
        updateHud(true);
        return;
    }

    coins -= getEffectiveCost(costs[costKey], "consumables");
    addConsumableToInventory(itemKey);
    costs[costKey] = scaleConsumableCost(costs[costKey], costMultiplier);
    showCenterMessage(`${def.name} guardada`, 700);
    updateHud(true);
    autoSaveRun(true);
}

function applyConsumableEffect(itemKey) {
    if (runStats) runStats.consumablesUsedThisWave++;
    const def = consumableDefinitions[itemKey];
    if (!def || !player) return false;

    if (def.effect === "heal") {
        if (!hasDamagedPlayerHp()) {
            showCenterMessage("Vida llena", 600);
            return false;
        }
        healOverTime(def.heal * (player?.consumablePowerMultiplier || 1) * (player?.healingMultiplier || 1), def.duration * (player?.consumablePowerMultiplier || 1));
    }

    if (def.effect === "shield") {
        player.shieldCharges += 1;
    }

    if (def.effect === "attackSpeed") {
        player.attackSpeedUntil = getGameTime() + def.duration * (player?.consumablePowerMultiplier || 1);
    }

    if (def.effect === "doubleShot") {
        player.doubleShotUntil = getGameTime() + def.duration * (player?.consumablePowerMultiplier || 1);
    }

    if (def.effect === "lifeSteal") {
        player.lifeStealPercent = 0.22;
        player.lifeStealUntil = getGameTime() + def.duration * (player?.consumablePowerMultiplier || 1);
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
    if (force || signature !== inventoryRenderSignature || inventorySlotsPanel.children.length !== getEffectiveInventorySlotCount()) {
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
    const cost = hasFreeBarricadePurchase(kind) ? 0 : getBarricadeBaseCost(kind);
    const locked = false;
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
    const hpPct = Math.max(0, Math.min(1, player.hp / Math.max(1, player.maxHp)));
    hpText.textContent = `${Math.round(player.hp)}/${player.maxHp}${player.shieldCharges > 0 ? ` 🛡${player.shieldCharges}` : ""}`;
    const hpBarFill = document.getElementById("hpBarFill");
    const hpHudBox = document.getElementById("hpHudBox");
    if (hpBarFill) hpBarFill.style.width = `${hpPct * 100}%`;
    if (hpHudBox) hpHudBox.title = `Vida: ${Math.round(player.hp)}/${player.maxHp}${player.shieldCharges > 0 ? ` · Escudos: ${player.shieldCharges}` : ""}`;
    barricadeText.textContent = `Muros ${Math.round(getTotalBarricadeHp())}/${Math.round(getTotalBarricadeMaxHp())}`;
    coinsText.textContent = formatMoney(coins);
    scoreText.textContent = formatCompactNumber(score);

    playerDamageText.textContent = player.damage;
    playerFireDelayText.textContent = player.fireDelay;
    playerMaxHpText.textContent = player.maxHp;
    critChanceText.textContent = Math.round(player.critChance * 100);

    setCostText(damageCostText, getEffectiveCost(costs.damage, "damage"), false);
    setCostText(fireRateCostText, getEffectiveCost(costs.fireRate, "fireRate"), false);
    setCostText(maxHpCostText, getEffectiveCost(costs.maxHp, "maxHp"), false);
    setCostText(critCostText, getEffectiveCost(costs.crit, "crit"), false);

    setShopButtonAffordability(upgradeDamageBtn, costs.damage);
    setShopButtonAffordability(upgradeFireRateBtn, costs.fireRate);
    setShopButtonAffordability(upgradeMaxHpBtn, costs.maxHp);
    setShopButtonAffordability(upgradeCritBtn, costs.crit);

    setCostText(smallPotionCostText, getEffectiveCost(costs.smallPotion, "consumables"), false);
    setCostText(mediumPotionCostText, getEffectiveCost(costs.mediumPotion, "consumables"), false);
    setCostText(largePotionCostText, getEffectiveCost(costs.largePotion, "consumables"), false);
    if (shieldPotionCostText) setCostText(shieldPotionCostText, getEffectiveCost(costs.shieldPotion, "consumables"), false);
    if (attackSpeedPotionCostText) setCostText(attackSpeedPotionCostText, getEffectiveCost(costs.attackSpeedPotion, "consumables"), false);
    if (doubleShotPotionCostText) setCostText(doubleShotPotionCostText, getEffectiveCost(costs.doubleShotPotion, "consumables"), false);
    if (lifeStealPotionCostText) setCostText(lifeStealPotionCostText, getEffectiveCost(costs.lifeStealPotion, "consumables"), false);

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
    setCostText(upgradeBarricadeCostText, getBarricadeBaseCost("standard"), hasFreeBarricadePurchase("standard"));
    if (regenBarricadeCostText) setCostText(regenBarricadeCostText, getBarricadeBaseCost("regen"), hasFreeBarricadePurchase("regen"));
    if (explosiveBarricadeCostText) setCostText(explosiveBarricadeCostText, getBarricadeBaseCost("explosive"), hasFreeBarricadePurchase("explosive"));
    if (thornsBarricadeCostText) setCostText(thornsBarricadeCostText, getBarricadeBaseCost("thorns"), hasFreeBarricadePurchase("thorns"));

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
    updateBarricadeButtonState(buyDoorBarricadeBtn, "door", "doorBarricade");
    if (doorBarricadeCostText) setCostText(doorBarricadeCostText, getBarricadeBaseCost("door"), hasFreeBarricadePurchase("door"));

    barricadeTierText.textContent = player?.unlockDeepObsidian ? "Arquitecto: Aetherita desbloqueada · click para colocar" : "Muro básico libre · click para colocar";
    updateBarricadeSlotChoiceUI();
    clampPlayerToPlayableArea();

    towerDefinitions.forEach((def, index) => {
        const el = document.getElementById(`tower${index + 1}CostText`);
        const free = hasFreeTowerPurchase(def.key);
        const price = free ? 0 : getEffectiveCost(costs[def.key] ?? def.cost, "towers");
        setCostText(el, price, free);
    });

    if (towerSlotCostText) { towerSlotCostText.textContent = towerSlotLimit >= MAX_TOWER_LIMIT ? "MAX" : formatMoney(costs.towerSlot); towerSlotCostText.classList.remove("freeCost"); }

    setCostText(bombCostText, getEffectiveCost(abilities.bomb.cost, "abilities"), false);
    setCostText(freezeCostText, getEffectiveCost(abilities.freeze.cost, "abilities"), false);
    setCostText(tsunamiCostText, getEffectiveCost(abilities.tsunami.cost, "abilities"), false);
    setCostText(lightningCostText, getEffectiveCost(abilities.lightning.cost, "abilities"), false);
    setCostText(meteorCostText, getEffectiveCost(abilities.meteor.cost, "abilities"), false);
    if (eclipseCostText) setCostText(eclipseCostText, getEffectiveCost(abilities.eclipse.cost, "abilities"), false);
    if (blinkCostText && abilities.blink) setCostText(blinkCostText, getEffectiveCost(abilities.blink.cost, "abilities"), false);

    updateTowerShopVisibility();
    updateAbilityShopVisibility();
    updateAbilityBar();
    updateBossBar();
    updateBuildCancelUI();
    updateBuildPhaseUI();
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
        const free = hasFreeTowerPurchase(def.key);
        const price = free ? 0 : getEffectiveCost(costs[def.key] ?? def.cost, "towers");
        if (btn) {
            const extraDisabled = !!pendingTowerPurchase || full || !buildPhaseActive;
            const extraTitle = !buildPhaseActive ? "Solo podés construir durante el descanso entre oleadas." : full ? "Límite de slots de torre alcanzado. Comprá un slot extra." : pendingTowerPurchase ? "Ya estás colocando una torre" : "";
            setShopButtonAffordability(btn, price, extraDisabled, extraTitle);
        }
    });
    const freeTrap = hasFreeTrapPurchase();
    const snarePrice = freeTrap ? 0 : getEffectiveCost(costs.trapSnare ?? trapDefinitions.snare.cost, "traps");
    const bleedPrice = freeTrap ? 0 : getEffectiveCost(costs.trapBleed ?? trapDefinitions.bleed.cost, "traps");
    if (buyTrapSnareBtn) setShopButtonAffordability(buyTrapSnareBtn, snarePrice, !buildPhaseActive || !!pendingTrapPlacement, !buildPhaseActive ? "Solo durante el descanso entre oleadas." : "");
    if (buyTrapBleedBtn) setShopButtonAffordability(buyTrapBleedBtn, bleedPrice, !buildPhaseActive || !!pendingTrapPlacement, !buildPhaseActive ? "Solo durante el descanso entre oleadas." : "");
    if (trapSnareCostText) setCostText(trapSnareCostText, snarePrice, freeTrap);
    if (trapBleedCostText) setCostText(trapBleedCostText, bleedPrice, freeTrap);

    const currentMineCount = (mines || []).length;
    const mineAtLimit = currentMineCount >= MINE_LIMIT;
    const freeMine = !mineAtLimit && hasFreeMinePurchase();
    const minePrice = mineAtLimit ? 0 : freeMine ? 0 : getEffectiveCost(costs.mineGold ?? getMineCostForCount(currentMineCount), "mines");
    if (buyMineGoldBtn) {
        const disabled = !buildPhaseActive || !!pendingMinePlacement || mineAtLimit;
        const title = !buildPhaseActive ? "Solo durante el descanso entre oleadas." : mineAtLimit ? `Máximo ${MINE_LIMIT} minas.` : pendingMinePlacement ? "Ya estás colocando una mina." : `Genera aproximadamente ${formatMoney(getMineIncomeForWave())} oro por mina al completar la próxima oleada.`;
        setShopButtonAffordability(buyMineGoldBtn, minePrice, disabled, title);
    }
    if (mineGoldCostText) { if (mineAtLimit) { mineGoldCostText.textContent = "MAX"; mineGoldCostText.classList.remove("freeCost"); } else setCostText(mineGoldCostText, minePrice, freeMine); }
    if (mineLimitText) mineLimitText.textContent = `${currentMineCount}/${MINE_LIMIT} minas · +${formatMoney(getMineIncomeForWave())} c/u próxima oleada`;

    if (repeatWaveBtn) {
        const targetWave = getRepeatTargetWave();
        const repeats = getRepeatCountForWave(targetWave);
        const canRepeat = buildPhaseActive && !waveInProgress && targetWave >= 1;
        repeatWaveBtn.classList.toggle("hidden", !canRepeat);
        repeatWaveBtn.disabled = !canRepeat || repeats >= REPEAT_LIMIT_PER_WAVE;
        repeatWaveBtn.textContent = repeats >= REPEAT_LIMIT_PER_WAVE
            ? `Repetir ${targetWave}: límite`
            : `Repetir ${targetWave} (${repeats}/${REPEAT_LIMIT_PER_WAVE})`;
        repeatWaveBtn.title = "Repite la misma oleada: enemigos +20% y 60% del oro de enemigos/bonus. Las minas pagan normal. El Titán Negro no da mejoras en repeat.";
    }

    updateAutoRepeatWaveButton();

    if (nextWaveBtn) {
        // Durante la fase de compra/construcción NO mostramos el botón viejo de siguiente oleada.
        // La oleada solo puede avanzar cuando termina el timer o cuando se usa Saltar preparación.
        nextWaveBtn.classList.toggle("hidden", waveInProgress || buildPhaseActive);
        nextWaveBtn.disabled = waveInProgress || buildPhaseActive;
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
    if (buyBlinkBtn && abilities.blink) setShopButtonAffordability(buyBlinkBtn, abilities.blink.cost, abilities.blink.owned, abilities.blink.owned ? "Ya compraste esta habilidad" : "");

    if (abilities.bomb.owned) buyBombBtn.innerHTML = `Bomba comprada<br><small>${abilities.bomb.key} para usar</small>`;
    if (abilities.freeze.owned) buyFreezeBtn.innerHTML = `Congelar comprado<br><small>${abilities.freeze.key} para usar</small>`;
    if (abilities.tsunami.owned) buyTsunamiBtn.innerHTML = `Tsunami comprado<br><small>${abilities.tsunami.key} para usar</small>`;
    if (abilities.lightning.owned) buyLightningBtn.innerHTML = `Rayo comprado<br><small>${abilities.lightning.key} para usar</small>`;
    if (abilities.meteor.owned) buyMeteorBtn.innerHTML = `Meteorito comprado<br><small>${abilities.meteor.key} para usar</small>`;
    if (buyEclipseBtn && abilities.eclipse.owned) buyEclipseBtn.innerHTML = `Eclipse comprado<br><small>${abilities.eclipse.key} para usar</small>`;
    if (buyBlinkBtn && abilities.blink?.owned) buyBlinkBtn.innerHTML = `Blink comprado<br><small>${abilities.blink.key} para usar</small>`;
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
    // Fondo limpio: sin tiles, sin grilla y sin piso especial.
    // Mantenerlo sólido ayuda a leer mejor las barricadas y las formas de la base.
    ctx.fillStyle = "#263c26";
    ctx.fillRect(0, 0, WORLD_WIDTH, WORLD_HEIGHT);
}

function drawBossSpawnZone() {
    // Zona central de aparición de jefes / Titán Negro.
    // Antes solo se veía en el minimapa; ahora también queda marcada en el mundo.
    const zone = getBossSpawnRect(0);
    const width = zone.right - zone.left;
    const height = zone.bottom - zone.top;

    ctx.save();
    ctx.fillStyle = "rgba(150, 150, 150, 0.32)";
    ctx.fillRect(zone.left, zone.top, width, height);

    ctx.strokeStyle = "rgba(210, 210, 210, 0.72)";
    ctx.lineWidth = 4;
    ctx.strokeRect(zone.left, zone.top, width, height);

    ctx.strokeStyle = "rgba(40, 40, 40, 0.38)";
    ctx.lineWidth = 2;
    ctx.strokeRect(zone.left + 5, zone.top + 5, Math.max(0, width - 10), Math.max(0, height - 10));
    ctx.restore();
}

function drawMinimap() {
    const scale = visualSettings.minimapScale || 0.82;
    const w = Math.round(150 * scale);
    const h = Math.round(w * (WORLD_HEIGHT / WORLD_WIDTH));
    const x = GAME_WIDTH - w - 14;
    // Va justo arriba del inventario/barra inferior para que no se pisen.
    const bottomOffset = getBottomUiGameHeight();
    const y = Math.max(54, GAME_HEIGHT - h - bottomOffset - 12);
    ctx.save();
    ctx.setTransform(canvas.width / GAME_WIDTH, 0, 0, canvas.height / GAME_HEIGHT, 0, 0);
    const blindMinimap = activeWaveEvent?.id === "blindness" && waveInProgress;

    // Durante Ceguera del Abismo, el minimapa queda completamente inutilizable:
    // nada de terreno, cámara, jugador, estructuras ni enemigos. Solo oscuridad y una duda enorme.
    if (blindMinimap) {
        ctx.fillStyle = "rgba(0,0,0,0.96)";
        ctx.fillRect(x, y, w, h);
        ctx.strokeStyle = "rgba(255,77,77,0.72)";
        ctx.lineWidth = 2;
        ctx.strokeRect(x, y, w, h);

        ctx.save();
        ctx.shadowColor = "rgba(255,77,77,0.95)";
        ctx.shadowBlur = 14;
        ctx.font = `900 ${Math.max(34, Math.round(54 * scale))}px Arial`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillStyle = "#ff4d4d";
        ctx.fillText("?", x + w / 2, y + h / 2 + 1);
        ctx.restore();

        ctx.restore();
        return;
    }

    ctx.fillStyle = "rgba(0,0,0,0.72)";
    ctx.fillRect(x, y, w, h);
    ctx.strokeStyle = "rgba(255,255,255,0.45)";
    ctx.strokeRect(x, y, w, h);
    const sx = w / WORLD_WIDTH;
    const sy = h / WORLD_HEIGHT;
    const bz = getBossSpawnRect(0);
    ctx.fillStyle = "rgba(150,150,150,0.55)";
    ctx.fillRect(x + bz.left * sx, y + bz.top * sy, (bz.right - bz.left) * sx, (bz.bottom - bz.top) * sy);
    const dot = (wx, wy, color, r = 2) => {
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.arc(x + wx * sx, y + wy * sy, r, 0, Math.PI * 2);
        ctx.fill();
    };
    if (player) dot(player.x, player.y, "#66d9ff", 4);
    enemies.forEach(e => dot(e.x, e.y, e.special === "visitor" ? "#ffffff" : (e.isBoss ? "#ff55ff" : "#ff3333"), e.special === "visitor" ? 4.2 : (e.isBoss ? 3.8 : 2)));
    towers.forEach(t => dot(t.x, t.y, "#ffffff", 1.7));
    (traps || []).forEach(trap => dot(trap.x, trap.y, trap.type === "snare" ? "#9be7ff" : "#ff6b6b", 1.4));
    (mines || []).forEach(mine => { if (mine.hp > 0) dot(mine.x, mine.y, "#ffd76a", 1.7); });
    (titanShards || []).forEach(shard => dot(shard.x, shard.y, "#b64dff", 2.2));
    barricades.forEach(b => { if (b.active && b.hp > 0) dot(b.x, b.y, "#aaaaaa", 1.6); });
    ctx.strokeStyle = "rgba(115,255,159,0.7)";
    ctx.strokeRect(x + camera.x * sx, y + camera.y * sy, getCameraVisibleWidth() * sx, getCameraVisibleHeight() * sy);
    ctx.restore();
}

function draw() {
    resizeCanvasForDisplay();
    updateCamera();
    ctx.clearRect(0, 0, GAME_WIDTH, GAME_HEIGHT);

    ctx.save();
    const zoom = getCameraZoom();
    ctx.scale(zoom, zoom);
    ctx.translate(-camera.x, -camera.y);
    drawWorldGrid();
    drawBossSpawnZone();
    drawPath();
    drawBase();
    drawBarricade();
    drawMines();
    drawTraps();
    drawTitanShards();
    drawPlayer();
    drawTowerPlacementTiles();
    drawTowers();
    drawSlowZones();
    drawEnemies();
    drawProjectiles();
    drawBossProjectiles();
    drawVisualEffects();
    ctx.restore();

    drawFlyingCoins();
    drawWaveEventOverlay();
    drawMinimap();
}


function drawWaveEventOverlay() {
    if (activeWaveEvent?.id === "blindness" && waveInProgress) {
        const center = player ? getWorldToScreenPoint(player.x, player.y) : { x: GAME_WIDTH / 2, y: GAME_HEIGHT / 2 };
        const innerRadius = 118;
        const softRadius = 238;
        const grd = ctx.createRadialGradient(center.x, center.y, innerRadius, center.x, center.y, softRadius);
        grd.addColorStop(0, "rgba(0,0,0,0)");
        grd.addColorStop(0.46, "rgba(0,0,0,0.18)");
        grd.addColorStop(0.78, "rgba(0,0,0,0.82)");
        grd.addColorStop(1, "rgba(0,0,0,0.96)");
        ctx.save();
        ctx.fillStyle = grd;
        ctx.fillRect(0, 0, GAME_WIDTH, GAME_HEIGHT);
        ctx.restore();
    }
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
    updateBuildPhase();

    const managementModeActive = isManagementModeActive();
    const waveActive = gameRunning && waveInProgress && !isPaused && !managementModeActive;
    const buildIntermissionActive = buildPhaseActive && !isPaused && !isElementVisible(shop) && !isElementVisible(consolePanel) && !isElementVisible(waveSummaryPanel) && !isElementVisible(gameOverScreen);

    if (gameStarted && !document.hidden && (waveActive || buildIntermissionActive)) {
        gameTime += delta * gameSpeed;
        totalRunTimeMs += delta * gameSpeed;
    }

    if (!gameStarted) {
        requestAnimationFrame(gameLoop);
        return;
    }

    const now = getGameTime();

    if (waveActive) {
        if (enemiesSpawned < enemiesToSpawn && now - lastSpawnTime > spawnInterval) {
            spawnEnemy();
            lastSpawnTime = now;
        }

        ensureBossWaveSpawned();
        updateBossPressureSpawns(now);

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
    } else if (buildIntermissionActive) {
        // Intermedio activo: no aparecen enemigos, pero el jugador puede moverse
        // y construir mientras corre el contador hacia la próxima oleada.
        updatePlayerMovement();
        regenerateBarricades();
        updateVisitorsDuringBuildPhase();
    }

    updateVisualEffects();
    updateFlyingCoins();
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

function isManagementModeActive() {
    return (
        isElementVisible(shop) ||
        isElementVisible(structurePanel) ||
        isElementVisible(consolePanel) ||
        isElementVisible(waveSummaryPanel) ||
        isElementVisible(gameOverScreen) ||
        isElementVisible(relicChoicePanel) ||
        isInBuildPlacementMode()
    );
}

function isWaveBlockingPanelOpen() {
    return isManagementModeActive();
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


function getConsoleSpawnDefinitions() {
    const entries = [];
    enemyTypes.forEach((type, index) => entries.push({ key: `bicho${index + 1}`, aliases: [type.name.toLowerCase(), `normal${index + 1}`], type }));
    specialEnemyTypes.forEach(type => {
        const key = type.special || type.name.toLowerCase();
        entries.push({ key, aliases: [type.name.toLowerCase(), key], type });
    });
    bossTypes.forEach((type, index) => entries.push({ key: `boss${index + 1}`, aliases: [type.name.toLowerCase(), `jefe${index + 1}`], bossType: type }));
    entries.push({ key: "visitante", aliases: ["elvisitante", "el visitante", "visitor"], visitor: true });
    entries.push({ key: "titan", aliases: ["titán", "titan negro", "titán negro", "doombringer"], type: specialEnemyTypes.find(t => t.special === "doombringer") });
    return entries;
}

function normalizeSpawnName(value = "") {
    return String(value || "").trim().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[\s_-]+/g, "");
}

function getSpawnableEnemyListText() {
    const keys = Array.from(new Set(getConsoleSpawnDefinitions().map(e => e.key))).filter(Boolean);
    return keys.join(", ");
}

function spawnEnemyFromConsole(name) {
    const raw = String(name || "").trim();
    if (!raw) {
        appendConsoleLog(`Uso: spawn enemigo. Disponibles: ${getSpawnableEnemyListText()}`);
        return;
    }
    const normalized = normalizeSpawnName(raw);
    const entry = getConsoleSpawnDefinitions().find(item => {
        const keys = [item.key, ...(item.aliases || [])].map(normalizeSpawnName);
        return keys.includes(normalized);
    });
    if (!entry) {
        appendConsoleLog(`No encontré "${raw}". Disponibles: ${getSpawnableEnemyListText()}`);
        return;
    }
    disqualifyRunFromLeaderboard("spawn");
    let spawned = null;
    const spawnPoint = getRandomSpawnPoint();
    if (entry.visitor || entry.key === "visitor" || normalized === "visitante") {
        spawned = spawnVisitor({ force: true, spawnPoint });
    } else if (entry.bossType) {
        spawned = createBossFromType(entry.bossType);
        spawned.x = spawnPoint.x; spawned.y = spawnPoint.y;
        enemies.push(spawned);
    } else if (entry.type) {
        const options = entry.type.special === "doombringer" ? { spawnPoint: getBossSpawnPoint() } : { spawnPoint };
        spawned = createEnemyFromType(entry.type, options);
        enemies.push(spawned);
    }
    if (spawned) {
        appendConsoleLog(`Spawn: ${spawned.name || raw}. Esta run no entra al leaderboard normal.`);
        showCenterMessage(`Spawn: ${spawned.name || raw}`, 900, "minor");
        updateHud(true);
        autoSaveRun(true);
    }
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
        if (beginnerCommandUsed) {
            appendConsoleLog("Beginner ya fue activado en esta run. No se puede usar dos veces.");
            showCenterMessage("BEGINNER YA USADO", 900);
            return;
        }
        beginnerCommandUsed = true;
        coins = Math.min(Number.MAX_SAFE_INTEGER, coins + 1000);
        appendConsoleLog(`Comando beginner activado: +${formatMoney(1000)} monedas. Esta run quedará marcada como beginner en el leaderboard.`);
        showCenterMessage("BEGINNER +1K", 900);
        updateHud();
        autoSaveRun(true);
        return;
    }

    if (command === "spawn" || command.startsWith("spawn ")) {
        const name = command.replace(/^spawn\s*/, "").trim();
        spawnEnemyFromConsole(name);
        return;
    }

    if (command === "spawns" || command === "spawnlist" || command === "spawn list") {
        appendConsoleLog(`Spawneables: ${getSpawnableEnemyListText()}`);
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

    if (command === "endwave") {
        if (buildPhaseActive) {
            appendConsoleLog("Ya estás en descanso entre oleadas.");
            showCenterMessage("DESCANSO ACTIVO", 800);
            return;
        }

        if (!waveInProgress) {
            appendConsoleLog("No hay una oleada activa para terminar.");
            return;
        }

        disqualifyRunFromLeaderboard("endwave");
        enemiesSpawned = enemiesToSpawn;
        enemies = [];
        projectiles = [];
        bossProjectiles = [];
        slowZones = [];
        poisonZones = [];
        fireZones = [];
        effects = [];
        damageTexts = [];
        appendConsoleLog("Comando endwave activado: oleada completada y descanso de 1m30s iniciado. Esta run no entra al leaderboard normal.");
        showCenterMessage("END WAVE", 800);
        completeWave();
        updateHud(true);
        return;
    }

    if (command === "waveskip" || command.startsWith("waveskip ")) {
        const parts = command.split(/\s+/);
        const targetWave = parts[1] ? Math.max(1, Math.floor(Number(parts[1]))) : wave + 1;

        if (!Number.isFinite(targetWave)) {
            appendConsoleLog("Uso correcto: waveskip o waveskip 25");
            return;
        }

        disqualifyRunFromLeaderboard("waveskip");
        jumpToWave(targetWave);
        appendConsoleLog(`Comando activado: saltaste a la oleada ${wave}. Esta run no entra al leaderboard normal.`);
        return;
    }

    if (command === "killall") {
        disqualifyRunFromLeaderboard("killall");
        const killed = killAllEnemiesFromConsole();
        appendConsoleLog(`Comando activado: ${killed} enemigos eliminados. Esta run no entra al leaderboard normal.`);
        showCenterMessage("KILL ALL", 800);
        updateHud();
        return;
    }

    if (command === "reset") {
        disqualifyRunFromLeaderboard("reset");
        resetRunFromConsole();
        appendConsoleLog("Run reiniciada desde 0. Esta run no entra al leaderboard normal.");
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
    return Boolean(pendingBarricadePlacement || pendingTrapPlacement || pendingMinePlacement || pendingTowerPurchase || pendingTowerMoveIndex !== null);
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

function toggleStructureSelection(type, entity) {
    if (!entity) { clearStructureSelection(); return; }

    const id = String(entity.id);
    if (selectedStructureType !== type) {
        selectedStructureType = type;
        selectedStructureIds = [id];
        updateStructurePanel();
        return;
    }

    if (selectedStructureIds.includes(id)) {
        selectedStructureIds = selectedStructureIds.filter(selectedId => selectedId !== id);
    } else {
        selectedStructureIds.push(id);
    }

    if (!selectedStructureIds.length) {
        selectedStructureType = null;
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
        if (circleIntersectsBarricade(x, y, 6, b, 0)) return b;
    }
    return null;
}

function handleStructureClickSelection(event) {
    // Durante una oleada no se pueden seleccionar ni tocar estructuras: evita paneles,
    // toggles de puertas y clicks accidentales que traban la pelea.
    if (!buildPhaseActive || waveInProgress) return false;

    const multiSame = event.ctrlKey || event.metaKey;
    const addSingle = event.shiftKey;

    const tower = findTowerAtWorldPoint(mousePosition.x, mousePosition.y);
    if (tower) {
        if (addSingle) {
            toggleStructureSelection("tower", tower);
            showCenterMessage(isStructureSelected("tower", tower.id) ? `Agregada ${tower.name}` : `Quitada ${tower.name}`, 650);
        } else {
            selectStructure("tower", tower, multiSame);
            showCenterMessage(multiSame ? `Seleccionadas torres ${tower.name}` : `${tower.name} seleccionada`, 650);
        }
        return true;
    }
    const b = findBarricadeAtWorldPoint(mousePosition.x, mousePosition.y);
    if (b) {
        ensureBarricadeEconomy(b);
        if (b.kind === "door" && !multiSame && !addSingle) {
            b.isOpen = !b.isOpen;
            showCenterMessage(b.isOpen ? "Puerta abierta" : "Puerta cerrada", 650);
        }
        if (addSingle) {
            toggleStructureSelection("barricade", b);
            showCenterMessage(isStructureSelected("barricade", b.id) ? `Agregada ${getBarricadeKindLabel(b.kind)}` : `Quitada ${getBarricadeKindLabel(b.kind)}`, 650);
        } else {
            selectStructure("barricade", b, multiSame);
            showCenterMessage(multiSame ? `Seleccionadas barricadas ${getBarricadeKindLabel(b.kind)}` : `${getBarricadeKindLabel(b.kind)} seleccionada`, 650);
        }
        return true;
    }
    return false;
}

function getTowerUpgradePreview(tower) {
    if (!tower) return "";
    ensureTowerEconomy(tower);
    const hp = `HP ${Math.ceil(tower.hp || 0)}/${Math.ceil(tower.maxHp || 0)}`;
    if (tower.type === "buffer") return `Nivel ${tower.level || 1} · ${hp} · buff ${Math.round((tower.buffDamage || 0) * 100)}% daño / ${Math.round((tower.buffSpeed || 0) * 100)}% vel.`;
    if (tower.type === "blade") return `Nivel ${tower.level || 1} · ${hp} · daño/tick ${formatCompactNumber(tower.damage || 0, 2)} · área ${Math.round(tower.range || 0)} · tick ${Math.round(tower.fireDelay || 0)}ms`;
    if (tower.type === "spear") return `Nivel ${tower.level || 1} · ${hp} · mira ${getRotationLabel(tower.rotation || 0)} · daño ${formatCompactNumber(tower.damage || 0, 2)} · alcance ${Math.round(tower.range || 0)}`;
    if (tower.type === "laser") return `Nivel ${tower.level || 1} · ${hp} · DPS ${formatCompactNumber(tower.damage || 0, 2)} · alcance ${Math.round(tower.range || 0)} · objetivo único`;
    return `Nivel ${tower.level || 1} · ${hp} · daño ${formatCompactNumber(tower.damage || 0, 2)} · rango ${Math.round(tower.range || 0)} · delay ${Math.round(tower.fireDelay || 0)}ms`;
}

function getBarricadeInfoText(b) {
    ensureBarricadeEconomy(b);
    const hp = `${Math.ceil(b.hp || 0)}/${Math.ceil(b.maxHp || 0)}`;
    const level = b.kind === "standard" ? `Tier ${Math.max(0, (b.tier || 0) + 1)} · +${b.level || 0}` : `Nivel ${Math.max(1, (b.level || 0) + 1)}`;
    return `${getBarricadeKindLabel(b.kind)}${b.kind === "door" ? (b.isOpen ? " abierta" : " cerrada") : ""} · ${level} · HP ${hp}`;
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
        const damaged = selected.filter(t => t.hp < t.maxHp);
        const repairTotal = damaged.reduce((sum, t) => sum + getTowerRepairCost(t), 0);
        structurePanelTitle.textContent = multiple ? `${selected.length} torretas ${first.name}` : first.name;
        structurePanelInfo.innerHTML = `${multiple ? "Selección múltiple" : getTowerUpgradePreview(first)}<br><small>Ctrl+click selecciona todas las torres iguales · Shift+click agrega/quita una.</small>`;
        structurePanelActions.innerHTML = `
            <button type="button" data-structure-action="upgrade" ${coins < upgradeTotal ? "disabled" : ""}>Mejorar ${multiple ? "todas" : ""} (${formatMoney(upgradeTotal)})</button>
            <button type="button" data-structure-action="repair" ${damaged.length === 0 || coins < repairTotal ? "disabled" : ""}>Reparar ${multiple ? "dañadas" : ""} (${formatMoney(repairTotal)})</button>
            ${!multiple ? `<button type="button" data-structure-action="move">Mover</button>` : ""}
            <button type="button" data-structure-action="rotate">Rotar ${multiple ? "todas" : ""}</button>
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
    structurePanelInfo.innerHTML = `${multiple ? "Selección múltiple" : getBarricadeInfoText(first)}<br><small>Ctrl+click selecciona todas las barricadas iguales · Shift+click agrega/quita una.</small>`;
    structurePanelActions.innerHTML = `
        <button type="button" data-structure-action="upgrade" ${coins < upgradeTotal ? "disabled" : ""}>Mejorar ${multiple ? "todas" : ""} (${formatMoney(upgradeTotal)})</button>
        <button type="button" data-structure-action="repair" ${damaged.length === 0 || coins < repairTotal ? "disabled" : ""}>Reparar ${multiple ? "dañadas" : ""} (${formatMoney(repairTotal)})</button>
        <button type="button" data-structure-action="sell" class="dangerMiniButton">Vender ${multiple ? "todas" : ""} (${formatMoney(sellTotal)})</button>
    `;
}

function getTowerRepairCost(tower) {
    ensureTowerEconomy(tower);
    if (!tower || tower.hp >= tower.maxHp) return 0;
    const missingRatio = Math.max(0, Math.min(1, (tower.maxHp - tower.hp) / Math.max(1, tower.maxHp)));
    return Math.max(1, Math.ceil((Number(tower.cost) || 80) * TOWER_REPAIR_COST_FACTOR * missingRatio));
}

function repairTowerSelected() {
    const selected = getSelectedStructures().filter(t => selectedStructureType === "tower" && t.hp < t.maxHp);
    if (!selected.length) return;
    const total = selected.reduce((sum, t) => sum + getTowerRepairCost(t), 0);
    if (coins < total) { showCenterMessage(`Faltan ${formatMissingMoney(total - coins)} monedas`, 850); updateStructurePanel(); return; }
    coins -= total;
    selected.forEach(t => {
        const repairCost = getTowerRepairCost(t);
        t.spent = (Number(t.spent) || 0) + repairCost;
        t.hp = t.maxHp;
    });
    showCenterMessage(selected.length > 1 ? `${selected.length} torretas reparadas` : "Torre reparada", 800);
    updateHud(true); updateStructurePanel(); autoSaveRun(true);
}

function getBarricadeRepairCost(b) {
    if (!b || b.hp >= b.maxHp) return 0;
    ensureBarricadeEconomy(b);
    const missingRatio = Math.max(0, Math.min(1, (b.maxHp - b.hp) / Math.max(1, b.maxHp)));
    const tier = Math.max(0, Number(b.tier) || 0);
    const level = Math.max(0, Number(b.level) || 0);
    // Reparar una muralla más avanzada debe doler más: evita que obsidiana + reparación infinita sea una pared gratis.
    const upgradePressure = b.kind === "standard" ? tier * 0.22 + level * 0.18 : 0.18 + level * 0.24;
    const repairMultiplier = 1 + Math.min(2.35, upgradePressure);
    return Math.max(1, Math.ceil((Number(b.buildCost) || getBarricadeBaseCost(b.kind)) * 0.42 * missingRatio * repairMultiplier));
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
        b.upgradeCost = Math.max(
            scaleBarricadeCost(paid || getBarricadeBaseCost(b.kind), getBarricadeUpgradeMultiplier(b.kind || "standard")),
            getMinimumBarricadeUpgradeCost(b)
        );
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
    if (!buildPhaseActive || waveInProgress) {
        clearStructureSelection();
        showCenterMessage("Solo podés editar estructuras en descanso", 900);
        return;
    }
    if (action === "upgrade") {
        if (selectedStructureType === "tower") upgradeTowerSelected();
        else upgradeBarricadeSelected();
    }
    if (action === "repair") {
        if (selectedStructureType === "tower") repairTowerSelected();
        else repairBarricadeSelected();
    }
    if (action === "sell") {
        if (selectedStructureType === "tower") sellTowerSelected();
        else sellBarricadeSelected();
    }
    if (action === "move") {
        const selected = getSelectedStructures();
        if (selectedStructureType === "tower" && selected.length === 1) beginTowerMove(towers.indexOf(selected[0]));
    }
    if (action === "rotate") {
        const selected = getSelectedStructures();
        if (selectedStructureType === "tower" && selected.length) {
            selected.forEach(rotateTowerObject);
            showCenterMessage(selected.length > 1 ? `${selected.length} torres rotadas` : `Torre hacia ${getRotationLabel(selected[0].rotation || 0)}`, 700);
            updateHud(true); updateStructurePanel(); autoSaveRun(true);
        }
    }
}

function getCurrentBuildModeLabel() {
    if (pendingBarricadePlacement) return "Colocando barricadas · R rota";
    if (pendingTrapPlacement) return "Colocando trampas";
    if (pendingMinePlacement) return "Colocando minas";
    if (pendingTowerPurchase) {
        const def = getTowerDefinition(pendingTowerPurchase.defKey);
        return `Colocando ${def ? def.name : "torre"} · R rota`;
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

function getCanvasLogicalPoint(event) {
    const rect = canvas.getBoundingClientRect();
    const scaleX = GAME_WIDTH / Math.max(1, rect.width);
    const scaleY = GAME_HEIGHT / Math.max(1, rect.height);
    return {
        x: (event.clientX - rect.left) * scaleX,
        y: (event.clientY - rect.top) * scaleY
    };
}

function updateMousePosition(event) {
    const point = getCanvasLogicalPoint(event);
    const zoom = getCameraZoom();
    mousePosition.x = camera.x + point.x / zoom;
    mousePosition.y = camera.y + point.y / zoom;
}

canvas.addEventListener("mousemove", event => {
    updateMousePosition(event);
});

canvas.addEventListener("wheel", event => {
    if (!gameStarted) return;
    event.preventDefault();
    const point = getCanvasLogicalPoint(event);
    const direction = event.deltaY > 0 ? -1 : 1;
    const factor = 1 + CAMERA_ZOOM_STEP * direction;
    setCameraZoom(getCameraZoom() * factor, point.x, point.y);
    updateMousePosition(event);
    showCenterMessage(`Zoom ${Math.round(getCameraZoom() * 100)}%`, 450);
}, { passive: false });

function handleCanvasPlacementPointer(event) {
    event.preventDefault();
    canvas.blur();
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

    if (pendingTrapPlacement) {
        event.preventDefault();
        if (event.button === 2) {
            cancelTrapPlacement(false);
            return;
        }
        finishTrapPlacement();
        return;
    }

    if (pendingMinePlacement) {
        event.preventDefault();
        if (event.button === 2) {
            cancelMinePlacement(false);
            return;
        }
        finishMinePlacement();
        return;
    }

    if (pendingBarricadePlacement || pendingTrapPlacement || pendingMinePlacement || pendingTowerPurchase || pendingTowerMoveIndex !== null) {
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
    if (pendingBarricadePlacement || pendingTrapPlacement || pendingMinePlacement || pendingTowerPurchase || pendingTowerMoveIndex !== null) {
        event.preventDefault();
        cancelBarricadePlacement(false);
        cancelTrapPlacement(false);
        cancelMinePlacement(false);
        cancelTowerPlacement(false);
        cancelTowerMove(false);
    }
});

window.addEventListener("mouseup", () => {
    isMouseDown = false;
});

canvas.addEventListener("mouseleave", () => {
    isMouseDown = false;
});


function handleShopTabHotkeys(event) {
    if (!shop || shop.classList.contains("hidden")) return false;

    const isConstruction = shop.classList.contains("constructionMode");
    const shopMap = {
        Digit1: "stats",
        Digit2: "consumables",
        Digit3: "abilities",
        Digit4: "abilities"
    };
    const constructionMap = {
        Digit1: "barricades",
        Digit2: "towers",
        Digit3: "traps",
        Digit4: "mines"
    };

    if (event.code === "KeyX") {
        closeShop();
        showCenterMessage("Panel cerrado", 500);
        autoSaveRun(true);
        return true;
    }

    const sectionId = (isConstruction ? constructionMap : shopMap)[event.code];
    if (!sectionId) return false;

    setShopSection(sectionId);
    return true;
}

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

    if (!event.ctrlKey && handleShopTabHotkeys(event)) {
        event.preventDefault();
        return;
    }

    if (event.code === "ShiftLeft" || event.code === "ShiftRight") isShiftDown = true;

    if (event.code === "Escape") {
        event.preventDefault();

        // Evita que mantener Escape apretado dispare pausa/reanudar varias veces.
        // Ese repeat era la causa de que la música a veces quedara pausada y a veces no.
        if (event.repeat) {
            syncMusicState();
            return;
        }

        if (pendingBarricadePlacement) {
            cancelBarricadePlacement(false);
            return;
        }

        if (pendingTrapPlacement) {
            cancelTrapPlacement(false);
            return;
        }

        if (pendingMinePlacement) {
            cancelMinePlacement(false);
            return;
        }

        if (pendingTowerPurchase || pendingTowerMoveIndex !== null) {
            cancelTowerPlacement(false);
            cancelTowerMove(false);
            return;
        }

        if (shop && !shop.classList.contains("hidden")) {
            closeShop();
            return;
        }

        if (selectedStructureIds && selectedStructureIds.length) {
            clearStructureSelection();
            return;
        }

        if (buildPhaseActive) {
            if (isPaused || isElementVisible(pausePanel)) {
                resumeGame();
            } else {
                pauseGame();
            }
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

    if (event.ctrlKey && /^Digit[1-5]$/.test(event.code)) {
        event.preventDefault();
        const slotIndex = Number(event.code.replace("Digit", "")) - 1;
        useInventorySlot(slotIndex);
        return;
    }

    if (event.code === "KeyC" && !event.repeat) {
        event.preventDefault();
        toggleConstruction("towers");
        syncMusicState();
        autoSaveRun(true);
        return;
    }

    if (event.code === "KeyT" && !event.repeat) {
        event.preventDefault();
        toggleShop("stats");
        syncMusicState();
        autoSaveRun(true);
        return;
    }

    if (event.code === "KeyR" && !event.repeat && (pendingBarricadePlacement || pendingTowerPurchase || pendingTowerMoveIndex !== null)) {
        event.preventDefault();
        if (pendingBarricadePlacement) {
            const nextOrientation = rotateBarricadeBuildOrientation();
            showCenterMessage(`Barricada ${getBarricadeOrientationLabel(nextOrientation)}`, 550);
        } else if (pendingTowerMoveIndex !== null) {
            rotateTowerObject(towers[pendingTowerMoveIndex]);
            showCenterMessage(`Torre hacia ${getRotationLabel(towers[pendingTowerMoveIndex]?.rotation || 0)}`, 550);
        } else {
            towerBuildRotation = (towerBuildRotation + TOWER_ROTATION_STEP) % (Math.PI * 2);
            showCenterMessage(`Torre hacia ${getRotationLabel(towerBuildRotation)}`, 550);
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
    syncMusicState();
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

if (classCardsBox) {
    renderClassSelection();
    classCardsBox.addEventListener("click", event => {
        const card = event.target.closest(".classCard");
        if (card) chooseClass(card.dataset.classKey);
    });
}
if (relicChoiceOptions) {
    relicChoiceOptions.addEventListener("click", event => {
        const btn = event.target.closest("[data-relic-index]");
        if (btn) chooseRelic(Number(btn.dataset.relicIndex));
    });
}


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
    cancelTrapPlacement(false);
    cancelMinePlacement(false);
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
    cancelTrapPlacement(false);
    cancelMinePlacement(false);
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
    syncMusicState();
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

if (skipBuildPhaseBtn) skipBuildPhaseBtn.addEventListener("click", () => {
    skipBuildPhase();
});

if (cancelBuildBtn) cancelBuildBtn.addEventListener("click", () => {
    cancelBarricadePlacement(false);
    cancelTrapPlacement(false);
    cancelMinePlacement(false);
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
let lastStructurePanelPointerActionAt = 0;
function handleStructurePanelActionEvent(event) {
    const button = event.target.closest("button[data-structure-action]");
    if (!button || button.disabled) return;
    event.preventDefault();
    lastStructurePanelPointerActionAt = performance.now();
    handleStructurePanelAction(button.dataset.structureAction);
}
if (structurePanelActions) structurePanelActions.addEventListener("pointerdown", handleStructurePanelActionEvent);
if (structurePanelActions) structurePanelActions.addEventListener("click", event => {
    if (performance.now() - lastStructurePanelPointerActionAt < 350) { event.preventDefault(); return; }
    handleStructurePanelActionEvent(event);
});

newRunBtn.addEventListener("click", () => {
    clearSavedRun();
    stopMusicAndReset();
    hasActiveRun = false;
    gameStarted = false;
    gameRunning = false;
    waveInProgress = false;
    isPaused = false;
    isInMainMenu = true;
    gameOverScreen.classList.add("hidden");
    gameArea.classList.add("hidden");
    menu.classList.remove("hidden");
    renderClassSelection();
    updateStartButtonSavedState();
});

upgradeDamageBtn.addEventListener("click", () => {
    if (spendCoins(costs.damage, "damage")) {
        player.damage += 1 * (player?.statPowerMultiplier || 1);
        costs.damage = scaleStatCost(costs.damage, 1.75);
        updateHud();
    }
});

upgradeFireRateBtn.addEventListener("click", () => {
    if (spendCoins(costs.fireRate, "fireRate")) {
        player.fireDelay = Math.max(160, player.fireDelay - 40 * (player?.statPowerMultiplier || 1));
        costs.fireRate = scaleStatCost(costs.fireRate, 1.8);
        updateHud();
    }
});

upgradeMaxHpBtn.addEventListener("click", () => {
    if (spendCoins(costs.maxHp, "maxHp")) {
        const gainHp = 5 * (player?.statPowerMultiplier || 1);
        player.maxHp += gainHp;
        player.hp += gainHp;
        costs.maxHp = scaleStatCost(costs.maxHp, 1.7);
        updateHud();
    }
});

upgradeCritBtn.addEventListener("click", () => {
    if (spendCoins(costs.crit, "crit")) {
        player.critChance = Math.min(0.6, player.critChance + 0.05 * (player?.statPowerMultiplier || 1));
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
buyDoorBarricadeBtn?.addEventListener("click", () => buyOrUpgradeBarricade("door"));

function getBarricadeUpgradeTarget(kind) {
    const activeBarricades = (barricades || []).filter(b => b.active && b.hp > 0 && b.kind === kind);
    const weakest = activeBarricades.sort((a, b) => (a.level || 0) - (b.level || 0) || a.maxHp - b.maxHp)[0];
    return weakest ? { target: weakest, isNew: false } : null;
}

function beginBarricadePlacement(kind = "standard", costKey = "upgradeBarricade") {
    if (!canStartBuildPlacement("construir barricadas")) return;
    // Las barricadas se pueden construir desde la primera fase de construcción.
    // Antes estaba bloqueado hasta wave 3 y por eso parecía que el botón no funcionaba
    // en las primeras oleadas. Mantenemos solo la condición de estar en descanso/build phase.

    // Importante: las barricadas son una construcción independiente de las torres.
    // Aunque tengas los 12/12 slots de torre ocupados, podés entrar a modo barricada.
    pendingTowerPurchase = null;
    pendingTowerMoveIndex = null;
    pendingTrapPlacement = null;
    pendingMinePlacement = null;

    if (pendingBarricadePlacement) return;
    const hasFreeStarter = (kind === "standard" && getFreeBarricadeCount() > 0) || getFreeAnyConstructionCount() > 0;
    const price = hasFreeStarter ? 0 : getBarricadeBaseCost(kind);
    if (coins < price) {
        showCenterMessage(`Faltan ${formatMissingMoney(price - coins)} monedas`, 800);
        return;
    }
    clearStructureSelection();
    pendingBarricadePlacement = { kind, costKey, price, freeStarter: hasFreeStarter };
    pendingTowerPurchase = null;
    pendingTrapPlacement = null;
    pendingMinePlacement = null;
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
    const hasFreeStarter = (kind === "standard" && getFreeBarricadeCount() > 0) || getFreeAnyConstructionCount() > 0;
    const price = hasFreeStarter ? 0 : getBarricadeBaseCost(kind);
    if (coins < price) {
        showCenterMessage("Monedas insuficientes", 800, "minor");
        cancelBarricadePlacement(false);
        return;
    }
    if (hasFreeStarter) consumeFreeConstructionCharge("barricade", kind);
    else coins -= price;
    const placedOrientation = normalizeBarricadeBuildOrientation();
    const b = createFreeBarricade(kind, point.x, point.y, placedOrientation);
    upgradeBarricadeInstance(b, kind, true);
    b.x = point.x;
    b.y = point.y;
    b.orientation = placedOrientation;
    b.isBuildBarricade = true;
    barricades.push(b);
    // Comprar barricadas nuevas mantiene precio fijo.
    // El precio que escala ahora es el de mejora de cada barricada individual.
    const nextHasFreeStarter = (kind === "standard" && getFreeBarricadeCount() > 0) || getFreeAnyConstructionCount() > 0;
    const nextPrice = nextHasFreeStarter ? 0 : getBarricadeBaseCost(kind);
    if (coins < nextPrice) {
        pendingBarricadePlacement = null;
        showCenterMessage("Barricada colocada · sin monedas para otra", 900);
    } else {
        pendingBarricadePlacement = { kind, costKey, price: nextPrice, freeStarter: nextHasFreeStarter };
        showCenterMessage(nextHasFreeStarter ? "Barricada gratis colocada · seguí usando tus cargas" : "Barricada colocada · seguí construyendo o cancelá", 900);
    }

    updateBuildCancelUI();
    updateHud(true);
    autoSaveRun(true);
}

function buyOrUpgradeBarricade(kind = "standard") {
    const costKey = kind === "door" ? "doorBarricade" : kind === "regen" ? "regenBarricade" : kind === "explosive" ? "explosiveBarricade" : kind === "thorns" ? "thornsBarricade" : "upgradeBarricade";
    beginBarricadePlacement(kind, costKey);
}



function getMaxStandardBarricadeTierIndex() {
    const lastIndex = barricadeTiers.length - 1;
    const aetheriteIndex = barricadeTiers.findIndex(t => t && t.architectOnly);
    if (aetheriteIndex < 0) return lastIndex;
    return player?.unlockDeepObsidian ? lastIndex : Math.max(0, aetheriteIndex - 1);
}

function isAetheriteBarricade(b) {
    const tier = barricadeTiers[Math.max(0, b?.tier || 0)];
    return Boolean(tier && tier.architectOnly);
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
        const maxTierIndex = getMaxStandardBarricadeTierIndex();
        if (target.tier < maxTierIndex) {
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
    const baseHp = kind === "door" ? 17 : kind === "regen" ? 42 : kind === "explosive" ? 48 : kind === "thorns" ? 40 : 58;
    const tierHp = kind === "standard" ? Math.max(0, target.tier) * 28 : 0;
    const levelHp = level * (kind === "door" ? 9 : kind === "standard" ? 30 : kind === "regen" ? 21 : kind === "explosive" ? 24 : 20);

    target.color = kind === "door" ? "#6a4a2a" : kind === "regen" ? "#8a5cff" : kind === "explosive" ? "#d9792b" : kind === "thorns" ? "#9c6b35" : tier.color;
    target.maxHp = baseHp + tierHp + levelHp;
    target.hp = target.maxHp;
    target.regenPerSecond = kind === "regen" ? 0.9 + level * 0.22 : 0;
    target.explosive = kind === "explosive";
    target.thorns = kind === "thorns";
    target.isDoor = kind === "door";
    target.isOpen = kind === "door" ? Boolean(target.isOpen) : false;
    target.lastRegenTime = getGameTime();

    const kindLabel = kind === "door" ? "puerta" : kind === "regen" ? "regenerativa" : kind === "explosive" ? "explosiva" : kind === "thorns" ? "con espinas" : "estándar";
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
buyTrapSnareBtn?.addEventListener("click", () => beginTrapPlacement("snare"));
buyTrapBleedBtn?.addEventListener("click", () => beginTrapPlacement("bleed"));
buyMineGoldBtn?.addEventListener("click", () => beginMinePlacement());

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


function beginTrapPlacement(typeKey) {
    if (!canStartBuildPlacement("colocar trampas")) return;
    const def = trapDefinitions[typeKey];
    if (!def) return;
    const hasFreeStarter = getFreeAnyConstructionCount() > 0;
    const price = hasFreeStarter ? 0 : getEffectiveCost(costs[def.key] ?? def.cost, "traps");
    if (coins < price) {
        showCenterMessage(`Faltan ${formatMissingMoney(price - coins)} monedas`, 850);
        return;
    }
    clearStructureSelection();
    pendingTrapPlacement = { typeKey, price, freeStarter: hasFreeStarter };
    pendingTowerPurchase = null;
    pendingBarricadePlacement = null;
    pendingMinePlacement = null;
    closeShop();
    showCenterMessage(`Colocá ${def.name} · seguí colocando o cancelá`, 1000);
    updateBuildCancelUI();
    updateHud(true);
}

function cancelTrapPlacement(showShopAgain = false) {
    if (!pendingTrapPlacement) return;
    pendingTrapPlacement = null;
    updateBuildCancelUI();
    if (showShopAgain && hasActiveRun) openConstruction("traps");
    updateHud(true);
}

function finishTrapPlacement() {
    if (!pendingTrapPlacement) return;
    const def = trapDefinitions[pendingTrapPlacement.typeKey];
    if (!def) { cancelTrapPlacement(false); return; }
    const point = getSnappedBuildPoint();
    if (!isTrapPositionValid(point.x, point.y)) {
        showCenterMessage("No se puede poner la trampa ahí", 750);
        return;
    }
    const hasFreeStarter = getFreeAnyConstructionCount() > 0;
    const price = hasFreeStarter ? 0 : getEffectiveCost(costs[def.key] ?? def.cost, "traps");
    if (coins < price) {
        showCenterMessage("Monedas insuficientes", 800, "minor");
        cancelTrapPlacement(false);
        return;
    }
    if (hasFreeStarter) consumeFreeConstructionCharge("trap");
    else coins -= price;
    traps.push(createTrap(pendingTrapPlacement.typeKey, point.x, point.y));
    if (coins < price) {
        pendingTrapPlacement = null;
        showCenterMessage("Trampa colocada · sin monedas para otra", 850);
    } else {
        pendingTrapPlacement = { typeKey: def.key === "trapSnare" ? "snare" : "bleed", price: getFreeAnyConstructionCount() > 0 ? 0 : price, freeStarter: getFreeAnyConstructionCount() > 0 };
        showCenterMessage("Trampa colocada · seguí colocando o cancelá", 850);
    }
    updateBuildCancelUI();
    updateHud(true);
    autoSaveRun(true);
}

function createMine(x, y, paidCost = getMineCostForCount()) {
    return {
        id: Date.now() + Math.random(),
        type: "gold",
        name: mineDefinitions.gold.name,
        x,
        y,
        radius: MINE_COLLISION_RADIUS,
        color: mineDefinitions.gold.color,
        maxHp: MINE_MAX_HP,
        hp: MINE_MAX_HP,
        cost: paidCost,
        totalGold: 0,
        lastIncome: 0,
        pulseUntil: 0
    };
}

function beginMinePlacement() {
    if (!canStartBuildPlacement("colocar minas")) return;
    if ((mines || []).length >= MINE_LIMIT) {
        showCenterMessage(`Máximo de minas alcanzado (${MINE_LIMIT})`, 900);
        return;
    }
    const hasFreeStarter = hasFreeMinePurchase();
    const price = hasFreeStarter ? 0 : getEffectiveCost(costs.mineGold ?? getMineCostForCount(), "mines");
    if (coins < price) {
        showCenterMessage(`Faltan ${formatMissingMoney(price - coins)} monedas`, 850);
        return;
    }
    clearStructureSelection();
    pendingMinePlacement = { price, freeStarter: hasFreeStarter };
    pendingTowerPurchase = null;
    pendingTrapPlacement = null;
    pendingBarricadePlacement = null;
    closeShop();
    showCenterMessage(`Colocá una mina · genera oro al terminar cada oleada`, 1200);
    updateBuildCancelUI();
    updateHud(true);
}

function cancelMinePlacement(showShopAgain = false) {
    if (!pendingMinePlacement) return;
    pendingMinePlacement = null;
    updateBuildCancelUI();
    if (showShopAgain && hasActiveRun) openConstruction("mines");
    updateHud(true);
}

function finishMinePlacement() {
    if (!pendingMinePlacement) return;
    const point = getSnappedBuildPoint();
    if (!isMinePositionValid(point.x, point.y)) {
        showCenterMessage("No se puede poner la mina ahí", 750);
        return;
    }
    const hasFreeStarter = hasFreeMinePurchase();
    const price = hasFreeStarter ? 0 : getEffectiveCost(costs.mineGold ?? getMineCostForCount(), "mines");
    if (coins < price) {
        showCenterMessage("Monedas insuficientes", 800, "minor");
        cancelMinePlacement(false);
        return;
    }
    if (hasFreeStarter) consumeFreeConstructionCharge("mine");
    else coins -= price;
    mines.push(createMine(point.x, point.y, price));
    costs.mineGold = getMineCostForCount(mines.length);

    if (mines.length >= MINE_LIMIT) {
        pendingMinePlacement = null;
        showCenterMessage("Mina colocada · límite alcanzado", 850);
    } else {
        const nextFreeMine = hasFreeMinePurchase();
        const nextMinePrice = nextFreeMine ? 0 : getEffectiveCost(costs.mineGold, "mines");
        if (coins < nextMinePrice) {
            pendingMinePlacement = null;
            showCenterMessage("Mina colocada · sin monedas para otra", 850);
        } else {
            pendingMinePlacement = { price: nextMinePrice, freeStarter: nextFreeMine };
            showCenterMessage(nextFreeMine ? "Mina gratis colocada · seguí usando tus cargas" : "Mina colocada · seguí colocando o cancelá", 850);
        }
    }
    updateBuildCancelUI();
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
    ensureTowerEconomy(tower);
    const oldMaxHp = Number(tower.maxHp) || getTowerBaseMaxHp(tower);
    tower.level = (Number(tower.level) || 1) + 1;

    if (tower.type === "basic") {
        tower.damage += 0.65;
        tower.range += 10;
        tower.fireDelay = Math.max(300, tower.fireDelay - 50);
    }

    if (tower.type === "rapid") {
        tower.damage += 0.18;
        tower.range += 6;
        tower.fireDelay = Math.max(175, tower.fireDelay - 18);
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

    if (tower.type === "blade") {
        tower.damage += 0.22;
        tower.range += 5;
        tower.fireDelay = Math.max(360, tower.fireDelay - 35);
    }

    if (tower.type === "spear") {
        tower.damage += 0.58;
        // La lancera ahora cumple rol de control de línea a larga distancia:
        // pega bastante más lento, pero conserva el alcance duplicado también al escalar.
        tower.range += 18;
        tower.laneWidth = (tower.laneWidth || 38) + 1.5;
        tower.fireDelay = Math.max(1050, tower.fireDelay - 30);
    }

    if (tower.type === "laser") {
        tower.damage += 4.5;
        tower.range += 14;
        tower.beamWidth = Math.min(9, (tower.beamWidth || 5) + 0.35);
        tower.fireDelay = Math.max(80, tower.fireDelay - 4);
    }

    if (tower.type === "buffer") {
        tower.range += 18;
        tower.buffDamage += 0.025;
        tower.buffSpeed += 0.018;
    }

    const hpGain = tower.type === "blade" ? 8 : tower.type === "spear" ? 7 : tower.type === "laser" ? 8 : tower.type === "ballista" ? 7 : 5;
    tower.maxHp = Math.max(oldMaxHp + hpGain, Number(tower.maxHp) || 0);
    tower.hp = Math.min(tower.maxHp, (Number(tower.hp) || oldMaxHp) + hpGain);

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
if (buyBlinkBtn) buyBlinkBtn.addEventListener("click", () => buyAbility("blink"));

function pauseGame() {
    if (!gameStarted || !hasActiveRun) return;
    if (!waveInProgress && !buildPhaseActive) return;
    if (isPaused && isElementVisible(pausePanel)) return;

    if (buildPhaseActive) {
        pausedBuildPhaseRemainingMs = getBuildPhaseRemainingMs();
    }

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

    if (buildPhaseActive && pausedBuildPhaseRemainingMs > 0) {
        buildPhaseEndsAt = performance.now() + pausedBuildPhaseRemainingMs;
        pausedBuildPhaseRemainingMs = 0;
    }

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

    autoSaveRun(true);
    updateStartButtonSavedState();
    syncMusicState();
}

function restartRunFromPause() {
    clearSavedRun();
    stopMusicAndReset();

    hasActiveRun = false;
    gameStarted = false;
    gameRunning = false;
    waveInProgress = false;
    isPaused = false;
    isInMainMenu = true;

    pausePanel.classList.add("hidden");
    confirmRestartBox.classList.add("hidden");
    shop.classList.add("hidden");
    waveSummaryPanel.classList.add("hidden");
    gameOverScreen.classList.add("hidden");
    gameArea.classList.add("hidden");
    menu.classList.remove("hidden");

    renderClassSelection();
    updateStartButtonSavedState();
    syncMusicState();
}

function buyAbility(id) {
    const ability = abilities[id];

    if (ability.owned) return;

    if (spendCoins(ability.cost, "abilities")) {
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

[menuMinimapSize, pauseMinimapSize].forEach(input => {
    if (!input) return;
    input.addEventListener("input", () => updateMinimapScale(input.value));
});

repeatWaveBtn.addEventListener("click", () => {
    if (waveInProgress) return;
    if (!buildPhaseActive) {
        showCenterMessage("Solo podés repetir durante el descanso", 900);
        updateHud();
        return;
    }

    const targetWave = getRepeatTargetWave();
    if (!prepareRepeatWave(targetWave, "manual")) {
        showCenterMessage("Límite de repeticiones", 900);
        updateHud();
    }
});

if (autoRepeatWaveBtn) {
    autoRepeatWaveBtn.addEventListener("click", () => {
        const targetWave = getRepeatTargetWave();
        const repeats = getRepeatCountForWave(targetWave);
        if (!autoRepeatWaveMode && repeats >= REPEAT_LIMIT_PER_WAVE) {
            showCenterMessage("Límite de auto-repetición", 900);
            updateAutoRepeatWaveButton();
            return;
        }

        autoRepeatWaveMode = !autoRepeatWaveMode;
        showCenterMessage(autoRepeatWaveMode ? "AUTO REPETIR ON" : "AUTO REPETIR OFF", 750);
        updateAutoRepeatWaveButton();
        autoSaveRun(true);
    });
}


nextWaveBtn.addEventListener("click", () => {
    // Botón legado: fuera de build phase inicia la oleada actual.
    // En build phase se ignora para evitar el bug de saltar una wave doble
    // (completeWave ya dejó wave = completedWave + 1).
    if (waveInProgress || buildPhaseActive) return;
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


if (copyRunSummaryBtn) copyRunSummaryBtn.addEventListener("click", copyLastRunSummary);
