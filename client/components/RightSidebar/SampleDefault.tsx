import { MemoryRouter } from 'react-router-dom';
import RightSidebar from './RightSidebar';

export const SampleDefault = () => {
  return (
    <MemoryRouter>
      <div style={{ height: '100vh', display: 'flex' }}>
        <div style={{ flex: 1 }}>
          <RightSidebar
            onOpenSettings={() => {}}
            viewport={{ panX: 1200, panY: 800, zoom: 1 }}
            onZoomChange={() => {}}
            onFitToContent={() => {}}
            activeInstanceId="instance-1"
            canvasMode="single"
            instanceSize={{ width: 1200, height: 800 }}
            onInstanceSizeChange={() => {}}
          />
        </div>
      </div>
    </MemoryRouter>
  );
};
