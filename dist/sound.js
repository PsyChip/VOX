var sound = function (source) {
    const T = this;
    var mem;
    var fade;
    var rand = function (n) {
        return Math.floor(Math.random() * n);
    };
    const audio = document.createElement("audio");
    T.ready = false;
    T.playing = false;
    T.fading = false;
    audio.style.display = "none";
    audio.autoplay = false;
    audio.onended = function () {
        T.stop();
    };
    document.body.appendChild(audio);

    T.clear = function () {
        if (typeof mem !== "undefined") {
            URL.revokeObjectURL(mem);
        }
    };

    T.load = function (file, cb) {
        T.ready = false;
        T.clear();
        (async function () {
            const response = await fetch(file + "?nocache=" + rand(5198465487) + "&nc=v2.0");
            const blob = await response.blob();
            mem = URL.createObjectURL(blob);
            if (typeof cb === "function") {
                cb();
            }
            T.ready = true;
        })();
    };

    T.play = function (f) {
        if (typeof f !== "undefined") {
            T.load(f, function () {
                T.play();
            });
            return;
        }
        T.playing = true;
        audio.volume = 1;
        audio.currentTime = 0;
        audio.setAttribute("src", mem);
        T.playing = true;
        audio.play();
    };

    T.stop = function () {
        audio.pause();
        audio.currentTime = 0;
        T.playing = false;
    };

    T.fadeOut = function (fadeDuration = 1500, cb) {
        if (T.playing === false || T.fading === true) {
            return;
        }

        T.fading = true;
        if (typeof cb !== "function") {
            cb = function () {};
        }
        let volume = audio.volume;
        let fadeStep = audio.volume / (fadeDuration / 50);
        fade = setInterval(function () {
            if (volume > 0) {
                volume -= fadeStep;
                if (volume < 0) {
                    volume = 0;
                    clearInterval(fade);
                    T.stop();
                    T.fading = false;
                    cb();
                    return;
                } else {
                    audio.volume = volume;
                }
            } else {
                T.fading = false;
                clearInterval(fade);
                T.stop();
                cb();
            }
        }, 50);
    };
    T.cue = function (f) {
        if (T.playing === true) {
            T.fadeOut(1500, function () {
                T.play(f);
            });
        } else {
            T.play(f);
        }
    };
    if (typeof source !== "undefined") {
        T.load(source);
    }
    return T;
};