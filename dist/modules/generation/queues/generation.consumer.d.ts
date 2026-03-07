import { Job } from 'bull';
import { GenerationService } from '../generation.service';
import { AiProvidersService } from '../../ai-providers/ai-providers.service';
import { GenerationType } from '@/common/interfaces';
import { GenerationGateway } from '../generation.gateway';
interface GenerationJobData {
    generationId: string;
    userId: string;
    type: GenerationType;
    modelSlug: string;
    request: any;
}
export declare class GenerationConsumer {
    private generationService;
    private aiProvidersService;
    private generationGateway;
    private readonly logger;
    constructor(generationService: GenerationService, aiProvidersService: AiProvidersService, generationGateway: GenerationGateway);
    handleGeneration(job: Job<GenerationJobData>): Promise<void>;
    private pollTaskUntilComplete;
    onFailed(job: Job<GenerationJobData>, error: Error): Promise<void>;
    private sleep;
}
export {};
