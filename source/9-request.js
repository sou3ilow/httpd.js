
/**
 * A representation of the data in an HTTP request.
 *
 * @class
 * @param port : uint
 *   the port on which the server receiving this request runs
 */
function Request(port)
{
  /** Method of this request, e.g. GET or POST. */
  this._method = '';

  /** Path of the requested resource; empty paths are converted to '/'. */
  this._path = '';

  /** Query string, if any, associated with this request (not including '?'). */
  this._queryString = '';

  /**
   * e.g. 
   * /search?q=aaa
   */
  this._originalURL = '';

  /**
   * e.g.
   * 	req.query.v1
   * 	req.query.v2 ...
   */
  this._query = null;


  /** Scheme of requested resource, usually http, always lowercase. */
  this._scheme = 'http';

  /** Hostname on which the requested resource resides. */
  this._host = undefined;

  /** Port number over which the request was received. */
  this._port = port;

  var streamWrapper = new StreamWrapper();

  /** Stream from which data in this request's body may be read. */
  this._bodyInputStream = streamWrapper;

  /** Stream to which data in this request's body is written. */
  this._bodyOutputStream = streamWrapper;

  /**
  * The headers in this request.
  */
  this._headers = new HttpHeaders();

  /**
  * For the addition of ad-hoc properties and new functionality without having
  * to change nsIHttpRequest every time; currently lazily created, as its only
  * use is in directory listings.
  */
  this._bag = null;
}
Request.prototype =
{
  // http://doxygen.db48x.net/mozilla/html/interfacensIHttpRequest.html
  
  // SERVER METADATA
  get scheme()
  {
    return this._scheme;
  },
  get host()
  {
    return this._host;
  },
  get port()
  {
    return this._port;
  },

  // REQUEST LINE
  get method()
  {
    return this._method;
  },
  get httpVersion()
  {
    return this._httpVersion.toString();
  },
  get path()
  {
    return this._path;
  },
  get queryString()
  {
    return this._queryString;
  },

  get query()
  {
  	return this._query || {}
  },

  get originalURL() {
  	return this._originalURL;
  },

  // HEADERS
  getHeader: function(name)
  {
    return this._headers.getHeader(name);
  },
  hasHeader: function(name)
  {
    return this._headers.hasHeader(name);
  },
  get bodyInputStream()
  {
    return this._bodyInputStream;
  },
  get bodyBuffer()
  {
    return this._bodyInputStream.data;
  },

  get body()
  {
    return this._bodyInputStream.data;
  },
  
  // PRIVATE IMPLEMENTATION

  _writeBody: function(data, count)
  {
    this._bodyOutputStream.write(data, count);
  },
  _dumpHeaders: function()
  {
    var dumpStr = '<request_headers>\n';
    var headers = this._headers;

    for (var fieldName in headers._headers)
    {
      dumpStr += fieldName + ': ' + headers._headers[fieldName] + '\n';
    }

    dumpStr += '\n</request_headers>';
    console.log(dumpStr);
  },
  _dumpBody: function()
  {
    var dumpStr = '<request_body>\n';
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
    dumpStr += '\n</request_body>';
    console.log(dumpStr);
  }
};
/**
 * @class
 */
function StreamWrapper()
{
  this._data = null;
  this._file = null;
}
StreamWrapper.prototype =
{
  /*
  * get data as Uint8Array
  */
  get data()
  {
    return this._data;
  },

  get size()
  {
    if (this._data)
    {
      return this._data.byteLength;
    }
    else if (this._file)
    {
      return this._file.size;
    }
    else
    {
      return 0;
    }
  },

  set file(f)
  {
    if (f.constructor.name !== 'RangedFile')
    {
      dblog('not a ranged file !!!!');
    }
    this._file = f;
  },

  get file()
  {
    return this._file;
  },

  write: function(inputData, length)
  {
    var dataType = Object.prototype.toString.call(inputData).slice(8, -1);
    var offset;
    var view;
    if (dataType == 'String')
    {
      dblog('write String');
      var utf8Octets = unescape(encodeURIComponent(inputData));

      if (!length)
      {
        length = utf8Octets.length;
      }

      offset = this._realloc(length);
      view = new Uint8Array(this._data);

      for (var i = 0; i < length; i++)
      {
        view[offset + i] = utf8Octets.charCodeAt(i);
      }
    }
    else if (dataType == 'Uint8Array' || dataType == 'ArrayBuffer')
    {
      dblog('write array/arraybuffer');
      var data = (dataType == 'Uint8Array') ?
                  inputData : new Uint8Array(inputData);

      if (!length)
      {
        length = data.length;
      }

      offset = this._realloc(length);
      view = new Uint8Array(this._data);
      view.set(data.subarray(0, length), offset);
    }
    else
    {
      dblog('write ranged file?:' + JSON.stringify(inputData));
      this._data = null;
      this.file = inputData;
    }
  },

  close: function()
  {
  },

  _realloc: function(length)
  {
    var offset = 0;

    if (this._data)
    {
      offset = this._data.byteLength;
      var newBuffer = new ArrayBuffer(offset + length);
      var oldView = new Uint8Array(this._data);
      var newView = new Uint8Array(newBuffer);
      newView.set(oldView, 0);
      this._data = newBuffer;
    }
    else
    {
      this._data = new ArrayBuffer(length);
    }
    return offset;
  }
};
