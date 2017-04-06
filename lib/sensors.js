'use strict';

const Utils = require("./utils");

const rx = require('rxjs');

const
  DHT_PIN = 21,
  PIR_PIN = 19;

const DHT_SENSOR_TYPE = 22;

const
  ADC_SPI_CHIP = 0,
  ADC_SOUND_CHANNEL = 0,
  ADC_LIGHT_CHANNEL = 1;


const MOCK_SENSORS = require('../config/config').MOCK_RPI;

const sensorInstances = new Map();

const initSensor = function(type){
  switch (type){
    case Sensors.TYPE_MOTION:
      return new PirSensor();
    case Sensors.TYPE_SOUND:
      return new SoundSensor();
    case Sensors.TYPE_HUMIDITY:
      return new HumiditySensor();
    case Sensors.TYPE_TEMPERATURE:
      return new TemperatureSensor();
    case Sensors.TYPE_LIGHT:
      return new LightSensor();
    default:
      throw new Error('unknown sensor type '+ type);
  }
};

const Sensors = module.exports = {
  TYPE_MOTION: 'motion',
  TYPE_LIGHT: 'light',
  TYPE_SOUND: 'sound',
  TYPE_TEMPERATURE: 'temperature',
  TYPE_HUMIDITY: 'humidity',

  get(type){
    if(!sensorInstances.has(type)){
      sensorInstances.set(type, initSensor(type))
    }
    return sensorInstances.get(type);
  }
};


class BaseSensor{
  read(){
    throw new Error('abstract')
  }

  poll(interval){
    if(!this._observer){
      this._observer = this.initObserver();
    }
    return this._observer.toObservable(interval)
  }

  initObserver(){
    const self = this;
    return new SensorDataSource(() => {
      return self.read();
    });

  }
}

class AdcSensor{

  static get adcBridge() {
    if (!this._bridge) {
      this._bridge = require('./mcp3008').get(ADC_SPI_CHIP);
    }
    return this._bridge;
  }

  static readSample(channelIndex, sampleTime){
    let samples = MOCK_SENSORS ? (function(){
        let sampleCount = Utils.random(5, 12), samples = [];
        for(let i=0;i<sampleCount; i++){
          samples.push(Utils.random(0, 1023));
        }
        return samples;
      })() : this.adcBridge.sample(channelIndex, sampleTime || 50);


    let min = NaN, max = NaN, sum=0;
    for(let sample of samples){
      sum+=sample;
      if (isNaN(min) || (min > sample)) {
        min = sample;
      }
      if (isNaN(max) || (max < sample)) {
        max = sample;
      }
    }

    const numSamples = samples.length;
    return {
      sum: sum,
      count: numSamples,
      min: min,
      max: max
    }
  }

}

class SoundSensor extends BaseSensor{

  read(){
    let sample = SoundSensor.readAdcSample();
    return sample.max-sample.min;
  }

  initObserver(){
    return new SensorDataSource(() => {
      return SoundSensor.readAdcSample();
    }, (values) => {

      if(values.length == 1){
        return values[0].max - values[0].min
      }

      let min = NaN, max = NaN;

      for(let value of values){
        if (isNaN(min) || (min > value.min)) {
          min = value.min;
        }
        if (isNaN(max) || (max < value.max)) {
          max = value.max;
        }
      }
      return max-min;
    });

  }

  static readAdcSample(){
    return AdcSensor.readSample(ADC_SOUND_CHANNEL, 50);
  }
}

class LightSensor extends BaseSensor{

  read(){
    let sample = LightSensor.readAdcSample();
    return sample.sum / sample.count;
  }

  initObserver(){
    return new SensorDataSource(() => {
      return LightSensor.readAdcSample();
    }, (values) => {

      if(values.length == 1){
        return values[0].sum/values[0].count
      }

      let sum = 0, count = 0;

      for(let value of values){
        sum += value.sum;
        count+= value.count;
      }
      return sum/count;
    })

  }

  static readAdcSample(){
    return AdcSensor.readSample(ADC_LIGHT_CHANNEL, 50);
  }
}

const DHT_MIN_SENSOR_READ_GAP = 5*1000;

class DhtSensor extends BaseSensor{

  static readOne(which){
    return DhtSensor.readValues().then((values) => {
      return values[which];
    })
  }

  static readValues(){
    // needs to be a gap of at least 1000 ms between 2 subsequent reads
    if(this._readingPromise){
      return Promise.resolve(this._readingPromise)
    }

    if(this._lastReadValue && !isNaN(this._lastReadAt) && Utils.system.millis-this._lastReadAt < DHT_MIN_SENSOR_READ_GAP){
      return Promise.resolve(this._lastReadValue);
    }

    const self = this;
    return this._readingPromise = new Promise((resolve) => {
      self._readSensor((temp, humidity) => {
        self._lastReadAt = Utils.system.millis;
        self._readingPromise = null;
        resolve( self._lastReadValue = [temp, humidity] )
      })
    })
  }

  static _readSensor(onSuccess){
    if(MOCK_SENSORS){
      setTimeout(() => {
        onSuccess(Utils.random(20, 30), Utils.random(10, 100))
      }, Utils.random(500, 1200))
    }else{
      const self = this;
      const DHT = require('node-dht-sensor');
      DHT.read(DHT_SENSOR_TYPE, DHT_PIN, (err, temperature, humidity) => {
        if (err) {
          self._readSensor(onSuccess);
          return;
        }
        onSuccess(temperature, humidity);
      });

    }
  }
}


