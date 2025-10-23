navigator.getBattery().then((battery) => {
    function updateAllBatteryInfo() {
        updateChargeInfo();
        updateLevelInfo();
        updateChargingInfo();
        updateDischargingInfo();
    }
    updateAllBatteryInfo();

    battery.addEventListener("chargingchange", () => {
        updateChargeInfo();
    });
    function updateChargeInfo() {
        console.log(`Battery charging? ${battery.charging ? "Yes" : "No"}`);
    }

    battery.addEventListener("levelchange", () => {
        updateLevelInfo();
    });
    function updateLevelInfo() {
        console.log(`Battery level: ${battery.level * 100}%`);
    }

    function updateChargingInfo() {
        console.log(`Battery charging time: ${battery.chargingTime} seconds`);
    }

    function updateDischargingInfo() {
        console.log(`Battery discharging time: ${battery.dischargingTime} seconds`);
    }
});