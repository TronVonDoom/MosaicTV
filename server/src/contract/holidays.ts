// Holiday episodes, and the weeks each holiday's are worth airing in. With a
// channel's "holiday episodes in their season" on (Channel.holidaysInSeason),
// an episode whose title names a holiday airs only in that holiday's weeks;
// the rest of the year its turn is skipped — no Christmas episode in July.
//
// Found by the episode's title (a show's season 0 is mostly these). Only TV
// episodes: a movie called Halloween is a horror film, not a holiday special.

import { inSeason } from './seasons.js'

export type Holiday = {
  key: string
  name: string
  /** Its weeks, as a season ("MM-DD" both ends; see seasons.ts). */
  seasonFrom: string
  seasonTo: string
  words: RegExp
}

export const HOLIDAYS: readonly Holiday[] = [
  {
    key: 'christmas',
    name: 'Christmas',
    // From the day after Thanksgiving at the earliest to the end of the year.
    seasonFrom: '11-23',
    seasonTo: '12-31',
    words:
      /\b(christmas\w*|xmas|x-mas|yule(tide)?|santa(?! (fe|barbara|monica|cruz|ana|clara|rosa|maria|anita)\b)|rudolph|reindeer|mistletoe|nativity|grinch|nutcracker|jingle bells?|sleigh( ride|bells?)?|hanukk?ah|chanukk?ah|kwanzaa|frosty the snowman|deck the halls|silent night)\b/i,
  },
  { key: 'halloween', name: 'Halloween', seasonFrom: '10-01', seasonTo: '10-31', words: /\b(hallowe'?en|trick[- ]or[- ]treat(ing)?|treehouse of horror|all hallows|jack[- ]o'?[- ]lanterns?)\b/i },
  { key: 'thanksgiving', name: 'Thanksgiving', seasonFrom: '11-01', seasonTo: '11-30', words: /\b(thanksgiving|turkey day)\b/i },
  { key: 'newyear', name: 'New Year', seasonFrom: '12-26', seasonTo: '01-07', words: /\bnew year'?s?('s)? (eve|day)\b|\bauld lang syne\b|\bhappy new year\b/i },
  { key: 'valentine', name: 'Valentine’s Day', seasonFrom: '02-01', seasonTo: '02-14', words: /\bvalentine'?s?\b/i },
  { key: 'stpatrick', name: 'St. Patrick’s Day', seasonFrom: '03-10', seasonTo: '03-17', words: /\b(st\.?|saint) patrick'?s?\b|\bleprechauns?\b/i },
  // Easter moves (Mar 22 – Apr 25); its weeks cover every date it can fall on.
  { key: 'easter', name: 'Easter', seasonFrom: '03-15', seasonTo: '04-25', words: /\beaster\b/i },
  { key: 'july4', name: 'Fourth of July', seasonFrom: '06-28', seasonTo: '07-05', words: /\b(fourth of july|4th of july|july 4th|independence day)\b/i },
]

/** The holiday an episode is about, by its title, or null. */
export function holidayOf(m: { title: string; type?: string | null }): Holiday | null {
  if (m.type != null && m.type !== 'episode') return null
  for (const h of HOLIDAYS) if (h.words.test(m.title)) return h
  return null
}

/** Whether an episode about holiday `h` may air on local date `day`. */
export const holidayInSeason = (h: Holiday, day: Date): boolean => inSeason(h, day)
