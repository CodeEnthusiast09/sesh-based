import { createParamDecorator, ExecutionContext } from '@nestjs/common';

import { PublicUser } from '../../modules/users/user.types';
import { AuthenticatedRequest } from '../interfaces/authenticated-request.interface';

/** Only valid on routes behind SessionGuard, which is what populates it. */
export const CurrentUser = createParamDecorator(
  (_data: unknown, context: ExecutionContext): PublicUser =>
    context.switchToHttp().getRequest<AuthenticatedRequest>().user,
);
