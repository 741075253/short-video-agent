import { describe, expect, it } from 'vitest'
import {
  getDefaultModelSelection,
  listModelCatalog,
  resolveImageModel,
  resolveTextModel,
  resolveVideoModel
} from '../services/modelCatalog'

describe('modelCatalog', () => {
  it('loads public model options without exposing connection secrets', () => {
    const catalog = listModelCatalog()

    expect(catalog.defaults).toEqual(getDefaultModelSelection())
    expect(catalog.text.some((model) => model.id === catalog.defaults.textModel)).toBe(true)
    expect(catalog.image.some((model) => model.id === catalog.defaults.imageModel)).toBe(true)
    expect(catalog.video.some((model) => model.id === catalog.defaults.videoProvider)).toBe(true)
    expect(JSON.stringify(catalog)).not.toContain('apiKey')
  })

  it('resolves text, image, and video configuration independently', () => {
    expect(resolveTextModel('qwen3.8-max')).toMatchObject({
      adapter: 'openai-compatible',
      baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1'
    })
    expect(resolveImageModel('wan2.7-image-pro')).toMatchObject({ adapter: 'dashscope-image' })
    expect(resolveVideoModel('happyhorse_i2v')).toMatchObject({
      adapter: 'dashscope-video',
      inputMode: 'i2v'
    })
  })

  it('rejects model IDs that are not in the catalog', () => {
    expect(() => resolveTextModel('missing-model')).toThrow('未配置文本模型')
  })
})
