import React from 'react';

const ProjectSlider = ({
  rows,
  activeSegmentIsLocked,
  currentScope,
  onPointerDown,
  onPointerMove,
  onPointerEnd
}) => (
  <div className="segments-list">
    {rows.map((row) => {
      const rowPercent = row.percent || 0;

      return (
        <div key={row.id} className="project-card">
          <div
            className={`segment-strip ${activeSegmentIsLocked ? 'locked' : ''}`}
            role="slider"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={rowPercent}
            aria-disabled={activeSegmentIsLocked}
            style={{
              borderColor: `${row.color}88`,
              backgroundColor: `${row.color}22`
            }}
            onPointerDown={(event) => onPointerDown(currentScope, row.id, event)}
            onPointerMove={(event) => onPointerMove(currentScope, row.id, event)}
            onPointerUp={onPointerEnd}
            onPointerCancel={onPointerEnd}
            onLostPointerCapture={onPointerEnd}
            aria-valuetext={`${rowPercent}%`}
          >
            <div
              className="segment-strip__fill"
              style={{
                width: `${rowPercent}%`,
                background: `linear-gradient(90deg, ${row.color} 0%, ${row.color}CC 100%)`
              }}
              aria-hidden="true"
            />

            <div className="segment-strip__content">
              <div className="project-label">
                <span className="project-dot" style={{ backgroundColor: row.color }} />
                <span className="project-name">{row.name}</span>
              </div>

              <div className="project-actions">
                <span className="project-percent">{rowPercent}%</span>
              </div>
            </div>
          </div>
        </div>
      );
    })}
  </div>
);

export default React.memo(ProjectSlider);
