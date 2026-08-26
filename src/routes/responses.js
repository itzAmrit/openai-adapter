'use strict';

const { executeGeminiRequest } = require('../providers/vertex-gemini');
const { streamResponsePayload, buildFailureEvents, writeSseEvent } = require('../utils/sse');

const isStreamingRequest = (body = {}) => (
  body?.stream === true
  || body?.stream === 'true'
  || body?.response_mode === 'stream'
);

module.exports = (router) => {
  const handleResponses = async (req, res) => {
    const requestBody = req.body || {};
    const acceptsSse = String(req.headers.accept || '').includes('text/event-stream');
    const isStream = isStreamingRequest(requestBody) || acceptsSse;

    try {
      const { responsePayload } = await executeGeminiRequest(requestBody, {
        allowStream: isStream,
      });

      if (!isStream) {
        return res.json(responsePayload);
      }

      res.status(200);
      res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
      res.setHeader('Cache-Control', 'no-cache, no-transform');
      res.setHeader('Connection', 'keep-alive');
      res.setHeader('X-Accel-Buffering', 'no');
      if (typeof res.flushHeaders === 'function') {
        res.flushHeaders();
      }

      streamResponsePayload(res, responsePayload);
      return res.end();
    } catch (error) {
      if (isStream && !res.headersSent) {
        res.status(200);
        res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
        res.setHeader('Cache-Control', 'no-cache, no-transform');
        res.setHeader('Connection', 'keep-alive');
        res.setHeader('X-Accel-Buffering', 'no');
        if (typeof res.flushHeaders === 'function') {
          res.flushHeaders();
        }

        const events = buildFailureEvents({
          requestModel: requestBody.model,
          error,
        });
        for (const { event, data } of events) {
          writeSseEvent(res, event, data);
        }
        return res.end();
      }

      if (!res.headersSent) {
        return res.status(error.statusCode || 500).json({
          error: {
            message: error.message || 'Upstream request failed',
            type: error.statusCode === 400 ? 'invalid_request_error' : 'api_error',
          },
        });
      }
      return res.end();
    }
  };

  router.post('/v1/responses', handleResponses);
  router.post('/openai/v1/responses', handleResponses);
};
