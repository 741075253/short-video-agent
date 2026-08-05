import { Body, Controller, Get, Header, Inject, Param, Post, Put } from '@nestjs/common'
import type { Project } from '../../../shared/schema'
import { ProjectsService } from './projects.service'

@Controller('projects')
export class ProjectsController {
  constructor(@Inject(ProjectsService) private readonly projects: ProjectsService) {}

  @Get()
  list(): Promise<Project[]> {
    return this.projects.list()
  }

  @Post()
  create(@Body() body: Record<string, unknown>): Promise<Project> {
    return this.projects.create(body)
  }

  @Get(':id')
  get(@Param('id') id: string): Promise<Project> {
    return this.projects.get(id)
  }

  @Put(':id')
  update(@Param('id') id: string, @Body() body: Partial<Project>): Promise<Project> {
    return this.projects.update(id, body)
  }

  @Get(':id/export/json')
  @Header('content-type', 'application/json; charset=utf-8')
  exportJson(@Param('id') id: string): Promise<string> {
    return this.projects.exportJson(id)
  }

  @Get(':id/export/markdown')
  @Header('content-type', 'text/markdown; charset=utf-8')
  exportMarkdown(@Param('id') id: string): Promise<string> {
    return this.projects.exportMarkdown(id)
  }

  @Get(':id/episodes')
  episodes(@Param('id') id: string) {
    return this.projects.listEpisodes(id)
  }
}
