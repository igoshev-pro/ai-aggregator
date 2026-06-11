import {
  forwardRef,
  Inject,
  Injectable,
  Logger,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { ConfigService } from '@nestjs/config';
import { UsersService } from '@/modules/users/users.service';
import { JwtPayload } from '@/common/interfaces';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  private readonly logger = new Logger(JwtStrategy.name);

  constructor(
    private configService: ConfigService,
    @Inject(forwardRef(() => UsersService))
    private usersService: UsersService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: configService.get<string>('JWT_SECRET'),
    });
  }

  async validate(payload: JwtPayload) {
    let user;
    try {
      user = await this.usersService.findById(payload.sub);
    } catch (error: any) {
      // ⚠️ КРИТИЧНО: ошибки БД/сети НЕ маскируем под 401.
      // Иначе при кратковременном сбое Mongo у ВСЕХ слетает авторизация
      // → фронт уходит в clearToken() → "иногда не авторизовано".
      this.logger.error(
        `JWT validate DB error for sub=${payload.sub}: ${error?.message}`,
        error?.stack,
      );
      throw new ServiceUnavailableException('Auth temporarily unavailable');
    }

    // Реальные причины отказа — явный 401
    if (!user) {
      throw new UnauthorizedException('User not found');
    }
    if (!user.isActive) {
      throw new UnauthorizedException('User inactive');
    }
    if (user.isBanned) {
      throw new UnauthorizedException('User banned');
    }

    return {
      ...payload,
      userId: payload.sub,
      role: user.role,
      telegramId: user.telegramId,
      username: user.username,
      firstName: user.firstName,
      lastName: user.lastName,
    };
  }
}