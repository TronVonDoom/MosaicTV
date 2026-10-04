// The demo library: every show, movie, artist, ad and channel here is made up,
// so the screenshots on the website show what MosaicTV does without anyone's
// real collection in them. art.mjs draws the artwork, media.mjs makes the
// files, tmdb.mjs serves the details the way TMDB would, seed.mjs builds the
// channels.

// Cast names come from this pool, so the same faces turn up across titles as
// they do in real TV.
export const PEOPLE = [
  'Dana Whitfield', 'Marcus Bell', 'Rosa Delgado', 'Teddy Okafor', 'June Harrington', 'Lena Park',
  'Gus Moreno', 'Nora Quinlan', 'Felix Abernathy', 'Ivy Castellano', 'Sam Rourke', 'Bea Lindqvist',
  'Otis Fairbanks', 'Mae Calloway', 'Hank Delacroix', 'Priya Raman', 'Leo Brandt', 'Cora Vance',
  'Eddie Tran', 'Ruth Ashby', 'Benny Sato', 'Gloria Pike', 'Archie Duval', 'Wren Holloway',
]

// ── TV ──────────────────────────────────────────────────────────────────────
// `seg` = minutes a file runs. Cartoons made as shorts have short files that
// group into broadcast half-hours (see seed.mjs).
export const SHOWS = [
  {
    id: 91001, slug: 'captain-comet', title: 'Captain Comet', year: 1994, look: 'space', seg: 7.2,
    genres: ['Animation', 'Family', 'Sci-Fi & Fantasy'], rating: 'TV-Y7', vote: 8.1, network: 'Mosaic Toons',
    tagline: 'One small step for a kid. One giant leap for the galaxy.',
    overview: 'Ten-year-old Casey Orbit borrows her grandfather’s homemade rocket and becomes Captain Comet, leader of the Star Scouts — three kids, one robot and a dog who patrol the solar system between bedtime and breakfast.',
    creator: 'Wren Holloway',
    cast: [['June Harrington', 'Captain Comet (voice)'], ['Teddy Okafor', 'Bolt (voice)'], ['Ivy Castellano', 'Nova (voice)'], ['Hank Delacroix', 'Doctor Dark (voice)']],
    seasons: [
      { n: 1, year: 1994, eps: ['Blast Off!', 'The Moon Is Made of Cheese?', 'Comet’s Day Off', 'Asteroid Alley', 'Space Camp Panic', 'The Great Gravity Grab', 'Robot Roommate', 'Meteor Shower Party', 'Lost in the Nebula', 'Star Scout Jamboree', 'Solar Flair', 'Return of Doctor Dark'] },
      { n: 2, year: 1995, eps: ['Comet Jr.', 'Planet Pajama', 'Black Hole in One', 'Saturn’s Rings for Sale', 'The Space Sneeze', 'Captain Copycat', 'Moon Base Mayhem', 'Zero-G Zoo', 'Doctor Dark’s Birthday'] },
    ],
  },
  {
    id: 91002, slug: 'dino-dudes', title: 'Dino Dudes', year: 1993, look: 'dino', seg: 10.4,
    genres: ['Animation', 'Comedy'], rating: 'TV-Y7', vote: 7.6, network: 'Mosaic Toons',
    tagline: 'Sixty-five million years too cool.',
    overview: 'Rex and Spike are two teenage dinosaurs with skateboards, a band that can only play one song, and a volcano for a neighbour. Each half hour aired with a Professor Penguin short between the two Dino Dudes stories.',
    creator: 'Otis Fairbanks',
    cast: [['Benny Sato', 'Rex (voice)'], ['Gus Moreno', 'Spike (voice)'], ['Gloria Pike', 'Mom Rex (voice)']],
    seasons: [{ n: 1, year: 1993, eps: ['Rex Marks the Spot', 'Tar Pit Party', 'Prehistoric Pizza', 'The Big Hatch', 'Volcano Vacation', 'Fossil Fuel', 'Raptor Rapper', 'Ice Age Ice Cream'] }],
  },
  {
    id: 91003, slug: 'professor-penguin', title: 'Professor Penguin', year: 1993, look: 'arctic', seg: 6.4,
    genres: ['Animation', 'Comedy', 'Kids'], rating: 'TV-Y', vote: 7.9, network: 'Mosaic Toons',
    tagline: 'Science is cool. Ice cold, actually.',
    overview: 'The South Pole’s only scientist invents a machine a week and a disaster a day. Six-minute shorts made to air between the halves of Dino Dudes.',
    creator: 'Otis Fairbanks',
    cast: [['Felix Abernathy', 'Professor Penguin (voice)'], ['Mae Calloway', 'Pip (voice)']],
    seasons: [{ n: 1, year: 1993, eps: ['The Iceberg Experiment', 'Penguin of Tomorrow', 'Snow Science', 'The Slippery Formula'] }],
  },
  {
    id: 91004, slug: 'robo-rangers', title: 'Robo Rangers', year: 1998, look: 'mecha', seg: 22.5,
    genres: ['Animation', 'Action & Adventure', 'Sci-Fi & Fantasy'], rating: 'TV-PG', vote: 8.4, network: 'Mosaic Toons',
    tagline: 'When the city sleeps, the Rangers wake.',
    overview: 'In Neo-Harbor, 2099, five cadets pilot salvaged giant robots against the Rust Legion. A late-night favourite that aired in the action block after the cartoons went to bed.',
    creator: 'Eddie Tran',
    cast: [['Leo Brandt', 'Kai (voice)'], ['Priya Raman', 'Vega (voice)'], ['Archie Duval', 'Commander Stone (voice)'], ['Cora Vance', 'Lady Rust (voice)']],
    seasons: [{ n: 1, year: 1998, eps: ['Activate!', 'Steel Horizon', 'The Rust Legion', 'Circuit Breaker', 'Neon Siege', 'Ghost in the Gears', 'Overclock', 'Rangers Forever'] }],
  },
  {
    id: 91005, slug: 'maple-street', title: 'Maple Street', year: 1988, look: 'suburb', seg: 22.8,
    genres: ['Comedy', 'Family'], rating: 'TV-G', vote: 7.8, network: 'Hometown',
    tagline: 'Every family has a story. This street has six.',
    overview: 'The Bennetts, the Garcias and the Okonkwos share a fence, a driveway basketball hoop and every crisis in between on the friendliest street in Cedar Falls.',
    creator: 'Ruth Ashby',
    cast: [['Marcus Bell', 'Frank Bennett'], ['Dana Whitfield', 'Carol Bennett'], ['Rosa Delgado', 'Lucy Garcia'], ['Sam Rourke', 'Danny Bennett'], ['Lena Park', 'Grace Okonkwo']],
    seasons: [
      { n: 0, year: 1989, eps: ['A Maple Street Christmas'] },
      { n: 1, year: 1988, eps: ['Pilot', 'The New Neighbors', 'Bake Sale', 'Garage Band', 'Snow Day', 'Dad’s Big Promotion'] },
      { n: 2, year: 1989, eps: ['Back to School', 'The Science Fair', 'Grandma Moves In', 'The Talent Show', 'Road Trip', 'Prom Night'] },
      { n: 3, year: 1990, eps: ['The Driving Test', 'Mom Goes Back to Work', 'The Big Game', 'Thanksgiving Disaster', 'The Treehouse', 'Graduation'] },
    ],
  },
  {
    id: 91006, slug: 'second-helpings', title: 'Second Helpings', year: 1991, look: 'diner', seg: 22.4,
    genres: ['Comedy'], rating: 'TV-PG', vote: 7.4, network: 'Hometown',
    tagline: 'Open 24 hours. Closed to sanity.',
    overview: 'When Bea inherits her uncle’s failing roadside diner, she gets a grill that catches fire on Tuesdays, a cook who won’t take orders, and the loyal regulars who refuse to leave.',
    creator: 'Nora Quinlan',
    cast: [['Bea Lindqvist', 'Bea'], ['Otis Fairbanks', 'Sal'], ['Mae Calloway', 'Dottie'], ['Teddy Okafor', 'Earl']],
    seasons: [{ n: 1, year: 1991, eps: ['Grand Reopening', 'The Health Inspector', 'Pie Fight', 'The Critic', 'Double Shift', 'The Secret Recipe', 'Blue Plate Special', 'Last Call'] }],
  },
  {
    id: 91007, slug: 'pemberton-place', title: 'Pemberton Place', year: 1986, look: 'culdesac', seg: 23.1,
    genres: ['Comedy'], rating: 'TV-G', vote: 7.1, network: 'Hometown',
    tagline: 'Welcome to the neighborhood. Please keep off the lawn.',
    overview: 'Retired Navy captain Walter Pemberton runs his cul-de-sac like a ship. His new neighbours, a family of five and a very loud parrot, have other ideas.',
    creator: 'Hank Delacroix',
    cast: [['Archie Duval', 'Walter Pemberton'], ['Gloria Pike', 'Marjorie Pemberton'], ['Eddie Tran', 'Kenny Lu']],
    seasons: [{ n: 1, year: 1986, eps: ['Moving Day', 'The Block Party', 'Lawn Wars', 'The Babysitter', 'Power Outage', 'Pemberton’s Got Talent'] }],
  },
  {
    id: 91008, slug: 'harbor-patrol', title: 'Harbor Patrol', year: 1997, look: 'harbor', seg: 44.2,
    genres: ['Drama', 'Crime', 'Action & Adventure'], rating: 'TV-14', vote: 8.0, network: 'Harbor 44',
    tagline: 'Rough water. Steady hands.',
    overview: 'The marine unit of a working port city answers the calls nobody else can reach — capsized ferries, smugglers in the fog, and the storms that come in off the gulf.',
    creator: 'Cora Vance',
    cast: [['Leo Brandt', 'Sgt. Tom Reyes'], ['Wren Holloway', 'Officer Kate Malone'], ['Felix Abernathy', 'Captain Ray Dunn']],
    seasons: [{ n: 1, year: 1997, eps: ['Rough Water', 'Fog Bank', 'Undertow', 'Mayday', 'Riptide', 'Safe Harbor'] }],
  },
  {
    id: 91009, slug: 'nightfall-theater', title: 'Nightfall Theater', year: 1961, look: 'noir', seg: 25.2, aspect: '4:3',
    genres: ['Mystery', 'Sci-Fi & Fantasy', 'Drama'], rating: 'TV-PG', vote: 8.6, network: 'Nite Owl',
    tagline: 'Between the last light and the first dream.',
    overview: 'An anthology of the strange and the uncanny, introduced each week by a host who is never seen in full. Filmed in black and white and in 4:3, as it aired.',
    creator: 'Priya Raman',
    cast: [['Hank Delacroix', 'The Host'], ['June Harrington', 'Various'], ['Sam Rourke', 'Various']],
    seasons: [{ n: 1, year: 1961, eps: ['The Clock That Ran Backwards', 'Room 13', 'The Stranger at Mile Marker 9', 'Static', 'The Last Bus Home', 'Mirror, Mirror'] }],
  },
]

