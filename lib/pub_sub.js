'use strict';

const Promise = require('bluebird'),
  RedisClient = require('./redis_client'),
  Utils = require('./utils'),
  uuid = require('uuid'),
  rx = require('rxjs');

const TYPE_PUBLISH = 1, TYPE_SUBSCRIBE = 2;




class CallbackRegistry{
  constructor(){
    this._map = new Map();
  }

  add(name, handler){
    const originalCount = this.getCount(name);
    if(!this._map.has(name)){
      this._map.set(name, new Set())
    }
    this._map.get(name).add(handler);
    return this.getCount(name) > originalCount;
  }

  remove(name, handler){
    var removed = false;
    if(this._map.has(name)){
      removed = this._map.delete(handler);
      if(removed && this.getCount(name) === 0){
        this._map.delete(name);
      }
    }
    return removed;
  }

  each(name, fn){
    if(this._map.has(name)){
      for(let member of this._map.get(name)){
        fn(member)
      }
    }
  }

  getCount(name){
    if(this._map.has(name)){
      return this._map.get(name).size;
    }
    return 0;
  }

  get isEmpty(){
    return this._map.size == 0;
  }
}


class PubSub{
  constructor(){
    const self = this;

    this._onReceiveMessage = (channel, message) => {
      const data = JSON.parse(message);
      self._getCallbackRef(false).each(channel, (callback) => {
        callback(data);
      })
    };

    this._onReceivePatternMessage = (pattern, channel, message) => {
      const data = JSON.parse(message);
      self._getCallbackRef(true).each(pattern, (callback) => {
        callback(channel, data);
      })
    }

  }

  publish(channel, message){
    const self = this;
    self._getClient(TYPE_PUBLISH).then((client) => {
      const json = JSON.stringify(message)
     //console.log('broadcast', channel, json);
      client.publish(channel, json);
    })
  }

  on(channel){
    return this._on(channel, false);
  }

  pOn(channel){
    return this._on(channel, true);
  }

  ackPublish(channel, data, timeout){
    const self = this, msgId = uuid(), broadcastChannel = channel+':'+msgId+':ack', replyChannel = channel+':'+msgId+':reply';
    return new Promise((resolve, reject) => {
      var responseReceived = false;

      const setResponse = (data) => {
        if(!responseReceived){
          clearTimeout(execTimeout);
          responseReceived = true;
          self.removeListener(replyChannel);
          if(data instanceof Error){
            reject(data)
          }else{
            resolve(data);
          }
        }
      };

      const execTimeout = setTimeout(() => {
        setResponse(new Error('timeout'));
      }, timeout || 1000);

      self.addListener(replyChannel, function onReply(replyData){
        setResponse(replyData);
        self.removeListener(replyChannel, onReply)
      });
      self.publish(broadcastChannel, data)

    });

  }

  ackOn(subscribeChannel){
    const self = this;
    const listenChannel = subscribeChannel+':'+'?'.repeat(36)+':ack';

    return rx.Observable.create((subscriber) => {
      const patListener = (channel, data) => {
        const chunks = channel.split(':'), uid = chunks.splice(-2)[0];
        const replyChannel = chunks.concat([uid, 'reply']).join(':');

        subscriber.next({
          data: data,
          ack: (response) => {
            self.publish(replyChannel, response)
          }
        })
      };

      self.addPatternListener(listenChannel, patListener);

      subscriber.add(() => {
        self.removePatternListener(listenChannel, patListener)
      })
    });

  }

  _on(channel, patternMatching){
    const self = this;
    return rx.Observable.create((sub) => {
      const onNext = (data) => {
        sub.next(data);
      };

      sub.add(() => {
        if(patternMatching){
          self.removePatternListener(channel, onNext)
        }else{
          self.removeListener(channel, onNext)
        }

      });

      if(patternMatching){
        self.addPatternListener(channel, onNext);
      }else{
        self.addListener(channel, onNext);
      }

    })
  }

  addListener(channel, listener){
    return this._addSubscriberListener(channel, listener, false);
  }

  removeListener(channel, listener){
    return this._removeSubscriberListener(channel, listener, false)
  }

  addPatternListener(channel, listener){
    return this._addSubscriberListener(channel, listener, true);
  }

  removePatternListener(channel, listener){
    return this._removeSubscriberListener(channel, listener, true)
  }

  _addSubscriberListener(channel, listener, patternMatching){
    const callbackRef = this._getCallbackRef(patternMatching);
    if(callbackRef.add(channel, listener)){
      const initializedNow = callbackRef.getCount(channel) == 1;
      if(initializedNow){
        this._getClient(TYPE_SUBSCRIBE).then((client) => {

          if(patternMatching){
            client.psubscribe(channel);
          }else{
            client.subscribe(channel);
          }

        })
      }
      return true;
    }
    return false;
  }

  _removeSubscriberListener(channel, listener, patternMatching){
    const callbackRef = this._getCallbackRef(patternMatching);
    if(callbackRef.remove(channel, listener)){
      const allRemoved = callbackRef.getCount(channel) == 0;
      if(allRemoved){
        this._getClient(TYPE_SUBSCRIBE).then((client) => {
          if(patternMatching){
            client.punsubscribe(channel);
          }else{
            client.unsubscribe(channel);
          }

        })
      }
      return true;
    }
    return false;
  }

  _getClient(type){
    const self = this;
    if(!self._clients){
      self._clients = new Map();
    }
    if(!self._clients.has(type)){
      switch(type){
        case TYPE_PUBLISH:
        case TYPE_SUBSCRIBE:
          break;
        default:
          throw new Error('unknown client type')

      }
      const init =  RedisClient.clone().then((client) => {
        self._clients.set(type, client);
        if(type == TYPE_SUBSCRIBE){
          client.addListener('pmessage', self._onReceivePatternMessage);
          client.addListener('message', self._onReceiveMessage)
        }
        return client;
      });

      self._clients.set(type, init);

    }
    return Promise.resolve(self._clients.get(type))
  }

  _unregisterClient(type){

  }

  _getCallbackRef(patternMatching){
    const type = patternMatching ? 1 : 0;
    if(!this._callbackRegistry){
      this._callbackRegistry = new Map();
    }
    if(!this._callbackRegistry.has(type)){
      this._callbackRegistry.set(type, new CallbackRegistry());
    }
    return this._callbackRegistry.get(type);

  }
}

module.exports = new PubSub();

/*
 PubSub = require('/home/cris/WORK/NODE/raspi-monit/lib/pub_sub.js')
 s = PubSub.ackOn('xxx').subscribe((res) => { res.ack({success: true}) })


 PubSub.ackPublish('xxx', {a:'aaa'}).then((r) => { console.log('ok', r) }, (e) => console.log(e))



 PubSub.ackPublish('xxx', {a:'aaa'}).then((r) => { console.log('ok', r) }, (e) => console.log(e))

 Redis = require('redis');
 pub =  Redis.createClient(6379, '127.0.0.1'), sub = Redis.createClient(6379, '127.0.0.1');
 sub.on('message', (msg) => { console.log('NEW', msg) })
 sub.psubscribe('channel:*')
 pub.publish('channel:aaa', 'test')

 */
