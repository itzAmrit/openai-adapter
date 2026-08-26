'use strict';

const axios = require('axios');
const dns = require('node:dns').promises;
const https = require('node:https');
const net = require('node:net');
const config = require('../config');
const { getAccessToken } = require('../auth/gcloud');
const {
  cacheFunctionCallContext,
  getFunctionCallContext,
} = require('../utils/function-cache');

const MAX_INLINE_IMAGE_BYTES = 20 * 1024 * 1024;
const SUPPORTED_ALIASES = ['gemini', 'gemini-3.5-flash', 'google/gemini-3.5-flash', 'gpt-5', 'gpt-4o'];

const toNativeGeminiModel = (value) => String(value || '').trim().replace(/^google\//, '');

const unsupported = (message) => {
  const error = new Error(message);
  error.statusCode = 400;
  return error;
};

const normalizeModel = (value) => {
  const raw = String(value || '').trim();
  if (!raw || SUPPORTED_ALIASES.includes(raw)) {
    return config.vertex.model;
  }
  return toNativeGeminiModel(raw);
};

const buildModelCandidates = (primaryModel, fallbackModels = []) => (
  [...new Set([primaryModel, ...(fallbackModels || config.vertex.fallbackModels)].map(toNativeGeminiModel).filter(Boolean))]
);

const normalizeContentParts = (content, role) => {
  if (typeof content === 'string') {
    const text = content.trim();
    if (!text) throw unsupported(`Conversation message content is required for role '${role}'.`);
    return text;
  }
  if (!Array.isArray(content)) {
    throw unsupported(`Unsupported content shape for role '${role}'.`);
  }

  const parts = [];
  for (const item of content) {
    if (typeof item === 'string') {
      if (item.trim()) parts.push(item.trim());
      continue;
    }
    if (!item || typeof item !== 'object') {
      throw unsupported(`Unsupported content item for role '${role}'.`);
    }
    if (item.type === 'input_text' || item.type === 'output_text' || item.type === 'text') {
      if (typeof item.text === 'string' && item.text.trim()) {
        parts.push(item.text.trim());
      }
      continue;
    }
    if (item.type === 'input_image') {
      parts.push('[Image input]');
      continue;
    }
    throw unsupported(`Unsupported content item type '${item.type}' for role '${role}'.`);
  }

  return parts.join('\n').trim();
};

const normalizeImageUrl = (item) => {
  const imageUrl = typeof item.image_url === 'string'
    ? item.image_url
    : item.image_url?.url;

  if (!imageUrl && item.file_id) {
    throw unsupported('Image file_id inputs are not supported; send an image_url or base64 data URL.');
  }
  if (typeof imageUrl !== 'string' || !imageUrl.trim()) {
    throw unsupported('Image input requires image_url.');
  }
  return imageUrl.trim();
};

const isPrivateAddress = (address) => {
  if (net.isIPv4(address)) {
    const octets = address.split('.').map(Number);
    return octets[0] === 0
      || octets[0] === 10
      || octets[0] === 127
      || (octets[0] === 169 && octets[1] === 254)
      || (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31)
      || (octets[0] === 192 && octets[1] === 168)
      || octets[0] >= 224;
  }
  if (net.isIPv6(address)) {
    const normalized = address.toLowerCase();
    return normalized === '::'
      || normalized === '::1'
      || normalized.startsWith('fc')
      || normalized.startsWith('fd')
      || /^fe[89ab]/.test(normalized)
      || normalized.startsWith('ff');
  }
  return true;
};

const downloadRemoteImage = async (parsedUrl) => {
  const addresses = await dns.lookup(parsedUrl.hostname, { all: true, verbatim: true });
  if (!addresses.length || addresses.some(({ address }) => isPrivateAddress(address))) {
    throw unsupported('Remote image URL resolves to a private or unsupported address.');
  }

  const selected = addresses[0];
  const httpsAgent = new https.Agent({
    lookup: (_hostname, _options, callback) => callback(null, selected.address, selected.family),
  });
  let response;
  try {
    response = await axios.get(parsedUrl.toString(), {
      responseType: 'arraybuffer',
      timeout: 30000,
      maxRedirects: 0,
      maxContentLength: MAX_INLINE_IMAGE_BYTES,
      maxBodyLength: MAX_INLINE_IMAGE_BYTES,
      httpsAgent,
      headers: { Accept: 'image/*' },
    });
  } catch (error) {
    if (error.statusCode) throw error;
    throw unsupported(`Unable to download remote image: ${error.message}`);
  }

  const mimeType = String(response.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
  if (!mimeType.startsWith('image/')) {
    throw unsupported(`Remote image returned unsupported MIME type '${mimeType || 'unknown'}'.`);
  }
  const data = Buffer.from(response.data);
  if (!data.length || data.length > MAX_INLINE_IMAGE_BYTES) {
    throw unsupported(`Remote image must be between 1 byte and ${MAX_INLINE_IMAGE_BYTES} bytes.`);
  }
  return { inlineData: { mimeType, data: data.toString('base64') } };
};

const imageUrlToGeminiPart = async (item) => {
  const imageUrl = normalizeImageUrl(item);
  const dataMatch = imageUrl.match(/^data:([^;,]+);base64,([A-Za-z0-9+/=\s]+)$/i);
  if (dataMatch) {
    const mimeType = dataMatch[1].toLowerCase();
    if (!mimeType.startsWith('image/')) {
      throw unsupported(`Unsupported image MIME type '${mimeType}'.`);
    }

    const data = dataMatch[2].replace(/\s/g, '');
    const byteLength = Buffer.byteLength(data, 'base64');
    if (!byteLength || byteLength > MAX_INLINE_IMAGE_BYTES) {
      throw unsupported(`Inline image must be between 1 byte and ${MAX_INLINE_IMAGE_BYTES} bytes.`);
    }
    return { inlineData: { mimeType, data } };
  }

  let parsedUrl;
  try {
    parsedUrl = new URL(imageUrl);
  } catch (_err) {
    throw unsupported('Image URL must be an HTTPS URL or a base64 data URL.');
  }
  if (parsedUrl.protocol !== 'https:') {
    throw unsupported('Remote image URL must use HTTPS.');
  }

  return downloadRemoteImage(parsedUrl);
};

const normalizeGeminiContentParts = async (content, role) => {
  if (typeof content === 'string') {
    const text = content.trim();
    if (!text) throw unsupported(`Conversation message content is required for role '${role}'.`);
    return [{ text }];
  }
  if (!Array.isArray(content)) {
    throw unsupported(`Unsupported content shape for role '${role}'.`);
  }

  const parts = [];
  for (const item of content) {
    if (typeof item === 'string') {
      if (item.trim()) parts.push({ text: item.trim() });
      continue;
    }
    if (!item || typeof item !== 'object') {
      throw unsupported(`Unsupported content item for role '${role}'.`);
    }
    if (item.type === 'input_text' || item.type === 'output_text' || item.type === 'text') {
      if (typeof item.text === 'string' && item.text.trim()) {
        parts.push({ text: item.text.trim() });
      }
      continue;
    }
    if (item.type === 'input_image') {
      if (role !== 'user') throw unsupported('Image inputs are only supported in user messages.');
      parts.push(await imageUrlToGeminiPart(item));
      continue;
    }
    throw unsupported(`Unsupported content item type '${item.type}' for role '${role}'.`);
  }

  if (!parts.length) throw unsupported(`Conversation message content is required for role '${role}'.`);
  return parts;
};

const mapRoleToGeminiRole = (role) => {
  if (role === 'user') return 'user';
  if (role === 'assistant') return 'model';
  throw unsupported(`Unsupported conversation role '${role}'.`);
};

const parseToolArguments = (value, _toolName) => {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value;
  }
  if (typeof value !== 'string' || !value.trim()) {
    return {};
  }
  try {
    const parsed = JSON.parse(value);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed;
    }
  } catch (_e) {
    // Fall through
  }
  return { input: value };
};

