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
exports.AIModelSchema = exports.AIModel = void 0;
const mongoose_1 = require("@nestjs/mongoose");
const mongoose_2 = require("mongoose");
const interfaces_1 = require("../../../common/interfaces");
let AIModel = class AIModel {
};
exports.AIModel = AIModel;
__decorate([
    (0, mongoose_1.Prop)({ required: true, unique: true }),
    __metadata("design:type", String)
], AIModel.prototype, "slug", void 0);
__decorate([
    (0, mongoose_1.Prop)({ required: true }),
    __metadata("design:type", String)
], AIModel.prototype, "name", void 0);
__decorate([
    (0, mongoose_1.Prop)({ required: true }),
    __metadata("design:type", String)
], AIModel.prototype, "displayName", void 0);
__decorate([
    (0, mongoose_1.Prop)(),
    __metadata("design:type", String)
], AIModel.prototype, "description", void 0);
__decorate([
    (0, mongoose_1.Prop)(),
    __metadata("design:type", String)
], AIModel.prototype, "icon", void 0);
__decorate([
    (0, mongoose_1.Prop)({ required: true, enum: interfaces_1.GenerationType }),
    __metadata("design:type", String)
], AIModel.prototype, "type", void 0);
__decorate([
    (0, mongoose_1.Prop)({ default: true }),
    __metadata("design:type", Boolean)
], AIModel.prototype, "isActive", void 0);
__decorate([
    (0, mongoose_1.Prop)({ default: false }),
    __metadata("design:type", Boolean)
], AIModel.prototype, "isPremium", void 0);
__decorate([
    (0, mongoose_1.Prop)({ default: 0 }),
    __metadata("design:type", Number)
], AIModel.prototype, "sortOrder", void 0);
__decorate([
    (0, mongoose_1.Prop)({ required: true }),
    __metadata("design:type", Number)
], AIModel.prototype, "tokenCost", void 0);
__decorate([
    (0, mongoose_1.Prop)({
        type: [{
                providerId: { type: mongoose_2.Types.ObjectId, ref: 'Provider' },
                providerSlug: String,
                modelId: String,
                priority: Number,
                isActive: Boolean,
            }],
        default: [],
    }),
    __metadata("design:type", Array)
], AIModel.prototype, "providerMappings", void 0);
__decorate([
    (0, mongoose_1.Prop)({ type: Object, default: {} }),
    __metadata("design:type", Object)
], AIModel.prototype, "defaultParams", void 0);
__decorate([
    (0, mongoose_1.Prop)({ type: Object, default: {} }),
    __metadata("design:type", Object)
], AIModel.prototype, "limits", void 0);
__decorate([
    (0, mongoose_1.Prop)({ type: [String], default: [] }),
    __metadata("design:type", Array)
], AIModel.prototype, "capabilities", void 0);
__decorate([
    (0, mongoose_1.Prop)({ type: Object, default: {} }),
    __metadata("design:type", Object)
], AIModel.prototype, "stats", void 0);
exports.AIModel = AIModel = __decorate([
    (0, mongoose_1.Schema)({ timestamps: true })
], AIModel);
exports.AIModelSchema = mongoose_1.SchemaFactory.createForClass(AIModel);
exports.AIModelSchema.index({ type: 1, isActive: 1, sortOrder: 1 });
exports.AIModelSchema.index({ slug: 1 });
//# sourceMappingURL=model.schema.js.map