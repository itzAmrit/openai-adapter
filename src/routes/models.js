'use strict';

const config = require('../config');

const buildModelMetadata = (id, displayName) => ({
  id,
  object: 'model',
  created: 1700000000,
  owned_by: 'google',
  name: displayName,
  description: `${displayName} (Google Vertex AI)`,
  max_output_tokens: {
    default: 8192,
    limit: 10000,
  },
  supports_parallel_tool_calls: false,
  supports_image_detail_original: true,
  context_window: 1048576,
  max_context_window: 1048576,
  effective_context_window_percent: 95,
  input_modalities: ['text', 'image'],
  supports_search_tool: false,
  use_responses_lite: false,
});

module.exports = (router) => {
  const handleModels = (_req, res) => {
    const models = [
      buildModelMetadata(config.vertex.model, config.vertex.model),
      ...config.vertex.fallbackModels.map((m) => buildModelMetadata(m, m)),
      buildModelMetadata('gpt-5', 'GPT-5 (Vertex AI Gemini)'),
      buildModelMetadata('gpt-4o', 'GPT-4o (Vertex AI Gemini)'),
    ];

    res.json({
      object: 'list',
      data: models,
    });
  };

  router.get('/v1/models', handleModels);
  router.get('/openai/v1/models', handleModels);
};
