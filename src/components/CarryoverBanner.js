import React from 'react';

const CarryoverBanner = ({
  carryoverPendingSegmentsCount,
  carryoverSegmentWord,
  carryoverMonthLabelLower,
  currentMonthLabelLower,
  isViewingCarryoverMonth,
  isLoading,
  isSaving,
  onOpenCarryoverMonth,
  onOpenCurrentMonth,
  carryoverMonthName
}) => (
  <div className="carryover-banner" role="status">
    <div className="carryover-banner__text-wrap">
      <strong className="carryover-banner__title">
        Вы оставили без внимания {carryoverPendingSegmentsCount} {carryoverSegmentWord} за{' '}
        {carryoverMonthLabelLower}.
      </strong>
      <span className="carryover-banner__text">
        Их можно дозаполнить сейчас или вернуться позже.
      </span>
    </div>
    <button
      type="button"
      className="carryover-banner__action"
      onClick={isViewingCarryoverMonth ? onOpenCurrentMonth : onOpenCarryoverMonth}
      disabled={isLoading || isSaving}
    >
      {isViewingCarryoverMonth ? `Перейти к ${currentMonthLabelLower}` : `Открыть ${carryoverMonthName}`}
    </button>
  </div>
);

export default React.memo(CarryoverBanner);
