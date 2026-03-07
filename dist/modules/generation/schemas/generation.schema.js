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
exports.GenerationSchema = exports.Generation = void 0;
const mongoose_1 = require("@nestjs/mongoose");
const mongoose_2 = require("mongoose");
const interfaces_1 = require("../../../common/interfaces");
let Generation = class Generation {
};
exports.Generation = Generation;
__decorate([
    (0, mongoose_1.Prop)({ required: true, type: mongoose_2.Types.ObjectId, ref: 'User', index: true }),
    __metadata("design:type", mongoose_2.Types.ObjectId)
], Generation.prototype, "userId", void 0);
__decorate([
    (0, mongoose_1.Prop)({ required: true, enum: interfaces_1.GenerationType }),
    __metadata("design:type", String)
], Generation.prototype, "type", void 0);
__decorate([
    (0, mongoose_1.Prop)({ required: true }),
    __metadata("design:type", String)
], Generation.prototype, "modelSlug", void 0);
__decorate([
    (0, mongoose_1.Prop)({ required: true, enum: interfaces_1.GenerationStatus, default: interfaces_1.GenerationStatus.PENDING }),
    __metadata("design:type", String)
], Generation.prototype, "status", void 0);
__decorate([
    (0, mongoose_1.Prop)({ required: true }),
    __metadata("design:type", String)
], Generation.prototype, "prompt", void 0);
__decorate([
    (0, mongoose_1.Prop)(),
    __metadata("design:type", String)
], Generation.prototype, "negativePrompt", void 0);
__decorate([
    (0, mongoose_1.Prop)({ type: Object, default: {} }),
    __metadata("design:type", Object)
], Generation.prototype, "params", void 0);
__decorate([
    (0, mongoose_1.Prop)({ type: [String], default: [] }),
    __metadata("design:type", Array)
], Generation.prototype, "resultUrls", void 0);
__decorate([
    (0, mongoose_1.Prop)(),
    __metadata("design:type", String)
], Generation.prototype, "resultContent", void 0);
__decorate([
    (0, mongoose_1.Prop)(),
    __metadata("design:type", String)
], Generation.prototype, "taskId", void 0);
__decorate([
    (0, mongoose_1.Prop)(),
    __metadata("design:type", String)
], Generation.prototype, "providerSlug", void 0);
__decorate([
    (0, mongoose_1.Prop)({ default: 0 }),
    __metadata("design:type", Number)
], Generation.prototype, "progress", void 0);
__decorate([
    (0, mongoose_1.Prop)(),
    __metadata("design:type", Number)
], Generation.prototype, "eta", void 0);
__decorate([
    (0, mongoose_1.Prop)({ default: 0 }),
    __metadata("design:type", Number)
], Generation.prototype, "tokensCost", void 0);
__decorate([
    (0, mongoose_1.Prop)({ default: false }),
    __metadata("design:type", Boolean)
], Generation.prototype, "isRefunded", void 0);
__decorate([
    (0, mongoose_1.Prop)(),
    __metadata("design:type", Date)
], Generation.prototype, "startedAt", void 0);
__decorate([
    (0, mongoose_1.Prop)(),
    __metadata("design:type", Date)
], Generation.prototype, "completedAt", void 0);
__decorate([
    (0, mongoose_1.Prop)(),
    __metadata("design:type", Number)
], Generation.prototype, "responseTimeMs", void 0);
__decorate([
    (0, mongoose_1.Prop)(),
    __metadata("design:type", String)
], Generation.prototype, "errorMessage", void 0);
__decorate([
    (0, mongoose_1.Prop)({ default: 0 }),
    __metadata("design:type", Number)
], Generation.prototype, "retryCount", void 0);
__decorate([
    (0, mongoose_1.Prop)({ type: Object, default: {} }),
    __metadata("design:type", Object)
], Generation.prototype, "metadata", void 0);
__decorate([
    (0, mongoose_1.Prop)({ default: false }),
    __metadata("design:type", Boolean)
], Generation.prototype, "isFavorite", void 0);
exports.Generation = Generation = __decorate([
    (0, mongoose_1.Schema)({ timestamps: true })
], Generation);
exports.GenerationSchema = mongoose_1.SchemaFactory.createForClass(Generation);
exports.GenerationSchema.index({ userId: 1, createdAt: -1 });
exports.GenerationSchema.index({ userId: 1, type: 1, createdAt: -1 });
exports.GenerationSchema.index({ status: 1, taskId: 1 });
exports.GenerationSchema.index({ userId: 1, isFavorite: 1, createdAt: -1 });
//# sourceMappingURL=generation.schema.js.map