// src/modules/billing/providers/freedompay/freedompay.utils.ts
import { createHash, randomBytes } from 'crypto';
import { parseStringPromise, Builder } from 'xml2js';

export type SignableParams = Record<string, string | number | boolean | undefined | null>;

export function sign(scriptName: string, params: SignableParams, secret: string): string {
  const clean: Record<string, string> = {};
  for (const k of Object.keys(params)) {
    if (k === 'pg_sig') continue;
    const v = params[k];
    if (v === undefined || v === null) continue;
    clean[k] = String(v);
  }
  const sortedKeys = Object.keys(clean).sort();
  const parts = [scriptName, ...sortedKeys.map(k => clean[k]), secret];
  return createHash('md5').update(parts.join(';')).digest('hex');
}

export function verifySignature(
  scriptName: string,
  params: SignableParams,
  secret: string,
): boolean {
  const incoming = params['pg_sig'];
  if (!incoming) return false;
  return String(incoming).toLowerCase() === sign(scriptName, params, secret).toLowerCase();
}

export function generateSalt(len = 16): string {
  return randomBytes(len).toString('hex').slice(0, len);
}

export async function parseXmlResponse<T = any>(xml: string): Promise<T> {
  const parsed = await parseStringPromise(xml, { explicitArray: false, trim: true });
  return (parsed?.response ?? parsed) as T;
}

export function buildResponseXml(
  scriptName: string,
  body: Record<string, string>,
  secret: string,
): string {
  const salt = body.pg_salt ?? generateSalt();
  const payload = { ...body, pg_salt: salt };
  const pg_sig = sign(scriptName, payload, secret);
  const builder = new Builder({
    rootName: 'response',
    xmldec: { version: '1.0', encoding: 'utf-8' },
  });
  return builder.buildObject({ ...payload, pg_sig });
}