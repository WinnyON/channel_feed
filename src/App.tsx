import { useState, useEffect, useCallback, useRef } from 'react'
import './App.css'
import { Search, Plus, X, Settings, Play, MessageSquare, Clock, Film, Youtube, Minimize2, Maximize2, ChevronDown, Check, Eye, EyeOff } from 'lucide-react'

// YouTube API configuration - replace with your own API key
const YOUTUBE_API_KEY = import.meta.env.VITE_YOUTUBE_API_KEY || ''

interface Channel {
  id: string
  name: string
  thumbnail: string
  uploadsPlaylistId?: string
  contentTypes: {
    longForm: boolean
    shorts: boolean
    community: boolean
  }
}

interface Video {
  id: string
  title: string
  thumbnail: string
  channelName: string
  channelId: string
  publishedAt: string
  viewCount: string
  duration: string
  type: 'longForm' | 'shorts' | 'community'
}

interface CommunityPost {
  id: string
  content: string
  thumbnail: string
  channelName: string
  channelId: string
  publishedAt: string
  type: 'community'
}

type ContentType = 'longForm' | 'shorts' | 'community'

interface FetchSettings {
  maxVideosPerChannel: number
  timeRangeDays: number
}

const TIME_RANGE_OPTIONS = [
  { value: 1, label: 'Last 24 hours' },
  { value: 7, label: 'Last 7 days' },
  { value: 30, label: 'Last 30 days' },
  { value: 90, label: 'Last 3 months' },
  { value: 365, label: 'Last year' },
  { value: 0, label: 'All time' }
]

const MAX_VIDEOS_OPTIONS = [
  { value: 5, label: '5 videos' },
  { value: 10, label: '10 videos' },
  { value: 20, label: '20 videos' },
  { value: 50, label: '50 videos' },
  { value: 100, label: '100 videos' }
]

