import { ConfigService } from '@nestjs/config';

const sendPushNotificationsAsync = jest.fn();
const getPushNotificationReceiptsAsync = jest.fn();
const isExpoPushToken = jest.fn();
const expoConstructor = jest.fn();

// Mock the SDK so the adapter is exercised without the network or real creds.
jest.mock('expo-server-sdk', () => {
  class MockExpo {
    static pushNotificationChunkSizeLimit = 2;
    static isExpoPushToken = (token: unknown): boolean => isExpoPushToken(token);
    constructor(options: unknown) {
      expoConstructor(options);
    }
    sendPushNotificationsAsync = sendPushNotificationsAsync;
    getPushNotificationReceiptsAsync = getPushNotificationReceiptsAsync;
  }
  return { Expo: MockExpo };
});

// Imported after the mock is registered.
import { ExpoPushClient } from './expo-push.client';

function build(accessToken?: string): ExpoPushClient {
  const config = {
    get: jest.fn((key: string) => (key === 'EXPO_ACCESS_TOKEN' ? accessToken : undefined)),
  } as unknown as ConfigService;
  return new ExpoPushClient(config);
}

describe('ExpoPushClient', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('constructs the SDK with an undefined access token when none is configured', () => {
    build();
    expect(expoConstructor).toHaveBeenCalledWith({ accessToken: undefined });
  });

  it('passes a configured access token through to the SDK', () => {
    build('secret-token');
    expect(expoConstructor).toHaveBeenCalledWith({ accessToken: 'secret-token' });
  });

  it('delegates token validation to the SDK', () => {
    isExpoPushToken.mockReturnValue(true);
    const client = build();

    expect(client.isValidToken('ExponentPushToken[x]')).toBe(true);
    expect(isExpoPushToken).toHaveBeenCalledWith('ExponentPushToken[x]');
  });

  it('chunks messages at the provider size limit', () => {
    const client = build();
    const messages = [
      { to: 'a', title: 't', body: 'b' },
      { to: 'b', title: 't', body: 'b' },
      { to: 'c', title: 't', body: 'b' },
    ];

    const chunks = client.chunk(messages);

    // limit is 2 => [[a,b],[c]]
    expect(chunks).toHaveLength(2);
    expect(chunks[0]).toHaveLength(2);
    expect(chunks[1]).toHaveLength(1);
  });

  it('maps SDK tickets to provider-neutral tickets', async () => {
    sendPushNotificationsAsync.mockResolvedValue([
      { status: 'ok', id: 'r-1' },
      { status: 'error', message: 'bad', details: { error: 'DeviceNotRegistered' } },
    ]);
    const client = build();

    const tickets = await client.send([
      { to: 'a', title: 't', body: 'b', data: { screen: 's' } },
      { to: 'b', title: 't', body: 'b' },
    ]);

    expect(tickets[0]).toEqual({ status: 'ok', id: 'r-1' });
    expect(tickets[1]).toEqual({
      status: 'error',
      message: 'bad',
      details: { error: 'DeviceNotRegistered' },
    });
    // The message is shaped for the SDK (sound default, data forwarded).
    const sent = sendPushNotificationsAsync.mock.calls[0][0];
    expect(sent[0]).toMatchObject({ to: 'a', title: 't', body: 'b', data: { screen: 's' } });
  });

  it('maps SDK receipts to provider-neutral receipts', async () => {
    getPushNotificationReceiptsAsync.mockResolvedValue({
      'r-1': { status: 'ok' },
      'r-2': { status: 'error', message: 'gone', details: { error: 'DeviceNotRegistered' } },
    });
    const client = build();

    const receipts = await client.getReceipts(['r-1', 'r-2']);

    expect(receipts['r-1']).toEqual({ status: 'ok' });
    expect(receipts['r-2']).toEqual({
      status: 'error',
      message: 'gone',
      details: { error: 'DeviceNotRegistered' },
    });
  });
});
