import { ConflictException, Injectable } from '@nestjs/common';

import { User } from '../users/entities/user.entity';
import { UsersService } from '../users/users.service';
import { PasswordService } from './password.service';
import { RegisterDto } from './dto/register.dto';

export interface PublicUser {
  id: string;
  email: string;
  createdAt: Date;
}

export const toPublicUser = (user: User): PublicUser => ({
  id: user.id,
  email: user.email,
  createdAt: user.createdAt,
});

@Injectable()
export class AuthService {
  constructor(
    private readonly users: UsersService,
    private readonly passwords: PasswordService,
  ) {}

  async register(dto: RegisterDto): Promise<PublicUser> {
    if (await this.users.existsByEmail(dto.email)) {
      throw new ConflictException('Email is already registered');
    }

    const passwordHash = await this.passwords.hash(dto.password);
    const user = await this.users.create(dto.email, passwordHash);

    return toPublicUser(user);
  }
}
