import {
  ConflictException,
  Injectable,
  OnModuleInit,
  UnauthorizedException,
} from '@nestjs/common';
import { randomBytes } from 'node:crypto';

import { IssuedSession, SessionService } from '../sessions/session.service';
import { PublicUser, toPublicUser } from '../users/user.types';
import { UsersService } from '../users/users.service';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';
import { PasswordService } from './password.service';

export interface LoginContext {
  userAgent: string | null;
  ip: string | null;
  /** Raw session ID from the incoming cookie, if the caller already had one. */
  currentSessionId?: string;
}

export interface LoginResult extends IssuedSession {
  user: PublicUser;
}

@Injectable()
export class AuthService implements OnModuleInit {
  /**
   * Verified against when the email is unknown, so a missing user costs the
   * same time as a wrong password. Without it, the response time alone reveals
   * which emails are registered.
   */
  private decoyHash: string;

  constructor(
    private readonly users: UsersService,
    private readonly passwords: PasswordService,
    private readonly sessions: SessionService,
  ) {}

  async onModuleInit(): Promise<void> {
    this.decoyHash = await this.passwords.hash(randomBytes(32).toString('hex'));
  }

  async register(dto: RegisterDto): Promise<PublicUser> {
    if (await this.users.existsByEmail(dto.email)) {
      throw new ConflictException('Email is already registered');
    }

    const passwordHash = await this.passwords.hash(dto.password);
    const user = await this.users.create(dto.email, passwordHash);

    return toPublicUser(user);
  }

  async login(dto: LoginDto, context: LoginContext): Promise<LoginResult> {
    const user = await this.users.findByEmailWithPassword(dto.email);
    const passwordMatches = await this.passwords.verify(
      user?.passwordHash ?? this.decoyHash,
      dto.password,
    );

    if (!user || !passwordMatches) {
      // One message for both cases, so the response cannot be used to test
      // whether an email is registered.
      throw new UnauthorizedException('Invalid email or password');
    }

    // Session fixation defence. A login always mints a brand new ID, so an
    // attacker-planted one is never adopted; this additionally retires the
    // session that arrived with the request instead of leaving it live. Only
    // this session is touched, so other devices stay logged in.
    if (context.currentSessionId !== undefined) {
      await this.sessions.destroy(context.currentSessionId);
    }

    const issued = await this.sessions.issue(user.id, {
      userAgent: context.userAgent,
      ip: context.ip,
      rememberMe: dto.rememberMe ?? false,
    });

    return { ...issued, user: toPublicUser(user) };
  }
}
