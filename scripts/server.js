'use strict';

require('../boot/setup.js');

const express = require('express'),
Router = require('../lib/api_router'),
Utils = require('../lib/utils'),
app = express(),
Constants = require('../lib/constants'),
Camera = require('../peripherals/camera'),

server = require('http').createServer(app),
io = require('socket.io')(server),
port = process.env.PORT || 3000,
appRouter = new Router(),
PubSub = require('../lib/pub_sub');


appRouter
.get('/', (api) => {
  api.setResponse({ status: 'ok' })
})



appRouter.mount(app, '/');

server.listen(port, function () {
  console.log('Server listening at port %s %d', Utils.net.localIp, port);
});


var numUsers = 0;

const handleCameraCmd = function(socket, data, callback){
  let resolver = null;
  switch (data.cmd) {
    case 'camera:x':
    resolver = Camera.setX(data.value);
    break;
    case 'camera:y':
    resolver = Camera.setY(data.value);
    break;
    case 'camera:ir':
    resolver = Camera.setIrBrightness(data.value);
    break;
    case 'camera:settings':
    Camera.getValues().then((values) => {
      data.values = values;
      data.success = true;
      callback(JSON.stringify(data));
    });

    return;

  }
console.log('camera', !!resolver);
  if(!resolver){
    data.success = false;
    callback(JSON.stringify(data));
  }

  resolver.then((success) => {
    data.success = success;
    callback(JSON.stringify(data));
    if(success){
      io.emit(data.cmd, JSON.stringify({
        session_id: data.session_id,
        value: data.value,
        cmd: data.cmd
      }));
    }
  })


}

io.on('connection', function (socket) {
  numUsers += 1;
  console.log('ws connected')

  socket.on('cmd', function(data, callback){
    data = JSON.parse(data);
    console.log('received', data)
    if(!data || !data.session_id || !data.cmd){
      callback(JSON.stringify({success: false}))
      return;
    }

    if(data.cmd.startsWith('camera:')){
      handleCameraCmd(socket, data, callback);
    }

  });

  socket.on('disconnect', function () {
    numUsers -= 1;
    console.log('ws disconnect')
  });

});
