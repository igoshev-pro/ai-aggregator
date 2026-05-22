import {
  forwardRef,
  Inject,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { ConfigService } from '@nestjs/config';
import { UsersService } from '@/modules/users/users.service';
import { JwtPayload } from '@/common/interfaces';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
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
    try {
      const user = await this.usersService.findById(payload.sub);
      if (!user || !user.isActive || user.isBanned) {
        throw new UnauthorizedException();
      }

      // 🆕 Возвращаем расширенный объект:
      // - всё из payload (sub, iat, exp)
      // - + актуальные поля юзера из БД (role, telegramId, username)
      // - + удобный alias userId
      return {
        ...payload,
        userId: payload.sub,
        role: user.role,
        telegramId: user.telegramId,
        username: user.username,
        firstName: user.firstName,
        lastName: user.lastName,
      };
    } catch {
      throw new UnauthorizedException();
    }
  }
}