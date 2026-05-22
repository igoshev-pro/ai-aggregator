// src/modules/auth/admin-bootstrap.service.ts
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { UserDocument } from '@/modules/users/schemas/user.schema';
import { UserRole } from '@/common/interfaces';

/**
 * Сервис автоматически проставляет role=ADMIN / SUPER_ADMIN
 * пользователям из списка ADMIN_TG_IDS / SUPER_ADMIN_TG_IDS в .env.
 *
 * Вызывается при каждом логине из AuthService.
 * Также понижает роль обратно если юзер удалён из списка.
 */
@Injectable()
export class AdminBootstrapService {
  private readonly logger = new Logger(AdminBootstrapService.name);

  private readonly adminTgIds: Set<number>;
  private readonly superAdminTgIds: Set<number>;

  constructor(private readonly config: ConfigService) {
    this.adminTgIds = this.parseTgIds(this.config.get<string>('ADMIN_TG_IDS'));
    this.superAdminTgIds = this.parseTgIds(
      this.config.get<string>('SUPER_ADMIN_TG_IDS'),
    );

    if (this.adminTgIds.size > 0) {
      this.logger.log(
        `🛡  Admin IDs loaded: ${Array.from(this.adminTgIds).join(', ')}`,
      );
    }
    if (this.superAdminTgIds.size > 0) {
      this.logger.log(
        `👑 Super Admin IDs loaded: ${Array.from(this.superAdminTgIds).join(', ')}`,
      );
    }
  }

  /**
   * Парсит строку "123,456,789" в Set<number>.
   * Игнорирует пустые / невалидные значения.
   */
  private parseTgIds(raw?: string): Set<number> {
    if (!raw) return new Set();
    return new Set(
      raw
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
        .map((s) => Number(s))
        .filter((n) => Number.isFinite(n) && n > 0),
    );
  }

  /**
   * Синхронизирует роль пользователя с .env.
   * Вызывается при каждом логине.
   *
   * Логика:
   *  - В списке SUPER_ADMIN → role = SUPER_ADMIN
   *  - В списке ADMIN       → role = ADMIN (но не понижаем SUPER_ADMIN'а из списка)
   *  - Не в списках, но имеет admin/super_admin → понижаем до USER
   *  - Premium роль не трогаем
   */
  async syncRoleFromEnv(user: UserDocument): Promise<UserDocument> {
    if (!user.telegramId) return user;

    const tgId = Number(user.telegramId);
    const isSuperAdmin = this.superAdminTgIds.has(tgId);
    const isAdmin = this.adminTgIds.has(tgId);
    const currentRole = user.role;

    let targetRole: UserRole | null = null;

    if (isSuperAdmin) {
      targetRole = UserRole.SUPER_ADMIN;
    } else if (isAdmin) {
      // Если уже SUPER_ADMIN, оставляем (не понижаем case "был супером, теперь в обычных")
      if (currentRole !== UserRole.SUPER_ADMIN) {
        targetRole = UserRole.ADMIN;
      }
    } else {
      // Не в списках — если был ADMIN/SUPER_ADMIN, понижаем до USER
      if (
        currentRole === UserRole.ADMIN ||
        currentRole === UserRole.SUPER_ADMIN
      ) {
        targetRole = UserRole.USER;
        this.logger.warn(
          `⬇️  Demoting user ${tgId} (${user.username}) from ${currentRole} to USER (not in env lists)`,
        );
      }
    }

    if (targetRole && targetRole !== currentRole) {
      user.role = targetRole;
      await user.save();
      this.logger.log(
        `✅ Role synced: user ${tgId} (${user.username}) → ${targetRole}`,
      );
    }

    return user;
  }

  /**
   * Хелпер: проверка является ли TG ID админом по .env
   * (используется в гарде или где-то ещё).
   */
  isAdminTgId(tgId: number): boolean {
    return this.adminTgIds.has(tgId) || this.superAdminTgIds.has(tgId);
  }

  isSuperAdminTgId(tgId: number): boolean {
    return this.superAdminTgIds.has(tgId);
  }
}