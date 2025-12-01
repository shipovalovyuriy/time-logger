import React, { useState, useEffect, useRef, useCallback } from 'react';
import DatePicker from 'react-datepicker';
import 'react-datepicker/dist/react-datepicker.css';
import storage from '../utils/storage';
import './TimeLogger.css';

const TimeLogger = ({ onSessionExpired }) => {
  const [projects, setProjects] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState(null);
  const [timesheetData, setTimesheetData] = useState([]); // Store full timesheet data
  const [isSubmitted, setIsSubmitted] = useState(false);
  const [isAnimating, setIsAnimating] = useState(false);
  const [selectedDate, setSelectedDate] = useState(new Date());
  const [hoursPerProject, setHoursPerProject] = useState({});
  const [activeId, setActiveId] = useState(null);
  const [draggingProjectId, setDraggingProjectId] = useState(null);
  const maxHours = 8; // Maximum total hours per day

  // Calculate total hours
  const sumHours = useCallback(() => {
    return Math.round(Object.values(hoursPerProject).reduce((sum, hours) => sum + Math.max(0, hours || 0), 0));
  }, [hoursPerProject]);

  // Check if total hours exceed limit
  const totalHours = sumHours();

  // Fixed set of highly contrasting colors for projects
  const getProjectColor = (projectId) => {
    const colors = [
      '#FF0000', // Яркий красный
      '#00FF00', // Яркий зеленый
      '#0000FF', // Яркий синий
      '#FFFF00', // Яркий желтый
      '#FF00FF', // Яркий пурпурный
      '#00FFFF', // Яркий циан
      '#FF8000', // Яркий оранжевый
      '#8000FF', // Яркий фиолетовый
      '#FF0080', // Яркий розовый
      '#80FF00', // Яркий лаймовый
      '#0080FF', // Яркий голубой
      '#FF4000', // Яркий красно-оранжевый
      '#4000FF', // Яркий сине-фиолетовый
      '#FF8040', // Яркий персиковый
      '#8040FF', // Яркий лавандовый
      '#FF4080'  // Яркий малиновый
    ];
    
    // Use project ID to consistently assign the same color to the same project
    return colors[projectId % colors.length];
  };

  // Fetch timesheet data
  const fetchTimesheet = useCallback(async () => {
    // Show loader while data is being requested
    setIsLoading(true);

    try {
      console.log('TimeLogger: Starting to fetch timesheet...');
      
      // Get token from localStorage
      const authToken = storage.getItem('token');
      console.log('TimeLogger: Auth token from localStorage:', authToken ? 'FOUND' : 'NOT FOUND');
      
      if (!authToken) {
        console.error('TimeLogger: No auth token found in localStorage');
        setError('Токен авторизации не найден. Пожалуйста, войдите в систему.');
        onSessionExpired?.();
        return;
      }

      // Get user ID from localStorage or use default
      const userId = storage.getItem('userId') || '3227';
      console.log('TimeLogger: Using user ID:', userId);

      // Calculate month start and end based on selected date
      const monthStart = `${selectedDate.getDate()}.${selectedDate.getMonth() + 1}.${selectedDate.getFullYear()}`;
      const monthEnd = `${new Date(selectedDate.getFullYear(), selectedDate.getMonth() + 1, 0).getDate()}.${selectedDate.getMonth() + 1}.${selectedDate.getFullYear()}`;
      
      console.log('TimeLogger: Fetching with params:', { monthStart, monthEnd });

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

      console.log('TimeLogger: API response status:', response.status);

      if (response.status === 401 || response.status === 403) {
        console.error('TimeLogger: Authentication failed, clearing token');
        storage.removeItem('token');
        setError('Сессия истекла. Пожалуйста, войдите в систему снова.');
        onSessionExpired?.();
        return;
      }

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const data = await response.json();
      console.log('TimeLogger: API response data:', data);

      // Store full timesheet data
      const timesheetData = data.result || data;
      setTimesheetData(timesheetData);

      // Parse the response and extract unique active projects
      const uniqueProjects = [];
      const seenProjects = new Set();

      if (timesheetData && Array.isArray(timesheetData)) {
        timesheetData.forEach(item => {
          if (item.project && item.is_active) {
            const projectKey = `${item.project.id}_${item.project.project_name}`;
            if (!seenProjects.has(projectKey) && item.project.project_status === 'Активный') {
              seenProjects.add(projectKey);
              uniqueProjects.push({
                id: item.project.id,
                name: item.project.project_name,
                company: item.project.customer_short_name || 'Неизвестная компания',
                status: item.project.project_status,
                direction: item.project.direction || 'Не указано',
                color: getProjectColor(item.project.id),
                // Additional project info
                startDate: item.project.start_at,
                deadlineDate: item.project.deadline_at,
                factDeadlineDate: item.project.fact_deadline_at,
                projectLevel: item.project.project_level,
                projectType: item.project.project_type,
                healthStatus: item.project.project_health_status,
                contractNum: item.project.contract_num,
                sysProjectId: item.project.sys_project_id
              });
            }
          }
        });
      }

      console.log('TimeLogger: Parsed unique projects:', uniqueProjects);
      console.log('TimeLogger: Total projects found:', uniqueProjects.length);
      setProjects(uniqueProjects);
      setError(null);
    } catch (error) {
      console.error('TimeLogger: Error fetching timesheet:', error);
      setError(`Ошибка загрузки проектов: ${error.message}`);
    } finally {
      setIsLoading(false);
    }
  }, [onSessionExpired, selectedDate]);

  // Load projects on component mount
  useEffect(() => {
    fetchTimesheet();
  }, [fetchTimesheet]);

  // Get work hours for selected project and date
  const getWorkHoursForProjectAndDate = useCallback((projectId, date) => {
    if (!timesheetData || !Array.isArray(timesheetData)) return 0;
    
    const dateString = date.toISOString().split('T')[0]; // Format as YYYY-MM-DD
    
    const matchingEntry = timesheetData.find(item => 
      item.project?.id === projectId && 
      item.work_day && 
      item.work_day.split('T')[0] === dateString
    );
    
    return matchingEntry?.work_hour || 0;
  }, [timesheetData]);

  // Initialize hours per project when projects change
  useEffect(() => {
    if (projects.length > 0) {
      const initialHours = {};
      let totalLoadedHours = 0;
      
      projects.forEach(project => {
        const workHours = Math.max(0, Math.round(getWorkHoursForProjectAndDate(project.id, selectedDate))); // Round to whole numbers
        // Ensure we don't exceed the 8-hour limit
        const remainingHours = maxHours - totalLoadedHours;
        const allowedHours = Math.min(workHours, remainingHours);
        
        initialHours[project.id] = Math.max(0, Math.round(allowedHours)); // Round to whole numbers
        totalLoadedHours += allowedHours;
      });
      
      setHoursPerProject(initialHours);
      
      // Set first project as active
      setActiveId(projects[0].id);
    }
  }, [projects, selectedDate, getWorkHoursForProjectAndDate, maxHours]);

  const updateHoursFromPosition = useCallback((projectId, event, target) => {
    if (!target) return;

    const rect = target.getBoundingClientRect();
    const clientX = event.touches?.[0]?.clientX ?? event.clientX;
    const ratio = Math.min(Math.max((clientX - rect.left) / rect.width, 0), 1);

    const desiredHours = Math.max(0, Math.min(maxHours, ratio * maxHours));
    const currentProjectHours = hoursPerProject[projectId] || 0;
    const otherTotal = Object.entries(hoursPerProject).reduce((sum, [id, hours]) => {
      if (Number(id) === Number(projectId)) return sum;
      return sum + Math.max(0, hours || 0);
    }, 0);

    const maxForProject = Math.max(0, maxHours - otherTotal);
    const finalHours = Math.min(desiredHours, maxForProject);

    setHoursPerProject(prev => ({
      ...prev,
      [projectId]: parseFloat(finalHours.toFixed(1))
    }));

    setActiveId(projectId);
  }, [hoursPerProject, maxHours]);

  const handleRowPointerDown = useCallback((projectId, event) => {
    setDraggingProjectId(projectId);
    updateHoursFromPosition(projectId, event, event.currentTarget);
  }, [updateHoursFromPosition]);

  const handleRowPointerMove = useCallback((projectId, event) => {
    if (!draggingProjectId || draggingProjectId !== projectId) return;
    if (event.buttons === 0 && !event.touches) return;

    updateHoursFromPosition(projectId, event, event.currentTarget);
  }, [draggingProjectId, updateHoursFromPosition]);

  const handleRowPointerEnd = useCallback(() => {
    setDraggingProjectId(null);
  }, []);

  const handleSubmit = useCallback(async () => {
    // Add bounce animation
    setIsAnimating(true);
    
    // Change icon to checkmark
    setIsSubmitted(true);
    
    console.log('Button clicked - setting isSubmitted to true');
    
    const payload = { 
      activeId, 
      hoursPerProject, 
      total: sumHours(), 
      capacity: maxHours,
      date: selectedDate.toISOString().split('T')[0] // Format as YYYY-MM-DD
    };
    
    console.log('Submit payload:', payload);
    
    // Get auth token
    const authToken = storage.getItem('token');
    const userId = storage.getItem('userId') || '3227';
    
    if (authToken) {
      try {
        // Send data for each project with hours
        const promises = Object.entries(hoursPerProject).map(async ([projectId, hours]) => {
          // Send all projects, including those with 0 hours
          const projectPayload = {
            member_id: parseInt(userId),
            project_id: parseInt(projectId),
            work_day: selectedDate.toISOString(),
            work_hour: Math.round(hours) // Round hours to whole numbers before sending
          };
          
          console.log(`Sending data for project ${projectId}:`, projectPayload);
          
          const response = await fetch('https://test.newpulse.pkz.icdc.io/project-service/api/v1/timesheet/perday', {
            method: 'PUT',
            headers: {
              'Authorization': authToken,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify(projectPayload)
          });
          
          if (response.ok) {
            console.log(`Successfully sent data for project ${projectId}`);
            return { projectId, success: true };
          } else {
            console.error(`Failed to send data for project ${projectId}:`, response.status);
            return { projectId, success: false, status: response.status };
          }
        });
        
        const results = await Promise.all(promises);
        console.log('All API requests completed:', results);
        
        // Check if Telegram WebApp is available
        if (window.Telegram?.WebApp) {
          window.Telegram.WebApp.sendData(JSON.stringify(payload));
        }
        
      } catch (error) {
        console.error('Error sending data to API:', error);
      }
    } else {
      console.error('No auth token available');
    }
    
    // Don't reset animation - let it stay as checkmark until hours change
    // The button will only reset when hoursPerProject changes
  }, [activeId, hoursPerProject, sumHours, maxHours, selectedDate]);

  // Track previous hours to detect changes
  const prevHoursRef = useRef({});

  // Reset button state when hours change
  useEffect(() => {
    if (isSubmitted && Object.keys(prevHoursRef.current).length > 0) {
      // Check if hours actually changed
      const currentHours = JSON.stringify(hoursPerProject);
      const prevHours = JSON.stringify(prevHoursRef.current);
      
      if (currentHours !== prevHours) {
        console.log('Hours changed - resetting button state');
        setIsAnimating(false);
        setIsSubmitted(false);
      }
    }
    
    // Update previous hours reference
    prevHoursRef.current = { ...hoursPerProject };
  }, [hoursPerProject, isSubmitted]);

  useEffect(() => {
    const stopDragging = () => setDraggingProjectId(null);

    window.addEventListener('mouseup', stopDragging);
    window.addEventListener('touchend', stopDragging);

    return () => {
      window.removeEventListener('mouseup', stopDragging);
      window.removeEventListener('touchend', stopDragging);
    };
  }, []);

  // Initialize Telegram WebApp
  useEffect(() => {
    if (window.Telegram?.WebApp) {
      window.Telegram.WebApp.expand();
    }
  }, []);

  return (
    <>
      <div className="date-picker-container">
        <DatePicker
          selected={selectedDate}
          onChange={(date) => {
            setSelectedDate(date);
            // Recalculate hours for new date
            if (projects.length > 0) {
              const newHours = {};
              let totalLoadedHours = 0;
              
              projects.forEach(project => {
                const workHours = Math.max(0, Math.round(getWorkHoursForProjectAndDate(project.id, date))); // Round to whole numbers
                // Ensure we don't exceed the 8-hour limit
                const remainingHours = maxHours - totalLoadedHours;
                const allowedHours = Math.min(workHours, remainingHours);
                
                newHours[project.id] = Math.max(0, Math.round(allowedHours)); // Round to whole numbers
                totalLoadedHours += allowedHours;
              });
              
              setHoursPerProject(newHours);
            }
          }}
          dateFormat="dd.MM.yyyy"
          maxDate={new Date()}
          className="date-picker-input"
          placeholderText="Выберите дату"
          showYearDropdown={true}
          showMonthDropdown={true}
          dropdownMode="select"
          openToDate={selectedDate}
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
            <span className="total-label">Всего часов:</span>
            <span className={`total-hours ${totalHours >= maxHours ? 'limit-reached' : ''}`}>
              {Math.round(totalHours)}/{maxHours}
            </span>
          </div>
          <div className="summary-list">
            {projects.map(p => {
              const filledPercent = Math.min(100, Math.max(0, ((hoursPerProject[p.id] || 0) / maxHours) * 100));
              return (
                <div
                  key={p.id}
                  className={`project-rect ${activeId === p.id ? 'active' : ''}`}
                  onMouseDown={(e) => handleRowPointerDown(p.id, e)}
                  onMouseMove={(e) => handleRowPointerMove(p.id, e)}
                  onMouseUp={handleRowPointerEnd}
                  onTouchStart={(e) => handleRowPointerDown(p.id, e)}
                  onTouchMove={(e) => handleRowPointerMove(p.id, e)}
                  onTouchEnd={handleRowPointerEnd}
                >
                  <div className="project-fill" style={{ width: `${filledPercent}%`, backgroundColor: p.color }} />
                  <div className="project-content">
                    <div className="project-name">{p.name}</div>
                    <div className="project-hours">
                      {parseFloat((hoursPerProject[p.id] || 0).toFixed(1))} ч
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          <button
            className={`log-button ${isAnimating ? 'bounce' : ''} ${isSubmitted ? 'submitted' : ''}`}
            onClick={handleSubmit}
            title={isSubmitted ? "Часы залогированы!" : "Внести часы"}
          >
            {isSubmitted ? 'Залогировано' : 'Внести часы'}
          </button>
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
