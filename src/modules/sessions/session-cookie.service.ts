import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CookieOptions, Request, Response } from 'express';

type SameSite = 'lax' | 'strict' | 'none';

/** Owns the cookie name and flags so login, logout and rotation cannot drift apart. */
@Injectable()
export class SessionCookieService {
  private readonly name: string;
  private readonly options: CookieOptions;

  constructor(config: ConfigService) {
    this.name = config.getOrThrow<string>('session.cookieName');
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
  }
}
