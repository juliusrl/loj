import React from 'react';

export interface FilterField {
  key: string;
  label: string;
  type: 'text' | 'select';
  options?: readonly string[];
}

export interface FilterBarProps {
  fields: readonly FilterField[];
  values: Record<string, string>;
  onChange: (nextValues: Record<string, string>) => void;
}

export function FilterBar({ fields, values, onChange }: FilterBarProps) {
  const [draftValues, setDraftValues] = React.useState<Record<string, string>>(values);
  const composingFieldKeyRef = React.useRef<string | null>(null);

  React.useEffect(() => {
    if (composingFieldKeyRef.current) {
      return;
    }
    setDraftValues(values);
  }, [values]);

  const commitChange = React.useCallback((fieldKey: string, value: string) => {
    onChange({
      ...values,
      [fieldKey]: value,
    });
  }, [onChange, values]);

  const updateDraftValue = React.useCallback((fieldKey: string, value: string) => {
    setDraftValues((previous) => ({
      ...previous,
      [fieldKey]: value,
    }));
  }, []);

  return (
    <div className="rdsl-filter-bar">
      {fields.map((field) => (
        <label key={field.key} className="rdsl-filter-field">
          <span>{field.label}</span>
          {field.type === 'select' ? (
            <select
              value={values[field.key] ?? ''}
              onChange={(event: any) => commitChange(field.key, String(event?.target?.value ?? ''))}
            >
              <option value="">All</option>
              {(field.options ?? []).map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          ) : (
            <input
              type="text"
              value={draftValues[field.key] ?? values[field.key] ?? ''}
              onCompositionStart={() => {
                composingFieldKeyRef.current = field.key;
              }}
              onCompositionEnd={(event: any) => {
                const nextValue = String(event?.target?.value ?? '');
                composingFieldKeyRef.current = null;
                updateDraftValue(field.key, nextValue);
                commitChange(field.key, nextValue);
              }}
              onChange={(event: any) => {
                const nextValue = String(event?.target?.value ?? '');
                updateDraftValue(field.key, nextValue);
                if (composingFieldKeyRef.current !== field.key) {
                  commitChange(field.key, nextValue);
                }
              }}
            />
          )}
        </label>
      ))}
    </div>
  );
}
