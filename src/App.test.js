import { render, screen } from '@testing-library/react';
import App from './App';

test('renders login form when unauthenticated', async () => {
  render(<App />);
  const heading = await screen.findByRole('heading', { name: /вход в систему/i });
  expect(heading).toBeInTheDocument();
});
