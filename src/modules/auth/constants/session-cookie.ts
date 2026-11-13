import type { CookieOptions } from 'express';

export const SESSION_COOKIE_NAME = 'sirefo_session';
export const OAUTH_TRANSACTION_COOKIE_NAME = 'sirefo_oauth_transaction';
export const OAUTH_TRANSACTION_COOKIE_PATH = '/auth';
export const OAUTH_TRANSACTION_TTL_MS = 5 * 60 * 1000;

export function getSessionCookieOptions(publicUrl: string, nodeEnv?: string): CookieOptions {
  return {
    httpOnly: true,
    path: '/',
    sameSite: 'lax',
    secure: new URL(publicUrl).protocol === 'https:' || nodeEnv === 'production',
  };
}

export function readSessionCookie(cookieHeader: string | undefined, name = SESSION_COOKIE_NAME): string {
  if (!cookieHeader) return '';

  const prefix = `${name}=`;
  const cookie = cookieHeader
    .split(';')
    .map((value) => value.trim())
    .find((value) => value.startsWith(prefix));
  return cookie?.slice(prefix.length) ?? '';
}
