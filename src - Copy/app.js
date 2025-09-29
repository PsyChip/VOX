"use strict";

import { Conversation } from '@elevenlabs/client';
let conversation = null;

var _leave = new sound("/static/VoiceLeave.ogg");
var _join = new sound("/static/VoiceJoin.ogg");
var _err = new sound("/static/VoiceError.ogg");
var subtitle = document.getElementById("subtitle");
var stimer;

const SPEECH_THRESHOLD = 15;
const SILENCE_THRESHOLD = 10;
const MIN_SPEECH_SAMPLES = 5;
const END_SENTENCE_PAUSE = 800;
const subkeep = 60;

let connected = false;
let isSpeaking = false;
let speechEnergy = 0;
let silenceTimer = null;
let speechSamplesAboveThreshold = 0;
let lastSpeechTimestamp = 0;
let lowEnd = false;
let veryLowEnd = false;
let temporaryOverdrive = false;

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
let subtitles = [];
var sid = 0;
let micName = "";
let convolver;
let impulse;
let _stateIndicatorEl = null;

const LOADER_DOT_COUNT = 90;
const LOADER_RADIUS = 80;
let loaderOverlay = null;
let loaderDots = [];
let loaderFrame = null;
let loaderTime = 0;
let loaderActive = false;
let hasDrawnFrame = false;

const config = {
    circleRadius: 80,
    multiplier: 38,
    colorSpeed: 10,
    hueStart: 0,
    glow: 12,
    coef: 0.15,
    smoothing: 0.64
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

function splitIntoSentences(text) {
    return text.match(/[^.!?]+[.!?]+/g) || [];
}

function showSubtitle() {
    if (subtitles.length === 0 || sid > subtitles.length - 1) {
        subtitle.innerHTML = "";
        return;
    }
    subtitle.innerHTML = subtitles[sid];
    var len = subtitles[sid].length * subkeep;
    sid++;
    stimer = setTimeout(function () {
        showSubtitle();
    }, len);
}

function detectPerformance() {
    const hasVeryLowMemory = navigator.deviceMemory && navigator.deviceMemory <= 4;
    const hasLowMemory = navigator.deviceMemory && navigator.deviceMemory < 8;

    if (hasVeryLowMemory) {
        veryLowEnd = true;
        lowEnd = false;
        console.log("Very low performance mode enabled");
    } else if (hasLowMemory) {
        lowEnd = true;
        console.log("Low performance mode enabled");
    }

    if (window.location.search.includes('lowend=verylow')) {
        veryLowEnd = true; lowEnd = false;
    } else if (window.location.search.includes('lowend=true')) {
        lowEnd = true; veryLowEnd = false;
    } else if (window.location.search.includes('lowend=false')) {
        lowEnd = false; veryLowEnd = false;
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
            console.log("Speech started");
            hideListPanel();
        }

        lastSpeechTimestamp = now;
    } else if (isSpeaking && speechEnergy < SILENCE_THRESHOLD) {
        const silenceDuration = now - lastSpeechTimestamp;

        if (!silenceTimer && silenceDuration > 300) {
            silenceTimer = setTimeout(() => {
                isSpeaking = false;
                speechSamplesAboveThreshold = 0;
                console.log("End of sentence detected");
                onEndOfSentenceDetected();
                silenceTimer = null;
            }, END_SENTENCE_PAUSE);
        }
    } else {
        speechSamplesAboveThreshold = Math.max(0, speechSamplesAboveThreshold - 1);
    }
}

function onEndOfSentenceDetected() {
    if (veryLowEnd) return;
    const indicator = document.createElement("div");
    indicator.style.position = "fixed";
    indicator.style.bottom = "20px";
    indicator.style.right = "20px";
    indicator.style.background = "rgba(0,255,0,0.3)";
    indicator.style.padding = "5px 10px";
    indicator.style.borderRadius = "5px";
    indicator.innerText = "End of sentence";
    document.body.appendChild(indicator);

    setTimeout(() => {
        indicator.remove();
    }, 1000);
}

