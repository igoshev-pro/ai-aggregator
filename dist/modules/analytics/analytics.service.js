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
var __param = (this && this.__param) || function (paramIndex, decorator) {
    return function (target, key) { decorator(target, key, paramIndex); }
};
var AnalyticsService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.AnalyticsService = void 0;
const common_1 = require("@nestjs/common");
const mongoose_1 = require("@nestjs/mongoose");
const mongoose_2 = require("mongoose");
const analytics_event_schema_1 = require("./schemas/analytics-event.schema");
let AnalyticsService = AnalyticsService_1 = class AnalyticsService {
    constructor(analyticsModel) {
        this.analyticsModel = analyticsModel;
        this.logger = new common_1.Logger(AnalyticsService_1.name);
    }
    async track(data) {
        try {
            const analyticsEvent = new this.analyticsModel({
                event: data.event,
                userId: data.userId ? new mongoose_2.Types.ObjectId(data.userId) : undefined,
                sessionId: data.sessionId,
                properties: data.properties || {},
                source: data.source,
                platform: data.platform,
                userAgent: data.userAgent,
                ip: data.ip,
            });
            await analyticsEvent.save();
        }
        catch (error) {
            this.logger.warn(`Failed to track event ${data.event}: ${error.message}`);
        }
    }
    async trackBatch(events) {
        try {
            const docs = events.map((e) => ({
                event: e.event,
                userId: e.userId ? new mongoose_2.Types.ObjectId(e.userId) : undefined,
                properties: e.properties || {},
                source: e.source,
            }));
            await this.analyticsModel.insertMany(docs, { ordered: false });
        }
        catch (error) {
            this.logger.warn(`Failed to track batch events: ${error.message}`);
        }
    }
    async getEventStats(days = 30) {
        const since = new Date();
        since.setDate(since.getDate() - days);
        const [eventCounts, dailyActive, topEvents, funnelData] = await Promise.all([
            this.analyticsModel.aggregate([
                { $match: { createdAt: { $gte: since } } },
                {
                    $group: {
                        _id: '$event',
                        count: { $sum: 1 },
                        uniqueUsers: { $addToSet: '$userId' },
                    },
                },
                {
                    $addFields: {
                        uniqueUsersCount: { $size: '$uniqueUsers' },
                    },
                },
                {
                    $project: { uniqueUsers: 0 },
                },
                { $sort: { count: -1 } },
            ]),
            this.analyticsModel.aggregate([
                { $match: { createdAt: { $gte: since }, userId: { $exists: true } } },
                {
                    $group: {
                        _id: {
                            date: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } },
                        },
                        uniqueUsers: { $addToSet: '$userId' },
                    },
                },
                {
                    $addFields: {
                        dau: { $size: '$uniqueUsers' },
                    },
                },
                {
                    $project: {
                        _id: 0,
                        date: '$_id.date',
                        dau: 1,
                    },
                },
                { $sort: { date: 1 } },
            ]),
            this.analyticsModel.aggregate([
                {
                    $match: {
                        createdAt: { $gte: new Date(Date.now() - 24 * 60 * 60 * 1000) },
                    },
                },
                {
                    $group: {
                        _id: '$event',
                        count: { $sum: 1 },
                    },
                },
                { $sort: { count: -1 } },
                { $limit: 10 },
            ]),
            this.getFunnelData(since),
        ]);
        return { eventCounts, dailyActive, topEvents, funnelData };
    }
    async getFunnelData(since) {
        const [registered, firstGeneration, firstPayment] = await Promise.all([
            this.analyticsModel.countDocuments({
                event: 'user_registered',
                createdAt: { $gte: since },
            }),
            this.analyticsModel.aggregate([
                {
                    $match: {
                        event: 'generation_completed',
                        createdAt: { $gte: since },
                    },
                },
                { $group: { _id: '$userId' } },
                { $count: 'total' },
            ]),
            this.analyticsModel.aggregate([
                {
                    $match: {
                        event: 'payment_completed',
                        createdAt: { $gte: since },
                    },
                },
                { $group: { _id: '$userId' } },
                { $count: 'total' },
            ]),
        ]);
        return {
            registered,
            madeGeneration: firstGeneration[0]?.total || 0,
            madePurchase: firstPayment[0]?.total || 0,
        };
    }
    async getPlatformStats(days = 30) {
        const since = new Date();
        since.setDate(since.getDate() - days);
        return this.analyticsModel.aggregate([
            { $match: { createdAt: { $gte: since } } },
            {
                $group: {
                    _id: {
                        source: '$source',
                        platform: '$platform',
                    },
                    count: { $sum: 1 },
                    uniqueUsers: { $addToSet: '$userId' },
                },
            },
            {
                $addFields: {
                    uniqueUsersCount: { $size: { $ifNull: ['$uniqueUsers', []] } },
                },
            },
            { $project: { uniqueUsers: 0 } },
            { $sort: { count: -1 } },
        ]);
    }
    async getUserActivity(userId, days = 7) {
        const since = new Date();
        since.setDate(since.getDate() - days);
        return this.analyticsModel
            .find({
            userId: new mongoose_2.Types.ObjectId(userId),
            createdAt: { $gte: since },
        })
            .sort({ createdAt: -1 })
            .limit(100)
            .exec();
    }
};
exports.AnalyticsService = AnalyticsService;
exports.AnalyticsService = AnalyticsService = AnalyticsService_1 = __decorate([
    (0, common_1.Injectable)(),
    __param(0, (0, mongoose_1.InjectModel)(analytics_event_schema_1.AnalyticsEvent.name)),
    __metadata("design:paramtypes", [mongoose_2.Model])
], AnalyticsService);
//# sourceMappingURL=analytics.service.js.map