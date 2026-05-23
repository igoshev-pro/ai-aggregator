// src/modules/admin/admin-promo-codes.service.ts
import {
  Injectable,
  NotFoundException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import {
  PromoCode,
  PromoCodeDocument,
  PromoCodeType,
  PromoApplyTo,
} from '../billing/schemas/promo-code.schema';

interface ListParams {
  page?: number;
  limit?: number;
  search?: string;
  type?: PromoCodeType | 'all';
  status?: 'all' | 'active' | 'inactive' | 'expired' | 'exhausted';
  sortBy?: 'createdAt' | 'currentUses' | 'expiresAt' | 'code';
  order?: 'asc' | 'desc';
}

@Injectable()
export class AdminPromoCodesService {
  private readonly logger = new Logger(AdminPromoCodesService.name);

  constructor(
    @InjectModel(PromoCode.name)
    private promoModel: Model<PromoCodeDocument>,
  ) {}

  // ─── LIST ─────────────────────────────────────────────────────
  async list(params: ListParams) {
    const page = Math.max(1, Number(params.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(params.limit) || 20));
    const skip = (page - 1) * limit;

    const filter: any = {};

    if (params.search) {
      filter.$or = [
        { code: { $regex: params.search, $options: 'i' } },
        { description: { $regex: params.search, $options: 'i' } },
      ];
    }

    if (params.type && params.type !== 'all') {
      filter.type = params.type;
    }

    const now = new Date();
    if (params.status === 'active') {
      filter.isActive = true;
      filter.$and = [
        { $or: [{ startsAt: null }, { startsAt: { $lte: now } }] },
        { $or: [{ expiresAt: null }, { expiresAt: { $gt: now } }] },
      ];
    } else if (params.status === 'inactive') {
      filter.isActive = false;
    } else if (params.status === 'expired') {
      filter.expiresAt = { $ne: null, $lte: now };
    } else if (params.status === 'exhausted') {
      filter.$expr = {
        $and: [
          { $ne: ['$maxUses', null] },
          { $gte: ['$currentUses', '$maxUses'] },
        ],
      };
    }

    const sortBy = params.sortBy || 'createdAt';
    const order = params.order === 'asc' ? 1 : -1;

    const [items, total] = await Promise.all([
      this.promoModel
        .find(filter)
        .sort({ [sortBy]: order })
        .skip(skip)
        .limit(limit)
        .lean(),
      this.promoModel.countDocuments(filter),
    ]);

    return {
      items,
      total,
      page,
      limit,
      pages: Math.ceil(total / limit),
    };
  }

  // ─── GET ──────────────────────────────────────────────────────
  async getById(id: string) {
    const promo = await this.promoModel.findById(id).lean();
    if (!promo) throw new NotFoundException('Promo code not found');
    return promo;
  }

  // ─── CREATE ───────────────────────────────────────────────────
  async create(body: any, adminUserId: string) {
    if (!body.code || !body.type) {
      throw new BadRequestException('code and type are required');
    }
    if (!body.description) {
      throw new BadRequestException('description is required');
    }

    const code = String(body.code).trim().toUpperCase();
    if (!/^[A-Z0-9_-]{3,32}$/.test(code)) {
      throw new BadRequestException(
        'Code must be 3-32 chars: A-Z, 0-9, _, -',
      );
    }

    const exists = await this.promoModel.findOne({ code });
    if (exists) throw new BadRequestException('Code already exists');

    this.validatePromoBody(body);

    const doc = await this.promoModel.create({
      ...body,
      code,
      currentUses: 0,
      usages: [],
      totalDiscountGivenRub: 0,
      totalBonusTokensGiven: 0,
      totalSubscriptionDaysGiven: 0,
      createdBy: adminUserId,
    });

    this.logger.log(`✅ Promo code created: ${code} (${body.type})`);
    return doc.toObject();
  }

  // ─── UPDATE ───────────────────────────────────────────────────
  async update(id: string, body: any) {
    // Иммутабельные поля
    delete body.code;
    delete body.currentUses;
    delete body.usages;
    delete body.totalDiscountGivenRub;
    delete body.totalBonusTokensGiven;
    delete body.totalSubscriptionDaysGiven;
    delete body.createdBy;

    if (body.type) {
      this.validatePromoBody(body);
    }

    const promo = await this.promoModel
      .findByIdAndUpdate(id, body, { new: true })
      .lean();
    if (!promo) throw new NotFoundException('Promo code not found');
    return promo;
  }

  // ─── TOGGLE ACTIVE ────────────────────────────────────────────
  async toggle(id: string) {
    const promo = await this.promoModel.findById(id);
    if (!promo) throw new NotFoundException('Promo code not found');
    promo.isActive = !promo.isActive;
    await promo.save();
    return promo.toObject();
  }

  // ─── DELETE ───────────────────────────────────────────────────
  async remove(id: string) {
    const res = await this.promoModel.findByIdAndDelete(id);
    if (!res) throw new NotFoundException('Promo code not found');
    this.logger.log(`🗑 Promo code deleted: ${res.code}`);
    return { deleted: true, id };
  }

  // ─── STATS ────────────────────────────────────────────────────
  async stats(id: string) {
    const promo = await this.promoModel.findById(id).lean();
    if (!promo) throw new NotFoundException('Promo code not found');

    const usages = promo.usages || [];
    const lastUsedAt =
      usages.length > 0
        ? usages.reduce<Date | null>((latest, u) => {
            const d = u.lastUsedAt ? new Date(u.lastUsedAt) : null;
            if (!d) return latest;
            if (!latest || d > latest) return d;
            return latest;
          }, null)
        : null;

    return {
      code: promo.code,
      type: promo.type,
      isActive: promo.isActive,
      currentUses: promo.currentUses,
      maxUses: promo.maxUses,
      remainingUses:
        promo.maxUses != null
          ? Math.max(0, promo.maxUses - promo.currentUses)
          : null,
      totalDiscountGivenRub: promo.totalDiscountGivenRub,
      totalBonusTokensGiven: promo.totalBonusTokensGiven,
      totalSubscriptionDaysGiven: promo.totalSubscriptionDaysGiven,
      uniqueUsers: usages.length,
      lastUsedAt,
      startsAt: promo.startsAt,
      expiresAt: promo.expiresAt,
    };
  }

  // ─── VALIDATION ───────────────────────────────────────────────
  private validatePromoBody(body: any) {
    const t = body.type as PromoCodeType;

    if (t === PromoCodeType.DISCOUNT_PERCENT) {
      const v = Number(body.discountPercent);
      if (!v || v <= 0 || v > 100) {
        throw new BadRequestException(
          'For DISCOUNT_PERCENT discountPercent must be 1-100',
        );
      }
    } else if (t === PromoCodeType.DISCOUNT_RUB) {
      const v = Number(body.discountRub);
      if (!v || v <= 0) {
        throw new BadRequestException(
          'For DISCOUNT_RUB discountRub must be > 0',
        );
      }
    } else if (t === PromoCodeType.BONUS_TOKENS) {
      const v = Number(body.bonusTokens);
      if (!v || v <= 0) {
        throw new BadRequestException(
          'For BONUS_TOKENS bonusTokens must be > 0',
        );
      }
    } else if (t === PromoCodeType.SUBSCRIPTION_DAYS) {
      const v = Number(body.subscriptionDays);
      if (!v || v <= 0) {
        throw new BadRequestException(
          'For SUBSCRIPTION_DAYS subscriptionDays must be > 0',
        );
      }
      if (!body.subscriptionPlan) {
        throw new BadRequestException(
          'For SUBSCRIPTION_DAYS subscriptionPlan is required',
        );
      }
    } else {
      throw new BadRequestException(`Unknown promo type: ${t}`);
    }

    if (body.applyTo && !Object.values(PromoApplyTo).includes(body.applyTo)) {
      throw new BadRequestException(`Unknown applyTo: ${body.applyTo}`);
    }

    if (body.startsAt && body.expiresAt) {
      if (new Date(body.startsAt) >= new Date(body.expiresAt)) {
        throw new BadRequestException('startsAt must be before expiresAt');
      }
    }

    if (body.maxUses != null && body.maxUses !== '' && Number(body.maxUses) < 1) {
      throw new BadRequestException('maxUses must be >= 1 or null');
    }
  }
}