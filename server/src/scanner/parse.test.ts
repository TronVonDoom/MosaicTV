import test from 'node:test'
import assert from 'node:assert/strict'
import { extraHome, extraStem, parseMedia } from './parse.js'

const movie = (p: string) => parseMedia(`/media/movies/${p}`, '/media/movies', 'movie')
const episode = (p: string) => parseMedia(`/media/tv/${p}`, '/media/tv', 'tv')

test('release tags come off a movie title, the year still parses', () => {
  const cases: [string, string, number | null][] = [
    ['Blade (1998)/Blade (WEBDL-1080p x265).mkv', 'Blade', 1998],
    ['Hocus Pocus/Hocus Pocus (Bluray-1080p x265) (1993).mkv', 'Hocus Pocus', 1993],
    ['Goosebumps 2/Goosebumps 2 - Haunted Halloween (Bluray-1080p x265).mkv',
      'Goosebumps 2 - Haunted Halloween', null],
    ['Ghostbusters/Ghostbusters - Afterlife (Bluray-2160p x265).mkv',
      'Ghostbusters - Afterlife', null],
    ['Death Wish/Death Wish (Bluray-1080p h265) (1974).mkv', 'Death Wish', 1974],
    ['3 Idiots/3 Idiots (BR-DISK x265) (2009).mkv', '3 Idiots', 2009],
    ['Catch Me If You Can (2002) (HD) (x264)/Catch Me If You Can (2002).mkv',
      'Catch Me If You Can', 2002],
  ]
  for (const [p, title, year] of cases) {
    const got = movie(p)
    assert.equal(got.title, title, p)
    assert.equal(got.year, year, p)
  }
})

test('release tags come off an episode title too', () => {
  const cases: [string, string][] = [
    ['Beetleborgs/Season 01/Beetleborgs - S01E10 - Locomotion Commotion (MPEG2).mkv',
      'Locomotion Commotion'],
    ['Rugrats/Season 08/Rugrats - S08E02 - Curse of the Werewuff (480p x265 EDGE2020).mkv',
      'Curse of the Werewuff'],
    ['Kenan & Kel/Season 03/Kenan & Kel - S03E04 - The Chicago Witch Trials (XviD).mkv',
      'The Chicago Witch Trials'],
  ]
  for (const [p, title] of cases) {
    assert.equal(episode(p).title, title, p)
  }
})

test('a tagged show folder still yields a clean show title', () => {
  const got = episode('The Office (US) (1080p x265)/Season 02/The Office - S02E05 - Halloween.mkv')
  assert.equal(got.showTitle, 'The Office (US)')
  assert.equal(got.title, 'Halloween')
})

test('parentheticals that carry meaning are left alone', () => {
  const kept: [string, string][] = [
    ['The Munsters/Season 00/The Munsters - S00E01 - My Fair Munster (Unaired Pilot).mkv',
      'My Fair Munster (Unaired Pilot)'],
    ['The Munsters/Season 00/The Munsters - S00E10 - Family Portrait (Colorized).mkv',
      'Family Portrait (Colorized)'],
    ['Gargoyles/Season 01/Gargoyles - S01E01 - Awakening (1).mkv', 'Awakening (1)'],
    ['Batman/Season 01/Batman - S01E57 - The Demon’s Quest (Part 1).mkv',
      'The Demon’s Quest (Part 1)'],
    ['The Munsters/Season 00/The Munsters - S00E09 - America’s First Family of Fright (Documentary).mkv',
      'America’s First Family of Fright (Documentary)'],
  ]
  for (const [p, title] of kept) {
    assert.equal(episode(p).title, title, p)
  }
  // A cut/edition parenthetical names a different film, so it has to survive.
  assert.equal(movie('Blade Runner/Blade Runner (Director’s Cut 1992).mkv').title,
    'Blade Runner (Director’s Cut 1992)')
  // An all-caps word alone is not a release tag — no quality token beside it.
  assert.equal(movie('Something (BBC).mkv').title, 'Something (BBC)')
})

