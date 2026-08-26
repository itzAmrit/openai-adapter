'use strict';

const assert = require('node:assert/strict');
const VertexGemini = require('../src/providers/vertex-gemini');
const { buildFailureEvents } = require('../src/utils/sse');

describe('OpenAI Responses and Gemini compatibility', () => {
  it('builds a unique ordered model fallback chain', () => {
    assert.deepEqual(
      VertexGemini.buildModelCandidates('gemini-3.7-flash', [
        'google/gemini-3.5-flash',
        'gemini-3.7-flash',
        'gemini-3.5-flash-lite',
      ]),
      ['gemini-3.7-flash', 'gemini-3.5-flash', 'gemini-3.5-flash-lite']
    );
  });

  it('overrides runtime model instruction with the serving model', () => {
    const body = VertexGemini.withRuntimeModelInstruction({
      systemInstruction: {
        parts: [{ text: 'You are Codex, a coding agent based on GPT-5.' }],
      },
    }, 'gemini-3.5-flash');

    assert.match(body.systemInstruction.parts.at(-1).text, /gemini-3\.5-flash/);
    assert.match(body.systemInstruction.parts.at(-1).text, /not GPT-5/);
  });

  it('maps ordered text and base64 image inputs to Gemini parts', async () => {
    const parts = await VertexGemini.normalizeGeminiContentParts([
      { type: 'input_text', text: 'Analyze this image.' },
      { type: 'input_image', image_url: 'data:image/png;base64,aGVsbG8=' },
    ], 'user');

    assert.deepEqual(parts, [
      { text: 'Analyze this image.' },
      { inlineData: { mimeType: 'image/png', data: 'aGVsbG8=' } },
    ]);
  });

  it('rejects unsupported file_id inputs safely', async () => {
    await assert.rejects(
      VertexGemini.normalizeGeminiContentParts([
        { type: 'input_image', file_id: 'file_123' },
      ], 'user'),
      /file_id inputs are not supported/
    );
  });

  it('adds latest user text when translated Gemini conversation ends with a model turn', () => {
    const contents = [
      { role: 'user', parts: [{ text: 'Hello' }] },
      { role: 'model', parts: [{ functionCall: { name: 'exec', args: {} } }] },
    ];

    VertexGemini.ensureUserFinalTurn(contents, {
      input: [{ type: 'message', role: 'user', content: 'Hello' }],
    });

    assert.deepEqual(contents.at(-1), {
      role: 'user',
      parts: [{ text: 'Hello' }],
    });
  });

  it('leaves conversation ending with a user turn untouched', () => {
    const contents = [{ role: 'user', parts: [{ text: 'continue' }] }];
    VertexGemini.ensureUserFinalTurn(contents, {});
    assert.equal(contents.length, 1);
  });

  it('emits response.failed events on upstream failure', () => {
    const events = buildFailureEvents({
      requestModel: 'gemini-3.7-flash',
      error: new Error('quota exhausted'),
    });

    assert.deepEqual(events.map((item) => item.event), [
      'response.created',
      'response.failed',
    ]);
    assert.equal(events[1].data.type, 'response.failed');
    assert.equal(events[1].data.response.status, 'failed');
    assert.equal(events[1].data.response.error.message, 'quota exhausted');
  });

  it('caches and preserves thought signatures across function call turns', async () => {
    const sampleUpstreamResponse = {
      responseId: 'resp_test_999',
      candidates: [
        {
          content: {
            parts: [
              {
                functionCall: { name: 'exec_command', args: { cmd: 'ls' } },
                thoughtSignature: 'sig_secret_token_abc',
              },
            ],
          },
        },
      ],
    };

    const responsesPayload = VertexGemini.mapGenerateContentToResponses({
      upstreamResponse: sampleUpstreamResponse,
      normalizedModel: 'gemini-3.7-flash',
      requestTools: [{ name: 'exec_command', type: 'function' }],
    });

    assert.equal(responsesPayload.output.length, 1);
    const callId = responsesPayload.output[0].call_id;

    const mapped = await VertexGemini.mapRequestToGenerateContent({
      model: 'gemini-3.7-flash',
      input: [{ type: 'function_call', call_id: callId, name: 'exec_command', arguments: '{"cmd":"ls"}' }],
    });

    assert.equal(mapped.upstreamBody.contents[0].parts[0].thoughtSignature, 'sig_secret_token_abc');
  });
});
