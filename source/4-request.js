
/** Request reader processing states; see RequestReader for details. */
const READER_IN_REQUEST_LINE = 0;
const READER_IN_HEADERS      = 1;
const READER_IN_BODY         = 2;
const READER_FINISHED        = 3;


/**
* Reads incoming request data asynchronously, does any necessary preprocessing,
* and forwards it to the request handler.  Processing occurs in three states:
*
*   READER_IN_REQUEST_LINE     Reading the request's status line
*   READER_IN_HEADERS          Reading headers in the request
*   READER_IN_BODY             Reading the body of the request
*   READER_FINISHED            Entire request has been read and processed
*
* During the first two stages, initial metadata about the request is gathered
* into a Request object.  Once the status line and headers have been processed,
* we start processing the body of the request into the Request.  Finally, when
* the entire body has been read, we create a Response and hand it off to the
* ServerHandler to be given to the appropriate request handler.
*
* @class
*
* @param connection : Connection
*   the connection for the request being read
*/
function RequestReader(connection)
{
  /** Connection metadata for this request. */
  this._connection = connection;

  /**
  * A container providing line-by-line access to the raw bytes that make up the
  * data which has been read from the connection but has not yet been acted
  * upon (by passing it to the request handler or by extracting request
  * metadata from it).
  */
  this._data = new LineData();

  /**
  * The amount of data remaining to be read from the body of this request.
  * After all headers in the request have been read this is the value in the
  * Content-Length header, but as the body is read its value decreases to zero.
  */
  this._contentLength = 0;

  /** The current state of parsing the incoming request. */
  this._state = READER_IN_REQUEST_LINE;

  /** Metadata constructed from the incoming request for the request handler */
  this._metadata = new Request(connection.port);

  /**
  * Used to preserve state if we run out of line data midway through a
  * multi-line header.  _lastHeaderName stores the name of the header, while
  * _lastHeaderValue stores the value we've seen so far for the header.
  *
  * These fields are always either both undefined or both strings.
  */
  this._lastHeaderName = this._lastHeaderValue = undefined;
}

