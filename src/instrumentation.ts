export async function register() {
  if (
    process.env.NEXT_RUNTIME === 'nodejs' &&
    process.env.NEXT_PHASE !== 'phase-production-build'
  ) {
    const { startPythonSidecar } = await import('./server/pythonSidecar');
    await startPythonSidecar();
  }
}
