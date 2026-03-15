import React from 'react';
import ReactDOM from 'react-dom/client';
import { HostApp } from './HostApp';
import './styles.css';

const rootElement = document.getElementById('root');

if (!rootElement) {
  throw new Error('Missing #root element for ReactDSL host app');
}

ReactDOM.createRoot(rootElement).render(
  <React.StrictMode>
    <HostApp />
  </React.StrictMode>,
);
