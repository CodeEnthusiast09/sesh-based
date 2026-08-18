import {
  registerDecorator,
  ValidationArguments,
  ValidationOptions,
  ValidatorConstraint,
  ValidatorConstraintInterface,
} from 'class-validator';

/**
 * Decorator arguments are evaluated when the DTO module is first imported, which
 * happens before ConfigModule.forRoot() loads .env into process.env. So a plain
 * `@MinLength(Number(process.env.X))` would always read undefined.
 *
 * This constraint reads the value at *validation* time instead, by which point the
 * env has been loaded and validated. It is the one place process.env is read
 * outside config/, because DI is not available to a decorator.
 */
@ValidatorConstraint({ name: 'minLengthFromEnv', async: false })
class MinLengthFromEnvConstraint implements ValidatorConstraintInterface {
  validate(value: unknown, args: ValidationArguments): boolean {
    return typeof value === 'string' && value.length >= this.limit(args);
  }

  defaultMessage(args: ValidationArguments): string {
    return `${args.property} must be at least ${this.limit(args)} characters long`;
  }

  private limit(args: ValidationArguments): number {
    const [envKey] = args.constraints as [string];
    return Number(process.env[envKey]);
  }
}

export const MinLengthFromEnv =
  (envKey: string, validationOptions?: ValidationOptions) =>
  (object: object, propertyName: string): void => {
    registerDecorator({
      target: object.constructor,
      propertyName,
      options: validationOptions,
      constraints: [envKey],
      validator: MinLengthFromEnvConstraint,
    });
  };
