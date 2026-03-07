import { OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Model } from 'mongoose';
import { BaseProvider } from './base-provider.abstract';
import { ProviderDocument } from '../schemas/provider.schema';
import { ModelDocument } from '../schemas/model.schema';
export declare class ProviderRegistryService implements OnModuleInit {
    private configService;
    private providerModel;
    private modelModel;
    private readonly logger;
    private providers;
    constructor(configService: ConfigService, providerModel: Model<ProviderDocument>, modelModel: Model<ModelDocument>);
    onModuleInit(): Promise<void>;
    private initializeProviders;
    private syncProvidersToDB;
    getProvider(slug: string): BaseProvider | undefined;
    getAllProviders(): Map<string, BaseProvider>;
    getProvidersForModel(modelSlug: string): Promise<{
        provider: BaseProvider;
        modelId: string;
    }[]>;
    healthCheckAll(): Promise<void>;
    updateProviderStats(slug: string, responseTimeMs: number, success: boolean): Promise<void>;
    private seedDefaultModels;
}
