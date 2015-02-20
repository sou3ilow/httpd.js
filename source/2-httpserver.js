/**
* Instantiates a new HTTP server.
* @class
*/
function HttpServer()
{
  /** The port on which this server listens.
   * @private
   */
  this._port = undefined;

  /** The host
   * @private
   */
  this._host = undefined;

  /** The socket associated with this.
   * @private
   */
  this._socket = null;

  /** The handler used to process requests to this server. 
   * @private
   */
  this._handler = new ServerHandler(this);

  /** Naming information for this server. 
   * @private
   */
  this._identity = new ServerIdentity();

  /**
  * Indicates when the server is to be shut down at the end of the request.
  * @private
  */
  this._doQuit = false;

  log('[' + 'nsHttpServer' + '] ' + 'Finish Constructor');
}

HttpServer.prototype =
{

  // originally implements:
  // NSISERVERSOCKETLISTENER
  // NSIHTTPSERVER

  /**
   * Processes an incoming request coming in on the given socket and contained
   * in the given transport.
   *
   * @memberof HttpServer
   * @private
   *
   * @param socket : nsIServerSocket
   *   the socket through which the request was served
   * @param trans : nsISocketTransport
   *   the transport for the request/response
   * @see nsIServerSocketListener.onSocketAccepted
   */
  _onSocketAccepted: function()
  {
    var that = this;
    log('[' + '_onSocketAccepted' + '] ' +'Start');
    var onaccept = function onaccept(tcpsock)
    {
      log('[' + 'onconnect' + '] ' +'Start');
      var conn = new MyConnection(that, that._socket.localPort ||
                                  that._socket.port, tcpsock);
      log('[' + 'onconnect' + '] ' +'creating request reader ');
      var reader = new RequestReader(conn);
      log('[' + 'onconnect' + '] ' +'setting _onData(tcpsock)');
      reader._onData(tcpsock);
      log('[' + 'onconnect' + '] ' +'done');
    };

    that._socket.onconnect = onaccept;
    log('[' + '_onSocketAccepted' + '] ' +'End');
  },

  /**
   * Start the server
   * @param {number} 
   */
  start: function(port)
  {
    this._start(port, 'localhost');
  },

  /**
   * @private
   */
  _start: function _start(port, host)
  {
    if (this._socket)
    {
      throw 'Cr.NS_ERROR_ALREADY_INITIALIZED';
    }

    this._port = port;
    this._doQuit = false;
    this._host = host;
    var options = { binaryType: 'arraybuffer' };

    try
    {
      var serversocket = navigator.mozTCPSocket.listen(port, options);

      log('[' + '_start' + '] ' +
          'call _identity._initialize with ' +
          'port = ' + port +
          ', host = ' + host +
          ', True');
      this._identity._initialize(port, host, true);
      log('[' + '_start' + '] ' +'set _socket = ' + serversocket);
      this._socket = serversocket;
      log('[' + '_start' + '] ' +'End');
    }
    catch (e)
    {
      dumpn('!!! could not start server on port ' + port + ': ' + e);
      throw '!!! could not start server on port ' + port + ': ' + e;
    }

    this._onSocketAccepted();
  },

  /**
   * Stop the server
   * @param {function} callback
   */
  stop: function HSstop(callback)
  {
    if (!callback)
    {
      throw 'Cr.NS_ERROR_NULL_POINTER';
    }
    if (!this._socket)
    {
      throw 'Cr.NS_ERROR_UNEXPECTED';
    }
    log('[' + 'HSstop' + '] ' +'Start:');
    this._stopCallback = typeof callback === 'function' ?
      callback : function() { callback.onStopped(); };
    this._socket.close();
    this._socket = null;

    // We can't have this identity any more, and the port on which we're running
    // this server now could be meaningless the next time around.
    log('[' + 'HSstop' + '] ' +'this._identity._teardown()');
    this._identity._teardown();
    this._doQuit = false;
    log('[' + 'HSstop' + '] ' +'done');
    // socket-close notification and pending request completion happen async
  },

  /**
   * Register directory/handler for the sprcified path
   * @memberof HttpServer
   *
   * @param {string} path 
   * @param param if param is a string it is treated as a path of subdirectory.
   *   if param is a function it is recognized as handler.
   */
  get: function(path, param)
  {
	  //param: 'string' or 'function'
	  //       ->Set 'string' is 2nd arg for registerAppDirectory() or
	  //         registerSdcardDirectory().
	  //       ->Set 'function' is 2nd arg for registerPathHandler().

    if (path == null && param == null)
    {
      log('get() parameter error');
      throw 'Cr.7777 NS_ERROR_INVALID_ARG';
    }

    if (typeof param == 'function')
    {
      log('get() registerPathHandler');
      this._handler.registerPathHandler(path, param);
    }
    else if (typeof param == 'string')
    {
      var result = param.indexOf('/sdcard');
      if (result === 0)
      {
        log('get() registerSdcardDirectory');
        this._handler.registerSdcardDirectory(path, param);
      }
      else
      {
        log('get() registerAppDirectory');
        this._handler.registerAppDirectory(path, param);
      }
    }
    else
    {
      log('get() set error data-type');
      throw 'Cr.7777 NS_ERROR_INVALID_ARG';
    }
  },
 
  /**
   * register subdirectry of app
   * @memberof HttpServer
   *
   * @param {string} path
   * @param {string} directory
   */
  registerAppDirectory: function(path, directory)
  {
    this._handler.registerAppDirectory(path, directory);
  },

  /**
   * register subdirectory of sdcard
   * @memberof HttpServer
   *
   * @param {string} path
   * @param {string} directory
   */
  registerSdcardDirectory: function(path, directory)
  {
    this._handler.registerSdcardDirectory(path, directory);
  },

  /**
   * register a hanlder for the path
   * @memberof HttpServer
   *
   * @param {string} path
   * @param {string} hanlder(req, res, omcomplete)
   */
  registerPathHandler: function registerPathHandler(path, handler)
  {
    log('[' + 'registerPathHandler' + '] ' +
        'call _handler.registerPathHandler');
    this._handler.registerPathHandler(path, handler);
  },

  /**  
   *   see nsIHttpServer.registerPrefixHandler
   */
  registerPrefixHandler: function(prefix, handler)
  {
    this._handler.registerPrefixHandler(prefix, handler);
  },

  /**
   * see nsIHttpServer.serverIdentity
   */
  get identity()
  {
    return this._identity;
  },

  /**
   * Calls the server-stopped callback provided when stop() was called.
   * @memberof HttpServer
   * @private
   */
  _notifyStopped: function()
  {
    NS_ASSERT(this._stopCallback !== null, 'double-notifying?');

    //
    // NB: We have to grab this now, null out the member, *then* call the
    //     callback here, or otherwise the callback could (indirectly) futz with
    //     this._stopCallback by starting and immediately stopping this, at
    //     which point we'd be nulling out a field we no longer have a right to
    //     modify.
    //
    var callback = this._stopCallback;
    if (typeof callback !== 'function') {
      log('_stopCallback not set callback');
      return;
    }
    this._stopCallback = null;
    try
    {
      callback();
    }
    catch (e)
    {
      // not throwing because this is specified as being usually (but not
      // always) asynchronous
      dump('!!! error running onStopped callback: ' + e + '\n');
    }
  },

  /**
   * Notifies this server that the given connection has been closed.
   * @memberof HttpServer
   * @private
   * @param connection : Connection
   *   the connection that was closed
   */
  _connectionClosed: function(connection)
  {
    // Fire a pending server-stopped notification if it's our responsibility.
    this._notifyStopped();
  },

  /**
   * Requests that the server be shut down when possible.
   * @memberof HttpServer
   * @private
   */
  _requestQuit: function()
  {
    dumpn('>>> requesting a quit');
    this._doQuit = true;
  }
};

