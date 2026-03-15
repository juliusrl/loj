import React from 'react';
import { resolveMessageText } from '@loj-lang/shared-contracts';
import type { MessageDescriptor, MessageDescriptorValue, MessageLike } from '@loj-lang/shared-contracts';

export type ToastMessageValue = MessageDescriptorValue;
export type ToastMessageDescriptor = MessageDescriptor<ToastMessageValue>;
export type ToastMessage = MessageLike<ToastMessageValue>;

export interface ToastApi {
  success: (message: ToastMessage) => void;
  error: (message: ToastMessage) => void;
  info: (message: ToastMessage) => void;
}

interface ToastProviderProps {
  value: ToastApi;
  children?: React.ReactNode;
}

const ToastContext = React.createContext<ToastApi | undefined>(undefined);

export function resolveToastMessage(message: ToastMessage): string {
  return resolveMessageText(message);
}

function emitToast(level: 'success' | 'error' | 'info', message: ToastMessage): void {
  const resolvedMessage = resolveToastMessage(message);
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('rdsl:toast', {
      detail: {
        level,
        message: resolvedMessage,
        descriptor: typeof message === 'string' ? undefined : message,
      },
    }));
  }
  const logger = level === 'error' ? console.error : console.info;
  logger(`[rdsl:${level}] ${resolvedMessage}`);
}

const fallbackToastApi: ToastApi = {
  success: (message) => emitToast('success', message),
  error: (message) => emitToast('error', message),
  info: (message) => emitToast('info', message),
};

export function ToastProvider({ value, children }: ToastProviderProps) {
  return React.createElement(ToastContext.Provider, { value }, children);
}

export function useToast(): ToastApi {
  return React.useContext(ToastContext) ?? fallbackToastApi;
}
