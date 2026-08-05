import {
  type VideoGenerationOptions,
  type VideoGenerationProviderName,
  type VideoProviderDescriptor
} from '../../shared/schema'
import { listModelCatalog } from './modelCatalog'

const descriptors: Record<string, VideoProviderDescriptor> = {
  local_ffmpeg: {
    id: 'local_ffmpeg',
    label: '本地 FFmpeg（静态降级）',
    capabilities: {
      nativeAudio: false,
      aiVideo: false,
      imageToVideo: false,
      staticFallback: true
    }
  },
  mock: {
    id: 'mock',
    label: 'Mock',
    capabilities: {
      nativeAudio: false,
      aiVideo: false,
      imageToVideo: false,
      staticFallback: true
    }
  }
}

export function listVideoProviderDescriptors(): VideoProviderDescriptor[] {
  return listModelCatalog().video
}

export function getVideoProviderDescriptor(name: VideoGenerationProviderName): VideoProviderDescriptor {
  const descriptor = listVideoProviderDescriptors().find((item) => item.id === name) ?? descriptors[name]
  if (!descriptor) throw new Error(`未配置视频模型：${name}`)
  return descriptor
}

export function validateVideoGenerationOptions(
  name: VideoGenerationProviderName,
  options: VideoGenerationOptions
): void {
  const descriptor = getVideoProviderDescriptor(name)
  const capabilities = descriptor.capabilities
  if (capabilities.duration) {
    const { min, max } = capabilities.duration
    if (options.durationSeconds < min || options.durationSeconds > max) {
      throw new Error(`${descriptor.label} 时长必须在 ${min}-${max} 秒之间`)
    }
  }
  if (capabilities.resolutions && !capabilities.resolutions.includes(options.resolution)) {
    throw new Error(`${descriptor.label} 不支持 ${options.resolution}`)
  }
  if (options.nativeAudio && !capabilities.nativeAudio) {
    throw new Error(`${descriptor.label} 不支持原生音频`)
  }
}
