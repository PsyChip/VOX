const express = require("express");
const http = require("http");
const cors = require("cors");
const dotenv = require("dotenv");
const readline = require("readline");
const path = require("path");
const Reader = require('@maxmind/geoip2-node').Reader;
const fs = require("fs");
const crypto = require('crypto');
const cookieParser = require('cookie-parser');
const zlib = require('zlib');
const { encoding_for_model } = require('tiktoken');
const UAParser = require('ua-parser-js');
const fsp = require('fs').promises;
dotenv.config();
const mmcity = Reader.openBuffer(fs.readFileSync('./db/GeoLite2-City.mmdb'));
const mmasn = Reader.openBuffer(fs.readFileSync('./db/GeoLite2-ASN.mmdb'));
const currencyMap = JSON.parse(fs.readFileSync('./db/currency.json', 'utf8'));
const apiEndpoints = JSON.parse(fs.readFileSync('./db/api.json', 'utf8'));
const lname = JSON.parse(fs.readFileSync('./db/lang.json', 'utf8'));
var sessions = {};

function sendMaybeCompressedJSON(req, res, payload, statusCode = 200) {
    try {
        const accept = (req.headers['accept-encoding'] || '').toString();
        const json = JSON.stringify(payload);
        const buf = Buffer.from(json, 'utf8');
        res.set('Vary', 'Accept-Encoding');
        res.type('application/json');
        if (accept.includes('br') && typeof zlib.brotliCompress === 'function') {
            return zlib.brotliCompress(buf, {
                params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 4 }
            }, (err, out) => {
                if (err) return res.status(statusCode).send(buf);
                res.set('Content-Encoding', 'br');
                return res.status(statusCode).send(out);
            });
        }
        if (accept.includes('gzip')) {
            return zlib.gzip(buf, { level: zlib.constants.Z_BEST_SPEED }, (err, out) => {
                if (err) return res.status(statusCode).send(buf);
                res.set('Content-Encoding', 'gzip');
                return res.status(statusCode).send(out);
            });
        }
        if (accept.includes('deflate')) {
            return zlib.deflate(buf, (err, out) => {
                if (err) return res.status(statusCode).send(buf);
                res.set('Content-Encoding', 'deflate');
                return res.status(statusCode).send(out);
            });
        }
        return res.status(statusCode).json(payload);
    } catch (_) {
        return res.status(statusCode).json(payload);
    }
}
function formatDuration(ms) {
    if (ms < 1000) return `${ms}ms`;
    const seconds = Math.floor(ms / 1000);
    if (seconds < 60) return `${seconds} sec`;
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = seconds % 60;
    if (minutes < 60) {
        return remainingSeconds > 0 ? `${minutes}m ${remainingSeconds}s` : `${minutes}m`;
    }
    const hours = Math.floor(minutes / 60);
    const remainingMinutes = minutes % 60;
    return `${hours}h ${remainingMinutes}m`;
}
function getTranscriptFilename(sid) {
    const date = new Date();
    const day = String(date.getDate()).padStart(2, '0');
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const year = String(date.getFullYear()).slice(-2);
    const userDirPath = path.join(__dirname, 'user', sid);
    if (!fs.existsSync(userDirPath)) {
        fs.mkdirSync(userDirPath, { recursive: true });
    }
    return path.join(userDirPath, `${day}_${month}_${year}.md`);
}
async function handleTranscript(sid, msg) {
    try {
        const filename = getTranscriptFilename(sid);
        const timestamp = new Date(msg.timestamp || Date.now());
        const timeStr = timestamp.toLocaleTimeString('en-US', { hour12: false });
        const fileExists = fs.existsSync(filename);
        if (!fileExists) {
            const date = new Date();
            const dateStr = date.toLocaleDateString('en-US', {
                weekday: 'long',
                year: 'numeric',
                month: 'long',
                day: 'numeric'
            });
            const session = sessions["_" + sid];
            const header = `# Conversation Transcript - ${dateStr}\n\n` +
                `**User**: ${session?.userName || 'Unknown'}\n` +
                `**Location**: ${session?.city || 'Unknown'}\n` +
                `**Language**: ${session?.lang || 'en'}\n\n---\n`;
            await fsp.writeFile(filename, header, 'utf8');
        }
        let content = '';
        if (msg.message === 'SESSION_START') {
            content = `\n## Session Started at ${timeStr}\n\n`;
        } else if (msg.message === 'SESSION_END') {
            const duration = formatDuration(msg.duration || 0);
            content = `\n### Session ended at ${timeStr} (Duration: ${duration})\n\n---\n\n`;
        } else if (msg.role === 'user') {
            content = `**User** [${timeStr}]: ${msg.message}\n\n`;
        } else if (msg.role === 'agent') {
            content = `**Agent** [${timeStr}]: ${msg.message}\n\n`;
        }
        if (content) {
            await fsp.appendFile(filename, content, 'utf8');
        }
        if (msg.message === 'SESSION_END') {
            console.log(`[TRANSCRIPT] Session for ${sid} lasted ${formatDuration(msg.duration || 0)}`);
        }
    } catch (error) {
        console.error('Failed to write transcript:', error);
    }
}
const CONTEXT_LENGTH = parseInt(process.env.CONTEXT_LENGTH) || 128000;
let tokenEncoder = null;
function getTokenEncoder() {
    if (!tokenEncoder) {
        try {
            tokenEncoder = encoding_for_model('gpt-4');
        } catch (error) {
        }
    }
    return tokenEncoder;
}
function countTokens(text) {
    try {
        const encoder = getTokenEncoder();
        if (!encoder) {
            return Math.ceil(text.length / 4);
        }
        const tokens = encoder.encode(text);
        return tokens.length;
    } catch (error) {
        return Math.ceil(text.length / 4);
    }
}
var md5 = function (text) {
    return crypto.createHash('md5').update(text).digest("hex");
};
const randInt = (min, max) => {
    return Math.floor(Math.random() * (max - min + 1)) + min;
};
async function fetchWithTimeout(url, options = {}, timeoutMs = 10000) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
        const response = await fetch(url, {
            ...options,
            signal: controller.signal
        });
        clearTimeout(timeout);
        return response;
    } catch (error) {
        clearTimeout(timeout);
        if (error.name === 'AbortError') {
            throw new Error('TIMEOUT');
        }
        throw error;
    }
}
function buildErrorResponse(errorType, serviceName, toolCmd) {
    const errorMessages = {
        'TIMEOUT': 'service timeout',
        'NOT_FOUND': 'service not found',
        'SERVER_ERROR': 'service error',
        'UNAVAILABLE': 'service unavailable',
        'PERMISSION_DENIED': 'access denied',
        'RATE_LIMITED': 'rate limited',
        'INVALID_REQUEST': 'invalid request',
        'NETWORK_ERROR': 'network error'
    };
    const errorTemplate = fs.readFileSync('./content/tool-response-error.md', 'utf8');
    return errorTemplate
        .replace(/{{cmd}}/g, toolCmd)
        .replace(/{{error_reason}}/g, errorMessages[errorType] || 'error')
        .replace(/{{error_message}}/g, getDetailedErrorMessage(errorType))
        .replace(/{{service_name}}/g, serviceName);
}
function getDetailedErrorMessage(errorType) {
    switch (errorType) {
        case 'TIMEOUT':
            return 'The service took too long to respond. Please try again.';
        case 'NOT_FOUND':
            return 'The requested service or tool is no longer available.';
        case 'SERVER_ERROR':
            return 'The external service is experiencing issues. Please try again later.';
        case 'UNAVAILABLE':
            return 'The service is temporarily unavailable.';
        case 'PERMISSION_DENIED':
            return 'Access to the service was denied. Check API configuration.';
        case 'RATE_LIMITED':
            return 'Too many requests to the service. Please wait a moment.';
        case 'INVALID_REQUEST':
            return 'The request parameters were invalid.';
        case 'NETWORK_ERROR':
            return 'Could not connect to the service.';
        default:
            return 'An unexpected error occurred with the service.';
    }
}
function getErrorTypeFromStatus(status) {
    if (status === 404) return 'NOT_FOUND';
    if (status === 403) return 'PERMISSION_DENIED';
    if (status === 429) return 'RATE_LIMITED';
    if (status >= 500 && status <= 504) return 'SERVER_ERROR';
    if (status === 400) return 'INVALID_REQUEST';
    return 'UNAVAILABLE';
}
function handleToolError(error, serviceName, toolCmd, res) {
    console.error(`${toolCmd} error:`, error);
    let errorType = 'UNAVAILABLE';
    if (error.message === 'TIMEOUT') {
        errorType = 'TIMEOUT';
    } else if (error.name === 'FetchError' || error.name === 'NetworkError') {
        errorType = 'NETWORK_ERROR';
    }
    const errorResponse = buildErrorResponse(errorType, serviceName, toolCmd);
    return res.status(502).send(errorResponse);
}
async function reverseGeocode(lat, lon, apiKey) {
    const url = apiEndpoints.google_maps.reverse_geocode.render({
        "lat": lat,
        "lon": lon,
        "GPLACES_KEY": apiKey
    });
    try {
        const response = await fetchWithTimeout(url, {}, 10000);
        const data = await response.json();
        if (data.status === "OK") {
            const address = data.results[0].formatted_address;
            console.log("Address:", address);
            return address;
        } else {
            console.error("Geocoding failed:", data.status, data.error_message);
            return null;
        }
    } catch (error) {
        console.error("Error fetching geocode data:", error);
        return null;
    }
}
function getTimeZoneName(offset) {
    const sign = offset >= 0 ? '+' : '-';
    const absOffset = Math.abs(offset);
    const hours = Math.floor(absOffset);
    const minutes = Math.round((absOffset - hours) * 60);
    const paddedHours = String(hours).padStart(2, '0');
    const paddedMinutes = String(minutes).padStart(2, '0');
    return `UTC${sign}${paddedHours}:${paddedMinutes}`;
}
function convertSeconds(seconds) {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const hoursText = hours > 0 ? `${hours} hour${hours !== 1 ? 's' : ''}` : '';
    const minutesText = minutes > 0 ? `${minutes} minute${minutes !== 1 ? 's' : ''}` : '';
    if (hours && minutes) {
        return `${hoursText}, ${minutesText}`;
    } else if (hours) {
        return hoursText;
    } else if (minutes) {
        return minutesText;
    } else {
        return '0 minutes';
    }
}
function getUserCurrency(countryCode) {
    if (!countryCode) return 'USD';
    const currencyData = currencyMap[countryCode];
    return currencyData ? currencyData.currency_code : 'USD';
}
/**
 * Parse user agent and format it as "Browser Version on OS with CPU"
 * Example: "Chrome 141 on Windows 11 with amd64"
 * @param {string} userAgentString - The user agent string from request headers
 * @returns {string} Formatted user agent info
 */
