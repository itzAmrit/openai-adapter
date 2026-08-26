'use strict';

const express = require('express');
const config = require('./config');
const registerResponses = require('./routes/responses');
const registerChat = require('./routes/chat');
const registerModels = require('./routes/models');

const app = express();
app.use(express.json({ limit: '25mb' }));

// Health check endpoint
app.get('/health', (_req, res) => {
  res.json({
    ok: true,
    provider: 'vertex-gemini',
    project: config.vertex.project,
    location: config.vertex.location,
    model: config.vertex.model,
    fallbackModels: config.vertex.fallbackModels,
  });
});

registerResponses(app);
registerChat(app);
registerModels(app);

// 404 handler
app.use((req, res) => {
  res.status(404).json({
    error: {
      message: `Endpoint ${req.method} ${req.path} not found`,
      type: 'invalid_request_error',
    },
  });
});

if (require.main === module) {
  app.listen(config.port, config.host, () => {
    process.stdout.write(`OpenAI Adapter listening on http://${config.host}:${config.port}\n`);
  });
}

module.exports = app;
