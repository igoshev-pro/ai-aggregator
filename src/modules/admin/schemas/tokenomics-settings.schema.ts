import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type TokenomicsSettingsDocument = TokenomicsSettings & Document;

@Schema({ _id: false })
export class PurchasePack {
  @Prop({ required: true }) tokens: number;
  @Prop({ required: true }) priceRub: number;
  @Prop({ default: 0 }) bonusTokens: number;
  @Prop() label?: string;
  @Prop({ default: false }) highlight?: boolean;
}

const PurchasePackSchema = SchemaFactory.createForClass(PurchasePack);

@Schema({ timestamps: true, collection: 'tokenomics_settings' })
export class TokenomicsSettings {
  // Курс: 1 спичка = X $ (для расчёта себестоимости/маржи)
  @Prop({ required: true, default: 0.01 })
  tokenToDollarRate: number;

  // Бесплатных спичек при регистрации
  @Prop({ required: true, default: 50 })
  freeTokensOnSignup: number;

  // Минимальная пачка к покупке
  @Prop({ required: true, default: 100 })
  minPurchaseTokens: number;

  // Пресеты пачек
  @Prop({ type: [PurchasePackSchema], default: [] })
  purchasePacks: PurchasePack[];

  // Возвращать спички при ошибке генерации
  @Prop({ default: true })
  refundOnError: boolean;

  @Prop() updatedBy?: string;
}

export const TokenomicsSettingsSchema = SchemaFactory.createForClass(TokenomicsSettings);