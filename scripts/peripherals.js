'use strict';

const rpio = require('rpio'),
PubSub = require('../lib/pub_sub'),
Utils = require('../lib/utils'),
Constants = require('../lib/constants');



const SPI = new class{

  open(){
    /*
    cdiv    speed
    2    125.0 MHz
    4     62.5 MHz
    8     31.2 MHz
    16     15.6 MHz
    32      7.8 MHz
    64      3.9 MHz
    128     1953 kHz
    256      976 kHz
    512      488 kHz
    1024      244 kHz
    2048      122 kHz
    4096       61 kHz
    8192     30.5 kHz
    16384     15.2 kHz
    32768     7629 Hz
    */
    if(!this._opened){
      rpio.spiBegin();
      rpio.spiSetClockDivider(32768);
      rpio.spiSetCSPolarity(0, rpio.LOW);
      rpio.spiSetDataMode(0);
      this._opened = true;
    }
  }

  close(){
    if(this._opened){
      rpio.spiEnd();
      this._opened = false;
    }
  }

  send(txBuff, rxBuff){
    const self = this;
    return new Promise((resolve, reject) => {
      self.open();
      rpio.spiTransfer(txBuff, rxBuff, txBuff.length);
      resolve(rxBuff);
    })
  }

  exec(cmd, value){
    const self = this,
    txBuff = new Buffer([cmd, value, 0x00]),
    rxBuff = new Buffer(txBuff.length);

    return self.send(txBuff, rxBuff).then((buff) => {
      console.log('spi result', 'tx', txBuff, 'rx', rxBuff);
      return buff && (buff[1] & buff[2] == 0xFF)
    })

  }

}

var mapValue = function(src, srcMin, srcMax, destMin, destMax){

  if(typeof destMin == 'undefined'){
    destMin = srcMin;
  }

  if(typeof destMax == 'undefined'){
    destMax = srcMax;
  }

  if(src < srcMin){
    return destMin;
  }else if(src > srcMax){
    return destMax;
  }
var res = destMin + ((srcMax-src)/(srcMax-srcMin))*(destMax-destMin);
return Math.min(Math.round(res), destMax);
}

const writeSpiValue = function(cmd, value, lower, upper){
  return SPI.exec(cmd, mapValue(value, 0, 100, lower || 0, upper || 100)) ;
}

const listenPubSubEvent = function(evName, cmdName){
  return PubSub.ackOn(evName).subscribe((res) => {

    var value = mapValue(res.data.value, 0, 100, 0, 100);

    console.log('exec', evName, cmdName, value)
    if(res.data && !isNaN(value)){
      writeSpiValue(cmdName, value).then((success) => {
        res.ack({success: !!success})
        console.log('exec done', evName, cmdName, value, success)
      })
    }

  });
}

listenPubSubEvent(Constants.CAMERA_X, 0xA0);
listenPubSubEvent(Constants.CAMERA_Y, 0xA1);
listenPubSubEvent(Constants.CAMERA_IR, 0xA2);



Utils.process.onTerminate(() => {
  SPI.close();
});
