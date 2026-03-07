"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.AudioGenerationDto = exports.VideoGenerationDto = exports.ImageGenerationDto = void 0;
const class_validator_1 = require("class-validator");
const swagger_1 = require("@nestjs/swagger");
class ImageGenerationDto {
}
exports.ImageGenerationDto = ImageGenerationDto;
__decorate([
    (0, swagger_1.ApiProperty)({ description: 'Model slug', example: 'midjourney' }),
    (0, class_validator_1.IsString)(),
    __metadata("design:type", String)
], ImageGenerationDto.prototype, "modelSlug", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ description: 'Prompt for image generation' }),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.MaxLength)(2000),
    __metadata("design:type", String)
], ImageGenerationDto.prototype, "prompt", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ required: false }),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.MaxLength)(1000),
    __metadata("design:type", String)
], ImageGenerationDto.prototype, "negativePrompt", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ required: false, default: 1024 }),
    (0, class_validator_1.IsNumber)(),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.Min)(256),
    (0, class_validator_1.Max)(2048),
    __metadata("design:type", Number)
], ImageGenerationDto.prototype, "width", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ required: false, default: 1024 }),
    (0, class_validator_1.IsNumber)(),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.Min)(256),
    (0, class_validator_1.Max)(2048),
    __metadata("design:type", Number)
], ImageGenerationDto.prototype, "height", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ required: false }),
    (0, class_validator_1.IsNumber)(),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.Min)(1),
    (0, class_validator_1.Max)(100),
    __metadata("design:type", Number)
], ImageGenerationDto.prototype, "steps", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ required: false }),
    (0, class_validator_1.IsNumber)(),
    (0, class_validator_1.IsOptional)(),
    __metadata("design:type", Number)
], ImageGenerationDto.prototype, "seed", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ required: false, default: 1 }),
    (0, class_validator_1.IsNumber)(),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.Min)(1),
    (0, class_validator_1.Max)(4),
    __metadata("design:type", Number)
], ImageGenerationDto.prototype, "numImages", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ required: false }),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.IsOptional)(),
    __metadata("design:type", String)
], ImageGenerationDto.prototype, "style", void 0);
class VideoGenerationDto {
}
exports.VideoGenerationDto = VideoGenerationDto;
__decorate([
    (0, swagger_1.ApiProperty)({ example: 'kling-1.6' }),
    (0, class_validator_1.IsString)(),
    __metadata("design:type", String)
], VideoGenerationDto.prototype, "modelSlug", void 0);
__decorate([
    (0, swagger_1.ApiProperty)(),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.MaxLength)(2000),
    __metadata("design:type", String)
], VideoGenerationDto.prototype, "prompt", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ required: false }),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.IsOptional)(),
    __metadata("design:type", String)
], VideoGenerationDto.prototype, "negativePrompt", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ required: false, description: 'Image URL for img2video' }),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.IsOptional)(),
    __metadata("design:type", String)
], VideoGenerationDto.prototype, "imageUrl", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ required: false, default: 5 }),
    (0, class_validator_1.IsNumber)(),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.Min)(1),
    (0, class_validator_1.Max)(30),
    __metadata("design:type", Number)
], VideoGenerationDto.prototype, "duration", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ required: false, enum: ['16:9', '9:16', '1:1', '4:3'] }),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.IsOptional)(),
    __metadata("design:type", String)
], VideoGenerationDto.prototype, "aspectRatio", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ required: false, enum: ['480p', '720p', '1080p'] }),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.IsOptional)(),
    __metadata("design:type", String)
], VideoGenerationDto.prototype, "resolution", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ required: false }),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.IsOptional)(),
    __metadata("design:type", String)
], VideoGenerationDto.prototype, "style", void 0);
class AudioGenerationDto {
}
exports.AudioGenerationDto = AudioGenerationDto;
__decorate([
    (0, swagger_1.ApiProperty)({ example: 'suno-v4' }),
    (0, class_validator_1.IsString)(),
    __metadata("design:type", String)
], AudioGenerationDto.prototype, "modelSlug", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ description: 'Prompt/lyrics for music or text for TTS' }),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.MaxLength)(5000),
    __metadata("design:type", String)
], AudioGenerationDto.prototype, "prompt", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ required: false }),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.IsOptional)(),
    __metadata("design:type", String)
], AudioGenerationDto.prototype, "style", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ required: false }),
    (0, class_validator_1.IsNumber)(),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.Min)(5),
    (0, class_validator_1.Max)(300),
    __metadata("design:type", Number)
], AudioGenerationDto.prototype, "duration", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ required: false }),
    (0, class_validator_1.IsOptional)(),
    __metadata("design:type", Boolean)
], AudioGenerationDto.prototype, "instrumental", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ required: false, description: 'Voice ID for ElevenLabs' }),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.IsOptional)(),
    __metadata("design:type", String)
], AudioGenerationDto.prototype, "voiceId", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ required: false }),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.IsOptional)(),
    __metadata("design:type", String)
], AudioGenerationDto.prototype, "language", void 0);
//# sourceMappingURL=image-generation.dto.js.map