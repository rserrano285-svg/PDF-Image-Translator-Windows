import { render, screen } from '@testing-library/react';
import App from './App';

test('renders the translator app header', () => {
  render(<App />);
  expect(screen.getByText('PDF Image Translator')).toBeInTheDocument();
});
