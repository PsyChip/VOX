"use strict";

import { Conversation } from '@elevenlabs/client';
import { evaluate } from 'mathjs';

let conversation = null;

var _leave = new sound("/static/sfx/VoiceLeave.ogg");
var _join = new sound("/static/sfx/VoiceJoin.ogg");
var _err = new sound("/static/sfx/VoiceError.ogg");
var _talk = new sound("/static/sfx/talk.ogg");
var _action = new sound("/static/sfx/action.ogg");
var subtitle = document.getElementById("subtitle");

const SPEECH_THRESHOLD = 15;
const SILENCE_THRESHOLD = 10;
const MIN_SPEECH_SAMPLES = 5;
const END_SENTENCE_PAUSE = 800;
const TOUCH_UI_TIMEOUT = 5000; // Touch UI elements visibility timeout in milliseconds (5 seconds)
const SUBTITLE_SENTENCE_DURATION = 1500; // Duration to show each sentence (1.5 seconds)
const SUBTITLE_FADE_DURATION = 1500; // Duration of fade out (1.5 seconds)

let connected = false;
let isSpeaking = false;
let speechEnergy = 0;
let silenceTimer = null;
let speechSamplesAboveThreshold = 0;
let lastSpeechTimestamp = 0;
let lowEnd = false;

let ctx = null;
let w = window.innerWidth;
let h = window.innerHeight;

let nrt = 0;
let npt = 0;
let frequencyData;
let frequencyDataLen;
let analyser;
let agentAnalyser;
let audioContent;
let audioStream;
let agentTalking = false;
let lastSubtitleText = "";
let lastSubtitleChangeTime = 0;
let subtitleSentenceQueue = [];
let subtitleCurrentIndex = 0;
let subtitleTimer = null;
let micName = "";
let convolver;
let impulse;
let masterGainNode = null;
let masterGainStoredValue = null;
let masterGainRestoreTimer = null;
let isHissPlaying = false;

let loaderOverlay = null;

let userCoordinates = null;
let locationRequestPromise = null;
let lastReportedCoordinates = null;
let coordinateMonitorTimer = null;
const COORDINATE_CHECK_INTERVAL = 60000; // Check every 60 seconds (1 minute)

let notificationContainer = null;
let driftReminder = null;
let aiResponseCount = 0;
let conversationStartTime = 0;
let userInitialized = false; // Track if user directory has been initialized
const DRIFT_REMINDER_INTERVAL = 3; // Send drift reminder every 3 AI responses
const DRIFT_REMINDER_DELAY = 15000; // Don't send drift reminder for first 15 seconds

let waitingForToolResponse = false;
let rawData = "";
window.userRequestedDisconnect = false; // Track if disconnect was intentional
let isToolLoading = false;
let toolLoadingStartTime = 0;
let toolLoadingSpeedMultiplier = 1;
const TOOL_LOADING_SPEED_RAMP_DURATION = 150; // ms to ramp up to 2x speed
const config = {
    circleRadius: 80,
    multiplier: 50,
    colorSpeed: 15,
    hueStart: 0,
    glow: 0.1,
    coef: 0.09,
    smoothing: 0.48
};

const canvas = document.getElementById("canvas");
const AudioContext = window.AudioContext || window.webkitAudioContext;

function getDayPhase() {
    const now = new Date();
    const hour = now.getHours();

    if (hour >= 5 && hour < 12) {
        return 'morning';
    } else if (hour >= 12 && hour < 17) {
        return 'day';
    } else if (hour >= 17 && hour < 21) {
        return 'evening';
    } else {
        return 'night';
    }
}

function requestPreciseLocation() {
    if (userCoordinates) {
        return Promise.resolve(userCoordinates);
    }

    if (!window.isSecureContext || !navigator.geolocation) {
        userCoordinates = { latitude: 0, longitude: 0 };
        return Promise.resolve(userCoordinates);
    }

    if (locationRequestPromise) {
        return locationRequestPromise;
    }

    locationRequestPromise = new Promise((resolve) => {
        const complete = (coords) => {
            userCoordinates = coords;
            resolve(coords);
        };

        try {
            navigator.geolocation.getCurrentPosition(
                (position) => {
                    complete({
                        latitude: position.coords.latitude,
                        longitude: position.coords.longitude,
                    });
                },
                () => {
                    complete({ latitude: 0, longitude: 0 });
                },
                {
                    enableHighAccuracy: true,
                    maximumAge: 0,
                    timeout: 15000,
                }
            );
        } catch (error) {
            complete({ latitude: 0, longitude: 0 });
        }
    });

    return locationRequestPromise;
}

function startCoordinateMonitoring() {
    // Clear any existing timer
    if (coordinateMonitorTimer) {
        clearInterval(coordinateMonitorTimer);
        coordinateMonitorTimer = null;
    }

    // Only start monitoring if geolocation is available
    if (!window.isSecureContext || !navigator.geolocation) {
        console.log('[LOCATION] Geolocation not available, skipping coordinate monitoring');
        return;
    }

    console.log('[LOCATION] Starting coordinate monitoring (checking every minute)');
    if (window.debugLog) {
        window.debugLog('LOCATION: Starting coordinate monitoring', 'system');
    }

    // Set initial coordinates as the last reported
    lastReportedCoordinates = userCoordinates ? { ...userCoordinates } : null;

    coordinateMonitorTimer = setInterval(() => {
        if (!connected || !conversation) {
            return;
        }

        // Request fresh coordinates
        navigator.geolocation.getCurrentPosition(
            (position) => {
                const newCoords = {
                    latitude: position.coords.latitude,
                    longitude: position.coords.longitude
                };

                // Update userCoordinates
                userCoordinates = newCoords;

                // Check if coordinates have changed significantly
                if (lastReportedCoordinates) {
                    const latDiff = Math.abs(newCoords.latitude - lastReportedCoordinates.latitude);
                    const lonDiff = Math.abs(newCoords.longitude - lastReportedCoordinates.longitude);

                    // Only report if changed by at least 0.0001 degrees (~11 meters)
                    if (latDiff > 0.0001 || lonDiff > 0.0001) {
                        const contextMsg = `<system-reminder>User's coordinates changed to: ${newCoords.latitude.toFixed(6)}, ${newCoords.longitude.toFixed(6)} use those coordinates on your geographic tool calls.</system-reminder>`;
                        conversation.sendUserMessage(contextMsg);
                        console.log('[LOCATION] Coordinates changed, sent update:', contextMsg);
                        if (window.debugLog) {
                            window.debugLog(`LOCATION: Coordinates updated to ${newCoords.latitude.toFixed(6)}, ${newCoords.longitude.toFixed(6)}`, 'system');
                        }

                        // Update last reported coordinates
                        lastReportedCoordinates = { ...newCoords };
                    } else {
                        console.log('[LOCATION] Coordinates unchanged, skipping update');
                    }
                } else {
                    // First check, store coordinates without reporting
                    lastReportedCoordinates = { ...newCoords };
                    console.log('[LOCATION] Initial coordinates stored:', newCoords);
                }
            },
            (error) => {
                console.log('[LOCATION] Failed to get coordinates:', error.message);
            },
            {
                enableHighAccuracy: true,
                maximumAge: 0,
                timeout: 10000
            }
        );
    }, COORDINATE_CHECK_INTERVAL);
}

function stopCoordinateMonitoring() {
    if (coordinateMonitorTimer) {
        clearInterval(coordinateMonitorTimer);
        coordinateMonitorTimer = null;
        console.log('[LOCATION] Stopped coordinate monitoring');
        if (window.debugLog) {
            window.debugLog('LOCATION: Stopped coordinate monitoring', 'system');
        }
    }
}

function isStereoMix(device) {
    const stereoMix = [
        'Stereo Mix',
        'What U Hear',
        'Loopback',
        'VB-Audio Virtual Cable',
        'VB-Audio VoiceMeeter',
        'Virtual Audio Cable',
        'BlackHole',
        'Soundflower',
        'Jack Audio Connection Kit',
        'ASIO4ALL',
        'Rogue Amoeba Loopback',
        'Dante Virtual Soundcard',
        'Sunflower'
    ];
    for (var i = 0; i < stereoMix.length; i++) {
        if (device === stereoMix[i] || device.indexOf(stereoMix[i]) > -1 || stereoMix[i].indexOf(device) > -1) {
            return true;
        }
    }
    return false;
}

/**
 * Display subtitle with sentence-by-sentence timing:
 * - Split text into sentences using . ? ! delimiters
 * - Show each sentence for 1500ms
 * - Keep last sentence until agent finishes speaking
 * - Fade out after 1500ms of speaking end
 */
function showSubtitle(text) {
    if (!text || text.trim().length === 0) {
        subtitle.innerHTML = "";
        subtitle.style.opacity = "1";
        subtitle.style.fontStyle = "normal";
        subtitle.style.color = "#fff";
        lastSubtitleText = "";
        return;
    }

    // Clear any existing timer
    if (subtitleTimer) {
        clearTimeout(subtitleTimer);
        subtitleTimer = null;
    }

    // Check if text is wrapped in brackets [text]
    let displayText = text;
    let isItalic = false;
    const bracketMatch = text.match(/^\[(.*)\]$/);
    if (bracketMatch) {
        displayText = bracketMatch[1];
        isItalic = true;
    }

    // Split text into sentences using . ? ! as delimiters
    const sentences = displayText.split(/([.?!]+)/).filter(s => s.trim().length > 0);

    // Reconstruct sentences with their punctuation
    subtitleSentenceQueue = [];
    let currentSentence = "";
    for (let i = 0; i < sentences.length; i++) {
        currentSentence += sentences[i];
        // If this part ends with punctuation or it's the last part
        if (/[.?!]+$/.test(sentences[i]) || i === sentences.length - 1) {
            if (currentSentence.trim().length > 0) {
                subtitleSentenceQueue.push(currentSentence.trim());
            }
            currentSentence = "";
        }
    }

    // If no sentences were found, treat entire text as one sentence
    if (subtitleSentenceQueue.length === 0) {
        subtitleSentenceQueue = [displayText.trim()];
    }

    subtitleCurrentIndex = 0;

    // Function to display the next sentence
    function displayNextSentence() {
        if (subtitleCurrentIndex >= subtitleSentenceQueue.length) {
            return;
        }

        const sentence = subtitleSentenceQueue[subtitleCurrentIndex];
        subtitle.innerHTML = sentence;

        if (isItalic) {
            subtitle.style.fontStyle = "italic";
            subtitle.style.color = "#999999";
        } else {
            subtitle.style.fontStyle = "normal";
            subtitle.style.color = "#fff";
        }

        subtitle.style.opacity = "1";
        subtitle.style.transition = "none";

        lastSubtitleText = sentence;
        lastSubtitleChangeTime = Date.now();

        subtitleCurrentIndex++;

        // If this is not the last sentence, schedule next sentence display
        if (subtitleCurrentIndex < subtitleSentenceQueue.length) {
            subtitleTimer = setTimeout(displayNextSentence, SUBTITLE_SENTENCE_DURATION);
        } else {
            // This is the last sentence - wait for agent to finish speaking, then fade out
            scheduleLastSentenceFadeout();
        }
    }

    // Start displaying sentences
    displayNextSentence();
}

/**
 * Schedule fadeout for the last sentence after agent finishes speaking
 */
function scheduleLastSentenceFadeout() {
    // Clear any existing timer
    if (subtitleTimer) {
        clearTimeout(subtitleTimer);
        subtitleTimer = null;
    }

    function checkAndFadeout() {
        if (!agentTalking) {
            // Agent finished speaking, wait 1500ms then fade out
            subtitleTimer = setTimeout(() => {
                subtitle.style.transition = `opacity ${SUBTITLE_FADE_DURATION / 1000}s ease-out`;
                subtitle.style.opacity = "0";

                // Clear subtitle after fade completes
                setTimeout(() => {
                    if (subtitle.style.opacity === "0") {
                        subtitle.innerHTML = "";
                        subtitleSentenceQueue = [];
                        subtitleCurrentIndex = 0;
                    }
                }, SUBTITLE_FADE_DURATION);
            }, SUBTITLE_FADE_DURATION);
        } else {
            // Agent still speaking, check again in 100ms
            subtitleTimer = setTimeout(checkAndFadeout, 100);
        }
    }

    checkAndFadeout();
}