function parseUserAgent(userAgentString) {
    if (!userAgentString || userAgentString === "Unknown") {
        return "Unknown browser";
    }
    const parser = new UAParser(userAgentString);
    const result = parser.getResult();
    const browser = result.browser?.name || 'Unknown browser';
    const browserVersion = result.browser?.major || '';
    const os = result.os?.name || 'Unknown OS';
    const osVersion = result.os?.version || '';
    const cpu = result.cpu?.architecture || '';
    let formatted = browser;
    if (browserVersion) {
        formatted += ` ${browserVersion}`;
    }
    if (os !== 'Unknown OS') {
        formatted += ` on ${os}`;
        if (osVersion) {
            formatted += ` ${osVersion}`;
        }
    }
    if (cpu) {
        formatted += ` with ${cpu}`;
    }
    return formatted;
}
var distance = function (lat1, lon1, lat2, lon2, unit) {
    unit = unit || "M";
    var radlat1 = Math.PI * lat1 / 180;
    var radlat2 = Math.PI * lat2 / 180;
    var radlon1 = Math.PI * lon1 / 180;
    var radlon2 = Math.PI * lon2 / 180;
    var theta = lon1 - lon2;
    var radtheta = Math.PI * theta / 180;
    var dist = Math.sin(radlat1) * Math.sin(radlat2) +
        Math.cos(radlat1) * Math.cos(radlat2) * Math.cos(radtheta);
    dist = Math.acos(dist);
    dist = dist * 180 / Math.PI;
    dist = dist * 60 * 1.1515;
    if (unit === "K") {
        dist = dist * 1.609344;
    } else if (unit === "N") {
        dist = dist * 0.8684;
    } else if (unit === "M") {
        dist = dist * 1.609344 * 1000;
    }
    return dist;
};
/**
 * Initialize user directory and create profile files on first tool call
 * @param {string} uid - User ID (32 character hash)
 * @param {string} systemPrompt - The rendered system prompt for this user
 */
