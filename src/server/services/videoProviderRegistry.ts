import {
  defaultVideoGenerationOptions,
  type VideoGenerationOptions,
  type VideoGenerationProviderName,
  type VideoProviderDescriptor
} from '../../shared/schema'

const descriptors: Record<VideoGenerationProviderName, VideoProviderDescriptor> = {
  happyhorse_i2v: {
    id: 'happyhorse_i2v',
    label: 'HappyHorse 1.1 图生视频',
    capabilities: {
      duration: { min: 3, max: 15, default: defaultVideoGenerationOptions.durationSeconds },
      resolutions: ['720p', '1080p'],
      defaultResolution: defaultVideoGenerationOptions.resolution,
      nativeAudio: false,
      aiVideo: true,
      imageToVideo: true,
      staticFallback: false
    }
  },
  happyhorse_t2v: {
    id: 'happyhorse_t2v',
    label: 'HappyHorse 1.1 文生视频',
    capabilities: {
      duration: { min: 3, max: 15, default: defaultVideoGenerationOptions.durationSeconds },
      resolutions: ['720p', '1080p'],
      defaultResolution: defaultVideoGenerationOptions.resolution,
      nativeAudio: false,
      aiVideo: true,
      imageToVideo: false,
      staticFallback: false
    }
  },
  happyhorse_r2v: {
    id: 'happyhorse_r2v',
    label: 'HappyHorse 1.1 参考生视频',
    capabilities: {
      duration: { min: 3, max: 15, default: defaultVideoGenerationOptions.durationSeconds },
      resolutions: ['720p', '1080p'],
      defaultResolution: defaultVideoGenerationOptions.resolution,
      nativeAudio: false,
      aiVideo: true,
      imageToVideo: true,
      staticFallback: false
    }
  },
  kling: {
    id: 'kling',
    label: 'Kling 3.0 Turbo',
    capabilities: {
      duration: { min: 3, max: 15, default: defaultVideoGenerationOptions.durationSeconds },
      resolutions: ['720p', '1080p'],
      defaultResolution: defaultVideoGenerationOptions.resolution,
      nativeAudio: true,
      aiVideo: true,
      imageToVideo: true,
      staticFallback: false
    }
  },
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
  return [
    descriptors.happyhorse_i2v,
    descriptors.happyhorse_r2v,
    descriptors.happyhorse_t2v,
    descriptors.local_ffmpeg
  ]
}

export function getVideoProviderDescriptor(name: VideoGenerationProviderName): VideoProviderDescriptor {
  return descriptors[name]
}

export function validateVideoGenerationOptions(
  name: VideoGenerationProviderName,
  options: VideoGenerationOptions
): void {
  const capabilities = descriptors[name].capabilities
  if (capabilities.duration) {
    const { min, max } = capabilities.duration
    if (options.durationSeconds < min || options.durationSeconds > max) {
      throw new Error(`${descriptors[name].label} 时长必须在 ${min}-${max} 秒之间`)
    }
  }
  if (capabilities.resolutions && !capabilities.resolutions.includes(options.resolution)) {
    throw new Error(`${descriptors[name].label} 不支持 ${options.resolution}`)
  }
  if (options.nativeAudio && !capabilities.nativeAudio) {
    throw new Error(`${descriptors[name].label} 不支持原生音频`)
  }
}
