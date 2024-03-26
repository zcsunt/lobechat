import {
  BedrockRuntimeClient,
  InvokeModelWithResponseStreamCommand,
} from '@aws-sdk/client-bedrock-runtime';
import {
  AWSBedrockLlama2Stream,
  AWSBedrockStream,
  StreamingTextResponse
} from 'ai';
import { experimental_buildLlama2Prompt } from 'ai/prompts';

import { LobeRuntimeAI } from '../BaseAI';
import { AgentRuntimeErrorType } from '../error';
import {
  ChatCompetitionOptions,
  ChatStreamPayload,
  ModelProvider,
} from '../types';
import { AgentRuntimeError } from '../utils/createError';
import { debugStream } from '../utils/debugStream';
import { buildAnthropicMessages } from '../utils/anthropicHelpers';

export interface LobeBedrockAIParams {
  accessKeyId?: string;
  accessKeySecret?: string;
  region?: string;
}

export class LobeBedrockAI implements LobeRuntimeAI {
  private client: BedrockRuntimeClient;

  region: string;

  constructor({ region, accessKeyId, accessKeySecret }: LobeBedrockAIParams) {
    if (!(accessKeyId && accessKeySecret))
      throw AgentRuntimeError.createError(AgentRuntimeErrorType.InvalidBedrockCredentials);

    this.region = region ?? 'us-east-1';

    this.client = new BedrockRuntimeClient({
      credentials: {
        accessKeyId: accessKeyId,
        secretAccessKey: accessKeySecret,
      },
      region: this.region,
    });
  }

  async chat(payload: ChatStreamPayload, options?: ChatCompetitionOptions) {
    if (payload.model.startsWith('meta')) return this.invokeLlamaModel(payload);

    return this.invokeClaudeModel(payload, options);
  }

  private invokeClaudeModel = async (
    payload: ChatStreamPayload,
    options?: ChatCompetitionOptions
  ): Promise<StreamingTextResponse> => {
    const { max_tokens, messages, model, temperature, top_p } = payload;
    const system_message = messages.find((m) => m.role === 'system');
    const user_messages = messages.filter((m) => m.role !== 'system');

    const command = new InvokeModelWithResponseStreamCommand({
      accept: 'application/json',
      body: JSON.stringify({
        anthropic_version: "bedrock-2023-05-31",
        max_tokens: max_tokens || 4096,
        messages: buildAnthropicMessages(user_messages),
        system: system_message?.content as string,
        temperature: temperature,
        top_p: top_p,
      }),
      contentType: 'application/json',
      modelId: model,
    });

    try {
      // Ask Claude for a streaming chat completion given the prompt
      const bedrockResponse = await this.client.send(command);

      // Convert the response into a friendly text-stream
      const stream = AWSBedrockStream(bedrockResponse, options?.callback, (chunk) => chunk.delta?.text);

      const [debug, output] = stream.tee();

      if (process.env.DEBUG_BEDROCK_CHAT_COMPLETION === '1') {
        debugStream(debug).catch(console.error);
      }

      // Respond with the stream
      return new StreamingTextResponse(output);
    } catch (e) {
      const err = e as Error & { $metadata: any };

      throw AgentRuntimeError.chat({
        error: {
          body: err.$metadata,
          message: err.message,
          type: err.name,
        },
        errorType: AgentRuntimeErrorType.BedrockBizError,
        provider: ModelProvider.Bedrock,
        region: this.region,
      });
    }
  };

  private invokeLlamaModel = async (
    payload: ChatStreamPayload
  ): Promise<StreamingTextResponse> => {
    const { max_tokens, messages, model } = payload;
    const command = new InvokeModelWithResponseStreamCommand({
      accept: 'application/json',
      body: JSON.stringify({
        max_gen_len: max_tokens || 400,
        prompt: experimental_buildLlama2Prompt(messages as any),
      }),
      contentType: 'application/json',
      modelId: model,
    });

    try {
      // Ask Claude for a streaming chat completion given the prompt
      const bedrockResponse = await this.client.send(command);

      // Convert the response into a friendly text-stream
      const stream = AWSBedrockLlama2Stream(bedrockResponse);

      const [debug, output] = stream.tee();

      if (process.env.DEBUG_BEDROCK_CHAT_COMPLETION === '1') {
        debugStream(debug).catch(console.error);
      }
      // Respond with the stream
      return new StreamingTextResponse(output);
    } catch (e) {
      const err = e as Error & { $metadata: any };

      throw AgentRuntimeError.chat({
        error: {
          body: err.$metadata,
          message: err.message,
          region: this.region,
          type: err.name,
        },
        errorType: AgentRuntimeErrorType.BedrockBizError,
        provider: ModelProvider.Bedrock,
        region: this.region,
      });
    }
  };

}

export default LobeBedrockAI;
