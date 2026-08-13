import { MemoryRouter } from 'react-router-dom';
import { CanvasEditor } from './CanvasEditor';

export const SampleDefault = () => {
  const onOpenSettings = () => {
    console.log('Opening settings dialog');
  };
  return (
    <MemoryRouter>
      <CanvasEditor onOpenSettings={onOpenSettings} />
    </MemoryRouter>
  );
};
