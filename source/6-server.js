

/**
* An object which handles requests for a server, executing default and
* overridden behaviors as instructed by the code which uses and manipulates it.
* Default behavior includes the paths / and /trace (diagnostics), with some
* support for HTTP error pages for various codes and fallback to HTTP 500 if
* those codes fail for any reason.
*
* @class
*
* @param server : nsHttpServer
*   the server in which this handler is being used
*/
function ServerHandler(server)
{
  // FIELDS

  /**
  * The nsHttpServer instance associated with this handler.
  */
  this._server = server;

  /**
  * Custom request handlers for the server in which this resides.  Path-handler
  * pairs are stored as property-value pairs in this property.
  *
  */
  this._overridePaths = {};

  /**
  * Custom request handlers for the path prefixes on the server in which this
  * resides.  Path-handler pairs are stored as property-value pairs in this
  * property.
  *
  */
  this._overridePrefixes = {};

  /**
  * Custom request handlers for the error handlers in the server in which this
  * resides.  Path-handler pairs are stored as property-value pairs in this
  * property.
  *
  * @see ServerHandler.prototype._defaultErrors
  */
  this._overrideErrors = {};

}
ServerHandler.prototype =
{
  // PUBLIC API

  /**
  * Handles a request to this server, responding to the request appropriately
  * and initiating server shutdown if necessary.
  *
  * This method never throws an exception.
  *
  * @param connection : Connection
  *   the connection for this request
  */
  handleResponse: function SHhandleResponse(connection)
  {
    dblog('[' + 'handleResponse' + '] ' +'Start');
    var request = connection.request;
    dblog('[' + 'handleResponse' + '] ' +
        'request:'+JSON.stringify(request));
    dblog_principal('rq: ' + request.originalURL);


    var response = new Response(connection);
    dblog('[' + 'handleResponse' + '] ' +'response'+response);

    var path = request.path;
    dumpn('*** path == ' + path);

   dblog('[' + 'handleResponse' + '] ' +'try...');

    try
    {
      try
      {
        if (path in this._overridePaths)
        {
          // explicit paths first, then files based on existing directory
          // mappings, then (if the file doesn't exist) built-in server
          // default paths
          dumpn('calling override for ' + path);
          dblog('[' + 'handleResponse' + '] ' +'path found in _overrides');
          var respHandler = this;
          this._overridePaths[path](request, response,
            function(e) {
              dblog('[' + 'handleResponse' + '] ' +
              '_overridePaths complete start');
              if (e instanceof HttpError) {
                response = new Response(connection);
                if (e.customErrorHandling)
                {
                  e.customErrorHandling(response);
                }
                var eCode = e.code;
                respHandler._handleError(eCode, request, response);
                dumpSysTime(
                  'Error Response(' + eCode +'),');
              }
              else {
                response.complete();
                dumpSysTime('Response, ' + request.path);
              }
            }
          );
        }
        else
        {
          dblog('[' + 'handleResponse' + '] ' +
              'else(path not found in _overrides)');

          var longestPrefix = '';
          for (var prefix in this._overridePrefixes)
          {
            if (prefix.length > longestPrefix.length &&
              path.substr(0, prefix.length) == prefix)
              {
                longestPrefix = prefix;
              }
          }

          if (longestPrefix.length > 0)
          {
            var handler = this;

            dblog('[' + 'handleResponse' + '] ' +
                  'longestPrefix =' + longestPrefix);
            dumpn('calling prefix override for ' + longestPrefix);
            this._overridePrefixes[longestPrefix](request,
                                                  response,
                                                  function(e){
              if (e instanceof HttpError)
              {
                response = new Response(connection);

                if (e.customErrorHandling)
                {
                  e.customErrorHandling(response);
                }
                var eCode = e.code;
                handler._handleError(eCode, request, response);
                dumpSysTime('Error Response(' + eCode +
                            '),' + request.path);
              }
              else
              {
                response.complete();
                dumpSysTime('Response, ' + request.path);
              }
            });
          }
          else
          {
            dblog('[' + 'handleResponse' + '] ' +
                'non match prefix => 403');
            throw HTTP_403;
          }
        }
      }
      catch (e)
      {
        if (!(e instanceof HttpError))
        {
          dblog_error('500 ' + e);
          dumpn('*** unexpected error: e == ' + e);
          throw HTTP_500;
        }
        if (e.code !== 404)
        {
          dblog('[' + 'handleResponse' + '] ' +'404');
          throw e;
        }

        throw HTTP_404;
      }
    }
    catch (e)
    {
      var errorCode = 'internal';

      try
      {
        if (!(e instanceof HttpError))
        {
          throw e;
        }

        errorCode = e.code;
        dumpn('*** errorCode == ' + errorCode);

        response = new Response(connection);
        if (e.customErrorHandling)
        {
          e.customErrorHandling(response);
        }
        this._handleError(errorCode, request, response);
        return;
      }
      catch (e2)
      {
        dumpn('*** error handling ' + errorCode + ' error: ' +
        'e2 == ' + e2 + ', shutting down server');

      connection.server._requestQuit();
      response.abort(e2);
      return;
      }
    }
    dblog('[' + 'handleResponse' + '] ' +'End: handleResponse');
  },

  //
  // see nsIHttpServer.registerPathHandler
  //
  registerPathHandler: function registerPathHandler(path, handler)
  {
    // XXX true path validation!
    if (path.charAt(0) != '/')
    {
      throw 'Cr.8888 NS_ERROR_INVALID_ARG';
    }

    dblog('[' + 'registerPathHandler' + '] ' +'call _handlerToField');
    this._handlerToField(handler, this._overridePaths, path);
  },

  //
  // see nsIHttpServer.registerPrefixHandler
  //
  registerPrefixHandler: function(path, handler)
  {
    // XXX true path validation!
    if (path.charAt(0) != '/' || path.charAt(path.length - 1) != '/')
    {
      throw 'Cr.9999 NS_ERROR_INVALID_ARG need a slash at the end of the path';
    }

    this._handlerToField(handler, this._overridePrefixes, path);
  },

  //
  // see nsIHttpServer.registerAppDirectory
  //
  registerAppDirectory: function(path, dir)
  {
    dir = (dir[dir.length - 1] == '/') ? dir : dir + '/';

    var readFile =  function(fpath, successCb, errorCb)
    {
      var xhr = new XMLHttpRequest();
      xhr.open('GET', fpath, true);
      xhr.responseType = 'blob';

      xhr.onreadystatechange = function()
      {
        if (xhr.readyState == 4)
        {
          if (xhr.status == 200)
          {
            dblog('registerAppDirectory readFile successCb');
            
            var installDateTime;
            var request = window.navigator.mozApps.getSelf();
            request.onsuccess = function()
            {
              if (request.result)
              {
                installDateTime = request.result.installTime;
                successCb(xhr.response, installDateTime);
              }
              else
              {
                errorCb(HTTP_404);
              }
            };
            request.onerror = function()
            {
              errorCb(HTTP_404);
            };
            
          }
          else
          {
            errorCb(HTTP_404);
          }
        }
      };
      try
      {
        xhr.send(null);
      }
      catch (e)
      {
        dblog('[' + 'registerAppDirectory' + '] ' +
            'Could not access the file:' + fpath);
        errorCb(HTTP_404);
      }
    };
    this.registerPrefixHandler(path,
                               writeFileResponseFactory(path, dir, readFile));
  },

  //
  // see nsIHttpServer.registerSdcardDirectory
  //
  registerSdcardDirectory: function registerSdCardDirecotry(path, dir)
  {
    dir = (dir[dir.length - 1] == '/') ? dir : dir + '/';

    var readFile = function(fpath, successCb, errorCb)
    {
      var storage = window.navigator.getDeviceStorage('sdcard');

      if (!storage)
      {
        dblog('[' + 'registerSdcardDirectory' + '] ' +'No storage available!');
        errorCb(HTTP_500);
        return;
      }

      var obj = storage.get(fpath);
      obj.onsuccess = function()
      {
        var file = obj.result;
        dblog('Get the file name: ' + file.name);
        dblog('Get the file lastModifiedDate: ' + file.lastModifiedDate);
        var dateTime = file.lastModifiedDate.getTime();
        dblog('Get the file lastModifiedDate getTime: ' +
             file.lastModifiedDate);
        successCb(file, dateTime);
      };
      obj.onerror = function objectOnerror(e)
      {
        dblog('[' + 'registerSdcardDirectory' + '] ' +
            'Could not access the file:' + fpath);
        dblog('[' + 'registerSdcardDirectory' + '] ' +
            'Error description:' + e.target.error.name);
        errorCb(HTTP_404);
      };
    };
    this.registerPrefixHandler(path,
                               writeFileResponseFactory(path, dir, readFile));
  },

  // PRIVATE API

  /**
  * Sets or remove (if handler is null) a handler in an object with a key.
  *
  * @param handler
  *   a handler, either function or an nsIHttpRequestHandler
  * @param dict
  *   The object to attach the handler to.
  * @param key
  *   The field name of the handler.
  */
  _handlerToField: function _handlerToField(handler, dict, key)
  {
    // for convenience, handler can be a function if this is run from xpcshell
    if (typeof(handler) == 'function')
    {
      dict[key] = handler;
      dblog('[' + '_handlerToField' + '] ' + key +
          '=> a handler <' + handler.name +'>');
    }
    else if (handler)
    {
      dict[key] = utils.createHandlerFunc(handler);
      dblog('[' + '_handlerToField' + '] ' + key +
          '=> createHanlder: handler<' + handler.name + '>');
    }
    else
    {
      delete dict[key];
      dblog('[' + '_handlerToField' + '] ' + 'delete for key: ' + key);
    }
  },

  /**
  * Writes the error page for the given HTTP error code over the given
  * connection.
  *
  * @param errorCode : uint
  *   the HTTP error code to be used
  * @param connection : Connection
  *   the connection on which the error occurred
  */
  handleError: function(errorCode, connection)
  {
    var response = new Response(connection);

    dumpn('*** error in request: ' + errorCode);

    this._handleError(errorCode, new Request(connection.port), response);
  },

  /**
  * Handles a request which generates the given error code, using the
  * user-defined error handler if one has been set, gracefully falling back to
  * the x00 status code if the code has no handler, and failing to status code
  * 500 if all else fails.
  *
  * @param errorCode : uint
  *   the HTTP error which is to be returned
  * @param metadata : Request
  *   metadata for the request, which will often be incomplete since this is an
  *   error
  * @param response : Response
  *   an uninitialized Response should be initialized when this method
  *   completes with information which represents the desired error code in the
  *   ideal case or a fallback code in abnormal circumstances (i.e., 500 is a
  *   fallback for 505, per HTTP specs)
  */
  _handleError: function(errorCode, metadata, response)
  {
    if (!metadata)
    {
      throw 'Cr.NS_ERROR_NULL_POINTER';
    }

    var errorX00 = errorCode - (errorCode % 100);

    try
    {
      if (!(errorCode in HTTP_ERROR_CODES))
      {
        dumpn('*** WARNING: requested invalid error: ' + errorCode);
      }

      // RFC 2616 says that we should try to handle an error by its class if we
      // can't otherwise handle it -- if that fails, we revert to handling it as
      // a 500 internal server error, and if that fails we throw and shut down
      // the server

      // actually handle the error
      try
      {
        if (errorCode in this._overrideErrors)
        {
          this._overrideErrors[errorCode](metadata, response);
        }
        else
        {
          this._defaultErrors[errorCode](metadata, response);
        }
      }
      catch (e)
      {
        // don't retry the handler that threw
        if (errorX00 == errorCode)
        {
          throw HTTP_500;
        }

        dumpn('*** error in handling for error code ' + errorCode + ', ' +
        'falling back to ' + errorX00 + '...');
        response = new Response(response._connection);
        if (errorX00 in this._overrideErrors)
        {
          this._overrideErrors[errorX00](metadata, response);
        }
        else if (errorX00 in this._defaultErrors)
        {
          this._defaultErrors[errorX00](metadata, response);
        }
        else
        {
          throw HTTP_500;
        }
      }
    }
    catch (e)
    {
      // we've tried everything possible for a meaningful error -- now try 500
      dumpn('*** error in handling for error code ' + errorX00 + ', falling ' +
      'back to 500...');

      try
      {
        response = new Response(response._connection);
        if (500 in this._overrideErrors)
        {
          this._overrideErrors[500](metadata, response);
        }
        else
        {
          this._defaultErrors[500](metadata, response);
        }
      }
      catch (e2)
      {
        dumpn('*** multiple errors in default error handlers!');
        dumpn('*** e == ' + e + ', e2 == ' + e2);
        response.abort(e2);
        return;
      }
    }

    response.complete();
  },

  // FIELDS

  /**
  * This object contains the default handlers for the various HTTP error codes.
  */
  _defaultErrors:
  {
    400: function(metadata, response)
    {
      // none of the data in metadata is reliable, so hard-code everything here
      response.setStatusLine('1.1', 400, 'Bad Request');
      response.setHeader('Content-Type', 'text/plain', false);

      var body = 'Bad request\n';
      response.bodyOutputStream.write(body, body.length);
    },
    403: function(metadata, response)
    {
      response.setStatusLine(metadata.httpVersion, 403, 'Forbidden');
      response.setHeader('Content-Type', 'text/html', false);

      var body = '<html>\
        <head><title>403 Forbidden</title></head>\
        <body>\
        <h1>403 Forbidden</h1>\
        </body>\
        </html>';
      response.bodyOutputStream.write(body, body.length);
    },
    404: function(metadata, response)
    {
      response.setStatusLine(metadata.httpVersion, 404, 'Not Found');
      response.setHeader('Content-Type', 'text/html', false);

      var body = '<html>\
        <head><title>404 Not Found</title></head>\
        <body>\
        <h1>404 Not Found</h1>\
        <p>\
        <span style="font-family: monospace;">' +
        utils.htmlEscape(metadata.path) +
        '</span> was not found.\
        </p>\
        </body>\
        </html>';
      response.bodyOutputStream.write(body, body.length);
    },
    416: function(metadata, response)
    {
      response.setStatusLine(metadata.httpVersion,
        416,
      'Requested Range Not Satisfiable');
      response.setHeader('Content-Type', 'text/html', false);

      var body = '<html>\
        <head>\
        <title>416 Requested Range Not Satisfiable</title></head>\
        <body>\
        <h1>416 Requested Range Not Satisfiable</h1>\
        <p>The byte range was not valid for the\
        requested resource.\
        </p>\
        </body>\
        </html>';
      response.bodyOutputStream.write(body, body.length);
    },
    500: function(metadata, response)
    {
      response.setStatusLine(metadata.httpVersion,
        500,
      'Internal Server Error');
      response.setHeader('Content-Type', 'text/html', false);

      var body = '<html>\
        <head><title>500 Internal Server Error</title></head>\
        <body>\
        <h1>500 Internal Server Error</h1>\
        <p>Something\'s broken in this server and\
        needs to be fixed.</p>\
        </body>\
        </html>';
      response.bodyOutputStream.write(body, body.length);
    },
    501: function(metadata, response)
    {
      response.setStatusLine(metadata.httpVersion, 501, 'Not Implemented');
      response.setHeader('Content-Type', 'text/html', false);

      var body = '<html>\
        <head><title>501 Not Implemented</title></head>\
        <body>\
        <h1>501 Not Implemented</h1>\
        <p>This server is not (yet) Apache.</p>\
        </body>\
        </html>';
      response.bodyOutputStream.write(body, body.length);
    },
    505: function(metadata, response)
    {
      response.setStatusLine('1.1', 505, 'HTTP Version Not Supported');
      response.setHeader('Content-Type', 'text/html', false);

      var body = '<html>\
        <head><title>505 HTTP Version Not Supported</title></head>\
        <body>\
        <h1>505 HTTP Version Not Supported</h1>\
        <p>This server only supports HTTP/1.0 and HTTP/1.1\
        connections.</p>\
        </body>\
        </html>';
      response.bodyOutputStream.write(body, body.length);
    }
  }
};