function detectPerformance() {
    const hasLowMemory = navigator.deviceMemory && navigator.deviceMemory < 8;

    if (hasLowMemory) {
        lowEnd = true;
        console.log("Low performance mode enabled");
    }

    if (window.location.search.includes('lowend=true') || window.location.search.includes('lowend=verylow')) {
        lowEnd = true;
    } else if (window.location.search.includes('lowend=false')) {
        lowEnd = false;
    }
}

function calculateSpeechEnergy(frequencyData) {
    let speechSum = 0;
    let count = 0;

    for (let i = 2; i < 15; i++) {
        speechSum += frequencyData[i];
        count++;
    }

    for (let i = 16; i < 90; i++) {
        speechSum += frequencyData[i] * 1.2;
        count++;
    }

    return count > 0 ? speechSum / count : 0;
}

function detectSpeechActivity() {
    if (agentTalking)
        return;

    analyser.getByteFrequencyData(frequencyData);

    speechEnergy = calculateSpeechEnergy(frequencyData);

    const now = Date.now();

    if (speechEnergy > SPEECH_THRESHOLD) {
        if (silenceTimer) {
            clearTimeout(silenceTimer);
            silenceTimer = null;
        }

        speechSamplesAboveThreshold++;

        if (speechSamplesAboveThreshold >= MIN_SPEECH_SAMPLES && !isSpeaking) {
            isSpeaking = true;
        }

        lastSpeechTimestamp = now;
    } else if (isSpeaking && speechEnergy < SILENCE_THRESHOLD) {
        const silenceDuration = now - lastSpeechTimestamp;

        if (!silenceTimer && silenceDuration > 300) {
            silenceTimer = setTimeout(() => {
                isSpeaking = false;
                speechSamplesAboveThreshold = 0;
                onEndOfSentenceDetected();
                silenceTimer = null;
            }, END_SENTENCE_PAUSE);
        }
    } else {
        speechSamplesAboveThreshold = Math.max(0, speechSamplesAboveThreshold - 1);
    }
}

function onEndOfSentenceDetected() {
    console.log("End of sentence detected");
}

function showDisconnectionBox() {
    hideDisconnectionBox();

    const box = document.createElement("div");
    box.id = "disconnectionBox";

    const message = document.createElement("span");
    message.textContent = "Agent is disconnected";

    const button = document.createElement("button");
    button.textContent = "Call again";
    button.onclick = reconnectAgent;

    box.appendChild(message);
    box.appendChild(button);
    document.body.appendChild(box);
}

function hideDisconnectionBox() {
    const box = document.getElementById("disconnectionBox");
    if (box) {
        box.remove();
    }
}

async function reconnectAgent() {
    hideDisconnectionBox();
    window.userRequestedDisconnect = false; // Reset flag when manually reconnecting
    await startConversation();
}

function getLocalTime24() {
    const now = new Date();
    return now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
}

function tzOffset() {
    return -new Date().getTimezoneOffset() / 60;
}

