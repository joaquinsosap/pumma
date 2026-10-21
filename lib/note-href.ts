// A query, not /notes/<id>: Next keys the page by its path, so a path change remounted the notes page on the next refresh and took focus mid-sentence.
export function noteHref(id: string): string {
  return `/notes?note=${encodeURIComponent(id)}`;
}