function showDisconnectionBox() {
    hideDisconnectionBox();

    const box = document.createElement("div");
    box.id = "disconnectionBox";
    box.style.position = "fixed";
    box.style.bottom = "20px";
    box.style.left = "50%";
    box.style.transform = "translateX(-50%)";
    box.style.background = "rgba(33, 33, 33, 1)";
    box.style.color = "#fff";
    box.style.padding = "12px 20px";
    box.style.borderRadius = "8px";
    box.style.border = "0px solid rgba(255, 255, 255, 0.2)";
    box.style.display = "flex";
    box.style.alignItems = "center";
    box.style.gap = "12px";
    box.style.zIndex = "1000";
    box.style.fontSize = "14px";
    box.style.fontFamily = "Jost, system-ui, -apple-system, sans-serif";

    const message = document.createElement("span");
    message.textContent = "Agent is disconnected";

    const button = document.createElement("button");
    button.textContent = "Call again";
    button.style.background = "#1b5b01";
    button.style.color = "#fff";
    button.style.border = "none";
    button.style.padding = "6px 12px";
    button.style.borderRadius = "4px";
    button.style.cursor = "pointer";
    button.style.fontSize = "12px";
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
    await startConversation();
}

function showListPanel(content) {
    const panel = document.getElementById("listPanel");
    const listContent = document.getElementById("listContent");

    const lines = content.split('\n').filter(line => line.trim());
    let htmlContent = '';
    let isNumberedList = false;
    let isBulletList = false;

    for (let line of lines) {
        if (line.match(/^\d+\.\s*(.+)$/)) {
            isNumberedList = true;
            break;
        } else if (line.match(/^[-*•]\s*(.+)$/)) {
            isBulletList = true;
            break;
        }
    }

    if (isNumberedList) {
        htmlContent = '<ol>';
        for (let line of lines) {
            const match = line.match(/^\d+\.\s*(.+)$/);
            if (match) {
                htmlContent += `<li>${match[1].trim()}</li>`;
            }
        }
        htmlContent += '</ol>';
    } else if (isBulletList) {
        htmlContent = '<ul>';
        for (let line of lines) {
            const match = line.match(/^[-*•]\s*(.+)$/);
            if (match) {
                htmlContent += `<li>${match[1].trim()}</li>`;
            }
        }
        htmlContent += '</ul>';
    } else {
        const colonIndex = content.indexOf(':\n\n');
        if (colonIndex !== -1) {
            const listContent = content.substring(colonIndex + 3).trim();
            const listLines = listContent.split('\n').filter(line => line.trim());
            htmlContent = '<ul>';
            for (let line of listLines) {
                if (line.trim()) {
                    htmlContent += `<li>${line.trim()}</li>`;
                }
            }
            htmlContent += '</ul>';
        }
    }

    listContent.innerHTML = htmlContent;
    panel.classList.add("show");
}

function hideListPanel() {
    const panel = document.getElementById("listPanel");
    panel.classList.remove("show");
}

async function initializeTools() {
    try {
        const response = await fetch('/api/signed-url/' + getDayPhase());
        if (!response.ok)
            throw new Error('Failed to get signed URL');
        const data = await response.json();
        return data;
    } catch (error) {
        console.error('Error getting signed URL:', error);
        throw error;
    }
}