async function initializeTools() {
    try {
        var payload = [];
        payload.push(getDayPhase());
        const coords = await requestPreciseLocation();
        const lat = coords.latitude;
        const lng = coords.longitude;
        payload.push(lat.toFixed(8));
        payload.push(lng.toFixed(8));
        payload.push(getLocalTime24());
        payload.push(tzOffset());

        if (typeof Sun !== 'undefined') {
            const nextEvent = Sun.getNextEvent(lat, lng);
            payload.push(nextEvent ? nextEvent.name + ":" + nextEvent.seconds : 'unknown:0');
            payload.push((Sun.isFullMoonVisible(lat, lng)["visible"] === true ? 1 : 0) + "," + (Sun.isDangerousSun(lat, lng)["dangerous"] === true ? 1 : 0));
        } else {
            payload.push('unknown:0');
            payload.push('0,0');
        }

        const userName = localStorage.getItem('userName') || '';
        payload.push(userName);

        const currentTimestamp = Math.floor(Date.now() / 1000);
        const lastTimestamp = parseInt(localStorage.getItem('lastSeen')) || currentTimestamp;
        const timeDiff = currentTimestamp - lastTimestamp;
        localStorage.setItem('lastSeen', currentTimestamp);
        payload.push(lastTimestamp);
        payload.push(timeDiff);

        const lastTopicData = localStorage.getItem('lastTopic');
        let lastTopicTitle = '';
        let lastTopicTimestamp = 0;
        if (lastTopicData) {
            try {
                const topic = JSON.parse(lastTopicData);
                lastTopicTitle = topic.title || '';
                lastTopicTimestamp = topic.timestamp || 0;

                // Display last topic on reconnection
                if (lastTopicTitle && topic.tags) {
                    updateTopicDisplay(lastTopicTitle, topic.tags);
                    if (window.debugLog) window.debugLog('TOPIC: Restored from localStorage: ' + lastTopicTitle, 'topic');
                }
            } catch (e) {
                console.error('Failed to parse lastTopic:', e);
            }
        }
        payload.push(lastTopicTitle);
        payload.push(lastTopicTimestamp);
        const prefLang = localStorage.getItem('prefLang') || 'en';
        payload.push(prefLang);

        const uid = localStorage.getItem('uid') || '0';
        payload.push(uid);

        const payloadString = payload.join("|");
        const utf8Bytes = new TextEncoder().encode(payloadString);
        const binaryString = Array.from(utf8Bytes, byte => String.fromCharCode(byte)).join('');
        const base64 = window.btoa(binaryString)
            .replace(/\//g, '_')
            .replace(/\+/g, '-')
            .replace(/=/g, '');

        const response = await fetch('/api/signed-url/' + base64);
        if (!response.ok)
            throw new Error('Failed to get signed URL');
        const data = await response.json();

        // Store UID from server response in localStorage for persistence
        if (data.uid) {
            localStorage.setItem('uid', data.uid);
            console.log('[UID] Stored UID in localStorage:', data.uid);
            if (window.debugLog) {
                window.debugLog(`UID: Stored ${data.uid}`, 'system');
            }
        }

        return data;
    } catch (error) {
        console.error('Error getting signed URL:', error);
        throw error;
    }
}

function stripXmlTags(text) {
    const regex = /<([a-zA-Z][\w-]*)(\s[^>]*)?>[\s\S]*?<\/\1>|<([a-zA-Z][\w-]*)(\s[^>]*)?\/?>(?![\s\S]*?<\/\3>)/g;
    return text.replace(regex, '').trim();
}
function xmlToJson(xmlStr) {
    const regex = /<([a-zA-Z][\w-]*)(\s[^>]*)?>[\s\S]*?<\/\1>|<([a-zA-Z][\w-]*)(\s[^>]*)?\/?>(?![\s\S]*?<\/\3>)/g;
    const matches = [...xmlStr.matchAll(regex)];

    if (matches.length === 0) {
        console.log("xmlToJson: No XML matches found in string:", xmlStr);
        return [];
    }

    console.log(`xmlToJson: Found ${matches.length} XML tag(s)`);
    const parser = new DOMParser();
    function elementToJson(el) {
        const obj = {};
        const attrs = {};


        for (let i = 0; i < el.attributes.length; i++) {
            const attr = el.attributes[i];
            attrs[attr.name] = attr.value;
        }
        if (Object.keys(attrs).length > 0) {
            obj.attr = attrs;
        }


        const children = Array.from(el.children).map(elementToJson);
        if (children.length > 0) {
            const grouped = {};
            children.forEach(child => {
                const tag = child.tag;
                if (!grouped[tag]) grouped[tag] = [];
                grouped[tag].push(child.attr ? child.attr : child);
            });
            Object.assign(obj, grouped);
        } else if (el.textContent.trim()) {
            obj.text = el.textContent.trim();
        }

        obj.tag = el.tagName;
        return obj;
    }

    const results = [];
    for (const match of matches) {
        let xmlSnippet = match[0];
        console.log("xmlToJson: Parsing snippet:", xmlSnippet);

        const tagMatch = xmlSnippet.match(/^<([a-zA-Z][\w-]*)(\s[^>]*)?>$/);
        if (tagMatch && !xmlSnippet.endsWith('/>') && !xmlSnippet.includes('</')) {
            xmlSnippet = xmlSnippet.replace(/>$/, '/>');
            console.log("xmlToJson: Normalized to:", xmlSnippet);
        }

        const xmlDoc = parser.parseFromString(xmlSnippet, "text/xml");

        const parseError = xmlDoc.querySelector("parsererror");
        if (parseError) {
            console.log("xmlToJson: Parse error for snippet:", xmlSnippet, parseError.textContent);
        } else {
            const jsonResult = elementToJson(xmlDoc.documentElement);
            console.log("xmlToJson: Parsed result:", jsonResult);
            results.push(jsonResult);
        }
    }

    console.log(`xmlToJson: Returning ${results.length} result(s)`);
    return results.length === 1 ? results[0] : results;
}
function UserSilence() {
    if (isHissPlaying) {
        console.log("Hiss is playing, skipping UserSilence");
        return;
    }

    if (masterGainNode && masterGainNode.gain) {
        const currentValue = masterGainNode.gain.value;
        const restoreValue = currentValue === 0 && typeof masterGainStoredValue === 'number'
            ? masterGainStoredValue
            : currentValue;

        masterGainStoredValue = restoreValue;

        if (masterGainRestoreTimer) {
            clearTimeout(masterGainRestoreTimer);
            masterGainRestoreTimer = null;
        }

        masterGainNode.gain.setValueAtTime(0, masterGainNode.context.currentTime);

        masterGainRestoreTimer = setTimeout(() => {
            if (masterGainNode && masterGainNode.gain) {
                const valueToRestore = typeof masterGainStoredValue === 'number' ? masterGainStoredValue : 1;
                masterGainNode.gain.setValueAtTime(valueToRestore, masterGainNode.context.currentTime);
            }
            masterGainRestoreTimer = null;
        }, 1250);
    }
}

async function handleToolCall(cmd, param, text = "") {
    /*
    tool calls from agent via <action cmd="tool-name" param="parameter"/> tag

    Supported tools (server endpoints):
    - web-search
    - get-weather
    - latest-news
    - currency-convert
    - image-search
    - latest-earthquakes
    - poi-search
    - visible-aircraft
    - local-events
    - get-address
    - flight-search
    - author

    Supported tools (client-side):
    - calculator
    - save-location
    - take-note
    - save-name
    - tune-behaviour
    - end-session
    - volume-adjust
    - language-switch
    - pick-card
    - next-card
    - close-card
    - app-search
    - reset

    */

    // Tools that require server calls and should show loading animation
    const serverTools = [
        'web-search', 'get-weather', 'latest-news', 'currency-convert',
        'latest-earthquakes', 'poi-search', 'visible-aircraft',
        'local-events', 'get-address', 'flight-search', 'author'
    ];

    // Start loading animation for server tools
    if (serverTools.includes(cmd)) {
        isToolLoading = true;
        toolLoadingStartTime = Date.now();
        showSubtitle("[working]");
    }

    console.log("Tool called:", cmd, "with param:", param);
    const contextMsg = `<system-reminder>Tool calling: ${cmd} with param: ${param || 'none'}</system-reminder>`;
    if (conversation) {
        await conversation.sendUserMessage(contextMsg);
        if (window.debugLog) window.debugLog(`CONTEXT: ${contextMsg}`, 'system');
    }
    if (window.debugLog) window.debugLog(`TOOL: ${cmd} (${param || 'no param'})`, 'system');
    try {
        let endpoint = '';

        switch (cmd) {
            case 'image-search':
                endpoint = `/api/tool/${cmd}/${encodeURIComponent(param)}`;
                if (window.debugLog) window.debugLog(`TOOL: Fetching ${endpoint}`, 'system');
                var response = await fetch(endpoint);
                if (!response.ok) {
                    throw new Error(`Tool request failed with status ${response.status}`);
                }

                var data = await response.json();
                console.log(data);

                // Load images into gallery animation
                if (data && Array.isArray(data) && data.length > 0) {
                    if (window.imageGallery) {
                        if (window.debugLog) window.debugLog(`GALLERY: Loading ${data.length} images`, 'system');
                        window.imageGallery.loadImages(data);
                        _action.play();
                    }
                }

                /*
                if (conversation) {
                    if (window.debugLog) window.debugLog(`Final tool step: ${cmd}`, 'system');
                    await conversation.sendUserMessage(data);
                    waitingForToolResponse = true;
                    rawData = data;
                }

                if (window.debugLog) window.debugLog(`TOOL: ${cmd} completed successfully`, 'system');
                */
                break;
            case 'poi-search':
                if (text === "") {
                    hiss("tool_call");
                } else {
                    if (window.debugLog) window.debugLog(`TOOL: payload: ` + text, 'system');
                }
                // Format: param should be "query" and we use userCoordinates
                if (userCoordinates && userCoordinates.latitude !== 0 && userCoordinates.longitude !== 0) {
                    const coords = `${userCoordinates.latitude},${userCoordinates.longitude}`;
                    endpoint = `/api/tool/poi-search/${encodeURIComponent(coords)}/${encodeURIComponent(param)}`;
                } else {
                    // Fallback to 0,0 if coordinates not available
                    endpoint = `/api/tool/poi-search/0,0/${encodeURIComponent(param)}`;
                }
                if (window.debugLog) window.debugLog(`TOOL: Fetching ${endpoint}`, 'system');
                var response = await fetch(endpoint);
                if (!response.ok) {
                    throw new Error(`Tool request failed with status ${response.status}`);
                }

                var data = await response.text();

                if (window.debugLog) window.debugLog(`Final tool step: ${cmd}`, 'system');
                await conversation.sendUserMessage(data);
                waitingForToolResponse = true;
                rawData = data;

                if (window.debugLog) window.debugLog(`TOOL: ${cmd} completed successfully`, 'system');

                // Stop loading animation
                isToolLoading = false;
                break;

            case 'web-search':
            case 'get-weather':
            case 'latest-news':
            case 'currency-convert':
            case 'latest-earthquakes':
            case 'music-search':
            case 'visible-aircraft':
            case 'local-events':
            case 'get-address':
            case 'flight-search':
                if (text === "") {
                    hiss("tool_call");
                } else {
                    if (window.debugLog) window.debugLog(`TOOL: payload: ` + text, 'system');
                }
                endpoint = `/api/tool/${cmd}/${encodeURIComponent(param)}`;
                if (window.debugLog) window.debugLog(`TOOL: Fetching ${endpoint}`, 'system');
                var response = await fetch(endpoint);
                if (!response.ok) {
                    throw new Error(`Tool request failed with status ${response.status}`);
                }

                var data = await response.text();
                if (conversation) {
                    if (window.debugLog) window.debugLog(`Final tool step: ${cmd}`, 'system');
                    await conversation.sendUserMessage('<system-reminder>' + data + "</system-reminder>");
                    waitingForToolResponse = true;
                    rawData = data;
                }

                if (window.debugLog) window.debugLog(`TOOL: ${cmd} completed successfully`, 'system');

                // Stop loading animation
                isToolLoading = false;
                break;

            case 'author':
                console.log("Author:", param);
                if (window.debugLog) window.debugLog(`TOOL: author - Generating content for "${param}"`, 'system');
                try {
                    if (text === "") {
                        hiss("tool_call");
                    } else {
                        if (window.debugLog) window.debugLog(`TOOL: payload: ` + text, 'system');
                    }
                    endpoint = `/api/tool/author/${encodeURIComponent(param)}`;
                    if (window.debugLog) window.debugLog(`TOOL: Fetching ${endpoint}`, 'system');
                    const authorResponse = await fetch(endpoint);
                    if (!authorResponse.ok) {
                        throw new Error(`Author tool request failed with status ${authorResponse.status}`);
                    }

                    const authorData = await authorResponse.text();
                    if (conversation) {
                        if (window.debugLog) window.debugLog(`TOOL: author completed successfully`, 'system');
                        await conversation.sendUserMessage(authorData);

                        // Set flag to catch next AI response
                        waitingForToolResponse = true;
                    }
                } catch (error) {
                    console.error("Author error:", error);
                    if (window.debugLog) window.debugLog(`TOOL: author error - ${error.message}`, 'system');
                    if (conversation) {
                        await conversation.sendUserMessage("Content generation error: " + error.message);
                    }
                }
                break;

            case 'calculator':
                console.log("Calculator:", param);
                if (window.debugLog) window.debugLog(`TOOL: calculator - Evaluating "${param}"`, 'system');
                try {
                    const result = evaluate(param);
                    const resultStr = String(result);
                    if (window.debugLog) window.debugLog(`TOOL: calculator result - ${resultStr}`, 'system');
                    if (conversation) {
                        await conversation.sendUserMessage(resultStr);
                    }
                    if (window.debugLog) window.debugLog(`TOOL: calculator completed successfully`, 'system');
                } catch (error) {
                    console.error("Calculator error:", error);
                    if (window.debugLog) window.debugLog(`TOOL: calculator error - ${error.message}`, 'system');
                    if (conversation) {
                        await conversation.sendUserMessage("Calculation error: " + error.message);
                    }
                }
                break;

            case 'save-location':
                console.log("Save location:", param);
                if (window.debugLog) window.debugLog(`TOOL: save-location - Creating KML file for "${param}"`, 'system');
                const kmlContent = `<?xml version="1.0" encoding="UTF-8"?>
                <kml xmlns="http://www.opengis.net/kml/2.2">
                <Document>
                    <name>Saved Locations</name>
                    <Placemark>
                    <name>${param}</name>
                    <description>Saved on ${new Date().toLocaleDateString()} at ${new Date().toLocaleTimeString()}</description>
                    <Point>
                        <coordinates>${userCoordinates ? userCoordinates.longitude : 0},${userCoordinates ? userCoordinates.latitude : 0},0</coordinates>
                    </Point>
                    </Placemark>
                </Document>
                </kml>`;
                const kmlBlob = new Blob([kmlContent], { type: 'application/vnd.google-earth.kml+xml' });
                const kmlUrl = URL.createObjectURL(kmlBlob);
                const kmlLink = document.createElement('a');
                kmlLink.href = kmlUrl;
                var kfilename = `${param.replace(/[^a-z0-9]/gi, '_')}.kml`;
                kmlLink.download = kfilename;
                document.body.appendChild(kmlLink);
                kmlLink.click();
                document.body.removeChild(kmlLink);
                showNotification("Location saved", "Coordinates saved as " + kfilename);
                setTimeout(() => URL.revokeObjectURL(kmlUrl), 100);
                if (window.debugLog) window.debugLog(`TOOL: save-location completed - Downloaded ${param}.kml`, 'system');
                break;
            case 'take-note':
                console.log("Take note:", param);
                if (window.debugLog) window.debugLog(`TOOL: take-note - Creating note file`, 'system');

                // Parse param: "title|content"
                const parts = param.split('|');
                let noteTitle, noteContentText;

                if (parts.length === 2) {
                    // New format with title
                    noteTitle = parts[0].trim();
                    noteContentText = parts[1].trim();
                } else {
                    // Old format (backward compatibility)
                    noteTitle = 'note';
                    noteContentText = param;
                }

                // Create note content with title as header
                const noteContent = `# ${noteTitle.replace(/_/g, ' ')}\n\n${noteContentText}\n\n---\n\nSaved on ${new Date().toLocaleString()}\n`;
                const noteBlob = new Blob([noteContent], { type: 'text/markdown' });
                const noteUrl = URL.createObjectURL(noteBlob);
                const noteLink = document.createElement('a');
                noteLink.href = noteUrl;
                noteLink.download = `${noteTitle}.md`;
                showNotification(noteLink.download, "Note saved to disk");
                document.body.appendChild(noteLink);
                noteLink.click();
                document.body.removeChild(noteLink);
                setTimeout(() => URL.revokeObjectURL(noteUrl), 100);
                _action.play();
                if (window.debugLog) window.debugLog(`TOOL: take-note completed - Downloaded ${noteTitle}.md`, 'system');
                break;
            case 'save-name':
                console.log("Save name:", param);
                if (window.debugLog) window.debugLog(`TOOL: save-name - Saving name "${param}" to localStorage`, 'system');
                localStorage.setItem('userName', param);
                if (window.debugLog) window.debugLog(`TOOL: save-name completed`, 'system');
                conversation.sendContextualUpdate("User change his name to: " + param + " call him by this name from now on");
                showNotification("User name changed", "Name changed to " + param);
                break;
            case 'tune-behaviour':
                console.log("Tune behaviour:", param);
                if (window.debugLog) window.debugLog(`TOOL: tune-behaviour - Processing behaviour tuning request`, 'system');
                try {
                    // Parse the param which should be in format: "category|user_request|user_transcript"
                    const parts = param.split('|');
                    if (parts.length !== 3) {
                        console.error("Invalid tune-behaviour param format. Expected: category|user_request|user_transcript");
                        if (window.debugLog) window.debugLog(`TOOL: tune-behaviour - Invalid format`, 'system');
                        break;
                    }

                    const [category, user_request, user_transcript] = parts;

                    // Send POST request to server
                    const response = await fetch('/api/tool/tune-behaviour', {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json'
                        },
                        body: JSON.stringify({
                            category: category.trim(),
                            user_request: user_request.trim(),
                            user_transcript: user_transcript.trim()
                        })
                    });

                    if (!response.ok) {
                        throw new Error(`Tune-behaviour request failed with status ${response.status}`);
                    }

                    const result = await response.json();
                    console.log('[TUNE-BEHAVIOUR] Response:', result);
                    if (window.debugLog) window.debugLog(`TOOL: tune-behaviour completed - ${result.message}`, 'system');

                    // Show notification to user
                    showNotification("Behaviour Updated", "Your preference has been recorded");
                    _action.play();

                    // Send confirmation back to agent
                    if (conversation) {
                        conversation.sendContextualUpdate("User's behaviour tuning request has been recorded successfully.");
                    }

                } catch (error) {
                    console.error("Tune-behaviour error:", error);
                    if (window.debugLog) window.debugLog(`TOOL: tune-behaviour error - ${error.message}`, 'system');
                }
                break;
            case 'pick-card':
                if (window.debugLog) window.debugLog(`TOOL: pick-card - Attempting to pick random image from gallery`, 'system');
                if (window.imageGallery && window.imageGallery.pickRandomCard) {
                    const result = window.imageGallery.pickRandomCard();
                    if (result.success) {
                        _action.play();
                        if (window.debugLog) window.debugLog(`TOOL: pick-card completed - ${result.comment}`, 'system');

                        // Send the personal comment back to the conversation
                        if (conversation) {
                            conversation.sendContextualUpdate(`Image selected. Respond with: "${result.comment}"`);
                        }
                    } else {
                        if (window.debugLog) window.debugLog(`TOOL: pick-card failed - No images available`, 'system');
                    }
                } else {
                    if (window.debugLog) window.debugLog(`TOOL: pick-card failed - Gallery not available`, 'system');
                }
                break;
            case 'close-card':
                if (window.debugLog) window.debugLog(`TOOL: close-card - Attempting to close image modal`, 'system');
                if (window.imageGallery && window.imageGallery.closeImageModal) {
                    window.imageGallery.closeImageModal();
                    if (window.debugLog) window.debugLog(`TOOL: close-card completed - Modal closed`, 'system');
                } else {
                    if (window.debugLog) window.debugLog(`TOOL: close-card failed - Gallery not available`, 'system');
                }
                break;
            case 'volume-adjust':
                if (window.debugLog) window.debugLog(`TOOL: volume-adjust - Direction: ${param}`, 'system');
                if (window.setMasterVolume && window.getMasterVolume) {
                    const currentVolume = window.getMasterVolume();
                    const maxVolume = 6.0;
                    const adjustment = maxVolume * 0.1; // 10% of max range

                    let newVolume;
                    if (param === 'up') {
                        newVolume = Math.min(maxVolume, currentVolume + adjustment);
                        if (window.debugLog) window.debugLog(`TOOL: volume-adjust - Increasing from ${currentVolume.toFixed(2)} to ${newVolume.toFixed(2)}`, 'system');
                    } else if (param === 'down') {
                        newVolume = Math.max(0.0, currentVolume - adjustment);
                        if (window.debugLog) window.debugLog(`TOOL: volume-adjust - Decreasing from ${currentVolume.toFixed(2)} to ${newVolume.toFixed(2)}`, 'system');
                    } else {
                        if (window.debugLog) window.debugLog(`TOOL: volume-adjust - Invalid parameter: ${param}`, 'system');
                        break;
                    }

                    window.setMasterVolume(newVolume);
                    _action.play();

                    // Show volume bar for 5 seconds
                    if (window.showVolumeBar) {
                        window.showVolumeBar();
                    }

                    if (window.debugLog) window.debugLog(`TOOL: volume-adjust completed - New volume: ${newVolume.toFixed(2)}`, 'system');
                } else {
                    if (window.debugLog) window.debugLog(`TOOL: volume-adjust failed - Volume control not available`, 'system');
                }
                break;
            case 'next-card':
                if (window.debugLog) window.debugLog(`TOOL: next-card - Checking modal state`, 'system');

                // Check if modal is closed and images are visible on screen
                const modal = document.getElementById('imageModal');
                const isModalOpen = modal && modal.classList.contains('show');

                if (!isModalOpen && window.imageGallery && window.imageGallery.hasVisibleImages && window.imageGallery.hasVisibleImages()) {
                    // Modal is closed but images are visible - treat as pick-card
                    if (window.debugLog) window.debugLog(`TOOL: next-card - Modal closed, treating as pick-card`, 'system');
                    if (window.imageGallery.pickRandomCard) {
                        const result = window.imageGallery.pickRandomCard();
                        if (result.success) {
                            _action.play();
                            if (window.debugLog) window.debugLog(`TOOL: next-card (as pick-card) completed - ${result.comment}`, 'system');

                            // Send the personal comment back to the conversation
                            if (conversation) {
                                conversation.sendContextualUpdate(`Image selected. Respond with: "${result.comment}"`);
                            }
                        }
                    }
                } else if (isModalOpen && window.imageGallery && window.imageGallery.showNextImage) {
                    // Modal is open - show next image
                    if (window.debugLog) window.debugLog(`TOOL: next-card - Modal open, showing next image`, 'system');
                    window.imageGallery.showNextImage();
                    if (window.debugLog) window.debugLog(`TOOL: next-card completed - Showing next image`, 'system');
                } else {
                    if (window.debugLog) window.debugLog(`TOOL: next-card failed - Gallery not available or no images`, 'system');
                }
                break;
            case 'app-search':
                if (window.debugLog) window.debugLog(`TOOL: app-search - Searching for app: ${param}`, 'system');
                try {
                    let platform = '';
                    let appName = param;

                    // Check if platform is explicitly specified (format: "platform:appname")
                    if (param.includes(':')) {
                        const parts = param.split(':');
                        platform = parts[0].toLowerCase();
                        appName = parts.slice(1).join(':').trim();
                    } else {
                        // Auto-detect platform from user agent
                        const ua = navigator.userAgent.toLowerCase();
                        if (ua.includes('android')) {
                            platform = 'android';
                        } else if (ua.includes('iphone') || ua.includes('ipad') || ua.includes('macintosh') || ua.includes('mac os')) {
                            platform = 'apple';
                        } else if (ua.includes('windows')) {
                            platform = 'windows';
                        } else if (ua.includes('linux') || ua.includes('ubuntu') || ua.includes('debian')) {
                            platform = 'linux';
                        } else {
                            // Default to Android if unable to detect
                            platform = 'android';
                        }
                    }

                    // Build appropriate store URL
                    let storeUrl;
                    switch (platform) {
                        case 'android':
                            storeUrl = `https://play.google.com/store/search?q=${encodeURIComponent(appName)}&c=apps`;
                            break;
                        case 'apple':
                            storeUrl = `https://www.apple.com/search/${encodeURIComponent(appName)}?src=globalnav`;
                            break;
                        case 'windows':
                            storeUrl = `https://apps.microsoft.com/search?query=${encodeURIComponent(appName)}&hl=en-US&gl=US`;
                            break;
                        case 'linux':
                            storeUrl = `https://snapcraft.io/store?q=${encodeURIComponent(appName)}`;
                            break;
                        default:
                            storeUrl = `https://play.google.com/store/search?q=${encodeURIComponent(appName)}&c=apps`;
                    }

                    if (window.debugLog) window.debugLog(`TOOL: app-search - Platform: ${platform}, URL: ${storeUrl}`, 'system');

                    // Open store URL in new window
                    const a = document.createElement('a');
                    a.href = storeUrl;
                    a.target = '_blank';
                    a.rel = 'noopener noreferrer';
                    document.body.appendChild(a);
                    a.click();
                    document.body.removeChild(a);

                    _action.play();

                    const contextMsg = `User searched for ${appName} app on ${platform} store`;
                    if (conversation) {
                        conversation.sendContextualUpdate(contextMsg);
                        if (window.debugLog) window.debugLog(`CONTEXT: ${contextMsg}`, 'system');
                    }

                    if (window.debugLog) window.debugLog(`TOOL: app-search completed`, 'system');
                } catch (error) {
                    console.error("App search error:", error);
                    if (window.debugLog) window.debugLog(`TOOL: app-search error - ${error.message}`, 'system');
                }
                break;
            case 'end-session':
                if (window.debugLog) window.debugLog(`TOOL: end-session - Ending conversation session`, 'system');
                console.log("Ending session");
                localStorage.removeItem('lastTopic');

                // Fade out gallery images on session end
                if (window.imageGallery) {
                    window.imageGallery.fadeOutSequentially();
                }

                if (conversation) {
                    // Mark as user-initiated disconnect (agent decided to end session)
                    window.userRequestedDisconnect = true;
                    setTimeout(function () {
                        conversation.endSession();
                    }, 3000);
                }
                if (window.debugLog) window.debugLog(`TOOL: end-session completed`, 'system');
                break;
            case 'language-switch':
                if (window.debugLog) window.debugLog(`TOOL: language-switch - Requested language: ${param}`, 'system');
                console.log("Language switch requested:", param);

                // Available languages
                const availableLanguages = ['en', 'de', 'es', 'tr'];

                if (!availableLanguages.includes(param)) {
                    if (window.debugLog) window.debugLog(`TOOL: language-switch - Language "${param}" not available`, 'system');
                    // Language not available - agent should respond with error message
                    // The agent will see this in the tool call context and respond accordingly
                    break;
                }

                // Language is available
                if (window.debugLog) window.debugLog(`TOOL: language-switch - Switching to "${param}"`, 'system');

                // Wait 2 seconds to finish talking, then set localStorage and reload
                setTimeout(() => {
                    localStorage.setItem('prefLang', param);
                    if (window.debugLog) window.debugLog(`TOOL: language-switch - Set prefLang to "${param}", reloading page`, 'system');
                    window.location.reload();
                }, 2000);

                if (window.debugLog) window.debugLog(`TOOL: language-switch completed - Will reload in 2 seconds`, 'system');
                break;
            default:
                console.log("Unknown tool:", cmd);
                if (window.debugLog) window.debugLog(`TOOL: Unknown tool "${cmd}"`, 'system');
                return;
        }

    } catch (error) {
        console.error("Tool call error:", error);
        if (window.debugLog) window.debugLog(`TOOL: Error - ${error.message}`, 'system');
    } finally {
        // Always stop loading animation when tool call completes (success or error)
        if (isToolLoading) {
            isToolLoading = false;
            toolLoadingSpeedMultiplier = 1;
        }
    }
}

