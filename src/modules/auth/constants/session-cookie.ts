export const SESSION_COOKIE_NAME = 'sirefo_session';

export function readSessionCookie(cookieHeader: string | undefined): string {
  if (!cookieHeader) return '';

  const prefix = `${SESSION_COOKIE_NAME}=`;
  const cookie = cookieHeader
    .split(';')
    .map((value) => value.trim())
    .find((value) => value.startsWith(prefix));
  return cookie?.slice(prefix.length) ?? '';
}
