import { Document, Types } from 'mongoose';
import { TransactionType, PaymentStatus } from '@/common/interfaces';
export type TransactionDocument = Transaction & Document;
export declare class Transaction {
    userId: Types.ObjectId;
    type: TransactionType;
    amount: number;
    balanceBefore: number;
    balanceAfter: number;
    description: string;
    paymentStatus: PaymentStatus;
    generationId: string;
    generationType: string;
    modelSlug: string;
    externalPaymentId: string;
    paymentProvider: string;
    paymentAmountRub: number;
    promoCode: string;
    referralUserId: Types.ObjectId;
    metadata: Record<string, any>;
}
export declare const TransactionSchema: import("mongoose").Schema<Transaction, import("mongoose").Model<Transaction, any, any, any, Document<unknown, any, Transaction, any, {}> & Transaction & {
    _id: Types.ObjectId;
} & {
    __v: number;
}, any>, {}, {}, {}, {}, import("mongoose").DefaultSchemaOptions, Transaction, Document<unknown, {}, import("mongoose").FlatRecord<Transaction>, {}, import("mongoose").DefaultSchemaOptions> & import("mongoose").FlatRecord<Transaction> & {
    _id: Types.ObjectId;
} & {
    __v: number;
}>;
