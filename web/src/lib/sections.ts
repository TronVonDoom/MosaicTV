// The sections of the pages that have them — Settings and Studio — shared by
// each page's own section list and the sidebar's sub-items, so the two can't
// drift apart. A section is the page's #hash.

export const SETTINGS_SECTIONS = [
  { id: 'metadata', label: 'Metadata', icon: 'sparkles', description: 'TMDB & TheTVDB, matching' },
  { id: 'channels', label: 'Channels', icon: 'channels', description: 'Guide depth, audio, watermark' },
  { id: 'streaming', label: 'Streaming', icon: 'cast', description: 'Stream format, HDHomeRun tuner' },
  { id: 'encoding', label: 'Encoding', icon: 'cpu', description: 'ffmpeg profiles' },
  { id: 'maintenance', label: 'Maintenance', icon: 'database', description: 'About, backup, reset' },
] as const

export const STUDIO_SECTIONS = [
  { id: 'images', label: 'Logos', icon: 'image', description: 'Channel logos and their watermarks' },
  { id: 'audio', label: 'Music', icon: 'audio', description: 'Tracks idents play under breaks' },
  { id: 'clips', label: 'Clips', icon: 'clip', description: 'Videos for “your own clip” idents' },
] as const
