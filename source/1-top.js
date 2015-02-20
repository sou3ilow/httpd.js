
'use strict';

/* Mode: JavaScript; tab-width: 2; indent-tabs-mode: nil; c-basic-offset: 2 */
/* vim:set ts=2 sw=2 sts=2 et: */
/* This Source Code Form is subject to the terms of the Mozilla Public
* License, v. 2.0. If a copy of the MPL was not distributed with this
* file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/*
* An implementation of an HTTP server.
*/

/* jshint multistr: true */

//'use strict';

/** True if debugging output is enabled, false otherwise. */
var DEBUG = false; // non-const *only* so tweakable in server tests
var DEBUG_LOG = false;

/** True if debugging output should be timestamped. */
var DEBUG_TIMESTAMP = false; // non-const so tweakable in server tests

var DUMP_REQUEST_HEADER = false;
var DUMP_REQUEST_BODY = false;
var DUMP_RESPONSE_HEADER = false;
var DUMP_RESPONSE_BODY = false;
var DUMP_MESSAGE_TIMESTAMP = false;

/**
* Asserts that the given condition holds.  If it doesn't, the given message is
* dumped, a stack trace is printed, and an exception is thrown to attempt to
* stop execution (which unfortunately must rely upon the exception not being
* accidentally swallowed by the code that uses it).
*/
function NS_ASSERT(cond, msg)
{
  if (DEBUG && !cond)
  {
    dumpn('###!!!');
    dumpn('###!!! ASSERTION' + (msg ? ': ' + msg : '!'));
    dumpn('###!!! Stack follows:');

    var stack = new Error().stack.split(/\n/);
    dumpn(stack.map(function(val) { return '###!!!   ' + val; }).join('\n'));

    throw 'Cr.NS_ERROR_ABORT';
  }
}

/** Constructs an HTTP error object. */
var HttpError = function HttpError(code, description)
{
  this.code = code;
  this.description = description;
};

HttpError.prototype =
{
  toString: function()
  {
    return this.code + ' ' + this.description;
  }
};

/**
* Errors thrown to trigger specific HTTP server responses.
*/
var HTTP_400 = new HttpError(400, 'Bad Request');
var HTTP_403 = new HttpError(403, 'Forbidden');
var HTTP_404 = new HttpError(404, 'Not Found');

var HTTP_500 = new HttpError(500, 'Internal Server Error');
var HTTP_501 = new HttpError(501, 'Not Implemented');

/**
 * @namespace
 */
var utils = {}

/** Creates a hash with fields corresponding to the values in arr. */
utils.array2obj = function(arr)
{
  var obj = {};
  for (var i = 0; i < arr.length; i++)
  {
    obj[arr[i]] = arr[i];
  }
  return obj;
}

/** Returns an array of the integers x through y, inclusive. */
function range(x, y)
{
  var arr = [];
  for (var i = x; i <= y; i++)
  {
    arr.push(i);
  }
  return arr;
}

/** An object (hash) whose fields are the numbers of all HTTP error codes. */
const HTTP_ERROR_CODES = utils.array2obj(range(400, 417).concat(range(500, 505)));

/** Base for relative timestamps produced by dumpn(). */
var firstStamp = 0;

/** dump(str) with a trailing '\n' -- only outputs if DEBUG. */
function dumpn(str)
{
  if (DEBUG)
  {
    var prefix = 'HTTPD-INFO | ';
    if (DEBUG_TIMESTAMP)
    {
      if (firstStamp === 0)
      {
        firstStamp = Date.now();
      }

      var elapsed = Date.now() - firstStamp; // milliseconds
      var min = Math.floor(elapsed / 60000);
      var sec = (elapsed % 60000) / 1000;

      if (sec < 10)
      {
        prefix += min + ':0' + sec.toFixed(3) + ' | ';
      }
      else
      {
        prefix += min + ':' + sec.toFixed(3) + ' | ';
      }
    }

    dump(prefix + str + '\n');
  }
}

