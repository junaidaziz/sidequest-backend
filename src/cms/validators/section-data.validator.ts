import { CmsSectionType } from '@prisma/client';
import { plainToInstance } from 'class-transformer';
import {
  registerDecorator,
  validateSync,
  ValidationArguments,
  ValidationError,
  ValidationOptions,
  ValidatorConstraint,
  ValidatorConstraintInterface,
} from 'class-validator';
import { SECTION_DATA_CLASSES } from '../dto/section-data.dto';

/**
 * Validates a `CmsSection.data` payload against the schema selected by the
 * sibling `type` field. This is what turns the `data: Json` column from a
 * freeform (XSS-prone) blob into a strongly-typed, per-type-validated structure.
 *
 * If `type` is absent (e.g. a partial update that sends `data` without `type`)
 * the payload is rejected — the type is required to know which schema to apply,
 * so the frontend must always send both together.
 */
@ValidatorConstraint({ name: 'isValidSectionData', async: false })
export class IsValidSectionDataConstraint implements ValidatorConstraintInterface {
  private lastMessage = 'data is invalid for the given section type';

  validate(value: unknown, args: ValidationArguments): boolean {
    const type = (args.object as { type?: CmsSectionType }).type;
    if (!type) {
      this.lastMessage = 'type is required to validate section data';
      return false;
    }
    const cls = SECTION_DATA_CLASSES[type];
    if (!cls) {
      this.lastMessage = `unknown section type: ${String(type)}`;
      return false;
    }
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
      this.lastMessage = 'data must be an object';
      return false;
    }

    const instance = plainToInstance(cls, value, { enableImplicitConversion: false });
    const errors = validateSync(instance as object, {
      whitelist: true,
      forbidNonWhitelisted: true,
      forbidUnknownValues: true,
    });
    if (errors.length > 0) {
      this.lastMessage = `data invalid for ${type}: ${flattenErrors(errors).join('; ')}`;
      return false;
    }
    return true;
  }

  defaultMessage(): string {
    return this.lastMessage;
  }
}

/** Property decorator applying the per-type section-data validation. */
export function IsValidSectionData(options?: ValidationOptions): PropertyDecorator {
  return (object: object, propertyName: string | symbol): void => {
    registerDecorator({
      name: 'isValidSectionData',
      target: object.constructor,
      propertyName: propertyName as string,
      options,
      validator: IsValidSectionDataConstraint,
    });
  };
}

function flattenErrors(errors: ValidationError[], parent = ''): string[] {
  const messages: string[] = [];
  for (const error of errors) {
    const path = parent ? `${parent}.${error.property}` : error.property;
    if (error.constraints) {
      messages.push(...Object.values(error.constraints).map((m) => `${path}: ${m}`));
    }
    if (error.children && error.children.length > 0) {
      messages.push(...flattenErrors(error.children, path));
    }
  }
  return messages;
}
