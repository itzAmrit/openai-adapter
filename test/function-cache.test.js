'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const {
  cacheFunctionCallContext,
  getFunctionCallContext,
  _test,
} = require('../src/utils/function-cache');

describe('Disk Persistent Function Call Cache', () => {
  it('stores and retrieves cached function call context by callId and itemId', () => {
    const callId = 'call_test_123';
    const itemId = 'resp_test_123_call_0';
    const samplePart = {
      functionCall: { name: 'exec_command', args: { cmd: 'pwd' } },
      thoughtSignature: 'sig_test_token',
    };

    cacheFunctionCallContext(callId, samplePart);
    cacheFunctionCallContext(itemId, samplePart);

    assert.deepEqual(getFunctionCallContext(callId), samplePart);
    assert.deepEqual(getFunctionCallContext(itemId), samplePart);
  });

  it('persists entries to disk JSON file', () => {
    assert.equal(fs.existsSync(_test.CACHE_FILE_PATH), true);
    const content = fs.readFileSync(_test.CACHE_FILE_PATH, 'utf8');
    const data = JSON.parse(content);
    assert.equal(typeof data, 'object');
    assert.ok(Object.keys(data).length > 0);
  });
});
