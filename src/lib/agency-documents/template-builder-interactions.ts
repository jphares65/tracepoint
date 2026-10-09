export type TemplateGeometry = { x: number; y: number; width: number; height: number };

const minimumSize = 0.02;
const clamp = (value: number, minimum: number, maximum: number) => Math.round(Math.min(maximum, Math.max(minimum, value)) * 1_000_000) / 1_000_000;

export function geometryAtCanvasPoint(clientX: number, clientY: number, rect: { left: number; top: number; width: number; height: number }): TemplateGeometry {
  const width = 0.28, height = 0.045;
  return {
    x: clamp((clientX - rect.left) / rect.width, 0, 1 - width),
    y: clamp((clientY - rect.top) / rect.height, 0, 1 - height),
    width,
    height,
  };
}

export function moveGeometry(geometry: TemplateGeometry, deltaX: number, deltaY: number, rect: { width: number; height: number }): TemplateGeometry {
  return {
    ...geometry,
    x: clamp(geometry.x + deltaX / rect.width, 0, 1 - geometry.width),
    y: clamp(geometry.y + deltaY / rect.height, 0, 1 - geometry.height),
  };
}

export function resizeGeometry(geometry: TemplateGeometry, deltaX: number, deltaY: number, rect: { width: number; height: number }): TemplateGeometry {
  return {
    ...geometry,
    width: clamp(geometry.width + deltaX / rect.width, minimumSize, 1 - geometry.x),
    height: clamp(geometry.height + deltaY / rect.height, minimumSize, 1 - geometry.y),
  };
}
