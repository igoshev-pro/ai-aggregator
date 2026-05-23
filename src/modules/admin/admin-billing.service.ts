import {
  Injectable,
  NotFoundException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import {
  SubscriptionPlanEntity,
  SubscriptionPlanDocument,
} from '../billing/schemas/subscription-plan.schema';
import {
  TokenPackageEntity,
  TokenPackageDocument,
} from '../billing/schemas/token-package.schema';

@Injectable()
export class AdminBillingService {
  private readonly logger = new Logger(AdminBillingService.name);

  constructor(
    @InjectModel(SubscriptionPlanEntity.name)
    private planModel: Model<SubscriptionPlanDocument>,
    @InjectModel(TokenPackageEntity.name)
    private packageModel: Model<TokenPackageDocument>,
  ) {}

  // ─── Subscription plans ────────────────────────────────────────

  async listPlans() {
    return this.planModel.find().sort({ sortOrder: 1, priceRub: 1 }).lean();
  }

  async getPlan(id: string) {
    const plan = await this.planModel.findById(id).lean();
    if (!plan) throw new NotFoundException('Plan not found');
    return plan;
  }

  async createPlan(body: Partial<SubscriptionPlanEntity>) {
    if (!body.planKey || !body.name) {
      throw new BadRequestException('planKey and name are required');
    }
    const exists = await this.planModel.findOne({ planKey: body.planKey });
    if (exists) throw new BadRequestException('planKey already exists');
    const created = await this.planModel.create(body);
    return created.toObject();
  }

  async updatePlan(id: string, body: Partial<SubscriptionPlanEntity>) {
    // planKey менять нельзя — это бизнес-идентификатор
    delete (body as any).planKey;
    const plan = await this.planModel
      .findByIdAndUpdate(id, body, { new: true })
      .lean();
    if (!plan) throw new NotFoundException('Plan not found');
    return plan;
  }

  async togglePlan(id: string) {
    const plan = await this.planModel.findById(id);
    if (!plan) throw new NotFoundException('Plan not found');
    plan.isActive = !plan.isActive;
    await plan.save();
    return plan.toObject();
  }

  async deletePlan(id: string) {
    const res = await this.planModel.findByIdAndDelete(id);
    if (!res) throw new NotFoundException('Plan not found');
    return { deleted: true, id };
  }

  // ─── Token packages ────────────────────────────────────────────

  async listPackages() {
    return this.packageModel
      .find()
      .sort({ sortOrder: 1, priceRub: 1 })
      .lean();
  }

  async getPackage(id: string) {
    const pack = await this.packageModel.findById(id).lean();
    if (!pack) throw new NotFoundException('Package not found');
    return pack;
  }

  async createPackage(body: Partial<TokenPackageEntity>) {
    if (!body.packageId || !body.label || !body.tokens || body.priceRub == null) {
      throw new BadRequestException(
        'packageId, label, tokens, priceRub are required',
      );
    }
    const exists = await this.packageModel.findOne({
      packageId: body.packageId,
    });
    if (exists) throw new BadRequestException('packageId already exists');
    const created = await this.packageModel.create(body);
    return created.toObject();
  }

  async updatePackage(id: string, body: Partial<TokenPackageEntity>) {
    delete (body as any).packageId;
    const pack = await this.packageModel
      .findByIdAndUpdate(id, body, { new: true })
      .lean();
    if (!pack) throw new NotFoundException('Package not found');
    return pack;
  }

  async togglePackage(id: string) {
    const pack = await this.packageModel.findById(id);
    if (!pack) throw new NotFoundException('Package not found');
    pack.isActive = !pack.isActive;
    await pack.save();
    return pack.toObject();
  }

  async deletePackage(id: string) {
    const res = await this.packageModel.findByIdAndDelete(id);
    if (!res) throw new NotFoundException('Package not found');
    return { deleted: true, id };
  }
}