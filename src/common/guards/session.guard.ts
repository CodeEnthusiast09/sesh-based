import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';

import { SessionCookieService } from '../../modules/sessions/session-cookie.service';
import { SessionService } from '../../modules/sessions/session.service';
import { AuthenticatedRequest } from '../interfaces/authenticated-request.interface';

@Injectable()
export class SessionGuard implements CanActivate {
  constructor(
    private readonly sessions: SessionService,
    private readonly cookies: SessionCookieService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const rawId = this.cookies.read(request);

    if (!rawId) {
      throw new UnauthorizedException('Authentication required');
    }

    const resolved = await this.sessions.resolve(rawId);

    if (!resolved) {
      // Deliberately the same message for expired, unknown and orphaned
      // sessions: the client cannot act on the difference, and separating them
      // tells an attacker which session IDs once existed.
      throw new UnauthorizedException('Session is invalid or has expired');
    }

    request.session = resolved.session;
    request.user = resolved.user;

    return true;
  }
}
