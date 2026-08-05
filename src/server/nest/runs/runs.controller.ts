import { createReadStream, existsSync } from 'node:fs'
import { extname, relative, resolve } from 'node:path'
import { Body, Controller, Get, Inject, MessageEvent, NotFoundException, Param, Post, Res, Sse, StreamableFile } from '@nestjs/common'
import type { Response } from 'express'
import type { Observable } from 'rxjs'
import { persistenceConfig } from '../../config'
import { RunEventsService } from './run-events.service'
import { RunsService } from './runs.service'

@Controller()
export class RunsController {
  constructor(
    @Inject(RunsService) private readonly runs: RunsService,
    @Inject(RunEventsService) private readonly events: RunEventsService
  ) {}

  @Post('projects/:projectId/runs')
  start(@Param('projectId') projectId: string, @Body() body: unknown) {
    return this.runs.start(projectId, body)
  }

  @Get('projects/:projectId/runs')
  list(@Param('projectId') projectId: string) {
    return this.runs.listForProject(projectId)
  }

  @Get('runs/:id')
  get(@Param('id') id: string) {
    return this.runs.get(id)
  }

  @Sse('runs/:id/events')
  eventsForRun(@Param('id') id: string): Observable<MessageEvent> {
    return this.events.stream(id)
  }

  @Post('runs/:id/resume')
  resume(@Param('id') id: string, @Body() body: unknown) {
    return this.runs.resume(id, body)
  }

  @Post('runs/:id/cancel')
  cancel(@Param('id') id: string) {
    return this.runs.cancel(id)
  }

  @Get('runs/:id/artifacts')
  artifacts(@Param('id') id: string) {
    return this.runs.listArtifacts(id)
  }

  @Get('artifacts/:id/file')
  async artifactFile(
    @Param('id') id: string,
    @Res({ passthrough: true }) response: Response
  ): Promise<StreamableFile> {
    const artifact = await this.runs.getArtifact(id)
    if (!artifact.filePath || !existsSync(artifact.filePath)) throw new NotFoundException('产物文件不存在')
    const root = resolve(persistenceConfig.dataDir)
    const filePath = resolve(artifact.filePath)
    const relativePath = relative(root, filePath)
    if (relativePath.startsWith('..') || resolve(root, relativePath) !== filePath) {
      throw new NotFoundException('产物文件不在数据目录内')
    }
    const extension = extname(filePath).toLowerCase()
    const contentTypes: Record<string, string> = {
      '.png': 'image/png',
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.webp': 'image/webp',
      '.mp4': 'video/mp4'
    }
    response.setHeader('content-type', contentTypes[extension] ?? 'application/octet-stream')
    return new StreamableFile(createReadStream(filePath))
  }

  @Post('runs/:id/rollback')
  rollback(@Param('id') id: string, @Body() body: { artifactId?: string }) {
    if (!body.artifactId) throw new NotFoundException('缺少 artifactId')
    return this.runs.rollback(id, body.artifactId)
  }
}
