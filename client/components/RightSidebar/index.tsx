import RightSidebar from './RightSidebar';
export default RightSidebar;

export const SampleDefault = () => {
  return (
    <MemoryRouter data-uniq-id="81fe5d4b-8f02-476e-b4d9-fd180a073bec" initialEntries={['/dashboard']}>
      <Routes data-uniq-id="5841e5cc-b74d-4a6b-9243-144f54bc02d5">
        <Route
          data-uniq-id="8c8b4bd8-0801-4463-90a8-224938fb2bce"
          path="/dashboard"
          element={<RightSidebar data-uniq-id="21ea28cc-4d47-4a75-b3e9-af7b7055142e" />}
        />
      </Routes>
    </MemoryRouter>
  );
};

export * from './types';

import { MemoryRouter, Route, Routes } from 'react-router-dom';
