// Сбой на стороне провайдера (не ответил, упал, перегружен, кончились
// кредиты на нашем аккаунте) — пользователю незачем видеть сырой текст
// вроде "KIE Codex: 524 - ..." или "Generation timeout: task ...".
// Ошибки, которые пользователь может исправить сам (модерация промпта,
// неподходящий файл, неверные параметры), сюда не попадают и показываются как есть.
const OUTAGE_PATTERNS: RegExp[] = [
  /time(d)?[ -]?out/i,
  /ETIMEDOUT|ECONNRESET|ECONNREFUSED|ECONNABORTED|ENOTFOUND|EAI_AGAIN|EPIPE/,
  /socket hang up|network error|\bNETWORK\b|stream (ended|closed|aborted)/i,
  /\bHTTP[_ ]?(408|429|5\d\d)\b|status code (408|429|5\d\d)|:\s*(408|429|5\d\d)\s*-/i,
  /too many requests|rate.?limit|overload|capacity|busy|unavailable|maint(enance|ained|aining)|try again later/i,
  /bad gateway|gateway|internal (server )?error|server error|upstream/i,
  /insufficient (credits?|balance|funds|quota)|not enough credits?|quota exceeded|credits? (are )?(insufficient|exhausted)/i,
  /all providers failed|no providers available|provider_error|unknown (provider )?error/i,
  /empty response|empty result|no response|no (images?|message|result|output) (returned|in response)/i,
  /consecutive errors|did not complete/i,
];

// Отказ модерации провайдера: промпт или фото не прошли фильтр.
// Повтор у того же провайдера не поможет, у другого — тоже вряд ли.
const CONTENT_POLICY_PATTERNS: RegExp[] = [
  /nsfw|sensitive|inappropriate|harmful|explicit|porn|nudity|sexual/i,
  /content[ _-]?(policy|polic(ies)|moderation|filter|violation|safety)|moderat/i,
  /prohibited|violat|not (allowed|permitted) (content|by)|against (our|the) (policy|policies|guidelines|terms)/i,
  /safety (system|filter|check)|IMAGE_SAFETY|PROHIBITED_CONTENT|SENSITIVE_WORD|responsible ai|guidelines?/i,
  /flagged|blocked (by|due)|public figure|celebrit|copyright|trademark/i,
  /модерац|запрещ|недопустим/i,
];

// Ошибки в параметрах запроса — повтор с тем же запросом бессмысленен.
const VALIDATION_PATTERNS: RegExp[] = [
  /\b(is|are) required\b|\brequired\b.*\b(field|param|image|url|video)|\bmissing\b/i,
  /\binvalid\b(?!.*\b(api[ _-]?key|token|auth))|must be|must not|should be|cannot be empty|can't be empty/i,
  /not supported|unsupported|unknown (video |image |audio )?model/i,
  /exceed|too (long|large|short|many|big|small)|out of range|maximum|minimum|at most|at least/i,
  /malformed|unprocessable|unable to (download|fetch|read|decode|load) (the )?(image|file|video|audio|url)/i,
  /не поддерж|обязател|слишком (длин|больш|мал)/i,
];

export function isProviderOutage(message: string | null | undefined): boolean {
  if (!message || !message.trim()) return true;
  return OUTAGE_PATTERNS.some((re) => re.test(message));
}

export function isContentPolicyError(message: string | null | undefined): boolean {
  if (!message) return false;
  return CONTENT_POLICY_PATTERNS.some((re) => re.test(message));
}

export function isValidationError(message: string | null | undefined): boolean {
  if (!message) return false;
  return VALIDATION_PATTERNS.some((re) => re.test(message));
}

// Модерация или неверные параметры — Bull не должен повторять такую задачу.
export function isNonRetryableProviderError(
  message: string | null | undefined,
): boolean {
  if (isContentPolicyError(message)) return true;
  if (isProviderOutage(message)) return false;
  return isValidationError(message);
}