test('extras are told from the movie or show they belong to', () => {
  // Folders inside the title's own folder, as they sit in the real library.
  const cases: [string, 'movie' | 'tv', string | null][] = [
    ['3 Idiots (2009) (BR-DISK.x265)/3 Idiots (2009) (BR-DISK.x265).mkv', 'movie', null],
    ['3 Idiots (2009) (BR-DISK.x265)/Featurettes/Trailer.mkv', 'movie', 'featurette'],
    ['White Christmas (1954) (HD) (x264)/White Christmas (1954)/White Christmas (1954).mkv', 'movie', null],
    ['White Christmas (1954) (HD) (x264)/White Christmas (1954)/Interviews/Bing Crosby Christmas Crooner.mkv', 'movie', 'interview'],
    ['White Christmas (1954) (HD) (x264)/White Christmas (1954)/Trailers/Theatrical Trailer.mkv', 'movie', 'trailer'],
    ['How the Grinch Stole Christmas! (1966)/Shorts/Rare Grinch Pencil Test.mkv', 'movie', 'short'],
    ['A Colbert Christmas (2008)/Scenes/Alternative Endings.mkv', 'movie', 'scene'],
    ['Some Movie (2001)/Behind The Scenes/Making Of.mkv', 'movie', 'behindthescenes'],
    ['Some Movie (2001)/deleted scenes/Cut.mkv', 'movie', 'deleted'],
    ['Some Movie (2001)/Extras/Gag Reel.mkv', 'movie', 'other'],
    // Beside the movie, by suffix.
    ['Apocalypse Now (1979) (HD) (x264)/Redux-featurette.mkv', 'movie', 'featurette'],
    ['Some Movie (2001)/Some Movie-trailer.mp4', 'movie', 'trailer'],
    ['Some Movie (2001)/sample.mkv', 'movie', 'sample'],
    // A show's extras, even when they're numbered like episodes.
    ['The Office (US) (2005)/Featurettes/Season 5/100 Episodes 100 Moments.mkv', 'tv', 'featurette'],
    ['Show (1990)/Featurettes/Show - S01E01 - Making Of.mkv', 'tv', 'featurette'],
    ['The Office (US) (2005)/Featurettes/Season 1/Deleted Scenes/The Office (US) - S01E01 - Pilot Deleted Scenes.mkv', 'tv', 'featurette'],
    // …but a numbered episode in a folder whose name only might mean extras
    // is an episode: real Pokémon episodes are filed under "Other".
    ['Pokémon (1997)/Other/Pokémon - S25E43 - The Road Most Traveled!.mkv', 'tv', null],
    ['Looney Tunes (1930)/Shorts/Looney Tunes - S01E01 - Sinkin in the Bathtub.mkv', 'tv', null],
    ['Pokémon (1997)/Other/Pokémon Promo.mkv', 'tv', 'other'],
    // Specials are season 0, not extras.
    ['Rugrats (1991)/Specials/Rugrats - S00E01 - A Rugrats Passover.mkv', 'tv', null],
    ['Rugrats (1991)/Season 01/Rugrats - S01E01 - Tommy’s First Birthday.mkv', 'tv', null],
    // The title's own folder never counts, and neither do look-alike names.
    ['Shorts/For the Birds (2000).mkv', 'movie', null],
    ['Trailer Park Boys (2001)/Season 01/Trailer Park Boys - S01E01 - Take Your Little Gun.mkv', 'tv', null],
    ['Face-Off (1997)/Face-Off (1997).mkv', 'movie', null],
    ['The Other Guys (2010)/The Other Guys (2010).mkv', 'movie', null],
  ]
  for (const [p, kind, extra] of cases) {
    const got = kind === 'movie' ? movie(p) : episode(p)
    assert.equal(got.extra, extra, p)
  }
  // One named by suffix goes by the rest of its name.
  assert.equal(movie('Apocalypse Now (1979) (HD) (x264)/Redux-featurette.mkv').title, 'Redux')
  // Only movie and TV libraries have extras.
  assert.equal(parseMedia('/media/mv/Artist/Interviews/Talk.mkv', '/media/mv', 'music').extra, null)
})

test('a show’s extras file under the show, and under a season when they sit in its folder', () => {
  const pick = (p: string) => {
    const e = episode(p)
    return [e.type, e.showTitle, e.season, e.extra, e.title]
  }
  assert.deepEqual(pick('The Office (2005)/Featurettes/Blooper Reel.mkv'), ['other', 'The Office', null, 'featurette', 'Blooper Reel'])
  assert.deepEqual(pick('The Office (2005)/Season 05/Bloopers-featurette.mkv'), ['other', 'The Office', 5, 'featurette', 'Bloopers'])
  assert.deepEqual(pick('Doug (1991)/Specials/Behind The Scenes/Making Doug.mkv'), ['other', 'Doug', 0, 'behindthescenes', 'Making Doug'])
  // A loose file that isn't an extra still has no show.
  assert.deepEqual(pick('Doug (1991)/Promo.mkv').slice(0, 4), ['other', null, null, null])
})

test('a movie’s extras belong to the folder their extras folder sits in', () => {
  assert.equal(extraHome('/m/Alien (1979)/Featurettes/Making Of.mkv'), '/m/Alien (1979)')
  assert.equal(extraHome('/m/Alien (1979)/Alien (1979)-trailer.mkv'), '/m/Alien (1979)')
  assert.equal(extraStem('/m/Heat (1995)-trailer.mkv'), 'Heat (1995)')
})

test('id hints come off titles and show names — the match reads them from the path', () => {
  const m = movie('The Matrix (1999) {tmdb-603}/The Matrix (1999) {tmdb-603}.mkv')
  assert.deepEqual([m.title, m.year], ['The Matrix', 1999])
  assert.equal(movie('Heat (1995) [imdbid-tt0113277]/Heat (1995).mkv').title, 'Heat')
  const e = episode('The Office (2005) {tvdb-73244}/Season 01/The Office - S01E01 - Pilot.mkv')
  assert.deepEqual([e.showTitle, e.season, e.episode], ['The Office', 1, 1])
})
