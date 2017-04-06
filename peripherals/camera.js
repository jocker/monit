'use strict';

const Constants = require('../lib/constants'),
PubSub = require('../lib/pub_sub'),
RedisClient = require('../lib/redis_client');

const REDIS_KEY = 'peripheral:camera:settings';

const CAMERA_PROPERTIES = {};

var invokeCameraCmd = function(pubSubEvent, value){
  return PubSub.ackPublish(pubSubEvent, {value: value}).then((res) => {
    return !!res.success;
  },(e) => {
    return false;
  });
}



module.exports = new class{
  setX(value){
    return this._setValue('x', Constants.CAMERA_X, value);
  }

  setY(value){
    return this._setValue('y', Constants.CAMERA_Y, value);
  }

  setIrBrightness(value){
    return this._setValue('ir', Constants.CAMERA_IR, value);
  }

  getValues(){
    return this._getValues().then((v) => {
      return JSON.parse(JSON.stringify(v));
    })
  }

  _getValues(){
    const self = this;
    if(self._values){
      return Promise.resolve(self._values);
    }
    return self._values = RedisClient.invoke((client, resolve, reject) => {
      client.hgetall(REDIS_KEY, function (err, reply) {
        if (err) {
          reject(err)
        } else {
          var res = {};
          for(let property of ['x', 'y','ir']){
            if(reply && reply.hasOwnProperty(property)){
              res[property] = reply[property];
            }else{
              res[property] = 0;
            }
          }

          resolve(self._values = res);
        }

      });
    })
  }

  _setValue(property, pubSubEvent, value){
    const self = this;
    return self._getValues().then((values) => {
      if(values[property] !== value){
        return PubSub.ackPublish(pubSubEvent, {value: value}).then((res) => {
          if(res.success){
            return RedisClient.invoke((client, resolve, reject) => {
              client.hset(REDIS_KEY, property, value, (err) => {
                if(err){
                  reject(err);
                }else{
                  self._values[property] = value;
                  resolve(true);
                }
              })
            })
          }
          return !!res.success;
        },(e) => {
          return false;
        });
      }else{
        return true;
      }
    })
  }
}
