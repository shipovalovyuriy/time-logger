import React from 'react';

const Stepper = ({
  step,
  isProjectComplete,
  isActivityComplete,
  canGoToStep2,
  onSetStep
}) => (
  <div className="stepper" role="group" aria-label="Шаги заполнения">
    <button
      type="button"
      className={`stepper__node ${step === 1 ? 'active' : step > 1 && isProjectComplete ? 'done' : ''}`}
      onClick={() => onSetStep(1)}
      aria-current={step === 1 ? 'step' : undefined}
    >
      <span className="stepper__text">Инициативы</span>
    </button>
    <div className={`stepper__line ${step === 2 || isProjectComplete ? 'active' : ''}`} aria-hidden="true" />
    <button
      type="button"
      className={`stepper__node ${step === 2 ? 'active' : isActivityComplete ? 'done' : ''}`}
      onClick={() => {
        if (canGoToStep2) onSetStep(2);
      }}
      disabled={!canGoToStep2 && step !== 2}
      aria-current={step === 2 ? 'step' : undefined}
    >
      <span className="stepper__text">Активности</span>
    </button>
  </div>
);

export default React.memo(Stepper);
