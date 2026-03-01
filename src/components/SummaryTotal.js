import React from 'react';
import { MAX_TOTAL_PERCENT } from '../utils/constants';

const SummaryTotal = ({ step, currentTotal, isCurrentComplete, isCurrentRewardActive }) => (
  <div className={`summary-total ${isCurrentComplete ? 'complete' : ''} ${isCurrentRewardActive ? 'reward' : ''}`}>
    <span className="total-label">{step === 1 ? 'Инициативы' : 'Активности'}</span>
    <span className={`total-hours ${isCurrentComplete ? 'complete' : ''}`}>
      {currentTotal}% из {MAX_TOTAL_PERCENT}%
      <span className={`total-check ${isCurrentComplete ? 'visible' : ''}`} aria-hidden={!isCurrentComplete}>
        ✓
      </span>
    </span>
  </div>
);

export default React.memo(SummaryTotal);
