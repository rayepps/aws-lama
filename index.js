const http = require('http')
const url = require('url')
const EventEmitter = require('events')

const isType = require('type-is')


/**
 * Convert an http req/res pair to a lambda invocation ready
 * event/context pair. Pulls all relavent data about the request
 * from the req param and uses it to build full even/context
 * objects just like the ones AWS lambda passes functions
 * when they are invoked in AWS.
 * @param {http.ClientRequest} req The htp request to convert to event/context
 * @param {http.ServerResponse} res The http response to convert to event/context
 */
const toEventContext = (req, res) => {
  const event = null
  const context = null
  return { event, context }
}


/**
 * Convert an event/context pair to a req/res pair that can be passed
 * to a server style function. Note: In order to avoid actually starting
 * a server and nuking performance the request and response objects are
 * deep fakes. This means, they are only useful to you if your later using
 * lama to read the response and generate an event/context response.
 * @param {aws.lambda.Event} event The event object
 * @param {aws.lambda.Context} context 
 */
const toRequestResponse = async (event, context) => {

  const req = new AWSHttpRequest(event, context)
  const res = new AWSHttpResponse()

  return { 
    req,
    res
  }
}


/**
 * Convertes a req/res pair into an api gateway friendly response object.
 * @param {http.ClientRequest} req The htp request that initiated the response
 * @param {http.ServerResponse} res The http response to read data/changes/delta from to create an api gateway friendly response object
 */
const toApiGatewayResponse = (req, res) => {

  const { payload = '', statusCode = 200 } = res

  const { headers, multiValueHeaders } = Object.entries(res.headers || {}).reduce((acc, [key, value]) => {

    // chunked transfer not currently supported by API Gateway
    if (key === 'transfer-encoding' && value === 'chunked') return acc

    const { headers, multiValueHeaders } = acc
    if (Array.isArray(value)) return {
      headers, multiValueHeaders: { ...multiValueHeaders, [key]: value }
    }
    return {
      multiValueHeaders, headers: { ...headers, [key]: value }
    }
  }, { headers: {}, multiValueHeaders: {} })

  const contentType = getContentType({ contentTypeHeader: headers['content-type'] })
  const isBase64Encoded = isContentTypeBinaryMimeType({ contentType, binaryMimeTypes: [] })
  const body = payload.toString(isBase64Encoded ? 'base64' : 'utf8')
  
  return {
    body,
    statusCode,
    isBase64Encoded,
    headers,
    multiValueHeaders
  }
}

/**
 * Given a result containing data about how the http response should
 * be provided, make all neccisary changes/applications to the http
 * response object.
 * @param {any} result 
 * @param {http.ServerResponse} httpResponse 
 */
const toHttpResponse = (result, httpResponse) => {
  const { status, body, headers } = result
  // Apply status, body, and headers
  httpResponse.status(status)
  httpResponse.json(JSON.parse(body))
  for (const [key, value] of Object.entries(headers)) {
    httpResponse.append(key, value)
  }
}

exports.toEventContext = toEventContext
exports.toRequestResponse = toRequestResponse
exports.toApiGatewayResponse = toApiGatewayResponse
exports.toHttpResponse = toHttpResponse


const getContentType = (params) => {
  // only compare mime type; ignore encoding part
  return params.contentTypeHeader ? params.contentTypeHeader.split(';')[0] : ''
}

const isContentTypeBinaryMimeType = (params) => {
  return params.binaryMimeTypes.length > 0 && !!isType.is(params.contentType, params.binaryMimeTypes)
}


class AWSHttpRequest {
  constructor(event, context) {

    const eventWithoutBody = { ...event, body: undefined }

    const headers = {
      ...event.headers,
      'x-apigateway-event': encodeURIComponent(JSON.stringify(eventWithoutBody)),
      'x-apigateway-context': encodeURIComponent(JSON.stringify(context))
    }

    // NOTE: API Gateway is not setting Content-Length header on requests even when they have a body
    if (event.body && !headers['Content-Length']) {
      const encoding = event.isBase64Encoded ? 'base64' : 'utf8'
      const body = Buffer.from(event.body, encoding)
      headers['Content-Length'] = Buffer.byteLength(body)
    }

    this.params = {}
    this.query = {}
    this.method = event.httpMethod

    const path = url.format({ 
      pathname: event.path, 
      query: event.queryStringParameters 
    })

    this.path = path
    this.url = path

    this.rawHeaders = Object.entries(headers).reduce((acc, [ key, value ]) => {
      return [ ...acc, key, value ]
    }, [])

    this.headers = Object.entries(headers).reduce((acc, [ key, value ]) => {
      return { ...acc, [key.toLowerCase()]: value }
    }, {})
  }
}

class AWSHttpResponse {
  constructor() {
    this._events = new EventEmitter()
    this._events.on('end', () => this._end = true)
    this.headers = {}
  }
  setHeader(name, value) {
    const existing = this.headers[name]
    if (!existing) {
      this.headers[name] = value
      return
    }
    if (Array.isArray(existing)) {
      this.headers[name] = [ ...existing, value ]
      return
    }
    this.headers[name] = [ existing, value ]
  }
  getHeader(name) {
    return this.headers[name]
  }
  end(payload) {
    this.payload = payload
    this._events.emit('end')
  }
  async ended() {
    await new Promise(res => {
      if (this._end) res()
      else this._events.on('end', res)
    })
  }
}

