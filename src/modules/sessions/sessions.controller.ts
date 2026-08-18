import {
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';

import { CurrentSession } from '../../common/decorators/current-session.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { SessionGuard } from '../../common/guards/session.guard';
import type { ApiResponse } from '../../common/interfaces/api-response.interface';
import { successResponse } from '../../common/utils/response.helper';
import type { PublicUser } from '../users/user.types';
import { SessionCookieService } from './session-cookie.service';
import { SessionService } from './session.service';
import { toPublicSession } from './session.types';
import type { PublicSession, SessionRecord } from './session.types';

@Controller('sessions')
@UseGuards(SessionGuard)
export class SessionsController {
  constructor(
    private readonly sessions: SessionService,
    private readonly cookies: SessionCookieService,
  ) {}

  @Get()
  async list(
    @CurrentUser() user: PublicUser,
    @CurrentSession() session: SessionRecord,
  ): Promise<ApiResponse<PublicSession[]>> {
    const active = await this.sessions.listForUser(user.id);

    return successResponse(
      'Active sessions retrieved',
      active.map((record) => toPublicSession(record, session.id)),
    );
  }

  /** Revoking every other session, the "log out everywhere else" button. */
  @Delete()
  @HttpCode(HttpStatus.OK)
  async revokeOthers(
    @CurrentUser() user: PublicUser,
    @CurrentSession() session: SessionRecord,
  ): Promise<ApiResponse<{ revoked: number }>> {
    const revoked = await this.sessions.revokeOthers(user.id, session.id);

    return successResponse('Other sessions revoked', { revoked });
  }

  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  async revoke(
    @Param('id') id: string,
    @CurrentUser() user: PublicUser,
    @CurrentSession() session: SessionRecord,
    @Res({ passthrough: true }) response: Response,
  ): Promise<ApiResponse> {
    await this.sessions.revokeById(user.id, id);

    // Revoking the session you are currently using is allowed; it is just a
    // logout, so the now-dead cookie is cleared rather than left behind.
    if (id === session.id) {
      this.cookies.clear(response);
    }

    return successResponse('Session revoked');
  }
}