const appendGeminiContent = (contents, role, part) => {
  const last = contents[contents.length - 1];
  if (last?.role === role) {
    last.parts.push(part);
    return;
  }
  contents.push({ role, parts: [part] });
};

const findLastUserText = (body) => {
  const items = [];
  if (Array.isArray(body.messages)) items.push(...body.messages);
  if (typeof body.input === 'string') {
    return body.input.trim();
  }
  if (Array.isArray(body.input)) items.push(...body.input);

  for (let index = items.length - 1; index >= 0; index -= 1) {
    const item = items[index];
    if ((item?.type === 'message' || item?.role) && item.role === 'user') {
      return normalizeContentParts(item.content, item.role);
    }
  }
  return '';
};

const ensureUserFinalTurn = (contents, body) => {
  if (!contents.length || contents[contents.length - 1].role === 'user') return contents;

  const lastUserText = findLastUserText(body);
  contents.push({
    role: 'user',
    parts: [{
      text: lastUserText || 'Continue from the preceding context and provide the final response.',
    }],
  });
  return contents;
};

const mapConversationToGemini = async (body, systemInstructionParts) => {
  const contents = [];
  const callContexts = new Map();
  const items = [];

  if (Array.isArray(body.messages)) {
    items.push(...body.messages);
  }
  if (typeof body.input === 'string') {
    if (!body.input.trim()) throw unsupported('Input text must not be empty.');
    items.push({ type: 'message', role: 'user', content: body.input });
  } else if (Array.isArray(body.input)) {
    items.push(...body.input);
  } else if (body.input != null) {
    throw unsupported('Unsupported Responses input shape.');
  }

  for (const item of items) {
    if (item?.type === 'message' || item?.role) {
      const role = String(item.role || '').trim();
      if (role === 'system' || role === 'developer') {
        systemInstructionParts.push(normalizeContentParts(item.content, role));
        continue;
      }
      const geminiRole = mapRoleToGeminiRole(role);
      for (const part of await normalizeGeminiContentParts(item.content, role)) {
        appendGeminiContent(contents, geminiRole, part);
      }
      continue;
    }

    if (item?.type === 'function_call' || item?.type === 'custom_tool_call') {
      const name = String(item.name || '').trim();
      if (!name) throw unsupported('Tool call name is required.');
      const lookupKey = item.call_id || item.id;
      const cachedPart = lookupKey ? getFunctionCallContext(lookupKey) : null;
      const args = item.type === 'custom_tool_call'
        ? { input: typeof item.input === 'string' ? item.input : JSON.stringify(item.input ?? '') }
        : parseToolArguments(item.arguments, name);
      const functionCallPart = cachedPart || { functionCall: { name, args } };
      if (lookupKey) {
        callContexts.set(lookupKey, {
          name,
          functionCallId: functionCallPart.functionCall?.id || null,
        });
      }
      if (item.call_id && item.call_id !== lookupKey) {
        callContexts.set(item.call_id, {
          name,
          functionCallId: functionCallPart.functionCall?.id || null,
        });
      }
      appendGeminiContent(contents, 'model', functionCallPart);
      continue;
    }

    if (item?.type === 'function_call_output' || item?.type === 'custom_tool_call_output') {
      const lookupKey = item.call_id || item.id;
      const callContext = lookupKey ? callContexts.get(lookupKey) : null;
      if (!callContext) throw unsupported(`Tool output references unknown call_id '${item.call_id || item.id || ''}'.`);
      const output = typeof item.output === 'string' ? item.output : JSON.stringify(item.output ?? '');
      appendGeminiContent(contents, 'user', {
        functionResponse: {
          name: callContext.name,
          ...(callContext.functionCallId ? { id: callContext.functionCallId } : {}),
          response: { output },
        },
      });
      continue;
    }

    throw unsupported(`Unsupported input item type '${item?.type || typeof item}'.`);
  }

  return ensureUserFinalTurn(contents, body);
};

