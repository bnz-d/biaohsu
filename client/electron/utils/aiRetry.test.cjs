const test = require('node:test');
const assert = require('node:assert/strict');
const {
  getAiRetryDelayMs,
  isRetryableAiRequestError,
} = require('./aiRetry.cjs');

test('TPM 限流即使被代理包装为 400 也会降速重试', () => {
  const error = new Error('OpenAIException - request rate exceeds the current model TPM limit');
  error.status = 400;
  error.aiRequestRetryable = false;
  assert.equal(isRetryableAiRequestError(error), true);
  assert.equal(getAiRetryDelayMs(1, error), 20000);
  assert.equal(getAiRetryDelayMs(2, error), 45000);
});

test('普通临时错误仍使用短重试间隔', () => {
  const error = new Error('temporary unavailable');
  error.status = 503;
  assert.equal(isRetryableAiRequestError(error), true);
  assert.equal(getAiRetryDelayMs(1, error), 3000);
});
