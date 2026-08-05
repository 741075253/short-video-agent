import { z } from 'zod'
import { StoryAnalysisSchema } from '../../../shared/workflow'

const ChunkAnalysisOutputSchema = z.object({
  summary: z.string(),
  facts: z.array(z.object({ text: z.string(), sourceRange: z.string() })),
  characters: z.array(z.object({ name: z.string(), description: z.string() })),
  locations: z.array(z.string()),
  events: z.array(z.object({
    order: z.coerce.number().int().positive(),
    description: z.string(),
    characterNames: z.array(z.string())
  })),
  conflicts: z.array(z.string())
})

type UnknownRecord = Record<string, unknown>

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function firstString(value: unknown, keys: string[]): string | undefined {
  if (typeof value === 'string' && value.trim()) return value.trim()
  if (!isRecord(value)) return undefined
  for (const key of keys) {
    const candidate = value[key]
    if (typeof candidate === 'string' && candidate.trim()) return candidate.trim()
  }
  return Object.values(value).find((candidate): candidate is string =>
    typeof candidate === 'string' && Boolean(candidate.trim()))?.trim()
}

function keyedString(value: unknown, keys: string[]): string | undefined {
  if (!isRecord(value)) return undefined
  for (const key of keys) {
    const candidate = value[key]
    if (typeof candidate === 'string' && candidate.trim()) return candidate.trim()
  }
  return undefined
}

function eventOrder(value: unknown, index: number): number {
  if (!isRecord(value)) return index + 1
  const candidate = value.order ?? value.sequence ?? value.index ?? value.step
  const parsed = Number(candidate)
  return Number.isInteger(parsed) && parsed > 0 ? parsed : index + 1
}

function stringList(value: unknown, keys: string[]): string[] {
  const source = Array.isArray(value)
    ? value
    : isRecord(value)
      ? keys.map((key) => value[key]).find(Array.isArray) ?? []
      : []
  return source
    .map((item) => firstString(item, ['name', 'title', 'text', 'description', 'content']))
    .filter((item): item is string => Boolean(item))
}

export function normalizeStoryAnalysisInput(value: unknown): unknown {
  if (!isRecord(value)) return value

  const facts = Array.isArray(value.facts) ? value.facts.map((fact) => ({
    text: firstString(fact, ['text', 'fact', 'content', 'statement', 'description']) ?? '',
    sourceRange: keyedString(fact, ['sourceRange', 'source_range', 'source', 'range', 'reference', 'evidence']) ?? '未标注'
  })) : value.facts

  const characters = Array.isArray(value.characters) ? value.characters.map((character) => ({
    name: firstString(character, ['name', 'characterName', 'character', 'title']) ?? '',
    description: firstString(character, ['description', 'profile', 'role', 'identity', 'summary']) ?? ''
  })) : value.characters

  const events = Array.isArray(value.events) ? value.events.map((event, index) => ({
    order: eventOrder(event, index),
    description: firstString(event, ['description', 'event', 'content', 'summary', 'title']) ?? '',
    characterNames: isRecord(event)
      ? stringList(
          event.characterNames
            ?? event.characters
            ?? event.participants
            ?? event.involvedCharacters
            ?? event.relatedCharacters,
          ['characterNames', 'characters', 'participants', 'involvedCharacters', 'relatedCharacters']
        )
      : []
  })) : value.events

  return {
    ...value,
    facts,
    characters,
    locations: Array.isArray(value.locations)
      ? stringList(value.locations, ['locations'])
      : value.locations,
    events,
    conflicts: Array.isArray(value.conflicts)
      ? stringList(value.conflicts, ['conflicts'])
      : value.conflicts
  }
}

export const StoryAnalysisModelSchema = z.preprocess(normalizeStoryAnalysisInput, StoryAnalysisSchema)
export const ChunkAnalysisModelSchema = z.preprocess(normalizeStoryAnalysisInput, ChunkAnalysisOutputSchema)
export { ChunkAnalysisOutputSchema }