function handleLink(href, title, target) {
    console.log("Opening link:", href, title, target);
    const contextMsg = `User opened link: ${title || href}`;
    if (conversation) {
        conversation.sendContextualUpdate(contextMsg);
        if (window.debugLog) window.debugLog(`CONTEXT: ${contextMsg}`, 'system');
    }
    if (window.debugLog) window.debugLog(`ACTION: Opening link - ${href}`, 'system');
    const a = document.createElement("a");
    a.href = href;
    a.target = "_blank";
    a.rel = "noopener noreferrer";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    _action.play();
}

function handleFile(file) {
    console.log("Handling file:", file);

    if (!file.attr || !file.attr.type || !file.attr.name) {
        console.error("Invalid file data:", file);
        if (window.debugLog) window.debugLog(`ACTION: Invalid file data`, 'system');
        return;
    }

    const mimeType = file.attr.type;
    const fileName = file.attr.name;

    // Get content from attribute and convert pipe characters to newlines
    let content = file.attr.content || file.text || '';

    // Convert pipe character to newline
    content = content.replace(/\|/g, '\n');

    const contextMsg = `User downloaded file: ${fileName}`;
    if (conversation) {
        conversation.sendContextualUpdate(contextMsg);
        if (window.debugLog) window.debugLog(`CONTEXT: ${contextMsg}`, 'system');
    }
    if (window.debugLog) window.debugLog(`ACTION: Creating file - ${fileName} (${mimeType})`, 'system');

    showNotification(fileName, "File saved to disk");
    const blob = new Blob([content], { type: mimeType });
    const blobUrl = URL.createObjectURL(blob);

    const a = document.createElement('a');
    a.href = blobUrl;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => {
        URL.revokeObjectURL(blobUrl);
    }, 100);

    if (window.debugLog) window.debugLog(`ACTION: File downloaded - ${fileName}`, 'system');
}

function handleTopic(topic) {
    console.log("Topic metadata:", topic);

    if (topic.title) {
        if (window.debugLog) window.debugLog(`ACTION: Topic - ${topic.title}`, 'system');
        const topicData = {
            title: topic.title,
            category: topic.category || '',
            tags: topic.tags || '',
            timestamp: Date.now()
        };
        localStorage.setItem('lastTopic', JSON.stringify(topicData));

        // Send topic back to agent as system reminder
        if (conversation) {
            const contextMsg = `<system-reminder>The topic is now: ${topic.title}</system-reminder>`;
            conversation.sendContextualUpdate(contextMsg);
            console.log('[TOPIC] Sent topic update to agent:', contextMsg);
            if (window.debugLog) window.debugLog(`CONTEXT: ${contextMsg}`, 'system');
        }

        // Fade out gallery images when new topic is received
        if (window.imageGallery) {
            window.imageGallery.fadeOutSequentially();
        }

        // Show category indicator
        if (topic.category) {
            showCategoryIndicator(topic.category);
        }

        // Update topic display
        updateTopicDisplay(topic.title, topic.tags || '');
    }
}

