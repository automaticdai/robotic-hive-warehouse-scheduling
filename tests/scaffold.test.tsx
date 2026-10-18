// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import Page from '@/app/page';

test('renders the simulator heading', () => {
  render(<Page />);
  expect(
    screen.getByRole('heading', { name: /hive warehouse simulator/i }),
  ).toBeInTheDocument();
});
