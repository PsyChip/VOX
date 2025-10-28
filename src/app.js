"use strict";
import { Conversation } from '@elevenlabs/client';
import sound from './sound';
import Sun from './sun';
import { evaluate } from 'mathjs';
import { detectPerformance, getDayPhase, getLocalTime24, tzOffset, isStereoMix, stripXmlTags, xmlToJson } from './utils';
import {
    showDisconnectionBox,
    hideDisconnectionBox,
    updateTopicDisplay,
    clearTopicDisplay,
    showCategoryIndicator,
    handleLink,
    showNotification,
    initTouchUI,
    toolStatus,
    updateConnectionQualityUI,
    cancelSubtitleAutoFade,
    scheduleSubtitleFadeAfter,
    fadeOutSubtitle,
    showSubtitle,
    initSubtitleCanvas,
    hideStatusDisplay,
    loaderStatus,
    showAppStatus,
    showMicrophoneError,
    redrawSubtitle,
    setSubtitleAgentTalking,
    updateSubtitleCanvasSize,
    hasMicrophoneError
} from './ui';
const SPEECH_THRESHOLD = 15;
const SILENCE_THRESHOLD = 10;
const MIN_SPEECH_SAMPLES = 5;
const END_SENTENCE_PAUSE = 800;
const TOUCH_UI_TIMEOUT = 5000;
const COORDINATE_CHECK_INTERVAL = 60000;
const subcontext = "Use this information to respond user's next message but do not react to this contextual update. respond with <silence/>";
const STATE_DEBOUNCE_TIME = 100;
// Context behavior control:
// 0 = No contextual updates at all
// 1 = Use conversation.sendContextualUpdate()
// 2 = Use conversation.sendUserMessage() for cross-model compatibility
const CONTEXT_BEHAVIOUR = 2;
const config = {
    circleRadius: 80,
    multiplier: 50,
    colorSpeed: 15,
    hueStart: 0,
    glow: 0.1,
    coef: 0.09,
    smoothing: 0.48
};
const AudioContext = window.AudioContext || window.webkitAudioContext;
const noise = window.noise;
let conversation = null;
let connected = false;
let isSpeaking = false;
let speechEnergy = 0;
let silenceTimer = null;
let speechSamplesAboveThreshold = 0;
let lastSpeechTimestamp = 0;
let isHissPlaying = false;
let transcript = [];
let speakingState = -1;
let speakingStateStartTime = Date.now();
let speakingTime = 0;
let pendingState = null;
let pendingStateTime = 0;
let stateDebounceTimer = null;
let isToolLoading = false;
let userInitialized = false;
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
let micName = "";
let convolver;
let impulse;
let masterGainNode = null;
let userCoordinates = null;
let locationRequestPromise = null;
let lastReportedCoordinates = null;
let coordinateMonitorTimer = null;
let loaderOverlay = null;
let conversationStartTime = 0;
let _wakeLock = null;
let _wakeLockVisHandler = null;
let _magSensor = null;
let _headingDeg = null;
let _headingUpdatedAt = 0;
let _orientationPermissionRequested = false;
let _phonePose = '';
let controlSocket = null;
let controlSocketReady = false;
let _pingTimer = null;
let _lastPingAt = 0;
const canvas = document.getElementById("canvas");
const _leave = new sound("/static/sfx/VoiceLeave.ogg");
const _join = new sound("/static/sfx/VoiceJoin.ogg");
const _err = new sound("/static/sfx/VoiceError.ogg");
const _talk = new sound("/static/sfx/talk.ogg");
const _action = new sound("/static/sfx/action.ogg");
window.lowEnd = false;
function updateSpeakingState(newState, immediate = false) {
    if (immediate || newState === -1) {
        if (stateDebounceTimer) {
            clearTimeout(stateDebounceTimer);
            stateDebounceTimer = null;
            pendingState = null;
        }
        if (speakingState !== newState) {
            speakingState = newState;
            speakingStateStartTime = Date.now();
            window.speakingState = newState;
        }
        return;
    }
    if (speakingState === newState) {
        if (stateDebounceTimer) {
            clearTimeout(stateDebounceTimer);
            stateDebounceTimer = null;
            pendingState = null;
        }
        return;
    }
    if (pendingState !== newState) {
        pendingState = newState;
        pendingStateTime = Date.now();
        if (stateDebounceTimer) {
            clearTimeout(stateDebounceTimer);
        }
        stateDebounceTimer = setTimeout(() => {
            if (pendingState === newState) {
                speakingState = newState;
                speakingStateStartTime = Date.now();
                window.speakingState = newState;
                pendingState = null;
                stateDebounceTimer = null;
            }
        }, STATE_DEBOUNCE_TIME);
    }
}
function getSpeakingTime() {
    return Date.now() - speakingStateStartTime;
}
function getStateDebugInfo() {
    return {
        currentState: speakingState,
        pendingState: pendingState,
        stateTime: getSpeakingTime(),
        hasPendingChange: stateDebounceTimer !== null,
        debounceTime: STATE_DEBOUNCE_TIME
    };
}
async function _acquireWakeLockIfMobile() {
    try {
        const nav = (typeof navigator !== 'undefined') ? navigator : null;
        if (!nav || !('wakeLock' in nav)) return;
        const isMobile = /android|iphone|ipad|ipod/i.test((navigator.userAgent || ''));
        if (!isMobile) return;
        try {
            _wakeLock = await nav.wakeLock.request('screen');
            try { if (window.debugLog) window.debugLog('WAKELOCK: Acquired', 'system'); } catch (_) { }
            _wakeLockVisHandler = async () => {
                if (document.visibilityState === 'visible' && !_wakeLock) {
                    try { _wakeLock = await nav.wakeLock.request('screen'); } catch (_) { }
                }
            };
            try { document.addEventListener('visibilitychange', _wakeLockVisHandler); } catch (_) { }
            try { _wakeLock.addEventListener('release', () => { try { if (window.debugLog) window.debugLog('WAKELOCK: Released', 'system'); } catch (_) { } _wakeLock = null; }); } catch (_) { }
        } catch (_) {
        }
    } catch (_) { }
}
async function _releaseWakeLock() {
    try {
        if (_wakeLock && typeof _wakeLock.release === 'function') {
            try { await _wakeLock.release(); } catch (_) { }
        }
        _wakeLock = null;
    } catch (_) { }
    try {
        if (_wakeLockVisHandler) {
            document.removeEventListener('visibilitychange', _wakeLockVisHandler);
            _wakeLockVisHandler = null;
        }
    } catch (_) { }
}
function _normalizeDeg(deg) {
    if (typeof deg !== 'number' || !isFinite(deg)) return null;
    let d = deg % 360;
    if (d < 0) d += 360;
    return Math.round(d * 10) / 10;
}
function _headingToCardinal(deg) {
    const dirs = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
    if (deg == null) return '';
    const ix = Math.floor(((deg + 22.5) % 360) / 45);
    return dirs[ix] || '';
}
async function startCompassSensors(waitForFirst = false) {
    try {
        if ('Magnetometer' in window) {
            if (_magSensor) return;
            _magSensor = new window.Magnetometer({ frequency: 10 });
            _magSensor.addEventListener('reading', () => {
                try {
                    const x = _magSensor.x, y = _magSensor.y;
                    if (typeof x === 'number' && typeof y === 'number') {
                        const rad = Math.atan2(y, x);
                        const deg = _normalizeDeg(rad * 180 / Math.PI);
                        if (deg != null) {
                            _headingDeg = deg;
                            _headingUpdatedAt = Date.now();
                        }
                    }
                } catch (_) { }
            });
            _magSensor.addEventListener('error', () => { try { _magSensor = null; } catch (_) { } });
            try { _magSensor.start(); } catch (_) {
            }
        }
        const setupDo = async () => {
            try {
                const handler = (e) => {
                    try {
                        let deg = null;
                        if (typeof e.webkitCompassHeading === 'number') {
                            deg = _normalizeDeg(e.webkitCompassHeading);
                        } else if (typeof e.alpha === 'number') {
                            deg = _normalizeDeg(360 - e.alpha);
                        }
                        if (deg != null) {
                            _headingDeg = deg;
                            _headingUpdatedAt = Date.now();
                        }
                        try {
                            const pose = _computePhonePoseFromAngles(e);
                            if (pose) _phonePose = pose;
                        } catch (_) { }
                    } catch (_) { }
                };
                window.removeEventListener('deviceorientation', handler);
                window.addEventListener('deviceorientation', handler, true);
            } catch (_) { }
        };
        if (typeof DeviceOrientationEvent !== 'undefined' && typeof DeviceOrientationEvent.requestPermission === 'function' && !_orientationPermissionRequested) {
            try {
                _orientationPermissionRequested = true;
                const req = async () => {
                    try { await DeviceOrientationEvent.requestPermission().catch(() => { }); } catch (_) { }
                    setupDo();
                    try { window.removeEventListener('touchstart', req, { capture: true }); } catch (_) { try { window.removeEventListener('touchstart', req); } catch (_) { } }
                    window.removeEventListener('click', req, true);
                };
                window.addEventListener('touchstart', req, { capture: true, passive: true });
                window.addEventListener('click', req, true);
            } catch (_) { }
        } else {
            setupDo();
        }
        if (waitForFirst) {
            await new Promise(res => setTimeout(res, 300));
        }
    } catch (_) { }
}
function getHeadingDeg() { return _headingDeg; }
function getHeadingCardinal() { return _headingToCardinal(_headingDeg); }
window.getHeading = getHeadingDeg;
window.getHeadingCardinal = getHeadingCardinal;
function _computePhonePoseFromAngles(e) {
    try {
        const type = (screen && screen.orientation && screen.orientation.type) ? screen.orientation.type : '';
        let orient = '';
        if (type.includes('portrait')) orient = 'portrait';
        else if (type.includes('landscape')) orient = 'landscape';
        else if (typeof e.gamma === 'number') {
            orient = Math.abs(e.gamma) > 45 ? 'landscape' : 'portrait';
        }
        return orient ? `${orient}` : '';
    } catch (_) { return ''; }
}
function _startPhonePoseMotion() {
    try {
        const handler = (ev) => {
            try {
                const g = ev.accelerationIncludingGravity;
                if (!g) return;
                const az = typeof g.z === 'number' ? g.z : null;
                let face = '';
                if (az != null) {
                    if (az >= 6) face = 'face-up';
                    else if (az <= -6) face = 'face-down';
                }
                let orient = '';
                const type = (screen && screen.orientation && screen.orientation.type) ? screen.orientation.type : '';
                if (type.includes('portrait')) orient = 'portrait';
                else if (type.includes('landscape')) {
                    orient = type.includes('primary') ? 'landscape-right' : 'landscape-left';
                } else {
                }
                const parts = [orient || ''];
                if (face) parts.push(face);
                const pose = parts.filter(Boolean).join(' ').trim();
                if (pose) _phonePose = pose;
            } catch (_) { }
        };
        window.addEventListener('devicemotion', handler, true);
    } catch (_) { }
}
_startPhonePoseMotion();
function getPhonePose() { return _phonePose; }
window.getPhonePose = getPhonePose;
function vibrateNotice(kind) {
    try {
        const nav = (typeof navigator !== 'undefined') ? navigator : null;
        if (!nav || typeof nav.vibrate !== 'function') return;
        let pattern;
        switch ((kind || '').toLowerCase()) {
            case 'error': pattern = [120, 60, 120]; break;
            case 'action': pattern = 40; break;
            case 'join': pattern = [50, 40, 50]; break;
            case 'leave': pattern = [70, 50, 70]; break;
            case 'talk': pattern = 20; break;
            default: pattern = 30; break;
        }
        nav.vibrate(pattern);
    } catch (_) {
    }
}
function attachVibrateToSound(obj, kind) {
    try {
        if (!obj || typeof obj.play !== 'function') return obj;
        const original = obj.play.bind(obj);
        obj.play = function () {
            vibrateNotice(kind);
            return original.apply(obj, arguments);
        };
    } catch (_) {
    }
    return obj;
}
attachVibrateToSound(_leave, 'leave');
attachVibrateToSound(_join, 'join');
attachVibrateToSound(_err, 'error');
attachVibrateToSound(_talk, 'talk');
attachVibrateToSound(_action, 'action');
try {
    window._leave = _leave;
    window._join = _join;
    window._err = _err;
    window._talk = _talk;
    window._action = _action;
} catch (_) { }
async function httpApiRequest(method, url, jsonBody) {
    const init = {
        method,
        credentials: 'same-origin'
    };
    if (jsonBody) {
        init.headers = { 'Content-Type': 'application/json' };
        init.body = JSON.stringify(jsonBody);
    }
    try {
        const resp = await fetch(url, init);
        const ct = resp.headers.get('content-type') || '';
        const ab = await resp.arrayBuffer();
        const text = new TextDecoder().decode(ab);
        let json = null;
        if (ct.includes('application/json')) {
            try { json = JSON.parse(text); } catch (_) { }
        }
        return { status: resp.status, ok: resp.ok, contentType: ct, text, json, arrayBuffer: ab };
    } catch (error) {
        console.error('API request failed:', error);
        return { status: 0, ok: false, error: error.message };
    }
}
const wsApiRequest = httpApiRequest;
function connectControlSocket(customUrl) {
    try {
        const pageWsProto = (location.protocol === 'https:') ? 'wss' : 'ws';
        let url = customUrl || `${pageWsProto}://${location.host}/ws`;
        try {
            const u = new URL(url, window.location.href);
            url = `${pageWsProto}://${u.host}${u.pathname}${u.search}`;
        } catch (_) {
            // Fallback: simple prefix replace
            url = url.replace(/^ws(s)?:\/\//, `${pageWsProto}://`);
        }
        const ws = new WebSocket(url);
        controlSocket = ws;
        controlSocketReady = false;
        ws.addEventListener('open', () => {
            controlSocketReady = true;
            try {
                ws.send(JSON.stringify({
                    type: 'hello',
                    ua: navigator.userAgent,
                    time: Date.now()
                }));
            } catch (e) { }
            if (_pingTimer) { clearInterval(_pingTimer); _pingTimer = null; }
            const sendPing = () => {
                if (!ws || ws.readyState !== WebSocket.OPEN) return;
                _lastPingAt = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
                try { ws.send(JSON.stringify({ type: 'ping', time: Date.now() })); } catch (_) { }
            };
            sendPing();
            _pingTimer = setInterval(sendPing, 1000);
        });
        ws.addEventListener('message', (ev) => {
            let msg = null;
            try { msg = JSON.parse(ev.data); } catch (_) { }
            if (!msg || !msg.type) return;
            if (msg.type === 'pong') {
                const now = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
                const rtt = Math.max(0, now - _lastPingAt);
                updateConnectionQualityUI(rtt);
                return;
            }
            if (msg.type === 'broadcast' && msg.payload && window.showNotification) {
                try { window.showNotification('Broadcast', String(msg.payload)); } catch (_) { }
                return;
            }
        });
        ws.addEventListener('close', () => {
            controlSocketReady = false;
            if (_pingTimer) { clearInterval(_pingTimer); _pingTimer = null; }
            updateConnectionQualityUI(9999);
            setTimeout(() => connectControlSocket(url), 2000);
        });
        ws.addEventListener('error', () => {
            try { ws.close(); } catch (_) { }
        });
    } catch (e) {
        setTimeout(() => connectControlSocket(customUrl), 3000);
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
    if (coordinateMonitorTimer) {
        clearInterval(coordinateMonitorTimer);
        coordinateMonitorTimer = null;
    }
    if (!window.isSecureContext || !navigator.geolocation) {
        return;
    }
    lastReportedCoordinates = userCoordinates ? { ...userCoordinates } : null;
    coordinateMonitorTimer = setInterval(() => {
        if (!connected) {
            return;
        }
        navigator.geolocation.getCurrentPosition(
            (position) => {
                const newCoords = {
                    latitude: position.coords.latitude,
                    longitude: position.coords.longitude
                };
                userCoordinates = newCoords;
                if (lastReportedCoordinates) {
                    const latDiff = Math.abs(newCoords.latitude - lastReportedCoordinates.latitude);
                    const lonDiff = Math.abs(newCoords.longitude - lastReportedCoordinates.longitude);
                    if (latDiff > 0.0001 || lonDiff > 0.0001) {
                        const contextMsg = `<system-reminder>User's coordinates changed to: ${newCoords.latitude.toFixed(6)}, ${newCoords.longitude.toFixed(6)} use those coordinates on your geographic tool calls. ${subcontext}</system-reminder>`;
                        sendContextualMessage(contextMsg);
                        lastReportedCoordinates = { ...newCoords };
                    } else {
                    }
                } else {
                    lastReportedCoordinates = { ...newCoords };
                }
            },
            (error) => {
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
    }
}
function sendContextualMessage(message) {
    const hasSystemTag = message.includes('<system-reminder>');
    const wrappedMessage = hasSystemTag ? message : `<system-reminder>${message}</system-reminder>`;
    conversation.sendUserMessage(wrappedMessage);
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
            if (connected && !agentTalking) {
                updateSpeakingState(2);
            }
        }
        lastSpeechTimestamp = now;
    } else if (isSpeaking && speechEnergy < SILENCE_THRESHOLD) {
        const silenceDuration = now - lastSpeechTimestamp;
        if (!silenceTimer && silenceDuration > 300) {
            silenceTimer = setTimeout(() => {
                isSpeaking = false;
                if (connected && !agentTalking) {
                    updateSpeakingState(0);
                }
                speechSamplesAboveThreshold = 0;
                silenceTimer = null;
            }, END_SENTENCE_PAUSE);
        }
    } else {
        speechSamplesAboveThreshold = Math.max(0, speechSamplesAboveThreshold - 1);
    }
}
async function reconnectAgent() {
    hideDisconnectionBox();
    window.userRequestedDisconnect = false;
    await startConversation();
}
async function initializeTools() {
    try {
        loaderStatus('loading tools');
        let payload = [];
        payload.push(getDayPhase());
        await startCompassSensors(true);
        const coords = await requestPreciseLocation();
        const lat = coords.latitude;
        const lng = coords.longitude;
        payload.push(lat.toFixed(8));
        payload.push(lng.toFixed(8));
        payload.push(getLocalTime24());
        payload.push(tzOffset());
        if (Sun) {
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
                if (lastTopicTitle && topic.tags) {
                    updateTopicDisplay(lastTopicTitle, topic.tags);
                }
            } catch (e) {
            }
        }
        payload.push(lastTopicTitle);
        payload.push(lastTopicTimestamp);
        const prefLang = localStorage.getItem('prefLang') || 'en';
        payload.push(prefLang);
        const uid = localStorage.getItem('uid') || '0';
        payload.push(uid);
        try {
            let orientationType = '';
            if (screen && screen.orientation && typeof screen.orientation.type === 'string') {
                orientationType = screen.orientation.type;
            } else if (typeof window.orientation !== 'undefined') {
                const v = Number(window.orientation);
                orientationType = (v === 0) ? 'portrait-primary' : (Math.abs(v) === 90 ? 'landscape-primary' : 'portrait-secondary');
            }
            payload.push(orientationType || '');
            const isMobile = /android|iphone|ipad|ipod/i.test((navigator.userAgent || ''));
            const tryLock = () => {
                try {
                    if (screen && screen.orientation && typeof screen.orientation.lock === 'function') {
                        screen.orientation.lock('portrait-primary').catch(() => { });
                    }
                } catch (_) { }
            };
            if (isMobile) {
                tryLock();
                let once = false;
                const onceHandler = () => {
                    if (once) return; once = true;
                    tryLock();
                    try { window.removeEventListener('touchstart', onceHandler, { capture: true }); } catch (_) { try { window.removeEventListener('touchstart', onceHandler); } catch (_) { } }
                    window.removeEventListener('click', onceHandler, true);
                };
                try {
                    window.addEventListener('touchstart', onceHandler, { capture: true, passive: true });
                    window.addEventListener('click', onceHandler, true);
                } catch (_) { }
            }
        } catch (_) {
            payload.push('');
        }
        try {
            const hdg = getHeadingDeg();
            const card = getHeadingCardinal();
            payload.push(hdg != null ? String(Math.round(hdg)) : '');
            payload.push(card || '');
        } catch (_) {
            payload.push('');
            payload.push('');
        }
        try {
            const pose = getPhonePose();
            payload.push(pose || '');
        } catch (_) {
            payload.push('');
        }
        try {
            let bm = null;
            if (navigator && typeof navigator.getBattery === 'function') {
                bm = await navigator.getBattery();
            } else if ((navigator && navigator.battery)) {
                bm = navigator.battery;
            }
            if (bm && typeof bm.level === 'number') {
                const levelPct = Math.round(bm.level * 100);
                const isCharging = !!bm.charging;
                payload.push(String(levelPct));
                payload.push(isCharging ? '1' : '0');
                try {
                    let lastLevelSent = levelPct;
                    let lastLevelSentAt = Date.now();
                    let lastChargeState = isCharging;
                    let lastChargeSentAt = Date.now();
                    const MIN_DIFF_PCT = 1;
                    const MIN_INTERVAL_MS = 3000;
                    const sendLevelUpdate = () => {
                        try {
                            const now = Date.now();
                            const pct = Math.round((bm.level || 0) * 100);
                            const diff = Math.abs(pct - lastLevelSent);
                            if (diff >= MIN_DIFF_PCT && (now - lastLevelSentAt) >= MIN_INTERVAL_MS) {
                                sendContextualMessage(`user's device battery status: ${pct}% warn user if it's below 20% which may affect ongoing conversation`);
                                if (window.debugLog) window.debugLog(`BATTERY: levelchange -> ${pct}% (sent)`, 'system');
                                lastLevelSent = pct;
                                lastLevelSentAt = now;
                            } else {
                                if (window.debugLog) window.debugLog(`BATTERY: levelchange -> ${pct}% (suppressed)`, 'system');
                            }
                        } catch (_) { }
                    };
                    const sendChargeUpdate = () => {
                        try {
                            const now = Date.now();
                            if ((now - lastChargeSentAt) < MIN_INTERVAL_MS && bm.charging === lastChargeState) {
                                if (window.debugLog) window.debugLog(`BATTERY: chargingchange -> ${bm.charging ? 'charging' : 'not charging'} (suppressed)`, 'system');
                                return;
                            }
                            if (bm.charging !== lastChargeState || (now - lastChargeSentAt) >= MIN_INTERVAL_MS) {
                                const msg = bm.charging ? 'user connected to charger, tell approximate charging time for 5000mah battery with last known battery level' : 'user disconnected from charger, briefly tell the user last known battery level';
                                sendContextualMessage(msg);
                                if (window.debugLog) window.debugLog(`BATTERY: chargingchange -> ${bm.charging ? 'charging' : 'not charging'} (sent)`, 'system');
                                lastChargeState = bm.charging;
                                lastChargeSentAt = now;
                            }
                        } catch (_) { }
                    };
                    if (typeof bm.addEventListener === 'function') {
                        try { bm.addEventListener('levelchange', sendLevelUpdate); } catch (_) { }
                        try { bm.addEventListener('chargingchange', sendChargeUpdate); } catch (_) { }
                    } else if (typeof bm.onlevelchange !== 'undefined') {
                        try { bm.onlevelchange = sendLevelUpdate; } catch (_) { }
                        try { bm.onchargingchange = sendChargeUpdate; } catch (_) { }
                    }
                } catch (_) { }
            } else {
                payload.push('');
                payload.push('');
            }
        } catch (_) {
            payload.push('');
            payload.push('');
        }
        const payloadString = payload.join("|");
        const utf8Bytes = new TextEncoder().encode(payloadString);
        const binaryString = Array.from(utf8Bytes, byte => String.fromCharCode(byte)).join('');
        const base64 = window.btoa(binaryString)
            .replace(/\//g, '_')
            .replace(/\+/g, '-')
            .replace(/=/g, '');
        loaderStatus('fetching session signature');
        const response = await fetch('/api/signed-url/' + base64);
        if (!response.ok)
            throw new Error('Failed to get signed URL');
        const data = await response.json();
        if (data.uid) {
            localStorage.setItem('uid', data.uid);
        }
        loaderStatus('preparing session');
        return data;
    } catch (error) {
        throw error;
    }
}
function handleConversationError(error) {
    _err.play();
    hideDisconnectionBox();
    flush();
    try { showAppStatus('error occurred'); } catch (_) { }
    if (error?.reason) {
        try { showAppStatus(String(error.reason)); } catch (_) { }
    }
    connected = false;
    updateSpeakingState(-1);
}
function processXmlTags(messageObj) {
    let data = [];
    const hasAngles = messageObj.message.indexOf("<") > -1 && messageObj.message.indexOf(">") > -1;
    if (!hasAngles) return;
    data = xmlToJson(messageObj.message);
    messageObj.message = stripXmlTags(messageObj.message);
    if (!data || (Array.isArray(data) && data.length === 0)) {
        return;
    }
    const tags = Array.isArray(data) ? data : [data];
    try {
        const silenceCount = tags.reduce((n, t) => (t && t.tag === 'silence') ? n + 1 : n, 0);
        if (silenceCount > 0) {
            if (speakingState === 1) {
                window.debugLog('CONTEXT: silence tag received but agent is still talking', 'system');
                return;
            } else {
                window.debugLog(`CONTEXT: silence tag${silenceCount > 1 ? 's' : ''} received - muting audio once for 900ms`, 'system');
                const currentValue = masterGainNode.gain.value;
                masterGainNode.gain.value = 0;
                setTimeout(function () {
                    masterGainNode.gain.value = currentValue;
                }, 900);
            }
        }
    } catch (_) { }
    console.log(tags);
    for (const tag of tags) {
        if (!tag || !tag.tag) continue;
        if (tag.tag === 'silence') continue;
        switch (tag.tag) {
            case "silence":
                break;
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
                    const contextMsg = `<system-reminder>Use this ${tag.attr.type} for next question: ${tag.attr.value}  ${subcontext}.</system-reminder>`;
                    sendContextualMessage(contextMsg);
                    window.debugLog(`CONTEXT: ${tag.attr.type} entity noted - ${tag.attr.value}`, 'system');
                }
                break;
            case "eval":
                conversation.sendUserMessage(tag.attr.prompt);
                break;
            case "respond":
                sendContextualMessage(
                    "Respond to this instruction by using following context. \n\n Instruction: " +
                    tag.attr.prompt +
                    ". \n\n Context: " + messageObj.message
                );
                break;
            case "instruct":
                sendContextualMessage(tag.attr.prompt);
                break;
            case "notify":
                showNotification(tag.attr.title, tag.attr.message);
                break;
            case "reset":
                localStorage.clear();
                setTimeout(function () { location.reload(); }, 2500);
                break;
            case "code":
                handleCodeExecution(tag);
                break;
        }
    }
}
function handleAiMessage(m) {
    window.debugLog('AI: ' + m.message, 'ai');
    const cleanMessage = stripXmlTags(m.message);
    if (cleanMessage && cleanMessage.trim() && controlSocket && controlSocketReady) {
        try {
            controlSocket.send(JSON.stringify({
                type: 'transcript',
                role: 'agent',
                message: cleanMessage,
                timestamp: Date.now()
            }));
        } catch (e) {
            console.error('Failed to send transcript:', e);
        }
    }
    processXmlTags(m);
    if (m.message && m.message.trim().length > 0) {
        showSubtitle(m.message);
    }
}
function handleUserMessage(m) {
    const cleanMessage = stripXmlTags(m.message);
    if (cleanMessage && cleanMessage.trim() && cleanMessage !== "..." && controlSocket && controlSocketReady) {
        try {
            controlSocket.send(JSON.stringify({
                type: 'transcript',
                role: 'user',
                message: cleanMessage,
                timestamp: Date.now()
            }));
        } catch (e) {
            console.error('Failed to send transcript:', e);
        }
    }
    if (window.imageGallery && m.message !== "...") {
        window.imageGallery.fadeOutSequentially();
    }
    if (!userInitialized) {
        userInitialized = true;
        wsApiRequest('POST', '/api/user-init', {})
            .then(response => response.json || {})
            .then(data => {
                if (data.success) {
                } else {
                }
            })
            .catch(error => {
            });
    }
}
async function handleToolCall(cmd, param, text = "") {
    if (param === "context") {
        for (let i = transcript.length - 1; i >= 0; i--) {
            const entry = transcript[i];
            if (entry && entry.from === 'user' && entry.msg && entry.msg.trim() && entry.msg !== '...') {
                param = String(entry.msg).trim();
                window.debugLog(`TOOL: Using last user message as context: "${param}"`, 'system');
                break;
            }
        }
    }
    const serverTools = [
        'web-search', 'get-weather', 'latest-news', 'currency-convert',
        'latest-earthquakes', 'poi-search', 'visible-aircraft',
        'local-events', 'get-address', 'flight-search', 'author'
    ];
    const toolDesc = [
        'SEARCHING WEB, PLEASE WAIT', 'FETCHING CURRENT WEATHER', 'GETTING LATEST NEWS', 'FETCHING LATEST FX RATES',
        'CHECKING LATEST EARTHQUAKES', 'LOOKING FOR NEARBY POINTS OF INTEREST', 'TRACKING AIRCRAFTS',
        'LOOKING UP FOR EVENTS', 'RESOLVING ADDRESS', 'SEARCHING FOR FLIGHTS', 'GENERATING CONTENT PLEASE WAIT'
    ];
    if (serverTools.includes(cmd)) {
        isToolLoading = true;
        showAppStatus('working');
        toolStatus(toolDesc[serverTools.indexOf(cmd)] || 'PROCESSING REQUEST PLEASE WAIT');
    }
    window.debugLog(`TOOL: ${cmd} (${param || 'no param'})`, 'system');
    try {
        let endpoint = '';
        let response;
        let data;
        switch (cmd) {
            case 'image-search':
                endpoint = `/api/tool/${cmd}/${encodeURIComponent(param)}`;
                window.debugLog(`TOOL: Fetching ${endpoint}`, 'system');
                response = await wsApiRequest('GET', endpoint);
                if (!response.ok) {
                    throw new Error(`Tool request failed with status ${response.status}`);
                }
                data = response.json;
                if (data && Array.isArray(data) && data.length > 0) {
                    if (window.imageGallery) {
                        window.imageGallery.loadImages(data);
                        _action.play();
                    }
                }
                break;
            case 'poi-search':
                if (text === "") {
                    hiss("tool_call");
                } else {
                    window.debugLog(`TOOL: payload: ` + text, 'system');
                }
                try {
                    const card = getHeadingCardinal();
                    const deg = getHeadingDeg();
                    if (card || (deg != null)) {
                        const msg = `User heading ${card || ''}${(deg != null) ? ` (${Math.round(deg)}°)` : ''}`.trim();
                        sendContextualMessage(msg);
                        window.debugLog(`CONTEXT: ${msg}`, 'system');
                    }
                } catch (_) { }
                if (userCoordinates && userCoordinates.latitude !== 0 && userCoordinates.longitude !== 0) {
                    const coords = `${userCoordinates.latitude},${userCoordinates.longitude}`;
                    endpoint = `/api/tool/poi-search/${encodeURIComponent(coords)}/${encodeURIComponent(param)}`;
                } else {
                    endpoint = `/api/tool/poi-search/0,0/${encodeURIComponent(param)}`;
                }
                window.debugLog(`TOOL: Fetching ${endpoint}`, 'system');
                response = await wsApiRequest('GET', endpoint);
                if (!response.ok) {
                    throw new Error(`Tool request failed with status ${response.status}`);
                }
                data = response.text;
                window.debugLog(`Final tool step: ${cmd}`, 'system');
                conversation.sendUserMessage(data);
                window.debugLog(`TOOL: ${cmd} completed successfully`, 'system');
                isToolLoading = false;
                toolStatus();
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
                    window.debugLog(`TOOL: payload: ` + text, 'system');
                }
                endpoint = `/api/tool/${cmd}/${encodeURIComponent(param)}`;
                window.debugLog(`TOOL: Fetching ${endpoint}`, 'system');
                response = await wsApiRequest('GET', endpoint);
                if (!response.ok) {
                    throw new Error(`Tool request failed with status ${response.status}`);
                }
                data = response.text;
                window.debugLog(`Final tool step: ${cmd}`, 'system');
                sendContextualMessage('<system-reminder>' + data + "</system-reminder>");
                window.debugLog(`TOOL: ${cmd} completed successfully`, 'system');
                isToolLoading = false;
                toolStatus();
                break;
            case 'author':
                window.debugLog(`TOOL: author - Generating content for "${param}"`, 'system');
                try {
                    if (text === "") {
                        hiss("tool_call");
                    } else {
                        window.debugLog(`TOOL: payload: ` + text, 'system');
                    }
                    endpoint = `/api/tool/author/${encodeURIComponent(param)}`;
                    window.debugLog(`TOOL: Fetching ${endpoint}`, 'system');
                    const authorResponse = await wsApiRequest('GET', endpoint);
                    if (!authorResponse.ok) {
                        throw new Error(`Author tool request failed with status ${authorResponse.status}`);
                    }
                    const authorData = authorResponse.text;
                    window.debugLog(`TOOL: author completed successfully`, 'system');
                    sendContextualMessage(authorData);
                } catch (error) {
                    window.debugLog(`TOOL: author error - ${error.message}`, 'system');
                    sendContextualMessage("Content generation error: " + error.message);
                }
                break;
            case 'calculator':
                window.debugLog(`TOOL: calculator - Evaluating "${param}"`, 'system');
                try {
                    const result = evaluate(param);
                    const resultStr = String(result);
                    window.debugLog(`TOOL: calculator result - ${resultStr}`, 'system');
                    sendContextualMessage(resultStr);
                    window.debugLog(`TOOL: calculator completed successfully`, 'system');
                } catch (error) {
                    window.debugLog(`TOOL: calculator error - ${error.message}`, 'system');
                    sendContextualMessage("Calculation error: " + error.message);
                }
                break;
            case 'save-location':
                window.debugLog(`TOOL: save-location - Creating KML file for "${param}"`, 'system');
                const kmlContent = `<?xml version="1.0" encoding="UTF-8"?>
                <kml xmlns="http:
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
                let kfilename = `${param.replace(/[^a-z0-9]/gi, '_')}.kml`;
                kmlLink.download = kfilename;
                document.body.appendChild(kmlLink);
                kmlLink.click();
                document.body.removeChild(kmlLink);
                showNotification("Location saved", "Coordinates saved as " + kfilename);
                setTimeout(() => URL.revokeObjectURL(kmlUrl), 100);
                window.debugLog(`TOOL: save-location completed - Downloaded ${param}.kml`, 'system');
                break;
            case 'take-note':
                window.debugLog(`TOOL: take-note - Creating note file`, 'system');
                let noteContentText = '';
                for (let i = transcript.length - 1; i >= 0; i--) {
                    const entry = transcript[i];
                    if (entry && entry.from === 'user' && entry.msg && entry.msg.trim() && entry.msg !== '...') {
                        noteContentText = String(entry.msg).trim();
                        break;
                    }
                }
                if (!noteContentText) {
                    noteContentText = (param || '').trim();
                }
                if (!noteContentText) {
                    window.debugLog('TOOL: take-note - No user message found to save as note', 'system');
                    showNotification('Note not saved', 'No recent user message found');
                    break;
                }
                const words = noteContentText
                    .toLowerCase()
                    .replace(/[^a-z0-9\s]/gi, ' ')
                    .split(/\s+/)
                    .filter(Boolean);
                let titleWords = words.slice(0, 3);
                while (titleWords.length < 3) titleWords.push('note');
                const noteTitle = titleWords.join('_');
                const noteContent = `# ${noteTitle.replace(/_/g, ' ')}\n\n${noteContentText}\n\n---\n\nSaved on ${new Date().toLocaleString()}\n`;
                const noteBlob = new Blob([noteContent], { type: 'text/markdown' });
                const noteUrl = URL.createObjectURL(noteBlob);
                const noteLink = document.createElement('a');
                noteLink.href = noteUrl;
                noteLink.download = `${noteTitle}.md`;
                showNotification(noteLink.download, 'Note saved to disk');
                document.body.appendChild(noteLink);
                noteLink.click();
                document.body.removeChild(noteLink);
                setTimeout(() => URL.revokeObjectURL(noteUrl), 100);
                _action.play();
                window.debugLog(`TOOL: take-note completed - Downloaded ${noteTitle}.md`, 'system');
                break;
            case 'save-name':
                window.debugLog(`TOOL: save-name - Saving name "${param}" to localStorage`, 'system');
                localStorage.setItem('userName', param);
                window.debugLog(`TOOL: save-name completed`, 'system');
                sendContextualMessage("<system-reminder>User change his name to: " + param + " call him by this name from now on. " + subcontext + "</system-reminder>");
                showNotification("User name changed", "Name changed to " + param);
                break;
            case 'tune-behaviour':
                window.debugLog(`TOOL: tune-behaviour - Processing behaviour tuning request`, 'system');
                try {
                    let lastUserMessage = '';
                    for (let i = transcript.length - 1; i >= 0; i--) {
                        const entry = transcript[i];
                        if (entry && entry.from === 'user' && entry.msg && entry.msg.trim() && entry.msg !== '...') {
                            lastUserMessage = String(entry.msg).trim();
                            break;
                        }
                    }
                    const parts = param.split('|');
                    if (parts.length !== 2 && parts.length !== 3) {
                        window.debugLog(`TOOL: tune-behaviour - Invalid format`, 'system');
                        break;
                    }
                    let category, user_request, user_transcript;
                    if (parts.length === 2) {
                        [category, user_request] = parts;
                        user_transcript = lastUserMessage || user_request;
                    } else {
                        [category, user_request, user_transcript] = parts;
                        if (!user_transcript || user_transcript.trim() === '' || user_transcript === 'undefined') {
                            user_transcript = lastUserMessage || user_request;
                        }
                    }
                    const response = await wsApiRequest('POST', '/api/tool/tune-behaviour', {
                        category: category.trim(),
                        user_request: user_request.trim(),
                        user_transcript: user_transcript.trim()
                    });
                    if (!response.ok) {
                        throw new Error(`Tune-behaviour request failed with status ${response.status}`);
                    }
                    const result = response.json;
                    window.debugLog(`TOOL: tune-behaviour completed - ${result.message}`, 'system');
                    showNotification("Behaviour Updated", "Your preference has been recorded");
                    _action.play();
                    sendContextualMessage("User's behaviour tuning request has been recorded successfully.");
                } catch (error) {
                    window.debugLog(`TOOL: tune-behaviour error - ${error.message}`, 'system');
                }
                break;
            case 'pick-card':
                window.debugLog(`TOOL: pick-card - Attempting to pick random image from gallery`, 'system');
                if (window.imageGallery && window.imageGallery.pickRandomCard) {
                    const result = window.imageGallery.pickRandomCard();
                    if (result.success) {
                        _action.play();
                        window.debugLog(`TOOL: pick-card completed - ${result.comment}`, 'system');
                        sendContextualMessage(`Image selected. Respond with: "${result.comment}"`);
                    } else {
                        window.debugLog(`TOOL: pick-card failed - No images available`, 'system');
                    }
                } else {
                    window.debugLog(`TOOL: pick-card failed - Gallery not available`, 'system');
                }
                break;
            case 'close-card':
                window.debugLog(`TOOL: close-card - Attempting to close image modal`, 'system');
                if (window.imageGallery && window.imageGallery.closeImageModal) {
                    window.imageGallery.closeImageModal();
                    window.debugLog(`TOOL: close-card completed - Modal closed`, 'system');
                } else {
                    window.debugLog(`TOOL: close-card failed - Gallery not available`, 'system');
                }
                break;
            case 'volume-adjust':
                window.debugLog(`TOOL: volume-adjust - Direction: ${param}`, 'system');
                if (window.setMasterVolume && window.getMasterVolume) {
                    const currentVolume = window.getMasterVolume();
                    const maxVolume = 6.0;
                    const adjustment = maxVolume * 0.1;
                    let newVolume;
                    if (param === 'up') {
                        newVolume = Math.min(maxVolume, currentVolume + adjustment);
                        window.debugLog(`TOOL: volume-adjust - Increasing from ${currentVolume.toFixed(2)} to ${newVolume.toFixed(2)}`, 'system');
                    } else if (param === 'down') {
                        newVolume = Math.max(0.0, currentVolume - adjustment);
                        window.debugLog(`TOOL: volume-adjust - Decreasing from ${currentVolume.toFixed(2)} to ${newVolume.toFixed(2)}`, 'system');
                    } else {
                        window.debugLog(`TOOL: volume-adjust - Invalid parameter: ${param}`, 'system');
                        break;
                    }
                    window.setMasterVolume(newVolume);
                    _action.play();
                    if (window.showVolumeBar) {
                        window.showVolumeBar();
                    }
                    window.debugLog(`TOOL: volume-adjust completed - New volume: ${newVolume.toFixed(2)}`, 'system');
                } else {
                    window.debugLog(`TOOL: volume-adjust failed - Volume control not available`, 'system');
                }
                break;
            case 'next-card':
                window.debugLog(`TOOL: next-card - Checking modal state`, 'system');
                const modal = document.getElementById('imageModal');
                const isModalOpen = modal && modal.classList.contains('show');
                if (!isModalOpen && window.imageGallery && window.imageGallery.hasVisibleImages && window.imageGallery.hasVisibleImages()) {
                    window.debugLog(`TOOL: next-card - Modal closed, treating as pick-card`, 'system');
                    if (window.imageGallery.pickRandomCard) {
                        const result = window.imageGallery.pickRandomCard();
                        if (result.success) {
                            _action.play();
                            window.debugLog(`TOOL: next-card (as pick-card) completed - ${result.comment}`, 'system');
                            sendContextualMessage(`Image selected. Respond with: "${result.comment}"`);
                        }
                    }
                } else if (isModalOpen && window.imageGallery && window.imageGallery.showNextImage) {
                    window.debugLog(`TOOL: next-card - Modal open, showing next image`, 'system');
                    window.imageGallery.showNextImage();
                    window.debugLog(`TOOL: next-card completed - Showing next image`, 'system');
                } else {
                    window.debugLog(`TOOL: next-card failed - Gallery not available or no images`, 'system');
                }
                break;
            case 'app-search':
                window.debugLog(`TOOL: app-search - Searching for app: ${param}`, 'system');
                try {
                    let platform = '';
                    let appName = param;
                    if (param.includes(':')) {
                        const parts = param.split(':');
                        platform = parts[0].toLowerCase();
                        appName = parts.slice(1).join(':').trim();
                    } else {
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
                            platform = 'android';
                        }
                    }
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
                    window.debugLog(`TOOL: app-search - Platform: ${platform}, URL: ${storeUrl}`, 'system');
                    const a = document.createElement('a');
                    a.href = storeUrl;
                    a.target = '_blank';
                    a.rel = 'noopener noreferrer';
                    document.body.appendChild(a);
                    a.click();
                    document.body.removeChild(a);
                    _action.play();
                    const contextMsg = `User searched for ${appName} app on ${platform} store`;
                    sendContextualMessage(contextMsg);
                    window.debugLog(`CONTEXT: ${contextMsg}`, 'system');
                    window.debugLog(`TOOL: app-search completed`, 'system');
                } catch (error) {
                    window.debugLog(`TOOL: app-search error - ${error.message}`, 'system');
                }
                break;
            case 'end-session':
                window.debugLog(`TOOL: end-session - Ending conversation session`, 'system');
                localStorage.removeItem('lastTopic');
                if (window.imageGallery) {
                    window.imageGallery.fadeOutSequentially();
                }
                window.userRequestedDisconnect = true;
                setTimeout(function () {
                    conversation.endSession();
                }, 3000);
                window.debugLog(`TOOL: end-session completed`, 'system');
                break;
            case 'language-switch':
                window.debugLog(`TOOL: language-switch - Requested language: ${param}`, 'system');
                const availableLanguages = ['en', 'de', 'es', 'tr'];
                if (!availableLanguages.includes(param)) {
                    window.debugLog(`TOOL: language-switch - Language "${param}" not available`, 'system');
                    break;
                }
                window.debugLog(`TOOL: language-switch - Switching to "${param}"`, 'system');
                setTimeout(() => {
                    localStorage.setItem('prefLang', param);
                    window.debugLog(`TOOL: language-switch - Set prefLang to "${param}", reloading page`, 'system');
                    window.location.reload();
                }, 2000);
                window.debugLog(`TOOL: language-switch completed - Will reload in 2 seconds`, 'system');
                break;
            default:
                window.debugLog(`TOOL: Unknown tool "${cmd}"`, 'system');
                return;
        }
    } catch (error) {
        window.debugLog(`TOOL: Error - ${error.message}`, 'system');
    } finally {
        if (isToolLoading) {
            isToolLoading = false;
            toolStatus();
        }
    }
}
function handleTopic(topic) {
    if (topic.title) {
        const topicData = {
            title: topic.title,
            category: topic.category || '',
            tags: topic.tags || '',
            timestamp: Date.now()
        };
        localStorage.setItem('lastTopic', JSON.stringify(topicData));
        const contextMsg = `<system-reminder>The topic is now: ${topic.title}, ${subcontext}.</system-reminder>`;
        sendContextualMessage(contextMsg);
        window.debugLog(`CONTEXT: ${contextMsg}`, 'system');
        if (window.imageGallery) {
            window.imageGallery.fadeOutSequentially();
        }
        if (topic.category) {
            showCategoryIndicator(topic.category);
        }
        updateTopicDisplay(topic.title, topic.tags || '');
    }
}

