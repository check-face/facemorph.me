// WebGPU flag values from the specification (GPUBufferUsage, GPUMapMode), so the engines do not depend on the
// globals being declared or present in the scope that loads them.
export const BufferUsage = Object.freeze({
  MAP_READ: 0x0001,
  COPY_SRC: 0x0004,
  COPY_DST: 0x0008,
  UNIFORM: 0x0040,
  STORAGE: 0x0080,
});
export const MapMode = Object.freeze({ READ: 0x0001 });
