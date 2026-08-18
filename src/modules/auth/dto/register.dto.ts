import { IsEmail, IsString } from 'class-validator';

import { MinLengthFromEnv } from '../../../common/validators/min-length-from-env.validator';

export class RegisterDto {
  @IsEmail()
  email: string;

  @IsString()
  @MinLengthFromEnv('PASSWORD_MIN_LENGTH')
  password: string;
}
