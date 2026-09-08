/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from 'react';
import { Loader2, Download, Search, CheckCircle } from 'lucide-react';

export default function App() {
  const [idea, setIdea] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<any>(null);
  const [error, setError] = useState('');
  const [downloading, setDownloading] = useState(false);

  const handleGenerate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!idea.trim()) return;

    setLoading(true);
    setError('');
    setResult(null);

    try {
      const response = await fetch('/api/generate', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ idea }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to generate');
      }

      const data = await response.json();
      setResult(data);
    } catch (err: any) {
      setError(err.message || 'An unexpected error occurred');
    } finally {
      setLoading(false);
    }
  };

  const handleDownload = async () => {
    if (!result) return;
    setDownloading(true);
    
    try {
      const response = await fetch('/api/export-zip', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(result),
      });

      if (!response.ok) {
        throw new Error('Failed to download ZIP');
      }

      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${result.app_name.toLowerCase().replace(/\\s+/g, '-')}-pwa.zip`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
    } catch (err: any) {
      setError(err.message || 'Failed to download ZIP');
    } finally {
      setDownloading(false);
    }
  };

  return (
    <div className="min-h-screen bg-neutral-50 text-neutral-900 p-8">
      <div className="max-w-4xl mx-auto space-y-8">
        <header className="space-y-2">
          <h1 className="text-4xl font-bold tracking-tight text-neutral-900">App Architect</h1>
          <p className="text-lg text-neutral-600">
            Describe an app idea or a competitor, and we'll research the market, analyze reviews, and generate a complete PWA configuration.
          </p>
        </header>

        <form onSubmit={handleGenerate} className="bg-white p-6 rounded-2xl shadow-sm border border-neutral-200">
          <div className="flex gap-4">
            <input
              type="text"
              value={idea}
              onChange={(e) => setIdea(e.target.value)}
              placeholder="e.g., A habit tracker for people with ADHD..."
              className="flex-1 px-4 py-3 rounded-xl border border-neutral-300 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent text-lg"
              disabled={loading}
            />
            <button
              type="submit"
              disabled={loading || !idea.trim()}
              className="px-6 py-3 bg-blue-600 text-white rounded-xl font-medium hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2 transition-colors"
            >
              {loading ? (
                <>
                  <Loader2 className="w-5 h-5 animate-spin" />
                  Researching...
                </>
              ) : (
                <>
                  <Search className="w-5 h-5" />
                  Generate
                </>
              )}
            </button>
          </div>
        </form>

        {error && (
          <div className="bg-red-50 text-red-700 p-4 rounded-xl border border-red-200">
            {error}
          </div>
        )}

        {result && (
          <div className="bg-white rounded-2xl shadow-sm border border-neutral-200 overflow-hidden animate-in fade-in slide-in-from-bottom-4 duration-500">
            <div className="p-6 border-b border-neutral-200 flex justify-between items-start">
              <div>
                <h2 className="text-2xl font-bold">{result.app_name}</h2>
                <p className="text-neutral-500 mt-1">{result.pwa_app_config.tagline}</p>
              </div>
              <button
                onClick={handleDownload}
                disabled={downloading}
                className="px-4 py-2 bg-neutral-900 text-white rounded-lg font-medium hover:bg-neutral-800 focus:outline-none focus:ring-2 focus:ring-neutral-900 focus:ring-offset-2 disabled:opacity-50 flex items-center gap-2 transition-colors"
              >
                {downloading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
                Download PWA ZIP
              </button>
            </div>
            
            <div className="p-6 grid md:grid-cols-2 gap-8">
              <div className="space-y-6">
                <div>
                  <h3 className="text-lg font-semibold mb-3 flex items-center gap-2">
                    <span className="w-8 h-8 rounded-full bg-red-100 text-red-600 flex items-center justify-center text-sm">!</span>
                    Core Pain Points
                  </h3>
                  <ul className="space-y-2">
                    {result.core_pain_points.map((point: string, i: number) => (
                      <li key={i} className="flex gap-3 text-neutral-700">
                        <span className="text-red-500 mt-1">•</span>
                        {point}
                      </li>
                    ))}
                  </ul>
                </div>
                
                <div>
                  <h3 className="text-lg font-semibold mb-3 flex items-center gap-2">
                    <span className="w-8 h-8 rounded-full bg-green-100 text-green-600 flex items-center justify-center text-sm">✓</span>
                    Key Differentiators
                  </h3>
                  <div className="space-y-4">
                    {result.key_differentiators.map((diff: any, i: number) => (
                      <div key={i} className="bg-neutral-50 p-4 rounded-xl border border-neutral-100">
                        <h4 className="font-medium text-neutral-900">{diff.feature}</h4>
                        <p className="text-sm text-neutral-600 mt-1"><span className="font-medium">Solution:</span> {diff.solution}</p>
                        <p className="text-sm text-green-700 mt-1"><span className="font-medium">Value Add:</span> {diff.value_add}</p>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
              
              <div className="space-y-6">
                <div>
                  <h3 className="text-lg font-semibold mb-3">PWA Configuration</h3>
                  <div className="bg-neutral-900 text-neutral-100 p-4 rounded-xl font-mono text-sm overflow-x-auto">
                    <pre>{JSON.stringify(result.pwa_app_config, null, 2)}</pre>
                  </div>
                </div>
                
                <div className="flex items-center gap-3 p-4 bg-blue-50 text-blue-800 rounded-xl border border-blue-100">
                  <CheckCircle className="w-5 h-5 flex-shrink-0" />
                  <p className="text-sm">
                    This configuration is ready to be exported. Click "Download PWA ZIP" to get a static web app that can be deployed to Cloudflare Pages, Vercel, or any static host.
                  </p>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

