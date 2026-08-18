import { Request } from 'express';

import { SessionRecord } from '../../modules/sessions/session.types';
import { PublicUser } from '../../modules/users/user.types';

/**
 * What SessionGuard attaches to the request. Declared as its own type rather
 * than a global Express augmentation, so a handler that has not passed the
 * guard cannot silently claim these fields exist.
 */
export interface AuthenticatedRequest extends Request {
  session: SessionRecord;
  user: PublicUser;
}
