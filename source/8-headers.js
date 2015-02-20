
HttpVersion.HTTP_1_0 = new HttpVersion('1.0');
HttpVersion.HTTP_1_1 = new HttpVersion('1.1');


/**
 * An object which stores HTTP headers for a request or response.
 *
 * Note that since headers are case-insensitive, this object converts headers to
 * lowercase before storing them.  This allows the getHeader and hasHeader
 * methods to work correctly for any case of a header, but it means that the
 * values returned by .enumerator may not be equal case-sensitively to the
 * values passed to setHeader when adding headers to this.
 * @class
 */
function HttpHeaders()
{
  /**
  * A hash of headers, with header field names as the keys and header field
  * values as the values.  Header field names are case-insensitive, but upon
  * insertion here they are converted to lowercase.  Header field values are
  * normalized upon insertion to contain no leading or trailing whitespace.
  *
  * Note also that per RFC 2616, section 4.2, two headers with the same name in
  * a message may be treated as one header with the same field name and a field
  * value consisting of the separate field values joined together with a ',' in
  * their original order.  This hash stores multiple headers with the same name
  * in this manner.
  */
  this._headers = {};
}
HttpHeaders.prototype =
{
  /**
  * Sets the header represented by name and value in this.
  *
  * @param name : string
  *   the header name
  * @param value : string
  *   the header value
  * @throws NS_ERROR_INVALID_ARG
  *   if name or value is not a valid header component
  */
  setHeader: function setHeader(fieldName, fieldValue, merge)
  {
    log('[' + 'setHeader' + '] ' +'Start');

    var name = headerUtils.normalizeFieldName(fieldName);
    var value = headerUtils.normalizeFieldValue(fieldValue);
    log('[' + 'setHeader' + '] ' +' ('+ name + ' => ' + value + ')');

    // The following three headers are stored as arrays because their real-world
    // syntax prevents joining individual headers into a single header using
    // ','.  See also <http://hg.mozilla.org/mozilla-central/diff/
    //       9b2a99adc05e/netwerk/protocol/http/src/nsHttpHeaderArray.cpp#l77>
    if (merge && name in this._headers)
    {
      if (name === 'www-authenticate' ||
        name === 'proxy-authenticate' ||
        name === 'set-cookie')
      {
        this._headers[name].push(value);
      }
      else
      {
        this._headers[name][0] += ',' + value;
        NS_ASSERT(this._headers[name].length === 1,
        'how\'d a non-special header have multiple values?');
      }
    }
    else
    {
      this._headers[name] = [value];
    }
    log('[' + 'setHeader' + '] ' +'End');

  },

  /**
  * Returns the value for the header specified by this.
  *
  * @throws NS_ERROR_INVALID_ARG
  *   if fieldName does not constitute a valid header field name
  * @throws NS_ERROR_NOT_AVAILABLE
  *   if the given header does not exist in this
  * @returns string
  *   the field value for the given header, possibly with non-semantic changes
  *   (i.e., leading/trailing whitespace stripped, whitespace runs replaced
  *   with spaces, etc.) at the option of the implementation; multiple
  *   instances of the header will be combined with a comma, except for
  *   the three headers noted in the description of getHeaderValues
  */
  getHeader: function(fieldName)
  {
    return this.getHeaderValues(fieldName).join('\n');
  },

  /**
  * Returns the value for the header specified by fieldName as an array.
  *
  * @throws NS_ERROR_INVALID_ARG
  *   if fieldName does not constitute a valid header field name
  * @throws NS_ERROR_NOT_AVAILABLE
  *   if the given header does not exist in this
  * @returns [string]
  *   an array of all the header values in this for the given
  *   header name.  Header values will generally be collapsed
  *   into a single header by joining all header values together
  *   with commas, but certain headers (Proxy-Authenticate,
  *   WWW-Authenticate, and Set-Cookie) violate the HTTP spec
  *   and cannot be collapsed in this manner.  For these headers
  *   only, the returned array may contain multiple elements if
  *   that header has been added more than once.
  */
  getHeaderValues: function(fieldName)
  {
    var name = headerUtils.normalizeFieldName(fieldName);

    if (name in this._headers)
    {
      return this._headers[name];
    }
    else
    {
      throw 'fff Cr.NS_ERROR_NOT_AVAILABLE';
    }
  },

  /**
  * Returns true if a header with the given field name exists in this, false
  * otherwise.
  *
  * @param fieldName : string
  *   the field name whose existence is to be determined in this
  * @throws NS_ERROR_INVALID_ARG
  *   if fieldName does not constitute a valid header field name
  * @returns boolean
  *   true if the header's present, false otherwise
  */
  hasHeader: function(fieldName)
  {
    var name = headerUtils.normalizeFieldName(fieldName);
    return (name in this._headers);
  },
};

