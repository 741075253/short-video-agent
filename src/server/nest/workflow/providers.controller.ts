import { Controller, Get } from '@nestjs/common'
import { listVideoProviderDescriptors } from '../../services/videoProviderRegistry'
import { listModelCatalog } from '../../services/modelCatalog'

@Controller()
export class ProvidersController {
  @Get('models')
  listModels() {
    return listModelCatalog()
  }

  @Get('video-providers')
  listVideoProviders() {
    return listVideoProviderDescriptors()
  }
}