class TemperatureSensor extends DhtSensor{
  read(){
    return DhtSensor.readOne(0);
  }
}

class HumiditySensor extends DhtSensor{
  read(){
    return DhtSensor.readOne(1);
  }
}

class PirSensor extends BaseSensor{

  constructor(){
    super();

    this._subscribers = new Set();
  }

  read(){
    return Utils.system.millis - (this._last_detected_at || 0)
  }


  poll(){
    const self = this;
    return rx.Observable.create((subscriber) => {
      self._subscribers.add(subscriber);
      self._initPoll();
    });
  }

  _initPoll(){
    const self = this;
    if(!self._pollEnabled){
      self._pollEnabled = true;

      const onMotionDetected = () => {
        let prevDetectedAt = self._last_detected_at || 0;
        self._last_detected_at = Utils.system.millis;
        const value = self._last_detected_at-prevDetectedAt;
        for(let sub of self._subscribers){
          if(!sub.closed){
            sub.next(value)
          }
        }
      };

      if(MOCK_SENSORS){
        setTimeout(function mock(){
          onMotionDetected();
          setTimeout(mock, Utils.random(1000, 2000))
        }, Utils.random(1000, 2000))
        return;
      }

      const rpio = require('rpio');
      rpio.open(PIR_PIN, rpio.INPUT);
      rpio.poll(PIR_PIN, () => {
        if(rpio.read(PIR_PIN) ){
          onMotionDetected();
        }
      })

    }
  }

}

const ggd = function(a, b){
  if (a < 0) a = -a;
  if (b < 0) b = -b;
  if (b > a) {
    let temp = a;
    a = b;
    b = temp;
  }
  while (true) {
    if (b == 0){
      return a;
    }
    a %= b;
    if (a == 0){
      return b;
    }
    b %= a;
  }
};

const getDivisor = function(numbers){
  if(numbers.length == 0){
    return 0;
  }
  let res = numbers[0] || 1;
  if(numbers.length == 1){
    return res;
  }
  for(let i=1; i< numbers.length; i++){
    res = ggd(res, numbers[i] || 1);
  }
  return res;
};



const MIN_POLL_INTERVAL = 50;

class SensorDataSource{

  constructor(mapFn, reduceFn){
    this._delayMillis = 500;// 50*60*1000;
    this._mapFn = mapFn;
    this._pipe = new rx.BehaviorSubject();
    this._subscribers = new Map();
    this._lastReceivedValue = undefined;
    this._reduceFn = reduceFn || function(values){
      return values[values.length-1]
    };
  }

  _resetPollInterval(){
    if(!this._subscribers.size){
      this._stopPoll();
    }else{
      let delayMillis = Math.max(MIN_POLL_INTERVAL, getDivisor(Utils.makeArray(this._subscribers.values())));
      if((delayMillis != this._delayMillis) || !this._isPolling){
        this._delayMillis = delayMillis;
        if(this._isPolling){
          this._stopPoll();
        }
        this._poll();
      }

    }
  }

  get value(){
    return this._lastReceivedValue;
  }

  _poll(){
    console.log('start');
    if(this._isPolling){
      return;
    }

    this._isPolling = true;

    const self = this, pipe = self._pipe;

    const onValue = (value, next) =>{
      if(!pipe.closed){
        if(value === null){
          self._isPolling = false;
          pipe.complete();
        }else{
          if(Utils.isPromise(value)){
            Promise.resolve(value).then((resolvedValue) => {onValue(resolvedValue, next) })
          }else{
            pipe.next(self._lastReceivedValue = value);
            self._timeout =  setTimeout(next, self._delayMillis);

          }
        }
      }
    };

    (function readSensor(){
      onValue(self._mapFn(), readSensor);
    })();
  }



  _stopPoll(){
    if(this._isPolling){
      console.log('stop');
      clearTimeout(this._timeout);
      this._isPolling = false;
    }
  }


  toObservable(samplePeriod){
    samplePeriod = samplePeriod || this._delayMillis;

    samplePeriod = Math.max(MIN_POLL_INTERVAL, samplePeriod);

    const self = this, pipe = self._pipe.filter((v) => v !== undefined)

    let pollObs = rx.Observable.create((subscriber) => {

      self._subscribers.set(subscriber, samplePeriod);
      self._resetPollInterval();

      pipe.subscribe((v) => {
        if(!subscriber.closed){
          subscriber.next(v);
        }
      });

      subscriber.add(() => {
        self._subscribers.delete(subscriber);
        self._resetPollInterval();
      })

    }).bufferTime(samplePeriod).filter(values => {
      return values.length && (values.length > 1 || values[0] !== undefined);
    });


    return rx.Observable.create((subscriber) => {
      if(self._lastReceivedValue){
        subscriber.next([self._lastReceivedValue]);
        subscriber.complete();
      }else{

        pipe.take(1).subscribe((v) => {
          subscriber.next([v]);
          subscriber.complete();
        });

        self._poll();
      }
    }).concat(pollObs).map(values => {
      return self._reduceFn(values);
    }).map((v) => {
      return {
        value: v,
        ts: Utils.system.millis
      }
    });

  }
}

