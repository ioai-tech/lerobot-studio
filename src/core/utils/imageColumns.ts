export function isImageColumnName(columnName: string): boolean {
  return columnName === 'observation.image' || columnName.startsWith('observation.images');
}

export function detectImageColumns(columnNames: string[]): string[] {
  return columnNames.filter(isImageColumnName);
}
