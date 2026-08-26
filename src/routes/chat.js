'use strict';

const { executeGeminiRequest } = require('../providers/vertex-gemini');

module.exports = (router) => {
  const handleChatCompletions = async (req, res) => {
    const requestBody = req.body || {};
    try {
      const { responsePayload } = await executeGeminiRequest(requestBody, {
        allowStream: false,
      });

      const messageOutput = responsePayload.output?.find((item) => item.type === 'message');
      const text = messageOutput?.content?.[0]?.text || responsePayload.output_text || '';

      const choice = {
        index: 0,
        message: {
          role: 'assistant',
          content: text,
        },
        finish_reason: 'stop',
      };

      const toolCalls = responsePayload.output
        ?.filter((item) => item.type === 'function_call')
        ?.map((item, idx) => ({
          id: item.call_id || item.id,
          type: 'function',
          index: idx,
          function: {
            name: item.name,
            arguments: item.arguments,
          },
        }));

      if (toolCalls && toolCalls.length > 0) {
        choice.message.tool_calls = toolCalls;
        choice.finish_reason = 'tool_calls';
      }

      res.json({
        id: responsePayload.id,
        object: 'chat.completion',
        created: responsePayload.created_at || Math.floor(Date.now() / 1000),
        model: responsePayload.model,
        choices: [choice],
        usage: {
          prompt_tokens: responsePayload.usage?.input_tokens || 0,
          completion_tokens: responsePayload.usage?.output_tokens || 0,
          total_tokens: responsePayload.usage?.total_tokens || 0,
        },
      });
    } catch (error) {
      res.status(error.statusCode || 500).json({
        error: {
          message: error.message || 'Chat completion request failed',
          type: error.statusCode === 400 ? 'invalid_request_error' : 'api_error',
        },
      });
    }
  };

  router.post('/v1/chat/completions', handleChatCompletions);
  router.post('/openai/v1/chat/completions', handleChatCompletions);
};
