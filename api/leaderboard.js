const LEADERBOARD_KEY = "ardent:leaderboard:v1";
const MAX_ENTRIES = 100;
const TOP_LIMIT = 10;

function getRedisConfig() {
    return {
        url: process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL,
        token: process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN
    };
}

function sanitizeName(name) {
    return String(name || "Jugador")
        .replace(/[<>]/g, "")
        .trim()
        .slice(0, 18) || "Jugador";
}

function sanitizeScore(score) {
    const value = Math.floor(Number(score));
    if (!Number.isFinite(value)) return 0;
    return Math.max(0, Math.min(value, 999999999999));
}

function sanitizeWave(wave) {
    const value = Math.floor(Number(wave));
    if (!Number.isFinite(value)) return 1;
    return Math.max(1, Math.min(value, 999999));
}

async function redisCommand(command, args = []) {
    const { url, token } = getRedisConfig();
    if (!url || !token) {
        const error = new Error("Leaderboard no configurado. Faltan KV_REST_API_URL y KV_REST_API_TOKEN.");
        error.code = "MISSING_KV";
        throw error;
    }

    const encodedArgs = args.map(arg => encodeURIComponent(String(arg))).join("/");
    const endpoint = `${url.replace(/\/$/, "")}/${command}${encodedArgs ? "/" + encodedArgs : ""}`;

    const response = await fetch(endpoint, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` }
    });

    const data = await response.json().catch(() => ({}));

    if (!response.ok || data.error) {
        throw new Error(data.error || `Redis error ${response.status}`);
    }

    return data.result;
}

function parseLeaderboardRows(rows) {
    if (!Array.isArray(rows)) return [];

    const result = [];

    for (let i = 0; i < rows.length; i += 2) {
        const rawMember = rows[i];
        const rawScore = rows[i + 1];

        try {
            const parsed = JSON.parse(rawMember);
            result.push({
                name: sanitizeName(parsed.name),
                score: sanitizeScore(rawScore || parsed.score),
                wave: sanitizeWave(parsed.wave),
                date: parsed.date || null,
                version: parsed.version || ""
            });
        } catch {
            result.push({
                name: sanitizeName(rawMember),
                score: sanitizeScore(rawScore),
                wave: 1,
                date: null,
                version: ""
            });
        }
    }

    return result;
}

async function getTopScores() {
    const rows = await redisCommand("zrevrange", [LEADERBOARD_KEY, 0, TOP_LIMIT - 1, "WITHSCORES"]);
    return parseLeaderboardRows(rows);
}

export default async function handler(req, res) {
    res.setHeader("Cache-Control", "no-store");

    if (req.method === "OPTIONS") {
        return res.status(204).end();
    }

    if (req.method !== "GET" && req.method !== "POST") {
        return res.status(405).json({ message: "Método no permitido." });
    }

    const { url, token } = getRedisConfig();

    if (!url || !token) {
        return res.status(200).json({
            configured: false,
            scores: [],
            message: "Leaderboard no configurado. En Vercel agregá KV_REST_API_URL y KV_REST_API_TOKEN."
        });
    }

    try {
        if (req.method === "POST") {
            const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {});
            const score = sanitizeScore(body.score);

            if (score <= 0) {
                return res.status(400).json({ message: "La puntuación debe ser mayor a 0." });
            }

            const entry = {
                id: `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
                name: sanitizeName(body.name),
                score,
                wave: sanitizeWave(body.wave),
                version: String(body.version || "0.7.5.1").slice(0, 20),
                date: new Date().toISOString()
            };

            await redisCommand("zadd", [LEADERBOARD_KEY, score, JSON.stringify(entry)]);
            await redisCommand("zremrangebyrank", [LEADERBOARD_KEY, 0, -(MAX_ENTRIES + 1)]);
        }

        const scores = await getTopScores();
        return res.status(200).json({ configured: true, scores });
    } catch (error) {
        console.error("Leaderboard API error:", error);
        return res.status(500).json({ message: "Error del leaderboard.", detail: error.message });
    }
}
