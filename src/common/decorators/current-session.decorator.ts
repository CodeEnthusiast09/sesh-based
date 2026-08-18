import { createParamDecorator, ExecutionContext } from '@nestjs/common';

import { SessionRecord } from '../../modules/sessions/session.types';
import { AuthenticatedRequest } from '../interfaces/authenticated-request.interface';

/** Only valid on routes behind SessionGuard, which is what populates it. */
export const CurrentSession = createParamDecorator(
  (_data: unknown, context: ExecutionContext): SessionRecord =>
    context.switchToHttp().getRequest<AuthenticatedRequest>().session,
);