function dumpSysTime(str)
{
  if (DUMP_MESSAGE_TIMESTAMP) {
    var curTime = (+new Date());
    console.log('SysTm(' + curTime + '):' + str);
  }
}

function log(msg)
{
  if (DEBUG_LOG) {
    console.log('[HTTPD]:' + msg);
  }
}

/**
* Returns the RFC 822/1123 representation of a date.
*
* @param date : Number
*   the date, in milliseconds from midnight (00:00:00), January 1, 1970 GMT
* @returns string
*   the representation of the given date
*/
utils.toDateString = function(date)
{
  //
  // rfc1123-date = wkday ',' SP date1 SP time SP 'GMT'
  // date1        = 2DIGIT SP month SP 4DIGIT
  //                ; day month year (e.g., 02 Jun 1982)
  // time         = 2DIGIT ':' 2DIGIT ':' 2DIGIT
  //                ; 00:00:00 - 23:59:59
  // wkday        = 'Mon' | 'Tue' | 'Wed'
  //              | 'Thu' | 'Fri' | 'Sat' | 'Sun'
  // month        = 'Jan' | 'Feb' | 'Mar' | 'Apr'
  //              | 'May' | 'Jun' | 'Jul' | 'Aug'
  //              | 'Sep' | 'Oct' | 'Nov' | 'Dec'
  //

  const wkdayStrings = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const monthStrings = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  /**
  * Processes a date and returns the encoded UTC time as a string according to
  * the format specified in RFC 2616.
  *
  * @param date : Date
  *   the date to process
  * @returns string
  *   a string of the form 'HH:MM:SS', ranging from '00:00:00' to '23:59:59'
  */
  function toTime(date)
  {
    var hrs = date.getUTCHours();
    var rv  = (hrs < 10) ? '0' + hrs : hrs;

    var mins = date.getUTCMinutes();
    rv += ':';
    rv += (mins < 10) ? '0' + mins : mins;

    var secs = date.getUTCSeconds();
    rv += ':';
    rv += (secs < 10) ? '0' + secs : secs;

    return rv;
  }

  /**
  * Processes a date and returns the encoded UTC date as a string according to
  * the date1 format specified in RFC 2616.
  *
  * @param date : Date
  *   the date to process
  * @returns string
  *   a string of the form 'HH:MM:SS', ranging from '00:00:00' to '23:59:59'
  */
  function toDate1(date)
  {
    var day = date.getUTCDate();
    var month = date.getUTCMonth();
    var year = date.getUTCFullYear();

    var rv = (day < 10) ? '0' + day : day;
    rv += ' ' + monthStrings[month];
    rv += ' ' + year;

    return rv;
  }

  date = new Date(date);

  const fmtString = '%wkday%, %date1% %time% GMT';
  var rv = fmtString.replace('%wkday%', wkdayStrings[date.getUTCDay()]);
  rv = rv.replace('%time%', toTime(date));
  return rv.replace('%date1%', toDate1(date));
}

/**
* Determines whether the given character code is a CTL.
*
* @param code : uint
*   the character code
* @returns boolean
*   true if code is a CTL, false otherwise
*/
utils.isCTL = function(code)
{
  return (code >= 0 && code <= 31) || (code == 127);
}


// Response CONSTANTS

// token       = *<any CHAR except CTLs or separators>
// CHAR        = <any US-ASCII character (0-127)>
// CTL         = <any US-ASCII control character (0-31) and DEL (127)>
// separators  = '(' | ')' | '<' | '>' | '@'
//             | ',' | ';' | ':' | '\' | <'>
//             | '/' | '[' | ']' | '?' | '='
//             | '{' | '}' | SP  | HT
const IS_TOKEN_ARRAY =
  [0, 0, 0, 0, 0, 0, 0, 0, //   0
   0, 0, 0, 0, 0, 0, 0, 0, //   8
   0, 0, 0, 0, 0, 0, 0, 0, //  16
   0, 0, 0, 0, 0, 0, 0, 0, //  24

   0, 1, 0, 1, 1, 1, 1, 1, //  32
   0, 0, 1, 1, 0, 1, 1, 0, //  40
   1, 1, 1, 1, 1, 1, 1, 1, //  48
   1, 1, 0, 0, 0, 0, 0, 0, //  56

   0, 1, 1, 1, 1, 1, 1, 1, //  64
   1, 1, 1, 1, 1, 1, 1, 1, //  72
   1, 1, 1, 1, 1, 1, 1, 1, //  80
   1, 1, 1, 0, 0, 0, 1, 1, //  88

   1, 1, 1, 1, 1, 1, 1, 1, //  96
   1, 1, 1, 1, 1, 1, 1, 1, // 104
   1, 1, 1, 1, 1, 1, 1, 1, // 112
   1, 1, 1, 0, 1, 0, 1];   // 120


