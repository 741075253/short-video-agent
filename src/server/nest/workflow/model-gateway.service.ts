import { Injectable } from '@nestjs/common'
import { z } from 'zod'
import { modelBudgetConfig } from '../../config'
import { resolveTextModel } from '../../services/modelCatalog'

type CompletionOptions<T> = {
  model: string
  system: string
  user: string
  schema: z.ZodType<T>
  temperature?: number
  maxTokens?: number
}

export type ModelUsage = {
  inputTokens: number
  outputTokens: number
  cost: number
  durationMs: number
}

function jsonFromContent(content: string): unknown {
  const trimmed = content.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')
  try {
    return JSON.parse(trimmed)
  } catch {
    const start = trimmed.indexOf('{')
    const end = trimmed.lastIndexOf('}')
    if (start < 0 || end <= start) throw new Error('文本模型未返回有效 JSON')
    return JSON.parse(trimmed.slice(start, end + 1))
  }
}

@Injectable()
export class ModelGateway {
  ensureConfigured(modelId: string): void {
    const model = resolveTextModel(modelId)
    if (!model.apiKey) throw new Error(`文本模型 ${modelId} 缺少环境变量 ${model.apiKeyEnv}`)
  }

  estimateTokens(text: string): number {
    return Math.ceil(text.length / 2)
  }

  async completeStructured<T>(options: CompletionOptions<T>): Promise<{ data: T; usage: ModelUsage }> {
    this.ensureConfigured(options.model)
    const model = resolveTextModel(options.model)
    const startedAt = Date.now()
    const response = await fetch(`${model.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${model.apiKey}`
      },
      body: JSON.stringify({
        model: model.model,
        messages: [
          { role: 'system', content: options.system },
          { role: 'user', content: options.user }
        ],
        response_format: { type: 'json_object' },
        enable_thinking: false,
        temperature: options.temperature ?? 0.4,
        max_tokens: options.maxTokens ?? 6000
      })
    })
    const text = await response.text()
    if (!response.ok) throw new Error(`文本模型返回 ${response.status}: ${text.slice(0, 300)}`)
    let body: {
      choices?: Array<{ message?: { content?: string } }>
      usage?: { prompt_tokens?: number; completion_tokens?: number }
    }
    try {
      body = JSON.parse(text) as typeof body
    } catch {
      throw new Error(`文本模型返回了无效响应: ${text.slice(0, 300)}`)
    }
    const content = body.choices?.[0]?.message?.content
    if (!content) throw new Error('文本模型未返回内容')
    const inputTokens = body.usage?.prompt_tokens ?? this.estimateTokens(options.system + options.user)
    const outputTokens = body.usage?.completion_tokens ?? this.estimateTokens(content)
    const cost = inputTokens / 1000 * modelBudgetConfig.inputCostPerThousand
      + outputTokens / 1000 * modelBudgetConfig.outputCostPerThousand
    return {
      data: options.schema.parse(jsonFromContent(content)),
      usage: { inputTokens, outputTokens, cost, durationMs: Date.now() - startedAt }
    }
  }
}
