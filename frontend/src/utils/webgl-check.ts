/**
 * WebGL detection and debugging utilities
 */

export interface WebGLStatus {
  supported: boolean;
  version: 'webgl' | 'webgl2' | 'none';
  renderer: string;
  vendor: string;
  isHardwareAccelerated: boolean;
  maxTextureSize: number;
  maxViewportDims: number[];
  extensions: string[];
}

/**
 * Check WebGL support and get detailed renderer information
 */
export function checkWebGLStatus(): WebGLStatus {
  const canvas = document.createElement('canvas');

  // Try WebGL2 first, then WebGL1
  let gl: WebGLRenderingContext | WebGL2RenderingContext | null =
    canvas.getContext('webgl2') as WebGL2RenderingContext | null;

  let version: 'webgl' | 'webgl2' | 'none' = 'none';

  if (gl) {
    version = 'webgl2';
  } else {
    gl = canvas.getContext('webgl') as WebGLRenderingContext | null;
    if (gl) {
      version = 'webgl';
    }
  }

  if (!gl) {
    return {
      supported: false,
      version: 'none',
      renderer: 'None',
      vendor: 'None',
      isHardwareAccelerated: false,
      maxTextureSize: 0,
      maxViewportDims: [0, 0],
      extensions: []
    };
  }

  // Get renderer info
  const debugInfo = gl.getExtension('WEBGL_debug_renderer_info');
  const renderer = debugInfo
    ? gl.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL)
    : gl.getParameter(gl.RENDERER);

  const vendor = debugInfo
    ? gl.getParameter(debugInfo.UNMASKED_VENDOR_WEBGL)
    : gl.getParameter(gl.VENDOR);

  // Check if hardware accelerated (not using software renderer)
  const isHardwareAccelerated =
    !renderer.toLowerCase().includes('swiftshader') &&
    !renderer.toLowerCase().includes('software') &&
    !renderer.toLowerCase().includes('llvmpipe') &&
    !renderer.toLowerCase().includes('microsoft basic');

  // Get capabilities
  const maxTextureSize = gl.getParameter(gl.MAX_TEXTURE_SIZE);
  const maxViewportDims = gl.getParameter(gl.MAX_VIEWPORT_DIMS);

  // Get available extensions
  const extensions = gl.getSupportedExtensions() || [];

  return {
    supported: true,
    version,
    renderer,
    vendor,
    isHardwareAccelerated,
    maxTextureSize,
    maxViewportDims,
    extensions
  };
}

/**
 * Get a human-readable status message
 */
export function getWebGLStatusMessage(status: WebGLStatus): string {
  if (!status.supported) {
    return '❌ WebGL is not supported';
  }

  if (!status.isHardwareAccelerated) {
    return '⚠️ WebGL is running on software renderer (slow performance expected)';
  }

  return `✅ WebGL ${status.version.toUpperCase()} with hardware acceleration`;
}

/**
 * Check if WebGL performance is adequate for heavy graphics
 */
export function isWebGLPerformanceGood(status: WebGLStatus): boolean {
  return (
    status.supported &&
    status.isHardwareAccelerated &&
    status.maxTextureSize >= 4096
  );
}

/**
 * Log detailed WebGL info to console
 */
export function logWebGLInfo(): void {
  const status = checkWebGLStatus();

  console.group('🎨 WebGL Information');
  console.log('Supported:', status.supported);
  console.log('Version:', status.version);
  console.log('Renderer:', status.renderer);
  console.log('Vendor:', status.vendor);
  console.log('Hardware Accelerated:', status.isHardwareAccelerated);
  console.log('Max Texture Size:', status.maxTextureSize);
  console.log('Max Viewport:', status.maxViewportDims);
  console.log('Extensions:', status.extensions.length, 'available');
  console.groupEnd();
}

/**
 * Create a test WebGL context to verify it works
 */
export function testWebGLRendering(): boolean {
  try {
    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl') || canvas.getContext('webgl2');

    if (!gl) return false;

    // Try to create a simple shader
    const vertexShader = gl.createShader(gl.VERTEX_SHADER);
    if (!vertexShader) return false;

    gl.shaderSource(vertexShader, 'void main() { gl_Position = vec4(0.0, 0.0, 0.0, 1.0); }');
    gl.compileShader(vertexShader);

    const success = gl.getShaderParameter(vertexShader, gl.COMPILE_STATUS);
    gl.deleteShader(vertexShader);

    return success;
  } catch (error) {
    console.error('WebGL test failed:', error);
    return false;
  }
}
