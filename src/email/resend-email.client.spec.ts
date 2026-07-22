import { ConfigService } from '@nestjs/config';
import { ResendEmailClient } from './resend-email.client';

describe('ResendEmailClient', () => {
  const config = {
    getOrThrow: (key: string) =>
      ({ RESEND_API_KEY: 're_test', EMAIL_FROM: 'SideQuest <admin@example.com>' })[key],
  } as ConfigService;

  afterEach(() => jest.restoreAllMocks());

  it('sends through the HTTPS API and returns the provider id', async () => {
    const fetchMock = jest
      .spyOn(global, 'fetch')
      .mockResolvedValue(new Response(JSON.stringify({ id: 'email-1' }), { status: 200 }));
    const result = await new ResendEmailClient(config).send({
      to: 'a@b.com',
      subject: 'S',
      html: 'H',
    });
    expect(result).toEqual({ status: 'ok', id: 'email-1' });
    expect(fetchMock).toHaveBeenCalledWith('https://api.resend.com/emails', expect.anything());
  });

  it('returns an error result for provider failures', async () => {
    jest
      .spyOn(global, 'fetch')
      .mockResolvedValue(new Response(JSON.stringify({ message: 'denied' }), { status: 403 }));
    await expect(
      new ResendEmailClient(config).send({ to: 'a@b.com', subject: 'S', html: 'H' }),
    ).resolves.toEqual({ status: 'error', message: 'denied' });
  });
});
