import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import type { Shot, VideoClipMetadata, VideoGenerationOptions } from '../../shared/schema'

function sha256(value: string | Buffer): string {
  return createHash('sha256').update(value).digest('hex')
}

async function imageHash(source: string): Promise<string> {
  if (/^(?:https?:|data:)/i.test(source)) return sha256(source)
  try {
    return sha256(await readFile(source))
  } catch {
    return sha256(source)
  }
}

export async function createVideoClipMetadata(
  shot: Shot,
  imageSource: string,
  provider: string,
  model: string,
  options: VideoGenerationOptions
): Promise<VideoClipMetadata> {
  return {
    provider,
    model,
    ...options,
    promptHash: sha256(shot.videoPrompt || shot.prompt || shot.visual),
    imageHash: await imageHash(imageSource),
    generatedAt: new Date().toISOString()
  }
}

export function canReuseVideoClip(shot: Shot, expected: VideoClipMetadata): boolean {
  const actual = shot.videoClipMetadata
  return Boolean(
    shot.videoClipPath &&
    existsSync(shot.videoClipPath) &&
    actual &&
    actual.provider === expected.provider &&
    actual.model === expected.model &&
    actual.durationSeconds === expected.durationSeconds &&
    actual.resolution === expected.resolution &&
    actual.nativeAudio === expected.nativeAudio &&
    actual.promptHash === expected.promptHash &&
    actual.imageHash === expected.imageHash
  )
}
