// mod.ts

export class Window {
  private dylib: Deno.DynamicLibrary<{
    readonly spawn_window: {
      readonly parameters: readonly [
        "u32",
        "u32",
        "function",
        "function",
        "function"
      ];
      readonly result: "void";
    };
  }>;
  private system: "win32" | "cocoa" | "wayland" | "x11";
  private width: number = 512;
  private height: number = 512;
  private presentationFormat: GPUTextureFormat = "bgra8unorm";
  private setupFunction: (
    device: GPUDevice,
    context: GPUCanvasContext
  ) => void = () => {};
  private drawFunction: (device: GPUDevice, context: GPUCanvasContext) => void =
    () => {};
  private resizeFunction: (width: number, height: number) => void = () => {};

  constructor() {
    // Determine library extension based on your OS.
    let libSuffix = "";
    switch (Deno.build.os) {
      case "linux":
        libSuffix = "so";
        this.system = "wayland";
        break;
      case "windows":
        libSuffix = "dll";
        this.system = "win32";
        break;
      case "darwin":
        libSuffix = "dylib";
        this.system = "cocoa";
        break;
      default:
        libSuffix = "so";
        this.system = "x11";
        break;
    }
    console.log(`Loading ${libSuffix} library for ${this.system}.`);

    // Open library and define exported symbols
    const libName = `./target/release/deno_winit.${libSuffix}`;
    this.dylib = Deno.dlopen(libName, {
      spawn_window: {
        parameters: ["u32", "u32", "function", "function", "function"],
        result: "void",
      },
    } as const);
  }

  public withSize(width: number, height: number) {
    this.width = width;
    this.height = height;
    return this;
  }

  public withFormat(format: GPUTextureFormat) {
    this.presentationFormat = format;
    return this;
  }

  public withSetupFunction(
    setupFunction: (device: GPUDevice, context: GPUCanvasContext) => void
  ) {
    this.setupFunction = setupFunction;
    return this;
  }

  public withDrawFunction(
    drawFunction: (device: GPUDevice, context: GPUCanvasContext) => void
  ) {
    this.drawFunction = drawFunction;
    return this;
  }

  public withResizeFunction(
    resizeFunction: (width: number, height: number) => void
  ) {
    this.resizeFunction = resizeFunction;
    return this;
  }

  public async spawn() {
    const adapter = await navigator.gpu.requestAdapter();
    if (!adapter) {
      throw new Error("No GPU adapter found.");
    }

    const device = await adapter.requestDevice();
    if (!device) {
      throw new Error("No GPU device found.");
    }

    let surface: Deno.UnsafeWindowSurface | null = null;
    let context: GPUCanvasContext | null = null;
    const setupFunctionCallback = new Deno.UnsafeCallback(
      { parameters: ["pointer", "pointer", "u32", "u32"], result: "void" },
      (winHandle, displayHandle, width, height) => {
        surface = new Deno.UnsafeWindowSurface(
          this.system,
          winHandle,
          displayHandle
        );
        context = surface.getContext("webgpu");
        context.configure({
          device,
          format: this.presentationFormat,
          width,
          height,
        });
        this.setupFunction(device, context);
      }
    );

    const drawFunctionCallback = new Deno.UnsafeCallback(
      { parameters: [], result: "void" },
      () => {
        if (!surface || !context) {
          console.error("Surface or context not initialized.");
          return;
        }

        this.drawFunction(device, context);
        surface.present();
      }
    );

    const resizeFunctionCallback = new Deno.UnsafeCallback(
      { parameters: ["u32", "u32"], result: "void" },
      (width, height) => this.resizeFunction(width, height)
    );

    this.dylib.symbols.spawn_window(
      this.width,
      this.height,
      setupFunctionCallback.pointer,
      drawFunctionCallback.pointer,
      resizeFunctionCallback.pointer
    );
  }
}
