// src/modules/auth/auth.module.ts
import { Module, forwardRef } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { JwtStrategy } from './strategies/jwt.strategy';
import { UsersModule } from '../users/users.module';
import { ReferralModule } from '../referral/referral.module';
import { AdminBootstrapService } from './admin-bootstrap.service';
import { BotAuthService } from './bot-auth.service';
import { MailService } from './mail.service';
import { PasswordResetService } from './password-reset.service';

@Module({
  imports: [
    forwardRef(() => UsersModule),
    PassportModule.register({ defaultStrategy: 'jwt' }),
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.get<string>('JWT_SECRET'),
        signOptions: { expiresIn: config.get<string>('JWT_EXPIRATION', '7d') },
      }),
    }),
     forwardRef(() => ReferralModule),
  ],
  controllers: [AuthController],
  providers: [
    AuthService,
    BotAuthService,
    AdminBootstrapService,
    JwtStrategy,
    MailService,
    PasswordResetService,
  ],
  exports: [AuthService, AdminBootstrapService, BotAuthService],
})
export class AuthModule {}