// ── Movies ──────────────────────────────────────────────────────────────────
export const MOVIES = [
  { id: 92001, slug: 'the-last-arcade', title: 'The Last Arcade', year: 1984, look: 'synth', min: 97, cert: 'PG', vote: 7.7, genres: ['Science Fiction', 'Adventure'], studio: 'Lumen Pictures', tagline: 'Game over is only the beginning.', overview: 'The night before the town’s last arcade closes for good, four friends find a cabinet that isn’t in any catalogue — and a high score that belongs to someone who vanished in 1979.', director: 'Eddie Tran', cast: ['Sam Rourke', 'Ivy Castellano', 'Teddy Okafor', 'Ruth Ashby'] },
  { id: 92002, slug: 'neon-harbor', title: 'Neon Harbor', year: 1989, look: 'neon', min: 104, cert: 'R', vote: 7.3, genres: ['Crime', 'Thriller'], studio: 'Northlight Films', tagline: 'The city never sleeps. Neither does she.', overview: 'A night-shift cab driver picks up a fare who leaves behind a briefcase, a phone number and three hours to deliver both before sunrise.', director: 'Cora Vance', cast: ['Wren Holloway', 'Leo Brandt', 'Hank Delacroix'] },
  { id: 92003, slug: 'midnight-at-the-drive-in', title: 'Midnight at the Drive-In', year: 1987, look: 'drivein', min: 92, cert: 'PG-13', vote: 6.9, genres: ['Horror', 'Comedy'], studio: 'Double Feature Pictures', tagline: 'Tonight’s feature is to die for.', overview: 'On closing night at the Starlite Drive-In, the monsters on the screen start parking in the back row.', director: 'Otis Fairbanks', cast: ['Benny Sato', 'Mae Calloway', 'Gus Moreno', 'Gloria Pike'], extras: [['Trailer', 2.3], ['Behind the Scenes', 6.8]] },
  { id: 92004, slug: 'the-pumpkin-patch', title: 'The Pumpkin Patch', year: 1982, look: 'pumpkin', min: 88, cert: 'R', vote: 6.6, genres: ['Horror'], studio: 'Harvest Moon Films', tagline: 'Something’s growing in Harlan County.', overview: 'The biggest pumpkin at the county fair has never lost — and every year, someone in town goes missing the week before the judging.', director: 'Archie Duval', cast: ['Nora Quinlan', 'Marcus Bell', 'Lena Park'] },
  { id: 92005, slug: 'lake-wanda', title: 'Lake Wanda', year: 1985, look: 'lake', min: 86, cert: 'R', vote: 6.4, genres: ['Horror', 'Thriller'], studio: 'Pinecrest Pictures', tagline: 'Summer camp was never this quiet.', overview: 'Eight counsellors open Camp Wanda a week early. The lake has been waiting thirty years.', director: 'Felix Abernathy', cast: ['Dana Whitfield', 'Eddie Tran', 'Bea Lindqvist'] },
  { id: 92006, slug: 'hollow-creek', title: 'Hollow Creek', year: 1990, look: 'creek', min: 95, cert: 'R', vote: 7.0, genres: ['Horror', 'Mystery'], studio: 'Northlight Films', tagline: 'Some towns keep their secrets buried.', overview: 'A geologist surveying a dried-up creek bed finds a town that isn’t on any map, and townspeople who all remember her name.', director: 'Priya Raman', cast: ['Ivy Castellano', 'Archie Duval', 'Rosa Delgado'] },
  { id: 92007, slug: 'orbit-kids', title: 'Orbit Kids', year: 1986, look: 'backyard', min: 94, cert: 'PG', vote: 7.5, genres: ['Family', 'Science Fiction', 'Comedy'], studio: 'Lumen Pictures', tagline: 'Four kids. One rocket. Zero permission.', overview: 'Four best friends build a rocket from a water heater and a lawnmower engine to win the science fair. It works far better than anyone planned.', director: 'Wren Holloway', cast: ['Sam Rourke', 'June Harrington', 'Benny Sato', 'Teddy Okafor'] },
  { id: 92008, slug: 'the-great-mall-heist', title: 'The Great Mall Heist', year: 1991, look: 'mall', min: 99, cert: 'PG-13', vote: 6.8, genres: ['Comedy', 'Crime'], studio: 'Double Feature Pictures', tagline: 'Shop till they drop.', overview: 'Three mall-kiosk employees plan the perfect Christmas Eve robbery of the jewellery store across the food court. Everyone else at the mall has the same plan.', director: 'Gus Moreno', cast: ['Otis Fairbanks', 'Mae Calloway', 'Leo Brandt'] },
  { id: 92009, slug: 'cove-lights', title: 'Cove Lights', year: 1979, look: 'lighthouse', min: 101, cert: 'PG', vote: 7.2, genres: ['Mystery', 'Drama'], studio: 'Harvest Moon Films', tagline: 'The light is on. Nobody’s home.', overview: 'A lighthouse keeper’s daughter returns to the island after twenty years to find the light still burning every night — though the keeper has been gone since the storm.', director: 'Ruth Ashby', cast: ['Lena Park', 'Hank Delacroix', 'Cora Vance'] },
  { id: 92010, slug: 'velvet-skyline', title: 'Velvet Skyline', year: 1995, look: 'rooftop', min: 108, cert: 'PG-13', vote: 7.4, genres: ['Romance', 'Drama'], studio: 'Northlight Films', tagline: 'One city. Two strangers. One last night.', overview: 'A jazz pianist and an architect meet on a rooftop the night before she leaves the city for good, and spend twelve hours showing each other the city they each love.', director: 'Nora Quinlan', cast: ['Rosa Delgado', 'Marcus Bell', 'Priya Raman'] },
]

