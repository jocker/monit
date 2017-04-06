'use strict';

const RedisClient = require('./redis_client'),
  uuid = require('uuid'),
  Utils = require('./utils'),
  PubSub = require('./pub_sub');

const appendTimeSeriesResult = (results, ts, value) => {
  if(isNaN(results.min) || results.min > ts){
    results.min = ts;
  }
  if(isNaN(results.max) || results.max < ts){
    results.max = ts;
  }
  results.values.set(ts, value);
};

const serializePoint = (timestamp, value) => {
  return timestamp+':'+(isNaN(value) ? '' : value);
};

const deserializePoint = (str) => {
  if(!str){
    return null;
  }
  const chunks = str.split(':');
  if(chunks.length != 2){
    return null;
  }

  const timestamp = parseInt(chunks[0]) || null; // can't be 0
  if(isNaN(timestamp)){
    return null;
  }
  const value =  chunks[1].length ? parseInt(chunks[1]) : null;
  if(isNaN(value)){
    return null;
  }

  return [timestamp, value];

};

const sanitizeTimestamp = (ts, pointInterval) =>{
  return Math.floor(ts/pointInterval)*pointInterval;
};

class TimeSeries{
  constructor(name, seriesOption){
    const self = this;


    this._seriesOptions = {
      name: name,
      collectionName: name+'_series',
      size: seriesOption.maxSize,
      pointInterval: seriesOption.pointInterval,
      publishChannelName: `series:${name}:add`,
      emptyValue: seriesOption.emptyValue,
      valueMin: seriesOption.valueMin,
      valueMax: seriesOption.valueMax,
      defaultRange: seriesOption.defaultRange
    };

    RedisClient.getRawConnection().then((conn) => {
      conn.lindex(name,0, (err, value) => {
        value = deserializePoint(value);
        self._lastAddedTimestamp = value && value[1] || null;
      })
    })

  }

  add(timestamp, value){
    const self = this, seriesOptions = self._seriesOptions;

    timestamp = sanitizeTimestamp(timestamp, seriesOptions.pointInterval);

    if(timestamp <= (self._lastAddedTimestamp || 0)){
      return Promise.resolve(false);
    }
    return RedisClient.invoke((conn, resolve) => {
      conn.multi()
        .lpush(seriesOptions.collectionName, serializePoint(timestamp, value))
        .ltrim(seriesOptions.collectionName, 0, seriesOptions.size-1)
        .exec((err) => {
          if(err){
            console.error(err);
            resolve(false)
          }else{
            const result = [timestamp, value];
            resolve(result);
            self._lastAddedTimestamp = timestamp;
            PubSub.publish(seriesOptions.publishChannelName, result);
          }

        })
    });

  }

  getLatest(count){
    if(isNaN(parseInt(count))){
      count = Math.ceil(this._seriesOptions.defaultRange/this._seriesOptions.pointInterval);
    }else{
      count = Math.min(count, 3600);
    }
    return this.getValuesSince(Utils.system.millis-this._seriesOptions.pointInterval*(count+1)).then((res) => {
      while(res.points.length > count){
        res.points.pop();
      }
      res.count = res.points.length;
      return res;
    })
  }

  getValuesSince(sinceTimestamp){

    const self = this, seriesOptions = self._seriesOptions;
    const batchSize = 1000;

    if(isNaN(parseInt(sinceTimestamp))){
      sinceTimestamp = sanitizeTimestamp(Utils.system.millis-60*60*1000, seriesOptions.pointInterval);
    }

    sinceTimestamp = sanitizeTimestamp(sinceTimestamp, seriesOptions.pointInterval)+seriesOptions.pointInterval;
    const emptyValue = Utils.isNullOrUndefined(seriesOptions.emptyValue) ? null : seriesOptions.emptyValue;

    const results = {
      min: NaN,
      max: NaN,
      values: new Map()
    };

    var insertions = 0;
    // in case any other insert occurs while we're fetching the data, collect the results and return them in the result
    const watchInsertsSub = PubSub.on(seriesOptions.publishChannelName).subscribe((values) => {
      insertions += 1;
      appendTimeSeriesResult(results, values[0], values[1]);
    });


    return RedisClient.invoke((conn, resolve, reject) => {
      var startIndex = 0;

      (function fetchMore(){
        startIndex += insertions;
        insertions = 0;
        conn.lrange(seriesOptions.collectionName, startIndex, startIndex+batchSize-1, (err, res) => {
          if(err){
            reject(err);
          }else{
            if(res.length == 0){
              resolve(results)
            }
            for(let point of res){
              let pair = deserializePoint(point);
              if(!pair){
                continue;
              }
              let ts = pair[0], value = pair[1];

              if(ts < sinceTimestamp){
                resolve(results);
                return;
              }else{
                appendTimeSeriesResult(results, ts, value);
              }
            }

            if(res.length < batchSize){
              resolve(results);
              return;
            }

            startIndex += batchSize;

            fetchMore();
          }
        })
      })();
    }).then((results) => {
      watchInsertsSub.unsubscribe();

      const points = [];

      let maxTs = sanitizeTimestamp(Utils.system.millis, seriesOptions.pointInterval);
      let minTs = sinceTimestamp;
      while(sinceTimestamp <= maxTs){

        if(results.values.has(sinceTimestamp)){
          points.push(results.values.get(sinceTimestamp))
        }else{
          // if the point for "now" is null, then we will not add it in the response - it may come later
          if(sinceTimestamp != maxTs){
            points.push(emptyValue)
          }else{
            maxTs -= seriesOptions.pointInterval;
            break;
          }

        }
        sinceTimestamp += seriesOptions.pointInterval;
      }


      return {
        min: minTs,
        max: maxTs,
        count:points.length,
        step: seriesOptions.pointInterval,
        series_min: seriesOptions.valueMin,
        series_max: seriesOptions.valueMax,
        type: seriesOptions.name,
        points: points,

      }
    })

  }


  get pointInterval(){
    return this._seriesOptions.pointInterval;
  }

  get name(){
    return this._seriesOptions.collectionName;
  }

}


const INSTANCES = new Map();
const Series = module.exports = {
  TYPE_LIGHT: 'light',
  TYPE_SOUND: 'sound',
  TYPE_HUMIDITY: 'humidity',
  TYPE_TEMPERATURE: 'temperature',

  has: (name) =>{
    switch(name){
      case Series.TYPE_SOUND:
      case Series.TYPE_LIGHT:
      case Series.TYPE_HUMIDITY:
      case Series.TYPE_TEMPERATURE:
        return true;
    }
    return false;
  },

  get: (name) =>{
    let instance = INSTANCES.get(name);

    if(!instance){
      const oneDay = 24*60*60*1000;
      const options = {
        pointInterval: oneDay,
        emptyValue: null,
        valueMin: 0,
        valueMax: 1024,
        defaultRange: oneDay
      };


      let pointInterval = oneDay, emptyValue = null;
      switch(name){
        case Series.TYPE_SOUND:
          options.pointInterval = 50; // one per second
          options.emptyValue = 0;
          options.defaultRange = 10*60*1000;
          break;
        case Series.TYPE_LIGHT:
        case Series.TYPE_HUMIDITY:
        case Series.TYPE_TEMPERATURE:
          options.pointInterval = 60*1000; // one per minute
          break;
        default:
          throw new Error('unknown series '+name)
      }

      options.maxSize = oneDay/options.pointInterval;

      instance = new TimeSeries(name, options)

    }
    return instance;
  }

};