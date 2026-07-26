import { MediaPurpose, MediaStatus } from '@prisma/client';
import { Job } from 'bullmq';
import sharp from 'sharp';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import { MediaProcessingProcessor } from './media-processing.processor';
import { GenerateVariantsJobData } from './media.constants';
import { AVATAR_VARIANTS } from './media-variant-presets';

const MEDIA_ID = 'media-1';
const ORIGINAL_KEY = 'avatars/user-1/original.png';

function job(): Job<GenerateVariantsJobData> {
  return { data: { mediaAssetId: MEDIA_ID } } as Job<GenerateVariantsJobData>;
}

function avatarAsset(overrides: Record<string, unknown> = {}) {
  return {
    id: MEDIA_ID,
    purpose: MediaPurpose.AVATAR,
    status: MediaStatus.UPLOADED,
    originalKey: ORIGINAL_KEY,
    ...overrides,
  };
}

async function realSourceImage(): Promise<Buffer> {
  // A real, decodable 50x50 PNG — generated with sharp itself so this test
  // exercises the actual resize/re-encode pipeline rather than a mocked
  // sharp API, which would be brittle and would never catch a real
  // integration break in the resize/webp/EXIF chain.
  return sharp({
    create: { width: 50, height: 50, channels: 3, background: { r: 10, g: 20, b: 30 } },
  })
    .png()
    .toBuffer();
}

describe('MediaProcessingProcessor', () => {
  let processor: MediaProcessingProcessor;
  let prisma: {
    mediaAsset: { findUnique: jest.Mock; update: jest.Mock };
    mediaVariant: { upsert: jest.Mock };
    $transaction: jest.Mock;
  };
  let storage: { downloadObject: jest.Mock; uploadObject: jest.Mock };

  beforeEach(() => {
    prisma = {
      mediaAsset: {
        findUnique: jest.fn(),
        update: jest.fn().mockResolvedValue(undefined),
      },
      mediaVariant: {
        upsert: jest.fn().mockResolvedValue(undefined),
      },
      $transaction: jest.fn((ops: Promise<unknown>[]) => Promise.all(ops)),
    };
    storage = {
      downloadObject: jest.fn(),
      uploadObject: jest.fn().mockResolvedValue(undefined),
    };
    processor = new MediaProcessingProcessor(
      prisma as unknown as PrismaService,
      storage as unknown as StorageService,
    );
  });

  it('generates every avatar variant, uploads each, and flips status to READY', async () => {
    prisma.mediaAsset.findUnique.mockResolvedValue(avatarAsset());
    storage.downloadObject.mockResolvedValue(await realSourceImage());

    await processor.process(job());

    const variantNames = Object.keys(AVATAR_VARIANTS);
    expect(storage.uploadObject).toHaveBeenCalledTimes(variantNames.length);
    expect(prisma.mediaVariant.upsert).toHaveBeenCalledTimes(variantNames.length);

    for (const name of variantNames) {
      const preset = AVATAR_VARIANTS[name];
      const call = prisma.mediaVariant.upsert.mock.calls.find(
        ([args]: [{ where: { mediaAssetId_name: { name: string } } }]) =>
          args.where.mediaAssetId_name.name === name,
      );
      expect(call).toBeDefined();
      const [args] = call as [
        {
          where: { mediaAssetId_name: { mediaAssetId: string; name: string } };
          create: { format: string; width: number; height: number; objectKey: string };
        },
      ];
      expect(args.where.mediaAssetId_name).toEqual({ mediaAssetId: MEDIA_ID, name });
      expect(args.create.format).toBe('webp');
      // AVATAR is a square (cover-fit) purpose — output dims match the preset exactly.
      expect(args.create.width).toBe(preset.width);
      expect(args.create.height).toBe(preset.height);
      expect(args.create.objectKey).toBe(`avatars/user-1/original/${name}.webp`);
    }

    expect(prisma.mediaAsset.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: MEDIA_ID },
        data: expect.objectContaining({ status: MediaStatus.READY, failureReason: null }),
      }),
    );
    // PROCESSING is set once up front, READY once at the end.
    expect(prisma.mediaAsset.update).toHaveBeenCalledWith({
      where: { id: MEDIA_ID },
      data: { status: MediaStatus.PROCESSING },
    });
  });

  it('flips status to FAILED and rethrows when the original is not a decodable image', async () => {
    prisma.mediaAsset.findUnique.mockResolvedValue(avatarAsset());
    storage.downloadObject.mockResolvedValue(Buffer.from('not an image'));

    await expect(processor.process(job())).rejects.toThrow();

    expect(prisma.mediaAsset.update).toHaveBeenCalledWith({
      where: { id: MEDIA_ID },
      data: { status: MediaStatus.FAILED, failureReason: expect.any(String) },
    });
    expect(storage.uploadObject).not.toHaveBeenCalled();
  });

  it('no-ops when the media asset no longer exists', async () => {
    prisma.mediaAsset.findUnique.mockResolvedValue(null);

    await processor.process(job());

    expect(prisma.mediaAsset.update).not.toHaveBeenCalled();
    expect(storage.downloadObject).not.toHaveBeenCalled();
  });

  it('no-ops when the asset is already READY (retried/duplicate job)', async () => {
    prisma.mediaAsset.findUnique.mockResolvedValue(avatarAsset({ status: MediaStatus.READY }));

    await processor.process(job());

    expect(prisma.mediaAsset.update).not.toHaveBeenCalled();
    expect(storage.downloadObject).not.toHaveBeenCalled();
  });
});