const sanitizeGeminiSchema = (value) => {
  if (Array.isArray(value)) {
    return value.map((item) => sanitizeGeminiSchema(item));
  }
  if (!value || typeof value !== 'object') {
    return value;
  }
  const sanitized = {};
  for (const [propKey, propVal] of Object.entries(value)) {
    if (['default', '$schema', 'additionalProperties'].includes(propKey)) continue;
    if (propKey === 'type' && typeof propVal === 'string') {
      sanitized[propKey] = propVal.toUpperCase();
      continue;
    }
    sanitized[propKey] = sanitizeGeminiSchema(propVal);
  }
  return sanitized;
};

const mapToolsToGemini = (tools) => {
  if (!Array.isArray(tools) || !tools.length) return [];
  const functionDeclarations = tools
    .filter((tool) => tool?.type === 'function' || tool?.type === 'custom')
    .map((tool) => ({
      name: tool.name || tool.function?.name,
      description: tool.description || tool.function?.description || '',
      parameters: tool.type === 'custom'
        ? {
          type: 'OBJECT',
          properties: { input: { type: 'STRING' } },
          required: ['input'],
        }
        : sanitizeGeminiSchema(tool.parameters || tool.function?.parameters || { type: 'object', properties: {} }),
    }));

  return functionDeclarations.length ? [{ functionDeclarations }] : [];
};

