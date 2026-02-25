export default function Divider({
  className = "w-px h-6 text-border",
  ...props
}: {
  className?: string;
  [key: string]: any;
}) {
  return (
    <svg
      data-uniq-id="988c7153-9af0-4205-92a6-e2196bef5716"
      className={className}
      viewBox="0 0 1 24"
      fill="none"
      {...props}>
      <path
        data-uniq-id="28d8984b-5549-43c4-8856-dbfd75a1f19a"
        d="M1 0V24H0V0H1Z"
        fill="currentColor" />
    </svg>
  );
}


export const SampleDefault = () => {
  return (
    <MemoryRouter initialEntries={['/settings']}>
      <div className="flex space-x-8">
        <div className="flex flex-col space-y-4">
          <h3 className="font-semibold">Settings</h3>
          <div className="flex items-center space-x-4">
            <span className="text-sm text-gray-600">Account</span>
            <Divider className="w-px h-4" />
            <span className="text-sm text-gray-400">Privacy</span>
            <Divider className="w-px h-4" />
            <span className="text-sm text-gray-400">Notifications</span>
          </div>
        </div>
        <div className="flex flex-col space-y-4">
          <h3 className="font-semibold">User Profile</h3>
          <div className="flex flex-col space-y-2">
            <div className="flex items-center space-x-4">
              <span className="text-sm">Personal Information</span>
              <Divider className="w-px h-4" />
              <span className="text-sm">Security</span>
            </div>
            <div className="flex items-center space-x-4">
              <span className="text-xs text-gray-500">Full Name</span>
              <Divider className="w-px h-3" />
              <span className="text-xs text-gray-500">Email Address</span>
              <Divider className="w-px h-3" />
              <span className="text-xs text-gray-500">Phone Number</span>
            </div>
          </div>
        </div>
      </div>
    </MemoryRouter>
  );
};


import { MemoryRouter, Routes, Route } from 'react-router-dom';
