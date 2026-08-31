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
  // 🆕 Те же списки для входа по почте/Google: у таких аккаунтов нет
  // telegramId, и без этого назначить им админку было невозможно.
  private readonly adminEmails: Set<string>;
  private readonly superAdminEmails: Set<string>;

  constructor(private readonly config: ConfigService) {
    this.adminTgIds = this.parseTgIds(this.config.get<string>('ADMIN_TG_IDS'));
    this.superAdminTgIds = this.parseTgIds(
      this.config.get<string>('SUPER_ADMIN_TG_IDS'),
    );
    this.adminEmails = this.parseEmails(this.config.get<string>('ADMIN_EMAILS'));
    this.superAdminEmails = this.parseEmails(
      this.config.get<string>('SUPER_ADMIN_EMAILS'),
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

  /** Парсит "a@mail.ru, B@Mail.ru" в Set нормализованных адресов. */
  private parseEmails(raw?: string): Set<string> {
    if (!raw) return new Set();
    return new Set(
      raw
        .split(',')
        .map((s) => s.trim().toLowerCase())
        .filter((s) => s.includes('@')),
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
    const tgId = user.telegramId ? Number(user.telegramId) : null;
    const email = (user.email || '').trim().toLowerCase();

    // Идентификаторов нет вообще — синхронизировать не по чему.
    if (!tgId && !email) return user;

    const isSuperAdmin =
      (tgId !== null && this.superAdminTgIds.has(tgId)) ||
      (!!email && this.superAdminEmails.has(email));
    const isAdmin =
      (tgId !== null && this.adminTgIds.has(tgId)) ||
      (!!email && this.adminEmails.has(email));

    const currentRole = user.role;
    const label = tgId ?? email;

    let targetRole: UserRole | null = null;

    if (isSuperAdmin) {
      targetRole = UserRole.SUPER_ADMIN;
    } else if (isAdmin) {
      // Если уже SUPER_ADMIN, оставляем (не понижаем case "был супером, теперь в обычных")
      if (currentRole !== UserRole.SUPER_ADMIN) {
        targetRole = UserRole.ADMIN;
      }
    } else {
      // Понижаем, только если списки для ЭТОГО способа входа заданы.
      //
      // Иначе почтовый админ терял бы роль при каждом входе просто потому,
      // что ADMIN_EMAILS не заполнен: пустой список означает «управление
      // ролями по почте не настроено», а не «здесь никого нет».
      const managedByTg = tgId !== null &&
        (this.adminTgIds.size > 0 || this.superAdminTgIds.size > 0);
      const managedByEmail = !!email &&
        (this.adminEmails.size > 0 || this.superAdminEmails.size > 0);

      const elevated =
        currentRole === UserRole.ADMIN || currentRole === UserRole.SUPER_ADMIN;

      if (elevated && (managedByTg || managedByEmail)) {
        targetRole = UserRole.USER;
        this.logger.warn(
          `⬇️  Demoting user ${label} (${user.username}) from ${currentRole} to USER (not in env lists)`,
        );
      }
    }

    if (targetRole && targetRole !== currentRole) {
      user.role = targetRole;
      await user.save();
      this.logger.log(
        `✅ Role synced: user ${label} (${user.username}) → ${targetRole}`,
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