const mapRequestToGenerateContent = async (body, _options = {}) => {
  const systemInstructionParts = [];
  if (typeof body.instructions === 'string' && body.instructions.trim()) {
    systemInstructionParts.push(body.instructions.trim());
  }

  const conversationMessages = await mapConversationToGemini(body, systemInstructionParts);

  if (!conversationMessages.length) {
    throw unsupported('At least one user or assistant message is required.');
  }

  const upstreamBody = {
    contents: conversationMessages,
  };

  if (systemInstructionParts.length) {
    upstreamBody.systemInstruction = {
      parts: [{ text: systemInstructionParts.join('\n\n') }],
    };
  }

  const generationConfig = {};
  if (typeof body.temperature === 'number') {
    generationConfig.temperature = body.temperature;
  }
  if (typeof body.max_output_tokens === 'number' || typeof body.max_tokens === 'number') {
    generationConfig.maxOutputTokens = body.max_output_tokens || body.max_tokens;
  }
  if (Object.keys(generationConfig).length) {
    upstreamBody.generationConfig = generationConfig;
  }

  const tools = mapToolsToGemini(body.tools);
  if (tools.length) {
    upstreamBody.tools = tools;
  }

  return { upstreamBody };
};

const mapGenerateContentToResponses = ({ upstreamResponse, normalizedModel, requestTools = [] }) => {
  const responseId = `resp_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
  const createdAt = Math.floor(Date.now() / 1000);
  const toolTypes = new Map(
    (requestTools || []).map((tool) => [tool.name || tool.function?.name, tool.type])
  );

  const output = [];
  const usage = upstreamResponse.usageMetadata || {};

  const candidate = upstreamResponse.candidates?.[0];
  const parts = candidate?.content?.parts || [];

  const textParts = parts.filter((part) => typeof part?.text === 'string');
  const outputText = textParts.map((part) => part.text).join('');

  if (outputText.length > 0 || !parts.some((p) => p.functionCall)) {
    output.push({
      id: `${responseId}_message`,
      type: 'message',
      status: 'completed',
      role: 'assistant',
      content: [
        {
          type: 'output_text',
          text: outputText,
          annotations: [],
        },
      ],
    });
  }

  for (const [index, part] of parts.entries()) {
    const functionCall = part?.functionCall;
    if (!functionCall?.name) continue;
    const itemId = `${responseId}_call_${index}`;
    const callId = `call_${responseId}_${index}`;
    cacheFunctionCallContext(callId, part);
    cacheFunctionCallContext(itemId, part);
    if (toolTypes.get(functionCall.name) === 'custom') {
      const input = typeof functionCall.args?.input === 'string'
        ? functionCall.args.input
        : JSON.stringify(functionCall.args || {});
      output.push({
        id: itemId,
        type: 'custom_tool_call',
        status: 'completed',
        call_id: callId,
        name: functionCall.name,
        input,
      });
      continue;
    }
    output.push({
      id: itemId,
      type: 'function_call',
      status: 'completed',
      call_id: callId,
      name: functionCall.name,
      arguments: JSON.stringify(functionCall.args || {}),
    });
  }

  return {
    id: responseId,
    object: 'response',
    created_at: createdAt,
    status: 'completed',
    model: normalizedModel,
    output,
    output_text: outputText,
    text: outputText,
    completed_at: createdAt,
    usage: {
      input_tokens: usage.promptTokenCount ?? null,
      output_tokens: usage.candidatesTokenCount ?? null,
      total_tokens: usage.totalTokenCount ?? null,
    },
  };
};

const withRuntimeModelInstruction = (upstreamBody, model) => ({
  ...upstreamBody,
  systemInstruction: {
    parts: [
      ...(upstreamBody.systemInstruction?.parts || []),
      {
        text: `Runtime identity: You are operating inside the Codex client, but the model serving this request is '${model}' through Vertex AI, not GPT-5. When asked which model you are, report this exact serving model.`,
      },
    ],
  },
});

const buildVertexHost = (location) => (
  location === 'global' ? 'aiplatform.googleapis.com' : `${location}-aiplatform.googleapis.com`
);

const buildVertexUpstreamUrl = ({ location, project, model, apiKey }) => {
  if (apiKey) {
    return `https://${buildVertexHost(location)}/v1beta1/projects/${project}/locations/${location}/publishers/google/models/${model}:generateContent?key=${apiKey}`;
  }
  return `https://${buildVertexHost(location)}/v1beta1/projects/${project}/locations/${location}/publishers/google/models/${model}:generateContent`;
};

