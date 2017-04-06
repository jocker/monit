'use strict';

//rpio.spiChipSelect(0);                  /* Use CE0 (slave 0) */
//rpio.spiSetCSPolarity(0, rpio.LOW);    /* Commonly chip enable (CE) pins are active low, and this is the default. */
//rpio.spiSetClockDivider(256);           /* MCP3008 max is ~1MHz, 256 == 0.98MHz */
//rpio.spiSetDataMode(0);

const rpio = require('rpio'),
  Utils = require('./utils');

const instanceMap = new Map();
module.exports = class  Mcp3008 {

  static get(spiPin) {
    spiPin = spiPin || 0;
    let instance = instanceMap.get(spiPin);
    if (!instance) {
      instance = new Mcp3008(spiPin);
      instanceMap.set(spiPin, instance);
    }
    return instance;
  }

  constructor(spiPin) {
    this._spiStarted = false;
    this._spiCloseTimeout = null;
    this._spiPin = spiPin || 0;


  }

  read(channel) {
    this.openSpi();
    return this._read(channel);
  }

  sample(channel, millis){
    this.openSpi();
    const start = Utils.system.millis;
    millis = millis || 50;
    let value, samples = []
    const txBuffer = new Buffer([0x01, (8 + channel << 4), 0x01]);
    const rxBuffer = new Buffer(txBuffer.byteLength);
    while(Utils.system.millis-start < millis){
      value = this._read(channel);
      if (value > 0) {
        samples.push(value)
      }
    }
    console.log(samples.length)
    return samples;
  }

  _read(channel) {

    const txBuffer = new Buffer([0x01, (8 + channel << 4), 0x01]);
    const rxBuffer = new Buffer(txBuffer.byteLength);

    rpio.spiTransfer(txBuffer, rxBuffer, txBuffer.length); // Send TX buffer and recieve RX buffer

    // Extract value from output buffer. Ignore first byte.
    var //junk = rxBuffer[0],
      MSB = rxBuffer[1],
      LSB = rxBuffer[2];

    // Ignore first six bits of MSB, bit shift MSB 8 positions and
    // finally combine LSB and MSB to get a full 10 bit value

    return (((MSB & 3) << 8) + LSB);
  }

 

  openSpi() {
    if (!this._spiStarted) {
      rpio.spiBegin();
      rpio.spiChipSelect(this._spiPin)
      this._spiStarted = true;
    }
  }

  closeSpi(){
    if(this._spiStarted){
      this._spiStarted = false;
      rpio.spiEnd();
    }
  }

  readAll() {
    let results = new Map();
    for (let i = 0; i < 8; i++) {
      results.put(i, this.read(i))
    }
    return results;
  }

}