function handleCodeExecution(tag) {
    const code = (tag.attr && tag.attr.content) || tag.text || '';
    if (!code || code.trim().length === 0) {
        window.debugLog('CODE: No code provided', 'system');
        sendContextualMessage('<system-reminder>Code execution failed: No code provided</system-reminder>');
        return;
    }
    window.debugLog(`CODE: Executing code (${code.length} chars)`, 'system');
    let result;
    let error = null;
    try {
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
        const executionResult = eval(isolatedCode);
        if (executionResult.success) {
            result = executionResult.result;
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
            window.debugLog(`CODE: Execution successful`, 'system');
            sendContextualMessage(`<system-reminder>here is the result of code tool:\n${resultStr}</system-reminder>`);
        } else {
            error = executionResult.error;
            const errorMsg = `Code execution error: ${error}`;
            window.debugLog(`CODE: Execution failed - ${error}`, 'system');
            sendContextualMessage(`<system-reminder>here is the result of code tool: Error - ${error}</system-reminder>`);
        }
    } catch (e) {
        error = e.message;
        const errorMsg = `Code execution error: ${error}`;
        window.debugLog(`CODE: Execution failed - ${error}`, 'system');
        sendContextualMessage(`<system-reminder>here is the result of code tool: Error - ${error}</system-reminder>`);
    }
}