function handleCodeExecution(tag) {
    console.log("Code execution requested:", tag);

    // Get code from content attribute (preferred) or text content (fallback)
    const code = (tag.attr && tag.attr.content) || tag.text || '';

    if (!code || code.trim().length === 0) {
        console.error("No code provided for execution");
        if (window.debugLog) window.debugLog('CODE: No code provided', 'system');
        if (conversation) {
            conversation.sendUserMessage('<system-reminder>Code execution failed: No code provided</system-reminder>');
        }
        return;
    }

    if (window.debugLog) window.debugLog(`CODE: Executing code (${code.length} chars)`, 'system');

    let result;
    let error = null;

    try {
        // Create an isolated execution context
        // We'll use an IIFE to capture console output and return value
        const isolatedCode = `
            (function() {
                const consoleLogs = [];
                const originalConsoleLog = console.log;
                const originalConsoleError = console.error;
                const originalConsoleWarn = console.warn;

                console.log = function(...args) {
                    consoleLogs.push({type: 'log', args: args});
                    originalConsoleLog.apply(console, args);
                };
                console.error = function(...args) {
                    consoleLogs.push({type: 'error', args: args});
                    originalConsoleError.apply(console, args);
                };
                console.warn = function(...args) {
                    consoleLogs.push({type: 'warn', args: args});
                    originalConsoleWarn.apply(console, args);
                };

                try {
                    const result = (function() {
                        ${code}
                    })();

                    console.log = originalConsoleLog;
                    console.error = originalConsoleError;
                    console.warn = originalConsoleWarn;

                    return {
                        success: true,
                        result: result,
                        logs: consoleLogs
                    };
                } catch (e) {
                    console.log = originalConsoleLog;
                    console.error = originalConsoleError;
                    console.warn = originalConsoleWarn;

                    return {
                        success: false,
                        error: e.message,
                        stack: e.stack,
                        logs: consoleLogs
                    };
                }
            })()
        `;

        // Execute the isolated code
        const executionResult = eval(isolatedCode);

        if (executionResult.success) {
            result = executionResult.result;

            // Format the result
            let resultStr = '';

            if (executionResult.logs.length > 0) {
                resultStr += 'Console output:\n';
                executionResult.logs.forEach(log => {
                    const args = log.args.map(arg => {
                        if (typeof arg === 'object') {
                            try {
                                return JSON.stringify(arg);
                            } catch (e) {
                                return String(arg);
                            }
                        }
                        return String(arg);
                    }).join(' ');
                    resultStr += `[${log.type}] ${args}\n`;
                });
                resultStr += '\n';
            }

            if (result !== undefined) {
                resultStr += 'Return value: ';
                if (typeof result === 'object') {
                    try {
                        resultStr += JSON.stringify(result, null, 2);
                    } catch (e) {
                        resultStr += String(result);
                    }
                } else {
                    resultStr += String(result);
                }
            } else {
                resultStr += 'Code executed successfully (no return value)';
            }

            console.log('Code execution result:', resultStr);
            if (window.debugLog) window.debugLog(`CODE: Execution successful`, 'system');

            if (conversation) {
                conversation.sendUserMessage(`<system-reminder>here is the result of code tool:\n${resultStr}</system-reminder>`);
            }
        } else {
            error = executionResult.error;
            const errorMsg = `Code execution error: ${error}`;
            console.error(errorMsg);
            if (window.debugLog) window.debugLog(`CODE: Execution failed - ${error}`, 'system');

            if (conversation) {
                conversation.sendUserMessage(`<system-reminder>here is the result of code tool: Error - ${error}</system-reminder>`);
            }
        }
    } catch (e) {
        error = e.message;
        const errorMsg = `Code execution error: ${error}`;
        console.error(errorMsg, e);
        if (window.debugLog) window.debugLog(`CODE: Execution failed - ${error}`, 'system');

        if (conversation) {
            conversation.sendUserMessage(`<system-reminder>here is the result of code tool: Error - ${error}</system-reminder>`);
        }
    }
}

function updateTopicDisplay(title, tags) {
    const topicTitle = document.getElementById('topicTitle');
    const topicTags = document.getElementById('topicTags');

    if (topicTitle) {
        topicTitle.textContent = title;
    }

    if (topicTags) {
        topicTags.innerHTML = '';

        if (tags) {
            const tagArray = tags.split(',').map(tag => tag.trim()).filter(tag => tag.length > 0);
            tagArray.forEach(tag => {
                const tagElement = document.createElement('span');
                tagElement.className = 'topic-tag';
                tagElement.textContent = tag;

                // Assign colorful backgrounds based on tag hash
                const hue = (tag.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0) * 137.5) % 360;
                tagElement.style.backgroundColor = `hsl(${hue}, 70%, 50%)`;
                tagElement.style.color = '#ffffff';

                topicTags.appendChild(tagElement);
            });
        }
    }
}

function clearTopicDisplay() {
    const topicTitle = document.getElementById('topicTitle');
    const topicTags = document.getElementById('topicTags');

    if (topicTitle) {
        topicTitle.textContent = '';
    }

    if (topicTags) {
        topicTags.innerHTML = '';
    }
}

function showCategoryIndicator(category) {
    // Remove existing indicator if present
    let indicator = document.getElementById('categoryIndicator');
    if (!indicator) {
        indicator = document.createElement('div');
        indicator.id = 'categoryIndicator';
        document.body.appendChild(indicator);
    }

    // Set category text and show (stays visible permanently)
    indicator.textContent = category;
    indicator.classList.add('show');
}

async function hiss(cat = "tool_call") {
    try {
        isHissPlaying = true;

        const response = await fetch('/api/sentence/' + cat + "/" + localStorage.getItem('prefLang'));
        const audioData = await response.arrayBuffer();
        const audioBuffer = await conversation.output.context.decodeAudioData(audioData);

        const source = conversation.output.context.createBufferSource();
        source.buffer = audioBuffer;

        // Create temporary gain nodes for this sound effect only
        const tempWetGain = conversation.output.context.createGain();
        const tempDryGain = conversation.output.context.createGain();
        const tempMixGain = conversation.output.context.createGain();

        // Start with zero gain to prevent clicks
        const currentTime = conversation.output.context.currentTime;
        tempWetGain.gain.setValueAtTime(0, currentTime);
        tempDryGain.gain.setValueAtTime(0, currentTime);
        tempMixGain.gain.setValueAtTime(0, currentTime);

        // Ramp up to target values over 10ms to prevent interference
        tempWetGain.gain.linearRampToValueAtTime(0.3, currentTime + 0.01);
        tempDryGain.gain.linearRampToValueAtTime(0.7, currentTime + 0.01);
        tempMixGain.gain.linearRampToValueAtTime(0.5, currentTime + 0.01);

        // Create a temporary convolver for this effect
        const tempConvolver = conversation.output.context.createConvolver();
        tempConvolver.buffer = impulse;

        // Connect source to both dry and wet paths
        source.connect(tempDryGain);
        source.connect(tempConvolver);
        tempConvolver.connect(tempWetGain);

        // Mix both paths
        tempWetGain.connect(tempMixGain);
        tempDryGain.connect(tempMixGain);

        // Connect to the master gain node (parallel to main audio)
        tempMixGain.connect(masterGainNode);

        // Reset flag when audio ends
        source.onended = () => {
            isHissPlaying = false;
        };

        source.start(0);
    } catch (error) {
        console.error("Error playing tool call audio:", error);
        isHissPlaying = false;
        _talk.play();
    }
}

