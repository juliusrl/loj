import React from 'react';
import type { WorkflowProgressDescriptor, WorkflowSummaryStepDescriptor } from '@loj-lang/shared-contracts';

export type WorkflowSummaryStep = WorkflowSummaryStepDescriptor;
export type WorkflowSummaryProps = WorkflowProgressDescriptor;

export function WorkflowSummary({
  stateHeading,
  stateLabel,
  currentStepName,
  nextStepName,
  steps,
}: WorkflowSummaryProps): JSX.Element {
  return (
    <section className="rdsl-workflow-summary">
      <div className="rdsl-read-actions">
        <strong>{stateHeading}</strong>
        <span className="rdsl-btn rdsl-btn-secondary">{stateLabel}</span>
      </div>
      <div className="rdsl-read-actions">
        <strong>Current step</strong>
        <span>{currentStepName ?? '—'}</span>
      </div>
      {nextStepName ? (
        <div className="rdsl-read-actions">
          <strong>Next step</strong>
          <span>{nextStepName}</span>
        </div>
      ) : null}
      {steps.length > 0 ? (
        <ol className="rdsl-related-list">
          {steps.map((step) => (
            <li key={step.name}>
              <strong>{step.name}</strong>
              {' '}<span>{step.status}</span>
            </li>
          ))}
        </ol>
      ) : null}
    </section>
  );
}