function initializeUserDirectory(uid, systemPrompt) {
    const userDirPath = path.join(__dirname, './user', uid);
    if (fs.existsSync(userDirPath)) {
        return false;
    }
    try {
        fs.mkdirSync(userDirPath, { recursive: true });
        const profileContent = `# User Profile
**User ID**: ${uid}
**Created**: ${new Date().toISOString()}
## Profile Information
- Language: ${sessions["_" + uid]?.lang || 'Unknown'}
- Location: ${sessions["_" + uid]?.city || 'Unknown'}
- Currency: ${sessions["_" + uid]?.currency || 'Unknown'}
- User Name: ${sessions["_" + uid]?.userName || 'Anonymous'}
- Coordinates: ${sessions["_" + uid]?.lat || 0}, ${sessions["_" + uid]?.lon || 0}
## Notes
This file contains user profile information and preferences.
`;
        fs.writeFileSync(path.join(userDirPath, 'profile.md'), profileContent, 'utf8');
        const transcriptContent = `# Conversation Transcript
**User ID**: ${uid}
**Started**: ${new Date().toISOString()}
---
## Conversation Log
`;
        fs.writeFileSync(path.join(userDirPath, 'transcript.md'), transcriptContent, 'utf8');
        fs.writeFileSync(path.join(userDirPath, 'system.md'), systemPrompt, 'utf8');
        return true;
    } catch (error) {
        return false;
    }
}
String.prototype.explode = function (c, n) {
    if (this.indexOf(c) > -1) {
        return this.split(c)[n];
    }
    return this;
};
String.prototype.render = function (v, prefix) {
    var s = this, m, re;
    while ((m = /{{#if\s+([^}]+)}}([\s\S]*?){{\/if}}/g.exec(s))) {
        var condKey = m[1].trim();
        var condContent = m[2];
        var condValue = v[condKey];
        var shouldInclude = condValue &&
            condValue !== "undefined" &&
            condValue !== "null" &&
            condValue !== "" &&
            (typeof condValue !== "string" || condValue.length >= 1);
        s = s.replace(m[0], shouldInclude ? condContent : "");
    }
    re = new RegExp('{{' + (prefix || "") + '([^}]+)?}}', 'g');
    while ((m = re.exec(s))) {
        if (typeof v[m[1]] === "undefined") {
            v[m[1]] = "";
        }
        s = s.replace(m[0], v[m[1]]);
        re.lastIndex = 0;
    }
    return s;
};
function geoip(ip) {
    if (ip === "::1" || ip === "127.0.0.1" || ip === "::ffff:127.0.0.1") {
        console.log("Localhost IP detected, returning sample ip");
        ip = "92.44.26.128";
    }
    var geo;
    var asn;
    var obj = { "result": false };
    var err;
    try {
        geo = mmcity.city(ip);
        asn = mmasn.asn(ip);
    } catch (e) {
        console.log(e);
        err = true;
    } finally {
        if (!err) {
            obj.flag = geo?.country?.isoCode;
            obj.country = geo?.country?.names.en;
            obj.city = geo?.city?.names?.en;
            obj.lat = geo?.location?.latitude;
            obj.lon = geo?.location?.longitude;
            obj.asn = asn?.autonomousSystemNumber;
            obj.org = asn?.autonomousSystemOrganization;
            obj.vpn = geo?.traits?.isAnonymousProxy || false;
            obj.result = true;
        }
    }
    return obj;
}
/**
 * Calculate bounding box (lamin, lamax, lomin, lomax)
 * within a given radius (km) around a coordinate.
 *
 * @param {number} lat - Center latitude in degrees
 * @param {number} lon - Center longitude in degrees
 * @param {number} radiusKm - Radius in kilometers (e.g., 16)
 * @returns {Object} Bounding box coordinates
 */
function getBoundingBox(lat, lon, radiusKm = 16) {
    lat = Number(lat);
    lon = Number(lon);
    const earthRadiusKm = 6371;
    const degLatPerKm = 1 / 111.32;
    const deltaLat = radiusKm * degLatPerKm;
    const degLonPerKm = 1 / (111.32 * Math.cos(lat * Math.PI / 180));
    const deltaLon = radiusKm * degLonPerKm;
    const lamin = parseFloat((lat - deltaLat).toFixed(6));
    const lamax = parseFloat((lat + deltaLat).toFixed(6));
    const lomin = parseFloat((lon - deltaLon).toFixed(6));
    const lomax = parseFloat((lon + deltaLon).toFixed(6));
    return { lamin, lamax, lomin, lomax };
}
function getDateDetails() {
    const now = new Date();
    const day = now.getDate();
    const month = now.getMonth() + 1;
    const year = now.getFullYear();
    const currentLang = (process.env.AGENT_LANGUAGE || 'en').toLowerCase();
    const localePath = path.join(__dirname, `./content/${currentLang}/date.json`);
    let dayNames;
    let monthNames;
    try {
        if (fs.existsSync(localePath)) {
            const dateLocale = JSON.parse(fs.readFileSync(localePath, "utf8"));
            if (Array.isArray(dateLocale.dayNames) && dateLocale.dayNames.length === 7) {
                dayNames = dateLocale.dayNames;
            }
            if (Array.isArray(dateLocale.monthNames) && dateLocale.monthNames.length === 12) {
                monthNames = dateLocale.monthNames;
            }
        }
    } catch (e) {
        console.warn(`Failed to load date locale from ${localePath}, falling back to defaults.`);
    }
    const dayName = dayNames[now.getDay()];
    const monthName = monthNames[now.getMonth()];
    return { day, month, year, dayName, monthName };
}
const requiredEnvVars = ["XI_API_KEY", "AGENT_ID"];
const missingEnv = requiredEnvVars.filter(
    (k) => !process.env[k] || String(process.env[k]).trim() === ""
);
if (missingEnv.length > 0) {
    const envPath = path.join(__dirname, ".env");
    const isInteractivePlatform = ["darwin", "win32"].includes(process.platform);
    const shouldPrompt = isInteractivePlatform && process.stdin.isTTY && !fs.existsSync(envPath);
    if (shouldPrompt) {
        const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
        const ask = (q) => new Promise((resolve) => rl.question(q, (ans) => resolve(ans.trim())));
        (async () => {
            try {
                console.log("No .env found. Let's set it up.");
                console.log("Press Enter to accept defaults when shown in brackets.\n");
                const xi = await ask("XI_API_KEY (required): ");
                const agent = await ask("AGENT_ID (required): ");
                let port = await ask("PORT [3000]: ");
                if (!port) port = "3000";
                let lang = await ask("AGENT_LANGUAGE [en] (supported: en, tr): ");
                if (!lang) lang = "en";
                lang = lang.toLowerCase();
                if (!["en", "tr"].includes(lang)) {
                    console.warn(`Unsupported AGENT_LANGUAGE '${lang}', defaulting to 'en'.`);
                    lang = "en";
                }
                const lines = [
                    "# Environment configuration for the VOX server",
                    `XI_API_KEY=${xi}`,
                    `AGENT_ID=${agent}`,
                    `PORT=${port}`,
                    `AGENT_LANGUAGE=${lang}`,
                    "",
                    "# Optional: Context length for token counting (default: 128000)",
                    "# CONTEXT_LENGTH=128000",
                    ""
                ];
                fs.writeFileSync(envPath, lines.join("\n"), { flag: "wx" });
                console.log(`.env created at ${envPath}`);
                if (!xi || !agent) {
                    console.error("Required values missing. Please edit .env and restart the server.");
                    process.exit(1);
                }
                console.log("Environment configured. Please restart the server.");
                process.exit(0);
            } catch (e) {
                console.error("Failed to create .env interactively:", e?.message || e);
                process.exit(1);
            } finally {
                rl.close();
            }
        })();
    } else {
        try {
            if (!fs.existsSync(envPath)) {
                const scaffold = [
                    "# Environment configuration for the VOX server",
                    "# Fill in the required values and restart the server.",
                    "",
                    "# ElevenLabs API key",
                    "XI_API_KEY=<add your api key>",
                    "",
                    "# ElevenLabs Convai Agent ID",
                    "AGENT_ID=<add your agent id>",
                    "",
                    "# Optional: Port to run the server on (defaults to 3000)",
                    "# PORT=3000",
                    "",
                    "# Optional: Agent language (default 'en'; supported: en, tr)",
                    "# AGENT_LANGUAGE=en",
                    "",
                    "# Optional: Context length for token counting (default: 128000)",
                    "# Common values: 128000 (GPT-4), 32000 (GPT-4-32k), 8192 (older models)",
                    "# CONTEXT_LENGTH=128000"
                ].join("\n");
                fs.writeFileSync(envPath, scaffold, { flag: "wx" });
            }
        } catch (e) {
            console.error("Failed to scaffold .env:", e?.message || e);
        }
        console.error(
            `Missing required environment variables: ${missingEnv.join(", ")}`
        );
        console.error(
            "A .env file has been created/scaffolded in the project root. " +
            "Please fill in the required values and restart the server."
        );
        process.exit(1);
    }
}
const microtime = () => new Date().getTime();
const app = express();
app.use(cors());
app.use(express.json());
app.use(cookieParser());
const trustProxy = true;
app.set('trust proxy', trustProxy);
app.use((req, res, next) => {
    try {
        res.set('Permissions-Policy', 'accelerometer=(self), magnetometer=(self), gyroscope=(self)');
    } catch (_) { }
    next();
});

const staticRoot = path.join(__dirname, './dist');
const compressibleExt = new Set(['.js', '.css', '.html', '.json', '.md', '.markdown']);
function pickEncoding(accept) {
    if (!accept || typeof accept !== 'string') return null;
    const a = accept.toLowerCase();
    if (a.includes('br')) return 'br';
    if (a.includes('gzip')) return 'gzip';
    if (a.includes('deflate')) return 'deflate';
    return null;
}
function contentTypeFor(filePath) {
    const ext = path.extname(filePath).toLowerCase();
    switch (ext) {
        case '.js': return 'application/javascript; charset=utf-8';
        case '.css': return 'text/css; charset=utf-8';
        case '.html': return 'text/html; charset=utf-8';
        case '.json': return 'application/json; charset=utf-8';
        case '.md':
        case '.markdown': return 'text/markdown; charset=utf-8';
        default: return 'application/octet-stream';
    }
}
function sendCompressedBuffer(req, res, buffer, ctype) {
    const enc = pickEncoding(req.headers['accept-encoding'] || '');
    res.setHeader('Vary', 'Accept-Encoding');
    res.setHeader('Content-Type', ctype);
    try {
        const p = (req.path || '').toString();
        if (p.startsWith('/static/')) {
            res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
        } else if (p === '/manifest.json') {
            res.setHeader('Cache-Control', 'public, max-age=31536000');
        } else if ((ctype || '').includes('text/html')) {
            res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
            res.setHeader('Pragma', 'no-cache');
            res.setHeader('Expires', '0');
        }
    } catch (_) { }
    if (enc === 'br') {
        try {
            const out = zlib.brotliCompressSync(buffer);
            res.setHeader('Content-Encoding', 'br');
            res.setHeader('Content-Length', out.length);
            return res.end(out);
        } catch (_) { }
    }
    if (enc === 'gzip') {
        try {
            const out = zlib.gzipSync(buffer);
            res.setHeader('Content-Encoding', 'gzip');
            res.setHeader('Content-Length', out.length);
            return res.end(out);
        } catch (_) { }
    }
    if (enc === 'deflate') {
        try {
            const out = zlib.deflateSync(buffer);
            res.setHeader('Content-Encoding', 'deflate');
            res.setHeader('Content-Length', out.length);
            return res.end(out);
        } catch (_) { }
    }
    res.setHeader('Content-Length', buffer.length);
    return res.end(buffer);
}
async function sendCompressedFile(req, res, absPath) {
    try {
        const stat = await fs.promises.stat(absPath).catch(() => null);
        if (stat) {
            try { res.setHeader('Last-Modified', stat.mtime.toUTCString()); } catch (_) { }
        }
        const data = await fs.promises.readFile(absPath);
        const ctype = contentTypeFor(absPath);
        sendCompressedBuffer(req, res, data, ctype);
    } catch (e) {
        res.status(404).end('Not found');
    }
}

app.get('/static/*', async (req, res, next) => {
    try {
        const rel = req.path.replace(/^\/static\//, '');
        const abs = path.join(staticRoot, rel);
        const ext = path.extname(abs).toLowerCase();
        if (!compressibleExt.has(ext)) return next();
        return await sendCompressedFile(req, res, abs);
    } catch (_) {
        return next();
    }
});
app.use("/static", express.static(path.join(__dirname, "./dist"), {
    etag: true,
    maxAge: '1y',
    setHeaders: (res, filePath) => {
        res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    }
}));
app.get("/manifest.json", async (req, res) => {
    try {
        const filePath = path.join(__dirname, "./dist/manifest.json");
        await sendCompressedFile(req, res, filePath);
    } catch (_) {
        res.set('Cache-Control', 'public, max-age=31536000');
        res.sendFile(path.join(__dirname, "./dist/manifest.json"));
    }
});
app.get("/api/signed-url/:userdata", async (req, res) => {
    console.log("-- initializing system prompt..");
    req.timestamp = microtime();
    req.ip = (req.headers["x-forwarded-for"] ||
        req.headers["x-real-ip"] ||
        req.headers["x-client-ip"] ||
        req.connection.remoteAddress ||
        req.socket?.remoteAddress ||
        req.connection.socket?.remoteAddress).toString().split(",")[0].replace("::ffff:", "").trim();
    console.log("-- request from IP:", req.ip);
    var geo = geoip(req.ip);
    var today = getDateDetails();
    const promptPath = path.join(__dirname, `./content/system.md`);
    let base64 = req.params.userdata
        .replace(/_/g, '/')
        .replace(/-/g, '+');
    while (base64.length % 4) {
        base64 += '=';
    }
    const userdata = Buffer.from(base64, 'base64').toString('utf8').split('|');
    const dayPhase = userdata[0] || "day";
    const lat = userdata[1] || 0;
    const lon = userdata[2] || 0;
    const time = userdata[3] || "00:00";
    const timezone = userdata[4] || 0;
    const geostate = userdata[5] || 0;
    const geohint = userdata[6] || 0;
    const userName = userdata[7] || '';
    const userTime = parseInt(userdata[8]) || 0;
    const lastVisit = parseInt(userdata[9]) || 0;
    var lastTopicTitle = userdata[10] || '';
    const lastTopicTimestamp = parseInt(userdata[11]) || 0;
    const prefLang = userdata[12] || 0;
    var voiceId = process.env["VOICE_" + prefLang.toString().toUpperCase()] || process.env.VOICE_EN;
    const uidQuery = userdata[13] || "0";
    const clientOrientation = userdata[14] || '';
    const clientBatteryLevel = userdata[15] ? parseInt(userdata[15]) : null;
    const clientBatteryCharging = userdata[16] === '1';
    const clientHeadingDeg = userdata[17] ? parseInt(userdata[17]) : null;
    const clientHeadingCard = userdata[18] || '';
    const clientPhonePose = userdata[19] || '';
    if (clientOrientation) {
        try { console.log('-- client orientation:', clientOrientation); } catch (_) { }
    }
    if (!isNaN(clientBatteryLevel) || userdata[16] !== undefined) {
        try { console.log('-- client battery:', `${isNaN(clientBatteryLevel) ? 'n/a' : clientBatteryLevel + '%'}`, clientBatteryCharging ? '(charging)' : '(not charging)'); } catch (_) { }
    }
    if (!isNaN(clientHeadingDeg) || clientHeadingCard) {
        try { console.log('-- client heading:', `${isNaN(clientHeadingDeg) ? 'n/a' : clientHeadingDeg + '°'}`, clientHeadingCard ? `(${clientHeadingCard})` : ''); } catch (_) { }
    }
    if (clientPhonePose) {
        try { console.log('-- client phone pose:', clientPhonePose); } catch (_) { }
    }
    const geoleft = parseInt(geostate.explode(":", 1));
    var geocomment = "";
    if (geoleft > 60 && geoleft < 14400) {
        geocomment = geostate.explode(":", 0) + " in " + convertSeconds(geostate.explode(":", 1)) + ".";
    } else {
        geocomment = (geohint.explode(",", 0) === "1" ? "Tonight, the full moon shines brightly overhead." : (geohint.explode(",", 1) === "1" ? "Beware the noon sun, blazing straight overhead." : ""));
    }
    let lastTopicComment = null;
    if (lastTopicTitle && lastTopicTimestamp) {
        const topicAge = Date.now() - lastTopicTimestamp;
        const fiveMinutes = 5 * 60 * 1000;
        if (topicAge < fiveMinutes) {
            lastTopicComment = `Last conversation topic was about: ${lastTopicTitle}`;
            console.log(`-- Using topic from ${Math.floor(topicAge / 1000)} seconds ago: ${lastTopicTitle}`);
        } else {
            console.log(`-- Ignoring topic from ${Math.floor(topicAge / 1000)} seconds ago (older than 5 minutes)`);
            lastTopicComment = null;
            lastTopicTitle = null;
        }
    }
    var lat_final = (lat !== 0 ? lat : (geo.lat || 0.00));
    var lon_final = (lon !== 0 ? lon : (geo.lon || 0.00));
    const userAgentString = req.headers["user-agent"] || "Unknown";
    const userAgent = parseUserAgent(userAgentString);
    var system_prompt = fs.readFileSync(promptPath, "utf8").trim().render(
        {
            date: today.day + " " + today.monthName + " " + today.year,
            day: today.dayName,
            time: time,
            location: (geo.city ? geo.city + ", " : "") + (geo.country || "Unknown"),
            country: geo.country || "Unknown",
            city: geo.city || "Unknown",
            lat: lat_final.toString(),
            lon: lon_final.toString(),
            language: lname[prefLang] || prefLang,
            year: today.year.toString(),
            timezone: getTimeZoneName(Number(timezone)),
            geocomment: geocomment,
            currency: getUserCurrency(geo.flag),
            userName: userName,
            lastTopic: lastTopicComment,
            userAgent: userAgent
        }
    );
    let uid;
    let shouldUpdateCookie = false;
    const cookieSid = req.cookies.sid;
    if (uidQuery && uidQuery !== "0" && uidQuery !== "null" && uidQuery !== "undefined" && uidQuery.length === 32) {
        uid = uidQuery;
        if (cookieSid && cookieSid !== uid) {
            shouldUpdateCookie = true;
        } else if (!cookieSid) {
            shouldUpdateCookie = true;
        }
    } else {
        uid = md5(req.headers["user-agent"] + req.ip + randInt(11111, 99999));
        shouldUpdateCookie = true;
    }
    const persistentUserId = md5(req.ip + (req.headers["user-agent"] || "")).substring(0, 8);
    sessions["_" + uid] = {
        lang: prefLang,
        lat: lat_final,
        lon: lon_final,
        city: geo.city || "Unknown",
        currency: getUserCurrency(geo.flag),
        userName: userName,
        userId: persistentUserId,
        systemPrompt: system_prompt,
        orientation: clientOrientation,
        battery: {
            level: isNaN(clientBatteryLevel) ? null : clientBatteryLevel,
            charging: clientBatteryCharging
        },
        heading: {
            deg: isNaN(clientHeadingDeg) ? null : clientHeadingDeg,
            card: clientHeadingCard || null
        },
        phonePose: clientPhonePose || null
    };
    console.log("-- system prompt initialized.");
    const tokenCount = countTokens(system_prompt);
    const contextUsedPercent = ((tokenCount / CONTEXT_LENGTH) * 100).toFixed(2);
    const contextLeftPercent = (100 - contextUsedPercent).toFixed(2);
    console.log(`  Tokens used: ${tokenCount.toLocaleString()}`);
    console.log(`  Context length: ${CONTEXT_LENGTH.toLocaleString()}`);
    console.log(`  Context used: ${contextUsedPercent}%`);
    console.log(`  Context remaining: ${contextLeftPercent}%`);
    const drift_prompt = fs.readFileSync("./content/system-reminder.md", "utf8").trim().render(
        {
            date: today.day + " " + today.monthName + " " + today.year,
            day: today.dayName,
            time: time,
            location: (geo.city ? geo.city + ", " : "") + (geo.country || "Unknown"),
            country: geo.country || "Unknown",
            city: geo.city || "Unknown",
            lat: (lat !== 0 ? lat : (geo.lat || 0.00)).toString(),
            lon: (lon !== 0 ? lon : (geo.lon || 0.00)).toString(),
            language: lname[prefLang] || prefLang,
            timezone: getTimeZoneName(Number(timezone)),
            geocomment: geocomment,
            currency: getUserCurrency(geo.flag),
            userName: userName
        }
    );
    console.log("-- drift reminders loaded.");
    const greetings = JSON.parse(fs.readFileSync("./content/" + prefLang + "/greetings.json", "utf8"));
    let greetingPool;
    if (lastTopicTitle !== null && lastVisit > 0) {
        greetingPool = greetings.resume || [];
    }
    else if (userName && lastVisit === 0) {
        greetingPool = greetings.firstTime || [];
    }
    else if (userName) {
        const knownGreetings = greetings.known || {};
        greetingPool = knownGreetings[dayPhase] || knownGreetings.day || [];
    }
    else {
        const anonGreetings = greetings.anonymous || {};
        greetingPool = anonGreetings[dayPhase] || anonGreetings.day || [];
    }
    let randomGreeting = greetingPool[Math.floor(Math.random() * greetingPool.length)] || "Hello";
    if (lastTopicTitle) {
        randomGreeting = randomGreeting.replace('{{topic}}', lastTopicTitle);
    }
    if (userName) {
        randomGreeting = randomGreeting.replace('{{name}}', userName);
    }
    if (randomGreeting.indexOf("{") > -1) {
        const xanonGreetings = greetings.anonymous || {};
        greetingPool = xanonGreetings[dayPhase] || xanonGreetings.day || [];
        randomGreeting = greetingPool[Math.floor(Math.random() * greetingPool.length)] || "Hello";
    }
    var payload = {
        system: system_prompt,
        firstMessage: randomGreeting.replaceAll("{", "").replaceAll("}", "").replaceAll(/\s+/g, ' ').trim(),
        drift: drift_prompt,
        voiceId: voiceId,
    };
    try {
        try {
            const xfProto = (req.headers['x-forwarded-proto'] || '').toString();
            const proto = (xfProto.includes('https') || req.protocol === 'https') ? 'wss' : 'ws';
            const host = (req.headers['x-forwarded-host'] || req.headers['host'] || `localhost:${PORT}`).toString();
            payload.controlWsUrl = `${proto}://${host}/ws`;
        } catch (e) {
            payload.controlWsUrl = `ws://localhost:${PORT}/ws`;
        }
        payload.uid = uid;
        if (shouldUpdateCookie) {
            res.cookie('sid', uid, {
                httpOnly: true,
                sameSite: 'lax',
                maxAge: 365 * 24 * 60 * 60 * 1000
            });
        }
        const isChatMode = (req.query.mode === 'chat');
        const hasXI = !!process.env.XI_API_KEY && !!process.env.AGENT_ID;
        if (isChatMode || !hasXI) {
            return sendMaybeCompressedJSON(req, res, payload);
        }
        const url = apiEndpoints.elevenlabs.signed_url.replace('{{AGENT_ID}}', process.env.AGENT_ID);
        const response = await fetch(url, { method: 'GET', headers: { 'xi-api-key': process.env.XI_API_KEY } });
        if (!response.ok) {
            throw new Error(`Failed to get signed URL: ${response.status} ${response.statusText}`);
        }
        const data = await response.json();
        payload.signedUrl = data.signed_url;
        return sendMaybeCompressedJSON(req, res, payload);
    } catch (error) {
        if (req.query.mode === 'chat') {
            return sendMaybeCompressedJSON(req, res, payload);
        }
        return sendMaybeCompressedJSON(req, res, { error: 'Failed to get signed URL', details: error.message }, 500);
    }
});
app.post("/api/user-init", (req, res) => {
    const sid = req.cookies.sid;
    if (!sid || !sessions["_" + sid]) {
        return sendMaybeCompressedJSON(req, res, { error: "Invalid or missing session ID" }, 403);
    }
    if (sessions["_" + sid].systemPrompt) {
        const initialized = initializeUserDirectory(sid, sessions["_" + sid].systemPrompt);
        if (initialized) {
            return sendMaybeCompressedJSON(req, res, { success: true, message: "User directory initialized" });
        } else {
            return sendMaybeCompressedJSON(req, res, { success: false, message: "Directory already exists or initialization failed" });
        }
    } else {
        return sendMaybeCompressedJSON(req, res, { error: "System prompt not available in session" }, 400);
    }
});
app.get("/api/sentence/:event", (req, res) => {
    const sid = req.cookies.sid;
    if (!sid || !sessions["_" + sid]) {
        return sendMaybeCompressedJSON(req, res, { error: "Invalid or missing session ID" }, 403);
    }
    res.cookie('sid', sid, {
        httpOnly: true,
        sameSite: 'lax',
        maxAge: 365 * 24 * 60 * 60 * 1000
    });
    const event = req.params.event;
    const eventPath = path.join(__dirname, `./content/${sessions["_" + sid].lang}/audio/${event}`);
    if (fs.existsSync(eventPath)) {
        const stats = fs.statSync(eventPath);
        if (stats.isDirectory()) {
            const files = fs.readdirSync(eventPath).filter(file =>
                file.endsWith('.ogg') || file.endsWith('.mp3') || file.endsWith('.wav')
            );
            if (files.length > 0) {
                const randomFile = files[Math.floor(Math.random() * files.length)];
                const filePath = path.join(eventPath, randomFile);
                return res.sendFile(filePath);
            }
        }
    }
    return sendMaybeCompressedJSON(req, res, { error: "unknown event" }, 404);
});
function formatToolResponse(cmd, param, result) {
    console.log('\n=== TOOL CALL ===');
    console.log(`  Command: ${cmd}`);
    console.log(`  Parameter: ${param}`);
    console.log(`  Result: ${JSON.stringify(result, null, 2)}`);
    console.log('=================\n');
    return fs.readFileSync("./content/tool-response.md", "utf8").trim().render(
        {
            command: cmd,
            parameter: param,
            result: JSON.stringify(result)
        }
    );
}
app.get("/api/tool/image-search/:query", async (req, res) => {
    const query = req.params.query?.trim();
    const apiKey = process.env.SERPAPI_KEY;
    const serviceName = "image search";
    const toolCmd = "image-search";
    if (!apiKey) {
        const errorResponse = buildErrorResponse('PERMISSION_DENIED', serviceName, toolCmd);
        return res.status(500).send(errorResponse);
    }
    if (!query) {
        const errorResponse = buildErrorResponse('INVALID_REQUEST', serviceName, toolCmd);
        return res.status(400).send(errorResponse);
    }
    try {
        const url = apiEndpoints.serpapi.image_search.render({
            "SERPAPI_KEY": apiKey,
            "query": encodeURIComponent(query)
        });
        const response = await fetchWithTimeout(url, {}, 10000);
        if (!response.ok) {
            const errorType = getErrorTypeFromStatus(response.status);
            const errorResponse = buildErrorResponse(errorType, serviceName, toolCmd);
            return res.status(response.status).send(errorResponse);
        }
        const data = await response.json();
        const imageResults = Array.isArray(data?.images_results) ? data.images_results : [];
        const results = imageResults
            .map((item) => ({
                thumbnail: item?.thumbnail,
                original: item?.original
            }))
            .filter((item) => item.thumbnail && item.original)
            .slice(0, 25);
        console.log('\n=== TOOL CALL ===');
        console.log(`  Command: image-search`);
        console.log(`  Parameter: ${query}`);
        console.log(`  Result: ${results.length} images found`);
        console.log(`  First 3 images:`, results.slice(0, 3));
        console.log('=================\n');
        return res.send(results);
    } catch (error) {
        return handleToolError(error, serviceName, toolCmd, res);
    }
});
app.get("/api/tool/web-search/:query", async (req, res) => {
    const query = req.params.query?.trim();
    const apiKey = process.env.SERPAPI_KEY;
    const serviceName = "web search";
    const toolCmd = "web-search";
    if (!apiKey) {
        const errorResponse = buildErrorResponse('PERMISSION_DENIED', serviceName, toolCmd);
        return res.status(500).send(errorResponse);
    }
    if (!query) {
        const errorResponse = buildErrorResponse('INVALID_REQUEST', serviceName, toolCmd);
        return res.status(400).send(errorResponse);
    }
    try {
        const url = apiEndpoints.serpapi.web_search.render({
            "SERPAPI_KEY": apiKey,
            "query": encodeURIComponent(query)
        });
        const response = await fetchWithTimeout(url, {}, 10000);
        if (!response.ok) {
            const errorType = getErrorTypeFromStatus(response.status);
            const errorResponse = buildErrorResponse(errorType, serviceName, toolCmd);
            return res.status(response.status).send(errorResponse);
        }
        const data = await response.json();
        const organic = Array.isArray(data?.organic_results) ? data.organic_results : [];
        const trimmed = organic.map((item) => ({
            title: item?.title || '',
            link: item?.link || '',
            snippet: item?.snippet || ''
        })).filter(r => r.title && r.link);
        return res.send(formatToolResponse("web-search", query, trimmed));
    } catch (error) {
        return handleToolError(error, serviceName, toolCmd, res);
    }
});
app.get("/api/tool/visible-aircraft/:location", async (req, res) => {
    const sid = req.cookies.sid;
    if (!sid || !sessions["_" + sid]) {
        return sendMaybeCompressedJSON(req, res, { error: "Invalid or missing session ID" }, 403);
    }
    res.cookie('sid', sid, {
        httpOnly: true,
        sameSite: 'lax',
        maxAge: 365 * 24 * 60 * 60 * 1000
    });
    var lat = sessions["_" + sid].lat;
    var lon = sessions["_" + sid].lon;
    const { lamin, lamax, lomin, lomax } = getBoundingBox(lat, lon, 30);
    const url = apiEndpoints.opensky.aircraft_states.render({
        "lamin": lamin,
        "lamax": lamax,
        "lomin": lomin,
        "lomax": lomax
    });
    const serviceName = "flight tracking";
    const toolCmd = "visible-aircraft";
    try {
        console.log(url);
        const response = await fetchWithTimeout(url, {}, 10000);
        if (!response.ok) {
            const errorType = getErrorTypeFromStatus(response.status);
            const errorResponse = buildErrorResponse(errorType, serviceName, toolCmd);
            return res.status(response.status).send(errorResponse);
        }
        const data = await response.json();
        return res.send(formatToolResponse("visible-aircraft", `${lat},${lon}`, data));
    } catch (error) {
        return handleToolError(error, serviceName, toolCmd, res);
    }
});
app.get("/api/tool/get-weather/:location", async (req, res) => {
    const location = req.params.location?.trim();
    const apiKey = process.env.OPENWEATHER_KEY;
    const serviceName = "weather service";
    const toolCmd = "get-weather";
    if (!location) {
        const errorResponse = buildErrorResponse('INVALID_REQUEST', serviceName, toolCmd);
        return res.status(400).send(errorResponse);
    }
    if (!apiKey) {
        const errorResponse = buildErrorResponse('PERMISSION_DENIED', serviceName, toolCmd);
        return res.status(500).send(errorResponse);
    }
    try {
        const url = apiEndpoints.openweather.current_weather.render({
            "OPENWEATHER_KEY": apiKey,
            "location": encodeURIComponent(location)
        });
        const response = await fetchWithTimeout(url, {}, 10000);
        if (!response.ok) {
            const errorType = getErrorTypeFromStatus(response.status);
            const errorResponse = buildErrorResponse(errorType, serviceName, toolCmd);
            return res.status(response.status).send(errorResponse);
        }
        const data = await response.json();
        return res.send(formatToolResponse("get-weather", location, data));
    } catch (error) {
        return handleToolError(error, serviceName, toolCmd, res);
    }
});
app.get("/api/tool/latest-news/:location?", async (req, res) => {
    req.ip = (req.headers["x-forwarded-for"] ||
        req.headers["x-real-ip"] ||
        req.headers["x-client-ip"] ||
        req.connection.remoteAddress ||
        req.socket?.remoteAddress ||
        req.connection.socket?.remoteAddress).toString().split(",")[0].replace("::ffff:", "").trim();
    const geo = geoip(req.ip);
    const location = req.params.location?.trim() || 'worldwide';
    const apiKey = process.env.SERPAPI_KEY;
    const lang = (process.env.AGENT_LANGUAGE || 'en').toLowerCase();
    const country = geo.flag.toLowerCase();
    if (!apiKey) {
        return sendMaybeCompressedJSON(req, res, { error: "SERPAPI_KEY is not configured" }, 500);
    }
    try {
        const url = apiEndpoints.serpapi.news_search.render({
            "SERPAPI_KEY": apiKey,
            "query": encodeURIComponent(location),
            "language": lang,
            "country": country
        });
        console.log('  URL:', url);
        console.log('  Query:', location);
        console.log('  Language:', lang);
        console.log('  Country:', country);
        console.log('  API Key present:', !!apiKey);
        console.log('  API Key length:', apiKey ? apiKey.length : 0);
        const serviceName = "news service";
        const toolCmd = "latest-news";
        const response = await fetchWithTimeout(url, {}, 10000);
        if (!response.ok) {
            const errorType = getErrorTypeFromStatus(response.status);
            const errorResponse = buildErrorResponse(errorType, serviceName, toolCmd);
            return res.status(response.status).send(errorResponse);
        }
        const data = await response.json();
        return res.send(formatToolResponse("latest-news", location, data.news_results));
    } catch (error) {
        return handleToolError(error, serviceName, toolCmd, res);
    }
});
app.get("/api/tool/local-events/:city?", async (req, res) => {
    const city = req.params.city?.trim();
    const apiKey = process.env.SERPAPI_KEY;
    const serviceName = "events service";
    const toolCmd = "local-events";
    if (!apiKey) {
        const errorResponse = buildErrorResponse('PERMISSION_DENIED', serviceName, toolCmd);
        return res.status(500).send(errorResponse);
    }
    if (!city) {
        const errorResponse = buildErrorResponse('INVALID_REQUEST', serviceName, toolCmd);
        return res.status(400).send(errorResponse);
    }
    try {
        const url = apiEndpoints.serpapi.events_search.render({
            "SERPAPI_KEY": apiKey,
            "city": encodeURIComponent(city)
        });
        console.log('  URL:', url);
        console.log('  City:', city);
        console.log('  API Key present:', !!apiKey);
        const response = await fetchWithTimeout(url, {}, 10000);
        if (!response.ok) {
            const errorType = getErrorTypeFromStatus(response.status);
            const errorResponse = buildErrorResponse(errorType, serviceName, toolCmd);
            return res.status(response.status).send(errorResponse);
        }
        const data = await response.json();
        const events = data.events_results || [];
        const topEvents = events.slice(0, 3).map(event => {
            const title = event.title || 'Unnamed Event';
            const startDate = event.date?.start_date || '';
            const when = event.date?.when || '';
            const venue = event.venue?.name || '';
            const address = Array.isArray(event.address) ? event.address[0] : event.address;
            return {
                title,
                date: startDate,
                when,
                venue,
                address
            };
        });
        return res.send(formatToolResponse("local-events", city, topEvents));
    } catch (error) {
        return sendMaybeCompressedJSON(req, res, { error: "Failed to fetch events" }, 502);
    }
});
app.get("/api/tool/currency-convert/:param?", async (req, res) => {
    const param = req.params.param?.trim();
    const serviceName = "currency converter";
    const toolCmd = "currency-convert";
    try {
        const upperParam = param.toUpperCase();
        const involvesTRY = upperParam.includes('TRY');
        const involvesUSD = upperParam.includes('USD');
        let endpoint;
        if (involvesTRY) {
            endpoint = apiEndpoints.altinkaynak.currency;
        } else if (involvesUSD) {
            const apiKey = process.env.OPENEXCHANGERATES_KEY;
            endpoint = apiEndpoints.openexchangerates.latest.replace('{{OPENEXCHANGERATES_KEY}}', apiKey);
        } else {
            endpoint = apiEndpoints.altinkaynak.currency;
        }
        const response = await fetchWithTimeout(endpoint, {}, 10000);
        if (!response.ok) {
            const errorType = getErrorTypeFromStatus(response.status);
            const errorResponse = buildErrorResponse(errorType, serviceName, toolCmd);
            return res.status(response.status).send(errorResponse);
        }
        const data = await response.json();
        return res.send(formatToolResponse("currency-convert", param, data));
    } catch (error) {
        return handleToolError(error, serviceName, toolCmd, res);
    }
});
app.get("/api/tool/poi-search/:coordinates/:query", async (req, res) => {
    const coordinates = req.params.coordinates?.trim();
    const query = req.params.query?.trim();
    const apiKey = process.env.GPLACES_KEY;
    if (!coordinates) {
        return sendMaybeCompressedJSON(req, res, { error: "Coordinates parameter is required" }, 400);
    }
    if (!query) {
        return sendMaybeCompressedJSON(req, res, { error: "Query parameter is required" }, 400);
    }
    try {
        let [lat, lon] = coordinates.split(',').map(c => parseFloat(c.trim()));
        if (isNaN(lat) || isNaN(lon) ||
            (lat === 0 && lon === 0) ||
            lat === null || lon === null ||
            lat === undefined || lon === undefined) {

            const ip = (req.headers["x-forwarded-for"] ||
                req.headers["x-real-ip"] ||
                req.headers["x-client-ip"] ||
                req.connection.remoteAddress ||
                req.socket?.remoteAddress ||
                req.connection.socket?.remoteAddress).toString().split(",")[0].replace("::ffff:", "").trim();
            const geo = geoip(ip);
            if (geo.result && geo.lat && geo.lon) {
                lat = geo.lat;
                lon = geo.lon;
            } else {
                return sendMaybeCompressedJSON(req, res, { error: "Unable to determine location from IP or coordinates" }, 400);
            }
        }
        const url = apiEndpoints.google_places.text_search.render({
            "GPLACES_KEY": apiKey,
            "lat": lat,
            "lon": lon,
            "radius": 5000,
            "query": encodeURIComponent(query)
        });
        const response = await fetch(url);
        if (!response.ok) {
            throw new Error(`Google Places API request failed with status ${response.status}`);
        }
        const data = await response.json();
        const resultsWithDistance = (data.results || []).map(place => {
            const placeLat = place.geometry?.location?.lat;
            const placeLon = place.geometry?.location?.lng;
            const distanceInMeters = distance(lat, lon, placeLat, placeLon, "M");
            let distanceFormatted;
            if (distanceInMeters < 1000) {
                distanceFormatted = Math.round(distanceInMeters) + "m";
            } else {
                const distanceInKm = distanceInMeters / 1000;
                distanceFormatted = distanceInKm.toFixed(1) + "km";
            }
            return {
                name: place.name,
                address: place.formatted_address,
                location: place.geometry?.location,
                types: place.types,
                lat: placeLat,
                lon: placeLon,
                distance: distanceFormatted,
                distanceMeters: distanceInMeters
            };
        });
        resultsWithDistance.sort((a, b) => a.distanceMeters - b.distanceMeters);
        const results = {
            status: data.status,
            results: resultsWithDistance.slice(0, 10).map(place => ({
                name: place.name,
                address: place.address,
                location: place.location,
                types: place.types,
                lat: place.lat,
                lon: place.lon,
                distance: place.distance
            }))
        };
        if (results.results.length > 0) {
        }
        return res.send(formatToolResponse("poi-search", query, results));
    } catch (error) {
        console.error("POI search error:", error);
        return sendMaybeCompressedJSON(req, res, { error: "Failed to fetch POI results" }, 502);
    }
});
app.get("/api/tool/get-address/:coordinates", async (req, res) => {
    const coordinates = req.params.coordinates?.trim();
    const apiKey = process.env.GPLACES_KEY;
    if (!apiKey) {
        return sendMaybeCompressedJSON(req, res, { error: "GPLACES_KEY is not configured" }, 500);
    }
    if (!coordinates) {
        return sendMaybeCompressedJSON(req, res, { error: "Coordinates parameter is required" }, 400);
    }
    try {
        const [lat, lon] = coordinates.split(',').map(c => parseFloat(c.trim()));
        if (isNaN(lat) || isNaN(lon)) {
            return sendMaybeCompressedJSON(req, res, { error: "Invalid coordinates format. Expected: lat,lon" }, 400);
        }
        if (lat === 0 && lon === 0) {
            return sendMaybeCompressedJSON(req, res, { error: "unable to determine your coordinates" }, 400);
        }
        const address = await reverseGeocode(lat, lon, apiKey);
        if (!address) {
            return sendMaybeCompressedJSON(req, res, { error: "Could not find address for the given coordinates" }, 404);
        }
        console.log(address);
        const result = {
            coordinates: { lat, lon },
            formatted_address: address
        };
        return res.send(formatToolResponse("get-address", coordinates, result));
    } catch (error) {
        console.error("Get address error:", error);
        return sendMaybeCompressedJSON(req, res, { error: "Failed to fetch address data" }, 502);
    }
});
app.get("/api/tool/latest-earthquakes/:coordinates?", async (req, res) => {
    const coordinates = req.params.coordinates?.trim();
    const sid = req.cookies.sid;
    if (!sid || !sessions["_" + sid]) {
        return sendMaybeCompressedJSON(req, res, { error: "Invalid or missing session ID" }, 403);
    }
    res.cookie('sid', sid, {
        httpOnly: true,
        sameSite: 'lax',
        maxAge: 365 * 24 * 60 * 60 * 1000
    });
    var lat = sessions["_" + sid].lat;
    var lon = sessions["_" + sid].lon;
    const isAmericas = lon >= -180 && lon <= -30;
    const endpoint = isAmericas ? apiEndpoints.usgs.earthquakes : apiEndpoints.emsc.earthquakes;
    try {
        const url = endpoint.render({
            "lat": lat,
            "lon": lon
        });
        const response = await fetch(url);
        if (!response.ok) {
            throw new Error(`Earthquake API request failed with status ${response.status}`);
        }
        const data = await response.json();
        let results;
        if (isAmericas) {
            results = {
                count: data.metadata?.count || 0,
                earthquakes: (data.features || []).map(eq => ({
                    magnitude: eq.properties?.mag,
                    depth: eq.geometry?.coordinates?.[2],
                    region: eq.properties?.place,
                    time: new Date(eq.properties?.time).toISOString(),
                    location: {
                        latitude: eq.geometry?.coordinates?.[1],
                        longitude: eq.geometry?.coordinates?.[0]
                    },
                    source: eq.properties?.net
                }))
            };
        } else {
            results = {
                count: data.metadata?.count || 0,
                earthquakes: (data.features || []).map(eq => ({
                    magnitude: eq.properties?.mag,
                    depth: eq.properties?.depth,
                    region: eq.properties?.flynn_region,
                    time: eq.properties?.time,
                    location: {
                        latitude: eq.properties?.lat,
                        longitude: eq.properties?.lon
                    },
                    source: eq.properties?.auth
                }))
            };
        }
        return res.send(formatToolResponse("latest-earthquakes", `${lat},${lon}`, results));
    } catch (error) {
        console.error("Earthquake API error:", error);
        return sendMaybeCompressedJSON(req, res, { error: "Failed to fetch earthquake data" }, 502);
    }
});
app.get("/api/tool/flight-search/:param", async (req, res) => {
    const param = req.params.param?.trim();
    const apiKey = process.env.SERPAPI_KEY;
    if (!apiKey) {
        return sendMaybeCompressedJSON(req, res, { error: "SERPAPI_KEY is not configured" }, 500);
    }
    if (!param) {
        return sendMaybeCompressedJSON(req, res, { error: "Parameter is required (format: origin|destination|date)" }, 400);
    }
    const sid = req.cookies.sid;
    if (!sid || !sessions["_" + sid]) {
        return sendMaybeCompressedJSON(req, res, { error: "Invalid or missing session ID" }, 403);
    }
    res.cookie('sid', sid, {
        httpOnly: true,
        sameSite: 'lax',
        maxAge: 365 * 24 * 60 * 60 * 1000
    });
    try {
        const parts = param.split('|');
        if (parts.length !== 3) {
            return sendMaybeCompressedJSON(req, res, { error: "Invalid parameter format. Expected: origin|destination|date" }, 400);
        }
        let [origin, destination, dateStr] = parts.map(p => p.trim());
        const getIATACode = async (cityOrCode) => {
            if (/^[A-Z]{3}$/i.test(cityOrCode)) {
                return cityOrCode.toUpperCase();
            }
            const searchQuery = `${cityOrCode} airport IATA code`;
            const searchUrl = apiEndpoints.serpapi_flights.iata_search.render({
                "query": encodeURIComponent(searchQuery),
                "SERPAPI_KEY": apiKey
            });
            try {
                const searchResponse = await fetch(searchUrl);
                if (!searchResponse.ok) {
                    return cityOrCode;
                }
                const searchData = await searchResponse.json();
                if (searchData.answer_box?.answer) {
                    const answer = searchData.answer_box.answer;
                    const iataMatch = answer.match(/\b([A-Z]{3})\b/);
                    if (iataMatch) {
                        return iataMatch[1];
                    }
                }
                if (searchData.knowledge_graph?.iata_code) {
                    return searchData.knowledge_graph.iata_code.toUpperCase();
                }
                const organicResults = searchData.organic_results || [];
                for (const result of organicResults.slice(0, 3)) {
                    const snippet = (result.snippet || '') + ' ' + (result.title || '');
                    const patterns = [
                        /IATA[:\s]+([A-Z]{3})/i,
                        /\(([A-Z]{3})\)/,
                        /\b([A-Z]{3})\s+airport/i,
                        /airport\s+code[:\s]+([A-Z]{3})/i
                    ];
                    for (const pattern of patterns) {
                        const match = snippet.match(pattern);
                        if (match && match[1]) {
                            return match[1].toUpperCase();
                        }
                    }
                }
                return cityOrCode;
            } catch (error) {
                return cityOrCode;
            }
        };
        const parseDate = (dateInput) => {
            const today = new Date();
            const yyyy = today.getFullYear();
            const mm = String(today.getMonth() + 1).padStart(2, '0');
            const dd = String(today.getDate()).padStart(2, '0');
            if (dateInput.toLowerCase() === 'today') {
                return `${yyyy}-${mm}-${dd}`;
            } else if (dateInput.toLowerCase() === 'tomorrow') {
                const tomorrow = new Date(today);
                tomorrow.setDate(tomorrow.getDate() + 1);
                const tyyyy = tomorrow.getFullYear();
                const tmm = String(tomorrow.getMonth() + 1).padStart(2, '0');
                const tdd = String(tomorrow.getDate()).padStart(2, '0');
                return `${tyyyy}-${tmm}-${tdd}`;
            } else if (/^\d{4}-\d{2}-\d{2}$/.test(dateInput)) {
                return dateInput;
            } else {
                return `${yyyy}-${mm}-${dd}`;
            }
        };
        const departureId = await getIATACode(origin);
        const arrivalId = await getIATACode(destination);
        let searchDate = new Date(parseDate(dateStr));

        let allFlights = [];
        let finalSearchDate = null;
        const maxDays = 10;
        for (let dayOffset = 0; dayOffset < maxDays; dayOffset++) {
            const currentSearchDate = new Date(searchDate);
            currentSearchDate.setDate(searchDate.getDate() + dayOffset);
            const yyyy = currentSearchDate.getFullYear();
            const mm = String(currentSearchDate.getMonth() + 1).padStart(2, '0');
            const dd = String(currentSearchDate.getDate()).padStart(2, '0');
            const formattedDate = `${yyyy}-${mm}-${dd}`;

            const url = apiEndpoints.serpapi_flights.flight_search.render({
                "departure_id": departureId,
                "arrival_id": arrivalId,
                "outbound_date": formattedDate,
                "currency": "USD",
                "stops": "1",
                "type": "2",
                "SERPAPI_KEY": apiKey
            });
            const response = await fetch(url);
            if (!response.ok) {
                continue;
            }
            const data = await response.json();
            const bestFlights = data.best_flights || [];
            const otherFlights = data.other_flights || [];
            const dayFlights = [...bestFlights, ...otherFlights];

            if (dayFlights.length > 0) {
                allFlights = dayFlights;
                finalSearchDate = formattedDate;
                break;
            }
        }
        if (allFlights.length === 0) {
            return res.send(formatToolResponse("flight-search", param, {
                search: {
                    origin: origin,
                    destination: destination,
                    date: searchDate.toISOString().split('T')[0],
                    departure_iata: departureId,
                    arrival_iata: arrivalId
                },
                flights: [],
                count: 0,
                user_currency: sessions["_" + sid].currency || 'USD',
                message: 'No flights found in the next 10 days'
            }));
        }
        const formattedFlights = allFlights.map(flight => {
            const firstLeg = flight.flights?.[0] || {};
            return {
                departure_time: firstLeg.departure_airport?.time || '',
                arrival_time: firstLeg.arrival_airport?.time || '',
                departure_airport: {
                    name: firstLeg.departure_airport?.name || '',
                    id: firstLeg.departure_airport?.id || departureId
                },
                arrival_airport: {
                    name: firstLeg.arrival_airport?.name || '',
                    id: firstLeg.arrival_airport?.id || arrivalId
                },
                duration_minutes: flight.total_duration || firstLeg.duration || 0,
                airline: firstLeg.airline || '',
                price_usd: flight.price || 0,
                flight_number: firstLeg.flight_number || '',
                airplane: firstLeg.airplane || ''
            };
        });
        const result = {
            search: {
                origin: origin,
                destination: destination,
                date: finalSearchDate,
                requested_date: searchDate.toISOString().split('T')[0],
                departure_iata: departureId,
                arrival_iata: arrivalId
            },
            flights: formattedFlights,
            count: formattedFlights.length,
            user_currency: sessions["_" + sid].currency || 'USD'
        };
        return res.send(formatToolResponse("flight-search", param, result));
    } catch (error) {
        return sendMaybeCompressedJSON(req, res, { error: "Failed to fetch flight data" }, 502);
    }
});
app.get("/api/tool/calculator/:expression", (req, res) => {
    const expression = req.params.expression?.trim();
    const serviceName = "calculator";
    const toolCmd = "calculator";
    if (!expression) {
        const errorResponse = buildErrorResponse('INVALID_REQUEST', serviceName, toolCmd);
        return res.status(400).send(errorResponse);
    }
    try {
        const { evaluate } = require('mathjs');
        const result = evaluate(expression);
        console.log('\n=== TOOL CALL ===');
        console.log(`  Command: calculator`);
        console.log(`  Parameter: ${expression}`);
        console.log(`  Result: ${result}`);
        console.log('=================\n');
        return res.send(formatToolResponse("calculator", expression, String(result)));
    } catch (error) {
        console.error("Calculator error:", error);
        const errorResponse = buildErrorResponse('INVALID_REQUEST', serviceName, toolCmd);
        return res.status(400).send(errorResponse);
    }
});
app.get("/api/tool/author/:param", async (req, res) => {
    const param = req.params.param?.trim();
    const apiKey = process.env.ANTHROPIC_API_KEY || process.env.OPENAI_API_KEY;
    if (!param) {
        return sendMaybeCompressedJSON(req, res, { error: "Parameter is required" }, 400);
    }
    if (!apiKey) {
        return sendMaybeCompressedJSON(req, res, { error: "ANTHROPIC_API_KEY or OPENAI_API_KEY is not configured" }, 500);
    }
    try {
        const authorPrompt = fs.readFileSync("./content/agent-author.md", "utf8").trim();
        const fullPrompt = `${authorPrompt}\n\nUser Request: ${param}\n\nGenerate the requested content following the XML formatting instructions above. Provide a brief spoken response followed by the appropriate file tag with complete content.`;
        let response;
        let contentResult;
        if (process.env.ANTHROPIC_API_KEY) {
            response = await fetch('https://api.anthropic.com/v1/messages', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'x-api-key': process.env.ANTHROPIC_API_KEY,
                    'anthropic-version': '2023-06-01'
                },
                body: JSON.stringify({
                    model: 'claude-3-5-sonnet-20241022',
                    max_tokens: 4096,
                    messages: [{
                        role: 'user',
                        content: fullPrompt
                    }]
                })
            });
            if (!response.ok) {
                throw new Error(`Anthropic API request failed with status ${response.status}`);
            }
            const data = await response.json();
            contentResult = data.content[0].text;
        }
        // Fallback to OpenAI API
        else if (process.env.OPENAI_API_KEY) {
            response = await fetch('https://api.openai.com/v1/chat/completions', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`
                },
                body: JSON.stringify({
                    model: 'gpt-4',
                    max_tokens: 4096,
                    messages: [{
                        role: 'system',
                        content: authorPrompt
                    }, {
                        role: 'user',
                        content: param
                    }]
                })
            });
            if (!response.ok) {
                throw new Error(`OpenAI API request failed with status ${response.status}`);
            }
            const data = await response.json();
            contentResult = data.choices[0].message.content;
        } else {
            throw new Error('No API key configured');
        }
        console.log('\n=== TOOL CALL ===');
        console.log(`  Command: author`);
        console.log(`  Parameter: ${param}`);
        console.log(`  Result length: ${contentResult ? contentResult.length : 0} characters`);
        console.log(`  Result preview: ${contentResult ? contentResult.substring(0, 200) + '...' : 'No content'}`);
        console.log('=================\n');
        return res.send(contentResult);
    } catch (error) {
        return sendMaybeCompressedJSON(req, res, { error: "Failed to generate content" }, 502);
    }
});
app.post("/api/tool/tune-behaviour", express.json(), (req, res) => {
    try {
        const ip = (req.headers["x-forwarded-for"] ||
            req.headers["x-real-ip"] ||
            req.headers["x-client-ip"] ||
            req.connection.remoteAddress ||
            req.socket?.remoteAddress ||
            req.connection.socket?.remoteAddress).toString().split(",")[0].replace("::ffff:", "").trim();
        const geo = geoip(ip);
        const now = new Date();
        const dateStr = now.toISOString().split('T')[0];
        const timeStr = now.toTimeString().split(' ')[0];
        const { category, user_request, user_transcript } = req.body;
        if (!category || !user_request || !user_transcript) {
            return sendMaybeCompressedJSON(req, res, { error: "Missing required fields: category, user_request, user_transcript" }, 400);
        }
        console.log('  IP:', ip);
        console.log('  Country:', geo.country);
        console.log('  City:', geo.city);
        console.log('  Category:', category);
        console.log('  User Request:', user_request);
        console.log('  User Transcript:', user_transcript);
        const userDir = path.join(__dirname, './user');
        if (!fs.existsSync(userDir)) {
            fs.mkdirSync(userDir, { recursive: true });
        }
        const requestsFile = path.join(userDir, 'requests.md');
        const entry = `
## ${dateStr} ${timeStr}
- **IP**: ${ip}
- **Country**: ${geo.country || 'Unknown'}
- **City**: ${geo.city || 'Unknown'}
- **Category**: ${category}
- **Request**: ${user_request}
- **Transcript**: ${user_transcript}
---
`;
        fs.appendFileSync(requestsFile, entry, 'utf8');
        return sendMaybeCompressedJSON(req, res, {
            success: true,
            message: 'Behaviour tuning request recorded',
            logged_to: requestsFile
        });
    } catch (error) {
        return sendMaybeCompressedJSON(req, res, { error: "Failed to process tune-behaviour request" }, 500);
    }
});
app.get("*", async (req, res) => {
    {
        try {
            const filePath = path.join(__dirname, "./dist/index.html");
            await sendCompressedFile(req, res, filePath);
        } catch (_) {
            res.sendFile(path.join(__dirname, "./dist/index.html"));
        }
    }
});
const server = http.createServer(app);
let wss;
try {
    const { WebSocketServer } = require('ws');
    const parseCookies = (cookieHeader) => {
        const out = {};
        if (!cookieHeader) return out;
        cookieHeader.split(';').forEach(pair => {
            const idx = pair.indexOf('=');
            if (idx > -1) {
                const key = pair.slice(0, idx).trim();
                const val = decodeURIComponent(pair.slice(idx + 1).trim());
                out[key] = val;
            }
        });
        return out;
    };
    wss = new WebSocketServer({ server, path: '/ws' });
    const clients = new Set();
    wss.on('connection', (ws, req) => {
        const cookies = parseCookies(req.headers['cookie'] || '');
        const sid = cookies.sid || null;
        const ip = (req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').toString();
        if (!sid || !sessions["_" + sid]) {
            try { ws.close(1008, 'Invalid session'); } catch (_) { }
            return;
        }
        clients.add(ws);
        ws.__sid = sid;
        ws.__chatMode = false;
        ws.send(JSON.stringify({ type: 'hello', sid, time: Date.now() }));
        ws.on('message', async (data) => {
            let msg = null;
            try { msg = JSON.parse(data.toString()); } catch (_) { }
            if (!msg) {
                ws.send(data);
                return;
            }
            if (msg.type === 'ping') {
                ws.send(JSON.stringify({ type: 'pong', time: Date.now() }));
                return;
            }
            if (msg.type === 'log') {
                return;
            }
            if (msg.type === 'transcript') {
                handleTranscript(ws.__sid, msg);
                return;
            }
            if (msg.type === 'broadcast') {
                for (const client of clients) {
                    if (client.readyState === 1 && client.__sid === ws.__sid) {
                        client.send(JSON.stringify({ type: 'broadcast', payload: msg.payload }));
                    }
                }
                return;
            }
            if (msg.type === 'init_chat') {
                ws.__chatMode = true;
                const sessionData = sessions["_" + ws.__sid];
                ws.send(JSON.stringify({
                    type: 'chat_ready',
                    systemPrompt: sessionData?.systemPrompt || 'You are a helpful assistant.'
                }));
                return;
            }
            if (msg.type === 'chat_message' && ws.__chatMode) {
                const userMessage = msg.message || '';
                const sessionData = sessions["_" + ws.__sid];
                const conversationHistory = msg.history || [];
                const temperature = msg.temperature !== undefined ? msg.temperature : 0.7;
                try {
                    const ollamaUrl = process.env.OLLAMA_URL || 'http://localhost:11434';
                    //                    const ollamaModel = process.env.OLLAMA_MODEL || 'kimi-k2:1t-cloud';
                    const ollamaModel = process.env.OLLAMA_MODEL || 'gpt-oss:120b-cloud';
                    const messages = [
                        { role: 'system', content: sessionData?.systemPrompt || 'You are a helpful assistant.' },
                        ...conversationHistory,
                        { role: 'user', content: userMessage }
                    ];
                    const requestBody = {
                        model: ollamaModel,
                        messages: messages,
                        stream: true,
                        options: {
                            temperature: temperature
                        }
                    };
                    const response = await fetch(`${ollamaUrl}/api/chat`, {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json'
                        },
                        body: JSON.stringify(requestBody)
                    });
                    if (!response.ok) {
                        throw new Error(`Ollama API error: ${response.status} ${response.statusText}`);
                    }
                    const reader = response.body.getReader();
                    const decoder = new TextDecoder();
                    let jsonBuffer = '';
                    let completeResponse = '';
                    let tokenBuffer = '';
                    const MIN_BUFFER_SIZE = 16;
                    async function processStream() {
                        try {
                            while (true) {
                                const { done, value } = await reader.read();
                                if (done) {
                                    if (tokenBuffer.length > 0) {
                                        ws.send(JSON.stringify({
                                            type: 'token',
                                            token: tokenBuffer
                                        }));
                                        tokenBuffer = '';
                                    }
                                    ws.send(JSON.stringify({ type: 'done' }));
                                    break;
                                }
                                jsonBuffer += decoder.decode(value, { stream: true });
                                const lines = jsonBuffer.split('\n');
                                jsonBuffer = lines.pop() || '';
                                for (const line of lines) {
                                    if (line.trim()) {
                                        try {
                                            const json = JSON.parse(line);
                                            if (json.message?.content) {
                                                completeResponse += json.message.content;
                                                tokenBuffer += json.message.content;
                                                if (tokenBuffer.length >= MIN_BUFFER_SIZE) {
                                                    ws.send(JSON.stringify({
                                                        type: 'token',
                                                        token: tokenBuffer
                                                    }));
                                                    tokenBuffer = '';
                                                }
                                            }
                                        } catch (e) {
                                        }
                                    }
                                }
                            }
                        } catch (streamError) {
                            ws.send(JSON.stringify({
                                type: 'chat_error',
                                error: streamError.message
                            }));
                        }
                    }
                    processStream();
                } catch (error) {
                    ws.send(JSON.stringify({
                        type: 'chat_error',
                        error: error.message
                    }));
                }
                return;
            }

            ws.send(JSON.stringify({ type: 'echo', payload: msg }));
        });
        ws.on('close', () => {
            clients.delete(ws);
        });
        ws.on('error', (err) => {
        });
    });
    const interval = setInterval(() => {
        for (const ws of clients) {
            if (ws.readyState !== 1) continue;
            try { ws.ping(); } catch (_) { }
        }
    }, 30000);
    wss.on('close', () => clearInterval(interval));
} catch (e) {
}
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}: http://localhost:${PORT}`);
    if (wss) console.log(`WebSocket listening at ws://localhost:${PORT}/ws`);
});
app.post('/api/onmessage', express.json(), (req, res) => {
    try {
        const sid = req.cookies.sid;
        if (!sid || !sessions['_' + sid]) {
            return sendMaybeCompressedJSON(req, res, { error: 'Invalid or missing session ID' }, 403);
        }
        const body = req.body || {};
        return sendMaybeCompressedJSON(req, res, { success: true });
    } catch (e) {
        return sendMaybeCompressedJSON(req, res, { error: 'onmessage failed' }, 500);
    }
});
