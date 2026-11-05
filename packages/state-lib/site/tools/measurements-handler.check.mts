// Contract of the hosted measurement function's error mapping, run without a database:
// the body is rejected before any connection is attempted.
import assert from 'node:assert/strict';
process.env.STATE_MEASUREMENTS_DATABASE_URL = 'postgres://nobody@127.0.0.1:1/none';
process.env.STATE_MEASUREMENTS_ORIGIN = 'https://lab.example';
process.env.STATE_MEASUREMENTS_RATE_SECRET = 'x'.repeat(32);
// A variable specifier keeps this untyped JavaScript module out of the strict type graph.
const modulePath = '../api/measurements.mjs';
const { default: handler } = await import(modulePath);

async function post(requestBody: () => unknown) {
  const headers = { origin: 'https://lab.example', 'content-type': 'application/json' };
  const request = {
    method: 'POST',
    headers,
    url: '/api/measurements',
    socket: { remoteAddress: '127.0.0.1' },
    get body() {
      return requestBody();
    },
  };
  let status = 0;
  const response = {
    statusCode: 0,
    setHeader() {},
    end() {
      status = this.statusCode;
    },
  };
  await handler(request, response);
  return status;
}

// Vercel's lazy body getter throws an error carrying `statusCode`, not `status`.
const invalidJson = await post(() => {
  throw Object.assign(new Error('Invalid JSON'), { statusCode: 400 });
});
assert.equal(invalidJson, 400, 'Client JSON errors from the hosting body parser must stay 4xx, not 503');
console.log('PASS: hosted measurement function maps body-parser client errors to 400');
process.exit(0);
