import { plainToInstance } from 'class-transformer';
import { SignupDto } from './signup.dto';

describe('SignupDto', () => {
  it('normalizes email to lowercase and trims whitespace', () => {
    const dto = plainToInstance(SignupDto, {
      email: '  Ada@Example.COM  ',
      password: 'password123',
    });

    expect(dto.email).toBe('ada@example.com');
  });

  it('leaves an already-normalized email unchanged', () => {
    const dto = plainToInstance(SignupDto, {
      email: 'ada@example.com',
      password: 'password123',
    });

    expect(dto.email).toBe('ada@example.com');
  });

  it('passes a non-string email through unchanged, leaving @IsEmail to reject it', () => {
    const dto = plainToInstance(SignupDto, { email: 12345, password: 'password123' });

    expect(dto.email).toBe(12345);
  });
});
