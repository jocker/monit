'use strict';

const os = require('os'),
crypto = require('crypto'),
moment = require('moment-timezone'),
rx = require('rxjs'),
Promise = require('bluebird');

var genFn = function*(){
  yield 1;
  yield 2;
  yield 3;
}

const GENERATOR = Object.getPrototypeOf(function*(){}).constructor;

const Utils = module.exports = {

  system:{
    get millis(){
      return Date.now();
    }

  },

  process:{
    onTerminate: (function(){
      var hooksAdded = false;

      return function(callback){
        if(!hooksAdded){
          global.process.on('exit', function () {
            global.process.emit('cleanup');
          });

          global.process.on('SIGINT', function () {
            console.info('SIGINT');
            global.process.exit(2);
          });

          global.process.on('uncaughtException', function(e) {
            console.error('Uncaught Exception...', e.message);
            console.log(e.stack);
            global.process.exit(99);
          });
          hooksAdded = true
        }

        global.process.on('cleanup',callback);
      }

    })()
  },

  rx:{

    fromIterator(it){
      if(Utils.isGenerator(it)){
        it = it();
      }

      if(Utils.isIterator(it)){
        it = it[Symbol.iterator]();
        return rx.Observable.create((sub) => {
          (function getNext(){
            let obj = it.next();
            if(obj.done){
              sub.complete();
            }else{
              Promise.resolve(obj.value).then((res) => {
                if(!sub.closed){
                  sub.next(res);
                  getNext();
                }

              }, (err) => {
                if(!sub.closed){
                  sub.error(err);
                  getNext();
                }
              });
            }


          })();

        })
      }

      return rx.Observable.empty();
    },

    fromEventEmitter(emitter){
      return rx.Observable.create(o => {
        let onData = (data) => {
          if(!o.closed){
            o.next(data);
          }
        };

        let onEnd = () => {
          if(!o.closed){
            o.complete();
          }
        };

        emitter.on('data', onData);
        emitter.on('end', onEnd);

        o.add(() => {
          emitter.removeListener('data', onData);
          emitter.removeListener('end', onEnd);
        })
      })
    }
  },

  net: {
    get localIp() {
      var ifaces = os.networkInterfaces();

      for (let ifname of Object.keys(ifaces)) {
        for (let iface of ifaces[ifname]) {
          if ('IPv4' !== iface.family || iface.internal !== false) {
            // skip over internal (i.e. 127.0.0.1) and non-ipv4 addresses
            break;
          }

          return iface.address;
        }
      }

    }
  },

  BitFlag:{
    hasAny(src, flags){
      return Utils.BitFlag._hasAllOrAny(Utils.getVarArgs(arguments), false);
    },

    hasAll(src, flags){
      return Utils.BitFlag._hasAllOrAny(Utils.getVarArgs(arguments), true);
    },

    remove(src, flags){
      flags = Utils.getVarArgs(arguments)
      src = flags.shift();
      return src & ~(Utils.BitFlag._mergeFlags(flags));
    },

    add(src, flags){
      flags = Utils.getVarArgs(arguments)
      src = flags.shift();
      return src | (Utils.BitFlag._mergeFlags(flags));
    },

    _hasAllOrAny(srcAndFlags, matchAll){
      var src = srcAndFlags.shift(), flags = srcAndFlags;
      var matches = false;
      for(let flag of flags){
        if((src & flag )=== flag){
          matches = true;
          if(!matchAll){
            break;
          }
        }else if(matchAll){
          return false;
        }else{
          matches = false;
        }
      }
      return matches;
    },

    _mergeFlags(flags){
      var mask = 0;
      for(let flag of Utils.makeArray(flags)){
        mask |= flag;
      }
      return mask;
    }
  },

  UriBuilder: function(){
    var mProtocol = 'http', mQuery = null, mPath = '', mHost;


    this.set = function(obj){
      if(Utils.isPlainObject(obj)){
        for(var key of Object.keys(obj)){
          var value = obj[key];
          switch (key){
            case 'protocol':
            this.protocol(value);
            break;
            case 'query':
            this.query(value);
            break;
            case 'path':
            this.path(value);
            break;
            case 'host':
            this.host(value);
            break;
          }
        }
      }
      return this;
    };

    this.protocol = function(protocol){
      mProtocol = protocol;
      return this;
    };

    this.query = function(obj){
      if(Utils.isPlainObject(obj)){
        mQuery = mQuery || {};
        for(let key of Object.keys(obj)){
          if(Utils.isNullOrUndefined(obj[key])){
            delete mQuery[key];
          }else{
            mQuery[key] = obj[key]
          }
        }
      }
      return this;
    };

    this.path = function(path){
      mPath = path;
      return this;
    };

    this.host = function(name){
      mHost = name;
      return this;
    };

    this.toString = function(){
      var baseUri = Url.format({
        host: mHost,
        protocol: mProtocol,
        pathname: mPath
      });
      if(mQuery){
        baseUri = baseUri.concat('?').concat(Utils.makeQsParams(mQuery))
      }
      return baseUri;
    };

    this.buildUpon = function(){
      return new Utils.UriBuilder().set({
        protocol: mProtocol,
        query: mQuery,
        path: mPath,
        host: mHost
      })
    }


  },

  // natural sorting before digesting the string value of the arguments
  // Utils.naturalHexDigest(1,2,3) === Utils.naturalHexDigest(3,1,2)
  naturalHexDigest: function(){
    return Utils.hexDigest(Utils.stringify(Utils.getVarArgs(arguments)))
  },

  hexDigest: function(){
    var args = Utils.getVarArgs(arguments),
    chunks = [];

    for(var obj of args){
      if(obj == null){
        continue;
      }
      chunks.push(Utils.isString(obj) ? obj : JSON.stringify(obj));
    }
    return crypto.createHash('md5').update(String.prototype.concat.apply('', chunks)).digest('hex');
  },

  isPrimitive: function(whatever){
    switch(typeof whatever) {
      case 'undefined':
      case 'function':
      return false;
      case 'number':
      case 'string':
      case 'boolean':
      return true;
      case 'object':
      if(whatever == null){
        return true;
      }
      switch (whatever.constructor) {
        case Date:
        return true;
      }
    }
    return false;
  },

  isPlainObject: function(whatever){
    return whatever != null && typeof whatever == 'object' && whatever.constructor == Object && !Utils.isIterator(whatever);
  },

  isNumber: function(whatever){
    return typeof whatever === 'number';
  },

  // java like varArgs parameters
  getVarArgs: function(argumentsObj){

    if(!Utils.isIterator(argumentsObj) && argumentsObj && typeof argumentsObj.length == 'number'){
      argumentsObj = Array.prototype.slice.call(argumentsObj)
      // the arguments object is not an interable in node 0.12.7
    }

    if(Utils.isIterator(argumentsObj)){
      var args = argumentsObj instanceof Array ? argumentsObj : Utils.makeArray(argumentsObj);
      if((args[0] instanceof Array) && args.length == 1){
        args = args[0]
      }
      return args
    }
    return null;

  },

  // stringifies the nested objects by performing a natural sort using the string value of all nested objects
  stringify: function(whatever){

    switch(typeof whatever){
      case 'undefined':
      case 'function':
      return '';
      case 'number':
      case 'string':
      case 'boolean':
      return whatever.toString()
      case 'object':
      if(whatever == null){
        return '';
      }
      if(whatever.constructor == Array){
        var stringArr = whatever.map(function(o){
          return Utils.stringify(o)
        }).sort();
        return String.prototype.concat.apply('', stringArr)
      }else if(Utils.isIterator(whatever)){
        return Utils.stringify(Utils.makeArray(whatever))
      }
      if(whatever.constructor == Map){
        var delegate = {}, it = whatever.keys();
        for(var v = it.next(); !v.done; v = it.next()){
          delegate[v.value] = whatever.get(v.value);
        }
        return Utils.stringify(delegate);
      }
      if(Utils.isPlainObject(whatever)){
        var chunks = [];
        for(var key of Object.keys(whatever)){
          if(!whatever.hasOwnProperty(key)){
            continue;
          }
          chunks.push(Utils.stringify(key))
          chunks.push(Utils.stringify(whatever[key]))
        }
        return Utils.stringify(chunks)
      } else{
        switch(whatever.constructor){
          case Array:
          whatever = whatever.map(function(v){
            return Utils.stringify(v)
          });
          return String.prototype.concat.apply('', whatever.sort())
          case Date:
          default:
          return whatever.toString();

        }
      }

    }
    return '';
  },

  isGenerator: function(fn){
    if(typeof fn != 'function'){
      return false;
    }
    return GENERATOR == fn.constructor;
  },

  isIterator: function(obj){
    return obj && typeof obj[Symbol.iterator] === 'function';
  },

  isPromise: function(obj){
    return obj != null && obj.constructor != null && obj.constructor.name === 'Promise'
  },

  isString: function(obj){
    return typeof obj === 'string'
  },

  isBoolean: function(obj){
    return typeof obj === 'boolean';
  },

  isArray: function(obj){
    return Array.isArray(obj)
  },

  isFunction(obj){
    return typeof obj === 'function'
  },

  isModelClass: function(whatever){
    //models.Products instanceof  models.sequelize.Model
    return whatever instanceof getSequelizeInstance().Model;
  },

  isNullOrUndefined(obj){
    return (obj === null) || (typeof obj === 'undefined');
  },

  contains: function(it, obj){
    if(it instanceof Set){
      return it.has(obj);
    }
    return !!(indexOf(it, obj))
  },

  indexOf: function(it, obj){
    if(Utils.isArray(it)){
      return it.indexOf(obj)
    }

    if(!Utils.isIterator(it)){
      return -1;
    }

    var pos = 0;
    for(var member of it){
      if(member === obj){
        return pos;
      }
      pos += 1;
    }
    return -1;
  },

  flattenIterable: function(arr){
    return Array.prototype.concat.apply([], Utils.makeArray(arr));
  },

  makeArray: function(obj){
    if(Utils.isNullOrUndefined(obj)){
      return []
    }

    if(obj instanceof Array){
      return obj;
    }

    if(Utils.isIterator(obj) && !Utils.isString(obj)){
      if(typeof Array.from === 'function'){
        return Array.from(obj)
      }

      var it = obj[Symbol.iterator](), res = [];
      for(var x = it.next(); !x.done; x = it.next()){
        res.push(x.value)
      }
      return res;
    }
    return [obj];
  },

  merge: function(into, source){
    var args = Utils.getVarArgs(arguments)
    into = args.shift();

    if(!Utils.isPlainObject(into)){
      into = {}
    }

    if(Utils.isPlainObject(into)){
      while(args.length){
        source = args.shift();
        if(Utils.isPlainObject(source)){
          for(var key of Object.keys(source)){
            into[key] = source[key]
          }
        }
      }
    }

    return into;
  },

  unNestObject: function(obj){
    const res = {};
    for(let key of Object.keys(obj)){
      if(key.indexOf('.') >= 0){
        let chunks = key.split('.');
        let placeholder = res;
        while(chunks.length > 1){
          let chunk = chunks.shift();
          if(!Utils.isPlainObject(placeholder[chunk])){
            placeholder[chunk] = {}
          }
          placeholder = placeholder[chunk]
        }
        placeholder[chunks[0]] = obj[key];
      }else{
        res[key] = obj[key];
      }
    }
    return res;

  },


  makeQsParams: function(obj, prefix){
    if(obj == null){
      return ''
    }
    var str = [];
    for(var p in obj) {
      if (obj.hasOwnProperty(p)) {

        var k = prefix ? prefix + "[" +( Utils.isArray(obj) ? '' : p) + "]" : p, v = obj[p];
        str.push(typeof v == "object" ? Utils.makeQsParams(v, k) :
        k + "=" + encodeURIComponent(v));
      }
    }
    return str.join("&");
  },

  logException: function(e){
    if(e instanceof Error){
      console.error(e, e.stack.split("\n"))
    }
  },


  parseDate: function(rawDate){
    if(!rawDate){
      return null;
    }

    if(/^\d+$/.test(''+rawDate)){ // if rawDate contains only numbers, then we expect it to be a unix timestamp
      if(/^\d{10,13}$/.test(''+rawDate)){
        rawDate = new Date(parseInt((rawDate+'000').substring(0,13)))
      }else{
        return null;
      }
    }

    var m = moment(rawDate);
    return m.isValid() && m.toDate() || null;
  },


  getEnvironmentName(){
    return (process.env.SERVER_ENV || 'development');
  },

  devEnv(){
    return Utils.getEnvironmentName() === 'development';
  },

  random(min, max){
    return Math.floor(Math.random() * (max - min) + min);
  },

  round(number, decimals){
    if(!Utils.isNumber(number)){
      return null;
    }
    if(number === 0){
      return 0;
    }
    number = parseFloat(number);
    if(!number){
      return number;
    }
    if(decimals < 1){
      return Math.round(number);
    }
    if(parseInt(number) == number){
      return number
    }
    var multiplier = Math.pow(10, Math.max(decimals, 0));
    return Math.round(number*multiplier)/multiplier;

  },


  newBatch(stepSize, totalCount){
    var currentStep = -1, stepCount = Math.ceil(totalCount/stepSize), lowerTier = 0, upperTier = 0;


    var Self = {
      hasNext(){
        return upperTier < totalCount;
      },

      next(){
        currentStep += 1;
        lowerTier = stepSize*currentStep;
        upperTier = Math.min((currentStep+1)*stepSize, totalCount);
        return lowerTier < upperTier ? Self : null;
      },

      get min(){
        return lowerTier;
      },

      get max(){
        return upperTier;
      },

      get stepSize(){
        return upperTier-lowerTier;
      }
    };

    return Self;
  }





}
