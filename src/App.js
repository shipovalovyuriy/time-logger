import React, { useState, useEffect } from 'react';
import './App.css';
import TimeLogger from './components/TimeLogger';
import LoginForm from './components/LoginForm';
import storage from './utils/storage';

function App() {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isTelegramWebApp, setIsTelegramWebApp] = useState(false);

  useEffect(() => {
    console.log('App: Checking localStorage for token...');
    const storageInfo = storage.getInfo();
    console.log('App: Storage info:', storageInfo);
    
    const token = storage.getItem('token');
    console.log('App: Found token in localStorage:', token ? 'YES' : 'NO');
    
    if (token) {
      console.log('App: Token value:', token);
      setIsAuthenticated(true);
    } else {
      console.log('App: No token found, user not authenticated');
    }
    
    // Debug localStorage state
    console.log('App: All localStorage keys:', storage.getKeys());
    console.log('App: localStorage length:', storageInfo.length);
  }, []);

  useEffect(() => {
    const tg = window.Telegram?.WebApp;
    const root = document.documentElement;

    const applyFallbackViewport = () => {
      root.style.setProperty('--tg-viewport-height', `${window.innerHeight}px`);
    };

    if (!tg) {
      setIsTelegramWebApp(false);
      applyFallbackViewport();
      window.addEventListener('resize', applyFallbackViewport);

      return () => {
        window.removeEventListener('resize', applyFallbackViewport);
      };
    }

    setIsTelegramWebApp(true);

    const applyTheme = () => {
      const theme = tg.themeParams || {};

      root.style.setProperty('--tg-bg-color', theme.bg_color || '#0f172a');
      root.style.setProperty('--tg-secondary-bg-color', theme.secondary_bg_color || '#17233a');
      root.style.setProperty('--tg-text-color', theme.text_color || '#ffffff');
      root.style.setProperty('--tg-hint-color', theme.hint_color || '#b6c2d9');
      root.style.setProperty('--tg-link-color', theme.link_color || '#5ac8fa');
      root.style.setProperty('--tg-button-color', theme.button_color || '#2ea6ff');
      root.style.setProperty('--tg-button-text-color', theme.button_text_color || '#ffffff');
      root.style.setProperty('--tg-destructive-color', theme.destructive_text_color || '#ff6b6b');
      root.dataset.tgColorScheme = tg.colorScheme || 'light';
    };

    const applyViewport = () => {
      const height = Number(tg.viewportStableHeight || tg.viewportHeight || window.innerHeight);
      root.style.setProperty('--tg-viewport-height', `${height}px`);
    };

    try {
      tg.ready();
      tg.expand();
    } catch (error) {
      console.warn('Telegram WebApp init warning:', error);
    }

    applyTheme();
    applyViewport();

    try {
      if (tg.themeParams?.bg_color) {
        tg.setBackgroundColor(tg.themeParams.bg_color);
      }
      if (tg.themeParams?.secondary_bg_color) {
        tg.setHeaderColor(tg.themeParams.secondary_bg_color);
      }
    } catch (error) {
      console.warn('Telegram WebApp color warning:', error);
    }

    tg.onEvent('themeChanged', applyTheme);
    tg.onEvent('viewportChanged', applyViewport);
    window.addEventListener('resize', applyViewport);

    return () => {
      tg.offEvent('themeChanged', applyTheme);
      tg.offEvent('viewportChanged', applyViewport);
      window.removeEventListener('resize', applyViewport);
    };
  }, []);

  const handleLoginSuccess = () => {
    setIsAuthenticated(true);
  };

  const handleLogout = () => {
    storage.removeItem('token');
    storage.removeItem('userId');
    setIsAuthenticated(false);
  };

  return (
    <div className={`App ${isTelegramWebApp ? 'telegram-app' : ''}`}>
      {isAuthenticated ? (
        <>
          <button type="button" className="logout-button" onClick={handleLogout} aria-label="Выйти">
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
              <polyline points="16,17 21,12 16,7" />
              <line x1="21" y1="12" x2="9" y2="12" />
            </svg>
          </button>
          <TimeLogger />
        </>
      ) : (
        <LoginForm onLoginSuccess={handleLoginSuccess} />
      )}
    </div>
  );
}

export default App;
