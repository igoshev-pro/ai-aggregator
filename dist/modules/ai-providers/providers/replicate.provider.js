"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ReplicateProvider = void 0;
const axios_1 = require("axios");
const base_provider_abstract_1 = require("./base-provider.abstract");
class ReplicateProvider extends base_provider_abstract_1.BaseProvider {
    constructor(config) {
        super('replicate', config);
        this.client = axios_1.default.create({
            baseURL: 'https://api.replicate.com/v1',
            timeout: config.timeout || 120000,
            headers: {
                'Authorization': `Bearer ${config.apiKey}`,
                'Content-Type': 'application/json',
            },
        });
    }
    async generateText(_request) {
        return {
            success: false,
            error: { code: 'UNSUPPORTED', message: 'Use OpenRouter for text', retryable: false },
            responseTimeMs: 0,
            providerSlug: this.slug,
        };
    }
    async *generateTextStream(_request) {
        yield { content: 'Text streaming not supported on Replicate', done: true };
    }
    async generateImage(request) {
        const start = Date.now();
        try {
            const response = await this.client.post('/predictions', {
                model: request.model,
                input: {
                    prompt: request.prompt,
                    negative_prompt: request.negativePrompt,
                    width: request.width || 1024,
                    height: request.height || 1024,
                    num_inference_steps: request.steps || 28,
                    seed: request.seed,
                    num_outputs: request.numImages || 1,
                },
            });
            const prediction = response.data;
            if (prediction.status === 'succeeded') {
                return {
                    success: true,
                    data: {
                        urls: Array.isArray(prediction.output)
                            ? prediction.output
                            : [prediction.output],
                        metadata: { model: request.model, predictionId: prediction.id },
                    },
                    responseTimeMs: Date.now() - start,
                    providerSlug: this.slug,
                };
            }
            return {
                success: true,
                data: {
                    taskId: prediction.id,
                    metadata: { model: request.model },
                },
                responseTimeMs: Date.now() - start,
                providerSlug: this.slug,
            };
        }
        catch (error) {
            return this.handleError(error, start);
        }
    }
    async generateVideo(request) {
        const start = Date.now();
        try {
            const input = {
                prompt: request.prompt,
                duration: request.duration || 5,
            };
            if (request.imageUrl)
                input.image = request.imageUrl;
            if (request.aspectRatio)
                input.aspect_ratio = request.aspectRatio;
            const response = await this.client.post('/predictions', {
                model: request.model,
                input,
            });
            return {
                success: true,
                data: {
                    taskId: response.data.id,
                    metadata: { model: request.model },
                },
                responseTimeMs: Date.now() - start,
                providerSlug: this.slug,
            };
        }
        catch (error) {
            return this.handleError(error, start);
        }
    }
    async generateAudio(request) {
        const start = Date.now();
        try {
            const input = {
                prompt: request.prompt,
            };
            if (request.style)
                input.style = request.style;
            if (request.duration)
                input.duration = request.duration;
            if (request.instrumental !== undefined)
                input.instrumental = request.instrumental;
            const response = await this.client.post('/predictions', {
                model: request.model,
                input,
            });
            return {
                success: true,
                data: {
                    taskId: response.data.id,
                    metadata: { model: request.model },
                },
                responseTimeMs: Date.now() - start,
                providerSlug: this.slug,
            };
        }
        catch (error) {
            return this.handleError(error, start);
        }
    }
    async checkTaskStatus(taskId) {
        try {
            const response = await this.client.get(`/predictions/${taskId}`);
            const data = response.data;
            const statusMap = {
                starting: 'pending',
                processing: 'processing',
                succeeded: 'completed',
                failed: 'failed',
                canceled: 'failed',
            };
            return {
                status: statusMap[data.status] || 'pending',
                progress: data.logs ? this.parseProgress(data.logs) : undefined,
                resultUrls: data.output
                    ? Array.isArray(data.output) ? data.output : [data.output]
                    : undefined,
                error: data.error,
                eta: data.metrics?.predict_time
                    ? Math.max(0, (data.metrics.predict_time * 1.2) - (Date.now() - new Date(data.created_at).getTime()) / 1000)
                    : undefined,
            };
        }
        catch {
            return { status: 'failed', error: 'Failed to check prediction status' };
        }
    }
    async healthCheck() {
        try {
            const res = await this.client.get('/models', { timeout: 5000 });
            return res.status === 200;
        }
        catch {
            return false;
        }
    }
    parseProgress(logs) {
        const match = logs.match(/(\d+)%/);
        return match ? parseInt(match[1], 10) : undefined;
    }
    handleError(error, start) {
        const status = error?.response?.status;
        return {
            success: false,
            error: {
                code: `HTTP_${status || 'UNKNOWN'}`,
                message: error?.response?.data?.detail || error.message,
                retryable: status === 429 || status >= 500,
            },
            responseTimeMs: Date.now() - start,
            providerSlug: this.slug,
        };
    }
}
exports.ReplicateProvider = ReplicateProvider;
//# sourceMappingURL=replicate.provider.js.map