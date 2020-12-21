# AWS Lama
AWS Lambda Mapper - Useful for converting http request/response pairs into lambda function event/context pairs and vice versa.

## Install
```sh
yarn add aws-lama
```

## Usage
Example here is allowing a next.js app to run on lambda without a server. Lama converts the event/context into a pseudo http request response. All changes to the response that next.js makes during its invocation are recorded. Once the response has ended, were using lama to convert that response object into an api gateway response that contains any details/chagnes/data that were applied to the http response.
```js
const lama = require('aws-lama')
const next = require('next')

const app = next({ dev: false })
const handle = app.getRequestHandler()

const {
  NEXT_PATH = '/'
} = process.env

exports.handler = async (event, context) => {

  const { req, res } = await lama.toRequestResponse(event, context)

  if (NEXT_PATH === '*') handle(req, res)
  else app.render(req, res, NEXT_PATH, req.params)

  await res.ended()
  const response = lama.toApiGatewayResponse(req, res)

  return response
}
```