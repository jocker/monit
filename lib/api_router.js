'use strict';

const nodeUtils = require('util'),
  Utils = require('./utils'),
  express = require('express'),
  Promise = require('bluebird');

module.exports = class Router {

  constructor() {
    this._routes = new Map();
    this._middlewareStack = new Set();
  }

  get(path, callback) {
    return this._addRouteWithVerb('get', path, callback)
  }

  post(path, callback) {
    return this._addRouteWithVerb('post', path, callback)
  }

  put(path, callback) {
    return this._addRouteWithVerb('put', path, callback)
  }

  beforeFilter(middleware) {
    if (typeof middleware == 'function') {
      this._middlewareStack.add(middleware)
    }
    return this
  }

  authorized() {
    return this;
  }

  mount(parentApp, pathPrefix) {
    for (let routeSpec of this._routes.values()) {
      var absPath = ('/' + pathPrefix + '/' + routeSpec.path).replace(/\/+/g, '/');

    let routeArgs = Utils.makeArray(this._middlewareStack);
    routeArgs.unshift(absPath);

    const ApiRequest = require('../lib/api_request');

    (function () {
      const routeHandler = routeSpec.handler;

      routeArgs.push(function (request, response, _) {
        var apiRequest = new ApiRequest(request, response);
        Promise.coroutine(function* () {
          if (!apiRequest.hasWritableConnection()) {
            apiRequest.setResponse(400);
            return;
          }
          if (Utils.isGenerator(routeHandler)) {
            yield routeHandler.call(apiRequest, apiRequest);
          } else {
            yield Promise.resolve(routeHandler.call(apiRequest, apiRequest));
          }

        })();

      });
      parentApp[routeSpec.verb].apply(parentApp, routeArgs);
    })();
    }

  

  }

  _addRouteWithVerb(verb, path, handler) {
    this._routes.set(verb + '/' + path, {
      verb: verb,
      handler: handler,
      path: path
    });
    return this;
  }
}
