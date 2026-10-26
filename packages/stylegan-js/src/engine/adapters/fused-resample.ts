// The bounded fused-resample kernel the ORT WebGPU engine runs between its prefix and suffix segments
// (fm-3h3w), ported from the candidate's browser/fused-resample-v1.mjs (classic a42829b; byte-identical to
// experiment/device-lab/fused-resample-boundary-v2.js, results.tsv keep row mobile-boundary-bounded-phone).
// Every tile read is clamped in bounds and padding masked to zero, so no read leaves its buffer. The WGSL
// it generates is the candidate's, character for character (engine-routes.test.ts compares the two).

export type BoundaryVariant = 'bounded' | 'unrolled';
export interface BoundaryConstants {
  readonly strength: number;
  readonly gain: number;
}

/** The boundary's output plane: its side (the model's resolution) and the 32 channels it writes. */
const plane = (side: number) => {
  if (!Number.isSafeInteger(side) || side < 8 || (side & (side - 1)) !== 0)
    throw Error('Invalid boundary side');
  const pixels = side * side;
  return { padded: side + 2, phase: side / 2 + 1, pixels, total: 32 * pixels };
};

/**
 * The WGSL for a `side`-pixel output plane (the generator passes its descriptor's resolution; the
 * pinned split bundle is FFHQ's, so in the product it is that one).
 */
export function boundaryCode(
  m: BoundaryConstants,
  tail: boolean,
  variant: BoundaryVariant = 'bounded',
  workgroup = 256,
  side?: number,
): string {
  if (!['bounded', 'unrolled'].includes(variant) || ![64, 256].includes(workgroup))
    throw Error('Invalid boundary candidate');
  if (side === undefined) throw Error('The boundary needs the output side');
  const g = plane(side);
  const tap = (fy: string, fx: string) =>
    `{let qy=y+${fy};let qx=xx+${fx};let valid=qy>=1u&&qy<=${g.padded}u&&qx>=1u&&qx<=${g.padded}u;let iy=clamp(qy,1u,${g.padded}u)-1u;let ix=clamp(qx,1u,${g.padded}u)-1u;let offset=(((c%16u)*4u+(iy%2u)*2u+ix%2u)*${g.phase}u+iy/2u)*${g.phase}u+ix/2u;var sample:f32;if(c<16u){sample=x[offset];}else{sample=xb[offset];}let padded=select(0.0,sample,valid);v+=padded*fir[${fy}*4u+${fx}];}`;
  const sum =
    variant === 'bounded'
      ? `for(var fy=0u;fy<4u;fy++){for(var fx=0u;fx<4u;fx++)${tap('fy', 'fx')}}`
      : Array.from({ length: 16 }, (_, i) => tap(`${Math.floor(i / 4)}u`, `${i % 4}u`)).join('\n');
  return (
    ['x', 'd', 'noise', 'fir', 'bias', 'output', 'xb']
      .map(
        (name, i) =>
          `@group(0) @binding(${i}) var<storage,${i === 5 ? 'read_write' : 'read'}> ${name}:array<f32>;`,
      )
      .join('\n') +
    `\n@compute @workgroup_size(${workgroup}) fn main(@builtin(global_invocation_id) id:vec3<u32>){let i=id.y*512u*${workgroup}u+id.x;if(i>=${g.total}u){return;}let c=i/${g.pixels}u;let p=i%${g.pixels}u;let y=p/${side}u;let xx=p%${side}u;var v:f32=0.0;${sum}` +
    (tail
      ? `v=v*d[c];let ns=noise[p]*${m.strength};v=ns+v;v=v+bias[c];if(v<0.0){v=v*0.20000000298023224;}v=v*${m.gain};`
      : '') +
    'output[i]=v;}'
  );
}

export interface BoundaryBuffers {
  readonly phase: GPUBuffer;
  readonly phaseB: GPUBuffer;
  readonly demod?: GPUBuffer | undefined;
  readonly noise?: GPUBuffer | undefined;
  readonly filter: GPUBuffer;
  readonly bias?: GPUBuffer | undefined;
  readonly output: GPUBuffer;
}

export interface BoundaryPipeline {
  bind(buffers: BoundaryBuffers): { encode(encoder: GPUCommandEncoder): void };
}

/** Shader and pipeline are invariant; only bind groups follow the buffers. */
export async function createBoundaryPipeline(
  device: GPUDevice,
  m: BoundaryConstants,
  tail = false,
  workgroup = 256,
  variant: BoundaryVariant = 'bounded',
  side?: number,
): Promise<BoundaryPipeline> {
  const module = device.createShaderModule({
    code: boundaryCode(m, tail, variant, workgroup, side),
  });
  const { total } = plane(side ?? 0);
  const info = await module.getCompilationInfo();
  if (info.messages.some((x) => x.type === 'error'))
    throw Error(info.messages.map((x) => x.message).join('\n'));
  const pipeline = await device.createComputePipelineAsync({
    layout: 'auto',
    compute: { module, entryPoint: 'main' },
  });
  return {
    bind({ phase, phaseB, demod, noise, filter, bias, output }) {
      const used: [number, GPUBuffer | undefined][] = tail
        ? [
            [0, phase],
            [6, phaseB],
            [1, demod],
            [2, noise],
            [3, filter],
            [4, bias],
            [5, output],
          ]
        : [
            [0, phase],
            [6, phaseB],
            [3, filter],
            [5, output],
          ];
      const group = device.createBindGroup({
        layout: pipeline.getBindGroupLayout(0),
        entries: used.map(([binding, buffer]) => {
          if (!buffer) throw Error(`Fused resample binding ${binding} has no buffer`);
          return { binding, resource: { buffer } };
        }),
      });
      return {
        encode(e) {
          const p = e.beginComputePass();
          p.setPipeline(pipeline);
          p.setBindGroup(0, group);
          p.dispatchWorkgroups(512, total / (512 * workgroup));
          p.end();
        },
      };
    },
  };
}
