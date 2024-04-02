// mod.ts

const shaderCode = `
@vertex
fn vs_main(@builtin(vertex_index) in_vertex_index: u32) -> @builtin(position) vec4<f32> {
    let x = f32(i32(in_vertex_index) - 1);
    let y = f32(i32(in_vertex_index & 1u) * 2 - 1);
    return vec4<f32>(x, y, 0.0, 1.0);
}

@fragment
fn fs_main() -> @location(0) vec4<f32> {
    return vec4<f32>(1.0, 0.0, 0.0, 1.0);
}
`;

const presentationFormat = "bgra8unorm";

// Determine library extension based on
// your OS.
let libSuffix = "";
let system: "win32" | "cocoa" | "x11" = "win32";
switch (Deno.build.os) {
  case "windows":
    libSuffix = "dll";
    system = "win32";
    break;
  case "darwin":
    libSuffix = "dylib";
    system = "cocoa";
    break;
  default:
    libSuffix = "so";
    system = "x11";
    break;
}
console.log(`Loading ${libSuffix} library for ${system}.`);

const libName = `./target/release/deno_winit.${libSuffix}`;
// Open library and define exported symbols
const dylib = Deno.dlopen(libName, {
  spawn_window: { parameters: ["function", "function"], result: "void" },
} as const);

const adapter = await navigator.gpu.requestAdapter();
const device = await adapter?.requestDevice();

if (!device) {
  throw new Error("No GPU device found.");
}

let surface: Deno.UnsafeWindowSurface | null = null;
let context: GPUCanvasContext | null = null;
let renderPipeline: GPURenderPipeline | null = null;
const setupFunctionCallback = new Deno.UnsafeCallback(
  { parameters: ["pointer", "pointer", "u32", "u32"], result: "void" },
  (winHandle, displayHandle, width, height) => {
    surface = new Deno.UnsafeWindowSurface(system, winHandle, displayHandle);
    context = surface.getContext("webgpu");
    context.configure({
      device,
      format: presentationFormat,
      width,
      height,
    });

    const shaderModule = device.createShaderModule({
      code: shaderCode,
    });

    const pipelineLayout = device.createPipelineLayout({
      bindGroupLayouts: [],
    });

    renderPipeline = device.createRenderPipeline({
      layout: pipelineLayout,
      vertex: {
        module: shaderModule,
        entryPoint: "vs_main",
      },
      fragment: {
        module: shaderModule,
        entryPoint: "fs_main",
        targets: [
          {
            format: presentationFormat,
          },
        ],
      },
    });
  }
);

const drawFunctionCallback = new Deno.UnsafeCallback(
  { parameters: ["u32", "u32"], result: "void" },
  () => {
    if (!surface || !context || !renderPipeline) {
      console.error("Surface, context, or pipeline not initialized.");
      return;
    }

    const encoder = device.createCommandEncoder();
    const texture = context.getCurrentTexture().createView();
    const renderPass = encoder.beginRenderPass({
      colorAttachments: [
        {
          view: texture,
          storeOp: "store",
          loadOp: "clear",
          clearValue: { r: 0, g: 1, b: 0, a: 1.0 },
        },
      ],
    });
    renderPass.setPipeline(renderPipeline);
    renderPass.draw(3, 1);
    renderPass.end();
    device.queue.submit([encoder.finish()]);
    surface.present();
  }
);

dylib.symbols.spawn_window(
  setupFunctionCallback.pointer,
  drawFunctionCallback.pointer
);
