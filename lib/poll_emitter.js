'use strict';

const
    Promise = require('bluebird'),
    EventEmitter = require('events').EventEmitter;

module.exports = class CancelableEventEmitter extends EventEmitter {

    static create(runnable, pollInterval) {
        return new this(runnable, pollInterval)
    }

    constructor(runnable, pollInterval) {
        super();
        this._pollInterval = pollInterval;
        this._runnable = runnable;
    }

    cancel() {
        if (!this._canceled) {
            this._canceled = true;
            this._running = false;
            this.emit('end')
        }
    }

    setInterval(pollInterval) {
        this._pollInterval = pollInterval;
        return this;
    }

    on(evName) {
        const self = this;
        const res = super.on.apply(self, Array.prototype.slice.call(arguments));
        if ('data' === evName) {
            if (!self._running && !self._canceled) {
                self._running = true;
                self.emit('start');
                (function read() {
                    Promise.resolve(self._runnable()).then((data) => {
                        if (!self._canceled && self._running) {
                            self.emit('data', data, self._pollInterval)
                            if (self._pollInterval < 0) {
                                read();
                            } else {
                                setTimeout(read, self._pollInterval)
                            }

                        }
                    }, (e) => {/*ignore*/})
                })();
            }
        }
        return res;
    }

}