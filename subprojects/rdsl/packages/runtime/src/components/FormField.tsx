import React from 'react';

export interface FieldSchema {
  required?: true;
  pattern?: RegExp;
  minLength?: number;
  unique?: true;
}

export interface SelectOption {
  value: string;
  label: string;
}

export interface FormFieldProps {
  label: string;
  name: string;
  type: 'text' | 'number' | 'checkbox' | 'datetime' | 'select';
  value: unknown;
  onChange: (value: unknown) => void;
  schema?: FieldSchema;
  options?: readonly (string | SelectOption)[];
  disabled?: boolean;
}

function coerceValue(type: FormFieldProps['type'], event: any): unknown {
  const target = event?.target;
  if (type === 'checkbox') return Boolean(target?.checked);
  if (type === 'number') {
    const nextValue = String(target?.value ?? '').trim();
    return nextValue === '' ? '' : Number(nextValue);
  }
  return target?.value ?? '';
}

function describeSchema(schema?: FieldSchema): string | null {
  if (!schema) return null;
  const hints: string[] = [];
  if (schema.required) hints.push('Required');
  if (typeof schema.minLength === 'number') hints.push(`Min length ${schema.minLength}`);
  if (schema.pattern) hints.push('Pattern validated');
  if (schema.unique) hints.push('Must be unique');
  return hints.length > 0 ? hints.join(' • ') : null;
}

export function FormField({
  label,
  name,
  type,
  value,
  onChange,
  schema,
  options,
  disabled = false,
}: FormFieldProps) {
  const hint = describeSchema(schema);
  const isTextLikeInput = type === 'text';
  const externalValue = String(value ?? '');
  const [draftValue, setDraftValue] = React.useState(externalValue);
  const isComposingRef = React.useRef(false);

  React.useEffect(() => {
    if (!isTextLikeInput || isComposingRef.current) {
      return;
    }
    setDraftValue(externalValue);
  }, [externalValue, isTextLikeInput]);

  return (
    <label className="rdsl-form-field">
      <span>{label}</span>
      {type === 'select' ? (
        <select
          name={name}
          value={String(value ?? '')}
          disabled={disabled}
          onChange={(event: any) => onChange(event?.target?.value ?? '')}
        >
          <option value="">Select...</option>
          {(options ?? []).map((option) => {
            const normalized = typeof option === 'string'
              ? { value: option, label: option }
              : option;
            return (
            <option key={normalized.value} value={normalized.value}>
              {normalized.label}
            </option>
            );
          })}
        </select>
      ) : type === 'checkbox' ? (
        <input
          name={name}
          type="checkbox"
          checked={Boolean(value)}
          disabled={disabled}
          onChange={(event: any) => onChange(coerceValue(type, event))}
        />
      ) : (
        <input
          name={name}
          type={type === 'datetime' ? 'datetime-local' : type}
          value={isTextLikeInput ? draftValue : type === 'number' ? String(value ?? '') : String(value ?? '')}
          disabled={disabled}
          onCompositionStart={isTextLikeInput ? (() => {
            isComposingRef.current = true;
          }) : undefined}
          onCompositionEnd={isTextLikeInput ? ((event: any) => {
            const nextValue = String(event?.target?.value ?? '');
            isComposingRef.current = false;
            setDraftValue(nextValue);
            onChange(nextValue);
          }) : undefined}
          onChange={(event: any) => {
            if (!isTextLikeInput) {
              onChange(coerceValue(type, event));
              return;
            }
            const nextValue = String(event?.target?.value ?? '');
            setDraftValue(nextValue);
            if (!isComposingRef.current) {
              onChange(nextValue);
            }
          }}
        />
      )}
      {hint ? <small className="rdsl-form-hint">{hint}</small> : null}
    </label>
  );
}
