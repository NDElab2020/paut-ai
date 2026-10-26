import type { ModuleProps } from '@shared/modules'
import { PlannedModule } from '../../components/PlannedModule'

export default function Module({ navigate }: ModuleProps) {
  return <PlannedModule id="files" navigate={navigate} />
}
