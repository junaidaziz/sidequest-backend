import { plainToInstance } from 'class-transformer';
import { LoginDto } from './login.dto';

describe('LoginDto', () => {
  it('normalizes email to lowercase and trims whitespace', () => {
    const dto = plainToInstance(LoginDto, {
      email: '  Ada@Example.COM  ',
      password: 'password123',
    });

    expect(dto.email).toBe('ada@example.com');
  });

  it('matches the normalization SignupDto applies, so casing differences never split an account', () => {
    const signupCasing = plainToInstance(LoginDto, {
      email: 'ADA@EXAMPLE.COM',
      password: 'password123',
    });

    expect(signupCasing.email).toBe('ada@example.com');
  });

  it('passes a non-string email through unchanged, leaving @IsEmail to reject it', () => {
    const dto = plainToInstance(LoginDto, { email: 12345, password: 'password123' });

    expect(dto.email).toBe(12345);
  });
});
