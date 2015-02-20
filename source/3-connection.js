/**
 * @class
 */
function MyConnection(server, port, tcpsocket)
{
  this.server = server;
  this.port = port;
  this._tcpsocket = tcpsocket;
}

MyConnection.prototype =
{
  /** Closes this connection's input/output streams. */
  close: function()
  {
    dumpn('*** closing connection ' +
    ' on port ' + this._outgoingPort);

    this._closed = true;

    var server = this.server;
    server._connectionClosed(this);

    // If an error triggered a server shutdown, act on it now
    if (server._doQuit)
    {
      server.stop(
        function() { /* not like we can do anything better */ }
      );
    }
    this._tcpsocket.close();
  },

  /**
  * Initiates processing of this connection, using the data in the given
  * request.
  *
  * @param request : Request
  *   the request which should be processed
  */
  process: function(request)
  {
    NS_ASSERT(!this._closed && !this._processed);

    this._processed = true;

    this.request = request;
    this.server._handler.handleResponse(this);
  },

  /**
  * Initiates processing of this connection, generating a response with the
  * given HTTP error code.
  *
  * @param code : uint
  *   an HTTP code, so in the range [0, 1000)
  * @param request : Request
  *   incomplete data about the incoming request (since there were errors
  *   during its processing
  */
  processError: function(code, request)
  {
    NS_ASSERT(!this._closed && !this._processed);

    this._processed = true;
    this.request = request;
    this.server._handler.handleError(code, this);
  },

  /** Converts this to a string for debugging purposes. */
  toString: function()
  {
    return '<Connection(' +
      (this.request ? ', ' + this.request.path : '') +'): ' +
      (this._closed ? 'closed' : 'open') + '>';
  }
};