async function startConversation() {
    try {
        console.log('[CONNECTION] Starting conversation initialization...');
        if (window.debugLog) window.debugLog('CONNECTION: Starting conversation initialization', 'system');

        const tools = await initializeTools();
        console.log('[CONNECTION] Tools initialized:', tools);
        console.log('[CONNECTION] Signed URL present:', !!tools.signedUrl);
        console.log('[CONNECTION] Signed URL length:', tools.signedUrl ? tools.signedUrl.length : 0);
        console.log('[CONNECTION] System prompt present:', !!tools.system);
        console.log('[CONNECTION] First message:', tools.firstMessage);

        // Store drift reminder
        driftReminder = tools.drift;
        if (window.debugLog && driftReminder) {
            window.debugLog('DRIFT: Drift reminder loaded', 'system');
        }

        console.log('[CONNECTION] Creating Conversation.startSession...');
        if (window.debugLog) window.debugLog('CONNECTION: Creating Conversation.startSession', 'system');

        // Get preferred language from localStorage
        const prefLang = localStorage.getItem('prefLang') || 'en';

        const sessionStartTime = Date.now();
        conversation = await Conversation.startSession({
            connectionType: 'websocket',
            signedUrl: tools.signedUrl,
            overrides: {
                agent: {
                    prompt: {
                        prompt: tools.system
                    },
                    firstMessage: tools.firstMessage,
                    language: prefLang
                },
                tts: {
                    voice_id: tools.voiceId
                }
            },
            onConnect: () => {
                const connectionTime = Date.now() - sessionStartTime;
                console.log('[CONNECTION] Connected successfully!');
                console.log('[CONNECTION] Connection established in', connectionTime, 'ms');
                if (window.debugLog) {
                    window.debugLog('EVENT: Connected', 'system');
                    window.debugLog(`CONNECTION: Established in ${connectionTime}ms`, 'system');
                }
                connected = true;
                conversationStartTime = Date.now();
                _join.play();
                hideDisconnectionBox();

                // Show call control buttons
                const callControls = document.getElementById('callControls');
                if (callControls) {
                    callControls.classList.add('connected');
                }

                // Enable volume bar
                const volumeCanvas = document.getElementById('volumeCanvas');
                if (volumeCanvas) {
                    volumeCanvas.classList.add('connected');
                }

                // Enable topic display and clear it
                const topicDisplay = document.getElementById('topicDisplay');
                if (topicDisplay) {
                    topicDisplay.classList.add('connected');
                }
                clearTopicDisplay();

                // Start coordinate monitoring
                startCoordinateMonitoring();

                // Fetch user's address in background when conversation starts
                if (userCoordinates &&
                    userCoordinates.latitude !== null &&
                    userCoordinates.longitude !== null &&
                    userCoordinates.latitude !== 0 &&
                    userCoordinates.longitude !== 0) {

                    const coords = `${userCoordinates.latitude},${userCoordinates.longitude}`;
                    console.log(`[ADDRESS] Fetching address for coordinates: ${coords}`);
                    if (window.debugLog) {
                        window.debugLog(`ADDRESS: Fetching address for ${coords}`, 'system');
                    }

                    fetch(`/api/tool/get-address/${encodeURIComponent(coords)}`)
                        .then(response => response.text())
                        .then(data => {
                            // Parse the tool response to extract the address
                            try {
                                // The response format is from formatToolResponse in server.js
                                // It includes command, parameter, and result in a structured format
                                const addressMatch = data.match(/"formatted_address":\s*"([^"]+)"/);
                                if (addressMatch && addressMatch[1]) {
                                    const address = addressMatch[1];

                                    // Validate address (string, not empty, at least 10 characters)
                                    if (typeof address === 'string' &&
                                        address.trim().length >= 10 &&
                                        address !== 'null' &&
                                        address !== 'undefined') {
                                        const contextMsg = `<system-reminder>User's current location is changed to: ${address}. Use this address on your location based tool calls.</system-reminder>`;
                                        if (conversation) {
                                            conversation.sendUserMessage(contextMsg);
                                            console.log(`[ADDRESS] Location update sent: ${address}`);
                                            if (window.debugLog) {
                                                window.debugLog(`ADDRESS: Location updated - ${address}`, 'system');
                                            }
                                        }
                                    } else {
                                        console.log(`[ADDRESS] Invalid address received (too short or empty): "${address}"`);
                                        if (window.debugLog) {
                                            window.debugLog(`ADDRESS: Invalid address (too short)`, 'system');
                                        }
                                    }
                                } else {
                                    console.log(`[ADDRESS] Could not extract address from response`);
                                    if (window.debugLog) {
                                        window.debugLog(`ADDRESS: Failed to parse address`, 'system');
                                    }
                                }
                            } catch (error) {
                                console.error(`[ADDRESS] Error parsing address response:`, error);
                                if (window.debugLog) {
                                    window.debugLog(`ADDRESS: Error - ${error.message}`, 'system');
                                }
                            }
                        })
                        .catch(error => {
                            console.error(`[ADDRESS] Error fetching address:`, error);
                            if (window.debugLog) {
                                window.debugLog(`ADDRESS: Fetch error - ${error.message}`, 'system');
                            }
                        });
                } else {
                    console.log(`[ADDRESS] Skipping address fetch - invalid coordinates:`, userCoordinates);
                    if (window.debugLog) {
                        window.debugLog(`ADDRESS: Skipped - coordinates invalid or zero`, 'system');
                    }
                }

                // Dispatch custom event for touch UI
                window.dispatchEvent(new Event('agent-connected'));
            },
            onDisconnect: () => {
                agentTalking = false;
                connected = false;
                const sessionDuration = conversationStartTime ? Date.now() - conversationStartTime : 0;
                console.log('[CONNECTION] Disconnected');
                console.log('[CONNECTION] Session duration:', Math.floor(sessionDuration / 1000), 'seconds');
                console.log('[CONNECTION] User requested disconnect:', window.userRequestedDisconnect);
                if (window.debugLog) {
                    window.debugLog('EVENT: Disconnected', 'system');
                    window.debugLog(`CONNECTION: Session lasted ${Math.floor(sessionDuration / 1000)}s`, 'system');
                    window.debugLog(`CONNECTION: User initiated: ${window.userRequestedDisconnect}`, 'system');
                }
                flush();
                subtitle.innerHTML = "[agent disconnected]";
                setTimeout(function () {
                    subtitle.innerHTML = "";
                }, 1000);
                _leave.play();

                // Stop coordinate monitoring
                stopCoordinateMonitoring();

                // Fade out gallery images on disconnect
                if (window.imageGallery) {
                    window.imageGallery.fadeOutSequentially();
                }

                // Hide call control buttons
                const callControls = document.getElementById('callControls');
                if (callControls) {
                    callControls.classList.remove('connected');
                }

                // Disable volume bar
                const volumeCanvas = document.getElementById('volumeCanvas');
                if (volumeCanvas) {
                    volumeCanvas.classList.remove('connected');
                }

                // Disable topic display and clear it
                const topicDisplay = document.getElementById('topicDisplay');
                if (topicDisplay) {
                    topicDisplay.classList.remove('connected');
                }
                clearTopicDisplay();

                // Dispatch custom event for touch UI
                window.dispatchEvent(new Event('agent-disconnected'));

                // Close text input window on disconnect
                const textWindow = document.getElementById('textInputWindow');
                if (textWindow) {
                    textWindow.style.display = 'none';
                }

                // Auto-reconnect if disconnect was not user-initiated
                if (!window.userRequestedDisconnect) {
                    console.log('[CONNECTION] Unexpected disconnect detected, attempting auto-reconnect in 2 seconds...');
                    if (window.debugLog) {
                        window.debugLog('CONNECTION: Auto-reconnecting...', 'system');
                    }
                    subtitle.innerHTML = "[reconnecting]";
                    setTimeout(async () => {
                        try {
                            await reconnectAgent();
                        } catch (error) {
                            console.error('[CONNECTION] Auto-reconnect failed:', error);
                            if (window.debugLog) {
                                window.debugLog('CONNECTION: Auto-reconnect failed', 'system');
                            }
                            showDisconnectionBox();
                        }
                    }, 2000);
                } else {
                    // User initiated disconnect, show manual reconnect option
                    showDisconnectionBox();
                    window.userRequestedDisconnect = false; // Reset for next time
                }
            },
            onError: (error) => {
                console.error('[CONNECTION] Conversation error:', error);
                console.error('[CONNECTION] Error type:', typeof error);
                console.error('[CONNECTION] Error keys:', error ? Object.keys(error) : 'null');
                console.error('[CONNECTION] Error reason:', error?.reason);
                console.error('[CONNECTION] Error message:', error?.message);
                console.error('[CONNECTION] Error code:', error?.code);
                if (window.debugLog) {
                    window.debugLog('EVENT: Error - ' + (error.reason || error.message || 'Unknown error'), 'system');
                }
                _err.play();
                hideDisconnectionBox();
                flush();
                subtitle.innerHTML = "[error occurred]";
                if (error.reason) {
                    subtitle.innerHTML = "[" + error.reason + "]";
                }
                connected = false;
            },
            onModeChange: (m) => {
                if (m.mode === "speaking") {
                    agentTalking = true;
                } else {
                    agentTalking = false;
                    // Don't clear subtitle here - let the fade-out logic handle it
                }
            },
            onMessage: (m) => {

                if (window.debugLog) {
                    if (m.source === "ai") {
                        window.debugLog('AI: ' + m.message, 'ai');
                    } else if (m.source === "user") {
                        window.debugLog('USER: ' + m.message, 'user');
                    }
                }

                if (m.source === "ai") {
                    aiResponseCount++;
                    const elapsedTime = Date.now() - conversationStartTime;

                    // Check if we're waiting for a tool response
                    if (waitingForToolResponse === true) {
                        waitingForToolResponse = false;
                        const cleanResponse = stripXmlTags(m.message);
                        const contextMsg = `You just responded to tool call with this answer: ${cleanResponse}. Raw data was: ${rawData} Use this information to handle next followup request from user, don't ask extra questions use first available item from this list.`;
                        if (conversation) {
                            conversation.sendContextualUpdate(contextMsg);
                            if (window.debugLog) window.debugLog(`CONTEXT: Tool response captured for followup context`, 'system');
                        }
                    }

                    if (conversation && driftReminder &&
                        aiResponseCount % DRIFT_REMINDER_INTERVAL === 0 &&
                        elapsedTime >= DRIFT_REMINDER_DELAY) {
                        conversation.sendUserMessage('<system-reminder>' + driftReminder + '</system-reminder>');
                        if (window.debugLog) {
                            window.debugLog(`DRIFT: Sent reminder (response #${aiResponseCount})`, 'system');
                        }
                    }

                    var data = [];
                    if (m.message.indexOf("<") > -1 && m.message.indexOf(">") > -1) {
                        switch (m.message.trim()) {
                            case '<silence/>':
                                // Agent indicating no meaningful input detected
                                // Mute output for 100ms if agent is not currently speaking
                                if (!agentTalking) {
                                    if (masterGainNode && masterGainNode.gain) {
                                        const currentValue = masterGainNode.gain.value;
                                        const restoreValue = currentValue === 0 && typeof masterGainStoredValue === 'number'
                                            ? masterGainStoredValue
                                            : currentValue;

                                        masterGainStoredValue = restoreValue;

                                        if (masterGainRestoreTimer) {
                                            clearTimeout(masterGainRestoreTimer);
                                            masterGainRestoreTimer = null;
                                        }

                                        masterGainNode.gain.setValueAtTime(0, masterGainNode.context.currentTime);

                                        masterGainRestoreTimer = setTimeout(() => {
                                            if (masterGainNode && masterGainNode.gain) {
                                                const valueToRestore = typeof masterGainStoredValue === 'number' ? masterGainStoredValue : 1;
                                                masterGainNode.gain.setValueAtTime(valueToRestore, masterGainNode.context.currentTime);
                                            }
                                            masterGainRestoreTimer = null;
                                        }, 100);

                                        if (window.debugLog) window.debugLog('SILENCE: Muted output for 100ms', 'system');
                                    }
                                } else {
                                    if (window.debugLog) window.debugLog('SILENCE: Agent speaking, skip mute', 'system');
                                }
                                return;
                        }

                        data = xmlToJson(m.message);
                        console.log("-- xml data: ");
                        console.log(data);
                        m.message = stripXmlTags(m.message);

                        /*
                        {
                            "attr": {
                                "cmd": "save-name",
                                "param": "Saruman"
                            },
                            "tag": "action"
                        }
                         */

                        // Handle both single tag and multiple tags (array)
                        // Skip processing if no valid XML was found
                        if (!data || (Array.isArray(data) && data.length === 0)) {
                            console.log("No valid XML tags found in message");
                        } else {
                            const tags = Array.isArray(data) ? data : [data];

                            for (const tag of tags) {
                                if (!tag || !tag.tag) continue;

                                switch (tag.tag) {
                                    case "action":
                                        if (tag.attr && tag.attr.cmd) {
                                            handleToolCall(tag.attr.cmd, tag.attr.param || '', tag.text);
                                        }
                                        break;
                                    case "link":
                                        if (tag.attr && tag.attr.href) {
                                            handleLink(tag.attr.href, tag.attr.title);
                                        }
                                        break;
                                    case "topic":
                                        if (tag.attr) {
                                            handleTopic(tag.attr);
                                        }
                                        break;
                                    case "entity":
                                        if (tag.attr && tag.attr.type && tag.attr.value) {
                                            const contextMsg = `<system-reminder>Use this ${tag.attr.type} for next question: ${tag.attr.value}</system-reminder>`;
                                            if (conversation) {
                                                conversation.sendUserMessage(contextMsg);
                                                if (window.debugLog) {
                                                    window.debugLog(`CONTEXT: ${tag.attr.type} entity noted - ${tag.attr.value}`, 'system');
                                                }
                                            }
                                        }
                                        break;
                                    case "eval":
                                        conversation.sendUserMessage(tag.attr.prompt);
                                        break;
                                    case "respond":
                                        conversation.sendUserMessage("Respond to this instruction by using following context. \n\n Instruction: " + tag.attr.prompt + ". \n\n Context: " + m.message);
                                        break;
                                    case "instruct":
                                        conversation.sendContextualUpdate(tag.attr.prompt);
                                        break;
                                    case "notify":
                                        showNotification(tag.attr.title, tag.attr.message);
                                        break;
                                    case "reset":
                                        localStorage.clear();
                                        setTimeout(function () {
                                            location.reload();
                                        }, 2500);
                                        break;
                                    case "code":
                                        handleCodeExecution(tag);
                                        break;
                                    /*
                                    that logic is handled by sub agents now
                                                                            case "file":
                                                                            handleFile(tag);
                                                                            break;
                                    */
                                }
                            }
                        }
                    }

                    // Always show subtitle with the message content
                    if (m.message && m.message.trim().length > 0) {
                        showSubtitle(m.message);
                    }

                } else if (m.source === "user") {
                    // Fade out gallery images on user message (voice input)
                    if (window.imageGallery && m.message !== "...") {
                        window.imageGallery.fadeOutSequentially();
                    }

                    // Initialize user directory on first user message
                    if (!userInitialized) {
                        userInitialized = true;
                        fetch('/api/user-init', {
                            method: 'POST',
                            headers: {
                                'Content-Type': 'application/json'
                            }
                        })
                            .then(response => response.json())
                            .then(data => {
                                if (data.success) {
                                    console.log('[USER-INIT] User directory initialized on first message');
                                    if (window.debugLog) {
                                        window.debugLog('USER-INIT: Directory created on first user message', 'system');
                                    }
                                } else {
                                    console.log('[USER-INIT] Directory already exists or init failed:', data.message);
                                }
                            })
                            .catch(error => {
                                console.error('[USER-INIT] Error initializing user directory:', error);
                                if (window.debugLog) {
                                    window.debugLog(`USER-INIT: Error - ${error.message}`, 'system');
                                }
                            });
                    }
                }
            }
        });

        conversation.setVolume({ volume: 1.0 });
        window.conversation = conversation;
        if (window.debugLog) window.debugLog('EVENT: Conversation initialized', 'system');
        hideLoaderOverlay();

        convolver = conversation.output.context.createConvolver();
        agentAnalyser = conversation.output.analyser;
        impulse = await createReverb(0.75, 1.25, false);
        convolver.buffer = impulse;

        const wetGain = conversation.output.context.createGain();
        const dryGain = conversation.output.context.createGain();
        wetGain.gain.value = 0.3;
        dryGain.gain.value = 0.7;

        if (masterGainRestoreTimer) {
            clearTimeout(masterGainRestoreTimer);
            masterGainRestoreTimer = null;
        }

        masterGainNode = conversation.output.context.createGain();

        // Load volume from localStorage or use default
        const savedVolume = localStorage.getItem('masterVolume');
        if (savedVolume !== null) {
            const parsed = parseFloat(savedVolume);
            if (!isNaN(parsed)) {
                masterGainNode.gain.value = Math.max(0.0, Math.min(6.0, parsed));
                if (window.debugLog) window.debugLog(`VOLUME: Restored from localStorage: ${masterGainNode.gain.value}`, 'system');
            } else {
                masterGainNode.gain.value = 1.1;
            }
        } else {
            masterGainNode.gain.value = 1.1;
        }

        masterGainStoredValue = masterGainNode.gain.value;

        // Update volume bar to match
        if (window.setMasterVolume) {
            window.setMasterVolume(masterGainNode.gain.value);
        }

        const destination = conversation.output.analyser.context.destination;
        conversation.output.analyser.disconnect();
        conversation.output.analyser.connect(dryGain);
        conversation.output.analyser.connect(convolver);
        convolver.connect(wetGain);

        wetGain.connect(masterGainNode);
        dryGain.connect(masterGainNode);
        masterGainNode.connect(destination);

        if (lowEnd === true) {
            agentAnalyser.fftSize = 64;
            agentAnalyser.smoothingTimeConstant = 0.35;
        } else {
            agentAnalyser.fftSize = 256;
            agentAnalyser.smoothingTimeConstant = config.smoothing;
        }

        agentAnalyser.maxDecibels = 0;
        agentAnalyser.minDecibels = -100;

        window.onblur = function () {
            if (connected) {
                const contextMsg = "User navigated to another page. Consider it for next response, but don't react to this contextual update.";
                conversation.sendContextualUpdate(contextMsg);
                if (window.debugLog) window.debugLog(`CONTEXT: ${contextMsg}`, 'system');
            }
        };

        window.onfocus = function () {
            if (connected) {
                const contextMsg = "User returned to the page.";
                conversation.sendContextualUpdate(contextMsg);
                if (window.debugLog) window.debugLog(`CONTEXT: ${contextMsg}`, 'system');
            }
        };

    } catch (error) {
        connected = false;
        console.error('[CONNECTION] Error starting conversation:', error);
        console.error('[CONNECTION] Error type:', typeof error);
        console.error('[CONNECTION] Error name:', error?.name);
        console.error('[CONNECTION] Error message:', error?.message);
        console.error('[CONNECTION] Error reason:', error?.reason);
        console.error('[CONNECTION] Error stack:', error?.stack);

        if (window.debugLog) {
            window.debugLog('CONNECTION: Failed - ' + (error?.message || error?.reason || 'Unknown error'), 'system');
        }

        let msg = '[unable to connect to voice service]';
        if (error && (error.reason || error.message)) {
            const r = (error.reason || error.message).toString().toLowerCase();
            if (r.includes('websocket') || r.includes('ws')) {
                msg = '[unable to connect to websocket service]';
            }
        }
        if (subtitle) {
            subtitle.innerHTML = msg;
        }
        showDisconnectionBox();
        _err.play();
    }
}

