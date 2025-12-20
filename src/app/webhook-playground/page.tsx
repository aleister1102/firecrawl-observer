'use client'

import { useState, useEffect } from 'react'
import { Layout, MainContent, Footer } from '@/components/layout/layout'
import { Header } from '@/components/layout/header'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useRouter } from 'next/navigation'
import { useConvexAuth, useQuery, useMutation } from "convex/react"
import { api } from "../../../convex/_generated/api"
import { Loader2, ArrowLeft, Webhook, Copy, Check, Trash2, CheckCircle, XCircle, Clock, AlertCircle, HelpCircle, ExternalLink } from 'lucide-react'
import Link from 'next/link'

export default function WebhookPlaygroundPage() {
  const router = useRouter()
  const { isLoading: authLoading, isAuthenticated } = useConvexAuth()
  const [copied, setCopied] = useState(false)
  const [expandedPayload, setExpandedPayload] = useState<string | null>(null)
  const [previousCount, setPreviousCount] = useState(0)
  const [newWebhooks, setNewWebhooks] = useState<Set<string>>(new Set())
  
  // Convex queries and mutations
  const webhookPayloads = useQuery(api.webhookPlayground.getWebhookPayloads, { limit: 50 })
  const clearPayloads = useMutation(api.webhookPlayground.clearWebhookPayloads)
  
  // Track new webhooks
  useEffect(() => {
    if (webhookPayloads) {
      console.log('Webhook payloads updated:', webhookPayloads.length, 'items')
      if (webhookPayloads.length > previousCount && previousCount > 0) {
        // New webhooks arrived
        const newIds = new Set<string>()
        const numNew = webhookPayloads.length - previousCount
        for (let i = 0; i < numNew && i < webhookPayloads.length; i++) {
          newIds.add(webhookPayloads[i]._id)
        }
        setNewWebhooks(newIds)
        
        // Clear the highlight after 3 seconds
        setTimeout(() => {
          setNewWebhooks(new Set())
        }, 3000)
      }
      setPreviousCount(webhookPayloads.length)
    }
  }, [webhookPayloads, previousCount])
  
  // Redirect if not authenticated
  if (!authLoading && !isAuthenticated) {
    router.push('/')
    return null
  }
  
  // Show loading while auth is loading
  if (authLoading || webhookPayloads === undefined) {
    return (
      <Layout>
        <Header />
        <MainContent maxWidth="7xl" className="py-12">
          <div className="max-w-6xl mx-auto">
            <div className="flex items-center justify-center py-20">
              <div className="text-center">
                <Loader2 className="h-8 w-8 animate-spin text-orange-500 mx-auto mb-4" />
                <p className="text-gray-500">Loading webhook playground...</p>
              </div>
            </div>
          </div>
        </MainContent>
        <Footer />
      </Layout>
    )
  }

  const webhookUrl = typeof window !== 'undefined' 
    ? `${window.location.origin}/api/test-webhook`
    : 'Loading...'

  const copyWebhookUrl = async () => {
    if (!webhookUrl || webhookUrl === 'Loading...') return
    
    try {
      // Try modern clipboard API first
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(webhookUrl)
      } else {
        // Fallback for non-HTTPS contexts
        const textArea = document.createElement('textarea')
        textArea.value = webhookUrl
        textArea.style.position = 'fixed'
        textArea.style.left = '-999999px'
        textArea.style.top = '-999999px'
        document.body.appendChild(textArea)
        textArea.focus()
        textArea.select()
        document.execCommand('copy')
        document.body.removeChild(textArea)
      }
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch (err) {
      console.error('Failed to copy:', err)
      // Last resort: prompt user to copy manually
      window.prompt('Copy this URL:', webhookUrl)
    }
  }

  const formatTimeAgo = (timestamp: number) => {
    const seconds = Math.floor((Date.now() - timestamp) / 1000)
    
    if (seconds < 60) return 'Just now'
    if (seconds < 3600) return `${Math.floor(seconds / 60)} mins ago`
    if (seconds < 86400) return `${Math.floor(seconds / 3600)} hours ago`
    return `${Math.floor(seconds / 86400)} days ago`
  }

  const handleClearAll = async () => {
    if (confirm('Are you sure you want to clear all webhook payloads?')) {
      await clearPayloads()
    }
  }
  
  return (
    <Layout>
      <Header />
      
      <MainContent maxWidth="7xl" className="py-12">
        <div className="max-w-6xl mx-auto">
          <div className="flex items-center gap-4 mb-8">
            <Link href="/" className="p-2 hover:bg-gray-100 rounded-lg transition-colors">
              <ArrowLeft className="h-5 w-5" />
            </Link>
            <h1 className="text-3xl font-bold flex items-center gap-2">
              <Webhook className="h-8 w-8 text-orange-500" />
              Webhook Playground
            </h1>
          </div>
          
          {/* Webhook URL Section */}
          <div className="bg-white rounded-lg shadow-sm p-6 mb-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold">Test Webhook Endpoint</h2>
              <div className="relative group">
                <HelpCircle className="h-5 w-5 text-gray-400 cursor-help" />
                <div className="absolute right-0 mt-2 w-80 p-4 bg-gray-900 text-white text-sm rounded-lg shadow-lg opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all duration-200 z-10">
                  <div className="absolute -top-2 right-2 w-0 h-0 border-l-8 border-l-transparent border-r-8 border-r-transparent border-b-8 border-b-gray-900"></div>
                  <h4 className="font-medium mb-2">How to use the Webhook Playground</h4>
                  <ol className="space-y-1 list-decimal list-inside">
                    <li>Copy the webhook URL above</li>
                    <li>Go to your website settings and click the settings icon</li>
                    <li>Select &quot;Webhook only&quot; or &quot;Email and Webhook&quot; as the notification type</li>
                    <li>Paste the webhook URL and save</li>
                    <li>When changes are detected, webhooks will appear here in real-time</li>
                  </ol>
                </div>
              </div>
            </div>
            
            {webhookUrl.includes('localhost') && (
              <div className="mb-4 p-4 bg-orange-50 border border-orange-200 rounded-lg">
                <div className="flex items-start gap-3">
                  <AlertCircle className="h-5 w-5 text-orange-600 flex-shrink-0 mt-0.5" />
                  <div>
                    <p className="text-sm font-medium text-black">Localhost URLs won&apos;t work!</p>
                    <p className="text-sm text-black mt-1">
                      Convex runs in the cloud and cannot access localhost. Use one of these options:
                    </p>
                    <ul className="text-sm text-black mt-2 space-y-1 list-disc list-inside">
                      <li>Use <a href="https://ngrok.com" target="_blank" className="underline font-medium">ngrok</a> to expose your local server: <code className="bg-orange-100 px-1 rounded">ngrok http 3000</code></li>
                      <li>Deploy your app to Vercel, Netlify, or another hosting service</li>
                      <li>Use a webhook testing service like <a href="https://webhook.site" target="_blank" className="underline font-medium">webhook.site</a></li>
                    </ul>
                  </div>
                </div>
              </div>
            )}
            
            <div className="flex items-center gap-2">
              <Input
                value={webhookUrl}
                readOnly
                className="flex-1 font-mono text-sm"
              />
              <Button
                variant="orange"
                size="sm"
                onClick={copyWebhookUrl}
              >
                {copied ? (
                  <>
                    <Check className="h-4 w-4 mr-1" />
                    Copied!
                  </>
                ) : (
                  <>
                    <Copy className="h-4 w-4 mr-1" />
                    Copy URL
                  </>
                )}
              </Button>
            </div>
            <p className="text-sm text-gray-500 mt-2">
              Use this URL in your website notification settings to test webhook deliveries
            </p>
          </div>

          {/* Webhook Payloads List */}
          <div className="bg-white rounded-lg shadow-sm">
            <div className="px-6 py-4 border-b flex items-center justify-between">
              <h2 className="text-lg font-semibold flex items-center gap-2">
                Received Webhooks
                {webhookPayloads.length > 0 && (
                  <span className="text-sm font-normal text-gray-500">
                    ({webhookPayloads.length} total)
                  </span>
                )}
                <span className="flex items-center gap-1 text-xs text-orange-600">
                  <span className="w-2 h-2 bg-orange-500 rounded-full animate-pulse"></span>
                  Live
                </span>
              </h2>
              {webhookPayloads.length > 0 && (
                <Button
                  variant="code"
                  size="sm"
                  onClick={handleClearAll}
                >
                  <Trash2 className="h-4 w-4 mr-1" />
                  Clear All
                </Button>
              )}
            </div>

            {webhookPayloads.length === 0 ? (
              <div className="p-12 text-center">
                <Webhook className="h-12 w-12 text-gray-300 mx-auto mb-4" />
                <p className="text-gray-500">No webhooks received yet</p>
                <p className="text-sm text-gray-400 mt-2">
                  Configure a website to use the webhook URL above and trigger a change
                </p>
              </div>
            ) : (
              <div className="divide-y">
                {webhookPayloads.map((payload) => (
                  <div 
                    key={payload._id} 
                    className={`p-4 hover:bg-gray-50 transition-all ${
                      newWebhooks.has(payload._id) ? 'bg-orange-50 border-l-4 border-orange-500' : ''
                    }`}
                  >
                    <div className="flex items-start justify-between">
                      <div className="flex-1">
                        <div className="flex items-center justify-between mb-2">
                          <div className="flex items-center gap-3">
                            {payload.status === 'success' ? (
                              <CheckCircle className="h-5 w-5 text-black" />
                            ) : (
                              <XCircle className="h-5 w-5 text-orange-500" />
                            )}
                            <span className="font-medium">
                              {payload.payload?.event || 'Webhook Event'}
                            </span>
                            <span className="text-sm text-gray-500 flex items-center gap-1">
                              <Clock className="h-3 w-3" />
                              {formatTimeAgo(payload.receivedAt)}
                            </span>
                            {newWebhooks.has(payload._id) && (
                              <span className="text-xs bg-orange-500 text-white px-2 py-1 rounded-full">
                                New
                              </span>
                            )}
                          </div>
                          {/* Website URL on the right */}
                          {payload.payload?.website?.url && (
                            <a 
                              href={payload.payload.website.url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-sm text-black hover:text-gray-700 hover:underline flex items-center gap-1"
                            >
                              {payload.payload.website.url}
                              <ExternalLink className="h-3 w-3" />
                            </a>
                          )}
                        </div>

                        {/* JSON Payload */}
                        <div className="mt-2 mb-3">
                          <div className="bg-gray-900 text-gray-100 rounded-lg overflow-hidden">
                            <div className="flex items-center justify-between p-3 border-b border-gray-800">
                              <span className="text-xs font-medium">Payload</span>
                              <Button
                                variant="code"
                                size="sm"
                                className="h-6 px-2 text-xs"
                                onClick={() => setExpandedPayload(
                                  expandedPayload === payload._id ? null : payload._id
                                )}
                              >
                                {expandedPayload === payload._id ? 'Collapse' : 'Expand'}
                              </Button>
                            </div>
                            <div className="p-3">
                              <div className={expandedPayload === payload._id ? "overflow-y-auto max-h-96" : "overflow-hidden max-h-48"}>
                                <pre className="text-xs whitespace-pre-wrap break-all">
                                  <code>
                                    {expandedPayload === payload._id 
                                      ? JSON.stringify(payload.payload, null, 2)
                                      : JSON.stringify(payload.payload, null, 2)
                                          .split('\n')
                                          .slice(0, 12)
                                          .join('\n') + 
                                          (JSON.stringify(payload.payload, null, 2).split('\n').length > 12 ? '\n  ...' : '')
                                    }
                                  </code>
                                </pre>
                              </div>
                            </div>
                          </div>
                          
                          {/* Headers - only show when expanded */}
                          {expandedPayload === payload._id && payload.headers && (
                            <details className="mt-3">
                              <summary className="text-sm text-gray-600 cursor-pointer hover:text-gray-800">
                                Request Headers
                              </summary>
                              <div className="mt-2 bg-gray-100 rounded-lg p-3 overflow-hidden">
                                <div className="overflow-y-auto max-h-48 scrollbar-thin scrollbar-thumb-gray-400 scrollbar-track-gray-200">
                                  <pre className="text-xs text-gray-700 whitespace-pre-wrap break-all">
                                    <code>{JSON.stringify(payload.headers, null, 2)}</code>
                                  </pre>
                                </div>
                              </div>
                            </details>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

        </div>
      </MainContent>
      
      <Footer />
    </Layout>
  )
}