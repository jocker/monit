'use strict';

const Promise = require('bluebird');

Promise.coroutine.addYieldHandler(function (v) {
  return Promise.resolve(v);
});