import { render, screen } from '@testing-library/react';
import App from './App';

describe('App', () => {
  test('shows login form by default when no token is stored', () => {
    render(<App />);

    expect(screen.getByRole('heading', { level: 2, name: /Вход в систему/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Войти/i })).toBeInTheDocument();
  });
});