async function createReverb(duration = 2.0, decay = 2.0, reverse = false) {
    const sampleRate = conversation.output.context.sampleRate;
    const length = sampleRate * duration;
    const impulse = conversation.output.context.createBuffer(2, length, sampleRate);
    const impulseL = impulse.getChannelData(0);
    const impulseR = impulse.getChannelData(1);

    for (let i = 0; i < length; i++) {
        const n = reverse ? length - i : i;
        impulseL[i] = (Math.random() * 2 - 1) * Math.pow(1 - n / length, decay);
        impulseR[i] = (Math.random() * 2 - 1) * Math.pow(1 - n / length, decay);
    }

    return impulse;
}
function initializeAudio(stream) {
    window.persistAudioStream = stream;

    audioContent = new AudioContext();
    audioStream = audioContent.createMediaStreamSource(stream);
    analyser = audioContent.createAnalyser();

    if (lowEnd === true) {
        analyser.fftSize = 64;
        analyser.smoothingTimeConstant = 0.45;
    } else {
        analyser.fftSize = 256;
        analyser.smoothingTimeConstant = config.smoothing;
    }

    analyser.maxDecibels = 0;
    analyser.minDecibels = -100;
    audioStream.connect(analyser);

    frequencyDataLen = analyser.frequencyBinCount;
    frequencyData = new Uint8Array(frequencyDataLen);

    clear();
    render();

    // Only start conversation if language is already selected
    const prefLang = localStorage.getItem('prefLang');
    if (prefLang) {
        (async function () {
            await startConversation();
        })();
    } else {
        // Wait for language selection
        console.log('[INIT] Waiting for language selection...');
        subtitle.innerHTML = "";
        const _languageSelector = document.getElementById('languageSelectionOverlay');
        _languageSelector.style.display = 'flex';
    }
}

// Export function to start conversation after language selection
window.startConversationAfterLanguageSelection = async function () {
    if (audioContent && analyser) {
        await startConversation();
    }
};

function flush() {
    if (!frequencyData) return;
    for (let i = 0; i < frequencyData.length; i++) {
        frequencyData[i] = 0;
    }
}

function clear() {
    if (!ctx) return;
    ctx.beginPath();
    const grd = ctx.createLinearGradient(w / 2, 0, w / 2, h);

    // Rotate through darker brown/red tones slowly
    // Base hue around 15-20 (brown/red), very low saturation and lightness
    const hueRotation = (npt * 0.5) % 30; // Slow rotation through browns/reds (0-30 hue)
    const baseHue = 15 + hueRotation;

    grd.addColorStop(0, `hsl(${baseHue}, 25%, 8%)`);  // Darker top
    grd.addColorStop(1, `hsl(${baseHue}, 30%, 3%)`);  // Very dark bottom
    ctx.fillStyle = grd;
    ctx.fillRect(0, 0, w, h);
    ctx.closePath();
}

function averageFrequency() {
    let avg = 0;
    if (!frequencyData) return 0;
    for (let i = 0; i < frequencyData.length; i++) {
        avg += frequencyData[i];
    }
    return avg;
}

function drawSpectrum() {
    let avg = 0;
    var rot = 20;

    // Calculate speed multiplier for tool loading animation
    if (isToolLoading) {
        const elapsed = Date.now() - toolLoadingStartTime;
        if (elapsed < TOOL_LOADING_SPEED_RAMP_DURATION) {
            // Linear ramp from 1x to 2x over 150ms
            toolLoadingSpeedMultiplier = 1 + (elapsed / TOOL_LOADING_SPEED_RAMP_DURATION);
        } else {
            toolLoadingSpeedMultiplier = 2; // Cap at 2x speed
        }
    } else {
        toolLoadingSpeedMultiplier = 1;
    }

    if (connected === false) {
        const noiseSpeed = 256;
        npt += noiseSpeed / 100000;
        nrt += noiseSpeed / 300000;
        rot = 3;
    } else {
        if (isToolLoading === true) {
            // Use synthetic noise for tool loading animation
            const noiseSpeed = 512; // Constant speed like disconnected state
            const speedFactor = toolLoadingSpeedMultiplier;
            npt += (noiseSpeed / 100000) * speedFactor;
            nrt += (noiseSpeed / 300000) * speedFactor;

            // Generate synthetic frequency data for blob effect
            for (let i = 0; i < frequencyDataLen; i++) {
                frequencyData[i] = Math.random() * 128 + 64; // Random values between 64-192
            }
        } else {
            const noiseSpeed = averageFrequency();
            npt += noiseSpeed / 1000000;
            nrt += noiseSpeed / 3000000;
            if (agentTalking === true) {
                agentAnalyser.getByteFrequencyData(frequencyData);
            } else {
                analyser.getByteFrequencyData(frequencyData);
                detectSpeechActivity();
            }
        }
    }

    const noiseRotate = noise.perlin2(rot, nrt);
    const points = Math.round(frequencyDataLen - frequencyDataLen / 3);
    const avgFrq = averageFrequency();

    for (let i = 0; i < points; i++) {
        avg += frequencyData[i];
        avg = avg / points;

        const x1 = w / 2 + (config.circleRadius + (avgFrq / 4) / points) * Math.cos(-Math.PI / 2 + 2 * Math.PI * i / points + noiseRotate);
        const y1 = h / 2 + (config.circleRadius + (avgFrq / 4) / points) * Math.sin(-Math.PI / 2 + 2 * Math.PI * i / points + noiseRotate);
        const x2 = w / 2 + ((config.circleRadius + (avgFrq / 4) / points) + avg * config.multiplier) * Math.cos(-Math.PI / 2 + 2 * Math.PI * i / points + noiseRotate);
        const y2 = h / 2 + ((config.circleRadius + (avgFrq / 4) / points) + avg * config.multiplier) * Math.sin(-Math.PI / 2 + 2 * Math.PI * i / points + noiseRotate);
        const x3 = w / 2 + ((config.circleRadius + (avgFrq / 4) / points) + Math.pow((avg * config.multiplier) * config.coef, 2)) * Math.cos(-Math.PI / 2 + 2 * Math.PI * i / points + noiseRotate);
        const y3 = h / 2 + ((config.circleRadius + (avgFrq / 4) / points) + Math.pow((avg * config.multiplier) * config.coef, 2)) * Math.sin(-Math.PI / 2 + 2 * Math.PI * i / points + noiseRotate);
        const nd1 = noise.simplex2(y1 / 100, npt) * 8;

        ctx.beginPath();
        ctx.lineCap = "round";
        ctx.shadowBlur = config.glow;
        ctx.lineWidth = 1;

        const hue = isSpeaking ? 260 : 180;
        const thinSat = isSpeaking ? 40 : 22;
        const thinLightBase = isSpeaking ? 20 : 30;
        const thickSat = isSpeaking ? 60 : 30;
        const thickLightBase = isSpeaking ? 45 : 38;

        const thinLight = thinLightBase + Math.pow(avg * 3, 2);
        const thickLight = thickLightBase + Math.pow(avg * 3, 2);

        if (isToolLoading === true) {
            // Green loading state
            ctx.strokeStyle = "hsla(" + (128) + ", 60%, " + (25 + (Math.pow(avg * 3, 2))) + "%, 100%)";
            ctx.shadowColor = "hsla(" + (128) + ", 60%, " + (25 + (Math.pow(avg * 3, 2))) + "%, 100%)";
        } else if (agentTalking === true) {
            ctx.strokeStyle = "hsla(" + (128) + ", 50%, " + (20 + (Math.pow(avg * 3, 2))) + "%, 100%)";
            ctx.shadowColor = "hsla(" + (128) + ", 50%, " + (20 + (Math.pow(avg * 3, 2))) + "%, 100%)";
        } else {
            ctx.strokeStyle = `hsla(${hue}, ${thinSat}%, ${thinLight}%, 100%)`;
            ctx.shadowColor = `hsla(${hue}, ${thinSat}%, ${thinLight}%, 100%)`;
        }

        ctx.moveTo(x1 + nd1, y1 + nd1);
        ctx.lineTo(x2 + nd1, y2 + nd1);
        ctx.stroke();
        ctx.closePath();

        ctx.beginPath();
        ctx.lineCap = "round";
        ctx.shadowBlur = config.glow;
        ctx.lineWidth = 4;

        if (connected === false) {
            ctx.strokeStyle = "hsla(" + (180) + ", 20%, " + (30 + (Math.pow(avg * 3, 2))) + "%, 100%)";
            ctx.shadowColor = "hsla(" + (180) + ", 20%, " + (30 + (Math.pow(avg * 3, 2))) + "%, 100%)";
        } else {
            if (isToolLoading === true) {
                // Green loading state (thicker line)
                ctx.strokeStyle = "hsla(" + (128) + ", 60%, " + (35 + (Math.pow(avg * 3, 2))) + "%, 100%)";
                ctx.shadowColor = "hsla(" + (128) + ", 60%, " + (35 + (Math.pow(avg * 3, 2))) + "%, 100%)";
            } else if (agentTalking === true) {
                ctx.strokeStyle = "hsla(" + (128) + ", 50%, " + (30 + (Math.pow(avg * 3, 2))) + "%, 100%)";
                ctx.shadowColor = "hsla(" + (128) + ", 50%, " + (30 + (Math.pow(avg * 3, 2))) + "%, 100%)";
            } else {
                ctx.strokeStyle = `hsla(${hue}, ${thickSat}%, ${thickLight}%, 100%)`;
                ctx.shadowColor = `hsla(${hue}, ${thickSat}%, ${thickLight}%, 100%)`;
            }
        }
        ctx.moveTo(x1 + nd1, y1 + nd1);
        ctx.lineTo(x3 + nd1, y3 + nd1);
        ctx.stroke();
        ctx.closePath();
    }
}

