"use strict";

const Utils = require('./utils.js'),
  Router = require('./api_router'),
  stream = require('stream');


const Promise = require('bluebird');

const Headers ={
  CacheControl:'Cache-Control',
  Pragma: 'Pragma',
  Expires: 'Expires',
  ContentEncoding: 'Content-Encoding',
  TransferEncoding:'Transfer-Encoding',
  ContentType:'Content-Type',

  setNoCache(response){
    Headers.set(response, Headers.CacheControl, "no-cache, no-store, must-revalidate", true);
    Headers.set(response, Headers.Pragma, "no-cache", true);
    Headers.set(response, Headers.Expires, "0", true);
  },

  set(response, key, value, force){
    if(force || !response.get(key)){
      response.set(key, value);
      return true;
    }
    return false;
  },

  setEncoding(response, encoding, force){
    return Headers.set(response, Headers.ContentEncoding, encoding, force);
  },

  setChunkedContent(response){
    return Headers.set(response, Headers.TransferEncoding, 'chunked', true)
  },

  setJsonContentType(response){
    return Headers.set(response, Headers.ContentType, 'application/json', true);
  }


};

module.exports = class ApiRequest{


  constructor(request, response){
    const startedAt = new Date().getTime();

    Object.defineProperties(this,{
      originalRequest: {value: request, writable: false},
      originalResponse:{ value: response, writable: false },
      startedAt: {value: startedAt}
    });

    this._responseOptions = {
      disableCache: false,
      isDone: false
    };

  }

  getQueryParameters(){
    return this.originalRequest.query;
  }

  getQueryParameter(key){
    return this.originalRequest.query[key];
  }

  getBody(){
    return this.originalRequest.body;
  }

  getParameter(key){
    return this.originalRequest.params[key];
  }

  getRequestHeader(key){
    return this.originalRequest.headers[key.toLowerCase()];
  }

  getRequestUri(){
    const request = this.originalRequest;
    return new Utils.UriBuilder()
      .host(request.get('host'))
      .protocol(request.protocol)
      .path(request.path)
      .query(request.query)
  }


  noCache(){
    this._responseOptions.disableCache = true;
    return this;
  }


  // conditional get, aka if the request contains the ETAG/If-Modified-Since headers, and if they are equal with the lastModifiedAt and etag parameters,
  // the it means the client already has a cached response for this request and the server doesn't have any new changes
  // in which case running any expesive queries on the server for generating content doesn't make sense

  // returns false if the content is fresh(in which case the server needs to send the fresh content),
  //          true otherwise (in which case, the controller code should NOT do anything else because the response is set from here)
  stale(lastModifiedAt, etag){

    const self = this, request = self.originalRequest, response = self.originalResponse;

    if(request.method !== 'GET'){
      return false;
    }

    var shouldStale = false;

    if((lastModifiedAt instanceof Date ) && !isNaN(lastModifiedAt)){
      response.set('Last-Modified-At', lastModifiedAt.toUTCString());

      var requestModifiedSince = request.headers['if-modified-since'] && Date.parse(request.headers['if-modified-since']);
      if(!isNaN(requestModifiedSince) && requestModifiedSince == lastModifiedAt){
        shouldStale = true
      }
    }

    if(typeof etag === 'string'){
      response.set('ETag', etag);
      if(request.headers['if-none-match'] === etag){
        shouldStale = true;
      }
    }

    if(shouldStale){
      self.setResponse(304)
    }

    return shouldStale;
  }
  // body may be a readable stream, an error or a generic object
  // statusCode must be a valid http status code
  // headers must be a plain object containing string values

  // In case this method is called more that once during the same request, then an error is going to be thrown
  // because a request can send a single response.

  //
  setResponse(statusCode, body, headers){

    const self = this;

    if(Utils.isPromise(statusCode)){
      Promise.resolve(statusCode).then((data) => {
        self.setResponse(200, data)
      }, (err) => {
        console.error('server', err)
        self.setResponse(500);
      });
      return;
    }

    var args = Utils.getVarArgs(arguments);
    if(!body && !headers && Utils.isArray(statusCode)){
      args = [args]
    }

    const response = self.originalResponse;

    // handling the possible varargs
    // - setResponse(statusCode)
    // - setResponse(error)
    // - setResponse(body)
    // - setResponse(readableStream)
    // - or any combination of statusCode, body(in this order)
    if(args.length == 1){
      if(statusCode instanceof stream.Readable){
        return self.setResponse(200, statusCode);
      }else if(statusCode instanceof Error){
        return self.setResponse(400, statusCode.toPlainObject(), null);
      }else if(typeof statusCode === 'number'){
        return self.setResponse(statusCode, null, null);
      }else{
        Promise.resolve(statusCode)
          .then(function(res){
            self.setResponse(200, res, null)
          },function(err){
            self.setError(err)
          });
        return !response.finished;
      }


    }else if(args.length == 2){
      if(typeof  statusCode != 'number'){
        return self.setResponse(200, body, headers);
      }
      return self.setResponse(statusCode, body, null)
    }

    if(this._responseOptions.hasResponseSet){
      throw new Error('Response already set')
    }

    if(args.length == 3 && !response.finished && (typeof statusCode == 'number')){
      this._responseOptions.hasResponseSet = true;
      if(Utils.isPlainObject(headers)){
        for(var key of Object.keys(headers)){
          response.set(key, headers[key])
        }
      }

      if(self._responseOptions.disableCache){
        Headers.setNoCache(response);
      }

      response.status(statusCode);

      if(!Utils.isNullOrUndefined(body)){
        response.json(body);
      }else{
        response.send('');
      }
      if(Utils.devEnv()){
        var responseBody = null;
        if(!Utils.isNullOrUndefined(body)){
          responseBody = body instanceof stream.Readable ? '[STREAM]' : JSON.stringify(body);
        }
        console.info('[API RESPONSE] ', statusCode, responseBody, headers)
      }
      return true;
    }
    return false;
  }

  setResponseEncoding(encoding, force){
    if(this.supportsEncoding(encoding)){
      return Headers.setEncoding(this.originalResponse, encoding, force)
    }
    return false;
  }

  supportsEncoding(encoding){
    return this.supportedEncodings.has(encoding);
  }

  get supportedEncodings(){
    if(!this._supportedEncodings){
      this._supportedEncodings = new Set();
      var requestEncoding = this.getRequestHeader('accept-encoding');

      if(/\bgzip\b/.test(requestEncoding)){
        this._supportedEncodings.add('gzip');
      }
      if(/\bdeflate\b/.test(requestEncoding)){
        this._supportedEncodings.add('deflate');
      }
    }
    return this._supportedEncodings
  }


  setError(errBody){
    return this.setResponse(400, errBody, null)
  }

  // if this returns true, then it means the socket is closed(request canceled)
  // This is useful mostly when the response is streamed - if the client closed the connection,
  //  then we can stop performing any other possible expensive operations because the client cannot receive anything
  hasWritableConnection(){
    if(!this.originalResponse || !this.originalResponse.connection){
      return false;
    }
    var writableState = this.originalResponse.connection._writableState;
    var has = !writableState.ended && !writableState.finished;
    if(!has && Utils.devEnv()){
      console.warn("CLOSED CONNECTION; Stream should be interrupted")
    }
    return has;
  }


  get finished(){
    return !this._responseOptions.isDone && !this._responseOptions.hasResponseSet && this.hasWritableConnection();
  }


  get done(){
    return !this.hasWritableConnection() || this._responseOptions.isDone;
  }

};

