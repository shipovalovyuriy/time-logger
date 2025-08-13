import React, { useState, useEffect } from 'react';
import './App.css';
import TimeLogger from './components/TimeLogger';
import LoginForm from './components/LoginForm';
import storage from './utils/storage';

function App() {
  const [isAuthenticated, setIsAuthenticated] = useState(false);

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

  const handleLoginSuccess = () => {
    setIsAuthenticated(true);
  };

  const handleLogout = () => {
    storage.removeItem('token');
    storage.removeItem('userId');
    setIsAuthenticated(false);
  };

  return (
    <div className="App">
      {isAuthenticated ? (
        <>
          <div className="logout-button" onClick={handleLogout}>
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
              <polyline points="16,17 21,12 16,7" />
              <line x1="21" y1="12" x2="9" y2="12" />
            </svg>
          </div>
          <TimeLogger />
        </>
      ) : (
        <LoginForm onLoginSuccess={handleLoginSuccess} />
      )}
    </div>
  );
}

export default App;
