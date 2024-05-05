// mod.ts

export async function spawnWindow(
  width: number,
  height: number,
  presentationFormat: GPUTextureFormat,
  setupFunction: (device: GPUDevice, context: GPUCanvasContext) => void,
  drawFunction: (device: GPUDevice, context: GPUCanvasContext) => void,
  resizeFunction: (width: number, height: number) => void
) {
  // Determine library extension based on your OS.
  let libSuffix = "";
  let system: "win32" | "cocoa" | "wayland" | "x11" = "win32";
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
      system = "wayland";
      break;
  }
  console.log(`Loading ${libSuffix} library for ${system}.`);

  const libName = `./target/release/deno_winit.${libSuffix}`;
  // Open library and define exported symbols
  const dylib = Deno.dlopen(libName, {
    spawn_window: {
      parameters: ["u32", "u32", "function", "function", "function"],
      result: "void",
    },
  } as const);

  const adapter = await navigator.gpu.requestAdapter();
  const device = await adapter?.requestDevice();

  if (!device) {
    throw new Error("No GPU device found.");
  }

  let surface: Deno.UnsafeWindowSurface | null = null;
  let context: GPUCanvasContext | null = null;
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
      setupFunction(device, context);
    }
  );

  const drawFunctionCallback = new Deno.UnsafeCallback(
    { parameters: [], result: "void" },
    () => {
      if (!surface || !context) {
        console.error("Surface or context not initialized.");
        return;
      }

      drawFunction(device, context);
      surface.present();
    }
  );

  const resizeFunctionCallback = new Deno.UnsafeCallback(
    { parameters: ["u32", "u32"], result: "void" },
    (width, height) => resizeFunction(width, height)
  );

  dylib.symbols.spawn_window(
    width,
    height,
    setupFunctionCallback.pointer,
    drawFunctionCallback.pointer,
    resizeFunctionCallback.pointer
  );
}
