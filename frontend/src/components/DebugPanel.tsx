import { useState, useEffect } from 'react';
import { Monitor, Cpu, AlertCircle, CheckCircle, XCircle, ChevronDown, ChevronUp } from 'lucide-react';
import { checkWebGLStatus, getWebGLStatusMessage, type WebGLStatus } from '../utils/webgl-check';
import { isElectron, getPlatform, getArch, getVersions, getElectronGPUInfo } from '../utils/platform';

interface GPUFeatures {
  [key: string]: string;
}

export function DebugPanel() {
  const [isCollapsed, setIsCollapsed] = useState(true);
  const [webglStatus, setWebglStatus] = useState<WebGLStatus | null>(null);
  const [electronGPUInfo, setElectronGPUInfo] = useState<any>(null);

  useEffect(() => {
    // Check WebGL status
    const status = checkWebGLStatus();
    setWebglStatus(status);

    // Get Electron GPU info if available
    if (isElectron()) {
      getElectronGPUInfo().then(info => {
        setElectronGPUInfo(info);
      });
    }
  }, []);

  if (!webglStatus) return null;

  const platform = getPlatform();
  const arch = getArch();
  const versions = getVersions();
  const statusMessage = getWebGLStatusMessage(webglStatus);

  const getStatusIcon = () => {
    if (!webglStatus.supported) {
      return <XCircle className="text-red-500" size={16} />;
    }
    if (!webglStatus.isHardwareAccelerated) {
      return <AlertCircle className="text-yellow-500" size={16} />;
    }
    return <CheckCircle className="text-green-500" size={16} />;
  };

  return (
    <div className="fixed top-4 right-4 z-[9999] max-w-md">
      {/* Collapsed Header */}
      <button
        onClick={() => setIsCollapsed(!isCollapsed)}
        className="w-full bg-gray-900/95 backdrop-blur-sm border border-gray-700 rounded-lg px-4 py-2 flex items-center justify-between hover:bg-gray-800 transition-colors shadow-lg"
      >
        <div className="flex items-center gap-2">
          <Monitor size={16} className="text-indigo-400" />
          <span className="text-sm font-medium text-gray-200">
            {isElectron() ? 'Electron' : 'Web'} Debug
          </span>
          {getStatusIcon()}
        </div>
        {isCollapsed ? <ChevronDown size={16} /> : <ChevronUp size={16} />}
      </button>

      {/* Expanded Panel */}
      {!isCollapsed && (
        <div className="mt-2 bg-gray-900/95 backdrop-blur-sm border border-gray-700 rounded-lg shadow-2xl overflow-hidden">
          {/* Platform Info */}
          <div className="p-4 border-b border-gray-700">
            <div className="flex items-center gap-2 mb-2">
              <Cpu size={14} className="text-indigo-400" />
              <h3 className="text-xs font-semibold text-gray-300 uppercase tracking-wide">Platform</h3>
            </div>
            <div className="space-y-1 text-xs">
              <InfoRow label="Environment" value={isElectron() ? '🖥️ Electron' : '🌐 Web Browser'} />
              <InfoRow label="OS" value={platform} />
              <InfoRow label="Architecture" value={arch} />
              {isElectron() && (
                <>
                  <InfoRow label="Electron" value={versions?.electron || 'N/A'} />
                  <InfoRow label="Chrome" value={versions?.chrome || 'N/A'} />
                  <InfoRow label="Node" value={versions?.node || 'N/A'} />
                </>
              )}
            </div>
          </div>

          {/* WebGL Info */}
          <div className="p-4 border-b border-gray-700">
            <div className="flex items-center gap-2 mb-2">
              <Monitor size={14} className="text-indigo-400" />
              <h3 className="text-xs font-semibold text-gray-300 uppercase tracking-wide">WebGL</h3>
            </div>
            <div className="mb-2">
              <div className="flex items-center gap-2 text-xs">
                {getStatusIcon()}
                <span className={`${
                  webglStatus.isHardwareAccelerated ? 'text-green-400' :
                  webglStatus.supported ? 'text-yellow-400' : 'text-red-400'
                }`}>
                  {statusMessage}
                </span>
              </div>
            </div>
            <div className="space-y-1 text-xs">
              <InfoRow label="Version" value={webglStatus.version.toUpperCase()} />
              <InfoRow label="Renderer" value={webglStatus.renderer} valueClassName="font-mono text-[10px]" />
              <InfoRow label="Vendor" value={webglStatus.vendor} valueClassName="font-mono text-[10px]" />
              <InfoRow label="Max Texture Size" value={`${webglStatus.maxTextureSize}px`} />
              <InfoRow label="Max Viewport" value={`${webglStatus.maxViewportDims[0]}×${webglStatus.maxViewportDims[1]}`} />
              <InfoRow label="Extensions" value={`${webglStatus.extensions.length} available`} />
            </div>
          </div>

          {/* Electron GPU Features */}
          {isElectron() && electronGPUInfo?.featureStatus && (
            <div className="p-4">
              <div className="flex items-center gap-2 mb-2">
                <Cpu size={14} className="text-indigo-400" />
                <h3 className="text-xs font-semibold text-gray-300 uppercase tracking-wide">GPU Features</h3>
              </div>
              <div className="space-y-1 text-xs max-h-48 overflow-y-auto">
                {Object.entries(electronGPUInfo.featureStatus as GPUFeatures).map(([key, value]) => (
                  <InfoRow
                    key={key}
                    label={formatFeatureName(key)}
                    value={value}
                    valueClassName={getFeatureStatusColor(value)}
                  />
                ))}
              </div>
            </div>
          )}

          {/* Performance Warning */}
          {webglStatus.supported && !webglStatus.isHardwareAccelerated && (
            <div className="p-3 bg-yellow-900/20 border-t border-yellow-700/30">
              <div className="flex items-start gap-2">
                <AlertCircle size={14} className="text-yellow-500 mt-0.5 flex-shrink-0" />
                <div className="text-xs text-yellow-200">
                  <p className="font-semibold mb-1">Software Renderer Detected</p>
                  <p className="text-yellow-300/80">
                    GPU acceleration is disabled. Performance may be slow.
                    {platform === 'linux' && ' Check GPU drivers.'}
                  </p>
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

interface InfoRowProps {
  label: string;
  value: string;
  valueClassName?: string;
}

function InfoRow({ label, value, valueClassName = '' }: InfoRowProps) {
  return (
    <div className="flex justify-between items-start gap-2">
      <span className="text-gray-400 flex-shrink-0">{label}:</span>
      <span className={`text-gray-200 text-right break-all ${valueClassName}`}>{value}</span>
    </div>
  );
}

function formatFeatureName(key: string): string {
  return key
    .replace(/_/g, ' ')
    .split(' ')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

function getFeatureStatusColor(status: string): string {
  const lowerStatus = status.toLowerCase();
  if (lowerStatus.includes('enabled') || lowerStatus.includes('hardware')) {
    return 'text-green-400';
  }
  if (lowerStatus.includes('disabled') || lowerStatus.includes('unavailable')) {
    return 'text-red-400';
  }
  if (lowerStatus.includes('software')) {
    return 'text-yellow-400';
  }
  return 'text-gray-300';
}
