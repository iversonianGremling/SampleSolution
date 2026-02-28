import { useState } from 'react';
import { Server, RefreshCw, CheckCircle, XCircle } from 'lucide-react';
import { isElectron } from '../utils/platform';
import {
  getConfiguredApiUrl,
  setApiBaseUrl,
  resetApiBaseUrl,
  getApiBaseUrl,
  getDefaultElectronApiBaseUrl,
} from '../utils/api-config';

export function ApiSettings() {
  const [customUrl, setCustomUrl] = useState(getConfiguredApiUrl() || '');
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ success: boolean; message: string } | null>(null);
  const defaultApiUrl = getDefaultElectronApiBaseUrl();

  // Only show in Electron
  if (!isElectron()) {
    return null;
  }

  const currentUrl = getApiBaseUrl();

  const handleTest = async () => {
    setTesting(true);
    setTestResult(null);

    const testUrl = customUrl || defaultApiUrl;

    try {
      const response = await fetch(`${testUrl}/auth/status`, {
        method: 'GET',
        credentials: 'include',
      });

      if (response.ok) {
        setTestResult({ success: true, message: 'Connection successful!' });
      } else {
        setTestResult({ success: false, message: `Server returned ${response.status}` });
      }
    } catch (error) {
      setTestResult({ success: false, message: 'Failed to connect to server' });
    } finally {
      setTesting(false);
    }
  };

  const handleSave = () => {
    if (customUrl) {
      setApiBaseUrl(customUrl);
    } else {
      resetApiBaseUrl();
    }
  };

  const handleReset = () => {
    setCustomUrl('');
    resetApiBaseUrl();
  };

  return (
    <div className="bg-gray-800 rounded-lg p-6 border border-gray-700">
      <div className="flex items-center gap-2 mb-4">
        <Server size={20} className="text-indigo-400" />
        <h3 className="text-lg font-semibold text-white">Backend Server</h3>
      </div>

      <div className="space-y-4">
        {/* Current URL Display */}
        <div>
          <label className="block text-sm font-medium text-gray-300 mb-1">
            Current API URL
          </label>
          <div className="bg-gray-900 px-3 py-2 rounded border border-gray-700 text-sm text-gray-400 font-mono">
            {currentUrl}
          </div>
        </div>

        {/* Custom URL Input */}
        <div>
          <label className="block text-sm font-medium text-gray-300 mb-1">
            Custom Backend URL (optional)
          </label>
          <input
            type="text"
            value={customUrl}
            onChange={(e) => setCustomUrl(e.target.value)}
            placeholder={defaultApiUrl}
            className="w-full bg-gray-900 border border-gray-700 rounded px-3 py-2 text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
          />
          <p className="mt-1 text-xs text-gray-400">
            Leave empty to use embedded backend ({defaultApiUrl})
          </p>
        </div>

        {/* Test Result */}
        {testResult && (
          <div className={`flex items-center gap-2 p-3 rounded ${
            testResult.success ? 'bg-green-900/20 border border-green-700/30' : 'bg-red-900/20 border border-red-700/30'
          }`}>
            {testResult.success ? (
              <CheckCircle size={16} className="text-green-500" />
            ) : (
              <XCircle size={16} className="text-red-500" />
            )}
            <span className={`text-sm ${testResult.success ? 'text-green-400' : 'text-red-400'}`}>
              {testResult.message}
            </span>
          </div>
        )}

        {/* Actions */}
        <div className="flex gap-2">
          <button
            onClick={handleTest}
            disabled={testing}
            className="flex items-center gap-2 px-4 py-2 bg-gray-700 hover:bg-gray-600 text-white rounded transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <RefreshCw size={16} className={testing ? 'animate-spin' : ''} />
            Test Connection
          </button>

          <button
            onClick={handleSave}
            className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded transition-colors"
          >
            Save & Reload
          </button>

          {customUrl && (
            <button
              onClick={handleReset}
              className="px-4 py-2 bg-gray-700 hover:bg-gray-600 text-white rounded transition-colors"
            >
              Reset to Default
            </button>
          )}
        </div>

        {/* Help Text */}
        <div className="bg-gray-900/50 border border-gray-700 rounded p-3">
          <p className="text-xs text-gray-400 leading-relaxed">
            <strong className="text-gray-300">Embedded Backend:</strong> Default URL is {defaultApiUrl}
            <br />
            <strong className="text-gray-300">Remote Backend:</strong> Enter the full URL including <code className="bg-gray-800 px-1 rounded">/api</code> (e.g., http://192.168.1.100:4000/api)
          </p>
        </div>
      </div>
    </div>
  );
}
