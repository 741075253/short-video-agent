import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createImageProvider } from '../services/imageProviders'
import type { Shot } from '../../shared/schema'

let dir: string | undefined

const shot: Shot = {
  id: 'shot-1',
  index: 1,
  durationSeconds: 5,
  sceneId: 'scene-1',
  characterIds: [],
  visual: '少年站在门前',
  action: '抬头',
  narration: '城市燃烧了。',
  subtitle: '城市燃烧了。',
  camera: '推近',
  prompt: 'animation drama style',
  status: 'pending'
}

afterEach(async () => {
  vi.restoreAllMocks()
  if (dir) await rm(dir, { recursive: true, force: true })
  dir = undefined
})

describe('imageProviders', () => {
  it('creates the output directory before writing generated image data', async () => {
    dir = await mkdtemp(join(tmpdir(), 'short-video-agent-image-'))
    const outputDir = join(dir, 'nested', 'outputs')
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ data: [{ b64_json: Buffer.from('image').toString('base64') }] }), {
        status: 200,
        headers: { 'content-type': 'application/json' }
      })
    )
    const provider = createImageProvider({
      apiKey: 'test-key',
      baseUrl: 'https://images.example.test/v1',
      model: 'test-model',
      size: '1024x1792'
    })

    const imagePath = await provider!.generateImage(shot, outputDir)

    expect(await readFile(imagePath, 'utf8')).toBe('image')
  })

  it('uses the multimodal endpoint and message image reference for qwen-image-2.0', async () => {
    dir = await mkdtemp(join(tmpdir(), 'short-video-agent-image-'))
    const requests: Array<{ url: string; init?: RequestInit }> = []
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = String(input)
      requests.push({ url, init })
      if (url === 'https://result.example.test/shot.png') {
        return new Response('image', { status: 200 })
      }
      return new Response(JSON.stringify({
        output: {
          choices: [{ message: { content: [{ image: 'https://result.example.test/shot.png' }] } }]
        }
      }), { status: 200, headers: { 'content-type': 'application/json' } })
    })
    const provider = createImageProvider({
      apiKey: 'test-key',
      baseUrl: 'https://dashscope.aliyuncs.com',
      model: 'qwen-image-2.0',
      size: '1024*1024'
    })

    const imagePath = await provider!.generateImage(
      shot,
      join(dir, 'outputs'),
      'https://result.example.test/reference.png'
    )

    expect(requests[0].url).toBe(
      'https://dashscope.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation'
    )
    const body = JSON.parse(String(requests[0].init?.body))
    expect(body.input.messages[0].content[0]).toEqual({ image: 'https://result.example.test/reference.png' })
    expect(body.input.messages[0].content[1].text).toContain('连续性参考')
    expect(body.input).not.toHaveProperty('ref_image')
    expect(requests[0].init?.headers).toMatchObject({ 'X-DashScope-OssResourceResolve': 'enable' })
    expect(await readFile(imagePath, 'utf8')).toBe('image')
  })

  it('generates a sequential Wan 2.7 image set in shot order', async () => {
    dir = await mkdtemp(join(tmpdir(), 'short-video-agent-image-'))
    const requests: Array<{ url: string; init?: RequestInit }> = []
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = String(input)
      requests.push({ url, init })
      if (url.startsWith('https://result.example.test/')) {
        return new Response(url.endsWith('1.png') ? 'image-1' : 'image-2', { status: 200 })
      }
      return new Response(JSON.stringify({
        output: {
          choices: [{
            message: {
              content: [
                { type: 'image', image: 'https://result.example.test/1.png' },
                { type: 'image', image: 'https://result.example.test/2.png' }
              ]
            }
          }]
        }
      }), { status: 200, headers: { 'content-type': 'application/json' } })
    })
    const provider = createImageProvider({
      apiKey: 'test-key',
      baseUrl: 'https://dashscope.aliyuncs.com',
      model: 'wan2.7-image-pro',
      size: '960*1696'
    })
    const shots: Shot[] = [
      shot,
      { ...shot, id: 'shot-2', index: 2, visual: '少年走进街道', prompt: 'same character walking into the street' }
    ]

    const imagePaths = await provider!.generateImages!(shots, join(dir, 'outputs'))

    expect(requests[0].url).toBe(
      'https://dashscope.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation'
    )
    const body = JSON.parse(String(requests[0].init?.body))
    expect(body.parameters).toMatchObject({
      enable_sequential: true,
      n: 2,
      size: '960*1696',
      watermark: false
    })
    expect(body.input.messages[0].content[0].text).toContain('第1张（镜头1）')
    expect(body.input.messages[0].content[0].text).toContain('第2张（镜头2）')
    expect(await readFile(imagePaths[0], 'utf8')).toBe('image-1')
    expect(await readFile(imagePaths[1], 'utf8')).toBe('image-2')
  })
})