function render() {
    if (!ctx) return;
    clear();
    drawSpectrum();
    requestAnimationFrame(render);
}

function hideLoaderOverlay() {
    if (!loaderOverlay) return;
    if (typeof window.stopLoaderAnimation === 'function') {
        window.stopLoaderAnimation();
    }
    const overlay = loaderOverlay;
    overlay.classList.add('loader-hidden');
    loaderOverlay = null;

    // Show canvas after loader starts fading out
    setTimeout(() => {
        if (canvas) {
            canvas.classList.add('visible');
        }
    }, 100);

    setTimeout(() => {
        if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
    }, 300);
}

function initNotificationContainer() {
    if (notificationContainer) return;

    notificationContainer = document.createElement('div');
    notificationContainer.className = 'notification-container';
    document.body.appendChild(notificationContainer);
}

function showNotification(title, description, iconUrl) {
    initNotificationContainer();

    const notification = document.createElement('div');
    notification.className = 'notification';

    if (typeof iconUrl !== 'string' || iconUrl.trim() === '') {
        iconUrl = '/static/favicon.ico';
    }

    const icon = document.createElement('img');
    icon.className = 'notification-icon';
    icon.src = iconUrl;

    const textContainer = document.createElement('div');
    textContainer.className = 'notification-text';

    const titleEl = document.createElement('div');
    titleEl.className = 'notification-title';
    titleEl.textContent = title;

    const descEl = document.createElement('div');
    descEl.className = 'notification-description';
    descEl.textContent = description;

    textContainer.appendChild(titleEl);
    textContainer.appendChild(descEl);
    notification.appendChild(icon);
    notification.appendChild(textContainer);
    notificationContainer.appendChild(notification);
    _talk.play();
    requestAnimationFrame(() => {
        notification.classList.add('show');
    });

    setTimeout(() => {
        notification.classList.remove('show');
        setTimeout(() => {
            if (notification.parentNode) {
                notification.parentNode.removeChild(notification);
            }
        }, 500);
    }, 6000);
}

window.showNotification = showNotification;
window.hiss = hiss;

(function () {
    loaderOverlay = document.getElementById('loaderOverlay');
    if (loaderOverlay && typeof window.startLoaderAnimation === 'function') {
        window.startLoaderAnimation();
    }
    window.onresize = function () {
        w = window.innerWidth;
        h = window.innerHeight;
        if (ctx) {
            ctx.canvas.width = w;
            ctx.canvas.height = h;
        }
    };

    if (!AudioContext) {
        console.log("No Audio");
        subtitle.innerHTML = "[audio not supported by browser]";
        _err.play();
        hideLoaderOverlay();
        return;
    }
    detectPerformance();
    if (lowEnd === true) {
        config.glow = 0;
        config.multiplier = 10;
        config.coef = 0.05;
        config.colorSpeed = 0;
    }

    if (canvas) {
        ctx = canvas.getContext("2d");
        w = ctx.canvas.width = window.innerWidth;
        h = ctx.canvas.height = window.innerHeight;
    }

    //    const constraints = { audio: true };
    const constraints = {
        audio: { noiseSuppression: true }
    };
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        connected = false;
        subtitle.innerHTML = "[Media API unavailable]";
        _err.play();
        return;
    }
    navigator.mediaDevices.getUserMedia(constraints).then(function (stream) {
        const track = stream.getAudioTracks()[0];
        const deviceId = track.getSettings().deviceId;
        return navigator.mediaDevices.enumerateDevices().then(devices => {
            const audioInputs = devices.filter(d => d.kind === 'audioinput');
            if (!audioInputs || audioInputs.length === 0) {
                connected = false;
                subtitle.innerHTML = "[no input audio source detected]";
                hideLoaderOverlay();
                _err.play();
                return;
            }
            const activeMic = devices.find(device => device.deviceId === deviceId);
            micName = (activeMic ? activeMic.label : "Unknown").toString();
            if (micName !== "" && isStereoMix(micName) === true) {
                connected = false;
                subtitle.innerHTML = "[no microphone detected]";
                _err.play();
                hideLoaderOverlay();
                return;
            }
            console.log(stream);
            initializeAudio(stream);
        });
    }).catch(function (e) {
        console.log(e);
        connected = false;
        let msg = "[cannot access microphone]";
        if (e && (e.name || e.code)) {
            const name = e.name || e.code;
            if (name === 'NotAllowedError' || name === 'PermissionDeniedError') msg = "[microphone permission denied]";
            else if (name === 'NotFoundError' || name === 'DevicesNotFoundError') msg = "[no input audio source detected]";
            else if (name === 'NotReadableError') msg = "[microphone is in use or unavailable]";
            else if (name === 'OverconstrainedError') msg = "[audio constraints not satisfied]";
            else if (name === 'AbortError') msg = "[audio capture aborted]";
            else if (name === 'SecurityError') msg = "[secure context required for microphone]";
            else if (name === 'TypeError') msg = "[invalid audio constraints]";
        }
        subtitle.innerHTML = msg;
        hideLoaderOverlay();
        _err.play();
    });
})();

// Volume Bar Implementation
(function initVolumeBar() {
    const volumeCanvas = document.getElementById('volumeCanvas');
    const ctx = volumeCanvas.getContext('2d');

    // Set canvas resolution
    const WIDTH = 64;
    const HEIGHT = 260;
    const LINES = 100;
    const LINE_HEIGHT = 1;
    const LINE_SPACING = HEIGHT / LINES;
    const MAX_VOLUME = 6.0; // Maximum volume limit

    volumeCanvas.width = WIDTH;
    volumeCanvas.height = HEIGHT;

    // Load saved volume from localStorage or use default
    let currentVolume = 1.0;
    const savedVolume = localStorage.getItem('masterVolume');
    if (savedVolume !== null) {
        const parsed = parseFloat(savedVolume);
        if (!isNaN(parsed)) {
            currentVolume = Math.max(0.0, Math.min(MAX_VOLUME, parsed));
        }
    }

    let isDragging = false;

    // Draw volume bar
    function drawVolumeBar() {
        ctx.clearRect(0, 0, WIDTH, HEIGHT);

        // Calculate volume percentage (0-100 from bottom to top)
        const volumePercent = (currentVolume / MAX_VOLUME) * 100;

        // Draw 100 horizontal lines
        for (let i = 0; i < LINES; i++) {
            const lineIndex = LINES - 1 - i; // Invert so bottom is 0
            const y = i * LINE_SPACING;

            // Calculate line width (5px at bottom/line 0, WIDTH at top/line 99)
            const lineWidth = 5 + (lineIndex / (LINES - 1)) * (WIDTH - 5);

            // Calculate what percentage this line represents
            const linePercent = (lineIndex / (LINES - 1)) * 100;

            // Determine color
            if (linePercent <= volumePercent) {
                ctx.strokeStyle = '#ff0c0c'; // Red for active volume
            } else {
                ctx.strokeStyle = '#808080'; // Gray for inactive
            }

            ctx.lineWidth = LINE_HEIGHT;
            ctx.beginPath();
            // Align right
            ctx.moveTo(WIDTH - lineWidth, y);
            ctx.lineTo(WIDTH, y);
            ctx.stroke();
        }
    }

    // Update master gain and redraw
    function setVolume(volume) {
        currentVolume = Math.max(0.0, Math.min(MAX_VOLUME, volume));

        if (masterGainNode) {
            masterGainNode.gain.value = currentVolume;
        }

        // Save to localStorage
        localStorage.setItem('masterVolume', currentVolume.toString());
        drawVolumeBar();
    }

    // Convert mouse Y position to volume value
    function getVolumeFromY(y) {
        const rect = volumeCanvas.getBoundingClientRect();
        const relativeY = y - rect.top;
        const percentage = 1.0 - (relativeY / HEIGHT); // Invert Y axis
        return Math.max(0.0, Math.min(MAX_VOLUME, percentage * MAX_VOLUME));
    }

    // Mouse/touch event handlers
    volumeCanvas.addEventListener('mousedown', (e) => {
        isDragging = true;
        setVolume(getVolumeFromY(e.clientY));
    });

    volumeCanvas.addEventListener('touchstart', (e) => {
        isDragging = true;
        setVolume(getVolumeFromY(e.touches[0].clientY));
        e.preventDefault();
    });

    window.addEventListener('mousemove', (e) => {
        if (isDragging) {
            setVolume(getVolumeFromY(e.clientY));
        }
    });

    window.addEventListener('touchmove', (e) => {
        if (isDragging) {
            setVolume(getVolumeFromY(e.touches[0].clientY));
            e.preventDefault();
        }
    });

    window.addEventListener('mouseup', () => {
        isDragging = false;
    });

    window.addEventListener('touchend', () => {
        isDragging = false;
    });

    // Click to set volume directly
    volumeCanvas.addEventListener('click', (e) => {
        setVolume(getVolumeFromY(e.clientY));
    });

    // Show volume bar temporarily (for tool commands)
    let volumeBarTimeout = null;
    function showVolumeBarTemporarily() {
        // Clear any existing timeout
        if (volumeBarTimeout) {
            clearTimeout(volumeBarTimeout);
        }

        // Show the bar
        volumeCanvas.style.opacity = '1';

        // Hide after 5 seconds
        volumeBarTimeout = setTimeout(() => {
            volumeCanvas.style.opacity = '0';
            volumeBarTimeout = null;
        }, 5000);
    }

    // Export to window for external access
    window.setMasterVolume = setVolume;
    window.getMasterVolume = () => currentVolume;
    window.showVolumeBar = showVolumeBarTemporarily;

    // Initial draw
    drawVolumeBar();
})();

// Touch-Friendly UI Management
(function initTouchUI() {
    // Check if device has touch support
    const isTouchDevice = ('ontouchstart' in window) ||
        (navigator.maxTouchPoints > 0) ||
        (navigator.msMaxTouchPoints > 0);

    if (!isTouchDevice) {
        // Not a touch device, use default hover behavior
        return;
    }

    const volumeCanvas = document.getElementById('volumeCanvas');
    const callControls = document.getElementById('callControls');
    const topicDisplay = document.getElementById('topicDisplay');
    const topRightControls = document.getElementById('topRightControls');

    let hideTimeout = null;

    function showTouchUI() {
        if (!connected) return;

        // Add visible class to all touch UI elements
        if (volumeCanvas && volumeCanvas.classList.contains('connected')) {
            volumeCanvas.classList.add('touch-visible');
        }
        if (callControls && callControls.classList.contains('connected')) {
            callControls.classList.add('touch-visible');
        }
        if (topicDisplay && topicDisplay.classList.contains('connected')) {
            topicDisplay.classList.add('touch-visible');
        }
        if (topRightControls && topRightControls.classList.contains('connected')) {
            topRightControls.classList.add('touch-visible');
        }

        // Clear existing timeout
        if (hideTimeout) {
            clearTimeout(hideTimeout);
        }

        // Set new timeout to hide UI
        hideTimeout = setTimeout(() => {
            hideTouchUI();
        }, TOUCH_UI_TIMEOUT);
    }

    function hideTouchUI() {
        if (volumeCanvas) {
            volumeCanvas.classList.remove('touch-visible');
        }
        if (callControls) {
            callControls.classList.remove('touch-visible');
        }
        if (topicDisplay) {
            topicDisplay.classList.remove('touch-visible');
        }
        if (languageSelector) {
            topRightControls.classList.remove('touch-visible');
        }
    }

    // Show UI on touch/click
    document.body.addEventListener('touchstart', showTouchUI);
    document.body.addEventListener('click', showTouchUI);

    // Show UI initially when connected, then auto-hide
    window.addEventListener('agent-connected', () => {
        showTouchUI();
    });

    // Hide UI when disconnected
    window.addEventListener('agent-disconnected', () => {
        if (hideTimeout) {
            clearTimeout(hideTimeout);
            hideTimeout = null;
        }
        hideTouchUI();
    });

    if (window.debugLog) {
        window.debugLog('Touch UI: Initialized for touch device', 'system');
    }
})();