//
// RFC 2396 section 3.2.2:
//
// host        = hostname | IPv4address
// hostname    = *( domainlabel '.' ) toplabel [ '.' ]
// domainlabel = alphanum | alphanum *( alphanum | '-' ) alphanum
// toplabel    = alpha | alpha *( alphanum | '-' ) alphanum
// IPv4address = 1*digit '.' 1*digit '.' 1*digit '.' 1*digit
//

const HOST_REGEX =
new RegExp('^(?:' +
  // *( domainlabel '.' )
'(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\\.)*' +
  // toplabel
'[a-z](?:[a-z0-9-]*[a-z0-9])?' +
  '|' +
  // IPv4 address
'\\d+\\.\\d+\\.\\d+\\.\\d+' +
')$',
'i');


/**
 * Represents the identity of a server.  An identity consists of a set of
 * (scheme, host, port) tuples denoted as locations (allowing a single server to
 * serve multiple sites or to be used behind both HTTP and HTTPS proxies for any
 * host/port).  Any incoming request must be to one of these locations, or it
 * will be rejected with an HTTP 400 error.  One location, denoted as the
 * primary location, is the location assigned in contexts where a location
 * cannot otherwise be endogenously derived, such as for HTTP/1.0 requests.
 *
 * A single identity may contain at most one location per unique host/port pair;
 * other than that, no restrictions are placed upon what locations may
 * constitute an identity.
 * @class
 */