// ── Music ───────────────────────────────────────────────────────────────────
// Artists with their palette and font, music videos, and albums of songs.
export const ARTISTS = [
  { name: 'Neon Avenue', hue: 320, font: 'Monoton', videos: [['Heartbeat Highway', 1986], ['City Lights Forever', 1987]] },
  { name: 'The Static Lines', hue: 190, font: 'Rubik Mono One', videos: [['Signal Lost', 1983], ['Turn the Dial', 1984]] },
  { name: 'Cassette Club', hue: 35, font: 'Bungee', videos: [['Rewind', 1989], ['Side B', 1990]] },
  { name: 'Luna Park Radio', hue: 265, font: 'Righteous', videos: [['Rollercoaster', 1992], ['Midnight Ferris Wheel', 1993]] },
  { name: 'Paper Satellites', hue: 210, font: 'Syne', videos: [['Low Orbit', 1994], ['Gravity', 1995]] },
  { name: 'Velvet Signal', hue: 345, font: 'Abril Fatface', videos: [['Afterglow', 1987], ['Polaroid', 1988]] },
  { name: 'Marina Bay', hue: 15, font: 'Pacifico', videos: [] },
  { name: 'The Night Bus', hue: 50, font: 'Bebas Neue', videos: [] },
]

export const ALBUMS = [
  { artist: 'Velvet Signal', title: 'Afterglow', year: 1987, label: 'Silverline Records', genre: 'Synth-pop', tracks: ['Afterglow', 'Polaroid', 'Static Hearts', 'Drive All Night', 'Paper Moon', 'Slow Dissolve'] },
  { artist: 'Paper Satellites', title: 'Low Orbit', year: 1994, label: 'Northstar', genre: 'Dream Pop', tracks: ['Low Orbit', 'Gravity', 'Mission Control', 'Satellite Heart', 'Re-entry'] },
  { artist: 'Marina Bay', title: 'Coastal Drive', year: 1985, label: 'Silverline Records', genre: 'City Pop', tracks: ['Coastal Drive', 'Seaside Avenue', 'Saltwater Summer', 'Boardwalk', 'Tidelines'] },
  { artist: 'The Night Bus', title: 'Last Stop', year: 1999, label: 'Late Shift', genre: 'Indie Rock', tracks: ['Last Stop', 'Window Seat', 'Red Lights', 'Home by Three'] },
  {
    artist: 'Various Artists', title: 'Mosaic Mixtape Vol. 1', year: 1990, label: 'Mosaic', genre: 'Pop', compilation: true,
    tracks: [['Heartbeat Highway', 'Neon Avenue'], ['Rewind', 'Cassette Club'], ['Rollercoaster', 'Luna Park Radio'], ['Turn the Dial', 'The Static Lines']],
  },
]

