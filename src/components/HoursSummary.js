import React from 'react';

const HoursSummary = ({
  hoursSelectedDate,
  hoursMinDate,
  hoursMaxDate,
  hoursIsLoading,
  hoursIsSaving,
  hoursBaseWork,
  hoursBaseOver,
  hoursBaseTotal,
  safeDraftHours,
  previewWork,
  previewOver,
  previewTotal,
  isSelectedProjectApproved,
  hoursDraftProjectId,
  hoursNotice,
  hoursError,
  onDateChange
}) => (
  <div className="panel hours-summary">
    <div className="hours-summary__top">
      <div className="hours-input-group">
        <label htmlFor="hours-date">Дата</label>
        <input
          id="hours-date"
          type="date"
          value={hoursSelectedDate}
          min={hoursMinDate}
          max={hoursMaxDate}
          onChange={(event) => onDateChange(event.target.value)}
          disabled={hoursIsLoading || hoursIsSaving}
        />
      </div>

      <div className="hours-summary__metrics" aria-label="Итоги дня">
        <div className="hours-metric">
          <span className="hours-metric__label">Work</span>
          <span className="hours-metric__value">{hoursBaseWork} ч</span>
        </div>
        <div className="hours-metric">
          <span className="hours-metric__label">Over</span>
          <span className="hours-metric__value">{hoursBaseOver} ч</span>
        </div>
        <div className="hours-metric">
          <span className="hours-metric__label">Total</span>
          <span className="hours-metric__value">{hoursBaseTotal} ч</span>
        </div>
      </div>
    </div>

    {safeDraftHours > 0 && (
      <div className="hours-summary__preview">
        После сохранения: Work {previewWork} ч • Over {previewOver} ч • Total {previewTotal} ч
      </div>
    )}

    {isSelectedProjectApproved && hoursDraftProjectId > 0 && (
      <div className="hours-lock-banner" role="status">
        <span className="hours-lock-banner__icon" aria-hidden="true">
          🔒
        </span>
        <span>
          Таймшит по проекту подтверждён — изменения заблокированы.
        </span>
      </div>
    )}

    {hoursNotice && (
      <div className="hours-notice hours-notice--success" role="status">
        <span className="hours-notice__icon" aria-hidden="true">
          ✅
        </span>
        <span className="hours-notice__text">{hoursNotice}</span>
      </div>
    )}

    {hoursError && (
      <div className="hours-notice hours-notice--danger" role="alert">
        <span className="hours-notice__icon" aria-hidden="true">
          ⛔
        </span>
        <span className="hours-notice__text">{hoursError}</span>
      </div>
    )}
  </div>
);

export default React.memo(HoursSummary);
