#!/usr/bin/env node
'use strict';

const app = require('../src/index');
const config = require('../src/config');

app.listen(config.port, config.host, () => {
  process.stdout.write(`OpenAI Adapter listening on http://${config.host}:${config.port}\n`);
});
