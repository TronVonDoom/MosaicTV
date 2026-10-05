import { lazy, Suspense, useEffect } from 'react'
import { Routes, Route, Navigate, useLocation } from 'react-router-dom'
import Layout from './components/Layout'

// Each page is a script of its own, so the first screen waits on its own code
// rather than on every page's (the app was one 750 KB script). The others are
// fetched in the background once it's up — kept by the browser for good, as
// every built file is — so going to one doesn't wait on the network either.
const pages = {
  Dashboard: () => import('./pages/Dashboard'),
  Library: () => import('./pages/Library'),
  LibraryView: () => import('./pages/LibraryView'),
  ShowView: () => import('./pages/ShowView'),
  ArtistView: () => import('./pages/ArtistView'),
  MovieView: () => import('./pages/MovieView'),
  Settings: () => import('./pages/Settings'),
  Channels: () => import('./pages/Channels'),
  ChannelEditor: () => import('./pages/ChannelEditor'),
  Studio: () => import('./pages/Studio'),
  Logs: () => import('./pages/Logs'),
}
const Dashboard = lazy(pages.Dashboard)
const Library = lazy(pages.Library)
const LibraryView = lazy(pages.LibraryView)
const ShowView = lazy(pages.ShowView)
const ArtistView = lazy(pages.ArtistView)
const MovieView = lazy(pages.MovieView)
const Settings = lazy(pages.Settings)
const Channels = lazy(pages.Channels)
const ChannelEditor = lazy(pages.ChannelEditor)
const Studio = lazy(pages.Studio)
const Logs = lazy(pages.Logs)

// TV mode carries the video player (hls.js), so it loads only when opened,
// never in the background.
const Watch = lazy(() => import('./pages/Watch'))

function preloadPages(): () => void {
  const start = () => {
    for (const load of Object.values(pages)) load().catch(() => {}) // a miss loads again when opened
  }
  if ('requestIdleCallback' in window) {
    const id = window.requestIdleCallback(start, { timeout: 2000 })
    return () => window.cancelIdleCallback(id)
  }
  const id = setTimeout(start, 1000)
  return () => clearTimeout(id)
}

/**
 * Rewrite the leading segment of the current path and redirect there, keeping
 * everything after it (ids, sub-paths, hash) intact — so /browse/3/show/Foo
 * lands on /library/3/show/Foo rather than dumping the user at the top.
 */
function LegacyRedirect({ from, to }: { from: string; to: string }) {
  const { pathname, search, hash } = useLocation()
  return <Navigate to={pathname.replace(from, to) + search + hash} replace />
}

export default function App() {
  useEffect(preloadPages, [])
  return (
    <Routes>
      {/* TV mode is the whole screen: no sidebar, no top bar. */}
      <Route
        path="watch/:number?"
        element={
          <Suspense fallback={<div className="fixed inset-0 bg-black" />}>
            <Watch />
          </Suspense>
        }
      />
      <Route element={<Layout />}>
        <Route index element={<Dashboard />} />
        {/* The TV Guide became a section of the Channels page. */}
        <Route path="guide" element={<Navigate to="/channels#guide" replace />} />

        <Route path="channels" element={<Channels />} />
        <Route path="channels/:slug" element={<ChannelEditor />} />

        <Route path="library" element={<Library />} />
        {/* A movie's, show's or artist's page opens over its library's grid. */}
        <Route path="library/:libraryId" element={<LibraryView />}>
          <Route path="movie/:movieId" element={<MovieView />} />
          <Route path="show/:show" element={<ShowView />} />
          <Route path="artist/:artist" element={<ArtistView />} />
        </Route>

        <Route path="studio" element={<Studio />} />
        <Route path="logs" element={<Logs />} />
        <Route path="settings" element={<Settings />} />

        {/* Old routes, kept working. Browse and Libraries merged into Library;
            Media became Studio and absorbed the standalone Logos page;
            collections moved inside a channel back in Phase 2. */}
        <Route path="browse/*" element={<LegacyRedirect from="/browse" to="/library" />} />
        <Route path="libraries" element={<Navigate to="/library#sources" replace />} />
        <Route path="media" element={<LegacyRedirect from="/media" to="/studio" />} />
        <Route path="logos" element={<Navigate to="/studio#images" replace />} />
        <Route path="collections/*" element={<Navigate to="/channels" replace />} />

        {/* Anything else is a typo or a link from a much older version. */}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  )
}