async function hiss(cat = "tool_call") {
    try {
        isHissPlaying = true;
        const response = await wsApiRequest('GET', '/api/sentence/' + cat + "/" + localStorage.getItem('prefLang'));
        if (!response.ok) throw new Error('Failed to fetch sentence audio');
        const audioData = response.arrayBuffer;
        const audioBuffer = await conversation.output.context.decodeAudioData(audioData);
        const source = conversation.output.context.createBufferSource();
        source.buffer = audioBuffer;
        const tempWetGain = conversation.output.context.createGain();
        const tempDryGain = conversation.output.context.createGain();
        const tempMixGain = conversation.output.context.createGain();
        const currentTime = conversation.output.context.currentTime;
        tempWetGain.gain.setValueAtTime(0, currentTime);
        tempDryGain.gain.setValueAtTime(0, currentTime);
        tempMixGain.gain.setValueAtTime(0, currentTime);
        tempWetGain.gain.linearRampToValueAtTime(0.3, currentTime + 0.01);
        tempDryGain.gain.linearRampToValueAtTime(0.7, currentTime + 0.01);
        tempMixGain.gain.linearRampToValueAtTime(0.5, currentTime + 0.01);
        const tempConvolver = conversation.output.context.createConvolver();
        tempConvolver.buffer = impulse;
        source.connect(tempDryGain);
        source.connect(tempConvolver);
        tempConvolver.connect(tempWetGain);
        tempWetGain.connect(tempMixGain);
        tempDryGain.connect(tempMixGain);
        tempMixGain.connect(masterGainNode);
        source.onended = () => {
            isHissPlaying = false;
        };
        source.start(0);
    } catch (error) {
        isHissPlaying = false;
        _talk.play();
    }
}

