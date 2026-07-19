import { registerDecorator, ValidationArguments, ValidationOptions } from 'class-validator';

/** Admin-surface password policy: 12+ chars and at least 3 of 4 character classes. */
export const ADMIN_PASSWORD_MIN_LENGTH = 12;
const CHAR_CLASSES = [/[a-z]/, /[A-Z]/, /[0-9]/, /[^A-Za-z0-9]/];
const MIN_CLASSES = 3;

/** Pure predicate — reused by both the decorator and any service-layer re-check. */
export function meetsAdminPasswordPolicy(value: unknown): boolean {
  if (typeof value !== 'string' || value.length < ADMIN_PASSWORD_MIN_LENGTH) {
    return false;
  }
  const classes = CHAR_CLASSES.filter((re) => re.test(value)).length;
  return classes >= MIN_CLASSES;
}

/**
 * Reusable class-validator decorator enforcing the admin password policy. Kept
 * separate from the user-auth 8-char rule (intentionally out of scope) — closes
 * security finding W6 for the admin surface only.
 */
export function IsAdminPassword(validationOptions?: ValidationOptions) {
  return function (object: object, propertyName: string): void {
    registerDecorator({
      name: 'isAdminPassword',
      target: object.constructor,
      propertyName,
      options: validationOptions,
      validator: {
        validate(value: unknown): boolean {
          return meetsAdminPasswordPolicy(value);
        },
        defaultMessage(args: ValidationArguments): string {
          return `${args.property} must be at least ${ADMIN_PASSWORD_MIN_LENGTH} characters and include at least ${MIN_CLASSES} of: lowercase, uppercase, digit, symbol`;
        },
      },
    });
  };
}
