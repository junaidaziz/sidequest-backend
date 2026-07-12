import { BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { StorageService } from './storage.service';

jest.mock('@aws-sdk/s3-request-presigner');

/** Config stub covering both LocalStack (endpoint set) and prod (endpoint unset). */
function buildConfig(overrides: Record<string, string | undefined> = {}): ConfigService {
  const values: Record<string, string | undefined> = {
    S3_ENDPOINT: 'http://localhost:4566',
    S3_FORCE_PATH_STYLE: 'true',
    S3_REGION: 'us-east-1',
    S3_BUCKET: 'sidequest-proofs-dev',
    AWS_ACCESS_KEY_ID: 'test',
    AWS_SECRET_ACCESS_KEY: 'test',
    ...overrides,
  };
  const stub = {
    get: jest.fn((key: string) => values[key]),
    getOrThrow: jest.fn((key: string) => {
      const value = values[key];
      if (value === undefined) {
        throw new Error(`Missing config ${key}`);
      }
      return value;
    }),
  };
  return stub as unknown as ConfigService;
}

describe('StorageService', () => {
  let service: StorageService;
  let sendSpy: jest.SpyInstance;

  beforeEach(() => {
    // Stub the network call so unit tests never touch LocalStack/AWS.
    sendSpy = jest.spyOn(S3Client.prototype, 'send').mockResolvedValue(undefined as never);
    jest.mocked(getSignedUrl).mockResolvedValue('https://signed.example/proof');
    service = new StorageService(buildConfig());
  });

  afterEach(() => {
    jest.restoreAllMocks();
    jest.clearAllMocks();
  });

  describe('construction', () => {
    it('constructs without an endpoint (production AWS path)', () => {
      expect(() => new StorageService(buildConfig({ S3_ENDPOINT: undefined }))).not.toThrow();
    });

    it('throws if a required credential/bucket var is missing', () => {
      expect(() => new StorageService(buildConfig({ S3_BUCKET: undefined }))).toThrow();
    });
  });

  describe('buildProofKey', () => {
    it.each([
      ['image/jpeg', 'jpg'],
      ['image/png', 'png'],
      ['image/webp', 'webp'],
    ])('maps %s to a proofs/<userId>/<uuid>.%s key', (mime, ext) => {
      const key = service.buildProofKey('user-123', mime);
      expect(key).toMatch(new RegExp(`^proofs/user-123/[0-9a-f-]{36}\\.${ext}$`));
    });

    it('rejects an unsupported MIME type with 400', () => {
      expect(() => service.buildProofKey('user-123', 'image/gif')).toThrow(BadRequestException);
    });
  });

  describe('uploadObject', () => {
    it('sends a PutObjectCommand to the configured bucket', async () => {
      const body = Buffer.from('bytes');
      await service.uploadObject('proofs/u/abc.png', body, 'image/png');

      expect(sendSpy).toHaveBeenCalledTimes(1);
      const command = sendSpy.mock.calls[0][0];
      expect(command).toBeInstanceOf(PutObjectCommand);
      expect(command.input).toMatchObject({
        Bucket: 'sidequest-proofs-dev',
        Key: 'proofs/u/abc.png',
        Body: body,
        ContentType: 'image/png',
      });
    });
  });

  describe('getSignedDownloadUrl', () => {
    it('returns a presigned URL with a 15-minute TTL', async () => {
      const url = await service.getSignedDownloadUrl('proofs/u/abc.png');

      expect(url).toBe('https://signed.example/proof');
      expect(getSignedUrl).toHaveBeenCalledTimes(1);
      const [, , options] = jest.mocked(getSignedUrl).mock.calls[0];
      expect(options).toEqual({ expiresIn: 900 });
    });
  });
});