/**
 * Общая классификация ошибки провайдера: повторять/идти к запасному или нет.
 *
 *  - httpStatus — HTTP-статус ответа (если был);
 *  - bodyCode   — код из тела ответа (KIE отвечает HTTP 200 + {code, msg});
 *  - message    — текст ошибки.
 *
 * Порядок: модерация → нет; 429/5xx/кредиты/ключ → да (у запасного может
 * получиться); признаки сбоя в тексте → да; ошибка параметров → нет;
 * вообще без кода (сеть, обрыв) → да; прочие 4xx → нет.
 */
export function isRetryableProviderError(opts: {
  httpStatus?: number;
  bodyCode?: number;
  message?: string | null;
}): boolean {
  const { message } = opts;
  if (isContentPolicyError(message)) return false;

  const codes = [opts.httpStatus, opts.bodyCode]
    .map((c) => Number(c))
    .filter((c) => Number.isFinite(c) && c > 0 && c !== 200);
  // 401/402/403 — ключ/кредиты нашего аккаунта; 455 — KIE на обслуживании
  const retryableCode = (c: number) =>
    c === 401 || c === 402 || c === 403 || c === 408 || c === 409 ||
    c === 429 || c === 455 || c >= 500;
  if (codes.some(retryableCode)) return true;

  if (message && OUTAGE_PATTERNS.some((re) => re.test(message))) return true;
  if (isValidationError(message)) return false;

  return codes.length === 0;
}

const CONTENT_POLICY_MESSAGE_REFUNDED =
  'Нейросеть отклонила запрос по правилам модерации: измените промпт или фото. Спички возвращены.';
const CONTENT_POLICY_MESSAGE_NOT_CHARGED =
  'Нейросеть отклонила запрос по правилам модерации: измените промпт или фото. Спички не списаны.';

// refunded — спички были списаны заранее и возвращены (картинки/видео/аудио);
// в чате списание идёт только после успешного ответа.
export function userFacingProviderError(
  message: string | null | undefined,
  opts: { refunded: boolean },
): string {
  if (isContentPolicyError(message)) {
    return opts.refunded
      ? CONTENT_POLICY_MESSAGE_REFUNDED
      : CONTENT_POLICY_MESSAGE_NOT_CHARGED;
  }
  if (!isProviderOutage(message)) return message as string;
  return opts.refunded
    ? 'Нейросеть сейчас не отвечает. Спички возвращены на баланс — попробуйте ещё раз чуть позже.'
    : 'Нейросеть сейчас не отвечает. Спички не списаны — попробуйте ещё раз чуть позже.';
}

/**
 * Текст ошибки медиа-генерации для пользователя (спички уже возвращены).
 * Сырой английский текст провайдера наружу не отдаём: модерация, сбой
 * и ошибка параметров получают свои русские формулировки. Наши русские
 * сообщения (валидация на нашей стороне) показываем как есть.
 */
export function userFacingGenerationError(
  message: string | null | undefined,
): string {
  if (isContentPolicyError(message)) return CONTENT_POLICY_MESSAGE_REFUNDED;
  if (isProviderOutage(message)) {
    return 'Нейросеть сейчас не отвечает. Спички возвращены на баланс — попробуйте ещё раз чуть позже.';
  }
  const text = String(message).replace(/^(Provider task failed|Generation failed):\s*/i, '').trim();
  // Уже по-русски и без латиницы провайдера — значит наше сообщение
  if (/[а-яё]/i.test(text) && !/[a-z]{4,}/i.test(text.replace(/\b(KIE|Evolink|Higgsfield|OpenRouter|Replicate)\b:?/gi, ''))) {
    return text;
  }
  if (isValidationError(message)) {
    return 'Нейросеть не приняла параметры запроса: проверьте промпт, фото и настройки. Спички возвращены.';
  }
  return 'Не удалось выполнить генерацию. Спички возвращены на баланс — попробуйте ещё раз или измените запрос.';
}