function ServerIdentity()
{
  /**
   * The scheme of the primary location.
   * @memberof ServerIdentity
   * @private
   */
  this._primaryScheme = 'http';

  /** The hostname of the primary location.
   * @memberof ServerIdentity
   * @private
   */
  this._primaryHost = '127.0.0.1';

  /** The port number of the primary location.
   * @memberof ServerIdentity
   * @private
   */
  this._primaryPort = -1;

  /**
   * The current port number for the corresponding server, stored so that a new
   * primary location can always be set if the current one is removed.
   * @memberof ServerIdentity
   * @private
   */
  this._defaultPort = -1;

  /**
   * Maps hosts to maps of ports to schemes, e.g. the following would represent
   * https://example.com:789/ and http://example.org/:
   *
   *   {
   *     'xexample.com': { 789: 'https' },
   *     'xexample.org': { 80: 'http' }
   *   }
   *
   * Note the 'x' prefix on hostnames, which prevents collisions with special
   * JS names like 'prototype'.
   * @memberof ServerIdentity
   * @private
   */
  this._locations = { 'xlocalhost': {} };
}
ServerIdentity.prototype =
{

  // NSIHTTPSERVERIDENTITY
  
  /**
   * see nsIHttpServerIdentity.add
   * @memberof ServerIdentity
   */
  add: function(scheme, host, port)
  {
    this._validate(scheme, host, port);

    var entry = this._locations['x' + host];
    if (!entry)
    {
      this._locations['x' + host] = entry = {};
    }

    entry[port] = scheme;
  },

  /**
   * see nsIHttpServerIdentity.remove
   * @memberof ServerIdentity
   */
  remove: function(scheme, host, port)
  {
    this._validate(scheme, host, port);

    var entry = this._locations['x' + host];
    if (!entry)
    {
      return false;
    }

    var present = port in entry;
    delete entry[port];

    if (this._primaryScheme == scheme &&
      this._primaryHost == host &&
      this._primaryPort == port &&
    this._defaultPort !== -1)
    {
      // Always keep at least one identity in existence at any time, unless
      // we're in the process of shutting down (the last condition above).
      this._primaryPort = -1;
      this._initialize(this._defaultPort, host, false);
    }

    return present;
  },
  /**
   * see nsIHttpServerIdentity.has
   * @memberof ServerIdentity
   */
  has: function(scheme, host, port)
  {
    this._validate(scheme, host, port);

    return 'x' + host in this._locations &&
    scheme === this._locations['x' + host][port];
  },

  /**
   * see nsIHttpServerIdentity.has
   * @memberof ServerIdentity
   */
  getScheme: function getScheme(host, port)
  {
    log('[' + 'registerPathHandler' + '] ' +'Start');

    this._validate('http', host, port);

    log('[' + 'getScheme' + '] ' +'validating done');
    var entry = this._locations['x' + host];

    log('[' + 'getScheme' + '] ' + 'End entry is: ' +
          JSON.stringify(entry));

    if (!entry)
    {
      return '';
    }

    log('[' + 'getScheme' + '] ' +'End: getScheme');

    return entry[port] || '';
  },

  /**
   * see nsIHttpServerIdentity.setPrimary
   * @memberof ServerIdentity
   */
  setPrimary: function(scheme, host, port)
  {
    this._validate(scheme, host, port);

    this.add(scheme, host, port);

    this._primaryScheme = scheme;
    this._primaryHost = host;
    this._primaryPort = port;
  },

  // PRIVATE IMPLEMENTATION

  /**
   * Initializes the primary name for the corresponding server, based on the
   * provided port number.
   */
  _initialize: function _initialize(port, host, addSecondaryDefault)
  {
    log('[' + '_initialize' + '] ' +'Start');

    this._host = host;

    if (this._primaryPort !== -1) {
      log('[' + '_initialize' + '] ' +'this._primaryPort !==-1');
      this.add('http', host, port);
    }
    else {
      log('[' + '_initialize' + '] ' +'else (primaryPort is not -1)');
      this.setPrimary('http', 'localhost', port);
    }

    log('[' + '_initialize' + '] ' +'setting _defaultPort..');
    this._defaultPort = port;
    // Only add this if we're being called at server startup
    if (addSecondaryDefault && host != '127.0.0.1') {
      log('[' + '_initialize' + '] ' +
          'addSecondaryDefault && host != 127.0.0.1');
      this.add('http', '127.0.0.1', port);
    }

    log('[' + '_initialize' + '] ' +'End');
  },

  /**
  * Called at server shutdown time, unsets the primary location only if it was
  * the default-assigned location and removes the default location from the
  * set of locations used.
  */

  _teardown: function()
  {
    if (this._host != '127.0.0.1')
    {
      log('[' + '_teardown' + '] ' +
          'this._host != 127.0.0.1 :' + this._host + ':' + this._defaultPort);
      // Not the default primary location, nothing special to do here
      this.remove('http', '127.0.0.1', this._defaultPort);
    }

    // This is a *very* tricky bit of reasoning here; make absolutely sure the
    // tests for this code pass before you commit changes to it.
    if (this._primaryScheme == 'http' &&
      this._primaryHost == this._host &&
    this._primaryPort == this._defaultPort)
    {
      log('[' + '_teardown' + '] ' +
          'this._primaryScheme, Host, Port:' + this._defaultPort);
      // Make sure we don't trigger the readding logic in .remove(), then remove
      // the default location.
      var port = this._defaultPort;
      this._defaultPort = -1;
      this.remove('http', this._host, port);

      // Ensure a server start triggers the setPrimary() path in ._initialize()
      this._primaryPort = -1;
    }
    else
    {
      log('[' + '_teardown' + '] ' +'else:' + this._defaultPort);
      // No reason not to remove directly as it's not our primary location
      this.remove('http', this._host, this._defaultPort);
    }
  },

  /**
  * Ensures scheme, host, and port are all valid with respect to RFC 2396.
  *
  * @throws NS_ERROR_ILLEGAL_VALUE
  *   if any argument doesn't match the corresponding production
  */
  _validate: function(scheme, host, port)
  {
    if (scheme !== 'http' && scheme !== 'https')
    {
      log('[' + '_validate' + '] ' +'scheme:' + scheme);
      dumpn('*** server only supports http/https schemes: \'' + scheme + '\'');
      throw 'Cr.NS_ERROR_ILLEGAL_VALUE';
    }
    if (!HOST_REGEX.test(host))
    {
      log('[' + '_validate' + '] ' +'!HOST_REGEX.test(host):' + host);
      dumpn('*** unexpected host: \'' + host + '\'');
      throw 'Cr.NS_ERROR_ILLEGAL_VALUE';
    }
    if (port < 0 || port > 65535)
    {
      log('[' + '_validate' + '] ' +'port:' + port);
      dumpn('*** unexpected port: \'' + port + '\'');
      throw 'Cr.NS_ERROR_ILLEGAL_VALUE';
    }
  }
};

