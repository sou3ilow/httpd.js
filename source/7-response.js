
/**
* Represents a response to an HTTP request, encapsulating all details of that
* response.  This includes all headers, the HTTP version, status code and
* explanation, and the entity itself.
*
* @class
*
* @param connection : Connection
*   the connection over which this response is to be written
*/
function Response(connection)
{
  /** The connection over which this response will be written. */
  this._connection = connection;

  /**
  * The HTTP version of this response; defaults to 1.1 if not set by the
  * handler.
  */
  this._httpVersion = HttpVersion.HTTP_1_1;

  /**
  * The HTTP code of this response; defaults to 200.
  */
  this._httpCode = 200;

  /**
  * The description of the HTTP code in this response; defaults to 'OK'.
  */
  this._httpDescription = 'OK';

  /**
  * An nsIHttpHeaders object in which the headers in this response should be
  * stored.  This property is null after the status line and headers have been
  * written to the network, and it may be modified up until it is cleared.
  */
  this._headers = new HttpHeaders();

  /**
  * Set to true when this response is ended (completely constructed if possible
  * and the connection closed); further actions on this will then fail.
  */
  this._ended = false;

  /**
  * A stream used to hold data written to the body of this response.
  */
  this._bodyOutputStream = null;

  /**
  * A stream containing all data that has been written to the body of this
  * response so far.  (Async handlers make the data contained in this
  * unreliable as a way of determining content length in general, but auxiliary
  * saved information can sometimes be used to guarantee reliability.)
  */
  this._bodyInputStream = null;
}

function isUpdateModifiedSince(fileModDateTime, modifiedSinceHeaderVal)
{
  dblog('isUpdateModifiedSince fileModDateTime:' + fileModDateTime);
  
  var reqModSinceDateTime = (new Date(modifiedSinceHeaderVal)).getTime();
  dblog('isUpdateModifiedSince req reqModSinceDateTime:' + reqModSinceDateTime);
  if (reqModSinceDateTime != fileModDateTime)
  {
    dblog('isUpdateModifiedSince return true');
    return true;
  }
  else
  {
    dblog('isUpdateModifiedSince return false');
    return false;
  }
}