// Synced lyrics for a few songs (originals, written for the demo).
export const LYRICS = {
  'Velvet Signal|Afterglow': [
    'Streetlights humming on the avenue',
    'Every window painted gold and blue',
    'We were running out of time to lose',
    'And I was running back to you',
    'Hold on to the afterglow',
    'Hold on, don’t let go',
    'When the city lights are burning low',
    'We’ll still have the afterglow',
    'Radio playing something slow',
    'Every word a song we used to know',
    'Hold on to the afterglow',
    'Hold on, don’t let go',
  ],
  'Paper Satellites|Low Orbit': [
    'Circling the edges of your atmosphere',
    'Close enough to see, too far to hear',
    'Every time I pass above your town',
    'I leave a little light to guide you down',
    'Low orbit, low orbit',
    'Keep me in your sky',
    'Low orbit, low orbit',
    'One more time around',
  ],
  'Marina Bay|Coastal Drive': [
    'Windows down on the coastal drive',
    'Summer on the radio, feeling alive',
    'Palm trees counting down the miles',
    'Sun is sinking, see you smile',
    'Take the long way, take your time',
    'Every exit is a new design',
    'Coastal drive, coastal drive',
    'All the way to the other side',
  ],
}

// ── Ads (the break reel) ────────────────────────────────────────────────────
export const ADS = [
  { slug: 'fizz-cola', brand: 'Fizz Cola', line: 'Taste the sparkle!', hue: 0, prop: 'can', sec: 30 },
  { slug: 'galaxy-crunch', brand: 'Galaxy Crunch', line: 'Part of this complete breakfast', hue: 270, prop: 'cereal', sec: 30 },
  { slug: 'turbokart', brand: 'TurboKart', line: 'Batteries not included', hue: 200, prop: 'kart', sec: 20 },
  { slug: 'moonbeam-sneakers', brand: 'Moonbeam Sneakers', line: 'They light up!', hue: 300, prop: 'sneaker', sec: 30 },
  { slug: 'sunny-days-oj', brand: 'Sunny Days', line: 'Fresh-squeezed sunshine', hue: 40, prop: 'carton', sec: 20 },
  { slug: 'pixel-pals', brand: 'Pixel Pals', line: 'Collect all 8!', hue: 140, prop: 'handheld', sec: 30 },
  { slug: 'mega-mall', brand: 'Mega Mall', line: 'Grand opening this Saturday', hue: 330, prop: 'mall', sec: 20 },
  { slug: 'rad-rollers', brand: 'Rad Rollers', line: 'Skate night every Friday', hue: 180, prop: 'skate', sec: 30 },
]

// ── Channels ────────────────────────────────────────────────────────────────
export const CHANNELS = [
  { number: 2, name: 'Mosaic Toons', slug: 'mosaic-toons', group: 'Kids', hue: 28 },
  { number: 4, name: 'Hometown', slug: 'hometown', group: 'Entertainment', hue: 150 },
  { number: 7, name: 'Midnight Movies', slug: 'midnight-movies', group: 'Movies', hue: 230 },
  { number: 13, name: 'Nite Owl', slug: 'nite-owl', group: 'Classics', hue: 250 },
  { number: 22, name: 'Retro Rewind', slug: 'retro-rewind', group: 'Music', hue: 310 },
  { number: 31, name: 'Fright Night', slug: 'fright-night', group: 'Movies', hue: 10 },
  { number: 44, name: 'Harbor 44', slug: 'harbor-44', group: 'Entertainment', hue: 200 },
  { number: 99, name: 'Mosaic FM', slug: 'mosaic-fm', group: 'Music', hue: 190 },
]