async function startConversation() {
    try {
        const tools = await initializeTools();
        console.log(tools);
        conversation = await Conversation.startSession({
            signedUrl: tools.signedUrl,
            overrides: {
                agent: {
                    prompt: {
                        prompt: tools.system,
                        tool_ids: ["tool_01k0hw6g2hfdfscx17h0v1s4s1", "tool_01k0j08qadf76b8yd0y98dq1mm"],
                    },
                    firstMessage: tools.firstMessage,
                },
            },
            clientTools: {
                open_link: async (url) => {
                    if (typeof url !== 'string') {
                        url = url.url || url.href || '';
                    }
                    console.log("Opening link:", url);
                    const a = document.createElement("a");
                    a.href = url;
                    a.target = "_blank";
                    a.rel = "noopener noreferrer";
                    document.body.appendChild(a);
                    a.click();
                    document.body.removeChild(a);
                    _join.play();
                    return true;
                }
            },
            onConnect: () => {
                console.log('Connected');
                connected = true;
                _join.play();
                hideDisconnectionBox();
                if (veryLowEnd) setStateIndicator('idle');
            },
            onDisconnect: () => {
                agentTalking = false;
                connected = false;
                console.log('Disconnected');
                clearTimeout(stimer);
                flush();
                subtitle.innerHTML = "[agent disconnected]";
                setTimeout(function () {
                    subtitle.innerHTML = "";
                }, 1000);
                _leave.play();
                showDisconnectionBox();
                if (veryLowEnd) setStateIndicator('loading');
            },
            onError: (error) => {
                console.error('Conversation error:', error);

                _err.play();
                flush();
                clearTimeout(stimer);
                subtitle.innerHTML = "[error occurred]";
                if (error.reason) {
                    subtitle.innerHTML = "[" + error.reason + "]";
                }
                connected = false;
                if (veryLowEnd) setStateIndicator('idle');
            },
            onModeChange: (m) => {
                console.log(m);
                if (m.mode === "speaking") {
                    agentTalking = true;
                    if (veryLowEnd) setStateIndicator('agent');
                } else {
                    agentTalking = false;
                    clearTimeout(stimer);
                    subtitle.innerHTML = "";
                    if (veryLowEnd) setStateIndicator('idle');
                }
            },
            onMessage: (m) => {
                console.log(m);
                if (m.source === "ai") {
                    if (m.message.includes('\n\n')) {
                        showListPanel(m.message);
                    } else {
                        subtitles = splitIntoSentences(m.message);
                        sid = 0;
                        showSubtitle();
                    }
                } else if (m.source === "user") {
                    hideListPanel();
                    if (veryLowEnd) {
                        setStateIndicator('user');
                        setTimeout(() => {
                            if (!agentTalking) setStateIndicator('idle');
                        }, 1200);
                    }
                }
            }
        });

        if (!veryLowEnd) {
            convolver = conversation.output.context.createConvolver();
            agentAnalyser = conversation.output.analyser;
            impulse = await createReverb(0.75, 1.25, false);
            convolver.buffer = impulse;

            const wetGain = conversation.output.context.createGain();
            const dryGain = conversation.output.context.createGain();
            wetGain.gain.value = temporaryOverdrive ? 0.5 : 0.3;
            dryGain.gain.value = temporaryOverdrive ? 0.5 : 0.7;

            const masterGain = conversation.output.context.createGain();
            masterGain.gain.value = 1.0;

            const destination = conversation.output.analyser.context.destination;
            conversation.output.analyser.disconnect();
            conversation.output.analyser.connect(dryGain);
            conversation.output.analyser.connect(convolver);
            convolver.connect(wetGain);

            wetGain.connect(masterGain);
            dryGain.connect(masterGain);
            masterGain.connect(destination);

            if (lowEnd === true) {
                agentAnalyser.fftSize = 64;
                agentAnalyser.smoothingTimeConstant = 0.45;
            } else {
                agentAnalyser.fftSize = 256;
                agentAnalyser.smoothingTimeConstant = config.smoothing;
            }
            agentAnalyser.maxDecibels = 0;
            agentAnalyser.minDecibels = -100;
        }

    } catch (error) {
        connected = false;
        console.error('Error starting conversation:', error);
        let msg = '[unable to connect to voice service]';
        if (error && (error.reason || error.message)) {
            const r = (error.reason || error.message).toString().toLowerCase();
            if (r.includes('websocket') || r.includes('ws')) {
                msg = '[unable to connect to websocket service]';
            }
        }
        subtitle.innerHTML = msg;
        showDisconnectionBox();
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

    if (!veryLowEnd) {
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
    }
    (async function () {
        await startConversation();
    })();
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
    grd.addColorStop(0, "hsl(" + (config.hueStart + npt * config.colorSpeed) + ", 35%, 10%");
    grd.addColorStop(1, "hsl(" + (config.hueStart + npt * config.colorSpeed) + ", 75%, 5%");
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
    var rot = 10;

    if (connected === false) {
        const noiseSpeed = 512;
        npt += noiseSpeed / 100000;
        nrt += noiseSpeed / 300000;
        rot = 5;
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

        const x1 =
            w / 2 + (config.circleRadius + (avgFrq / 4) / points) *
            Math.cos(-Math.PI / 2 + 2 * Math.PI * i / points + noiseRotate);
        const y1 =
            h / 2 + (config.circleRadius + (avgFrq / 4) / points) *
            Math.sin(-Math.PI / 2 + 2 * Math.PI * i / points + noiseRotate);
        const x2 =
            w / 2 + ((config.circleRadius + (avgFrq / 4) / points) + avg * config.multiplier) *
            Math.cos(-Math.PI / 2 + 2 * Math.PI * i / points + noiseRotate);
        const y2 =
            h / 2 + ((config.circleRadius + (avgFrq / 4) / points) + avg * config.multiplier) *
            Math.sin(-Math.PI / 2 + 2 * Math.PI * i / points + noiseRotate);
        const x3 =
            w / 2 + ((config.circleRadius + (avgFrq / 4) / points) + Math.pow((avg * config.multiplier) * config.coef, 2)) *
            Math.cos(-Math.PI / 2 + 2 * Math.PI * i / points + noiseRotate);
        const y3 =
            h / 2 + ((config.circleRadius + (avgFrq / 4) / points) + Math.pow((avg * config.multiplier) * config.coef, 2)) *
            Math.sin(-Math.PI / 2 + 2 * Math.PI * i / points + noiseRotate);
        const nd1 = noise.simplex2(y1 / 100, npt) * 10;

        ctx.beginPath();
        ctx.lineCap = "round";
        ctx.shadowBlur = config.glow;
        ctx.lineWidth = 1;

        const hue = isSpeaking ? 230 : 35;
        if (agentTalking === true) {
            ctx.strokeStyle = "hsla(" + (128) + ", 50%, " + (20 + (Math.pow(avg * 3, 2))) + "%, 100%)";
            ctx.shadowColor = "hsla(" + (128) + ", 50%, " + (20 + (Math.pow(avg * 3, 2))) + "%, 100%)";
        } else {
            ctx.strokeStyle = "hsla(" + (hue) + ", 10%, " + (10 + (Math.pow(avg * 3, 2))) + "%, 100%)";
            ctx.shadowColor = "hsla(" + (hue) + ", 10%, " + (10 + (Math.pow(avg * 3, 2))) + "%, 100%)";
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
            if (agentTalking === true) {
                ctx.strokeStyle = "hsla(" + (128) + ", 50%, " + (30 + (Math.pow(avg * 3, 2))) + "%, 100%)";
                ctx.shadowColor = "hsla(" + (128) + ", 50%, " + (30 + (Math.pow(avg * 3, 2))) + "%, 100%)";
            } else {
                ctx.strokeStyle = "hsla(" + (hue) + ", 50%, " + (50 + (Math.pow(avg * 3, 2))) + "%, 100%)";
                ctx.shadowColor = "hsla(" + (hue) + ", 50%, " + (50 + (Math.pow(avg * 3, 2))) + "%, 100%)";
            }
        }
        ctx.moveTo(x1 + nd1, y1 + nd1);
        ctx.lineTo(x3 + nd1, y3 + nd1);
        ctx.stroke();
        ctx.closePath();
    }

    if (!agentTalking) {
        ctx.beginPath();
        ctx.fillStyle = isSpeaking ? "rgba(200, 32, 16, 0.5)" : "rgba(235, 235, 235, 0.3)";
        ctx.fillRect(20, h - 30, Math.min(speechEnergy * 3, 200), 15);
        ctx.strokeStyle = "#fff";
        ctx.lineWidth = 1;
        ctx.strokeRect(20, h - 30, 200, 15);

        ctx.beginPath();
        ctx.strokeStyle = "rgba(255, 255, 255, 0.5)";
        ctx.lineWidth = 1;
        ctx.moveTo(20 + SPEECH_THRESHOLD * 3, h - 30);
        ctx.lineTo(20 + SPEECH_THRESHOLD * 3, h - 15);
        ctx.stroke();
        ctx.closePath();
    }
}

function render() {
    if (!ctx) return;
    clear();
    drawSpectrum();
    if (!hasDrawnFrame) {
        hasDrawnFrame = true;
        hideLoaderOverlay();
    }
    requestAnimationFrame(render);
}

function setupVeryLowEndUI() {
    _stateIndicatorEl = document.createElement('div');
    _stateIndicatorEl.id = 'stateIndicator';
    _stateIndicatorEl.style.position = 'fixed';
    _stateIndicatorEl.style.left = '50%';
    _stateIndicatorEl.style.top = '50%';
    _stateIndicatorEl.style.transform = 'translate(-50%, -50%)';
    _stateIndicatorEl.style.width = '120px';
    _stateIndicatorEl.style.height = '120px';
    _stateIndicatorEl.style.borderRadius = '50%';
    _stateIndicatorEl.style.display = 'flex';
    _stateIndicatorEl.style.alignItems = 'center';
    _stateIndicatorEl.style.justifyContent = 'center';
    _stateIndicatorEl.style.color = '#fff';
    _stateIndicatorEl.style.fontFamily = 'Jost, system-ui, -apple-system, sans-serif';
    _stateIndicatorEl.style.fontSize = '14px';
    _stateIndicatorEl.style.boxShadow = '0 0 20px rgba(0,0,0,0.5)';
    document.body.appendChild(_stateIndicatorEl);
    setStateIndicator('loading');
}

function setStateIndicator(state) {
    if (!_stateIndicatorEl) return;
    let bg = '#555', label = '';
    switch (state) {
        case 'loading':
            bg = '#555555'; label = 'Loading'; break;
        case 'idle':
            bg = '#2a6f97'; label = 'Idle'; break;
        case 'user':
            bg = '#1b5b01'; label = 'You'; break;
        case 'agent':
            bg = '#c02112'; label = 'Agent'; break;
        default:
            bg = '#555555'; label = state;
    }
    _stateIndicatorEl.style.background = bg;
    _stateIndicatorEl.textContent = label;
}

function setupLoaderOverlay() {
    if (loaderOverlay) return;
    loaderOverlay = document.createElement('div');
    loaderOverlay.id = 'loaderOverlay';
    const loader = document.createElement('div');
    loader.className = 'loader';
    loaderOverlay.appendChild(loader);

    const fragment = document.createDocumentFragment();
    loaderDots = [];
    for (let i = 0; i < LOADER_DOT_COUNT; i++) {
        const dot = document.createElement('div');
        dot.className = 'loader-dot';
        fragment.appendChild(dot);
        loaderDots.push(dot);
    }
    loader.appendChild(fragment);

    document.body.appendChild(loaderOverlay);
    loaderActive = true;
    loaderTime = 0;
    hasDrawnFrame = false;
    animateLoader();
}

function animateLoader() {
    if (!loaderActive || loaderDots.length === 0) return;

    if (typeof noise === 'undefined') {
        loaderTime += 0.01;
        const dotCount = loaderDots.length;
        for (let i = 0; i < dotCount; i++) {
            const angle = (i / dotCount) * Math.PI * 2;
            const wave1 = Math.sin(angle * 3 + loaderTime) * 15;
            const wave2 = Math.cos(angle * 5 + loaderTime * 0.7) * 8;
            const offset = wave1 + wave2;
            const x = Math.cos(angle) * (LOADER_RADIUS + offset);
            const y = Math.sin(angle) * (LOADER_RADIUS + offset);
            loaderDots[i].style.transform = `translate(${x}px, ${y}px)`;
        }
    } else {
        const noiseSpeed = 512;
        npt += noiseSpeed / 100000;
        nrt += noiseSpeed / 300000;
        const rot = 5;
        const noiseRotate = noise.perlin2(rot, nrt);
        const dotCount = loaderDots.length;
        const baseRadius = config.circleRadius;

        for (let i = 0; i < dotCount; i++) {
            const angle = -Math.PI / 2 + (2 * Math.PI * i) / dotCount + noiseRotate;
            const xBase = Math.cos(angle) * baseRadius;
            const yBase = Math.sin(angle) * baseRadius;
            const offset = noise.simplex2(yBase / 100, npt) * 10;
            const x = xBase + offset;
            const y = yBase + offset;
            loaderDots[i].style.transform = `translate(${x}px, ${y}px)`;
        }
    }
    loaderFrame = requestAnimationFrame(animateLoader);
}

function hideLoaderOverlay() {
    if (!loaderOverlay) return;
    loaderActive = false;
    if (loaderFrame) {
        cancelAnimationFrame(loaderFrame);
        loaderFrame = null;
    }
    const overlay = loaderOverlay;
    overlay.classList.add('loader-hidden');
    loaderOverlay = null;
    loaderDots = [];
    setTimeout(() => {
        if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
    }, 300);
}

(function () {
    setupLoaderOverlay();
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
        hideLoaderOverlay();
        return;
    }
    detectPerformance();
    if (veryLowEnd === true) {
        if (canvas) canvas.style.display = 'none';
        setupVeryLowEndUI();
        hideLoaderOverlay();
    } else if (lowEnd === true) {
        config.glow = 0;
        config.multiplier = 10;
        config.coef = 0.05;
        config.colorSpeed = 0;
    }

    if (!veryLowEnd) {
        ctx = canvas.getContext("2d");
        w = ctx.canvas.width = window.innerWidth;
        h = ctx.canvas.height = window.innerHeight;
    }

    const constraints = { audio: true };
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        connected = false;
        subtitle.innerHTML = "[media devices API unavailable]";
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
                return;
            }
            const activeMic = devices.find(device => device.deviceId === deviceId);
            micName = (activeMic ? activeMic.label : "Unknown").toString();
            if (micName !== "" && isStereoMix(micName) === true) {
                connected = false;
                subtitle.innerHTML = "[no microphone detected]";
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
    });
})();
