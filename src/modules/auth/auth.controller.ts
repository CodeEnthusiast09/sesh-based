import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Request, Response } from 'express';

import { CurrentSession } from '../../common/decorators/current-session.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { CsrfGuard } from '../../common/guards/csrf.guard';
import { SessionGuard } from '../../common/guards/session.guard';
import type { ApiResponse } from '../../common/interfaces/api-response.interface';
import { successResponse } from '../../common/utils/response.helper';
import { SessionCookieService } from '../sessions/session-cookie.service';
import type { SessionRecord } from '../sessions/session.types';
import { SessionService } from '../sessions/session.service';
import type { PublicUser } from '../users/user.types';
import { AuthService } from './auth.service';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';

@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly sessions: SessionService,
    private readonly cookies: SessionCookieService,
  ) {}

  @Post('register')
  @Throttle({ auth: {} })
  @HttpCode(HttpStatus.CREATED)
  async register(@Body() dto: RegisterDto): Promise<ApiResponse<PublicUser>> {
    const user = await this.auth.register(dto);

    return successResponse('Registration successful', user);
  }

  // The brute-force and credential-stuffing target, so it gets the strict
  // limiter rather than the generous default.
  @Post('login')
  @Throttle({ auth: {} })
  @HttpCode(HttpStatus.OK)
  async login(
    @Body() dto: LoginDto,
    @Req() request: Request,
    // passthrough keeps Nest's normal serialisation; we only want to set a cookie.
    @Res({ passthrough: true }) response: Response,
  ): Promise<ApiResponse<PublicUser>> {
    const result = await this.auth.login(dto, {
      userAgent: request.get('user-agent') ?? null,
      ip: request.ip ?? null,
      currentSessionId: this.cookies.read(request),
    });

    this.cookies.set(response, result.rawId, result.maxAgeSeconds);
    this.cookies.setCsrf(
      response,
      result.session.csrfToken,
      result.maxAgeSeconds,
    );

    return successResponse('Login successful', result.user);
  }

  @Post('logout')
  @UseGuards(SessionGuard, CsrfGuard)
  @HttpCode(HttpStatus.OK)
  async logout(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<ApiResponse> {
    const rawId = this.cookies.read(request);

    if (rawId) {
      await this.sessions.destroy(rawId);
    }

    this.cookies.clear(response);

    return successResponse('Logout successful');
  }

  @Get('me')
  @UseGuards(SessionGuard)
  me(@CurrentUser() user: PublicUser): ApiResponse<PublicUser> {
    return successResponse('Session is active', user);
  }

  /**
   * For clients that cannot read the CSRF cookie (native apps, or a browser
   * client that would rather fetch it explicitly). Safe to expose: it is scoped
   * to the caller's own session and proves nothing about identity on its own.
   */
  @Get('csrf')
  @UseGuards(SessionGuard)
  csrf(
    @CurrentSession() session: SessionRecord,
  ): ApiResponse<{ csrfToken: string }> {
    return successResponse('CSRF token retrieved', {
      csrfToken: session.csrfToken,
    });
  }
}
