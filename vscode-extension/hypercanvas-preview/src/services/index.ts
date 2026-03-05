/**
 * Services for HyperCanvas VS Code Extension
 */

export { AstService } from './AstService';
export { type ComponentInfo, ComponentService, type ComponentTree, type PropInfo } from './ComponentService';
export { CompositionStorage } from './CompositionStorage';
export { DevServerManager } from './DevServerManager';
export {
  detectPackageManager,
  detectProjectType,
  getDefaultPort,
  getDevCommand,
  getPackageScripts,
  getProjectInfo,
} from './ProjectDetector';