Response.prototype =
{
  // PUBLIC CONSTRUCTION API

  writeFileResponse: function(localPath, readFile, req, oncomplete)
  {
    dblog('[writeFileResponse] ' +'Start localPath:' + localPath);
    
    var self = this;
    var fileExt = localPath.split('.').pop();

    self.setHeader('Content-Type', getContentType(fileExt), false);

    readFile(localPath,
      function(fileObj, modDateTime)
      {
        dblog('writeFileResponse modDateTime:' + modDateTime);
//req:If-Modified-Since
        if (req.hasHeader('If-Modified-Since'))
        {
          dblog('If-Modified-Since');
          var modifiedVal;
          modifiedVal = req.getHeader('If-Modified-Since');
          if(!isUpdateModifiedSince(modDateTime, modifiedVal))
          {
              dblog('If-Modified-Since Response Res had not updated');
              self.setStatusLine(req.httpVersion, 304, 'Not Modified');
              self.setHeader('Content-Type', 'text/plain', false);
              oncomplete();
              return;
          }
          else
          {
             dblog('If-Modified-Since Response Res had updated');
          }
        }
//res:Last-Modified
        self.setHeader('Last-Modified', utils.toDateString(modDateTime), false);
//req:If-None-Match
        if (req.hasHeader('If-None-Match'))
        {
          var reqEtag;
          reqEtag = req.getHeader('If-None-Match');
          dblog('If-None-Match reqEtag:' + reqEtag);
          if(reqEtag === String(modDateTime))
          {
              dblog('If-None-Match Response Res had not updated');
              self.setStatusLine(req.httpVersion, 304, 'Not Modified');
              self.setHeader('Content-Type', 'text/plain', false);
              oncomplete();
              return;
          }
          else
          {
             dblog('If-None-Match Response Res had updated');
          }
        }
//res:ETag
        self.setHeader('ETag', String(modDateTime), false);
//req:Range
        var rangeHeader;
        if (req.hasHeader('Range'))
        {
          rangeHeader = req.getHeader('Range');
        }
        else
        {
          rangeHeader = '';
        }
        var f = sliceFile(rangeHeader, fileObj);

        var MAXSIZE = 1 * Math.pow(2, 20);
        if (MAXSIZE < f.size)
        {
          dblog('file size over 1MB!!');
          if (f.ranged)
          {
            self.setStatusLine(req.httpVersion, 206, 'Partial Content');
            var contentRange =
              'bytes ' + f.start + '-' + f.end + '/' + f.size;
            dblog('[' + 'writeFileResponse' + '] ' +
              'content-range=' + contentRange);
            self.setHeader('Content-Range', contentRange);
          }
          self.setHeader('Accept-Ranges', 'bytes', false);
          self.write(f);
          oncomplete();
        }
        else
        {
          var reader = new FileReader();
          reader.onload = function onload(e)
          {
            if (f.ranged)
            {
              self.setStatusLine(req.httpVersion, 206, 'Partial Content');
              var contentRange =
                'bytes ' + f.start + '-' + f.end + '/' + f.size;
              dblog('[' + 'writeFileResponse' + '] ' +
                'content-range=' + contentRange);
              self.setHeader('Content-Range', contentRange);
            }
            self.setHeader('Accept-Ranges', 'bytes', false);
            self.write(reader.result);
            if (f != null)
            {
             f.file = null;
              f = null;
            }
            reader = null;
            oncomplete();
          };
          reader.onerror = function(e)
          {
            if (f != null)
            {
              f.file = null;
              f = null;
            }
            reader = null;
            oncomplete(HTTP_404);
          };
          reader.onabort = function(e)
          {
            if (f != null)
            {
              f.file = null;
              f = null;
            }
            reader = null;
            oncomplete(HTTP_404);
          };
          reader.readAsArrayBuffer(f.file);
        }
      },
      function(e)
      {
        oncomplete(e);
      }
    );
  },
  
  // http://doxygen.db48x.net/mozilla-full/html/df/dc6/interfacensIHttpResponse.html
  
  get bodyOutputStream()
  {
    if (!this._bodyOutputStream)
    {
      this._bodyInputStream =
      this._bodyOutputStream = new StreamWrapper();
    }
    return this._bodyOutputStream;
  },


  write: function(data)
  {
    if (this._end)
    {
      throw 'write(): condition not satisfied';
    }

    // data is 'string' or 'uint8Array'.
    this.bodyOutputStream.write(data);
  },

  send: function() {
 	this.write.apply(this, arguments); // alias
  },

  setStatusLine: function(httpVersion, code, description)
  {
    if (!this._headers || this._end)
    {
      throw 'setStatusLine(): condition not satisfied';
    }

    this._ensureAlive();

    if (!(code >= 0 && code < 1000))
    {
      throw 'setStatusLine(): invalid code';
    }

    var httpVer;
    
    // avoid version construction for the most common cases
    if (!httpVersion || httpVersion == '1.1')
    {
      httpVer = HttpVersion.HTTP_1_1;
    }
    else if (httpVersion == '1.0')
    {
      httpVer = HttpVersion.HTTP_1_0;
    }
    else
    {
      httpVer = new HttpVersion(httpVersion);
    }

    // Reason-Phrase = *<TEXT, excluding CR, LF>
    // TEXT          = <any OCTET except CTLs, but including LWS>
    //
    // XXX this ends up disallowing octets which aren't Unicode, I think -- not
    //     much to do if description is IDL'd as string
    if (!description)
    {
      description = '';
    }
    for (var i = 0; i < description.length; i++)
    {
      if (utils.isCTL(description.charCodeAt(i)) && description.charAt(i) != '\t')
      {
        throw 'setStatusLint(): description include ctrl chars';
      }
    }

    // set the values only after validation to preserve atomicity
    this._httpDescription = description;
    this._httpCode = code;
    this._httpVersion = httpVer;
  },

  setHeader: function setHeader(name, value, merge)
  {
    if (!this._headers || this._end)
    {
      dblog('[' + 'setHeader' + '] ' +'condition not satisfied');
      throw 'setHeader(): condition not satisfied';
    }
    this._ensureAlive();
    this._headers.setHeader(name, value, merge);
    dblog('[' + 'setHeader' + '] ' +name + '=>' + value);
  },

  // POST-CONSTRUCTION API (not exposed externally)

  /**
  * The HTTP version number of this, as a string (e.g. '1.1').
  */
  get httpVersion()
  {
    this._ensureAlive();
    return this._httpVersion.toString();
  },

  /**
  * The HTTP status code of this response, as a string of three characters per
  * RFC 2616.
  */
  get httpCode()
  {
    this._ensureAlive();

    var codeString = (this._httpCode < 10 ? '0' : '') +
      (this._httpCode < 100 ? '0' : '') +
      this._httpCode;
    return codeString;
  },

  /**
  * The description of the HTTP status code of this response, or '' if none is
  * set.
  */
  get httpDescription()
  {
    this._ensureAlive();

    return this._httpDescription;
  },

  /**
  * The headers in this response, as an nsHttpHeaders object.
  */
  get headers()
  {
    this._ensureAlive();

    return this._headers;
  },

  getHeader: function(name)
  {
    this._ensureAlive();

    return this._headers.getHeader(name);
  },

  /**
  * If necessary, kicks off the remaining request processing needed to be done
  * after a request handler performs its initial work upon this response.
  */
  complete: function complete()
  {
    dblog('[' + 'complete' + '] ' +'Start');

    dumpn('*** complete()');

    dblog('[' + 'complete' + '] ' +'calling _startAsyncProcessor');

    this._startAsyncProcessor();
    dblog('[' + 'complete' + '] ' +'done');
    dblog('[' + 'complete' + '] ' +'End');
  },

  /**
  * Abruptly ends processing of this response, usually due to an error in an
  * incoming request but potentially due to a bad error handler.  Since we
  * cannot handle the error in the usual way (giving an HTTP error page in
  * response) because data may already have been sent (or because the response
  * might be expected to have been generated asynchronously or completely from
  * scratch by the handler), we stop processing this response and abruptly
  * close the connection.
  *
  * @param e : Error
  *   the exception which precipitated this abort, or null if no such exception
  *   was generated
  */
  abort: function(e)
  {
    dumpn('*** abort(<' + e + '>)');

    this.end();

  },

  /**
  * Closes this response's network connection, marks the response as finished,
  * and notifies the server handler that the request is done being processed.
  */
  end: function()
  {
    NS_ASSERT(!this._ended, 'ending this response twice?!?!');

    this._connection.close();
    if (this._bodyOutputStream)
    {
      this._bodyOutputStream.close();
    }
    this._ended = true;
  },

  // PRIVATE IMPLEMENTATION

  /**
  * Sends the status line and headers of this response if they haven't been
  * sent and initiates the process of copying data written to this response's
  * body to the network.
  */
  _startAsyncProcessor: function _startAsyncProcessor()
  {
    dumpn('*** _startAsyncProcessor()');

    // Send headers if they haven't been sent already and should be sent, then
    // asynchronously continue to send the body.
    if (this._headers)
    {
      dblog('[' + '_startAsyncProcessor' + '] ' +'call  _sendHeaders');
      this._sendHeaders();
      dblog('[' + '_startAsyncProcessor' + '] ' +'done.');
      return;
    }

    this._headers = null;
  },


  _send: function(data) // ret: call end by this
  {
    var tcpsock = this._connection._tcpsocket;
    var type = typeof(data);
    if (type == 'object')
    {
      if (data.constructor)
      {
        type = data.constructor.name;
      }
    }
    // argument of send() is ArrayBuffer
    if (type === 'string')
    {
      dblog('_sending string ' + data.length + ' chars');
      var abuff = new ArrayBuffer(data.length);
      var view = new Uint8Array(abuff);

      for (var i = 0; i < view.length; i++)
      {
        view[i] = data.charCodeAt(i);
      }
      this._sendData(tcpsock, abuff);
      return false;
    }
    else if (type === 'RangedFile')
    {
      dblog('_sending RangedFile');
      this._sendFile(tcpsock, data);
      return true;
    }
    else
    {
      dblog('_sending ' + type);
      this._sendData(tcpsock, data);
      return false;
    }
  },
  
  _sendData: function(sock, data)
  {
    dblog('_sendData sock.readyState:' + sock.readyState);
    if (sock.readyState === 'open')
    {
      sock.send(data);
      return true;
    }
    else
    {
      return false;
    }
  },

  _sendFile: function _sendFile(sock, rangedFile)
  {

    const UNIT_SIZE = Math.pow(2, 16);
    dblog('_sendFile sock.readyState:' + sock.readyState);
    if (sock.readyState !== 'open')
    {
      if (rangedFile != null)
      {
          rangedFile.file = null;
          rangedFile = null;
      }
      return;
    }
    var spos = 0;
    var size = rangedFile.end + 1;
    var self = this;
    var times = Math.ceil(size / UNIT_SIZE);
    dblog('_sendFile times:' + times);
    var count = 0;
    var reader = new FileReader();
    log ('_sendFile (type)' + rangedFile.constructor.name);
    log ('_sendFile block size = ' +  UNIT_SIZE);
    var pieceofFile = null;
    var timeoutId = null;
    var sendUnit = function()
    {
      dblog('sendUnit spos:' + spos + ' size:' + size);
      if (spos >= size)
      {
        dblog('sendUnit no more data');
        self.end();
        releaseRangedFile();
        abortFileReader();
        sock.ondrain = null;
        pieceofFile = null;
        cancelTimeoutClose();
        return;
      }
      cancelTimeoutClose();
      var end = Math.min(spos + UNIT_SIZE, size);
      dblog('sendUnit ' +
        (count++) + '/' + times +
        ' range = ' + spos + '-' + end + ' total = ' + size);
      if (rangedFile == null || reader == null)
      {
        dblog('sendUnit null check end');
        return;
      }
      pieceofFile = rangedFile.file.slice(spos, end);
      reader.onload = function onload(e)
      {
        dblog('sendUnit reader onload');
        spos = end;
        var sendret = self._sendData(sock, reader.result);
        dblog('sendUnit _sendData sendret:' + sendret);
        if (sendret === false)
        {
          releaseRangedFile();
          abortFileReader();
        }
        if (spos >= size)
        {
          dblog('sendUnit no more data');
          self.end();
          releaseRangedFile();
          abortFileReader();
          sock.ondrain = null;
          pieceofFile = null;
          cancelTimeoutClose();
          return;
        }
        timeoutId = setTimeout(timeoutClose, 30000);
        pieceofFile = null;
      };
      reader.onabort = function onabort(e)
      {
        dblog('reader onabort');
        self.end();
        releaseRangedFile();
        reader = null;
        pieceofFile = null;
        cancelTimeoutClose();
      };
      reader.readAsArrayBuffer(pieceofFile);
    };

    sock.onclose  = function(evt)
    {
      dblog('sock onclose');
      self.end();
      releaseRangedFile();
      abortFileReader();
      pieceofFile = null;
      cancelTimeoutClose();
    };
    sock.onerror  = function(evt)
    {
      dblog('sock onerror');
      self.end();
      releaseRangedFile();
      abortFileReader();
      pieceofFile = null;
      cancelTimeoutClose();
    };
    var timeoutClose = function()
    {
      dblog('timeoutClose');
      self.end();
      releaseRangedFile();
      abortFileReader();
      sock.ondrain = null;
      pieceofFile = null;
      timeoutId = null;
    };
    
    var cancelTimeoutClose = function()
    {
      dblog('cancelTimeoutClose timeoutId:' + timeoutId);
      if (timeoutId != null) {
         clearTimeout(timeoutId);
         timeoutId = null;
      }
    };
    
    var releaseRangedFile = function()
    {
      dblog('releaseRangedFile');
      if (rangedFile != null)
      {
        rangedFile.file = null;
        rangedFile = null;
      }
    };

    var abortFileReader = function()
    {
      dblog('abortFileReader');
      if (reader != null &&
          reader.readyState == FileReader.LOADING)
      {
        dblog('abortFileReader reader.abort()');
        reader.abort();
      }
      reader = null;
      
    };
    sock.ondrain = sendUnit;
    sendUnit();

    dblog('_sendFile end');
  },

  /**
  * Signals that all modifications to the response status line and headers are
  * complete and then sends that data over the network to the client.  Once
  * this method completes, a different response to the request that resulted
  * in this response cannot be sent -- the only possible action in case of
  * error is to abort the response and close the connection.
  */
  _sendHeaders: function _sendHeaders()
  {
    dblog('[' + '_sendHeaders' + '] ' +'start');

    dumpn('*** _sendHeaders()');

    NS_ASSERT(this._headers);

    // request-line
    var statusLine = 'HTTP/' + this.httpVersion + ' ' +
      this.httpCode + ' ' +
      this.httpDescription ;

    // header post-processing
    var headers = this._headers;

    headers.setHeader('Server', 'httpd.js', false);
    if (!headers.hasHeader('Date'))
    {
      headers.setHeader('Date', utils.toDateString(Date.now()), false);
    }

    var size = 0;
    if (this._bodyInputStream != null)
    {
      dblog('[' + '_sendHeaders' + '] ' +'body size ' +
          this._bodyInputStream.size + ' data: ');
      dblog('[' + '_sendHeaders' + '] ' +this._bodyInputStream.data);

      size = this._bodyInputStream.size;
    }

    headers.setHeader('Content-Length', '' + size, false);

    // construct and send response
    dumpn('*** header post-processing completed, sending response head...');
    // request-line
    var preambleData = [statusLine];
    // headers
    for (var fieldName in headers._headers)
    {
      preambleData.push(fieldName + ': ' + headers._headers[fieldName]);
    }
    // end request-line/headers
    preambleData.push('\r\n');

    // send headers
    this._send(preambleData.join('\r\n'));
    dblog('[' + '_sendHeaders' + '] ' +'header: ' +
        preambleData.join(', '));
    // send body (if exists)
    this._sendBody();

    // dump response
    if (DUMP_RESPONSE_HEADER)
    {
      this._dumpHeaders();
    }
    if (DUMP_RESPONSE_BODY)
    {
      this._dumpBody();
    }
    // Forbid setting any more headers or modifying the request line.
    this._headers = null;
  },

  /**
  * Asynchronously writes the body of the response to the network.
  */
  _sendBody: function _sendBody()
  {
    dumpn('*** _sendBody');
    dblog('[' + '_sendBody' + '] ' +'Start: sendBody');

    // If no body data was written, we're done
    if (!this._bodyInputStream)
    {
      dumpn('*** empty body, response finished');
      this.end();
      return;
    }

    var socketClosedByFunc = false;
    if (this._bodyInputStream.size > 0)
    {
      if (this._bodyInputStream.data)
      {
        dblog(' has data(array buffer)');
        socketClosedByFunc = this._send(this._bodyInputStream.data);
      }
      else
      {
        dblog('file:' + JSON.stringify(this._bodyInputStream.file));
        socketClosedByFunc = this._send(this._bodyInputStream.file);
      }
    }
    if (!socketClosedByFunc)
    {
      dblog('sendbody: closing socket');
      this.end();
    }
    else{
      dblog('sendbody: socket kept');
    }

    dblog('[' + '_sendBody' + '] ' +'End: sendBody');

  },

  /** Ensures that this hasn't been ended. */
  _ensureAlive: function()
  {
    NS_ASSERT(!this._ended, 'not handling response lifetime correctly');
  },

  _dumpHeaders: function()
  {
    var dumpStr = '<response_headers>\n';
    var headers = this._headers;

    for (var fieldName in headers._headers)
    {
      dumpStr += fieldName + ': ' + headers._headers[fieldName] + '\n';
    }

    dumpStr += '\n</response_headers>';
    console.log('[' + '_ensureAlive' + '] ' +dumpStr);
  },

  _dumpBody: function()
  {
    var dumpStr = '<response_body>\n';
    var getBinaryString = function(uint8array)
    {
      var arr = [];
      var str = '';
      var i;
      for (i = 0; i < uint8array.length; i++)
      {
        var s = '0' + uint8array[i].toString(16);

        arr.push(s.substring(s.length - 2));
      }

      for (i = 0; i < ((arr.length + 15) / 16); i++)
      {
        str += arr.slice(i * 16, i * 16 + 16).join(' ') + '\n';
      }

      return str;
    };

    dumpStr += getBinaryString(this._bodyInputStream.data);
    dumpStr += '\n</response_body>';
    console.log('[' + '_ensureAlive' + '] ' +dumpStr);
  }
};

