// src/modules/auth/mail.service.ts
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';

/**
 * Отправка писем (сброс пароля).
 *
 * SMTP может быть не настроен — на локальной машине и в тестовом окружении
 * его обычно нет. В этом случае сервис не падает, а пишет письмо в лог:
 * это позволяет проверять сценарий восстановления без почтового сервера
 * и не роняет регистрацию из-за второстепенной функции.
 */
@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);
  private transporter: nodemailer.Transporter | null = null;
  private readonly from: string;
  private readonly frontendUrl: string;

  constructor(private readonly config: ConfigService) {
    const host = this.config.get<string>('SMTP_HOST');
    const port = Number(this.config.get('SMTP_PORT')) || 587;
    const user = this.config.get<string>('SMTP_USER');
    const pass = this.config.get<string>('SMTP_PASSWORD');

    this.from =
      this.config.get<string>('MAIL_FROM') || user || 'no-reply@spichki.ai';
    this.frontendUrl =
      this.config.get<string>('FRONTEND_URL') ||
      this.config.get<string>('MINI_APP_URL') ||
      '';

    if (host && user && pass) {
      this.transporter = nodemailer.createTransport({
        host,
        port,
        // 465 — implicit TLS; на 587 идёт STARTTLS, secure там должен быть false.
        secure: port === 465,
        auth: { user, pass },
      });
      this.logger.log(`SMTP настроен: ${host}:${port}`);
    } else {
      this.logger.warn(
        'SMTP не настроен (нужны SMTP_HOST, SMTP_USER, SMTP_PASSWORD) — ' +
          'письма будут выводиться в лог вместо отправки',
      );
    }
  }

  get isConfigured(): boolean {
    return this.transporter !== null;
  }

  async sendPasswordReset(email: string, token: string): Promise<void> {
    const link = `${this.frontendUrl}/reset-password?token=${encodeURIComponent(token)}`;

    const subject = 'Восстановление пароля — SPICHKI AI';
    const text =
      `Вы запросили восстановление пароля в SPICHKI AI.\n\n` +
      `Перейдите по ссылке, чтобы задать новый пароль:\n${link}\n\n` +
      `Ссылка действует 30 минут и срабатывает один раз.\n` +
      `Если вы не запрашивали восстановление — просто проигнорируйте письмо, ` +
      `пароль останется прежним.`;

    const html = `
      <div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;max-width:480px;margin:0 auto;padding:24px;color:#1a1714">
        <div style="font-weight:800;font-size:18px;letter-spacing:1px;color:#c2410c;margin-bottom:20px">SPICHKI AI</div>
        <h1 style="font-size:20px;margin:0 0 12px">Восстановление пароля</h1>
        <p style="font-size:15px;line-height:1.6;color:#57504a;margin:0 0 20px">
          Вы запросили восстановление пароля. Нажмите кнопку, чтобы задать новый:
        </p>
        <a href="${link}" style="display:inline-block;background:#c2410c;color:#fff;text-decoration:none;padding:12px 24px;border-radius:8px;font-weight:600;font-size:15px">
          Задать новый пароль
        </a>
        <p style="font-size:13px;line-height:1.6;color:#8a827a;margin:20px 0 0">
          Ссылка действует 30 минут и срабатывает один раз.<br>
          Если вы не запрашивали восстановление — просто проигнорируйте письмо,
          пароль останется прежним.
        </p>
      </div>
    `;

    if (!this.transporter) {
      this.logger.warn(
        `[ПИСЬМО НЕ ОТПРАВЛЕНО — SMTP не настроен] Кому: ${email}\nСсылка: ${link}`,
      );
      return;
    }

    try {
      await this.transporter.sendMail({
        from: this.from,
        to: email,
        subject,
        text,
        html,
      });
      this.logger.log(`Письмо о сбросе пароля отправлено: ${email}`);
    } catch (e: any) {
      // Наверх ошибку не бросаем: иначе по коду ответа можно отличить
      // существующий адрес от несуществующего.
      this.logger.error(`Не удалось отправить письмо на ${email}: ${e.message}`);
    }
  }
}
