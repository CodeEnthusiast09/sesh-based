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
import type { Request, Response } from 'express';

import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { SessionGuard } from '../../common/guards/session.guard';
import type { ApiResponse } from '../../common/interfaces/api-response.interface';
import { successResponse } from '../../common/utils/response.helper';
import { SessionCookieService } from '../sessions/session-cookie.service';
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
  @HttpCode(HttpStatus.CREATED)
  async register(@Body() dto: RegisterDto): Promise<ApiResponse<PublicUser>> {
    const user = await this.auth.register(dto);

    return successResponse('Registration successful', user);
  }

  @Post('login')
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
    });

    this.cookies.set(response, result.rawId, result.maxAgeSeconds);

    return successResponse('Login successful', result.user);
  }

  @Post('logout')
  @UseGuards(SessionGuard)
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
}
