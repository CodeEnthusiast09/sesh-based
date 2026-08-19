import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CookieOptions, Request, Response } from 'express';

type SameSite = 'lax' | 'strict' | 'none';

/** Owns the cookie name and flags so login, logout and rotation cannot drift apart. */
@Injectable()
export class SessionCookieService {
  private readonly name: string;
  private readonly csrfName: string;
  private readonly options: CookieOptions;

  constructor(config: ConfigService) {
    this.name = config.getOrThrow<string>('session.cookieName');
    this.csrfName = config.getOrThrow<string>('csrf.cookieName');
    this.options = {
      // Blocks JavaScript from reading the cookie, so XSS cannot steal the session.
      httpOnly: true,
      // Refuses to send the cookie over plain HTTP. Must be true in production.
      secure: config.getOrThrow<boolean>('session.cookieSecure'),
      // First line of CSRF defence: the browser withholds the cookie cross-site.
      sameSite: config.getOrThrow<SameSite>('session.cookieSameSite'),
      domain: config.get<string>('session.cookieDomain'),
      path: '/',
    };
  }

  read(request: Request): string | undefined {
    const cookies = request.cookies as Record<string, string> | undefined;

    return cookies?.[this.name];
  }

  /**
   * maxAge tracks the absolute clock, not the idle one: a cookie that expired at
   * the idle deadline would log out an active user. The server still enforces
   * both clocks, so a cookie outliving its session is harmless.
   */
  set(response: Response, rawId: string, maxAgeSeconds: number): void {
    response.cookie(this.name, rawId, {
      ...this.options,
      maxAge: maxAgeSeconds * 1000,
    });
  }

  clear(response: Response): void {
    response.clearCookie(this.name, this.options);
    response.clearCookie(this.csrfName, { ...this.options, httpOnly: false });
  }

  /**
   * Deliberately NOT HttpOnly: the client has to read this one to echo it back
   * in a header. That is safe because a cross-site attacker cannot read cookies
   * belonging to another origin, and forging the header is what they cannot do.
   * The value only proves the request came from our own page, never who you are.
   */
  setCsrf(response: Response, token: string, maxAgeSeconds: number): void {
    response.cookie(this.csrfName, token, {
      ...this.options,
      httpOnly: false,
      maxAge: maxAgeSeconds * 1000,
    });
  }
}
