import { User } from './entities/user.entity';

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
