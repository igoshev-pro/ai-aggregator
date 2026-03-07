export declare class ImageGenerationDto {
    modelSlug: string;
    prompt: string;
    negativePrompt?: string;
    width?: number;
    height?: number;
    steps?: number;
    seed?: number;
    numImages?: number;
    style?: string;
}
export declare class VideoGenerationDto {
    modelSlug: string;
    prompt: string;
    negativePrompt?: string;
    imageUrl?: string;
    duration?: number;
    aspectRatio?: string;
    resolution?: string;
    style?: string;
}
export declare class AudioGenerationDto {
    modelSlug: string;
    prompt: string;
    style?: string;
    duration?: number;
    instrumental?: boolean;
    voiceId?: string;
    language?: string;
}
