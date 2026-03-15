import React from 'react';
import { App } from '@generated/App';
import { BrowserNavigationBridge } from '@loj-lang/rdsl-host-react';
import { HostProviders, HostStatus, HostToasts } from './host-config';

export function HostApp() {
  return (
    <HostProviders>
      <div className="rdsl-host-shell">
        {import.meta.env.DEV ? <HostStatus /> : null}
        <BrowserNavigationBridge>
          <App />
        </BrowserNavigationBridge>
        <HostToasts />
      </div>
    </HostProviders>
  );
}
