'use strict';

const rpio = require('rpio');

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



rpio.spiBegin();
rpio.spiSetClockDivider(32768);
rpio.spiSetCSPolarity(0, rpio.LOW);
rpio.spiSetDataMode(0);

//rpio.spiChipSelect(0);                  /* Use CE0 (slave 0) */
//rpio.spiSetCSPolarity(0, rpio.LOW);    /* Commonly chip enable (CE) pins are active low, and this is the default. */
//rpio.spiSetClockDivider(256);           /* MCP3008 max is ~1MHz, 256 == 0.98MHz */
//rpio.spiSetDataMode(0);

var sendMessage = function(strMessage){
  strMessage += '\n';
  console.time('run')
  let txBuff = new Buffer([0xA1, 0, 0x00]), rxBuff =  new Buffer(new Array(txBuff.length));
let res = rpio.spiTransfer(txBuff, rxBuff, txBuff.length);
console.timeEnd('run')
console.log(res)

console.log(txBuff.length);
console.log(txBuff);
console.log(rxBuff);


}
sendMessage('some really long message here')


rpio.spiEnd();
