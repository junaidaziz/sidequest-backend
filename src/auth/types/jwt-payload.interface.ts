/**
 * Discriminates access tokens from refresh tokens so a refresh token can never
 * be used to authenticate a request, and vice versa.
 */
export enum TokenType {
  Access = 'access',
  Refresh = 'refresh',
}

/** Signed JWT payload for both access and refresh tokens. */
export interface JwtPayload {
  /** Subject — the User id. */
  sub: string;
  /** Whether the subject is currently an anonymous guest. */
  isGuest: boolean;
  /** Token kind — enforced by the strategy and the refresh flow. */
  type: TokenType;
  /** Unique id, present on refresh tokens so each rotation is distinct. */
  jti?: string;
}

/**
 * The authenticated principal attached to `request.user` by JwtStrategy and
 * surfaced to controllers via the `@CurrentUser()` decorator.
 */
export interface AuthUser {
  userId: string;
  email: string | null;
  isGuest: boolean;
}
