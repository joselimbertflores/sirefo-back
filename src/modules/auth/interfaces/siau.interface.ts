export interface SiauAccessTokenClaims {
  exp: number;
  externalKey: string;
  name: string;
  sid: string;
}

export interface SiauTokenSet {
  accessToken: string;
  refreshToken: string | null;
  accessTokenExpiresAt: Date;
  refreshTokenExpiresAt: Date | null;
  claims: SiauAccessTokenClaims;
}

export interface SiauTokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in?: number;
  refresh_expires_in?: number;
  token_type?: string;
}
