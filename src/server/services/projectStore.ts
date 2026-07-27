import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { ProjectSchema, type Project } from '../../shared/schema'

export function createProjectStore(baseDir: string) {
  const projectsDir = join(baseDir, 'projects')

  async function ensureDir() {
    await mkdir(projectsDir, { recursive: true })
  }

  function filePath(id: string) {
    return join(projectsDir, `${id}.json`)
  }

  return {
    async listProjects(): Promise<Project[]> {
      await ensureDir()
      const files = await readdir(projectsDir)
      const projects = await Promise.all(
        files
          .filter((file) => file.endsWith('.json'))
          .map(async (file) => {
            const raw = await readFile(join(projectsDir, file), 'utf8')
            return ProjectSchema.parse(JSON.parse(raw))
          })
      )
      return projects.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    },

    async getProject(id: string): Promise<Project | null> {
      try {
        const raw = await readFile(filePath(id), 'utf8')
        return ProjectSchema.parse(JSON.parse(raw))
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code
        if (code === 'ENOENT') return null
        throw error
      }
    },

    async saveProject(project: Project): Promise<Project> {
      await ensureDir()
      const parsed = ProjectSchema.parse(project)
      await writeFile(filePath(parsed.id), JSON.stringify(parsed, null, 2), 'utf8')
      return parsed
    }
  }
}
