import { dlopen, FetchOptions } from "@denosaurs/plug";

export const VERSION = "0.1.0";

export class Window {
  private dylibPromise: Promise<
    Deno.DynamicLibrary<{
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
    }>
  >;
  private system: "win32" | "cocoa" | "wayland" | "x11" | null = null;
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

  constructor(forceX11: boolean = false) {
    switch (Deno.build.os) {
      case "linux":
        if (forceX11) {
          this.system = "x11";
        } else {
          this.system = "wayland";
        }
        break;
      case "windows":
        this.system = "win32";
        break;
      case "darwin":
        this.system = "cocoa";
        break;
      default:
        break;
    }

    const options: FetchOptions = {
      name: "deno_winit",
      url: `https://github.com/fazil47/deno_winit/releases/download/v${VERSION}/`,
    };

    this.dylibPromise = dlopen(options, {
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
    if (!this.dylibPromise) {
      throw new Error("Dynamic library not loaded.");
    }

    if (!this.system) {
      throw new Error("System not supported.");
    }

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
        if (!this.system) {
          throw new Error("System not supported.");
        }

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

    const dylib = await this.dylibPromise;
    dylib.symbols.spawn_window(
      this.width,
      this.height,
      setupFunctionCallback.pointer,
      drawFunctionCallback.pointer,
      resizeFunctionCallback.pointer
    );
  }
}
