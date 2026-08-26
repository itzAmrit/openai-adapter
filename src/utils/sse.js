'use strict';

const writeSseEvent = (res, event, data) => {
  res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  if (typeof res.flush === 'function') {
    res.flush();
  }
};

const streamResponsePayload = (res, payload) => {
  const responseId = payload.id;
  const createdAt = payload.created_at || Math.floor(Date.now() / 1000);
  const model = payload.model;

  writeSseEvent(res, 'response.created', {
    type: 'response.created',
    response: {
      id: responseId,
      object: 'response',
      created_at: createdAt,
      status: 'in_progress',
      model,
      output: [],
      usage: null,
    },
  });

  const outputItems = payload.output || [];
  for (const [outputIndex, outputItem] of outputItems.entries()) {
    writeSseEvent(res, 'response.output_item.added', {
      type: 'response.output_item.added',
      output_index: outputIndex,
      item: {
        id: outputItem.id,
        type: outputItem.type,
        status: 'in_progress',
        role: outputItem.role,
        name: outputItem.name,
        arguments: outputItem.type === 'function_call' ? '' : undefined,
        input: outputItem.type === 'custom_tool_call' ? '' : undefined,
        content: outputItem.type === 'message' ? [] : undefined,
      },
    });

    if (outputItem.type === 'message') {
      const contents = outputItem.content || [];
      for (const [contentIndex, contentItem] of contents.entries()) {
        writeSseEvent(res, 'response.content_part.added', {
          type: 'response.content_part.added',
          output_index: outputIndex,
          content_index: contentIndex,
          part: {
            type: contentItem.type,
            text: '',
            annotations: [],
          },
        });

        if (contentItem.text) {
          writeSseEvent(res, 'response.output_text.delta', {
            type: 'response.output_text.delta',
            output_index: outputIndex,
            content_index: contentIndex,
            delta: contentItem.text,
          });

          writeSseEvent(res, 'response.output_text.done', {
            type: 'response.output_text.done',
            output_index: outputIndex,
            content_index: contentIndex,
            text: contentItem.text,
          });
        }

        writeSseEvent(res, 'response.content_part.done', {
          type: 'response.content_part.done',
          output_index: outputIndex,
          content_index: contentIndex,
          part: contentItem,
        });
      }
    } else if (outputItem.type === 'function_call') {
      if (outputItem.arguments) {
        writeSseEvent(res, 'response.function_call_arguments.delta', {
          type: 'response.function_call_arguments.delta',
          output_index: outputIndex,
          item_id: outputItem.id,
          call_id: outputItem.call_id,
          delta: outputItem.arguments,
        });
      }
      writeSseEvent(res, 'response.function_call_arguments.done', {
        type: 'response.function_call_arguments.done',
        output_index: outputIndex,
        item_id: outputItem.id,
        call_id: outputItem.call_id,
        arguments: outputItem.arguments,
      });
    }

    writeSseEvent(res, 'response.output_item.done', {
      type: 'response.output_item.done',
      output_index: outputIndex,
      item: outputItem,
    });
  }

  writeSseEvent(res, 'response.completed', {
    type: 'response.completed',
    response: {
      ...payload,
      status: 'completed',
    },
  });
};

const buildFailureEvents = ({ requestModel, error }) => {
  const responseId = `resp_${Date.now()}_err`;
  const createdAt = Math.floor(Date.now() / 1000);
  const failurePayload = {
    id: responseId,
    object: 'response',
    created_at: createdAt,
    status: 'failed',
    model: requestModel || 'gemini-3.7-flash',
    output: [],
    error: {
      code: 'upstream_failure',
      message: error.message || 'Gemini upstream request failed.',
    },
  };

  return [
    {
      event: 'response.created',
      data: {
        type: 'response.created',
        response: {
          id: responseId,
          object: 'response',
          created_at: createdAt,
          status: 'in_progress',
          model: requestModel || 'gemini-3.7-flash',
          output: [],
        },
      },
    },
    {
      event: 'response.failed',
      data: {
        type: 'response.failed',
        response: failurePayload,
      },
    },
  ];
};

module.exports = {
  writeSseEvent,
  streamResponsePayload,
  buildFailureEvents,
};
