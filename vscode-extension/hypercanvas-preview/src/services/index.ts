/**
 * Services for HyperCanvas VS Code Extension
 */

export { DevServerManager } from './DevServerManager';
export { AstService } from './AstService';
export { ComponentService, type ComponentInfo, type PropInfo, type ComponentTree } from './ComponentService';
export { CompositionStorage } from './CompositionStorage';
export {
  detectProjectType,
  getDevCommand,
  getDefaultPort,
  getProjectInfo,
  getPackageScripts,
  detectPackageManager,
} from './ProjectDetector';
