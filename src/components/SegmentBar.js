import React from 'react';
import { MAX_TOTAL_PERCENT } from '../utils/constants';
import { formatDateKey, isSegmentElapsed } from '../utils/dateUtils';

const SegmentBar = ({
  monthSegments,
  activeSegment,
  segmentSummaryByKey,
  todayStart,
  isLoading,
  isSaving,
  onSelectSegment
}) => (
  <div className="segments-bar" role="tablist" aria-label="Недельные отрезки">
    {monthSegments.map((segment) => {
      const isPendingRelease = !isSegmentElapsed(segment, todayStart);
      const isActive = activeSegment?.id === segment.id;
      const summaryKey = `${formatDateKey(segment.weekStart)}_${formatDateKey(segment.weekEnd)}`;
      const summary = segmentSummaryByKey[summaryKey];
      const isDone =
        (summary?.projectTotal || 0) === MAX_TOTAL_PERCENT &&
        (summary?.activityTotal || 0) === MAX_TOTAL_PERCENT;

      return (
        <button
          key={segment.id}
          type="button"
          className={`segment-chip ${isActive ? 'active' : ''} ${isDone ? 'done' : ''}`}
          onClick={() => onSelectSegment(segment)}
          disabled={isPendingRelease || isLoading || isSaving}
        >
          <span className="segment-chip__label">{segment.label}</span>
          <span className="segment-chip__meta">
            {summary ? `${summary.projectTotal}% / ${summary.activityTotal}%` : '-- / --'}
          </span>
        </button>
      );
    })}
  </div>
);

export default React.memo(SegmentBar);
