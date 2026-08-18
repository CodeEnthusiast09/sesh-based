import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { User } from './entities/user.entity';

@Injectable()
export class UsersService {
  constructor(
    @InjectRepository(User)
    private readonly users: Repository<User>,
  ) {}

  /** Emails are compared and stored lowercased. */
  static normaliseEmail(email: string): string {
    return email.trim().toLowerCase();
  }

  async create(email: string, passwordHash: string): Promise<User> {
    const user = this.users.create({
      email: UsersService.normaliseEmail(email),
      passwordHash,
    });

    return this.users.save(user);
  }

  async findById(id: string): Promise<User | null> {
    return this.users.findOneBy({ id });
  }

  /** Includes the password hash, which is select: false on the entity. */
  async findByEmailWithPassword(email: string): Promise<User | null> {
    return this.users
      .createQueryBuilder('user')
      .addSelect('user.passwordHash')
      .where('user.email = :email', {
        email: UsersService.normaliseEmail(email),
      })
      .getOne();
  }

  async existsByEmail(email: string): Promise<boolean> {
    return this.users.existsBy({ email: UsersService.normaliseEmail(email) });
  }
}