async function startConversation() {
    try {
        const tools = await initializeTools();
        if (tools && tools.controlWsUrl) {
            try { connectControlSocket(tools.controlWsUrl); } catch (_) { }
        }
        const prefLang = localStorage.getItem('prefLang') || 'en';
        loaderStatus('starting session');
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
                connected = true;
                updateSpeakingState(0);
                conversationStartTime = Date.now();
                _join.play();
                hideDisconnectionBox();
                loaderStatus('connected');
                _acquireWakeLockIfMobile();
                initSubtitleCanvas();
                setTimeout(() => {
                    hideStatusDisplay();
                }, 500);
                if (controlSocket && controlSocketReady) {
                    try {
                        controlSocket.send(JSON.stringify({
                            type: 'transcript',
                            role: 'system',
                            message: 'SESSION_START',
                            timestamp: conversationStartTime
                        }));
                    } catch (e) {
                        console.error('Failed to send session start:', e);
                    }
                }
                const callControls = document.getElementById('callControls');
                if (callControls) {
                    callControls.classList.add('connected');
                }
                const volumeCanvas = document.getElementById('volumeCanvas');
                if (volumeCanvas) {
                    volumeCanvas.classList.add('connected');
                }
                const topicDisplay = document.getElementById('topicDisplay');
                if (topicDisplay) {
                    topicDisplay.classList.add('connected');
                }
                clearTopicDisplay();
                /* The above code is dispatching a custom event named 'agent-connected' on the window
                object. This event can be used to notify other parts of the code that an agent has
                connected. */
                window.dispatchEvent(new Event('agent-connected'));
                setTimeout(function () {
                    startCoordinateMonitoring();
                }, 2000);
            },
            onDisconnect: () => {
                agentTalking = false;
                setSubtitleAgentTalking(agentTalking);
                connected = false;
                updateSpeakingState(-1);
                flush();
                fadeOutSubtitle(700);
                _leave.play();
                _releaseWakeLock();
                const sessionEndTime = Date.now();
                const sessionDuration = sessionEndTime - conversationStartTime;
                if (controlSocket && controlSocketReady) {
                    try {
                        controlSocket.send(JSON.stringify({
                            type: 'transcript',
                            role: 'system',
                            message: 'SESSION_END',
                            timestamp: sessionEndTime,
                            duration: sessionDuration
                        }));
                    } catch (e) {
                        console.error('Failed to send session end:', e);
                    }
                }
                stopCoordinateMonitoring();
                if (window.imageGallery) {
                    window.imageGallery.fadeOutSequentially();
                }
                const callControls = document.getElementById('callControls');
                if (callControls) {
                    callControls.classList.remove('connected');
                }
                const volumeCanvas = document.getElementById('volumeCanvas');
                if (volumeCanvas) {
                    volumeCanvas.classList.remove('connected');
                }
                const topicDisplay = document.getElementById('topicDisplay');
                if (topicDisplay) {
                    topicDisplay.classList.remove('connected');
                }
                clearTopicDisplay();
                window.dispatchEvent(new Event('agent-disconnected'));
                const textWindow = document.getElementById('textInputWindow');
                if (textWindow) {
                    textWindow.style.display = 'none';
                }
                if (!window.userRequestedDisconnect) {
                    showAppStatus('reconnecting');
                    setTimeout(async () => {
                        try {
                            await reconnectAgent();
                        } catch (error) {
                            showDisconnectionBox();
                        }
                    }, 2000);
                } else {
                    showDisconnectionBox();
                    window.userRequestedDisconnect = false;
                }
            },
            onError: (error) => handleConversationError(error),
            onModeChange: (m) => {
                if (m.mode === "speaking") {
                    agentTalking = true;
                    updateSpeakingState(1);
                    cancelSubtitleAutoFade();
                    setSubtitleAgentTalking(agentTalking);
                } else {
                    agentTalking = false;
                    updateSpeakingState(isSpeaking ? 2 : 0);
                    setSubtitleAgentTalking(agentTalking);
                    scheduleSubtitleFadeAfter(1500);
                }
            },
            onMessage: (m) => {
                transcript.push({ "from": m.source, "msg": m.message, "time": (Math.floor(Date.now() / 1000)) });
                if (m.source === "ai") {
                    handleAiMessage(m);
                } else if (m.source === "user") {
                    handleUserMessage(m);
                }
            }
        });
        conversation.setVolume({ volume: 1.0 });
        window.conversation = conversation;
        (function attachConversationDebugLogging(conv) {
            try {
                if (!conv || conv._debugLogWrapped) return;
                const log = (window.debugLog) ? window.debugLog : function () { };
                if (typeof conv.sendUserMessage === 'function') {
                    const originalSend = conv.sendUserMessage.bind(conv);
                    conv.sendUserMessage = async (message) => {
                        try {
                            const text = (typeof message === 'string') ? message : String(message || '');
                            const isSystem = text.includes('<system-reminder>');
                            const label = isSystem ? 'SYSTEM REMINDER' : 'USER';
                            log(`${label}: ${text}`, isSystem ? 'system' : 'user');
                        } catch (_) { }
                        return await originalSend(message);
                    };
                }
                if (typeof conv.sendContextualUpdate === 'function') {
                    const originalCtx = conv.sendContextualUpdate.bind(conv);
                    conv.sendContextualUpdate = async (message) => {
                        try {
                            const text = (typeof message === 'string') ? message : String(message || '');
                            log(`CONTEXT: ${text}`, 'system');
                        } catch (_) { }
                        return await originalCtx(message);
                    };
                }
                conv._debugLogWrapped = true;
            } catch (_) { }
        })(conversation);
        hideLoaderOverlay();
        convolver = conversation.output.context.createConvolver();
        agentAnalyser = conversation.output.analyser;
        impulse = await createReverb(0.75, 1.25, false);
        convolver.buffer = impulse;
        const wetGain = conversation.output.context.createGain();
        const dryGain = conversation.output.context.createGain();
        wetGain.gain.value = 0.3;
        dryGain.gain.value = 0.7;
        masterGainNode = conversation.output.context.createGain();
        const savedVolume = localStorage.getItem('masterVolume');
        if (savedVolume !== null) {
            const parsed = parseFloat(savedVolume);
            if (!isNaN(parsed)) {
                masterGainNode.gain.value = Math.max(0.0, Math.min(6.0, parsed));
            } else {
                masterGainNode.gain.value = 1.1;
            }
        } else {
            masterGainNode.gain.value = 1.1;
        }
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
                window.debugLog(`CONTEXT: ${contextMsg}`, 'system');
            }
        };
        window.onfocus = function () {
            if (connected) {
                window.debugLog(`CONTEXT: ${contextMsg}`, 'system');
            }
        };
    } catch (error) {
        connected = false;
        updateSpeakingState(-1);
        let msg = '[unable to connect to voice service]';
        if (error && (error.reason || error.message)) {
            const r = (error.reason || error.message).toString().toLowerCase();
            if (r.includes('websocket') || r.includes('ws')) {
                msg = '[unable to connect to websocket service]';
            }
        }
        try { loaderStatus(msg.replace(/^\[|\]$/g, '')); } catch (_) { }
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
    if (hasMicrophoneError()) return;
    window.persistAudioStream = stream;
    loaderStatus('initializing audio context');
    audioContent = new AudioContext();
    audioStream = audioContent.createMediaStreamSource(stream);
    loaderStatus('initializing analyser');
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
    const prefLang = localStorage.getItem('prefLang');
    if (prefLang) {
        (async function () {
            loaderStatus('connecting to agent');
            await startConversation();
        })();
    } else {
        loaderStatus('select language');
        fadeOutSubtitle(700);
        const _languageSelector = document.getElementById('languageSelectionOverlay');
        _languageSelector.style.display = 'flex';
    }
}
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
    const hueRotation = (npt * 0.5) % 30;
    const baseHue = 15 + hueRotation;
    grd.addColorStop(0, `hsl(${baseHue}, 25%, 8%)`);
    grd.addColorStop(1, `hsl(${baseHue}, 30%, 3%)`);
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
    let rot = 20;
    if (connected === false) {
        const noiseSpeed = 256;
        npt += noiseSpeed / 100000;
        nrt += noiseSpeed / 300000;
        rot = 3;
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
        if (agentTalking === true) {
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
    if (hasMicrophoneError()) return;
    clear();
    drawSpectrum();
    redrawSubtitle();
    window.speakingTime = getSpeakingTime();
    requestAnimationFrame(render);
}
function hideLoaderOverlay() { }
window.showNotification = showNotification;
window.hiss = hiss;
window.reconnectAgent = reconnectAgent;
window.userRequestedDisconnect = false;
window.sendControlMessage = function (payload) {
    console.warn('sendControlMessage is deprecated - use direct HTTP API calls instead');
    if (!controlSocket || !controlSocketReady) return false;
    try { controlSocket.send(JSON.stringify(payload)); return true; } catch (_) { return false; }
};
window.postLangSel = async function () {
    if (audioContent && analyser) {
        await startConversation();
    }
};

(function () {
    window.speakingState = speakingState;
    window.speakingTime = speakingTime;
    window.getSpeakingTime = getSpeakingTime;
    window.getStateDebugInfo = getStateDebugInfo;
    setSubtitleAgentTalking(agentTalking);
    loaderStatus('loading assets');
    window.onresize = function () {
        w = window.innerWidth;
        h = window.innerHeight;
        if (ctx) {
            ctx.canvas.width = w;
            ctx.canvas.height = h;
        }
        updateSubtitleCanvasSize(w, h);
    };
    if (!AudioContext) {
        loaderStatus('audio not supported by browser');
        _err.play();
        hideLoaderOverlay();
        return;
    }
    detectPerformance();
    loaderStatus('initializing');
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
        loaderStatus('initializing ui');
    }
    async function checkMicrophone() {
        const constraints = {
            audio: { noiseSuppression: true }
        };
        if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
            connected = false;
            updateSpeakingState(-1);
            loaderStatus('media api unavailable');
            showMicrophoneError('media_api_unavailable');
            _err.play();
            return false;
        }
        loaderStatus('checking microphone');
        try {
            const stream = await navigator.mediaDevices.getUserMedia(constraints);
            loaderStatus('microphone access granted');
            return stream;
        } catch (e) {
            connected = false;
            updateSpeakingState(-1);
            let msg = "[cannot access microphone]";
            let errorType = 'no_microphone';
            if (e && (e.name || e.code)) {
                const name = e.name || e.code;
                if (name === 'NotAllowedError' || name === 'PermissionDeniedError') {
                    msg = "[microphone permission denied]";
                    errorType = 'permission_denied';
                }
                else if (name === 'NotFoundError' || name === 'DevicesNotFoundError') {
                    msg = "[no input audio source detected]";
                    errorType = 'no_audio_input';
                }
                else if (name === 'NotReadableError') {
                    msg = "[microphone is in use or unavailable]";
                    errorType = 'microphone_in_use';
                }
            }
            showMicrophoneError(errorType);
            hideLoaderOverlay();
            _err.play();
            return false;
        }
    }
    checkMicrophone().then(function (stream) {
        if (!stream) {
            return;
        }
        loaderStatus('verifying microphone');
        const track = stream.getAudioTracks()[0];
        const deviceId = track.getSettings().deviceId;
        navigator.mediaDevices.enumerateDevices().then(devices => {
            const audioInputs = devices.filter(d => d.kind === 'audioinput');
            if (!audioInputs || audioInputs.length === 0) {
                connected = false;
                updateSpeakingState(-1);
                loaderStatus('no input audio source detected');
                showMicrophoneError('no_audio_input');
                hideLoaderOverlay();
                _err.play();
                return;
            }
            const activeMic = devices.find(device => device.deviceId === deviceId);
            micName = (activeMic ? activeMic.label : "Unknown").toString();
            if (micName !== "" && isStereoMix(micName) === true) {
                connected = false;
                updateSpeakingState(-1);
                loaderStatus('no microphone detected');
                showMicrophoneError('stereo_mix');
                _err.play();
                hideLoaderOverlay();
                return;
            }
            loaderStatus('preparing audio');
            initializeAudio(stream);
        }).catch(function (err) {
            console.error('Error enumerating devices:', err);
            loaderStatus('error checking microphone');
            showMicrophoneError('no_microphone');
            _err.play();
        });
    });
})();

