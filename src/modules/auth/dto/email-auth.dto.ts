// src/modules/auth/dto/email-auth.dto.ts
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsEmail,
  IsString,
  MinLength,
  MaxLength,
  IsOptional,
} from 'class-validator';
import { Transform } from 'class-transformer';

/**
 * Минимальная длина пароля.
 *
 * 8 символов — рекомендация NIST; проверки на «одну заглавную и одну
 * цифру» намеренно нет: они заставляют людей писать Password1! и не
 * повышают стойкость. Длина работает лучше.
 */
export const MIN_PASSWORD_LENGTH = 8;

/** bcrypt молча обрезает вход на 72 байтах — длиннее принимать нечестно. */
export const MAX_PASSWORD_LENGTH = 72;

export class RegisterEmailDto {
  @ApiProperty({ example: 'ivan@mail.ru' })
  @IsEmail({}, { message: 'Некорректная почта' })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim().toLowerCase() : value))
  email: string;

  @ApiProperty({ minLength: MIN_PASSWORD_LENGTH })
  @IsString()
  @MinLength(MIN_PASSWORD_LENGTH, {
    message: `Пароль должен быть не короче ${MIN_PASSWORD_LENGTH} символов`,
  })
  @MaxLength(MAX_PASSWORD_LENGTH, {
    message: `Пароль не длиннее ${MAX_PASSWORD_LENGTH} символов`,
  })
  password: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(64)
  firstName?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(32)
  referralCode?: string;
}

export class LoginEmailDto {
  @ApiProperty({ example: 'ivan@mail.ru' })
  @IsEmail({}, { message: 'Некорректная почта' })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim().toLowerCase() : value))
  email: string;

  @ApiProperty()
  @IsString()
  @MaxLength(MAX_PASSWORD_LENGTH)
  password: string;
}

export class RequestPasswordResetDto {
  @ApiProperty({ example: 'ivan@mail.ru' })
  @IsEmail({}, { message: 'Некорректная почта' })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim().toLowerCase() : value))
  email: string;
}

export class ResetPasswordDto {
  @ApiProperty()
  @IsString()
  @MinLength(16)
  @MaxLength(200)
  token: string;

  @ApiProperty({ minLength: MIN_PASSWORD_LENGTH })
  @IsString()
  @MinLength(MIN_PASSWORD_LENGTH, {
    message: `Пароль должен быть не короче ${MIN_PASSWORD_LENGTH} символов`,
  })
  @MaxLength(MAX_PASSWORD_LENGTH)
  password: string;
}
