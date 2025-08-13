import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import DatePicker from 'react-datepicker';
import 'react-datepicker/dist/react-datepicker.css';
import './TimeLogger.css';

const TimeLogger = () => {
  const [hoursPerProject, setHoursPerProject] = useState({});
  const [activeId, setActiveId] = useState(null);
  const [dragging, setDragging] = useState(false);
  const [hoursAccumulator, setHoursAccumulator] = useState(0);
  const [startDragAngle, setStartDragAngle] = useState(0);
  const [isSubmitted, setIsSubmitted] = useState(false);
  const [isAnimating, setIsAnimating] = useState(false);
  const [selectedDate, setSelectedDate] = useState(new Date());
  const [projects, setProjects] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');

  const canvasRef = useRef(null);
  const ctxRef = useRef(null);
  const centerXRef = useRef(0);
  const centerYRef = useRef(0);
  const radiusRef = useRef(0);

  const BASE_STROKE = 26;
  const SEGMENT_STROKE = 30;
  const maxHours = 8;

  // Generate colors for projects
  const generateProjectColors = (count) => {
    const colors = [
      '#667eea', '#764ba2', '#f093fb', '#f5576c', '#4facfe',
      '#00f2fe', '#43e97b', '#38f9d7', '#fa709a', '#fee140',
      '#a8edea', '#fed6e3', '#ffecd2', '#fcb69f', '#ff9a9e',
      '#fecfef', '#fecfef', '#ffecd2', '#fcb69f', '#ff9a9e'
    ];
    
    return colors.slice(0, count);
  };

  // Fetch timesheet data
  const fetchTimesheet = useCallback(async () => {
    try {
      setIsLoading(true);
      setError('');
      
      // Get user ID and token from localStorage
      const userId = localStorage.getItem('userId') || '3227'; // Default fallback
      const authToken = localStorage.getItem('token');
      
      if (!authToken) {
        throw new Error('Токен авторизации не найден. Пожалуйста, войдите в систему.');
      }
      
      // Calculate month start and end based on selected date
      const selectedYear = selectedDate.getFullYear();
      const selectedMonth = selectedDate.getMonth() + 1; // getMonth() returns 0-11
      const daysInMonth = new Date(selectedYear, selectedMonth, 0).getDate();
      
      const monthStart = `1.${selectedMonth}.${selectedYear}`;
      const monthEnd = `${daysInMonth}.${selectedMonth}.${selectedYear}`;
      
      const response = await fetch(
        `https://test.newpulse.pkz.icdc.io/project-service/api/v1/timesheet/list?member_id=${userId}&month_start=${monthStart}&month_end=${monthEnd}`,
        {
          method: 'GET',
          headers: {
            'Authorization': authToken,
            'Content-Type': 'application/json',
          }
        }
      );

      if (!response.ok) {
        if (response.status === 401) {
          throw new Error('Токен истек. Пожалуйста, войдите в систему снова.');
        } else if (response.status === 403) {
          throw new Error('Доступ запрещен. Проверьте права доступа.');
        } else {
          throw new Error(`Ошибка загрузки табеля: ${response.status}`);
        }
      }

      const data = await response.json();
      
      if (!data.status || !data.result) {
        throw new Error('Неверный формат ответа от сервера');
      }
      
      // Extract unique projects from timesheet data
      const projectMap = new Map();
      
      data.result.forEach(item => {
        if (item.project && item.is_active) {
          const projectId = item.project.id;
          
          if (!projectMap.has(projectId)) {
            projectMap.set(projectId, {
              id: projectId,
              name: item.project.project_name,
              company: item.project.customer_short_name,
              status: item.project.project_status,
              isActive: item.is_active,
              direction: item.project.direction,
              projectLevel: item.project.project_level,
              projectType: item.project.project_type,
              healthStatus: item.project.project_health_status,
              startDate: item.project.start_at,
              deadlineDate: item.project.deadline_at,
              factDeadlineDate: item.project.fact_deadline_at,
              contractNum: item.project.contract_num,
              sysProjectId: item.project.sys_project_id,
              timesheetData: item
            });
          }
        }
      });
      
      const transformedProjects = Array.from(projectMap.values());
      setProjects(transformedProjects);
      
      // Set active project to first one
      if (transformedProjects.length > 0) {
        setActiveId(transformedProjects[0].id);
      }

      // Initialize hours per project
      const initialHours = Object.fromEntries(
        transformedProjects.map(p => [p.id, 0])
      );
      setHoursPerProject(initialHours);

    } catch (err) {
      setError(err.message);
      console.error('Error fetching timesheet:', err);
      
      // If token is invalid, redirect to login
      if (err.message.includes('токен') || err.message.includes('авторизации')) {
        localStorage.removeItem('token');
        // You can add redirect logic here if needed
      }
    } finally {
      setIsLoading(false);
    }
  }, [selectedDate]);

  // Load projects on component mount
  useEffect(() => {
    fetchTimesheet();
  }, [fetchTimesheet]);

  // Generate colors for projects
  const projectColors = useMemo(() => {
    const colors = generateProjectColors(projects.length);
    return projects.map((project, index) => ({
      ...project,
      color: colors[index]
    }));
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
    const ordered = [...projectColors].sort((a, b) => a.id - b.id);
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
  }, [hoursPerProject, projectColors, maxHours]);

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

  // Update canvas when projects change
  useEffect(() => {
    if (projectColors.length > 0) {
      drawCircle();
    }
  }, [projectColors, drawCircle]);

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
      capacity: maxHours,
      date: selectedDate.toISOString().split('T')[0] // Format as YYYY-MM-DD
    };
    
    // Check if Telegram WebApp is available
    if (window.Telegram?.WebApp) {
      window.Telegram.WebApp.sendData(JSON.stringify(payload));
    } else {
      console.log('Submit payload:', payload);
      
      // You can also send to your API here if needed
      // const authToken = localStorage.getItem('token');
      // if (authToken) {
      //   fetch('your-api-endpoint', {
      //     method: 'POST',
      //     headers: {
      //       'Authorization': authToken,
      //       'Content-Type': 'application/json',
      //     },
      //     body: JSON.stringify(payload)
      //   });
      // }
    }
    
    // Reset animation after 2 seconds
    setTimeout(() => {
      setIsAnimating(false);
      setIsSubmitted(false);
    }, 2000);
  }, [activeId, hoursPerProject, sumHours, maxHours, selectedDate]);

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
      
      <div className="date-picker-container">
        <label htmlFor="date-picker">Дата:</label>
        <DatePicker
          id="date-picker"
          selected={selectedDate}
          onChange={(date) => setSelectedDate(date)}
          dateFormat="dd.MM.yyyy"
          locale="ru"
          maxDate={new Date()}
          className="date-picker-input"
          placeholderText="Выберите дату"
        />
      </div>

      {isLoading && (
        <div className="loading-container">
          <div className="spinner"></div>
          <p>Загрузка проектов...</p>
        </div>
      )}

      {error && (
        <div className="error-container">
          <p>{error}</p>
          <button onClick={fetchTimesheet} className="retry-button">
            Попробовать снова
          </button>
        </div>
      )}

      {!isLoading && !error && projects.length > 0 && (
        <>
          <div className="summary-title">Итоги по проектам</div>
          <div className="summary-total">
            Всего: {sumHours()} / {maxHours} ч
          </div>
          <div className="summary-list">
            {projectColors.map(p => (
              <div
                key={p.id}
                className={`row ${p.id === activeId ? 'active' : ''}`}
                onClick={() => handleProjectClick(p.id)}
              >
                <div className="left">
                  <span className="dot" style={{ background: p.color }}></span>
                  <div className="project-info">
                    <span className="name">{p.name}</span>
                    <span className="company">{p.company}</span>
                    <span className="status">{p.status} • {p.direction}</span>
                  </div>
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
      )}

      {!isLoading && !error && projects.length === 0 && (
        <div className="no-projects">
          <p>Нет доступных проектов</p>
        </div>
      )}
    </>
  );
};

export default TimeLogger;
