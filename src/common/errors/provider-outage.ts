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
  /too many requests|rate.?limit|overload|capacity|busy|unavailable|maintenance/i,
  /bad gateway|gateway|internal (server )?error|server error|upstream/i,
  /insufficient (credits?|balance|funds|quota)|not enough credits?|quota exceeded|credits? (are )?(insufficient|exhausted)/i,
  /all providers failed|no providers available|provider_error|unknown (provider )?error/i,
  /empty response|no response|no (images?|message|result|output) (returned|in response)/i,
  /consecutive errors|did not complete/i,
];

export function isProviderOutage(message: string | null | undefined): boolean {
  if (!message || !message.trim()) return true;
  return OUTAGE_PATTERNS.some((re) => re.test(message));
}

// refunded — спички были списаны заранее и возвращены (картинки/видео/аудио);
// в чате списание идёт только после успешного ответа.
export function userFacingProviderError(
  message: string | null | undefined,
  opts: { refunded: boolean },
): string {
  if (!isProviderOutage(message)) return message as string;
  return opts.refunded
    ? 'Нейросеть сейчас не отвечает. Спички возвращены на баланс — попробуйте ещё раз чуть позже.'
    : 'Нейросеть сейчас не отвечает. Спички не списаны — попробуйте ещё раз чуть позже.';
}
