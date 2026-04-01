import RightSidebar from './RightSidebar';
export default RightSidebar;

export const SampleDefault = () => {
  return (
    <MemoryRouter initialEntries={['/dashboard']}>
      <Routes>
        <Route path="/dashboard" element={<RightSidebar />} />
      </Routes>
    </MemoryRouter>
  );
};

export * from './types';

import { MemoryRouter, Route, Routes } from 'react-router-dom';
