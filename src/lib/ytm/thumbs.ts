// YouTube Music image URLs on googleusercontent / ggpht carry their size at the end
// ("…=w60-h60-l90-rj"). Asking for a bigger size gives a sharp image instead of an
// upscaled tiny one. Other URLs are returned unchanged.
export function sized(url: string | null | undefined, px: number): string | undefined {
  if (!url) return undefined;
  if (!/googleusercontent\.com|ggpht\.com/.test(url)) return url;
  const i = url.lastIndexOf("=");
  if (i < 0) return url;
  return `${url.slice(0, i)}=w${px}-h${px}-l90-rj`;
}
