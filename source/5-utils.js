

/** The character codes for CR and LF. */
const CR = 0x0D, LF = 0x0A;

/**
* Calculates the number of characters before the first CRLF pair in array, or
* -1 if the array contains no CRLF pair.
*
* @param array : Array
*   an array of numbers in the range [0, 256), each representing a single
*   character; the first CRLF is the lowest index i where
*   |array[i] == '\r'.charCodeAt(0)| and |array[i+1] == '\n'.charCodeAt(0)|,
*   if such an |i| exists, and -1 otherwise
* @param start : uint
*   start index from which to begin searching in array
* @returns int
*   the index of the first CRLF if any were present, -1 otherwise
*/
/** The character codes for CR and LF. */
function findCRLF(bytes, start)
{
  for (var i = start; i < bytes.length - 1; i++)
  {
    if (bytes[i] == CR && bytes[i + 1] == LF)
    {
      return i;
    }
  }

  return -1;
}

/**
* A container which provides line-by-line access to the arrays of bytes with
* which it is seeded.
*/
function LineData()
{
  /** An array of queued bytes from which to get line-based characters. */
  this._data = null;

  /** Start index from which to search for CRLF. */
  this._start = 0;
}
LineData.prototype =
{
  /**
  * Appends the bytes in the given array to the internal data cache maintained
  * by this.
  */
  appendBytes: function(bytes)
  {
    if (this._data) {
      var newBuffer = new Uint8Array(this._data.length + bytes.length);

      newBuffer.set(this._data, 0);
      newBuffer.set(bytes, this._data.length);
      this._data = newBuffer;
    }
    else {
      this._data = new Uint8Array(bytes);
    }
  },

  /**
  * Removes and returns a line of data, delimited by CRLF, from this.
  *
  * @param out
  *   an object whose 'value' property will be set to the first line of text
  *   present in this, sans CRLF, if this contains a full CRLF-delimited line
  *   of text; if this doesn't contain enough data, the value of the property
  *   is undefined
  * @returns boolean
  *   true if a full line of data could be read from the data in this, false
  *   otherwise
  */
  readLine: function readLine(out)
  {
    var data = this._data;
    var lineEnd = findCRLF(data, this._start);
    log('[' + 'readLine' + '] ' +'data length: ' + data.length);
    log('[' + 'readLine' + '] ' +'crlf position: ' + lineEnd);

    if (length < 0)
    {
      this._start = data.length;

      // But if our data ends in a CR, we have to back up one, because
      // the first byte in the next packet might be an LF and if we
      // start looking at data.length we won't find it.
      if (data.length > 0 && data[data.length - 1] === CR)
      {
        --this._start;
      }

      return false;
    }

    var line = String.fromCharCode.apply(null,
                                         data.subarray(this._start, lineEnd));

    this._start = lineEnd + 2;
    log('[' + 'readLine' + '] ' +'start:' + this._start);
    log('[' + 'readLine' + '] ' +'line: ' + line);

    out.value = line;
    return true;
  },

  /**
  * Removes the bytes currently within this and returns them in an array.
  *
  * @returns Array
  *   the bytes within this when this method is called
  */
  purge: function()
  {
    var data = this._data.subarray(this._start, this._data.length);

    log('[' + 'readLine' + '] ' +
        'purge(): data.length=' + data.length);
    this._data = null;
    this._start = 0;
    return data;
  }
};



/**
* Converts the given string into a string which is safe for use in an HTML
* context.
*
* @param str : string
*   the string to make HTML-safe
* @returns string
*   an HTML-safe version of str
*/
function htmlEscape(str)
{
  // this is naive, but it'll work
  var s = '';
  for (var i = 0; i < str.length; i++)
  {
    s += '&#' + str.charCodeAt(i) + ';';
  }
  return s;
}

/**
* Creates a request-handling function for an nsIHttpRequestHandler object.
*/
function createHandlerFunc(handler)
{
  return function(metadata, response) { handler.handle(metadata, response); };
}

/**
* Converts an externally-provided path into an internal path for use in
* determining file mappings.
*
* @param path
*   the path to convert
* @param encoded
*   true if the given path should be passed through decodeURI prior to
*   conversion
* @throws URIError
*   if path is incorrectly encoded
*/
function toInternalPath(path, encoded)
{
  if (encoded)
  {
    path = decodeURI(path);
  }

  var comps = path.split('/');
  for (var i = 0, sz = comps.length; i < sz; i++)
  {
    var comp = comps[i];
    log('toInternalPath comps[' + i + ']:' + comp);
  }
  return comps.join('/');
}

function getContentType(fileExtention) {
  var toLowerExtention = fileExtention.toLowerCase();
  var map = {
    '3gp'  : 'video/3gpp',
    '3g2'  : 'video/3gpp2',
    'css'  : 'text/css',
    'gif'  : 'image/gif',
    'htm'  : 'text/html',
    'html' : 'text/html',
    'jpeg' : 'image/jpeg',
    'jpg'  : 'image/jpeg',
    'js'   : 'text/javascript',
    'mp4'  : 'video/mp4',
    'ogg'  : 'video/ogg',
    'ogv'  : 'video/ogg',
    'png'  : 'image/png',
    'webm' : 'video/webm',
    'txt'  : 'text/plain',
    'bmp'  : 'image/bmp'
  };
  var type = map[toLowerExtention];
  if (type === undefined) {
    type = 'application/octet-stream';
  }
  return type;
}

function RangedFile(file, ranged, size, start, end)
{
  this.file = file;
  this.ranged = ranged;
  this.size = size;
  this.start = start;
  this.end = end;
  log('RangedFile ranged:' + ranged +
                ' size:' + size +
                ' start:' + start+
                ' end:' + end);
}

function sliceFile(rangeHeader, file)
{

  var fsize = file.size;
  var start = 0;
  var end = file.size - 1;

  var mat = rangeHeader.match(/^bytes=(\d+)?-(\d+)?$/);
  if (mat)
  {
    // bytes=[start]-[end]
    start = (mat[1] !== undefined) ? parseInt(mat[1]) : undefined;
    end   = (mat[2] !== undefined) ? parseInt(mat[2]) : undefined;
    log('sliceFile fsize:' + fsize);
    log('sliceFile start:' + start);
    log('sliceFile end  :' + end);
    if (start === undefined && end === undefined)
    {
      // bytes=-
      start = 0;
      end = fsize - 1;
    }
    else if (start === undefined)
    {
      // bytes=-[end]
      
      // No start given, so the end is really the count of bytes from the
      // end of the file.
      start = Math.max(0, fsize - end - 1);
      end = fsize - 1;
    }
    else if (end === undefined || end >= fsize)
    {
      // bytes=[start]-
      
      // start and end are inclusive
      end = fsize - 1;

    }

    log ('sliceFile start:' + start + ' end:' + end);
    if (start !== 0 || end != fsize - 1)
    {
      file = file.slice(start, end + 1);
    }
  }

  var ranged = (rangeHeader !== '' || mat != null);

  return new RangedFile(file, ranged, fsize, start, end);
}

function writeFileResponseFactory(path, dir, readFile)
{

  function writeResponse(req, res, oncomplete)
  {

    var reqPath = req.path;
    var localPath = dir + reqPath.substr(path.length, reqPath.length - 1);

    if (localPath.slice(-1) == '/')
    {
      localPath += 'index.html';
    }
    res.writeFileResponse(localPath, readFile, req, oncomplete);
  }

  log('[' + 'readLine' + '] ' +'End');
  return writeResponse;
}

