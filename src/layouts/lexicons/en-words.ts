/** High-frequency English plus conversational / tech tokens. Reverse remap only on a hit. */
const ENGLISH_WORDS = `
a about above across after again against age ago air all almost along already
also always am among an and animal another answer any anyone anything appear
are area around as ask asked at away back bad be because become been before
began begin behind being below best better between big both boy bring brought
but by call called came can cannot car care carry case change children city
close come coming could country cut day days did didn't different do does
doesn't doing done don't door down during each early earth easy eat end enough
even ever every everyone everything example face fact family far fast father
feel few find first five follow food for form found four friend from full
get girl give given go going gone good got great group grow had half hand
happen hard has have he head hear heard help her here high him himself his
hold home hope house how however i i'd i'll i'm i've idea if important in
inside into is isn't it it's its just keep kind knew know known large last
later learn leave left less let letter life light like line little live living
long look looked looking lose love made make man many may maybe me mean men
might mind miss money more most mother move much must my name near need never
new next night no not nothing now number of off often oh old on once one only
open or other our out over own page paper part people person picture place
play point put question quite rather read real really right room run said same
saw say school see seem seen sentence set several she should show side since
small so some someone something sometimes soon sound still stop story study
such sun sure take taken talk tell than thank thanks that that's the their
them then there these they thing things think this those though thought three
through time times to today together told too took top toward try turn two
under until up upon us use used using very want wanted was water way we well
went were what when where whether which while white who whole why will with
without woman word words work world would write year years yes yet you you'd
you'll you're young your
hello hi hey please sorry okay ok yeah yep nope thanks thankyou bye
cool call wait stop start check open close send save load login logout
email phone number password account user users file files page pages
search find help about contact home news blog post posts comment comments
react api html css js ts json http https url ui ux git github gitlab
fastapi laravel postgresql openai chatgpt next node python java kotlin
swift rust golang docker linux
macos windows chrome firefox safari
doing done does didn't don't can't won't shouldn't couldn't
whats thats heres theres youre theyre isnt wasnt arent werent
hows whos wheres
fine test tests tested testing project projects working worked
component components code coding meeting meetings message messages
team teams tomorrow yesterday issue issues bug bugs error errors
ready update updated updates language languages keyboard layout
layouts switch switching type typing english arabic text
sentence sentences nice wrong correct true false trying tried
getting making awesome wow later today here friend world
morning night afternoon evening please wait send save
component current currently still already also
`.trim()

const ENGLISH_WORD_SET = new Set(
  ENGLISH_WORDS.split(/\s+/).map((word) => word.toLocaleLowerCase()),
)

export function isEnglishWord(word: string): boolean {
  const text = word.toLocaleLowerCase()
  if (ENGLISH_WORD_SET.has(text)) return true
  if (/^[a-z]+(?:'s|n't)$/.test(text)) {
    const stem = text.endsWith("n't") ? text.slice(0, -3) : text.slice(0, -2)
    if (ENGLISH_WORD_SET.has(stem) || ENGLISH_WORD_SET.has(`${stem}n`)) return true
  }
  if (/^[a-z]{2,}$/.test(text) && ENGLISH_WORD_SET.has(text.replace(/'s$/, ''))) {
    return true
  }
  return false
}
