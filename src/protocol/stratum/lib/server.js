module.exports = function (classes){
  'use strict';

  var
    _ = classes.lodash,
    q = classes.q;

  var Server = classes.Base.$define('Server', {
    construct      : function (opts){
      var self = this;

      this.$super();

      self.clients = {};

      opts = opts || {};

      self.opts = _.defaults(_.clone(opts), Server.defaults);

      if (opts.rpc){
        self.rpc = new classes.RPCServer(self.opts.rpc);

        self.expose('mining.connections');
        self.expose('mining.block');
        self.expose('mining.wallet');
        self.expose('mining.alert');
      }

      // classes.toobusy.maxLag(self.opts.settings.toobusy);

      self.server = classes.net.createServer();

      Server.debug('Created server');

      self.server.on('connection', function serverConnection(socket){
        self.newConnection(socket);
      });
    },
    expose         : function (name){
      if (this.rpc) {
        this.rpc.expose(name, Server.expose(this, name), this);
      } else {
        throw new Error('RPC is not enabled in the server');
      }
    },
    /**
     * Emits 'close' event when a connection was closed
     *
     * @param {Client} socket
     */
    closeConnection: function (socket){
      var id = socket.id;
      socket.destroy();

      if (typeof this.clients[id] !== 'undefined') {
        delete this.clients[id];
      }

      this.emit('close', id);

      Server.debug('(' + id + ') Closed connection ' + _.size(this.clients) + ' connections');
    },
    /**
     * Emits 'busy' event when the server is on high load
     * Emits 'connection' event when there's a new connection, passes the newly created socket as the first argument
     *
     * @param {Socket} socket
     */
    newConnection  : function (socket){
      var
        self = this,
        closeSocket,
        handleData;

      // if (classes.toobusy()) {
      if (false) {
        socket.destroy();

        Server.debug('Server is busy, ' + _.size(this.clients) + ' connections');

        self.emit('busy');
      } else {
        socket = new classes.Client(socket, true);

        closeSocket = (function (socket){
          return function closeSocket(){
            self.closeConnection(socket);
          };
        })(socket);

        handleData = (function (socket){
          return function handleData(buffer){
            self.handleData(socket, buffer);
          };
        })(socket);

        classes.Server.debug('(' + socket.id + ') New connection');

        this.clients[socket.id] = socket;

        socket.on('end', closeSocket);
        socket.on('error', closeSocket);

        socket.socket.on('data', handleData);

        this.emit('connection', socket);
      }
    },
    /**
     *
     * @param {Client} socket
     * @param {Buffer} buffer
     */
    handleData     : function (socket, buffer){
      var
        self = this,
        c = Server.getStratumCommands(buffer),
        string = c.string,
        cmds = c.cmds;

      if (/ HTTP\/1\.1\n/i.test(string)) {
        // getwork trying to access the stratum server, send HTTP header
        socket.stratumHttpHeader(
            this.opts.settings.hostname,
            this.opts.settings.port
          ).done(function handleDataHttp(){
            self.closeConnection(socket);
          });
      } else if (cmds.length) {
        // We got data
        self.$class.processCommands.call(self, socket, cmds);
      }
    },
    /**
     * Start the Stratum server, the RPC and any coind that are enabled
     *
     * @return {Q.promise}
     */
    listen         : function (){
      var self = this, d = q.defer();

      this.server.listen(this.opts.settings.port, this.opts.settings.host, function serverListen(){
        d.resolve(Server.debug('Listening on port ' + self.opts.settings.port));
      });

      /*istanbul ignore else */
      if (this.rpc) {
        this.rpc.listen();
      }

      return d.promise;
    },
    close          : function (){
      Server.debug('Shutting down servers...');

      this.server.close();

      /*istanbul ignore else */
      if (this.rpc) {
        this.rpc.close();
      }
    },
    /**
     * Sends a Stratum result command directly to one socket
     *
     * @param {String} id UUID of the socket
     * @param {String} type The type of command, as defined in server.commands
     * @param {Array} array Parameters to send
     *
     * @return {Q.promise}
     */
    sendToId       : function (id, type, array){
      var d = q.defer();


      if (type && _.isFunction(this.$class.commands[type])) {
        if (id && _.has(this.clients, id)) {

          this.$class.commands[type].apply(this.clients[id], [id].concat(array)).done(
            classes.curry.wrap(d.resolve, d),
            classes.curry.wrap(d.reject, d)
          );
        } else {
          d.reject(this.$class.debug('sendToId socket id not found "' + id + '"'));
        }
      } else {
        d.reject(this.$class.debug('sendToId command doesnt exist "' + type + '"'));
      }

      return d.promise;
    },
    /**
     * Send a mining method or result to all connected
     * sockets
     *
     * Returns a promise, so when it's done sending, you can
     * do:
     *
     * server.broadcast('notify', [...params]).then(function(){
     *  console.log('done');
     * });
     *
     * @param {String} type
     * @param {Array} data
     * @returns {Q.promise}
     */
    broadcast      : function (type, data){
      var self = this, d = q.defer(), total = 0;

      if (typeof type === 'string' && _.isArray(data)) {
        if (typeof self.$class.commands[type] === 'function' && self.$class.commands[type].broadcast === true) {
          if (_.size(self.clients)) {
            self.$class.debug('Brodcasting ' + type + ' with ', data);

            q.try(function serverBroadcast(){

              _.forEach(self.clients, function serverBroadcastEach(socket){
                self.$class.commands[type].apply(socket, [null].concat(data));
                total++;
              });

              return total;
            }).done(
              classes.curry.wrap(d.resolve, d),
              classes.curry.wrap(d.reject, d)
            );

          } else {
            d.reject(self.$class.debug('No clients connected'));
          }
        } else {
          d.reject(self.$class.debug('Invalid broadcast type "' + type + '"'));
        }
      } else {
        d.reject(self.$class.debug('Missing type and data array parameters'));
      }

      return d.promise;
    }
  }, {
    /**
     * Parse the incoming data for commands
     *
     * @param {Buffer} buffer
     * @returns {{string: string, cmds: Array}}
     */
    getStratumCommands: function (buffer){
      var
        string,
        cmds = [];

      if (Buffer.isBuffer(buffer) && buffer.length) {
        string = buffer.toString().replace(/[\r\x00]/g, '');
        cmds = _.filter(string.split('\n'), function serverCommandsFilter(item){ return !_.isEmpty(item) && !_.isNull(item); });
      }

      // Separate cleaned up raw string and commands array
      return {string: string, cmds: cmds};
    },
    /**
     * Process the Stratum commands and act on them
     * Emits 'mining' event
     *
     * @param {Client} socket
     * @param {Array} cmds
     */
    processCommands   : function (socket, cmds){
      var
        command,
        method,
        self = this,
        onClient = self.$instanceOf(classes.Client),
        onServer = !onClient && self.$instanceOf(classes.Server);

      self.$class.debug('(' + socket.id + ') Received command ' + cmds);

      _.forEach(cmds, function serverForEachCommand(cmd){
        try {
          command = JSON.parse(cmd);

          // Is it a method Stratum call?
          if (
              // Deal with method calls only when on Server
              onServer &&
              typeof command['method'] !== 'undefined' &&
              command.method.indexOf('mining.') !== -1
            ) {
            method = command.method.split('mining.');
            command['method'] = method[1];


            if (method.length === 2 && typeof self.$class.commands[method[1]] === 'function') {
              // We don't want client sockets messing around with broadcast functions!
              if (self.$class.commands[method[1]].broadcast !== true && method[1] !== 'error') {
                // only set lastActivity for real mining activity
                socket.setLastActivity();

                var
                  d = q.defer(),
                  accept, reject;

                // Resolved, call the method and send data to socket
                accept = self.$class.bindCommand(socket, method[1], command.id);
                // Rejected, send error to socket
                reject = self.$class.bindCommand(socket, 'error', command.id);

                d.promise.spread(accept, reject);

                self.emit('mining', command, d, socket);
              } else {
                throw new Error('(' + socket.id + ') Client trying to reach a broadcast function "' + method[1] + '"');
              }
            } else {
              self.$class.commands.error.call(socket, command.id, self.$class.errors.METHOD_NOT_FOUND);

              throw new Error('Method not found "' + command.method + '"');
            }

          } else if ((onClient || socket.byServer === true) && (_.has(command, 'result') || _.has(command, 'method'))) {
            // Result commands ONLY when 'self' is an instance of Client

            // Since (unfortunately) stratum expects every command to be given in order

            // we need to keep track on what we asked to the server, so we can
            // act accordingly. This call is either a result from a previous command or a method call (broadcast)

            socket.fullfill(command);
          } else {
            throw new Error('Stratum request without method or result field');
          }
        } catch (e) {
          if (self.emit)
            self.emit('mining.error', self.$class.debug(e), socket);
        }
      });

    },
    /**
     * Wraps the callback and predefine the ID of the current stratum call
     *
     * @param {Client} socket
     * @param {String} type
     * @param {String} id
     *
     * @returns {Function} curryed function
     */
    bindCommand       : function (socket, type, id){
      return classes.curry.predefine(this.commands[type], [id], socket);
    },
    rejected          : function (msg){
      return q.reject(this.$class.debug(msg));
    },
    expose            : function (base, name){
      return function serverExposedFunction(args, connection, callback){
        var d = q.defer();

        classes.RPCServer.debug('Method "' + name + '": ' + args);

        d.promise.then(function serverExposedResolve(res){
          res = [].concat(res);

          classes.RPCServer.debug('Resolve "' + name + '": ' + res);

          callback.call(base, null, [res[0]]);
        }, function serverExposedReject(err){
          classes.RPCServer.debug('Reject "' + name + '": ' + err);

          callback.call(base, ([].concat(err))[0]);
        });

        base.emit('rpc', name, args, connection, d);
      };
    },
    invalidArgs: function(id, name, expected, args) {
      var count = _.filter(args, function(i){ return typeof i !== 'undefined'; }).length - 1;

      if ((id === null || id === undefined) || count !== expected) {
          return classes.Server.rejected(
            (id === null || id === undefined) ?
            'No ID provided' :
            'Wrong number of arguments in "' + name + '", expected ' + expected + ' but got ' + count
          );
      }

      return true;
    },
    commands          : {
      /**
       * Return subscription parameters to the new client
       *
       * @param id
       * @param {String} difficulty
       * @param {String} subscription
       * @param {String} extranonce1
       * @param {Number} extranonce2_size
       *
       * @returns {Q.promise}
       */
      subscribe       : function (id, difficulty, subscription, extranonce1, extranonce2_size){
        var ret;
        if ((ret = classes.Server.invalidArgs(id, 'subscribe', 4, arguments)) !== true){
          return ret;
        }

        this.subscription = subscription;

        return this.stratumSend({
          id    : id,
          result: [
            [
              ['mining.set_difficulty', difficulty],
              ['mining.notify', subscription]
            ],
            extranonce1,
            extranonce2_size
          ],
          error : null
        }, true, 'subscribe');
      },
      /**
       * Send if submitted share is valid
       *
       * @param {Number} id ID of the call
       * @param {Boolean} accepted
       * @returns {Q.promise}
       */
      submit          : function (id, accepted){
        var ret;
        if ((ret = classes.Server.invalidArgs(id, 'submit', 1, arguments)) !== true){
          return ret;
        }

        return this.stratumSend({
          id    : id,
          result: !!accepted,
          error : null
        }, false, 'submit');
      },
      /**
       * Send an error
       *
       * @param {Number} id
       * @param {Array|String} error
       * @returns {Q.promise}
       */
      error           : function (id, error){
        var ret;
        if ((ret = classes.Server.invalidArgs(id, 'error', 1, arguments)) !== true){
          return ret;
        }

        this.$class.debug('Stratum error: ' + error);

        return this.stratumSend({
          id    : id,
          error : error,
          result: null
        }, true, 'error');
      },
      /**
       * Authorize the client (or not). Must be subscribed
       *
       * @param {Number} id
       * @param {Boolean} authorized
       *
       * @returns {Q.promise}
       */
      authorize       : function (id, authorized){
        var ret;
        if ((ret = classes.Server.invalidArgs(id, 'authorize', 1, arguments)) !== true){
          return ret;
        }

        if (!this.subscription) {
          return Server.commands.error.call(this, id, Server.errors.NOT_SUBSCRIBED);
        }

        this.authorized = !!authorized;

        return this.stratumSend({
          id    : id,
          result: this.authorized,
          error : null
        }, true, 'authorize');
      },
      /**
       * Miner is asking for pool transparency
       *
       * @param {String} id txlist_jobid
       * @param {*} merkles
       */
      get_transactions: function (id, merkles){
        var ret;
        if ((ret = classes.Server.invalidArgs(id, 'get_transactions', 1, arguments)) !== true){
          return ret;
        }

        return this.stratumSend({
          id    : id,
          result: [].concat(merkles),
          error : null
        }, false, 'get_transactions');
      },

      /**
       * Notify of a new job
       *
       * @param {Number} id
       * @param {*} job_id
       * @param {String} previous_hash
       * @param {String} coinbase1
       * @param {String} coinbase2
       * @param {Array} branches
       * @param {String} block_version
       * @param {String} nbit
       * @param {String} ntime
       * @param {Boolean} clean
       *
       * @returns {Q.promise}
       */
      notify          : function (id, job_id, previous_hash, coinbase1, coinbase2, branches, block_version, nbit, ntime, clean){
        var ret;
        if ((ret = classes.Server.invalidArgs(false, 'notify', 9, arguments)) !== true){
          return ret;
        }

        return this.stratumSend({
          id    : null,
          method: 'mining.notify',
          params: [job_id, previous_hash, coinbase1, coinbase2, branches, block_version, nbit, ntime, clean]
        }, true, 'notify');
      },
      /**
       * Set the difficulty
       *
       * @param {Number} id
       * @param {Number} value
       * @returns {Q.promise}
       */
      set_difficulty  : function (id, value){
        var ret;
        if ((ret = classes.Server.invalidArgs(false, 'set_difficulty', 1, arguments)) !== true){
          return ret;
        }

        return this.stratumSend({
          id    : null,
          method: 'mining.set_difficulty',
          params: [value]
        }, true, 'set_difficulty');
      }
    },
    errors            : {
      'FEE_REQUIRED'       : [-10, 'Fee required', null],
      'SERVICE_NOT_FOUND'  : [-2, 'Service not found', null],
      'METHOD_NOT_FOUND'   : [-3, 'Method not found', null],
      'UNKNOWN'            : [-20, 'Unknown error', null],
      'STALE_WORK'         : [-21, 'Stale work', null],
      'DUPLICATE_SHARE'    : [-22, 'Duplicate share', null],
      'HIGH_HASH'          : [-23, 'Low difficulty share', null],
      'UNAUTHORIZED_WORKER': [-24, 'Unauthorized worker', null],
      'NOT_SUBSCRIBED'     : [-25, 'Not subscribed', null]
    },

    defaults          : {
      /**
       * RPC to listen interface for this server
       */
      rpc     : {
        /**
         * Bind to address
         *
         * @type {String}
         */
        host: 'localhost',
        /**
         * RPC port
         *
         * @type {Number}
         */
        port: 1337,
        /**
         * RPC password, this needs to be a SHA256 hash, defaults to 'password'
         * To create a hash out of your password, launch node.js and write
         *
         * require('crypto').createHash('sha256').update('password').digest('hex');
         *
         * @type {String}
         */
        password: '5e884898da28047151d0e56f8dc6292773603d0d6aabbdd62a11ef721d1542d8',
        /**
         * Mode to listen. By default listen only on TCP, but you may use 'http' or 'both' (deal
         * with HTTP and TCP at same time)
         */
        mode: 'tcp'
      },
      /**
       * The server settings itself
       */
      settings: {
        /**
         * Address to set the X-Stratum header if someone connects using HTTP
         * @type {String}
         */
        hostname: 'localhost',
        /**
         * Max server lag before considering the server "too busy" and drop new connections
         * @type {Number}
         */
        toobusy : 70,
        /**
         * Bind to address, use 0.0.0.0 for external access
         * @type {string}
         */
        host    : 'localhost',
        /**
         * Port for the stratum TCP server to listen on
         * @type {Number}
         */
        port    : 3333
      }
    }
  });

  Server.commands.notify.broadcast = true;
  Server.commands.set_difficulty.broadcast = true;
  Server.commands.error.serverOnly = true;

  return Server;
};