/**
* Constructs an object representing an HTTP version (see section 3.1).
*
* @class
*
* @param versionString
*   a string of the form '#.#', where # is an non-negative decimal integer with
*   or without leading zeros
* @throws
*   if versionString does not specify a valid HTTP version number
*/
function HttpVersion(versionString)
{
  var matches = /^(\d+)\.(\d+)$/.exec(versionString);
  if (!matches)
  {
    throw 'Not a valid HTTP version!';
  }

  /** The major version number of this, as a number. */
  this.major = parseInt(matches[1], 10);

  /** The minor version number of this, as a number. */
  this.minor = parseInt(matches[2], 10);

  if (isNaN(this.major) || isNaN(this.minor) ||
  this.major < 0    || this.minor < 0)
  {
    throw 'Not a valid HTTP version!';
  }
}
HttpVersion.prototype =
{
  /**
  * Returns the standard string representation of the HTTP version represented
  * by this (e.g., '1.1').
  */
  toString: function ()
  {
    return this.major + '.' + this.minor;
  },

  /**
  * Returns true if this represents the same HTTP version as otherVersion,
  * false otherwise.
  *
  * @param otherVersion : nsHttpVersion
  *   the version to compare against this
  */
  equals: function (otherVersion)
  {
    return this.major == otherVersion.major &&
    this.minor == otherVersion.minor;
  },

  /** True if this >= otherVersion, false otherwise. */
  atLeast: function(otherVersion)
  {
    return this.major > otherVersion.major ||
    (this.major == otherVersion.major &&
    this.minor >= otherVersion.minor);
  }
};