RequestReader.prototype =
{
  // NSIINPUTSTREAMCALLBACK

  /**
  * Called when more data from the incoming request is available.  This method
  * then reads the available data from input and deals with that data as
  * necessary, depending upon the syntax of already-downloaded data.
  *
  * @param input : nsIAsyncInputStream
  *   the stream of incoming data from the connection
  */
  _onInputStreamReady: function _onInputStreamReady()
  {
    dblog('[' + '_onInputStreamReady' + '] ' +'Start');
    var data = this._data;
    if (!data)
    {
      return;
    }
    dblog('[' + '_onInputStreamReady' + '] ' +
          'switch by state: ' + this._state);
    switch (this._state)
    {
      default:
        dblog('[' + '_onInputStreamReady' + '] ' +'invalid state');
        break;

      case READER_IN_REQUEST_LINE:
        if (!this._processRequestLine())
        {
          break;
        }
        if (!this._processHeaders())
        {
          break;
        }
        this._processBody();
        break;

      case READER_IN_HEADERS:
        if (!this._processHeaders())
        {
          break;
        }
        this._processBody();
        break;

      case READER_IN_BODY:
        this._processBody();
        break;
    }
    dblog('[' + '_onInputStreamReady' + '] ' +'done(switch by state)');
  },

  _onData: function _onData(tcpsock)
  {
    var that = this;

    tcpsock.ondata = function tcpsockondata(evt)
    {
      dblog('[' + '_onData' + '] ' +'received ' + evt.data.byteLength +
      ' bytes data');
      //dblog('[' + '_onData' + '] ' +'evt: ' + JSON.stringify(evt));

      that._data.appendBytes(new Uint8Array(evt.data));
      that._onInputStreamReady();
    };
  },

  // PRIVATE API

  /**
  * Processes unprocessed, downloaded data as a request line.
  *
  * @returns boolean
  *   true iff the request line has been fully processed
  */
  _processRequestLine: function _processRequestLine()
  {
    dblog('[' + '_processRequestLine' + '] ' +'Start');

    // Servers SHOULD ignore any empty line(s) received where a Request-Line
    // is expected (section 4.1).
    var data = this._data;
    var line = {};
    var readSuccess;

    dblog('[' + '_processRequestLine' + '] ' + 'reading lines...');

    while ((readSuccess = data.readLine(line)) && line.value === '')
    {
      dumpn('*** ignoring beginning blank line...');
      dblog('[' + '_processRequestLine' + '] ' + readSuccess);
    }
    dblog('[' + '_processRequestLine' + '] ' +'done');

    // if we don't have a full line, wait until we do:
    if (!readSuccess)
    {
      return false;
    }

    // we have the first non-blank line
    try
    {
      dblog('[' + '_processRequestLine' + '] ' + 'call parseRequestLine');
      this._parseRequestLine(line.value);
      dblog('[' + '_processRequestLine' + '] ' +
            'return from _parseRequestLine');
      this._state = READER_IN_HEADERS;
      dumpSysTime('Request, ' + this._metadata.path);
      return true;
    }
    catch (e)
    {
      dblog('[' + '_processRequestLine' + '] ' +'catch error' + e);
      this._handleError(e);
      return false;
    }
    dblog('[' + '_processRequestLine' + '] ' +'End');
  },


  /**
  * Processes stored data, assuming it is either at the beginning or in
  * the middle of processing request headers.
  *
  * @returns boolean
  *   true iff header data in the request has been fully processed
  */
  _processHeaders: function _processHeaders()
  {
    // XXX things to fix here:
    //
    // - need to support RFC 2047-encoded non-US-ASCII characters
    dblog('[' + '_processHeaders' + '] ' +'Start');
    try
    {
      dblog('[' + '_processHeaders' + '] ' +'Start: call _parseHeaders...');
      var done = this._parseHeaders();
      dblog('[' + '_processHeaders' + '] ' +'back from_parseHeaders');
      if (done)
      {
        dblog('[' + '_processHeaders' + '] ' +'parseHeaders done');
        var request = this._metadata;

        // XXX this is wrong for requests with transfer-encodings applied to
        //     them, particularly chunked (which by its nature can have no
        //     meaningful Content-Length header)!
        this._contentLength = request.hasHeader('Content-Length') ?
          parseInt(request.getHeader('Content-Length'), 10) : 0;
        dumpn('_processHeaders, Content-length=' + this._contentLength);

        this._state = READER_IN_BODY;
        dblog('[' + '_processHeaders' + '] ' +'done');
      }
      return done;
    }
    catch (e)
    {
      dblog('[' + '_processHeaders' + '] ' +'catch error' + e);
      this._handleError(e);
      return false;
    }
    dblog('[' + '_processHeaders' + '] ' +'End');
  },

  /**
  * Processes stored data, assuming it is either at the beginning or in
  * the middle of processing the request body.
  *
  * @returns boolean
  *   true iff the request body has been fully processed
  */
  _processBody: function _processBody()
  {
    dblog('[' + '_processBody' + '] ' +'Start');
    NS_ASSERT(this._state == READER_IN_BODY);

    // XXX handle chunked transfer-coding request bodies!

    try
    {
      dblog('[' + '_processBody' + '] ' +
            'this._contentLength: '+ this._contentLength);
      if (this._contentLength > 0)
      {
        var data = this._data.purge();
        var count = Math.min(data.length, this._contentLength);
        dumpn('*** loading data=' + data + ' len=' + data.length +
          ' excess=' + (data.length - count));
        dblog('[' + '_processBody' + '] ' +
              '_processBody: writting ' + count + ' bytes');
        dblog('[' + '_processBody' + '] ' +data);
        this._metadata._writeBody(data, count);
        this._contentLength -= count;
        dblog('[' + '_processBody' + '] ' +'_processBody: end writting');
      }

      dumpn('*** remaining body data len=' + this._contentLength);
      if (this._contentLength === 0)
      {
        this._validateRequest();
        this._state = READER_FINISHED;
        this._handleResponse();

        if (DUMP_REQUEST_HEADER)
        {
          this._metadata._dumpHeaders();
        }
        if (DUMP_REQUEST_BODY)
        {
          this._metadata._dumpBody();
        }
        return true;
      }

      return false;
    }
    catch (e)
    {
      this._handleError(e);
      return false;
    }
    dblog('[' + '_processBody' + '] ' +'End');
  },

  /**
  * Does various post-header checks on the data in this request.
  *
  * @throws : HttpError
  *   if the request was malformed in some way
  */
  _validateRequest: function _validateRequest()
  {
    dblog('[' + '_validateRequest' + '] ' +'Start');
    NS_ASSERT(this._state == READER_IN_BODY);

    dumpn('*** _validateRequest');
    var metadata = this._metadata;
    var headers = metadata._headers;
    var identity = this._connection.server.identity;
    if (metadata._httpVersion.atLeast(HttpVersion.HTTP_1_1))
    {
      dblog('[' + '_validateRequest' + '] ' +'In: if httpVersion check');

      if (!headers.hasHeader('Host'))
      {
        dblog('[' + '_validateRequest' + '] ' +
              'malformed HTTP/1.1 or grater');
        dumpn('*** malformed HTTP/1.1 or greater request with no Host header!');
        throw HTTP_400;
      }

      // If the Request-URI wasn't absolute, then we need to determine our host.
      // We have to determine what scheme was used to access us based on the
      // server identity data at this point, because the request just doesn't
      // contain enough data on its own to do this, sadly.
      if (!metadata._host)
      {
        dblog('[' + '_validateRequest' + '] ' +'no host info');
        var host, port;
        var hostPort = headers.getHeader('Host');
        var colon = hostPort.indexOf(':');
        dblog('[' + '_validateRequest' + '] ' +'colon: '+colon);
        if (colon < 0)
        {
          host = hostPort;
          port = '';
        }
        else
        {
          host = hostPort.substring(0, colon);
          port = hostPort.substring(colon + 1);
        }

        // NB: We allow an empty port here because, oddly, a colon may be
        //     present even without a port number, e.g. 'example.com:'; in this
        //     case the default port applies.
        if (!HOST_REGEX.test(host) || !/^\d*$/.test(port))
        {
          dblog('[' +  '_validateRequest' + '] ' +'port check failed');
          dumpn('*** malformed hostname (' + hostPort + ') in Host ' +
                'header, 400 time');
          throw HTTP_400;
        }

        // If we're not given a port, we're stuck, because we don't know what
        // scheme to use to look up the correct port here, in general.  Since
        // the HTTPS case requires a tunnel/proxy and thus requires that the
        // requested URI be absolute (and thus contain the necessary
        // information), let's assume HTTP will prevail and use that.
        port = +port || 80;
        dblog('[' + '_validateRequest' + '] ' +'getting scheme...');
        var scheme = identity.getScheme(host, port) ||
                     identity.getScheme('localhost', port);
        if (!scheme)
        {
          dblog('[' + '_validateRequest' + '] ' +'fail to detect scheme');
          dumpn('*** unrecognized hostname (' + hostPort + ') in Host ' +
                'header, 400 time');
          throw HTTP_400;
        }

        metadata._scheme = scheme;
        metadata._host = host;
        metadata._port = port;
      }
    }
    else
    {
      dblog('[' + '_validateRequest' + '] ' +'In: else');
      NS_ASSERT(metadata._host === undefined,
        'HTTP/1.0 doesn\'t allow absolute paths in the request line!');
      dblog('[' + '_validateRequest' + '] ' +'Start: metadata.***');
      metadata._scheme = identity.primaryScheme;
      metadata._host = identity.primaryHost;
      metadata._port = identity.primaryPort;
    }

    NS_ASSERT(identity.has(metadata._scheme, metadata._host, metadata._port),
    'must have a location we recognize by now!');
    dblog('[' + '_validateRequest' + '] ' +'End');
  },

  /**
  * Handles responses in case of error, either in the server or in the request.
  *
  * @param e
  *   the specific error encountered, which is an HttpError in the case where
  *   the request is in some way invalid or cannot be fulfilled; if this isn't
  *   an HttpError we're going to be paranoid and shut down, because that
  *   shouldn't happen, ever
  */
  _handleError: function rr_handleError(e)
  {
    dblog('[' + 'rr_handleError' + '] ' +'start');
    
    // Don't fall back into normal processing!
    this._state = READER_FINISHED;

    var server = this._connection.server;
    var code;
    if (e instanceof HttpError)
    {
      code = e.code;
    }
    else
    {
      dumpn('!!! UNEXPECTED ERROR: ' + e +
        (e.lineNumber ? ', line ' + e.lineNumber : ''));

      // no idea what happened -- be paranoid and shut down
      code = 500;
      server._requestQuit();
    }

    // make attempted reuse of data an error
    this._data = null;
    dblog('[' + 'rr_handleError' + '] ' +'call _connection processError');
    this._connection.processError(code, this._metadata);
  },

  /**
  * Now that we've read the request line and headers, we can actually hand off
  * the request to be handled.
  *
  * This method is called once per request, after the request line and all
  * headers and the body, if any, have been received.
  */
  _handleResponse: function _handleResponse()
  {
    dblog('[' + '_handleResponse' + '] ' +'Start');
    dblog('[' + '_handleResponse' + '] ' +'check state: ' +
        (this._state == READER_FINISHED));
    NS_ASSERT(this._state == READER_FINISHED);

    // We don't need the line-based data any more, so make attempted reuse an
    // error.
    this._data = null;
    dblog('[' + '_handleResponse' + '] ' +'calling _connection.process..');
    this._connection.process(this._metadata);
    dblog('[' + '_handleResponse' + '] ' +'End');
  },


  // PARSING

  /**
  * Parses the request line for the HTTP request associated with this.
  *
  * @param line : string
  *   the request line
  */
  _parseRequestLine: function _parseRequestLine(line)
  {
    dblog('[' + '_parseRequestLine' + '] ' +'Start');
    dumpn('*** _parseRequestLine(\'' + line + '\')');

    var metadata = this._metadata;

    // clients and servers SHOULD accept any amount of SP or HT characters
    // between fields, even though only a single SP is required (section 19.3)
    var request = line.split(/[ \t]+/);
    dblog('[' + '_parseRequestLine' + '] ' +'check request line...');
    if (!request || request.length != 3)
    {
      dumpn('*** No request in line');
      throw HTTP_400;
    }
    dblog('[' + '_parseRequestLine' + '] ' +'done');
    metadata._method = request[0];

    // get the HTTP version
    var ver = request[2];
    var match = ver.match(/^HTTP\/(\d+\.\d+)$/);
    dblog('[' + '_parseRequestLine' + '] ' +'check http version...');
    if (!match)
    {
      dumpn('*** No HTTP version in line');
      throw HTTP_400;
    }
    dblog('[' + '_parseRequestLine' + '] ' +'done');
    // determine HTTP version
    try
    {
      dblog('[' + '_parseRequestLine' + '] ' +'creating HttpVersion...');
      metadata._httpVersion = new HttpVersion(match[1]);
      dblog('[' + '_parseRequestLine' + '] ' +'done');
      if (!metadata._httpVersion.atLeast(HttpVersion.HTTP_1_0))
      {
        throw 'unsupported HTTP version';
      }
      dblog('[' + '_parseRequestLine' + '] ' +'ok. supported version');
    }
    catch (e)
    {
      // we support HTTP/1.0 and HTTP/1.1 only
      dblog('[' + '_parseRequestLine' + '] ' +'error: ' + e);
      throw HTTP_501;
    }


    var fullPath = request[1];

    var scheme, host, port;
    dblog('[' + '_parseRequestLine' + '] ' +'check path...');
    if (fullPath.charAt(0) != '/')
    {
      dblog('[' + '_parseRequestLine' + '] ' +'path does not start with /');
      dblog('[' + '_parseRequestLine' + '] ' +'check http version...');
      // No absolute paths in the request line in HTTP prior to 1.1
      if (!metadata._httpVersion.atLeast(HttpVersion.HTTP_1_1))
      {
        dumpn('*** Metadata version too low');
        throw HTTP_400;
      }
      dblog('[' + '_parseRequestLine' + '] ' +'done');
    }
    dblog('[' + '_parseRequestLine' + '] ' +'done(check path');

    var splitter = fullPath.indexOf('?');
    if (splitter < 0)
    {
      // _queryString already set in ctor
      metadata._path = fullPath;
    }
    else
    {
      metadata._path = fullPath.substring(0, splitter);
      metadata._queryString = fullPath.substring(splitter + 1);
    }
    dblog('[' + '_parseRequestLine' + '] ' +'metadata._path:', metadata._path);

    metadata._scheme = scheme;
    metadata._host = host;
    metadata._port = port;

  },

  /**
  * Parses all available HTTP headers in this until the header-ending CRLFCRLF,
  * adding them to the store of headers in the request.
  *
  * @throws
  *   HTTP_400 if the headers are malformed
  * @returns boolean
  *   true if all headers have now been processed, false otherwise
  */
  _parseHeaders: function _parseHeaders()
  {
    dblog('[' + '_parseHeaders' + '] ' +'Start');
    NS_ASSERT(this._state == READER_IN_HEADERS);

    dumpn('*** _parseHeaders');

    var data = this._data;

    var headers = this._metadata._headers;
    var lastName = this._lastHeaderName;
    var lastVal = this._lastHeaderValue;
    var line = {};
    while (true)
    {
      dblog('[' + '_parseHeaders' + '] ' +'lastName:'+lastName);
      dblog('[' + '_parseHeaders' + '] ' +'lastVal:'+lastVal);
      dumpn('*** Last name: \'' + lastName + '\'');
      dumpn('*** Last val: \'' + lastVal + '\'');
      NS_ASSERT(!((lastVal === undefined) ^ (lastName === undefined)),
        lastName === undefined ?
        'lastVal without lastName?  lastVal: \'' + lastVal + '\'' :
        'lastName without lastVal?  lastName: \'' + lastName + '\'');

      if (!data.readLine(line))
      {
        dblog('[' + '_parseHeaders' + '] ' +'In :!data.readLine');
        // save any data we have from the header we might still be processing
        this._lastHeaderName = lastName;
        this._lastHeaderValue = lastVal;
        return false;
      }

      var lineText = line.value;
      dblog('[' + '_parseHeaders' + '] ' +'Req:' + lineText);
      dumpn('*** Line text: \'' + lineText + '\'');
      var firstChar = lineText.charAt(0);
      
      // blank line means end of headers
      if (lineText === '')
      {
        dblog('[' + '_parseHeaders' + '] ' +'lineText is empty');
        // we're finished with the previous header
        if (lastName)
        {
          try
          {
            headers.setHeader(lastName, lastVal, true);
          }
          catch (e)
          {
            dblog('[' + '_parseHeaders' + '] ' +'error: ' + e);
            dumpn('*** setHeader threw on last header, e == ' + e);
            throw HTTP_400;
          }
        }
        else
        {
          // no headers in request -- valid for HTTP/1.0 requests
        }

        // either way, we're done processing headers
        this._state = READER_IN_BODY;
        return true;
      }
      else if (firstChar == ' ' || firstChar == '\t')
      {
        dblog('[' + '_parseHeaders' + '] ' +
            'firstChar is whitespace or TAB');

        // multi-line header if we've already seen a header line
        if (!lastName)
        {
          dumpn('We don\'t have a header to continue!');
          throw HTTP_400;
        }

        // append this line's text to the value; starts with SP/HT, so no need
        // for separating whitespace
        lastVal += lineText;
      }
      else
      {
        dblog('[' + '_parseHeaders' + '] ' +'else(not blank, not space)');
        dblog('[' + '_parseHeaders' + '] ' +'lastName:'+lastName);

        // we have a new header, so set the old one (if one existed)

        if (lastName)
        {
          headers.setHeader(lastName, lastVal, true);
        }

        var colon = lineText.indexOf(':'); // first colon must be splitter
        if (colon < 1)
        {
          dblog('[' + '_parseHeaders' + '] ' +'no colon found');
          dumpn('*** No colon or missing header field-name');
          throw HTTP_400;
        }

        // set header name, value (to be set in the next loop, usually)
        lastName = lineText.substring(0, colon);
        lastVal = lineText.substring(colon + 1);
        dblog('[' + '_parseHeaders' + '] ' +'2nd lastName:' + lastName);
        dblog('[' + '_parseHeaders' + '] ' +'2nd lastVal:' + lastVal);
      } // empty, continuation, start of header

      dblog('[' + '_parseHeaders' + '] ' +'continute');
    }
    dblog('[' + '_parseHeaders' + '] ' +'End');
  }
};

