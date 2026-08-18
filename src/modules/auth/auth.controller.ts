import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';

import { ApiResponse } from '../../common/interfaces/api-response.interface';
import { successResponse } from '../../common/utils/response.helper';
import { AuthService, PublicUser } from './auth.service';
import { RegisterDto } from './dto/register.dto';

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Post('register')
  @HttpCode(HttpStatus.CREATED)
  async register(@Body() dto: RegisterDto): Promise<ApiResponse<PublicUser>> {
    const user = await this.auth.register(dto);

    return successResponse('Registration successful', user);
  }
}
