// Fit the whole image into a viewport without changing its aspect ratio.
export function fitImage(aspect, width, height) {
  const h = Math.min(height, width / aspect);
  return { width: h * aspect, height: h };
}

// Center-crop an image into a square using geometry UVs. The texture itself
// stays unchanged so the zoom view can still show the complete original.
export function squareCrop(aspect) {
  const width = aspect > 1 ? 1 / aspect : 1;
  const height = aspect < 1 ? aspect : 1;
  return { x: (1 - width) / 2, y: (1 - height) / 2, width, height };
}
