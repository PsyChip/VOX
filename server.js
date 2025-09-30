const express = require("express");
const cors = require("cors");
const dotenv = require("dotenv");
const readline = require("readline");
const path = require("path");
const Reader = require('@maxmind/geoip2-node').Reader;
const fs = require("fs");
const mmcity = Reader.openBuffer(fs.readFileSync('./db/GeoLite2-City.mmdb'));
const mmasn = Reader.openBuffer(fs.readFileSync('./db/GeoLite2-ASN.mmdb'));
const lang = (process.env.AGENT_LANGUAGE || 'en').toLowerCase();


String.prototype.render = function (v, prefix) {
    var s = this, m;
    while ((m = new RegExp('{{' + (prefix || "") + '([^}]+)?}}', 'g').exec(s))) {
        s = s.replace(m[0], v[m[1]]);
    }
    return s;
};

function geoip(ip) {
    if (ip === "::1" || ip === "127.0.0.1" || ip === "::ffff:127.0.0.1") {
        console.log("Localhost IP detected, returning sample ip");
        ip = "217.9.109.94";
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

dotenv.config();
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
        // Fallback: scaffold .env if missing, then exit with instructions
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
                    "# AGENT_LANGUAGE=en"
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

const trustProxy = true;
app.set('trust proxy', trustProxy);

app.use("/static", express.static(path.join(__dirname, "./dist")));
app.get("/api/signed-url/:dayPhase?", async (req, res) => {
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
    const lang = (process.env.AGENT_LANGUAGE || 'en').toLowerCase();
    const promptPath = path.join(__dirname, `./content/${lang}/system.md`);
    if (!fs.existsSync(promptPath)) {
        console.error(`System prompt for language '${lang}' not found at ${promptPath}.`);
        console.error("Set AGENT_LANGUAGE to a supported value or add the missing prompt file.");
        process.exit(1);
    } ç
    var system_prompt = fs.readFileSync(promptPath, "utf8").trim().render(
        {
            date: today.day + " " + today.monthName + " " + today.year + ", " + today.dayName,
            day: today.dayName,
            time: new Date().toLocaleTimeString(),
            location: (geo.city ? geo.city + ", " : "") + (geo.country || "Unknown"),
            country: geo.country || "Unknown",
            city: geo.city || "Unknown",
            lat: geo.lat || "0.00",
            lon: geo.lon || "0.00",
        }
    );

    const dayPhase = req.params.dayPhase || "day";

    // Get random greeting for the day phase
    const greetings = JSON.parse(fs.readFileSync("./content/" + lang + "/greetings.json", "utf8"));
    const phaseGreetings = greetings[dayPhase] || greetings["day"];
    const randomGreeting = phaseGreetings[Math.floor(Math.random() * phaseGreetings.length)];

    var payload = {
        system: system_prompt,
        firstMessage: randomGreeting,
    };
    try {
        const response = await fetch(
            `https://api.elevenlabs.io/v1/convai/conversation/get_signed_url?agent_id=${process.env.AGENT_ID}`,
            {
                method: "GET",
                headers: {
                    "xi-api-key": process.env.XI_API_KEY,
                },
            }
        );

        if (!response.ok) {
            throw new Error("Failed to get signed URL");
        }

        const tools = await fetch(
            `https://api.elevenlabs.io/v1/convai/tools`,
            {
                method: "GET",
                headers: {
                    "xi-api-key": process.env.XI_API_KEY,
                },
            }
        );

        if (!tools.ok) {
            throw new Error("Failed to get tools");
        }
        const toolsData = await tools.json();
        payload.tool_ids = [];
        for (var i = 0; i < toolsData.tools.length; i++) {
            payload.tool_ids.push(toolsData.tools[i].id);
        }

        const data = await response.json();
        payload.signedUrl = data.signed_url;
        res.json(payload);
    } catch (error) {
        console.error("Error:", error);
        res.status(500).json({ error: "Failed to get signed URL" });
    }
});

app.get("*", (req, res) => {
    res.sendFile(path.join(__dirname, "./dist/index.html"));
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}: http://localhost:${PORT}`);
});
