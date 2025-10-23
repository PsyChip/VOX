class PhoneOrientationDetector {
    constructor(threshold = 7, debounceMs = 50, alpha = 0.8) {
        this.threshold = threshold; // gravity detection tolerance
        this.debounceMs = debounceMs;
        this.alpha = alpha; // low-pass filter factor

        this.gravity = { x: 0, y: 0, z: 0 };
        this.currentState = null;
        this.lastState = null;
        this.lastChangeTime = 0;
    }

    // low-pass filter to isolate gravity
    filter(accel) {
        this.gravity.x = this.alpha * this.gravity.x + (1 - this.alpha) * accel.x;
        this.gravity.y = this.alpha * this.gravity.y + (1 - this.alpha) * accel.y;
        this.gravity.z = this.alpha * this.gravity.z + (1 - this.alpha) * accel.z;
    }

    detectState() {
        const g = 9.8;
        const { x, y, z } = this.gravity;
        const t = this.threshold;

        if (Math.abs(z - g) < t) return "laying back";
        if (Math.abs(z + g) < t) return "laying front";
        if (Math.abs(y - g) < t) return "portrait";
        if (Math.abs(y + g) < t) return "reverse portrait";
        if (Math.abs(x - g) < t) return "landscape";
        if (Math.abs(x + g) < t) return "reverse landscape";
        return "holding in hand";
    }

    update(accel) {
        this.filter(accel);
        const state = this.detectState();
        const now = performance.now();

        if (state !== this.lastState) {
            this.lastChangeTime = now;
            this.lastState = state;
        } else if (now - this.lastChangeTime >= this.debounceMs && state !== this.currentState) {
            this.currentState = state;
            console.log("Orientation changed:", this.currentState);
        }
    }
}

// Usage with Accelerometer API
const detector = new PhoneOrientationDetector();

const sensor = new Accelerometer({ frequency: 50 });
sensor.addEventListener("reading", () => {
    detector.update({ x: sensor.x, y: sensor.y, z: sensor.z });
});
sensor.start();