// src/modules/analytics/analytics.service.ts
import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { AnalyticsEvent, AnalyticsEventDocument } from './schemas/analytics-event.schema';

@Injectable()
export class AnalyticsService {
  private readonly logger = new Logger(AnalyticsService.name);

  constructor(
    @InjectModel(AnalyticsEvent.name)
    private analyticsModel: Model<AnalyticsEventDocument>,
  ) {}

  /**
   * Записать событие
   */
  async track(data: {
    event: string;
    userId?: string;
    sessionId?: string;
    properties?: Record<string, any>;
    source?: string;
    platform?: string;
    userAgent?: string;
    ip?: string;
  }) {
    try {
      const analyticsEvent = new this.analyticsModel({
        event: data.event,
        userId: data.userId ? new Types.ObjectId(data.userId) : undefined,
        sessionId: data.sessionId,
        properties: data.properties || {},
        source: data.source,
        platform: data.platform,
        userAgent: data.userAgent,
        ip: data.ip,
      });
      await analyticsEvent.save();
    } catch (error) {
      // Аналитика не должна ронять основной флоу
      this.logger.warn(`Failed to track event ${data.event}: ${error.message}`);
    }
  }

  /**
   * Batch-запись событий
   */
  async trackBatch(events: {
    event: string;
    userId?: string;
    properties?: Record<string, any>;
    source?: string;
  }[]) {
    try {
      const docs = events.map((e) => ({
        event: e.event,
        userId: e.userId ? new Types.ObjectId(e.userId) : undefined,
        properties: e.properties || {},
        source: e.source,
      }));
      await this.analyticsModel.insertMany(docs, { ordered: false });
    } catch (error) {
      this.logger.warn(`Failed to track batch events: ${error.message}`);
    }
  }

  /**
   * Получить аналитику по событиям (для админки)
   */
  async getEventStats(days = 30) {
    const since = new Date();
    since.setDate(since.getDate() - days);

    const [eventCounts, dailyActive, topEvents, funnelData] = await Promise.all([
      // Общее кол-во по типам событий
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

      // DAU (daily active users)
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

      // Топ-10 событий за последние 24 часа
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

      // Воронка: регистрация → первая генерация → покупка
      this.getFunnelData(since),
    ]);

    return { eventCounts, dailyActive, topEvents, funnelData };
  }

  /**
   * Воронка конверсии
   */
  private async getFunnelData(since: Date) {
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

  /**
   * Аналитика по платформам
   */
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

  /**
   * Аналитика по конкретному пользователю (для саппорта / админки)
   */
  async getUserActivity(userId: string, days = 7) {
    const since = new Date();
    since.setDate(since.getDate() - days);

    return this.analyticsModel
      .find({
        userId: new Types.ObjectId(userId),
        createdAt: { $gte: since },
      })
      .sort({ createdAt: -1 })
      .limit(100)
      .exec();
  }
}