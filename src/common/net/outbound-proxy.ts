import { HttpsProxyAgent } from 'https-proxy-agent';

/**
 * Выход к зарубежным сервисам через второй сервер.
 *
 * Приложение живёт на сервере в РФ, а провайдеры нейросетей (KIE, OpenRouter,
 * Evolink, Replicate) и их файловые хранилища российские адреса не обслуживают.
 * Если задан OUTBOUND_PROXY_URL (например http://user:pass@1.2.3.4:8888),
 * запросы к ним идут через HTTP-прокси на зарубежном сервере. Переменная не
 * задана — всё ходит напрямую, как раньше.
 *
 * Через прокси НЕ идут: S3 Timeweb, платежи, почта, база — они в РФ.
 */
let cachedAgent: HttpsProxyAgent<string> | null | undefined;

function getAgent(): HttpsProxyAgent<string> | null {
  if (cachedAgent !== undefined) return cachedAgent;
  const url = (process.env.OUTBOUND_PROXY_URL || '').trim();
  cachedAgent = url ? new HttpsProxyAgent(url, { keepAlive: true }) : null;
  return cachedAgent;
}

/**
 * Настройки для axios: развернуть в axios.create({...}) или в опциях запроса.
 * `proxy: false` обязателен — иначе axios попробует собственную поддержку
 * прокси из переменных окружения поверх агента.
 */
export function outboundAxiosConfig(): {
  httpAgent?: HttpsProxyAgent<string>;
  httpsAgent?: HttpsProxyAgent<string>;
  proxy?: false;
} {
  const agent = getAgent();
  return agent ? { httpAgent: agent, httpsAgent: agent, proxy: false } : {};
}

/**
 * То же для Telegram Bot API. Отдельный рубильник TELEGRAM_USE_PROXY=true:
 * с российских серверов api.telegram.org обычно доступен напрямую, и гонять
 * бота через второй сервер без нужды незачем.
 */
export function telegramAgent(): HttpsProxyAgent<string> | undefined {
  if (process.env.TELEGRAM_USE_PROXY !== 'true') return undefined;
  return getAgent() ?? undefined;
}

export function telegramAxiosConfig(): {
  httpsAgent?: HttpsProxyAgent<string>;
  proxy?: false;
} {
  const agent = telegramAgent();
  return agent ? { httpsAgent: agent, proxy: false } : {};
}
