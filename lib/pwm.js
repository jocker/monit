const i2cBus = require("i2c-bus"),
    Pca9685Driver = require("pca9685").Pca9685Driver,
    Promise = require('bluebird');

const FREQUENCY = 50;

const options = {
    i2c: i2cBus.openSync(1),
    address: 0x40,
    frequency: FREQUENCY,
    debug: false
};
//Operating speed: 0.1 s/60 degree 
// middle 1.5 ms pulse
// right 2ms pulse
// left 1ms pulse

var _driver = null;
const initDriver = function () {
    if (_driver) {
        return Promise.resolve(_driver)
    }
    return _driver = new Promise((resolve, reject) => {
        const pwm = new Pca9685Driver(options, function (err) {
            if (err) {
                reject(err);
            } else {
                resolve(_driver = pwm);
            }
        })
    });

}


const MIN_DUTY_CYCLE = 0.029, MAX_DUTY_CYCLE = 0.128;


const servoPinMap = new Map();

const PWM = module.exports = new class {
    setServoRotation(servoPin, percent) {
        percent = Math.max(Math.min(100, parseInt(percent)), 0);
        if (isNaN(percent)) {
            return Promise.resolve(false);
        }
        const dutyCycle = Math.round((MIN_DUTY_CYCLE + (MAX_DUTY_CYCLE - MIN_DUTY_CYCLE) * percent / 100) * 1000) / 1000;
        console.log(dutyCycle)
        const self = this;

        return self._setRawDutyCycle(servoPin, dutyCycle).then((res) => {
            if (res) {
                servoPinMap.set(servoPin, setTimeout(() => {
                    self.turnOff(servoPin);
                }, 300)) //TODO calculate the timout based on the last known rotation
            }
            return res;
        })
    }

    setDutyCycle(pin, percent) {
        const dutyCycle = Math.max(Math.min(parseInt(percent), 100), 0);
        if (isNaN(dutyCycle)) {
            return Promise.resolve(false)
        }
        console.log('duty cycle', dutyCycle);
        return this._setRawDutyCycle(pin, dutyCycle);
    }

    _setRawDutyCycle(pin, dutyCycle) {

        const self = this;
        if (servoPinMap.has(pin)) {
            clearTimeout(servoPinMap.get(pin));
            servoPinMap.delete(pin);
        }
        return self.invoke((driver, resolve, reject) => {
            driver.setDutyCycle(pin, dutyCycle, 0, (err) => {
                if (err) {
                    reject(err)
                } else {
                    resolve(true)
                }
            })
        })

    }

    turnOff(pin) {
        this.invoke((driver, resolve, reject) => {
            driver.channelOff(pin, function (err) {
                if (!err) {
                    resolve(true)
                } else {
                    reject(err)
                }
            })
        })
    }

    invoke(callback) {
        return initDriver().then((driver) => {
            return new Promise((resolve, reject) => {
                callback(driver, resolve, reject)
            })
        })
    }
}