const shouldRetryTransientUpstreamError = (error) => {
  const status = error?.response?.status || error?.statusCode || null;
  const upstreamStatus = error?.response?.data?.error?.status || '';
  return status === 429
    || status === 500
    || status === 503
    || status === 504
    || upstreamStatus === 'RESOURCE_EXHAUSTED'
    || upstreamStatus === 'UNAVAILABLE'
    || upstreamStatus === 'INTERNAL';
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const callVertexGenerateContent = async ({
  location,
  project,
  model,
  apiKey,
  upstreamBody,
  token,
}) => {
  const upstreamUrl = buildVertexUpstreamUrl({ location, project, model, apiKey });
  const modelAwareUpstreamBody = withRuntimeModelInstruction(upstreamBody, model);

  const headers = {
    'Content-Type': 'application/json',
  };
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  return axios.post(upstreamUrl, modelAwareUpstreamBody, {
    headers,
    timeout: 1200000,
  });
};

const executeGeminiRequest = async (requestBody, options = {}) => {
  const project = config.vertex.project;
  const location = config.vertex.location;
  const apiKey = config.vertex.apiKey;
  const primaryModel = normalizeModel(requestBody.model);
  const modelCandidates = buildModelCandidates(primaryModel, config.vertex.fallbackModels);

  let token = null;
  if (!apiKey) {
    token = await getAccessToken(false);
  }

  const { upstreamBody } = await mapRequestToGenerateContent(requestBody, options);

  let response;
  let responseModel = primaryModel;
  const maxTransientAttemptsPerModel = 2;

  for (const [modelIndex, candidateModel] of modelCandidates.entries()) {
    for (let attempt = 1; attempt <= maxTransientAttemptsPerModel; attempt += 1) {
      try {
        response = await callVertexGenerateContent({
          location,
          project,
          model: candidateModel,
          apiKey,
          upstreamBody,
          token,
        });
        responseModel = candidateModel;
        break;
      } catch (error) {
        // If auth error 401, refresh token once
        if (error.response?.status === 401 && !apiKey) {
          try {
            token = await getAccessToken(true);
            response = await callVertexGenerateContent({
              location,
              project,
              model: candidateModel,
              apiKey,
              upstreamBody,
              token,
            });
            responseModel = candidateModel;
            break;
          } catch (retryError) {
            error = retryError;
          }
        }

        const isTransient = shouldRetryTransientUpstreamError(error);
        const isUnavailable = error?.response?.status === 404;
        const isModelSpecificError = error?.response?.status === 400;
        const hasFallback = modelIndex < modelCandidates.length - 1;

        if (
          (!isTransient && !isUnavailable && !isModelSpecificError)
          || (!hasFallback && (isUnavailable || isModelSpecificError || attempt >= maxTransientAttemptsPerModel))
        ) {
          throw error;
        }

        if (isUnavailable || isModelSpecificError || attempt >= maxTransientAttemptsPerModel) {
          if (config.debug) {
            console.warn('[openai-adapter] switching fallback model', {
              failedModel: candidateModel,
              nextModel: modelCandidates[modelIndex + 1],
              status: error?.response?.status || null,
              message: error?.response?.data?.error?.message || error.message,
            });
          }
          break;
        }

        await sleep(1000);
      }
    }
    if (response) break;
  }

  if (!response) {
    throw new Error('All model candidates failed.');
  }

  const responsePayload = mapGenerateContentToResponses({
    upstreamResponse: response.data,
    normalizedModel: responseModel,
    requestTools: requestBody.tools,
  });

  return {
    model: responseModel,
    upstreamResponse: response.data,
    responsePayload,
  };
};

module.exports = {
  executeGeminiRequest,
  mapRequestToGenerateContent,
  mapGenerateContentToResponses,
  mapConversationToGemini,
  ensureUserFinalTurn,
  buildModelCandidates,
  normalizeGeminiContentParts,
  normalizeModel,
  withRuntimeModelInstruction,
  shouldRetryTransientUpstreamError,
};
