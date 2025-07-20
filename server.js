const express = require("express");
const cors = require("cors");
const dotenv = require("dotenv");
const path = require("path");
const Reader = require('@maxmind/geoip2-node').Reader;
const fs = require("fs");
const mmcity = Reader.openBuffer(fs.readFileSync('./db/GeoLite2-City.mmdb'));
const mmasn = Reader.openBuffer(fs.readFileSync('./db/GeoLite2-ASN.mmdb'));

const greetings = {
    "morning": [
        "Good morning! I'm here and ready to help.",
        "Morning! Let me know how I can assist you today.",
        "Welcome back! Hope you had a restful night — what can I do for you this morning?",
        "Good morning! Let’s make today a productive one.",
        "Hello! It's a fresh new day — how can I support you?",
        "Morning! I'm all set if you need anything.",
        "Welcome! Ready to get started?",
        "Good morning! Just say the word, and I’ll jump in.",
        "Morning sunshine! I'm here whenever you need me.",
        "Hello! Wishing you a great start to your day — how can I assist?"
    ],
    "day": [
        "Hello! How can I assist you today?",
        "Welcome! Hope your day is going well.",
        "Hi there! Let me know if you need any help.",
        "Back again? Great! What can I do for you today?",
        "I'm here and ready whenever you are.",
        "Welcome back! Let's make the most of the day.",
        "Hey there! Need a hand with anything?",
        "Happy to see you! How can I support you today?",
        "Let me know how I can help move things forward.",
        "Here to help — just tell me what you need."
    ],
    "evening": [
        "Good evening! How can I assist you tonight?",
        "Welcome back! Need anything before winding down?",
        "Evening! I’m here if you need a hand.",
        "Hope your day went well — let me know if you need help.",
        "Good to see you! What can I do for you this evening?",
        "Evening check-in — I’m ready when you are.",
        "Welcome! I’m still here and ready to assist.",
        "Relaxing now? Let me know if I can help with anything.",
        "It's evening, but I'm still at your service.",
        "Good evening! Let's wrap up your day smoothly."
    ],
    "night": [
        "Good night! I'm here if you need anything before bed.",
        "Late night? I’ve still got you covered.",
        "Welcome! How can I help you this evening?",
        "Winding down? I'm standing by if you need help.",
        "Night owl mode — I’m still ready to assist.",
        "Still working? I’m here to help.",
        "Hello again! Need anything before you call it a night?",
        "Good night! Let me know how I can support you.",
        "Late, but I’m here — how can I help?",
        "Even at night, I’m just a message away."
    ]
}


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
        /*
        return {
            flag: "DE",
            country: "Germany",
            city: "Berlin",
            lat: 52.500733971884245,
            lon: 13.443645715045234,
            asn: "AS15169",
            org: "Google LLC",
            vpn: false,
            result: true
        };
*/
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

    const day = now.getDate(); // Numeric day (1-31)
    const month = now.getMonth() + 1; // Numeric month (0-11, so add 1)
    const year = now.getFullYear(); // Full year

    const dayNames = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
    const monthNames = [
        "January", "February", "March", "April", "May", "June",
        "July", "August", "September", "October", "November", "December"
    ];

    const dayName = dayNames[now.getDay()]; // Day of the week
    const monthName = monthNames[now.getMonth()]; // Month name

    return {
        day,
        month,
        year,
        dayName,
        monthName
    };
}

dotenv.config();
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
    var system_prompt = fs.readFileSync("./system_prompt.txt", "utf8").trim().render(
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

    // Get day phase from URL parameter or default to "day"
    const dayPhase = req.params.dayPhase || "day";

    // Get random greeting for the day phase
    const phaseGreetings = greetings[dayPhase] || greetings["day"];
    const randomGreeting = phaseGreetings[Math.floor(Math.random() * phaseGreetings.length)];

    var payload = {
        system: system_prompt,
        firstMessage: randomGreeting,
    };
    console.log("-- fetching signed URL..");
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

        const data = await response.json();
        payload.signedUrl = data.signed_url;
        res.json(payload);
    } catch (error) {
        console.error("Error:", error);
        res.status(500).json({ error: "Failed to get signed URL" });
    }
});

app.get("/api/getAgentId", (req, res) => {
    const agentId = process.env.AGENT_ID;
    res.json({
        agentId: `${agentId}`
    });
});

// Serve index.html for all other routes
app.get("*", (req, res) => {
    res.sendFile(path.join(__dirname, "./dist/index.html"));
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}: http://localhost:${PORT}`);
});
