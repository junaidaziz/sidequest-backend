import { NoOpEmailClient } from './noop-email.client';

describe('NoOpEmailClient', () => {
  it('returns a stub ok result without throwing', async () => {
    const client = new NoOpEmailClient();
    const result = await client.send({ to: 'a@b.com', subject: 's', html: 'h' });
    expect(result).toEqual({ status: 'ok', id: 'noop' });
  });
});
