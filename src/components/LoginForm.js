import React, { useState } from 'react';
import './LoginForm.css';

const LoginForm = ({ onLoginSuccess }) => {
  const [credentials, setCredentials] = useState({
    login: '',
    password: ''
  });
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');

  const handleInputChange = (e) => {
    const { name, value } = e.target;
    setCredentials(prev => ({
      ...prev,
      [name]: value
    }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setIsLoading(true);
    setError('');

    try {
      const response = await fetch('https://test.newpulse.pkz.icdc.io/auth-service/api/v1/login', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          login: credentials.login,
          pass: credentials.password
        })
      });

      if (response.ok) {
        const data = await response.json();
        localStorage.setItem('authToken', data.token || 'authenticated');
        onLoginSuccess();
      } else {
        const errorData = await response.json();
        setError(errorData.message || 'Ошибка авторизации');
      }
    } catch (err) {
      setError('Ошибка соединения с сервером');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="login-container">
      <div className="login-card">
        <div className="login-header">
          <h2>Вход в систему</h2>
          <p>Введите ваши учетные данные для доступа к логгеру</p>
        </div>
        
        <form onSubmit={handleSubmit} className="login-form">
          <div className="input-group">
            <label htmlFor="login">Логин</label>
            <input
              type="text"
              id="login"
              name="login"
              value={credentials.login}
              onChange={handleInputChange}
              placeholder="Введите логин"
              required
              disabled={isLoading}
            />
          </div>
          
          <div className="input-group">
            <label htmlFor="password">Пароль</label>
            <input
              type="password"
              id="password"
              name="password"
              value={credentials.password}
              onChange={handleInputChange}
              placeholder="Введите пароль"
              required
              disabled={isLoading}
            />
          </div>
          
          {error && (
            <div className="error-message">
              {error}
            </div>
          )}
          
          <button 
            type="submit" 
            className={`login-button ${isLoading ? 'loading' : ''}`}
            disabled={isLoading}
          >
            {isLoading ? (
              <div className="spinner"></div>
            ) : (
              'Войти'
            )}
          </button>
        </form>
      </div>
    </div>
  );
};

export default LoginForm;
