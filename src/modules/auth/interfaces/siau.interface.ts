export interface SiauIdentity {
  sub: string;
  externalKey: string;
  name: string;
  sid: string;
}

export interface SiauAssignableUser {
  externalKey: string;
  fullName: string;
  email: string | null;
  login: string;
}
