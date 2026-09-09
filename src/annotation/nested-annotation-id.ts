function slugifyNameSegment(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, '.')
    .replace(/^\.+|\.+$/gu, '');
}

export function buildNestedAnnotationId(name: string, parentId?: string | null): string {
  const segment = slugifyNameSegment(name);
  if (!parentId) {
    return segment;
  }
  return `${parentId}.${segment}`;
}