function App() {
  const [channels, setChannels] = useState<Channel[]>(() => {
    const saved = localStorage.getItem('curatedChannels')
    return saved ? JSON.parse(saved) : []
  })
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState<any[]>([])
  const [isSearching, setIsSearching] = useState(false)
  const [selectedChannel, setSelectedChannel] = useState<string | null>(null)
  // Load cached videos from localStorage on initial render
  const [videos, setVideos] = useState<(Video | CommunityPost)[]>(() => {
    const saved = localStorage.getItem('cachedVideos')
    if (saved) {
      const data = JSON.parse(saved)
      // Check if cache is from the last 24 hours
      const oneDayAgo = Date.now() - 24 * 60 * 60 * 1000
      if (data.timestamp > oneDayAgo) {
        return data.videos
      }
    }
    return []
  })
  const [isLoadingVideos, setIsLoadingVideos] = useState(false)
  const [expandedSettings, setExpandedSettings] = useState<string | null>(null)
  const [apiKey, setApiKey] = useState(() => localStorage.getItem('youtubeApiKey') || '')
  const [apiKeyApplied, setApiKeyApplied] = useState(false)
  const [showSettingsDropdown, setShowSettingsDropdown] = useState(false)
  const [playingVideo, setPlayingVideo] = useState<Video | null>(null)
  const [isPlayerExpanded, setIsPlayerExpanded] = useState(false)
  const [fetchSettings, setFetchSettings] = useState<FetchSettings>(() => {
    const saved = localStorage.getItem('fetchSettings')
    return saved ? JSON.parse(saved) : { maxVideosPerChannel: 10, timeRangeDays: 30 }
  })

  const getSnippetThumbnail = (snippet: any) => {
    const thumbnails = snippet?.thumbnails
    return thumbnails?.high?.url || thumbnails?.medium?.url || thumbnails?.default?.url || ''
  }

  const buildVideoKey = (item: Video | CommunityPost) => {
    return `${item.type}-${item.channelId}-${item.id}`
  }

  // Track watched videos
  const [watchedVideos, setWatchedVideos] = useState<Set<string>>(() => {
    const saved = localStorage.getItem('watchedVideos')
    return saved ? new Set(JSON.parse(saved)) : new Set()
  })

  const settingsRef = useRef<HTMLDivElement>(null)
  const searchTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const apiKeyInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (settingsRef.current && !settingsRef.current.contains(event.target as Node)) {
        setShowSettingsDropdown(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  useEffect(() => {
    localStorage.setItem('curatedChannels', JSON.stringify(channels))
  }, [channels])

  useEffect(() => {
    localStorage.setItem('youtubeApiKey', apiKey)
  }, [apiKey])

  useEffect(() => {
    localStorage.setItem('fetchSettings', JSON.stringify(fetchSettings))
  }, [fetchSettings])

  useEffect(() => {
    localStorage.setItem('watchedVideos', JSON.stringify([...watchedVideos]))
  }, [watchedVideos])

  // Cache videos to localStorage with timestamp
  useEffect(() => {
    if (videos.length > 0) {
      localStorage.setItem('cachedVideos', JSON.stringify({
        videos,
        timestamp: Date.now()
      }))
    }
  }, [videos])

  const toggleWatchedVideo = (videoId: string, event: React.MouseEvent) => {
    event.stopPropagation()
    setWatchedVideos(prev => {
      const newSet = new Set(prev)
      if (newSet.has(videoId)) {
        newSet.delete(videoId)
      } else {
        newSet.add(videoId)
      }
      return newSet
    })
  }

  const handleApiKeyChange = (value: string) => {
    setApiKey(value)
    setApiKeyApplied(false)
  }

  const applyApiKey = () => {
    localStorage.setItem('youtubeApiKey', apiKey)
    setApiKeyApplied(true)
  }

  // Open settings and focus API key input when needed
  const requestApiKey = () => {
    setShowSettingsDropdown(true)
    // Focus the API key input after a small delay to ensure dropdown is rendered
    setTimeout(() => {
      apiKeyInputRef.current?.focus()
    }, 50)
  }

  const fetchChannelVideos = useCallback(async (channel: Channel) => {
    if (!apiKey) {
      requestApiKey()
      return []
    }

    const channelVideos: (Video | CommunityPost)[] = []
    const maxResults = fetchSettings.maxVideosPerChannel
    const cutoffDate = new Date()
    cutoffDate.setDate(cutoffDate.getDate() - fetchSettings.timeRangeDays)

    // Use cached uploadsPlaylistId or fetch if missing
    let uploadsPlaylistId = channel.uploadsPlaylistId
    if (!uploadsPlaylistId) {
      // One-time fetch if not cached (happens for legacy channels)
      const channelResponse = await fetch(
        `https://www.googleapis.com/youtube/v3/channels?part=contentDetails&id=${channel.id}&key=${apiKey}`
      )
      const channelData = await channelResponse.json()
      uploadsPlaylistId = channelData.items?.[0]?.contentDetails?.relatedPlaylists?.uploads

      // Cache it for future refreshes
      if (uploadsPlaylistId) {
        setChannels(prev => prev.map(c =>
          c.id === channel.id ? { ...c, uploadsPlaylistId } : c
        ))
      }
    }

    if (uploadsPlaylistId && (channel.contentTypes.longForm || channel.contentTypes.shorts)) {
      // Fetch from uploads playlist using playlistItems (1 unit - much cheaper than search!)
      const playlistResponse = await fetch(
        `https://www.googleapis.com/youtube/v3/playlistItems?part=snippet&playlistId=${uploadsPlaylistId}&maxResults=${maxResults * 2}&key=${apiKey}`
      )
      const playlistData = await playlistResponse.json()

      if (playlistData.items && playlistData.items.length > 0) {
        // Collect video IDs for batch duration check (up to 50 per request = 1 unit)
        const videoIds = playlistData.items
          .map((item: any) => item.snippet?.resourceId?.videoId)
          .filter(Boolean)

        // Batch fetch video durations (1 unit for up to 50 videos!)
        let videoDurations: Record<string, string> = {}
        if (videoIds.length > 0) {
          const batchSize = 50
          for (let i = 0; i < videoIds.length; i += batchSize) {
            const batchIds = videoIds.slice(i, i + batchSize).join(',')
            const videoResponse = await fetch(
              `https://www.googleapis.com/youtube/v3/videos?part=contentDetails&id=${batchIds}&key=${apiKey}`
            )
            const videoData = await videoResponse.json()
            if (videoData.items) {
              for (const video of videoData.items) {
                videoDurations[video.id] = video.contentDetails.duration
              }
            }
          }
        }

        for (const item of playlistData.items) {
          const snippet = item.snippet
          const publishedAt = new Date(snippet.publishedAt)

          // Filter by time range
          if (fetchSettings.timeRangeDays !== 0 && publishedAt < cutoffDate) {
            continue
          }

          const videoId = snippet.resourceId?.videoId
          let duration = 'Video'
          let type: 'longForm' | 'shorts' = 'longForm'

          if (videoId) {
            const durationStr = videoDurations[videoId]
            if (durationStr) {
              // Parse ISO 8601 duration (e.g., PT60S = 60 seconds = Short)
              const match = durationStr.match(/PT(?:(\d+)M)?(?:(\d+)S)?/)
              const minutes = parseInt(match?.[1] || '0')
              const seconds = parseInt(match?.[2] || '0')
              const totalSeconds = minutes * 60 + seconds

              if (totalSeconds <= 60) {
                duration = 'Short'
                type = 'shorts'
              }
            }
          }

          // Only add based on content type preference
          if ((type === 'longForm' && channel.contentTypes.longForm) ||
              (type === 'shorts' && channel.contentTypes.shorts)) {
            channelVideos.push({
              id: videoId || '',
              title: snippet.title,
              thumbnail: snippet.thumbnails?.medium?.url || '',
              channelName: channel.name,
              channelId: channel.id,
              publishedAt: snippet.publishedAt,
              viewCount: '',
              duration: duration,
              type: type
            })
          }
        }
      }
    }

    if (channel.contentTypes.community) {
      const communityResponse = await fetch(
        `https://www.googleapis.com/youtube/v3/activities?part=snippet&channelId=${channel.id}&maxResults=${maxResults}&key=${apiKey}`
      )
      const communityData = await communityResponse.json()
      if (communityData.items) {
        for (const item of communityData.items) {
          if (item.snippet.type === 'community') {
            const itemDate = new Date(item.snippet.publishedAt)

            if (fetchSettings.timeRangeDays === 0 || itemDate >= cutoffDate) {
              channelVideos.push({
                id: item.snippet.description?.substring(0, 50) || item.id,
                content: item.snippet.description || 'Community post',
                thumbnail: item.snippet.thumbnails?.medium?.url || '',
                channelName: channel.name,
                channelId: channel.id,
                publishedAt: item.snippet.publishedAt,
                type: 'community'
              })
            }
          }
        }
      }
    }

    return channelVideos
  }, [apiKey, fetchSettings, requestApiKey, setChannels])

  const searchChannels = async (query: string) => {
    if (!query.trim()) {
      setSearchResults([])
      return
    }
    if (!apiKey) {
      requestApiKey()
      return
    }

    setIsSearching(true)
    try {
      const response = await fetch(
        `https://www.googleapis.com/youtube/v3/search?part=snippet&q=${encodeURIComponent(query)}&type=channel&maxResults=10&key=${apiKey}`
      )
      const data = await response.json()
      if (data.items) {
        setSearchResults(data.items)
      }
    } catch (error) {
      console.error('Error searching channels:', error)
    } finally {
      setIsSearching(false)
    }
  }

  const addChannel = async (channel: any) => {
    const channelId = channel.id.channelId

    // Fetch uploads playlist ID now (costs 1 unit, but saves units on every refresh)
    let uploadsPlaylistId = ''
    try {
      const response = await fetch(
        `https://www.googleapis.com/youtube/v3/channels?part=contentDetails&id=${channelId}&key=${apiKey}`
      )
      const data = await response.json()
      uploadsPlaylistId = data.items?.[0]?.contentDetails?.relatedPlaylists?.uploads || ''
    } catch (error) {
      console.error('Error fetching channel details:', error)
    }

    const newChannel: Channel = {
      id: channelId,
      name: channel.snippet.title,
      thumbnail: getSnippetThumbnail(channel.snippet),
      uploadsPlaylistId,
      contentTypes: {
        longForm: true,
        shorts: true,
        community: false
      }
    }
    const alreadyAdded = channels.find(c => c.id === newChannel.id)
    if (!alreadyAdded) {
      setChannels(prev => [...prev, newChannel])
      try {
        const newVideos = await fetchChannelVideos(newChannel)
        if (newVideos.length > 0) {
          setVideos(prev => {
            const nextMap = new Map(prev.map(item => [buildVideoKey(item), item]))
            for (const item of newVideos) {
              nextMap.set(buildVideoKey(item), item)
            }
            return Array.from(nextMap.values())
              .sort((a, b) => new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime())
          })
        }
      } catch (error) {
        console.error(`Error fetching content for channel ${newChannel.name}:`, error)
      }
    }
    setSearchResults([])
    setSearchQuery('')
  }

  const removeChannel = (channelId: string) => {
    setChannels(channels.filter(c => c.id !== channelId))
    if (selectedChannel === channelId) {
      setSelectedChannel(null)
    }
  }

  const updateContentType = (channelId: string, contentType: ContentType, enabled: boolean) => {
    setChannels(channels.map(c => {
      if (c.id === channelId) {
        return {
          ...c,
          contentTypes: {
            ...c.contentTypes,
            [contentType]: enabled
          }
        }
      }
      return c
    }))
  }

  const getTimeRangeFilter = () => {
    if (fetchSettings.timeRangeDays === 0) return ''
    const date = new Date()
    date.setDate(date.getDate() - fetchSettings.timeRangeDays)
    return `&publishedAfter=${date.toISOString()}`
  }

  const fetchVideos = useCallback(async () => {
    if (channels.length === 0) return
    if (!apiKey) {
      requestApiKey()
      return
    }
    setIsLoadingVideos(true)
    const allVideos: (Video | CommunityPost)[] = []

    for (const channel of channels) {
      try {
        const channelItems = await fetchChannelVideos(channel)
        allVideos.push(...channelItems)
      } catch (error) {
        console.error(`Error fetching content for channel ${channel.name}:`, error)
      }
    }

    allVideos.sort((a, b) => new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime())
    setVideos(allVideos)
    setIsLoadingVideos(false)
  }, [apiKey, channels, fetchChannelVideos, requestApiKey])

  const formatDate = (dateString: string) => {
    const date = new Date(dateString)
    const now = new Date()
    const diffTime = Math.abs(now.getTime() - date.getTime())
    const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24))
    const diffHours = Math.floor(diffTime / (1000 * 60 * 60))
    const diffMinutes = Math.floor(diffTime / (1000 * 60))

    if (diffMinutes < 60) return `${diffMinutes}m ago`
    if (diffHours < 24) return `${diffHours}h ago`
    if (diffDays < 30) return `${diffDays}d ago`
    return date.toLocaleDateString()
  }

  const getContentTypeIcon = (type: ContentType) => {
    switch (type) {
      case 'longForm': return <Film size={14} />
      case 'shorts': return <Play size={14} />
      case 'community': return <MessageSquare size={14} />
    }
  }

  const getVideosByChannel = () => {
    const grouped: { channel: Channel; videos: (Video | CommunityPost)[] }[] = []
    for (const channel of channels) {
      const channelVideos = videos.filter(v => v.channelId === channel.id)
      if (channelVideos.length > 0) {
        grouped.push({ channel, videos: channelVideos })
      }
    }
    return grouped
  }

  const handleVideoClick = (video: Video | CommunityPost) => {
    if (video.type !== 'community') {
      setPlayingVideo(video as Video)
      setIsPlayerExpanded(false)
    }
  }

  const closePlayer = () => {
    setPlayingVideo(null)
  }

  const togglePlayerExpand = () => {
    setIsPlayerExpanded(!isPlayerExpanded)
  }

  const groupedVideos = getVideosByChannel()

  return (
    <div className="app">
      {/* Header */}
      <header className="header">
        <div className="logo">
          <Youtube size={28} color="#ff0000" />
          <h1>Channel Feed</h1>
        </div>
        <div className="header-actions" ref={settingsRef}>
          <a className="howto-btn" href="/readme.html">
            How to use
          </a>
          <div className="settings-wrapper">
            <button
              className={`settings-dropdown-btn ${showSettingsDropdown ? 'active' : ''}`}
              onClick={() => setShowSettingsDropdown(!showSettingsDropdown)}
            >
              <Settings size={18} />
              <span>Settings</span>
              <ChevronDown size={14} className={showSettingsDropdown ? 'rotated' : ''} />
            </button>

            {/* Settings Dropdown */}
            {showSettingsDropdown && (
              <div className="settings-dropdown-menu">
                <div className="settings-section">
                  <label>YouTube Data API Key</label>
                  {!apiKey && (
                    <p className="settings-warning">API key is required to search channels and fetch videos</p>
                  )}
                  <input
                    ref={apiKeyInputRef}
                    type="text"
                    value={apiKey}
                    onChange={(e) => handleApiKeyChange(e.target.value)}
                    placeholder="Enter your API key"
                  />
                  <button className={`apply-api-key-btn ${apiKeyApplied ? 'applied' : ''}`} onClick={applyApiKey}>
                    {apiKeyApplied ? '✓ Applied' : 'Apply'}
                  </button>
                  <p className="settings-help">
                    Get a key from <a href="https://console.cloud.google.com/" target="_blank" rel="noopener noreferrer">Google Cloud Console</a>
                  </p>
                </div>
                <div className="settings-divider"></div>
                <div className="settings-section">
                  <label>Max videos per channel</label>
                  <select
                    value={fetchSettings.maxVideosPerChannel}
                    onChange={(e) => setFetchSettings(prev => ({ ...prev, maxVideosPerChannel: parseInt(e.target.value) }))}
                  >
                    {MAX_VIDEOS_OPTIONS.map(opt => (
                      <option key={opt.value} value={opt.value}>{opt.label}</option>
                    ))}
                  </select>
                </div>
                <div className="settings-section">
                  <label>Time range</label>
                  <select
                    value={fetchSettings.timeRangeDays}
                    onChange={(e) => setFetchSettings(prev => ({ ...prev, timeRangeDays: parseInt(e.target.value) }))}
                  >
                    {TIME_RANGE_OPTIONS.map(opt => (
                      <option key={opt.value} value={opt.value}>{opt.label}</option>
                    ))}
                  </select>
                </div>
              </div>
            )}
          </div>

          <button
            className="refresh-btn"
            onClick={fetchVideos}
            disabled={isLoadingVideos}
          >
            <Clock size={18} className={isLoadingVideos ? 'spinning' : ''} />
            {isLoadingVideos ? 'Loading...' : 'Refresh'}
          </button>
        </div>
      </header>

      <main className="main-content">
        {/* Sidebar - Channel Management */}
        <aside className="sidebar">
          <div className="search-section">
            <h3>Add Channels</h3>
            <div className="search-box">
              <Search size={18} />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => {
                  setSearchQuery(e.target.value)
                  // Debounce search to avoid quota exhaustion
                  if (searchTimeoutRef.current) {
                    clearTimeout(searchTimeoutRef.current)
                  }
                  searchTimeoutRef.current = setTimeout(() => {
                    searchChannels(e.target.value)
                  }, 500)
                }}
                placeholder="Search channels..."
              />
            </div>
            {searchResults.length > 0 && (
              <div className="search-results">
                {searchResults.map((result) => (
                  <div key={result.id.channelId} className="search-result-item">
                    <img
                      src={getSnippetThumbnail(result.snippet)}
                      alt={result.snippet.title}
                      loading="lazy"
                      referrerPolicy="no-referrer"
                    />
                    <span>{result.snippet.title}</span>
                    <button onClick={() => addChannel(result)} title="Add channel">
                      <Plus size={16} />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="channels-section">
            <h3>Your Channels ({channels.length})</h3>
            <div className="channels-list">
              {channels.length === 0 ? (
                <p className="empty-message">No channels added yet. Search and add channels above.</p>
              ) : (
                channels.map((channel) => (
                  <div key={channel.id} className="channel-item-wrapper">
                    <div
                      className={`channel-item ${selectedChannel === channel.id ? 'selected' : ''}`}
                    >
                      <img src={channel.thumbnail} alt={channel.name} />
                      <div className="channel-info">
                        <span className="channel-name">{channel.name}</span>
                        <div className="content-types">
                          {channel.contentTypes.longForm && <span className="type-badge video">Video</span>}
                          {channel.contentTypes.shorts && <span className="type-badge shorts">Shorts</span>}
                          {channel.contentTypes.community && <span className="type-badge community">Posts</span>}
                        </div>
                      </div>
                      <div className="channel-actions">
                        <button
                          className={`action-btn settings-btn ${expandedSettings === channel.id ? 'active' : ''}`}
                          onClick={() => setExpandedSettings(expandedSettings === channel.id ? null : channel.id)}
                          title="Content settings"
                        >
                          <Settings size={16} />
                        </button>
                        <button
                          className="action-btn remove-btn"
                          onClick={() => removeChannel(channel.id)}
                          title="Remove channel"
                        >
                          <X size={16} />
                        </button>
                      </div>
                    </div>

                    {/* Content Type Settings Dropdown */}
                    {expandedSettings === channel.id && (
                      <div className="settings-dropdown">
                        <div className="settings-dropdown-header">Content Types</div>
                        <label className="settings-option">
                          <input
                            type="checkbox"
                            checked={channel.contentTypes.longForm}
                            onChange={(e) => updateContentType(channel.id, 'longForm', e.target.checked)}
                          />
                          <Film size={16} />
                          <span>Long Videos</span>
                        </label>
                        <label className="settings-option">
                          <input
                            type="checkbox"
                            checked={channel.contentTypes.shorts}
                            onChange={(e) => updateContentType(channel.id, 'shorts', e.target.checked)}
                          />
                          <Play size={16} />
                          <span>Shorts</span>
                        </label>
                        <label className="settings-option">
                          <input
                            type="checkbox"
                            checked={channel.contentTypes.community}
                            onChange={(e) => updateContentType(channel.id, 'community', e.target.checked)}
                          />
                          <MessageSquare size={16} />
                          <span>Community Posts</span>
                        </label>
                      </div>
                    )}
                  </div>
                ))
              )}
            </div>
          </div>
        </aside>

        {/* Main Feed */}
        <section className="feed-section">
          <div className="feed-header">
            <h2>Your Feed</h2>
            <span className="video-count">{videos.length} items</span>
          </div>

          {isLoadingVideos ? (
            <div className="loading">
              <div className="spinner"></div>
              <p>Loading videos...</p>
            </div>
          ) : videos.length === 0 ? (
            <div className="empty-feed">
              <Youtube size={48} />
              <h3>No videos yet</h3>
              <p>Add some channels and click "Refresh" to see their latest content.</p>
            </div>
          ) : (
            <div className="channel-groups">
              {groupedVideos.map(({ channel, videos: channelVideos }) => (
                <div key={channel.id} className="channel-group">
                  <div className="channel-group-header">
                    <img src={channel.thumbnail} alt={channel.name} />
                    <span>{channel.name}</span>
                    <span className="video-count">({channelVideos.length} items)</span>
                  </div>
                  <div className="video-grid">
                    {channelVideos.map((video) => (
                      <div key={video.id} className={`video-card ${watchedVideos.has(video.id) ? 'watched' : ''}`}>
                        {video.type === 'community' ? (
                          <div className="community-card">
                            <div className="community-header">
                              <img
                                src={channel.thumbnail}
                                alt={video.channelName}
                              />
                              <span>{video.channelName}</span>
                            </div>
                            <p className="community-content">{(video as CommunityPost).content}</p>
                            {(video as CommunityPost).thumbnail && (
                              <img src={(video as CommunityPost).thumbnail} alt="Community post media" className="community-media" />
                            )}
                            <div className="video-footer">
                              <span className="timestamp">{formatDate(video.publishedAt)}</span>
                              <button
                                className={`watched-toggle ${watchedVideos.has(video.id) ? 'watched' : ''}`}
                                onClick={(e) => toggleWatchedVideo(video.id, e)}
                                title={watchedVideos.has(video.id) ? 'Mark as unwatched' : 'Mark as watched'}
                              >
                                <Check size={14} />
                              </button>
                            </div>
                          </div>
                        ) : (
                          <>
                            <div
                              className="video-clickable"
                              onClick={() => handleVideoClick(video)}
                            >
                              <div className="thumbnail-wrapper">
                                <img src={video.thumbnail} alt={video.title} />
                                <span className="duration-badge">{video.duration}</span>
                                {watchedVideos.has(video.id) && (
                                  <div className="watched-badge">Watched</div>
                                )}
                                <div className="play-overlay">
                                  <Play size={40} />
                                </div>
                              </div>
                              <div className="video-info">
                                <span className="type-indicator">
                                  {getContentTypeIcon(video.type)}
                                  {video.type === 'shorts' ? 'Short' : 'Video'}
                                </span>
                                <h3 className="video-title">{video.title}</h3>
                                <span className="timestamp">{formatDate(video.publishedAt)}</span>
                              </div>
                            </div>
                            <button
                              className={`watched-toggle corner-toggle ${watchedVideos.has(video.id) ? 'watched' : ''}`}
                              onClick={(e) => toggleWatchedVideo(video.id, e)}
                              title={watchedVideos.has(video.id) ? 'Mark as unwatched' : 'Mark as watched'}
                            >
                              {watchedVideos.has(video.id) ? <Check size={16} /> : <div className="empty-check" />}
                            </button>
                          </>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      </main>

      {/* Embedded Video Player Modal */}
      {playingVideo && (
        <div className={`player-modal ${isPlayerExpanded ? 'expanded' : ''}`}>
          <div className="player-header">
            <div className="player-title">
              <span className="now-playing">Now Playing</span>
              <h3>{playingVideo.title}</h3>
            </div>
            <div className="player-controls">
              <button onClick={togglePlayerExpand} title={isPlayerExpanded ? 'Minimize' : 'Expand'}>
                {isPlayerExpanded ? <Minimize2 size={18} /> : <Maximize2 size={18} />}
              </button>
              <button onClick={closePlayer} className="close-btn" title="Close">
                <X size={18} />
              </button>
            </div>
          </div>
          <div className="player-content">
            <iframe
              src={`https://www.youtube.com/embed/${playingVideo.id}?autoplay=1`}
              title={playingVideo.title}
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
              allowFullScreen
              className="youtube-embed"
            />
          </div>
          <div className="player-info">
            <a
              href={`https://www.youtube.com/watch?v=${playingVideo.id}`}
              target="_blank"
              rel="noopener noreferrer"
              className="open-youtube-btn"
            >
              Open in YouTube
            </a>
          </div>
        </div>
      )}
    </div>
  )
}

export default App