(function initVolumeBar() {
    const volumeCanvas = document.getElementById('volumeCanvas');
    const ctx = volumeCanvas.getContext('2d');
    const WIDTH = 64;
    const HEIGHT = 260;
    const LINES = 100;
    const LINE_HEIGHT = 1;
    const LINE_SPACING = HEIGHT / LINES;
    const MAX_VOLUME = 6.0;
    volumeCanvas.width = WIDTH;
    volumeCanvas.height = HEIGHT;
    let currentVolume = 1.0;
    const savedVolume = localStorage.getItem('masterVolume');
    if (savedVolume !== null) {
        const parsed = parseFloat(savedVolume);
        if (!isNaN(parsed)) {
            currentVolume = Math.max(0.0, Math.min(MAX_VOLUME, parsed));
        }
    }
    let isDragging = false;
    function drawVolumeBar() {
        ctx.clearRect(0, 0, WIDTH, HEIGHT);
        const volumePercent = (currentVolume / MAX_VOLUME) * 100;
        for (let i = 0; i < LINES; i++) {
            const lineIndex = LINES - 1 - i;
            const y = i * LINE_SPACING;
            const lineWidth = 5 + (lineIndex / (LINES - 1)) * (WIDTH - 5);
            const linePercent = (lineIndex / (LINES - 1)) * 100;
            if (linePercent <= volumePercent) {
                ctx.strokeStyle = '#ff0c0c';
            } else {
                ctx.strokeStyle = '#808080';
            }
            ctx.lineWidth = LINE_HEIGHT;
            ctx.beginPath();
            ctx.moveTo(WIDTH - lineWidth, y);
            ctx.lineTo(WIDTH, y);
            ctx.stroke();
        }
    }
    function setVolume(volume) {
        currentVolume = Math.max(0.0, Math.min(MAX_VOLUME, volume));
        if (masterGainNode) {
            masterGainNode.gain.value = currentVolume;
        }
        localStorage.setItem('masterVolume', currentVolume.toString());
        drawVolumeBar();
    }
    function getVolumeFromY(y) {
        const rect = volumeCanvas.getBoundingClientRect();
        const relativeY = y - rect.top;
        const percentage = 1.0 - (relativeY / HEIGHT);
        return Math.max(0.0, Math.min(MAX_VOLUME, percentage * MAX_VOLUME));
    }
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
    volumeCanvas.addEventListener('click', (e) => {
        setVolume(getVolumeFromY(e.clientY));
    });
    let volumeBarTimeout = null;
    function showVolumeBarTemporarily() {
        if (volumeBarTimeout) {
            clearTimeout(volumeBarTimeout);
        }
        volumeCanvas.style.opacity = '1';
        volumeBarTimeout = setTimeout(() => {
            volumeCanvas.style.opacity = '0';
            volumeBarTimeout = null;
        }, 5000);
    }
    window.setMasterVolume = setVolume;
    window.getMasterVolume = () => currentVolume;
    window.showVolumeBar = showVolumeBarTemporarily;
    drawVolumeBar();
})();
initTouchUI(TOUCH_UI_TIMEOUT);