/**
 * 
 * A container for utility functions used with HTTP headers.
 * @namespace
 */
const headerUtils =
{
  /**
  * Normalizes fieldName (by converting it to lowercase) and ensures it is a
  * valid header field name (although not necessarily one specified in RFC
  * 2616).
  *
  * @memberof headerUtils
  *
  * @param {string} fieldName
  *
  * @throws if fieldName does not match the field-name production in RFC 2616
  * @returns {string}
  *   fieldName converted to lowercase if it is a valid header, for characters
  *   where case conversion is possible
  */
  normalizeFieldName: function(fieldName)
  {
    if (fieldName === '')
    {
      throw 'normalizeFieldName(): empty fieldName';
    }

    for (var i = 0, sz = fieldName.length; i < sz; i++)
    {
      if (!IS_TOKEN_ARRAY[fieldName.charCodeAt(i)])
      {
        throw 'normalizeFieldName(): ' + fieldName +
              ' is not a valid header field name!';
      }
    }

    return fieldName.toLowerCase();
  },

  /**
  * Ensures that fieldValue is a valid header field value (although not
  * necessarily as specified in RFC 2616 if the corresponding field name is
  * part of the HTTP protocol), normalizes the value if it is, and
  * returns the normalized value.
  *
  * @memberof headerUtils
  *
  * @param {string} fieldValue
  *   a value to be normalized as an HTTP header field value
  * @throws NS_ERROR_INVALID_ARG
  *   if fieldValue does not match the field-value production in RFC 2616
  * @returns {string}
  *   fieldValue as a normalized HTTP header field value
  */
  normalizeFieldValue: function(fieldValue)
  {
    // field-value    = *( field-content | LWS )
    // field-content  = <the OCTETs making up the field-value
    //                  and consisting of either *TEXT or combinations
    //                  of token, separators, and quoted-string>
    // TEXT           = <any OCTET except CTLs,
    //                  but including LWS>
    // LWS            = [CRLF] 1*( SP | HT )
    //
    // quoted-string  = ( <'> *(qdtext | quoted-pair ) <'> )
    // qdtext         = <any TEXT except <'>>
    // quoted-pair    = '\' CHAR
    // CHAR           = <any US-ASCII character (octets 0 - 127)>

    // Any LWS that occurs between field-content MAY be replaced with a single
    // SP before interpreting the field value or forwarding the message
    // downstream (section 4.2); we replace 1*LWS with a single SP
    var val = fieldValue.replace(/(?:(?:\r\n)?[ \t]+)+/g, ' ');

    // remove leading/trailing LWS (which has been converted to SP)
    val = val.replace(/^ +/, '').replace(/ +$/, '');

    // that should have taken care of all CTLs, so val should contain no CTLs
    dumpn('*** Normalized value: \'' + val + '\'');
    for (var i = 0, len = val.length; i < len; i++)
    {
      if (utils.isCTL(val.charCodeAt(i)))
      {
        throw 'normalizedFieldValue(): *** Char ' + i +
              ' has charcode ' + val.charCodeAt(i);
      }
    }
    // XXX disallows quoted-pair where CHAR is a CTL -- will not invalidly
    //     normalize, however, so this can be construed as a tightening of the
    //     spec and not entirely as a bug
    return val;
  }
};

