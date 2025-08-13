import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import './TimeLogger.css';

const TimeLogger = () => {
  const [hoursPerProject, setHoursPerProject] = useState({});
  const [activeId, setActiveId] = useState(1);
  const [dragging, setDragging] = useState(false);
  const [hoursAccumulator, setHoursAccumulator] = useState(0);
  const [startDragAngle, setStartDragAngle] = useState(0);
  const [isSubmitted, setIsSubmitted] = useState(false);
  const [isAnimating, setIsAnimating] = useState(false);

  const canvasRef = useRef(null);
  const ctxRef = useRef(null);
  const centerXRef = useRef(0);
  const centerYRef = useRef(0);
  const radiusRef = useRef(0);

  const BASE_STROKE = 26;
  const SEGMENT_STROKE = 30;
  const maxHours = 8;

  const projects = useMemo(() => [
    { id: 1, name: 'Проект А', color: 'dodgerblue' },
    { id: 2, name: 'Проект B', color: 'tomato' },
    { id: 3, name: 'Проект C', color: 'mediumseagreen' },
    { id: 4, name: 'Проект D', color: 'gold' },
    { id: 5, name: 'Проект E', color: 'purple' },
    { id: 6, name: 'Проект F', color: 'orange' },
    { id: 7, name: 'Проект G', color: 'teal' }
  ], []);

  // Initialize hours per project
  useEffect(() => {
    const initialHours = Object.fromEntries(projects.map(p => [p.id, 0]));
    setHoursPerProject(initialHours);
  }, [projects]);

  const sumHours = useCallback(() => {
    return Object.values(hoursPerProject).reduce((a, b) => a + (b || 0), 0);
  }, [hoursPerProject]);

  const sumHoursExcept = useCallback((id) => {
    return Object.entries(hoursPerProject).reduce((a, [k, v]) => 
      a + (parseInt(k) === id ? 0 : (v || 0)), 0);
  }, [hoursPerProject]);

  const clamp = useCallback((v, min, max) => {
    return Math.max(min, Math.min(max, v));
  }, []);

  const drawCircle = useCallback(() => {
    const ctx = ctxRef.current;
    const canvas = canvasRef.current;
    if (!ctx || !canvas) return;

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    
    // Draw base circle
    ctx.beginPath();
    ctx.arc(centerXRef.current, centerYRef.current, radiusRef.current, 0, Math.PI * 2);
    ctx.strokeStyle = '#dfe6e9';
    ctx.lineWidth = BASE_STROKE;
    ctx.lineCap = 'round';
    ctx.stroke();

    // Draw project segments
    const ordered = [...projects].sort((a, b) => a.id - b.id);
    let start = -Math.PI / 2;
    
    ordered.forEach(p => {
      const hrs = hoursPerProject[p.id] || 0;
      if (!hrs) return;
      
      const ang = (hrs / maxHours) * 2 * Math.PI;
      ctx.beginPath();
      ctx.arc(centerXRef.current, centerYRef.current, radiusRef.current, start, start + ang);
      ctx.strokeStyle = p.color;
      ctx.lineWidth = SEGMENT_STROKE;
      ctx.lineCap = 'round';
      ctx.stroke();
      start += ang;
    });
  }, [hoursPerProject, projects, maxHours]);

  // Initialize canvas
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    ctxRef.current = ctx;

    const resizeCanvas = () => {
      canvas.width = canvas.offsetWidth;
      canvas.height = canvas.offsetHeight;
      const maxStroke = Math.max(BASE_STROKE, SEGMENT_STROKE);
      centerXRef.current = canvas.width / 2;
      centerYRef.current = canvas.height / 2;
      radiusRef.current = Math.max(10, canvas.width / 2 - (maxStroke / 2) - 6);
      drawCircle();
    };

    resizeCanvas();
    window.addEventListener('resize', resizeCanvas);

    return () => window.removeEventListener('resize', resizeCanvas);
  }, [drawCircle]);

  const getAngleFromEvent = useCallback((e) => {
    const canvas = canvasRef.current;
    if (!canvas) return 0;
    
    const r = canvas.getBoundingClientRect();
    const cx = (e.touches ? e.touches[0].clientX : e.clientX) - r.left - centerXRef.current;
    const cy = (e.touches ? e.touches[0].clientY : e.clientY) - r.top - centerYRef.current;
    return Math.atan2(cy, cx);
  }, []);

  const handleStart = useCallback((e) => {
    e.preventDefault();
    setDragging(true);
    setHoursAccumulator(0);
    setStartDragAngle(getAngleFromEvent(e));
  }, [getAngleFromEvent]);

  const handleMove = useCallback((e) => {
    if (!dragging) return;
    e.preventDefault();

    const cur = getAngleFromEvent(e);
    let d = cur - startDragAngle;
    if (d < -Math.PI) d += 2 * Math.PI;
    if (d > Math.PI) d -= 2 * Math.PI;
    
    setStartDragAngle(cur);
    
    const deltaHours = (d / (2 * Math.PI)) * maxHours;
    const newAccumulator = hoursAccumulator + deltaHours;
    setHoursAccumulator(newAccumulator);
    
    const step = newAccumulator > 0 ? Math.floor(newAccumulator) : Math.ceil(newAccumulator);
    
    if (step !== 0) {
      const capacityLeft = maxHours - sumHoursExcept(activeId);
      const current = hoursPerProject[activeId] || 0;
      const newVal = clamp(current + step, 0, Math.min(maxHours, current + capacityLeft));
      const applied = newVal - current;
      
      if (applied !== 0) {
        setHoursPerProject(prev => ({
          ...prev,
          [activeId]: newVal
        }));
        setHoursAccumulator(newAccumulator - applied);
      } else {
        setHoursAccumulator(0);
      }
    }
  }, [dragging, startDragAngle, getAngleFromEvent, maxHours, hoursAccumulator, sumHoursExcept, activeId, hoursPerProject, clamp]);

  const handleEnd = useCallback(() => {
    setDragging(false);
    setHoursAccumulator(0);
  }, []);

  const handleProjectClick = useCallback((id) => {
    setActiveId(id);
  }, []);

  const handleSubmit = useCallback(() => {
    // Add bounce animation
    setIsAnimating(true);
    
    // Change icon to checkmark
    setIsSubmitted(true);
    
    const payload = { 
      activeId, 
      hoursPerProject, 
      total: sumHours(), 
      capacity: maxHours 
    };
    
    // Check if Telegram WebApp is available
    if (window.Telegram?.WebApp) {
      window.Telegram.WebApp.sendData(JSON.stringify(payload));
    } else {
      console.log('Submit payload:', payload);
    }
    
    // Reset animation after 2 seconds
    setTimeout(() => {
      setIsAnimating(false);
      setIsSubmitted(false);
    }, 2000);
  }, [activeId, hoursPerProject, sumHours, maxHours]);

  // Add event listeners
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    canvas.addEventListener('mousedown', handleStart);
    window.addEventListener('mousemove', handleMove);
    window.addEventListener('mouseup', handleEnd);
    canvas.addEventListener('touchstart', handleStart, { passive: false });
    window.addEventListener('touchmove', handleMove, { passive: false });
    window.addEventListener('touchend', handleEnd);

    return () => {
      canvas.removeEventListener('mousedown', handleStart);
      window.removeEventListener('mousemove', handleMove);
      window.removeEventListener('mouseup', handleEnd);
      canvas.removeEventListener('touchstart', handleStart);
      window.removeEventListener('touchmove', handleMove);
      window.removeEventListener('touchend', handleEnd);
    };
  }, [handleStart, handleMove, handleEnd]);

  // Initialize Telegram WebApp
  useEffect(() => {
    if (window.Telegram?.WebApp) {
      window.Telegram.WebApp.expand();
    }
  }, []);

  return (
    <>
      <header>Выставление часов</header>
      <div className="summary-title">Итоги по проектам</div>
      <div className="summary-total">
        Всего: {sumHours()} / {maxHours} ч
      </div>
      <div className="summary-list">
        {projects.map(p => (
          <div
            key={p.id}
            className={`row ${p.id === activeId ? 'active' : ''}`}
            onClick={() => handleProjectClick(p.id)}
          >
            <div className="left">
              <span className="dot" style={{ background: p.color }}></span>
              <span className="name">{p.name}</span>
            </div>
            <div className="hrs">{(hoursPerProject[p.id] || 0)} ч</div>
          </div>
        ))}
      </div>
      <div className="circle-container">
        <canvas ref={canvasRef} />
        <div 
          className={`center-button ${isAnimating ? 'bounce' : ''} ${isSubmitted ? 'submitted' : ''}`}
          onClick={handleSubmit}
          title={isSubmitted ? "Часы залогированы!" : "Внести часы"}
        >
          {isSubmitted ? (
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
              <path d="M20 6L9 17l-5-5" />
            </svg>
          ) : (
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 5v14M5 12h14" />
            </svg>
          )}
        </div>
      </div>
      <div className="hours">{(hoursPerProject[activeId] || 0)} ч</div>
    </>
  );
};

export default TimeLogger;
