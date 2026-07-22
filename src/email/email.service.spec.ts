import { EmailProviderClient } from './email-provider.interface';
import { EmailService } from './email.service';

describe('EmailService', () => {
  let client: { send: jest.Mock };
  let service: EmailService;

  beforeEach(() => {
    client = { send: jest.fn().mockResolvedValue({ status: 'ok', id: 'x' }) };
    service = new EmailService(client as unknown as EmailProviderClient);
  });

  it('delegates a raw message to the provider', async () => {
    const message = { to: 'a@b.com', subject: 's', html: '<p>h</p>' };
    const result = await service.send(message);
    expect(client.send).toHaveBeenCalledWith(message);
    expect(result.status).toBe('ok');
  });

  it('logs but does not throw when the provider returns an error result', async () => {
    client.send.mockResolvedValue({ status: 'error', message: 'boom' });
    const result = await service.send({ to: 'a@b.com', subject: 's', html: 'h' });
    expect(result.status).toBe('error');
  });

  it('swallows a thrown provider error and returns an error result', async () => {
    client.send.mockRejectedValue(new Error('network'));
    const result = await service.send({ to: 'a@b.com', subject: 's', html: 'h' });
    expect(result).toEqual({ status: 'error', message: 'provider threw' });
  });

  it('composes a password-reset email with the reset url', async () => {
    await service.sendAdminPasswordReset('a@b.com', 'https://x/reset?token=abc');
    const message = client.send.mock.calls[0][0];
    expect(message.to).toBe('a@b.com');
    expect(message.subject).toContain('Reset');
    expect(message.html).toContain('https://x/reset?token=abc');
    expect(message.text).toContain('https://x/reset?token=abc');
  });

  it('composes an invite email with the inviter name and accept url', async () => {
    await service.sendAdminInvite('a@b.com', 'Owner', 'https://x/accept?token=abc');
    const message = client.send.mock.calls[0][0];
    expect(message.html).toContain('Owner');
    expect(message.html).toContain('https://x/accept?token=abc');
  });

  it('escapes dynamic HTML text and attribute values while preserving plain text', async () => {
    await service.sendAdminInvite(
      'a@b.com',
      '<img src=x onerror=alert(1)>',
      'https://x/accept?x=" onmouseover="bad',
    );
    const message = client.send.mock.calls[0][0];
    expect(message.html).not.toContain('<img');
    expect(message.html).toContain('&lt;img');
    expect(message.html).toContain('&quot; onmouseover=&quot;bad');
    expect(message.text).toContain('<img src=x onerror=alert(1)>');
  });
});
