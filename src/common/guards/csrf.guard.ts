import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { constantTimeEquals } from '../../modules/sessions/session-id';
import { AuthenticatedRequest } from '../interfaces/authenticated-request.interface';

/** Methods that must not change state, so they need no CSRF token. */
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * Must run after SessionGuard, which is what puts the session on the request.
 * Declare it second: `@UseGuards(SessionGuard, CsrfGuard)`.
 *
 * The token lives on the session server-side rather than only in a cookie. Plain
 * double-submit compares a cookie against a header, which an attacker who can
 * write cookies on your domain (say, through a subdomain) can satisfy on both
 * sides. Checking against the stored value closes that.
 */
@Injectable()
export class CsrfGuard implements CanActivate {
  private readonly headerName: string;

  constructor(config: ConfigService) {
    this.headerName = config.getOrThrow<string>('csrf.headerName');
  }

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();

    if (SAFE_METHODS.has(request.method)) {
      return true;
    }

    if (!request.session) {
      throw new UnauthorizedException('Authentication required');
    }

    const provided = request.get(this.headerName);

    if (!provided || !constantTimeEquals(provided, request.session.csrfToken)) {
      throw new ForbiddenException('CSRF token missing or invalid');
    }

    return true;
  }
}
