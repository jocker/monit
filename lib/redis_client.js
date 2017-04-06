'use strict';

const Promise = require('bluebird'),
  Redis = require('redis');

const createClient = () => {
  return new Promise((resolve, reject) => {
    const client = Redis.createClient(6379, '127.0.0.1');
    client.once('ready', function () {
      resolve(client)
    })
  })
};


const RESPONSE_OK = 'OK';



const RedisClient = module.exports = new class {

  clone(){
    return createClient();
  }

  exists(key){
    return this.invoke((client, resolve, reject) => {
      client.exists(key, function (err, reply) {
        if (err) {
          reject(err)
        } else {
          resolve(!!reply)
        }
      });
    })
  }

  get(key) {
    return this.invoke((client, resolve, reject) => {
      client.get(key, function (err, reply) {
        if (err) {
          reject(err)
        } else {
          resolve(reply)
        }
      });
    })
  }

  set(key, value) {
    return this.invoke((client, resolve, reject) => {
      client.set(key, value, function (err, reply) {
        if (err) {
          reject(err)
        } else {
          resolve(reply === RESPONSE_OK)
        }
      });
    })
  }

  del(key) {
    return this.invoke((client, resolve, reject) => {
      client.del(key, function (err, reply) {
        if (err) {
          reject(err)
        } else {
          resolve(!isNaN(reply) && reply > 0)
        }
        console.log(reply);
      });
    })
  }

  invoke(callback) {
    return this.getRawConnection().then((conn) => {
      return new Promise((resolve, reject) => {
        callback(conn, resolve, reject)
      })

    })
  }

  expire(key, ttl){
    return this.invoke((conn, resolve, reject) => {
      conn.expire(key, ttl, (err, res) => {
        if(err){
          reject(err)
        }else{
          resolve(res == 1)
        }
      })
    });
  }


  copyList(src, dst, ttl){
    const lua =  `
if redis.call('exists', KEYS[1]) == 1 then 
    local res = redis.call( 'lrange', KEYS[1], ARGV[1], ARGV[2] ); 
    return redis.call( 'rpush', KEYS[2], unpack(res) ); 
else 
    return -1 
end
`;

    return this.invoke((conn, resolve, reject) => {
      let cmd = conn.multi().eval(lua, 2, src, dst, 0, -1);

      if(ttl){
        cmd = cmd.expire(dst, ttl);
      }

      cmd.exec((err, res) => {
        if(err){
          reject(err)
        }else{
          resolve(res[0])
        }
      })

    });

  }

  getRawConnection(){
    const self = this;
    if (!self._connection) {
      self._connection = createClient().then((client) => {
        return self._connection = client;
      })
    }
    return Promise.resolve(self._connection);
  }

}

