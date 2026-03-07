"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.OpenRouterProvider = void 0;
const axios_1 = require("axios");
const base_provider_abstract_1 = require("./base-provider.abstract");
class OpenRouterProvider extends base_provider_abstract_1.BaseProvider {
    constructor(config) {
        super('openrouter', config);
        this.client = axios_1.default.create({
            baseURL: config.baseUrl || 'https://openrouter.ai/api/v1',
            timeout: config.timeout || 120000,
            headers: {
                'Authorization': `Bearer ${config.apiKey}`,
                'Content-Type': 'application/json',
                'HTTP-Referer': 'https://your-app.com',
                'X-Title': 'AI Aggregator',
            },
        });
    }
    async generateText(request) {
        const start = Date.now();
        try {
            const response = await this.client.post('/chat/completions', {
                model: request.model,
                messages: request.messages,
                max_tokens: request.maxTokens || 4096,
                temperature: request.temperature ?? 0.7,
                top_p: request.topP ?? 1,
                stream: false,
            });
            const data = response.data;
            return {
                success: true,
                data: {
                    content: data.choices[0]?.message?.content || '',
                    metadata: {
                        model: data.model,
                        finishReason: data.choices[0]?.finish_reason,
                    },
                },
                usage: {
                    inputTokens: data.usage?.prompt_tokens,
                    outputTokens: data.usage?.completion_tokens,
                    totalTokens: data.usage?.total_tokens,
                },
                responseTimeMs: Date.now() - start,
                providerSlug: this.slug,
            };
        }
        catch (error) {
            return this.handleError(error, start);
        }
    }
    async *generateTextStream(request) {
        try {
            const response = await this.client.post('/chat/completions', {
                model: request.model,
                messages: request.messages,
                max_tokens: request.maxTokens || 4096,
                temperature: request.temperature ?? 0.7,
                top_p: request.topP ?? 1,
                stream: true,
            }, {
                responseType: 'stream',
                timeout: 180000,
            });
            let buffer = '';
            const stream = response.data;
            for await (const chunk of stream) {
                buffer += chunk.toString();
                const lines = buffer.split('\n');
                buffer = lines.pop() || '';
                for (const line of lines) {
                    const trimmed = line.trim();
                    if (!trimmed || !trimmed.startsWith('data: '))
                        continue;
                    const data = trimmed.slice(6);
                    if (data === '[DONE]') {
                        yield { content: '', done: true };
                        return;
                    }
                    try {
                        const parsed = JSON.parse(data);
                        const content = parsed.choices?.[0]?.delta?.content || '';
                        const finishReason = parsed.choices?.[0]?.finish_reason;
                        if (content) {
                            yield { content, done: false };
                        }
                        if (finishReason === 'stop') {
                            yield {
                                content: '',
                                done: true,
                                usage: {
                                    inputTokens: parsed.usage?.prompt_tokens,
                                    outputTokens: parsed.usage?.completion_tokens,
                                },
                            };
                            return;
                        }
                    }
                    catch {
                    }
                }
            }
        }
        catch (error) {
            yield { content: `Error: ${error.message}`, done: true };
        }
    }
    async generateImage(request) {
        const start = Date.now();
        try {
            const response = await this.client.post('/images/generations', {
                model: request.model,
                prompt: request.prompt,
                n: request.numImages || 1,
                size: `${request.width || 1024}x${request.height || 1024}`,
                quality: 'hd',
            });
            const urls = response.data.data?.map((item) => item.url) || [];
            return {
                success: true,
                data: { urls, metadata: { model: request.model } },
                responseTimeMs: Date.now() - start,
                providerSlug: this.slug,
            };
        }
        catch (error) {
            return this.handleError(error, start);
        }
    }
    async generateVideo(_request) {
        return {
            success: false,
            error: {
                code: 'UNSUPPORTED',
                message: 'Video generation not supported by OpenRouter',
                retryable: false,
            },
            responseTimeMs: 0,
            providerSlug: this.slug,
        };
    }
    async generateAudio(_request) {
        return {
            success: false,
            error: {
                code: 'UNSUPPORTED',
                message: 'Audio generation not supported by OpenRouter',
                retryable: false,
            },
            responseTimeMs: 0,
            providerSlug: this.slug,
        };
    }
    async checkTaskStatus(_taskId) {
        return { status: 'completed' };
    }
    async healthCheck() {
        try {
            const response = await this.client.get('/models', { timeout: 5000 });
            return response.status === 200;
        }
        catch {
            return false;
        }
    }
    handleError(error, start) {
        const status = error?.response?.status;
        const message = error?.response?.data?.error?.message || error.message;
        return {
            success: false,
            error: {
                code: `HTTP_${status || 'UNKNOWN'}`,
                message,
                retryable: status === 429 || status === 502 || status === 503 || status >= 500,
            },
            responseTimeMs: Date.now() - start,
            providerSlug: this.slug,
        };
    }
}
exports.OpenRouterProvider = OpenRouterProvider;
//# sourceMappingURL=openrouter.provider.js.map