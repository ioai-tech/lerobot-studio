export function formatErrorForDisplay(error: Error | null, includeStack: boolean): string {
  if (!error) return '';
  if (!includeStack || !error.stack) return error.message;
  return `${error.message}\n\n${error.stack}`;
}
