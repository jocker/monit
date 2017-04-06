'use strict';


const childProcess = require('child_process'),
  EventEmitter = require('events').EventEmitter;

const VIDEO_CMD = ''


const RaspiVideoCmd = class extends EventEmitter{
  constructor() {
    this._args = new Map();
    this._isStarted = false;
  }

  setWidth() {

  }
}