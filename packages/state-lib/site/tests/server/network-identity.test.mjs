import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
async function api() {
  assert(existsSync(new URL('../../server/network-identity.mjs', import.meta.url)), 'Implement trusted transport identity');
  return import('../../server/network-identity.mjs');
}
test('an arbitrary forwarded header cannot select the visitor rate bucket', async () => {
  const { rateAddress } = await api();
  const request = {
    headers: { 'x-forwarded-for': 'spoof', 'x-vercel-forwarded-for': 'also-spoof' },
    socket: { remoteAddress: 'local-peer' },
  };
  assert.equal(rateAddress(request, false), 'local-peer');
  request.headers['x-forwarded-for'] = 'different';
  assert.equal(rateAddress(request, false), 'local-peer');
  assert.equal(rateAddress(request, true), 'also-spoof');
  delete request.headers['x-vercel-forwarded-for'];
  assert.equal(rateAddress(request, true), 'unknown');
});
